/**
 * OwnerView Invitations (Partner + Employee)
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
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const { data, error } = await db
    .from('partner_invitations')
    .insert({
      company_id: params.companyId,
      deal_id: params.dealId || null,
      email: params.email,
      name: params.name || null,
      role: 'partner',
      expires_at: expiresAt.toISOString(),
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
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + 7);

  const { data, error } = await db
    .from('employee_invitations')
    .insert({
      company_id: params.companyId,
      email: params.email,
      name: params.name || null,
      role: params.role || 'employee',
      invited_by: params.invitedBy,
      expires_at: expiresAt.toISOString(),
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
  return `${base}/invite/?token=${token}`;
}

// ── Send Invite Email via Edge Function ──

export async function sendInviteEmail(params: {
  email: string;
  name?: string;
  role: string;
  inviteToken: string;
  companyName?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: '인증 필요' };

    const inviteUrl = getInviteUrl(params.inviteToken);
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!;

    const res = await fetch(`${supabaseUrl}/functions/v1/send-invite-email`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        email: params.email,
        name: params.name,
        role: params.role,
        inviteUrl,
        companyName: params.companyName,
      }),
    });

    const data = await res.json();
    if (!res.ok) return { success: false, error: data.error || '이메일 발송 실패' };
    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message || '이메일 발송 오류' };
  }
}
