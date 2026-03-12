/**
 * OwnerView 견적서 열람/승인 추적 (Quote Viewing & Approval Tracking)
 * 견적서 공유 → 열람 → 승인/거부 흐름 추적
 */

import { supabase } from './supabase';

const db = supabase as any;

// ── Quote Tracking Status Constants ──

export const QUOTE_TRACKING_STATUS = [
  { value: 'sent', label: '발송됨', bg: 'bg-blue-500/10', text: 'text-blue-500', dot: 'bg-blue-400', icon: '📤' },
  { value: 'viewed', label: '열람됨', bg: 'bg-yellow-500/10', text: 'text-yellow-600', dot: 'bg-yellow-400', icon: '👁' },
  { value: 'approved', label: '승인', bg: 'bg-green-500/10', text: 'text-green-600', dot: 'bg-green-500', icon: '✅' },
  { value: 'rejected', label: '거부', bg: 'bg-red-500/10', text: 'text-red-500', dot: 'bg-red-400', icon: '❌' },
  { value: 'expired', label: '만료', bg: 'bg-gray-500/10', text: 'text-gray-400', dot: 'bg-gray-300', icon: '⏰' },
] as const;

export type QuoteTrackingStatus = typeof QUOTE_TRACKING_STATUS[number]['value'];

export function getQuoteStatusInfo(status: string) {
  return QUOTE_TRACKING_STATUS.find(s => s.value === status) || QUOTE_TRACKING_STATUS[0];
}

// ── Token Generation ──

function generateTrackingToken(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let token = '';
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  for (let i = 0; i < array.length; i++) {
    token += chars[array[i] % chars.length];
  }
  return token;
}

// ── Interfaces ──

export interface QuoteShareParams {
  companyId: string;
  documentId: string;
  quoteTitle: string;
  recipientName: string;
  recipientEmail: string;
  recipientCompany?: string;
  totalAmount?: number;
  currency?: string;
  validUntil?: string; // ISO date string
  createdBy: string;
  note?: string;
}

export interface QuoteTrackingRecord {
  id: string;
  company_id: string;
  document_id: string;
  quote_title: string;
  recipient_name: string;
  recipient_email: string;
  recipient_company: string | null;
  total_amount: number | null;
  currency: string;
  status: QuoteTrackingStatus;
  tracking_token: string;
  valid_until: string | null;
  sent_at: string;
  viewed_at: string | null;
  responded_at: string | null;
  response_note: string | null;
  view_count: number;
  last_viewed_at: string | null;
  created_by: string;
  note: string | null;
  created_at: string;
  updated_at: string;
}

export interface QuoteTrackingSummary {
  total: number;
  sent: number;
  viewed: number;
  approved: number;
  rejected: number;
  expired: number;
  approvalRate: number;
  averageViewTimeHours: number | null;
}

// ── Create Quote Share ──

export async function createQuoteShare(params: QuoteShareParams): Promise<QuoteTrackingRecord> {
  const trackingToken = generateTrackingToken();
  const now = new Date().toISOString();

  // Default validity: 30 days from now
  const defaultValidUntil = new Date();
  defaultValidUntil.setDate(defaultValidUntil.getDate() + 30);

  const record = {
    company_id: params.companyId,
    document_id: params.documentId,
    quote_title: params.quoteTitle,
    recipient_name: params.recipientName,
    recipient_email: params.recipientEmail,
    recipient_company: params.recipientCompany || null,
    total_amount: params.totalAmount ?? null,
    currency: params.currency || 'KRW',
    status: 'sent' as const,
    tracking_token: trackingToken,
    valid_until: params.validUntil || defaultValidUntil.toISOString(),
    sent_at: now,
    viewed_at: null,
    responded_at: null,
    response_note: null,
    view_count: 0,
    last_viewed_at: null,
    created_by: params.createdBy,
    note: params.note || null,
  };

  const { data, error } = await db
    .from('quote_tracking')
    .insert(record)
    .select()
    .single();

  if (error) throw error;
  return data as QuoteTrackingRecord;
}

// ── Record Quote View ──

