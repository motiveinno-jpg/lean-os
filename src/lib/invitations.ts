/**
 * LeanOS Partner Invitations
 * 파트너 초대 생성/수락/만료
 */
import { supabase } from './supabase';
const db = supabase as any;

export async function createInvitation(params: {
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
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function getInvitations(companyId: string) {
  const { data } = await db
    .from('partner_invitations')
    .select('*, deals(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  return data || [];
}

export async function acceptInvitation(token: string) {
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

export async function cancelInvitation(invitationId: string) {
  const { error } = await db
    .from('partner_invitations')
    .update({ status: 'cancelled' })
    .eq('id', invitationId);
  if (error) throw error;
}
