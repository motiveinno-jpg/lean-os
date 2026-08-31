"use client";
import { comparePeople, compareByName } from "@/lib/people-sort";
import { logRead } from "@/lib/log-read";

// 플렉스(flex.team) 스타일 주간 워크보드 (2026-06-12).
//   주차 네비 + 구성원별 주간 근무시간 게이지(52시간제) + 일별 출퇴근 타임라인 바 + 휴가 표시.
//   읽기 전용 — 출퇴근 기록/연차 데이터는 기존 attendance_records / leave_requests 그대로 사용.
//   기존 AttendanceTab(기록 상세·수정)은 보존 — 이 보드는 그 위의 조망 레이어.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat } from "@/components/query-kit";
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";

const db = supabase;

// 라운드6: 시그니처 색 = 오너뷰 인디고 토큰 (라이트/다크 자동 대응)
const FLEX = {
  violet: "var(--primary)", green: "var(--success)", amber: "var(--warning)", red: "var(--danger)", blue: "var(--info)",
  violetDim: "var(--primary-light)", greenDim: "var(--success-dim)", amberDim: "var(--warning-dim)", redDim: "var(--danger-dim)",
};

type Emp = { id: string; name: string; department?: string | null; position?: string | null; status?: string | null; user_id?: string | null; hire_date?: string | null };
type Att = {
  employee_id: string; date: string; check_in: string | null; check_out: string | null;
  regular_minutes: number | null; overtime_minutes: number | null; night_minutes: number | null;
  work_hours: number | null; is_late: boolean | null; status: string | null; auto_clocked_out?: boolean;
};

const DAY_LABEL = ["월", "화", "수", "목", "금", "토", "일"];
const LIMIT_MIN = 52 * 60; // 주 52시간제
const STD_MIN = 40 * 60;

