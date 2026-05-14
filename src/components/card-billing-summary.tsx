"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { getCorporateCards, getCardTransactions } from "@/lib/card-transactions";

interface Props {
  companyId: string;
  onSelectCard?: (cardId: string) => void; // "청구서 보기" → 거래 테이블 카드 필터
}

interface Billing {
  cardId: string;
  cardName: string;
  cardCompany: string;
  paymentDay: number | null;
  billingDay: number | null;
  /** 현재 청구 사이클 시작·종료일 (YYYY-MM-DD) */
  cycleStart: string;
  cycleEnd: string;
  /** 다음 출금 예정일 */
  nextPaymentDate: Date | null;
  daysToPayment: number | null;
  totalAmount: number;
  txCount: number;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function fmtKRW(n: number): string {
  return n.toLocaleString('ko-KR');
}

function fmtDate(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function clampDay(year: number, monthIndex: number, day: number): Date {
  // monthIndex 0~11. day 31 인데 해당월 30일까지면 30일로 보정.
  const d = new Date(year, monthIndex, day);
  if (d.getMonth() !== ((monthIndex % 12) + 12) % 12) d.setDate(0);
  return d;
}

/**
 * 청구 사이클 계산.
 * billingDay 가 없으면 이번달 1일~말일.
 * billingDay=15 인 경우: 이번달 16일 ~ 다음달 15일 (마감일+1 ~ 다음 마감).
 * 단, 오늘이 이번달 마감일 이전이면 사이클은 (지난달 16일 ~ 이번달 15일).
 */
function computeCycle(today: Date, billingDay: number | null): { start: Date; end: Date } {
  const t = startOfDay(today);
  if (!billingDay) {
    const start = new Date(t.getFullYear(), t.getMonth(), 1);
    const end = new Date(t.getFullYear(), t.getMonth() + 1, 0);
    return { start, end };
  }
  const thisCycleEnd = clampDay(t.getFullYear(), t.getMonth(), billingDay);
  if (t.getTime() <= thisCycleEnd.getTime()) {
    // 이번달 마감 전: 지난달 (마감+1) ~ 이번달 마감
    const prevStart = clampDay(t.getFullYear(), t.getMonth() - 1, billingDay + 1);
    return { start: prevStart, end: thisCycleEnd };
  }
  // 이번달 마감 후: 이번달 (마감+1) ~ 다음달 마감
  const start = clampDay(t.getFullYear(), t.getMonth(), billingDay + 1);
  const end = clampDay(t.getFullYear(), t.getMonth() + 1, billingDay);
  return { start, end };
}

/** 결제일이 오늘 이후 가장 가까운 미래 Date. */
function computeNextPayment(today: Date, paymentDay: number | null): Date | null {
  if (!paymentDay) return null;
  const t = startOfDay(today);
  const thisMonth = clampDay(t.getFullYear(), t.getMonth(), paymentDay);
  if (thisMonth.getTime() >= t.getTime()) return thisMonth;
  return clampDay(t.getFullYear(), t.getMonth() + 1, paymentDay);
}

export function CardBillingSummary({ companyId, onSelectCard }: Props) {
  const today = startOfDay(new Date());

  const { data: cards = [] } = useQuery({
    queryKey: ['corp-cards', companyId],
    queryFn: () => getCorporateCards(companyId),
    enabled: !!companyId,
  });

  // 최근 90일 거래를 한 번에 가져와서 카드별 청구 사이클 합산.
  const dateFrom = useMemo(() => {
    const d = new Date(today);
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  }, [today]);

  const { data: txAll = [] } = useQuery({
    queryKey: ['card-tx-recent-90', companyId, dateFrom],
    queryFn: () => getCardTransactions(companyId, { dateFrom }),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const billings = useMemo<Billing[]>(() => {
    return (cards as any[]).map((c) => {
      const billingDay = c.billing_day ?? null;
      const paymentDay = c.payment_day ?? null;
      const { start, end } = computeCycle(today, billingDay);
      const startISO = start.toISOString().slice(0, 10);
      const endISO = end.toISOString().slice(0, 10);

      const cardTxs = (txAll as any[]).filter((tx) =>
        tx.card_id === c.id &&
        tx.transaction_date >= startISO && tx.transaction_date <= endISO &&
        Number(tx.amount || 0) > 0, // 카드는 지출만, 음수(취소/환불)는 제외
      );
      const total = cardTxs.reduce((s, t) => s + Number(t.amount || 0), 0);

      const nextPay = computeNextPayment(today, paymentDay);
      const days = nextPay ? Math.max(0, Math.round((nextPay.getTime() - today.getTime()) / (1000*60*60*24))) : null;

      return {
        cardId: c.id,
        cardName: c.card_name,
        cardCompany: c.card_company,
        paymentDay,
        billingDay,
        cycleStart: startISO,
        cycleEnd: endISO,
        nextPaymentDate: nextPay,
        daysToPayment: days,
        totalAmount: total,
        txCount: cardTxs.length,
      };
    }).sort((a, b) => {
      // 결제일 가까운 순, 결제일 없는 카드는 뒤로
      if (a.daysToPayment == null && b.daysToPayment == null) return 0;
      if (a.daysToPayment == null) return 1;
      if (b.daysToPayment == null) return -1;
      return a.daysToPayment - b.daysToPayment;
    });
  }, [cards, txAll, today]);

  if (cards.length === 0) {
    return (
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 text-center">
        <div className="text-2xl mb-2">💳</div>
        <div className="text-sm font-semibold text-[var(--text)]">등록된 법인카드가 없습니다</div>
        <div className="text-[11px] text-[var(--text-dim)] mt-1">상단 "+ 카드 등록" 으로 추가하고 이용대금 결제일을 입력하세요.</div>
      </div>
    );
  }

  return (
    <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-base">🧾</span>
          <h2 className="text-sm font-bold text-[var(--text)]">이용대금 / 청구서</h2>
          <span className="text-[10px] text-[var(--text-dim)]">{billings.length}개 카드</span>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">청구 사이클 합계</div>
          <div className="text-base font-black mono-number text-[var(--danger)]">
            ₩{fmtKRW(billings.reduce((s, b) => s + b.totalAmount, 0))}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
        {billings.map((b) => {
          const urgent = b.daysToPayment != null && b.daysToPayment <= 3;
          const warn = b.daysToPayment != null && b.daysToPayment > 3 && b.daysToPayment <= 7;
          return (
            <div key={b.cardId}
              className={`p-3 rounded-xl border ${
                urgent ? 'border-[var(--danger)]/40 bg-[var(--danger)]/5' :
                warn ? 'border-[var(--warning)]/40 bg-[var(--warning)]/5' :
                       'border-[var(--border)] bg-[var(--bg-surface)]'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="text-xs font-bold text-[var(--text)] truncate">{b.cardName}</div>
                  <div className="text-[10px] text-[var(--text-dim)]">{b.cardCompany}</div>
                </div>
                {b.nextPaymentDate ? (
                  <div className={`text-right shrink-0 ${urgent ? 'text-[var(--danger)]' : warn ? 'text-[var(--warning)]' : 'text-[var(--text-muted)]'}`}>
                    <div className="text-[10px] font-semibold leading-tight">{fmtDate(b.nextPaymentDate)}</div>
                    <div className="text-[9px] leading-tight">
                      {b.daysToPayment === 0 ? '오늘' : `D-${b.daysToPayment}`}
                    </div>
                  </div>
                ) : (
                  <div className="text-[9px] text-[var(--text-dim)] shrink-0">결제일 미설정</div>
                )}
              </div>

              <div className="mt-2 text-lg font-black mono-number text-[var(--text)]">
                ₩{fmtKRW(b.totalAmount)}
              </div>
              <div className="text-[10px] text-[var(--text-dim)] mb-2">
                {b.cycleStart} ~ {b.cycleEnd} · {b.txCount}건
              </div>

              {onSelectCard && (
                <button
                  onClick={() => onSelectCard(b.cardId)}
                  className="w-full px-2 py-1.5 text-[10px] font-semibold rounded-lg bg-[var(--bg-card)] hover:bg-[var(--bg-elevated)] text-[var(--text)] border border-[var(--border)] transition"
                >
                  📄 청구서 보기
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
