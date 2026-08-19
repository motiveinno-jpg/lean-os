"use client";

import { useEffect, useState, useMemo } from "react";
import { ReportHead } from "../_components/ReportHead";
import { Stat } from "@/components/query-kit";
import { Ico } from "@/components/ui-icon";
import { useQuery } from "@tanstack/react-query";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { getMonthlyBudgetOverview, getCostBreakdown, getCostCategoryDetail, type MonthlyBudget, type CostBreakdown } from "@/lib/cash-budget";
import { CellDetail } from "../flow/_components/CellDetail";
import { StackedAreaChart, Legend, vizColor } from "@/components/charts/kit";

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
const FIXED_NOTE = "고정비 = 급여(재직 직원) + 정기결제(활성) + 고정비 등록 항목 + 통장 거래 중 '고정비' 체크(전표처리·매핑에서 체크)된 지출의 합입니다. 같은 지출이 정기결제와 통장 체크 거래에 모두 있으면(이름·금액 매칭) 통장 거래는 자동 제외돼 중복 집계되지 않습니다. 대출 상환·미지급금 상환처럼 계정 성격이 비용이 아닌 거래는 고정비 체크가 돼 있어도 제외합니다.";
const VARIABLE_NOTE = "변동비 = 법인카드 사용액 + 일회성 지출(결제 대기, 취소 건 제외)의 합입니다.";

