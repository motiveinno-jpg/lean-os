"use client";

// 수집·전표 3단계 — 통장 줄을 **일반전표 한 장**으로 (2026-08-12 사장님 지시로 다시 짬)
//
//   지시: "처리는 필요없고 전체 일반전표로 전송되게 / 건별로 차·대변 계정과목 설정가능하도록 /
//         차·대변 거래처 다르게 설정(보통예금부분은 자동) / 적요칸 만들어서 직접 입력"
//
//   그래서 한 줄이 곧 한 전표다. 보통예금 쪽은 **서버가 붙인다**(post_bank_manual_voucher):
//     입금 → 차) 보통예금[통장]      / 대) 고른 계정[고른 거래처]
//     출금 → 차) 고른 계정[고른 거래처] / 대) 보통예금[통장]
//   사람이 채우는 건 **상대 계정 · 상대 거래처 · 적요** 셋뿐이다.
//
//   ★ 2026-08-11 에 있던 '처리' 칸(①증빙 수금 매칭 ②일반전표 ③계좌 이동 ④카드대금 묶기)과
//     그 짝인 '붙는 곳' 칸은 **없앴다**(사장님: "처리는 필요없고", "붙는곳은 필요없는 기능").
//     ①③④ 가 하던 일은 **거래 매칭 화면(/partners/reconciliation)에 그대로 있다** — 지운 게 아니라
//     이 화면에서 뺀 것이다. 세금계산서 수금은 여기서 계정을 '외상매출금'으로 골라도 같은 결과다.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { PickList } from "@/components/pick-list";
import {
  QueryBar, QueryField, ChipGroup, RowsPerPage, ResultStrip, Stat, HelperMenu, SelectionBar,
  Pager, usePager, ConditionPanel, ConditionRow, TokenField, AmountRange, AppliedChips,
  QuickSearch, quickSearchHit, quickTerms, amountHit, periodQuicks,
  useSavedQueries, SavedTabs, type HelperItem, type AppliedChip,
} from "@/components/query-kit";
import { DateRangeField } from "@/components/date-range-field";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { fetchRuleMap, ruleKeyOf, learnAccount, ruleTag } from "@/lib/voucher-rules";

type Acct = { id: string; code: string; name: string; account_type: string };

/** 표 머리단 정렬 열쇠 — 칸 하나에 하나씩 (2026-08-12) */
type SortKey = "date" | "io" | "who" | "desc" | "amount" | "state";
type Pt = { id: string; name: string };

type Row = {
  id: string;
  date: string;
  amount: number;
  isIn: boolean;
  who: string;
  desc: string;
  partnerId: string | null;
  bankId: string | null;   // 어느 계좌의 거래인가 (조건 더보기의 '계좌')
  posted: boolean;         // 전표가 있다
  settled: boolean;        // 매칭이 확정됐다
  settledAmount: number;
  transfer: boolean;       // 계좌 이동으로 표시됨
  voucherNo: number | null;
  entryId: string | null;          // 되돌릴 때 지울 전표
  settleIds: { id: string; type: string }[];  // 되돌릴 때 되돌릴 정산 행
  cardsLinked: number;             // 이 줄에 묶인 카드 승인 수 (되돌리기에서만 쓴다)
};

//   classify-transactions 가 돌려주는 코드 → 사람이 읽는 이름 (자동 분류 화면과 같은 표).
//   이 이름과 **같은 이름의 계정과목**을 찾아 계정 칸에 미리 채운다.
const AI_CATEGORY_LABEL: Record<string, string> = {
  revenue: "매출", other_revenue: "기타수익", outsourcing: "외주비", infrastructure: "인프라/서버",
  salary: "급여/인건비", rent: "임대료/관리비", software: "소프트웨어/SaaS", professional: "전문서비스",
  welfare: "복리후생", insurance: "4대보험", marketing: "마케팅/광고", supplies: "소모품/사무용품",
  travel: "출장/교통비", communication: "통신비", tax: "세금/공과금", depreciation: "감가상각비",
  interest: "이자비용", other_expense: "기타 운영비",
};
//   AI 코드 → 계정과목을 찾을 때 쓸 낱말. 계정과목표 이름이 회사마다 조금씩 달라 넉넉히 잡는다.
const AI_ACCOUNT_HINT: Record<string, string[]> = {
  outsourcing: ["외주"], infrastructure: ["지급수수료", "통신"], salary: ["급여"], rent: ["임차", "임대"],
  software: ["지급수수료", "소모품"], professional: ["지급수수료"], welfare: ["복리후생"],
  insurance: ["보험"], marketing: ["광고", "판매촉진"], supplies: ["소모품", "사무용품"],
  travel: ["여비", "교통"], communication: ["통신"], tax: ["세금과공과", "공과"],
  depreciation: ["감가상각"], interest: ["이자"], other_expense: ["잡비", "기타"],
  revenue: ["매출"], other_revenue: ["잡이익", "기타"],
};

const won = (n: number) => Math.round(Number(n) || 0).toLocaleString("ko-KR");
/** 통장 줄의 방향 — type 이 단일 기준, 비어 있을 때만 부호를 본다 (RPC post_bank_voucher 와 같은 규칙) */
function bankIsIn(type: string, amount: number): boolean {
  if (["income", "deposit", "입금", "in"].includes(type)) return true;
  if (["expense", "withdrawal", "출금", "out"].includes(type)) return false;
  return amount > 0;
}

