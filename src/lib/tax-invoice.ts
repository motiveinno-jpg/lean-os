import { logRead } from "@/lib/log-read";
/**
 * OwnerView Tax Invoice Engine
 * 세금계산서 생성 + 3-way matching (계약 ↔ 세금계산서 ↔ 입금)
 */

import { supabase } from './supabase';
import type { TaxInvoice } from '@/types/models';

export const DEFAULT_VAT_RATE = 0.1;

// ── Tax invoice types ──
export const INVOICE_TYPES = [
  { value: 'sales', label: '매출 (발행)' },
  { value: 'purchase', label: '매입 (수취)' },
] as const;

export const INVOICE_STATUS = {
  draft: { label: '작성중', bg: 'bg-gray-500/10', text: 'text-gray-400' },
  issued: { label: '발행', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  received: { label: '수취', bg: 'bg-blue-500/10', text: 'text-blue-400' },
  matched: { label: '매칭완료', bg: 'bg-green-500/10', text: 'text-green-400' },
  modified: { label: '수정발행', bg: 'bg-orange-500/10', text: 'text-orange-400' },
  void: { label: '무효', bg: 'bg-red-500/10', text: 'text-red-400' },
} as const;

// 상태 메타 — 비표준 'unmatched'(과거 매칭해제 시 잘못 기록된 값)는 type 기준으로 정규화해
//   '작성중'(draft 폴백) 오표시를 막는다. (매출=발행, 매입=수취)
export function invoiceStatusMeta(status: string | null | undefined, type?: string | null) {
  const norm = status === 'unmatched' ? (type === 'purchase' ? 'received' : 'issued') : (status || 'draft');
  return (INVOICE_STATUS as Record<string, { label: string; bg: string; text: string }>)[norm] || INVOICE_STATUS.draft;
}

// ── Create tax invoice ──
export async function createTaxInvoice(params: {
  companyId: string;
  dealId?: string;
  type: 'sales' | 'purchase';
  counterpartyName: string;
  counterpartyBizno?: string;
  counterpartyBusinessType?: string;
  counterpartyBusinessItem?: string;
  supplyAmount: number;
  issueDate: string;
  label?: string;
  revenueScheduleId?: string | null;
  status?: string;
  preferredDate?: string;
  expenseCategory?: string;
  partnerId?: string;
  // 과세유형(직원 QA 그랜터) — taxable(과세)/zero_rated(영세율)/exempt(면세). 영세율·면세는 세액 0.
  taxKind?: 'taxable' | 'zero_rated' | 'exempt';
}): Promise<TaxInvoice | null> {
  const taxKind = params.taxKind || 'taxable';
  const taxAmount = taxKind === 'taxable' ? Math.round(params.supplyAmount * DEFAULT_VAT_RATE) : 0;
  const totalAmount = params.supplyAmount + taxAmount;

  // 파이프라인에서 자동 생성 시 status: 'draft' 강제
  const status = params.status || (params.revenueScheduleId ? 'draft' : (params.type === 'sales' ? 'issued' : 'received'));

  const { data, error } = await supabase
    .from('tax_invoices')
    .insert({
      company_id: params.companyId,
      deal_id: params.dealId || null,
      type: params.type,
      counterparty_name: params.counterpartyName,
      counterparty_bizno: params.counterpartyBizno || null,
      supply_amount: params.supplyAmount,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      issue_date: params.issueDate,
      status,
      label: params.label || null,
      revenue_schedule_id: params.revenueScheduleId || null,
      preferred_date: params.preferredDate || null,
      expense_category: params.expenseCategory || null,
      partner_id: params.partnerId || null,
      counterparty_business_type: params.counterpartyBusinessType || null,
      counterparty_business_item: params.counterpartyBusinessItem || null,
      tax_kind: taxKind,
      source: 'manual',
    })
    .select()
    .single();

  if (error) throw error;

  // Auto-generate 지출결의서 for purchase invoices
  if (data && params.type === 'purchase') {
    autoCreateExpenseReport(params.companyId, data).catch((err) => {
      console.error('Auto expense report creation failed:', err);
    });
  }

  return data;
}

/**
 * 매입 세금계산서 등록 시 지출결의서를 자동 생성합니다.
 */
async function autoCreateExpenseReport(companyId: string, invoice: TaxInvoice) {
  try {
    const { createApprovalRequest } = await import('./approval-workflow');

    // Get a user for the request (company owner)
    const owner = logRead('lib/tax-invoice:owner', await supabase
      .from('users')
      .select('id')
      .eq('company_id', companyId)
      .eq('role', 'owner')
      .limit(1)
      .maybeSingle());

    if (!owner) return;

    await createApprovalRequest({
      companyId,
      requestType: 'expense_report',
      requestId: invoice.id,
      requesterId: owner.id,
      title: `[자동] 매입 세금계산서 - ${invoice.counterparty_name}`,
      amount: Number(invoice.total_amount),
      description: `매입 세금계산서 자동 연결\n거래처: ${invoice.counterparty_name}\n공급가: ₩${Number(invoice.supply_amount).toLocaleString()}\n부가세: ₩${Number(invoice.tax_amount).toLocaleString()}\n합계: ₩${Number(invoice.total_amount).toLocaleString()}\n발행일: ${invoice.issue_date}`,
    });
  } catch (err) {
    console.error('autoCreateExpenseReport failed:', err);
  }
}

// ── 3-Way Match Result ──
export interface ThreeWayMatchResult {
  invoiceId: string;
  dealId: string | null;
  dealName: string | null;
  invoiceAmount: number;
  invoiceSupplyAmount: number;
  invoiceTaxAmount: number;
  contractAmount: number;
  receivedAmount: number;
  amountMatch: boolean;      // 계약금액 = 세금계산서 공급가액
  paymentMatch: boolean;     // 세금계산서 합계 = 입금액
  fullMatch: boolean;        // 3-way 모두 일치
  gap: number;               // 차이
  suggestedDeal: boolean;    // deal_id 없이 금액 기반 추천된 딜
}

// ── 3-Way Matching: 계약 ↔ 세금계산서 ↔ 입금 ──
export async function threeWayMatch(companyId: string): Promise<ThreeWayMatchResult[]> {
  // Read matching tolerance from company settings (default 1%)
  let tolerance = 0.01;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const company = logRead('lib/tax-invoice:company', await supabase
      .from('companies')
      .select('tax_settings')
      .eq('id', companyId)
      .single());
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const ts = (company as any)?.tax_settings;
    if (ts?.matching_tolerance != null && ts.matching_tolerance >= 0 && ts.matching_tolerance <= 100) {
      tolerance = ts.matching_tolerance / 100;
    }
  } catch { /* use default */ }

  // Fetch all sales invoices (with linked deal if any)
  const invoices = logRead('lib/tax-invoice:invoices', await supabase
    .from('tax_invoices')
    .select('*, deals(*)')
    .eq('company_id', companyId)
    .eq('type', 'sales')
    .neq('status', 'void'));

  if (!invoices) return [];

  // Fetch ALL deals for smart matching (unlinked invoices)
  const allDeals = logRead('lib/tax-invoice:allDeals', await supabase
    .from('deals')
    .select('id, name, contract_total')
    .eq('company_id', companyId));

  // Fetch ALL revenue schedule entries (not just received) for partial matching
  const allRevenues = logRead('lib/tax-invoice:allRevenues', await supabase
    .from('deal_revenue_schedule')
    .select('*, deals!inner(company_id)')
    .eq('deals.company_id', companyId));

  const receivedByDeal = new Map<string, number>();
  const schedulesByDeal = new Map<string, { amount: number; status: string; label?: string }[]>();
  (allRevenues || []).forEach((r: any) => {
    const dealId = r.deal_id;
    if (r.status === 'received') {
      receivedByDeal.set(dealId, (receivedByDeal.get(dealId) ?? 0) + Number(r.amount ?? 0));
    }
    const arr = schedulesByDeal.get(dealId) || [];
    arr.push({ amount: Number(r.amount ?? 0), status: r.status, label: r.label });
    schedulesByDeal.set(dealId, arr);
  });

  return invoices.map((inv: any) => {
    const linkedDeal = inv.deals;
    const invoiceSupplyAmount = Number(inv.supply_amount ?? 0);
    const invoiceTaxAmount = Number(inv.tax_amount ?? 0);
    const invoiceAmount = Number(inv.total_amount ?? 0);

    let matchedDealId: string | null = inv.deal_id;
    let matchedDealName: string | null = linkedDeal?.name || null;
    let contractAmount = Number(linkedDeal?.contract_total ?? 0);
    let suggestedDeal = false;

    // If no linked deal or linked deal has no contract amount, try smart matching
    if (contractAmount <= 0 && invoiceSupplyAmount > 0 && allDeals) {
      const candidate = allDeals.find((d: any) => {
        const ct = Number(d.contract_total ?? 0);
        if (ct > 0 && Math.abs(ct - invoiceSupplyAmount) / ct <= tolerance) return true;
        const sched = schedulesByDeal.get(d.id) || [];
        return sched.some(s => s.amount > 0 && Math.abs(s.amount - invoiceSupplyAmount) / s.amount <= tolerance);
      });
      if (candidate) {
        matchedDealId = candidate.id;
        matchedDealName = candidate.name;
        contractAmount = Number(candidate.contract_total);
        suggestedDeal = true;
      }
    }

    const receivedAmount = matchedDealId ? (receivedByDeal.get(matchedDealId) ?? 0) : 0;

    // Check against full contract or individual schedule entries (선금/잔금)
    const fullAmountMatch = contractAmount > 0 && Math.abs(contractAmount - invoiceSupplyAmount) / contractAmount <= tolerance;
    const schedules = matchedDealId ? (schedulesByDeal.get(matchedDealId) || []) : [];
    const partialMatch = schedules.some(s => s.amount > 0 && Math.abs(s.amount - invoiceSupplyAmount) / s.amount <= tolerance);
    const amountMatch = fullAmountMatch || partialMatch;
    const paymentMatch = invoiceAmount > 0 && Math.abs(invoiceAmount - receivedAmount) / invoiceAmount <= tolerance;
    const fullMatch = amountMatch && paymentMatch;

    return {
      invoiceId: inv.id,
      dealId: matchedDealId,
      dealName: matchedDealName,
      invoiceAmount,
      invoiceSupplyAmount,
      invoiceTaxAmount,
      contractAmount,
      receivedAmount,
      amountMatch,
      paymentMatch,
      fullMatch,
      gap: invoiceAmount - receivedAmount,
      suggestedDeal,
    };
  });
}

