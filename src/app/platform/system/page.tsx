"use client";

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

export default function SystemPage() {
  const { data: companies = [] } = useQuery({
    queryKey: ["p-sys-companies"],
    queryFn: async () => {
      const { data } = await db.from("companies").select("id");
      return data || [];
    },
  });

  const { data: users = [] } = useQuery({
    queryKey: ["p-sys-users"],
    queryFn: async () => {
      const { data } = await db.from("users").select("id, role, created_at").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const { data: plans = [] } = useQuery({
    queryKey: ["p-sys-plans"],
    queryFn: async () => {
      const { data } = await db.from("subscription_plans").select("*").order("base_price", { ascending: true });
      return data || [];
    },
  });

  const roleCounts = users.reduce((acc: Record<string, number>, u: any) => {
    acc[u.role] = (acc[u.role] || 0) + 1;
    return acc;
  }, {});

  return (
    <div className="max-w-5xl">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-white">시스템 현황</h1>
        <p className="text-sm text-[#64748b] mt-1">플랫폼 리소스 및 요금제 설정</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* DB Stats */}
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-6">
          <h3 className="font-bold text-white mb-4">데이터베이스</h3>
          <div className="space-y-3">
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#0b0f1a]">
              <span className="text-sm text-[#94a3b8]">총 회사</span>
              <span className="font-bold text-white">{companies.length}</span>
            </div>
            <div className="flex justify-between items-center p-3 rounded-xl bg-[#0b0f1a]">
              <span className="text-sm text-[#94a3b8]">총 사용자</span>
              <span className="font-bold text-white">{users.length}</span>
            </div>
            {Object.entries(roleCounts).map(([role, count]) => (
              <div key={role} className="flex justify-between items-center p-3 rounded-xl bg-[#0b0f1a]">
                <span className="text-sm text-[#64748b]">  {role}</span>
                <span className="text-sm text-[#94a3b8]">{count as number}명</span>
              </div>
            ))}
          </div>
        </div>

        {/* Plans */}
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-6">
          <h3 className="font-bold text-white mb-4">요금제</h3>
          <div className="space-y-3">
            {plans.length === 0 ? (
              <div className="text-center py-8 text-sm text-[#64748b]">요금제가 없습니다</div>
            ) : (
              plans.map((p: any) => (
                <div key={p.id} className="p-4 rounded-xl bg-[#0b0f1a] border border-[#1e293b]">
                  <div className="flex items-center justify-between mb-1">
                    <span className="font-bold text-white">{p.name}</span>
                    <span className="text-sm font-bold text-blue-400">
                      ₩{(p.base_price || 0).toLocaleString()}/월
                    </span>
                  </div>
                  <div className="text-xs text-[#64748b]">
                    슬러그: {p.slug} · 좌석당 ₩{(p.per_seat_price || 0).toLocaleString()}/월
                    {p.max_deals && ` · 최대 딜 ${p.max_deals}개`}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>

        {/* Environment */}
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-6 md:col-span-2">
          <h3 className="font-bold text-white mb-4">환경 정보</h3>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { label: "프레임워크", value: "Next.js 16" },
              { label: "DB", value: "Supabase (PostgreSQL)" },
              { label: "호스팅", value: "GitHub Pages" },
              { label: "도메인", value: "www.owner-view.com" },
            ].map((item) => (
              <div key={item.label} className="p-3 rounded-xl bg-[#0b0f1a]">
                <div className="text-[10px] text-[#64748b] mb-0.5">{item.label}</div>
                <div className="text-sm font-semibold text-white">{item.value}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
