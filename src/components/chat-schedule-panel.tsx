"use client";

// 메신저 안의 '일정' 목록 (2026-08-10 사장님 지시로 통합).
//
//   '할 일' 이라는 구분은 없앴다 — 날짜를 안 넣은 일정일 뿐이다. 그래서 이 패널은
//   **다가오는 일정**과 **날짜 없는 것**을 한 자리에서 보여 준다.
//   넣고 고치는 것은 오른쪽 달력(날짜 클릭)과 같은 부품(ScheduleItemEditor)이 맡는다 —
//   일정 메뉴와 메신저가 같은 화면을 쓴다는 원칙.

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useToast } from "@/components/toast";
import { ScheduleItemEditor, draftFromEvent, type ScheduleDraft } from "@/components/schedule-item-editor";
import { todayKst } from "@/lib/kst";
import {
  getScheduleItems, upsertEvent, deleteEvent, toggleEventCompleted,
  VISIBILITY_LABEL, type ScheduleEvent, type EventColor,
} from "@/lib/schedule";

const DOT: Record<EventColor, string> = {
  blue: "bg-blue-500", green: "bg-green-500", red: "bg-red-500",
  amber: "bg-amber-500", violet: "bg-violet-500", gray: "bg-gray-400",
};

export function ChatSchedulePanel({ companyId, userId }: { companyId: string | null; userId: string | null }) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);

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

  const save = useMutation({
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
    onSuccess: () => { setDraft(null); refresh(); toast("저장했습니다.", "success"); },
    onError: (e: any) => toast(e?.message || "저장 실패", "error"),
  });
  const remove = useMutation({
    mutationFn: () => deleteEvent(draft!.id!),
    onSuccess: () => { setDraft(null); refresh(); toast("지웠습니다.", "success"); },
  });
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
      <button type="button" className="chat-sched-row-body" title="눌러서 고치기"
        onClick={() => setDraft(draftFromEvent(e))}>
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
