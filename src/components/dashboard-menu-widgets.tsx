"use client";
import { logRead } from "@/lib/log-read";
import { Ico } from "@/components/ui-icon";

// 대시보드 카탈로그용 메뉴 위젯 — 각 메뉴의 실제 데이터 미리보기(2026-07-15).
//   공용 셸 ActivityCard 재사용(제목 + 전체보기 → / 표 행). 쿼리는 코드베이스 검증 패턴만 사용.
//   회사 데이터 위젯(통장·결재·구성원·거래처·공지)과 개인 위젯(내 담당 업무).

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { ActivityCard } from "./dashboard-activity";
import { REQUEST_TYPE_LABELS, getMyPendingApprovals } from "@/lib/approval-workflow";
import { useUser } from "@/components/user-context";
import { useMyPermissions } from "@/lib/permissions";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

function won(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 100000000) return `${sign}${(a / 100000000).toFixed(1)}억`;
  if (a >= 10000) return `${sign}${Math.round(a / 10000).toLocaleString("ko")}만`;
  return `${sign}${a.toLocaleString("ko")}`;
}
function md(d?: string | null): string {
  const s = (d || "").slice(0, 10);
  const [, m, day] = s.split("-");
  return m && day ? `${Number(m)}/${Number(day)}` : "";
}
function dday(due?: string | null): number | null {
  if (!due) return null;
  const t = new Date(String(due).slice(0, 10)).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((t - today) / 86400000);
}
const soft = (c: string, p = 14) => `color-mix(in srgb, ${c} ${p}%, transparent)`;
function Badge({ label, tone }: { label: string; tone: string }) {
  return <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold shrink-0" style={{ background: soft(tone), color: tone }}>{label}</span>;
}

// ── 통장 — 최근 거래내역 ──
//   2026-08-19 재편 — headExtra(동기화 시각·미분류·↻)는 대시보드가 넣어 준다
export function BankRecentCard({ companyId, headExtra }: { companyId: string; headExtra?: React.ReactNode }) {
  const { data = [] } = useQuery({
    queryKey: ["dash-bank-recent", companyId],
    enabled: !!companyId, staleTime: 60_000,
    queryFn: async () => {
      const data = logRead('components/dashboard-menu-widgets:data', await db.from("bank_transactions")
        .select("id, transaction_date, type, amount, counterparty, description")
        .eq("company_id", companyId).order("transaction_date", { ascending: false }).limit(15));   // 위젯을 키우면 더 보이게 (2026-08-20 사장님)
      return (data || []) as any[];
    },
  });
  return (
    <ActivityCard title="통장 거래" href="/bank" headExtra={headExtra} empty={data.length === 0}
      emptyText="아직 거래 내역이 없습니다." emptyAction={{ label: "통장 연결하고 자동 수집하기", href: "/settings?tab=bank" }}>
      {data.map((t) => {
        const isIn = t.type === "in" || t.type === "deposit" || Number(t.amount) > 0;
        return (
          <Link key={t.id} href="/bank" className="dash-bank-row">
            <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">{t.counterparty || t.description || "-"}</span>
            <span className="text-[10px] text-[var(--text-dim)] shrink-0">{md(t.transaction_date)}</span>
            <span className="text-[11px] mono-number shrink-0 w-16 text-right" style={{ color: isIn ? "var(--success)" : "var(--text-muted)" }}>
              {isIn ? "+" : "−"}{won(Math.abs(Number(t.amount || 0)))}
            </span>
          </Link>
        );
      })}
    </ActivityCard>
  );
}

