"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TileIcon } from "@/components/ui/icon-tile";
import { getRecurringPayments } from "@/lib/approval-center";
import { supabase } from "@/lib/supabase";

interface Props {
  companyId: string;
  windowDays?: number; // 기본 60일 안에 빠져나갈 자동이체 표시
  maxItems?: number;   // 기본 8건
}

interface UpcomingItem {
  id: string;
  name: string;
  amount: number;
  category: string;
  dueDate: Date;
  daysLeft: number;
  accountLabel: string;       // "농협 1234"
  accountAliasOrDisplay: string;
  recipient?: string;
  kind: 'recurring' | 'loan';
  balance?: number;           // loan: 남은 대출 잔액(리마인더용 — 상환액이 아님)
}

const CAT_LABEL: Record<string, string> = {
  rent: '임대료', utility: '공과금', insurance: '보험료',
  subscription: '구독', salary: '급여', tax: '세금', other: '기타',
  loan: '대출상환',
};

function fmtKRW(n: number): string {
  return n.toLocaleString('ko-KR');
}

function fmtDate(d: Date): string {
  return `${d.getMonth() + 1}월 ${d.getDate()}일`;
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

/**
 * recurring_payments 1건의 다음 출금 예정일 계산.
 * 우선순위: next_due_date > auto_transfer_date > day_of_month.
 * 일자만 있는 경우, 오늘 기준 이번달 vs 다음달 중 가까운 미래로 산출.
 */
function computeNextDue(row: any, today: Date): Date | null {
  if (row.next_due_date) {
    const d = startOfDay(new Date(row.next_due_date));
    if (!isNaN(d.getTime())) return d;
  }
  const day = Number(row.auto_transfer_date || row.day_of_month || 0);
  if (!day || day < 1 || day > 31) return null;

  const t = startOfDay(today);
  const thisMonth = new Date(t.getFullYear(), t.getMonth(), day);
  if (thisMonth.getMonth() !== t.getMonth()) {
    // day=31 같은 월말 보정 (해당월 마지막 일자로)
    thisMonth.setDate(0);
  }
  if (thisMonth.getTime() >= t.getTime()) return thisMonth;

  // 이미 지남 → 다음 달
  const nextMonth = new Date(t.getFullYear(), t.getMonth() + 1, day);
  if (nextMonth.getMonth() !== (t.getMonth() + 1) % 12) {
    nextMonth.setDate(0);
  }
  return nextMonth;
}

export function UpcomingAutoTransfersCard({ companyId, windowDays = 60, maxItems = 8 }: Props) {
  const { data: rows = [] } = useQuery({
    queryKey: ['recurring-payments', companyId],
    queryFn: () => getRecurringPayments(companyId),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  // 대출 상환일 리마인더(표시만 — 실행/이체는 사람). payment_day 기준 다음 상환일 산출.
  const { data: loans = [] } = useQuery({
    queryKey: ['loans-upcoming', companyId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('loans')
        .select('id, name, lender, payment_day, remaining_balance, maturity_date, status')
        .eq('company_id', companyId)
        .eq('status', 'active');
      return (data || []) as any[];
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const items = useMemo<UpcomingItem[]>(() => {
    const today = startOfDay(new Date());
    const horizon = new Date(today);
    horizon.setDate(horizon.getDate() + windowDays);

    const list: UpcomingItem[] = [];
    for (const r of rows as any[]) {
      if (r.is_active === false) continue;
      const due = computeNextDue(r, today);
      if (!due) continue;
      if (due.getTime() > horizon.getTime()) continue;

      const ba = r.bank_accounts || {};
      const accNo = ba.account_number || '';
      const last4 = accNo.slice(-4);
      const accountLabel = ba.bank_name ? `${ba.bank_name}${last4 ? ' ' + last4 : ''}` : (last4 || '계좌 미연결');
      const aliasOrDisplay = accNo
        ? (accNo.length >= 12
            ? `${accNo.slice(0,3)}-${accNo.slice(3,9)}-${accNo.slice(9,11)}-${accNo.slice(11)}`
            : accNo)
        : '';

      const ms = due.getTime() - today.getTime();
      const daysLeft = Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));

      list.push({
        id: r.id,
        name: r.name || '(이름 없음)',
        amount: Number(r.amount || 0),
        category: r.category || 'other',
        dueDate: due,
        daysLeft,
        accountLabel,
        accountAliasOrDisplay: aliasOrDisplay,
        recipient: r.recipient_name || undefined,
        kind: 'recurring',
      });
    }

    // 대출 상환일 — 상환액은 알 수 없어(스케줄 미저장) 금액 대신 '잔액'을 리마인더로 표시.
    for (const l of loans as any[]) {
      const day = Number(l.payment_day || 0);
      if (!day || day < 1 || day > 31) continue;
      const due = computeNextDue({ day_of_month: day }, today);
      if (!due) continue;
      if (due.getTime() > horizon.getTime()) continue;
      const ms = due.getTime() - today.getTime();
      const daysLeft = Math.max(0, Math.round(ms / (1000 * 60 * 60 * 24)));
      list.push({
        id: `loan-${l.id}`,
        name: l.name || l.lender || '대출',
        amount: 0,
        category: 'loan',
        dueDate: due,
        daysLeft,
        accountLabel: l.lender || '',
        accountAliasOrDisplay: '',
        kind: 'loan',
        balance: Number(l.remaining_balance || 0),
      });
    }

    list.sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime());
    return list.slice(0, maxItems);
  }, [rows, loans, windowDays, maxItems]);

  // 총 출금 예정 = 정기지출 금액만(대출은 상환액 미상 → 합산 제외).
  const totalAmount = items.reduce((s, it) => s + (it.kind === 'loan' ? 0 : it.amount), 0);

  return (
    <div className="upcoming-transfers-card mb-3 glass-card p-5">
      <div className="upcoming-transfers-header flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <span className="kpi-icon warning"><TileIcon name="clock" className="w-5 h-5" /></span>
          <div>
            <h2 className="text-[15px] font-bold text-[var(--text)]">지출·상환 예정</h2>
            <span className="caption">{windowDays}일 안 · {items.length}건 (고정비·대출)</span>
          </div>
        </div>
        {items.length > 0 && (
          <div className="text-right">
            <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">총 출금 예정</div>
            <div className="text-base font-black mono-number text-[var(--danger)]">₩{fmtKRW(totalAmount)}</div>
          </div>
        )}
      </div>

      {items.length === 0 ? (
        <div className="upcoming-transfers-empty text-center py-5">
          <div className="text-xs text-[var(--text-dim)] mb-2">예정된 고정비 지출이 없습니다.</div>
          <a href="/payments?tab=recurring" className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition">
            + 자동이체 등록
          </a>
        </div>
      ) : (
        <div className="upcoming-transfers-list space-y-2">
          {items.map((it) => (
            <div key={it.id}
              className="upcoming-transfer-row flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg-surface)] hover:bg-[var(--bg-elevated)] transition">
              {/* 날짜 박스 */}
              <div className={`upcoming-transfer-date-box flex flex-col items-center justify-center w-14 py-1 rounded-md ${
                it.daysLeft <= 3 ? 'bg-[var(--danger)]/15 text-[var(--danger)]' :
                it.daysLeft <= 7 ? 'bg-[var(--warning)]/15 text-[var(--warning)]' :
                                   'bg-[var(--bg-card)] text-[var(--text-muted)]'
              }`}>
                <div className="text-[10px] font-semibold leading-tight">{fmtDate(it.dueDate)}</div>
                <div className="text-[9px] leading-tight opacity-80">
                  {it.daysLeft === 0 ? '오늘' : `D-${it.daysLeft}`}
                </div>
              </div>

              {/* 상세 */}
              <div className="upcoming-transfer-detail flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-[var(--text)] truncate">{it.name}</span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--bg-card)] text-[var(--text-dim)] shrink-0">
                    {CAT_LABEL[it.category] || it.category}
                  </span>
                </div>
                <div className="text-[10px] text-[var(--text-dim)] truncate">
                  {it.accountLabel}
                  {it.recipient ? ` → ${it.recipient}` : ''}
                </div>
              </div>

              {/* 금액(정기지출) 또는 잔액(대출 리마인더) */}
              <div className="upcoming-transfer-amount text-right shrink-0">
                {it.kind === 'loan' ? (
                  <>
                    <div className="text-[9px] text-[var(--text-dim)] uppercase tracking-wider">상환일 · 잔액</div>
                    <div className="text-xs font-bold mono-number text-[var(--text-muted)]">₩{fmtKRW(it.balance || 0)}</div>
                  </>
                ) : (
                  <div className="text-sm font-bold mono-number text-[var(--text)]">₩{fmtKRW(it.amount)}</div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
