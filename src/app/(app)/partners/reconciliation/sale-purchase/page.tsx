"use client";

// 매입매출전표입력 — 회계 프로그램 그대로의 격자 입력 (2026-08-11 사장님 지시, WEHAGO 화면 기준).
//
//   위 격자에 한 줄 = 전표 한 장. 년·월·일·거래처·유형·품명·공급가액·부가세를 옆으로 친다.
//   아래 격자는 그 줄의 **분개** — 유형이 만들고 사람이 계정만 고친다.
//
//   ★ Enter = **그 칸만** 윗줄에서 내리고 다음 칸으로 넘어간다 (2026-08-11 사장님 지시).
//     처음엔 한 줄이 통째로 내려왔는데, 한 칸만 다른 건을 칠 때 내려온 값을 도로 지워야 했다.
//     칸 단위로 내리면 같은 값은 Enter 로 한 번, 다른 값은 그냥 치면 된다 — 지우는 일이 없다.
//
//   ★ 조회는 **기간**으로 본다(달력 위젯, 월 단위). 부가세는 분기로 신고해서
//     한 달만 보면 신고 단위와 어긋난다 — 손익계산서·세금계산서와 같은 위젯이다.

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { PickList } from "@/components/pick-list";
import { PartnerQuickCreate } from "@/components/partner-quick-create";
import { downloadCsv as writeCsv } from "@/lib/csv-export";
import { DateRangeField } from "@/components/date-range-field";
import { nextSort, ThFilter, useColFilters, useColWidths, type SortState } from "@/components/sortable-th";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, ExcelMenu, SavedTabs, ConditionSave, ConditionPanel, ConditionRow, TokenField,
  AppliedChips, QuickSearch, quickSearchHit, quickTerms, useSavedQueries, defaultRangeMonth, periodQuicksMonth, RowsPerPage, Pager, usePager, AmountRange, amountHit,
  type ExcelItem, type AppliedChip,
} from "@/components/query-kit";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";
import { todayKst } from "@/lib/kst";
import { useToast } from "@/components/toast";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { friendlyError } from "@/lib/friendly-error";
import { cashReceiptSign } from "@/lib/cash-receipts";
import { useDragHeight, SplitHandle } from "@/components/split-handle";
import { findDuplicateEntries, linkTransactionToEntry } from "@/lib/dup-voucher";
import { useDupVoucherPrompt } from "@/components/dup-voucher-prompt";
import {
  VAT_TYPES, SETTLE_LABEL, STD, buildVoucherLines, vatOf, vatType, suggestVatType, normalizeSides,
  type SettleType,
} from "@/lib/vat-voucher";

//   저장된 전표에서 '상대 계정'을 알아보는 코드들 — 이걸로 분개유형(현금/외상/카드)을 되짚는다.
//   DB 에 분개유형 칸이 따로 없어서(유형이 만들어 낸 값이라) 계정으로 역추론한다.
const COUNTER_CODES: string[] = [STD.bank, STD.payable, STD.ar, STD.ap];
const settleOfCode = (code?: string | null): SettleType =>
  code === STD.bank ? "cash" : code === STD.payable ? "card"
    : (code === STD.ar || code === STD.ap) ? "credit" : "mixed";

//   제목줄 정렬 — 어느 칸을 기준으로 볼지
type SortKey = "date" | "code" | "partner" | "biz" | "type" | "item" | "supply" | "tax" | "total";
/** 검색조건 (조회 화면 표준, 2026-08-18 Wave 1 — B형: 입력 격자는 그대로, 저장분 조회만) */
/**
 * 검색조건 — 이 화면에서 걸 수 있는 조건 전부 (2026-08-18 사장님: "전자, 분개, 금액 등 조건을 다양하게").
 *   거래처(다중) · 유형(다중, 갈래 안) · 품명(글자) · 전자입력 여부 · 분개(외상/현금/카드…) · 합계 금액 범위 · 구분(갈래 '전체'일 때만)
 */
type Cond = { pt: string[]; side: string[]; vat: string[]; item: string; elec: string; settle: string[]; min: string; max: string; rows: number };
const EMPTY_COND: Cond = { pt: [], side: [], vat: [], item: "", elec: "", settle: [], min: "", max: "", rows: 50 };
const condCount = (c: Cond) => c.pt.length + c.side.length + c.vat.length + (c.item ? 1 : 0) + (c.elec ? 1 : 0) + c.settle.length + ((c.min || c.max) ? 1 : 0);

type Acct = { id: string; code: string; name: string; account_type: string };
//   거래처 코드는 회사에 따라 숫자로 저장돼 있기도 하다 — 화면에서는 항상 문자열로 다룬다
type Pt = { id: string; code: string | number | null; name: string; business_number: string | null };

/** 격자 한 줄 = 전표 한 장. 금액은 문자열로 두고 저장할 때 숫자로 바꾼다. */
type Row = {
  key: number;
  y: string; m: string; d: string;
  partner: Pt | null;
  partnerText: string;          // 검색 중 글자
  vatCode: string;
  item: string;
  supply: string;
  vat: string;
  electronic: boolean;
  settle: SettleType;
  mainAccount: Acct | null;     // 매출/비용 계정
  savedId?: string;             // 저장된 전표 id (저장분은 회색으로 잠근다)
  voucherNo?: number;
  //   불러온 증빙 — 저장할 때 전표에 되붙여서 ① 두 번 치는 것 ② 원장 이중계상을 막는다 (2026-08-11)
  refType?: RefKind;
  refId?: string;
};
type RefKind = "tax_invoice" | "card_transaction" | "cash_receipt" | "stock_doc";

//   상단 갈래 — 유형을 묶어 보는 필터 겸, 새 줄의 기본 유형
const GROUPS: { key: string; label: string; codes: string[] }[] = [
  { key: "all", label: "전체", codes: [] },
  { key: "sale_tax", label: "매출세금", codes: ["11", "12"] },
  { key: "buy_tax", label: "매입세금", codes: ["51"] },
  { key: "buy_bill", label: "매입계산", codes: ["53"] },
  { key: "sale_card", label: "매출카드", codes: ["17"] },
  { key: "buy_card", label: "매입카드", codes: ["57"] },
  { key: "buy_cash", label: "매입현금", codes: ["61"] },
  { key: "nondeduct", label: "불공", codes: ["54"] },
];

type EvidenceRow = {
  key: string; kind: "tax_invoice" | "card" | "cash_receipt" | "stock_doc";
  date: string; who: string; what: string;
  supply: number; vat: number; partnerId: string | null; suggested: string;
  //   금액이 음수이거나 가맹점명이 '[취소]' 로 시작하는 건 — 그대로 치면 안 되는 줄이라 눈에 띄게 표시한다
  cancelled?: boolean;
};
const EVIDENCE_LABEL: Record<EvidenceRow["kind"], string> = {
  tax_invoice: "세금계산서", card: "카드", cash_receipt: "현금영수증", stock_doc: "재고 전표",
};
const EVIDENCE_REF: Record<EvidenceRow["kind"], RefKind> = {
  tax_invoice: "tax_invoice", card: "card_transaction", cash_receipt: "cash_receipt", stock_doc: "stock_doc",
};
//   카드 자동분류는 {"label":"통신비",…} JSON 문자열이라 이름만 꺼낸다 (세금계산서 화면과 같은 규칙)
function cardLabelOf(raw: unknown): string {
  const v = typeof raw === "string" ? raw.trim() : "";
  if (!v) return "";
  if (v.startsWith("{")) { try { return String(JSON.parse(v)?.label || "").trim(); } catch { return ""; } }
  return v;
}

