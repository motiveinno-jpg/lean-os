#!/usr/bin/env node
/**
 * L 근태 — 가산수당 계산 엔진 sanity 테스트 (12 케이스).
 *   - DB·환경변수 의존성 0. 순수 함수만 검증.
 *   - 실행: node scripts/test-attendance-calc.mjs
 *   - PASS/FAIL 만 출력 → 게이트로 활용.
 *
 * attendance-calc.ts 는 TS 파일이므로 임시 .mjs 빌드 단계 없이는 직접 import 불가.
 * 따라서 같은 로직을 인라인 재구현하지 않고, tsc 컴파일 결과(.next/standalone 등)도
 * 없는 환경에서 단위검증하기 위해 **typescript 컴파일러를 동적 호출**해 ESM 로 로드.
 */

import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join } from 'node:path';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TS_PATH = join(__dirname, '..', 'src', 'lib', 'attendance-calc.ts');

// ── 1) TS → JS 변환 (typescript 패키지 사용) ──
let ts;
try {
  ts = (await import('typescript')).default;
} catch (e) {
  console.error('typescript 패키지를 찾을 수 없습니다. (devDep). npm i 가 끝났는지 확인하세요.');
  process.exit(2);
}

const src = readFileSync(TS_PATH, 'utf8');
const out = ts.transpileModule(src, {
  compilerOptions: {
    module: ts.ModuleKind.ESNext,
    target: ts.ScriptTarget.ES2020,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
  },
});

// 임시 .mjs 로 떨어뜨리고 dynamic import
const outDir = join(tmpdir(), 'ownerview-attcalc');
mkdirSync(outDir, { recursive: true });
const outFile = join(outDir, `attendance-calc-${Date.now()}.mjs`);
writeFileSync(outFile, out.outputText, 'utf8');

const mod = await import(pathToFileURL(outFile).href);
const { calcDailyAttendance, calcOvertimePay } = mod;

// ── 2) 공통 settings ──
const baseSettings = {
  work_start_time: '09:00',
  work_end_time: '18:00',
  lunch_minutes: 60,
  late_grace_minutes: 0,
  night_start_time: '22:00',
  night_end_time: '06:00',
  weekly_work_hours: 40,
  is_under_5_employees: false,
  is_inclusive_wage: false,
  monthly_standard_hours: 209,
  on_duty_pay_per_shift: 50000,
  workdays_mask: 31, // 월~금
};

// '2026-05-20' = 수요일 (KST). 평일 케이스 기본.
const iso = (date, hhmm) => `${date}T${hhmm}:00+09:00`;

// ── 3) 검증 헬퍼 ──
let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; console.log(`  PASS  ${name}`); }
  else { fail++; console.log(`  FAIL  ${name}`); if (detail) console.log('         ', detail); }
}

// ── 4) 12 케이스 ──
console.log('L 근태 — calcDailyAttendance + calcOvertimePay sanity (12 cases)\n');

// 1. 정시 출근
{
  const r = calcDailyAttendance({
    check_in: iso('2026-05-20', '09:00'),
    check_out: iso('2026-05-20', '18:00'),
    date: '2026-05-20',
    settings: baseSettings,
  });
  check('1. 정시 출근 (9:00 → late=false)', r.is_late === false, JSON.stringify(r));
}

// 2. 지각 grace=0
{
  const r = calcDailyAttendance({
    check_in: iso('2026-05-20', '09:30'),
    check_out: iso('2026-05-20', '18:00'),
    date: '2026-05-20',
    settings: baseSettings,
  });
  check('2. 지각 grace=0 (9:30 → late=true, 30분)', r.is_late === true && r.late_minutes === 30, JSON.stringify(r));
}

// 3a. grace=15 + 9:14 → present
{
  const s = { ...baseSettings, late_grace_minutes: 15 };
  const r = calcDailyAttendance({
    check_in: iso('2026-05-20', '09:14'),
    check_out: iso('2026-05-20', '18:00'),
    date: '2026-05-20',
    settings: s,
  });
  check('3a. grace=15, 9:14 → late=false', r.is_late === false, JSON.stringify(r));
}

// 3b. grace=15 + 9:16 → late
{
  const s = { ...baseSettings, late_grace_minutes: 15 };
  const r = calcDailyAttendance({
    check_in: iso('2026-05-20', '09:16'),
    check_out: iso('2026-05-20', '18:00'),
    date: '2026-05-20',
    settings: s,
  });
  check('3b. grace=15, 9:16 → late=true', r.is_late === true && r.late_minutes === 16, JSON.stringify(r));
}

// 4. 평일 정시 8h (9~18, lunch 60) → regular 480, overtime 0
{
  const r = calcDailyAttendance({
    check_in: iso('2026-05-20', '09:00'),
    check_out: iso('2026-05-20', '18:00'),
    date: '2026-05-20',
    settings: baseSettings,
  });
  check('4. 평일 정시 8h → regular=480, overtime=0', r.regular_minutes === 480 && r.overtime_minutes === 0, JSON.stringify(r));
}

