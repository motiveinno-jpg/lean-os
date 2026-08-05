"use client";

// 프로젝트 정리 — 돈 한 장 요약 (2026-08-05).
//
//   사장님 지적: "정리 부분이 너무 숫자·가로막대뿐이라 눈에 안 들어온다."
//   그리고 "예상과 실금액을 각기 나눠 보여주면 지표가 너무 많아져 혼동이 온다."
//
//   그래서 숫자를 늘리지 않고 **하나의 금액이 단계를 지나가는 막대**로 본다.
//     수입: 예상 → 계약 → 발행 → 입금 / 지출: 계획 → 확정 → 증빙 → 지급
//   기준 토글은 딱 둘(확정/현금)이고, 어느 기준인지 화면에 항상 적는다.
//
//   차트 원칙(dataviz): 축은 하나만, 도넛·이중축 금지, 색은 정체성에만,
//   상태색(좋음/주의/위험)은 예약해서 계열 색으로 재사용하지 않는다.

import { useMemo, useState } from "react";
import {
  rollupMoney, weeklyCashflow, STAGE_ORDER, STAGE_LABEL, BASIS_LABEL, BASIS_NOTE,
  type Basis, type CashWeek, type MoneyBoard, type MoneyRollup, type MoneyStage,
} from "@/lib/project-money-rollup";
import { todayKst } from "@/lib/kst";
import type { BoardColumn, BoardItem } from "@/lib/project-boards";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
/** 큰 금액은 억/만으로 줄여 읽는다 — 자리수를 세지 않게 */
const shortWon = (n: number) => {
  const v = Math.round(n || 0);
  if (Math.abs(v) >= 100_000_000) return `${(v / 100_000_000).toFixed(1)}억`;
  if (Math.abs(v) >= 10_000) return `${Math.round(v / 10_000).toLocaleString("ko-KR")}만`;
  return v.toLocaleString("ko-KR");
};

// 단계 색 — 한 hue 의 밝기 단계(순서형). 계열 정체성이 아니라 '진행 정도' 라서 순서형이 맞다.
//   상태색(성공/경고/위험)은 여기 쓰지 않는다 — 그건 판정용으로 예약돼 있다.
//   값은 globals.css 토큰에서 온다 — 라이트/다크를 각각 골라 뒀고(뒤집지 않았다),
//   칸마다 글씨 색(ink)을 따로 준다(밝은 칸의 흰 글씨는 대비 미달이라 안 읽힌다).
const IDX: Record<MoneyStage, 1 | 2 | 3 | 4> = { plan: 1, fixed: 2, billed: 3, paid: 4 };
const fill = (kind: "income" | "spend", st: MoneyStage) => `var(--mr-${kind === "income" ? "inc" : "out"}-${IDX[st]})`;
const ink = (kind: "income" | "spend", st: MoneyStage) => `var(--mr-${kind === "income" ? "inc" : "out"}-${IDX[st]}-ink)`;

