// 데일리 보고서 — 절 문장 규칙 (2026-09-03 대시보드 v3 결정 159) · 규모 규칙(결정 166)
//   AI 가 아니라 숫자 조합 규칙으로 문장을 만든다. 판단어(안정·주의·위험)는 신호 톤과 같은 임계값에서만 나오고,
//   틀렸을 때 원인을 찾을 수 있게 절마다 출처 화면 링크를 단다(화면 쪽). 순수 함수 — 화면·DB 를 모른다.
//   문장은 조각(Seg) 배열: 화면이 톤별 색을 입힌다. 색은 세 가지(주의·위험·강조)만 — 알약 칩 없음(결정 152).

import type { BizSummary } from "@/lib/biz-summary";

export type Seg = { t: string; tone?: "k" | "warn" | "bad" | "good" };
export type Line = Seg[];

const k = (t: string): Seg => ({ t, tone: "k" });
const warn = (t: string): Seg => ({ t, tone: "warn" });
const bad = (t: string): Seg => ({ t, tone: "bad" });
const good = (t: string): Seg => ({ t, tone: "good" });
const p = (t: string): Seg => ({ t });

/** 12,345,678 → '1,234만원' / 1.2억원 — 신호 띠(wonShort)와 같은 단위 */
export function wonK(n: number): string {
  const a = Math.abs(Math.round(n)); const sign = n < 0 ? "−" : "";
  if (a >= 100_000_000) return `${sign}${(a / 100_000_000).toFixed(a >= 1_000_000_000 ? 0 : 1)}억원`;
  if (a >= 10_000) return `${sign}${Math.round(a / 10_000).toLocaleString("ko")}만원`;
  return `${sign}${a.toLocaleString("ko")}원`;
}
const cnt = (n: number) => n.toLocaleString("ko");

// ── 03 자금 ──
export function fundsLines(s: BizSummary | undefined, forecast30: number | null | undefined, unclassified: { bank: number; card: number }): Line[] {
  if (!s) return [[p("통장 자료를 아직 읽지 못했습니다.")]];
  if (!s.cash.hasBank) return [[p("연결된 통장이 없습니다. 통장을 연결하면 잔액·전망이 자동으로 채워집니다.")]];
  const bal = s.cash.balance;
  const out: Line[] = [];
  const l1: Line = [p("통장 잔액은 "), k(wonK(bal))];
  if (forecast30 != null) {
    const d = forecast30 - bal;
    l1.push(p("이고 30일 뒤 "), k(wonK(forecast30)));
    if (d < 0) l1.push(p("으로 "), forecast30 < 0 ? bad(`${wonK(-d)} 줄어 마이너스가 됩니다`) : d < -bal * 0.1 ? warn(`${wonK(-d)} 줄어듭니다`) : p(`${wonK(-d)} 줄어듭니다`));
    else l1.push(p("으로 "), good(`${wonK(d)} 늘어납니다`));
    l1.push(p("."));
  } else l1.push(p("입니다."));
  const rw = s.cash.runway;
  if (isFinite(rw) && rw < 99) {
    l1.push(p(" 월 고정 지출 기준 "), rw < 3 ? bad(`${rw.toFixed(1)}개월`) : rw < 6 ? warn(`${rw.toFixed(1)}개월`) : k(`${rw >= 12 ? Math.floor(rw) : rw.toFixed(1)}개월`), p(" 운영 가능"));
    l1.push(p(rw < 3 ? "해 자금 대책이 먼저입니다." : rw < 6 ? "합니다." : "해 당장의 위험은 없습니다."));
  }
  out.push(l1);
  const l2: Line = [p("30일 안에 낼 돈은 "), k(wonK(s.arap.due30)), p("(정기 지출·급여·대출 상환)")];
  if (s.arap.ap > 0) l2.push(p("이고, 미지급금 "), k(wonK(s.arap.ap)), p("은 별도입니다."));
  else l2.push(p("입니다."));
  if (unclassified.bank + unclassified.card > 0) {
    l2.push(p(" 통장 미분류 "), warn(`${cnt(unclassified.bank)}건`), p(", 카드 미분류 "), warn(`${cnt(unclassified.card)}건`), p("이 남아 있어 손익 숫자에 아직 안 들어갑니다."));
  }
  out.push(l2);
  return out;
}