// ── Mark invoice as matched ──
export async function markInvoiceMatched(invoiceId: string) {
  const { error } = await supabase
    .from('tax_invoices')
    .update({ status: 'matched' })
    .eq('id', invoiceId);
  if (error) throw error;
}

// ── Issue tax invoice (실제 홈택스 전자발행) ──
// - 기본: hometax-issue edge function 호출 → CODEF 거쳐서 국세청 전자발행 + 승인번호 받음.
// - opts.dbOnly: true 이면 외부 호출 없이 DB status 만 'issued' 마킹 (자동화/마이그레이션 등 특수 케이스).
// - 실패 시 throw — 호출자가 catch 해서 사용자에게 toast 로 명확한 에러 + hint 표시 권장.
export async function issueTaxInvoice(
  invoiceId: string,
  opts: { dbOnly?: boolean } = {},
) {
  if (opts.dbOnly) {
    const { data, error } = await supabase
      .from('tax_invoices')
      .update({ status: 'issued', issue_date: new Date().toISOString().split('T')[0] })
      .eq('id', invoiceId)
      .eq('status', 'draft')
      .select()
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  // 정공법: 홈택스 전자발행
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('로그인이 필요합니다');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('Supabase URL 미설정');

  const res = await fetch(`${supabaseUrl}/functions/v1/hometax-issue`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({ invoice_id: invoiceId }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(result.error || `홈택스 발행 실패 (HTTP ${res.status})`);
    (err as any).code = result.code;
    (err as any).hint = result.hint;
    throw err;
  }
  // 발행 성공 — 갱신된 invoice 반환
  const invoice = logRead('lib/tax-invoice:invoice', await supabase
    .from('tax_invoices')
    .select('*')
    .eq('id', invoiceId)
    .maybeSingle());
  return invoice;
}

// ── 전자세금계산서 발행 등록 (최초 1회): CODEF 제휴사 회원가입 + 공동인증서 등록 URL ──
//   발행 선행 절차. certURL(인증서 등록 페이지)을 받아 새 창으로 연다.
export async function registerHometaxIssuer(companyId: string): Promise<{ certURL: string; joinCode?: string; message?: string }> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('로그인이 필요합니다');
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('Supabase URL 미설정');

  // CODEF: 제휴사 회원가입 + 인증서 등록 URL 발급 (register-issuer 한 번의 호출로 처리)
  const res = await fetch(`${supabaseUrl}/functions/v1/hometax-issue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
    body: JSON.stringify({ action: 'register-issuer', companyId }),
  });
  const result = await res.json().catch(() => ({}));
  if (!res.ok || !result.certURL) {
    throw new Error(result.error || `발행 등록 실패 (HTTP ${res.status})`);
  }
  return { certURL: result.certURL, joinCode: result.joinCode, message: result.message };
}

// ── Period Aggregation (월/분기/연간) ──
export type PeriodType = 'monthly' | 'quarterly' | 'annual';

export interface PeriodSummary {
  period: string; // "2026-01", "2026-Q1", "2026"
  salesCount: number;
  purchaseCount: number;
  salesSupply: number;
  salesTax: number;
  salesTotal: number;
  purchaseSupply: number;
  purchaseTax: number;
  purchaseTotal: number;
  vatPayable: number; // 매출세액 - 매입세액
}

export async function getTaxInvoiceSummary(
  companyId: string,
  year: number,
  periodType: PeriodType = 'monthly'
): Promise<PeriodSummary[]> {
  const startDate = `${year}-01-01`;
  const endDate = `${year}-12-31`;

  const { fetchAllPaginated } = await import('./supabase-paginated');
  const invoices = await fetchAllPaginated<any>((from, to) =>
    supabase
      .from('tax_invoices')
      .select('type, supply_amount, tax_amount, total_amount, issue_date')
      .eq('company_id', companyId)
      .neq('status', 'void')
      .gte('issue_date', startDate)
      .lte('issue_date', endDate)
      .range(from, to)
  );

  if (!invoices || invoices.length === 0) return [];

  const buckets = new Map<string, PeriodSummary>();

  const getPeriodKey = (dateStr: string): string => {
    const d = new Date(dateStr);
    const m = d.getMonth() + 1;
    if (periodType === 'annual') return `${year}`;
    if (periodType === 'quarterly') {
      const q = Math.ceil(m / 3);
      return `${year}-Q${q}`;
    }
    return `${year}-${String(m).padStart(2, '0')}`;
  };

  invoices.forEach((inv: any) => {
    const key = getPeriodKey(inv.issue_date);
    if (!buckets.has(key)) {
      buckets.set(key, {
        period: key,
        salesCount: 0, purchaseCount: 0,
        salesSupply: 0, salesTax: 0, salesTotal: 0,
        purchaseSupply: 0, purchaseTax: 0, purchaseTotal: 0,
        vatPayable: 0,
      });
    }
    const b = buckets.get(key)!;
    const supply = Number(inv.supply_amount ?? 0);
    const tax = Number(inv.tax_amount ?? 0);
    const total = Number(inv.total_amount ?? 0);

    if (inv.type === 'sales') {
      b.salesCount++;
      b.salesSupply += supply;
      b.salesTax += tax;
      b.salesTotal += total;
    } else {
      b.purchaseCount++;
      b.purchaseSupply += supply;
      b.purchaseTax += tax;
      b.purchaseTotal += total;
    }
  });

  // Calculate VAT payable for each period
  buckets.forEach(b => {
    b.vatPayable = b.salesTax - b.purchaseTax;
  });

  return Array.from(buckets.values()).sort((a, b) => a.period.localeCompare(b.period));
}

// ── VAT Preview (분기별 부가세 예측) ──
export interface VATPreview {
  quarter: string;
  salesTax: number;            // 매출세액 합계 = 세금계산서 + 현금영수증(발행)
  invoiceSalesTax: number;     // 세금계산서 매출세액
  cashReceiptSalesTax: number; // 현금영수증 매출세액 (2026-06-11 통합 — 기존엔 누락돼 납부세액 과소추정)
  purchaseTax: number;
  cardDeduction: number;
  netVAT: number;
  dueDate: string;
}

export async function getVATPreview(companyId: string, year: number): Promise<VATPreview[]> {
  const db = supabase;

  // Get tax invoice summary by quarter
  const quarterly = await getTaxInvoiceSummary(companyId, year, 'quarterly');

  // Get card deduction data
  const cardData = logRead('lib/tax-invoice:cardData', await db
    .from('card_deduction_summary')
    .select('*')
    .eq('company_id', companyId));

  // 현금영수증 매출 세액 — 세금계산서 미발행 매출의 부가세도 납부 대상 (cash-receipts 화면 동일 테이블)
  //   발행(issued)만 집계, 취소/무효 제외. 매입 현금영수증 공제는 증빙 요건 판단이 필요해 미반영(보수적).
  const crData = logRead('lib/tax-invoice:crData', await db
    .from('cash_receipts')
    .select('tax_amount, issue_date')
    .eq('company_id', companyId)
    .eq('type', 'income')
    .eq('status', 'issued')
    .gte('issue_date', `${year}-01-01`)
    .lt('issue_date', `${year + 1}-01-01`));

  const crByQuarter = new Map<string, number>();
  (crData || []).forEach((c: any) => {
    const d = new Date(c.issue_date);
    const q = Math.ceil((d.getMonth() + 1) / 3);
    const key = `${year}-Q${q}`;
    crByQuarter.set(key, (crByQuarter.get(key) ?? 0) + Number(c.tax_amount ?? 0));
  });

  // Map card deductions to quarters
  const cardByQuarter = new Map<string, number>();
  (cardData || []).forEach((c: any) => {
    const d = new Date(c.month);
    if (d.getFullYear() !== year) return;
    const q = Math.ceil((d.getMonth() + 1) / 3);
    const key = `${year}-Q${q}`;
    cardByQuarter.set(key, (cardByQuarter.get(key) ?? 0) + Number(c.estimated_vat_deduction ?? 0));
  });

  const dueDates: Record<string, string> = {
    [`${year}-Q1`]: `${year}-04-25`,
    [`${year}-Q2`]: `${year}-07-25`,
    [`${year}-Q3`]: `${year}-10-25`,
    [`${year}-Q4`]: `${year + 1}-01-25`,
  };

  const quarters = [`${year}-Q1`, `${year}-Q2`, `${year}-Q3`, `${year}-Q4`];

  return quarters.map(q => {
    const data = quarterly.find(s => s.period === q);
    const invoiceSalesTax = data?.salesTax ?? 0;
    const cashReceiptSalesTax = crByQuarter.get(q) ?? 0;
    const salesTax = invoiceSalesTax + cashReceiptSalesTax;
    const purchaseTax = data?.purchaseTax ?? 0;
    const cardDeduction = cardByQuarter.get(q) ?? 0;
    return {
      quarter: q,
      salesTax,
      invoiceSalesTax,
      cashReceiptSalesTax,
      purchaseTax,
      cardDeduction,
      netVAT: salesTax - purchaseTax - cardDeduction,
      dueDate: dueDates[q] || '',
    };
  });
}

// ── HomeTax Excel Import Parser ──
export function parseHomeTaxExcel(rows: any[]) {
  return rows.map((r: any) => ({
    type: (r['구분'] === '매출' || r['유형'] === '발행' ? 'sales' : 'purchase') as 'sales' | 'purchase',
    counterpartyName: String(r['거래처명'] || r['상호'] || ''),
    counterpartyBizno: String(r['사업자번호'] || r['사업자등록번호'] || ''),
    supplyAmount: Number(r['공급가액'] ?? r['공급가'] ?? 0),
    taxAmount: Number(r['세액'] ?? r['부가세'] ?? 0),
    totalAmount: Number(r['합계금액'] ?? r['합계'] ?? 0),
    issueDate: String(r['발행일'] || r['작성일자'] || ''),
  })).filter(r => r.counterpartyName && r.supplyAmount > 0);
}

// ── Sync HomeTax invoices ──
// CODEF 통합 sync 경유 (국세청 organization 0004).
// 자체 hometax-sync Edge Function은 NPKI 복호화 미구현으로 사용하지 않음.
export async function syncHomeTaxInvoices(params: {
  companyId: string;
  startDate: string;
  endDate: string;
}): Promise<{
  success: boolean;
  status: 'success' | 'partial' | 'error';
  synced: number;
  responseCount: number;  // CODEF 응답에 들어온 row 수 — synced 와 차이가 있으면 누락
  errors: Array<{ code: string; message: string; hint: string; organization: string; accountNo: string }>;
  notes: Array<{ code: string; message: string; hint: string; organization: string; accountNo: string }>;
}> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('로그인이 필요합니다');

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrl) throw new Error('Supabase URL이 설정되지 않았습니다');

  const res = await fetch(`${supabaseUrl}/functions/v1/codef-sync`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${session.access_token}`,
    },
    body: JSON.stringify({
      companyId: params.companyId,
      action: 'sync',
      syncType: 'hometax',
      startDate: params.startDate.replace(/-/g, ''),
      endDate: params.endDate.replace(/-/g, ''),
    }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: '홈택스 동기화 오류' }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }

  const result = await res.json();
  return {
    success: result.success ?? false,
    status: result.status ?? 'error',
    synced: result.results?.hometax?.synced ?? 0,
    responseCount: result.results?.hometax?.responseCount ?? 0,
    errors: result.errors ?? [],
    notes: result.notes ?? [],
  };
}

