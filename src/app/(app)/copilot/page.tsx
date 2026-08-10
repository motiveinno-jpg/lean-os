"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ico } from "@/components/ui-icon";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { getCurrentUser } from "@/lib/queries";
import { checkIn, checkOut } from "@/lib/hr";
import { createApprovalRequest } from "@/lib/approval-workflow";
import { createContractPackage, sendContractPackage } from "@/lib/hr-contracts";
import { createAttendanceEditRequest } from "@/lib/hr";
import { kstLocalToIso } from "@/lib/kst";
import { friendlyError } from "@/lib/friendly-error";
import { sanitizeAiContractHtml } from "@/lib/sanitize-html";
import { createAiContractDraft } from "@/lib/documents";
import {
  COPILOT_ATTACHMENT_ACCEPT,
  COPILOT_MAX_ATTACHMENTS,
  COPILOT_MAX_TOTAL_TEXT_CHARS,
  extractCopilotAttachment,
  type CopilotAttachment,
} from "@/lib/copilot-attachments";

// AI 참모 — 회사 데이터를 읽고 대표가 지금 해야 할 일을 정리하는 읽기전용 AI.
//   edge(owner-copilot)는 구조화 JSON(answer.headline/summary/actions/risks/opportunities/evidence) 반환.
//   토큰 사용량은 ai_usage_summary RPC(서버가 company 결정) + ai_usage_log Realtime 로 실시간 표시.

type Action = { priority: "high" | "medium" | "low"; title: string; detail: string; href?: string };
type Risk = { title: string; detail: string; severity: "high" | "medium" | "low" };
type Opp = { title: string; detail: string };
type Evidence = { label: string; value: string; source?: string };
// 자유 구성 섹션 (2026-08-07) — 제목·묶음 수를 AI 가 질문에 맞게 정한다. style 은 표시 형태만.
type SectionItem = { title: string; detail?: string; value?: string; href?: string; level?: "high" | "medium" | "low" };
type Section = { label: string; style: "list" | "metrics" | "actions" | "risks" | "chart"; items: SectionItem[] };
// actions·risks·opportunities·evidence 는 구버전 답변(지난 대화 기록) 호환용으로만 남는다.
type Answer = {
  headline: string; summary: string;
  sections?: Section[];
  actions?: Action[]; risks?: Risk[]; opportunities?: Opp[]; evidence?: Evidence[];
};

