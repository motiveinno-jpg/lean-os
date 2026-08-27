"use client";
import { CardStatusPanels } from "@/components/finance-status-panels";
import { DonutChart, Legend, vizColor } from "@/components/charts/kit";
import { downloadCsv, rangeSuffix } from "@/lib/csv-export";
import { logRead } from "@/lib/log-read";
import { Ico } from "@/components/ui-icon";

// /cards — 카드 자립 페이지(시안 적용). 시안 3탭: 카드 / 거래내역 / 분석.
//   기존 컴포넌트(CardBillingSummary·TopCardExpensesThisMonth·CardAutoTransferHistory·CardMonthlyUsage)를
//   분석 탭에 녹여서 재사용. transactions/page.tsx 본문 0줄 변경(미 import).
//   기능 보존: 큰 카드 디스플레이 + 사용현황 + 미니그리드 + 거래내역 검색/필터 + 분석 stat·차트.
//   가짜 데이터 금지: 카드번호 끝4 only, credit_limit/리워드 없으면 영역 hide, 실 카테고리.

import { useEffect, useMemo, useRef, useState } from "react";
import { DateField } from "@/components/date-field";
import { DateRangeField } from "@/components/date-range-field";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { markConnectedOnce } from "@/lib/analytics";
import { useSyncCooldown } from "@/lib/sync-cooldown";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { friendlyError } from "@/lib/friendly-error";
import { findDuplicateEntries, linkTransactionToEntry, setLedgerExcluded, excludeLabelOf } from "@/lib/dup-voucher";
import { useLedgerExcludePrompt } from "@/components/ledger-exclude-prompt";
import { useDupVoucherPrompt } from "@/components/dup-voucher-prompt";
import { CardBillingSummary } from "@/components/card-billing-summary";
import { getBankSyncAccess } from "@/lib/billing";
import { TopCardExpensesThisMonth, CardAutoTransferHistory, CardMonthlyUsage } from "@/components/card-insights";
import { SortableTh, useColWidths, type ThFilterSpec } from "@/components/sortable-th";
import { BankLogo } from "@/components/bank-logo";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ChipGroup, RowsPerPage, ResultStrip, Stat as QStat,
  SelectionBar, ExcelMenu, type ExcelItem, QuickSearch, quickSearchHit, quickTerms, Pager, usePager,
  ConditionPanel, ConditionRow, TokenField, AmountRange, amountHit, AppliedChips, type AppliedChip,
  defaultRange, periodQuicks, useSavedQueries, SavedTabs, ConditionSave,
} from "@/components/query-kit";
import { EmptyState } from "@/components/empty-state";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { AccountPicker } from "@/components/account-picker";
import { NATURE_LABEL } from "@/lib/account-nature";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;
const fmtW = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

// (대형 CARD HOLDER 히어로 제거로 카드사 그라데이션 매핑도 함께 제거 — 2026-07-10 직원 QA)

// 카드 종류 배지 색 — 카드 헤더의 종류 라벨을 더 눈에 띄게.
function cardTypeBadgeClass(cardType?: string | null): string {
  if (cardType === "check") return "bg-emerald-400/30 text-white border border-emerald-200/40";
  if (cardType === "debit") return "bg-fuchsia-400/30 text-white border border-fuchsia-200/40";
  return "bg-blue-400/30 text-white border border-blue-200/40";
}

// 흰 배경 카드(MiniCard) 위 종류 칩 — 라이트/다크 양쪽 잘 보이는 톤.
/** 카드번호 표시 — 저장된 값 전체를 4자리씩 끊어 보여준다. 카드사(CODEF)는 마스킹된 번호만 줘서
 *  기본은 끝 4자리다 — 전체를 보려면 '수정'에서 카드번호를 직접 채운다 (2026-08-20 사장님) */
function cardNoDisplay(no: string | null | undefined): string {
  const v = String(no || "").replace(/[^0-9*]/g, "");
  if (!v) return "----";
  if (v.length <= 4) return `•••• ${v}`;
  return v.replace(/(.{4})(?=.)/g, "$1-");
}

function cardTypeChipClass(cardType?: string | null): string {
  if (cardType === "check") return "bg-emerald-500/15 text-emerald-600 border border-emerald-500/30 dark:text-emerald-400";
  if (cardType === "debit") return "bg-fuchsia-500/15 text-fuchsia-600 border border-fuchsia-500/30 dark:text-fuchsia-400";
  return "bg-blue-500/15 text-blue-600 border border-blue-500/30 dark:text-blue-400";
}

// 카테고리 키워드 → 이모지(실 카테고리에 키워드 매칭). 매핑 없으면 기본 💳.
const CATEGORY_EMOJI: Array<[RegExp, string]> = [
  [/구독|넷플릭스|스포티파이|netflix|spotify/i, "🎵"],
  [/여행|항공|호텔|숙박|travel/i, "✈️"],
  [/식사|음식|식음료|커피|레스토랑|배달/i, "🍽️"],
  [/교통|택시|주유|연료/i, "🚗"],
  [/쇼핑|편의점|마트|상품/i, "🛒"],
  [/통신|sk|kt|lg/i, "📱"],
  [/광고|마케팅/i, "📢"],
  [/사무|소모품|비품|문구/i, "📎"],
  [/임대|월세|관리비/i, "🏢"],
  [/세금|공과/i, "🧾"],
  [/급여|월급|인건/i, "💰"],
];
//   계정 성격 라벨 — account_type 은 자유 문자열이라 안전하게 되짚는다 (2026-08-10)
const cardNatureLabel = (t: string) => (NATURE_LABEL as Record<string, string>)[t] || t;

function categoryEmoji(category: string | null | undefined): string {
  const c = (category || "").trim();
  if (!c) return "💳";
  for (const [re, emoji] of CATEGORY_EMOJI) if (re.test(c)) return emoji;
  return "💳";
}

// classification 컬럼은 jsonb — {"label":"...","confidence":"low","reason":"..."} 객체 또는 그것의
// 문자열화 결과 또는 평문일 수 있음. UI 에는 label 만 표시(JSON 그대로 노출 금지).
function classificationLabel(c: unknown): string {
  if (!c) return "";
  if (typeof c === "object") {
    const obj = c as { label?: string };
    return String(obj.label || "");
  }
  const s = String(c).trim();
  if (s.startsWith("{") && s.endsWith("}")) {
    try {
      const parsed = JSON.parse(s);
      return String(parsed?.label || "");
    } catch {
      return "";
    }
  }
  return s;
}

const cardTypeLabel = (t?: string | null) => t === "credit" ? "신용" : t === "check" ? "체크" : t === "debit" ? "직불" : "카드";

type Tab = "cards" | "transactions" | "analysis";

/*  ── 조회 화면 표준 (2026-08-13 확정) — 수집·전표·통장과 같은 검색조건/줄수/내 조건 구성 ──
    ★ 여기 있는 것은 **'조회'를 눌러야** 반영된다. 기간·빠른검색은 조회 줄에 있어 즉시다. */
//   기본은 '미처리' — 전표처리된 건은 목록에서 사라진다 (2026-08-19 사장님). 전체·전표됨은 골라 본다.
const CARD_STATE_CHIPS = [
  { value: "todo", label: "미처리" }, { value: "all", label: "전체" }, { value: "posted", label: "전표됨" }, { value: "excluded", label: "장부 제외" },
] as const;
type CardCond = {
  cards: string[];  // 카드 (id, id 없는 옛 데이터는 카드명)
  merch: string[];  // 가맹점
  cls: string[];    // 분류(계정과목 이름)
  state: (typeof CARD_STATE_CHIPS)[number]["value"];
  min: string; max: string;
  size: number;     // 한 쪽에 몇 줄 — 조건의 하나라 '내 조건'에 같이 저장된다
};
const CARD_EMPTY: CardCond = { cards: [], merch: [], cls: [], state: "todo", min: "", max: "", size: 50 };
/** 배지에 셀 것 — 줄 수는 '좁히는 조건'이 아니라 보기 방식이라 안 센다 */
const cardCondCount = (c: CardCond) =>
  c.cards.length + c.merch.length + c.cls.length + (c.state !== "all" ? 1 : 0) + ((c.min || c.max) ? 1 : 0);

//   해외 결제 (2026-08-27 ERP 2순위 '다중 통화') — CODEF 원본에 통화·외화 금액이 있다(monday.com USD 240 → ₩336,480).
//   금액 칸은 원화 그대로(전표도 원화), 옆에 'USD 240 · 환율 1,402' 를 붙인다. 원본에 없으면 아무것도 안 붙는다.
const foreignOf = (tx: any): { cur: string; amt: number; rate: number } | null => {
  const a = tx?.raw_data?.approval; if (!a) return null;
  const cur = String(a.resAccountCurrency || "").toUpperCase(); const used = Number(a.resUsedAmount || 0); const krw = Number(a.resKRWAmt || tx.amount || 0);
  if (!cur || cur === "KRW" || !used || !krw) return null;
  return { cur, amt: used, rate: Math.round((krw / used) * 100) / 100 };
};
const ForeignBadge = ({ tx }: { tx: any }) => { const f = foreignOf(tx); return f ? <span className="card-fx" title={`해외 결제 · 원화 환산 환율 ${f.rate.toLocaleString("ko-KR")}`}>{f.cur} {f.amt.toLocaleString("ko-KR")} · 환율 {f.rate.toLocaleString("ko-KR")}</span> : null; };

