"use client";

// 정리 그림들 — 도넛 · 가로막대 · 주별 세로막대 · 꺾은선 · 진행링 (2026-08-05).
//
//   2026-08-07: 이 화면만 **차트 키트를 안 쓰고** 자체 SVG/CSS 로 그리고 있었다.
//   그래서 다른 화면과 규칙이 어긋났다 — 막대 양끝이 다 둥글었고(축에서 떠 보인다),
//   손을 올려도 값이 안 뜨고(브라우저 기본 툴팁뿐), 0인 주는 막대가 아예 사라졌고,
//   꺾은선은 가로로 늘면 점이 타원이 됐다. 이제 그림은 전부 키트가 그린다.
//
//   여기 남는 것은 '무엇을 보여줄지'와 정리 화면 고유의 두 가지뿐이다.
//     · 진행 링 — 키트에 없는 형태(하나짜리 부분/전체)
//     · 도넛 옆 목록 — 조각마다 값과 비율을 글자로 함께 읽는다
//   색은 사용자가 상태 옵션에 지정한 것을 그대로 쓴다 — 같은 뜻은 어디서나 같은 색.
//   이름표(사람·항목)는 크기를 색으로 또 칠하지 않는다(길이가 이미 크기다).

import { BarChart, ColumnChart, DonutChart, LineChart } from "@/components/charts/kit";
import type { Figure } from "@/lib/project-template-summary";

const pctText = (v: number, total: number) => (total > 0 ? `${Math.round((v / total) * 100)}%` : "0%");
const num = (n: number) => n.toLocaleString("ko-KR");

/** 그림 하나 — 정리 양식이 카드와 섞어 배치하므로 낱개로도 그릴 수 있어야 한다.
 *  `table` 이면 같은 값을 표로 읽는다(색만으로 뜻을 전하지 않기 위한 대안 보기). */
export function BoardFigure({ f, table }: { f: Figure; table?: boolean }) {
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
    return (
      <figure className="bf bf-donut">
        <figcaption>{f.title}</figcaption>
        {table ? (
          <FigureTable head={["항목", "값", "비율"]}
            rows={f.slices.map((s) => [s.label, num(s.value), pctText(s.value, total)])} />
        ) : (<>
          <div className="bf-viz-donut">
            <DonutChart data={f.slices.map((s) => ({ label: s.label, value: s.value, color: s.color }))}
              total={f.total} unit={f.unit || ""} />
          </div>
          <ul className="bf-legend">
            {f.slices.map((s) => (
              <li key={s.key}>
                <i style={{ background: s.color }} />
                <span>{s.label}</span>
                <b>{num(s.value)}</b>
                <em>{pctText(s.value, total)}</em>
              </li>
            ))}
          </ul>
        </>)}
        {f.note && <em className="bf-note">{f.note}</em>}
      </figure>
    );
  }

  if (f.kind === "hbars") {
    return (
      <figure className="bf bf-hbars">
        <figcaption>{f.title}</figcaption>
        {table ? (
          <FigureTable head={["항목", "값"]} rows={f.rows.map((r) => [r.label, `${num(r.value)}${f.unit || ""}`])} />
        ) : (
          //   이름표별 크기 비교 — 색은 하나(길이가 이미 크기다). 단계처럼 뜻이 있는 색만 그대로 쓴다.
          <BarChart unit={f.unit || ""}
            data={f.rows.map((r) => ({ label: r.label, value: r.value, color: r.color || "var(--viz-1)" }))} />
        )}
        {f.note && <em className="bf-note">{f.note}</em>}
      </figure>
    );
  }

  if (f.kind === "line") {
    return (
      <figure className="bf bf-line">
        <figcaption>{f.title}</figcaption>
        {table ? (
          <FigureTable head={["주", "값"]} rows={f.points.map((p) => [p.now ? `${p.label} (이번 주)` : p.label, `${num(p.value)}${f.unit || ""}`])} />
        ) : (
          <LineChart height={150} unit={f.unit || ""}
            series={[{ name: f.title, points: f.points.map((p) => ({ label: p.label, value: p.value })) }]} />
        )}
        {f.note && <em className="bf-note">{f.note}</em>}
      </figure>
    );
  }

  // weeks — 주별 세로 막대. 0인 주도 자리를 지킨다(값이 0인 것과 자료가 없는 것은 다르다).
  return (
    <figure className="bf bf-weeks">
      <figcaption>{f.title}</figcaption>
      {table ? (
        <FigureTable head={["주", "건수"]} rows={f.bars.map((b) => [b.label, `${num(b.value)}건`])} />
      ) : (
        <ColumnChart height={150} unit="건"
          data={f.bars.map((b) => ({ label: b.label, value: b.value, color: b.hot ? "var(--danger)" : "var(--viz-1)" }))} />
      )}
      {f.note && <em className="bf-note">{f.note}</em>}
    </figure>
  );
}

/** 그림 대신 숫자로 읽기 — 색을 못 가르는 눈에도 같은 값이 그대로 남아야 한다 */
function FigureTable({ head, rows }: { head: string[]; rows: string[][] }) {
  return (
    <table className="bf-table">
      <thead><tr>{head.map((h, i) => <th key={h} className={i === 0 ? "" : "bf-td-n"}>{h}</th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r[0]}>{r.map((c, i) => <td key={i} className={i === 0 ? "" : "bf-td-n"}>{c}</td>)}</tr>
        ))}
      </tbody>
    </table>
  );
}