function kstToday(): Date {
  const k = new Date(Date.now() + 9 * 3600 * 1000);
  return new Date(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
}
function mondayOf(d: Date): Date {
  const x = new Date(d);
  const day = (x.getDay() + 6) % 7; // 월=0
  x.setDate(x.getDate() - day);
  return x;
}
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function addDays(d: Date, n: number): Date { const x = new Date(d); x.setDate(x.getDate() + n); return x; }

function hm(min: number): string {
  const h = Math.floor(min / 60), m = Math.round(min % 60);
  return m ? `${h}h ${m}m` : `${h}h`;
}
// "HH:MM" — check_in/out 은 timestamptz 또는 'HH:MM' 형 모두 방어
function timeOf(v: string | null): string | null {
  if (!v) return null;
  if (/^\d{2}:\d{2}/.test(v)) return v.slice(0, 5);
  const d = new Date(v);
  if (isNaN(d.getTime())) return null;
  const k = new Date(d.getTime() + 9 * 3600 * 1000);
  return `${String(k.getUTCHours()).padStart(2, "0")}:${String(k.getUTCMinutes()).padStart(2, "0")}`;
}
function minutesOf(a: Att): number {
  const reg = Number(a.regular_minutes || 0) + Number(a.overtime_minutes || 0);
  if (reg > 0) return reg;
  if (a.work_hours) return Math.round(Number(a.work_hours) * 60);
  const ci = timeOf(a.check_in), co = timeOf(a.check_out);
  if (ci && co) {
    const [h1, m1] = ci.split(":").map(Number), [h2, m2] = co.split(":").map(Number);
    return Math.max(0, h2 * 60 + m2 - (h1 * 60 + m1));
  }
  return 0;
}

function avatarColor(id: string): string {
  let h = 0; for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  const palette = [FLEX.violet, FLEX.blue, FLEX.green, "#E17055", "#00CEC9", "#A29BFE", "#FF7675", "#55A3FF"];
  return palette[Math.abs(h) % palette.length];
}
const initials = (name: string) => (/[가-힣]/.test(name) ? name.slice(-2) : name.slice(0, 2).toUpperCase());

export function FlexWorkBoard({ companyId, employees, role, userId, tabs, headRight }: {
  companyId: string; employees: Emp[]; role: string; userId: string | null;
  /** 상자 맨 위 갈래 탭(워크보드·기록 상세·연장근무) — 부모 화면이 그린다 (2026-08-18 조회 표준) */
  tabs?: ReactNode;
  /** 조회 줄 오른쪽에 붙일 것(재직 인원 등) */
  headRight?: ReactNode;
}) {
  const isEmployee = role === "employee";
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(kstToday()));
  //   구성원 정렬 (2026-08-25 사장님) — 가나다순(기본)·근무시간순·팀별
  const [sortMode, setSortMode] = useState<"hours" | "name" | "team">("name");
  const weekEnd = addDays(weekStart, 6);
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const startStr = ymd(weekStart), endStr = ymd(weekEnd);
  const todayStr = ymd(kstToday());

  // 표시 대상: 재직 구성원 (직원 본인 모드는 본인만)
  const targets = useMemo(() => {
    const active = employees.filter((e) => !["invited", "inactive", "resigned"].includes(String(e.status || "")));
    return isEmployee ? active.filter((e) => e.user_id === userId) : active;
  }, [employees, isEmployee, userId]);

  const { data: atts = [] } = useQuery<Att[]>({
    queryKey: ["flex-work-week", companyId, startStr],
    queryFn: async () => {
      const data = await fetchPaged<Att>('flex-work-board:att', () => db.from("attendance_records")
        .select("employee_id, date, check_in, check_out, regular_minutes, overtime_minutes, night_minutes, work_hours, is_late, status, auto_clocked_out")
        .eq("company_id", companyId).gte("date", startStr).lte("date", endStr).order("date"), 20000);
      return (data || []) as Att[];
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });

  // 승인 휴가 (주간과 겹치는 건) — 반차 오전/오후 판정을 위해 단위·시각까지 읽는다 (2026-08-11 사장님)
  const { data: leaves = [] } = useQuery<{ employee_id: string; start_date: string; end_date: string; leave_type: string; leave_unit: string | null; start_time: string | null; end_time: string | null; days: number | null }[]>({
    queryKey: ["flex-work-leaves", companyId, startStr],
    queryFn: async () => {
      const data = await fetchPaged<any>('flex-work-board:leaves', () => db.from("leave_requests")
        .select("employee_id, start_date, end_date, leave_type, leave_unit, start_time, end_time, days")
        .eq("company_id", companyId).eq("status", "approved")
        .lte("start_date", endStr).gte("end_date", startStr).order("start_date"), 20000);
      return (data || []) as any[];
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  // 회사 공휴일 (2026-08-19 사장님: 대체휴일이 전 직원 결근으로 표시) — 결근 판정에서 제외.
  const { data: weekHolidays = [] } = useQuery<{ date: string; name: string | null }[]>({
    queryKey: ["flex-work-holidays", companyId, startStr],
    queryFn: async () => {
      const data = logRead('components/flex-work-board:data', await db.from("holidays")
        .select("date, name").eq("company_id", companyId).gte("date", startStr).lte("date", endStr));
      return (data || []) as any[];
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const holidaySet = useMemo(() => new Set(weekHolidays.map((h) => String(h.date).slice(0, 10))), [weekHolidays]);
  const holidayNameByDate = useMemo(() => {
    const m = new Map<string, string>();
    for (const h of weekHolidays) m.set(String(h.date).slice(0, 10), h.name || "공휴일");
    return m;
  }, [weekHolidays]);

  //   회사 근무시간 — 셀 게이지의 '하루 근무량' 기준 (2026-08-25 사장님: 근무 진행률로 채움).
  const { data: workCfg } = useQuery<{ start: number; end: number; lunch: number }>({
    queryKey: ["flex-work-cfg", companyId],
    queryFn: async () => {
      const { data } = await db.from("company_settings")
        .select("work_start_time, work_end_time, lunch_minutes").eq("company_id", companyId).maybeSingle();
      const hhmm = (v: unknown, def: number) => {
        const m = /^(\d{1,2}):(\d{2})/.exec(String(v || ""));
        return m ? +m[1] * 60 + +m[2] : def;
      };
      return { start: hhmm(data?.work_start_time, 9 * 60), end: hhmm(data?.work_end_time, 18 * 60), lunch: Number(data?.lunch_minutes ?? 60) };
    },
    enabled: !!companyId,
    staleTime: 300_000,
  });
  //   기대 하루 근무 분(점심 제외). 게이지 100% 기준.
  const expectedDayMin = Math.max(60, (workCfg?.end ?? 18 * 60) - (workCfg?.start ?? 9 * 60) - (workCfg?.lunch ?? 60));

  //   현재 시각(KST 분) — 진행 중인 오늘 셀 게이지가 실시간으로 차오르게 1분마다 갱신.
  const [nowMin, setNowMin] = useState(() => { const k = new Date(Date.now() + 9 * 3600 * 1000); return k.getUTCHours() * 60 + k.getUTCMinutes(); });
  useEffect(() => {
    const t = setInterval(() => { const k = new Date(Date.now() + 9 * 3600 * 1000); setNowMin(k.getUTCHours() * 60 + k.getUTCMinutes()); }, 60_000);
    return () => clearInterval(t);
  }, []);

  const attByEmpDate = useMemo(() => {
    const m = new Map<string, Att>();
    for (const a of atts) m.set(`${a.employee_id}|${a.date}`, a);
    return m;
  }, [atts]);
  // 날짜별 휴가 정보 — 종일이면 "휴가", 반차·시간차는 오전(am)/오후(pm)로 갈라 게이지 반쪽만 채운다.
  //   오전/오후 판정은 캘린더와 동일 기준: 시작 시각이 12:00 이전이면 오전 (2026-08-11 사장님).
  //   시각이 없는 구 데이터 반차는 방향 미상(half) — 채움 없이 라벨만.
  //   같은 날 오전+오후 반차가 겹치면 사실상 종일이므로 full 로 승격.
  const leaveByEmpDate = useMemo(() => {
    const m = new Map<string, { kind: "full" | "am" | "pm" | "half"; tip: string; type?: string }>();
    const TYPE_WORD: Record<string, string> = { annual: "연차", sick: "병가", family: "경조", maternity: "출산", paternity: "배우자출산", unpaid: "무급", special: "특별", official: "공가" };
    for (const l of leaves) {
      const unit = String(l.leave_unit || "");
      const partial = unit === "half_day" || unit === "two_hours" || Number(l.days) === 0.5;
      const st = String(l.start_time || "").slice(0, 5);
      const en = String(l.end_time || "").slice(0, 5);
      const kind: "full" | "am" | "pm" | "half" = !partial ? "full" : st ? (Number(st.slice(0, 2)) < 12 ? "am" : "pm") : "half";
      const word = unit === "two_hours" ? "시간차" : "반차";
      const tip = kind === "full" ? "휴가" : `${kind === "am" ? "오전 " : kind === "pm" ? "오후 " : ""}${word}${st && en ? ` ${st}~${en}` : ""}`;
      for (const d of days) {
        const s = ymd(d);
        if (!(l.start_date <= s && s <= l.end_date)) continue;
        const key = `${l.employee_id}|${s}`;
        const prev = m.get(key);
        const type = TYPE_WORD[String(l.leave_type)] || (l.leave_type ? String(l.leave_type) : undefined);
        if (!prev) { m.set(key, { kind, tip, type }); continue; }
        if (prev.kind === "full" || kind === "full") { m.set(key, { kind: "full", tip: "휴가", type }); continue; }
        if (prev.kind !== kind) m.set(key, { kind: "full", tip: "휴가", type }); // 오전+오후 겹침 = 종일
      }
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leaves, startStr]);

  // 구성원별 주간 집계 (근무시간 내림차순)
  const rows = useMemo(() => {
    return targets.map((e) => {
      let total = 0, overtime = 0, lateDays = 0;
      for (const d of days) {
        const key = `${e.id}|${ymd(d)}`;
        const a = attByEmpDate.get(key);
        if (!a) continue;
        total += minutesOf(a);
        overtime += Number(a.overtime_minutes || 0);
        //   오전반차·종일·방향미상 휴가는 아침 지각을 면제한다(오후반차만 아침 출근 의무가 남는다).
        //   classifyLeaveForLate 와 같은 규칙 — 저장된 is_late 가 반차 승인 전 아침 기준으로 잘못
        //   박히는 경우가 있어 표시단에서도 면제해 오전반차가 지각으로 뜨는 것을 막는다 (2026-08-25 사장님).
        const lv = leaveByEmpDate.get(key);
        if (a.is_late && (!lv || lv.kind === "pm")) lateDays += 1;
      }
      return { emp: e, total, overtime, lateDays };
    }).sort((a, b) => {
      if (sortMode === "name") return compareByName(a.emp as any, b.emp as any);   // 가나다순(이름) — 사번 무시 (2026-08-31 사장님)
      if (sortMode === "team") {
        const t = String(a.emp.department || "힣").localeCompare(String(b.emp.department || "힣"), "ko");
        return t !== 0 ? t : comparePeople(a.emp as any, b.emp as any);
      }
      return b.total - a.total; // 근무시간순(기본)
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, attByEmpDate, leaveByEmpDate, startStr, sortMode]);

  // 이번주 결근 집계 — 셀의 결근 배지와 동일 규칙(지난 평일 + 무기록 + 휴가 아님 + 입사 이후).
  //   요약 칩 클릭 시 명단 펼침 (2026-07-30 사장님: 결근자 이름을 클릭으로 확인).
  const [showAbsent, setShowAbsent] = useState(false);
  const absentList = useMemo(() => {
    const m = new Map<string, { name: string; dates: string[] }>();
    const todayS = todayStr;
    for (const { emp } of rows) {
      for (let i = 0; i < 5; i++) {
        const dstr = ymd(days[i]);
        if (dstr >= todayS) continue;
        if (holidaySet.has(dstr)) continue;   // 공휴일 제외 (2026-08-19)
        if (emp.hire_date && dstr < emp.hire_date) continue;
        const key = `${emp.id}|${dstr}`;
        if (leaveByEmpDate.has(key)) continue;
        const a = attByEmpDate.get(key);
        if (a && (a.check_in || minutesOf(a))) continue;
        const cur = m.get(emp.id) || { name: emp.name, dates: [] };
        cur.dates.push(`${days[i].getMonth() + 1}/${days[i].getDate()}`);
        m.set(emp.id, cur);
      }
    }
    return [...m.values()];
  }, [rows, days, attByEmpDate, leaveByEmpDate, todayStr, holidaySet]);
  const absentDayCount = absentList.reduce((s, x) => s + x.dates.length, 0);

  const teamAvg = rows.length ? Math.round(rows.reduce((s, r) => s + r.total, 0) / rows.length) : 0;
  const over52 = rows.filter((r) => r.total > LIMIT_MIN).length;
  const totalOt = rows.reduce((s, r) => s + r.overtime, 0);

  const weekLabel = `${weekStart.getMonth() + 1}.${String(weekStart.getDate()).padStart(2, "0")} ~ ${weekEnd.getMonth() + 1}.${String(weekEnd.getDate()).padStart(2, "0")}`;

  const gaugeColor = (min: number) => (min > LIMIT_MIN ? FLEX.red : min > STD_MIN ? FLEX.amber : FLEX.violet);

  //   셀 게이지 — 하루 근무 진행률(0~1)로 왼→오 채운다 (2026-08-25 사장님).
  //     · 퇴근함(정상 출근·퇴근): 실제 근무분/기대근무분 → 보통 꽉 참
  //     · 근무중(오늘·미퇴근): (지금−출근) 기준으로 1분마다 실시간으로 차오른다(점심 지나면 점심 제외)
  //     · 지난 날: 저장된 근무분 기준
  const lunchMin = workCfg?.lunch ?? 60;
  const cellFill = (a: Att, dstr: string): { frac: number; inProgress: boolean } => {
    const ci = timeOf(a.check_in);
    if (!ci) return { frac: 0, inProgress: false };
    const [h1, m1] = ci.split(":").map(Number);
    const ciMin = h1 * 60 + m1;
    const co = timeOf(a.check_out);
    let worked: number;
    let inProgress = false;
    if (co) {
      worked = minutesOf(a);
    } else if (dstr === todayStr && !a.auto_clocked_out) {
      const gross = Math.max(0, nowMin - ciMin);
      worked = gross - (gross > expectedDayMin / 2 + lunchMin / 2 ? lunchMin : 0); // 점심 지났으면 제외
      inProgress = true;
    } else {
      worked = minutesOf(a);
    }
    return { frac: Math.max(0, Math.min(1, worked / expectedDayMin)), inProgress };
  };

  return (
    <QueryScreen>
      <QueryHead>
        {tabs}
        {/* ── 조회 줄: 주차(기간은 어디서 바꾸든 즉시) ‖ 재직 인원 ── */}
        <QueryBar right={headRight}>
          <span className="qk-quicks fw-week-nav">
            <button type="button" onClick={() => setWeekStart(addDays(weekStart, -7))} className="qk-quick" aria-label="이전 주">◀</button>
            <button type="button" onClick={() => setWeekStart(mondayOf(kstToday()))} className="qk-quick">이번 주</button>
            <button type="button" onClick={() => setWeekStart(addDays(weekStart, 7))} className="qk-quick" aria-label="다음 주">▶</button>
          </span>
          <b className="text-sm text-[var(--text)]">{weekStart.getFullYear()}년 {weekLabel}</b>
          {/* 구성원 정렬 (2026-08-25 사장님) */}
          <label className="flex items-center gap-1 text-[11px] text-[var(--text-muted)]">
            정렬
            <select value={sortMode} onChange={(e) => setSortMode(e.target.value as "hours" | "name" | "team")}
              className="field-input-sm" style={{ width: "auto", minWidth: 92 }}>
              <option value="name">가나다순</option>
              <option value="hours">근무시간순</option>
              <option value="team">팀별</option>
            </select>
          </label>
        </QueryBar>
        {/* 결과 요약 — 목록을 바꾸지 않는 것만. 결근 칩만 명단을 펼친다 */}
        {!isEmployee && (
          <ResultStrip right={
            <button type="button" onClick={() => setShowAbsent((v) => !v)}
              className={showAbsent ? "btn-secondary btn-sm border-[var(--primary)] text-[var(--primary)]" : "btn-secondary btn-sm"}
              title="클릭하면 이번주 결근자 명단이 아래에 표시됩니다">
              결근자 명단 {showAbsent ? "접기 ▴" : "펼치기 ▾"}
            </button>
          }>
            <Stat label="평균" value={hm(teamAvg)} />
            <Stat label="연장 합계" value={hm(totalOt)} />
            <Stat label="52시간 초과" value={`${over52}명`} tone={over52 > 0 ? "minus" : undefined} />
            <Stat label="결근" value={`${absentDayCount}건`} tone={absentDayCount > 0 ? "minus" : undefined} />
          </ResultStrip>
        )}
      </QueryHead>

      <QueryBody>
      <div className="ev-scroll">
      {/* 결근자 명단 — 결근 칩 클릭 시 (2026-07-30 사장님) */}
      {!isEmployee && showAbsent && (
        <div className="fw-absent-panel">
          <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">이번주 결근 — {absentList.length}명 · {absentDayCount}건</div>
          {absentList.length === 0 ? (
            <div className="text-xs text-[var(--text-dim)]">이번주 결근자가 없습니다</div>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {absentList.map((x, i) => (
                <span key={i} className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[var(--danger-dim)] text-xs font-medium text-[var(--danger)]">
                  {x.name}
                  <span className="text-[10px] font-normal opacity-80">({x.dates.join(", ")})</span>
                </span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── 워크보드 — 공용 표 머리단(색·선·고정) ── */}
          <table className="ev-table ev-lined fw-table">
            <thead>
              <tr>
                <th className="fw-th-name">구성원</th>
                {days.map((d, i) => {
                  const isToday = ymd(d) === todayStr;
                  const weekend = i >= 5;
                  return (
                    <th key={i} className={weekend ? "text-[var(--text-dim)]" : undefined}>
                      <span className={isToday ? "inline-flex items-center justify-center px-2 py-0.5 rounded-full text-white" : ""} style={isToday ? { background: FLEX.violet } : undefined}>
                        {DAY_LABEL[i]} {d.getDate()}
                      </span>
                    </th>
                  );
                })}
                <th className="fw-th-total">주간 합계 / 52h</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} className="p-10 text-center text-[var(--text-muted)]">표시할 구성원이 없습니다.</td></tr>
              )}
              {rows.map(({ emp, total, overtime, lateDays }) => (
                <tr key={emp.id} className="flex-work-employee-row">
                  {/* 구성원 */}
                  <td className="fw-td-name px-4 py-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: avatarColor(emp.id) }}>
                        {initials(emp.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-[var(--text)] truncate">{emp.name}{(emp as any).employee_number && <span className="emp-no">#{(emp as any).employee_number}</span>}</span>
                        <span className="block text-[10px] text-[var(--text-dim)] truncate">{[emp.department, emp.position].filter(Boolean).join(" · ") || "—"}</span>
                      </span>
                      {lateDays > 0 && <span className="ml-auto shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-bold">지각 {lateDays}</span>}
                    </div>
                  </td>
                  {/* 일별 타임라인 */}
                  {days.map((d, i) => {
                    const key = `${emp.id}|${ymd(d)}`;
                    const a = attByEmpDate.get(key);
                    const lv = leaveByEmpDate.get(key);
                    const weekend = i >= 5;
                    //   셀 공통 박스 — 테두리로 배경과 구분되게, 글자는 진하게(2줄), 게이지는 바닥 얇은 바 (2026-08-25 사장님).
                    if (lv) {
                      const lci = a ? timeOf(a.check_in) : null;
                      const lco = a ? timeOf(a.check_out) : null;
                      const halfFrac = a && a.check_in ? Math.min(1, cellFill(a, ymd(d)).frac * 2) : 0; // 반나절 만근=1
                      const workColor = a?.is_late && lv.kind === "pm" ? FLEX.amber : FLEX.violet;
                      const label = lv.kind === "am" ? "오전반차" : lv.kind === "pm" ? "오후반차" : "반차";
                      return (
                        <td key={i} className="px-1 py-2 align-middle" title={lv.tip + (lci ? ` · 출근 ${lci}${lco ? `~${lco}` : ""}` : "")}>
                          {lv.kind === "full" ? (
                            <div className="fw-cell fw-cell-box fw-cell-status">
                              <div className="fw-cell-fill" style={{ width: "100%", background: "linear-gradient(90deg, color-mix(in srgb, var(--success) 20%, transparent), color-mix(in srgb, var(--success) 6%, transparent))" }}><span className="fw-cell-fill-edge" style={{ background: "var(--success)" }} /></div>
                              <span className="fw-cell-chip" style={{ background: "color-mix(in srgb, var(--success) 14%, transparent)", color: "var(--success)" }}>휴가</span>
                              <span className="fw-cell-t2">{lv.type || "종일"}</span>
                            </div>
                          ) : (
                            <div className="fw-cell fw-cell-box">
                              {halfFrac > 0 && (
                                <div className="fw-cell-fill" style={{ left: lv.kind === "am" ? "50%" : 0, width: `${halfFrac * 50}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${workColor} 20%, transparent), color-mix(in srgb, ${workColor} 6%, transparent))` }}>
                                  <span className="fw-cell-fill-edge" style={{ background: workColor }} />
                                </div>
                              )}
                              <span className="fw-cell-chip" style={{ background: "color-mix(in srgb, var(--success) 14%, transparent)", color: "var(--success)" }}>{label}</span>
                              {lci
                                ? <span className="fw-cell-t2">{lci}{lco ? `~${lco}` : ""}</span>
                                : <span className="fw-cell-t2" style={{ color: "var(--text-dim)" }}>미출근</span>}
                            </div>
                          )}
                        </td>
                      );
                    }
                    if (!a || (!a.check_in && !minutesOf(a))) {
                      // 결근/공휴일/빈칸 — 지난 평일인데 기록·휴가가 없으면 '결근' (2026-07-30 사장님).
                      const dstr = ymd(d);
                      if (holidaySet.has(dstr)) {
                        return (
                          <td key={i} className="px-1 py-2 text-center align-middle bg-[var(--bg-surface)]/30">
                            <div className="fw-cell fw-cell-box fw-cell-status" title={holidayNameByDate.get(dstr)}>
                              <div className="fw-cell-fill" style={{ width: "100%", background: "linear-gradient(90deg, color-mix(in srgb, var(--info) 18%, transparent), color-mix(in srgb, var(--info) 5%, transparent))" }}><span className="fw-cell-fill-edge" style={{ background: "var(--info)" }} /></div>
                              <span className="fw-cell-chip" style={{ background: "color-mix(in srgb, var(--info) 14%, transparent)", color: "var(--info)" }}>공휴일</span>
                              <span className="fw-cell-t2">{holidayNameByDate.get(dstr) || ""}</span>
                            </div>
                          </td>
                        );
                      }
                      const absent = !weekend && dstr < todayStr && (!emp.hire_date || dstr >= emp.hire_date);
                      return (
                        <td key={i} className={`px-1 py-2 text-center align-middle ${weekend ? "bg-[var(--bg-surface)]/30" : ""}`}>
                          {absent
                            ? <div className="fw-cell fw-cell-box fw-cell-status" title="지난 평일인데 출퇴근 기록·휴가가 없습니다 — 휴가 등록이나 기록 정정으로 맞추세요">
                                <div className="fw-cell-fill" style={{ width: "100%", background: "linear-gradient(90deg, color-mix(in srgb, var(--danger) 18%, transparent), color-mix(in srgb, var(--danger) 5%, transparent))" }}><span className="fw-cell-fill-edge" style={{ background: "var(--danger)" }} /></div>
                                <span className="fw-cell-chip" style={{ background: "color-mix(in srgb, var(--danger) 14%, transparent)", color: "var(--danger)" }}>결근</span>
                                <span className="fw-cell-t2">무기록</span>
                              </div>
                            : <div className="fw-cell text-[var(--text-dim)]">—</div>}
                        </td>
                      );
                    }
                    //   근무 진행률 게이지 — 바닥 바가 왼→오로 채워진다. 퇴근했으면 근무분/기대분(대개 꽉 참),
                    //     근무중(오늘)이면 지금 시각 기준으로 1분마다 실시간으로 차오른다 (2026-08-25 사장님).
                    const { frac, inProgress } = cellFill(a, ymd(d));
                    const ci = timeOf(a.check_in), co = timeOf(a.check_out);
                    const barColor = a.is_late ? FLEX.amber : FLEX.violet;
                    const tip = `${ci ?? "—"} ~ ${co ?? (a.auto_clocked_out ? "자동퇴근" : "근무중")} · ${hm(minutesOf(a))}${a.is_late ? " · 지각" : ""}${Number(a.overtime_minutes || 0) > 0 ? ` · 연장 ${hm(Number(a.overtime_minutes))}` : ""}`;
                    return (
                      <td key={i} className={`px-1 py-2 align-middle ${weekend ? "bg-[var(--bg-surface)]/30" : ""}`} title={tip}>
                        <div className="fw-cell fw-cell-box">
                          {ci && frac > 0 && (
                            <div className="fw-cell-fill" style={{ width: `${Math.max(frac * 100, 5)}%`, background: `linear-gradient(90deg, color-mix(in srgb, ${barColor} 22%, transparent), color-mix(in srgb, ${barColor} 6%, transparent))` }}>
                              <span className="fw-cell-fill-edge" style={{ background: barColor }} />
                            </div>
                          )}
                          <span className="fw-cell-t1">{ci ?? "—"}</span>
                          {co ? <span className="fw-cell-t2">{co}</span>
                            : inProgress ? <span className="fw-cell-live"><span className="fw-cell-live-dot" />근무중</span>
                            : <span className="fw-cell-t2" style={{ color: "var(--text-dim)" }}>—</span>}
                        </div>
                      </td>
                    );
                  })}
                  {/* 주간 합계 + 게이지 */}
                  <td className="px-4 py-2 align-middle">
                    <div className="flex items-center justify-end gap-1.5 text-[12px] font-bold mono-number" style={{ color: gaugeColor(total) }}>
                      {hm(total)}
                      {overtime > 0 && <span className="text-[9px] font-semibold px-1 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]">연장 {hm(overtime)}</span>}
                    </div>
                    <div className="mt-1 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                      <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, (total / LIMIT_MIN) * 100)}%`, background: gaugeColor(total) }} />
                    </div>
                    <div className="mt-0.5 text-[9px] text-[var(--text-dim)] text-right">52h 한도의 {Math.round((total / LIMIT_MIN) * 100)}%</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
      </div>
      </QueryBody>
      <div className="collect-note text-[10px] text-[var(--text-dim)]">
        타임라인 = 출근~퇴근 (07~22시 스케일) · <span className="text-[var(--primary)]">■</span> 정상 <span className="text-[var(--warning)]">■</span> 지각 <span className="text-[var(--success)]">■</span> 휴가(반쪽 채움 = 반차 · 왼쪽 오전/오른쪽 오후) <span className="text-[var(--danger)]">■</span> 결근(지난 평일 무기록) · 합계 = 정규+연장 근무시간 · 주 52시간 초과 시 <span className="text-[var(--danger)]">빨강</span>
      </div>
    </QueryScreen>
  );
}
