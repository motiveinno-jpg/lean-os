"use client";

// 내 업무 — 대시보드 "상황판" 핵심(2026-07-08). 역할 무관 공통: 내가 처리할/담당하는 것을
//   요약 + 바로가기로. 각 타일은 건수 0이면 숨김(할 게 없으면 조용히). 데이터는 기존 테이블 재사용.

import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;
const MENTION_ENTITIES = ["chat", "chat_channel", "board_post", "document_share"];
const SIGN_TYPES = ["signature", "signature_request", "hr_contract_package"];

function Tile({ href, icon, label, count, sub, tone = "primary" }: {
  href: string; icon: string; label: string; count: number; sub?: string; tone?: "primary" | "warning" | "danger" | "success";
}) {
  const color = tone === "warning" ? "var(--warning)" : tone === "danger" ? "var(--danger)" : tone === "success" ? "var(--success)" : "var(--primary)";
  return (
    <Link href={href} className="glass-card p-4 flex items-center gap-3 no-underline transition hover:-translate-y-0.5 hover:border-[var(--primary)]">
      <span className="w-10 h-10 rounded-xl flex items-center justify-center text-lg shrink-0" style={{ background: `color-mix(in srgb, ${color} 12%, transparent)` }}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-[12px] text-[var(--text-muted)] truncate">{label}</span>
        <span className="block text-[20px] leading-6 font-extrabold mono-number" style={{ color }}>{count}{typeof count === "number" ? "건" : ""}</span>
        {sub && <span className="block text-[10px] text-[var(--text-dim)] truncate mt-0.5">{sub}</span>}
      </span>
      <svg className="w-4 h-4 text-[var(--text-dim)] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M9 5l7 7-7 7" /></svg>
    </Link>
  );
}

export function MyWorkSection({ companyId, userId }: { companyId: string; userId: string }) {
  const enabled = !!companyId && !!userId;

  const { data } = useQuery({
    queryKey: ["my-work", companyId, userId],
    enabled,
    staleTime: 60_000,
    queryFn: async () => {
      const [appr, proj, tasks, mention, sign] = await Promise.all([
        db.from("doc_approvals").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("approver_id", userId).eq("status", "pending"),
        db.from("deals").select("id, name").eq("company_id", companyId).eq("owner_id", userId).is("archived_at", null),
        db.from("project_tasks").select("id", { count: "exact", head: true }).eq("assignee_id", userId).is("archived_at", null).neq("status", "done"),
        db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_read", false).in("entity_type", MENTION_ENTITIES),
        db.from("notifications").select("id", { count: "exact", head: true }).eq("user_id", userId).eq("is_read", false).in("type", SIGN_TYPES),
      ]);
      const projRows = (proj.data || []) as { id: string; name: string | null }[];
      return {
        approvals: appr.count ?? 0,
        projects: projRows.length,
        projectNames: projRows.slice(0, 2).map((p) => p.name || "프로젝트").join(", "),
        tasks: tasks.count ?? 0,
        mentions: mention.count ?? 0,
        signatures: sign.count ?? 0,
      };
    },
  });

  const tiles: React.ReactNode[] = [];
  if (data) {
    if (data.approvals > 0) tiles.push(<Tile key="a" href="/approvals" icon="🧾" label="내 결재 대기" count={data.approvals} tone="warning" />);
    if (data.projects > 0) tiles.push(<Tile key="p" href="/projecthub" icon="💼" label="내 담당 프로젝트" count={data.projects} sub={data.projectNames} />);
    if (data.tasks > 0) tiles.push(<Tile key="t" href="/projecthub" icon="✅" label="내 할 일" count={data.tasks} />);
    if (data.mentions > 0) tiles.push(<Tile key="m" href="/notifications" icon="💬" label="나를 언급한 글" count={data.mentions} tone="primary" />);
    if (data.signatures > 0) tiles.push(<Tile key="s" href="/my-contracts" icon="🖊️" label="내 서명 요청" count={data.signatures} tone="danger" />);
  }

  return (
    <section className="mb-5">
      <div className="flex items-center gap-2 mb-3">
        <h2 className="text-sm font-bold text-[var(--text)]">내 업무</h2>
        <span className="text-[11px] text-[var(--text-dim)]">지금 내가 처리할 것 · 담당하는 것</span>
      </div>
      {tiles.length > 0 ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">{tiles}</div>
      ) : data ? (
        <div className="glass-card p-4 text-center text-xs text-[var(--text-dim)]">지금 처리할 내 업무가 없습니다. 👍</div>
      ) : null}
    </section>
  );
}
