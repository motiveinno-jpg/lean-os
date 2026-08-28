"use client";

// 근태 관리 › 근태 현황 (2026-08-19 사장님: '월간 요약'을 근태 현황으로 — 조회기간(여러 달)·사람·부서 다중 지정·지표 조건)
//   조회 줄 = [조회기간(월) · 검색조건 ▾ · 빠른검색] ‖ 모두 펼침/접기 · 엑셀
//   검색조건 = 사람(다중 칩) · 부서(다중) · 이 기간에 …한 사람 · 출근율 이하 · 총 근무 범위
//   표 = 부서 줄(합계·평균) → 직원 줄 → (여러 달이면) 월별 줄. 계산은 getMonthlyAttendanceSummary 를 달마다 불러 합친다(근태관리 표와 같은 규칙).

import { Fragment, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";
import { getMonthlyAttendanceSummary } from "@/lib/hr";
import { downloadCsv } from "@/lib/csv-export";
import { DateRangeField } from "@/components/date-range-field";
import { QueryBar, ConditionPanel, ConditionRow, TokenField, QuickSearch, quickSearchHit, AppliedChips, ResultStrip, Stat, ExcelMenu, type AppliedChip } from "@/components/query-kit";
import { nextSort, type SortState } from "@/components/sortable-th";

type Row = { employee_id: string; name: string; department: string; totalDays: number; lateDays: number; lateMinutesSum: number; overtimeMinutesSum: number; nightMinutesSum: number; holidayMinutesSum: number; absentDays: number; remoteDays: number; halfDays: number; totalHours: number; leaveDays: number; alwTotal: number; ratio: number; months: Record<string, Row | undefined> };
type Cond = { people: string[]; depts: string[]; has: string[]; ratioMax: string; hoursMin: string; hoursMax: string };
const COND0: Cond = { people: [], depts: [], has: [], ratioMax: "", hoursMin: "", hoursMax: "" };
const HAS: [string, string][] = [["leaveDays", "연차 쓴 사람"], ["lateDays", "지각 있음"], ["absentDays", "결근 있음"], ["remoteDays", "재택 있음"], ["halfDays", "반차 있음"], ["overtimeMinutesSum", "연장근무 있음"], ["nightMinutesSum", "야간근무 있음"], ["holidayMinutesSum", "휴일근무 있음"], ["alwTotal", "수당 있음"]];
const NUM_KEYS = ["totalDays", "lateDays", "lateMinutesSum", "overtimeMinutesSum", "nightMinutesSum", "holidayMinutesSum", "absentDays", "remoteDays", "halfDays", "totalHours", "leaveDays", "alwTotal"] as const;

const ymNow = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date()).slice(0, 7);
const shiftYm = (ym: string, n: number) => { const [y, m] = ym.split("-").map(Number); const t = y * 12 + (m - 1) + n; return `${Math.floor(t / 12)}-${String((t % 12) + 1).padStart(2, "0")}`; };
const monthsBetween = (a: string, b: string) => { const out: string[] = []; let c = a; let g = 0; while (c <= b && g++ < 36) { out.push(c); c = shiftYm(c, 1); } return out; };
const lastDayOf = (ym: string) => { const [y, m] = ym.split("-").map(Number); return `${ym}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`; };
const avatarColor = (id: string) => { let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0; const p = ["#6C5CE7", "#0984E3", "#00B894", "#E17055", "#00CEC9", "#A29BFE", "#FF7675", "#55A3FF"]; return p[Math.abs(h) % p.length]; };
const initials = (n: string) => (/[가-힣]/.test(n || "") ? (n || "").slice(-2) : (n || "").slice(0, 2).toUpperCase());
const fmtKRW = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