// ── 04 매출·미수 ──
export function salesLines(s: BizSummary | undefined): Line[] {
  if (!s) return [[p("전표 자료를 아직 읽지 못했습니다.")]];
  const cur = s.pnl.cur; const prev = s.pnl.prev;
  const out: Line[] = [];
  const l1: Line = [p("이번 달 확정 전표 매출은 "), k(wonK(cur.revenue)), p("이고 비용은 "), k(wonK(cur.cogs + cur.opex)), p("입니다.")];
  if (prev && prev.revenue > 0) {
    const r = (cur.revenue - prev.revenue) / prev.revenue;
    if (cur.revenue === 0) l1.push(p(" 지난달 "), k(wonK(prev.revenue)), p(" 대비 "), warn("아직 0"), p("입니다."));
    else if (r <= -0.2) l1.push(p(" 지난달보다 "), warn(`${Math.round(-r * 100)}% 줄었습니다`), p("."));
    else if (r >= 0.2) l1.push(p(" 지난달보다 "), good(`${Math.round(r * 100)}% 늘었습니다`), p("."));
    else l1.push(p(" 지난달과 비슷합니다."));
  }
  //   미전표(전표 안 된 계산서·카드·통장)는 손익이 덜 잡힌 이유 — 숫자로만 말한다
  const un = s.pnl.unposted;
  const unTotal = (un?.taxInvoice || 0) + (un?.card || 0) + (un?.bank || 0);
  if (unTotal > 0) l1.push(p(" 전표가 안 된 자료 "), warn(`${cnt(unTotal)}건`), p("이 있어 실제보다 작게 잡혔을 수 있습니다."));
  out.push(l1);
  const l2: Line = [p("받을 돈은 "), k(wonK(s.arap.ar))];
  if (s.arap.over30 > 0) {
    const ratio = s.arap.ar > 0 ? s.arap.over30 / s.arap.ar : 0;
    l2.push(p("이고 그중 "), ratio > 0.3 ? bad(wonK(s.arap.over30)) : warn(wonK(s.arap.over30)), p(`(${cnt(s.arap.over30Partners)}곳)이 30일을 넘겼습니다.`));
  } else l2.push(p("이고 30일 넘은 미수는 없습니다."));
  out.push(l2);
  return out;
}

// ── 06 사람 ──
export type PeopleStats = { active: number; working: number; done: number; late: number; missing: number; onLeave: number; overtimeOver: number };
export function peopleLines(ps: PeopleStats | null, isWeekend: boolean): Line[] {
  if (!ps) return [[p("근태 자료를 아직 읽지 못했습니다.")]];
  if (ps.active === 0) return [[p("등록된 구성원이 없습니다.")]];
  if (isWeekend) return [[p("재직 "), k(`${cnt(ps.active)}명`), p(". 오늘은 휴일이라 근태 집계가 없습니다.")]];
  const l: Line = [p("재직 "), k(`${cnt(ps.active)}명`), p(" 중 오늘 "), k(`근무중 ${cnt(ps.working)}`)];
  if (ps.done > 0) l.push(p(`, 퇴근 ${cnt(ps.done)}`));
  if (ps.onLeave > 0) l.push(p(`, 휴가 ${cnt(ps.onLeave)}`));
  if (ps.late > 0) l.push(p(", "), warn(`지각 ${cnt(ps.late)}`));
  if (ps.missing > 0) l.push(p(", "), bad(`기록 없음 ${cnt(ps.missing)}`));
  l.push(p("."));
  if (ps.overtimeOver > 0) l.push(p(" 이번 주 52시간 초과 "), bad(`${cnt(ps.overtimeOver)}명`), p("."));
  return [l];
}

// ── 규모 규칙 (2026-09-03 결정 166) — 같은 칸이 데이터 크기에 따라 모양을 바꾼다 ──
//   사장님: "직원 100명이면 동그라미 100개를 넣을 건가" — 13명일 때만 맞는 그림을 규칙으로 막는다.
//   임계값은 기본값(나중에 회사설정으로). 규칙 문장은 절 끝에 그대로 적어 왜 이 모양인지 보이게 한다.
export const SCALE = { peopleDots: 20, peopleStrip: 200, recvAll: 20, recvStrip: 500 } as const;
export type PeopleShape = "dots" | "strip" | "table";
/** ≤20 점 하나=한 사람 · ≤200 비율 띠 + 부서별 표 · >200 부서(사업장) 표 + 어제 대비, 이름 없음 */
export const peopleShape = (n: number): PeopleShape => n <= SCALE.peopleDots ? "dots" : n <= SCALE.peopleStrip ? "strip" : "table";
export const peopleRule = (shape: PeopleShape): string =>
  shape === "dots" ? `${SCALE.peopleDots}명까지는 한 사람이 점 하나입니다. 점에 마우스를 올리면 이름이 보입니다.`
  : shape === "strip" ? `${SCALE.peopleDots + 1}명부터는 점 대신 비율 띠 한 줄과 부서별 표(상위 4 + 외 N)입니다. 이름은 예외(기록 없음)만 링크로.`
  : `${SCALE.peopleStrip}명을 넘으면 부서 표에 어제 대비 변화를 같이 적습니다. 사람 이름은 이 화면에 나오지 않습니다.`;
export type RecvShape = "all" | "strip" | "stripFirst";
/** ≤20곳 상위 5 표 + "전부" · ≤500곳 표 + 연령 띠 · >500곳 연령 띠가 표보다 먼저 */
export const recvShape = (n: number): RecvShape => n <= SCALE.recvAll ? "all" : n <= SCALE.recvStrip ? "strip" : "stripFirst";
/** 미수 연령 4단 — 30 / 90 / 180 / 180+ */
export const AGE_LABELS = ["30일 이내", "31~90일", "91~180일", "180일 초과"] as const;
export const ageBucket = (days: number): 0 | 1 | 2 | 3 => days <= 30 ? 0 : days <= 90 ? 1 : days <= 180 ? 2 : 3;

