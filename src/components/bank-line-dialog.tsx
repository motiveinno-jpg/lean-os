"use client";

// ── 통장 줄 처리 팝업 — 증빙 연결 · 일반전표 · 장부 제외 (2026-08-27 사장님: "계정과목 매핑은 필요 없다, 증빙과 연결하는 걸로") ──
//
//   History: 통장 줄의 상태 칩은 '분류(카테고리) 매핑' 팝오버를 열었다(2026-05). 분류는 category 글자만 적고
//   전표를 만들지 않아 "매핑 완료" 뒤에도 장부에는 아무것도 없었다. 전표는 수집·전표 통장 탭에서 따로,
//   계산서 짝은 거래매칭 화면에서 또 따로 — 한 줄을 처리하려고 세 화면을 돌았다.
//
//   결정 43 — 통장 줄을 처리하는 길은 셋뿐이고 한 팝업에서 고른다.
//     ① 증빙 연결: 세금계산서·계산서와 짝을 지어 **정산 전표 초안(연결 대기)** 을 만든다. 확정은 사람이 누른다
//        (확정하면 DB 트리거 trg_settlement_post_voucher 가 외상매출금/외상매입금 ↔ 보통예금 정산 전표를 만든다).
//        후보는 자동으로 찾아 주되(금액 ±10% 문턱 · 거래처 겹침 가산 — 수집·전표 통장 탭과 같은 기준) 근거를 함께 적는다.
//     ② 일반전표: 증빙이 없는 줄(이자·수수료·급여·임차료 …). 상대 계정·거래처·적요만 고르고 보통예금 쪽은 서버가 붙인다
//        (post_bank_manual_voucher). 계정은 '내가 배운 규칙'(voucher_account_rules)으로 미리 채운다.
//     ③ 장부 제외: 계좌 간 이체·개인·중복 — 사유를 남기고 장부에서 뺀다.
//   결정 44 — 제안은 자동, 확정은 사람. 증빙 후보를 골라도 곧바로 전표가 되지 않는다(연결 대기). 재무 › 전표 현황 › 처리할 것에서도 확정·반려한다.
//   결정 46 — '연결 대기'는 **사람이 고른 초안(match_source manual)** 만. 매칭 엔진·AI 가 쌓아 둔 suggested/needs_review(모티브 prod 696건)는
//              이 팝업 안에서 '매칭 제안' 으로 출처를 적어 보여 주고 확정·반려할 뿐, 상태 칩·처리할 것 건수에는 넣지 않는다 — 안 그러면 할 일이 아닌 것이 할 일로 보인다.
//   결정 45 — 분류(category) 매핑은 없앤다. 메모·태그·사용직원·고정비 표시는 전표와 무관한 '줄 메모'라 남긴다.
//   기획: docs/20260827_PLAN_bank_line_process.md

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { PickList } from "@/components/pick-list";
import { fetchRuleMap, ruleKeyOf, learnAccount, ruleTag } from "@/lib/voucher-rules";
import { setLedgerExcluded, EXCLUDE_REASONS, excludeLabelOf } from "@/lib/dup-voucher";
import { useModalKeys } from "@/hooks/use-modal-keys";

export type BankLineTx = {
  id: string; transaction_date: string; type: string; amount: number;
  counterparty: string | null; description: string | null;
  partner_id?: string | null; journal_entry_id?: string | null; ledger_excluded_reason?: string | null;
  settlement_status?: string | null; settled_amount?: number | null; tax_invoice_id?: string | null;
  memo?: string | null; tags?: string[] | null; used_by_employee_id?: string | null; is_fixed_cost?: boolean | null;
};
type Acct = { id: string; code: string; name: string; account_type: string };
type Pt = { id: string; name: string };
type Inv = { id: string; type: string; issue_date: string; counterparty_name: string | null; partner_id: string | null; total_amount: number; settled_amount: number | null; item_name: string | null; status: string | null };
type Settle = { id: string; tax_invoice_id: string; amount: number; status: string; match_source: string; reason: string | null; tax_invoices: { counterparty_name: string | null; total_amount: number; issue_date: string } | null };

