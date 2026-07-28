"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { OpsPageHeader, OpsSearch, OpsExportButton, exportCsv } from "../_components/ops-kit";

const db = supabase;

// 회사의 구독 배열에서 "가장 최근" 구독을 고른다 — 쿼리에 정렬이 없어 [0]이 최신이 아닐 수 있으므로
//   created_at 내림차순으로 골라 오래된(canceled) 구독이 표시되는 것을 방지.
function latestSub(company: any): any {
  const subs = company?.subscriptions;
  if (!Array.isArray(subs) || subs.length === 0) return undefined;
  return [...subs].sort(
    (a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime(),
  )[0];
}

const STATUS_COLORS: Record<string, { bg: string; text: string; label: string }> = {
  trialing: { bg: "bg-[var(--info-dim)]", text: "text-[var(--info)]", label: "체험중" },
  active: { bg: "bg-[var(--success-dim)]", text: "text-[var(--success)]", label: "활성" },
  past_due: { bg: "bg-[var(--warning-dim)]", text: "text-[var(--warning)]", label: "미납" },
  canceled: { bg: "bg-[var(--danger-dim)]", text: "text-[var(--danger)]", label: "해지" },
  paused: { bg: "bg-[var(--bg-surface)]", text: "text-[var(--text-muted)]", label: "일시중지" },
};

export default function CustomersPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: companies = [] } = useQuery({
    queryKey: ["p-companies-detail"],
    queryFn: async () => {
      const data = logRead('customers/page:data', await db.from("companies").select("*, users(count), subscriptions(*, subscription_plans(*))").order("created_at", { ascending: false }));
      return data || [];
    },
    refetchInterval: 60_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies.filter((c: any) => {
      // 회사명 + 사업자번호로 검색 (2026-07-28 전면 정비)
      if (q && !c.name?.toLowerCase().includes(q) && !String(c.business_number || "").includes(q)) return false;
      if (statusFilter !== "all") {
        const sub = latestSub(c);
        if (statusFilter === "free" && sub?.subscription_plans?.slug !== "free" && sub) return false;
        if (statusFilter === "paid" && (!sub || sub.subscription_plans?.slug === "free")) return false;
      }
      return true;
    });
  }, [companies, search, statusFilter]);

  return (
    <div className="max-w-6xl space-y-6">
      <OpsPageHeader title="고객사 관리" sub="전체 가입사 · 1분마다 자동 갱신 · 행을 누르면 상세로 이동합니다">
        <div className="flex flex-wrap items-center gap-2">
          <OpsSearch value={search} onChange={setSearch} placeholder="회사명·사업자번호 검색" />
          <OpsExportButton
            disabled={filtered.length === 0}
            onClick={() => exportCsv(filtered.map((c: any) => {
              const sub = latestSub(c);
              return {
                회사명: c.name || "", 사업자번호: c.business_number || "",
                플랜: sub?.subscription_plans?.name || "미구독",
                상태: sub ? (STATUS_COLORS[sub.status]?.label || sub.status) : "미구독",
                인원: c.users?.[0]?.count ?? 0, 좌석: sub?.seat_count || 1,
                가입일: kstDateStr(new Date(c.created_at)),
              };
            }), "고객사목록")}
          />
          <div className="seg-bar">
            {[
              { key: "all", label: "전체" },
              { key: "paid", label: "유료" },
              { key: "free", label: "미구독" },
            ].map((f) => (
              <button
                key={f.key}
                onClick={() => setStatusFilter(f.key)}
                className={`seg-item ${statusFilter === f.key ? "seg-item-active" : ""}`}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
      </OpsPageHeader>

      <div className="text-xs text-[var(--text-dim)]">{filtered.length}개 고객사</div>

      {/* Table */}
      <div className="platform-customers-table glass-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-head-row">
                <th className="th-cell text-left">회사</th>
                <th className="th-cell text-left">플랜</th>
                <th className="th-cell text-left">상태</th>
                <th className="th-cell text-center">좌석</th>
                <th className="th-cell text-left">가입일</th>
                <th className="th-cell"></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((c: any) => {
                const sub = latestSub(c);
                const plan = sub?.subscription_plans;
                // 체험 만료(게이트에서 차단 중)인데 status 가 trialing 으로 남아 '체험중'으로 보이던 것 정정
                const trialExpired = sub?.status === "trialing" && sub?.trial_ends_at && new Date(sub.trial_ends_at).getTime() < Date.now();
                // 2026-07-28: 구독이 아예 없는 회사가 폴백 기본값 때문에 '체험중'으로 표시되던 버그 —
                //   미구독으로 정확히 표기 (무료 vs 체험 혼동의 원인)
                const st = !sub
                  ? { bg: "bg-[var(--bg-surface)]", text: "text-[var(--text-dim)]", label: "미구독" }
                  : trialExpired
                  ? { bg: "bg-[var(--danger-dim)]", text: "text-[var(--danger)]", label: "체험만료" }
                  : STATUS_COLORS[sub.status] || { bg: "bg-[var(--bg-surface)]", text: "text-[var(--text-muted)]", label: sub.status };
                return (
                  <tr
                    key={c.id}
                    onClick={() => router.push(`/platform/companies/${c.id}`)}
                    className="platform-customer-row"
                  >
                    <td className="px-5 py-3.5 max-w-[280px]">
                      <div className="font-semibold text-[var(--text)] truncate">{c.name}</div>
                      {c.industry ? (
                        <div className="text-xs text-[var(--text-dim)] truncate">{c.industry}</div>
                      ) : (
                        <div className="text-xs text-[var(--warning)]">업종 미분류</div>
                      )}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${
                        plan?.slug === "business" || plan?.slug === "pro" ? "bg-[var(--primary-light)] text-[var(--primary)]" :
                        plan?.slug === "starter" ? "bg-[var(--info-dim)] text-[var(--info)]" :
                        "bg-[var(--bg-surface)] text-[var(--text-muted)]"
                      }`}>
                        {plan?.name || c.current_plan || "Free"}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`px-2.5 py-1 rounded-full text-[11px] font-semibold ${st.bg} ${st.text}`}>{st.label}</span>
                    </td>
                    <td className="px-5 py-3.5 text-center text-[var(--text-muted)]">{sub?.seat_count || 1}명</td>
                    <td className="px-5 py-3.5 text-[var(--text-muted)]">{kstDateStr(new Date(c.created_at))}</td>
                    <td className="px-5 py-3.5 text-right">
                      <Link
                        href={`/platform/companies/${c.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="text-xs text-[var(--primary)] hover:underline"
                      >
                        상세 →
                      </Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {filtered.length === 0 && (
          <div className="text-center py-12 text-sm text-[var(--text-dim)]">검색 결과가 없습니다</div>
        )}
      </div>
    </div>
  );
}
