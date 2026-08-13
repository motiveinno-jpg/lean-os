"use client";

// 수집·전표 2단계 — 자료별 조회 + 전표 만들기 (2026-08-11)
//
//   화면을 옮기지 않고 여기서 끝낸다. 목록에 **차변·대변 계정이 미리 채워져** 있고,
//   고른 줄을 그대로 전표로 만든다.
//
//   ★ 격자·분개는 새로 만들지 않는다 — 매입매출전표가 쓰는 lib/vat-voucher(유형 10종·분개 생성·
//     음수 처리)와 save_sale_purchase_voucher RPC 를 그대로 쓴다. 두 화면의 결과가 달라지면 안 된다.
//
//   계정 추천 = **같은 거래처로 지난번에 쓴 계정**. 4단계(자동분개 학습)의 뿌리다.
//   지금은 규칙을 따로 저장하지 않고 이미 만든 전표를 되읽는다 — 사람이 고른 것이 곧 근거다.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { appConfirm } from "@/components/global-confirm";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ChipGroup, RowsPerPage, ResultStrip, Stat, HelperMenu, SelectionBar,
  ExcelMenu, type ExcelItem,
  Pager, usePager, ConditionPanel, ConditionRow, TokenField, AmountRange, AppliedChips,
  QuickSearch, quickSearchHit, quickTerms, amountHit, periodQuicks,
  useSavedQueries, SavedTabs, ConditionSave, defaultRange, type HelperItem, type AppliedChip,
} from "@/components/query-kit";
import { DateRangeField } from "@/components/date-range-field";
import { SortableTh, nextSort, cmp, useColWidths, type SortState, type ThFilterSpec } from "@/components/sortable-th";
import { PickList } from "@/components/pick-list";
import { fetchMerchantKinds, fillMerchantKinds, type MerchantInfo } from "@/lib/merchant-tax-type";
import { UNCLASSIFIED_CATEGORY } from "@/lib/card-vat-classification";
import { cashReceiptSign } from "@/lib/cash-receipts";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import {
  VAT_TYPES, STD, buildVoucherLines, vatType, suggestVatType, normalizeSides,
  type SettleType,
} from "@/lib/vat-voucher";
import type { SourceKey } from "@/lib/collect";
import { fetchRuleMap, ruleKeyOf, learnAccount, ruleTag, type RuleKind } from "@/lib/voucher-rules";
import { fetchAllPages } from "@/lib/fetch-all";
import { exportToExcel } from "@/lib/excel-export";
import { downloadAccountFillSheet, parseAccountFill } from "@/lib/account-fill-excel";

type Acct = { id: string; code: string; name: string; account_type: string };
type Row = {
  id: string;
  date: string;
  partnerId: string | null;
  partnerName: string;
  bizno: string;
  item: string;
  supply: number;
  vat: number;
  vatCode: string;
  settle: SettleType;
  posted: boolean;
  voucherNo: number | null;
  /** 이 줄이 만든 전표 — 취소(되돌리기)할 때 쓴다 */
  entryId?: string | null;
  /** 카드 비목 — 회사설정의 '카드 비목 → 계정' 매핑을 찾는 열쇠 */
  cardCategory?: string | null;
  /** 카드 이름 — 미지급금 줄에 걸 **카드사 거래처**를 찾는 열쇠 (거래처원장에서 카드대금 대조) */
  cardName?: string | null;
};

const won = (n: number) => Math.round(Number(n) || 0).toLocaleString("ko-KR");
//   카드 자동분류는 {"label":"통신비",…} JSON 문자열이라 이름만 꺼낸다 (다른 화면과 같은 규칙)
function cardLabelOf(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return "";
  if (v.startsWith("{")) { try { return String(JSON.parse(v)?.label || "").trim(); } catch { return ""; } }
  return v;
}

/** 표준 계정(상대·부가세)은 추천 대상이 아니다 — 사람이 고르는 건 매출·비용 계정이다 */
const STD_CODES = new Set<string>([STD.bank, STD.ar, STD.vatIn, STD.ap, STD.payable, STD.vatOut]);

//   '3. 일반' — 부가세 유형 코드가 아니라 **일반전표로 보내라**는 표시다.
//   국세청 부가세 유형(11·51·57…)과 겹치지 않는 값이라 섞일 일이 없다 (2026-08-12).
const GENERAL_CODE = "3";

/** 표 머리단 정렬 열쇠 — 칸 하나에 하나씩 (2026-08-12) */
type SortKey = "date" | "partner" | "bizno" | "kind" | "vat" | "item"
  | "supply" | "tax" | "total" | "debit" | "state";

/**
 * 검색조건 — 갖춰서 찾는 값들 (2026-08-13 조회 화면 표준).
 *   ★ 여기 있는 것은 **'조회'를 눌러야** 반영된다. 기간·빠른검색·상태는 조회 줄에 있어 즉시다.
 *   거래처·계정과목·카드는 **여러 개**를 고를 수 있다(하나라도 맞으면 나온다).
 */
type Cond = {
  partner: string[];   // 거래처 이름
  acct: string[];      // 계정과목 코드
  card: string[];      // 카드 이름 (카드 탭만)
  kind: string;        // 구분 — 법인·일반·간이·면세 (카드 탭만)
  dir: "all" | "sale" | "purchase";
  todo: "todo" | "all"; // 전표 미처리만 볼지 — 검색조건 안으로 옮겼다(2026-08-13 사장님 지시)
  item: string;        // 품명
  min: string; max: string;   // 합계 금액 범위
  size: number;        // 한 쪽에 몇 줄 — 조건의 하나라 '내 조건'에 같이 저장된다
};
const EMPTY: Cond = { partner: [], acct: [], card: [], kind: "", dir: "all", todo: "todo", item: "", min: "", max: "", size: 50 };
/** 배지에 셀 것 — 줄 수는 '좁히는 조건'이 아니라 보기 방식이라 안 센다 */
const condCount = (c: Cond) =>
  c.partner.length + c.acct.length + c.card.length
  + (c.kind ? 1 : 0) + (c.dir !== "all" ? 1 : 0) + (c.todo !== "todo" ? 1 : 0)
  + (c.item ? 1 : 0) + ((c.min || c.max) ? 1 : 0);

const DIR_CHIPS = [
  { value: "all", label: "전체" }, { value: "sale", label: "매출" }, { value: "purchase", label: "매입" },
] as const;
const STATE_CHIPS = [
  { value: "todo", label: "전표 미처리" }, { value: "all", label: "전체" },
] as const;
//   구분 — merchantKindOf 가 돌려주는 값 그대로 (lib/merchant-tax-type)
const KIND_CHIPS = [
  { value: "", label: "전체" }, { value: "법인", label: "법인" }, { value: "일반", label: "일반" },
  { value: "간이", label: "간이" }, { value: "면세", label: "면세" },
] as const;

const SETTLE_BY_KIND: Record<string, SettleType> = {
  tax_invoice: "credit", exempt_invoice: "credit", cash_receipt: "cash", card: "card",
};