const won = (n: number) => Math.round(n).toLocaleString("ko-KR");
/** 이름 비교용 알맹이 — 법인 꼬리표·공백을 뗀다 (수집·전표 통장 탭과 같은 규칙) */
const coreName = (v: unknown) => String(v || "").toLowerCase()
  .replace(/주식회사|유한회사|유한책임회사|합자회사|합명회사|농업회사법인|영농조합법인|어업회사법인|협동조합|사회적협동조합|\(주\)|㈜|\(유\)/g, "")
  .replace(/[\s　·,.\-_()]/g, "");

export type BankLineState = "unposted" | "pending" | "linked" | "posted" | "excluded";
export const BANK_LINE_META: Record<BankLineState, { label: string; cls: string; hint: string }> = {
  unposted: { label: "미처리", cls: "bl-state-unposted", hint: "아직 장부에 없는 줄 — 눌러서 증빙 연결 · 일반전표 · 장부 제외" },
  pending: { label: "연결 대기", cls: "bl-state-pending", hint: "증빙 연결 초안이 있음 — 확정해야 전표가 된다" },
  linked: { label: "증빙 연결", cls: "bl-state-linked", hint: "계산서와 정산 전표로 묶임" },
  posted: { label: "전표됨", cls: "bl-state-posted", hint: "일반전표로 장부에 올라감" },
  excluded: { label: "장부 제외", cls: "bl-state-excluded", hint: "이체·개인·중복 — 장부에서 뺌" },
};
/** 한 줄의 상태 — 우선순위: 제외 > 증빙 연결(정산 확정) > 전표됨 > 연결 대기 > 미처리 */
export function bankLineState(tx: BankLineTx, pendingIds?: Set<string>): BankLineState {
  if (tx.ledger_excluded_reason) return "excluded";
  const st = tx.settlement_status || "open";
  if (st === "settled" || st === "partial" || (tx.settled_amount || 0) > 0) return "linked";
  if (tx.journal_entry_id) return "posted";
  if (pendingIds?.has(tx.id)) return "pending";
  return "unposted";
}

/** 정산 초안 확정·반려 — 잠긴 달이면 확정하지 않는다(트리거가 전표를 안 만들어 '확정'만 남는다). 확정 뒤 전표가 실제로 생겼는지 되짚는다. */
export async function decideSettlement(id: string, st: "confirmed" | "rejected", companyId: string, txDate?: string | null): Promise<"posted" | "rejected" | "locked" | "no_voucher"> {
  if (st === "confirmed" && txDate) {
    const { count } = await (supabase as any).from("closing_checklists").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("month", txDate.slice(0, 7)).eq("status", "locked");
    if (count) return "locked";
  }
  const { error } = await (supabase as any).from("invoice_settlements").update({ status: st }).eq("id", id);
  if (error) throw error;
  if (st === "rejected") return "rejected";
  const { count: n } = await (supabase as any).from("journal_entries").select("id", { count: "exact", head: true }).eq("linked_settlement_id", id).neq("status", "rejected");
  return n ? "posted" : "no_voucher";
}
export const settlementResultToast = (r: "posted" | "rejected" | "locked" | "no_voucher", month?: string): { msg: string; kind: "success" | "error" | "info" } =>
  r === "posted" ? { msg: "확정 — 정산 전표를 만들었습니다", kind: "success" }
  : r === "rejected" ? { msg: "반려했습니다", kind: "success" }
  : r === "locked" ? { msg: `${month || "그 달"}은 회계마감으로 잠겨 있어 확정하지 않았습니다 — 전표가 생기지 않습니다. 마감을 풀고 다시 확정하세요`, kind: "error" }
  : { msg: "확정했지만 전표가 생기지 않았습니다 — 계정과목에 103 보통예금·108 외상매출금·251 외상매입금이 있는지 확인하세요", kind: "info" };

