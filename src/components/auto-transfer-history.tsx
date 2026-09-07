"use client";

import { kstDateStr, todayKst } from "@/lib/kst";
import { useMemo } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { listRecurringSuggestions, acceptRecurringSuggestion, dismissRecurringSuggestion, type DiscoveredPattern } from "@/lib/auto-discovery";
import { TileIcon } from "@/components/ui/icon-tile";
import { getBankTransactions } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { getRecurringPayments } from "@/lib/approval-center";
import { reconcileRecurringMonth, cardTxToLite, inferPayMethods, RECURRING_CATEGORY_LABEL, type BankTxLite } from "@/lib/recurring-match";

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
  const dateTo = endOfMonth(now);
  //   최근 3개월을 읽는다 — 정기 지출에는 '결제 수단' 항목이 없어서, 실제로 통장에서 나갔는지 카드로 결제됐는지를
  //   출금 이력이 말하게 한다(2026-09-07 사장님: "안형영 1,595,000 은 계좌이체인데 왜 카드 화면에"). 이번 달 대조는 그 안에서 거른다.
  const dateFrom = startOfMonth(new Date(now.getFullYear(), now.getMonth() - 2, 1));
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
        .order("transaction_date", { ascending: false }).limit(5000);
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
  //   반복 결제 추천 — 최근 6개월에서 매달 비슷한 날 비슷한 금액이 나가는데 정기 지출에 없는 것 (2026-09-07 사장님 요청)
  const qc = useQueryClient();
  const { toast } = useToast();
  const { data: suggestions = [] } = useQuery({
    queryKey: ["recurring-suggestions", companyId],
    queryFn: () => listRecurringSuggestions(companyId),
    enabled: !!companyId,
    staleTime: 300_000,
  });
  const mySuggestions = (suggestions as DiscoveredPattern[]).filter((p) => p.source === variant).slice(0, 3);
  const afterSuggest = () => {
    qc.invalidateQueries({ queryKey: ["recurring-suggestions", companyId] });
    qc.invalidateQueries({ queryKey: ["recurring-payments", companyId] });
    qc.invalidateQueries({ queryKey: ["auto-transfer-history"] });
    qc.invalidateQueries({ queryKey: ["auto-transfer-history-card"] });
    qc.invalidateQueries({ queryKey: ["bank-page-recent-tx"] });
    qc.invalidateQueries({ queryKey: ["cards-page-recent-tx"] });
  };
  const accept = async (p: DiscoveredPattern) => {
    try { await acceptRecurringSuggestion(companyId, p); toast(`'${p.name}' 을 정기 지출로 등록했어요 — 매월 ${p.dayOfMonth}일 ₩${fmtKRW(p.estimatedMonthlyCost)}`, "success"); afterSuggest(); }
    catch (e: any) { toast(`등록 실패: ${e?.message || ""}`, "error"); }
  };
  const dismiss = async (p: DiscoveredPattern) => {
    try { await dismissRecurringSuggestion(companyId, p); afterSuggest(); }
    catch (e: any) { toast(`무시 실패: ${e?.message || ""}`, "error"); }
  };

  const { rows: list, manualOnly, unknownCount } = useMemo(() => {
    const bankTx: BankTxLite[] = (rows as any[]).map((r) => ({ ...r, source: "bank" as const, sourceLabel: r.bank_accounts?.alias || r.bank_accounts?.bank_name || null }));
    const cardTx: BankTxLite[] = (cardRows as any[]).map(cardTxToLite);
    const history = [...bankTx, ...cardTx];
    const method = inferPayMethods(recurring as any[], history);
    const thisMonth = history.filter((t) => String(t.transaction_date || "").startsWith(ym));
    const all = reconcileRecurringMonth(recurring as any[], thisMonth, ym, today);
    //   이 화면의 수단(통장/카드)으로 나가는 것 + 아직 어디로 나가는지 모르는 것만. 다른 수단 것은 다른 화면이 보여 준다.
    const keep = (rp: any) => { const m = method.get(rp) || "unknown"; return m === variant || m === "unknown"; };
    return {
      rows: all.rows.filter((r) => keep(r.rp)),
      manualOnly: all.manualOnly.filter((t) => (t.source || "bank") === variant),
      unknownCount: all.rows.filter((r) => keep(r.rp) && (method.get(r.rp) || "unknown") === "unknown").length,
    };
  }, [recurring, rows, cardRows, ym, today, variant]);
  const paid = list.filter((r) => r.state === "paid");
  const missing = list.filter((r) => r.state === "missing");
  const due = list.filter((r) => r.state === "due");
  const paidTotal = paid.reduce((s, r) => s + Math.abs(Number(r.tx?.amount || 0)), 0)
    + manualOnly.reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);
  const shown = list.slice(0, maxItems);
  const txLink = onOpenTransactions
    ? <button type="button" onClick={onOpenTransactions} className="text-[var(--primary)] hover:underline font-medium">이 거래 보기 →</button>
    : <Link href="/bank?tab=transactions" className="text-[var(--primary)] hover:underline font-medium">거래내역</Link>;

  return (
    <div className="auto-transfer-history-card glass-card">
      <div className="auto-transfer-history-header">
        <div className="flex items-center gap-2.5">
          <span className="kpi-icon info"><TileIcon name="repeat" className="w-5 h-5" /></span>
          <div>
            <h2 className="text-[15px] font-bold text-[var(--text)]">{variant === "card" ? "정기 지출 결제 확인" : "정기 지출 출금 확인"}</h2>
            <span className="caption">
              {ym} · {variant === "card" ? "카드로 내는" : "통장에서 나가는"} 정기 지출 {list.length}건
              {unknownCount > 0 ? `(아직 수단 미확인 ${unknownCount})` : ""} — 나감 {paid.length}{missing.length > 0 ? ` · 확인 필요 ${missing.length}` : ""} · 예정 {due.length}
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
          {(recurring as any[]).some((r) => r.is_active !== false)
            ? (variant === "card" ? "카드로 결제되는 정기 지출이 없어요 — 등록된 것은 모두 통장에서 나가고 있어요." : "통장에서 나가는 정기 지출이 없어요 — 등록된 것은 모두 카드로 결제되고 있어요.")
            : "등록된 정기 지출이 없어요."}
          <div className="text-[10px] mt-1">
            <Link href="/payments" className="text-[var(--primary)] hover:underline font-medium">정기 지출</Link>에 월세·보험·구독을 등록해 두면, 달마다 {variant === "card" ? "카드로 결제됐는지" : "통장에서 나갔는지"} 여기서 확인돼요.
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

      {mySuggestions.length > 0 && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <div className="text-[11px] font-semibold text-[var(--text)] mb-1.5">
            매달 반복되는 {variant === "card" ? "결제" : "출금"}가 보여요 — 정기 지출로 등록할까요?
          </div>
          <div className="space-y-1.5">
            {mySuggestions.map((p) => (
              <div key={p.patternKey} className="auto-transfer-history-row">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-semibold text-[var(--text)] truncate">{p.name}</div>
                  <div className="text-[10px] text-[var(--text-dim)] truncate">{p.patternDescription}</div>
                </div>
                <div className="text-sm font-bold mono-number text-[var(--text-muted)] shrink-0">₩{fmtKRW(p.estimatedMonthlyCost)}</div>
                <button type="button" onClick={() => accept(p)} className="btn-primary btn-sm shrink-0" title="재무 › 정기 지출에 등록하고, 근거가 된 줄에 표시를 남깁니다">등록</button>
                <button type="button" onClick={() => dismiss(p)} className="btn-secondary btn-sm shrink-0" title="이 반복 결제는 다시 권하지 않습니다">무시</button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
