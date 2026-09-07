"use client";

// 상태 점·글자 — 계정 칩·메신저 구성원 줄·1:1 대화 머리에서 같은 부품 (2026-09-04 내 상태)
//   근무중(기본)은 아무것도 그리지 않는다. 점 색은 상태별 CSS(.presence-dot-*).

import { effectivePresence, presenceText, type PresenceRow } from "@/lib/presence";
import type { WorkStatus } from "@/lib/work-status";

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

/** 구성원 디렉토리 이름 옆 — 스스로 고른 상태와 오늘 근태를 합친 결과(lib/work-status.ts). */
export function WorkStatusChip({ status, className = "" }: { status: WorkStatus | null | undefined; className?: string }) {
  if (!status) return null;
  return (
    <span className={`presence-chip-ro work-tone-${status.tone} ${className}`} title={status.detail || status.label} aria-label={status.detail ? `${status.label} · ${status.detail}` : status.label}>
      <i className="presence-dot work-dot" />{status.label}
    </span>
  );
}
