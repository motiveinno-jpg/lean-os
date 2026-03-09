/**
 * OwnerView Partner CRM Library
 * 거래처(파트너) 관리 — 조회, 생성/수정, 검색, 딜 연동 자동 생성
 */

import { supabase } from './supabase';

// ── Types ──

export interface PartnerFilters {
  type?: string;
  isActive?: boolean;
  search?: string;
  tags?: string[];
}

export interface UpsertPartnerParams {
  id?: string;
  companyId: string;
  name: string;
  type?: string;
  classification?: string;
  businessNumber?: string;
  representative?: string;
  contactName?: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  bankName?: string;
  accountNumber?: string;
  tags?: string[];
  notes?: string;
  isActive?: boolean;
  sourceDealId?: string;
}

// ── List partners ──

export async function getPartners(companyId: string, filters?: PartnerFilters) {
  let query = supabase
    .from('partners')
    .select('*, deals(name)')
    .eq('company_id', companyId);

  if (filters?.search) {
    query = query.ilike('name', `%${filters.search}%`);
  }

  if (filters?.type) {
    query = query.eq('type', filters.type);
  }

  if (filters?.isActive !== undefined) {
    query = query.eq('is_active', filters.isActive);
  }

  if (filters?.tags && filters.tags.length > 0) {
    query = query.contains('tags', filters.tags);
  }

  query = query.order('name', { ascending: true });

  const { data } = await query;
  return data || [];
}

// ── Get single partner ──

export async function getPartner(id: string) {
  const { data, error } = await supabase
    .from('partners')
    .select('*, deals(name)')
    .eq('id', id)
    .single();

  if (error) throw error;
  return data;
}

// ── Create or update partner ──

export async function upsertPartner(params: UpsertPartnerParams) {
  const row: any = {
    company_id: params.companyId,
    name: params.name,
  };

  if (params.id) row.id = params.id;
  if (params.type !== undefined) row.type = params.type;
  if (params.classification !== undefined) row.classification = params.classification;
  if (params.businessNumber !== undefined) row.business_number = params.businessNumber;
  if (params.representative !== undefined) row.representative = params.representative;
  if (params.contactName !== undefined) row.contact_name = params.contactName;
  if (params.contactEmail !== undefined) row.contact_email = params.contactEmail;
  if (params.contactPhone !== undefined) row.contact_phone = params.contactPhone;
  if (params.address !== undefined) row.address = params.address;
  if (params.bankName !== undefined) row.bank_name = params.bankName;
  if (params.accountNumber !== undefined) row.account_number = params.accountNumber;
  if (params.tags !== undefined) row.tags = params.tags;
  if (params.notes !== undefined) row.notes = params.notes;
  if (params.isActive !== undefined) row.is_active = params.isActive;
  if (params.sourceDealId !== undefined) row.source_deal_id = params.sourceDealId;

  const { data, error } = await supabase
    .from('partners')
    .upsert(row)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── Delete partner ──

export async function deletePartner(id: string) {
  const { error } = await supabase
    .from('partners')
    .delete()
    .eq('id', id);

  if (error) throw error;
}

// ── Auto-create partner from deal counterparty ──

export async function autoCreatePartnerFromDeal(
  companyId: string,
  dealId: string,
  counterpartyName: string,
  businessNumber?: string,
) {
  // Check if partner with same name already exists for this company
  const { data: existing } = await supabase
    .from('partners')
    .select('*')
    .eq('company_id', companyId)
    .eq('name', counterpartyName)
    .maybeSingle();

  if (existing) return existing;

  // Create new partner linked to the deal
  const row: any = {
    company_id: companyId,
    name: counterpartyName,
    type: 'client',
    source_deal_id: dealId,
    is_active: true,
  };

  if (businessNumber) row.business_number = businessNumber;

  const { data, error } = await supabase
    .from('partners')
    .insert(row)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// ── Full-text search partners (pg_trgm) ──

export async function searchPartners(companyId: string, query: string) {
  const pattern = `%${query}%`;

  const { data } = await supabase
    .from('partners')
    .select('*')
    .eq('company_id', companyId)
    .or(
      `name.ilike.${pattern},contact_name.ilike.${pattern},contact_email.ilike.${pattern},business_number.ilike.${pattern}`,
    )
    .order('name', { ascending: true })
    .limit(20);

  return data || [];
}
