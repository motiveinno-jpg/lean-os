/**
 * LeanOS Monthly Closing Checklist Engine
 * 월 마감 체크리스트 생성/관리
 */

import { supabase } from './supabase';

// ── Default checklist items for a new month ──
const DEFAULT_ITEMS = [
  { title: '은행 거래내역 전체 수집 확인', description: '모든 법인통장의 거래내역이 빠짐없이 수집되었는지 확인', sort_order: 1, is_required: true },
  { title: '법인카드 거래내역 수집 확인', description: '모든 법인카드의 승인/매입 내역이 수집되었는지 확인', sort_order: 2, is_required: true },
  { title: '미매핑 거래 0건 확인', description: '은행 거래와 카드 거래 모두 분류 완료', sort_order: 3, is_required: true },
  { title: '세금계산서 대사 완료', description: '매출/매입 세금계산서와 거래내역 매칭 확인', sort_order: 4, is_required: true },
  { title: '미수금/미지급금 확인', description: '30일 이상 미수금 독촉 여부, 미지급금 기한 확인', sort_order: 5, is_required: true },
  { title: '고정비 정합성 확인', description: '임대료/급여/보험 등 고정비가 정상 지출되었는지 확인', sort_order: 6, is_required: true },
  { title: '딜별 매출/비용 정합성', description: '딜 계약금액 대비 실 입출금 확인', sort_order: 7, is_required: false },
  { title: '부가세 예수금 확인', description: '당월 부가세 예수/환급 예상액 확인', sort_order: 8, is_required: false },
  { title: '증빙 누락 확인', description: '영수증/증빙 미첨부 건수 확인 및 보완', sort_order: 9, is_required: true },
  { title: '월간 손익 리포트 생성', description: 'PDF 리포트 다운로드 및 저장', sort_order: 10, is_required: false },
];

// ── Get or create checklist for a month ──
export async function getOrCreateChecklist(companyId: string, month: string) {
  // Try to find existing
  const { data: existing } = await supabase
    .from('closing_checklists')
    .select('*, closing_checklist_items(*)')
    .eq('company_id', companyId)
    .eq('month', month)
    .maybeSingle();

  if (existing) {
    // Sort items by sort_order
    const items = (existing.closing_checklist_items || []).sort(
      (a: any, b: any) => (a.sort_order || 0) - (b.sort_order || 0)
    );
    return { ...existing, items };
  }

  // Create new checklist
  const { data: checklist, error } = await supabase
    .from('closing_checklists')
    .insert({ company_id: companyId, month, status: 'open' })
    .select()
    .single();

  if (error) throw error;

  // Insert default items
  const itemRows = DEFAULT_ITEMS.map(item => ({
    checklist_id: checklist.id,
    ...item,
  }));

  const { data: items } = await supabase
    .from('closing_checklist_items')
    .insert(itemRows)
    .select();

  return { ...checklist, items: items || [] };
}

// ── Toggle checklist item ──
export async function toggleChecklistItem(itemId: string, userId: string, completed: boolean) {
  const { error } = await supabase
    .from('closing_checklist_items')
    .update({
      is_completed: completed,
      completed_at: completed ? new Date().toISOString() : null,
      completed_by: completed ? userId : null,
    })
    .eq('id', itemId);
  if (error) throw error;
}

// ── Update evidence on item ──
export async function updateChecklistEvidence(itemId: string, evidence: {
  evidenceUrl?: string;
  evidenceNote?: string;
}) {
  const { error } = await supabase
    .from('closing_checklist_items')
    .update({
      evidence_url: evidence.evidenceUrl || null,
      evidence_note: evidence.evidenceNote || null,
    })
    .eq('id', itemId);
  if (error) throw error;
}

// ── Complete entire checklist ──
export async function completeClosingChecklist(checklistId: string, userId: string) {
  const { error } = await supabase
    .from('closing_checklists')
    .update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: userId,
    })
    .eq('id', checklistId);
  if (error) throw error;
}

// ── Get closing history ──
export async function getClosingHistory(companyId: string) {
  const { data } = await supabase
    .from('closing_checklists')
    .select('*, closing_checklist_items(id, is_completed, is_required)')
    .eq('company_id', companyId)
    .order('month', { ascending: false })
    .limit(12);

  return (data || []).map((cl: any) => {
    const items = cl.closing_checklist_items || [];
    const total = items.length;
    const completed = items.filter((i: any) => i.is_completed).length;
    const requiredTotal = items.filter((i: any) => i.is_required).length;
    const requiredCompleted = items.filter((i: any) => i.is_required && i.is_completed).length;
    return {
      ...cl,
      total,
      completed,
      requiredTotal,
      requiredCompleted,
      progress: total > 0 ? Math.round((completed / total) * 100) : 0,
    };
  });
}
