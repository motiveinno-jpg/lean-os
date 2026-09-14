"use client";

// 일정 창 — **보기가 먼저, 고치기는 그 다음** (
//   "일정을 클릭하면 일정 내용이 보이는 게 중요한데 수정·완료가 메인으로 보인다").
//
//   일정 메뉴(달력·목록)와 메신저(달력·목록) **네 군데가 이 창 하나**를 쓴다.
//   저장·완료·삭제와 캐시 갱신까지 여기서 끝내므로, 부르는 쪽은 무엇을 열지만 정하면 된다.

import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { getCompanyUsers } from "@/lib/queries";
import { resolveSignedUrl } from "@/lib/file-storage";
import { ScheduleItemEditor, draftFromEvent, type ScheduleDraft } from "@/components/schedule-item-editor";
import { appConfirm } from "@/components/global-confirm";
import {
  upsertEvent, deleteEvent, deleteSeries, skipFirstOccurrence, seriesIdOf, dateKeyOf,
  toggleEventCompleted, formatEventRange, canManageScheduleEvent, isVirtualEventId,
  VISIBILITY_LABEL, type EventColor, type ScheduleAttachment, type ScheduleEvent, remindersOf } from "@/lib/schedule";

const DOT: Record<EventColor, string> = {
  blue: "bg-blue-500", green: "bg-green-500", red: "bg-red-500",
  amber: "bg-amber-500", violet: "bg-violet-500", gray: "bg-gray-400",
};

/** 무엇을 열지 · 있는 일정이면 보기부터, 새로 만들 때는 곧장 입력 */
export type ScheduleDialogTarget =
  |  { mode: "view"; event: ScheduleEvent }
  | { mode: "new"; from?: string; to?: string };

