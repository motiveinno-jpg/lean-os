"use client";

// 목표형 '성과' 탭 — 성과관리 모델.
//   ① KPI 관리(project_kpis): 추가/수정/삭제 (label·unit·target_value·direction·source)
//   ② 각 KPI 실적: revenue_auto = v_deal_revenue_actual 자동 / manual = project_kpi_entries(kpi_id) 입력·목록
//   ③ 성과 체크인 타임라인(project_updates): 신호등 status + body + 작성 시점 KPI 달성률 스냅샷(kpi_snapshot) 자동 캡처

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { DateField } from "@/components/date-field";
import { getKpiAchievement } from "@/lib/project-types";

const db = supabase as any;
const fmtNum = (n: number, unit: string) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}${unit}`;
const todayStr = () => new Date().toISOString().slice(0, 10);
const numComma = (s: string) => { const n = Number(String(s).replace(/[^0-9.-]/g, "")); return n ? n.toLocaleString("ko-KR") : ""; };

type Kpi = { id: string; label: string; unit: string; target_value: number; direction: "up" | "down"; source: "manual" | "revenue_auto"; sort_order: number };
type Entry = { id: string; kpi_id: string; entry_date: string; value: number; memo: string | null };

const IN = "w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]";
const LB = "block text-xs text-[var(--text-muted)] mb-1";

const STATUS_META: Record<string, { dot: string; text: string; label: string }> = {
  green: { dot: "bg-green-500", text: "text-green-500", label: "정상" },
  yellow: { dot: "bg-amber-500", text: "text-amber-500", label: "주의" },
  red: { dot: "bg-red-500", text: "text-red-500", label: "위험" },
};

export function PerformanceTab({ dealId, companyId, deal }: { dealId: string; companyId: string; deal: any }) {
  const { user } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: kpis = [] } = useQuery({
    queryKey: ["project-kpis", dealId],
    queryFn: async () => {
      const { data } = await db.from("project_kpis").select("id, label, unit, target_value, direction, source, sort_order").eq("deal_id", dealId).order("sort_order", { ascending: true });
      return (data || []) as Kpi[];
    },
    enabled: !!dealId,
  });
  const { data: entries = [] } = useQuery({
    queryKey: ["project-kpi-entries-all", dealId],
    queryFn: async () => {
      const { data } = await db.from("project_kpi_entries").select("id, kpi_id, entry_date, value, memo").eq("deal_id", dealId).order("entry_date", { ascending: false });
      return (data || []) as Entry[];
    },
    enabled: !!dealId,
  });
  const hasAuto = (kpis as Kpi[]).some((k) => k.source === "revenue_auto");
  const { data: revenueActual } = useQuery({
    queryKey: ["deal-revenue-actual", dealId],
    queryFn: async () => {
      const { data } = await db.from("v_deal_revenue_actual").select("actual_amount").eq("deal_id", dealId).maybeSingle();
      return Number(data?.actual_amount || 0);
    },
    enabled: !!dealId && hasAuto,
  });
  const { data: updates = [] } = useQuery({
    queryKey: ["project-updates", dealId],
    queryFn: async () => {
      const { data } = await db.from("project_updates").select("id, update_date, status, body, kpi_snapshot, created_at").eq("deal_id", dealId).order("update_date", { ascending: false }).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!dealId,
  });

  const actualByKpi = useMemo(() => {
    const m: Record<string, number> = {};
    for (const e of entries as Entry[]) m[e.kpi_id] = (m[e.kpi_id] || 0) + Number(e.value || 0);
    return m;
  }, [entries]);
  const actualOf = (k: Kpi) => (k.source === "revenue_auto" ? Number(revenueActual || 0) : Number(actualByKpi[k.id] || 0));

  // ── KPI 관리 폼 ──
  const [kpiForm, setKpiForm] = useState<{ id: string | null; label: string; unit: string; target: string; direction: "up" | "down"; source: "manual" | "revenue_auto" }>(
    { id: null, label: "", unit: "원", target: "", direction: "up", source: "manual" }
  );
  const [savingKpi, setSavingKpi] = useState(false);
  const resetKpiForm = () => setKpiForm({ id: null, label: "", unit: "원", target: "", direction: "up", source: "manual" });

  const saveKpi = async () => {
    const label = kpiForm.label.trim();
    if (!label) { toast("KPI 이름을 입력하세요", "error"); return; }
    const target = Number(String(kpiForm.target).replace(/[^0-9.-]/g, "")) || 0;
    if (target <= 0) { toast("목표값을 입력하세요", "error"); return; }
    setSavingKpi(true);
    try {
      const payload = { label, unit: kpiForm.unit.trim() || "원", target_value: target, direction: kpiForm.direction, source: kpiForm.source };
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
  const editKpi = (k: Kpi) => setKpiForm({ id: k.id, label: k.label, unit: k.unit || "원", target: Number(k.target_value).toLocaleString("ko-KR"), direction: k.direction, source: k.source });
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
  const [editEntryId, setEditEntryId] = useState<string | null>(null);
  const [savingEntry, setSavingEntry] = useState(false);
  const manualKpis = (kpis as Kpi[]).filter((k) => k.source === "manual");
  const resetEntry = () => { setEntryDate(todayStr()); setEntryValue(""); setEntryMemo(""); setEditEntryId(null); };
  const saveEntry = async () => {
    const kpiId = entryKpiId || manualKpis[0]?.id;
    if (!kpiId) { toast("실적을 입력할 수동 KPI를 선택하세요", "error"); return; }
    const v = Number(String(entryValue).replace(/[^0-9.-]/g, ""));
    if (!v) { toast("실적값을 입력하세요", "error"); return; }
    if (!entryDate) { toast("날짜를 선택하세요", "error"); return; }
    setSavingEntry(true);
    try {
      if (editEntryId) {
        const { error } = await db.from("project_kpi_entries").update({ kpi_id: kpiId, entry_date: entryDate, value: v, memo: entryMemo.trim() || null }).eq("id", editEntryId);
        if (error) throw new Error(error.message);
        toast("실적을 수정했습니다", "success");
      } else {
        const { error } = await db.from("project_kpi_entries").insert({ company_id: companyId, deal_id: dealId, kpi_id: kpiId, entry_date: entryDate, value: v, memo: entryMemo.trim() || null, created_by: user?.id || null });
        if (error) throw new Error(error.message);
        toast("실적을 추가했습니다", "success");
      }
      qc.invalidateQueries({ queryKey: ["project-kpi-entries-all", dealId] });
      resetEntry();
    } catch (e: any) { toast(e?.message || "저장 실패", "error"); } finally { setSavingEntry(false); }
  };
  const startEditEntry = (e: Entry) => { setEditEntryId(e.id); setEntryKpiId(e.kpi_id); setEntryDate(String(e.entry_date).slice(0, 10)); setEntryValue(Number(e.value).toLocaleString("ko-KR")); setEntryMemo(e.memo || ""); };
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

  // ── 성과 체크인 ──
  const [chkStatus, setChkStatus] = useState<"green" | "yellow" | "red">("green");
  const [chkBody, setChkBody] = useState("");
  const [chkDate, setChkDate] = useState(todayStr());
  const [savingChk, setSavingChk] = useState(false);
  const saveCheckin = async () => {
    if (!chkBody.trim()) { toast("코멘트를 입력하세요", "error"); return; }
    setSavingChk(true);
    try {
      // 작성 시점 KPI 달성률 스냅샷 자동 캡처
      const snapshot = (kpis as Kpi[]).map((k) => {
        const actual = actualOf(k);
        const ach = getKpiAchievement(Number(k.target_value || 0), actual, k.direction);
        return { kpi_id: k.id, label: k.label, unit: k.unit, target: Number(k.target_value || 0), actual, achievement_pct: ach == null ? null : Math.round(ach * 100) };
      });
      const { error } = await db.from("project_updates").insert({
        company_id: companyId, deal_id: dealId, update_date: chkDate, status: chkStatus, body: chkBody.trim(), kpi_snapshot: snapshot, created_by: user?.id || null,
      });
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["project-updates", dealId] });
      qc.invalidateQueries({ queryKey: ["project-updates-latest", dealId] });
      setChkBody(""); setChkStatus("green"); setChkDate(todayStr());
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

  return (
    <div className="space-y-5">
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
              <select value={kpiForm.source} onChange={(e) => setKpiForm((f) => ({ ...f, source: e.target.value as "manual" | "revenue_auto" }))} className={IN}>
                <option value="manual">수동 입력</option>
                <option value="revenue_auto">매출 자동</option>
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
                        {k.source === "revenue_auto" && <span className="ml-1 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">매출자동</span>}
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
              <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
                <div className="sm:col-span-2">
                  <label className={LB}>KPI</label>
                  <select value={entryKpiId || manualKpis[0]?.id || ""} onChange={(e) => setEntryKpiId(e.target.value)} className={IN}>
                    {manualKpis.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
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
                    <th className="px-3 py-2.5 text-[12px] font-bold text-right border-b border-[var(--border)] w-[140px]">실적값</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-left border-b border-[var(--border)]">메모</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-center border-b border-[var(--border)] w-[110px]">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {(entries as Entry[]).filter((e) => manualKpis.some((k) => k.id === e.kpi_id)).length === 0 ? (
                    <tr><td colSpan={5} className="p-8 text-center text-sm text-[var(--text-muted)]">실적 기록이 없습니다. 위에서 추가하세요.</td></tr>
                  ) : (entries as Entry[]).filter((e) => manualKpis.some((k) => k.id === e.kpi_id)).map((e) => (
                    <tr key={e.id} className="hover:bg-[var(--bg-surface)]/50">
                      <td className="px-3 py-2.5 border-b border-[var(--border)]/40 mono-number text-[var(--text-muted)]">{String(e.entry_date).slice(0, 10)}</td>
                      <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-[var(--text)]">{kpiLabel(e.kpi_id)}</td>
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
        <h3 className="text-sm font-bold text-[var(--text)]">③ 성과 체크인 <span className="font-normal text-[var(--text-dim)] text-xs">(신호등 + 코멘트 · 작성 시점 KPI 달성률 자동 기록)</span></h3>
        <div className="glass-card p-4 space-y-3">
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
          <div>
            <label className={LB}>코멘트 *</label>
            <textarea value={chkBody} onChange={(e) => setChkBody(e.target.value)} rows={3} placeholder="이번 주 진행 상황·이슈·다음 액션을 적어주세요" className={`${IN} resize-y`} />
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
                    <div className="flex items-center gap-2">
                      <span className={`inline-block w-2.5 h-2.5 rounded-full ${sm.dot}`} />
                      <span className={`text-xs font-bold ${sm.text}`}>{sm.label}</span>
                      <span className="text-[11px] text-[var(--text-dim)] mono-number">{String(u.update_date).slice(0, 10)}</span>
                    </div>
                    <button onClick={() => removeCheckin(u.id)} className="px-2 py-1 text-[11px] rounded-md text-[var(--danger)] hover:bg-[var(--danger)]/10">삭제</button>
                  </div>
                  <p className="text-sm text-[var(--text)] whitespace-pre-wrap break-words">{u.body || "—"}</p>
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
