"use client";

// 캘린더 보기 — 날짜 칸을 달력에 얹는다 (2026-08-04 기획 4차).
//
//   타임라인은 '기간'을, 캘린더는 '언제'를 본다. 할 일·요청처럼 마감만 있는 일은
//   막대보다 달력이 자연스럽다. 읽는 화면이므로 입력은 하지 않는다 —
//   줄을 누르면 상세 서랍이 열려 거기서 고친다.

import { useMemo, useState } from "react";
import { todayKst } from "@/lib/kst";
import { START_DATE_RE, type BoardColumn, type BoardItem } from "@/lib/project-boards";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export function BoardCalendar({ items, cols, flowCol, onOpen }: {
  items: BoardItem[];
  cols: BoardColumn[];
  flowCol: BoardColumn | null;
  onOpen: (itemId: string) => void;
}) {
  // 기준 날짜 — 마감 계열을 먼저 쓴다(시작일로 달력을 그리면 '언제까지'가 안 보인다)
  const dateCols = cols.filter((c) => c.type === "date");
  const [colId, setColId] = useState<string>(
    (dateCols.find((c) => !START_DATE_RE.test(c.name)) || dateCols[0])?.id || "",
  );
  const [offset, setOffset] = useState(0);   // 달 이동

  const today = todayKst();
  const base = useMemo(() => {
    const d = new Date(`${today}T00:00:00`);
    return new Date(d.getFullYear(), d.getMonth() + offset, 1);
  }, [today, offset]);

  const year = base.getFullYear();
  const month = base.getMonth();
  const firstDow = base.getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const byDay = useMemo(() => {
    const m: Record<string, BoardItem[]> = {};
    for (const it of items) {
      const v = String(it.values?.[colId] || "");
      if (!/^\d{4}-\d{2}-\d{2}/.test(v)) continue;
      (m[v.slice(0, 10)] = m[v.slice(0, 10)] || []).push(it);
    }
    return m;
  }, [items, colId]);

  const undated = items.filter((it) => !/^\d{4}-\d{2}-\d{2}/.test(String(it.values?.[colId] || "")));

  const colorOf = (it: BoardItem) => {
    if (!flowCol) return "var(--primary)";
    const opt = ((flowCol.settings?.options || []) as any[]).find((o) => o.id === it.values?.[flowCol.id]);
    return opt?.color || "var(--text-dim)";
  };

  const cells: { key: string; date: string | null; day: number | null }[] = [];
  for (let i = 0; i < firstDow; i++) cells.push({ key: `pad-${i}`, date: null, day: null });
  for (let d = 1; d <= daysInMonth; d++) {
    const date = `${year}-${String(month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ key: date, date, day: d });
  }

  if (dateCols.length === 0) {
    return <p className="pj-sec-empty">날짜 칸이 있어야 달력에 얹을 수 있어요. 표에서 날짜 컬럼을 하나 만들어 주세요.</p>;
  }

  return (
    <div className="pb-cal">
      <div className="pb-cal-head">
        <button type="button" onClick={() => setOffset((o) => o - 1)} aria-label="이전 달">‹</button>
        <b>{year}년 {month + 1}월</b>
        <button type="button" onClick={() => setOffset((o) => o + 1)} aria-label="다음 달">›</button>
        {offset !== 0 && <button type="button" className="pb-cal-today" onClick={() => setOffset(0)}>오늘</button>}
        {dateCols.length > 1 && (
          <select value={colId} onChange={(e) => setColId(e.target.value)} className="pb-cal-pick" title="기준 날짜">
            {dateCols.map((c) => <option key={c.id} value={c.id}>{c.name} 기준</option>)}
          </select>
        )}
      </div>

      <div className="pb-cal-dow">
        {WEEK.map((w) => <span key={w}>{w}</span>)}
      </div>
      <div className="pb-cal-grid">
        {cells.map((c) => (
          <div key={c.key} className={`pb-cal-cell ${c.date === today ? "pb-cal-today-cell" : ""} ${c.date ? "" : "pb-cal-pad"}`}>
            {c.day && <span className="pb-cal-day">{c.day}</span>}
            {(byDay[c.date || ""] || []).map((it) => (
              <button key={it.id} type="button" className="pb-cal-item" onClick={() => onOpen(it.id)}
                title={it.name || "(이름 없음)"}>
                <i style={{ background: colorOf(it) }} />
                {it.name || "(이름 없음)"}
              </button>
            ))}
          </div>
        ))}
      </div>
      {undated.length > 0 && (
        <p className="pb-gantt-undated">날짜가 없어 안 나온 것 {undated.length}건 — 표 보기에서 채워 주세요.</p>
      )}
    </div>
  );
}
