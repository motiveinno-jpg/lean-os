"use client";

// 메신저 오른쪽의 달력 ( + Teams 화면 캡처).
//
//   왼쪽 레일에서 '일정' 을 고르면 대화창 자리에 이 달력이 선다. 예전엔 '무슨 일정인가요' 라는
//   입력칸에 제목부터 쳐야 했는데, 일정은 **날짜를 먼저 고르는 일**이다 —
//   일정/할 일 메뉴와 같게 **날짜 칸을 누르면** 그 날짜로 넣는 창이 열린다.
//
//   저장은 lib/schedule 의 upsertEvent — 일정/할 일 메뉴와 같은 자리로 간다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ScheduleItemDialog, type ScheduleDialogTarget } from "@/components/schedule-item-dialog";
import { todayKst } from "@/lib/kst";
import {
  getMonthEvents, eventDateKeys, EVENT_COLOR_BG,
  type ScheduleEvent,
} from "@/lib/schedule";
import { fetchLeaveCalendar, buildLeaveByDate } from "@/lib/leave-calendar";
import { useCompanyHolidays } from "@/hooks/use-company-holidays";
import { ScheduleDayAgenda, CalendarInfoDialog, DayDots, useNarrowScreen, type CalendarInfo } from "@/components/schedule-day-agenda";

const WD = ["일", "월", "화", "수", "목", "금", "토"];

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

