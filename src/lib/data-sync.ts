/**
 * OwnerView Data Synchronization System
 * 현금예산 대시보드 원클릭 최신화 (계좌잔액, 카드내역, 고정비, 매출)
 */
import { supabase } from './supabase';
import { logAudit } from './audit-log';

const db = supabase as any;

// ── Types ──

export interface SyncResult {
  source: string;
  status: 'success' | 'error' | 'skipped';
  itemCount: number;
  message: string;
  syncedAt: string;
}

export interface SyncStatus {
  isRunning: boolean;
  lastSyncAt: string | null;
  results: SyncResult[];
  totalItems: number;
}

interface DetectedFixedCost {
  payee: string;
  amount: number;
  frequency: 'monthly' | 'quarterly' | 'annual';
  category: string;
  confidence: number; // 0–1
  lastSeen: string;
  occurrences: number;
}

// ── Helpers ──

function now(): string {
  return new Date().toISOString();
}

function resultOk(source: string, itemCount: number, message: string): SyncResult {
  return { source, status: 'success', itemCount, message, syncedAt: now() };
}

function resultErr(source: string, message: string): SyncResult {
  return { source, status: 'error', itemCount: 0, message, syncedAt: now() };
}

function resultSkip(source: string, message: string): SyncResult {
  return { source, status: 'skipped', itemCount: 0, message, syncedAt: now() };
}

function monthRange(month?: string): { start: string; end: string } {
  const m = month || new Date().toISOString().slice(0, 7); // 'YYYY-MM'
  const start = `${m}-01`;
  const y = parseInt(m.slice(0, 4), 10);
  const mo = parseInt(m.slice(5, 7), 10);
  const nextMonth = mo === 12 ? `${y + 1}-01` : `${y}-${String(mo + 1).padStart(2, '0')}`;
  const end = `${nextMonth}-01`;
  return { start, end };
}

// ── 1. Bank Balances ──

export async function syncBankBalances(companyId: string): Promise<SyncResult> {
  try {
    // Fetch all bank accounts for this company
    const { data: accounts, error: accErr } = await db
      .from('bank_accounts')
      .select('id, alias, bank_name, balance')
      .eq('company_id', companyId);

    if (accErr) return resultErr('bank_balances', `계좌 조회 실패: ${accErr.message}`);
    if (!accounts || accounts.length === 0) return resultSkip('bank_balances', '등록된 계좌 없음');

    let updatedCount = 0;

    for (const account of accounts) {
      // Calculate running balance from transactions for this account
      const { data: txns, error: txErr } = await db
        .from('transactions')
        .select('amount, type')
        .eq('company_id', companyId)
        .eq('bank_account_id', account.id)
        .order('created_at', { ascending: false });

      if (txErr) continue;

      if (txns && txns.length > 0) {
        // Sum transaction amounts: income positive, expense negative
        const calculatedBalance = txns.reduce((sum: number, tx: any) => {
          const amt = Number(tx.amount) || 0;
          return sum + (tx.type === 'expense' ? -Math.abs(amt) : Math.abs(amt));
        }, 0);

        // Also check card transactions linked to this account
        const { data: cardTxns } = await db
          .from('card_transactions')
          .select('amount')
          .eq('company_id', companyId)
          .eq('bank_account_id', account.id)
          .eq('status', 'approved');

        const cardTotal = (cardTxns || []).reduce(
          (sum: number, ct: any) => sum + (Number(ct.amount) || 0), 0
        );

        const finalBalance = calculatedBalance - cardTotal;

        // Update if balance has changed
        if (Math.abs(finalBalance - (account.balance || 0)) > 0.01) {
          const { error: upErr } = await db
            .from('bank_accounts')
            .update({ balance: finalBalance, updated_at: now() })
            .eq('id', account.id);

          if (!upErr) updatedCount++;
        } else {
          updatedCount++; // Already up to date
        }
      }
    }

    return resultOk(
      'bank_balances',
      updatedCount,
      `${accounts.length}개 계좌 중 ${updatedCount}개 잔액 갱신 완료`
    );
  } catch (err: any) {
    return resultErr('bank_balances', `계좌 잔액 동기화 오류: ${err.message}`);
  }
}

// ── 2. Card Transactions ──

