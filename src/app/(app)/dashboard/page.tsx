"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { getCurrentUser, getFounderData, saveExcelData, getFinancialDashboardData, getDrillDownLevel2, getDrillDownLevel3, getDrillDownLevel4 } from "@/lib/queries";
import { buildFounderDashboard, buildFinancialDashboard as buildFinDash, type FounderDashboardData, type FinancialDashboardData, type RiskLabel, type RiskItem, getRunwayLevel } from "@/lib/engines";
import { parseExcel, type ParsedExcelData } from "@/lib/excel-parser";
import { generateSampleData } from "@/lib/sample-data";
import { exportFinancialReport, exportDrillDownItems } from "@/lib/excel-export";
import { generateMonthlyPLReport } from "@/lib/pdf-report";
import { getOrCreateChecklist, toggleChecklistItem, completeClosingChecklist } from "@/lib/closing";
import { BarChart } from "@/components/bar-chart";
import { DrillDownTable } from "@/components/drill-down-table";
import Link from "next/link";

// ── Formatters ──
function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}${abs.toLocaleString()}`;
}
function fmtWFull(n: number): string {
  return `₩${n.toLocaleString()}`;
}

const LEVEL_CONFIG = {
  CRITICAL: { label: '긴급', color: '#ff2d55', bg: 'rgba(255,45,85,0.08)', border: 'rgba(255,45,85,0.3)' },
  DANGER:   { label: '위험', color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)' },
  WARNING:  { label: '주의', color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)' },
  STABLE:   { label: '안정', color: '#22c55e', bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.15)' },
  SAFE:     { label: '안전', color: '#22c55e', bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.15)' },
};

const RISK_LABELS: Record<RiskLabel, { title: string; icon: string; color: string }> = {
  LOW_MARGIN:             { title: '마진 20% 이하', icon: '📉', color: 'var(--danger)' },
  DUE_SOON:               { title: 'D-7 이내 마감', icon: '⏰', color: 'var(--warning)' },
  AR_OVER_30:             { title: '미수금 30일+', icon: '💸', color: 'var(--danger)' },
  OUTSOURCE_OVER_MARGIN:  { title: '외주비 마진잠식', icon: '🔥', color: '#ff6b35' },
};

// ═══════════════════════════════════════════
// Main Component
// ═══════════════════════════════════════════
export default function DashboardPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [userName, setUserName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [parseResult, setParseResult] = useState<{ success: boolean; message: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setCompanyId(u.company_id);
        setUserId(u.id);
        setUserName(u.name || u.email);
        setCompanyName(u.companies?.name || "");
      }
    });
  }, []);

  // Fetch data from DB
  const { data: rawData } = useQuery({
    queryKey: ["founder-data", companyId],
    queryFn: () => getFounderData(companyId!),
    enabled: !!companyId,
    refetchInterval: 30_000,
    retry: 1,
  });

  // Build dashboard through engines (always returns valid data, never null)
  const dashboard: FounderDashboardData = rawData
    ? buildFounderDashboard(
        rawData.currentMonth,
        rawData.items,
        rawData.deals,
        rawData.targets,
        rawData.quarterRevenue,
        rawData.yearRevenue,
      )
    : buildFounderDashboard(null, [], [], { monthTarget: 0, quarterTarget: 0, yearTarget: 0 }, 0, 0);

  const hasData = rawData?.hasData || false;
  const level = getRunwayLevel(dashboard.sixPack.runwayMonths);
  const cfg = LEVEL_CONFIG[level];

  // ── Excel Upload Handler ──
  const handleExcelUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;
    setUploading(true);
    setParseResult(null);

    try {
      const buffer = await file.arrayBuffer();
      const parsed: ParsedExcelData = parseExcel(buffer);

      // Save to DB
      await saveExcelData(
        companyId,
        parsed.months.map(m => ({
          month: m.month,
          bank_balance: m.bankBalance,
          total_income: m.totalIncome,
          total_expense: m.totalExpense,
          fixed_cost: m.fixedCost,
          variable_cost: m.variableCost,
          net_cashflow: m.netCashflow,
          revenue: m.revenue,
        })),
        parsed.items.map(i => ({
          category: i.category,
          name: i.name,
          amount: i.amount,
          due_date: i.dueDate,
          status: i.status,
          project_name: i.projectName,
          account_type: i.accountType,
          month: i.month,
        })),
      );

      setParseResult({
        success: true,
        message: `파싱 완료: ${parsed.months.length}개월, ${parsed.items.length}개 항목\n잔고: ₩${parsed.summary.bankBalance.toLocaleString()}\n월 고정비: ₩${parsed.summary.fixedCost.toLocaleString()}`
      });
      queryClient.invalidateQueries({ queryKey: ["founder-data"] });
    } catch (err: any) {
      setParseResult({ success: false, message: `파싱 실패: ${err.message}` });
    }
    setUploading(false);
    if (fileRef.current) fileRef.current.value = '';
  }, [companyId, queryClient]);

  // ── Sample Data Handler ──
  const handleSampleData = useCallback(async () => {
    if (!companyId) return;
    setGenerating(true);
    const result = await generateSampleData(companyId);
    setParseResult(result);
    queryClient.invalidateQueries({ queryKey: ["founder-data"] });
    setGenerating(false);
  }, [companyId, queryClient]);

  const sp = dashboard.sixPack;

  return (
    <div className="max-w-[1100px]">
      {/* ═══ HEADER ═══ */}
      <div className="flex items-center justify-between mb-4">
        <div>
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-lg font-black tracking-tight">SURVIVAL COMMAND CENTER</h1>
            <div className="px-2 py-0.5 rounded-md text-[10px] font-black uppercase tracking-wider"
              style={{ background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}` }}>
              {cfg.label}
            </div>
          </div>
          <p className="text-[11px] text-[var(--text-dim)]">
            {companyName} · {userName} · {new Date().toLocaleDateString('ko-KR')}
          </p>
        </div>

        {/* Upload / Sample buttons */}
        <div className="flex items-center gap-2">
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="px-3 py-1.5 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] text-[11px] font-semibold hover:bg-[var(--primary)]/20 transition disabled:opacity-50">
            {uploading ? '파싱 중...' : '엑셀 업로드'}
          </button>
          <button onClick={handleSampleData} disabled={generating}
            className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] text-[var(--text-muted)] text-[11px] font-semibold hover:bg-[var(--bg-elevated)] transition disabled:opacity-50">
            {generating ? '생성 중...' : '샘플 데이터'}
          </button>
        </div>
      </div>

      {/* Parse result toast */}
      {parseResult && (
        <div className={`mb-4 p-3 rounded-lg text-xs whitespace-pre-line ${
          parseResult.success ? 'bg-green-500/10 border border-green-500/20 text-green-400'
            : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          {parseResult.message}
          <button onClick={() => setParseResult(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
        </div>
      )}

      {/* ═══ 6-PACK: 상단 고정 생존 지표 ═══ */}
      <div className={`rounded-2xl p-1 mb-5 survival-bar ${
        level === 'CRITICAL' || level === 'DANGER' ? 'animate-glow-red' : level === 'WARNING' ? 'animate-glow-orange' : ''
      }`} style={{ border: `1px solid ${cfg.border}` }}>
        <div className="grid grid-cols-6 divide-x divide-[var(--border)]">
          <SixPackCell
            label="통장 잔고"
            value={`₩${fmtW(sp.cashBalance)}`}
            color={sp.cashBalance <= 0 ? 'var(--danger)' : 'var(--text)'}
          />
          <SixPackCell
            label="이번달 순현금흐름"
            value={`${sp.netCashflow >= 0 ? '+' : ''}₩${fmtW(sp.netCashflow)}`}
            color={sp.netCashflow >= 0 ? 'var(--success)' : 'var(--danger)'}
          />
          <SixPackCell
            label="생존 개월"
            value={sp.runwayMonths < 999 ? `${sp.runwayMonths}개월` : '안전'}
            color={cfg.color}
            highlight={level === 'CRITICAL' || level === 'DANGER'}
          />
          <SixPackCell
            label="미수금"
            value={`₩${fmtW(sp.arTotal)}`}
            sub={sp.arOver30 > 0 ? `30일+ ₩${fmtW(sp.arOver30)}` : undefined}
            color={sp.arOver30 > 0 ? 'var(--danger)' : sp.arTotal > 0 ? 'var(--warning)' : 'var(--text-muted)'}
          />
          <SixPackCell
            label="승인대기 비용"
            value={`₩${fmtW(sp.pendingApprovals)}`}
            color={sp.pendingApprovals > 0 ? 'var(--warning)' : 'var(--text-muted)'}
          />
          <SixPackCell
            label="월 고정비(Burn)"
            value={`₩${fmtW(sp.monthlyBurn)}`}
            color="var(--text)"
          />
        </div>
      </div>

      {/* No data CTA */}
      {!hasData && (
        <div className="mb-5 p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] text-center">
          <div className="text-sm text-[var(--text-muted)] mb-3">
            데이터가 없습니다. 보고 엑셀을 업로드하거나 샘플 데이터를 생성하세요.
          </div>
          <div className="flex items-center justify-center gap-3">
            <button onClick={() => fileRef.current?.click()}
              className="px-4 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold hover:bg-[var(--primary-hover)] transition">
              보고 엑셀 업로드
            </button>
            <button onClick={handleSampleData}
              className="px-4 py-2 rounded-lg bg-[var(--bg-surface)] text-[var(--text-muted)] text-sm font-semibold hover:bg-[var(--bg-elevated)] transition">
              샘플 데이터 생성
            </button>
          </div>
        </div>
      )}

      {/* ═══ RISK ZONE: 위험 딜/항목 4카드 ═══ */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <div className={`w-2 h-2 rounded-full ${
            Object.values(dashboard.riskCounts).some(c => c > 0) ? 'bg-[var(--danger)] animate-pulse-danger' : 'bg-[var(--success)]'
          }`} />
          <h2 className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-wider">위험 구역</h2>
          <span className="text-[10px] text-[var(--text-dim)]">
            {dashboard.risks.length}건
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(Object.keys(RISK_LABELS) as RiskLabel[]).map(label => (
            <RiskCard
              key={label}
              label={label}
              items={dashboard.risks.filter(r => r.label === label)}
              count={dashboard.riskCounts[label]}
            />
          ))}
        </div>
      </div>

      {/* ═══ GROWTH ZONE: 성장 영역 ═══ */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-[var(--success)]" />
          <h2 className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-wider">성장 영역</h2>
        </div>
        <GrowthSection growth={dashboard.growth} />
      </div>

      {/* ═══ FINANCIAL OVERVIEW: 재무 개요 ═══ */}
      <FinancialOverview companyId={companyId} />

      {/* ═══ MONTHLY CLOSING CHECKLIST ═══ */}
      <ClosingChecklistWidget companyId={companyId} userId={userId} />

      {/* ═══ Quick Actions: 오늘 해야 할 것 ═══ */}
      <div className="mb-5">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-[var(--primary)]" />
          <h2 className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-wider">오늘의 액션</h2>
        </div>
        <TodayActions dashboard={dashboard} />
      </div>
    </div>
  );
}

// ═══ Sub-components ═══

function SixPackCell({ label, value, sub, color, highlight }: {
  label: string; value: string; sub?: string; color: string; highlight?: boolean;
}) {
  return (
    <div className={`px-3 py-3 ${highlight ? 'animate-pulse-danger' : ''}`}>
      <div className="text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-sm font-black mono-number" style={{ color }}>{value}</div>
      {sub && <div className="text-[9px] text-[var(--danger)] font-semibold mt-0.5">{sub}</div>}
    </div>
  );
}

function RiskCard({ label, items, count }: { label: RiskLabel; items: RiskItem[]; count: number }) {
  const cfg = RISK_LABELS[label];
  const hasDanger = count > 0;

  return (
    <div className={`risk-card rounded-xl border p-4 ${
      hasDanger ? 'border-red-500/20 bg-red-500/[.02]' : 'border-[var(--border)] bg-[var(--bg-card)]'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="text-base">{cfg.icon}</span>
          <span className="text-xs font-bold text-[var(--text)]">{cfg.title}</span>
        </div>
        <span className={`text-lg font-black mono-number ${hasDanger ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>
          {count}
        </span>
      </div>

      {items.length > 0 ? (
        <div className="space-y-1.5 mb-3">
          {items.slice(0, 3).map((item, i) => (
            <div key={i} className="flex items-center justify-between text-[11px] px-2 py-1 rounded bg-[var(--bg-surface)]">
              <span className="text-[var(--text-muted)] truncate flex-1">{item.name}</span>
              <span className="text-[var(--text-dim)] ml-2 shrink-0">{item.detail}</span>
            </div>
          ))}
          {items.length > 3 && (
            <div className="text-[10px] text-[var(--text-dim)] px-2">+{items.length - 3}건 더</div>
          )}
        </div>
      ) : (
        <div className="text-[11px] text-[var(--text-dim)] mb-3">해당 위험 없음</div>
      )}

      {/* 즉시 조치 버튼 */}
      <div className="flex flex-wrap gap-1.5">
        {label === 'AR_OVER_30' && (
          <>
            <ActionBtn text="독촉 메시지 생성" />
            <ActionBtn text="세금계산서 요청" />
          </>
        )}
        {label === 'LOW_MARGIN' && (
          <>
            <ActionBtn text="딜 상태 변경" href="/deals" />
            <ActionBtn text="비용 재검토" />
          </>
        )}
        {label === 'DUE_SOON' && (
          <>
            <ActionBtn text="일정 재조정" />
            <ActionBtn text="딜 상태 변경" href="/deals" />
          </>
        )}
        {label === 'OUTSOURCE_OVER_MARGIN' && (
          <>
            <ActionBtn text="지급 승인 보류" />
            <ActionBtn text="비용 재검토" />
          </>
        )}
      </div>
    </div>
  );
}

function ActionBtn({ text, href }: { text: string; href?: string }) {
  const cls = "px-2 py-1 rounded text-[10px] font-semibold bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition cursor-pointer";
  if (href) return <Link href={href} className={cls}>{text}</Link>;
  return <button className={cls} onClick={() => alert(`[준비중] ${text}`)}>{text}</button>;
}

function GrowthSection({ growth }: { growth: FounderDashboardData['growth'] }) {
  const metrics = [
    { label: '이번달', revenue: growth.monthRevenue, target: growth.monthTarget, gap: growth.monthGap },
    { label: '이번분기', revenue: growth.quarterRevenue, target: growth.quarterTarget, gap: growth.quarterGap },
    { label: '올해', revenue: growth.yearRevenue, target: growth.yearTarget, gap: growth.yearGap },
  ];

  return (
    <div className="grid grid-cols-3 gap-3">
      {metrics.map(m => {
        const pct = m.target > 0 ? Math.min(100, (m.revenue / m.target) * 100) : 0;
        return (
          <div key={m.label} className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
            <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-2">
              {m.label} 매출
            </div>
            <div className="text-lg font-black mono-number text-[var(--text)]">₩{fmtW(m.revenue)}</div>
            {m.target > 0 && (
              <>
                <div className="mt-2 flex items-center gap-2">
                  <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                    <div className={`h-full rounded-full transition-all duration-500 ${
                      pct >= 100 ? 'bg-[var(--success)]' : pct >= 70 ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]'
                    }`} style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-[10px] text-[var(--text-dim)] mono-number">{pct.toFixed(0)}%</span>
                </div>
                <div className="flex items-center justify-between mt-1.5 text-[10px]">
                  <span className="text-[var(--text-dim)]">목표 ₩{fmtW(m.target)}</span>
                  <span className={m.gap > 0 ? 'text-[var(--danger)] font-bold' : 'text-[var(--success)] font-bold'}>
                    {m.gap > 0 ? `부족 ₩${fmtW(m.gap)}` : '달성'}
                  </span>
                </div>
              </>
            )}
            {m.target === 0 && (
              <div className="text-[10px] text-[var(--text-dim)] mt-1">
                <Link href="/settings" className="text-[var(--primary)] hover:underline">목표 설정 →</Link>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function FinancialOverview({ companyId }: { companyId: string | null }) {
  const [period, setPeriod] = useState<'6M' | '1Y'>('6M');
  const [drillMonth, setDrillMonth] = useState<number | null>(null);
  const [drillLevel, setDrillLevel] = useState<1 | 2 | 3 | 4>(1);
  const [drillCategory, setDrillCategory] = useState<string | null>(null);
  const [drillCounterparty, setDrillCounterparty] = useState<string | null>(null);

  const { data: finRaw } = useQuery({
    queryKey: ['financial-dashboard', companyId],
    queryFn: () => getFinancialDashboardData(companyId!),
    enabled: !!companyId,
  });

  // Compute finData + sliced early so hooks below can reference drillMonth safely
  const finData: FinancialDashboardData | null = finRaw
    ? buildFinDash(
        finRaw.allMonths.map((m: any) => ({
          month: m.month,
          revenue: Number(m.revenue || 0),
          totalIncome: Number(m.total_income || 0),
          totalExpense: Number(m.total_expense || 0),
        })),
        finRaw.deals.map((d: any) => ({
          classification: d.classification || 'B2B',
          contractTotal: Number(d.contract_total || 0),
          revenue: Number(d.contract_total || 0),
          cost: 0,
        })),
        finRaw.classificationColors || {},
      )
    : null;

  const sliced = finData
    ? (period === '6M' ? finData.monthlyChart.slice(-6) : finData.monthlyChart.slice(-12))
    : [];

  // Helper: resolve the drill month string for query keys
  const drillMonthStr = drillMonth !== null && sliced[drillMonth] ? sliced[drillMonth].month : null;

  // ── Level 2/3/4 Drill-Down Queries ──
  const { data: drillL2 = [] } = useQuery({
    queryKey: ['drill-l2', companyId, drillMonthStr],
    queryFn: () => getDrillDownLevel2(companyId!, drillMonthStr!),
    enabled: !!companyId && !!drillMonthStr && drillLevel >= 2,
  });

  const { data: drillL3 = [] } = useQuery({
    queryKey: ['drill-l3', companyId, drillMonthStr, drillCategory],
    queryFn: () => getDrillDownLevel3(companyId!, drillMonthStr!, drillCategory!),
    enabled: !!companyId && !!drillMonthStr && drillLevel >= 3 && !!drillCategory,
  });

  const { data: drillL4 = [] } = useQuery({
    queryKey: ['drill-l4', companyId, drillMonthStr, drillCategory, drillCounterparty],
    queryFn: () => getDrillDownLevel4(companyId!, drillMonthStr!, drillCategory!, drillCounterparty!),
    enabled: !!companyId && !!drillMonthStr && drillLevel >= 4 && !!drillCategory && !!drillCounterparty,
  });

  if (!finRaw || !finData) return null;

  const barData = sliced.map(m => ({
    label: m.label,
    values: [
      { value: m.revenue, color: 'var(--primary)', label: '매출' },
      { value: m.expense, color: '#ef4444', label: '비용' },
    ],
  }));

  const trendLine = sliced.map(m => m.netIncome);

  // Drill-down items for selected month
  const drillItems = drillMonth !== null && sliced[drillMonth]
    ? (finRaw.items || []).filter((i: any) => i.month === sliced[drillMonth].month).map((i: any) => ({
        name: i.name || i.category || '-',
        category: i.category || 'expense',
        amount: Number(i.amount || 0),
        status: i.status || 'confirmed',
        due_date: i.due_date || null,
      }))
    : [];

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--primary)]" />
          <h2 className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-wider">재무 개요</h2>
        </div>
        <div className="flex items-center gap-2">
          {/* Period Toggle */}
          <div className="flex rounded-lg overflow-hidden border border-[var(--border)]">
            {(['6M', '1Y'] as const).map(p => (
              <button
                key={p}
                onClick={() => { setPeriod(p); setDrillMonth(null); }}
                className={`px-2.5 py-1 text-[10px] font-semibold transition ${
                  period === p ? 'bg-[var(--primary)]/15 text-[var(--primary)]' : 'bg-transparent text-[var(--text-muted)] hover:bg-[var(--border)]'
                }`}
              >
                {p === '6M' ? '6개월' : '1년'}
              </button>
            ))}
          </div>
          {/* Excel Download */}
          <button
            onClick={() => exportFinancialReport(sliced.map(m => ({ month: m.month, revenue: m.revenue, expense: m.expense, netIncome: m.netIncome })))}
            className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/20 transition"
          >
            Excel
          </button>
          {/* PDF Download */}
          <button
            onClick={() => {
              if (!finRaw || !companyId) return;
              const month = sliced[sliced.length - 1]?.month || new Date().toISOString().slice(0, 7);
              generateMonthlyPLReport({
                month,
                companyName: '',
                revenue: finData.totalRevenue,
                expense: finData.totalExpense,
                netIncome: finData.netIncome,
                items: (finRaw.items || []).map((i: any) => ({
                  name: i.name || '-',
                  category: i.category || 'expense',
                  amount: Number(i.amount || 0),
                  counterparty: i.project_name || undefined,
                })),
                bankBalance: 0,
                fixedCost: 0,
                runwayMonths: 999,
                dealBreakdown: finData.classificationBreakdown.map(cb => ({
                  dealName: cb.classification,
                  classification: cb.classification,
                  revenue: cb.totalRevenue,
                  cost: cb.totalCost,
                  margin: cb.totalRevenue > 0 ? cb.avgMargin : 0,
                })),
              });
            }}
            className="px-2.5 py-1 rounded-lg text-[10px] font-semibold bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 transition"
          >
            PDF
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-3 gap-3 mb-4">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3">
          <div className="text-[9px] text-[var(--text-dim)] uppercase tracking-wider mb-1">총 매출</div>
          <div className="text-sm font-black mono-number text-[var(--primary)]">₩{fmtW(finData.totalRevenue)}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3">
          <div className="text-[9px] text-[var(--text-dim)] uppercase tracking-wider mb-1">총 비용</div>
          <div className="text-sm font-black mono-number text-[var(--danger)]">₩{fmtW(finData.totalExpense)}</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3">
          <div className="text-[9px] text-[var(--text-dim)] uppercase tracking-wider mb-1">순이익</div>
          <div className={`text-sm font-black mono-number ${finData.netIncome >= 0 ? 'text-[var(--success)]' : 'text-[var(--danger)]'}`}>
            ₩{fmtW(finData.netIncome)}
          </div>
        </div>
      </div>

      {/* Bar Chart */}
      {barData.length > 0 && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 mb-3">
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-[var(--text-dim)]">매출(blue) vs 비용(red) · 순이익 추이(orange)</span>
            <div className="flex items-center gap-3 text-[9px] text-[var(--text-dim)]">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[var(--primary)]" />매출</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[#ef4444]" />비용</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-[var(--warning)]" />순이익</span>
            </div>
          </div>
          <BarChart
            data={barData}
            height={200}
            onBarClick={(i) => {
              if (drillMonth === i) {
                setDrillMonth(null); setDrillLevel(1); setDrillCategory(null); setDrillCounterparty(null);
              } else {
                setDrillMonth(i); setDrillLevel(2); setDrillCategory(null); setDrillCounterparty(null);
              }
            }}
            trendLine={trendLine}
          />
        </div>
      )}

      {/* Classification Breakdown */}
      {finData.classificationBreakdown.length > 0 && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 mb-3">
          <div className="text-[10px] text-[var(--text-dim)] mb-2 uppercase tracking-wider font-semibold">분류별 현황</div>
          <div className="grid grid-cols-3 gap-2">
            {finData.classificationBreakdown.map(cb => (
              <div key={cb.classification} className="flex items-center gap-2 px-2 py-1.5 rounded-lg bg-[var(--bg-surface)]">
                <span className="w-2 h-2 rounded-full shrink-0" style={{ background: cb.color }} />
                <span className="text-xs font-semibold">{cb.classification}</span>
                <span className="text-[10px] text-[var(--text-dim)] ml-auto mono-number">{cb.dealCount}건</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Drill-Down: Breadcrumb Navigation ── */}
      {drillMonth !== null && drillLevel >= 2 && (
        <div className="flex items-center gap-1 text-[10px] text-[var(--text-dim)] mt-3 mb-2">
          <button onClick={() => { setDrillLevel(1); setDrillMonth(null); setDrillCategory(null); setDrillCounterparty(null); }} className="hover:text-[var(--primary)] transition">
            {sliced[drillMonth].month}
          </button>
          {drillCategory && (
            <>
              <span>/</span>
              <button onClick={() => { setDrillLevel(2); setDrillCategory(null); setDrillCounterparty(null); }} className="hover:text-[var(--primary)] transition">
                {drillCategory}
              </button>
            </>
          )}
          {drillCounterparty && (
            <>
              <span>/</span>
              <span className="text-[var(--text-muted)]">{drillCounterparty}</span>
            </>
          )}
        </div>
      )}

      {/* ── Drill-Down Level 1: Legacy DrillDownTable ── */}
      {drillMonth !== null && sliced[drillMonth] && drillLevel === 1 && (
        <DrillDownTable
          items={drillItems}
          month={sliced[drillMonth].month}
          onExport={() => exportDrillDownItems(drillItems, sliced[drillMonth!].month)}
          onClose={() => setDrillMonth(null)}
        />
      )}

      {/* ── Drill-Down Level 2: Category Breakdown ── */}
      {drillMonth !== null && drillLevel === 2 && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 mt-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold">{sliced[drillMonth].month} 카테고리별</h3>
            <button onClick={() => { setDrillMonth(null); setDrillLevel(1); setDrillCategory(null); setDrillCounterparty(null); }} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] transition">닫기</button>
          </div>
          {drillL2.length === 0 ? (
            <div className="text-xs text-[var(--text-dim)] text-center py-4">데이터 없음</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left py-1.5">카테고리</th>
                  <th className="text-right py-1.5">건수</th>
                  <th className="text-right py-1.5">금액</th>
                </tr>
              </thead>
              <tbody>
                {drillL2.map(r => (
                  <tr key={r.category} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] cursor-pointer transition"
                    onClick={() => { setDrillCategory(r.category); setDrillLevel(3); }}>
                    <td className="py-1.5 text-[var(--text)]">{r.category}</td>
                    <td className="py-1.5 text-right mono-number text-[var(--text-muted)]">{r.count}</td>
                    <td className="py-1.5 text-right mono-number">{fmtWFull(r.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Drill-Down Level 3: Counterparty Breakdown ── */}
      {drillMonth !== null && drillLevel === 3 && drillCategory && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 mt-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold">{drillCategory} - 거래처별</h3>
            <button onClick={() => { setDrillLevel(2); setDrillCategory(null); setDrillCounterparty(null); }} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] transition">뒤로</button>
          </div>
          {drillL3.length === 0 ? (
            <div className="text-xs text-[var(--text-dim)] text-center py-4">데이터 없음</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left py-1.5">거래처</th>
                  <th className="text-right py-1.5">건수</th>
                  <th className="text-right py-1.5">금액</th>
                </tr>
              </thead>
              <tbody>
                {drillL3.map(r => (
                  <tr key={r.counterparty} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] cursor-pointer transition"
                    onClick={() => { setDrillCounterparty(r.counterparty); setDrillLevel(4); }}>
                    <td className="py-1.5 text-[var(--text)]">{r.counterparty || '(미지정)'}</td>
                    <td className="py-1.5 text-right mono-number text-[var(--text-muted)]">{r.count}</td>
                    <td className="py-1.5 text-right mono-number">{fmtWFull(r.totalAmount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── Drill-Down Level 4: Individual Ledger Items ── */}
      {drillMonth !== null && drillLevel === 4 && drillCategory && drillCounterparty && (
        <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl p-4 mt-3">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-bold">{drillCounterparty} - 거래 내역</h3>
            <button onClick={() => { setDrillLevel(3); setDrillCounterparty(null); }} className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] transition">뒤로</button>
          </div>
          {drillL4.length === 0 ? (
            <div className="text-xs text-[var(--text-dim)] text-center py-4">데이터 없음</div>
          ) : (
            <table className="w-full text-xs">
              <thead>
                <tr className="text-[10px] text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left py-1.5">날짜</th>
                  <th className="text-left py-1.5">설명</th>
                  <th className="text-left py-1.5">유형</th>
                  <th className="text-left py-1.5">딜</th>
                  <th className="text-right py-1.5">금액</th>
                </tr>
              </thead>
              <tbody>
                {drillL4.map((r: any) => (
                  <tr key={r.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] transition">
                    <td className="py-1.5 text-[var(--text-muted)] mono-number">{r.transaction_date?.slice(5) || '-'}</td>
                    <td className="py-1.5 text-[var(--text)] truncate max-w-[200px]">{r.description || '-'}</td>
                    <td className="py-1.5">
                      <span className={`px-1.5 py-0.5 rounded text-[9px] font-semibold ${
                        r.type === 'income' ? 'bg-[var(--success)]/10 text-[var(--success)]' : 'bg-[var(--danger)]/10 text-[var(--danger)]'
                      }`}>
                        {r.type === 'income' ? '입금' : '출금'}
                      </span>
                    </td>
                    <td className="py-1.5 text-[var(--text-dim)]">{r.deals?.name || '-'}</td>
                    <td className="py-1.5 text-right mono-number font-semibold">{fmtWFull(Number(r.amount || 0))}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </div>
  );
}

function ClosingChecklistWidget({ companyId, userId }: { companyId: string | null; userId: string | null }) {
  const queryClient = useQueryClient();
  const month = new Date().toISOString().slice(0, 7);

  const { data: checklist } = useQuery({
    queryKey: ['closing-checklist', companyId, month],
    queryFn: () => getOrCreateChecklist(companyId!, month),
    enabled: !!companyId,
  });

  const toggleMut = useMutation({
    mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) =>
      toggleChecklistItem(itemId, userId!, completed),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['closing-checklist'] }),
  });

  const completeMut = useMutation({
    mutationFn: () => completeClosingChecklist(checklist!.id, userId!),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['closing-checklist'] }),
  });

  if (!checklist) return null;

  const items = checklist.items || [];
  const total = items.length;
  const done = items.filter((i: any) => i.is_completed).length;
  const requiredDone = items.filter((i: any) => i.is_required && i.is_completed).length;
  const requiredTotal = items.filter((i: any) => i.is_required).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  const allRequiredDone = requiredDone === requiredTotal;

  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-3">
        <div className={`w-2 h-2 rounded-full ${checklist.status === 'completed' ? 'bg-[var(--success)]' : 'bg-[var(--warning)]'}`} />
        <h2 className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-wider">월 마감 체크리스트</h2>
        <span className="text-[10px] text-[var(--text-dim)]">{month} · {done}/{total} ({pct}%)</span>
      </div>

      <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-3">
          <div className="flex-1 h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden">
            <div className={`h-full rounded-full transition-all duration-500 ${pct === 100 ? 'bg-[var(--success)]' : pct >= 60 ? 'bg-[var(--warning)]' : 'bg-[var(--danger)]'}`} style={{ width: `${pct}%` }} />
          </div>
          <span className="text-[10px] text-[var(--text-dim)] mono-number">{pct}%</span>
        </div>

        {checklist.status === 'completed' ? (
          <div className="text-center py-3 text-sm text-[var(--success)] font-semibold">마감 완료</div>
        ) : (
          <>
            <div className="space-y-1">
              {items.map((item: any) => (
                <label key={item.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-surface)] cursor-pointer transition">
                  <input
                    type="checkbox"
                    checked={item.is_completed}
                    onChange={(e) => toggleMut.mutate({ itemId: item.id, completed: e.target.checked })}
                    className="rounded"
                  />
                  <span className={`text-xs flex-1 ${item.is_completed ? 'text-[var(--text-dim)] line-through' : 'text-[var(--text)]'}`}>
                    {item.title}
                    {item.is_required && <span className="text-[var(--danger)] ml-0.5">*</span>}
                  </span>
                </label>
              ))}
            </div>

            {allRequiredDone && (
              <button
                onClick={() => completeMut.mutate()}
                disabled={completeMut.isPending}
                className="mt-3 w-full py-2 bg-[var(--success)] text-white rounded-lg text-xs font-semibold hover:bg-[var(--success)]/90 transition disabled:opacity-50"
              >
                {completeMut.isPending ? '처리 중...' : '월 마감 완료'}
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function TodayActions({ dashboard }: { dashboard: FounderDashboardData }) {
  const actions: { priority: 'critical' | 'high' | 'normal'; text: string; href?: string }[] = [];

  const sp = dashboard.sixPack;
  const level = getRunwayLevel(sp.runwayMonths);

  if (level === 'CRITICAL' || level === 'DANGER') {
    actions.push({ priority: 'critical', text: `생존 ${sp.runwayMonths}개월 — 즉시 현금 확보 필요`, href: '/settings' });
  }
  if (sp.arOver30 > 0) {
    actions.push({ priority: 'critical', text: `미수금 30일+ ₩${fmtW(sp.arOver30)} — 독촉 필요` });
  }
  if (sp.pendingApprovals > 0) {
    actions.push({ priority: 'high', text: `승인대기 ₩${fmtW(sp.pendingApprovals)} — 검토/승인 필요` });
  }
  if (dashboard.riskCounts.LOW_MARGIN > 0) {
    actions.push({ priority: 'high', text: `마진위험 딜 ${dashboard.riskCounts.LOW_MARGIN}건 — 구조 재검토`, href: '/deals' });
  }
  if (dashboard.riskCounts.DUE_SOON > 0) {
    actions.push({ priority: 'high', text: `마감 임박 ${dashboard.riskCounts.DUE_SOON}건 — 진행 확인` });
  }
  if (sp.netCashflow < 0) {
    actions.push({ priority: 'normal', text: `이번달 적자 ₩${fmtW(Math.abs(sp.netCashflow))} 예상 — 지출 구조조정 검토` });
  }

  if (actions.length === 0) {
    actions.push({ priority: 'normal', text: '현재 긴급 조치 사항 없음' });
  }

  const priorityColors = {
    critical: 'border-l-[var(--danger)] bg-red-500/[.03]',
    high: 'border-l-[var(--warning)] bg-orange-500/[.02]',
    normal: 'border-l-[var(--text-dim)] bg-[var(--bg-card)]',
  };
  const dotColors = {
    critical: 'bg-[var(--danger)]',
    high: 'bg-[var(--warning)]',
    normal: 'bg-[var(--text-dim)]',
  };

  return (
    <div className="space-y-2">
      {actions.map((a, i) => (
        <div key={i} className={`flex items-center gap-3 px-4 py-3 rounded-lg border-l-2 border border-[var(--border)] ${priorityColors[a.priority]}`}>
          <div className={`w-2 h-2 rounded-full shrink-0 ${dotColors[a.priority]} ${a.priority === 'critical' ? 'animate-pulse-danger' : ''}`} />
          <span className="text-xs text-[var(--text-muted)] flex-1">{a.text}</span>
          {a.href && (
            <Link href={a.href} className="text-[10px] text-[var(--primary)] font-semibold hover:underline shrink-0">
              바로가기 →
            </Link>
          )}
        </div>
      ))}
    </div>
  );
}
