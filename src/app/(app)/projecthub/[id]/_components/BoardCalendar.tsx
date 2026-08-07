"use client";

// 캘린더 보기 — 날짜 칸을 달력에 얹는다 (2026-08-04 기획 4차).
//
//   타임라인은 '기간'을, 캘린더는 '언제'를 본다. 할 일·요청처럼 마감만 있는 일은
//   막대보다 달력이 자연스럽다. 줄을 누르면 상세 서랍이 열려 거기서 고친다.
//
//   2026-08-07 — '일정 · 마일스톤' 의 **첫 화면**이 되면서 입력이 생겼다(사장님 지시).
//   기간을 잡는 일인데 표에 날짜를 타이핑하고 있었다. 이제 **빈 칸을 끌면** 그 자리에
//   일정이 생긴다(시작·종료 칸에 그대로 들어간다). onCreateRange 를 준 화면에서만 켜진다.

import { useMemo, useState } from "react";
import { todayKst } from "@/lib/kst";
import { START_DATE_RE, type BoardColumn, type BoardItem } from "@/lib/project-boards";

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

export function BoardCalendar({ items, cols, flowCol, onOpen, onCreateRange }: {
  items: BoardItem[];
  cols: BoardColumn[];
  flowCol: BoardColumn | null;
  onOpen: (itemId: string) => void;
  /** 빈 칸을 끌어 기간을 만든다 — 주면 입력 화면이 되고, 없으면 읽기 전용 그대로 */
  onCreateRange?: (from: string, to: string, name: string) => void;
}) {
  // 기준 날짜 — 마감 계열을 먼저 쓴다(시작일로 달력을 그리면 '언제까지'가 안 보인다)
  const dateCols = cols.filter((c) => c.type === "date");
  const [colId, setColId] = useState<string>(
    (dateCols.find((c) => !START_DATE_RE.test(c.name)) || dateCols[0])?.id || "",
  );
  const [offset, setOffset] = useState(0);   // 달 이동
  //   끌어서 만들기 — 누른 날부터 손을 뗀 날까지가 기간이다
  const [drag, setDrag] = useState<{ a: string; b: string } | null>(null);
  const [draft, setDraft] = useState<{ from: string; to: string; name: string } | null>(null);

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
      {onCreateRange && !draft && (
        <p className="pb-cal-hint"><i /> 빈 칸을 끌면 그 자리에 일정이 생깁니다 — 이름만 적으면 끝</p>
      )}
      {draft && (
        <div className="pb-cal-draft">
          <b>{draft.from}{draft.to !== draft.from ? ` ~ ${draft.to}` : ""}</b>
          <input autoFocus value={draft.name} placeholder="무슨 일정인가요"
            onChange={(e) => setDraft((d) => (d ? { ...d, name: e.target.value } : d))}
            onKeyDown={(e) => {
              if (e.key === "Escape") { setDraft(null); return; }
              if (e.key === "Enter" && !e.nativeEvent.isComposing && draft.name.trim()) {
                onCreateRange?.(draft.from, draft.to, draft.name.trim());
                setDraft(null);
              }
            }} />
          <button type="button" disabled={!draft.name.trim()}
            onClick={() => { onCreateRange?.(draft.from, draft.to, draft.name.trim()); setDraft(null); }}>만들기</button>
          <button type="button" className="pb-cal-draft-x" onClick={() => setDraft(null)}>취소</button>
        </div>
      )}
      <div className="pb-cal-grid" onPointerLeave={() => setDrag(null)}>
        {cells.map((c) => {
          const inDrag = !!drag && !!c.date
            && c.date >= (drag.a < drag.b ? drag.a : drag.b) && c.date <= (drag.a < drag.b ? drag.b : drag.a);
          return (
          <div key={c.key}
            className={`pb-cal-cell ${c.date === today ? "pb-cal-today-cell" : ""} ${c.date ? "" : "pb-cal-pad"} ${inDrag ? "pb-cal-picking" : ""} ${onCreateRange && c.date ? "pb-cal-drawable" : ""}`}
            onPointerDown={(e) => {
              if (!onCreateRange || !c.date) return;
              if ((e.target as HTMLElement).closest("button")) return;   // 일정 카드를 누른 것은 열기다
              setDraft(null);
              setDrag({ a: c.date, b: c.date });
            }}
            onPointerEnter={() => { if (drag && c.date) setDrag((d) => (d ? { ...d, b: c.date! } : d)); }}
            onPointerUp={() => {
              if (!drag || !onCreateRange) return;
              const from = drag.a < drag.b ? drag.a : drag.b;
              const to = drag.a < drag.b ? drag.b : drag.a;
              setDrag(null);
              setDraft({ from, to, name: "" });
            }}>
            {c.day && <span className="pb-cal-day">{c.day}</span>}
            {(byDay[c.date || ""] || []).map((it) => (
              <button key={it.id} type="button" className="pb-cal-item" onClick={() => onOpen(it.id)}
                title={it.name || "(이름 없음)"}>
                <i style={{ background: colorOf(it) }} />
                {it.name || "(이름 없음)"}
              </button>
            ))}
          </div>
          );
        })}
      </div>
      {undated.length > 0 && (
        <p className="pb-gantt-undated">날짜가 없어 안 나온 것 {undated.length}건 — 표 보기에서 채워 주세요.</p>
      )}
    </div>
  );
}
