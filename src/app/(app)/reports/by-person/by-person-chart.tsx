"use client";

/* 인원별 급여 — 차트 키트의 가로 막대로 그린다 (2026-08-07 키트 확산).
 *
 *   예전엔 이 파일이 SVG 축·격자·막대를 직접 그렸다. 그래서 눈금 모양·값 표시 방식이
 *   다른 화면과 조금씩 달랐고, 이름이 길면 x축에서 잘렸다(5글자에서 '…').
 *   사람 이름은 가로로 읽는 게 자연스럽고 순위 비교도 쉬워 가로 막대로 바꿨다 —
 *   키트가 눈금·간격·색을 맡으므로 이 파일은 '무엇을 보여줄지'만 정한다.
 */

import { BarChart } from "@/components/charts/kit";

interface Row { [person: string]: number }
interface ByPersonChartProps {
  people: string[];
  payByPerson: Row;
}

/** 한 화면에 들어오는 만큼만 — 나머지는 아래 표에서 본다 */
const MAX_BARS = 12;

export default function ByPersonChart({ people, payByPerson }: ByPersonChartProps) {
  const ranked = [...people]
    .map((p) => ({ label: p, value: payByPerson[p] || 0 }))
    .filter((x) => x.value > 0)
    .sort((a, b) => b.value - a.value)
    .slice(0, MAX_BARS);

  if (ranked.length === 0) {
    return <p className="py-8 text-center text-xs text-[var(--text-dim)]">급여 자료가 없어요.</p>;
  }

  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="mb-3">
        <h3 className="text-sm font-bold text-[var(--text)]">인원별 급여</h3>
        <p className="mt-0.5 text-[10px] text-[var(--text-dim)]">
          많이 받는 순 상위 {Math.min(MAX_BARS, ranked.length)}명 · 연 급여 합계
        </p>
      </div>
      {/*   급여는 '경고'가 아니라 '얼마'다 — 한 계열이므로 색 하나로 두고 이름은 왼쪽에서 읽는다 */}
      <BarChart data={ranked.map((r) => ({ ...r, color: "var(--viz-2)" }))} unit="원" />
    </div>
  );
}
