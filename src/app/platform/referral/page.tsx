"use client";
import { logRead } from "@/lib/log-read";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase;

function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}₩${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}₩${abs.toLocaleString()}`;
}

export default function ReferralPage() {
  const { data: referrals = [] } = useQuery({
    queryKey: ["p-referrals"],
    queryFn: async () => {
      const data = logRead('referral/page:data', await db.from("referral_codes").select("*, companies(name)").order("referred_count", { ascending: false }));
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

      <div className="platform-referral-kpi-grid">
        <div className="platform-referral-kpi-card glass-card">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">총 추천 코드</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--text)]">{referrals.length}개</span>
        </div>
        <div className="platform-referral-kpi-card glass-card">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">총 추천 가입</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--info)]">{totalReferred}명</span>
        </div>
        <div className="platform-referral-kpi-card glass-card">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">총 지급 크레딧</span>
          <span className="text-[26px] leading-8 font-extrabold mono-number text-[var(--primary)]">{fmtW(totalCredit)}</span>
        </div>
      </div>

      <div className="platform-referral-ranking glass-card">
        <div className="p-5 border-b border-[var(--border)]">
          <h3 className="font-bold text-[var(--text)]">추천인 랭킹</h3>
        </div>
        {referrals.length === 0 ? (
          <div className="text-center py-16 text-sm text-[var(--text-dim)]">추천 코드가 없습니다</div>
        ) : (
          <div className="divide-y divide-[var(--border)]">
            {referrals.map((r: any, i: number) => (
              <div key={r.id} className="platform-referral-row">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    i === 0 ? "bg-[var(--warning-dim)] text-[var(--warning)]" :
                    i === 1 ? "bg-[var(--bg-surface)] text-[var(--text-muted)]" :
                    i === 2 ? "bg-[var(--primary-light)] text-[var(--primary)]" :
                    "bg-[var(--bg-surface)] text-[var(--text-dim)]"
                  }`}>
                    {i + 1}
                  </div>
                  <div className="min-w-0">
                    <div className="font-semibold text-sm text-[var(--text)] truncate">{r.companies?.name || "알 수 없음"}</div>
                    <div className="text-xs font-mono text-[var(--text-dim)] truncate">{r.code}</div>
                  </div>
                </div>
                <div className="text-right shrink-0 pl-3">
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
