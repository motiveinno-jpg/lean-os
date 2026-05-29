"use client";

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

// 전자결재 빠른작성 카드 — 직원/관리자 공통. 본인 결재 대기 건수 배지 포함.
export function QuickApprovalCard({ companyId, userId }: { companyId: string; userId: string }) {
  const { data: pending = 0 } = useQuery({
    queryKey: ["quick-approval-pending", companyId, userId],
    queryFn: async () => {
      try {
        const [{ count: docCount }, { count: payCount }] = await Promise.all([
          db.from("doc_approvals").select("id", { count: "exact", head: true })
            .eq("approver_id", userId).eq("status", "pending"),
          db.from("payment_queue").select("id", { count: "exact", head: true })
            .eq("company_id", companyId).eq("status", "pending"),
        ]);
        return (docCount ?? 0) + (payCount ?? 0);
      } catch {
        return 0;
      }
    },
    enabled: !!companyId && !!userId,
    refetchInterval: 30_000,
  });

  return (
    <div className="glass-card p-5 md:p-6">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-violet-500" />
          <span className="text-sm font-bold text-[var(--text)]">전자결재</span>
          {pending > 0 && (
            <span className="inline-flex items-center justify-center min-w-[20px] h-5 px-1.5 rounded-full bg-violet-500/15 text-violet-500 text-[10px] font-bold">
              {pending}건 대기
            </span>
          )}
        </div>
        <Link href="/approvals" className="text-[10px] text-[var(--text-dim)] hover:text-[var(--primary)] transition">
          모두 보기 →
        </Link>
      </div>

      <div className="mb-4 text-xs text-[var(--text-dim)]">자주 사용하는 결재를 빠르게 작성하세요</div>

      {/* 4개 항목 일관 정렬 — 이모지 고정 박스(w-9 h-9) + 동일 카드 높이(min-h-[60px]) + 텍스트 leading 통일. */}
      <div className="grid grid-cols-2 gap-2 mb-3 items-stretch">
        <Link href="/approvals?new=expense"
          className="flex items-center gap-2.5 min-h-[60px] px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-emerald-500/40 transition">
          <span className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center bg-emerald-500/10 text-base leading-none">💳</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-[var(--text)] leading-tight truncate">경비 청구</div>
            <div className="text-[10px] text-[var(--text-dim)] leading-tight mt-0.5 truncate">영수증 첨부 + 승인</div>
          </div>
        </Link>
        <Link href="/approvals?new=payment"
          className="flex items-center gap-2.5 min-h-[60px] px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-blue-500/40 transition">
          <span className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center bg-blue-500/10 text-base leading-none">📝</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-[var(--text)] leading-tight truncate">지출 결의서</div>
            <div className="text-[10px] text-[var(--text-dim)] leading-tight mt-0.5 truncate">자금 집행 결재</div>
          </div>
        </Link>
        <Link href="/leave?new=1"
          className="flex items-center gap-2.5 min-h-[60px] px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-orange-500/40 transition">
          <span className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center bg-orange-500/10 text-base leading-none">🏖</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-[var(--text)] leading-tight truncate">연차 신청</div>
            <div className="text-[10px] text-[var(--text-dim)] leading-tight mt-0.5 truncate">휴가 · 반차 · 특별휴가</div>
          </div>
        </Link>
        <Link href="/approvals?new=general"
          className="flex items-center gap-2.5 min-h-[60px] px-3 py-2.5 rounded-xl bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] border border-[var(--border)] hover:border-violet-500/40 transition">
          <span className="w-9 h-9 shrink-0 rounded-lg flex items-center justify-center bg-violet-500/10 text-base leading-none">📋</span>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-bold text-[var(--text)] leading-tight truncate">일반 결재</div>
            <div className="text-[10px] text-[var(--text-dim)] leading-tight mt-0.5 truncate">사유서 · 품의서 등</div>
          </div>
        </Link>
      </div>

      <div className="text-[10px] text-[var(--text-dim)] pt-3 border-t border-[var(--border)]">
        💡 항목 클릭 → 결재 페이지에서 양식 작성 → 승인자 지정 → 결재 요청 발송
      </div>
    </div>
  );
}
