#!/usr/bin/env npx tsx
/**
 * LeanOS Monthly Pipeline Runner
 * 수동 실행: npx tsx scripts/run-monthly.ts
 *
 * 실행 내용:
 * 1. 급여 배치 생성 (draft)
 * 2. 고정비 배치 생성 (draft)
 * 3. 은행 거래 자동분류
 * 4. 3-Way 매칭 (계약 <-> 세금계산서 <-> 입금)
 * 5. VAT 미리보기
 * 6. automation_runs 이력 기록
 */

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || 'https://njbvdkuvtdtkxyylwngn.supabase.co';
const COMPANY_ID = process.env.COMPANY_ID || 'c361afb9-8a52-4cac-add9-8992f0f7c09c';

async function main() {
  console.log('='.repeat(60));
  console.log('  LeanOS Monthly Pipeline');
  console.log(`  ${new Date().toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' })}`);
  console.log('='.repeat(60));
  console.log();

  const efUrl = `${SUPABASE_URL}/functions/v1/generate-monthly-batches`;

  console.log(`[1/2] generate-monthly-batches EF 호출 중...`);
  console.log(`  URL: ${efUrl}`);
  console.log(`  Company: ${COMPANY_ID}`);
  console.log();

  try {
    const response = await fetch(efUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': COMPANY_ID,
      },
      body: JSON.stringify({ source: 'manual' }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[ERROR] HTTP ${response.status}: ${errorText}`);
      process.exit(1);
    }

    const result = await response.json();

    if (!result.success) {
      console.error(`[ERROR] ${result.error || 'Unknown error'}`);
      process.exit(1);
    }

    // Payroll result
    console.log('[Payroll - 급여 배치]');
    if (result.payroll) {
      console.log(`  Batch ID: ${result.payroll.batchId}`);
      console.log(`  직원 수: ${result.payroll.employeeCount}명`);
      console.log(`  총 지급액: ${result.payroll.totalAmount.toLocaleString()}원`);
      if (result.payroll.items) {
        for (const item of result.payroll.items) {
          console.log(`    - ${item.name}: 기본급 ${item.baseSalary.toLocaleString()} -> 실수령 ${item.netPay.toLocaleString()}`);
        }
      }
    } else {
      console.log('  (활성 직원 없음 또는 급여 미설정)');
    }
    console.log();

    // Fixed cost result
    console.log('[Fixed Cost - 고정비 배치]');
    if (result.fixedCost) {
      console.log(`  Batch ID: ${result.fixedCost.batchId}`);
      console.log(`  항목 수: ${result.fixedCost.count}건`);
      console.log(`  총 금액: ${result.fixedCost.totalAmount.toLocaleString()}원`);
    } else {
      console.log('  (활성 반복결제 없음)');
    }
    console.log();

    // Automation result
    console.log('[Automation - 은행 거래 자동분류]');
    if (result.automation) {
      console.log(`  미분류 거래: ${result.automation.unmapped}건`);
      console.log(`  자동분류 완료: ${result.automation.autoClassified}건`);
    } else {
      console.log('  (미분류 거래 없음)');
    }
    console.log();

    // Matching result
    console.log('[Matching - 3-Way 매칭]');
    if (result.matching) {
      console.log(`  대상 세금계산서: ${result.matching.total}건`);
      console.log(`  자동매칭 완료: ${result.matching.autoMatched}건`);
    } else {
      console.log('  (매칭 대상 없음)');
    }
    console.log();

    // VAT preview
    console.log('[VAT Preview - 부가세 미리보기]');
    if (result.vat && result.vat.length > 0) {
      for (const v of result.vat) {
        const sign = v.netVAT >= 0 ? '납부' : '환급';
        console.log(`  ${v.quarter}: 매출세액 ${v.salesTax.toLocaleString()} - 매입세액 ${v.purchaseTax.toLocaleString()} = ${sign} ${Math.abs(v.netVAT).toLocaleString()}원`);
      }
    } else {
      console.log('  (세금계산서 데이터 없음)');
    }
    console.log();

    // Errors
    if (result.errors && result.errors.length > 0) {
      console.log('[Warnings]');
      for (const err of result.errors) {
        console.log(`  ! ${err}`);
      }
      console.log();
    }

    // Run ID
    console.log(`Run ID: ${result.run_id || 'N/A'}`);
    console.log();
    console.log('='.repeat(60));
    console.log('  STATUS: 배치 생성 완료 (draft)');
    console.log('  NEXT: 대표 승인 대기 중');
    console.log('  -> LeanOS 대시보드 > 승인센터에서 배치 승인');
    console.log('='.repeat(60));

  } catch (err: any) {
    console.error(`[FATAL] ${err.message}`);
    process.exit(1);
  }
}

main();
