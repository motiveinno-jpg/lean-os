/**
 * OwnerView Document Intelligence
 * 문서유형 자동분류 + 계약서 필드 추출 (규칙 기반)
 */
import { supabase } from './supabase';

// Use any cast for columns not in generated types yet
const db = supabase as any;

// Document types and classification rules
export const DOC_INTEL_TYPES = [
  { value: 'contract', label: '계약서', keywords: ['계약', 'contract', '약정', '합의'], color: 'bg-blue-500/10 text-blue-400' },
  { value: 'invoice', label: '청구서/인보이스', keywords: ['인보이스', 'invoice', '청구', 'bill'], color: 'bg-green-500/10 text-green-400' },
  { value: 'receipt', label: '영수증', keywords: ['영수증', 'receipt', '결제'], color: 'bg-emerald-500/10 text-emerald-400' },
  { value: 'proposal', label: '제안서', keywords: ['제안', 'proposal', '견적', 'quotation'], color: 'bg-orange-500/10 text-orange-400' },
  { value: 'report', label: '보고서', keywords: ['보고서', 'report', '분석', '리뷰'], color: 'bg-cyan-500/10 text-cyan-400' },
  { value: 'certificate', label: '증명서/인증서', keywords: ['증명', 'certificate', '인증', '확인서'], color: 'bg-yellow-500/10 text-yellow-400' },
  { value: 'nda', label: 'NDA/비밀유지', keywords: ['비밀유지', 'nda', 'confidential', '기밀'], color: 'bg-red-500/10 text-red-400' },
  { value: 'mou', label: 'MOU/양해각서', keywords: ['양해각서', 'mou', 'memorandum'], color: 'bg-purple-500/10 text-purple-400' },
  { value: 'other', label: '기타', keywords: [], color: 'bg-gray-500/10 text-gray-400' },
] as const;

// Auto-classify document based on name and content
export function classifyDocument(name: string, content?: string): string {
  const text = `${name} ${content || ''}`.toLowerCase();
  for (const dtype of DOC_INTEL_TYPES) {
    if (dtype.keywords.some(kw => text.includes(kw.toLowerCase()))) {
      return dtype.value;
    }
  }
  return 'other';
}

// Get label and color for a classification type
export function getDocTypeInfo(typeValue: string) {
  return DOC_INTEL_TYPES.find(t => t.value === typeValue) || DOC_INTEL_TYPES[DOC_INTEL_TYPES.length - 1];
}

// Extract contract fields from text (rule-based)
export function extractContractFields(text: string): {
  startDate?: string;
  endDate?: string;
  amount?: number;
  parties?: string[];
} {
  const result: any = {};

  // Date patterns (YYYY-MM-DD, YYYY.MM.DD, YYYY년 MM월 DD일)
  const datePattern = /(\d{4})[-.년]\s*(\d{1,2})[-.월]\s*(\d{1,2})[일]?/g;
  const dates: string[] = [];
  let match;
  while ((match = datePattern.exec(text)) !== null) {
    dates.push(`${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`);
  }
  if (dates.length >= 2) {
    result.startDate = dates[0];
    result.endDate = dates[1];
  } else if (dates.length === 1) {
    result.startDate = dates[0];
  }

  // Amount patterns
  const amountPattern = /(?:₩|원|KRW|금액|계약금액|총액)[:\s]*([0-9,]+)/i;
  const amtMatch = text.match(amountPattern);
  if (amtMatch) {
    result.amount = parseInt(amtMatch[1].replace(/,/g, ''), 10);
  }

  return result;
}

// Save classification and extracted fields
export async function saveDocumentIntelligence(documentId: string, params: {
  autoClassifiedType?: string;
  extractedFields?: any;
  fullText?: string;
  contractStartDate?: string;
  contractEndDate?: string;
  contractAmount?: number;
  partnerId?: string;
}) {
  const { error } = await db
    .from('documents')
    .update({
      auto_classified_type: params.autoClassifiedType || null,
      extracted_fields: params.extractedFields || null,
      full_text: params.fullText || null,
      contract_start_date: params.contractStartDate || null,
      contract_end_date: params.contractEndDate || null,
      contract_amount: params.contractAmount || null,
      partner_id: params.partnerId || null,
    })
    .eq('id', documentId);
  if (error) throw error;
}

// Get documents with intelligence data
export async function getDocumentsWithIntelligence(companyId: string, type?: string) {
  let query = db
    .from('documents')
    .select('*, partners(name)')
    .eq('company_id', companyId)
    .order('created_at', { ascending: false });
  if (type) query = query.eq('auto_classified_type', type);
  const { data } = await query;
  return data || [];
}

// Get contract documents only
export async function getContractDocuments(companyId: string) {
  const { data } = await db
    .from('documents')
    .select('*, partners(name)')
    .eq('company_id', companyId)
    .eq('auto_classified_type', 'contract')
    .order('contract_end_date', { ascending: true });
  return data || [];
}

// Search documents by full text
export async function searchDocuments(companyId: string, searchTerm: string) {
  const { data } = await db
    .from('documents')
    .select('*')
    .eq('company_id', companyId)
    .or(`name.ilike.%${searchTerm}%,full_text.ilike.%${searchTerm}%`)
    .order('created_at', { ascending: false })
    .limit(50);
  return data || [];
}
