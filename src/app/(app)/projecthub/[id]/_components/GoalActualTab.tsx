"use client";

// 목표형 '실적 입력' 탭 — 수동 KPI(project_kpi_entries) CRUD + 누적/추이.
//   goal_source='revenue_auto' 면 자동 집계 안내만(수동 입력 불필요).

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { DateField } from "@/components/date-field";

const db = supabase as any;
const fmtNum = (n: number, unit: string) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}${unit}`;
const todayStr = () => new Date().toISOString().slice(0, 10);

export function GoalActualTab({ dealId, companyId, deal }: { dealId: string; companyId: string; deal: any }) {
  const { user } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const unit = deal.target_unit || "원";
  const target = Number(deal.target_amount || 0);
  const source: "revenue_auto" | "manual" = deal.goal_source === "manual" ? "manual" : "revenue_auto";

  const [entryDate, setEntryDate] = useState(todayStr());
  const [value, setValue] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);

  const { data: entries = [] } = useQuery({
    queryKey: ["goal-kpi-entries", dealId],
    queryFn: async () => {
      const { data } = await db.from("project_kpi_entries").select("id, entry_date, value, memo").eq("deal_id", dealId).order("entry_date", { ascending: false });
      return (data || []) as any[];
    },
    enabled: source === "manual",
  });

  const total = useMemo(() => (entries as any[]).reduce((s, e) => s + Number(e.value || 0), 0), [entries]);
  const numComma = (s: string) => { const n = Number(String(s).replace(/[^0-9.-]/g, "")); return n ? n.toLocaleString("ko-KR") : ""; };

  const reset = () => { setEntryDate(todayStr()); setValue(""); setMemo(""); setEditId(null); };

  const save = async () => {
    const v = Number(String(value).replace(/[^0-9.-]/g, ""));
    if (!v) { toast("실적값을 입력하세요", "error"); return; }
    if (!entryDate) { toast("날짜를 선택하세요", "error"); return; }
    setSaving(true);
    try {
      if (editId) {
        const { error } = await db.from("project_kpi_entries").update({ entry_date: entryDate, value: v, memo: memo.trim() || null }).eq("id", editId);
        if (error) throw new Error(error.message);
        toast("실적을 수정했습니다", "success");
      } else {
        const { error } = await db.from("project_kpi_entries").insert({
          company_id: companyId, deal_id: dealId, entry_date: entryDate, value: v, memo: memo.trim() || null, created_by: user?.id || null,
        });
        if (error) throw new Error(error.message);
        toast("실적을 추가했습니다", "success");
      }
      qc.invalidateQueries({ queryKey: ["goal-kpi-entries", dealId] });
      reset();
    } catch (e: any) { toast(e?.message || "저장 실패", "error"); } finally { setSaving(false); }
  };

  const startEdit = (e: any) => { setEditId(e.id); setEntryDate(String(e.entry_date).slice(0, 10)); setValue(Number(e.value).toLocaleString("ko-KR")); setMemo(e.memo || ""); };
  const remove = async (id: string) => {
    if (!confirm("이 실적 기록을 삭제할까요?")) return;
    try {
      const { error } = await db.from("project_kpi_entries").delete().eq("id", id);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["goal-kpi-entries", dealId] });
      if (editId === id) reset();
      toast("삭제했습니다", "info");
    } catch (e: any) { toast(e?.message || "삭제 실패", "error"); }
  };

  if (source !== "manual") {
    return (
      <div className="glass-card p-8 text-center text-sm text-[var(--text-muted)]">
        이 프로젝트는 <b className="text-[var(--text)]">매출 자동 집계</b> 방식입니다. 실적은 매출 세금계산서에서 자동으로 누적되며, 수동 입력은 필요 없습니다.
        <p className="text-[11px] text-[var(--text-dim)] mt-2">수동 입력으로 전환하려면 프로젝트 수정에서 실적 출처를 ‘수동 KPI’로 변경하세요.</p>
      </div>
    );
  }

  const IN = "w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]";
  const LB = "block text-xs text-[var(--text-muted)] mb-1";
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Metric label="누적 실적" value={fmtNum(total, unit)} accent="primary" />
        <Metric label="목표" value={target > 0 ? fmtNum(target, unit) : "—"} />
        <Metric label="달성률" value={target > 0 ? `${Math.round((total / target) * 100)}%` : "—"} />
      </div>

      <div className="glass-card p-4">
        <div className="text-xs font-bold text-[var(--text-muted)] mb-3">{editId ? "실적 수정" : "+ 실적 추가"}</div>
        <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end">
          <div>
            <label className={LB}>날짜</label>
            <DateField value={entryDate} onChange={(e) => setEntryDate(e.target.value)} className={`${IN} mono-number`} />
          </div>
          <div>
            <label className={LB}>실적값 ({unit})</label>
            <input value={value} onChange={(e) => setValue(numComma(e.target.value))} inputMode="numeric" placeholder="0" className={`${IN} text-right mono-number`} />
          </div>
          <div className="sm:col-span-2">
            <label className={LB}>메모 <span className="font-normal text-[var(--text-dim)]">(선택)</span></label>
            <input value={memo} onChange={(e) => setMemo(e.target.value)} placeholder="예: 6월 1주차" className={IN} />
          </div>
        </div>
        <div className="flex justify-end gap-2 mt-3">
          {editId && <button onClick={reset} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>}
          <button onClick={save} disabled={saving} className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
            {saving ? "저장 중..." : editId ? "수정" : "추가"}
          </button>
        </div>
      </div>

      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm border-collapse">
          <thead>
            <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
              <th className="px-3 py-2.5 text-[12px] font-bold text-left border-b border-[var(--border)] w-[120px]">날짜</th>
              <th className="px-3 py-2.5 text-[12px] font-bold text-right border-b border-[var(--border)] w-[140px]">실적값</th>
              <th className="px-3 py-2.5 text-[12px] font-bold text-left border-b border-[var(--border)]">메모</th>
              <th className="px-3 py-2.5 text-[12px] font-bold text-center border-b border-[var(--border)] w-[110px]">관리</th>
            </tr>
          </thead>
          <tbody>
            {(entries as any[]).length === 0 ? (
              <tr><td colSpan={4} className="p-8 text-center text-sm text-[var(--text-muted)]">실적 기록이 없습니다. 위에서 추가하세요.</td></tr>
            ) : (entries as any[]).map((e) => (
              <tr key={e.id} className="hover:bg-[var(--bg-surface)]/50">
                <td className="px-3 py-2.5 border-b border-[var(--border)]/40 mono-number text-[var(--text-muted)]">{String(e.entry_date).slice(0, 10)}</td>
                <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-right mono-number text-[var(--text)]">{fmtNum(e.value, unit)}</td>
                <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-[var(--text-muted)] truncate">{e.memo || "—"}</td>
                <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center whitespace-nowrap">
                  <button onClick={() => startEdit(e)} className="px-2 py-1 text-[11px] rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)]">수정</button>
                  <button onClick={() => remove(e.id)} className="ml-1 px-2 py-1 text-[11px] rounded-md text-[var(--danger)] hover:bg-[var(--danger)]/10">삭제</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Metric({ label, value, accent }: { label: string; value: string; accent?: "primary" | "danger" }) {
  const color = value === "—" ? "text-[var(--text-dim)]" : accent === "danger" ? "text-[var(--danger)]" : accent === "primary" ? "text-[var(--primary)]" : "text-[var(--text)]";
  return (
    <div className="glass-card px-3 py-2.5">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className={`text-base font-bold mono-number mt-0.5 ${color}`}>{value}</div>
    </div>
  );
}
