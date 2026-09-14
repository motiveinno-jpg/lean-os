"use client";

// 수집·전표 > 결재 경비 — 결재 허브에서 승인된 지출결의서(경비 양식)를 전표로 만든다 (2026-09-14)
//
//   ★ 전표는 **여기서, 사람이 '전표 만들기'를 누른 줄만** 생긴다. 승인은 장부에 아무것도 쓰지 않는다.
//     서버(save_manual_voucher 의 approval_request 갈래)가 승인됨·경비 양식·개인 돈·미전표 네 조건을 다시
//     검사하므로(EXPENSE_NOT_ELIGIBLE) 화면이 잘못 눌러도 만들어지지 않는다.
//   ★ 법인카드로 낸 경비는 만들지 않는다 — 카드 수집이 이미 장부에 올린 돈이라 여기서 또 만들면 이중 기장이다.
//     그 줄은 '카드 탭에서 전표'로만 보인다.
//   전표 모양 = 일반전표(대체) · 차변 비용계정 / 대변 미지급금(253). 통장에서 직원에게 갚은 돈은 거래 정리에서 맞춘다.
//   ★ 원자료 조회·전표 저장은 EvidenceTab 과 같은 RPC(save_manual_voucher · unpost_evidence_voucher)를 쓴다.
//     이 탭만의 저장 경로를 만들지 않는다 — 전표 번호·마감·권한 검사가 한곳이어야 한다.

import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ChipGroup, ResultStrip, Stat, SelectionBar,
  Pager, usePager, QuickSearch, quickSearchHit,
} from "@/components/query-kit";
import { DateRangeField } from "@/components/date-range-field";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { PickList } from "@/components/pick-list";
import { appConfirm } from "@/components/global-confirm";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { STD } from "@/lib/vat-voucher";

type Acct = { id: string; code: string; name: string; account_type: string };
type XRow = {
  id: string;
  /** 승인일(KST) — 전표 일자로 쓴다 */
  date: string;
  title: string;
  requester: string;
  amount: number;
  paidBy: "personal" | "corporate_card" | null;
  accountId: string | null;
  attachments: string[];
  entryId: string | null;
  voucherNo: number | null;
};
type SortKey = "date" | "title" | "requester" | "amount" | "state";

const won = (n: number) => Math.round(Number(n) || 0).toLocaleString("ko-KR");
const kstDate = (iso: string) => new Date(new Date(iso).getTime() + 9 * 3600_000).toISOString().slice(0, 10);

const STATE_CHIPS = [
  { value: "todo", label: "전표 대기" }, { value: "all", label: "전체" },
] as const;

/** RPC 오류 코드 → 사람 말. 다른 곳(일반전표·증빙 탭)과 같은 뜻으로 */
function rpcMessage(err: unknown): string {
  const m = err instanceof Error ? err.message : String((err as { message?: string })?.message || err || "");
  return m.includes("EXPENSE_NOT_ELIGIBLE") ? "전표를 만들 수 없는 건입니다 (승인된 경비 양식 · 개인 돈으로 낸 건만)"
    : m.includes("ALREADY_POSTED") ? "이미 전표가 있습니다"
    : m.includes("PERIOD_LOCKED") ? "마감된 달입니다 · 회계마감을 풀어야 합니다"
    : m.includes("FORBIDDEN") ? "전표 입력 권한이 없습니다"
    : m.includes("INVALID_ACCOUNT") ? "계정과목이 이 회사 것이 아닙니다"
    : m.includes("UNBALANCED") ? "차변·대변이 맞지 않습니다"
    : friendlyError(err, m || "알 수 없는 오류");
}

