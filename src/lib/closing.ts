import { logRead } from "@/lib/log-read";
/**
 * OwnerView Monthly Closing Checklist Engine
 * 월 마감 체크리스트 생성/관리 + 자동 검증 + 자동 마감 + PDF 보관 (Granter 벤치마킹 5단계)
 */

import { supabase } from './supabase';
import { logAudit } from './audit-log';

const db = supabase;

// ── Month range helper (YYYY-MM → [startISO, endISO)) ──
function monthRange(month: string): { startDate: string; endDate: string } {
  const [y, m] = month.split('-').map(Number);
  const start = new Date(Date.UTC(y, m - 1, 1));
  const end = new Date(Date.UTC(y, m, 1));
  return {
    startDate: start.toISOString().slice(0, 10),
    endDate: end.toISOString().slice(0, 10),
  };
}

// ── Default checklist items for a new month ──
const DEFAULT_ITEMS = [
  { title: '은행 거래내역 전체 수집 확인', description: '모든 법인통장의 거래내역이 빠짐없이 수집되었는지 확인', sort_order: 1, is_required: true },
  { title: '법인카드 거래내역 수집 확인', description: '모든 법인카드의 승인/매입 내역이 수집되었는지 확인', sort_order: 2, is_required: true },
  { title: '미매핑 거래 0건 확인', description: '은행 거래와 카드 거래 모두 분류 완료', sort_order: 3, is_required: true },
  { title: '세금계산서 대사 완료', description: '매출/매입 세금계산서와 거래내역 매칭 확인', sort_order: 4, is_required: true },
  { title: '미수금/미지급금 확인', description: '30일 이상 미수금 독촉 여부, 미지급금 기한 확인', sort_order: 5, is_required: true },
  { title: '고정비 정합성 확인', description: '임대료/급여/보험 등 고정비가 정상 지출되었는지 확인', sort_order: 6, is_required: true },
  { title: '프로젝트별 매출/비용 정합성', description: '딜 계약금액 대비 실 입출금 확인', sort_order: 7, is_required: false },
  { title: '부가세 예수금 확인', description: '당월 부가세 예수/환급 예상액 확인', sort_order: 8, is_required: false },
  { title: '증빙 누락 확인', description: '영수증/증빙 미첨부 건수 확인 및 보완', sort_order: 9, is_required: true },
  { title: '월간 손익 리포트 생성', description: 'PDF 리포트 다운로드 및 저장', sort_order: 10, is_required: false },
];

// ── Get or create checklist for a month ──
export async function getOrCreateChecklist(companyId: string, month: string) {
  // Try to find existing
  const existing = logRead('lib/closing:existing', await supabase
    .from('closing_checklists')
    .select('*, closing_checklist_items(*)')
    .eq('company_id', companyId)
    .eq('month', month)
    .maybeSingle());

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

  const items = logRead('lib/closing:items', await supabase
    .from('closing_checklist_items')
    .insert(itemRows)
    .select());

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

  const cl = logRead('lib/closing:cl', await supabase
    .from('closing_checklists')
    .select('company_id, month')
    .eq('id', checklistId)
    .single());

  await logAudit({
    company_id: cl?.company_id || '',
    user_id: userId,
    action: 'approve',
    entity_type: 'closing',
    entity_id: checklistId,
    entity_name: cl?.month ? `${cl.month} 월마감` : undefined,
  });
}

// ── Lock/Unlock Closing Month ──
export async function lockClosingMonth(checklistId: string, userId: string) {
  const { error } = await supabase
    .from('closing_checklists')
    .update({
      status: 'locked',
      locked_at: new Date().toISOString(),
      locked_by: userId,
    })
    .eq('id', checklistId);
  if (error) throw error;

  const cl = logRead('lib/closing:cl', await supabase
    .from('closing_checklists')
    .select('company_id, month')
    .eq('id', checklistId)
    .single());

  await logAudit({
    company_id: cl?.company_id || '',
    user_id: userId,
    action: 'lock',
    entity_type: 'closing',
    entity_id: checklistId,
    entity_name: cl?.month ? `${cl.month} 월마감` : undefined,
  });
}

export async function unlockClosingMonth(checklistId: string, userId: string) {
  const { error } = await supabase
    .from('closing_checklists')
    .update({
      status: 'completed',
      locked_at: null,
      locked_by: null,
    })
    .eq('id', checklistId);
  if (error) throw error;

  const cl = logRead('lib/closing:cl', await supabase
    .from('closing_checklists')
    .select('company_id, month')
    .eq('id', checklistId)
    .single());

  await logAudit({
    company_id: cl?.company_id || '',
    user_id: userId,
    action: 'unlock',
    entity_type: 'closing',
    entity_id: checklistId,
    entity_name: cl?.month ? `${cl.month} 월마감` : undefined,
  });
}

