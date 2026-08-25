import { supabase } from './supabase';

const db = supabase;

// ── Types ──

export type AccountType = 'asset' | 'liability' | 'equity' | 'revenue' | 'expense';
export type ReferenceType = 'invoice' | 'payment' | 'expense' | 'transfer' | 'adjustment';

export interface ChartOfAccount {
  id: string;
  company_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  parent_id: string | null;
  is_system: boolean;
  created_at: string;
}

export interface JournalEntry {
  id: string;
  company_id: string;
  entry_date: string;
  description: string;
  reference_type: ReferenceType | null;
  reference_id: string | null;
  created_by: string | null;
  approved_by: string | null;
  is_approved: boolean;
  created_at: string;
  lines?: JournalLine[];
}

export interface JournalLine {
  id: string;
  entry_id: string;
  account_id: string;
  debit: number;
  credit: number;
  description: string;
  account?: ChartOfAccount;
}

export interface JournalLineInput {
  account_id: string;
  debit: number;
  credit: number;
  description?: string;
}

export interface CreateJournalEntryParams {
  company_id: string;
  entry_date: string;
  description: string;
  reference_type?: ReferenceType;
  reference_id?: string;
  created_by?: string;
  lines: JournalLineInput[];
}

export interface JournalEntryFilters {
  from_date?: string;
  to_date?: string;
  reference_type?: ReferenceType;
  is_approved?: boolean;
}

export interface AccountBalance {
  account_id: string;
  code: string;
  name: string;
  account_type: AccountType;
  debit_total: number;
  credit_total: number;
  balance: number;
}

export interface GeneralLedgerLine {
  id: string;
  entry_id: string;
  entry_date: string;
  entry_description: string;
  debit: number;
  credit: number;
  line_description: string;
  running_balance: number;
}

// ── Helpers ──

/**
 * Compute the natural balance for an account type.
 * Assets & expenses have debit-normal balances (debit - credit).
 * Liabilities, equity & revenue have credit-normal balances (credit - debit).
 */
function naturalBalance(accountType: AccountType, debitTotal: number, creditTotal: number): number {
  if (accountType === 'asset' || accountType === 'expense') {
    return debitTotal - creditTotal;
  }
  return creditTotal - debitTotal;
}

// ── Chart of Accounts ──

/**
 * Fetch all accounts for a company, ordered by code.
 */
export async function getChartOfAccounts(companyId: string): Promise<ChartOfAccount[]> {
  const { data, error } = await db
    .from('chart_of_accounts')
    .select('*')
    .eq('company_id', companyId)
    .order('code', { ascending: true });

  if (error) throw new Error(`Failed to fetch chart of accounts: ${error.message}`);
  return (data ?? []) as unknown as ChartOfAccount[];
}
