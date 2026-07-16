"use client";

// 목표형 전용 관리자 성과 대시보드 — 4뷰 토글.
//   ① 이번주 브리핑: 목표 프로젝트 한 줄(담당·상태·평균달성률·성과 1줄·이슈 1줄)
//   ② 사람별: 멤버별 담당 프로젝트·이번주 제출·책임 KPI 진척
//   ③ 팀별: employees.department 롤업(입력률·평균 달성률)
//   ④ 입력률: 제출/대상 + 미제출자 목록 + 리마인더 발송(notifications)
//   읽기 전용 집계(리마인더 발송만 쓰기). 신규 테이블 0 — 계산형 미제출 판정.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { getKpiAchievement, getOverallAchievement } from "@/lib/project-types";
import { computePeriodStart, periodLabel, normalizeCadence, type Cadence } from "@/lib/project-checkin";

const db = supabase as any;
const STATUS_DOT: Record<string, string> = { green: "bg-green-500", yellow: "bg-amber-500", red: "bg-red-500", neutral: "bg-[var(--text-dim)]" };
const pctColor = (p: number | null) => (p == null ? "text-[var(--text-dim)]" : p >= 100 ? "text-[var(--primary)]" : p < 40 ? "text-[var(--danger)]" : "text-[var(--text)]");

type View = "briefing" | "multi" | "people" | "teams" | "dept" | "rate";
const won = (n: number) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;

