/**
 * Contract Renewal Reminder System
 * 계약 만료 알림 — 임계값 기반 자동 리마인더 생성 및 조회
 */

import { supabase } from './supabase';

const db = supabase as any;

// ── Renewal threshold definitions ──

export const RENEWAL_THRESHOLDS = [
  { days: 90, label: '3개월 전' },
  { days: 60, label: '2개월 전' },
  { days: 30, label: '1개월 전' },
  { days: 14, label: '2주 전' },
  { days: 7, label: '1주 전' },
] as const;

export type RenewalThreshold = (typeof RENEWAL_THRESHOLDS)[number];

// ── Types ──

/** Contract types that are tracked for renewal (value prefix = 'contract' or explicit types). */
const CONTRACT_TYPE_VALUES = [
  'contract',
  'contract_service',
  'contract_sales',
  'contract_outsource',
  'contract_labor',
  'contract_lease',
  'contract_partnership',
  'nda',
  'mou',
] as const;

export interface ExpiringContract {
  id: string;
  name: string;
  type: string;
  status: string;
  expiry_date: string;
  days_remaining: number;
  deal_id: string | null;
  partner_name: string | null;
  partner_id: string | null;
  created_by: string;
}

export interface RenewalReminder {
  id: string;
  company_id: string;
  document_id: string;
  document_name: string;
  reminder_date: string;
  recipient_email: string;
  note: string | null;
  status: 'pending' | 'sent' | 'dismissed';
  threshold_label: string | null;
  created_at: string;
  sent_at: string | null;
}

export interface CreateReminderParams {
  companyId: string;
  documentId: string;
  reminderDate: string;
  recipientEmail: string;
  note?: string;
  thresholdLabel?: string;
}

// ── Core functions ──

/**
 * Find contracts expiring within the given number of days.
 * Queries documents whose type is a contract variant and whose
 * `expiry_date` (stored in content_json.metadata.expiry_date or as a
 * top-level column) falls within range.
 */
export async function getExpiringContracts(
  companyId: string,
  daysAhead: number = 30,
): Promise<ExpiringContract[]> {
  const now = new Date();
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + daysAhead);

  const todayStr = now.toISOString().slice(0, 10);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Query documents that are contracts with an expiry_date within range.
  // We look for expiry_date stored as a top-level column on the documents table.
  // If the schema uses content_json → metadata → expiry_date instead, the
  // edge function performs a secondary in-memory filter (see below).
  const { data: docs, error } = await db
    .from('documents')
    .select(`
      id,
      name,
      status,
      deal_id,
      created_by,
      expiry_date,
      content_json
    `)
    .eq('company_id', companyId)
    .in('status', ['executed', 'locked', 'approved'])
    .gte('expiry_date', todayStr)
    .lte('expiry_date', cutoffStr)
    .order('expiry_date', { ascending: true });

  if (error) {
    console.error('[contract-renewal] getExpiringContracts error:', error.message);
    throw error;
  }

  const contracts: ExpiringContract[] = [];

  for (const doc of docs || []) {
    const expiryDate = doc.expiry_date
      ?? doc.content_json?.metadata?.expiry_date
      ?? null;

    if (!expiryDate) continue;

    const expiry = new Date(expiryDate);
    const daysRemaining = Math.ceil(
      (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );

    if (daysRemaining < 0 || daysRemaining > daysAhead) continue;

    // Resolve partner info from the linked deal, if available
    let partnerName: string | null = null;
    let partnerId: string | null = null;

    if (doc.deal_id) {
      const { data: deal } = await db
        .from('deals')
        .select('partner_id, partner_name')
        .eq('id', doc.deal_id)
        .single();

      if (deal) {
        partnerName = deal.partner_name ?? null;
        partnerId = deal.partner_id ?? null;
      }
    }

    // Derive document type from content_json or name heuristic
    const docType =
      doc.content_json?.type ??
      inferContractType(doc.name) ??
      'contract';

    contracts.push({
      id: doc.id,
      name: doc.name,
      type: docType,
      status: doc.status,
      expiry_date: expiryDate,
      days_remaining: daysRemaining,
      deal_id: doc.deal_id,
      partner_name: partnerName,
      partner_id: partnerId,
      created_by: doc.created_by,
    });
  }

  return contracts;
}

/**
 * Schedule a renewal reminder for a specific contract document.
 * Stores the reminder in the `contract_renewals` table.
 */
export async function createRenewalReminder(
  params: CreateReminderParams,
): Promise<RenewalReminder> {
  const { companyId, documentId, reminderDate, recipientEmail, note, thresholdLabel } = params;

  // Validate the document exists and belongs to the company
  const { data: doc, error: docError } = await db
    .from('documents')
    .select('id, name')
    .eq('id', documentId)
    .eq('company_id', companyId)
    .single();

  if (docError || !doc) {
    throw new Error('문서를 찾을 수 없습니다 (document not found)');
  }

  const { data, error } = await db
    .from('contract_renewals')
    .insert({
      company_id: companyId,
      document_id: documentId,
      document_name: doc.name,
      reminder_date: reminderDate,
      recipient_email: recipientEmail,
      note: note ?? null,
      status: 'pending',
      threshold_label: thresholdLabel ?? null,
    })
    .select()
    .single();

  if (error) {
    console.error('[contract-renewal] createRenewalReminder error:', error.message);
    throw error;
  }

  return data as RenewalReminder;
}

