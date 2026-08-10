"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser, getFounderData, getCashPulseData } from "@/lib/queries";
import { getRecurringPayments } from "@/lib/approval-center";
import { getMonthlyTotalSalary } from "@/lib/payroll";
import { supabase } from "@/lib/supabase";
import { buildCashPulse, type CashPulseResult } from "@/lib/cash-pulse";
import { buildFounderDashboard, type FounderDashboardData } from "@/lib/engines";
import { useMyPermissions } from "@/lib/permissions";
import { OwnerCommandCenter } from "@/components/owner-command-center";
import { OwnerDashboardSection } from "@/components/owner-dashboard-section";
import { ClosingChecklistWidget } from "@/components/closing-checklist-widget";

// 마스터 전용 화면 (2026-08-10 사장님) — 대시보드 하단 경영 종합 3종을 그대로 이동:
//   ① CEO 커맨드 센터(액션·펄스·목표·리스크) ② 프로젝트 경영 종합 ③ 월 마감 체크리스트.
//   대시보드에는 위젯 그리드까지만 남는다. 쿼리 키는 대시보드와 동일해 캐시를 공유한다.
export default function MasterPage() {
  const router = useRouter();
  const { isMaster, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);

  useEffect(() => {
    getCurrentUser().then((u) => {
      setCompanyId(u?.company_id ?? null);
      setUserId(u?.id ?? null);
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

  if (permLoading || !isMaster) return null;

  return (
    <div className="master-page">
      <header className="mb-4">
        <h1 className="text-lg font-bold text-[var(--text)]">마스터</h1>
        <p className="text-xs text-[var(--text-muted)]">경영 종합 — 커맨드 센터 · 프로젝트 경영 · 월결산 (마스터 전용)</p>
      </header>

      {/* ═══ ① CEO 커맨드 센터 — 액션(결재 즉시승인·매칭·미수금·위험) + 펄스/목표/리스크 ═══ */}
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

      {/* ═══ ② 프로젝트 경영 종합 — 분기 KPI·단계분포·TOP 거래처/담당자·추이 ═══ */}
      <OwnerDashboardSection />

      {/* ═══ ③ 월결산 ═══ */}
      <div className="mt-4">
        <ClosingChecklistWidget companyId={companyId} userId={userId} />
      </div>
    </div>
  );
}
