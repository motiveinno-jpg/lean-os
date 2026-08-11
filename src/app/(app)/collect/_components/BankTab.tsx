"use client";

// 수집·전표 3단계 — 통장 탭이 '거래 매칭'을 흡수한다 (2026-08-11)
//
//   통장 줄에 대한 질문은 하나다: **"이 돈은 무엇인가?"** 답이 셋뿐이라 '처리' 칸 하나로 끝난다.
//     ① 이미 낸 증빙의 수금·지급 → 매칭 (수금 전표가 자동으로 생긴다)
//     ② 증빙 없는 수입·지출      → 일반전표
//     ③ 내 계좌 간 이동          → 전표 없음(두 통장에 같은 돈이 두 번 찍힌다). 표시만.
//     ④ 카드대금 청구            → 카드 승인 여러 건을 이 한 줄에 묶는다(다대일)
//
//   ★ 기존 정산 기계(invoice_settlements + 트리거 7개)를 **다시 배선하지 않는다**.
//     확정 = status='confirmed' 한 줄이면 트리거가 미수금 차감·전표 생성·차액 마감까지 한다.
//     이미 잘 도는 것을 갈아엎을 이유가 없다 — 그 위에 화면만 올린다.
//
//   차액 마감은 **트리거가 자동으로** 한다 — 확정하면 차) 보통예금 / 대) 외상매출금 + 잡이익(차액)
//   까지 한 번에 만들어진다(운영 데이터로 확인). 다만 차액을 잡손익이 아닌 이자·수수료로 **바꾸는 것**과
//   **다대일(카드 여러 건이 한 번에 청구)** 은 아직 거래 매칭 화면에 남아 있다.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { fetchRuleMap, ruleKeyOf, learnAccount, ruleTag } from "@/lib/voucher-rules";

type Acct = { id: string; code: string; name: string; account_type: string };
type Deal = "match" | "voucher" | "transfer" | "card" | null;

type Sug = {
  settlementId: string;
  invoiceId: string;
  invoiceNo: string;
  invoiceAmount: number;
  amount: number;
  confidence: number;
};

type Row = {
  id: string;
  date: string;
  amount: number;
  isIn: boolean;
  who: string;
  desc: string;
  partnerId: string | null;
  posted: boolean;         // 전표가 있다
  settled: boolean;        // 매칭이 확정됐다
  settledAmount: number;
  transfer: boolean;       // 계좌 이동으로 표시됨
  voucherNo: number | null;
  entryId: string | null;          // 되돌릴 때 지울 전표
  settleIds: { id: string; type: string }[];  // 되돌릴 때 되돌릴 정산 행
  cardsLinked: number;             // 이 줄에 묶인 카드 승인 수
  sug: Sug | null;                 // 엔진이 만든 제안
};

const won = (n: number) => Math.round(Number(n) || 0).toLocaleString("ko-KR");
/** 통장 줄의 방향 — type 이 단일 기준, 비어 있을 때만 부호를 본다 (RPC post_bank_voucher 와 같은 규칙) */
function bankIsIn(type: string, amount: number): boolean {
  if (["income", "deposit", "입금", "in"].includes(type)) return true;
  if (["expense", "withdrawal", "출금", "out"].includes(type)) return false;
  return amount > 0;
}
const monthEnd = (month: string) => {
  const [y, m] = month.split("-").map(Number);
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
};

