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
/** id — 정리 양식이 '무엇을 켤지'를 이 이름으로 기억한다. 칸 이름이 들어가므로
 *  칸 이름을 바꾸면 새 항목으로 보여 다시 켜진 채 나온다(숨는 것보다 낫다). */
export type Figure =
  /** 하나짜리 수치 — 차트로 만들지 않는다 */
  | { id: string; kind: "stat"; title: string; value: string; note?: string; tone?: "ok" | "bad" }
  /** 진행 링 — '전체 중 얼마나' 하나를 볼 때 */
  | { id: string; kind: "ring"; title: string; pct: number; center: string; note?: string; tone?: "ok" | "bad" }
  /** 도넛 — 부분/전체(6조각 이하). 가운데에 합계를 적는다 */
  | { id: string; kind: "donut"; title: string; slices: Slice[]; total: string; note?: string }
  /** 깔때기 — 단계별로 얼마나 남아 있나(순서가 있는 분류) */
  | { id: string; kind: "funnel"; title: string; slices: Slice[]; note?: string }
  /** 가로 막대 — 이름표별 크기 비교(색은 하나) */
  | { id: string; kind: "hbars"; title: string; rows: { label: string; value: number; text?: string }[]; note?: string }
  /** 세로 막대 — 주별 흐름 */
  | { id: string; kind: "weeks"; title: string; bars: { label: string; value: number; hot?: boolean }[]; note?: string };

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
        out.push({ id: "ring:progress", kind: "ring", title: "완료율", pct, center: `${pct}%`, note: `전체 ${items.length}건 중 ${doneCount}건 완료` });
        if (flow) covers.add(`status:${flow.name}`);
      }
      const st = statusSlices(flow, items);
      // 2조각짜리 도넛은 만들지 않는다(숫자가 낫다). 3~6조각일 때만.
      if (st.length >= 3 && flow) {
        out.push({ id: "funnel:flow", kind: "funnel", title: "단계별 건수", slices: st, note: "위에서 아래로 단계 순서" });
        covers.add(`status:${flow.name}`);
      }
      const pr = byPerson(personCols[0] || null, items, nameOf);
      if (pr.length > 0 && personCols[0]) {
        out.push({ id: `hbars:person:${personCols[0].name}`, kind: "hbars", title: `${personCols[0].name}별 건수`, rows: pr });
        covers.add(`person:${personCols[0].name}`);
      }
      const wk = weekBuckets(dueCol, items, today, open);
      if (wk.some((b) => b.value > 0) && dueCol) {
        out.push({ id: `weeks:${dueCol.name}`, kind: "weeks", title: `주별 ${dueCol.name} 건수`, bars: wk, note: "아직 안 끝난 건만 셉니다" });
        covers.add(`date:${dueCol.name}`);
      }
      break;
    }
    case "review": {
      const st = statusSlices(flow, items);
      if (st.length >= 3 && flow) {
        out.push({ id: "funnel:flow", kind: "funnel", title: "단계별 건수", slices: st, note: "위에서 아래로 요청 → 완료" });
        covers.add(`status:${flow.name}`);
      }
      const waiting = items.filter(open).length;
      out.push({
        id: "stat:waiting", kind: "stat", title: "아직 안 끝난 건", value: `${waiting}건`,
        note: waiting === 0 ? "밀린 요청이 없어요" : `전체 ${items.length}건 중 ${waiting}건`,
        tone: waiting === 0 ? "ok" : undefined,
      });
      // 요청자와 담당이 따로 있는 표라 둘 다 보여준다 — 누가 많이 넣고 누가 많이 받나
      personCols.slice(0, 2).forEach((pc) => {
        const rows = byPerson(pc, items, nameOf);
        if (rows.length === 0) return;
        out.push({ id: `hbars:person:${pc.name}`, kind: "hbars", title: `${pc.name}별 건수`, rows });
        covers.add(`person:${pc.name}`);
      });
      const wk = weekBuckets(dueCol, items, today, open);
      if (wk.some((b) => b.value > 0) && dueCol) {
        out.push({ id: `weeks:${dueCol.name}`, kind: "weeks", title: `주별 ${dueCol.name} 건수`, bars: wk, note: "아직 안 끝난 건만 셉니다" });
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
        out.push({ id: "ring:span", kind: "ring", title: "기간 경과율", pct: p, center: `${p}%`, note: `${min} ~ ${max} 중 오늘까지` });
      }
      const st = statusSlices(flow, items);
      if (st.length >= 3 && flow) {
        out.push({ id: "donut:flow", kind: "donut", title: "상태별 건수", slices: st, total: `${items.length}건` });
        covers.add(`status:${flow.name}`);
      }
      const late = items.filter((it) => {
        if (!open(it) || !endCol) return false;
        const v = String(it.values?.[endCol.id] || "").slice(0, 10);
        return /^\d{4}-\d{2}-\d{2}$/.test(v) && v < today;
      }).length;
      out.push({
        id: "stat:late", kind: "stat", title: "종료일 지난 미완료", value: `${late}건`,
        note: late === 0 ? "종료일 넘긴 일정 없음" : "종료일이 지났는데 안 끝난 일정",
        tone: late === 0 ? "ok" : "bad",
      });
      const wk = weekBuckets(endCol, items, today, open);
      if (wk.some((b) => b.value > 0)) out.push({ id: "weeks:end", kind: "weeks", title: "주별 종료 건수", bars: wk, note: "아직 안 끝난 건만 셉니다" });
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
          id: "ring:planreal", kind: "ring", title: `${planCol?.name || "계획"} 대비 ${realCol?.name || "실적"}`, pct: Math.min(100, p),
          center: `${p}%`, note: `${planCol?.name || "계획"} ${won(planSum)}원 중 ${realCol?.name || "실적"} ${won(realSum)}원`, tone: p > 100 ? "bad" : undefined,
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
          out.push({ id: `dist:${kindCol.name}`, kind: "donut", title: `${kindCol.name}별 ${realCol?.name || "금액"}`, slices, total: `${shortWon(realSum)}원` });
          covers.add(`status:${kindCol.name}`);
        } else if (slices.length > 0) {
          out.push({ id: `dist:${kindCol.name}`, kind: "hbars", title: `${kindCol.name}별 ${realCol?.name || "금액"}`,
            rows: slices.map((s) => ({ label: s.label, value: s.value, text: `${won(s.value)}원` })) });
          covers.add(`status:${kindCol.name}`);
        }
      }
      // 큰 항목 상위 — 어디에 돈이 몰렸나
      if (realCol) {
        const rows = items.map((it) => ({ label: it.name || "이름 없음", value: num(it.values?.[realCol.id]) }))
          .filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 5)
          .map((r) => ({ ...r, text: `${won(r.value)}원` }));
        if (rows.length >= 2) out.push({ id: "hbars:top", kind: "hbars", title: "금액이 큰 항목", rows, note: "위에서부터 다섯 개" });
      }
      const wk = weekBuckets(dueCol, items, today, open);
      if (wk.some((b) => b.value > 0) && dueCol) {
        out.push({ id: `weeks:${dueCol.name}`, kind: "weeks", title: `주별 ${dueCol.name} 건수`, bars: wk, note: "아직 안 끝난 건만 셉니다" });
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
          out.push({ id: "funnel:amount", kind: "funnel", title: `단계별 ${amtCol.name}`, slices, note: "건수가 아니라 금액 합계입니다" });
          covers.add(`status:${flow.name}`);
        }
      }
      if (amtCol) {
        const rows = items.map((it) => ({ label: it.name || "이름 없음", value: num(it.values?.[amtCol.id]) }))
          .filter((r) => r.value > 0).sort((a, b) => b.value - a.value).slice(0, 5)
          .map((r) => ({ ...r, text: `${won(r.value)}원` }));
        if (rows.length >= 2) out.push({ id: "hbars:top", kind: "hbars", title: "금액이 큰 항목", rows, note: "위에서부터 다섯 개" });
      }
      const pr = byPerson(personCols[0] || null, items, nameOf);
      if (pr.length > 0 && personCols[0]) {
        out.push({ id: `hbars:person:${personCols[0].name}`, kind: "hbars", title: `${personCols[0].name}별 건수`, rows: pr });
        covers.add(`person:${personCols[0].name}`);
      }
      const wk = weekBuckets(dueCol, items, today, open);
      if (wk.some((b) => b.value > 0) && dueCol) {
        out.push({ id: `weeks:${dueCol.name}`, kind: "weeks", title: `주별 ${dueCol.name} 건수`, bars: wk, note: "아직 안 끝난 건만 셉니다" });
        covers.add(`date:${dueCol.name}`);
      }
      break;
    }
    default: {
      const st = statusSlices(flow, items);
      if (st.length >= 3 && flow) {
        out.push({ id: "donut:flow", kind: "donut", title: "상태별 건수", slices: st, total: `${items.length}건` });
        covers.add(`status:${flow.name}`);
      }
      const pr = byPerson(personCols[0] || null, items, nameOf);
      if (pr.length > 0 && personCols[0]) {
        out.push({ id: `hbars:person:${personCols[0].name}`, kind: "hbars", title: `${personCols[0].name}별`, rows: pr });
        covers.add(`person:${personCols[0].name}`);
      }
    }
  }
  return { figures: out, covers: [...covers] };
}

