"use client";
import { logRead } from "@/lib/log-read";

// 대시보드 활동 요약 카드 — "오너뷰에서 지금 일어나는 일"을 표 형태로 한눈에(2026-07-14).
//   깔끔한 카드(제목 + 전체보기 → / 표 행 + 상태 뱃지). 최근 프로젝트·최근 세금계산서.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase;

function won(n: number): string {
  const a = Math.abs(n);
  if (a >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (a >= 10000) return `${Math.round(n / 10000).toLocaleString("ko")}만`;
  return n.toLocaleString("ko");
}
function md(d?: string | null): string {
  const s = (d || "").slice(0, 10);
  const [, m, day] = s.split("-");
  return m && day ? `${Number(m)}/${Number(day)}` : "";
}
const soft = (c: string, p = 12) => `color-mix(in srgb, ${c} ${p}%, transparent)`;

// ── 공용 카드 셸 ──
export function ActivityCard({ title, href, hrefLabel = "전체보기", empty, children, count }: {
  title: string; href: string; hrefLabel?: string; empty?: boolean; count?: number; children: React.ReactNode;
}) {
  return (
    <div className="activity-card glass-card">
      <div className="activity-card-header">
        <div className="flex items-baseline gap-1.5 min-w-0">
          <h3 className="text-[13px] font-bold text-[var(--text)] truncate">{title}</h3>
          {count != null && count > 0 && <span className="text-[11px] font-semibold text-[var(--text-dim)] mono-number">{count}</span>}
        </div>
        <Link href={href} className="text-[11px] font-semibold text-[var(--primary)] hover:underline shrink-0 no-underline">{hrefLabel} →</Link>
      </div>
      {empty
        ? <div className="activity-card-empty">표시할 내용이 없습니다.</div>
        : <div className="activity-card-rows">{children}</div>}
    </div>
  );
}

function Badge({ label, tone }: { label: string; tone: string }) {
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0" style={{ background: soft(tone, 14), color: tone }}>{label}</span>;
}

// ── 최근 프로젝트 ──
const STAGE: Record<string, { l: string; c: string }> = {
  estimate: { l: "견적", c: "var(--text-dim)" },
  quote: { l: "견적", c: "var(--text-dim)" },
  contract: { l: "계약", c: "var(--primary)" },
  in_progress: { l: "진행", c: "var(--info)" },
  ongoing: { l: "진행", c: "var(--info)" },
  delivered: { l: "완료", c: "var(--success)" },
  completed: { l: "완료", c: "var(--success)" },
  settled: { l: "정산", c: "var(--success)" },
};

export function RecentProjects({ companyId }: { companyId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["dash-recent-projects", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const data = logRead('components/dashboard-activity:data', await db.from("deals").select("id, name, stage, contract_total, updated_at")
        .eq("company_id", companyId).is("archived_at", null).is("parent_deal_id", null)
        .order("updated_at", { ascending: false }).limit(5));
      return (data || []) as any[];
    },
  });
  return (
    <ActivityCard title="최근 프로젝트" href="/projecthub" empty={data.length === 0}>
      {data.map((p) => {
        const st = STAGE[p.stage] || { l: p.stage || "-", c: "var(--text-dim)" };
        return (
          <Link key={p.id} href={`/projecthub/${p.id}`} className="project-row">
            <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">{p.name || "프로젝트"}</span>
            <Badge label={st.l} tone={st.c} />
            <span className="text-[11px] mono-number text-[var(--text-muted)] shrink-0 w-16 text-right">{p.contract_total ? won(Number(p.contract_total)) : "-"}</span>
          </Link>
        );
      })}
    </ActivityCard>
  );
}

// ── 이번 달 매출 (총액 + 최근 매출 내역) ──
export function RecentRevenue({ companyId }: { companyId: string }) {
  const { data } = useQuery({
    queryKey: ["dash-recent-revenue", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const now = new Date();
      const mStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
      const data = logRead('components/dashboard-activity:data', await db.from("tax_invoices").select("id, counterparty_name, supply_amount, issue_date")
        .eq("company_id", companyId).eq("type", "sales").neq("status", "void")
        .gte("issue_date", mStart).order("issue_date", { ascending: false }).limit(30));
      const rows = (data || []) as any[];
      return { rows: rows.slice(0, 4), total: rows.reduce((s, r) => s + Number(r.supply_amount || 0), 0), count: rows.length };
    },
  });
  return (
    <ActivityCard title="이번 달 매출" href="/reports/revenue" hrefLabel="매출 현황" empty={!data || data.count === 0}>
      {data && (
        <>
          <div className="revenue-total-row">
            <span className="text-[11px] text-[var(--text-dim)]">이번 달 합계 ({data.count}건)</span>
            <span className="text-[15px] leading-none font-extrabold mono-number" style={{ color: "var(--success)" }}>{won(data.total)}</span>
          </div>
          {data.rows.map((r) => (
            <Link key={r.id} href="/tax-invoices" className="revenue-row">
              <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">{r.counterparty_name || "-"}</span>
              <span className="text-[10px] text-[var(--text-dim)] shrink-0">{md(r.issue_date)}</span>
              <span className="text-[11px] mono-number text-[var(--text-muted)] shrink-0 w-16 text-right">{won(Number(r.supply_amount || 0))}</span>
            </Link>
          ))}
        </>
      )}
    </ActivityCard>
  );
}

// ── 최근 세금계산서 ──
export function RecentInvoices({ companyId }: { companyId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["dash-recent-invoices", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const data = logRead('components/dashboard-activity:data', await db.from("tax_invoices").select("id, counterparty_name, total_amount, type, issue_date, status")
        .eq("company_id", companyId).neq("status", "void")
        .order("issue_date", { ascending: false }).limit(5));
      return (data || []) as any[];
    },
  });
  return (
    <ActivityCard title="최근 세금계산서" href="/tax-invoices" empty={data.length === 0}>
      {data.map((inv) => {
        const isSales = inv.type === "sales";
        return (
          <Link key={inv.id} href="/tax-invoices" className="invoice-row">
            <Badge label={isSales ? "매출" : "매입"} tone={isSales ? "var(--success)" : "var(--warning)"} />
            <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">{inv.counterparty_name || "-"}</span>
            <span className="text-[10px] text-[var(--text-dim)] shrink-0">{md(inv.issue_date)}</span>
            <span className="text-[11px] mono-number text-[var(--text-muted)] shrink-0 w-16 text-right">{won(Number(inv.total_amount || 0))}</span>
          </Link>
        );
      })}
    </ActivityCard>
  );
}
