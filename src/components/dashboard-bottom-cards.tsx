"use client";

// 대시보드 하단 3카드 — 2026-05-27 새 디자인 시안 적용(2차). 실데이터 연결.
//   카드(이번 달 카드별 사용액) · 자산(계좌별 잔액) · 매출(2026 누적, 세금계산서 sales 기준 — 손익 정합).
//   글래스 Card. 상위 항목 + 총액 + "N개 전체보기" 링크. owner/admin 만(호출처 게이트).

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { Card } from "@/components/ui/card";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const fmtW = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

// 매출 월별 영역 라인차트 (시안 Sales Performance) — 인라인 SVG, 새 의존성 없음.
function RevenueSparkline({ series }: { series: number[] }) {
  const W = 280, H = 88, pad = 4;
  const max = Math.max(...series, 1);
  const n = series.length;
  const x = (i: number) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const line = series.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`;
  const lastUp = n >= 2 && series[n - 1] >= series[n - 2];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 88 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="rev-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--success)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--success)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#rev-grad)" />
      <path d={line} fill="none" stroke="var(--success)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(n - 1)} cy={y(series[n - 1])} r="3" fill={lastUp ? "var(--success)" : "var(--danger)"} />
    </svg>
  );
}

export function DashboardBottomCards({ companyId }: { companyId: string }) {
  // 카드 — 이번 달 카드별 사용액 (realVariableData 와 동일 기준: 이번 달 card_transactions)
  const { data: cards } = useQuery({
    queryKey: ["dash-cards", companyId],
    queryFn: async () => {
      // 월 경계 — '-31' 무효날짜(30일 달·2월) 회피. < 다음달 1일.
      const _now = new Date();
      const monthStart = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-01`;
      const _nm = new Date(_now.getFullYear(), _now.getMonth() + 1, 1);
      const nextStart = `${_nm.getFullYear()}-${String(_nm.getMonth() + 1).padStart(2, "0")}-01`;
      const { data } = await db.from("card_transactions").select("card_name, amount")
        .eq("company_id", companyId).gte("transaction_date", monthStart).lt("transaction_date", nextStart);
      const byCard: Record<string, number> = {};
      (data || []).forEach((t: any) => { const k = t.card_name || "기타"; byCard[k] = (byCard[k] || 0) + Number(t.amount || 0); });
      const list = Object.entries(byCard).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
      return { list, total: list.reduce((s, c) => s + c.amount, 0), count: list.length };
    },
    enabled: !!companyId, staleTime: 60_000,
  });

  // 자산 — 계좌별 잔액
  const { data: assets } = useQuery({
    queryKey: ["dash-assets", companyId],
    queryFn: async () => {
      const { data } = await db.from("bank_accounts").select("alias, bank_name, balance")
        .eq("company_id", companyId).order("balance", { ascending: false });
      const list: { name: string; amount: number }[] = (data || []).map((a: any) => ({ name: a.alias || a.bank_name || "계좌", amount: Number(a.balance || 0) }));
      return { list, total: list.reduce((s, a) => s + a.amount, 0), count: list.length };
    },
    enabled: !!companyId, staleTime: 60_000,
  });

  // 매출 — 2026 월별(type='sales', 손익 정합). 누적 total + 월별 시계열(시안 Sales Performance 라인차트).
  const { data: rev } = useQuery({
    queryKey: ["dash-revenue", companyId],
    queryFn: async () => {
      const { data } = await db.from("tax_invoices").select("total_amount, issue_date")
        .eq("company_id", companyId).eq("type", "sales").gte("issue_date", "2026-01-01");
      const monthly = new Array(12).fill(0);
      (data || []).forEach((t: any) => {
        const m = new Date(t.issue_date).getMonth();
        if (m >= 0 && m < 12) monthly[m] += Number(t.total_amount || 0);
      });
      const upto = new Date().getMonth() + 1; // 올해 경과 월까지만
      const series = monthly.slice(0, Math.max(upto, 1));
      return { total: monthly.reduce((s: number, v: number) => s + v, 0), series };
    },
    enabled: !!companyId, staleTime: 60_000,
  });
  const revenue = rev?.total ?? 0;
  const revSeries = rev?.series ?? [];

  const ListRow = ({ name, amount }: { name: string; amount: number }) => (
    <div className="flex justify-between items-center bg-[var(--bg-surface)]/60 p-3 rounded-xl hover:bg-[var(--bg-surface)] transition-colors">
      <span className="text-[13px] text-[var(--text-muted)] truncate mr-2">{name}</span>
      <span className="text-[13px] text-[var(--text)] font-medium tabular-nums shrink-0">{fmtW(amount)}</span>
    </div>
  );
  const MoreLink = ({ href, label }: { href: string; label: string }) => (
    <Link href={href} className="mt-5 w-full text-[13px] text-[var(--brand)] font-semibold hover:text-[var(--brand-to)] bg-[var(--brand)]/5 hover:bg-[var(--brand)]/10 p-3 rounded-xl transition-all flex items-center justify-center gap-2">
      {label}
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
    </Link>
  );

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-6">
      {/* 카드 */}
      <Card hover className="p-6 flex flex-col">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--danger)]/10 to-[var(--danger)]/5 flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--danger)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>
            </div>
            <h3 className="text-[17px] font-semibold text-[var(--text)]">카드</h3>
          </div>
          <span className="text-[15px] text-[var(--danger)] font-semibold tabular-nums">-{fmtW(cards?.total ?? 0)}</span>
        </div>
        <div className="space-y-2.5 flex-1">
          {(cards?.list || []).slice(0, 4).map((c) => <ListRow key={c.name} name={c.name} amount={c.amount} />)}
          {(!cards || cards.list.length === 0) && <div className="text-[13px] text-[var(--text-dim)] text-center py-4">이번 달 카드 사용 없음</div>}
        </div>
        <MoreLink href="/cards" label={`${cards?.count ?? 0}개 전체보기`} />
      </Card>

      {/* 자산 */}
      <Card hover className="p-6 flex flex-col">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--success)]/10 to-[var(--success)]/5 flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>
            </div>
            <h3 className="text-[17px] font-semibold text-[var(--text)]">자산</h3>
          </div>
          <span className="text-[15px] text-[var(--success)] font-semibold tabular-nums">{fmtW(assets?.total ?? 0)}</span>
        </div>
        <div className="space-y-2.5 flex-1">
          {(assets?.list || []).slice(0, 4).map((a) => <ListRow key={a.name} name={a.name} amount={a.amount} />)}
          {(!assets || assets.list.length === 0) && <div className="text-[13px] text-[var(--text-dim)] text-center py-4">등록된 계좌 없음</div>}
        </div>
        <MoreLink href="/transactions" label={`${assets?.count ?? 0}개 전체보기`} />
      </Card>

      {/* 매출 */}
      <Card hover className="p-6 flex flex-col">
        <div className="flex items-center justify-between mb-5">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-gradient-to-br from-[var(--success)]/10 to-[var(--success)]/5 flex items-center justify-center">
              <svg className="w-6 h-6 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>
            </div>
            <h3 className="text-[17px] font-semibold text-[var(--text)]">매출</h3>
          </div>
          <span className="text-[15px] text-[var(--success)] font-semibold tabular-nums">{fmtW(revenue)}</span>
        </div>
        <div className="flex-1 flex flex-col justify-center">
          {revSeries.length > 1 && revenue > 0 ? (
            <RevenueSparkline series={revSeries} />
          ) : (
            <div className="flex justify-between items-center bg-[var(--bg-surface)]/60 p-3 rounded-xl">
              <span className="text-[13px] text-[var(--text-muted)]">2026년 누적 매출 (세금계산서 집계)</span>
              <span className="text-[13px] text-[var(--text)] font-medium tabular-nums shrink-0">{fmtW(revenue)}</span>
            </div>
          )}
          <p className="text-[12px] text-[var(--text-dim)] mt-3 text-center">2026년 누적 (세금계산서 집계)</p>
        </div>
        <MoreLink href="/reports/pnl" label="손익 상세 보기" />
      </Card>
    </div>
  );
}
