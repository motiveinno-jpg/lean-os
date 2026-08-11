"use client";

// 매입매출전표입력 — 회계 프로그램 그대로의 격자 입력 (2026-08-11 사장님 지시, WEHAGO 화면 기준).
//
//   위 격자에 한 줄 = 전표 한 장. 년·월·일·거래처·유형·품명·공급가액·부가세를 옆으로 친다.
//   아래 격자는 그 줄의 **분개** — 유형이 만들고 사람이 계정만 고친다.
//
//   ★ Enter = 윗줄 복사(금액 제외). 같은 거래처로 여러 건을 이어 칠 때
//     년·월·일·거래처·유형·품명·전자·분개까지 그대로 내려오고 금액만 비운다 — 손이 제일 덜 간다.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";
import { useToast } from "@/components/toast";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { friendlyError } from "@/lib/friendly-error";
import {
  VAT_TYPES, SETTLE_LABEL, buildVoucherLines, vatOf, vatType, suggestVatType, normalizeSides,
  type SettleType,
} from "@/lib/vat-voucher";

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
type RefKind = "tax_invoice" | "card_transaction" | "cash_receipt";

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
  key: string; kind: "tax_invoice" | "card" | "cash_receipt";
  date: string; who: string; what: string;
  supply: number; vat: number; partnerId: string | null; suggested: string;
  //   금액이 음수이거나 가맹점명이 '[취소]' 로 시작하는 건 — 그대로 치면 안 되는 줄이라 눈에 띄게 표시한다
  cancelled?: boolean;
};
const EVIDENCE_LABEL: Record<EvidenceRow["kind"], string> = {
  tax_invoice: "세금계산서", card: "카드", cash_receipt: "현금영수증",
};
const EVIDENCE_REF: Record<EvidenceRow["kind"], RefKind> = {
  tax_invoice: "tax_invoice", card: "card_transaction", cash_receipt: "cash_receipt",
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

const blankRow = (base?: Partial<Row>): Row => ({
  key: K++,
  y: base?.y || String(new Date().getFullYear()),
  m: base?.m || "", d: base?.d || "",
  partner: base?.partner ?? null, partnerText: base?.partnerText || "",
  vatCode: base?.vatCode || "11", item: base?.item || "",
  supply: "", vat: "",
  electronic: base?.electronic ?? false,
  settle: base?.settle || "credit",
  mainAccount: base?.mainAccount ?? null,
});

export default function SalePurchaseVoucherPage() {
  const { role } = useUser();
  //   전표는 회사 장부라 관리자만 — 일반전표 화면과 같은 기준
  if (role !== "owner" && role !== "admin") {
    return <AccessDenied detail="매입매출전표는 대표·관리자 전용입니다." />;
  }
  return <SalePurchaseInner />;
}

function SalePurchaseInner() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [group, setGroup] = useState("all");
  const [month, setMonth] = useState(todayKst().slice(0, 7));
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
  const { data: saved = [] } = useQuery({
    queryKey: ["sp-saved", companyId, month],
    queryFn: async () => {
      const [y, mm] = month.split("-").map(Number);
      const to = `${mm === 12 ? y + 1 : y}-${String(mm === 12 ? 1 : mm + 1).padStart(2, "0")}-01`;
      const data = logRead("sale-purchase:saved", await (supabase as any)
        .from("journal_entries")
        .select("id, voucher_no, entry_date, vat_type, supply_amount, vat_amount, description, journal_lines(debit, credit, description, chart_of_accounts(id, code, name, account_type), partners(id, code, name, business_number))")
        .eq("company_id", companyId!).eq("entry_kind", "sale_purchase")
        .gte("entry_date", `${month}-01`).lt("entry_date", to)
        .order("entry_date").order("voucher_no"));
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  const savedRows: Row[] = saved.map((e: any) => {
    const p = (e.journal_lines || []).map((l: any) => l.partners).find(Boolean) || null;
    const [y, m, d] = String(e.entry_date || "").split("-");
    return {
      key: -1, y, m: String(Number(m || 0)), d: String(Number(d || 0)),
      partner: p, partnerText: p?.name || "",
      vatCode: e.vat_type || "11",
      item: e.description || "",
      supply: won(e.supply_amount), vat: won(e.vat_amount),
      electronic: false, settle: "credit" as SettleType, mainAccount: null,
      savedId: e.id, voucherNo: e.voucher_no,
    };
  }).filter((r: Row) => group === "all" || GROUPS.find((g) => g.key === group)!.codes.includes(r.vatCode));

  // ── 아직 전표가 안 만들어진 증빙 — 세 화면에 흩어져 있던 입구를 여기 하나로 모은다 ──
  const { data: pending = [] } = useQuery({
    queryKey: ["sp-pending", companyId, month],
    queryFn: async () => {
      const from = month + "-01";
      const [y, mm] = month.split("-").map(Number);
      const to = (mm === 12 ? y + 1 : y) + "-" + String(mm === 12 ? 1 : mm + 1).padStart(2, "0") + "-01";
      const [ti, card, cash] = await Promise.all([
        supabase.from("tax_invoices")
          .select("id, type, issue_date, counterparty_name, partner_id, item_name, supply_amount, tax_amount, tax_kind, expense_category, journal_entry_id")
          .eq("company_id", companyId!).is("journal_entry_id", null).neq("status", "void")
          .gte("issue_date", from).lt("issue_date", to).order("issue_date").limit(200),
        supabase.from("card_transactions")
          .select("id, transaction_date, merchant_name, amount, category, classification, journal_entry_id")
          .eq("company_id", companyId!).is("journal_entry_id", null)
          .gte("transaction_date", from).lt("transaction_date", to).order("transaction_date").limit(200),
        supabase.from("cash_receipts")
          .select("id, type, issue_date, counterparty_name, supply_amount, tax_amount, amount, journal_entry_id")
          .eq("company_id", companyId!).is("journal_entry_id", null)
          .gte("issue_date", from).lt("issue_date", to).order("issue_date").limit(200),
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
        const dir = r.type === "income" ? "sale" : "purchase";
        const sup = Number(r.supply_amount || 0) || Math.round(Number(r.amount || 0) / 1.1);
        out.push({
          key: "cash:" + r.id, kind: "cash_receipt", date: r.issue_date, who: r.counterparty_name || "—",
          what: "현금영수증", supply: sup, vat: Number(r.tax_amount || 0) || (Number(r.amount || 0) - sup),
          partnerId: null, cancelled: sup < 0,
          suggested: suggestVatType({ kind: "cash_receipt", direction: dir }),
        });
      }
      //   0 원 건만 뺀다. 음수(수정세금계산서·환입·카드 취소)는 그대로 둔다 — 격자가 부호를 받는다.
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

  // ── 지금 줄의 분개 ──
  const row = rows[cur] || rows[0];
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

  const patch = (i: number, p: Partial<Row>) => setRows((rs) => rs.map((r, k) => (k === i ? { ...r, ...p } : r)));

  //   유형을 바꾸면 세액을 다시 계산하고 결제 방법을 그 유형의 기본으로 맞춘다
  const setVat = (i: number, code: string) => {
    const nt = vatType(code);
    if (!nt) return;
    setRows((rs) => rs.map((r, k) => {
      if (k !== i) return r;
      const keepAcct = r.mainAccount && r.mainAccount.account_type === (nt.side === "sale" ? "revenue" : "expense");
      return { ...r, vatCode: code, settle: nt.defaultSettle, vat: won(vatOf(code, numOf(r.supply))), mainAccount: keepAcct ? r.mainAccount : null };
    }));
  };
  const setSupply = (i: number, v: string) =>
    setRows((rs) => rs.map((r, k) => (k === i ? { ...r, supply: comma(v), vat: won(vatOf(r.vatCode, numOf(v))) } : r)));

  /** ★ 빈 줄에서 Enter — 윗줄을 금액만 빼고 그대로 내린다 */
  const copyFromAbove = (i: number) => {
    const above = i > 0 ? rows[i - 1] : (savedRows.length > 0 ? savedRows[savedRows.length - 1] : null);
    if (!above) return false;
    patch(i, {
      y: above.y, m: above.m, d: above.d,
      partner: above.partner, partnerText: above.partner?.name || above.partnerText,
      vatCode: above.vatCode, item: above.item,
      electronic: above.electronic, settle: above.settle,
      mainAccount: above.mainAccount,
      supply: "", vat: "",                 // 금액만 비운다
      refType: undefined, refId: undefined, // 증빙 꼬리표는 따라 내려오지 않는다 — 다른 건이다
    });
    return true;
  };
  const isEmptyRow = (r: Row) => !r.m && !r.d && !r.partner && !r.item && !r.supply;

  const focusSupply = (i: number) => requestAnimationFrame(() => {
    const el = gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="supply-${i}"]`);
    el?.focus(); el?.select();
  });

  //   Enter 두 갈래 — 둘 다 결과는 같다: **윗줄이 금액만 빼고 내려온다**
  //     ① 다 친 줄에서 Enter → 새 줄을 만들며 복사 (이어서 다음 건을 친다)
  //     ② 빈 줄에서 Enter    → 그 줄에 복사
  const onCellKey = (e: React.KeyboardEvent, i: number) => {
    if (e.key !== "Enter") return;
    if (isEmptyRow(rows[i])) {
      if (copyFromAbove(i)) { e.preventDefault(); focusSupply(i); }
      return;
    }
    if (i === rows.length - 1) {
      e.preventDefault();
      setRows((rs) => [...rs, blankRow(rs[i])]);   // blankRow 가 금액을 비운다
      setCur(i + 1);
      focusSupply(i + 1);
    }
  };

  const addRow = () => setRows((rs) => [...rs, blankRow(rs[rs.length - 1])]);
  const removeRow = (i: number) =>
    setRows((rs) => (rs.length > 1 ? rs.filter((_, k) => k !== i) : [blankRow()]));

  const save = async () => {
    if (!canSave) return;
    setSaving(true);
    try {
      const date = `${row.y}-${String(Number(row.m)).padStart(2, "0")}-${String(Number(row.d)).padStart(2, "0")}`;
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
      const { error } = await (supabase.rpc as any)("save_sale_purchase_voucher", {
        p_entry_date: date, p_vat_type: row.vatCode,
        p_supply_amount: supplyNum, p_vat_amount: vatNum,
        p_description: row.item || `${t.label} ${row.partner?.name || ""}`.trim(),
        p_lines: payload,
        //   불러온 증빙이면 꼬리표를 같이 보낸다 — 증빙에 전표가 되붙어 다시 불러올 수 없게 된다
        p_reference_type: row.refType || null,
        p_reference_id: row.refId || null,
      });
      if (error) throw error;
      toast(`전표를 저장했습니다 (${t.label} · ${won(supplyNum + vatNum)}원)`, "success");
      qc.invalidateQueries({ queryKey: ["sp-saved"] });
      qc.invalidateQueries({ queryKey: ["sp-pending"] });
      //   저장한 줄은 지우고 그 내용을 물려받은 빈 줄을 남긴다 — 다음 건을 바로 이어 친다
      setRows((rs) => {
        const next = rs.filter((_, k) => k !== cur);
        return (next.length > 0 ? next : [blankRow(row)]);
      });
      setCur(0);
      setOverrides({});
    } catch (e: any) {
      const m = String(e?.message || "");
      toast(
        m.includes("PERIOD_LOCKED") ? "마감된 달이라 전표를 저장할 수 없습니다."
        : m.includes("FORBIDDEN") ? "전표를 저장할 권한이 없습니다."
        : m.includes("ALREADY_POSTED") ? "이 증빙은 이미 전표로 만들어져 있습니다."
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

  const groupCodes = GROUPS.find((g) => g.key === group)!.codes;
  const typeOptions = groupCodes.length > 0 ? VAT_TYPES.filter((v) => groupCodes.includes(v.code)) : VAT_TYPES;

  //   부가세 신고·세무대리인 전달용 — 지금 보고 있는 달·갈래를 그대로 뽑는다.
  //   엑셀이 한글을 깨뜨리지 않게 BOM 을 앞에 붙인다 (거래처원장 내보내기와 같은 방법).
  const downloadCsv = () => {
    const head = ["일자", "전표번호", "구분", "유형", "거래처코드", "거래처", "사업자등록번호", "품명", "공급가액", "부가세", "합계"];
    const body = savedRows.map((r) => {
      const vt = vatType(r.vatCode);
      const sup = numOf(r.supply), v = numOf(r.vat);
      return [
        `${r.y}-${String(Number(r.m)).padStart(2, "0")}-${String(Number(r.d)).padStart(2, "0")}`,
        r.voucherNo ? String(r.voucherNo) : "",
        vt?.side === "sale" ? "매출" : "매입",
        vt?.label || r.vatCode,
        String(r.partner?.code || ""), r.partner?.name || "",
        String(r.partner?.business_number || ""), r.item,
        String(sup), String(v), String(sup + v),
      ];
    });
    const sup = savedRows.reduce((n, r) => n + numOf(r.supply), 0);
    const vat = savedRows.reduce((n, r) => n + numOf(r.vat), 0);
    const rowsOut = [head, ...body, ["", "", "", "합계", "", "", "", "", String(sup), String(vat), String(sup + vat)]];
    const csv = "﻿" + rowsOut.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(",")).join("\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    a.download = `매입매출전표_${month}${group === "all" ? "" : "_" + GROUPS.find((g) => g.key === group)!.label}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  //   격자 아래 소계 — 저장분 + 지금 치고 있는 줄
  const sumSupply = savedRows.reduce((s, r) => s + numOf(r.supply), 0) + rows.reduce((s, r) => s + numOf(r.supply), 0);
  const sumVat = savedRows.reduce((s, r) => s + numOf(r.vat), 0) + rows.reduce((s, r) => s + numOf(r.vat), 0);

  return (
    <div className="spv-page">
      {/* 갈래 탭 */}
      <div className="spv-tabs">
        {GROUPS.map((g) => (
          <button key={g.key} type="button" onClick={() => setGroup(g.key)}
            className={group === g.key ? "spv-tab spv-tab-on" : "spv-tab"}>{g.label}</button>
        ))}
      </div>

      {/* 기간 + 액션 */}
      <div className="spv-toolbar">
        <label className="spv-toolbar-label">조회월</label>
        <input type="month" value={month} onChange={(e) => setMonth(e.target.value)} className="spv-month" />
        <span className="spv-toolbar-hint"><b>Enter</b> 를 치면 윗줄이 금액만 빼고 그대로 내려옵니다</span>
        <div className="ml-auto flex items-center gap-2">
          <button type="button" onClick={() => setPhoneGrid((v) => !v)} className="spv-phone-toggle btn-secondary btn-sm">
            {phoneGrid ? "카드로 보기" : "격자로 입력"}
          </button>
          <button type="button" onClick={downloadCsv} disabled={savedRows.length === 0}
            className="btn-secondary btn-sm disabled:opacity-40 disabled:cursor-not-allowed">엑셀</button>
          {/* 아래 셋은 입력용 — 좁은 화면에서 격자를 접어 두면 같이 숨는다 */}
          <span className={phoneGrid ? "spv-input-only spv-grid-forced" : "spv-input-only"}>
            <button type="button" onClick={() => { setPulled(0); setPullOpen(true); }} className="btn-secondary btn-sm">증빙에서 불러오기</button>
            <button type="button" onClick={addRow} className="btn-secondary btn-sm">+ 줄 추가</button>
            <button type="button" onClick={save} disabled={!canSave}
              className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed">
              {saving ? "저장 중…" : "저장"}
            </button>
          </span>
        </div>
      </div>

      {/* ── 좁은 화면: 저장분을 카드로 읽는다. 격자 입력은 접어 두고 필요할 때만 편다 ── */}
      <div className={phoneGrid ? "spv-narrow spv-narrow-off" : "spv-narrow"}>
        <div className="spv-narrow-head"><b>{month} 저장분 {savedRows.length}건</b></div>
        {savedRows.length === 0 ? (
          <div className="spv-je-empty">이 달에 저장된 매입매출전표가 없습니다.</div>
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
          <div className="spv-grid">
            <div className="spv-row spv-head">
              <span>년</span><span>월</span><span>일</span><span>코드</span><span>거래처</span>
              <span>사업자등록번호</span><span>유형</span><span>품명</span>
              <span className="tr">공급가액</span><span className="tr">부가세</span><span className="tr">합계</span>
              <span>전자</span><span>분개</span><span />
            </div>

            {/* 저장된 전표 — 읽기 전용 */}
            {savedRows.map((r, i) => (
              <div key={`s${i}`} className="spv-row spv-saved">
                <span className="tc">{r.y}</span><span className="tc">{r.m}</span><span className="tc">{r.d}</span>
                <span className="tc spv-dim">{r.partner?.code || "—"}</span>
                <span className="spv-ell">{r.partner?.name || "—"}</span>
                <span className="tc spv-dim">{r.partner?.business_number || "—"}</span>
                <span className="tc"><em className={vatType(r.vatCode)?.side === "sale" ? "spv-type spv-type-s" : "spv-type spv-type-b"}>{vatType(r.vatCode)?.label.split(". ")[1] || r.vatCode}</em></span>
                <span className="spv-ell">{r.item}</span>
                <span className="tr">{r.supply}</span><span className="tr">{r.vat}</span>
                <span className="tr spv-total">{won(numOf(r.supply) + numOf(r.vat))}</span>
                <span className="tc spv-dim">—</span>
                <span className="tc spv-dim">{SETTLE_LABEL[r.settle].split(". ")[1]}</span>
                <span className="tc spv-dim">#{r.voucherNo}</span>
              </div>
            ))}

            {/* 입력 줄 */}
            {rows.map((r, i) => {
              const rt = vatType(r.vatCode)!;
              return (
                <div key={r.key} className={i === cur ? "spv-row spv-cur" : "spv-row"} onClick={() => setCur(i)}>
                  <input className="spv-in tc" value={r.y} onChange={(e) => patch(i, { y: e.target.value })}
                    onKeyDown={(e) => onCellKey(e, i)} onFocus={() => setCur(i)} inputMode="numeric" maxLength={4} />
                  <input className="spv-in tc" value={r.m} onChange={(e) => patch(i, { m: e.target.value.replace(/\D/g, "").slice(0, 2) })}
                    onKeyDown={(e) => onCellKey(e, i)} onFocus={() => setCur(i)} inputMode="numeric" placeholder="월" />
                  <input className="spv-in tc" value={r.d} onChange={(e) => patch(i, { d: e.target.value.replace(/\D/g, "").slice(0, 2) })}
                    onKeyDown={(e) => onCellKey(e, i)} onFocus={() => setCur(i)} inputMode="numeric" placeholder="일" />
                  <span className="spv-in-ro tc">{r.partner?.code || ""}</span>
                  <div className="relative">
                    <input className="spv-in" value={r.partner?.name || r.partnerText}
                      onChange={(e) => { patch(i, { partner: null, partnerText: e.target.value }); setDrop({ row: i, q: e.target.value }); }}
                      onFocus={() => { setCur(i); setDrop({ row: i, q: r.partnerText }); }}
                      onBlur={() => setTimeout(() => setDrop((d) => (d?.row === i ? null : d)), 200)}
                      onKeyDown={(e) => onCellKey(e, i)} placeholder="거래처" />
                    {drop?.row === i && filteredPartners(drop.q).length > 0 && (
                      <div className="spv-drop">
                        {filteredPartners(drop.q).map((p) => (
                          <button key={p.id} type="button" onMouseDown={(e) => e.preventDefault()}
                            onClick={() => { patch(i, { partner: p, partnerText: p.name }); setDrop(null); }}>
                            <span className="spv-drop-code">{p.code || "—"}</span>
                            <span className="spv-drop-name">{p.name}</span>
                            <span className="spv-drop-biz">{p.business_number || ""}</span>
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                  <span className="spv-in-ro tc">{r.partner?.business_number || ""}</span>
                  <select className="spv-in spv-sel" value={r.vatCode} onChange={(e) => setVat(i, e.target.value)} onFocus={() => setCur(i)}>
                    {typeOptions.map((v) => <option key={v.code} value={v.code}>{v.label}</option>)}
                  </select>
                  <input className="spv-in" value={r.item} onChange={(e) => patch(i, { item: e.target.value })}
                    onKeyDown={(e) => onCellKey(e, i)} onFocus={() => setCur(i)} placeholder="품명" />
                  <input className={numOf(r.supply) < 0 ? "spv-in tr spv-minus" : "spv-in tr"} data-cell={`supply-${i}`} value={r.supply}
                    onChange={(e) => setSupply(i, e.target.value)} onKeyDown={(e) => onCellKey(e, i)}
                    onFocus={() => setCur(i)} placeholder="0" title="취소·수정분은 앞에 - 를 붙입니다" />
                  <input className={numOf(r.vat) < 0 ? "spv-in tr spv-minus" : "spv-in tr"} value={r.vat}
                    onChange={(e) => patch(i, { vat: comma(e.target.value) })}
                    onKeyDown={(e) => onCellKey(e, i)} onFocus={() => setCur(i)} placeholder="0" />
                  <span className={numOf(r.supply) + numOf(r.vat) < 0 ? "spv-in-ro tr spv-total spv-minus" : "spv-in-ro tr spv-total"}>
                    {won(numOf(r.supply) + numOf(r.vat))}
                  </span>
                  <button type="button" className="spv-chk" onClick={() => patch(i, { electronic: !r.electronic })}
                    title="전자 발행분이면 켭니다">{r.electronic ? "전자" : "—"}</button>
                  <select className="spv-in spv-sel" value={r.settle} onChange={(e) => patch(i, { settle: e.target.value as SettleType })} onFocus={() => setCur(i)}>
                    {(Object.keys(SETTLE_LABEL) as SettleType[]).map((s) => <option key={s} value={s}>{SETTLE_LABEL[s]}</option>)}
                  </select>
                  <button type="button" className="spv-del" onClick={() => removeRow(i)} title="이 줄 지우기">✕</button>
                </div>
              );
            })}
          </div>
        </div>
        <div className="spv-subtotal">
          <span>{month} 소계</span>
          <span className="tr">{won(sumSupply)}</span>
          <span className="tr">{won(sumVat)}</span>
          <span className="tr spv-total">{won(sumSupply + sumVat)}</span>
        </div>
      </div>

      {/* ── 아래 격자: 분개 ── */}
      <div className={phoneGrid ? "spv-je glass-card spv-grid-forced" : "spv-je glass-card"}>
        <div className="spv-je-head">
          <b>분개</b>
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
                    <div className="spv-drop spv-drop-acct">
                      <input autoFocus value={acctPick.q} onChange={(e) => setAcctPick({ line: l.i, q: e.target.value })}
                        placeholder="계정과목 검색 (이름·코드)" className="spv-drop-search" />
                      <div className="spv-drop-list">
                        {filterAccts(acctPick.q).map((a) => (
                          <button key={a.id} type="button"
                            onClick={() => {
                              //   첫 줄(매출/비용 계정)을 고르면 그 줄 값으로도 기억해 다음 전표에 물려준다
                              if (l.i === (t.side === "sale" ? 1 : 0)) patch(cur, { mainAccount: a });
                              else setOverrides((o) => ({ ...o, [`${row.key}:${l.i}`]: a }));
                              setAcctPick(null);
                            }}>
                            <span className="spv-drop-code">{a.code}</span>
                            <span className="spv-drop-name">{a.name}</span>
                          </button>
                        ))}
                      </div>
                    </div>
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
          <span className={balanced ? "spv-bal spv-bal-ok" : "spv-bal"}>{balanced ? "✓ 차·대 일치" : "차·대 불일치"}</span>
        </div>
      </div>

      {pullOpen && (
        <div className="spv-pull-overlay" onClick={() => setPullOpen(false)}>
          <div className="spv-pull-box" onClick={(e) => e.stopPropagation()}>
            <div className="spv-pull-head">
              <div>
                <b>증빙에서 불러오기</b>
                <span>전표가 안 만들어진 것만 · {month}</span>
              </div>
              <div className="flex items-center gap-3">
                {pulled > 0 && <span className="spv-pull-count">{pulled}건 얹음</span>}
                <button type="button" onClick={() => setPullOpen(false)} aria-label="닫기">✕</button>
              </div>
            </div>
            {pending.length === 0 ? (
              <div className="spv-je-empty">이 달에 전표가 필요한 증빙이 없습니다.</div>
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

      <p className="spv-note">
        ※ 매입매출전표는 <b>부가세가 붙는 거래</b>(세금계산서·카드·현금영수증)를 칩니다 —
        통장 이체·대체·결산 분개는 <b>일반전표</b>에서 칩니다. 여기 친 유형이 부가세 신고 집계의 기준이 됩니다.
        <br />※ <b>수정세금계산서·환입·카드 취소</b>는 금액 앞에 <b>-</b> 를 붙여 같은 유형으로 칩니다 —
        부가세 집계에서 그만큼 차감됩니다.
      </p>
    </div>
  );
}