// 5. 평일 연장 2h (9~20)
{
  const r = calcDailyAttendance({
    check_in: iso('2026-05-20', '09:00'),
    check_out: iso('2026-05-20', '20:00'),
    date: '2026-05-20',
    settings: baseSettings,
  });
  check('5. 평일 연장 2h → regular=480, overtime=120', r.regular_minutes === 480 && r.overtime_minutes === 120, JSON.stringify(r));
}

// 6. 야간 1h (21~23, lunch 0) → night 60 (22~23 만)
{
  const s = { ...baseSettings, lunch_minutes: 0 };
  const r = calcDailyAttendance({
    check_in: iso('2026-05-20', '21:00'),
    check_out: iso('2026-05-20', '23:00'),
    date: '2026-05-20',
    settings: s,
  });
  check('6. 야간 1h (21~23) → night=60', r.night_minutes === 60, JSON.stringify(r));
}

// 7. 자정 넘김 야간 (22~02 다음날) → night 240
{
  const s = { ...baseSettings, lunch_minutes: 0 };
  const r = calcDailyAttendance({
    check_in: iso('2026-05-20', '22:00'),
    check_out: iso('2026-05-21', '02:00'),
    date: '2026-05-20',
    settings: s,
  });
  check('7. 자정 넘김 야간 (22~02) → night=240', r.night_minutes === 240, JSON.stringify(r));
}

// 8. 휴일 근로 4h (2026-05-23 = 토요일 = workdays_mask 외 = 휴일, lunch 0 가정)
{
  const s = { ...baseSettings, lunch_minutes: 0 };
  const r = calcDailyAttendance({
    check_in: iso('2026-05-23', '10:00'),
    check_out: iso('2026-05-23', '14:00'),
    date: '2026-05-23',
    settings: s,
  });
  check('8. 휴일 근로 4h (lunch 0) → holiday_minutes=240, is_holiday=true',
    r.is_holiday === true && r.holiday_minutes === 240, JSON.stringify(r));
}

// 9. 휴일 10h (8h 초과)
{
  const s = { ...baseSettings, lunch_minutes: 0 };
  const r = calcDailyAttendance({
    check_in: iso('2026-05-23', '08:00'),
    check_out: iso('2026-05-23', '18:00'),
    date: '2026-05-23',
    settings: s,
  });
  check('9a. 휴일 10h → holiday_minutes=600', r.holiday_minutes === 600, JSON.stringify(r));

  // 월간 계산: 시급 10000 (=base 209만/209), 휴일 8h × 1.5 + 2h × 2.0
  const pay = calcOvertimePay({
    daily_records: [r],
    settings: s,
    monthly_base_salary: 2_090_000,
    on_duty_count: 0,
  });
  // 8h(480분) × 10000 × 1.5 / 60 = 120000; 2h(120분) × 10000 × 2.0 / 60 = 40000 → 160000
  check('9b. 휴일 8h 1.5x + 2h 2.0x → holiday_pay=160000', pay.holiday_pay === 160000, JSON.stringify(pay));
}

// 10. 휴가일 → work 0
{
  const r = calcDailyAttendance({
    check_in: iso('2026-05-20', '09:00'),
    check_out: iso('2026-05-20', '18:00'),
    date: '2026-05-20',
    settings: baseSettings,
    on_leave: true,
  });
  check('10. on_leave → 전 분 0', r.regular_minutes === 0 && r.overtime_minutes === 0 && r.work_minutes === 0, JSON.stringify(r));
}

// 11. 5인 미만 → overtime_pay 0
{
  const s = { ...baseSettings, is_under_5_employees: true, lunch_minutes: 60 };
  const day = calcDailyAttendance({
    check_in: iso('2026-05-20', '09:00'),
    check_out: iso('2026-05-20', '21:00'),
    date: '2026-05-20',
    settings: s,
  });
  const pay = calcOvertimePay({
    daily_records: [day],
    settings: s,
    monthly_base_salary: 2_090_000,
    on_duty_count: 2,
  });
  // 5인 미만 → overtime_pay=0, on_duty_pay=2*50000=100000
  check('11. 5인 미만 → overtime_pay=0, on_duty_pay=100000',
    pay.overtime_pay === 0 && pay.on_duty_pay === 100000 && pay.notes.some(n => n.includes('5인 미만')),
    JSON.stringify(pay));
}

// 12. 포괄임금제 → 가산 전부 0 + 메모
{
  const s = { ...baseSettings, is_inclusive_wage: true };
  const day = calcDailyAttendance({
    check_in: iso('2026-05-20', '09:00'),
    check_out: iso('2026-05-20', '21:00'),
    date: '2026-05-20',
    settings: s,
  });
  const pay = calcOvertimePay({
    daily_records: [day],
    settings: s,
    monthly_base_salary: 2_090_000,
    on_duty_count: 0,
  });
  check('12. 포괄임금제 → 전부 0 + 메모',
    pay.overtime_pay === 0 && pay.night_pay === 0 && pay.holiday_pay === 0 &&
    pay.notes.some(n => n.includes('포괄')),
    JSON.stringify(pay));
}

// ── 5) 결과 ──
console.log(`\n=== ${pass} PASS / ${fail} FAIL (총 ${pass + fail}) ===`);
process.exit(fail === 0 ? 0 : 1);
