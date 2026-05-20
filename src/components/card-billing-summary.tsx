"use client";

import { useMemo, useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCorporateCards, getDistinctCardNames, upsertCorporateCard } from "@/lib/card-transactions";
import { supabase } from "@/lib/supabase";
import { fetchAllPaginated } from "@/lib/supabase-paginated";

// "BC카드 5979" → { company: "BC카드", lastFour: "5979" }
function parseCardName(name: string): { company: string; lastFour: string | null } {
  const trimmed = (name || '').trim();
  const match = trimmed.match(/^(.+?)\s*[\s-]?(\d{4})\s*$/);
  if (match) return { company: match[1].replace(/[\s-]+$/, '').trim() || trimmed, lastFour: match[2] };
  return { company: trimmed, lastFour: null };
}

// 카드사 표준화 — corporate_cards.card_company 디폴트 옵션과 매칭
function normalizeCardCompany(raw: string): string {
  const s = raw.replace(/카드$/, '').trim();
  const map: Record<string, string> = {
    'BC': 'BC', '비씨': 'BC',
    '삼성': '삼성',
    '신한': '신한',
    '현대': '현대',
    'KB': 'KB', '국민': 'KB',
    '롯데': '롯데',
    '하나': '하나',
    '우리': '우리',
    'NH': 'NH', '농협': 'NH',
  };
  return map[s] || s || '기타';
}

interface Props {
  companyId: string;
  onSelectCard?: (cardId: string) => void;
}

interface Billing {
  cardId: string;            // corporate_cards.id (등록된 카드만 — 미등록은 row 제외)
  cardName: string;
  cardCompany: string;
  paymentDay: number | null;
  billingDay: number | null;
  cycleStart: string;
  cycleEnd: string;
  nextPaymentDate: Date | null;
  daysToPayment: number | null;
  totalAmount: number;
  txCount: number;
}

function startOfDay(d: Date): Date { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; }
function fmtKRW(n: number): string { return n.toLocaleString('ko-KR'); }
function fmtDate(d: Date): string { return `${d.getMonth() + 1}/${d.getDate()}`; }
function clampDay(year: number, monthIndex: number, day: number): Date {
  const d = new Date(year, monthIndex, day);
  if (d.getMonth() !== ((monthIndex % 12) + 12) % 12) d.setDate(0);
  return d;
}
function computeCycle(today: Date, billingDay: number | null): { start: Date; end: Date } {
  const t = startOfDay(today);
  if (!billingDay) {
    const start = new Date(t.getFullYear(), t.getMonth(), 1);
    const end = new Date(t.getFullYear(), t.getMonth() + 1, 0);
    return { start, end };
  }
  const thisCycleEnd = clampDay(t.getFullYear(), t.getMonth(), billingDay);
  if (t.getTime() <= thisCycleEnd.getTime()) {
    const prevStart = clampDay(t.getFullYear(), t.getMonth() - 1, billingDay + 1);
    return { start: prevStart, end: thisCycleEnd };
  }
  const start = clampDay(t.getFullYear(), t.getMonth(), billingDay + 1);
  const end = clampDay(t.getFullYear(), t.getMonth() + 1, billingDay);
  return { start, end };
}
function computeNextPayment(today: Date, paymentDay: number | null): Date | null {
  if (!paymentDay) return null;
  const t = startOfDay(today);
  const thisMonth = clampDay(t.getFullYear(), t.getMonth(), paymentDay);
  if (thisMonth.getTime() >= t.getTime()) return thisMonth;
  return clampDay(t.getFullYear(), t.getMonth() + 1, paymentDay);
}

