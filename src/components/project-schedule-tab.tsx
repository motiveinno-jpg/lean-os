"use client";

// 2026-05-21 프로젝트 슬라이드 패널 '일정 관리' 탭.
//   단일 테이블(deal_milestones) 위에서 3-뷰 토글 — 체크리스트 / 간트 / 캘린더.
//   외부 라이브러리 도입 X (단순함 우선). RLS 회사격리만(기존 정책).
//   start_date 컬럼은 20260521090000 마이그에서 추가, NULL 허용.

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";

interface Milestone {
  id: string;
  deal_id: string;
  name: string;
  due_date: string | null;
  start_date: string | null;
  completed_at: string | null;
  status: string | null;
  sort_order: number | null;
  created_at: string | null;
}

type View = "checklist" | "gantt" | "calendar";

export function ProjectScheduleTab({ dealId }: { dealId: string }) {
  const [view, setView] = useState<View>("checklist");
  const { toast } = useToast();
  const qc = useQueryClient();

  const { data: milestones = [], isLoading } = useQuery<Milestone[]>({
    queryKey: ["deal-milestones", dealId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("deal_milestones")
        .select("id, deal_id, name, due_date, start_date, completed_at, status, sort_order, created_at")
        .eq("deal_id", dealId)
        .order("sort_order", { ascending: true })
        .order("due_date", { ascending: true });
      if (error) throw error;
      return (data || []) as Milestone[];
    },
    enabled: !!dealId,
  });

  const invalidate = () => qc.invalidateQueries({ queryKey: ["deal-milestones", dealId] });

  // ─── Mutations ──────────────────────────────────────
  const addMutation = useMutation({
    mutationFn: async (payload: { name: string; due_date: string | null; start_date: string | null }) => {
      const { error } = await supabase.from("deal_milestones").insert({
        deal_id: dealId,
        name: payload.name,
        due_date: payload.due_date,
        start_date: payload.start_date,
        sort_order: milestones.length,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast("마일스톤 추가됨", "success");
      invalidate();
    },
    onError: (e) => toast(friendlyError(e), "error"),
  });

  const toggleMutation = useMutation({
    mutationFn: async (m: Milestone) => {
      const { error } = await supabase
        .from("deal_milestones")
        .update({ completed_at: m.completed_at ? null : new Date().toISOString() })
        .eq("id", m.id);
      if (error) throw error;
    },
    onSuccess: invalidate,
    onError: (e) => toast(friendlyError(e), "error"),
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("deal_milestones").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast("삭제됨", "success");
      invalidate();
    },
    onError: (e) => toast(friendlyError(e), "error"),
  });

  const updateMutation = useMutation({
    mutationFn: async (m: { id: string; name: string; due_date: string | null; start_date: string | null }) => {
      const { error } = await supabase
        .from("deal_milestones")
        .update({ name: m.name, due_date: m.due_date, start_date: m.start_date })
        .eq("id", m.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast("수정됨", "success");
      invalidate();
    },
    onError: (e) => toast(friendlyError(e), "error"),
  });

  return (
    <div className="space-y-4">
      {/* 뷰 토글 */}
      <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-surface)] w-fit">
        {([
          { k: "checklist", l: "📋 체크리스트" },
          { k: "gantt", l: "📊 간트" },
          { k: "calendar", l: "📅 캘린더" },
        ] as { k: View; l: string }[]).map((v) => (
          <button
            key={v.k}
            type="button"
            onClick={() => setView(v.k)}
            className={`px-3 py-1.5 text-xs font-semibold rounded-lg transition ${
              view === v.k
                ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {v.l}
          </button>
        ))}
      </div>

      {isLoading ? (
        <div className="text-xs text-[var(--text-dim)] py-6 text-center">불러오는 중…</div>
      ) : view === "checklist" ? (
        <ChecklistView
          milestones={milestones}
          onAdd={(p) => addMutation.mutate(p)}
          onToggle={(m) => toggleMutation.mutate(m)}
          onDelete={(id) => deleteMutation.mutate(id)}
          onUpdate={(m) => updateMutation.mutate(m)}
          busy={addMutation.isPending || toggleMutation.isPending || deleteMutation.isPending || updateMutation.isPending}
        />
      ) : view === "gantt" ? (
        <GanttView milestones={milestones} />
      ) : (
        <CalendarView milestones={milestones} />
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 체크리스트 뷰
// ─────────────────────────────────────────────────────

function ChecklistView({
  milestones,
  onAdd,
  onToggle,
  onDelete,
  onUpdate,
  busy,
}: {
  milestones: Milestone[];
  onAdd: (p: { name: string; due_date: string | null; start_date: string | null }) => void;
  onToggle: (m: Milestone) => void;
  onDelete: (id: string) => void;
  onUpdate: (m: { id: string; name: string; due_date: string | null; start_date: string | null }) => void;
  busy: boolean;
}) {
  const [addOpen, setAddOpen] = useState(false);
  const [name, setName] = useState("");
  const [due, setDue] = useState("");
  const [start, setStart] = useState("");
  const [editId, setEditId] = useState<string | null>(null);

  const submitAdd = () => {
    const trimmed = name.trim();
    if (!trimmed) return;
    onAdd({ name: trimmed, due_date: due || null, start_date: start || null });
    setName("");
    setDue("");
    setStart("");
    setAddOpen(false);
  };

  return (
    <div className="space-y-2">
      {milestones.length === 0 ? (
        <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--text-dim)]">
          등록된 마일스톤이 없습니다. 아래 “+ 마일스톤 추가”로 시작하세요.
        </div>
      ) : (
        <ul className="space-y-1.5">
          {milestones.map((m) => {
            const done = !!m.completed_at;
            const overdue = !done && m.due_date && new Date(m.due_date) < new Date(new Date().toDateString());
            const dLabel = m.due_date ? dDayLabel(m.due_date) : "";
            const isEditing = editId === m.id;
            return (
              <li
                key={m.id}
                className={`rounded-xl border px-3 py-2.5 transition ${
                  done
                    ? "border-emerald-500/40 bg-emerald-500/5"
                    : overdue
                    ? "border-red-500/40 bg-red-500/5"
                    : "border-[var(--border)] bg-[var(--bg-card)]"
                }`}
              >
                {isEditing ? (
                  <EditRow
                    initial={m}
                    onCancel={() => setEditId(null)}
                    onSave={(payload) => {
                      onUpdate({ id: m.id, ...payload });
                      setEditId(null);
                    }}
                  />
                ) : (
                  <div className="flex items-center gap-2.5">
                    <button
                      type="button"
                      onClick={() => onToggle(m)}
                      disabled={busy}
                      aria-label={done ? "완료 취소" : "완료 처리"}
                      className={`w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition ${
                        done
                          ? "bg-emerald-500 border-emerald-500 text-white"
                          : "border-[var(--border)] hover:border-[var(--primary)]"
                      }`}
                    >
                      {done && <span className="text-xs leading-none">✓</span>}
                    </button>
                    <div className="min-w-0 flex-1">
                      <div
                        className={`text-sm font-medium truncate ${
                          done ? "text-[var(--text-dim)] line-through" : "text-[var(--text)]"
                        }`}
                      >
                        {m.name}
                      </div>
                      {m.due_date && (
                        <div className="text-[11px] text-[var(--text-muted)] flex items-center gap-1.5 mt-0.5">
                          <span>📅 {m.due_date}</span>
                          {dLabel && (
                            <span
                              className={`font-bold ${
                                overdue ? "text-red-500" : done ? "text-emerald-500" : "text-[var(--primary)]"
                              }`}
                            >
                              {dLabel}
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => setEditId(m.id)}
                        className="px-2 py-1 text-[11px] font-semibold rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)]"
                      >
                        편집
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (confirm(`'${m.name}' 마일스톤을 삭제할까요?`)) onDelete(m.id);
                        }}
                        className="px-2 py-1 text-[11px] font-semibold rounded-md text-red-500/80 hover:bg-red-500/10"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {addOpen ? (
        <div className="rounded-xl border border-[var(--primary)]/40 bg-[var(--primary)]/5 p-3 space-y-2">
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="마일스톤 이름 (필수)"
            className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-card)] border border-[var(--border)] focus:outline-none focus:border-[var(--primary)]"
            autoFocus
          />
          <div className="grid grid-cols-2 gap-2">
            <label className="text-[11px] text-[var(--text-muted)]">
              <span className="block mb-1">시작일 (간트용)</span>
              <input
                type="date"
                value={start}
                onChange={(e) => setStart(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border)]"
              />
            </label>
            <label className="text-[11px] text-[var(--text-muted)]">
              <span className="block mb-1">마감일</span>
              <input
                type="date"
                value={due}
                onChange={(e) => setDue(e.target.value)}
                className="w-full px-2 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border)]"
              />
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={() => {
                setAddOpen(false);
                setName("");
                setDue("");
                setStart("");
              }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"
            >
              취소
            </button>
            <button
              type="button"
              onClick={submitAdd}
              disabled={!name.trim() || busy}
              className="px-3 py-1.5 text-xs font-bold rounded-lg bg-[var(--primary)] text-white disabled:opacity-50"
            >
              저장
            </button>
          </div>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => setAddOpen(true)}
          className="w-full px-3 py-2.5 text-xs font-semibold rounded-xl border border-dashed border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition"
        >
          + 마일스톤 추가
        </button>
      )}
    </div>
  );
}

function EditRow({
  initial,
  onCancel,
  onSave,
}: {
  initial: Milestone;
  onCancel: () => void;
  onSave: (p: { name: string; due_date: string | null; start_date: string | null }) => void;
}) {
  const [name, setName] = useState(initial.name);
  const [due, setDue] = useState(initial.due_date || "");
  const [start, setStart] = useState(initial.start_date || "");
  return (
    <div className="space-y-2">
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--bg-card)] border border-[var(--border)] focus:outline-none focus:border-[var(--primary)]"
      />
      <div className="grid grid-cols-2 gap-2">
        <label className="text-[11px] text-[var(--text-muted)]">
          <span className="block mb-1">시작일</span>
          <input
            type="date"
            value={start}
            onChange={(e) => setStart(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border)]"
          />
        </label>
        <label className="text-[11px] text-[var(--text-muted)]">
          <span className="block mb-1">마감일</span>
          <input
            type="date"
            value={due}
            onChange={(e) => setDue(e.target.value)}
            className="w-full px-2 py-1.5 text-xs rounded-lg bg-[var(--bg-card)] border border-[var(--border)]"
          />
        </label>
      </div>
      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="px-3 py-1 text-xs font-semibold rounded-lg text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"
        >
          취소
        </button>
        <button
          type="button"
          onClick={() => {
            const t = name.trim();
            if (!t) return;
            onSave({ name: t, due_date: due || null, start_date: start || null });
          }}
          className="px-3 py-1 text-xs font-bold rounded-lg bg-[var(--primary)] text-white"
        >
          저장
        </button>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 간트 뷰 — 2-컬럼 레이아웃 (좌측 라벨 + 우측 타임라인)
//   today 라인: 모든 date 를 로컬 자정 기준으로 통일해 정확히 위치.
// ─────────────────────────────────────────────────────

// "YYYY-MM-DD" → 로컬 자정 timestamp. (new Date("2026-05-21") 는 UTC 자정으로
// 파싱돼 KST 환경에서 9시간 갭 발생 → 막대·today 선 위치가 어긋남.)
function dateOnlyMs(s: string) {
  const [y, mo, d] = s.split("-").map(Number);
  if (!y || !mo || !d) return NaN;
  return new Date(y, mo - 1, d).getTime();
}

function todayMs() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

function GanttView({ milestones }: { milestones: Milestone[] }) {
  // 범위 = 마일스톤들의 (start_date|due_date) min ~ max. 비어있으면 today ± 14일.
  const { rangeStart, rangeEnd, span } = useMemo(() => {
    const dates: number[] = [];
    milestones.forEach((m) => {
      if (m.start_date) dates.push(dateOnlyMs(m.start_date));
      if (m.due_date) dates.push(dateOnlyMs(m.due_date));
    });
    const today = todayMs();
    if (dates.length === 0) {
      return { rangeStart: today - 14 * 864e5, rangeEnd: today + 14 * 864e5, span: 28 * 864e5 };
    }
    const minD = Math.min(...dates);
    const maxD = Math.max(...dates);
    // 여유 패딩 — 최소 2일, 최대 7%
    const pad = Math.max(864e5 * 2, (maxD - minD) * 0.07);
    const s = minD - pad;
    const e = maxD + pad;
    return { rangeStart: s, rangeEnd: e, span: Math.max(e - s, 864e5) };
  }, [milestones]);

  const today = todayMs();
  const todayPct = ((today - rangeStart) / span) * 100;
  const todayInRange = todayPct >= 0 && todayPct <= 100;
  const spanDays = Math.max(1, Math.round(span / 864e5));

  // 매일 일자 tick + 라벨. (라벨은 매일 표시 — 사용자 요청)
  const dayTicks = useMemo(() => {
    const arr: { pct: number; label: string; sub: string; isMonthStart: boolean; isWeekend: boolean; weekday: number }[] = [];
    const start = new Date(rangeStart);
    start.setHours(0, 0, 0, 0);
    let cursor = new Date(start);
    while (cursor.getTime() <= rangeEnd) {
      const pct = ((cursor.getTime() - rangeStart) / span) * 100;
      arr.push({
        pct,
        label: `${cursor.getMonth() + 1}/${cursor.getDate()}`,
        sub: ["일", "월", "화", "수", "목", "금", "토"][cursor.getDay()],
        isMonthStart: cursor.getDate() === 1,
        isWeekend: cursor.getDay() === 0 || cursor.getDay() === 6,
        weekday: cursor.getDay(),
      });
      cursor = new Date(cursor.getTime() + 864e5);
    }
    return arr;
  }, [rangeStart, rangeEnd, span]);

  if (milestones.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-[var(--border)] p-6 text-center text-xs text-[var(--text-dim)]">
        마일스톤을 먼저 추가하면 간트차트가 표시됩니다.
      </div>
    );
  }

  const ROW_H = 48; // 행 높이 (큰 막대 + 라벨 가독)
  const HEADER_H = 56; // 일자 + 요일 2-row
  const LABEL_W = 128; // 좌측 라벨 컬럼 px
  // 매일 라벨 가독성 위한 timeline 최소 폭 (32px/day). 슬라이드보다 넓으면 가로 스크롤.
  const TIMELINE_MIN_W = Math.max(spanDays * 32, 480);

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-hidden shadow-sm w-full">
      {/* 가로 스크롤 컨테이너 — 좌측 라벨도 함께 스크롤 */}
      <div className="overflow-x-auto">
        <div className="flex" style={{ minWidth: LABEL_W + TIMELINE_MIN_W }}>
          {/* ─── 좌측: 마일스톤 라벨 컬럼 (sticky) ─── */}
          <div
            className="shrink-0 border-r border-[var(--border)] bg-[var(--bg-card)] sticky left-0 z-30"
            style={{ width: LABEL_W }}
          >
            {/* 헤더 */}
            <div
              className="px-3 flex items-center border-b border-[var(--border)] bg-[var(--bg-surface)]/30 text-[10px] font-bold uppercase text-[var(--text-muted)] tracking-wider"
              style={{ height: HEADER_H }}
            >
              마일스톤
            </div>
            {/* 데이터 행 */}
            {milestones.map((m, idx) => {
              const done = !!m.completed_at;
              const overdue = !done && m.due_date && dateOnlyMs(m.due_date) < today;
              return (
                <div
                  key={m.id}
                  className={`px-3 flex items-center gap-2 border-b border-[var(--border)]/60 last:border-b-0 ${
                    idx % 2 === 1 ? "bg-[var(--bg-surface)]/15" : ""
                  }`}
                  style={{ height: ROW_H }}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                      done ? "bg-emerald-500" : overdue ? "bg-red-500" : "bg-cyan-500"
                    }`}
                  />
                  <span
                    className={`text-xs truncate ${
                      done ? "text-[var(--text-dim)] line-through" : "text-[var(--text)] font-medium"
                    }`}
                    title={m.name}
                  >
                    {m.name}
                  </span>
                </div>
              );
            })}
          </div>

          {/* ─── 우측: 타임라인 컬럼 ─── */}
          <div className="relative flex-1 min-w-0" style={{ minWidth: TIMELINE_MIN_W }}>
            {/* 헤더 — 일자 + 요일 */}
            <div
              className="relative border-b border-[var(--border)] bg-gradient-to-b from-[var(--bg-surface)]/40 to-transparent"
              style={{ height: HEADER_H }}
            >
              {dayTicks.map((t, i) => (
                <div
                  key={i}
                  className={`absolute top-0 bottom-0 ${
                    t.isMonthStart
                      ? "border-l border-[var(--border)]"
                      : t.weekday === 1
                      ? "border-l border-[var(--border)]/60"
                      : "border-l border-dashed border-[var(--border)]/25"
                  }`}
                  style={{ left: `${t.pct}%` }}
                >
                  <div className="absolute top-1 left-1 flex flex-col leading-tight">
                    <span
                      className={`text-[10px] font-semibold whitespace-nowrap ${
                        t.isMonthStart
                          ? "text-[var(--text)]"
                          : t.isWeekend
                          ? t.weekday === 0
                            ? "text-red-500/80"
                            : "text-cyan-500/80"
                          : "text-[var(--text-muted)]"
                      }`}
                    >
                      {t.label}
                    </span>
                    <span
                      className={`text-[9px] font-medium ${
                        t.weekday === 0 ? "text-red-500/60" : t.weekday === 6 ? "text-cyan-500/60" : "text-[var(--text-dim)]"
                      }`}
                    >
                      {t.sub}
                    </span>
                  </div>
                </div>
              ))}
              {/* 오늘 pill */}
              {todayInRange && (
                <div
                  className="absolute z-20 -translate-x-1/2 px-2 py-0.5 rounded-md bg-[var(--primary)] text-white text-[10px] font-bold shadow-md whitespace-nowrap"
                  style={{ left: `${todayPct}%`, top: 4 }}
                >
                  오늘
                </div>
              )}
            </div>

            {/* 막대 행들 */}
            <div className="relative">
              {/* 주말 컬럼 음영 (선택) — 가독성 보조 */}
              {dayTicks.map((t, i) =>
                t.isWeekend ? (
                  <div
                    key={`we-${i}`}
                    className={`absolute top-0 bottom-0 pointer-events-none ${
                      t.weekday === 0 ? "bg-red-500/[0.03]" : "bg-cyan-500/[0.03]"
                    }`}
                    style={{ left: `${t.pct}%`, width: `${100 / spanDays}%` }}
                    aria-hidden
                  />
                ) : null
              )}

              {/* today 수직선 */}
              {todayInRange && (
                <div
                  className="absolute top-0 bottom-0 z-10 pointer-events-none"
                  style={{ left: `${todayPct}%`, transform: "translateX(-50%)", width: 2 }}
                  aria-hidden
                >
                  <div className="w-full h-full bg-gradient-to-b from-[var(--primary)] via-[var(--primary)]/70 to-[var(--primary)]/30" />
                </div>
              )}

              {milestones.map((m, idx) => {
                const startT = m.start_date ? dateOnlyMs(m.start_date) : null;
                const dueT = m.due_date ? dateOnlyMs(m.due_date) : null;
                const sT = startT ?? dueT;
                const eT = dueT ?? startT;
                const done = !!m.completed_at;
                const overdue = !done && dueT !== null && dueT < today;
                const gradient = done
                  ? "from-emerald-500 to-emerald-400"
                  : overdue
                  ? "from-red-500 to-red-400"
                  : "from-cyan-500 to-cyan-400";
                const lineColor = done ? "bg-emerald-500" : overdue ? "bg-red-500" : "bg-cyan-500";
                const pillBg = done ? "bg-emerald-500" : overdue ? "bg-red-500" : "bg-cyan-500";

                // D-day
                const dDay = dueT !== null ? Math.round((dueT - today) / 864e5) : null;
                const dDayText =
                  dDay === null
                    ? null
                    : dDay === 0
                    ? "D-Day"
                    : dDay > 0
                    ? `D-${dDay}`
                    : `D+${-dDay}`;
                const dueDatePct = dueT !== null ? ((dueT - rangeStart) / span) * 100 : null;

                return (
                  <div
                    key={m.id}
                    className={`relative border-b border-[var(--border)]/60 last:border-b-0 group/bar ${
                      idx % 2 === 1 ? "bg-[var(--bg-surface)]/15" : ""
                    }`}
                    style={{ height: ROW_H }}
                  >
                    {/* 마감일 수직선 — 항상 옅게, 호버 시 진하게 */}
                    {dueDatePct !== null && dueDatePct >= 0 && dueDatePct <= 100 && (
                      <div
                        className={`absolute top-0 bottom-0 w-0.5 ${lineColor} opacity-30 group-hover/bar:opacity-100 transition-opacity pointer-events-none z-[5]`}
                        style={{ left: `${dueDatePct}%`, transform: "translateX(-50%)" }}
                        aria-hidden
                      />
                    )}

                    {/* 막대 */}
                    {sT !== null && eT !== null && (() => {
                      const left = Math.max(0, ((sT - rangeStart) / span) * 100);
                      const widthRaw = Math.max(((eT - sT) / span) * 100, 0.6);
                      const width = Math.min(widthRaw, 100 - left);
                      return (
                        <div
                          className={`absolute top-2 bottom-2 rounded-lg bg-gradient-to-r ${gradient} shadow-sm group-hover/bar:shadow-xl group-hover/bar:brightness-110 group-hover/bar:scale-y-110 transition-all flex items-center px-2.5 overflow-hidden cursor-default ring-1 ring-white/10 z-[6]`}
                          style={{ left: `${left}%`, width: `${width}%`, minWidth: 8 }}
                        >
                          <span className="text-[11px] font-bold text-white truncate drop-shadow">
                            {m.name}
                          </span>
                        </div>
                      );
                    })()}

                    {/* 호버 D-day pill — 마감일 수직선 위에 떠오름 */}
                    {dDayText && dueDatePct !== null && dueDatePct >= 0 && dueDatePct <= 100 && (
                      <div
                        className={`absolute z-40 px-2 py-1 rounded-md text-[10px] font-bold shadow-xl whitespace-nowrap opacity-0 group-hover/bar:opacity-100 transition-opacity pointer-events-none ${pillBg} text-white`}
                        style={{
                          left: `${dueDatePct}%`,
                          top: -6,
                          transform: "translate(-50%, -100%)",
                        }}
                      >
                        <div className="text-center">{dDayText}</div>
                        <div className="text-[9px] font-medium opacity-90 text-center">
                          마감 {m.due_date}
                          {done ? " · 완료" : overdue ? ` · 지연 ${-dDay!}일` : ""}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* 범례 */}
      <div className="flex items-center gap-3 px-3 py-2 border-t border-[var(--border)] bg-[var(--bg-surface)]/20 text-[10px] text-[var(--text-muted)] flex-wrap">
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-2 rounded-sm bg-gradient-to-r from-cyan-500 to-cyan-400" /> 진행중
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-2 rounded-sm bg-gradient-to-r from-emerald-500 to-emerald-400" /> 완료
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-4 h-2 rounded-sm bg-gradient-to-r from-red-500 to-red-400" /> 지연
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-0.5 h-3 bg-[var(--primary)]" /> 오늘
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-0.5 h-3 bg-cyan-500/60" /> 마감
        </span>
        <span className="ml-auto text-[var(--text-dim)] italic">막대 hover → D-day 표시</span>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────
// 캘린더 뷰 — 단순 월 그리드
// ─────────────────────────────────────────────────────

function CalendarView({ milestones }: { milestones: Milestone[] }) {
  const today = new Date();
  const [cursor, setCursor] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const { weeks, monthLabel, todayKey } = useMemo(() => {
    const y = cursor.getFullYear();
    const m = cursor.getMonth();
    const first = new Date(y, m, 1);
    const lastDay = new Date(y, m + 1, 0).getDate();
    const startWeekday = first.getDay(); // 0=일
    const cells: ({ d: number; key: string; otherMonth: boolean } | null)[] = [];
    // 이전 달 padding
    const prevLast = new Date(y, m, 0).getDate();
    for (let i = 0; i < startWeekday; i++) {
      const day = prevLast - startWeekday + 1 + i;
      const dt = new Date(y, m - 1, day);
      cells.push({ d: day, key: dateKey(dt), otherMonth: true });
    }
    for (let d = 1; d <= lastDay; d++) {
      const dt = new Date(y, m, d);
      cells.push({ d, key: dateKey(dt), otherMonth: false });
    }
    while (cells.length % 7 !== 0) {
      const idx = cells.length - lastDay - startWeekday + 1;
      const dt = new Date(y, m + 1, idx);
      cells.push({ d: idx, key: dateKey(dt), otherMonth: true });
    }
    const wks: typeof cells[] = [];
    for (let i = 0; i < cells.length; i += 7) wks.push(cells.slice(i, i + 7));
    return {
      weeks: wks,
      monthLabel: `${y}년 ${m + 1}월`,
      todayKey: dateKey(today),
    };
  }, [cursor, today]);

  // due_date 기준 그룹 (캘린더는 마감일 표시가 더 직관적)
  const byDate = useMemo(() => {
    const map: Record<string, Milestone[]> = {};
    milestones.forEach((m) => {
      if (!m.due_date) return;
      const k = m.due_date;
      (map[k] = map[k] || []).push(m);
    });
    return map;
  }, [milestones]);

  const selectedItems = selectedDate ? byDate[selectedDate] || [] : [];

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3">
      {/* 헤더 */}
      <div className="flex items-center justify-between mb-2">
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() - 1, 1))}
          className="px-2 py-1 text-xs rounded-lg hover:bg-[var(--bg-surface)]"
        >
          ‹
        </button>
        <div className="text-sm font-bold text-[var(--text)]">{monthLabel}</div>
        <button
          type="button"
          onClick={() => setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1))}
          className="px-2 py-1 text-xs rounded-lg hover:bg-[var(--bg-surface)]"
        >
          ›
        </button>
      </div>

      {/* 요일 헤더 */}
      <div className="grid grid-cols-7 gap-1 mb-1">
        {["일", "월", "화", "수", "목", "금", "토"].map((w, i) => (
          <div
            key={w}
            className={`text-[10px] font-semibold text-center py-1 ${
              i === 0 ? "text-red-500/70" : i === 6 ? "text-cyan-500/70" : "text-[var(--text-muted)]"
            }`}
          >
            {w}
          </div>
        ))}
      </div>

      {/* 셀 */}
      <div className="space-y-1">
        {weeks.map((wk, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1">
            {wk.map((c, ci) => {
              if (!c) return <div key={ci} />;
              const items = byDate[c.key] || [];
              const isToday = c.key === todayKey;
              const isSelected = c.key === selectedDate;
              return (
                <button
                  key={c.key + ci}
                  type="button"
                  onClick={() => setSelectedDate(items.length > 0 ? c.key : null)}
                  disabled={items.length === 0}
                  className={`min-h-[52px] p-1 rounded-md text-left transition border ${
                    isSelected
                      ? "border-[var(--primary)] bg-[var(--primary)]/10"
                      : isToday
                      ? "border-[var(--primary)]/40 bg-[var(--primary)]/5"
                      : "border-transparent hover:bg-[var(--bg-surface)]"
                  } ${c.otherMonth ? "opacity-40" : ""} ${items.length === 0 ? "cursor-default" : "cursor-pointer"}`}
                >
                  <div
                    className={`text-[10px] font-bold ${
                      isToday ? "text-[var(--primary)]" : c.otherMonth ? "text-[var(--text-dim)]" : "text-[var(--text)]"
                    }`}
                  >
                    {c.d}
                  </div>
                  <div className="mt-0.5 space-y-0.5">
                    {items.slice(0, 2).map((m) => {
                      const done = !!m.completed_at;
                      const overdue = !done && new Date(m.due_date!) < new Date(todayKey);
                      return (
                        <div
                          key={m.id}
                          className={`text-[9px] leading-tight rounded px-1 py-0.5 truncate ${
                            done
                              ? "bg-emerald-500/15 text-emerald-600"
                              : overdue
                              ? "bg-red-500/15 text-red-600"
                              : "bg-cyan-500/15 text-cyan-600"
                          }`}
                          title={m.name}
                        >
                          {m.name}
                        </div>
                      );
                    })}
                    {items.length > 2 && (
                      <div className="text-[9px] text-[var(--text-muted)] px-1">+{items.length - 2}건</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        ))}
      </div>

      {/* 선택일 팝오버 (간단히 인라인 패널) */}
      {selectedDate && selectedItems.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <div className="flex items-center justify-between mb-2">
            <div className="text-xs font-bold text-[var(--text)]">📅 {selectedDate}</div>
            <button
              type="button"
              onClick={() => setSelectedDate(null)}
              className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]"
            >
              닫기 ✕
            </button>
          </div>
          <ul className="space-y-1">
            {selectedItems.map((m) => {
              const done = !!m.completed_at;
              return (
                <li
                  key={m.id}
                  className={`text-xs px-2 py-1.5 rounded-md ${
                    done ? "bg-emerald-500/10 text-emerald-600 line-through" : "bg-[var(--bg-surface)] text-[var(--text)]"
                  }`}
                >
                  {m.name}
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

// ─── helpers ─────────────────────────────────────────

function dateKey(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function dDayLabel(dueDateStr: string) {
  const today = new Date(new Date().toDateString()).getTime();
  const due = new Date(dueDateStr).getTime();
  const diff = Math.round((due - today) / 864e5);
  if (diff === 0) return "D-Day";
  if (diff > 0) return `D-${diff}`;
  return `D+${-diff}`;
}