// ── 결재 — 회사 결재 대기 목록 ──
const DOC_KIND: Record<string, string> = { quote: "견적서", contract: "계약서", invoice: "계산서", report: "보고서" };
export function ApprovalsPendingCard({ companyId }: { companyId: string }) {
  // 권한 분기 (2026-08-19 사장님: 직원 계정에 회사 전체 대기가 다 보였다) —
  //   결재허브 '전체 현황' 게이트(isMaster ‖ /approvals:all)와 같은 규칙.
  //   그 외 계정은 '내가 결재할 차례인 건'(내 결재함 규칙)만 본다.
  const { user } = useUser();
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const companyWide = isMaster || hasPerm("/approvals:all");
  const { data } = useQuery({
    queryKey: ["dash-approvals-pending", companyId, companyWide ? "all" : user?.id || ""],
    enabled: !!companyId && !permLoading && (companyWide || !!user?.id), staleTime: 60_000,
    queryFn: async () => {
      if (!companyWide) {
        const mine = await getMyPendingApprovals(user!.id, companyId);
        const reqs = mine.map((m: any) => ({ id: m.stepId, title: m.title, request_type: m.requestType, amount: m.amount, created_at: m.createdAt }));
        return { docs: [] as any[], reqs, total: reqs.length };
      }
      // 문서결재(doc_approvals) + 결재허브 대기(approval_requests) — 진짜 '결재 대기'만.
      //   (2026-08-19 사장님: payment_queue 는 지급 대기라 결재가 끝난 건이 유령처럼 남았고,
      //    누르면 정기지출로 이동해 헷갈렸다. 오너뷰에 이체 기능이 없어 지급 대기 표시 자체가 불필요.)
      const [docRes, reqRes] = await Promise.all([
        db.from("doc_approvals").select("id, created_at, documents(content_type, contract_amount)")
          .eq("company_id", companyId).eq("status", "pending").order("created_at", { ascending: false }).limit(8),
        db.from("approval_requests").select("id, title, request_type, amount, created_at")
          .eq("company_id", companyId).eq("status", "pending").order("created_at", { ascending: false }).limit(8),
      ]);
      const docs = (docRes.data || []) as any[];
      const reqs = (reqRes.data || []) as any[];
      return { docs, reqs, total: docs.length + reqs.length };
    },
  });
  const items = [
    ...(data?.docs || []).map((a) => ({
      kind: "doc" as const, id: a.id, href: "/approvals", badge: DOC_KIND[a.documents?.content_type] || "결재 문서",
      amt: Number(a.documents?.contract_amount || 0), date: a.created_at as string,
    })),
    ...(data?.reqs || []).map((r) => ({
      kind: "req" as const, id: r.id, href: "/approvals", badge: REQUEST_TYPE_LABELS[r.request_type as keyof typeof REQUEST_TYPE_LABELS] || "결재",
      label: (r.title || "결재 요청") as string, amt: Number(r.amount || 0), date: r.created_at as string,
    })),
  ].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 15);

  return (
    <ActivityCard title="결재 대기" href="/approvals" count={data?.total} empty={(data?.total ?? 0) === 0}
      emptyText="대기 중인 결재가 없습니다 — 모두 처리했습니다.">
      {items.map((it) => (
        <Link key={`${it.kind}-${it.id}`} href={it.href} className="dash-approval-row">
          <Badge label={it.badge} tone="var(--warning)" />
          <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">
            {it.kind === "req" ? (it as any).label : (it.amt ? won(it.amt) : "결재 문서")}
          </span>
          {it.amt > 0 && <span className="text-[11px] mono-number text-[var(--text-muted)] shrink-0">{won(it.amt)}</span>}
          <span className="text-[10px] text-[var(--text-dim)] shrink-0">{md(it.date)}</span>
        </Link>
      ))}
    </ActivityCard>
  );
}

// ── 구성원 — 재직 인원 요약 ──
export function EmployeesCard({ companyId }: { companyId: string }) {
  const { data } = useQuery({
    queryKey: ["dash-employees", companyId],
    enabled: !!companyId, staleTime: 60_000,
    queryFn: async () => {
      const data = logRead('components/dashboard-menu-widgets:data', await db.from("employees").select("id, name, department")
        .eq("company_id", companyId).in("status", ["active", "joined"]).order("name").limit(50));
      const list = (data || []) as any[];
      return { list: list.slice(0, 15), count: list.length };
    },
  });
  const list = data?.list || [];
  return (
    <ActivityCard title="구성원" href="/employees" count={data?.count} empty={list.length === 0}
      emptyText="등록된 구성원이 없습니다." emptyAction={{ label: "직원 초대하기", href: "/employees" }}>
      {list.map((e) => (
        <Link key={e.id} href="/employees" className="dash-employee-row">
          <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">{e.name || "-"}</span>
          {e.department && <span className="text-[10px] text-[var(--text-dim)] shrink-0 truncate max-w-[40%]">{e.department}</span>}
        </Link>
      ))}
    </ActivityCard>
  );
}

// ── 거래처 — 등록 거래처 요약 ──
export function PartnersCard({ companyId }: { companyId: string }) {
  const { data } = useQuery({
    queryKey: ["dash-partners", companyId],
    enabled: !!companyId, staleTime: 60_000,
    queryFn: async () => {
      const data = logRead('components/dashboard-menu-widgets:data', await db.from("partners").select("id, name")
        .eq("company_id", companyId).order("created_at", { ascending: false }).limit(50));
      const list = (data || []) as any[];
      return { list: list.slice(0, 15), count: list.length };
    },
  });
  const list = data?.list || [];
  return (
    <ActivityCard title="거래처" href="/partners" count={data?.count} empty={list.length === 0}
      emptyText="등록된 거래처가 없습니다." emptyAction={{ label: "거래처 등록하기", href: "/partners" }}>
      {list.map((p) => (
        <Link key={p.id} href="/partners" className="dash-partner-row">
          <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">{p.name || "-"}</span>
        </Link>
      ))}
    </ActivityCard>
  );
}

