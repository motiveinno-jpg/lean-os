"use client";

// 대시보드 카탈로그용 메뉴 위젯 — 각 메뉴의 실제 데이터 미리보기(2026-07-15).
//   공용 셸 ActivityCard 재사용(제목 + 전체보기 → / 표 행). 쿼리는 코드베이스 검증 패턴만 사용.
//   회사 데이터 위젯(통장·결재·구성원·거래처·공지)과 개인 위젯(내 담당 업무).

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { ActivityCard } from "./dashboard-activity";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

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
export function BankRecentCard({ companyId }: { companyId: string }) {
  const { data = [] } = useQuery({
    queryKey: ["dash-bank-recent", companyId],
    enabled: !!companyId, staleTime: 60_000,
    queryFn: async () => {
      const { data } = await db.from("bank_transactions")
        .select("id, transaction_date, type, amount, counterparty, description")
        .eq("company_id", companyId).order("transaction_date", { ascending: false }).limit(5);
      return (data || []) as any[];
    },
  });
  return (
    <ActivityCard title="통장 거래" href="/bank" empty={data.length === 0}>
      {data.map((t) => {
        const isIn = t.type === "in" || t.type === "deposit" || Number(t.amount) > 0;
        return (
          <Link key={t.id} href="/bank" className="flex items-center gap-2 py-2 no-underline hover:bg-[var(--bg-surface)] -mx-1 px-1 rounded transition">
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
  const { data } = useQuery({
    queryKey: ["dash-approvals-pending", companyId],
    enabled: !!companyId, staleTime: 60_000,
    queryFn: async () => {
      const [docRes, payCnt] = await Promise.all([
        db.from("doc_approvals").select("id, created_at, documents(content_type, contract_amount)")
          .eq("company_id", companyId).eq("status", "pending").order("created_at", { ascending: false }).limit(5),
        db.from("payment_queue").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("status", "pending"),
      ]);
      return { docs: (docRes.data || []) as any[], total: (docRes.data?.length || 0) + (payCnt.count || 0) };
    },
  });
  const docs = data?.docs || [];
  return (
    <ActivityCard title="결재 대기" href="/approvals" count={data?.total} empty={(data?.total ?? 0) === 0}>
      {docs.map((a) => {
        const kind = DOC_KIND[a.documents?.content_type] || "결재 문서";
        const amt = Number(a.documents?.contract_amount || 0);
        return (
          <Link key={a.id} href="/approvals" className="flex items-center gap-2 py-2 no-underline hover:bg-[var(--bg-surface)] -mx-1 px-1 rounded transition">
            <Badge label={kind} tone="var(--warning)" />
            <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">{amt ? won(amt) : md(a.created_at)}</span>
            <span className="text-[10px] text-[var(--text-dim)] shrink-0">{md(a.created_at)}</span>
          </Link>
        );
      })}
    </ActivityCard>
  );
}

// ── 구성원 — 재직 인원 요약 ──
export function EmployeesCard({ companyId }: { companyId: string }) {
  const { data } = useQuery({
    queryKey: ["dash-employees", companyId],
    enabled: !!companyId, staleTime: 60_000,
    queryFn: async () => {
      const { data } = await db.from("employees").select("id, name, department")
        .eq("company_id", companyId).in("status", ["active", "joined"]).order("name").limit(50);
      const list = (data || []) as any[];
      return { list: list.slice(0, 5), count: list.length };
    },
  });
  const list = data?.list || [];
  return (
    <ActivityCard title="구성원" href="/employees" count={data?.count} empty={list.length === 0}>
      {list.map((e) => (
        <Link key={e.id} href="/employees" className="flex items-center gap-2 py-2 no-underline hover:bg-[var(--bg-surface)] -mx-1 px-1 rounded transition">
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
      const { data } = await db.from("partners").select("id, name")
        .eq("company_id", companyId).order("created_at", { ascending: false }).limit(50);
      const list = (data || []) as any[];
      return { list: list.slice(0, 5), count: list.length };
    },
  });
  const list = data?.list || [];
  return (
    <ActivityCard title="거래처" href="/partners" count={data?.count} empty={list.length === 0}>
      {list.map((p) => (
        <Link key={p.id} href="/partners" className="flex items-center gap-2 py-2 no-underline hover:bg-[var(--bg-surface)] -mx-1 px-1 rounded transition">
          <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">{p.name || "-"}</span>
        </Link>
      ))}
    </ActivityCard>
  );
}

// ── 공지사항 — 최근 공지(핀 우선) ──
export function AnnouncementsCard() {
  const { data = [] } = useQuery({
    queryKey: ["dash-announcements"],
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await db.from("announcements").select("id, title, pinned, created_at")
        .order("pinned", { ascending: false }).order("created_at", { ascending: false }).limit(5);
      return (data || []) as any[];
    },
  });
  return (
    <ActivityCard title="공지사항" href="/announcements" empty={data.length === 0}>
      {data.map((a) => (
        <Link key={a.id} href="/announcements" className="flex items-center gap-2 py-2 no-underline hover:bg-[var(--bg-surface)] -mx-1 px-1 rounded transition">
          {a.pinned && <span className="text-[11px] shrink-0">📌</span>}
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
      const { data } = await db.from("project_tasks").select("id, title, due_date, deal_id")
        .eq("assignee_id", userId).is("archived_at", null).neq("status", "done")
        .order("due_date", { ascending: true, nullsFirst: false }).limit(5);
      return (data || []) as any[];
    },
  });
  return (
    <ActivityCard title="내 담당 업무" href="/projecthub" count={data.length} empty={data.length === 0}>
      {data.map((t) => {
        const d = dday(t.due_date);
        const overdue = d != null && d < 0;
        return (
          <Link key={t.id} href={t.deal_id ? `/projecthub/${t.deal_id}` : "/projecthub"}
            className="flex items-center gap-2 py-2 no-underline hover:bg-[var(--bg-surface)] -mx-1 px-1 rounded transition">
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
