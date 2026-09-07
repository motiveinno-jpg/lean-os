"use client";

import { kstDateStr, todayKst } from "@/lib/kst";
import { useMemo } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { TileIcon } from "@/components/ui/icon-tile";
import { getBankTransactions } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { getRecurringPayments } from "@/lib/approval-center";
import { reconcileRecurringMonth, cardTxToLite, RECURRING_CATEGORY_LABEL, type BankTxLite } from "@/lib/recurring-match";

interface Props {
  companyId: string;
  maxItems?: number;
  /** 통장 화면 안에서 쓸 때 — 같은 화면의 거래내역 탭으로 바로 바꾼다.
   *  (링크로 /bank?tab=transactions 를 열면 이미 통장 화면이라 탭이 안 바뀐다 — 2026-09-07 사장님: "눌러도 아무 반응 없음") */
  onOpenTransactions?: () => void;
  /** 통장 화면(bank) · 카드 화면(card) — 제목과 '직접 표시' 안내만 다르고 판정·자료는 같다(통장 출금 + 카드 결제 둘 다 본다) */
  variant?: "bank" | "card";
}

function fmtKRW(n: number): string {
  return n.toLocaleString("ko-KR");
}
function startOfMonth(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}
function endOfMonth(d: Date): string {
  const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
  next.setDate(next.getDate() - 1);
  return kstDateStr(next);
}
const md = (ds: string | null | undefined) => {
  const s = String(ds || "");
  return s.length >= 10 ? `${Number(s.slice(5, 7))}/${Number(s.slice(8, 10))}` : s;
};

