"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

function fmtW(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e4) return `₩${Math.round(abs / 1e4).toLocaleString()}만`;
  return `₩${abs.toLocaleString()}`;
}

export default function ReferralPage() {
  const { data: referrals = [] } = useQuery({
    queryKey: ["p-referrals"],
    queryFn: async () => {
      const { data } = await db.from("referral_codes").select("*, companies(name)").order("referred_count", { ascending: false });
      return data || [];
    },
  });

  const totalReferred = referrals.reduce((s: number, r: any) => s + (r.referred_count || 0), 0);
  const totalCredit = referrals.reduce((s: number, r: any) => s + (r.credit_earned || 0), 0);

  return (
    <div className="max-w-5xl space-y-6">
      <div className="platform-referral-header">
        <h1 className="text-2xl font-extrabold text-[var(--text)]">추천 프로그램</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">레퍼럴 코드 관리 및 실적</p>
      </div>

      <div className="platform-referral-kpi-grid grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="platform-referral-kpi-card glass-card p-5 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">총 추천 코드</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{referrals.length}개</span>
        </div>
        <div className="platform-referral-kpi-card glass-card p-5 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">총 추천 가입</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--info)]">{totalReferred}명</span>
        </div>
        <div className="platform-referral-kpi-card glass-card p-5 flex flex-col gap-3">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">총 지급 크레딧</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--primary)]">{fmtW(totalCredit)}</span>
        </div>
      </div>

      <div className="platform-referral-ranking glass-card overflow-hidden">
        <div className="p-5 border-b border-[var(--border)]">
          <h3 className="font-bold text-[var(--text)]">추천인 랭킹</h3>
        </div>
        {referrals.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">추천 코드가 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {referrals.map((r: any, i: number) => (
              <div key={r.id} className="platform-referral-row flex items-center justify-between p-4 hover:bg-[var(--bg-surface)]/60 transition">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    i === 0 ? "bg-[var(--warning-dim)] text-[var(--warning)]" :
                    i === 1 ? "bg-[var(--bg-surface)] text-[var(--text-muted)]" :
                    i === 2 ? "bg-[var(--primary-light)] text-[var(--primary)]" :
                    "bg-[var(--bg-surface)] text-[var(--text-dim)]"
                  }`}>
                    {i + 1}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-[var(--text)]">{r.companies?.name || "알 수 없음"}</div>
                    <div className="text-xs font-mono text-[var(--text-dim)]">{r.code}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm mono-number text-[var(--text)]">{r.referred_count || 0}명</div>
                  <div className="text-xs text-[var(--text-dim)]">{fmtW(r.credit_earned || 0)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