export function ProjectMoneyReport({ boards, cols, items }: {
  boards: MoneyBoard[]; cols: BoardColumn[]; items: BoardItem[];
}) {
  const [basis, setBasis] = useState<Basis>("accrual");
  const [ignoreOverlap, setIgnoreOverlap] = useState(false);

  const r: MoneyRollup = useMemo(
    () => rollupMoney(boards, cols, items, { basis, today: todayKst() }),
    [boards, cols, items, basis],
  );

  const hasMoney = r.income.total > 0 || r.spend.total > 0 || !!r.budget;
  if (!hasMoney) return null;

  const overlapSum = r.overlaps.reduce((s, o) => s + o.amount, 0);
  const weeks = weeklyCashflow(boards, cols, items, todayKst(), 8);
  const hasWeeks = weeks.some((w) => w.income > 0 || w.spend > 0);

  return (
    <section className="mr">
      {/* ── 헤드라인: 마진 하나 ─────────────────────────── */}
      <header className="mr-head">
        <div className="mr-hero">
          <span className="mr-hero-k">마진</span>
          <b className={r.margin < 0 ? "mr-hero-v mr-bad" : "mr-hero-v"}>{won(r.margin)}원</b>
          {r.marginRate != null && <em className={r.margin < 0 ? "mr-bad" : ""}>마진율 {r.marginRate}%</em>}
        </div>
        <div className="mr-basis">
          {(["accrual", "cash"] as Basis[]).map((b) => (
            <button key={b} type="button" onClick={() => setBasis(b)} aria-pressed={basis === b}
              className={basis === b ? "mr-basis-on" : ""}>{BASIS_LABEL[b]}</button>
          ))}
          <span className="mr-basis-note">{BASIS_NOTE[basis]}</span>
        </div>
      </header>

      {/* ── 겹침 경고 — 몰래 더하지도 빼지도 않는다 ────── */}
      {r.overlaps.length > 0 && !ignoreOverlap && (
        <div className="mr-warn">
          <b>같은 지출이 두 번 잡힌 것 같아요</b>
          <span>
            {r.overlaps.slice(0, 3).map((o) => `${o.a} ↔ ${o.b} (${shortWon(o.amount)})`).join(" · ")}
            {r.overlaps.length > 3 ? ` 외 ${r.overlaps.length - 3}건` : ""}
            {" — 합계 "}{won(overlapSum)}원. 총 지출은 <b>비용 · 지출</b> 표만 세고 있어요.
          </span>
          <button type="button" onClick={() => setIgnoreOverlap(true)}>알겠어요</button>
        </div>
      )}

      {/* ── 수입·지출: 같은 축의 막대 두 줄 ─────────────── */}
      <StageBars income={r.income} spend={r.spend} />

      {/* 언제 자금이 비나 — 총액보다 시점이 궁금하다 */}
      {hasWeeks && <WeeklyCash weeks={weeks} />}

      <div className="mr-grid">
        {/* 예산 소진 — 집행·성과 표가 있을 때만 */}
        {r.budget && r.budget.planned > 0 && (
          <figure className="mr-fig">
            <figcaption>
              예산 소진율<em>&apos;집행 · 성과&apos; 템플릿만 셈합니다 — 위 총 지출과 별개예요</em>
            </figcaption>
            <div className="mr-meter">
              <span className="mr-meter-track">
                <i className={(r.budget.rate ?? 0) > 100 ? "mr-meter-over" : ""}
                  style={{ width: `${Math.min(100, r.budget.rate ?? 0)}%` }} />
              </span>
              <b className={(r.budget.rate ?? 0) > 100 ? "mr-bad" : ""}>{r.budget.rate}%</b>
            </div>
            <p className="mr-fignote">
              예산 {won(r.budget.planned)}원 중 <b>{won(r.budget.spent)}원</b> 집행 ·
              남은 {won(Math.max(0, r.budget.planned - r.budget.spent))}원
            </p>
          </figure>
        )}

        {/* 막힌 곳 — 숫자를 늘리는 대신 '챙길 것' 한 줄로 */}
        {r.stuck.length > 0 && (
          <figure className="mr-fig">
            <figcaption>진행이 멈춘 돈<em>기한이 지났는데 다음 단계로 안 넘어간 건</em></figcaption>
            <ul className="mr-stuck">
              {r.stuck.map((s) => (
                <li key={s.name}>
                  <i style={{ background: fill("spend", s.stage) }} />
                  <span>{s.name}</span>
                  <em>{s.days}일째</em>
                  <b>{shortWon(s.amount)}</b>
                </li>
              ))}
            </ul>
          </figure>
        )}
      </div>
    </section>
  );
}

/** 수입·지출을 **같은 축**에 놓고 단계별로 채운다. 축이 하나라 길이를 그대로 비교할 수 있다. */
function StageBars({ income, spend }: { income: MoneyRollup["income"]; spend: MoneyRollup["spend"] }) {
  const max = Math.max(income.total, spend.total, 1);
  const rows: { key: "income" | "spend"; label: string; ax: MoneyRollup["income"] }[] = [
    { key: "income", label: "받을 돈", ax: income },
    { key: "spend", label: "나갈 돈", ax: spend },
  ];
  const [asTable, setAsTable] = useState(false);
  return (
    <figure className="mr-fig mr-fig-wide">
      <figcaption>
        받을 돈 · 나갈 돈이 어느 단계까지 왔나<em>막대 전체가 총액 · 왼쪽부터 단계 순서</em>
        {/* 색만으로 뜻을 전하지 않는다 — 숫자로 읽고 싶을 때를 위한 표 */}
        <button type="button" className="mr-toggle" onClick={() => setAsTable((v) => !v)}>
          {asTable ? "그래프로" : "표로 보기"}
        </button>
      </figcaption>
      {asTable ? (
        <table className="mr-table">
          <thead><tr><th>구분</th>{STAGE_ORDER.map((st) => <th key={st} className="mr-td-n">{STAGE_LABEL.spend[st]}</th>)}<th className="mr-td-n">합계</th></tr></thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.key}>
                <td>{row.label}</td>
                {STAGE_ORDER.map((st) => (
                  <td key={st} className="mr-td-n">
                    <i style={{ background: fill(row.key, st) }} />{won(row.ax.byStage[st])}
                  </td>
                ))}
                <td className="mr-td-n"><b>{won(row.ax.total)}</b></td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (<>
      <div className="mr-bars">
        {rows.map((row) => (
          <div key={row.key} className="mr-bar-row">
            <span className="mr-bar-k">{row.label}</span>
            <span className="mr-bar-track" style={{ width: `${(row.ax.total / max) * 100}%` }}>
              {STAGE_ORDER.map((st) => {
                const v = row.ax.byStage[st];
                if (v <= 0) return null;
                const pct = (v / row.ax.total) * 100;
                return (
                  <i key={st} style={{ width: `${pct}%`, background: fill(row.key, st) }}
                    title={`${STAGE_LABEL[row.key][st]} ${won(v)}원`}>
                    {pct >= 14 && <em style={{ color: ink(row.key, st) }}>{shortWon(v)}</em>}
                  </i>
                );
              })}
            </span>
            <b className="mr-bar-total">{won(row.ax.total)}원</b>
          </div>
        ))}
      </div>
      {/* 계열이 2개 이상이면 범례는 언제나 있다 — 색만으로 뜻을 전하지 않는다 */}
      <div className="mr-legend">
        {(["income", "spend"] as const).map((k) => (
          <span key={k} className="mr-legend-row">
            <b>{k === "income" ? "받을 돈" : "나갈 돈"}</b>
            {STAGE_ORDER.map((st) => (
              <span key={st}><i style={{ background: fill(k, st) }} />{STAGE_LABEL[k][st]}</span>
            ))}
          </span>
        ))}
      </div>
      </>)}
    </figure>
  );
}