// 세부내역(카테고리) 행 클릭 → 산출 내역 팝업. getCostCategoryDetail 로 개별 레코드 조회 후 CellDetail 재사용.
//   정기결제 항목(recurringId 보유)은 여기서 바로 '제거'(비활성화) 가능 — 예전 등록 건 정리 (사장님 QA 2026-07-10).
function CategoryDetailModal({ companyId, year, kind, category, label, onClose, onChanged }: {
  companyId: string; year: number; kind: "fixed" | "variable"; category: string; label: string; onClose: () => void; onChanged?: () => void;
}) {
  const { data, refetch } = useQuery({
    queryKey: ["cost-category-detail", companyId, year, kind, category],
    queryFn: () => getCostCategoryDetail(companyId, year, kind, category),
  });
  const items = data ?? [];
  const hasRemovable = items.some((i) => i.recurringId);
  const [removing, setRemoving] = useState<string | null>(null);

  // 읽기 전용 산출 내역 팝업(정기결제 제거 가능 분기) — ESC로만 닫기.
  //   CellDetail 재사용 분기(!hasRemovable)는 CellDetail 자체 ESC 처리가 있어 비활성.
  useModalKeys(hasRemovable, onClose);

  const removeRecurring = async (id: string) => {
    setRemoving(id);
    try {
      const { supabase } = await import("@/lib/supabase");
      const { error } = await supabase.from("recurring_payments").update({ is_active: false }).eq("id", id);
      if (error) throw error;
      await refetch();
      onChanged?.();
    } catch { /* 표시 유지 */ }
    finally { setRemoving(null); }
  };

  // 정기결제 항목이 있으면 제거 버튼 있는 자체 모달, 아니면 기존 CellDetail 재사용
  if (hasRemovable) {
    const total = items.reduce((s, i) => s + i.amount, 0);
    return (
      <div className="cost-detail-modal-overlay fixed inset-0" onClick={onClose}>
        <div className="cost-detail-modal-box" onClick={(e) => e.stopPropagation()}>
          <div className="cost-detail-modal-header">
            <div>
              <div className="text-sm font-bold text-[var(--text)]">{label} — 고정비 산출 내역</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{year}년 · 정기결제 등록 항목은 여기서 바로 제거할 수 있습니다</div>
            </div>
            <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none" aria-label="닫기">✕</button>
          </div>
          <div className="flex-1 overflow-auto">
            <table className="cost-detail-table">
              <tbody>
                {items.map((it, i) => (
                  <tr key={i} className="border-t border-[var(--border)]/40 first:border-t-0">
                    <td className="px-4 py-2.5">
                      <div className="text-[var(--text)] font-medium">{it.label}</div>
                      {it.sub && <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{it.sub}</div>}
                    </td>
                    <td className="px-4 py-2.5 text-right mono-number text-[var(--text)] whitespace-nowrap">{fmtKrw(it.amount)}</td>
                    <td className="px-3 py-2.5 text-right whitespace-nowrap">
                      {it.recurringId && (
                        <button
                          onClick={() => removeRecurring(it.recurringId!)}
                          disabled={removing === it.recurringId}
                          className="text-[10px] px-2 py-1 rounded text-[var(--danger)] hover:bg-[var(--danger)]/10 disabled:opacity-50"
                          title="이 정기결제를 고정비에서 제거합니다(비활성화 — 결제 이력은 유지)"
                        >{removing === it.recurringId ? "제거 중…" : "제거"}</button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="cost-detail-modal-footer">
            <span className="text-[10px] text-[var(--text-dim)] leading-relaxed max-w-[70%]">{FIXED_NOTE}</span>
            <span className="text-sm font-bold mono-number text-[var(--text)]">{fmtKrw(total)}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <CellDetail
      companyId={companyId} year={year} month={0} rowKey="__category"
      title={`${label} — ${kind === "fixed" ? "고정비" : "변동비"}`}
      subtitle={`${year}년 · 산출 내역`}
      clientItems={items}
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
  const [refreshKey, setRefreshKey] = useState(0); // 정기결제 제거 후 집계 재조회

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
  }, [companyId, year, blocked, refreshKey]);

  //   이 화면은 **지나간 달의 실적**을 본다 — 아직 오지 않은 달의 고정비 전망까지 더하면
  //   아래 세부내역(경과월 기준)과 합계가 어긋난다 (2026-08-10 사장님 지적으로 드러남).
  //   앞날 전망은 경영흐름이 맡는다.
  const shownRows = useMemo(() => {
    if (!rows) return null;
    const now = new Date();
    const elapsed = year < now.getFullYear() ? 12 : year > now.getFullYear() ? 0 : now.getMonth() + 1;
    return rows.slice(0, elapsed);
  }, [rows, year]);

  const totals = useMemo(() => {
    if (!shownRows) return { fixed: 0, variable: 0, total: 0 };
    const fixed = shownRows.reduce((s, r) => s + r.fixedCosts, 0);
    const variable = shownRows.reduce((s, r) => s + r.variableCosts, 0);
    return { fixed, variable, total: fixed + variable };
  }, [shownRows]);

  if (blocked) {
    return <AccessDenied detail="비용 리포트는 회사 구성원 전용입니다 (외부 파트너 제외)." />;
  }

  return (
    <div className="report-costs-page">
      {/* 툴바 — 연도 필터. 페이지 타이틀은 공통 헤더바가 표시 (2026-07-03 라운드6.5) */}
      {/* 리포트 표준 2차(2026-08-19) — 조회 줄(연도)과 핵심 지표는 상자 머리에 고정 */}
      <ReportHead
        bar={<>
          <label className="text-xs font-semibold text-[var(--text-dim)]">연도</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs">
            {[YEAR_NOW, YEAR_NOW - 1, YEAR_NOW - 2].map((y) => (
              <option key={y} value={y}>{y}년</option>
            ))}
          </select>
          <span className="text-[11px] text-[var(--text-dim)]">고정비 = 급여·임대료·정기결제 등 · 변동비 = 카드·일회성 지출 (경과월 누계)</span>
        </>}
        stats={!isLoading && !error && shownRows ? (<>
          <Stat label={`${year}년 고정비`} value={`₩${fmtKrw(totals.fixed)}`} />
          <Stat label={`${year}년 변동비`} value={`₩${fmtKrw(totals.variable)}`} />
          <Stat label={`${year}년 총비용`} value={`₩${fmtKrw(totals.total)}`} tone="minus" />
        </>) : undefined}
      />

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

      {!isLoading && !error && shownRows && (
        <>
          {/*  연중 비용이 어떻게 흘렀고 그 안에서 고정·변동 비중이 어떻게 변했나 — 누적 영역.
               달마다의 정확한 값은 바로 아래 표가 담당하므로, 이 자리의 일은 흐름을 보여 주는 것이다.
               (2026-08-07: 자체 SVG 누적 막대 → 차트 키트. 손을 올리면 그 달의 고정·변동·합계가 함께 뜬다.
                색도 계열색으로 바꿨다 — 고정비·변동비는 경고/정보 같은 '상태'가 아니라 분류다.) */}
          <div className="costs-chart-container glass-card">
            <div className="mb-4">
              <h3 className="text-sm font-bold text-[var(--text)]">월별 고정비 · 변동비</h3>
              <p className="text-[10px] text-[var(--text-dim)] mt-0.5">아래쪽이 고정비 · 쌓은 높이가 그 달의 총비용</p>
            </div>
            <StackedAreaChart height={220} unit="원"
              labels={shownRows.map((r) => `${parseInt(r.month.split("-")[1], 10)}월`)}
              series={[
                { name: "고정비", values: shownRows.map((r) => r.fixedCosts) },
                { name: "변동비", values: shownRows.map((r) => r.variableCosts) },
              ]} />
            <Legend items={[{ name: "고정비", color: vizColor(0) }, { name: "변동비", color: vizColor(1) }]} />
          </div>

          {/* Monthly table */}
          <div className="costs-monthly-table-card glass-card" style={{ overflowX: "auto", marginTop: 24 }}>
            {/* 머리단은 공용 표 머리단(색·선) — 조회 표준 Wave 5 (2026-08-18) */}
            <table className="ev-table ev-lined rpt-table costs-monthly-table" style={{ fontSize: 13 }}>
              <thead>
                <tr>
                  <th>월</th>
                  <th>고정비</th>
                  <th>변동비</th>
                  <th>합계</th>
                  <th>고정비 비중</th>
                </tr>
              </thead>
              <tbody>
                {shownRows.map((r) => {
                  const sum = r.fixedCosts + r.variableCosts;
                  const fixedPct = sum > 0 ? Math.round((r.fixedCosts / sum) * 100) : 0;
                  return (
                    <tr key={r.month} className="costs-monthly-table-row" style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "11px 16px", color: "var(--text)" }}>{monthLabel(r.month)}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", color: "var(--warning)", fontWeight: 600, cursor: "pointer" }}
                        title="클릭하면 이 달 고정비 산출 내역을 봅니다"
                        onClick={() => setMonthDetail({ month: r.month, rowKey: "fixedCosts", title: `${monthLabel(r.month)} 고정비` })}
                        className="costs-fixed-cell">{fmtKrw(r.fixedCosts)}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", color: "var(--info)", fontWeight: 600, cursor: "pointer" }}
                        title="클릭하면 이 달 변동비 산출 내역을 봅니다"
                        onClick={() => setMonthDetail({ month: r.month, rowKey: "variableCosts", title: `${monthLabel(r.month)} 변동비` })}
                        className="costs-variable-cell">{fmtKrw(r.variableCosts)}</td>
                      <td style={{ padding: "11px 16px", textAlign: "right", color: "var(--text)", fontWeight: 700 }}>{fmtKrw(sum)}</td>
                      <td style={{ padding: "11px 16px" }}>
                        {sum > 0 ? (
                          <div className="costs-fixed-ratio-bar">
                            <div className="hidden sm:block w-16 h-1.5 rounded-full overflow-hidden bg-[var(--bg-surface)]">
                              <div className="h-full rounded-full" style={{ width: `${fixedPct}%`, background: "var(--viz-1)" }} />
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
            <div className="costs-breakdown-grid" style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 18, marginTop: 24 }}>
              {/* 고정비 세부내역 */}
              <div className="costs-fixed-breakdown-card glass-card" style={{ overflowX: "auto" }}>
                <div style={{ padding: "12px 16px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 14, color: "var(--warning)" }}>
                  고정비 세부내역 ({year}년)
                </div>
                {breakdown.fixed.length === 0 ? (
                  <div className="py-12 px-5 text-center">
                    <div className="text-3xl mb-2"><Ico e="🏢" /></div>
                    <div className="text-[13px] font-semibold text-[var(--text)]">등록된 고정비가 없습니다.</div>
                    <div className="text-xs text-[var(--text-dim)] mt-1.5">결제 → 정기결제 등록에서 임차료·급여·4대보험 등을 추가하세요.</div>
                  </div>
                ) : (
                  <table className="ev-table ev-lined costs-detail-tbl" style={{ fontSize: 13 }}>
                    <thead><tr>
                      <th>항목</th>
                      <th>월 평균</th>
                      <th>올해 누계</th>
                      <th>비중</th>
                    </tr></thead>
                    <tbody>
                      {breakdown.fixed.map((r) => (
                        <tr key={r.category} style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                          title="클릭하면 이 항목의 산출 내역을 봅니다"
                          className="costs-fixed-breakdown-row"
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
              <div className="costs-variable-breakdown-card glass-card" style={{ overflowX: "auto" }}>
                <div style={{ padding: "12px 16px", background: "var(--bg-surface)", borderBottom: "1px solid var(--border)", fontWeight: 700, fontSize: 14, color: "var(--info)" }}>
                  변동비 세부내역 ({year}년)
                </div>
                {breakdown.variable.length === 0 ? (
                  <div className="py-12 px-5 text-center">
                    <div className="text-3xl mb-2"><Ico e="💳" /></div>
                    <div className="text-[13px] font-semibold text-[var(--text)]">집계된 변동비가 없습니다.</div>
                    <div className="text-xs text-[var(--text-dim)] mt-1.5">카드 사용액·일회성 지출이 쌓이면 여기에 집계됩니다.</div>
                  </div>
                ) : (
                  <table className="ev-table ev-lined costs-detail-tbl" style={{ fontSize: 13 }}>
                    <thead><tr>
                      <th>항목</th>
                      <th>올해 누계</th>
                      <th>비중</th>
                    </tr></thead>
                    <tbody>
                      {breakdown.variable.map((r) => (
                        <tr key={r.category} style={{ borderTop: "1px solid var(--border)", cursor: "pointer" }}
                          title="클릭하면 이 항목의 산출 내역을 봅니다"
                          className="costs-variable-breakdown-row"
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
            className="costs-footer-note"
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
            - 고정비는 <strong style={{ color: "var(--text-muted)" }}>재직 직원 급여</strong>·정기결제·등록 고정비에 <strong style={{ color: "var(--text-muted)" }}>통장 거래에서 &lsquo;고정비&rsquo;로 체크한 지출</strong>을 더해 합산합니다.
            <br />
            - 변동비는 법인카드 사용액과 일회성 지출(결제 대기, 취소 건 제외)을 합산합니다.
            <br />
            - <strong style={{ color: "var(--text-muted)" }}>계정 성격이 비용이 아닌 거래는 제외</strong>합니다 — 대출 원금 상환·미지급금 상환·보증금·이체는 돈이 나가도 비용이 아니라 재무상태표 항목입니다.
            <br />
            - 이 화면은 <strong style={{ color: "var(--text-muted)" }}>지나간 달의 실적</strong>만 봅니다(앞날 전망은 경영흐름). 손익계산서와는 기준이 다릅니다 — 여기는 <strong style={{ color: "var(--text-muted)" }}>돈이 나간 시점</strong>, 손익계산서는 세금계산서 발행 시점(발생주의)입니다.
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
              onChanged={() => setRefreshKey((k) => k + 1)}
            />
          )}
        </>
      )}
    </div>
  );
}
