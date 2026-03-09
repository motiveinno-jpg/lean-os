/**
 * OwnerView Custom Type Aliases
 * Maps friendly type names to Supabase-generated table Row types.
 *
 * After regenerating database.ts from Supabase, this file preserves
 * all the type aliases used across the codebase.
 */

import type { Database } from './database';

// Re-export Json from database.ts
export type { Json } from './database';

// Helper: extract the Row type for a given table name
type TableRow<T extends keyof Database['public']['Tables']> =
  Database['public']['Tables'][T]['Row'];

// ── Auth / Core ──
export type User = TableRow<'users'>;
export type Company = TableRow<'companies'>;

// ── Deals ──
export type Deal = TableRow<'deals'>;
export type DealNode = TableRow<'deal_nodes'>;
export type SubDeal = TableRow<'sub_deals'>;
export type DealMilestone = TableRow<'deal_milestones'>;
export type DealAssignment = TableRow<'deal_assignments'>;
export type DealClassification = TableRow<'deal_classifications'>;

// ── Finance ──
export type CashSnapshot = TableRow<'cash_snapshot'>;
export type BankAccount = TableRow<'bank_accounts'>;
export type Transaction = TableRow<'transactions'>;
export type DealRevenueSchedule = TableRow<'deal_revenue_schedule'>;
export type DealCostSchedule = TableRow<'deal_cost_schedule'>;
export type PaymentQueue = TableRow<'payment_queue'>;
export type TaxInvoice = TableRow<'tax_invoices'>;
export type RoutingRule = TableRow<'routing_rules'>;
export type CorporateCard = TableRow<'corporate_cards'>;
export type CardTransaction = TableRow<'card_transactions'>;

// ── Documents ──
export type DocTemplate = TableRow<'doc_templates'>;

// ── Chat ──
export type ChatChannel = TableRow<'chat_channels'>;
export type ChatMessage = TableRow<'chat_messages'>;
export type ChatParticipant = TableRow<'chat_participants'>;

// ── Vault ──
export type VaultAccount = TableRow<'vault_accounts'>;
export type VaultAsset = TableRow<'vault_assets'>;
export type VaultDoc = TableRow<'vault_docs'>;

// ── Discovery ──
export type AutoDiscoveryResult = TableRow<'auto_discovery_results'>;

// ── Closing ──
export type ClosingChecklist = TableRow<'closing_checklists'>;
export type ClosingChecklistItem = TableRow<'closing_checklist_items'>;

// ── Loans ──
export type Loan = TableRow<'loans'>;
export type LoanPayment = TableRow<'loan_payments'>;

// ── Certificates ──
export type CertificateLog = TableRow<'certificate_logs'>;

// ── Audit / Partners ──
export type AuditLog = TableRow<'audit_logs'>;
export type Partner = TableRow<'partners'>;