export async function recordQuoteView(trackingId: string): Promise<QuoteTrackingRecord> {
  const now = new Date().toISOString();

  // First, fetch current record to increment view_count
  const { data: existing, error: fetchError } = await db
    .from('quote_tracking')
    .select('*')
    .eq('id', trackingId)
    .single();

  if (fetchError) throw fetchError;
  if (!existing) throw new Error('Tracking record not found');

  // Check if quote has expired
  if (existing.valid_until && new Date(existing.valid_until) < new Date()) {
    // Auto-expire if past validity
    const { data, error } = await db
      .from('quote_tracking')
      .update({
        status: 'expired',
        updated_at: now,
      })
      .eq('id', trackingId)
      .select()
      .single();

    if (error) throw error;
    return data as QuoteTrackingRecord;
  }

  const updates: Record<string, any> = {
    view_count: (existing.view_count || 0) + 1,
    last_viewed_at: now,
    updated_at: now,
  };

  // Only update status to 'viewed' if still in 'sent' state
  // (don't downgrade from approved/rejected)
  if (existing.status === 'sent') {
    updates.status = 'viewed';
    updates.viewed_at = now;
  }

  const { data, error } = await db
    .from('quote_tracking')
    .update(updates)
    .eq('id', trackingId)
    .select()
    .single();

  if (error) throw error;
  return data as QuoteTrackingRecord;
}

// ── Record Quote View by Token (for external link access) ──

export async function recordQuoteViewByToken(trackingToken: string): Promise<QuoteTrackingRecord> {
  const { data: existing, error: fetchError } = await db
    .from('quote_tracking')
    .select('*')
    .eq('tracking_token', trackingToken)
    .single();

  if (fetchError) throw fetchError;
  if (!existing) throw new Error('Invalid tracking token');

  return recordQuoteView(existing.id);
}

// ── Record Quote Response (Approve/Reject) ──

export async function recordQuoteResponse(
  trackingId: string,
  response: 'approved' | 'rejected',
  responseNote?: string,
): Promise<QuoteTrackingRecord> {
  const now = new Date().toISOString();

  // Verify the record exists and is in a valid state for response
  const { data: existing, error: fetchError } = await db
    .from('quote_tracking')
    .select('*')
    .eq('id', trackingId)
    .single();

  if (fetchError) throw fetchError;
  if (!existing) throw new Error('Tracking record not found');

  // Cannot respond to expired quotes
  if (existing.status === 'expired') {
    throw new Error('이 견적서는 유효기간이 만료되었습니다.');
  }

  // Cannot change response once already responded
  if (existing.status === 'approved' || existing.status === 'rejected') {
    throw new Error('이미 응답이 완료된 견적서입니다.');
  }

  // Check expiry
  if (existing.valid_until && new Date(existing.valid_until) < new Date()) {
    await db
      .from('quote_tracking')
      .update({ status: 'expired', updated_at: now })
      .eq('id', trackingId);
    throw new Error('이 견적서는 유효기간이 만료되었습니다.');
  }

  const { data, error } = await db
    .from('quote_tracking')
    .update({
      status: response,
      responded_at: now,
      response_note: responseNote || null,
      // If they never viewed before responding (edge case), set viewed_at too
      viewed_at: existing.viewed_at || now,
      updated_at: now,
    })
    .eq('id', trackingId)
    .select()
    .single();

  if (error) throw error;
  return data as QuoteTrackingRecord;
}

// ── Record Quote Response by Token ──

export async function recordQuoteResponseByToken(
  trackingToken: string,
  response: 'approved' | 'rejected',
  responseNote?: string,
): Promise<QuoteTrackingRecord> {
  const { data: existing, error: fetchError } = await db
    .from('quote_tracking')
    .select('*')
    .eq('tracking_token', trackingToken)
    .single();

  if (fetchError) throw fetchError;
  if (!existing) throw new Error('Invalid tracking token');

  return recordQuoteResponse(existing.id, response, responseNote);
}

// ── Get Quote Tracking List ──

export async function getQuoteTrackingList(
  companyId: string,
  filters?: {
    status?: QuoteTrackingStatus;
    recipientEmail?: string;
    documentId?: string;
    dateFrom?: string;
    dateTo?: string;
  },
): Promise<QuoteTrackingRecord[]> {
  let query = db
    .from('quote_tracking')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });

  if (filters?.status) {
    query = query.eq('status', filters.status);
  }
  if (filters?.recipientEmail) {
    query = query.eq('recipient_email', filters.recipientEmail);
  }
  if (filters?.documentId) {
    query = query.eq('document_id', filters.documentId);
  }
  if (filters?.dateFrom) {
    query = query.gte('sent_at', filters.dateFrom);
  }
  if (filters?.dateTo) {
    query = query.lte('sent_at', filters.dateTo);
  }

  const { data, error } = await query.limit(200);
  if (error) throw error;
  return (data || []) as QuoteTrackingRecord[];
}

