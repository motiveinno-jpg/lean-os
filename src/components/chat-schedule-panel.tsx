"use client";

// 메신저 안의 '일정' 목록 (2026-08-10 사장님 지시로 통합).
//
//   '할 일' 이라는 구분은 없앴다 — 날짜를 안 넣은 일정일 뿐이다. 그래서 이 패널은
//   **다가오는 일정**과 **날짜 없는 것**을 한 자리에서 보여 준다.
//   줄을 누르면 **일정 내용부터** 보이고 거기서 고친다 — 창은 ScheduleItemDialog 하나를
//   일정 메뉴(달력·목록)와 메신저(달력·목록)가 함께 쓴다.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { ScheduleItemDialog, type ScheduleDialogTarget } from "@/components/schedule-item-dialog";
import { todayKst } from "@/lib/kst";
import {
  getScheduleItems, toggleEventCompleted,
  VISIBILITY_LABEL, type ScheduleEvent, type EventColor,
} from "@/lib/schedule";

const DOT: Record<EventColor, string> = {
  blue: "bg-blue-500", green: "bg-green-500", red: "bg-red-500",
  amber: "bg-amber-500", violet: "bg-violet-500", gray: "bg-gray-400",
};

export function ChatSchedulePanel({ companyId, userId }: { companyId: string | null; userId: string | null }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState<ScheduleDialogTarget | null>(null);

  const { data: items = [] } = useQuery({
    queryKey: ["schedule-items", companyId, userId, false, false],
    queryFn: () => getScheduleItems(companyId!, { userId: userId ?? undefined }),
    enabled: !!companyId,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["schedule-items"] });
    qc.invalidateQueries({ queryKey: ["chat-cal-events"] });
    qc.invalidateQueries({ queryKey: ["schedule-events"] });   // 일정 메뉴도 같이
  };

  const doneMut = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => toggleEventCompleted(id, completed),
    onSuccess: refresh,
  });

  const today = todayKst();
  const list = items as ScheduleEvent[];
  //   지난 일정은 굳이 안 보여 준다 — '앞으로 할 것' 만 본다
  const upcoming = list.filter((e) => e.start_at && String(e.end_at || e.start_at).slice(0, 10) >= today);
  const undated = list.filter((e) => !e.start_at);

  const row = (e: ScheduleEvent) => (
    //   ⚠️ <label> 로 감싸면 제목을 눌러도 안의 체크박스가 켜져 **완료 처리되어 목록에서 사라진다**
    //      (2026-08-10 사장님 제보). 줄은 <div>, 제목은 별도 단추로 둔다.
    <div key={e.id} className="chat-sched-row">
      <input type="checkbox" checked={e.completed} title={e.completed ? "완료 취소" : "완료"}
        onChange={(ev) => doneMut.mutate({ id: e.id, completed: ev.target.checked })} />
      <i className={`chat-sched-dot ${DOT[e.color] || DOT.gray}`} />
      <button type="button" className="chat-sched-row-body" title="눌러서 내용 보기"
        onClick={() => setOpen({ mode: "view", event: e })}>
        <b>{e.title}</b>
        <em>
          {e.start_at ? String(e.start_at).slice(0, 10) : "날짜 없음"}
          {e.end_at ? ` ~ ${String(e.end_at).slice(0, 10)}` : ""}
          {` · ${VISIBILITY_LABEL[e.visibility]}`}
        </em>
      </button>
    </div>
  );

  return (
    <div className="chat-sched">
      {/*  '새로 만들기' 단추는 뺐다 — 옆 달력에서 날짜를 누르면 만들어지므로 겹치는 자리였다
           (2026-08-10 사장님 지시) */}
      <p className="chat-sched-tip">오른쪽 달력에서 <b>날짜를 누르거나 끌면</b> 그 날짜로 넣습니다.</p>

      <div className="chat-sched-list">
        {upcoming.length === 0 && undated.length === 0 && <p className="chat-sched-empty">일정이 없습니다.</p>}
        {upcoming.map(row)}
        {undated.length > 0 && (
          <p className="chat-sched-sub">날짜 없는 것 {undated.length}</p>
        )}
        {undated.map(row)}
      </div>

      <a href="/schedule" target="_blank" rel="noopener noreferrer" className="chat-sched-more">일정 화면 열기 ↗</a>

      {open && (
        <ScheduleItemDialog companyId={companyId} userId={userId} target={open} onClose={() => setOpen(null)} />
      )}
    </div>
  );
}