const won = (n: number) => Math.round(Number(n) || 0).toLocaleString("ko-KR");
//   음수 허용(맨 앞 '-' 하나만) — 수정세금계산서·환입·카드 취소를 치려면 필요하다 (2026-08-11).
//   일반전표(voucher-entry)가 쓰는 것과 같은 규칙이다.
const numOf = (s: string) => {
  const n = Number(String(s).replace(/[^0-9-]/g, "").replace(/(?!^)-/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const comma = (s: string) => {
  const neg = String(s).trim().startsWith("-");
  const n = Math.abs(numOf(s));
  if (!n) return neg ? "-" : "";      // '-' 만 친 중간 상태를 지우지 않는다
  return (neg ? "-" : "") + n.toLocaleString("ko-KR");
};
let K = 1;

//   새 줄은 **백지**다. 예전엔 윗줄을 물려받았는데, 그러면 칸마다 Enter 로 내릴 것이 남지 않는다
//   (이미 다 차 있으니). 내리는 건 Enter 로 사람이 고른다 (2026-08-11).
const blankRow = (): Row => ({
  key: K++,
  y: String(new Date().getFullYear()), m: "", d: "",
  partner: null, partnerText: "",
  vatCode: "11", item: "",
  supply: "", vat: "",
  electronic: false, settle: "credit", mainAccount: null,
});

//   Enter 가 훑는 칸 순서 — 화면에 보이는 왼→오 그대로다(코드·사업자번호·합계는 자동이라 건너뛴다)
const CELLS = ["y", "m", "d", "partner", "vatCode", "item", "supply", "vat", "electronic", "settle"] as const;
type CellKey = (typeof CELLS)[number];

/** 그 달의 다음 달 1일 — 조회 상한(`lt`)으로 쓴다. 말일이 28·30·31 로 갈리지 않는다. */
const monthAfter = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
};

export default function SalePurchaseVoucherPage() {
  const { role } = useUser();
  //   전표는 회사 장부라 관리자만 — 일반전표 화면과 같은 기준
  if (role !== "owner" && role !== "admin") {
    return <AccessDenied detail="매입매출전표는 대표·관리자 전용입니다." />;
  }
  return <SalePurchaseInner />;
}

function SalePurchaseInner() {
  //   분개 영역 높이 — 구분선(손잡이)이 영역 위에 있어 아래로 끌면 줄고 위로 끌면 는다 (기본 CSS max-height 38%)
  const split = useDragHeight("ve-split:sale-purchase", { min: 120, invert: true });
  const { toast } = useToast();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [group, setGroup] = useState("all");
  //   조회기간 — 월 단위(YYYY-MM). 처음엔 이번 달 한 달만 걸어 예전과 같게 보인다.
  //   조회기간 — 월 단위, 기본 지난달~이번 달(조회 화면 표준). ★ 조회값은 기억하지 않는다.
  const [fromM, setFromM] = useState(() => defaultRangeMonth().from);
  const [toM, setToM] = useState(() => defaultRangeMonth().to);
  const [q, setQ] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [cDraft, setCDraft] = useState<Cond>(EMPTY_COND);
  const [cLive, setCLive] = useState<Cond>(EMPTY_COND);
  const setD = <K extends keyof Cond>(k: K) => (v: Cond[K]) => setCDraft((c) => ({ ...c, [k]: v }));
  const periodLabel = fromM === toM ? fromM : `${fromM} ~ ${toM}`;
  const [rows, setRows] = useState<Row[]>([blankRow()]);
  const [cur, setCur] = useState(0);                 // 지금 고른 줄
  const [drop, setDrop] = useState<{ row: number; q: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const [overrides, setOverrides] = useState<Record<string, Acct | null>>({});
  const [acctPick, setAcctPick] = useState<{ line: number; q: string } | null>(null);
  const [pullOpen, setPullOpen] = useState(false);
  //   좁은 화면 기본값은 '읽기' — 14칸 격자를 폰에서 치는 일은 없다. 그래도 쳐야 하면 이 토글로 편다.
  const [phoneGrid, setPhoneGrid] = useState(false);
  const [pulled, setPulled] = useState(0);
  //   저장분을 눌러 고치는 중인 줄. 새로 치는 줄(rows)과 같은 편집기를 쓰되 저장은 update RPC 로 간다.
  const [edit, setEdit] = useState<Row | null>(null);
  //   제목줄 정렬 — 공용 규칙(SortableTh 와 같은 ▼ 표시). 기본 일자 오름차순(자료 순서 그대로)
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "date", dir: "asc" });
  //   native select 를 눌러 목록을 펼친 상태 — 그동안은 Enter 를 우리가 가로채지 않는다
  const [selectOpen, setSelectOpen] = useState<string | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    supabase.auth.getUser().then(async ({ data }) => {
      if (!data.user) return;
      const { data: u } = await supabase.from("users").select("company_id").eq("auth_id", data.user.id).maybeSingle();
      if (u?.company_id) setCompanyId(u.company_id);
    });
  }, []);

  const { data: accounts = [] } = useQuery({
    queryKey: ["sp-accounts", companyId],
    queryFn: async () => {
      const data = logRead("sale-purchase:accounts", await supabase
        .from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId!).order("code"));
      return (data || []) as Acct[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });
  // 거래처 간편 등록 팝업 — 어느 줄에서 열었는지·미리 채울 이름·매출/매입 갈래 (2026-09-02 사장님)
  const [quickCreate, setQuickCreate] = useState<{ row: number; name: string; vatCode: string } | null>(null);
  const { data: partners = [] } = useQuery({
    queryKey: ["sp-partners", companyId],
    queryFn: async () => {
      const data = logRead("sale-purchase:partners", await supabase
        .from("partners").select("id, code, name, business_number").eq("company_id", companyId!).eq("is_active", true).order("name"));
      return (data || []) as Pt[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });
  const acctByCode = useMemo(() => {
    const m = new Map<string, Acct>();
    for (const a of accounts) m.set(String(a.code), a);
    return m;
  }, [accounts]);

  // ── 그 달에 저장된 전표를 격자 위쪽에 그대로 올린다 (회계 프로그램처럼) ──
  //   ★ **확정 전표만** 그린다 (2026-08-24 사장님 지적: "수집·전표에서는 미처리인데 매입매출전표에는 반영돼 있다").
  //     전표 취소(unpost_evidence_voucher)는 전표를 지우지 않고 `status='rejected'` 로 남기고
  //     원자료의 journal_entry_id 를 비운다 — 그래서 수집은 '미처리'로 돌아온다.
  //     이 목록만 status 를 안 걸러서 **취소한 전표가 계속 보였다.** 옆 화면(일반전표)·장부·원장은
  //     전부 status='confirmed' 로 읽는다(journal-reports.ts: "반려·임시분은 장부가 아니다").
  const { data: saved = [] } = useQuery({
    queryKey: ["sp-saved", companyId, fromM, toM],
    queryFn: async () => {
      const to = monthAfter(toM);
      //   ★ 페이징 필수 — 넓은 기간엔 매입매출전표가 1,000행(PostgREST 기본 상한)을 넘는다.
      //     예전엔 상한에 조용히 잘려, 날짜가 늦은 전표(예: 6·7월 수도료 매입면세)가 목록에서
      //     통째로 사라졌다 (2026-08-28 사장님 신고: "매입면세 전표가 5월부터 하나도 안 보인다").
      const data = await fetchPaged("sale-purchase:saved", () => (supabase as any)
        .from("journal_entries")
        .select("id, voucher_no, entry_date, vat_type, supply_amount, vat_amount, description, reference_type, is_electronic, journal_lines(debit, credit, description, chart_of_accounts(id, code, name, account_type), partners(id, code, name, business_number))")
        .eq("company_id", companyId!).eq("entry_kind", "sale_purchase").eq("status", "confirmed")
        .gte("entry_date", `${fromM}-01`).lt("entry_date", to)
        .order("entry_date").order("voucher_no"), 20000);
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  /** 저장된 전표의 분개를 뜯어 본 결과 — 수정 화면을 열 때 계정을 그대로 되살리는 데 쓴다 */
  type SavedInfo = { settle: SettleType; main: Acct | null; counter: Acct | null; vatAcct: Acct | null };
  const savedInfo = useMemo(() => {
    const m = new Map<string, SavedInfo>();
    const acctOf = (l: any): Acct | null => l?.chart_of_accounts
      ? { id: l.chart_of_accounts.id, code: String(l.chart_of_accounts.code), name: l.chart_of_accounts.name, account_type: l.chart_of_accounts.account_type }
      : null;
    for (const e of (saved as any[])) {
      const isSale = vatType(e.vat_type)?.side === "sale";
      const ls = (e.journal_lines || []) as any[];
      //   상대 계정은 표준 코드로 먼저 찾는다. 회사가 다른 계정을 썼으면 방향(매출=차변/매입=대변)으로 찾는다.
      let counter = ls.find((l) => COUNTER_CODES.includes(String(l.chart_of_accounts?.code)));
      if (!counter) counter = ls.find((l) => (isSale ? Number(l.debit || 0) > 0 : Number(l.credit || 0) > 0));
      const rest = ls.filter((l) => l !== counter);
      const vatL = rest.find((l) => ([STD.vatIn, STD.vatOut] as string[]).includes(String(l.chart_of_accounts?.code)));
      const mainL = rest.find((l) => l !== vatL);
      m.set(e.id, {
        settle: settleOfCode(counter?.chart_of_accounts?.code),
        main: acctOf(mainL), counter: acctOf(counter), vatAcct: acctOf(vatL),
      });
    }
    return m;
  }, [saved]);

  const savedRows: Row[] = saved.map((e: any) => {
    const p = (e.journal_lines || []).map((l: any) => l.partners).find(Boolean) || null;
    const [y, m, d] = String(e.entry_date || "").split("-");
    const info = savedInfo.get(e.id);
    return {
      key: -1, y, m: String(Number(m || 0)), d: String(Number(d || 0)),
      partner: p, partnerText: p?.name || "",
      vatCode: e.vat_type || "11",
      item: e.description || "",
      supply: won(e.supply_amount), vat: won(e.vat_amount),
      //   이제 저장되는 값이다. 증빙에서 온 건은 서버가 참으로 고정하고, 손으로 친 건은 사람이 정한다.
      electronic: !!e.is_electronic,
      settle: info?.settle ?? ("credit" as SettleType), mainAccount: info?.main ?? null,
      savedId: e.id, voucherNo: e.voucher_no,
      refType: (e.reference_type || undefined) as RefKind | undefined,
    };
  }).filter((r: Row) => group === "all" || GROUPS.find((g) => g.key === group)!.codes.includes(r.vatCode));

  //   저장분 조회 — 빠른검색(거래처·품명·사업자번호·금액, 쉼표=또는) + 검색조건(거래처·매출/매입)
  const rowHit = (r: Row, c: Cond) => {
    if (c.pt.length && !c.pt.includes(r.partner?.name || "")) return false;
    if (c.side.length && !c.side.includes(vatType(r.vatCode)?.side || "")) return false;
    if (c.vat.length && !c.vat.includes(r.vatCode)) return false;
    if (c.item && !String(r.item || "").toLowerCase().includes(c.item.toLowerCase())) return false;
    if (c.elec === "y" && !r.electronic) return false;
    if (c.elec === "n" && r.electronic) return false;
    if (c.settle.length && !c.settle.includes(r.settle)) return false;
    if (!amountHit(numOf(r.supply) + numOf(r.vat), c.min, c.max)) return false;
    return true;
  };
  //   열 너비 — 표 머리단 표준처럼 드래그로 조절·더블클릭 초기화. 격자(grid)라 SortableTh 를 못 쓰고 같은 손잡이(th-grip)만 붙인다.
  //   ⚠️ 2026-08-18 사장님 지적: 코드 칸이 좁아 정렬 버튼이 ≡ 에 가려 안 눌렸다 — 칸을 넓히고 손잡이를 달았다.
  const SPV_COLS = ["y", "m", "d", "code", "partner", "biz", "type", "item", "supply", "vat", "total", "elec", "je", "x"] as const;
  const [colW, setColW] = useColWidths("sale-purchase-colw-v1", {
    y: 56, m: 40, d: 40, code: 96, partner: 190, biz: 130, type: 116, item: 220, supply: 108, vat: 96, total: 108, elec: 52, je: 84, x: 30,
  });
  const gridTemplate = SPV_COLS.map((k) => (k === "partner" || k === "item" ? `minmax(${colW[k]}px, 1fr)` : `${colW[k]}px`)).join(" ");
  const grip = (k: (typeof SPV_COLS)[number]) => (
    <span className="th-grip" title="드래그: 너비 조절 · 더블클릭: 처음 너비"
      onMouseDown={(e) => {
        e.preventDefault(); e.stopPropagation();
        const startX = e.clientX; const startW = colW[k] || 80;
        const move = (ev: MouseEvent) => setColW(k, Math.max(40, startW + (ev.clientX - startX)));
        const up = () => { window.removeEventListener("mousemove", move); window.removeEventListener("mouseup", up); document.body.style.cursor = ""; };
        document.body.style.cursor = "col-resize";
        window.addEventListener("mousemove", move); window.addEventListener("mouseup", up);
      }}
      onDoubleClick={(e) => { e.stopPropagation(); setColW(k, ({ y: 56, m: 40, d: 40, code: 96, partner: 190, biz: 130, type: 116, item: 220, supply: 108, vat: 96, total: 108, elec: 52, je: 84, x: 30 } as Record<string, number>)[k]); }}
      onClick={(e) => e.stopPropagation()} />
  );
  //   머리단 ≡ 필터 — 칸에 실제로 있는 값 중에서 고른다 (수집·전표와 같은 부품)
  const cf = useColFilters();
  const colVal = (r: Row) => ({
    code: r.partner?.code != null ? String(r.partner.code) : "", partner: r.partner?.name || "", biz: String(r.partner?.business_number || ""),
    type: vatType(r.vatCode)?.label.split(". ")[1] || r.vatCode, item: r.item || "",
  });
  const cfSpec = (k: keyof ReturnType<typeof colVal>) => cf.spec(k, savedRows.filter((r) => rowHit(r, cLive)).map((r) => colVal(r)[k]));
  const shownSaved = savedRows.filter((r) => rowHit(r, cLive) && cf.hit(colVal(r)) &&
    quickSearchHit(q, [r.partner?.name, r.partner?.business_number, r.item, r.partner?.code != null ? String(r.partner.code) : ""], [numOf(r.supply), numOf(r.vat), numOf(r.supply) + numOf(r.vat)]));
  const previewCount = savedRows.filter((r) => rowHit(r, cDraft)).length;
  //   고를 수 있는 값 — 갈래 안 유형만, 분개는 전부
  const vatOpts = useMemo(() => VAT_TYPES.filter((v) => group === "all" || GROUPS.find((g) => g.key === group)!.codes.includes(v.code)).map((v) => ({ value: v.code, label: v.label })), [group]);
  const settleOpts = (Object.keys(SETTLE_LABEL) as SettleType[]).map((st) => ({ value: st, label: SETTLE_LABEL[st].split(". ")[1] || SETTLE_LABEL[st] }));
  const ptOpts = useMemo(() => [...new Set(savedRows.map((r) => r.partner?.name).filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b), "ko")).map((v) => ({ value: v as string, label: v as string })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [saved, group]);
  //   제목줄 정렬 — 저장분만 정렬한다. 입력 줄은 정렬을 안 탄다(치던 자리가 움직이면 안 된다)
  const sortedSaved = useMemo(() => {
    const val = (r: Row): string | number => {
      switch (sort.key) {
        case "date": return `${r.y}-${String(r.m).padStart(2, "0")}-${String(r.d).padStart(2, "0")}`;
        case "code": return String(r.partner?.code ?? "");
        case "partner": return r.partner?.name ?? "";
        case "biz": return String(r.partner?.business_number ?? "");
        case "type": return r.vatCode;
        case "item": return r.item;
        case "supply": return numOf(r.supply);
        case "tax": return numOf(r.vat);
        default: return numOf(r.supply) + numOf(r.vat);
      }
    };
    return [...shownSaved].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y), "ko");
      return sort.dir === "asc" ? c : -c;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved, group, sort, q, cLive, cf.key]);
  //   쪽 넘김 — 저장분만 쪽을 나눈다(기본 50줄, 줄 수는 검색조건 안). 입력 줄은 늘 맨 아래에 그대로 있다.
  //   ⚠️ 2026-08-18 사장님: "줄 수가 없는데 맞는지? 조회 건 많으면 페이지로 제공되는지?" — 표준인데 빠져 있었다.
  const pager = usePager(sortedSaved, cLive.rows, `${group}|${fromM}|${toM}|${q}|${JSON.stringify(cLive)}|${cf.key}`);
  //   내 조건 — ★ 하나가 이 화면(조회부)의 기본값
  const saved2 = useSavedQueries("sale-purchase", companyId);
  const paramsNow = { group, from: fromM, to: toM, q, cond: cLive };
  const paramsBasic = { group: "all", ...defaultRangeMonth(), q: "", cond: EMPTY_COND };
  const applySaved = (p: Record<string, unknown>) => {
    if (typeof p.group === "string" && GROUPS.some((g) => g.key === p.group)) setGroup(p.group);
    if (typeof p.from === "string" && typeof p.to === "string") { setFromM(p.from); setToM(p.to); }
    if (typeof p.q === "string") setQ(p.q);
    const c = { ...EMPTY_COND, ...(p.cond as Partial<Cond> | undefined) };
    setCDraft(c); setCLive(c);
  };
  const [defDone, setDefDone] = useState(false);
  useEffect(() => {
    if (defDone || !saved2.isFetched) return;
    setDefDone(true);
    if (saved2.def) applySaved(saved2.def.params || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved2.isFetched, saved2.def, defDone]);
  const suggestName = () => [cDraft.pt[0], cDraft.vat[0] ? (VAT_TYPES.find((x) => x.code === cDraft.vat[0])?.label || "") : "", cDraft.settle[0] ? (settleOpts.find((o) => o.value === cDraft.settle[0])?.label || "") : "", cDraft.elec === "y" ? "전자입력" : "", (cDraft.min || cDraft.max) ? "금액" : "", GROUPS.find((g) => g.key === group)?.label].filter(Boolean).slice(0, 3).join(" · ") || "내 조건";
  const dropCond = (patch: Partial<Cond>) => { const c = { ...cLive, ...patch }; setCLive(c); setCDraft(c); };
  const chips: AppliedChip[] = [
    ...quickTerms(q).map((t, i) => ({ group: "빠른검색", label: t, onRemove: () => setQ(quickTerms(q).filter((_, j) => j !== i).join(", ")) })),
    ...cLive.pt.map((v) => ({ group: "거래처", label: v, onRemove: () => dropCond({ pt: cLive.pt.filter((x) => x !== v) }) })),
    ...cLive.side.map((v) => ({ group: "구분", label: v === "sale" ? "매출" : "매입", onRemove: () => dropCond({ side: cLive.side.filter((x) => x !== v) }) })),
    ...cLive.vat.map((v) => ({ group: "유형", label: VAT_TYPES.find((x) => x.code === v)?.label || v, onRemove: () => dropCond({ vat: cLive.vat.filter((x) => x !== v) }) })),
    ...(cLive.item ? [{ group: "품명", label: cLive.item, onRemove: () => dropCond({ item: "" }) }] : []),
    ...(cLive.elec ? [{ group: "전자", label: cLive.elec === "y" ? "전자입력만" : "직접 입력만", onRemove: () => dropCond({ elec: "" }) }] : []),
    ...cLive.settle.map((v) => ({ group: "분개", label: settleOpts.find((o) => o.value === v)?.label || v, onRemove: () => dropCond({ settle: cLive.settle.filter((x) => x !== v) }) })),
    ...((cLive.min || cLive.max) ? [{ group: "합계 금액", label: `${Number(cLive.min || 0).toLocaleString("ko")} ~ ${cLive.max ? Number(cLive.max).toLocaleString("ko") : "제한없음"}`, onRemove: () => dropCond({ min: "", max: "" }) }] : []),
  ];
  const clearAll = () => { setQ(""); setCLive(EMPTY_COND); setCDraft(EMPTY_COND); };
  const toggleIn = (arr: string[], v: string) => (arr.includes(v) ? arr.filter((x) => x !== v) : [...arr, v]);

  // ── 아직 전표가 안 만들어진 증빙 — 세 화면에 흩어져 있던 입구를 여기 하나로 모은다 ──
  const { data: pending = [] } = useQuery({
    queryKey: ["sp-pending", companyId, fromM, toM],
    queryFn: async () => {
      const from = fromM + "-01";
      const to = monthAfter(toM);
      const [ti, card, cash, stk] = await Promise.all([
        supabase.from("tax_invoices")
          .select("id, type, issue_date, counterparty_name, partner_id, item_name, supply_amount, tax_amount, tax_kind, expense_category, journal_entry_id")
          .eq("company_id", companyId!).is("journal_entry_id", null).neq("status", "void")
          .gte("issue_date", from).lt("issue_date", to).order("issue_date").limit(200),
        supabase.from("card_transactions")
          .select("id, transaction_date, merchant_name, amount, category, classification, journal_entry_id")
          .eq("company_id", companyId!).is("journal_entry_id", null)
          .gte("transaction_date", from).lt("transaction_date", to).order("transaction_date").limit(200),
        supabase.from("cash_receipts")
          .select("id, type, issue_date, counterparty_name, supply_amount, tax_amount, amount, status, source, journal_entry_id")
          .eq("company_id", companyId!).is("journal_entry_id", null)
          .gte("issue_date", from).lt("issue_date", to).order("issue_date").limit(200),
        //   ★ 재고 메뉴의 판매·구매 전표 — 세금계산서·카드와 같은 자리에 뜬다 (2026-08-25 사장님 지시).
        //     전표를 자동으로 만들지 않고 여기서 사람이 불러와 저장한다(제안은 자동, 확정은 사람).
        supabase.from("stock_docs")
          .select("id, doc_no, reason, doc_date, partner_id, note, journal_entry_id, partners(name), stock_moves(qty, unit_price, vat_amount)")
          .eq("company_id", companyId!).is("journal_entry_id", null).eq("status", "active").in("reason", ["sale", "purchase"])
          .gte("doc_date", from).lt("doc_date", to).order("doc_date").limit(200),
      ]);
      const out: EvidenceRow[] = [];
      for (const r of ((ti.data as any[]) || [])) {
        const dir = (r.type === "sales" || r.type === "매출") ? "sale" : "purchase";
        out.push({
          key: "ti:" + r.id, kind: "tax_invoice", date: r.issue_date, who: r.counterparty_name || "—",
          what: r.item_name || "—", supply: Number(r.supply_amount || 0), vat: Number(r.tax_amount || 0),
          partnerId: r.partner_id || null, cancelled: Number(r.supply_amount || 0) < 0,
          suggested: suggestVatType({ kind: "tax_invoice", direction: dir, taxKind: r.tax_kind, memo: (r.item_name || "") + " " + (r.expense_category || "") }),
        });
      }
      for (const r of ((card.data as any[]) || [])) {
        const amt = Number(r.amount || 0);
        if (amt === 0) continue;
        //   취소분(음수·[취소] 표기)도 이제 전표로 칠 수 있다 — 부호 그대로 내려보낸다 (2026-08-11).
        //   원본 승인 건과 자동으로 짝짓지는 않는다 — 금액·가맹점이 같아도 다른 건일 수 있어서다.
        const label = cardLabelOf(r.classification) || r.category || "";
        const sup = Math.round(amt / 1.1);
        out.push({
          key: "card:" + r.id, kind: "card", date: r.transaction_date, who: r.merchant_name || "—",
          what: label || "카드 사용", supply: sup, vat: amt - sup, partnerId: null,
          cancelled: amt < 0 || String(r.merchant_name || "").trim().startsWith("[취소]"),
          suggested: suggestVatType({ kind: "card", direction: "purchase", memo: (r.merchant_name || "") + " " + label }),
        });
      }
      for (const r of ((cash.data as any[]) || [])) {
        //   취소거래는 카드와 같은 규칙 — 부호 그대로(마이너스) 내려보낸다. 원본 발행 건을 깎는 줄이라
        //   빼 버리면 매출이 부풀어 오른다. 우리가 취소한 원본은 0 이라 건너뛴다. (2026-08-12)
        const sign = cashReceiptSign(r);
        if (sign === 0) continue;
        const dir = r.type === "income" ? "sale" : "purchase";
        const base = Number(r.supply_amount || 0) || Math.round(Number(r.amount || 0) / 1.1);
        const sup = base * sign;
        out.push({
          key: "cash:" + r.id, kind: "cash_receipt", date: r.issue_date, who: r.counterparty_name || "—",
          what: sign < 0 ? "현금영수증 (취소거래)" : "현금영수증", supply: sup,
          vat: (Number(r.tax_amount || 0) || (Number(r.amount || 0) - base)) * sign,
          partnerId: null, cancelled: sup < 0,
          suggested: suggestVatType({ kind: "cash_receipt", direction: dir }),
        });
      }
      //   0 원 건만 뺀다. 음수(수정세금계산서·환입·카드 취소)는 그대로 둔다 — 격자가 부호를 받는다.
      for (const r of (((stk as any).data as any[]) || [])) {
        const ms = (r.stock_moves || []) as any[];
        //   판매는 음수(나감)로 쌓여 있다 — 부호를 살려 합치면 반품은 음수 전표로 온다(카드 취소분과 같은 규칙)
        const signed = ms.reduce((n, m) => n + Number(m.unit_price || 0) * Number(m.qty || 0), 0);
        const sup = r.reason === "sale" ? -signed : signed;
        const vat = ms.reduce((n, m) => n + Number(m.vat_amount || 0), 0) * (sup < 0 ? -1 : 1);
        if (sup === 0) continue;                       // 단가 없이 수량만 적은 전표는 금액이 없어 전표를 못 만든다
        out.push({
          key: "stk:" + r.id, kind: "stock_doc", date: r.doc_date,
          who: r.partners?.name || (String(r.note || "").match(/거래처: ([^·]+)/)?.[1] || "").trim() || "—",
          what: `${r.doc_no}${r.note ? " · " + r.note : ""}`,
          supply: Math.round(sup), vat: Math.round(Math.abs(vat)) * (sup < 0 ? -1 : 1),
          partnerId: r.partner_id || null, cancelled: sup < 0,
          suggested: r.reason === "sale" ? "11" : "51",
        });
      }
      return out.filter((r) => r.supply !== 0).sort((a, b) => (a.date || "").localeCompare(b.date || ""));
    },
    enabled: !!companyId && pullOpen,
  });

  //   불러오면 격자 줄로 얹힌다 — 여러 건을 이어 눌러 한 번에 쌓을 수 있다
  const pullOne = (r: EvidenceRow) => {
    const [yy, mm, dd] = String(r.date || "").split("-");
    const p = partners.find((x) => (r.partnerId ? x.id === r.partnerId : x.name === r.who)) || null;
    setRows((rs) => {
      const next = [...rs];
      const target = blankRow();
      target.y = yy || target.y; target.m = String(Number(mm || 0)) || ""; target.d = String(Number(dd || 0)) || "";
      target.partner = p; target.partnerText = p?.name || r.who;
      target.vatCode = r.suggested; target.settle = vatType(r.suggested)?.defaultSettle || "credit";
      target.item = r.what; target.supply = won(r.supply); target.vat = won(r.vat);
      target.refType = EVIDENCE_REF[r.kind]; target.refId = r.key.split(":")[1];
      //   맨 끝 빈 줄이 있으면 그 자리에 채우고, 없으면 뒤에 붙인다
      const last = next[next.length - 1];
      if (last && isEmptyRow(last)) next[next.length - 1] = target;
      else next.push(target);
      return next;
    });
    setPulled((n) => n + 1);
  };

  // ── 지금 줄의 분개 — 수정 중이면 그 전표의 줄이 기준이다 ──
  //   EDIT_IDX(-1) = 수정 중인 저장분. 입력 줄은 0,1,2… 이라 겹치지 않는다.
  const EDIT_IDX = -1;
  const selIdx = edit ? EDIT_IDX : cur;
  const row = edit ?? rows[cur] ?? rows[0];
  const t = vatType(row?.vatCode || "11")!;
  const supplyNum = numOf(row?.supply || "");
  const vatNum = numOf(row?.vat || "");
  const draft = useMemo(
    () => buildVoucherLines({
      vatCode: row?.vatCode || "11", settle: row?.settle || "credit", supply: supplyNum, vat: vatNum,
      mainCode: row?.mainAccount?.code ?? null, mainName: row?.mainAccount?.name ?? null,
    }),
    [row?.vatCode, row?.settle, supplyNum, vatNum, row?.mainAccount],
  );
  const jeLines = draft.map((d, i) => ({
    i, side: d.side, locked: d.locked,
    account: overrides[`${row?.key}:${i}`] !== undefined
      ? overrides[`${row?.key}:${i}`]
      : (d.code ? acctByCode.get(d.code) || null : row?.mainAccount || null),
    amount: d.amount,
  }));
  const debitSum = jeLines.filter((l) => l.side === "debit").reduce((s, l) => s + l.amount, 0);
  const creditSum = jeLines.filter((l) => l.side === "credit").reduce((s, l) => s + l.amount, 0);
  //   음수 전표(취소분)도 차·대는 맞아야 한다 — 0 만 아니면 된다
  const balanced = debitSum !== 0 && debitSum === creditSum;
  const canSave = balanced && jeLines.every((l) => !!l.account) && !!row?.partner && !!row?.m && !!row?.d && !saving;
  const isMinus = supplyNum < 0;

  //   i < 0 이면 수정 중인 저장분, 아니면 입력 줄. 아래 세 함수가 그 갈림을 한 곳에서 흡수한다.
  const patch = (i: number, p: Partial<Row>) => {
    if (i < 0) { setEdit((r) => (r ? { ...r, ...p } : r)); return; }
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));
  };

  //   유형을 바꾸면 세액을 다시 계산하고 결제 방법을 그 유형의 기본으로 맞춘다
  const vatPatch = (r: Row, code: string): Partial<Row> | null => {
    const nt = vatType(code);
    if (!nt) return null;
    const keepAcct = r.mainAccount && r.mainAccount.account_type === (nt.side === "sale" ? "revenue" : "expense");
    return { vatCode: code, settle: nt.defaultSettle, vat: won(vatOf(code, numOf(r.supply))), mainAccount: keepAcct ? r.mainAccount : null };
  };
  const setVat = (i: number, code: string) => {
    const cur0 = i < 0 ? edit : rows[i];
    if (!cur0) return;
    const p = vatPatch(cur0, code);
    if (p) patch(i, p);
  };
  const setSupply = (i: number, v: string) => {
    const cur0 = i < 0 ? edit : rows[i];
    if (!cur0) return;
    patch(i, { supply: comma(v), vat: won(vatOf(cur0.vatCode, numOf(v))) });
  };

  /** 저장분을 눌러 수정 시작 — 저장된 계정을 분개 칸에 그대로 되살린다.
   *  분개 줄은 유형이 다시 만들되(금액을 고치면 따라 움직여야 하니), 계정은 저장된 것을 덮어 씌운다.
   *  어느 줄이 무엇인지는 **만들어진 줄에서** 읽는다 — locked=부가세, 상대편 방향=상대계정, 나머지=주계정.
   *  (규칙을 여기서 다시 쓰지 않으므로 buildVoucherLines 가 바뀌어도 어긋나지 않는다) */
  const startEdit = (r: Row) => {
    if (!r.savedId) return;
    const info = savedInfo.get(r.savedId);
    const key = K++;
    const isSale = vatType(r.vatCode)?.side === "sale";
    const counterSide = isSale ? "debit" : "credit";
    const d = buildVoucherLines({
      vatCode: r.vatCode, settle: r.settle, supply: numOf(r.supply), vat: numOf(r.vat),
      mainCode: r.mainAccount?.code ?? null, mainName: r.mainAccount?.name ?? null,
    });
    const ov: Record<string, Acct | null> = {};
    d.forEach((line, i) => {
      ov[`${key}:${i}`] = line.locked ? (info?.vatAcct ?? null)
        : line.side === counterSide ? (info?.counter ?? null)
          : (info?.main ?? null);
    });
    setOverrides((o) => ({ ...o, ...ov }));
    setEdit({ ...r, key });
    setDrop(null);
    setAcctPick(null);
  };
  const cancelEdit = () => { setEdit(null); setAcctPick(null); setDrop(null); };

  const toggleSort = (key: SortKey) => setSort((c) => nextSort(c, key));
  //   정렬 표시 — 표 머리단 부품(SortableTh)과 같은 삼각형·같은 상자
  const sortMark = (key: SortKey) => {
    const on = sort.key === key;
    return (
      <em className={on ? "th-mark th-mark-on" : "th-mark"} aria-hidden>
        <svg width="9" height="9" viewBox="0 0 10 10" fill="currentColor" style={on && sort.dir === "asc" ? { transform: "rotate(180deg)" } : undefined}>
          <path d="M0 2h10L5 8 0 2z" />
        </svg>
      </em>
    );
  };

  const isEmptyRow = (r: Row) => !r.m && !r.d && !r.partner && !r.item && !r.supply;

  /** 윗줄 — 첫 줄이면 그 위(저장분)의 마지막 전표가 윗줄이다 */
  const aboveOf = (i: number): Row | null =>
    //   수정 중인 저장분(-1)은 '이어 치는' 줄이 아니라 윗줄이 없다
    i < 0 ? null
      : i > 0 ? rows[i - 1]
        : (sortedSaved.length > 0 ? sortedSaved[sortedSaved.length - 1] : null);

  /** ★ Enter — **그 칸 하나만** 윗줄에서 내린다 (2026-08-11 사장님 지시).
   *  '빈 칸일 때만 내린다'로 하면 유형·분개처럼 늘 값이 있는 칸은 영영 못 내린다 — 눌러도
   *  아무 일이 안 나 고장난 것처럼 보인다. 그래서 **누른 칸은 항상 내린다**(사람이 그 칸을 골라 눌렀다). */
  const pullCell = (i: number, key: CellKey) => {
    const a = aboveOf(i);
    if (!a) return;
    switch (key) {
      case "y": patch(i, { y: a.y }); break;
      case "m": patch(i, { m: a.m }); break;
      case "d": patch(i, { d: a.d }); break;
      //   증빙 꼬리표(refType·refId)는 따라오지 않는다 — 거래처만 같을 뿐 다른 건이다
      case "partner": patch(i, { partner: a.partner, partnerText: a.partner?.name || a.partnerText }); setDrop(null); break;
      case "vatCode": setVat(i, a.vatCode); break;    // 유형이 세액·결제방법·분개까지 다시 만든다
      case "item": patch(i, { item: a.item }); break;
      case "supply": setSupply(i, a.supply); break;   // 공급가액을 내리면 부가세도 따라 붙는다
      case "vat": patch(i, { vat: comma(a.vat) }); break;
      case "electronic": patch(i, { electronic: a.electronic }); break;
      case "settle": patch(i, { settle: a.settle }); break;
    }
  };

  const focusCell = (i: number, key: CellKey) => requestAnimationFrame(() => {
    const el = gridRef.current?.querySelector<HTMLElement>(`[data-cell="${key}-${i}"]`);
    el?.focus();
    if (el instanceof HTMLInputElement) el.select();
  });

  //   Enter = 이 칸에 윗값을 내리고 **다음 칸으로**. 끝 칸이면 아래 줄 첫 칸으로(없으면 빈 줄을 만든다).
  //   같은 값은 Enter 로 훑고 다른 값은 그냥 친다 — 내려온 것을 지울 일이 없다.
  const onCellKey = (e: React.KeyboardEvent, i: number, key: CellKey) => {
    if (e.key !== "Enter") return;
    //   유형·분개는 native select 다 — 목록을 펼쳐 놓고 Enter 로 고르는 중일 수 있다.
    //   그때 우리가 Enter 를 가로채면 **고를 수가 없다**. 펼쳐져 있으면 native 에 넘긴다.
    //   (aria-expanded 가 없으니 '방금 목록을 열었나'를 상태로 들고 판단한다)
    if ((key === "vatCode" || key === "settle") && selectOpen === `${key}-${i}`) {
      setSelectOpen(null);
      return;
    }
    e.preventDefault();
    pullCell(i, key);
    const at = CELLS.indexOf(key);
    if (at < CELLS.length - 1) { focusCell(i, CELLS[at + 1]); return; }
    if (i < 0) return;                                   // 수정 줄 — 끝 칸에서 멈춘다
    if (i === rows.length - 1) setRows((rs) => [...rs, blankRow()]);
    setCur(i + 1);
    focusCell(i + 1, "y");
  };

  const addRow = () => setRows((rs) => [...rs, blankRow()]);
  const removeRow = (i: number) => {
    if (i < 0) { cancelEdit(); return; }
    setRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : [blankRow()]));
  };

  //   중복 의심 (2026-08-19, docs/20260819_PLAN_duplicate_voucher_handling.md) — 새 전표를 만들기 전에
  //   같은 날 같은 금액의 전표가 있으면 묻는다. 증빙에서 온 줄은 그 증빙을 기존 전표에 걸 수 있고,
  //   손으로 친 줄은 걸어 둘 것이 없어 새 전표/취소만 고른다.
  const { askDup, dupPromptElement } = useDupVoucherPrompt();
  const save = async () => {
    if (!canSave) return;
    const date = `${row.y}-${String(Number(row.m)).padStart(2, "0")}-${String(Number(row.d)).padStart(2, "0")}`;
    if (!edit?.savedId && companyId) {
      const dups = await findDuplicateEntries(companyId, date, supplyNum + vatNum);
      if (dups.length > 0) {
        const a = await askDup(`${t.label} ${date} ${row.partner?.name || ""} ${won(supplyNum + vatNum)}원`, row.item || "", dups, { allowLink: !!(row.refType && row.refId) });
        if (a.action === "cancel") return;
        if (a.action === "link" && row.refType && row.refId) {
          try {
            if (row.refType === "card_transaction") await linkTransactionToEntry("card", row.refId, a.entryId);
            else await supabase.from(row.refType === "cash_receipt" ? "cash_receipts" : "tax_invoices").update({ journal_entry_id: a.entryId } as never).eq("id", row.refId).is("journal_entry_id", null);
            toast("기존 전표에 연결했습니다 — 새 전표는 만들지 않았습니다", "success");
            qc.invalidateQueries({ queryKey: ["sp-pending"] });
            setRows((rs) => { const next = rs.filter((_, k) => k !== cur); return (next.length > 0 ? next : [blankRow()]); });
            setCur(0); setOverrides({});
          } catch (e) { toast(friendlyError(e, "연결 실패"), "error"); }
          return;
        }
      }
    }
    setSaving(true);
    try {
      //   음수 줄은 차/대를 뒤집어 절대값으로 넣는다 — journal_lines 는 음수를 받지 않는다.
      //   결과적으로 정상 전표의 반대 분개가 되어 회계적으로도 맞다.
      const normalized = normalizeSides(jeLines.map((l) => ({ side: l.side, amount: l.amount })));
      const payload = jeLines.map((l, i) => ({
        account_id: l.account!.id,
        debit: normalized[i].side === "debit" ? normalized[i].amount : 0,
        credit: normalized[i].side === "credit" ? normalized[i].amount : 0,
        memo: row.item || "",
        partner_id: row.partner?.id || null,
      }));
      //   ★ 저장분을 고치는 중이면 update 로 간다 — 새 전표를 하나 더 만들면 안 된다
      if (edit?.savedId) {
        const { error } = await (supabase.rpc as any)("update_sale_purchase_voucher", {
          p_entry_id: edit.savedId, p_entry_date: date, p_vat_type: row.vatCode,
          p_supply_amount: supplyNum, p_vat_amount: vatNum,
          p_description: row.item || `${t.label} ${row.partner?.name || ""}`.trim(),
          p_lines: payload,
          p_electronic: !!row.electronic,
        });
        if (error) throw error;
        toast(`전표 #${edit.voucherNo ?? ""} 를 고쳤습니다`, "success");
        qc.invalidateQueries({ queryKey: ["sp-saved"] });
        setEdit(null);
        setOverrides({});
        return;
      }
      const { error } = await (supabase.rpc as any)("save_sale_purchase_voucher", {
        p_entry_date: date, p_vat_type: row.vatCode,
        p_supply_amount: supplyNum, p_vat_amount: vatNum,
        p_description: row.item || `${t.label} ${row.partner?.name || ""}`.trim(),
        p_lines: payload,
        //   불러온 증빙이면 꼬리표를 같이 보낸다 — 증빙에 전표가 되붙어 다시 불러올 수 없게 된다
        p_reference_type: row.refType || null,
        p_reference_id: row.refId || null,
        //   손으로 켠 '전자'도 이제 저장된다 (증빙에서 온 건은 서버가 참으로 고정한다)
        p_electronic: !!row.electronic,
      });
      if (error) throw error;
      toast(`전표를 저장했습니다 (${t.label} · ${won(supplyNum + vatNum)}원)`, "success");
      qc.invalidateQueries({ queryKey: ["sp-saved"] });
      qc.invalidateQueries({ queryKey: ["sp-pending"] });
      //   저장한 줄은 지우고 그 내용을 물려받은 빈 줄을 남긴다 — 다음 건을 바로 이어 친다
      setRows((rs) => {
        const next = rs.filter((_, k) => k !== cur);
        return (next.length > 0 ? next : [blankRow()]);
      });
      setCur(0);
      setOverrides({});
    } catch (e: any) {
      const m = String(e?.message || "");
      toast(
        m.includes("PERIOD_LOCKED") ? "마감된 달이라 전표를 저장할 수 없습니다."
        : m.includes("FORBIDDEN") ? "전표를 저장할 권한이 없습니다."
        : m.includes("ALREADY_POSTED") ? "이 증빙은 이미 전표로 만들어져 있습니다."
        : m.includes("NOT_SALE_PURCHASE") ? "이 전표는 매입매출전표가 아닙니다 — 일반전표에서 고쳐 주세요."
        : m.includes("NOT_FOUND") ? "전표를 찾지 못했습니다 — 새로고침 후 다시 시도해 주세요."
        : m.includes("UNBALANCED") ? "차변과 대변이 맞지 않습니다."
        : `저장 실패: ${friendlyError(e, "알 수 없는 오류")}`, "error",
      );
    } finally { setSaving(false); }
  };

  const filteredPartners = (q: string) =>
    partners.filter((p) => !q || p.name.toLowerCase().includes(q.toLowerCase())
      || String(p.business_number || "").includes(q) || String(p.code || "").includes(q)).slice(0, 12);
  const filterAccts = (q: string, side?: "sale" | "purchase") =>
    accounts.filter((a) =>
      (!side || a.account_type === (side === "sale" ? "revenue" : "expense"))
      && (!q || a.name.toLowerCase().includes(q.toLowerCase()) || String(a.code).includes(q))).slice(0, 40);

  /** 격자 한 줄 편집기 — 새로 치는 줄(idx>=0)과 저장분 수정 줄(idx=-1)이 **같은 화면**을 쓴다.
   *  하나로 합쳐 둬야 "치는 곳과 고치는 곳이 다르게 생겼다"는 일이 안 생긴다. */
  const gridRow = (r: Row, i: number) => {
    const isEdit = i < 0;
    //   전자세금계산서에서 온 줄만 못 끈다 — 출처가 정하는 사실이라서다.
    //   손으로 켠 '전자'는 이제 저장되므로, 수정할 때도 사람이 다시 끌 수 있어야 한다.
    const fromTaxInvoice = r.refType === "tax_invoice";
    return (
      <div key={isEdit ? `edit-${r.key}` : r.key}
        className={`spv-row ${selIdx === i ? "spv-cur" : ""} ${isEdit ? "spv-editing" : ""}`.trim()}
        onClick={() => { if (!isEdit) { setEdit(null); setCur(i); } }}>
        <input className="spv-in tc" data-cell={`y-${i}`} value={r.y} onChange={(e) => patch(i, { y: e.target.value })}
          onKeyDown={(e) => onCellKey(e, i, "y")} onFocus={() => { if (!isEdit) setCur(i); }} inputMode="numeric" maxLength={4} />
        <input className="spv-in tc" data-cell={`m-${i}`} value={r.m} onChange={(e) => patch(i, { m: e.target.value.replace(/\D/g, "").slice(0, 2) })}
          onKeyDown={(e) => onCellKey(e, i, "m")} onFocus={() => { if (!isEdit) setCur(i); }} inputMode="numeric" placeholder="월" />
        <input className="spv-in tc" data-cell={`d-${i}`} value={r.d} onChange={(e) => patch(i, { d: e.target.value.replace(/\D/g, "").slice(0, 2) })}
          onKeyDown={(e) => onCellKey(e, i, "d")} onFocus={() => { if (!isEdit) setCur(i); }} inputMode="numeric" placeholder="일" />
        <span className="spv-in-ro tc">{r.partner?.code || ""}</span>
        <div className="relative">
          <input className="spv-in" data-cell={`partner-${i}`} value={r.partner?.name || r.partnerText}
            onChange={(e) => { patch(i, { partner: null, partnerText: e.target.value }); setDrop({ row: i, q: e.target.value }); }}
            onFocus={() => { if (!isEdit) setCur(i); setDrop({ row: i, q: r.partnerText }); }}
            onKeyDown={(e) => onCellKey(e, i, "partner")} placeholder="거래처" />
          {drop?.row === i && (
            //   거래처도 계정과 **같은 방식**으로 고른다 — ↑↓ 이동, Enter 고르기 (2026-08-12 사장님 지시)
            <PickList
              items={partners.map((pt) => ({ id: pt.id, code: pt.code != null ? String(pt.code) : "", name: pt.name }))}
              placeholder="거래처 검색 (이름·코드·사업자번호)"
              onPick={(sel) => {
                const pt = partners.find((x) => x.id === sel.id);
                if (pt) patch(i, { partner: pt, partnerText: pt.name });
                setDrop(null);
              }}
              //   없는 거래처는 여기서 바로 등록 (2026-09-02 사장님) — 검색어가 이름 칸에 미리 들어간다
              onCreate={(q) => { setQuickCreate({ row: i, name: q || r.partnerText, vatCode: r.vatCode }); setDrop(null); }}
              createLabel={(q) => (q ? `"${q}" 새 거래처로 등록` : "새 거래처 등록")}
              onClose={() => setDrop(null)} />
          )}
        </div>
        <span className="spv-in-ro tc">{r.partner?.business_number || ""}</span>
        <select className="spv-in spv-sel" data-cell={`vatCode-${i}`} value={r.vatCode}
          onChange={(e) => { setVat(i, e.target.value); setSelectOpen(null); }}
          onMouseDown={() => setSelectOpen(`vatCode-${i}`)} onBlur={() => setSelectOpen(null)}
          onKeyDown={(e) => onCellKey(e, i, "vatCode")} onFocus={() => { if (!isEdit) setCur(i); }}>
          {/* 수정 줄은 갈래 탭에 안 걸린 유형일 수도 있다 — 그 유형이 목록에서 빠지면 값이 튄다 */}
          {(isEdit ? VAT_TYPES : typeOptions).map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
        </select>
        <input className="spv-in" data-cell={`item-${i}`} value={r.item} onChange={(e) => patch(i, { item: e.target.value })}
          onKeyDown={(e) => onCellKey(e, i, "item")} onFocus={() => { if (!isEdit) setCur(i); }} placeholder="품명" />
        <input className={numOf(r.supply) < 0 ? "spv-in tr spv-minus" : "spv-in tr"} data-cell={`supply-${i}`} value={r.supply}
          onChange={(e) => setSupply(i, e.target.value)} onKeyDown={(e) => onCellKey(e, i, "supply")}
          onFocus={() => { if (!isEdit) setCur(i); }} placeholder="0" title="취소·수정분은 앞에 - 를 붙입니다" />
        <input className={numOf(r.vat) < 0 ? "spv-in tr spv-minus" : "spv-in tr"} data-cell={`vat-${i}`} value={r.vat}
          onChange={(e) => patch(i, { vat: comma(e.target.value) })}
          onKeyDown={(e) => onCellKey(e, i, "vat")} onFocus={() => { if (!isEdit) setCur(i); }} placeholder="0" />
        <span className={numOf(r.supply) + numOf(r.vat) < 0 ? "spv-in-ro tr spv-total spv-minus" : "spv-in-ro tr spv-total"}>
          {won(numOf(r.supply) + numOf(r.vat))}
        </span>
        {fromTaxInvoice ? (
          <span className="tc"><em className="spv-eltag" title="전자세금계산서를 불러와 만든 전표입니다">전자입력</em></span>
        ) : (
          <button type="button" className="spv-chk" data-cell={`electronic-${i}`} onClick={() => patch(i, { electronic: !r.electronic })}
            onKeyDown={(e) => onCellKey(e, i, "electronic")} onFocus={() => { if (!isEdit) setCur(i); }}
            title="전자(세금)계산서 발행·수취분이면 켭니다 — 저장됩니다 (Enter 는 윗값 내리기 · Space 로 켜고 끕니다)">{r.electronic ? "전자입력" : "—"}</button>
        )}
        <select className="spv-in spv-sel" data-cell={`settle-${i}`} value={r.settle}
          onChange={(e) => { patch(i, { settle: e.target.value as SettleType }); setSelectOpen(null); }}
          onMouseDown={() => setSelectOpen(`settle-${i}`)} onBlur={() => setSelectOpen(null)}
          onKeyDown={(e) => onCellKey(e, i, "settle")} onFocus={() => { if (!isEdit) setCur(i); }}>
          {(Object.keys(SETTLE_LABEL) as SettleType[]).map((st) => <option key={st} value={st}>{SETTLE_LABEL[st]}</option>)}
        </select>
        <button type="button" className="spv-del" onClick={() => removeRow(i)}
          title={isEdit ? "수정 취소" : "이 줄 지우기"}>✕</button>
      </div>
    );
  };

  const groupCodes = GROUPS.find((g) => g.key === group)!.codes;
  const typeOptions = groupCodes.length > 0 ? VAT_TYPES.filter((v) => groupCodes.includes(v.code)) : VAT_TYPES;

  //   부가세 신고·세무대리인 전달용 — 지금 보고 있는 달·갈래를 그대로 뽑는다.
  //   엑셀이 한글을 깨뜨리지 않게 BOM 을 앞에 붙인다 (거래처원장 내보내기와 같은 방법).
  const downloadCsv = () => {
    const head = ["일자", "전표번호", "구분", "유형", "거래처코드", "거래처", "사업자등록번호", "품명", "공급가액", "부가세", "합계", "전자"];
    const body = sortedSaved.map((r) => {
      const vt = vatType(r.vatCode);
      const sup = numOf(r.supply), v = numOf(r.vat);
      return [
        `${r.y}-${String(Number(r.m)).padStart(2, "0")}-${String(Number(r.d)).padStart(2, "0")}`,
        r.voucherNo ? String(r.voucherNo) : "",
        vt?.side === "sale" ? "매출" : "매입",
        vt?.label || r.vatCode,
        String(r.partner?.code || ""), r.partner?.name || "",
        String(r.partner?.business_number || ""), r.item,
        String(sup), String(v), String(sup + v), r.electronic ? "전자입력" : "",
      ];
    });
    const sup = sortedSaved.reduce((n, r) => n + numOf(r.supply), 0);
    const vat = sortedSaved.reduce((n, r) => n + numOf(r.vat), 0);
    const rowsOut = [head, ...body, ["", "", "", "합계", "", "", "", "", String(sup), String(vat), String(sup + vat), ""]];
    //   BOM·따옴표 규칙은 공통 함수가 책임진다 (2026-08-12) — 화면마다 다시 쓰지 않는다
    writeCsv(
      `매입매출전표_${fromM === toM ? fromM : fromM + "~" + toM}${group === "all" ? "" : "_" + GROUPS.find((g) => g.key === group)!.label}`,
      rowsOut[0], rowsOut.slice(1),
    );
  };

  //   격자 아래 소계 — 저장분 + 지금 치고 있는 줄
  const sumSupply = savedRows.reduce((s, r) => s + numOf(r.supply), 0) + rows.reduce((s, r) => s + numOf(r.supply), 0);
  const sumVat = savedRows.reduce((s, r) => s + numOf(r.vat), 0) + rows.reduce((s, r) => s + numOf(r.vat), 0);

  //   엑셀 그릇 — 지금 조회 결과(저장분)
  const excelItems: ExcelItem[] = [
    { label: "지금 조회 결과 내려받기", count: sortedSaved.length, hint: "걸린 조건 그대로", disabled: sortedSaved.length === 0, onClick: () => downloadCsv() },
  ];

  return (
    <div className="qk-shell spv-page">
      {/* ── 한 상자 안에: 갈래 탭(파란 밑줄) · 조회 줄 · 걸린 조건 · 결과 요약 · 격자 — 수집·전표와 같은 뼈대 (2026-08-18 사장님) ── */}
      <QueryScreen>
       <QueryHead>
      {/* 갈래 탭 — 공용(collect-tabs) */}
      <div className="collect-tabs no-print">
        {GROUPS.map((g) => (
          <button key={g.key} type="button" onClick={() => setGroup(g.key)}
            className={group === g.key ? "collect-tab collect-tab-on" : "collect-tab"}>{g.label}</button>
        ))}
      </div>

      {/* 조회 줄 — 조회 화면 표준(B형: 저장분 조회만). 입력용 버튼은 오른쪽 무리에 (2026-08-18 Wave 1) */}
      <QueryBar right={<>
        <ExcelMenu items={excelItems} />
        <button type="button" onClick={() => setPhoneGrid((v) => !v)} className="spv-phone-toggle btn-secondary btn-sm">
          {phoneGrid ? "카드로 보기" : "격자로 입력"}
        </button>
        <span className={phoneGrid ? "spv-input-only spv-grid-forced" : "spv-input-only"}>
          <button type="button" onClick={() => { setPulled(0); setPullOpen(true); }} className="btn-secondary btn-sm">증빙에서 불러오기</button>
          <button type="button" onClick={addRow} className="btn-secondary btn-sm">+ 줄 추가</button>
          {edit && (
            <button type="button" onClick={cancelEdit} className="btn-secondary btn-sm">수정 취소</button>
          )}
          <button type="button" onClick={save} disabled={!canSave}
            className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {saving ? "저장 중…" : edit ? `#${edit.voucherNo ?? ""} 수정 저장` : "저장"}
          </button>
        </span>
      </>}>
        {/* 조회기간 — 월 단위. 부가세는 분기로 신고해서 한 달만 보면 신고 단위와 어긋난다 (2026-08-11) */}
        <DateRangeField unit="month" label={null} parts="segments" from={fromM} to={toM}
          onChange={(f, t) => { setFromM(f); setToM(t); }}
          trailing={
            <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen} activeCount={condCount(cLive)} anchorSel=".drf"
              tabs={<SavedTabs list={saved2.list} current={paramsNow} basic={paramsBasic}
                onApply={(sv) => { applySaved(sv.params || {}); setPanelOpen(false); }}
                onBasic={() => { const b = defaultRangeMonth(); setGroup("all"); setFromM(b.from); setToM(b.to); clearAll(); }}
                onRemove={saved2.remove} onSetDefault={saved2.setDefault} />}
              foot={<>
                <button type="button" className="btn-secondary btn-sm" disabled={condCount(cDraft) === 0} onClick={() => setCDraft({ ...EMPTY_COND, rows: cDraft.rows })}>조건 지우기</button>
                <ConditionSave suggest={suggestName}
                  onSave={(name, asDefault) => { saved2.save(name, { group, from: fromM, to: toM, q, cond: cDraft }, asDefault); setCLive(cDraft); setPanelOpen(false); }} />
                <span className="ml-auto text-[11px] text-[var(--text-dim)]">{previewCount.toLocaleString("ko")}건</span>
                <RowsPerPage value={cDraft.rows} onChange={(n) => setCDraft((c) => ({ ...c, rows: n }))} />
                <button type="button" className="btn-primary btn-sm" onClick={() => { setCLive(cDraft); setPanelOpen(false); }}>조회</button>
              </>}>
              <ConditionRow label="조회기간" hint="월 단위">
                <span className="qk-range-txt">{fromM} ~ {toM}</span>
                <DateRangeField unit="month" label={null} parts="calendar" confirm from={fromM} to={toM}
                  onChange={(f, t) => { setFromM(f); setToM(t); }} />
                <span className="qk-quicks">
                  {periodQuicksMonth().map((pq) => (
                    <button key={pq.key} type="button" onClick={() => { setFromM(pq.from); setToM(pq.to); }}
                      className={fromM === pq.from && toM === pq.to ? "qk-quick qk-quick-on" : "qk-quick"}>{pq.label}</button>
                  ))}
                </span>
              </ConditionRow>
              {/*   구분(매출/매입)은 갈래가 '전체'일 때만 뜻이 있다 — 매출세금 탭에서 매입을 고르게 두면 조건이 거짓말한다 (2026-08-18 사장님) */}
              {group === "all" && <ConditionRow label="구분">
                <span className="qk-quicks">
                  {[{ v: "sale", l: "매출" }, { v: "buy", l: "매입" }].map((o) => (
                    <button key={o.v} type="button" onClick={() => setD("side")(toggleIn(cDraft.side, o.v))}
                      className={cDraft.side.includes(o.v) ? "qk-quick qk-quick-on" : "qk-quick"}>{o.l}</button>
                  ))}
                </span>
              </ConditionRow>}
              <ConditionRow label="거래처" hint="여러 곳">
                <TokenField items={ptOpts} value={cDraft.pt} onChange={setD("pt")} placeholder="거래처 이름 일부" />
              </ConditionRow>
              <ConditionRow label="유형" hint="부가세 유형 · 여러 개">
                <TokenField items={vatOpts} value={cDraft.vat} onChange={setD("vat")} placeholder="예: 과세매입" />
              </ConditionRow>
              <ConditionRow label="품명">
                <input className="qk-input w-full" value={cDraft.item} placeholder="예: 임대료" onChange={(e) => setD("item")(e.target.value)} />
              </ConditionRow>
              <ConditionRow label="전자" hint="전자(세금)계산서 발행·수취분">
                <span className="qk-quicks">
                  {[["", "전체"], ["y", "전자입력만"], ["n", "직접 입력만"]].map(([v, l]) => (
                    <button key={v} type="button" onClick={() => setD("elec")(v)} className={cDraft.elec === v ? "qk-quick qk-quick-on" : "qk-quick"}>{l}</button>
                  ))}
                </span>
              </ConditionRow>
              <ConditionRow label="분개" hint="외상 · 현금 · 카드 … 여러 개">
                <span className="qk-quicks">
                  {settleOpts.map((o) => (
                    <button key={o.value} type="button" onClick={() => setD("settle")(toggleIn(cDraft.settle, o.value))}
                      className={cDraft.settle.includes(o.value) ? "qk-quick qk-quick-on" : "qk-quick"}>{o.label}</button>
                  ))}
                </span>
              </ConditionRow>
              <ConditionRow label="합계 금액" hint="한쪽만 적어도 됩니다">
                <AmountRange min={cDraft.min} max={cDraft.max} onMin={setD("min")} onMax={setD("max")} />
              </ConditionRow>
            </ConditionPanel>
          } />
        <QuickSearch value={q} onApply={setQ} placeholder="거래처 · 품명 · 사업자번호 · 금액 — 쉼표로 여러 개, Enter" />
      </QueryBar>

      <AppliedChips chips={chips} onClearAll={clearAll} />

      <ResultStrip>
        <Stat label="저장분" value={`${shownSaved.length.toLocaleString("ko")}건`} />
        <Stat label="공급가액" value={won(shownSaved.reduce((x, r) => x + numOf(r.supply), 0))} />
        <Stat label="부가세" value={won(shownSaved.reduce((x, r) => x + numOf(r.vat), 0))} />
        <span className="spv-toolbar-hint"><b>Enter</b> 를 치면 그 칸에 윗줄 값이 내려오고 다음 칸으로 넘어갑니다 · 저장분을 누르면 그 자리에서 고칩니다</span>
      </ResultStrip>
       </QueryHead>
       <QueryBody>
        <div className="spv-body">

      {/* ── 좁은 화면: 저장분을 카드로 읽는다. 격자 입력은 접어 두고 필요할 때만 편다 ── */}
      <div className={phoneGrid ? "spv-narrow spv-narrow-off" : "spv-narrow"}>
        <div className="spv-narrow-head"><b>{periodLabel} 저장분 {savedRows.length}건</b></div>
        {savedRows.length === 0 ? (
          <div className="spv-je-empty">이 기간에 저장된 매입매출전표가 없습니다.</div>
        ) : savedRows.map((r, i) => (
          <div key={`n${i}`} className="spv-narrow-card glass-card">
            <div className="spv-narrow-top">
              <span className="mono-number">{r.m}/{r.d}</span>
              <em className={vatType(r.vatCode)?.side === "sale" ? "spv-type spv-type-s" : "spv-type spv-type-b"}>
                {vatType(r.vatCode)?.label.split(". ")[1] || r.vatCode}
              </em>
              <b className="spv-ell">{r.partner?.name || "—"}</b>
              <span className="spv-narrow-no">#{r.voucherNo}</span>
            </div>
            <div className="spv-narrow-item">{r.item || "—"}</div>
            <div className="spv-narrow-amt">
              <span>공급가액 <b>{r.supply}</b></span>
              <span>부가세 <b>{r.vat}</b></span>
              <span className="spv-total">합계 {won(numOf(r.supply) + numOf(r.vat))}</span>
            </div>
          </div>
        ))}
        <div className="spv-narrow-sum">
          <span>합계</span>
          <b>공급가액 {won(sumSupply)}</b>
          <b>부가세 {won(sumVat)}</b>
        </div>
      </div>

      {/* ── 위 격자: 전표 목록 + 입력 ── */}
      <div className={phoneGrid ? "spv-grid-wrap glass-card spv-grid-forced" : "spv-grid-wrap glass-card"} ref={gridRef}>
        <div className="spv-scroll">
          <div className="spv-grid" style={{ ["--spv-cols" as string]: gridTemplate }}>
            {/* 제목줄 — 누르면 저장분이 그 칸 기준으로 정렬된다(한 번 더 누르면 거꾸로, 세 번째는 해제).
                입력 줄은 정렬을 안 탄다 — 치던 자리가 움직이면 안 되기 때문이다 (2026-08-11) */}
            {/*   머리단은 표 머리단 표준과 같은 모양(색·가운데·세로선·▼·≡)이고 스크롤해도 붙어 있는다 (2026-08-18 사장님) */}
            <div className="spv-row spv-head">
              <span><button type="button" className="spv-sort" onClick={() => toggleSort("date")}>년{sortMark("date")}</button>{grip("y")}</span>
              <span><button type="button" className="spv-sort" onClick={() => toggleSort("date")}>월</button>{grip("m")}</span>
              <span><button type="button" className="spv-sort" onClick={() => toggleSort("date")}>일</button>{grip("d")}</span>
              <span className="th-hasf"><button type="button" className="spv-sort" onClick={() => toggleSort("code")}>코드{sortMark("code")}</button><ThFilter spec={cfSpec("code")} />{grip("code")}</span>
              <span className="th-hasf"><button type="button" className="spv-sort" onClick={() => toggleSort("partner")}>거래처{sortMark("partner")}</button><ThFilter spec={cfSpec("partner")} />{grip("partner")}</span>
              <span className="th-hasf"><button type="button" className="spv-sort" onClick={() => toggleSort("biz")}>사업자등록번호{sortMark("biz")}</button><ThFilter spec={cfSpec("biz")} />{grip("biz")}</span>
              <span className="th-hasf"><button type="button" className="spv-sort" onClick={() => toggleSort("type")}>유형{sortMark("type")}</button><ThFilter spec={cfSpec("type")} />{grip("type")}</span>
              <span className="th-hasf"><button type="button" className="spv-sort" onClick={() => toggleSort("item")}>품명{sortMark("item")}</button><ThFilter spec={cfSpec("item")} />{grip("item")}</span>
              <span><button type="button" className="spv-sort" onClick={() => toggleSort("supply")}>공급가액{sortMark("supply")}</button>{grip("supply")}</span>
              <span><button type="button" className="spv-sort" onClick={() => toggleSort("tax")}>부가세{sortMark("tax")}</button>{grip("vat")}</span>
              <span><button type="button" className="spv-sort" onClick={() => toggleSort("total")}>합계{sortMark("total")}</button>{grip("total")}</span>
              <span>전자{grip("elec")}</span><span>분개{grip("je")}</span><span />
            </div>

            {/* 저장된 전표 — 누르면 그 자리에서 고친다 (2026-08-11 사장님 지시).
                예전엔 읽기 전용이라 한 번 저장하면 화면에서 고칠 길이 없었다. */}
            {pager.view.map((r) => (
              edit?.savedId === r.savedId ? (
                <Fragment key={`e${r.savedId}`}>{gridRow(edit!, EDIT_IDX)}</Fragment>
              ) : (
                <div key={`s${r.savedId}`} className="spv-row spv-saved" onClick={() => startEdit(r)}
                  title="누르면 이 전표를 고칩니다">
                  <span className="tc">{r.y}</span><span className="tc">{r.m}</span><span className="tc">{r.d}</span>
                  <span className="tc spv-dim">{r.partner?.code || "—"}</span>
                  <span className="spv-ell">{r.partner?.name || "—"}</span>
                  <span className="tc spv-dim">{r.partner?.business_number || "—"}</span>
                  <span className="tc"><em className={vatType(r.vatCode)?.side === "sale" ? "spv-type spv-type-s" : "spv-type spv-type-b"}>{vatType(r.vatCode)?.label.split(". ")[1] || r.vatCode}</em></span>
                  <span className="spv-ell">{r.item}</span>
                  <span className="tr">{r.supply}</span><span className="tr">{r.vat}</span>
                  <span className="tr spv-total">{won(numOf(r.supply) + numOf(r.vat))}</span>
                  {/* 전자세금계산서에서 불러와 친 전표 */}
                  <span className="tc">{r.electronic ? <em className="spv-eltag">전자입력</em> : <span className="spv-dim">—</span>}</span>
                  <span className="tc spv-dim">{SETTLE_LABEL[r.settle].split(". ")[1]}</span>
                  <span className="tc spv-dim">#{r.voucherNo}</span>
                </div>
              )
            ))}

            {/* 입력 줄 */}
            {rows.map((r, i) => gridRow(r, i))}
          </div>
        </div>
        <div className="spv-subtotal">
          <span>{periodLabel} 소계</span>
          <span className="tr">{won(sumSupply)}</span>
          <span className="tr">{won(sumVat)}</span>
          <span className="tr spv-total">{won(sumSupply + sumVat)}</span>
        </div>
      </div>

      {/* ── 아래 격자: 분개 — 위 구분선을 끌어 높이 조절 (2026-08-19 사장님: 분개를 더 넓게 보고 싶을 때 스스로) ── */}
      <SplitHandle onMouseDown={split.onMouseDown} onReset={split.reset} />
      <div ref={split.ref} style={split.height != null ? { maxHeight: split.height, height: split.height } : undefined} className={phoneGrid ? "spv-je glass-card spv-grid-forced" : "spv-je glass-card"}>
        <div className="spv-je-head">
          <b>분개</b>
          {edit && <em className="spv-je-editing">저장된 전표 #{edit.voucherNo ?? ""} 를 고치는 중</em>}
          <span>{t.label} · {SETTLE_LABEL[row?.settle || "credit"]} — 유형이 만든 줄입니다 · 계정을 눌러 바꿉니다</span>
          {isMinus && (
            <span className="spv-minus-note">
              취소·수정분(음수) — 저장할 때 <b>차·대가 뒤집혀 반대 분개</b>로 들어갑니다
            </span>
          )}
        </div>
        <div className="spv-scroll">
          <div className="spv-je-grid">
            <div className="spv-je-row spv-head">
              <span>구분</span><span>코드</span><span>계정과목</span>
              <span className="tr">차변(출금)</span><span className="tr">대변(입금)</span>
              <span>거래처</span><span>적요</span>
            </div>
            {supplyNum === 0 ? (
              <div className="spv-je-empty">위 격자에 금액을 입력하면 분개가 만들어집니다.</div>
            ) : jeLines.map((l) => (
              <div key={l.i} className="spv-je-row">
                <span className={l.side === "debit" ? "tc spv-dc spv-dc-d" : "tc spv-dc spv-dc-c"}>
                  {l.side === "debit" ? "차변" : "대변"}
                </span>
                <span className="tc spv-dim">{l.account?.code || "—"}</span>
                <div className="relative">
                  <button type="button" className={l.account ? "spv-acct" : "spv-acct spv-acct-empty"}
                    onClick={() => setAcctPick(acctPick?.line === l.i ? null : { line: l.i, q: "" })}>
                    {l.account?.name || draft[l.i]?.name || "계정을 고르세요"}
                    {l.locked && <em className="spv-auto">자동</em>}
                  </button>
                  {acctPick?.line === l.i && (
                    <PickList items={accounts} placeholder="계정과목 검색 (이름·코드)"
                      onPick={(a) => {
                        //   ⚠️ 화면에 그려지는 값은 **override 가 우선**이다. 수정 모드에서는 저장된 계정이
                        //     override 로 깔려 있어, mainAccount 만 바꾸면 고른 게 안 보인다(실제로 그랬다).
                        //     그래서 override 를 항상 같이 쓴다.
                        setOverrides((o) => ({ ...o, [`${row.key}:${l.i}`]: a }));
                        //   주계정(매출/비용) 줄이면 줄 값으로도 기억해 다음 전표에 물려준다
                        if (l.i === (t.side === "sale" ? 1 : 0)) patch(selIdx, { mainAccount: a });
                        setAcctPick(null);
                      }}
                      onClose={() => setAcctPick(null)} />
                  )}
                </div>
                <span className="tr spv-amt">{l.side === "debit" ? won(l.amount) : ""}</span>
                <span className="tr spv-amt">{l.side === "credit" ? won(l.amount) : ""}</span>
                <span className="spv-ell spv-dim">{row?.partner?.name || "—"}</span>
                <span className="spv-ell spv-dim">{row?.item || "—"}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="spv-je-foot">
          <span>전표건별 소계</span>
          <span className="tr">{won(debitSum)}</span>
          <span className="tr">{won(creditSum)}</span>
          {/* 입력 전(0/0)엔 불일치 경고를 띄우지 않는다 — 빈 화면이 오류처럼 보였다 (2026-09-01 전수점검) */}
          <span className={debitSum === 0 && creditSum === 0 ? "spv-bal" : balanced ? "spv-bal spv-bal-ok" : "spv-bal"}>{debitSum === 0 && creditSum === 0 ? "—" : balanced ? "✓ 차·대 일치" : "차·대 불일치"}</span>
        </div>
              <p className="spv-note">
          ※ 매입매출전표는 <b>부가세가 붙는 거래</b>(세금계산서·카드·현금영수증)를 칩니다 —
          통장 이체·대체·결산 분개는 <b>일반전표</b>에서 칩니다. 여기 친 유형이 부가세 신고 집계의 기준이 됩니다.
          <br />※ <b>수정세금계산서·환입·카드 취소</b>는 금액 앞에 <b>-</b> 를 붙여 같은 유형으로 칩니다 —
          부가세 집계에서 그만큼 차감됩니다.
        </p>
      </div>

        </div>
       </QueryBody>
       <Pager page={pager.page} pages={pager.pages} total={sortedSaved.length} size={cLive.rows} from={pager.from} to={pager.to} onPage={pager.setPage} />
      </QueryScreen>

      {pullOpen && (
        <div className="spv-pull-overlay" onClick={() => setPullOpen(false)}>
          <div className="spv-pull-box" onClick={(e) => e.stopPropagation()}>
            <div className="spv-pull-head">
              <div>
                <b>증빙에서 불러오기</b>
                <span>전표가 안 만들어진 것만 · {periodLabel}</span>
              </div>
              <div className="flex items-center gap-3">
                {pulled > 0 && <span className="spv-pull-count">{pulled}건 얹음</span>}
                <button type="button" onClick={() => setPullOpen(false)} aria-label="닫기">✕</button>
              </div>
            </div>
            {pending.length === 0 ? (
              <div className="spv-je-empty">이 기간에 전표가 필요한 증빙이 없습니다.</div>
            ) : (
              <div className="spv-pull-scroll">
                <table className="spv-pull-table">
                  <thead>
                    <tr><th>일자</th><th>증빙</th><th>거래처</th><th>품명</th><th className="tr">공급가액</th><th>추천 유형</th><th /></tr>
                  </thead>
                  <tbody>
                    {pending.map((r) => (
                      <tr key={r.key}>
                        <td className="mono-number">{r.date}</td>
                        <td>{EVIDENCE_LABEL[r.kind]}</td>
                        <td className="truncate max-w-[150px]">{r.who}</td>
                        <td className="truncate max-w-[150px]">
                          {(r.supply < 0 || r.cancelled) && <em className="spv-minus-badge">취소·수정</em>}
                          {r.what}
                        </td>
                        <td className={r.supply < 0 ? "tr mono-number spv-minus" : "tr mono-number"}>{won(r.supply)}</td>
                        <td><em className={vatType(r.suggested)?.side === "sale" ? "spv-type spv-type-s" : "spv-type spv-type-b"}>{vatType(r.suggested)?.label}</em></td>
                        <td className="tr"><button type="button" onClick={() => pullOne(r)} className="btn-secondary btn-sm">얹기</button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <div className="spv-pull-foot">
              추천 유형은 규칙으로 붙습니다 — <b>접대·유흥·골프·상품권은 54 불공제</b>, 매입 계산서는 51, 카드는 57.
              얹은 뒤 격자에서 바꿔도 됩니다. <b>취소·수정분(음수)</b>도 그대로 나옵니다 —
              저장할 때 차·대가 뒤집혀 <b>반대 분개</b>로 들어갑니다. 원본 승인 건과 자동으로 짝짓지는 않습니다.
            </div>
          </div>
        </div>
      )}

      {dupPromptElement}
      {quickCreate && companyId && (
        <PartnerQuickCreate
          companyId={companyId}
          initialName={quickCreate.name}
          defaultType={vatType(quickCreate.vatCode)?.side === "purchase" ? "vendor" : "client"}
          existing={partners}
          onPickExisting={(pt) => {
            const found = partners.find((x) => x.id === pt.id);
            if (found) patch(quickCreate.row, { partner: found, partnerText: found.name });
            setQuickCreate(null);
          }}
          onCreated={(pt) => {
            const np: Pt = { id: pt.id, code: pt.code, name: pt.name, business_number: pt.business_number };
            //   목록 캐시에 바로 끼워 넣고(다음 줄에서 곧장 검색되게) 서버 목록도 새로 받는다
            qc.setQueryData<Pt[]>(["sp-partners", companyId], (prev) => [...(prev || []), np].sort((a, b) => a.name.localeCompare(b.name, "ko")));
            qc.invalidateQueries({ queryKey: ["sp-partners", companyId] });
            patch(quickCreate.row, { partner: np, partnerText: np.name });
            toast(`거래처 '${np.name}' 을(를) 등록했습니다${np.code != null ? ` · 코드 ${np.code}` : ""}`, "success");
            setQuickCreate(null);
            //   등록한 줄의 다음 칸(유형)으로 커서를 보낸다 — 흐름이 끊기지 않게
            setTimeout(() => document.querySelector<HTMLElement>(`[data-cell="vatCode-${quickCreate.row}"]`)?.focus(), 50);
          }}
          onClose={() => setQuickCreate(null)} />
      )}
    </div>
  );
}
