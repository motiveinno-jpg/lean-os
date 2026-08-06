"use client";

// 기간 고르기 — 달력 두 달을 나란히 놓고 시작일·종료일을 찍는다 (2026-08-06 사장님 이미지 지시).
//   고르고 '확인'을 눌러야 반영된다 — 첫 클릭(시작)만 하고 닫히면 엉뚱한 기간이 걸린다.
//   기간을 넓히면 아직 안 받아 온 날이 생기므로, 확인할 때 그 날들을 매체에서 채운다(부모가 한다).

import { useMemo, useState } from "react";
import { todayKst } from "@/lib/kst";

const WD = ["일", "월", "화", "수", "목", "금", "토"];
const ymd = (d: Date) => d.toISOString().slice(0, 10);
const monthStart = (y: number, m: number) => new Date(Date.UTC(y, m, 1));

function monthDays(y: number, m: number) {
  const first = monthStart(y, m);
  const days: (string | null)[] = Array.from({ length: first.getUTCDay() }, () => null);
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  for (let d = 1; d <= last; d++) days.push(ymd(new Date(Date.UTC(y, m, d))));
  return days;
}

export function AdRangePicker({ since, until, onApply, onClose }: {
  since: string; until: string;
  onApply: (since: string, until: string) => void;
  onClose: () => void;
}) {
  const [a, setA] = useState<string>(since);
  const [b, setB] = useState<string>(until);
  const [half, setHalf] = useState(false);        // 시작만 찍은 상태
  const [cursor, setCursor] = useState(() => {
    const d = new Date(`${since || todayKst()}T00:00:00Z`);
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });

  const months = useMemo(() => {
    const next = new Date(Date.UTC(cursor.y, cursor.m + 1, 1));
    return [
      { y: cursor.y, m: cursor.m, days: monthDays(cursor.y, cursor.m) },
      { y: next.getUTCFullYear(), m: next.getUTCMonth(), days: monthDays(next.getUTCFullYear(), next.getUTCMonth()) },
    ];
  }, [cursor]);

  const pick = (d: string) => {
    if (!half) { setA(d); setB(d); setHalf(true); return; }
    //   두 번째 클릭이 시작보다 앞이면 뒤집어 준다 — 순서를 강요하지 않는다
    if (d < a) { setB(a); setA(d); } else setB(d);
    setHalf(false);
  };
  const move = (delta: number) => setCursor((c) => {
    const d = new Date(Date.UTC(c.y, c.m + delta, 1));
    return { y: d.getUTCFullYear(), m: d.getUTCMonth() };
  });

  const today = todayKst();
  return (
    <div className="pb-doc-modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="pb-doc-box adr-box">
        <b className="adr-head">{a} ~ {b}</b>
        <div className="adr-months">
          {months.map((mo, i) => (
            <div key={`${mo.y}-${mo.m}`} className="adr-month">
              <div className="adr-mhead">
                {i === 0 && <button type="button" onClick={() => move(-1)} aria-label="이전 달">‹</button>}
                <b>{mo.y}년 {mo.m + 1}월</b>
                {i === 1 && <button type="button" className="adr-next" onClick={() => move(1)} aria-label="다음 달">›</button>}
              </div>
              <div className="adr-wd">{WD.map((w) => <em key={w}>{w}</em>)}</div>
              <div className="adr-grid">
                {mo.days.map((d, j) => d === null ? <span key={`e${j}`} /> : (
                  <button key={d} type="button" disabled={d > today}
                    className={`adr-day ${d === a || d === b ? "adr-day-edge" : d > a && d < b ? "adr-day-in" : ""}`}
                    onClick={() => pick(d)}>{Number(d.slice(8))}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        <p className="adr-note">
          {half ? "끝나는 날을 한 번 더 고르세요." : "고른 기간에 아직 안 받아 온 날이 있으면 확인할 때 매체에서 채웁니다(최대 92일)."}
        </p>
        <span className="pb-collabels-foot">
          <button type="button" onClick={onClose}>취소</button>
          <button type="button" className="pb-collabels-go" disabled={half} onClick={() => onApply(a, b)}>확인</button>
        </span>
      </div>
    </div>
  );
}
