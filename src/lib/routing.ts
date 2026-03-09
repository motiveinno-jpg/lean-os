/**
 * OwnerView Multi-Bank Routing Engine
 * 비용 유형별 통장 자동 매칭 + 딜 번호 자동 생성
 */

import { supabase } from './supabase';
import type { BankAccount, RoutingRule } from '@/types/models';

// ── Resolve which bank account to use for a cost type ──
export async function resolveBank(
  companyId: string,
  costType: string,
  dealBankAccountId?: string | null
): Promise<BankAccount | null> {
  // Priority 1: Deal-level bank account override
  if (dealBankAccountId) {
    const { data } = await supabase
      .from('bank_accounts')
      .select('*')
      .eq('id', dealBankAccountId)
      .single();
    if (data) return data;
  }

  // Priority 2: Routing rule for this cost type
  const { data: rules } = await supabase
    .from('routing_rules')
    .select('*, bank_accounts(*)')
    .eq('company_id', companyId)
    .eq('cost_type', costType)
    .order('priority', { ascending: false })
    .limit(1);

  if (rules && rules.length > 0) {
    const rule = rules[0] as any;
    if (rule.bank_accounts) return rule.bank_accounts;
  }

  // Priority 3: Default routing rule
  const { data: defaultRules } = await supabase
    .from('routing_rules')
    .select('*, bank_accounts(*)')
    .eq('company_id', companyId)
    .eq('cost_type', 'default')
    .order('priority', { ascending: false })
    .limit(1);

  if (defaultRules && defaultRules.length > 0) {
    const rule = defaultRules[0] as any;
    if (rule.bank_accounts) return rule.bank_accounts;
  }

  // Priority 4: Primary bank account
  const { data: primary } = await supabase
    .from('bank_accounts')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_primary', true)
    .limit(1)
    .single();

  return primary || null;
}

// ── Generate deal number ──
// Format: DEAL-YYYYMM-NNN (e.g., DEAL-202603-001)
export async function generateDealNumber(companyId: string): Promise<string> {
  const now = new Date();
  const prefix = `DEAL-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}`;

  const { data } = await supabase
    .from('deals')
    .select('deal_number')
    .eq('company_id', companyId)
    .like('deal_number', `${prefix}%`)
    .order('deal_number', { ascending: false })
    .limit(1);

  let seq = 1;
  if (data && data.length > 0 && data[0].deal_number) {
    const last = data[0].deal_number.split('-').pop();
    seq = (parseInt(last || '0', 10) || 0) + 1;
  }

  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

// ── Get total balance across all bank accounts ──
export async function getTotalBankBalance(companyId: string): Promise<number> {
  const { data } = await supabase
    .from('bank_accounts')
    .select('balance')
    .eq('company_id', companyId);

  if (!data) return 0;
  return data.reduce((sum, acc) => sum + Number(acc.balance || 0), 0);
}

// ── Cost type labels ──
export const COST_TYPES = [
  { value: 'salary', label: '급여' },
  { value: 'tax', label: '세금' },
  { value: 'outsource', label: '외주비' },
  { value: 'advertising', label: '광고비' },
  { value: 'rent', label: '임대료' },
  { value: 'insurance', label: '보험' },
  { value: 'default', label: '기본' },
] as const;

// ── Bank role labels ──
export const BANK_ROLES = [
  { value: 'OPERATING', label: '운영통장' },
  { value: 'TAX', label: '세금통장' },
  { value: 'PAYROLL', label: '급여통장' },
  { value: 'PROJECT', label: '프로젝트통장' },
] as const;
