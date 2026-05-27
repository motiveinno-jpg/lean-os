"use client";

// 공통 Button — 2026-05-27 새 디자인 시스템(시안 기반).
//   variant: primary(인디고 그라데이션+shadow) · secondary(화이트+보더) · outline · ghost · danger
//   size: sm(h-36px) · md(h-40px) · lg(h-48px). rounded-lg. 색은 토큰(var(--brand) 등).
//   className 으로 개별 덮어쓰기 가능.

import { ButtonHTMLAttributes, forwardRef } from "react";

type ButtonVariant = "primary" | "secondary" | "outline" | "ghost" | "danger";
type ButtonSize = "sm" | "md" | "lg";

const VARIANT_CLASS: Record<ButtonVariant, string> = {
  primary: "bg-gradient-to-r from-[var(--brand)] to-[var(--brand-to)] text-white hover:shadow-lg hover:shadow-[var(--brand)]/30",
  secondary: "bg-[var(--bg-card)] text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)] hover:shadow-md",
  outline: "bg-transparent text-[var(--brand)] border border-[var(--brand)] hover:bg-[var(--brand)]/10",
  ghost: "bg-transparent text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)]",
  danger: "bg-[var(--danger)] text-white hover:opacity-90",
};

const SIZE_CLASS: Record<ButtonSize, string> = {
  sm: "h-9 px-4 text-[13px]",
  md: "h-10 px-6 text-sm",
  lg: "h-12 px-8 text-base",
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
      className={`inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-all disabled:opacity-50 disabled:cursor-not-allowed ${VARIANT_CLASS[variant]} ${SIZE_CLASS[size]} ${className}`}
      {...props}
    />
  );
});
