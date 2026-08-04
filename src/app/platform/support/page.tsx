"use client";
import { logRead } from "@/lib/log-read";

// 플랫폼 운영자 — 고객센터 문의 답변. support_tickets 전체(전사) 조회·답변.
//   RLS: is_platform_operator() 가 모든 회사 티켓 select/update 허용.
//   답변 저장 시 트리거가 status='answered' + 사용자 알림 발송.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { OpsSearch, OpsCompanySelect, OpsExportButton, exportCsv } from "../_components/ops-kit";
import { getCurrentUser } from "@/lib/queries";

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

const SEVERITY_META: Record<string, { label: string; cls: string }> = {
  high: { label: "심각", cls: "bg-red-500/12 text-red-500" },
  medium: { label: "보통", cls: "bg-[var(--warning-dim)] text-[var(--warning)]" },
  low: { label: "낮음", cls: "bg-[var(--bg-surface)] text-[var(--text-muted)]" },
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
          className="w-28 h-28 rounded-xl overflow-hidden border border-[var(--border)] bg-[var(--bg-surface)] block"
          title="새 탭에서 크게 보기">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={u.url} alt="첨부 스크린샷" className="w-full h-full object-cover" />
        </a>
      ))}
    </div>
  );
}

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: "대기", cls: "bg-[var(--warning-dim)] text-[var(--warning)]" },
  in_progress: { label: "처리중", cls: "bg-[var(--primary)]/12 text-[var(--primary)]" },
  answered: { label: "답변완료", cls: "bg-[var(--success-dim)] text-[var(--success)]" },
  closed: { label: "종료", cls: "bg-[var(--bg-surface)] text-[var(--text-muted)]" },
};

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "open", label: "대기" },
  { key: "in_progress", label: "처리중" },
  { key: "answered", label: "답변완료" },
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

  const { data: tickets = [] } = useQuery<Ticket[]>({
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
      const { error } = await db
        .from("support_tickets")
        .update({ answer: answer.trim(), answered_by: me?.id ?? null })
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

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold text-[var(--text)]">고객센터 문의</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {openCount > 0 && <span className="px-2.5 py-1 rounded-full bg-[var(--warning-dim)] text-[var(--warning)] font-semibold">미처리 {openCount}</span>}
          <OpsCompanySelect value={companyFilter} onChange={setCompanyFilter} options={companyOptions} />
          <OpsSearch value={search} onChange={setSearch} placeholder="제목·내용·회사 검색" />
          <OpsExportButton
            disabled={filtered.length === 0}
            onClick={() => exportCsv(filtered.map((t) => ({
              상태: t.status === "open" ? "미답변" : "답변완료", 분류: t.category,
              제목: t.subject, 내용: (t.content || "").slice(0, 200),
              회사: t.companies?.name || "", 문의자: t.users?.name || t.users?.email || "",
              접수일: t.created_at?.slice(0, 10) || "",
            })), "고객센터문의")}
          />
          <div className="seg-bar">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                onClick={() => setFilter(f.key)}
                className={`seg-item ${filter === f.key ? "seg-item-active" : ""}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="platform-support-ticket-list glass-card">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">문의가 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filtered.map((t) => {
              const st = STATUS_META[t.status] || STATUS_META.open;
              const draft = drafts[t.id] ?? "";
              return (
                <div key={t.id} className="platform-support-ticket-row">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)] font-medium">{CATEGORY_LABEL[t.category] || t.category}</span>
                    <span className="ml-auto text-xs text-[var(--text-dim)]">{new Date(t.created_at).toLocaleString("ko-KR")}</span>
                  </div>
                  <div className="font-semibold text-[var(--text)]">{t.subject}</div>
                  <div className="text-sm text-[var(--text-muted)] mt-1.5 leading-relaxed whitespace-pre-wrap">{t.content}</div>
                  {Array.isArray(t.attachments) && t.attachments.length > 0 && <TicketShots attachments={t.attachments} />}
                  <div className="text-xs text-[var(--text-dim)] mt-2 flex items-center gap-2">
                    <span>{t.companies?.name || "—"} · {t.users?.name || t.users?.email || "—"}</span>
                    {t.status === "open" && (
                      <button
                        onClick={() => startProgressMut.mutate(t.id)}
                        disabled={startProgressMut.isPending}
                        className="ml-auto px-2 py-1 rounded-lg bg-[var(--warning-dim)] text-[var(--warning)] font-semibold hover:opacity-80 transition disabled:opacity-50"
                        title="고객 화면의 진행 단계가 '처리중'으로 바뀝니다"
                      >
                        처리 시작
                      </button>
                    )}
                    <button
                      onClick={() => runAnalyze(t.id)}
                      disabled={analyzingId !== null}
                      className={`px-2 py-1 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] font-semibold hover:bg-[var(--primary)]/20 transition disabled:opacity-50 ${t.status === "open" ? "" : "ml-auto"}`}
                      title="문의 본문·첨부 스크린샷·최근 에러 로그를 AI 로 대조 분석합니다"
                    >
                      {analyzingId === t.id ? "분석 중…" : t.ai_analysis ? "AI 재분석" : "AI 분석"}
                    </button>
                  </div>

                  {t.ai_analysis && (
                    <div className="mt-3 rounded-xl p-3.5 border border-[var(--primary)]/20 bg-[var(--primary)]/5 space-y-2">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold text-[var(--primary)]">AI 진단</span>
                        {t.ai_analysis.severity && (
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${(SEVERITY_META[t.ai_analysis.severity] || SEVERITY_META.low).cls}`}>
                            {(SEVERITY_META[t.ai_analysis.severity] || SEVERITY_META.low).label}
                          </span>
                        )}
                        {t.ai_analysis.needs_dev && <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-red-500/12 text-red-500">개발 수정 필요</span>}
                        {t.ai_analysis.resolution === "simple" && !t.answer && (
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-[var(--success-dim)] text-[var(--success)]" title="AI 판단: 초안 검토만으로 바로 답변 가능한 간단한 건입니다 — 등록은 사람이 합니다">간단 건 — 초안 검토 후 등록</span>
                        )}
                        {t.ai_analysis.analyzed_at && <span className="ml-auto text-[10px] text-[var(--text-dim)]">{new Date(t.ai_analysis.analyzed_at).toLocaleString("ko-KR")}</span>}
                      </div>
                      {t.ai_analysis.summary && <div className="text-sm font-semibold text-[var(--text)]">{t.ai_analysis.summary}</div>}
                      {t.ai_analysis.screenshot_findings && (
                        <div className="text-xs text-[var(--text-muted)] leading-relaxed"><b className="text-[var(--text)]">스크린샷:</b> {t.ai_analysis.screenshot_findings}</div>
                      )}
                      {t.ai_analysis.probable_cause && (
                        <div className="text-xs text-[var(--text-muted)] leading-relaxed"><b className="text-[var(--text)]">추정 원인:</b> {t.ai_analysis.probable_cause}</div>
                      )}
                      {(t.ai_analysis.matched_errors || []).length > 0 && (
                        <ul className="text-xs text-[var(--text-muted)] leading-relaxed list-disc pl-4">
                          {t.ai_analysis.matched_errors!.map((m, i) => <li key={i}>{m}</li>)}
                        </ul>
                      )}
                      {t.ai_analysis.suggested_reply && (
                        <div className="pt-1 flex items-start gap-2">
                          <div className="text-xs text-[var(--text-muted)] leading-relaxed flex-1"><b className="text-[var(--text)]">답변 초안:</b> {t.ai_analysis.suggested_reply}</div>
                          <button
                            onClick={() => setDrafts((d) => ({ ...d, [t.id]: t.ai_analysis?.suggested_reply || "" }))}
                            className="shrink-0 px-2 py-1 rounded-lg bg-[var(--bg-surface)] text-[var(--text-muted)] text-[11px] font-semibold hover:text-[var(--text)] transition"
                            title="답변 입력칸에 초안을 채웁니다 (검토 후 등록)"
                          >
                            초안 사용
                          </button>
                        </div>
                      )}
                    </div>
                  )}

                  {t.answer && (
                    <div className="platform-support-answer-block">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-[var(--success)]">등록된 답변</span>
                        {t.answered_at && <span className="text-[11px] text-[var(--text-dim)]">{new Date(t.answered_at).toLocaleString("ko-KR")}</span>}
                      </div>
                      <div className="text-sm text-[var(--text)] whitespace-pre-wrap leading-relaxed">{t.answer}</div>
                    </div>
                  )}

                  <div className="platform-support-answer-form">
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
                        className="btn-primary text-xs"
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
      </div>
    </div>
  );
}