const STATE_CHIPS = [
  { value: "todo", label: "미처리" }, { value: "all", label: "전체" },
] as const;
const IO_CHIPS = [
  { value: "all", label: "전체" }, { value: "in", label: "입금" }, { value: "out", label: "출금" },
] as const;

/**
 * 검색조건 — 갖춰서 찾는 값들 (2026-08-13 조회 화면 표준).
 *   통장에서 제일 자주 찾는 건 "이 계좌에서 30만 원쯤 나간 게 뭐였지" 다 — 계좌·금액이 핵심.
 *   ★ 여기 있는 것은 **'조회'를 눌러야** 반영된다. 기간·빠른검색·상태는 조회 줄에 있어 즉시다.
 */
type Cond = {
  who: string[];    // 거래처(입금자)
  bank: string[];   // 계좌
  acct: string[];   // 붙은 계정과목 코드
  io: "all" | "in" | "out";
  desc: string;     // 통장 적요
  min: string; max: string;
  size: number;     // 한 쪽에 몇 줄 — 조건의 하나라 '내 조건'에 같이 저장된다
};
const EMPTY: Cond = { who: [], bank: [], acct: [], io: "all", desc: "", min: "", max: "", size: 50 };
/** 배지에 셀 것 — 줄 수는 '좁히는 조건'이 아니라 보기 방식이라 안 센다 */
const condCount = (c: Cond) =>
  c.who.length + c.bank.length + c.acct.length
  + (c.io !== "all" ? 1 : 0) + (c.desc ? 1 : 0) + ((c.min || c.max) ? 1 : 0);

