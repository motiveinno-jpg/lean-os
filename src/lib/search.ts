import { supabase } from './supabase';

// ── Global Search (pg_trgm GIN) ──

export interface GlobalSearchResult {
  deals: any[];
  documents: any[];
  partners: any[];
  taxInvoices: any[];
  bankTransactions: any[];
  chatMessages: any[];
  employees: any[];
  totalCount: number;
}

const EMPTY_RESULT: GlobalSearchResult = {
  deals: [],
  documents: [],
  partners: [],
  taxInvoices: [],
  bankTransactions: [],
  chatMessages: [],
  employees: [],
  totalCount: 0,
};

export async function globalSearch(
  companyId: string,
  query: string,
): Promise<GlobalSearchResult> {
  if (!query || query.length < 2) return { ...EMPTY_RESULT };

  const pattern = `%${query}%`;

  const [deals, documents, partners, taxInvoices, bankTransactions, chatMessages, employees] =
    await Promise.all([
      supabase
        .from('deals')
        .select('id, name, status, classification')
        .eq('company_id', companyId)
        .ilike('name', pattern)
        .limit(5),

      supabase
        .from('documents')
        .select('id, name, status, deal_id')
        .eq('company_id', companyId)
        .ilike('name', pattern)
        .limit(5),

      supabase
        .from('partners')
        .select('id, name, type, contact_name')
        .eq('company_id', companyId)
        .ilike('name', pattern)
        .limit(5),

      supabase
        .from('tax_invoices')
        .select('id, counterparty_name, type, total_amount, issue_date')
        .eq('company_id', companyId)
        .ilike('counterparty_name', pattern)
        .limit(5),

      supabase
        .from('bank_transactions')
        .select('id, counterparty, amount, transaction_date, type')
        .eq('company_id', companyId)
        .ilike('counterparty', pattern)
        .limit(5),

      // chat_messages: no company_id column — RLS handles access control
      supabase
        .from('chat_messages')
        .select('id, content, channel_id, created_at')
        .ilike('content', pattern)
        .limit(5),

      supabase
        .from('employees')
        .select('id, name, status, salary')
        .eq('company_id', companyId)
        .ilike('name', pattern)
        .limit(5),
    ]);

  const d = deals.data ?? [];
  const doc = documents.data ?? [];
  const p = partners.data ?? [];
  const ti = taxInvoices.data ?? [];
  const bt = bankTransactions.data ?? [];
  const cm = chatMessages.data ?? [];
  const emp = employees.data ?? [];

  return {
    deals: d,
    documents: doc,
    partners: p,
    taxInvoices: ti,
    bankTransactions: bt,
    chatMessages: cm,
    employees: emp,
    totalCount: d.length + doc.length + p.length + ti.length + bt.length + cm.length + emp.length,
  };
}