export function ScheduleItemDialog({
  companyId, userId, target, onClose,
}: {
  companyId: string | null;
  userId: string | null;
  target: ScheduleDialogTarget;
  onClose: () => void;
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
    for (const key of ["schedule-events", "schedule-items", "chat-cal-events", "chat-schedule-events", "my-todos-open"]) {
      qc.invalidateQueries({ queryKey: [key] });
    }
  };

  const save = useMutation({
    mutationFn: () => {
      if (!companyId || !userId || (target.mode === "view" && !canManageScheduleEvent(target.event, userId))) {
        throw new Error("일정 변경 권한이 없습니다.");
      }
      const d = editing!;
      const from = d.from, to = d.to || d.from;
      const [a, b] = !from ? ["", ""] : (from <= to ? [from, to] : [to, from]);
      //   ⚠️ 하루 종일 일정은 날짜 문자열 그대로 — toISOString() 은 KST 자정을 UTC 로 밀어 하루 전이 된다
      return upsertEvent({
        id: d.id, companyId: companyId!, userId: userId!,
        title: d.title.trim(), description: d.description.trim() || undefined,
        startAt: a ? `${a}T00:00:00+09:00` : null,
        endAt: a && b > a ? `${b}T00:00:00+09:00` : null,
        allDay: true, color: d.color,
        visibility: d.visibility, targetUserIds: d.targetUserIds, targetDepartments: d.targetDepartments,
        attachments: d.attachments,
        //   반복(결정 145). 날짜 없으면 반복도 없음. 반복 일정의 알림은 1차 미지원이라 비운다
        recurrence: a && d.recurFreq ?  { freq: d.recurFreq, ...(d.recurFreq === "weekly" ? { weekday: d.recurWeekday } : {}) } : null,
        reminder: null,
        reminders: a && !d.recurFreq ? d.reminders : [],
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

  //   반복 전체 삭제 — 어느 회차에서 눌러도 원본과 떼어낸 회차까지 전부. 한 번 묻는다.
  const removeAll = useMutation({
    mutationFn: async (id: string) => {
      const ok = await appConfirm("이 반복 일정을 전부 지웁니다. 따로 완료·수정한 회차도 함께 사라집니다.", { danger: true, title: "반복 전체 삭제", confirmLabel: "전체 삭제" });
      if (!ok) throw new Error("__cancel");
      await deleteSeries(id);
    },
    onSuccess: () => { refresh(); onClose(); toast("반복 일정을 전부 지웠습니다.", "success"); },
    onError: (e: any) => { if (e?.message !== "__cancel") toast(e?.message || "삭제 실패", "error"); },
  });
  //   이 날짜만 삭제 — 회차는 예외 날짜로, 원본(첫 회차)도 마찬가지(규칙은 남는다)
  const removeOne = useMutation({
    mutationFn: async (e: ScheduleEvent) => {
      if (isVirtualEventId(e.id)) return deleteEvent(e.id);
      if (e.recurrence?.freq && e.start_at) return skipFirstOccurrence(e.id, dateKeyOf(e.start_at));
      return deleteEvent(e.id);
    },
    onSuccess: () => { refresh(); onClose(); toast("지웠습니다.", "success"); },
    onError: (e: any) => toast(e?.message || "삭제 실패", "error"),
  });
  /** 반복 전체 고치기 — 어느 회차에서 열어도 원본(첫 회차·규칙)을 편집한다 */
  const editAll = (e: ScheduleEvent) => setEditing(draftFromEvent({
    ...e, id: seriesIdOf(e.id),
    start_at: e.recurrence_source?.start_at ?? e.start_at,
    end_at: e.recurrence_source?.end_at ?? e.end_at,
  }));
  /** 이 날짜만 고치기 — 원본(첫 회차)도 회차처럼 다룬다(가상 id 로 열어 떼어낸다) */
  const editOne = (e: ScheduleEvent) => {
    if (!isVirtualEventId(e.id) && e.recurrence?.freq && e.start_at) {
      setEditing(draftFromEvent({ ...e, id: `${e.id}@${dateKeyOf(e.start_at)}` }));
      return;
    }
    setEditing(draftFromEvent(e));
  };

  const busy = save.isPending || remove.isPending || done.isPending || removeAll.isPending || removeOne.isPending;

  if (editing) {
    return (
      <ScheduleItemEditor
        companyId={companyId} userId={userId}
        draft={editing} onChange={setEditing}
        onSave={() => save.mutate()}
        //   수정 창의 삭제 — 회차를 열었으면 그 날짜만, 반복 원본이면 전체(한 번 묻는다), 보통 일정은 바로.
        //   버튼 글자에 무엇을 지우는지 적는다(2026-09-14 사장님: "삭제 누르면 반복 전체가 다 삭제된다").
        onDelete={editing.id
          ? () => {
              if (editing.occurrence) remove.mutate(editing.id!);            // 가상 id → 그 날짜만 건너뛰기
              else if (editing.recurFreq) removeAll.mutate(editing.id!);     // 원본 → 반복 전체(확인)
              else remove.mutate(editing.id!);
            }
          : undefined}
        deleteLabel={editing.id ? (editing.occurrence ? "이 날짜만 지우기" : editing.recurFreq ? "반복 전체 지우기" : "삭제") : undefined}
        onClose={onClose}
        saving={busy} />
    );
  }

  const e = (target as { mode: "view"; event: ScheduleEvent }).event;
  const canManage = canManageScheduleEvent(e, userId);
  const recurring = !!e.recurrence?.freq;
  return <ScheduleItemView
    event={e} companyId={companyId} busy={busy}
    onEdit={canManage ? () => (recurring ? editOne(e) : setEditing(draftFromEvent(e))) : undefined}
    onToggleDone={canManage ? () => done.mutate({ id: e.id, completed: !e.completed }) : undefined}
    onDelete={canManage ? () => (recurring ? removeOne.mutate(e) : remove.mutate(e.id)) : undefined}
    //   반복이면 수정·삭제를 누를 때 "이 날짜만 / 반복 전체" 를 고르게 한다
    series={canManage && recurring ? { onEditAll: () => editAll(e), onDeleteAll: () => removeAll.mutate(e.id) } : undefined}
    onClose={onClose} />;
}



/** 보기 · 일정 내용이 본체다. 수정·완료·삭제는 아래에 작게 둔다. */
function ScheduleItemView({
  event, companyId, busy, onEdit, onToggleDone, onDelete, series, onClose,
}: {
  event: ScheduleEvent;
  companyId: string | null;
  busy?: boolean;
  onEdit?: () => void;
  onToggleDone?: () => void;
  onDelete?: () => void;
  /** 반복 일정이면 "이 날짜만"(onEdit·onDelete) 과 "반복 전체" 를 고르게 한다 */
  series?: { onEditAll: () => void; onDeleteAll: () => void };
  onClose: () => void;
}) {
  //   반복에서 수정·삭제를 누르면 바로 하지 않고 어느 범위인지 먼저 고른다
  const [ask, setAsk] = useState<"edit" | "delete" | null>(null);
  useModalKeys(true, onClose, series ? () => setAsk("edit") : onEdit);

  //   documents 버킷은 비공개 — 누를 때마다 잠깐 쓰는 주소를 새로 받는다
  const openFile = async (f: ScheduleAttachment) => {
    const url = await resolveSignedUrl(f.url, f.name);
    if (!url) return;
    const a = document.createElement("a");
    a.href = url; a.rel = "noopener";
    document.body.appendChild(a); a.click(); a.remove();
  };

  //   공유한 사람 이름을 보여 주려면 회사 사람 목록이 필요하다. 입력 창과 **같은 캐시**를 쓴다.
  //   (2026-08-10: 목록을 안 받아 오던 탓에 이름 대신 '이름 모름' 이 찍혔다)
  const  { data: users = [] } = useQuery({
    queryKey: ["company-users", companyId],
    queryFn: () => getCompanyUsers(companyId!),
    enabled: !!companyId && event.visibility === "members",
    staleTime: 5 * 60_000,
  });

  //   이름을 못 찾은 사람(회사를 떠났다 등)은 **빈칸으로 둔다** — '이름 모름' 을 늘어놓지 않는다
  const names = (event.target_user_ids || [])
    .map((id) => {
      const u = (users as any[]).find((x) => x.id === id);
      return (u?.name || u?.email || "").trim();
    })
    .filter(Boolean);
  const depts = (event.target_departments || []).filter(Boolean);
  //   갈래 이름('구성원'·'부서')은 다시 적지 않는다. **누구에게 공유했는지만** 적는다
  //   . 구성원=사람 이름, 부서=부서명, 전체="전체", 나만="나만".
  //   이름을 하나도 못 찾으면 그때만 갈래 이름으로 되돌린다(빈칸으로 두지 않게).
  const who =
    event.visibility === "company" ? "전체"
    : event.visibility === "private" ? "나만"
    : event.visibility === "members" ? names.join(" · ")
    : depts.join(" · ");

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
          {event.recurrence?.freq && (
            <span title={isVirtualEventId(event.id)
              ? "반복 중 한 회차입니다. 완료·수정·삭제는 이 날짜에만 적용됩니다."
              : "반복의 첫 회차(원본)입니다. 여기서 고치거나 지우면 아직 손대지 않은 회차 전체에 적용됩니다."}> · 🔁 {event.recurrence.freq === "daily" ? "매일" : event.recurrence.freq === "monthly" ? "매월" : `매주 ${["일", "월", "화", "수", "목", "금", "토"][event.recurrence.weekday ?? 0]}요일`}{isVirtualEventId(event.id) ? " · 이 회차만" : " · 원본"}</span>
          )}
          {event.recurrence_parent_id && <span title="반복에서 따로 떼어낸 회차입니다. 이 날짜만 관리됩니다."> · 🔁 따로 관리</span>}
          {remindersOf(event).length > 0 && <span title={remindersOf(event).map((r) => `${r.days_before === 0 ? "당일" : `${r.days_before}일 전`} ${r.time}`).join(" · ")}> · 🔔 알림 {remindersOf(event).length}개</span>}
          {event.completed && <span className="sched-view-done">완료</span>}
        </p>

        {/*  내용이 본체다 — 적어 둔 설명을 줄바꿈 그대로 보여 준다 */}
        {event.description
          ? <p className="sched-view-desc">{event.description}</p>
          : <p className="sched-view-nodesc">적어 둔 설명이 없습니다.</p>}

        {(event.attachments || []).length > 0 && (
          <div className="sched-view-files">
            {(event.attachments || []).map((f, i) => (
              <button key={`${f.url}-${i}`} type="button" onClick={() => openFile(f)} title="열기">📎 {f.name}</button>
            ))}
          </div>
        )}

        <dl className="sched-view-meta">
          <div><dt>공유 범위</dt><dd>{who || VISIBILITY_LABEL[event.visibility]}</dd></div>
        </dl>

        {series && ask ? (
          //   반복: 어느 범위인지 고른다. '이 날짜만' 은 이 회차, '반복 전체' 는 원본과 모든 회차.
          <footer className="sched-view-ask">
            <span className="text-xs text-[var(--text-muted)]">{ask === "edit" ? "무엇을 고칠까요?" : "무엇을 지울까요?"}</span>
            <span className="sched-spacer" />
            <button type="button" className="sched-view-act" disabled={busy} onClick={() => setAsk(null)}>돌아가기</button>
            <button type="button" className={ask === "delete" ? "sched-view-del" : "sched-view-act"} disabled={busy}
              onClick={() => { setAsk(null); (ask === "edit" ? onEdit : onDelete)?.(); }}>
              이 날짜만
            </button>
            <button type="button" className={ask === "delete" ? "sched-view-del" : "sched-view-act"} disabled={busy}
              title={ask === "edit" ? "원본(첫 회차)을 열어 고칩니다. 따로 손대지 않은 회차 전체에 적용됩니다." : "원본과 모든 회차를 지웁니다."}
              onClick={() => { setAsk(null); (ask === "edit" ? series.onEditAll : series.onDeleteAll)(); }}>
              반복 전체
            </button>
          </footer>
        ) : (
          <footer>
            {onDelete && <button type="button" className="sched-view-del" disabled={busy} onClick={() => (series ? setAsk("delete") : onDelete())}>삭제</button>}
            <span className="sched-spacer" />
            {onToggleDone && <button type="button" className="sched-view-act" disabled={busy} onClick={onToggleDone}>
              {event.completed ? "완료 취소" : "완료 처리"}
            </button>}
            {onEdit && <button type="button" className="sched-view-act" disabled={busy} onClick={() => (series ? setAsk("edit") : onEdit())}>수정</button>}
            {!onEdit && <span className="text-xs text-[var(--text-muted)]">공유받은 일정 · 읽기 전용</span>}
          </footer>
        )}
      </div>
    </div>
  );
}
