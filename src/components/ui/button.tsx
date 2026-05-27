"use client";

// 공통 Button — 사이트 전반 버튼 크기/패딩/radius 통일 (2026-05-27 UI 정합성 1라운드).
//   기존 혼재(rounded-lg/xl · py-2/2.5 · text-sm/xs)를 variant·size 로 표준화.
//   색은 디자인 토큰(var(--primary) 등) 유지. 적용은 화면별 점진 — 기존 className 도 className prop 으로 덮어쓰기 가능.
//
// 사용: <Button variant="primary" size="md">저장</Button>
//       <Button variant="secondary" size="sm" onClick={...}>취소</Button>

import { ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white",
  secondary: "bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text)] border border-[var(--border)]",
  ghost: "bg-transparent hover:bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]",
  danger: "bg-red-500 hover:bg-red-600 text-white",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "px-3 py-1.5 text-xs",
  md: "px-4 py-2 text-sm",
  lg: "px-5 py-2.5 text-base",
};

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = "primary", size = "md", className = "", type = "button", ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-semibold transition disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`}
      {...props}
    />
  );
});
