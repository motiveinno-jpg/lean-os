import { logRead } from "@/lib/log-read";
import { logError } from '@/lib/error-logger';
/**
 * OwnerView Cash Receipt Management
 * 현금영수증 관리 — 매출(발행) / 매입(수취) CRUD + 집계
 */

import { supabase } from './supabase';

const db = supabase;

export interface CashReceipt {
  id: string;
  company_id: string;
  type: 'income' | 'expense';
  amount: number;
  supply_amount: number | null;
  tax_amount: number | null;
  counterparty_name: string | null;
  counterparty_bizno: string | null;
  issue_date: string;
  approval_number: string | null;
  identity_number: string | null;
  identity_type: 'phone' | 'bizno' | 'card' | null;
  purpose: 'expenditure_proof' | 'income_deduction' | null;
  status: 'issued' | 'cancelled' | 'void';
  source: 'manual' | 'hometax_sync' | 'pos' | 'codef';
  deal_id: string | null;
  memo: string | null;
  created_at: string;
  document_key?: string | null;   // 팝빌 발행 문서번호 (CODEF 실발행 건)
  nts_state_code?: string | null; // 300 발행완료 / 301~303 전송전 / 304 전송완료 / 305 전송실패 / 400 취소
}

export const PURPOSE_LABELS: Record<string, string> = {
  expenditure_proof: '지출증빙',
  income_deduction: '소득공제',
};

