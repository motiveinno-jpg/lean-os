// 프로젝트 목록 요약 — **표(보드)에 입력된 값**에서 뽑는다 (2026-08-03 기획 v2 5단계).
//
// 배경 (사장님 지적):
//   목록의 지연·주의·정상과 보드·캘린더·담당별·분석은 전부 '계약·마감·미수'(회계)를 전제로 만든
//   지표였다. 새 구조에서는 프로젝트마다 쓰는 템플릿이 달라서 그 칸이 대부분 빈다.
//   → 템플릿이 무엇이든 **공통으로 있는 것**만 목록에 쓴다:
//      ① 표가 몇 개인지 ② 얼마나 채웠는지(행 수) ③ 마지막 입력이 언제인지
//      ④ 날짜 컬럼 기준 지난 것·이번 주 ⑤ 흐름이 있으면 완료율
//   회계(계약·미수)는 연결된 프로젝트에서만 덧붙인다 — 없으면 아예 안 보여준다.
//
// 절대규칙: 순수 함수. 조회는 화면이 하고 여기서는 계산만 한다.

import { DONE_WORD_RE, START_DATE_RE, isDoneRow, terminalOptionId, flowColumnOf } from "@/lib/project-boards";

export type ListBoard = { id: string; deal_id: string; name: string; template_key: string | null };
export type ListColumn = { id: string; board_id: string; type: string; name: string; settings?: any };
export type ListGroup = { id: string; board_id: string; name: string; position: number };
export type ListItem = { board_id: string; group_id: string | null; values: Record<string, any>; updated_at: string };

export type ProjectRollup = {
  boardCount: number;
  boardNames: string[];
  itemCount: number;
  /** 마지막 입력 이후 경과일 — 표가 없으면 null */
  quietDays: number | null;
  /** 날짜 컬럼 기준 */
  lateCount: number;
  soonCount: number;
  /** 흐름(마지막 그룹) 또는 완료 상태 기준 완료율 — 계산 불가면 null */
  doneRate: number | null;
};

export function rollupProject(
  boards: ListBoard[], columns: ListColumn[], groups: ListGroup[], items: ListItem[], today: string,
): ProjectRollup {
  const boardIds = new Set(boards.map((b) => b.id));
  const myItems = items.filter((i) => boardIds.has(i.board_id));
  const myCols = columns.filter((c) => boardIds.has(c.board_id));
  const myGroups = groups.filter((g) => boardIds.has(g.board_id));

  // 마지막 입력
  let quietDays: number | null = null;
  const last = myItems.map((i) => i.updated_at).filter(Boolean).sort().pop();
  if (last) quietDays = Math.floor((Date.now() - new Date(last).getTime()) / 86_400_000);

  // 날짜 컬럼 — 지난 것 / 이번 주.
  //   끝난 행과 '시작' 계열 컬럼은 뺀다 — 안 그러면 완료된 일과 이미 시작한 일까지
  //   '기한 지남' 으로 잡혀 목록 첫 줄 숫자가 부풀려진다(2026-08-03 시연 데이터로 확인).
  const weekLater = new Date(new Date(`${today}T00:00:00`).getTime() + 7 * 86_400_000).toISOString().slice(0, 10);
  let lateCount = 0, soonCount = 0;
  const dueCols = myCols.filter((c) => c.type === "date" && !START_DATE_RE.test(c.name));
  for (const it of myItems) {
    const boardCols = myCols.filter((c) => c.board_id === it.board_id);
    const boardGroups = myGroups.filter((g) => g.board_id === it.board_id);
    if (isDoneRow(it as any, boardCols as any, boardGroups as any)) continue;
    for (const c of dueCols) {
      if (c.board_id !== it.board_id) continue;
      const v = String(it.values?.[c.id] || "");
      if (!/^\d{4}-\d{2}-\d{2}/.test(v)) continue;
      if (v < today) lateCount++;
      else if (v <= weekLater) soonCount++;
    }
  }

  // 완료율 — 단계는 이제 라벨이므로 **흐름 상태 컬럼**의 종착 옵션 비율로 낸다.
  //   그룹을 여러 개 쓴 옛 표(또는 사용자가 직접 나눈 표)는 완료류 그룹 비율로 계산한다.
  let doneRate: number | null = null;
  {
    let total = 0, done = 0;
    for (const b of boards) {
      const rows = myItems.filter((i) => i.board_id === b.id);
      if (rows.length === 0) continue;
      const flowCol = flowColumnOf(myCols.filter((c) => c.board_id === b.id));
      const term = flowCol ? terminalOptionId(flowCol) : null;
      if (flowCol && term) {
        total += rows.length;
        done += rows.filter((i) => i.values?.[flowCol.id] === term).length;
        continue;
      }
      const gs = myGroups.filter((g) => g.board_id === b.id).sort((a, z) => a.position - z.position);
      if (gs.length <= 1) continue;
      const doneGroup = gs.find((g) => DONE_WORD_RE.test(g.name));
      total += rows.length;
      if (doneGroup) done += rows.filter((i) => i.group_id === doneGroup.id).length;
    }
    if (total > 0) doneRate = Math.round((done / total) * 100);
  }

  return {
    boardCount: boards.length,
    boardNames: boards.map((b) => b.name),
    itemCount: myItems.length,
    quietDays,
    lateCount,
    soonCount,
    doneRate,
  };
}

export type ListStatus = "late" | "warn" | "normal" | "empty";

/**
 * 목록 상태 — 표 데이터만으로 정한다.
 *   지연: 기한이 지난 행이 있다
 *   주의: 이번 주 마감이 있거나 2주 넘게 입력이 없다
 *   시작 전: 표가 없거나 행이 하나도 없다 (빈 프로젝트를 '정상'으로 속이지 않는다)
 */
export function listStatusOf(r: ProjectRollup): ListStatus {
  if (r.boardCount === 0 || r.itemCount === 0) return "empty";
  if (r.lateCount > 0) return "late";
  if (r.soonCount > 0) return "warn";
  if (r.quietDays != null && r.quietDays >= 14) return "warn";
  return "normal";
}

/** 목록 한 줄에 쓰는 '확인 사항' — 해당되는 것만 */
export function listReasons(r: ProjectRollup): { text: string; tone: "risk" | "warn" | "dim" }[] {
  const out: { text: string; tone: "risk" | "warn" | "dim" }[] = [];
  if (r.boardCount === 0) { out.push({ text: "템플릿을 아직 안 골랐어요", tone: "dim" }); return out; }
  if (r.itemCount === 0) { out.push({ text: "템플릿은 있는데 입력이 없어요", tone: "dim" }); return out; }
  if (r.lateCount > 0) out.push({ text: `기한 지난 것 ${r.lateCount}건`, tone: "risk" });
  if (r.soonCount > 0) out.push({ text: `이번 주 ${r.soonCount}건`, tone: "warn" });
  if (r.quietDays != null && r.quietDays >= 14) out.push({ text: `${r.quietDays}일째 입력 없음`, tone: "dim" });
  return out;
}
