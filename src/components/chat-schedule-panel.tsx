"use client";

// 메신저 안의 '일정 · 할 일' (2026-08-10 사장님 지시) — 왼쪽 레일 세 번째 아이콘이 연다.
//
//   대화를 보다가 곧바로 일정을 잡거나 할 일을 적는 자리다. 저장은 **일정 / 할 일 메뉴와 같은
//   테이블·같은 함수**(lib/schedule)를 쓴다 — 여기서 적으면 /schedule 에도 그대로 있다.
//   따로 저장하는 곳을 만들지 않는다(두 곳이 갈리면 어느 쪽이 맞는지 알 수 없다).

import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { DateField } from "@/components/date-field";
import { useToast } from "@/components/toast";
import { todayKst } from "@/lib/kst";
import {
  getMonthEvents, upsertEvent, getTodos, upsertTodo, toggleTodoDone,
  type ScheduleEvent, type ScheduleTodo, type EventColor,
} from "@/lib/schedule";

type Mode = "event" | "todo";

//   목록 앞 점 — 일정 화면의 색 뜻을 그대로 쓰되, 점은 옅으면 안 보여 진한 색으로 찍는다
const DOT: Record<EventColor, string> = {
  blue: "bg-blue-500", green: "bg-green-500", red: "bg-red-500",
  amber: "bg-amber-500", violet: "bg-violet-500", gray: "bg-gray-400",
};

/** 이번 달 + 다음 달을 한 번에 — 달을 넘기는 일정도 '다가오는' 목록에 들어오게 */
function monthPair(base = new Date()) {
  const y = base.getFullYear(), m = base.getMonth();
  const next = new Date(y, m + 1, 1);
  return [{ y, m }, { y: next.getFullYear(), m: next.getMonth() }];
}

