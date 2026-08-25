// 정리 양식 — 무엇을 어떤 순서로 볼지 (2026-08-05 사장님 지시).
//
//   "정리에서 보여주는 데이터들도 템플릿 형태로 제공해서 내가 원하는 템플릿으로
//    데이터를 정리해서 보는 게 좋을 것 같아."
//
// 담는 건 **끈 것(off)과 순서(order)** 뿐이다. 켠 것만 담으면 나중에 새 지표가 생겼을 때
// 영영 안 보이게 된다 — 모르는 항목은 켜진 채 뒤에 붙는 쪽이 안전하다.

/** 어떤 눈으로 볼지 — 타임라인·캘린더도 결국 '정리하는 한 방법'이라 여기 들어온다
 *  (2026-08-05 사장님: "타임라인·캘린더는 정리 기준에서 정리 템플릿에 속하는 부분.
 *   무조건 보여주기보다 필요할 때 골라서 보고, 정리도 간트·원형·막대 중에 골라 볼 수 있게"). */
export type SummaryShape = "auto" | "gantt" | "calendar" | "donut" | "bars" | "line" | "cards";
export const SUMMARY_SHAPES: SummaryShape[] = ["auto", "gantt", "calendar", "donut", "bars", "line", "cards"];

export type SummaryLayout = { off: string[]; order: string[]; shape?: SummaryShape };

export function normalizeLayout(v: any): SummaryLayout {
  const off = Array.isArray(v?.off) ? v.off.filter((x: any) => typeof x === "string") : [];
  const order = Array.isArray(v?.order) ? v.order.filter((x: any) => typeof x === "string") : [];
  const shape = SUMMARY_SHAPES.includes(v?.shape) ? (v.shape as SummaryShape) : undefined;
  return shape ? { off, order, shape } : { off, order };
}

/** 양식대로 골라 늘어놓는다. 양식에 없는 항목은 켜진 채 원래 순서로 뒤에 남는다. */
export function applyLayout<T extends { id: string }>(items: T[], layout: SummaryLayout | null): T[] {
  if (!layout) return items;
  const off = new Set(layout.off);
  const rank = new Map(layout.order.map((id, i) => [id, i]));
  const kept = items.filter((it) => !off.has(it.id));
  return kept
    .map((it, i) => ({ it, i, r: rank.has(it.id) ? (rank.get(it.id) as number) : Number.MAX_SAFE_INTEGER }))
    .sort((a, b) => (a.r === b.r ? a.i - b.i : a.r - b.r))
    .map((x) => x.it);
}

/** 지금 화면 구성을 양식으로 굳힌다 — 보이는 순서가 곧 order, 나머지가 off */
export function layoutFrom(all: { id: string }[], visibleIds: string[]): SummaryLayout {
  const on = new Set(visibleIds);
  return { off: all.map((a) => a.id).filter((id) => !on.has(id)), order: [...visibleIds] };
}
