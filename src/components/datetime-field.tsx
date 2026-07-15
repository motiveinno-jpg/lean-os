"use client";

// 날짜+시간 선택 — 네이티브 <input type="datetime-local"> 드롭인 대체.
//   날짜는 예쁜 커스텀 달력(DateField), 시간은 작은 time 입력으로 분리.
//   value/onChange 는 datetime-local 호환("YYYY-MM-DDTHH:MM"), onChange 는 { target: { value } }.
import { DateField } from "./date-field";

type ChangeLike = { target: { value: string } };

export function DateTimeField({
  value, onChange, min, max, className = "", disabled, placeholder,
}: {
  value?: string | null;
  onChange?: (e: ChangeLike) => void;
  min?: string; max?: string;
  className?: string; disabled?: boolean; placeholder?: string;
}) {
  void placeholder;
  const v = value || "";
  const datePart = v.slice(0, 10);
  const timePart = v.length >= 16 ? v.slice(11, 16) : "";

  const emit = (d: string, t: string) => {
    onChange?.({ target: { value: d ? `${d}T${t || "00:00"}` : "" } });
  };

  return (
    <div className="datetime-field flex items-center gap-2">
      <DateField
        value={datePart}
        onChange={(e) => emit(e.target.value, timePart)}
        min={min?.slice(0, 10)}
        max={max?.slice(0, 10)}
        disabled={disabled}
        className={`flex-1 ${className}`}
      />
      <input
        type="time"
        value={timePart}
        disabled={disabled}
        onChange={(e) => emit(datePart, e.target.value)}
        className="shrink-0 px-2.5 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs text-[var(--text)] focus:outline-none focus:border-[var(--primary)]"
      />
    </div>
  );
}
