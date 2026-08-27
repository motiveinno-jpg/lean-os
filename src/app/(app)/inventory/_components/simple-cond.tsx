"use client";

// ── 검색조건(값 필터) — 조회 화면 표준 (2026-08-27 사장님 지적: "전체·부족·품절 같은 값 필터는 검색조건에 넣어 고르는 것") ──
//   조회 줄에는 값 칩을 늘어놓지 않는다. 값은 여기 패널에서 **다중으로 고르고 '조회'**로 한 번에 나간다.
//   걸린 조건은 AppliedChips 로 조회 줄 아래에 보이고 ✕ 로 하나씩 뺀다. 패널은 표를 밀지 않고 떠서 열린다.

import { useEffect, useState } from "react";
import { ConditionPanel, ConditionRow, AppliedChips, type AppliedChip } from "@/components/query-kit";

export type CondGroup = { key: string; label: string; hint?: string; options: { value: string; label: string; title?: string }[] };
export type CondLive = Record<string, string[]>;

export const condCount = (live: CondLive) => Object.values(live).reduce((n, v) => n + (v?.length || 0), 0);
export const condHit = (live: CondLive, key: string, value: string) => !live[key]?.length || live[key].includes(value);

export function SimpleCond({ groups, live, onApply, label }: { groups: CondGroup[]; live: CondLive; onApply: (v: CondLive) => void; label?: string }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<CondLive>(live);
  useEffect(() => { if (open) setDraft(live); }, [open, live]);
  const toggle = (k: string, v: string) => setDraft((d) => { const cur = d[k] || []; return { ...d, [k]: cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v] }; });
  return (
    <ConditionPanel open={open} onOpenChange={setOpen} activeCount={condCount(live)} label={label}
      foot={<>
        <button type="button" className="btn-secondary btn-sm" disabled={condCount(draft) === 0} onClick={() => setDraft({})}>조건 지우기</button>
        <span className="doc-sums-sp" />
        <button type="button" className="btn-primary btn-sm" onClick={() => { onApply(draft); setOpen(false); }}>조회</button>
      </>}>
      {groups.map((g) => (
        <ConditionRow key={g.key} label={g.label} hint={g.hint}>
          <div className="qk-chips">
            {g.options.map((o) => (
              <button key={o.value} type="button" title={o.title} className={draft[g.key]?.includes(o.value) ? "qk-chip qk-chip-on" : "qk-chip"} onClick={() => toggle(g.key, o.value)}>{o.label}</button>
            ))}
          </div>
        </ConditionRow>
      ))}
    </ConditionPanel>
  );
}

/** 걸린 조건 칩 — 조회 줄 아래 */
export function SimpleApplied({ groups, live, onApply }: { groups: CondGroup[]; live: CondLive; onApply: (v: CondLive) => void }) {
  const chips: AppliedChip[] = [];
  for (const g of groups) for (const v of live[g.key] || []) {
    const o = g.options.find((x) => x.value === v);
    chips.push({ group: g.label, label: o?.label || v, onRemove: () => onApply({ ...live, [g.key]: (live[g.key] || []).filter((x) => x !== v) }) });
  }
  return <AppliedChips chips={chips} onClearAll={() => onApply({})} />;
}