export async function syncCardTransactions(companyId: string): Promise<SyncResult> {
  try {
    // Fetch unclassified/unreconciled card transactions
    const { data: unmatched, error: fetchErr } = await db
      .from('card_transactions')
      .select('id, merchant_name, amount, category, deal_id, approved_at')
      .eq('company_id', companyId)
      .is('deal_id', null)
      .order('transaction_date', { ascending: false })
      .limit(200);

    if (fetchErr) return resultErr('card_transactions', `카드내역 조회 실패: ${fetchErr.message}`);
    if (!unmatched || unmatched.length === 0) {
      return resultOk('card_transactions', 0, '미분류 카드내역 없음 — 모두 최신');
    }

    // Load category classification rules from recurring_payments
    const { data: rules } = await db
      .from('recurring_payments')
      .select('payee_name, category')
      .eq('company_id', companyId)
      .eq('is_active', true);

    const ruleMap = new Map<string, string>();
    for (const r of rules || []) {
      if (r.payee_name && r.category) {
        ruleMap.set(r.payee_name.toLowerCase(), r.category);
      }
    }

    let classifiedCount = 0;

    for (const tx of unmatched) {
      const merchantLower = (tx.merchant_name || '').toLowerCase();

      // Try to auto-classify by matching merchant name against known payees
      let matchedCategory: string | null = null;
      for (const [payee, category] of Array.from(ruleMap.entries())) {
        if (merchantLower.includes(payee) || payee.includes(merchantLower)) {
          matchedCategory = category;
          break;
        }
      }

      if (matchedCategory && !tx.category) {
        const { error: upErr } = await db
          .from('card_transactions')
          .update({ category: matchedCategory, updated_at: now() })
          .eq('id', tx.id);

        if (!upErr) classifiedCount++;
      }
    }

    return resultOk(
      'card_transactions',
      unmatched.length,
      `미분류 ${unmatched.length}건 중 ${classifiedCount}건 자동분류 완료`
    );
  } catch (err: any) {
    return resultErr('card_transactions', `카드내역 동기화 오류: ${err.message}`);
  }
}

// ── 3. Fixed Costs ──

export async function syncFixedCosts(companyId: string, month?: string): Promise<SyncResult> {
  try {
    const { start, end } = monthRange(month);

    // Fetch active recurring payments
    const { data: recurring, error: recErr } = await db
      .from('recurring_payments')
      .select('id, payee_name, amount, category, due_day, is_active, last_paid_at')
      .eq('company_id', companyId)
      .eq('is_active', true);

    if (recErr) return resultErr('fixed_costs', `고정비 조회 실패: ${recErr.message}`);
    if (!recurring || recurring.length === 0) {
      return resultSkip('fixed_costs', '등록된 고정비(반복결제) 없음');
    }

    // Fetch actual payments this month from payment_queue
    const { data: actualPayments, error: pqErr } = await db
      .from('payment_queue')
      .select('id, amount, status, payee_name, recurring_payment_id')
      .eq('company_id', companyId)
      .gte('due_date', start)
      .lt('due_date', end);

    if (pqErr) return resultErr('fixed_costs', `결제대기열 조회 실패: ${pqErr.message}`);

    const paidRecurringIds = new Set(
      (actualPayments || [])
        .filter((p: any) => p.recurring_payment_id && p.status === 'paid')
        .map((p: any) => p.recurring_payment_id)
    );

    const pendingRecurringIds = new Set(
      (actualPayments || [])
        .filter((p: any) => p.recurring_payment_id && p.status !== 'paid')
        .map((p: any) => p.recurring_payment_id)
    );

    let generatedCount = 0;
    const overdueItems: string[] = [];

    for (const rp of recurring) {
      // Already has a payment entry for this month
      if (paidRecurringIds.has(rp.id) || pendingRecurringIds.has(rp.id)) continue;

      // Due day for the current month
      const dueDay = rp.due_day || 25;
      const dueDate = `${start.slice(0, 7)}-${String(dueDay).padStart(2, '0')}`;

      // Check if overdue (past due date and not paid)
      if (new Date(dueDate) < new Date()) {
        overdueItems.push(rp.payee_name || rp.category || 'Unknown');
      }

      // Generate payment queue entry for missing recurring payments
      const { error: insErr } = await db
        .from('payment_queue')
        .insert({
          company_id: companyId,
          recurring_payment_id: rp.id,
          payee_name: rp.payee_name,
          amount: rp.amount,
          category: rp.category,
          due_date: dueDate,
          status: 'pending',
          created_at: now(),
        });

      if (!insErr) generatedCount++;
    }

    const overdueMsg = overdueItems.length > 0
      ? ` (미납 ${overdueItems.length}건: ${overdueItems.slice(0, 3).join(', ')}${overdueItems.length > 3 ? ' 외' : ''})`
      : '';

    return resultOk(
      'fixed_costs',
      recurring.length,
      `고정비 ${recurring.length}건 확인, 신규 ${generatedCount}건 생성${overdueMsg}`
    );
  } catch (err: any) {
    return resultErr('fixed_costs', `고정비 동기화 오류: ${err.message}`);
  }
}

