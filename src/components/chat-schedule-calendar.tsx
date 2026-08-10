"use client";

// 메신저 오른쪽의 달력 (2026-08-10 사장님 지시 + Teams 화면 캡처).
//
//   왼쪽 레일에서 '일정' 을 고르면 대화창 자리에 이 달력이 선다. 예전엔 '무슨 일정인가요' 라는
//   입력칸에 제목부터 쳐야 했는데, 일정은 **날짜를 먼저 고르는 일**이다 —
//   일정/할 일 메뉴와 같게 **날짜 칸을 누르면** 그 날짜로 넣는 창이 열린다.
//
//   저장은 lib/schedule 의 upsertEvent — 일정/할 일 메뉴와 같은 자리로 간다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { ScheduleItemEditor, draftFromEvent, type ScheduleDraft } from "@/components/schedule-item-editor";
import { todayKst } from "@/lib/kst";
import {
  getMonthEvents, upsertEvent, deleteEvent, eventDateKeys, EVENT_COLOR_BG,
  type ScheduleEvent,
} from "@/lib/schedule";

const WD = ["일", "월", "화", "수", "목", "금", "토"];

const pad = (n: number) => String(n).padStart(2, "0");
const keyOf = (y: number, m0: number, d: number) => `${y}-${pad(m0 + 1)}-${pad(d)}`;

export function ChatScheduleCalendar({ companyId, userId }: { companyId: string | null; userId: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const now = useMemo(() => new Date(), []);
  const [view, setView] = useState({ y: now.getFullYear(), m0: now.getMonth() });
  //   날짜를 누르면 그 날짜로 여는 입력 창. 여러 날에 걸치는 일이 흔해 **시작~종료**를 함께 잡는다.
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);
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
      setDraft(draftFromEvent(null, { from: a, to: b }));
    };
    window.addEventListener("mouseup", onUp);
    return () => window.removeEventListener("mouseup", onUp);
  }, [dragTo]);

  const { data: events = [] } = useQuery({
    queryKey: ["chat-cal-events", companyId, userId, view.y, view.m0],
    queryFn: () => getMonthEvents(companyId!, view.y, view.m0, { scope: "all", userId: userId || undefined }),
    enabled: !!companyId,
  });

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

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["chat-cal-events"] });
    qc.invalidateQueries({ queryKey: ["chat-schedule-events"] });
    qc.invalidateQueries({ queryKey: ["schedule-events"] });   // 일정 메뉴도 같이
    qc.invalidateQueries({ queryKey: ["schedule-items"] });
  };

  const save = useMutation({
    //   ⚠️ 하루 종일 일정은 날짜 문자열 그대로 — toISOString() 을 쓰면 KST 자정이 UTC 로 밀려 하루 전이 된다.
    //      날짜를 비우면 start_at = null (달력에 안 뜨고 목록에만 남는 항목).
    mutationFn: () => {
      const d = draft!;
      const from = d.from, to = d.to || d.from;
      const [a, b] = !from ? ["", ""] : (from <= to ? [from, to] : [to, from]);
      return upsertEvent({
        id: d.id, companyId: companyId!, userId: userId!,
        title: d.title.trim(), description: d.description.trim() || undefined,
        startAt: a ? `${a}T00:00:00` : null,
        endAt: a && b > a ? `${b}T00:00:00` : null,
        allDay: true, color: d.color,
        visibility: d.visibility, targetUserIds: d.targetUserIds, targetDepartments: d.targetDepartments,
      });
    },
    onSuccess: () => { setDraft(null); refresh(); toast("일정에 넣었습니다.", "success"); },
    onError: (e: any) => toast(e?.message || "일정 저장 실패", "error"),
  });

  const remove = useMutation({
    mutationFn: () => deleteEvent(draft!.id!),
    onSuccess: () => { setDraft(null); refresh(); toast("지웠습니다.", "success"); },
    onError: (e: any) => toast(e?.message || "삭제 실패", "error"),
  });


  return (
    <div className="chat-cal">
      <header className="chat-cal-head">
        <button type="button" onClick={() => move(-1)} title="이전 달">‹</button>
        <b>{view.y}년 {view.m0 + 1}월</b>
        <button type="button" onClick={() => move(1)} title="다음 달">›</button>
        <button type="button" className="chat-cal-today"
          onClick={() => setView({ y: now.getFullYear(), m0: now.getMonth() })}>오늘</button>
        <span className="chat-cal-hint">날짜를 누르면 그 날 일정을 넣습니다</span>
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
              className={`chat-cal-day ${c.key === today ? "chat-cal-day-today" : ""} ${inDrag ? "chat-cal-day-pick" : ""}`}
              //   눌러서 끌면 여러 날 — 손을 떼는 순간(window mouseup) 입력 창이 열린다
              onMouseDown={() => { dragRef.current = { start: c.key }; setDragTo(c.key); }}
              onMouseEnter={() => { if (dragRef.current) setDragTo(c.key); }}
              //   키보드로도 열 수 있게 — Enter/Space 는 하루짜리로 연다
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setDraft(draftFromEvent(null, { from: c.key, to: c.key }));
                }
              }}
              title={`${c.key} — 누르면 그 날, 끌면 여러 날 일정`}>
              <span className={`chat-cal-daynum ${dow === 0 ? "chat-cal-sun" : dow === 6 ? "chat-cal-sat" : ""}`}>{c.d}</span>
              {list.slice(0, 3).map((e) => (
                <span key={e.id} className={`chat-cal-ev ${EVENT_COLOR_BG[e.color] || ""}`} title={`${e.title} — 누르면 고칩니다`}
                  onMouseDown={(ev) => { ev.stopPropagation(); }}
                  onClick={(ev) => { ev.stopPropagation(); setDraft(draftFromEvent(e)); }}>{e.title}</span>
              ))}
              {list.length > 3 && <span className="chat-cal-more">+{list.length - 3}</span>}
            </button>
          );
        })}
      </div>

      {/* 날짜를 누르면 뜨는 입력 창 — 일정 메뉴와 **같은 부품**을 쓴다 */}
      {draft && (
        <ScheduleItemEditor
          companyId={companyId} userId={userId}
          draft={draft} onChange={setDraft}
          onSave={() => save.mutate()}
          onDelete={draft.id ? () => remove.mutate() : undefined}
          onClose={() => setDraft(null)}
          saving={save.isPending || remove.isPending} />
      )}
    </div>
  );
}

