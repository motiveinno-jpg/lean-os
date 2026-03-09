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
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-white">추천 프로그램</h1>
        <p className="text-sm text-[#64748b] mt-1">레퍼럴 코드 관리 및 실적</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-5">
          <div className="text-xs text-[#64748b] mb-1">총 추천 코드</div>
          <div className="text-2xl font-extrabold text-white">{referrals.length}개</div>
        </div>
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-5">
          <div className="text-xs text-[#64748b] mb-1">총 추천 가입</div>
          <div className="text-2xl font-extrabold text-blue-400">{totalReferred}명</div>
        </div>
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-5">
          <div className="text-xs text-[#64748b] mb-1">총 지급 크레딧</div>
          <div className="text-2xl font-extrabold text-purple-400">{fmtW(totalCredit)}</div>
        </div>
      </div>

      <div className="bg-[#111827] rounded-2xl border border-[#1e293b] overflow-hidden">
        <div className="p-5 border-b border-[#1e293b]">
          <h3 className="font-bold text-white">추천인 랭킹</h3>
        </div>
        {referrals.length === 0 ? (
          <div className="text-center py-16 text-sm text-[#64748b]">추천 코드가 없습니다</div>
        ) : (
          <div className="divide-y divide-[#1e293b]">
            {referrals.map((r: any, i: number) => (
              <div key={r.id} className="flex items-center justify-between p-4 hover:bg-[#1e293b]/50 transition">
                <div className="flex items-center gap-3">
                  <div className={`w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold ${
                    i === 0 ? "bg-yellow-500/20 text-yellow-400" :
                    i === 1 ? "bg-gray-500/20 text-gray-400" :
                    i === 2 ? "bg-amber-500/20 text-amber-400" :
                    "bg-[#1e293b] text-[#64748b]"
                  }`}>
                    {i + 1}
                  </div>
                  <div>
                    <div className="font-semibold text-sm text-white">{r.companies?.name || "알 수 없음"}</div>
                    <div className="text-xs font-mono text-[#64748b]">{r.code}</div>
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-bold text-sm text-white">{r.referred_count || 0}명</div>
                  <div className="text-xs text-[#64748b]">{fmtW(r.credit_earned || 0)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
