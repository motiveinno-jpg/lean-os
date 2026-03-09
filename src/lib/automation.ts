/**
 * OwnerView Automation Engine
 * 모든 수동 프로세스를 자동화하는 통합 엔진
 */

import { supabase } from './supabase';
import { threeWayMatch, markInvoiceMatched, createTaxInvoice } from './tax-invoice';
import { createApprovalRequest } from './approval-workflow';
import { createQueueEntry } from './payment-queue';
import { resolveBank } from './routing';

const db = supabase as any;

// ══════════════════════════════════════════
// 1. 은행 거래 자동분류
// ══════════════════════════════════════════
export async function applyBankClassificationRules(companyId: string) {
  // Fetch all unmapped bank transactions
  const { data: unmapped } = await db
    .from('bank_transactions')
    .select('id, counterparty, description, amount, type')
    .eq('company_id', companyId)
    .eq('mapping_status', 'unmapped');

  if (!unmapped?.length) return { processed: 0, matched: 0 };

  // Fetch active classification rules ordered by priority
  const { data: rules } = await db
    .from('bank_classification_rules')
    .select('*')
    .eq('company_id', companyId)
    .order('priority', { ascending: false });

  if (!rules?.length) return { processed: unmapped.length, matched: 0 };

  let matched = 0;

  for (const tx of unmapped) {
    for (const rule of rules) {
      const field = rule.match_field === 'counterparty' ? tx.counterparty : tx.description;
      if (!field) continue;

      let isMatch = false;
      const val = String(rule.match_value || '');
      const target = String(field);

      switch (rule.match_type) {
        case 'exact': isMatch = target === val; break;
        case 'contains': isMatch = target.includes(val); break;
        case 'startsWith': isMatch = target.startsWith(val); break;
        case 'regex':
          try { isMatch = new RegExp(val, 'i').test(target); } catch { isMatch = false; }
          break;
      }

      if (isMatch) {
        await db.from('bank_transactions').update({
          category: rule.assign_category || null,
          classification: rule.assign_classification || null,
          deal_id: rule.assign_deal_id || null,
          is_fixed_cost: rule.is_fixed_cost || false,
          mapping_status: 'auto_mapped',
          mapped_by: 'system',
          mapped_at: new Date().toISOString(),
        }).eq('id', tx.id);
        matched++;
        break; // First match wins
      }
    }
  }

  return { processed: unmapped.length, matched };
}

// ══════════════════════════════════════════
// 2. 법인카드 자동매핑
// ══════════════════════════════════════════
export async function applyCardTransactionRules(companyId: string) {
  // Fetch unmapped card transactions
  const { data: unmapped } = await db
    .from('card_transactions')
    .select('id, merchant_name, amount')
    .eq('company_id', companyId)
    .eq('mapping_status', 'unmapped');

  if (!unmapped?.length) return { processed: 0, matched: 0 };

  // Fetch learned rules (auto_generated from manual mappings)
  const { data: rules } = await db
    .from('bank_classification_rules')
    .select('*')
    .eq('company_id', companyId)
    .eq('match_field', 'counterparty')
    .gte('learned_from_count', 1)
    .order('learned_from_count', { ascending: false });

  if (!rules?.length) return { processed: unmapped.length, matched: 0 };

  let matched = 0;

  for (const tx of unmapped) {
    const merchant = String(tx.merchant_name || '');
    if (!merchant) continue;

    for (const rule of rules) {
      const val = String(rule.match_value || '');
      let isMatch = false;

      switch (rule.match_type) {
        case 'exact': isMatch = merchant === val; break;
        case 'contains': isMatch = merchant.includes(val); break;
        default: isMatch = merchant.includes(val); break;
      }

      if (isMatch) {
        await db.from('card_transactions').update({
          category: rule.assign_category || null,
          classification: rule.assign_classification || null,
          deal_id: rule.assign_deal_id || null,
          is_fixed_cost: rule.is_fixed_cost || false,
          is_deductible: true,
          mapping_status: 'auto_mapped',
          mapped_by: 'system',
          mapped_at: new Date().toISOString(),
        }).eq('id', tx.id);
        matched++;
        break;
      }
    }
  }

  return { processed: unmapped.length, matched };
}

