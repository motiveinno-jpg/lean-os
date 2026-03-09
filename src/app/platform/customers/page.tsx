"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  trialing: { bg: "bg-blue-500/20", text: "text-blue-400", label: "체험중" },
  active: { bg: "bg-emerald-500/20", text: "text-emerald-400", label: "활성" },
  past_due: { bg: "bg-yellow-500/20", text: "text-yellow-400", label: "미납" },
  canceled: { bg: "bg-red-500/20", text: "text-red-400", label: "해지" },
  paused: { bg: "bg-gray-500/20", text: "text-gray-400", label: "일시중지" },
};

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: companies = [] } = useQuery({
    queryKey: ["p-companies-detail"],
    queryFn: async () => {
      const { data } = await db.from("companies").select("*, users(count), subscriptions(*, subscription_plans(*))").order("created_at", { ascending: false });
      return data || [];
    },
  });

  const filtered = companies.filter((c: any) => {
    if (search && !c.name?.toLowerCase().includes(search.toLowerCase())) return false;
    if (statusFilter !== "all") {
      const sub = c.subscriptions?.[0];
      if (statusFilter === "free" && sub?.subscription_plans?.slug !== "free" && sub) return false;
      if (statusFilter === "paid" && (!sub || sub.subscription_plans?.slug === "free")) return false;
    }
    return true;
  });

  return (
    <div className="max-w-6xl">
      <div className="mb-8">
        <h1 className="text-2xl font-extrabold text-white">고객사 관리</h1>
        <p className="text-sm text-[#64748b] mt-1">전체 가입 고객사 현황</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="회사명 검색..."
          className="w-full max-w-sm px-4 py-2.5 bg-[#111827] border border-[#1e293b] rounded-xl text-sm text-white placeholder-[#64748b] focus:outline-none focus:border-blue-500"
        />
        <div className="flex gap-1">
          {[
            { key: "all", label: "전체" },
            { key: "paid", label: "유료" },
            { key: "free", label: "무료" },
          ].map((f) => (
            <button
              key={f.key}
              onClick={() => setStatusFilter(f.key)}
              className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                statusFilter === f.key ? "bg-blue-600 text-white" : "bg-[#1e293b] text-[#94a3b8] hover:text-white"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      <div className="text-xs text-[#64748b] mb-3">{filtered.length}개 고객사</div>

      {/* Table */}
      <div className="bg-[#111827] rounded-2xl border border-[#1e293b] overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-[#1e293b]">
                <th className="text-left px-5 py-3.5 font-semibold text-[#64748b]">회사</th>
                <th className="text-left px-5 py-3.5 font-semibold text-[#64748b]">플랜</th>
                <th className="text-left px-5 py-3.5 font-semibold text-[#64748b]">상태</th>
                <th className="text-center px-5 py-3.5 font-semibold text-[#64748b]">좌석</th>
                <th className="text-left px-5 py-3.5 font-semibold text-[#64748b]">가입일</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1e293b]">
              {filtered.map((c: any) => {
                const sub = c.subscriptions?.[0];
                const plan = sub?.subscription_plans;
                const st = STATUS_COLORS[sub?.status || "trialing"] || STATUS_COLORS.trialing;
                return (
                  <tr key={c.id} className="hover:bg-[#1e293b]/50 transition">
                    <td className="px-5 py-3.5">
                      <div className="font-semibold text-white">{c.name}</div>
                      {c.industry && <div className="text-xs text-[#64748b]">{c.industry}</div>}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                        plan?.slug === "business" || plan?.slug === "pro" ? "bg-purple-500/20 text-purple-400" :
                        plan?.slug === "starter" ? "bg-blue-500/20 text-blue-400" :
                        "bg-[#1e293b] text-[#64748b]"
                      }`}>
                        {plan?.name || c.current_plan || "Free"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2 py-0.5 rounded text-xs font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
                    </td>
                    <td className="px-5 py-3.5 text-center text-[#94a3b8]">{sub?.seat_count || 1}명</td>
                    <td className="px-5 py-3.5 text-[#94a3b8]">{new Date(c.created_at).toLocaleDateString("ko-KR")}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-[#64748b]">검색 결과가 없습니다</div>
        )}
      </div>
    </div>
  );
}
