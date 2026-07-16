"use client";
import { logRead } from "@/lib/log-read";

// 플렉스(flex.team) 스타일 주간 워크보드 (2026-06-12).
//   주차 네비 + 구성원별 주간 근무시간 게이지(52시간제) + 일별 출퇴근 타임라인 바 + 휴가 표시.
//   읽기 전용 — 출퇴근 기록/연차 데이터는 기존 attendance_records / leave_requests 그대로 사용.
//   기존 AttendanceTab(기록 상세·수정)은 보존 — 이 보드는 그 위의 조망 레이어.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

// 라운드6: 시그니처 색 = 오너뷰 인디고 토큰 (라이트/다크 자동 대응)
const FLEX = {
  violet: "var(--primary)", green: "var(--success)", amber: "var(--warning)", red: "var(--danger)", blue: "var(--info)",
  violetDim: "var(--primary-light)", greenDim: "var(--success-dim)", amberDim: "var(--warning-dim)", redDim: "var(--danger-dim)",
};

type Emp = { id: string; name: string; department?: string | null; position?: string | null; status?: string | null; user_id?: string | null };
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

export function FlexWorkBoard({ companyId, employees, role, userId }: {
  companyId: string; employees: Emp[]; role: string; userId: string | null;
}) {
  const isEmployee = role === "employee";
  const [weekStart, setWeekStart] = useState<Date>(() => mondayOf(kstToday()));
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
      const data = logRead('components/flex-work-board:data', await db.from("attendance_records")
        .select("employee_id, date, check_in, check_out, regular_minutes, overtime_minutes, night_minutes, work_hours, is_late, status, auto_clocked_out")
        .eq("company_id", companyId).gte("date", startStr).lte("date", endStr));
      return (data || []) as Att[];
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });

  // 승인 휴가 (주간과 겹치는 건)
  const { data: leaves = [] } = useQuery<{ employee_id: string; start_date: string; end_date: string; leave_type: string }[]>({
    queryKey: ["flex-work-leaves", companyId, startStr],
    queryFn: async () => {
      const data = logRead('components/flex-work-board:data', await db.from("leave_requests")
        .select("employee_id, start_date, end_date, leave_type")
        .eq("company_id", companyId).eq("status", "approved")
        .lte("start_date", endStr).gte("end_date", startStr));
      return (data || []) as any[];
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const attByEmpDate = useMemo(() => {
    const m = new Map<string, Att>();
    for (const a of atts) m.set(`${a.employee_id}|${a.date}`, a);
    return m;
  }, [atts]);
  const leaveByEmpDate = useMemo(() => {
    const m = new Set<string>();
    for (const l of leaves) {
      for (const d of days) {
        const s = ymd(d);
        if (l.start_date <= s && s <= l.end_date) m.add(`${l.employee_id}|${s}`);
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
        const a = attByEmpDate.get(`${e.id}|${ymd(d)}`);
        if (!a) continue;
        total += minutesOf(a);
        overtime += Number(a.overtime_minutes || 0);
        if (a.is_late) lateDays += 1;
      }
      return { emp: e, total, overtime, lateDays };
    }).sort((a, b) => b.total - a.total);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targets, attByEmpDate, startStr]);

  const teamAvg = rows.length ? Math.round(rows.reduce((s, r) => s + r.total, 0) / rows.length) : 0;
  const over52 = rows.filter((r) => r.total > LIMIT_MIN).length;
  const totalOt = rows.reduce((s, r) => s + r.overtime, 0);

  const weekLabel = `${weekStart.getMonth() + 1}.${String(weekStart.getDate()).padStart(2, "0")} ~ ${weekEnd.getMonth() + 1}.${String(weekEnd.getDate()).padStart(2, "0")}`;

  const gaugeColor = (min: number) => (min > LIMIT_MIN ? FLEX.red : min > STD_MIN ? FLEX.amber : FLEX.violet);

  // 일별 타임라인 바 (07:00~22:00 스케일)
  const SCALE_FROM = 7 * 60, SCALE_TO = 22 * 60;
  const barPos = (a: Att) => {
    const ci = timeOf(a.check_in), co = timeOf(a.check_out);
    if (!ci) return null;
    const [h1, m1] = ci.split(":").map(Number);
    const from = Math.max(SCALE_FROM, Math.min(SCALE_TO, h1 * 60 + m1));
    let to = from + 30;
    if (co) {
      const [h2, m2] = co.split(":").map(Number);
      to = Math.max(from + 10, Math.min(SCALE_TO, h2 * 60 + m2));
    }
    const span = SCALE_TO - SCALE_FROM;
    return { left: ((from - SCALE_FROM) / span) * 100, width: ((to - from) / span) * 100, open: !co };
  };

  return (
    <div className="space-y-4">
      {/* ── 주차 네비 + 요약 칩 ── */}
      <div className="flex-work-week-nav glass-card">
        <div className="flex items-center gap-1">
          <button onClick={() => setWeekStart(addDays(weekStart, -7))} className="w-8 h-8 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)]" aria-label="이전 주">◀</button>
          <button onClick={() => setWeekStart(mondayOf(kstToday()))} className="px-3 h-8 rounded-lg text-xs font-semibold border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]">이번 주</button>
          <button onClick={() => setWeekStart(addDays(weekStart, 7))} className="w-8 h-8 rounded-lg hover:bg-[var(--bg-surface)] text-[var(--text-muted)]" aria-label="다음 주">▶</button>
        </div>
        <div className="text-sm font-bold text-[var(--text)]">{weekStart.getFullYear()}년 {weekLabel}</div>
        {!isEmployee && (
          <div className="ml-auto flex items-center gap-2 flex-wrap text-[11px]">
            <span className="px-2.5 py-1 rounded-full font-semibold bg-[var(--primary-light)] text-[var(--primary)]">평균 {hm(teamAvg)}</span>
            <span className="px-2.5 py-1 rounded-full font-semibold bg-[var(--warning-dim)] text-[var(--warning)]">연장 합계 {hm(totalOt)}</span>
            <span className={`px-2.5 py-1 rounded-full font-semibold`} style={over52 > 0 ? { background: FLEX.redDim, color: FLEX.red } : { background: "var(--bg-surface)", color: "var(--text-dim)" }}>
              52시간 초과 {over52}명
            </span>
          </div>
        )}
      </div>

      {/* ── 워크보드 ── */}
      <div className="flex-work-board-table-card glass-card">
        <div className="overflow-x-auto">
          <table className="w-full text-xs border-collapse min-w-[860px]">
            <thead>
              <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-4 py-2.5 font-semibold min-w-[180px] sticky left-0 z-[6] bg-[var(--bg-card)]">구성원</th>
                {days.map((d, i) => {
                  const isToday = ymd(d) === todayStr;
                  const weekend = i >= 5;
                  return (
                    <th key={i} className={`px-1 py-2.5 font-semibold text-center min-w-[86px] ${weekend ? "text-[var(--text-dim)]" : ""}`}>
                      <span className={isToday ? "inline-flex items-center justify-center px-2 py-0.5 rounded-full text-white" : ""} style={isToday ? { background: FLEX.violet } : undefined}>
                        {DAY_LABEL[i]} {d.getDate()}
                      </span>
                    </th>
                  );
                })}
                <th className="text-right px-4 py-2.5 font-semibold min-w-[170px]">주간 합계 / 52h</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={9} className="p-10 text-center text-[var(--text-muted)]">표시할 구성원이 없습니다.</td></tr>
              )}
              {rows.map(({ emp, total, overtime, lateDays }) => (
                <tr key={emp.id} className="flex-work-employee-row">
                  {/* 구성원 */}
                  <td className="px-4 py-2 sticky left-0 z-[5] bg-[var(--bg-card)]">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="w-8 h-8 rounded-full flex items-center justify-center text-[11px] font-bold text-white shrink-0" style={{ background: avatarColor(emp.id) }}>
                        {initials(emp.name)}
                      </span>
                      <span className="min-w-0">
                        <span className="block text-[13px] font-semibold text-[var(--text)] truncate">{emp.name}</span>
                        <span className="block text-[10px] text-[var(--text-dim)] truncate">{[emp.department, emp.position].filter(Boolean).join(" · ") || "—"}</span>
                      </span>
                      {lateDays > 0 && <span className="ml-auto shrink-0 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/10 text-amber-600 font-bold">지각 {lateDays}</span>}
                    </div>
                  </td>
                  {/* 일별 타임라인 */}
                  {days.map((d, i) => {
                    const key = `${emp.id}|${ymd(d)}`;
                    const a = attByEmpDate.get(key);
                    const onLeave = leaveByEmpDate.has(key);
                    const weekend = i >= 5;
                    if (onLeave) {
                      return (
                        <td key={i} className="px-1 py-2 text-center align-middle">
                          <span className="inline-block w-full py-1.5 rounded-md text-[10px] font-semibold bg-[var(--success-dim)] text-[var(--success)]">휴가</span>
                        </td>
                      );
                    }
                    if (!a || (!a.check_in && !minutesOf(a))) {
                      return <td key={i} className={`px-1 py-2 text-center align-middle ${weekend ? "bg-[var(--bg-surface)]/30" : ""}`}><span className="text-[var(--text-dim)]">—</span></td>;
                    }
                    const pos = barPos(a);
                    const ci = timeOf(a.check_in), co = timeOf(a.check_out);
                    const tip = `${ci ?? "—"} ~ ${co ?? (a.auto_clocked_out ? "자동퇴근" : "근무중")} · ${hm(minutesOf(a))}${a.is_late ? " · 지각" : ""}${Number(a.overtime_minutes || 0) > 0 ? ` · 연장 ${hm(Number(a.overtime_minutes))}` : ""}`;
                    return (
                      <td key={i} className={`px-1 py-2 align-middle ${weekend ? "bg-[var(--bg-surface)]/30" : ""}`} title={tip}>
                        <div className="relative h-7 rounded-md bg-[var(--bg-surface)] overflow-hidden">
                          {pos && (
                            <div className="absolute top-1 bottom-1 rounded"
                              style={{ left: `${pos.left}%`, width: `${Math.max(pos.width, 6)}%`, background: a.is_late ? FLEX.amber : FLEX.violet, opacity: pos.open ? 0.55 : 0.9 }} />
                          )}
                          <div className="absolute inset-0 flex items-center justify-center text-[9px] font-semibold text-[var(--text)] mix-blend-luminosity">
                            {ci}{co ? `–${co}` : ""}
                          </div>
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
        <div className="px-4 py-2 border-t border-[var(--border)] text-[10px] text-[var(--text-dim)]">
          타임라인 = 출근~퇴근 (07~22시 스케일) · <span className="text-[var(--primary)]">■</span> 정상 <span className="text-[var(--warning)]">■</span> 지각 <span className="text-[var(--success)]">■</span> 휴가 · 합계 = 정규+연장 근무시간 · 주 52시간 초과 시 <span className="text-[var(--danger)]">빨강</span>
        </div>
      </div>
    </div>
  );
}
