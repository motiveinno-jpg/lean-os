"use client";
import { WaterfallChart } from "@/components/charts/kit";
import { getHometaxPausedUntil, setHometaxPause, clearHometaxPause } from "@/lib/data-sync";
import { useMyPermissions } from "@/lib/permissions";
import { Ico } from "@/components/ui-icon";
import { todayKst, kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";
import { SortableTh, type ThFilterSpec } from "@/components/sortable-th";
import {
  vatBusinessTypeOf, canIssueTaxKind, taxKindBlockedReason, type TaxKind, type VatBusinessType,
} from "@/lib/vat-business-type";
//   조회 화면 표준 공용 부품 — 새 툴바를 만들지 말고 반드시 이걸 쓴다 (CLAUDE.md)
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, ExcelMenu, HelperMenu,
  SavedTabs, ConditionSave, ConditionPanel, ConditionRow, TokenField, AmountRange, ChipGroup,
  AppliedChips, QuickSearch, quickSearchHit, quickTerms, amountHit, RowsPerPage,
  Pager, usePager, useSavedQueries, SelectionBar, defaultRangeMonth, periodQuicksMonth,
  type ExcelItem, type AppliedChip,
} from "@/components/query-kit";
import { exportToExcel as exportSheet } from "@/lib/excel-export";

