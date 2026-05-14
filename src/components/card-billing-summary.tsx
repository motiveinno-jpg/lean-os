"use client";

import { useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCorporateCards, getCardTransactions, getDistinctCardNames, upsertCorporateCard } from "@/lib/card-transactions";

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

  const { data: cards = [] } = useQuery({
    queryKey: ['corp-cards', companyId],
    queryFn: () => getCorporateCards(companyId),
    enabled: !!companyId,
  });

  const { data: codefCards = [] } = useQuery({
    queryKey: ['distinct-card-names', companyId],
    queryFn: () => getDistinctCardNames(companyId),
    enabled: !!companyId,
  });

  const dateFrom = useMemo(() => {
    const d = new Date(today); d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  }, [today]);
  const { data: txAll = [] } = useQuery({
    queryKey: ['card-tx-recent-90', companyId, dateFrom],
    queryFn: () => getCardTransactions(companyId, { dateFrom }),
    enabled: !!companyId,
    staleTime: 60_000,
  });

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

  const paymentDayMut = useMutation({
    mutationFn: async ({ card, paymentDay, billingDay }: { card: any; paymentDay: number | null; billingDay: number | null }) => {
      await upsertCorporateCard({
        id: card.id, companyId,
        cardName: card.card_name, cardNumber: card.card_number || undefined,
        cardCompany: card.card_company, holderName: card.holder_name || undefined,
        monthlyLimit: card.monthly_limit || undefined,
        isActive: card.is_active ?? true,
        paymentDay, billingDay,
        cardType: card.card_type || 'credit',
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
            onSelectCard={onSelectCard}
            saving={paymentDayMut.isPending}
          />
        ))}
      </div>

      {unregisteredCount > 0 && (
        <div className="mt-2 text-[10px] text-[var(--text-dim)]">
          미등록 CODEF 카드 {unregisteredCount}개 — 카드를 등록하면 종류·결제일 지정 가능
        </div>
      )}
    </div>
  );
}

function BillingRow({ billing: b, card, onSavePayment, onSelectCard, saving }: {
  billing: Billing;
  card: any;
  onSavePayment: (payDay: number | null, billDay: number | null) => void;
  onSelectCard?: (cardId: string) => void;
  saving: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [payInput, setPayInput] = useState(b.paymentDay ? String(b.paymentDay) : '');
  const [billInput, setBillInput] = useState(b.billingDay ? String(b.billingDay) : '');

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

        {/* 이름 + 회사 */}
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-[var(--text)] truncate">{b.cardName}</div>
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