export function PerformanceDashboard({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [view, setView] = useState<View>("briefing");
  const [sending, setSending] = useState<string | null>(null);

  // 목표형 프로젝트
  const { data: deals = [] } = useQuery({
    queryKey: ["perf-dash-deals", companyId],
    queryFn: async () => {
      const { data } = await db.from("deals").select("id, name, internal_manager_id, partner_id, checkin_cadence, checkin_due_weekday")
        .eq("company_id", companyId).eq("project_type", "goal").is("archived_at", null).is("parent_deal_id", null);
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });
  const dealIds = useMemo(() => (deals as any[]).map((d) => d.id), [deals]);

  const { data: kpis = [] } = useQuery({
    queryKey: ["perf-dash-kpis", companyId, dealIds.length],
    queryFn: async () => {
      if (dealIds.length === 0) return [];
      const { data } = await db.from("project_kpis").select("id, deal_id, label, target_value, direction, source, owner_id").in("deal_id", dealIds);
      return (data || []) as any[];
    },
    enabled: !!companyId && dealIds.length > 0,
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["perf-dash-entries", companyId, dealIds.length],
    queryFn: async () => {
      if (dealIds.length === 0) return [];
      const { data } = await db.from("project_kpi_entries").select("deal_id, kpi_id, value, department_id, created_by").in("deal_id", dealIds);
      return (data || []) as any[];
    },
    enabled: !!companyId && dealIds.length > 0,
  });
  const { data: autos = [] } = useQuery({
    queryKey: ["perf-dash-autos", companyId, dealIds.length],
    queryFn: async () => {
      if (dealIds.length === 0) return [];
      const { data } = await db.from("v_deal_kpi_auto").select("deal_id, revenue_actual, profit_actual, output_count").in("deal_id", dealIds);
      return (data || []) as any[];
    },
    enabled: !!companyId && dealIds.length > 0,
  });
  const { data: partners = [] } = useQuery({
    queryKey: ["perf-dash-partners", companyId],
    queryFn: async () => {
      const { data } = await db.from("partners").select("id, name").eq("company_id", companyId);
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });
  const partnerName = (id?: string | null) => (partners as any[]).find((p) => p.id === id)?.name || "미지정";
  const { data: updates = [] } = useQuery({
    queryKey: ["perf-dash-updates", companyId, dealIds.length],
    queryFn: async () => {
      if (dealIds.length === 0) return [];
      const { data } = await db.from("project_updates").select("deal_id, status, did, issues, next_plan, period_start, created_by, update_date")
        .in("deal_id", dealIds).order("update_date", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!companyId && dealIds.length > 0,
  });
  const { data: assignments = [] } = useQuery({
    queryKey: ["perf-dash-assignments", companyId, dealIds.length],
    queryFn: async () => {
      if (dealIds.length === 0) return [];
      const { data } = await db.from("deal_assignments").select("deal_id, user_id, is_active").in("deal_id", dealIds).eq("is_active", true);
      return (data || []) as any[];
    },
    enabled: !!companyId && dealIds.length > 0,
  });
  const { data: people = [] } = useQuery({
    queryKey: ["perf-dash-people", companyId],
    queryFn: async () => {
      const [{ data: us }, { data: emps }] = await Promise.all([
        db.from("users").select("id, name, email").eq("company_id", companyId),
        db.from("employees").select("user_id, department, name").eq("company_id", companyId),
      ]);
      const deptByUser: Record<string, string> = {};
      (emps || []).forEach((e: any) => { if (e.user_id) deptByUser[e.user_id] = e.department || "미지정"; });
      return (us || []).map((u: any) => ({ id: u.id, name: u.name || u.email || "구성원", dept: deptByUser[u.id] || "미지정" }));
    },
    enabled: !!companyId,
  });
  const nameOf = (id?: string | null) => (people as any[]).find((p) => p.id === id)?.name || "—";
  const deptOf = (id?: string | null) => (people as any[]).find((p) => p.id === id)?.dept || "미지정";

  // 부서별(입력 기반) — entries.department_id 그룹. 2026-06-29 부서별 성과 P3
  const { data: deptMaster = [] } = useQuery({
    queryKey: ["perf-dash-departments", companyId],
    queryFn: async () => {
      const { data } = await db.from("departments").select("id, name").eq("company_id", companyId).is("archived_at", null);
      return (data || []) as { id: string; name: string }[];
    },
    enabled: !!companyId,
  });
  const deptNameById = (id?: string | null) => (id ? (deptMaster as any[]).find((d) => d.id === id)?.name || "(미지정)" : "(미지정)");
  const byDeptInput = useMemo(() => {
    const m: Record<string, { ids: Set<string>; count: number; sum: number }> = {};
    for (const e of entries as any[]) {
      const key = e.department_id || "__none";
      (m[key] ||= { ids: new Set(), count: 0, sum: 0 });
      m[key].count++; m[key].sum += Number(e.value || 0);
      if (e.created_by) m[key].ids.add(e.created_by);
    }
    return Object.entries(m)
      .map(([k, v]) => ({ label: k === "__none" ? "(미지정)" : deptNameById(k), count: v.count, people: v.ids.size, sum: v.sum }))
      .sort((a, b) => b.count - a.count);
  }, [entries, deptMaster]);

  // ── 집계 ──
  const entriesSumByKpi = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries as any[]) m[e.kpi_id] = (m[e.kpi_id] || 0) + Number(e.value || 0);
    return m;
  }, [entries]);
  const autoByDeal = useMemo(() => {
    const m: Record<string, { revenue: number; profit: number; count: number }> = {};
    for (const r of autos as any[]) m[r.deal_id] = { revenue: Number(r.revenue_actual || 0), profit: Number(r.profit_actual || 0), count: Number(r.output_count || 0) };
    return m;
  }, [autos]);
  const autoActualOf = (dealId: string, source: string): number => {
    const a = autoByDeal[dealId] || { revenue: 0, profit: 0, count: 0 };
    if (source === "profit_auto") return a.profit;
    if (source === "count_auto") return a.count;
    return a.revenue; // revenue_auto
  };
  const kpisByDeal = useMemo(() => {
    const m: Record<string, any[]> = {};
    for (const k of kpis as any[]) (m[k.deal_id] ||= []).push(k);
    return m;
  }, [kpis]);

  const achievementOf = (dealId: string): number | null => {
    const ks = kpisByDeal[dealId] || [];
    if (ks.length === 0) return null;
    const rows = ks.map((k: any) => {
      const actual = k.source === "manual" ? (entriesSumByKpi[k.id] || 0) : autoActualOf(dealId, k.source);
      return { target: Number(k.target_value || 0), actual, direction: k.direction };
    });
    const ov = getOverallAchievement(rows);
    return ov == null ? null : Math.round(ov * 100);
  };
  const kpiAchievement = (k: any): number | null => {
    const actual = k.source === "manual" ? (entriesSumByKpi[k.id] || 0) : autoActualOf(k.deal_id, k.source);
    const a = getKpiAchievement(Number(k.target_value || 0), actual, k.direction);
    return a == null ? null : Math.round(a * 100);
  };
  // 프로젝트별 최신 체크인
  const latestUpdate = useMemo(() => {
    const m: Record<string, any> = {};
    for (const u of updates as any[]) if (!m[u.deal_id]) m[u.deal_id] = u; // updates 는 update_date desc
    return m;
  }, [updates]);

  // 이번 주기 정보 (프로젝트별 cadence)
  const periodOf = (d: any) => {
    const c = normalizeCadence(d.checkin_cadence) as Cadence;
    return c === "none" ? null : computePeriodStart(c);
  };
  // 프로젝트별 배정 멤버
  const assignedByDeal = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const a of assignments as any[]) (m[a.deal_id] ||= []).push(a.user_id);
    return m;
  }, [assignments]);
  // 프로젝트별 이번 주기 제출자
  const submittedByDeal = useMemo(() => {
    const m: Record<string, Set<string>> = {};
    for (const d of deals as any[]) {
      const p = periodOf(d);
      if (!p) continue;
      const set = new Set<string>();
      for (const u of updates as any[]) if (u.deal_id === d.id && u.created_by && String(u.period_start || "").slice(0, 10) === p) set.add(u.created_by);
      m[d.id] = set;
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals, updates]);

  // 입력률 — 대상(배정 멤버, cadence!=none) / 제출
  const rateStats = useMemo(() => {
    let target = 0, done = 0;
    const perDeal: { deal: any; assigned: string[]; missing: string[] }[] = [];
    for (const d of deals as any[]) {
      if (normalizeCadence(d.checkin_cadence) === "none") continue;
      const assigned = assignedByDeal[d.id] || [];
      if (assigned.length === 0) continue;
      const sub = submittedByDeal[d.id] || new Set();
      const missing = assigned.filter((u) => !sub.has(u));
      target += assigned.length;
      done += assigned.length - missing.length;
      perDeal.push({ deal: d, assigned, missing });
    }
    return { target, done, perDeal };
  }, [deals, assignedByDeal, submittedByDeal]);

  // 사람별
  const byPerson = useMemo(() => {
    const map: Record<string, { id: string; projects: string[]; submitted: number; ownedKpis: any[] }> = {};
    for (const d of deals as any[]) {
      const p = periodOf(d);
      const sub = submittedByDeal[d.id] || new Set();
      for (const uid of (assignedByDeal[d.id] || [])) {
        (map[uid] ||= { id: uid, projects: [], submitted: 0, ownedKpis: [] });
        map[uid].projects.push(d.id);
        if (p && sub.has(uid)) map[uid].submitted++;
      }
    }
    for (const k of kpis as any[]) if (k.owner_id) { (map[k.owner_id] ||= { id: k.owner_id, projects: [], submitted: 0, ownedKpis: [] }); map[k.owner_id].ownedKpis.push(k); }
    return Object.values(map);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deals, assignedByDeal, submittedByDeal, kpis]);

  // 팀별
  const byTeam = useMemo(() => {
    const teams: Record<string, { dept: string; members: Set<string>; ach: number[] }> = {};
    for (const person of byPerson) {
      const dept = deptOf(person.id);
      (teams[dept] ||= { dept, members: new Set(), ach: [] });
      teams[dept].members.add(person.id);
      for (const k of person.ownedKpis) { const a = kpiAchievement(k); if (a != null) teams[dept].ach.push(a); }
    }
    return Object.values(teams).map((t) => ({ dept: t.dept, count: t.members.size, avgAch: t.ach.length ? Math.round(t.ach.reduce((s, x) => s + x, 0) / t.ach.length) : null }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byPerson]);

  const sendReminders = async (d: any, missing: string[]) => {
    if (missing.length === 0) { toast("미제출자가 없습니다", "info"); return; }
    setSending(d.id);
    try {
      const p = periodOf(d);
      const rows = missing.map((uid) => ({
        company_id: companyId, user_id: uid, type: "project_checkin_due",
        title: `[성과 체크인] ${d.name}`,
        message: `${p ? periodLabel(p, normalizeCadence(d.checkin_cadence) as Cadence) : ""} 성과 체크인을 제출해주세요`,
        entity_type: "project_checkin", entity_id: d.id, is_read: false,
      }));
      const { error } = await db.from("notifications").insert(rows);
      if (error) throw new Error(error.message);
      toast(`${missing.length}명에게 리마인더를 보냈습니다`, "success");
      qc.invalidateQueries({ queryKey: ["notifications"] });
    } catch (e: any) { toast(e?.message || "발송 실패", "error"); } finally { setSending(null); }
  };

  const VIEWS: { key: View; label: string }[] = [
    { key: "briefing", label: "이번주 브리핑" },
    { key: "multi", label: "다차원 집계" },
    { key: "people", label: "사람별" },
    { key: "teams", label: "팀별(담당자 부서)" },
    { key: "dept", label: "부서별(입력)" },
    { key: "rate", label: "입력률" },
  ];

  const goalDeals = deals as any[];

  // 다차원 집계 (거래처/팀/담당자별 건수·매출·평균달성률) — 주간보고 양식 §12-D
  const groupDim = (keyFn: (d: any) => string, labelFn: (key: string) => string) => {
    const g: Record<string, { label: string; count: number; revenue: number; ach: number[] }> = {};
    for (const d of goalDeals) {
      const key = keyFn(d) || "__none";
      (g[key] ||= { label: labelFn(key), count: 0, revenue: 0, ach: [] });
      g[key].count++;
      g[key].revenue += autoByDeal[d.id]?.revenue || 0;
      const a = achievementOf(d.id);
      if (a != null) g[key].ach.push(a);
    }
    return Object.values(g)
      .map((x) => ({ label: x.label, count: x.count, revenue: x.revenue, avgAch: x.ach.length ? Math.round(x.ach.reduce((s, v) => s + v, 0) / x.ach.length) : null }))
      .sort((a, b) => b.revenue - a.revenue);
  };
  const byChannel = groupDim((d) => d.partner_id, (k) => (k === "__none" ? "미지정" : partnerName(k)));
  const byTeamDim = groupDim((d) => deptOf(d.internal_manager_id), (k) => (k === "__none" ? "미지정" : k));
  const byManager = groupDim((d) => d.internal_manager_id, (k) => (k === "__none" ? "미지정" : nameOf(k)));

  const DimTable = ({ title, rows }: { title: string; rows: { label: string; count: number; revenue: number; avgAch: number | null }[] }) => (
    <div className="dim-table-block">
      <div className="text-xs font-bold text-[var(--text-muted)] mb-1.5">{title}</div>
      <div className="dim-table-wrap">
        <table className="w-full text-sm border-collapse min-w-[420px]">
          <thead>
            <tr className="text-xs text-[var(--text-dim)]">
              <th className="px-3 py-2 text-left border-b border-[var(--border)]">{title.replace("별", "")}</th>
              <th className="px-3 py-2 text-center border-b border-[var(--border)] w-[60px]">건수</th>
              <th className="px-3 py-2 text-right border-b border-[var(--border)] w-[140px]">매출</th>
              <th className="px-3 py-2 text-center border-b border-[var(--border)] w-[100px]">평균달성</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr><td colSpan={4} className="p-6 text-center text-sm text-[var(--text-muted)]">데이터 없음</td></tr>
            ) : rows.map((r) => (
              <tr key={r.label} className="hover:bg-[var(--bg-surface)]/50">
                <td className="px-3 py-2 border-b border-[var(--border)]/40 font-medium text-[var(--text)]">{r.label}</td>
                <td className="px-3 py-2 border-b border-[var(--border)]/40 text-center mono-number text-[var(--text-muted)]">{r.count}</td>
                <td className="px-3 py-2 border-b border-[var(--border)]/40 text-right mono-number text-[var(--text)]">{won(r.revenue)}</td>
                <td className={`px-3 py-2 border-b border-[var(--border)]/40 text-center mono-number font-semibold ${pctColor(r.avgAch)}`}>{r.avgAch == null ? "—" : `${r.avgAch}%`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  return (
    <div className="perf-dashboard-panel glass-card">
      <div className="perf-dashboard-header">
        <h3 className="text-sm font-bold text-[var(--text)]">🎯 성과 대시보드 <span className="text-xs font-normal text-[var(--text-dim)]">목표형 {goalDeals.length}건</span></h3>
        <button onClick={onClose} className="btn-ghost text-xs">닫기 ✕</button>
      </div>

      <div className="perf-view-toggle seg-bar">
        {VIEWS.map((v) => (
          <button key={v.key} onClick={() => setView(v.key)}
            className={`seg-item ${view === v.key ? "seg-item-active" : ""}`}>
            {v.label}
          </button>
        ))}
      </div>

      {goalDeals.length === 0 ? (
        <div className="perf-dashboard-empty">목표형 프로젝트가 없습니다.</div>
      ) : view === "briefing" ? (
        <div className="briefing-table-wrap">
          <table className="w-full text-sm border-collapse min-w-[820px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)]">
                <th className="px-3 py-2.5 text-left border-b border-[var(--border)]">프로젝트</th>
                <th className="px-3 py-2.5 text-left border-b border-[var(--border)] w-[110px]">담당</th>
                <th className="px-3 py-2.5 text-center border-b border-[var(--border)] w-[60px]">상태</th>
                <th className="px-3 py-2.5 text-center border-b border-[var(--border)] w-[110px]">평균달성</th>
                <th className="px-3 py-2.5 text-left border-b border-[var(--border)]">최근 성과 / 이슈</th>
              </tr>
            </thead>
            <tbody>
              {goalDeals.map((d) => {
                const ach = achievementOf(d.id);
                const u = latestUpdate[d.id];
                const st = u?.status || "neutral";
                return (
                  <tr key={d.id} className="hover:bg-[var(--bg-surface)]/50">
                    <td className="px-3 py-2.5 border-b border-[var(--border)]/40 font-medium text-[var(--text)]">{d.name}</td>
                    <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-[var(--text-muted)] text-xs">{nameOf(d.internal_manager_id)}</td>
                    <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center"><span className={`inline-block w-2.5 h-2.5 rounded-full ${STATUS_DOT[st]}`} title={st} /></td>
                    <td className={`px-3 py-2.5 border-b border-[var(--border)]/40 text-center mono-number font-semibold ${pctColor(ach)}`}>{ach == null ? "—" : `${ach}%`}</td>
                    <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-xs text-[var(--text-muted)]">
                      {u ? (
                        <div className="space-y-0.5">
                          {(u.did || u.issues) ? (<>
                            {u.did && <div className="truncate">✅ {u.did}</div>}
                            {u.issues && <div className="truncate text-amber-600">🚧 {u.issues}</div>}
                          </>) : <div className="truncate">{u.next_plan || "—"}</div>}
                        </div>
                      ) : <span className="text-[var(--text-dim)]">체크인 없음</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : view === "multi" ? (
        <div className="perf-multi-dim-view">
          <div className="text-[11px] text-[var(--text-dim)]">매출 = 태깅 세금계산서(sales) 기준 · 평균달성 = 종합 달성률 평균. 거래처=채널, 팀=담당자 부서.</div>
          <DimTable title="거래처별" rows={byChannel} />
          <DimTable title="팀별" rows={byTeamDim} />
          <DimTable title="담당자별" rows={byManager} />
        </div>
      ) : view === "people" ? (
        <div className="people-table-wrap">
          <table className="w-full text-sm border-collapse min-w-[640px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)]">
                <th className="px-3 py-2.5 text-left border-b border-[var(--border)]">구성원</th>
                <th className="px-3 py-2.5 text-left border-b border-[var(--border)] w-[100px]">팀</th>
                <th className="px-3 py-2.5 text-center border-b border-[var(--border)] w-[110px]">담당 프로젝트</th>
                <th className="px-3 py-2.5 text-center border-b border-[var(--border)] w-[110px]">이번주 제출</th>
                <th className="px-3 py-2.5 text-center border-b border-[var(--border)] w-[120px]">책임 KPI 평균</th>
              </tr>
            </thead>
            <tbody>
              {byPerson.length === 0 ? (
                <tr><td colSpan={5} className="p-8 text-center text-sm text-[var(--text-muted)]">배정된 멤버가 없습니다.</td></tr>
              ) : byPerson.map((p) => {
                const owned = p.ownedKpis.map((k) => kpiAchievement(k)).filter((x): x is number => x != null);
                const avg = owned.length ? Math.round(owned.reduce((s, x) => s + x, 0) / owned.length) : null;
                const trackable = p.projects.filter((id) => { const d = goalDeals.find((x) => x.id === id); return d && normalizeCadence(d.checkin_cadence) !== "none"; }).length;
                return (
                  <tr key={p.id} className="hover:bg-[var(--bg-surface)]/50">
                    <td className="px-3 py-2.5 border-b border-[var(--border)]/40 font-medium text-[var(--text)]">{nameOf(p.id)}</td>
                    <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-xs text-[var(--text-muted)]">{deptOf(p.id)}</td>
                    <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center mono-number text-[var(--text-muted)]">{p.projects.length}</td>
                    <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center mono-number">
                      <span className={p.submitted >= trackable && trackable > 0 ? "text-green-500" : "text-amber-600"}>{p.submitted}/{trackable}</span>
                    </td>
                    <td className={`px-3 py-2.5 border-b border-[var(--border)]/40 text-center mono-number font-semibold ${pctColor(avg)}`}>{avg == null ? "—" : `${avg}%`}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : view === "teams" ? (
        <div className="teams-table-wrap">
          <table className="w-full text-sm border-collapse min-w-[480px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)]">
                <th className="px-3 py-2.5 text-left border-b border-[var(--border)]">팀</th>
                <th className="px-3 py-2.5 text-center border-b border-[var(--border)] w-[100px]">인원</th>
                <th className="px-3 py-2.5 text-center border-b border-[var(--border)] w-[140px]">평균 달성률</th>
              </tr>
            </thead>
            <tbody>
              {byTeam.length === 0 ? (
                <tr><td colSpan={3} className="p-8 text-center text-sm text-[var(--text-muted)]">데이터가 없습니다.</td></tr>
              ) : byTeam.map((t) => (
                <tr key={t.dept} className="hover:bg-[var(--bg-surface)]/50">
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 font-medium text-[var(--text)]">{t.dept}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center mono-number text-[var(--text-muted)]">{t.count}</td>
                  <td className={`px-3 py-2.5 border-b border-[var(--border)]/40 text-center mono-number font-semibold ${pctColor(t.avgAch)}`}>{t.avgAch == null ? "—" : `${t.avgAch}%`}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : view === "dept" ? (
        <div className="dept-table-wrap">
          <div className="text-[11px] text-[var(--text-dim)] mb-2">실적 입력 시 지정한 부서 기준 집계. 합계는 KPI 단위가 섞일 수 있어 참고용(건수·참여 인원 우선).</div>
          <table className="w-full text-sm border-collapse min-w-[480px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)]">
                <th className="px-3 py-2.5 text-left border-b border-[var(--border)]">부서</th>
                <th className="px-3 py-2.5 text-center border-b border-[var(--border)] w-[110px]">입력 건수</th>
                <th className="px-3 py-2.5 text-center border-b border-[var(--border)] w-[110px]">참여 인원</th>
                <th className="px-3 py-2.5 text-right border-b border-[var(--border)] w-[150px]">입력 합계 <span className="font-normal text-[var(--text-dim)]">(단위혼합)</span></th>
              </tr>
            </thead>
            <tbody>
              {byDeptInput.length === 0 ? (
                <tr><td colSpan={4} className="p-8 text-center text-sm text-[var(--text-muted)]">부서가 지정된 실적 입력이 없습니다. (성과 탭 ②에서 실적 입력 시 부서 선택)</td></tr>
              ) : byDeptInput.map((d) => (
                <tr key={d.label} className="hover:bg-[var(--bg-surface)]/50">
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 font-medium text-[var(--text)]">{d.label}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center mono-number text-[var(--text-muted)]">{d.count}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center mono-number text-[var(--text-muted)]">{d.people}</td>
                  <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-right mono-number text-[var(--text)]">{Math.round(d.sum).toLocaleString("ko-KR")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        // 입력률
        <div className="perf-rate-view">
          <div className="perf-rate-summary">
            <div className="text-2xl font-extrabold text-[var(--text)] mono-number">
              {rateStats.target === 0 ? "—" : `${Math.round((rateStats.done / rateStats.target) * 100)}%`}
            </div>
            <div className="text-xs text-[var(--text-muted)]">이번 주기 제출 <b className="text-[var(--text)]">{rateStats.done}</b> / 대상 <b className="text-[var(--text)]">{rateStats.target}</b></div>
          </div>
          {rateStats.perDeal.length === 0 ? (
            <div className="p-8 text-center text-sm text-[var(--text-muted)]">체크인 주기가 설정된 목표형 프로젝트가 없습니다. (성과 탭 ⓪에서 주기·멤버를 설정하세요)</div>
          ) : rateStats.perDeal.map(({ deal: d, assigned, missing }) => (
            <div key={d.id} className="perf-rate-row">
              <div className="min-w-0">
                <div className="text-sm font-medium text-[var(--text)] truncate">{d.name}</div>
                <div className="text-xs text-[var(--text-muted)] mt-0.5">
                  제출 {assigned.length - missing.length}/{assigned.length}
                  {missing.length > 0 && <span className="text-amber-600"> · 미제출: {missing.map((u) => nameOf(u)).join(", ")}</span>}
                </div>
              </div>
              <button onClick={() => sendReminders(d, missing)} disabled={missing.length === 0 || sending === d.id}
                className="btn-primary text-xs whitespace-nowrap hover:opacity-90">
                {sending === d.id ? "발송 중..." : missing.length === 0 ? "전원 제출" : `리마인더 ${missing.length}`}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
