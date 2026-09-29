"use client";
// 재고 › 이커머스 — 「클레임」「정산」 갈래 (2026-09-28 이커머스 1단계, docs/20260928_PLAN_ecommerce_stage1.md 결정 266~270)
//   ▸ 클레임: 주문 1건 기준 취소·반품·교환. 재고는 반품 입고로 되돌린다(판매 출고를 지우지 않는다). KPI 는 환불액을 뺀다.
//   ▸ 정산: 채널 정산 내역을 붙여넣어 주문과 대조 — 채널별 실측 수수료율 vs 설정, 미정산(출고 14일+), 주문 없음 줄.
//   ▸ 조회 화면 표준: 값 필터는 검색조건(SimpleCond), 조회 줄엔 실행 버튼만, 폼은 팝업, 표 + 쪽.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { appConfirm } from "@/components/global-confirm";
import { todayKst, kstDateTime } from "@/lib/kst";
import { DateField } from "@/components/date-field";
import { QueryBar, ResultStrip, Stat, QuickSearch, quickSearchHit, Pager, usePager } from "@/components/query-kit";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { SimpleCond, SimpleApplied, condHit, type CondLive } from "../../_components/simple-cond";
import { ExcelPasteHelper } from "../../_components/excel-paste-helper";
import { exportToExcel } from "@/lib/excel-export";
import { CHANNELS, channelLabel, SHIP_STATUS_LABEL, type OrderImport } from "@/lib/inventory-channels";
import Link from "next/link";
import { loadChannelFees, saveChannelFees, loadSettlementAccounts, saveSettlementAccounts, SETTLEMENT_ACCOUNT_DEFAULT_CODES, type ChannelFees, type SettlementAccounts } from "@/lib/inventory-settings";
import type { Product } from "@/lib/inventory";
import {
  listClaims, createClaim, deleteClaim, orderLinesOf, CLAIM_KIND_LABEL, type Claim, type ClaimKind, type OrderLine,
  listSettlements, importSettlements, deleteSettlementBatch, parseSettlementTsv, guessSettleColumns, settlementSummary, unsettledImports,
  makeSettlementVoucherDraft, batchTotals, listAccountOptions, unlinkRejectedVoucher, fetchSettlementBankLinks, linkSettlementBankTx,
  SETTLE_FIELDS, UNSETTLED_DAYS, type Settlement, type SettleField, type SettleRow,
} from "@/lib/inventory-claims";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
const pct = (r: number | null) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);
const CH_GROUP = [{ key: "channel", label: "채널", hint: "비우면 전체", options: CHANNELS.map((c) => ({ value: c.value, label: c.label })) }];