export function ChatSchedulePanel({ companyId, userId }: { companyId: string | null; userId: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [mode, setMode] = useState<Mode>("event");
  const [evTitle, setEvTitle] = useState("");
  const [evDate, setEvDate] = useState(todayKst());
  const [evShared, setEvShared] = useState(true);
  const [tdTitle, setTdTitle] = useState("");
  const [tdDue, setTdDue] = useState("");

  const months = useMemo(() => monthPair(), []);
  const { data: events = [] } = useQuery({
    queryKey: ["chat-schedule-events", companyId, userId],
    queryFn: async () => {
      const lists = await Promise.all(months.map((mm) =>
        getMonthEvents(companyId!, mm.y, mm.m, { scope: "both", userId: userId || undefined })));
      const today = todayKst();
      return (lists.flat() as ScheduleEvent[])
        //   지난 일정은 굳이 안 보여 준다 — '다가오는 것' 만 본다
        .filter((e) => String(e.end_at || e.start_at).slice(0, 10) >= today)
        .sort((a, b) => String(a.start_at).localeCompare(String(b.start_at)))
        .slice(0, 40);
    },
    enabled: !!companyId,
  });

  const { data: todos = [] } = useQuery({
    queryKey: ["chat-schedule-todos", userId],
    queryFn: () => getTodos(userId!),
    enabled: !!userId,
  });

  //   저장 뒤에는 **일정/할 일 메뉴의 캐시까지** 무효화한다 — 같은 창에서 그 화면을 열어 두었을 때
  //   방금 적은 것이 안 보이면 저장이 안 된 줄 안다.
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["chat-schedule-events"] });
    qc.invalidateQueries({ queryKey: ["chat-schedule-todos"] });
    qc.invalidateQueries({ queryKey: ["schedule-events"] });
    qc.invalidateQueries({ queryKey: ["schedule-todos"] });
  };

  const addEvent = useMutation({
    //   ⚠️ 하루 종일 일정은 **그 날짜 문자열 그대로** 넣는다(일정 화면과 같은 규칙).
    //      toISOString() 을 쓰면 KST 자정이 UTC 로 밀려 하루 전 날짜로 저장된다.
    mutationFn: () => upsertEvent({
      companyId: companyId!, userId: userId!, title: evTitle.trim(),
      startAt: `${evDate}T00:00:00`, allDay: true, isShared: evShared,
    }),
    onSuccess: () => { setEvTitle(""); refresh(); toast("일정에 넣었습니다.", "success"); },
    onError: (e: any) => toast(e?.message || "일정 저장 실패", "error"),
  });

  const addTodo = useMutation({
    mutationFn: () => upsertTodo({
      companyId: companyId!, userId: userId!, title: tdTitle.trim(), dueDate: tdDue || null,
    }),
    onSuccess: () => { setTdTitle(""); setTdDue(""); refresh(); toast("할 일에 넣었습니다.", "success"); },
    onError: (e: any) => toast(e?.message || "할 일 저장 실패", "error"),
  });

  const doneMut = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => toggleTodoDone(id, done),
    onSuccess: refresh,
  });

  const canWrite = !!companyId && !!userId;

  return (
    <div className="chat-sched">
      <div className="chat-sched-modes">
        {([["event", "일정"], ["todo", "할 일"]] as [Mode, string][]).map(([k, label]) => (
          <button key={k} type="button" onClick={() => setMode(k)}
            className={`chat-sched-mode ${mode === k ? "chat-sched-mode-on" : ""}`}>{label}</button>
        ))}
      </div>

      {mode === "event" ? (
        <>
          <div className="chat-sched-add">
            <input value={evTitle} onChange={(e) => setEvTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && evTitle.trim() && canWrite && !addEvent.isPending) addEvent.mutate(); }}
              placeholder="무슨 일정인가요" className="chat-sched-input" />
            <div className="chat-sched-add-row">
              <DateField value={evDate} onChange={(e) => setEvDate(e.target.value)} className="chat-sched-date" />
              <label className="chat-sched-check">
                <input type="checkbox" checked={evShared} onChange={(e) => setEvShared(e.target.checked)} />
                전체 공유
              </label>
              <button type="button" className="chat-sched-go" disabled={!evTitle.trim() || !canWrite || addEvent.isPending}
                onClick={() => addEvent.mutate()}>{addEvent.isPending ? "…" : "추가"}</button>
            </div>
          </div>
          <div className="chat-sched-list">
            {events.length === 0 && <p className="chat-sched-empty">다가오는 일정이 없습니다.</p>}
            {events.map((e) => (
              <div key={e.id} className="chat-sched-row">
                <i className={`chat-sched-dot ${DOT[e.color] || DOT.gray}`} />
                <span className="chat-sched-row-body">
                  <b>{e.title}</b>
                  <em>{String(e.start_at).slice(0, 10)}{e.end_at ? ` ~ ${String(e.end_at).slice(0, 10)}` : ""}{e.is_shared ? " · 전체" : ""}</em>
                </span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <>
          <div className="chat-sched-add">
            <input value={tdTitle} onChange={(e) => setTdTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing && tdTitle.trim() && canWrite && !addTodo.isPending) addTodo.mutate(); }}
              placeholder="무엇을 해야 하나요" className="chat-sched-input" />
            <div className="chat-sched-add-row">
              <DateField value={tdDue} onChange={(e) => setTdDue(e.target.value)} placeholder="기한(선택)" className="chat-sched-date" />
              <button type="button" className="chat-sched-go" disabled={!tdTitle.trim() || !canWrite || addTodo.isPending}
                onClick={() => addTodo.mutate()}>{addTodo.isPending ? "…" : "추가"}</button>
            </div>
          </div>
          <div className="chat-sched-list">
            {todos.length === 0 && <p className="chat-sched-empty">할 일이 없습니다.</p>}
            {(todos as ScheduleTodo[]).map((t) => (
              <label key={t.id} className="chat-sched-row chat-sched-row-todo">
                <input type="checkbox" checked={t.done}
                  onChange={(e) => doneMut.mutate({ id: t.id, done: e.target.checked })} />
                <span className="chat-sched-row-body">
                  <b>{t.title}</b>
                  {t.due_date && <em>기한 {String(t.due_date).slice(0, 10)}</em>}
                </span>
              </label>
            ))}
          </div>
        </>
      )}

      <a href="/schedule" target="_blank" rel="noopener noreferrer" className="chat-sched-more">일정 / 할 일 화면 열기 ↗</a>
    </div>
  );
}
