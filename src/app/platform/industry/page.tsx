"use client";

// 업계 분석 — 업종별 고객 분포·미분류 회사 분류·업종별 재무 평균.
//   2026-09-03 v2 디자인 — pf 부품 + Bklit 도넛·막대. RPC·분류 저장 로직은 그대로.

import { kstDateStr } from "@/lib/kst";
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfEmpty, PfRows, PfRow, PfBar } from "@/app/platform/_components/pf/ui";
import { PfDonut, PfBars } from "@/app/platform/_components/pf/charts";

const db = supabase;

// KSIC 대분류 간소화 — 13개 카테고리
const INDUSTRY_OPTIONS = [
  "IT/소프트웨어",
  "제조",
  "도소매",
  "음식점/숙박",
  "건설",
  "전문서비스",
  "운수/물류",
  "금융/보험",
  "의료/복지",
  "교육",
  "부동산",
  "농림/수산",
  "기타",
];

function fmtW(n: number | null | undefined): string {
  const x = Number(n || 0);
  const abs = Math.abs(x);
  const sign = x < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}₩${abs.toLocaleString()}`;
}

type Dist = { industry: string; company_count: number };
type Unclassified = { id: string; name: string; business_number: string | null; created_at: string };
type AvgRow = {
  metric: string;
  label: string;
  avg_value: number;
  median_value: number;
  sample_size: number;
};

export default function PlatformIndustryPage() {
  const qc = useQueryClient();
  const [selectedIndustry, setSelectedIndustry] = useState<string>("");

  const { data: dist = [] } = useQuery<Dist[]>({
    queryKey: ["op-industry-dist"],
    queryFn: async () => {
      const { data, error } = await db.rpc("operator_industry_distribution");
      if (error) throw error;
      return (data || []) as Dist[];
    },
  });

  const { data: unclassified = [] } = useQuery<Unclassified[]>({
    queryKey: ["op-industry-unclassified"],
    queryFn: async () => {
      const { data, error } = await db.rpc("operator_unclassified_companies");
      if (error) throw error;
      return (data || []) as Unclassified[];
    },
  });

  const { data: industryAvg = [] } = useQuery<AvgRow[]>({
    queryKey: ["op-industry-avg", selectedIndustry],
    queryFn: async () => {
      const { data, error } = await db.rpc("operator_financial_averages_by_industry", {
        p_month: undefined,
        p_industry: selectedIndustry || undefined,
      });
      if (error) throw error;
      return (data || []) as AvgRow[];
    },
    enabled: !!selectedIndustry,
  });

  const setIndustry = useMutation({
    mutationFn: async ({ id, industry }: { id: string; industry: string }) => {
      const { data, error } = await db.rpc("operator_set_company_industry", {
        p_company_id: id,
        p_industry: industry,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["op-industry-dist"] });
      qc.invalidateQueries({ queryKey: ["op-industry-unclassified"] });
    },
  });

  const totalCompanies = dist.reduce((s, d) => s + d.company_count, 0);
  const unclassifiedCount = dist.find((d) => d.industry === "(미분류)")?.company_count ?? 0;
  const classified = dist.filter((d) => d.industry !== "(미분류)" && d.company_count > 0).sort((a, b) => b.company_count - a.company_count);
  const classifiedTotal = classified.reduce((s, d) => s + d.company_count, 0);
  // 도넛은 상위 4개 + 나머지 묶음(카테고리 색은 5개까지 고정 배정)
  const donutSlices = (() => {
    const top = classified.slice(0, 4).map((d) => ({ label: d.industry, value: d.company_count }));
    const rest = classified.slice(4).reduce((s, d) => s + d.company_count, 0);
    return rest > 0 ? [...top, { label: "그 외", value: rest }] : top;
  })();
  const industryChartRows = industryAvg.map((r) => ({
    name: r.label,
    avg: Math.round(Number(r.avg_value || 0) / 1e4),
    median: Math.round(Number(r.median_value || 0) / 1e4),
  }));
  const fmtMan = (v: number) => `${v.toLocaleString("ko-KR")}만`;

  return (
    <PfPage>
      <PfPageHead
        eyebrow="운영"
        title="업계 분석"
        desc="고객사가 어떤 업종에 몰려 있는지 보고, 업종을 아직 안 정한 회사를 분류하며, 업종별 재무 평균을 비교합니다."
      />

      <div className="pf-kpi-grid">
        <div className="pf-kpi-tile pf-in" style={{ ["--pf-i" as string]: 1 }}>
          <PfKpi label="전체 회사" value={totalCompanies} unit="곳" />
        </div>
        <div className="pf-kpi-tile pf-in" style={{ ["--pf-i" as string]: 2 }}>
          <PfKpi label="업종 분류 완료" value={classifiedTotal} unit="곳" />
        </div>
        <div className="pf-kpi-tile pf-in" style={{ ["--pf-i" as string]: 3 }}>
          <PfKpi label="미분류" value={unclassifiedCount} unit="곳" />
          <div className="mt-1">{unclassifiedCount > 0 ? <PfBadge tone="warn">아래에서 분류</PfBadge> : <PfBadge tone="ok">모두 분류됨</PfBadge>}</div>
        </div>
        <div className="pf-kpi-tile pf-in" style={{ ["--pf-i" as string]: 4 }}>
          <PfKpi label="업종 수" value={classified.length} unit="개" />
        </div>
      </div>

      {/* 분포 — 도넛(구성비) + 업종 목록(선택) */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <PfCard i={5} className="lg:col-span-2">
          <PfCardHead title="업종 구성비" sub="분류된 회사 기준 · 상위 4개와 그 외" />
          <PfCardBody>
            <PfDonut slices={donutSlices} size={190} centerLabel="분류된 회사" formatCenter={(v) => `${v.toLocaleString()}곳`} />
          </PfCardBody>
        </PfCard>

        <PfCard i={6} className="lg:col-span-3" hover={false}>
          <PfCardHead title="업종별 회사 수" sub="업종을 누르면 아래에 그 업종의 재무 평균이 열립니다" right={selectedIndustry ? <button type="button" onClick={() => setSelectedIndustry("")} className="pf-btn pf-btn-sm pf-btn-ghost">선택 해제</button> : undefined} />
          {dist.length === 0 ? (
            <PfEmpty>아직 분포 데이터가 없습니다.</PfEmpty>
          ) : (
            <PfRows>
              {dist.map((d) => {
                const pct = totalCompanies > 0 ? (d.company_count / totalCompanies) * 100 : 0;
                const isUnclassified = d.industry === "(미분류)";
                const on = d.industry === selectedIndustry;
                const inner = (
                  <>
                    <span className={`w-28 shrink-0 text-[12px] font-semibold ${isUnclassified ? "text-[#b45309]" : on ? "text-[var(--primary)]" : "text-[var(--text)]"}`}>{d.industry}</span>
                    <div className="flex-1 min-w-0"><PfBar pct={Math.max(2, pct)} tone={isUnclassified ? "warn" : "info"} /></div>
                    <span className="w-24 text-right text-[11px] mono-number text-[var(--text-muted)] shrink-0">{d.company_count}곳 · {pct.toFixed(0)}%</span>
                  </>
                );
                return isUnclassified
                  ? <PfRow key={d.industry} className="cursor-default">{inner}</PfRow>
                  : <PfRow key={d.industry} onClick={() => setSelectedIndustry(on ? "" : d.industry)} className={on ? "bg-[var(--primary-light)]" : ""}>{inner}</PfRow>;
              })}
            </PfRows>
          )}
        </PfCard>
      </div>

      {/* 선택 업종 평균 */}
      {selectedIndustry && (
        <PfCard i={7}>
          <PfCardHead title={<><span className="text-[var(--primary)]">{selectedIndustry}</span> 업종 재무 평균</>} sub="최신 월 · 단위 만원 · 평균이 중앙값보다 크면 큰 회사가 끌어올린 것" />
          <PfCardBody>
            {industryAvg.length === 0 ? (
              <PfEmpty>이 업종에는 아직 재무 데이터가 없습니다.</PfEmpty>
            ) : (
              <>
                <PfBars
                  data={industryChartRows}
                  xKey="name"
                  series={[{ key: "avg", label: "평균", format: fmtMan }, { key: "median", label: "중앙값", format: fmtMan }]}
                  height={Math.max(200, industryAvg.length * 40)}
                  horizontal
                  revealKey={selectedIndustry}
                />
                <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mt-4">
                  {industryAvg.map((r) => (
                    <div key={r.metric} className="rounded-xl bg-[var(--bg-surface)] px-3 py-2.5">
                      <div className="text-[11px] text-[var(--text-dim)]">{r.label}</div>
                      <div className="text-sm font-bold mono-number text-[var(--primary)] mt-0.5">평균 {fmtW(r.avg_value)}</div>
                      <div className="text-[11px] text-[var(--text-muted)]">중앙 {fmtW(r.median_value)}</div>
                      <div className="text-[10px] text-[var(--text-dim)] mt-1">표본 {r.sample_size}곳</div>
                    </div>
                  ))}
                </div>
              </>
            )}
          </PfCardBody>
        </PfCard>
      )}

      {/* 미분류 분류 UI */}
      <PfCard i={8} hover={false}>
        <PfCardHead
          title={<>업종을 정하지 않은 회사 {unclassified.length > 0 && <PfBadge tone="warn">{unclassified.length}곳</PfBadge>}</>}
          sub="업종을 고르면 바로 저장됩니다. 지금은 운영자만 분류할 수 있습니다."
        />
        {unclassified.length === 0 ? (
          <PfEmpty ok>모든 회사의 업종이 정해져 있습니다.</PfEmpty>
        ) : (
          <PfRows>
            {unclassified.map((c) => (
              <PfRow key={c.id} className="cursor-default">
                <div className="flex-1 min-w-0">
                  <div className="pf-row-title">{c.name}</div>
                  <div className="pf-row-sub">
                    {c.business_number ? `사업자 ${c.business_number} · ` : ""}
                    가입 {kstDateStr(new Date(c.created_at))}
                  </div>
                </div>
                <select
                  // 액션 select — value를 항상 ""로 고정해 선택 후 placeholder로 복귀.
                  //   실패해도 같은 업종을 다시 고를 수 있음(uncontrolled면 값이 남아 재선택 onChange 미발화).
                  value=""
                  disabled={setIndustry.isPending}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setIndustry.mutate({ id: c.id, industry: v });
                  }}
                  className="pf-btn pf-btn-sm"
                >
                  <option value="">업종 선택…</option>
                  {INDUSTRY_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </PfRow>
            ))}
          </PfRows>
        )}
        {setIndustry.isError && (
          <div className="px-5 pb-4 text-[11px] text-[var(--danger)]">{(setIndustry.error as any)?.message || "분류를 저장하지 못했습니다"}</div>
        )}
      </PfCard>

      <div className="text-[11px] text-[var(--text-dim)] px-1">
        표본이 적은 업종은 평균이 한두 회사에 크게 흔들리니 참고만 하세요.
      </div>
    </PfPage>
  );
}
