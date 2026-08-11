"use client";

// 대시보드 미니 캘린더 — 이번 달 일정(파랑)·할 일(주황)·직원 휴가(초록)를 달력으로 한눈에.
//   날짜 클릭 시 그날 항목을 아래에 간략 표시, 클릭하면 /schedule 로 이동. 데이터는 MyTodosWidget 과 동일 캐시 공유.
//   휴가 추가 (2026-08-07 사장님): 일정 아래에 "누구누구 연차" 로 이어서 보이게.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getMonthEvents, type ScheduleTodo } from "@/lib/schedule";
import { getLeaveRequests, LEAVE_TYPES } from "@/lib/hr";
import { getCompanyLeaveTypes, defaultCompanyLeaveTypes } from "@/lib/leave-grants";

const WD = ["일", "월", "화", "수", "목", "금", "토"];
function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// 시각이 들어 있는 값(schedule_events.start_at)을 KST 날짜로. (2026-08-07)
//   종전엔 ISO 문자열을 그대로 slice(0,10) 했는데, 종일 일정은 KST 자정 = 전날 15:00 UTC 라
//   달력에 하루 앞당겨 찍혔다(8/7 전사워크샵이 8/6 에 표시). 날짜만 있는 값(due_date,
//   start_date)은 변환 없이 그대로 쓴다.
function kstDay(raw: string | null | undefined): string {
  const s = String(raw || "");
  if (!s) return "";
  if (!s.includes("T") && !s.includes(" ")) return s.slice(0, 10);
  const t = Date.parse(s.replace(" ", "T"));
  if (Number.isNaN(t)) return s.slice(0, 10);
  return new Date(t + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

export function DashboardCalendar({ userId, companyId }: { userId: string; companyId: string }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-index
  const todayStr = ymd(year, month, now.getDate());
  const [selected, setSelected] = useState<string>(todayStr);

  //   '할 일' 은 일정으로 합쳐졌다(2026-08-10) — 날짜가 있으면 아래 events 로 이미 들어온다.
  const { data: events = [] } = useQuery({
    queryKey: ["schedule-events", companyId, year, month, "both", userId],
    queryFn: () => getMonthEvents(companyId, year, month, { scope: "all", userId }),
    enabled: !!companyId && !!userId, staleTime: 60_000,
  });

  // 승인된 휴가 — 전자결재로 올라온 휴가까지 합쳐서 준다(getLeaveRequests 가 병합).
  const { data: leaves = [] } = useQuery({
    queryKey: ["dash-cal-leaves", companyId],
    queryFn: () => getLeaveRequests(companyId, "approved"),
    enabled: !!companyId, staleTime: 60_000,
  });
  const { data: companyLeaveTypes = defaultCompanyLeaveTypes() } = useQuery({
    queryKey: ["company-leave-types", companyId],
    queryFn: () => getCompanyLeaveTypes(companyId),
    enabled: !!companyId, staleTime: 300_000,
  });
  const leaveLabel = (v: string) =>
    companyLeaveTypes.find((x) => x.value === v)?.label
    || LEAVE_TYPES.find((t) => t.value === v)?.label
    || v;
  // 단위 우선 표기 (2026-08-11 사장님: 반차가 '연차'로 나옴) — 반차·시간차는 leave_type(annual 등)이
  //   아니라 leave_unit 으로 저장되므로, 단위가 있으면 그걸로 표기한다. 오전/오후는 시작시각 기준.
  const displayLabel = (l: any) => {
    if (l.leave_unit === "half_day") {
      const st = String(l.start_time || "").slice(0, 5);
      return st && st < "13:00" ? "오전 반차" : st ? "오후 반차" : "반차";
    }
    if (l.leave_unit === "two_hours") return "시간차";
    if (Number(l.days) === 0.5) return "반차"; // 구 데이터 방어 — unit 없이 0.5일로만 기록된 건
    return leaveLabel(String(l.leave_type || ""));
  };

  // 휴가는 기간(start_date~end_date)이라 날짜별로 펼쳐 둔다.
  //   날짜 문자열끼리만 더해 나가므로 타임존 변환이 끼어들지 않는다
  //   (new Date 로 돌리면 KST 자정이 UTC 전날로 밀려 하루 어긋난 전례가 있다).
  const leaveByDate = useMemo(() => {
    const map: Record<string, { name: string; label: string }[]> = {};
    const nextDay = (d: string) => {
      const [y, m, dd] = d.split("-").map(Number);
      const t = new Date(Date.UTC(y, m - 1, dd + 1));
      return t.toISOString().slice(0, 10);
    };
    for (const l of leaves as any[]) {
      const from = String(l.start_date || "").slice(0, 10);
      const to = String(l.end_date || from).slice(0, 10);
      if (!from) continue;
      const name = l.employees?.name || "";
      const label = displayLabel(l);
      let cur = from;
      // 방어: 잘못 입력된 기간(끝<시작)이나 비정상적으로 긴 기간에서 무한 루프 방지
      for (let i = 0; i < 366 && cur <= to; i++) {
        (map[cur] || (map[cur] = [])).push({ name, label });
        cur = nextDay(cur);
      }
    }
    return map;
  }, [leaves, companyLeaveTypes]);   // eslint-disable-line react-hooks/exhaustive-deps

  // 날짜별 마커 집계
  const byDate: Record<string, { todo: number; event: number; leave: number }> = {};
  const bump = (raw: string | null | undefined, kind: "todo" | "event") => {
    const k = kstDay(raw);
    if (!k) return;
    (byDate[k] || (byDate[k] = { todo: 0, event: 0, leave: 0 }))[kind]++;
  };
  (events as any[]).forEach((e) => { if (!e.completed) bump(e.start_at, "event"); });
  Object.entries(leaveByDate).forEach(([k, list]) => {
    (byDate[k] || (byDate[k] = { todo: 0, event: 0, leave: 0 })).leave = list.length;
  });

  // 달력 셀
  const startWd = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // 선택일 항목
  const selEvents = (events as any[]).filter((e) => kstDay(e.start_at) === selected && !e.completed);
  const selTodos: ScheduleTodo[] = [];   // 합쳐진 뒤로는 비어 있다(위 주석 참고)
  const selItems = [
    ...selEvents.map((e) => ({ id: `e${e.id}`, title: e.title as string, kind: "event" as const })),
    ...selTodos.map((t) => ({ id: `t${t.id}`, title: t.title, kind: "todo" as const })),
  ];
  const selLeaves = leaveByDate[selected] || [];

  return (
    <div className="dashboard-calendar glass-card">
      <div className="dashboard-calendar-header">
        <h3 className="text-[13px] font-bold text-[var(--text)]">{year}년 {month + 1}월 <span className="text-[var(--text-dim)] font-normal">일정 · 할 일 · 휴가</span></h3>
        <Link href="/schedule" className="widget-more-link">전체보기 →</Link>
      </div>

      <div className="dashboard-calendar-weekdays">
        {WD.map((w, i) => (
          <div key={w} className={`text-center text-[10px] font-semibold ${i === 0 ? "text-[var(--danger)]" : i === 6 ? "text-[var(--primary)]" : "text-[var(--text-dim)]"}`}>{w}</div>
        ))}
      </div>

      <div className="dashboard-calendar-days">
        {cells.map((d, i) => {
          if (d === null) return <div key={`x${i}`} className="aspect-square" />;
          const key = ymd(year, month, d);
          const marks = byDate[key];
          const isToday = key === todayStr;
          const isSel = key === selected;
          return (
            <button key={key} type="button" onClick={() => setSelected(key)}
              className={`aspect-square rounded-lg flex flex-col items-center justify-center leading-none transition ${
                isSel ? "bg-[var(--primary)] text-white font-bold" : isToday ? "bg-[var(--primary)]/12 text-[var(--primary)] font-bold" : "text-[var(--text)] hover:bg-[var(--bg-surface)]"
              }`}>
              <span className="text-[11px]">{d}</span>
              <span className="flex gap-0.5 mt-0.5 h-1 items-center">
                {marks?.event ? <span className={`w-1 h-1 rounded-full ${isSel ? "bg-white" : "bg-[var(--primary)]"}`} /> : null}
                {marks?.todo ? <span className={`w-1 h-1 rounded-full ${isSel ? "bg-white" : "bg-[var(--warning)]"}`} /> : null}
                {marks?.leave ? <span className={`w-1 h-1 rounded-full ${isSel ? "bg-white" : "bg-[var(--success)]"}`} /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="dashboard-calendar-selected">
        <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">
          {Number(selected.slice(5, 7))}월 {Number(selected.slice(8, 10))}일{selected === todayStr ? " · 오늘" : ""}
        </div>
        {selItems.length === 0 && selLeaves.length === 0 ? (
          <div className="text-[11px] text-[var(--text-dim)] py-1">일정·할 일·휴가가 없습니다.</div>
        ) : (
          <div className="dashboard-calendar-items">
            {selItems.slice(0, 4).map((it) => (
              <Link key={it.id} href="/schedule" className="flex items-center gap-2 text-[12px] text-[var(--text)] no-underline hover:text-[var(--primary)] transition">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${it.kind === "event" ? "bg-[var(--primary)]" : "bg-[var(--warning)]"}`} />
                <span className="truncate">{it.title}</span>
              </Link>
            ))}
            {selItems.length > 4 && <Link href="/schedule" className="text-[11px] text-[var(--text-dim)] hover:text-[var(--primary)] no-underline">외 {selItems.length - 4}건 →</Link>}
            {/* 휴가는 일정 아래에 이어서 — "누구누구 연차" (2026-08-07 사장님) */}
            {selLeaves.slice(0, 4).map((l, i) => (
              <Link key={`l${i}`} href="/employees?tab=leave" className="flex items-center gap-2 text-[12px] text-[var(--text)] no-underline hover:text-[var(--primary)] transition">
                <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-[var(--success)]" />
                <span className="truncate">{l.name} {l.label}</span>
              </Link>
            ))}
            {selLeaves.length > 4 && <Link href="/employees?tab=leave" className="text-[11px] text-[var(--text-dim)] hover:text-[var(--primary)] no-underline">휴가 외 {selLeaves.length - 4}명 →</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
