"use client";

// 담당별 보기 — "누가 뭘 얼마나 맡고 있나"를 한 화면에서(2026-08-03 개편 ④).
//
// 배경: 목록·표·상세 어디에도 사람 기준으로 묶어 보는 자리가 없었다. 대표가 "이건 누가 하고
//   있지", "김 과장 지금 몇 건이지"를 물으면 프로젝트를 하나씩 열어 봐야 했다.
//   상태(지연·주의)는 project-status.ts 가 내린 것을 그대로 쓴다 — 여기서 다시 판정하지 않는다.

import { STATUS_LABEL, type ProjectStatusKey } from "@/lib/project-status";

type Row = { id: string; name?: string | null; internal_manager_id?: string | null };

export function PeopleView({ rows, statusOf, progressOf, outstandingOf, userName, membersOf, won, onOpen }: {
  rows: Row[];
  /** 이 프로젝트에 참여하는 사람들 — 대표담당자 한 명 대신 여럿(2026-08-03) */
  membersOf: (dealId: string) => string[];
  statusOf: (d: Row) => ProjectStatusKey;
  /** 대표 지표 진행률(0~100). 없으면 null */
  progressOf: (d: Row) => number | null;
  outstandingOf: (dealId: string) => number;
  userName: (userId: string | null | undefined) => string;
  won: (n: number | null | undefined) => string;
  onOpen: (dealId: string) => void;
}) {
  // 참여자별로 모은다. 한 프로젝트에 여러 명이 있으면 그 사람들 카드에 모두 들어간다
  //   ("누가 뭘 맡고 있나" 를 보는 화면이라 중복이 맞다).
  //   아무도 안 들어간 건은 '참여자 없음' 묶음으로 — 숨기면 영영 안 정해진다.
  const groups = new Map<string, { name: string; items: Row[] }>();
  for (const d of rows) {
    const ids = membersOf(d.id);
    const keys = ids.length > 0 ? ids : ["__none__"];
    for (const key of keys) {
      const g = groups.get(key) || { name: key === "__none__" ? "참여자 없음" : (userName(key) || "이름 없음"), items: [] };
      g.items.push(d);
      groups.set(key, g);
    }
  }

  const cards = [...groups.entries()].map(([key, g]) => {
    let late = 0, warn = 0, out = 0, pctSum = 0, pctCount = 0;
    for (const d of g.items) {
      const st = statusOf(d);
      if (st === "late") late++;
      else if (st === "warn") warn++;
      out += outstandingOf(d.id);
      const p = progressOf(d);
      if (p != null) { pctSum += p; pctCount++; }
    }
    return { key, name: g.name, items: g.items, late, warn, out, avg: pctCount ? Math.round(pctSum / pctCount) : null };
  }).sort((a, b) => (b.late - a.late) || (b.warn - a.warn) || (b.items.length - a.items.length));

  if (cards.length === 0) return null;

  return (
    <div className="ph-people">
      {cards.map((c) => (
        <section key={c.key} className="ph-person">
          <div className="ph-person-head">
            <span className="ph-person-avatar" aria-hidden="true">{c.name.slice(0, 1)}</span>
            <b>{c.name}</b>
            <span className="ph-person-count">{c.items.length}건</span>
            {c.late > 0 && <span className="ph-st ph-st-late">{STATUS_LABEL.late} {c.late}</span>}
            {c.warn > 0 && <span className="ph-st ph-st-warn">{STATUS_LABEL.warn} {c.warn}</span>}
            {c.out > 1 && <span className="ph-person-out">미수금 {won(c.out)}</span>}
            {c.avg != null && (
              <span className="ph-person-avg">
                <span className="ph-table-track"><i style={{ width: `${c.avg}%` }} /></span>평균 {c.avg}%
              </span>
            )}
          </div>
          <div className="ph-person-items">
            {c.items.map((d) => {
              const st = statusOf(d);
              const p = progressOf(d);
              return (
                <button key={d.id} type="button" className="ph-person-item" onClick={() => onOpen(d.id)}>
                  <i className={`ph-person-dot ph-person-dot-${st}`} />
                  <span className="ph-person-name">{d.name || "(이름 없음)"}</span>
                  {p != null && <span className="ph-person-pct">{p}%</span>}
                </button>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