// ══════════════════════════════════════════
// 3. 3-Way 매칭 자동실행
// ══════════════════════════════════════════
export async function autoExecuteThreeWayMatch(companyId: string) {
  const results = await threeWayMatch(companyId);
  let autoMatched = 0;

  for (const r of results) {
    if (r.fullMatch && r.invoiceId) {
      await markInvoiceMatched(r.invoiceId);
      autoMatched++;
    }
  }

  return { total: results.length, autoMatched };
}

// ══════════════════════════════════════════
// 4. 거래 매칭 자동실행 (score >= 90)
// ══════════════════════════════════════════
export async function autoMatchTransactions(companyId: string) {
  // Get unmatched bank transactions
  const { data: bankTxs } = await db
    .from('bank_transactions')
    .select('id, counterparty, amount, transaction_date, type')
    .eq('company_id', companyId)
    .eq('mapping_status', 'unmapped')
    .eq('type', 'deposit');

  // Get unmatched invoices
  const { data: invoices } = await db
    .from('tax_invoices')
    .select('id, counterparty_name, total_amount, issue_date, deal_id')
    .eq('company_id', companyId)
    .neq('status', 'matched')
    .neq('status', 'void');

  if (!bankTxs?.length || !invoices?.length) return { matched: 0 };

  let matched = 0;

  for (const tx of bankTxs) {
    let bestScore = 0;
    let bestInvoice: any = null;

    for (const inv of invoices) {
      let score = 0;
      const txAmt = Number(tx.amount || 0);
      const invAmt = Number(inv.total_amount || 0);

      // Amount similarity (max 50 points)
      if (txAmt > 0 && invAmt > 0) {
        const diff = Math.abs(txAmt - invAmt) / Math.max(txAmt, invAmt);
        if (diff === 0) score += 50;
        else if (diff <= 0.01) score += 45;
        else if (diff <= 0.05) score += 30;
      }

      // Counterparty similarity (max 30 points)
      const txName = String(tx.counterparty || '').toLowerCase();
      const invName = String(inv.counterparty_name || '').toLowerCase();
      if (txName && invName) {
        if (txName === invName) score += 30;
        else if (txName.includes(invName) || invName.includes(txName)) score += 20;
      }

      // Date proximity (max 20 points)
      const txDate = new Date(tx.transaction_date).getTime();
      const invDate = new Date(inv.issue_date).getTime();
      const daysDiff = Math.abs(txDate - invDate) / (1000 * 60 * 60 * 24);
      if (daysDiff <= 1) score += 20;
      else if (daysDiff <= 7) score += 15;
      else if (daysDiff <= 30) score += 10;

      if (score > bestScore) {
        bestScore = score;
        bestInvoice = inv;
      }
    }

    // Auto-match only if score >= 90
    if (bestScore >= 90 && bestInvoice) {
      await db.from('transaction_matches').insert({
        company_id: companyId,
        bank_transaction_id: tx.id,
        tax_invoice_id: bestInvoice.id,
        deal_id: bestInvoice.deal_id || null,
        match_score: bestScore,
        match_type: 'auto',
        status: 'confirmed',
      });

      // Update bank transaction
      await db.from('bank_transactions').update({
        mapping_status: 'auto_mapped',
        mapped_by: 'system',
        mapped_at: new Date().toISOString(),
      }).eq('id', tx.id);

      matched++;
    }
  }

  return { matched };
}

