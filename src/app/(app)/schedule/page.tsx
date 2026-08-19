"use client";

import { todayKst } from "@/lib/kst";
import { Ico } from "@/components/ui-icon";
import { useEffect, useMemo, useRef, useState } from "react";
import { DateField } from "@/components/date-field";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import {
  getMonthEvents,
  getScheduleItems,
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
import { ScheduleItemDialog, type ScheduleDialogTarget } from "@/components/schedule-item-dialog";
import { useToast } from "@/components/toast";
import Link from "next/link";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ChipGroup, ConditionPanel, ConditionRow, AppliedChips,
  QuickSearch, quickSearchHit, ResultStrip, Stat, RowsPerPage, Pager, usePager, type AppliedChip,
} from "@/components/query-kit";
import { SortableTh, nextSort, cmp, useColWidths, type SortState } from "@/components/sortable-th";
import { DateRangeField } from "@/components/date-range-field";
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

  //   갈래 탭 — 상자 안 맨 위 파란 밑줄 (2026-08-18 조회 표준). 각 탭 부품이 상자 전체를 그린다
  const tabsEl = (
    <div className="collect-tabs no-print">
      {([["calendar", "달력"], ["list", "목록"]] as [Tab, string][]).map(([k, label]) => (
        <button key={k} type="button" onClick={() => setTab(k)} className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>{label}</button>
      ))}
    </div>
  );

  return (
    <div className="qk-shell schedule-page">
      {tab === "calendar" && companyId && userId && (
        <CalendarTab companyId={companyId} userId={userId} toast={toast} tabs={tabsEl} />
      )}
      {tab === "list" && companyId && userId && (
        <ScheduleListTab companyId={companyId} userId={userId} toast={toast} tabs={tabsEl} />
      )}
    </div>
  );
}

// ─── Calendar ──────────────────────────────────────────────────────────

