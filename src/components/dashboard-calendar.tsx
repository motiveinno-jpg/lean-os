"use client";

// 대시보드 미니 캘린더 — 이번 달 일정(파랑)·할 일(주황)을 달력으로 한눈에(2026-07-14).
//   날짜 클릭 시 그날 항목을 아래에 간략 표시, 클릭하면 /schedule 로 이동. 데이터는 MyTodosWidget 과 동일 캐시 공유.

import Link from "next/link";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { getTodos, getMonthEvents, type ScheduleTodo } from "@/lib/schedule";

const WD = ["일", "월", "화", "수", "목", "금", "토"];
function ymd(y: number, m: number, d: number) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function DashboardCalendar({ userId, companyId }: { userId: string; companyId: string }) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth(); // 0-index
  const todayStr = ymd(year, month, now.getDate());
  const [selected, setSelected] = useState<string>(todayStr);

  const { data: todos = [] } = useQuery({
    queryKey: ["schedule-todos", userId, false],
    queryFn: () => getTodos(userId, { includeDone: false }),
    enabled: !!userId, staleTime: 60_000,
  });
  const { data: events = [] } = useQuery({
    queryKey: ["schedule-events", companyId, year, month, "both", userId],
    queryFn: () => getMonthEvents(companyId, year, month, { scope: "both", userId }),
    enabled: !!companyId && !!userId, staleTime: 60_000,
  });

  // 날짜별 마커 집계
  const byDate: Record<string, { todo: number; event: number }> = {};
  const bump = (raw: string | null | undefined, kind: "todo" | "event") => {
    const k = (raw || "").slice(0, 10);
    if (!k) return;
    (byDate[k] || (byDate[k] = { todo: 0, event: 0 }))[kind]++;
  };
  (todos as ScheduleTodo[]).forEach((t) => bump(t.due_date, "todo"));
  (events as any[]).forEach((e) => { if (!e.completed) bump(e.start_at, "event"); });

  // 달력 셀
  const startWd = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const cells: (number | null)[] = [];
  for (let i = 0; i < startWd; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  // 선택일 항목
  const selEvents = (events as any[]).filter((e) => (e.start_at || "").slice(0, 10) === selected && !e.completed);
  const selTodos = (todos as ScheduleTodo[]).filter((t) => (t.due_date || "").slice(0, 10) === selected);
  const selItems = [
    ...selEvents.map((e) => ({ id: `e${e.id}`, title: e.title as string, kind: "event" as const })),
    ...selTodos.map((t) => ({ id: `t${t.id}`, title: t.title, kind: "todo" as const })),
  ];

  return (
    <div className="dashboard-calendar glass-card">
      <div className="dashboard-calendar-header">
        <h3 className="text-[13px] font-bold text-[var(--text)]">{year}년 {month + 1}월 <span className="text-[var(--text-dim)] font-normal">일정 · 할 일</span></h3>
        <Link href="/schedule" className="text-[11px] font-semibold text-[var(--primary)] hover:underline no-underline">전체 보기 →</Link>
      </div>

      <div className="dashboard-calendar-weekdays">
        {WD.map((w, i) => (
          <div key={w} className={`text-center text-[10px] font-semibold ${i === 0 ? "text-[var(--danger)]" : i === 6 ? "text-[var(--primary)]" : "text-[var(--text-dim)]"}`}>{w}</div>
        ))}
      </div>

      <div className="dashboard-calendar-days">
        {cells.map((d, i) => {
          if (d === null) return <div key={`x${i}`} className="aspect-square" />;
          const key = ymd(year, month, d);
          const marks = byDate[key];
          const isToday = key === todayStr;
          const isSel = key === selected;
          return (
            <button key={key} type="button" onClick={() => setSelected(key)}
              className={`aspect-square rounded-lg flex flex-col items-center justify-center leading-none transition ${
                isSel ? "bg-[var(--primary)] text-white font-bold" : isToday ? "bg-[var(--primary)]/12 text-[var(--primary)] font-bold" : "text-[var(--text)] hover:bg-[var(--bg-surface)]"
              }`}>
              <span className="text-[11px]">{d}</span>
              <span className="flex gap-0.5 mt-0.5 h-1 items-center">
                {marks?.event ? <span className={`w-1 h-1 rounded-full ${isSel ? "bg-white" : "bg-[var(--primary)]"}`} /> : null}
                {marks?.todo ? <span className={`w-1 h-1 rounded-full ${isSel ? "bg-white" : "bg-[var(--warning)]"}`} /> : null}
              </span>
            </button>
          );
        })}
      </div>

      <div className="dashboard-calendar-selected">
        <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">
          {Number(selected.slice(5, 7))}월 {Number(selected.slice(8, 10))}일{selected === todayStr ? " · 오늘" : ""}
        </div>
        {selItems.length === 0 ? (
          <div className="text-[11px] text-[var(--text-dim)] py-1">일정·할 일이 없습니다.</div>
        ) : (
          <div className="dashboard-calendar-items">
            {selItems.slice(0, 4).map((it) => (
              <Link key={it.id} href="/schedule" className="flex items-center gap-2 text-[12px] text-[var(--text)] no-underline hover:text-[var(--primary)] transition">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${it.kind === "event" ? "bg-[var(--primary)]" : "bg-[var(--warning)]"}`} />
                <span className="truncate">{it.title}</span>
              </Link>
            ))}
            {selItems.length > 4 && <Link href="/schedule" className="text-[11px] text-[var(--text-dim)] hover:text-[var(--primary)] no-underline">외 {selItems.length - 4}건 →</Link>}
          </div>
        )}
      </div>
    </div>
  );
}
