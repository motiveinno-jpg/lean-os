"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import {
  getMonthEvents,
  upsertEvent,
  deleteEvent,
  toggleEventCompleted,
  getTodos,
  upsertTodo,
  toggleTodoDone,
  deleteTodo,
  EVENT_COLOR_BG,
  PRIORITY_LABEL,
  eventDateKeys,
  isMultiDayEvent,
  segmentRole,
  formatEventRange,
  type ScheduleEvent,
  type ScheduleTodo,
  type EventColor,
  type ScheduleScope,
} from "@/lib/schedule";
import { useToast } from "@/components/toast";

type Tab = "calendar" | "todo";

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
    <div className="space-y-4 mx-auto">
      <div className="page-sticky-header flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-extrabold">일정</h1>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">캘린더 + 투두 — 회사 공유 일정과 개인 할 일 관리</p>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--bg-surface)] p-1 rounded-xl w-fit">
        {([["calendar", "📅 캘린더"], ["todo", "✓ 할 일"]] as [Tab, string][]).map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={`px-4 py-2 rounded-lg text-xs font-semibold transition ${
              tab === k
                ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "calendar" && companyId && userId && (
        <CalendarTab companyId={companyId} userId={userId} toast={toast} />
      )}
      {tab === "todo" && companyId && userId && (
        <TodoTab companyId={companyId} userId={userId} toast={toast} />
      )}
    </div>
  );
}

// ─── Calendar ──────────────────────────────────────────────────────────

function CalendarTab({ companyId, userId, toast }: { companyId: string; userId: string; toast: any }) {
  const queryClient = useQueryClient();
  const today = new Date();
  const [view, setView] = useState({ year: today.getFullYear(), monthIdx0: today.getMonth() });
  const [scope, setScope] = useState<ScheduleScope>("shared");
  const [editingEvent, setEditingEvent] = useState<Partial<ScheduleEvent> | null>(null);
  // R5: 일정 클릭 시 즉시 완료 토글 ❌ → 수정/완료 선택 팝업
  const [actionEvent, setActionEvent] = useState<ScheduleEvent | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

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
    mutationFn: async (payload: any) => {
      return upsertEvent({
        id: payload.id,
        companyId,
        userId,
        title: payload.title,
        description: payload.description,
        startAt: payload.startAt,
        endAt: payload.endAt,
        allDay: payload.allDay,
        color: payload.color,
        isShared: payload.isShared,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule-events"] });
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
    setEditingEvent({
      title: "",
      description: "",
      start_at: `${dateStr}T09:00`,
      end_at: null,
      all_day: true,
      color: "blue",
      // 현재 보고 있는 탭 기준으로 기본 공유범위 결정 (전체공유 탭 → 공유, 개인 탭 → 개인)
      is_shared: scope === "shared",
    });
  };

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div className="flex items-center gap-2">
          <button onClick={prevMonth} className="px-2 py-1.5 text-xs bg-[var(--bg-surface)] rounded-lg hover:bg-[var(--bg)]">‹</button>
          <div className="text-base font-bold min-w-[110px] text-center">
            {view.year}년 {view.monthIdx0 + 1}월
          </div>
          <button onClick={nextMonth} className="px-2 py-1.5 text-xs bg-[var(--bg-surface)] rounded-lg hover:bg-[var(--bg)]">›</button>
          <button onClick={goToday} className="ml-1 px-2 py-1.5 text-[10px] bg-[var(--bg-surface)] rounded-lg hover:bg-[var(--bg)] text-[var(--text-muted)]">오늘</button>
        </div>
        <div className="flex items-center gap-2">
          {/* 전체공유 / 개인 보기 전환 */}
          <div className="flex gap-1 bg-[var(--bg-surface)] p-1 rounded-xl">
            {/* v4 S1: 3 모드 — 전체공유 / 개인 / 통합(both) */}
            {([
              ["shared", "🏢 전체공유"],
              ["personal", "🙋 개인"],
              ["both", "🪟 통합"],
            ] as [ScheduleScope, string][]).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setScope(k)}
                className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition ${
                  scope === k
                    ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
                title={
                  k === "shared"
                    ? "회사 전 구성원이 함께 보는 일정"
                    : k === "personal"
                      ? "나만 보이는 개인 일정"
                      : "전체공유 + 본인 개인 일정 함께 보기"
                }
              >
                {label}
              </button>
            ))}
          </div>
          <button
            onClick={() => openAdd(toLocalDateStr(today))}
            className="px-3 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-xs font-semibold transition"
          >+ 일정 추가</button>
        </div>
      </div>

      {/* 현재 보기 안내 */}
      <p className="caption">
        {scope === "shared"
          ? "🏢 전체공유 일정 — 회사 모든 구성원에게 보입니다."
          : scope === "personal"
            ? "🙋 개인 일정 — 본인에게만 보입니다 (다른 직원에게 노출되지 않음)."
            : "🪟 통합 보기 — 🏢 전체공유와 🙋 본인 개인 일정을 함께 표시합니다 (이벤트 좌측 아이콘으로 구분)."}
      </p>

      {/* Calendar Grid */}
      <div className="glass-card overflow-hidden">
        {/* Weekday header */}
        <div className="grid grid-cols-7 border-b border-[var(--border)] bg-[var(--bg-surface)]">
          {["일", "월", "화", "수", "목", "금", "토"].map((w, i) => (
            <div key={w} className={`px-2 py-2 text-[10px] font-bold text-center ${i === 0 ? "text-red-400" : i === 6 ? "text-blue-400" : "text-[var(--text-dim)]"}`}>
              {w}
            </div>
          ))}
        </div>
        {/* Cells */}
        <div className="grid grid-cols-7">
          {grid.map((cell, i) => {
            const dateStr = toLocalDateStr(cell.date);
            const cellEvents = eventsByDate.get(dateStr) || [];
            const isToday = dateStr === toLocalDateStr(today);
            const dow = cell.date.getDay();
            return (
              <button
                key={i}
                onClick={() => openAdd(dateStr)}
                className={`min-h-[88px] p-1.5 border-r border-b border-[var(--border)]/50 text-left transition hover:bg-[var(--bg-surface)] ${
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
                            {/* v4 S1: 통합 모드일 때 공유/개인 구분 아이콘 prefix */}
                            {scope === "both" && (
                              <span className="mr-0.5 opacity-70">{e.is_shared ? "🏢" : "🙋"}</span>
                            )}
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
                            onClick={(ev) => { ev.stopPropagation(); setEditingEvent(e); }}
                            className="opacity-0 group-hover/ev:opacity-100 shrink-0 px-0.5 text-[var(--text-dim)] hover:text-[var(--text)] transition"
                            title="수정"
                          >
                            ✎
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
        <EventModal
          event={editingEvent}
          onClose={() => setEditingEvent(null)}
          onSave={(payload) => saveMut.mutate(payload)}
          onDelete={editingEvent.id ? () => {
            if (confirm("일정을 삭제하시겠습니까?")) deleteMut.mutate(editingEvent.id!);
          } : undefined}
          saving={saveMut.isPending}
        />
      )}

      {/* R5: 일정 클릭 → 수정/완료 선택 팝업 (즉시 완료 토글 방지) */}
      {actionEvent && (
        <div
          className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4"
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
                onClick={() => { const ev = actionEvent; setActionEvent(null); setEditingEvent(ev); }}
                className="w-full px-4 py-2.5 rounded-xl text-xs font-semibold border border-[var(--border)] hover:bg-[var(--bg-surface)] transition"
              >
                ✎ 수정
              </button>
              <button
                onClick={() => { toggleDoneMut.mutate({ id: actionEvent.id, completed: !actionEvent.completed }); setActionEvent(null); }}
                disabled={toggleDoneMut.isPending}
                className="w-full px-4 py-2.5 rounded-xl text-xs font-semibold bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition disabled:opacity-50"
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
    </div>
  );
}

function EventModal({
  event, onClose, onSave, onDelete, saving,
}: {
  event: Partial<ScheduleEvent>;
  onClose: () => void;
  onSave: (payload: any) => void;
  onDelete?: () => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    id: event.id || "",
    title: event.title || "",
    description: event.description || "",
    startAt: (event.start_at || "").slice(0, 16),
    endAt: event.end_at ? event.end_at.slice(0, 16) : "",
    allDay: event.all_day ?? true,
    color: (event.color || "blue") as EventColor,
    isShared: event.is_shared ?? false,
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // 종료가 시작보다 빠르면 막는다 (기간 일정 오입력 방지). 종료 비우면 단일 일정.
  const dateError = (() => {
    if (!form.endAt) return null;
    const s = form.startAt.slice(0, 16);
    const e = form.endAt.slice(0, 16);
    if (!s || !e) return null;
    return e < s ? "종료가 시작보다 빠릅니다" : null;
  })();

  // 라이브 미리보기: "5/12~5/13" 또는 단일 "5/12"
  const rangePreview = (() => {
    if (!form.startAt) return "";
    const fmt = (k: string) => {
      const [, m, d] = k.split("-");
      return m && d ? `${Number(m)}/${Number(d)}` : "";
    };
    const sKey = form.startAt.slice(0, 10);
    if (!form.endAt) return fmt(sKey);
    const eKey = form.endAt.slice(0, 10);
    if (eKey <= sKey) return fmt(sKey);
    return `${fmt(sKey)}~${fmt(eKey)}`;
  })();

  const submit = () => {
    if (!form.title.trim() || dateError) return;
    onSave({
      id: form.id || undefined,
      title: form.title.trim(),
      description: form.description || undefined,
      startAt: form.allDay ? `${form.startAt.slice(0, 10)}T00:00:00` : new Date(form.startAt).toISOString(),
      endAt: form.endAt ? new Date(form.endAt).toISOString() : undefined,
      allDay: form.allDay,
      color: form.color,
      isShared: form.isShared,
    });
  };

  const colorOptions: EventColor[] = ["blue", "green", "red", "amber", "violet", "gray"];

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-start sm:items-center justify-center p-4 overflow-y-auto" onClick={onClose}>
      <div className="glass-card w-full max-w-md my-8 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold">{form.id ? "일정 수정" : "일정 추가"}</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]" aria-label="닫기">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[10px] text-[var(--text-muted)] mb-1">제목 *</label>
            <input
              autoFocus
              value={form.title}
              onChange={(e) => setForm({ ...form, title: e.target.value })}
              onKeyDown={(e) => { if (e.key === "Enter" && form.title.trim()) submit(); }}
              placeholder="예: 미팅, 마감, 출장"
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-[10px] text-[var(--text-muted)] mb-1">설명</label>
            <textarea
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              rows={2}
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={form.allDay} onChange={(e) => setForm({ ...form, allDay: e.target.checked })} className="accent-[var(--primary)]" />
            <span className="text-[var(--text-muted)]">하루 종일</span>
          </label>
          <div>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="block text-[10px] text-[var(--text-muted)] mb-1">시작일</label>
                <input
                  type={form.allDay ? "date" : "datetime-local"}
                  value={form.allDay ? form.startAt.slice(0, 10) : form.startAt}
                  onChange={(e) => setForm({ ...form, startAt: e.target.value + (form.allDay ? "T00:00" : "") })}
                  className="w-full px-2 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
                />
              </div>
              <div>
                <label className="block text-[10px] text-[var(--text-muted)] mb-1">종료일 (기간일정만)</label>
                <input
                  type={form.allDay ? "date" : "datetime-local"}
                  min={form.allDay ? form.startAt.slice(0, 10) : form.startAt}
                  value={form.endAt ? (form.allDay ? form.endAt.slice(0, 10) : form.endAt) : ""}
                  onChange={(e) => setForm({ ...form, endAt: e.target.value + (form.allDay && e.target.value ? "T23:59" : "") })}
                  className="w-full px-2 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs"
                />
              </div>
            </div>
            <div className="flex items-center justify-between mt-1.5">
              <p className="text-[9px] text-[var(--text-dim)]">
                여러 날 일정은 종료일을 지정하세요 (예: 12~13일 예비군). 비우면 하루 일정.
              </p>
              {form.endAt && (
                <button
                  type="button"
                  onClick={() => setForm({ ...form, endAt: "" })}
                  className="text-[9px] text-[var(--text-muted)] hover:text-[var(--text)] shrink-0 ml-2"
                >
                  종료일 지우기
                </button>
              )}
            </div>
            {dateError ? (
              <p className="text-[10px] text-red-400 mt-1">⚠ {dateError}</p>
            ) : rangePreview ? (
              <p className="text-[10px] text-[var(--text-muted)] mt-1">
                일정 기간: <span className="font-semibold text-[var(--text)]">{rangePreview}</span>
                {form.endAt && form.endAt.slice(0, 10) > form.startAt.slice(0, 10) ? " (기간 일정)" : " (하루 일정)"}
              </p>
            ) : null}
          </div>
          <div>
            <label className="block text-[10px] text-[var(--text-muted)] mb-1">색상</label>
            <div className="flex gap-1.5">
              {colorOptions.map((c) => (
                <button
                  key={c}
                  onClick={() => setForm({ ...form, color: c })}
                  className={`w-7 h-7 rounded-lg border-2 ${EVENT_COLOR_BG[c]} ${form.color === c ? "ring-2 ring-offset-1 ring-[var(--primary)]" : "opacity-60 hover:opacity-100"}`}
                  aria-label={c}
                />
              ))}
            </div>
          </div>
          <label className="flex items-center gap-2 text-xs cursor-pointer">
            <input type="checkbox" checked={form.isShared} onChange={(e) => setForm({ ...form, isShared: e.target.checked })} className="accent-[var(--primary)]" />
            <span className="text-[var(--text-muted)]">회사 전체 공유 (다른 직원도 이 일정 봄)</span>
          </label>
        </div>
        <div className="px-5 py-4 border-t border-[var(--border)] flex justify-between gap-2">
          {onDelete ? (
            <button onClick={onDelete} className="px-3 py-2 text-xs font-semibold text-red-400 hover:bg-red-500/10 rounded-lg">삭제</button>
          ) : <div />}
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-surface)] rounded-lg">취소</button>
            <button onClick={submit} disabled={!form.title.trim() || !!dateError || saving} className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50">
              {saving ? "저장 중..." : (form.id ? "수정" : "추가")}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Todos ───────────────────────────────────────────────────────────────

