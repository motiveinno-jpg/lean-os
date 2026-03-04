/**
 * LeanOS AI Pending Actions
 * 대기 액션 승인/거부
 */
import { supabase } from './supabase';
const db = supabase as any;

export async function getPendingActions(companyId: string) {
  const { data } = await db
    .from('ai_pending_actions')
    .select('*, users:user_id(name, email)')
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .order('created_at', { ascending: false });
  return data || [];
}

export async function getAllActions(companyId: string, limit = 50) {
  const { data } = await db
    .from('ai_pending_actions')
    .select('*, users:user_id(name, email), approver:approved_by(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}

export async function approveAction(actionId: string, approverId: string) {
  // Get the action details
  const { data: action } = await db
    .from('ai_pending_actions')
    .select('*')
    .eq('id', actionId)
    .single();

  if (!action) throw new Error('Action not found');

  // Execute the action based on type
  if (action.action_type === 'delete') {
    await supabase
      .from(action.entity_type)
      .delete()
      .eq('id', action.entity_id);
  } else if (action.action_type === 'update_financials') {
    await supabase
      .from(action.entity_type)
      .update(action.payload.updates)
      .eq('id', action.entity_id);
  }

  // Mark as approved
  const { error } = await db
    .from('ai_pending_actions')
    .update({
      status: 'approved',
      approved_by: approverId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', actionId);
  if (error) throw error;
}

export async function rejectAction(actionId: string, approverId: string) {
  const { error } = await db
    .from('ai_pending_actions')
    .update({
      status: 'rejected',
      approved_by: approverId,
      decided_at: new Date().toISOString(),
    })
    .eq('id', actionId);
  if (error) throw error;
}

export async function getAiHistory(companyId: string, limit = 100) {
  const { data } = await db
    .from('ai_interactions')
    .select('*, users:user_id(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false })
    .limit(limit);
  return data || [];
}
