// L 근태: 가산수당 계산 엔진 (순수 함수, side-effect 0).
//   한국 노동법 기준 — 지각·연장·야간·휴일·5인미만·포괄임금제 분기 처리.
//   DB 의존성 0 → 단위테스트 가능. hr-agent 의 RPC/페이지가 호출.
//
// 절대 규칙:
//   - 모든 시각은 KST(Asia/Seoul) 분(分) 단위로 환산하여 비교. 자정 넘김 안전.
//   - 5인 미만(is_under_5_employees=true) → 가산수당 미적용(통상시급만 반환)
//   - 포괄임금제(is_inclusive_wage=true) → 약정 내 가산 0 + cap_exceeded 메모만
//   - 휴일근로 8h 이내 1.5×, 8h 초과 2.0×
//   - 야간(기본 22:00~06:00, 자정 넘김) 겹친 분만 0.5× 가산 (연장과 중복 시 별도)
//   - 주 12h 연장 cap 초과 시 cap_exceeded:true 플래그(법정 한도 경고)

// ── 입력 타입 ──

export type AttendanceCompanySettings = {
  work_start_time: string;       // 'HH:MM'
  work_end_time: string;         // 'HH:MM'
  lunch_minutes: number;
  late_grace_minutes: number;
  night_start_time: string;      // 'HH:MM' (기본 '22:00')
  night_end_time: string;        // 'HH:MM' (기본 '06:00' = 다음날)
  weekly_work_hours: number;     // 1주 소정 (기본 40)
  is_under_5_employees: boolean;
  is_inclusive_wage: boolean;
  monthly_standard_hours: number;// 통상시급 분모 (기본 209)
  on_duty_pay_per_shift: number; // 당직 1회 단가
  workdays_mask: number;         // 비트마스크 월=1,화=2,수=4,목=8,금=16,토=32,일=64
};

export type DailyInput = {
  check_in: Date | string | null;  // ISO 또는 Date
  check_out: Date | string | null;
  date: string;                     // 'YYYY-MM-DD' (KST)
  settings: AttendanceCompanySettings;
  holidays?: Set<string> | string[]; // 'YYYY-MM-DD' 의 set/array — 휴일 매칭
  on_leave?: boolean;                // 그 날 휴가면 true → work=0
  attendance_type?: 'normal' | 'field_work' | 'on_duty' | 'remote' | 'business_trip';
};

export type DailyResult = {
  is_late: boolean;
  late_minutes: number;
  regular_minutes: number;
  overtime_minutes: number;
  night_minutes: number;
  holiday_minutes: number;
  is_holiday: boolean;
  work_minutes: number;     // 총 근무 (lunch 제외 후)
  attendance_type: NonNullable<DailyInput['attendance_type']>;
};

export type MonthlyPayInput = {
  daily_records: DailyResult[];
  settings: AttendanceCompanySettings;
  monthly_base_salary: number;    // 월 기본급(통상임금)
  on_duty_count?: number;          // 당직 횟수 (별도 입력)
};

export type MonthlyPayResult = {
  hourly_wage: number;            // 통상시급 (0 if inclusive)
  regular_pay: number;            // 통상시급 × regular_minutes (정보용)
  overtime_pay: number;           // 연장 가산
  night_pay: number;              // 야간 가산
  holiday_pay: number;            // 휴일 가산
  on_duty_pay: number;            // 당직
  total_extra_pay: number;        // overtime+night+holiday+on_duty 합
  cap_exceeded: boolean;          // 주 12h 연장 cap 초과
  notes: string[];                // 메모(5인 미만·포괄임금 적용 사유 등)
};

// ── 헬퍼 ──

function parseHhmm(hhmm: string, fallback = 0): number {
  if (typeof hhmm !== 'string' || !/^\d{2}:\d{2}$/.test(hhmm)) return fallback;
  const [h, m] = hhmm.split(':').map(Number);
  if (h < 0 || h > 23 || m < 0 || m > 59) return fallback;
  return h * 60 + m;
}

