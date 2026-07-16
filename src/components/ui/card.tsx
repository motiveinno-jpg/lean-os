"use client";

// 공통 글래스 Card — 2026-05-27 새 디자인 시스템(시안 기반).
//   rounded-16, bg-white/80 backdrop-blur, shadow, border-white/60. hover 시 -translate-y-1(옵션).
//   다크모드는 토큰(var(--glass-bg)/--glass-border)으로 자동 대응.

import { HTMLAttributes, forwardRef } from "react";

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
}

export const Card = forwardRef<HTMLDivElement, CardProps>(function Card(
  { hover = false, className = "", children, ...props },
  ref,
) {
  return (
    <div
      ref={ref}
      className={`ui-card ${
        hover ? "transition-all duration-300 hover:-translate-y-1 hover:shadow-2xl hover:shadow-black/10" : ""
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  );
});
