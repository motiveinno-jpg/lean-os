"use client";

// 정리 그림들 — 도넛 · 깔때기 · 가로막대 · 주별막대 · 진행링 (2026-08-05).
//
//   형태는 데이터가 하는 일이 정한다(dataviz):
//     부분/전체 → 도넛(6조각 이하, 가운데 합계) · 순서 있는 단계 → 깔때기
//     이름표별 크기 비교 → 가로막대(한 가지 색) · 시간 흐름 → 세로막대 · 하나짜리 → 숫자
//   색은 사용자가 상태 옵션에 지정한 것을 그대로 쓴다 — 같은 뜻은 어디서나 같은 색.
//   이름표(사람·항목)는 크기를 색으로 또 칠하지 않는다(길이가 이미 크기다).
//   모든 그림에 값이 글자로 함께 있다 — 색만으로 뜻을 전하지 않는다.

import type { Figure } from "@/lib/project-template-summary";

const pctText = (v: number, total: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : "0%");

/** 그림 하나 — 정리 양식이 카드와 섞어 배치하므로 낱개로도 그릴 수 있어야 한다 */
export function BoardFigure({ f }: { f: Figure }) {
  if (f.kind === "stat") {
    return (
      <figure className={`bf bf-stat ${f.tone === "bad" ? "bf-bad" : f.tone === "ok" ? "bf-ok" : ""}`}>
        <figcaption>{f.title}</figcaption>
        <b>{f.value}</b>
        {f.note && <em>{f.note}</em>}
      </figure>
    );
  }

  if (f.kind === "ring") {
    // 하나짜리 부분/전체 — 원으로 채운다. 가운데 숫자가 본체고 원은 거들 뿐.
    const r = 34, C = 2 * Math.PI * r;
    const filled = Math.max(0, Math.min(100, f.pct));
    return (
      <figure className="bf bf-ring">
        <figcaption>{f.title}</figcaption>
        <div className="bf-ring-body">
          <svg viewBox="0 0 80 80" role="img" aria-label={`${f.title} ${f.pct}%`}>
            <circle cx="40" cy="40" r={r} className="bf-ring-track" />
            <circle cx="40" cy="40" r={r} className={f.tone === "bad" ? "bf-ring-fill bf-ring-bad" : "bf-ring-fill"}
              strokeDasharray={`${(C * filled) / 100} ${C}`} transform="rotate(-90 40 40)" />
          </svg>
          <span className={`bf-ring-center ${f.tone === "bad" ? "bf-bad" : ""}`}>{f.center}</span>
        </div>
        {f.note && <em>{f.note}</em>}
      </figure>
    );
  }

  if (f.kind === "donut") {
    const total = f.slices.reduce((s, x) => s + x.value, 0) || 1;
    const r = 34, C = 2 * Math.PI * r;
    let acc = 0;
    return (
      <figure className="bf bf-donut">
        <figcaption>{f.title}</figcaption>
        <div className="bf-donut-body">
          <svg viewBox="0 0 80 80" role="img" aria-label={f.title}>
            <circle cx="40" cy="40" r={r} className="bf-ring-track" />
            {f.slices.map((s) => {
              const len = (C * s.value) / total;
              // 조각 사이 2px 틈 — 테두리를 그리는 대신 배경색이 비치게 한다
              const seg = <circle key={s.key} cx="40" cy="40" r={r} className="bf-donut-seg"
                stroke={s.color} strokeDasharray={`${Math.max(0, len - 2)} ${C}`}
                strokeDashoffset={-acc} transform="rotate(-90 40 40)" />;
              acc += len;
              return seg;
            })}
          </svg>
          <span className="bf-ring-center bf-donut-total">{f.total}</span>
        </div>
        <ul className="bf-legend">
          {f.slices.map((s) => (
            <li key={s.key}>
              <i style={{ background: s.color }} />
              <span>{s.label}</span>
              <b>{s.value.toLocaleString("ko-KR")}</b>
              <em>{pctText(s.value, total)}</em>
            </li>
          ))}
        </ul>
        {f.note && <em className="bf-note">{f.note}</em>}
      </figure>
    );
  }

  if (f.kind === "funnel") {
    const max = Math.max(...f.slices.map((s) => s.value), 1);
    return (
      <figure className="bf bf-funnel">
        <figcaption>{f.title}</figcaption>
        <ul className="bf-funnel-rows">
          {f.slices.map((s) => (
            <li key={s.key}>
              <span className="bf-funnel-k">{s.label}</span>
              <span className="bf-funnel-track">
                <i style={{ width: `${(s.value / max) * 100}%`, background: s.color }} />
              </span>
              <b>{s.value.toLocaleString("ko-KR")}</b>
            </li>
          ))}
        </ul>
        {f.note && <em className="bf-note">{f.note}</em>}
      </figure>
    );
  }

  if (f.kind === "hbars") {
    const max = Math.max(...f.rows.map((r) => r.value), 1);
    return (
      <figure className="bf bf-hbars">
        <figcaption>{f.title}</figcaption>
        <ul className="bf-hbar-rows">
          {f.rows.map((r) => (
            <li key={r.label}>
              <span className="bf-hbar-k" title={r.label}>{r.label}</span>
              <span className="bf-hbar-track"><i style={{ width: `${(r.value / max) * 100}%` }} /></span>
              <b>{r.text || r.value.toLocaleString("ko-KR")}</b>
            </li>
          ))}
        </ul>
        {f.note && <em className="bf-note">{f.note}</em>}
      </figure>
    );
  }

  if (f.kind === "line") {
    // 꺾은선 — 시간의 오르내림. 축 글자는 SVG 밖(HTML)에 둬야 늘어나도 안 찌그러진다
    const W = 320, H = 110, PAD = 6;
    const max = Math.max(...f.points.map((p) => p.value), 1);
    const step = f.points.length > 1 ? (W - PAD * 2) / (f.points.length - 1) : 0;
    const xy = f.points.map((p, i) => ({
      x: PAD + i * step, y: H - PAD - (p.value / max) * (H - PAD * 2), p,
    }));
    const line = xy.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");
    const area = `${PAD},${H - PAD} ${line} ${(W - PAD).toFixed(1)},${H - PAD}`;
    const nowAt = xy.find((q) => q.p.now);
    const short = (n: number) => (f.unit === "원"
      ? (Math.abs(n) >= 10_000 ? `${Math.round(n / 10_000).toLocaleString("ko-KR")}만` : n.toLocaleString("ko-KR"))
      : n.toLocaleString("ko-KR"));
    return (
      <figure className="bf bf-line">
        <figcaption>{f.title}</figcaption>
        <div className="bf-line-body">
          <span className="bf-line-max">{short(max)}{f.unit || ""}</span>
          <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={f.title}>
            <polygon className="bf-line-area" points={area} />
            <polyline className="bf-line-path" points={line} />
            {nowAt && <line className="bf-line-now" x1={nowAt.x} y1={PAD} x2={nowAt.x} y2={H - PAD} />}
            {xy.map((q) => <circle key={q.p.label} className="bf-line-dot" cx={q.x} cy={q.y} r={2.5} />)}
          </svg>
        </div>
        <div className="bf-line-x">
          {f.points.map((p) => (
            <span key={p.label} className={p.now ? "bf-line-nowk" : ""} title={`${p.label} ${short(p.value)}${f.unit || ""}`}>
              {p.label}
            </span>
          ))}
        </div>
        {f.note && <em className="bf-note">{f.note}</em>}
      </figure>
    );
  }

  // weeks
  const max = Math.max(...f.bars.map((b) => b.value), 1);
  return (
    <figure className="bf bf-weeks">
      <figcaption>{f.title}</figcaption>
      <div className="bf-week-row">
        {f.bars.map((b) => (
          <span key={b.label} className="bf-week" title={`${b.label} ${b.value}건`}>
            <span className="bf-week-bar">
              {b.value > 0 && <i className={b.hot ? "bf-week-hot" : ""} style={{ height: `${(b.value / max) * 100}%` }} />}
            </span>
            <em>{b.value > 0 ? b.value : ""}</em>
            <span className={`bf-week-k ${b.hot ? "bf-bad" : ""}`}>{b.label}</span>
          </span>
        ))}
      </div>
      {f.note && <em className="bf-note">{f.note}</em>}
    </figure>
  );
}
