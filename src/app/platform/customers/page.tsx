"use client";
import { kstDateStr } from "@/lib/kst";
import { fetchPaged } from "@/lib/fetch-paged";

// 고객사 관리 · 운영자 페이지 v2 (2026-09-03): 구성 도넛 + 표. 조회·필터·내보내기 동작은 종전 그대로.

import  { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { OpsSearch, exportCsv } from "../_components/ops-kit";
import { dropTestCompanies, loadTestCompanyIds } from "../_components/test-companies";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfSeg, PfSkeleton, PfState } from "@/app/platform/_components/pf/ui";
import { planOf, type PlanKind } from "@/app/platform/_components/plan-kind";
import { kstMonthKey, kstMonthsBack } from "@/app/platform/_components/kst-bucket";
import { PfDonut, PfBars }  from "@/app/platform/_components/pf/charts";

const db = supabase;

// 회사의 구독 배열에서 "가장 최근" 구독을 고른다. 쿼리에 정렬이 없어 [0]이 최신이 아닐 수 있으므로
//   created_at 내림차순으로 골라 오래된(canceled) 구독이 표시되는 것을 방지.
function latestSub(company: any): any  {
  const subs = company?.subscriptions;
  if (!Array.isArray(subs) || subs.length === 0) return undefined;
  return [...subs].sort(
    (a, b) => new Date(b?.created_at || 0).getTime() - new Date(a?.created_at || 0).getTime(),
  )[0];
}

type Tone = "ok" | "warn" | "danger" | "info" | "muted";
const STATUS_META: Record<string, { tone: Tone; label: string }> = {
  trialing: { tone: "info", label: "체험중" },
  active: { tone: "ok", label: "활성" },
  past_due: { tone: "warn", label: "미납" },
  canceled: { tone: "danger", label: "해지" },
  paused: { tone: "muted", label: "일시중지" },
};

// 이용 등급(planOf) → 구성 도넛 라벨·색 (운영자 개요의 고객 구성 도넛과 같은 색)
const KIND_META: Record<PlanKind, { label: string; color: string }> = {
  paid: { label: "유료", color: "var(--success)" },
  trial: { label: "체험 중", color: "var(--chart-2)" },
  expired: { label: "체험 만료", color: "var(--danger)" },
  past_due: { label: "미납", color: "var(--chart-4)" },
  granted: { label: "무상 이용", color: "var(--chart-1)" },
  free: { label: "미구독", color: "var(--chart-5)" },
};

/** 표의 '상태' 칸 — 가장 최근 구독의 상태(해지·일시중지 포함)를 그대로 보여 준다. 유료·미구독 판정은 planOf. */
function statusOf(c: any):  { tone: Tone; label: string; key: string } {
  const sub = latestSub(c);
  if (!sub) return { tone: "muted", label: "미구독", key: "none" };
  // 체험 만료(게이트에서 차단 중)인데 status 가 trialing 으로 남아 '체험중'으로 보이던 것 정정
  const trialExpired = sub.status === "trialing" && sub.trial_ends_at && new Date(sub.trial_ends_at).getTime() < Date.now();
  if (trialExpired) return { tone: "danger", label: "체험만료", key: "expired" };
  const m = STATUS_META[sub.status];
  return m ? { ...m, key: sub.status } : { tone: "muted", label: sub.status, key: sub.status };
}

