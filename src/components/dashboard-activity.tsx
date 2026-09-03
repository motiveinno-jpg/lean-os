"use client";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";

// 대시보드 활동 요약 카드 — "오너뷰에서 지금 일어나는 일"을 표 형태로 한눈에(2026-07-14).
//   깔끔한 카드(제목 + 전체보기 → / 표 행 + 상태 뱃지). 최근 프로젝트·최근 세금계산서.

import Link from "next/link";
import { useReportWidgetEmpty } from "@/components/widget-empty-context";
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
//   2026-08-10 리파인: 링크는 조용한 회색(호버 시 착색) 통일, 빈 상태는 한 줄 안내 +
//   "어떻게 채우는지" 링크(emptyText/emptyAction) — 빈 위젯이 다음 행동을 알려준다.
//   2026-08-19 대시보드 재편 — 모든 위젯이 이 셸 하나로: 머리 한 줄(이름 · 요약(summary) · 머리 도구(headExtra) · 전체보기 →) + 몸통(표 줄).
//   높이는 격자가 정한다(h-full) — 위젯 안에 카드·상자를 또 넣지 않는다(미수금 합계·총 자산 같은 숫자는 summary 로).
//   2026-09-03 v2(결정 149·154·157): 머리 = 이름 · 보조 숫자 · 도구 · → (전체보기 글자 삭제). 비면 격자에 알려 한 줄로 접히고(useReportWidgetEmpty),
//   그 한 줄 안에 이름 · 빈 상태 문장 · 다음 행동 링크만 가로로 놓는다.
export function ActivityCard({ title, href, hrefLabel = "", empty, emptyText = "표시할 내용이 없습니다.", emptyAction, children, count, summary, headExtra }: {
  title: string; href: string; hrefLabel?: string; empty?: boolean;
  emptyText?: string; emptyAction?: { label: string; href: string };
  count?: number; summary?: React.ReactNode; headExtra?: React.ReactNode; children: React.ReactNode;
}) {
  useReportWidgetEmpty(!!empty);
  if (empty) {
    return (
      <div className="activity-card activity-card-quiet glass-card">
        <h3 className="activity-card-title">{title}</h3>
        <span className="widget-empty-text">{emptyText}</span>
        {emptyAction && <Link href={emptyAction.href} className="widget-empty-action">{emptyAction.label} →</Link>}
        <span className="flex-1" />
        <Link href={href} className="widget-more-link">{hrefLabel ? `${hrefLabel} →` : "→"}</Link>
      </div>
    );
  }
  return (
    <div className="activity-card glass-card">
      <div className="activity-card-header">
        <div className="flex items-baseline gap-2 min-w-0">
          <h3 className="activity-card-title">{title}</h3>
          {count != null && count > 0 && <span className="activity-card-count mono-number">{count}</span>}
          {summary && <span className="activity-card-summary">{summary}</span>}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {headExtra}
          <Link href={href} className="widget-more-link">{hrefLabel ? `${hrefLabel} →` : "→"}</Link>
        </div>
      </div>
      <div className="activity-card-rows">{children}</div>
    </div>
  );
}

//   2026-09-03 v2 결정 152: 알약 칩 → 상태점 + 글자
function Badge({ label, tone }: { label: string; tone: string }) {
  return <span className="dash-status shrink-0"><i className="dash-status-dot" style={{ background: tone }} />{label}</span>;
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
      // deals 엔 updated_at 컬럼이 없음(42703 400) — 최근활동/생성 시각으로 정렬 (2026-07-16 QA)
      const data = logRead('components/dashboard-activity:data', await db.from("deals").select("id, name, stage, contract_total, last_activity_at, created_at")
        .eq("company_id", companyId).is("archived_at", null).is("parent_deal_id", null)
        .order("last_activity_at", { ascending: false, nullsFirst: false }).order("created_at", { ascending: false }).limit(15));   // 위젯을 키우면 더 보이게 (2026-08-20 사장님: 크기를 키워도 5줄뿐)
      return (data || []) as any[];
    },
  });
  return (
    <ActivityCard title="최근 프로젝트" href="/projecthub" empty={data.length === 0}
      emptyText="진행 중인 프로젝트가 없습니다." emptyAction={{ label: "첫 프로젝트 만들기", href: "/projecthub" }}>
      {data.slice(0, 5).map((p) => {
        const st = STAGE[p.stage] || { l: p.stage || "-", c: "var(--text-dim)" };
        return (
          <Link key={p.id} href={`/projecthub/${p.id}`} className="project-row">
            <span className="min-w-0 flex-1 text-[13px] text-[var(--text)] truncate">{p.name || "프로젝트"}</span>
            <Badge label={st.l} tone={st.c} />
            <span className="text-[12px] mono-number text-[var(--text-muted)] shrink-0 w-16 text-right">{p.contract_total ? won(Number(p.contract_total)) : "-"}</span>
          </Link>
        );
      })}
      {data.length > 5 && <Link href="/projecthub" className="dash-more">외 {data.length - 5}건 →</Link>}
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
      // limit(30) 이 합계·건수까지 잘랐다 (2026-08-19 감사: 월 45건 회사가 영원히 "30건").
      //   합계는 월 전체(상한 2000, 대시보드 위젯 부하 고려), 목록만 4건.
      const data = await fetchPaged<any>('components/dashboard-activity:data', () => db.from("tax_invoices").select("id, counterparty_name, supply_amount, issue_date")
        .eq("company_id", companyId).eq("type", "sales").neq("status", "void")
        .gte("issue_date", mStart).order("issue_date", { ascending: false }).order("id"), 50000);
      const rows = (data || []) as any[];
      return { rows: rows.slice(0, 5), total: rows.reduce((s, r) => s + Number(r.supply_amount || 0), 0), count: rows.length };
    },
  });
  return (
    <ActivityCard title="이번 달 매출" href="/reports/revenue" hrefLabel="매출 현황" empty={!data || data.count === 0}
      summary={data && data.count > 0 ? <>합계 <b className="mono-number text-[var(--text)]">{won(data.total)}</b> · {data.count}건</> : undefined}
      emptyText="이번 달 발행된 매출 세금계산서가 없습니다." emptyAction={{ label: "세금계산서 발행하기", href: "/tax-invoices" }}>
      {data && (
        <>
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
        .order("issue_date", { ascending: false }).limit(15));
      return (data || []) as any[];
    },
  });
  return (
    <ActivityCard title="최근 세금계산서" href="/tax-invoices" empty={data.length === 0}
      emptyText="수집된 세금계산서가 없습니다." emptyAction={{ label: "홈택스 연결하고 자동 수집하기", href: "/settings?tab=bank" }}>
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
