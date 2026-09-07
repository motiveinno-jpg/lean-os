"use client";

// 상태 점·글자 — 계정 칩·메신저 구성원 줄·1:1 대화 머리에서 같은 부품 (2026-09-04 내 상태)
//   근무중(기본)은 아무것도 그리지 않는다. 점 색은 상태별 CSS(.presence-dot-*).

import { effectivePresence, presenceText, PRESENCE_LABEL, type PresenceRow } from "@/lib/presence";

export function PresenceDot({ row, className = "" }: { row: PresenceRow | null | undefined; className?: string }) {
  const p = effectivePresence(row);
  if (p.status === "available") return null;
  return <i className={`presence-dot presence-dot-${p.status} ${className}`} title={presenceText(p)} aria-label={presenceText(p)} />;
}

export function PresenceText({ row, className = "" }: { row: PresenceRow | null | undefined; className?: string }) {
  const p = effectivePresence(row);
  if (p.status === "available") return null;
  return <span className={`presence-text ${className}`}><i className={`presence-dot presence-dot-${p.status}`} />{presenceText(p)}</span>;
}

/** 구성원 디렉토리용 상태 칩 — 근무중(기본)도 초록 점과 글자로 보여 준다. 계정이 없는 사람은 그리지 않는다. */
export function PresenceChip({ row, className = "" }: { row: PresenceRow | null | undefined; className?: string }) {
  if (!row) return null;
  const p = effectivePresence(row);
  const detail = presenceText(p);
  return (
    <span className={`presence-chip-ro presence-chip-ro-${p.status} ${className}`} title={detail || PRESENCE_LABEL.available}>
      <i className={`presence-dot presence-dot-${p.status}`} />{PRESENCE_LABEL[p.status]}
    </span>
  );
}
