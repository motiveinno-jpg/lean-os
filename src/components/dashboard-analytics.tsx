"use client";

// granter 홈 스타일 분석 대시보드 (2026-05-27, 핵심부터 점진):
//   탭(소비/손익/자산/태그/인원) + 소비 3열(고정비/변동비/기타 카테고리) + 하단 카드/통장/매출 요약.
//   기존 owner 위젯은 "경영" 뷰로 보존(상위 토글). 계산 로직 무변경 — 기존 lib 재사용.
//   - 소비: getCostBreakdown(연도) 재사용 (reports/costs 와 동일 집계)
//   - 카드: getCardSpendByCompany / 통장: getDistinctBankAccountNos (카드·통장 granter 재설계분과 동일 소스)
//   - 손익/자산/태그/인원: 핵심부터 단계 — 요약 수치 + 기존 리포트로 연결(후속 확장)

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCostBreakdown } from "@/lib/cash-budget";
import { getCardSpendByCompany } from "@/lib/card-transactions";
import { getDistinctBankAccountNos } from "@/lib/queries";
import { loadSalaryByPerson, type PersonSalaryRow } from "@/lib/by-person";
import { BankAccountsOverview } from "@/components/bank-accounts-overview";
import ByPersonChart from "@/app/(app)/reports/by-person/by-person-chart";