function CalendarTab({ companyId, userId, toast, tabs }: { companyId: string; userId: string; toast: any; tabs?: React.ReactNode }) {
  const queryClient = useQueryClient();
  const today = new Date();
  const [view, setView] = useState({ year: today.getFullYear(), monthIdx0: today.getMonth() });
  const [scope, setScope] = useState<ScheduleScope>("all");
  //   달력에서 여는 창 — 일정을 누르면 **내용부터**, 날짜를 누르면 새로 만들기(2026-08-10)
  const [dialog, setDialog] = useState<ScheduleDialogTarget | null>(null);
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

  const toggleDoneMut = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => toggleEventCompleted(id, completed),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["schedule-events"] }),
    onError: (e: any) => toast(`완료 처리 실패: ${e.message}`, "error"),
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
  // 머리('YYYY년 M월') 클릭 → 연 단위 이동 버튼 노출 (2026-08-19 사장님: 모든 달력 공통)
  const [yearNav, setYearNav] = useState(false);
  const prevYear = () => setView(({ year, monthIdx0 }) => ({ year: year - 1, monthIdx0 }));
  const nextYear = () => setView(({ year, monthIdx0 }) => ({ year: year + 1, monthIdx0 }));

  const openAdd = (dateStr: string) => {
    setSelectedDate(dateStr);
    //   공개 범위는 기본이 '나만' — 넓히는 것은 사람이 고른다(2026-08-10 사장님 결정)
    setDialog({ mode: "new", from: dateStr, to: dateStr });
  };

  return (
    <QueryScreen>
      <QueryHead>
        {tabs}
        {/* 조회 줄 — 달(기간은 어디서 바꾸든 즉시) · 보기(전체/내 것만) ‖ + 일정 추가 (2026-08-18 조회 표준) */}
        <QueryBar right={<button type="button" onClick={() => openAdd(toLocalDateStr(today))} className="btn-primary btn-sm whitespace-nowrap">+ 일정 추가</button>}>
          <span className="qk-quicks fw-week-nav">
            <button type="button" onClick={prevMonth} className="qk-quick" aria-label="이전 달">◀</button>
            <button type="button" onClick={goToday} className="qk-quick">오늘</button>
            <button type="button" onClick={nextMonth} className="qk-quick" aria-label="다음 달">▶</button>
          </span>
          <button type="button" onClick={() => setYearNav((v) => !v)} title="누르면 연 단위 이동 버튼이 나타납니다"
            className="text-sm font-bold text-[var(--text)] tabular-nums px-1.5 py-0.5 rounded-lg hover:bg-[var(--bg-surface)] transition">
            {view.year}년 {view.monthIdx0 + 1}월<span className="ml-1 text-[9px] text-[var(--text-dim)]">▾</span>
          </button>
          {yearNav && (
            <span className="qk-quicks fw-week-nav">
              <button type="button" onClick={prevYear} className="qk-quick" aria-label="이전 해">◀ 1년</button>
              <button type="button" onClick={nextYear} className="qk-quick" aria-label="다음 해">1년 ▶</button>
            </span>
          )}
          {/* 보기 전환 — 무엇이 보이는지는 공개 범위(RLS)가 정한다. 여기서는 내 것만 좁혀 볼 뿐 */}
          <ChipGroup value={scope} onChange={setScope} options={[{ value: "all", label: "전체" }, { value: "mine", label: "내 것만" }] as const} />
          <span className="text-[11px] text-[var(--text-dim)]">
            {scope === "all" ? "내가 볼 수 있는 일정 전부 — 나만 보는 일정, 나에게 공유된 일정, 전체 공개 일정" : "내가 만든 일정만"}
          </span>
        </QueryBar>
      </QueryHead>

      <QueryBody>
      <div className="ev-scroll">
      {/* Calendar Grid — 상자 안 상자 없이 격자만 */}
      <div className="schedule-calendar-grid">
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
                        onClick={(ev) => { ev.stopPropagation(); setDialog({ mode: "view", event: e }); }}
                        className={`group/ev flex items-center gap-1 text-[9px] px-1.5 py-0.5 border ${barShape} ${EVENT_COLOR_BG[e.color]} cursor-pointer ${e.completed ? "opacity-50" : ""}`}
                        title={
                          multi
                            ? `${e.title} (${formatEventRange(e)}) · 클릭하면 내용 보기`
                            : "클릭하면 내용 보기"
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
                            onClick={(ev) => { ev.stopPropagation(); setDialog({ mode: "view", event: e }); }}
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
      {isLoading && <div className="px-3 py-2 text-xs text-[var(--text-dim)]">불러오는 중...</div>}
      </div>
      </QueryBody>

      {dialog && (
        <ScheduleItemDialog companyId={companyId} userId={userId} target={dialog}
          onClose={() => setDialog(null)} />
      )}
    </QueryScreen>
  );
}

// ─── 목록 — 날짜 있는 것과 없는 것을 한 자리에서 (2026-08-10 통합) ──────────
//   예전 '할 일' 탭 자리다. '할 일' 이라는 구분은 없앴다 — 날짜를 안 넣은 일정일 뿐이다.

