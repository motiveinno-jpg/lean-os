"use client";

// 성장 분석 섹션 (2026-07-29 리디자인) — 기존 "트래픽·이용 현황" 을 대체.
//   일/월/년 단위로 방문자·페이지뷰·신규 가입자·신규 회사·체험 시작을 한 화면에서.
//   데이터는 platform_analytics RPC(운영자 게이트 내장, 빈 버킷 0 채움) 하나로 받는다.
//
// 차트 설계 원칙(dataviz):
//   - 단일 시리즈만 그린다 — 지표 타일을 클릭해 바꾸는 방식. 이중축 금지.
//   - 색은 앱 프라이머리 한 색(순차적 역할). 텍스트는 텍스트 토큰만 쓴다.
//   - 막대는 상단만 4px 라운드·간격 유지, 그리드는 배경색으로 물러나게.
//   - 모든 막대에 호버 툴팁(해당 기간의 전 지표), 하단에 표(테이블 뷰) 병행.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { countPlanKinds } from "./plan-kind";

type Bucket = {
  start: string;      // 'YYYY-MM-DD' (버킷 시작, KST)
  visitors: number; views: number; guests: number;
  accounts: number; companies: number; trials: number;
};
type Analytics = { as_of: string; granularity: string; page_views_since: string | null; buckets: Bucket[] };

type Gran = "day" | "month" | "year";
const GRANS: { key: Gran; label: string; buckets: number }[] = [
  { key: "day", label: "일간", buckets: 30 },
  { key: "month", label: "월간", buckets: 12 },
  { key: "year", label: "연간", buckets: 3 },
];

type MetricKey = "visitors" | "views" | "guests" | "accounts" | "companies" | "trials";
const METRICS: { key: MetricKey; label: string; unit: string }[] = [
  { key: "visitors", label: "방문자(전체)", unit: "명" },
  { key: "guests", label: "비로그인 방문자(전체에 포함)", unit: "명" },
  { key: "views", label: "페이지뷰", unit: "회" },
  { key: "accounts", label: "신규 가입자", unit: "명" },
  { key: "companies", label: "신규 회사", unit: "곳" },
  { key: "trials", label: "체험 시작", unit: "건" },
];

const fmt = (n: number) => n.toLocaleString("ko-KR");

function bucketLabel(start: string, gran: Gran, long = false): string {
  const [y, m, d] = start.split("-");
  if (gran === "year") return `${y}년`;
  if (gran === "month") return long ? `${y}년 ${Number(m)}월` : `${Number(m)}월`;
  return long ? `${Number(m)}월 ${Number(d)}일` : `${m}.${d}`;
}

/** 축 상한을 1/2/5 단위로 올림 — 그리드 눈금이 어중간한 수가 되지 않게. */
function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 5, 10]) if (v <= m * pow) return m * pow;
  return 10 * pow;
}

/** 상단만 둥근 막대 path — rect(rx)는 아래까지 둥글어져 베이스라인이 떠 보인다. */
function barPath(x: number, y: number, w: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  return `M${x},${y + h} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h} Z`;
}