// ── 클레임 ────────────────────────────────────────────────────────────────
type ClaimKey = "date" | "channel" | "no" | "kind" | "refund";
export function useClaimsPanel({ companyId, userId, imports, products, canWrite, onDone }: {
  companyId: string | null; userId: string | null; imports: OrderImport[]; products: Product[]; canWrite: boolean; onDone: () => void;
}): { head: ReactNode; body: ReactNode; pagerEl: ReactNode; dialog: ReactNode; claims: Claim[]; openNew: (imp?: OrderImport) => void } {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: claims = [] } = useQuery({ queryKey: ["ch-claims", companyId], queryFn: () => listClaims(companyId!), enabled: !!companyId });
  const impById = useMemo(() => new Map(imports.map((i) => [i.id, i])), [imports]);
  const productName = useMemo(() => new Map(products.map((p) => [p.id, p.name])), [products]);
  const [cond, setCond] = useState<CondLive>({});
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState<ClaimKey>>({ key: "date", dir: "desc" });
  const KIND_GROUP = [...CH_GROUP, { key: "kind", label: "종류", hint: "비우면 전체", options: (Object.keys(CLAIM_KIND_LABEL) as ClaimKind[]).map((k) => ({ value: k, label: CLAIM_KIND_LABEL[k] })) }];
  const shown = useMemo(() => claims.filter((c) => {
    const i = impById.get(c.import_id);
    return condHit(cond, "channel", i?.channel || "") && condHit(cond, "kind", c.kind)
      && quickSearchHit(q, [i?.channel_order_no, i?.buyer_name, c.reason]);
  }), [claims, cond, q, impById]);
  const sorted = useMemo(() => {
    const d = sort.dir === "asc" ? 1 : -1;
    const val = (c: Claim) => sort.key === "date" ? c.claimed_at : sort.key === "channel" ? (impById.get(c.import_id)?.channel || "")
      : sort.key === "no" ? (impById.get(c.import_id)?.channel_order_no || "") : sort.key === "kind" ? c.kind : c.refund_amount;
    return [...shown].sort((a, b) => cmp(val(a), val(b)) * d);
  }, [shown, sort, impById]);
  const pager = usePager(sorted, 50, `${JSON.stringify(cond)}|${q}|${sort.key}${sort.dir}`);
  const onSort = (k: string) => setSort((s) => nextSort(s, k as ClaimKey));
  const refund = shown.filter((c) => c.kind !== "exchange").reduce((n, c) => n + c.refund_amount, 0);
  const cnt = (k: ClaimKind) => shown.filter((c) => c.kind === k).length;

  // ── 등록 팝업 ──
  const [open, setOpen] = useState(false);
  const [pickQ, setPickQ] = useState("");
  const [imp, setImp] = useState<OrderImport | null>(null);
  const [kind, setKind] = useState<ClaimKind>("cancel");
  const [refundAmt, setRefundAmt] = useState("");
  const [reason, setReason] = useState("");
  const [date, setDate] = useState(todayKst());
  const [restock, setRestock] = useState(true);
  const [lines, setLines] = useState<OrderLine[] | null>(null);
  const [busy, setBusy] = useState(false);
  const openNew = (i?: OrderImport) => { setImp(i || null); setPickQ(i ? i.channel_order_no : ""); setKind("cancel"); setRefundAmt(i?.amount != null ? String(Math.round(i.amount)) : ""); setReason(""); setDate(todayKst()); setRestock(true); setLines(null); setOpen(true); };
  const claimedNos = useMemo(() => new Set(claims.map((c) => c.import_id)), [claims]);
  const candidates = useMemo(() => {
    const t = pickQ.trim();
    if (!t) return [] as OrderImport[];
    return imports.filter((i) => quickSearchHit(t, [i.channel_order_no, i.buyer_name, i.recipient_name])).slice(0, 20);
  }, [pickQ, imports]);
  useEffect(() => {
    if (!open || !imp) { setLines(null); return; }
    let alive = true;
    orderLinesOf(imp).then((r) => { if (alive) setLines(r.lines); }).catch(() => { if (alive) setLines([]); });
    return () => { alive = false; };
  }, [open, imp?.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const prevRefund = imp ? claims.filter((c) => c.import_id === imp.id && c.kind !== "exchange").reduce((n, c) => n + c.refund_amount, 0) : 0;
  const overRefund = imp?.amount != null && Number(refundAmt || 0) + prevRefund > Number(imp.amount);
  const save = async () => {
    if (!companyId || !imp || busy) return;
    setBusy(true);
    try {
      const r = await createClaim(companyId, { imp, kind, refundAmount: Number(refundAmt || 0), reason, claimedAt: date, restock: restock && !!imp.doc_id }, userId);
      toast(`${CLAIM_KIND_LABEL[kind]} 등록 · ${r.restockDocNo ? `반품 입고 ${r.restockDocNo}` : "재고 변동 없음"}${r.exchangeDocNo ? ` · 교환 출고 ${r.exchangeDocNo}` : ""}`, "success");
      setOpen(false);
      qc.invalidateQueries({ queryKey: ["ch-claims", companyId] });
      onDone();
    } catch (e) { toast(friendlyError(e, "클레임 등록 실패"), "error"); }
    finally { setBusy(false); }
  };
  const remove = async (c: Claim) => {
    const i = impById.get(c.import_id);
    if (!(await appConfirm(`${i?.channel_order_no || ""} ${CLAIM_KIND_LABEL[c.kind]} 클레임을 지울까요?\n되돌린 재고 문서도 함께 지워져 재고가 다시 빠집니다.`, { danger: true, confirmLabel: "지우기" }))) return;
    try { await deleteClaim(c); toast("클레임을 지웠습니다", "success"); qc.invalidateQueries({ queryKey: ["ch-claims", companyId] }); onDone(); }
    catch (e) { toast(friendlyError(e, "삭제 실패"), "error"); }
  };

  const head = (<>
    <QueryBar right={canWrite ? <button type="button" className="btn-primary btn-sm" onClick={() => openNew()}>+ 클레임 등록</button> : undefined}>
      <SimpleCond groups={KIND_GROUP} live={cond} onApply={setCond} />
      <QuickSearch value={q} onApply={setQ} placeholder="주문번호 · 주문자 · 사유 · 쉼표로 여러 개, Enter" />
      <span className="inv-hint">취소·반품 환불액은 <b>현황·매출 KPI 에서 빠집니다</b>. 재고는 반품 입고 문서로 되돌립니다.</span>
    </QueryBar>
    <SimpleApplied groups={KIND_GROUP} live={cond} onApply={setCond} />
    <ResultStrip>
      <Stat label="클레임" value={`${won(shown.length)}건`} />
      <Stat label="환불액" value={`₩${won(refund)}`} tone={refund > 0 ? "minus" : undefined} />
      <Stat label="취소 · 반품 · 교환" value={`${cnt("cancel")} · ${cnt("return")} · ${cnt("exchange")}`} />
    </ResultStrip>
  </>);

  const body = shown.length === 0 ? (
    <div className="collect-empty">{claims.length === 0 ? <>취소·반품·교환이 없습니다. 생기면 <b>+ 클레임 등록</b>으로 주문을 골라 적으세요.</> : "조건에 맞는 클레임이 없습니다."}</div>
  ) : (
    <div className="stg-table-wrap">
      <table className="ev-table ev-lined table-inv-ch-claims ch-claims-fit">
        <thead><tr>
          <SortableTh label="일자" sortKey="date" sort={sort} onSort={onSort} />
          <SortableTh label="채널" sortKey="channel" sort={sort} onSort={onSort} />
          <SortableTh label="주문번호" sortKey="no" sort={sort} onSort={onSort} />
          <th>주문자</th>
          <SortableTh label="종류" sortKey="kind" sort={sort} onSort={onSort} />
          <SortableTh label="환불액" sortKey="refund" sort={sort} onSort={onSort} />
          <th>사유</th><th>재고</th>{canWrite && <th></th>}
        </tr></thead>
        <tbody>
          {pager.view.map((c) => { const i = impById.get(c.import_id); return (
            <tr key={c.id}>
              <td className="mono-number">{c.claimed_at}</td>
              <td className="tc">{i ? channelLabel(i.channel) : "—"}</td>
              <td className="mono-number text-left"><b>{i?.channel_order_no || "—"}</b></td>
              <td className="text-left">{i?.buyer_name || "—"}</td>
              <td className="tc">{CLAIM_KIND_LABEL[c.kind]}</td>
              <td className="tr mono-number">{c.kind === "exchange" ? <span className="ev-dim">—</span> : `₩${won(c.refund_amount)}`}</td>
              <td className="text-left ev-dim ch-claims-reason">{c.reason || "—"}</td>
              <td className="tc">{c.restock ? <span title="반품 입고 문서로 되돌림">되돌림</span> : <span className="ev-dim">변동 없음</span>}</td>
              {canWrite && <td className="tc"><button type="button" className="btn-secondary btn-sm" onClick={() => remove(c)}>지우기</button></td>}
            </tr>
          ); })}
        </tbody>
      </table>
    </div>
  );
  const pagerEl = shown.length > 0 ? <Pager page={pager.page} pages={pager.pages} total={shown.length} size={50} from={pager.from} to={pager.to} onPage={pager.setPage} /> : null;

  const dialog = open ? (
    <div className="inv-modal" onClick={() => setOpen(false)}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">클레임 등록</h3>
        <p className="inv-modal-desc">주문을 고르고 종류·환불액을 적습니다. 재고 되돌림을 켜면 그 주문의 출고 줄만큼 <b>반품 입고</b> 문서가 생깁니다(교환은 교환 출고까지). 파손 반품이면 되돌림을 끄고 창고관리에서 폐기하세요.</p>
        <label className="inv-field"><span>주문 *</span>
          <input className="field-input" value={pickQ} onChange={(e) => { setPickQ(e.target.value); setImp(null); }} placeholder="주문번호 · 주문자 · 수취인 일부" />
        </label>
        {!imp && candidates.length > 0 && (
          <div className="ch-claim-pick">
            {candidates.map((i) => (
              <button type="button" key={i.id} className="ch-claim-pick-row" onClick={() => { setImp(i); setPickQ(i.channel_order_no); setRefundAmt(i.amount != null ? String(Math.round(i.amount)) : ""); }}>
                <b className="mono-number">{i.channel_order_no}</b><span>{channelLabel(i.channel)}</span><span>{i.buyer_name || "—"}</span>
                <span className="mono-number">{i.amount != null ? `₩${won(i.amount)}` : "—"}</span><span className="ev-dim">{SHIP_STATUS_LABEL[i.ship_status]}</span>
                {claimedNos.has(i.id) && <span className="ev-dim">클레임 있음</span>}
              </button>
            ))}
          </div>
        )}
        {imp && (<>
          <p className="inv-hint">{channelLabel(imp.channel)} · 주문일 {imp.order_date || "—"} · {imp.buyer_name || "—"} · 주문 금액 {imp.amount != null ? `₩${won(imp.amount)}` : "—"} · {SHIP_STATUS_LABEL[imp.ship_status]}{prevRefund > 0 && <> · 이미 환불 ₩{won(prevRefund)}</>}</p>
          <div className="ch-claim-grid">
            <label className="inv-field"><span>종류 *</span>
              <select className="field-input" value={kind} onChange={(e) => setKind(e.target.value as ClaimKind)}>
                {(Object.keys(CLAIM_KIND_LABEL) as ClaimKind[]).map((k) => <option key={k} value={k}>{CLAIM_KIND_LABEL[k]}</option>)}
              </select></label>
            <label className="inv-field"><span>환불액{kind === "exchange" ? " (교환은 0)" : ""}</span>
              <input className="field-input mono-number" inputMode="numeric" value={refundAmt} onChange={(e) => setRefundAmt(e.target.value.replace(/[^0-9]/g, ""))} placeholder="0" /></label>
            <label className="inv-field"><span>일자 *</span><DateField value={date} onChange={(e) => setDate(e.target.value)} /></label>
            <label className="inv-field"><span>사유</span><input className="field-input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="예: 단순 변심 · 파손 · 오배송" /></label>
          </div>
          {overRefund && <p className="inv-hint vr-warn">환불 합계가 주문 금액을 넘습니다. 부분 반품이면 금액을 확인하세요.</p>}
          <label className="inv-check"><input type="checkbox" checked={restock && !!imp.doc_id} disabled={!imp.doc_id} onChange={(e) => setRestock(e.target.checked)} /> 재고 되돌림 (반품 입고 문서 생성){!imp.doc_id && <span className="ev-dim"> — 출고 문서가 없는 주문</span>}</label>
          {restock && imp.doc_id && (
            <div className="inv-hint">{lines === null ? "출고 줄을 읽는 중…" : lines.length === 0 ? <span className="vr-warn">이 주문의 출고 줄을 찾지 못했습니다 — 되돌림을 끄고 등록하거나 창고관리에서 직접 입고하세요.</span>
              : <>되돌릴 줄: {lines.map((l) => `${productName.get(l.product_id) || l.product_id} ×${l.qty}`).join(", ")}</>}</div>
          )}
        </>)}
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(false)}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={!imp || busy || (restock && !!imp?.doc_id && (lines === null || lines.length === 0))} onClick={save}>{busy ? "저장 중…" : "등록"}</button>
        </div>
      </div>
    </div>
  ) : null;

  return { head, body, pagerEl, dialog, claims, openNew };
}

