// 프로젝트 브리핑 — 규칙으로 만든다(AI 토큰 0원).
//
// 배경 (2026-08-03 사장님): "토큰 사용은 하지 않고는 어려울까? 사실을 모아서 띄워주는 형태로."
//   → 브리핑에 필요한 사실(계약·발행·입금·미수 경과·비용·마진·목표·업무 지연·변동)은
//     이미 화면이 조회하고 있다. 그 사실을 **문장으로 조립**하면 AI 없이도 같은 값을 준다.
//   AI 가 더 나은 건 "문장 다듬기"뿐인데, 그 대가로 요청당 비용·지연·환각 위험이 붙는다.
//
// 절대규칙
//   · 순수 함수. 조회 0, side-effect 0. 입력에 없는 숫자는 절대 만들지 않는다.
//   · 없는 항목은 비운다. 억지로 채우면 "챙길 게 없는데 있는 것처럼" 보인다.
//   · 문장은 30자 안팎. 마침표 없이 명료하게.

export type BriefFacts = {
  /** 계약금액(공급가) */
  contractNet: number;
  /** 계약금액(VAT 포함) — 화면 표기 기준 */
  contractInc: number;
  /** 발행액(VAT 포함) */
  billed: number;
  /** 입금액(VAT 포함) */
  paid: number;
  /** 미수금(VAT 포함) */
  outstanding: number;
  /** 가장 오래된 미수 경과일 */
  oldestUnpaidDays: number | null;
  /** 비용(매입 공급가) */
  costNet: number;
  /** 목표금액(대표 매출 목표) */
  goalAmount: number;
  taskCount: number;
  taskDone: number;
  overdueCount: number;
  /** 마감까지 남은 일수(음수=초과) */
  daysToEnd: number | null;
  /** 마지막 변동 이후 경과일 */
  quietDays: number | null;
  /** 완료·정산 단계인가 */
  finished: boolean;
  /** 거래처명(없으면 null) */
  partnerName: string | null;
};

export type Brief = {
  headline: string;
  goods: string[];
  issues: string[];
  nexts: string[];
};

const won = (n: number): string => `${Math.round(n).toLocaleString("ko-KR")}원`;
const pct = (a: number, b: number): number => (b > 0 ? Math.round((a / b) * 100) : 0);

export function buildProjectBrief(f: BriefFacts): Brief {
  const goods: string[] = [];
  const issues: string[] = [];
  const nexts: string[] = [];

  const collectRate = f.billed > 0 ? pct(f.paid, f.billed) : null;
  const progress = f.taskCount > 0 ? pct(f.taskDone, f.taskCount) : null;
  const revenueNet = f.billed > 0 ? Math.round(f.billed / 1.1) : f.contractNet;
  const marginNet = revenueNet - f.costNet;
  const marginRate = revenueNet > 0 ? Math.round((marginNet / revenueNet) * 100) : null;
  const goalPct = f.goalAmount > 0 ? pct(f.contractInc, f.goalAmount) : null;

  // ── 잘되고 있는 것 ──
  if (collectRate === 100 && f.billed > 0) goods.push("발행액 전액 입금 완료");
  else if (collectRate != null && collectRate >= 80) goods.push(`발행액의 ${collectRate}% 입금 완료`);
  if (goalPct != null && goalPct >= 100) goods.push(`목표 ${goalPct}% 달성`);
  if (progress != null && progress >= 70) goods.push(`업무 ${f.taskDone}/${f.taskCount}건 완료`);
  if (marginRate != null && marginRate >= 30 && f.costNet > 0) goods.push(`마진율 ${marginRate}% 유지`);
  if (goods.length === 0 && f.taskCount > 0 && f.overdueCount === 0) goods.push("지연된 업무 없음");

  // ── 문제 ──
  if (!f.finished && f.daysToEnd != null && f.daysToEnd < 0) issues.push(`마감 ${-f.daysToEnd}일 초과`);
  if (f.overdueCount > 0) issues.push(`기한 지난 업무 ${f.overdueCount}건`);
  if (f.outstanding > 1) {
    issues.push(f.oldestUnpaidDays != null && f.oldestUnpaidDays > 60
      ? `미수금 ${won(f.outstanding)} · ${f.oldestUnpaidDays}일 경과`
      : `미수금 ${won(f.outstanding)}`);
  }
  if (marginRate != null && f.costNet > 0 && marginRate < 0) issues.push(`마진 적자 ${won(marginNet)}`);
  else if (marginRate != null && f.costNet > 0 && marginRate < 10) issues.push(`마진율 ${marginRate}%로 낮음`);
  if (goalPct != null && goalPct < 50) issues.push(`목표의 ${goalPct}%만 수주`);
  if (!f.finished && f.quietDays != null && f.quietDays >= 14) issues.push(`${f.quietDays}일째 변동 없음`);

  // ── 다음에 할 일 — 문제에 짝을 맞춘다 ──
  if (!f.finished && f.daysToEnd != null && f.daysToEnd < 0) nexts.push("마감일을 다시 잡거나 완료 처리");
  if (f.overdueCount > 0) nexts.push(`지연된 업무 ${f.overdueCount}건 기한 조정`);
  if (f.outstanding > 1) nexts.push(f.partnerName ? `${f.partnerName}에 입금 일정 확인` : "입금 일정 확인");
  if (f.billed > 0 && f.costNet === 0) nexts.push("비용을 등록하면 마진이 계산돼요");
  if (f.goalAmount === 0 && f.contractInc > 0) nexts.push("목표금액을 정하면 달성률이 보여요");
  if (f.contractInc === 0 && f.billed === 0) nexts.push("견적서를 만들면 금액이 잡혀요");
  if (f.taskCount === 0) nexts.push("할 일을 적으면 진행률이 계산돼요");
  if (!f.finished && f.quietDays != null && f.quietDays >= 14) nexts.push("이번 주 한 줄 기록 남기기");
  if (nexts.length === 0) {
    nexts.push(f.daysToEnd != null && f.daysToEnd >= 0 ? `다음 마감까지 ${f.daysToEnd}일 · 예정대로 진행` : "예정대로 진행");
  }

  // ── 한 줄 요약 — 가장 급한 사실 두 개까지 ──
  let headline: string;
  if (f.finished && f.outstanding <= 1) headline = "완료된 프로젝트예요";
  else if (issues.length >= 2) headline = `${issues[0]} · ${issues[1]}`;
  else if (issues.length === 1) headline = issues[0];
  else if (goods.length > 0) headline = `${goods[0]} · 특별한 문제 없어요`;
  else headline = "아직 쌓인 기록이 없어요";

  return { headline, goods: goods.slice(0, 2), issues: issues.slice(0, 3), nexts: nexts.slice(0, 3) };
}