export function AnalyticsSection({ usage, traffic, companies, testData }: {
  // page.tsx 의 기존 쿼리를 그대로 받는다 — 활동 사용자·인기 페이지·유입 경로 표시용.
  usage: { accounts: { dau: number; wau: number; mau: number; never_signed_in: number; total: number } } | null;
  traffic: {
    top_paths: { path: string; views: number }[];
    top_referrers: { host: string; visitors: number }[];
  } | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  companies: any[];
  /** 시각 검증·테스트용 — 주면 RPC 를 부르지 않고 이 데이터로 렌더한다. */
  testData?: Analytics;
}) {
  const [gran, setGran] = useState<Gran>("day");
  const [metric, setMetric] = useState<MetricKey>("visitors");
  const [hover, setHover] = useState<number | null>(null);

  const { data, isLoading } = useQuery<Analytics | null>({
    queryKey: ["p-analytics", gran],
    initialData: testData ?? undefined,
    enabled: !testData,
    queryFn: async () => {
      const cfg = GRANS.find((g) => g.key === gran)!;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data: d, error } = await (supabase as any).rpc("platform_analytics", {
        p_granularity: gran, p_buckets: cfg.buckets,
      });
      if (error) return null;
      return d as Analytics;
    },
    refetchInterval: 60_000,
  });

  const buckets = useMemo(() => data?.buckets ?? [], [data]);
  const kinds = useMemo(() => countPlanKinds(companies), [companies]);

  // 타일 수치: 현재 버킷(오늘/이번 달/올해) + 직전 버킷 대비 증감
  const tiles = METRICS.map((m) => {
    const cur = buckets.length ? buckets[buckets.length - 1][m.key] : 0;
    const prev = buckets.length > 1 ? buckets[buckets.length - 2][m.key] : 0;
    const total = buckets.reduce((s, b) => s + b[m.key], 0);
    return { ...m, cur, prev, total, delta: cur - prev };
  });

  // ── 차트 좌표 계산 ──
  const W = 720, H = 240, PL = 40, PB = 22, PT = 12, PR = 8;
  const innerW = W - PL - PR, innerH = H - PT - PB;
  const n = Math.max(1, buckets.length);
  const yMax = niceMax(Math.max(1, ...buckets.map((b) => b[metric])));
  const slot = innerW / n;
  const barW = Math.min(Math.max(slot * 0.55, 3), 34);
  const xOf = (i: number) => PL + i * slot + (slot - barW) / 2;
  const hOf = (v: number) => (v / yMax) * innerH;
  // x축 라벨은 6개 안팎만 — 30일치를 전부 쓰면 겹친다
  const tickEvery = Math.max(1, Math.ceil(n / 6));
  const metricMeta = METRICS.find((m) => m.key === metric)!;
  const curLabel = gran === "day" ? "오늘" : gran === "month" ? "이번 달" : "올해";
  const prevLabel = gran === "day" ? "어제" : gran === "month" ? "지난달" : "작년";
  const allZero = buckets.every((b) => b[metric] === 0);

  return (
    <section className="pa-section">
      {/* 헤더: 제목 + 기간 전환 */}
      <div className="pa-head">
        <div>
          <h2 className="pa-title">성장 분석</h2>
          <p className="pa-subtitle">
            방문자·페이지뷰는 {data?.page_views_since ? new Date(data.page_views_since).toLocaleDateString("ko-KR", { month: "long", day: "numeric" }) : "2026-07-28"}부터 수집 · 가입 지표는 전 기간
          </p>
        </div>
        <div className="seg-bar">
          {GRANS.map((g) => (
            <button key={g.key} onClick={() => setGran(g.key)}
              className={`seg-item ${gran === g.key ? "seg-item-active" : ""}`}>
              {g.label}
            </button>
          ))}
        </div>
      </div>

      {/* 지표 타일 — 클릭하면 차트가 그 지표로 바뀐다 */}
      <div className="pa-tiles">
        {tiles.map((t) => (
          <button key={t.key} type="button" onClick={() => setMetric(t.key)}
            className={`pa-tile glass-card ${metric === t.key ? "pa-tile-active" : ""}`}>
            <span className="pa-tile-label">{t.label}</span>
            <span className="pa-tile-value mono-number">{fmt(t.cur)}<span className="pa-tile-unit">{t.unit}</span></span>
            <span className="pa-tile-foot">
              {t.prev > 0 || t.cur > 0 ? (
                <span className={t.delta > 0 ? "pa-delta-up" : t.delta < 0 ? "pa-delta-down" : "pa-delta-flat"}>
                  {t.delta > 0 ? "▲" : t.delta < 0 ? "▼" : "—"} {t.delta === 0 ? prevLabel + " 동일" : `${fmt(Math.abs(t.delta))} (${prevLabel} ${fmt(t.prev)})`}
                </span>
              ) : (
                <span className="pa-delta-flat">기간 내 없음</span>
              )}
            </span>
          </button>
        ))}
      </div>

      <div className="pa-grid">
        {/* 왼쪽: 차트 + 기간별 상세 표 (표가 차트의 테이블 뷰를 겸한다) */}
        <div className="pa-main">
        <div className="pa-chart-card glass-card">
          <div className="pa-chart-head">
            <span className="pa-chart-title">{metricMeta.label} 추이 <span className="pa-chart-range">최근 {n}{gran === "day" ? "일" : gran === "month" ? "개월" : "년"}</span></span>
            <span className="pa-chart-cur">{curLabel} <b className="mono-number">{fmt(tiles.find((t) => t.key === metric)?.cur ?? 0)}</b>{metricMeta.unit}</span>
          </div>

          {isLoading ? (
            <div className="pa-empty">불러오는 중…</div>
          ) : allZero ? (
            <div className="pa-empty">
              이 기간에는 {metricMeta.label} 기록이 없습니다.
              {(metric === "visitors" || metric === "views" || metric === "guests") && <><br /><span className="pa-empty-sub">방문 수집은 2026-07-28에 시작됐습니다.</span></>}
            </div>
          ) : (
            <div className="pa-chart-wrap" onMouseLeave={() => setHover(null)}>
              <svg viewBox={`0 0 ${W} ${H}`} className="pa-svg" role="img" aria-label={`${metricMeta.label} ${gran === "day" ? "일별" : gran === "month" ? "월별" : "연도별"} 추이`}>
                {/* 그리드 + y라벨 (0 · 중간 · 최대) */}
                {[0, 0.5, 1].map((f) => {
                  const y = PT + innerH - f * innerH;
                  return (
                    <g key={f}>
                      <line x1={PL} y1={y} x2={W - PR} y2={y} className="pa-gridline" />
                      <text x={PL - 6} y={y + 3.5} textAnchor="end" className="pa-axis-text">{fmt(Math.round(yMax * f))}</text>
                    </g>
                  );
                })}
                {/* 막대 + 호버 히트영역 */}
                {buckets.map((b, i) => {
                  const v = b[metric];
                  const h = hOf(v);
                  return (
                    <g key={b.start}>
                      {v > 0 && (
                        <path d={barPath(xOf(i), PT + innerH - h, barW, h)}
                          className={hover === null || hover === i ? "pa-bar" : "pa-bar pa-bar-dim"} />
                      )}
                      <rect x={PL + i * slot} y={PT} width={slot} height={innerH + PB}
                        className="pa-hit" onMouseEnter={() => setHover(i)} />
                      {(i % tickEvery === 0 || i === n - 1) && (
                        <text x={PL + i * slot + slot / 2} y={H - 6} textAnchor="middle" className="pa-axis-text">
                          {bucketLabel(b.start, gran)}
                        </text>
                      )}
                    </g>
                  );
                })}
              </svg>
              {/* 툴팁 — 해당 기간의 전 지표 */}
              {hover !== null && buckets[hover] && (
                <div className="pa-tooltip" style={{ left: `${((PL + hover * slot + slot / 2) / W) * 100}%` }}>
                  <div className="pa-tooltip-title">{bucketLabel(buckets[hover].start, gran, true)}</div>
                  {METRICS.map((m) => (
                    <div key={m.key} className={`pa-tooltip-row ${m.key === metric ? "pa-tooltip-row-active" : ""}`}>
                      <span>{m.label}</span><span className="mono-number">{fmt(buckets[hover]![m.key])}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* 기간별 상세 표 — 차트의 테이블 뷰(접근성) 겸 정밀 수치 확인용 */}
      <div className="glass-card p-0 pa-table-scroll">
        <table className="pa-table">
          <thead className="sticky-bar">
            <tr className="table-head-row">
              <th className="th-cell text-left">기간</th>
              <th className="th-cell text-right">방문자</th>
              <th className="th-cell text-right">페이지뷰</th>
              <th className="th-cell text-right">비로그인</th>
              <th className="th-cell text-right">신규 가입자</th>
              <th className="th-cell text-right">신규 회사</th>
              <th className="th-cell text-right">체험 시작</th>
            </tr>
          </thead>
          <tbody>
            {[...buckets].reverse().map((b, ri) => (
              <tr key={b.start} className={`pa-table-row ${ri === 0 ? "pa-table-row-current" : ""}`}>
                <td className="pa-td text-left">{bucketLabel(b.start, gran, true)}{ri === 0 && <span className="pa-now-badge">{curLabel}</span>}</td>
                <td className="pa-td mono-number">{fmt(b.visitors)}</td>
                <td className="pa-td mono-number">{fmt(b.views)}</td>
                <td className="pa-td mono-number">{fmt(b.guests)}</td>
                <td className="pa-td mono-number">{fmt(b.accounts)}</td>
                <td className="pa-td mono-number">{fmt(b.companies)}</td>
                <td className="pa-td mono-number">{fmt(b.trials)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
        </div>

        {/* 사이드: 활동 사용자 · 이용 형태 · 인기 페이지 · 유입 */}
        <div className="pa-side">
          <div className="glass-card p-4">
            <div className="pa-side-title">활동 사용자</div>
            <div className="pa-active-row">
              {[
                { label: "오늘", v: usage?.accounts.dau ?? 0 },
                { label: "주간", v: usage?.accounts.wau ?? 0 },
                { label: "월간", v: usage?.accounts.mau ?? 0 },
              ].map((x) => (
                <div key={x.label} className="pa-active-cell">
                  <span className="pa-active-num mono-number">{fmt(x.v)}</span>
                  <span className="pa-active-label">{x.label}</span>
                </div>
              ))}
            </div>
            <div className="pa-side-foot">미로그인 계정 {fmt(usage?.accounts.never_signed_in ?? 0)} / 전체 {fmt(usage?.accounts.total ?? 0)}</div>
          </div>

          <div className="glass-card p-4">
            <div className="pa-side-title">이용 형태</div>
            <div className="platform-plan-rows">
              {[
                { label: "미구독", n: kinds.free, cls: "platform-plan-free" },
                { label: "체험 중", n: kinds.trial, cls: "platform-plan-trial" },
                { label: "체험 만료", n: kinds.expired, cls: "platform-plan-expired" },
                { label: "유료", n: kinds.paid, cls: "platform-plan-paid" },
              ].map((r) => {
                const total = Math.max(1, kinds.free + kinds.trial + kinds.expired + kinds.paid);
                return (
                  <div key={r.label}>
                    <div className="flex items-center justify-between text-xs mb-1">
                      <span className="text-[var(--text-muted)]">{r.label}</span>
                      <span className="mono-number font-bold text-[var(--text)]">{r.n}곳</span>
                    </div>
                    <div className="platform-plan-bar"><div className={`platform-plan-fill ${r.cls}`} style={{ width: `${(r.n / total) * 100}%` }} /></div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="glass-card p-4">
            <div className="pa-side-title">많이 본 페이지</div>
            {(traffic?.top_paths?.length ?? 0) === 0 ? (
              <div className="pa-side-empty">수집 대기 중</div>
            ) : (
              <ul className="platform-traffic-list">
                {traffic!.top_paths.slice(0, 5).map((p) => (
                  <li key={p.path}><span className="truncate">{p.path}</span><span className="mono-number">{fmt(p.views)}</span></li>
                ))}
              </ul>
            )}
            <div className="pa-side-title mt-4">유입 경로</div>
            {(traffic?.top_referrers?.length ?? 0) === 0 ? (
              <div className="pa-side-empty">수집 대기 중</div>
            ) : (
              <ul className="platform-traffic-list">
                {traffic!.top_referrers.slice(0, 4).map((r) => (
                  <li key={r.host}><span className="truncate">{r.host}</span><span className="mono-number">{fmt(r.visitors)}</span></li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>


    </section>
  );
}
