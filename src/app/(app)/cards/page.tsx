"use client";

// /cards — 카드 자립 페이지(시안 적용). 시안 3탭: 카드 / 거래내역 / 분석.
//   기존 컴포넌트(CardBillingSummary·TopCardExpensesThisMonth·CardAutoTransferHistory·CardMonthlyUsage)를
//   분석 탭에 녹여서 재사용. transactions/page.tsx 본문 0줄 변경(미 import).
//   기능 보존: 큰 카드 디스플레이 + 사용현황 + 미니그리드 + 거래내역 검색/필터 + 분석 stat·차트.
//   가짜 데이터 금지: 카드번호 끝4 only, credit_limit/리워드 없으면 영역 hide, 실 카테고리.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { SiyanPageHeader } from "@/components/siyan";
import { CardBillingSummary } from "@/components/card-billing-summary";
import { TopCardExpensesThisMonth, CardAutoTransferHistory, CardMonthlyUsage } from "@/components/card-insights";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const fmtW = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

// 카드사 → 그라데이션 매핑. 매핑 없으면 indigo 기본.
const CARD_GRADIENTS: Record<string, string> = {
  "삼성": "from-blue-700 via-blue-600 to-cyan-500",
  "신한": "from-blue-700 via-blue-500 to-blue-400",
  "KB": "from-yellow-600 via-orange-500 to-amber-500",
  "국민": "from-yellow-600 via-orange-500 to-amber-500",
  "현대": "from-slate-700 via-slate-800 to-zinc-900",
  "롯데": "from-red-600 via-red-500 to-rose-500",
  "BC": "from-purple-600 via-purple-500 to-pink-500",
  "하나": "from-emerald-600 via-emerald-500 to-teal-500",
  "우리": "from-blue-600 via-indigo-500 to-purple-500",
  "NH": "from-green-600 via-emerald-500 to-teal-500",
  "농협": "from-green-600 via-emerald-500 to-teal-500",
  "카카오": "from-yellow-500 via-amber-400 to-orange-400",
  "토스": "from-blue-500 via-blue-400 to-sky-300",
  "씨티": "from-blue-500 via-cyan-500 to-teal-500",
};
function getCardGradient(company: string | null | undefined): string {
  if (!company) return "from-indigo-600 via-indigo-500 to-purple-600";
  for (const key in CARD_GRADIENTS) {
    if (company.includes(key)) return CARD_GRADIENTS[key];
  }
  return "from-indigo-600 via-indigo-500 to-purple-600";
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

const cardTypeLabel = (t?: string | null) => t === "credit" ? "신용" : t === "check" ? "체크" : t === "debit" ? "직불" : "카드";

type Tab = "cards" | "transactions" | "analysis";

export default function CardsPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const [tab, setTab] = useState<Tab>("cards");
  const [selectedCardIdx, setSelectedCardIdx] = useState(0);
  const [showBalance, setShowBalance] = useState(true);
  const [search, setSearch] = useState("");
  const [filterCardId, setFilterCardId] = useState<string>("");

  // 이번 달 KST 범위
  const monthRange = useMemo(() => {
    const now = new Date();
    const kst = new Date(now.getTime() + 9 * 3600 * 1000);
    const from = new Date(kst.getFullYear(), kst.getMonth(), 1);
    const to = new Date(kst.getFullYear(), kst.getMonth() + 1, 0);
    const f = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
    return { from: f(from), to: f(to) };
  }, []);

  // 등록 카드 목록
  const { data: cards = [] } = useQuery({
    queryKey: ["cards-page-corporate", companyId],
    queryFn: async () => {
      const { data } = await db.from("corporate_cards")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: true });
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  // 이번 달 카드 거래 (분석 stat + 카드별 사용액·거래수)
  const { data: monthTx = [] } = useQuery({
    queryKey: ["cards-page-month-tx", companyId, monthRange.from, monthRange.to],
    queryFn: async () => {
      const { data } = await db.from("card_transactions")
        .select("id, card_id, card_name, amount, category, classification, transaction_date, merchant_name")
        .eq("company_id", companyId)
        .gte("transaction_date", monthRange.from)
        .lte("transaction_date", monthRange.to)
        .limit(50000);
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });

  // 거래내역 탭 — 최근 100건. 탭 진입 시에만 fetch.
  const { data: recentTx = [] } = useQuery({
    queryKey: ["cards-page-recent-tx", companyId, filterCardId],
    queryFn: async () => {
      let q = db.from("card_transactions")
        .select("id, card_id, card_name, amount, category, classification, transaction_date, merchant_name")
        .eq("company_id", companyId)
        .order("transaction_date", { ascending: false })
        .limit(100);
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
      const cat = tx.classification || tx.category || "미분류";
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
  const activeCards = cards.filter((c: any) => !c.status || c.status === "active").length;
  const hasLimits = cards.some((c: any) => Number(c.credit_limit || 0) > 0);
  const totalLimit = hasLimits ? cards.reduce((s: number, c: any) => s + Number(c.credit_limit || 0), 0) : 0;

  // 거래내역 검색 클라이언트 필터
  const filteredTx = recentTx.filter((tx: any) => {
    if (!search.trim()) return true;
    const q = search.trim().toLowerCase();
    return (tx.merchant_name || "").toLowerCase().includes(q)
      || (tx.card_name || "").toLowerCase().includes(q)
      || (tx.classification || tx.category || "").toLowerCase().includes(q);
  });

  const welcomeName = user?.email?.split("@")[0] || "사용자";

  return (
    <div>
      <SiyanPageHeader
        title="카드 관리"
        subtitle={`안녕하세요, ${welcomeName}님 — 모든 카드를 한곳에서 관리하세요`}
        gradient="from-blue-600 to-cyan-500"
      />

      {/* Tabs (시안 pill bar) */}
      <div className="flex gap-1 mb-6 bg-[var(--bg-surface)] rounded-xl p-1 w-fit border border-[var(--border)]">
        {([
          { k: "cards", l: "카드" },
          { k: "transactions", l: "거래내역" },
          { k: "analysis", l: "분석" },
        ] as { k: Tab; l: string }[]).map((t) => (
          <button
            key={t.k}
            type="button"
            onClick={() => setTab(t.k)}
            className={`px-6 py-2.5 rounded-lg font-semibold text-sm transition ${
              tab === t.k
                ? "bg-gradient-to-r from-blue-600 to-cyan-500 text-white shadow-md"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.l}
          </button>
        ))}
      </div>

      {/* ========== 카드 탭 ========== */}
      {tab === "cards" && (
        cards.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <div className="text-4xl mb-3">💳</div>
            <p className="text-sm font-medium text-[var(--text)] mb-1">등록된 카드가 없습니다</p>
            <p className="text-xs text-[var(--text-muted)]">/transactions 카드 탭에서 등록하거나 CODEF 카드 동기화로 자동 등록할 수 있습니다</p>
          </div>
        ) : (
          <div className="space-y-8">
            {/* 큰 카드 + 사용현황 패널 */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
              <div className="lg:col-span-2">
                <BigCard card={currentCard} />
              </div>
              <div className="space-y-4">
                <UsagePanel
                  card={currentCard}
                  monthSpend={currentSpend}
                  showBalance={showBalance}
                  onToggle={() => setShowBalance((v) => !v)}
                />
                <div className="glass-card p-4">
                  <p className="text-xs text-[var(--text-muted)] mb-2">이번 달 거래</p>
                  <p className="text-2xl font-bold text-[var(--text)] mono-number">{currentTxCount}건</p>
                </div>
              </div>
            </div>

            {/* 카드 미니 그리드 */}
            <div>
              <h3 className="text-lg font-bold text-[var(--text)] mb-4">내 카드</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                {cards.map((card: any, idx: number) => (
                  <MiniCard
                    key={card.id}
                    card={card}
                    selected={idx === selectedCardIdx}
                    onClick={() => setSelectedCardIdx(idx)}
                  />
                ))}
              </div>
            </div>
          </div>
        )
      )}

      {/* ========== 거래내역 탭 ========== */}
      {tab === "transactions" && (
        <div className="space-y-4">
          <div className="flex gap-3 flex-col md:flex-row">
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

          <div className="space-y-2">
            {filteredTx.length === 0 ? (
              <div className="glass-card p-12 text-center text-sm text-[var(--text-muted)]">최근 카드 거래가 없습니다</div>
            ) : filteredTx.map((tx: any) => (
              <div key={tx.id} className="glass-card p-4 flex items-center justify-between gap-4 hover:shadow-md transition">
                <div className="flex items-center gap-4 flex-1 min-w-0">
                  <div className="w-12 h-12 rounded-full bg-[var(--bg-surface)] flex items-center justify-center text-xl shrink-0">
                    {categoryEmoji(tx.classification || tx.category)}
                  </div>
                  <div className="min-w-0">
                    <p className="font-semibold text-[var(--text)] truncate">{tx.merchant_name || "(가맹점 미상)"}</p>
                    <p className="text-xs text-[var(--text-muted)] truncate">
                      {(tx.classification || tx.category || "미분류")} · {tx.card_name || "카드"}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-6 shrink-0">
                  <p className="text-base sm:text-lg font-bold text-[var(--text)] mono-number">
                    -₩{Math.abs(Number(tx.amount || 0)).toLocaleString("ko-KR")}
                  </p>
                  <span className="text-xs text-[var(--text-dim)] hidden sm:inline mono-number">{tx.transaction_date}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ========== 분석 탭 ========== */}
      {tab === "analysis" && (
        <div className="space-y-6">
          {/* Stat 4 — 가짜 trend 없음 */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            <Stat tone="from-blue-500 to-cyan-500" label="총 사용액" value={fmtW(totalUsage)} sub="이번 달" icon="🛒" />
            {hasLimits ? (
              <Stat
                tone="from-purple-500 to-pink-500"
                label="사용 가능 한도"
                value={fmtW(Math.max(0, totalLimit - totalUsage))}
                sub={`총 한도 ${fmtW(totalLimit)}`}
                icon="💼"
              />
            ) : (
              <Stat tone="from-slate-500 to-slate-600" label="한도" value="—" sub="한도 정보 없음" icon="💼" />
            )}
            <Stat tone="from-emerald-500 to-green-500" label="활성 카드" value={`${activeCards}개`} sub={`등록 ${cards.length}개`} icon="💳" />
            <Stat tone="from-orange-500 to-red-500" label="이번 달 거래" value={`${monthTx.length}건`} sub="카드 거래 수" icon="📊" />
          </div>

          {/* 카테고리별 지출 */}
          <div className="glass-card p-6">
            <h3 className="text-base font-bold text-[var(--text)] mb-4">카테고리별 지출 (상위 5)</h3>
            <div className="space-y-3">
              {categoryStats.length === 0 ? (
                <p className="text-sm text-[var(--text-muted)] text-center py-4">이번 달 카드 지출 없음</p>
              ) : categoryStats.map((c) => (
                <div key={c.name} className="flex items-center gap-4">
                  <div className="w-28 text-sm text-[var(--text-muted)] truncate shrink-0">{c.name}</div>
                  <div className="flex-1">
                    <div className="w-full bg-[var(--bg-surface)] rounded-full h-3 overflow-hidden">
                      <div className="bg-gradient-to-r from-blue-500 to-cyan-500 h-3 rounded-full" style={{ width: `${c.pct}%` }} />
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
    </div>
  );
}

// ============================================================================
// 내부 컴포넌트

function BigCard({ card }: { card: any | null }) {
  if (!card) return null;
  const last4 = (card.card_number || "").slice(-4);
  const last4Display = last4 || "----";
  const gradient = getCardGradient(card.card_company);
  return (
    <div className={`relative h-56 sm:h-64 bg-gradient-to-br ${gradient} rounded-3xl shadow-2xl p-6 sm:p-8 text-white overflow-hidden`}>
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 right-0 w-40 h-40 bg-white rounded-full blur-3xl" />
        <div className="absolute bottom-0 left-0 w-40 h-40 bg-white rounded-full blur-3xl" />
      </div>
      <div className="relative z-10 h-full flex flex-col justify-between">
        <div className="flex items-start justify-between">
          <div>
            <p className="text-white/70 text-xs mb-1">CARD HOLDER</p>
            <p className="text-base sm:text-lg font-semibold">{(card.card_company || "법인").toUpperCase()} · {cardTypeLabel(card.card_type)}</p>
          </div>
          <span className="text-3xl">💳</span>
        </div>
        <div>
          <p className="text-white/70 text-xs mb-2">Card Number</p>
          <p className="text-xl sm:text-2xl font-mono tracking-wider">•••• •••• •••• {last4Display}</p>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-white/70 text-xs mb-1">결제일</p>
            <p className="text-sm font-semibold">{card.payment_day ? `매월 ${card.payment_day}일` : "—"}</p>
          </div>
          <p className="text-sm font-semibold opacity-90 truncate max-w-[50%]">{card.card_name}</p>
        </div>
      </div>
    </div>
  );
}

function UsagePanel({ card, monthSpend, showBalance, onToggle }: { card: any; monthSpend: number; showBalance: boolean; onToggle: () => void }) {
  if (!card) return null;
  const limit = Number(card.credit_limit || 0);
  const remaining = Math.max(0, limit - monthSpend);
  const pct = limit > 0 ? Math.min(100, (monthSpend / limit) * 100) : 0;

  if (limit > 0) {
    return (
      <div className="glass-card p-6">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-medium text-[var(--text-muted)]">사용 가능 금액</h3>
          <button type="button" onClick={onToggle} className="p-1 rounded-lg hover:bg-[var(--bg-surface)]" aria-label="잔액 표시 토글">
            {showBalance ? (
              <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeWidth={2} d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7-10-7-10-7z" /><circle cx="12" cy="12" r="3" strokeWidth={2} /></svg>
            ) : (
              <svg className="w-5 h-5 text-[var(--text-muted)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeWidth={2} d="M3 3l18 18M10.6 10.6a3 3 0 004.2 4.2M6.6 6.6A17 17 0 002 11.5s3.5 7 10 7a9.7 9.7 0 004-.9" /></svg>
            )}
          </button>
        </div>
        <p className="text-3xl font-bold text-[var(--text)] mb-4 mono-number">
          {showBalance ? fmtW(remaining) : "••••••"}
        </p>
        <div className="text-xs text-[var(--text-muted)] mb-2 flex justify-between mono-number">
          <span>사용 {fmtW(monthSpend)}</span>
          <span>한도 {fmtW(limit)}</span>
        </div>
        <div className="w-full bg-[var(--bg-surface)] rounded-full h-2 overflow-hidden">
          <div className="bg-gradient-to-r from-blue-500 to-cyan-500 h-2 rounded-full transition-all" style={{ width: `${pct}%` }} />
        </div>
      </div>
    );
  }
  // 한도 정보 없음 — 이번 달 사용액만 표시(가짜 한도 진행률 금지)
  return (
    <div className="glass-card p-6">
      <h3 className="text-sm font-medium text-[var(--text-muted)] mb-3">이번 달 사용액</h3>
      <p className="text-3xl font-bold text-[var(--text)] mono-number">{fmtW(monthSpend)}</p>
      <p className="text-xs text-[var(--text-dim)] mt-2">{card.card_type === "credit" ? "한도 미설정" : "체크/직불 — 한도 개념 없음"}</p>
    </div>
  );
}

function MiniCard({ card, selected, onClick }: { card: any; selected: boolean; onClick: () => void }) {
  const last4 = (card.card_number || "").slice(-4) || "----";
  const gradient = getCardGradient(card.card_company);
  return (
    <div
      onClick={onClick}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onClick(); }}
      className={`relative h-40 bg-gradient-to-br ${gradient} rounded-2xl p-5 cursor-pointer transition-all overflow-hidden ${
        selected ? "ring-2 ring-cyan-300 scale-105 shadow-2xl" : "hover:shadow-xl opacity-80 hover:opacity-100"
      }`}
    >
      <div className="absolute inset-0 opacity-10">
        <div className="absolute top-0 right-0 w-32 h-32 bg-white rounded-full blur-3xl" />
      </div>
      <div className="relative z-10 h-full flex flex-col justify-between text-white">
        <p className="text-xs font-medium opacity-80">{cardTypeLabel(card.card_type)}</p>
        <div>
          <p className="text-sm font-bold mb-1 truncate">{card.card_name}</p>
          <p className="text-xs opacity-80 font-mono">•••• {last4}</p>
        </div>
        <p className="text-xs opacity-80 truncate">{card.card_company || ""}</p>
      </div>
    </div>
  );
}

function Stat({ tone, label, value, sub, icon }: { tone: string; label: string; value: string; sub?: string; icon?: string }) {
  return (
    <div className={`rounded-2xl p-5 text-white shadow-lg bg-gradient-to-br ${tone}`}>
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs text-white/80 uppercase tracking-wide font-medium">{label}</p>
        {icon && <span className="p-2 bg-white/20 rounded-lg text-base leading-none">{icon}</span>}
      </div>
      <p className="text-2xl font-bold mono-number truncate">{value}</p>
      {sub && <p className="text-xs text-white/75 mt-1 truncate">{sub}</p>}
    </div>
  );
}
