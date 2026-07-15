"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

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
        p_month: null,
        p_industry: selectedIndustry || null,
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

  return (
    <div className="max-w-5xl space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold text-[var(--text)]">업계별 분석</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">
          업종별 회사 분포 + 미분류 분류 + 업계별 재무 평균.
          총 {totalCompanies}개 · 미분류 {unclassifiedCount}개.
        </p>
      </div>

      {/* 분포 */}
      <div className="platform-industry-distribution-card glass-card p-5">
        <h3 className="section-title text-[var(--text)]">업종 분포</h3>
        <div className="space-y-2">
          {dist.map((d) => {
            const pct = totalCompanies > 0 ? (d.company_count / totalCompanies) * 100 : 0;
            const isUnclassified = d.industry === "(미분류)";
            return (
              <button
                key={d.industry}
                onClick={() => !isUnclassified && setSelectedIndustry(d.industry === selectedIndustry ? "" : d.industry)}
                disabled={isUnclassified}
                className={`platform-industry-bar-row w-full flex items-center gap-3 text-left ${!isUnclassified ? "cursor-pointer" : "cursor-default"}`}
              >
                <div className={`w-32 shrink-0 text-sm ${isUnclassified ? "text-[var(--warning)]" : "text-[var(--text)]"}`}>
                  {d.industry}
                </div>
                <div className="flex-1 h-6 bg-[var(--bg-surface)] rounded-lg overflow-hidden relative">
                  <div
                    className={`h-full ${
                      isUnclassified ? "bg-[var(--warning)]/30" :
                      d.industry === selectedIndustry ? "bg-[var(--primary)]/50" : "bg-[var(--primary)]/25 hover:bg-[var(--primary)]/40"
                    } transition`}
                    style={{ width: `${Math.max(2, pct)}%` }}
                  />
                  <div className="absolute inset-0 flex items-center px-2 text-[11px] font-bold text-[var(--text)]">
                    {d.company_count}개 · {pct.toFixed(0)}%
                  </div>
                </div>
              </button>
            );
          })}
        </div>
        {selectedIndustry && (
          <div className="mt-3 text-[11px] text-[var(--primary)]">
            선택: <span className="font-bold">{selectedIndustry}</span> — 아래 평균 비교 참조
          </div>
        )}
      </div>

      {/* 선택 업종 평균 */}
      {selectedIndustry && (
        <div className="platform-industry-average-card glass-card p-5">
          <h3 className="section-title text-[var(--text)]">
            <span className="text-[var(--primary)]">{selectedIndustry}</span> 업종 평균 (최신 월)
          </h3>
          {industryAvg.length === 0 ? (
            <div className="text-sm text-[var(--text-dim)]">해당 업종의 monthly_financials 데이터가 없습니다.</div>
          ) : (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
              {industryAvg.map((r) => (
                <div key={r.metric} className="platform-metric-tile bg-[var(--bg-surface)] rounded-lg p-3">
                  <div className="text-[11px] text-[var(--text-dim)]">{r.label}</div>
                  <div className="text-sm font-bold mono-number text-[var(--primary)] mt-1">평균 {fmtW(r.avg_value)}</div>
                  <div className="text-[11px] text-[var(--text-muted)]">중앙 {fmtW(r.median_value)}</div>
                  <div className="text-[10px] text-[var(--text-dim)] mt-1">표본 {r.sample_size}</div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* 미분류 분류 UI */}
      <div className="platform-unclassified-card glass-card p-5">
        <h3 className="section-title text-[var(--text)]">
          미분류 회사 분류
          {unclassified.length > 0 && (
            <span className="ml-2 text-xs font-normal text-[var(--warning)]">{unclassified.length}개</span>
          )}
        </h3>
        {unclassified.length === 0 ? (
          <div className="text-sm text-[var(--success)]">모든 회사가 분류 완료되었습니다.</div>
        ) : (
          <div className="space-y-2">
            {unclassified.map((c) => (
              <div key={c.id} className="platform-unclassified-row flex items-center gap-3 p-3 rounded-xl bg-[var(--bg-surface)]">
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm text-[var(--text)] truncate">{c.name}</div>
                  <div className="text-[11px] text-[var(--text-dim)]">
                    {c.business_number ? `사업자 ${c.business_number} · ` : ""}
                    가입 {new Date(c.created_at).toLocaleDateString("ko-KR")}
                  </div>
                </div>
                <select
                  defaultValue=""
                  disabled={setIndustry.isPending}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (!v) return;
                    setIndustry.mutate({ id: c.id, industry: v });
                  }}
                  className="px-3 py-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-xs text-[var(--text)] focus:outline-none focus:border-[var(--primary)]"
                >
                  <option value="">업종 선택…</option>
                  {INDUSTRY_OPTIONS.map((o) => (
                    <option key={o} value={o}>{o}</option>
                  ))}
                </select>
              </div>
            ))}
          </div>
        )}
        {setIndustry.isError && (
          <div className="mt-3 text-xs text-[var(--danger)]">{(setIndustry.error as any)?.message || "분류 실패"}</div>
        )}
      </div>

      <div className="kpi-callout">
        <b>OP-D</b> · 회사 자체 설정에서 사용자가 직접 업종 선택 동선은 후속 PR.
        지금은 운영자만 분류 가능. 표본이 작은 업종은 평균의 의미가 제한적임에 유의.
      </div>
    </div>
  );
}
