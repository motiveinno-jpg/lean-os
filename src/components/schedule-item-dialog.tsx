"use client";

// 일정 창 — **보기가 먼저, 고치기는 그 다음** (2026-08-10 사장님 지시:
//   "일정을 클릭하면 일정 내용이 보이는 게 중요한데 수정·완료가 메인으로 보인다").
//
//   일정 메뉴(달력·목록)와 메신저(달력·목록) **네 군데가 이 창 하나**를 쓴다.
//   저장·완료·삭제와 캐시 갱신까지 여기서 끝내므로, 부르는 쪽은 무엇을 열지만 정하면 된다.

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { ScheduleItemEditor, draftFromEvent, type ScheduleDraft } from "@/components/schedule-item-editor";
import {
  upsertEvent, deleteEvent, toggleEventCompleted, formatEventRange,
  VISIBILITY_LABEL, type EventColor, type ScheduleEvent,
} from "@/lib/schedule";

const DOT: Record<EventColor, string> = {
  blue: "bg-blue-500", green: "bg-green-500", red: "bg-red-500",
  amber: "bg-amber-500", violet: "bg-violet-500", gray: "bg-gray-400",
};

/** 무엇을 열지 — 있는 일정이면 보기부터, 새로 만들 때는 곧장 입력 */
export type ScheduleDialogTarget =
  | { mode: "view"; event: ScheduleEvent }
  | { mode: "new"; from?: string; to?: string };

export function ScheduleItemDialog({
  companyId, userId, target, onClose, users, departments,
}: {
  companyId: string | null;
  userId: string | null;
  target: ScheduleDialogTarget;
  onClose: () => void;
  /** 대상 이름을 보기 화면에 풀어 쓸 때 쓴다(없으면 개수만 보여 준다) */
  users?: { id: string; name: string | null; email?: string }[];
  departments?: { name: string }[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [editing, setEditing] = useState<ScheduleDraft | null>(
    target.mode === "new" ? draftFromEvent(null, { from: target.from, to: target.to }) : null,
  );
  //   부르는 쪽에서 다른 일정으로 바꿔 열면 그때마다 처음(보기)으로 되돌린다
  useEffect(() => {
    setEditing(target.mode === "new" ? draftFromEvent(null, { from: target.from, to: target.to }) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [target.mode === "view" ? target.event.id : `${target.from}~${target.to}`]);

  const refresh = () => {
    for (const key of ["schedule-events", "schedule-items", "chat-cal-events", "chat-schedule-events"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const save = useMutation({
    mutationFn: () => {
      const d = editing!;
      const from = d.from, to = d.to || d.from;
      const [a, b] = !from ? ["", ""] : (from <= to ? [from, to] : [to, from]);
      //   ⚠️ 하루 종일 일정은 날짜 문자열 그대로 — toISOString() 은 KST 자정을 UTC 로 밀어 하루 전이 된다
      return upsertEvent({
        id: d.id, companyId: companyId!, userId: userId!,
        title: d.title.trim(), description: d.description.trim() || undefined,
        startAt: a ? `${a}T00:00:00` : null,
        endAt: a && b > a ? `${b}T00:00:00` : null,
        allDay: true, color: d.color,
        visibility: d.visibility, targetUserIds: d.targetUserIds, targetDepartments: d.targetDepartments,
      });
    },
    onSuccess: () => { refresh(); onClose(); toast("저장했습니다.", "success"); },
    onError: (e: any) => toast(e?.message || "저장 실패", "error"),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: () => { refresh(); onClose(); toast("지웠습니다.", "success"); },
    onError: (e: any) => toast(e?.message || "삭제 실패", "error"),
  });

  const done = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => toggleEventCompleted(id, completed),
    onSuccess: () => { refresh(); onClose(); },
    onError: (e: any) => toast(e?.message || "완료 처리 실패", "error"),
  });

  const busy = save.isPending || remove.isPending || done.isPending;

  if (editing) {
    return (
      <ScheduleItemEditor
        companyId={companyId} userId={userId}
        draft={editing} onChange={setEditing}
        onSave={() => save.mutate()}
        onDelete={editing.id ? () => remove.mutate(editing.id!) : undefined}
        onClose={onClose}
        saving={busy} />
    );
  }

  const e = (target as { mode: "view"; event: ScheduleEvent }).event;
  return <ScheduleItemView
    event={e} users={users} departments={departments} busy={busy}
    onEdit={() => setEditing(draftFromEvent(e))}
    onToggleDone={() => done.mutate({ id: e.id, completed: !e.completed })}
    onDelete={e.user_id === userId ? () => remove.mutate(e.id) : undefined}
    onClose={onClose} />;
}

/** 보기 — 일정 내용이 본체다. 수정·완료·삭제는 아래에 작게 둔다. */
function ScheduleItemView({
  event, users, departments, busy, onEdit, onToggleDone, onDelete, onClose,
}: {
  event: ScheduleEvent;
  users?: { id: string; name: string | null; email?: string }[];
  departments?: { name: string }[];
  busy?: boolean;
  onEdit: () => void;
  onToggleDone: () => void;
  onDelete?: () => void;
  onClose: () => void;
}) {
  useModalKeys(true, onClose, onEdit);

  const names = (event.target_user_ids || []).map(
    (id) => users?.find((u) => u.id === id)?.name || users?.find((u) => u.id === id)?.email || "이름 모름",
  );
  const depts = event.target_departments || [];
  const who =
    event.visibility === "company" ? "회사 구성원 모두"
    : event.visibility === "private" ? "나만"
    : event.visibility === "members" ? (names.length ? names.join(" · ") : `구성원 ${event.target_user_ids.length}명`)
    : (depts.length ? depts.join(" · ") : `부서 ${event.target_departments.length}곳`);

  return (
    <div className="sched-view" onClick={onClose}>
      <div className="sched-view-box" onClick={(ev) => ev.stopPropagation()}>
        <header>
          <i className={`sched-view-dot ${DOT[event.color] || DOT.gray}`} />
          <b className={event.completed ? "line-through opacity-60" : ""}>{event.title}</b>
          <button type="button" onClick={onClose} title="닫기">✕</button>
        </header>

        <p className="sched-view-when">
          {event.start_at ? formatEventRange(event) : "날짜 없음"}
          {event.completed && <span className="sched-view-done">완료</span>}
        </p>

        {/*  내용이 본체다 — 적어 둔 설명을 줄바꿈 그대로 보여 준다 */}
        {event.description
          ? <p className="sched-view-desc">{event.description}</p>
          : <p className="sched-view-nodesc">적어 둔 설명이 없습니다.</p>}

        <dl className="sched-view-meta">
          <div><dt>공유 범위</dt><dd>{VISIBILITY_LABEL[event.visibility]} · {who}</dd></div>
        </dl>

        <footer>
          {onDelete && <button type="button" className="sched-view-del" disabled={busy} onClick={onDelete}>삭제</button>}
          <span className="sched-spacer" />
          <button type="button" className="sched-view-act" disabled={busy} onClick={onToggleDone}>
            {event.completed ? "완료 취소" : "완료 처리"}
          </button>
          <button type="button" className="sched-view-act" disabled={busy} onClick={onEdit}>수정</button>
        </footer>
      </div>
    </div>
  );
}
