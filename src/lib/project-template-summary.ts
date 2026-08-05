// 템플릿별 정리 — 일의 성격에 맞는 지표를 고른다 (2026-08-05 사장님 지시).
//
//   "할 일·진행, 요청·검수, 일정·마일스톤 등 각 템플릿에 맞춰 적합한 정리를 주고 싶다.
//    원그래프·막대그래프 등 다양한 보기 지표를 반영할 수 없나? 지금은 너무 단조롭다."
//
// 원칙(dataviz):
//   · 형태는 데이터가 하는 일이 정한다 — 부분/전체는 도넛, 크기 비교는 막대,
//     단계별 적체는 깔때기, 하나짜리 수치는 숫자(차트로 만들지 않는다).
//   · 도넛은 6조각 이하 · 값이 비슷한 것 비교엔 안 쓴다 · 2조각짜리는 만들지 않는다.
//   · 이름표(사람·거래처 같은 명목 분류)는 **한 가지 색**으로. 크기를 색으로 또 칠하지 않는다.
//   · 단계처럼 **순서가 있는 것**만 순서형(진한 정도) 색을 쓴다 — 그 색은 사용자가
//     상태 옵션에 지정한 색을 그대로 가져온다(같은 뜻은 같은 색).
//
// 절대규칙: 순수 함수. 조회 없음.

import { flowColumnOf, isDoneRow, terminalOptionId, START_DATE_RE, type BoardColumn, type BoardItem, type BoardGroup } from "@/lib/project-boards";
import { addDaysStr, mondayOfStr } from "@/lib/kst";

export type Slice = { key: string; label: string; value: number; color?: string };
export type Figure =
  /** 하나짜리 수치 — 차트로 만들지 않는다 */
  | { kind: "stat"; title: string; value: string; note?: string; tone?: "ok" | "bad" }
  /** 진행 링 — '전체 중 얼마나' 하나를 볼 때 */
  | { kind: "ring"; title: string; pct: number; center: string; note?: string; tone?: "ok" | "bad" }
  /** 도넛 — 부분/전체(6조각 이하). 가운데에 합계를 적는다 */
  | { kind: "donut"; title: string; slices: Slice[]; total: string; note?: string }
  /** 깔때기 — 단계별로 얼마나 남아 있나(순서가 있는 분류) */
  | { kind: "funnel"; title: string; slices: Slice[]; note?: string }
  /** 가로 막대 — 이름표별 크기 비교(색은 하나) */
  | { kind: "hbars"; title: string; rows: { label: string; value: number; text?: string }[]; note?: string }
  /** 세로 막대 — 주별 흐름 */
  | { kind: "weeks"; title: string; bars: { label: string; value: number; hot?: boolean }[]; note?: string };