// 정기 지출 출금 확인 — 재무 › 정기 지출에 등록한 것(월세·보험·구독)이 이번 달 통장에서 실제로 나갔는지 한 줄씩.
//   예전 카드는 "나간 것"만 세어서 정기 지출이 3건인데 1건만 보이면 나머지가 어디 갔는지 알 수 없었다
//   (2026-09-07 사장님). 이제 등록된 정기 지출 전부를 나감 · 예정 · 확인 필요(날짜가 지났는데 출금이 안 보임)로 그린다.
//   짝 맞추기는 lib/recurring-match — 거래내역 탭의 '자동이체' 태그와 같은 규칙.
export function AutoTransferHistoryCard({ companyId, maxItems = 8, onOpenTransactions, variant = "bank" }: Props) {
  const now = new Date();
  const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const dateFrom = startOfMonth(now);
  const dateTo = endOfMonth(now);
  const today = todayKst();

  const { data: rows = [] } = useQuery({
    queryKey: ["auto-transfer-history", companyId, ym],
    queryFn: () => getBankTransactions(companyId, { dateFrom, dateTo, type: "expense" }),
    enabled: !!companyId,
    staleTime: 30_000,
  });
  //   정기 지출은 통장에서 빠지기도, 카드로 결제되기도 한다(구독·SaaS) — 카드 결제도 같이 대조한다 (2026-09-07 사장님: "카드에는 정기결제가 없어?")
  const { data: cardRows = [] } = useQuery({
    queryKey: ["auto-transfer-history-card", companyId, ym],
    queryFn: async () => {
      const { data } = await supabase.from("card_transactions")
        .select("id, transaction_date, amount, merchant_name, memo, category, card_name, is_fixed_cost")
        .eq("company_id", companyId).gte("transaction_date", dateFrom).lte("transaction_date", dateTo).gt("amount", 0)
        .order("transaction_date", { ascending: false }).limit(2000);
      return (data || []) as any[];
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });
  const { data: recurring = [] } = useQuery({
    queryKey: ["recurring-payments", companyId],
    queryFn: () => getRecurringPayments(companyId),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  const { rows: list, manualOnly } = useMemo(() => {
    const bankTx: BankTxLite[] = (rows as any[]).map((r) => ({ ...r, source: "bank" as const, sourceLabel: r.bank_accounts?.alias || r.bank_accounts?.bank_name || null }));
    const cardTx: BankTxLite[] = (cardRows as any[]).map(cardTxToLite);
    return reconcileRecurringMonth(recurring as any[], [...bankTx, ...cardTx], ym, today);
  }, [recurring, rows, cardRows, ym, today]);
  const paid = list.filter((r) => r.state === "paid");
  const missing = list.filter((r) => r.state === "missing");
  const due = list.filter((r) => r.state === "due");
  const paidTotal = paid.reduce((s, r) => s + Math.abs(Number(r.tx?.amount || 0)), 0)
    + manualOnly.reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);
  const shown = list.slice(0, maxItems);
  const txLink = onOpenTransactions
    ? <button type="button" onClick={onOpenTransactions} className="text-[var(--primary)] hover:underline font-medium">거래내역</button>
    : <Link href="/bank?tab=transactions" className="text-[var(--primary)] hover:underline font-medium">거래내역</Link>;

  return (
    <div className="auto-transfer-history-card glass-card">
      <div className="auto-transfer-history-header">
        <div className="flex items-center gap-2.5">
          <span className="kpi-icon info"><TileIcon name="repeat" className="w-5 h-5" /></span>
          <div>
            <h2 className="text-[15px] font-bold text-[var(--text)]">{variant === "card" ? "정기 지출 결제 확인" : "정기 지출 출금 확인"}</h2>
            <span className="caption">
              {ym} · 정기 지출 {list.length}건 — 나감 {paid.length}{missing.length > 0 ? ` · 확인 필요 ${missing.length}` : ""} · 예정 {due.length}
              {manualOnly.length > 0 ? ` · 직접 표시 ${manualOnly.length}` : ""}
            </span>
          </div>
        </div>
        {paidTotal > 0 && (
          <div className="text-right">
            <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">이번달 나간 금액</div>
            <div className="text-base font-black mono-number text-[var(--danger)]">₩{fmtKRW(paidTotal)}</div>
          </div>
        )}
      </div>

      {list.length === 0 && manualOnly.length === 0 ? (
        <div className="auto-transfer-history-empty">
          등록된 정기 지출이 없어요.
          <div className="text-[10px] mt-1">
            <Link href="/payments" className="text-[var(--primary)] hover:underline font-medium">정기 지출</Link>에 월세·보험·구독을 등록해 두면, 달마다 통장에서 나갔는지 여기서 확인돼요.
          </div>
        </div>
      ) : (
        <div className="auto-transfer-history-list">
          {shown.map(({ rp, state, dueDate, tx }) => {
            const cat = RECURRING_CATEGORY_LABEL[String(rp.category || "")] || rp.category || "";
            const badge = state === "paid"
              ? <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--success-dim)] text-[var(--success)] shrink-0">나감</span>
              : state === "missing"
              ? <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--warning-dim)] text-[var(--warning)] shrink-0" title="정기 지출에 적힌 날짜가 지났는데 통장에서 맞는 출금이 안 보여요 — 거래처 이름이나 금액이 다르면 거래내역에서 직접 표시하세요">확인 필요</span>
              : <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)] shrink-0">예정</span>;
            //   분류는 둘째 줄로 — 첫 줄에 배지가 둘이면 좁은 칸에서 이름이 "클…" 로 잘린다
            const tail = [rp.recipient_name, cat].filter(Boolean).join(" · ");
            const how = tx?.source === "card" ? `카드 결제${tx.sourceLabel ? `(${tx.sourceLabel})` : ""}` : `통장 출금${tx?.sourceLabel ? `(${tx.sourceLabel})` : ""}`;
            const sub = state === "paid" && tx
              ? `${md(tx.transaction_date)} ${how}${tx.counterparty ? ` · ${tx.counterparty}` : ""}${cat ? ` · ${cat}` : ""}`
              : state === "missing" && dueDate
              ? `${md(dueDate)} 예정이었는데 아직 안 나감${tail ? ` · ${tail}` : ""}`
              : dueDate ? `${md(dueDate)} 예정${tail ? ` · ${tail}` : ""}` : tail;
            return (
              <div key={String(rp.id)} className={`auto-transfer-history-row ${state === "due" ? "opacity-70" : ""}`}>
                <div className="text-[10px] text-[var(--text-dim)] w-10 mono-number">{state === "paid" && tx ? md(tx.transaction_date) : md(dueDate)}</div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-semibold text-[var(--text)] truncate">{rp.name || rp.recipient_name || "(이름 없음)"}</span>
                    {badge}
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] truncate">{sub}</div>
                </div>
                <div className={`text-sm font-bold mono-number shrink-0 ${state === "paid" ? "text-[var(--danger)]" : "text-[var(--text-muted)]"}`}>
                  ₩{fmtKRW(state === "paid" && tx ? Math.abs(Number(tx.amount || 0)) : Number(rp.amount || 0))}
                </div>
              </div>
            );
          })}
          {manualOnly.slice(0, Math.max(0, maxItems - shown.length)).map((t) => (
            <div key={String(t.id)} className="auto-transfer-history-row">
              <div className="text-[10px] text-[var(--text-dim)] w-10 mono-number">{md(t.transaction_date)}</div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-semibold text-[var(--text)] truncate">{t.counterparty || "(거래처 미상)"}</span>
                  <span className="text-[9px] px-1 py-0.5 rounded bg-sky-500/10 text-sky-600 shrink-0" title="거래내역에서 직접 표시한 줄">직접 표시</span>
                </div>
                <div className="text-[10px] text-[var(--text-dim)] truncate">{t.source === "card" ? `카드 결제${t.sourceLabel ? `(${t.sourceLabel})` : ""}` : "통장 출금"} · 정기 지출에는 없음</div>
              </div>
              <div className="text-sm font-bold mono-number text-[var(--danger)] shrink-0">₩{fmtKRW(Math.abs(Number(t.amount || 0)))}</div>
            </div>
          ))}
          <div className="text-[10px] text-[var(--text-dim)] pt-1">
            이름·금액이 달라 안 잡히는 {variant === "card" ? "결제" : "출금"}는 {txLink}에서 골라 &quot;{variant === "card" ? "정기결제 표시" : "자동이체 표시"}&quot;를 누르면 여기에 같이 모여요.
          </div>
        </div>
      )}
    </div>
  );
}