// AI 답변 텍스트 정제 — 변수 토큰({{x}}·{x}·${x})·마크다운(**·`)이 그대로 노출돼 가독성이 떨어지던 문제 대응(2026-07-23).
function clean(s?: string): string {
  return (s || "")
    .replace(/\{\{\s*([^{}]+?)\s*\}\}/g, "$1")   // {{변수}} → 변수
    .replace(/\$\{\s*([^{}]+?)\s*\}/g, "$1")       // ${변수} → 변수
    .replace(/\{\s*([\w가-힣.\-]+)\s*\}/g, "$1")   // {변수} → 변수 (단순 토큰만)
    .replace(/\*\*([^*]+)\*\*/g, "$1")             // **강조** → 강조
    .replace(/`([^`]+)`/g, "$1")                   // `코드` → 코드
    .trim();
}
// 2단계(2026-07-28) — 엣지는 쓰기를 하지 않고 "무엇을 할지"만 돌려준다.
//   실행은 이 화면이 기존 lib 함수로 한다(결재선·연장근무 게이트 등 업무 로직 재사용 + RLS 유지).
//   tier=immediate  : 본인 범위·되돌리기 쉬움 → 도착 즉시 실행
//   tier=confirm    : 결재선을 타는 등 → 확인 카드 노출 후 사용자가 눌러야 실행
type PendingAction = { tool: string; tier: "immediate" | "confirm"; label: string; args: Record<string, unknown> };
type ActionState = "pending" | "running" | "done" | "cancelled" | "error";

type AiMsg =
  | { role: "user"; text: string; attachments?: { name: string; truncated?: boolean }[] }
  | {
      role: "ai"; answer: Answer; model?: string; at: string; asOf?: string | null;
      action?: PendingAction | null; actionState?: ActionState; actionResult?: string;
    };

type Usage = {
  plan_slug: string; plan_name: string | null; monthly_limit: number | null;
  used_tokens: number; remaining_tokens: number; usage_percent: number | null;
  reset_at: string; as_of: string;
};

const MAX_HISTORY = 50; // DB에서 로드할 최대 대화 수

const QUICK = [
  { icon: "🎯", label: "오늘의 우선순위", q: "오늘 챙겨야 할 것 3가지를 우선순위로 정리해줘" },
  { icon: "💧", label: "현금흐름 진단", q: "지금 현금흐름 상태를 진단해줘" },
  { icon: "📥", label: "미수금 수금 순서", q: "미수금 회수 우선순위를 알려줘" },
  { icon: "📝", label: "결재·지급·서명 대기", q: "처리 안 된 결재·지급·서명을 정리해줘" },
  { icon: "📈", label: "매출 흐름", q: "이번 달 매출·영업 파이프라인 흐름을 봐줘" },
  { icon: "⚠️", label: "경영 리스크", q: "지금 챙겨야 할 경영 리스크가 있어?" },
];

const LOAD_STAGES = ["회사 데이터를 읽는 중…", "현금·미수·결재 데이터를 분석 중…", "실행 우선순위를 정리 중…"];

// 진행 게이지 — 참모는 스트리밍이 아니라 답변을 통째로 받으므로 '진짜 진행률' 은 알 수 없다.
//   그래서 경과 시간으로 추정하되, 다 됐다고 거짓말하지 않도록 95% 에서 멈추고
//   실제 응답이 도착해야 100% 로 채운다.
//   시상수는 실측값 기준 — ai_usage_log 최근 61건의 owner_copilot 응답시간
//   중앙값 16.6초 / p90 38.5초. τ=16.6s 면 16.6초에 60%, 38초에 85%, 60초에 93% 가 된다.
const LOAD_TAU_MS = 16_600;
const LOAD_CEIL = 95;
function loadPercent(elapsedMs: number): number {
  return LOAD_CEIL * (1 - Math.exp(-elapsedMs / LOAD_TAU_MS));
}
const AVG_Q_TOKENS = 1400; // 예상 질문 수 근사(평균 질문당 토큰)

function fmt(n: number) { return n.toLocaleString("ko-KR"); }
function kstDate(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" }); }
  catch { return "—"; }
}
function kstDay(iso?: string | null) {
  if (!iso) return "—";
  try { return new Date(iso).toLocaleDateString("ko-KR", { timeZone: "Asia/Seoul", month: "long", day: "numeric" }); }
  catch { return "—"; }
}

export default function CopilotPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: user } = useQuery({ queryKey: ["currentUser"], queryFn: getCurrentUser });
  const companyId = user?.company_id as string | undefined;

  const [messages, setMessages] = useState<AiMsg[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [stage, setStage] = useState(0);
  const [progress, setProgress] = useState(0);
  const [planLocked, setPlanLocked] = useState(false);
  const [limitExceeded, setLimitExceeded] = useState(false);
  const [connErr, setConnErr] = useState(false);
  const [attachments, setAttachments] = useState<CopilotAttachment[]>([]);
  const [attaching, setAttaching] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // 페이지 진입 시 DB에서 대화 기록 로드 (최근 MAX_HISTORY건)
  useEffect(() => {
    if (!companyId || historyLoaded) return;
    (async () => {
      const { data, error: loadErr } = await supabase
        .from("ai_copilot_history")
        .select("query, answer, as_of, model, created_at")
        .order("created_at", { ascending: true })
        .limit(MAX_HISTORY);
      
      if (loadErr) {
        console.error("[copilot] 로드 실패:", loadErr);
      } else if (data && data.length > 0) {
        const loaded: AiMsg[] = [];
        for (const row of data) {
          loaded.push({ role: "user", text: row.query });
          const ans = row.answer as Answer | null;
          if (ans) {
            loaded.push({ role: "ai", answer: ans, model: row.model ?? undefined, at: row.created_at ?? new Date().toISOString(), asOf: row.as_of ?? null });
          }
        }
        setMessages(loaded);
      }
      setHistoryLoaded(true);
    })();
  }, [companyId, historyLoaded]);

  // 토큰 사용량 요약 (서버가 company 결정 — IDOR 불가)
  const { data: usage, refetch: refetchUsage } = useQuery<Usage | null>({
    queryKey: ["ai-usage-summary", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any).rpc("ai_usage_summary");
      return (data && !(data as any).error ? (data as Usage) : null);
    },
    enabled: !!companyId,
    staleTime: 10_000,
  });

  // Realtime: ai_usage_log 변경 시 요약 재조회 + 15초 polling fallback
  useEffect(() => {
    if (!companyId) return;
    let poll: ReturnType<typeof setInterval> | null = null;
    const startPoll = () => { if (!poll) poll = setInterval(() => refetchUsage(), 15_000); };
    const ch = supabase
      .channel(`ai-usage-${companyId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "ai_usage_log", filter: `company_id=eq.${companyId}` }, () => refetchUsage())
      .subscribe((status) => { if (status !== "SUBSCRIBED") startPoll(); });
    // 안전망: 항상 느슨한 polling 도 병행(Realtime 실패/누락 대비)
    startPoll();
    return () => { supabase.removeChannel(ch); if (poll) clearInterval(poll); };
  }, [companyId, refetchUsage]);

  // 로딩 진행 게이지 + 단계 문구.
  //   종전에는 단계 문구만 1.2초마다 순환해 "정리 중" 이 나온 뒤 다시 "읽는 중" 으로 되돌아갔다.
  //   이제 경과 시간에서 진행률을 구하고 문구를 거기에 맞춰 한 방향으로만 넘긴다.
  useEffect(() => {
    if (!loading) { setStage(0); setProgress(0); return; }
    const startedAt = Date.now();
    const tick = () => {
      const p = loadPercent(Date.now() - startedAt);
      setProgress(p);
      setStage(p < 35 ? 0 : p < 70 ? 1 : 2);
    };
    tick();
    const t = setInterval(tick, 200);
    return () => clearInterval(t);
  }, [loading]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages, loading]);

  // 특정 AI 메시지(인덱스)의 액션 상태만 갱신
  const setActionState = useCallback((idx: number, state: ActionState, result?: string) => {
    setMessages((m) => m.map((msg, i) =>
      i === idx && msg.role === "ai" ? { ...msg, actionState: state, ...(result !== undefined ? { actionResult: result } : {}) } : msg
    ));
  }, []);

  const addAttachments = useCallback(async (files: FileList | File[]) => {
    const selected = Array.from(files);
    if (!selected.length) return;
    if (attachments.length + selected.length > COPILOT_MAX_ATTACHMENTS) {
      toast(`파일은 최대 ${COPILOT_MAX_ATTACHMENTS}개까지 첨부할 수 있습니다.`, "error");
      return;
    }
    setAttaching(true);
    try {
      const parsed: CopilotAttachment[] = [];
      for (const file of selected) parsed.push(await extractCopilotAttachment(file));
      const next = [...attachments, ...parsed];
      const totalChars = next.reduce((sum, item) => sum + item.text.length, 0);
      if (totalChars > COPILOT_MAX_TOTAL_TEXT_CHARS) {
        throw new Error("첨부문서 내용이 너무 깁니다. 파일 수를 줄이거나 필요한 부분만 담아 주세요.");
      }
      setAttachments(next);
      const truncated = parsed.filter((item) => item.truncated).length;
      toast(
        truncated > 0
          ? `${parsed.length}개 파일을 읽었습니다. 긴 문서 ${truncated}개는 앞부분만 사용합니다.`
          : `${parsed.length}개 파일을 읽었습니다.`,
        "success",
      );
    } catch (error) {
      toast(friendlyError(error, "파일을 읽지 못했습니다."), "error");
    } finally {
      setAttaching(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }, [attachments, toast]);

  /**
   * 액션 실행 — 기존 lib 함수를 그대로 호출한다.
   *   엣지에서 service role 로 재구현하지 않는 이유: 결재 정책·결재선 산정,
   *   연장근무 게이트(work_end_time 이후 출근 차단) 같은 규칙이 이미 여기 있고,
   *   사용자 권한(RLS)으로 실행돼야 권한 우회가 생기지 않는다.
   */
  const runAction = useCallback(async (idx: number, action: PendingAction) => {
    if (!companyId || !user?.id) { setActionState(idx, "error", "로그인 정보를 확인할 수 없습니다."); return; }
    setActionState(idx, "running");
    try {
      if (action.tool === "clock_in" || action.tool === "clock_out") {
        // 본인 직원 레코드 — 출퇴근은 employee_id 기준.
        const { data: emp } = await supabase
          .from("employees").select("id").eq("company_id", companyId).eq("user_id", user.id).maybeSingle();
        const employeeId = (emp as { id?: string } | null)?.id;
        if (!employeeId) throw new Error("본인 직원 정보가 연결돼 있지 않습니다. 관리자에게 문의하세요.");
        const at = new Date().toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" });
        if (action.tool === "clock_in") {
          await checkIn(companyId, employeeId);
          setActionState(idx, "done", `${at} 출근으로 기록했습니다.`);
        } else {
          await checkOut(employeeId, companyId);
          setActionState(idx, "done", `${at} 퇴근으로 기록했습니다.`);
        }
        return;
      }

      if (action.tool === "create_approval_request") {
        const a = action.args as { request_type?: string; title?: string; amount?: number; description?: string };
        if (!a.title) throw new Error("결재 제목이 비어 있습니다.");
        const req = await createApprovalRequest({
          companyId,
          requesterId: user.id,
          requestType: a.request_type || "approval_doc",
          title: a.title,
          amount: Number(a.amount || 0),
          description: a.description || "",
        });
        setActionState(idx, "done", `결재를 상신했습니다. (${req?.title ?? a.title})`);
        return;
      }

      if (action.tool === "request_attendance_edit") {
        const a = action.args as { date?: string; check_in_time?: string; check_out_time?: string; status?: string; reason?: string };
        if (!a.date) throw new Error("정정할 날짜를 특정하지 못했습니다.");
        const { data: emp } = await supabase
          .from("employees").select("id").eq("company_id", companyId).eq("user_id", user.id).maybeSingle();
        const employeeId = (emp as { id?: string } | null)?.id;
        if (!employeeId) throw new Error("본인 직원 정보가 연결돼 있지 않습니다. 관리자에게 문의하세요.");
        // 정정 요청은 기존 기록에 붙는다 — 그날 기록이 없으면 요청 대상이 없다.
        const { data: rec } = await supabase
          .from("attendance_records").select("id")
          .eq("company_id", companyId).eq("employee_id", employeeId).eq("date", a.date).maybeSingle();
        const recordId = (rec as { id?: string } | null)?.id;
        if (!recordId) throw new Error(`${a.date} 근태 기록이 없어 정정을 요청할 수 없습니다. 관리자에게 기록 생성을 요청해 주세요.`);
        const changes: Record<string, string> = {};
        // 시각은 KST 로 해석 — 브라우저 타임존과 무관하게 저장돼야 한다.
        const ci = a.check_in_time ? kstLocalToIso(`${a.date}T${a.check_in_time}`) : null;
        const co = a.check_out_time ? kstLocalToIso(`${a.date}T${a.check_out_time}`) : null;
        if (ci) changes.check_in = ci;
        if (co) changes.check_out = co;
        if (a.status) changes.status = a.status;
        if (Object.keys(changes).length === 0) throw new Error("바꿀 항목이 없습니다.");
        await createAttendanceEditRequest({
          companyId, attendanceRecordId: recordId, requestedBy: user.id,
          requestedChanges: changes, reason: a.reason || undefined,
        });
        setActionState(idx, "done", `${a.date} 근태 수정 요청을 보냈습니다. 관리자 승인 후 반영됩니다.`);
        return;
      }

      if (action.tool === "create_employee_contract") {
        const a = action.args as { employee_id?: string; template_ids?: string[]; title?: string; send?: boolean };
        if (!a.employee_id) throw new Error("직원을 특정하지 못했습니다.");
        if (!a.template_ids?.length) throw new Error("사용할 서식이 지정되지 않았습니다.");
        // 변수(직원명·부서·연봉·회사명)는 buildContractVariables 가 DB 에서 채운다 — AI 가 값을 만들지 않는다.
        const { package: pkg } = await createContractPackage({
          companyId,
          employeeId: a.employee_id,
          title: a.title || "근로계약서",
          templateIds: a.template_ids,
          createdBy: user.id,
        });
        if (!a.send) {
          setActionState(idx, "done", `계약을 만들었습니다. (${a.title || "근로계약서"}) 발송은 전자계약 화면에서 할 수 있습니다.`);
          return;
        }
        // 발송은 되돌릴 수 없다 — 생성이 끝난 뒤에만 시도하고, 실패해도 초안은 남는다.
        const sent = await sendContractPackage(pkg.id, window.location.origin);
        setActionState(idx, "done", sent?.emailSent || sent?.inAppDelivered
          ? `계약을 만들고 직원에게 보냈습니다. (${a.title || "근로계약서"})`
          : `계약은 만들었지만 발송에 실패했습니다. 전자계약 화면에서 다시 보내주세요.`);
        return;
      }

      if (action.tool === "upsert_approval_form") {
        // 결재 양식 수정/생성 — AI 는 항목 구성을 제안만 하고, 확인 버튼을 누른 지금 저장한다.
        //   fields 는 엣지에서 형식 검증(sanitize)된 전체 항목 목록. RLS 로 자기 회사 양식만 가능.
        const a = action.args as {
          form_id?: string; name?: string; description?: string; use_attachment?: boolean;
          fields?: { key: string; label: string; type: string }[];
        };
        if (!a.name) throw new Error("양식 이름이 비어 있습니다.");
        if (!a.fields?.length) throw new Error("양식 입력 항목이 비어 있습니다.");
        if (a.form_id) {
          const { error } = await supabase.from("approval_forms")
            .update({
              name: a.name,
              description: a.description || null,
              fields: a.fields as never,
              use_attachment: a.use_attachment ?? true,
              updated_at: new Date().toISOString(),
            })
            .eq("id", a.form_id).eq("company_id", companyId);
          if (error) throw error;
          setActionState(idx, "done", `결재 양식을 수정했습니다. (${a.name} · 항목 ${a.fields.length}개) 결재 허브에서 확인하세요.`);
        } else {
          const { error } = await supabase.from("approval_forms")
            .insert({
              company_id: companyId,
              name: a.name,
              description: a.description || null,
              fields: a.fields as never,
              use_attachment: a.use_attachment ?? true,
              is_active: true,
              created_by: user.id,
            } as never);
          if (error) throw error;
          setActionState(idx, "done", `결재 양식을 만들었습니다. (${a.name} · 항목 ${a.fields.length}개) 결재 허브에서 확인하세요.`);
        }
        return;
      }

      if (action.tool === "create_contract_draft_from_attachment") {
        const a = action.args as {
          name?: string;
          document_type?: string;
          body_html?: string;
          variables?: string[];
          source_files?: string[];
        };
        if (!a.name?.trim()) throw new Error("계약서 이름이 비어 있습니다.");
        const bodyHtml = sanitizeAiContractHtml(a.body_html || "").trim();
        if (!bodyHtml) throw new Error("계약서 본문이 비어 있습니다.");
        const extractedVariables = Array.from(new Set(
          (bodyHtml.match(/\{\{\s*[^}]+?\s*\}\}/g) || [])
            .map((token) => token.replace(/[{}]/g, "").trim())
            .filter(Boolean),
        ));
        const variables = Array.from(new Set([...(a.variables || []), ...extractedVariables])).slice(0, 50);
        const name = a.name.trim().replace(/^\[AI 초안\]\s*/, "").slice(0, 100);
        await createAiContractDraft({
          companyId,
          createdBy: user.id,
          name,
          bodyHtml,
          variables,
          sourceFiles: a.source_files,
        });
        queryClient.invalidateQueries({ queryKey: ["contract-templates"] });
        setActionState(
          idx,
          "done",
          `계약서 초안을 전자계약 > 양식 관리에 저장했습니다. (${name}) 원문과 대조해 검토한 뒤 사용해 주세요.`,
        );
        return;
      }

      throw new Error("지원하지 않는 액션입니다.");
    } catch (e) {
      setActionState(idx, "error", friendlyError(e, "실행에 실패했습니다."));
    }
  }, [companyId, user?.id, setActionState, queryClient]);

  const ask = useCallback(async (raw: string) => {
    const q = raw.trim();
    if ((!q && attachments.length === 0) || loading || attaching) return;
    const sentAttachments = attachments;
    const displayQuestion = q || "첨부한 문서를 분석해줘";
    setLimitExceeded(false);
    setLoading(true);
    setMessages((m) => [...m, {
      role: "user",
      text: displayQuestion,
      attachments: sentAttachments.map((item) => ({ name: item.name, truncated: item.truncated })),
    }]);
    setQuestion("");
    setAttachments([]);
    try {
      const { data, error } = await supabase.functions.invoke("owner-copilot", {
        body: {
          question: displayQuestion,
          attachments: sentAttachments.map((item) => ({
            name: item.name,
            mime_type: item.mimeType,
            size: item.size,
            text: item.text,
            truncated: item.truncated,
          })),
        },
      });
      if (error) {
        const ctx = (error as { context?: Response })?.context;
        let code: string | undefined; let msg = "AI 참모 호출에 실패했습니다.";
        try { const j = ctx ? await ctx.json() : null; code = j?.code; msg = j?.error || msg; } catch { /* ignore */ }
        if (code === "PLAN_REQUIRED" || code === "NOT_ENTITLED") setPlanLocked(true);
        else if (code === "TOKEN_LIMIT") setLimitExceeded(true);
        else toast(msg, "error");
        setMessages((m) => m.slice(0, -1)); // 실패한 질문 카드 롤백
        setAttachments(sentAttachments);
        return;
      }
      const d = data as { answer: Answer; model?: string; as_of?: string | null; action?: PendingAction | null };
      const now = new Date().toISOString();
      const act = d.action ?? null;
      let aiIndex = -1;
      setMessages((m) => {
        aiIndex = m.length;
        return [...m, {
          role: "ai", answer: d.answer, model: d.model, at: now, asOf: d.as_of,
          action: act, actionState: act ? "pending" : undefined,
        }];
      });
      setConnErr(false);
      // 위험 낮은 액션(본인 출퇴근)은 확인 없이 바로 실행 — 사장님 요청("출근 찍어줘" 한 번에).
      if (act && act.tier === "immediate" && aiIndex >= 0) void runAction(aiIndex, act);
      // DB에 대화 기록 저장 (company_id는 서버 트리거가 자동 채움)
      const insertPayload = {
        query: sentAttachments.length > 0
          ? `${displayQuestion} [첨부: ${sentAttachments.map((item) => item.name).join(", ")}]`
          : displayQuestion,
        answer: d.answer,
        as_of: d.as_of ?? null,
        model: d.model ?? null,
      };
      supabase.from("ai_copilot_history").insert(insertPayload).then(({ error: dbErr }) => {
        if (dbErr) {
          console.error("[copilot] DB 저장 실패:", dbErr);
        }
      });
      refetchUsage();
    } catch {
      toast("AI 참모 호출에 실패했습니다.", "error");
      setConnErr(true);
      setMessages((m) => m.slice(0, -1));
      setAttachments(sentAttachments);
    } finally {
      setLoading(false);
    }
  }, [attachments, attaching, loading, toast, refetchUsage, runAction]);

  const locked = planLocked || usage?.monthly_limit == null;
  const pct = usage?.usage_percent ?? 0;
  const overLimit = limitExceeded || (usage != null && usage.monthly_limit != null && usage.remaining_tokens <= 0);
  // copilot2- 프리픽스 — CSS 정의와 불일치(copilot-gauge-*)로 링에 stroke 색이 안 입혀져
  //   게이지가 항상 빈 채로 보이던 버그 (2026-08-10 사장님 제보 "사용량 게이지로 차도록")
  const gaugeTone = pct >= 90 ? "copilot2-gauge-danger" : pct >= 70 ? "copilot2-gauge-warn" : "copilot2-gauge-ok";
  const estQuestions = usage?.remaining_tokens != null ? Math.max(0, Math.floor(usage.remaining_tokens / AVG_Q_TOKENS)) : 0;

  return (
    <div className="copilot2-page">
      {/* Hero */}
      <div className="copilot2-hero">
        <div className="copilot2-hero-orb copilot2-hero-orb-a" aria-hidden />
        <div className="copilot2-hero-orb copilot2-hero-orb-b" aria-hidden />
        <div className="copilot2-hero-content">
          <div className="copilot2-hero-badge"><span className="copilot2-hero-spark" aria-hidden><Ico e="✦" /></span> AI 참모</div>
          <h1 className="copilot2-hero-title">회사 데이터를 읽고, 대표가 지금 해야 할 일을 정리합니다</h1>
          <div className="copilot2-hero-meta">
            <span className={`copilot2-conn ${connErr ? "copilot2-conn-err" : "copilot2-conn-ok"}`}>
              <span className="copilot2-conn-dot" aria-hidden />{connErr ? "연결 오류" : "AI 연결됨"}
            </span>
            <span className="copilot2-hero-asof">기준 {kstDate(usage?.as_of)}</span>
            {messages.length > 0 && (
              <button
                type="button"
                onClick={() => setMessages([])}
                className="copilot2-clear-btn"
                aria-label="대화 초기화"
              >
                대화 초기화
              </button>
            )}
          </div>
        </div>
      </div>

      {locked ? (
        <div className="copilot2-lock-card">
          <div className="text-3xl mb-2" aria-hidden><Ico e="🔒" /></div>
          <div className="copilot2-lock-title">AI 참모를 쓰려면 요금제가 필요합니다</div>
          <p className="copilot2-lock-desc">회사 데이터를 실시간으로 읽고 오늘 챙길 것을 정리해 드립니다. 무료는 월 10만 토큰, 오너뷰 요금제는 월 50만 토큰까지 쓸 수 있어요.</p>
          <a href="/billing" className="btn-primary btn-sm">플랜 보기 · 업그레이드</a>
        </div>
      ) : (
        <div className="copilot2-grid">
          {/* 좌: 대화 */}
          <div className="copilot2-main">
            <div className="copilot2-conv" ref={scrollRef}>
              {messages.length === 0 && !loading && (
                <div className="copilot2-empty">
                  <div className="copilot2-empty-icon" aria-hidden><Ico e="✦" /></div>
                  <div className="copilot2-empty-title">무엇이든 물어보세요</div>
                  <div className="copilot2-empty-desc">아래 빠른 질문을 누르거나 직접 입력하면, 회사 데이터를 근거로 답합니다.</div>
                </div>
              )}
              {messages.map((m, i) =>
                m.role === "user" ? (
                  <div key={i} className="copilot2-msg-user">
                    <div className="copilot2-bubble-user">
                      {m.attachments && m.attachments.length > 0 && (
                        <div className="copilot2-msg-files">
                          {m.attachments.map((file) => (
                            <span key={file.name}><Ico e="📎" /> {file.name}{file.truncated ? " (앞부분)" : ""}</span>
                          ))}
                        </div>
                      )}
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <AnswerCard key={i} msg={m} onRun={() => m.action && runAction(i, m.action)} onCancel={() => setActionState(i, "cancelled")} />
                ),
              )}
              {loading && <LoadingCard stage={stage} progress={progress} />}
            </div>

            {overLimit ? (
              <div className="copilot2-limit-card">
                <div className="font-bold text-sm text-[var(--danger)]">이번 달 AI 사용량을 모두 사용했습니다</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">{usage?.reset_at ? `${kstDay(usage.reset_at)}에 초기화됩니다.` : "다음 달에 초기화됩니다."} 더 필요하면 상위 플랜을 확인하세요.</div>
                <a href="/billing" className="btn-secondary btn-sm mt-3">요금제 보기</a>
              </div>
            ) : (
              <>
                {/* 빠른 질문 카드 */}
                <div className="copilot2-quick-grid">
                  {QUICK.map((qq) => (
                    <button key={qq.label} type="button" disabled={loading} onClick={() => ask(qq.q)} className="copilot2-quick-card">
                      <span className="copilot2-quick-icon" aria-hidden><Ico e={qq.icon} /></span>
                      <span className="copilot2-quick-label">{qq.label}</span>
                    </button>
                  ))}
                </div>

                {/* 첨부 파일 — 원본은 업로드하지 않고 브라우저에서 추출한 텍스트만 AI에 전달. */}
                {attachments.length > 0 && (
                  <div className="copilot2-attachment-strip">
                    {attachments.map((file, index) => (
                      <span key={`${file.name}-${index}`} className="copilot2-attachment-chip">
                        <Ico e="📎" />
                        <span className="truncate">{file.name}</span>
                        <span className="copilot2-attachment-size">{Math.max(1, Math.round(file.size / 1024))}KB</span>
                        <button
                          type="button"
                          aria-label={`${file.name} 첨부 삭제`}
                          onClick={() => setAttachments((items) => items.filter((_, i) => i !== index))}
                        >×</button>
                      </span>
                    ))}
                  </div>
                )}

                {/* 입력창 */}
                <div className="copilot2-input-row">
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept={COPILOT_ATTACHMENT_ACCEPT}
                    multiple
                    className="hidden"
                    onChange={(event) => { if (event.target.files) void addAttachments(event.target.files); }}
                  />
                  <button
                    type="button"
                    className="copilot2-attach-btn"
                    aria-label="파일 첨부"
                    title="HWP·HWPX·PDF·Word·Excel·CSV·TXT 첨부"
                    disabled={loading || attaching || attachments.length >= COPILOT_MAX_ATTACHMENTS}
                    onClick={() => fileInputRef.current?.click()}
                  >
                    {attaching ? <span className="copilot2-spinner" aria-hidden /> : <Ico e="📎" />}
                  </button>
                  <textarea
                    value={question}
                    onChange={(e) => setQuestion(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && !e.shiftKey) { e.preventDefault(); ask(question); } }}
                    placeholder="회사 상태에 대해 무엇이든 물어보세요 (Enter 전송 · Shift+Enter 줄바꿈)"
                    rows={1}
                    disabled={loading || attaching}
                    className="copilot2-input"
                  />
                  <button
                    onClick={() => ask(question)}
                    disabled={loading || attaching || (!question.trim() && attachments.length === 0)}
                    className="copilot2-send"
                    aria-label="전송"
                  >
                    {loading ? <span className="copilot2-spinner" aria-hidden /> : "➤"}
                  </button>
                </div>
              </>
            )}
          </div>

          {/* 우: 토큰 사용량 */}
          <aside className="copilot2-side">
            <TokenCard usage={usage} pct={pct} gaugeTone={gaugeTone} estQuestions={estQuestions} />
          </aside>
        </div>
      )}
    </div>
  );
}