export const STATUS_LABELS: Record<string, { label: string; bg: string; text: string }> = {
  issued: { label: '발행', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  cancelled: { label: '취소', bg: 'bg-orange-500/10', text: 'text-orange-400' },
  void: { label: '무효', bg: 'bg-red-500/10', text: 'text-red-400' },
};

/**
 * 현금영수증 한 건이 **합계에 얼마로 들어가는가** — +1 / -1(취소거래) / 0(안 셈). (2026-08-12)
 *
 *   ★ `status='cancelled'` 은 뜻이 두 가지다. 이걸 안 가르면 매출이 틀린다.
 *     ① **홈택스가 준 취소거래 행**(source='hometax_sync') — 원본 발행 건은 그대로 남아 있고
 *        이 행이 그것을 깎는 **마이너스 매출**이다. 승인번호도 원본과 다른 별개 건이다.
 *        (실제: 07-24 승인 +11,111 · 07-29 승인 +11,111 · 08-03 취소 · 08-04 취소 → 홈택스 총매출 0원)
 *        **빼 버리면 승인 2건만 남아 매출이 22,222원으로 부풀어 오른다** — 그래서 빼지 않고 음수로 센다.
 *     ② **우리가 발행했다가 취소한 원본 행**(manual·codef) — 없던 일이 된 것이라 0으로 안 센다.
 *        (이 건도 홈택스를 수집하면 ①의 취소거래 행이 따로 들어와 상계된다)
 *   `void`(무효)는 애초에 없던 것이라 언제나 0.
 *
 *   위하고도 취소거래를 같은 유형(현과)의 **마이너스 전표**로 보여 준다 — 사장님이 준 기준.
 */
export function cashReceiptSign(r: { status?: string | null; source?: string | null }): 1 | -1 | 0 {
  const status = String(r.status || 'issued');
  if (status === 'void') return 0;
  if (status !== 'cancelled') return 1;
  return r.source === 'hometax_sync' ? -1 : 0;
}

const VAT_RATE = 0.1;

// ── CRUD ──

export async function getCashReceipts(companyId: string, params?: {
  type?: 'income' | 'expense';
  startDate?: string;
  endDate?: string;
  status?: string;
}) {
  let query = db.from('cash_receipts')
    .select('*')
    .eq('company_id', companyId)
    .order('issue_date', { ascending: false });

  if (params?.type) query = query.eq('type', params.type);
  if (params?.startDate) query = query.gte('issue_date', params.startDate);
  if (params?.endDate) query = query.lte('issue_date', params.endDate);
  if (params?.status) query = query.eq('status', params.status);

  const { data, error } = await query;
  if (error) throw error;
  return (data || []) as CashReceipt[];
}

export async function createCashReceipt(params: {
  companyId: string;
  type: 'income' | 'expense';
  amount: number;
  counterpartyName?: string;
  counterpartyBizno?: string;
  issueDate: string;
  approvalNumber?: string;
  identityNumber?: string;
  identityType?: 'phone' | 'bizno' | 'card';
  purpose?: 'expenditure_proof' | 'income_deduction';
  dealId?: string;
  memo?: string;
}) {
  const supplyAmount = Math.round(params.amount / (1 + VAT_RATE));
  const taxAmount = params.amount - supplyAmount;

  const { data, error } = await db.from('cash_receipts').insert({
    company_id: params.companyId,
    type: params.type,
    amount: params.amount,
    supply_amount: supplyAmount,
    tax_amount: taxAmount,
    counterparty_name: params.counterpartyName || null,
    counterparty_bizno: params.counterpartyBizno || null,
    issue_date: params.issueDate,
    approval_number: params.approvalNumber || null,
    identity_number: params.identityNumber || null,
    identity_type: params.identityType || null,
    purpose: params.purpose || (params.type === 'expense' ? 'expenditure_proof' : null),
    deal_id: params.dealId || null,
    memo: params.memo || null,
    source: 'manual',
    status: 'issued',
  }).select().single();

  if (error) throw error;
  return data as CashReceipt;
}

export async function cancelCashReceipt(receiptId: string) {
  const { error } = await db.from('cash_receipts')
    .update({ status: 'cancelled' })
    .eq('id', receiptId);
  if (error) throw error;
}

// ── 국세청 실발행 (CODEF ↔ 팝빌) — cashbill-issue 엣지 ──

async function callCashbillEdge(body: Record<string, unknown>) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('로그인이 필요합니다');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('Supabase URL 미설정');
  const res = await fetch(`${supabaseUrl}/functions/v1/cashbill-issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify(body),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(result.error || `현금영수증 처리 실패 (HTTP ${res.status})`);
    (err as any).hint = result.hint;
    // 운영자 시스템 상태 화면 적재 (2026-07-28)
    //   단, hint 가 붙은 거절은 "이미 국세청 전송 완료" 처럼 사용자가 조치할 정상 거절이다.
    //   화면 안내로 끝내고 운영자 오류 목록은 예상 못 한 실패만 남긴다(2026-08-06).
    if (!result.hint) {
      logError({ source: "manual", message: `[현금영수증 발행 실패] ${err.message}`, context: { action: body.action } });
    }
    throw err;
  }
  return result as { success: boolean; receipt?: CashReceipt; documentKey?: string; message?: string };
}

// 국세청 즉시발행 (승인거래) — 성공 시 서버가 cash_receipts 행 생성
export async function issueCashReceiptNts(params: {
  amount: number;
  identityNum: string;
  identityType: 'phone' | 'bizno' | 'card';
  purpose: 'expenditure_proof' | 'income_deduction';
  taxationType?: '과세' | '비과세';
  counterpartyName?: string;
  itemName?: string;
  email?: string;
  memo?: string;
}) {
  return callCashbillEdge({ action: 'issue', ...params });
}

// 국세청 승인번호·전송상태 조회 (발행 당일 밤 24시 국세청 일괄 전송 후 부여)
export async function refreshCashReceiptNts(receiptId: string) {
  return callCashbillEdge({ action: 'refresh', receipt_id: receiptId });
}

// 발행취소 — 전용 API(regist-cancel-issue). 국세청 전송 이전(발행 당일)만 취소 가능.
export async function cancelCashReceiptNts(receiptId: string, memo?: string) {
  return callCashbillEdge({ action: 'cancel', receipt_id: receiptId, memo });
}

// ── 홈택스 매입내역 수집 (CODEF 현금영수증 매입내역 API — cashbill-purchase-sync 엣지) ──
//   회사에 등록된 홈택스 공동인증서로 조회. 조회가능기간 최근 37개월.
export async function syncPurchaseCashReceipts(startDate: string, endDate: string) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('로그인이 필요합니다');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('Supabase URL 미설정');
  const res = await fetch(`${supabaseUrl}/functions/v1/cashbill-purchase-sync`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ startDate, endDate }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(result.error || `매입내역 조회 실패 (HTTP ${res.status})`);
    (err as any).hint = result.hint;
    logError({ source: 'manual', message: `[현금영수증 매입 수집 실패] ${err.message}`, context: { hint: result.hint, code: result.code } });
    throw err;
  }
  return result as { success: boolean; fetched: number; inserted: number; skipped_duplicate: number; message?: string };
}

// ── 집계 ──

export interface CashReceiptSummary {
  incomeCount: number;
  incomeTotal: number;
  incomeTax: number;
  expenseCount: number;
  expenseTotal: number;
  expenseTax: number;
}

export async function getCashReceiptSummary(
  companyId: string,
  startDate: string,
  endDate: string,
): Promise<CashReceiptSummary> {
  const data = logRead('lib/cash-receipts:data', await db.from('cash_receipts')
    .select('type, amount, tax_amount, status, source')
    .eq('company_id', companyId)
    .gte('issue_date', startDate)
    .lte('issue_date', endDate)
    .neq('status', 'void'));

  const result: CashReceiptSummary = {
    incomeCount: 0, incomeTotal: 0, incomeTax: 0,
    expenseCount: 0, expenseTotal: 0, expenseTax: 0,
  };

  for (const r of (data || [])) {
    //   취소거래는 마이너스로 상계한다 — 안 그러면 취소한 매출이 그대로 남는다 (2026-08-12)
    const sign = cashReceiptSign(r);
    if (sign === 0) continue;
    if (r.type === 'income') {
      result.incomeCount++;
      result.incomeTotal += sign * Number(r.amount || 0);
      result.incomeTax += sign * Number(r.tax_amount || 0);
    } else {
      result.expenseCount++;
      result.expenseTotal += sign * Number(r.amount || 0);
      result.expenseTax += sign * Number(r.tax_amount || 0);
    }
  }

  return result;
}

// ── 엑셀 파싱 (홈택스 현금영수증 다운로드 형식) ──

export function parseHomeTaxCashReceipts(rows: any[]): {
  type: 'income' | 'expense';
  amount: number;
  counterpartyName: string;
  issueDate: string;
  approvalNumber: string;
  purpose: 'expenditure_proof' | 'income_deduction';
}[] {
  return rows.map((r: any) => ({
    type: (r['구분'] === '매출' || r['발행구분'] === '발행' ? 'income' : 'expense') as 'income' | 'expense',
    amount: Number(r['합계금액'] || r['총금액'] || r['거래금액'] || 0),
    counterpartyName: String(r['가맹점명'] || r['거래처명'] || r['상호'] || ''),
    issueDate: String(r['거래일시'] || r['발행일'] || r['거래일'] || '').slice(0, 10),
    approvalNumber: String(r['승인번호'] || ''),
    purpose: (r['용도'] === '소득공제' ? 'income_deduction' : 'expenditure_proof') as 'expenditure_proof' | 'income_deduction',
  })).filter(r => r.amount > 0);
}

// ── Bulk import ──

export async function bulkImportCashReceipts(companyId: string, items: {
  type: 'income' | 'expense';
  amount: number;
  counterpartyName?: string;
  issueDate: string;
  approvalNumber?: string;
  purpose?: 'expenditure_proof' | 'income_deduction';
}[]) {
  const rows = items.map(item => {
    const supplyAmount = Math.round(item.amount / (1 + VAT_RATE));
    return {
      company_id: companyId,
      type: item.type,
      amount: item.amount,
      supply_amount: supplyAmount,
      tax_amount: item.amount - supplyAmount,
      counterparty_name: item.counterpartyName || null,
      issue_date: item.issueDate,
      approval_number: item.approvalNumber || null,
      purpose: item.purpose || (item.type === 'expense' ? 'expenditure_proof' : null),
      source: 'manual',
      status: 'issued',
    };
  });

  const { data, error } = await db.from('cash_receipts').insert(rows).select();
  if (error) throw error;
  return data;
}
