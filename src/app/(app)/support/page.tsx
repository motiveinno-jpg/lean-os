"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

// 고객센터 — 사용자가 문의를 등록하고, 내가 보낸 문의·운영자 답변을 확인하는 화면.
//   문의 저장: support_tickets (company 스코프 RLS). 답변은 운영자(/platform/support)가 작성.
//   답변이 등록되면 트리거가 status='answered' + 알림 발송 → 사용자는 여기서 답변 확인.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { friendlyError, reportError } from "@/lib/friendly-error";

const db = supabase;

type Ticket = {
  id: string;
  category: string;
  subject: string;
  content: string;
  status: "open" | "answered" | "closed" | string;
  answer: string | null;
  answered_at: string | null;
  created_at: string;
};

const CATEGORIES: { key: string; label: string }[] = [
  { key: "general", label: "이용 문의" },
  { key: "feature", label: "기능 제안" },
  { key: "billing", label: "결제·구독" },
  { key: "bug", label: "오류 신고" },
  { key: "etc", label: "기타" },
];
const catLabel = (k: string) => CATEGORIES.find((c) => c.key === k)?.label || "기타";

const STATUS_META: Record<string, { label: string; color: string }> = {
  open: { label: "접수됨", color: "var(--warning)" },
  answered: { label: "답변 완료", color: "var(--success)" },
  closed: { label: "종료", color: "var(--text-dim)" },
};

