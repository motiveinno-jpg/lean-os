"use client";

// 목표형 '성과' 탭 — 성과관리 모델.
//   ① KPI 관리(project_kpis): 추가/수정/삭제 (label·unit·target_value·direction·source)
//   ② 각 KPI 실적: revenue_auto = v_deal_revenue_actual 자동 / manual = project_kpi_entries(kpi_id) 입력·목록
//   ③ 성과 체크인 타임라인(project_updates): 신호등 status + body + 작성 시점 KPI 달성률 스냅샷(kpi_snapshot) 자동 캡처

import { useMemo, useState, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { DateField } from "@/components/date-field";
import { getKpiAchievement, KPI_SOURCE_LABEL, type KpiSource } from "@/lib/project-types";
import { getCompanyMembers } from "@/lib/hr";
import { computePeriodStart, computeDueDate, periodLabel, normalizeCadence, CADENCE_LABEL, WEEKDAY_LABEL, todayYMD, type Cadence } from "@/lib/project-checkin";

const db = supabase as any;
const fmtNum = (n: number, unit: string) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}${unit}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const numComma = (s: string) => { const n = Number(String(s).replace(/[^0-9.-]/g, "")); return n ? n.toLocaleString("ko-KR") : ""; };

type Kpi = { id: string; label: string; unit: string; target_value: number; direction: "up" | "down"; source: KpiSource; sort_order: number; owner_id?: string | null };
type Member = { id: string; name?: string | null; email?: string | null };
type Entry = { id: string; kpi_id: string; entry_date: string; value: number; memo: string | null; department_id: string | null };
type Dept = { id: string; name: string };

const IN = "w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]";
const LB = "block text-xs text-[var(--text-muted)] mb-1";

const STATUS_META: Record<string, { dot: string; text: string; label: string }> = {
  green: { dot: "bg-green-500", text: "text-green-500", label: "정상" },
  yellow: { dot: "bg-amber-500", text: "text-amber-500", label: "주의" },
  red: { dot: "bg-red-500", text: "text-red-500", label: "위험" },
};

