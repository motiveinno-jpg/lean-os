"use client";

// 월 선택 — 브라우저 기본 <input type="month"> 는 OS 로캘을 따라 "August 2026" 처럼 영어로 떠
//   한국어 화면과 어긋났다 (2026-09-01 전수점검 ⑥). "YYYY년 M월" 셀렉트로 통일한다.
//   값 형식은 종전과 같은 "YYYY-MM" — 저장·비교 로직 무변경.
import { todayKst } from "@/lib/kst";

function label(m: string): string {
  const [y, mm] = m.split("-");
  return `${y}년 ${Number(mm)}월`;
}

export function MonthSelect({ value, onChange, className = "inv-input", from = "2022-01", aheadMonths = 12, ariaLabel }: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
  /** 목록 시작 월(포함) — 오래된 자산 상각 시작 월 등은 넉넉히 과거까지 */
  from?: string;
  /** 현재 월 이후로 몇 달까지 보여줄지 */
  aheadMonths?: number;
  ariaLabel?: string;
}) {
  const cur = todayKst().slice(0, 7);
  let [y, m] = cur.split("-").map(Number);
  m += aheadMonths;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  const list: string[] = [];
  let cursor = `${y}-${String(m).padStart(2, "0")}`;
  let guard = 0;
  while (cursor >= from && guard++ < 400) {
    list.push(cursor);
    let [cy, cm] = cursor.split("-").map(Number);
    cm -= 1;
    if (cm === 0) { cy -= 1; cm = 12; }
    cursor = `${cy}-${String(cm).padStart(2, "0")}`;
  }
  return (
    <select className={className} value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
      {value && !list.includes(value) && <option value={value}>{label(value)}</option>}
      {list.map((mo) => <option key={mo} value={mo}>{label(mo)}</option>)}
    </select>
  );
}