import Link from "next/link";
import { MonthField } from "@/components/month-field";
import { DateRangeField } from "@/components/date-range-field";
import { DateField } from "@/components/date-field";
import { useSearchParams, useRouter } from "next/navigation";
import { friendlyError } from "@/lib/friendly-error";
import { Fragment, useEffect, useState, useMemo, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { invalidateTaxInvoiceReaders } from "@/lib/tax-invoice-invalidate";
import { fetchPaged } from "@/lib/fetch-paged";
import { useSyncCooldown } from "@/lib/sync-cooldown";
import { getCurrentUser } from "@/lib/queries";
import { useColWidths } from "../partners/ledger/shared";
import {
  createTaxInvoice,
  markInvoiceMatched,
  getTaxInvoiceSummary,
  getVATPreview,
  modifyTaxInvoice,
  getInvoiceQueue,
  approveQueueItem,
  getHomeTaxSyncLogs,
  INVOICE_TYPES,
  INVOICE_STATUS,
  invoiceStatusMeta,
  issueTaxInvoice,
  registerHometaxIssuer,
  itemsLabel,
} from "@/lib/tax-invoice";
import { getTaxInvoiceIssuanceStatus } from "@/lib/billing";
import type { PeriodType } from "@/lib/tax-invoice";
import { getCardDeductionSummary } from "@/lib/card-transactions";
import * as XLSX from "xlsx";
import { TaxInvoiceBulkIssueModal } from "@/components/tax-invoice-bulk-issue";
import { QueryErrorBanner } from "@/components/query-status";
import { ToolbarPopover, ToolbarPopoverItem } from "@/components/toolbar-popover";
import { summarizeByVatType } from "@/lib/vat-voucher";
import { CurrencyInput } from "@/components/currency-input";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { useCanAccessTab } from "@/lib/tab-access";
import { generateTaxInvoicePdf } from "@/lib/document-generator";
import type { TaxInvoicePdfParams } from "@/lib/document-generator";
import { getThreeWayCandidates, confirmThreeWayMatch, unmatchInvoice } from "@/lib/three-way-match";

// ── Print Styles ──
const PRINT_STYLE_ID = "tax-invoice-print-style";
function ensurePrintStyles() {
  if (typeof document === "undefined") return;
  if (document.getElementById(PRINT_STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = PRINT_STYLE_ID;
  style.textContent = `
    @media print {
      body { background: white !important; color: black !important; }
      body * { visibility: hidden; }
      [data-print-area], [data-print-area] * { visibility: visible !important; color: black !important; }
      [data-print-area] {
        position: fixed !important;
        left: 0 !important;
        top: 0 !important;
        width: 100% !important;
        z-index: 99999 !important;
        background: #fff !important;
        color: #000 !important;
        padding: 10mm !important;
        -webkit-print-color-adjust: exact;
        print-color-adjust: exact;
      }
      nav, .sidebar, .no-print, button { display: none !important; }
      .fixed:not(:has([data-print-area])), [class*="backdrop"]:not(:has([data-print-area])) { display: none !important; }
      .fixed:has([data-print-area]) { position: fixed !important; inset: 0 !important; background: #fff !important; overflow: visible !important; z-index: 99999 !important; }
      .fixed:has([data-print-area]) > div { max-height: none !important; overflow: visible !important; }
      table { border-collapse: collapse; width: 100%; }
      th, td { border: 1px solid #ddd; padding: 4px 8px; }
      .print\\:border-black { border-color: #000 !important; }
      @page { margin: 10mm; }
    }
  `;
  document.head.appendChild(style);
}

// ── Duplicate Invoice Detection ──
interface DuplicateGroup {
  key: string;
  counterpartyName: string;
  amount: number;
  date: string;
  count: number;
  ids: string[];
}

function detectDuplicateInvoices(invoices: any[]): DuplicateGroup[] {
  const groups = new Map<string, { invoices: any[]; count: number }>();
  for (const inv of invoices) {
    const key = `${inv.counterparty_name}|${Number(inv.total_amount)}|${inv.issue_date}`;
    const existing = groups.get(key);
    if (existing) {
      existing.count++;
      existing.invoices.push(inv);
    } else {
      groups.set(key, { count: 1, invoices: [inv] });
    }
  }
  const duplicates: DuplicateGroup[] = [];
  Array.from(groups.entries()).forEach(([key, group]) => {
    if (group.count > 1) {
      const first = group.invoices[0];
      duplicates.push({
        key,
        counterpartyName: first.counterparty_name,
        amount: Number(first.total_amount),
        date: first.issue_date,
        count: group.count,
        ids: group.invoices.map((i: any) => i.id),
      });
    }
  });
  return duplicates;
}

// ── 3-Way Matching Visualization ──
function ThreeWayMatchVisual({ result }: { result: any }) {
  const r = result;
  const hasPO = r.contractAmount > 0;
  const hasPayment = r.receivedAmount > 0;
  const poToInvoice = r.amountMatch;
  const invoiceToPayment = r.paymentMatch;

  return (
    <div className="flex items-center gap-1.5 text-xs">
      {/* PO */}
      <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border ${
        hasPO ? "border-[var(--border)] bg-[var(--bg-surface)]" : "border-dashed border-[var(--border)] opacity-50"
      }`}>
        <span className="font-medium">PO</span>
        {hasPO && <span className="text-[10px] text-[var(--text-muted)]">{fmt(r.contractAmount)}</span>}
      </div>
      {/* Arrow PO -> Invoice */}
      <span className={`text-sm font-bold ${
        !hasPO ? "text-[var(--text-dim)]" : poToInvoice ? "text-green-400" : "text-red-400"
      }`}>
        {!hasPO ? "—" : poToInvoice ? "✓" : "✗"}
      </span>
      {/* Invoice */}
      <div className="flex items-center gap-1 px-2 py-1 rounded-lg border border-[var(--primary)]/30 bg-[var(--primary)]/5">
        <span className="font-medium text-[var(--primary)]">계산서</span>
        <span className="text-[10px] text-[var(--text-muted)]">{fmt(r.invoiceSupplyAmount)}(공급가)</span>
      </div>
      {hasPO && !poToInvoice && (
        <span className="px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[9px] font-bold whitespace-nowrap">차액 {fmt(Math.abs(r.contractAmount - r.invoiceSupplyAmount))}</span>
      )}
      {r.suggestedDeal && poToInvoice && (
        <span className="px-1.5 py-0.5 rounded-full bg-green-500/15 text-green-500 text-[9px] font-bold whitespace-nowrap">추천</span>
      )}
      {/* Arrow Invoice -> Payment */}
      <span className={`text-sm font-bold ${
        !hasPayment ? "text-[var(--text-dim)]" : invoiceToPayment ? "text-green-400" : "text-red-400"
      }`}>
        {!hasPayment ? "—" : invoiceToPayment ? "✓" : "✗"}
      </span>
      {/* Payment */}
      <div className={`flex items-center gap-1 px-2 py-1 rounded-lg border ${
        hasPayment ? "border-[var(--border)] bg-[var(--bg-surface)]" : "border-dashed border-[var(--border)] opacity-50"
      }`}>
        <span className="font-medium">결제</span>
        {hasPayment && <span className="text-[10px] text-[var(--text-muted)]">{fmt(r.receivedAmount)}</span>}
      </div>
      {hasPayment && !invoiceToPayment && (
        <span className="px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400 text-[9px] font-bold whitespace-nowrap">차액 {fmt(Math.abs(r.gap))}</span>
      )}
    </div>
  );
}

// ── Excel export ──
function exportToExcel(invoices: any[], filename: string) {
  const ws = XLSX.utils.json_to_sheet(
    invoices.map((inv) => ({
      거래처: inv.counterparty_name,
      사업자번호: inv.counterparty_bizno || "",
      공급가액: Number(inv.supply_amount),
      세액: Number(inv.tax_amount),
      합계: Number(inv.total_amount),
      발행일: inv.issue_date,
      상태: invoiceStatusMeta(inv.status, inv.type).label,
    }))
  );
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "세금계산서");
  XLSX.writeFile(wb, filename);
}

// ── Helpers ──
function getCurrentMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

function fmt(n: number) {
  return "₩" + Math.round(n).toLocaleString("ko");
}

// label 앞에 붙은 영수/청구 토큰 제거 → 적요/품목엔 순수 내용만 표시.
//   (영수/청구 구분은 홈택스 전자계산서 데이터에 없어 label 토큰으로 보관 — 상세에서 수동 지정 가능)
function stripPurposeToken(label?: string | null) {
  if (!label) return "";
  return label.replace(/^\s*(영수|청구)\s*(\|\s*)?/, "").trim();
}

// ── 비목 (Expense Categories) ──
const EXPENSE_CATEGORIES = [
  { value: "", label: "선택하세요" },
  { value: "goods", label: "상품매출/매입" },
  { value: "service", label: "용역/서비스" },
  { value: "rent", label: "임대료" },
  { value: "commission", label: "수수료" },
  { value: "advertising", label: "광고선전비" },
  { value: "consumables", label: "소모품비" },
  { value: "transport", label: "운반비" },
  { value: "maintenance", label: "수선유지비" },
  { value: "insurance", label: "보험료" },
  { value: "utilities", label: "수도광열비" },
  { value: "communication", label: "통신비" },
  { value: "travel", label: "여비교통비" },
  { value: "education", label: "교육훈련비" },
  { value: "other", label: "기타" },
];

/**
 * 검색조건 — 갖춰서 찾는 값들 (2026-08-13 조회 화면 표준).
 *   ★ 여기 있는 것은 '조회'를 눌러야 반영된다. 기간·빠른검색은 조회 줄에 있어 즉시다.
 */
type TiCond = {
  partner: string[]; item: string; send: "all" | "draft" | "pending" | "failed" | "issued";
  min: string; max: string; size: number;
};
const TI_EMPTY: TiCond = { partner: [], item: "", send: "all", min: "", max: "", size: 50 };
const tiCondCount = (c: TiCond) =>
  c.partner.length + (c.item ? 1 : 0) + (c.send !== "all" ? 1 : 0) + ((c.min || c.max) ? 1 : 0);
const TI_SEND_CHIPS = [
  { value: "all", label: "전체" }, { value: "draft", label: "미발행" },
  { value: "pending", label: "전송 중" }, { value: "failed", label: "오류" },
  { value: "issued", label: "전송 완료" },
] as const;

/** 과세형태 — 회사 과세유형에 따라 고를 수 있는 것만 남는다 (2026-08-13) */
const TAX_KIND_OPTIONS: { value: TaxKind; label: string }[] = [
  { value: "taxable", label: "과세" },
  { value: "zero_rated", label: "영세율" },
  { value: "exempt", label: "면세 (전자계산서)" },
];

// ── 수정세금계산서 준비 상태 ──
//   CODEF 수정발행은 정발행과 상품이 분리돼 있어 별도 신청이 필요하다
//   (regist-revise-invoicer-trustee). 2026-08-03 사장님이 상품 구독 완료 →
//   수정발행 분기가 담긴 hometax-issue(v37)·modify-tax-invoice(v27) 배포 후 해제.
const MODIFY_ISSUE_AVAILABLE = true;

// ── 수정세금계산서 사유 ──
const MODIFICATION_REASONS = [
  { value: "error_correction", label: "기재사항 착오정정", desc: "필요적 기재사항(공급가액, 세액 등)의 착오 정정" },
  { value: "contract_cancel", label: "계약의 해제", desc: "공급 후 계약이 해제된 경우" },
  { value: "return", label: "환입", desc: "공급한 재화가 환입(반품)된 경우" },
  { value: "price_change", label: "공급가액 변동", desc: "계약 조건 변경 등으로 공급가액이 변동된 경우" },
  { value: "inland_lc", label: "내국신용장 사후개설", desc: "내국신용장이 사후에 개설된 경우" },
  { value: "duplicate", label: "착오에 의한 이중발급", desc: "동일 거래에 대해 이중으로 발급된 경우" },
];

//   공급대가(부가세 포함 합계)를 넣으면 공급가액·부가세로 나눠 주는 역산 계산기 (2026-08-31 사장님).
//     '공급가액 × 1.1' 의 반대 — 총액만 알 때 공급가액을 못 구하던 것을 돕는다. 마이너스도 지원.
function GrossSplitCalc({ onApply, applyLabel = "첫 품목 단가로 넣기" }: { onApply: (supply: number) => void; applyLabel?: string }) {
  const [gross, setGross] = useState("");
  const g = Number(gross) || 0;
  const supply = Math.round(g / 1.1);   // 원 단위 반올림 — 부가세는 나머지로 맞춰 합계가 항상 딱 떨어지게
  const vat = g - supply;
  const won = (n: number) => n.toLocaleString("ko-KR");
  return (
    <div className="flex flex-wrap items-center gap-2 mt-2 px-2.5 py-2 rounded-lg bg-[var(--bg)] border border-dashed border-[var(--border)]">
      <span className="text-[11px] font-bold text-[var(--text-muted)] whitespace-nowrap">🧮 공급대가(부가세 포함)로 계산</span>
      <CurrencyInput value={gross} onValueChange={setGross} allowNegative placeholder="예: 110,000" className="tax-item-input text-right !w-32" />
      <span className="text-[11px] text-[var(--text-dim)] whitespace-nowrap">
        → 공급가액 <b className="text-[var(--text)] mono-number">{won(supply)}</b> · 부가세 <b className="text-[var(--text)] mono-number">{won(vat)}</b>
      </span>
      <button type="button" disabled={!g} onClick={() => onApply(supply)}
        className="btn-secondary btn-sm disabled:opacity-40 whitespace-nowrap">{applyLabel}</button>
    </div>
  );
}

export default function TaxInvoicesPage() {
  const { role } = useUser();
  const { allowed: tabAllowed, loading: tabLoading } = useCanAccessTab("/tax-invoices");
  void role;
  // 권한 게이트에서 early return 한 뒤에 나머지 훅들이 이어지면 tabLoading 이 풀리는 순간
  // 렌더당 훅 개수가 달라져 React #310 크래시 — 본문을 별도 컴포넌트로 분리 (2026-08-03).
  if (tabLoading) return null;
  if (!tabAllowed) {
    return <AccessDenied detail="세금계산서 접근 권한이 없습니다. 마스터에게 권한을 요청하세요." />;
  }
  return <TaxInvoicesPageInner />;
}

function TaxInvoicesPageInner() {
  const { toast } = useToast();
  const { confirm: confirmDialog, confirmElement } = useConfirm();
  const queryClient = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const hometaxCd = useSyncCooldown(companyId, "hometax");
  // 홈택스 연동 일시정지 — 통장 정지 버튼과 동일 UX (2026-07-30 사장님)
  const { data: hometaxPausedUntil } = useQuery({
    queryKey: ["hometax-sync-paused", companyId],
    queryFn: () => getHometaxPausedUntil(companyId!),
    enabled: !!companyId,
    refetchInterval: 30000,
  });
  const isHometaxPaused = !!hometaxPausedUntil;
  const hometaxPauseMut = useMutation({
    mutationFn: async () => {
      if (isHometaxPaused) { await clearHometaxPause(companyId!); return false; }
      await setHometaxPause(companyId!, 30); return true;
    },
    onSuccess: (paused) => {
      queryClient.invalidateQueries({ queryKey: ["hometax-sync-paused", companyId] });
      toast(paused ? "홈택스 연동을 30분간 정지했습니다 — 홈택스에 직접 로그인해도 동기화가 겹치지 않습니다" : "홈택스 연동 정지를 해제했습니다", "success");
    },
    onError: (e: any) => toast(friendlyError(e, "정지 처리 실패"), "error"),
  });
  // 2026-05-21 사장님 요청: "matching" 탭 통째 제거. ?tab=matching 딥링크는 분석 허브로 리다이렉트(별건 — 우선 sales 폴백).
  const searchParams = useSearchParams();
  const { isMaster: taxTabMaster, hasPerm: taxTabPerm } = useMyPermissions();
  /*   탭 권한 — 새 탭 이름으로 갈아탈 때 아무도 아무것도 못 보게 되는 걸 막는다 (2026-08-13).
   *   옛 키(sales·purchase·vat·summary·queue·sync)에 걸어 둔 권한은 새 탭과 안 맞아서,
   *   그대로 두면 **탭 줄이 통째로 비어 버린다**(실제로 그렇게 됐다).
   *   규칙: 네 탭 중 **하나도 따로 정해 두지 않았으면 전부 보인다.**
   *   화면 진입 자체는 위쪽 `useCanAccessTab("/tax-invoices")` 가 이미 막고 있으므로,
   *   탭 권한은 '더 좁히는' 용도다 — 안 정했으면 좁힐 이유가 없다.
   */
  const taxTabKeys = ["wait", "done", "issue-status"] as const;
  const anyTaxTabGranted = taxTabKeys.some((k) => taxTabPerm(`/tax-invoices:${k}`));
  const taxTabAllowed = (k: string) =>
    taxTabMaster || !anyTaxTabGranted || taxTabPerm(`/tax-invoices:${k}`);
  /*  ── 세금·증빙 = 오너뷰가 **발행하는** 곳 (2026-08-13 사장님 지시로 재편) ──────────────
   *
   *    "수집전표는 받아오는 통합메뉴로 쓰고, 세금증빙은 오너뷰에서 발행하는 것들에 대한
   *     통합관리 메뉴로. 발행된 목록 확인 · 홈택스 전송 진행상황 · 수정세금계산서."
   *
   *    ★ 가르는 기준은 새로 만들지 않았다 — `tax_invoices.source` 가 이미 들고 있다.
   *        codef_hometax = 받아온 것(2,535건) → 수집·전표
   *        manual        = 오너뷰가 만든 것(14건) → 여기
   *      받아온 것도 **발행 현황의 「타발행」 줄에는 나온다** (합계가 맞아야 매출 대조가 된다).
   *
   *    탭이 왜 넷인가 — 성격이 다른 것만 가른다(조회 화면 표준):
   *      issue-status  발행 현황  · 이카운트 「매출(세금)계산서요약」 형태. 수집·전표의 '수집 현황'과 대칭
   *      wait          발행 대기  · 국세청에 **아직 안 간 것**(미발행·전송중·에러). 파란 버튼은 여기 하나
   *      done          발행 내역  · 승인 끝난 것. 손댈 게 없는 확정 장부 + 수정세금계산서
   *      partner-info  거래처 발행정보 · 이메일·업태·종목이 빠져 전송이 죽는 걸 미리 막는다
   *
   *    버린 안 ① 종류별 3탭(세금계산서/전자계산서/현금영수증) — 셋 다 목록이 똑같이 생겼고,
   *      궁금한 건 종류가 아니라 "보냈나 안 보냈나"다. 종류는 검색조건 칩으로 충분하다.
   *    버린 안 ② 상태별 4탭 — 상태는 움직이는 값이라 같은 건이 탭을 옮겨 다닌다("아까 여기 있었는데").
   *
   *    `vat`·`summary` 는 **분석으로 옮겼다**(/reports/vat) — 매입 자료가 있어야 계산되는
   *    신고용이지 발행용이 아니다. 옛 딥링크(?tab=vat)는 그리로 넘긴다.
   *    `sales`·`purchase`·`queue` 는 탭 줄에서 내렸다 — 목록은 수집·전표, 자동발행은 '출처' 칸으로 녹였다.
   */
  //   순서: 발행 대기(할 일) → 발행 내역 → 발행 현황 (2026-08-13 사장님 — 할 일이 맨앞).
  //   '거래처 발행정보' 탭은 뺐다 — 빠진 정보는 전송 전 확인 창이 그 자리에서 채우게 한다.
  type TaxTab = "wait" | "done" | "issue-status";
  const TAX_TABS: { key: TaxTab; label: string }[] = [
    { key: "wait", label: "발행 대기" },
    { key: "done", label: "발행 내역" },
    { key: "issue-status", label: "발행 현황" },
  ];
  const isTaxTab = (t: unknown): t is TaxTab => TAX_TABS.some((x) => x.key === t);
  const router = useRouter();
  const [tab, setTab] = useState<TaxTab>(() => {
    const t = searchParams?.get("tab");
    return isTaxTab(t) ? t : "wait";
  });
  //   옛 딥링크 정리 — 부가세·기간별 집계는 분석으로 갔다. 대시보드의 '부가세 납부' 링크가
  //   여기로 오면 빈 화면이 되므로 그리로 넘긴다(주소를 고치는 것보다 이쪽이 안전하다).
  useEffect(() => {
    const t = searchParams?.get("tab");
    if (t === "vat" || t === "summary") { router.replace(`/reports/vat?tab=${t}`); return; }
    if (isTaxTab(t)) setTab(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);
  // (P3) 미허용 탭 진입 시 첫 허용 탭으로
  useEffect(() => {
    if (!taxTabAllowed(tab)) {
      const first = TAX_TABS.map((t) => t.key).find((k) => taxTabAllowed(k));
      if (first) setTab(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, taxTabMaster]);
  /*   조회기간 — 월 단위. 기본은 **지난달 ~ 이번 달** (조회 화면 표준).
   *   ★ 예전엔 localStorage 에 기억해 뒀는데, 표준이 **조회값 자동 기억을 금지**한다 —
   *     나갔다 오면 기본값이어야 한다. 실제로 기억된 값이 `2026-03 ~ 2027-02`(미래까지)로
   *     남아 있어서 "왜 이 기간이지"가 됐다. 편의는 **내 조건**(★ 기본, DB)이 맡는다.
   */
  const [viewFromMonth, setViewFromMonth] = useState(() => defaultRangeMonth().from);
  const [viewToMonth, setViewToMonth] = useState(() => defaultRangeMonth().to);
  //   예전에 남겨 둔 기억값 청소 — 다음 배포에서는 이 두 줄도 지운다
  useEffect(() => {
    if (typeof window === "undefined") return;
    localStorage.removeItem("tax-invoices-viewFromMonth");
    localStorage.removeItem("tax-invoices-viewToMonth");
  }, []);
  const [periodType, setPeriodType] = useState<PeriodType>("monthly");
  const [showForm, setShowForm] = useState(false);
  const [selectedInvoice, setSelectedInvoice] = useState<any>(null);
  const [showModifyModal, setShowModifyModal] = useState(false);
  const [modifyTarget, setModifyTarget] = useState<any>(null);
  const [modifyReason, setModifyReason] = useState("");
  const [modifyAmount, setModifyAmount] = useState("");
  // 동기화 기간 = 상단 조회기간(viewFromMonth~viewToMonth) 공용 — 별도 월 피커 이원화 제거 (기준 통일)
  // 불러오기는 현금영수증 화면과 동일하게 백그라운드 job 하나로 통일 (2026-07-31 사장님 "방식 통일").
  // 백그라운드 진행 중인 job ID (Realtime 구독용) — localStorage 와 동기화하여 페이지 무관 chain.
  const [activeJobId, setActiveJobIdRaw] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    return localStorage.getItem("hometax-active-job-id");
  });
  const setActiveJobId = (id: string | null) => {
    setActiveJobIdRaw(id);
    if (typeof window !== "undefined") {
      if (id) localStorage.setItem("hometax-active-job-id", id);
      else localStorage.removeItem("hometax-active-job-id");
    }
  };
  // 직원 QA #6 — 백그라운드 job 이 hang(CF-12200 등) 하면 completed/failed 로 안 바뀌어 버튼이 영구 잠김.
  //   멈춘 job 을 failed 로 마킹(서버 409 잠금까지 해제) + 로컬 해제 → 다시 시도 가능. (CODEF 수집 로직 미접촉)
  const forceClearStuckJob = async (jid: string, silent = false) => {
    const db = supabase;
    try {
      await db.from("hometax_sync_jobs").update({ status: "failed", updated_at: new Date().toISOString() }).eq("id", jid).in("status", ["pending", "running"]);
    } catch { /* best-effort */ }
    setActiveJobId(null);
    if (!silent) toast("멈춘 백그라운드 동기화를 해제했습니다. 다시 시도할 수 있습니다.", "info");
  };
  // Background sync 시작 — 즉시 응답 받고 사용자는 페이지 떠나도 됨.
  async function runHometaxSyncBackground(fromMonth: string, toMonth: string) {
    if (!companyId) { toast('회사 정보를 불러올 수 없습니다', 'error'); return; }
    if (!isHometaxConnected) { toast('먼저 설정 > 은행연동에서 홈택스를 연결하세요', 'error'); return; }
    if (fromMonth > toMonth) { toast('시작 월이 종료 월보다 늦을 수 없습니다', 'error'); return; }
    const [fy, fm] = fromMonth.split('-').map(Number);
    const [ty, tm] = toMonth.split('-').map(Number);
    const lastDay = new Date(ty, tm, 0).getDate();
    const startDate = `${fromMonth}-01`;
    const endDate = `${toMonth}-${String(lastDay).padStart(2, '0')}`;
    // 홈택스 연동 일시정지 중이면 시작하지 않음 — 현금영수증 화면과 동일한 가드(2026-07-31 통일)
    if (isHometaxPaused) {
      const t = new Date(hometaxPausedUntil!).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" });
      toast(`홈택스 연동 일시정지 중 (${t}까지) — 정지를 해제한 뒤 다시 시도하세요.`, 'info');
      return;
    }
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error('로그인 필요');
      const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const res = await fetch(`${supabaseUrl}/functions/v1/codef-sync`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${session.access_token}` },
        body: JSON.stringify({ companyId, action: 'hometax-sync-async', startDate, endDate }),
      });
      const result = await res.json();
      if (res.status === 409 && result.activeJobId) {
        setActiveJobId(result.activeJobId);
        toast(`이미 진행 중인 백그라운드 동기화가 있습니다 (${result.progress?.label || '진행 중'}). 완료 후 재시도.`, 'info');
        return;
      }
      if (!res.ok || !result.jobId) throw new Error(result.error || '백그라운드 시작 실패');
      setActiveJobId(result.jobId);
      toast(`백그라운드 동기화 시작됨 (${fromMonth} ~ ${toMonth}). 페이지 떠나도 됩니다.`, 'success');
      // 동기화 범위로 보기 자동 세팅
      setViewFromMonth(fromMonth);
      setViewToMonth(toMonth);
      void fy; void fm;
    } catch (err: any) {
      toast(`백그라운드 동기화 시작 실패: ${err.message}`, 'error');
    }
  }

  // matchFilter state 는 3-way 매칭 페이지(/reports/three-way-match)로 이전됨 (2026-05-21).
  const [matchDealPopup, setMatchDealPopup] = useState<any>(null);
  //   프로젝트(딜) 제안 팝업 — 발행 완료 건에 어느 프로젝트 매출인지 붙인다 (2026-08-13 사장님)
  const [dealSuggest, setDealSuggest] = useState<any>(null);
  // 거래매칭 — 목록에서 통장 입출금 거래를 바로 연결 (인라인 팝업)
  const [linkInvoice, setLinkInvoice] = useState<any>(null);
  const [lastSyncTime, setLastSyncTime] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [expandedDupKey, setExpandedDupKey] = useState<string | null>(null);
  //   점검 리포트는 접힌 채로 시작한다 — 목록이 첫 화면에 올라오게 (2026-08-10)
  const [checkOpen, setCheckOpen] = useState(false);
  const [dismissedDups, setDismissedDups] = useState<Set<string>>(new Set());
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchIssuing, setBatchIssuing] = useState(false);
  //   전송 전 확인 창 — 여기 담긴 건들이 확인을 거쳐 국세청으로 나간다 (2026-08-13, 4단계)
  const [issueConfirm, setIssueConfirm] = useState<any[] | null>(null);
  // 일괄 전표처리 (post_invoice_voucher) — 매출/매입 방향은 RPC 가 자동 분기.
  const [showBulkVoucher, setShowBulkVoucher] = useState(false);
  const [bulkVoucherAccountId, setBulkVoucherAccountId] = useState("");
  const [bulkVoucherPosting, setBulkVoucherPosting] = useState(false);

  // ── 멀티 등록(다행) 폼 — 한 줄(row)이 세금계산서 1건. [+ 항목 추가]로 행 누적, [등록]에서 일괄 전송 ──
  type FormRow = {
    key: string;
    type: "sales" | "purchase";
    counterpartyName: string;
    counterpartyBizno: string;
    counterpartyBusinessType: string;
    counterpartyBusinessItem: string;
    partnerId: string;
    supplyAmount: string;
    issueDate: string;
    preferredDate: string;
    expenseCategory: string;
    dealId: string;
    purpose: "영수" | "청구";
    taxKind: "taxable" | "zero_rated" | "exempt"; // 과세/영세율/면세 — 영세율·면세는 세액 0
    itemName: string;
    itemSpec: string;
    itemQty: string;
    itemUnitPrice: string;
    // 거래처 정보 — 계산서에 찍히고 국세청으로 나간다 (2026-08-10)
    counterpartyRepresentative: string;
    counterpartyAddress: string;
    counterpartyEmail: string;
    // 품목 줄 — 계산서 한 장에 여러 줄
    items: ItemLine[];
  };
  // 품목 줄 — 화면에서는 문자열로 다루고 저장할 때 숫자로 바꾼다 (입력 중 0 이 튀지 않게)
  type ItemLine = { key: string; name: string; spec: string; qty: string; unitCost: string };
  const itemKeyRef = useRef(0);
  const blankItem = (): ItemLine => ({ key: `i${itemKeyRef.current++}`, name: "", spec: "", qty: "1", unitCost: "" });
  //   한 줄 공급가액 = 수량 × 단가. 수량이 비면 1 로 본다.
  const itemSupply = (it: ItemLine) => Math.round((Number(it.qty) || 1) * (Number(it.unitCost) || 0));

  const rowKeyRef = useRef(0);
  const blankRow = (): FormRow => ({
    key: `r${rowKeyRef.current++}`,
    type: "sales",
    counterpartyName: "",
    counterpartyBizno: "",
    counterpartyBusinessType: "",
    counterpartyBusinessItem: "",
    partnerId: "",
    supplyAmount: "",
    issueDate: "",
    preferredDate: "",
    expenseCategory: "",
    dealId: "",
    purpose: "청구",
    taxKind: "taxable",
    itemName: "",
    itemSpec: "",
    itemQty: "1",
    itemUnitPrice: "",
    counterpartyRepresentative: "",
    counterpartyAddress: "",
    counterpartyEmail: "",
    items: [blankItem()],
  });
  const [rows, setRows] = useState<FormRow[]>(() => [blankRow()]);
  const [dropdownRowKey, setDropdownRowKey] = useState<string | null>(null);
  const [calcRowKey, setCalcRowKey] = useState<string | null>(null);   //   여러 장 — 🧮 계산기가 펼쳐진 줄 (2026-08-31)
  //   한 장 쓰기(품목 여러 줄) / 여러 장 한꺼번에(한 줄 = 한 장) — 2026-08-10
  const [formMode, setFormMode] = useState<"single" | "multi">("single");
  const [savePartnerInfo, setSavePartnerInfo] = useState(true);
  const patchRow = (key: string, patch: Partial<FormRow>) =>
    setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const removeRow = (key: string) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((r) => r.key !== key) : [blankRow()]));

  //   계산서 공급가액 = 품목 줄 합계. 규칙이 하나뿐이라 '계산' 버튼이 필요 없어졌다.
  const rowSupply = (r: FormRow) => r.items.reduce((s, it) => s + itemSupply(it), 0);
  //   공급가액이 0만 아니면 된다 — 수정세금계산서·환입 등 **마이너스 계산서**를 발행할 수 있어야 한다 (2026-08-31 사장님).
  const isRowValid = (r: FormRow) =>
    !!r.counterpartyName.trim() && !!r.issueDate && rowSupply(r) !== 0;

  const patchItem = (rowKey: string, itemKey: string, patch: Partial<ItemLine>) =>
    setRows((rs) => rs.map((r) => (r.key === rowKey
      ? { ...r, items: r.items.map((it) => (it.key === itemKey ? { ...it, ...patch } : it)) }
      : r)));
  const addItem = (rowKey: string) =>
    setRows((rs) => rs.map((r) => (r.key === rowKey ? { ...r, items: [...r.items, blankItem()] } : r)));
  const removeItem = (rowKey: string, itemKey: string) =>
    setRows((rs) => rs.map((r) => (r.key === rowKey
      ? { ...r, items: r.items.length > 1 ? r.items.filter((it) => it.key !== itemKey) : [blankItem()] }
      : r)));

  //   마지막 줄 끝에서 Tab = 새 줄. 여러 줄을 연달아 칠 때 마우스로 손이 안 가게 (2026-08-10)
  const onItemKeyDown = (e: React.KeyboardEvent, rowKey: string, itemKey: string) => {
    if (e.key !== "Tab" || e.shiftKey) return;
    const row = rows.find((r) => r.key === rowKey);
    if (!row || row.items[row.items.length - 1]?.key !== itemKey) return;
    const it = row.items[row.items.length - 1];
    if (!it.name.trim()) return;             // 빈 줄에서 Tab 은 그냥 넘어간다
    addItem(rowKey);
  };
  //   엑셀에서 여러 줄 붙여넣기 — 탭으로 나뉜 칸을 품목명·규격·수량·단가로 채운다
  const onItemPaste = (e: React.ClipboardEvent, rowKey: string, itemKey: string) => {
    const text = e.clipboardData.getData("text/plain");
    if (!/[\n\t]/.test(text)) return;                          // 한 칸 붙여넣기는 기본 동작 그대로
    e.preventDefault();
    const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const parsed: ItemLine[] = lines.map((l) => {
      const [name = "", spec = "", qty = "", unit = ""] = l.split("\t");
      return {
        key: `i${itemKeyRef.current++}`,
        name: name.trim(),
        spec: spec.trim(),
        qty: qty.replace(/[^\d.]/g, "") || "1",
        unitCost: (unit.trim().startsWith("-") ? "-" : "") + unit.replace(/[^\d.]/g, ""),
      };
    });
    if (parsed.length === 0) return;
    setRows((rs) => rs.map((r) => {
      if (r.key !== rowKey) return r;
      const at = r.items.findIndex((it) => it.key === itemKey);
      const next = [...r.items];
      next.splice(at, 1, ...parsed);          // 붙여넣기 시작 줄을 첫 줄로 대체
      return { ...r, items: next };
    }));
  };

  //   거래처를 고르면 계산서에 찍힐 값들을 한꺼번에 채운다
  const applyPartner = (rowKey: string, p: any) => patchRow(rowKey, {
    counterpartyName: p.name,
    counterpartyBizno: p.business_number || "",
    counterpartyBusinessType: p.business_type || "",
    counterpartyBusinessItem: p.business_item || "",
    counterpartyRepresentative: p.representative || "",
    counterpartyAddress: p.address || "",
    counterpartyEmail: p.contact_email || "",
    partnerId: p.id,
  });

  //   발행에 필요한데 비어 있는 것 — 입력 단계에서 알려 준다(발행 때 빈칸으로 나가는 걸 막는다)
  const missingBuyerFields = (r: FormRow) => {
    const out: string[] = [];
    if (!r.counterpartyBizno.trim()) out.push("등록번호");
    if (!r.counterpartyRepresentative.trim()) out.push("대표자");
    if (!r.counterpartyBusinessType.trim() && !r.counterpartyBusinessItem.trim()) out.push("업태/종목");
    if (!r.counterpartyEmail.trim()) out.push("받을 이메일");
    return out;
  };

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setCompanyId(u.company_id);
        setUserId(u.id);
      }
    });
    ensurePrintStyles();
  }, []);

  // 중복 '중복아님' 처리 — 회사 단위 DB(tax_dup_dismissals) 저장 (2026-08-31).
  //   종전 localStorage 는 기기별이라 경리가 확인한 건이 대표 화면엔 계속 경고로 떴다.
  //   기존 기기에 남은 localStorage 값은 1회 DB 로 승격 후 지운다.
  useEffect(() => {
    if (!companyId || typeof window === "undefined") return;
    (async () => {
      try {
        const lsKey = `tax-dup-dismissed-${companyId}`;
        const raw = localStorage.getItem(lsKey);
        if (raw) {
          const keys = (JSON.parse(raw) as string[]).filter(Boolean);
          if (keys.length) {
            await (supabase as any).from("tax_dup_dismissals").upsert(
              keys.map((k) => ({ company_id: companyId, dup_key: k, dismissed_by: userId ?? null })),
              { onConflict: "company_id,dup_key" });
          }
          localStorage.removeItem(lsKey);
        }
        const { data } = await (supabase as any).from("tax_dup_dismissals")
          .select("dup_key").eq("company_id", companyId);
        setDismissedDups(new Set(((data || []) as { dup_key: string }[]).map((r) => r.dup_key)));
      } catch { /* 조회 실패 시 경고 전체 노출(안전한 쪽) */ }
    })();
  }, [companyId]);

  // 보기 기간 계산 — viewFromMonth ~ viewToMonth 전체. 단일 월 보고 싶으면 from=to 로 설정.
  const { startDate, endDate } = useMemo(() => {
    const [ty, tm] = viewToMonth.split('-').map(Number);
    const lastDay = new Date(ty, tm, 0).getDate();
    return { startDate: `${viewFromMonth}-01`, endDate: `${viewToMonth}-${String(lastDay).padStart(2, '0')}` };
  }, [viewFromMonth, viewToMonth]);

  // 탭/보기기간 변경 시 선택 초기화
  useEffect(() => { setSelectedIds(new Set()); }, [tab, startDate, endDate]);

  // Fetch all invoices in view range
  const { data: invoices = [], isLoading, error: mainError, refetch: mainRefetch } = useQuery({
    queryKey: ["tax-invoices-full", companyId, startDate, endDate],
    queryFn: async () => {
      // 조회기간을 넓게 잡으면 1000행(서버 max_rows) 초과 — 절단 방지 페이징 (prod 계산서 1351건)
      return fetchPaged("taxInvoices.list", () => supabase
        .from("tax_invoices")
        .select("*, deals(name), label, revenue_schedule_id, partners(business_type, business_item, representative, contact_email, address)")
        .eq("company_id", companyId!)
        // 전자계산서(면세, doc_kind='exempt')는 전용 탭(/e-invoices)에서 — 이 화면은 세금계산서만 (2026-08-10)
        .eq("doc_kind", "tax")
        .gte("issue_date", startDate)
        .lte("issue_date", endDate)
        .order("issue_date", { ascending: false })
        .order("id", { ascending: false }), 10000);
    },
    enabled: !!companyId,
  });

  // Partners for counterparty selection
  const { data: partners = [] } = useQuery({
    queryKey: ["partners-for-invoice", companyId],
    queryFn: async () => {
      const data = logRead('tax-invoices/page:data', await supabase
        .from("partners")
        .select("id, name, business_number, contact_email, business_type, business_item, representative, address")
        .eq("company_id", companyId!)
        .eq("is_active", true)
        .order("name"));
      return data || [];
    },
    enabled: !!companyId,
  });

  // 전표처리용 계정과목 (일괄 전표 모달)
  const { data: coaAccounts = [] } = useQuery({
    queryKey: ["tax-invoice-coa-accounts", companyId],
    queryFn: async () => {
      const data = logRead('tax-invoices/page:data', await (supabase).from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId!).order("code"));
      return (data || []) as any[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });

  // 직원 QA 손익계산서 — 매입 세금계산서에 손익 계정과목(expense_category) 일괄 지정.
  //   지정하면 손익계산서에서 매출원가(COGS) 대신 그 판관비 항목으로 집계됨.
  const [bulkExpenseCat, setBulkExpenseCat] = useState("");
  const applyBulkExpenseCat = async () => {
    if (!bulkExpenseCat || selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    const { error } = await (supabase).from("tax_invoices").update({ expense_category: bulkExpenseCat }).in("id", ids);
    if (error) { toast("계정과목 지정 실패: " + error.message, "error"); return; }
    toast(`매입 세금계산서 ${ids.length}건에 '${bulkExpenseCat}' 지정 — 손익계산서에서 매출원가 대신 판관비로 반영됩니다`, "success");
    setBulkExpenseCat(""); setSelectedIds(new Set());
    invalidateTaxInvoiceReaders(queryClient);   //   원장·미수·요약 등 파생 화면 일괄 (2026-08-31)
  };

  // Deals for linking
  const { data: dealsForLink = [] } = useQuery({
    queryKey: ["deals-for-invoice", companyId],
    queryFn: async () => {
      const data = logRead('tax-invoices/page:data', await supabase
        .from("deals")
        .select("id, name, contract_total, partner_id")
        .eq("company_id", companyId!)
        .neq("status", "archived")
        .order("name"));
      return data || [];
    },
    enabled: !!companyId,
  });

  const filterPartners = (search: string) =>
    partners.filter((p: any) =>
      !search || p.name.toLowerCase().includes(search.toLowerCase()) ||
      (p.business_number || "").includes(search)
    );

  // 3-way 매칭 fetch + matchFilter UI 는 새 페이지(/reports/three-way-match)로 이전됨 (2026-05-21).
  //   matching 탭은 안내 메시지로 유지 (?tab=matching 옛 딥링크 호환).

  //   부가세 미리보기 · 기간별 집계 · 카드공제 세 조회는 **분석(/reports/vat)** 으로 갔다 (2026-08-13).
  //   여기 남겨 두면 발행 화면을 열 때마다 안 쓰는 세 번의 조회가 돈다.
  const currentYear = Number(viewToMonth.split("-")[0]);

  /*   기간 밖의 미발행 — **할 일을 기간으로 숨기면 안 된다** (2026-08-13).
   *   조회기간 기본값이 최근 1개월이 되면서, 몇 달 전에 만들어 둔 미발행 초안이 화면에서
   *   사라진다. 발행 대기는 '아직 안 보낸 것' 목록이라 그게 제일 위험하다.
   *   그래서 기간을 넓히라고 **알려만 준다** — 조건을 몰래 바꾸지는 않는다.
   */
  const { data: waitOutside = 0 } = useQuery({
    queryKey: ["ti-wait-outside", companyId, viewFromMonth, viewToMonth],
    queryFn: async () => {
      const from = `${viewFromMonth}-01`;
      const [ty, tm] = viewToMonth.split("-").map(Number);
      const to = `${tm === 12 ? ty + 1 : ty}-${String(tm === 12 ? 1 : tm + 1).padStart(2, "0")}-01`;
      const { count } = await (supabase as any).from("tax_invoices")
        .select("id", { count: "exact", head: true })
        .eq("company_id", companyId!).eq("source", "manual").eq("type", "sales")
        .neq("status", "void").is("nts_confirm_no", null)
        .neq("nts_issue_status", "issued")
        .or(`issue_date.lt.${from},issue_date.gte.${to}`);
      return count || 0;
    },
    enabled: !!companyId && (tab === "wait" || tab === "issue-status"),
  });

  // Company info for PDF/display
  const { data: companyInfo } = useQuery({
    queryKey: ["company-info", companyId],
    queryFn: async () => {
      // 공급자 이메일 — companies 에 email 컬럼이 없어 상세 화면에서 항상 '-' 로 나오던 문제(2026-08-05 사장님 제보).
      //   실제 계산서에 찍히는 발행자 이메일과 같은 출처를 쓴다: automation_settings.invoicer_email → 없으면 대표 계정 이메일
      //   (hometax-issue 엣지 함수의 발행자 이메일 결정 순서와 동일).
      //   tax_settings 도 같이 — 과세유형(vat_type)이 여기 있고, 무엇을 발행할 수 있는지를 그 값이 정한다 (2026-08-13)
      const data = logRead('tax-invoices/page:data', await (supabase).from('companies').select('name, business_number, representative, address, business_type, business_category, automation_settings, tax_settings').eq('id', companyId!).maybeSingle());
      if (!data) return data;
      let email = (data as any)?.automation_settings?.invoicer_email || '';
      if (!email) {
        const owner = logRead('tax-invoices/page:owner-email', await (supabase)
          .from('users').select('email').eq('company_id', companyId!).eq('role', 'owner')
          .order('created_at').limit(1).maybeSingle());
        email = (owner as any)?.email || '';
      }
      return { ...(data as any), email };
    },
    enabled: !!companyId,
  });

  //   회사 과세유형 — 고를 수 있는 과세형태를 이 값이 정한다 (2026-08-13 사장님 지시).
  //   ★ 과세사업자는 계산서(면세)를 낼 수 없다. 예전엔 칸이 늘 셋이라 광고대행 회사에서도
  //     '면세'를 골라 전자계산서를 만들 수 있었다 — 발행하면 안 되는 문서다.
  const vatBiz = vatBusinessTypeOf((companyInfo as any)?.tax_settings);
  const taxKindOptions = TAX_KIND_OPTIONS.filter((o) => canIssueTaxKind(vatBiz, o.value));
  //   빈 줄의 기본값 'taxable' 은 **면세사업자에게는 못 쓰는 값**이다. 회사 정보가 도착하면
  //   못 쓰는 값을 들고 있는 줄을 고를 수 있는 첫 값으로 옮긴다(면세사업자면 '면세').
  useEffect(() => {
    if (!companyInfo) return;
    const fallback = taxKindOptions[0]?.value;
    if (!fallback) return;
    setRows((rs) => (rs.some((r) => !canIssueTaxKind(vatBiz, r.taxKind))
      ? rs.map((r) => (canIssueTaxKind(vatBiz, r.taxKind) ? r : { ...r, taxKind: fallback }))
      : rs));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [companyInfo, vatBiz]);

  // 요금제별 세금계산서 국세청 발행 월간 한도 (프로=10건, 울트라=무제한)
  const { data: issuanceStatus } = useQuery({
    queryKey: ["tax-invoice-issuance-status", companyId],
    queryFn: () => getTaxInvoiceIssuanceStatus(companyId!),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  // Invoice queue (자동발행 대기)
  const { data: queueItems = [], isLoading: queueLoading } = useQuery({
    queryKey: ["invoice-queue", companyId],
    queryFn: () => getInvoiceQueue(companyId!),
    enabled: false,   // 자동발행 큐는 발행 대기의 '출처' 칸으로 녹였다 (2026-08-13)
  });

  // Sync logs
  const { data: syncLogs = [] } = useQuery({
    queryKey: ["hometax-sync-logs", companyId],
    queryFn: () => getHomeTaxSyncLogs(companyId!),
    enabled: false,   // 동기화 로그 탭 없음 — 수집·전표가 담당 (2026-08-13)
  });

  // Last sync time (항상 조회)
  const { data: lastSyncData } = useQuery({
    queryKey: ["last-sync-time", companyId],
    queryFn: async () => {
      const db = supabase;
      //   hometax_sync_log 는 쓰기 코드가 사라진 죽은 테이블 — '마지막 업데이트'가 영원히 안 떴다.
      //   실제 수집 이력이 쌓이는 hometax_sync_jobs 로 교체 (2026-08-31 스윕).
      const data = logRead('tax-invoices/page:data', await db
        .from('hometax_sync_jobs')
        .select('completed_at')
        .eq('company_id', companyId!)
        .eq('status', 'completed')
        .not('completed_at', 'is', null)
        .order('completed_at', { ascending: false })
        .limit(1));
      return data?.[0]?.completed_at || null;
    },
    enabled: !!companyId,
  });

  // Incremental sync 기준 시각 — company_settings.last_hometax_sync_at
  const { data: lastHometaxSyncAt } = useQuery({
    queryKey: ["last-hometax-sync-at", companyId],
    queryFn: async () => {
      const db = supabase;
      const data = logRead('tax-invoices/page:data', await db
        .from('company_settings')
        .select('last_hometax_sync_at')
        .eq('company_id', companyId!)
        .maybeSingle());
      // react-query 는 undefined 반환을 에러로 취급 — 행/컬럼 없으면 null 로 정규화 (2026-07-16 QA)
      return (data?.last_hometax_sync_at ?? null) as string | null;
    },
    enabled: !!companyId,
  });

  // 페이지 mount 시 — 진행 중인 background job 감지 (사용자가 페이지 떠났다 다시 와도 진행 표시).
  useEffect(() => {
    if (!companyId || activeJobId) return;
    (async () => {
      const db = supabase;
      const data = logRead('tax-invoices/page:data', await db
        .from('hometax_sync_jobs')
        .select('id, status, updated_at')
        .eq('company_id', companyId)
        .in('status', ['pending', 'running'])
        .gt('updated_at', new Date(Date.now() - 30 * 60 * 1000).toISOString())
        .order('created_at', { ascending: false })
        .limit(1));
      if (data && data[0]) setActiveJobId(data[0].id);
    })();
  }, [companyId, activeJobId]);

  // Background sync job — Realtime 구독해서 진행 상황 표시.
  const { data: activeJob } = useQuery({
    queryKey: ["hometax-sync-job", activeJobId],
    queryFn: async () => {
      if (!activeJobId) return null;
      const db = supabase;
      const data = logRead('tax-invoices/page:data', await db
        .from('hometax_sync_jobs')
        .select('*')
        .eq('id', activeJobId)
        .maybeSingle());
      return data;
    },
    enabled: !!activeJobId,
    refetchInterval: activeJobId ? 2000 : false,  // 2초 polling (Realtime 보조)
  });

  useEffect(() => {
    if (!activeJobId || !companyId) return;
    const db = supabase;
    const ch = db.channel(`hometax_sync_jobs:${activeJobId}`)
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'hometax_sync_jobs', filter: `id=eq.${activeJobId}` }, (payload: any) => {
        queryClient.setQueryData(["hometax-sync-job", activeJobId], payload.new);
        if (payload.new.status === 'completed' || payload.new.status === 'failed') {
          // 완료 시 invalidate
          invalidateTaxInvoiceReaders(queryClient);   //   원장·미수·요약 등 파생 화면 일괄 (2026-08-31)
          queryClient.invalidateQueries({ queryKey: ["last-hometax-sync-at"] });
          if (payload.new.status === 'completed') {
            toast(`백그라운드 동기화 완료: ${payload.new.total_synced}건`, 'success');
          } else {
            toast(`백그라운드 동기화 실패`, 'error');
          }
          setActiveJobId(null);
        }
      })
      .subscribe();
    return () => { db.removeChannel(ch); };
  }, [activeJobId, companyId, queryClient]);

  // 멈춘 job 자동 감지 — 이미 끝났거나 30분+ 진척 없으면(=hang) 자동 해제해 버튼 잠금 풀기
  useEffect(() => {
    if (!activeJobId || !activeJob) return;
    if (activeJob.status === "completed" || activeJob.status === "failed") { setActiveJobId(null); return; }
    const upd = activeJob.updated_at ? new Date(activeJob.updated_at).getTime() : 0;
    if (upd && Date.now() - upd > 30 * 60 * 1000) { void forceClearStuckJob(activeJobId); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeJob, activeJobId]);

  // (page chain 제거 — layout 의 HometaxBackgroundChain 만 단독으로 chain 추진. 이중 호출 시 CF-00016 발생.)

  // 홈택스 연결 상태 — automation_credentials.hometax 존재 여부 (codef-sync edge function이 실제로 사용하는 자격증명)
  const { data: hometaxConnection } = useQuery({
    queryKey: ["hometax-connection", companyId],
    queryFn: async () => {
      const db = supabase;
      const data = logRead('tax-invoices/page:data', await db
        .from('automation_credentials')
        .select('id, updated_at, credentials')
        .eq('company_id', companyId!)
        .eq('service', 'hometax')
        .maybeSingle());
      return data ? {
        connected: true,
        method: (data.credentials as any)?.login_method as 'certificate' | 'id_pw' | undefined,
        connectedAt: data.updated_at as string | undefined,
      } : { connected: false };
    },
    enabled: !!companyId,
  });
  const isHometaxConnected = !!hometaxConnection?.connected;

  // Excel import handler
  const [showBulkIssue, setShowBulkIssue] = useState(false);

  const invalidate = () => {
    invalidateTaxInvoiceReaders(queryClient);   //   원장·미수·요약 등 파생 화면 일괄 (2026-08-31)
  };

  const createMut = useMutation({
    // 유효한 모든 행을 일괄 등록
    mutationFn: async () => {
      //   '한 장 쓰기' 는 첫 행만, '여러 장' 은 유효한 행 전부
      const valid = (formMode === "single" ? rows.slice(0, 1) : rows).filter(isRowValid);
      for (const r of valid) {
        //   품목 줄 — 이름이 있는 줄만 저장한다. 계산서 공급가액은 줄 합계다.
        const items = r.items
          .filter((it) => it.name.trim())
          .map((it) => ({
            name: it.name.trim(),
            spec: it.spec.trim(),
            qty: Number(it.qty) || 1,
            unitCost: Math.round(Number(it.unitCost) || 0),
            supplyAmount: itemSupply(it),
          }));
        await createTaxInvoice({
          companyId: companyId!,
          type: r.type,
          counterpartyName: r.counterpartyName,
          counterpartyBizno: r.counterpartyBizno || undefined,
          counterpartyBusinessType: r.counterpartyBusinessType || undefined,
          counterpartyBusinessItem: r.counterpartyBusinessItem || undefined,
          counterpartyRepresentative: r.counterpartyRepresentative || undefined,
          counterpartyAddress: r.counterpartyAddress || undefined,
          counterpartyEmail: r.counterpartyEmail || undefined,
          supplyAmount: rowSupply(r),
          issueDate: r.issueDate,
          preferredDate: r.preferredDate || undefined,
          expenseCategory: r.expenseCategory || undefined,
          dealId: r.dealId || undefined,
          partnerId: r.partnerId || undefined,
          taxKind: r.taxKind,
          items,
          // 품목은 item_name 으로 — label 에 섞으면 홈택스 품목이 "용역"으로 발행된다(2026-08-05 교정).
          //   여러 줄이면 첫 줄 이름을 넣어 목록·옛 폴백과 호환을 유지한다.
          //   label 에는 영수/청구 토큰만 남긴다(발행 엣지가 purposeType 판정에 사용).
          itemName: items[0]?.name || undefined,
          label: r.purpose || undefined,
        });

        //   거래처 정보에도 저장 — 다음 발행부터 자동으로 채워진다 (2026-08-10 사장님)
        if (savePartnerInfo && r.partnerId) {
          const patch: Record<string, string> = {};
          if (r.counterpartyRepresentative.trim()) patch.representative = r.counterpartyRepresentative.trim();
          if (r.counterpartyAddress.trim()) patch.address = r.counterpartyAddress.trim();
          if (r.counterpartyEmail.trim()) patch.contact_email = r.counterpartyEmail.trim();
          if (r.counterpartyBusinessType.trim()) patch.business_type = r.counterpartyBusinessType.trim();
          if (r.counterpartyBusinessItem.trim()) patch.business_item = r.counterpartyBusinessItem.trim();
          if (Object.keys(patch).length > 0) {
            //   거래처 갱신이 실패해도 계산서 등록은 살린다(권한 없는 멤버 등)
            await supabase.from("partners").update(patch as never).eq("id", r.partnerId);
          }
        }
      }
      return valid.length;
    },
    onSuccess: (count: number) => {
      toast(`세금계산서 ${count}장이 등록되었습니다. 홈택스 전자발행은 목록에서 해당 건을 눌러 별도로 진행하세요.`, "success");
      invalidate();
      setShowForm(false);
      setRows([blankRow()]);
      setDropdownRowKey(null);
    },
    onError: (err: any) => toast("세금계산서 등록 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const markMatchedMut = useMutation({
    mutationFn: (id: string) => markInvoiceMatched(id),
    onSuccess: invalidate,
    onError: (err: any) => toast("매칭 처리 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // Derived data
  const salesInvoices = invoices.filter((inv: any) => inv.type === "sales");
  const purchaseInvoices = invoices.filter((inv: any) => inv.type === "purchase");

  const totalSales = salesInvoices.reduce(
    (s: number, inv: any) => s + Number(inv.total_amount || 0),
    0
  );
  const totalPurchase = purchaseInvoices.reduce(
    (s: number, inv: any) => s + Number(inv.total_amount || 0),
    0
  );
  const unmatched = invoices.filter(
    (inv: any) => inv.status !== "matched" && inv.status !== "void"
  ).length;
  const vatEstimate =
    salesInvoices.reduce(
      (s: number, inv: any) => s + Number(inv.tax_amount || 0),
      0
    ) -
    purchaseInvoices.reduce(
      (s: number, inv: any) => s + Number(inv.tax_amount || 0),
      0
    );

  // Duplicate detection
  const duplicateInvoices = useMemo(() => detectDuplicateInvoices(invoices), [invoices]);
  //   '중복 아님' 처리한 그룹을 뺀 실제 알림 대상 — 결과 줄과 상세 패널이 같은 목록을 본다
  const liveDups = useMemo(
    () => duplicateInvoices.filter((d) => !dismissedDups.has(d.key)),
    [duplicateInvoices, dismissedDups]);

  /*   목록 두 탭이 보는 것 — **오너뷰가 만든 것(source='manual')만**. (2026-08-13 재편)
   *     발행 대기 = 국세청에 아직 안 간 것(미발행·전송중·에러). 에러를 여기 두는 이유는
   *                 **아직 안 갔기 때문**이다 — 이카운트도 '에러'를 미전송 묶음에 넣는다.
   *     발행 내역 = 승인이 끝난 것. 손댈 게 없는 확정 장부다.
   *   받아온 것(codef_hometax)은 수집·전표가 본다. 여기서 섞으면 "내가 낸 것"이 2,535건에 파묻힌다.
   */
  const isOurs = (inv: any) => (inv.source || "manual") === "manual";
  const isSent = (inv: any) => inv.nts_issue_status === "issued" || !!inv.nts_confirm_no;
  const waitInvoices = useMemo(
    () => invoices.filter((inv: any) => isOurs(inv) && !isSent(inv)), [invoices]);
  const doneInvoices = useMemo(
    () => invoices.filter((inv: any) => isOurs(inv) && isSent(inv)), [invoices]);
  //   짝 없는 발행 건 — 입금(status!=='matched') 또는 프로젝트(deal_id 없음)가 안 붙은 것.
  //   AI 제안 배지가 이 수를 보여 준다. 확정은 줄에서 사람이 한다.
  const pairGaps = useMemo(
    () => doneInvoices.filter((inv: any) => inv.status !== "matched" || !inv.deal_id).length,
    [doneInvoices]);
  //   '미매칭만' 보기 — AI 제안에서 켠다. 메뉴 이동 없이 이 화면에서 거른다 (2026-08-13 사장님).
  const [gapOnly, setGapOnly] = useState(false);
  const isListTab = tab === "wait" || tab === "done";
  const currentList = tab === "wait" ? waitInvoices : tab === "done" ? doneInvoices : [];

  /*   ── 발행 현황 요약 — 이카운트 「매출(세금)계산서요약」 형태 (2026-08-13 사장님 지시) ──
   *   묶음: 종이 / 미전송(미발행·전송대기·전송중·에러) / 전송완료(정발행 + 수정사유 6종) /
   *         타발행(홈택스에서 직접 낸 것) / 기한후발행.
   *   ★ 수정사유는 국세청 코드와 우리 MODIFICATION_REASONS 가 1:1 이라 그대로 쓴다.
   *     발행한 건의 사유는 요청 payload 의 modifyCode 에 남아 있다(전송 시점의 사실이라 이쪽이 정확하다).
   */
  const NTS_MODIFY_LABELS: Record<string, string> = {
    "1": "기재사항 착오정정", "2": "공급가액 변동", "3": "환입",
    "4": "계약의 해제", "5": "내국신용장 사후개설", "6": "착오에 의한 이중발급",
  };
  //   발행 기한 = 공급시기가 속한 달의 **다음 달 10일**. 넘기면 지연발행 가산세다.
  //   (실제로 우리 실패 1건의 국세청 거절 사유가 '지연발행'이었다 — 2026-05-26)
  const issueDeadline = (issueDate: string): string => {
    const [y, m] = String(issueDate || "").split("-").map(Number);
    if (!y || !m) return "";
    const ny = m === 12 ? y + 1 : y, nm = m === 12 ? 1 : m + 1;
    return `${ny}-${String(nm).padStart(2, "0")}-10`;
  };
  const daysLeft = (deadline: string): number | null => {
    if (!deadline) return null;
    return Math.round((new Date(deadline + "T00:00:00+09:00").getTime()
      - new Date(todayKst() + "T00:00:00+09:00").getTime()) / 86400000);
  };

  const issueSummary = useMemo(() => {
    const sales = invoices.filter((i: any) => i.type === "sales" && i.status !== "void");
    const agg = (rows: any[]) => ({
      n: rows.length,
      supply: rows.reduce((s, r) => s + Number(r.supply_amount || 0), 0),
      tax: rows.reduce((s, r) => s + Number(r.tax_amount || 0), 0),
    });
    const ours = sales.filter(isOurs);
    const others = sales.filter((r: any) => !isOurs(r));
    const st = (r: any) => r.nts_issue_status || "draft";
    const sent = ours.filter(isSent);
    const modifyCodeOf = (r: any) => String(r.nts_request_payload?.modifyCode || "");
    return {
      paper: agg([]),                                                    // 종이 계산서는 아직 안 다룬다
      unsent: {
        draft: agg(ours.filter((r: any) => !isSent(r) && st(r) === "draft")),
        pending: agg(ours.filter((r: any) => !isSent(r) && st(r) === "pending")),
        failed: agg(ours.filter((r: any) => !isSent(r) && st(r) === "failed")),
        total: agg(ours.filter((r: any) => !isSent(r))),
      },
      sent: {
        plain: agg(sent.filter((r: any) => !modifyCodeOf(r))),
        byReason: Object.keys(NTS_MODIFY_LABELS).map((code) => ({
          code, label: NTS_MODIFY_LABELS[code],
          ...agg(sent.filter((r: any) => modifyCodeOf(r) === code)),
        })),
        total: agg(sent),
      },
      others: agg(others),
      //   기한후발행 = 승인된 날이 기한(다음 달 10일)을 넘은 것
      late: agg(sent.filter((r: any) => {
        const dl = issueDeadline(r.issue_date);
        const at = r.nts_issued_at ? String(r.nts_issued_at).slice(0, 10) : "";
        return !!dl && !!at && at > dl;
      })),
      all: agg(sales),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [invoices]);

  //   '거래처 발행정보' 탭은 뺐다 (2026-08-13 사장님) — 빠진 받는 쪽 정보는
  //   전송 전 확인 창(IssueConfirmModal)이 건별로 잡아서 그 자리에서 채우게 한다.


  // 헤더 클릭 정렬 (표시용) — 합계/선택/내보내기는 currentList(원본) 사용, 렌더만 정렬
  type InvSortKey = "issue_date" | "counterparty_name" | "label" | "supply_amount" | "tax_amount" | "total_amount" | "status";
  const [invSortKey, setInvSortKey] = useState<InvSortKey>("issue_date");
  const [invSortDir, setInvSortDir] = useState<"asc" | "desc">("desc");
  const toggleInvSort = (k: InvSortKey) => {
    if (k === invSortKey) setInvSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setInvSortKey(k); setInvSortDir(k === "issue_date" ? "desc" : "asc"); }
  };
  // 목록 표 컬럼 리사이즈 — 경계선 드래그로 너비 조절 · 더블클릭 내용 자동맞춤 · localStorage 기억 (2026-07-14)
  const listTableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths("tax-invoice-list-colw-v4", {
    //   승인번호(nts)·전송(send)은 상세로 옮겨 컬럼이 없어졌다 (2026-08-10).
    //   기억해 둔 너비가 옛 컬럼 순서로 되살아나지 않게 저장 키도 v3 으로 올린다.
    //   v4 (2026-08-18): 머리단에 ≡ 자리(양쪽 22px)가 생겨 좁은 칸에서 글자가 ≡ 와 겹쳤다 — 기본 너비를 넓힌다.
    issue_date: 128, counterparty_name: 200, label: 170,
    supply_amount: 132, tax_amount: 116, total_amount: 136, status: 116, act: 132,
  });
  //   머리단은 수집·전표와 같은 부품(SortableTh) — 정렬 표시·깔때기·너비 손잡이가 한 벌이다 (2026-08-18 사장님:
  //   "둘이 디자인이 다르다"). 예전엔 이 화면만 ▲▼↕ 글자·자체 손잡이(ColHandle)를 따로 갖고 있었다.
  const thResize = (k: string, colIndex: number) => ({ k, colIndex, widths: colW, onResize: setColW, tableRef: listTableRef });
  const invSortTh = (k: InvSortKey, label: string, colIndex: number) => (
    <SortableTh<InvSortKey> label={label} sortKey={k} sort={{ key: invSortKey, dir: invSortDir }} onSort={toggleInvSort}
      filter={tiThFilter(k)} resize={thResize(k, colIndex)} />
  );
  // 대량 목록 렌더 상한 — 넓은 기간 선택 시 최대 1만 건 일괄 DOM 렌더로 화면이 멈추던 것 방지 (합계·건수는 전체 기준 유지)
  const [visibleRows, setVisibleRows] = useState(200);
  const displayList = useMemo(() => {
    const arr = [...currentList];
    arr.sort((a: any, b: any) => {
      let c = 0;
      switch (invSortKey) {
        case "counterparty_name": c = (a.counterparty_name || "").localeCompare(b.counterparty_name || "", "ko"); break;
        case "label": c = (a.label || a.deals?.name || "").localeCompare(b.label || b.deals?.name || "", "ko"); break;
        case "supply_amount": c = Number(a.supply_amount || 0) - Number(b.supply_amount || 0); break;
        case "tax_amount": c = Number(a.tax_amount || 0) - Number(b.tax_amount || 0); break;
        case "total_amount": c = Number(a.total_amount || 0) - Number(b.total_amount || 0); break;
        case "status": c = (a.status || "").localeCompare(b.status || "", "ko"); break;
        default: c = (a.issue_date || "").localeCompare(b.issue_date || "");
      }
      if (c === 0 && invSortKey !== "issue_date") c = (a.issue_date || "").localeCompare(b.issue_date || "");
      return invSortDir === "asc" ? c : -c;
    });
    return arr;
  }, [currentList, invSortKey, invSortDir]);

  /*   ── 조회 화면 표준 (CLAUDE.md 「조회 화면 표준」) ─────────────────────────
   *   수집·전표에서 확정한 뼈대를 **그대로** 쓴다. 새 툴바를 만들지 않는다.
   *   1줄 QueryBar[기간|검색조건 · 빠른검색 ‖ 실행] / 걸린 조건 칩 / 2줄 ResultStrip /
   *   표 + Pager(기본 50줄) / 고른 순간에만 뜨는 SelectionBar(파란 버튼은 여기 하나).
   */
  const [q, setQ] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<TiCond>(TI_EMPTY);
  const [live, setLive] = useState<TiCond>(TI_EMPTY);
  const setD = <K extends keyof TiCond>(k: K) => (v: TiCond[K]) => setDraft((c) => ({ ...c, [k]: v }));

  //   고를 수 있는 값들 — **이 기간에 실제로 나온 것만**(고르고도 0건이면 헷갈린다)
  const tiPartnerOpts = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of currentList as any[]) {
      const n = r.counterparty_name || "";
      if (n && !m.has(n)) m.set(n, r.counterparty_bizno || "");
    }
    return [...m].sort((a, b) => a[0].localeCompare(b[0], "ko")).map(([v, sub]) => ({ value: v, label: v, sub }));
  }, [currentList]);

  /** 전송 상태 한 글자 — 칩·표·요약이 같은 판정을 쓰도록 한 곳에 둔다 */
  const sendStateOf = (r: any): "issued" | "pending" | "failed" | "draft" =>
    isSent(r) ? "issued" : r.nts_issue_status === "pending" ? "pending"
      : r.nts_issue_status === "failed" ? "failed" : "draft";

  /*   ── 엑셀식 머리단 필터 (2026-08-13 사장님: "엑셀과 아예 동일하게") ──
   *   colVal 이 칸의 표시값을 뽑는 단 하나의 기준 — 필터 목록과 거르기가 같은 값을 본다. */
  const [colF, setColF] = useState<Record<string, Set<string> | null>>({});
  const tiColVal = (r: any, k: string): string => {
    switch (k) {
      case "issue_date": return String(r.issue_date || "");
      case "counterparty_name": return r.counterparty_name || "";
      case "label": {
        const one = (r.item_name ? String(r.item_name).replace(/\+/g, " ") : "") || stripPurposeToken(r.label) || r.deals?.name || "";
        return itemsLabel(r.items, one) || "";
      }
      case "supply_amount": return Number(r.supply_amount || 0).toLocaleString("ko");
      case "tax_amount": return Number(r.tax_amount || 0).toLocaleString("ko");
      case "total_amount": return Number(r.total_amount || 0).toLocaleString("ko");
      case "status": return isSent(r) ? "전송 완료" : r.nts_issue_status === "pending" ? "전송 중"
        : r.nts_issue_status === "failed" ? "오류" : "미발행";
      default: return "";
    }
  };
  const tiColHit = (r: any): boolean =>
    Object.entries(colF).every(([k, set]) => !set || set.has(tiColVal(r, k)));
  const tiThFilter = (k: string): ThFilterSpec => ({
    values: (currentList as any[])
      .filter((r) => Object.entries(colF).every(([kk, set]) => kk === k || !set || set.has(tiColVal(r, kk))))
      .map((r) => tiColVal(r, k)),
    selected: colF[k] ?? null,
    onApply: (sel) => setColF((f) => ({ ...f, [k]: sel })),
  });

  const matchCond = (r: any, c: TiCond) => {
    const total = Number(r.total_amount || r.supply_amount || 0);
    if (!quickSearchHit(q, [r.counterparty_name, r.counterparty_bizno, r.item_name, r.nts_confirm_no], [total])) return false;
    if (c.partner.length && !c.partner.includes(r.counterparty_name || "")) return false;
    if (c.item && !String(r.item_name || "").toLowerCase().includes(c.item.toLowerCase())) return false;
    if (c.send !== "all" && sendStateOf(r) !== c.send) return false;
    if (!amountHit(total, c.min, c.max)) return false;
    return true;
  };
  const tiFiltered = useMemo(() => (displayList as any[]).filter((r) =>
    matchCond(r, live) && tiColHit(r)
    //   '미매칭만' — 발행 내역에서만 뜻이 있다(발행 전 건은 아직 매칭 대상이 아니다)
    && !(gapOnly && tab === "done" && r.status === "matched" && r.deal_id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayList, q, live, colF, gapOnly, tab]);
  const tiPager = usePager(tiFiltered, live.size, `${tab}|${gapOnly}|${viewFromMonth}|${viewToMonth}|${q}|${JSON.stringify(live)}|${JSON.stringify(Object.fromEntries(Object.entries(colF).map(([k, v]) => [k, v ? [...v] : null])))}`);
  const tiPreview = useMemo(() => (displayList as any[]).filter((r) => matchCond(r, draft)).length,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [displayList, q, draft]);

  //   내 조건 — ★ 하나가 이 화면의 기본값 (DB 라 PC 를 바꿔도 따라온다)
  const tiSaved = useSavedQueries(`tax-invoices:${tab}`, companyId);
  const tiParamsNow = { from: viewFromMonth, to: viewToMonth, q, cond: live };
  const tiParamsBasic = { ...defaultRangeMonth(), q: "", cond: TI_EMPTY };
  const applyTiSaved = (p: Record<string, unknown>) => {
    if (typeof p.from === "string" && typeof p.to === "string") { setViewFromMonth(p.from); setViewToMonth(p.to); }
    if (typeof p.q === "string") setQ(p.q);
    const c = { ...TI_EMPTY, ...(p.cond as Partial<TiCond> | undefined) };
    setDraft(c); setLive(c);
  };
  const [tiDefDone, setTiDefDone] = useState(false);
  useEffect(() => {
    if (tiDefDone || !tiSaved.isFetched) return;
    setTiDefDone(true);
    if (tiSaved.def) applyTiSaved(tiSaved.def.params || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tiSaved.isFetched, tiSaved.def, tiDefDone]);
  const tiSuggestName = () => {
    const p: string[] = [];
    if (draft.partner.length) p.push(draft.partner[0] + (draft.partner.length > 1 ? ` 외 ${draft.partner.length - 1}` : ""));
    if (draft.item) p.push(draft.item);
    if (draft.send !== "all") p.push(TI_SEND_CHIPS.find((s) => s.value === draft.send)?.label || "");
    if (draft.min || draft.max) p.push("금액");
    return p.filter(Boolean).slice(0, 3).join(" · ") || "내 조건";
  };

  //   걸린 조건 — 열지 않고도 보이고, ✕ 로 하나씩 뺀다
  const tiDrop = (patch: Partial<TiCond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const tiChips: AppliedChip[] = [
    ...(gapOnly && tab === "done" ? [{ group: "매칭", label: "미매칭만", onRemove: () => setGapOnly(false) }] : []),
    ...quickTerms(q).map((t, i) => ({
      group: "빠른검색", label: t,
      onRemove: () => setQ(quickTerms(q).filter((_, j) => j !== i).join(", ")),
    })),
    ...live.partner.map((v) => ({ group: "거래처", label: v, onRemove: () => tiDrop({ partner: live.partner.filter((x) => x !== v) }) })),
    ...(live.item ? [{ group: "품목", label: live.item, onRemove: () => tiDrop({ item: "" }) }] : []),
    ...(live.send !== "all" ? [{
      group: "전송 상태", label: TI_SEND_CHIPS.find((s) => s.value === live.send)?.label || live.send,
      onRemove: () => tiDrop({ send: "all" as const }),
    }] : []),
    ...((live.min || live.max) ? [{
      group: "금액", label: `${Number(live.min || 0).toLocaleString("ko")} ~ ${live.max ? Number(live.max).toLocaleString("ko") : "제한없음"}`,
      onRemove: () => tiDrop({ min: "", max: "" }),
    }] : []),
  ];

  //   엑셀 — 지금 조건 그대로, 표에 보이는 칸 그대로
  const tiXlsRows = (list: any[]) => list.map((r) => ({
    "작성일자": r.issue_date,
    "상호(거래처)": r.counterparty_name || "",
    "사업자등록번호": r.counterparty_bizno || "",
    "품목": r.item_name || "",
    "공급가액": Number(r.supply_amount || 0),
    "세액": Number(r.tax_amount || 0),
    "합계금액": Number(r.total_amount || 0),
    "전송 상태": TI_SEND_CHIPS.find((s) => s.value === sendStateOf(r))?.label || "",
    "국세청 승인번호": r.nts_confirm_no || "",
    "거절 사유": r.nts_error_message || "",
  }));
  const tiExcelItems: ExcelItem[] = [
    //   가져오기 메뉴를 없애며 엑셀 관련 두 가지를 여기로 옮겼다 (2026-08-13)
    { label: "엑셀 일괄발행 (양식 업로드)",
      hint: "엑셀 양식으로 여러 건을 한 번에 국세청 전자발행합니다", onClick: () => setShowBulkIssue(true) },
    { label: "더존 양식으로 내려받기", count: currentList.length,
      hint: "회계사무소 전달용 — 현재 탭 목록을 더존 양식으로",
      onClick: async () => {
        const { exportTaxInvoicesDouzone } = await import("@/lib/export-douzone");
        exportTaxInvoicesDouzone(currentList as any, `${viewFromMonth}_${viewToMonth}`);
      } },
    { label: "조회 결과 전부 내려받기", count: tiFiltered.length,
      hint: "지금 걸린 조건 그대로 · 표에 보이는 칸 그대로",
      onClick: () => exportSheet(tiXlsRows(tiFiltered), "세금계산서", `발행_${viewFromMonth}~${viewToMonth}`) },
    { label: "지금 쪽만 내려받기", count: tiPager.view.length,
      hint: `${tiPager.from}–${tiPager.to}번째 줄만`,
      onClick: () => exportSheet(tiXlsRows(tiPager.view), "세금계산서", `발행_${viewFromMonth}~${viewToMonth}_${tiPager.page}쪽`) },
  ];

  const validRowCount = rows.filter(isRowValid).length;
  const canSubmit = validRowCount > 0;
  const rowsTotal = rows.reduce(
    (a, r) => {
      const s = Number(r.supplyAmount) || 0;
      a.supply += s;
      a.tax += r.taxKind === "taxable" ? Math.round(s * 0.1) : 0; // 영세율·면세 = 세액 0
      return a;
    },
    { supply: 0, tax: 0 },
  );

  // 미발행 = 홈택스 승인번호 없음 + 무효 아님 (일괄 발행/삭제 대상 — 발행완료 건은 보호)
  const isUnissued = (inv: any) => !inv.nts_confirm_no && inv.status !== 'void';
  // 전표처리 대상: 무효 아님 + 아직 전표 미생성. 발행 여부와 무관(발행완료 건도 기장 필요).
  const isVoucherable = (inv: any) => inv.status !== 'void' && !inv.journal_entry_id;
  // 체크박스 선택 가능 = 일괄 발행/삭제 또는 전표처리 중 하나라도 가능한 행
  const selectableInList = currentList.filter((inv: any) => isUnissued(inv) || isVoucherable(inv));
  const selectedRows = selectableInList.filter((inv: any) => selectedIds.has(inv.id));
  const selectedIssuable = selectedRows.filter((inv: any) => inv.type === 'sales' && isUnissued(inv)); // 발행 가능(매출 미발행)
  const selectedDeletable = selectedRows.filter((inv: any) => isUnissued(inv)); // 삭제 가능(미발행만)
  const selectedVoucherable = selectedRows.filter(isVoucherable); // 전표처리 가능

  function toggleSelectAll() {
    if (selectedRows.length === selectableInList.length && selectableInList.length > 0) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(selectableInList.map((inv: any) => inv.id)));
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  //   전송은 이제 확인 창(IssueConfirmModal)을 거친다 — 바로 쏘는 길을 없앴다 (2026-08-13, 4단계).
  //   받는 쪽 정보(이메일·업태·종목)가 빠진 채 나가는 것을 전송 직전에 잡기 위해서다.

  // 선택 일괄 삭제 — 미발행(홈택스 승인번호 없음) 건만 대상. 파괴적이라 확인 후 진행.
  async function handleBatchDelete() {
    if (selectedDeletable.length === 0) { toast("삭제 가능한 미발행 건이 없습니다", "error"); return; }
    const { ok: delOk } = await confirmDialog({ title: `선택 ${selectedDeletable.length}건 삭제`, desc: "홈택스 미발행 건만 삭제되며, 되돌릴 수 없습니다.", danger: true });
    if (!delOk) return;
    setBatchIssuing(true);
    let ok = 0, fail = 0;
    for (const inv of selectedDeletable) {
      try {
        const { error } = await supabase.from("tax_invoices").delete().eq("id", inv.id);
        if (error) throw error;
        ok++;
      } catch { fail++; }
    }
    setBatchIssuing(false);
    setSelectedIds(new Set());
    invalidateTaxInvoiceReaders(queryClient);   //   원장·미수·요약 등 파생 화면 일괄 (2026-08-31)
    toast(fail === 0 ? `${ok}건 삭제 완료` : `${ok}건 삭제, ${fail}건 실패`, fail === 0 ? "success" : "error");
  }

  // 선택 일괄 전표처리 — post_invoice_voucher(매출/매입 방향 자동). 이미 전표 있는 건/무효 건은 건너뜀.
  async function handleBulkVoucher() {
    if (!bulkVoucherAccountId || bulkVoucherPosting) { if (!bulkVoucherAccountId) toast("계정과목을 선택하세요", "error"); return; }
    setBulkVoucherPosting(true);
    const db = supabase;
    let ok = 0, fail = 0, skip = 0;
    try {
      for (const inv of selectedVoucherable) {
        if (!isVoucherable(inv)) { skip++; continue; }
        const { error } = await db.rpc("post_invoice_voucher", { p_tax_invoice_id: inv.id, p_account_id: bulkVoucherAccountId, p_remember: false });
        if (error) fail++; else ok++;
      }
      toast(`${ok}건 전표처리 완료${fail > 0 ? ` · ${fail}건 실패` : ""}${skip > 0 ? ` · ${skip}건 건너뜀` : ""}`, fail > 0 ? "info" : "success");
      setShowBulkVoucher(false); setBulkVoucherAccountId(""); setSelectedIds(new Set());
      invalidateTaxInvoiceReaders(queryClient);   //   원장·미수·요약 등 파생 화면 일괄 (2026-08-31)
    } finally { setBulkVoucherPosting(false); }
  }

  if (isLoading && invoices.length === 0) {
    return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;
  }

  if (mainError) {
    return <div className="p-6 text-center text-red-400">데이터를 불러올 수 없습니다. 새로고침해 주세요.</div>;
  }

  return (
    <div className="qk-shell" data-print-area>
      {confirmElement}
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />

      {/* ── 조회 화면 표준 — 탭·조회 줄·걸린 조건·결과 요약·표·쪽 넘김을 **한 상자**에.
             수집·전표와 같은 껍데기다 (2026-08-13 사장님: "UI구조는 수집전표를 따라야 함").
             예전엔 탭 줄·요약 스트립·표 카드가 낱장으로 흩어져 어디까지가 '조회하는 곳'인지 안 갈렸다. ── */}
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {/*   건수는 **할 일 수** — 수집·전표의 탭 배지와 같은 규칙 */}
            {TAX_TABS.filter((t) => taxTabAllowed(t.key)).map((t) => {
              const count = t.key === "wait" ? waitInvoices.length
                : t.key === "done" ? doneInvoices.length
                : null;
              return (
                <button key={t.key} type="button" onClick={() => setTab(t.key)}
                  className={tab === t.key ? "collect-tab collect-tab-on" : "collect-tab"}>
                  {t.label}
                  {count !== null && <span className="collect-tab-cnt">{count.toLocaleString("ko")}</span>}
                </button>
              );
            })}
          </div>

          <QueryBar right={<>
            {/*   무제한 플랜도 사용량은 보이게 — 한도 없으면 '이번 달 발행 N건' (2026-08-11 사장님) */}
            {issuanceStatus && (
              <span className={issuanceStatus.remaining === 0 ? "ti-quota ti-quota-out" : "ti-quota"}
                title={issuanceStatus.limit !== null
                  ? `${issuanceStatus.planName || "현재 요금제"} — 세금계산서는 월 ${issuanceStatus.limit}건까지 발행할 수 있습니다 (이번 달 ${issuanceStatus.used}/${issuanceStatus.limit}건 · 현금영수증 한도는 별도)`
                  : `${issuanceStatus.planName || "현재 요금제"} — 세금계산서 발행 무제한 (이번 달 ${issuanceStatus.used}건 발행)`}>
                {issuanceStatus.limit !== null
                  ? <>발행 <b className="mono-number">{issuanceStatus.remaining ?? 0}건</b> 남음</>
                  : <>이번 달 <b className="mono-number">{issuanceStatus.used}건</b></>}
              </span>
            )}
            <ExcelMenu items={tiExcelItems} />
            {/*   AI 제안 — 보조 기능 모음(조회 표준 이름). 줄마다 출처를 적는다. */}
            {/*   메뉴 안에서는 AI 를 뺀다 — 그릇(AI 제안)에 이미 적혀 있다 (2026-08-13 사장님 확정).
                  회계자료(3방향 대조표)로 넘어가던 링크는 없앴다 — 처리는 메뉴 이동 없이 여기서. */}
            <HelperMenu items={[{
              label: "미매칭 발행 건 보기",
              source: "장부 대조",
              badge: pairGaps,
              hint: "발행 완료됐는데 입금 또는 프로젝트가 안 매칭된 건만 걸러 봅니다 — 줄의 '연결'·'프로젝트'로 매칭합니다",
              onClick: () => { setTab("done"); setGapOnly(true); },
            }]} />
            {/*   주 실행 — 파란 채움은 조회 줄에 이거 하나. 확정(전송)은 아래 SelectionBar 가 맡는다 */}
            <button onClick={() => setShowForm(true)} className="btn-primary btn-sm" title="세금계산서를 씁니다">
              + 발행
            </button>
          </>}>
            {/*   기간을 치는 칸은 화면에 하나뿐. 달력은 검색조건 안에 있고,
                  오른쪽 끝에 '검색조건'이 붙어 한 덩어리로 보인다. */}
            <DateRangeField unit="month" label={null} parts="segments"
              from={viewFromMonth} to={viewToMonth}
              onChange={(f, t) => { setViewFromMonth(f); setViewToMonth(t); }}
              trailing={
                <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen}
                  activeCount={tiCondCount(live)} anchorSel=".drf"
                  tabs={<SavedTabs list={tiSaved.list} current={tiParamsNow} basic={tiParamsBasic}
                    onApply={(s) => { applyTiSaved(s.params || {}); setPanelOpen(false); }}
                    onBasic={() => {
                      const b = defaultRangeMonth();
                      setViewFromMonth(b.from); setViewToMonth(b.to);
                      setQ(""); setDraft(TI_EMPTY); setLive(TI_EMPTY);
                    }}
                    onRemove={tiSaved.remove} onSetDefault={tiSaved.setDefault} />}
                  foot={<>
                    <button type="button" className="btn-secondary btn-sm" disabled={tiCondCount(draft) === 0}
                      onClick={() => setDraft({ ...TI_EMPTY, size: draft.size })}>조건 지우기</button>
                    <ConditionSave suggest={tiSuggestName}
                      onSave={(name, asDefault) => {
                        tiSaved.save(name, { from: viewFromMonth, to: viewToMonth, q, cond: draft }, asDefault);
                        setLive(draft); setPanelOpen(false);
                      }} />
                    <span className="ml-auto text-[11px] text-[var(--text-dim)]">{tiPreview.toLocaleString("ko")}건</span>
                    <RowsPerPage value={draft.size} onChange={setD("size")} />
                    <button type="button" className="btn-primary btn-sm"
                      onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
                  </>}>
                  <ConditionRow label="조회기간" hint="월 단위">
                    <span className="qk-range-txt">{viewFromMonth} ~ {viewToMonth}</span>
                    <DateRangeField unit="month" label={null} parts="calendar" confirm
                      from={viewFromMonth} to={viewToMonth}
                      onChange={(f, t) => { setViewFromMonth(f); setViewToMonth(t); }} />
                    <span className="qk-quicks">
                      {periodQuicksMonth().map((pq) => (
                        <button key={pq.key} type="button"
                          onClick={() => { setViewFromMonth(pq.from); setViewToMonth(pq.to); }}
                          className={viewFromMonth === pq.from && viewToMonth === pq.to ? "qk-quick qk-quick-on" : "qk-quick"}>
                          {pq.label}
                        </button>
                      ))}
                    </span>
                  </ConditionRow>

                  <ConditionRow label="거래처" hint="여러 곳">
                    <TokenField items={tiPartnerOpts} value={draft.partner} onChange={setD("partner")}
                      placeholder="거래처 이름 일부 (예: 모티)" />
                  </ConditionRow>

                  <ConditionRow label="품목">
                    <input className="qk-input w-full" value={draft.item} placeholder="예: 용역"
                      onChange={(e) => setD("item")(e.target.value)} />
                  </ConditionRow>

                  <ConditionRow label="전송 상태" hint="국세청에 갔는지">
                    <ChipGroup value={draft.send} onChange={setD("send")} options={TI_SEND_CHIPS as any} />
                  </ConditionRow>

                  <ConditionRow label="합계 금액" hint="한쪽만 적어도 됩니다">
                    <AmountRange min={draft.min} max={draft.max} onMin={setD("min")} onMax={setD("max")} />
                  </ConditionRow>
                </ConditionPanel>
              } />

            <QuickSearch value={q} onApply={setQ}
              placeholder="거래처 · 품목 · 승인번호 · 금액 — 쉼표로 여러 개, Enter" />
          </QueryBar>

          {isListTab && (
            <AppliedChips chips={tiChips} onClearAll={() => { setQ(""); setLive(TI_EMPTY); setDraft(TI_EMPTY); }} />
          )}

          {/*   2줄 — 건수·합계. 목록을 바꾸지 않는 것만 둔다. */}
          {isListTab && (
            <ResultStrip>
              <Stat label="건수" value={`${tiFiltered.length.toLocaleString("ko")}건`} />
              <Stat label="공급가액" value={fmt(tiFiltered.reduce((s: number, r: any) => s + Number(r.supply_amount || 0), 0))} />
              <Stat label="세액" value={fmt(tiFiltered.reduce((s: number, r: any) => s + Number(r.tax_amount || 0), 0))} />
              <Stat label="합계" value={fmt(tiFiltered.reduce((s: number, r: any) => s + Number(r.total_amount || 0), 0))} />
              {tab === "wait" && tiFiltered.some((r: any) => sendStateOf(r) === "failed") && (
                <span className="ti-strip-bad">
                  에러 <b>{tiFiltered.filter((r: any) => sendStateOf(r) === "failed").length}건</b> — 표의 '에러'를 누르면 사유가 보입니다
                </span>
              )}
              {/*   기간 밖에 남아 있는 미발행 — 조건을 몰래 바꾸지 않고 알려만 준다 */}
              {tab === "wait" && waitOutside > 0 && (
                <span className="ti-strip-bad">
                  이 기간 밖에 <b>{waitOutside.toLocaleString("ko")}건</b>이 더 안 보내진 채 있습니다
                  <button type="button" className="ti-strip-go"
                    onClick={() => { setViewFromMonth(`${todayKst().slice(0, 4)}-01`); setViewToMonth(todayKst().slice(0, 7)); }}>
                    올해 전체로 넓히기
                  </button>
                </span>
              )}
            </ResultStrip>
          )}

          {/*   발행 현황의 결과 줄 — 표(요약)를 바꾸지 않는 알림만 둔다.
                '처리할 것' 주황 바(doc-check-bar)를 이 줄로 녹였다 (2026-08-13 사장님 지적).
                옛 바의 작성 중·홈택스 미발행은 이제 **발행 대기 탭과 요약표의 미전송 줄**이 그
                자리다 — 같은 숫자를 세 군데 두면 어디를 믿어야 할지 모른다. 남는 건 **중복 의심**뿐. */}
          {tab === "issue-status" && (
            <ResultStrip>
              <Stat label="보낼 것" value={`${issueSummary.unsent.total.n.toLocaleString("ko")}건`} />
              <Stat label="전송 완료" value={`${issueSummary.sent.total.n.toLocaleString("ko")}건`} />
              {waitOutside > 0 && (
                <span className="ti-strip-bad">
                  이 기간 밖에 <b>{waitOutside.toLocaleString("ko")}건</b>이 더 안 보내진 채 있습니다
                  <button type="button" className="ti-strip-go"
                    onClick={() => { setViewFromMonth(`${todayKst().slice(0, 4)}-01`); setViewToMonth(todayKst().slice(0, 7)); }}>
                    올해 전체로 넓히기
                  </button>
                </span>
              )}
              {liveDups.length > 0 && (
                <span className="ti-strip-bad">
                  중복 의심 <b>{liveDups.length}건</b>
                  <button type="button" className="ti-strip-go" onClick={() => setCheckOpen((v) => !v)}>
                    {checkOpen ? "접기" : "확인하기"}
                  </button>
                </span>
              )}
            </ResultStrip>
          )}
        </QueryHead>

        <QueryBody>

      {/* 매출·매입 목록의 요약·경고 — 이 두 탭에서만 노출 (집계·자동발행 탭엔 중복이라 숨김) */}

      {/* 엑셀 내보내기·등록은 상단 액션 영역으로 이동(2026-07-14 UI 정리). 엑셀 업로드는 제거(2026-07-31 사장님). */}
      {/* 정렬 — 별도 버튼 툴바 제거(2026-07-13). 표 헤더(작성일자·거래처·품목·공급가액…)를 클릭하면 정렬됩니다. */}

      {/*   3줄 SelectionBar — 고른 순간에만 뜨는 바닥 고정 바.
             ★ **파란(확정) 버튼은 화면을 통틀어 여기 하나**다 (조회 화면 표준).
             전표처리는 뺐다 (2026-08-13 사장님) — 전표를 만드는 입구는 수집·전표 하나여야 한다.
             같은 줄을 두 화면에서 각각 전표로 만들 수 있으면 "처리했는데 미처리로 남는" 사고가 난다. */}
      {isListTab && selectedRows.length > 0 && (
        <SelectionBar
          count={selectedRows.length}
          summary={`합계 ${fmt(selectedRows.reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0))}`}
          onClear={() => setSelectedIds(new Set())}
        >
          {selectedDeletable.length > 0 && (
            <button onClick={handleBatchDelete} disabled={batchIssuing} className="btn-danger-solid btn-sm">
              선택 삭제 {selectedDeletable.length}
            </button>
          )}
          {selectedIssuable.length > 0 && (
            <button onClick={() => setIssueConfirm(selectedIssuable)} disabled={batchIssuing} className="btn-primary btn-sm">
              홈택스로 전송 ({selectedIssuable.length})
            </button>
          )}
        </SelectionBar>
      )}

      {/* Sales / Purchase Table */}
      {isListTab && (
        <div className="tax-invoice-list-card">
          {isLoading ? (
            <div className="p-16 text-center text-sm text-[var(--text-muted)]">
              불러오는 중...
            </div>
          ) : currentList.length === 0 ? (
            <div className="py-16 px-6 text-center">
              <div className="empty-state-icon mx-auto"><Ico e="🧾" /></div>
              <div className="text-base font-semibold text-[var(--text)]">
                발행한 세금계산서가 여기에 쌓입니다 — '발행 대기' 탭에서 보내면 됩니다
              </div>
              <div className="text-xs text-[var(--text-muted)] mt-1.5">
                홈택스에서 불러오거나 직접 등록할 수 있습니다
              </div>
              <button
                onClick={() => setShowForm(true)}
                className="no-print mt-5 btn-primary"
              >
                + 세금계산서 등록
              </button>
            </div>
          ) : (
            <div>
              {/*   옛 홈택스식 요약 바는 뺐다 (2026-08-13) — 조회 표준 ResultStrip 이
                    같은 숫자를 이미 보여 준다. 같은 숫자 두 번은 어디를 믿을지 모르게 한다. */}
              {/* 홈택스식 격자 그리드 */}
              <div className="overflow-auto max-h-[600px]">
                <table ref={listTableRef} className="tax-invoice-list-table ev-lined">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className="w-8">
                        {selectableInList.length > 0 && (
                          <input type="checkbox" checked={selectedRows.length === selectableInList.length && selectableInList.length > 0} onChange={toggleSelectAll}
                            className="w-3.5 h-3.5 rounded accent-[var(--primary)] align-middle cursor-pointer" title="미발행 전체 선택" />
                        )}
                      </th>
                      {/*  승인번호·전송은 행을 눌러 여는 상세로 옮겼다 — 표는 찾고 고르는 곳이다 (2026-08-10).
                           국세청 미발행처럼 **눈에 띄어야 하는 것**은 상태 칸에 함께 세운다. */}
                      {invSortTh("issue_date", "작성일자", 1)}
                      {invSortTh("counterparty_name", "상호(거래처)", 2)}
                      {invSortTh("label", "품목", 3)}
                      {invSortTh("supply_amount", "공급가액", 4)}
                      {invSortTh("tax_amount", "세액", 5)}
                      {invSortTh("total_amount", "합계금액", 6)}
                      {invSortTh("status", "상태", 7)}
                      {/*   매칭 사슬 — 발행 내역에서만. 발행 전 건은 아직 매칭 대상이 아니다 (2026-08-13) */}
                      {tab === "done" && <SortableTh label="매칭" />}
                      <SortableTh label="관리" resize={thResize("act", tab === "done" ? 9 : 8)} />
                    </tr>
                  </thead>
                  <tbody>
                    {tiPager.view.map((inv: any) => {
                      const sc = invoiceStatusMeta(inv.status, inv.type);
                      const posted = !!inv.journal_entry_id;
                      const canSelect = isUnissued(inv) || isVoucherable(inv);
                      const canIssue = inv.type === 'sales' && isUnissued(inv);
                      //   과세유형이 회사와 안 맞는 옛 초안 — 누르면 서버가 거절하므로 이유를 미리 적어 준다
                      const kindBlocked = taxKindBlockedReason(vatBiz, (inv.tax_kind || "taxable") as TaxKind);
                      const notIssued = inv.type === 'sales' && inv.status !== 'draft' && !inv.nts_confirm_no;
                      return (
                        <tr key={inv.id} onClick={() => setSelectedInvoice(inv)}
                          className="tax-invoice-row">
                          <td className="px-2 py-2 text-center border-l border-[var(--border)]/40 first:border-l-0" onClick={(e) => e.stopPropagation()}>
                            {canSelect ? (
                              <input type="checkbox" checked={selectedIds.has(inv.id)} onChange={() => toggleSelect(inv.id)}
                                className="w-3.5 h-3.5 rounded accent-[var(--primary)] align-middle cursor-pointer" />
                            ) : posted ? (
                              <span className="text-[9px] text-emerald-500 font-semibold" title="전표처리됨">전표</span>
                            ) : null}
                          </td>
                          <td className="px-3 py-2 text-[var(--text-muted)] mono-number border-l border-[var(--border)]/40 whitespace-nowrap">{inv.issue_date}</td>
                          <td className="px-3 py-2 border-l border-[var(--border)]/40 max-w-[200px]">
                            <span className="flex items-center gap-1.5 min-w-0">
                              <span className="font-semibold text-[var(--text)] truncate">{inv.counterparty_name}</span>
                              {inv.auto_issued && <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-blue-500/10 text-blue-400">자동</span>}
                              {inv.original_invoice_id && <span className="shrink-0 text-[9px] px-1 py-0.5 rounded bg-orange-500/10 text-orange-400">수정</span>}
                            </span>
                          </td>
                          {/* 품목: 줄이 여럿이면 '첫 품목 외 N건' — 국세청에 실제 발행되는 이름 기준 (2026-08-10).
                              줄이 없는 옛 건은 item_name → label → 딜 이름 순 폴백 (2026-08-05) */}
                          {(() => {
                            const one = (inv.item_name ? String(inv.item_name).replace(/\+/g, " ") : "") || stripPurposeToken(inv.label) || (inv as any).deals?.name || "";
                            const label = itemsLabel(inv.items as any, one) || "—";
                            const full = ((inv.items as any[]) || []).map((it: any) => it?.name).filter(Boolean).join(" · ") || one;
                            return (
                              <td className="px-3 py-2 text-[var(--text-muted)] border-l border-[var(--border)]/40 whitespace-nowrap overflow-hidden text-ellipsis max-w-[180px]" title={full}>
                                {/*   출처 — 매입매출전표가 만든 초안은 표시해 준다 (2026-08-13).
                                      세금·증빙에서 전표처리를 없앤 지금, manual 초안에 전표가
                                      걸려 있다 = 매입매출전표에서 태어났다는 뜻이다. */}
                                {tab === "wait" && inv.journal_entry_id && (
                                  <span className="ti-src-pill">매입매출전표</span>
                                )}
                                {label}
                              </td>
                            );
                          })()}
                          <td className="px-3 py-2 text-right mono-number text-[var(--text)] border-l border-[var(--border)]/40">{Number(inv.supply_amount).toLocaleString("ko")}</td>
                          <td className="px-3 py-2 text-right mono-number text-[var(--text-muted)] border-l border-[var(--border)]/40">{Number(inv.tax_amount).toLocaleString("ko")}</td>
                          <td className="px-3 py-2 text-right mono-number font-semibold text-[var(--text)] border-l border-[var(--border)]/40">{Number(inv.total_amount).toLocaleString("ko")}</td>
                          {/*   상태 = **홈택스 전송 진행상황** 필 하나 (2026-08-13 사장님 — 줄 간격 정리).
                                예전엔 전송 필 + 업무 상태 필 + 에러 사유 문장이 한 칸에 쌓여
                                줄 높이가 들쑥날쑥했다. 업무 상태(매칭완료 등)는 관리 칸의
                                '✓ 연결됨'이 이미 말해 주고, 에러 사유는 **'에러'를 눌러야** 보인다. */}
                          <td className="px-3 py-2 text-center whitespace-nowrap border-l border-[var(--border)]/40">
                            {(() => {
                              const st = inv.nts_issue_status || "draft";
                              if (isSent(inv)) return (
                                <span className="ti-send ti-send-ok"
                                  title={inv.nts_issued_at ? `국세청 승인 ${String(inv.nts_issued_at).slice(0, 10)}${inv.nts_confirm_no ? ` · 승인번호 ${inv.nts_confirm_no}` : ""}` : "국세청 승인 완료"}>
                                  전송 완료
                                </span>
                              );
                              if (st === "pending") return (
                                <span className="ti-send ti-send-wait"
                                  title="팝빌에 등록됐습니다. 국세청 전송은 다음 영업일에 이뤄지고, 승인번호는 그 뒤에 붙습니다.">
                                  전송 중
                                </span>
                              );
                              if (st === "failed") return (
                                <button type="button" className="ti-send ti-send-bad" title="누르면 거절 사유가 보입니다"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    confirmDialog({
                                      title: "국세청 거절 사유",
                                      desc: inv.nts_error_message || "사유가 기록되지 않았습니다.",
                                      confirmLabel: "확인",
                                    });
                                  }}>
                                  에러 ▾
                                </button>
                              );
                              return <span className="ti-send ti-send-draft" title="아직 국세청에 보내지 않았습니다">미발행</span>;
                            })()}
                          </td>
                          {/*   매칭 사슬 칩 — 입금·프로젝트가 붙었는지 한눈에 (2026-08-13 AI 매칭 기획 ①).
                                입금은 '연결' 버튼과, 프로젝트는 '프로젝트' 버튼과 같은 사실을 본다. */}
                          {tab === "done" && (
                            <td className="px-3 py-2 text-center whitespace-nowrap border-l border-[var(--border)]/40">
                              <span className="ti-pair">
                                <i className={inv.status === "matched" ? "ti-pair-ok" : "ti-pair-no"}>
                                  {inv.status === "matched" ? "입금 ✓" : "입금 —"}
                                </i>
                                <i className={inv.deal_id ? "ti-pair-ok" : "ti-pair-no"}>
                                  {inv.deal_id ? "프로젝트 ✓" : "프로젝트 —"}
                                </i>
                              </span>
                            </td>
                          )}
                          <td className="px-3 py-2 text-center border-l border-[var(--border)]/40" onClick={(e) => e.stopPropagation()}>
                            <div className="flex flex-nowrap items-center justify-center gap-1 whitespace-nowrap">
                              {canIssue && (
                                <button
                                  onClick={() => kindBlocked ? toast(kindBlocked, "error") : setIssueConfirm([inv])}
                                  className={kindBlocked
                                    ? "px-2.5 py-1 rounded text-[11px] font-bold transition bg-[var(--bg-surface)] text-[var(--text-dim)]"
                                    : "px-2.5 py-1 rounded text-[11px] font-bold text-white transition hover:brightness-110 bg-[var(--primary)]"}
                                  title={kindBlocked || "홈택스 전자발행"}
                                >
                                  발행
                                </button>
                              )}
                              {/* 거래매칭 — 통장 입출금 거래에 바로 연결 */}
                              {inv.status === "matched" ? (
                                <button
                                  onClick={() => setLinkInvoice(inv)}
                                  className="inline-flex items-center gap-0.5 px-2 py-1 rounded text-[11px] font-semibold bg-green-500/12 text-green-600 hover:bg-green-500/20 transition"
                                  title="통장 거래에 연결됨 — 클릭해 확인/해제"
                                >
                                  ✓ 연결됨
                                </button>
                              ) : (
                                <button
                                  onClick={() => setLinkInvoice(inv)}
                                  className="px-2 py-1 rounded text-[11px] font-semibold border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]/40 transition"
                                  title="통장 입출금 거래에 연결"
                                >
                                  연결
                                </button>
                              )}
                              {/*   프로젝트 짝 — 발행 완료 건에 어느 프로젝트 매출인지 붙인다 (2026-08-13 사장님).
                                    예전엔 상세 모달 깊숙한 셀렉트뿐이라 아무도 안 붙였다 — 줄에서 바로 제안한다. */}
                              {tab === "done" && (inv.deal_id ? (
                                <button
                                  onClick={() => setDealSuggest(inv)}
                                  className="inline-flex items-center gap-0.5 px-2 py-1 rounded text-[11px] font-semibold bg-green-500/12 text-green-600 hover:bg-green-500/20 transition"
                                  title={`프로젝트 연결됨: ${(inv as any).deals?.name || ""} — 클릭해 확인/해제`}
                                >
                                  ✓ 프로젝트
                                </button>
                              ) : (
                                <button
                                  onClick={() => setDealSuggest(inv)}
                                  className="px-2 py-1 rounded text-[11px] font-semibold border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]/40 transition"
                                  title="어느 프로젝트 매출인지 제안을 보고 붙입니다"
                                >
                                  프로젝트
                                </button>
                              ))}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {/* 홈택스식 합계 행 */}
                  <tfoot>
                    <tr className="font-bold text-[var(--text)] border-t-2 border-[var(--border)] bg-[var(--bg-surface)]">
                      <td className="px-2 py-2.5" />
                      <td colSpan={3} className="px-3 py-2.5 border-l border-[var(--border)]/40">합계 ({tiFiltered.length.toLocaleString("ko")}건)</td>
                      <td className="px-3 py-2.5 text-right mono-number border-l border-[var(--border)]/40">{currentList.reduce((s: number, inv: any) => s + Number(inv.supply_amount || 0), 0).toLocaleString("ko")}</td>
                      <td className="px-3 py-2.5 text-right mono-number border-l border-[var(--border)]/40">{currentList.reduce((s: number, inv: any) => s + Number(inv.tax_amount || 0), 0).toLocaleString("ko")}</td>
                      <td className="px-3 py-2.5 text-right mono-number border-l border-[var(--border)]/40 text-[var(--primary)]">{currentList.reduce((s: number, inv: any) => s + Number(inv.total_amount || 0), 0).toLocaleString("ko")}</td>
                      <td colSpan={tab === "done" ? 3 : 2} className="border-l border-[var(--border)]/40" />
                    </tr>
                  </tfoot>
                </table>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── 발행 현황 — 이카운트 「매출(세금)계산서요약」 형태 (2026-08-13 사장님 지시) ──
             줄을 누르면 그 목록으로 간다. 수집·전표의 '수집 현황'과 같은 자리·같은 규칙. */}
      {tab === "issue-status" && (<>
        <div className="ev-scroll">
        {/*   중복 의심 상세 — 결과 줄의 '확인하기'로 연다. 같은 거래처·금액·일자를 두 번 끊는
              사고는 발행 화면에서 봐야 의미가 있어 여기 둔다. 옛 '처리할 것' 주황 바는
              결과 줄로 녹였다(2026-08-13 사장님 지적 — 낡은 구조가 상자 위에 떠 있었다).
              작성 중·홈택스 미발행 항목은 뺐다: 발행 대기 탭과 아래 미전송 줄이 그 자리다. */}
        {checkOpen && liveDups.length > 0 && (
          <div className="ti-dups no-print">
            {liveDups.map((dup) => {
              const dupInvs = invoices.filter((inv: any) => dup.ids.includes(inv.id));
              return (
                <div key={dup.key} className="ti-dup">
                  <div className="ti-dup-head">
                    {dup.counterpartyName} · {fmt(dup.amount)} · {dup.date}
                    <span className="ti-dup-n">{dup.count}건 동일</span>
                    <button type="button" className="ti-dup-ok"
                      onClick={async () => {
                        setDismissedDups((prev) => new Set([...prev, dup.key]));
                        try {
                          await (supabase as any).from("tax_dup_dismissals").upsert(
                            { company_id: companyId, dup_key: dup.key, dismissed_by: userId ?? null },
                            { onConflict: "company_id,dup_key" });
                        } catch { /* 저장 실패해도 이 세션에선 숨김 유지 — 다음 로드에서 다시 뜬다 */ }
                      }}>
                      ✓ 중복 아님
                    </button>
                  </div>
                  {dupInvs.map((inv: any) => (
                    <div key={inv.id} className="ti-dup-row">
                      <span className="ti-dup-who">{inv.counterparty_name}</span>
                      <span className="mono-number">{fmt(Number(inv.supply_amount))}</span>
                      <span className="ev-dim">{inv.issue_date}</span>
                      <span className="ev-dim">{invoiceStatusMeta(inv.status, inv.type).label}</span>
                      <span className="ti-dup-acts">
                        <button type="button" className="btn-secondary btn-sm" onClick={() => setSelectedInvoice(inv)}>상세</button>
                        <button type="button" className="btn-danger-solid btn-sm" onClick={async () => {
                          const { ok: rowOk } = await confirmDialog({ title: "세금계산서 삭제", desc: `${inv.counterparty_name} / ₩${Number(inv.total_amount).toLocaleString()}`, danger: true });
                          if (!rowOk) return;
                          const { error: delErr } = await supabase.from("tax_invoices").delete().eq("id", inv.id);
                          if (delErr) { toast(`삭제 실패: ${delErr.message}`, "error"); return; }
                          invalidate();
                          toast("세금계산서가 삭제되었습니다", "success");
                        }}>삭제</button>
                      </span>
                    </div>
                  ))}
                </div>
              );
            })}
          </div>
        )}
        <div className="ti-sum">
          <table className="ev-table ti-sum-table">
            <thead>
              <tr>
                <th className="th-l">종류</th><th className="th-l">구분</th>
                <th className="th-c">건수</th><th className="th-c">공급가액 계</th><th className="th-c">부가세계</th>
                <th className="th-c" />
              </tr>
            </thead>
            <tbody>
              {(() => {
                const S = issueSummary;
                const money = (n: number) => n === 0 ? "—" : n.toLocaleString("ko");
                const cnt = (n: number) => n === 0 ? "0" : n.toLocaleString("ko");
                const row = (kind: string, label: string, a: { n: number; supply: number; tax: number },
                             go?: { text: string; on: () => void }, danger?: boolean) => (
                  <tr key={kind + label} className={a.n === 0 ? "ti-sum-nil" : go ? "ti-sum-go" : undefined}
                    onClick={a.n > 0 && go ? go.on : undefined}>
                    <td className="ti-sum-kind">{kind}</td>
                    <td className={danger && a.n > 0 ? "ti-sum-item ti-sum-bad" : "ti-sum-item"}>{label}</td>
                    <td className="tr mono-number">{cnt(a.n)}</td>
                    <td className="tr mono-number">{money(a.supply)}</td>
                    <td className="tr mono-number">{money(a.tax)}</td>
                    <td className="tc">{a.n > 0 && go ? <span className="ti-sum-link">{go.text} →</span> : null}</td>
                  </tr>
                );
                const sub = (label: string, a: { n: number; supply: number; tax: number }) => (
                  <tr key={"sub" + label} className="ti-sum-sub">
                    <td colSpan={2}>{label}</td>
                    <td className="tr mono-number">{cnt(a.n)}</td>
                    <td className="tr mono-number">{money(a.supply)}</td>
                    <td className="tr mono-number">{money(a.tax)}</td>
                    <td />
                  </tr>
                );
                const toWait = { text: "보내기", on: () => setTab("wait") };
                return (
                  <>
                    {row("종이", "종이(세금)계산서", S.paper)}
                    {sub("종이 계", S.paper)}

                    {row("미전송", "미발행", S.unsent.draft, toWait)}
                    {row("", "전송대기", S.unsent.pending, toWait)}
                    {/*   전송중 — CODEF 즉시전송 버그로 sendToNtsYn="N" 이라 팝빌 등록 후
                          **다음 영업일**에 국세청으로 간다. 하루 넘게 머무는 실재하는 구간이다. */}
                    {row("", "전송중", S.unsent.pending, toWait)}
                    {row("", "오류", S.unsent.failed, { text: "사유 보기", on: () => setTab("wait") }, true)}
                    {sub("미전송 계", S.unsent.total)}

                    {row("전송완료", "전자(세금)계산서", S.sent.plain, { text: "보기", on: () => setTab("done") })}
                    {S.sent.byReason.map((r) => row("", r.label, r, { text: "보기", on: () => setTab("done") }))}
                    {sub("전송완료 계", S.sent.total)}

                    {row("타발행", "타발행 (홈택스에서 직접)", S.others,
                      { text: "수집·전표", on: () => router.push("/collect?tab=tax_invoice") })}
                    {sub("타발행 계", S.others)}

                    {row("기한후발행", "기한후발행", S.late, { text: "보기", on: () => setTab("done") }, true)}
                    {sub("기한후발행 계", S.late)}
                  </>
                );
              })()}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={2}>합계</td>
                <td className="tr mono-number">{issueSummary.all.n.toLocaleString("ko")}</td>
                <td className="tr mono-number">{issueSummary.all.supply.toLocaleString("ko")}</td>
                <td className="tr mono-number">{issueSummary.all.tax.toLocaleString("ko")}</td>
                <td />
              </tr>
            </tfoot>
          </table>
          <p className="ti-sum-note">
            매출 기준입니다 — 매입 계산서는 상대가 발행하므로 오너뷰가 보낼 수 없습니다.
            <b>타발행</b>은 홈택스에서 직접 낸 것으로, 목록은 수집·전표에서 봅니다(합계를 맞추려고 여기 함께 적습니다).
          </p>
        </div>
        </div>
      </>)}

        </QueryBody>

        {/*   기본 50줄 — 줄 수는 검색조건 안에서 고른다 (조회 화면 표준) */}
        {isListTab && (
          <Pager page={tiPager.page} pages={tiPager.pages} total={tiFiltered.length} size={live.size}
            from={tiPager.from} to={tiPager.to} onPage={tiPager.setPage} />
        )}
      </QueryScreen>

      {/* Registration Form — 2026-06-12 인라인 카드 → 중앙 팝업(모달) 전환. 폼/등록 로직 무변경 */}
      {showBulkIssue && companyId && (
        <TaxInvoiceBulkIssueModal companyId={companyId} onClose={() => setShowBulkIssue(false)} />
      )}
      {/* 세금계산서 쓰기 — 2026-08-10 전면 개편 (사장님 지시).
          · 계산서 한 장 = 거래처 한 곳 + **품목 여러 줄**. 예전 [+ 항목 추가]는 계산서를 한 장 더
            만드는 버튼이라 품목 줄을 늘릴 방법이 아예 없었다.
          · 거래처 정보(대표자·업태/종목·주소·받을 이메일)를 국세청 서식대로 **좌 공급자 / 우 공급받는자**
            로 펼친다 — 발행 때 빈칸으로 나가는 걸 입력 단계에서 알 수 있게.
          · 여러 장 모드는 표를 유지하되 사업자번호·대표자까지만 보여 준다(그 이상은 표가 감당 못 함). */}
      {showForm && (
        <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4">
        <div className="tax-invoice-registration-modal" onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between gap-3 px-6 py-4 border-b border-[var(--border)] shrink-0 flex-wrap">
            <div>
              <h3 className="text-base font-bold">세금계산서 쓰기</h3>
              <p className="text-[11px] text-[var(--text-dim)] mt-0.5">
                {formMode === "single"
                  ? "계산서 한 장 — 품목은 몇 줄이든 넣을 수 있습니다"
                  : "한 줄이 계산서 한 장 — 품목이 여러 줄인 계산서는 ‘한 장 쓰기’로"}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <div className="seg-bar">
                <button type="button" onClick={() => setFormMode("single")} className={`seg-item ${formMode === "single" ? "seg-item-active" : ""}`}>한 장 쓰기</button>
                <button type="button" onClick={() => setFormMode("multi")} className={`seg-item ${formMode === "multi" ? "seg-item-active" : ""}`}>여러 장 한꺼번에</button>
              </div>
              <button onClick={() => setShowForm(false)} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none transition" aria-label="닫기">✕</button>
            </div>
          </div>

          <div className="flex-1 overflow-auto px-6 py-4">
            {formMode === "single" ? (() => {
              const row = rows[0];
              const supply = rowSupply(row);
              const taxAmt = row.taxKind === "taxable" ? Math.round(supply * 0.1) : 0;
              const missing = missingBuyerFields(row);
              return (
                <div className="tax-form-single">
                  {/* 머리 — 유형 · 작성일자 · 거래처 찾기 */}
                  <div className="tax-form-head">
                    <div className="tax-form-field">
                      <label>유형</label>
                      <div className="seg-bar w-fit">
                        {INVOICE_TYPES.map((t) => (
                          <button key={t.value} type="button" onClick={() => patchRow(row.key, { type: t.value as "sales" | "purchase" })}
                            className={`seg-item ${row.type === t.value ? "seg-item-active" : ""}`}>{t.label}</button>
                        ))}
                      </div>
                    </div>
                    <div className="tax-form-field">
                      <label>작성일자 <i>*</i></label>
                      <DateField value={row.issueDate} max="9999-12-31"
                        onChange={(e) => {
                          const parts = e.target.value.split("-");
                          if (parts[0] && parts[0].length > 4) parts[0] = parts[0].slice(0, 4);
                          patchRow(row.key, { issueDate: parts.join("-") });
                        }}
                        className="field-input w-full px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs" />
                    </div>
                    <div className="tax-form-field relative">
                      <label>거래처 찾기 <i>*</i></label>
                      <input
                        value={row.counterpartyName}
                        onChange={(e) => { patchRow(row.key, { counterpartyName: e.target.value, partnerId: "" }); setDropdownRowKey(row.key); }}
                        onFocus={() => { if (row.counterpartyName) setDropdownRowKey(row.key); }}
                        onBlur={() => setTimeout(() => setDropdownRowKey((k) => (k === row.key ? null : k)), 200)}
                        placeholder="상호 · 사업자번호로 검색"
                        className="field-input w-full px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)] transition" />
                      {dropdownRowKey === row.key && filterPartners(row.counterpartyName).length > 0 && (
                        <div className="tax-form-partner-drop">
                          {filterPartners(row.counterpartyName).slice(0, 10).map((p: any) => (
                            <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()}
                              onClick={() => { applyPartner(row.key, p); setDropdownRowKey(null); }}
                              className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] text-xs">
                              <div className="flex items-center justify-between gap-2">
                                <span className="font-medium truncate">{p.name}</span>
                                {p.business_number && <span className="caption shrink-0">{p.business_number}</span>}
                              </div>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  {/* 국세청 서식대로 — 왼쪽 공급자(우리), 오른쪽 공급받는자(거래처) */}
                  <div className="tax-party-grid">
                    <div className="tax-party">
                      <div className="tax-party-head"><b>공급자</b><span>회사 설정에서 관리</span></div>
                      <div className="tax-party-row"><span>등록번호</span><em>{companyInfo?.business_number || "—"}</em></div>
                      <div className="tax-party-row"><span>상호</span><em>{companyInfo?.name || "—"}</em></div>
                      <div className="tax-party-row"><span>대표자</span><em>{companyInfo?.representative || "—"}</em></div>
                      <div className="tax-party-row"><span>업태 / 종목</span><em>{[companyInfo?.business_type, companyInfo?.business_category].filter(Boolean).join(" / ") || "—"}</em></div>
                      <div className="tax-party-row"><span>사업장</span><em title={companyInfo?.address || ""}>{companyInfo?.address || "—"}</em></div>
                    </div>

                    <div className="tax-party tax-party-edit">
                      <div className="tax-party-head"><b>공급받는자</b><span>계산서에 그대로 찍히고 국세청으로 나갑니다</span></div>
                      <div className="tax-party-row">
                        <span>등록번호 <i>*</i></span>
                        <input value={row.counterpartyBizno} onChange={(e) => patchRow(row.key, { counterpartyBizno: e.target.value })}
                          placeholder="000-00-00000" className="tax-party-input" />
                      </div>
                      <div className="tax-party-row">
                        <span>상호 <i>*</i></span>
                        <input value={row.counterpartyName} onChange={(e) => patchRow(row.key, { counterpartyName: e.target.value })}
                          placeholder="상호" className="tax-party-input" />
                      </div>
                      <div className={`tax-party-row ${!row.counterpartyRepresentative.trim() ? "tax-party-miss" : ""}`}>
                        <span>대표자 <i>*</i></span>
                        <input value={row.counterpartyRepresentative} onChange={(e) => patchRow(row.key, { counterpartyRepresentative: e.target.value })}
                          placeholder="대표자명" className="tax-party-input" />
                      </div>
                      <div className={`tax-party-row ${!row.counterpartyBusinessType.trim() && !row.counterpartyBusinessItem.trim() ? "tax-party-miss" : ""}`}>
                        <span>업태 / 종목</span>
                        <div className="flex gap-1.5 min-w-0">
                          <input value={row.counterpartyBusinessType} onChange={(e) => patchRow(row.key, { counterpartyBusinessType: e.target.value })}
                            placeholder="업태" className="tax-party-input" />
                          <input value={row.counterpartyBusinessItem} onChange={(e) => patchRow(row.key, { counterpartyBusinessItem: e.target.value })}
                            placeholder="종목" className="tax-party-input" />
                        </div>
                      </div>
                      <div className="tax-party-row">
                        <span>사업장</span>
                        <input value={row.counterpartyAddress} onChange={(e) => patchRow(row.key, { counterpartyAddress: e.target.value })}
                          placeholder="사업장 주소" className="tax-party-input" />
                      </div>
                      <div className={`tax-party-row ${!row.counterpartyEmail.trim() ? "tax-party-miss" : ""}`}>
                        <span>받을 이메일 <i>*</i></span>
                        <input value={row.counterpartyEmail} onChange={(e) => patchRow(row.key, { counterpartyEmail: e.target.value })}
                          placeholder="이 주소로 계산서가 갑니다" className="tax-party-input" />
                      </div>
                      <label className="tax-party-save" title="켜 두면 이 거래처 정보가 갱신돼 다음 발행부터 자동으로 채워집니다">
                        <input type="checkbox" checked={savePartnerInfo} onChange={(e) => setSavePartnerInfo(e.target.checked)}
                          className="accent-[var(--primary)]" disabled={!row.partnerId} />
                        고친 내용을 <b>거래처 정보에도 저장</b>
                        {!row.partnerId && <span className="text-[var(--text-dim)]">— 등록된 거래처를 골랐을 때만</span>}
                      </label>
                    </div>
                  </div>

                  {missing.length > 0 && (
                    <div className="tax-form-ready">
                      <b>발행에 필요한 항목 {missing.length}개가 비었습니다</b>
                      {/*  빠진 항목에 맞는 말만 한다 — 이메일이 있는데 "메일을 못 받습니다" 라고 하면 거짓말이 된다 */}
                      <span>
                        {missing.join(" · ")} — 지금 발행하면 국세청에 빈칸으로 나갑니다.
                        {missing.includes("받을 이메일") && " 거래처는 계산서를 메일로 받지 못합니다."}
                      </span>
                    </div>
                  )}

                  {/* 품목 줄 */}
                  <div className="tax-form-field">
                    <label>품목 <i>*</i></label>
                    <div className="tax-items">
                      <div className="tax-items-scroll">
                        <div className="tax-items-grid">
                          <div className="tax-item-row tax-item-head">
                            <span />
                            <span>품목명</span><span>규격</span>
                            <span className="text-right">수량</span><span className="text-right">단가</span><span className="text-right">공급가액</span>
                            <span />
                          </div>
                          {row.items.map((it, i) => (
                            <div key={it.key} className="tax-item-row">
                              <span className="tax-item-no">{i + 1}</span>
                              <input value={it.name} onChange={(e) => patchItem(row.key, it.key, { name: e.target.value })}
                                onKeyDown={(e) => onItemKeyDown(e, row.key, it.key)}
                                onPaste={(e) => onItemPaste(e, row.key, it.key)}
                                placeholder="품목명" className="tax-item-input" />
                              <input value={it.spec} onChange={(e) => patchItem(row.key, it.key, { spec: e.target.value })}
                                onKeyDown={(e) => onItemKeyDown(e, row.key, it.key)}
                                placeholder="규격" className="tax-item-input" />
                              <input value={it.qty} onChange={(e) => patchItem(row.key, it.key, { qty: e.target.value })}
                                onKeyDown={(e) => onItemKeyDown(e, row.key, it.key)}
                                inputMode="decimal" placeholder="1" className="tax-item-input text-right" />
                              <CurrencyInput value={it.unitCost} onValueChange={(raw: string) => patchItem(row.key, it.key, { unitCost: raw })}
                                allowNegative placeholder="0" className="tax-item-input text-right" />
                              <span className="tax-item-sum">{itemSupply(it).toLocaleString("ko-KR")}</span>
                              <button type="button" onClick={() => removeItem(row.key, it.key)} title="이 품목 줄 지우기"
                                className="tax-item-del">✕</button>
                            </div>
                          ))}
                        </div>
                      </div>
                      <div className="tax-items-foot">
                        <button type="button" onClick={() => addItem(row.key)} className="btn-secondary btn-sm">+ 품목 줄</button>
                        <span className="text-[11px] text-[var(--text-dim)]">
                          엑셀에서 여러 줄을 <b className="text-[var(--text-muted)]">그대로 붙여넣기</b> 할 수 있습니다 · 마지막 칸에서 Tab 을 누르면 새 줄
                        </span>
                      </div>
                      {/*   공급대가(부가세 포함 합계)만 알 때 공급가액을 역산해 첫 품목 단가에 넣는다 (2026-08-31 사장님).
                            과세만 — 영세율·면세는 부가세가 없어 공급대가=공급가액이라 나눌 게 없다. */}
                      {row.taxKind === "taxable" && (
                        <GrossSplitCalc onApply={(sup) => patchItem(row.key, row.items[0].key, { qty: "1", unitCost: String(sup) })} />
                      )}
                    </div>
                  </div>

                  {/* 합계 — 품목 줄 수는 표에서 이미 보이므로 금액만 (2026-08-10 사장님) */}
                  <div className="tax-form-totals">
                    <div><small>공급가액</small><b>{fmt(supply)}</b></div>
                    <div><small>세액 {row.taxKind === "taxable" ? "(10%)" : "(영세율·면세)"}</small><b>{fmt(taxAmt)}</b></div>
                    <span className="tax-form-totals-sp" />
                    <div className="tax-form-grand"><small>합계</small><b>{fmt(supply + taxAmt)}</b></div>
                  </div>

                  {/* 자세히 — 기본값으로 두어도 되는 것들 */}
                  <details className="tax-form-more">
                    <summary>
                      <span><b>자세히</b> 과세유형 · 영수/청구 · 연결 프로젝트 · 비목</span>
                      <span className="text-[var(--text-dim)]">
                        {row.taxKind === "taxable" ? "과세" : row.taxKind === "zero_rated" ? "영세율" : "면세"} · {row.purpose} · {row.dealId ? (dealsForLink.find((d: any) => d.id === row.dealId)?.name || "연결됨") : "미연결"}
                      </span>
                    </summary>
                    <div className="tax-form-more-grid">
                      <div className="tax-form-field">
                        <label>과세유형</label>
                        {/*   고를 수 있는 것만 남긴다 — 과세사업자에게 '면세'를 보여 주면
                              누를 수 있다는 뜻이 되고, 실제로 발행하면 안 되는 문서가 만들어진다 */}
                        <select value={row.taxKind} onChange={(e) => patchRow(row.key, { taxKind: e.target.value as FormRow["taxKind"] })}
                          className="field-input w-full px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                          {taxKindOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                        </select>
                      </div>
                      <div className="tax-form-field">
                        <label>영수/청구</label>
                        <select value={row.purpose} onChange={(e) => patchRow(row.key, { purpose: e.target.value as "영수" | "청구" })}
                          className="field-input w-full px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                          <option value="청구">청구</option><option value="영수">영수</option>
                        </select>
                      </div>
                      <div className="tax-form-field">
                        <label>연결 프로젝트</label>
                        <select value={row.dealId} onChange={(e) => patchRow(row.key, { dealId: e.target.value })}
                          className="field-input w-full px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                          <option value="">미연결</option>
                          {dealsForLink.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
                        </select>
                      </div>
                      <div className="tax-form-field">
                        <label>비목</label>
                        <select value={row.expenseCategory} onChange={(e) => patchRow(row.key, { expenseCategory: e.target.value })}
                          className="field-input w-full px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs">
                          <option value="">선택하세요</option>
                          {EXPENSE_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
                        </select>
                      </div>
                    </div>
                  </details>
                </div>
              );
            })() : (
              /* 여러 장 한꺼번에 — 사업자번호·대표자까지만 보여 준다 (2026-08-10 사장님) */
              <div className="min-w-[860px]">
                <div className="tax-multi-row tax-multi-head">
                  <span />
                  <span>유형</span><span>작성일자 *</span><span>거래처 *</span><span>사업자번호</span><span>대표자</span>
                  <span>품목명</span><span className="text-right">수량</span><span className="text-right">단가</span><span className="text-right">합계</span>
                  <span />
                </div>
                {rows.map((row, i) => {
                  const supply = rowSupply(row);
                  const taxAmt = row.taxKind === "taxable" ? Math.round(supply * 0.1) : 0;
                  return (
                    <Fragment key={row.key}>
                    <div className="tax-multi-row">
                      <span className="tax-item-no">{i + 1}</span>
                      <select value={row.type} onChange={(e) => patchRow(row.key, { type: e.target.value as "sales" | "purchase" })}
                        className="tax-item-input">
                        {INVOICE_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
                      </select>
                      <DateField value={row.issueDate} max="9999-12-31"
                        onChange={(e) => {
                          const parts = e.target.value.split("-");
                          if (parts[0] && parts[0].length > 4) parts[0] = parts[0].slice(0, 4);
                          patchRow(row.key, { issueDate: parts.join("-") });
                        }}
                        className="tax-item-input" />
                      <div className="relative">
                        <input value={row.counterpartyName}
                          onChange={(e) => { patchRow(row.key, { counterpartyName: e.target.value, partnerId: "" }); setDropdownRowKey(row.key); }}
                          onFocus={() => { if (row.counterpartyName) setDropdownRowKey(row.key); }}
                          onBlur={() => setTimeout(() => setDropdownRowKey((k) => (k === row.key ? null : k)), 200)}
                          placeholder="거래처 검색" className="tax-item-input w-full" />
                        {dropdownRowKey === row.key && filterPartners(row.counterpartyName).length > 0 && (
                          <div className="tax-form-partner-drop">
                            {filterPartners(row.counterpartyName).slice(0, 10).map((p: any) => (
                              <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()}
                                onClick={() => { applyPartner(row.key, p); setDropdownRowKey(null); }}
                                className="w-full text-left px-3 py-2 hover:bg-[var(--bg-surface)] text-xs">
                                <div className="flex items-center justify-between gap-2">
                                  <span className="font-medium truncate">{p.name}</span>
                                  {p.business_number && <span className="caption shrink-0">{p.business_number}</span>}
                                </div>
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                      {/*  사업자번호·대표자는 거래처에서 따라오는 읽기 전용 표시 — 비면 붉게 알린다 */}
                      <span className={`tax-multi-ro ${!row.counterpartyBizno ? "tax-multi-ro-miss" : ""}`} title={row.counterpartyBizno || "비어 있음"}>
                        {row.counterpartyBizno || "비어 있음"}
                      </span>
                      <span className={`tax-multi-ro ${!row.counterpartyRepresentative ? "tax-multi-ro-miss" : ""}`} title={row.counterpartyRepresentative || "비어 있음"}>
                        {row.counterpartyRepresentative || "비어 있음"}
                      </span>
                      <input value={row.items[0]?.name || ""} onChange={(e) => patchItem(row.key, row.items[0].key, { name: e.target.value })}
                        placeholder="품목명" className="tax-item-input" />
                      <input value={row.items[0]?.qty || ""} onChange={(e) => patchItem(row.key, row.items[0].key, { qty: e.target.value })}
                        inputMode="decimal" placeholder="1" className="tax-item-input text-right" />
                      {/*   allowNegative (2026-08-31 사장님) — 수정세금계산서·환입 등 마이너스 계산서를 여러 장에서도.
                            🧮 = 공급대가(부가세 포함)로 이 줄 단가 역산 — 한 장 쓰기의 계산기와 동일 부품 */}
                      <div className="relative">
                        <CurrencyInput value={row.items[0]?.unitCost || ""} onValueChange={(raw: string) => patchItem(row.key, row.items[0].key, { unitCost: raw })}
                          allowNegative placeholder="0" className="tax-item-input tax-unitcost-input text-right w-full" />
                        <button type="button" title="공급대가(부가세 포함)로 단가 계산"
                          onClick={() => setCalcRowKey((k) => (k === row.key ? null : row.key))}
                          className={`absolute right-1 top-1/2 -translate-y-1/2 text-[11px] font-semibold leading-none text-[var(--primary)] ${calcRowKey === row.key ? "opacity-100" : "opacity-60 hover:opacity-100"}`}>계산</button>
                      </div>
                      <span className="tax-item-sum">{(supply + taxAmt).toLocaleString("ko-KR")}</span>
                      <button type="button" onClick={() => removeRow(row.key)} title="이 계산서 줄 지우기" className="tax-item-del">✕</button>
                    </div>
                    {calcRowKey === row.key && (
                      <GrossSplitCalc applyLabel="이 줄 단가로 넣기"
                        onApply={(sup) => { patchItem(row.key, row.items[0].key, { unitCost: String(sup), qty: row.items[0]?.qty || "1" }); setCalcRowKey(null); }} />
                    )}
                    </Fragment>
                  );
                })}
                <div className="tax-items-foot">
                  <button type="button" onClick={() => setRows((rs) => [...rs, blankRow()])} className="btn-secondary btn-sm">+ 계산서 줄</button>
                  <span className="text-[11px] text-[var(--text-dim)]">
                    업태/종목 · 주소 · 이메일은 <b className="text-[var(--text-muted)]">거래처 정보 그대로</b> 등록됩니다 — 고쳐야 하면 ‘한 장 쓰기’로
                  </span>
                </div>
              </div>
            )}
          </div>

          <div className="flex items-center justify-between gap-3 px-6 py-3.5 border-t border-[var(--border)] shrink-0 flex-wrap">
            <div className="text-xs text-[var(--text-muted)]">
              {formMode === "single" ? (
                <>품목 <b className="text-[var(--text)]">{rows[0].items.filter((it) => it.name.trim()).length}줄</b></>
              ) : (
                <>계산서 <b className="text-[var(--text)]">{validRowCount}장</b> · 합계 <b className="mono-number text-[var(--primary)]">{fmt(rows.filter(isRowValid).reduce((s, r) => { const sp = rowSupply(r); return s + sp + (r.taxKind === "taxable" ? Math.round(sp * 0.1) : 0); }, 0))}</b></>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setShowForm(false)} className="btn-secondary text-xs">취소</button>
              <button onClick={() => canSubmit && createMut.mutate()} disabled={!canSubmit || createMut.isPending}
                className="btn-primary text-xs disabled:opacity-50 disabled:cursor-not-allowed">
                {createMut.isPending ? "등록 중..." : formMode === "single" ? "등록" : `${validRowCount}장 등록`}
              </button>
            </div>
          </div>
        </div>
        </div>
      )}

      {/*   가져오기(홈택스 수집·연동 정지)는 UI에서 내렸다 (2026-08-13 사장님 — 우측은
            수집·전표처럼 엑셀·AI 제안·발행 3버튼). 수집은 수집·전표 소관이다.
            코드는 되돌릴 수 있게 보존 — 다시 켜려면 이 블록을 조회 줄로 옮기면 된다. */}
      {false && (<div>
    {/* 가져오기·내보내기 — 가끔 쓰는 일들을 한 곳에 모았다 */}
              <ToolbarPopover label="가져오기" title="가져오기 · 내보내기" width={232}>
                {(close) => (
                  <>
                    {!isHometaxConnected ? (
                      <Link href="/settings?tab=bank" className="toolbar-pop-item" onClick={close}>
                        홈택스 연결 필요 (설정 &gt; 은행연동)
                      </Link>
                    ) : (
                      <ToolbarPopoverItem
                        onClick={() => { close(); hometaxCd.run(() => runHometaxSyncBackground(viewFromMonth, viewToMonth)); }}
                        disabled={!!activeJobId || hometaxCd.disabled}
                        hint={hometaxCd.hint
                          ? hometaxCd.hint
                          : `조회기간(${viewFromMonth} ~ ${viewToMonth}) 범위로 홈택스에 이미 발행된 세금계산서를 가져옵니다${lastSyncData ? ` · 마지막 업데이트 ${new Date(lastSyncData).toLocaleString("ko", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}` : ""}`}>
                        <span aria-live="polite">
                          {activeJobId
                            ? `가져오는 중 ${(activeJob?.current_progress as any)?.done || 0}/${(activeJob?.current_progress as any)?.total || 0}`
                            : hometaxCd.disabled ? `홈택스에서 가져오기 (${hometaxCd.label})`
                            : "홈택스에서 가져오기"}
                        </span>
                      </ToolbarPopoverItem>
                    )}
                    <ToolbarPopoverItem onClick={() => { close(); setShowBulkIssue(true); }}
                      hint="엑셀 양식으로 여러 건을 한 번에 국세청 전자발행합니다">
                      엑셀 일괄발행
                    </ToolbarPopoverItem>
                    {isListTab && currentList.length > 0 && (
                      <ToolbarPopoverItem
                        onClick={async () => {
                          close();
                          const { exportTaxInvoicesDouzone } = await import("@/lib/export-douzone");
                          exportTaxInvoicesDouzone(currentList as any, `${viewFromMonth}_${viewToMonth}`);
                        }}
                        hint="현재 목록을 엑셀로 내보내기">
                        엑셀 내보내기
                      </ToolbarPopoverItem>
                    )}
                    <div className="toolbar-pop-sep" />
                    <ToolbarPopoverItem onClick={() => { close(); hometaxPauseMut.mutate(); }} disabled={hometaxPauseMut.isPending}
                      hint="홈택스 연동 잠시 멈추기 (30분) — 홈택스 사이트에 직접 로그인할 때 우리 앱의 동기화 로그인이 겹치는 것을 막습니다">
                      {isHometaxPaused
                        ? `연동 정지 해제 (${new Date(hometaxPausedUntil!).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}까지)`
                        : "홈택스 연동 정지"}
                    </ToolbarPopoverItem>
                    {activeJobId && (
                      <ToolbarPopoverItem danger onClick={() => { close(); forceClearStuckJob(activeJobId); }}
                        hint="백그라운드 동기화가 멈췄을 때 눌러 초기화 — 다시 시도할 수 있습니다">
                        동기화 취소
                      </ToolbarPopoverItem>
                    )}
                  </>
                )}
              </ToolbarPopover>
      </div>)}

      {/* 프로젝트 짝 제안 — 발행 완료 건 ↔ 딜 (2026-08-13). 제안은 자동, 확정은 사람 */}
      {dealSuggest && (
        <DealSuggestPopup invoice={dealSuggest} deals={dealsForLink as any[]}
          onClose={() => setDealSuggest(null)}
          onDone={() => {
            setDealSuggest(null);
            invalidateTaxInvoiceReaders(queryClient);   //   원장·미수·요약 등 파생 화면 일괄 (2026-08-31)
          }} />
      )}

      {/* 전송 전 확인 — 빠진 받는 쪽 정보를 채우고 보낸다 (2026-08-13, 4단계) */}
      {issueConfirm && (
        <IssueConfirmModal invoices={issueConfirm} partners={partners as any[]} vatBiz={vatBiz}
          onClose={() => setIssueConfirm(null)}
          onDone={() => {
            setIssueConfirm(null);
            setSelectedIds(new Set());
            invalidateTaxInvoiceReaders(queryClient);   //   원장·미수·요약 등 파생 화면 일괄 (2026-08-31)
          }} />
      )}

      {/* 일괄 전표처리 모달 — 선택된 세금계산서를 계정 1개로 일괄 기장(매출/매입 방향 자동) */}
      {showBulkVoucher && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowBulkVoucher(false)}>
          <div className="tax-invoice-bulk-voucher-modal" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <div className="text-sm font-bold text-[var(--text)]">일괄 전표처리</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-0.5">선택 {selectedVoucherable.length}건을 한 계정으로 전표 생성합니다. 이미 처리된 건은 건너뜁니다.</div>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">계정과목 *</label>
                <select value={bulkVoucherAccountId} onChange={(e) => setBulkVoucherAccountId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]">
                  <option value="">계정 선택</option>
                  {(coaAccounts as any[]).map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.code})</option>
                  ))}
                </select>
              </div>
              <div className="rounded-lg bg-amber-500/10 border border-amber-500/20 px-3 py-2 text-[10px] text-amber-600 leading-relaxed">
                매입은 <b>비용 계정</b>, 매출은 <b>수익 계정</b>의 의미가 다릅니다. 같은 유형(매출 또는 매입)끼리 선택해 처리하는 것을 권장합니다. 매입=차)선택비용+부가세대급금/대)외상매입금, 매출=차)외상매출금/대)선택수익+부가세예수금 으로 방향이 자동 결정됩니다.
              </div>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button onClick={() => setShowBulkVoucher(false)} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
              <button onClick={handleBulkVoucher} disabled={bulkVoucherPosting || !bulkVoucherAccountId}
                className="btn-primary btn-sm">
                {bulkVoucherPosting ? "처리 중..." : `${selectedVoucherable.length}건 전표 생성`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Invoice Detail Modal */}
      {selectedInvoice && (
        // 목록에서 같은 id 의 최신 행을 우선 — 상세 보강(주소·이메일)이 끝나면 열려 있는 모달도 바로 갱신된다.
        //   (열 때의 스냅샷만 쓰면 보강 결과가 화면에 반영되지 않았다 — 2026-08-05)
        <InvoiceDetailModal
          invoice={(invoices as any[]).find((r: any) => r.id === selectedInvoice.id) || selectedInvoice}
          companyInfo={companyInfo}
          partners={partners}
          issuanceStatus={issuanceStatus}
          deals={dealsForLink}
          onClose={() => setSelectedInvoice(null)}
          onModify={(inv: any) => {
            setSelectedInvoice(null);
            setModifyTarget(inv);
            setModifyReason("");
            setShowModifyModal(true);
          }}
        />
      )}

      {/* 거래매칭 — 통장 입출금 거래 인라인 연결 팝업 */}
      {linkInvoice && companyId && (
        <LinkTxPopup
          invoice={linkInvoice}
          companyId={companyId}
          onClose={() => setLinkInvoice(null)}
          onDone={() => { invalidate(); setLinkInvoice(null); }}
        />
      )}

      {/* Modification Modal */}
      {showModifyModal && modifyTarget && (
        <ModificationModal
          invoice={modifyTarget}
          reason={modifyReason}
          setReason={setModifyReason}
          modifyAmount={modifyAmount}
          setModifyAmount={setModifyAmount}
          onClose={() => { setShowModifyModal(false); setModifyTarget(null); setModifyAmount(""); }}
          onSubmit={async () => {
            try {
              await modifyTaxInvoice({
                invoiceId: modifyTarget.id,
                reason: modifyReason,
                newSupplyAmount: modifyAmount ? Number(modifyAmount) : undefined,
              });
              invalidate();
              setShowModifyModal(false);
              setModifyTarget(null);
              setModifyAmount("");
              // 초안 생성까지가 이 단계 — 국세청 전송은 목록에서 '발행'을 눌러야 한다(2026-08-03).
              toast("수정세금계산서 초안이 만들어졌습니다. 목록에서 '발행'을 눌러야 국세청에 전송됩니다.", "success");
            } catch (err: any) {
              toast(`오류: ${friendlyError(err, '수정세금계산서 생성 실패')}`, "error");
            }
          }}
        />
      )}

      {/* Queue Tab (자동발행 대기) */}
      {false && (
        <div className="tax-invoice-queue-tab">
          <div className="glass-card p-5 mb-2">
            <div className="text-xs text-[var(--text-muted)] leading-relaxed">
              <strong className="text-[var(--text)]">자동발행 큐</strong>: 프로젝트 매출 스케줄이 확정되면 세금계산서가 자동으로 큐에 등록됩니다.
              거래처 희망일이 설정된 경우 해당일까지 대기 후 발행됩니다. <span className="text-orange-400">승인 필요</span> 건은 확인 후 승인해주세요.
            </div>
          </div>

          {queueLoading ? (
            <div className="p-16 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
          ) : queueItems.length === 0 ? (
            <div className="glass-card py-16 px-6 text-center">
              <div className="empty-state-icon mx-auto"><Ico e="⚡" /></div>
              <div className="text-base font-semibold mb-1.5">대기 중인 자동발행 없음</div>
              <div className="text-xs text-[var(--text-muted)]">프로젝트의 매출 스케줄이 확정되면 여기에 표시됩니다</div>
            </div>
          ) : (
            <div className="glass-card overflow-hidden">
              <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
                <thead>
                  <tr className="table-head-row">
                    <th className="th-cell text-center">액션</th>
                    <th className="th-cell text-center">거래처</th>
                    <th className="th-cell text-center">금액</th>
                    <th className="th-cell text-center">발행일</th>
                    <th className="th-cell text-center">프로젝트</th>
                    <th className="th-cell text-center">상태</th>
                    <th className="th-cell text-center">비고</th>
                    <th className="th-cell text-center">승인</th>
                  </tr>
                </thead>
                <tbody>
                  {queueItems.map((q: any) => {
                    const p = q.payload || {};
                    return (
                      <tr key={q.id} className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)]">
                        <td className="px-5 py-3 text-xs">
                          <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            q.action === 'issue' ? 'bg-blue-500/10 text-blue-400'
                            : q.action === 'modify' ? 'bg-orange-500/10 text-orange-400'
                            : 'bg-red-500/10 text-red-400'
                          }`}>
                            {q.action === 'issue' ? '발행' : q.action === 'modify' ? '수정' : '취소'}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-sm font-medium max-w-[200px]"><span className="block truncate" title={p.counterparty_name || undefined}>{p.counterparty_name || '—'}</span></td>
                        <td className="px-5 py-3 text-sm text-right">{fmt(Number(p.total_amount || 0))}</td>
                        <td className="px-5 py-3 text-xs text-[var(--text-dim)]">{p.issue_date || '—'}</td>
                        <td className="px-5 py-3 text-xs text-[var(--text-muted)] max-w-[180px]"><span className="block truncate" title={(q as any).deals?.name || p.deal_name || undefined}>{(q as any).deals?.name || p.deal_name || '—'}</span></td>
                        <td className="px-5 py-3 text-center">
                          <span className={`text-xs px-2 py-0.5 rounded-full ${
                            q.status === 'needs_approval' ? 'bg-orange-500/10 text-orange-400'
                            : q.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400'
                            : q.status === 'processing' ? 'bg-blue-500/10 text-blue-400'
                            : 'bg-[var(--bg-surface)] text-[var(--text-muted)]'
                          }`}>
                            {q.status === 'needs_approval' ? '승인 필요' : q.status === 'pending' ? '대기' : q.status === 'processing' ? '처리중' : q.status}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-xs text-[var(--text-dim)]">{q.error_message || '—'}</td>
                        <td className="px-5 py-3 text-center">
                          {q.status === 'needs_approval' && userId && (
                            <button
                              onClick={async () => {
                                await approveQueueItem(q.id, userId);
                                queryClient.invalidateQueries({ queryKey: ["invoice-queue"] });
                              }}
                              className="px-3 py-1 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-lg text-xs font-semibold transition"
                            >
                              승인
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            </div>
          )}
        </div>
      )}

      {/* Sync Tab (홈택스 동기화) */}
      {false && (
        <div className="tax-invoice-sync-tab">
          {/* 미연결 상태 — 등록 가이드 */}
          {!isHometaxConnected && (
            <div className="bg-blue-500/10 border border-blue-500/30 rounded-2xl p-5 shadow-md">
              <div className="flex items-start gap-3">
                <div className="text-2xl"><Ico e="💡" /></div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-[var(--text)] mb-2">처음 사용하시나요? 홈택스 동기화 3단계 안내</div>
                  <ol className="space-y-2 text-xs text-[var(--text-muted)] leading-relaxed">
                    <li className="flex gap-2">
                      <span className="font-bold text-blue-500 flex-shrink-0">1.</span>
                      <span>
                        <Link href="/settings?tab=bank" className="text-blue-500 font-semibold hover:underline">설정 &gt; 은행연동</Link>
                        의 <strong>금융기관 연결 → 홈택스</strong>에서 사업자 인증정보를 먼저 등록하세요
                        (공동인증서 또는 ID/PW)
                      </span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-bold text-blue-500 flex-shrink-0">2.</span>
                      <span>이 페이지에서 <strong>시작/종료 월 선택 후 동기화</strong> 버튼을 누르면 매출/매입 세금계산서가 자동 조회됩니다</span>
                    </li>
                    <li className="flex gap-2">
                      <span className="font-bold text-blue-500 flex-shrink-0">3.</span>
                      <span>수집된 계산서는 <strong>계약 ↔ 세금계산서 ↔ 입금</strong> 3-Way 매칭으로 자동 검증됩니다 (매칭 탭에서 확인)</span>
                    </li>
                  </ol>
                  <div className="mt-3 text-[11px] text-[var(--text-dim)] bg-[var(--bg-surface)] rounded-lg px-3 py-2">
                    <Ico e="⚠" /> 공동인증서 로그인은 데스크톱 환경에서만 지원되며, 인증서 파일(.pfx)이 등록되어 있어야 합니다.
                    문제가 발생하면 <Link href="/guide" className="text-blue-500 hover:underline">가이드 페이지</Link>를 참고하세요.
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 연결됨 + 첫 동기화 전 — 시작 안내 */}
          {isHometaxConnected && syncLogs.length === 0 && invoices.length === 0 && (
            <div className="bg-emerald-500/10 border border-green-500/30 rounded-2xl p-5 shadow-md">
              <div className="flex items-start gap-3">
                <div className="text-2xl"><Ico e="✅" /></div>
                <div className="flex-1">
                  <div className="text-sm font-bold text-[var(--text)] mb-1">
                    홈택스 연결 완료
                    {hometaxConnection?.method === 'certificate' && <span className="ml-2 text-[10px] font-normal text-[var(--text-dim)]">(공동인증서)</span>}
                    {hometaxConnection?.method === 'id_pw' && <span className="ml-2 text-[10px] font-normal text-[var(--text-dim)]">(ID/PW)</span>}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    아래 <strong>시작/종료 월 선택 후 동기화 실행</strong> 버튼을 누르면 첫 매출/매입 세금계산서를 가져옵니다.
                    수집 후 자동으로 <strong>3-Way 매칭</strong>이 시작됩니다.
                  </div>
                </div>
              </div>
            </div>
          )}

          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold">홈택스 세금계산서 동기화</span>
                  {isHometaxConnected ? (
                    <span className="px-2 py-0.5 rounded-full bg-green-500/10 text-green-500 text-[10px] font-semibold border border-green-500/30">연결됨</span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-dim)] text-[10px] font-semibold border border-[var(--border)]">미연결</span>
                  )}
                </div>
                <div className="text-xs text-[var(--text-muted)] mt-1">
                  설정 &gt; 은행연동에 등록된 홈택스 인증정보로 매출/매입 세금계산서를 자동 조회합니다
                </div>
              </div>
              {/* 동기화 실행은 페이지 상단 [홈택스에서 가져오기] 버튼으로 통일 (중복 제거) */}
              <div className="text-[11px] text-[var(--text-muted)] bg-[var(--bg-surface)] rounded-lg px-3 py-2 max-w-[280px] leading-relaxed">
                동기화는 페이지 상단의 <strong className="text-[var(--primary)]">홈택스에서 가져오기</strong> 버튼으로 실행하세요. (기간·최신만·백그라운드 옵션 포함)
              </div>
            </div>

            {/* Automation flow diagram */}
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 mt-4">
              {[
                { icon: "🔑", title: "홈택스 로그인", desc: "ID/PW 또는 공동인증서" },
                { icon: "📥", title: "자동 조회", desc: "매출/매입 계산서 수집" },
                { icon: "🔄", title: "중복 제거", desc: "승인번호 기준 dedup" },
                { icon: "✅", title: "3-Way 매칭", desc: "계약↔계산서↔입금" },
              ].map((step, i) => (
                <div key={step.title} className="bg-[var(--bg-surface)] rounded-xl p-3 text-center relative">
                  <div className="text-xl mb-1"><Ico e={step.icon} /></div>
                  <div className="text-xs font-bold">{step.title}</div>
                  <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{step.desc}</div>
                  {i < 3 && <div className="hidden sm:block absolute right-[-10px] top-1/2 -translate-y-1/2 text-[var(--text-dim)]">→</div>}
                </div>
              ))}
            </div>
          </div>

          {/* Sync Logs */}
          <div className="glass-card overflow-hidden">
            <div className="px-5 py-3 border-b border-[var(--border)]">
              <span className="text-sm font-bold">동기화 이력</span>
            </div>
            {syncLogs.length === 0 ? (
              <div className="py-14 px-6 text-center">
                <div className="text-4xl mb-3"><Ico e="🔄" /></div>
                <div className="text-sm font-semibold text-[var(--text)]">아직 동기화 이력이 없습니다</div>
                <div className="text-xs text-[var(--text-muted)] mt-1">상단의 홈택스에서 가져오기 버튼으로 첫 동기화를 실행하세요</div>
              </div>
            ) : (
              <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[600px]">
                <thead>
                  <tr className="table-head-row">
                    <th className="text-center px-5 py-2 font-medium">유형</th>
                    <th className="text-center px-5 py-2 font-medium">상태</th>
                    <th className="text-center px-5 py-2 font-medium">조회</th>
                    <th className="text-center px-5 py-2 font-medium">신규</th>
                    <th className="text-center px-5 py-2 font-medium">일시</th>
                    <th className="text-center px-5 py-2 font-medium">오류</th>
                  </tr>
                </thead>
                <tbody>
                  {syncLogs.map((log: any) => (
                    <tr key={log.id} className="border-b border-[var(--border)]/50 text-xs">
                      <td className="px-5 py-2 font-medium">
                        {log.sync_type === 'fetch_sales' ? '매출 조회' : log.sync_type === 'fetch_purchase' ? '매입 조회' : log.sync_type === 'modify' ? '수정발행' : log.sync_type}
                      </td>
                      <td className="px-5 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full ${
                          log.status === 'completed' ? 'bg-green-500/10 text-green-400'
                          : log.status === 'failed' ? 'bg-red-500/10 text-red-400'
                          : 'bg-yellow-500/10 text-yellow-400'
                        }`}>
                          {log.status === 'completed' ? '완료' : log.status === 'failed' ? '실패' : '진행중'}
                        </span>
                      </td>
                      <td className="px-5 py-2 text-right">{log.invoices_fetched || 0}</td>
                      <td className="px-5 py-2 text-right font-bold text-green-400">{log.invoices_created || 0}</td>
                      <td className="px-5 py-2 text-[var(--text-dim)]">{log.completed_at ? new Date(log.completed_at).toLocaleString('ko') : '—'}</td>
                      <td className="px-5 py-2 text-red-400 truncate max-w-[150px]">{log.error_message || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {/* 계약 상세 팝업 모달 */}
      {matchDealPopup && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center p-4" onClick={() => setMatchDealPopup(null)}>
          <div className="tax-invoice-deal-match-popup glass-card" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
              <h3 className="text-sm font-bold">계약 ↔ 세금계산서 매칭 상세</h3>
              <button onClick={() => setMatchDealPopup(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg">&times;</button>
            </div>
            <div className="px-5 py-4 space-y-4">
              <div>
                <div className="text-[10px] text-[var(--text-dim)] uppercase mb-1">프로젝트</div>
                <div className="text-sm font-semibold">{matchDealPopup.dealName || "—"}</div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="bg-[var(--bg-surface)] rounded-xl p-3">
                  <div className="text-[10px] text-[var(--text-dim)] mb-1">계약금액</div>
                  <div className="text-base font-bold">₩{(matchDealPopup.contractAmount || 0).toLocaleString("ko-KR")}</div>
                </div>
                <div className="bg-[var(--bg-surface)] rounded-xl p-3">
                  <div className="text-[10px] text-[var(--text-dim)] mb-1">세금계산서 공급가액</div>
                  <div className="text-base font-bold">₩{(matchDealPopup.invoiceSupplyAmount || 0).toLocaleString("ko-KR")}</div>
                </div>
                <div className="bg-[var(--bg-surface)] rounded-xl p-3">
                  <div className="text-[10px] text-[var(--text-dim)] mb-1">부가세</div>
                  <div className="text-sm font-semibold">₩{(matchDealPopup.invoiceTaxAmount || 0).toLocaleString("ko-KR")}</div>
                </div>
                <div className="bg-[var(--bg-surface)] rounded-xl p-3">
                  <div className="text-[10px] text-[var(--text-dim)] mb-1">차액</div>
                  <div className={`text-sm font-semibold ${Math.abs(matchDealPopup.gap) < 1 ? "text-green-400" : "text-red-400"}`}>
                    {matchDealPopup.gap === 0 ? "0원 (일치)" : `₩${matchDealPopup.gap.toLocaleString("ko-KR")}`}
                  </div>
                </div>
              </div>
              <div className="flex gap-2">
                <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${matchDealPopup.amountMatch ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                  계약매칭 {matchDealPopup.amountMatch ? "✓" : "✗"}
                </span>
                <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${matchDealPopup.paymentMatch ? "bg-green-500/15 text-green-400" : "bg-orange-500/15 text-orange-400"}`}>
                  입금매칭 {matchDealPopup.paymentMatch ? "✓" : "✗"}
                </span>
                <span className={`px-2 py-1 rounded-lg text-xs font-semibold ${matchDealPopup.fullMatch ? "bg-green-500/15 text-green-400" : "bg-red-500/15 text-red-400"}`}>
                  전체매칭 {matchDealPopup.fullMatch ? "✓" : "✗"}
                </span>
              </div>
            </div>
            <div className="flex gap-2 px-5 py-3 border-t border-[var(--border)]">
              <Link href="/projects" className="flex-1 px-3 py-2 bg-[var(--bg-surface)] text-[var(--text-muted)] rounded-lg text-xs text-center hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] transition">
                프로젝트 페이지로 이동
              </Link>
              <button onClick={() => setMatchDealPopup(null)} className="flex-1 btn-primary btn-sm">
                닫기
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 부가세 · 기간별 집계는 **분석(/reports/vat)** 으로 옮겼다 (2026-08-13 사장님 지시).
//   세금·증빙이 '발행하는 곳'이 되면서, 매입 자료로 계산하는 신고용 화면은 성격이 안 맞는다.
//   컴포넌트 본체는 src/app/(app)/reports/vat/_components/VatReport.tsx 로 그대로 이사했다.

// ── 통장 거래 인라인 연결 팝업 (거래매칭) ──
//   목록의 '연결' 버튼 → 금액(±10%)·거래처가 맞는 미연결 입출금 거래를 골라 즉시 연결.
//   bank_transactions.tax_invoice_id 로 매칭(three-way-match 재사용). 매출=입금, 매입=출금 대응.
function LinkTxPopup({ invoice, companyId, onClose, onDone }: { invoice: any; companyId: string; onClose: () => void; onDone: () => void }) {
  const { toast } = useToast();
  const isSales = invoice.type === "sales";
  const isMatched = invoice.status === "matched";
  const [busy, setBusy] = useState(false);

  const { data: candidates = [], isLoading } = useQuery({
    queryKey: ["tx-link-candidates", invoice.id],
    queryFn: () => getThreeWayCandidates(companyId, {
      id: invoice.id, type: invoice.type, counterparty_name: invoice.counterparty_name,
      total_amount: Number(invoice.total_amount || 0), supply_amount: Number(invoice.supply_amount || 0),
      issue_date: invoice.issue_date, status: invoice.status, partner_id: invoice.partner_id ?? null,
    } as any),
    enabled: !isMatched,
  });

  // 이미 연결된 경우 — 현재 연결 거래 조회(해제용)
  const { data: linkedTx } = useQuery({
    queryKey: ["tx-linked", invoice.id],
    queryFn: async () => {
      const data = logRead('tax-invoices/page:data', await (supabase)
        .from("bank_transactions")
        .select("id, counterparty, amount, transaction_date, description, memo")
        .eq("company_id", companyId).eq("tax_invoice_id", invoice.id).limit(1).maybeSingle());
      return data;
    },
    enabled: isMatched,
  });

  const doLink = async (bankTxId: string) => {
    setBusy(true);
    try {
      await confirmThreeWayMatch(bankTxId, invoice.id);
      toast("통장 거래에 연결했습니다", "success");
      onDone();
    } catch (e: any) { toast(friendlyError(e, "연결 실패"), "error"); setBusy(false); }
  };
  const doUnlink = async () => {
    if (!linkedTx) return;
    setBusy(true);
    try {
      await unmatchInvoice(linkedTx.id, invoice.id);
      toast("연결을 해제했습니다", "success");
      onDone();
    } catch (e: any) { toast(friendlyError(e, "해제 실패"), "error"); setBusy(false); }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="tax-invoice-link-tx-popup glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)]">
          <div className="min-w-0">
            <div className="text-sm font-bold">통장 거래 연결</div>
            <div className="text-[11px] text-[var(--text-muted)] mt-0.5 truncate">
              {invoice.counterparty_name} · ₩{Number(invoice.total_amount || 0).toLocaleString()} · {invoice.issue_date} · {isSales ? "입금" : "출금"} 대응
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl shrink-0">&times;</button>
        </div>
        <div className="p-5 space-y-2">
          {isMatched ? (
            linkedTx ? (
              <div className="rounded-xl border border-green-500/30 bg-green-500/8 p-3">
                <div className="text-[11px] text-green-600 font-semibold mb-1">✓ 연결된 거래</div>
                <div className="text-sm text-[var(--text)]">{linkedTx.counterparty || "(상대 미상)"} · ₩{Number(linkedTx.amount || 0).toLocaleString()}</div>
                <div className="text-[11px] text-[var(--text-muted)]">{linkedTx.transaction_date} · {linkedTx.description || linkedTx.memo || ""}</div>
                <button onClick={doUnlink} disabled={busy} className="mt-2 px-3 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-500 hover:bg-red-500/20 disabled:opacity-50">연결 해제</button>
              </div>
            ) : (
              <div className="text-xs text-[var(--text-muted)] py-6 text-center">연결된 거래 정보를 찾을 수 없습니다 (이미 해제됨).</div>
            )
          ) : isLoading ? (
            <div className="text-xs text-[var(--text-muted)] py-8 text-center">후보 거래 조회 중...</div>
          ) : candidates.length === 0 ? (
            <div className="text-xs text-[var(--text-muted)] py-8 text-center leading-relaxed">
              금액(±10%)·거래처가 맞는 미연결 {isSales ? "입금" : "출금"} 거래가 없습니다.<br />통장 연동 후 다시 시도하세요.
            </div>
          ) : candidates.map((c: any) => (
            <div key={c.bankTxId} className="flex items-center justify-between gap-3 rounded-xl border border-[var(--border)] px-3 py-2.5 hover:border-[var(--primary)]/40 transition">
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[var(--text)] truncate">{c.bankCounterparty || "(상대 미상)"} · ₩{Number(c.bankAmount || 0).toLocaleString()}</div>
                <div className="text-[11px] text-[var(--text-muted)] truncate">{c.bankDate} · {c.reasons.join(" · ")}</div>
              </div>
              <button onClick={() => doLink(c.bankTxId)} disabled={busy}
                className="shrink-0 btn-primary btn-sm">연결</button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── Invoice Detail Modal (세금계산서 상세) ──
// 거래처 상세 보강이 회사 단위로 막힌 상태(CODEF 상품 미승인 등)를 기억한다.
//   모달마다 state 를 두면 계산서를 열 때마다 같은 실패를 다시 호출한다 — 모듈 스코프로 1회만.
//   새로고침하면 초기화되므로 상품 승인 후엔 자동으로 다시 시도된다.
const detailBlockedRef = { blocked: false, reason: "" };

function InvoiceDetailModal({ invoice, companyInfo, partners, deals, issuanceStatus, onClose, onModify }: { invoice: any; companyInfo?: any; partners?: any[]; deals?: any[]; issuanceStatus?: { limit: number | null; used: number; remaining: number | null; planName: string | null }; onClose: () => void; onModify: (inv: any) => void }) {
  const issuanceLimitReached = !!issuanceStatus && issuanceStatus.limit !== null && (issuanceStatus.remaining ?? 0) <= 0;
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const inv = invoice;
  const supplyAmt = Number(inv.supply_amount || 0);
  const taxAmt = Number(inv.tax_amount || 0);
  const totalAmt = Number(inv.total_amount || 0);
  const sc = invoiceStatusMeta(inv.status, inv.type);
  const [pdfLoading, setPdfLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [issueLoading, setIssueLoading] = useState(false);
  // 거래처 사업장 주소·이메일 자동 보강 (2026-08-05 사장님: "홈택스엔 다 있는데 왜 안 불러오냐").
  //   통합 목록 API 엔 주소·이메일이 없어 상세 API 로 이 건만 1회 조회한다.
  //   detail_fetched_at 이 찍힌 건은 다시 부르지 않는다(건당 과금 + 기관 IP 차단 경고).
  const [detailLoading, setDetailLoading] = useState(false);
  const detailTriedRef = useRef<string | null>(null);
  useEffect(() => {
    const id = invoice?.id;
    // 2026-08-05 재확인: 사업장 주소·이메일은 홈택스 **목록** 응답에 이미 들어 있고 동기화가 저장한다.
    //   (종전엔 필드명을 잘못 읽어 비어 보였을 뿐) → 유료·미승인인 상세 API 를 자동 호출할 이유가 없다.
    //   과거 건은 그 기간을 다시 동기화하면 채워진다. 상세 API 는 품목·원문 PDF 가 필요해질 때 되살린다.
    const AUTO_DETAIL_FETCH = false;
    if (!AUTO_DETAIL_FETCH) return;
    if (!id || invoice.detail_fetched_at || !invoice.nts_confirm_no) return;
    if (detailTriedRef.current === id) return;   // 한 번 시도한 건은 재시도 안 함(모달 재렌더 방지)
    // 상품 미승인(CF-00401/CF-00003)처럼 회사 단위로 영구 실패인 경우, 계산서를 열 때마다
    //   같은 실패를 반복 호출하지 않는다 — 2026-08-05 실측으로 헛호출이 쌓이던 것을 확인.
    if (detailBlockedRef.blocked) return;
    detailTriedRef.current = id;
    let alive = true;
    (async () => {
      setDetailLoading(true);
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (!session) return;
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/codef-sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ companyId: invoice.company_id, action: 'hometax-invoice-detail', invoiceId: id }),
        });
        const json = await res.json().catch(() => ({}));
        if (alive && res.ok && json?.ok && json.invoice) {
          // 목록 캐시를 갱신하면 열려 있는 상세도 새 값으로 다시 그려진다
          //   (키가 "tax-invoices" 가 아니라 "tax-invoices-full" 이라 종전엔 갱신이 안 됐다)
          invalidateTaxInvoiceReaders(queryClient);   //   원장·미수·요약 등 파생 화면 일괄 (2026-08-31)
        } else if (alive && !res.ok) {
          // 조용히 삼키면 왜 안 채워지는지 알 수 없다 — 사유를 눈에 보이게(2026-08-05 사장님 제보)
          const code = json?.code || "";
          if (code === "CF-00401" || code === "CF-00003") {
            // 회사 단위 영구 실패 — 이후 다른 계산서를 열어도 자동 호출하지 않는다(헛호출 방지)
            detailBlockedRef.blocked = true;
            detailBlockedRef.reason = json?.hint || json?.error || "";
          }
          toast(`${json?.error || `HTTP ${res.status}`}${json?.hint ? ` — ${json.hint}` : ""}`, "error");
        }
      } catch { /* 보강 실패는 조용히 — 기존 표시(명부 폴백) 유지 */ }
      finally { if (alive) setDetailLoading(false); }
    })();
    return () => { alive = false; };
  }, [invoice?.id, invoice?.detail_fetched_at, invoice?.nts_confirm_no, invoice?.company_id, queryClient]);
  const [registerLoading, setRegisterLoading] = useState(false);
  const [emailTo, setEmailTo] = useState('');
  const [showEmailForm, setShowEmailForm] = useState(false);
  // 계정과목(비목) — 상세에서 직접 지정, 손익계산서 매출원가/판관비 분류 기준
  const [expenseCat, setExpenseCat] = useState<string>(inv.expense_category || "");
  // 프로젝트(딜) 연결 — 상세에서 직접 선택 (사장님 요청 2026-07-14)
  const [dealId, setDealId] = useState<string>(inv.deal_id || "");
  const myCompany = companyInfo?.name || '(주)우리회사';
  const myBizNo = companyInfo?.business_number || '';
  const myRep = companyInfo?.representative || '';
  const myBizType = companyInfo?.business_type || '';
  const myBizCat = companyInfo?.business_category || '';

  // ── 홈택스 전자세금계산서 양식용 공급자/공급받는자 정리 ──
  //   매출: 공급자=우리회사, 공급받는자=거래처. 매입: 반대.
  const isSales = inv.type === 'sales';
  const issuedToNts = !!inv.nts_confirm_no; // 국세청 승인번호 보유 = 전송(발행)됨
  // 직원 QA 세금계산서2 — 사업자번호 XXX-XX-XXXXX 포맷 + 상호 "+"(공백 인코딩) → 공백 정규화
  const fmtBizNo = (b: string) => { const d = (b || '').replace(/[^0-9]/g, ''); return d.length === 10 ? `${d.slice(0, 3)}-${d.slice(3, 5)}-${d.slice(5)}` : (b || ''); };
  const cleanNm = (s: string) => (s || '').replace(/\+/g, ' ').trim();
  // 거래처 정보 보강: FK 조인(inv.partners)이 없으면(홈택스 동기화 건은 partner_id=null 다수)
  //   사업자번호로 거래처 명부에서 찾아 대표자명·업태·종목·이메일·주소를 복원한다.
  const cpBizDigits = (inv.counterparty_bizno || '').replace(/[^0-9]/g, '');
  const cpPartner = inv.partners
    || (cpBizDigits.length === 10
      ? (partners || []).find((p: any) => (p.business_number || '').replace(/[^0-9]/g, '') === cpBizDigits)
      : null);
  // 거래처(공급받는자/공급자) 필드 — 계산서에 저장된 값 우선, 없으면 명부(cpPartner)에서 폴백.
  const cpRep = cpPartner?.representative || inv.counterparty_representative || '';
  const cpBizType = inv.counterparty_business_type || cpPartner?.business_type || '';
  const cpBizCat = inv.counterparty_business_item || cpPartner?.business_item || '';
  const cpEmail = inv.counterparty_email || cpPartner?.contact_email || cpPartner?.email || '';
  // 주소는 홈택스 상세로 받은 사업장 주소를 우선 — 명부 주소는 회사가 임의 입력한 값이라 계산서 원본과 다를 수 있다.
  const cpAddr = inv.counterparty_address || cpPartner?.address || '';
  const supplier = {
    bizNo: fmtBizNo(isSales ? myBizNo : (inv.counterparty_bizno || '')),
    name: cleanNm(isSales ? myCompany : (inv.counterparty_name || '')),
    rep: isSales ? myRep : cpRep,
    addr: isSales ? (companyInfo?.address || '') : cpAddr,
    bizType: isSales ? myBizType : cpBizType,
    bizCat: isSales ? myBizCat : cpBizCat,
    email: isSales ? (companyInfo?.email || '') : cpEmail,
  };
  const buyer = {
    bizNo: fmtBizNo(!isSales ? myBizNo : (inv.counterparty_bizno || '')),
    name: cleanNm(!isSales ? myCompany : (inv.counterparty_name || '')),
    rep: !isSales ? myRep : cpRep,
    addr: !isSales ? (companyInfo?.address || '') : cpAddr,
    bizType: !isSales ? myBizType : cpBizType,
    bizCat: !isSales ? myBizCat : cpBizCat,
    email: !isSales ? (companyInfo?.email || '') : cpEmail,
  };
  // 실제 세금계산서 관행: 매출(공급자 보관용)=적색, 매입=청색. 은은한 톤으로 공식 느낌만.
  const formColor = isSales ? '#C0392B' : '#1D6AA8';
  const formTint = isSales ? '#FBEEEC' : '#EAF2FA';
  // 과세유형별 문서 제목 — 영세율=영세율전자세금계산서, 면세=전자계산서 (직원 QA 그랜터)
  const baseTitle = inv.tax_kind === 'zero_rated' ? '영세율전자세금계산서'
    : inv.tax_kind === 'exempt' ? '전자계산서'
    : '전자세금계산서';
  const docTitle = issuedToNts ? baseTitle : `미전송 ${baseTitle}`;
  // 영수/청구 — 홈택스 전자계산서 데이터엔 없는 필드(종이계산서 잔재)라 자동으론 못 불러옴.
  //   label 앞 토큰("영수 |"/"청구 |")으로 보관하고, 상세에서 사용자가 직접 지정(수정 저장).
  const [billedState, setBilledState] = useState<boolean>(() => !inv.label?.includes('영수'));
  const [savingReceipt, setSavingReceipt] = useState(false);
  const isBilled = billedState; // true=청구, false=영수
  const setReceipt = async (billed: boolean) => {
    if (savingReceipt || billed === billedState) return;
    setSavingReceipt(true);
    const token = billed ? '청구' : '영수';
    const rest = stripPurposeToken(inv.label) || (inv.item_name ? String(inv.item_name).replace(/\+/g, ' ').trim() : '');
    const newLabel = rest ? `${token} | ${rest}` : token;
    try {
      const { error } = await (supabase).from('tax_invoices').update({ label: newLabel }).eq('id', inv.id);
      if (error) throw error;
      inv.label = newLabel; // 로컬 반영 (목록 재조회 전까지)
      setBilledState(billed);
      invalidateTaxInvoiceReaders(queryClient);
      toast(`영수/청구를 '${token}'(으)로 저장했습니다`, 'success');
    } catch (e: any) {
      toast(`영수/청구 저장 실패: ${e.message}`, 'error');
    }
    setSavingReceipt(false);
  };

  const buildPdfParams = (): TaxInvoicePdfParams => ({
    invoiceNumber: `TI-${inv.issue_date?.replace(/-/g, '').slice(0, 6)}-${inv.id.slice(0, 4).toUpperCase()}`,
    issueDate: inv.issue_date || todayKst(),
    type: inv.type,
    supplier: {
      name: supplier.name,
      businessNumber: supplier.bizNo,
      representative: supplier.rep,
      address: supplier.addr,
      businessType: supplier.bizType,
      businessCategory: supplier.bizCat,
    },
    buyer: {
      name: buyer.name,
      businessNumber: buyer.bizNo,
      representative: buyer.rep,
      address: buyer.addr,
      businessType: buyer.bizType,
      businessCategory: buyer.bizCat,
    },
    supplyAmount: supplyAmt,
    taxAmount: taxAmt,
    totalAmount: totalAmt,
    items: [{
      date: inv.issue_date || todayKst(),
      name: inv.item_name || inv.label || '용역',
      spec: inv.item_spec || '-',
      qty: inv.item_quantity || 1,
      unitPrice: inv.item_unit_price || supplyAmt,
      amount: supplyAmt,
      taxAmount: taxAmt,
    }],
  });

  const handleDownloadPdf = async () => {
    setPdfLoading(true);
    try {
      const blob = await generateTaxInvoicePdf(buildPdfParams());
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `세금계산서_${inv.counterparty_name}_${inv.issue_date}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
      toast('PDF 다운로드 완료', 'success');
    } catch (err: any) {
      toast(`PDF 생성 실패: ${err.message}`, 'error');
    }
    setPdfLoading(false);
  };

  const handleSendEmail = async () => {
    if (!emailTo) { toast('이메일 주소를 입력하세요', 'error'); return; }
    setEmailLoading(true);
    try {
      // Generate PDF blob → base64
      const blob = await generateTaxInvoicePdf(buildPdfParams());
      const buffer = await blob.arrayBuffer();
      const bytes = new Uint8Array(buffer);
      let binary = '';
      for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
      const pdfBase64 = btoa(binary);

      const invoiceNumber = `TI-${inv.issue_date?.replace(/-/g, '').slice(0, 6)}-${inv.id.slice(0, 4).toUpperCase()}`;
      const res = await supabase.functions.invoke('send-tax-invoice-email', {
        body: {
          recipientEmail: emailTo,
          counterpartyName: inv.counterparty_name,
          senderCompany: myCompany,
          invoiceNumber,
          issueDate: inv.issue_date,
          supplyAmount: supplyAmt,
          taxAmount: taxAmt,
          totalAmount: totalAmt,
          type: inv.type,
          pdfBase64,
        },
      });
      if (res.error) throw res.error;
      toast(`${emailTo}로 세금계산서 발송 완료`, 'success');
      setShowEmailForm(false);
      setEmailTo('');
    } catch (err: any) {
      toast(`이메일 발송 실패: ${err.message}`, 'error');
    }
    setEmailLoading(false);
  };

  const handleIssue = async () => {
    // 이미 국세청 발행(승인번호 보유)된 건만 차단. draft·내부발행(issued+미발행) 모두 실제 발행 시도 허용.
    if (inv.nts_confirm_no) { toast('이미 국세청에 발행된 세금계산서입니다.', 'error'); return; }
    setIssueLoading(true);
    try {
      const r: any = await issueTaxInvoice(inv.id);
      toast(r?.nts_confirm_no ? `홈택스 발행 완료 (승인번호 ${r.nts_confirm_no})` : '세금계산서가 발행되었습니다', 'success');
      queryClient.invalidateQueries({ queryKey: ['tax-invoices'] });
      invalidateTaxInvoiceReaders(queryClient);
      queryClient.invalidateQueries({ queryKey: ['tax-invoice-issuance-status'] });   // 한도 칩 갱신 (2026-08-19)
      onClose();
    } catch (err: any) {
      toast(`발행 실패: ${err.message}${err.hint ? ' — ' + err.hint : ''}`, 'error');
    }
    setIssueLoading(false);
  };

  // 발행 등록(최초 1회): CODEF 제휴사 회원가입 + 공동인증서 등록 URL → 새 창
  // 주의: certURL 은 응답 후(await 이후) window.open 하면 브라우저가 "사용자 제스처 아님"으로 판단해 팝업을 무음 차단함
  // (30초 유효 URL이라 재시도도 못 함) → 클릭 즉시(동기) 빈 창을 먼저 열고, 응답이 오면 그 창을 이동시킨다.
  const handleRegisterIssuer = async () => {
    setRegisterLoading(true);
    const popup = window.open('', '_blank');
    if (popup) popup.document.write('<p style="font-family:sans-serif;padding:24px;color:#555">인증서 등록 페이지를 불러오는 중입니다…</p>');
    try {
      const { certURL, message } = await registerHometaxIssuer(inv.company_id);
      if (popup && !popup.closed) popup.location.href = certURL;
      else window.open(certURL, '_blank');
      toast(message || '인증서 등록 페이지를 열었습니다. 등록 후 다시 발행하세요.', 'success');
    } catch (err: any) {
      popup?.close();
      toast(`발행 등록 실패: ${err.message}`, 'error');
    }
    setRegisterLoading(false);
  };

  // 세금계산서 양식 내부 라벨/값 행 (항상 라이트 — 실제 종이 문서처럼)
  const F = ({ label, value, mono, wide }: { label: string; value: React.ReactNode; mono?: boolean; wide?: boolean }) => (
    <div className="flex border-b last:border-b-0" style={{ borderColor: "#e6e6e6" }}>
      <div className={`${wide ? "w-[64px]" : "w-[64px]"} shrink-0 px-2 py-[5px] text-[10px] font-semibold flex items-center`} style={{ background: "#f6f6f6", color: "#555", borderRight: "1px solid #e6e6e6" }}>{label}</div>
      <div className={`flex-1 px-2 py-[5px] text-[11px] leading-snug ${mono ? "font-mono" : ""}`} style={{ color: "#1a1a1a" }}>{value || "—"}</div>
    </div>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="tax-invoice-detail-modal glass-card" onClick={(e) => e.stopPropagation()}>
        {/* Header (모달 크롬) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-base font-black">세금계산서 상세</span>
            <span className={`text-xs px-2 py-0.5 rounded-full ${sc.bg} ${sc.text}`}>{sc.label}</span>
            {/* 국세청 전송 여부 — nts_confirm_no 유무로 판정(status='issued'는 앱 내부 상태). */}
            {issuedToNts ? (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/15 text-green-600 font-semibold" title={`국세청 승인번호 ${inv.nts_confirm_no}`}>홈택스 전송완료</span>
            ) : (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-600 font-semibold">홈택스 미전송</span>
            )}
          </div>
          <button onClick={onClose} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl transition">&times;</button>
        </div>

        {/* 홈택스 전자세금계산서 양식 — 실제 발행본과 동일한 시각 형태(항상 흰 배경 공식 문서). */}
        <div className="p-4 sm:p-6" data-print-area>
          <div className="tax-invoice-document" style={{ background: "#fff", color: "#1a1a1a", border: `2.5px solid ${formColor}`, borderRadius: 4, overflow: "hidden" }}>
            {/* 제목 바 — 전송 여부에 따라 전자세금계산서 / 미전송 전자세금계산서 */}
            <div className="relative text-center" style={{ background: formTint, borderBottom: `1.5px solid ${formColor}` }}>
              <div className="py-2 font-black tracking-[0.35em] text-[15px] sm:text-[17px]" style={{ color: formColor }}>{docTitle}</div>
              <div className="absolute right-2 top-1/2 -translate-y-1/2 text-[9px] font-semibold" style={{ color: formColor }}>
                {isSales ? "공급자 보관용" : "공급받는자 보관용"}
              </div>
              {/* 홈택스 상세에서 사업장·이메일을 가져오는 중 (최초 1회) */}
              {detailLoading && (
                <div className="absolute left-2 top-1/2 -translate-y-1/2 text-[9px] font-semibold animate-pulse" style={{ color: formColor }}>
                  홈택스에서 사업장·이메일 불러오는 중…
                </div>
              )}
            </div>

            {/* 승인번호 */}
            <div className="flex text-[11px]" style={{ borderBottom: "1px solid #ddd" }}>
              <div className="px-3 py-1.5 w-[88px] shrink-0 font-semibold" style={{ background: "#f6f6f6", color: "#555", borderRight: "1px solid #ddd" }}>승인번호</div>
              <div className="px-3 py-1.5 flex-1 font-mono" style={{ color: issuedToNts ? "#1a1a1a" : "#b45309" }}>
                {inv.nts_confirm_no || "미발급 — 국세청에 전송되지 않은 계산서입니다"}
              </div>
            </div>

            {/* 공급자 / 공급받는자 */}
            <div className="grid grid-cols-1 sm:grid-cols-2" style={{ borderBottom: "1px solid #ddd" }}>
              <div style={{ borderRight: "1px solid #ddd" }}>
                <div className="text-center py-1 text-[11px] font-bold text-white" style={{ background: formColor }}>공 급 자</div>
                <F label="등록번호" value={supplier.bizNo} mono />
                <F label="상호" value={supplier.name} />
                <F label="성명" value={supplier.rep} />
                <F label="사업장" value={supplier.addr} />
                <F label="업태" value={supplier.bizType} />
                <F label="종목" value={supplier.bizCat} />
                <F label="이메일" value={supplier.email} />
              </div>
              <div>
                <div className="text-center py-1 text-[11px] font-bold text-white" style={{ background: "#555" }}>공급받는자</div>
                <F label="등록번호" value={buyer.bizNo} mono />
                <F label="상호" value={buyer.name} />
                <F label="성명" value={buyer.rep} />
                <F label="사업장" value={buyer.addr} />
                <F label="업태" value={buyer.bizType} />
                <F label="종목" value={buyer.bizCat} />
                <F label="이메일" value={buyer.email} />
              </div>
            </div>

            {/* 작성일자 · 공급가액 · 세액 */}
            <div className="grid grid-cols-3 text-center" style={{ borderBottom: "1px solid #ddd" }}>
              <div style={{ borderRight: "1px solid #ddd" }}>
                <div className="text-[9px] py-1" style={{ background: "#f6f6f6", color: "#555", borderBottom: "1px solid #ddd" }}>작성일자</div>
                <div className="text-[12px] font-bold py-1.5 font-mono">{inv.issue_date || "—"}</div>
              </div>
              <div style={{ borderRight: "1px solid #ddd" }}>
                <div className="text-[9px] py-1" style={{ background: "#f6f6f6", color: "#555", borderBottom: "1px solid #ddd" }}>공급가액</div>
                <div className="text-[12px] font-bold py-1.5 font-mono">₩{supplyAmt.toLocaleString()}</div>
              </div>
              <div>
                <div className="text-[9px] py-1" style={{ background: "#f6f6f6", color: "#555", borderBottom: "1px solid #ddd" }}>세액</div>
                <div className="text-[12px] font-bold py-1.5 font-mono">₩{taxAmt.toLocaleString()}</div>
              </div>
            </div>

            {/* 품목 상세 */}
            <table className="w-full" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr className="text-[9.5px] font-semibold" style={{ background: "#f6f6f6", color: "#555" }}>
                  <th className="py-1 px-1 text-center" style={{ borderBottom: "1px solid #ddd", borderRight: "1px solid #eee", width: "44px" }}>월/일</th>
                  <th className="py-1 px-2 text-center" style={{ borderBottom: "1px solid #ddd", borderRight: "1px solid #eee" }}>품목</th>
                  <th className="py-1 px-1 text-center" style={{ borderBottom: "1px solid #ddd", borderRight: "1px solid #eee", width: "38px" }}>수량</th>
                  <th className="py-1 px-2 text-center" style={{ borderBottom: "1px solid #ddd", borderRight: "1px solid #eee" }}>단가</th>
                  <th className="py-1 px-2 text-center" style={{ borderBottom: "1px solid #ddd", borderRight: "1px solid #eee" }}>공급가액</th>
                  <th className="py-1 px-2 text-center" style={{ borderBottom: "1px solid #ddd" }}>세액</th>
                </tr>
              </thead>
              <tbody>
                {/*  품목 줄이 있으면 줄마다 한 행 — 국세청 서식과 같은 모양 (2026-08-10).
                     옛 계산서(줄 없음)는 예전처럼 한 행으로 그린다. */}
                {((inv.items as any[]) || []).length > 0 ? (
                  ((inv.items as any[]) || []).map((it: any, i: number) => {
                    const lineSupply = Math.round(Number(it.supplyAmount ?? (Number(it.qty || 1) * Number(it.unitCost || 0))) || 0);
                    return (
                      <tr key={i} className="text-[11px]" style={{ color: "#1a1a1a", borderTop: i > 0 ? "1px solid #f0f0f0" : undefined }}>
                        <td className="py-2 px-1 text-center font-mono" style={{ borderRight: "1px solid #eee" }}>{i === 0 ? (inv.issue_date?.slice(5) || "—") : ""}</td>
                        <td className="py-2 px-2" style={{ borderRight: "1px solid #eee" }}>
                          {it.name || "—"}
                          {it.spec && <span className="ml-1.5 text-[10px]" style={{ color: "#888" }}>{it.spec}</span>}
                        </td>
                        <td className="py-2 px-1 text-center font-mono" style={{ borderRight: "1px solid #eee" }}>{it.qty || 1}</td>
                        <td className="py-2 px-2 text-right font-mono" style={{ borderRight: "1px solid #eee" }}>₩{Number(it.unitCost || 0).toLocaleString()}</td>
                        <td className="py-2 px-2 text-right font-mono" style={{ borderRight: "1px solid #eee" }}>₩{lineSupply.toLocaleString()}</td>
                        <td className="py-2 px-2 text-right font-mono">₩{(taxAmt > 0 ? Math.round(lineSupply * 0.1) : 0).toLocaleString()}</td>
                      </tr>
                    );
                  })
                ) : (
                  <tr className="text-[11px]" style={{ color: "#1a1a1a" }}>
                    <td className="py-2 px-1 text-center font-mono" style={{ borderRight: "1px solid #eee" }}>{inv.issue_date?.slice(5) || "—"}</td>
                    <td className="py-2 px-2" style={{ borderRight: "1px solid #eee" }}>
                      {stripPurposeToken(inv.label) || (inv.item_name ? String(inv.item_name).replace(/\+/g, " ") : "") || EXPENSE_CATEGORIES.find((c: any) => c.value === inv.expense_category)?.label || "—"}
                    </td>
                    <td className="py-2 px-1 text-center font-mono" style={{ borderRight: "1px solid #eee" }}>{inv.item_quantity || 1}</td>
                    <td className="py-2 px-2 text-right font-mono" style={{ borderRight: "1px solid #eee" }}>₩{Number(inv.item_unit_price || supplyAmt).toLocaleString()}</td>
                    <td className="py-2 px-2 text-right font-mono" style={{ borderRight: "1px solid #eee" }}>₩{supplyAmt.toLocaleString()}</td>
                    <td className="py-2 px-2 text-right font-mono">₩{taxAmt.toLocaleString()}</td>
                  </tr>
                )}
              </tbody>
            </table>

            {/* 합계금액 · 영수/청구 */}
            <div className="flex items-stretch text-[11px]" style={{ borderTop: "2px solid " + formColor }}>
              <div className="px-3 py-2 font-semibold flex items-center" style={{ background: "#f6f6f6", color: "#555", borderRight: "1px solid #ddd", width: "88px" }}>합계금액</div>
              <div className="px-3 py-2 flex-1 font-black font-mono text-[14px] flex items-center" style={{ color: formColor }}>₩{totalAmt.toLocaleString()}</div>
              <div className="px-4 py-2 flex items-center gap-1.5 font-semibold" style={{ borderLeft: "1px solid #ddd", color: "#333" }}>
                이 금액을
                {/* 영수/청구 — 클릭해서 지정(홈택스 동기화 건은 이 필드가 없어 기본 '청구', 여기서 실제값으로 수정) */}
                {/* 인쇄 시엔 버튼이 숨겨지므로 선택값만 정적 표기 */}
                <span className="hidden print:inline px-2 py-0.5 rounded-full text-[10px] font-bold" style={{ background: formTint, color: formColor }}>{isBilled ? "청구" : "영수"}</span>
                <span className="inline-flex print:hidden rounded-full overflow-hidden border" style={{ borderColor: formColor }}>
                  <button
                    type="button"
                    disabled={savingReceipt}
                    onClick={() => setReceipt(false)}
                    className="px-2 py-0.5 text-[10px] font-bold transition disabled:opacity-50"
                    style={!isBilled ? { background: formColor, color: "#fff" } : { background: "#fff", color: "#999" }}
                  >영수</button>
                  <button
                    type="button"
                    disabled={savingReceipt}
                    onClick={() => setReceipt(true)}
                    className="px-2 py-0.5 text-[10px] font-bold transition disabled:opacity-50"
                    style={isBilled ? { background: formColor, color: "#fff" } : { background: "#fff", color: "#999" }}
                  >청구</button>
                </span>
                함
              </div>
            </div>
          </div>

          {/* 내부 참고 정보(양식 밖) — 프로젝트/비목. 비목(계정과목)은 여기서 직접 지정 가능:
              매입 계산서에 지정하면 손익계산서에서 매출원가 대신 그 판관비 항목으로 반영 (사장님 QA 2026-07-10) */}
          <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-1.5 text-[11px] text-[var(--text-muted)]">
            <span className="inline-flex items-center gap-1.5">프로젝트:
              <select
                value={dealId}
                onChange={async (e) => {
                  const v = e.target.value;
                  const prev = dealId;
                  setDealId(v);
                  const { error } = await (supabase).from("tax_invoices").update({ deal_id: v || null }).eq("id", inv.id);
                  if (error) { toast("프로젝트 저장 실패: " + error.message, "error"); setDealId(prev); return; }
                  const picked = (deals || []).find((d: any) => d.id === v);
                  inv.deal_id = v || null;
                  inv.deals = v ? { name: picked?.name } : null;
                  invalidateTaxInvoiceReaders(queryClient);   //   원장·미수·요약 등 파생 화면 일괄 (2026-08-31)
                  toast(v ? `'${picked?.name || "프로젝트"}'에 연결되었습니다` : "프로젝트 연결 해제", "success");
                }}
                className="px-2 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] text-[var(--text)]"
                title="이 세금계산서를 프로젝트에 연결합니다 — 프로젝트 손익·비용 구성에 집계됩니다"
              >
                <option value="">미지정</option>
                {(deals || []).map((d: any) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </span>
            <span className="inline-flex items-center gap-1.5">계정과목:
              <select
                value={expenseCat}
                onChange={async (e) => {
                  const v = e.target.value;
                  setExpenseCat(v);
                  const { error } = await (supabase).from("tax_invoices").update({ expense_category: v || null }).eq("id", inv.id);
                  if (error) { toast("계정과목 저장 실패: " + error.message, "error"); return; }
                  inv.expense_category = v || null;
                  invalidateTaxInvoiceReaders(queryClient);   //   원장·미수·요약 등 파생 화면 일괄 (2026-08-31)
                  toast(v
                    ? `'${EXPENSE_CATEGORIES.find((c) => c.value === v)?.label || v}' 지정 — 손익계산서에서 매출원가 대신 판관비로 반영됩니다`
                    : "계정과목 해제 — 매입 계산서는 매출원가로 집계됩니다", "success");
                }}
                className="px-2 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] text-[var(--text)]"
                title="매입 계산서에 계정과목을 지정하면 손익계산서에서 매출원가 대신 그 판관비 항목으로 반영됩니다"
              >
                {EXPENSE_CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>{c.value === "" ? (inv.type === "purchase" ? "미지정 (매출원가)" : "미지정") : c.label}</option>
                ))}
              </select>
            </span>
          </div>

          {/* Actions */}
          <div className="space-y-3 mt-4">
            {/* 매출인데 국세청 미발행(nts_confirm_no 없음) — 오해 방지 경고 + 실제 발행 버튼 */}
            {inv.type === 'sales' && inv.status !== 'draft' && !inv.nts_confirm_no && (
              <div className="rounded-lg bg-red-500/10 border border-red-500/30 px-3 py-2.5 text-xs text-red-500 leading-relaxed">
                <div><Ico e="⚠" tone="mono" /> 이 세금계산서는 앱에만 기록됐고 <b>아직 국세청에 전자발행되지 않았습니다</b> (승인번호 없음).</div>
                <div className="mt-1 text-[10px] text-red-400/90">전자발행은 최초 1회 <b>발행 등록(회원가입+인증서)</b>이 필요합니다. ① 발행 등록 → 인증서 등록 완료 후 → ② 홈택스 발행.</div>
                <div className="mt-2 flex items-center gap-2 flex-wrap">
                  <button
                    onClick={handleRegisterIssuer}
                    disabled={registerLoading}
                    className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white rounded-lg font-semibold transition disabled:opacity-50"
                  >
                    {registerLoading ? '등록 페이지 여는 중...' : '① 발행 등록 (회원가입+인증서)'}
                  </button>
                  <button
                    onClick={handleIssue}
                    disabled={issueLoading || issuanceLimitReached}
                    title={issuanceLimitReached ? `${issuanceStatus?.planName || '현재 요금제'}의 이번 달 발행 한도(${issuanceStatus?.limit}건)를 모두 사용했습니다` : undefined}
                    className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white rounded-lg font-semibold transition disabled:opacity-50"
                  >
                    {issueLoading ? '발행 중...' : issuanceLimitReached ? '이번 달 발행 한도 소진' : '② 지금 홈택스 발행'}
                  </button>
                  <span className="text-[10px] text-red-400/80">또는 홈택스에서 직접 발행</span>
                </div>
                {issuanceLimitReached && (
                  <div className="mt-2 text-[10px] text-amber-500">
                    {issuanceStatus?.planName || '현재 요금제'}는 월 {issuanceStatus?.limit}건까지 국세청 발행이 가능합니다. 울트라로 업그레이드하면 무제한으로 발행할 수 있습니다. (설정 → 요금제)
                  </div>
                )}
              </div>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {inv.status === 'draft' && (
                <button
                  onClick={handleIssue}
                  disabled={issueLoading || issuanceLimitReached}
                  title={issuanceLimitReached ? `${issuanceStatus?.planName || '현재 요금제'}의 이번 달 발행 한도(${issuanceStatus?.limit}건)를 모두 사용했습니다` : undefined}
                  className="btn-primary"
                >
                  {issueLoading ? '발행 중...' : issuanceLimitReached ? '이번 달 발행 한도 소진' : '발행 처리'}
                </button>
              )}
              <button
                onClick={handleDownloadPdf}
                disabled={pdfLoading}
                className="px-4 py-2 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded-lg text-sm font-semibold transition disabled:opacity-50"
              >
                {pdfLoading ? 'PDF 생성 중...' : 'PDF 다운로드'}
              </button>
              <button
                onClick={() => setShowEmailForm(!showEmailForm)}
                className="px-4 py-2 bg-green-500/10 text-green-400 hover:bg-green-500/20 rounded-lg text-sm font-semibold transition"
              >
                이메일 발송
              </button>
              <button
                onClick={() => onModify(inv)}
                disabled={!MODIFY_ISSUE_AVAILABLE}
                title={MODIFY_ISSUE_AVAILABLE ? "수정세금계산서 만들기 — 초안 생성 후 목록에서 발행" : "국세청 연동 기관 승인 대기 중입니다. 곧 지원 예정입니다."}
                className={
                  MODIFY_ISSUE_AVAILABLE
                    ? "px-4 py-2 bg-orange-500/10 text-orange-400 hover:bg-orange-500/20 rounded-lg text-sm font-semibold transition"
                    : "px-4 py-2 bg-[var(--bg-surface)] text-[var(--text-dim)] rounded-lg text-sm font-semibold border border-[var(--border)] cursor-not-allowed"
                }
              >
                수정세금계산서{MODIFY_ISSUE_AVAILABLE ? "" : " (업데이트 예정)"}
              </button>
              <button
                onClick={() => { ensurePrintStyles(); window.print(); }}
                className="px-4 py-2 bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-lg text-sm border border-[var(--border)] transition"
              >
                인쇄
              </button>
              <button
                onClick={onClose}
                className="px-4 py-2 text-[var(--text-muted)] text-sm hover:text-[var(--text)] transition ml-auto"
              >
                닫기
              </button>
            </div>

            {/* Email form */}
            {showEmailForm && (
              <div className="flex items-center gap-2 bg-[var(--bg-surface)] rounded-xl p-3 border border-[var(--border)]">
                <input
                  type="email"
                  value={emailTo}
                  onChange={e => setEmailTo(e.target.value)}
                  placeholder="수신자 이메일 주소"
                  className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
                />
                <button
                  onClick={handleSendEmail}
                  disabled={emailLoading || !emailTo}
                  className="px-4 py-2 bg-green-500 text-white rounded-lg text-sm font-semibold hover:bg-green-600 transition disabled:opacity-50 whitespace-nowrap"
                >
                  {emailLoading ? '발송 중...' : 'PDF 첨부 발송'}
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Modification Modal (수정세금계산서) ──
function ModificationModal({ invoice, reason, setReason, modifyAmount, setModifyAmount, onClose, onSubmit }: {
  invoice: any; reason: string; setReason: (r: string) => void; modifyAmount: string; setModifyAmount: (v: string) => void; onClose: () => void; onSubmit: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);

  // 버튼 외 경로(딥링크·기존 상태 등)로 열려도 발행되지 않도록 모달에서도 막는다.
  if (!MODIFY_ISSUE_AVAILABLE) {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
        <div className="tax-invoice-modification-modal glass-card" onClick={(e) => e.stopPropagation()}>
          <div className="px-6 py-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold">수정세금계산서 — 업데이트 예정</h3>
          </div>
          <div className="px-6 py-6 space-y-3">
            <p className="text-sm text-[var(--text)]">
              수정세금계산서 발행은 <b>현재 준비 중</b>입니다. 국세청 전자세금계산서 <b>수정발행 연동 승인</b>이
              완료되는 대로 열립니다.
            </p>
            <p className="text-xs text-[var(--text-muted)] leading-6">
              그때까지는 홈택스에서 직접 수정발행해 주세요. 이미 국세청에 전송된 세금계산서는
              삭제·정정이 불가능하며, 세법상 적합한 수정사유를 선택해 수정세금계산서를 발행해야 합니다.
            </p>
          </div>
          <div className="px-6 py-4 border-t border-[var(--border)] flex justify-end">
            <button onClick={onClose} className="btn-primary btn-sm">확인</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="tax-invoice-modification-modal glass-card" onClick={(e) => e.stopPropagation()}>
        <div className="px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-sm font-bold">수정세금계산서 만들기</h3>
          <p className="text-xs text-[var(--text-muted)] mt-1">
            원본: {invoice.counterparty_name} / ₩{Number(invoice.total_amount).toLocaleString()} ({invoice.issue_date})
          </p>
        </div>
        <div className="p-6 space-y-4">
          {/* 2단계 안내 — 이 모달은 초안만 만든다. 국세청 전송은 목록에서 '발행'을 눌러야 일어난다.
              라벨이 '발행'이라 여기서 끝난 줄 알고 미전송으로 남던 문제(2026-08-03 사장님). */}
          <div className="tax-invoice-modify-step-notice">
            <b className="text-[var(--text)]">여기서는 수정세금계산서 초안만 만들어집니다.</b> 국세청 전송은
            목록에 새로 생긴 건에서 <b>발행</b>을 눌러야 이뤄집니다.
          </div>

          {/* Rules info */}
          <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-xs text-[var(--text-muted)] leading-relaxed space-y-2">
            <div className="font-bold text-[var(--text)] text-sm mb-2">수정세금계산서 발행 규정</div>
            <div>1. 공급시기가 속하는 과세기간에 대한 확정신고 기한 내 발행 가능</div>
            <div>2. 착오정정은 당초 세금계산서와 수정세금계산서를 동시 발행</div>
            <div>3. 계약해제/환입은 사유 발생일을 작성일자로 발행</div>
            <div>4. 가산세: 미발행 시 공급가액의 1%, 지연발행 시 0.5%</div>
          </div>

          {/* Reason selection */}
          <div>
            <label className="block text-xs text-[var(--text-muted)] mb-2 font-medium">수정 사유 선택 *</label>
            <div className="space-y-2">
              {MODIFICATION_REASONS.map((r) => (
                <label
                  key={r.value}
                  className={`flex items-start gap-3 p-3 rounded-xl border cursor-pointer transition ${
                    reason === r.value
                      ? "border-[var(--primary)] bg-[var(--primary)]/5"
                      : "border-[var(--border)] hover:border-[var(--text-muted)]"
                  }`}
                >
                  <input
                    type="radio"
                    name="modifyReason"
                    value={r.value}
                    checked={reason === r.value}
                    onChange={() => setReason(r.value)}
                    className="mt-0.5 accent-[var(--primary)]"
                  />
                  <div>
                    <div className="text-sm font-semibold">{r.label}</div>
                    <div className="text-xs text-[var(--text-muted)] mt-0.5">{r.desc}</div>
                  </div>
                </label>
              ))}
            </div>
          </div>

          {/* 금액 변경 입력 (착오정정, 공급가액 변동 시) */}
          {(reason === "error_correction" || reason === "price_change") && (
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1 font-medium">
                {reason === "price_change" ? "변경 후 공급가액 *" : "정정 공급가액"}
              </label>
              <CurrencyInput
                value={modifyAmount}
                onValueChange={(raw) => setModifyAmount(raw)}
                placeholder={`현재: ${Number(invoice.supply_amount).toLocaleString()}`}
                className="field-input"
              />
            </div>
          )}

          <div className="flex gap-2 pt-2">
            <button
              onClick={async () => {
                setSubmitting(true);
                try { await onSubmit(); } finally { setSubmitting(false); }
              }}
              disabled={!reason || submitting || (reason === "price_change" && !modifyAmount)}
              className="px-4 py-2.5 bg-orange-500 hover:bg-orange-600 text-white rounded-lg text-sm font-semibold disabled:opacity-50 transition"
            >
              {submitting ? "만드는 중..." : "수정세금계산서 만들기"}
            </button>
            <button
              onClick={onClose}
              className="px-4 py-2.5 text-[var(--text-muted)] text-sm hover:text-[var(--text)] transition"
            >
              취소
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * 프로젝트(딜) 짝 제안 — 발행 완료된 계산서에 어느 프로젝트 매출인지 붙인다 (2026-08-13 사장님).
 *
 *   왜: 발행만 하고 끝나면 "이 매출이 어느 프로젝트 것인지"가 안 붙는다. 예전엔 상세 모달
 *   깊숙한 셀렉트뿐이라 아무도 안 붙였다(딜 미연결이 전체 건수와 맞먹었다).
 *
 *   제안 점수 — 근거를 줄마다 적는다(뭉뚱그리면 틀렸을 때 원인을 못 찾는다):
 *     같은 거래처(partner_id 일치) +3 · 딜 이름에 거래처명 +2 · 계약금액 ±10% +1.
 *   ★ 자동 확정은 안 한다 — 같은 거래처에 딜이 여럿(월 구독 등)이면 엉뚱한 딜에 붙는다.
 *     후보가 없거나 틀리면 아래 검색으로 전체 목록에서 찾는다.
 */
function DealSuggestPopup({ invoice, deals, onClose, onDone }: {
  invoice: any; deals: any[]; onClose: () => void; onDone: () => void;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [q, setQ] = useState("");

  const name = String(invoice.counterparty_name || "").trim();
  const supply = Number(invoice.supply_amount || 0);
  const scored = deals.map((d) => {
    const why: string[] = [];
    let score = 0;
    if (invoice.partner_id && d.partner_id && d.partner_id === invoice.partner_id) { score += 3; why.push("같은 거래처"); }
    if (name.length >= 2 && String(d.name || "").includes(name)) { score += 2; why.push("이름에 거래처"); }
    const ct = Number(d.contract_total || 0);
    if (ct > 0 && supply > 0 && Math.abs(ct - supply) / ct <= 0.1) { score += 1; why.push("계약금액 근접"); }
    return { d, score, why };
  });
  const suggested = scored.filter((x) => x.score > 0).sort((a, b) => b.score - a.score).slice(0, 8);
  const searched = q.trim()
    ? deals.filter((d) => String(d.name || "").toLowerCase().includes(q.trim().toLowerCase())).slice(0, 20)
    : [];
  const current = invoice.deal_id ? deals.find((d) => d.id === invoice.deal_id) : null;

  const link = async (dealId: string | null) => {
    if (busy) return;
    setBusy(true);
    try {
      const { error } = await (supabase).from("tax_invoices").update({ deal_id: dealId } as never).eq("id", invoice.id);
      if (error) throw error;
      toast(dealId ? "프로젝트에 연결했습니다" : "프로젝트 연결을 해제했습니다", "success");
      onDone();
    } catch (e: any) {
      toast(friendlyError(e, "연결 실패"), "error");
      setBusy(false);
    }
  };

  const row = (d: any, why: string[]) => (
    <div key={d.id} className="ti-deal-row">
      <span className="ti-deal-name">{d.name}</span>
      {Number(d.contract_total || 0) > 0 && (
        <span className="mono-number ev-dim">계약 ₩{Number(d.contract_total).toLocaleString("ko")}</span>
      )}
      {why.map((w) => <span key={w} className="ti-deal-why">{w}</span>)}
      <button type="button" className="btn-primary btn-sm ml-auto" disabled={busy} onClick={() => link(d.id)}>연결</button>
    </div>
  );

  return (
    <div className="ti-cfm-overlay" onClick={onClose}>
      <div className="ti-cfm ti-deal" onClick={(e) => e.stopPropagation()}>
        <div className="ti-cfm-head">
          <b>프로젝트 짝 찾기 — {name || "거래처 없음"} · ₩{Number(invoice.total_amount || 0).toLocaleString("ko")}</b>
          <span>제안은 근거와 함께 보여만 줍니다 — 붙일지는 여기서 직접 정합니다</span>
        </div>
        <div className="ti-cfm-body">
          {current && (
            <div className="ti-deal-current">
              지금 연결: <b>{current.name}</b>
              <button type="button" className="btn-secondary btn-sm ml-auto" disabled={busy} onClick={() => link(null)}>해제</button>
            </div>
          )}
          {suggested.length > 0 ? (
            <>
              <div className="ti-deal-sect">제안 <i>장부 대조</i></div>
              {suggested.map((x) => row(x.d, x.why))}
            </>
          ) : (
            <div className="ti-deal-none">
              제안할 프로젝트가 없습니다 — 거래처·이름·금액이 맞는 딜을 찾지 못했습니다.
              아래 검색으로 직접 찾아 연결할 수 있습니다.
            </div>
          )}
          <div className="ti-deal-sect">직접 찾기</div>
          <input className="qk-input w-full" value={q} placeholder="프로젝트 이름 일부"
            onChange={(e) => setQ(e.target.value)} />
          {searched.map((d) => row(d, []))}
          {q.trim() && searched.length === 0 && <div className="ti-deal-none">이름에 &quot;{q.trim()}&quot; 이 들어간 프로젝트가 없습니다.</div>}
        </div>
        <div className="ti-cfm-foot">
          <span className="flex-1" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

/**
 * 전송 전 확인 — 받는 쪽 정보가 빠진 채 국세청으로 나가는 것을 여기서 막는다 (2026-08-13, 4단계).
 *
 *   왜 필요한가: 거래처 727곳 중 이메일 466(64%) · 업태·종목 8곳(1%). 사업자번호만 있으면
 *   전송 자체는 되지만 **이메일이 없으면 상대가 계산서를 못 받는다.** 그래서 전송 버튼이
 *   바로 쏘지 않고 이 창을 거친다 — 빠진 칸은 그 자리에서 채우고 보낸다.
 *
 *   칸의 출처는 발행 엣지와 같은 규칙(계산서 값 우선 → 거래처 폴백)으로 판정한다.
 *   여기서 채운 값은 계산서 행(counterparty_*)에 저장되고, 체크를 켜 두면 거래처에도
 *   저장돼 다음 발행부터 자동으로 채워진다 — 발행 폼의 savePartnerInfo 와 같은 패턴.
 */
function IssueConfirmModal({ invoices, partners, vatBiz, onDone, onClose }: {
  invoices: any[]; partners: any[]; vatBiz: VatBusinessType;
  onDone: () => void; onClose: () => void;
}) {
  const { toast } = useToast();
  const [sending, setSending] = useState(false);
  const [savePartner, setSavePartner] = useState(true);
  //   빠진 칸에 쳐 넣은 값 — { 계산서 id: { 칸: 값 } }
  const [edits, setEdits] = useState<Record<string, Record<string, string>>>({});
  const setEdit = (id: string, k: string, v: string) =>
    setEdits((e) => ({ ...e, [id]: { ...e[id], [k]: v } }));

  //   칸 정의 — 계산서 컬럼 / 거래처 컬럼 / 없을 때 무슨 일이 나는지
  const FIELDS = [
    { k: "bizno", label: "등록번호", invCol: "counterparty_bizno", pCol: "business_number", why: "없으면 전송할 수 없습니다", must: true },
    { k: "email", label: "이메일", invCol: "counterparty_email", pCol: "contact_email", why: "없으면 상대가 계산서를 못 받습니다", must: false },
    { k: "rep", label: "대표자", invCol: "counterparty_representative", pCol: "representative", why: "", must: false },
    { k: "btype", label: "업태", invCol: "counterparty_business_type", pCol: "business_type", why: "", must: false },
    { k: "bitem", label: "종목", invCol: "counterparty_business_item", pCol: "business_item", why: "", must: false },
    { k: "addr", label: "주소", invCol: "counterparty_address", pCol: "address", why: "", must: false },
  ] as const;

  const rows = invoices.map((inv) => {
    const p = partners.find((x: any) => x.id === inv.partner_id);
    const eff: Record<string, string> = {};
    for (const f of FIELDS) eff[f.k] = edits[inv.id]?.[f.k] ?? (inv[f.invCol] || p?.[f.pCol] || "");
    const missing = FIELDS.filter((f) => !String(eff[f.k]).trim());
    const kindBlocked = taxKindBlockedReason(vatBiz, (inv.tax_kind || "taxable") as TaxKind);
    return { inv, p, eff, missing, kindBlocked, canSend: !kindBlocked && !!String(eff.bizno).trim() };
  });
  const sendable = rows.filter((r) => r.canSend);

  const send = async () => {
    if (sending || sendable.length === 0) return;
    setSending(true);
    let ok = 0, fail = 0, firstHint = "";
    try {
      for (const r of rows) {
        if (!r.canSend) continue;
        //   ① 채워 넣은 칸을 계산서 행에 저장 — 발행 엣지가 이 값을 먼저 읽는다
        const patch: Record<string, string> = {};
        for (const f of FIELDS) {
          const v = String(edits[r.inv.id]?.[f.k] ?? "").trim();
          if (v && v !== String(r.inv[f.invCol] || "")) patch[f.invCol] = v;
        }
        if (Object.keys(patch).length > 0) {
          await supabase.from("tax_invoices").update(patch as never).eq("id", r.inv.id);
        }
        //   ② 거래처에도 저장(선택) — 다음 발행부터 자동으로 채워진다
        if (savePartner && r.inv.partner_id) {
          const pPatch: Record<string, string> = {};
          for (const f of FIELDS) {
            const v = String(edits[r.inv.id]?.[f.k] ?? "").trim();
            if (v && !String(r.p?.[f.pCol] || "").trim()) pPatch[f.pCol] = v;
          }
          if (Object.keys(pPatch).length > 0) {
            await supabase.from("partners").update(pPatch as never).eq("id", r.inv.partner_id);
          }
        }
        //   ③ 전송 — 한 건 실패해도 나머지는 계속 보낸다
        try {
          await issueTaxInvoice(r.inv.id);
          ok++;
        } catch (err: any) {
          fail++;
          if (!firstHint && err?.hint) firstHint = err.hint;
        }
      }
    } finally {
      setSending(false);
    }
    toast(
      fail === 0 ? `${ok}건을 홈택스로 보냈습니다`
        : `${ok}건 전송, ${fail}건 실패${firstHint ? " — " + firstHint : ""}`,
      fail === 0 ? "success" : "error",
    );
    onDone();
  };

  const fmtWon = (n: unknown) => `₩${Math.round(Number(n) || 0).toLocaleString("ko")}`;
  return (
    <div className="ti-cfm-overlay" onClick={onClose}>
      <div className="ti-cfm" onClick={(e) => e.stopPropagation()}>
        <div className="ti-cfm-head">
          <b>홈택스로 전송 — 보내기 전에 확인</b>
          <span>국세청에 실제 발행됩니다 · 보낸 뒤에는 수정세금계산서로만 고칠 수 있습니다</span>
        </div>
        <div className="ti-cfm-body">
          {rows.map((r) => (
            <div key={r.inv.id} className={r.canSend ? "ti-cfm-row" : "ti-cfm-row ti-cfm-row-blocked"}>
              <div className="ti-cfm-row-head">
                <b>{r.eff.bizno && r.inv.counterparty_name ? r.inv.counterparty_name : (r.inv.counterparty_name || "거래처 없음")}</b>
                <span className="mono-number">{fmtWon(r.inv.total_amount)}</span>
                <span className="ev-dim">{r.inv.issue_date}</span>
                {r.kindBlocked ? (
                  <span className="ti-cfm-block">{r.kindBlocked}</span>
                ) : r.missing.length === 0 ? (
                  <span className="ti-cfm-ok">✓ 받는 쪽 정보 갖춰짐</span>
                ) : !r.canSend ? (
                  <span className="ti-cfm-block">등록번호가 없어 보낼 수 없습니다 — 아래에 채워 주세요</span>
                ) : (
                  <span className="ti-cfm-warn">빠진 칸 {r.missing.length}개 — 채우지 않아도 보내지긴 합니다</span>
                )}
              </div>
              {r.missing.length > 0 && !r.kindBlocked && (
                <div className="ti-cfm-fields">
                  {r.missing.map((f) => (
                    <label key={f.k} className="ti-cfm-field">
                      <span>{f.label}{f.must && " *"}</span>
                      <input
                        className="qk-input"
                        value={edits[r.inv.id]?.[f.k] ?? ""}
                        placeholder={f.why || f.label}
                        onChange={(e) => setEdit(r.inv.id, f.k, e.target.value)}
                      />
                    </label>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
        <div className="ti-cfm-foot">
          <label className="ti-cfm-save">
            <input type="checkbox" checked={savePartner} onChange={(e) => setSavePartner(e.target.checked)} />
            채운 값을 거래처 정보에도 저장 (다음 발행부터 자동으로 채워집니다)
          </label>
          <span className="flex-1" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={sending}>닫기</button>
          <button type="button" className="btn-primary btn-sm" onClick={send}
            disabled={sending || sendable.length === 0}>
            {sending ? "보내는 중…" : `홈택스로 전송 (${sendable.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function MatchBadge({ ok, na }: { ok: boolean; na: boolean }) {
  if (na) {
    return (
      <span className="text-xs px-2 py-0.5 rounded-full bg-gray-500/10 text-gray-500">
        N/A
      </span>
    );
  }
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${
        ok ? "bg-green-500/10 text-green-400" : "bg-red-500/10 text-red-400"
      }`}
    >
      {ok ? "일치" : "불일치"}
    </span>
  );
}
