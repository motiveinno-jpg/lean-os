"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, getFounderData, getCashPulseData, saveExcelData } from "@/lib/queries";
import { getRecurringPayments } from "@/lib/approval-center";
import { getMonthlyTotalSalary } from "@/lib/payroll";
import { supabase } from "@/lib/supabase";
import { buildCashPulse, type CashPulseResult } from "@/lib/cash-pulse";
import { buildFounderDashboard, type FounderDashboardData } from "@/lib/engines";
import { parseExcel, type ParsedExcelData } from "@/lib/excel-parser";
import { generateSampleData } from "@/lib/sample-data";
import { useMyPermissions } from "@/lib/permissions";
import { OwnerCommandCenter } from "@/components/owner-command-center";
import { OwnerDashboardSection } from "@/components/owner-dashboard-section";
import { ClosingChecklistWidget } from "@/components/closing-checklist-widget";

// 마스터 전용 화면 (2026-08-10 사장님) — 대시보드 하단 경영 종합 3종을 그대로 이동:
//   ① CEO 커맨드 센터(액션·펄스·목표·리스크) ② 프로젝트 경영 종합 ③ 월 마감 체크리스트.
//   대시보드에는 위젯 그리드까지만 남는다. 쿼리 키는 대시보드와 동일해 캐시를 공유한다.
export default function MasterPage() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { isMaster, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  // 데이터 없음 CTA (대시보드에서 이동, 2026-08-10 사장님 2차) — 업로드/샘플 핸들러도 함께
  const fileRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [parseResult, setParseResult] = useState<{ success: boolean; message: string } | null>(null);

  const [userName, setUserName] = useState("");
  useEffect(() => {
    getCurrentUser().then((u) => {
      setCompanyId(u?.company_id ?? null);
      setUserId(u?.id ?? null);
      setUserName(u?.name || "");
    });
  }, []);

  // 마스터가 아니면 대시보드로 — 게이트는 early return 없이 렌더 분기로 (훅 순서 보존)
  useEffect(() => {
    if (!permLoading && !isMaster) router.replace("/dashboard");
  }, [permLoading, isMaster, router]);

  const { data: rawData } = useQuery({
    queryKey: ["founder-data", companyId],
    queryFn: () => getFounderData(companyId!),
    enabled: !!companyId && isMaster,
    refetchInterval: 30_000,
    retry: 1,
  });

  // 실제 월 고정비 — 대시보드와 동일 산식(정기지출 + 급여 + 수동 입력)
  const { data: realBurnData } = useQuery({
    queryKey: ["real-burn", companyId],
    queryFn: async () => {
      const [recurring, totalSalary, snapshot] = await Promise.all([
        getRecurringPayments(companyId!),
        getMonthlyTotalSalary(companyId!),
        (supabase).from('cash_snapshot')
          .select('monthly_fixed_cost').eq('company_id', companyId!).maybeSingle(),
      ]);
      const recurringTotal = (recurring || [])
        .filter((r: any) => r.is_active)
        .reduce((s: number, r: any) => s + Number(r.amount || 0), 0);
      const manualFixed = Number(snapshot.data?.monthly_fixed_cost || 0);
      return recurringTotal + totalSalary + manualFixed;
    },
    enabled: !!companyId && isMaster,
    refetchInterval: 30_000,
  });

  const { data: pulseRaw } = useQuery({
    queryKey: ["cash-pulse", companyId, userId],
    queryFn: () => getCashPulseData(companyId!, userId || undefined),
    enabled: !!companyId && isMaster,
    refetchInterval: 30_000,
    retry: 1,
  });
  const cashPulse: CashPulseResult | null = pulseRaw ? buildCashPulse(pulseRaw) : null;

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

  // 엑셀 업로드 — 대시보드와 동일 파싱·저장 경로
  const handleExcelUpload = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !companyId) return;
    setUploading(true);
    setParseResult(null);
    try {
      const buffer = await file.arrayBuffer();
      const parsed: ParsedExcelData = parseExcel(buffer);
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

  const handleSampleData = useCallback(async () => {
    if (!companyId) return;
    setGenerating(true);
    const result = await generateSampleData(companyId);
    setParseResult(result);
    queryClient.invalidateQueries({ queryKey: ["founder-data"] });
    setGenerating(false);
  }, [companyId, queryClient]);

  if (permLoading || !isMaster) return null;

  // 인사말 — 시간대별 (2026-08-11 시각화 개편: 레퍼런스의 "Good morning" 헤더)
  const hour = new Date().getHours();
  const greeting = hour < 5 ? "늦은 시간까지 수고 많으십니다" : hour < 12 ? "좋은 아침입니다" : hour < 18 ? "좋은 오후입니다" : "오늘도 수고 많으셨습니다";
  const todayLabel = (() => {
    const d = new Date();
    const wd = ["일", "월", "화", "수", "목", "금", "토"][d.getDay()];
    return `${d.getMonth() + 1}월 ${d.getDate()}일 ${wd}요일`;
  })();

  return (
    <div className="master-page">
      <header className="master-header">
        <h1 className="master-header-greeting">{greeting}{userName ? `, ${userName}님` : ""}</h1>
        <p className="master-header-sub">{todayLabel} · 오늘의 경영 현황입니다</p>
      </header>

      {/* ═══ ① CEO 커맨드 센터 — 1행 비주얼 3카드(펄스 도넛·목표 게이지·월마감 링) + 2행 액션·리스크 ═══ */}
      {companyId && (
        <OwnerCommandCenter
          companyId={companyId}
          userId={userId}
          sixPack={dashboard.sixPack}
          growth={dashboard.growth}
          risks={dashboard.risks}
          riskCounts={dashboard.riskCounts}
          cashPulse={cashPulse}
        />
      )}

      {/* ═══ 데이터 없음 — 시작 CTA (대시보드에서 이동) ═══ */}
      {!hasData && (
        <div className="dashboard-empty-state-cta">
          <div className="text-sm font-bold text-[var(--text)] mb-1">아직 재무 데이터가 없습니다</div>
          <p className="text-xs text-[var(--text-muted)] mb-4">아래 방법 중 하나를 선택해 시작하세요.</p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <button onClick={handleSampleData} disabled={generating}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border-2 border-[var(--primary)] bg-[var(--primary)]/5 hover:bg-[var(--primary)]/10 transition disabled:opacity-50">
              <span className="text-sm font-bold text-[var(--primary)]">{generating ? '생성 중...' : '샘플 데이터 생성'}</span>
              <span className="text-[10px] text-[var(--text-muted)]">추천 — 즉시 체험</span>
            </button>
            <button onClick={() => fileRef.current?.click()} disabled={uploading}
              className="flex flex-col items-center gap-2 p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] transition disabled:opacity-50">
              <span className="text-sm font-bold text-[var(--text)]">{uploading ? '업로드 중...' : '엑셀 업로드'}</span>
              <span className="text-[10px] text-[var(--text-muted)]">실제 데이터로 시작</span>
            </button>
            <Link href="/guide"
              className="flex flex-col items-center gap-2 p-4 rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] transition">
              <span className="text-sm font-bold text-[var(--text)]">시작 가이드 보기</span>
              <span className="text-[10px] text-[var(--text-muted)]">사용법 안내</span>
            </Link>
          </div>
          <input ref={fileRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleExcelUpload} />
          {parseResult && (
            <div className={`dashboard-parse-toast mt-3 ${
              parseResult.success ? 'bg-[var(--success)]/10 border border-[var(--success)]/20 text-[var(--success)]'
                : 'bg-[var(--danger)]/10 border border-[var(--danger)]/20 text-[var(--danger)]'
            }`}>
              {parseResult.message}
              <button onClick={() => setParseResult(null)} className="ml-2 opacity-60 hover:opacity-100">✕</button>
            </div>
          )}
        </div>
      )}

      {/* ═══ ② 월 마감 — 한 줄 진행바(펼치면 체크리스트) ═══ */}
      {companyId && <ClosingChecklistWidget companyId={companyId} userId={userId} />}

      {/* ═══ ③ 프로젝트 경영 종합 — 분기 KPI 밴드·단계 밴드·완료 보고서 ═══ */}
      <OwnerDashboardSection />
    </div>
  );
}