export default function CardsPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const companyId = user?.company_id ?? null;
  const cardCd = useSyncCooldown(companyId, "card");
  // 즉시 동기화 권한 — 무료는 자동(하루 2회)만, 즉시 버튼은 유료 전용 (2026-08-07)
  const { data: cardSync } = useQuery({
    queryKey: ["bank-sync-access", companyId],
    queryFn: () => getBankSyncAccess(companyId!),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });
  const [tab, setTab] = useState<Tab>("cards");
  const [selectedCardIdx, setSelectedCardIdx] = useState(0);
  const [showBalance, setShowBalance] = useState(true);
  //   조회 줄 — 빠른검색(즉시) + 검색조건 패널(조회를 눌러야). 수집·전표·통장과 같은 draft/live 구도.
  //   예전의 검색 input + 카드 select 낱장은 이 표준으로 흡수했다.
  const [txQ, setTxQ] = useState("");
  const [txPanelOpen, setTxPanelOpen] = useState(false);
  const [txDraft, setTxDraft] = useState<CardCond>(CARD_EMPTY);
  const [txLive, setTxLive] = useState<CardCond>(CARD_EMPTY);
  const setTxD = <K extends keyof CardCond>(k: K) => (v: CardCond[K]) => setTxDraft((c) => ({ ...c, [k]: v }));
  // 거래내역 탭 표 — 헤더 더블클릭 정렬 + 행 체크박스 다중선택 (UI 전용, DB 변경 없음)
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  // 직원 QA 카드(그랜터) — 카드 선택 후 기간 거래(cardTx) 뷰의 검색·정렬
  const [cardTxSearch, setCardTxSearch] = useState("");
  const [cardSortKey, setCardSortKey] = useState<string>("transaction_date");
  const [cardSortDir, setCardSortDir] = useState<"asc" | "desc">("desc");
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  const onSortTx = (key: string) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(key === "transaction_date" || key === "amount" ? "desc" : "asc");
      return key;
    });
  };
  // CODEF 카드 동기화
  const [syncing, setSyncing] = useState(false);
  // 카드 클릭 → 그 카드의 거래내역 영역(카드 탭 하단 #card-tx-detail) 필터
  //   등록 카드: corporate_cards.id 로 필터 / CODEF 미식별 묶음: card_name 으로 필터
  const [selectedCardId, setSelectedCardId] = useState<string>("");
  const [selectedCardName, setSelectedCardName] = useState<string>("");
  // 선택 카드 거래내역 기간 필터 + 거래내역 탭 조회기간 + CODEF 연동 범위 (공통)
  //   ★ 기본값은 최근 1개월 (조회 화면 표준) — 예전 '미설정=최근 N건' 방식을 버렸다.
  const [cardTxFrom, setCardTxFrom] = useState<string>(() => defaultRange().from);
  //   카드 탭 보기 — 표가 기본, 카드는 보기 옵션 (2026-08-19 조회 표준: 목록은 표)
  const [cardsView, setCardsView] = useState<"list" | "card">("list");
  //   카드 동작 확장 (2026-08-19 사장님) — 수정(이름·메모)·숨김(is_active=false)·삭제(거래 있으면 막음)
  const { confirm: confirmDlg, confirmElement: cardConfirmEl } = useConfirm();
  const [showHiddenCards, setShowHiddenCards] = useState(false);
  const [cardEdit, setCardEdit] = useState<{ id: string; name: string; memo: string; number: string } | null>(null);
  const [cardSaving, setCardSaving] = useState(false);
  const refreshCards = () => { queryClient.invalidateQueries({ queryKey: ["cards-page-corporate"] }); queryClient.invalidateQueries({ queryKey: ["corporate-cards"] }); };
  const saveCardEdit = async () => {
    if (!cardEdit) return;
    const name = cardEdit.name.trim(); if (!name) { toast("카드 이름을 입력해 주세요", "error"); return; }
    setCardSaving(true);
    try { const { error } = await db.from("corporate_cards").update({ card_name: name, memo: cardEdit.memo.trim() || null, card_number: cardEdit.number.replace(/[^0-9]/g, "") || null } as never).eq("id", cardEdit.id); if (error) throw error; refreshCards(); toast("카드 정보를 저장했습니다", "success"); setCardEdit(null); }
    catch (e) { toast(friendlyError(e, "저장 실패"), "error"); } finally { setCardSaving(false); }
  };
  const toggleCardHidden = async (card: any) => {
    const hide = card.is_active !== false;
    try { const { error } = await db.from("corporate_cards").update({ is_active: !hide }).eq("id", card.id); if (error) throw error; refreshCards(); toast(hide ? "목록에서 숨겼습니다(비활성) — '숨긴 카드 보기'로 되돌릴 수 있습니다" : "다시 보입니다(활성)", "success"); }
    catch (e) { toast(friendlyError(e, "변경 실패"), "error"); }
  };
  const removeCard = async (card: any) => {
    const { ok } = await confirmDlg({ title: "카드 삭제", desc: `"${card.card_name || "카드"}"을(를) 삭제할까요? 거래가 있는 카드는 삭제되지 않습니다(숨김을 쓰세요). 삭제는 되돌릴 수 없습니다.`, danger: true, confirmLabel: "삭제" });
    if (!ok) return;
    try {
      const { count } = await db.from("card_transactions").select("id", { count: "exact", head: true }).eq("card_id", card.id);
      if ((count || 0) > 0) { toast(`이 카드에 거래 ${(count || 0).toLocaleString()}건이 있어 삭제할 수 없습니다 — '숨김'을 쓰세요.`, "error"); return; }
      const { error } = await db.from("corporate_cards").delete().eq("id", card.id); if (error) throw error;
      refreshCards(); toast("삭제했습니다", "success");
    } catch (e) { toast(friendlyError(e, "삭제 실패"), "error"); }
  };
  const [cardTxTo, setCardTxTo] = useState<string>(() => defaultRange().to);
  // 전표처리 (카드 → 수동 전표)
  const [postCard, setPostCard] = useState<any | null>(null);
  const [postAccountId, setPostAccountId] = useState<string>("");
  const [postRemember, setPostRemember] = useState(true);
  const [postFixed, setPostFixed] = useState(false); // 고정비로 표시 (is_fixed_cost)
  // 직원 QA 카드(그랜터) — 거래별 사유·태그·사용직원
  const [postMemo, setPostMemo] = useState("");
  const [postTags, setPostTags] = useState("");
  const [postEmployee, setPostEmployee] = useState("");
  const [posting, setPosting] = useState(false);
  // 카드명 인라인 편집(corporate_cards.card_name UPDATE)
  const [editingCardId, setEditingCardId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState("");

  // 이번 달 KST 범위
  //   QA 2026-06-12: +9h 후 로컬 게터는 KST 브라우저에서 이중 가산(월말 저녁에 다음 달) → UTC 게터로 교정.
  const monthRange = useMemo(() => {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const y = kst.getUTCFullYear(), m = kst.getUTCMonth();
    const from = new Date(y, m, 1);
    const to = new Date(y, m + 1, 0);
    const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { from: f(from), to: f(to) };
  }, []);

  // 등록 카드 목록
  const { data: cards = [] } = useQuery({
    queryKey: ["cards-page-corporate", companyId],
    queryFn: async () => {
      const data = logRead('cards/page:data', await db.from("corporate_cards")
        .select("*")
        .eq("company_id", companyId ?? "")
        .order("created_at", { ascending: true }));
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  // 이번 달 카드 거래 (분석 stat + 카드별 사용액·거래수)
  const { data: monthTx = [] } = useQuery({
    queryKey: ["cards-page-month-tx", companyId, monthRange.from, monthRange.to],
    queryFn: async () => {
      const data = logRead('cards/page:data', await db.from("card_transactions")
        .select("id, card_id, card_name, amount, category, classification, transaction_date, merchant_name, raw_data")
        .eq("company_id", companyId ?? "")
        .gte("transaction_date", monthRange.from)
        .lte("transaction_date", monthRange.to)
        .limit(50000));
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  // 카드 탭 — 선택된 카드의 거래내역(#card-tx-detail). 선택돼 있을 때만 fetch.
  const { data: cardTx = [] } = useQuery({
    queryKey: ["cards-page-card-tx", companyId, selectedCardId, selectedCardName, cardTxFrom, cardTxTo],
    queryFn: async () => {
      let q = db.from("card_transactions")
        .select("id, card_id, card_name, amount, category, classification, transaction_date, transaction_time, merchant_name, journal_entry_id, ledger_excluded_reason, is_fixed_cost, memo, tags, used_by_employee_id, raw_data")
        .eq("company_id", companyId ?? "")
        .order("transaction_date", { ascending: false })
        .limit(500);
      if (selectedCardId) q = q.eq("card_id", selectedCardId);
      else if (selectedCardName) q = q.eq("card_name", selectedCardName);
      if (cardTxFrom) q = q.gte("transaction_date", cardTxFrom);
      if (cardTxTo) q = q.lte("transaction_date", cardTxTo);
      const data = logRead('cards/page:tx', await q);
      return (data || []) as any[];
    },
    enabled: !!companyId && (!!selectedCardId || !!selectedCardName),
  });

  // 전표처리용 — 계정과목 + 회사별 카드 category→계정 매핑
  const { data: accounts = [] } = useQuery({
    queryKey: ["cards-page-accounts", companyId],
    queryFn: async () => {
      const data = logRead('cards/page:data', await db.from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId ?? "").order("code"));
      return (data || []) as any[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });
  // 직원 QA 카드(그랜터) — 사용직원 선택용 재직 직원 목록
  const { data: cardEmployees = [] } = useQuery({
    queryKey: ["cards-page-employees", companyId],
    queryFn: async () => {
      const data = logRead('cards/page:data', await db.from("employees").select("id, name").eq("company_id", companyId ?? "").eq("status", "active").order("name"));
      return (data || []) as any[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });
  const { data: cardMappings = [] } = useQuery({
    queryKey: ["cards-page-mappings", companyId],
    queryFn: async () => {
      const data = logRead('cards/page:data', await db.from("card_account_mappings").select("category, account_id").eq("company_id", companyId ?? ""));
      return (data || []) as any[];
    },
    enabled: !!companyId, staleTime: 60_000,
  });
  const mappingByCategory = useMemo(() => {
    const m: Record<string, string> = {};
    for (const r of cardMappings as any[]) m[r.category] = r.account_id;
    return m;
  }, [cardMappings]);

  const openPost = (tx: any) => {
    setPostCard(tx);
    setPostAccountId(mappingByCategory[tx.category] || "");
    setPostRemember(true);
    setPostFixed(!!tx.is_fixed_cost); // 이전에 고정비로 체크했던 거래는 체크된 상태로 열림
    setPostMemo(tx.memo || ""); setPostTags((tx.tags || []).join(", ")); setPostEmployee(tx.used_by_employee_id || "");
  };
  //   중복 의심 팝업 (2026-08-19) — 같은 날 같은 금액 전표가 이미 있으면 새 전표/기존 전표에 연결/취소
  const { askDup, dupPromptElement } = useDupVoucherPrompt();
  //   장부 제외 (2026-08-19) — 선택한 미처리 카드 거래를 사유와 함께 전표 없이 끝낸다 / 해제
  const { askExclude, excludePromptElement } = useLedgerExcludePrompt();
  const excludeSelectedCards = async () => {
    const ids = Array.from(selectedTxIds).filter((id) => { const t = (shownTx as any[]).find((x) => x.id === id); return t && !t.journal_entry_id && !t.ledger_excluded_reason; });
    if (ids.length === 0) { toast("장부 제외할 미처리 거래를 고르세요", "info"); return; }
    const first = (shownTx as any[]).find((x) => x.id === ids[0]);
    const reason = await askExclude(`카드 ${first?.transaction_date} ${first?.merchant_name || ""} ${fmtW(Math.abs(Number(first?.amount || 0)))}`, ids.length);
    if (!reason) return;
    try { const n = await setLedgerExcluded("card", ids, reason); toast(`${n}건 장부 제외 — 목록에서 사라졌습니다 (검색조건 상태 '장부 제외'로 다시 봅니다)`, "success"); setSelectedTxIds(new Set()); queryClient.invalidateQueries({ queryKey: ["cards-page-card-tx"] }); }
    catch (e) { toast(friendlyError(e, "장부 제외 실패"), "error"); }
  };
  /** 전표처리 모달에서 바로 장부 제외 — 한 건 */
  const excludePostCard = async () => {
    if (!postCard) return;
    const reason = await askExclude(`카드 ${postCard.transaction_date} ${postCard.merchant_name || ""} ${fmtW(Math.abs(Number(postCard.amount || 0)))}`, 1);
    if (!reason) return;
    try { await setLedgerExcluded("card", [postCard.id], reason); toast("장부 제외 — 목록에서 사라졌습니다 (검색조건 상태 '장부 제외'로 다시 봅니다)", "success"); setPostCard(null); setPostAccountId(""); queryClient.invalidateQueries({ queryKey: ["cards-page-card-tx"] }); }
    catch (e) { toast(friendlyError(e, "장부 제외 실패"), "error"); }
  };
  const unexcludeCard = async (id: string) => {
    try { await setLedgerExcluded("card", [id], null); toast("제외를 해제했습니다 — 미처리로 돌아옵니다", "success"); queryClient.invalidateQueries({ queryKey: ["cards-page-card-tx"] }); }
    catch (e) { toast(friendlyError(e, "해제 실패"), "error"); }
  };
  const doPostVoucher = async () => {
    if (!postCard || !postAccountId || posting) return;
    setPosting(true);
    try {
      const dups = await findDuplicateEntries(companyId ?? "", postCard.transaction_date, Math.abs(Number(postCard.amount || 0)));
      if (dups.length > 0) {
        const a = await askDup(`카드 ${postCard.transaction_date} ${postCard.merchant_name || ""} ${Math.abs(Number(postCard.amount || 0)).toLocaleString()}원`, postCard.card_name || "", dups);
        if (a.action === "cancel") { setPosting(false); return; }
        if (a.action === "link") {
          const done = await linkTransactionToEntry("card", postCard.id, a.entryId);
          toast(done ? "기존 전표에 연결했습니다 — 전표는 만들지 않았고 목록에서 전표됨으로 처리됩니다" : "이미 전표가 걸린 거래입니다", done ? "success" : "info");
          setPostCard(null); setPostAccountId(""); queryClient.invalidateQueries({ queryKey: ["cards-page-card-tx"] }); setPosting(false); return;
        }
      }
      const { error } = await db.rpc("post_card_voucher", { p_card_tx_id: postCard.id, p_account_id: postAccountId, p_remember: postRemember });
      if (error) throw new Error(error.message);
      // 고정비·사유·태그·사용직원 저장 (직원 QA 카드 그랜터 — 실패해도 전표는 유지)
      try {
        await db.from("card_transactions").update({
          is_fixed_cost: postFixed,
          memo: postMemo || null,
          tags: postTags.split(",").map((s: string) => s.trim()).filter(Boolean),
          used_by_employee_id: postEmployee || null,
        }).eq("id", postCard.id);
      } catch { /* best-effort */ }
      toast("전표가 생성되었습니다", "success");
      setPostCard(null); setPostAccountId("");
      queryClient.invalidateQueries({ queryKey: ["cards-page-card-tx"] });
      queryClient.invalidateQueries({ queryKey: ["cards-page-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["cards-page-recent-tx"] });
    } catch (e: any) {
      const m = String(e?.message || "");
      toast(m.includes("ALREADY_POSTED") ? "이미 전표처리된 거래입니다" : m.includes("NO_CASH_ACCOUNT") ? "보통예금(103) 계정과목이 없습니다" : m.includes("INVALID_ACCOUNT") ? "계정과목을 선택하세요" : m || "전표처리 실패", "error");
    } finally { setPosting(false); }
  };
  // 직원 QA 카드(그랜터) — 같은 가맹점 미처리 거래 전체에 같은 계정·사유·태그·사용직원 일괄 적용
  const doPostSameMerchant = async () => {
    if (!postCard || !postAccountId || posting) return;
    const targets = (cardTx as any[]).filter((t) => (t.merchant_name || "") === (postCard.merchant_name || "") && !t.journal_entry_id);
    if (targets.length === 0) return;
    setPosting(true);
    try {
      const tags = postTags.split(",").map((s: string) => s.trim()).filter(Boolean);
      let ok = 0;
      for (const t of targets) {
        const { error } = await db.rpc("post_card_voucher", { p_card_tx_id: t.id, p_account_id: postAccountId, p_remember: postRemember });
        if (error) continue;
        try { await db.from("card_transactions").update({ is_fixed_cost: postFixed, memo: postMemo || null, tags, used_by_employee_id: postEmployee || null }).eq("id", t.id); } catch { /* best-effort */ }
        ok++;
      }
      toast(`같은 가맹점 ${ok}건 전표처리 완료`, ok > 0 ? "success" : "error");
      setPostCard(null); setPostAccountId("");
      queryClient.invalidateQueries({ queryKey: ["cards-page-card-tx"] });
      queryClient.invalidateQueries({ queryKey: ["cards-page-mappings"] });
      queryClient.invalidateQueries({ queryKey: ["cards-page-recent-tx"] });
    } catch { toast("일괄 처리 중 오류", "error"); } finally { setPosting(false); }
  };
  // 전표처리 모달 — ESC 닫기 · Enter 확인(계정과목 미선택/처리중이면 비활성)
  useModalKeys(!!postCard, () => setPostCard(null), posting || !postAccountId ? undefined : doPostVoucher);

  // 일괄 전표처리 — 선택된 미처리 카드거래를 비용계정 1개로 순차 post_card_voucher
  const [showBulkPost, setShowBulkPost] = useState(false);
  const [bulkAccountId, setBulkAccountId] = useState<string>("");
  const [bulkPosting, setBulkPosting] = useState(false);
  const doBulkPost = async () => {
    if (!bulkAccountId || bulkPosting) { if (!bulkAccountId) toast("계정과목을 선택하세요", "error"); return; }
    setBulkPosting(true);
    let ok = 0, fail = 0;
    try {
      const ids = Array.from(selectedTxIds);
      for (const id of ids) {
        const tx = (recentTx as any[]).find((t) => t.id === id);
        if (!tx || tx.journal_entry_id) continue; // 이미 처리된 건 skip
        const { error } = await db.rpc("post_card_voucher", { p_card_tx_id: id, p_account_id: bulkAccountId, p_remember: false });
        if (error) fail++; else ok++;
      }
      toast(`${ok}건 전표처리 완료${fail > 0 ? ` · ${fail}건 실패` : ""}`, fail > 0 ? "info" : "success");
      setShowBulkPost(false); setBulkAccountId(""); setSelectedTxIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["cards-page-recent-tx"] });
      queryClient.invalidateQueries({ queryKey: ["cards-page-card-tx"] });
    } finally { setBulkPosting(false); }
  };
  // 일괄 전표처리 모달 — ESC 닫기 · Enter 확인(계정과목 미선택/처리중이면 비활성)
  useModalKeys(showBulkPost, () => setShowBulkPost(false), bulkPosting || !bulkAccountId ? undefined : doBulkPost);

  // 거래내역 탭 — 조회기간(기본 최근 1개월) 전체, 상한 2000. 탭 진입 시에만 fetch.
  //   카드 필터는 client-side (검색조건의 '카드' 칩 — id 없는 옛 데이터는 카드명으로 거른다).
  const { data: recentTx = [] } = useQuery({
    queryKey: ["cards-page-recent-tx", companyId, cardTxFrom, cardTxTo],
    queryFn: async () => {
      let q = db.from("card_transactions")
        .select("id, card_id, card_name, amount, category, classification, transaction_date, transaction_time, merchant_name, journal_entry_id, ledger_excluded_reason, is_fixed_cost, memo, tags, used_by_employee_id, raw_data")
        .eq("company_id", companyId ?? "")
        .order("transaction_date", { ascending: false })
        .limit(2000);
      if (cardTxFrom) q = q.gte("transaction_date", cardTxFrom);
      if (cardTxTo) q = q.lte("transaction_date", cardTxTo);
      const data = logRead('cards/page:tx', await q);
      return (data || []) as any[];
    },
    enabled: !!companyId && tab === "transactions",
  });

  // 카드별 이번 달 거래수 · 사용액
  const perCard = useMemo(() => {
    const counts: Record<string, number> = {};
    const sums: Record<string, number> = {};
    for (const tx of monthTx) {
      const k = (tx.card_id as string) || (tx.card_name as string) || "?";
      counts[k] = (counts[k] || 0) + 1;
      // 음수 = 취소/환불 — 사용액에서 상계 (2026-08-19 감사: 절댓값 합산은 취소를 사용으로 더했다)
      sums[k] = (sums[k] || 0) + Number(tx.amount || 0);
    }
    return { counts, sums };
  }, [monthTx]);

  // 카테고리별 지출 상위 5
  const categoryStats = useMemo(() => {
    const m: Record<string, number> = {};
    let totalSpendAll = 0;   // 상위 5 가 아닌 전체 지출 — % 분모용 (2026-08-19)
    for (const tx of monthTx) {
      const amt = Number(tx.amount || 0);   // 음수(취소)는 해당 카테고리에서 상계
      if (amt === 0) continue;
      totalSpendAll += Math.max(0, amt);
      const cat = classificationLabel(tx.classification) || tx.category || "미분류";
      m[cat] = (m[cat] || 0) + amt;
    }
    const entries = Object.entries(m).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]).slice(0, 5);
    return entries.map(([name, amount]) => ({ name, amount, pct: totalSpendAll > 0 ? Math.round((amount / totalSpendAll) * 100) : 0 }));
  }, [monthTx]);

  if (!companyId) {
    return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }

  const currentCard = cards[selectedCardIdx] || null;
  const currentCardKey = currentCard ? (currentCard.id || currentCard.card_name) : "";
  const currentTxCount = perCard.counts[currentCardKey] || 0;
  const currentSpend = perCard.sums[currentCardKey] || 0;

  // 순 사용액 = 사용 − 취소 (2026-08-19 감사: 절댓값 합산은 100만원 결제+전액취소를 200만원 사용으로 표시)
  const totalUsage = monthTx.reduce((s: number, t: any) => s + Number(t.amount || 0), 0);
  // corporate_cards 실제 컬럼은 is_active / monthly_limit (credit_limit·status 는 없음 — 2026-07-06 QA)
  const activeCards = cards.filter((c: any) => c.is_active !== false).length;
  const hasLimits = cards.some((c: any) => Number(c.monthly_limit || 0) > 0);
  const totalLimit = hasLimits ? cards.reduce((s: number, c: any) => s + Number(c.monthly_limit || 0), 0) : 0;

  // 직원 QA 카드(그랜터) — 사용직원 id→이름 + cardTx 검색·정렬 적용
  const empNameById = useMemo(() => { const m: Record<string, string> = {}; for (const e of cardEmployees as any[]) m[e.id] = e.name; return m; }, [cardEmployees]);
  const shownCardTx = useMemo(() => {
    const q = cardTxSearch.trim().toLowerCase();
    let list = (cardTx as any[]).filter((tx) => !q
      || (tx.merchant_name || "").toLowerCase().includes(q)
      || (tx.category || tx.classification || "").toLowerCase().includes(q)
      || (tx.memo || "").toLowerCase().includes(q)
      || (tx.tags || []).join(" ").toLowerCase().includes(q)
      || (empNameById[tx.used_by_employee_id] || "").toLowerCase().includes(q));
    const dir = cardSortDir === "asc" ? 1 : -1;
    list = [...list].sort((a, b) => {
      if (cardSortKey === "amount") return (Math.abs(Number(a.amount) || 0) - Math.abs(Number(b.amount) || 0)) * dir;
      return String(a[cardSortKey] ?? "").localeCompare(String(b[cardSortKey] ?? "")) * dir;
    });
    return list;
  }, [cardTx, cardTxSearch, cardSortKey, cardSortDir, empNameById]);

  //   엑셀 — 통장과 같은 함수를 쓴다(한글 깨짐·쉼표 밀림을 한 곳에서만 막는다)
  const exportCardCsv = (list: any[], tag = "") => {
    downloadCsv(
      `카드거래내역_${rangeSuffix(cardTxFrom, cardTxTo)}${tag}`,
      ["승인일", "가맹점", "금액", "비목", "카드", "전표"],
      list.map((tx) => [
        String(tx.transaction_date || "").slice(0, 10),
        tx.merchant_name || "",
        Number(tx.amount || 0),
        tx.category || "",
        tx.card_name || tx.card_number || "",
        tx.journal_entry_id ? "처리됨" : "",
      ]),
    );
  };

  // 정렬 적용 — 원본 불변 복제 정렬. null/빈값은 항상 뒤로.
  const sortedTx = useMemo(() => {
    if (!sortKey) return recentTx;
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (tx: any) => {
      switch (sortKey) {
        case "transaction_date": return `${tx.transaction_date || ""} ${tx.transaction_time || ""}`; // 같은 날짜는 승인 시각순
        case "amount": return Math.abs(Number(tx.amount || 0));
        case "merchant_name": return tx.merchant_name || "";
        case "classification": return classificationLabel(tx.classification) || tx.category || "";
        case "card_name": return tx.card_name || "";
        default: return "";
      }
    };
    const isEmpty = (v: any) => v === "" || v === null || v === undefined;
    return [...recentTx].sort((a: any, b: any) => {
      const va = get(a), vb = get(b);
      if (isEmpty(va) && isEmpty(vb)) return 0;
      if (isEmpty(va)) return 1;
      if (isEmpty(vb)) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "ko") * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recentTx, sortKey, sortDir]);

  /*  ── 엑셀식 머리단 필터 + 열 너비 — 수집·전표 표와 같은 방식 (sortable-th 공용 부품) ── */
  const [colF, setColF] = useState<Record<string, Set<string> | null>>({});
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths("cards-tx-colw", {
    merchant: 220, classification: 130, card: 140, amount: 120, date: 150,
  });
  const colVal = (tx: any, k: string): string => {
    switch (k) {
      case "merchant": return tx.merchant_name || "";
      case "classification": return classificationLabel(tx.classification) || tx.category || "미분류";
      case "card": return tx.card_name || "카드";
      case "amount": return `${Number(tx.amount || 0) < 0 ? "+" : "-"}${Math.abs(Number(tx.amount || 0)).toLocaleString("ko-KR")}`;
      case "date": return String(tx.transaction_date || "");
      default: return "";
    }
  };
  const colHit = (tx: any): boolean =>
    Object.entries(colF).every(([k, set]) => !set || set.has(colVal(tx, k)));
  //   값 목록은 **다른 칸 필터를 거친 뒤** 기준 — 엑셀의 좁혀 들어가기와 동일
  const thFilter = (k: string): ThFilterSpec => ({
    values: (sortedTx as any[])
      .filter((tx) => Object.entries(colF).every(([kk, set]) => kk === k || !set || set.has(colVal(tx, kk))))
      .map((tx) => colVal(tx, k)),
    selected: colF[k] ?? null,
    onApply: (sel) => setColF((f) => ({ ...f, [k]: sel })),
  });
  const thResize = (k: string, colIndex: number) =>
    ({ k, colIndex, widths: colW, onResize: setColW, tableRef });
  /*  ── 검색조건·빠른검색 맞춤 — 빈 칸은 안 건 것과 같다. 여러 개 고른 것은 하나라도 맞으면 통과. ── */
  const txCondHit = (tx: any, c: CardCond, qq: string): boolean => {
    const cls = classificationLabel(tx.classification) || tx.category || "미분류";
    if (!quickSearchHit(qq, [tx.merchant_name, tx.card_name, cls, tx.memo, (tx.tags || []).join(" ")], [tx.amount])) return false;
    if (c.cards.length && !(c.cards.includes(tx.card_id || "") || c.cards.includes(tx.card_name || ""))) return false;
    if (c.merch.length && !c.merch.includes(tx.merchant_name || "")) return false;
    if (c.cls.length && !c.cls.includes(cls)) return false;
    if (c.state === "posted" && !tx.journal_entry_id) return false;
    if (c.state === "excluded" && !tx.ledger_excluded_reason) return false;
    if (c.state === "todo" && (tx.journal_entry_id || tx.ledger_excluded_reason)) return false;
    if (!amountHit(Number(tx.amount || 0), c.min, c.max)) return false;
    return true;
  };
  //   화면·엑셀·전체선택·쪽 넘김이 모두 이 목록을 본다 — 보이는 것과 파일·선택이 달라지면 안 된다
  const shownTx = (sortedTx as any[]).filter((tx) => txCondHit(tx, txLive, txQ) && colHit(tx));
  //   '조회'를 누르기 전에 몇 건 나올지만 미리 알려 준다 (표는 안 흔든다)
  const previewCount = (sortedTx as any[]).filter((tx) => txCondHit(tx, txDraft, txQ)).length;
  //   쪽 넘김 — 기본 50줄. 조건·머리단 필터가 바뀌면 1쪽으로 (거른 목록 밖 쪽 번호가 남지 않게)
  const pager = usePager(shownTx, txLive.size,
    `${cardTxFrom}|${cardTxTo}|${txQ}|${JSON.stringify(txLive)}|${JSON.stringify(Object.fromEntries(Object.entries(colF).map(([k, v]) => [k, v ? [...v] : null])))}`);

  //   내 조건 — ★ 하나가 이 화면의 기본값이 된다 (DB 라 PC 를 바꿔도 따라온다)
  const savedTx = useSavedQueries("cards-tx", companyId);
  const txParamsNow = { from: cardTxFrom, to: cardTxTo, q: txQ, cond: txLive };
  const txParamsBasic = { ...defaultRange(), q: "", cond: CARD_EMPTY };
  const applySavedTx = (p: Record<string, unknown>) => {
    if (typeof p.from === "string" && typeof p.to === "string") { setCardTxFrom(p.from); setCardTxTo(p.to); }
    if (typeof p.q === "string") setTxQ(p.q);
    const c = { ...CARD_EMPTY, ...(p.cond as Partial<CardCond> | undefined) };
    setTxDraft(c); setTxLive(c);
  };
  const [txDefDone, setTxDefDone] = useState(false);
  useEffect(() => {
    if (txDefDone || !savedTx.isFetched) return;
    setTxDefDone(true);
    if (savedTx.def) applySavedTx(savedTx.def.params || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTx.isFetched, savedTx.def, txDefDone]);

  // 탭·조건·기간 변경 시 선택 초기화
  useEffect(() => { setSelectedTxIds(new Set()); }, [tab, cardTxFrom, cardTxTo, txQ, txLive]);

  const toggleTx = (id: string) => {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // 전체선택/일괄은 미처리(journal_entry_id 없음) 건만 대상.
  const selectableTx = shownTx.filter((tx: any) => !tx.journal_entry_id && !tx.ledger_excluded_reason);
  const allTxSelected = selectableTx.length > 0 && selectableTx.every((tx: any) => selectedTxIds.has(tx.id));
  const someTxSelected = selectableTx.some((tx: any) => selectedTxIds.has(tx.id)) && !allTxSelected;
  const toggleAllTx = () => {
    setSelectedTxIds((prev) => {
      if (selectableTx.every((tx: any) => prev.has(tx.id))) return new Set();
      return new Set(selectableTx.map((tx: any) => tx.id));
    });
  };

  // CODEF 카드 동기화 — /bank 의 handleSyncBank 와 동일 패턴(card 인자).
  const handleSyncCards = async () => {
    if (!companyId || syncing) return;
    setSyncing(true);
    try {
      const { syncCodefData } = await import("@/lib/data-sync");
      // CODEF 는 YYYYMMDD 형식만 받음 — 대시 포함(YYYY-MM-DD) 그대로 보내면 서버의 slice(0,6) 청구월 계산이 깨짐.
      const result = await syncCodefData(companyId, "card", cardTxFrom ? cardTxFrom.replace(/-/g, "") : undefined, cardTxTo ? cardTxTo.replace(/-/g, "") : undefined);
      if (!result.success && result.status !== "partial") {
        toast(result.error || "카드 연동 실패", "error");
        return;
      }
      markConnectedOnce(companyId, "card");
      // 승인내역(실시간) — 별도 호출 (billing 과 묶으면 Edge 150s 초과 HTTP 546). 청구 마감 전 결제 즉시 반영.
      const approvalRes = await syncCodefData(companyId, "card_approval", cardTxFrom ? cardTxFrom.replace(/-/g, "") : undefined, cardTxTo ? cardTxTo.replace(/-/g, "") : undefined).catch(() => null);
      const synced = (result.cardSynced ?? 0) + ((approvalRes as any)?.cardSynced ?? 0);
      // 카드 페이지 모든 카드 관련 쿼리 invalidate
      queryClient.invalidateQueries({ queryKey: ["cards-page-corporate"] });
      queryClient.invalidateQueries({ queryKey: ["cards-page-month-tx"] });
      queryClient.invalidateQueries({ queryKey: ["cards-page-card-tx"] });
      queryClient.invalidateQueries({ queryKey: ["cards-page-recent-tx"] });
      // 다른 페이지(transactions/dashboard 등)도 카드 변경 감지하게
      queryClient.invalidateQueries({ queryKey: ["card-transactions"] });
      queryClient.invalidateQueries({ queryKey: ["corporate-cards"] });
      try { window.dispatchEvent(new CustomEvent("ownerview:codef-synced")); } catch { /* ignore */ }
      // partial(일부 카드사 실패)의 errors 를 버리지 않는다 (2026-08-19): 종전엔 카드 2장이
      //   인증 오류로 실패해도 "새 거래 없음"으로 보여 수집 중단을 알 수 없었다.
      const cardErr = ((result.errors || [])[0] || ((approvalRes as any)?.errors || [])[0]) as { message?: string; hint?: string } | undefined;
      if (cardErr) toast(`카드 동기화 오류 — ${cardErr.message}${cardErr.hint ? ` · ${cardErr.hint}` : ""}`, "error");
      else if (synced > 0) toast(`카드 거래 ${synced}건 불러옴`, "success");
      else toast("카드 연동 완료 — 새 거래 없음", "info");

      // 동기화 후 카드 자동분류(비차단) — 학습규칙(learned_from_count≥1)만. UI 비차단, 매칭분 있을 때만 토스트+갱신.
      //   분류는 되돌림 가능(대외·비가역 아님) → '확정은 사람' 원칙 위배 없음. 반복 실행 시 대상 수렴.
      import("@/lib/automation")
        .then(({ applyCardTransactionRules }) => applyCardTransactionRules(companyId))
        .then((r) => {
          const n = r?.matched || 0;
          if (n > 0) {
            toast(`미분류 카드거래 ${n}건 자동분류 완료`, "success");
            queryClient.invalidateQueries({ queryKey: ["cards-page-month-tx"] });
            queryClient.invalidateQueries({ queryKey: ["cards-page-card-tx"] });
            queryClient.invalidateQueries({ queryKey: ["cards-page-recent-tx"] });
            queryClient.invalidateQueries({ queryKey: ["card-transactions"] });
          }
        })
        .catch(() => { /* 자동분류 실패는 비차단 — 수동 분류로 진행 가능 */ });
    } catch (e) {
      toast(friendlyError(e, "카드 연동 오류"), "error");
    } finally {
      setSyncing(false);
    }
  };

  // 카드명 인라인 편집 저장(corporate_cards.card_name UPDATE).
  const handleSaveName = async (cardId: string) => {
    const trimmed = editingName.trim();
    setEditingCardId(null);
    if (!trimmed) { setEditingName(""); return; }
    try {
      const { error } = await db.from("corporate_cards").update({ card_name: trimmed }).eq("id", cardId);
      if (error) throw error;
      toast("카드명 변경됨", "success");
      queryClient.invalidateQueries({ queryKey: ["cards-page-corporate"] });
      queryClient.invalidateQueries({ queryKey: ["corporate-cards"] });
    } catch (e) {
      toast(friendlyError(e, "카드명 변경 실패"), "error");
    } finally {
      setEditingName("");
    }
  };

  // 카드 그리드 클릭 → 그 카드의 거래내역 영역으로 스크롤 + filter
  const handleSelectCardForTx = (card: any, idx: number) => {
    setSelectedCardIdx(idx);
    if (card.id) {
      setSelectedCardId(card.id);
      setSelectedCardName("");
    } else {
      setSelectedCardId("");
      setSelectedCardName(card.card_name || "");
    }
    setTimeout(() => {
      document.getElementById("card-tx-detail")?.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  };

  const selectedCardLabel = selectedCardId
    ? (cards.find((c: any) => c.id === selectedCardId)?.card_name || "선택 카드")
    : selectedCardName || "";

  /*  ── 조회 화면 표준 — 조회 줄에 쓰는 값들 (2026-08-14) ── */
  //   카드는 회사 전체 목록(등록 카드 + 거래에만 있는 이름). 가맹점·분류는 이 기간에 실제로 나온 것만.
  const cardOptMap = new Map<string, string>();
  for (const c of cards as any[]) cardOptMap.set(String(c.id || c.card_name), String(c.card_name || "카드"));
  for (const t of recentTx as any[]) if (!t.card_id && t.card_name && !cardOptMap.has(t.card_name)) cardOptMap.set(t.card_name, t.card_name);
  const cardOpts = [...cardOptMap.entries()].map(([value, label]) => ({ value, label }));
  const cardLabelOf = (v: string) => cardOptMap.get(v) ?? v;
  const merchOpts = [...new Set((recentTx as any[]).map((t) => t.merchant_name).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), "ko")).map((m) => ({ value: String(m), label: String(m) }));
  const clsOpts = [...new Set((recentTx as any[]).map((t) => classificationLabel(t.classification) || t.category || "미분류"))]
    .sort((a, b) => String(a).localeCompare(String(b), "ko")).map((c) => ({ value: String(c), label: String(c) }));
  //   걸린 조건 칩 — 패널을 열지 않고도 알고, ✕ 로 하나씩 뺀다
  const dropTx = (patch: Partial<CardCond>) => { const c = { ...txLive, ...patch }; setTxLive(c); setTxDraft(c); };
  const txChips: AppliedChip[] = [
    ...quickTerms(txQ).map((t, i) => ({
      group: "빠른검색", label: t,
      onRemove: () => setTxQ(quickTerms(txQ).filter((_, j) => j !== i).join(", ")),
    })),
    ...txLive.cards.map((v) => ({ group: "카드", label: cardLabelOf(v), onRemove: () => dropTx({ cards: txLive.cards.filter((x) => x !== v) }) })),
    ...txLive.merch.map((v) => ({ group: "가맹점", label: v, onRemove: () => dropTx({ merch: txLive.merch.filter((x) => x !== v) }) })),
    ...txLive.cls.map((v) => ({ group: "분류", label: v, onRemove: () => dropTx({ cls: txLive.cls.filter((x) => x !== v) }) })),
    ...(txLive.state !== "todo" ? [{
      group: "상태", label: CARD_STATE_CHIPS.find((s) => s.value === txLive.state)?.label ?? txLive.state,
      onRemove: () => dropTx({ state: "todo" as const }),
    }] : []),
    ...((txLive.min || txLive.max) ? [{
      group: "금액",
      label: `${Number(txLive.min || 0).toLocaleString("ko-KR")} ~ ${txLive.max ? Number(txLive.max).toLocaleString("ko-KR") : "제한없음"}`,
      onRemove: () => dropTx({ min: "", max: "" }),
    }] : []),
  ];
  //   카드는 음수 = 취소/환불 — 사용과 취소를 섞어 합치면 숫자가 거짓말을 한다. 갈라 센다.
  const sumUse = shownTx.filter((t) => Number(t.amount || 0) >= 0).reduce((s, t) => s + Number(t.amount || 0), 0);
  const sumRefund = shownTx.filter((t) => Number(t.amount || 0) < 0).reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);
  const selSumTx = shownTx.filter((t) => selectedTxIds.has(t.id)).reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);
  /** 고른 조건으로 이름을 지어 준다 ('내 조건' 저장) */
  const suggestTxName = () => {
    const p: string[] = [];
    if (txDraft.cards.length) p.push(cardLabelOf(txDraft.cards[0]) + (txDraft.cards.length > 1 ? ` 외 ${txDraft.cards.length - 1}` : ""));
    if (txDraft.merch.length) p.push(txDraft.merch[0]);
    if (txDraft.cls.length) p.push(txDraft.cls[0]);
    if (txDraft.state !== "all") p.push(CARD_STATE_CHIPS.find((s) => s.value === txDraft.state)?.label ?? "");
    if (txDraft.min || txDraft.max) p.push("금액");
    return p.filter(Boolean).slice(0, 3).join(" · ") || "내 조건";
  };
  const txExcelItems: ExcelItem[] = [
    { label: "조회 결과 전부 내려받기", count: shownTx.length,
      hint: "지금 걸린 조건 그대로 · 표에 보이는 칸 그대로", onClick: () => exportCardCsv(shownTx) },
    { label: "지금 쪽만 내려받기", count: pager.view.length,
      hint: `${pager.from}–${pager.to}번째 줄만`, onClick: () => exportCardCsv(pager.view, `_${pager.page}쪽`) },
  ];

  //   갈래 탭은 상자 안 파란 밑줄 · 실행 버튼은 조회 줄 오른쪽 (2026-08-18 조회 표준 확산)
  const tabsEl = (
    <div className="collect-tabs no-print">
      {([
        { k: "cards", l: "카드" },
        { k: "transactions", l: "거래내역" },
        { k: "analysis", l: "분석" },
      ] as { k: Tab; l: string }[]).map((t) => (
        <button key={t.k} type="button" onClick={() => setTab(t.k)} className={tab === t.k ? "collect-tab collect-tab-on" : "collect-tab"}>{t.l}</button>
      ))}
    </div>
  );
  const actionsEl = (
    <>
        
        <button
          type="button"
          onClick={() => {
            // 즉시 동기화는 유료 전용 (통장 화면과 동일 규약) — 자동 하루 2회는 무료도 받는다.
            if (cardSync && !cardSync.manualAllowed) {
              toast("무료 요금제는 즉시 동기화를 쓸 수 없습니다. 통장·카드는 하루 2회(오전 9시·오후 6시) 자동으로 동기화되고, 원할 때 바로 불러오려면 요금제를 시작해 주세요.", "info");
              return;
            }
            if (!cardTxFrom || !cardTxTo) { toast("카드 거래 기간(시작일·종료일)을 먼저 설정한 뒤 연동하세요 — 기간 없이 연동하면 새 거래 없이 쿨타임만 시작됩니다", "error"); return; }
            cardCd.run(handleSyncCards);
          }}
          // 무료는 disabled 로 막지 않는다 — 눌렀을 때 안내가 떠야 한다(통장 화면과 동일)
          disabled={syncing || !companyId || cardCd.disabled}
          className={`btn-primary btn-sm ${cardCd.disabled || (cardSync && !cardSync.manualAllowed) ? "!opacity-40 cursor-not-allowed" : ""}`}
          title={cardSync && !cardSync.manualAllowed ? "무료 요금제는 즉시 동기화를 쓸 수 없습니다 — 하루 2회 자동 동기화는 그대로 됩니다" : cardCd.hint ? cardCd.hint : "카드 거래 기간을 설정한 뒤 CODEF 카드 연동으로 그 기간의 카드 거래를 불러옵니다"}
        >
          {syncing ? "연동 중…" : cardCd.disabled ? cardCd.label : "카드 연동"}
        </button>
    </>
  );
  //   조회 줄 오른쪽 = [금액 숨김 · 카드 연동] 한 줄 — 통장([연동 정지 · 통장 연동])과 같은 배치 (2026-08-20 사장님: 위아래로 쌓여 통일감 없음)
  const actionsRow = (
    <>
      {tab === "cards" && (
        <button type="button" onClick={() => setShowBalance((v) => !v)} className="btn-secondary btn-sm">{showBalance ? "금액 숨김" : "금액 보기"}</button>
      )}
      {actionsEl}
    </>
  );

  return (
    /*  거래내역(조회 화면) 탭은 qk-shell 세로 기둥 — qk-body 가 남는 높이를 받아 표가 그 안에서
        스크롤된다 (세금·증빙·통장과 같은 방식). 다른 탭은 예전처럼 문서 흐름 그대로. */
    <div className="qk-shell">
      {/* 컴팩트 툴바 — 탭(좌) + 카드 연동(우). 타이틀은 상단 고정 헤더바가 담당 */}
{/* 갈래 탭·실행 버튼은 각 탭 상자 머리에 (tabsEl / actionsEl) */}

      {tab !== "transactions" && (
        <QueryScreen>
          <QueryHead>
            {tabsEl}
            <QueryBar right={actionsRow}>
              {/* 기간 — 조회 줄에 하나(2026-08-18). 카드 탭에서 카드 선택 시 그 카드 거래·연동 기간에 적용. 거래내역 탭은 자기 조회 줄에 기간 칸이 있다 */}
              <DateRangeField label="카드 거래 기간" from={cardTxFrom} to={cardTxTo}
                onChange={(f, t) => { setCardTxFrom(f); setCardTxTo(t); }} />
              {tab === "cards" && cards.length > 0 && <ChipGroup value={cardsView} onChange={setCardsView} options={[{ value: "list", label: "리스트" }, { value: "card", label: "카드" }] as const} />}
              {tab === "cards" && cards.some((c: any) => c.is_active === false) && (
                <button type="button" onClick={() => setShowHiddenCards((v) => !v)} className={showHiddenCards ? "qk-quick qk-quick-on" : "qk-quick"}>숨긴 카드 {cards.filter((c: any) => c.is_active === false).length}개 {showHiddenCards ? "감추기" : "보기"}</button>
              )}
              <span className="text-[11px] text-[var(--text-dim)]">카드를 선택하면 해당 카드 거래에 적용 · 거래를 조건으로 찾으려면 거래내역 탭</span>
            </QueryBar>
            {/* 분석 탭 결과 요약 — 예전 Stat 카드 4장 → Stat 줄 (2026-08-19 자금 메뉴 점검) */}
            {tab === "analysis" && (
              <ResultStrip>
                <QStat label="총 사용액 (이번 달)" value={fmtW(totalUsage)} tone="minus" />
                <QStat label="사용 가능 한도" value={hasLimits ? <>{fmtW(Math.max(0, totalLimit - totalUsage))} <small className="font-normal text-[var(--text-dim)]">/ 총 한도 {fmtW(totalLimit)}</small></> : <span className="text-[var(--text-dim)]">한도 정보 없음</span>} />
                <QStat label="활성 카드" value={<>{activeCards}개 <small className="font-normal text-[var(--text-dim)]">등록 {cards.length}개</small></>} />
                <QStat label="이번 달 거래" value={`${monthTx.length}건`} />
              </ResultStrip>
            )}
            {tab === "cards" && currentCard && (
              <ResultStrip>
                <QStat label="선택한 카드" value={<>{currentCard.card_name || "카드"} <small className="font-normal text-[var(--text-dim)]">{cardTypeLabel(currentCard.card_type)} · {cardNoDisplay(currentCard.card_number)} · 결제일 {currentCard.payment_day ? `매월 ${currentCard.payment_day}일` : "—"}</small></>} />
                <QStat label="이번 달" value={<>{showBalance ? fmtW(currentSpend) : "••••••"} <small className="font-normal text-[var(--text-dim)]">{currentTxCount}건{Number(currentCard.monthly_limit || 0) > 0 && showBalance ? ` / 한도 ${fmtW(Number(currentCard.monthly_limit))}` : ""}</small></>} />
              </ResultStrip>
            )}
          </QueryHead>
          <QueryBody>
            <div className="bank-scroll">

      {/* ========== 카드 탭 ========== */}
      {tab === "cards" && (
        cards.length === 0 ? (
          <EmptyState
            card
            icon="💳"
            title="등록된 카드가 없습니다"
            desc="상단의 카드 연동 버튼으로 CODEF 카드 동기화를 실행하면 자동 등록됩니다"
          />
        ) : (
          <div className="space-y-6">
            {/* 카드 미니 그리드 — 클릭 시 그 카드 거래내역 영역으로 스크롤+필터 */}
            {cardsView === "list" ? (
              <table className="ev-table ev-lined cards-table">
                <thead><tr><th className="text-left">카드</th><th>종류</th><th>끝번호</th><th>카드사</th><th className="text-left">메모</th><th>결제일</th><th>한도</th><th>동작</th></tr></thead>
                <tbody>
                  {cards.map((card: any, idx: number) => ({ card, idx })).filter(({ card }) => showHiddenCards || card.is_active !== false).map(({ card, idx }) => (
                    <tr key={card.id} className={`pnl-row-acct ${idx === selectedCardIdx ? "cards-row-on" : ""} ${card.is_active === false ? "opacity-60" : ""}`} onClick={() => handleSelectCardForTx(card, idx)} title="누르면 이 카드 거래내역">
                      <td className="text-left font-semibold">{card.card_name || "카드"}{card.is_active === false && <span className="ol-sure ml-1.5">숨김</span>}</td>
                      <td className="text-center"><span className={`px-2 py-0.5 rounded-md text-[10px] font-bold ${cardTypeBadgeClass(card.card_type)}`}>{cardTypeLabel(card.card_type)}</span></td>
                      <td className="text-center mono-number text-[var(--text-muted)] whitespace-nowrap">{cardNoDisplay(card.card_number)}</td>
                      <td className="text-center text-[var(--text-muted)]">{card.card_company || "—"}</td>
                      <td className="text-left text-[var(--text-muted)]">{card.memo ? <span className="truncate inline-block max-w-[200px]" title={card.memo}>{card.memo}</span> : <span className="text-[var(--text-dim)]">—</span>}</td>
                      <td className="text-center">{card.payment_day ? `매월 ${card.payment_day}일` : "—"}</td>
                      <td className="text-right mono-number">{Number(card.monthly_limit || 0) > 0 ? fmtW(Number(card.monthly_limit)) : "—"}</td>
                      <td className="text-center" onClick={(e) => e.stopPropagation()}>
                        <span className="inline-flex gap-1.5">
                          <button type="button" onClick={() => setCardEdit({ id: card.id, name: card.card_name || "", memo: card.memo || "", number: card.card_number || "" })} className="btn-secondary btn-sm">수정</button>
                          <button type="button" onClick={() => toggleCardHidden(card)} className="btn-secondary btn-sm">{card.is_active === false ? "보이기" : "숨김"}</button>
                          <button type="button" onClick={() => removeCard(card)} className="btn-secondary btn-sm text-[var(--danger)]">삭제</button>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            ) : (
            <div className="card-mini-grid-section">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {cards.map((card: any, idx: number) => ({ card, idx })).filter(({ card }) => showHiddenCards || card.is_active !== false).map(({ card, idx }) => (
                  <MiniCard
                    key={card.id}
                    card={card}
                    selected={idx === selectedCardIdx}
                    onClick={() => handleSelectCardForTx(card, idx)}
                    isEditing={editingCardId === card.id}
                    editingName={editingName}
                    onStartEdit={() => { setEditingCardId(card.id); setEditingName(card.card_name || ""); }}
                    onEditChange={setEditingName}
                    onSaveEdit={() => handleSaveName(card.id)}
                    onCancelEdit={() => { setEditingCardId(null); setEditingName(""); }}
                  />
                ))}
              </div>
            </div>
            )}

            {/* 카드 선택 시에만 그 카드 거래내역 노출. 닫기 → 영역 자체 hide.
                전체 카드 거래는 별도 거래내역 탭에서 제공하므로 미선택 시 영역 없음. */}
            {(selectedCardId || selectedCardName) && (
              <section id="card-tx-detail" className="card-tx-detail-panel pnl-panel">
                {/* 2026-08-19 정리 — 큰 제목·정렬 칩·유리 줄 카드 → 얇은 판 + 표(머리단 정렬) */}
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="!mb-0">{selectedCardLabel} 거래내역 <small className="font-normal text-[var(--text-dim)]">{cardTx.length}건 · {cardTxFrom || cardTxTo ? "위 카드 거래 기간" : "전체 기간"}</small></h3>
                  <span className="ml-auto flex items-center gap-1.5">
                    <input value={cardTxSearch} onChange={(e) => setCardTxSearch(e.target.value)} placeholder="가맹점·계정·사유·태그·직원" className="qk-input h-8 w-56 px-2.5 text-xs" />
                    <button type="button" onClick={() => { setSelectedCardId(""); setSelectedCardName(""); setCardTxFrom(""); setCardTxTo(""); }} className="btn-secondary btn-sm">닫기</button>
                  </span>
                </div>
                {shownCardTx.length === 0 ? (
                  <div className="collect-empty mt-2">{(cardTxFrom || cardTxTo) ? "이 기간에 거래내역이 없습니다" : "이 카드의 거래내역이 없습니다"} — 기간을 조정하거나 카드 연동으로 거래를 불러오세요</div>
                ) : (
                  <div className="ev-scroll mt-2 max-h-[560px]"><table className="ev-table ev-lined card-tx-table">
                    <thead>
                      <tr>
                        {([["transaction_date", "날짜"], ["merchant_name", "가맹점"], ["category", "계정과목"], ["card_name", "카드"]] as [string, string][]).map(([k, l]) => (
                          <th key={k} className={k === "merchant_name" ? "text-left" : ""}>
                            <button type="button" className="ev-th-btn" onClick={() => { if (cardSortKey === k) setCardSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setCardSortKey(k); setCardSortDir(k === "transaction_date" ? "desc" : "asc"); } }}>
                              {l}{cardSortKey === k ? (cardSortDir === "asc" ? " ▲" : " ▼") : ""}
                            </button>
                          </th>
                        ))}
                        <th>사용자 · 태그 · 메모</th>
                        <th><button type="button" className="ev-th-btn" onClick={() => { if (cardSortKey === "amount") setCardSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setCardSortKey("amount"); setCardSortDir("desc"); } }}>금액{cardSortKey === "amount" ? (cardSortDir === "asc" ? " ▲" : " ▼") : ""}</button></th>
                        <th>전표</th>
                      </tr>
                    </thead>
                    <tbody>
                      {shownCardTx.map((tx: any) => (
                        <tr key={tx.id}>
                          <td className="text-center mono-number">{tx.transaction_date}{tx.transaction_time ? <small className="ml-1 text-[var(--text-dim)]">{String(tx.transaction_time).slice(0, 5)}</small> : null}</td>
                          <td className="text-left font-semibold">{tx.merchant_name || "(가맹점 미상)"}</td>
                          <td className="text-center text-[var(--text-muted)]">{classificationLabel(tx.classification) || tx.category || "미분류"}</td>
                          <td className="text-center text-[var(--text-muted)]">{tx.card_name || "카드"}</td>
                          <td className="text-left">
                            <span className="inline-flex flex-wrap items-center gap-1">
                              {tx.used_by_employee_id && empNameById[tx.used_by_employee_id] && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-medium">{empNameById[tx.used_by_employee_id]}</span>}
                              {(tx.tags || []).map((t: string) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)]">#{t}</span>)}
                              {tx.memo && <span className="text-[10.5px] text-[var(--text-dim)] truncate max-w-[220px]" title={tx.memo}>{tx.memo}</span>}
                              {!tx.used_by_employee_id && !(tx.tags && tx.tags.length) && !tx.memo && <span className="text-[var(--text-dim)]">—</span>}
                            </span>
                          </td>
                          <td className={`text-right mono-number font-bold ${Number(tx.amount || 0) < 0 ? "text-[var(--success)]" : ""}`}>{Number(tx.amount || 0) < 0 ? "+" : "−"}₩{Math.abs(Number(tx.amount || 0)).toLocaleString("ko-KR")}<ForeignBadge tx={tx} /></td>
                          <td className="text-center">{tx.journal_entry_id ? <span className="ol-sure ol-sure-ok">전표처리됨</span> : tx.ledger_excluded_reason ? <span className="ol-sure" title={excludeLabelOf(tx.ledger_excluded_reason)}>장부 제외</span> : <button type="button" onClick={() => openPost(tx)} className="btn-secondary btn-sm">전표처리</button>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table></div>
                )}
              </section>
            )}
          </div>
        )
      )}

      {/* ========== 거래내역 탭 — 조회 화면 표준 (2026-08-14 사장님: "수집·전표탭의 디자인처럼").
          조회 줄·걸린 조건·결과 요약·표·쪽 넘김을 **한 상자**에. 예전의 검색 input + 카드 select +
          정렬 툴바 + 선택 액션바 낱장 구성을 버렸다 — 카드 필터는 검색조건의 '카드' 칩으로,
          정렬은 머리단으로, 선택은 바닥 SelectionBar 로. ========== */}
      {/* ========== 분석 탭 ========== */}
      {/* 이번 달 일별 승인·카드별 비중·가맹점 상위 — 재무 › 현황에서 옮겨 옴 (2026-08-26 사장님: "카드 부분은 카드의 분석 쪽으로") */}
      {tab === "analysis" && <CardStatusPanels companyId={companyId} from={monthRange.from} to={monthRange.to} />}
      {tab === "analysis" && (
        <div className="card-analysis-tab-panel">
          {/* 카테고리별 지출 */}
          <div className="card-category-spending-panel pnl-panel">
            <h3>카테고리별 지출 (상위 5)</h3>
            <p>이번 달 카드 지출을 어디에 썼나 — 비중은 도넛, 금액은 아래 목록</p>
            {/* '어디에 얼마 비중' 을 묻는 자리다(줄마다 %가 붙어 있다) → 비중은 도넛이 한눈에,
                정확한 금액은 아래 목록이 맡는다 (2026-08-07 자료별 최적 형태 판정) */}
            {categoryStats.length === 0 ? (
              <p className="text-sm text-[var(--text-muted)] text-center py-4">이번 달 카드 지출 없음</p>
            ) : (<>
              <div className="lp-donut-wrap">
                <DonutChart unit="원" data={categoryStats.map((c) => ({ label: c.name, value: c.amount }))} />
                <Legend items={categoryStats.map((c, i) => ({ name: c.name, color: vizColor(i) }))} />
              </div>
              <div className="space-y-3">
                {categoryStats.map((c, i) => (
                  <div key={c.name} className="card-category-row">
                    <div className="w-20 sm:w-28 text-sm text-[var(--text-muted)] truncate shrink-0">
                      <i className="lp-dot" style={{ background: vizColor(i) }} />{c.name}
                    </div>
                    <div className="flex-1">
                      <div className="w-full bg-[var(--bg-surface)] rounded-md h-3 overflow-hidden">
                        <div className="h-3 rounded-r-md" style={{ width: `${c.pct}%`, background: vizColor(i) }} />
                      </div>
                    </div>
                    <div className="w-32 text-right shrink-0">
                      <p className="text-sm font-semibold text-[var(--text)] mono-number">{fmtW(c.amount)}</p>
                      <p className="text-xs text-[var(--text-dim)]">{c.pct}%</p>
                    </div>
                  </div>
                ))}
              </div>
            </>)}
          </div>

          {/* 기존 컴포넌트 재사용 — 시안 분석 탭에 자연스럽게 녹임 */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <TopCardExpensesThisMonth companyId={companyId} />
            <CardAutoTransferHistory companyId={companyId} />
          </div>
          <CardBillingSummary companyId={companyId} />
          <CardMonthlyUsage companyId={companyId} />
        </div>
      )}


            </div>
          </QueryBody>
        </QueryScreen>
      )}

      {tab === "transactions" && (
        <QueryScreen>
        <QueryHead>
        {tabsEl}
        {/* ── 1줄 · 조회 조건 — 기간·빠른검색은 즉시, 검색조건은 '조회'를 눌러 ── */}
        <QueryBar right={<><ExcelMenu items={txExcelItems} />{actionsEl}</>}>
          {/*   ★ 기간을 치는 칸은 화면에 하나뿐이다. 달력은 검색조건 안에 있다. */}
          <DateRangeField from={cardTxFrom} to={cardTxTo} label={null} parts="segments"
            onChange={(f, t) => { setCardTxFrom(f); setCardTxTo(t); }}
            trailing={
              <ConditionPanel open={txPanelOpen} onOpenChange={setTxPanelOpen} activeCount={cardCondCount(txLive)} anchorSel=".drf"
                tabs={<SavedTabs list={savedTx.list} current={txParamsNow} basic={txParamsBasic}
                  onApply={(s) => { applySavedTx(s.params || {}); setTxPanelOpen(false); }}
                  onBasic={() => { const r = defaultRange(); setCardTxFrom(r.from); setCardTxTo(r.to); setTxQ(""); setTxDraft(CARD_EMPTY); setTxLive(CARD_EMPTY); }}
                  onRemove={savedTx.remove} onSetDefault={savedTx.setDefault} />}
                foot={<>
                  <button type="button" className="btn-secondary btn-sm" disabled={cardCondCount(txDraft) === 0}
                    onClick={() => setTxDraft({ ...CARD_EMPTY, size: txDraft.size })}>조건 지우기</button>
                  <ConditionSave suggest={suggestTxName}
                    onSave={(name, asDefault) => {
                      savedTx.save(name, { from: cardTxFrom, to: cardTxTo, q: txQ, cond: txDraft }, asDefault);
                      setTxLive(txDraft); setTxPanelOpen(false);
                    }} />
                  <span className="ml-auto text-[11px] text-[var(--text-dim)]">{previewCount.toLocaleString("ko-KR")}건</span>
                  <RowsPerPage value={txDraft.size} onChange={setTxD("size")} />
                  <button type="button" className="btn-primary btn-sm"
                    onClick={() => { setTxLive(txDraft); setTxPanelOpen(false); }}>조회</button>
                </>}>
                <ConditionRow label="조회기간" hint="기본 1개월">
                  <span className="qk-range-txt">{cardTxFrom} ~ {cardTxTo}</span>
                  <DateRangeField from={cardTxFrom} to={cardTxTo} label={null} parts="calendar" confirm
                    onChange={(f, t) => { setCardTxFrom(f); setCardTxTo(t); }} />
                  <span className="qk-quicks">
                    {periodQuicks().map((p) => (
                      <button key={p.key} type="button" onClick={() => { setCardTxFrom(p.from); setCardTxTo(p.to); }}
                        className={cardTxFrom === p.from && cardTxTo === p.to ? "qk-quick qk-quick-on" : "qk-quick"}>{p.label}</button>
                    ))}
                  </span>
                </ConditionRow>
                <ConditionRow label="카드" hint="여러 장">
                  <TokenField items={cardOpts} value={txDraft.cards} onChange={setTxD("cards")}
                    placeholder="카드 이름 일부 (예: 법인)" />
                </ConditionRow>
                <ConditionRow label="가맹점" hint="여러 곳">
                  <TokenField items={merchOpts} value={txDraft.merch} onChange={setTxD("merch")}
                    placeholder="가맹점 이름 일부 (예: 카카오)" />
                </ConditionRow>
                <ConditionRow label="분류" hint="여러 개">
                  <TokenField items={clsOpts} value={txDraft.cls} onChange={setTxD("cls")}
                    placeholder="분류(계정과목) 이름 일부" />
                </ConditionRow>
                <ConditionRow label="상태">
                  <ChipGroup value={txDraft.state} onChange={setTxD("state")} options={CARD_STATE_CHIPS} />
                </ConditionRow>
                <ConditionRow label="금액" hint="취소(음수)도 절대값으로 봅니다">
                  <AmountRange min={txDraft.min} max={txDraft.max} onMin={setTxD("min")} onMax={setTxD("max")} />
                </ConditionRow>
              </ConditionPanel>
            } />
          <QuickSearch value={txQ} onApply={setTxQ}
            placeholder="가맹점 · 카드 · 분류 · 금액 — 쉼표로 여러 개, Enter" />
        </QueryBar>

        <AppliedChips chips={txChips} onClearAll={() => { setTxQ(""); setTxLive(CARD_EMPTY); setTxDraft(CARD_EMPTY); }} />

        {/* ── 2줄 · 결과 요약 — 목록을 바꾸지 않는 것만 ── */}
        <ResultStrip>
          <QStat label="건수" value={`${shownTx.length.toLocaleString("ko-KR")}건`} />
          <QStat label="사용" value={fmtW(sumUse)} tone="minus" />
          {sumRefund > 0 && <QStat label="취소·환불" value={fmtW(sumRefund)} tone="plus" />}
          {recentTx.length >= 2000 && <b className="ev-cut">너무 많아 앞 2,000건만 받아왔습니다 — 기간을 좁혀 주세요</b>}
        </ResultStrip>
        </QueryHead>

        {/* 목록 — 선택 바가 이 위로 떠오른다 (표 크기는 안 줄어들게) */}
        <QueryBody>
        <div className="ev-scroll">
              {/* 공용 표준 — 메뉴마다 다르던 표 밀도를 하나로 (2026-08-12).
                  깔때기·너비 손잡이·머리단 세로선(.ev-lined)은 수집·전표 표와 같은 부품 (2026-08-14 사장님) */}
              <table ref={tableRef} className="data-table w-full ev-lined">
                <thead className="sticky-bar">
                  <tr className="table-head-row">
                    <th className="w-10">
                      <input
                        type="checkbox"
                        checked={allTxSelected}
                        ref={(el) => { if (el) el.indeterminate = someTxSelected; }}
                        onChange={toggleAllTx}
                        aria-label="전체 선택"
                        className="h-4 w-4 cursor-pointer accent-[var(--primary)]"
                      />
                    </th>
                    <SortableTh label="가맹점" sortKey="merchant_name" sort={{ key: sortKey ?? "", dir: sortDir }} onSort={onSortTx} filter={thFilter("merchant")} resize={thResize("merchant", 1)} />
                    <SortableTh label="분류" sortKey="classification" sort={{ key: sortKey ?? "", dir: sortDir }} onSort={onSortTx} filter={thFilter("classification")} resize={thResize("classification", 2)} />
                    <SortableTh label="카드" sortKey="card_name" sort={{ key: sortKey ?? "", dir: sortDir }} onSort={onSortTx} filter={thFilter("card")} resize={thResize("card", 3)} />
                    <SortableTh label="금액" sortKey="amount" sort={{ key: sortKey ?? "", dir: sortDir }} onSort={onSortTx} filter={thFilter("amount")} resize={thResize("amount", 4)} />
                    <SortableTh label="날짜" sortKey="transaction_date" sort={{ key: sortKey ?? "", dir: sortDir }} onSort={onSortTx} filter={thFilter("date")} resize={thResize("date", 5)} />
                  </tr>
                </thead>
                <tbody>
                  {shownTx.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-3 py-2.5">
                        <EmptyState icon="💳" title={txChips.length > 0 ? "걸린 조건에 맞는 거래가 없습니다" : "이 기간에 카드 거래가 없습니다"} desc="상단의 카드 연동으로 거래를 불러올 수 있습니다" />
                      </td>
                    </tr>
                  ) : pager.view.map((tx: any) => {
                    const checked = selectedTxIds.has(tx.id);
                    const posted = !!tx.journal_entry_id;
                    const cat = classificationLabel(tx.classification) || tx.category || "미분류";
                    return (
                      <tr key={tx.id} className={`card-tx-table-row ${checked ? "bg-[var(--primary)]/5" : ""}`}>
                        <td className="w-10">
                          <input
                            type="checkbox"
                            checked={checked}
                            disabled={posted}
                            onChange={() => toggleTx(tx.id)}
                            onClick={(e) => e.stopPropagation()}
                            aria-label="거래 선택"
                            title={posted ? "전표처리됨" : undefined}
                            className="h-4 w-4 cursor-pointer accent-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                          />
                        </td>
                        <td className="px-3 py-2.5">
                          <div className="flex items-center gap-3">
                            <div className="w-7 h-7 rounded-full bg-[var(--bg-surface)] flex items-center justify-center text-[13px] shrink-0">
                              <Ico e={categoryEmoji(classificationLabel(tx.classification) || tx.category)} />
                            </div>
                            <span className="font-medium text-[var(--text)] truncate">{tx.merchant_name || "(가맹점 미상)"}</span>
                          </div>
                        </td>
                        <td className="px-3 py-2.5 text-[12.5px] text-[var(--text-muted)]">{cat}</td>
                        <td className="px-3 py-2.5 text-[12.5px] text-[var(--text-muted)]">{tx.card_name || "카드"}</td>
                        <td className={`px-3 py-2.5 font-semibold mono-number text-right ${Number(tx.amount || 0) < 0 ? "text-[var(--success)]" : "text-[var(--text)]"}`}>{Number(tx.amount || 0) < 0 ? "+" : "-"}₩{Math.abs(Number(tx.amount || 0)).toLocaleString("ko-KR")}<ForeignBadge tx={tx} /></td>
                        <td className="px-3 py-2.5 text-[12.5px] text-[var(--text-muted)] mono-number">
                          {tx.transaction_date}
                          {/* 승인 시각 — 승인내역이 준 건만 있다. 청구내역만 있는 건(옛 데이터·일부 카드사)은 날짜만. */}
                          {tx.transaction_time && <span className="ml-1.5 text-[11px] text-[var(--text-dim)]">{String(tx.transaction_time).slice(0, 5)}</span>}
                          {posted && <span className="ml-1.5 inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--success-dim)] text-[var(--success)]">전표처리됨</span>}
                          {!posted && tx.ledger_excluded_reason && <span className="ml-1.5 inline-flex items-center gap-1"><span className="ol-sure" title={excludeLabelOf(tx.ledger_excluded_reason)}>장부 제외 · {excludeLabelOf(tx.ledger_excluded_reason).split(" · ")[0]}</span><button type="button" onClick={() => unexcludeCard(tx.id)} className="btn-secondary btn-sm">해제</button></span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
        </div>

        {/* ── 3줄 · 고른 줄로 하는 일 — 파란(확정) 버튼은 여기 하나 ── */}
        <SelectionBar count={selectedTxIds.size} onClear={() => setSelectedTxIds(new Set())}
          summary={<>합계 <b className="mono-number">{fmtW(selSumTx)}</b> · 이미 처리된 건은 건너뜁니다</>}>
          <button type="button" onClick={excludeSelectedCards} className="btn-secondary btn-sm" title="전표 없이 끝낸 것으로 — 중복·이체·개인 지출">장부 제외</button>
          <button type="button" onClick={() => { setBulkAccountId(""); setShowBulkPost(true); }}
            className="btn-primary btn-sm">전표처리({selectedTxIds.size})</button>
        </SelectionBar>
        </QueryBody>

        {/* ── 쪽 넘김 — 기본 50줄, 더 보려면 검색조건의 '조회 줄 수'를 올린다 ── */}
        <Pager page={pager.page} pages={pager.pages} total={shownTx.length} size={txLive.size}
          from={pager.from} to={pager.to} onPage={pager.setPage} />
        </QueryScreen>
      )}


      {/* 전표처리 모달 — 카드 1건을 수동으로 전표 생성 (회사별 매핑 기본계정 제안) */}
      {postCard && (
        <div className="card-post-voucher-modal fixed inset-0" onClick={() => setPostCard(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <div className="text-sm font-bold text-[var(--text)]">전표처리</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{postCard.merchant_name || "(가맹점 미상)"} · {postCard.transaction_date} · {Number(postCard.amount || 0) < 0 ? <span className="text-[var(--success)]">+₩{Math.abs(Number(postCard.amount || 0)).toLocaleString("ko-KR")} (취소/환불)</span> : `₩${Math.abs(Number(postCard.amount || 0)).toLocaleString("ko-KR")}`}</div>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">계정과목 *{postCard.category ? ` (분류: ${postCard.category})` : ""}</label>
                {/*   검색(이름·코드)해서 고른다 — 계정 90개를 스크롤로 찾지 않는다 (2026-08-27 사장님).
                      전표입력과 동일하게 전체 계정과목 사용. 비용이 아닌 계정은 이름 뒤에 성격을 적는다 (2026-08-10) */}
                <AccountPicker accounts={accounts as any[]} value={postAccountId} onChange={(id) => setPostAccountId(id)} natureLabel={cardNatureLabel} />
                {mappingByCategory[postCard.category] && <p className="text-[10px] text-[var(--text-dim)] mt-1">이 분류의 기본 계정이 적용되었습니다.</p>}
                {(() => {
                  //   여기서 고른 계정이 곧 손익계산서에서 이 카드 지출이 앉을 자리다 — 성격이 비용이 아니면 알린다
                  const picked = (accounts as any[]).find((a) => a.id === postAccountId);
                  if (!picked || picked.account_type === "expense") return null;
                  return (
                    <p className="card-acct-nature-hint">
                      {picked.name}은(는) <b>{cardNatureLabel(picked.account_type)} 계정</b>입니다 — 손익계산서 비용이 아니라 재무상태표 항목으로 처리됩니다.
                    </p>
                  );
                })()}
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--text)]">
                <input type="checkbox" checked={postRemember} onChange={(e) => setPostRemember(e.target.checked)} />
                이 분류({postCard.category || "미분류"})의 기본 계정으로 기억 (다음부터 자동 제안)
              </label>
              <label className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer" title="매월 반복되는 지출이면 체크 — 카드 자동이체(정기결제) 내역으로 분류되고 다음 전표처리 때 체크가 유지됩니다">
                <input type="checkbox" checked={postFixed} onChange={(e) => setPostFixed(e.target.checked)} className="accent-orange-500" />
                고정비로 표시 <span className="text-[var(--text-dim)]">— 매월 반복되는 지출이면 체크</span>
              </label>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">사유 / 메모</label>
                <input value={postMemo} onChange={(e) => setPostMemo(e.target.value)} placeholder="사유 / 메모"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">태그 <span className="text-[var(--text-dim)]">(쉼표로 구분)</span></label>
                <input value={postTags} onChange={(e) => setPostTags(e.target.value)} placeholder="예: 출장, 접대, 소모품"
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs focus:outline-none focus:border-[var(--primary)]" />
              </div>
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">사용직원</label>
                <select value={postEmployee} onChange={(e) => setPostEmployee(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs focus:outline-none focus:border-[var(--primary)]">
                  <option value="">사용직원 선택 (선택)</option>
                  {cardEmployees.map((e: any) => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <p className="text-[10px] text-[var(--text-dim)] leading-relaxed">차) 선택 계정 / 대) 보통예금 으로 전표가 생성됩니다. 카드 내역은 그대로 남고 “전표처리됨”으로 표시됩니다.</p>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2 flex-wrap">
              <button onClick={() => setPostCard(null)} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
              {/*   전표를 만들지 않을 줄(개인·이체·중복)은 여기서 바로 장부 제외 — 목록에서 고르지 않아도 된다 (2026-08-27 사장님) */}
              <button type="button" onClick={excludePostCard} disabled={posting} className="btn-secondary btn-sm card-post-exclude" title="전표 없이 끝낸다 — 사유를 남기고 장부에서 뺀다. 검색조건 '장부 제외'에서 해제">장부 제외</button>
              <span className="doc-sums-sp" />
              {(() => {
                const sameCnt = (cardTx as any[]).filter((t) => (t.merchant_name || "") === (postCard.merchant_name || "") && !t.journal_entry_id).length;
                return sameCnt > 1 ? (
                  <button onClick={doPostSameMerchant} disabled={posting || !postAccountId} title="같은 가맹점의 미처리 거래 전체에 같은 계정·사유·태그·사용직원을 적용합니다"
                    className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--primary)]/40 text-[var(--primary)] hover:bg-[var(--primary)]/10 disabled:opacity-50">
                    같은 가맹점 {sameCnt}건 일괄
                  </button>
                ) : null;
              })()}
              <button onClick={doPostVoucher} disabled={posting || !postAccountId}
                className="btn-primary btn-sm">
                {posting ? "처리 중..." : "전표 생성"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 일괄 전표처리 모달 — 선택된 미처리 카드거래를 비용계정 1개로 일괄 생성 */}
      {showBulkPost && (
        <div className="card-bulk-post-modal fixed inset-0" onClick={() => setShowBulkPost(false)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-md shadow-xl" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <div className="text-sm font-bold text-[var(--text)]">일괄 전표처리</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-0.5">선택 {selectedTxIds.size}건을 한 계정으로 전표 생성합니다. 이미 처리된 건은 건너뜁니다.</div>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">비용 계정과목 *</label>
                <AccountPicker accounts={accounts as any[]} value={bulkAccountId} onChange={(id) => setBulkAccountId(id)} natureLabel={cardNatureLabel} />
              </div>
              <p className="text-[10px] text-[var(--text-dim)] leading-relaxed">차) 선택 계정 / 대) 보통예금 으로 각 건 전표가 생성됩니다. 카드 내역은 그대로 남고 “전표처리됨”으로 표시됩니다.</p>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button onClick={() => setShowBulkPost(false)} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
              <button onClick={doBulkPost} disabled={bulkPosting || !bulkAccountId}
                className="btn-primary btn-sm">
                {bulkPosting ? "처리 중..." : `${selectedTxIds.size}건 전표 생성`}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* 카드 수정 팝업 — 이름·메모 (2026-08-19) */}
      {cardEdit && (
        <div className="approval-detail-modal" onClick={() => setCardEdit(null)}>
          <div className="pnl-drill bank-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pnl-drill-head"><h3 className="text-sm font-bold">카드 수정</h3><button type="button" className="btn-secondary btn-sm" onClick={() => setCardEdit(null)}>닫기</button></div>
            <div className="pay-form-body space-y-3">
              <label className="block"><span className="field-label">카드 이름</span><input className="qk-input h-9 w-full px-2.5 text-sm" value={cardEdit.name} onChange={(e) => setCardEdit({ ...cardEdit, name: e.target.value })} /></label>
              <label className="block"><span className="field-label">카드번호 <span className="text-[var(--text-dim)] font-normal">— 카드사가 끝 4자리만 알려줘서, 전체로 보려면 직접 입력</span></span><input className="qk-input h-9 w-full px-2.5 text-sm mono-number" inputMode="numeric" value={cardEdit.number} onChange={(e) => setCardEdit({ ...cardEdit, number: e.target.value.replace(/[^0-9-]/g, "") })} placeholder="예: 5137-1234-5678-4962" /></label>
              <label className="block"><span className="field-label">메모</span><textarea className="qk-input w-full px-2.5 py-2 text-sm" rows={3} value={cardEdit.memo} onChange={(e) => setCardEdit({ ...cardEdit, memo: e.target.value })} placeholder="예: 마케팅팀 광고비 전용 · 대표 소지" /></label>
              <div className="flex justify-end gap-2"><button type="button" className="btn-secondary btn-sm" onClick={() => setCardEdit(null)}>취소</button><button type="button" className="btn-primary btn-sm" disabled={cardSaving} onClick={saveCardEdit}>{cardSaving ? "저장 중…" : "저장"}</button></div>
            </div>
          </div>
        </div>
      )}
      {cardConfirmEl}
      {dupPromptElement}
      {excludePromptElement}
    </div>
  );
}

// ============================================================================
// 내부 컴포넌트

function MiniCard({
  card, selected, onClick,
  isEditing, editingName, onStartEdit, onEditChange, onSaveEdit, onCancelEdit,
}: {
  card: any;
  selected: boolean;
  onClick: () => void;
  isEditing: boolean;
  editingName: string;
  onStartEdit: () => void;
  onEditChange: (v: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
}) {
  const cardNoText = cardNoDisplay(card.card_number);
  const chipClass = cardTypeChipClass(card.card_type);
  // 등록 카드(corporate_cards.id 존재)만 이름 편집 가능. CODEF 미식별 묶음은 hide.
  const canEditName = !!card.id;
  // 2026-05-29 통장 카드와 동일한 흰색 glass-card 스타일. BigCard 만 색 그라데이션 유지.
  return (
    <div
      onClick={isEditing ? undefined : onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (!isEditing && e.key === "Enter") onClick(); }}
      className={`card-mini-card glass-card group ${
        isEditing ? "cursor-default" : "cursor-pointer card-hover"
      } ${
        selected ? "ring-2 ring-[var(--primary)] shadow-lg" : "hover:shadow-md"
      }`}
    >
      <div className="flex items-start justify-between mb-2 gap-2">
        {isEditing ? (
          <input
            autoFocus
            type="text"
            value={editingName}
            onChange={(e) => onEditChange(e.target.value)}
            onBlur={onSaveEdit}
            onKeyDown={(e) => {
              if ((e.nativeEvent as KeyboardEvent).isComposing) return;   // 한글 조합 중 Enter 는 확정 아님
              if (e.key === "Enter") { e.preventDefault(); onSaveEdit(); }
              if (e.key === "Escape") { e.preventDefault(); onCancelEdit(); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-[var(--bg-surface)] text-[var(--text)] text-sm font-semibold px-2 py-1 rounded outline-none border border-[var(--border)] focus:border-[var(--primary)]"
            placeholder="카드명"
          />
        ) : (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
            {/* 카드사 브랜드 로고 (2026-08-13 사장님: 실제 카드사 로고) — 발급사(card_company) 우선, 없으면 카드명으로 추정 */}
            <BankLogo name={card.card_company || card.card_name} size={24} />
            <p className="text-sm font-semibold text-[var(--text)] truncate">{card.card_name}</p>
            {canEditName && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onStartEdit(); }}
                className="opacity-0 group-hover:opacity-100 transition shrink-0 text-xs text-[var(--text-muted)] hover:text-[var(--primary)]"
                title="카드명 변경"
                aria-label="카드명 변경"
              >
                ✏️
              </button>
            )}
          </div>
        )}
        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${chipClass}`}>
          {cardTypeLabel(card.card_type)}
        </span>
      </div>
      <p className="text-xs text-[var(--text-muted)] font-mono mb-1">{cardNoText}</p>
      <p className="text-[11px] text-[var(--text-dim)] truncate">{card.card_company || ""}</p>
    </div>
  );
}

function Stat({ tone, label, value, sub, icon }: { tone: string; label: string; value: string; sub?: string; icon?: string }) {
  // tone = kpi-icon 변형: "" | "success" | "warning" | "danger" | "info"
  return (
    <div className="stat-tile">
      <div className="flex items-center justify-between">
        <span className="stat-tile-label">{label}</span>
        {icon && <span className={`kpi-icon ${tone}`}>{icon}</span>}
      </div>
      <div>
        <p className="stat-tile-value mono-number [overflow-wrap:anywhere]">{value}</p>
        {sub && <p className="text-[11px] text-[var(--text-dim)] mt-1 truncate">{sub}</p>}
      </div>
    </div>
  );
}
