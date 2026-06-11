"use client";

// 대시보드 하단 3카드 — 2026-06-09 Stitch 시안 정렬 + 다크/라이트 적응.
//   Cards / Assets / Sales Performance. 표면(카드/행/텍스트/보더)은 테마 토큰 → 다크모드 자동 적응.
//   강조색(아이콘·총액·라인차트 그린/블루/레드)만 사진색 고정.
//   카드(이번 달 카드별 사용액) · 자산(계좌별 잔액) · 매출(2026 월별 라인차트). 실데이터·쿼리 무변경.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const fmtW = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

// 사진 강조 팔레트(고정 발색)
const A = { blue: "#2F7DE1", green: "#1FAE6B", red: "#E0524F" };

// 매출 월별 영역 라인차트 (사진 Sales Performance) — 인라인 SVG, 새 의존성 없음.
function RevenueSparkline({ series }: { series: number[] }) {
  const W = 280, H = 92, pad = 4;
  const max = Math.max(...series, 1);
  const n = series.length;
  const x = (i: number) => pad + (i / (n - 1)) * (W - pad * 2);
  const y = (v: number) => H - pad - (v / max) * (H - pad * 2);
  const line = series.map((v, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(v).toFixed(1)}`).join(" ");
  const area = `${line} L${x(n - 1).toFixed(1)} ${H - pad} L${x(0).toFixed(1)} ${H - pad} Z`;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 92, transform: "translateZ(0)", contain: "paint" }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="rev-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={A.green} stopOpacity="0.24" />
          <stop offset="100%" stopColor={A.green} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill="url(#rev-grad)" />
      <path d={line} fill="none" stroke={A.green} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={x(n - 1)} cy={y(series[n - 1])} r="3" fill={A.green} />
    </svg>
  );
}

export function DashboardBottomCards({ companyId }: { companyId: string }) {
  // 카드 — 이번 달 카드별 사용액
  const { data: cards } = useQuery({
    queryKey: ["dash-cards", companyId],
    queryFn: async () => {
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

  // 매출 — 2026 월별(type='sales'). 누적 total + 월별 시계열.
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
      const upto = new Date().getMonth() + 1;
      const series = monthly.slice(0, Math.max(upto, 1));
      return { total: monthly.reduce((s: number, v: number) => s + v, 0), series };
    },
    enabled: !!companyId, staleTime: 60_000,
  });
  const revenue = rev?.total ?? 0;
  const revSeries = rev?.series ?? [];

  const ListRow = ({ name, amount }: { name: string; amount: number }) => (
    <div className="flex justify-between items-center p-3 rounded-xl bg-[var(--bg-surface)]">
      <span className="text-[13px] truncate mr-2 text-[var(--text-muted)]">{name}</span>
      <span className="text-[13px] font-semibold tabular-nums shrink-0 text-[var(--text)]">{fmtW(amount)}</span>
    </div>
  );
  const Header = ({ title, icon, color }: { title: string; icon: React.ReactNode; color: string }) => (
    <div className="flex items-center gap-2.5 mb-4">
      <div className="w-9 h-9 rounded-lg flex items-center justify-center" style={{ background: `${color}1F`, color }}>{icon}</div>
      <h3 className="text-[16px] font-bold text-[var(--text)]">{title}</h3>
    </div>
  );
  const TotalRow = ({ label, amount, color }: { label: string; amount: number; color?: string }) => (
    <div className="flex justify-between items-center mt-4 pt-4 border-t border-[var(--border)]">
      <span className="text-[13px] font-medium text-[var(--text-muted)]">{label}</span>
      <span className="text-[16px] font-bold tabular-nums text-[var(--text)]" style={color ? { color } : undefined}>{fmtW(amount)}</span>
    </div>
  );
  const MoreLink = ({ href, label }: { href: string; label: string }) => (
    <Link href={href} className="mt-3 w-full text-[12px] font-semibold p-2.5 rounded-xl transition-all flex items-center justify-center gap-1.5"
      style={{ color: A.blue, background: "rgba(47,125,225,0.08)" }}>
      {label}
      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" /></svg>
    </Link>
  );

  const cardCls = "rounded-2xl p-5 flex flex-col bg-[var(--bg-card)] border border-[var(--border)]";
  const cardShadow = { boxShadow: "var(--shadow-sm)" } as const;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-5 mb-6">
      {/* 카드 */}
      <div className={cardCls} style={cardShadow}>
        <Header title="카드" color={A.red}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" /></svg>} />
        <div className="space-y-2.5 flex-1">
          {(cards?.list || []).slice(0, 4).map((c) => <ListRow key={c.name} name={c.name} amount={c.amount} />)}
          {(!cards || cards.list.length === 0) && <div className="text-[13px] text-center py-4 text-[var(--text-dim)]">이번 달 카드 사용 없음</div>}
        </div>
        <TotalRow label="이번 달 사용" amount={cards?.total ?? 0} color={A.red} />
        <MoreLink href="/cards" label={`${cards?.count ?? 0}개 전체보기`} />
      </div>

      {/* 자산 */}
      <div className={cardCls} style={cardShadow}>
        <Header title="자산" color={A.green}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4" /></svg>} />
        <div className="space-y-2.5 flex-1">
          {(assets?.list || []).slice(0, 4).map((a) => <ListRow key={a.name} name={a.name} amount={a.amount} />)}
          {(!assets || assets.list.length === 0) && <div className="text-[13px] text-center py-4 text-[var(--text-dim)]">등록된 계좌 없음</div>}
        </div>
        <TotalRow label="총 자산" amount={assets?.total ?? 0} color={A.green} />
        <MoreLink href="/bank" label={`${assets?.count ?? 0}개 전체보기`} />
      </div>

      {/* 매출 (Sales Performance) */}
      <div className={cardCls} style={cardShadow}>
        <Header title="매출 추이" color={A.green}
          icon={<svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" /></svg>} />
        <div className="flex-1 flex flex-col justify-center">
          {revSeries.length > 1 && revenue > 0 ? (
            <RevenueSparkline series={revSeries} />
          ) : (
            <div className="flex justify-between items-center p-3 rounded-xl bg-[var(--bg-surface)]">
              <span className="text-[13px] text-[var(--text-muted)]">2026년 누적 매출</span>
              <span className="text-[13px] font-semibold tabular-nums shrink-0 text-[var(--text)]">{fmtW(revenue)}</span>
            </div>
          )}
        </div>
        <TotalRow label="2026 누적 (세금계산서)" amount={revenue} />
        <MoreLink href="/reports/pnl" label="손익 상세 보기" />
      </div>
    </div>
  );
}