/** 주별 예정 자금 — 위는 들어올 돈, 아래는 나갈 돈. 같은 축(원)이라 길이를 그대로 비교한다.
 *  ⚠️ 잔액 누적선을 얹으면 축이 둘이 된다(금지). 대신 주마다 순액을 숫자로 적고,
 *     마이너스인 주만 색으로 집는다 — 그게 실제로 챙길 주다. */
function WeeklyCash({ weeks }: { weeks: CashWeek[] }) {
  const [hover, setHover] = useState<string | null>(null);
  const max = Math.max(1, ...weeks.map((w) => Math.max(w.income, w.spend)));
  const short = (n: number) => (n === 0 ? "" : shortWon(n));
  const worst = weeks.filter((w) => w.net < 0).sort((a, b) => a.net - b.net)[0];

  return (
    <figure className="mr-fig mr-fig-wide">
      <figcaption>
        주별 들어올 돈 · 나갈 돈<em>앞으로 8주 · 아직 안 끝난 건만</em>
        {worst && <span className="mr-worst">{worst.label} 에 {shortWon(Math.abs(worst.net))}원 모자람</span>}
      </figcaption>
      <div className="mr-weeks" onMouseLeave={() => setHover(null)}>
        {weeks.map((w) => (
          <div key={w.key} className={`mr-week ${hover === w.key ? "mr-week-on" : ""} ${w.key === "past" ? "mr-week-past" : ""}`}
            onMouseEnter={() => setHover(w.key)} tabIndex={0} onFocus={() => setHover(w.key)}
            aria-label={`${w.label}: 들어올 돈 ${won(w.income)}원, 나갈 돈 ${won(w.spend)}원, 순액 ${won(w.net)}원`}>
            <span className="mr-week-up">
              {w.income > 0 && <i style={{ height: `${(w.income / max) * 100}%`, background: "var(--mr-inc-3)" }} />}
              {w.income > 0 && <em>{short(w.income)}</em>}
            </span>
            <span className="mr-week-axis" />
            <span className="mr-week-dn">
              {w.spend > 0 && <i style={{ height: `${(w.spend / max) * 100}%`, background: "var(--mr-out-3)" }} />}
              {w.spend > 0 && <em>{short(w.spend)}</em>}
            </span>
            <span className={`mr-week-k ${w.net < 0 ? "mr-bad" : ""}`}>{w.label}</span>
            {hover === w.key && (
              <span className="mr-tip" role="tooltip">
                <b>{w.label}</b>
                <span><i style={{ background: "var(--mr-inc-3)" }} />들어올 {won(w.income)}원</span>
                <span><i style={{ background: "var(--mr-out-3)" }} />나갈 {won(w.spend)}원</span>
                <span className={w.net < 0 ? "mr-bad" : ""}><b>순액 {won(w.net)}원</b></span>
              </span>
            )}
          </div>
        ))}
      </div>
      <div className="mr-legend">
        <span className="mr-legend-row">
          <span><i style={{ background: "var(--mr-inc-3)" }} />들어올 돈</span>
          <span><i style={{ background: "var(--mr-out-3)" }} />나갈 돈</span>
          <span className="mr-legend-note">들어올 돈보다 나갈 돈이 많은 주는 날짜가 빨갛습니다</span>
        </span>
      </div>
    </figure>
  );
}
