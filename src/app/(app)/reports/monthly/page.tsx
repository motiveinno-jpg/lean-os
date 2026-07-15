"use client";

// 월별 상세 — 경영 흐름의 "월별 표(1년치)"를 분석 일급 탭으로 승격(2026-07-08).
//   행=계정(매출·매입원가·고정비·변동비·부가세·순이익·영업이익률·BEP·통장잔액), 열=월.
//   셀 클릭 → 구성 드릴다운, 셀 모드 토글(금액/전월대비/전년동월/누계/구성비). 기존 FlowMatrix 재사용.

import { useEffect, useState } from "react";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { ReportsTabs } from "../_components/ReportsTabs";
import { FlowMatrix } from "../flow/_components/FlowMatrix";
import { ymNow } from "../_components/kit";

export default function MonthlyDetailPage() {
  const { role } = useUser();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const { month } = ymNow();

  useEffect(() => { getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, []);

  if (role === "partner" || role === "employee") {
    return <AccessDenied detail="월별 상세는 대표·관리자 전용입니다." />;
  }

  return (
    <div className="monthly-detail-page space-y-6">
      <ReportsTabs />
      <p className="monthly-detail-intro text-xs text-[var(--text-muted)] -mt-2">
        월별로 계정별 금액을 보고, 셀을 클릭하면 그 금액이 어떻게 구성됐는지 확인할 수 있습니다.
        상단 토글로 <b>전월·전년동월 비교</b>, 누계, 구성비도 볼 수 있습니다.
      </p>
      {companyId ? (
        <FlowMatrix companyId={companyId} currentMonth={month} />
      ) : (
        <div className="flex items-center justify-center py-20"><div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" /></div>
      )}
    </div>
  );
}