export function ChatScheduleCalendar({ companyId, userId }: { companyId: string | null; userId: string | null }) {
  const now = useMemo(() => new Date(), []);
  const [view, setView] = useState({ y: now.getFullYear(), m0: now.getMonth() });
  //   날짜를 누르면 그 날짜로 여는 입력 창. 여러 날에 걸치는 일이 흔해 **시작~종료**를 함께 잡는다.
  const [open, setOpen] = useState<ScheduleDialogTarget | null>(null);
  //   휴가 칩은 읽기 전용 창으로(결재로 정해진 것이라 여기서 고치지 않는다)
  const [info, setInfo] = useState<CalendarInfo | null>(null);
  //   폰 폭: 칸에 점만 찍고 날짜를 누르면 고르기만 한다 — 그날 것은 달력 아래 목록. 끌어서 여러 날 고르기도 폰에선 끈다
  const narrow = useNarrowScreen();
  const [pickedDay, setPickedDay] = useState<string>(() => todayKst());
  //   달력에서 **끌어서** 여러 날을 한 번에 고른다(누르고 옆으로 끌면 그 구간이 잡힌다)
  const dragRef = useRef<{ start: string } | null>(null);
  const [dragTo, setDragTo] = useState<string | null>(null);
  const dragRange = dragRef.current && dragTo
    ? [dragRef.current.start, dragTo].sort() as [string, string]
    : null;

  //   손을 떼면 잡힌 구간으로 입력 창을 연다 — 달력 밖에서 떼도 확실히 닫히게 window 에 건다
  useEffect(() => {
    const onUp = () => {
      const d = dragRef.current;
      if (!d) return;
      const to = dragTo || d.start;
      const [a, b] = [d.start, to].sort();
      dragRef.current = null;
      setDragTo(null);
      setOpen({ mode: "new", from: a, to: b });
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [dragTo]);

  const { data: events = [] } = useQuery({
    queryKey: ["chat-cal-events", companyId, userId, view.y, view.m0],
    queryFn: () => getMonthEvents(companyId!, view.y, view.m0, { scope: "all", userId: userId || undefined }),
    enabled: !!companyId,
  });

  //   승인 휴가 — 일정 달력과 같은 소스로 이 달력에도 표시
  const { data: leaves = [] } = useQuery({
    queryKey: ["chat-cal-leaves", companyId],
    queryFn: fetchLeaveCalendar,
    enabled: !!companyId, staleTime: 60_000,
  });
  const leaveByDay = useMemo(() => buildLeaveByDate(leaves), [leaves]);
  //   공휴일 — 일정 메뉴 달력과 같은 회사 공휴일 표
  const holidays = useCompanyHolidays(companyId, [view.y, view.y + 1]);

  //   날짜별로 모아 둔다 — 기간 일정은 걸친 날마다 들어간다(일정 화면과 같은 규칙)
  const byDay = useMemo(() => {
    const m = new Map<string, ScheduleEvent[]>();
    for (const e of events as ScheduleEvent[]) {
      for (const k of eventDateKeys(e)) {
        const arr = m.get(k) || [];
        arr.push(e);
        m.set(k, arr);
      }
    }
    return m;
  }, [events]);

  const first = new Date(view.y, view.m0, 1);
  const daysInMonth = new Date(view.y, view.m0 + 1, 0).getDate();
  const lead = first.getDay();
  const cells: ({ d: number; key: string } | null)[] = [];
  for (let i = 0; i < lead; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push({ d, key: keyOf(view.y, view.m0, d) });
  while (cells.length % 7 !== 0) cells.push(null);

  const today = todayKst();
  const move = (step: number) => setView((v) => {
    const n = new Date(v.y, v.m0 + step, 1);
    return { y: n.getFullYear(), m0: n.getMonth() };
  });


  return (
    <div className="chat-cal">
      <header className="chat-cal-head">
        <button type="button" onClick={() => move(-1)} title="이전 달">‹</button>
        <b>{view.y}년 {view.m0 + 1}월</b>
        <button type="button" onClick={() => move(1)} title="다음 달">›</button>
        <button type="button" className="chat-cal-today"
          onClick={() => setView({ y: now.getFullYear(), m0: now.getMonth() })}>오늘</button>
        <span className="chat-cal-hint">날짜를 누르거나 끌면 그 날짜로 일정을 넣습니다</span>
      </header>

      <div className="chat-cal-week">
        {WD.map((w, i) => (
          <span key={w} className={i === 0 ? "chat-cal-sun" : i === 6 ? "chat-cal-sat" : ""}>{w}</span>
        ))}
      </div>

      <div className="chat-cal-grid">
        {cells.map((c, i) => {
          if (!c) return <div key={`e${i}`} className="chat-cal-day chat-cal-day-out" />;
          const list = byDay.get(c.key) || [];
          const dow = i % 7;
          const inDrag = !!dragRange && c.key >= dragRange[0] && c.key <= dragRange[1];
          return (
            <button key={c.key} type="button"
              className={`chat-cal-day ${c.key === today ? "chat-cal-day-today" : ""} ${inDrag || (narrow && pickedDay === c.key) ? "chat-cal-day-pick" : ""}`}
              
              //   눌러서 끌면 여러 날 · 손을 떼는 순간(window mouseup) 입력 창이 열린다
              onMouseDown={() => { if (narrow) return; dragRef.current = { start: c.key }; setDragTo(c.key); }}
              onMouseEnter={() => { if (dragRef.current) setDragTo(c.key); }}
              onClick={() => { if (narrow) setPickedDay(c.key); }}
              aria-pressed={narrow ? pickedDay === c.key : undefined}
              
              //   키보드로도 열 수 있게 · Enter/Space 는 하루짜리로 연다
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  if (narrow) setPickedDay(c.key);
                  else setOpen({ mode: "new", from: c.key, to: c.key });
                }
              }}
              title={`${c.key} · 누르면 그 날, 끌면 여러 날 일정`}>
              <span className={`chat-cal-daynum ${dow === 0 || holidays[c.key] ? "chat-cal-sun" : dow === 6 ? "chat-cal-sat" : ""}`} title={holidays[c.key] || undefined}>{c.d}</span>
              {narrow ? (
                <DayDots events={list} leaveCount={(leaveByDay[c.key] || []).length} holiday={!!holidays[c.key]} />
              ) : (<>
              {list.slice(0, 3).map((e) => (
                <span key={e.id} className={`chat-cal-ev ${EVENT_COLOR_BG[e.color] || ""}`} title={`${e.title} · 누르면 내용을 봅니다`}
                  onMouseDown={(ev) => { ev.stopPropagation(); }}
                  onClick={(ev) => { ev.stopPropagation(); setOpen({ mode: "view", event: e }); }}>{e.title}</span>
              ))}
              {list.length > 3 && <span className="chat-cal-more">+{list.length - 3}</span>}
              {/* 직원 휴가 — 일정 아래에 초록 칩 */}
              {(leaveByDay[c.key] || []).map((lv, li) => (
                <span key={`lv${li}`} className="chat-cal-leave" title={`${lv.name} ${lv.label} · 누르면 내용 보기`}
                  onMouseDown={(ev) => ev.stopPropagation()}
                  onClick={(ev) => { ev.stopPropagation(); setInfo({ kind: "leave", leave: lv }); }}>{lv.name} {lv.label}</span>
              ))}
              </>)}
            </button>
          );
        })}
      </div>

      {narrow && (
        <ScheduleDayAgenda date={pickedDay} holiday={holidays[pickedDay] || null} events={byDay.get(pickedDay) || []} leaves={leaveByDay[pickedDay] || []}
          onOpenEvent={(e) => setOpen({ mode: "view", event: e })}
          onOpenLeave={(lv) => setInfo({ kind: "leave", leave: lv })}
          onAdd={(d) => setOpen({ mode: "new", from: d, to: d })} />
      )}
      {info && <CalendarInfoDialog info={info} onClose={() => setInfo(null)} />}

      {/* 날짜를 누르면(또는 일정을 누르면) 뜨는 창 — 일정 메뉴와 **같은 부품** */}
      {open && (
        <ScheduleItemDialog companyId={companyId} userId={userId} target={open} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}