const TABS = [
  { key: "consume", label: "소비" },
  { key: "pnl", label: "손익" },
  { key: "asset", label: "자산" },
  { key: "tag", label: "태그" },
  { key: "people", label: "인원" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

// 지출(빨강, 음수 표기)
function wonOut(n: number): string {
  return `-₩${Math.abs(Math.round(n)).toLocaleString("ko-KR")}`;
}
// 잔액·매출(중립)
function won(n: number): string {
  const neg = n < 0;
  return `${neg ? "-" : ""}₩${Math.abs(Math.round(n)).toLocaleString("ko-KR")}`;
}
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

export function DashboardAnalytics({ companyId }: { companyId: string }) {
  const [tab, setTab] = useState<TabKey>("consume");
  const [year, setYear] = useState(new Date().getFullYear());
  const yearFrom = `${year}-01-01`;
  const yearTo = `${year}-12-31`;

  const { data: breakdown, isLoading: bdLoading, refetch: refetchBd, isFetching } = useQuery({
    queryKey: ["analytics-cost-breakdown", companyId, year],
    queryFn: () => getCostBreakdown(companyId, year),
    enabled: !!companyId,
  });

  const { data: cardSpend } = useQuery({
    queryKey: ["analytics-card-spend", companyId, yearFrom, yearTo],
    queryFn: () => getCardSpendByCompany(companyId, yearFrom, yearTo),
    enabled: !!companyId,
  });

  const { data: bankAccounts = [] } = useQuery({
    queryKey: ["analytics-bank-accounts", companyId],
    queryFn: () => getDistinctBankAccountNos(companyId),
    enabled: !!companyId,
  });

  // 매출 — 2026-06-11 라이브 전환: 세금계산서 공급가액(월별 맵).
  //   기존 monthly_financials.revenue 는 엑셀 임포트 전용이라 실데이터(히어로·하단카드·손익계산서)와 어긋났음.
  const { data: revByMonth } = useQuery<Map<string, number>>({
    queryKey: ["analytics-revenue", companyId, year],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("tax_invoices")
        .select("supply_amount, issue_date")
        .eq("company_id", companyId).eq("type", "sales").neq("status", "void")
        .gte("issue_date", `${year}-01-01`).lt("issue_date", `${year + 1}-01-01`);
      const m = new Map<string, number>();
      (data || []).forEach((r: any) => {
        const k = String(r.issue_date || "").slice(0, 7);
        if (k) m.set(k, (m.get(k) || 0) + Number(r.supply_amount || 0));
      });
      return m;
    },
    enabled: !!companyId,
  });
  const revenue = useMemo(
    () => [...(revByMonth?.values() ?? [])].reduce((s, v) => s + v, 0),
    [revByMonth],
  );

  // 손익 탭 — 월별 매출(라이브 계산서)·비용(monthly_financials 집계). 월 union 으로 계산서만 있는 달도 표시.
  const { data: monthlyPnl = [] } = useQuery({
    queryKey: ["analytics-monthly-pnl", companyId, year, revByMonth?.size ?? -1],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("monthly_financials")
        .select("month, total_expense")
        .eq("company_id", companyId);
      const expByMonth = new Map<string, number>();
      ((data || []) as Array<{ month: string; total_expense: number }>)
        .filter((r) => String(r.month || "").startsWith(String(year)))
        .forEach((r) => expByMonth.set(String(r.month).slice(0, 7), Number(r.total_expense || 0)));
      const keys = new Set<string>([...expByMonth.keys(), ...(revByMonth?.keys() ?? [])]);
      return [...keys]
        .map((month) => ({ month, revenue: revByMonth?.get(month) || 0, expense: expByMonth.get(month) || 0 }))
        .sort((a, b) => a.month.localeCompare(b.month));
    },
    enabled: !!companyId && !!revByMonth,
  });

  // 인원 탭 — 직원별 급여 (loadSalaryByPerson, 카드 사용액 제외)
  const { data: salaryRows = [] } = useQuery<PersonSalaryRow[]>({
    queryKey: ["analytics-salary-by-person", companyId, year],
    queryFn: () => loadSalaryByPerson(companyId, year),
    enabled: !!companyId,
  });

  // 자산 탭 — BankAccountsOverview 내부 선택 상태(시각용)
  const [assetSelected, setAssetSelected] = useState<string>("");

  const fixedTotal = breakdown?.fixedTotal ?? 0;
  const variableTotal = breakdown?.variableTotal ?? 0;
  const totalExpense = fixedTotal + variableTotal;

  const cardTotal = cardSpend?.total ?? 0;
  const cardList = useMemo(() => {
    const all = (cardSpend?.groups || []).flatMap((g) => g.cards);
    return [...all].sort((a, b) => Math.abs(b.spend) - Math.abs(a.spend));
  }, [cardSpend]);

  const bankTotal = bankAccounts.reduce((s, a) => s + (a.balance || 0), 0);
  const bankSorted = useMemo(
    () => [...bankAccounts].sort((a, b) => (b.balance || 0) - (a.balance || 0)),
    [bankAccounts],
  );

  return (
    <div className="dashboard-analytics space-y-4">
      {/* 탭 + 연도 네비 */}
      <div className="dashboard-analytics-toolbar flex flex-wrap items-center justify-between gap-3">
        <div className="seg-bar">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`seg-item ${tab === t.key ? "seg-item-active" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1 bg-[var(--bg-surface)] rounded-xl px-1 py-1 border border-[var(--border)]">
            <button onClick={() => setYear((y) => y - 1)} className="px-2 py-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)] transition" aria-label="이전 연도">◀</button>
            <span className="text-xs font-semibold text-[var(--text)] mono-number px-1">{year}년</span>
            <button onClick={() => setYear((y) => y + 1)} className="px-2 py-1 rounded-lg text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)] transition" aria-label="다음 연도">▶</button>
          </div>
          <button onClick={() => refetchBd()} disabled={isFetching}
            className="btn-secondary text-xs rounded-xl">
            {isFetching ? "..." : "↻ 새로고침"}
          </button>
        </div>
      </div>

      {/* ── 소비 탭 ── */}
      {tab === "consume" && (
        <>
          <div className="consume-total-card glass-card p-4 sm:p-5">
            <div className="text-[11px] text-[var(--text-dim)] mb-1">{year}년 총 지출</div>
            <div className="text-2xl sm:text-3xl font-extrabold mono-number text-[var(--danger)]">{wonOut(totalExpense)}</div>
          </div>

          {bdLoading ? (
            <div className="p-10 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
          ) : (
            <div className="consume-cost-columns grid grid-cols-1 md:grid-cols-3 gap-3">
              <CostColumn title="고정비" accent="#f97316" total={fixedTotal} share={pct(fixedTotal, totalExpense)}
                items={(breakdown?.fixed || []).map((r) => ({ label: r.label, amount: r.amount }))} />
              <CostColumn title="변동비" accent="#8b5cf6" total={variableTotal} share={pct(variableTotal, totalExpense)}
                items={(breakdown?.variable || []).map((r) => ({ label: r.label, amount: r.amount }))} />
              <CostColumn title="기타" accent="var(--text-muted)" total={0} share={0} items={[]} />
            </div>
          )}

          {/* 하단 요약 3열: 카드 / 통장 / 매출 */}
          <div className="consume-summary-cards grid grid-cols-1 md:grid-cols-3 gap-3">
            {/* 카드 */}
            <SummaryCard title="카드" total={wonOut(cardTotal)} accent="var(--danger)" href="/cards" allLabel={`${cardList.length}개 전체보기`}>
              {cardList.slice(0, 4).map((c) => (
                <Row key={c.key} left={c.displayName} right={Math.round(c.spend) === 0 ? "₩0" : wonOut(c.spend)} dim={Math.round(c.spend) === 0} />
              ))}
              {cardList.length === 0 && <Empty text="카드 사용 내역 없음" />}
            </SummaryCard>

            {/* 통장 */}
            <SummaryCard title="계좌" total={won(bankTotal)} accent="var(--text)" href="/bank" allLabel={`${bankAccounts.length}개 전체보기`}>
              {bankSorted.slice(0, 4).map((a) => (
                <Row key={a.accountNo} left={a.alias || a.bankName || a.accountNo.slice(-4)} right={won(a.balance || 0)} dim={(a.balance || 0) === 0} />
              ))}
              {bankAccounts.length === 0 && <Empty text="계좌 없음" />}
            </SummaryCard>

            {/* 매출 */}
            <SummaryCard title="매출" total={won(revenue)} accent="var(--success)" href="/reports/pnl" allLabel="손익 상세 보기">
              <div className="text-[11px] text-[var(--text-muted)] px-1 py-2">{year}년 누적 매출 (세금계산서 공급가액 기준)</div>
            </SummaryCard>
          </div>
        </>
      )}

      {/* ── 손익 탭 — 인라인 상세 (매출/총비용/고정/변동 + 월별 P&L 표) ── */}
      {tab === "pnl" && (
        <PnlDetail
          year={year}
          revenue={revenue}
          totalExpense={totalExpense}
          fixedTotal={fixedTotal}
          variableTotal={variableTotal}
          monthly={monthlyPnl}
        />
      )}

      {/* ── 자산 탭 — 인라인 (BankAccountsOverview 직접 렌더) ── */}
      {tab === "asset" && (
        <BankAccountsOverview companyId={companyId} selectedAccountNo={assetSelected} onSelect={setAssetSelected} />
      )}

      {/* ── 태그 탭 — 후속 확장 예정 ── */}
      {tab === "tag" && (
        <StatPanel
          title="태그별 분석"
          big="준비 중"
          bigColor="var(--text-muted)"
          rows={[{ label: "거래 태그·분류별 집계", value: "후속 확장 예정" }]}
          href="/transactions"
          hrefLabel="거래내역에서 분류 보기 →"
        />
      )}

      {/* ── 인원 탭 — 인라인 (직원별 급여 표 + 차트, 카드 제외) ── */}
      {tab === "people" && (
        <PeopleDetail year={year} rows={salaryRows} />
      )}
    </div>
  );
}

function CostColumn({ title, accent, total, share, items }: {
  title: string; accent: string; total: number; share: number;
  items: { label: string; amount: number }[];
}) {
  const [expanded, setExpanded] = useState(false);
  const sorted = [...items].sort((a, b) => b.amount - a.amount);
  const shown = expanded ? sorted : sorted.slice(0, 4);
  return (
    <div className="cost-column glass-card p-4">
      <div className="cost-column-header flex items-center justify-between mb-1">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-full" style={{ background: accent }} />
          <span className="text-sm font-bold text-[var(--text)]">{title}</span>
        </div>
        <span className="text-xs font-bold mono-number" style={{ color: accent }}>{share}%</span>
      </div>
      <div className="text-lg font-extrabold mono-number text-[var(--text)] mb-3">{total === 0 ? "₩0" : wonOut(total)}</div>
      {sorted.length === 0 ? (
        <div className="text-[11px] text-[var(--text-dim)] py-2">항목 없음</div>
      ) : (
        <div className="cost-column-items space-y-2.5">
          {shown.map((it) => {
            const p = pct(it.amount, total);
            return (
              <div key={it.label}>
                <div className="flex items-center justify-between text-xs mb-1">
                  <span className="text-[var(--text-muted)] truncate pr-2">{it.label}</span>
                  <span className="mono-number text-[var(--text)] shrink-0 font-medium">
                    {wonOut(it.amount)}
                    <span className="ml-1.5 text-[10px] text-[var(--text-dim)]">{p}%</span>
                  </span>
                </div>
                <div className="h-1 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${Math.min(p, 100)}%`, background: accent }} />
                </div>
              </div>
            );
          })}
          {sorted.length > 4 && (
            <button onClick={() => setExpanded((v) => !v)} className="text-[11px] font-semibold text-[var(--info)] hover:underline pt-1">
              {expanded ? "접기" : `${sorted.length}개 카테고리 보기`}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SummaryCard({ title, total, accent, href, allLabel, children }: {
  title: string; total: string; accent: string; href: string; allLabel: string; children: React.ReactNode;
}) {
  return (
    <div className="summary-card glass-card p-4 flex flex-col">
      <div className="summary-card-header flex items-center justify-between mb-2">
        <span className="text-sm font-bold text-[var(--info)]">{title}</span>
        <span className="text-base font-extrabold mono-number" style={{ color: accent }}>{total}</span>
      </div>
      <div className="space-y-1 flex-1">{children}</div>
      <Link href={href} className="mt-3 text-[11px] font-semibold text-[var(--info)] hover:underline">{allLabel} →</Link>
    </div>
  );
}

function Row({ left, right, dim }: { left: string; right: string; dim?: boolean }) {
  return (
    <div className="flex items-center justify-between text-xs py-1">
      <span className="text-[var(--text-muted)] truncate pr-2">{left}</span>
      <span className={`mono-number shrink-0 ${dim ? "text-[var(--text-dim)]" : "text-[var(--text)]"}`}>{right}</span>
    </div>
  );
}

function Empty({ text }: { text: string }) {
  return <div className="text-[11px] text-[var(--text-dim)] py-2">{text}</div>;
}

function StatPanel({ title, big, bigColor, rows, href, hrefLabel }: {
  title: string; big: string; bigColor: string;
  rows: { label: string; value: string }[]; href: string; hrefLabel: string;
}) {
  return (
    <div className="stat-panel glass-card p-5 max-w-xl">
      <div className="text-[11px] text-[var(--text-dim)] mb-1">{title}</div>
      <div className="text-2xl sm:text-3xl font-extrabold mono-number mb-4" style={{ color: bigColor }}>{big}</div>
      <div className="space-y-2">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between text-sm border-b border-[var(--border)]/50 pb-2">
            <span className="text-[var(--text-muted)]">{r.label}</span>
            <span className="mono-number font-semibold text-[var(--text)]">{r.value}</span>
          </div>
        ))}
      </div>
      <Link href={href} className="inline-block mt-4 text-xs font-semibold text-[var(--info)] hover:underline">{hrefLabel}</Link>
    </div>
  );
}