export function CardBillingSummary({ companyId, onSelectCard }: Props) {
  const today = startOfDay(new Date());
  const queryClient = useQueryClient();

  const { data: cards = [], isFetched: cardsFetched } = useQuery({
    queryKey: ['corp-cards', companyId],
    queryFn: () => getCorporateCards(companyId),
    enabled: !!companyId,
  });

  const { data: codefCards = [], isFetched: codefFetched } = useQuery({
    queryKey: ['distinct-card-names', companyId],
    queryFn: () => getDistinctCardNames(companyId),
    enabled: !!companyId,
  });

  const dateFrom = useMemo(() => {
    const d = new Date(today); d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  }, [today]);
  const { data: txAll = [] } = useQuery({
    queryKey: ['card-tx-recent-90-paginated', companyId, dateFrom],
    queryFn: () => fetchAllPaginated<any>((from, to) =>
      (supabase as any)
        .from('card_transactions')
        .select('id, transaction_date, amount, card_id, card_name')
        .eq('company_id', companyId)
        .gte('transaction_date', dateFrom)
        .range(from, to)
    ),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  // 체크/직불 카드 — 청구 사이클 무관, 별도 섹션에서 종류 변경만 가능
  const nonCreditCards = useMemo(() => {
    return (cards as any[]).filter((c: any) => c.card_type && c.card_type !== 'credit');
  }, [cards]);

  // 신용카드(credit)만 청구서 표시. 체크/직불은 즉시 출금 → 청구 사이클 없음.
  const billings = useMemo<Billing[]>(() => {
    const list: Billing[] = [];
    for (const c of (cards as any[])) {
      if (c.card_type && c.card_type !== 'credit') continue;
      const billingDay = c.billing_day ?? null;
      const paymentDay = c.payment_day ?? null;
      const { start, end } = computeCycle(today, billingDay);
      const startISO = start.toISOString().slice(0, 10);
      const endISO = end.toISOString().slice(0, 10);
      const cardTxs = (txAll as any[]).filter((tx) =>
        tx.card_id === c.id &&
        tx.transaction_date >= startISO && tx.transaction_date <= endISO &&
        Number(tx.amount || 0) > 0,
      );
      const total = cardTxs.reduce((s, t) => s + Number(t.amount || 0), 0);
      const nextPay = computeNextPayment(today, paymentDay);
      const days = nextPay ? Math.max(0, Math.round((nextPay.getTime() - today.getTime()) / (1000*60*60*24))) : null;
      list.push({
        cardId: c.id, cardName: c.card_name, cardCompany: c.card_company,
        paymentDay, billingDay, cycleStart: startISO, cycleEnd: endISO,
        nextPaymentDate: nextPay, daysToPayment: days,
        totalAmount: total, txCount: cardTxs.length,
      });
    }
    list.sort((a, b) => {
      if (a.daysToPayment == null && b.daysToPayment == null) return b.totalAmount - a.totalAmount;
      if (a.daysToPayment == null) return 1;
      if (b.daysToPayment == null) return -1;
      return a.daysToPayment - b.daysToPayment;
    });
    return list;
  }, [cards, txAll, today]);

  // 미등록 CODEF 카드 안내: 청구서 표시는 안 하되 등록 유도.
  const unregisteredCount = useMemo(() => {
    const registeredNames = new Set((cards as any[]).map((c: any) => c.card_name));
    return (codefCards as any[]).filter((cc) => !registeredNames.has(cc.card_name)).length;
  }, [cards, codefCards]);

  // CODEF sync 거래에 있는데 corporate_cards 미등록인 카드 자동 등록 (세션당 1회).
  // 카드 종류는 default 'credit' — 체크/직불이면 사용자가 등록 후 '⚙ 결제일' 또는 수정으로 변경.
  const autoRegRef = useRef(false);
  useEffect(() => {
    if (autoRegRef.current) return;
    if (!companyId) return;
    // 두 useQuery 모두 fetch 완료된 후만 실행 (cards 로딩 전 fire 시 모든 카드 새로 insert 되는 문제 방지)
    if (!cardsFetched || !codefFetched) return;
    if (!Array.isArray(cards) || !Array.isArray(codefCards)) return;
    const registeredNames = new Set((cards as any[]).map((c: any) => c.card_name));
    const newCards = (codefCards as any[]).filter((cc: any) => cc.card_name && !registeredNames.has(cc.card_name));
    if (newCards.length === 0) {
      autoRegRef.current = true; // 추가 등록할 카드 없음 — 다음에 또 시도 안 함
      return;
    }
    autoRegRef.current = true;

    (async () => {
      for (const cc of newCards) {
        const parsed = parseCardName(cc.card_name);
        try {
          await upsertCorporateCard({
            companyId,
            cardName: cc.card_name,
            cardCompany: normalizeCardCompany(parsed.company),
            cardNumber: parsed.lastFour || undefined,
            cardType: 'credit',
            isActive: true,
          });
        } catch { /* 중복 / RLS 충돌 시 무시 — 다음 마운트에 재시도 */ }
      }
      queryClient.invalidateQueries({ queryKey: ['corp-cards'] });
    })();
  }, [companyId, cards, codefCards, queryClient]);

  const paymentDayMut = useMutation({
    mutationFn: async ({ card, paymentDay, billingDay, cardType }: { card: any; paymentDay: number | null; billingDay: number | null; cardType?: 'credit' | 'check' | 'debit' | 'other' }) => {
      await upsertCorporateCard({
        id: card.id, companyId,
        cardName: card.card_name, cardNumber: card.card_number || undefined,
        cardCompany: card.card_company, holderName: card.holder_name || undefined,
        monthlyLimit: card.monthly_limit || undefined,
        isActive: card.is_active ?? true,
        paymentDay, billingDay,
        cardType: cardType || card.card_type || 'credit',
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['corp-cards'] }),
  });

  // 카드 종류 빠른 변경 — 체크/직불로 변경하면 청구서에서 즉시 사라짐
  const typeMut = useMutation({
    mutationFn: async ({ card, type }: { card: any; type: 'credit' | 'check' | 'debit' | 'other' }) => {
      await upsertCorporateCard({
        id: card.id, companyId,
        cardName: card.card_name, cardNumber: card.card_number || undefined,
        cardCompany: card.card_company, holderName: card.holder_name || undefined,
        monthlyLimit: card.monthly_limit || undefined,
        isActive: card.is_active ?? true,
        paymentDay: card.payment_day ?? null, billingDay: card.billing_day ?? null,
        cardType: type,
      });
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['corp-cards'] }),
  });

  if (billings.length === 0) {
    return (
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4">
        <div className="flex items-center gap-2 mb-2">
          <span className="text-base">🧾</span>
          <h2 className="text-sm font-bold text-[var(--text)]">이용대금 / 청구서</h2>
        </div>
        <div className="text-[11px] text-[var(--text-dim)]">
          등록된 신용카드가 없습니다. 상단 "+ 카드 등록" 으로 추가하면 청구 사이클이 자동 계산됩니다.
          {unregisteredCount > 0 && <> · 미등록 CODEF 카드 {unregisteredCount}개</>}
        </div>
      </div>
    );
  }

  const grand = billings.reduce((s, b) => s + b.totalAmount, 0);

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🧾</span>
          <h2 className="text-sm font-bold text-[var(--text)]">이용대금 / 청구서</h2>
          <span className="text-[10px] text-[var(--text-dim)]">신용 {billings.length}개</span>
        </div>
        <div className="text-right">
          <div className="text-[9px] text-[var(--text-dim)] uppercase tracking-wider">청구 합계</div>
          <div className="text-sm font-black mono-number text-[var(--danger)]">₩{fmtKRW(grand)}</div>
        </div>
      </div>

      <div className="mb-2 px-1 text-[10px] text-[var(--text-dim)]">
        💡 CODEF 는 카드 종류(신용/체크) 정보를 안 줘서 자동 등록은 모두 <span className="text-[var(--primary)] font-semibold">신용</span> 으로 들어옵니다.
        체크/직불이면 아래 카드 옆 <span className="font-mono">신용▾</span> 클릭해 변경 → 즉시 청구서에서 사라집니다.
      </div>
      <div className="space-y-1">
        {billings.map((b) => (
          <BillingRow
            key={b.cardId}
            billing={b}
            card={(cards as any[]).find((c: any) => c.id === b.cardId)}
            onSavePayment={(payDay, billDay) =>
              paymentDayMut.mutate({
                card: (cards as any[]).find((c: any) => c.id === b.cardId),
                paymentDay: payDay, billingDay: billDay,
              })
            }
            onChangeType={(type) => {
              const card = (cards as any[]).find((c: any) => c.id === b.cardId);
              if (card) typeMut.mutate({ card, type });
            }}
            onSelectCard={onSelectCard}
            saving={paymentDayMut.isPending || typeMut.isPending}
          />
        ))}
      </div>

      {unregisteredCount > 0 && (
        <div className="mt-2 text-[10px] text-[var(--text-dim)]">
          미등록 CODEF 카드 {unregisteredCount}개 — 카드를 등록하면 종류·결제일 지정 가능
        </div>
      )}

      {/* 체크·직불·기타 카드 — 청구 사이클 무관, 종류 되돌리기용. 기본 접힘(localStorage). */}
      {nonCreditCards.length > 0 && (
        <NonCreditCardsSection
          cards={nonCreditCards}
          onChangeType={(card, type) => typeMut.mutate({ card, type })}
          saving={typeMut.isPending}
        />
      )}
    </div>
  );
}

function NonCreditCardsSection({
  cards,
  onChangeType,
  saving,
}: {
  cards: any[];
  onChangeType: (card: any, type: 'credit' | 'check' | 'debit' | 'other') => void;
  saving: boolean;
}) {
  const STORAGE_KEY = 'card_billing_noncredit_collapsed';
  const [collapsed, setCollapsed] = useState<boolean>(() => {
    if (typeof window === 'undefined') return true;
    const v = window.localStorage.getItem(STORAGE_KEY);
    return v === null ? true : v === '1';
  });
  const toggle = () => {
    setCollapsed(prev => {
      const next = !prev;
      try { window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0'); } catch {}
      return next;
    });
  };
  return (
    <div className="mt-3 pt-3 border-t border-[var(--border)]">
      <button
        type="button"
        onClick={toggle}
        className="flex items-center justify-between w-full mb-1.5 hover:opacity-80 transition"
      >
        <div className="flex items-center gap-1.5">
          <span className="inline-block w-3 text-center text-[10px] text-[var(--text-muted)]">{collapsed ? '▶' : '▼'}</span>
          <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">
            체크·직불·기타 {cards.length}개 {collapsed ? '(접힘 — 클릭하면 펼침)' : ''}
          </div>
        </div>
        <div className="text-[9px] text-[var(--text-dim)]">청구 사이클 없음 · 종류 ▾ 로 신용 복원</div>
      </button>
      {!collapsed && (
        <div className="space-y-1">
          {cards.map((c: any) => {
            const curType = c.card_type as 'check' | 'debit' | 'other';
            const typeLabel = curType === 'check' ? '체크' : curType === 'debit' ? '직불' : '기타';
            return (
              <div key={c.id} className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-[var(--bg-surface)]/60 border border-[var(--border)]/50">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-[var(--text-muted)] truncate">{c.card_name}</span>
                    <NonCreditTypeToggle
                      currentType={curType}
                      currentLabel={typeLabel}
                      onChange={(type) => onChangeType(c, type)}
                      saving={saving}
                    />
                  </div>
                  <div className="text-[9px] text-[var(--text-dim)] truncate">{c.card_company}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function NonCreditTypeToggle({ currentType, currentLabel, onChange, saving }: {
  currentType: 'check' | 'debit' | 'other';
  currentLabel: string;
  onChange: (type: 'credit' | 'check' | 'debit' | 'other') => void;
  saving: boolean;
}) {
  const [open, setOpen] = useState(false);
  const color = currentType === 'check' ? { bg: 'rgba(249,115,22,0.12)', fg: '#fb923c' }
    : currentType === 'debit' ? { bg: 'rgba(34,197,94,0.12)', fg: '#4ade80' }
    : { bg: 'rgba(148,163,184,0.12)', fg: '#94a3b8' };
  return (
    <div className="relative">
      <button onClick={() => setOpen(v => !v)}
        className="text-[9px] font-bold px-1.5 py-0.5 rounded transition shrink-0"
        style={{ background: color.bg, color: color.fg }}
        title="카드 종류 변경"
      >
        {currentLabel}▾
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 z-30 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg py-1 min-w-[80px]"
          onMouseLeave={() => setOpen(false)}
        >
          {([['credit', '신용'], ['check', '체크'], ['debit', '직불'], ['other', '기타']] as const).map(([k, label]) => (
            <button key={k} disabled={saving}
              onClick={() => { onChange(k); setOpen(false); }}
              className={`block w-full text-left px-3 py-1 text-[10px] hover:bg-[var(--bg-surface)] transition ${
                currentType === k ? 'font-bold text-[var(--primary)]' : 'text-[var(--text-muted)]'
              }`}
            >
              {currentType === k ? '✓ ' : '  '}{label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function BillingRow({ billing: b, card, onSavePayment, onChangeType, onSelectCard, saving }: {
  billing: Billing;
  card: any;
  onSavePayment: (payDay: number | null, billDay: number | null) => void;
  onChangeType?: (type: 'credit' | 'check' | 'debit' | 'other') => void;
  onSelectCard?: (cardId: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [typeMenu, setTypeMenu] = useState(false);
  const [payInput, setPayInput] = useState(b.paymentDay ? String(b.paymentDay) : '');
  const [billInput, setBillInput] = useState(b.billingDay ? String(b.billingDay) : '');
  const curType = (card?.card_type as 'credit' | 'check' | 'debit' | 'other') || 'credit';
  const typeLabel = curType === 'credit' ? '신용' : curType === 'check' ? '체크' : curType === 'debit' ? '직불' : '기타';

  const urgent = b.daysToPayment != null && b.daysToPayment <= 3;
  const warn = b.daysToPayment != null && b.daysToPayment > 3 && b.daysToPayment <= 7;
  const rowBg = urgent ? 'bg-[var(--danger)]/5 border-[var(--danger)]/30' :
                warn ? 'bg-[var(--warning)]/5 border-[var(--warning)]/30' :
                       'bg-[var(--bg-surface)] border-[var(--border)]';

  const save = () => {
    const p = payInput ? Math.max(1, Math.min(31, Number(payInput))) : null;
    const bl = billInput ? Math.max(1, Math.min(31, Number(billInput))) : null;
    onSavePayment(p, bl);
    setEditing(false);
  };

  return (
    <div className={`rounded-lg border ${rowBg}`}>
      <div className="flex items-center gap-2 px-3 py-2">
        {/* 결제일 D-N (또는 미설정 안내) */}
        {b.nextPaymentDate ? (
          <div className={`flex flex-col items-center justify-center w-12 py-0.5 rounded shrink-0 ${
            urgent ? 'bg-[var(--danger)]/15 text-[var(--danger)]' :
            warn ? 'bg-[var(--warning)]/15 text-[var(--warning)]' :
                   'bg-[var(--bg-card)] text-[var(--text-muted)]'
          }`}>
            <div className="text-[10px] font-semibold leading-tight">{fmtDate(b.nextPaymentDate)}</div>
            <div className="text-[8px] leading-tight opacity-80">{b.daysToPayment === 0 ? '오늘' : `D-${b.daysToPayment}`}</div>
          </div>
        ) : (
          <button onClick={() => setEditing(true)}
            className="flex flex-col items-center justify-center w-12 py-1 rounded shrink-0 border border-dashed border-[var(--border)] hover:border-[var(--primary)] text-[var(--text-dim)] hover:text-[var(--primary)] transition"
            title="결제일 설정"
          >
            <div className="text-[10px] leading-tight">설정</div>
          </button>
        )}

        {/* 이름 + 회사 + 종류 토글 */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold text-[var(--text)] truncate">{b.cardName}</span>
            {/* 카드 종류 토글 */}
            {onChangeType && card && (
              <div className="relative">
                <button
                  onClick={() => setTypeMenu(v => !v)}
                  className="text-[9px] font-bold px-1.5 py-0.5 rounded transition shrink-0"
                  style={{
                    background: 'rgba(59,130,246,0.12)',
                    color: '#60a5fa',
                  }}
                  title="카드 종류 변경"
                >
                  {typeLabel}▾
                </button>
                {typeMenu && (
                  <div className="absolute top-full left-0 mt-1 z-30 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg shadow-lg py-1 min-w-[80px]"
                    onMouseLeave={() => setTypeMenu(false)}>
                    {([['credit', '신용'], ['check', '체크'], ['debit', '직불'], ['other', '기타']] as const).map(([k, label]) => (
                      <button
                        key={k}
                        onClick={() => { onChangeType(k); setTypeMenu(false); }}
                        disabled={saving}
                        className={`block w-full text-left px-3 py-1 text-[10px] hover:bg-[var(--bg-surface)] transition ${
                          curType === k ? 'font-bold text-[var(--primary)]' : 'text-[var(--text-muted)]'
                        }`}
                      >
                        {curType === k ? '✓ ' : '  '}{label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="text-[9px] text-[var(--text-dim)] truncate">{b.cardCompany} · {b.txCount}건</div>
        </div>

        {/* 금액 */}
        <div className="text-right shrink-0">
          <div className="text-sm font-bold mono-number text-[var(--text)]">₩{fmtKRW(b.totalAmount)}</div>
          <div className="text-[8px] text-[var(--text-dim)] mono-number">{b.cycleStart.slice(5)} ~ {b.cycleEnd.slice(5)}</div>
        </div>

        {/* 액션 */}
        <div className="flex flex-col gap-1 shrink-0">
          {onSelectCard && (
            <button onClick={() => onSelectCard(b.cardId)}
              className="px-2 py-0.5 text-[9px] font-semibold rounded bg-[var(--bg-card)] hover:bg-[var(--bg-elevated)] text-[var(--text)] border border-[var(--border)] transition"
              title="이 카드 거래만 보기"
            >📄 청구서</button>
          )}
          {card && (
            <button onClick={() => setEditing(v => !v)}
              className={`px-2 py-0.5 text-[9px] font-semibold rounded border transition ${
                editing
                  ? 'bg-[var(--primary)]/10 text-[var(--primary)] border-[var(--primary)]/40'
                  : 'bg-[var(--bg-card)] hover:bg-[var(--primary)]/10 text-[var(--text-muted)] hover:text-[var(--primary)] border-[var(--border)]'
              }`}
              title="결제일·마감일 변경"
            >⚙ 결제일</button>
          )}
        </div>
      </div>

      {/* 편집 패널 — 인라인 펼침 (absolute 대신 row 아래) */}
      {editing && (
        <div className="px-3 pb-2 pt-1 border-t border-[var(--border)]/40 flex items-center gap-2 flex-wrap text-xs">
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-[var(--text-dim)]">결제일</label>
            <input type="number" min={1} max={31} value={payInput}
              onChange={e => setPayInput(e.target.value)} placeholder="25"
              className="w-12 px-1.5 py-0.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-center" />
            <span className="text-[10px] text-[var(--text-dim)]">일</span>
          </div>
          <div className="flex items-center gap-1">
            <label className="text-[10px] text-[var(--text-dim)]">마감일</label>
            <input type="number" min={1} max={31} value={billInput}
              onChange={e => setBillInput(e.target.value)} placeholder="15"
              className="w-12 px-1.5 py-0.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-center" />
            <span className="text-[10px] text-[var(--text-dim)]">일</span>
          </div>
          <button onClick={save} disabled={saving}
            className="px-2 py-0.5 text-[10px] font-semibold rounded bg-[var(--primary)] text-white disabled:opacity-50">저장</button>
          <button onClick={() => { setEditing(false); setPayInput(b.paymentDay ? String(b.paymentDay) : ''); setBillInput(b.billingDay ? String(b.billingDay) : ''); }}
            className="px-2 py-0.5 text-[10px] text-[var(--text-muted)] hover:text-[var(--text)]">취소</button>
        </div>
      )}
    </div>
  );
}
