import { supabase } from './supabase';

const db = supabase as any;

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

// ── Journal Entries ──

/**
 * Create a journal entry with its lines in a single transaction.
 * Validates that total debits equal total credits before sending to the DB.
 */
export async function createJournalEntry(params: CreateJournalEntryParams): Promise<JournalEntry> {
  const { company_id, entry_date, description, reference_type, reference_id, created_by, lines } = params;

  // Client-side balance validation
  if (lines.length < 2) {
    throw new Error('A journal entry must have at least two lines');
  }

  const totalDebit = lines.reduce((sum, l) => sum + (l.debit || 0), 0);
  const totalCredit = lines.reduce((sum, l) => sum + (l.credit || 0), 0);

  // Compare with tolerance for floating point
  if (Math.abs(totalDebit - totalCredit) > 0.001) {
    throw new Error(
      `Journal entry is unbalanced: debits (${totalDebit.toFixed(2)}) ≠ credits (${totalCredit.toFixed(2)})`
    );
  }

  // Validate each line has either debit or credit, not both
  for (const line of lines) {
    if ((line.debit || 0) > 0 && (line.credit || 0) > 0) {
      throw new Error('A journal line cannot have both debit and credit amounts');
    }
    if ((line.debit || 0) === 0 && (line.credit || 0) === 0) {
      throw new Error('A journal line must have a debit or credit amount');
    }
  }

  // Insert the entry
  const { data: entry, error: entryError } = await db
    .from('journal_entries')
    .insert({
      company_id,
      entry_date,
      description,
      reference_type: reference_type ?? null,
      reference_id: reference_id ?? null,
      created_by: created_by ?? null,
    })
    .select()
    .single();

  if (entryError) throw new Error(`Failed to create journal entry: ${entryError.message}`);

  // Insert lines
  const lineRows = lines.map((l) => ({
    entry_id: entry.id,
    account_id: l.account_id,
    debit: l.debit || 0,
    credit: l.credit || 0,
    description: l.description ?? '',
  }));

  const { data: insertedLines, error: linesError } = await db
    .from('journal_lines')
    .insert(lineRows)
    .select();

  if (linesError) {
    // Attempt to clean up the orphaned entry
    await db.from('journal_entries').delete().eq('id', entry.id);
    throw new Error(`Failed to create journal lines: ${linesError.message}`);
  }

  return {
    ...(entry as unknown as JournalEntry),
    lines: (insertedLines ?? []) as unknown as JournalLine[],
  };
}

/**
 * List journal entries with their lines, optionally filtered.
 */
export async function getJournalEntries(
  companyId: string,
  filters?: JournalEntryFilters
): Promise<JournalEntry[]> {
  let query = db
    .from('journal_entries')
    .select('*, journal_lines(*, chart_of_accounts(*))')
    .eq('company_id', companyId)
    .order('entry_date', { ascending: false });

  if (filters?.from_date) {
    query = query.gte('entry_date', filters.from_date);
  }
  if (filters?.to_date) {
    query = query.lte('entry_date', filters.to_date);
  }
  if (filters?.reference_type) {
    query = query.eq('reference_type', filters.reference_type);
  }
  if (filters?.is_approved !== undefined) {
    query = query.eq('is_approved', filters.is_approved);
  }

  const { data, error } = await query;

  if (error) throw new Error(`Failed to fetch journal entries: ${error.message}`);

  // Reshape nested data
  return ((data ?? []) as unknown[]).map((row: unknown) => {
    const entry = row as Record<string, unknown>;
    const rawLines = (entry.journal_lines ?? []) as Record<string, unknown>[];
    const lines: JournalLine[] = rawLines.map((l) => ({
      id: l.id as string,
      entry_id: l.entry_id as string,
      account_id: l.account_id as string,
      debit: Number(l.debit),
      credit: Number(l.credit),
      description: (l.description as string) ?? '',
      account: l.chart_of_accounts as ChartOfAccount | undefined,
    }));
    return {
      id: entry.id as string,
      company_id: entry.company_id as string,
      entry_date: entry.entry_date as string,
      description: entry.description as string,
      reference_type: entry.reference_type as ReferenceType | null,
      reference_id: entry.reference_id as string | null,
      created_by: entry.created_by as string | null,
      approved_by: entry.approved_by as string | null,
      is_approved: entry.is_approved as boolean,
      created_at: entry.created_at as string,
      lines,
    };
  });
}

// ── Balances & Reports ──

/**
 * Get the balance for a single account (sum of debits minus credits),
 * applying the natural balance direction for the account type.
 */