export default function CustomersPage() {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const { data: companies = [], isLoading, error: loadError, refetch } = useQuery({
    queryKey: ["p-companies-detail"],
    queryFn: async () => {
      // 전체 회사 — 1,000행 상한에 잘리지 않게 끝까지 넘겨 받는다
      const data = await fetchPaged<any>("customers/page:data", () => db.from("companies").select("*, users!users_company_id_fkey(count), subscriptions(*, subscription_plans(*))").order("created_at", { ascending: false }).order("id"), 100000, { strict: true });
      // 테스트 회사(자동 QA)는 목록·숫자에서 뺀다 — 회사 상세는 주소로 직접 열면 그대로 보인다
      return dropTestCompanies(data, (c: any) => c.id);
    },
    refetchInterval: 60_000,
  });
  const { data: hiddenTestCount = 0 } = useQuery({
    queryKey: ["p-test-company-count"],
    queryFn: async () => (await loadTestCompanyIds()).size,
    staleTime: 5 * 60_000,
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return companies.filter((c: any) => {
      // 회사명 + 사업자번호로 검색 (2026-07-28 전면 정비)
      if (q && !c.name?.toLowerCase().includes(q) && !String(c.business_number || "").includes(q)) return false;
      // 유료·미구독 판정은 운영자 개요와 같은 planOf 하나 — 해지·체험 만료·결제 없는 부여 구독은 유료가 아니다
      if (statusFilter !== "all" && planOf(c).kind !== statusFilter) return false;
      return true;
    });
  }, [companies, search, statusFilter]);

  // 요약 — 상태 구성(도넛)과 최근 6개월 가입 추이(막대). 전체 목록 기준(검색·필터 무관).
  const summary = useMemo(() => {
    // 구성·유료 수는 planOf 기준(개요 화면·필터와 같은 숫자)
    const byStatus = new Map<string, { label: string; color: string; n: number }>();
    let users = 0;
    for (const c of companies as any[]) {
      const k = planOf(c).kind;
      const meta = KIND_META[k];
      const cur = byStatus.get(k) || { label: meta.label, color: meta.color, n: 0 };
      cur.n += 1; byStatus.set(k, cur);
      users += Number(c.users?.[0]?.count ?? 0);
    }
    const paid = byStatus.get("paid")?.n ?? 0;
    // 월 경계는 KST
    const months: { name: string; ym: string; n: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const { key, name } = kstMonthsBack(i);
      months.push({ name, ym: key, n: 0 });
    }
    for (const c of companies as any[]) {
      const ym = kstMonthKey(c.created_at);
      const m = months.find((x) => x.ym === ym);
      if (m) m.n += 1;
    }
    const thisMonth = months[months.length - 1]?.n ?? 0;
    return { byStatus: [...byStatus.values()].sort((a, b) => b.n - a.n), paid, users, months, thisMonth };
  }, [companies]);


  return (
    <PfPage>
      <PfPageHead
        eyebrow="고객"
        title="고객사 관리"
        desc={`오너뷰에 가입한 모든 회사입니다. 1분마다 자동으로 새로 고쳐지고, 행을 누르면 그 회사의 상세 화면으로 갑니다.${hiddenTestCount > 0 ? ` 테스트 회사 ${hiddenTestCount}곳은 목록과 숫자에서 뺐습니다.` : ""}`}
        actions={
          <>
            <OpsSearch value={search} onChange={setSearch} placeholder="회사명·사업자번호 검색" />
            <PfSeg value={statusFilter} onChange={setStatusFilter} options={[{ value: "all", label: "전체" }, { value: "paid", label: "유료" }, { value: "free", label: "미구독" }]} />
            <button
              type="button"
              className="pf-btn"
              disabled={filtered.length === 0}
              title="현재 목록을 엑셀(CSV)로 저장"
              onClick={() => exportCsv(filtered.map((c: any) => {
                const sub = latestSub(c);
                return {
                  회사명: c.name || "", 사업자번호: c.business_number || "",
                  플랜: sub?.subscription_plans?.name || "미구독",
                  상태: statusOf(c).label,
                  인원: c.users?.[0]?.count ?? 0, 좌석: sub?.seat_count || 1,
                  가입일: kstDateStr(new Date(c.created_at)),
                };
              }), "고객사목록")}
            >
              ⬇ 내보내기
            </button>
          </>
        }
      />

      {/* 요약 KPI */}
      <div className="pf-kpi-grid">
        <div className="pf-kpi-tile" style={{ ["--pf-i" as string]: 1 }}>
          <PfKpi label="총 가입사" value={companies.length} unit="곳" accent />
        </div>
        <div className="pf-kpi-tile" style={{ ["--pf-i" as string]: 2 }}>
          <PfKpi label="이번 달 신규" value={summary.thisMonth} unit="곳" />
        </div>
        <div className="pf-kpi-tile" style={{ ["--pf-i" as string]: 3 }}>
          <PfKpi label="유료 구독 중" value={summary.paid} unit="곳" />
        </div>
        <div className="pf-kpi-tile" style={{ ["--pf-i" as string]: 4 }}>
          <PfKpi label="전체 사용자" value={summary.users} unit="명" />
        </div>
      </div>

      {/* 구성 + 추이 */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PfCard i={5}>
          <PfCardHead title="고객 구성" sub="이용 중인 구독 기준 · 유료는 실제 결제되는 구독만, 결제 수단 없이 켜 둔 구독은 '무상 이용'" />
          <PfCardBody>
            {isLoading || loadError ? <PfState loading={isLoading} error={loadError} onRetry={() => refetch()} skeletonH={18} pad={false} /> : (
              <PfDonut slices={summary.byStatus.map((s) => ({ label: s.label, value: s.n, color: s.color }))} size={170} centerLabel="총 가입사" />
            )}
          </PfCardBody>
        </PfCard>
        <PfCard i={6}>
          <PfCardHead title="월별 신규 가입" sub="최근 6개월 · 몇 곳이 새로 가입했는지" />
          <PfCardBody>
            {isLoading ? <PfSkeleton rows={4} h={18} /> : (
              <PfBars data={summary.months.map((m) => ({ name: m.name, n: m.n }))} series={[{ key: "n", label: "신규 가입사" }]} height={190} />
            )}
          </PfCardBody>
        </PfCard>
      </div>

      {/* 목록 */}
      <PfCard i={7} hover={false}>
        <PfCardHead title="고객사 목록" sub={`${filtered.length}곳 표시 중`} />
        <PfState loading={isLoading} error={loadError} onRetry={() => refetch()} empty={filtered.length === 0} emptyText={companies.length === 0 ? "가입한 회사가 없습니다" : "조건에 맞는 회사가 없습니다"} skeletonRows={6}>
          <div className="pf-table-wrap">
            <table className="pf-table">
              <thead>
                <tr>
                  <th>회사</th>
                  <th>요금제</th>
                  <th>상태</th>
                  <th className="text-center">좌석</th>
                  <th className="text-center">사용자</th>
                  <th>가입일</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c: any) => {
                  const sub = latestSub(c);
                  const plan = sub?.subscription_plans;
                  const st = statusOf(c);
                  const planTone: Tone = plan?.slug === "standard" || plan?.slug === "ultra" ? "info" : "muted";
                  return (
                    <tr key={c.id} onClick={() => router.push(`/platform/companies/${c.id}`)} className="cursor-pointer">
                      <td className="max-w-[280px]">
                        <div className="font-semibold text-[var(--text)] truncate">{c.name}</div>
                        {c.industry ? (
                          <div className="text-[11px] text-[var(--text-dim)] truncate">{c.industry}</div>
                        ) : (
                          <div className="text-[11px] text-[#b45309]">업종 미분류</div>
                        )}
                      </td>
                      <td><PfBadge tone={planTone}>{plan?.name || c.current_plan || "무료"}</PfBadge></td>
                      <td><PfBadge tone={st.tone}>{st.label}</PfBadge></td>
                      <td className="text-center text-[var(--text-muted)] mono-number">{sub?.seat_count || 1}명</td>
                      <td className="text-center text-[var(--text-muted)] mono-number">{c.users?.[0]?.count ?? 0}명</td>
                      <td className="text-[var(--text-muted)] mono-number">{kstDateStr(new Date(c.created_at))}</td>
                      <td className="text-right">
                        <Link href={`/platform/companies/${c.id}`} onClick={(e) => e.stopPropagation()} className="pf-card-action">상세 →</Link>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </PfState>
      </PfCard>
    </PfPage>
  );
}