// ── Get Single Quote Tracking Record ──

export async function getQuoteTracking(trackingId: string): Promise<QuoteTrackingRecord | null> {
  const { data, error } = await db
    .from('quote_tracking')
    .select('*')
    .eq('id', trackingId)
    .single();

  if (error) return null;
  return data as QuoteTrackingRecord;
}

// ── Get Quote Tracking Summary ──

export async function getQuoteTrackingSummary(
  companyId: string,
  period?: { from: string; to: string },
): Promise<QuoteTrackingSummary> {
  let query = db
    .from('quote_tracking')
    .select('status, sent_at, viewed_at, responded_at')
    .eq('company_id', companyId);

  if (period?.from) query = query.gte('sent_at', period.from);
  if (period?.to) query = query.lte('sent_at', period.to);

  const { data, error } = await query;
  if (error) throw error;

  const records = (data || []) as Array<{
    status: string;
    sent_at: string;
    viewed_at: string | null;
    responded_at: string | null;
  }>;

  const total = records.length;
  const sent = records.filter(r => r.status === 'sent').length;
  const viewed = records.filter(r => r.status === 'viewed').length;
  const approved = records.filter(r => r.status === 'approved').length;
  const rejected = records.filter(r => r.status === 'rejected').length;
  const expired = records.filter(r => r.status === 'expired').length;

  // Approval rate = approved / (approved + rejected), ignoring pending/viewed
  const responded = approved + rejected;
  const approvalRate = responded > 0 ? (approved / responded) * 100 : 0;

  // Average time from sent to first view (in hours)
  const viewTimes = records
    .filter(r => r.viewed_at && r.sent_at)
    .map(r => {
      const sentTime = new Date(r.sent_at).getTime();
      const viewTime = new Date(r.viewed_at!).getTime();
      return (viewTime - sentTime) / (1000 * 60 * 60); // hours
    });

  const averageViewTimeHours = viewTimes.length > 0
    ? Math.round((viewTimes.reduce((a, b) => a + b, 0) / viewTimes.length) * 10) / 10
    : null;

  return {
    total,
    sent,
    viewed,
    approved,
    rejected,
    expired,
    approvalRate: Math.round(approvalRate * 10) / 10,
    averageViewTimeHours,
  };
}

// ── Expire Overdue Quotes (batch operation) ──

export async function expireOverdueQuotes(companyId: string): Promise<number> {
  const now = new Date().toISOString();

  const { data, error } = await db
    .from('quote_tracking')
    .update({ status: 'expired', updated_at: now })
    .eq('company_id', companyId)
    .in('status', ['sent', 'viewed'])
    .lt('valid_until', now)
    .select('id');

  if (error) throw error;
  return (data || []).length;
}

// ── Generate Tracking URL ──

export function generateQuoteTrackingUrl(trackingToken: string, baseUrl?: string): string {
  const base = baseUrl || (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}/quote/view?token=${trackingToken}`;
}

// ── Format Helpers ──

export function formatQuoteAmount(amount: number | null, currency: string = 'KRW'): string {
  if (amount === null || amount === undefined) return '-';
  if (currency === 'KRW') {
    return `₩${amount.toLocaleString('ko-KR')}`;
  }
  if (currency === 'USD') {
    return `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
  }
  return `${amount.toLocaleString()} ${currency}`;
}

export function formatTimeSince(dateStr: string | null): string {
  if (!dateStr) return '-';
  const now = new Date();
  const date = new Date(dateStr);
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / (1000 * 60));
  const diffHour = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDay = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMin < 1) return '방금 전';
  if (diffMin < 60) return `${diffMin}분 전`;
  if (diffHour < 24) return `${diffHour}시간 전`;
  if (diffDay < 30) return `${diffDay}일 전`;
  return date.toLocaleDateString('ko-KR');
}
