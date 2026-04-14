import { NextRequest, NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
const CRON_SECRET = process.env.CRON_SECRET;

function getSupabaseAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );
}

function fmtKrw(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '0원';
  const sign = n < 0 ? '-' : '';
  const abs = Math.abs(n);
  const eok = Math.floor(abs / 1e8);
  const man = Math.floor((abs % 1e8) / 1e4);
  if (eok > 0 && man > 0) return `${sign}${eok}억 ${man.toLocaleString()}만원`;
  if (eok > 0) return `${sign}${eok}억원`;
  if (man > 0) return `${sign}${man.toLocaleString()}만원`;
  return `${sign}${abs.toLocaleString()}원`;
}

function todayStr(): string {
  const d = new Date();
  const days = ['일', '월', '화', '수', '목', '금', '토'];
  return `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${days[d.getDay()]})`;
}

interface DailyReport {
  companyName: string;
  date: string;
  cashBalance: number;
  yesterdayIncome: number;
  yesterdayExpense: number;
  yesterdayNet: number;
  activeDeals: number;
  pipelineValue: number;
  arOver30: number;
  arOver30Count: number;
  pendingApprovals: number;
  runwayMonths: number;
  alerts: string[];
}

async function buildDailyReport(companyId: string): Promise<DailyReport> {
  const db = getSupabaseAdmin() as any;

  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  const yStr = yesterday.toISOString().split('T')[0];

  const [companyRes, cashRes, txRes, dealsRes, arRes, approvalRes] = await Promise.all([
    db.from('companies').select('name').eq('id', companyId).single(),
    db.from('bank_accounts').select('balance').eq('company_id', companyId),
    db.from('transactions').select('amount, type').eq('company_id', companyId).gte('transaction_date', yStr).lt('transaction_date', new Date().toISOString().split('T')[0]),
    db.from('deals').select('id, contract_amount, status').eq('company_id', companyId).in('status', ['active', 'in_progress', 'negotiation', 'proposal']),
    db.from('deal_revenue_schedule').select('amount, due_date, deal_id').eq('company_id', companyId).eq('status', 'pending'),
    db.from('ai_pending_actions').select('id').eq('company_id', companyId).eq('status', 'pending'),
  ]);

  const cashBalance = (cashRes.data || []).reduce((s: number, a: any) => s + Number(a.balance || 0), 0);

  const txs = txRes.data || [];
  const yesterdayIncome = txs.filter((t: any) => t.type === 'income').reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
  const yesterdayExpense = txs.filter((t: any) => t.type === 'expense').reduce((s: number, t: any) => s + Number(t.amount || 0), 0);

  const deals = dealsRes.data || [];
  const pipelineValue = deals.reduce((s: number, d: any) => s + Number(d.contract_amount || 0), 0);

  const now = new Date();
  const thirtyDaysAgo = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
  const overdue = (arRes.data || []).filter((r: any) => r.due_date && r.due_date < thirtyDaysAgo);
  const arOver30 = overdue.reduce((s: number, r: any) => s + Number(r.amount || 0), 0);

  const monthlyBurn = yesterdayExpense * 30;
  const runwayMonths = monthlyBurn > 0 ? Math.round(cashBalance / monthlyBurn) : 99;

  const alerts: string[] = [];
  if (runwayMonths <= 3) alerts.push(`⚠️ 런웨이 ${runwayMonths}개월 — 긴급 자금 점검 필요`);
  if (arOver30 > 0) alerts.push(`💸 미수금 30일+ ${fmtKrw(arOver30)} (${overdue.length}건)`);
  if ((approvalRes.data || []).length > 0) alerts.push(`📋 승인 대기 ${(approvalRes.data || []).length}건`);
  if (yesterdayExpense > yesterdayIncome * 2 && yesterdayExpense > 0) alerts.push(`🔴 어제 지출이 수입의 2배 이상`);

  return {
    companyName: companyRes.data?.name || '내 회사',
    date: todayStr(),
    cashBalance,
    yesterdayIncome,
    yesterdayExpense,
    yesterdayNet: yesterdayIncome - yesterdayExpense,
    activeDeals: deals.length,
    pipelineValue,
    arOver30,
    arOver30Count: overdue.length,
    pendingApprovals: (approvalRes.data || []).length,
    runwayMonths,
    alerts,
  };
}

