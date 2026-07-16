"use client";
import { logRead } from "@/lib/log-read";

// 내 업무 — 대시보드 "상황판" 핵심(2026-07-14 리포트형 개편).
//   목적: 내가 담당·처리해야 할 것을 "실제 데이터 미리보기"로 한눈에 보고, 클릭하면 그 메뉴로 바로 이동.
//   기존엔 '몇 건'만 표시 → 각 카드가 상위 항목(제목·마감·금액 등)을 보여주고 항목/헤더 클릭 시 해당 화면으로.
//   역할 무관 공통. 데이터 없는 카드는 숨김(할 게 없으면 조용히). 기존 테이블 재사용, side-effect 0.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;
const MENTION_ENTITIES = ["chat", "chat_channel", "board_post", "document_share"];
// 서명 요청 상태 → 뱃지 라벨·색 (hr_contract_packages.status)
const SIGN_STATUS: Record<string, { label: string; tone?: string }> = {
  sent: { label: "서명 대기", tone: "warning" },
  partially_signed: { label: "일부 서명", tone: "primary" },
  draft: { label: "준비 중", tone: undefined },
};

const soft = (c: string, pct = 12) => `color-mix(in srgb, ${c} ${pct}%, transparent)`;
const toneColor = (t?: string) =>
  t === "warning" ? "var(--warning)" : t === "danger" ? "var(--danger)" : t === "success" ? "var(--success)" : "var(--primary)";

// MM/DD
function md(d?: string | null): string {
  if (!d) return "";
  const s = String(d).slice(0, 10);
  const [, m, day] = s.split("-");
  return m && day ? `${Number(m)}/${Number(day)}` : "";
}
// 마감까지 D-day (음수=지연)
function dday(due?: string | null): number | null {
  if (!due) return null;
  const t = new Date(String(due).slice(0, 10)).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((t - today) / 86400000);
}
function won(n: number): string {
  if (!n) return "";
  if (Math.abs(n) >= 100000000) return `${(n / 100000000).toFixed(1)}억`;
  if (Math.abs(n) >= 10000) return `${Math.round(n / 10000).toLocaleString("ko")}만`;
  return n.toLocaleString("ko");
}
const DOC_KIND: Record<string, string> = { quote: "견적서", contract: "계약서", invoice: "계산서", report: "보고서" };

type WorkItem = { key: string; href: string; primary: string; secondary?: string; tone?: string; badge?: boolean };

function WorkCard({ href, icon, label, count, tone = "primary", items, moreLabel }: {
  href: string; icon: string; label: string; count: number; tone?: string; items: WorkItem[]; moreLabel?: string;
}) {
  const color = toneColor(tone);
  return (
    <div className="my-work-card glass-card">
      <div className="my-work-card-header">
        <span className="w-7 h-7 rounded-lg flex items-center justify-center text-[13px] shrink-0" style={{ background: soft(color, 12) }}>{icon}</span>
        <div className="min-w-0 flex-1 flex items-baseline gap-1.5">
          <span className="text-[12px] font-bold text-[var(--text)] leading-tight truncate">{label}</span>
          <span className="text-[11px] font-semibold mono-number shrink-0" style={{ color }}>{count}</span>
        </div>
        <Link href={href} className="text-[11px] font-semibold text-[var(--primary)] hover:underline shrink-0 no-underline">이동 →</Link>
      </div>
      <div className="my-work-card-item-list">
        {items.map((it) => (
          <Link key={it.key} href={it.href}
            className="my-work-card-item">
            <span className="w-1 h-1 rounded-full shrink-0" style={{ background: it.tone ? toneColor(it.tone) : "var(--text-dim)" }} />
            <span className="min-w-0 flex-1 text-[12px] text-[var(--text)] truncate">{it.primary}</span>
            {it.secondary && (it.badge
              ? <span className="text-[10px] px-1.5 py-0.5 rounded-full shrink-0 font-semibold" style={{ background: soft(it.tone ? toneColor(it.tone) : "var(--text-dim)", 14), color: it.tone ? toneColor(it.tone) : "var(--text-muted)" }}>{it.secondary}</span>
              : <span className="text-[11px] shrink-0 mono-number" style={{ color: it.tone ? toneColor(it.tone) : "var(--text-dim)" }}>{it.secondary}</span>)}
          </Link>
        ))}
        {moreLabel && (
          <Link href={href} className="text-[11px] text-[var(--text-dim)] hover:text-[var(--primary)] px-2 pt-1 no-underline transition">{moreLabel}</Link>
        )}
      </div>
    </div>
  );
}

export type MyWorkCard = { id: string; node: React.ReactNode };

