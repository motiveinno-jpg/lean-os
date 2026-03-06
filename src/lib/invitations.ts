/**
 * Reflect Invitations (Partner + Employee)
 */
import { supabase } from './supabase';
const db = supabase as any;

// ── Partner Invitations ──

export async function createPartnerInvitation(params: {
  companyId: string;
  dealId?: string;
  email: string;
  name?: string;
}) {
  const { data, error } = await db
    .from('partner_invitations')
    .insert({
      company_id: params.companyId,
      deal_id: params.dealId || null,
      email: params.email,
      name: params.name || null,
      role: 'partner',
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getPartnerInvitations(companyId: string) {
  const { data } = await db
    .from('partner_invitations')
    .select('*, deals(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function acceptPartnerInvitation(token: string) {
  const { data, error } = await db
    .from('partner_invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('invite_token', token)
    .eq('status', 'pending')
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function cancelPartnerInvitation(invitationId: string) {
  const { error } = await db
    .from('partner_invitations')
    .update({ status: 'cancelled' })
    .eq('id', invitationId);
  if (error) throw error;
}

// ── Employee Invitations ──

export async function createEmployeeInvitation(params: {
  companyId: string;
  email: string;
  name?: string;
  role?: 'employee' | 'admin';
  invitedBy: string;
}) {
  const { data, error } = await db
    .from('employee_invitations')
    .insert({
      company_id: params.companyId,
      email: params.email,
      name: params.name || null,
      role: params.role || 'employee',
      invited_by: params.invitedBy,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getEmployeeInvitations(companyId: string) {
  const { data } = await db
    .from('employee_invitations')
    .select('*')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function acceptEmployeeInvitation(token: string) {
  const { data, error } = await db
    .from('employee_invitations')
    .update({ status: 'accepted', accepted_at: new Date().toISOString() })
    .eq('invite_token', token)
    .eq('status', 'pending')
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function cancelEmployeeInvitation(invitationId: string) {
  const { error } = await db
    .from('employee_invitations')
    .update({ status: 'cancelled' })
    .eq('id', invitationId);
  if (error) throw error;
}

// ── Validate Invitation Token ──

export async function validateInviteToken(token: string): Promise<{
  type: 'partner' | 'employee';
  data: any;
} | null> {
  // Check partner invitations first
  const { data: pi } = await db
    .from('partner_invitations')
    .select('*')
    .eq('invite_token', token)
    .eq('status', 'pending')
    .single();
  if (pi) {
    if (pi.expires_at && new Date(pi.expires_at) < new Date()) return null;
    return { type: 'partner', data: pi };
  }

  // Check employee invitations
  const { data: ei } = await db
    .from('employee_invitations')
    .select('*')
    .eq('invite_token', token)
    .eq('status', 'pending')
    .single();
  if (ei) {
    if (ei.expires_at && new Date(ei.expires_at) < new Date()) return null;
    return { type: 'employee', data: ei };
  }

  return null;
}

// ── Get Invite URL ──

export function getInviteUrl(token: string): string {
  const base = typeof window !== 'undefined' ? window.location.origin : '';
  return `${base}/lean-os/invite/?token=${token}`;
}
