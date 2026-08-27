"use client";
/**
 * 분석 › 부가세 — 세금계산서 화면에서 옮겨 왔다 (2026-08-13 사장님 지시).
 *
 *   "세금증빙은 오너뷰에서 발행하는 것들에 대한 통합관리 메뉴로" → 부가세·기간별 집계는
 *   **매입 자료로 계산하는 신고용**이라 발행 메뉴에 있을 자리가 아니다. 분석이 맞다.
 *
 *   옛 딥링크 `/tax-invoices?tab=vat` · `?tab=summary` 는 그쪽에서 여기로 넘긴다
 *   (대시보드의 '부가세 납부' 카드가 그 주소를 쓴다).
 */
import { useEffect, useState } from "react";
import { ReportHead } from "../_components/ReportHead";
import { ChipGroup } from "@/components/query-kit";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { getVATPreview, getTaxInvoiceSummary, type PeriodType } from "@/lib/tax-invoice";
import { getCardDeductionSummary } from "@/lib/card-transactions";
import { todayKst } from "@/lib/kst";
import { SummaryTab, VatByVoucherType, VATPreviewTab } from "./_components/VatReport";
import { VatReturn } from "./_components/VatReturn";

export default function VatReportPage() {
  const searchParams = useSearchParams();
  const [companyId, setCompanyId] = useState<string | null>(null);
  //   `?tab=summary` 로 들어오면 기간별 집계부터 — 옛 링크를 그대로 살려 준다
  //   ?tab=return — 신고서 준비(2026-08-27 ERP ④)
  const [tab, setTab] = useState<"vat" | "summary" | "return">(
    () => { const t = searchParams?.get("tab"); return t === "summary" ? "summary" : t === "return" ? "return" : "vat"; });
  const [periodType, setPeriodType] = useState<PeriodType>("monthly");
  //   기준 연도 — 부가세는 해 단위로 신고하므로 연도 하나만 고르면 된다(월 범위는 필요 없다)
  const [year, setYear] = useState(() => Number(todayKst().slice(0, 4)));

  useEffect(() => { getCurrentUser().then((u: any) => { if (u?.company_id) setCompanyId(u.company_id); }); }, []);

  const { data: vatPreview = [] } = useQuery({
    queryKey: ["vat-preview", companyId, year],
    queryFn: () => getVATPreview(companyId!, year),
    enabled: !!companyId && tab === "vat",
  });
  const { data: periodSummary = [] } = useQuery({
    queryKey: ["tax-period-summary", companyId, year, periodType],
    queryFn: () => getTaxInvoiceSummary(companyId!, year, periodType),
    enabled: !!companyId && tab === "summary",
  });
  const { data: cardDeductions = [] } = useQuery({
    queryKey: ["card-deductions", companyId, year],
    queryFn: () => getCardDeductionSummary(companyId!, year),
    enabled: !!companyId,
  });

  const thisYear = Number(todayKst().slice(0, 4));
  const years = [thisYear, thisYear - 1, thisYear - 2];

  return (
    <div className="vat-report-page" data-print-area>
      {/* 리포트 표준 2차(2026-08-19) — 보기(부가세 예상/기간별 집계)·연도는 상자 머리 조회 줄에 */}
      <ReportHead
        bar={<>
          <ChipGroup value={tab} onChange={setTab} options={[{ value: "vat", label: "부가세 예상" }, { value: "summary", label: "기간별 집계" }, { value: "return", label: "신고서 준비" }] as const} />
          {/*   연도 — 부가세는 해 단위 신고라 달까지 고를 이유가 없다 */}
          <label className="text-xs font-semibold text-[var(--text-dim)]">연도</label>
          <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs">
            {years.map((y) => <option key={y} value={y}>{y}년</option>)}
          </select>
        </>}
      />

      {tab === "return" && <VatReturn companyId={companyId} year={year} />}

      {tab === "summary" && (
        <SummaryTab
          periodSummary={periodSummary}
          periodType={periodType}
          setPeriodType={setPeriodType}
          cardDeductions={cardDeductions}
          currentYear={year}
        />
      )}

      {tab === "vat" && (
        <>
          <VatByVoucherType companyId={companyId} year={year} />
          <VATPreviewTab vatPreview={vatPreview} cardDeductions={cardDeductions} />
        </>
      )}
    </div>
  );
}
