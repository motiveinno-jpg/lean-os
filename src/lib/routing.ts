import { logRead } from "@/lib/log-read";
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
    // maybeSingle — 삭제된 계좌 id 면 행 0개, .single() 은 406 을 던져 오류 로그를 남긴다 (2026-08-13)
    const data = logRead('lib/routing:data', await supabase
      .from('bank_accounts')
      .select('*')
      .eq('id', dealBankAccountId)
      .maybeSingle());
    if (data) return data;
  }

  // Priority 2: Routing rule for this cost type
  const rules = logRead('lib/routing:rules', await supabase
    .from('routing_rules')
    .select('*, bank_accounts(*)')
    .eq('company_id', companyId)
    .eq('cost_type', costType)
    .order('priority', { ascending: false })
    .limit(1));

  if (rules && rules.length > 0) {
    const rule = rules[0] as any;
    if (rule.bank_accounts) return rule.bank_accounts;
  }

  // Priority 3: Default routing rule
  const defaultRules = logRead('lib/routing:defaultRules', await supabase
    .from('routing_rules')
    .select('*, bank_accounts(*)')
    .eq('company_id', companyId)
    .eq('cost_type', 'default')
    .order('priority', { ascending: false })
    .limit(1));

  if (defaultRules && defaultRules.length > 0) {
    const rule = defaultRules[0] as any;
    if (rule.bank_accounts) return rule.bank_accounts;
  }

  // Priority 4: Primary bank account
  // maybeSingle — 주 통장을 지정하지 않은 회사면 행 0개인데 .single() 이 406 으로
  //   오류 로그를 채웠다 (2026-08-13 사장님 결재 처리 중 실발생). 없으면 조용히 null.
  const primary = logRead('lib/routing:primary', await supabase
    .from('bank_accounts')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_primary', true)
    .limit(1)
    .maybeSingle());

  return primary || null;
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
  { value: 'operating', label: '운영통장' },
  { value: 'savings', label: '저축통장' },
  { value: 'subsidy', label: '보조금통장' },
  { value: 'project', label: '프로젝트통장' },
  { value: 'loan', label: '대출통장' },
] as const;