export function BankLineDialog({ tx, companyId, onClose, onDone }: {
  tx: BankLineTx; companyId: string; onClose: () => void; onDone?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  useModalKeys(true, onClose);
  const isIn = tx.type === "income";
  const amt = Math.abs(Number(tx.amount || 0));
  const [tab, setTab] = useState<"link" | "voucher" | "exclude">("link");
  const [busy, setBusy] = useState(false);

  // ── 읽기: 계정 · 거래처 · 규칙 · 열린 계산서 · 이 줄의 정산 초안 ──
  const { data: accounts = [] } = useQuery({
    queryKey: ["bank-line-accounts", companyId],
    queryFn: async () => (logRead("bank-line:accounts", await supabase.from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId).order("code")) || []) as Acct[],
    staleTime: 300_000,
  });
  const { data: partners = [] } = useQuery({
    queryKey: ["bank-partners", companyId],
    queryFn: async () => (await fetchPaged<any>("bank-line:partners", () => supabase.from("partners").select("id, name").eq("company_id", companyId).order("name"), 50000) || []) as Pt[],
    staleTime: 300_000,
  });
  const { data: ruleMap } = useQuery({ queryKey: ["voucher-rules", companyId, "bank"], queryFn: () => fetchRuleMap(companyId, "bank"), staleTime: 60_000 });
  const { data: invoices = [] } = useQuery({
    queryKey: ["bank-line-invoices", companyId, isIn ? "sales" : "purchase"],
    queryFn: async () => {
      const since = new Date(); since.setFullYear(since.getFullYear() - 1);
      const data = await fetchPaged<any>("bank-line-invoices", () => supabase.from("tax_invoices")
        .select("id, type, issue_date, counterparty_name, partner_id, total_amount, settled_amount, item_name, status")
        .eq("company_id", companyId).eq("type", isIn ? "sales" : "purchase")
        .not("status", "in", "(void,modified)")
        .gte("issue_date", since.toISOString().slice(0, 10))
        .order("issue_date", { ascending: false }).order("id"), 50000);
      //   남은 금액이 있는 것만 — 다 정산된 계산서는 후보가 아니다. 취소(마이너스) 장과 짝이 맞는 원본도 뺀다
      const rows = (data || []) as Inv[];
      const cancels = new Set(rows.filter((x) => Number(x.total_amount) < 0).map((x) => `${String(x.counterparty_name || "").trim()}|${Math.abs(Number(x.total_amount))}`));
      return rows.filter((x) => {
        const t = Number(x.total_amount || 0);
        if (t <= 0) return false;
        const k = `${String(x.counterparty_name || "").trim()}|${t}`;
        if (cancels.has(k)) { cancels.delete(k); return false; }
        return t - Number(x.settled_amount || 0) > 0;
      });
    },
    staleTime: 60_000,
  });
  const { data: settles = [], refetch: refetchSettles } = useQuery({
    queryKey: ["bank-line-settles", tx.id],
    queryFn: async () => (logRead("bank-line:settles", await (supabase as any).from("invoice_settlements")
      .select("id, tax_invoice_id, amount, status, match_source, reason, tax_invoices(counterparty_name, total_amount, issue_date)")
      .eq("bank_transaction_id", tx.id).neq("status", "rejected").order("created_at")) || []) as Settle[],
  });
  const { data: monthLocked = false } = useQuery({
    queryKey: ["bank-line-month-locked", companyId, tx.transaction_date?.slice(0, 7)],
    queryFn: async () => { const { count } = await (supabase as any).from("closing_checklists").select("id", { count: "exact", head: true }).eq("company_id", companyId).eq("month", tx.transaction_date.slice(0, 7)).eq("status", "locked"); return !!count; },
    staleTime: 60_000,
  });
  const remainingOf = (inv: Inv) => Number(inv.total_amount || 0) - Number(inv.settled_amount || 0);
  const settledHere = settles.filter((s) => s.status === "confirmed").reduce((n, s) => n + Number(s.amount || 0), 0);
  const pendingHere = settles.filter((s) => s.status !== "confirmed" && s.match_source === "manual").reduce((n, s) => n + Number(s.amount || 0), 0);
  const leftHere = Math.max(0, amt - settledHere - pendingHere);
  //   머리의 상태는 팝업 안에서 한 일(초안·확정)을 바로 따라간다 — 줄 데이터(tx)는 화면이 다시 읽기 전까지 옛것이다
  const base = bankLineState(tx);
  const state: BankLineState = base === "excluded" || base === "posted" ? base : settledHere > 0 ? "linked" : base === "linked" ? "linked" : pendingHere > 0 ? "pending" : base;

  // ── ① 증빙 연결 후보 — 금액 ±10% 문턱, 거래처 겹침 가산. 근거를 같이 적는다 ──
  const cands = useMemo(() => {
    const names = coreName(`${tx.counterparty || ""} ${tx.description || ""}`);
    const out: { inv: Inv; why: string[]; score: number }[] = [];
    for (const inv of invoices) {
      const rem = remainingOf(inv);
      if (rem <= 0) continue;
      const diff = Math.abs(rem - amt) / rem;
      const nm = coreName(inv.counterparty_name);
      const nameHit = nm.length >= 2 && names.includes(nm.slice(0, Math.min(nm.length, 4)));
      if (diff > 0.1 && !nameHit) continue;
      if (diff !== 0 && diff <= 0.1 && !nameHit) continue;   // 근접만으로는 제안하지 않는다
      const why: string[] = [];
      let score = 0;
      if (diff === 0) { why.push("금액 일치"); score += 3; } else if (diff <= 0.1) { why.push("금액 근접(±10%)"); score += 1; } else why.push(`남은 금액 ₩${won(rem)}`);
      if (nameHit) { why.push("거래처 일치"); score += 2; }
      if (diff > 0.1 && !nameHit) continue;
      out.push({ inv, why, score });
    }
    const named = out.filter((x) => x.why.includes("거래처 일치"));
    const picked = named.length > 0 ? named : out.length <= 3 ? out : [];
    return picked.sort((a, b) => b.score - a.score || (a.inv.issue_date < b.inv.issue_date ? 1 : -1)).slice(0, 6);
  }, [invoices, amt, tx.counterparty, tx.description]);   // eslint-disable-line react-hooks/exhaustive-deps
  const [pickInv, setPickInv] = useState<Inv | null>(null);
  const [invSearch, setInvSearch] = useState(false);
  const [linkAmt, setLinkAmt] = useState("");
  useEffect(() => { if (pickInv) setLinkAmt(String(Math.min(remainingOf(pickInv), leftHere || amt))); }, [pickInv]);   // eslint-disable-line react-hooks/exhaustive-deps
  const invPickItems = useMemo(() => invoices.map((inv) => ({ id: inv.id, code: null, name: `${inv.counterparty_name || "거래처 없음"} · ₩${won(remainingOf(inv))}${remainingOf(inv) !== Number(inv.total_amount) ? `(총 ${won(Number(inv.total_amount))})` : ""}${inv.item_name ? ` · ${inv.item_name}` : ""} · ${inv.issue_date}`, inv })), [invoices]);   // eslint-disable-line react-hooks/exhaustive-deps

  const makeDraft = async () => {
    if (!pickInv || busy) return;
    const a = Number(String(linkAmt).replace(/[^0-9.]/g, ""));
    if (!(a > 0)) { toast("연결 금액을 넣으세요", "error"); return; }
    if (a > remainingOf(pickInv) + 0.5) { toast(`계산서 남은 금액(₩${won(remainingOf(pickInv))})보다 큽니다`, "error"); return; }
    setBusy(true);
    try {
      //   ★ 초안(suggested)으로만 넣는다 — 확정은 사람이 누른다. 확정 시 트리거가 정산 전표를 만든다.
      const { error } = await (supabase as any).from("invoice_settlements").insert({
        company_id: companyId, bank_transaction_id: tx.id, tax_invoice_id: pickInv.id, amount: a,
        match_type: a + 0.5 < remainingOf(pickInv) || a + 0.5 < amt ? "partial" : "one_to_one",
        match_source: "manual", status: "suggested", confidence: 1,
        reason: `통장 줄 처리에서 사람이 고름 · ${cands.find((c) => c.inv.id === pickInv.id)?.why.join(", ") || "직접 찾기"}`,
      });
      if (error) throw error;
      if (pickInv.partner_id && !tx.partner_id) await supabase.from("bank_transactions").update({ partner_id: pickInv.partner_id } as never).eq("id", tx.id);
      toast("연결 초안을 만들었습니다 — 확정을 눌러야 전표가 됩니다", "success");
      setPickInv(null); refetchSettles(); onDone?.();
    } catch (e) { toast(friendlyError(e, "연결 실패"), "error"); }
    finally { setBusy(false); }
  };
  const decide = async (s: Settle, st: "confirmed" | "rejected") => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await decideSettlement(s.id, st, companyId, tx.transaction_date);
      const t = settlementResultToast(r, tx.transaction_date?.slice(0, 7));
      toast(t.msg, t.kind);
      if (r === "locked") return;
      refetchSettles(); onDone?.();
      qc.invalidateQueries({ queryKey: ["bank-line-invoices"] });
    } catch (e) { toast(friendlyError(e, "실패"), "error"); }
    finally { setBusy(false); }
  };

  // ── ② 일반전표 — 계정(규칙으로 미리 채움) · 거래처(이름 맞춤) · 적요 ──
  const rk = ruleKeyOf("bank", { name: tx.counterparty, fallback: tx.description });
  const rule = ruleMap?.get(rk.key);
  const sideAccts = useMemo(() => accounts.filter((a) => a.account_type === (isIn ? "revenue" : "expense")), [accounts, isIn]);
  const [acct, setAcct] = useState<Acct | null>(null);
  const [acctVia, setAcctVia] = useState<string>("");
  const [acctOpen, setAcctOpen] = useState(false);
  const [pt, setPt] = useState<Pt | null>(null);
  const [ptOpen, setPtOpen] = useState(false);
  const [vMemo, setVMemo] = useState(tx.description || "");
  useEffect(() => {
    if (acct || !accounts.length) return;
    if (rule?.account) { const a = accounts.find((x) => x.id === rule.account_id); if (a) { setAcct(a); setAcctVia(`내가 배운 규칙 · ${ruleTag(rule.hit_count || 0)}`); } }
  }, [rule, accounts]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (pt || !partners.length) return;
    if (tx.partner_id) { const p = partners.find((x) => x.id === tx.partner_id); if (p) { setPt(p); return; } }
    const nm = coreName(tx.counterparty);
    if (nm.length >= 2) { const p = partners.find((x) => coreName(x.name) === nm) || partners.find((x) => coreName(x.name).startsWith(nm.slice(0, 4))); if (p) setPt(p); }
  }, [partners]);   // eslint-disable-line react-hooks/exhaustive-deps
  const postVoucher = async () => {
    if (!acct || busy) return;
    setBusy(true);
    try {
      const { error } = await (supabase.rpc as any)("post_bank_manual_voucher", { p_bank_tx_id: tx.id, p_account_id: acct.id, p_partner_id: pt?.id ?? null, p_memo: vMemo.trim() || null });
      if (error) throw error;
      await learnAccount({ kind: "bank", key: rk.key, label: rk.label, accountId: acct.id });
      qc.invalidateQueries({ queryKey: ["voucher-rules"] });
      toast("일반전표를 만들었습니다", "success");
      onDone?.(); onClose();
    } catch (e: any) {
      const m = String(e?.message || "");
      toast(m.includes("PERIOD_LOCKED") ? "마감된 달입니다" : m.includes("ALREADY_POSTED") ? "이미 전표가 있는 줄입니다" : m.includes("NO_BANK_ACCOUNT") ? "계정과목에 103 보통예금이 없습니다" : friendlyError(e, "전표 실패"), "error");
    } finally { setBusy(false); }
  };

  // ── ③ 장부 제외 ──
  const [exCode, setExCode] = useState("transfer");
  const [exMemo, setExMemo] = useState("");
  const exclude = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await setLedgerExcluded("bank", [tx.id], exMemo.trim() ? `${exCode}:${exMemo.trim()}` : exCode);
      toast("장부에서 뺐습니다", "success"); onDone?.(); onClose();
    } catch (e) { toast(friendlyError(e, "실패"), "error"); }
    finally { setBusy(false); }
  };
  const unexclude = async () => {
    setBusy(true);
    try { await setLedgerExcluded("bank", [tx.id], null); toast("장부 제외를 풀었습니다", "success"); onDone?.(); onClose(); }
    catch (e) { toast(friendlyError(e, "실패"), "error"); }
    finally { setBusy(false); }
  };

  // ── 줄 메모 (전표와 무관 — 메모·태그·사용직원·고정비) ──
  const [memo, setMemo] = useState(tx.memo || "");
  const [tags, setTags] = useState((tx.tags || []).join(", "));
  const [emp, setEmp] = useState(tx.used_by_employee_id || "");
  const [fixed, setFixed] = useState(!!tx.is_fixed_cost);
  const { data: employees = [] } = useQuery({
    queryKey: ["bank-page-employees", companyId],
    queryFn: async () => (logRead("bank-line:employees", await supabase.from("employees").select("id, name").eq("company_id", companyId).eq("status", "active").order("name")) || []) as Pt[],
    staleTime: 300_000,
  });
  const saveNote = async () => {
    setBusy(true);
    try {
      const { error } = await supabase.from("bank_transactions").update({ memo: memo.trim() || null, tags: tags.split(",").map((t) => t.trim()).filter(Boolean), used_by_employee_id: emp || null, is_fixed_cost: fixed } as never).eq("id", tx.id);
      if (error) throw error;
      toast("줄 메모를 저장했습니다", "success"); onDone?.();
    } catch (e) { toast(friendlyError(e, "저장 실패"), "error"); }
    finally { setBusy(false); }
  };

  const meta = BANK_LINE_META[state];
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide bl-box" onClick={(e) => e.stopPropagation()}>
        <div className="inv-modal-head">
          <h3 className="inv-modal-title">통장 줄 처리</h3>
          <button type="button" className="inv-modal-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <div className="bl-tx">
          <span className="mono-number">{tx.transaction_date}</span>
          <b>{tx.counterparty || "—"}</b>
          <span className="bl-tx-desc" title={tx.description || undefined}>{tx.description || ""}</span>
          <span className={`mono-number bl-tx-amt ${isIn ? "bl-in" : "bl-out"}`}>{isIn ? "+" : "-"}₩{won(amt)}</span>
          <span className={`bl-state ${meta.cls}`} title={meta.hint}>{meta.label}</span>
        </div>
        {monthLocked && state !== "excluded" && state !== "posted" && (
          <div className="bl-locked">⚠ {tx.transaction_date.slice(0, 7)}은 회계마감으로 잠겨 있습니다 — 증빙 연결 확정·일반전표가 막힙니다. 회계마감에서 그 달을 풀고 처리하세요.</div>
        )}
        {state === "excluded" ? (
          <div className="bl-done">
            <p>장부에서 뺀 줄입니다 — {excludeLabelOf(tx.ledger_excluded_reason)}</p>
            <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={unexclude}>제외 풀기 (미처리로)</button>
          </div>
        ) : state === "posted" ? (
          <div className="bl-done"><p>일반전표로 장부에 올라간 줄입니다. 고치기는 재무 › 일반전표에서(반려 후 다시 처리).</p></div>
        ) : null}

        {state !== "excluded" && state !== "posted" && (
          <>
            <div className="collect-tabs bl-tabs">
              <button type="button" className={tab === "link" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("link")}>증빙 연결{settles.length ? <span className="inv-short-badge">{settles.length}</span> : null}</button>
              {state !== "linked" && <button type="button" className={tab === "voucher" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("voucher")}>일반전표</button>}
              {state !== "linked" && <button type="button" className={tab === "exclude" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("exclude")}>장부 제외</button>}
            </div>

            {tab === "link" && (
              <div className="bl-pane">
                <p className="inv-hint">{isIn ? "매출" : "매입"} 계산서와 짝을 지으면 <b>정산 전표 초안(연결 대기)</b>이 됩니다. 후보는 자동으로 찾지만 확정은 사람이 누릅니다 — 확정하면 {isIn ? "외상매출금" : "외상매입금"} ↔ 보통예금 전표가 생깁니다. 분할·합산 입금은 금액을 나눠 여러 번 연결합니다.</p>
                {settles.length > 0 && (
                  <table className="ev-table ev-lined table-inv-status-sm bl-table">
                    <thead><tr><th>연결한 계산서</th><th>계산서 금액</th><th>연결 금액</th><th>출처</th><th>상태</th><th></th></tr></thead>
                    <tbody>{settles.map((s) => (
                      <tr key={s.id}>
                        <td className="text-left"><b>{s.tax_invoices?.counterparty_name || "—"}</b> <span className="ev-dim mono-number">{s.tax_invoices?.issue_date}</span></td>
                        <td className="tr mono-number">₩{won(Number(s.tax_invoices?.total_amount || 0))}</td>
                        <td className="tr mono-number">₩{won(Number(s.amount))}</td>
                        <td className="tc ev-dim">{s.match_source === "manual" ? "내가 고름" : s.match_source === "ai" ? "매칭 제안 · AI" : "매칭 제안 · 규칙"}</td>
                        <td className="tc">{s.status === "confirmed" ? <span className="inv-pill inv-pill-ok">확정 · 전표됨</span> : <span className="inv-pill inv-pill-warn">{s.match_source === "manual" ? "연결 대기" : "제안"}</span>}</td>
                        <td className="tc">{s.status !== "confirmed" && <span className="bl-row-acts">
                          <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => decide(s, "confirmed")}>확정</button>
                          <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => decide(s, "rejected")}>반려</button>
                        </span>}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                )}
                {leftHere > 0 && (
                  <>
                    <div className="bl-sub">후보 {cands.length}건 <span className="ev-dim">· 출처: 장부 대조(금액·거래처)</span>{leftHere !== amt && <span className="ev-dim"> · 남은 ₩{won(leftHere)}</span>}</div>
                    {cands.length === 0 && <div className="collect-empty bl-empty">자동으로 찾은 후보가 없습니다 — 아래 <b>계산서 직접 찾기</b>로 고르거나, 증빙이 없는 줄이면 <b>일반전표</b> 탭으로.</div>}
                    {cands.length > 0 && (
                      <table className="ev-table ev-lined table-inv-status-sm bl-table">
                        <thead><tr><th></th><th>거래처</th><th>발행일</th><th>남은 금액</th><th>근거</th></tr></thead>
                        <tbody>{cands.map(({ inv, why }) => (
                          <tr key={inv.id} className={pickInv?.id === inv.id ? "bl-row-on" : ""} onClick={() => setPickInv(inv)}>
                            <td className="tc"><input type="radio" name="bl-cand" checked={pickInv?.id === inv.id} onChange={() => setPickInv(inv)} /></td>
                            <td className="text-left"><b>{inv.counterparty_name || "—"}</b>{inv.item_name ? <span className="ev-dim"> · {inv.item_name}</span> : null}</td>
                            <td className="tc mono-number">{inv.issue_date}</td>
                            <td className="tr mono-number">₩{won(remainingOf(inv))}</td>
                            <td className="tc">{why.map((w) => <span key={w} className="inv-pill inv-pill-ghost">{w}</span>)}</td>
                          </tr>
                        ))}</tbody>
                      </table>
                    )}
                    <div className="bl-line">
                      <span className="relative inline-block">
                        <button type="button" className="btn-secondary btn-sm" onClick={() => setInvSearch((v) => !v)}>계산서 직접 찾기</button>
                        {invSearch && <PickList items={invPickItems} placeholder="계산서 검색 (거래처·금액·품목·발행일)" onPick={(x) => { setPickInv(x.inv); setInvSearch(false); }} onClose={() => setInvSearch(false)} />}
                      </span>
                      {pickInv && (
                        <>
                          <span className="bl-picked">고른 계산서: <b>{pickInv.counterparty_name || "—"}</b> · 남은 ₩{won(remainingOf(pickInv))}</span>
                          <label className="bl-amt">연결 금액 <input value={linkAmt} onChange={(e) => setLinkAmt(e.target.value)} className="inv-input mono-number tr" /></label>
                        </>
                      )}
                    </div>
                  </>
                )}
              </div>
            )}

            {tab === "voucher" && (
              <div className="bl-pane">
                <p className="inv-hint">증빙이 없는 줄(이자·수수료·급여·임차료 …)을 일반전표로. 보통예금 쪽과 차·대 방향은 서버가 붙입니다 — 여기서는 상대 계정·거래처·적요만.</p>
                <div className="bl-form">
                  <label>계정과목
                    <span className="relative inline-block">
                      <button type="button" className={acct ? "ev-acct" : "ev-acct ev-acct-empty"} onClick={() => setAcctOpen((v) => !v)}>
                        {acct ? `${acct.code} ${acct.name}` : (isIn ? "수익 계정 고르기" : "비용 계정 고르기")}{acctVia && <em className="ev-via">{acctVia}</em>}
                      </button>
                      {acctOpen && <PickList items={sideAccts} placeholder="계정과목 검색 (이름·코드)" onPick={(a) => { setAcct(a); setAcctVia(""); setAcctOpen(false); }} onClose={() => setAcctOpen(false)} />}
                    </span>
                  </label>
                  <label>거래처
                    <span className="relative inline-block">
                      <button type="button" className={pt ? "bk-pt" : "bk-pt bk-pt-empty"} onClick={() => setPtOpen((v) => !v)}>{pt?.name ?? "거래처 (선택)"}</button>
                      {ptOpen && <PickList items={partners} placeholder="거래처 검색" onPick={(p) => { setPt(p); setPtOpen(false); }} onClose={() => setPtOpen(false)} />}
                    </span>
                  </label>
                  <label>적요 <input value={vMemo} onChange={(e) => setVMemo(e.target.value)} className="inv-input" placeholder="적요" /></label>
                </div>
                <p className="inv-hint">{isIn ? "차) 보통예금 / 대) 고른 계정" : "차) 고른 계정 / 대) 보통예금"} · 고른 계정은 다음에 같은 입금자·적요가 오면 미리 채워집니다(내가 배운 규칙).</p>
              </div>
            )}

            {tab === "exclude" && (
              <div className="bl-pane">
                <p className="inv-hint">장부에 올리지 않을 줄 — 계좌 간 이체·카드 대금·개인 지출·이미 다른 전표에 있는 것. 사유가 상태 칸에 남고 언제든 풀 수 있습니다.</p>
                <div className="bl-form">
                  <label>사유
                    <select value={exCode} onChange={(e) => setExCode(e.target.value)} className="inv-input">
                      {EXCLUDE_REASONS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                    </select>
                  </label>
                  <label>메모 <input value={exMemo} onChange={(e) => setExMemo(e.target.value)} className="inv-input" placeholder="선택" /></label>
                </div>
              </div>
            )}
          </>
        )}

        <details className="bl-note">
          <summary>줄 메모 · 태그 · 사용직원 · 고정비 <span className="ev-dim">(전표와 무관)</span></summary>
          <div className="bl-form">
            <label>메모 <input value={memo} onChange={(e) => setMemo(e.target.value)} className="inv-input" /></label>
            <label>태그 <input value={tags} onChange={(e) => setTags(e.target.value)} className="inv-input" placeholder="쉼표로 구분" /></label>
            <label>사용직원
              <select value={emp} onChange={(e) => setEmp(e.target.value)} className="inv-input"><option value="">선택 안 함</option>{employees.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}</select>
            </label>
            <label className="bl-check"><input type="checkbox" checked={fixed} onChange={(e) => setFixed(e.target.checked)} /> 고정비로 표시 (매월 반복 지출)</label>
            <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={saveNote}>메모 저장</button>
          </div>
        </details>

        <div className="inv-modal-actions">
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
          {state !== "excluded" && state !== "posted" && leftHere > 0 && tab === "link" && <button type="button" className="btn-primary btn-sm" disabled={!pickInv || busy} onClick={makeDraft}>연결 초안 만들기</button>}
          {state !== "excluded" && state !== "posted" && tab === "voucher" && <button type="button" className="btn-primary btn-sm" disabled={!acct || busy} onClick={postVoucher}>일반전표 만들기</button>}
          {state !== "excluded" && state !== "posted" && tab === "exclude" && <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={exclude}>장부에서 빼기</button>}
        </div>
      </div>
    </div>
  );
}