// ── 4. Income ──

export async function syncIncome(companyId: string, month?: string): Promise<SyncResult> {
  try {
    const { start, end } = monthRange(month);

    // Check tax invoices for payment status updates
    const { data: invoices, error: invErr } = await db
      .from('tax_invoices')
      .select('id, total_amount, status, deal_id, counterparty_name, issue_date')
      .eq('company_id', companyId)
      .in('status', ['issued', 'sent', 'pending'])
      .gte('issue_date', start)
      .lt('issue_date', end);

    if (invErr) return resultErr('income', `세금계산서 조회 실패: ${invErr.message}`);

    // Check for incoming payments (transactions with type = income this month)
    const { data: incomeTransactions, error: txErr } = await db
      .from('transactions')
      .select('id, amount, description, deal_id')
      .eq('company_id', companyId)
      .eq('type', 'income')
      .gte('created_at', start)
      .lt('created_at', end);

    if (txErr) return resultErr('income', `입금내역 조회 실패: ${txErr.message}`);

    // Try to match incoming payments to outstanding invoices
    const incomeTxDealIds = new Set(
      (incomeTransactions || []).filter((t: any) => t.deal_id).map((t: any) => t.deal_id)
    );

    let reconciledCount = 0;

    for (const inv of invoices || []) {
      // If invoice's deal has a matching income transaction, mark as paid
      if (inv.deal_id && incomeTxDealIds.has(inv.deal_id)) {
        const { error: upErr } = await db
          .from('tax_invoices')
          .update({ status: 'paid', updated_at: now() })
          .eq('id', inv.id);

        if (!upErr) reconciledCount++;
      }
    }

    // Calculate income summary
    const totalInvoiced = (invoices || []).reduce(
      (sum: number, inv: any) => sum + (Number(inv.total_amount) || 0), 0
    );
    const totalReceived = (incomeTransactions || []).reduce(
      (sum: number, tx: any) => sum + (Number(tx.amount) || 0), 0
    );

    const pendingCount = (invoices || []).length - reconciledCount;

    return resultOk(
      'income',
      (invoices || []).length + (incomeTransactions || []).length,
      `매출 ${(invoices || []).length}건 (미수금 ${pendingCount}건), 입금 ${(incomeTransactions || []).length}건 확인, ${reconciledCount}건 자동매칭`
    );
  } catch (err: any) {
    return resultErr('income', `매출 동기화 오류: ${err.message}`);
  }
}

// ── 5. Master Sync ──

export async function syncAllData(
  companyId: string,
  month?: string,
  triggeredBy?: string
): Promise<SyncStatus> {
  const startedAt = now();

  // Create sync log entry
  const { data: logEntry, error: logErr } = await db
    .from('sync_logs')
    .insert({
      company_id: companyId,
      sync_type: 'full',
      status: 'running',
      started_at: startedAt,
      triggered_by: triggeredBy || null,
    })
    .select('id')
    .single();

  const logId = logEntry?.id;

  // Run all syncs in sequence to avoid race conditions on shared data
  const results: SyncResult[] = [];

  results.push(await syncBankBalances(companyId));
  results.push(await syncCardTransactions(companyId));
  results.push(await syncFixedCosts(companyId, month));
  results.push(await syncIncome(companyId, month));

  const totalItems = results.reduce((sum, r) => sum + r.itemCount, 0);
  const hasErrors = results.some(r => r.status === 'error');
  const completedAt = now();

  // Update sync log
  if (logId) {
    await db
      .from('sync_logs')
      .update({
        status: hasErrors ? 'failed' : 'completed',
        results: JSON.stringify(results),
        total_items: totalItems,
        completed_at: completedAt,
      })
      .eq('id', logId);
  }

  // Audit trail
  if (triggeredBy) {
    await logAudit({
      company_id: companyId,
      user_id: triggeredBy,
      action: 'update',
      entity_type: 'sync',
      entity_id: logId || 'unknown',
      entity_name: '데이터 최신화',
      metadata: {
        sync_type: 'full',
        total_items: totalItems,
        has_errors: hasErrors,
        results: results.map(r => ({ source: r.source, status: r.status, count: r.itemCount })),
      },
    });
  }

  return {
    isRunning: false,
    lastSyncAt: completedAt,
    results,
    totalItems,
  };
}