const APPROVAL_TYPE_LABEL: Record<string, string> = {
  expense_report: "지출결의서", approval_doc: "품의서", travel: "출장신청",
};
const CONTRACT_TYPE_LABEL: Record<string, string> = {
  contract: "일반 계약서",
  contract_service: "용역계약서",
  contract_sales: "매매계약서",
  contract_outsource: "업무위탁계약서",
  contract_labor: "근로계약서",
  contract_lease: "임대차계약서",
  contract_partnership: "파트너십계약서",
  nda: "비밀유지계약서",
};

/** 액션 카드 — immediate 는 진행/결과만, confirm 은 내용 확인 후 실행 버튼. */
function ActionCard({ msg, onRun, onCancel }: {
  msg: Extract<AiMsg, { role: "ai" }>;
  onRun?: () => void;
  onCancel?: () => void;
}) {
  const act = msg.action!;
  const st = msg.actionState ?? "pending";
  const args = act.args as { request_type?: string; title?: string; amount?: number; description?: string };

  if (st === "done") {
    return <div className="copilot2-action-result copilot2-action-ok"><Ico e="✅" /> {msg.actionResult || "완료했습니다."}</div>;
  }
  if (st === "error") {
    return <div className="copilot2-action-result copilot2-action-err"><Ico e="⚠" /> {msg.actionResult || "실행에 실패했습니다."}</div>;
  }
  if (st === "cancelled") {
    return <div className="copilot2-action-result copilot2-action-cancel">취소했습니다.</div>;
  }
  if (st === "running") {
    return <div className="copilot2-action-result">{act.label} 처리 중…</div>;
  }
  // pending — immediate 는 곧 자동 실행되므로 버튼을 띄우지 않는다.
  if (act.tier === "immediate") {
    return <div className="copilot2-action-result">{act.label} 처리 중…</div>;
  }

  return (
    <div className="copilot2-action-confirm">
      <div className="copilot2-action-confirm-head">{act.label} — 아래 내용으로 진행할까요?</div>
      <dl className="copilot2-action-fields">
        {act.tool === "request_attendance_edit" && (() => {
          const r = act.args as { date?: string; check_in_time?: string; check_out_time?: string; status?: string; reason?: string };
          return (
            <>
              <div><dt>날짜</dt><dd>{r.date || "—"}</dd></div>
              {r.check_in_time && <div><dt>출근</dt><dd>{r.check_in_time} 으로 정정</dd></div>}
              {r.check_out_time && <div><dt>퇴근</dt><dd>{r.check_out_time} 으로 정정</dd></div>}
              {r.status && <div><dt>유형</dt><dd>{r.status}</dd></div>}
              {r.reason && <div><dt>사유</dt><dd className="copilot2-action-desc">{clean(r.reason)}</dd></div>}
            </>
          );
        })()}
        {act.tool === "create_employee_contract" && (() => {
          const c = act.args as { title?: string; template_ids?: string[]; send?: boolean };
          return (
            <>
              <div><dt>제목</dt><dd>{clean(c.title) || "근로계약서"}</dd></div>
              <div><dt>서식</dt><dd>{c.template_ids?.length ?? 0}건</dd></div>
              <div><dt>발송</dt><dd>{c.send ? "만든 뒤 직원에게 바로 발송" : "생성만 (발송 안 함)"}</dd></div>
            </>
          );
        })()}
        {act.tool === "create_approval_request" && (
          <>
            <div><dt>유형</dt><dd>{APPROVAL_TYPE_LABEL[args.request_type || ""] || args.request_type || "품의서"}</dd></div>
            <div><dt>제목</dt><dd>{clean(args.title) || "—"}</dd></div>
            <div><dt>금액</dt><dd>{Number(args.amount || 0) > 0 ? `${fmt(Number(args.amount))}원` : "—"}</dd></div>
            {args.description && <div><dt>내용</dt><dd className="copilot2-action-desc">{clean(args.description)}</dd></div>}
          </>
        )}
        {act.tool === "upsert_approval_form" && (() => {
          const f = act.args as { form_id?: string; name?: string; description?: string; use_attachment?: boolean; fields?: { label: string; type: string; required?: boolean; options?: string[] }[] };
          return (
            <>
              <div><dt>양식</dt><dd>{clean(f.name) || "—"} {f.form_id ? "(기존 양식 수정)" : "(새 양식)"}</dd></div>
              {f.description && <div><dt>설명</dt><dd className="copilot2-action-desc">{clean(f.description)}</dd></div>}
              <div><dt>첨부란</dt><dd>{f.use_attachment ? "사용 (증빙 첨부)" : "사용 안 함"}</dd></div>
              <div><dt>입력 항목</dt><dd>
                <ol className="copilot2-form-field-list">
                  {(f.fields || []).map((fd, i) => (
                    <li key={i}>{fd.label}{fd.required ? " (필수)" : ""}{fd.options?.length ? ` — ${fd.options.join("/")}` : ""}</li>
                  ))}
                </ol>
              </dd></div>
            </>
          );
        })()}
        {act.tool === "create_contract_draft_from_attachment" && (() => {
          const d = act.args as {
            name?: string;
            document_type?: string;
            body_html?: string;
            source_files?: string[];
            variables?: string[];
          };
          return (
            <>
              <div><dt>초안명</dt><dd>{clean(d.name) || "—"}</dd></div>
              <div><dt>유형</dt><dd>{CONTRACT_TYPE_LABEL[d.document_type || ""] || "계약서"}</dd></div>
              <div><dt>원본</dt><dd>{d.source_files?.join(", ") || "첨부문서"}</dd></div>
              <div><dt>변수</dt><dd>{d.variables?.length ? d.variables.map((v) => `{{${v}}}`).join(", ") : "없음"}</dd></div>
              <div><dt>상태</dt><dd>전자계약 양식 초안 — 외부 발송 안 함</dd></div>
              <div className="copilot2-contract-preview-row">
                <dt>본문 미리보기</dt>
                <dd>
                  <div
                    className="copilot2-contract-draft-preview"
                    dangerouslySetInnerHTML={{ __html: sanitizeAiContractHtml(d.body_html || "") }}
                  />
                </dd>
              </div>
            </>
          );
        })()}
      </dl>
      <div className="copilot2-action-confirm-btns">
        <button onClick={onCancel} className="copilot2-action-cancel-btn">취소</button>
        <button onClick={onRun} className="btn-primary btn-sm">
          {act.tool === "create_employee_contract" && (act.args as { send?: boolean }).send ? "만들고 보내기" : act.label}
        </button>
      </div>
      <div className="copilot2-action-note">
        {act.tool === "create_contract_draft_from_attachment"
          ? "AI가 만든 계약서는 법률 검토를 대신하지 않습니다. 원문과 대조하고 확인 필요 항목을 검토한 뒤 사용하세요."
          : act.tool === "create_employee_contract"
          ? ((act.args as { send?: boolean }).send
              ? "발송하면 직원에게 서명 요청이 나가며 되돌릴 수 없습니다. 계약 내용은 회사 서식과 직원 정보로 자동 작성됩니다."
              : "계약 내용은 회사 서식과 직원 정보로 자동 작성됩니다.")
          : act.tool === "request_attendance_edit"
            ? "직접 수정이 아니라 관리자 승인 요청입니다."
            : "결재선은 회사 결재 정책에 따라 자동으로 정해집니다."}
      </div>
    </div>
  );
}