/**
 * 한 가지 그림으로만 본다 — 사용자가 '원형' 또는 '막대'를 골랐을 때 (2026-08-05 사장님 지시).
 *
 * 자동(templateFigures)은 일의 성격에 맞는 형태를 골라 주지만, 사장님이 형태를 지목했으면
 * 그 형태로 통일해 보여 준다. 근거가 없는 칸은 만들지 않는다(빈 그림을 그리지 않는다).
 */
export function shapeFigures(
  shape: "donut" | "bars",
  cols: BoardColumn[], items: BoardItem[], groups: BoardGroup[],
  nameOf: (id: string) => string, today: string,
): { figures: Figure[]; covers: string[] } {
  if (items.length === 0) return { figures: [], covers: [] };
  const out: Figure[] = [];
  const covers = new Set<string>();
  const statusCols = cols.filter((c) => c.type === "status");
  const personCols = cols.filter((c) => c.type === "person");
  const numCols = cols.filter((c) => c.type === "number");
  const dueCol = cols.find((c) => c.type === "date" && !START_DATE_RE.test(c.name)) || null;
  const open = (it: BoardItem) => !isDoneRow(it as any, cols as any, groups as any);

  // 그룹이 여럿이면 그룹도 하나의 분류다
  const groupSlices: Slice[] = groups.length > 1
    ? groups.map((g) => ({ key: g.id, label: g.name, color: g.color, value: items.filter((it) => it.group_id === g.id).length }))
      .filter((s) => s.value > 0)
    : [];

  if (shape === "donut") {
    for (const c of statusCols) {
      const slices = statusSlices(c, items);
      if (slices.length < 2) continue;   // 조각이 하나면 원이 뜻을 만들지 않는다
      out.push({ id: `donut:${c.name}`, kind: "donut", title: `${c.name}별 건수`, slices, total: `${items.length}건` });
      covers.add(`status:${c.name}`);
    }
    if (groupSlices.length >= 2) {
      out.push({ id: "donut:group", kind: "donut", title: "그룹별 건수", slices: groupSlices, total: `${items.length}건` });
      covers.add("group:그룹별 행 수");
    }
    // 금액이 있으면 '무엇이 얼마를 차지하나' — 건수보다 이게 궁금한 표가 있다
    const money = numCols.find((c) => (c.settings?.unit || "") === "원") || null;
    const kind = statusCols[0] || null;
    if (money && kind) {
      const options: any[] = (kind.settings?.options || []) as any[];
      const slices: Slice[] = options.map((o) => ({
        key: String(o.id), label: String(o.label), color: String(o.color || "#C4C4C4"),
        value: items.filter((it) => it.values?.[kind.id] === o.id).reduce((s, it) => s + num(it.values?.[money.id]), 0),
      })).filter((s) => s.value > 0);
      const total = slices.reduce((s, x) => s + x.value, 0);
      if (slices.length >= 2) {
        out.push({ id: `donut:money:${kind.name}`, kind: "donut", title: `${kind.name}별 ${money.name}`, slices, total: `${shortWon(total)}원` });
      }
    }
    return { figures: out, covers: [...covers] };
  }

  // bars — 크기 비교는 막대가 가장 정직하다
  for (const c of statusCols) {
    const slices = statusSlices(c, items);
    if (slices.length === 0) continue;
    out.push({
      id: `bars:${c.name}`, kind: "hbars", title: `${c.name}별 건수`,
      rows: slices.map((s) => ({ label: s.label, value: s.value })),
    });
    covers.add(`status:${c.name}`);
  }
  if (groupSlices.length > 0) {
    out.push({ id: "bars:group", kind: "hbars", title: "그룹별 건수", rows: groupSlices.map((s) => ({ label: s.label, value: s.value })) });
    covers.add("group:그룹별 행 수");
  }
  for (const c of personCols) {
    const rows = byPerson(c, items, nameOf);
    if (rows.length === 0) continue;
    out.push({ id: `bars:person:${c.name}`, kind: "hbars", title: `${c.name}별 건수`, rows });
    covers.add(`person:${c.name}`);
  }
  for (const c of numCols) {
    // 금액이 큰 순서 다섯 — 어디에 몰려 있는지가 합계보다 먼저 보인다
    const rows = items
      .map((it) => ({ label: it.name || "이름 없음", value: num(it.values?.[c.id]) }))
      .filter((r) => r.value !== 0)
      .sort((a, b) => b.value - a.value).slice(0, 5)
      .map((r) => ({ ...r, text: `${won(r.value)}${c.settings?.unit || ""}` }));
    if (rows.length >= 2) out.push({ id: `bars:top:${c.name}`, kind: "hbars", title: `${c.name} 큰 순서`, rows, note: "위에서부터 다섯 개" });
  }
  if (dueCol) {
    const bars = weekBuckets(dueCol, items, today, open);
    if (bars.some((b) => b.value > 0)) {
      out.push({ id: `bars:weeks:${dueCol.name}`, kind: "weeks", title: `주별 ${dueCol.name} 건수`, bars, note: "아직 안 끝난 건만 셉니다" });
    }
  }
  return { figures: out, covers: [...covers] };
}

/** 요약 카드가 그림과 겹치는지 — 카드 라벨은 컬럼 이름 그대로다 */
export function summaryCardKey(card: { kind: string; label: string }): string {
  return `${card.kind}:${card.label}`;
}
