"use client";

// 프로젝트(라이프사이클·손익 뷰) — 워크플로우(/projects 보드)와 같은 deals 데이터의 다른 렌즈.
//   2026-06-17 핸드오프 v2: 신규 테이블 없이 기존 deals 재사용. 목록 → 상세(탭) 구조.
//   목록 컬럼: 프로젝트명·거래처·담당자·단계·계약금액·진행률·기간. (직접원가·원가율은 손익 단계에서 추가)

import { useMemo } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { getDeals, getCompanyUsers } from "@/lib/queries";
import { getPartners } from "@/lib/partners";
import { STAGE_LABEL, STAGE_COLOR, STAGE_ORDER, type ProjectStage } from "@/lib/project-rules";

const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const fmtDate = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "");

export default function ProjectHubPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const role = user?.role;
  const router = useRouter();

  const { data: deals = [], isLoading } = useQuery({
    queryKey: ["projecthub-deals", companyId],
    queryFn: () => getDeals(companyId!),
    enabled: !!companyId,
  });
  const { data: partners = [] } = useQuery({
    queryKey: ["projecthub-partners", companyId],
    queryFn: () => getPartners(companyId!),
    enabled: !!companyId,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["projecthub-users", companyId],
    queryFn: () => getCompanyUsers(companyId!),
    enabled: !!companyId,
  });

  // 진행률 — deal_milestones 완료율 (없으면 null → "—")
  const dealIds = useMemo(() => (deals as any[]).map((d) => d.id), [deals]);
  const { data: milestones = [] } = useQuery({
    queryKey: ["projecthub-milestones", companyId, dealIds.length],
    queryFn: async () => {
      if (dealIds.length === 0) return [];
      const { data } = await supabase.from("deal_milestones").select("deal_id, status, completed_at").in("deal_id", dealIds);
      return (data || []) as any[];
    },
    enabled: !!companyId && dealIds.length > 0,
  });

  const partnerName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of partners as any[]) m[p.id] = p.name;
    return m;
  }, [partners]);
  const userName = useMemo(() => {
    const m: Record<string, string> = {};
    for (const u of users as any[]) m[u.id] = u.name;
    return m;
  }, [users]);
  const progressByDeal = useMemo(() => {
    const m: Record<string, { done: number; total: number }> = {};
    for (const ms of milestones as any[]) {
      const e = (m[ms.deal_id] ||= { done: 0, total: 0 });
      e.total += 1;
      if (ms.status === "completed" || ms.completed_at) e.done += 1;
    }
    return m;
  }, [milestones]);

  const rows = useMemo(() => {
    return (deals as any[]).slice().sort((a, b) => Number(b.contract_total || 0) - Number(a.contract_total || 0));
  }, [deals]);

  const summary = useMemo(() => {
    const total = rows.length;
    const inProgress = rows.filter((d) => d.stage === "in_progress").length;
    const totalContract = rows.reduce((s, d) => s + Number(d.contract_total || 0), 0);
    return { total, inProgress, totalContract };
  }, [rows]);

  if (role && role !== "owner" && role !== "admin") return <AccessDenied />;

  return (
    <div className="space-y-4">
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">프로젝트</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">견적 → 계약 → 진행 → 손익까지 프로젝트별 라이프사이클·수익성을 관리합니다</p>
        </div>
        <Link href="/projects" className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">
          워크플로우 보드 →
        </Link>
      </div>

      {/* 요약 카드 */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="glass-card px-4 py-3">
          <div className="text-xs text-[var(--text-muted)]">전체 프로젝트</div>
          <div className="text-2xl font-bold mono-number mt-0.5 text-[var(--text)]">{summary.total}</div>
        </div>
        <div className="glass-card px-4 py-3">
          <div className="text-xs text-[var(--text-muted)]">진행중</div>
          <div className="text-2xl font-bold mono-number mt-0.5 text-amber-500">{summary.inProgress}</div>
        </div>
        <div className="glass-card px-4 py-3">
          <div className="text-xs text-[var(--text-muted)]">총 계약금액</div>
          <div className="text-xl font-bold mono-number mt-0.5 text-[var(--text)]">{won(summary.totalContract)}</div>
        </div>
        <div className="glass-card px-4 py-3">
          <div className="text-xs text-[var(--text-muted)]">평균 원가율</div>
          <div className="text-xl font-bold mono-number mt-0.5 text-[var(--text-dim)]" title="손익 단계에서 산출됩니다">—</div>
        </div>
      </div>

      {/* 목록 그리드 */}
      <div className="glass-card overflow-hidden">
        <div className="overflow-auto max-h-[640px]">
          <table className="w-full min-w-[820px] text-xs border-collapse">
            <thead className="sticky top-0 z-10">
              <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="px-3 py-2 text-left font-semibold">프로젝트명</th>
                <th className="px-3 py-2 text-left font-semibold border-l border-[var(--border)]/60">거래처</th>
                <th className="px-3 py-2 text-left font-semibold border-l border-[var(--border)]/60 w-[110px]">담당자</th>
                <th className="px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[80px]">단계</th>
                <th className="px-3 py-2 text-right font-semibold border-l border-[var(--border)]/60 w-[130px]">계약금액</th>
                <th className="px-3 py-2 text-center font-semibold border-l border-[var(--border)]/60 w-[110px]">진행률</th>
                <th className="px-3 py-2 text-left font-semibold border-l border-[var(--border)]/60 w-[160px]">기간</th>
              </tr>
            </thead>
            <tbody>
              {isLoading ? (
                <tr><td colSpan={7} className="p-10 text-center text-[var(--text-muted)]">불러오는 중...</td></tr>
              ) : rows.length === 0 ? (
                <tr><td colSpan={7} className="p-10 text-center text-[var(--text-muted)]">프로젝트가 없습니다. 워크플로우 보드에서 새 프로젝트를 추가하세요.</td></tr>
              ) : rows.map((d) => {
                const stage = (STAGE_ORDER.includes(d.stage) ? d.stage : "estimate") as ProjectStage;
                const sc = STAGE_COLOR[stage];
                const prog = progressByDeal[d.id];
                const pct = prog && prog.total > 0 ? Math.round((prog.done / prog.total) * 100) : null;
                return (
                  <tr key={d.id} onClick={() => router.push(`/projecthub/${d.id}`)}
                    className="border-b border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/50 cursor-pointer">
                    <td className="px-3 py-2 text-[var(--text)] font-medium">{d.name || "(이름 없음)"}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)] border-l border-[var(--border)]/30 truncate">{partnerName[d.partner_id] || "—"}</td>
                    <td className="px-3 py-2 text-[var(--text-muted)] border-l border-[var(--border)]/30 truncate">{userName[d.internal_manager_id] || "—"}</td>
                    <td className="px-3 py-2 text-center border-l border-[var(--border)]/30">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.text}`}>{STAGE_LABEL[stage]}</span>
                    </td>
                    <td className="px-3 py-2 text-right mono-number text-[var(--text)] border-l border-[var(--border)]/30">{won(d.contract_total)}</td>
                    <td className="px-3 py-2 border-l border-[var(--border)]/30">
                      {pct == null ? <span className="text-[var(--text-dim)] text-[11px]">—</span> : (
                        <div className="flex items-center gap-1.5">
                          <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                            <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
                          </div>
                          <span className="text-[10px] mono-number text-[var(--text-muted)] w-8 text-right">{pct}%</span>
                        </div>
                      )}
                    </td>
                    <td className="px-3 py-2 text-[var(--text-muted)] mono-number border-l border-[var(--border)]/30 text-[11px]">
                      {fmtDate(d.start_date) || "—"}{d.end_date ? ` ~ ${fmtDate(d.end_date)}` : ""}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <p className="text-[11px] text-[var(--text-dim)]">※ 워크플로우(보드)와 같은 프로젝트(deal) 데이터입니다 — 한쪽에서 생성·삭제하면 양쪽에 반영됩니다. 원가율·손익은 손익 탭에서 산출됩니다.</p>
    </div>
  );
}