export function AttendanceStatusTab({ companyId, employees, isAdmin }: { companyId: string; employees: any[]; isAdmin: boolean }) {
  const [fromYm, setFromYm] = useState(ymNow());
  const [toYm, setToYm] = useState(ymNow());
  const months = useMemo(() => monthsBetween(fromYm <= toYm ? fromYm : toYm, fromYm <= toYm ? toYm : fromYm), [fromYm, toYm]);
  const rangeFrom = `${months[0]}-01`, rangeTo = lastDayOf(months[months.length - 1]);
  const todayStr = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());

  const [cond, setCond] = useState<Cond>(COND0);
  const [draft, setDraft] = useState<Cond>(COND0);
  const [panel, setPanel] = useState(false);
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState<string>>({ key: "name", dir: "asc" });
  const [openDept, setOpenDept] = useState<Map<string, boolean>>(new Map());
  const [openEmp, setOpenEmp] = useState<Set<string>>(new Set());

  // ── 자료: 달마다 요약 + 공휴일 + 승인 휴가 + (관리자) 수당 ──
  const { data: monthly = [], isLoading } = useQuery({
    queryKey: ["att-status-summary", companyId, months.join(",")],
    queryFn: async () => Promise.all(months.map(async (m) => ({ month: m, rows: (await getMonthlyAttendanceSummary(companyId, m)) as any[] }))),
    enabled: !!companyId,
  });
  const { data: holidays = [] } = useQuery({
    queryKey: ["att-status-holidays", companyId, rangeFrom, rangeTo],
    queryFn: async () => (logRead("att-status:holidays", await supabase.from("holidays").select("date").eq("company_id", companyId).gte("date", rangeFrom).lte("date", rangeTo)) || []) as any[],
    enabled: !!companyId,
  });
  const { data: leaves = [] } = useQuery({
    queryKey: ["att-status-leaves", companyId, rangeFrom, rangeTo],
    queryFn: async () => (await fetchPaged("att-status:leaves", () => supabase.from("leave_requests").select("employee_id, start_date, end_date").eq("company_id", companyId).eq("status", "approved").lte("start_date", rangeTo).gte("end_date", rangeFrom).order("start_date"), 20000) || []) as any[],
    enabled: !!companyId,
  });
  const { data: allowances = [] } = useQuery({
    queryKey: ["att-status-allowance", companyId, months.join(",")],
    queryFn: async () => (logRead("att-status:alw", await supabase.from("allowance_entries").select("employee_id, amount, payroll_month, allowance_types!inner(is_active)").eq("company_id", companyId).in("payroll_month", months).filter("allowance_types.is_active", "eq", true)) || []) as any[],
    enabled: !!companyId && isAdmin,
  });

  // 근무일 수(기간 안 평일 − 공휴일, 오늘까지) — 출근율 분모
  const workdays = useMemo(() => {
    const hol = new Set(holidays.map((h: any) => String(h.date).slice(0, 10)));
    let n = 0; const end = rangeTo < todayStr ? rangeTo : todayStr;
    for (let d = new Date(rangeFrom + "T00:00:00Z"); d.toISOString().slice(0, 10) <= end; d = new Date(d.getTime() + 86400000)) { const ds = d.toISOString().slice(0, 10); const dow = d.getUTCDay(); if (dow !== 0 && dow !== 6 && !hol.has(ds)) n++; }
    return Math.max(0, n);
  }, [holidays, rangeFrom, rangeTo, todayStr]);
  const workdaysByMonth = useMemo(() => {
    const hol = new Set(holidays.map((h: any) => String(h.date).slice(0, 10)));
    const m: Record<string, number> = {};
    for (const ym of months) { let n = 0; const end = lastDayOf(ym) < todayStr ? lastDayOf(ym) : todayStr; for (let d = new Date(`${ym}-01T00:00:00Z`); d.toISOString().slice(0, 10) <= end; d = new Date(d.getTime() + 86400000)) { const ds = d.toISOString().slice(0, 10); const dow = d.getUTCDay(); if (dow !== 0 && dow !== 6 && !hol.has(ds)) n++; } m[ym] = n; }
    return m;
  }, [holidays, months, todayStr]);

  // 합치기 — 직원별 합계 + 월별
  const rowsAll = useMemo<Row[]>(() => {
    const leaveByEmpMonth = new Map<string, number>();
    for (const lv of leaves) { if (!lv.start_date || !lv.end_date) continue; let d = new Date(String(lv.start_date).slice(0, 10) + "T00:00:00Z"); const end = new Date(String(lv.end_date).slice(0, 10) + "T00:00:00Z"); let g = 0; while (d <= end && g++ < 400) { const ds = d.toISOString().slice(0, 10); if (ds >= rangeFrom && ds <= rangeTo) { const k = `${lv.employee_id}:${ds.slice(0, 7)}`; leaveByEmpMonth.set(k, (leaveByEmpMonth.get(k) || 0) + 1); } d = new Date(d.getTime() + 86400000); } }
    const alwByEmpMonth = new Map<string, number>();
    for (const a of allowances) { const k = `${a.employee_id}:${a.payroll_month}`; alwByEmpMonth.set(k, (alwByEmpMonth.get(k) || 0) + Number(a.amount || 0)); }
    const empInfo = new Map<string, { name: string; department: string }>();
    for (const e of employees) empInfo.set(e.id, { name: e.name || "", department: e.department || "" });
    const map = new Map<string, Row>();
    const blank = (id: string, name: string, dept: string): Row => ({ employee_id: id, name, department: dept || "미배정", totalDays: 0, lateDays: 0, lateMinutesSum: 0, overtimeMinutesSum: 0, nightMinutesSum: 0, holidayMinutesSum: 0, absentDays: 0, remoteDays: 0, halfDays: 0, totalHours: 0, leaveDays: 0, alwTotal: 0, ratio: 0, months: {} });
    for (const { month, rows } of monthly) {
      for (const s of rows) {
        const info = empInfo.get(s.employee_id);
        const cur = map.get(s.employee_id) || blank(s.employee_id, s.name || info?.name || "", s.department || info?.department || "");
        const mrow = blank(s.employee_id, cur.name, cur.department);
        for (const k of NUM_KEYS) { if (k === "leaveDays" || k === "alwTotal") continue; (mrow as any)[k] = Number((s as any)[k] || 0); (cur as any)[k] += Number((s as any)[k] || 0); }
        mrow.leaveDays = leaveByEmpMonth.get(`${s.employee_id}:${month}`) || 0; cur.leaveDays += mrow.leaveDays;
        mrow.alwTotal = alwByEmpMonth.get(`${s.employee_id}:${month}`) || 0; cur.alwTotal += mrow.alwTotal;
        mrow.ratio = (workdaysByMonth[month] || 0) > 0 ? Math.min(1, mrow.totalDays / workdaysByMonth[month]) : 0;
        cur.months[month] = mrow;
        map.set(s.employee_id, cur);
      }
    }
    //   기록이 없는 재직자도 줄로(0) — "왜 안 보이지"를 막는다. 휴가·수당만 있는 사람도 잡힌다
    for (const e of employees) { if (["invited", "inactive", "resigned"].includes(e.status)) continue; if (!map.has(e.id)) map.set(e.id, blank(e.id, e.name || "", e.department || "")); }
    for (const r of map.values()) { for (const m of months) { const k = `${r.employee_id}:${m}`; if (!r.months[m] && (leaveByEmpMonth.get(k) || alwByEmpMonth.get(k))) { const mr = blank(r.employee_id, r.name, r.department); mr.leaveDays = leaveByEmpMonth.get(k) || 0; mr.alwTotal = alwByEmpMonth.get(k) || 0; r.months[m] = mr; r.leaveDays += mr.leaveDays; r.alwTotal += mr.alwTotal; } } r.ratio = workdays > 0 ? Math.min(1, r.totalDays / workdays) : 0; }
    return [...map.values()];
  }, [monthly, leaves, allowances, employees, months, workdays, workdaysByMonth, rangeFrom, rangeTo]);

  // ── 거르기·정렬 ──
  const rows = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    return rowsAll.filter((r) => quickSearchHit(q, [r.name, r.department])
      && (cond.people.length === 0 || cond.people.includes(r.employee_id))
      && (cond.depts.length === 0 || cond.depts.includes(r.department))
      && cond.has.every((k) => Number((r as any)[k] || 0) > 0)
      && (!cond.ratioMax || r.ratio * 100 <= Number(cond.ratioMax))
      && (!cond.hoursMin || r.totalHours >= Number(cond.hoursMin))
      && (!cond.hoursMax || r.totalHours <= Number(cond.hoursMax)))
      .sort((a, b) => { const k = sort.key; const av = (a as any)[k], bv = (b as any)[k]; const c = typeof av === "number" ? av - bv : String(av || "").localeCompare(String(bv || "")); return c * dir; });
  }, [rowsAll, q, cond, sort]);
  const deptRows = useMemo(() => {
    const m = new Map<string, Row[]>();
    for (const r of rows) { if (!m.has(r.department)) m.set(r.department, []); m.get(r.department)!.push(r); }
    const dir = sort.dir === "asc" ? 1 : -1;
    return [...m.entries()].map(([department, list]) => {
      const sum = (k: keyof Row) => list.reduce((x, r) => x + Number(r[k] || 0), 0);
      return { department, list, n: list.length, totalDays: sum("totalDays") / list.length, ratio: sum("ratio") / list.length, lateDays: sum("lateDays"), absentDays: sum("absentDays"), remoteDays: sum("remoteDays"), halfDays: sum("halfDays"), leaveDays: sum("leaveDays"), overtimeMinutesSum: sum("overtimeMinutesSum"), nightMinutesSum: sum("nightMinutesSum"), holidayMinutesSum: sum("holidayMinutesSum"), totalHours: sum("totalHours"), alwTotal: sum("alwTotal") };
    }).sort((a, b) => { const k = sort.key; if (k === "name") return a.department.localeCompare(b.department) * dir; return (((a as any)[k] ?? 0) - ((b as any)[k] ?? 0)) * dir; });
  }, [rows, sort]);
  const autoOpen = rowsAll.length <= 15;
  const isOpen = (d: string) => (openDept.has(d) ? !!openDept.get(d) : autoOpen);

  const allDepts = useMemo(() => [...new Set(rowsAll.map((r) => r.department))].sort(), [rowsAll]);
  const peopleItems = useMemo(() => employees.filter((e) => !["invited", "inactive", "resigned"].includes(e.status)).map((e) => ({ value: e.id, label: e.name || "(이름 없음)", sub: [e.department, e.position].filter(Boolean).join(" · ") })), [employees]);
  const chips: AppliedChip[] = [
    ...(cond.people.length ? [{ group: "사람", label: cond.people.map((id) => peopleItems.find((p) => p.value === id)?.label || id).join(" · "), onRemove: () => setCond((c) => ({ ...c, people: [] })) }] : []),
    ...(cond.depts.length ? [{ group: "부서", label: cond.depts.join(" · "), onRemove: () => setCond((c) => ({ ...c, depts: [] })) }] : []),
    ...(cond.has.length ? [{ group: "이 기간에", label: cond.has.map((k) => HAS.find((h) => h[0] === k)?.[1] || k).join(" · "), onRemove: () => setCond((c) => ({ ...c, has: [] })) }] : []),
    ...(cond.ratioMax ? [{ group: "출근율", label: `${cond.ratioMax}% 이하`, onRemove: () => setCond((c) => ({ ...c, ratioMax: "" })) }] : []),
    ...(cond.hoursMin || cond.hoursMax ? [{ group: "총 근무", label: `${cond.hoursMin || "0"}~${cond.hoursMax || "∞"}h`, onRemove: () => setCond((c) => ({ ...c, hoursMin: "", hoursMax: "" })) }] : []),
    ...(q ? [{ group: "빠른검색", label: q, onRemove: () => setQ("") }] : []),
  ];
  const activeCount = (cond.people.length ? 1 : 0) + (cond.depts.length ? 1 : 0) + (cond.has.length ? 1 : 0) + (cond.ratioMax ? 1 : 0) + (cond.hoursMin || cond.hoursMax ? 1 : 0);
  const th = (label: string, key: string, first = false) => (
    <th className={first ? "text-left" : ""}><button type="button" className="ev-th-btn" onClick={() => setSort((c) => nextSort(c, key, key === "name" ? "asc" : "desc"))}>{label}{sort.key === key ? (sort.dir === "asc" ? " ▲" : " ▼") : ""}</button></th>
  );
  const rangeLabel = months.length === 1 ? months[0].replace("-", "년 ") + "월" : `${months[0].replace("-", ".")}~${months[months.length - 1].replace("-", ".")}`;
  const cols = isAdmin ? 13 : 12;
  const cellSet = (r: any, wd: number, sub = false) => (
    <>
      <td className="text-center mono-number">{sub ? `${r.totalDays}일` : `${Math.round(r.totalDays * 10) / 10}일`}</td>
      <td className="text-center"><span className="att-ratio"><i style={{ width: `${Math.round(r.ratio * 100)}%` }} /></span><small className="ml-1.5 mono-number text-[var(--text-dim)]">{Math.round(r.ratio * 100)}%{wd ? ` /${wd}일` : ""}</small></td>
      <td className={`text-center mono-number ${r.lateDays > 0 ? "text-[var(--warning)] font-bold" : "text-[var(--text-dim)]"}`}>{r.lateDays > 0 ? `${r.lateDays}회` : "—"}</td>
      <td className={`text-center mono-number ${r.absentDays > 0 ? "text-[var(--danger)] font-bold" : "text-[var(--text-dim)]"}`}>{r.absentDays > 0 ? `${r.absentDays}일` : "—"}</td>
      <td className="text-center mono-number text-[var(--text-muted)]">{r.remoteDays > 0 ? `${r.remoteDays}일` : "—"}</td>
      <td className="text-center mono-number text-[var(--text-muted)]">{r.halfDays > 0 ? `${r.halfDays}회` : "—"}</td>
      <td className="text-center mono-number text-[var(--text-muted)]">{r.leaveDays > 0 ? `${r.leaveDays}일` : "—"}</td>
      <td className="text-right mono-number text-[var(--text-muted)]">{Math.round(r.overtimeMinutesSum) > 0 ? Math.round(r.overtimeMinutesSum).toLocaleString() : "—"}</td>
      <td className="text-right mono-number text-[var(--text-muted)]">{Math.round(r.nightMinutesSum) > 0 ? Math.round(r.nightMinutesSum).toLocaleString() : "—"}</td>
      <td className="text-right mono-number text-[var(--text-muted)]">{Math.round(r.holidayMinutesSum) > 0 ? Math.round(r.holidayMinutesSum).toLocaleString() : "—"}</td>
      <td className="text-right mono-number font-bold">{Number(r.totalHours).toFixed(1)}h</td>
      {isAdmin && <td className="text-right mono-number font-bold text-[var(--success)]">{r.alwTotal > 0 ? fmtKRW(r.alwTotal) : "—"}</td>}
    </>
  );
  const excel = [{
    label: `근태 현황 ${rangeLabel} (${rows.length}명)`, count: rows.length,
    onClick: () => downloadCsv(`근태현황_${months[0]}_${months[months.length - 1]}`, ["부서", "직원", "출근일", "출근율(%)", "지각", "결근", "재택", "반차", "연차", "연장(분)", "야간(분)", "휴일(분)", "총근무(h)", ...(isAdmin ? ["수당"] : [])],
      rows.map((r) => [r.department, r.name, r.totalDays, Math.round(r.ratio * 100), r.lateDays, r.absentDays, r.remoteDays, r.halfDays, r.leaveDays, Math.round(r.overtimeMinutesSum), Math.round(r.nightMinutesSum), Math.round(r.holidayMinutesSum), Number(r.totalHours.toFixed(1)), ...(isAdmin ? [Math.round(r.alwTotal)] : [])])),
  }];

  return (
    <div className="att-status">
      <QueryBar right={<>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setOpenDept(new Map(deptRows.map((d) => [d.department, true])))}>모두 펼침</button>
        <button type="button" className="btn-secondary btn-sm" onClick={() => setOpenDept(new Map(deptRows.map((d) => [d.department, false])))}>모두 접기</button>
        <ExcelMenu items={excel} />
      </>}>
        <DateRangeField label="조회기간" unit="month" parts="segments" from={fromYm} to={toYm} onChange={(f, t) => { setFromYm(f); setToYm(t); }} />
        <ConditionPanel open={panel} onOpenChange={(v) => { if (v) setDraft(cond); setPanel(v); }} activeCount={activeCount}
          foot={<>
            <button type="button" className="btn-secondary btn-sm" onClick={() => setDraft(COND0)}>기본으로</button>
            <span className="ml-auto" />
            <button type="button" className="btn-primary btn-sm" onClick={() => { setCond(draft); setPanel(false); }}>조회</button>
          </>}>
          <ConditionRow label="사람" hint="이름 일부를 입력해 여러 명"><TokenField items={peopleItems} value={draft.people} onChange={(v) => setDraft((c) => ({ ...c, people: v }))} placeholder="이름 · 부서" /></ConditionRow>
          <ConditionRow label="부서" hint="여러 개"><span className="qk-quicks">{allDepts.map((d) => <button key={d} type="button" onClick={() => setDraft((c) => ({ ...c, depts: c.depts.includes(d) ? c.depts.filter((x) => x !== d) : [...c.depts, d] }))} className={draft.depts.includes(d) ? "qk-quick qk-quick-on" : "qk-quick"}>{d}</button>)}</span></ConditionRow>
          <ConditionRow label="이 기간에" hint="고른 것 모두 해당하는 사람만"><span className="qk-quicks">{HAS.map(([k, l]) => <button key={k} type="button" onClick={() => setDraft((c) => ({ ...c, has: c.has.includes(k) ? c.has.filter((x) => x !== k) : [...c.has, k] }))} className={draft.has.includes(k) ? "qk-quick qk-quick-on" : "qk-quick"}>{l}</button>)}</span></ConditionRow>
          <ConditionRow label="출근율" hint="이하 %"><input className="qk-input h-8 w-28 px-2 text-xs" inputMode="numeric" placeholder="예: 80" value={draft.ratioMax} onChange={(e) => setDraft((c) => ({ ...c, ratioMax: e.target.value.replace(/[^0-9]/g, "") }))} /></ConditionRow>
          <ConditionRow label="총 근무" hint="시간 범위"><span className="inline-flex items-center gap-1.5"><input className="qk-input h-8 w-24 px-2 text-xs" inputMode="numeric" placeholder="이상" value={draft.hoursMin} onChange={(e) => setDraft((c) => ({ ...c, hoursMin: e.target.value.replace(/[^0-9.]/g, "") }))} /><span className="text-[var(--text-dim)]">~</span><input className="qk-input h-8 w-24 px-2 text-xs" inputMode="numeric" placeholder="이하" value={draft.hoursMax} onChange={(e) => setDraft((c) => ({ ...c, hoursMax: e.target.value.replace(/[^0-9.]/g, "") }))} /><span className="text-[11px] text-[var(--text-dim)]">h</span></span></ConditionRow>
        </ConditionPanel>
        <QuickSearch value={q} onApply={setQ} placeholder="이름 · 부서 — 쉼표로 여러 개, Enter" />
      </QueryBar>
      <AppliedChips chips={chips} onClearAll={() => { setCond(COND0); setQ(""); }} />
      <ResultStrip>
        <Stat label="기간" value={rangeLabel} />
        <Stat label="근무일" value={`${workdays}일`} />
        <Stat label="부서 · 인원" value={`${deptRows.length}개 · ${rows.length}명`} />
        <Stat label="지각" value={`${rows.reduce((s, r) => s + r.lateDays, 0)}회`} />
        <Stat label="결근" value={`${rows.reduce((s, r) => s + r.absentDays, 0)}일`} tone={rows.reduce((s, r) => s + r.absentDays, 0) > 0 ? "minus" : undefined} />
        <Stat label="연차" value={`${rows.reduce((s, r) => s + r.leaveDays, 0)}일`} />
        <Stat label="총 근무" value={`${rows.reduce((s, r) => s + r.totalHours, 0).toFixed(1)}h`} />
        {months.length > 1 && <span className="text-[10.5px] text-[var(--text-dim)]">직원 줄을 누르면 달마다 펼쳐집니다</span>}
      </ResultStrip>

      <div className="ev-scroll att-summary-scroll att-status-scroll">
        {isLoading ? <div className="collect-empty">불러오는 중…</div> : (
          <table className="ev-table ev-lined att-summary-table">
            <thead><tr>{th("부서 · 직원", "name", true)}{th("출근일", "totalDays")}<th>출근율</th>{th("지각", "lateDays")}{th("결근", "absentDays")}{th("재택", "remoteDays")}{th("반차", "halfDays")}{th("연차", "leaveDays")}{th("연장(분)", "overtimeMinutesSum")}{th("야간(분)", "nightMinutesSum")}{th("휴일(분)", "holidayMinutesSum")}{th("총 근무", "totalHours")}{isAdmin && th("수당", "alwTotal")}</tr></thead>
            <tbody>
              {rows.length === 0 ? <tr><td colSpan={cols} className="text-center text-[var(--text-dim)] py-6">{q || activeCount ? "조건에 맞는 사람이 없습니다" : "이 기간 근태 기록이 없습니다"}</td></tr> : deptRows.map((d) => {
                const open = isOpen(d.department);
                return (
                  <Fragment key={d.department}>
                    <tr className="att-dept-row" onClick={() => setOpenDept((m) => { const n = new Map(m); n.set(d.department, !open); return n; })}>
                      <td className="text-left"><span className={`bs-caret ${open ? "rotate-90" : ""}`}>▸</span><b>{d.department}</b> <em className="bs-cnt">{d.n}</em></td>
                      {cellSet({ ...d, totalDays: Math.round(d.totalDays * 10) / 10 }, 0)}
                    </tr>
                    {open && d.list.map((r) => {
                      const eo = openEmp.has(r.employee_id);
                      return (
                        <Fragment key={r.employee_id}>
                          <tr className={`pnl-row-acct att-emp-row ${months.length > 1 ? "cursor-pointer" : ""}`} onClick={() => { if (months.length > 1) setOpenEmp((s) => { const n = new Set(s); if (n.has(r.employee_id)) n.delete(r.employee_id); else n.add(r.employee_id); return n; }); }}>
                            <td className="text-left pl-8"><span className="inline-flex items-center gap-2">{months.length > 1 && <span className={`bs-caret ${eo ? "rotate-90" : ""}`}>▸</span>}<span className="inline-flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold text-white" style={{ background: avatarColor(r.employee_id) }}>{initials(r.name)}</span>{r.name}</span></td>
                            {cellSet(r, workdays, true)}
                          </tr>
                          {eo && months.map((m) => { const mr = r.months[m]; return (
                            <tr key={m} className="att-month-row">
                              <td className="text-left pl-16 text-[var(--text-muted)] mono-number">{m.replace("-", ".")}</td>
                              {mr ? cellSet(mr, workdaysByMonth[m] || 0, true) : <td colSpan={cols - 1} className="text-center text-[var(--text-dim)]">기록 없음</td>}
                            </tr>
                          ); })}
                        </Fragment>
                      );
                    })}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