export function EvidenceTab({
  companyId, from, to, kind, tabsNode, onRange, syncButton, rulesHelper,
}: {
  companyId: string; from: string; to: string; kind: SourceKey;
  /** 조회 줄 공통 조각 — 화면(page.tsx)이 만들어 내려보낸다.
   *  기간 칸은 검색조건과 한 덩어리라 **탭이 직접 그린다** — 값과 바꾸는 함수만 받는다. */
  onRange: (from: string, to: string) => void;
  tabsNode: ReactNode; syncButton: ReactNode; rulesHelper: HelperItem;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  //   조회 줄에 있는 것은 **즉시** 반영된다 (기간은 page.tsx 가 쥐고 있다)
  const [q, setQ] = useState("");
  //   검색조건 패널 — draft 는 고르는 중, live 는 '조회'를 눌러 확정된 것
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Cond>(EMPTY);
  const [live, setLive] = useState<Cond>(EMPTY);
  const setD = <K extends keyof Cond>(k: K) => (v: Cond[K]) => setDraft((c) => ({ ...c, [k]: v }));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [override, setOverride] = useState<Record<string, { vatCode?: string; acct?: Acct }>>({});
  const [pick, setPick] = useState<{ id: string; q: string } | null>(null);
  const [saving, setSaving] = useState(false);
  //   머리단 정렬 — 기본은 일자 오름차순(장부는 날짜 순으로 본다) (2026-08-12)
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "date", dir: "asc" });
  /*   ── 엑셀식 머리단 필터 + 열 너비 (2026-08-13 사장님: "엑셀과 아예 동일하게") ──
   *   colVal 이 칸의 표시값을 뽑는 단 하나의 기준 — 필터 목록과 거르기가 같은 값을 본다. */
  const [colF, setColF] = useState<Record<string, Set<string> | null>>({});
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths(`collect-ev-colw-${kind}`, {
    date: 64, partner: 150, bizno: 110, kind: 72, vat: 130, item: 150,
    supply: 92, tax: 84, total: 96, debit: 130, credit: 130, state: 84,
  });
  const colVal = (r: Row, k: string): string => {
    switch (k) {
      case "date": return r.date.slice(5);
      case "partner": return r.partnerName || "";
      case "bizno": return r.bizno || "";
      case "kind": return merchantOf(r)?.kind ?? "";
      case "vat": return vatType(vatCodeOf(r))?.label ?? "";
      case "item": return r.item || "";
      case "supply": return amountsOf(r).supply.toLocaleString("ko");
      case "tax": return amountsOf(r).vat.toLocaleString("ko");
      case "total": return (amountsOf(r).supply + amountsOf(r).vat).toLocaleString("ko");
      case "debit": { const a = acctOf(r).acct; return a ? `${a.code} ${a.name}` : ""; }
      case "state": return r.posted ? "전표됨" : "미처리";
      default: return "";
    }
  };
  const colHit = (r: Row): boolean =>
    Object.entries(colF).every(([k, set]) => !set || set.has(colVal(r, k)));
  /** 머리단 필터 명세 — 목록은 다른 칸 필터·검색을 거친 뒤 기준(엑셀과 같은 좁혀 들어가기) */
  const thFilter = (k: string, base: Row[]): ThFilterSpec => ({
    values: base
      .filter((r) => Object.entries(colF).every(([kk, set]) => kk === k || !set || set.has(colVal(r, kk))))
      .map((r) => colVal(r, k)),
    selected: colF[k] ?? null,
    onApply: (sel) => setColF((f) => ({ ...f, [k]: sel })),
  });
  const thResize = (k: string, colIndex: number) =>
    ({ k, colIndex, widths: colW, onResize: setColW, tableRef });
  const onSort = (k: SortKey) => setSort((c) => nextSort(c, k, k === "date" ? "asc" : "asc"));

  const { data: accounts = [] } = useQuery({
    queryKey: ["collect-accounts", companyId],
    queryFn: async () => {
      const data = logRead("collect:accounts", await supabase
        .from("chart_of_accounts").select("id, code, name, account_type")
        .eq("company_id", companyId).order("code"));
      return (data || []) as Acct[];
    },
    staleTime: 300_000,
  });
  const acctByCode = useMemo(() => {
    const m = new Map<string, Acct>();
    for (const a of accounts) m.set(String(a.code), a);
    return m;
  }, [accounts]);

  const { data: fetched, isLoading } = useQuery({
    queryKey: ["collect-rows", companyId, from, to, kind],
    queryFn: () => fetchRows(companyId, from, to, kind),
  });
  const rows = fetched?.rows ?? [];
  //   자를 수밖에 없었을 때만 뜬다 — 조용히 자르면 '이게 전부'로 읽힌다
  const capped = fetched?.capped ?? false;

  //   학습된 규칙 — 2단계에서 전표를 되읽던 방식을 표로 올렸다(4단계).
  //   거래처가 없는 자료(카드 가맹점·현금영수증 상호)도 이제 배운다.
  const { data: rules } = useQuery({
    queryKey: ["voucher-rules", companyId, kind],
    queryFn: () => fetchRuleMap(companyId, kind as RuleKind),
    staleTime: 60_000,
  });

  //   카드 비목 → 계정 매핑(회사설정에서 만든 것) — 가맹점 이름이 아니라 **분류(category)** 기준이다
  const { data: cardMap = {} } = useQuery<Record<string, Acct>>({
    queryKey: ["collect-card-map", companyId],
    queryFn: async () => {
      const data = logRead("collect:cardmap", await supabase
        .from("card_account_mappings")
        .select("category, chart_of_accounts(id, code, name, account_type)")
        .eq("company_id", companyId));
      const out: Record<string, Acct> = {};
      for (const r of ((data as any[]) || [])) {
        if (r.category && r.chart_of_accounts) out[String(r.category)] = r.chart_of_accounts as Acct;
      }
      return out;
    },
    enabled: kind === "card",
    staleTime: 300_000,
  });

  //   가맹점 과세유형(구분) — 이미 조회해 둔 것을 그린다
  const { data: merchantKinds = {} } = useQuery<Record<string, MerchantInfo>>({
    queryKey: ["merchant-kinds", companyId],
    queryFn: () => fetchMerchantKinds(companyId),
    enabled: !!companyId, staleTime: 300_000,
  });

  /** 이 줄의 학습 열쇠 — 자료마다 다르다(세금계산서는 거래처, 카드는 가맹점명 …) */
  const keyOf = (r: Row) => ruleKeyOf(kind as RuleKind, { partnerId: r.partnerId, name: r.partnerName, fallback: r.item });

  /** 이 줄에 붙일 매출·비용 계정과 그 근거 */
  const acctOf = (r: Row): { acct: Acct | null; via: "고름" | "지난번" | "학습" | "비목" | null } => {
    const o = override[r.id]?.acct;
    if (o) return { acct: o, via: "고름" };
    const hit = rules?.get(keyOf(r).key);
    if (hit?.account) return { acct: hit.account as Acct, via: ruleTag(hit.hit_count) };
    //   카드는 회사설정의 '비목 → 계정' 표도 본다 (학습보다 뒤 — 사람이 고른 게 우선).
    //   ★ 꼬리표는 '비목' 이다. 예전엔 '규칙' 이라 적어 **배운 규칙과 헷갈렸다** — 배운 규칙이
    //     0개인데 화면엔 '규칙'이 붙어 있었다(2026-08-12 사장님 제보).
    //   ★ '미분류'(UNCLASSIFIED_CATEGORY)는 **자동 분류에 실패했다는 뜻**이다. 그걸 계정으로
    //     확정해 버리면 "모른다"가 "복리후생비"로 둔갑한다 — 카드 2,771건 중 2,290건이 그랬다.
    //     사람이 고르게 비워 둔다.
    if (kind === "card" && r.cardCategory && r.cardCategory !== UNCLASSIFIED_CATEGORY && cardMap[r.cardCategory]) {
      return { acct: cardMap[r.cardCategory], via: "비목" };
    }
    return { acct: null, via: null };
  };

  /** 이 줄 가맹점의 과세유형 — 숫자만 남긴 사업자번호로 찾는다 */
  const merchantOf = (r: Row) => merchantKinds[r.bizno.replace(/[^0-9]/g, "")] ?? null;

  /**
   * 부가세 유형 — 사람이 고른 게 있으면 그것, 없으면 자동.
   *   ★ 카드는 **간이·면세 가맹점이면 매입세액을 공제받지 못한다**(2026-08-12 사장님 지시).
   *     기본 제안을 '58. 카면'(불공제)으로 내린다. 확정은 사람이 한다 — 화면에 이유를 적어 둔다.
   *     예외: 간이과세자 중 '세금계산서 발급사업자'는 공제 대상이라 그대로 둔다.
   */
  const vatCodeOf = (r: Row) => {
    const o = override[r.id]?.vatCode;
    if (o) return o;
    if (kind === "card" && r.vatCode === "57" && merchantOf(r)?.deductible === false) return "58";
    return r.vatCode;
  };

  /**
   * 고른 유형에 맞춘 공급가액·부가세.
   *   ★ **비과세 유형(카면 58·카영 59·면세 53 …)으로 바꾸면 부가세가 0 이어야 한다.**
   *     안 그러면 차변(공급가액)과 대변(합계)이 어긋나 저장이 UNBALANCED 로 막힌다 —
   *     간이·면세를 자동으로 58 로 내리면서 실제로 그랬다 (2026-08-12).
   *     합계(=실제 결제금액)는 그대로 두고 부가세만 공급가액으로 옮긴다.
   */
  const amountsOf = (r: Row) => {
    const t = vatType(vatCodeOf(r));
    if (t && !t.taxed) return { supply: r.supply + r.vat, vat: 0 };
    return { supply: r.supply, vat: r.vat };
  };

  const shownUnsorted = rows.filter((r) => {
    if (live.todo === "todo" && r.posted) return false;
    const acct = acctOf(r).acct;
    const total = amountsOf(r).supply + amountsOf(r).vat;
    //   빠른검색 — 글자 하나로 거래처·계정·카드·품명·금액을 한꺼번에 (쉼표=또는)
    if (!quickSearchHit(q, [r.partnerName, r.bizno, r.item, r.cardName, acct?.name, acct?.code], [total])) return false;
    //   검색조건 — 빈 칸은 안 건 것과 같다. 여러 개 고른 것은 **하나라도** 맞으면 통과.
    if (live.dir !== "all" && vatType(vatCodeOf(r))?.side !== live.dir) return false;
    if (live.partner.length && !live.partner.includes(r.partnerName)) return false;
    if (live.acct.length && !(acct && live.acct.includes(acct.code))) return false;
    if (live.card.length && !live.card.includes(r.cardName || "")) return false;
    if (live.kind && (merchantOf(r)?.kind ?? "") !== live.kind) return false;
    if (live.item && !r.item.toLowerCase().includes(live.item.toLowerCase())) return false;
    if (!amountHit(total, live.min, live.max)) return false;
    if (!colHit(r)) return false;   // 엑셀식 머리단 필터
    return true;
  });
  //   정렬 — 고른 칸으로 세우고, 같으면 늘 일자로 갈라 순서가 흔들리지 않게 한다
  const shown = useMemo(() => {
    const val = (r: Row): unknown => {
      switch (sort.key) {
        case "partner": return r.partnerName;
        case "bizno": return r.bizno;
        case "kind": return merchantOf(r)?.kind ?? "";
        case "vat": return vatType(vatCodeOf(r))?.label ?? "";
        case "item": return r.item;
        case "supply": return amountsOf(r).supply;
        case "tax": return amountsOf(r).vat;
        case "total": return amountsOf(r).supply + amountsOf(r).vat;
        case "debit": return acctOf(r).acct?.code ?? "";
        case "state": return r.posted ? 1 : 0;
        default: return r.date;
      }
    };
    const arr = [...shownUnsorted];
    arr.sort((a, b) => {
      const c = cmp(val(a), val(b));
      return (sort.dir === "asc" ? c : -c) || a.date.localeCompare(b.date);
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownUnsorted, sort, override, merchantKinds, rules, cardMap, live, q]);
  //   페이지 — 기본 50줄. 조건이 바뀌면 1쪽으로 돌아간다 (2026-08-13 사장님 지시)
  const pager = usePager(shown, live.size, `${from}|${to}|${kind}|${q}|${JSON.stringify(live)}|${JSON.stringify(Object.fromEntries(Object.entries(colF).map(([k, v]) => [k, v ? [...v] : null])))}`);
  //   선택은 **쪽을 넘겨도 남는다** — 2쪽까지 골라 한 번에 전표로 만들 수 있어야 한다
  const selRows = shown.filter((r) => sel.has(r.id));
  const sumSupply = shown.reduce((n, r) => n + amountsOf(r).supply, 0);
  const sumVat = shown.reduce((n, r) => n + amountsOf(r).vat, 0);
  const selTotal = selRows.reduce((n, r) => n + amountsOf(r).supply + amountsOf(r).vat, 0);

  const linesFor = (r: Row) => {
    const { acct } = acctOf(r);
    //   ★ '3. 일반'은 부가세 유형이 아니라 buildVoucherLines 가 만들 줄이 없다(빈 배열이 나온다).
    //     그러면 화면이 분개를 못 그려 터진다 — 실제로 그랬다. 여기서 두 줄을 직접 만든다:
    //     차) 비용 전액 / 대) 미지급금 전액. 부가세를 안 떼므로 합계 그대로다. (2026-08-12)
    if (vatCodeOf(r) === GENERAL_CODE) {
      const total = r.supply + r.vat;
      const pay = acctByCode.get(STD.payable);
      return [
        { side: "debit" as const, code: acct?.code ?? null, name: acct?.name || "비용 계정을 고르세요", amount: total },
        { side: "credit" as const, code: pay?.code ?? STD.payable, name: pay?.name || "미지급금", amount: total },
      ];
    }
    const amt = amountsOf(r);
    return buildVoucherLines({
      vatCode: vatCodeOf(r), settle: r.settle, supply: amt.supply, vat: amt.vat,
      mainCode: acct?.code ?? null, mainName: acct?.name ?? null,
    });
  };

  //   계정이 안 정해진 줄은 전표를 못 만든다 — 몇 건인지 먼저 알려 준다
  const notReady = selRows.filter((r) => linesFor(r).some((l) => !l.code || !acctByCode.get(l.code)));

  /**
   * 카드 미지급금에 걸 **카드사 거래처** — 카드 이름 하나당 한 번만 물어본다. (2026-08-12 사장님 지시)
   *   "같은 카드끼리 카드대금이 빠져나가는지 거래처원장에서 확인해야 한다."
   *   카드 화면(post_card_voucher)은 이미 이렇게 하고 있었는데 수집·전표만 빠져 있었다.
   */
  /**
   * 가맹점 거래처 — **차변(비용) 줄에 걸 거래처** (2026-08-13 사장님 제보).
   *   예전엔 차변 거래처를 비워 뒀고, 화면이 대변의 카드사(BC카드)를 대신 보여 줘
   *   "차변이 BC카드로 분개된다"로 읽혔다. 실제로 들어가야 할 것은 **가맹점**이다.
   *   가맹점은 수백 곳이라 미리 다 만들지 않는다 — 전표를 만드는 순간에만 등록한다.
   */
  const merchantMemo = new Map<string, string | null>();
  const merchantPartnerOf = async (name?: string | null, bizno?: string | null): Promise<string | null> => {
    const nm = (name || "").trim();
    if (!nm) return null;
    const key = `${nm}|${(bizno || "").replace(/[^0-9]/g, "")}`;
    if (merchantMemo.has(key)) return merchantMemo.get(key) ?? null;
    let id: string | null = null;
    try {
      const { data } = await (supabase.rpc as any)("resolve_merchant_partner", { p_name: nm, p_bizno: bizno || null });
      id = (data as string) ?? null;
    } catch { /* 거래처를 못 걸어도 전표는 만든다 — 없는 것보다 낫다 */ }
    merchantMemo.set(key, id);
    return id;
  };

  const cardPartnerMemo = new Map<string, string | null>();
  const cardPartnerOf = async (cardName?: string | null): Promise<string | null> => {
    const nm = (cardName || "").trim();
    if (!nm) return null;
    if (cardPartnerMemo.has(nm)) return cardPartnerMemo.get(nm) ?? null;
    let id: string | null = null;
    try {
      const { data } = await (supabase.rpc as any)("resolve_card_partner", { p_card_name: nm });
      id = (data as string) ?? null;
    } catch { /* 거래처를 못 걸어도 전표는 만든다 — 없는 것보다 낫다 */ }
    cardPartnerMemo.set(nm, id);
    return id;
  };

  const makeVouchers = async () => {
    if (selRows.length === 0 || saving) return;
    setSaving(true);
    let ok = 0;
    const fails: string[] = [];
    for (const r of selRows) {
      const lines = linesFor(r);
      const resolved = lines.map((l) => (l.code ? acctByCode.get(l.code) ?? null : null));
      if (lines.length < 2 || resolved.some((a) => !a)) {
        fails.push(`${r.partnerName}: 계정을 먼저 고르세요`);
        continue;
      }
      const norm = normalizeSides(lines.map((l) => ({ side: l.side, amount: l.amount })));
      //   ★ 카드는 **차변(비용)은 가맹점, 대변(미지급금)은 카드사** — 상대가 서로 다르다.
      //     상대계정 줄은 매출이면 첫 줄, 매입이면 마지막 줄이다(buildVoucherLines 가 그렇게 만든다).
      const cardPid = kind === "card" ? await cardPartnerOf(r.cardName) : null;
      //   ★ 카드는 **비용 줄 = 가맹점**, 미지급금 줄 = 카드사. 둘이 다르다 (2026-08-13 사장님 제보).
      //     예전엔 비용 줄 거래처가 비어 있었다(카드 원자료엔 partner_id 가 없다).
      const mainPid = kind === "card" ? await merchantPartnerOf(r.partnerName, r.bizno) : r.partnerId;
      const counterIdx = vatType(vatCodeOf(r))?.side === "sale" ? 0 : lines.length - 1;
      const payload = lines.map((l, i) => ({
        account_id: resolved[i]!.id,
        debit: norm[i].side === "debit" ? norm[i].amount : 0,
        credit: norm[i].side === "credit" ? norm[i].amount : 0,
        memo: r.item || "",
        partner_id: i === counterIdx && cardPid ? cardPid : mainPid,
      }));
      //   ★ '3. 일반'은 부가세 전표가 아니다 — **일반전표**로 보낸다.
      //     부가세를 안 떼므로 금액은 합계 그대로 가고, 분개는 차) 비용 / 대) 미지급금 두 줄이다.
      if (vatCodeOf(r) === GENERAL_CODE) {
        const total = r.supply + r.vat;
        const g = [
          { account_id: resolved[0]!.id, debit: total, credit: 0, memo: r.item || "", partner_id: mainPid },
          { account_id: (acctByCode.get(STD.payable) ?? resolved[resolved.length - 1]!)!.id, debit: 0, credit: total, memo: r.item || "", partner_id: cardPid },
        ];
        const { error: ge } = await (supabase.rpc as any)("save_manual_voucher", {
          p_entry_date: r.date, p_voucher_type: "cash_out",
          p_description: r.item || r.partnerName, p_lines: g,
        });
        if (ge) { fails.push(`${r.partnerName}: ${friendlyError(ge, "일반전표 저장 실패")}`); }
        else ok += 1;
        continue;
      }
      const { error } = await (supabase.rpc as any)("save_sale_purchase_voucher", {
        p_entry_date: r.date,
        p_vat_type: vatCodeOf(r),
        p_supply_amount: amountsOf(r).supply,
        p_vat_amount: amountsOf(r).vat,
        p_description: r.item || r.partnerName,
        p_lines: payload,
        p_reference_type: REF_TYPE[kind],
        p_reference_id: r.id,
      });
      if (error) {
        const m = String(error.message || "");
        fails.push(`${r.partnerName}: ${
          m.includes("PERIOD_LOCKED") ? "마감된 달"
          : m.includes("ALREADY_POSTED") ? "이미 전표가 있음"
          : m.includes("UNBALANCED") ? "차·대 불일치"
          : friendlyError(error, "저장 실패")}`);
      } else {
        ok += 1;
        //   사람이 고른 것을 배운다 — 다음에 같은 상대가 나오면 미리 채운다
        const main = acctOf(r).acct;
        if (main) {
          const k = keyOf(r);
          await learnAccount({ kind: kind as RuleKind, key: k.key, label: k.label, accountId: main.id, vatType: vatCodeOf(r) });
        }
      }
    }
    setSel(new Set());
    qc.invalidateQueries({ queryKey: ["collect-rows"] });
    qc.invalidateQueries({ queryKey: ["collect-status"] });
    qc.invalidateQueries({ queryKey: ["voucher-rules"] });
    setSaving(false);
    if (ok > 0 && fails.length === 0) toast(`전표 ${ok}건을 만들었습니다`, "success");
    else if (ok > 0) toast(`${ok}건 성공 · ${fails.length}건 실패 — ${fails[0]}`, "info");
    else toast(`전표를 만들지 못했습니다 — ${fails[0] ?? "알 수 없는 오류"}`, "error");
  };

  /**
   * 전표 취소 — 만든 전표를 되돌려 이 목록으로 가져온다. (2026-08-12 사장님 지시)
   *   전표는 **지우지 않고 반려**한다. 재무제표는 확정 전표만 읽으니 합계에서 빠지고,
   *   "만들었다 취소했다"는 사실은 남는다. 마감된 달은 서버가 막는다(PERIOD_LOCKED).
   */
  const unpost = async (r: Row) => {
    if (!r.entryId || saving) return;
    const label = `${r.date.slice(5)} ${r.partnerName} ${won(amountsOf(r).supply + amountsOf(r).vat)}원`;
    if (!(await appConfirm(
      `${label}\n전표 #${r.voucherNo ?? "—"} 을(를) 취소할까요?\n\n· 전표는 반려로 남고 재무제표에서 빠집니다\n· 이 자료는 다시 '미처리'가 되어 목록으로 돌아옵니다`,
      //   기본 라벨이 '삭제'라 뜻이 어긋난다 — 여기서 하는 일은 '되돌리기'다
      { danger: true, title: "전표 취소", confirmLabel: "전표 취소" }))) return;
    setSaving(true);
    try {
      const { error } = await (supabase.rpc as any)("unpost_evidence_voucher", { p_entry_id: r.entryId });
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["collect-rows"] });
      qc.invalidateQueries({ queryKey: ["collect-status"] });
      toast(`전표 #${r.voucherNo ?? ""} 을(를) 취소했습니다 — 목록으로 되돌렸습니다`, "info");
    } catch (e: any) {
      const m = String(e?.message || "");
      toast(m.includes("PERIOD_LOCKED") ? "마감된 달의 전표는 취소할 수 없습니다"
        : m.includes("FORBIDDEN") ? "전표를 취소할 권한이 없습니다"
        : friendlyError(e, "전표 취소 실패"), "error");
    } finally { setSaving(false); }
  };

  const toggle = (id: string) =>
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  //   머리단 전체 선택은 **보이는 쪽만** 고른다 — 안 보이는 3쪽까지 딸려 오면 무엇을 만드는지 모른다
  const pickable = pager.view.filter((r) => !r.posted);
  const allOn = pickable.length > 0 && pickable.every((r) => sel.has(r.id));
  const toggleAll = () => setSel((s) => {
    const n = new Set(s);
    for (const r of pickable) { if (allOn) n.delete(r.id); else n.add(r.id); }
    return n;
  });

  //   PickList 에 넘길 **자르지 않은** 목록 — 검색은 PickList 안에서 한다.
  //   (filterAccts 는 40개로 잘라서, 그걸 넘기면 앞 40개 안에서만 검색된다 — 실제로 그렇게 만들었다가 잡았다)
  const acctsOf = (side: "sale" | "purchase") =>
    accounts.filter((a) => a.account_type === (side === "sale" ? "revenue" : "expense"));

  //   자료 종류에 맞는 유형만 고르게 한다 (2026-08-12 사장님 지시).
  //     카드 매입에 '11. 과세매출'·'51. 과세매입'(세금계산서용)이 섞여 나와, 열 개 중 아홉이 쓸 일 없는 것이었다.
  //     카드는 **57 카과 · 58 카면 · 59 카영** 셋이면 되고, 부가세와 무관한 일반경비는
  //     매입매출전표가 아니라 **일반전표**로 보내야 한다(아래 '3. 일반').
  const typeOptions = useMemo(() => {
    if (kind === "card") return [
      //   ★ '3. 일반' 은 부가세 유형이 아니라 **보낼 곳**이다 (2026-08-12 사장님 지시).
      //     부가세 신고와 무관한 카드 사용(불공제도 아니고 매입세액도 없는 일반경비)은
      //     매입매출전표가 아니라 **일반전표**로 가야 한다 — 매입매출전표에 넣으면 신고 집계에 섞인다.
      { code: GENERAL_CODE, label: "3. 일반 (일반전표로)" } as (typeof VAT_TYPES)[number],
      ...VAT_TYPES.filter((v) => ["57", "58", "59"].includes(v.code)),
    ];
    if (kind === "cash_receipt") return VAT_TYPES.filter((v) => ["22", "61"].includes(v.code));
    return VAT_TYPES;   // 세금계산서·계산서는 전부
  }, [kind]);

  const [filling, setFilling] = useState(false);
  //   아직 구분을 모르는 가맹점 수 — 버튼에 그대로 보여 준다(몇 개를 물어볼 건지 알고 누르게)
  const unknownBiznos = useMemo(() => {
    const set = new Set<string>();
    for (const r of rows) {
      const d = r.bizno.replace(/[^0-9]/g, "");
      if (d.length === 10 && !merchantKinds[d]) set.add(d);
    }
    return [...set];
  }, [rows, merchantKinds]);
  const fillKinds = async () => {
    setFilling(true);
    try {
      const n = await fillMerchantKinds(companyId, unknownBiznos);
      await qc.invalidateQueries({ queryKey: ["merchant-kinds", companyId] });
      toast(n > 0 ? `가맹점 구분 ${n}곳을 채웠습니다` : "새로 알아낸 구분이 없습니다 (국세청에 없는 번호일 수 있습니다)", n > 0 ? "success" : "info");
    } catch (e: any) {
      toast(`구분 조회 실패: ${e?.message || "알 수 없는 오류"}`, "error");
    } finally { setFilling(false); }
  };

  const filterAccts = (q: string, side: "sale" | "purchase") =>
    accounts.filter((a) =>
      a.account_type === (side === "sale" ? "revenue" : "expense")
      && (!q || a.name.toLowerCase().includes(q.toLowerCase()) || String(a.code).includes(q))).slice(0, 40);

  //   'AI 제안' — 조회 조건도 아니고 확정도 아닌 것들 (2026-08-13 사장님 확정).
  //   ★ 줄마다 **출처를 적는다** — 전부 AI 라고 하면 틀렸을 때 원인을 엉뚱한 데서 찾는다.
  const helpers: HelperItem[] = [
    rulesHelper,
    //   구분(법인·일반·간이·면세)은 카드 원자료에 없다 — 국세청에 물어 채운다.
    //   아직 모르는 **가맹점 수**만 물어보므로 거래 건수와 무관하다 (2026-08-12)
    ...(kind === "card" && unknownBiznos.length > 0 ? [{
      label: filling ? "구분 조회 중…" : "가맹점 구분 채우기",
      source: "국세청 조회",
      hint: "사업자번호로 과세유형을 물어 '구분' 칸을 채웁니다 — 간이·면세는 부가세를 공제받지 못합니다",
      badge: unknownBiznos.length, disabled: filling, onClick: fillKinds,
    } as HelperItem] : []),
  ];

  //   고를 수 있는 값들 — **이 기간에 실제로 나온 것만** 세운다.
  //   안 쓰는 카드·안 나온 거래처가 목록에 서면 고르고도 0건이 나와 헷갈린다.
  const partnerOpts = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of rows) if (r.partnerName && !m.has(r.partnerName)) m.set(r.partnerName, r.bizno || "");
    return [...m].sort((x, y) => x[0].localeCompare(y[0], "ko")).map(([v, sub]) => ({ value: v, label: v, sub }));
  }, [rows]);
  const cardOpts = useMemo(
    () => [...new Set(rows.map((r) => r.cardName).filter(Boolean) as string[])]
      .sort((a2, b2) => a2.localeCompare(b2, "ko")).map((c) => ({ value: c, label: c })),
    [rows]);
  const acctOpts = useMemo(
    () => accounts.map((a2) => ({ value: a2.code, label: a2.name, sub: a2.code })),
    [accounts]);

  //   내 조건 — ★ 하나가 이 화면의 기본값이 된다 (DB 라 PC 를 바꿔도 따라온다)
  const saved = useSavedQueries(`collect:${kind}`, companyId);
  //   지금 걸린 조건 / '기본' 이 뜻하는 조건 — 목록에서 어느 것이 켜졌는지 견주는 데 쓴다
  const paramsNow = { from, to, q, cond: live };
  const paramsBasic = { ...defaultRange(), q: "", cond: EMPTY };
  /** 고른 조건으로 이름을 지어 준다 — 매번 뭐라고 쓸지 고민하게 두지 않는다 */
  const suggestName = () => {
    const p: string[] = [];
    if (draft.partner.length) p.push(draft.partner[0] + (draft.partner.length > 1 ? ` 외 ${draft.partner.length - 1}` : ""));
    if (draft.card.length) p.push(draft.card[0]);
    if (draft.acct.length) p.push(accounts.find((a2) => a2.code === draft.acct[0])?.name ?? draft.acct[0]);
    if (draft.kind) p.push(draft.kind);
    if (draft.dir !== "all") p.push(draft.dir === "sale" ? "매출" : "매입");
    if (draft.item) p.push(draft.item);
    if (draft.min || draft.max) p.push("금액");
    if (draft.todo === "todo") p.push("미처리");
    return p.slice(0, 3).join(" · ") || "내 조건";
  };
  const applySaved = (p: Record<string, unknown>) => {
    if (typeof p.from === "string" && typeof p.to === "string") onRange(p.from, p.to);
    if (typeof p.q === "string") setQ(p.q);
    const c = { ...EMPTY, ...(p.cond as Partial<Cond> | undefined) };
    setDraft(c); setLive(c);
  };
  //   ★ 기본 조건이 있으면 화면을 열 때 한 번만 건다. 없으면 최근 1개월 그대로.
  //     '지난번 검색값'을 몰래 기억하는 것과 다르다 — **사람이 ★ 를 단 값**이라 늘 같다.
  const [defDone, setDefDone] = useState(false);
  useEffect(() => {
    if (defDone || !saved.isFetched) return;
    setDefDone(true);
    if (saved.def) applySaved(saved.def.params || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.isFetched, saved.def, defDone]);

  const nDraft = condCount(draft), nLive = condCount(live);
  //   '조회'를 누르기 전에 **몇 건 나올지**만 미리 알려 준다 (표는 안 흔든다)
  const previewCount = useMemo(() => {
    let n = 0;
    for (const r of rows) {
      const a2 = acctOf(r).acct;
      const total = amountsOf(r).supply + amountsOf(r).vat;
      if (draft.todo === "todo" && r.posted) continue;
      if (!quickSearchHit(q, [r.partnerName, r.bizno, r.item, r.cardName, a2?.name, a2?.code], [total])) continue;
      if (draft.dir !== "all" && vatType(vatCodeOf(r))?.side !== draft.dir) continue;
      if (draft.partner.length && !draft.partner.includes(r.partnerName)) continue;
      if (draft.acct.length && !(a2 && draft.acct.includes(a2.code))) continue;
      if (draft.card.length && !draft.card.includes(r.cardName || "")) continue;
      if (draft.kind && (merchantOf(r)?.kind ?? "") !== draft.kind) continue;
      if (draft.item && !r.item.toLowerCase().includes(draft.item.toLowerCase())) continue;
      if (!amountHit(total, draft.min, draft.max)) continue;
      n += 1;
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, draft, q, override, rules, cardMap, merchantKinds]);

  //   엑셀 — 지금 조건 그대로, 표에 보이는 칸 그대로 내려받는다 (2026-08-13 사장님 지시).
  //   ★ **되는 것만 넣는다.** 눌러도 아무 일 없는 메뉴가 하나라도 있으면 그 뒤로 메뉴를 안 믿는다.
  const xlsRows = (list: Row[]) => list.map((r) => {
    const a = acctOf(r).acct;
    const amt = amountsOf(r);
    const t = vatType(vatCodeOf(r));
    const lines = linesFor(r);
    const counter = t?.side === "sale" ? lines[0] : lines[lines.length - 1];
    return {
      "일자": r.date,
      "거래처": r.partnerName,
      "사업자등록번호": r.bizno || "",
      "구분": merchantOf(r)?.kind ?? "",
      "유형": vatCodeOf(r) === GENERAL_CODE ? "3. 일반" : (t?.label ?? ""),
      "품명": r.item,
      "공급가액": amt.supply,
      "부가세": amt.vat,
      "합계": amt.supply + amt.vat,
      "계정과목": a ? `${a.code} ${a.name}` : "",
      "상대계정": counter?.code ? `${counter.code} ${counter.name}` : "",
      "상태": r.posted ? `확정 #${r.voucherNo ?? ""}` : "미처리",
    };
  });
  const KIND_LABEL: Record<string, string> = {
    tax_invoice: "전자세금계산서", exempt_invoice: "전자계산서", cash_receipt: "현금영수증", card: "신용카드",
  };
  const download = (list: Row[], tag: string) =>
    exportToExcel(xlsRows(list), KIND_LABEL[kind] ?? "수집자료",
      `${KIND_LABEL[kind] ?? "수집자료"}_${from}~${to}${tag}`);
  //   계정 일괄 지정 — 계정이 아직 없는 줄만 내려받아 엑셀에서 채우고 되올린다 (2026-08-13 사장님 승인).
  //   ★ 되올려도 **전표는 안 생긴다** — 화면 계정 칸이 채워질 뿐이고 확정은 '전표 만들기'다.
  const needAcct = shown.filter((r) => !r.posted && !acctOf(r).acct);
  const fillRef = useRef<HTMLInputElement>(null);
  const onFillFile = async (f: File) => {
    try {
      const { picks, fails, blank } = await parseAccountFill(f, accounts);
      const byId = new Map(rows.map((r) => [r.id, r]));
      const next: Record<string, { vatCode?: string; acct?: Acct }> = {};
      const miss: string[] = [];
      for (const pk of picks) {
        const row = byId.get(pk.id);
        if (!row) { miss.push(`이 조회에 없는 줄 (${pk.id.slice(0, 8)}…)`); continue; }
        if (row.posted) { miss.push(`${row.date} ${row.partnerName} — 이미 전표가 된 줄`); continue; }
        const a = acctByCode.get(pk.code);
        if (a) next[pk.id] = { ...override[pk.id], acct: a };
      }
      setOverride((o) => ({ ...o, ...next }));
      const n = Object.keys(next).length;
      const bad = [...fails, ...miss];
      toast(
        n > 0
          ? `계정 ${n}건을 채웠습니다${bad.length ? ` · ${bad.length}건 실패 — ${bad[0]}` : ""} — 확인 후 전표를 만드세요`
          : bad.length ? `채우지 못했습니다 — ${bad[0]}` : `채울 것이 없습니다 (빈 칸 ${blank}줄)`,
        n > 0 ? "success" : bad.length ? "error" : "info");
    } catch (e: any) {
      toast(`엑셀을 읽지 못했습니다 — ${e?.message || "형식을 확인해 주세요"}`, "error");
    }
  };

  const excelItems: ExcelItem[] = [
    { label: "조회 결과 전부 내려받기", count: shown.length,
      hint: "지금 걸린 조건 그대로 · 표에 보이는 칸 그대로", onClick: () => download(shown, "") },
    { label: "지금 쪽만 내려받기", count: pager.view.length,
      hint: `${pager.from}–${pager.to}번째 줄만`, onClick: () => download(pager.view, `_${pager.page}쪽`) },
    { label: "계정 채우기 양식 내려받기", count: needAcct.length, disabled: needAcct.length === 0,
      hint: "계정이 아직 없는 줄만 · 둘째 장 '붙여넣기용' 칸을 복사해 채우세요 (같은 이름이 여럿이라 코드가 필요합니다)",
      onClick: () => downloadAccountFillSheet(
        needAcct.map((r) => ({
          id: r.id, date: r.date, who: r.partnerName, memo: r.item,
          amount: amountsOf(r).supply + amountsOf(r).vat,
        })), accounts, `${KIND_LABEL[kind] ?? "수집자료"}_계정채우기_${from}~${to}`) },
    { label: "채운 엑셀 올리기",
      hint: "계정과목 칸만 채워 올리면 화면에 붙습니다 — 전표는 확인 후 직접 만듭니다",
      onClick: () => fillRef.current?.click() },
  ];

  //   걸린 조건 — 조회 줄에 칩으로 남는다. 패널을 열지 않고도 알고, ✕ 로 하나씩 뺀다.
  const drop = (patch: Partial<Cond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const chips: AppliedChip[] = [
    ...quickTerms(q).map((t, i) => ({
      group: "빠른검색", label: t,
      onRemove: () => setQ(quickTerms(q).filter((_, j) => j !== i).join(", ")),
    })),
    ...live.partner.map((v) => ({ group: "거래처", label: v, onRemove: () => drop({ partner: live.partner.filter((x) => x !== v) }) })),
    ...live.acct.map((v) => ({ group: "계정", label: accounts.find((a2) => a2.code === v)?.name ?? v, onRemove: () => drop({ acct: live.acct.filter((x) => x !== v) }) })),
    ...live.card.map((v) => ({ group: "카드", label: v, onRemove: () => drop({ card: live.card.filter((x) => x !== v) }) })),
    ...(live.kind ? [{ group: "구분", label: live.kind, onRemove: () => drop({ kind: "" }) }] : []),
    ...(live.dir !== "all" ? [{ group: "매출·매입", label: live.dir === "sale" ? "매출" : "매입", onRemove: () => drop({ dir: "all" as const }) }] : []),
    ...(live.todo !== "todo" ? [{ group: "상태", label: "전체", onRemove: () => drop({ todo: "todo" as const }) }] : []),
    ...(live.item ? [{ group: "품명", label: live.item, onRemove: () => drop({ item: "" }) }] : []),
    ...((live.min || live.max) ? [{
      group: "금액", label: `${won(Number(live.min || 0))} ~ ${live.max ? won(Number(live.max)) : "제한없음"}`,
      onRemove: () => drop({ min: "", max: "" }),
    }] : []),
  ];
  const clearAll = () => { setQ(""); setLive(EMPTY); setDraft(EMPTY); };

  return (
    <div className="ev-wrap">
      {/*   엑셀 '채운 파일 올리기' 가 누르는 숨은 입력 — 같은 파일을 다시 골라도 열리도록 value 를 비운다 */}
      <input ref={fillRef} type="file" accept=".xlsx,.xls" className="hidden"
        onChange={(e) => { const f = e.target.files?.[0]; e.target.value = ""; if (f) void onFillFile(f); }} />
      {/*   ★ 탭·조회 줄·걸린 조건·결과 요약·표·쪽 넘김을 **통째로 한 상자**에 (2026-08-13 사장님 지시) */}
      <QueryScreen>
      <QueryHead>
      {tabsNode}
      {/* ── 1줄 · 조회 조건 — 기간·빠른검색·상태는 즉시, 검색조건은 '조회'를 눌러 ── */}
      <QueryBar right={<>
        <HelperMenu items={helpers} />
        {syncButton}
      </>}>
        {/*   ★ 기간을 **치는 칸은 화면에 하나뿐**이다. 달력은 검색조건 안에 있다.
              오른쪽 끝에 '검색조건'이 붙어 한 덩어리로 보인다 (2026-08-13 사장님 지시). */}
        <DateRangeField from={from} to={to} onChange={onRange} label={null} parts="segments"
          trailing={
            <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen} activeCount={nLive} anchorSel=".drf"
              tabs={<SavedTabs list={saved.list} current={paramsNow} basic={paramsBasic}
                onApply={(s) => { applySaved(s.params || {}); setPanelOpen(false); }}
                onBasic={() => { onRange(paramsBasic.from, paramsBasic.to); setQ(""); setDraft(EMPTY); setLive(EMPTY); }}
                onRemove={saved.remove} onSetDefault={saved.setDefault} />}
              foot={<>
                <button type="button" className="btn-secondary btn-sm" disabled={nDraft === 0}
                  onClick={() => setDraft({ ...EMPTY, size: draft.size })}>조건 지우기</button>
                {/*   ★ 저장은 **여기** — 조건을 다 고른 뒤에 이름을 붙인다 (2026-08-13 사장님 지적) */}
                <ConditionSave suggest={suggestName}
                  onSave={(name, asDefault) => {
                    //   ★ 저장하면 **그 조건으로 바로 본다** — 저장만 되고 화면이 그대로면
                    //     "저장이 된 건가" 싶어 조회를 한 번 더 누르게 된다.
                    saved.save(name, { from, to, q, cond: draft }, asDefault);
                    setLive(draft); setPanelOpen(false);
                  }} />
                <span className="ml-auto text-[11px] text-[var(--text-dim)]">{won(previewCount)}건</span>
                <RowsPerPage value={draft.size} onChange={setD("size")} />
                <button type="button" className="btn-primary btn-sm"
                  onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
              </>}>
              <ConditionRow label="조회기간" hint="기본 1개월">
                <span className="qk-range-txt">{from} ~ {to}</span>
                <DateRangeField from={from} to={to} onChange={onRange} label={null} parts="calendar" confirm />
                <span className="qk-quicks">
                  {periodQuicks().map((p) => (
                    <button key={p.key} type="button" onClick={() => onRange(p.from, p.to)}
                      className={from === p.from && to === p.to ? "qk-quick qk-quick-on" : "qk-quick"}>{p.label}</button>
                  ))}
                </span>
              </ConditionRow>

              {/*   줄 순서: 조회기간 → 매출·매입 → 구분 → 거래처 → 나머지 (2026-08-13 사장님 지시) */}
              <ConditionRow label="매출·매입">
                <ChipGroup value={draft.dir} onChange={setD("dir")} options={DIR_CHIPS} />
              </ConditionRow>

              {/*   간이·면세만 모아 보는 일이 잦다 — 부가세를 공제받지 못하는 건들이다 */}
              {kind === "card" && (
                <ConditionRow label="구분" hint="간이·면세는 불공제">
                  <ChipGroup value={draft.kind} onChange={setD("kind")} options={KIND_CHIPS} />
                </ConditionRow>
              )}

              <ConditionRow label="거래처" hint="여러 곳">
                <TokenField items={partnerOpts} value={draft.partner} onChange={setD("partner")}
                  placeholder="거래처 이름 일부 (예: 모티)" />
              </ConditionRow>

              <ConditionRow label="계정과목" hint="여러 개">
                <TokenField items={acctOpts} value={draft.acct} onChange={setD("acct")}
                  placeholder="계정과목 이름 또는 코드 (예: 831)" />
              </ConditionRow>

              {kind === "card" && (
                <ConditionRow label="카드" hint="여러 개">
                  <TokenField items={cardOpts} value={draft.card} onChange={setD("card")}
                    placeholder="카드 이름 (예: 롯데)" />
                </ConditionRow>
              )}

              <ConditionRow label="상태">
                <ChipGroup value={draft.todo} onChange={setD("todo")} options={STATE_CHIPS} />
              </ConditionRow>

              <ConditionRow label="품명">
                <input className="qk-input w-full" value={draft.item} placeholder="예: 광고비"
                  onChange={(e) => setD("item")(e.target.value)} />
              </ConditionRow>

              <ConditionRow label="합계 금액" hint="한쪽만 적어도 됩니다">
                <AmountRange min={draft.min} max={draft.max} onMin={setD("min")} onMax={setD("max")} />
              </ConditionRow>
            </ConditionPanel>
          } />

        <QuickSearch value={q} onApply={setQ}
          placeholder="거래처 · 계정과목 · 품명 · 금액 — 쉼표로 여러 개, Enter" />

        <ExcelMenu items={excelItems} />
      </QueryBar>

      <AppliedChips chips={chips} onClearAll={clearAll} />

      {/* ── 2줄 · 결과 요약 — 목록을 바꾸지 않는 것들만 ── */}
      <ResultStrip>
        <Stat label="건수" value={`${won(shown.length)}건`} />
        <Stat label="공급가액" value={won(sumSupply)} />
        <Stat label="부가세" value={won(sumVat)} />
        {/*   ★ 잘렸으면 반드시 말한다 — 조용히 500건만 보여 주면 '이게 전부'로 읽힌다 */}
        {capped && <b className="ev-cut">너무 많아 앞 20,000건만 받아왔습니다 — 기간을 좁혀 주세요</b>}
      </ResultStrip>
      </QueryHead>

      {/* 목록 — 선택 바가 이 위로 떠오른다 (표 크기는 안 줄어들게) */}
      <QueryBody>
      {isLoading ? (
        <div className="collect-empty">읽는 중…</div>
      ) : shown.length === 0 ? (
        <div className="collect-empty">
          {live.todo === "todo" ? "전표를 만들 자료가 없습니다 — 이 기간은 다 처리했습니다." : "이 기간에 받아온 자료가 없습니다."}
        </div>
      ) : (
        <div className="ev-scroll">
          <table ref={tableRef} className="ev-table ev-lined">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <button type="button" aria-label="이 쪽 전체 선택" onClick={toggleAll}
                    className={allOn ? "collect-chk collect-chk-on" : "collect-chk"}>{allOn ? "✓" : ""}</button>
                </th>
                <SortableTh label="일자" sortKey="date" sort={sort} onSort={onSort} filter={thFilter("date", rows)} resize={thResize("date", 1)} />
                <SortableTh label="거래처" sortKey="partner" sort={sort} onSort={onSort} filter={thFilter("partner", rows)} resize={thResize("partner", 2)} />
                <SortableTh label="사업자등록번호" sortKey="bizno" sort={sort} onSort={onSort} filter={thFilter("bizno", rows)} resize={thResize("bizno", 3)} />
                <SortableTh label="구분" sortKey="kind" sort={sort} onSort={onSort} filter={thFilter("kind", rows)} resize={thResize("kind", 4)} />
                <SortableTh label="유형" sortKey="vat" sort={sort} onSort={onSort} filter={thFilter("vat", rows)} resize={thResize("vat", 5)} />
                <SortableTh label="품명" sortKey="item" sort={sort} onSort={onSort} filter={thFilter("item", rows)} resize={thResize("item", 6)} />
                <SortableTh label="공급가액" sortKey="supply" sort={sort} onSort={onSort} filter={thFilter("supply", rows)} resize={thResize("supply", 7)} />
                <SortableTh label="부가세" sortKey="tax" sort={sort} onSort={onSort} filter={thFilter("tax", rows)} resize={thResize("tax", 8)} />
                <SortableTh label="합계" sortKey="total" sort={sort} onSort={onSort} filter={thFilter("total", rows)} resize={thResize("total", 9)} />
                <SortableTh label="차변계정" sortKey="debit" sort={sort} onSort={onSort} filter={thFilter("debit", rows)} resize={thResize("debit", 10)} />
                <SortableTh label="대변계정" resize={thResize("credit", 11)} />
                <SortableTh label="상태" sortKey="state" sort={sort} onSort={onSort} filter={thFilter("state", rows)} resize={thResize("state", 12)} />
              </tr>
            </thead>
            <tbody>
              {pager.view.map((r) => {
                //   ★ '3. 일반'은 VAT_TYPES 에 없어 vatType() 이 null 이다 — `!` 로 단정하면
                //     아래에서 t.side 를 읽다 화면이 통째로 죽는다(실제로 그랬다).
                //     매입(purchase) 쪽으로 취급한다 — 카드 사용은 언제나 우리가 쓴 돈이다. (2026-08-12)
                const vt = vatType(vatCodeOf(r));
                const isGeneral = vatCodeOf(r) === GENERAL_CODE;
                const t = vt ?? { code: GENERAL_CODE, label: "3. 일반", side: "purchase" as const, taxed: false, deductible: false, hint: "", defaultSettle: "card" as const };
                const { acct, via } = acctOf(r);
                const amt = amountsOf(r);
                const lines = linesFor(r);
                const debit = lines.filter((l) => l.side === "debit");
                const credit = lines.filter((l) => l.side === "credit");
                const main = t.side === "sale" ? credit[0] : debit[0];
                const counter = t.side === "sale" ? debit[0] : credit[credit.length - 1];
                const on = sel.has(r.id);
                return (
                  <tr key={r.id} className={r.posted ? "ev-posted" : on ? "ev-on" : ""}>
                    <td>
                      {!r.posted && (
                        <button type="button" onClick={() => toggle(r.id)} aria-label="선택"
                          className={on ? "collect-chk collect-chk-on" : "collect-chk"}>{on ? "✓" : ""}</button>
                      )}
                    </td>
                    <td className="mono-number">{r.date.slice(5)}</td>
                    <td className="ev-ell">{r.partnerName}</td>
                    <td className="mono-number ev-dim">{r.bizno || "—"}</td>
                    {/*   구분 — 법인·일반·간이·면세. 카드 원자료엔 없어 국세청 조회로 채운다 (2026-08-12)
                          ★ 간이·면세는 **매입세액을 못 받는다** — 붉게 띄우고 이유를 달아 준다.
                            (간이과세자 중 '세금계산서 발급사업자'는 공제되므로 그대로 둔다) */}
                    <td className="tc">
                      {(() => {
                        const mi = merchantOf(r);
                        if (!mi?.kind) return <span className="ev-dim">—</span>;
                        const noVat = mi.deductible === false;
                        return (
                          <em className={noVat ? "ev-kind ev-kind-novat" : "ev-kind"}
                            title={noVat ? `${mi.kind} 과세사업자 — 카드매출전표로 부가세를 공제받을 수 없습니다 (${mi.taxType || ""})` : (mi.taxType || "")}>
                            {mi.kind}{noVat ? " · 불공제" : ""}
                          </em>
                        );
                      })()}
                    </td>
                    <td>
                      {r.posted ? (
                        <em className={t.side === "sale" ? "spv-type spv-type-s" : "spv-type spv-type-b"}>{isGeneral ? "일반" : t.label.split(". ")[1]}</em>
                      ) : (
                        <select className="ev-sel" value={vatCodeOf(r)}
                          onChange={(e) => setOverride((o) => ({ ...o, [r.id]: { ...o[r.id], vatCode: e.target.value } }))}>
                          {typeOptions.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
                        </select>
                      )}
                    </td>
                    <td className="ev-ell">{r.item}</td>
                    {/*   고른 유형에 맞춘 금액 — 비과세(카면·카영)로 내리면 부가세가 0 이 된다 */}
                    <td className={amt.supply < 0 ? "tr mono-number ev-minus" : "tr mono-number"}>{won(amt.supply)}</td>
                    <td className="tr mono-number">{won(amt.vat)}</td>
                    <td className="tr mono-number ev-total">{won(amt.supply + amt.vat)}</td>
                    {/*   ★ 칩·라벨 칸은 본문도 가운데 — 제목만 가운데면 왼쪽에 붙은 내용보다
                          오른쪽으로 떠 보인다 (2026-08-12 사장님 제보).
                          숫자 칸은 자릿수 비교 때문에 오른쪽을 지킨다(회계 표 관행). */}
                    <td className="tc">
                      {t.side === "purchase" && !r.posted ? (
                        <span className="relative inline-block">
                          <button type="button" onClick={() => setPick(pick?.id === r.id ? null : { id: r.id, q: "" })}
                            className={acct ? "ev-acct" : "ev-acct ev-acct-empty"}>
                            {acct ? `${acct.code} ${acct.name}` : "비용 계정 고르기"}
                            {via && via !== "고름" && <em className="ev-via">{via}</em>}
                          </button>
                          {pick?.id === r.id && (
                            <PickList items={acctsOf("purchase")} placeholder="계정과목 검색 (이름·코드)"
                              onPick={(a) => { setOverride((o) => ({ ...o, [r.id]: { ...o[r.id], acct: a } })); setPick(null); }}
                              onClose={() => setPick(null)} />
                          )}
                        </span>
                      ) : (
                        <span className="ev-dim">{debit[0]?.code ? `${debit[0].code} ${debit[0].name}` : "—"}</span>
                      )}
                    </td>
                    <td className="tc">
                      {t.side === "sale" && !r.posted ? (
                        <span className="relative inline-block">
                          <button type="button" onClick={() => setPick(pick?.id === r.id ? null : { id: r.id, q: "" })}
                            className={acct ? "ev-acct" : "ev-acct"}>
                            {main?.code ? `${main.code} ${main.name}` : "매출 계정"}
                            {via && via !== "고름" && <em className="ev-via">{via}</em>}
                          </button>
                          {pick?.id === r.id && (
                            <PickList items={acctsOf("sale")} placeholder="계정과목 검색 (이름·코드)"
                              onPick={(a) => { setOverride((o) => ({ ...o, [r.id]: { ...o[r.id], acct: a } })); setPick(null); }}
                              onClose={() => setPick(null)} />
                          )}
                        </span>
                      ) : (
                        //   ★ 어느 카드로 긁었는지 여기서 보여 준다 (2026-08-13 사장님 지시, 통장 탭과 같은 모양).
                        //     미지급금은 **카드사별로** 갚으므로 카드가 안 보이면 거래처원장 대조를 못 한다.
                        <span className="ev-side">
                          <span className="ev-dim">{counter?.code ? `${counter.code} ${counter.name}` : "—"}</span>
                          {kind === "card" && r.cardName && <span className="bk-pt bk-pt-lock">{r.cardName}</span>}
                        </span>
                      )}
                    </td>
                    <td className="tc">
                      {r.posted ? (
                        <span className="ev-st-cell">
                          <span className="ev-st ev-st-done">#{r.voucherNo ?? "—"} 확정</span>
                          {/*   만든 전표를 여기서 바로 되돌린다 (2026-08-12 사장님 지시) */}
                          {r.entryId && (
                            <button type="button" className="ev-undo" disabled={saving}
                              onClick={() => unpost(r)}>취소</button>
                          )}
                        </span>
                      ) : <span className="ev-st ev-st-todo">미처리</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── 3줄 · 고른 줄로 하는 일 — 파란 버튼은 화면을 통틀어 여기 하나뿐 ── */}
      <SelectionBar count={selRows.length} onClear={() => setSel(new Set())}
        summary={<>합계 <b className="mono-number">{won(selTotal)}</b>원{notReady.length > 0 && ` · ${notReady.length}건은 계정을 먼저 골라야 합니다`}</>}>
        <button type="button" onClick={makeVouchers} disabled={saving}
          className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed">
          {saving ? "만드는 중…" : `전표 만들기 (${selRows.length})`}
        </button>
      </SelectionBar>
      </QueryBody>

      {/* ── 쪽 넘김 — 기본 50줄, 더 보려면 조회 줄의 '조회 줄 수'를 올린다 ── */}
      <Pager page={pager.page} pages={pager.pages} total={shown.length} size={live.size}
        from={pager.from} to={pager.to} onPage={pager.setPage} />
      </QueryScreen>


    </div>
  );
}

const REF_TYPE: Record<string, string> = {
  tax_invoice: "tax_invoice", exempt_invoice: "tax_invoice",
  cash_receipt: "cash_receipt", card: "card_transaction",
};

/** 이미 전표가 된 줄에 전표번호를 붙인다 — '#3 확정'처럼 어느 전표인지 보여야 찾아갈 수 있다 */
async function attachVoucherNo(rows: Row[], entryIds: (string | null)[]): Promise<Row[]> {
  const ids = [...new Set(entryIds.filter(Boolean) as string[])];
  if (ids.length === 0) return rows;
  //   ★ 400건 상한을 없애면서 id 가 수천 개가 될 수 있다 — 한 번에 물으면 URL 이 길어 터진다.
  //     200개씩 나눠 묻는다 (2026-08-13).
  const byId = new Map<string, number | null>();
  for (let i = 0; i < ids.length; i += 200) {
    const data = logRead("collect:voucherno", await supabase
      .from("journal_entries").select("id, voucher_no").in("id", ids.slice(i, i + 200)));
    for (const e of ((data as any[]) || [])) byId.set(e.id, e.voucher_no as number | null);
  }
  return rows.map((r, i) => {
    const eid = entryIds[i];
    return eid ? { ...r, voucherNo: byId.get(eid) ?? null, entryId: eid } : r;
  });
}

// ── 자료별 읽기 ───────────────────────────────────────────────────────────
async function fetchRows(companyId: string, from: string, to: string, kind: SourceKey): Promise<{ rows: Row[]; capped: boolean }> {
  const settle = SETTLE_BY_KIND[kind] ?? "credit";

  if (kind === "card") {
    const got = await fetchAllPages<any>((a, b) => supabase.from("card_transactions")
      .select("id, transaction_date, merchant_name, amount, category, classification, journal_entry_id, merchant_bizno, card_name")
      .eq("company_id", companyId)
      .gte("transaction_date", from).lte("transaction_date", to)
      .order("transaction_date").range(a, b));
    const src = got.rows.filter((r) => Number(r.amount || 0) !== 0);
    const built = src.map((r) => {
      const amt = Number(r.amount || 0);
      const label = cardLabelOf(r.classification) || r.category || "";
      const supply = Math.round(amt / 1.1);
      return {
        id: r.id, date: String(r.transaction_date),
        //   가맹점 사업자번호 — 과세유형(구분)을 국세청에서 찾을 열쇠다.
        //   채널마다 원자료 키가 달라(charge/approval/옛 top) merchant_bizno 칸으로 모아 뒀다 (2026-08-12)
        partnerId: null, partnerName: r.merchant_name || "—", bizno: r.merchant_bizno || "",
        item: label || "카드 사용", supply, vat: amt - supply,
        vatCode: suggestVatType({ kind: "card", direction: "purchase", memo: `${r.merchant_name || ""} ${label}` }),
        settle, posted: !!r.journal_entry_id, voucherNo: null,
        cardCategory: r.category || null, cardName: r.card_name || null,
      } as Row;
    });
    return { rows: await attachVoucherNo(built, src.map((r) => r.journal_entry_id ?? null)), capped: got.capped };
  }

  if (kind === "cash_receipt") {
    const got = await fetchAllPages<any>((a, b) => supabase.from("cash_receipts")
      .select("id, type, issue_date, counterparty_name, counterparty_bizno, supply_amount, tax_amount, amount, status, source, journal_entry_id")
      .eq("company_id", companyId)
      .gte("issue_date", from).lte("issue_date", to)
      .order("issue_date").range(a, b));
    //   ★ 취소거래는 **마이너스 한 줄**로 남긴다 — 빼 버리면 원본 발행 건만 남아 매출이 부풀어 오른다.
    //     유형(현과)·계정은 그대로 두고 부호만 뒤집는다(위하고와 같은 모양, 사장님 기준). (2026-08-12)
    //     우리가 취소한 원본(manual·codef)은 없던 일이라 아예 안 보여 준다 — cashReceiptSign 참조.
    const src = got.rows.filter((r) => cashReceiptSign(r) !== 0);
    const built = src.map((r) => {
      const sign = cashReceiptSign(r);
      const supply = (Number(r.supply_amount || 0) || Math.round(Number(r.amount || 0) / 1.1)) * sign;
      const direction = r.type === "income" ? "sale" : "purchase";
      return {
        id: r.id, date: String(r.issue_date),
        partnerId: null, partnerName: r.counterparty_name || "—", bizno: r.counterparty_bizno || "",
        item: sign < 0 ? "현금영수증 (취소거래)" : "현금영수증", supply,
        vat: (Number(r.tax_amount || 0) || (Number(r.amount || 0) - Math.abs(supply))) * sign,
        vatCode: suggestVatType({ kind: "cash_receipt", direction }),
        settle, posted: !!r.journal_entry_id, voucherNo: null,
      } as Row;
    });
    return { rows: await attachVoucherNo(built, src.map((r) => r.journal_entry_id ?? null)), capped: got.capped };
  }

  //   세금계산서 / 전자계산서 — 같은 표(tax_invoices)에 tax_kind 로 갈린다
  const got = await fetchAllPages<any>((a, b) => {
    const q = supabase.from("tax_invoices")
      .select("id, type, issue_date, counterparty_name, counterparty_bizno, partner_id, item_name, supply_amount, tax_amount, tax_kind, expense_category, journal_entry_id")
      .eq("company_id", companyId).neq("status", "void")
      .gte("issue_date", from).lte("issue_date", to)
      .order("issue_date").range(a, b);
    return kind === "exempt_invoice" ? q.eq("tax_kind", "exempt") : q.neq("tax_kind", "exempt");
  });
  const src = got.rows;
  const built = src.map((r) => {
    const direction = (r.type === "sales" || r.type === "매출") ? "sale" : "purchase";
    return {
      id: r.id, date: String(r.issue_date),
      partnerId: r.partner_id || null, partnerName: r.counterparty_name || "—", bizno: r.counterparty_bizno || "",
      item: r.item_name || "—",
      supply: Number(r.supply_amount || 0), vat: Number(r.tax_amount || 0),
      vatCode: suggestVatType({
        kind: "tax_invoice", direction, taxKind: r.tax_kind,
        memo: `${r.item_name || ""} ${r.expense_category || ""}`,
      }),
      settle, posted: !!r.journal_entry_id, voucherNo: null,
    } as Row;
  });
  return { rows: await attachVoucherNo(built, src.map((r) => r.journal_entry_id ?? null)), capped: got.capped };
}
