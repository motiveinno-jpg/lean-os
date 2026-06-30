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
  open: { label: "접수", cls: "bg-amber-500/20 text-amber-400" },
  answered: { label: "답변완료", cls: "bg-emerald-500/20 text-emerald-400" },
  closed: { label: "종료", cls: "bg-slate-600/30 text-slate-400" },
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
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold text-white">고객센터 문의</h1>
          <p className="text-sm text-[#64748b] mt-1">고객사 문의 접수·답변 (답변 시 사용자에게 알림 발송)</p>
        </div>
        <div className="flex gap-2 text-xs">
          {openCount > 0 && <span className="px-2.5 py-1 rounded-lg bg-amber-500/20 text-amber-400 font-semibold">미답변 {openCount}</span>}
        </div>
      </div>

      <div className="flex gap-1.5 mb-4">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${filter === f.key ? "bg-blue-600 text-white" : "bg-[#111827] text-[#64748b] hover:text-white border border-[#1e293b]"}`}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="bg-[#111827] rounded-2xl border border-[#1e293b] overflow-hidden">
        {filtered.length === 0 ? (
          <div className="text-center py-16 text-sm text-[#64748b]">문의가 없습니다</div>
        ) : (
          <div className="divide-y divide-[#1e293b]">
            {filtered.map((t) => {
              const st = STATUS_META[t.status] || STATUS_META.open;
              const draft = drafts[t.id] ?? "";
              return (
                <div key={t.id} className="p-5">
                  <div className="flex items-center gap-2 mb-1.5">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${st.cls}`}>{st.label}</span>
                    <span className="text-xs px-2 py-0.5 rounded bg-[#1e293b] text-[#94a3b8] font-medium">{CATEGORY_LABEL[t.category] || t.category}</span>
                    <span className="ml-auto text-xs text-[#64748b]">{new Date(t.created_at).toLocaleString("ko-KR")}</span>
                  </div>
                  <div className="font-semibold text-white">{t.subject}</div>
                  <div className="text-sm text-[#94a3b8] mt-1.5 leading-relaxed whitespace-pre-wrap">{t.content}</div>
                  <div className="text-xs text-[#64748b] mt-2">
                    {t.companies?.name || "—"} · {t.users?.name || t.users?.email || "—"}
                  </div>

                  {t.answer && (
                    <div className="mt-3 rounded-xl bg-[#0b0f1a] border border-[#1e293b] p-3.5">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-bold text-emerald-400">등록된 답변</span>
                        {t.answered_at && <span className="text-[11px] text-[#64748b]">{new Date(t.answered_at).toLocaleString("ko-KR")}</span>}
                      </div>
                      <div className="text-sm text-white whitespace-pre-wrap leading-relaxed">{t.answer}</div>
                    </div>
                  )}

                  <div className="mt-3">
                    <textarea
                      value={draft}
                      onChange={(e) => setDrafts((d) => ({ ...d, [t.id]: e.target.value }))}
                      rows={3}
                      placeholder={t.answer ? "답변 수정…" : "답변을 입력하세요"}
                      className="w-full px-3 py-2.5 bg-[#0b0f1a] border border-[#1e293b] rounded-xl text-sm text-white placeholder-[#64748b] focus:outline-none focus:border-blue-500 resize-y"
                    />
                    <div className="flex justify-end mt-2">
                      <button
                        onClick={() => answerMut.mutate({ id: t.id, answer: draft })}
                        disabled={!draft.trim() || answerMut.isPending}
                        className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white text-xs font-semibold transition"
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