export function BankTab({
  companyId, from, to, onRange, syncButton, rulesHelper,
}: {
  companyId: string; from: string; to: string;
  /** 조회 줄 공통 조각 — 화면(page.tsx)이 만들어 내려보낸다.
   *  기간 칸은 검색조건과 한 덩어리라 **탭이 직접 그린다** — 값과 바꾸는 함수만 받는다. */
  onRange: (from: string, to: string) => void;
  syncButton: ReactNode; rulesHelper: HelperItem;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  //   조회 줄에 있는 것은 **즉시** 반영된다 (기간은 page.tsx 가 쥐고 있다)
  const [onlyTodo, setOnlyTodo] = useState(true);
  const [q, setQ] = useState("");
  //   검색조건 패널 — draft 는 고르는 중, live 는 '조회'를 눌러 확정된 것
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Cond>(EMPTY);
  const [live, setLive] = useState<Cond>(EMPTY);
  const setD = <K extends keyof Cond>(k: K) => (v: Cond[K]) => setDraft((c) => ({ ...c, [k]: v }));
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [acct, setAcct] = useState<Record<string, Acct>>({});
  const [pick, setPick] = useState<{ id: string; q: string } | null>(null);
  //   상대 거래처 — 보통예금 쪽은 서버가 붙이므로 여기서 고르는 건 **반대편 하나**뿐이다
  const [pt, setPt] = useState<Record<string, Pt>>({});
  const [ptPick, setPtPick] = useState<{ id: string; q: string } | null>(null);
  //   적요 — 회사 내부 확인용으로 사람이 직접 쓴다. 비우면 서버가 통장 적요를 넣는다.
  const [memo, setMemo] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  //   머리단 정렬 — 기본은 일자 오름차순(통장은 날짜 순으로 본다)
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "date", dir: "asc" });
  const onSort = (k: SortKey) => setSort((c) => nextSort(c, k));
  //   비목 AI 가 추천한 계정 — 사람이 고른 것 다음, 학습 규칙보다 뒤에 쓴다
  const [aiAcct, setAiAcct] = useState<Record<string, Acct>>({});
  const [aiAcctBusy, setAiAcctBusy] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ["collect-accounts", companyId],
    queryFn: async () => {
      const data = logRead("bank:accounts", await supabase
        .from("chart_of_accounts").select("id, code, name, account_type")
        .eq("company_id", companyId).order("code"));
      return (data || []) as Acct[];
    },
    staleTime: 300_000,
  });

  //   학습된 규칙 — 입금자명/적요를 열쇠로 계정을 미리 채운다.
  //   통장은 미처리가 제일 많은 곳이라(2,541건) 학습이 가장 크게 먹힌다.
  const { data: rules } = useQuery({
    queryKey: ["voucher-rules", companyId, "bank"],
    queryFn: () => fetchRuleMap(companyId, "bank"),
    staleTime: 60_000,
  });

  //   거래처 — 상대 계정 줄에 걸 거래처를 고른다 (보통예금 줄은 서버가 통장 거래처를 붙인다)
  const { data: partners = [] } = useQuery<Pt[]>({
    queryKey: ["bank-partners", companyId],
    queryFn: async () => {
      const data = logRead("bank:partners", await supabase
        .from("partners").select("id, name").eq("company_id", companyId).order("name").limit(2000));
      return (data || []) as Pt[];
    },
    staleTime: 300_000,
  });

  //   계좌 목록 — '조건 더보기'의 계좌 고르기용. 별명이 있으면 별명이 먼저다(사람이 부르는 이름).
  const { data: bankAccounts = [] } = useQuery<{ id: string; label: string }[]>({
    queryKey: ["bank-accounts-pick", companyId],
    queryFn: async () => {
      const data = logRead("bank:accounts-pick", await supabase
        .from("bank_accounts").select("id, alias, bank_name, account_number")
        .eq("company_id", companyId).order("bank_name"));
      return ((data as any[]) || []).map((a) => ({
        id: a.id,
        label: [a.alias || a.bank_name, a.account_number ? String(a.account_number).slice(-4) : ""]
          .filter(Boolean).join(" ···"),
      }));
    },
    staleTime: 300_000,
  });

  const { data: rows = [], isLoading, error: rowsError } = useQuery<Row[]>({
    queryKey: ["bank-rows", companyId, from, to],
    queryFn: async () => {
      const tx = await (async () => supabase.from("bank_transactions"))().then((q) => q
          .select("id, transaction_date, amount, type, counterparty, description, partner_id, bank_account_id, journal_entry_id, settlement_status, settled_amount, is_auto_transfer, invoice_settlements(id, status, match_type), card_transactions!card_transactions_bank_transaction_id_fkey(id)")
          .eq("company_id", companyId)
          .gte("transaction_date", from).lte("transaction_date", to)
          .order("transaction_date").limit(400));
      //   ★ 읽기 실패를 빈 목록으로 넘기지 않는다 — '처리할 거래가 없습니다'로 보여 다 끝낸 줄 안다.
      //     (실제로 관계 모호(PGRST201)로 조용히 0건이 뜬 적이 있다)
      if (tx.error) throw new Error(tx.error.message);
      const src = ((tx.data as any[]) || []);
      const entryIds = [...new Set(src.map((r) => r.journal_entry_id).filter(Boolean))] as string[];
      const noBy = new Map<string, number | null>();
      if (entryIds.length > 0) {
        const je = logRead("bank:voucherno", await supabase
          .from("journal_entries").select("id, voucher_no").in("id", entryIds));
        for (const e of ((je as any[]) || [])) noBy.set(e.id, e.voucher_no);
      }
      return src.map((r) => {
        const amount = Number(r.amount || 0);
        return {
          id: r.id, date: String(r.transaction_date), amount,
          //   ★ 이 저장소의 bank_transactions 는 **금액이 항상 양수**이고 방향은 type 이 정한다
          //     (운영 6,906건 전수 확인: expense 4,527 / income 2,379, 음수 없음).
          //     부호로 판정하면 전부 입금이 되어 차·대가 통째로 뒤집힌다. type 을 먼저 본다.
          isIn: bankIsIn(String(r.type || ""), amount),
          who: r.counterparty || "—", desc: r.description || "",
          partnerId: r.partner_id || null,
          bankId: r.bank_account_id || null,
          posted: !!r.journal_entry_id,
          settled: ["settled", "partial"].includes(String(r.settlement_status || "")),
          settledAmount: Number(r.settled_amount || 0),
          transfer: !!r.is_auto_transfer,
          voucherNo: r.journal_entry_id ? (noBy.get(r.journal_entry_id) ?? null) : null,
          entryId: r.journal_entry_id ?? null,
          settleIds: ((r.invoice_settlements || []) as any[])
            .filter((m) => m.status === "confirmed")
            .map((m) => ({ id: m.id, type: String(m.match_type || "") })),
          cardsLinked: ((r.card_transactions || []) as any[]).length,
        } as Row;
      });
    },
  });

  const keyOf = (r: Row) => ruleKeyOf("bank", { name: r.who, fallback: r.desc });
  /** 이 줄에 붙일 계정 — 사람이 고른 것 > 학습된 규칙 */
  const acctOf = (r: Row): { a: Acct | null; via: "고름" | "지난번" | "학습" | "AI" | null } => {
    if (acct[r.id]) return { a: acct[r.id], via: "고름" };
    const hit = rules?.get(keyOf(r).key);
    if (hit?.account) return { a: hit.account as Acct, via: ruleTag(hit.hit_count) };
    //   학습이 없을 때만 AI 추천을 쓴다 — 사람이 쌓은 규칙이 늘 이긴다
    if (aiAcct[r.id]) return { a: aiAcct[r.id], via: "AI" };
    return { a: null, via: null };
  };

  /** 이 줄에 걸 상대 거래처 — 사람이 고른 것 > 통장 줄에 이미 이어진 거래처 */
  const ptOf = (r: Row): Pt | null =>
    pt[r.id] ?? (r.partnerId ? (partners.find((x) => x.id === r.partnerId) ?? null) : null);
  /** 적요 — 사람이 쓴 것 > 통장 적요 > 입금자 (서버도 같은 순서로 채운다) */
  const memoOf = (r: Row) => memo[r.id] ?? "";
  const memoPlaceholder = (r: Row) => r.desc || r.who || "적요";

  const doneOf = (r: Row) => r.posted || r.settled || r.transfer;

  const bankLabelOf = (r: Row) => bankAccounts.find((b) => b.id === r.bankId)?.label ?? "";
  const shownUnsorted = rows.filter((r) => {
    if (onlyTodo && doneOf(r)) return false;
    const a = acctOf(r).a;
    //   빠른검색 — 글자 하나로 거래처·적요·계좌·계정·금액을 한꺼번에 (쉼표=또는)
    if (!quickSearchHit(q, [r.who, ptOf(r)?.name, r.desc, bankLabelOf(r), a?.name, a?.code], [r.amount])) return false;
    //   검색조건 — 빈 칸은 안 건 것과 같다. 여러 개 고른 것은 **하나라도** 맞으면 통과.
    if (live.io !== "all" && r.isIn !== (live.io === "in")) return false;
    if (live.who.length && !live.who.includes(r.who)) return false;
    if (live.bank.length && !(r.bankId && live.bank.includes(r.bankId))) return false;
    if (live.acct.length && !(a && live.acct.includes(a.code))) return false;
    if (live.desc && !r.desc.toLowerCase().includes(live.desc.toLowerCase())) return false;
    if (!amountHit(r.amount, live.min, live.max)) return false;
    return true;
  });
  //   정렬 — 고른 칸으로 세우고, 같으면 늘 일자로 갈라 순서가 흔들리지 않게 한다
  const shown = useMemo(() => {
    const val = (r: Row): unknown => {
      switch (sort.key) {
        case "io":     return r.isIn ? "입금" : "출금";
        case "who":    return r.who;
        case "desc":   return r.desc;
        case "amount": return Math.abs(r.amount) * (r.isIn ? 1 : -1);
        case "state":  return doneOf(r) ? 1 : 0;
        default:       return r.date;
      }
    };
    const arr = [...shownUnsorted];
    arr.sort((a, b) => {
      const c = cmp(val(a), val(b));
      return (sort.dir === "asc" ? c : -c) || a.date.localeCompare(b.date);
    });
    return arr;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shownUnsorted, sort]);
  //   페이지 — 기본 50줄. 조건이 바뀌면 1쪽으로 (2026-08-13 사장님 지시)
  const pager = usePager(shown, live.size, `${from}|${to}|${onlyTodo}|${q}|${JSON.stringify(live)}`);
  //   선택은 쪽을 넘겨도 남는다
  const selRows = shown.filter((r) => sel.has(r.id));

  //   확정할 수 있는 줄인가 — 상대 계정 하나면 된다(거래처·적요는 없어도 전표가 선다)
  const ready = (r: Row) => !!acctOf(r).a;
  const notReady = selRows.filter((r) => !ready(r));

  const confirmAll = async () => {
    if (selRows.length === 0 || busy) return;
    setBusy(true);
    let ok = 0;
    const fails: string[] = [];
    for (const r of selRows) {
      try {
        const acc = acctOf(r).a;
        if (!acc) throw new Error("계정을 먼저 고르세요");
        //   ★ 보통예금 쪽(계정·통장 거래처·계좌 연결)과 차·대 방향은 **서버가 붙인다**.
        //     화면은 상대 계정·상대 거래처·적요만 보낸다 — "자동 입력"을 화면 신뢰에 맡기지 않는다.
        const { error } = await (supabase.rpc as any)("post_bank_manual_voucher", {
          p_bank_tx_id: r.id,
          p_account_id: acc.id,
          p_partner_id: ptOf(r)?.id ?? null,
          p_memo: memoOf(r).trim() || null,
        });
        if (error) throw error;
        //   사람이 고른 계정을 배운다 — 같은 입금자·적요가 또 나오면 미리 채운다
        const k = keyOf(r);
        await learnAccount({ kind: "bank", key: k.key, label: k.label, accountId: acc.id });
        ok += 1;
      } catch (e: any) {
        const m = String(e?.message || "");
        fails.push(`${r.who}: ${
          m.includes("PERIOD_LOCKED") ? "마감된 달"
          : m.includes("ALREADY_POSTED") ? "이미 전표가 있음"
          : m.includes("NO_BANK_ACCOUNT") ? "계정과목에 103 보통예금이 없습니다"
          : friendlyError(e, m || "실패")}`);
      }
    }
    setSel(new Set());
    qc.invalidateQueries({ queryKey: ["bank-rows"] });
    qc.invalidateQueries({ queryKey: ["collect-status"] });
    qc.invalidateQueries({ queryKey: ["voucher-rules"] });
    qc.invalidateQueries({ queryKey: ["bank-partners"] });
    setBusy(false);
    if (ok > 0 && fails.length === 0) toast(`일반전표 ${ok}건을 만들었습니다`, "success");
    else if (ok > 0) toast(`${ok}건 성공 · ${fails.length}건 실패 — ${fails[0]}`, "info");
    else toast(`처리하지 못했습니다 — ${fails[0] ?? "알 수 없는 오류"}`, "error");
  };

  /** 처리한 줄 되돌리기 — 무엇으로 처리했느냐에 따라 길이 다르다 */
  const undo = async (r: Row) => {
    if (busy) return;
    setBusy(true);
    try {
      if (r.posted) {
        //   전표는 **지우지 않고 반려**한다 — 재무제표에서 빠지고 이력은 남는다.
        //   수집·전표의 다른 탭('취소')과 같은 길을 쓴다 (2026-08-12).
        const { error } = await (supabase.rpc as any)("unpost_evidence_voucher", { p_entry_id: r.entryId });
        if (error) throw error;
      } else if (r.transfer) {
        const { error } = await supabase.from("bank_transactions").update({ is_auto_transfer: false }).eq("id", r.id);
        if (error) throw error;
      } else if (r.cardsLinked > 0) {
        const { error: e1 } = await supabase.from("card_transactions").update({ bank_transaction_id: null }).eq("bank_transaction_id", r.id);
        if (e1) throw e1;
        const { error: e2 } = await supabase.from("bank_transactions")
          .update({ settlement_status: "open", settled_amount: 0 }).eq("id", r.id);
        if (e2) throw e2;
      } else if (r.settleIds.length > 0) {
        //   status 를 되돌리면 trg_recalc_settlement 가 미수금·전표를 원복한다.
        //   차액 마감(adjustment)은 통장 거래가 없어 확인 큐로 못 돌아가므로 'rejected' 로 종결한다
        //   — 거래 매칭 화면이 쓰던 규칙 그대로다.
        for (const m of r.settleIds) {
          const { error } = await supabase.from("invoice_settlements")
            .update({ status: m.type === "adjustment" ? "rejected" : "suggested" }).eq("id", m.id);
          if (error) throw error;
        }
      } else {
        toast("되돌릴 처리가 없습니다", "info"); setBusy(false); return;
      }
      qc.invalidateQueries({ queryKey: ["bank-rows"] });
      qc.invalidateQueries({ queryKey: ["collect-status"] });
      qc.invalidateQueries({ queryKey: ["bank-card-cands"] });
      toast("되돌렸습니다 — 미처리로 돌아왔습니다", "info");
    } catch (e: any) {
      toast(`되돌리지 못했습니다 — ${friendlyError(e, String(e?.message || ""))}`, "error");
    } finally { setBusy(false); }
  };

  /** 계정 추천 — 증빙 없는 지출에 **비목**을 AI로 추천받아 같은 이름의 계정과목으로 바꿔 채운다.
   *  '자동 분류' 화면의 'AI 추천 받기'와 같은 엣지 함수(classify-transactions)를 쓴다.
   *  ★ 수금 매칭 추천과는 **다른 일**이다 — 이건 계정·비목, 저건 세금계산서 짝짓기. 이름을 갈라 둔다. */
  const runAcctSuggest = async () => {
    if (aiAcctBusy || !companyId) return;
    const targets = shown.filter((r) => !doneOf(r) && !r.isIn && !acctOf(r).a).slice(0, 20);
    if (targets.length === 0) { toast("추천할 미처리 지출이 없습니다", "info"); return; }
    setAiAcctBusy(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session?.access_token) throw new Error("로그인이 필요합니다");
      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/classify-transactions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ transaction_ids: targets.map((r) => r.id), suggest: true }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || "계정 추천 실패");
      const next: Record<string, Acct> = {};
      let miss = 0;
      for (const rr of (result.results || [])) {
        const label = AI_CATEGORY_LABEL[rr.category] || "";
        const hints = [label, ...(AI_ACCOUNT_HINT[rr.category] || [])].filter(Boolean);
        //   추천 이름과 가장 가까운 **비용 계정**을 찾는다. 못 찾으면 사람이 직접 고르게 둔다.
        const found = accounts.find((a) => a.account_type === "expense" && hints.some((h) => a.name.includes(h)));
        if (found) next[rr.id] = found; else miss += 1;
      }
      setAiAcct((prev) => ({ ...prev, ...next }));
      const n = Object.keys(next).length;
      toast(n > 0
        ? `계정 추천 ${n}건${miss > 0 ? ` · ${miss}건은 맞는 계정과목이 없어 직접 골라야 합니다` : ""} — 확인 후 확정하세요`
        : "맞는 계정과목을 찾지 못했습니다 — 직접 고르세요", n > 0 ? "success" : "info");
    } catch (e: any) {
      toast(friendlyError(e, "계정 추천 실패"), "error");
    } finally { setAiAcctBusy(false); }
  };

  const toggle = (id: string) =>
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  //   머리단 전체 선택은 **보이는 쪽만** 고른다 — 안 보이는 쪽까지 딸려 오면 무엇을 만드는지 모른다
  const pickable = pager.view.filter((r) => !doneOf(r));
  const allOn = pickable.length > 0 && pickable.every((r) => sel.has(r.id));
  const toggleAll = () => setSel((s) => {
    const n = new Set(s);
    for (const r of pickable) { if (allOn) n.delete(r.id); else n.add(r.id); }
    return n;
  });

  //   PickList 는 **자르지 않은** 목록을 받아야 한다 — 검색은 그 안에서 한다
  const acctsOf = (isIn: boolean) =>
    accounts.filter((a) => a.account_type === (isIn ? "revenue" : "expense"));

  const filterAccts = (q: string, isIn: boolean) =>
    accounts.filter((a) =>
      a.account_type === (isIn ? "revenue" : "expense")
      && (!q || a.name.toLowerCase().includes(q.toLowerCase()) || String(a.code).includes(q))).slice(0, 40);

  const sumIn = useMemo(() => shown.filter((r) => r.isIn).reduce((n, r) => n + Math.abs(r.amount), 0), [shown]);
  const sumOut = useMemo(() => shown.filter((r) => !r.isIn).reduce((n, r) => n + Math.abs(r.amount), 0), [shown]);

  const selTotal = selRows.reduce((n, r) => n + Math.abs(r.amount), 0);

  //   'AI 도움' — 조회 조건도 아니고 확정도 아닌 것들 (2026-08-13 사장님이 이름 확정).
  //   ★ 추천 두 가지는 하는 일이 다르므로 이름을 갈라 둔다 (2026-08-11):
  //     계정 추천 = 무슨 비용인가(비목·계정) · 수금 매칭 추천 = 어느 계산서의 입금인가
  //   ★ 줄마다 **출처를 적는다** — 배운 규칙은 AI 가 아니라 사람이 고른 것을 기억해 둔 것이다.
  const suggestable = shown.filter((r) => !doneOf(r) && !r.isIn && !acctOf(r).a).length;
  const helpers: HelperItem[] = [
    rulesHelper,
    {
      label: aiAcctBusy ? "추천 중…" : "계정 추천 받기",
      source: "AI 추천",
      hint: "증빙 없는 지출의 비목을 AI가 추천해 계정 칸을 미리 채웁니다 (한 번에 20건)",
      badge: suggestable, disabled: aiAcctBusy, onClick: runAcctSuggest,
    },
  ];

  //   고를 수 있는 값들 — **이 기간에 실제로 나온 것만** 세운다(고르고도 0건이 나오면 헷갈린다)
  const whoOpts = useMemo(
    () => [...new Set(rows.map((r) => r.who).filter((w) => w && w !== "—"))]
      .sort((a2, b2) => a2.localeCompare(b2, "ko")).map((w) => ({ value: w, label: w })),
    [rows]);
  //   ★ 계좌만은 **회사 전체 목록**을 쓴다 — 거래는 최근 400건까지만 읽어 오므로,
  //     '나온 것만' 추리면 그 400건에 안 걸린 계좌가 목록에서 통째로 사라진다 (실제로 그랬다).
  //     계좌는 개수가 적고 회사설정에 정본이 있어 전부 보여 주는 편이 맞다.
  const bankOpts = useMemo(
    () => bankAccounts.map((b) => ({ value: b.id, label: b.label })), [bankAccounts]);
  const acctOpts = useMemo(
    () => accounts.map((a2) => ({ value: a2.code, label: a2.name, sub: a2.code })),
    [accounts]);

  //   내 조건 — ★ 하나가 이 화면의 기본값이 된다 (DB 라 PC 를 바꿔도 따라온다)
  const saved = useSavedQueries("collect:bank", companyId);
  const applySaved = (p: Record<string, unknown>) => {
    if (typeof p.from === "string" && typeof p.to === "string") onRange(p.from, p.to);
    if (typeof p.onlyTodo === "boolean") setOnlyTodo(p.onlyTodo);
    if (typeof p.q === "string") setQ(p.q);
    const c = { ...EMPTY, ...(p.cond as Partial<Cond> | undefined) };
    setDraft(c); setLive(c);
  };
  //   ★ 기본 조건이 있으면 화면을 열 때 한 번만 건다. 없으면 최근 1개월 그대로.
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
      const a2 = acctOf(r).a;
      if (onlyTodo && doneOf(r)) continue;
      if (!quickSearchHit(q, [r.who, ptOf(r)?.name, r.desc, bankLabelOf(r), a2?.name, a2?.code], [r.amount])) continue;
      if (draft.io !== "all" && r.isIn !== (draft.io === "in")) continue;
      if (draft.who.length && !draft.who.includes(r.who)) continue;
      if (draft.bank.length && !(r.bankId && draft.bank.includes(r.bankId))) continue;
      if (draft.acct.length && !(a2 && draft.acct.includes(a2.code))) continue;
      if (draft.desc && !r.desc.toLowerCase().includes(draft.desc.toLowerCase())) continue;
      if (!amountHit(r.amount, draft.min, draft.max)) continue;
      n += 1;
    }
    return n;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, draft, q, onlyTodo, acct, aiAcct, rules, pt, bankAccounts]);

  //   걸린 조건 — 조회 줄에 칩으로 남는다. 패널을 열지 않고도 알고, ✕ 로 하나씩 뺀다.
  const drop = (patch: Partial<Cond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const chips: AppliedChip[] = [
    ...quickTerms(q).map((t, i) => ({
      group: "빠른검색", label: t,
      onRemove: () => setQ(quickTerms(q).filter((_, j) => j !== i).join(", ")),
    })),
    ...live.who.map((v) => ({ group: "거래처", label: v, onRemove: () => drop({ who: live.who.filter((x) => x !== v) }) })),
    ...live.bank.map((v) => ({ group: "계좌", label: bankAccounts.find((b) => b.id === v)?.label ?? v, onRemove: () => drop({ bank: live.bank.filter((x) => x !== v) }) })),
    ...live.acct.map((v) => ({ group: "계정", label: accounts.find((a2) => a2.code === v)?.name ?? v, onRemove: () => drop({ acct: live.acct.filter((x) => x !== v) }) })),
    ...(live.io !== "all" ? [{ group: "입/출", label: live.io === "in" ? "입금" : "출금", onRemove: () => drop({ io: "all" as const }) }] : []),
    ...(live.desc ? [{ group: "적요", label: live.desc, onRemove: () => drop({ desc: "" }) }] : []),
    ...((live.min || live.max) ? [{
      group: "금액", label: `${won(Number(live.min || 0))} ~ ${live.max ? won(Number(live.max)) : "제한없음"}`,
      onRemove: () => drop({ min: "", max: "" }),
    }] : []),
  ];
  const clearAll = () => { setQ(""); setLive(EMPTY); setDraft(EMPTY); };

  return (
    <div className="ev-wrap">
      {/* ── 1줄 · 조회 조건 — 기간·빠른검색·상태는 즉시, 검색조건은 '조회'를 눌러 ── */}
      <QueryBar right={<>
        <HelperMenu items={helpers} />
        {syncButton}
      </>}>
        {/*   ★ 기간을 **치는 칸은 화면에 하나뿐**이다. 달력은 검색조건 안에 있다. */}
        <DateRangeField from={from} to={to} onChange={onRange} label={null} parts="segments"
          trailing={
            <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen} activeCount={nLive} anchorSel=".drf"
              tabs={<SavedTabs list={saved.list} onApply={(s) => { applySaved(s.params || {}); setPanelOpen(false); }}
                onSave={(name) => saved.save(name, { from, to, onlyTodo, q, cond: draft })}
                onRemove={saved.remove} onSetDefault={saved.setDefault} />}
              foot={<>
                <button type="button" className="btn-secondary btn-sm" disabled={nDraft === 0}
                  onClick={() => setDraft({ ...EMPTY, size: draft.size })}>조건 지우기</button>
                <span className="ml-auto text-[11px] text-[var(--text-dim)]">{won(previewCount)}건</span>
                <RowsPerPage value={draft.size} onChange={setD("size")} />
                <button type="button" className="btn-primary btn-sm"
                  onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
              </>}>
              <ConditionRow label="조회기간" hint="기본 1개월">
                <span className="qk-range-txt">{from} ~ {to}</span>
                <DateRangeField from={from} to={to} onChange={onRange} label={null} parts="calendar" />
                <span className="qk-quicks">
                  {periodQuicks().map((p) => (
                    <button key={p.key} type="button" onClick={() => onRange(p.from, p.to)}
                      className={from === p.from && to === p.to ? "qk-quick qk-quick-on" : "qk-quick"}>{p.label}</button>
                  ))}
                </span>
              </ConditionRow>

              <ConditionRow label="거래처" hint="입금자, 여러 곳">
                <TokenField items={whoOpts} value={draft.who} onChange={setD("who")}
                  placeholder="입금자 이름 일부 (예: 모티)" />
              </ConditionRow>

              <ConditionRow label="계좌" hint="여러 개">
                <TokenField items={bankOpts} value={draft.bank} onChange={setD("bank")}
                  placeholder="계좌 별명 또는 번호 (예: 4017)" />
              </ConditionRow>

              <ConditionRow label="계정과목" hint="여러 개">
                <TokenField items={acctOpts} value={draft.acct} onChange={setD("acct")}
                  placeholder="계정과목 이름 또는 코드 (예: 830)" />
              </ConditionRow>

              <ConditionRow label="입/출">
                <ChipGroup value={draft.io} onChange={setD("io")} options={IO_CHIPS} />
              </ConditionRow>

              <ConditionRow label="통장 적요">
                <input className="qk-input w-full" value={draft.desc} placeholder="예: 부가세"
                  onChange={(e) => setD("desc")(e.target.value)} />
              </ConditionRow>

              <ConditionRow label="금액" hint="입·출금 부호는 보지 않습니다">
                <AmountRange min={draft.min} max={draft.max} onMin={setD("min")} onMax={setD("max")} />
              </ConditionRow>
            </ConditionPanel>
          } />

        <QuickSearch value={q} onApply={setQ}
          placeholder="거래처 · 계좌 · 계정과목 · 적요 · 금액 — 쉼표로 여러 개, Enter" />

        <QueryField label="상태">
          <ChipGroup value={onlyTodo ? "todo" : "all"}
            onChange={(v) => setOnlyTodo(v === "todo")} options={STATE_CHIPS} />
        </QueryField>
      </QueryBar>

      <AppliedChips chips={chips} onClearAll={clearAll} />

      {/* ── 2줄 · 결과 요약 ── */}
      <ResultStrip>
        <Stat label="건수" value={`${won(shown.length)}건`} />
        <Stat label="입금" value={won(sumIn)} tone="plus" />
        <Stat label="출금" value={won(sumOut)} tone="minus" />
        {rows.length >= 400 && <b className="ev-cut">최근 400건만 받아왔습니다 — 기간을 좁혀 주세요</b>}
        {notReady.length > 0 && <span className="ev-warn">{notReady.length}건은 계정을 골라야 합니다</span>}
      </ResultStrip>

      {rowsError ? (
        <div className="collect-empty collect-empty-err">
          통장 거래를 읽지 못했습니다 — {String((rowsError as any)?.message || "알 수 없는 오류")}
        </div>
      ) : isLoading ? (
        <div className="collect-empty">읽는 중…</div>
      ) : shown.length === 0 ? (
        <div className="collect-empty">
          {onlyTodo ? "처리할 통장 거래가 없습니다 — 이 달치는 다 끝냈습니다." : "이 달에 통장 거래가 없습니다."}
        </div>
      ) : (
        <div className="ev-scroll glass-card">
          <table className="ev-table bk-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <button type="button" aria-label="이 쪽 전체 선택" onClick={toggleAll}
                    className={allOn ? "collect-chk collect-chk-on" : "collect-chk"}>{allOn ? "✓" : ""}</button>
                </th>
                <SortableTh label="일자" sortKey="date" sort={sort} onSort={onSort} />
                <SortableTh label="입/출" sortKey="io" sort={sort} onSort={onSort} />
                <SortableTh label="거래처(입금자)" sortKey="who" sort={sort} onSort={onSort} />
                <SortableTh label="통장 적요" sortKey="desc" sort={sort} onSort={onSort} />
                <SortableTh label="금액" sortKey="amount" sort={sort} onSort={onSort} />
                <SortableTh label="차변" /><SortableTh label="대변" />
                <SortableTh label="적요" style={{ width: 150 }} />
                <SortableTh label="상태" sortKey="state" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {pager.view.map((r) => {
                const done = doneOf(r);
                const on = sel.has(r.id);
                return (
                  <tr key={r.id} className={done ? "ev-posted" : on ? "ev-on" : ""}>
                    <td>
                      {!done && (
                        <button type="button" onClick={() => toggle(r.id)} aria-label="선택"
                          className={on ? "collect-chk collect-chk-on" : "collect-chk"}>{on ? "✓" : ""}</button>
                      )}
                    </td>
                    <td className="mono-number">{r.date.slice(5)}</td>
                    <td>
                      <em className={r.isIn ? "spv-type spv-type-s" : "spv-type spv-type-b"}>{r.isIn ? "입금" : "출금"}</em>
                    </td>
                    <td className="ev-ell">{r.who}</td>
                    <td className="ev-ell ev-dim">{r.desc || "—"}</td>
                    <td className={r.isIn ? "tr mono-number bk-in" : "tr mono-number bk-out"}>
                      {r.isIn ? "" : "-"}{won(Math.abs(r.amount))}
                    </td>
                    {/*   차변·대변 — 한쪽은 보통예금(자동), 반대쪽만 사람이 고른다.
                          입금 → 차) 보통예금 / 대) 고른 계정 · 출금 → 차) 고른 계정 / 대) 보통예금 */}
                    {(() => {
                      const sidePicker = (
                        <span className="bk-side">
                          <span className="relative inline-block">
                            <button type="button" disabled={done}
                              onClick={() => setPick(pick?.id === r.id ? null : { id: r.id, q: "" })}
                              className={acctOf(r).a ? "ev-acct" : "ev-acct ev-acct-empty"}>
                              {acctOf(r).a ? `${acctOf(r).a!.code} ${acctOf(r).a!.name}` : (r.isIn ? "수익 계정" : "비용 계정")}
                              {acctOf(r).via && acctOf(r).via !== "고름" && <em className="ev-via">{acctOf(r).via}</em>}
                            </button>
                            {pick?.id === r.id && (
                              <PickList items={acctsOf(r.isIn)} placeholder="계정과목 검색 (이름·코드)"
                                onPick={(a2) => { setAcct((o) => ({ ...o, [r.id]: a2 })); setPick(null); }}
                                onClose={() => setPick(null)} />
                            )}
                          </span>
                          <span className="relative inline-block">
                            <button type="button" disabled={done}
                              onClick={() => setPtPick(ptPick?.id === r.id ? null : { id: r.id, q: "" })}
                              className={ptOf(r) ? "bk-pt" : "bk-pt bk-pt-empty"}>
                              {ptOf(r)?.name ?? "거래처"}
                            </button>
                            {ptPick?.id === r.id && (
                              <PickList items={partners} placeholder="거래처 검색"
                                onPick={(x) => { setPt((o) => ({ ...o, [r.id]: x })); setPtPick(null); }}
                                onClose={() => setPtPick(null)} />
                            )}
                          </span>
                        </span>
                      );
                      //   보통예금 쪽은 서버가 붙인다 — 화면은 무엇이 설지 미리 보여만 준다
                      const bankSide = (
                        <span className="bk-side bk-side-fixed" title="보통예금과 통장 거래처는 자동으로 들어갑니다">
                          <span className="ev-acct ev-acct-lock">103 보통예금</span>
                          <span className="bk-pt bk-pt-lock">통장</span>
                        </span>
                      );
                      return (
                        <>
                          <td>{r.isIn ? bankSide : sidePicker}</td>
                          <td>{r.isIn ? sidePicker : bankSide}</td>
                          <td>
                            <input className="bk-memo" disabled={done}
                              placeholder={memoPlaceholder(r)} value={memoOf(r)}
                              onChange={(e) => setMemo((o) => ({ ...o, [r.id]: e.target.value }))} />
                          </td>
                        </>
                      );
                    })()}
                    <td>
                      {done ? (
                        <span className="bk-done">
                          <span className="ev-st ev-st-done">
                            {r.transfer ? "이동 표시" : r.voucherNo != null ? `#${r.voucherNo} 확정` : "확정"}
                          </span>
                          {/*   잘못 처리한 걸 되돌릴 수 있어야 한다 — 거래 매칭의 '확정 취소'를 옮겨 왔다 */}
                          <button type="button" onClick={() => undo(r)} disabled={busy} className="rules-del">되돌리기</button>
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

      {/* ── 쪽 넘김 — 기본 50줄, 더 보려면 조회 줄의 '조회 줄 수'를 올린다 ── */}
      <Pager page={pager.page} pages={pager.pages} total={shown.length} size={live.size}
        from={pager.from} to={pager.to} onPage={pager.setPage} />

      {/* ── 3줄 · 고른 줄로 하는 일 — 파란 버튼은 여기 하나뿐 ── */}
      <SelectionBar count={selRows.length} onClear={() => setSel(new Set())}
        summary={<>합계 <b className="mono-number">{won(selTotal)}</b>원{notReady.length > 0 && ` · ${notReady.length}건은 계정을 먼저 골라야 합니다`}</>}>
        <button type="button" onClick={confirmAll} disabled={busy}
          className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed">
          {busy ? "만드는 중…" : `일반전표 만들기 (${selRows.length})`}
        </button>
      </SelectionBar>

      <p className="collect-note">
        ※ 통장 한 줄이 <b>일반전표 한 장</b>이 됩니다 — <b>입금</b>은 차) 보통예금[통장] / 대) 고른 계정[고른 거래처],
        <b>출금</b>은 그 반대입니다. <b>보통예금 쪽 계정·통장 거래처는 자동</b>으로 들어갑니다.
        <b>적요</b>는 비워 두면 통장 적요가 그대로 들어갑니다 — 회사 내부 확인용 문구는 직접 적으세요.
        고른 계정은 <b>입금자·적요로 기억</b>해 다음에 미리 채웁니다(<b>지난번</b> → 3번 이상이면 <b>학습</b>).
        잘못 만들었으면 <b>되돌리기</b>로 미처리로 돌립니다.
        세금계산서 <b>수금 매칭</b>·계좌 이동 표시·<b>카드대금 묶기</b>는{" "}
        <Link href="/partners/reconciliation" className="bk-link">거래 매칭</Link>에 그대로 있습니다
        (수금은 여기서 계정을 <b>외상매출금</b>으로 골라도 같은 결과입니다).
      </p>
    </div>
  );
}