// ── 정산 ──────────────────────────────────────────────────────────────────
type SettleKey = "date" | "channel" | "no" | "sale" | "fee" | "settle";
export function useSettlePanel({ companyId, userId, imports, claims, canWrite, canLink = false }: {
  companyId: string | null; userId: string | null; imports: OrderImport[]; claims: Claim[]; canWrite: boolean;
  /** 통장 줄을 전표에 걸 권한(수집·전표) — 없으면 후보만 보이고 잇기 버튼은 꺼진다 */
  canLink?: boolean;
}): { head: ReactNode; body: ReactNode; pagerEl: ReactNode; dialog: ReactNode; settlements: Settlement[] } {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: settlements = [] } = useQuery({ queryKey: ["ch-settlements", companyId], queryFn: () => listSettlements(companyId!), enabled: !!companyId });
  const { data: fees = {} as ChannelFees } = useQuery({ queryKey: ["ch-fees", companyId], queryFn: () => loadChannelFees(companyId!), enabled: !!companyId });
  const impById = useMemo(() => new Map(imports.map((i) => [i.id, i])), [imports]);
  const MATCH_GROUP = [...CH_GROUP, { key: "match", label: "대조", hint: "비우면 전체", options: [{ value: "yes", label: "주문 있음" }, { value: "no", label: "주문 없음" }] }];
  const [cond, setCond] = useState<CondLive>({});
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState<SettleKey>>({ key: "date", dir: "desc" });
  const shown = useMemo(() => settlements.filter((s) => condHit(cond, "channel", s.channel) && condHit(cond, "match", s.import_id ? "yes" : "no")
    && quickSearchHit(q, [s.channel_order_no, impById.get(s.import_id || "")?.buyer_name])), [settlements, cond, q, impById]);
  const sorted = useMemo(() => {
    const d = sort.dir === "asc" ? 1 : -1;
    const val = (s: Settlement) => sort.key === "date" ? s.settled_at : sort.key === "channel" ? s.channel : sort.key === "no" ? s.channel_order_no
      : sort.key === "sale" ? s.sale_amount : sort.key === "fee" ? s.fee_amount : s.settle_amount;
    return [...shown].sort((a, b) => cmp(val(a), val(b)) * d);
  }, [shown, sort]);
  const pager = usePager(sorted, 50, `${JSON.stringify(cond)}|${q}|${sort.key}${sort.dir}`);
  const onSort = (k: string) => setSort((s) => nextSort(s, k as SettleKey));
  const summary = useMemo(() => settlementSummary(shown, fees), [shown, fees]);
  const unsettled = useMemo(() => unsettledImports(imports, settlements, claims, todayKst()), [imports, settlements, claims]);
  const [showUnsettled, setShowUnsettled] = useState(false);
  const total = { settle: shown.reduce((n, s) => n + s.settle_amount, 0), fee: shown.reduce((n, s) => n + s.fee_amount, 0), unmatched: shown.filter((s) => !s.import_id).length };

  const applyFee = async (ch: string, rate: number) => {
    if (!companyId) return;
    if (!(await appConfirm(`${channelLabel(ch)} 수수료율 설정을 실측값 ${(rate * 100).toFixed(1)}% 로 바꿀까요?\n현황·이익 계산의 순이익이 이 값으로 다시 계산됩니다.`, { confirmLabel: "바꾸기" }))) return;
    try {
      await saveChannelFees(companyId, { ...fees, [ch]: { fee_rate: Math.round(rate * 10000) / 10000, ship_per_order: fees[ch]?.ship_per_order ?? 0 } });
      toast(`${channelLabel(ch)} 수수료율을 ${(rate * 100).toFixed(1)}% 로 저장했습니다`, "success");
      qc.invalidateQueries({ queryKey: ["ch-fees", companyId] }); qc.invalidateQueries({ queryKey: ["inv-channel-fees", companyId] });
    } catch (e) { toast(friendlyError(e, "저장 실패"), "error"); }
  };
  const removeBatch = async (s: Settlement) => {
    const n = settlements.filter((x) => x.batch_id === s.batch_id).length;
    if (!companyId || !(await appConfirm(`이 줄이 속한 붙여넣기 묶음 ${n}건을 모두 지울까요?`, { danger: true, confirmLabel: "지우기" }))) return;
    try { const d = await deleteSettlementBatch(companyId, s.batch_id); toast(`${d}건을 지웠습니다`, "success"); qc.invalidateQueries({ queryKey: ["ch-settlements", companyId] }); }
    catch (e) { toast(friendlyError(e, "삭제 실패"), "error"); }
  };

  // ── 정산 전표 초안 팝업 (결정 271) — 묶음 합계로 일반전표 초안. 계정은 한 번 고르면 기억, 확정은 전표 현황 ──
  const [voucherBatch, setVoucherBatch] = useState<string | null>(null);
  const [acc, setAcc] = useState<SettlementAccounts>({});
  const [entryDate, setEntryDate] = useState(todayKst());
  const [vDesc, setVDesc] = useState("");
  const [vBusy, setVBusy] = useState(false);
  const [lastEntry, setLastEntry] = useState<string | null>(null);
  const { data: acctOpts = [] } = useQuery({ queryKey: ["ch-accounts", companyId], queryFn: () => listAccountOptions(companyId!), enabled: !!companyId && !!voucherBatch });
  const { data: savedAcc } = useQuery({ queryKey: ["ch-settle-accounts", companyId], queryFn: () => loadSettlementAccounts(companyId!), enabled: !!companyId && !!voucherBatch });
  const batchRows = useMemo(() => (voucherBatch ? settlements.filter((s) => s.batch_id === voucherBatch) : []), [settlements, voucherBatch]);
  const totals = useMemo(() => batchTotals(batchRows), [batchRows]);
  useEffect(() => {
    if (!voucherBatch || !acctOpts.length) return;
    //   기억한 계정이 이 회사 표에 있으면 그것, 없으면 표준 코드로 제안. 사람이 바꿀 수 있다
    const byCode = (code: string) => acctOpts.find((a) => a.code === code)?.id;
    const has = (id?: string) => !!id && acctOpts.some((a) => a.id === id);
    const next: SettlementAccounts = {};
    for (const k of Object.keys(SETTLEMENT_ACCOUNT_DEFAULT_CODES) as (keyof SettlementAccounts)[]) next[k] = has(savedAcc?.[k]) ? savedAcc![k] : byCode(SETTLEMENT_ACCOUNT_DEFAULT_CODES[k]);
    setAcc(next);
    setEntryDate(totals.to || todayKst());
    setVDesc("");
  }, [voucherBatch, acctOpts, savedAcc, totals.to]);
  //   반려된 초안은 '없는 것'으로 본다 — 다시 만들 때 연결을 풀고 만든다
  const liveVoucher = (s: Settlement) => !!s.journal_entry_id && s.journal_status !== "rejected";
  //   확정 전표 ↔ 통장 입금 대조 — 전표별 Σ정산금으로 입금 후보를 찾는다(±1원, 전표일 −3~+14일)
  const confirmedEntries = useMemo(() => {
    const m = new Map<string, { entryId: string; entryDate: string; settle: number }>();
    for (const s of settlements) {
      if (!s.journal_entry_id || s.journal_status !== "confirmed") continue;
      const cur = m.get(s.journal_entry_id) || { entryId: s.journal_entry_id, entryDate: s.settled_at, settle: 0 };
      cur.settle += s.settle_amount; if (s.settled_at > cur.entryDate) cur.entryDate = s.settled_at;
      m.set(s.journal_entry_id, cur);
    }
    return [...m.values()];
  }, [settlements]);
  const { data: bankLinks } = useQuery({
    queryKey: ["ch-settle-bank", companyId, confirmedEntries.map((e) => `${e.entryId}:${e.settle}`).join("|")],
    queryFn: () => fetchSettlementBankLinks(companyId!, confirmedEntries), enabled: !!companyId && confirmedEntries.length > 0, staleTime: 60_000,
  });
  const [linkFor, setLinkFor] = useState<string | null>(null);   // 팝업을 연 전표 id
  const [linking, setLinking] = useState<string | null>(null);
  const doLink = async (txId: string, entryId: string) => {
    if (linking) return;
    setLinking(txId);
    try {
      const ok = await linkSettlementBankTx(txId, entryId);
      toast(ok ? "통장 입금 줄을 정산 전표에 걸었습니다. 수집·전표 통장 탭에서 '전표됨'으로 보입니다." : "이미 다른 전표가 걸린 줄입니다", ok ? "success" : "info");
      setLinkFor(null);
      qc.invalidateQueries({ queryKey: ["ch-settle-bank"] }); qc.invalidateQueries({ queryKey: ["bank-rows"] });
    } catch (e) { toast(friendlyError(e, "연결 실패"), "error"); }
    finally { setLinking(null); }
  };
  const bankCell = (s: Settlement): ReactNode => {
    if (!liveVoucher(s)) return null;
    if (s.journal_status !== "confirmed") return <span className="ev-dim" title="전표를 확정하면 통장 입금 줄과 대조합니다">확정 후 대조</span>;
    const l = bankLinks?.get(s.journal_entry_id!);
    if (!l) return <span className="ev-dim">…</span>;
    if (l.linked.length) return <span title={l.linked.map((t) => `${t.transaction_date} ${t.counterparty || ""} ₩${won(t.amount)}`).join("\n")}><span className="ch-settle-nowrap">입금 대조됨</span> <span className="mono-number ch-settle-nowrap">{l.linked[0].transaction_date.slice(5)}</span></span>;
    if (l.candidates.length) return <button type="button" className="btn-secondary btn-sm ch-settle-nowrap" onClick={() => setLinkFor(s.journal_entry_id!)} title="같은 금액의 통장 입금 줄이 있습니다 — 골라서 전표에 겁니다">입금 잇기 ({l.candidates.length})</button>;
    return <span className="ev-dim" title="전표일 −3~+14일 안에 정산금과 같은 금액의 입금이 없습니다. 통장이 수집되면 다시 보입니다">입금 후보 없음</span>;
  };
  const batchHasVoucher = (batchId: string) => settlements.some((s) => s.batch_id === batchId && liveVoucher(s));
  const acctLabel = (id?: string) => { const a = acctOpts.find((x) => x.id === id); return a ? `${a.code || ""} ${a.name}`.trim() : "—"; };
  const voucherReady = !!(acc.bank && acc.fee && acc.ship && acc.sales) && (totals.diff === 0 || !!acc.diff);
  const makeVoucher = async () => {
    if (!companyId || !voucherBatch || vBusy || !voucherReady) return;
    setVBusy(true);
    try {
      await unlinkRejectedVoucher(companyId, voucherBatch);
      //   적요를 비우면 RPC 가 채널 '코드'(smartstore)로 채운다 — 전표 현황에 그대로 보이므로 같은 형식을 채널 이름으로 만들어 넘긴다 (2026-09-29 실측)
      const autoDesc = `채널 정산 ${totals.channels.map(channelLabel).join(", ")} · ${totals.from}~${totals.to} · ${totals.n}건 · 정산금 ₩${won(totals.settle)} · 수수료 ₩${won(totals.fee)} · 배송비 ₩${won(totals.ship)}`;
      const id = await makeSettlementVoucherDraft({ batchId: voucherBatch, entryDate, acctBank: acc.bank!, acctFee: acc.fee!, acctShip: acc.ship!, acctSales: acc.sales!, acctDiff: totals.diff !== 0 ? acc.diff : null, description: vDesc.trim() || autoDesc });
      try { await saveSettlementAccounts(companyId, acc); } catch { /* 기억 실패는 전표와 무관 */ }
      setLastEntry(id); setVoucherBatch(null);
      toast("정산 전표 초안을 만들었습니다. 전표 현황 › 처리할 것에서 확정하세요.", "success");
      qc.invalidateQueries({ queryKey: ["ch-settlements", companyId] }); qc.invalidateQueries({ queryKey: ["ch-settle-accounts", companyId] });
    } catch (e) { toast(friendlyError(e, "전표 초안 만들기 실패"), "error"); }
    finally { setVBusy(false); }
  };

  // ── 붙여넣기 팝업 ──
  const [open, setOpen] = useState(false);
  const [channel, setChannel] = useState<string>("smartstore");
  const [text, setText] = useState("");
  const [map, setMap] = useState<Partial<Record<SettleField, number>>>({});
  const [busy, setBusy] = useState(false);
  const headers = useMemo(() => text.replace(/\r/g, "").split("\n")[0]?.split("\t").map((h) => h.trim()) ?? [], [text]);
  useEffect(() => { if (headers.length) setMap(guessSettleColumns(headers)); }, [headers.join("\t")]);   // eslint-disable-line react-hooks/exhaustive-deps
  const parsed = useMemo(() => (text.trim() ? parseSettlementTsv(text, map) : { rows: [] as SettleRow[], skipped: 0, headers: [] as string[] }), [text, map]);
  const missing = SETTLE_FIELDS.filter((f) => f.required && map[f.key] == null).map((f) => f.label);
  const savePaste = async () => {
    if (!companyId || busy) return;
    setBusy(true);
    try {
      const r = await importSettlements(companyId, channel, parsed.rows, userId);
      toast(`${r.inserted}건 저장 (주문 대조 ${r.matched}건${r.skipped ? ` · 이미 있는 줄 ${r.skipped}건 건너뜀` : ""})`, r.inserted ? "success" : "info");
      setOpen(false); setText("");
      qc.invalidateQueries({ queryKey: ["ch-settlements", companyId] });
    } catch (e) { toast(friendlyError(e, "저장 실패"), "error"); }
    finally { setBusy(false); }
  };

  const head = (<>
    <QueryBar right={<>
      <button type="button" className="btn-secondary btn-sm" disabled={!shown.length}
        onClick={() => exportToExcel(sorted.map((s) => ({ "정산일": s.settled_at, "채널": channelLabel(s.channel), "주문번호": s.channel_order_no, "판매금액": s.sale_amount, "수수료": s.fee_amount, "배송비": s.shipping_amount, "정산금액": s.settle_amount, "주문 대조": s.import_id ? "있음" : "없음" })), "정산 내역", `채널정산_${todayKst()}`)}>엑셀</button>
      {canWrite && <button type="button" className="btn-primary btn-sm" onClick={() => setOpen(true)}>정산 내역 붙여넣기</button>}
    </>}>
      <SimpleCond groups={MATCH_GROUP} live={cond} onApply={setCond} />
      <QuickSearch value={q} onApply={setQ} placeholder="주문번호 · 주문자 · 쉼표로 여러 개, Enter" />
      <span className="inv-hint">채널이 준 정산 내역을 붙여넣으면 <b>주문과 대조</b>하고 실측 수수료율을 냅니다. 같은 줄은 다시 넣어도 건너뜁니다.</span>
    </QueryBar>
    <SimpleApplied groups={MATCH_GROUP} live={cond} onApply={setCond} />
    <ResultStrip>
      <Stat label="정산 줄" value={`${won(shown.length)}건`} />
      <Stat label="정산금" value={`₩${won(total.settle)}`} />
      <Stat label="수수료" value={`₩${won(total.fee)}`} tone={total.fee > 0 ? "minus" : undefined} />
      <button type="button" className="qk-stat-link" onClick={() => setShowUnsettled((v) => !v)} title={`출고 ${UNSETTLED_DAYS}일이 지났는데 정산 줄이 없는 주문`}>
        <Stat label="미정산 의심" value={`${won(unsettled.length)}건`} tone={unsettled.length ? "minus" : undefined} />
      </button>
      <button type="button" className="qk-stat-link" onClick={() => setCond((c) => ({ ...c, match: ["no"] }))} title="주문 가져오기에 없는 주문번호의 정산 줄 · 광고비·보정 줄도 여기">
        <Stat label="주문 없음" value={`${won(total.unmatched)}건`} />
      </button>
    </ResultStrip>
  </>);

  const body = (<>
    {summary.length > 0 && (
      <div className="pjv3-stpanel ch-settle-sum">
        <h3>채널별 <small>실측 수수료율 = 수수료 ÷ 판매금액. 설정과 1%p 넘게 다르면 갱신을 제안합니다(확정은 사람).</small></h3>
        <div className="stg-table-wrap"><table className="ev-table ev-lined ch-st-table">
          <thead><tr><th className="text-left">채널</th><th>정산 줄</th><th>주문 대조</th><th>판매금액</th><th>수수료</th><th>실측 수수료율</th><th>설정 수수료율</th><th>배송비</th><th>정산금</th>{canWrite && <th></th>}</tr></thead>
          <tbody>{summary.map((r) => {
            const diff = r.feeRateActual != null && r.feeRateSet != null ? r.feeRateActual - r.feeRateSet : null;
            const propose = r.feeRateActual != null && (r.feeRateSet == null || (diff != null && Math.abs(diff) > 0.01));
            return (
              <tr key={r.channel}>
                <td className="text-left"><b>{channelLabel(r.channel)}</b></td>
                <td className="tr mono-number">{won(r.n)}</td>
                <td className="tr mono-number">{won(r.matched)} <span className="ev-dim">/ {won(r.n)}</span></td>
                <td className="tr mono-number">₩{won(r.sale)}</td>
                <td className="tr mono-number">₩{won(r.fee)}</td>
                <td className={`tr mono-number ${propose ? "vr-warn" : ""}`}>{pct(r.feeRateActual)}</td>
                <td className="tr mono-number">{r.feeRateSet == null ? <span className="ev-dim">미설정</span> : pct(r.feeRateSet)}</td>
                <td className="tr mono-number">₩{won(r.ship)}</td>
                <td className="tr mono-number"><b>₩{won(r.settle)}</b></td>
                {canWrite && <td className="tc">{propose && r.feeRateActual != null && <button type="button" className="btn-secondary btn-sm" onClick={() => applyFee(r.channel, r.feeRateActual!)} title="회사 설정 › 재고 기준의 채널 수수료율을 실측값으로">설정을 {pct(r.feeRateActual)}로</button>}</td>}
              </tr>
            );
          })}</tbody>
        </table></div>
      </div>
    )}
    {showUnsettled && (
      <div className="pjv3-stpanel ch-settle-sum">
        <h3>미정산 의심 {won(unsettled.length)}건 <small>출고(또는 주문) {UNSETTLED_DAYS}일이 지났는데 정산 줄이 없는 주문 · 취소 클레임은 뺐습니다.</small></h3>
        {unsettled.length === 0 ? <div className="collect-empty">없습니다.</div> : (
          <div className="stg-table-wrap"><table className="ev-table ev-lined ch-st-table">
            <thead><tr><th>채널</th><th className="text-left">주문번호</th><th>주문일</th><th>출고일</th><th>주문자</th><th>금액</th></tr></thead>
            <tbody>{unsettled.slice(0, 100).map((i) => (
              <tr key={i.id}><td className="tc">{channelLabel(i.channel)}</td><td className="mono-number text-left"><b>{i.channel_order_no}</b></td><td className="mono-number">{i.order_date || "—"}</td><td className="mono-number">{i.shipped_at ? kstDateTime(i.shipped_at).slice(0, 10) : "—"}</td><td className="text-left">{i.buyer_name || "—"}</td><td className="tr mono-number">{i.amount != null ? `₩${won(i.amount)}` : "—"}</td></tr>
            ))}</tbody>
          </table>{unsettled.length > 100 && <p className="inv-hint">앞 100건만 보입니다.</p>}</div>
        )}
      </div>
    )}
    {lastEntry && <p className="inv-hint">정산 전표 초안이 생겼습니다. <Link href="/finance/status?tab=todo" className="bz-link">전표 현황 › 처리할 것에서 확정 →</Link></p>}
    {shown.length === 0 ? (
      <div className="collect-empty">{settlements.length === 0 ? <>아직 정산 내역이 없습니다. 채널 판매자센터의 정산 내역 엑셀을 <b>정산 내역 붙여넣기</b>로 넣으세요.</> : "조건에 맞는 정산 줄이 없습니다."}</div>
    ) : (
      <div className="stg-table-wrap">
        <table className="ev-table ev-lined table-inv-ch-settle ch-settle-fit">
          <thead><tr>
            <SortableTh label="정산일" sortKey="date" sort={sort} onSort={onSort} />
            <SortableTh label="채널" sortKey="channel" sort={sort} onSort={onSort} />
            <SortableTh label="주문번호" sortKey="no" sort={sort} onSort={onSort} />
            <th>주문자</th>
            <SortableTh label="판매금액" sortKey="sale" sort={sort} onSort={onSort} />
            <SortableTh label="수수료" sortKey="fee" sort={sort} onSort={onSort} />
            <th>배송비</th>
            <SortableTh label="정산금" sortKey="settle" sort={sort} onSort={onSort} />
            <th>대조</th><th>전표</th><th>통장 입금</th>{canWrite && <th></th>}
          </tr></thead>
          <tbody>{pager.view.map((s) => { const i = s.import_id ? impById.get(s.import_id) : undefined; return (
            <tr key={s.id}>
              <td className="mono-number">{s.settled_at}</td>
              <td className="tc">{channelLabel(s.channel)}</td>
              <td className="mono-number text-left"><b>{s.channel_order_no}</b></td>
              <td className="text-left">{i?.buyer_name || <span className="ev-dim">—</span>}</td>
              <td className="tr mono-number">₩{won(s.sale_amount)}</td>
              <td className="tr mono-number">₩{won(s.fee_amount)}</td>
              <td className="tr mono-number">₩{won(s.shipping_amount)}</td>
              <td className={`tr mono-number ${s.settle_amount < 0 ? "vr-warn" : ""}`}><b>₩{won(s.settle_amount)}</b></td>
              <td className="tc">{s.import_id ? <span title="주문 가져오기 기록과 이어짐">주문 있음</span> : <span className="ev-dim" title="주문 가져오기에 이 주문번호가 없습니다">주문 없음</span>}</td>
              <td className="tc">{liveVoucher(s) ? <span title={s.journal_status === "confirmed" ? "정산 전표가 확정됐습니다" : "이 묶음의 정산 전표 초안이 있습니다 · 전표 현황에서 확정"}>{s.journal_status === "confirmed" ? "확정" : "초안 있음"}</span> : s.journal_entry_id ? <span className="ev-dim" title="전표가 반려됐습니다 · 다시 만들 수 있습니다">반려됨</span> : <span className="ev-dim">—</span>}</td>
              <td className="tc ch-settle-wrap">{bankCell(s) ?? <span className="ev-dim">—</span>}</td>
              {canWrite && <td className="tc"><span className="ch-settle-actions">
                {!liveVoucher(s) && <button type="button" className="btn-secondary btn-sm" onClick={() => setVoucherBatch(s.batch_id)} title="이 줄이 속한 붙여넣기 묶음 합계로 정산 전표 초안을 만듭니다">전표 초안</button>}
                <button type="button" className="btn-secondary btn-sm" disabled={batchHasVoucher(s.batch_id)} onClick={() => removeBatch(s)} title={batchHasVoucher(s.batch_id) ? "전표 초안이 있는 묶음은 지울 수 없습니다 — 전표를 먼저 반려하세요" : "이 줄이 속한 붙여넣기 묶음을 지웁니다"}>묶음 지우기</button>
              </span></td>}
            </tr>
          ); })}</tbody>
        </table>
      </div>
    )}
  </>);
  const pagerEl = shown.length > 0 ? <Pager page={pager.page} pages={pager.pages} total={shown.length} size={50} from={pager.from} to={pager.to} onPage={pager.setPage} /> : null;

  const acctSelect = (k: keyof SettlementAccounts, label: string, hint: string) => (
    <label className="inv-field" title={hint}><span>{label}{k === "diff" && totals.diff !== 0 ? " *" : k === "diff" ? "" : " *"}</span>
      <select className="field-input" value={acc[k] || ""} onChange={(e) => setAcc((a) => ({ ...a, [k]: e.target.value || undefined }))}>
        <option value="">(고르세요)</option>
        {acctOpts.map((a) => <option key={a.id} value={a.id}>{a.code ? `${a.code} ` : ""}{a.name}</option>)}
      </select></label>
  );
  const voucherDialog = voucherBatch ? (
    <div className="inv-modal" onClick={() => setVoucherBatch(null)}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">정산 전표 초안</h3>
        <p className="inv-modal-desc">이 붙여넣기 묶음의 합계로 일반전표 <b>초안</b>을 만듭니다. 확정은 재무 › 전표 현황 › 처리할 것에서 합니다. 계정은 한 번 고르면 다음부터 기억합니다.</p>
        <div className="ch-settle-sum pjv3-stpanel">
          <h3>{totals.channels.map(channelLabel).join(", ")} · {totals.from}{totals.to !== totals.from ? ` ~ ${totals.to}` : ""} · {totals.n}건</h3>
          <table className="ev-table ev-lined ch-st-table"><tbody>
            <tr><td className="text-left">차) {acctLabel(acc.bank)} <span className="ev-dim">정산금(입금)</span></td><td className="tr mono-number">₩{won(totals.settle)}</td></tr>
            {totals.fee !== 0 && <tr><td className="text-left">차) {acctLabel(acc.fee)} <span className="ev-dim">수수료</span></td><td className="tr mono-number">₩{won(totals.fee)}</td></tr>}
            {totals.ship !== 0 && <tr><td className="text-left">차) {acctLabel(acc.ship)} <span className="ev-dim">배송비</span></td><td className="tr mono-number">₩{won(totals.ship)}</td></tr>}
            {totals.diff > 0 && <tr><td className="text-left">차) {acctLabel(acc.diff)} <span className="ev-dim">차액(기타 공제)</span></td><td className="tr mono-number vr-warn">₩{won(totals.diff)}</td></tr>}
            <tr className="vr-total"><td className="text-left">대) {acctLabel(acc.sales)} <span className="ev-dim">{totals.sale > 0 ? "판매금액" : "판매금액 없음 → 정산금+수수료+배송비"}</span></td><td className="tr mono-number">₩{won(totals.creditSales)}</td></tr>
            {totals.diff < 0 && <tr><td className="text-left">대) {acctLabel(acc.diff)} <span className="ev-dim">차액(기타 수입)</span></td><td className="tr mono-number vr-warn">₩{won(-totals.diff)}</td></tr>}
          </tbody></table>
          {totals.diff !== 0 && <p className="inv-hint vr-warn">판매금액과 정산 합이 ₩{won(Math.abs(totals.diff))} 다릅니다(쿠폰·광고비·보정 등). 차액 계정을 골라야 전표가 맞습니다.</p>}
        </div>
        <div className="ch-claim-grid">
          {acctSelect("bank", "입금 계정", "정산금이 들어오는 통장 계정 · 표준 103 보통예금")}
          {acctSelect("fee", "수수료 계정", "채널 판매·결제 수수료 · 표준 831 지급수수료")}
          {acctSelect("ship", "배송비 계정", "채널이 정산에서 뺀 배송비 · 표준 824 운반비")}
          {acctSelect("sales", "매출 계정", "채널 판매금액 · 표준 404 제품매출 (상품이면 401)")}
          {totals.diff !== 0 && acctSelect("diff", "차액 계정", "판매금액 − 정산 합 · 표준 406 매출할인")}
          <label className="inv-field"><span>전표 일자 *</span><DateField value={entryDate} onChange={(e) => setEntryDate(e.target.value)} /></label>
          <label className="inv-field"><span>적요</span><input className="field-input" value={vDesc} onChange={(e) => setVDesc(e.target.value)} placeholder="비우면 채널·기간·건수로 자동" /></label>
        </div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setVoucherBatch(null)}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={vBusy || !voucherReady || totals.n === 0} onClick={makeVoucher}>{vBusy ? "만드는 중…" : "초안 만들기"}</button>
        </div>
      </div>
    </div>
  ) : null;

  const linkDialog = linkFor && bankLinks?.get(linkFor) ? (() => {
    const l = bankLinks.get(linkFor)!; const e = confirmedEntries.find((x) => x.entryId === linkFor);
    return (
      <div className="inv-modal" onClick={() => setLinkFor(null)}>
        <div className="inv-modal-box" onClick={(ev) => ev.stopPropagation()}>
          <h3 className="inv-modal-title">통장 입금 잇기</h3>
          <p className="inv-modal-desc">정산 전표(정산금 ₩{won(e?.settle || 0)}, {e?.entryDate})와 같은 금액의 통장 입금 줄입니다. 하나를 고르면 그 줄은 이 전표로 처리되고 수집·전표 통장 탭에서 「전표됨」이 됩니다.{!canLink && <b> 수집·전표 권한이 없어 볼 수만 있습니다.</b>}</p>
          <table className="ev-table ev-lined ch-st-table"><thead><tr><th>거래일</th><th className="text-left">상대</th><th className="text-left">적요</th><th>금액</th><th></th></tr></thead>
            <tbody>{l.candidates.map((t) => (
              <tr key={t.id}><td className="mono-number">{t.transaction_date}</td><td className="text-left">{t.counterparty || "—"}</td><td className="text-left ev-dim">{t.description || "—"}</td><td className="tr mono-number">₩{won(t.amount)}</td>
                <td className="tc"><button type="button" className="btn-primary btn-sm" disabled={!canLink || !!linking} onClick={() => doLink(t.id, linkFor)}>{linking === t.id ? "잇는 중…" : "이 입금으로"}</button></td></tr>
            ))}</tbody></table>
          <div className="inv-modal-actions"><button type="button" className="btn-secondary btn-sm" onClick={() => setLinkFor(null)}>닫기</button></div>
        </div>
      </div>
    );
  })() : null;

  const dialog = (<>
    {voucherDialog}
    {linkDialog}
    {open && (
    <div className="inv-modal" onClick={() => setOpen(false)}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">정산 내역 붙여넣기</h3>
        <p className="inv-modal-desc">채널 판매자센터의 정산 내역(엑셀)을 머리글 줄까지 그대로 붙여넣습니다. 열 이름이 채널마다 달라 어느 열이 무엇인지 아래에서 확인합니다. 주문번호·정산일·정산금액이 없는 줄은 건너뜁니다.</p>
        <label className="inv-field"><span>채널 *</span>
          <select className="field-input" value={channel} onChange={(e) => setChannel(e.target.value)}>
            {CHANNELS.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select></label>
        <label className="inv-field"><span>정산 내역</span>
          <ExcelPasteHelper templateName="채널정산_양식" sheetName="정산 내역" onText={setText}
            cols={SETTLE_FIELDS.map((f) => ({ key: f.key, label: f.label, required: f.required }))} />
          <textarea className="field-input ch-settle-paste" value={text} onChange={(e) => setText(e.target.value)} placeholder="엑셀에서 머리글 포함 범위를 복사해 붙여넣기" rows={6} />
        </label>
        {headers.length > 1 && (
          <div className="ch-settle-map">
            {SETTLE_FIELDS.map((f) => (
              <label key={f.key} className="inv-field" title={f.desc}><span>{f.label}{f.required ? " *" : ""}</span>
                <select className="field-input" value={map[f.key] ?? ""} onChange={(e) => setMap((m) => ({ ...m, [f.key]: e.target.value === "" ? undefined : Number(e.target.value) }))}>
                  <option value="">(없음)</option>
                  {headers.map((h, i) => <option key={i} value={i}>{h || `(${i + 1}열)`}</option>)}
                </select></label>
            ))}
          </div>
        )}
        {text.trim() && (
          <p className="inv-hint">{missing.length ? <span className="vr-warn">{missing.join("·")} 열을 골라야 합니다.</span> : <>{parsed.rows.length}줄 저장 예정{parsed.skipped ? ` · 값이 빈 ${parsed.skipped}줄 건너뜀` : ""} · 정산금 합 ₩{won(parsed.rows.reduce((n, r) => n + r.settle_amount, 0))} · 수수료 합 ₩{won(parsed.rows.reduce((n, r) => n + r.fee_amount, 0))}</>}</p>
        )}
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(false)}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy || !parsed.rows.length || missing.length > 0} onClick={savePaste}>{busy ? "저장 중…" : `저장 (${parsed.rows.length})`}</button>
        </div>
      </div>
    </div>
    )}
  </>);

  return { head, body, pagerEl, dialog, settlements };
}