// ══════════════════════════════════════════
// 5. 휴면 딜 자동감지 + 알림
// ══════════════════════════════════════════
export async function detectDormantDeals(companyId: string) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

  // Find deals with no activity in 30 days
  const { data: candidates } = await db
    .from('deals')
    .select('id, name, last_activity_at, status')
    .eq('company_id', companyId)
    .eq('is_dormant', false)
    .in('status', ['active', 'pending'])
    .lt('last_activity_at', thirtyDaysAgo);

  if (!candidates?.length) return { detected: 0 };

  // Mark as dormant
  const ids = candidates.map((d: any) => d.id);
  await db.from('deals').update({ is_dormant: true }).in('id', ids);

  // Create notifications
  const notifications = candidates.map((d: any) => ({
    company_id: companyId,
    type: 'dormant_deal',
    title: `휴면 딜 감지: ${d.name}`,
    message: `30일 이상 활동이 없습니다. 확인이 필요합니다.`,
    entity_type: 'deal',
    entity_id: d.id,
    is_read: false,
  }));

  await db.from('notifications').insert(notifications).select();

  return { detected: candidates.length, deals: candidates.map((d: any) => d.name) };
}

// ══════════════════════════════════════════
// 6. 월마감 자동검증
// ══════════════════════════════════════════
export async function autoVerifyClosingChecklist(companyId: string, checklistId: string) {
  const { data: checklist } = await db
    .from('closing_checklists')
    .select('*, closing_checklist_items(*)')
    .eq('id', checklistId)
    .single();

  if (!checklist) return { verified: 0 };

  const items = checklist.closing_checklist_items || [];
  let verified = 0;

  for (const item of items) {
    if (item.is_completed) continue;

    let passed = false;
    const key = String(item.item_key || item.title || '');

    // Check each item automatically
    if (key.includes('은행') || key.includes('거래수집')) {
      const { count } = await db.from('bank_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('mapping_status', 'unmapped');
      // Passed if no unmapped bank transactions
      passed = (count || 0) === 0;
    }
    else if (key.includes('카드') || key.includes('법인카드')) {
      const { count } = await db.from('card_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId)
        .eq('mapping_status', 'unmapped');
      passed = (count || 0) === 0;
    }
    else if (key.includes('미매핑') || key.includes('분류')) {
      const { count: bankUn } = await db.from('bank_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('mapping_status', 'unmapped');
      const { count: cardUn } = await db.from('card_transactions')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('mapping_status', 'unmapped');
      passed = ((bankUn || 0) + (cardUn || 0)) === 0;
    }
    else if (key.includes('세금계산서') || key.includes('대사') || key.includes('매칭')) {
      const matchResults = await threeWayMatch(companyId);
      const unmatched = matchResults.filter(r => !r.fullMatch).length;
      passed = unmatched === 0;
    }
    else if (key.includes('경비') || key.includes('비용')) {
      const { count } = await db.from('expense_requests')
        .select('id', { count: 'exact', head: true })
        .eq('company_id', companyId).eq('status', 'pending');
      passed = (count || 0) === 0;
    }

    if (passed) {
      await db.from('closing_checklist_items').update({
        is_completed: true,
        completed_by: 'system',
        completed_at: new Date().toISOString(),
      }).eq('id', item.id);
      verified++;
    }
  }

  return { verified, total: items.length };
}

// ══════════════════════════════════════════
// 7. 경비 자동승인 (소액)
// ══════════════════════════════════════════
export async function autoApproveSmallExpenses(companyId: string, threshold: number = 100000) {
  // Get pending expenses under threshold
  const { data: pending } = await db
    .from('expense_requests')
    .select('id, amount, category, receipt_urls, requester_id')
    .eq('company_id', companyId)
    .eq('status', 'pending')
    .lte('amount', threshold);

  if (!pending?.length) return { approved: 0 };

  let approved = 0;

  for (const exp of pending) {
    // Skip if no receipt for travel/entertainment
    const cat = String(exp.category || '');
    if (['travel', 'entertainment', '출장비', '접대비'].includes(cat)) {
      if (!exp.receipt_urls?.length) continue; // Require receipt
    }

    // Auto-approve
    await db.from('expense_requests').update({
      status: 'approved',
    }).eq('id', exp.id);

    // Create approval record
    await db.from('expense_approvals').insert({
      expense_id: exp.id,
      approver_id: exp.requester_id, // Self-approved by system
      level: 1,
      status: 'auto_approved',
      comment: `자동승인 (${threshold.toLocaleString()}원 이하)`,
      decided_at: new Date().toISOString(),
    });

    approved++;
  }

  return { approved, total: pending.length };
}

// ══════════════════════════════════════════
// 8. 세금계산서 자동생성 (딜 완료 시)
// ══════════════════════════════════════════
export async function autoCreateTaxInvoiceOnDealClose(companyId: string, dealId: string) {
  // Check if invoice already exists for this deal
  const { data: existing } = await db
    .from('tax_invoices')
    .select('id')
    .eq('deal_id', dealId)
    .neq('status', 'void')
    .maybeSingle();

  if (existing) return { created: false, reason: '이미 세금계산서가 존재합니다' };

  // Get deal info
  const { data: deal } = await db
    .from('deals')
    .select('*, partners(name, business_number)')
    .eq('id', dealId)
    .single();

  if (!deal) return { created: false, reason: '딜을 찾을 수 없습니다' };

  const counterpartyName = deal.partners?.name || deal.counterparty || deal.name;
  const counterpartyBizno = deal.partners?.business_number || '';
  const supplyAmount = Number(deal.contract_total || 0);

  if (supplyAmount <= 0) return { created: false, reason: '계약금액이 0입니다' };

  const invoice = await createTaxInvoice({
    companyId,
    dealId,
    type: 'sales',
    counterpartyName,
    counterpartyBizno,
    supplyAmount,
    issueDate: new Date().toISOString().split('T')[0],
  });

  return { created: true, invoiceId: invoice?.id };
}

// ══════════════════════════════════════════
// 9. 파트너 자동백업 (딜에서 파트너 생성)
// ══════════════════════════════════════════
export async function autoCreatePartnerFromDeal(companyId: string, dealId: string) {
  const { data: deal } = await db
    .from('deals')
    .select('id, name, counterparty, classification, partner_id')
    .eq('id', dealId)
    .single();

  if (!deal) return { created: false, reason: '딜을 찾을 수 없습니다' };
  if (deal.partner_id) return { created: false, reason: '이미 파트너가 연결되어 있습니다' };

  const partnerName = deal.counterparty || deal.name;
  if (!partnerName) return { created: false, reason: '거래처명이 없습니다' };

  // Check if partner already exists by name
  const { data: existingPartner } = await db
    .from('partners')
    .select('id')
    .eq('company_id', companyId)
    .ilike('name', partnerName)
    .maybeSingle();

  if (existingPartner) {
    // Link existing partner
    await db.from('deals').update({ partner_id: existingPartner.id }).eq('id', dealId);
    return { created: false, linked: true, partnerId: existingPartner.id };
  }

  // Create new partner
  const { data: newPartner } = await db
    .from('partners')
    .insert({
      company_id: companyId,
      name: partnerName,
      type: 'client',
      classification: deal.classification || null,
      source_deal_id: dealId,
      is_active: true,
    })
    .select()
    .single();

  if (newPartner) {
    await db.from('deals').update({ partner_id: newPartner.id }).eq('id', dealId);
  }

  return { created: true, partnerId: newPartner?.id };
}

// ══════════════════════════════════════════
// 10. 견적→입금스케줄 자동연결 (승인된 계약 기반)
// ══════════════════════════════════════════
export async function autoLinkApprovedContractsToSchedule(companyId: string) {
  // Find approved contracts without revenue schedules
  const { data: approvedDocs } = await db
    .from('documents')
    .select('id, deal_id, content_json')
    .eq('company_id', companyId)
    .eq('status', 'approved')
    .not('deal_id', 'is', null);

  if (!approvedDocs?.length) return { linked: 0 };

  let linked = 0;
  for (const doc of approvedDocs) {
    const content = doc.content_json as any;
    if (content?.type !== 'contract') continue;

    // Check if revenue schedule already exists
    const { count } = await db
      .from('deal_revenue_schedule')
      .select('id', { count: 'exact', head: true })
      .eq('deal_id', doc.deal_id);

    if ((count || 0) > 0) continue; // Already has schedule

    // Trigger pipeline
    const { onDocumentApproved } = await import('./deal-pipeline');
    await onDocumentApproved({
      documentId: doc.id,
      companyId,
      approverId: 'system',
    });
    linked++;
  }

  return { linked };
}

// ══════════════════════════════════════════
// 11. 반복결제 → 지출결의서 자동생성
// ══════════════════════════════════════════
export async function autoCreateExpenseFromRecurring(companyId: string) {
  // Get active recurring payments
  const { data: recurring } = await db
    .from('recurring_payments')
    .select('*')
    .eq('company_id', companyId)
    .eq('is_active', true);

  if (!recurring?.length) return { created: 0 };

  const now = new Date();
  const currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  let created = 0;

  for (const r of recurring) {
    // Skip if already generated this month
    if (r.last_generated_at) {
      const lastGen = r.last_generated_at.substring(0, 7); // YYYY-MM
      if (lastGen === currentMonth) continue;
    }

    // Check if approval_request already exists for this recurring + month
    const { data: existing } = await db
      .from('approval_requests')
      .select('id')
      .eq('company_id', companyId)
      .eq('request_type', 'expense')
      .ilike('title', `%${r.name}%${currentMonth}%`)
      .maybeSingle();

    if (existing) continue;

    const amount = Number(r.amount || 0);
    if (amount <= 0) continue;

    // Create approval request (auto-approves if below threshold)
    const request = await createApprovalRequest({
      companyId,
      requestType: 'expense',
      requesterId: 'system',
      title: `${r.name} (${currentMonth})`,
      amount,
      description: `자동생성: 반복결제 "${r.name}" / 카테고리: ${r.category || '기타'}`,
    });

    // If auto-approved, also create payment queue entry
    if (request.status === 'approved') {
      const bank = await resolveBank(companyId, r.category || 'default');
      await createQueueEntry({
        companyId,
        amount,
        description: `${r.name} (${currentMonth}) - 자동`,
        costType: r.category || 'fixed_cost',
        dealBankAccountId: bank?.id || null,
      });
    }

    // Update last_generated_at
    await db.from('recurring_payments').update({
      last_generated_at: now.toISOString(),
    }).eq('id', r.id);

    created++;
  }

  return { created, total: recurring.length };
}

// ══════════════════════════════════════════
// 12. 승인완료 → 결제큐 자동등록
// ══════════════════════════════════════════
export async function autoQueueApprovedExpenses(companyId: string) {
  // Find approved approval_requests that are NOT yet in payment_queue
  const { data: approved } = await db
    .from('approval_requests')
    .select('id, title, amount, request_type, requester_id')
    .eq('company_id', companyId)
    .eq('status', 'approved')
    .in('request_type', ['expense', 'payment', 'purchase']);

  if (!approved?.length) return { queued: 0 };

  // Get existing payment_queue entries linked via approval_request_id (FK-based dedup)
  const { data: existingQueue } = await db
    .from('payment_queue')
    .select('approval_request_id')
    .eq('company_id', companyId)
    .not('approval_request_id', 'is', null);

  const existingIds = new Set((existingQueue || []).map((q: any) => q.approval_request_id));
  let queued = 0;

  for (const req of approved) {
    // Skip if already queued (FK-based)
    if (existingIds.has(req.id)) continue;

    const amount = Number(req.amount || 0);
    if (amount <= 0) continue;

    await createQueueEntry({
      companyId,
      approvalRequestId: req.id,
      amount,
      description: `[승인#${req.id.substring(0, 8)}] ${req.title}`,
      costType: req.request_type === 'purchase' ? 'purchase' : 'expense',
    });

    queued++;
  }

  return { queued, total: approved.length };
}

// ══════════════════════════════════════════
// 13. 계약 완료 → 지출결의서 자동생성
// ══════════════════════════════════════════
export async function autoCreateExpenseFromContract(companyId: string) {
  // Find approved cost schedules without expense requests
  const { data: schedules } = await db
    .from('deal_cost_schedule')
    .select('id, deal_id, amount, label, due_date, status, deals(name)')
    .eq('company_id', companyId)
    .eq('approved', true)
    .neq('status', 'paid');

  if (!schedules?.length) return { created: 0 };

  // Check which already have approval requests
  const { data: existingRequests } = await db
    .from('approval_requests')
    .select('request_id')
    .eq('company_id', companyId)
    .eq('request_type', 'payment');

  const existingIds = new Set((existingRequests || []).map((r: any) => r.request_id));
  let created = 0;

  for (const sched of schedules) {
    if (existingIds.has(sched.id)) continue;

    const amount = Number(sched.amount || 0);
    if (amount <= 0) continue;

    const dealName = sched.deals?.name || '딜';
    const label = sched.label || '계약금';

    const request = await createApprovalRequest({
      companyId,
      requestType: 'payment',
      requestId: sched.id,
      requesterId: 'system',
      title: `${dealName} - ${label}`,
      amount,
      description: `계약 기반 자동생성: ${dealName} / ${label} / 기한: ${sched.due_date || '미정'}`,
    });

    // If auto-approved, queue payment
    if (request.status === 'approved') {
      await createQueueEntry({
        companyId,
        costScheduleId: sched.id,
        amount,
        description: `${dealName} - ${label} (계약자동)`,
        costType: 'contract',
      });
    }

    created++;
  }

  return { created, total: schedules.length };
}

// ══════════════════════════════════════════
// 14. 결제완료 → 세금계산서 자동발행
// ══════════════════════════════════════════
export async function autoCreateTaxInvoiceOnPayment(companyId: string) {
  // Check company tax_settings for auto-issue on payment
  const { data: company } = await db
    .from('companies')
    .select('tax_settings')
    .eq('id', companyId)
    .single();

  const taxSettings = company?.tax_settings as any;
  if (!taxSettings?.autoIssueOnPayment) return { created: 0, reason: '결제완료 자동발행 비활성' };

  // Get executed payments without tax invoices
  const { data: executed } = await db
    .from('payment_queue')
    .select('id, amount, description, recipient_name, executed_at, cost_schedule_id, deals(id, name, counterparty)')
    .eq('company_id', companyId)
    .eq('status', 'executed');

  if (!executed?.length) return { created: 0 };

  // Get existing tax invoices to avoid duplicates
  const { data: existingInvoices } = await db
    .from('tax_invoices')
    .select('id, total_amount, counterparty_name, issue_date')
    .eq('company_id', companyId)
    .neq('status', 'void');

  // Simple duplicate check: same amount + same counterparty + same date
  const invoiceKeys = new Set(
    (existingInvoices || []).map((inv: any) =>
      `${inv.counterparty_name}|${inv.total_amount}|${inv.issue_date}`
    )
  );

  let created = 0;

  for (const pmt of executed) {
    const amount = Number(pmt.amount || 0);
    if (amount <= 0) continue;

    const counterpartyName = pmt.recipient_name || pmt.deals?.counterparty || pmt.deals?.name || '미확인';
    const issueDate = (pmt.executed_at || new Date().toISOString()).split('T')[0];
    const supplyAmount = Math.round(amount / 1.1); // 공급가 역산
    const totalAmount = supplyAmount + Math.round(supplyAmount * 0.1);

    const key = `${counterpartyName}|${totalAmount}|${issueDate}`;
    if (invoiceKeys.has(key)) continue;

    await createTaxInvoice({
      companyId,
      dealId: pmt.deals?.id || undefined,
      type: 'purchase', // 매입 세금계산서 (지출이므로)
      counterpartyName,
      supplyAmount,
      issueDate,
    });

    invoiceKeys.add(key);
    created++;
  }

  return { created, total: executed.length };
}

// ══════════════════════════════════════════
// 15. 환불/취소 → 세금계산서 자동취소
// ══════════════════════════════════════════
export async function autoCancelTaxInvoiceOnRefund(companyId: string) {
  // Check company tax_settings
  const { data: company } = await db
    .from('companies')
    .select('tax_settings')
    .eq('id', companyId)
    .single();

  const taxSettings = company?.tax_settings as any;
  if (!taxSettings?.autoCancelOnRefund) return { cancelled: 0, reason: '환불 자동취소 비활성' };

  // Find rejected/cancelled payment_queue entries that have linked tax invoices
  const { data: cancelled } = await db
    .from('payment_queue')
    .select('id, cost_schedule_id, description, deals(id)')
    .eq('company_id', companyId)
    .in('status', ['rejected', 'cancelled']);

  if (!cancelled?.length) return { cancelled: 0 };

  let cancelledCount = 0;

  for (const pmt of cancelled) {
    const dealId = pmt.deals?.id || null;
    if (!dealId) continue;

    // Find active tax invoices for this deal
    const { data: invoices } = await db
      .from('tax_invoices')
      .select('id, status')
      .eq('deal_id', dealId)
      .eq('company_id', companyId)
      .in('status', ['issued', 'received']);

    if (!invoices?.length) continue;

    for (const inv of invoices) {
      await db.from('tax_invoices').update({
        status: 'void',
        void_reason: `자동취소: 결제 취소/반려 (${pmt.description || ''})`,
        voided_at: new Date().toISOString(),
      }).eq('id', inv.id);
      cancelledCount++;
    }
  }

  return { cancelled: cancelledCount };
}

// ══════════════════════════════════════════
// 통합 실행: 전체 자동화 한번에 실행 (15개)
// ══════════════════════════════════════════
export interface AutomationResult {
  bankClassification: { processed: number; matched: number };
  cardMapping: { processed: number; matched: number };
  threeWayMatch: { total: number; autoMatched: number };
  transactionMatch: { matched: number };
  dormantDeals: { detected: number };
  expenseApproval: { approved: number };
  contractLinking: { linked: number };
  // Phase U: 파이프라인 자동화
  recurringExpense: { created: number };
  approvedQueue: { queued: number };
  contractExpense: { created: number };
  taxOnPayment: { created: number };
  taxCancelOnRefund: { cancelled: number };
  timestamp: string;
}

export async function runAllAutomation(companyId: string): Promise<AutomationResult> {
  const [
    bankResult, cardResult, matchResult, txMatchResult, dormantResult, expenseResult, contractResult,
    recurringResult, queueResult, contractExpResult, taxPayResult, taxCancelResult,
  ] = await Promise.all([
    // 기존 10개
    applyBankClassificationRules(companyId),
    applyCardTransactionRules(companyId),
    autoExecuteThreeWayMatch(companyId),
    autoMatchTransactions(companyId),
    detectDormantDeals(companyId),
    autoApproveSmallExpenses(companyId, 100000),
    autoLinkApprovedContractsToSchedule(companyId),
    // 신규 5개: 파이프라인 자동화
    autoCreateExpenseFromRecurring(companyId),
    autoQueueApprovedExpenses(companyId),
    autoCreateExpenseFromContract(companyId),
    autoCreateTaxInvoiceOnPayment(companyId),
    autoCancelTaxInvoiceOnRefund(companyId),
  ]);

  return {
    bankClassification: bankResult,
    cardMapping: cardResult,
    threeWayMatch: matchResult,
    transactionMatch: txMatchResult,
    dormantDeals: dormantResult,
    expenseApproval: expenseResult,
    contractLinking: contractResult,
    recurringExpense: recurringResult,
    approvedQueue: queueResult,
    contractExpense: contractExpResult,
    taxOnPayment: taxPayResult,
    taxCancelOnRefund: taxCancelResult,
    timestamp: new Date().toISOString(),
  };
}