// 내 업무 카드들을 위젯 배열로 반환하는 훅 — 대시보드 통합 그리드에서 회사 현황 카드와 함께 배치.
export function useMyWorkCards(companyId: string, userId: string): MyWorkCard[] {
  const enabled = !!companyId && !!userId;

  const { data } = useQuery({
    queryKey: ["my-work-v2", companyId, userId],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      // 서명 요청 조회용 내 employee id (내게 온 계약 서명 = hr_contract_packages)
      const emp = logRead('components/my-work-section:emp', await db.from("employees").select("id").eq("user_id", userId).eq("company_id", companyId).maybeSingle());
      const empId = emp?.id ?? null;
      const [tasks, projects, approvals, mentions, signs] = await Promise.all([
        db.from("project_tasks").select("id, title, due_date, status, deal_id, deals(name)")
          .eq("assignee_id", userId).is("archived_at", null).neq("status", "done").order("due_date", { ascending: true, nullsFirst: false }).limit(50),
        db.from("deals").select("id, name, stage, contract_total")
          .eq("company_id", companyId).eq("internal_manager_id", userId).is("archived_at", null).order("updated_at", { ascending: false }).limit(50),
        db.from("doc_approvals").select("id, created_at, document_id, documents(content_type, contract_amount)")
          .eq("company_id", companyId).eq("approver_id", userId).eq("status", "pending").order("created_at", { ascending: false }).limit(50),
        db.from("notifications").select("*").eq("user_id", userId).eq("is_read", false).in("entity_type", MENTION_ENTITIES).order("created_at", { ascending: false }).limit(50),
        empId
          ? db.from("hr_contract_packages").select("id, title, status, created_at").eq("employee_id", empId).in("status", ["sent", "partially_signed", "draft"]).order("created_at", { ascending: false }).limit(50)
          : Promise.resolve({ data: [] as any[] }),
      ]);
      return {
        tasks: (tasks.data || []) as any[],
        projects: (projects.data || []) as any[],
        approvals: (approvals.data || []) as any[],
        mentions: (mentions.data || []) as any[],
        signs: (signs.data || []) as any[],
      };
    },
  });

  const cards: MyWorkCard[] = [];
  if (data) {
    const PREVIEW = 4;
    const more = (n: number) => (n > PREVIEW ? `외 ${n - PREVIEW}건 더 보기 →` : undefined);

    // 내 할 일 — 마감·지연 강조
    if (data.tasks.length > 0) {
      const items: WorkItem[] = data.tasks.slice(0, PREVIEW).map((t) => {
        const d = dday(t.due_date);
        const overdue = d != null && d < 0;
        const proj = t.deals?.name;
        return {
          key: t.id,
          href: t.deal_id ? `/projecthub/${t.deal_id}` : "/projecthub",
          primary: t.title || "할 일",
          secondary: t.due_date ? (overdue ? `${-d}일 지연` : d === 0 ? "오늘" : `D-${d}`) : (proj ? proj : ""),
          tone: overdue ? "danger" : d === 0 ? "warning" : undefined,
        };
      });
      cards.push({ id: "work-tasks", node: <WorkCard key="work-tasks" href="/projecthub" icon="✅" label="내 할 일" count={data.tasks.length} tone="primary" items={items} moreLabel={more(data.tasks.length)} /> });
    }

    // 내 결재 대기 — 문서 종류·금액
    if (data.approvals.length > 0) {
      const items: WorkItem[] = data.approvals.slice(0, PREVIEW).map((a) => {
        const kind = DOC_KIND[a.documents?.content_type] || "결재 문서";
        const amt = Number(a.documents?.contract_amount || 0);
        return { key: a.id, href: "/approvals", primary: kind, secondary: amt ? won(amt) : md(a.created_at), tone: "warning" };
      });
      cards.push({ id: "work-appr", node: <WorkCard key="work-appr" href="/approvals" icon="🧾" label="내 결재 대기" count={data.approvals.length} tone="warning" items={items} moreLabel={more(data.approvals.length)} /> });
    }

    // 내 담당 프로젝트 — 단계·계약액
    if (data.projects.length > 0) {
      const items: WorkItem[] = data.projects.slice(0, PREVIEW).map((p) => ({
        key: p.id, href: `/projecthub/${p.id}`, primary: p.name || "프로젝트", secondary: p.contract_total ? won(Number(p.contract_total)) : "",
      }));
      cards.push({ id: "work-proj", node: <WorkCard key="work-proj" href="/projecthub" icon="💼" label="내 담당 프로젝트" count={data.projects.length} tone="success" items={items} moreLabel={more(data.projects.length)} /> });
    }

    // 내 서명 요청
    if (data.signs.length > 0) {
      const items: WorkItem[] = data.signs.slice(0, PREVIEW).map((s) => {
        const st = SIGN_STATUS[s.status] || { label: "서명 대기", tone: "warning" as const };
        return { key: s.id, href: "/my-contracts", primary: s.title || "서명 문서", secondary: st.label, tone: st.tone, badge: true };
      });
      cards.push({ id: "work-sign", node: <WorkCard key="work-sign" href="/my-contracts" icon="🖊️" label="내 서명 요청" count={data.signs.length} tone="danger" items={items} moreLabel={more(data.signs.length)} /> });
    }

    // 나를 언급한 알림
    if (data.mentions.length > 0) {
      const items: WorkItem[] = data.mentions.slice(0, PREVIEW).map((n) => ({
        key: n.id, href: n.link || "/notifications", primary: n.title || n.message || "새 알림", secondary: md(n.created_at),
      }));
      cards.push({ id: "work-ment", node: <WorkCard key="work-ment" href="/notifications" icon="💬" label="나를 언급한 글" count={data.mentions.length} tone="primary" items={items} moreLabel={more(data.mentions.length)} /> });
    }
  }

  return cards;
}

// 얇은 래퍼 — 직원 대시보드 등에서 '내 업무' 섹션으로 그대로 렌더.
export function MyWorkSection({ companyId, userId }: { companyId: string; userId: string }) {
  const cards = useMyWorkCards(companyId, userId);
  return (
    <section className="my-work-section">
      <div className="my-work-section-header">
        <h2 className="text-[15px] font-extrabold text-[var(--text)] tracking-tight">내 업무</h2>
        <p className="text-[11px] text-[var(--text-muted)] mt-0.5 leading-relaxed">담당·처리할 일을 미리 보고, 항목이나 “이동 →”으로 해당 메뉴로.</p>
      </div>
      {cards.length > 0 ? (
        <div className="my-work-card-grid">{cards.map((c) => c.node)}</div>
      ) : (
        <div className="my-work-empty glass-card">지금 처리할 내 업무가 없습니다. 👍</div>
      )}
    </section>
  );
}