const fmtDate = (s: string) => {
  const d = new Date(s);
  return `${kstDateStr(d)} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

export default function SupportPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const { toast } = useToast();
  const qc = useQueryClient();

  const [category, setCategory] = useState("general");
  const [subject, setSubject] = useState("");
  const [content, setContent] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);

  const { data: tickets = [], isLoading } = useQuery<Ticket[]>({
    queryKey: ["support-tickets", userId],
    queryFn: async () => {
      const data = logRead('support/page:data', await db
        .from("support_tickets")
        .select("id, category, subject, content, status, answer, answered_at, created_at")
        .eq("user_id", userId ?? "")
        .order("created_at", { ascending: false }));
      return (data || []) as Ticket[];
    },
    enabled: !!userId,
  });

  const submitMut = useMutation({
    mutationFn: async () => {
      const { error } = await db.from("support_tickets").insert({
        company_id: companyId as string,
        user_id: userId as string,
        category,
        subject: subject.trim(),
        content: content.trim(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast("문의가 접수되었습니다. 답변이 등록되면 알림으로 알려드립니다.", "success");
      setSubject("");
      setContent("");
      setCategory("general");
      qc.invalidateQueries({ queryKey: ["support-tickets", userId] });
    },
    onError: (e) => {
      reportError("support.submit", e);
      toast(friendlyError(e, "문의 접수에 실패했습니다"), "error");
    },
  });

  const canSubmit = subject.trim().length > 0 && content.trim().length > 0 && !submitMut.isPending;

  const answeredCount = useMemo(() => tickets.filter((t) => t.status === "answered").length, [tickets]);

  return (
    <div>
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] gap-5 items-start">
        {/* 문의 작성 */}
        <div className="glass-card p-5 sm:p-6">
          <div className="text-[11px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">CONTACT</div>
          <div className="text-sm font-bold text-[var(--text)] mb-4">문의하기</div>
          <div className="space-y-3.5">
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">문의 유형</label>
              <div className="flex flex-wrap gap-1.5">
                {CATEGORIES.map((c) => (
                  <button
                    key={c.key}
                    type="button"
                    onClick={() => setCategory(c.key)}
                    className={`px-3 py-1.5 text-[12px] font-semibold rounded-full border transition ${category === c.key ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"}`}
                  >
                    {c.label}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">제목 <span className="text-red-500">*</span></label>
              <input
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                maxLength={120}
                placeholder="문의 제목을 입력하세요"
                className="field-input"
              />
            </div>
            <div>
              <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">내용 <span className="text-red-500">*</span></label>
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={7}
                placeholder="문의 내용을 자세히 적어주시면 더 정확히 답변드릴 수 있습니다."
                className="field-input resize-y"
              />
            </div>
            <button
              type="button"
              disabled={!canSubmit}
              onClick={() => submitMut.mutate()}
              className="btn-primary w-full active:scale-[0.99]"
            >
              {submitMut.isPending ? "접수 중…" : "문의 접수"}
            </button>
            <p className="text-[11px] text-[var(--text-dim)] leading-relaxed">
              접수된 문의와 답변은 오른쪽 <b className="text-[var(--text-muted)]">내 문의 내역</b>에서 확인할 수 있습니다. 답변 등록 시 알림으로 안내드립니다.
            </p>
          </div>
        </div>

        {/* 내 문의 내역 */}
        <div className="glass-card p-5 sm:p-6">
          <div className="text-[11px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">HISTORY</div>
          <div className="flex items-center justify-between mb-4">
            <div className="text-sm font-bold text-[var(--text)]">내 문의 내역</div>
            <div className="text-[11px] text-[var(--text-muted)]">
              전체 {tickets.length}건{answeredCount > 0 && <span className="text-emerald-500 font-semibold"> · 답변 {answeredCount}건</span>}
            </div>
          </div>

          {isLoading ? (
            <div className="text-sm text-[var(--text-muted)] py-8 text-center">불러오는 중…</div>
          ) : tickets.length === 0 ? (
            <div className="text-center py-14">
              <div className="text-4xl mb-3">💬</div>
              <div className="text-sm font-semibold text-[var(--text)]">아직 등록한 문의가 없습니다.</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-1.5">왼쪽에서 첫 문의를 남겨보세요.</div>
            </div>
          ) : (
            <div className="space-y-2.5">
              {tickets.map((t) => {
                const st = STATUS_META[t.status] || STATUS_META.open;
                const expanded = openId === t.id;
                return (
                  <div key={t.id} className="rounded-xl border border-[var(--border)] overflow-hidden">
                    <button
                      type="button"
                      onClick={() => setOpenId(expanded ? null : t.id)}
                      className="w-full text-left px-4 py-3 hover:bg-[var(--bg-surface)]/50 transition"
                    >
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]">{catLabel(t.category)}</span>
                        <span
                          className="text-[10px] font-bold px-1.5 py-0.5 rounded-full"
                          style={{ color: st.color, background: `color-mix(in srgb, ${st.color} 12%, transparent)` }}
                        >
                          {st.label}
                        </span>
                        <span className="ml-auto text-[10px] text-[var(--text-dim)] mono-number">{fmtDate(t.created_at)}</span>
                      </div>
                      <div className="text-sm font-semibold text-[var(--text)] truncate">{t.subject}</div>
                    </button>
                    {expanded && (
                      <div className="px-4 pb-4 pt-1 border-t border-[var(--border)]">
                        <div className="text-[12px] text-[var(--text-muted)] whitespace-pre-wrap leading-relaxed py-2">{t.content}</div>
                        {t.answer ? (
                          <div className="mt-2 rounded-xl p-3.5" style={{ background: "color-mix(in srgb, var(--primary) 6%, transparent)", border: "1px solid color-mix(in srgb, var(--primary) 18%, transparent)" }}>
                            <div className="flex items-center gap-1.5 mb-1.5">
                              <span className="text-[11px] font-bold text-[var(--primary)]">운영팀 답변</span>
                              {t.answered_at && <span className="text-[10px] text-[var(--text-dim)] mono-number">{fmtDate(t.answered_at)}</span>}
                            </div>
                            <div className="text-[12.5px] text-[var(--text)] whitespace-pre-wrap leading-relaxed">{t.answer}</div>
                          </div>
                        ) : (
                          <div className="mt-2 text-[11px] text-[var(--text-dim)] bg-[var(--bg-surface)]/50 rounded-lg px-3 py-2">
                            아직 답변이 등록되지 않았습니다. 운영팀이 확인 중입니다.
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