export function BankTab({ companyId, month }: { companyId: string; month: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [onlyTodo, setOnlyTodo] = useState(true);
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [deal, setDeal] = useState<Record<string, Deal>>({});
  const [acct, setAcct] = useState<Record<string, Acct>>({});
  const [partAmt, setPartAmt] = useState<Record<string, string>>({});
  const [pick, setPick] = useState<{ id: string; q: string } | null>(null);
  const [busy, setBusy] = useState(false);
  //   ④ 다대일 — 어느 통장 줄에 어느 카드 승인들을 묶을지 (거래 매칭 화면에서 옮겨 왔다)
  const [cardPick, setCardPick] = useState<{ txId: string; ids: Set<string> } | null>(null);
  //   ① 인데 제안이 없는 줄 — 계산서를 직접 찾아 붙인다 (거래 매칭의 '수동 매칭'을 옮겨 왔다)
  const [invPick, setInvPick] = useState<{ txId: string; q: string; inv: { id: string; label: string; remain: number } | null } | null>(null);
  const [aiBusy, setAiBusy] = useState(false);

  const { data: accounts = [] } = useQuery({
    queryKey: ["collect-accounts", companyId],
    queryFn: async () => {
      const data = logRead("bank:accounts", await supabase
        .from("chart_of_accounts").select("id, code, name, account_type")
        .eq("company_id", companyId).order("code"));
      return (data || []) as Acct[];
    },
    staleTime: 300_000,
  });

  //   학습된 규칙 — 입금자명/적요를 열쇠로 계정을 미리 채운다.
  //   통장은 미처리가 제일 많은 곳이라(2,541건) 학습이 가장 크게 먹힌다.
  const { data: rules } = useQuery({
    queryKey: ["voucher-rules", companyId, "bank"],
    queryFn: () => fetchRuleMap(companyId, "bank"),
    staleTime: 60_000,
  });

  //   아직 통장에 안 묶인 카드 승인 — ④ 를 고른 줄에서만 읽는다
  const { data: cardCands = [] } = useQuery({
    queryKey: ["bank-card-cands", companyId, cardPick?.txId],
    queryFn: async () => {
      const data = logRead("bank:cardcands", await supabase.from("card_transactions")
        .select("id, transaction_date, merchant_name, amount")
        .eq("company_id", companyId).is("bank_transaction_id", null)
        .order("transaction_date", { ascending: false }).limit(300));
      return ((data as any[]) || []);
    },
    enabled: !!cardPick,
  });

  //   아직 다 수금 안 된 세금계산서 — ① 에서 직접 붙일 때만 읽는다
  const { data: invCands = [] } = useQuery({
    queryKey: ["bank-inv-cands", companyId, invPick?.q],
    queryFn: async () => {
      let q = supabase.from("tax_invoices")
        .select("id, issue_date, counterparty_name, item_name, total_amount, settled_amount, type")
        .eq("company_id", companyId).neq("status", "void")
        .order("issue_date", { ascending: false }).limit(60);
      const term = (invPick?.q || "").trim();
      if (term) q = q.ilike("counterparty_name", `%${term}%`);
      const data = logRead("bank:invcands", await q);
      return ((data as any[]) || [])
        .map((r) => ({ ...r, remain: Number(r.total_amount || 0) - Number(r.settled_amount || 0) }))
        .filter((r) => r.remain > 0);
    },
    enabled: !!invPick,
  });

  const { data: rows = [], isLoading, error: rowsError } = useQuery<Row[]>({
    queryKey: ["bank-rows", companyId, month],
    queryFn: async () => {
      const from = `${month}-01`;
      const to = monthEnd(month);
      const [tx, queue] = await Promise.all([
        supabase.from("bank_transactions")
          .select("id, transaction_date, amount, type, counterparty, description, partner_id, journal_entry_id, settlement_status, settled_amount, is_auto_transfer, invoice_settlements(id, status, match_type), card_transactions!card_transactions_bank_transaction_id_fkey(id)")
          .eq("company_id", companyId)
          .gte("transaction_date", from).lt("transaction_date", to)
          .order("transaction_date").limit(400),
        //   엔진이 이미 만들어 둔 제안 — 별도 화면이 아니라 줄의 기본값으로 쓴다
        supabase.from("v_settlement_review_queue")
          .select("id, bank_transaction_id, tax_invoice_id, amount, confidence, invoice_amount, counterparty_name, issue_date")
          .eq("company_id", companyId),
      ]);
      const sugBy = new Map<string, Sug>();
      for (const q of ((queue.data as any[]) || [])) {
        if (!q.bank_transaction_id || sugBy.has(q.bank_transaction_id)) continue;
        sugBy.set(q.bank_transaction_id, {
          settlementId: q.id, invoiceId: q.tax_invoice_id,
          invoiceNo: `${q.counterparty_name || ""} ${String(q.issue_date || "").slice(5)}`.trim(),
          invoiceAmount: Number(q.invoice_amount || 0),
          amount: Number(q.amount || 0),
          confidence: Number(q.confidence || 0),
        });
      }
      //   ★ 읽기 실패를 빈 목록으로 넘기지 않는다 — '처리할 거래가 없습니다'로 보여 다 끝낸 줄 안다.
      //     (실제로 관계 모호(PGRST201)로 조용히 0건이 뜬 적이 있다)
      if (tx.error) throw new Error(tx.error.message);
      const src = ((tx.data as any[]) || []);
      const entryIds = [...new Set(src.map((r) => r.journal_entry_id).filter(Boolean))] as string[];
      const noBy = new Map<string, number | null>();
      if (entryIds.length > 0) {
        const je = logRead("bank:voucherno", await supabase
          .from("journal_entries").select("id, voucher_no").in("id", entryIds));
        for (const e of ((je as any[]) || [])) noBy.set(e.id, e.voucher_no);
      }
      return src.map((r) => {
        const amount = Number(r.amount || 0);
        return {
          id: r.id, date: String(r.transaction_date), amount,
          //   ★ 이 저장소의 bank_transactions 는 **금액이 항상 양수**이고 방향은 type 이 정한다
          //     (운영 6,906건 전수 확인: expense 4,527 / income 2,379, 음수 없음).
          //     부호로 판정하면 전부 입금이 되어 차·대가 통째로 뒤집힌다. type 을 먼저 본다.
          isIn: bankIsIn(String(r.type || ""), amount),
          who: r.counterparty || "—", desc: r.description || "",
          partnerId: r.partner_id || null,
          posted: !!r.journal_entry_id,
          settled: ["settled", "partial"].includes(String(r.settlement_status || "")),
          settledAmount: Number(r.settled_amount || 0),
          transfer: !!r.is_auto_transfer,
          voucherNo: r.journal_entry_id ? (noBy.get(r.journal_entry_id) ?? null) : null,
          entryId: r.journal_entry_id ?? null,
          settleIds: ((r.invoice_settlements || []) as any[])
            .filter((m) => m.status === "confirmed")
            .map((m) => ({ id: m.id, type: String(m.match_type || "") })),
          cardsLinked: ((r.card_transactions || []) as any[]).length,
          sug: sugBy.get(r.id) ?? null,
        } as Row;
      });
    },
  });

  const keyOf = (r: Row) => ruleKeyOf("bank", { name: r.who, fallback: r.desc });
  /** 이 줄에 붙일 계정 — 사람이 고른 것 > 학습된 규칙 */
  const acctOf = (r: Row): { a: Acct | null; via: "고름" | "지난번" | "학습" | null } => {
    if (acct[r.id]) return { a: acct[r.id], via: "고름" };
    const hit = rules?.get(keyOf(r).key);
    if (hit?.account) return { a: hit.account as Acct, via: ruleTag(hit.hit_count) };
    return { a: null, via: null };
  };

  //   처리 기본값 — ① 제안이 있으면 매칭, 없는데 학습된 계정이 있으면 ② 일반전표
  const dealOf = (r: Row): Deal => deal[r.id] ?? (r.sug ? "match" : (acctOf(r).a ? "voucher" : null));
  const doneOf = (r: Row) => r.posted || r.settled || r.transfer;

  const shown = rows.filter((r) => (onlyTodo ? !doneOf(r) : true));
  const selRows = shown.filter((r) => sel.has(r.id));
  const sugCount = shown.filter((r) => r.sug).length;

  //   확정할 수 있는 줄인가 — ①은 제안, ②는 계정, ③은 그냥 가능
  const ready = (r: Row) => {
    const d = dealOf(r);
    if (d === "match") return !!r.sug || (invPick?.txId === r.id && !!invPick.inv);
    if (d === "voucher") return !!acctOf(r).a;
    if (d === "transfer") return true;
    if (d === "card") return cardPick?.txId === r.id && cardPick.ids.size > 0;
    return false;
  };
  const notReady = selRows.filter((r) => !ready(r));

  const confirmAll = async () => {
    if (selRows.length === 0 || busy) return;
    setBusy(true);
    let ok = 0;
    const fails: string[] = [];
    for (const r of selRows) {
      const d = dealOf(r);
      try {
        if (d === "match" && (r.sug || (invPick?.txId === r.id && invPick.inv))) {
          //   부분수금 — 사람이 금액을 줄여 놨으면 그 금액으로 확정한다.
          //   나머지는 트리거가 알아서: 미수금 차감·수금 전표·차액 마감.
          const typed = Number(String(partAmt[r.id] ?? "").replace(/[^0-9-]/g, ""));
          if (r.sug) {
            const amount = typed > 0 ? typed : r.sug.amount;
            const { error } = await supabase.from("invoice_settlements")
              .update({ status: "confirmed", amount }).eq("id", r.sug.settlementId);
            if (error) throw error;
          } else {
            //   제안이 없어 사람이 직접 고른 계산서에 붙인다 (거래 매칭의 '수동 연결'과 같은 규칙).
            //   같은 (거래, 계산서) 쌍에 이력이 있으면 새로 넣지 않고 그 행을 확정으로 올린다.
            const inv = invPick!.inv!;
            const amount = typed > 0 ? typed : Math.min(Math.abs(r.amount), inv.remain);
            const existing = logRead("bank:existing-settle", await supabase.from("invoice_settlements")
              .select("id").eq("bank_transaction_id", r.id).eq("tax_invoice_id", inv.id).maybeSingle());
            if (existing) {
              const { error } = await supabase.from("invoice_settlements")
                .update({ amount, match_type: "manual", match_source: "manual", status: "confirmed", confidence: 1, reason: "수동 연결" })
                .eq("id", (existing as any).id);
              if (error) throw error;
            } else {
              const { error } = await supabase.from("invoice_settlements").insert({
                company_id: companyId, bank_transaction_id: r.id, tax_invoice_id: inv.id,
                amount, match_type: "manual", match_source: "manual", status: "confirmed", confidence: 1, reason: "수동 연결",
              });
              if (error) throw error;
            }
            setInvPick(null);
          }
        } else if (d === "voucher") {
          const a = acctOf(r).a;
          if (!a) throw new Error("계정을 먼저 고르세요");
          //   거래 매칭 화면이 쓰던 것과 **같은 RPC**를 쓴다 — 3단계에서 잠깐 중복 함수를
          //   만들었다가 하나로 합쳤다(같은 일을 하는 함수가 둘이면 한쪽만 고쳐지는 사고가 난다).
          const { error } = await (supabase.rpc as any)("post_bank_voucher", {
            p_bank_tx_id: r.id, p_account_id: a.id, p_remember: false, p_memo: r.desc || r.who,
          });
          if (error) throw error;
          //   사람이 고른 것을 배운다 — 같은 입금자·적요가 또 나오면 미리 채운다
          const k = keyOf(r);
          await learnAccount({ kind: "bank", key: k.key, label: k.label, accountId: a.id });
        } else if (d === "card") {
          //   카드 승인 여러 건을 이 통장 줄에 묶는다. 전표는 만들지 않는다 —
          //   승인 건 각각이 매입매출전표로 미지급금을 세우고, 이 줄은 그 청구(결제)일 뿐이다.
          //   거래 매칭 화면이 하던 것과 **같은 동작**을 자리만 옮겼다.
          const ids = [...(cardPick?.ids ?? [])];
          if (ids.length === 0) throw new Error("묶을 카드 승인을 고르세요");
          const { error: e1 } = await supabase.from("card_transactions")
            .update({ bank_transaction_id: r.id }).in("id", ids);
          if (e1) throw e1;
          const { error: e2 } = await supabase.from("bank_transactions")
            .update({ settlement_status: "settled", settled_amount: Math.abs(r.amount) }).eq("id", r.id);
          if (e2) throw e2;
          setCardPick(null);
        } else if (d === "transfer") {
          //   계좌 이동은 전표를 만들지 않는다 — 두 통장에 같은 돈이 두 번 찍히기 때문이다.
          //   '처리했음'만 남겨 미처리 목록에서 빠지게 한다.
          //   is_auto_transfer 만 세운다. mapping_status(비목 분류 상태)는 /bank 화면 배지가 쓰는
          //   다른 칸이라 손대지 않는다 — 칸의 주인을 침범하면 거짓 신호가 된다.
          const { error } = await supabase.from("bank_transactions")
            .update({ is_auto_transfer: true }).eq("id", r.id);
          if (error) throw error;
        } else {
          throw new Error("처리 방법을 고르세요");
        }
        ok += 1;
      } catch (e: any) {
        const m = String(e?.message || "");
        fails.push(`${r.who}: ${
          m.includes("PERIOD_LOCKED") ? "마감된 달"
          : m.includes("ALREADY_POSTED") ? "이미 전표가 있음"
          : m.includes("NO_BANK_ACCOUNT") ? "계정과목에 101 보통예금이 없습니다"
          : friendlyError(e, m || "실패")}`);
      }
    }
    setSel(new Set());
    qc.invalidateQueries({ queryKey: ["bank-rows"] });
    qc.invalidateQueries({ queryKey: ["collect-status"] });
    qc.invalidateQueries({ queryKey: ["voucher-rules"] });
    qc.invalidateQueries({ queryKey: ["bank-card-cands"] });
    setBusy(false);
    if (ok > 0 && fails.length === 0) toast(`${ok}건을 처리했습니다`, "success");
    else if (ok > 0) toast(`${ok}건 성공 · ${fails.length}건 실패 — ${fails[0]}`, "info");
    else toast(`처리하지 못했습니다 — ${fails[0] ?? "알 수 없는 오류"}`, "error");
  };

  /** 처리한 줄 되돌리기 — 무엇으로 처리했느냐에 따라 길이 다르다 */
  const undo = async (r: Row) => {
    if (busy) return;
    setBusy(true);
    try {
      if (r.posted) {
        //   전표를 지우면 FK(ON DELETE SET NULL)가 통장 줄을 미처리로 되돌린다
        const { error } = await supabase.from("journal_entries").delete().eq("id", r.entryId!);
        if (error) throw error;
      } else if (r.transfer) {
        const { error } = await supabase.from("bank_transactions").update({ is_auto_transfer: false }).eq("id", r.id);
        if (error) throw error;
      } else if (r.cardsLinked > 0) {
        const { error: e1 } = await supabase.from("card_transactions").update({ bank_transaction_id: null }).eq("bank_transaction_id", r.id);
        if (e1) throw e1;
        const { error: e2 } = await supabase.from("bank_transactions")
          .update({ settlement_status: "open", settled_amount: 0 }).eq("id", r.id);
        if (e2) throw e2;
      } else if (r.settleIds.length > 0) {
        //   status 를 되돌리면 trg_recalc_settlement 가 미수금·전표를 원복한다.
        //   차액 마감(adjustment)은 통장 거래가 없어 확인 큐로 못 돌아가므로 'rejected' 로 종결한다
        //   — 거래 매칭 화면이 쓰던 규칙 그대로다.
        for (const m of r.settleIds) {
          const { error } = await supabase.from("invoice_settlements")
            .update({ status: m.type === "adjustment" ? "rejected" : "suggested" }).eq("id", m.id);
          if (error) throw error;
        }
      } else {
        toast("되돌릴 처리가 없습니다", "info"); setBusy(false); return;
      }
      qc.invalidateQueries({ queryKey: ["bank-rows"] });
      qc.invalidateQueries({ queryKey: ["collect-status"] });
      qc.invalidateQueries({ queryKey: ["bank-card-cands"] });
      toast("되돌렸습니다 — 미처리로 돌아왔습니다", "info");
    } catch (e: any) {
      toast(`되돌리지 못했습니다 — ${friendlyError(e, String(e?.message || ""))}`, "error");
    } finally { setBusy(false); }
  };

  /** AI 전체 매칭 — 제안을 새로 만든다. 거래 매칭 화면이 하던 것과 같은 엣지 함수를 쓴다. */
  const runAiMatch = async () => {
    if (aiBusy) return;
    setAiBusy(true);
    try {
      let processed = 0, suggested = 0;
      for (let round = 0; round < 100; round++) {   // 안전 상한 (거래 매칭 화면과 같은 값)
        const { data, error } = await supabase.functions.invoke("settlement-ai-match", { body: { companyId, limit: 50 } });
        if (error) throw new Error(error.message);
        if ((data as any)?.error) throw new Error((data as any).error);
        const rr = data as { processed: number; suggested: number };
        processed += rr.processed || 0; suggested += rr.suggested || 0;
        if ((rr.processed || 0) === 0) break;
      }
      qc.invalidateQueries({ queryKey: ["bank-rows"] });
      toast(`AI 매칭 완료 — ${processed}건 분석 · 제안 ${suggested}건`, "success");
    } catch (e: any) {
      toast(e?.message || "AI 매칭 실패", "error");
    } finally { setAiBusy(false); }
  };

  const toggle = (id: string) =>
    setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allOn = shown.length > 0 && shown.filter((r) => !doneOf(r)).every((r) => sel.has(r.id));

  const filterAccts = (q: string, isIn: boolean) =>
    accounts.filter((a) =>
      a.account_type === (isIn ? "revenue" : "expense")
      && (!q || a.name.toLowerCase().includes(q.toLowerCase()) || String(a.code).includes(q))).slice(0, 40);

  const sumIn = useMemo(() => shown.filter((r) => r.isIn).reduce((n, r) => n + Math.abs(r.amount), 0), [shown]);
  const sumOut = useMemo(() => shown.filter((r) => !r.isIn).reduce((n, r) => n + Math.abs(r.amount), 0), [shown]);

  return (
    <div className="ev-wrap">
      <div className="collect-toolbar">
        <button type="button" onClick={() => setOnlyTodo((v) => !v)}
          className={onlyTodo ? "ev-filter ev-filter-on" : "ev-filter"}>
          {onlyTodo ? "미처리만" : "전체 보기"}
        </button>
        <span className="collect-toolbar-hint">
          {shown.length}건 · 입금 <b className="mono-number">{won(sumIn)}</b> · 출금 <b className="mono-number">{won(sumOut)}</b>
          {sugCount > 0 && <> · 제안 있음 <b className="mono-number">{won(sugCount)}</b></>}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {notReady.length > 0 && <span className="ev-warn">{notReady.length}건은 처리 방법·계정이 필요합니다</span>}
          {/*   제안을 새로 만든다 — 거래 매칭 화면의 'AI 전체 매칭'을 옮겨 왔다 */}
          <button type="button" onClick={runAiMatch} disabled={aiBusy}
            className="btn-secondary btn-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {aiBusy ? "매칭 중…" : "AI 매칭 돌리기"}
          </button>
          <button type="button" onClick={confirmAll} disabled={selRows.length === 0 || busy}
            className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed">
            {busy ? "처리 중…" : `확정${selRows.length > 0 ? ` (${selRows.length})` : ""}`}
          </button>
        </div>
      </div>

      {rowsError ? (
        <div className="collect-empty collect-empty-err">
          통장 거래를 읽지 못했습니다 — {String((rowsError as any)?.message || "알 수 없는 오류")}
        </div>
      ) : isLoading ? (
        <div className="collect-empty">읽는 중…</div>
      ) : shown.length === 0 ? (
        <div className="collect-empty">
          {onlyTodo ? "처리할 통장 거래가 없습니다 — 이 달치는 다 끝냈습니다." : "이 달에 통장 거래가 없습니다."}
        </div>
      ) : (
        <div className="ev-scroll glass-card">
          <table className="ev-table bk-table">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <button type="button" aria-label="전체 선택"
                    onClick={() => setSel(allOn ? new Set() : new Set(shown.filter((r) => !doneOf(r)).map((r) => r.id)))}
                    className={allOn ? "collect-chk collect-chk-on" : "collect-chk"}>{allOn ? "✓" : ""}</button>
                </th>
                <th>일자</th><th>입/출</th><th>거래처(입금자)</th><th>적요</th>
                <th className="tr">금액</th><th style={{ width: 178 }}>처리</th><th>붙는 곳</th><th>상태</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((r) => {
                const done = doneOf(r);
                const d = dealOf(r);
                const on = sel.has(r.id);
                return (
                  <tr key={r.id} className={done ? "ev-posted" : on ? "ev-on" : ""}>
                    <td>
                      {!done && (
                        <button type="button" onClick={() => toggle(r.id)} aria-label="선택"
                          className={on ? "collect-chk collect-chk-on" : "collect-chk"}>{on ? "✓" : ""}</button>
                      )}
                    </td>
                    <td className="mono-number">{r.date.slice(5)}</td>
                    <td>
                      <em className={r.isIn ? "spv-type spv-type-s" : "spv-type spv-type-b"}>{r.isIn ? "입금" : "출금"}</em>
                    </td>
                    <td className="ev-ell">{r.who}</td>
                    <td className="ev-ell ev-dim">{r.desc || "—"}</td>
                    <td className={r.isIn ? "tr mono-number bk-in" : "tr mono-number bk-out"}>
                      {r.isIn ? "" : "-"}{won(Math.abs(r.amount))}
                    </td>
                    <td>
                      {done ? (
                        <span className="ev-dim">{r.transfer ? "계좌 이동" : r.posted ? "일반전표" : "증빙 수금·카드대금"}</span>
                      ) : (
                        <select className="ev-sel" value={d ?? ""}
                          onChange={(e) => {
                            const v = (e.target.value || null) as Deal;
                            setDeal((o) => ({ ...o, [r.id]: v }));
                            //   ④ 를 고르면 이 줄에 묶을 카드 고르는 자리를 연다 (한 번에 한 줄만)
                            setCardPick(v === "card" ? { txId: r.id, ids: new Set() } : null);
                          }}>
                          <option value="">— 고르세요</option>
                          <option value="match" disabled={!r.sug}>① 증빙 수금{r.sug ? "" : " (제안 없음)"}</option>
                          <option value="voucher">② 일반전표</option>
                          <option value="transfer">③ 계좌 이동</option>
                          <option value="card" disabled={r.isIn}>④ 카드대금 청구{r.isIn ? " (출금만)" : ""}</option>
                        </select>
                      )}
                    </td>
                    <td>
                      {done ? (
                        <span className="ev-dim">
                          {r.settled ? `수금 ${won(r.settledAmount)}` : r.transfer ? "손익 무관" : "—"}
                        </span>
                      ) : d === "match" && r.sug ? (
                        <span className="bk-sug">
                          <span className="ev-ell">{r.sug.invoiceNo}</span>
                          <em className="ev-via">제안 {Math.round(r.sug.confidence * 100)}%</em>
                          {/*   부분수금 — 계산서보다 적게 들어왔으면 금액을 줄여 확정한다. 잔액은 트리거가 남긴다 */}
                          <input className="bk-amt mono-number" placeholder={won(r.sug.amount)}
                            value={partAmt[r.id] ?? ""}
                            onChange={(e) => setPartAmt((o) => ({ ...o, [r.id]: e.target.value }))} />
                          {r.sug.invoiceAmount > 0 && r.sug.amount < r.sug.invoiceAmount && (
                            <em className="bk-part">계산서 {won(r.sug.invoiceAmount)} 중</em>
                          )}
                        </span>
                      ) : d === "voucher" ? (
                        <span className="relative inline-block">
                          <button type="button" onClick={() => setPick(pick?.id === r.id ? null : { id: r.id, q: "" })}
                            className={acctOf(r).a ? "ev-acct" : "ev-acct ev-acct-empty"}>
                            {acctOf(r).a ? `${acctOf(r).a!.code} ${acctOf(r).a!.name}` : (r.isIn ? "수익 계정 고르기" : "비용 계정 고르기")}
                            {acctOf(r).via && acctOf(r).via !== "고름" && <em className="ev-via">{acctOf(r).via}</em>}
                          </button>
                          {pick?.id === r.id && (
                            <span className="spv-drop spv-drop-acct">
                              <input autoFocus value={pick.q} onChange={(e) => setPick({ id: r.id, q: e.target.value })}
                                placeholder="계정과목 검색 (이름·코드)" className="spv-drop-search" />
                              <span className="spv-drop-list">
                                {filterAccts(pick.q, r.isIn).map((a) => (
                                  <button key={a.id} type="button"
                                    onClick={() => { setAcct((o) => ({ ...o, [r.id]: a })); setPick(null); }}>
                                    <span className="spv-drop-code">{a.code}</span>
                                    <span className="spv-drop-name">{a.name}</span>
                                  </button>
                                ))}
                              </span>
                            </span>
                          )}
                        </span>
                      ) : d === "match" && !r.sug ? (
                        <span className="bk-cards">
                          {invPick?.txId === r.id && invPick.inv ? (
                            <span className="bk-cards-head">
                              {invPick.inv.label}
                              <em className="bk-cards-sum mono-number">남은 {won(invPick.inv.remain)} / 입금 {won(Math.abs(r.amount))}</em>
                              <button type="button" className="bk-clear" onClick={() => setInvPick({ txId: r.id, q: "", inv: null })}>바꾸기</button>
                            </span>
                          ) : (
                            <>
                              <input className="bk-search" placeholder="거래처명으로 계산서 찾기"
                                value={invPick?.txId === r.id ? invPick.q : ""}
                                onFocus={() => setInvPick({ txId: r.id, q: "", inv: null })}
                                onChange={(e) => setInvPick({ txId: r.id, q: e.target.value, inv: null })} />
                              {invPick?.txId === r.id && (
                                <span className="bk-cards-list">
                                  {invCands.length === 0 ? (
                                    <em className="ev-dim">남은 금액이 있는 계산서가 없습니다</em>
                                  ) : invCands.slice(0, 30).map((c: any) => (
                                    <button key={c.id} type="button" className="bk-card-chip"
                                      onClick={() => setInvPick({
                                        txId: r.id, q: invPick.q,
                                        inv: { id: c.id, label: `${c.counterparty_name || "—"} ${String(c.issue_date).slice(5)}`, remain: c.remain },
                                      })}>
                                      {String(c.issue_date).slice(5)} {c.counterparty_name || "—"}
                                      <b className="mono-number">{won(c.remain)}</b>
                                    </button>
                                  ))}
                                </span>
                              )}
                            </>
                          )}
                        </span>
                      ) : d === "card" ? (
                        <span className="bk-cards">
                          <span className="bk-cards-head">
                            묶을 카드 승인 <b className="mono-number">{cardPick?.txId === r.id ? cardPick.ids.size : 0}</b>건
                            {cardPick?.txId === r.id && cardPick.ids.size > 0 && (
                              <em className="bk-cards-sum mono-number">
                                합계 {won(cardCands.filter((c: any) => cardPick.ids.has(c.id))
                                  .reduce((n: number, c: any) => n + Math.abs(Number(c.amount || 0)), 0))}
                                {" / 출금 "}{won(Math.abs(r.amount))}
                              </em>
                            )}
                          </span>
                          <span className="bk-cards-list">
                            {cardCands.length === 0 ? (
                              <em className="ev-dim">아직 통장에 안 묶인 카드 승인이 없습니다</em>
                            ) : cardCands.slice(0, 40).map((c: any) => {
                              const on = cardPick?.txId === r.id && cardPick.ids.has(c.id);
                              return (
                                <button key={c.id} type="button"
                                  className={on ? "bk-card-chip bk-card-chip-on" : "bk-card-chip"}
                                  onClick={() => setCardPick((p) => {
                                    if (!p || p.txId !== r.id) return { txId: r.id, ids: new Set([c.id]) };
                                    const ids = new Set(p.ids);
                                    if (ids.has(c.id)) ids.delete(c.id); else ids.add(c.id);
                                    return { txId: r.id, ids };
                                  })}>
                                  {String(c.transaction_date).slice(5)} {c.merchant_name || "—"}
                                  <b className="mono-number">{won(Math.abs(Number(c.amount || 0)))}</b>
                                </button>
                              );
                            })}
                          </span>
                        </span>
                      ) : d === "transfer" ? (
                        <span className="ev-dim">전표를 만들지 않습니다 — 손익과 무관</span>
                      ) : (
                        <span className="ev-dim">제안 없음 — 직접 고릅니다</span>
                      )}
                    </td>
                    <td>
                      {done ? (
                        <span className="bk-done">
                          <span className="ev-st ev-st-done">
                            {r.transfer ? "이동 표시" : r.voucherNo != null ? `#${r.voucherNo} 확정` : "확정"}
                          </span>
                          {/*   잘못 처리한 걸 되돌릴 수 있어야 한다 — 거래 매칭의 '확정 취소'를 옮겨 왔다 */}
                          <button type="button" onClick={() => undo(r)} disabled={busy} className="rules-del">되돌리기</button>
                        </span>
                      ) : <span className="ev-st ev-st-todo">미처리</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <p className="collect-note">
        ※ <b>① 증빙 수금</b>을 확정하면 미수금이 줄고 <b>수금 전표가 자동으로</b> 생깁니다(기존 매칭과 같은 길).
        금액 칸에 적게 적으면 <b>부분 수금</b>으로 처리되고 잔액이 남습니다.
        수수료 등으로 몇 원 어긋난 <b>차액은 잡손익으로 자동 마감</b>됩니다.
        <b>③ 계좌 이동</b>은 전표를 만들지 않습니다 — 두 통장에 같은 돈이 두 번 찍히기 때문입니다.
        <b>②</b>에서 고른 계정은 <b>입금자·적요로 기억</b>해 다음에 미리 채웁니다(<b>지난번</b> → 3번 이상이면 <b>학습</b>).
        <b>④ 카드대금 청구</b>는 카드 승인 여러 건을 이 한 줄에 묶습니다 — 전표는 만들지 않습니다
        (승인 건 각각이 매입매출전표로 미지급금을 세우고, 이 줄은 그 결제일 뿐입니다).
        <b>제안이 없으면</b> 거래처명으로 계산서를 찾아 직접 붙입니다. 잘못 처리했으면 <b>되돌리기</b>로 미처리로 돌립니다.
        차액을 이자·수수료 등 <b>다른 계정으로 바꾸는 것</b>은{" "}
        <Link href="/partners/ledger" className="bk-link">거래처 원장</Link>에서 그 전표를 눌러 고칩니다.
      </p>
    </div>
  );
}