// chart 섹션 값 표기 — 엣지가 value 에 단위 없는 숫자만 넣으라고 지시한다.
function wonLabel(n: number): string {
  const abs = Math.abs(Math.round(n));
  const sign = n < 0 ? "-" : "";
  const eok = Math.floor(abs / 1e8);
  const man = Math.floor((abs % 1e8) / 1e4);
  if (eok > 0) return `${sign}${eok}억${man > 0 ? ` ${man.toLocaleString("ko-KR")}만` : ""}`;
  if (man > 0) return `${sign}${man.toLocaleString("ko-KR")}만`;
  return `${sign}${abs.toLocaleString("ko-KR")}`;
}

// 가로 막대그래프 — 외부 라이브러리 없이 div 폭으로 그린다.
function ChartSection({ items }: { items: SectionItem[] }) {
  const rows = items
    .map((x) => ({ title: x.title, detail: x.detail, num: Number(String(x.value ?? "").replace(/[^\d.-]/g, "")) }))
    .filter((r) => Number.isFinite(r.num));
  if (rows.length === 0) return null;
  const max = Math.max(...rows.map((r) => Math.abs(r.num)), 1);
  return (
    <div className="copilot2-chart">
      {rows.map((r, i) => (
        <div key={i} className="copilot2-chart-row">
          <span className="copilot2-chart-label">{clean(r.title)}</span>
          <span className="copilot2-chart-track">
            {/* 폭은 값 비례 — 정적 클래스로 뺄 수 없는 동적 값 */}
            <span
              className={`copilot2-chart-fill ${r.num < 0 ? "copilot2-chart-fill-neg" : ""}`}
              style={{ width: `${Math.max(2, Math.round((Math.abs(r.num) / max) * 100))}%` }}
            />
          </span>
          <span className="copilot2-chart-value">{wonLabel(r.num)}</span>
        </div>
      ))}
    </div>
  );
}

