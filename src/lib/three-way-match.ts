// 3-Way 매칭 v2 — 세금계산서 ↔ 거래처 ↔ 입출금 후보 추천
//   사장님 요청 (2026-05-21):
//     (A) 거래처명 == 입금자명 정확 일치
//     (B) 대표자명 == 입금자명 정확 일치
//     (C) 발행금액 ≈ 입출금금액 (부가세 고려 ±10%)
//   정확 일치는 trim + lowercase 정규화만 (퍼지 매칭 금지 — 사장님 명시).
//
// 기존 src/lib/tax-invoice.ts 의 threeWayMatch (계약↔세금계산서↔입금) 와 별개.
//   호출 lib: src/app/(app)/reports/three-way-match/page.tsx

import { supabase } from './supabase';

export interface ThreeWayInvoice {
  id: string;
  type: 'sales' | 'purchase';
  counterparty_name: string | null;
  total_amount: number;
  supply_amount: number;
  issue_date: string | null;
  status: string | null;
  partner_id: string | null;
}

export interface ThreeWayCandidate {
  bankTxId: string;
  bankCounterparty: string;
  bankAmount: number;
  bankDate: string;
  bankDescription: string | null;
  reasons: string[]; // 매칭 사유 라벨
  score: number;     // reasons.length (정렬용)
}

// 미매칭 세금계산서 목록 — 좌측 패널
export async function listUnmatchedInvoices(
  companyId: string,
  opts?: { type?: 'sales' | 'purchase'; limit?: number },
): Promise<ThreeWayInvoice[]> {
  const limit = opts?.limit ?? 100;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let q = (supabase as any)
    .from('tax_invoices')
    .select('id, type, counterparty_name, total_amount, supply_amount, issue_date, status, partner_id')
    .eq('company_id', companyId)
    .neq('status', 'void')
    .neq('status', 'matched')
    .order('issue_date', { ascending: false })
    .limit(limit);
  if (opts?.type) q = q.eq('type', opts.type);
  const { data } = await q;
  return (data || []) as ThreeWayInvoice[];
}

// 세금계산서 1개 + 후보 입출금 → 매칭 추천 리스트
export async function getThreeWayCandidates(
  companyId: string,
  invoice: ThreeWayInvoice,
): Promise<ThreeWayCandidate[]> {
  // 거래처 정보 (대표자명 매칭용)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  let partnerName = (invoice.counterparty_name || '').trim().toLowerCase();
  let repName = '';
  if (invoice.partner_id) {
    const { data: p } = await db.from('partners').select('name, representative').eq('id', invoice.partner_id).maybeSingle();
    if (p) {
      partnerName = (p.name || invoice.counterparty_name || '').trim().toLowerCase();
      repName = (p.representative || '').trim().toLowerCase();
    }
  }

  // 미매칭 bank_transactions — 회사격리 + tax_invoice_id NULL.
  //   sales(매출) 행은 입금(income), purchase(매입) 행은 출금(expense) 대응.
  const expectedType = invoice.type === 'sales' ? 'income' : 'expense';
  const { data: txs } = await db
    .from('bank_transactions')
    .select('id, counterparty, amount, transaction_date, description, memo, type')
    .eq('company_id', companyId)
    .is('tax_invoice_id', null)
    .eq('type', expectedType)
    .order('transaction_date', { ascending: false })
    .limit(200);

  const total = Number(invoice.total_amount || 0);
  const supply = Number(invoice.supply_amount || 0);
  const tol = 0.10; // 사장님 명시 ±10%

  const candidates: ThreeWayCandidate[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const tx of (txs || []) as any[]) {
    const reasons: string[] = [];
    const bankName = String(tx.counterparty || '').trim().toLowerCase();

    if (partnerName && bankName && bankName === partnerName) {
      reasons.push('거래처명 일치');
    }
    if (repName && bankName && bankName === repName) {
      reasons.push('대표자명 일치');
    }
    const amt = Number(tx.amount || 0);
    if (total > 0 && Math.abs(total - amt) / total <= tol) {
      const pct = (Math.abs(total - amt) / total * 100).toFixed(1);
      reasons.push(`금액 일치 (${pct}% 차이)`);
    } else if (supply > 0 && Math.abs(supply - amt) / supply <= tol) {
      const pct = (Math.abs(supply - amt) / supply * 100).toFixed(1);
      reasons.push(`금액 일치 (공급가 ${pct}% 차이)`);
    }

    if (reasons.length > 0) {
      candidates.push({
        bankTxId: tx.id,
        bankCounterparty: tx.counterparty || '',
        bankAmount: amt,
        bankDate: tx.transaction_date,
        bankDescription: tx.description ?? tx.memo ?? null,
        reasons,
        score: reasons.length,
      });
    }
  }
  return candidates.sort((a, b) => b.score - a.score);
}

// 매칭 확정 — bank_transactions.tax_invoice_id 갱신 + invoice status='matched'
export async function confirmThreeWayMatch(bankTxId: string, invoiceId: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = supabase as any;
  const { error: txErr } = await db
    .from('bank_transactions')
    .update({ tax_invoice_id: invoiceId })
    .eq('id', bankTxId);
  if (txErr) throw txErr;
  const { error: invErr } = await db
    .from('tax_invoices')
    .update({ status: 'matched' })
    .eq('id', invoiceId);
  if (invErr) throw invErr;
}