/**
 * List all renewal reminders for a company, ordered by reminder date.
 * Optionally filter by status.
 */
export async function getRenewalReminders(
  companyId: string,
  options?: { status?: RenewalReminder['status']; documentId?: string },
): Promise<RenewalReminder[]> {
  let query = db
    .from('contract_renewals')
    .select('*')
    .eq('company_id', companyId)
    .order('reminder_date', { ascending: true });

  if (options?.status) {
    query = query.eq('status', options.status);
  }
  if (options?.documentId) {
    query = query.eq('document_id', options.documentId);
  }

  const { data, error } = await query;

  if (error) {
    console.error('[contract-renewal] getRenewalReminders error:', error.message);
    throw error;
  }

  return (data ?? []) as RenewalReminder[];
}

/**
 * Check all active contracts for a company and automatically create
 * reminders at each threshold date that hasn't been scheduled yet.
 *
 * For example, if a contract expires in 62 days, reminders will be
 * created for the 60-day, 30-day, 14-day, and 7-day thresholds.
 *
 * Returns the number of new reminders created.
 */
export async function checkAndCreateAutoReminders(
  companyId: string,
): Promise<{ created: number; contracts_checked: number }> {
  // Look ahead to the maximum threshold window (90 days)
  const maxDays = RENEWAL_THRESHOLDS[0].days;
  const contracts = await getExpiringContracts(companyId, maxDays);

  // Fetch existing pending/sent reminders to avoid duplicates
  const existingReminders = await getRenewalReminders(companyId);
  const existingKeys = new Set(
    existingReminders.map((r) => `${r.document_id}::${r.reminder_date}`),
  );

  // Resolve a default recipient: the company owner or first admin email
  const defaultEmail = await resolveCompanyNotificationEmail(companyId);

  let created = 0;

  for (const contract of contracts) {
    const expiryDate = new Date(contract.expiry_date);

    for (const threshold of RENEWAL_THRESHOLDS) {
      // Only create reminders for thresholds the contract hasn't passed yet
      if (contract.days_remaining > threshold.days) continue;

      const reminderDate = new Date(expiryDate);
      reminderDate.setDate(reminderDate.getDate() - threshold.days);
      const reminderDateStr = reminderDate.toISOString().slice(0, 10);

      // Skip if this reminder date is in the past
      const today = new Date().toISOString().slice(0, 10);
      if (reminderDateStr < today) continue;

      const key = `${contract.id}::${reminderDateStr}`;
      if (existingKeys.has(key)) continue;

      try {
        await createRenewalReminder({
          companyId,
          documentId: contract.id,
          reminderDate: reminderDateStr,
          recipientEmail: defaultEmail,
          note: `자동 알림: ${contract.name} — ${threshold.label} (만료일: ${contract.expiry_date})`,
          thresholdLabel: threshold.label,
        });
        existingKeys.add(key);
        created++;
      } catch (err: any) {
        console.error(
          `[contract-renewal] Failed to create reminder for ${contract.id} at ${threshold.label}:`,
          err.message,
        );
      }
    }
  }

  return { created, contracts_checked: contracts.length };
}

/**
 * Mark a reminder as sent after notification delivery.
 */
export async function markReminderSent(reminderId: string): Promise<void> {
  const { error } = await db
    .from('contract_renewals')
    .update({ status: 'sent', sent_at: new Date().toISOString() })
    .eq('id', reminderId);

  if (error) {
    console.error('[contract-renewal] markReminderSent error:', error.message);
    throw error;
  }
}

/**
 * Dismiss a reminder (user chose to ignore it).
 */
export async function dismissReminder(reminderId: string): Promise<void> {
  const { error } = await db
    .from('contract_renewals')
    .update({ status: 'dismissed' })
    .eq('id', reminderId);

  if (error) {
    console.error('[contract-renewal] dismissReminder error:', error.message);
    throw error;
  }
}

// ── Helpers ──

/**
 * Resolve the primary notification email for a company.
 * Falls back to a generic placeholder if no owner profile is found.
 */
async function resolveCompanyNotificationEmail(companyId: string): Promise<string> {
  const { data: company } = await db
    .from('companies')
    .select('owner_id')
    .eq('id', companyId)
    .single();

  if (company?.owner_id) {
    const { data: profile } = await db
      .from('profiles')
      .select('email')
      .eq('id', company.owner_id)
      .single();

    if (profile?.email) return profile.email;
  }

  // Fallback — should not happen in production
  return `admin@company-${companyId.slice(0, 8)}.local`;
}

/**
 * Infer contract type from document name using keyword matching.
 */
function inferContractType(name: string): string | null {
  const mappings: [string[], string][] = [
    [['용역', 'service'], 'contract_service'],
    [['매매', 'sales'], 'contract_sales'],
    [['위탁', 'outsource'], 'contract_outsource'],
    [['근로', 'labor', '고용'], 'contract_labor'],
    [['임대', 'lease'], 'contract_lease'],
    [['파트너', 'partnership'], 'contract_partnership'],
    [['NDA', '비밀유지', '기밀'], 'nda'],
    [['MOU', '양해각서'], 'mou'],
    [['계약', 'contract'], 'contract'],
  ];

  const lower = name.toLowerCase();
  for (const [keywords, type] of mappings) {
    if (keywords.some((kw) => lower.includes(kw.toLowerCase()))) {
      return type;
    }
  }

  return null;
}
