import { supabase } from './supabase';

// ── Deal Archiving Engine ──
// 완료된 딜을 아카이브하여 대시보드/목록에서 분리

export interface ArchiveSummary {
  dealId: string;
  dealName: string;
  totalRevenue: number;
  totalCost: number;
  margin: number;
  archivedAt: string;
}

export async function archiveDeal(dealId: string): Promise<ArchiveSummary> {
  // Fetch deal data
  const { data: deal } = await supabase
    .from('deals')
    .select('*')
    .eq('id', dealId)
    .single();

  if (!deal) throw new Error('Deal not found');
  if (deal.archived_at) throw new Error('Deal already archived');

  // Calculate final P&L
  const [revResult, costResult] = await Promise.all([
    supabase.from('deal_revenue_schedule').select('amount').eq('deal_id', dealId),
    supabase.from('deal_cost_schedule').select('amount, deal_nodes!inner(deal_id)').eq('deal_nodes.deal_id', dealId),
  ]);

  const totalRevenue = (revResult.data || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const totalCost = (costResult.data || []).reduce((s, c) => s + Number(c.amount || 0), 0);
  const margin = totalRevenue > 0 ? ((totalRevenue - totalCost) / totalRevenue) * 100 : 0;

  // Mark as archived
  const archivedAt = new Date().toISOString();
  const { error } = await supabase
    .from('deals')
    .update({
      status: 'archived',
      archived_at: archivedAt,
    })
    .eq('id', dealId);

  if (error) throw error;

  // Archive related chat channels
  await supabase
    .from('chat_channels')
    .update({ is_archived: true })
    .eq('deal_id', dealId);

  return {
    dealId,
    dealName: deal.name,
    totalRevenue: Math.round(totalRevenue),
    totalCost: Math.round(totalCost),
    margin: Math.round(margin * 10) / 10,
    archivedAt,
  };
}

export async function unarchiveDeal(dealId: string) {
  const { error } = await supabase
    .from('deals')
    .update({
      status: 'active',
      archived_at: null,
    })
    .eq('id', dealId);
  if (error) throw error;

  // Unarchive related chat channels
  await supabase
    .from('chat_channels')
    .update({ is_archived: false })
    .eq('deal_id', dealId);
}

export async function getArchivedDeals(companyId: string) {
  const { data } = await supabase
    .from('deals')
    .select('*')
    .eq('company_id', companyId)
    .not('archived_at', 'is', null)
    .order('archived_at', { ascending: false });
  return data || [];
}
