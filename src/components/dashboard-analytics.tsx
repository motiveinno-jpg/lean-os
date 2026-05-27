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

  // 매출 — monthly_financials.revenue 합 (해당 연도). 읽기 전용, 계산 무변경.
  const { data: revenue = 0 } = useQuery({
    queryKey: ["analytics-revenue", companyId, year],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("monthly_financials")
        .select("revenue, month")
        .eq("company_id", companyId);
      return (data || [])
        .filter((r: any) => String(r.month || "").startsWith(String(year)))
        .reduce((s: number, r: any) => s + Number(r.revenue || 0), 0);
    },
    enabled: !!companyId,
  });

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
    <div className="space-y-4">
      {/* 탭 + 연도 네비 */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1 bg-[var(--bg-surface)] rounded-xl p-1 border border-[var(--border)]">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`px-3.5 py-1.5 text-xs font-bold rounded-lg transition ${
                tab === t.key ? "bg-[var(--info)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
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
            className="px-3 py-2 text-xs font-semibold rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--primary)]/50 transition disabled:opacity-50">
            {isFetching ? "..." : "↻ 새로고침"}
          </button>
        </div>
      </div>

      {/* ── 소비 탭 ── */}
      {tab === "consume" && (
        <>
          <div className="glass-card p-4 sm:p-5">
            <div className="text-[11px] text-[var(--text-dim)] mb-1">{year}년 총 지출</div>
            <div className="text-2xl sm:text-3xl font-extrabold mono-number text-[var(--danger)]">{wonOut(totalExpense)}</div>
          </div>

          {bdLoading ? (
            <div className="p-10 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <CostColumn title="고정비" accent="#f97316" total={fixedTotal} share={pct(fixedTotal, totalExpense)}
                items={(breakdown?.fixed || []).map((r) => ({ label: r.label, amount: r.amount }))} />
              <CostColumn title="변동비" accent="#8b5cf6" total={variableTotal} share={pct(variableTotal, totalExpense)}
                items={(breakdown?.variable || []).map((r) => ({ label: r.label, amount: r.amount }))} />
              <CostColumn title="기타" accent="var(--text-muted)" total={0} share={0} items={[]} />
            </div>
          )}

          {/* 하단 요약 3열: 카드 / 통장 / 매출 */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
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
              <div className="text-[11px] text-[var(--text-muted)] px-1 py-2">{year}년 누적 매출 (세금계산서·집계 기준)</div>
            </SummaryCard>
          </div>
        </>
      )}

      {/* ── 손익 탭 ── */}
      {tab === "pnl" && (
        <StatPanel
          title={`${year}년 손익`}
          big={won(revenue - totalExpense)}
          bigColor={revenue - totalExpense >= 0 ? "var(--success)" : "var(--danger)"}
          rows={[
            { label: "매출", value: won(revenue) },
            { label: "총 비용", value: wonOut(totalExpense) },
            { label: "고정비", value: wonOut(fixedTotal) },
            { label: "변동비", value: wonOut(variableTotal) },
          ]}
          href="/reports/pnl"
          hrefLabel="손익계산서 자세히 보기 →"
        />
      )}

      {/* ── 자산 탭 ── */}
      {tab === "asset" && (
        <StatPanel
          title="자산 현황"
          big={won(bankTotal)}
          bigColor="var(--text)"
          rows={[
            { label: "계좌 잔액 합", value: won(bankTotal) },
            { label: "계좌 수", value: `${bankAccounts.length}개` },
          ]}
          href="/vault"
          hrefLabel="자산(보관함) 자세히 보기 →"
        />
      )}

      {/* ── 태그 탭 ── */}
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

      {/* ── 인원 탭 ── */}
      {tab === "people" && (
        <StatPanel
          title="인원별 급여"
          big="자세히 보기"
          bigColor="var(--primary)"
          rows={[{ label: "직원별 급여 집계", value: "리포트 연계" }]}
          href="/reports/by-person"
          hrefLabel="인원별 급여 보기 →"
        />
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
    <div className="glass-card p-4">
      <div className="flex items-center justify-between mb-1">
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
        <div className="space-y-1.5">
          {shown.map((it) => (
            <div key={it.label} className="flex items-center justify-between text-xs">
              <span className="text-[var(--text-muted)] truncate pr-2">{it.label}</span>
              <span className="mono-number text-[var(--text)] shrink-0">
                {wonOut(it.amount)}
                <span className="ml-1.5 text-[10px] text-[var(--text-dim)]">{pct(it.amount, total)}%</span>
              </span>
            </div>
          ))}
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
    <div className="glass-card p-4 flex flex-col">
      <div className="flex items-center justify-between mb-2">
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
    <div className="glass-card p-5 max-w-xl">
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