// ── 공지사항 — 최근 공지(핀 우선) ──
export function AnnouncementsCard() {
  //   전역(null) + 내 회사 공지만 — RLS 만 믿으면 운영자 계정(creative@)은 전 회사(QA 시드 포함)
  //   공지가 다 보인다 (2026-08-28 사장님 제보 "김대표가 올린 것들 다 뭐야")
  const { user } = useUser();
  const companyId = (user as any)?.company_id as string | undefined;
  const { data = [] } = useQuery({
    queryKey: ["dash-announcements", companyId],
    staleTime: 60_000,
    queryFn: async () => {
      const data = logRead('components/dashboard-menu-widgets:data', await db.from("announcements").select("id, title, pinned, created_at")
        .or(companyId ? `company_id.is.null,company_id.eq.${companyId}` : "company_id.is.null")
        .order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(15));
      return (data || []) as any[];
    },
  });
  return (
    <ActivityCard title="공지사항" href="/announcements" empty={data.length === 0}
      emptyText="아직 등록된 공지가 없습니다." emptyAction={{ label: "첫 공지 쓰기", href: "/announcements" }}>
      {data.map((a) => (
        <Link key={a.id} href="/announcements" className="dash-announcement-row">
          {a.pinned && <span className="text-[11px] shrink-0"><Ico e="📌" /></span>}
          <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">{a.title || "-"}</span>
          <span className="text-[10px] text-[var(--text-dim)] shrink-0">{md(a.created_at)}</span>
        </Link>
      ))}
    </ActivityCard>
  );
}

// ── 내 담당 업무 — 나에게 배정된 프로젝트 태스크(마감 임박 우선) ──
export function MyTasksCard({ userId }: { userId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["dash-my-tasks", userId],
    enabled: !!userId, staleTime: 60_000,
    queryFn: async () => {
      const data = logRead('components/dashboard-menu-widgets:data', await db.from("project_tasks").select("id, title, due_date, deal_id")
        .eq("assignee_id", userId).is("archived_at", null).neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false }).limit(15));
      return (data || []) as any[];
    },
  });
  return (
    <ActivityCard title="내 담당 업무" href="/projecthub" count={data.length} empty={data.length === 0}
      emptyText="배정된 담당 업무가 없습니다.">
      {data.map((t) => {
        const d = dday(t.due_date);
        const overdue = d != null && d < 0;
        return (
          <Link key={t.id} href={t.deal_id ? `/projecthub/${t.deal_id}` : "/projecthub"}
            className="dash-task-row">
            <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">{t.title || "할 일"}</span>
            {t.due_date && (
              <span className="text-[10px] font-semibold shrink-0" style={{ color: overdue ? "var(--danger)" : d === 0 ? "var(--warning)" : "var(--text-dim)" }}>
                {overdue ? `${-d!}일 지연` : d === 0 ? "오늘" : `D-${d}`}
              </span>
            )}
          </Link>
        );
      })}
    </ActivityCard>
  );
}


// ── 재고 부족 — 안전재고 아래로 내려간 품목 (2026-08-25 사장님 지시, 재고 2순위) ──
//   재고 화면에 들어가지 않아도 대시보드에서 먼저 보이게. 안전재고를 정한 품목만 셀 수 있다.
export function InventoryShortageCard({ companyId }: { companyId: string }) {
  const { data } = useQuery({
    queryKey: ["dash-inventory-short", companyId],
    enabled: !!companyId, staleTime: 60_000,
    queryFn: async () => {
      const [prods, onhand] = await Promise.all([
        db.from("products").select("id, sku, name, spec, safety_stock").eq("company_id", companyId)
          .eq("is_active", true).eq("track_stock", true).not("safety_stock", "is", null),
        db.from("v_stock_onhand").select("product_id, qty").eq("company_id", companyId),
      ]);
      const qty = new Map<string, number>();
      for (const r of ((onhand.data as any[]) || [])) qty.set(r.product_id, (qty.get(r.product_id) || 0) + Number(r.qty || 0));
      const list = ((prods.data as any[]) || [])
        .map((p) => ({ id: p.id, sku: p.sku, name: p.name, spec: p.spec, safety: Number(p.safety_stock), qty: qty.get(p.id) || 0 }))
        .filter((p) => p.qty <= p.safety)
        .sort((a, b) => (a.qty - a.safety) - (b.qty - b.safety));
      return { list: list.slice(0, 15), count: list.length };
    },
  });
  const list = data?.list || [];
  return (
    <ActivityCard title="재고 부족" href="/inventory/stock" count={data?.count} empty={list.length === 0}
      emptyText="안전재고 아래로 내려간 품목이 없습니다." emptyAction={{ label: "재고 보기", href: "/inventory/stock" }}>
      {list.map((p) => (
        <Link key={p.id} href="/inventory/purchase" className="dash-partner-row" title="구매에서 발주하기">
          <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">{p.name}{p.spec ? <span className="text-[var(--text-dim)]"> {p.spec}</span> : null}</span>
          <span className={p.qty <= 0 ? "text-[11px] font-bold tabular-nums text-[var(--danger)]" : "text-[11px] font-bold tabular-nums text-[var(--warning)]"}>
            {p.qty.toLocaleString("ko-KR")} / {p.safety.toLocaleString("ko-KR")}
          </span>
        </Link>
      ))}
    </ActivityCard>
  );
}
