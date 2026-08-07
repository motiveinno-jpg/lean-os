"use client";

// 캘린더 보기 — 날짜 칸을 달력에 얹는다 (2026-08-04 기획 4차).
//
//   타임라인은 '기간'을, 캘린더는 '언제'를 본다. 할 일·요청처럼 마감만 있는 일은
//   막대보다 달력이 자연스럽다. 줄을 누르면 상세 서랍이 열려 거기서 고친다.
//
//   2026-08-07 — '일정 · 마일스톤' 의 **첫 화면**이 되면서 입력이 생겼다(사장님 지시).
//   기간을 잡는 일인데 표에 날짜를 타이핑하고 있었다. 이제 **빈 칸을 끌면** 그 자리에
//   일정이 생긴다(시작·종료 칸에 그대로 들어간다). onCreateRange 를 준 화면에서만 켜진다.

import { useEffect, useMemo, useState } from "react";
import { todayKst } from "@/lib/kst";
import { START_DATE_RE, spanColumnsOf, type BoardColumn, type BoardItem } from "@/lib/project-boards";

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
  //   시작·종료가 있으면 **기간**이 이 표의 본체다 — 하루 점이 아니라 막대로 이어 그린다
  //   (2026-08-07 시연: 8/11~8/25 퍼블리싱이 8/11 하루에만 점처럼 떴다).
  const span = spanColumnsOf(cols);
  const SPAN_KEY = "__span__";
  const [colId, setColId] = useState<string>(
    span ? SPAN_KEY : (dateCols.find((c) => !START_DATE_RE.test(c.name)) || dateCols[0])?.id || "",
  );
  const [offset, setOffset] = useState(0);   // 달 이동
  //   ⚠️ 표를 옮겨도 이 컴포넌트는 같은 자리에 남아 상태가 유지된다 — 앞 표의 날짜 칸 id 를
  //      그대로 들고 있으면 값이 하나도 안 잡혀 전부 '날짜 없음' 으로 떨어진다(2026-08-07 실측).
  //      칸이 바뀌면 그 표의 기본 칸으로 되돌린다.
  const dateIds = dateCols.map((c) => c.id).join(",");
  useEffect(() => {
    setColId((prev) => ((prev === SPAN_KEY && span) || dateCols.some((c) => c.id === prev)
      ? prev
      : span ? SPAN_KEY : (dateCols.find((c) => !START_DATE_RE.test(c.name)) || dateCols[0])?.id || ""));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dateIds]);
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

  //   기간 보기에서는 한 줄이 여러 날에 걸친다 — 걸친 날마다 조각을 놓고 양 끝만 둥글게 한다
  const rangeOf = (it: BoardItem) => {
    if (!span) return null;
    const a = String(it.values?.[span.start.id] || "").slice(0, 10);
    const b = String(it.values?.[span.end.id] || "").slice(0, 10);
    const ok = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
    if (!ok(a) && !ok(b)) return null;
    const from = ok(a) ? a : b, to = ok(b) ? b : a;
    return from <= to ? { from, to } : { from: to, to: from };
  };

  const byDay = useMemo(() => {
    const m: Record<string, { it: BoardItem; from: string; to: string }[]> = {};
    for (const it of items) {
      if (colId === SPAN_KEY) {
        const r = rangeOf(it);
        if (!r) continue;
        //   걸친 날을 하루씩 채운다(한 달 안에서만 그린다 — 그 이상은 화면 밖이다)
        for (let d = new Date(`${r.from}T00:00:00`); ; d.setDate(d.getDate() + 1)) {
          const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
          (m[key] = m[key] || []).push({ it, from: r.from, to: r.to });
          if (key >= r.to) break;
        }
        continue;
      }
      const v = String(it.values?.[colId] || "");
      if (!/^\d{4}-\d{2}-\d{2}/.test(v)) continue;
      const k = v.slice(0, 10);
      (m[k] = m[k] || []).push({ it, from: k, to: k });
    }
    return m;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, colId, span?.start.id, span?.end.id]);

  const undated = items.filter((it) => (colId === SPAN_KEY
    ? !rangeOf(it)
    : !/^\d{4}-\d{2}-\d{2}/.test(String(it.values?.[colId] || ""))));

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
        {(dateCols.length > 1 || span) && (
          <select value={colId} onChange={(e) => setColId(e.target.value)} className="pb-cal-pick" title="무엇을 기준으로 볼까">
            {span && <option value={SPAN_KEY}>기간({span.start.name}~{span.end.name})</option>}
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
            {(byDay[c.date || ""] || []).map(({ it, from, to }) => {
              const isStart = c.date === from;
              const isEnd = c.date === to;
              const dow = c.date ? new Date(`${c.date}T00:00:00`).getDay() : 0;
              //   이름은 시작한 날과 주가 바뀌는 날(일요일)에만 — 매 칸에 적으면 달력이 글자로 덮인다
              const showName = isStart || dow === 0;
              return (
                <button key={`${it.id}-${c.date}`} type="button" onClick={() => onOpen(it.id)}
                  className={`pb-cal-item ${from !== to ? "pb-cal-span" : ""} ${isStart ? "pb-cal-s" : ""} ${isEnd ? "pb-cal-e" : ""}`}
                  style={from !== to ? { background: colorOf(it) } : undefined}
                  title={`${it.name || "(이름 없음)"}${from !== to ? ` · ${from} ~ ${to}` : ""}`}>
                  {from === to && <i style={{ background: colorOf(it) }} />}
                  {showName ? (it.name || "(이름 없음)") : ""}
                </button>
              );
            })}
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
