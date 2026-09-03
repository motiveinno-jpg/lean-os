"use client";

// CODEF API 사용량 — 운영자 페이지 정식 메뉴 (2026-08-04)
//   원래 /operator-users 의 탭이었으나 사장님 지시로 /platform 하위로 이동.
//   데이터: operator-user-admin EF mode=codef-usage (운영자 게이트 내장) —
//   codef_usage 원장은 RLS 가 자기 회사 한정이라 클라 직조회 불가.
//   2026-09-03 v2 디자인 — pf 부품 + Bklit 차트(링·게이지·막대). 조회 로직은 그대로.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfKpiKrw, PfBadge, PfSkeleton, PfEmpty, PfBar } from "@/app/platform/_components/pf/ui";
import { PfRings, PfGauge, PfBars } from "@/app/platform/_components/pf/charts";

// KST 기준 "YYYY-MM"
const kstMonthNow = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};

type CodefProduct = {
  path: string;
  name: string;
  price: number | null;
  count: number;
  amount: number | null;
  limit: number;
  remaining: number | null;
  over: number | null;
};
type CodefUsage = {
  month: string;
  total: { units: number; calls: number; rows: number };
  byCategory: Record<string, { units: number; calls: number }>;
  companies: { companyId: string; name: string; units: number; calls: number; byCategory: Record<string, number> }[];
  products?: CodefProduct[];
  product_limit?: number;
};
const fmtWon = (n: number) => `₩${n.toLocaleString()}`;
const USAGE_CATEGORY_ORDER = ["통장", "카드", "현금영수증", "세금계산서", "이체", "관리(무과금)", "기타"];