function levelLabel(level: string | undefined, kind: "action" | "risk"): string {
  const l = level || "low";
  if (kind === "risk") return l === "high" ? "위험" : l === "medium" ? "주의" : "참고";
  return l === "high" ? "높음" : l === "medium" ? "보통" : "낮음";
}

// 섹션 항목 링크. 우리 화면이면 그대로, 외부(https)면 새 탭 + 도메인 표시.
//   엣지가 이미 '검색이 실제로 인용한 도메인' 만 남겨 보내므로 여기서는 표시만 담당한다.
function SecLink({ href }: { href?: string }) {
  if (!href) return null;
  const external = /^https:\/\//.test(href);
  if (!external) return <a href={href} className="copilot2-action-link">바로가기 →</a>;
  let host = "";
  try { host = new URL(href).hostname.replace(/^www\./, ""); } catch { return null; }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="copilot2-action-link">
      {host} ↗
    </a>
  );
}

function AnswerCard({ msg, onRun, onCancel }: {
  msg: Extract<AiMsg, { role: "ai" }>;
  onRun?: () => void;
  onCancel?: () => void;
}) {
  const a = msg.answer;
  const sevCls = (s: string) => (s === "high" ? "copilot2-sev-high" : s === "medium" ? "copilot2-sev-mid" : "copilot2-sev-low");
  return (
    <div className="copilot2-answer">
      <div className="copilot2-answer-head">
        <span className="copilot2-answer-spark" aria-hidden><Ico e="✦" /></span>
        <span className="copilot2-answer-title">AI 분석 결과</span>
        {msg.model && <span className="copilot2-answer-model">{msg.model.includes("opus") ? "Opus" : msg.model.includes("haiku") ? "Haiku" : "Sonnet"}</span>}
        <span className="copilot2-answer-time">{kstDate(msg.at)}</span>
      </div>
      {a.headline && <div className="copilot2-sec-headline">{clean(a.headline)}</div>}
      {a.summary && <div className="copilot2-sec-summary">{clean(a.summary)}</div>}

      {msg.action && <ActionCard msg={msg} onRun={onRun} onCancel={onCancel} />}

      {/* 새 답변 — 제목·구성이 질문마다 다르다 */}
      {a.sections?.map((sec, si) => (
        <div key={`s${si}`} className="copilot2-sec">
          <div className="copilot2-sec-label">{clean(sec.label)}</div>
          {sec.style === "chart" ? (
            <ChartSection items={sec.items} />
          ) : sec.style === "metrics" ? (
            <div className="copilot2-evidence-grid">
              {sec.items.map((x, i) => (
                <div key={i} className="copilot2-evidence">
                  <div className="copilot2-evidence-label">{clean(x.title)}</div>
                  <div className="copilot2-evidence-value">{clean(x.value ?? x.detail)}</div>
                </div>
              ))}
            </div>
          ) : sec.style === "actions" ? (
            sec.items.map((x, i) => (
              <div key={i} className="copilot2-action">
                <span className={`copilot2-pri ${sevCls(x.level || "low")}`}>{levelLabel(x.level, "action")}</span>
                <div className="min-w-0 flex-1">
                  <div className="copilot2-action-title">{clean(x.title)}<SecLink href={x.href} /></div>
                  {x.detail && <div className="copilot2-action-detail">{clean(x.detail)}</div>}
                </div>
              </div>
            ))
          ) : sec.style === "risks" ? (
            sec.items.map((x, i) => (
              <div key={i} className="copilot2-risk">
                <span className={`copilot2-badge ${sevCls(x.level || "low")}`}>{levelLabel(x.level, "risk")}</span>
                <div className="min-w-0 flex-1">
                  <div className="copilot2-risk-title">{clean(x.title)}<SecLink href={x.href} /></div>
                  {x.detail && <div className="copilot2-action-detail">{clean(x.detail)}</div>}
                </div>
              </div>
            ))
          ) : (
            sec.items.map((x, i) => (
              <div key={i} className="copilot2-listitem">
                <span className="copilot2-listdot" aria-hidden />
                <div className="min-w-0 flex-1">
                  <div className="copilot2-risk-title">{clean(x.title)}<SecLink href={x.href} /></div>
                  {(x.detail || x.value) && <div className="copilot2-action-detail">{clean(x.detail ?? x.value)}</div>}
                </div>
              </div>
            ))
          )}
        </div>
      ))}

      {a.actions && a.actions.length > 0 && (
        <div className="copilot2-sec">
          <div className="copilot2-sec-label">지금 해야 할 일</div>
          {a.actions.map((x, i) => (
            <div key={i} className="copilot2-action">
              <span className={`copilot2-pri ${sevCls(x.priority)}`}>{x.priority === "high" ? "높음" : x.priority === "medium" ? "보통" : "낮음"}</span>
              <div className="min-w-0 flex-1">
                <div className="copilot2-action-title">{clean(x.title)}{x.href && <a href={x.href} className="copilot2-action-link">바로가기 →</a>}</div>
                <div className="copilot2-action-detail">{clean(x.detail)}</div>
              </div>
            </div>
          ))}
        </div>
      )}

      {a.risks && a.risks.length > 0 && (
        <div className="copilot2-sec">
          <div className="copilot2-sec-label">위험 신호</div>
          {a.risks.map((x, i) => (
            <div key={i} className="copilot2-risk">
              <span className={`copilot2-badge ${sevCls(x.severity)}`}>{x.severity === "high" ? "위험" : x.severity === "medium" ? "주의" : "참고"}</span>
              <div className="min-w-0 flex-1"><div className="copilot2-risk-title">{clean(x.title)}</div><div className="copilot2-action-detail">{clean(x.detail)}</div></div>
            </div>
          ))}
        </div>
      )}

      {a.opportunities && a.opportunities.length > 0 && (
        <div className="copilot2-sec">
          <div className="copilot2-sec-label">기회</div>
          {a.opportunities.map((x, i) => (
            <div key={i} className="copilot2-opp"><span aria-hidden><Ico e="💡" /></span><div><div className="copilot2-risk-title">{clean(x.title)}</div><div className="copilot2-action-detail">{clean(x.detail)}</div></div></div>
          ))}
        </div>
      )}

      {a.evidence && a.evidence.length > 0 && (
        <div className="copilot2-sec">
          <div className="copilot2-sec-label">근거 데이터</div>
          <div className="copilot2-evidence-grid">
            {a.evidence.map((x, i) => (
              <div key={i} className="copilot2-evidence"><div className="copilot2-evidence-label">{clean(x.label)}</div><div className="copilot2-evidence-value">{clean(x.value)}</div></div>
            ))}
          </div>
        </div>
      )}
      {msg.asOf && <div className="copilot2-answer-foot">기준 시각 {msg.asOf} · AI 답변은 참고용이며 실행 전 확인이 필요합니다.</div>}
    </div>
  );
}

