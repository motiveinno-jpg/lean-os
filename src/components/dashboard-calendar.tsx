"use client";

// 대시보드 달력 — 이번 달 일정(파랑)·직원 휴가(초록)를 달력으로 한눈에.
//   날짜 클릭 시 그날 항목을 아래에 간략 표시, 클릭하면 /schedule 로 이동. 데이터는 MyTodosWidget 과 동일 캐시 공유.
//   휴가 추가 (2026-08-07 사장님): 일정 아래에 "누구누구 연차" 로 이어서 보이게.
//   2026-09-10 사장님 "크기 고정하고 지금보다 크게, 이쁘게":
//     · 타일 크기를 카탈로그가 고정(dashboard/page.tsx 의 fixed) — 어떤 폭에서도 6주가 같은 모양으로 들어간다.
//     · 앞뒤 달 날짜를 흐리게 채워 첫 줄·끝 줄이 이가 빠지지 않게 한다.
//     · 달 이동(‹ ›)을 붙였다. 휴가는 leave_calendar 가 전 기간을 주고 일정은 달 단위로 다시 읽는다.

import Link from "next/link";
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { getMonthEvents } from "@/lib/schedule";
import { LEAVE_TYPES } from "@/lib/hr";
import { supabase } from "@/lib/supabase";
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
  const todayStr = ymd(now.getFullYear(), now.getMonth(), now.getDate());
  //   보고 있는 달 — 기본은 이번 달. ‹ › 로 옮기면 일정은 그 달을 다시 읽는다.
  const [cursor, setCursor] = useState({ y: now.getFullYear(), m: now.getMonth() });
  const { y: year, m: month } = cursor;
  const [selected, setSelected] = useState<string>(todayStr);
  const isThisMonth = year === now.getFullYear() && month === now.getMonth();

  const moveMonth = (delta: number) => {
    const d = new Date(year, month + delta, 1);
    const ny = d.getFullYear(), nm = d.getMonth();
    setCursor({ y: ny, m: nm });
    //   옮긴 달이 이번 달이면 오늘을, 아니면 그 달 1일을 고른 상태로 — 아래 목록이 늘 그 달을 가리킨다
    setSelected(ny === now.getFullYear() && nm === now.getMonth() ? todayStr : ymd(ny, nm, 1));
  };
  const goToday = () => { setCursor({ y: now.getFullYear(), m: now.getMonth() }); setSelected(todayStr); };

  //   '할 일' 은 일정으로 합쳐졌다(2026-08-10) — 날짜가 있으면 아래 events 로 이미 들어온다.
  const { data: events = [] } = useQuery({
    queryKey: ["schedule-events", companyId, year, month, "both", userId],
    queryFn: () => getMonthEvents(companyId, year, month, { scope: "all", userId }),
    enabled: !!companyId && !!userId, staleTime: 60_000,
  });

  //   다음 달 일정도 미리 읽어 둔다 — 빈 날의 '다가오는 일정'이 달 경계에서 끊기면(28일에 이번 달이 비면)
  //   정작 다음 주 일정이 있는데 아무것도 없다고 나온다. 조회 키가 같아 › 로 넘기면 그대로 쓰인다.
  const nextMonthAt = new Date(year, month + 1, 1);
  const nextY = nextMonthAt.getFullYear(), nextM = nextMonthAt.getMonth();
  const { data: nextEvents = [] } = useQuery({
    queryKey: ["schedule-events", companyId, nextY, nextM, "both", userId],
    queryFn: () => getMonthEvents(companyId, nextY, nextM, { scope: "all", userId }),
    enabled: !!companyId && !!userId, staleTime: 60_000,
  });

  // 승인된 휴가 · leave_calendar RPC(SECURITY DEFINER) 사용 (2026-08-11).
  //   왜: 이름은 employees 조인인데 급여 등 민감 컬럼 때문에 일반 직원 RLS 로 막혀
  //   "누가" 휴가인지 빈 값으로 내려왔다. RPC 는 이름·기간·단위만 최소 반환.
  //   (승인된 전자결재 휴가는 native leave_requests 에도 기록되므로 이 경로로 전부 커버)
  const  { data: leaves = [] } = useQuery({
    queryKey: ["dash-cal-leaves", companyId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("leave_calendar");
      if (error) throw error;
      return (data || []) as any[];
    },
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
      const name = l.employee_name || l.employees?.name || "";
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

  // 날짜별 마커 집계 — 할 일은 일정(schedule_events)으로 합쳐져 파란 '일정' 점으로 나온다(별도 주황 점 없음).
  const byDate: Record<string, { event: number; leave: number }> = {};
  const bump = (raw: string | null | undefined) => {
    const k = kstDay(raw);
    if (!k) return;
    (byDate[k] || (byDate[k] = { event: 0, leave: 0 })).event++;
  };
  (events as any[]).forEach((e) => { if (!e.completed) bump(e.start_at); });
  Object.entries(leaveByDate).forEach(([k, list]) => {
    (byDate[k] || (byDate[k] = { event: 0, leave: 0 })).leave = list.length;
  });

  // 달력 칸 — 앞뒤 달 날짜로 첫 주·마지막 주의 빈 자리를 채운다(이가 빠져 보이지 않게).
  const startWd = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays = new Date(year, month, 0).getDate();
  const cells = useMemo(() => {
    const out: { key: string; day: number; out: boolean }[] = [];
    for (let i = startWd - 1; i >= 0; i--) {
      const d = new Date(year, month - 1, prevDays - i);
      out.push({ key: ymd(d.getFullYear(), d.getMonth(), d.getDate()), day: prevDays - i, out: true });
    }
    for (let d = 1; d <= daysInMonth; d++) out.push({ key: ymd(year, month, d), day: d, out: false });
    //   마지막 주만 채운다 — 무조건 6줄로 맞추면 9월처럼 5주로 끝나는 달에 회색 줄 하나가 통째로 남는다
    for (let d = 1; out.length % 7 !== 0; d++) {
      const nd = new Date(year, month + 1, d);
      out.push({ key: ymd(nd.getFullYear(), nd.getMonth(), nd.getDate()), day: d, out: true });
    }
    return out;
  }, [year, month, startWd, daysInMonth, prevDays]);

  // 선택일 항목
  const selEvents = (events as any[]).filter((e) => kstDay(e.start_at) === selected && !e.completed);
  const selLeaves = leaveByDate[selected] || [];
  const selCount = selEvents.length + selLeaves.length;
  const selWd = WD[new Date(Number(selected.slice(0, 4)), Number(selected.slice(5, 7)) - 1, Number(selected.slice(8, 10))).getDay()];

  //   고른 날이 비었으면 그 자리에 '다가오는 일정' (2026-09-10 사장님) — 빈 칸에 "없습니다" 한 줄만 두면
  //   달력 아래가 그냥 빈 카드였다. 기준일은 오늘, 미래의 빈 날을 고른 경우엔 그 날.
  const anchor = selected > todayStr ? selected : todayStr;
  const upcoming = useMemo(() => {
    if (selCount > 0) return [];
    type Up = { key: string; date: string; title: string; kind: "event" | "leave"; tag?: string };
    const rows: Up[] = [];
    const seenEvent = new Set<string>();
    for (const e of [...(events as any[]), ...(nextEvents as any[])]) {
      if (e.completed || seenEvent.has(e.id)) continue;
      seenEvent.add(e.id);
      const d = kstDay(e.start_at);
      if (!d || d < anchor) continue;
      rows.push({ key: `e${e.id}`, date: d, title: String(e.title || "제목 없는 일정"), kind: "event" });
    }
    for (const [d, list] of Object.entries(leaveByDate)) {
      if (d < anchor) continue;
      list.forEach((l, i) => rows.push({ key: `l${d}-${i}`, date: d, title: l.name, kind: "leave", tag: l.label }));
    }
    rows.sort((a, b) => a.date.localeCompare(b.date));
    //   여러 날짜 휴가는 날짜별로 펼쳐 둔 것이라 같은 사람이 줄줄이 뜬다 — 가장 이른 하루만 남긴다
    const seenLeave = new Set<string>();
    return rows.filter((r) => {
      if (r.kind !== "leave") return true;
      const k = `${r.title}|${r.tag}`;
      if (seenLeave.has(k)) return false;
      seenLeave.add(k); return true;
    }).slice(0, 5);
  }, [events, nextEvents, leaveByDate, anchor, selCount]);

  return (
    <div className="dashboard-calendar glass-card">
      <div className="dashboard-calendar-header">
        <div className="dashboard-calendar-title">
          <span className="dashboard-calendar-month">{month + 1}월</span>
          <span className="dashboard-calendar-year">{year}</span>
        </div>
        <div className="dashboard-calendar-nav">
          {!isThisMonth && (
            <button type="button" onClick={goToday} className="dashboard-calendar-today-btn">오늘</button>
          )}
          <button type="button" onClick={() => moveMonth(-1)} aria-label="이전 달" className="dashboard-calendar-nav-btn">
            <ChevronLeft size={15} strokeWidth={2.4} />
          </button>
          <button type="button" onClick={() => moveMonth(1)} aria-label="다음 달" className="dashboard-calendar-nav-btn">
            <ChevronRight size={15} strokeWidth={2.4} />
          </button>
          <Link href="/schedule" className="dashboard-calendar-more">전체보기</Link>
        </div>
      </div>

      <div className="dashboard-calendar-weekdays">
        {WD.map((w, i) => (
          <div key={w} className={`dashboard-calendar-wd ${i === 0 ? "is-sun" : i === 6 ? "is-sat" : ""}`}>{w}</div>
        ))}
      </div>

      <div className="dashboard-calendar-days">
        {cells.map((c, i) => {
          const marks = byDate[c.key];
          const isToday = c.key === todayStr;
          const isSel = c.key === selected;
          const wd = i % 7;
          //   일정·휴가 점은 최대 3개까지 — 그 이상은 아래 목록에서 센다
          const dots: string[] = [];
          for (let k = 0; k < Math.min(marks?.event || 0, 2); k++) dots.push("is-event");
          for (let k = 0; k < Math.min(marks?.leave || 0, 2); k++) dots.push("is-leave");
          return (
            <button key={c.key} type="button" onClick={() => setSelected(c.key)}
              className={`dashboard-calendar-cell${c.out ? " is-out" : ""}${isToday ? " is-today" : ""}${isSel ? " is-sel" : ""}${wd === 0 ? " is-sun" : wd === 6 ? " is-sat" : ""}`}>
              <span className="dashboard-calendar-num">{c.day}</span>
              <span className="dashboard-calendar-dots">
                {dots.slice(0, 3).map((k, di) => <span key={di} className={`dashboard-calendar-dot ${k}`} />)}
              </span>
            </button>
          );
        })}
      </div>

      <div className="dashboard-calendar-selected">
        <div className="dashboard-calendar-sel-head">
          <span className="dashboard-calendar-sel-date">
            {Number(selected.slice(5, 7))}월 {Number(selected.slice(8, 10))}일 ({selWd})
          </span>
          {selected === todayStr && <span className="dashboard-calendar-sel-today">오늘</span>}
          {selCount > 0
            ? <span className="dashboard-calendar-sel-count">{selCount}건</span>
            : <span className="dashboard-calendar-sel-none">일정 없음</span>}
        </div>
        {selCount === 0 ? (
          upcoming.length > 0 ? (
            <div className="dashboard-calendar-items">
              <div className="dashboard-calendar-upcoming-head">다가오는 일정</div>
              {upcoming.map((u) => (
                <Link key={u.key} href={u.kind === "event" ? "/schedule" : "/employees?tab=leave"} className="dashboard-calendar-item">
                  <span className={`dashboard-calendar-item-bar ${u.kind === "event" ? "is-event" : "is-leave"}`} />
                  <span className="dashboard-calendar-item-date">{Number(u.date.slice(5, 7))}/{Number(u.date.slice(8, 10))}</span>
                  <span className="dashboard-calendar-item-title">{u.title}</span>
                  {u.tag && <span className="dashboard-calendar-item-tag">{u.tag}</span>}
                </Link>
              ))}
            </div>
          ) : (
            <div className="dashboard-calendar-empty"><span>다가오는 일정이 없습니다</span></div>
          )
        ) : (
          <div className="dashboard-calendar-items">
            {selEvents.slice(0, 6).map((e: any) => (
              <Link key={`e${e.id}`} href="/schedule" className="dashboard-calendar-item">
                <span className="dashboard-calendar-item-bar is-event" />
                <span className="dashboard-calendar-item-title">{e.title}</span>
              </Link>
            ))}
            {selEvents.length > 6 && (
              <Link href="/schedule" className="dashboard-calendar-item-more">일정 외 {selEvents.length - 6}건 →</Link>
            )}
            {/* 휴가는 일정 아래에 이어서 — "누구누구 연차" (2026-08-07 사장님) */}
            {selLeaves.slice(0, 6).map((l, i) => (
              <Link key={`l${i}`} href="/employees?tab=leave" className="dashboard-calendar-item">
                <span className="dashboard-calendar-item-bar is-leave" />
                <span className="dashboard-calendar-item-title">{l.name}</span>
                <span className="dashboard-calendar-item-tag">{l.label}</span>
              </Link>
            ))}
            {selLeaves.length > 6 && (
              <Link href="/employees?tab=leave" className="dashboard-calendar-item-more">휴가 외 {selLeaves.length - 6}명 →</Link>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
