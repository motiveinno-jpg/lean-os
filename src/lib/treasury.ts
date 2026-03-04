import { supabase } from './supabase';

// ── Treasury Engine ──
// 회사 자산(주식, 코인, 외화, 채권 등) 포지션 관리

export const ASSET_TYPES: Record<string, { label: string; color: string }> = {
  stock: { label: '주식', color: '#22c55e' },
  crypto: { label: '암호화폐', color: '#f59e0b' },
  forex: { label: '외화', color: '#3b82f6' },
  bond: { label: '채권', color: '#8b5cf6' },
  deposit: { label: '정기예금', color: '#06b6d4' },
  other: { label: '기타', color: '#6b7280' },
};

export const TX_TYPES: Record<string, string> = {
  buy: '매수',
  sell: '매도',
  dividend: '배당',
  interest: '이자',
  deposit: '예치',
  withdraw: '인출',
};

export interface PortfolioSummary {
  totalInvested: number;
  totalCurrentValue: number;
  totalPnL: number;
  pnLPercent: number;
  byType: Array<{
    type: string;
    label: string;
    color: string;
    invested: number;
    currentValue: number;
    pnl: number;
    count: number;
  }>;
}

export function calculatePortfolio(positions: any[]): PortfolioSummary {
  let totalInvested = 0;
  let totalCurrentValue = 0;

  const typeMap = new Map<string, { invested: number; currentValue: number; count: number }>();

  for (const pos of positions) {
    const qty = Number(pos.quantity || 0);
    const avgP = Number(pos.avg_price || 0);
    const curP = Number(pos.current_price || 0);
    const invested = qty * avgP;
    const currentValue = qty * curP;

    totalInvested += invested;
    totalCurrentValue += currentValue;

    const type = pos.asset_type || 'other';
    const existing = typeMap.get(type) || { invested: 0, currentValue: 0, count: 0 };
    existing.invested += invested;
    existing.currentValue += currentValue;
    existing.count++;
    typeMap.set(type, existing);
  }

  const byType = Array.from(typeMap.entries()).map(([type, data]) => ({
    type,
    label: ASSET_TYPES[type]?.label || type,
    color: ASSET_TYPES[type]?.color || '#6b7280',
    invested: Math.round(data.invested),
    currentValue: Math.round(data.currentValue),
    pnl: Math.round(data.currentValue - data.invested),
    count: data.count,
  })).sort((a, b) => b.currentValue - a.currentValue);

  const totalPnL = totalCurrentValue - totalInvested;
  const pnLPercent = totalInvested > 0 ? (totalPnL / totalInvested) * 100 : 0;

  return {
    totalInvested: Math.round(totalInvested),
    totalCurrentValue: Math.round(totalCurrentValue),
    totalPnL: Math.round(totalPnL),
    pnLPercent: Math.round(pnLPercent * 10) / 10,
    byType,
  };
}

export async function createPosition(params: {
  companyId: string;
  assetType: string;
  name: string;
  ticker?: string;
  currency?: string;
  quantity?: number;
  avgPrice?: number;
  currentPrice?: number;
}) {
  const { data, error } = await supabase
    .from('treasury_positions')
    .insert({
      company_id: params.companyId,
      asset_type: params.assetType,
      name: params.name,
      ticker: params.ticker,
      currency: params.currency || 'KRW',
      quantity: params.quantity || 0,
      avg_price: params.avgPrice || 0,
      current_price: params.currentPrice || 0,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function updatePosition(id: string, updates: Record<string, any>) {
  const { error } = await supabase
    .from('treasury_positions')
    .update(updates)
    .eq('id', id);
  if (error) throw error;
}

export async function deletePosition(id: string) {
  // Delete related transactions first
  await supabase.from('treasury_transactions').delete().eq('position_id', id);
  const { error } = await supabase.from('treasury_positions').delete().eq('id', id);
  if (error) throw error;
}

export async function addTransaction(params: {
  positionId: string;
  type: string;
  date: string;
  quantity?: number;
  price?: number;
  amount: number;
}) {
  const { data, error } = await supabase
    .from('treasury_transactions')
    .insert({
      position_id: params.positionId,
      type: params.type,
      date: params.date,
      quantity: params.quantity,
      price: params.price,
      amount: params.amount,
    })
    .select()
    .single();
  if (error) throw error;
  return data;
}