// ── 6. Get Last Sync Status ──

export async function getLastSyncStatus(companyId: string): Promise<SyncStatus> {
  try {
    const { data, error } = await db
      .from('sync_logs')
      .select('*')
      .eq('company_id', companyId)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (error || !data) {
      return { isRunning: false, lastSyncAt: null, results: [], totalItems: 0 };
    }

    let results: SyncResult[] = [];
    try {
      results = typeof data.results === 'string' ? JSON.parse(data.results) : (data.results || []);
    } catch {
      results = [];
    }

    return {
      isRunning: data.status === 'running',
      lastSyncAt: data.completed_at || data.started_at,
      results,
      totalItems: data.total_items || 0,
    };
  } catch (err: any) {
    console.error('getLastSyncStatus error:', err.message);
    return { isRunning: false, lastSyncAt: null, results: [], totalItems: 0 };
  }
}

// ── 7. Auto-Detect Fixed Costs ──

export async function autoDetectFixedCosts(companyId: string): Promise<DetectedFixedCost[]> {
  try {
    // Look back 3 months of transactions
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);

    const { data: txns, error } = await db
      .from('transactions')
      .select('amount, description, type, created_at')
      .eq('company_id', companyId)
      .eq('type', 'expense')
      .gte('created_at', threeMonthsAgo.toISOString())
      .order('created_at', { ascending: false })
      .limit(2000);

    if (error || !txns || txns.length === 0) return [];

    // Also check card transactions
    const { data: cardTxns } = await db
      .from('card_transactions')
      .select('amount, merchant_name, transaction_date')
      .eq('company_id', companyId)
      .gte('transaction_date', threeMonthsAgo.toISOString())
      .order('transaction_date', { ascending: false })
      .limit(2000);

    // Group by payee + approximate amount (within 5% tolerance)
    const payeeMap = new Map<string, { amounts: number[]; dates: string[] }>();

    for (const tx of txns) {
      const key = (tx.description || '').trim().toLowerCase();
      if (!key) continue;
      const entry = payeeMap.get(key) || { amounts: [], dates: [] };
      entry.amounts.push(Number(tx.amount) || 0);
      entry.dates.push(tx.created_at);
      payeeMap.set(key, entry);
    }

    for (const ct of cardTxns || []) {
      const key = (ct.merchant_name || '').trim().toLowerCase();
      if (!key) continue;
      const entry = payeeMap.get(key) || { amounts: [], dates: [] };
      entry.amounts.push(Number(ct.amount) || 0);
      entry.dates.push(ct.transaction_date);
      payeeMap.set(key, entry);
    }

    // Filter for recurring patterns: at least 2 occurrences with similar amounts
    const detected: DetectedFixedCost[] = [];

    for (const [payee, data] of Array.from(payeeMap.entries())) {
      if (data.amounts.length < 2) continue;

      // Check amount consistency (all within 10% of median)
      const sorted = [...data.amounts].sort((a, b) => a - b);
      const median = sorted[Math.floor(sorted.length / 2)];
      if (median === 0) continue;

      const consistent = data.amounts.filter(
        a => Math.abs(a - median) / median <= 0.1
      );

      if (consistent.length < 2) continue;

      // Check date regularity — are they roughly monthly?
      const sortedDates = data.dates
        .map(d => new Date(d).getTime())
        .sort((a, b) => a - b);

      let monthlyGaps = 0;
      for (let i = 1; i < sortedDates.length; i++) {
        const diffDays = (sortedDates[i] - sortedDates[i - 1]) / (1000 * 60 * 60 * 24);
        if (diffDays >= 25 && diffDays <= 35) monthlyGaps++;
      }

      const frequency: 'monthly' | 'quarterly' | 'annual' =
        monthlyGaps >= consistent.length - 1 ? 'monthly' :
        consistent.length >= 4 ? 'quarterly' : 'annual';

      // Confidence score based on consistency and occurrence count
      const amountConsistency = consistent.length / data.amounts.length;
      const frequencyConfidence = monthlyGaps / Math.max(1, sortedDates.length - 1);
      const occurrenceBonus = Math.min(data.amounts.length / 3, 1); // max bonus at 3+
      const confidence = Math.round(
        (amountConsistency * 0.4 + frequencyConfidence * 0.4 + occurrenceBonus * 0.2) * 100
      ) / 100;

      if (confidence < 0.3) continue;

      // Infer category from payee name
      const category = inferCategory(payee);

      detected.push({
        payee,
        amount: Math.round(median),
        frequency,
        category,
        confidence,
        lastSeen: data.dates.sort().reverse()[0],
        occurrences: data.amounts.length,
      });
    }

    // Sort by confidence descending
    detected.sort((a, b) => b.confidence - a.confidence);

    return detected;
  } catch (err: any) {
    console.error('autoDetectFixedCosts error:', err.message);
    return [];
  }
}