export function PerformanceTab({ dealId, companyId, deal }: { dealId: string; companyId: string; deal: any }) {
  const { user, role } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isManager = role === "owner" || role === "admin";

  const { data: kpis = [] } = useQuery({
    queryKey: ["project-kpis", dealId],
    queryFn: async () => {
      const { data } = await db.from("project_kpis").select("id, label, unit, target_value, direction, source, sort_order, owner_id").eq("deal_id", dealId).order("sort_order", { ascending: true });
      return (data || []) as Kpi[];
    },
    enabled: !!dealId,
  });

  // 회사 구성원 (KPI 책임자·멤버 배정 선택 풀)
  const { data: members = [] } = useQuery({
    queryKey: ["company-members", companyId],
    queryFn: () => getCompanyMembers(companyId),
    enabled: !!companyId,
  });
  const memberName = (id?: string | null) => {
    if (!id) return "";
    const m = (members as Member[]).find((x) => x.id === id);
    return m?.name || m?.email || "구성원";
  };

  // 프로젝트 멤버 배정 (deal_assignments 재활용)
  const { data: assignments = [] } = useQuery({
    queryKey: ["deal-assignments", dealId],
    queryFn: async () => {
      const { data } = await db.from("deal_assignments").select("id, user_id, role, is_active").eq("deal_id", dealId).eq("is_active", true);
      return (data || []) as any[];
    },
    enabled: !!dealId,
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["project-kpi-entries-all", dealId],
    queryFn: async () => {
      const { data } = await db.from("project_kpi_entries").select("id, kpi_id, entry_date, value, memo, department_id").eq("deal_id", dealId).order("entry_date", { ascending: false });
      return (data || []) as Entry[];
    },
    enabled: !!dealId,
  });

  // 부서 마스터 + 내 부서 (성과 입력 부서 귀속) — 2026-06-29 부서별 성과 P2
  const { data: departments = [] } = useQuery({
    queryKey: ["departments", companyId],
    queryFn: async () => {
      const { data } = await db.from("departments").select("id, name").eq("company_id", companyId).is("archived_at", null).order("sort_order", { ascending: true }).order("name", { ascending: true });
      return (data || []) as Dept[];
    },
    enabled: !!companyId,
  });
  const { data: myDeptName = "" } = useQuery({
    queryKey: ["my-department", companyId, user?.id],
    queryFn: async () => {
      const { data } = await db.from("employees").select("department").eq("company_id", companyId).eq("user_id", user?.id).maybeSingle();
      return (data?.department || "") as string;
    },
    enabled: !!companyId && !!user?.id,
  });
  const myDeptId = useMemo(() => (departments as Dept[]).find((d) => d.name === myDeptName)?.id || "", [departments, myDeptName]);
  const deptName = (id?: string | null) => (id ? (departments as Dept[]).find((d) => d.id === id)?.name || "—" : "—");

  const hasAuto = (kpis as Kpi[]).some((k) => k.source !== "manual");
  const { data: autoActual } = useQuery({
    queryKey: ["deal-kpi-auto", dealId],
    queryFn: async () => {
      const { data } = await db.from("v_deal_kpi_auto").select("revenue_actual, profit_actual, output_count").eq("deal_id", dealId).maybeSingle();
      return { revenue: Number(data?.revenue_actual || 0), profit: Number(data?.profit_actual || 0), count: Number(data?.output_count || 0) };
    },
    enabled: !!dealId && hasAuto,
  });
  const { data: updates = [] } = useQuery({
    queryKey: ["project-updates", dealId],
    queryFn: async () => {
      const { data } = await db.from("project_updates").select("id, update_date, status, body, did, issues, next_plan, period_start, created_by, kpi_snapshot, created_at").eq("deal_id", dealId).order("update_date", { ascending: false }).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!dealId,
  });

  const actualByKpi = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries as Entry[]) m[e.kpi_id] = (m[e.kpi_id] || 0) + Number(e.value || 0);
    return m;
  }, [entries]);
  const actualOf = (k: Kpi) => {
    if (k.source === "revenue_auto") return Number(autoActual?.revenue || 0);
    if (k.source === "profit_auto") return Number(autoActual?.profit || 0);
    if (k.source === "count_auto") return Number(autoActual?.count || 0);
    return Number(actualByKpi[k.id] || 0);
  };
  // KPI별 최신 실적값(carry-forward 기준) — entries 는 entry_date desc 정렬이라 첫 등장이 최신.
  const latestByKpi = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries as Entry[]) if (!(e.kpi_id in m)) m[e.kpi_id] = Number(e.value || 0);
    return m;
  }, [entries]);

  // ── KPI 관리 폼 ──
  const [kpiForm, setKpiForm] = useState<{ id: string | null; label: string; unit: string; target: string; direction: "up" | "down"; source: KpiSource; ownerId: string }>(
    { id: null, label: "", unit: "원", target: "", direction: "up", source: "manual", ownerId: "" }
  );
  const [savingKpi, setSavingKpi] = useState(false);
  const resetKpiForm = () => setKpiForm({ id: null, label: "", unit: "원", target: "", direction: "up", source: "manual", ownerId: "" });

  const saveKpi = async () => {
    const label = kpiForm.label.trim();
    if (!label) { toast("KPI 이름을 입력하세요", "error"); return; }
    const target = Number(String(kpiForm.target).replace(/[^0-9.-]/g, "")) || 0;
    if (target <= 0) { toast("목표값을 입력하세요", "error"); return; }
    setSavingKpi(true);
    try {
      const payload = { label, unit: kpiForm.unit.trim() || "원", target_value: target, direction: kpiForm.direction, source: kpiForm.source, owner_id: kpiForm.ownerId || null };
      if (kpiForm.id) {
        const { error } = await db.from("project_kpis").update(payload).eq("id", kpiForm.id);
        if (error) throw new Error(error.message);
        toast("KPI를 수정했습니다", "success");
      } else {
        const nextOrder = (kpis as Kpi[]).reduce((m, k) => Math.max(m, k.sort_order), -1) + 1;
        const { error } = await db.from("project_kpis").insert({ company_id: companyId, deal_id: dealId, ...payload, sort_order: nextOrder });
        if (error) throw new Error(error.message);
        toast("KPI를 추가했습니다", "success");
      }
      qc.invalidateQueries({ queryKey: ["project-kpis", dealId] });
      resetKpiForm();
    } catch (e: any) { toast(e?.message || "저장 실패", "error"); } finally { setSavingKpi(false); }
  };
  const editKpi = (k: Kpi) => setKpiForm({ id: k.id, label: k.label, unit: k.unit || "원", target: Number(k.target_value).toLocaleString("ko-KR"), direction: k.direction, source: k.source, ownerId: k.owner_id || "" });
  const removeKpi = async (k: Kpi) => {
    if (!confirm(`'${k.label}' KPI와 입력한 실적을 모두 삭제할까요?`)) return;
    try {
      const { error } = await db.from("project_kpis").delete().eq("id", k.id);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["project-kpis", dealId] });
      qc.invalidateQueries({ queryKey: ["project-kpi-entries-all", dealId] });
      if (kpiForm.id === k.id) resetKpiForm();
      toast("KPI를 삭제했습니다", "info");
    } catch (e: any) { toast(e?.message || "삭제 실패", "error"); }
  };

  // ── KPI 실적 입력 (manual) ──
  const [entryKpiId, setEntryKpiId] = useState<string>("");
  const [entryDate, setEntryDate] = useState(todayStr());
  const [entryValue, setEntryValue] = useState("");
  const [entryMemo, setEntryMemo] = useState("");
  const [entryDeptId, setEntryDeptId] = useState<string>("");
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);
  const manualKpis = (kpis as Kpi[]).filter((k) => k.source === "manual");
  const resetEntry = () => { setEntryDate(todayStr()); setEntryValue(""); setEntryMemo(""); setEntryDeptId(myDeptId); setEditEntryId(null); };
  // 신규 입력 시 내 부서 기본 선택 (편집 중·이미 선택 시 유지)
  useEffect(() => { if (!editEntryId && !entryDeptId && myDeptId) setEntryDeptId(myDeptId); }, [myDeptId, editEntryId, entryDeptId]);
  const saveEntry = async () => {
    const kpiId = entryKpiId || manualKpis[0]?.id;
    if (!kpiId) { toast("실적을 입력할 수동 KPI를 선택하세요", "error"); return; }
    const v = Number(String(entryValue).replace(/[^0-9.-]/g, ""));
    if (!v) { toast("실적값을 입력하세요", "error"); return; }
    if (!entryDate) { toast("날짜를 선택하세요", "error"); return; }
    setSavingEntry(true);
    try {
      if (editEntryId) {
        const { error } = await db.from("project_kpi_entries").update({ kpi_id: kpiId, entry_date: entryDate, value: v, memo: entryMemo.trim() || null, department_id: entryDeptId || null }).eq("id", editEntryId);
        if (error) throw new Error(error.message);
        toast("실적을 수정했습니다", "success");
      } else {
        const { error } = await db.from("project_kpi_entries").insert({ company_id: companyId, deal_id: dealId, kpi_id: kpiId, entry_date: entryDate, value: v, memo: entryMemo.trim() || null, department_id: entryDeptId || null, created_by: user?.id || null });
        if (error) throw new Error(error.message);
        toast("실적을 추가했습니다", "success");
      }
      qc.invalidateQueries({ queryKey: ["project-kpi-entries-all", dealId] });
      resetEntry();
    } catch (e: any) { toast(e?.message || "저장 실패", "error"); } finally { setSavingEntry(false); }
  };
  const startEditEntry = (e: Entry) => { setEditEntryId(e.id); setEntryKpiId(e.kpi_id); setEntryDate(String(e.entry_date).slice(0, 10)); setEntryValue(Number(e.value).toLocaleString("ko-KR")); setEntryMemo(e.memo || ""); setEntryDeptId(e.department_id || ""); };
  const removeEntry = async (id: string) => {
    if (!confirm("이 실적 기록을 삭제할까요?")) return;
    try {
      const { error } = await db.from("project_kpi_entries").delete().eq("id", id);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["project-kpi-entries-all", dealId] });
      if (editEntryId === id) resetEntry();
      toast("삭제했습니다", "info");
    } catch (e: any) { toast(e?.message || "삭제 실패", "error"); }
  };
  const kpiLabel = (id: string) => (kpis as Kpi[]).find((k) => k.id === id)?.label || "(삭제된 KPI)";
  const kpiUnit = (id: string) => (kpis as Kpi[]).find((k) => k.id === id)?.unit || "";

  // ── 주기 설정 (deals.checkin_cadence / checkin_due_weekday) ──
  const cadence: Cadence = normalizeCadence(deal?.checkin_cadence);
  const dueWeekday: number | null = deal?.checkin_due_weekday ?? null;
  const curPeriod = computePeriodStart(cadence);
  const curDue = cadence === "none" ? null : computeDueDate(curPeriod, cadence, dueWeekday);
  const [savingCadence, setSavingCadence] = useState(false);
  const saveCadence = async (next: { cadence?: Cadence; weekday?: number | null }) => {
    setSavingCadence(true);
    try {
      const payload: any = {};
      if (next.cadence !== undefined) payload.checkin_cadence = next.cadence;
      if (next.weekday !== undefined) payload.checkin_due_weekday = next.weekday;
      const { error } = await db.from("deals").update(payload).eq("id", dealId);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["projecthub-deal", dealId] });
      qc.invalidateQueries({ queryKey: ["deal", dealId] });
    } catch (e: any) { toast(e?.message || "주기 저장 실패", "error"); } finally { setSavingCadence(false); }
  };

  // ── 멤버 배정 (deal_assignments) ──
  const assignedIds = new Set((assignments as any[]).map((a) => a.user_id));
  const [addMemberId, setAddMemberId] = useState("");
  const addMember = async () => {
    if (!addMemberId) { toast("배정할 구성원을 선택하세요", "error"); return; }
    if (assignedIds.has(addMemberId)) { toast("이미 배정된 구성원입니다", "info"); return; }
    try {
      const { error } = await db.from("deal_assignments").insert({ deal_id: dealId, user_id: addMemberId, role: "contributor", is_active: true });
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["deal-assignments", dealId] });
      setAddMemberId("");
      toast("멤버를 배정했습니다", "success");
    } catch (e: any) { toast(e?.message || "배정 실패", "error"); }
  };
  const removeMember = async (id: string) => {
    try {
      const { error } = await db.from("deal_assignments").update({ is_active: false, removed_at: new Date().toISOString() }).eq("id", id);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["deal-assignments", dealId] });
      toast("멤버 배정을 해제했습니다", "info");
    } catch (e: any) { toast(e?.message || "해제 실패", "error"); }
  };

  // ── 성과 체크인 (구조화 3문항 + 신호등 + KPI carry-forward) ──
  const [chkStatus, setChkStatus] = useState<"green" | "yellow" | "red">("green");
  const [chkDid, setChkDid] = useState("");
  const [chkIssues, setChkIssues] = useState("");
  const [chkNext, setChkNext] = useState("");
  const [chkDate, setChkDate] = useState(todayStr());
  const [chkKpiVals, setChkKpiVals] = useState<Record<string, string>>({});
  const [savingChk, setSavingChk] = useState(false);
  // 수동 KPI 지난값 자동채움 (carry forward) — 미설정 키만 최신값으로 채움
  useEffect(() => {
    setChkKpiVals((prev) => {
      const next = { ...prev };
      for (const k of (kpis as Kpi[]).filter((x) => x.source === "manual")) {
        if (next[k.id] === undefined) next[k.id] = latestByKpi[k.id] != null ? String(latestByKpi[k.id]) : "";
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [(kpis as Kpi[]).map((k) => k.id).join(","), JSON.stringify(latestByKpi)]);

  // 이번 주기 본인 제출 여부
  const mySubmittedThisPeriod = cadence !== "none" && (updates as any[]).some(
    (u) => u.created_by === user?.id && String(u.period_start || "").slice(0, 10) === curPeriod
  );

  const saveCheckin = async () => {
    if (!chkDid.trim() && !chkIssues.trim() && !chkNext.trim()) { toast("최소 한 문항은 입력하세요", "error"); return; }
    setSavingChk(true);
    try {
      // carry-forward: 변동된 수동 KPI 값은 실적으로도 기록(미변동=그대로 두면 새 행 없음)
      const manual = (kpis as Kpi[]).filter((k) => k.source === "manual");
      const entryRows: any[] = [];
      for (const k of manual) {
        const raw = chkKpiVals[k.id];
        if (raw === undefined || raw === "") continue;
        const v = Number(String(raw).replace(/[^0-9.-]/g, ""));
        if (!Number.isFinite(v)) continue;
        if (latestByKpi[k.id] != null && v === Number(latestByKpi[k.id])) continue; // 변동없음 → carry forward
        entryRows.push({ company_id: companyId, deal_id: dealId, kpi_id: k.id, entry_date: chkDate, value: v, memo: `체크인 ${periodLabel(curPeriod, cadence)}`, department_id: myDeptId || null, created_by: user?.id || null });
      }
      if (entryRows.length > 0) {
        const { error: eErr } = await db.from("project_kpi_entries").insert(entryRows);
        if (eErr) throw new Error(eErr.message);
      }
      // 작성 시점 KPI 달성률 스냅샷 자동 캡처 (방금 입력분 반영)
      const addedByKpi: Record<string, number> = {};
      for (const r of entryRows) addedByKpi[r.kpi_id] = (addedByKpi[r.kpi_id] || 0) + Number(r.value || 0);
      const snapshot = (kpis as Kpi[]).map((k) => {
        const actual = actualOf(k) + (addedByKpi[k.id] || 0);
        const ach = getKpiAchievement(Number(k.target_value || 0), actual, k.direction);
        return { kpi_id: k.id, label: k.label, unit: k.unit, target: Number(k.target_value || 0), actual, achievement_pct: ach == null ? null : Math.round(ach * 100) };
      });
      const { error } = await db.from("project_updates").insert({
        company_id: companyId, deal_id: dealId, update_date: chkDate,
        period_start: cadence === "none" ? null : curPeriod,
        status: chkStatus, did: chkDid.trim() || null, issues: chkIssues.trim() || null, next_plan: chkNext.trim() || null,
        kpi_snapshot: snapshot, created_by: user?.id || null,
      });
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["project-updates", dealId] });
      qc.invalidateQueries({ queryKey: ["project-updates-latest", dealId] });
      qc.invalidateQueries({ queryKey: ["project-kpi-entries-all", dealId] });
      setChkDid(""); setChkIssues(""); setChkNext(""); setChkStatus("green"); setChkDate(todayStr());
      toast("성과 체크인을 등록했습니다", "success");
    } catch (e: any) { toast(e?.message || "저장 실패", "error"); } finally { setSavingChk(false); }
  };
  const removeCheckin = async (id: string) => {
    if (!confirm("이 체크인을 삭제할까요?")) return;
    try {
      const { error } = await db.from("project_updates").delete().eq("id", id);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["project-updates", dealId] });
      qc.invalidateQueries({ queryKey: ["project-updates-latest", dealId] });
      toast("삭제했습니다", "info");
    } catch (e: any) { toast(e?.message || "삭제 실패", "error"); }
  };

  const amAssigned = !!user?.id && assignedIds.has(user.id);
  const showCheckinPrompt = cadence !== "none" && !mySubmittedThisPeriod && (isManager || amAssigned);

  return (
    <div className="space-y-5">
      {/* 이번 주 체크인 프롬프트 — 배정 멤버/관리자가 이번 주기 미제출 시 */}
      {showCheckinPrompt && (
        <button
          onClick={() => document.getElementById("checkin-form")?.scrollIntoView({ behavior: "smooth", block: "center" })}
          className="w-full flex items-center justify-between gap-3 px-4 py-3 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/30 text-left hover:bg-[var(--primary)]/15 transition"
        >
          <div className="flex items-center gap-3">
            <span className="text-xl">📝</span>
            <div>
              <div className="text-sm font-bold text-[var(--text)]">이번 주기 성과 체크인이 필요합니다</div>
              <div className="text-xs text-[var(--text-muted)]">{periodLabel(curPeriod, cadence)}{curDue && <> · 마감 {curDue}</>} — 30초면 끝나요</div>
            </div>
          </div>
          <span className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-[var(--primary)] text-white whitespace-nowrap">지금 체크인 →</span>
        </button>
      )}

      {/* ⓪ 성과 운영 — 체크인 주기 + 멤버 배정 */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text)]">⓪ 성과 운영 <span className="font-normal text-[var(--text-dim)] text-xs">(체크인 주기 · 멤버 배정)</span></h3>
        <div className="glass-card p-4 grid grid-cols-1 lg:grid-cols-2 gap-5">
          {/* 체크인 주기 */}
          <div>
            <div className="text-xs font-bold text-[var(--text-muted)] mb-2">체크인 주기</div>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <label className={LB}>주기</label>
                <select value={cadence} disabled={!isManager || savingCadence} onChange={(e) => saveCadence({ cadence: e.target.value as Cadence })} className={IN}>
                  <option value="none">안 함</option>
                  <option value="weekly">매주</option>
                  <option value="biweekly">격주</option>
                  <option value="monthly">매월</option>
                </select>
              </div>
              {(cadence === "weekly" || cadence === "biweekly") && (
                <div className="flex-1">
                  <label className={LB}>마감 요일</label>
                  <select value={dueWeekday ?? 5} disabled={!isManager || savingCadence} onChange={(e) => saveCadence({ weekday: Number(e.target.value) })} className={IN}>
                    {WEEKDAY_LABEL.map((w, i) => <option key={i} value={i}>{w}요일</option>)}
                  </select>
                </div>
              )}
            </div>
            {cadence !== "none" && (
              <div className="mt-2 text-[11px] text-[var(--text-dim)]">
                이번 주기: <b className="text-[var(--text-muted)]">{periodLabel(curPeriod, cadence)}</b>
                {curDue && <> · 마감 <b className="text-[var(--text-muted)] mono-number">{curDue}</b></>}
              </div>
            )}
            {!isManager && <div className="mt-1 text-[10px] text-[var(--text-dim)]">주기 설정은 관리자만 변경할 수 있습니다.</div>}
          </div>
          {/* 멤버 배정 */}
          <div>
            <div className="text-xs font-bold text-[var(--text-muted)] mb-2">프로젝트 멤버 <span className="font-normal text-[var(--text-dim)]">({(assignments as any[]).length}명)</span></div>
            {isManager && (
              <div className="flex gap-2 mb-2">
                <select value={addMemberId} onChange={(e) => setAddMemberId(e.target.value)} className={`${IN} flex-1`}>
                  <option value="">+ 멤버 추가…</option>
                  {(members as Member[]).filter((m) => !assignedIds.has(m.id)).map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
                </select>
                <button onClick={addMember} className="px-3 py-2 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 whitespace-nowrap">배정</button>
              </div>
            )}
            <div className="flex flex-wrap gap-1.5">
              {(assignments as any[]).length === 0 ? (
                <span className="text-[11px] text-[var(--text-dim)]">배정된 멤버가 없습니다.</span>
              ) : (assignments as any[]).map((a) => (
                <span key={a.id} className="inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">
                  {memberName(a.user_id)}
                  {isManager && <button onClick={() => removeMember(a.id)} className="text-[var(--text-dim)] hover:text-[var(--danger)]" title="배정 해제">✕</button>}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ① KPI 관리 */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text)]">① KPI 관리</h3>
        <div className="glass-card p-4">
          <div className="text-xs font-bold text-[var(--text-muted)] mb-3">{kpiForm.id ? "KPI 수정" : "+ KPI 추가"}</div>
          <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
            <div className="sm:col-span-2">
              <label className={LB}>KPI 이름 *</label>
              <input value={kpiForm.label} onChange={(e) => setKpiForm((f) => ({ ...f, label: e.target.value }))} placeholder="예: 신규 매출" className={IN} />
            </div>
            <div>
              <label className={LB}>목표값 *</label>
              <input value={kpiForm.target} onChange={(e) => setKpiForm((f) => ({ ...f, target: numComma(e.target.value) }))} inputMode="numeric" placeholder="0" className={`${IN} text-right mono-number`} />
            </div>
            <div>
              <label className={LB}>단위</label>
              <input value={kpiForm.unit} onChange={(e) => setKpiForm((f) => ({ ...f, unit: e.target.value }))} placeholder="원" className={IN} />
            </div>
            <div>
              <label className={LB}>방향</label>
              <select value={kpiForm.direction} onChange={(e) => setKpiForm((f) => ({ ...f, direction: e.target.value as "up" | "down" }))} className={IN}>
                <option value="up">높을수록 좋음</option>
                <option value="down">낮을수록 좋음</option>
              </select>
            </div>
            <div>
              <label className={LB}>실적 출처</label>
              <select value={kpiForm.source} onChange={(e) => setKpiForm((f) => ({ ...f, source: e.target.value as KpiSource }))} className={IN}>
                <option value="manual">수동 입력</option>
                <option value="revenue_auto">매출 자동(세금계산서)</option>
                <option value="profit_auto">이익 자동(매출−원가)</option>
                <option value="count_auto">건수 자동(문서)</option>
              </select>
            </div>
            <div>
              <label className={LB}>책임자 <span className="font-normal text-[var(--text-dim)]">(선택)</span></label>
              <select value={kpiForm.ownerId} onChange={(e) => setKpiForm((f) => ({ ...f, ownerId: e.target.value }))} className={IN}>
                <option value="">미지정</option>
                {(members as Member[]).map((m) => <option key={m.id} value={m.id}>{m.name || m.email}</option>)}
              </select>
            </div>
          </div>
          <div className="flex justify-end gap-2 mt-3">
            {kpiForm.id && <button onClick={resetKpiForm} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>}
            <button onClick={saveKpi} disabled={savingKpi} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
              {savingKpi ? "저장 중..." : kpiForm.id ? "수정" : "추가"}
            </button>
          </div>
        </div>

        {(kpis as Kpi[]).length > 0 && (
          <div className="glass-card overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                  <th className="px-3 py-2.5 text-[12px] font-bold text-left border-b border-[var(--border)]">KPI</th>
                  <th className="px-3 py-2.5 text-[12px] font-bold text-right border-b border-[var(--border)] w-[130px]">목표</th>
                  <th className="px-3 py-2.5 text-[12px] font-bold text-right border-b border-[var(--border)] w-[130px]">실적</th>
                  <th className="px-3 py-2.5 text-[12px] font-bold text-center border-b border-[var(--border)] w-[90px]">달성률</th>
                  <th className="px-3 py-2.5 text-[12px] font-bold text-center border-b border-[var(--border)] w-[110px]">관리</th>
                </tr>
              </thead>
              <tbody>
                {(kpis as Kpi[]).map((k) => {
                  const actual = actualOf(k);
                  const ach = getKpiAchievement(Number(k.target_value || 0), actual, k.direction);
                  const pct = ach == null ? null : Math.round(ach * 100);
                  return (
                    <tr key={k.id} className="hover:bg-[var(--bg-surface)]/50">
                      <td className="px-3 py-2.5 border-b border-[var(--border)]/40">
                        <span className="text-[var(--text)] font-medium">{k.label}</span>
                        <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-dim)]">{k.direction === "down" ? "↓좋음" : "↑좋음"}</span>
                        {k.source !== "manual" && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">{KPI_SOURCE_LABEL[k.source]}</span>}
                        {k.owner_id && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">👤 {memberName(k.owner_id)}</span>}
                      </td>
                      <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-right mono-number text-[var(--text-muted)]">{fmtNum(Number(k.target_value), k.unit)}</td>
                      <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-right mono-number text-[var(--text)]">{fmtNum(actual, k.unit)}</td>
                      <td className={`px-3 py-2.5 border-b border-[var(--border)]/40 text-center mono-number font-semibold ${pct == null ? "text-[var(--text-dim)]" : pct >= 100 ? "text-[var(--primary)]" : pct < 40 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{pct == null ? "—" : `${pct}%`}</td>
                      <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center whitespace-nowrap">
                        <button onClick={() => editKpi(k)} className="px-2 py-1 text-[11px] rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)]">수정</button>
                        <button onClick={() => removeKpi(k)} className="ml-1 px-2 py-1 text-[11px] rounded-md text-[var(--danger)] hover:bg-[var(--danger)]/10">삭제</button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* ② KPI 실적 입력 (수동 KPI) */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text)]">② 실적 입력 <span className="font-normal text-[var(--text-dim)] text-xs">(수동 KPI · 매출 자동은 세금계산서에서 집계)</span></h3>
        {manualKpis.length === 0 ? (
          <div className="glass-card p-6 text-center text-sm text-[var(--text-muted)]">
            수동 입력 KPI가 없습니다. 위에서 실적 출처 <b className="text-[var(--text)]">‘수동 입력’</b> KPI를 추가하면 여기서 실적을 기록할 수 있습니다.
          </div>
        ) : (
          <>
            <div className="glass-card p-4">
              <div className="text-xs font-bold text-[var(--text-muted)] mb-3">{editEntryId ? "실적 수정" : "+ 실적 추가"}</div>
              <div className="grid grid-cols-1 sm:grid-cols-6 gap-3 items-end">
                <div className="sm:col-span-2">
                  <label className={LB}>KPI</label>
                  <select value={entryKpiId || manualKpis[0]?.id || ""} onChange={(e) => setEntryKpiId(e.target.value)} className={IN}>
                    {manualKpis.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LB}>부서 <span className="font-normal text-[var(--text-dim)]">(선택)</span></label>
                  <select value={entryDeptId} onChange={(e) => setEntryDeptId(e.target.value)} className={IN}>
                    <option value="">미지정</option>
                    {(departments as Dept[]).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className={LB}>날짜</label>
                  <DateField value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={`${IN} mono-number`} />
                </div>
                <div>
                  <label className={LB}>실적값</label>
                  <input value={entryValue} onChange={(e) => setEntryValue(numComma(e.target.value))} inputMode="numeric" placeholder="0" className={`${IN} text-right mono-number`} />
                </div>
                <div>
                  <label className={LB}>메모 <span className="font-normal text-[var(--text-dim)]">(선택)</span></label>
                  <input value={entryMemo} onChange={(e) => setEntryMemo(e.target.value)} placeholder="예: 6월 1주차" className={IN} />
                </div>
              </div>
              <div className="flex justify-end gap-2 mt-3">
                {editEntryId && <button onClick={resetEntry} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>}
                <button onClick={saveEntry} disabled={savingEntry} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
                  {savingEntry ? "저장 중..." : editEntryId ? "수정" : "추가"}
                </button>
              </div>
            </div>

            <div className="glass-card overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                    <th className="px-3 py-2.5 text-[12px] font-bold text-left border-b border-[var(--border)] w-[110px]">날짜</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-left border-b border-[var(--border)]">KPI</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-left border-b border-[var(--border)] w-[110px]">부서</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-right border-b border-[var(--border)] w-[140px]">실적값</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-left border-b border-[var(--border)]">메모</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-center border-b border-[var(--border)] w-[110px]">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {(entries as Entry[]).filter((e) => manualKpis.some((k) => k.id === e.kpi_id)).length === 0 ? (
                    <tr><td colSpan={6} className="p-8 text-center text-sm text-[var(--text-muted)]">실적 기록이 없습니다. 위에서 추가하세요.</td></tr>
                  ) : (entries as Entry[]).filter((e) => manualKpis.some((k) => k.id === e.kpi_id)).map((e) => (
                    <tr key={e.id} className="hover:bg-[var(--bg-surface)]/50">
                      <td className="px-3 py-2.5 border-b border-[var(--border)]/40 mono-number text-[var(--text-muted)]">{String(e.entry_date).slice(0, 10)}</td>
                      <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-[var(--text)]">{kpiLabel(e.kpi_id)}</td>
                      <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-[var(--text-muted)]">{deptName(e.department_id)}</td>
                      <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-right mono-number text-[var(--text)]">{fmtNum(e.value, kpiUnit(e.kpi_id))}</td>
                      <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-[var(--text-muted)] truncate">{e.memo || "—"}</td>
                      <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center whitespace-nowrap">
                        <button onClick={() => startEditEntry(e)} className="px-2 py-1 text-[11px] rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)]">수정</button>
                        <button onClick={() => removeEntry(e.id)} className="ml-1 px-2 py-1 text-[11px] rounded-md text-[var(--danger)] hover:bg-[var(--danger)]/10">삭제</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}
      </section>

      {/* ③ 성과 체크인 타임라인 */}
      <section className="space-y-3">
        <h3 className="text-sm font-bold text-[var(--text)]">③ 성과 체크인 <span className="font-normal text-[var(--text-dim)] text-xs">(신호등 + 3문항 · 작성 시점 KPI 달성률 자동 기록)</span></h3>
        <div id="checkin-form" className="glass-card p-4 space-y-3 scroll-mt-24">
          {cadence !== "none" && (
            <div className={`flex items-center justify-between gap-2 px-3 py-2 rounded-lg text-xs ${mySubmittedThisPeriod ? "bg-green-500/10 text-green-600" : "bg-amber-500/10 text-amber-600"}`}>
              <span>이번 주기 <b>{periodLabel(curPeriod, cadence)}</b>{curDue && <> · 마감 {curDue}</>}</span>
              <span className="font-semibold">{mySubmittedThisPeriod ? "✓ 제출 완료" : "미제출"}</span>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={LB}>날짜</label>
              <DateField value={chkDate} onChange={(e) => setChkDate(e.target.value)} className={`${IN} mono-number`} />
            </div>
            <div>
              <label className={LB}>상태(신호등)</label>
              <select value={chkStatus} onChange={(e) => setChkStatus(e.target.value as any)} className={IN}>
                <option value="green">🟢 정상(순항)</option>
                <option value="yellow">🟡 주의</option>
                <option value="red">🔴 위험</option>
              </select>
            </div>
          </div>
          {/* 수동 KPI 빠른 입력 — 지난값 자동채움, 변동분만 실적 기록(carry forward) */}
          {(kpis as Kpi[]).filter((k) => k.source === "manual").length > 0 && (
            <div>
              <label className={LB}>KPI 실적 <span className="font-normal text-[var(--text-dim)]">(지난값 자동채움 · 바뀐 값만 기록)</span></label>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                {(kpis as Kpi[]).filter((k) => k.source === "manual").map((k) => (
                  <div key={k.id} className="flex items-center gap-2">
                    <span className="text-xs text-[var(--text-muted)] truncate flex-1">{k.label}</span>
                    <input value={chkKpiVals[k.id] ?? ""} onChange={(e) => setChkKpiVals((v) => ({ ...v, [k.id]: numComma(e.target.value) }))} inputMode="numeric" placeholder="0" className={`${IN} w-32 text-right mono-number`} />
                    <span className="text-[10px] text-[var(--text-dim)] w-8">{k.unit}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={LB}>✅ 이번 기간 성과</label>
              <textarea value={chkDid} onChange={(e) => setChkDid(e.target.value)} rows={3} placeholder="한 일·달성한 것" className={`${IN} resize-y`} />
            </div>
            <div>
              <label className={LB}>🚧 이슈·막힌 것</label>
              <textarea value={chkIssues} onChange={(e) => setChkIssues(e.target.value)} rows={3} placeholder="리스크·블로커" className={`${IN} resize-y`} />
            </div>
            <div>
              <label className={LB}>➡️ 다음 기간 계획</label>
              <textarea value={chkNext} onChange={(e) => setChkNext(e.target.value)} rows={3} placeholder="다음 액션" className={`${IN} resize-y`} />
            </div>
          </div>
          <div className="flex justify-end">
            <button onClick={saveCheckin} disabled={savingChk} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
              {savingChk ? "등록 중..." : "체크인 등록"}
            </button>
          </div>
        </div>

        {(updates as any[]).length === 0 ? (
          <div className="glass-card p-6 text-center text-sm text-[var(--text-muted)]">성과 체크인이 없습니다. 위에서 첫 체크인을 등록하세요.</div>
        ) : (
          <div className="space-y-2">
            {(updates as any[]).map((u) => {
              const sm = STATUS_META[u.status] || STATUS_META.green;
              const snap = Array.isArray(u.kpi_snapshot) ? u.kpi_snapshot : [];
              return (
                <div key={u.id} className="glass-card p-4">
                  <div className="flex items-center justify-between gap-2 mb-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${sm.dot}`} />
                      <span className={`text-xs font-bold ${sm.text}`}>{sm.label}</span>
                      <span className="text-[11px] text-[var(--text-dim)] mono-number">{String(u.update_date).slice(0, 10)}</span>
                      {u.created_by && <span className="text-[11px] text-[var(--text-muted)]">· {memberName(u.created_by)}</span>}
                      {u.period_start && <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-dim)]">{periodLabel(String(u.period_start).slice(0, 10), cadence)}</span>}
                    </div>
                    <button onClick={() => removeCheckin(u.id)} className="px-2 py-1 text-[11px] rounded-md text-[var(--danger)] hover:bg-[var(--danger)]/10">삭제</button>
                  </div>
                  {(u.did || u.issues || u.next_plan) ? (
                    <div className="space-y-1.5 text-sm">
                      {u.did && <p className="text-[var(--text)] whitespace-pre-wrap break-words"><span className="text-[var(--text-dim)]">✅ </span>{u.did}</p>}
                      {u.issues && <p className="text-[var(--text)] whitespace-pre-wrap break-words"><span className="text-[var(--text-dim)]">🚧 </span>{u.issues}</p>}
                      {u.next_plan && <p className="text-[var(--text)] whitespace-pre-wrap break-words"><span className="text-[var(--text-dim)]">➡️ </span>{u.next_plan}</p>}
                    </div>
                  ) : (
                    <p className="text-sm text-[var(--text)] whitespace-pre-wrap break-words">{u.body || "—"}</p>
                  )}
                  {snap.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {snap.map((s: any, i: number) => (
                        <span key={i} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] mono-number" title={`${fmtNum(Number(s.actual || 0), s.unit || "")} / ${fmtNum(Number(s.target || 0), s.unit || "")}`}>
                          {s.label} {s.achievement_pct == null ? "—" : `${s.achievement_pct}%`}
                        </span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
