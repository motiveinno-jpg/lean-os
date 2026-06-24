"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { getMonthlyBudgetOverview, getCostBreakdown, type MonthlyBudget, type CostBreakdown } from "@/lib/cash-budget";
import CostsChart from "./costs-chart";

/* ------------------------------------------------------------------ */
/*  회계 › 고정비 · 변동비                                              */
/*  cash-budget.getMonthlyBudgetOverview(companyId, year) 재사용.       */
/*  매월 고정으로 나가는 돈(고정비) vs 그때그때 바뀌는 돈(변동비)을      */
/*  월별로 분리해 보여준다. (재구현 없이 기존 집계 함수 그대로 사용)     */
/* ------------------------------------------------------------------ */

function fmtKrw(value: number): string {
  if (!value) return "-";
  const isNeg = value < 0;
  const abs = Math.abs(Math.round(value));
  return (isNeg ? "(" : "") + abs.toLocaleString("ko-KR") + (isNeg ? ")" : "");
}

function monthLabel(m: string): string {
  return `${parseInt(m.split("-")[1], 10)}월`;
}

const YEAR_NOW = new Date().getFullYear();

export default function CostsPage() {
  const { role } = useUser();
  const blocked = role === "partner";

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [year, setYear] = useState(YEAR_NOW);
  const [rows, setRows] = useState<MonthlyBudget[] | null>(null);
  const [breakdown, setBreakdown] = useState<CostBreakdown | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (blocked) return;
    getCurrentUser().then((u) => {
      if (u) setCompanyId(u.company_id);
      else setIsLoading(false);
    });
  }, [blocked]);

  useEffect(() => {
    if (blocked || !companyId) return;
    setIsLoading(true);
    setError(null);
    Promise.all([
      getMonthlyBudgetOverview(companyId, year),
      getCostBreakdown(companyId, year),
    ])
      .then(([ov, bd]) => { setRows(ov); setBreakdown(bd); })
      .catch((e) => setError(e?.message || "데이터를 불러오지 못했습니다"))
      .finally(() => setIsLoading(false));
  }, [companyId, year, blocked]);

  const totals = useMemo(() => {
    if (!rows) return { fixed: 0, variable: 0, total: 0 };
    const fixed = rows.reduce((s, r) => s + r.fixedCosts, 0);
    const variable = rows.reduce((s, r) => s + r.variableCosts, 0);
    return { fixed, variable, total: fixed + variable };
  }, [rows]);

  if (blocked) {
    return <AccessDenied detail="비용 리포트는 대표·관리자 전용입니다." />;
  }

  return (
    <div>
      <Link href="/reports" className="no-print" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-muted)", textDecoration: "none", marginBottom: 14 }}>
        ← 분석 허브
      </Link>
      {/* 표준 .page-sticky-header(z-30·blur·앱 상단바 안 가림). 2026-06-10 */}
      <div className="page-sticky-header" style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20, flexWrap: "wrap" }}>
        <div>
          <h1 className="text-2xl font-extrabold" style={{ color: "var(--text)", margin: 0 }}>
            고정비 · 변동비
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 6 }}>
            매달 꼭 나가는 돈(고정비)과 그때그때 바뀌는 돈(변동비)을 분리해 봅니다.
          </p>
        </div>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            background: "var(--bg-card)",
            color: "var(--text)",
            fontSize: 13,
          }}
        >
          {[YEAR_NOW, YEAR_NOW - 1, YEAR_NOW - 2].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div style={{ padding: "60px 0", textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
          불러오는 중…
        </div>
      )}

      {error && !isLoading && (
        <div style={{ padding: "16px", borderRadius: 8, background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13 }}>
          {error}
        </div>
      )}

      {!isLoading && !error && rows && (
        <>
          {/* Summary cards — 대시보드 글래스카드 (2026-06-10) */}
          <div className="grid grid-cols-3 gap-3 sm:gap-4" style={{ marginBottom: 20 }}>
            {[
              { label: `${year}년 고정비`, value: totals.fixed, color: "#f97316", hint: "임대료·급여·4대보험 등" },
              { label: `${year}년 변동비`, value: totals.variable, color: "#8b5cf6", hint: "카드·일회성 지출 등" },
              { label: `${year}년 총비용`, value: totals.total, color: "var(--primary)", hint: "고정비 + 변동비" },
            ].map((c) => (
              <div key={c.label} className="glass-card" style={{ padding: 18 }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: "0.03em", textTransform: "uppercase", color: "var(--text-muted)", marginBottom: 8 }}>{c.label}</div>
                <div className="mono-number" style={{ fontSize: 20, fontWeight: 800, letterSpacing: "-0.02em", color: c.color, lineHeight: 1.1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>₩{fmtKrw(c.value)}</div>
                <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 6, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.hint}</div>
              </div>
            ))}
          </div>

          {/* Chart */}
          <CostsChart
            months={rows.map((r) => r.month)}
            fixed={Object.fromEntries(rows.map((r) => [r.month, r.fixedCosts]))}
            variable={Object.fromEntries(rows.map((r) => [r.month, r.variableCosts]))}
          />

          {/* Monthly table */}
          <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid var(--border)", marginTop: 20 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
              <thead>
                <tr style={{ background: "var(--bg-surface)" }}>
                  <th style={{ textAlign: "left", padding: "12px 16px", color: "var(--text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>월</th>
                  <th style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>고정비</th>
                  <th style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>변동비</th>
                  <th style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>합계</th>
                  <th style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>고정비 비중</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const sum = r.fixedCosts + r.variableCosts;
                  const fixedPct = sum > 0 ? Math.round((r.fixedCosts / sum) * 100) : 0;
                  return (
                    <tr key={r.month} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "11px 16px", color: "var(--text)" }}>{monthLabel(r.month)}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", color: "#f97316", fontWeight: 600 }}>{fmtKrw(r.fixedCosts)}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", color: "#8b5cf6", fontWeight: 600 }}>{fmtKrw(r.variableCosts)}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", color: "var(--text)", fontWeight: 700 }}>{fmtKrw(sum)}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", color: "var(--text-dim)" }}>{sum > 0 ? `${fixedPct}%` : "-"}</td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-surface)" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 700, color: "var(--text)" }}>합계</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#f97316" }}>{fmtKrw(totals.fixed)}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#8b5cf6" }}>{fmtKrw(totals.variable)}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "var(--text)" }}>{fmtKrw(totals.total)}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "var(--text-dim)" }}>
                    {totals.total > 0 ? `${Math.round((totals.fixed / totals.total) * 100)}%` : "-"}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* 고정비/변동비 세부내역 (category별) */}
          {breakdown && (
            <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18, marginTop: 24 }}>
              {/* 고정비 세부내역 */}
              <div className="glass-card" style={{ overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 14, color: "#f97316" }}>
                  고정비 세부내역 ({year}년)
                </div>
                {breakdown.fixed.length === 0 ? (
                  <div style={{ padding: 20, fontSize: 13, color: "var(--text-dim)", textAlign: "center" }}>
                    등록된 고정비가 없습니다. 결제 → 정기결제 등록에서 임차료·급여·4대보험 등을 추가하세요.
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ background: "var(--bg-surface)" }}>
                      <th style={{ textAlign: "left", padding: "10px 16px", color: "var(--text-muted)", fontWeight: 600 }}>항목</th>
                      <th style={{ textAlign: "right", padding: "10px 16px", color: "var(--text-muted)", fontWeight: 600 }}>월 평균</th>
                      <th style={{ textAlign: "right", padding: "10px 16px", color: "var(--text-muted)", fontWeight: 600 }}>올해 누계</th>
                      <th style={{ textAlign: "right", padding: "10px 16px", color: "var(--text-muted)", fontWeight: 600 }}>비중</th>
                    </tr></thead>
                    <tbody>
                      {breakdown.fixed.map((r) => (
                        <tr key={r.category} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ padding: "10px 16px", color: "var(--text)" }}>{r.label}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right", color: "var(--text-muted)" }}>{fmtKrw(r.monthly)}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right", color: "#f97316", fontWeight: 600 }}>{fmtKrw(r.amount)}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right", color: "var(--text-dim)" }}>{breakdown.fixedTotal > 0 ? `${Math.round(r.amount / breakdown.fixedTotal * 100)}%` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-surface)" }}>
                      <td style={{ padding: "11px 16px", fontWeight: 700 }}>합계</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 700, color: "var(--text-muted)" }}>{fmtKrw(breakdown.fixed.reduce((s, r) => s + r.monthly, 0))}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 700, color: "#f97316" }}>{fmtKrw(breakdown.fixedTotal)}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 700, color: "var(--text-dim)" }}>100%</td>
                    </tr></tfoot>
                  </table>
                )}
              </div>

              {/* 변동비 세부내역 */}
              <div className="glass-card" style={{ overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 14, color: "#8b5cf6" }}>
                  변동비 세부내역 ({year}년)
                </div>
                {breakdown.variable.length === 0 ? (
                  <div style={{ padding: 20, fontSize: 13, color: "var(--text-dim)", textAlign: "center" }}>
                    집계된 변동비가 없습니다. (카드 사용액·일회성 지출)
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ background: "var(--bg-surface)" }}>
                      <th style={{ textAlign: "left", padding: "10px 16px", color: "var(--text-muted)", fontWeight: 600 }}>항목</th>
                      <th style={{ textAlign: "right", padding: "10px 16px", color: "var(--text-muted)", fontWeight: 600 }}>올해 누계</th>
                      <th style={{ textAlign: "right", padding: "10px 16px", color: "var(--text-muted)", fontWeight: 600 }}>비중</th>
                    </tr></thead>
                    <tbody>
                      {breakdown.variable.map((r) => (
                        <tr key={r.category} style={{ borderTop: "1px solid var(--border)" }}>
                          <td style={{ padding: "10px 16px", color: "var(--text)" }}>{r.label}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right", color: "#8b5cf6", fontWeight: 600 }}>{fmtKrw(r.amount)}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right", color: "var(--text-dim)" }}>{breakdown.variableTotal > 0 ? `${Math.round(r.amount / breakdown.variableTotal * 100)}%` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-surface)" }}>
                      <td style={{ padding: "11px 16px", fontWeight: 700 }}>합계</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 700, color: "#8b5cf6" }}>{fmtKrw(breakdown.variableTotal)}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 700, color: "var(--text-dim)" }}>100%</td>
                    </tr></tfoot>
                  </table>
                )}
              </div>
            </div>
          )}

          {/* Footer note */}
          <div
            style={{
              marginTop: 16,
              padding: "12px 16px",
              borderRadius: 8,
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              fontSize: 12,
              color: "var(--text-dim)",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "var(--text-muted)" }}>참고</strong>
            <br />
            - 고정비는 등록된 고정비 항목과 정기결제(임대료·급여·4대보험·구독 등)를 합산합니다.
            <br />
            - 변동비는 법인카드 사용액과 일회성 지출(결제 대기 항목)을 합산합니다.
            <br />
            - 고정비 비중이 높을수록 매출이 줄어도 줄이기 어려운 비용 구조입니다.
          </div>
        </>
      )}
    </div>
  );
}