async function fetchUsage(month: string): Promise<CodefUsage> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("인증 세션이 없습니다");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const res = await fetch(`${url}/functions/v1/operator-user-admin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({ mode: "codef-usage", month }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.error) throw new Error(j?.error || `HTTP ${res.status}`);
  return j as CodefUsage;
}

const monthLabel = (ym: string) => {
  const [y, m] = ym.split("-");
  return `${y}년 ${Number(m)}월`;
};

export default function PlatformCodefUsagePage() {
  const [month, setMonth] = useState(kstMonthNow);
  const [usage, setUsage] = useState<CodefUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchUsage(month)
      .then((r) => { if (alive) setUsage(r); })
      .catch((e: any) => { if (alive) { setUsage(null); setError(e?.message || "조회 실패"); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [month]);

  const products = usage?.products ?? [];
  const productLimit = usage?.product_limit ?? 100000;
  const priced = products.filter((p) => p.amount !== null);
  const amountTotal = priced.reduce((s, p) => s + (p.amount ?? 0), 0);
  const overTotal = priced.reduce((s, p) => s + (p.over ?? 0), 0);
  const includedTotal = priced.length * productLimit;
  const usagePct = includedTotal > 0 ? Math.round((amountTotal / includedTotal) * 100) : 0;
  const overCount = priced.filter((p) => (p.over ?? 0) > 0).length;

  const categoryRows = usage
    ? USAGE_CATEGORY_ORDER.filter((c) => usage.byCategory[c]).map((c) => ({ name: c, units: usage.byCategory[c].units, calls: usage.byCategory[c].calls }))
    : [];
  const topCompanies = usage
    ? [...usage.companies].sort((a, b) => b.units - a.units).slice(0, 8).map((c) => ({ name: c.name.length > 10 ? `${c.name.slice(0, 10)}…` : c.name, units: c.units, calls: c.calls }))
    : [];

  const monthNav = (
    <div className="pf-seg">
      <button type="button" onClick={() => setMonth((m) => shiftMonth(m, -1))} className="pf-seg-item" aria-label="이전 달">◀</button>
      <span className="pf-seg-item pf-seg-item-on mono-number">{monthLabel(month)}</span>
      <button
        type="button"
        onClick={() => setMonth((m) => shiftMonth(m, 1))}
        disabled={month >= kstMonthNow()}
        className="pf-seg-item disabled:opacity-30"
        aria-label="다음 달"
      >▶</button>
    </div>
  );

  return (
    <PfPage>
      <PfPageHead
        eyebrow="운영"
        title="CODEF 사용량"
        desc="은행·카드·홈택스 자동 수집에 쓰는 CODEF 비용입니다. API(상품)당 월 10만원까지는 요금에 포함되고, 넘는 만큼만 건당 과금됩니다. 계정관리 API는 무료, 달은 한국 시간 기준, 수집은 2026-07-03부터."
        actions={monthNav}
      />

      {loading ? (
        <>
          <div className="pf-kpi-grid">
            {[0, 1, 2, 3].map((k) => <div key={k} className="pf-kpi-tile"><PfSkeleton h={12} w="50%" /><PfSkeleton h={28} w="70%" className="mt-2" /></div>)}
          </div>
          <PfCard pad><PfSkeleton h={160} /></PfCard>
        </>
      ) : error ? (
        <PfCard i={1}><PfEmpty>조회에 실패했습니다: {error}</PfEmpty></PfCard>
      ) : !usage ? (
        <PfCard i={1}><PfEmpty>데이터가 없습니다.</PfEmpty></PfCard>
      ) : (
        <>
          {/* 이 달 요약 */}
          <div className="pf-kpi-grid">
            <div className="pf-kpi-tile pf-in" style={{ ["--pf-i" as string]: 1 }}>
              <PfKpiKrw label="이 달 사용 금액" value={amountTotal} accent />
              <div className="text-[10.5px] text-[var(--text-dim)] mt-1">포함 한도 {fmtWon(includedTotal)} 중</div>
            </div>
            <div className="pf-kpi-tile pf-in" style={{ ["--pf-i" as string]: 2 }}>
              <PfKpiKrw label="한도 초과 과금" value={overTotal} />
              <div className="mt-1">{overTotal > 0 ? <PfBadge tone="danger">API {overCount}개 초과</PfBadge> : <PfBadge tone="ok">초과 없음</PfBadge>}</div>
            </div>
            <div className="pf-kpi-tile pf-in" style={{ ["--pf-i" as string]: 3 }}>
              <PfKpi label="과금 대상 호출" value={usage.total.units} unit="건" />
              <div className="text-[10.5px] text-[var(--text-dim)] mt-1">전체 호출 {usage.total.calls.toLocaleString()}건 · 기록 {usage.total.rows.toLocaleString()}줄</div>
            </div>
            <div className="pf-kpi-tile pf-in" style={{ ["--pf-i" as string]: 4 }}>
              <PfKpi label="사용한 회사" value={usage.companies.length} unit="곳" />
            </div>
          </div>

          {/* 한도 게이지 + API별 링 */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <PfCard i={5}>
              <PfCardHead title="포함 한도 사용률" sub={`API ${priced.length}개 × ${fmtWon(productLimit)} = ${fmtWon(includedTotal)}`} />
              <PfCardBody className="flex flex-col items-center gap-3">
                {priced.length === 0 ? (
                  <PfEmpty>이 달에는 과금 대상 호출이 없습니다.</PfEmpty>
                ) : (
                  <>
                    <PfGauge pct={Math.min(100, usagePct)} label="사용률" centerValue={usagePct} suffix="%" tone={usagePct >= 100 ? "danger" : usagePct >= 80 ? "warn" : "ok"} width={200} />
                    <div className="text-[11px] text-[var(--text-muted)] text-center">
                      {usagePct >= 100 ? "포함 한도를 다 썼습니다. 지금부터는 건당 과금입니다." : usagePct >= 80 ? "한도의 80%를 넘었습니다. 이달 말 초과가 날 수 있습니다." : "포함 한도 안에서 여유 있게 쓰고 있습니다."}
                    </div>
                  </>
                )}
              </PfCardBody>
            </PfCard>

            <PfCard i={6} className="lg:col-span-2">
              <PfCardHead title="API별 한도 사용" sub="링 하나가 API 하나 — 꽉 차면 10만원을 다 쓴 것" />
              <PfCardBody>
                {priced.length === 0 ? (
                  <PfEmpty>이 달에는 과금 대상 호출이 없습니다.</PfEmpty>
                ) : (
                  <PfRings
                    items={priced.slice(0, 5).map((p) => ({ label: p.name, value: Math.min(p.amount ?? 0, p.limit), max: p.limit }))}
                    size={220}
                    centerLabel="사용 금액"
                    formatCenter={(v) => fmtWon(Math.round(v))}
                  />
                )}
                {priced.length > 5 && <div className="text-[10.5px] text-[var(--text-dim)] mt-2">상위 5개만 링으로 표시 — 전체는 아래 표에서</div>}
              </PfCardBody>
            </PfCard>
          </div>

          {/* API 상품별 한도 현황 표 — 상품당 월 10만원 포함, 초과분 건당 과금 */}
          <PfCard i={7} hover={false}>
            <PfCardHead title="API별 한도 현황" sub={`API(상품)당 월 ${fmtWon(productLimit)} 포함 · 넘는 만큼 건당 과금`} />
            {products.length === 0 ? (
              <PfEmpty>이 달에는 과금 대상 호출이 없습니다.</PfEmpty>
            ) : (
              <div className="pf-table-wrap">
                <table className="pf-table">
                  <thead>
                    <tr>
                      <th>API</th>
                      <th className="text-right">건당 단가</th>
                      <th className="text-right">성공 건수</th>
                      <th className="text-right">사용 금액</th>
                      <th className="w-[260px]">남은 한도</th>
                    </tr>
                  </thead>
                  <tbody>
                    {products.map((p) => {
                      const pct = p.amount === null ? 0 : Math.min(100, (p.amount / p.limit) * 100);
                      const isOver = (p.over ?? 0) > 0;
                      return (
                        <tr key={p.path}>
                          <td className="font-semibold text-[var(--text)]" title={p.path}>{p.name}</td>
                          <td className="text-right mono-number text-[var(--text-muted)]">{p.price === null ? "미확인" : fmtWon(p.price)}</td>
                          <td className="text-right mono-number">{p.count.toLocaleString()}</td>
                          <td className="text-right mono-number font-semibold">{p.amount === null ? "—" : fmtWon(p.amount)}</td>
                          <td>
                            {p.amount === null ? (
                              <span className="text-[11px] text-[var(--text-dim)]">단가 미확인 — 건수만 집계</span>
                            ) : (
                              <div className="flex items-center gap-2">
                                <PfBar pct={pct} tone={isOver ? "danger" : pct >= 80 ? "warn" : "info"} className="flex-1" />
                                <span className={`text-[11px] mono-number shrink-0 ${isOver ? "text-[var(--danger)] font-bold" : "text-[var(--text-muted)]"}`}>
                                  {isOver ? `초과 ${fmtWon(p.over!)}` : `${fmtWon(p.remaining!)} 남음`}
                                </span>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </PfCard>

          {/* 사용별·회사별 막대 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <PfCard i={8}>
              <PfCardHead title="무엇을 수집하는 데 썼나" sub="구분별 과금 대상 호출과 전체 호출" />
              <PfCardBody>
                <PfBars
                  data={categoryRows}
                  xKey="name"
                  series={[{ key: "units", label: "과금 대상" }, { key: "calls", label: "전체 호출" }]}
                  height={220}
                  empty="이 달에는 CODEF 호출이 없습니다."
                  revealKey={month}
                />
              </PfCardBody>
            </PfCard>
            <PfCard i={9}>
              <PfCardHead title="어느 회사가 많이 썼나" sub="과금 대상 호출 상위 8곳" />
              <PfCardBody>
                <PfBars
                  data={topCompanies}
                  xKey="name"
                  series={[{ key: "units", label: "과금 대상" }]}
                  height={220}
                  horizontal
                  empty="이 달에는 사용한 회사가 없습니다."
                  revealKey={month}
                />
              </PfCardBody>
            </PfCard>
          </div>

          {/* 회사별 표 */}
          <PfCard i={10} hover={false}>
            <PfCardHead title="회사별 사용 내역" sub="회사마다 무엇을 얼마나 수집했는지" />
            {usage.companies.length === 0 ? (
              <PfEmpty>이 달에는 사용한 회사가 없습니다.</PfEmpty>
            ) : (
              <div className="pf-table-wrap">
                <table className="pf-table">
                  <thead>
                    <tr>
                      <th>회사</th>
                      <th className="text-right">과금 대상</th>
                      <th className="text-right">전체 호출</th>
                      <th>과금 내역</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.companies.map((c) => (
                      <tr key={c.companyId}>
                        <td className="font-semibold text-[var(--text)]">{c.name}</td>
                        <td className="text-right font-semibold mono-number">{c.units.toLocaleString()}</td>
                        <td className="text-right text-[var(--text-muted)] mono-number">{c.calls.toLocaleString()}</td>
                        <td>
                          <div className="flex flex-wrap gap-1">
                            {USAGE_CATEGORY_ORDER.filter((k) => c.byCategory[k]).map((k) => (
                              <PfBadge key={k} tone="muted">{k} <b className="mono-number">{c.byCategory[k].toLocaleString()}</b></PfBadge>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </PfCard>
        </>
      )}
    </PfPage>
  );
}