function LoadingCard({ stage, progress }: { stage: number; progress: number }) {
  const pct = Math.min(100, Math.max(0, Math.round(progress)));
  return (
    <div className="copilot2-answer copilot2-answer-loading">
      <div className="copilot2-answer-head">
        <span className="copilot2-answer-spark" aria-hidden><Ico e="✦" /></span>
        <span className="copilot2-answer-title">AI 분석 결과</span>
        <span className="copilot2-thinking" aria-hidden><i /><i /><i /></span>
      </div>
      <div className="copilot2-load-meter">
        <div className="copilot2-load-stage">{LOAD_STAGES[stage]}</div>
        <span className="copilot2-load-pct">{pct}%</span>
      </div>
      {/* 값이 계속 변하는 진행률이라 폭은 인라인 style — 정적 클래스로 뺄 수 없다 */}
      <div
        className="copilot2-load-bar"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label="AI 답변 생성 진행률"
      >
        <div className="copilot2-load-bar-fill" style={{ width: `${pct}%` }} />
      </div>
      <div className="copilot2-skel copilot2-skel-lg" />
      <div className="copilot2-skel" />
      <div className="copilot2-skel copilot2-skel-sm" />
    </div>
  );
}

function TokenCard({ usage, pct, gaugeTone, estQuestions }: { usage: Usage | null | undefined; pct: number; gaugeTone: string; estQuestions: number }) {
  const R = 52, C = 2 * Math.PI * R;
  const clamped = Math.min(100, Math.max(0, pct));
  const off = C - (clamped / 100) * C;
  return (
    <div className="copilot2-token-card">
      <div className="copilot2-token-head">
        <span className="copilot2-token-title">AI 토큰 사용량</span>
        <span className="copilot2-live"><span className="copilot2-live-dot" aria-hidden />실시간</span>
      </div>
      <div className="copilot2-token-plan">{usage?.plan_name || "—"}</div>

      <div className="copilot2-gauge-wrap">
        <svg viewBox="0 0 120 120" className="copilot2-gauge">
          <circle cx="60" cy="60" r={R} className="copilot2-gauge-track" />
          <circle cx="60" cy="60" r={R} className={`copilot2-gauge-fill ${gaugeTone}`}
            strokeDasharray={C} strokeDashoffset={off} transform="rotate(-90 60 60)" />
        </svg>
        <div className="copilot2-gauge-center">
          <div className="copilot2-gauge-pct">{usage?.usage_percent != null ? `${usage.usage_percent}%` : "—"}</div>
          <div className="copilot2-gauge-sub">사용</div>
        </div>
      </div>

      <div className="copilot2-token-nums">
        <div><span className="copilot2-token-used">{usage ? fmt(usage.used_tokens) : "—"}</span> <span className="copilot2-token-slash">/ {usage?.monthly_limit != null ? fmt(usage.monthly_limit) : "—"} tokens</span></div>
        <div className="copilot2-token-remain">{usage ? fmt(usage.remaining_tokens) : "—"} tokens 남음</div>
      </div>

      <div className="copilot2-token-rows">
        <div className="copilot2-token-row"><span>예상 질문 가능</span><b>약 {fmt(estQuestions)}회</b></div>
        {/* '현재 모델' 행 — 2026-08-10 사장님 지시로 미표기 */}
        <div className="copilot2-token-row"><span>초기화</span><b>{kstDay(usage?.reset_at)}</b></div>
        <div className="copilot2-token-row"><span>마지막 갱신</span><b>{usage?.as_of ? new Date(usage.as_of).toLocaleTimeString("ko-KR", { timeZone: "Asia/Seoul", hour: "2-digit", minute: "2-digit" }) : "—"}</b></div>
      </div>

      {usage?.usage_percent != null && usage.usage_percent >= 90 && (
        <div className="copilot2-token-warn">사용량이 {usage.usage_percent}%입니다. 곧 한도에 도달합니다.</div>
      )}
    </div>
  );
}