function TodoTab({ companyId, userId, toast }: { companyId: string; userId: string; toast: any }) {
  const queryClient = useQueryClient();
  const [showDone, setShowDone] = useState(false);
  const [newTitle, setNewTitle] = useState("");
  const [newPriority, setNewPriority] = useState<0 | 1 | 2>(1);
  const [newDueDate, setNewDueDate] = useState("");
  const [editing, setEditing] = useState<ScheduleTodo | null>(null);

  const { data: todos = [] } = useQuery({
    queryKey: ["schedule-todos", userId, showDone],
    queryFn: () => getTodos(userId, { includeDone: showDone }),
    enabled: !!userId,
  });

  const addMut = useMutation({
    mutationFn: () => upsertTodo({
      companyId,
      userId,
      title: newTitle.trim(),
      priority: newPriority,
      dueDate: newDueDate || null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule-todos"] });
      setNewTitle("");
      setNewDueDate("");
      setNewPriority(1);
    },
    onError: (e: any) => toast(`추가 실패: ${e.message}`, "error"),
  });

  const toggleMut = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) => toggleTodoDone(id, done),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedule-todos"] }),
  });

  const editMut = useMutation({
    mutationFn: (payload: any) => upsertTodo({
      id: payload.id,
      companyId,
      userId,
      title: payload.title,
      priority: payload.priority,
      dueDate: payload.dueDate,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["schedule-todos"] });
      setEditing(null);
      toast("할 일이 수정되었습니다", "success");
    },
    onError: (e: any) => toast(`수정 실패: ${e.message}`, "error"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteTodo(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedule-todos"] }),
  });

  const undoneCount = todos.filter((t) => !t.done).length;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="space-y-3">
      {/* Stats */}
      <div className="grid grid-cols-3 gap-2">
        <div className="bg-[var(--bg-card)] rounded-xl p-3 border border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-dim)] font-semibold uppercase">할 일</div>
          <div className="text-base font-black mt-0.5">{undoneCount}건</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl p-3 border border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-dim)] font-semibold uppercase">오늘 마감</div>
          <div className="text-base font-black mt-0.5 text-amber-500">
            {todos.filter((t) => !t.done && t.due_date === today).length}건
          </div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl p-3 border border-[var(--border)]">
          <div className="text-[10px] text-[var(--text-dim)] font-semibold uppercase">지연</div>
          <div className="text-base font-black mt-0.5 text-red-400">
            {todos.filter((t) => !t.done && t.due_date && t.due_date < today).length}건
          </div>
        </div>
      </div>

      {/* Add form */}
      <div className="glass-card p-4">
        <div className="flex gap-2 flex-wrap items-end">
          <div className="flex-1 min-w-[200px]">
            <label className="block text-[10px] text-[var(--text-muted)] mb-1">새 할 일</label>
            <input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && newTitle.trim()) addMut.mutate(); }}
              placeholder="예: 세금계산서 발행"
              className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
            />
          </div>
          <div>
            <label className="block text-[10px] text-[var(--text-muted)] mb-1">우선순위</label>
            <select value={newPriority} onChange={(e) => setNewPriority(Number(e.target.value) as 0 | 1 | 2)} className="px-2 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
              <option value={0}>낮음</option>
              <option value={1}>보통</option>
              <option value={2}>높음</option>
            </select>
          </div>
          <div>
            <label className="block text-[10px] text-[var(--text-muted)] mb-1">마감일</label>
            <input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} className="px-2 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs" />
          </div>
          <button onClick={() => newTitle.trim() && addMut.mutate()} disabled={!newTitle.trim() || addMut.isPending} className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-lg text-xs font-semibold disabled:opacity-50">
            추가
          </button>
        </div>
      </div>

      {/* Filter */}
      <label className="inline-flex items-center gap-2 text-xs cursor-pointer">
        <input type="checkbox" checked={showDone} onChange={(e) => setShowDone(e.target.checked)} className="accent-[var(--primary)]" />
        <span className="text-[var(--text-muted)]">완료된 항목 포함</span>
      </label>

      {/* List */}
      <div className="glass-card overflow-hidden">
        {todos.length === 0 ? (
          <div className="p-12 text-center">
            <div className="text-3xl mb-3">✓</div>
            <div className="text-sm font-bold mb-1">할 일이 없습니다</div>
            <div className="text-xs text-[var(--text-muted)]">위에서 새 할 일을 추가하세요</div>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]/50">
            {todos.map((t) => {
              const overdue = !t.done && t.due_date && t.due_date < today;
              const pri = PRIORITY_LABEL[t.priority];
              return (
                <div key={t.id} className={`flex items-start gap-3 px-4 py-3 hover:bg-[var(--bg-surface)] transition ${t.done ? "opacity-50" : ""}`}>
                  <input
                    type="checkbox"
                    checked={t.done}
                    onChange={(e) => toggleMut.mutate({ id: t.id, done: e.target.checked })}
                    className="mt-1 accent-[var(--primary)] cursor-pointer w-4 h-4"
                  />
                  <div className="flex-1 min-w-0" onClick={() => setEditing(t)}>
                    <div className={`text-sm font-medium ${t.done ? "line-through" : ""} cursor-pointer`}>{t.title}</div>
                    <div className="flex items-center gap-2 mt-0.5 text-[10px]">
                      <span className={`px-1.5 py-0.5 rounded font-semibold ${pri.color} bg-[var(--bg-surface)]`}>{pri.label}</span>
                      {t.due_date && (
                        <span className={overdue ? "text-red-400 font-semibold" : "text-[var(--text-dim)]"}>
                          {overdue ? "⚠ " : "📅 "}{t.due_date}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    onClick={() => { if (confirm("이 할 일을 삭제하시겠습니까?")) deleteMut.mutate(t.id); }}
                    className="text-xs text-[var(--text-dim)] hover:text-red-400 transition px-2 py-1"
                    aria-label="삭제"
                  >✕</button>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {editing && (
        <TodoEditModal
          todo={editing}
          onClose={() => setEditing(null)}
          onSave={(payload) => editMut.mutate(payload)}
          saving={editMut.isPending}
        />
      )}
    </div>
  );
}

function TodoEditModal({
  todo, onClose, onSave, saving,
}: {
  todo: ScheduleTodo;
  onClose: () => void;
  onSave: (payload: any) => void;
  saving: boolean;
}) {
  const [form, setForm] = useState({
    title: todo.title,
    priority: todo.priority,
    dueDate: todo.due_date || "",
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={onClose}>
      <div className="glass-card w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold">할 일 수정</h3>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)]">✕</button>
        </div>
        <div className="p-5 space-y-3">
          <div>
            <label className="block text-[10px] text-[var(--text-muted)] mb-1">제목</label>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm" />
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] mb-1">우선순위</label>
              <select value={form.priority} onChange={(e) => setForm({ ...form, priority: Number(e.target.value) as 0 | 1 | 2 })} className="w-full px-2 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                <option value={0}>낮음</option>
                <option value={1}>보통</option>
                <option value={2}>높음</option>
              </select>
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-muted)] mb-1">마감일</label>
              <input type="date" value={form.dueDate} onChange={(e) => setForm({ ...form, dueDate: e.target.value })} className="w-full px-2 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs" />
            </div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-[var(--border)] flex justify-end gap-2">
          <button onClick={onClose} className="px-4 py-2 text-xs font-semibold text-[var(--text-muted)] hover:bg-[var(--bg-surface)] rounded-lg">취소</button>
          <button onClick={() => form.title.trim() && onSave({ id: todo.id, title: form.title.trim(), priority: form.priority, dueDate: form.dueDate || null })} disabled={!form.title.trim() || saving} className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-xs font-semibold disabled:opacity-50">
            {saving ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
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
