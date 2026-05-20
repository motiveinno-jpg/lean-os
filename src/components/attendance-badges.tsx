"use client";

// 갭①-B: 근태 배지 컴포넌트 — 관리자 AttendanceTab(b4494292) 의 배지 매핑을
//   직원 본인 뷰(/attendance, MyAttendanceCard) 와 공통화.
//   인풋: attendance_records 1행 (L 라운드 신규 분 컬럼 포함).
//   출력: 🔴지각·🟠연장·🟣야간·🟢휴일·⚫외근/당직/원격/출장 배지 묶음.
//   색약 친화: 라벨 텍스트 병기 ("지각 N분"·"연장 Nh Nm"·"야간"·"휴일 근무").

import type { ReactNode } from "react";

export type AttendanceRecordBadgeInput = {
  is_late?: boolean | null;
  late_minutes?: number | null;
  overtime_minutes?: number | null;
  overtime_hours?: number | null;
  night_minutes?: number | null;
  holiday_minutes?: number | null;
  attendance_type?: string | null;
  status?: string | null;
};

function fmtHM(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h > 0 && m > 0) return `${h}h ${m}m`;
  if (h > 0) return `${h}h`;
  return `${m}m`;
}

const TYPE_LABEL: Record<string, { label: string; emoji: string }> = {
  field_work:    { label: "외근", emoji: "🚗" },
  on_duty:       { label: "당직", emoji: "🌙" },
  remote:        { label: "원격", emoji: "🏠" },
  business_trip: { label: "출장", emoji: "✈️" },
};

/**
 * 모든 배지를 한 줄에 flex-wrap 으로 렌더. compact 옵션으로 패딩 축소(모바일).
 * 부모가 컨테이너(flex)를 제공해도 무방 — 본 컴포넌트는 `<>` Fragment 출력.
 */
export function AttendanceBadges({
  record,
  compact,
}: {
  record: AttendanceRecordBadgeInput;
  compact?: boolean;
}): ReactNode {
  const pad = compact ? "px-1 py-0.5 text-[10px]" : "px-2 py-0.5 text-xs";

  const lateMin = Number(record.late_minutes || 0);
  const otMin = Number(record.overtime_minutes || 0);
  const otHoursLegacy = Number(record.overtime_hours || 0);
  const nightMin = Number(record.night_minutes || 0);
  const holidayMin = Number(record.holiday_minutes || 0);
  const type = record.attendance_type && record.attendance_type !== "normal" ? record.attendance_type : null;
  const typeMeta = type ? TYPE_LABEL[type] : null;

  // 어느 것도 표시할 게 없으면 빈 Fragment
  const showLate = !!record.is_late && lateMin > 0;
  const showOt = otMin > 0;
  const showOtLegacy = !showOt && otHoursLegacy > 0;
  const showNight = nightMin > 0;
  const showHoliday = holidayMin > 0;
  const showType = !!typeMeta;

  if (!showLate && !showOt && !showOtLegacy && !showNight && !showHoliday && !showType) {
    return null;
  }

  return (
    <>
      {showLate && (
        <span
          className={`inline-flex items-center gap-1 rounded font-semibold bg-red-500/10 text-red-400 ${pad}`}
          title={`지각 ${lateMin}분`}
        >
          🔴 지각 {lateMin}분
        </span>
      )}
      {showOt && (
        <span
          className={`inline-flex items-center gap-1 rounded font-semibold bg-orange-500/10 text-orange-400 ${pad}`}
          title={`연장근로 ${otMin}분 (가산 1.5)`}
        >
          🟠 연장 {fmtHM(otMin)}
        </span>
      )}
      {showOtLegacy && (
        <span
          className={`inline-flex items-center gap-1 rounded font-semibold bg-orange-500/10 text-orange-400 ${pad}`}
          title="연장근로 (시간)"
        >
          🟠 연장 +{otHoursLegacy.toFixed(1)}h
        </span>
      )}
      {showNight && (
        <span
          className={`inline-flex items-center gap-1 rounded font-semibold bg-purple-500/10 text-purple-400 ${pad}`}
          title={`야간근로 ${nightMin}분 (가산 0.5)`}
        >
          🟣 야간 {fmtHM(nightMin)}
        </span>
      )}
      {showHoliday && (
        <span
          className={`inline-flex items-center gap-1 rounded font-semibold bg-emerald-500/10 text-emerald-400 ${pad}`}
          title={`휴일 근무 ${holidayMin}분 (가산 1.5x~2.0x)`}
        >
          🟢 휴일 {fmtHM(holidayMin)}
        </span>
      )}
      {typeMeta && (
        <span
          className={`inline-flex items-center gap-1 rounded font-semibold bg-sky-500/10 text-sky-400 ${pad}`}
          title={`근무 형태: ${typeMeta.label}`}
        >
          {typeMeta.emoji} {typeMeta.label}
        </span>
      )}
    </>
  );
}

/** 일일 분 합산 텍스트 (월간 요약 카드용). 빈값/0 은 표시 안 함. */
export function summarizeMonthlyMinutes(records: AttendanceRecordBadgeInput[]): {
  overtime: number;
  night: number;
  holiday: number;
  lateCount: number;
} {
  let overtime = 0, night = 0, holiday = 0, lateCount = 0;
  for (const r of records) {
    overtime += Number(r.overtime_minutes || 0);
    night += Number(r.night_minutes || 0);
    holiday += Number(r.holiday_minutes || 0);
    if (r.is_late && Number(r.late_minutes || 0) > 0) lateCount += 1;
  }
  return { overtime, night, holiday, lateCount };
}

export { fmtHM };
