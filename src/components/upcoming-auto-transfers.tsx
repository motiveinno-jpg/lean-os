"use client";
import { koFallback } from "@/lib/ko-label";
import { logRead } from "@/lib/log-read";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { TileIcon } from "@/components/ui/icon-tile";
import { getRecurringPayments } from "@/lib/approval-center";
import { supabase } from "@/lib/supabase";
import { ColumnChart } from "@/components/charts/kit";
import { nextDueDate } from "@/lib/recurring-match";
import { todayKst, addDaysStr, mondayOfStr, daysBetweenStr } from "@/lib/kst";

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
  dueDate: string;            // YYYY-MM-DD (한국 날짜)
  daysLeft: number;           // 오늘=0, 지난 날은 음수
  overdue: boolean;           // 예정일이 지났다 — '오늘'로 뭉개지 않고 'N일 지남'으로
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

function fmtDate(d: string): string {
  return `${Number(d.slice(5, 7))}월 ${Number(d.slice(8, 10))}일`;
}

export function UpcomingAutoTransfersCard({ companyId, windowDays = 60, maxItems = 8 }: Props) {
  const { data: rows = [] } = useQuery({
    queryKey: ['recurring-payments', companyId],
    queryFn: () => getRecurringPayments(companyId),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  // 대출 상환일 리마인더(표시만 · 실행/이체는 사람). payment_day 기준 다음 상환일 산출.
  const  { data: loans = [] } = useQuery({
    queryKey: ['loans-upcoming', companyId],
    queryFn: async () => {
      const data = logRead('components/upcoming-auto-transfers:data', await supabase
        .from('loans')
        .select('id, name, lender, payment_day, remaining_balance, maturity_date, status')
        .eq('company_id', companyId)
        .eq('status', 'active'));
      return (data || []) as any[];
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const allItems = useMemo<UpcomingItem[]>(() => {
    //   다음 예정일은 nextDueDate 한 함수 — '정기 지출 출금 확인' 카드와 같은 날을 말한다(날짜는 한국 기준)
    const today = todayKst();
    const horizon = addDaysStr(today, windowDays);

    const list: UpcomingItem[] = [];
    for (const r of rows as any[]) {
      if (r.is_active === false) continue;
      const due = nextDueDate(r, today);
      if (!due || due.date > horizon) continue;

      const ba = r.bank_accounts || {};
      const accNo = ba.account_number || '';
      const last4 = accNo.slice(-4);
      const accountLabel = ba.bank_name ? `${ba.bank_name}${last4 ? ' ' + last4 : ''}` : (last4 || '계좌 미연결');
      const aliasOrDisplay = accNo
        ? (accNo.length >= 12
            ? `${accNo.slice(0,3)}-${accNo.slice(3,9)}-${accNo.slice(9,11)}-${accNo.slice(11)}`
            : accNo)
        : '';

      list.push({
        id: r.id,
        name: r.name || '(이름 없음)',
        amount: Number(r.amount || 0),
        category: r.category || 'other',
        dueDate: due.date,
        daysLeft: due.daysLeft,
        overdue: due.overdue,
        accountLabel,
        accountAliasOrDisplay: aliasOrDisplay,
        recipient: r.recipient_name || undefined,
        kind: 'recurring',
      });
    }

    // 대출 상환일 · 상환액은 알 수 없어(스케줄 미저장) 금액 대신 '잔액'을 리마인더로 표시.
    for (const l of loans as any[])  {
      const day = Number(l.payment_day || 0);
      if (!day || day < 1 || day > 31) continue;
      const due = nextDueDate({ frequency: 'monthly', day_of_month: day }, today);
      if (!due || due.date > horizon) continue;
      list.push({
        id: `loan-${l.id}`,
        name: l.name || l.lender || '대출',
        amount: 0,
        category: 'loan',
        dueDate: due.date,
        daysLeft: due.daysLeft,
        overdue: due.overdue,
        accountLabel: l.lender || '',
        accountAliasOrDisplay: '',
        kind: 'loan',
        balance: Number(l.remaining_balance || 0),
      });
    }

    list.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
    return list;
  }, [rows, loans, windowDays]);

  //   목록은 코앞의 몇 건만 보여 준다 — 그래프는 창 전체를 센다(잘린 목록으로 그리면 뒤쪽 주가 비어 보인다)
  const items = useMemo(() => allItems.slice(0, maxItems), [allItems, maxItems]);

  //   언제 얼마가 나가나 — 날짜는 순서가 있고 값은 금액이라 세로 막대가 맞다.
  //   날짜별로 그리면 대부분의 날이 0이라 듬성듬성해진다 → 주 단위로 모은다.
  //   대출은 상환액을 모르므로(잔액만 안다) 막대에 넣지 않는다 — 금액을 지어내지 않는다.
  const weekBars = useMemo(() => {
    const today = todayKst();
    const firstMon = mondayOfStr(today);                        // 월요일 시작
    const weeks = Math.ceil((windowDays + daysBetweenStr(today, firstMon)) / 7);
    const bars = Array.from({ length: weeks }, (_, i) => {
      const from = addDaysStr(firstMon, i * 7);
      return { label: i === 0 ? '이번 주' : `${Number(from.slice(5, 7))}/${Number(from.slice(8, 10))}`, value: 0 };
    });
    for (const it of allItems) {
      if (it.kind === 'loan') continue;
      //   지난 예정(일자를 몰라 굴리지 못한 것)은 이번 주에 얹는다 — 아직 안 나간 돈이다
      const idx = Math.max(0, Math.floor(daysBetweenStr(it.dueDate, firstMon) / 7));
      if (idx < bars.length) bars[idx].value += it.amount;
    }
    return bars;
  }, [allItems, windowDays]);

  // 총 출금 예정 = 정기지출 금액만(대출은 상환액 미상 → 합산 제외).
  //   목록이 아니라 **창 전체**를 센다 — 목록은 가까운 몇 건만 보여 주므로 그래프와 숫자가 어긋난다.
  const totalAmount = allItems.reduce((s, it) => s + (it.kind === 'loan' ? 0 : it.amount), 0);

  return (
    <div className="upcoming-transfers-card glass-card">
      <div className="upcoming-transfers-header">
        <div className="flex items-center gap-2.5">
          <span className="kpi-icon warning"><TileIcon name="clock" className="w-5 h-5" /></span>
          <div>
            <h2 className="text-[15px] font-bold text-[var(--text)]">지출·상환 예정</h2>
            <span className="caption">{windowDays}일 안 고정비·대출 {allItems.length}건</span>
          </div>
        </div>
        {items.length > 0 && (
          <div className="text-right">
            <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">총 출금 예정</div>
            <div className="text-base font-black mono-number text-[var(--danger)]">₩{fmtKRW(totalAmount)}</div>
          </div>
        )}
      </div>

      {/* 총액보다 '언제' 가 궁금하다 — 주마다 얼마가 빠지는지 먼저 보여 준다 */}
      {weekBars.some((b) => b.value > 0) && (
        <div className="upcoming-transfers-chart">
          <ColumnChart height={132} unit="원" data={weekBars} />
          <span className="caption" title="대출 상환은 금액을 알 수 없어 제외했습니다.">주별 출금 예정</span>
        </div>
      )}

      {items.length === 0 ? (
        <div className="upcoming-transfers-empty">
          <div className="text-xs text-[var(--text-dim)] mb-2">아직 예정된 고정비 지출이 없습니다.</div>
          <a href="/payments?tab=recurring" className="btn-primary btn-sm">
            + 자동이체 등록
          </a>
        </div>
      ) : (
        <div className="upcoming-transfers-list">
          {items.map((it) => (
            <div key={it.id}
              className="upcoming-transfer-row">
              {/* 날짜 박스 */}
              <div className={`upcoming-transfer-date-box ${
                it.overdue || it.daysLeft <= 3 ? 'bg-[var(--danger)]/15 text-[var(--danger)]' :
                it.daysLeft <= 7 ? 'bg-[var(--warning)]/15 text-[var(--warning)]' :
                                   'bg-[var(--bg-card)] text-[var(--text-muted)]'
              }`}>
                <div className="text-[10px] font-semibold leading-tight">{fmtDate(it.dueDate)}</div>
                <div className="text-[9px] leading-tight opacity-80">
                  {it.overdue ? `${-it.daysLeft}일 지남` : it.daysLeft === 0 ? '오늘' : `D-${it.daysLeft}`}
                </div>
              </div>

              {/* 상세 */}
              <div className="upcoming-transfer-detail">
                {/*   좁은 칸(개요 3단)에선 분류 칩이 이름 폭을 먹어 "사…"로 잘렸다 — 이름은 한 줄을 다 쓰고 두 줄까지 접는다 */}
                <div className="text-xs font-semibold text-[var(--text)] line-clamp-2 break-keep" title={it.name}>{it.name}</div>
                <div className="text-[10px] text-[var(--text-dim)] truncate">
                  {CAT_LABEL[it.category] || koFallback(it.category)}
                  {it.accountLabel ? ` · ${it.accountLabel}` : ''}
                  {it.recipient ? ` → ${it.recipient}` : ''}
                </div>
              </div>

              {/* 금액(정기지출) 또는 잔액(대출 리마인더) */}
              <div className="upcoming-transfer-amount">
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
          {allItems.length > items.length && (
            <a href="/payments?tab=recurring" className="upcoming-transfers-more">
              가까운 {items.length}건만 표시했습니다. 남은  {allItems.length - items.length}건 보기
            </a>
          )}
        </div>
      )}
    </div>
  );
}
