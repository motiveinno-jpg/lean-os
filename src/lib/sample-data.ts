/**
 * Sample Data Generator v1
 * 개발/UX 확인용 데모 데이터 생성
 *
 * 최소 세트:
 * - 딜 5개(분할수금 포함)
 * - 외주 8개(지급조건 포함)
 * - 거래내역 30건(입금/지출)
 * - 미수금 2건(30일 이상)
 * → Risk/Margin/Cashflow가 바로 살아남
 */
import { supabase } from './supabase';

const now = new Date();
const thisMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
const lastMonth = (() => {
  const d = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
})();

function daysAgo(n: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() - n);
  return d.toISOString().split('T')[0];
}
function daysFromNow(n: number): string {
  const d = new Date(now);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

export async function generateSampleData(companyId: string): Promise<{ success: boolean; message: string }> {
  // Production safety guard
  if (typeof window !== 'undefined' && window.location.hostname !== 'localhost' && window.location.hostname !== '127.0.0.1') {
    const confirmed = window.confirm('샘플 데이터를 생성하시겠습니까? 기존 샘플 데이터는 삭제됩니다.');
    if (!confirmed) return { success: false, message: '사용자가 취소했습니다' };
  }
  try {
    // Clear existing sample data
    await supabase.from('monthly_financials').delete().eq('company_id', companyId).eq('source', 'sample');
    await supabase.from('financial_items').delete().eq('company_id', companyId).eq('source', 'sample');

    // ═══ Monthly Financial Summary ═══
    const monthlyData = [
      { month: thisMonth, bank_balance: 51000000, total_income: 36700000, total_expense: 97000000, fixed_cost: 73600000, variable_cost: 23400000, net_cashflow: -60300000, revenue: 9900000 },
      { month: lastMonth, bank_balance: 85000000, total_income: 92200000, total_expense: 107700000, fixed_cost: 83000000, variable_cost: 24700000, net_cashflow: -15500000, revenue: 47100000 },
    ];

    for (const m of monthlyData) {
      await supabase.from('monthly_financials').upsert({
        company_id: companyId,
        ...m,
        source: 'sample',
      }, { onConflict: 'company_id,month' });
    }

    // ═══ Financial Items ═══
    const items = [
      // 미수금 (2건 30일 이상)
      { category: 'receivable', name: '두루두루몰 외상매출 잔금', amount: 2276697, due_date: daysAgo(45), status: 'overdue', project_name: '두루두루몰', risk_label: 'AR_OVER_30' },
      { category: 'receivable', name: '팩트시트 잔금 50%', amount: 5500000, due_date: daysAgo(35), status: 'overdue', project_name: '팩트시트', risk_label: 'AR_OVER_30' },
      { category: 'receivable', name: '청년일자리도약 장려금 2차', amount: 1800000, due_date: daysFromNow(10), status: 'pending', project_name: null },
      { category: 'receivable', name: '홍보지원 2월분 인건비 지원', amount: 21000000, due_date: daysFromNow(15), status: 'pending', project_name: '홍보지원사업' },

      // 승인대기 비용(payable)
      { category: 'payable', name: '팩트시트 해외광고비 선충전', amount: 13200000, due_date: daysFromNow(3), status: 'pending', project_name: '팩트시트' },
      { category: 'payable', name: '독도엔진 유튜버 촬영비', amount: 3740000, due_date: daysFromNow(7), status: 'pending', project_name: '제조혁신바우처' },
      { category: 'payable', name: 'Office365 연간갱신', amount: 3458840, due_date: daysFromNow(5), status: 'pending', project_name: null },

      // 고정비
      { category: 'fixed_cost', name: '직원급여(2월)', amount: 45000000, due_date: daysFromNow(0), status: 'confirmed', account_type: '급여' },
      { category: 'fixed_cost', name: '스파크플러스 사무실 임대', amount: 5566000, due_date: null, status: 'confirmed', account_type: '임차료' },
      { category: 'fixed_cost', name: '4대보험', amount: 6398830, due_date: null, status: 'confirmed', account_type: '예수금' },
      { category: 'fixed_cost', name: '원천세', amount: 3217150, due_date: null, status: 'confirmed', account_type: '예수금' },
      { category: 'fixed_cost', name: 'IBK 대출이자', amount: 1269125, due_date: null, status: 'confirmed', account_type: '이자비용' },
      { category: 'fixed_cost', name: '기타중소 원금+이자', amount: 3751053, due_date: null, status: 'confirmed', account_type: '이자비용' },
      { category: 'fixed_cost', name: '차량렌탈+캡스+세무사+통신', amount: 1483900, due_date: null, status: 'confirmed', account_type: '지급임차료' },
      { category: 'fixed_cost', name: '법인카드 납부', amount: 2385434, due_date: null, status: 'confirmed', account_type: '미지급금' },

      // 변동비(외주 expense)
      { category: 'expense', name: '그릭데이 네이버광고 집행', amount: 25000000, due_date: daysFromNow(10), status: 'pending', project_name: '그릭데이', account_type: '광고선전비' },
      { category: 'expense', name: '팩트시트 디자인 용역 잔금', amount: 4500000, due_date: daysFromNow(15), status: 'pending', project_name: '팩트시트', account_type: '제작비' },
      { category: 'expense', name: '휘슬AI 개발 서버비', amount: 850000, due_date: daysFromNow(0), status: 'confirmed', project_name: '휘슬AI', account_type: '지급수수료' },
    ];

    for (const item of items) {
      await supabase.from('financial_items').insert({
        company_id: companyId,
        month: thisMonth,
        source: 'sample',
        ...item,
      });
    }

    // ═══ Update cash_snapshot ═══
    await supabase.from('cash_snapshot').upsert({
      company_id: companyId,
      current_balance: 51000000,
      monthly_fixed_cost: 73600000,
    }, { onConflict: 'company_id' });

    // ═══ Growth targets ═══
    await supabase.from('growth_targets').upsert({
      company_id: companyId,
      period: thisMonth,
      target_revenue: 50000000,
    }, { onConflict: 'company_id,period' });

    const quarter = `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`;
    await supabase.from('growth_targets').upsert({
      company_id: companyId,
      period: quarter,
      target_revenue: 150000000,
    }, { onConflict: 'company_id,period' });

    await supabase.from('growth_targets').upsert({
      company_id: companyId,
      period: String(now.getFullYear()),
      target_revenue: 500000000,
    }, { onConflict: 'company_id,period' });

    return { success: true, message: `샘플 데이터 생성 완료: ${monthlyData.length}개월, ${items.length}개 항목` };
  } catch (err: any) {
    return { success: false, message: `샘플 생성 실패: ${err.message}` };
  }
}
