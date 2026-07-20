"use client";
import { logRead } from "@/lib/log-read";

// /cards — 카드 자립 페이지(시안 적용). 시안 3탭: 카드 / 거래내역 / 분석.
//   기존 컴포넌트(CardBillingSummary·TopCardExpensesThisMonth·CardAutoTransferHistory·CardMonthlyUsage)를
//   분석 탭에 녹여서 재사용. transactions/page.tsx 본문 0줄 변경(미 import).
//   기능 보존: 큰 카드 디스플레이 + 사용현황 + 미니그리드 + 거래내역 검색/필터 + 분석 stat·차트.
//   가짜 데이터 금지: 카드번호 끝4 only, credit_limit/리워드 없으면 영역 hide, 실 카테고리.

import { useEffect, useMemo, useState } from "react";
import { DateField } from "@/components/date-field";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useSyncCooldown } from "@/lib/sync-cooldown";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { CardBillingSummary } from "@/components/card-billing-summary";
import { TopCardExpensesThisMonth, CardAutoTransferHistory, CardMonthlyUsage } from "@/components/card-insights";
import { SortToolbar } from "@/components/sort-toolbar";
import { EmptyState } from "@/components/empty-state";
import { useModalKeys } from "@/hooks/use-modal-keys";

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

export default function CardsPage() {
  const { user } = useUser();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const companyId = user?.company_id ?? null;
  const cardCd = useSyncCooldown(companyId, "card");
  const [tab, setTab] = useState<Tab>("cards");
  const [selectedCardIdx, setSelectedCardIdx] = useState(0);
  const [showBalance, setShowBalance] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCardId, setFilterCardId] = useState<string>("");
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
  // 선택 카드 거래내역 기간 필터
  const [cardTxFrom, setCardTxFrom] = useState<string>("");
  const [cardTxTo, setCardTxTo] = useState<string>("");
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
        .select("id, card_id, card_name, amount, category, classification, transaction_date, merchant_name")
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
        .select("id, card_id, card_name, amount, category, classification, transaction_date, merchant_name, journal_entry_id, is_fixed_cost, memo, tags, used_by_employee_id")
        .eq("company_id", companyId ?? "")
        .order("transaction_date", { ascending: false })
        .limit(500);
      if (selectedCardId) q = q.eq("card_id", selectedCardId);
      else if (selectedCardName) q = q.eq("card_name", selectedCardName);
      if (cardTxFrom) q = q.gte("transaction_date", cardTxFrom);
      if (cardTxTo) q = q.lte("transaction_date", cardTxTo);
      const { data } = await q;
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
  const doPostVoucher = async () => {
    if (!postCard || !postAccountId || posting) return;
    setPosting(true);
    try {
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
      toast(m.includes("ALREADY_POSTED") ? "이미 전표처리된 거래입니다" : m.includes("NO_CASH_ACCOUNT") ? "보통예금(101) 계정과목이 없습니다" : m.includes("INVALID_ACCOUNT") ? "계정과목을 선택하세요" : m || "전표처리 실패", "error");
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

  // 거래내역 탭 — 최근 100건. 탭 진입 시에만 fetch.
  const { data: recentTx = [] } = useQuery({
    queryKey: ["cards-page-recent-tx", companyId, filterCardId],
    queryFn: async () => {
      let q = db.from("card_transactions")
        .select("id, card_id, card_name, amount, category, classification, transaction_date, merchant_name, journal_entry_id, is_fixed_cost, memo, tags, used_by_employee_id")
        .eq("company_id", companyId ?? "")
        .order("transaction_date", { ascending: false })
        .limit(300);
      if (filterCardId) q = q.eq("card_id", filterCardId);
      const { data } = await q;
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
      sums[k] = (sums[k] || 0) + Math.abs(Number(tx.amount || 0));
    }
    return { counts, sums };
  }, [monthTx]);

  // 카테고리별 지출 상위 5
  const categoryStats = useMemo(() => {
    const m: Record<string, number> = {};
    for (const tx of monthTx) {
      const amt = Math.abs(Number(tx.amount || 0));
      if (amt <= 0) continue;
      const cat = classificationLabel(tx.classification) || tx.category || "미분류";
      m[cat] = (m[cat] || 0) + amt;
    }
    const entries = Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const total = entries.reduce((s, [, v]) => s + v, 0);
    return entries.map(([name, amount]) => ({ name, amount, pct: total > 0 ? Math.round((amount / total) * 100) : 0 }));
  }, [monthTx]);

  if (!companyId) {
    return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }

  const currentCard = cards[selectedCardIdx] || null;
  const currentCardKey = currentCard ? (currentCard.id || currentCard.card_name) : "";
  const currentTxCount = perCard.counts[currentCardKey] || 0;
  const currentSpend = perCard.sums[currentCardKey] || 0;

  const totalUsage = monthTx.reduce((s: number, t: any) => s + Math.abs(Number(t.amount || 0)), 0);
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

  // 거래내역 검색 클라이언트 필터
  const filteredTx = recentTx.filter((tx: any) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (tx.merchant_name || "").toLowerCase().includes(q)
      || (tx.card_name || "").toLowerCase().includes(q)
      || (classificationLabel(tx.classification) || tx.category || "").toLowerCase().includes(q);
  });

  // 정렬 적용 — 원본 불변 복제 정렬. null/빈값은 항상 뒤로.
  const sortedTx = useMemo(() => {
    if (!sortKey) return filteredTx;
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (tx: any) => {
      switch (sortKey) {
        case "transaction_date": return tx.transaction_date || "";
        case "amount": return Math.abs(Number(tx.amount || 0));
        case "merchant_name": return tx.merchant_name || "";
        case "classification": return classificationLabel(tx.classification) || tx.category || "";
        case "card_name": return tx.card_name || "";
        default: return "";
      }
    };
    const isEmpty = (v: any) => v === "" || v === null || v === undefined;
    return [...filteredTx].sort((a: any, b: any) => {
      const va = get(a), vb = get(b);
      if (isEmpty(va) && isEmpty(vb)) return 0;
      if (isEmpty(va)) return 1;
      if (isEmpty(vb)) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "ko") * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredTx, sortKey, sortDir]);

  // 탭·카드 필터 변경 시 선택 초기화
  useEffect(() => { setSelectedTxIds(new Set()); }, [tab, filterCardId]);

  const toggleTx = (id: string) => {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // 전체선택/일괄은 미처리(journal_entry_id 없음) 건만 대상.
  const selectableTx = sortedTx.filter((tx: any) => !tx.journal_entry_id);
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
      try { localStorage.setItem(`codef-connected-${companyId}`, "1"); } catch { /* ignore */ }
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
      if (synced > 0) toast(`카드 거래 ${synced}건 불러옴`, "success");
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

  return (
    <div>
      {/* 컴팩트 툴바 — 탭(좌) + 카드 연동(우). 타이틀은 상단 고정 헤더바가 담당 */}
      <div className="cards-page-toolbar page-sticky-header">
        <div className="seg-bar">
          {([
            { k: "cards", l: "카드" },
            { k: "transactions", l: "거래내역" },
            { k: "analysis", l: "분석" },
          ] as { k: Tab; l: string }[]).map((t) => (
            <button
              key={t.k}
              type="button"
              onClick={() => setTab(t.k)}
              className={`seg-item ${tab === t.k ? "seg-item-active" : ""}`}
            >
              {t.l}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => {
            if (!cardTxFrom || !cardTxTo) { toast("카드 거래 기간(시작일·종료일)을 먼저 설정한 뒤 연동하세요 — 기간 없이 연동하면 새 거래 없이 쿨타임만 시작됩니다", "error"); return; }
            cardCd.run(handleSyncCards);
          }}
          disabled={syncing || !companyId || cardCd.disabled}
          className={`btn-primary ${cardCd.disabled ? "!opacity-40 cursor-not-allowed" : ""}`}
          title={cardCd.disabled ? `30분 쿨타임 — ${cardCd.label}` : "카드 거래 기간을 설정한 뒤 CODEF 카드 연동으로 그 기간의 카드 거래를 불러옵니다"}
        >
          {syncing ? (
            <>
              <span className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              연동 중...
            </>
          ) : cardCd.disabled ? (
            <>⏳ {cardCd.label}</>
          ) : (
            <>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              카드 연동
            </>
          )}
        </button>
      </div>

      {/* 기간설정 — 제일 상단(툴바 아래) 통일 위치. 카드 탭에서 카드 선택 시 그 카드 거래에 적용 */}
      <div className="card-tx-period-filter no-print">
        <span className="text-xs font-semibold text-[var(--text-muted)]">카드 거래 기간</span>
        <DateField value={cardTxFrom} max={cardTxTo || undefined} onChange={(e) => setCardTxFrom(e.target.value)} title="시작일"
          className="px-2 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs text-[var(--text)] mono-number" />
        <span className="text-[var(--text-dim)] text-xs">~</span>
        <DateField value={cardTxTo} min={cardTxFrom || undefined} onChange={(e) => setCardTxTo(e.target.value)} title="종료일"
          className="px-2 py-1.5 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-xs text-[var(--text)] mono-number" />
        {(cardTxFrom || cardTxTo) && <button onClick={() => { setCardTxFrom(""); setCardTxTo(""); }} className="text-[11px] text-[var(--text-dim)] hover:text-[var(--text)] px-1">기간 해제</button>}
        <span className="text-[10px] text-[var(--text-dim)] ml-auto hidden sm:block">카드를 선택하면 해당 카드 거래에 적용됩니다</span>
      </div>

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
            {/* 컴팩트 카드 요약 스트립 — 대형 CARD HOLDER 히어로 제거 (직원 QA 2026-07-10: 카드홀더 불필요·상단 공간 절약).
                같은 정보(카드명·종류·끝번호·결제일·이번달 사용·거래수)를 한 줄로. */}
            {currentCard && (
              <div className="card-summary-strip glass-card">
                <span className="text-sm font-bold text-[var(--text)] truncate max-w-[200px]">{currentCard.card_name || "카드"}</span>
                <span className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wider ${cardTypeBadgeClass(currentCard.card_type)}`}>
                  {cardTypeLabel(currentCard.card_type)}
                </span>
                <span className="text-xs text-[var(--text-muted)] mono-number">•••• {(currentCard.card_number || "").slice(-4) || "----"}</span>
                <span className="text-xs text-[var(--text-muted)]">결제일 {currentCard.payment_day ? `매월 ${currentCard.payment_day}일` : "—"}</span>
                <span className="ml-auto inline-flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  이번 달 <b className="text-sm text-[var(--text)] mono-number">{showBalance ? fmtW(currentSpend) : "••••••"}</b> · {currentTxCount}건
                  {Number(currentCard.monthly_limit || 0) > 0 && showBalance && (
                    <span className="text-[11px] text-[var(--text-dim)]">/ 한도 {fmtW(Number(currentCard.monthly_limit))}</span>
                  )}
                  <button type="button" onClick={() => setShowBalance((v) => !v)} className="p-1 rounded-lg hover:bg-[var(--bg-surface)]" aria-label="금액 표시 토글">
                    {showBalance ? (
                      <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" strokeWidth={2} /></svg>
                    ) : (
                      <svg className="w-4 h-4 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M6.6 6.6A17 17 0 002 11.5s3.5 7 10 7a9.7 9.7 0 004-.9" /></svg>
                    )}
                  </button>
                </span>
              </div>
            )}

            {/* 카드 미니 그리드 — 클릭 시 그 카드 거래내역 영역으로 스크롤+필터 */}
            <div className="card-mini-grid-section">
              <h3 className="text-lg font-bold text-[var(--text)] mb-4">내 카드</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {cards.map((card: any, idx: number) => (
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

            {/* 카드 선택 시에만 그 카드 거래내역 노출. 닫기 → 영역 자체 hide.
                전체 카드 거래는 별도 거래내역 탭에서 제공하므로 미선택 시 영역 없음. */}
            {(selectedCardId || selectedCardName) && (
              <section id="card-tx-detail" className="card-tx-detail-panel">
                <div className="flex items-center justify-between mb-3 flex-wrap gap-2">
                  <h3 className="text-lg font-bold text-[var(--text)]">
                    {selectedCardLabel} 거래내역 <span className="text-sm font-normal text-[var(--text-dim)]">({cardTx.length}건)</span>
                  </h3>
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <input value={cardTxSearch} onChange={(e) => setCardTxSearch(e.target.value)} placeholder="가맹점·계정·사유·태그·직원 검색"
                      className="px-3 py-1.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] text-xs w-52 outline-none focus:border-[var(--primary)]" />
                    <button
                      type="button"
                      onClick={() => { setSelectedCardId(""); setSelectedCardName(""); setCardTxFrom(""); setCardTxTo(""); }}
                      className="btn-secondary btn-sm"
                    >
                      ✕ 닫기
                    </button>
                  </div>
                </div>
                <div className="mb-2">
                  <SortToolbar
                    options={[
                      { key: "transaction_date", label: "날짜" },
                      { key: "merchant_name", label: "가맹점" },
                      { key: "category", label: "계정과목" },
                      { key: "card_name", label: "카드" },
                      { key: "amount", label: "금액" },
                    ]}
                    sortKey={cardSortKey}
                    sortDir={cardSortDir}
                    onSort={(k) => { if (cardSortKey === k) setCardSortDir((d) => (d === "asc" ? "desc" : "asc")); else { setCardSortKey(k); setCardSortDir(k === "transaction_date" || k === "amount" ? "desc" : "asc"); } }}
                  />
                </div>
                <div className="space-y-2 max-h-[560px] overflow-y-auto pr-1">
                  {shownCardTx.length === 0 ? (
                    <EmptyState
                      card
                      icon="🧾"
                      title={(cardTxFrom || cardTxTo) ? "이 기간에 거래내역이 없습니다" : "이 카드의 거래내역이 없습니다"}
                      desc="기간을 조정하거나 상단의 카드 연동으로 거래를 불러오세요"
                    />
                  ) : shownCardTx.map((tx: any) => (
                    <div key={tx.id} className="card-tx-list-item glass-card">
                      <div className="flex items-center gap-4 flex-1 min-w-0">
                        <div className="w-10 h-10 rounded-full bg-[var(--bg-surface)] flex items-center justify-center text-lg shrink-0">
                          {categoryEmoji(classificationLabel(tx.classification) || tx.category)}
                        </div>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm text-[var(--text)] truncate">{tx.merchant_name || "(가맹점 미상)"}</p>
                          <p className="text-xs text-[var(--text-muted)] truncate">{(classificationLabel(tx.classification) || tx.category || "미분류")} · {tx.card_name || "카드"}</p>
                          {(tx.memo || (tx.tags && tx.tags.length) || tx.used_by_employee_id) && (
                            <div className="flex items-center gap-1.5 flex-wrap mt-1">
                              {tx.used_by_employee_id && empNameById[tx.used_by_employee_id] && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-medium shrink-0">👤 {empNameById[tx.used_by_employee_id]}</span>}
                              {(tx.tags || []).map((t: string) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)] shrink-0">#{t}</span>)}
                              {tx.memo && <span className="text-[10px] text-[var(--text-dim)] truncate max-w-[220px]" title={tx.memo}>📝 {tx.memo}</span>}
                            </div>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-3 shrink-0">
                        <p className={`text-sm sm:text-base font-bold mono-number ${Number(tx.amount || 0) < 0 ? "text-[var(--success)]" : "text-[var(--text)]"}`}>
                          {Number(tx.amount || 0) < 0 ? "+" : "-"}₩{Math.abs(Number(tx.amount || 0)).toLocaleString("ko-KR")}
                        </p>
                        <span className="text-xs text-[var(--text-dim)] hidden sm:inline mono-number">{tx.transaction_date}</span>
                        {tx.journal_entry_id ? (
                          <span className="text-[10px] px-2 py-1 rounded-lg bg-[var(--success-dim)] text-[var(--success)] font-semibold shrink-0">전표처리됨</span>
                        ) : (
                          <button onClick={() => openPost(tx)} className="text-[11px] px-2.5 py-1 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--primary)] hover:border-[var(--primary)]/50 shrink-0 font-semibold">전표처리</button>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )
      )}

      {/* ========== 거래내역 탭 ========== */}
      {tab === "transactions" && (
        <div className="card-tx-tab-panel">
          <div className="card-tx-filter-bar">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="가맹점·카드·카테고리 검색..."
              className="flex-1 px-4 py-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40 focus:border-transparent"
            />
            <select
              value={filterCardId}
              onChange={(e) => setFilterCardId(e.target.value)}
              className="px-4 py-3 rounded-xl bg-[var(--bg-card)] border border-[var(--border)] text-sm text-[var(--text)] focus:outline-none focus:ring-2 focus:ring-[var(--primary)]/40"
            >
              <option value="">모든 카드</option>
              {cards.map((c: any) => (
                <option key={c.id} value={c.id}>{c.card_name}</option>
              ))}
            </select>
          </div>

          {/* 선택 액션바 — 1건 이상 선택 시 sticky 노출. 전표처리는 자리표시(준비중) */}
          {selectedTxIds.size > 0 && (
            <div className="card-tx-bulk-action-bar">
              <span className="text-sm font-semibold text-[var(--text)]">
                <b className="text-[var(--primary)]">{selectedTxIds.size}건</b> 선택됨
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => { setBulkAccountId(""); setShowBulkPost(true); }}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:brightness-110 transition"
                >
                  전표처리({selectedTxIds.size})
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedTxIds(new Set())}
                  className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--primary)] transition"
                >
                  선택 해제
                </button>
              </div>
            </div>
          )}

          {/* 정렬 버튼 툴바 — 헤더 더블클릭 정렬과 동일 sortKey/sortDir 공유 */}
          <SortToolbar
            options={[
              { key: "transaction_date", label: "날짜" },
              { key: "merchant_name", label: "가맹점" },
              { key: "card_name", label: "카드" },
              { key: "amount", label: "금액" },
              { key: "classification", label: "분류" },
            ]}
            sortKey={sortKey}
            sortDir={sortDir}
            onSort={onSortTx}
          />

          <div className="card-tx-table glass-card">
            <div className="overflow-auto max-h-[640px]">
              <table className="w-full">
                <thead className="sticky-bar">
                  <tr className="table-head-row">
                    <th className="w-10 px-4 py-4">
                      <input
                        type="checkbox"
                        checked={allTxSelected}
                        ref={(el) => { if (el) el.indeterminate = someTxSelected; }}
                        onChange={toggleAllTx}
                        aria-label="전체 선택"
                        className="h-4 w-4 cursor-pointer accent-[var(--primary)]"
                      />
                    </th>
                    <th onDoubleClick={() => onSortTx("merchant_name")} title="더블클릭하면 정렬" className="text-left px-6 py-3.5 font-semibold select-none cursor-pointer">가맹점{sortKey === "merchant_name" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                    <th onDoubleClick={() => onSortTx("classification")} title="더블클릭하면 정렬" className="text-left px-6 py-3.5 font-semibold select-none cursor-pointer">분류{sortKey === "classification" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                    <th onDoubleClick={() => onSortTx("card_name")} title="더블클릭하면 정렬" className="text-left px-6 py-3.5 font-semibold select-none cursor-pointer">카드{sortKey === "card_name" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                    <th onDoubleClick={() => onSortTx("amount")} title="더블클릭하면 정렬" className="text-left px-6 py-3.5 font-semibold select-none cursor-pointer">금액{sortKey === "amount" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                    <th onDoubleClick={() => onSortTx("transaction_date")} title="더블클릭하면 정렬" className="text-left px-6 py-3.5 font-semibold select-none cursor-pointer">날짜{sortKey === "transaction_date" ? (sortDir === "asc" ? " ▲" : " ▼") : ""}</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedTx.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="px-6 py-4">
                        <EmptyState icon="💳" title="최근 카드 거래가 없습니다" desc="상단의 카드 연동으로 거래를 불러올 수 있습니다" />
                      </td>
                    </tr>
                  ) : sortedTx.map((tx: any) => {
                    const checked = selectedTxIds.has(tx.id);
                    const posted = !!tx.journal_entry_id;
                    const cat = classificationLabel(tx.classification) || tx.category || "미분류";
                    return (
                      <tr key={tx.id} className={`card-tx-table-row ${checked ? "bg-[var(--primary)]/5" : ""}`}>
                        <td className="w-10 px-4 py-4">
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
                        <td className="px-6 py-3.5">
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-[var(--bg-surface)] flex items-center justify-center text-lg shrink-0">
                              {categoryEmoji(classificationLabel(tx.classification) || tx.category)}
                            </div>
                            <span className="font-medium text-[var(--text)] truncate">{tx.merchant_name || "(가맹점 미상)"}</span>
                          </div>
                        </td>
                        <td className="px-6 py-3.5 text-sm text-[var(--text-muted)]">{cat}</td>
                        <td className="px-6 py-3.5 text-sm text-[var(--text-muted)]">{tx.card_name || "카드"}</td>
                        <td className={`px-6 py-3.5 font-semibold mono-number ${Number(tx.amount || 0) < 0 ? "text-[var(--success)]" : "text-[var(--text)]"}`}>{Number(tx.amount || 0) < 0 ? "+" : "-"}₩{Math.abs(Number(tx.amount || 0)).toLocaleString("ko-KR")}</td>
                        <td className="px-6 py-3.5 text-sm text-[var(--text-muted)] mono-number">
                          {tx.transaction_date}
                          {posted && <span className="ml-1.5 inline-block px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[var(--success-dim)] text-[var(--success)]">전표처리됨</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* ========== 분석 탭 ========== */}
      {tab === "analysis" && (
        <div className="card-analysis-tab-panel">
          {/* Stat 4 — 가짜 trend 없음 */}
          <div className="card-analysis-stats">
            <Stat tone="danger" label="총 사용액" value={fmtW(totalUsage)} sub="이번 달" icon="🛒" />
            {hasLimits ? (
              <Stat
                tone="info"
                label="사용 가능 한도"
                value={fmtW(Math.max(0, totalLimit - totalUsage))}
                sub={`당월 사용 차감 · 총 한도 ${fmtW(totalLimit)}`}
                icon="💼"
              />
            ) : (
              <Stat tone="" label="한도" value="—" sub="한도 정보 없음" icon="💼" />
            )}
            <Stat tone="" label="활성 카드" value={`${activeCards}개`} sub={`등록 ${cards.length}개`} icon="💳" />
            <Stat tone="info" label="이번 달 거래" value={`${monthTx.length}건`} sub="카드 거래 수" icon="📊" />
          </div>

          {/* 카테고리별 지출 */}
          <div className="card-category-spending-panel glass-card">
            <h3 className="text-base font-bold text-[var(--text)] mb-4">카테고리별 지출 (상위 5)</h3>
            <div className="space-y-3">
              {categoryStats.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-4">이번 달 카드 지출 없음</p>
              ) : categoryStats.map((c) => (
                <div key={c.name} className="card-category-row">
                  <div className="w-28 text-sm text-[var(--text-muted)] truncate shrink-0">{c.name}</div>
                  <div className="flex-1">
                    <div className="w-full bg-[var(--bg-surface)] rounded-full h-3 overflow-hidden">
                      <div className="bg-[var(--primary)] h-3 rounded-full" style={{ width: `${c.pct}%` }} />
                    </div>
                  </div>
                  <div className="w-32 text-right shrink-0">
                    <p className="text-sm font-semibold text-[var(--text)] mono-number">{fmtW(c.amount)}</p>
                    <p className="text-xs text-[var(--text-dim)]">{c.pct}%</p>
                  </div>
                </div>
              ))}
            </div>
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
                <select value={postAccountId} onChange={(e) => setPostAccountId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]">
                  <option value="">계정 선택</option>
                  {/* 전표입력과 동일하게 전체 계정과목 사용(이전엔 expense 타입만 → 3개로 제한됐음) */}
                  {(accounts as any[]).map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.code})</option>
                  ))}
                </select>
                {mappingByCategory[postCard.category] && <p className="text-[10px] text-[var(--text-dim)] mt-1">이 분류의 기본 계정이 적용되었습니다.</p>}
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
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
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
                <select value={bulkAccountId} onChange={(e) => setBulkAccountId(e.target.value)}
                  className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)]">
                  <option value="">계정 선택</option>
                  {(accounts as any[]).map((a) => (
                    <option key={a.id} value={a.id}>{a.name} ({a.code})</option>
                  ))}
                </select>
              </div>
              <p className="text-[10px] text-[var(--text-dim)] leading-relaxed">차) 선택 계정 / 대) 보통예금 으로 각 건 전표가 생성됩니다. 카드 내역은 그대로 남고 “전표처리됨”으로 표시됩니다.</p>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button onClick={() => setShowBulkPost(false)} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
              <button onClick={doBulkPost} disabled={bulkPosting || !bulkAccountId}
                className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
                {bulkPosting ? "처리 중..." : `${selectedTxIds.size}건 전표 생성`}
              </button>
            </div>
          </div>
        </div>
      )}
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
  const last4 = (card.card_number || "").slice(-4) || "----";
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
              if (e.key === "Enter") { e.preventDefault(); onSaveEdit(); }
              if (e.key === "Escape") { e.preventDefault(); onCancelEdit(); }
            }}
            onClick={(e) => e.stopPropagation()}
            className="flex-1 min-w-0 bg-[var(--bg-surface)] text-[var(--text)] text-sm font-semibold px-2 py-1 rounded outline-none border border-[var(--border)] focus:border-[var(--primary)]"
            placeholder="카드명"
          />
        ) : (
          <div className="flex items-center gap-1.5 flex-1 min-w-0">
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
      <p className="text-xs text-[var(--text-muted)] font-mono mb-1">•••• {last4}</p>
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
