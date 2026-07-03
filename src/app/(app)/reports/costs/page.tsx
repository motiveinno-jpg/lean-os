"use client";

import { useEffect, useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { getMonthlyBudgetOverview, getCostBreakdown, getCostCategoryDetail, type MonthlyBudget, type CostBreakdown } from "@/lib/cash-budget";
import { CellDetail } from "../flow/_components/CellDetail";
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

// 산출 기준 설명 — 팝업 상단 note (집계 함수와 동일 소스 명시)
const FIXED_NOTE = "고정비 = 정기결제(활성) + 고정비 등록 항목 + 통장 거래 중 '고정비' 체크(전표처리·매핑에서 체크)된 지출의 합입니다. 같은 지출을 정기결제로도 등록하면 중복될 수 있으니 한 가지 방식만 사용하세요.";
const VARIABLE_NOTE = "변동비 = 법인카드 사용액 + 일회성 지출(결제 대기)의 합입니다.";

// 세부내역(카테고리) 행 클릭 → 산출 내역 팝업. getCostCategoryDetail 로 개별 레코드 조회 후 CellDetail 재사용.
function CategoryDetailModal({ companyId, year, kind, category, label, onClose }: {
  companyId: string; year: number; kind: "fixed" | "variable"; category: string; label: string; onClose: () => void;
}) {
  const { data } = useQuery({
    queryKey: ["cost-category-detail", companyId, year, kind, category],
    queryFn: () => getCostCategoryDetail(companyId, year, kind, category),
  });
  return (
    <CellDetail
      companyId={companyId} year={year} month={0} rowKey="__category"
      title={`${label} — ${kind === "fixed" ? "고정비" : "변동비"}`}
      subtitle={`${year}년 · 산출 내역`}
      clientItems={data ?? []}
      note={kind === "variable" ? VARIABLE_NOTE : category === "bank_fixed" ? FIXED_NOTE : `표의 '올해 누계'는 아래 월액 합계 × 경과월입니다. ${FIXED_NOTE}`}
      onClose={onClose}
    />
  );
}

export default function CostsPage() {
  const { role } = useUser();
  const blocked = role === "partner";

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [year, setYear] = useState(YEAR_NOW);
  const [rows, setRows] = useState<MonthlyBudget[] | null>(null);
  const [breakdown, setBreakdown] = useState<CostBreakdown | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 금액 클릭 → 산출 내역 팝업 (월별 셀 = budget-detail 재사용 / 카테고리 행 = getCostCategoryDetail)
  const [monthDetail, setMonthDetail] = useState<{ month: string; rowKey: "fixedCosts" | "variableCosts"; title: string } | null>(null);
  const [catDetail, setCatDetail] = useState<{ kind: "fixed" | "variable"; category: string; label: string } | null>(null);

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
      {/* 툴바 — 연도 필터. 페이지 타이틀은 공통 헤더바가 표시 (2026-07-03 라운드6.5) */}
      <div className="page-sticky-header mb-5 flex flex-wrap items-center justify-between gap-2">
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
          {/* Summary cards — 그라데이션 + 아이콘칩 (2026-06-30 손익계산서 카드와 일관) */}
          <div className="grid grid-cols-3 gap-3 sm:gap-4" style={{ marginBottom: 24 }}>
            {[
              { label: `${year}년 고정비`, value: totals.fixed, tone: "warning", hint: "임대료·급여·4대보험 등", icon: "M3 21h18M5 21V8l7-4 7 4v13M9 21v-6h6v6" },
              { label: `${year}년 변동비`, value: totals.variable, tone: "info", hint: "카드·일회성 지출 등", icon: "M3 17l6-6 4 4 8-8M21 7v6m0-6h-6" },
              { label: `${year}년 총비용`, value: totals.total, tone: "", hint: "고정비 + 변동비", icon: "M12 6v12m0-12c-1.66 0-3 .9-3 2s1.34 2 3 2 3 .9 3 2-1.34 2-3 2-3-.9-3-2" },
            ].map((c) => (
              <div key={c.label} className="glass-card p-4 sm:p-5 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-[13px] font-semibold text-[var(--text-muted)] truncate">{c.label}</span>
                  <span className={`kpi-icon shrink-0 ${c.tone}`}>
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={c.icon} /></svg>
                  </span>
                </div>
                <div className="mono-number truncate text-[26px] leading-8 font-extrabold text-[var(--text)]">₩{fmtKrw(c.value)}</div>
                <div className="text-[11px] text-[var(--text-dim)] truncate">{c.hint}</div>
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
          <div className="glass-card" style={{ overflowX: "auto", marginTop: 24 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
              <thead>
                <tr style={{ borderBottom: "1px solid var(--border)" }}>
                  <th style={{ textAlign: "left", padding: "12px 16px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>월</th>
                  <th style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>고정비</th>
                  <th style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>변동비</th>
                  <th style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>합계</th>
                  <th style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>고정비 비중</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const sum = r.fixedCosts + r.variableCosts;
                  const fixedPct = sum > 0 ? Math.round((r.fixedCosts / sum) * 100) : 0;
                  return (
                    <tr key={r.month} className="hover:bg-[var(--bg-surface)]/60 transition" style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "11px 16px", color: "var(--text)" }}>{monthLabel(r.month)}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", color: "var(--warning)", fontWeight: 600, cursor: "pointer" }}
                        title="클릭하면 이 달 고정비 산출 내역을 봅니다"
                        onClick={() => setMonthDetail({ month: r.month, rowKey: "fixedCosts", title: `${monthLabel(r.month)} 고정비` })}
                        className="hover:underline">{fmtKrw(r.fixedCosts)}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", color: "var(--info)", fontWeight: 600, cursor: "pointer" }}
                        title="클릭하면 이 달 변동비 산출 내역을 봅니다"
                        onClick={() => setMonthDetail({ month: r.month, rowKey: "variableCosts", title: `${monthLabel(r.month)} 변동비` })}
                        className="hover:underline">{fmtKrw(r.variableCosts)}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", color: "var(--text)", fontWeight: 700 }}>{fmtKrw(sum)}</td>
                      <td style={{ padding: "11px 16px" }}>
                        {sum > 0 ? (
                          <div className="flex items-center justify-end gap-2">
                            <div className="hidden sm:block w-16 h-1.5 rounded-full overflow-hidden bg-[var(--bg-surface)]">
                              <div className="h-full rounded-full" style={{ width: `${fixedPct}%`, background: "var(--warning)" }} />
                            </div>
                            <span className="mono-number tabular-nums" style={{ fontSize: 12, color: "var(--text-dim)", minWidth: 30, textAlign: "right" }}>{fixedPct}%</span>
                          </div>
                        ) : <span style={{ color: "var(--text-dim)" }}>-</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-surface)" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 700, color: "var(--text)" }}>합계</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "var(--warning)" }}>{fmtKrw(totals.fixed)}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "var(--info)" }}>{fmtKrw(totals.variable)}</td>
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
                <div style={{ padding: "12px 16px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 14, color: "var(--warning)" }}>
                  고정비 세부내역 ({year}년)
                </div>
                {breakdown.fixed.length === 0 ? (
                  <div className="py-12 px-5 text-center">
                    <div className="text-3xl mb-2">🏢</div>
                    <div className="text-[13px] font-semibold text-[var(--text)]">등록된 고정비가 없습니다.</div>
                    <div className="text-xs text-[var(--text-dim)] mt-1.5">결제 → 정기결제 등록에서 임차료·급여·4대보험 등을 추가하세요.</div>
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th style={{ textAlign: "left", padding: "10px 16px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600 }}>항목</th>
                      <th style={{ textAlign: "right", padding: "10px 16px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600 }}>월 평균</th>
                      <th style={{ textAlign: "right", padding: "10px 16px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600 }}>올해 누계</th>
                      <th style={{ textAlign: "right", padding: "10px 16px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600 }}>비중</th>
                    </tr></thead>
                    <tbody>
                      {breakdown.fixed.map((r) => (
                        <tr key={r.category} style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                          title="클릭하면 이 항목의 산출 내역을 봅니다"
                          className="hover:bg-[var(--bg-surface)]/60"
                          onClick={() => setCatDetail({ kind: "fixed", category: r.category, label: r.label })}>
                          <td style={{ padding: "10px 16px", color: "var(--text)" }}>{r.label}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right", color: "var(--text-muted)" }}>{fmtKrw(r.monthly)}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right", color: "var(--warning)", fontWeight: 600 }}>{fmtKrw(r.amount)}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right", color: "var(--text-dim)" }}>{breakdown.fixedTotal > 0 ? `${Math.round(r.amount / breakdown.fixedTotal * 100)}%` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-surface)" }}>
                      <td style={{ padding: "11px 16px", fontWeight: 700 }}>합계</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 700, color: "var(--text-muted)" }}>{fmtKrw(breakdown.fixed.reduce((s, r) => s + r.monthly, 0))}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 700, color: "var(--warning)" }}>{fmtKrw(breakdown.fixedTotal)}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 700, color: "var(--text-dim)" }}>100%</td>
                    </tr></tfoot>
                  </table>
                )}
              </div>

              {/* 변동비 세부내역 */}
              <div className="glass-card" style={{ overflow: "hidden" }}>
                <div style={{ padding: "12px 16px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 14, color: "var(--info)" }}>
                  변동비 세부내역 ({year}년)
                </div>
                {breakdown.variable.length === 0 ? (
                  <div className="py-12 px-5 text-center">
                    <div className="text-3xl mb-2">💳</div>
                    <div className="text-[13px] font-semibold text-[var(--text)]">집계된 변동비가 없습니다.</div>
                    <div className="text-xs text-[var(--text-dim)] mt-1.5">카드 사용액·일회성 지출이 쌓이면 여기에 집계됩니다.</div>
                  </div>
                ) : (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead><tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th style={{ textAlign: "left", padding: "10px 16px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600 }}>항목</th>
                      <th style={{ textAlign: "right", padding: "10px 16px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600 }}>올해 누계</th>
                      <th style={{ textAlign: "right", padding: "10px 16px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600 }}>비중</th>
                    </tr></thead>
                    <tbody>
                      {breakdown.variable.map((r) => (
                        <tr key={r.category} style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                          title="클릭하면 이 항목의 산출 내역을 봅니다"
                          className="hover:bg-[var(--bg-surface)]/60"
                          onClick={() => setCatDetail({ kind: "variable", category: r.category, label: r.label })}>
                          <td style={{ padding: "10px 16px", color: "var(--text)" }}>{r.label}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right", color: "var(--info)", fontWeight: 600 }}>{fmtKrw(r.amount)}</td>
                          <td style={{ padding: "10px 16px", textAlign: "right", color: "var(--text-dim)" }}>{breakdown.variableTotal > 0 ? `${Math.round(r.amount / breakdown.variableTotal * 100)}%` : "-"}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-surface)" }}>
                      <td style={{ padding: "11px 16px", fontWeight: 700 }}>합계</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", fontWeight: 700, color: "var(--info)" }}>{fmtKrw(breakdown.variableTotal)}</td>
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
            - 고정비는 등록된 고정비 항목·정기결제(임대료·급여·4대보험·구독 등)에 <strong style={{ color: "var(--text-muted)" }}>통장 거래에서 &lsquo;고정비&rsquo;로 체크한 지출</strong>을 더해 합산합니다.
            <br />
            - 변동비는 법인카드 사용액과 일회성 지출(결제 대기 항목)을 합산합니다.
            <br />
            - 금액을 클릭하면 어떤 내역으로 산출됐는지 팝업으로 확인할 수 있습니다.
            <br />
            - 고정비 비중이 높을수록 매출이 줄어도 줄이기 어려운 비용 구조입니다.
          </div>

          {/* 산출 내역 팝업 — 월별 셀(경영흐름 드릴다운과 동일 로직) */}
          {monthDetail && companyId && (
            <CellDetail
              companyId={companyId}
              year={year}
              month={parseInt(monthDetail.month.split("-")[1], 10)}
              rowKey={monthDetail.rowKey}
              title={monthDetail.title}
              clientItems={null}
              note={monthDetail.rowKey === "fixedCosts" ? FIXED_NOTE : VARIABLE_NOTE}
              onClose={() => setMonthDetail(null)}
            />
          )}
          {/* 산출 내역 팝업 — 세부내역 카테고리 행 */}
          {catDetail && companyId && (
            <CategoryDetailModal
              companyId={companyId} year={year}
              kind={catDetail.kind} category={catDetail.category} label={catDetail.label}
              onClose={() => setCatDetail(null)}
            />
          )}
        </>
      )}
    </div>
  );
}