// ── Modify tax invoice (수정세금계산서) ──
export async function modifyTaxInvoice(params: {
  invoiceId: string;
  reason: string;
  newSupplyAmount?: number;
  modificationDate?: string;
}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('로그인이 필요합니다');

  const res = await supabase.functions.invoke('modify-tax-invoice', {
    body: {
      invoice_id: params.invoiceId,
      reason: params.reason,
      new_supply_amount: params.newSupplyAmount,
      modification_date: params.modificationDate,
    },
  });
  if (res.error) throw res.error;
  return res.data;
}

// ── Get invoice queue (자동발행 대기 큐) ──
export async function getInvoiceQueue(companyId: string) {
  const db = supabase;
  const { data, error } = await db
    .from('tax_invoice_queue')
    .select('*, deals(name)')
    .eq('company_id', companyId)
    .in('status', ['pending', 'needs_approval', 'processing'])
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

// ── Approve queue item ──
export async function approveQueueItem(queueId: string, userId: string) {
  const db = supabase;
  const { error } = await db
    .from('tax_invoice_queue')
    .update({ status: 'pending', approved_by: userId, approved_at: new Date().toISOString() })
    .eq('id', queueId);
  if (error) throw error;
}

// ── Get sync logs ──
export async function getHomeTaxSyncLogs(companyId: string, limit = 20) {
  const db = supabase;
  const { data, error } = await db
    .from('hometax_sync_log')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  if (error) throw error;
  return data || [];
}

// ── Bulk import tax invoices ──
export async function bulkImportTaxInvoices(companyId: string, items: {
  type: 'sales' | 'purchase';
  counterpartyName: string;
  counterpartyBizno?: string;
  supplyAmount: number;
  taxAmount?: number;
  totalAmount?: number;
  issueDate: string;
}[]) {
  const rows = items.map(item => ({
    company_id: companyId,
    type: item.type,
    counterparty_name: item.counterpartyName,
    counterparty_bizno: item.counterpartyBizno || null,
    supply_amount: item.supplyAmount,
    tax_amount: item.taxAmount ?? Math.round(item.supplyAmount * DEFAULT_VAT_RATE),
    /* 부동소수점 오류 방지: supplyAmount + taxAmount 합산 방식 사용 */
    total_amount: item.totalAmount ?? (item.supplyAmount + (item.taxAmount ?? Math.round(item.supplyAmount * DEFAULT_VAT_RATE))),
    issue_date: item.issueDate,
    status: item.type === 'sales' ? 'issued' : 'received',
  }));

  const { data, error } = await supabase
    .from('tax_invoices')
    .insert(rows)
    .select();
  if (error) throw error;
  return data;
}
