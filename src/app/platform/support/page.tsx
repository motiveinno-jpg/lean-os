"use client";
import { logRead } from "@/lib/log-read";

// 플랫폼 운영자 — 고객센터 문의 답변. support_tickets 전체(전사) 조회·답변.
//   RLS: is_platform_operator() 가 모든 회사 티켓 select/update 허용.
//   답변 저장 시 트리거가 status='answered' + 사용자 알림 발송.
//   2026-09-03 운영자 페이지 v2 — pf-* 디자인(KPI 타일·상태/분류 도넛·카드 목록). 데이터·동작은 그대로.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { OpsSearch, OpsCompanySelect, OpsExportButton, exportCsv } from "../_components/ops-kit";
import { getCurrentUser } from "@/lib/queries";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfSeg, PfEmpty, PfSkeleton } from "@/app/platform/_components/pf/ui";
import { PfDonut, PfBars } from "@/app/platform/_components/pf/charts";

const db = supabase;

type Attachment = { path: string; name: string; size: number };

// support-ticket-analyze 엣지가 저장하는 AI 진단 (스키마: 엣지 ANALYSIS_SCHEMA)
type AiAnalysis = {
  summary?: string;
  probable_cause?: string;
  matched_errors?: string[];
  screenshot_findings?: string;
  severity?: "high" | "medium" | "low";
  suggested_reply?: string;
  needs_dev?: boolean;
  // 운영자 분류용 신호 — 자동 처리 없음(2026-08-04 사장님: 전건 사람 승인)
  resolution?: "simple" | "operator" | "dev";
  analyzed_at?: string;
};

type Ticket = {
  id: string;
  company_id: string;
  user_id: string;
  category: string;
  subject: string;
  content: string;
  status: string;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
  attachments?: Attachment[] | null;
  ai_analysis?: AiAnalysis | null;
  users?: { name: string | null; email: string } | null;
  companies?: { name: string | null } | null;
};

type Tone = "ok" | "warn" | "danger" | "info" | "muted";

const SEVERITY_META: Record<string, { label: string; tone: Tone }> = {
  high: { label: "심각", tone: "danger" },
  medium: { label: "보통", tone: "warn" },
  low: { label: "낮음", tone: "muted" },
};

const CATEGORY_LABEL: Record<string, string> = {
  general: "이용 문의",
  feature: "기능 제안",
  billing: "결제·구독",
  bug: "오류 신고",
  data: "데이터·연동",
  account: "계정·권한",
  etc: "기타",
};

// 첨부 스크린샷 — 프라이빗 버킷(support-attachments), 운영자는 전용 SELECT 정책으로 서명 URL 발급
function TicketShots({ attachments }: { attachments: Attachment[] }) {
  const paths = attachments.map((a) => a.path).join(",");
  const { data: urls = [] } = useQuery<{ path: string; url: string }[]>({
    queryKey: ["p-support-shot-urls", paths],
    queryFn: async () => {
      const out: { path: string; url: string }[] = [];
      for (const a of attachments) {
        const { data } = await db.storage.from("support-attachments").createSignedUrl(a.path, 3600);
        if (data?.signedUrl) out.push({ path: a.path, url: data.signedUrl });
      }
      return out;
    },
    staleTime: 30 * 60 * 1000,
  });
  if (!attachments.length) return null;
  return (
    <div className="flex flex-wrap gap-2 mt-3">
      {urls.map((u) => (
        <a key={u.path} href={u.url} target="_blank" rel="noreferrer"
          className="w-28 h-28 rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] block hover:opacity-90 transition"
          title="새 탭에서 크게 보기">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u.url} alt="첨부 스크린샷" className="w-full h-full object-cover" />
        </a>
      ))}
    </div>
  );
}

const STATUS_META: Record<string, { label: string; tone: Tone }> = {
  open: { label: "대기", tone: "warn" },
  in_progress: { label: "처리중", tone: "info" },
  answered: { label: "답변완료", tone: "ok" },
  closed: { label: "종료", tone: "muted" },
};

const FILTERS: { value: string; label: string }[] = [
  { value: "all", label: "전체" },
  { value: "open", label: "대기" },
  { value: "in_progress", label: "처리중" },
  { value: "answered", label: "답변완료" },
];

