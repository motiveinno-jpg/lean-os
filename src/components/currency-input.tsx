"use client";

import { forwardRef } from "react";

interface CurrencyInputProps {
  /** 숫자값 (string 이든 number 든 내부에서 digits-only 로 정규화) */
  value: string | number | null | undefined;
  /** 사용자가 입력하면 digits-only 문자열로 콜백 (예: "100000") */
  onValueChange: (raw: string) => void;
  placeholder?: string;
  className?: string;
  disabled?: boolean;
  /** 음수 허용 (기본 false) */
  allowNegative?: boolean;
  onBlur?: () => void;
  /** input id (label htmlFor 연결용) */
  id?: string;
}

/**
 * 회계 형식 금액 입력 — 화면엔 1,000,000 처럼 천단위 콤마,
 * onValueChange 로는 콤마 없는 숫자 문자열만 전달.
 */
export const CurrencyInput = forwardRef<HTMLInputElement, CurrencyInputProps>(
  function CurrencyInput(
    { value, onValueChange, placeholder, className, disabled, allowNegative, onBlur, id },
    ref,
  ) {
    const raw = String(value ?? "");
    const neg = allowNegative && raw.trim().startsWith("-");
    const digits = raw.replace(/[^0-9]/g, "");
    const display = digits
      ? (neg ? "-" : "") + Number(digits).toLocaleString("ko-KR")
      : "";

    return (
      <input
        ref={ref}
        id={id}
        type="text"
        inputMode="numeric"
        value={display}
        disabled={disabled}
        placeholder={placeholder}
        onChange={(e) => {
          const v = e.target.value;
          const isNeg = allowNegative && v.trim().startsWith("-");
          const d = v.replace(/[^0-9]/g, "");
          onValueChange(isNeg && d ? "-" + d : d);
        }}
        onBlur={onBlur}
        className={className}
      />
    );
  },
);