const num = (v: any) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
const shortWon = (n: number) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 10_000).toLocaleString("ko-KR")}만`;
  return v.toLocaleString("ko-KR");
};

/** 상태 컬럼의 분포 — 색은 사용자가 지정한 옵션 색을 그대로 쓴다 */
function statusSlices(col: BoardColumn | null, items: BoardItem[]): Slice[] {
  if (!col) return [];
  const options: any[] = (col.settings?.options || []) as any[];
  return options
    .map((o) => ({
      key: String(o.id), label: String(o.label), color: String(o.color || "#C4C4C4"),
      value: items.filter((it) => it.values?.[col.id] === o.id).length,
    }))
    .filter((s) => s.value > 0);
}

/** 사람 컬럼별 건수 — 상위 5 + 나머지는 '기타'(색을 9개까지 늘리지 않는다) */
function byPerson(col: BoardColumn | null, items: BoardItem[], nameOf: (id: string) => string) {
  if (!col) return [];
  const m: Record<string, number> = {};
  let none = 0;
  for (const it of items) {
    const v = it.values?.[col.id];
    if (!v) { none++; continue; }
    m[String(v)] = (m[String(v)] || 0) + 1;
  }
  const rows = Object.entries(m)
    .map(([id, n]) => ({ label: nameOf(id) || "이름 없음", value: n }))
    .sort((a, b) => b.value - a.value);
  const top = rows.slice(0, 5);
  const rest = rows.slice(5).reduce((s, r) => s + r.value, 0);
  if (rest > 0) top.push({ label: `기타 ${rows.length - 5}명`, value: rest });
  if (none > 0) top.push({ label: "미지정", value: none });
  return top;
}

/** 앞으로 6주 마감 분포 */
function weekBuckets(col: BoardColumn | null, items: BoardItem[], today: string, openOnly: (it: BoardItem) => boolean) {
  if (!col) return [];
  const mon = mondayOfStr(today);
  const keys = Array.from({ length: 6 }, (_, i) => addDaysStr(mon, i * 7));
  const counts = keys.map(() => 0);
  let past = 0;
  for (const it of items) {
    if (!openOnly(it)) continue;
    const v = String(it.values?.[col.id] || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) continue;
    if (v < mon) { past++; continue; }
    const idx = keys.findIndex((k, i) => v >= k && (i === keys.length - 1 || v < keys[i + 1]));
    if (idx >= 0) counts[idx]++;
  }
  const bars = keys.map((k, i) => ({
    label: i === 0 ? "이번 주" : `${Number(k.slice(5, 7))}/${Number(k.slice(8, 10))}`,
    value: counts[i], hot: false,
  }));
  if (past > 0) bars.unshift({ label: "지남", value: past, hot: true });
  return bars;
}

/**
 * 템플릿 성격에 맞는 그림들을 고른다. 값이 없는 것은 아예 만들지 않는다.
 *
 * covers — 그림이 이미 말한 요약 카드의 이름표(`종류:라벨`). 화면에서 그만큼 카드를 뺀다.
 *   같은 얘기를 그림과 카드가 두 번 하면 정리가 아니라 나열이 된다.
 */
export function templateFigures(
  templateKey: string | null | undefined,
  cols: BoardColumn[], items: BoardItem[], groups: BoardGroup[],
  nameOf: (id: string) => string, today: string,
): { figures: Figure[]; covers: string[] } {
  if (items.length === 0) return { figures: [], covers: [] };
  const out: Figure[] = [];
  const covers = new Set<string>();
  const flow = flowColumnOf(cols);
  const term = flow ? terminalOptionId(flow) : null;
  const open = (it: BoardItem) => !isDoneRow(it as any, cols as any, groups as any);
  const dueCol = cols.find((c) => c.type === "date" && !START_DATE_RE.test(c.name)) || null;
  const personCols = cols.filter((c) => c.type === "person");
  const wonCols = cols.filter((c) => c.type === "number" && (c.settings?.unit || "") === "원");

  const doneCount = term && flow ? items.filter((it) => it.values?.[flow.id] === term).length : 0;
  const pct = flow && term ? Math.round((doneCount / items.length) * 100) : null;

  switch (templateKey) {
    case "todo": {
      if (pct != null) {
        out.push({ kind: "ring", title: "진행률", pct, center: `${pct}%`, note: `${items.length}건 중 ${doneCount}건 완료` });
        if (flow) covers.add(`status:${flow.name}`);
      }
      const st = statusSlices(flow, items);
      // 2조각짜리 도넛은 만들지 않는다(숫자가 낫다). 3~6조각일 때만.
      if (st.length >= 3 && flow) {
        out.push({ kind: "funnel", title: "단계별로 몇 건", slices: st, note: "왼쪽이 앞 단계" });
        covers.add(`status:${flow.name}`);
      }
      const pr = byPerson(personCols[0] || null, items, nameOf);
      if (pr.length > 0 && personCols[0]) {
        out.push({ kind: "hbars", title: `${personCols[0].name}별 맡은 건수`, rows: pr });
        covers.add(`person:${personCols[0].name}`);
      }
      const wk = weekBuckets(dueCol, items, today, open);
      if (wk.some((b) => b.value > 0) && dueCol) {
        out.push({ kind: "weeks", title: `${dueCol.name} 몰린 주`, bars: wk, note: "아직 안 끝난 것만" });
        covers.add(`date:${dueCol.name}`);
      }
      break;
    }
    case "review": {
      const st = statusSlices(flow, items);
      if (st.length >= 3 && flow) {
        out.push({ kind: "funnel", title: "어디에 쌓여 있나", slices: st, note: "요청부터 완료까지" });
        covers.add(`status:${flow.name}`);
      }
      const waiting = items.filter(open).length;
      out.push({
        kind: "stat", title: "처리 대기", value: `${waiting}건`,
        note: waiting === 0 ? "밀린 요청이 없어요" : `전체 ${items.length}건 중`,
        tone: waiting === 0 ? "ok" : undefined,
      });
      // 요청자와 담당이 따로 있는 표라 둘 다 보여준다 — 누가 많이 넣고 누가 많이 받나
      personCols.slice(0, 2).forEach((pc) => {
        const rows = byPerson(pc, items, nameOf);
        if (rows.length === 0) return;
        out.push({ kind: "hbars", title: `${pc.name}별`, rows });
        covers.add(`person:${pc.name}`);
      });
      const wk = weekBuckets(dueCol, items, today, open);
      if (wk.some((b) => b.value > 0) && dueCol) {
        out.push({ kind: "weeks", title: `${dueCol.name} 몰린 주`, bars: wk, note: "아직 안 끝난 것만" });
        covers.add(`date:${dueCol.name}`);
      }
      break;
    }
    case "schedule": {
      const startCol = cols.find((c) => c.type === "date" && START_DATE_RE.test(c.name)) || null;
      const endCol = cols.find((c) => c.type === "date" && c !== startCol) || null;
      const dates = items.flatMap((it) => [startCol, endCol].filter(Boolean)
        .map((c) => String(it.values?.[(c as BoardColumn).id] || "").slice(0, 10))
        .filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)));
      if (dates.length > 0) {
        const min = dates.reduce((a, b) => (a < b ? a : b));
        const max = dates.reduce((a, b) => (a > b ? a : b));
        const span = Math.max(1, (new Date(`${max}T00:00:00Z`).getTime() - new Date(`${min}T00:00:00Z`).getTime()) / 86_400_000);
        const gone = Math.min(span, Math.max(0, (new Date(`${today}T00:00:00Z`).getTime() - new Date(`${min}T00:00:00Z`).getTime()) / 86_400_000));
        const p = Math.round((gone / span) * 100);
        out.push({ kind: "ring", title: "기간 진행", pct: p, center: `${p}%`, note: `${min} ~ ${max}` });
      }
      const st = statusSlices(flow, items);
      if (st.length >= 3 && flow) {
        out.push({ kind: "donut", title: "상태 분포", slices: st, total: `${items.length}건` });
        covers.add(`status:${flow.name}`);
      }
      const late = items.filter((it) => {
        if (!open(it) || !endCol) return false;
        const v = String(it.values?.[endCol.id] || "").slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(v) && v < today;
      }).length;
      out.push({
        kind: "stat", title: "기한 지난 일정", value: `${late}건`,
        note: late === 0 ? "밀린 게 없어요" : "종료일이 지났는데 안 끝났어요",
        tone: late === 0 ? "ok" : "bad",
      });
      const wk = weekBuckets(endCol, items, today, open);
      if (wk.some((b) => b.value > 0)) out.push({ kind: "weeks", title: "끝나는 주", bars: wk });
      // 종료일은 '기한 지난 일정' + '끝나는 주' 가 이미 말한다
      if (endCol) covers.add(`date:${endCol.name}`);
      break;
    }
    case "cost":
    case "budget": {
      const [planCol, realCol] = wonCols;
      const planSum = planCol ? items.reduce((s, it) => s + num(it.values?.[planCol.id]), 0) : 0;
      const realSum = realCol ? items.reduce((s, it) => s + num(it.values?.[realCol.id]), 0) : 0;
      if (planSum > 0) {
        const p = Math.round((realSum / planSum) * 100);
        out.push({
          kind: "ring", title: `${planCol?.name || "계획"} 대비 ${realCol?.name || "실적"}`, pct: Math.min(100, p),
          center: `${p}%`, note: `${won(planSum)}원 중 ${won(realSum)}원`, tone: p > 100 ? "bad" : undefined,
        });
        // 링 하나가 계획·실적·차이를 다 말한다 — 합계 카드 셋을 뺀다
        if (planCol) covers.add(`number:${planCol.name}`);
        if (realCol) covers.add(`number:${realCol.name}`);
        if (planCol && realCol) covers.add(`diff:${planCol.name} − ${realCol.name}`);
      }
      // 구분(성격)별 금액 — 부분/전체라 도넛이 맞다. 조각이 많으면 막대로 내린다.
      const kindCol = cols.find((c) => c.type === "status" && c.id !== flow?.id) || (flow && flow.name !== "상태" ? flow : null);
      if (kindCol && realSum > 0) {
        const options: any[] = (kindCol.settings?.options || []) as any[];
        const slices = options.map((o) => ({
          key: String(o.id), label: String(o.label), color: String(o.color || "#C4C4C4"),
          value: items.filter((it) => it.values?.[kindCol.id] === o.id)
            .reduce((s, it) => s + num(it.values?.[realCol?.id || ""]), 0),
        })).filter((s) => s.value > 0);
        if (slices.length >= 3 && slices.length <= 6) {
          out.push({ kind: "donut", title: `${kindCol.name}별 ${realCol?.name || "금액"}`, slices, total: `${shortWon(realSum)}원` });
          covers.add(`status:${kindCol.name}`);
        } else if (slices.length > 0) {
          out.push({ kind: "hbars", title: `${kindCol.name}별 ${realCol?.name || "금액"}`,
            rows: slices.map((s) => ({ label: s.label, value: s.value, text: `${won(s.value)}원` })) });
          covers.add(`status:${kindCol.name}`);
        }
      }
      // 큰 항목 상위 — 어디에 돈이 몰렸나
      if (realCol) {
        const rows = items.map((it) => ({ label: it.name || "이름 없음", value: num(it.values?.[realCol.id]) }))
          .filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 5)
          .map((r) => ({ ...r, text: `${won(r.value)}원` }));
        if (rows.length >= 2) out.push({ kind: "hbars", title: "금액 큰 순", rows });
      }
      const wk = weekBuckets(dueCol, items, today, open);
      if (wk.some((b) => b.value > 0) && dueCol) {
        out.push({ kind: "weeks", title: `${dueCol.name} 몰린 주`, bars: wk, note: "아직 안 끝난 것만" });
        covers.add(`date:${dueCol.name}`);
      }
      break;
    }
    case "pipeline":
    case "billing": {
      const amtCol = wonCols[0] || null;
      if (flow && amtCol) {
        const options: any[] = (flow.settings?.options || []) as any[];
        const slices = options.map((o) => ({
          key: String(o.id), label: String(o.label), color: String(o.color || "#C4C4C4"),
          value: items.filter((it) => it.values?.[flow.id] === o.id).reduce((s, it) => s + num(it.values?.[amtCol.id]), 0),
        })).filter((s) => s.value > 0);
        if (slices.length >= 2) {
          out.push({ kind: "funnel", title: `단계별 ${amtCol.name}`, slices, note: "건수가 아니라 금액으로" });
          covers.add(`status:${flow.name}`);
        }
      }
      if (amtCol) {
        const rows = items.map((it) => ({ label: it.name || "이름 없음", value: num(it.values?.[amtCol.id]) }))
          .filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 5)
          .map((r) => ({ ...r, text: `${won(r.value)}원` }));
        if (rows.length >= 2) out.push({ kind: "hbars", title: "금액 큰 순", rows });
      }
      const pr = byPerson(personCols[0] || null, items, nameOf);
      if (pr.length > 0 && personCols[0]) {
        out.push({ kind: "hbars", title: `${personCols[0].name}별 건수`, rows: pr });
        covers.add(`person:${personCols[0].name}`);
      }
      const wk = weekBuckets(dueCol, items, today, open);
      if (wk.some((b) => b.value > 0) && dueCol) {
        out.push({ kind: "weeks", title: `${dueCol.name} 몰린 주`, bars: wk, note: "아직 안 끝난 것만" });
        covers.add(`date:${dueCol.name}`);
      }
      break;
    }
    default: {
      const st = statusSlices(flow, items);
      if (st.length >= 3 && flow) {
        out.push({ kind: "donut", title: "상태 분포", slices: st, total: `${items.length}건` });
        covers.add(`status:${flow.name}`);
      }
      const pr = byPerson(personCols[0] || null, items, nameOf);
      if (pr.length > 0 && personCols[0]) {
        out.push({ kind: "hbars", title: `${personCols[0].name}별`, rows: pr });
        covers.add(`person:${personCols[0].name}`);
      }
    }
  }
  return { figures: out, covers: [...covers] };
}

/** 요약 카드가 그림과 겹치는지 — 카드 라벨은 컬럼 이름 그대로다 */
export function summaryCardKey(card: { kind: string; label: string }): string {
  return `${card.kind}:${card.label}`;
}