export function ExpenseClaimTab({ companyId, from, to, tabsNode, onRange }: {
  companyId: string; from: string; to: string; tabsNode: ReactNode;
  onRange: (from: string, to: string) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [todo, setTodo] = useState<"todo" | "all">("todo");
  const [q, setQ] = useState("");
  const [sel, setSel] = useState<Set<string>>(new Set());
  //   줄별로 고른 비용 계정 — 작성자가 비워 둔 건은 여기서 고른다(확정은 여전히 '전표 만들기')
  const [override, setOverride] = useState<Record<string, Acct>>({});
  const [pick, setPick] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "date", dir: "asc" });
  const [size, setSize] = useState(50);

  //   경비 양식 목록 — 이 양식의 승인 건만 대상
  const { data: expenseForms = [] } = useQuery({
    queryKey: ["expense-forms", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const data = logRead("collect:expense-forms", await supabase
        .from("approval_forms").select("id, name").eq("company_id", companyId).eq("is_expense", true));
      return (data || []) as { id: string; name: string }[];
    },
  });
  const formIds = useMemo(() => expenseForms.map((f) => f.id), [expenseForms]);

  const { data: accounts = [] } = useQuery({
    queryKey: ["collect-accounts", companyId],
    queryFn: async () => {
      const data = logRead("collect:accounts", await supabase
        .from("chart_of_accounts").select("id, code, name, account_type")
        .eq("company_id", companyId).order("code"));
      return (data || []) as Acct[];
    },
    staleTime: 300_000,
  });
  const acctById = useMemo(() => new Map(accounts.map((a) => [a.id, a])), [accounts]);
  const expenseAccts = useMemo(() => accounts.filter((a) => a.account_type === "expense"), [accounts]);
  const payable = useMemo(() => accounts.find((a) => a.code === STD.payable) || null, [accounts]);

  //   승인된 경비 결재 — 승인일(updated_at) 기준 조회기간 안. 한 회사의 결재는 많아야 수백 건이라 한 번에 읽는다.
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["expense-claims", companyId, from, to, formIds.join(",")],
    enabled: !!companyId && formIds.length > 0,
    queryFn: async (): Promise<XRow[]> => {
      const toExcl = new Date(Date.parse(`${to}T00:00:00+09:00`) + 86400000).toISOString();
      const data = logRead("collect:expense-claims", await (supabase as any)
        .from("approval_requests")
        .select("id, title, amount, status, paid_by, expense_account_id, journal_entry_id, attachments, updated_at, form_id, requester_id, users:requester_id(name)")
        .eq("company_id", companyId).eq("status", "approved").in("form_id", formIds)
        .gte("updated_at", `${from}T00:00:00+09:00`).lt("updated_at", toExcl)
        .order("updated_at", { ascending: false }).limit(2000));
      const list = (data || []) as any[];
      //   전표 번호 — 걸린 것만 읽는다. 반려된 전표(취소한 것)는 unlink 로 이미 풀려 있다.
      const ids = list.map((r) => r.journal_entry_id).filter(Boolean) as string[];
      const noById = new Map<string, number | null>();
      if (ids.length > 0) {
        const je = logRead("collect:expense-vouchers", await supabase
          .from("journal_entries").select("id, voucher_no").in("id", ids));
        for (const e of (je || []) as { id: string; voucher_no: number | null }[]) noById.set(e.id, e.voucher_no);
      }
      return list.map((r) => ({
        id: r.id,
        date: kstDate(r.updated_at),
        title: r.title || "",
        requester: r.users?.name || "",
        amount: Number(r.amount) || 0,
        paidBy: r.paid_by === "personal" || r.paid_by === "corporate_card" ? r.paid_by : null,
        accountId: r.expense_account_id || null,
        attachments: Array.isArray(r.attachments) ? r.attachments : [],
        entryId: r.journal_entry_id || null,
        voucherNo: r.journal_entry_id ? (noById.get(r.journal_entry_id) ?? null) : null,
      }));
    },
  });

  const acctOf = (r: XRow): Acct | null => override[r.id] ?? (r.accountId ? acctById.get(r.accountId) ?? null : null);
  /** 전표를 만들 수 있는 줄 — 개인 돈 · 금액 있음 · 아직 전표 없음. 법인카드는 카드 탭이 맡는다 */
  const canPost = (r: XRow) => r.paidBy === "personal" && r.amount > 0 && !r.entryId;
  const stateOf = (r: XRow) => r.entryId ? "전표됨" : r.paidBy === "corporate_card" ? "카드 탭" : r.amount <= 0 ? "금액 없음" : !r.paidBy ? "결제 방식 없음" : "전표 대기";

  const shown = useMemo(() => {
    const list = rows
      .filter((r) => todo === "all" || canPost(r))
      .filter((r) => quickSearchHit(q, [r.title, r.requester, acctOf(r)?.name || "", String(r.amount)]));
    const d = sort.dir === "asc" ? 1 : -1;
    return [...list].sort((a, b) => {
      switch (sort.key) {
        case "date": return cmp(a.date, b.date) * d || cmp(a.title, b.title);
        case "title": return cmp(a.title, b.title) * d;
        case "requester": return cmp(a.requester, b.requester) * d;
        case "amount": return cmp(a.amount, b.amount) * d;
        case "state": return cmp(stateOf(a), stateOf(b)) * d;
        default: return 0;
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, todo, q, sort, override, acctById]);

  const pager = usePager(shown, size, `${from}|${to}|${todo}|${q}`);
  const selRows = shown.filter((r) => sel.has(r.id) && canPost(r));
  const selTotal = selRows.reduce((s, r) => s + r.amount, 0);
  const notReady = selRows.filter((r) => !acctOf(r));
  const pending = rows.filter(canPost);
  const pickable = pager.view.filter(canPost);
  const allOn = pickable.length > 0 && pickable.every((r) => sel.has(r.id));
  const toggle = (id: string) => setSel((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const toggleAll = () => setSel((s) => {
    const n = new Set(s);
    if (allOn) pickable.forEach((r) => n.delete(r.id)); else pickable.forEach((r) => n.add(r.id));
    return n;
  });
  const onSort = (k: SortKey) => setSort((c) => nextSort(c, k, "asc"));

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["expense-claims"] });
    queryClient.invalidateQueries({ queryKey: ["expense-claims-pending"] });
    queryClient.invalidateQueries({ queryKey: ["all-requests"] });
    queryClient.invalidateQueries({ queryKey: ["my-requests"] });
    queryClient.invalidateQueries({ queryKey: ["approval-voucher-nos"] });
  };

  /** 고른 줄을 전표로 — 한 줄에 전표 한 장. 실패한 줄은 남겨 두고 이유를 적는다 */
  const makeVouchers = async () => {
    if (saving || selRows.length === 0) return;
    if (!payable) { toast(`미지급금(${STD.payable}) 계정이 없습니다. 설정 > 계정과목에서 추가한 뒤 다시 하세요.`, "error"); return; }
    if (notReady.length > 0) { toast(`${notReady.length}건은 계정과목을 먼저 골라야 합니다.`, "error"); return; }
    const ok = await appConfirm(
      `${selRows.length}건 · 합계 ${won(selTotal)}원을 일반전표로 만들까요?\n\n· 차변 비용 계정 / 대변 미지급금(직원)\n· 전표 일자는 승인일\n· 만든 뒤에도 상태 칸의 '취소'로 되돌릴 수 있습니다`,
      { title: "전표 만들기", confirmLabel: "전표 만들기" });
    if (!ok) return;
    setSaving(true);
    let done = 0; const fails: string[] = [];
    try {
      for (const r of selRows) {
        const acct = acctOf(r);
        if (!acct) continue;
        const lines = [
          { account_id: acct.id, debit: r.amount, credit: 0, memo: r.title },
          { account_id: payable.id, debit: 0, credit: r.amount, memo: `직원 경비 · ${r.requester || "요청자"}` },
        ];
        const { error } = await (supabase.rpc as any)("save_manual_voucher", {
          p_entry_date: r.date, p_voucher_type: "transfer", p_description: `결재 경비 · ${r.title}`,
          p_lines: lines, p_reference_type: "approval_request", p_reference_id: r.id,
        });
        if (error) fails.push(`${r.title}: ${rpcMessage(error)}`); else done++;
      }
    } finally {
      setSaving(false);
      setSel(new Set());
      invalidate();
    }
    if (fails.length === 0) toast(`전표 ${done}장을 만들었습니다.`, "success");
    else toast(`전표 ${done}장 완료 · ${fails.length}건 실패 — ${fails.slice(0, 2).join(" / ")}${fails.length > 2 ? " …" : ""}`, done > 0 ? "info" : "error");
  };

  /** 만든 전표를 되돌린다 — 전표는 반려로 남고, 이 줄은 다시 '전표 대기'로 */
  const unpost = async (r: XRow) => {
    if (!r.entryId || saving) return;
    const ok = await appConfirm(
      `${r.date.slice(5)} ${r.title} ${won(r.amount)}원\n전표 #${r.voucherNo ?? "—"} 을(를) 취소할까요?\n\n· 전표는 반려로 남고 재무제표에서 빠집니다\n· 이 결재는 다시 '전표 대기'가 됩니다`,
      { danger: true, title: "전표 취소", confirmLabel: "전표 취소" });
    if (!ok) return;
    setSaving(true);
    try {
      const { error } = await (supabase.rpc as any)("unpost_evidence_voucher", { p_entry_id: r.entryId });
      if (error) throw error;
      toast("전표를 취소했습니다. 결재는 다시 전표 대기로 돌아왔습니다.", "success");
      invalidate();
    } catch (e) {
      toast(`전표 취소 실패: ${rpcMessage(e)}`, "error");
    } finally { setSaving(false); }
  };

  return (
    <div className="ev-wrap">
      <QueryScreen>
      <QueryHead>
      {tabsNode}
      <QueryBar right={<Link href="/approvals?tab=all" className="btn-secondary btn-sm">결재 허브</Link>}>
        <DateRangeField from={from} to={to} onChange={onRange} label={null} parts="segments" />
        {/*   '보기' 칩 — 처리할 것만 볼지 전부 볼지. 값 필터가 아니라 관점이라 조회 줄에 둔다 */}
        <ChipGroup value={todo} onChange={(v) => setTodo(v as "todo" | "all")} options={STATE_CHIPS} />
        <QuickSearch value={q} onApply={setQ} placeholder="제목 · 요청자 · 계정과목 · 금액 · 쉼표로 여러 개, Enter" />
      </QueryBar>

      <ResultStrip>
        <Stat label="건수" value={`${won(shown.length)}건`} />
        <Stat label="합계" value={won(shown.reduce((s, r) => s + r.amount, 0))} />
        <Stat label="전표 대기" value={`${won(pending.length)}건`} />
        {formIds.length === 0 && (
          <span className="ev-draft-note">경비 양식이 없습니다. <Link href="/approvals?tab=forms" className="bz-link">결재 허브 &gt; 양식 관리</Link>에서 양식에 '경비 양식'을 켜면 승인된 건이 여기에 올라옵니다.</span>
        )}
      </ResultStrip>
      </QueryHead>

      <QueryBody>
      {isLoading ? (
        <div className="collect-empty">읽는 중…</div>
      ) : shown.length === 0 ? (
        <div className="collect-empty">
          {formIds.length === 0
            ? "경비 양식으로 표시된 결재 양식이 아직 없습니다."
            : todo === "todo" ? "전표를 만들 승인 건이 없습니다." : "이 기간에 승인된 경비 결재가 없습니다."}
        </div>
      ) : (
        <div className="ev-scroll">
          <table className="ev-table ev-lined">
            <thead>
              <tr>
                <th style={{ width: 34 }}>
                  <button type="button" aria-label="이 쪽 전체 선택" onClick={toggleAll}
                    className={allOn ? "collect-chk collect-chk-on" : "collect-chk"}>{allOn ? "✓" : ""}</button>
                </th>
                <SortableTh label="승인일" sortKey="date" sort={sort} onSort={onSort} />
                <SortableTh label="결재 제목" sortKey="title" sort={sort} onSort={onSort} />
                <SortableTh label="요청자" sortKey="requester" sort={sort} onSort={onSort} />
                <SortableTh label="어떻게 냈나" />
                <SortableTh label="금액" sortKey="amount" sort={sort} onSort={onSort} />
                <SortableTh label="차변계정" />
                <SortableTh label="대변계정" />
                <SortableTh label="영수증" />
                <SortableTh label="상태" sortKey="state" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {pager.view.map((r) => {
                const on = sel.has(r.id);
                const acct = acctOf(r);
                const postable = canPost(r);
                return (
                  <tr key={r.id} className={r.entryId ? "ev-posted" : on ? "ev-on" : ""}>
                    <td>
                      {postable && (
                        <button type="button" onClick={() => toggle(r.id)} aria-label="선택"
                          className={on ? "collect-chk collect-chk-on" : "collect-chk"}>{on ? "✓" : ""}</button>
                      )}
                    </td>
                    <td className="mono-number">{r.date.slice(5)}</td>
                    <td className="ev-ell"><span className="xc-req-title" title={r.title}>{r.title}</span></td>
                    <td className="ev-ell">{r.requester || "—"}</td>
                    <td className="tc">
                      {r.paidBy === "personal" ? "내 돈" : r.paidBy === "corporate_card" ? "법인카드" : <span className="ev-dim">—</span>}
                    </td>
                    <td className="mono-number tr">{won(r.amount)}</td>
                    <td>
                      {/*   비용 계정 — 작성자가 골랐으면 그대로, 비었으면 여기서. 전표가 된 줄은 바꾸지 않는다 */}
                      {r.entryId || !postable ? (
                        <span className={acct ? "" : "ev-dim"}>{acct ? `${acct.code} ${acct.name}` : "—"}</span>
                      ) : (
                        <span className="relative inline-block w-full">
                          <button type="button" onClick={() => setPick((p) => (p === r.id ? null : r.id))}
                            className={`qk-input xc-acct-btn ${acct ? "" : "text-[var(--text-dim)]"}`}
                            title="비용 계정과목 고르기">
                            {acct ? `${acct.code} ${acct.name}` : "계정과목 고르기"}
                          </button>
                          {pick === r.id && (
                            <PickList items={expenseAccts} placeholder="계정과목 검색 (이름·코드)"
                              onPick={(a) => { setOverride((o) => ({ ...o, [r.id]: a as Acct })); setPick(null); }}
                              onClose={() => setPick(null)} />
                          )}
                        </span>
                      )}
                    </td>
                    <td className="ev-dim">{r.paidBy === "personal" ? `${STD.payable} 미지급금` : "—"}</td>
                    <td className="tc">
                      {r.attachments.length > 0
                        ? <a href={r.attachments[0]} target="_blank" rel="noreferrer" className="bz-link" title="첫 첨부 열기">{r.attachments.length}장</a>
                        : <span className="ev-dim">—</span>}
                    </td>
                    <td className="tc">
                      {r.entryId ? (
                        <span className="ev-st-cell">
                          <span className="ev-st ev-st-done">#{r.voucherNo ?? "—"} 확정</span>
                          <button type="button" className="ev-undo" disabled={saving} onClick={() => unpost(r)}>취소</button>
                        </span>
                      ) : r.paidBy === "corporate_card" ? (
                        <Link href="/collect?tab=card" className="ev-st ev-st-todo" title="법인카드 경비는 카드 수집 거래에서 전표합니다">카드 탭에서</Link>
                      ) : r.amount <= 0 ? (
                        <span className="ev-st ev-st-todo" title="결재에 금액이 없어 전표를 만들 수 없습니다">금액 없음</span>
                      ) : !r.paidBy ? (
                        <span className="ev-st ev-st-todo" title="결재에 '어떻게 냈나'가 없습니다. 경비 양식을 켜기 전에 올린 건입니다">결제 방식 없음</span>
                      ) : <span className="ev-st ev-st-todo">전표 대기</span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/*   파란 버튼은 화면을 통틀어 여기 하나 — 고른 줄만, 눌러야만 전표가 된다 */}
      <SelectionBar count={selRows.length} onClear={() => setSel(new Set())}
        summary={<>합계 <b className="mono-number">{won(selTotal)}</b>원{notReady.length > 0 && ` · ${notReady.length}건은 계정을 먼저 골라야 합니다`}</>}>
        <button type="button" onClick={makeVouchers} disabled={saving || notReady.length > 0}
          className="btn-primary btn-sm disabled:opacity-50 disabled:cursor-not-allowed">
          {saving ? "만드는 중…" : `전표 만들기 (${selRows.length})`}
        </button>
      </SelectionBar>
      </QueryBody>

      <Pager page={pager.page} pages={pager.pages} total={shown.length} size={size}
        from={pager.from} to={pager.to} onPage={pager.setPage} onSize={setSize} />
      </QueryScreen>
    </div>
  );
}
