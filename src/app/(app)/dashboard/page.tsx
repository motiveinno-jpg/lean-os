"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useQuery, useQueryClient, useMutation } from "@tanstack/react-query";
import { getCurrentUser, getFounderData, saveExcelData, getFinancialDashboardData, getDrillDownLevel2, getDrillDownLevel3, getDrillDownLevel4, getCashPulseData } from "@/lib/queries";
import { buildCashPulse, getPulseLevel, type CashPulseResult } from "@/lib/cash-pulse";
import { buildFounderDashboard, buildFinancialDashboard as buildFinDash, type FounderDashboardData, type FinancialDashboardData, type RiskLabel, type RiskItem, getRunwayLevel } from "@/lib/engines";
import { parseExcel, type ParsedExcelData } from "@/lib/excel-parser";
import { generateSampleData } from "@/lib/sample-data";
import { exportFinancialReport, exportDrillDownItems } from "@/lib/excel-export";
import { generateMonthlyPLReport } from "@/lib/pdf-report";
import { getOrCreateChecklist, toggleChecklistItem, completeClosingChecklist, lockClosingMonth, unlockClosingMonth } from "@/lib/closing";
import { BarChart } from "@/components/bar-chart";
import { LineChart } from "@/components/line-chart";
import { FunnelChart, type FunnelStage } from "@/components/funnel-chart";
import { UpcomingScheduleCard } from "@/components/upcoming-schedule";
import { DrillDownTable } from "@/components/drill-down-table";
import { OnboardingWizard, shouldShowOnboarding } from "@/components/onboarding";
import { supabase } from "@/lib/supabase";
import { runAllAutomation, type AutomationResult } from "@/lib/automation";
import { getCEOPendingActions, getApprovalSummary, approveAction, bulkApproveActions, getRecurringPayments, sendApprovalNotificationEmail, type PendingAction, type PendingActionType } from "@/lib/approval-center";
import { getMonthlyTotalSalary } from "@/lib/payroll";
import Link from "next/link";
import { useUser } from "@/components/user-context";
import { useBoard } from "@/components/board-context";
import { PRESET_VIEWS, WIDGET_REGISTRY } from "@/lib/widget-registry";
import { QueryErrorBanner } from "@/components/query-status";
import { useToast } from "@/components/toast";
import { MorningBrief } from "@/components/morning-brief";
import { AiBriefing } from "@/components/ai-briefing";

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
  const { role } = useUser();
  const { activeViewId, setActiveView, isWidgetVisible, editing, toggleEditing, toggleWidget, widgets } = useBoard();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [companyName, setCompanyName] = useState("");
  const [userName, setUserName] = useState("");
  const [uploading, setUploading] = useState(false);
  const [parseResult, setParseResult] = useState<{ success: boolean; message: string } | null>(null);
  const [generating, setGenerating] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [dealCount, setDealCount] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [syncResult, setSyncResult] = useState<{ success: boolean; message: string; time: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const queryClient = useQueryClient();

  const [userLoadFailed, setUserLoadFailed] = useState(false);

  useEffect(() => {
    let retries = 0;
    async function loadUser() {
      const u = await getCurrentUser();
      if (u) {
        setCompanyId(u.company_id);
        setUserId(u.id);
        setUserName(u.name || u.email);
        setCompanyName(u.companies?.name || "");

        // Check deal count for onboarding
        const db = supabase as any;
        const { count } = await db
          .from("deals")
          .select("id", { count: "exact", head: true })
          .eq("company_id", u.company_id);
        const dc = count ?? 0;
        setDealCount(dc);
        if (shouldShowOnboarding(dc)) {
          setShowOnboarding(true);
        }
      } else if (retries < 2) {
        // 회원가입 직후 user 레코드 생성 지연 가능 — 재시도
        retries++;
        setTimeout(loadUser, 1500);
      } else {
        setUserLoadFailed(true);
      }
    }
    loadUser();
  }, []);

  // Fetch data from DB
  const { data: rawData, error: mainError, refetch: mainRefetch } = useQuery({
    queryKey: ["founder-data", companyId],
    queryFn: () => getFounderData(companyId!),
    enabled: !!companyId,
    refetchInterval: 30_000,
    retry: 1,
  });

  // Real monthly burn = recurring payments + total salary
  const { data: realBurnData } = useQuery({
    queryKey: ["real-burn", companyId],
    queryFn: async () => {
      const [recurring, totalSalary] = await Promise.all([
        getRecurringPayments(companyId!),
        getMonthlyTotalSalary(companyId!),
      ]);
      const recurringTotal = (recurring || [])
        .filter((r: any) => r.is_active)
        .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
      return recurringTotal + totalSalary;
    },
    enabled: !!companyId,
  });

  // Cash Pulse data
  const { data: pulseRaw } = useQuery({
    queryKey: ["cash-pulse", companyId],
    queryFn: () => getCashPulseData(companyId!),
    enabled: !!companyId,
    refetchInterval: 30_000,
    retry: 1,
  });
  const cashPulse: CashPulseResult | null = pulseRaw ? buildCashPulse(pulseRaw) : null;

  // Build dashboard through engines (always returns valid data, never null)
  const dashboard: FounderDashboardData = rawData
    ? buildFounderDashboard(
        rawData.currentMonth,
        rawData.items,
        rawData.deals,
        rawData.targets,
        rawData.quarterRevenue,
        rawData.yearRevenue,
        realBurnData || undefined,
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

  // ── 데이터 동기화 핸들러 (수집 + 분류 통합) ──
  const handleDataSync = useCallback(async () => {
    if (!companyId || syncing) return;
    setSyncing(true);
    setSyncResult(null);
    try {
      // 1) DB에 동기화 요청 등록 → local-agent가 감지하여 데이터 수집 실행
      await (supabase as any).from('sync_jobs').insert({
        company_id: companyId,
        status: 'pending',
        targets: ['bank', 'hometax', 'card', 'classify'],
        requested_by: userId,
      });

      // 2) 자동 분류 엔진 즉시 실행 (이미 DB에 있는 데이터 분류)
      const result = await runAllAutomation(companyId);

      // 3) 쿼리 캐시 갱신
      queryClient.invalidateQueries({ queryKey: ["founder-data"] });
      queryClient.invalidateQueries({ queryKey: ["financial-dashboard"] });

      const now = new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' });
      setSyncResult({
        success: true,
        message: `분류 완료 — 은행 ${result.bankClassification.matched}건 · 카드 ${result.cardMapping.matched}건 · 3-Way ${result.threeWayMatch.autoMatched}건 | 데이터 수집 요청됨 (에이전트 대기 중)`,
        time: now,
      });
    } catch (err: any) {
      setSyncResult({
        success: false,
        message: `동기화 실패: ${err.message || '알 수 없는 오류'}`,
        time: new Date().toLocaleTimeString('ko-KR', { hour: '2-digit', minute: '2-digit' }),
      });
    } finally {
      setSyncing(false);
    }
  }, [companyId, userId, syncing, queryClient]);

  const sp = dashboard.sixPack;

  // ── Employee Dashboard ──
  if (role === "employee") {
    return (
      <EmployeeDashboard userName={userName} companyId={companyId} companyName={companyName} userId={userId} />
    );
  }

  // ── Partner Dashboard (mobile-first, dynamic counts) ──
  if (role === "partner") {
    return (
      <PartnerDashboard userName={userName} companyId={companyId} companyName={companyName} userId={userId} />
    );
  }

  // ── Admin Dashboard (경량 뷰: 승인센터 + 인사 + 최근 요청) ──
  if (role === "admin") {
    return (
      <div className="max-w-[1100px]">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div>
            <div className="flex items-center gap-3 mb-1">
              <h1 className="text-lg font-black tracking-tight">관리자 현황판</h1>
              <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-500/10 text-emerald-500 border border-emerald-500/20">관리자</span>
            </div>
            <p className="text-[11px] text-[var(--text-dim)]">
              {companyName} · {userName} · {new Date().toLocaleDateString('ko-KR')}
            </p>
          </div>
        </div>

        {/* 핵심 지표 4개 (admin용 경량) */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-5">
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3">
            <div className="text-[9px] font-semibold text-[var(--text-dim)] uppercase mb-1">승인 대기</div>
            <div className="text-lg font-black" style={{ color: sp.pendingApprovals > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
              ₩{fmtW(sp.pendingApprovals)}
            </div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3">
            <div className="text-[9px] font-semibold text-[var(--text-dim)] uppercase mb-1">통장 잔고</div>
            <div className="text-lg font-black">₩{fmtW(sp.cashBalance)}</div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3">
            <div className="text-[9px] font-semibold text-[var(--text-dim)] uppercase mb-1">미수금</div>
            <div className="text-lg font-black" style={{ color: sp.arTotal > 0 ? 'var(--warning)' : 'var(--text-muted)' }}>
              ₩{fmtW(sp.arTotal)}
            </div>
          </div>
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-3">
            <div className="text-[9px] font-semibold text-[var(--text-dim)] uppercase mb-1">월 고정비</div>
            <div className="text-lg font-black">₩{fmtW(sp.monthlyBurn)}</div>
          </div>
        </div>

        {/* 승인센터 */}
        {companyId && userId && (
          <ApprovalCenterWidget companyId={companyId} userId={userId} />
        )}

        {/* 오늘의 액션 */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-[var(--primary)]" />
            <h2 className="text-xs font-bold text-[var(--text-dim)] tracking-wider">오늘의 액션</h2>
          </div>
          <TodayActions dashboard={dashboard} />
        </div>

        {/* 바로가기 */}
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-[var(--text-dim)]" />
            <h2 className="text-xs font-bold text-[var(--text-dim)] tracking-wider">빠른 이동</h2>
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {[
              { href: "/employees", label: "인사/급여", icon: "👤", desc: "직원 관리 및 급여" },
              { href: "/approvals", label: "결재함", icon: "📋", desc: "결재 요청 처리" },
              { href: "/payments", label: "결제 관리", icon: "💳", desc: "결제 큐 및 배치" },
              { href: "/documents", label: "문서/계약", icon: "📄", desc: "문서 승인 및 서명" },
            ].map(card => (
              <Link key={card.href} href={card.href}
                className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 hover:border-[var(--primary)] active:scale-[0.98] transition group touch-card">
                <div className="text-xl mb-1.5">{card.icon}</div>
                <div className="text-xs font-bold group-hover:text-[var(--primary)] transition">{card.label}</div>
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{card.desc}</div>
              </Link>
            ))}
          </div>
        </div>

        {/* 월 마감 체크리스트 */}
        <ClosingChecklistWidget companyId={companyId} userId={userId} />

        {/* 자동화 엔진 */}
        <AutomationWidget companyId={companyId} />
      </div>
    );
  }

  // ── 유저 로딩 실패 안내 ──
  if (userLoadFailed) {
    return (
      <div className="max-w-[1100px]">
        <div className="rounded-xl border border-[var(--warning)]/30 bg-[var(--warning-dim)] p-6 text-center">
          <p className="text-sm font-semibold text-[var(--text)] mb-2">계정 정보를 불러올 수 없습니다</p>
          <p className="text-xs text-[var(--text-muted)] mb-4">회원가입 직후라면 잠시 후 새로고침해주세요.</p>
          <button onClick={() => window.location.reload()} className="px-4 py-2 rounded-lg text-xs font-bold text-white" style={{ background: "var(--primary)" }}>
            새로고침
          </button>
        </div>
      </div>
    );
  }

  // ── Mobile swipe between preset views (touch only) ──
  const swipeStart = useRef<{ x: number; y: number; t: number } | null>(null);
  const onTouchStart = useCallback((e: React.TouchEvent) => {
    const t = e.touches[0];
    swipeStart.current = { x: t.clientX, y: t.clientY, t: Date.now() };
  }, []);
  const onTouchEnd = useCallback((e: React.TouchEvent) => {
    if (!swipeStart.current) return;
    const start = swipeStart.current;
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    const dt = Date.now() - start.t;
    swipeStart.current = null;
    // require horizontal swipe, ignore vertical scroll
    if (dt > 600 || Math.abs(dx) < 80 || Math.abs(dy) > 50) return;
    if (editing) return;
    const ids = PRESET_VIEWS.map((v) => v.id);
    const idx = ids.indexOf(activeViewId);
    if (idx < 0) return;
    if (dx < 0 && idx < ids.length - 1) setActiveView(ids[idx + 1]);
    if (dx > 0 && idx > 0) setActiveView(ids[idx - 1]);
  }, [editing, activeViewId, setActiveView]);

  // ── Owner Dashboard (전체 CEO 뷰) ──
  return (
    <div
      className="max-w-[1100px] pb-20 md:pb-0"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      {/* ═══ 온보딩 위저드 ═══ */}
      {showOnboarding && companyId && (
        <OnboardingWizard
          companyId={companyId}
          companyName={companyName}
          onComplete={() => {
            setShowOnboarding(false);
            queryClient.invalidateQueries({ queryKey: ["founder-data"] });
            // Refresh deal count
            const db = supabase as any;
            db.from("deals")
              .select("id", { count: "exact", head: true })
              .eq("company_id", companyId)
              .then(({ count }: { count: number | null }) => setDealCount(count ?? 0));
          }}
        />
      )}

      {/* ═══ GETTING STARTED CHECKLIST (실데이터 진행률) ═══ */}
      {!showOnboarding && companyId && (
        <GettingStartedChecklist companyId={companyId} initialDealCount={dealCount ?? 0} />
      )}

      {/* ═══ 아침 브리핑 — 자연어 요약 ═══ */}
      <MorningBrief
        userName={userName}
        companyName={companyName}
        cashPulse={cashPulse}
        dashboard={dashboard}
        hasData={hasData}
      />

      {/* ═══ AI 경영 브리핑 — 대화형 분석 ═══ */}
      <AiBriefing
        cashPulse={cashPulse}
        dashboard={dashboard}
        hasData={hasData}
        companyName={companyName}
        dealCount={dealCount}
      />

      {/* ═══ 액션 바 (동기화 / 업로드) ═══ */}
      <div className="flex items-center justify-end mb-4">
        {/* Sync / Upload buttons */}
        <div className="flex items-center gap-2">
          {role === "owner" && (
            <button onClick={handleDataSync} disabled={syncing}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold transition disabled:opacity-50 flex items-center gap-1.5 ${
                syncing
                  ? 'bg-[var(--primary)]/20 text-[var(--primary)]'
                  : 'bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/20 border border-[var(--success)]/20'
              }`}>
              <svg className={`w-3.5 h-3.5 ${syncing ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M23 4v6h-6M1 20v-6h6" strokeLinecap="round" strokeLinejoin="round"/>
                <path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15" strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
              {syncing ? '동기화 중...' : '데이터 동기화'}
            </button>
          )}
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelUpload} />
          <button onClick={() => fileRef.current?.click()} disabled={uploading}
            className="px-3 py-1.5 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] text-[11px] font-semibold hover:bg-[var(--primary)]/20 transition disabled:opacity-50">
            {uploading ? '파싱 중...' : '엑셀 업로드'}
          </button>
          {!hasData && (
          <button onClick={handleSampleData} disabled={generating}
            className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] text-[var(--text-muted)] text-[11px] font-semibold hover:bg-[var(--bg-elevated)] transition disabled:opacity-50">
            {generating ? '생성 중...' : '샘플 데이터'}
          </button>
          )}
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

      {/* Sync result toast */}
      {syncResult && (
        <div className={`mb-4 p-3 rounded-lg text-xs flex items-center justify-between ${
          syncResult.success ? 'bg-[var(--success)]/10 border border-[var(--success)]/20 text-[var(--success)]'
            : 'bg-red-500/10 border border-red-500/20 text-red-400'
        }`}>
          <span>{syncResult.message}</span>
          <span className="flex items-center gap-2">
            <span className="opacity-60">{syncResult.time}</span>
            <button onClick={() => setSyncResult(null)} className="opacity-60 hover:opacity-100">✕</button>
          </span>
        </div>
      )}

      {/* ═══ 프리셋 뷰 탭 + 편집 버튼 ═══ */}
      <div className="flex items-center gap-1.5 mb-2 overflow-x-auto scrollbar-hide">
        {PRESET_VIEWS.map((view) => (
          <button
            key={view.id}
            onClick={() => setActiveView(view.id)}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition ${
              activeViewId === view.id
                ? 'bg-[var(--primary)] text-white shadow-sm'
                : editing
                  ? 'bg-[var(--bg-surface)] text-[var(--text-dim)] opacity-50 cursor-not-allowed'
                  : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]'
            }`}
            disabled={editing}
          >
            {view.name}
          </button>
        ))}
        {activeViewId === 'custom' && (
          <span className="px-2 py-1 rounded-lg text-[10px] font-semibold bg-amber-500/10 text-amber-600 border border-amber-500/20">
            커스텀
          </span>
        )}
        <div className="ml-auto flex-shrink-0">
          <button
            onClick={toggleEditing}
            className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold whitespace-nowrap transition ${
              editing
                ? 'bg-[var(--primary)] text-white'
                : 'bg-[var(--bg-surface)] text-[var(--text-muted)] hover:bg-[var(--bg-elevated)] hover:text-[var(--text)]'
            }`}
          >
            {editing ? '완료' : '편집'}
          </button>
        </div>
      </div>

      {/* ═══ 위젯 show/hide 패널 (편집 모드) ═══ */}
      {editing && (
        <div className="mb-4 p-3 rounded-xl border border-[var(--primary)]/20 bg-[var(--primary)]/[.03]">
          <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-2">
            위젯 표시 설정
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {WIDGET_REGISTRY.map((def) => {
              const visible = isWidgetVisible(def.id);
              return (
                <button
                  key={def.id}
                  onClick={() => toggleWidget(def.id)}
                  className={`flex items-center gap-2 px-3 py-2 rounded-lg text-left transition ${
                    visible
                      ? 'bg-[var(--primary)]/10 border border-[var(--primary)]/30'
                      : 'bg-[var(--bg-surface)] border border-[var(--border)] opacity-60'
                  }`}
                >
                  <div className={`w-4 h-4 rounded flex items-center justify-center flex-shrink-0 ${
                    visible ? 'bg-[var(--primary)] text-white' : 'bg-[var(--bg-elevated)] border border-[var(--border)]'
                  }`}>
                    {visible && (
                      <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-[11px] font-semibold text-[var(--text)] truncate">{def.name}</div>
                    <div className="text-[9px] text-[var(--text-muted)] truncate">{def.description}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* ═══ 코어 바 (현금 펄스) ═══ */}
      {(() => {
        const pulse = cashPulse;
        const pLevel = pulse ? getPulseLevel(pulse.pulseScore) : 'stable';
        const PULSE_COLORS: Record<string, { color: string; bg: string; border: string }> = {
          critical: { color: '#ff2d55', bg: 'rgba(255,45,85,0.08)', border: 'rgba(255,45,85,0.3)' },
          danger:   { color: '#ef4444', bg: 'rgba(239,68,68,0.08)', border: 'rgba(239,68,68,0.25)' },
          warning:  { color: '#f59e0b', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.2)' },
          stable:   { color: '#22c55e', bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.15)' },
          safe:     { color: '#22c55e', bg: 'rgba(34,197,94,0.06)', border: 'rgba(34,197,94,0.15)' },
        };
        const pc = PULSE_COLORS[pLevel];
        const balance = pulse?.currentBalance ?? sp.cashBalance;
        const f30 = pulse?.forecast30d ?? 0;
        const f90 = pulse?.forecast90d ?? 0;
        const score = pulse?.pulseScore ?? 0;
        const risks = pulse?.riskCount ?? dashboard.risks.length;
        const pending = pulse?.pendingApprovalCount ?? 0;

        return (
          <div className="rounded-2xl p-1 mb-4 survival-bar bg-[var(--bg-card)]"
            style={{ border: `1px solid ${pc.border}` }}>
            <div className="grid grid-cols-2 md:grid-cols-4 divide-x divide-[var(--border)]">
              {/* 통장 잔고 */}
              <div className="px-4 py-3">
                <div className="text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">통장 잔고</div>
                <div className="text-base font-black mono-number" style={{ color: balance <= 0 ? 'var(--danger)' : 'var(--text)' }}>
                  ₩{fmtW(balance)}
                </div>
              </div>
              {/* D+30 / D+90 예측 */}
              <div className="px-4 py-3">
                <div className="text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">현금 예측</div>
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-black mono-number" style={{ color: f30 < 0 ? 'var(--danger)' : f30 < balance * 0.3 ? 'var(--warning)' : 'var(--text)' }}>
                    D+30 ₩{fmtW(f30)}
                  </span>
                </div>
                <div className="text-[10px] font-semibold mono-number mt-0.5" style={{ color: f90 < 0 ? 'var(--danger)' : 'var(--text-muted)' }}>
                  D+90 ₩{fmtW(f90)}
                </div>
              </div>
              {/* 펄스 점수 */}
              <div className="px-4 py-3">
                <div className="text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">펄스 점수</div>
                <div className="flex items-baseline gap-1.5">
                  <span className="text-lg font-black mono-number" style={{ color: pc.color }}>{score}</span>
                  <span className="text-[10px] font-semibold text-[var(--text-dim)]">/ 100</span>
                </div>
              </div>
              {/* 위험 / 대기 */}
              <div className="px-4 py-3">
                <div className="text-[9px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-1">위험 · 대기</div>
                <div className="flex items-baseline gap-3">
                  <span className={`text-sm font-black mono-number ${risks > 0 ? 'text-[var(--danger)]' : 'text-[var(--success)]'}`}>
                    위험 {risks}
                  </span>
                  <span className={`text-sm font-black mono-number ${pending > 0 ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'}`}>
                    대기 {pending}
                  </span>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ═══ 현금 펄스 위젯 ═══ */}
      {isWidgetVisible('cash_pulse') && cashPulse && (
        <div id="widget-cash_pulse"><CashPulseWidget pulse={cashPulse} /></div>
      )}

      {/* ═══ 시나리오 시뮬레이터 (위기모드) ═══ */}
      {isWidgetVisible('scenario_simulator') && cashPulse && (
        <div id="widget-scenario_simulator"><ScenarioSimulator pulse={cashPulse} /></div>
      )}

      {/* ═══ 미수금 현황 (위기모드) ═══ */}
      {isWidgetVisible('overdue_receivables') && companyId && (
        <div id="widget-overdue_receivables"><OverdueReceivablesWidget companyId={companyId} /></div>
      )}

      {/* ═══ 번레이트 추이 (위기모드) ═══ */}
      {isWidgetVisible('burn_rate_trend') && companyId && (
        <div id="widget-burn_rate_trend"><BurnRateTrendWidget companyId={companyId} /></div>
      )}

      {/* ═══ 승인센터 ═══ */}
      {isWidgetVisible('approval_center') && companyId && userId && (
        <div id="widget-approval_center"><ApprovalCenterWidget companyId={companyId} userId={userId} /></div>
      )}

      {/* ═══ 오늘의 액션 (승인센터 바로 아래) ═══ */}
      {isWidgetVisible('today_actions') && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-[var(--primary)]" />
            <h2 className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-wider">오늘의 액션</h2>
          </div>
          <TodayActions dashboard={dashboard} />
        </div>
      )}

      {/* 데이터 없음 — 시작 CTA */}
      {!hasData && (
        <div className="mb-5 p-6 rounded-xl bg-[var(--bg-card)] border border-[var(--border)]">
          <div className="text-sm font-bold text-[var(--text)] mb-1">아직 재무 데이터가 없습니다</div>
          <p className="text-xs text-[var(--text-muted)] mb-4">아래 방법 중 하나를 선택해 시작하세요.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button onClick={handleSampleData} disabled={generating}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-[var(--primary)] bg-[var(--primary)]/5 hover:bg-[var(--primary)]/10 transition disabled:opacity-50">
              <span className="text-2xl">🚀</span>
              <span className="text-sm font-bold text-[var(--primary)]">{generating ? '생성 중...' : '샘플 데이터 생성'}</span>
              <span className="text-[10px] text-[var(--text-muted)]">추천 — 즉시 체험</span>
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] transition disabled:opacity-50">
              <span className="text-2xl">📊</span>
              <span className="text-sm font-bold text-[var(--text)]">{uploading ? '업로드 중...' : '엑셀 업로드'}</span>
              <span className="text-[10px] text-[var(--text-muted)]">실제 데이터로 시작</span>
            </button>
            <Link href="/guide"
              className="flex flex-col items-center gap-2 p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] transition">
              <span className="text-2xl">📖</span>
              <span className="text-sm font-bold text-[var(--text)]">시작 가이드 보기</span>
              <span className="text-[10px] text-[var(--text-muted)]">사용법 안내</span>
            </Link>
          </div>
        </div>
      )}

      {/* ═══ 위험 구역 ═══ */}
      {isWidgetVisible('risk_zone') && (
        <div id="widget-risk_zone" className="mb-5">
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
      )}

      {/* ═══ GROWTH ZONE: 성장 영역 ═══ */}
      {isWidgetVisible('growth_tracking') && (
        <div id="widget-growth_tracking" className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-[var(--success)]" />
            <h2 className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-wider">성장 영역</h2>
          </div>
          <GrowthSection growth={dashboard.growth} />
        </div>
      )}

      {/* ═══ FINANCIAL OVERVIEW: 재무 개요 ═══ */}
      {isWidgetVisible('financial_overview') && <div id="widget-financial_overview"><FinancialOverview companyId={companyId} /></div>}

      {/* ═══ MONTHLY CLOSING CHECKLIST ═══ */}
      {isWidgetVisible('closing_checklist') && <ClosingChecklistWidget companyId={companyId} userId={userId} />}

      {/* ═══ 자동화 엔진 ═══ */}
      {isWidgetVisible('automation_status') && <AutomationWidget companyId={companyId} />}

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

function CashPulseWidget({ pulse }: { pulse: CashPulseResult }) {
  const maxBalance = Math.max(...pulse.forecastPoints.map(p => Math.abs(p.balance)), 1);

  return (
    <div className="mb-5 rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-2 h-2 rounded-full bg-[var(--primary)]" />
        <h2 className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-wider">현금 펄스</h2>
        <span className="text-[9px] px-1.5 py-0.5 rounded font-semibold" style={{
          background: pulse.pulseScore >= 60 ? 'rgba(34,197,94,0.1)' : pulse.pulseScore >= 40 ? 'rgba(245,158,11,0.1)' : 'rgba(239,68,68,0.1)',
          color: pulse.pulseScore >= 60 ? '#22c55e' : pulse.pulseScore >= 40 ? '#f59e0b' : '#ef4444',
        }}>
          {pulse.pulseScore}/100
        </span>
      </div>

      {/* 5-point forecast bars */}
      <div className="grid grid-cols-5 gap-2 mb-3">
        {pulse.forecastPoints.map((pt) => {
          const pct = maxBalance > 0 ? Math.abs(pt.balance) / maxBalance * 100 : 0;
          const isNegative = pt.balance < 0;
          return (
            <div key={pt.label} className="text-center">
              <div className="text-[9px] font-semibold text-[var(--text-dim)] mb-1">{pt.label}</div>
              <div className="h-12 flex items-end justify-center mb-1">
                <div
                  className="w-full max-w-[32px] rounded-t transition-all duration-500"
                  style={{
                    height: `${Math.max(pct, 8)}%`,
                    background: isNegative ? 'var(--danger)' : pt.balance < pulse.currentBalance * 0.3 ? 'var(--warning)' : 'var(--primary)',
                    opacity: isNegative ? 0.7 : 0.8,
                  }}
                />
              </div>
              <div className={`text-[10px] font-bold mono-number ${isNegative ? 'text-[var(--danger)]' : 'text-[var(--text)]'}`}>
                ₩{fmtW(pt.balance)}
              </div>
            </div>
          );
        })}
      </div>

      {/* Briefing */}
      <div className="text-[11px] text-[var(--text-muted)] leading-relaxed px-1 py-2 rounded bg-[var(--bg-surface)]">
        {pulse.briefing}
      </div>

      {/* Score breakdown (collapsible) */}
      <details className="mt-2">
        <summary className="text-[10px] text-[var(--text-dim)] cursor-pointer hover:text-[var(--text-muted)] transition">
          점수 상세
        </summary>
        <div className="mt-2 grid grid-cols-5 gap-1 text-[9px]">
          {[
            { label: '생존', score: pulse.scoreBreakdown.runway, max: 40 },
            { label: '현금흐름', score: pulse.scoreBreakdown.cashflowTrend, max: 20 },
            { label: '미수금', score: pulse.scoreBreakdown.arHealth, max: 15 },
            { label: '매칭', score: pulse.scoreBreakdown.matchingRate, max: 10 },
            { label: '승인', score: pulse.scoreBreakdown.approvalLag, max: 15 },
          ].map(item => (
            <div key={item.label} className="text-center">
              <div className="text-[var(--text-dim)] font-semibold">{item.label}</div>
              <div className="font-bold mono-number" style={{
                color: item.score >= item.max * 0.7 ? 'var(--success)' : item.score >= item.max * 0.4 ? 'var(--warning)' : 'var(--danger)',
              }}>
                {item.score}/{item.max}
              </div>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}

function ScenarioSimulator({ pulse }: { pulse: CashPulseResult }) {
  const [addEmployees, setAddEmployees] = useState(0);
  const [revenueChange, setRevenueChange] = useState(0);
  const [cutExpenses, setCutExpenses] = useState(0);

  const currentBurn = pulse.monthlyBurn || 0;
  const currentBalance = pulse.currentBalance || 0;
  const avgSalary = 4500000; // 평균 급여 추정

  const newBurn = Math.max(0, currentBurn + (addEmployees * avgSalary) - cutExpenses);
  const estimatedRevenue = Math.max(0, (currentBurn * 0.8) * (1 + revenueChange / 100));
  const netBurn = Math.max(1, newBurn - estimatedRevenue);
  const runway = Math.round(currentBalance / netBurn);

  return (
    <div className="mb-5 p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)]">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-base">🔮</span>
        <h3 className="text-sm font-bold text-[var(--text)]">시나리오 시뮬레이터</h3>
        <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400 font-medium">What-if</span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
        <label className="block">
          <span className="text-[11px] text-[var(--text-muted)] mb-1 block">직원 추가</span>
          <input type="number" value={addEmployees} onChange={e => setAddEmployees(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]" />
        </label>
        <label className="block">
          <span className="text-[11px] text-[var(--text-muted)] mb-1 block">매출 변동 (%)</span>
          <input type="number" value={revenueChange} onChange={e => setRevenueChange(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]" />
        </label>
        <label className="block">
          <span className="text-[11px] text-[var(--text-muted)] mb-1 block">비용 절감 (원)</span>
          <input type="number" value={cutExpenses} onChange={e => setCutExpenses(Number(e.target.value))}
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]" />
        </label>
      </div>
      <div className="flex items-center gap-4 p-3 rounded-xl bg-[var(--bg-surface)]">
        <div>
          <div className="text-[11px] text-[var(--text-muted)]">예상 월 지출</div>
          <div className="text-sm font-bold text-[var(--text)]">{(newBurn/10000).toFixed(0)}만원</div>
        </div>
        <div className="w-px h-8 bg-[var(--border)]" />
        <div>
          <div className="text-[11px] text-[var(--text-muted)]">예상 런웨이</div>
          <div className={`text-sm font-bold ${runway <= 3 ? 'text-red-500' : runway <= 6 ? 'text-yellow-500' : 'text-green-500'}`}>{runway}개월</div>
        </div>
        <div className="w-px h-8 bg-[var(--border)]" />
        <div>
          <div className="text-[11px] text-[var(--text-muted)]">순 현금흐름</div>
          <div className={`text-sm font-bold ${estimatedRevenue - newBurn >= 0 ? 'text-green-500' : 'text-red-500'}`}>
            {((estimatedRevenue - newBurn)/10000).toFixed(0)}만원/월
          </div>
        </div>
      </div>
    </div>
  );
}

function OverdueReceivablesWidget({ companyId }: { companyId: string }) {
  const { data: invoices = [] } = useQuery({
    queryKey: ["overdue-invoices", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any).from('tax_invoices').select('counterparty_name, total_amount, issue_date, due_date, status').eq('company_id', companyId).in('status', ['issued', 'sent', 'pending', 'overdue']).order('issue_date', { ascending: true }).limit(20);
      return data || [];
    },
    enabled: !!companyId,
  });

  const now = new Date();
  const overdue = invoices.filter((inv: any) => {
    if (!inv.due_date) return false;
    return new Date(inv.due_date) < now;
  });
  const totalOverdue = overdue.reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0);
  const totalPending = invoices.reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0);

  return (
    <div className="mb-5 p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)]">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-base">💰</span>
        <h3 className="text-sm font-bold text-[var(--text)]">미수금 현황</h3>
        {overdue.length > 0 && <span className="text-[10px] px-2 py-0.5 rounded-full bg-red-500/10 text-red-400 font-bold">{overdue.length}건 연체</span>}
      </div>
      <div className="flex gap-4 mb-3">
        <div className="flex-1 p-3 rounded-xl bg-[var(--bg-surface)]">
          <div className="text-[11px] text-[var(--text-muted)]">미수금 합계</div>
          <div className="text-sm font-bold text-[var(--text)]">{(totalPending/10000).toFixed(0)}만원</div>
        </div>
        <div className="flex-1 p-3 rounded-xl bg-red-500/5">
          <div className="text-[11px] text-red-400">연체 금액</div>
          <div className="text-sm font-bold text-red-500">{(totalOverdue/10000).toFixed(0)}만원</div>
        </div>
      </div>
      {overdue.length > 0 && (
        <div className="space-y-2">
          {overdue.slice(0, 5).map((inv: any, i: number) => {
            const days = Math.floor((now.getTime() - new Date(inv.due_date).getTime()) / 86400000);
            return (
              <div key={i} className="flex items-center justify-between text-xs px-3 py-2 rounded-lg bg-[var(--bg-surface)]">
                <span className="text-[var(--text)]">{inv.counterparty_name}</span>
                <div className="flex items-center gap-3">
                  <span className="text-[var(--text-muted)]">{(Number(inv.total_amount)/10000).toFixed(0)}만원</span>
                  <span className="text-red-400 font-bold">D+{days}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {invoices.length === 0 && <p className="text-xs text-[var(--text-muted)] text-center py-3">미수금 데이터 없음</p>}
    </div>
  );
}

function BurnRateTrendWidget({ companyId }: { companyId: string }) {
  const { data: trends = [] } = useQuery({
    queryKey: ["burn-rate-trend", companyId],
    queryFn: async () => {
      const sixMonthsAgo = new Date();
      sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);
      const { data } = await (supabase as any).from('transactions').select('amount, type, transaction_date').eq('company_id', companyId).gte('transaction_date', sixMonthsAgo.toISOString().split('T')[0]).order('transaction_date');
      if (!data) return [];
      const monthly: Record<string, { expense: number; income: number }> = {};
      data.forEach((tx: any) => {
        const month = tx.transaction_date?.slice(0, 7);
        if (!month) return;
        if (!monthly[month]) monthly[month] = { expense: 0, income: 0 };
        const amt = Math.abs(Number(tx.amount || 0));
        if (tx.type === 'expense' || Number(tx.amount) < 0) monthly[month].expense += amt;
        else monthly[month].income += amt;
      });
      return Object.entries(monthly).sort(([a], [b]) => a.localeCompare(b)).map(([month, v]) => ({ month, ...v }));
    },
    enabled: !!companyId,
  });

  const maxVal = Math.max(...trends.map(t => Math.max(t.expense, t.income)), 1);

  return (
    <div className="mb-5 p-5 rounded-2xl bg-[var(--bg-card)] border border-[var(--border)]">
      <div className="flex items-center gap-2 mb-4">
        <span className="text-base">📊</span>
        <h3 className="text-sm font-bold text-[var(--text)]">번레이트 추이</h3>
        <span className="text-[10px] text-[var(--text-muted)]">최근 6개월</span>
      </div>
      {trends.length > 0 ? (
        <div className="space-y-2">
          {trends.map((t, i) => (
            <div key={i} className="flex items-center gap-3 text-xs">
              <span className="w-14 text-[var(--text-muted)] shrink-0">{t.month.slice(5)}월</span>
              <div className="flex-1 flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <div className="h-3 rounded bg-red-400/80" style={{ width: `${(t.expense / maxVal) * 100}%` }} />
                  <span className="text-[var(--text-muted)] whitespace-nowrap">{(t.expense/10000).toFixed(0)}만</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-3 rounded bg-green-400/80" style={{ width: `${(t.income / maxVal) * 100}%` }} />
                  <span className="text-[var(--text-muted)] whitespace-nowrap">{(t.income/10000).toFixed(0)}만</span>
                </div>
              </div>
            </div>
          ))}
          <div className="flex items-center gap-4 mt-2 text-[10px] text-[var(--text-muted)]">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-red-400/80" />지출</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded bg-green-400/80" />수입</span>
          </div>
        </div>
      ) : (
        <p className="text-xs text-[var(--text-muted)] text-center py-3">거래 데이터 없음</p>
      )}
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
  const { toast } = useToast();
  const cls = "px-2 py-1 rounded text-[10px] font-semibold bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition cursor-pointer";
  if (href) return <Link href={href} className={cls}>{text}</Link>;
  return <button className={cls} onClick={() => toast(`[준비중] ${text}`, "info")}>{text}</button>;
}

function GrowthSection({ growth }: { growth: FounderDashboardData['growth'] }) {
  const metrics = [
    { label: '이번달', revenue: growth.monthRevenue, target: growth.monthTarget, gap: growth.monthGap },
    { label: '이번분기', revenue: growth.quarterRevenue, target: growth.quarterTarget, gap: growth.quarterGap },
    { label: '올해', revenue: growth.yearRevenue, target: growth.yearTarget, gap: growth.yearGap },
  ];

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
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
                className={`px-3 py-2 text-[10px] font-semibold min-h-[44px] transition ${
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
            className="px-3 py-2 rounded-lg text-[10px] font-semibold min-h-[44px] bg-[var(--success)]/10 text-[var(--success)] hover:bg-[var(--success)]/20 transition"
          >
            Excel
          </button>
          {/* PDF Download */}
          <button
            onClick={async () => {
              if (!finRaw || !companyId) return;
              const month = sliced[sliced.length - 1]?.month || new Date().toISOString().slice(0, 7);
              await generateMonthlyPLReport({
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
            className="px-3 py-2 rounded-lg text-[10px] font-semibold min-h-[44px] bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 transition"
          >
            PDF
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
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

      {/* Monthly Revenue Trend (Line) + Cash Flow (Area) */}
      {sliced.length > 1 && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-[var(--text)]">월별 매출 추이</span>
              <div className="flex items-center gap-3 text-[9px] text-[var(--text-dim)]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-0.5 bg-[var(--primary)]" />매출
                </span>
                <span className="flex items-center gap-1">
                  <span className="w-2 h-0.5 bg-[var(--warning)]" />순이익
                </span>
              </div>
            </div>
            <LineChart
              labels={sliced.map(m => m.label)}
              series={[
                { label: '매출', color: 'var(--primary)', values: sliced.map(m => m.revenue) },
                { label: '순이익', color: 'var(--warning)', values: sliced.map(m => m.netIncome) },
              ]}
              height={200}
            />
          </div>

          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-[var(--text)]">현금흐름 (누적)</span>
              <div className="flex items-center gap-3 text-[9px] text-[var(--text-dim)]">
                <span className="flex items-center gap-1">
                  <span className="w-2 h-0.5 bg-[var(--success)]" />누적 순현금
                </span>
              </div>
            </div>
            <LineChart
              labels={sliced.map(m => m.label)}
              series={[
                {
                  label: '누적 순현금',
                  color: 'var(--success)',
                  area: true,
                  values: sliced.reduce<number[]>((acc, m, i) => {
                    const prev = i === 0 ? 0 : acc[i - 1];
                    acc.push(prev + (m.revenue - m.expense));
                    return acc;
                  }, []),
                },
              ]}
              height={200}
            />
          </div>
        </div>
      )}

      {/* Pipeline Funnel + Upcoming Schedule */}
      {companyId && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-3 mb-3">
          <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[11px] font-semibold text-[var(--text)]">딜 파이프라인</span>
              <Link href="/deals" className="text-[10px] text-[var(--text-muted)] hover:text-[var(--primary)] transition">전체 보기 →</Link>
            </div>
            <DealFunnel companyId={companyId} />
          </div>
          <UpcomingScheduleCard companyId={companyId} windowDays={30} />
        </div>
      )}

      {/* Classification Breakdown */}
      {finData.classificationBreakdown.length > 0 && (
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 mb-3">
          <div className="text-[10px] text-[var(--text-dim)] mb-2 uppercase tracking-wider font-semibold">분류별 현황</div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
    mutationFn: ({ itemId, completed }: { itemId: string; completed: boolean }) => {
      if (!userId) throw new Error("Not authenticated");
      return toggleChecklistItem(itemId, userId, completed);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['closing-checklist'] }),
  });

  const completeMut = useMutation({
    mutationFn: () => {
      if (!userId) throw new Error("Not authenticated");
      return completeClosingChecklist(checklist!.id, userId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['closing-checklist'] }),
  });

  const lockMut = useMutation({
    mutationFn: () => {
      if (!userId) throw new Error("Not authenticated");
      return lockClosingMonth(checklist!.id, userId);
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['closing-checklist'] }),
  });

  const unlockMut = useMutation({
    mutationFn: () => {
      if (!userId) throw new Error("Not authenticated");
      return unlockClosingMonth(checklist!.id, userId);
    },
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

        {checklist.status === 'locked' ? (
          <div className="text-center py-3">
            <div className="text-sm text-[var(--text-dim)] font-semibold mb-2">🔒 마감 잠금됨</div>
            <p className="text-[10px] text-[var(--text-dim)] mb-2">이 달의 데이터 수정이 잠금되었습니다</p>
            <button onClick={() => { if (confirm("마감 잠금을 해제하시겠습니까? 데이터 수정이 가능해집니다.")) unlockMut.mutate(); }}
              disabled={unlockMut.isPending}
              className="px-3 py-1.5 text-[10px] bg-[var(--bg-surface)] text-[var(--text-muted)] rounded-lg hover:bg-[var(--bg-elevated)] transition disabled:opacity-50">
              {unlockMut.isPending ? '해제 중...' : '잠금 해제'}
            </button>
          </div>
        ) : checklist.status === 'completed' ? (
          <div className="text-center py-3">
            <div className="text-sm text-[var(--success)] font-semibold mb-2">마감 완료</div>
            <button onClick={() => lockMut.mutate()} disabled={lockMut.isPending}
              className="px-3 py-1.5 text-[10px] bg-[var(--warning)]/10 text-[var(--warning)] rounded-lg hover:bg-[var(--warning)]/20 transition disabled:opacity-50">
              {lockMut.isPending ? '잠금 중...' : '🔒 마감 잠금'}
            </button>
          </div>
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

// ═══════════════════════════════════════════
// DealFunnel — 딜 파이프라인 깔때기 (5단계)
// ═══════════════════════════════════════════
const FUNNEL_STAGES: { key: string; label: string; color: string; matches: (d: any) => boolean }[] = [
  { key: "lead",       label: "리드/문의",   color: "var(--text-muted)", matches: (d) => d.status === "pending" && !d.is_dormant },
  { key: "active",     label: "진행 중",     color: "var(--primary)",    matches: (d) => d.status === "active" && !d.is_dormant },
  { key: "quoted",     label: "견적/제안",   color: "var(--warning)",    matches: (d) => d.status === "active" && Number(d.contract_total || 0) > 0 && !d.is_dormant },
  { key: "won",        label: "수주 성공",   color: "var(--success)",    matches: (d) => d.status === "completed" || d.status === "closed_won" },
  { key: "lost",       label: "실패/보류",   color: "var(--danger)",     matches: (d) => d.status === "archived" || d.status === "closed_lost" || d.is_dormant },
];

function DealFunnel({ companyId }: { companyId: string }) {
  const { data: stages = [], isLoading } = useQuery<FunnelStage[]>({
    queryKey: ["deal-funnel", companyId],
    queryFn: async () => {
      const db = supabase as any;
      const { data, error } = await db
        .from("deals")
        .select("id, status, is_dormant, contract_total")
        .eq("company_id", companyId);
      if (error) throw error;
      const deals = data || [];
      return FUNNEL_STAGES.map((s) => {
        const matched = deals.filter(s.matches);
        return {
          label: s.label,
          count: matched.length,
          amount: matched.reduce((sum: number, d: any) => sum + (Number(d.contract_total) || 0), 0),
          color: s.color,
        };
      });
    },
    enabled: !!companyId,
    refetchInterval: 60_000,
  });

  if (isLoading) {
    return <div className="text-[11px] text-[var(--text-dim)] text-center py-8">불러오는 중…</div>;
  }
  return <FunnelChart stages={stages} height={220} />;
}

// ═══════════════════════════════════════════
// GettingStartedChecklist — 실데이터 카운트 기반 진행률
// ═══════════════════════════════════════════
const CHECKLIST_DISMISS_KEY = "leanos-getting-started-dismissed";

interface ChecklistStatus {
  company: boolean;
  bank: boolean;
  partner: boolean;
  deal: boolean;
  employee: boolean;
  transaction: boolean;
}

function GettingStartedChecklist({ companyId, initialDealCount }: { companyId: string; initialDealCount: number }) {
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    try {
      if (localStorage.getItem(CHECKLIST_DISMISS_KEY) === "1") setDismissed(true);
    } catch {}
  }, []);

  const { data: status } = useQuery<ChecklistStatus>({
    queryKey: ["getting-started", companyId],
    queryFn: async () => {
      const db = supabase as any;
      const [company, bank, partner, deal, employee, transaction] = await Promise.all([
        db.from("companies").select("id, business_number").eq("id", companyId).single(),
        db.from("bank_accounts").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        db.from("partners").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        db.from("deals").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        db.from("employees").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        db.from("transactions").select("id", { count: "exact", head: true }).eq("company_id", companyId),
      ]);
      return {
        company: !!company.data?.business_number,
        bank: (bank.count ?? 0) > 0,
        partner: (partner.count ?? 0) > 0,
        deal: (deal.count ?? initialDealCount) > 0,
        employee: (employee.count ?? 0) > 0,
        transaction: (transaction.count ?? 0) > 0,
      };
    },
    enabled: !!companyId && !dismissed,
    refetchInterval: 60_000,
  });

  const items = [
    { key: "company" as const, href: "/settings", label: "회사 정보 등록", desc: "사업자등록번호와 회사 정보를 입력하세요", icon: "🏢" },
    { key: "bank" as const, href: "/settings", label: "법인통장 연결", desc: "메인 계좌를 등록하면 잔고가 자동 추적됩니다", icon: "🏦" },
    { key: "partner" as const, href: "/partners", label: "거래처 등록", desc: "최소 1개 이상의 매출처/매입처를 추가하세요", icon: "🤝" },
    { key: "deal" as const, href: "/deals", label: "첫 프로젝트 생성", desc: "수주 한 건을 등록하면 매출/원가 추적이 시작됩니다", icon: "📋" },
    { key: "employee" as const, href: "/employees", label: "직원/팀원 추가", desc: "팀원을 초대하면 결재/급여를 사용할 수 있습니다", icon: "👥" },
    { key: "transaction" as const, href: "/import-hub", label: "거래내역 가져오기", desc: "엑셀 또는 자동 동기화로 첫 거래를 입력하세요", icon: "💸" },
  ];

  const completedCount = status ? items.filter((i) => status[i.key]).length : 0;
  const totalCount = items.length;
  const progressPct = (completedCount / totalCount) * 100;
  const allDone = completedCount === totalCount;

  if (dismissed) return null;
  // 완료 후 자동 숨김 (3일간 표시 후 사라지지만, 여기선 사용자 dismiss만)
  if (allDone) {
    return (
      <div className="mb-5 rounded-xl border border-[var(--success)]/30 bg-[var(--success)]/[.05] p-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full flex items-center justify-center bg-[var(--success)] text-white">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
          </div>
          <div>
            <div className="text-sm font-bold text-[var(--text)]">초기 설정이 모두 완료되었습니다 🎉</div>
            <div className="text-[11px] text-[var(--text-muted)]">이제 OwnerView의 모든 기능을 사용할 수 있습니다.</div>
          </div>
        </div>
        <button
          onClick={() => { try { localStorage.setItem(CHECKLIST_DISMISS_KEY, "1"); } catch {} setDismissed(true); }}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)] transition"
        >
          숨기기
        </button>
      </div>
    );
  }

  return (
    <div className="mb-5 rounded-xl border border-[var(--primary)]/20 bg-[var(--primary)]/[.03] p-5">
      <div className="flex items-center gap-2 mb-3">
        <div className="w-6 h-6 rounded-lg flex items-center justify-center text-white text-xs font-bold" style={{ background: 'var(--primary)' }}>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9 11l3 3L22 4"/><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/></svg>
        </div>
        <h3 className="text-sm font-bold text-[var(--text)]">시작 체크리스트</h3>
        <span className="ml-auto text-[11px] font-semibold mono-number text-[var(--primary)]">
          {completedCount}/{totalCount} 완료
        </span>
      </div>

      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-[var(--bg-surface)] overflow-hidden mb-4">
        <div
          className="h-full bg-[var(--primary)] transition-all duration-500"
          style={{ width: `${progressPct}%` }}
        />
      </div>

      <p className="text-xs mb-4 text-[var(--text-muted)]">
        실제 데이터를 입력해야 OwnerView가 가치를 발휘합니다. 항목을 클릭하면 해당 페이지로 이동합니다.
      </p>

      <div className="space-y-2">
        {items.map((item) => {
          const done = status?.[item.key] ?? false;
          return (
            <Link
              key={item.key}
              href={item.href}
              className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border transition hover:shadow-sm ${
                done
                  ? "bg-[var(--success)]/[.04] border-[var(--success)]/20"
                  : "bg-[var(--bg-card)] border-[var(--border)] hover:border-[var(--primary)]"
              }`}
            >
              <div
                className={`w-6 h-6 rounded-full shrink-0 flex items-center justify-center text-xs ${
                  done ? "bg-[var(--success)] text-white" : "bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)]"
                }`}
              >
                {done ? (
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span className="text-[10px]">{item.icon}</span>
                )}
              </div>
              <div className="flex-1 min-w-0">
                <div className={`text-xs font-semibold ${done ? "text-[var(--text-muted)] line-through" : "text-[var(--text)]"}`}>
                  {item.label}
                </div>
                <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{item.desc}</div>
              </div>
              {!done && (
                <span className="text-[10px] font-semibold text-[var(--primary)] shrink-0">
                  시작 →
                </span>
              )}
            </Link>
          );
        })}
      </div>

      <div className="flex justify-end mt-3">
        <button
          onClick={() => { try { localStorage.setItem(CHECKLIST_DISMISS_KEY, "1"); } catch {} setDismissed(true); }}
          className="text-[10px] text-[var(--text-muted)] hover:text-[var(--text)] transition"
        >
          나중에 보기
        </button>
      </div>
    </div>
  );
}

function GuideActionCard({ href, icon, label, done }: { href: string; icon: React.ReactNode; label: string; done?: boolean }) {
  return (
    <Link
      href={href}
      className="flex flex-col items-center gap-2 p-3 rounded-xl border transition hover:shadow-sm"
      style={{
        background: done ? 'var(--primary)/5' : 'var(--bg-card)',
        borderColor: done ? 'var(--primary)' : 'var(--border)',
      }}
    >
      <div
        className="w-8 h-8 rounded-lg flex items-center justify-center"
        style={{
          background: done ? 'var(--primary)' : 'var(--bg-surface)',
          color: done ? '#fff' : 'var(--text-muted)',
        }}
      >
        {done ? (
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <polyline points="20 6 9 17 4 12" />
          </svg>
        ) : icon}
      </div>
      <span className="text-[11px] font-semibold text-center" style={{ color: done ? 'var(--primary)' : 'var(--text)' }}>
        {label}
      </span>
    </Link>
  );
}

// ═══ Automation Widget ═══
function AutomationWidget({ companyId }: { companyId: string | null }) {
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<AutomationResult | null>(null);
  const queryClient = useQueryClient();

  const handleRun = async () => {
    if (!companyId || running) return;
    setRunning(true);
    try {
      const r = await runAllAutomation(companyId);
      setResult(r);
      queryClient.invalidateQueries();
    } catch (err: any) {
      setResult(null);
    }
    setRunning(false);
  };

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-500" />
          <h2 className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-wider">자동화 엔진</h2>
        </div>
        <button
          onClick={handleRun}
          disabled={running || !companyId}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold transition disabled:opacity-50"
          style={{
            background: running ? 'var(--bg-surface)' : 'var(--success)',
            color: running ? 'var(--text-muted)' : '#fff',
          }}
        >
          {running ? (
            <span className="flex items-center gap-1.5">
              <span className="w-3 h-3 border-2 border-current border-t-transparent rounded-full animate-spin" />
              자동화 실행 중...
            </span>
          ) : '전체 자동화 실행'}
        </button>
      </div>

      <div className="grid grid-cols-3 lg:grid-cols-6 gap-2">
        <AutoItem label="은행 자동분류" value={result ? `${result.bankClassification.matched}/${result.bankClassification.processed}` : '-'} />
        <AutoItem label="카드 자동매핑" value={result ? `${result.cardMapping.matched}/${result.cardMapping.processed}` : '-'} />
        <AutoItem label="3-Way 매칭" value={result ? `${result.threeWayMatch.autoMatched}건` : '-'} />
        <AutoItem label="거래 매칭" value={result ? `${result.transactionMatch.matched}건` : '-'} />
        <AutoItem label="휴면 딜 감지" value={result ? `${result.dormantDeals.detected}건` : '-'} />
        <AutoItem label="경비 자동승인" value={result ? `${result.expenseApproval.approved}건` : '-'} />
      </div>

      {result && (
        <div className="mt-2 text-[10px] text-[var(--text-dim)] text-right">
          마지막 실행: {new Date(result.timestamp).toLocaleString('ko-KR')}
        </div>
      )}
    </div>
  );
}

function AutoItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--bg-card)] p-2.5 text-center">
      <div className="text-[9px] font-semibold text-[var(--text-dim)] uppercase mb-1">{label}</div>
      <div className="text-sm font-bold text-[var(--text)]">{value}</div>
    </div>
  );
}

// ═══════════════════════════════════════════
// CEO Approval Center Widget
// ═══════════════════════════════════════════

const TYPE_CONFIG: Record<PendingActionType, { label: string; icon: string; color: string; href: string }> = {
  payment:   { label: '결제',   icon: '💳', color: '#3b82f6', href: '/payments' },
  expense:   { label: '경비',   icon: '🧾', color: '#f59e0b', href: '/employees' },
  document:  { label: '문서',   icon: '📄', color: '#8b5cf6', href: '/documents' },
  leave:     { label: '휴가',   icon: '🏖️', color: '#06b6d4', href: '/employees' },
  signature: { label: '서명',   icon: '✍️', color: '#ec4899', href: '/documents' },
  cost:      { label: '비용',   icon: '📊', color: '#ef4444', href: '/deals' },
  approval:  { label: '결재',   icon: '📋', color: '#10b981', href: '/approvals' },
};

function ApprovalCenterWidget({ companyId, userId }: { companyId: string; userId: string }) {
  const queryClient = useQueryClient();
  const [approving, setApproving] = useState<string | null>(null);
  const [bulkApproving, setBulkApproving] = useState(false);

  const { data: actions = [] } = useQuery({
    queryKey: ['ceo-pending-actions', companyId],
    queryFn: () => getCEOPendingActions(companyId),
    enabled: !!companyId,
    refetchInterval: 15_000,
  });

  const { data: summary } = useQuery({
    queryKey: ['ceo-approval-summary', companyId],
    queryFn: () => getApprovalSummary(companyId),
    enabled: !!companyId,
    refetchInterval: 15_000,
  });

  const handleApprove = async (type: PendingActionType, id: string) => {
    setApproving(id);
    try {
      const action = actions.find(a => a.id === id);
      await approveAction(companyId, type, id, userId);
      queryClient.invalidateQueries({ queryKey: ['ceo-pending-actions'] });
      queryClient.invalidateQueries({ queryKey: ['ceo-approval-summary'] });
      queryClient.invalidateQueries({ queryKey: ['founder-data'] });
      // Fire-and-forget: 승인 이메일 알림 (요청자에게)
      if (action?.requester) {
        const { data: reqUser } = await supabase.from('users').select('email, name').eq('name', action.requester).limit(1).single();
        if (reqUser?.email) {
          sendApprovalNotificationEmail({
            email: reqUser.email,
            recipientName: reqUser.name || undefined,
            actionType: type,
            actionTitle: action.title,
            result: 'approved',
          }).catch(() => {});
        }
      }
    } catch { /* ignore */ }
    setApproving(null);
  };

  const handleBulkApprove = async () => {
    if (!actions.length || bulkApproving) return;
    setBulkApproving(true);
    try {
      await bulkApproveActions(
        companyId,
        actions.map(a => ({ type: a.type, id: a.id })),
        userId,
      );
      queryClient.invalidateQueries({ queryKey: ['ceo-pending-actions'] });
      queryClient.invalidateQueries({ queryKey: ['ceo-approval-summary'] });
      queryClient.invalidateQueries({ queryKey: ['founder-data'] });
    } catch { /* ignore */ }
    setBulkApproving(false);
  };

  const total = summary?.total || 0;
  if (total === 0 && actions.length === 0) return null;

  return (
    <div className="mb-5 rounded-xl border bg-[var(--bg-card)] p-4"
      style={{ borderColor: total > 0 ? 'rgba(245,158,11,0.3)' : 'var(--border)' }}>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-[var(--warning)] animate-pulse" />
          <h3 className="text-xs font-bold text-[var(--text-dim)] uppercase tracking-wider">
            승인센터
          </h3>
          {total > 0 && (
            <span className="min-w-5 h-5 flex items-center justify-center rounded-full bg-[var(--danger)] text-white text-[10px] font-bold px-1.5">
              {total}
            </span>
          )}
        </div>
        {actions.length > 1 && (
          <button
            onClick={handleBulkApprove}
            disabled={bulkApproving}
            className="px-3 py-1 rounded-lg text-[10px] font-bold text-white transition disabled:opacity-50"
            style={{ background: 'var(--success)' }}
          >
            {bulkApproving ? '처리 중...' : `전체 승인 (${actions.length}건)`}
          </button>
        )}
      </div>

      {/* Summary badges */}
      {summary && (
        <div className="flex flex-wrap gap-1.5 mb-3">
          {(Object.keys(TYPE_CONFIG) as PendingActionType[]).map(type => {
            const count = summary[type === 'cost' ? 'costs' : `${type}s` as keyof typeof summary] as number;
            if (!count) return null;
            const tc = TYPE_CONFIG[type];
            return (
              <Link key={type} href={tc.href}
                className="flex items-center gap-1 px-2 py-1 rounded-md text-[10px] font-semibold transition hover:opacity-80"
                style={{ background: `${tc.color}15`, color: tc.color }}>
                <span>{tc.icon}</span>
                <span>{tc.label} {count}</span>
              </Link>
            );
          })}
        </div>
      )}

      {/* Action list (max 8) */}
      <div className="space-y-1.5">
        {actions.slice(0, 8).map(action => {
          const tc = TYPE_CONFIG[action.type];
          return (
            <div key={`${action.type}-${action.id}`}
              className="flex items-center justify-between gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] transition">
              <div className="flex items-center gap-2 min-w-0">
                <span className="text-xs flex-shrink-0">{tc.icon}</span>
                <span className="text-[10px] font-bold flex-shrink-0 px-1.5 py-0.5 rounded"
                  style={{ background: `${tc.color}15`, color: tc.color }}>
                  {tc.label}
                </span>
                <span className="text-xs text-[var(--text)] truncate">{action.title}</span>
                {action.amount && action.amount > 0 && (
                  <span className="text-[10px] font-semibold text-[var(--text-muted)] flex-shrink-0">
                    ₩{action.amount.toLocaleString()}
                  </span>
                )}
                {action.dealName && (
                  <span className="text-[9px] text-[var(--text-dim)] flex-shrink-0">
                    ({action.dealName})
                  </span>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                {action.urgency === 'high' && (
                  <span className="w-1.5 h-1.5 rounded-full bg-[var(--danger)]" />
                )}
                <button
                  onClick={() => handleApprove(action.type, action.id)}
                  disabled={approving === action.id}
                  className="px-2 py-1 rounded-md text-[10px] font-bold text-white transition disabled:opacity-50 hover:brightness-110"
                  style={{ background: 'var(--success)' }}
                >
                  {approving === action.id ? '...' : '승인'}
                </button>
              </div>
            </div>
          );
        })}
        {actions.length > 8 && (
          <div className="text-center text-[10px] text-[var(--text-dim)] pt-1">
            +{actions.length - 8}건 더보기
          </div>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Employee Dashboard — 출퇴근/프로젝트/휴가/급여/공지
// ═══════════════════════════════════════════

function EmployeeDashboard({ userName, companyId, companyName, userId }: {
  userName: string; companyId: string | null; companyName: string; userId: string | null;
}) {
  const db = supabase as any;
  const today = new Date().toISOString().split("T")[0];
  const yearMonth = today.substring(0, 7);
  const currentYear = new Date().getFullYear();
  const [checkingIn, setCheckingIn] = useState(false);
  const [checkingOut, setCheckingOut] = useState(false);
  const queryClient = useQueryClient();

  // 직원 ID 가져오기 (users.id → employees.id 매핑)
  const { data: employeeId } = useQuery({
    queryKey: ["emp-id", userId],
    queryFn: async () => {
      const { data } = await db
        .from("employees")
        .select("id")
        .eq("company_id", companyId!)
        .or(`email.eq.${userId},id.eq.${userId}`)
        .limit(1)
        .maybeSingle();
      return data?.id || userId;
    },
    enabled: !!companyId && !!userId,
  });

  // 오늘 출퇴근 기록
  const { data: todayAttendance } = useQuery({
    queryKey: ["emp-attendance-today", employeeId, today],
    queryFn: async () => {
      const { data } = await db
        .from("attendance_records")
        .select("*")
        .eq("employee_id", employeeId!)
        .eq("date", today)
        .maybeSingle();
      return data;
    },
    enabled: !!employeeId,
    refetchInterval: 30_000,
  });

  // 이번 달 출근 일수 + 근무시간
  const { data: monthSummary } = useQuery({
    queryKey: ["emp-month-summary", employeeId, yearMonth],
    queryFn: async () => {
      const startDate = `${yearMonth}-01`;
      const endDate = `${yearMonth}-31`;
      const { data } = await db
        .from("attendance_records")
        .select("work_hours, overtime_hours, status")
        .eq("employee_id", employeeId!)
        .gte("date", startDate)
        .lte("date", endDate);
      const records = data || [];
      const totalDays = records.filter((r: any) => r.status !== "absent").length;
      const totalHours = records.reduce((s: number, r: any) => s + Number(r.work_hours || 0), 0);
      const overtimeHours = records.reduce((s: number, r: any) => s + Number(r.overtime_hours || 0), 0);
      return { totalDays, totalHours: Math.round(totalHours * 10) / 10, overtimeHours: Math.round(overtimeHours * 10) / 10 };
    },
    enabled: !!employeeId,
  });

  // 내 프로젝트 수
  const { data: myDealCount = 0 } = useQuery({
    queryKey: ["emp-deals", companyId],
    queryFn: async () => {
      const { count } = await db
        .from("deals")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId!)
        .in("status", ["active", "in_progress", "proposal", "negotiation"]);
      return count ?? 0;
    },
    enabled: !!companyId,
  });

  // 휴가 잔여
  const { data: leaveBalance } = useQuery({
    queryKey: ["emp-leave-balance", companyId, employeeId, currentYear],
    queryFn: async () => {
      const { data } = await db
        .from("leave_balances")
        .select("total_days, used_days")
        .eq("company_id", companyId!)
        .eq("employee_id", employeeId!)
        .eq("year", currentYear)
        .maybeSingle();
      if (!data) return { total: 15, used: 0, remaining: 15 };
      return { total: data.total_days, used: data.used_days, remaining: data.total_days - data.used_days };
    },
    enabled: !!companyId && !!employeeId,
  });

  // 내 결재 요청 (경비 청구 등)
  const { data: myRequests } = useQuery({
    queryKey: ["emp-my-requests", userId, companyId],
    queryFn: async () => {
      const { data } = await db
        .from("approval_requests")
        .select("id, title, amount, request_type, status, created_at")
        .eq("company_id", companyId!)
        .eq("requester_id", userId!)
        .order("created_at", { ascending: false })
        .limit(10);
      return data || [];
    },
    enabled: !!companyId && !!userId,
  });

  // 이번 달 급여 (최근 payroll_items)
  const { data: myPayroll } = useQuery({
    queryKey: ["emp-payroll", employeeId],
    queryFn: async () => {
      const { data } = await db
        .from("payroll_items")
        .select("base_salary, deductions_total, net_pay, status, payment_batches!inner(name, created_at)")
        .eq("employee_id", employeeId!)
        .order("created_at", { ascending: false, referencedTable: "payment_batches" })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!employeeId,
  });

  // 알림
  const { data: notifications = [] } = useQuery({
    queryKey: ["emp-notifications", userId],
    queryFn: async () => {
      const { data } = await db
        .from("notifications")
        .select("id, type, title, message, is_read, created_at")
        .eq("user_id", userId!)
        .eq("is_read", false)
        .order("created_at", { ascending: false })
        .limit(5);
      return data || [];
    },
    enabled: !!userId,
  });

  // 출근/퇴근 처리
  const handleCheckIn = async () => {
    if (!employeeId || !companyId) return;
    setCheckingIn(true);
    try {
      const now = new Date().toISOString();
      await db.from("attendance_records").upsert({
        company_id: companyId,
        employee_id: employeeId,
        date: today,
        check_in: now,
        status: "present",
        work_hours: 0,
        overtime_hours: 0,
      }, { onConflict: "employee_id,date" });
      queryClient.invalidateQueries({ queryKey: ["emp-attendance-today"] });
    } catch {}
    setCheckingIn(false);
  };

  const handleCheckOut = async () => {
    if (!employeeId || !todayAttendance?.check_in) return;
    setCheckingOut(true);
    try {
      const now = new Date();
      const checkInTime = new Date(todayAttendance.check_in);
      const hours = Math.max(0, (now.getTime() - checkInTime.getTime()) / 3600000);
      const workHours = Math.round(Math.min(hours, 9) * 10) / 10;
      const overtime = Math.round(Math.max(0, hours - 9) * 10) / 10;
      await db.from("attendance_records").update({
        check_out: now.toISOString(),
        work_hours: workHours,
        overtime_hours: overtime,
      }).eq("employee_id", employeeId).eq("date", today);
      queryClient.invalidateQueries({ queryKey: ["emp-attendance-today"] });
      queryClient.invalidateQueries({ queryKey: ["emp-month-summary"] });
    } catch {}
    setCheckingOut(false);
  };

  const pendingCount = (myRequests || []).filter((r: any) => r.status === "pending").length;
  const expenseCount = (myRequests || []).filter((r: any) => r.request_type === "expense" || r.request_type === "card_expense").length;

  function fmtTime(iso: string | null): string {
    if (!iso) return "—";
    return new Date(iso).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
  }

  function elapsedSince(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const h = Math.floor(diff / 3600000);
    const m = Math.floor((diff % 3600000) / 60000);
    return `${h}h ${m}m`;
  }

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "방금";
    if (mins < 60) return `${mins}분 전`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}시간 전`;
    return `${Math.floor(hrs / 24)}일 전`;
  }

  const isCheckedIn = !!todayAttendance?.check_in;
  const isCheckedOut = !!todayAttendance?.check_out;

  return (
    <div className="max-w-[900px]">
      {/* Welcome header */}
      <div className="mb-5 md:mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-blue-500 to-indigo-600 flex items-center justify-center text-white font-bold text-sm">
            {(userName || "E").charAt(0)}
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-extrabold">{userName}님</h1>
            <p className="text-xs text-[var(--text-muted)]">{companyName} · {new Date().toLocaleDateString("ko-KR", { month: "long", day: "numeric", weekday: "short" })}</p>
          </div>
        </div>
      </div>

      {/* 출퇴근 카드 — 최상단, 가장 큰 영역 */}
      <div className="mb-4 bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 md:p-6">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className={`w-2.5 h-2.5 rounded-full ${isCheckedIn && !isCheckedOut ? "bg-green-500 animate-pulse" : isCheckedOut ? "bg-gray-400" : "bg-yellow-400"}`} />
            <span className="text-sm font-bold text-[var(--text)]">
              {!isCheckedIn ? "미출근" : isCheckedOut ? "퇴근 완료" : "근무 중"}
            </span>
          </div>
          {isCheckedIn && !isCheckedOut && (
            <span className="text-xs text-[var(--text-muted)] font-mono">{elapsedSince(todayAttendance.check_in)}</span>
          )}
        </div>

        {/* 출근/퇴근 시간 표시 */}
        <div className="flex items-center gap-6 mb-4">
          <div>
            <div className="text-[10px] text-[var(--text-dim)] mb-0.5">출근</div>
            <div className="text-lg font-black font-mono">{fmtTime(todayAttendance?.check_in)}</div>
          </div>
          <div className="text-[var(--text-dim)]">→</div>
          <div>
            <div className="text-[10px] text-[var(--text-dim)] mb-0.5">퇴근</div>
            <div className="text-lg font-black font-mono">{fmtTime(todayAttendance?.check_out)}</div>
          </div>
          {todayAttendance?.work_hours > 0 && (
            <>
              <div className="text-[var(--border)]">|</div>
              <div>
                <div className="text-[10px] text-[var(--text-dim)] mb-0.5">근무시간</div>
                <div className="text-lg font-black">{todayAttendance.work_hours}h</div>
              </div>
            </>
          )}
        </div>

        {/* 출근/퇴근 버튼 */}
        <div className="flex gap-3">
          {!isCheckedIn ? (
            <button
              onClick={handleCheckIn}
              disabled={checkingIn}
              className="flex-1 py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white text-sm font-bold transition active:scale-[0.98] disabled:opacity-50"
            >
              {checkingIn ? "처리 중..." : "출근하기"}
            </button>
          ) : !isCheckedOut ? (
            <button
              onClick={handleCheckOut}
              disabled={checkingOut}
              className="flex-1 py-3 rounded-xl bg-red-500 hover:bg-red-400 text-white text-sm font-bold transition active:scale-[0.98] disabled:opacity-50"
            >
              {checkingOut ? "처리 중..." : "퇴근하기"}
            </button>
          ) : (
            <div className="flex-1 py-3 rounded-xl bg-[var(--bg-surface)] text-center text-sm font-semibold text-[var(--text-muted)]">
              오늘 근무 완료
            </div>
          )}
        </div>

        {/* 이번 달 요약 */}
        {monthSummary && (
          <div className="mt-3 pt-3 border-t border-[var(--border)] flex items-center gap-4 text-[11px] text-[var(--text-muted)]">
            <span>이번 달: 출근 <b className="text-[var(--text)]">{monthSummary.totalDays}일</b></span>
            <span>근무 <b className="text-[var(--text)]">{monthSummary.totalHours}h</b></span>
            {monthSummary.overtimeHours > 0 && (
              <span>초과 <b className="text-orange-500">{monthSummary.overtimeHours}h</b></span>
            )}
          </div>
        )}
      </div>

      {/* 핵심 지표 2x2 — 동적 데이터 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 md:gap-4 mb-4">
        <Link href="/deals" className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4 md:p-5 hover:border-[var(--primary)] active:scale-[0.98] transition group touch-card">
          <div className="text-xl md:text-2xl mb-1.5">📋</div>
          <div className="text-[10px] md:text-xs text-[var(--text-dim)]">내 프로젝트</div>
          <div className="text-base md:text-lg font-bold mt-0.5 group-hover:text-[var(--primary)] transition">{myDealCount}건</div>
        </Link>
        <Link href="/employees" className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4 md:p-5 hover:border-[var(--primary)] active:scale-[0.98] transition group touch-card">
          <div className="text-xl md:text-2xl mb-1.5">🏖️</div>
          <div className="text-[10px] md:text-xs text-[var(--text-dim)]">휴가 잔여</div>
          <div className="text-base md:text-lg font-bold mt-0.5 group-hover:text-[var(--primary)] transition">
            {leaveBalance ? `${leaveBalance.remaining}일` : "—"}
          </div>
          {leaveBalance && (
            <div className="text-[9px] text-[var(--text-dim)] mt-0.5">{leaveBalance.total}일 중 {leaveBalance.used}일 사용</div>
          )}
        </Link>
        <Link href="/approvals" className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4 md:p-5 hover:border-[var(--primary)] active:scale-[0.98] transition group touch-card">
          <div className="text-xl md:text-2xl mb-1.5 relative">
            🧾
            {expenseCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center bg-[var(--primary)] text-white text-[8px] font-bold rounded-full px-0.5">{expenseCount}</span>
            )}
          </div>
          <div className="text-[10px] md:text-xs text-[var(--text-dim)]">경비 청구</div>
          <div className="text-base md:text-lg font-bold mt-0.5 group-hover:text-[var(--primary)] transition">{expenseCount}건</div>
        </Link>
        <Link href="/approvals" className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4 md:p-5 hover:border-[var(--primary)] active:scale-[0.98] transition group touch-card">
          <div className="text-xl md:text-2xl mb-1.5 relative">
            📝
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 min-w-[14px] h-[14px] flex items-center justify-center bg-orange-500 text-white text-[8px] font-bold rounded-full px-0.5">{pendingCount}</span>
            )}
          </div>
          <div className="text-[10px] md:text-xs text-[var(--text-dim)]">승인 대기</div>
          <div className="text-base md:text-lg font-bold mt-0.5 group-hover:text-[var(--primary)] transition" style={{ color: pendingCount > 0 ? "var(--warning)" : undefined }}>{pendingCount}건</div>
        </Link>
      </div>

      {/* 이번 달 급여 */}
      <div className="mb-4 bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4 md:p-5">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-2">
            <span className="text-base">💰</span>
            <span className="text-xs font-bold text-[var(--text)]">이번 달 급여</span>
          </div>
          <Link href="/employees" className="text-[10px] text-[var(--primary)] font-semibold hover:underline">상세 보기 →</Link>
        </div>
        {myPayroll ? (
          <div className="flex items-end gap-6">
            <div>
              <div className="text-[10px] text-[var(--text-dim)] mb-0.5">기본급</div>
              <div className="text-sm font-bold">{fmtWFull(myPayroll.base_salary)}</div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--text-dim)] mb-0.5">공제</div>
              <div className="text-sm font-bold text-red-400">-{fmtWFull(myPayroll.deductions_total)}</div>
            </div>
            <div>
              <div className="text-[10px] text-[var(--text-dim)] mb-0.5">실수령</div>
              <div className="text-lg font-black text-[var(--primary)]">{fmtWFull(myPayroll.net_pay)}</div>
            </div>
            <span className={`ml-auto text-[9px] px-2 py-0.5 rounded-full font-semibold ${
              myPayroll.status === "paid" ? "bg-green-500/10 text-green-500" : "bg-yellow-500/10 text-yellow-500"
            }`}>
              {myPayroll.status === "paid" ? "지급 완료" : "처리 중"}
            </span>
          </div>
        ) : (
          <div className="text-xs text-[var(--text-muted)]">이번 달 급여 정보가 아직 없습니다. 지급일: 매월 25일</div>
        )}
      </div>

      {/* 공지/알림 */}
      {notifications.length > 0 && (
        <div className="mb-4">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            <h2 className="text-xs font-bold text-[var(--text-dim)] tracking-wider">알림</h2>
            <span className="text-[10px] text-orange-500 font-bold">{notifications.length}건</span>
          </div>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]">
            {notifications.map((n: any) => (
              <div key={n.id} className="flex items-center gap-3 px-4 py-3">
                <span className="text-base shrink-0">🔔</span>
                <div className="flex-1 min-w-0">
                  <div className="text-xs text-[var(--text)] font-medium truncate">{n.title}</div>
                  {n.message && <div className="text-[10px] text-[var(--text-muted)] truncate">{n.message}</div>}
                </div>
                <span className="text-[10px] text-[var(--text-dim)] shrink-0">{timeAgo(n.created_at)}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 빠른 이동 */}
      <div className="mb-4">
        <div className="flex items-center gap-2 mb-3">
          <div className="w-2 h-2 rounded-full bg-[var(--text-dim)]" />
          <h2 className="text-xs font-bold text-[var(--text-dim)] tracking-wider">빠른 이동</h2>
        </div>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {[
            { href: "/chat", icon: "💬", label: "팀 채팅", desc: "팀원들과 대화" },
            { href: "/documents", icon: "📄", label: "문서/계약", desc: "서류 확인 및 서명" },
            { href: "/approvals", icon: "📋", label: "결재함", desc: "결재 요청 관리" },
            { href: "/employees", icon: "🏖️", label: "휴가 신청", desc: "연차 및 휴가 관리" },
          ].map(card => (
            <Link key={card.href} href={card.href}
              className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4 hover:border-[var(--primary)] active:scale-[0.98] transition group touch-card">
              <div className="text-xl mb-1.5">{card.icon}</div>
              <div className="text-xs font-bold group-hover:text-[var(--primary)] transition">{card.label}</div>
              <div className="text-[10px] text-[var(--text-muted)] mt-0.5">{card.desc}</div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════
// Partner Dashboard — 동적 카운트 + 최근 활동
// ═══════════════════════════════════════════

function PartnerDashboard({ userName, companyId, companyName, userId }: {
  userName: string; companyId: string | null; companyName: string; userId: string | null;
}) {
  const db = supabase as any;

  // 진행 중 프로젝트 수
  const { data: dealCount = 0 } = useQuery({
    queryKey: ["partner-deal-count", companyId],
    queryFn: async () => {
      const { count } = await db
        .from("deals")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId!)
        .in("status", ["active", "in_progress", "proposal", "negotiation"]);
      return count ?? 0;
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
  });

  // 서명 대기 문서 수
  const { data: signCount = 0 } = useQuery({
    queryKey: ["partner-sign-count", companyId, userId],
    queryFn: async () => {
      const { count } = await db
        .from("signature_requests")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId!)
        .eq("status", "pending_signature");
      return count ?? 0;
    },
    enabled: !!companyId,
    refetchInterval: 30_000,
  });

  // 안읽은 채팅 수
  const { data: unreadCount = 0 } = useQuery({
    queryKey: ["partner-unread", companyId, userId],
    queryFn: async () => {
      if (!userId) return 0;
      try {
        const counts = await import("@/lib/queries").then(m => m.getUnreadCounts(companyId!, userId));
        return Array.from(counts.values()).reduce((s: number, v: number) => s + v, 0);
      } catch { return 0; }
    },
    enabled: !!companyId && !!userId,
    refetchInterval: 15_000,
  });

  // 최근 활동 (채팅 메시지 + 문서 변경)
  const { data: recentActivity = [] } = useQuery({
    queryKey: ["partner-activity", companyId],
    queryFn: async () => {
      const activities: { type: string; text: string; time: string; href: string }[] = [];

      // 최근 채팅 메시지
      const { data: msgs } = await db
        .from("chat_messages")
        .select("content, created_at, chat_channels!inner(company_id, name)")
        .eq("chat_channels.company_id", companyId!)
        .order("created_at", { ascending: false })
        .limit(5);
      for (const m of msgs || []) {
        activities.push({
          type: "chat",
          text: `${m.chat_channels?.name || "채널"}: ${(m.content || "").slice(0, 40)}`,
          time: m.created_at,
          href: "/chat",
        });
      }

      // 최근 문서 변경
      const { data: docs } = await db
        .from("doc_templates")
        .select("title, updated_at, status")
        .eq("company_id", companyId!)
        .order("updated_at", { ascending: false })
        .limit(3);
      for (const d of docs || []) {
        const statusLabel = d.status === "pending_signature" ? "서명 대기" : d.status === "approved" ? "승인됨" : "수정됨";
        activities.push({
          type: "doc",
          text: `${d.title || "문서"} — ${statusLabel}`,
          time: d.updated_at,
          href: "/documents",
        });
      }

      return activities
        .sort((a, b) => new Date(b.time).getTime() - new Date(a.time).getTime())
        .slice(0, 6);
    },
    enabled: !!companyId,
    refetchInterval: 60_000,
  });

  function timeAgo(dateStr: string): string {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 1) return "방금";
    if (mins < 60) return `${mins}분 전`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}시간 전`;
    return `${Math.floor(hrs / 24)}일 전`;
  }

  const cards = [
    { label: "진행 중 프로젝트", count: dealCount, href: "/deals", icon: "📋", color: "#2563EB", desc: "현황 확인 및 진행 상태" },
    { label: "서명 대기", count: signCount, href: "/documents", icon: "📄", color: "#7C3AED", desc: "계약서, 견적서 검토 및 서명" },
    { label: "안읽은 메시지", count: unreadCount, href: "/chat", icon: "💬", color: "#059669", desc: "실시간 문의 및 파일 공유" },
  ];

  const hasTodo = signCount > 0 || unreadCount > 0;

  return (
    <div className="max-w-[900px]">
      {/* Welcome header */}
      <div className="mb-5 md:mb-6">
        <div className="flex items-center gap-3 mb-1">
          <div className="w-10 h-10 rounded-full bg-gradient-to-br from-violet-500 to-purple-600 flex items-center justify-center text-white font-bold text-sm">
            {(userName || "P").charAt(0)}
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-extrabold">{userName}님</h1>
            <p className="text-xs text-[var(--text-muted)]">{companyName || "파트너"} 협업 포털</p>
          </div>
        </div>
      </div>

      {/* 즉시 해야 할 일 알림 */}
      {hasTodo && (
        <div className="mb-4 p-4 rounded-xl border border-orange-400/30 bg-orange-400/5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-2 h-2 rounded-full bg-orange-400 animate-pulse" />
            <span className="text-xs font-bold text-orange-500">지금 해야 할 일</span>
          </div>
          <div className="space-y-1.5">
            {signCount > 0 && (
              <Link href="/documents" className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-surface)] transition">
                <span className="text-xs text-[var(--text)]">서명 대기 문서 {signCount}건</span>
                <span className="text-[10px] text-[var(--primary)] font-semibold">확인하기 &rarr;</span>
              </Link>
            )}
            {unreadCount > 0 && (
              <Link href="/chat" className="flex items-center justify-between px-3 py-2 rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-surface)] transition">
                <span className="text-xs text-[var(--text)]">안읽은 메시지 {unreadCount}건</span>
                <span className="text-[10px] text-[var(--primary)] font-semibold">확인하기 &rarr;</span>
              </Link>
            )}
          </div>
        </div>
      )}

      {/* Dynamic count cards */}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3 md:gap-4 mb-5">
        {cards.map((card) => (
          <Link
            key={card.label}
            href={card.href}
            className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 md:p-6 hover:border-[var(--primary)] active:scale-[0.98] transition group flex items-center gap-4 md:flex-col md:items-start md:gap-0 touch-card"
          >
            <div className="text-3xl md:mb-3 shrink-0 relative">
              {card.icon}
              {card.count > 0 && (
                <span className="absolute -top-1 -right-2 min-w-[18px] h-[18px] flex items-center justify-center bg-[var(--danger)] text-white text-[9px] font-bold rounded-full px-1">
                  {card.count > 99 ? "99+" : card.count}
                </span>
              )}
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <h3 className="font-bold text-sm md:text-base group-hover:text-[var(--primary)] transition">{card.label}</h3>
                <span className="text-lg font-black" style={{ color: card.count > 0 ? card.color : 'var(--text-muted)' }}>{card.count}건</span>
              </div>
              <p className="text-xs text-[var(--text-muted)] truncate md:whitespace-normal">{card.desc}</p>
            </div>
            <svg className="w-5 h-5 text-[var(--text-dim)] shrink-0 md:hidden" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><polyline points="9 18 15 12 9 6"/></svg>
          </Link>
        ))}
      </div>

      {/* 최근 활동 타임라인 */}
      {recentActivity.length > 0 && (
        <div className="mb-5">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-2 h-2 rounded-full bg-[var(--primary)]" />
            <h2 className="text-xs font-bold text-[var(--text-dim)] tracking-wider">최근 활동</h2>
          </div>
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] divide-y divide-[var(--border)]">
            {recentActivity.map((act, i) => (
              <Link key={i} href={act.href} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--bg-surface)] transition">
                <span className="text-base shrink-0">{act.type === "chat" ? "💬" : "📄"}</span>
                <span className="text-xs text-[var(--text)] flex-1 truncate">{act.text}</span>
                <span className="text-[10px] text-[var(--text-dim)] shrink-0">{timeAgo(act.time)}</span>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Info card */}
      <div className="bg-gradient-to-br from-[var(--primary-light)] to-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-5 md:p-6">
        <div className="flex items-start gap-3">
          <div className="w-8 h-8 rounded-lg bg-[var(--primary)] flex items-center justify-center text-white shrink-0">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg>
          </div>
          <div>
            <h3 className="font-bold text-sm mb-1">도움이 필요하신가요?</h3>
            <p className="text-xs text-[var(--text-muted)] leading-relaxed">프로젝트 관련 문의는 채팅으로 담당자에게 연락하세요. 서류 서명이 필요한 경우 서류 페이지에서 바로 진행할 수 있습니다.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