export default function PlatformSupportPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [analyzingId, setAnalyzingId] = useState<string | null>(null);

  // AI 진단 (재)실행 — support-ticket-analyze 엣지 (운영자는 전사 티켓 가능)
  const runAnalyze = async (ticketId: string) => {
    if (analyzingId) return;
    setAnalyzingId(ticketId);
    try {
      const { data: { session } } = await db.auth.getSession();
      if (!session || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/support-ticket-analyze`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ ticket_id: ticketId }),
      });
      const result = await res.json().catch(() => ({}));
      if (!res.ok) alert(result.error || "AI 분석에 실패했습니다.");
      qc.invalidateQueries({ queryKey: ["p-support-all"] });
    } finally {
      setAnalyzingId(null);
    }
  };

  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ["p-support-all"],
    queryFn: async () => {
      const data = logRead('support/page:data', await db
        .from("support_tickets")
        // 2026-07-16: users FK 가 2개(user_id·answered_by)라 무힌트 임베드는 400 — 문의자 기준으로 명시
        .select("*, users!support_tickets_user_id_fkey(name, email), companies(name)")
        .order("created_at", { ascending: false }));
      return (data || []) as Ticket[];
    },
    refetchInterval: 60_000,
  });

  // '처리중' 전환 — 고객 화면의 진행 단계(대기→처리중→완료)와 연동 (2026-08-04 사장님)
  const startProgressMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("support_tickets").update({ status: "in_progress" }).eq("id", id).eq("status", "open");
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["p-support-all"] }),
  });

  const answerMut = useMutation({
    mutationFn: async ({ id, answer }: { id: string; answer: string }) => {
      const me = await getCurrentUser();
      //   2026-08-31: 답변을 저장해도 status 가 in_progress 에 머물러 '미처리 카운트'가 영영 안 줄었다
      //   (answered 라벨·필터는 있는데 전이하는 코드가 없었음) — 답변 저장 = 답변완료 전이.
      const { error } = await db
        .from("support_tickets")
        .update({ answer: answer.trim(), answered_by: me?.id ?? null, status: "answered" })
        .eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_d, vars) => {
      qc.invalidateQueries({ queryKey: ["p-support-all"] });
      setDrafts((d) => { const n = { ...d }; delete n[vars.id]; return n; });
    },
  });

  // 검색 (2026-07-28 전면 정비) — 제목·내용·회사·문의자
  const [search, setSearch] = useState("");
  const [companyFilter, setCompanyFilter] = useState("all");
  const companyOptions = useMemo(() => {
    const set = new Set<string>();
    tickets.forEach((t) => { if (t.companies?.name) set.add(t.companies.name); });
    return [...set].sort((a, b) => a.localeCompare(b, "ko"));
  }, [tickets]);
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return tickets.filter((t) => {
      if (companyFilter !== "all" && (t.companies?.name || "") !== companyFilter) return false;
      if (filter !== "all" && t.status !== filter) return false;
      if (!q) return true;
      return (
        (t.subject || "").toLowerCase().includes(q) ||
        (t.content || "").toLowerCase().includes(q) ||
        (t.companies?.name || "").toLowerCase().includes(q) ||
        (t.users?.name || t.users?.email || "").toLowerCase().includes(q)
      );
    });
  }, [tickets, filter, search, companyFilter]);
  const openCount = useMemo(() => tickets.filter((t) => t.status === "open" || t.status === "in_progress").length, [tickets]);

  // KPI·구성 — 상태별/분류별 건수 (전체 티켓 기준, 검색·필터와 무관)
  const counts = useMemo(() => {
    const c = { open: 0, in_progress: 0, answered: 0, closed: 0 };
    tickets.forEach((t) => { if (t.status in c) (c as Record<string, number>)[t.status]++; });
    return c;
  }, [tickets]);
  const byCategory = useMemo(() => {
    const m = new Map<string, number>();
    tickets.forEach((t) => m.set(t.category, (m.get(t.category) || 0) + 1));
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ name: CATEGORY_LABEL[k] || k, count: v }));
  }, [tickets]);
  const answeredRate = tickets.length ? Math.round(((counts.answered + counts.closed) / tickets.length) * 100) : 0;

  return (
    <PfPage>
      <PfPageHead
        eyebrow="지원"
        title="고객센터 문의"
        desc="고객이 앱 안에서 보낸 문의를 답변합니다. 답변을 저장하면 고객에게 바로 알림이 가고 상태가 '답변완료'로 바뀝니다."
        actions={
          <>
            <OpsCompanySelect value={companyFilter} onChange={setCompanyFilter} options={companyOptions} />
            <OpsSearch value={search} onChange={setSearch} placeholder="제목·내용·회사 검색" />
            <OpsExportButton
              disabled={filtered.length === 0}
              onClick={() => exportCsv(filtered.map((t) => ({
                상태: t.status === "open" ? "미답변" : t.status === "in_progress" ? "처리중" : "답변완료", 분류: t.category,
                제목: t.subject, 내용: (t.content || "").slice(0, 200),
                회사: t.companies?.name || "", 문의자: t.users?.name || t.users?.email || "",
                접수일: t.created_at?.slice(0, 10) || "",
              })), "고객센터문의")}
            />
          </>
        }
      />

      {/* KPI 타일 */}
      <div className="pf-kpi-grid">
        <PfCard i={1} className="pf-kpi-tile"><PfKpi label="답변 기다리는 중" value={counts.open} unit="건" live={counts.open > 0} accent={counts.open > 0} /></PfCard>
        <PfCard i={2} className="pf-kpi-tile"><PfKpi label="처리중" value={counts.in_progress} unit="건" /></PfCard>
        <PfCard i={3} className="pf-kpi-tile"><PfKpi label="답변완료" value={counts.answered + counts.closed} unit="건" /></PfCard>
        <PfCard i={4} className="pf-kpi-tile"><PfKpi label="답변 완료율" value={answeredRate} unit="%" /></PfCard>
      </div>

      {/* 구성 — 상태 도넛 + 분류 막대 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PfCard i={5}>
          <PfCardHead title="상태별 구성" sub="전체 문의 기준" />
          <PfCardBody>
            <PfDonut
              size={160}
              centerLabel="전체 문의"
              slices={[
                { label: "대기", value: counts.open, color: "var(--chart-2)" },
                { label: "처리중", value: counts.in_progress, color: "var(--chart-1)" },
                { label: "답변완료", value: counts.answered, color: "var(--chart-3)" },
                { label: "종료", value: counts.closed, color: "var(--chart-5)" },
              ]}
            />
          </PfCardBody>
        </PfCard>
        <PfCard i={6}>
          <PfCardHead title="어떤 문의가 많은가" sub="분류별 건수" />
          <PfCardBody>
            <PfBars data={byCategory} series={[{ key: "count", label: "문의 수" }]} xKey="name" height={170} horizontal />
          </PfCardBody>
        </PfCard>
      </div>

      {/* 목록 */}
      <PfCard i={7} hover={false}>
        <PfCardHead
          title={<>문의 목록 {openCount > 0 && <PfBadge tone="warn">미처리 {openCount}</PfBadge>}</>}
          sub={`${filtered.length}건 표시`}
          right={<PfSeg value={filter} onChange={setFilter} options={FILTERS} />}
        />
        {isLoading ? (
          <div className="px-5 pb-5"><PfSkeleton h={18} rows={4} /></div>
        ) : filtered.length === 0 ? (
          <PfEmpty ok={filter !== "all" && filter !== "answered"}>{filter === "open" ? "답변을 기다리는 문의가 없습니다 ✓" : "문의가 없습니다"}</PfEmpty>
        ) : (
          <div className="divide-y divide-[var(--border)]/60">
            {filtered.map((t) => {
              const st = STATUS_META[t.status] || STATUS_META.open;
              const draft = drafts[t.id] ?? "";
              return (
                <div key={t.id} className="px-5 py-4">
                  <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                    <PfBadge tone={st.tone}>{st.label}</PfBadge>
                    <PfBadge tone="muted">{CATEGORY_LABEL[t.category] || t.category}</PfBadge>
                    <span className="ml-auto text-[11px] text-[var(--text-dim)] mono-number">{new Date(t.created_at).toLocaleString("ko-KR")}</span>
                  </div>
                  <div className="font-bold text-[14px] text-[var(--text)]">{t.subject}</div>
                  <div className="text-[13px] text-[var(--text-muted)] mt-1.5 leading-relaxed whitespace-pre-wrap">{t.content}</div>
                  {Array.isArray(t.attachments) && t.attachments.length > 0 && <TicketShots attachments={t.attachments} />}
                  <div className="text-[11px] text-[var(--text-dim)] mt-2.5 flex items-center gap-2 flex-wrap">
                    <span>{t.companies?.name || "—"} · {t.users?.name || t.users?.email || "—"}</span>
                    <span className="ml-auto flex items-center gap-1.5">
                      {t.status === "open" && (
                        <button
                          onClick={() => startProgressMut.mutate(t.id)}
                          disabled={startProgressMut.isPending}
                          className="pf-btn pf-btn-sm"
                          title="고객 화면의 진행 단계가 '처리중'으로 바뀝니다"
                        >
                          처리 시작
                        </button>
                      )}
                      <button
                        onClick={() => runAnalyze(t.id)}
                        disabled={analyzingId !== null}
                        className="pf-btn pf-btn-sm"
                        title="문의 본문·첨부 스크린샷·최근 에러 로그를 AI 로 대조 분석합니다"
                      >
                        {analyzingId === t.id ? "분석 중…" : t.ai_analysis ? "AI 재분석" : "AI 분석"}
                      </button>
                    </span>
                  </div>

                  {t.ai_analysis && (
                    <div className="mt-3 rounded-2xl p-4 border border-[var(--primary)]/20 bg-[var(--primary)]/5 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="text-[12px] font-bold text-[var(--primary)]">AI 진단</span>
                        {t.ai_analysis.severity && (
                          <PfBadge tone={(SEVERITY_META[t.ai_analysis.severity] || SEVERITY_META.low).tone}>
                            {(SEVERITY_META[t.ai_analysis.severity] || SEVERITY_META.low).label}
                          </PfBadge>
                        )}
                        {t.ai_analysis.needs_dev && <PfBadge tone="danger">개발 수정 필요</PfBadge>}
                        {t.ai_analysis.resolution === "simple" && !t.answer && (
                          <span title="AI 판단: 초안 검토만으로 바로 답변 가능한 간단한 건입니다 — 등록은 사람이 합니다"><PfBadge tone="ok">간단 건 — 초안 검토 후 등록</PfBadge></span>
                        )}
                        {t.ai_analysis.analyzed_at && <span className="ml-auto text-[10px] text-[var(--text-dim)]">{new Date(t.ai_analysis.analyzed_at).toLocaleString("ko-KR")}</span>}
                      </div>
                      {t.ai_analysis.summary && <div className="text-[13px] font-semibold text-[var(--text)]">{t.ai_analysis.summary}</div>}
                      {t.ai_analysis.screenshot_findings && (
                        <div className="text-[12px] text-[var(--text-muted)] leading-relaxed"><b className="text-[var(--text)]">스크린샷:</b> {t.ai_analysis.screenshot_findings}</div>
                      )}
                      {t.ai_analysis.probable_cause && (
                        <div className="text-[12px] text-[var(--text-muted)] leading-relaxed"><b className="text-[var(--text)]">추정 원인:</b> {t.ai_analysis.probable_cause}</div>
                      )}
                      {(t.ai_analysis.matched_errors || []).length > 0 && (
                        <ul className="text-[12px] text-[var(--text-muted)] leading-relaxed list-disc pl-4">
                          {t.ai_analysis.matched_errors!.map((m, i) => <li key={i}>{m}</li>)}
                        </ul>
                      )}
                      {t.ai_analysis.suggested_reply && (
                        <div className="pt-1 flex items-start gap-2">
                          <div className="text-[12px] text-[var(--text-muted)] leading-relaxed flex-1"><b className="text-[var(--text)]">답변 초안:</b> {t.ai_analysis.suggested_reply}</div>
                          <button
                            onClick={() => setDrafts((d) => ({ ...d, [t.id]: t.ai_analysis?.suggested_reply || "" }))}
                            className="pf-btn pf-btn-sm shrink-0"
                            title="답변 입력칸에 초안을 채웁니다 (검토 후 등록)"
                          >
                            초안 사용
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {t.answer && (
                    <div className="mt-3 rounded-2xl p-4 border border-[var(--success)]/25 bg-[var(--success)]/5">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[12px] font-bold text-[var(--success)]">등록된 답변</span>
                        {t.answered_at && <span className="text-[11px] text-[var(--text-dim)]">{new Date(t.answered_at).toLocaleString("ko-KR")}</span>}
                      </div>
                      <div className="text-[13px] text-[var(--text)] whitespace-pre-wrap leading-relaxed">{t.answer}</div>
                    </div>
                  )}

                  <div className="mt-3">
                    <textarea
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                      rows={3}
                      placeholder={t.answer ? "답변 수정…" : "답변을 입력하세요"}
                      className="field-input resize-y"
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={() => answerMut.mutate({ id: t.id, answer: draft })}
                        disabled={!draft.trim() || answerMut.isPending}
                        className="pf-btn pf-btn-primary pf-btn-sm"
                      >
                        {answerMut.isPending ? "저장 중…" : t.answer ? "답변 수정" : "답변 등록"}
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </PfCard>
    </PfPage>
  );
}
