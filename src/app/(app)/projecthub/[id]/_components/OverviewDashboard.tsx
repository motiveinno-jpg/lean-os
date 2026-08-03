"use client";

// 프로젝트 개요 대시보드 — 지표는 위에 타일로, 흐름은 얇은 막대로(2026-08-03 사장님 지시).
//
// 배경: 개요를 열면 "지금 뭘 해야 하는지"가 안 보이고 글이 먼저 나왔다.
//   경쟁사 성과·KPI 화면처럼 **숫자 타일 → 차트 → 표** 순서로 정리한다.
//   ⚠️ 그래프는 얇게(6px)·색은 절제해서 쓴다. 두꺼운 막대·원색 남발은 촌스럽다(사장님 강조).
//
// 절대규칙: 조회하지 않는다. 부모가 이미 받아 온 사실(facts)만 그린다.

const fmtMonth = (ym: string) => `${Number(ym.slice(5, 7))}월`;

export type OverviewFacts = {
  taskCount: number;
  taskDone: number;
  overdueTasks: boolean;
  overdueCount: number;
  outstanding: number;
  billed: number;
  paid: number;
  months: { ym: string; billed: number; paid: number }[];
  nextDue: string | null;
};

export function OverviewDashboard({ part, contract, facts, endDate, daysToEnd, won }: {
  /** 지표 타일과 차트 사이에 '지금 챙길 것'이 들어간다 — 해야 할 일이 차트보다 먼저다 */
  part: "tiles" | "charts";
  contract: number;
  facts: OverviewFacts | undefined;
  endDate: string | null;
  daysToEnd: number | null;
  won: (n: number | null | undefined) => string;
}) {
  const billed = facts?.billed || 0;
  const paid = facts?.paid || 0;
  const out = facts?.outstanding || 0;
  const total = facts?.taskCount || 0;
  const done = facts?.taskDone || 0;
  const overdue = facts?.overdueCount || 0;
  const collectRate = billed > 0 ? Math.round((paid / billed) * 100) : null;
  const progress = total > 0 ? Math.round((done / total) * 100) : null;
  const months = facts?.months || [];
  const peak = Math.max(1, ...months.map((m) => Math.max(m.billed, m.paid)));
  // 돈 흐름 막대는 같은 축을 쓴다 — 축이 다르면 길이 비교가 거짓말이 된다
  const moneyAxis = Math.max(contract, billed, paid, 1);
  const bar = (v: number, axis: number) => `${Math.max(v > 0 ? 2 : 0, Math.round((v / axis) * 100))}%`;

  const tiles: { label: string; value: string; sub: string; icon: string; chip: string; tone?: "risk" | "ok" }[] = [
    { label: "계약금액", icon: "📄", chip: "pj-chip-a", value: contract > 0 ? won(contract) : "—", sub: contract > 0 ? "VAT 별도" : "아직 정하지 않았어요" },
    { label: "입금액", icon: "💰", chip: "pj-chip-b", value: paid > 0 ? won(paid) : "—", sub: collectRate != null ? `발행액의 ${collectRate}%` : "아직 발행 전이에요", tone: "ok" },
    { label: "미수금", icon: "⏳", chip: "pj-chip-c", value: out > 1 ? won(out) : "없음", sub: out > 1 ? "발행 후 입금 확인 전" : "모두 들어왔어요", tone: out > 1 ? "risk" : undefined },
    {
      label: "진행률", icon: "✅", chip: "pj-chip-d", value: progress != null ? `${progress}%` : "—",
      sub: total > 0 ? `업무 ${done}/${total}건 완료${overdue > 0 ? ` · 지연 ${overdue}건` : ""}` : "업무를 추가하면 계산돼요",
      tone: overdue > 0 ? "risk" : undefined,
    },
  ];

  if (part === "tiles") {
    return (
      <div className="pj-dash-tiles">
        {tiles.map((t) => (
          <div key={t.label} className="pj-tile">
            <span className={`pj-tile-chip ${t.chip}`} aria-hidden="true">{t.icon}</span>
            <span className="pj-tile-body">
              <span className="stat-tile-label">{t.label}</span>
              <span className={`stat-tile-value ${t.tone === "risk" ? "pj-dash-risk" : t.tone === "ok" ? "pj-dash-ok" : ""}`}>{t.value}</span>
              <span className="pj-dash-sub">{t.sub}</span>
            </span>
          </div>
        ))}
      </div>
    );
  }

  return (
    <>
        {/* 돈 흐름 — 계약 → 발행 → 입금. 세 막대가 같은 축이라 길이 차이가 곧 남은 일이다 */}
        <section className="pj-panel">
          <div className="pj-dash-head"><b>수금 현황</b><span>계약 · 발행 · 입금</span></div>
          {contract === 0 && billed === 0 ? (
            <p className="pj-dash-empty">계약금액이나 세금계산서가 등록되면 표시돼요.</p>
          ) : (
            <div className="pj-dash-flow">
              {([["계약", contract, "pj-fill-base"], ["발행", billed, "pj-fill-mid"], ["입금", paid, "pj-fill-ok"]] as const).map(([label, v, cls]) => (
                <div key={label} className="pj-flow-row">
                  <span className="pj-flow-label">{label}</span>
                  <span className="pj-flow-track"><i className={cls} style={{ width: bar(v, moneyAxis) }} /></span>
                  <span className="pj-flow-val">{v > 0 ? won(v) : "—"}</span>
                </div>
              ))}
              {out > 1 && <p className="pj-dash-note">미수금 <b>{won(out)}</b> — 발행액과 입금액의 차이예요.</p>}
            </div>
          )}
        </section>

        {/* 월별 발행·입금 — 얇은 막대 두 줄. 최근 6개월만(더 보면 축이 촘촘해져 안 읽힌다) */}
        <section className="pj-panel">
          <div className="pj-dash-head"><b>월별 발행·입금</b><span>최근 6개월</span></div>
          {months.length === 0 ? (
            <p className="pj-dash-empty">세금계산서를 발행하면 월별로 표시돼요.</p>
          ) : (
            <>
              <div className="pj-dash-bars">
                {months.map((m) => (
                  <div key={m.ym} className="pj-bar-col" title={`${fmtMonth(m.ym)} 발행 ${won(m.billed)} · 입금 ${won(m.paid)}`}>
                    <span className="pj-bar-stack">
                      <i className="pj-fill-mid" style={{ height: `${Math.round((m.billed / peak) * 100)}%` }} />
                      <i className="pj-fill-ok" style={{ height: `${Math.round((m.paid / peak) * 100)}%` }} />
                    </span>
                    <span className="pj-bar-x">{fmtMonth(m.ym)}</span>
                  </div>
                ))}
              </div>
              <div className="pj-dash-legend">
                <span><i className="pj-fill-mid" />발행</span>
                <span><i className="pj-fill-ok" />입금</span>
              </div>
            </>
          )}
        </section>

        {/* 일정과 업무 — 마감까지 남은 날, 할 일 상태를 한 줄 스택으로 */}
        <section className="pj-panel">
          <div className="pj-dash-head"><b>일정·업무</b><span>마감일과 진행 현황</span></div>
          <div className="pj-dash-when">
            <div className="pj-when-row">
              <span className="pj-when-label">마감</span>
              <span className="pj-when-val">
                {endDate
                  ? <>{endDate} <b className={daysToEnd != null && daysToEnd < 0 ? "pj-dash-risk" : ""}>{daysToEnd == null ? "" : daysToEnd < 0 ? `D+${-daysToEnd}` : `D-${daysToEnd}`}</b></>
                  : <span className="pj-dash-dim">미정</span>}
              </span>
            </div>
            <div className="pj-when-row">
              <span className="pj-when-label">다음 업무</span>
              <span className="pj-when-val">{facts?.nextDue ? <>{facts.nextDue} 마감</> : <span className="pj-dash-dim">기한이 지정된 업무 없음</span>}</span>
            </div>
          </div>
          {total > 0 ? (
            <>
              <span className="pj-task-stack">
                <i className="pj-fill-ok" style={{ width: `${Math.round((done / total) * 100)}%` }} />
                <i className="pj-fill-risk" style={{ width: `${Math.round((overdue / total) * 100)}%` }} />
              </span>
              <div className="pj-dash-legend">
                <span><i className="pj-fill-ok" />완료 {done}</span>
                {overdue > 0 && <span><i className="pj-fill-risk" />지연 {overdue}</span>}
                <span><i className="pj-fill-rest" />남음 {Math.max(0, total - done - overdue)}</span>
              </div>
            </>
          ) : (
            <p className="pj-dash-empty">업무를 등록하면 진행 현황이 표시돼요.</p>
          )}
      </section>
    </>
  );
}