export async function isMonthLocked(companyId: string, month: string): Promise<boolean> {
  const data = logRead('lib/closing:data', await supabase
    .from('closing_checklists')
    .select('status')
    .eq('company_id', companyId)
    .eq('month', month)
    .maybeSingle());
  return data?.status === 'locked';
}

// ── Get closing history ──
export async function getClosingHistory(companyId: string) {
  const data = logRead('lib/closing:data', await supabase
    .from('closing_checklists')
    .select('*, closing_checklist_items(id, is_completed, is_required)')
    .eq('company_id', companyId)
    .order('month', { ascending: false })
    .limit(12));

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

// ═══════════════════════════════════════════
// 자동 검증 (Granter 벤치마킹 5단계)
// ═══════════════════════════════════════════
export interface AutoVerifyOutcome {
  itemId: string;
  title: string;
  passed: boolean;
  reason: string;
}

/**
 * 체크리스트 10개 항목 중 자동 판정 가능한 7개를 코드로 검증.
 * 통과한 항목은 is_completed=true, auto_verified=true, verified_reason 자동 채움.
 * 수동 항목(고정비/딜정합성/부가세)은 건드리지 않음.
 */
export async function autoVerifyChecklist(
  companyId: string,
  checklistId: string,
  month: string,
): Promise<AutoVerifyOutcome[]> {
  const { startDate, endDate } = monthRange(month);

  const items = logRead('lib/closing:items', await db
    .from('closing_checklist_items')
    .select('id, title, is_completed, auto_verified, sort_order')
    .eq('checklist_id', checklistId));

  if (!items) return [];

  const outcomes: AutoVerifyOutcome[] = [];
  const nowIso = new Date().toISOString();

  for (const item of items as any[]) {
    // 이미 수동으로 통과한 항목은 건드리지 않음 (감사로그 보존)
    if (item.is_completed && !item.auto_verified) {
      outcomes.push({ itemId: item.id, title: item.title, passed: true, reason: '수동 완료' });
      continue;
    }

    let passed = false;
    let reason = '';
    const title = String(item.title || '');

    if (title.includes('은행 거래내역')) {
      const { count } = await db.from('bank_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .gte('transaction_date', startDate).lt('transaction_date', endDate);
      passed = (count || 0) > 0;
      reason = passed ? `${count}건 수집됨` : '당월 거래내역 0건';
    }
    else if (title.includes('법인카드 거래내역')) {
      const { count } = await db.from('card_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .gte('transaction_date', startDate).lt('transaction_date', endDate);
      passed = (count || 0) > 0;
      reason = passed ? `${count}건 수집됨` : '당월 카드 거래 0건';
    }
    else if (title.includes('미매핑') || title.includes('분류')) {
      const { count: bankUn } = await db.from('bank_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .gte('transaction_date', startDate).lt('transaction_date', endDate)
        .eq('mapping_status', 'unmapped');
      const { count: cardUn } = await db.from('card_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .gte('transaction_date', startDate).lt('transaction_date', endDate)
        .eq('mapping_status', 'unmapped');
      const unmapped = (bankUn || 0) + (cardUn || 0);
      passed = unmapped === 0;
      reason = passed ? '미매핑 0건' : `미매핑 ${unmapped}건 (은행 ${bankUn || 0} + 카드 ${cardUn || 0})`;
    }
    else if (title.includes('세금계산서')) {
      // QA 2026-07-10: type 값은 'sales'(영문), matched_transaction_id 컬럼 부재 → status 기준으로 교정
      const { count: unmatchedSales } = await db.from('tax_invoices')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('type', 'sales')
        .gte('issue_date', startDate).lt('issue_date', endDate)
        .not('status', 'in', '(matched,void,draft)');
      passed = (unmatchedSales || 0) === 0;
      reason = passed ? '매출 대사 완료' : `미매칭 매출 세금계산서 ${unmatchedSales}건`;
    }
    else if (title.includes('미수금')) {
      const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
      const { count } = await db.from('tax_invoices')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('type', 'sales')
        .lt('issue_date', thirtyDaysAgo)
        .not('status', 'in', '(matched,void,draft)');
      passed = (count || 0) === 0;
      reason = passed ? '30일+ 미수금 0건' : `30일+ 미수금 ${count}건`;
    }
    else if (title.includes('증빙')) {
      const { count } = await db.from('expense_requests')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('status', 'pending')
        .gte('created_at', startDate).lt('created_at', endDate)
        .or('receipt_urls.is.null,receipt_urls.eq.{}');
      passed = (count || 0) === 0;
      reason = passed ? '증빙 누락 0건' : `증빙 누락 ${count}건`;
    }
    else if (title.includes('월간 손익') || title.includes('리포트')) {
      const cl = logRead('lib/closing:cl', await db.from('closing_checklists')
        .select('report_url').eq('id', checklistId).maybeSingle());
      passed = !!cl?.report_url;
      reason = passed ? 'PDF 보관됨' : 'PDF 미생성';
    }
    else {
      // 수동 항목 (고정비/딜정합성/부가세) — 건너뜀
      outcomes.push({ itemId: item.id, title, passed: !!item.is_completed, reason: '수동 항목' });
      continue;
    }

    outcomes.push({ itemId: item.id, title, passed, reason });

    if (passed && !item.is_completed) {
      await db.from('closing_checklist_items').update({
        is_completed: true,
        completed_at: nowIso,
        auto_verified: true,
        verified_at: nowIso,
        verified_reason: reason,
      }).eq('id', item.id);
    } else if (!passed && item.auto_verified) {
      // 이전에 자동 통과했으나 지금은 실패 — 자동 표시 해제
      await db.from('closing_checklist_items').update({
        is_completed: false,
        completed_at: null,
        auto_verified: false,
        verified_at: nowIso,
        verified_reason: reason,
      }).eq('id', item.id);
    } else if (!item.is_completed) {
      // 미통과 + 미완료 — verified_reason 만 갱신
      await db.from('closing_checklist_items').update({
        verified_at: nowIso,
        verified_reason: reason,
      }).eq('id', item.id);
    }
  }

  return outcomes;
}

/**
 * 저장된 PDF URL 을 checklist 에 기록.
 * generateMonthlyPLReport(... { upload: true }) 와 결합.
 */
export async function attachReportUrl(checklistId: string, url: string): Promise<void> {
  await db.from('closing_checklists').update({
    report_url: url,
    report_generated_at: new Date().toISOString(),
  }).eq('id', checklistId);
}

/**
 * 자동 마감: 검증 → 필수 항목 전부 통과 시 completed 처리 + auto_closed=true.
 * PDF 자동 생성은 호출자(클라이언트)가 generateMonthlyPLReport({ upload:true }) 후
 * attachReportUrl() 호출. 서버사이드 PDF 생성은 별도 (jsPDF 는 브라우저용).
 */
export async function autoCloseMonth(
  companyId: string,
  month: string,
  opts?: { userId?: string },
): Promise<{
  checklistId: string;
  outcomes: AutoVerifyOutcome[];
  closed: boolean;
  reason: string;
}> {
  const checklist = await getOrCreateChecklist(companyId, month);
  const outcomes = await autoVerifyChecklist(companyId, checklist.id, month);

  // 다시 읽어서 required 통과 여부 확인
  const items = logRead('lib/closing:items', await db
    .from('closing_checklist_items')
    .select('is_completed, is_required')
    .eq('checklist_id', checklist.id));

  const required = (items || []).filter((i: any) => i.is_required);
  const requiredDone = required.filter((i: any) => i.is_completed).length;
  const allRequiredDone = required.length > 0 && requiredDone === required.length;

  let closed = false;
  let reason = '';

  if (allRequiredDone && checklist.status !== 'locked' && checklist.status !== 'completed') {
    await db.from('closing_checklists').update({
      status: 'completed',
      completed_at: new Date().toISOString(),
      completed_by: opts?.userId || null,
      auto_closed: true,
    }).eq('id', checklist.id);
    closed = true;
    reason = `필수 ${requiredDone}/${required.length} 항목 자동 완료`;

    await logAudit({
      company_id: companyId,
      user_id: opts?.userId || 'system',
      action: 'approve',
      entity_type: 'closing',
      entity_id: checklist.id,
      entity_name: `${month} 자동마감`,
    });
  } else if (checklist.status === 'locked' || checklist.status === 'completed') {
    reason = `이미 ${checklist.status === 'locked' ? '잠금' : '완료'}됨`;
  } else {
    reason = `필수 ${requiredDone}/${required.length} 미통과`;
  }

  return { checklistId: checklist.id, outcomes, closed, reason };
}
