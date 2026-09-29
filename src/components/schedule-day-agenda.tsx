"use client";

// 달력 공용 조각 — 일정 메뉴 달력과 메신저 일정 달력이 같이 쓴다.
//
//   · useNarrowScreen: 폰 폭(768px 미만)인지. 칸이 40~50px 라 글자 칩은 한두 글자로 잘려 못 읽는다 →
//     폰에서는 칸에 **점만** 찍고, 날짜를 누르면 그날 것을 달력 **아래 목록**으로 보여 준다.
//   · ScheduleDayAgenda: 고른 날짜의 공휴일·일정·휴가 목록(폰 달력 아래).
//   · CalendarInfoDialog: 휴가·공휴일 칩을 눌렀을 때 뜨는 읽기 전용 창.
//     휴가는 결재로 정해진 것이라 여기서 고치지 않고, 공휴일은 정보뿐이다.

import { useEffect, useState } from "react";
import { EVENT_COLOR_DOT, formatEventRange, type ScheduleEvent } from "@/lib/schedule";
import type { LeaveByDateEntry } from "@/lib/leave-calendar";
import { useModalKeys } from "@/hooks/use-modal-keys";

const NARROW_QUERY = "(max-width: 767px)";

export function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia(NARROW_QUERY);
    const on = () => setNarrow(mq.matches);
    on();
    mq.addEventListener?.("change", on);
    return () => mq.removeEventListener?.("change", on);
  }, []);
  return narrow;
}

const WD = ["일", "월", "화", "수", "목", "금", "토"];
function dayTitle(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return `${m}월 ${d}일 (${WD[dow]})`;
}
function leaveRange(lv: LeaveByDateEntry): string {
  const f = (s: string) => { const [, m, d] = s.split("-").map(Number); return `${m}/${d}`; };
  const range = lv.from === lv.to ? f(lv.from) : `${f(lv.from)} ~ ${f(lv.to)}`;
  return lv.days != null && lv.days > 0 ? `${range} · ${lv.days}일` : range;
}

/** 폰 달력 칸 안의 점 — 일정은 그 색, 휴가는 초록, 공휴일은 빨강. 많아도 4개까지만 찍는다 */
export function DayDots({ events, leaveCount, holiday }: { events: ScheduleEvent[]; leaveCount: number; holiday?: boolean }) {
  const dots: string[] = [];
  if (holiday) dots.push("sched-dot-holiday");
  for (const e of events) dots.push(EVENT_COLOR_DOT[e.color] || EVENT_COLOR_DOT.gray);
  for (let i = 0; i < leaveCount; i++) dots.push("sched-dot-leave");
  if (dots.length === 0) return null;
  const more = dots.length - 4;
  return (
    <span className="sched-dots" aria-hidden>
      {dots.slice(0, 4).map((c, i) => <i key={i} className={c} />)}
      {more > 0 && <em>+{more}</em>}
    </span>
  );
}

export function ScheduleDayAgenda({
  date, holiday, events, leaves, onOpenEvent, onOpenLeave, onAdd,
}: {
  date: string;
  holiday?: string | null;
  events: ScheduleEvent[];
  leaves: LeaveByDateEntry[];
  onOpenEvent: (e: ScheduleEvent) => void;
  onOpenLeave: (lv: LeaveByDateEntry) => void;
  onAdd?: (date: string) => void;
}) {
  const empty = !holiday && events.length === 0 && leaves.length === 0;
  return (
    <section className="sched-agenda" aria-label={`${dayTitle(date)} 일정`}>
      <header>
        <b>{dayTitle(date)}</b>
        {onAdd && <button type="button" className="btn-secondary btn-sm" onClick={() => onAdd(date)}>+ 일정 추가</button>}
      </header>
      {holiday && (
        <div className="sched-agenda-row sched-agenda-static">
          <i className="sched-dot-holiday" />
          <span><b>{holiday}</b><em>공휴일</em></span>
        </div>
      )}
      {events.map((e) => (
        <button key={e.id} type="button" className="sched-agenda-row" onClick={() => onOpenEvent(e)}>
          <i className={EVENT_COLOR_DOT[e.color] || EVENT_COLOR_DOT.gray} />
          <span>
            <b className={e.completed ? "line-through opacity-60" : ""}>{e.title}</b>
            <em>{formatEventRange(e)}</em>
          </span>
        </button>
      ))}
      {leaves.map((lv) => (
        <button key={lv.key} type="button" className="sched-agenda-row" onClick={() => onOpenLeave(lv)}>
          <i className="sched-dot-leave" />
          <span><b>{lv.name} {lv.label}</b><em>휴가 · {leaveRange(lv)}</em></span>
        </button>
      ))}
      {empty && <p className="sched-agenda-empty">이 날은 일정이 없습니다.</p>}
    </section>
  );
}

export type CalendarInfo =
  | { kind: "leave"; leave: LeaveByDateEntry }
  | { kind: "holiday"; date: string; name: string };

export function CalendarInfoDialog({ info, onClose }: { info: CalendarInfo; onClose: () => void }) {
  useModalKeys(true, onClose);
  const leave = info.kind === "leave" ? info.leave : null;
  return (
    <div className="sched-view" onClick={onClose}>
      <div className="sched-view-box" onClick={(ev) => ev.stopPropagation()}>
        <header>
          <i className={`sched-view-dot ${leave ? "sched-dot-leave" : "sched-dot-holiday"}`} />
          <b>{leave ? `${leave.name} ${leave.label}` : (info as { name: string }).name}</b>
          <button type="button" onClick={onClose} title="닫기">✕</button>
        </header>
        <p className="sched-view-when">
          {leave ? leaveRange(leave) : dayTitle((info as { date: string }).date)}
        </p>
        <dl className="sched-view-meta">
          {leave ? (
            <>
              <div><dt>구분</dt><dd>승인된 휴가</dd></div>
              <div><dt>안내</dt><dd>휴가는 결재로 정해져 여기서 고치지 않습니다. 바꾸려면 휴가 화면에서 신청·취소합니다.</dd></div>
            </>
          ) : (
            <div><dt>구분</dt><dd>공휴일</dd></div>
          )}
        </dl>
      </div>
    </div>
  );
}
