"use client";

// 빈 상태(0건) 표준 컴포넌트 — 라운드7 파운데이션.
//   화면마다 제각각이던 "데이터 없음" 표기(대형 이모지·맨 텍스트·빈 테이블)를 수렴.
//   아이콘 칩 + 제목 + 설명 + (선택) CTA. 시각은 globals.css .empty-state 계열이 담당.
//   카드 안에서 쓰면 <EmptyState .../> 만, 단독이면 <EmptyState card .../> 로 glass-card 래핑.

import type { ReactNode } from "react";

export function EmptyState({
  icon,
  title,
  desc,
  action,
  card = false,
}: {
  /** 이모지 1개 또는 아이콘 노드 — 칩 안에 작게 표시 */
  icon?: ReactNode;
  title: string;
  desc?: string;
  /** CTA 버튼/링크 노드 (btn-primary / btn-secondary 권장) */
  action?: ReactNode;
  /** true 면 glass-card 로 감싸 단독 배치 */
  card?: boolean;
}) {
  const body = (
    <div className="empty-state">
      {icon != null && <div className="empty-state-icon">{icon}</div>}
      <div className="empty-state-title">{title}</div>
      {desc && <div className="empty-state-desc">{desc}</div>}
      {action}
    </div>
  );
  return card ? <div className="glass-card">{body}</div> : body;
}