function ScheduleListTab({ companyId, userId, toast, tabs }: { companyId: string; userId: string; toast: any; tabs?: React.ReactNode }) {
  const queryClient = useQueryClient();
  const [dialog, setDialog] = useState<ScheduleDialogTarget | null>(null);
  //   조회 표준 (2026-08-18): 보기(전체/내 것만)는 조회 줄, 완료 포함·공개 범위·기간은 검색조건, 빠른검색, 표(정렬·너비)+쪽
  const [scope, setScope] = useState<"all" | "mine">("all");
  const [q, setQ] = useState("");
  type LCond = { done: boolean; vis: string[]; from: string; to: string; rows: number };
  const LEMPTY: LCond = { done: false, vis: [], from: "", to: "", rows: 50 };
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<LCond>(LEMPTY);
  const [live, setLive] = useState<LCond>(LEMPTY);
  const lCount = (c: LCond) => (c.done ? 1 : 0) + c.vis.length + ((c.from || c.to) ? 1 : 0);
  type SKey = "done" | "title" | "when" | "vis";
  const [sort, setSort] = useState<SortState<SKey>>({ key: "when", dir: "asc" });
  const onSort = (k: SKey) => setSort((c) => nextSort(c, k));
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths("schedule-list-colw-v1", { done: 60, title: 320, desc: 320, when: 220, vis: 100 });
  const thResize = (k: string, colIndex: number) => ({ k, colIndex, widths: colW, onResize: setColW, tableRef });

  const { data: items = [], isLoading } = useQuery({
    queryKey: ["schedule-items", companyId, userId, live.done, scope === "mine"],
    queryFn: () => getScheduleItems(companyId, { includeDone: live.done, mineOnly: scope === "mine", userId }),
    enabled: !!companyId,
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["schedule-items"] });
    queryClient.invalidateQueries({ queryKey: ["schedule-events"] });
    queryClient.invalidateQueries({ queryKey: ["chat-cal-events"] });
    queryClient.invalidateQueries({ queryKey: ["chat-schedule-events"] });
  };

  const doneMut = useMutation({
    mutationFn: ({ id, completed }: { id: string; completed: boolean }) => toggleEventCompleted(id, completed),
    onSuccess: refresh,
  });

  const day = (v?: string | null) => (v ? String(v).slice(0, 10) : "");
  const hit = (e: ScheduleEvent) => {
    if (live.vis.length && !live.vis.includes(e.visibility)) return false;
    if ((live.from || live.to) && !e.start_at) return false;
    if (live.from && day(e.start_at) < live.from) return false;
    if (live.to && day(e.start_at) > live.to) return false;
    return quickSearchHit(q, [e.title, e.description, VISIBILITY_LABEL[e.visibility]]);
  };
  const shown = useMemo(() => {
    const d = sort.dir === "asc" ? 1 : -1;
    return (items as ScheduleEvent[]).filter(hit).sort((a, b) => {
      //   날짜 없는 것은 항상 아래(언제 할지 안 정한 일)
      if (!!a.start_at !== !!b.start_at) return a.start_at ? -1 : 1;
      switch (sort.key) {
        case "done": return (Number(a.completed) - Number(b.completed)) * d;
        case "title": return cmp(a.title || "", b.title || "") * d;
        case "vis": return cmp(VISIBILITY_LABEL[a.visibility] || "", VISIBILITY_LABEL[b.visibility] || "") * d;
        default: return cmp(String(a.start_at || ""), String(b.start_at || "")) * d;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, live, q, sort]);
  const pager = usePager(shown, live.rows, `${scope}|${q}|${JSON.stringify(live)}|${JSON.stringify(sort)}`);
  const dated = shown.filter((i) => !!i.start_at).length;
  const drop = (patch: Partial<LCond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const chips: AppliedChip[] = [
    ...(q ? [{ group: "빠른검색", label: q, onRemove: () => setQ("") }] : []),
    ...(live.done ? [{ group: "완료", label: "완료 포함", onRemove: () => drop({ done: false }) }] : []),
    ...live.vis.map((v) => ({ group: "공개", label: VISIBILITY_LABEL[v as keyof typeof VISIBILITY_LABEL] || v, onRemove: () => drop({ vis: live.vis.filter((x) => x !== v) }) })),
    ...((live.from || live.to) ? [{ group: "기간", label: `${live.from || "처음"} ~ ${live.to || "끝"}`, onRemove: () => drop({ from: "", to: "" }) }] : []),
  ];

  return (
    <QueryScreen>
      <QueryHead>
        {tabs}
        <QueryBar right={<button type="button" className="btn-primary btn-sm whitespace-nowrap" onClick={() => setDialog({ mode: "new" })}>+ 새로 만들기</button>}>
          <ConditionPanel open={panelOpen} onOpenChange={(v) => { if (v) setDraft(live); setPanelOpen(v); }} activeCount={lCount(live)}
            foot={<>
              <button type="button" className="btn-secondary btn-sm" disabled={lCount(draft) === 0} onClick={() => setDraft({ ...LEMPTY, rows: draft.rows })}>조건 지우기</button>
              <span className="ml-auto" />
              <RowsPerPage value={draft.rows} onChange={(n) => setDraft((c) => ({ ...c, rows: n }))} />
              <button type="button" className="btn-primary btn-sm" onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
            </>}>
            <ConditionRow label="완료" hint="기본은 안 끝난 것만">
              <ChipGroup value={draft.done ? "y" : "n"} onChange={(v) => setDraft((c) => ({ ...c, done: v === "y" }))} options={[{ value: "n", label: "안 끝난 것만" }, { value: "y", label: "완료 포함" }] as const} />
            </ConditionRow>
            <ConditionRow label="공개 범위" hint="여러 개">
              <span className="qk-quicks">
                {Object.entries(VISIBILITY_LABEL).map(([k, l]) => (
                  <button key={k} type="button" onClick={() => setDraft((c) => ({ ...c, vis: c.vis.includes(k) ? c.vis.filter((x) => x !== k) : [...c.vis, k] }))}
                    className={draft.vis.includes(k) ? "qk-quick qk-quick-on" : "qk-quick"}>{l as string}</button>
                ))}
              </span>
            </ConditionRow>
            <ConditionRow label="기간" hint="날짜 있는 일정만 걸린다">
              <DateRangeField label={null} from={draft.from} to={draft.to} onChange={(f, t) => setDraft((c) => ({ ...c, from: f, to: t }))} onClear={() => setDraft((c) => ({ ...c, from: "", to: "" }))} />
            </ConditionRow>
          </ConditionPanel>
          <QuickSearch value={q} onApply={setQ} placeholder="제목 · 설명 · 공개 범위 — 쉼표로 여러 개, Enter" />
          <ChipGroup value={scope} onChange={setScope} options={[{ value: "all", label: "전체" }, { value: "mine", label: "내 것만" }] as const} />
        </QueryBar>
        <AppliedChips chips={chips} onClearAll={() => { setQ(""); setLive(LEMPTY); setDraft(LEMPTY); setScope("all"); }} />
        <ResultStrip right={<span className="text-[11px] text-[var(--text-dim)]">표시 <b className="mono-number">{shown.length}</b>건</span>}>
          <Stat label="날짜 있는 일정" value={`${dated}건`} />
          <Stat label="날짜 없는 것" value={`${shown.length - dated}건`} />
          <span className="text-[11px] text-[var(--text-dim)]">날짜 없는 것 = 언제 할지 아직 안 정한 일 — 날짜를 넣으면 달력에도 뜹니다</span>
        </ResultStrip>
      </QueryHead>

      <QueryBody>
        {isLoading ? (
          <div className="collect-empty">불러오는 중…</div>
        ) : shown.length === 0 ? (
          <div className="collect-empty">일정이 없습니다 — [+ 새로 만들기] 로 추가하거나 검색조건을 풀어 보세요</div>
        ) : (
          <div className="ev-scroll">
            <table ref={tableRef} className="ev-table ev-lined sched-table">
              <thead>
                <tr>
                  <SortableTh label="완료" sortKey="done" sort={sort} onSort={onSort} resize={thResize("done", 1)} />
                  <SortableTh label="제목" sortKey="title" sort={sort} onSort={onSort} resize={thResize("title", 2)} />
                  <SortableTh label="설명" resize={thResize("desc", 3)} />
                  <SortableTh label="일시" sortKey="when" sort={sort} onSort={onSort} resize={thResize("when", 4)} />
                  <SortableTh label="공개" sortKey="vis" sort={sort} onSort={onSort} resize={thResize("vis", 5)} />
                </tr>
              </thead>
              <tbody>
                {(pager.view as ScheduleEvent[]).map((e) => (
                  <tr key={e.id} className="sched-row" onClick={() => setDialog({ mode: "view", event: e })}>
                    <td className="text-center" onClick={(ev) => ev.stopPropagation()}>
                      <input type="checkbox" checked={e.completed}
                        onChange={(ev) => doneMut.mutate({ id: e.id, completed: ev.target.checked })}
                        title={e.completed ? "완료 취소" : "완료"} />
                    </td>
                    <td className={`text-left font-semibold ${e.completed ? "line-through opacity-60" : ""}`}>{e.title}</td>
                    <td className="text-left text-[var(--text-dim)] truncate" title={e.description || ""}>{e.description || "—"}</td>
                    <td className="text-center mono-number">{e.start_at ? formatEventRange(e) : <span className="text-[var(--text-dim)]">날짜 없음</span>}</td>
                    <td className="text-center"><span className="sched-list-vis">{VISIBILITY_LABEL[e.visibility]}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </QueryBody>
      <Pager page={pager.page} pages={pager.pages} total={shown.length} size={live.rows} from={pager.from} to={pager.to} onPage={pager.setPage} />

      {dialog && (
        <ScheduleItemDialog companyId={companyId} userId={userId} target={dialog}
          onClose={() => setDialog(null)} />
      )}
    </QueryScreen>
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
