"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { IconTile, TileIcon } from "@/components/ui/icon-tile";
import { getCardTransactions, getCorporateCards } from "@/lib/card-transactions";
import { supabase } from "@/lib/supabase";
import { fetchAllPaginated } from "@/lib/supabase-paginated";

interface Props { companyId: string; }

const CARD_TYPE_META: Record<string, { label: string; bg: string; color: string }> = {
  credit: { label: '신용', bg: 'rgba(59,130,246,0.12)', color: '#60a5fa' },
  check:  { label: '체크', bg: 'rgba(249,115,22,0.12)', color: '#fb923c' },
  debit:  { label: '직불', bg: 'rgba(34,197,94,0.12)',  color: '#4ade80' },
  other:  { label: '기타', bg: 'rgba(148,163,184,0.12)', color: '#94a3b8' },
};

function fmtKRW(n: number): string {
  return n.toLocaleString('ko-KR');
}
function fmtW(n: number): string {
  const abs = Math.abs(n);
  if (abs >= 1e8) return `${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${Math.round(abs / 1e4).toLocaleString()}만`;
  return abs.toLocaleString();
}
function startOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function endOfMonth(d: Date): string {
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  next.setDate(next.getDate() - 1);
  return next.toISOString().slice(0, 10);
}

// ─────────────────────────────────────────
// 1) 최근 90일 법인카드 큰 지출 TOP 5
//    (월 초/말 데이터 부족 회피 — 90일 슬라이딩, 5건 항상 안정)
// ─────────────────────────────────────────
export function TopCardExpensesThisMonth({ companyId }: Props) {
  const now = new Date();
  const dateFrom = useMemo(() => {
    const d = new Date(now);
    d.setDate(d.getDate() - 90);
    return d.toISOString().slice(0, 10);
  }, [now]);
  const dateTo = now.toISOString().slice(0, 10);

  // nested JOIN(getCardTransactions) 우회 — corporate_cards/deals/tax_invoices FK NULL 시 row 누락 방지.
  // TopExpense 표시에 필요한 컬럼만 직접 SELECT.
  const { data: rows = [] } = useQuery({
    queryKey: ['card-top-expenses-90d-simple', companyId, dateFrom, dateTo],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from('card_transactions')
        .select('id, transaction_date, amount, merchant_name, merchant_category, card_name, category, classification')
        .eq('company_id', companyId)
        .gte('transaction_date', dateFrom)
        .lte('transaction_date', dateTo)
        .gt('amount', 0)
        .order('amount', { ascending: false })
        .limit(50);
      return data || [];
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });

  const top = useMemo(() => {
    return [...(rows as any[])]
      .filter((t: any) => Number(t.amount || 0) > 0)
      .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
      .slice(0, 5);
  }, [rows]);

  const totalRecent = useMemo(() =>
    (rows as any[]).filter((t: any) => Number(t.amount || 0) > 0).reduce((s, r) => s + Number(r.amount || 0), 0)
  , [rows]);

  // 가장 최신 거래일 — CODEF 카드 sync 가 카드사 청구 처리 후만 가져와서 최근 거래는 며칠 늦음.
  const latestTxDate = useMemo(() => {
    const dates = (rows as any[]).map((t: any) => t.transaction_date).filter(Boolean).sort();
    return dates.length ? dates[dates.length - 1] : null;
  }, [rows]);

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <IconTile tone="danger" size={38}><TileIcon name="card" /></IconTile>
          <div>
            <h2 className="text-[15px] font-bold text-[var(--text)]">최근 90일 카드 큰 지출 TOP 5</h2>
            <span className="text-[10px] text-[var(--text-dim)]">{dateFrom} ~ {dateTo}</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">90일 사용액</div>
          <div className="text-base font-black mono-number text-[var(--danger)]">₩{fmtKRW(totalRecent)}</div>
        </div>
      </div>

      {latestTxDate && (
        <div className="mb-2 text-[10px] text-[var(--text-dim)]">
          최신 카드 거래: <span className="text-[var(--text-muted)] mono-number">{latestTxDate}</span>
          <span className="ml-1">— CODEF 는 카드사 청구 처리된 거래만 가져와 최근 며칠은 늦게 반영됩니다.</span>
        </div>
      )}

      {top.length === 0 ? (
        <div className="text-center py-6 text-xs text-[var(--text-dim)]">최근 30일 카드 지출이 없습니다.</div>
      ) : (
        <div className="space-y-2">
          {top.map((t: any, i: number) => {
            const amount = Number(t.amount || 0);
            const dStr = t.transaction_date || '';
            const d = new Date(dStr);
            const dateDisplay = isNaN(d.getTime()) ? dStr : `${d.getMonth() + 1}/${d.getDate()}`;
            return (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg-surface)]">
                <div className="text-[10px] font-bold text-[var(--text-dim)] w-5 text-center">{i + 1}</div>
                <div className="text-[10px] text-[var(--text-dim)] w-10 mono-number">{dateDisplay}</div>
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-[var(--text)] truncate">{t.merchant_name || '(가맹점 미상)'}</div>
                  <div className="text-[10px] text-[var(--text-dim)] truncate">
                    {t.corporate_cards?.card_name || t.card_name || '카드 미지정'}
                    {t.category ? ` · ${t.category}` : t.merchant_category ? ` · ${t.merchant_category}` : ''}
                  </div>
                </div>
                <div className="text-sm font-bold mono-number text-[var(--danger)] shrink-0">₩{fmtKRW(amount)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// 1-b) 카드 자동이체(정기결제) 내역 — is_fixed_cost=true, 이번달
// ─────────────────────────────────────────
export function CardAutoTransferHistory({ companyId }: Props) {
  const now = new Date();
  const monthLabel = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  const dateFrom = startOfMonth(now);
  const dateTo = endOfMonth(now);

  // V5: 정기결제내역 = 카드 + "통장" 고정비 둘 다. 직원이 통장 거래를
  //   고정비 체크해도 여기 안 뜨던 것은 card_transactions 만 읽었기 때문.
  const { data: rows = [] } = useQuery({
    queryKey: ['card-auto-transfer', companyId, monthLabel],
    queryFn: async () => {
      const [cardRes, bankRes] = await Promise.all([
        (supabase as any)
          .from('card_transactions')
          .select('id, transaction_date, amount, merchant_name, merchant_category, card_name, category, classification, is_fixed_cost')
          .eq('company_id', companyId)
          .eq('is_fixed_cost', true)
          .gte('transaction_date', dateFrom)
          .lte('transaction_date', dateTo)
          .gt('amount', 0)
          .order('transaction_date', { ascending: false }),
        (supabase as any)
          .from('bank_transactions')
          .select('id, transaction_date, amount, counterparty, description, category, classification, is_fixed_cost')
          .eq('company_id', companyId)
          .eq('is_fixed_cost', true)
          .gte('transaction_date', dateFrom)
          .lte('transaction_date', dateTo)
          .order('transaction_date', { ascending: false }),
      ]);
      const cardRows = cardRes.data || [];
      // 통장 고정비를 카드행 동일 스키마로 정규화 (지출=양수만 표시)
      const bankRows = (bankRes.data || [])
        .filter((b: any) => Math.abs(Number(b.amount || 0)) > 0)
        .map((b: any) => ({
          id: `bank:${b.id}`,
          transaction_date: b.transaction_date,
          amount: Math.abs(Number(b.amount || 0)),
          merchant_name: b.counterparty || b.description || '통장 자동이체',
          merchant_category: null,
          card_name: '통장(자동이체)',
          category: b.category,
          classification: b.classification,
          is_fixed_cost: true,
        }));
      return [...cardRows, ...bankRows].sort((a: any, b: any) =>
        String(b.transaction_date || '').localeCompare(String(a.transaction_date || '')));
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });

  const items = useMemo(() => {
    const seen = new Set<string>();
    const out: any[] = [];
    for (const r of rows as any[]) {
      const key = `${r.transaction_date || ''}|${(r.merchant_name || '').trim()}|${Number(r.amount || 0)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(r);
    }
    return out;
  }, [rows]);

  const total = useMemo(() => items.reduce((s, r) => s + Number(r.amount || 0), 0), [items]);

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <IconTile tone="info" size={38}><TileIcon name="repeat" /></IconTile>
          <h2 className="text-[15px] font-bold text-[var(--text)]">정기결제내역</h2>
          <span className="text-[10px] text-[var(--text-dim)]">{monthLabel} · {items.length}건</span>
        </div>
        {items.length > 0 && (
          <div className="text-right">
            <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">이번달 결제</div>
            <div className="text-base font-black mono-number text-[var(--danger)]">₩{fmtKRW(total)}</div>
          </div>
        )}
      </div>
      {/* R15: 사용법 안내 (직원 "어떻게 사용하는것?") — 기능 변경 없이 설명만 */}
      <p className="text-[11px] text-[var(--text-dim)] mb-3 leading-relaxed bg-[var(--bg-surface)] rounded-lg px-3 py-2">
        💡 매달 반복 결제(구독·임대료·통신비 등)를 한눈에 보는 화면입니다. 카드 거래 목록에서 해당 거래를
        <strong className="text-[var(--text-muted)]"> &quot;고정지출&quot;</strong>로 표시하면 이번 달 분이 자동 집계됩니다.
      </p>
      {items.length === 0 ? (
        <div className="text-center py-6 text-xs text-[var(--text-dim)]">
          이번달 정기결제내역이 없습니다.
          <div className="text-[10px] mt-1">카드 거래에서 &quot;고정지출&quot;로 표시하면 여기에 모입니다.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {items.map((t: any) => {
            const amount = Number(t.amount || 0);
            const dStr = t.transaction_date || '';
            const d = new Date(dStr);
            const dateDisplay = isNaN(d.getTime()) ? dStr : `${d.getMonth() + 1}/${d.getDate()}`;
            return (
              <div key={t.id} className="flex items-center gap-3 px-3 py-2 rounded-lg bg-[var(--bg-surface)]">
                <div className="text-[10px] text-[var(--text-dim)] w-10 mono-number">{dateDisplay}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-[var(--text)] truncate">{t.merchant_name || '(가맹점 미상)'}</span>
                    <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] shrink-0">고정지출</span>
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] truncate">
                    {t.card_name || '카드 미지정'}
                    {t.category ? ` · ${t.category}` : t.merchant_category ? ` · ${t.merchant_category}` : ''}
                  </div>
                </div>
                <div className="text-sm font-bold mono-number text-[var(--danger)] shrink-0">₩{fmtKRW(amount)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────
// 2) 카드 월별 사용금액 (최근 6개월, 카드별 + 합계)
// ─────────────────────────────────────────
export function CardMonthlyUsage({ companyId }: Props) {
  const now = new Date();
  const months = useMemo(() => {
    const arr: string[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      arr.push(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`);
    }
    return arr;
  }, [now]);

  // 최근 6개월 시작·종료
  const sixMonthFrom = useMemo(() => `${months[0]}-01`, [months]);
  const todayISO = now.toISOString().slice(0, 10);

  const { data: cards = [] } = useQuery({
    queryKey: ['corp-cards', companyId],
    queryFn: () => getCorporateCards(companyId),
    enabled: !!companyId,
  });

  const { data: txAll = [] } = useQuery({
    queryKey: ['card-tx-6mo-paginated', companyId, sixMonthFrom],
    queryFn: () => fetchAllPaginated<any>((from, to) =>
      (supabase as any)
        .from('card_transactions')
        .select('id, transaction_date, amount, card_id, card_name')
        .eq('company_id', companyId)
        .gte('transaction_date', sixMonthFrom)
        .lte('transaction_date', todayISO)
        .range(from, to)
    ),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  // 카드별/월별 합계 (양수만) — 끝 4자리가 같은 카드는 표시 레벨에서 하나로 병합(원본 데이터는 보존).
  const { perCard, totals, monthMax } = useMemo(() => {
    const tx = (txAll as any[]).filter((t: any) => Number(t.amount || 0) > 0);

    // 문자열에서 마지막 연속 숫자 4자리 추출 (카드번호 끝 4자리 식별용)
    const last4Of = (s: string | null | undefined): string | null => {
      if (!s) return null;
      const matches = String(s).match(/\d{4}/g);
      return matches && matches.length > 0 ? matches[matches.length - 1] : null;
    };

    // 등록 카드: id → {label, cardType, last4}
    const regCard = new Map<string, { label: string; cardType: string | null; last4: string | null }>();
    (cards as any[]).forEach((c: any) => {
      regCard.set(c.id, {
        label: c.card_name,
        cardType: c.card_type || null,
        last4: last4Of(c.card_number) || last4Of(c.card_name),
      });
    });

    // 거래마다 병합 그룹 키 결정:
    //   1) 끝 4자리가 있으면 'l4:<숫자4>' — 카드사·card_id 달라도 같은 물리 카드로 병합
    //   2) 없으면 기존 방식(card_id 우선, 없으면 card_name)
    type Group = {
      label: string;
      cardType: string | null;
      byMonth: Record<string, number>;
      total: number;
      variants: Set<string>;     // 병합된 원본 라벨들
      hasRegistered: boolean;    // 등록 카드명 우선 표기용
    };
    const perCard = new Map<string, Group>();
    const totals: Record<string, number> = Object.fromEntries(months.map(m => [m, 0]));

    const ensureGroup = (key: string): Group => {
      let g = perCard.get(key);
      if (!g) {
        g = { label: '', cardType: null, byMonth: Object.fromEntries(months.map(m => [m, 0])), total: 0, variants: new Set(), hasRegistered: false };
        perCard.set(key, g);
      }
      return g;
    };

    for (const t of tx) {
      const month = String(t.transaction_date || '').slice(0, 7);
      if (!months.includes(month)) continue;
      const amt = Number(t.amount || 0);
      totals[month] = (totals[month] || 0) + amt;

      const reg = t.card_id ? regCard.get(t.card_id) : undefined;
      const baseLabel = reg?.label || t.card_name || '미지정 카드';
      const cardType = reg?.cardType ?? null;
      const last4 = (reg?.last4) || last4Of(t.card_name);
      const groupKey = last4 ? `l4:${last4}` : (t.card_id || t.card_name || '미지정');

      const g = ensureGroup(groupKey);
      g.byMonth[month] = (g.byMonth[month] || 0) + amt;
      g.total += amt;
      g.variants.add(baseLabel);
      if (reg) {
        g.hasRegistered = true;
        // 등록 카드명을 대표 라벨로 우선
        if (!g.label || !g.label.startsWith('★')) g.label = reg.label;
        if (cardType) g.cardType = cardType;
      } else if (!g.label) {
        g.label = baseLabel;
      }
    }

    // 거래는 없지만 등록된 카드도 0원 행으로 노출 (기존 동작 유지)
    (cards as any[]).forEach((c: any) => {
      const last4 = regCard.get(c.id)?.last4;
      const groupKey = last4 ? `l4:${last4}` : c.id;
      if (!perCard.has(groupKey)) {
        const g = ensureGroup(groupKey);
        g.label = c.card_name;
        g.cardType = c.card_type || null;
        g.hasRegistered = true;
        g.variants.add(c.card_name);
      }
    });

    const monthMax = Math.max(1, ...months.map(m => totals[m] || 0));
    return { perCard, totals, monthMax };
  }, [cards, txAll, months]);

  const sortedCards = useMemo(() =>
    Array.from(perCard.entries())
      .map(([k, v]) => ({ key: k, ...v }))
      .sort((a, b) => b.total - a.total)
  , [perCard]);

  const grandTotal = months.reduce((s, m) => s + (totals[m] || 0), 0);

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2.5">
          <IconTile tone="brand" size={38}><TileIcon name="trendingUp" /></IconTile>
          <div>
            <h2 className="text-[15px] font-bold text-[var(--text)]">카드 월별 사용금액</h2>
            <span className="text-[10px] text-[var(--text-dim)]">최근 6개월</span>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">6개월 합계</div>
          <div className="text-base font-black mono-number text-[var(--text)]">₩{fmtKRW(grandTotal)}</div>
        </div>
      </div>

      {/* 합계 막대 그래프 */}
      <div className="mb-4">
        <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-2">월별 합계</div>
        <div className="grid grid-cols-6 gap-2">
          {months.map((m) => {
            const v = totals[m] || 0;
            const pct = monthMax > 0 ? (v / monthMax) * 100 : 0;
            const mLabel = `${Number(m.slice(5, 7))}월`;
            return (
              <div key={m} className="flex flex-col items-center">
                <div className="text-[10px] font-semibold text-[var(--text)] mono-number mb-1">₩{fmtW(v)}</div>
                <div className="w-full h-20 bg-[var(--bg-surface)] rounded-md relative overflow-hidden flex items-end">
                  <div className="w-full bg-gradient-to-t from-[var(--primary)] to-[var(--primary)]/60 transition-all"
                    style={{ height: `${pct}%` }} />
                </div>
                <div className="text-[10px] text-[var(--text-dim)] mt-1">{mLabel}</div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 카드별 표 — 접기 토글, 기본 접힘(localStorage) */}
      {sortedCards.length === 0 ? (
        <div className="text-center py-4 text-xs text-[var(--text-dim)]">카드 거래 없음</div>
      ) : (
        <CardPerCardTable
          sortedCards={sortedCards}
          totals={totals}
          months={months}
          grandTotal={grandTotal}
        />
      )}
    </div>
  );
}

function CardPerCardTable({
  sortedCards,
  totals,
  months,
  grandTotal,
}: {
  sortedCards: any[];
  totals: Record<string, number>;
  months: string[];
  grandTotal: number;
}) {
  const STORAGE_KEY = 'card_monthly_usage_percard_collapsed';
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
    <div>
      <button
        type="button"
        onClick={toggle}
        className="flex items-center gap-1.5 mb-2 hover:opacity-80 transition"
      >
        <span className="inline-block w-3 text-center text-[10px] text-[var(--text-muted)]">{collapsed ? '▶' : '▼'}</span>
        <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">
          카드별 {sortedCards.length}장 {collapsed ? '(접힘 — 클릭하면 펼침)' : ''}
        </div>
      </button>
      {!collapsed && (
        <div className="overflow-auto -mx-2">
          <table className="w-full text-[11px]">
            <thead>
              <tr className="text-[10px] text-[var(--text-dim)] border-b border-[var(--border)]">
                <th className="text-left px-2 py-1.5 font-medium">카드</th>
                {months.map(m => (
                  <th key={m} className="text-right px-2 py-1.5 font-medium">{Number(m.slice(5, 7))}월</th>
                ))}
                <th className="text-right px-2 py-1.5 font-medium">합계</th>
              </tr>
            </thead>
            <tbody>
                {sortedCards.map(c => {
                  // R9: 체크/신용 표기 통일 — 구분 불명(미등록·미매칭) 카드는
                  //   '기타'로 일관 표기해 누락 0 (어떤 카드는 적히고 어떤 카드는
                  //   안 적히던 불일치 해소).
                  const meta = (c.cardType && CARD_TYPE_META[c.cardType]) || CARD_TYPE_META.other;
                  const variantCount = c.variants ? c.variants.size : 1;
                  const last4 = c.key.startsWith('l4:') ? c.key.slice(3) : null;
                  return (
                  <tr key={c.key} className="border-b border-[var(--border)]/40">
                    <td className="px-2 py-1.5 truncate max-w-[180px]">
                      <span className="inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold mr-1 align-middle" style={{ background: meta.bg, color: meta.color }}>
                        {meta.label}
                      </span>
                      <span className="text-[var(--text)]">{c.label}</span>
                      {last4 && (
                        <span className="ml-1 text-[9px] text-[var(--text-dim)] mono-number">··{last4}</span>
                      )}
                      {variantCount > 1 && (
                        <span
                          className="ml-1 inline-flex items-center px-1 py-0.5 rounded text-[9px] font-bold bg-[var(--primary)]/10 text-[var(--primary)] align-middle"
                          title={`끝 4자리(${last4 || '동일'})가 같은 ${variantCount}개 카드 표기를 합산 표시: ${Array.from(c.variants).join(', ')}`}
                        >
                          병합 {variantCount}
                        </span>
                      )}
                    </td>
                    {months.map(m => {
                      const v = c.byMonth[m] || 0;
                      return (
                        <td key={m} className={`px-2 py-1.5 text-right mono-number ${v > 0 ? 'text-[var(--text)]' : 'text-[var(--text-dim)]'}`}>
                          {v > 0 ? fmtW(v) : '-'}
                        </td>
                      );
                    })}
                    <td className="px-2 py-1.5 text-right font-bold mono-number text-[var(--text)]">₩{fmtW(c.total)}</td>
                  </tr>
                  );
                })}
                <tr className="bg-[var(--bg-surface)]">
                  <td className="px-2 py-1.5 font-bold text-[var(--text)]">합계</td>
                  {months.map(m => (
                    <td key={m} className="px-2 py-1.5 text-right font-bold mono-number text-[var(--text)]">
                      {(totals[m] || 0) > 0 ? fmtW(totals[m]) : '-'}
                    </td>
                  ))}
                  <td className="px-2 py-1.5 text-right font-black mono-number text-[var(--primary)]">₩{fmtW(grandTotal)}</td>
                </tr>
              </tbody>
            </table>
          </div>
      )}
    </div>
  );
}
