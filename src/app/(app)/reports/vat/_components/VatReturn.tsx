"use client";

// ── 부가세 신고서 준비 — 신고기간별 신고서 항목 + 매출·매입처별 세금계산서 합계표 + 세무사 전달 엑셀 (2026-08-27 ERP 공백 ④) ──
//
//   History: 분석 › 부가세는 '예상'(원본 자료)과 '전표 기준 집계'(유형별 합)까지였다. 분기마다 실제로 하는 일 —
//   신고서 칸에 맞춰 옮겨 적기, 거래처별 합계표 뽑기, 세무사에게 보내기 — 는 밖에서 손으로 했다.
//
//   결정 60 — 기준: **확정 매입매출전표**(journal_entries entry_kind=sale_purchase, status=confirmed)의 부가세 유형. 원본(홈택스 자료)이 아니다 —
//             장부에 올린 것만 신고서에 간다(2026-08-11 대표가 "전표로 처리된 것만"). 전표 없는 자료는 재무 › 전표 현황이 센다.
//   결정 61 — 신고기간 = 1기 예정(1–3월) / 1기 확정(4–6월) / 2기 예정(7–9월) / 2기 확정(10–12월). 확정 신고는 예정분을 뺀 3개월만 — 예정 신고를 안 했으면 '반기' 칩으로 6개월.
//   결정 62 — 항목 대응: 매출 ①세금계산서 발급분[11] ②카드·현금영수증 발행분[17,22] ③영세율[12] ⑤면세매출[13, 참고] /
//             매입 ⑩세금계산서 수취분[51] ⑭기타공제(카드·현금영수증)[57,61] ⑯불공제[54, 차감] 면세매입[53,58,59 참고]. 납부(환급)세액 = 매출세액 − 공제매입세액.
//   결정 63 — 합계표는 세금계산서 유형만(11·12·13 / 51·53·54). 카드·현금영수증은 합계표에 안 들어간다(국세청 서식과 같다). 거래처는 전표 줄 거래처 → 없으면 연결 계산서의 상대.
//   결정 64 — 자동으로 못 푸는 것: 신고서 제출. 여기서는 옮겨 적을 숫자와 엑셀까지만 — 신고는 홈택스에서 사람이.

import { useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { vatType, summarizeByVatType } from "@/lib/vat-voucher";
import { todayKst } from "@/lib/kst";
import { Stat } from "@/components/query-kit";
import { useToast } from "@/components/toast";
import { TaxReturnSheet } from "@/components/tax-return-sheet";
import { computeVatForm, type FormFigures } from "@/lib/tax-forms/vat-form";
import { getScheduleInputs } from "@/lib/tax-schedule-inputs";
import { leaseSummary, deemedSummary, baddebtSummary, vatExtrasOf } from "@/lib/tax-forms/vat-schedules-input";
import { VatInputSchedules } from "./VatInputSchedules";
import { listTaxReturns, latestClosed, vatPeriodKey } from "@/lib/tax-returns";
import { Pager, usePager } from "@/components/query-kit";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { type ScheduleRow, assetCatOf, invoiceSummary, cardReceived, cardIssued, nonDeductible, assetAcquired, scheduleSnapshot, NONDED_REASONS, ASSET_CAT_LABEL, type InvoiceSummary } from "@/lib/tax-forms/vat-schedules";

//   2단계(2026-10-12) — 부속서류용으로 전표번호·법인카드·고정자산 계정 분류·차변 계정 이름을 같이 읽는다
export type VatRow = ScheduleRow;
type Row = VatRow;

export const VAT_PERIODS = [
  //   due = 신고·납부 기한(그 기간이 끝난 다음 달 25일). 2기 확정·반기는 다음 해 1/25 라 nextYear.
  { key: "1p", label: "1기 예정 (1–3월)", from: "01-01", to: "03-31", due: "04-25", nextYear: false },
  { key: "1c", label: "1기 확정 (4–6월)", from: "04-01", to: "06-30", due: "07-25", nextYear: false },
  { key: "1h", label: "1기 반기 (1–6월)", from: "01-01", to: "06-30", due: "07-25", nextYear: false },
  { key: "2p", label: "2기 예정 (7–9월)", from: "07-01", to: "09-30", due: "10-25", nextYear: false },
  { key: "2c", label: "2기 확정 (10–12월)", from: "10-01", to: "12-31", due: "01-25", nextYear: true },
  { key: "2h", label: "2기 반기 (7–12월)", from: "07-01", to: "12-31", due: "01-25", nextYear: true },
] as const;
export type VatPeriodKey = (typeof VAT_PERIODS)[number]["key"];
/** 부가세 서류 — 세무 신고 › 부가세 조회 줄 「서류」 한 줄 선택 (2026-10-12 2단계, 결정 261) */
export const VAT_DOCS = [
  { key: "return", label: "부가가치세 신고서" },
  { key: "saleTi", label: "매출처별 세금계산서합계표" },
  { key: "buyTi", label: "매입처별 세금계산서합계표" },
  { key: "saleBill", label: "매출처별 계산서합계표" },
  { key: "buyBill", label: "매입처별 계산서합계표" },
  { key: "cardIn", label: "신용카드매출전표등 수령명세서(갑)" },
  { key: "cardOut", label: "신용카드매출전표등 발행금액집계표" },
  { key: "nonDed", label: "공제받지 못할 매입세액명세서" },
  { key: "asset", label: "건물등 감가상각자산 취득명세서" },
  //   3단계 — 사람이 넣는 서류
  { key: "lease", label: "부동산임대공급가액명세서" },
  { key: "deemed", label: "의제매입세액공제신고서" },
  { key: "baddebt", label: "대손세액공제신고서" },
  { key: "refundClaim", label: "과표 및 세액경정청구서" },
] as const;
export type VatDocKey = (typeof VAT_DOCS)[number]["key"];

/** 신고·납부 기한 YYYY-MM-DD */
export const vatDueDate = (year: number, key: VatPeriodKey) => { const P = VAT_PERIODS.find((p) => p.key === key)!; return `${P.nextYear ? year + 1 : year}-${P.due}`; };
/** 오늘이 속한 신고기간 (기수만) */
export const currentVatPeriod = (): VatPeriodKey => { const m = new Date().getMonth() + 1; return m <= 3 ? "1p" : m <= 6 ? "1c" : m <= 9 ? "2p" : "2c"; };
/** 지금 신고할 기수 · 페이지 기본값 (2026-09-03 후속).
 *  지난 분기의 기한(이번 분기 첫 달 25일)이 아직 안 지났으면 지난 분기(예: 7/10 → 1기 확정), 지났으면 지금 분기.
 *  1/1~1/25 는 지난해 2기 확정이라 year 도 같이 돌려준다. */
export function vatFilingNow(today = todayKst()):  { year: number; key: VatPeriodKey } {
  const y = Number(today.slice(0, 4)), m = Number(today.slice(5, 7));
  const q = Math.ceil(m / 3);                       // 1..4
  const KEYS: VatPeriodKey[] = ["1p", "1c", "2p", "2c"];
  const prevDue = `${y}-${String((q - 1) * 3 + 1).padStart(2, "0")}-25`;   // 지난 분기 기한 = 이번 분기 첫 달 25일
  if (today <= prevDue) return q === 1 ? { year: y - 1, key: "2c" } : { year: y, key: KEYS[q - 2] };
  return { year: y, key: KEYS[q - 1] };
}
const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;
const num = (n: number) => Math.round(n || 0);

/** 직전 기수 — 같은 종류끼리 잇는다(예정→직전 확정, 확정→같은 해 예정, 반기→직전 반기). 2026-09-28 증감 한 줄용 */
export function prevVatPeriod(year: number, key: VatPeriodKey): { year: number; key: VatPeriodKey } {
  switch (key) {
    case "1p": return { year: year - 1, key: "2c" };
    case "1c": return { year, key: "1p" };
    case "1h": return { year: year - 1, key: "2h" };
    case "2p": return { year, key: "1c" };
    case "2c": return { year, key: "2p" };
    default: return { year, key: "1h" };     // 2h
  }
}

/** 확정 매입매출전표 — 신고기간 안. 이번 기수와 직전 기수가 같은 함수를 쓴다 · 전자신고 파일(lib/nts-vat-efile)도 같은 행을 읽는다 */
export async function fetchVatRows(companyId: string, from: string, to: string): Promise<Row[]> {
  const out: Row[] = []; const PAGE = 1000;
  for (let page = 0; ; page++) {
    const data = logRead("vat-return:rows", await (supabase as any).from("journal_entries")
      .select("id, entry_date, voucher_no, vat_type, supply_amount, vat_amount, description, is_electronic, tax_invoices:linked_invoice_id(counterparty_name, counterparty_bizno), journal_lines(partner_id, card_id, debit, partners(name, business_number), chart_of_accounts(code, name), corporate_cards(card_name, card_number, card_company))")
      .eq("company_id", companyId).eq("entry_kind", "sale_purchase").eq("status", "confirmed")
      .gte("entry_date", from).lte("entry_date", to).order("entry_date").range(page * PAGE, page * PAGE + PAGE - 1));
    const list = (data || []) as any[];
    for (const e of list) {
      const lines = (e.journal_lines || []) as any[];
      const pl = lines.find((l: any) => l.partners?.name);
      const name = pl?.partners?.name || e.tax_invoices?.counterparty_name || null;
      const bizno = pl?.partners?.business_number || e.tax_invoices?.counterparty_bizno || null;
      //   법인카드 — 카드사·카드 이름·끝 4자리만(카드번호 전체는 화면에 안 낸다)
      const cl = lines.find((l: any) => l.card_id);
      const cc = cl?.corporate_cards;
      const debits = lines.filter((l: any) => Number(l.debit || 0) > 0);
      const asset = debits.map((l: any) => assetCatOf(l.chart_of_accounts?.code)).find(Boolean) || null;
      out.push({ id: e.id, entry_date: e.entry_date, vat_type: e.vat_type, supply_amount: Number(e.supply_amount || 0), vat_amount: Number(e.vat_amount || 0), description: e.description,
        partnerName: name, partnerBizno: bizno, partnerKey: bizno || name || "(거래처 없음)", electronic: !!e.is_electronic,
        voucherNo: e.voucher_no ?? null,
        cardId: cl?.card_id || null,
        cardLabel: cc ? [cc.card_company, cc.card_name, cc.card_number ? `··${String(cc.card_number).replace(/[^0-9]/g, "").slice(-4)}` : ""].filter(Boolean).join(" ") : null,
        assetCat: asset,
        accountNames: debits.map((l: any) => l.chart_of_accounts?.name).filter(Boolean) });
    }
    if (list.length < PAGE) break;
  }
  return out;
}

/** 납부(환급)세액만 — 직전 기수 비교용. 앱 전체의 부가세 납부 예상(lib/vat-estimate)과 같은 계산(summarizeByVatType)이다 */
function payableOf(rows: Row[]): number {
  return summarizeByVatType(rows).payable;
}

//   2026-09-03 대표: 신고기간은 칩 줄이 아니라 연도 옆 셀렉트로 — 조회 줄에 값 칩을 늘어놓지 않는다. 상태는 페이지(세무 신고)가 들고 내려준다.
//   엑셀 내보내기는 집계(rows·R)가 이 안에 있어 exportRef 로 페이지 조회 줄 버튼에 넘긴다 — 다른 탭처럼 실행 버튼은 조회 줄 오른쪽.
export function VatReturn({ companyId, userId, canWrite, year, period, doc = "return", exportRef }: { companyId: string | null; userId?: string | null; canWrite?: boolean; year: number; period: VatPeriodKey; doc?: VatDocKey; exportRef?: MutableRefObject<(() => void) | null> }) {
  const { toast } = useToast();
  const P = VAT_PERIODS.find((p) => p.key === period)!;
  const from = `${year}-${P.from}`, to = `${year}-${P.to}`;

  const { data: rows = [], isLoading } = useQuery<Row[]>({
    queryKey: ["vat-return-rows", companyId, from, to],
    enabled: !!companyId,
    queryFn: () => fetchVatRows(companyId!, from, to),
  });
  //   직전 기수 납부세액 — 증감 한 줄(2026-09-28). 같은 쿼리 키라 그 기수를 열어 봤으면 캐시를 그대로 쓴다
  const prev = prevVatPeriod(year, period);
  const PP = VAT_PERIODS.find((p) => p.key === prev.key)!;
  const prevFrom = `${prev.year}-${PP.from}`, prevTo = `${prev.year}-${PP.to}`;
  const { data: prevRows } = useQuery<Row[]>({
    queryKey: ["vat-return-rows", companyId, prevFrom, prevTo],
    enabled: !!companyId,
    queryFn: () => fetchVatRows(companyId!, prevFrom, prevTo),
  });

  //   ── 신고서 서식 · 마감 (2026-10-12 세무 2차 1단계, 결정 258~260) ──
  //   ㉓ 예정신고 미환급세액 — 확정 신고면 같은 해 예정 신고본(마감한 숫자)의 차가감 세액이 음수(환급)일 때 그 크기를 기본값으로(결정 265 세무 이월).
  //   예정 신고 때 환급은 조기환급이 아니면 돌려받지 않고 확정 신고에서 뺀다(부가세법 59조).
  const prelimKey = period === "1c" ? "1p" : period === "2c" ? "2p" : null;
  const { data: prelimReturns = [] } = useQuery({
    queryKey: ["tax-returns", companyId, "vat", prelimKey ? vatPeriodKey(year, prelimKey) : "-"],
    enabled: !!companyId && !!prelimKey,
    queryFn: () => listTaxReturns(companyId!, "vat", vatPeriodKey(year, prelimKey!)),
  });
  const prelimFiled = latestClosed(prelimReturns);
  const prelimRefund = prelimFiled ? Math.max(0, -Math.round(Number(prelimFiled.figures?.["30"]?.tax || 0))) : 0;
  const defaultManual = useMemo<FormFigures>(() => { const m: FormFigures = {}; if (prelimRefund) m["23"] = { tax: prelimRefund }; return m; }, [prelimRefund]);
  //   3단계 — 사람이 넣은 부속서류(부동산임대·의제매입·대손·경정청구) → 신고서 ④·⑧·⑮ 에 더해진다
  const qcV = useQueryClient();
  const { data: inputs = {} } = useQuery({
    queryKey: ["tax-schedule-inputs", companyId, vatPeriodKey(year, period)],
    enabled: !!companyId,
    queryFn: () => getScheduleInputs(companyId!, vatPeriodKey(year, period)),
  });
  const LS = useMemo(() => leaseSummary(inputs.lease, from, to), [inputs.lease, from, to]);
  const DS = useMemo(() => deemedSummary(inputs.deemed, rows.filter((x) => x.vat_type === "53" || x.vat_type === "58")), [inputs.deemed, rows]);
  const BS = useMemo(() => baddebtSummary(inputs.baddebt), [inputs.baddebt]);
  const extras = useMemo(() => vatExtrasOf(LS, DS, BS), [LS, DS, BS]);
  const computeForm = useMemo(() => (m: FormFigures) => computeVatForm(rows, m, extras), [rows, extras]);
  const [liveFigures, setLiveFigures] = useState<FormFigures>({});
  const sources = useMemo(() => ({ entries: rows.map((x) => x.id) }), [rows]);

  const R = useMemo(() => {
    const by = (codes: string[]) => { const r = rows.filter((x) => codes.includes(String(x.vat_type || ""))); return { n: r.length, supply: r.reduce((s, x) => s + x.supply_amount, 0), vat: r.reduce((s, x) => s + x.vat_amount, 0) }; };
    const s11 = by(["11"]), s17 = by(["17", "22"]), s12 = by(["12"]), s13 = by(["13"]);
    const p51 = by(["51"]), p57 = by(["57", "61"]), p54 = by(["54"]), p53 = by(["53", "58", "59"]);
    const salesVat = s11.vat + s17.vat + s12.vat;
    const deductible = p51.vat + p57.vat;           // 불공제(54)는 뺀다
    const unknown = rows.filter((x) => !vatType(x.vat_type)).length;
    return { s11, s17, s12, s13, p51, p57, p54, p53, salesVat, deductible, payable: salesVat - deductible, unknown };
  }, [rows]);

  //   ── 부속서류 (2026-10-12 세무 2차 2단계, 결정 261) ──
  //   세금계산서와 계산서는 서식이 다르다 — 예전 합계표는 계산서(13·53)를 같이 섞어 셌다. 지금은 서류를 나눈다.
  const S = useMemo(() => ({
    saleTi: invoiceSummary(rows, ["11", "12"]), buyTi: invoiceSummary(rows, ["51", "54"]),
    saleBill: invoiceSummary(rows, ["13"]), buyBill: invoiceSummary(rows, ["53"]),
    cardIn: cardReceived(rows), cardOut: cardIssued(rows), asset: assetAcquired(rows),
  }), [rows]);
  //   불공제 사유 — 계정으로 추천, 사람이 바꾼다. 마감한 신고본이 있으면 그때 고른 사유에서 시작(신고본과 같은 쿼리 키라 캐시 공유)
  const { data: thisReturns = [] } = useQuery({
    queryKey: ["tax-returns", companyId, "vat", vatPeriodKey(year, period)],
    enabled: !!companyId,
    queryFn: () => listTaxReturns(companyId!, "vat", vatPeriodKey(year, period)),
  });
  const filedNow = latestClosed(thisReturns);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const reasonSeed = useRef("");
  useEffect(() => {
    const key = `${year}-${period}|${filedNow?.id || "none"}`;
    if (reasonSeed.current === key) return;
    reasonSeed.current = key;
    setReasons(((filedNow?.schedules as any)?.nonDeductible?.reasons || {}) as Record<string, string>);
  }, [year, period, filedNow]);
  const ND = useMemo(() => nonDeductible(rows, reasons), [rows, reasons]);
  const schedules = useMemo(() => ({
    ...scheduleSnapshot(rows, reasons),
    lease: { input: inputs.lease || null, deemed: LS.deemed, rent: LS.rent, maint: LS.maint, total: LS.total },
    deemed: { input: inputs.deemed || null, amount: DS.amount, tax: DS.tax, groups: DS.groups },
    baddebt: { input: inputs.baddebt || null, deductedTax: BS.deductedTax, recoveredTax: BS.recoveredTax, line8: BS.line8 },
    refundClaim: inputs.refund_claim || null,
  }), [rows, reasons, inputs, LS, DS, BS]);

  //   건별 상세 팝업 — 합계표 거래처 줄·카드 줄·감가상각 분류 줄을 누르면 그 전표들
  const [drill, setDrill] = useState<{ title: string; ids: string[] } | null>(null);
  useModalKeys(!!drill, () => setDrill(null));
  const drillRows = useMemo(() => { if (!drill) return []; const set = new Set(drill.ids); return rows.filter((x) => set.has(x.id)); }, [drill, rows]);

  //   표 쪽 넘김 — 서류마다 명세 줄이 다르다. 훅은 하나, 지금 서류의 줄만 넘긴다(기본 50줄)
  const detail: unknown[] = doc === "saleTi" ? S.saleTi.partners : doc === "buyTi" ? S.buyTi.partners : doc === "saleBill" ? S.saleBill.partners
    : doc === "buyBill" ? S.buyBill.partners : doc === "cardIn" ? S.cardIn.cards : doc === "nonDed" ? ND.rows : doc === "asset" ? S.asset.rows : [];
  const pager = usePager(detail, 50, `${doc}|${year}|${period}`);

  const exportXlsx = () => {
    if (!rows.length) { toast("내보낼 전표가 없습니다", "info"); return; }
    const wb = XLSX.utils.book_new();
    const F = computeVatForm(rows, {});
    const sheet1 = [
      ["부가가치세 신고서", `${year}년 ${P.label}`, `${from} ~ ${to}`, "확정 매입매출전표 기준 (오너뷰) · 직접 입력 칸은 화면에서"], [],
      ["칸", "항목", "금액", "세액"],
      ...[["1", "과세 세금계산서 발급분"], ["3", "과세 신용카드·현금영수증 발행분"], ["5", "영세 세금계산서 발급분"], ["9", "매출 합계 ㉮"],
        ["10", "세금계산서 수취분 일반매입"], ["12", "세금계산서 수취분 고정자산 매입"], ["15", "그 밖의 공제매입세액"], ["16", "매입 합계"],
        ["17", "공제받지 못할 매입세액"], ["18", "차감계 ㉯"], ["da", "납부(환급)세액 ㉰"], ["30", "차가감 납부할 세액"]]
        .map(([k, l]) => [k === "da" ? "" : `(${k})`, l, num(F[k]?.amount || 0), num(F[k]?.tax || 0)]),
    ];
    const ws1 = XLSX.utils.aoa_to_sheet(sheet1); ws1["!cols"] = [{ wch: 6 }, { wch: 36 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws1, "신고서");
    const inv = (t: InvoiceSummary, withVat: boolean) => [
      ["구분", "거래처 수", "매수", "공급가액", ...(withVat ? ["세액"] : [])],
      ...([["합계", t.total], ["전자 발급분", t.electronic], ["전자 외", t.paper]] as const).map(([l, x]) => [l, x.partners, x.n, num(x.supply), ...(withVat ? [num(x.vat)] : [])]),
      [],
      ["거래처", "사업자번호", "전자", "매수", "공급가액", ...(withVat ? ["세액"] : [])],
      ...t.partners.map((r) => [r.name, r.bizno || "", r.electronic ? "전자" : "전자 외", r.n, num(r.supply), ...(withVat ? [num(r.vat)] : [])]),
    ];
    const add = (aoa: unknown[][], name: string) => { const ws = XLSX.utils.aoa_to_sheet(aoa); ws["!cols"] = [{ wch: 28 }, { wch: 14 }, { wch: 8 }, { wch: 8 }, { wch: 16 }, { wch: 14 }]; XLSX.utils.book_append_sheet(wb, ws, name); };
    add(inv(S.saleTi, true), "매출처별 세금계산서합계표");
    add(inv(S.buyTi, true), "매입처별 세금계산서합계표");
    add(inv(S.saleBill, false), "매출처별 계산서합계표");
    add(inv(S.buyBill, false), "매입처별 계산서합계표");
    add([["구분", "거래건수", "공급가액", "세액"], ["합계", S.cardIn.total.n, num(S.cardIn.total.supply), num(S.cardIn.total.vat)], ["현금영수증", S.cardIn.cash.n, num(S.cardIn.cash.supply), num(S.cardIn.cash.vat)],
      ["사업용 신용카드", S.cardIn.biz.n, num(S.cardIn.biz.supply), num(S.cardIn.biz.vat)], ["그 밖의 신용카드", S.cardIn.other.n, num(S.cardIn.other.supply), num(S.cardIn.other.vat)], [],
      ["카드", "거래건수", "공급가액", "세액"], ...S.cardIn.cards.map((c) => [c.label, c.n, num(c.supply), num(c.vat)])], "카드 수령명세서");
    add([["구분", "합계", "신용·직불카드", "현금영수증"], ["과세 매출분", num(S.cardOut.total), num(S.cardOut.card.amount), num(S.cardOut.cash.amount)]], "카드 발행집계표");
    add([["사유", "매수", "공급가액", "세액"], ...ND.byReason.map((r) => [`${r.code}. ${r.label}`, r.n, num(r.supply), num(r.vat)]), [],
      ["일자", "거래처", "계정", "공급가액", "세액", "사유"], ...ND.rows.map((x) => [x.entry_date, x.partnerName || "", (x.accountNames || []).join(", "), num(x.supply_amount), num(x.vat_amount), NONDED_REASONS.find((r) => r.code === ND.reasonOf(x))?.label || ""])], "불공제 명세서");
    add([["구분", "건수", "공급가액", "세액"], ["합계", S.asset.total.n, num(S.asset.total.supply), num(S.asset.total.vat)], ...S.asset.cats.map((c) => [c.label, c.n, num(c.supply), num(c.vat)])], "감가상각자산 취득명세서");
    const ws4 = XLSX.utils.json_to_sheet(rows.map((x) => ({ 일자: x.entry_date, 전표번호: x.voucherNo ?? "", 유형: vatType(x.vat_type)?.label || x.vat_type || "", 거래처: x.partnerName || "", 사업자번호: x.partnerBizno || "", 전자: x.electronic ? "전자" : "", 공급가액: num(x.supply_amount), 세액: num(x.vat_amount), 적요: x.description || "" })));
    XLSX.utils.book_append_sheet(wb, ws4, "전표 목록");
    XLSX.writeFile(wb, `부가세신고_${year}_${P.label.replace(/\s|\(|\)|–/g, "")}.xlsx`);
  };

  useEffect(() => { if (!exportRef) return; exportRef.current = exportXlsx; return () => { exportRef.current = null; }; });

  const docLabel = VAT_DOCS.find((d) => d.key === doc)?.label || "";
  const T3 = ({ rows: list, withVat = true, partnersCol = false }: { rows: [string, { n: number; supply: number; vat: number; partners?: number }][]; withVat?: boolean; partnersCol?: boolean }) => (
    <table className="rtf-table">
      <thead><tr><th>구분</th>{partnersCol && <th>거래처 수</th>}<th>{partnersCol ? "매수" : "건수"}</th><th>공급가액</th>{withVat && <th>세액</th>}</tr></thead>
      <tbody>{list.map(([l, x], i) => (
        <tr key={l} className={i === 0 ? "rtf-sum" : undefined}><td className="rtf-label">{l}</td>{partnersCol && <td className="rtf-num">{won(x.partners || 0).replace("₩", "")}</td>}
          <td className="rtf-num">{x.n.toLocaleString("ko-KR")}</td><td className="rtf-num">{won(x.supply)}</td>{withVat && <td className="rtf-num">{won(x.vat)}</td>}</tr>
      ))}</tbody>
    </table>
  );
  const invoiceDoc = (t: InvoiceSummary, side: "sale" | "buy", withVat: boolean) => (
    <>
      <T3 partnersCol withVat={withVat} rows={[["합계", t.total], [side === "sale" ? "전자 발급분" : "전자 수취분", t.electronic], ["전자 외", t.paper]]} />
      <p className="rtf-legend">아래는 거래처별 명세입니다. 국세청 서식은 <b>전자 외</b> 분만 거래처별로 적고, 전자 발급분은 합계만 적습니다. 줄을 누르면 그 거래처의 전표 목록이 열립니다.</p>
      <div className="ev-scroll">
        <table className="ev-table ev-lined rtf-detail">
          <thead><tr><th>거래처</th><th>사업자번호</th><th>구분</th><th>매수</th><th>공급가액</th>{withVat && <th>세액</th>}</tr></thead>
          <tbody>
            {(pager.view as InvoiceSummary["partners"]).map((r) => (
              <tr key={r.key} className="rtf-click" onClick={() => setDrill({ title: `${docLabel} · ${r.name}`, ids: r.ids })}>
                <td className="text-left">{r.name}</td><td className="tc mono-number">{r.bizno || <span className="ev-dim">—</span>}</td>
                <td className="tc">{r.electronic ? "전자" : <b>전자 외</b>}</td><td className="tr mono-number">{r.n}</td><td className="tr mono-number">{won(r.supply)}</td>{withVat && <td className="tr mono-number">{won(r.vat)}</td>}
              </tr>
            ))}
            {!t.partners.length && <tr><td colSpan={withVat ? 6 : 5} className="tc ev-dim">이 기간에 해당 전표가 없습니다</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );

  const docView = () => {
    switch (doc) {
      case "saleTi": return invoiceDoc(S.saleTi, "sale", true);
      case "buyTi": return invoiceDoc(S.buyTi, "buy", true);
      case "saleBill": return invoiceDoc(S.saleBill, "sale", false);
      case "buyBill": return invoiceDoc(S.buyBill, "buy", false);
      case "cardIn": return (
        <>
          <T3 rows={[["합계", S.cardIn.total], ["현금영수증", S.cardIn.cash], ["화물운전자 복지카드", { n: 0, supply: 0, vat: 0 }], ["사업용 신용카드", S.cardIn.biz], ["그 밖의 신용카드", S.cardIn.other]]} />
          <p className="rtf-legend">공제받는 카드(57)·현금영수증(61) 매입입니다. 사업용 신용카드 = 법인카드로 등록된 카드, 그 밖의 = 전표에 카드가 없는 건(직원 개인카드 등). 화물운전자 복지카드는 구분하지 않습니다 — 해당하면 세무사와 옮기세요. 줄을 누르면 전표 목록.</p>
          <div className="ev-scroll">
            <table className="ev-table ev-lined rtf-detail">
              <thead><tr><th>카드</th><th>거래건수</th><th>공급가액</th><th>세액</th></tr></thead>
              <tbody>
                {S.cardIn.cash.n > 0 && <tr className="rtf-click" onClick={() => setDrill({ title: "현금영수증 수취분", ids: S.cardIn.cashIds })}><td className="text-left">현금영수증</td><td className="tr mono-number">{S.cardIn.cash.n}</td><td className="tr mono-number">{won(S.cardIn.cash.supply)}</td><td className="tr mono-number">{won(S.cardIn.cash.vat)}</td></tr>}
                {(pager.view as ReturnType<typeof cardReceived>["cards"]).map((c) => (
                  <tr key={c.key} className="rtf-click" onClick={() => setDrill({ title: `카드 수령 · ${c.label}`, ids: c.ids })}><td className="text-left">{c.label}</td><td className="tr mono-number">{c.n}</td><td className="tr mono-number">{won(c.supply)}</td><td className="tr mono-number">{won(c.vat)}</td></tr>
                ))}
                {!S.cardIn.total.n && <tr><td colSpan={4} className="tc ev-dim">이 기간에 카드·현금영수증 공제 매입이 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      );
      case "cardOut": return (
        <>
          <table className="rtf-table">
            <thead><tr><th>구분</th><th>합계</th><th>신용·직불·기명식 선불카드</th><th>현금영수증</th></tr></thead>
            <tbody>
              <tr className="rtf-sum"><td className="rtf-label">합계</td><td className="rtf-num">{won(S.cardOut.total)}</td><td className="rtf-num">{won(S.cardOut.card.amount)}</td><td className="rtf-num">{won(S.cardOut.cash.amount)}</td></tr>
              <tr><td className="rtf-label">과세 매출분</td><td className="rtf-num">{won(S.cardOut.total)}</td>
                <td className="rtf-num rtf-click" onClick={() => S.cardOut.card.n && setDrill({ title: "카드 매출(17)", ids: S.cardOut.card.ids })}>{won(S.cardOut.card.amount)}</td>
                <td className="rtf-num rtf-click" onClick={() => S.cardOut.cash.n && setDrill({ title: "현금영수증 매출(22)", ids: S.cardOut.cash.ids })}>{won(S.cardOut.cash.amount)}</td></tr>
              <tr><td className="rtf-label">면세 매출분</td><td className="rtf-num">0</td><td className="rtf-num">0</td><td className="rtf-num">0</td></tr>
              <tr><td className="rtf-label">봉사료</td><td className="rtf-num">0</td><td className="rtf-num">0</td><td className="rtf-num">0</td></tr>
            </tbody>
          </table>
          <p className="rtf-legend">발행금액은 공급대가(공급가액+세액)입니다. 면세 카드매출·봉사료 유형은 오너뷰에 없어 0으로 둡니다. 금액 칸을 누르면 전표 목록.</p>
        </>
      );
      case "nonDed": return (
        <>
          <T3 rows={[["합계", ND.total], ...ND.byReason.map((r) => [`${r.code}. ${r.label}`, r] as [string, { n: number; supply: number; vat: number }])]} />
          <p className="rtf-legend">사유는 계정과목으로 추천했습니다(접대·기업업무추진 → 4, 차량·유류 → 3, 그 밖 → 2). 틀리면 줄마다 고르세요 — 고른 사유는 <b>마감할 때</b> 신고본에 같이 남습니다. 공통매입세액 안분(면세사업 겸영)은 계산하지 않습니다.</p>
          <div className="ev-scroll">
            <table className="ev-table ev-lined rtf-detail">
              <thead><tr><th>일자</th><th>거래처</th><th>계정</th><th>공급가액</th><th>세액</th><th>사유</th></tr></thead>
              <tbody>
                {(pager.view as ScheduleRow[]).map((x) => (
                  <tr key={x.id}>
                    <td className="tc mono-number">{x.entry_date}</td><td className="text-left">{x.partnerName || "—"}</td><td className="text-left">{(x.accountNames || []).join(", ") || "—"}</td>
                    <td className="tr mono-number">{won(x.supply_amount)}</td><td className="tr mono-number">{won(x.vat_amount)}</td>
                    <td className="tc">
                      <select className="qk-input h-7 px-2 text-xs" disabled={!canWrite} value={ND.reasonOf(x)} aria-label="불공제 사유"
                        onChange={(e) => setReasons((m) => ({ ...m, [x.id]: e.target.value }))}>
                        {NONDED_REASONS.map((r) => <option key={r.code} value={r.code}>{r.code}. {r.label}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
                {!ND.rows.length && <tr><td colSpan={6} className="tc ev-dim">이 기간에 공제받지 못할 매입(54)이 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      );
      case "asset": return (
        <>
          <table className="rtf-table">
            <thead><tr><th>구분</th><th>건수</th><th>공급가액</th><th>세액</th></tr></thead>
            <tbody>
              <tr className="rtf-sum"><td className="rtf-label">합계</td><td className="rtf-num">{S.asset.total.n}</td><td className="rtf-num">{won(S.asset.total.supply)}</td><td className="rtf-num">{won(S.asset.total.vat)}</td></tr>
              {S.asset.cats.map((c) => (
                <tr key={c.cat} className={c.n ? "rtf-click" : undefined} onClick={() => c.n && setDrill({ title: `감가상각자산 · ${c.label}`, ids: c.ids })}>
                  <td className="rtf-label">{c.label}</td><td className="rtf-num">{c.n}</td><td className="rtf-num">{won(c.supply)}</td><td className="rtf-num">{won(c.vat)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="rtf-legend">공제받는 매입(세금계산서 51·카드 57·현금영수증 61) 중 전표 차변이 고정자산 계정(건물 202·구축물 204·기계장치 206·차량운반구 208·공구와기구 210·비품 212·소프트웨어 240)인 건입니다. 이 중 세금계산서분 {won(S.asset.taxInvoice.supply)}은 신고서 ⑫ 고정자산 매입에 들어갑니다.</p>
          <div className="ev-scroll">
            <table className="ev-table ev-lined rtf-detail">
              <thead><tr><th>일자</th><th>거래처</th><th>분류</th><th>유형</th><th>공급가액</th><th>세액</th></tr></thead>
              <tbody>
                {(pager.view as ScheduleRow[]).map((x) => (
                  <tr key={x.id}><td className="tc mono-number">{x.entry_date}</td><td className="text-left">{x.partnerName || "—"}</td><td className="tc">{x.assetCat ? ASSET_CAT_LABEL[x.assetCat] : ""}</td>
                    <td className="tc">{vatType(x.vat_type)?.label || x.vat_type}</td><td className="tr mono-number">{won(x.supply_amount)}</td><td className="tr mono-number">{won(x.vat_amount)}</td></tr>
                ))}
                {!S.asset.rows.length && <tr><td colSpan={6} className="tc ev-dim">이 기간에 고정자산 계정으로 받은 매입이 없습니다</td></tr>}
              </tbody>
            </table>
          </div>
        </>
      );
      default: return null;
    }
  };

  return (
    <div className="vr-wrap">
      <div className="qk-strip vr-stats">
        <Stat label="매출세액" value={won(R.salesVat)} />
        <Stat label="공제 매입세액" value={won(R.deductible)} />
        <Stat label="불공제" value={won(R.p54.vat)} tone={R.p54.vat ? "minus" : undefined} />
        <Stat label={`${P.label} ${R.payable >= 0 ? "납부 예상" : "환급 예상"}`} title="이 신고기간 전표만 집계 · 위 전표 기준 카드의 연간 누계와 기간이 달라 값이 다를 수 있습니다" value={won(Math.abs(R.payable))} tone={R.payable > 0 ? "minus" : "plus"} />
        <Stat label="전표" value={`${rows.length}건`} />
      </div>
      <p className="inv-hint">{from} ~ {to}  확정 매입매출전표 기준 · 홈택스 원본이 아니라  <b>장부에 올린 것</b>만. 전표 없는 자료는 재무 › 전표 현황 › 처리할 것에서. 신고는 홈택스에서 사람이 합니다.{R.unknown ? <b className="vr-warn"> · 부가세 유형이 비어 있는 전표 {R.unknown}건은 어느 칸에도 못 들어갔습니다. 매입매출전표에서 유형을 채우세요.</b> : null}</p>
      {isLoading ? <div className="collect-empty">전표를 읽는 중…</div> : (
        <>
          {/*   신고서(마감 줄 포함)는 다른 서류를 보는 동안에도 숨겨 둔 채 유지한다 — 직접 입력한 칸이 사라지지 않게 */}
          <div className={doc === "return" ? undefined : "hidden"}>
            {/*   서식 화면이 예전 '옮겨 적을 숫자' 표 두 개(과세표준·매입세액)를 대신한다(결정 260 — 중복 금지) */}
            <TaxReturnSheet layout="vat" kind="vat" companyId={companyId} userId={userId ?? null} canWrite={!!canWrite}
              periodKey={vatPeriodKey(year, period)} title={`일반과세자 부가가치세 신고서 · ${year}년 ${P.label}`}
              compute={computeForm} sources={sources} loading={isLoading} schedules={schedules} onFigures={setLiveFigures}
              defaultManual={defaultManual}
              defaultManualNote={prelimRefund ? `㉓ 예정신고 미환급세액 ${won(prelimRefund)}은 ${year}년 ${prelimKey === "1p" ? "1기" : "2기"} 예정 신고본(마감한 숫자)에서 채웠습니다.` : undefined} />
            {/* 직전 기수 대비 — 같은 종류(예정↔확정·반기)끼리. 전표가 없는 기수는 비교하지 않는다 */}
            <p className="inv-hint">
              {(() => {
                if (!prevRows) return <span className="ev-dim">직전 기수 읽는 중…</span>;
                const label = `${prev.year}년 ${PP.label.replace(/\s\(.*\)$/, "")}`;
                if (prevRows.length === 0) return <span className="ev-dim">직전 기수({label})는 확정 전표가 없어 비교하지 않습니다</span>;
                const p = payableOf(prevRows), d = R.payable - p;
                const pct = p !== 0 ? Math.round((d / Math.abs(p)) * 100) : null;
                return <>직전 기수({label}) {p >= 0 ? "납부" : "환급"} <b className="mono-number">{won(Math.abs(p))}</b> 대비 이번 기수 납부(환급)세액㉰ <b className={`mono-number ${d > 0 ? "vr-warn" : ""}`}>{d > 0 ? "▲" : d < 0 ? "▼" : "="} {won(Math.abs(d))}{pct !== null ? ` (${d > 0 ? "+" : d < 0 ? "−" : ""}${Math.abs(pct)}%)` : ""}</b></>;
              })()}
            </p>
          </div>
          {doc !== "return" && (
            <div className="rtf-wrap">
              <div className="rtf-close"><span className="rtf-close-state"><b>{docLabel}</b> · {year}년 {P.label}{filedNow ? " · 신고서를 마감하면 이 숫자도 신고본에 같이 남습니다" : ""}</span></div>
              {doc === "lease" || doc === "deemed" || doc === "baddebt" || doc === "refundClaim"
                ? <VatInputSchedules doc={doc} companyId={companyId} periodKey={vatPeriodKey(year, period)} from={from} to={to} canWrite={!!canWrite}
                    rows={rows} inputs={inputs} onSaved={() => qcV.invalidateQueries({ queryKey: ["tax-schedule-inputs", companyId, vatPeriodKey(year, period)] })}
                    filed={filedNow ? { figures: filedNow.figures, revision: filedNow.revision, closed_at: filedNow.closed_at } : null} current={liveFigures} />
                : docView()}
              {detail.length > 0 && <Pager page={pager.page} pages={pager.pages} total={detail.length} size={50} from={pager.from} to={pager.to} onPage={pager.setPage} />}
            </div>
          )}
        </>
      )}
      {drill && (
        <div className="rtf-drill-overlay" onClick={() => setDrill(null)}>
          <div className="rtf-drill" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={drill.title}>
            <div className="rtf-drill-head"><b>{drill.title}</b><span>{drillRows.length}건 · 공급가액 {won(drillRows.reduce((s, x) => s + x.supply_amount, 0))}</span>
              <button type="button" className="btn-secondary btn-sm" onClick={() => setDrill(null)}>닫기</button></div>
            <div className="rtf-drill-body">
              <table className="ev-table ev-lined">
                <thead><tr><th>일자</th><th>전표번호</th><th>유형</th><th>거래처</th><th>전자</th><th>공급가액</th><th>세액</th><th>적요</th></tr></thead>
                <tbody>{drillRows.map((x) => (
                  <tr key={x.id}><td className="tc mono-number">{x.entry_date}</td><td className="tc mono-number">{x.voucherNo ?? "—"}</td><td className="tc">{vatType(x.vat_type)?.label || x.vat_type}</td>
                    <td className="text-left">{x.partnerName || "—"}</td><td className="tc">{x.electronic ? "전자" : ""}</td>
                    <td className="tr mono-number">{won(x.supply_amount)}</td><td className="tr mono-number">{won(x.vat_amount)}</td><td className="text-left">{x.description || ""}</td></tr>
                ))}</tbody>
              </table>
            </div>
            <p className="rtf-legend">전표를 고치려면 재무 › 매입매출전표에서 같은 기간을 여세요. 고친 뒤 마감한 신고서와 달라지면 신고서에 '수정신고' 표시가 뜹니다.</p>
          </div>
        </div>
      )}
    </div>
  );
}
