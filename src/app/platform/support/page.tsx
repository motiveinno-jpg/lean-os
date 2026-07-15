"use client";

// 플랫폼 운영자 — 고객센터 문의 답변. support_tickets 전체(전사) 조회·답변.
//   RLS: is_platform_operator() 가 모든 회사 티켓 select/update 허용.
//   답변 저장 시 트리거가 status='answered' + 사용자 알림 발송.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";

const db = supabase as any;

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
  users?: { name: string | null; email: string } | null;
  companies?: { name: string | null } | null;
};

const CATEGORY_LABEL: Record<string, string> = {
  general: "이용 문의",
  feature: "기능 제안",
  billing: "결제·구독",
  bug: "오류 신고",
  etc: "기타",
};

const STATUS_META: Record<string, { label: string; cls: string }> = {
  open: { label: "접수", cls: "bg-[var(--warning-dim)] text-[var(--warning)]" },
  answered: { label: "답변완료", cls: "bg-[var(--success-dim)] text-[var(--success)]" },
  closed: { label: "종료", cls: "bg-[var(--bg-surface)] text-[var(--text-muted)]" },
};

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "전체" },
  { key: "open", label: "미답변" },
  { key: "answered", label: "답변완료" },
];

export default function PlatformSupportPage() {
  const qc = useQueryClient();
  const [filter, setFilter] = useState("all");
  const [drafts, setDrafts] = useState<Record<string, string>>({});

  const { data: tickets = [] } = useQuery<Ticket[]>({
    queryKey: ["p-support-all"],
    queryFn: async () => {
      const { data } = await db
        .from("support_tickets")
        .select("*, users(name, email), companies(name)")
        .order("created_at", { ascending: false });
      return (data || []) as Ticket[];
    },
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

  const filtered = useMemo(
    () => tickets.filter((t) => (filter === "all" ? true : t.status === filter)),
    [tickets, filter],
  );
  const openCount = useMemo(() => tickets.filter((t) => t.status === "open").length, [tickets]);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-2xl font-extrabold text-[var(--text)]">고객센터 문의</h1>
        <div className="flex flex-wrap items-center gap-2 text-xs">
          {openCount > 0 && <span className="px-2.5 py-1 rounded-full bg-[var(--warning-dim)] text-[var(--warning)] font-semibold">미답변 {openCount}</span>}
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

      <div className="platform-support-ticket-list glass-card overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">문의가 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {filtered.map((t) => {
              const st = STATUS_META[t.status] || STATUS_META.open;
              const draft = drafts[t.id] ?? "";
              return (
                <div key={t.id} className="platform-support-ticket-row p-5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${st.cls}`}>{st.label}</span>
                    <span className="text-[11px] px-2.5 py-1 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)] font-medium">{CATEGORY_LABEL[t.category] || t.category}</span>
                    <span className="ml-auto text-xs text-[var(--text-dim)]">{new Date(t.created_at).toLocaleString("ko-KR")}</span>
                  </div>
                  <div className="font-semibold text-[var(--text)]">{t.subject}</div>
                  <div className="text-sm text-[var(--text-muted)] mt-1.5 leading-relaxed whitespace-pre-wrap">{t.content}</div>
                  <div className="text-xs text-[var(--text-dim)] mt-2">
                    {t.companies?.name || "—"} · {t.users?.name || t.users?.email || "—"}
                  </div>

                  {t.answer && (
                    <div className="platform-support-answer-block mt-3 rounded-xl bg-[var(--bg-surface)] p-3.5">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-[var(--success)]">등록된 답변</span>
                        {t.answered_at && <span className="text-[11px] text-[var(--text-dim)]">{new Date(t.answered_at).toLocaleString("ko-KR")}</span>}
                      </div>
                      <div className="text-sm text-[var(--text)] whitespace-pre-wrap leading-relaxed">{t.answer}</div>
                    </div>
                  )}

                  <div className="platform-support-answer-form mt-3">
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