// ── 손익 인라인 상세: 큰 영업이익 + 4 stat + 월별 표 ──
function PnlDetail({ year, revenue, totalExpense, fixedTotal, variableTotal, monthly }: {
  year: number;
  revenue: number;
  totalExpense: number;
  fixedTotal: number;
  variableTotal: number;
  monthly: { month: string; revenue: number; expense: number }[];
}) {
  const profit = revenue - totalExpense;
  return (
    <div className="pnl-detail space-y-4">
      <div className="pnl-hero-card glass-card p-4 sm:p-5">
        <div className="text-[11px] text-[var(--text-dim)] mb-1">{year}년 영업이익</div>
        <div className="text-2xl sm:text-3xl font-extrabold mono-number" style={{ color: profit >= 0 ? "var(--success)" : "var(--danger)" }}>
          {won(profit)}
        </div>
        <div className="pnl-stat-grid grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
          <PnlStat label="매출" value={won(revenue)} color="var(--success)" />
          <PnlStat label="총 비용" value={wonOut(totalExpense)} color="var(--danger)" />
          <PnlStat label="고정비" value={wonOut(fixedTotal)} color="#f97316" />
          <PnlStat label="변동비" value={wonOut(variableTotal)} color="#8b5cf6" />
        </div>
      </div>

      <div className="pnl-table-card glass-card overflow-hidden">
        <div className="pnl-table-header px-4 py-3 border-b border-[var(--border)] flex items-center justify-between">
          <div className="text-sm font-bold text-[var(--text)]">월별 손익</div>
          <Link href="/reports/pnl" className="text-[11px] font-semibold text-[var(--primary)] hover:underline">손익계산서 자세히 →</Link>
        </div>
        {monthly.length === 0 ? (
          <div className="p-8 text-center text-sm text-[var(--text-muted)]">{year}년 집계된 손익 데이터가 없습니다.</div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="text-xs text-[var(--text-dim)]">
                <th className="text-left px-4 py-2 font-semibold">월</th>
                <th className="text-right px-4 py-2 font-semibold">매출</th>
                <th className="text-right px-4 py-2 font-semibold">비용</th>
                <th className="text-right px-4 py-2 font-semibold">이익</th>
              </tr>
            </thead>
            <tbody>
              {monthly.map((m) => {
                const p = m.revenue - m.expense;
                return (
                  <tr key={m.month} className="border-b border-[var(--border)] hover:bg-[var(--bg-surface)]/60 transition">
                    <td className="px-4 py-3 text-[var(--text)]">{parseInt(m.month.split("-")[1], 10)}월</td>
                    <td className="px-4 py-3 text-right mono-number text-[var(--success)]">{won(m.revenue)}</td>
                    <td className="px-4 py-3 text-right mono-number text-[var(--danger)]">{wonOut(m.expense)}</td>
                    <td className="px-4 py-3 text-right mono-number font-semibold" style={{ color: p >= 0 ? "var(--success)" : "var(--danger)" }}>{won(p)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function PnlStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div className="border border-[var(--border)] rounded-xl p-3 bg-[var(--bg-surface)]/50">
      <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">{label}</div>
      <div className="text-base font-bold mono-number mt-1" style={{ color }}>{value}</div>
    </div>
  );
}

// ── 인원 인라인 상세: 스탯 3카드 + 차트 + 인원별 랭크 바 리스트 (현대적 리디자인 2026-06-10) ──
function PeopleDetail({ year, rows }: { year: number; rows: PersonSalaryRow[] }) {
  const sorted = [...rows].sort((a, b) => b.payroll - a.payroll);
  const total = sorted.reduce((s, r) => s + r.payroll, 0);
  const max = sorted.length > 0 ? sorted[0].payroll : 0;
  const avg = sorted.length > 0 ? Math.round(total / sorted.length) : 0;
  return (
    <div className="people-detail space-y-5">
      {/* 스탯 3카드 */}
      <div className="people-stat-grid grid grid-cols-3 gap-3 sm:gap-4">
        {[
          { label: "급여 합계", value: won(total), color: "#f97316", sub: `${sorted.length}명 기준` },
          { label: "인원", value: `${sorted.length}명`, color: "var(--info)", sub: "명세서/기본급여" },
          { label: "1인 평균", value: won(avg), color: "#10b981", sub: "합계 ÷ 인원" },
        ].map((s) => (
          <div key={s.label} className="people-stat-card glass-card p-4">
            <div className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-muted)] mb-2">{s.label}</div>
            <div className="text-lg sm:text-xl font-extrabold mono-number tracking-tight truncate" style={{ color: s.color }}>{s.value}</div>
            <div className="text-[10px] text-[var(--text-dim)] mt-1.5 truncate">{s.sub}</div>
          </div>
        ))}
      </div>

      {sorted.length > 0 && (
        <ByPersonChart people={sorted.map((r) => r.key)} payByPerson={Object.fromEntries(sorted.map((r) => [r.key, r.payroll]))} />
      )}

      {/* 인원별 랭크 바 리스트 */}
      <div className="people-rank-card glass-card overflow-hidden">
        <div className="people-rank-header px-5 py-3.5 border-b border-[var(--border)] flex items-center justify-between">
          <div className="text-sm font-bold text-[var(--text)]">인원별 급여 명단</div>
          {/* 인원별 급여 페이지 링크 제거(2026-06-29 사용자 요청) — 페이지·코드는 유지, 링크만 비연동 */}
        </div>
        {sorted.length === 0 ? (
          <div className="p-10 text-center text-sm text-[var(--text-muted)]">{year}년 집계된 급여 데이터가 없습니다.</div>
        ) : (
          <div className="divide-y divide-[var(--border)]/60">
            {sorted.map((r, i) => {
              const share = total > 0 ? (r.payroll / total) * 100 : 0;
              const barPct = max > 0 ? (r.payroll / max) * 100 : 0;
              return (
                <div key={r.key} className="people-rank-row px-4 sm:px-5 py-3 flex items-center gap-3 hover:bg-[var(--bg-surface)]/40 transition">
                  <span className="text-[11px] text-[var(--text-dim)] w-4 text-center shrink-0 mono-number">{i + 1}</span>
                  <span className="w-9 h-9 rounded-full bg-[var(--primary)] flex items-center justify-center text-white text-sm font-bold shrink-0 shadow">{(r.key || "?").slice(0, 1)}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-2 mb-1.5">
                      <span className="text-sm font-semibold text-[var(--text)] truncate">{r.key}</span>
                      <span className="text-sm font-bold mono-number shrink-0" style={{ color: "var(--primary)" }}>{won(r.payroll)}</span>
                    </div>
                    <div className="flex items-center gap-2.5">
                      <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                        <div className="h-full rounded-full" style={{ width: `${barPct}%`, background: "var(--primary)" }} />
                      </div>
                      <span className="text-[10px] text-[var(--text-dim)] mono-number shrink-0 w-10 text-right">{share.toFixed(1)}%</span>
                    </div>
                  </div>
                </div>
              );
            })}
            <div className="people-rank-total px-4 sm:px-5 py-3 flex items-center justify-between bg-[var(--bg-surface)]/50">
              <span className="text-sm font-bold text-[var(--text)]">합계 · {sorted.length}명</span>
              <span className="text-sm font-extrabold mono-number" style={{ color: "var(--primary)" }}>{won(total)}</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