function formatTelegramMessage(r: DailyReport): string {
  const netEmoji = r.yesterdayNet >= 0 ? '📈' : '📉';
  const runwayEmoji = r.runwayMonths <= 3 ? '🔴' : r.runwayMonths <= 6 ? '🟡' : '🟢';

  let msg = `📊 *${r.companyName} 자금일보*\n`;
  msg += `${r.date}\n\n`;

  msg += `💰 *통장 잔고*: ${fmtKrw(r.cashBalance)}\n`;
  msg += `${runwayEmoji} *런웨이*: ${r.runwayMonths}개월\n\n`;

  msg += `*어제 거래*\n`;
  msg += `  수입: +${fmtKrw(r.yesterdayIncome)}\n`;
  msg += `  지출: -${fmtKrw(r.yesterdayExpense)}\n`;
  msg += `  ${netEmoji} 순: ${fmtKrw(r.yesterdayNet)}\n\n`;

  msg += `*영업 현황*\n`;
  msg += `  진행 딜: ${r.activeDeals}건 (${fmtKrw(r.pipelineValue)})\n`;
  if (r.arOver30 > 0) {
    msg += `  ⚠️ 미수금 30일+: ${fmtKrw(r.arOver30)} (${r.arOver30Count}건)\n`;
  }
  if (r.pendingApprovals > 0) {
    msg += `  📋 승인 대기: ${r.pendingApprovals}건\n`;
  }

  if (r.alerts.length > 0) {
    msg += `\n*알림*\n`;
    r.alerts.forEach(a => { msg += `  ${a}\n`; });
  }

  msg += `\n_오너뷰에서 자세히 보기_\nhttps://www.owner-view.com/dashboard`;
  return msg;
}

async function sendTelegram(text: string): Promise<boolean> {
  const res = await fetch(`https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'Markdown',
      disable_web_page_preview: true,
    }),
  });
  return res.ok;
}

export async function GET(request: NextRequest) {
  const authHeader = request.headers.get('authorization');
  if (CRON_SECRET && authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json(
      { error: { code: 'UNAUTHORIZED', message: 'Invalid cron secret' } },
      { status: 401 },
    );
  }

  if (!TELEGRAM_BOT_TOKEN || !TELEGRAM_CHAT_ID) {
    return NextResponse.json(
      { error: { code: 'CONFIG_MISSING', message: 'Telegram credentials not configured' } },
      { status: 500 },
    );
  }

  try {
    const db = getSupabaseAdmin() as any;
    const { data: companies } = await db
      .from('subscriptions')
      .select('company_id')
      .in('status', ['active', 'trialing']);

    const companyIds: string[] = (companies || []).map((c: any) => c.company_id);

    if (companyIds.length === 0) {
      const { data: allCompanies } = await db.from('companies').select('id').limit(10);
      (allCompanies || []).forEach((c: any) => companyIds.push(c.id));
    }

    const results = [];
    for (const cid of companyIds) {
      const report = await buildDailyReport(cid);
      const message = formatTelegramMessage(report);
      const sent = await sendTelegram(message);
      results.push({ companyId: cid, companyName: report.companyName, sent });
    }

    return NextResponse.json({ data: { reports: results, count: results.length } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Daily report generation failed';
    console.error('Daily report error:', message);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { companyId } = body;

    if (!companyId) {
      return NextResponse.json(
        { error: { code: 'VALIDATION_ERROR', message: 'companyId는 필수입니다' } },
        { status: 400 },
      );
    }

    const report = await buildDailyReport(companyId);
    const message = formatTelegramMessage(report);
    const sent = await sendTelegram(message);

    return NextResponse.json({ data: { report, sent } });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Daily report generation failed';
    console.error('Daily report error:', message);
    return NextResponse.json(
      { error: { code: 'INTERNAL_ERROR', message } },
      { status: 500 },
    );
  }
}