export async function getAccountBalance(
  companyId: string,
  accountId: string,
  asOfDate?: string
): Promise<AccountBalance> {
  // Fetch the account metadata
  const { data: account, error: accountError } = await db
    .from('chart_of_accounts')
    .select('*')
    .eq('id', accountId)
    .eq('company_id', companyId)
    .single();

  if (accountError || !account) {
    throw new Error(`Account not found: ${accountError?.message ?? accountId}`);
  }

  // Sum debits and credits from journal lines linked through entries
  let query = db
    .from('journal_lines')
    .select('debit, credit, journal_entries!inner(company_id, entry_date)')
    .eq('account_id', accountId)
    .eq('journal_entries.company_id', companyId);

  if (asOfDate) {
    query = query.lte('journal_entries.entry_date', asOfDate);
  }

  const { data: lines, error: linesError } = await query;

  if (linesError) throw new Error(`Failed to fetch account balance: ${linesError.message}`);

  const debitTotal = (lines ?? []).reduce((sum: number, l: any) => sum + Number(l.debit), 0);
  const creditTotal = (lines ?? []).reduce((sum: number, l: any) => sum + Number(l.credit), 0);

  const acct = account as unknown as ChartOfAccount;
  return {
    account_id: acct.id,
    code: acct.code,
    name: acct.name,
    account_type: acct.account_type,
    debit_total: debitTotal,
    credit_total: creditTotal,
    balance: naturalBalance(acct.account_type, debitTotal, creditTotal),
  };
}

/**
 * Trial balance (시산표): all accounts with their debit/credit totals and balances.
 */
export async function getTrialBalance(
  companyId: string,
  asOfDate?: string
): Promise<AccountBalance[]> {
  // Fetch all accounts
  const accounts = await getChartOfAccounts(companyId);

  // Fetch all journal lines for the company in one query
  let query = db
    .from('journal_lines')
    .select('account_id, debit, credit, journal_entries!inner(company_id, entry_date)')
    .eq('journal_entries.company_id', companyId);

  if (asOfDate) {
    query = query.lte('journal_entries.entry_date', asOfDate);
  }

  const { data: lines, error } = await query;

  if (error) throw new Error(`Failed to fetch trial balance: ${error.message}`);

  // Aggregate by account
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const line of (lines ?? []) as Record<string, unknown>[]) {
    const accountId = line.account_id as string;
    const existing = totals.get(accountId) ?? { debit: 0, credit: 0 };
    existing.debit += Number(line.debit);
    existing.credit += Number(line.credit);
    totals.set(accountId, existing);
  }

  // Build result for every account (including zero-balance accounts)
  return accounts.map((acct) => {
    const t = totals.get(acct.id) ?? { debit: 0, credit: 0 };
    return {
      account_id: acct.id,
      code: acct.code,
      name: acct.name,
      account_type: acct.account_type,
      debit_total: t.debit,
      credit_total: t.credit,
      balance: naturalBalance(acct.account_type, t.debit, t.credit),
    };
  });
}

/**
 * General ledger (총계정원장) for a specific account: all journal lines with running balance.
 */
export async function getGeneralLedger(
  companyId: string,
  accountId: string,
  dateRange?: { from?: string; to?: string }
): Promise<GeneralLedgerLine[]> {
  // Verify account belongs to company
  const { data: account, error: accountError } = await db
    .from('chart_of_accounts')
    .select('account_type')
    .eq('id', accountId)
    .eq('company_id', companyId)
    .single();

  if (accountError || !account) {
    throw new Error(`Account not found: ${accountError?.message ?? accountId}`);
  }

  const accountType = (account as unknown as { account_type: AccountType }).account_type;

  // Fetch lines with entry info, ordered by date then created_at
  let query = db
    .from('journal_lines')
    .select('id, entry_id, debit, credit, description, journal_entries!inner(company_id, entry_date, description, created_at)')
    .eq('account_id', accountId)
    .eq('journal_entries.company_id', companyId);

  if (dateRange?.from) {
    query = query.gte('journal_entries.entry_date', dateRange.from);
  }
  if (dateRange?.to) {
    query = query.lte('journal_entries.entry_date', dateRange.to);
  }

  // Order by entry date ascending for running balance
  query = query.order('journal_entries(entry_date)', { ascending: true });

  const { data: lines, error } = await query;

  if (error) throw new Error(`Failed to fetch general ledger: ${error.message}`);

  // Build ledger with running balance
  let runningBalance = 0;

  return ((lines ?? []) as unknown[]).map((row: unknown) => {
    const line = row as Record<string, unknown>;
    const entry = line.journal_entries as Record<string, unknown>;
    const debit = Number(line.debit);
    const credit = Number(line.credit);

    // Running balance follows natural direction
    if (accountType === 'asset' || accountType === 'expense') {
      runningBalance += debit - credit;
    } else {
      runningBalance += credit - debit;
    }

    return {
      id: line.id as string,
      entry_id: line.entry_id as string,
      entry_date: entry.entry_date as string,
      entry_description: entry.description as string,
      debit,
      credit,
      line_description: (line.description as string) ?? '',
      running_balance: runningBalance,
    };
  });
}
