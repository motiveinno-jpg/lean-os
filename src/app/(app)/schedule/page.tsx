"use client";

import { todayKst } from "@/lib/kst";
import { Ico } from "@/components/ui-icon";
import { useEffect, useMemo, useState } from "react";
import { DateField } from "@/components/date-field";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import {
  getMonthEvents,
  getScheduleItems,
  upsertEvent,
  deleteEvent,
  toggleEventCompleted,
  EVENT_COLOR_BG,
  VISIBILITY_LABEL,
  eventDateKeys,
  isMultiDayEvent,
  segmentRole,
  formatEventRange,
  type ScheduleEvent,
  type ScheduleScope,
} from "@/lib/schedule";
import { ScheduleItemEditor, draftFromEvent, type ScheduleDraft } from "@/components/schedule-item-editor";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { useModalKeys } from "@/hooks/use-modal-keys";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getDeals } from "@/lib/queries";
import { getMyProjectTasks } from "@/lib/my-project-tasks";

type Tab = "calendar" | "list";

export default function SchedulePage() {
  const { toast } = useToast();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("calendar");

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) { setCompanyId(u.company_id); setUserId(u.id); }
    });
  }, []);

  return (
    <div className="schedule-page">
      {/* Tabs — 라운드6.5: 타이틀 제거, 필형 탭만 스티키 툴바로 */}
      <div className="schedule-tabbar page-sticky-header">
        <div className="seg-bar">
          {([["calendar", "달력"], ["list", "목록"]] as [Tab, string][]).map(([k, label]) => (
            <button
              key={k}
              onClick={() => setTab(k)}
              className={`seg-item ${tab === k ? "seg-item-active" : ""}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === "calendar" && companyId && userId && (
        <CalendarTab companyId={companyId} userId={userId} toast={toast} />
      )}
      {tab === "list" && companyId && userId && (
        <ScheduleListTab companyId={companyId} userId={userId} toast={toast} />
      )}
    </div>
  );
}

// ─── Calendar ──────────────────────────────────────────────────────────

function CalendarTab({ companyId, userId, toast }: { companyId: string; userId: string; toast: any }) {
  const queryClient = useQueryClient();
  const { confirm, confirmElement } = useConfirm();
  const today = new Date();
  const [view, setView] = useState({ year: today.getFullYear(), monthIdx0: today.getMonth() });
  const [scope, setScope] = useState<ScheduleScope>("all");
  const [editingEvent, setEditingEvent] = useState<ScheduleDraft | null>(null);
  // R5: 일정 클릭 시 즉시 완료 토글 ❌ → 수정/완료 선택 팝업
  const [actionEvent, setActionEvent] = useState<ScheduleEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  // ESC 닫기 · Enter 확인(완료/완료취소 — 팝업 내 유일한 solid 주 액션 버튼)
  useModalKeys(!!actionEvent, () => setActionEvent(null), actionEvent
    ? () => { toggleDoneMut.mutate({ id: actionEvent.id, completed: !actionEvent.completed }); setActionEvent(null); }
    : undefined);

  const { data: events = [], isLoading } = useQuery({
    queryKey: ["schedule-events", companyId, view.year, view.monthIdx0, scope, userId],
    queryFn: () => getMonthEvents(companyId, view.year, view.monthIdx0, { scope, userId }),
    enabled: !!companyId,
  });

  const grid = useMemo(() => buildMonthGrid(view.year, view.monthIdx0), [view.year, view.monthIdx0]);

  const eventsByDate = useMemo(() => {
    // 기간 일정은 시작~종료 사이 모든 날짜 칸에 노출 (단일 일정은 시작일 1칸).
    const map = new Map<string, ScheduleEvent[]>();
    for (const e of events) {
      for (const dateKey of eventDateKeys(e)) {
        if (!map.has(dateKey)) map.set(dateKey, []);
        map.get(dateKey)!.push(e);
      }
    }
    return map;
  }, [events]);

  const saveMut = useMutation({
    mutationFn: async (d: ScheduleDraft) => {
      const from = d.from, to = d.to || d.from;
      const [a, b] = !from ? ["", ""] : (from <= to ? [from, to] : [to, from]);
      return upsertEvent({
        id: d.id, companyId, userId,
        title: d.title.trim(), description: d.description.trim() || undefined,
        startAt: a ? `${a}T00:00:00` : null,
        endAt: a && b > a ? `${b}T00:00:00` : null,
        allDay: true, color: d.color,
        visibility: d.visibility, targetUserIds: d.targetUserIds, targetDepartments: d.targetDepartments,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule-events"] });
      queryClient.invalidateQueries({ queryKey: ["schedule-items"] });
      setEditingEvent(null);
      toast("일정이 저장되었습니다", "success");
    },
    onError: (e: any) => toast(`저장 실패: ${e.message}`, "error"),
  });

  const toggleDoneMut = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => toggleEventCompleted(id, completed),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedule-events"] }),
    onError: (e: any) => toast(`완료 처리 실패: ${e.message}`, "error"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule-events"] });
      setEditingEvent(null);
      toast("일정이 삭제되었습니다", "success");
    },
    onError: (e: any) => toast(`삭제 실패: ${e.message}`, "error"),
  });

  const prevMonth = () => setView(({ year, monthIdx0 }) => {
    if (monthIdx0 === 0) return { year: year - 1, monthIdx0: 11 };
    return { year, monthIdx0: monthIdx0 - 1 };
  });
  const nextMonth = () => setView(({ year, monthIdx0 }) => {
    if (monthIdx0 === 11) return { year: year + 1, monthIdx0: 0 };
    return { year, monthIdx0: monthIdx0 + 1 };
  });
  const goToday = () => setView({ year: today.getFullYear(), monthIdx0: today.getMonth() });

  const openAdd = (dateStr: string) => {
    setSelectedDate(dateStr);
    //   공개 범위는 기본이 '나만' — 넓히는 것은 사람이 고른다(2026-08-10 사장님 결정)
    setEditingEvent(draftFromEvent(null, { from: dateStr, to: dateStr }));
  };

  return (
    <div className="schedule-calendar-tab">
      {/* Header */}
      <div className="schedule-calendar-header">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="btn-ghost btn-sm">‹</button>
          <div className="text-sm font-bold min-w-[110px] text-center">
            {view.year}년 {view.monthIdx0 + 1}월
          </div>
          <button onClick={nextMonth} className="btn-ghost btn-sm">›</button>
          <button onClick={goToday} className="btn-ghost btn-sm ml-1">오늘</button>
        </div>
        <div className="flex items-center gap-2">
          {/* 보기 전환 — 무엇이 보이는지는 공개 범위(RLS)가 정한다. 여기서는 내 것만 좁혀 볼 뿐 */}
          <div className="seg-bar">
            {([["all", "전체"], ["mine", "내 것만"]] as [ScheduleScope, string][]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setScope(k)}
                className={`seg-item ${scope === k ? "seg-item-active" : ""}`}
                title={k === "all" ? "내가 볼 수 있는 일정 전부" : "내가 만든 일정만"}
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => openAdd(toLocalDateStr(today))}
            className="btn-primary"
          >+ 일정 추가</button>
        </div>
      </div>

      {/* 현재 보기 안내 */}
      <p className="caption">
        {scope === "all"
          ? "내가 볼 수 있는 일정 전부 — 나만 보는 일정, 나에게 공유된 일정, 전체 공개 일정."
          : "내가 만든 일정만."}
      </p>

      {/* Calendar Grid */}
      <div className="schedule-calendar-grid glass-card">
        {/* Weekday header */}
        <div className="schedule-weekday-header">
          {["일", "월", "화", "수", "목", "금", "토"].map((w, i) => (
            <div key={w} className={`px-2 py-2 text-[10px] font-bold text-center ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-[var(--text-dim)]"}`}>
              {w}
            </div>
          ))}
        </div>
        {/* Cells */}
        <div className="schedule-cells-grid">
          {grid.map((cell, i) => {
            const dateStr = toLocalDateStr(cell.date);
            const cellEvents = eventsByDate.get(dateStr) || [];
            const isToday = dateStr === toLocalDateStr(today);
            const dow = cell.date.getDay();
            return (
              <button
                key={i}
                onClick={() => openAdd(dateStr)}
                className={`schedule-day-cell ${
                  !cell.inMonth ? "bg-[var(--bg)] opacity-50" : ""
                } ${isToday ? "ring-1 ring-inset ring-[var(--primary)]" : ""}`}
              >
                <div className={`text-[11px] font-semibold ${
                  isToday ? "text-[var(--primary)]" :
                  dow === 0 ? "text-red-400" :
                  dow === 6 ? "text-blue-400" :
                  "text-[var(--text)]"
                }`}>
                  {cell.date.getDate()}
                </div>
                <div className="mt-1 space-y-0.5">
                  {cellEvents.slice(0, 3).map((e) => {
                    const role = segmentRole(e, dateStr);
                    const multi = role !== "single";
                    // 기간 일정 막대: 시작칸은 좌측 둥글게+라벨, 중간은 직각+제목생략, 끝칸은 우측 둥글게
                    const barShape = !multi
                      ? "rounded"
                      : role === "start"
                        ? "rounded-l rounded-r-none -mr-1.5"
                        : role === "end"
                          ? "rounded-r rounded-l-none -ml-1.5"
                          : "rounded-none -mx-1.5";
                    // 막대 본문에 표시할 텍스트: 시작칸/단일은 제목, 중간·끝칸은 비움(연속 막대 느낌)
                    const showLabel = role === "single" || role === "start";
                    return (
                      <div
                        key={`${e.id}-${dateStr}`}
                        onClick={(ev) => { ev.stopPropagation(); setActionEvent(e); }}
                        className={`group/ev flex items-center gap-1 text-[9px] px-1.5 py-0.5 border ${barShape} ${EVENT_COLOR_BG[e.color]} cursor-pointer ${e.completed ? "opacity-50" : ""}`}
                        title={
                          multi
                            ? `${e.title} (${formatEventRange(e)}) · 클릭하면 수정/완료 선택`
                            : "클릭하면 수정/완료 선택"
                        }
                      >
                        {showLabel ? (
                          <span className={`flex-1 truncate ${e.completed ? "line-through" : ""}`}>
                            {/*  누가 보는 일정인지 한 글자로 — 나만(🙋) / 좁게 공유(👥) / 전체(🏢) */}
                            <span className="mr-0.5 opacity-70">
                              {e.visibility === "company" ? "🏢" : e.visibility === "private" ? "🙋" : "👥"}
                            </span>
                            {e.title}
                            {multi && (
                              <span className="ml-1 opacity-70 font-normal">{formatEventRange(e)}</span>
                            )}
                          </span>
                        ) : (
                          // 중간/끝 칸: 막대만 이어지도록 빈 공간 유지
                          <span className="flex-1 truncate opacity-0">·</span>
                        )}
                        {showLabel && (
                          <button
                            onClick={(ev) => { ev.stopPropagation(); setEditingEvent(draftFromEvent(e)); }}
                            className="opacity-0 group-hover/ev:opacity-100 shrink-0 px-0.5 text-[var(--text-dim)] hover:text-[var(--text)] transition"
                            title="수정"
                          >
                            <Ico e="✎" />
                          </button>
                        )}
                      </div>
                    );
                  })}
                  {cellEvents.length > 3 && (
                    <div className="text-[9px] text-[var(--text-dim)] px-1.5">+{cellEvents.length - 3}</div>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {isLoading && <div className="text-xs text-[var(--text-dim)]">불러오는 중...</div>}

      {editingEvent && (
        <ScheduleItemEditor
          companyId={companyId} userId={userId}
          draft={editingEvent}
          onChange={setEditingEvent}
          onSave={() => saveMut.mutate(editingEvent)}
          onDelete={editingEvent.id ? async () => {
            const { ok } = await confirm({ title: "일정 삭제", desc: "일정을 삭제하시겠습니까?", danger: true });
            if (ok) deleteMut.mutate(editingEvent.id!);
          } : undefined}
          onClose={() => setEditingEvent(null)}
          saving={saveMut.isPending}
        />
      )}

      {/* R5: 일정 클릭 → 수정/완료 선택 팝업 (즉시 완료 토글 방지) */}
      {actionEvent && (
        <div
          className="schedule-event-action-popup fixed inset-0"
          onClick={() => setActionEvent(null)}
        >
          <div
            className="glass-card w-full max-w-xs shadow-xl p-5"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="text-sm font-bold mb-1 truncate">{actionEvent.title}</div>
            <div className="text-[11px] text-[var(--text-muted)] mb-4">{formatEventRange(actionEvent)}</div>
            <div className="flex flex-col gap-2">
              <button
                onClick={() => { const ev = actionEvent; setActionEvent(null); setEditingEvent(draftFromEvent(ev)); }}
                className="w-full px-4 py-2.5 rounded-xl text-xs font-semibold border border-[var(--border)] hover:bg-[var(--bg-surface)] transition"
              >
                <Ico e="✎" /> 수정
              </button>
              <button
                onClick={() => { toggleDoneMut.mutate({ id: actionEvent.id, completed: !actionEvent.completed }); setActionEvent(null); }}
                disabled={toggleDoneMut.isPending}
                className="w-full btn-primary btn-sm"
              >
                {actionEvent.completed ? "↩ 완료 취소" : "✓ 완료 처리"}
              </button>
              <button
                onClick={() => setActionEvent(null)}
                className="w-full px-4 py-2 rounded-xl text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-surface)] transition"
              >
                취소
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmElement}
    </div>
  );
}

// ─── 목록 — 날짜 있는 것과 없는 것을 한 자리에서 (2026-08-10 통합) ──────────
//   예전 '할 일' 탭 자리다. '할 일' 이라는 구분은 없앴다 — 날짜를 안 넣은 일정일 뿐이다.

function ScheduleListTab({ companyId, userId, toast }: { companyId: string; userId: string; toast: any }) {
  const queryClient = useQueryClient();
  const { confirm, confirmElement } = useConfirm();
  const [showDone, setShowDone] = useState(false);
  const [mineOnly, setMineOnly] = useState(false);
  const [draft, setDraft] = useState<ScheduleDraft | null>(null);

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["schedule-items", companyId, userId, showDone, mineOnly],
    queryFn: () => getScheduleItems(companyId, { includeDone: showDone, mineOnly, userId }),
    enabled: !!companyId,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["schedule-items"] });
    queryClient.invalidateQueries({ queryKey: ["schedule-events"] });
    queryClient.invalidateQueries({ queryKey: ["chat-cal-events"] });
    queryClient.invalidateQueries({ queryKey: ["chat-schedule-events"] });
  };

  const saveMut = useMutation({
    mutationFn: () => {
      const d = draft!;
      const from = d.from, to = d.to || d.from;
      const [a, b] = !from ? ["", ""] : (from <= to ? [from, to] : [to, from]);
      return upsertEvent({
        id: d.id, companyId, userId,
        title: d.title.trim(), description: d.description.trim() || undefined,
        startAt: a ? `${a}T00:00:00` : null,
        endAt: a && b > a ? `${b}T00:00:00` : null,
        allDay: true, color: d.color,
        visibility: d.visibility, targetUserIds: d.targetUserIds, targetDepartments: d.targetDepartments,
      });
    },
    onSuccess: () => { setDraft(null); refresh(); toast("저장되었습니다", "success"); },
    onError: (e: any) => toast(`저장 실패: ${e.message}`, "error"),
  });

  const doneMut = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => toggleEventCompleted(id, completed),
    onSuccess: refresh,
  });

  const delMut = useMutation({
    mutationFn: (id: string) => deleteEvent(id),
    onSuccess: () => { setDraft(null); refresh(); toast("삭제되었습니다", "success"); },
    onError: (e: any) => toast(`삭제 실패: ${e.message}`, "error"),
  });

  const dated = items.filter((i) => !!i.start_at);
  const undated = items.filter((i) => !i.start_at);

  const row = (e: ScheduleEvent) => (
    <div key={e.id} className="sched-list-row">
      <input type="checkbox" checked={e.completed}
        onChange={(ev) => doneMut.mutate({ id: e.id, completed: ev.target.checked })}
        title={e.completed ? "완료 취소" : "완료"} />
      <button type="button" className="sched-list-main" onClick={() => setDraft(draftFromEvent(e))}>
        <b className={e.completed ? "line-through opacity-60" : ""}>{e.title}</b>
        {e.description && <i>{e.description}</i>}
      </button>
      <span className="sched-list-meta">
        {e.start_at && <em>{formatEventRange(e)}</em>}
        <span className="sched-list-vis">{VISIBILITY_LABEL[e.visibility]}</span>
      </span>
    </div>
  );

  return (
    <div className="sched-list-tab">
      <div className="sched-list-bar">
        <button type="button" className="btn-primary"
          onClick={() => setDraft(draftFromEvent(null))}>+ 새로 만들기</button>
        <span className="sched-spacer" />
        <label className="sched-list-check">
          <input type="checkbox" checked={mineOnly} onChange={(e) => setMineOnly(e.target.checked)} /> 내 것만
        </label>
        <label className="sched-list-check">
          <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} /> 완료 포함
        </label>
      </div>

      {isLoading && <p className="caption">불러오는 중…</p>}

      <section className="sched-list-group">
        <b>날짜 있는 일정 <em>{dated.length}</em></b>
        {dated.length === 0 ? <p className="caption">없습니다.</p> : dated.map(row)}
      </section>

      <section className="sched-list-group">
        <b>날짜 없는 것 <em>{undated.length}</em></b>
        <p className="caption">언제 할지 아직 안 정한 일입니다. 날짜를 넣으면 달력에도 뜹니다.</p>
        {undated.map(row)}
      </section>

      {draft && (
        <ScheduleItemEditor
          companyId={companyId} userId={userId}
          draft={draft} onChange={setDraft}
          onSave={() => saveMut.mutate()}
          onDelete={draft.id ? async () => {
            const { ok } = await confirm({ title: "삭제", desc: "이 항목을 삭제하시겠습니까?", danger: true });
            if (ok) delMut.mutate(draft.id!);
          } : undefined}
          onClose={() => setDraft(null)}
          saving={saveMut.isPending || delMut.isPending} />
      )}
      {confirmElement}
    </div>
  );
}


// ─── Helpers ────────────────────────────────────────────────────────────

function toLocalDateStr(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function buildMonthGrid(year: number, monthIdx0: number): { date: Date; inMonth: boolean }[] {
  // 7 columns × 6 rows = 42 cells, Sunday-first.
  const firstDay = new Date(year, monthIdx0, 1);
  const startDow = firstDay.getDay();
  const cells: { date: Date; inMonth: boolean }[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, monthIdx0, i - startDow + 1);
    cells.push({ date: d, inMonth: d.getMonth() === monthIdx0 });
  }
  return cells;
}