// KST 분(分) 단위로 환산. Date 또는 ISO 문자열 입력.
//   2026-01-15T09:00:00+09:00 → 9*60 = 540 (해당 일자 분)
//   날짜가 다르면 그 차이까지 분에 누적해 절대 분 반환.
//   기준 date 와 같은 날이면 0~1439, 다음날이면 1440~.
function toKstAbsMinutes(input: Date | string, baseDate: string): number {
  const d = typeof input === 'string' ? new Date(input) : input;
  // KST 의 year/month/day/hour/minute
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Seoul',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(d);
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value ?? '0');
  const y = get('year'), mo = get('month'), da = get('day');
  const h = get('hour'), mi = get('minute');
  // 기준일과의 일자 차이
  const [by, bm, bd] = baseDate.split('-').map(Number);
  // UTC date diff in days (KST 기준 같은 day 이므로 UTC 로 잡아도 OK)
  const baseUtc = Date.UTC(by, bm - 1, bd);
  const thisUtc = Date.UTC(y, mo - 1, da);
  const dayDiff = Math.round((thisUtc - baseUtc) / 86400000);
  return dayDiff * 1440 + h * 60 + mi;
}

// 'YYYY-MM-DD' KST → 요일 (0=일, 1=월, ..., 6=토). UTC 변환 없이 단순 산출.
function dayOfWeekKst(dateStr: string): number {
  const [y, m, d] = dateStr.split('-').map(Number);
  // KST 는 UTC+9 라 자정 0시 KST = 전날 15시 UTC. UTC Date 로 만들고 getUTCDay() 면 KST 와 같은 요일.
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

// 요일 → workdays_mask 비트
//   월=1, 화=2, 수=4, 목=8, 금=16, 토=32, 일=64
const DOW_MASK_BIT: Record<number, number> = { 1: 1, 2: 2, 3: 4, 4: 8, 5: 16, 6: 32, 0: 64 };

function isWorkday(dateStr: string, mask: number): boolean {
  const dow = dayOfWeekKst(dateStr);
  return (mask & DOW_MASK_BIT[dow]) !== 0;
}

// 두 구간의 분 단위 overlap.
function overlapMinutes(a1: number, a2: number, b1: number, b2: number): number {
  return Math.max(0, Math.min(a2, b2) - Math.max(a1, b1));
}

// 야간 구간을 [work 시작 절대분, work 종료 절대분] 안에서 산출.
//   night_start, night_end 가 'HH:MM'. night_end <= night_start 면 자정 넘김 → 두 구간으로 분리.
//   work 가 멀티 day 일 경우 매 day 마다 night 구간 모두 검사.
function calcNightMinutes(
  workStartAbsMin: number,
  workEndAbsMin: number,
  nightStartHhmm: string,
  nightEndHhmm: string,
): number {
  const ns = parseHhmm(nightStartHhmm, 22 * 60); // 22:00
  const ne = parseHhmm(nightEndHhmm, 6 * 60);    // 06:00
  if (workEndAbsMin <= workStartAbsMin) return 0;

  // work 가 걸치는 day 범위
  const startDay = Math.floor(workStartAbsMin / 1440);
  const endDay = Math.floor((workEndAbsMin - 1) / 1440);

  let total = 0;
  for (let day = startDay; day <= endDay; day++) {
    const dayBase = day * 1440;
    if (ne > ns) {
      // 자정 안 넘김 (예: 23:00~01:00 같은 비정상 케이스 제외하고 일반적인 09:00~18:00 야간은 거의 없음)
      total += overlapMinutes(workStartAbsMin, workEndAbsMin, dayBase + ns, dayBase + ne);
    } else {
      // 자정 넘김 — 두 구간: [ns, 1440), [0, ne) — ne 는 다음 day 새벽
      total += overlapMinutes(workStartAbsMin, workEndAbsMin, dayBase + ns, dayBase + 1440);
      total += overlapMinutes(workStartAbsMin, workEndAbsMin, dayBase + 1440, dayBase + 1440 + ne);
    }
  }
  return total;
}

// ── 핵심 함수 ──

/**
 * 1일 근태 계산.
 *   - on_leave=true 면 work=0, 휴일 여부만 표시
 *   - holidays 매칭 또는 workdays_mask 외 요일 → is_holiday=true
 *   - 평일 연장: max(0, work - lunch - 8*60)
 *   - 휴일 근로: 전체가 holiday_minutes (가중치는 월간 계산 단계에서)
 *   - 야간: work 구간이 night 구간과 겹친 분
 *   - 지각: check_in 이 (work_start + grace) 이후
 */
export function calcDailyAttendance(input: DailyInput): DailyResult {
  const { date, settings, on_leave } = input;
  const holidaySet = input.holidays instanceof Set
    ? input.holidays
    : new Set(input.holidays || []);

  const is_holiday = holidaySet.has(date) || !isWorkday(date, settings.workdays_mask);
  const type = input.attendance_type || 'normal';

  // 휴가일이면 전부 0
  if (on_leave) {
    return {
      is_late: false, late_minutes: 0,
      regular_minutes: 0, overtime_minutes: 0,
      night_minutes: 0, holiday_minutes: 0,
      is_holiday, work_minutes: 0,
      attendance_type: type,
    };
  }

  if (!input.check_in || !input.check_out) {
    // 출근 없으면 결근, 퇴근 없으면 미완(계산 안 함)
    return {
      is_late: false, late_minutes: 0,
      regular_minutes: 0, overtime_minutes: 0,
      night_minutes: 0, holiday_minutes: 0,
      is_holiday, work_minutes: 0,
      attendance_type: type,
    };
  }

  const ciMin = toKstAbsMinutes(input.check_in, date);
  const coMin = toKstAbsMinutes(input.check_out, date);
  const workStartTarget = parseHhmm(settings.work_start_time, 9 * 60);
  const lateThreshold = workStartTarget + Math.max(0, settings.late_grace_minutes || 0);

  // 지각 판정 — 같은 날 출근만 (다음날 출근이면 비정상)
  const ciDayMin = ciMin - Math.floor(ciMin / 1440) * 1440;
  const is_late = !is_holiday && ciDayMin > lateThreshold;
  const late_minutes = is_late ? ciDayMin - workStartTarget : 0;

  // 총 근무(분) = check_out - check_in - lunch
  const grossMin = Math.max(0, coMin - ciMin);
  const lunch = Math.max(0, settings.lunch_minutes || 0);
  // 점심은 work_minutes >= lunch 일 때만 차감 (반차 등 짧은 근무 시 음수 방지)
  const work_minutes = grossMin > lunch ? grossMin - lunch : grossMin;

  // 야간 (work 구간 안에서 야간시간대와 겹친 분)
  const night_minutes = calcNightMinutes(ciMin, coMin, settings.night_start_time, settings.night_end_time);

  let regular_minutes = 0;
  let overtime_minutes = 0;
  let holiday_minutes = 0;

  if (is_holiday) {
    // 휴일 근로 — 전부 holiday_minutes 로 분류 (가중치는 월간 계산에서)
    holiday_minutes = work_minutes;
  } else {
    // 평일 — 8h(=480분) 까지 정규, 초과 = 연장
    const SOJEONG = 8 * 60;
    if (work_minutes <= SOJEONG) {
      regular_minutes = work_minutes;
    } else {
      regular_minutes = SOJEONG;
      overtime_minutes = work_minutes - SOJEONG;
    }
  }

  return {
    is_late, late_minutes,
    regular_minutes, overtime_minutes,
    night_minutes, holiday_minutes,
    is_holiday, work_minutes,
    attendance_type: type,
  };
}

/**
 * 월간 가산수당 계산.
 *   - hourly = monthly_base_salary / monthly_standard_hours (정수원 단위 반올림)
 *   - 5인 미만: 가산 0 (통상 regular_pay 만)
 *   - 포괄임금제: 가산 0 + 메모 (cap 초과 시 그것도 메모)
 *   - 연장: overtime × 1.5 × hourly
 *   - 야간: night × 0.5 × hourly (연장과 중첩이어도 0.5 추가만)
 *   - 휴일: holiday 8h 이내 1.5×, 8h 초과분 2.0×
 *   - 당직: count × on_duty_pay_per_shift
 *   - 주 12h 연장 cap 초과 시 cap_exceeded=true (법정 한도)
 */
export function calcOvertimePay(input: MonthlyPayInput): MonthlyPayResult {
  const { daily_records, settings, monthly_base_salary } = input;
  const onDutyCount = Math.max(0, input.on_duty_count || 0);
  const notes: string[] = [];

  // 합산
  let regMin = 0, otMin = 0, ntMin = 0;
  let holDayMin8 = 0, holDayMinOver = 0;
  for (const d of daily_records) {
    regMin += d.regular_minutes;
    otMin += d.overtime_minutes;
    ntMin += d.night_minutes;
    if (d.is_holiday) {
      const cap = 8 * 60;
      if (d.holiday_minutes <= cap) holDayMin8 += d.holiday_minutes;
      else {
        holDayMin8 += cap;
        holDayMinOver += d.holiday_minutes - cap;
      }
    }
  }

  // 주 12h 연장 cap — 월간 연장 합계 / 4.345주 ≈ 주 평균
  const weeklyOtAvg = otMin / (60 * 4.345);
  const cap_exceeded = weeklyOtAvg > 12;
  if (cap_exceeded) notes.push(`주 평균 연장 ${weeklyOtAvg.toFixed(1)}h — 법정 12h 한도 초과 (관리자 확인 필요)`);

  // 통상시급
  const stdHours = Math.max(1, settings.monthly_standard_hours || 209);
  const hourly_wage = Math.round(monthly_base_salary / stdHours);

  // 5인 미만 / 포괄임금제 분기
  if (settings.is_under_5_employees) {
    notes.push('5인 미만 사업장 — 법정 가산수당 미적용 (통상시급만 표시)');
    return {
      hourly_wage,
      regular_pay: Math.round(regMin * hourly_wage / 60),
      overtime_pay: 0, night_pay: 0, holiday_pay: 0,
      on_duty_pay: onDutyCount * (settings.on_duty_pay_per_shift || 0),
      total_extra_pay: onDutyCount * (settings.on_duty_pay_per_shift || 0),
      cap_exceeded, notes,
    };
  }
  if (settings.is_inclusive_wage) {
    notes.push('포괄임금제 — 약정 범위 내 별도 가산 미지급 (cap 초과 시 별도 협의)');
    return {
      hourly_wage: 0,
      regular_pay: 0, overtime_pay: 0, night_pay: 0, holiday_pay: 0,
      on_duty_pay: onDutyCount * (settings.on_duty_pay_per_shift || 0),
      total_extra_pay: onDutyCount * (settings.on_duty_pay_per_shift || 0),
      cap_exceeded, notes,
    };
  }

  // 정상 분기 — 법정 가산
  const regular_pay = Math.round(regMin * hourly_wage / 60);
  const overtime_pay = Math.round(otMin * hourly_wage * 1.5 / 60);
  const night_pay = Math.round(ntMin * hourly_wage * 0.5 / 60);
  // 휴일: 8h 이내 1.5×, 8h 초과 2.0×
  const holiday_pay = Math.round(
    (holDayMin8 * hourly_wage * 1.5 / 60) + (holDayMinOver * hourly_wage * 2.0 / 60)
  );
  const on_duty_pay = onDutyCount * (settings.on_duty_pay_per_shift || 0);

  return {
    hourly_wage,
    regular_pay,
    overtime_pay,
    night_pay,
    holiday_pay,
    on_duty_pay,
    total_extra_pay: overtime_pay + night_pay + holiday_pay + on_duty_pay,
    cap_exceeded,
    notes,
  };
}

// ── 내부 헬퍼 export (단위테스트용) ──
export const __internal = { parseHhmm, dayOfWeekKst, isWorkday, calcNightMinutes, toKstAbsMinutes };