// ── Category Inference ──

function inferCategory(payee: string): string {
  const lower = payee.toLowerCase();

  const patterns: [RegExp, string][] = [
    [/임대|월세|관리비|부동산/, '임대료'],
    [/보험|인슈어|insurance/, '보험료'],
    [/통신|skt|kt|lgu|인터넷/, '통신비'],
    [/전기|한전|가스|수도|에너지/, '공과금'],
    [/급여|인건비|salary/, '인건비'],
    [/구독|subscription|saas|클라우드|aws|gcp|azure/, 'SaaS/구독'],
    [/세무|회계|법무|컨설팅|자문/, '전문용역비'],
    [/택배|배송|물류|운송/, '물류비'],
    [/광고|마케팅|홍보|ads|google|meta|facebook|naver/, '광고비'],
    [/교육|학원|세미나|training/, '교육비'],
    [/리스|lease|렌탈|렌트/, '리스/렌탈'],
    [/청소|미화|용역/, '시설관리비'],
  ];

  for (const [regex, cat] of patterns) {
    if (regex.test(lower)) return cat;
  }

  return '기타 고정비';
}

// ── CODEF Account Registration ──

export async function registerCodefAccount(
  companyId: string,
  accountType: 'bank' | 'card',
  organization: string,
  loginId: string,
  loginPw: string,
): Promise<{ success: boolean; connectedId?: string; accountList?: any[]; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: '로그인이 필요합니다' };

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return { success: false, error: 'Supabase URL이 설정되지 않았습니다' };

    const res = await fetch(`${supabaseUrl}/functions/v1/codef-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({
        companyId,
        action: 'register',
        accountType,
        organization,
        loginId,
        loginPw,
      }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '계정 등록 오류' }));
      return { success: false, error: err.error || `HTTP ${res.status}` };
    }

    const result = await res.json();
    return {
      success: true,
      connectedId: result.connectedId,
      accountList: result.accountList,
    };
  } catch (err: any) {
    return { success: false, error: err.message || '계정 등록 실패' };
  }
}

export async function listCodefAccounts(
  companyId: string,
  accountType: 'bank' | 'card' = 'bank',
): Promise<{ success: boolean; accounts?: any[]; error?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: '로그인이 필요합니다' };

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return { success: false, error: 'Supabase URL이 설정되지 않았습니다' };

    const res = await fetch(`${supabaseUrl}/functions/v1/codef-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ companyId, action: 'list-accounts', accountType }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: '계좌 목록 조회 오류' }));
      return { success: false, error: err.error || `HTTP ${res.status}` };
    }

    const result = await res.json();
    return { success: true, accounts: result.accounts };
  } catch (err: any) {
    return { success: false, error: err.message || '계좌 목록 조회 실패' };
  }
}

// ── CODEF API Sync ──

export async function syncCodefData(
  companyId: string,
  syncType: 'bank' | 'card' | 'all' = 'all',
  startDate?: string,
  endDate?: string,
): Promise<{ success: boolean; error?: string; message?: string }> {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) return { success: false, error: '로그인이 필요합니다' };

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!supabaseUrl) return { success: false, error: 'Supabase URL이 설정되지 않았습니다' };

    const res = await fetch(`${supabaseUrl}/functions/v1/codef-sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${session.access_token}`,
      },
      body: JSON.stringify({ companyId, syncType, startDate, endDate }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: 'CODEF 연동 오류' }));
      return { success: false, error: err.error || `HTTP ${res.status}` };
    }

    const result = await res.json();
    return {
      success: true,
      message: `CODEF 동기화 완료: ${JSON.stringify(result.results || {})}`,
    };
  } catch (err: any) {
    return { success: false, error: err.message || 'CODEF 동기화 실패' };
  }
}
