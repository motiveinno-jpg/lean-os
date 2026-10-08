"use client";

// 세금·증빙 › 발행 요청 / 받은 발행 요청
//
//   발행 요청      우리가 받을(매입) 세금계산서를 미리 채워 공급자에게 보낸다. 공급자는 작성일만 넣고 자기 명의로 발행한다.
//   받은 발행 요청  다른 오너뷰 회사가 우리에게 보낸 요청. 미리 채운 내용을 보고 작성일만 넣어 발행한다
//                  (이 화면의 평소 발행과 같은 길: createTaxInvoice → hometax-issue → 요청에 묶기).
//
//   조회 화면 표준을 따른다 — 탭은 페이지가 그려 넘겨 주고(tabStrip), 조회 줄·결과 요약·표·쪽은 여기서.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, QuickSearch, ResultStrip, Stat, Pager, usePager, quickSearchHit,
} from "@/components/query-kit";
import { PickList } from "@/components/pick-list";
import { DateField } from "@/components/date-field";
import { CurrencyInput } from "@/components/currency-input";
import { useToast } from "@/components/toast";
import { appConfirm } from "@/components/global-confirm";
import { friendlyError } from "@/lib/friendly-error";
import { todayKst } from "@/lib/kst";
import { logRead } from "@/lib/log-read";
import { supabase } from "@/lib/supabase";
import { createTaxInvoice, issueTaxInvoice, registerHometaxIssuer } from "@/lib/tax-invoice";
import { invalidateTaxInvoiceReaders } from "@/lib/tax-invoice-invalidate";
import { IssueRequestInvoice } from "@/components/issue-request-invoice";
import {
  listSentRequests, listReceivedRequests, createIssueRequest, sendIssueRequestEmail, cancelIssueRequest,
  markRequestIssued, issueRequestLink, calcRequestLine, sumRequestItems, requestRemark,
  requestItemsToTaxInvoiceItems, isRequestExpired, formatBizNo, formatConfirmNo, digitsOnly, isEmail,
  validateWriteDate, REQUEST_STATUS_LABEL, ISSUED_VIA_LABEL, TAX_KIND_LABEL,
  type TaxInvoiceRequest, type RequestItem, type RequestTaxKind, type RequestPurpose,
} from "@/lib/tax-invoice-request";

type Partner = {
  id: string; name: string; business_number?: string | null; contact_email?: string | null;
  representative?: string | null;
};
type IssuanceStatus = { limit: number | null; used: number; remaining: number | null; planName: string | null } | null | undefined;

const won = (n: unknown) => `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}원`;
const dateOf = (iso: string | null | undefined) => (iso ? String(iso).slice(0, 10) : "");

/** 상태 칩 — 만료는 DB 상태가 아니라 기한으로 판정한다 */
function StatusChip({ r }: { r: TaxInvoiceRequest }) {
  const expired = isRequestExpired(r);
  const cls = expired ? "tir-chip tir-chip-off"
    : r.status === "issued" ? "tir-chip tir-chip-done"
    : r.status === "viewed" ? "tir-chip tir-chip-seen"
    : r.status === "canceled" ? "tir-chip tir-chip-off"
    : "tir-chip";
  return <span className={cls}>{expired ? "만료" : REQUEST_STATUS_LABEL[r.status]}</span>;
}

/** 처리할 것이 위 — 보냄·열람 → 발행됨 → 취소 */
const STATUS_ORDER: Record<string, number> = { sent: 0, viewed: 0, issued: 1, canceled: 2 };

export function IssueRequestsScreen({
  kind, tabStrip, companyId, partners, isHometaxConnected, issuanceStatus, initialRequestId,
}: {
  kind: "requests" | "received";
  tabStrip: ReactNode;
  companyId: string;
  partners: Partner[];
  isHometaxConnected: boolean;
  issuanceStatus: IssuanceStatus;
  initialRequestId?: string | null;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [q, setQ] = useState("");
  const [size, setSize] = useState(50);
  const [showNew, setShowNew] = useState(false);
  const [openId, setOpenId] = useState<string | null>(initialRequestId || null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const listKey = ["tax-invoice-requests", kind, companyId];
  const { data: rows = [], isLoading, error } = useQuery({
    queryKey: listKey,
    queryFn: () => (kind === "requests" ? listSentRequests(companyId) : listReceivedRequests(companyId)),
    enabled: !!companyId,
  });
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["tax-invoice-requests"] });
    qc.invalidateQueries({ queryKey: ["tax-invoice-requests-open", companyId] });
  };

  useEffect(() => { if (initialRequestId) setOpenId(initialRequestId); }, [initialRequestId]);

  const filtered = useMemo(() => {
    const list = rows.filter((r) => !q || quickSearchHit(q,
      [r.supplier_name, r.buyer_name, r.po_number, r.title, r.supplier_email, r.nts_confirm_no, formatBizNo(r.supplier_business_number)],
      [Number(r.total_amount) || 0]));
    return [...list].sort((a, b) =>
      (STATUS_ORDER[a.status] ?? 9) - (STATUS_ORDER[b.status] ?? 9) || b.created_at.localeCompare(a.created_at));
  }, [rows, q]);
  const pager = usePager(filtered, size, q);

  const counts = useMemo(() => ({
    open: rows.filter((r) => (r.status === "sent" || r.status === "viewed") && !isRequestExpired(r)).length,
    issued: rows.filter((r) => r.status === "issued").length,
    total: rows.reduce((s, r) => s + (r.status === "canceled" ? 0 : Number(r.total_amount) || 0), 0),
  }), [rows]);

  const open = rows.find((r) => r.id === openId) || null;

  const resend = async (r: TaxInvoiceRequest) => {
    setBusyId(r.id);
    try {
      await sendIssueRequestEmail(r.id);
      toast(`${r.supplier_email} 으로 다시 보냈습니다`, "success");
      refresh();
    } catch (e) {
      toast(friendlyError(e, "메일을 보내지 못했습니다"), "error");
    } finally { setBusyId(null); }
  };
  const copyLink = async (r: TaxInvoiceRequest) => {
    try { await navigator.clipboard.writeText(issueRequestLink(r.token)); toast("링크를 복사했습니다", "success"); }
    catch { toast("복사하지 못했습니다 — 브라우저가 클립보드를 막았습니다", "error"); }
  };
  const cancel = async (r: TaxInvoiceRequest) => {
    if (!(await appConfirm(`${r.supplier_name}에 보낸 발행 요청을 취소할까요? 링크가 더 열리지 않습니다.`, { danger: true, confirmLabel: "요청 취소", title: "발행 요청 취소" }))) return;
    setBusyId(r.id);
    try { await cancelIssueRequest(r.id); toast("요청을 취소했습니다", "success"); refresh(); }
    catch (e) { toast(friendlyError(e, "취소하지 못했습니다"), "error"); }
    finally { setBusyId(null); }
  };

  const isReq = kind === "requests";
  return (
    <>
      <QueryScreen>
        <QueryHead>
          {tabStrip}
          <QueryBar right={isReq ? (
            <button type="button" className="btn-primary btn-sm" onClick={() => setShowNew(true)}
              title="받을 세금계산서 내용을 채워 공급자에게 보냅니다">+ 발행 요청</button>
          ) : undefined}>
            <QuickSearch value={q} onApply={setQ}
              placeholder={isReq ? "공급자 · 발주번호 · 발주명 · 금액, Enter" : "요청 회사 · 발주번호 · 발주명 · 금액, Enter"} />
          </QueryBar>
          <ResultStrip>
            <Stat label="전체" value={`${rows.length.toLocaleString("ko")}건`} />
            <Stat label={isReq ? "발행 기다림" : "발행할 것"} value={`${counts.open.toLocaleString("ko")}건`} />
            <Stat label="발행됨" value={`${counts.issued.toLocaleString("ko")}건`} />
            <Stat label="금액" value={won(counts.total)} title="취소한 요청은 빼고 더한 합계(세금 포함)" />
          </ResultStrip>
        </QueryHead>
        <QueryBody>
          <div className="tir-scroll">
            {error ? (
              <div className="collect-empty collect-empty-err">목록을 불러오지 못했습니다. 새로고침해 주세요.</div>
            ) : isLoading ? (
              <div className="collect-empty">불러오는 중…</div>
            ) : filtered.length === 0 ? (
              <div className="collect-empty">
                {q ? "조건에 맞는 요청이 없습니다." : isReq
                  ? "아직 보낸 발행 요청이 없습니다. 받을 세금계산서를 미리 채워 공급자에게 보내면, 공급자는 작성일만 넣고 발행합니다."
                  : "받은 발행 요청이 없습니다. 거래처가 오너뷰에서 요청을 보내면 여기에 뜹니다."}
              </div>
            ) : (
              <table className="ev-table tir-table">
                <thead>
                  <tr>
                    <th>상태</th>
                    <th>{isReq ? "공급자" : "요청 회사"}</th>
                    <th>발주번호</th>
                    <th>발주명</th>
                    <th>합계</th>
                    <th>{isReq ? "보낸 날" : "받은 날"}</th>
                    <th>{isReq ? "발행일 · 승인번호" : "지급예정일"}</th>
                    <th>관리</th>
                  </tr>
                </thead>
                <tbody>
                  {pager.view.map((r) => {
                    const live = (r.status === "sent" || r.status === "viewed") && !isRequestExpired(r);
                    return (
                      <tr key={r.id} className="tir-row" onClick={() => setOpenId(r.id)}>
                        <td className="tir-c"><StatusChip r={r} /></td>
                        <td className="tir-name">
                          <b>{isReq ? r.supplier_name : r.buyer_name}</b>
                          <span className="ev-dim">{formatBizNo(isReq ? r.supplier_business_number : r.buyer_business_number)}</span>
                        </td>
                        <td className="tir-c">{r.po_number || "—"}</td>
                        <td className="tir-title">{r.title || r.items?.[0]?.name || "—"}</td>
                        <td className="tir-r mono-number">{won(r.total_amount)}</td>
                        <td className="tir-c">{dateOf(r.last_sent_at || r.created_at)}</td>
                        <td className="tir-c">
                          {isReq ? (r.status === "issued" ? (
                            <span className="tir-issued">
                              {r.write_date || dateOf(r.issued_at)}
                              {r.issued_via && <em>{ISSUED_VIA_LABEL[r.issued_via]}</em>}
                              {r.nts_confirm_no
                                ? <span className="tir-confirm">{formatConfirmNo(r.nts_confirm_no)}</span>
                                : <span className="ev-dim">승인번호 대기</span>}
                            </span>
                          ) : "—") : (r.pay_due_date || "—")}
                        </td>
                        <td className="tir-c" onClick={(e) => e.stopPropagation()}>
                          {isReq ? (
                            <span className="tir-acts">
                              {live && (
                                <button type="button" className="btn-secondary btn-sm" disabled={busyId === r.id} onClick={() => resend(r)}>다시 보내기</button>
                              )}
                              {live && <button type="button" className="btn-secondary btn-sm" onClick={() => copyLink(r)}>링크 복사</button>}
                              {live && (
                                <button type="button" className="btn-secondary btn-sm" disabled={busyId === r.id} onClick={() => cancel(r)}>취소</button>
                              )}
                              {!live && <span className="ev-dim">—</span>}
                            </span>
                          ) : live ? (
                            <button type="button" className="btn-secondary btn-sm" onClick={() => setOpenId(r.id)}>발행하기</button>
                          ) : <span className="ev-dim">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </QueryBody>
        <Pager page={pager.page} pages={pager.pages} total={filtered.length} size={size}
          from={pager.from} to={pager.to} onPage={pager.setPage} onSize={setSize} />
      </QueryScreen>

      {showNew && (
        <NewRequestModal companyId={companyId} partners={partners}
          onClose={() => setShowNew(false)}
          onDone={() => { setShowNew(false); refresh(); }} />
      )}
      {open && isReq && <SentRequestModal r={open} onClose={() => setOpenId(null)} />}
      {open && !isReq && (
        <ReceivedIssueModal r={open} companyId={companyId} partners={partners}
          isHometaxConnected={isHometaxConnected} issuanceStatus={issuanceStatus}
          onClose={() => setOpenId(null)}
          onIssued={() => { setOpenId(null); refresh(); invalidateTaxInvoiceReaders(qc); qc.invalidateQueries({ queryKey: ["tax-invoice-issuance-status"] }); }} />
      )}
    </>
  );
}

// ── 새 발행 요청 ──────────────────────────────────────────────────────────

type DraftItem = { name: string; spec: string; qty: string; unit_price: string; supply_amount: string; tax_amount: string };
const EMPTY_ITEM: DraftItem = { name: "", spec: "", qty: "1", unit_price: "", supply_amount: "", tax_amount: "" };

function NewRequestModal({ companyId, partners, onClose, onDone }: {
  companyId: string; partners: Partner[]; onClose: () => void; onDone: () => void;
}) {
  const { toast } = useToast();
  const [partnerId, setPartnerId] = useState<string | null>(null);
  const [picking, setPicking] = useState(false);
  const [bizNo, setBizNo] = useState("");
  const [name, setName] = useState("");
  const [rep, setRep] = useState("");
  const [email, setEmail] = useState("");
  const [title, setTitle] = useState("");
  const [po, setPo] = useState("");
  const [taxKind, setTaxKind] = useState<RequestTaxKind>("taxable");
  const [purpose, setPurpose] = useState<RequestPurpose>("청구");
  const [items, setItems] = useState<DraftItem[]>([{ ...EMPTY_ITEM }]);
  const [bank, setBank] = useState("");
  const [due, setDue] = useState("");
  const [memo, setMemo] = useState("");
  const [saving, setSaving] = useState(false);


  const pickItems = useMemo(() => partners.map((p) => ({ id: p.id, name: p.name, code: p.business_number || "" })), [partners]);
  const pickPartner = (id: string) => {
    const p = partners.find((x) => x.id === id);
    setPicking(false);
    if (!p) return;
    setPartnerId(p.id);
    setBizNo(formatBizNo(p.business_number));
    setName(p.name || "");
    setRep(p.representative || "");
    setEmail(p.contact_email || "");
    //   입금계좌는 돈을 받는 공급자(거래처)의 계좌 — 거래처에 등록된 계좌가 있으면 채운다(사람이 적은 값은 덮지 않음)
    const pb = [(p as any).bank_name, (p as any).account_number].filter(Boolean).join(" ");
    if (pb) setBank((b) => b || `${pb} ${p.name || ""}`.trim());
  };

  //   수량·단가를 고치면 공급가액·세액을 다시 계산, 공급가액을 고치면 세액만, 세액은 손댄 값 그대로
  const setItem = (i: number, k: keyof DraftItem, v: string, kindNow = taxKind) => {
    setItems((list) => list.map((it, j) => {
      if (j !== i) return it;
      const next = { ...it, [k]: v };
      if (k === "qty" || k === "unit_price") {
        const c = calcRequestLine(Number(next.qty) || 0, Number(next.unit_price) || 0, kindNow);
        next.supply_amount = String(c.supply);
        next.tax_amount = String(c.tax);
      } else if (k === "supply_amount") {
        next.tax_amount = String(kindNow === "taxable" ? Math.round((Number(v) || 0) * 0.1) : 0);
      }
      return next;
    }));
  };
  const changeKind = (k: RequestTaxKind) => {
    setTaxKind(k);
    setItems((list) => list.map((it) => ({
      ...it, tax_amount: String(k === "taxable" ? Math.round((Number(it.supply_amount) || 0) * 0.1) : 0),
    })));
  };

  const asItems: RequestItem[] = items.map((it) => ({
    name: it.name, spec: it.spec, qty: Number(it.qty) || 0, unit_price: Number(it.unit_price) || 0,
    supply_amount: Number(it.supply_amount) || 0, tax_amount: Number(it.tax_amount) || 0,
  }));
  const sum = sumRequestItems(asItems);

  const problem = (() => {
    if (digitsOnly(bizNo).length !== 10) return "공급자 사업자등록번호 10자리를 입력해 주세요.";
    if (!name.trim()) return "공급자 상호를 입력해 주세요.";
    if (!isEmail(email)) return "요청을 받을 공급자 이메일을 입력해 주세요.";
    if (!asItems.some((it) => it.name.trim())) return "품목을 한 줄 이상 입력해 주세요.";
    if (sum.supply === 0) return "공급가액이 0원입니다.";
    return null;
  })();

  const save = async () => {
    if (problem) { toast(problem, "error"); return; }
    setSaving(true);
    try {
      const row = await createIssueRequest({
        companyId, partnerId, supplierBusinessNumber: bizNo, supplierName: name, supplierRepresentative: rep,
        supplierEmail: email, title, poNumber: po, items: asItems, taxKind, purpose,
        payBankText: bank, payDueDate: due, memo,
      });
      try {
        await sendIssueRequestEmail(row.id);
        toast(`${email.trim()} 으로 발행 요청을 보냈습니다`, "success");
      } catch (e) {
        toast(`요청은 저장했지만 메일을 보내지 못했습니다 — 목록에서 '다시 보내기'를 눌러 주세요. (${friendlyError(e, "메일 실패")})`, "error");
      }
      onDone();
    } catch (e) {
      toast(friendlyError(e, "요청을 저장하지 못했습니다"), "error");
    } finally { setSaving(false); }
  };

  return (
    <div className="ti-cfm-overlay" onClick={onClose}>
      <div className="ti-cfm tir-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ti-cfm-head">
          <b>세금계산서 발행 요청<span className="ui-sub">받을 계산서를 미리 채워 공급자에게 보냅니다</span></b>
          <span>공급자는 메일 링크에서 작성일자만 넣고 자기 명의로 발행합니다. 공급받는자에는 우리 회사 정보가 들어갑니다.</span>
        </div>
        <div className="ti-cfm-body">
          <div className="tir-sec">
            <div className="tir-sec-title">공급자</div>
            <div className="tir-grid">
              <label className="tir-fld tir-fld-wide">
                <span>거래처</span>
                <span className="tir-pick-anchor">
                  <button type="button" className="qk-input tir-pick-btn" onClick={() => setPicking((v) => !v)}>
                    {partnerId ? (partners.find((p) => p.id === partnerId)?.name || "거래처") : "거래처에서 고르기 (선택)"}
                  </button>
                  {picking && (
                    <PickList items={pickItems} placeholder="거래처 검색 (이름·사업자번호)"
                      onPick={(it) => pickPartner(it.id)} onClose={() => setPicking(false)} />
                  )}
                </span>
              </label>
              <label className="tir-fld"><span>사업자번호 *</span>
                <input className="qk-input" value={bizNo} placeholder="123-45-67890" onChange={(e) => setBizNo(e.target.value)} /></label>
              <label className="tir-fld"><span>상호 *</span>
                <input className="qk-input" value={name} onChange={(e) => setName(e.target.value)} /></label>
              <label className="tir-fld"><span>대표자</span>
                <input className="qk-input" value={rep} onChange={(e) => setRep(e.target.value)} /></label>
              <label className="tir-fld"><span>이메일 *</span>
                <input className="qk-input" type="email" value={email} placeholder="요청 메일을 받을 주소" onChange={(e) => setEmail(e.target.value)} /></label>
            </div>
          </div>

          <div className="tir-sec">
            <div className="tir-sec-title">계산서 내용</div>
            <div className="tir-grid">
              <label className="tir-fld"><span>발주명</span>
                <input className="qk-input" value={title} placeholder="예: 10월 광고 대행" onChange={(e) => setTitle(e.target.value)} /></label>
              <label className="tir-fld"><span>발주번호</span>
                <input className="qk-input" value={po} onChange={(e) => setPo(e.target.value)} /></label>
              <label className="tir-fld"><span>세금유형</span>
                <select className="qk-input" value={taxKind} onChange={(e) => changeKind(e.target.value as RequestTaxKind)}>
                  {(Object.keys(TAX_KIND_LABEL) as RequestTaxKind[]).map((k) => <option key={k} value={k}>{TAX_KIND_LABEL[k]}</option>)}
                </select></label>
              <label className="tir-fld"><span>영수/청구</span>
                <select className="qk-input" value={purpose} onChange={(e) => setPurpose(e.target.value as RequestPurpose)}>
                  <option value="청구">청구 (아직 안 줌)</option>
                  <option value="영수">영수 (이미 줌)</option>
                </select></label>
            </div>
            <div className="tir-items">
              <table className="ev-table tir-items-table">
                <thead>
                  <tr><th>품목 *</th><th>규격</th><th>수량</th><th>단가</th><th>공급가액</th><th>세액</th><th /></tr>
                </thead>
                <tbody>
                  {items.map((it, i) => (
                    <tr key={i}>
                      <td><input className="qk-input" value={it.name} onChange={(e) => setItem(i, "name", e.target.value)} /></td>
                      <td><input className="qk-input" value={it.spec} onChange={(e) => setItem(i, "spec", e.target.value)} /></td>
                      <td><input className="qk-input tir-num" inputMode="decimal" value={it.qty}
                        onChange={(e) => setItem(i, "qty", e.target.value.replace(/[^0-9.]/g, ""))} /></td>
                      <td><CurrencyInput className="qk-input tir-num" value={it.unit_price} onValueChange={(v) => setItem(i, "unit_price", v)} /></td>
                      <td><CurrencyInput className="qk-input tir-num" value={it.supply_amount} onValueChange={(v) => setItem(i, "supply_amount", v)} /></td>
                      <td><CurrencyInput className="qk-input tir-num" value={it.tax_amount} onValueChange={(v) => setItem(i, "tax_amount", v)} /></td>
                      <td>
                        <button type="button" className="btn-secondary btn-sm" disabled={items.length === 1}
                          onClick={() => setItems((l) => l.filter((_, j) => j !== i))} aria-label="줄 빼기">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr>
                    <td colSpan={4}>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setItems((l) => [...l, { ...EMPTY_ITEM }])}>+ 줄 추가</button>
                    </td>
                    <td className="tir-r mono-number">{won(sum.supply)}</td>
                    <td className="tir-r mono-number">{won(sum.tax)}</td>
                    <td className="tir-r mono-number tir-strong">{won(sum.total)}</td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </div>

          <div className="tir-sec">
            <div className="tir-sec-title">지급</div>
            <div className="tir-grid">
              <label className="tir-fld tir-fld-wide"><span>입금계좌 (공급자 계좌)</span>
                <input className="qk-input" value={bank} placeholder="대금을 보낼 거래처 계좌 — 예: 국민 123-456-789012 (주)거래처" onChange={(e) => setBank(e.target.value)} /></label>
              <label className="tir-fld"><span>지급예정일</span>
                <DateField value={due} onChange={(e) => setDue(e.target.value)} /></label>
              <label className="tir-fld tir-fld-wide"><span>비고</span>
                <textarea className="qk-input tir-memo" value={memo} maxLength={120} onChange={(e) => setMemo(e.target.value)} /></label>
            </div>
            <div className="ev-dim">국세청 비고란에는 「{requestRemark(po, memo) || "(비어 있음)"}」로 들어갑니다.</div>
          </div>
        </div>
        <div className="ti-cfm-foot">
          {problem && <span className="ti-cfm-warn">{problem}</span>}
          <span className="flex-1" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={saving}>닫기</button>
          <button type="button" className="btn-primary btn-sm" onClick={save} disabled={saving || !!problem}>
            {saving ? "보내는 중…" : "저장하고 메일 보내기"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── 보낸 요청 보기 ────────────────────────────────────────────────────────

function SentRequestModal({ r, onClose }: { r: TaxInvoiceRequest; onClose: () => void }) {
  return (
    <div className="ti-cfm-overlay" onClick={onClose}>
      <div className="ti-cfm tir-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ti-cfm-head">
          <b>{r.supplier_name}<span className="ui-sub">보낸 발행 요청</span></b>
          <span>
            <StatusChip r={r} />{" "}
            {r.viewed_at && `열람 ${dateOf(r.viewed_at)} · `}
            {r.status === "issued"
              ? `발행 ${r.write_date || dateOf(r.issued_at)} (${r.issued_via ? ISSUED_VIA_LABEL[r.issued_via] : "-"})${r.nts_confirm_no ? ` · 승인번호 ${formatConfirmNo(r.nts_confirm_no)}` : " · 승인번호는 국세청 전송 뒤 붙습니다"}${r.purchase_invoice_id ? " · 매입 계산서와 연결됨" : ""}`
              : `${r.supplier_email} · 링크 기한 ${dateOf(r.expires_at)}`}
          </span>
        </div>
        <div className="ti-cfm-body">
          <IssueRequestInvoice data={r} />
          {r.issued_via === "hometax_manual" && !r.purchase_invoice_id && (
            <div className="ev-dim">승인번호는 공급자가 직접 적은 값입니다. 홈택스 매입 수집으로 같은 번호가 들어오면 자동으로 연결됩니다.</div>
          )}
        </div>
        <div className="ti-cfm-foot">
          <span className="flex-1" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}

// ── 받은 요청 → 발행 ──────────────────────────────────────────────────────

function ReceivedIssueModal({ r, companyId, partners, isHometaxConnected, issuanceStatus, onClose, onIssued }: {
  r: TaxInvoiceRequest; companyId: string; partners: Partner[]; isHometaxConnected: boolean;
  issuanceStatus: IssuanceStatus; onClose: () => void; onIssued: () => void;
}) {
  const { toast } = useToast();
  const [writeDate, setWriteDate] = useState(todayKst());
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const live = (r.status === "sent" || r.status === "viewed") && !isRequestExpired(r);
  const limitReached = issuanceStatus?.limit != null && (issuanceStatus.remaining ?? 0) <= 0;
  const dateProblem = validateWriteDate(writeDate, todayKst());

  //   발행 등록(최초 1회) — 계산서 상세 팝업과 같은 길. 응답 뒤 window.open 은 팝업 차단에 걸려 빈 창을 먼저 연다.
  const register = async () => {
    setRegistering(true);
    const popup = window.open("", "_blank");
    if (popup) popup.document.write('<p style="font-family:sans-serif;padding:24px;color:#555">인증서 등록 페이지를 불러오는 중입니다…</p>');
    try {
      const { certURL, message } = await registerHometaxIssuer(companyId);
      if (popup && !popup.closed) popup.location.href = certURL; else window.open(certURL, "_blank");
      toast(message || "인증서 등록 페이지를 열었습니다. 등록 후 발행하세요.", "success");
    } catch (e) {
      popup?.close();
      toast(`발행 등록 실패: ${(e as Error)?.message || ""}`, "error");
    } finally { setRegistering(false); }
  };

  const issue = async () => {
    if (dateProblem) { toast(dateProblem, "error"); return; }
    if (!(await appConfirm(`작성일자 ${writeDate}로 ${r.buyer_name || "요청 회사"}에 세금계산서를 발행할까요? 보낸 뒤에는 수정세금계산서로만 고칠 수 있습니다.`, { confirmLabel: "발행", title: "세금계산서 발행" }))) return;
    setBusy(true);
    try {
      const remark = requestRemark(r.po_number, r.memo);
      //   한 번 실패한 뒤 다시 누르면 계산서를 또 만들지 않는다 — 같은 요청으로 만든 미발행 계산서를 다시 쓴다
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const prior = logRead("issueRequest.priorInvoice", await (supabase as any).from("tax_invoices")
        .select("id, nts_issue_status")
        .eq("company_id", companyId).eq("type", "sales").eq("source", "manual")
        .eq("counterparty_bizno", r.buyer_business_number || "")
        .eq("total_amount", r.total_amount)
        .or("nts_issue_status.is.null,nts_issue_status.neq.issued")
        //   비고가 비면 createTaxInvoice 가 null 로 저장한다
        .filter("remark", remark ? "eq" : "is", remark || null)
        .order("created_at", { ascending: false }).limit(1).maybeSingle()) as { id: string } | null;
      let invoiceId = prior?.id || "";
      if (invoiceId) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        await (supabase as any).from("tax_invoices").update({ issue_date: writeDate }).eq("id", invoiceId);
      } else {
        const partner = partners.find((p) => digitsOnly(p.business_number) === digitsOnly(r.buyer_business_number));
        const items = requestItemsToTaxInvoiceItems(r.items);
        const inv = await createTaxInvoice({
          companyId,
          type: "sales",
          counterpartyName: r.buyer_name || "",
          counterpartyBizno: r.buyer_business_number || undefined,
          counterpartyRepresentative: r.buyer_representative || undefined,
          counterpartyAddress: r.buyer_address || undefined,
          counterpartyBusinessType: r.buyer_business_type || undefined,
          counterpartyBusinessItem: r.buyer_business_item || undefined,
          counterpartyEmail: r.buyer_email || undefined,
          supplyAmount: Math.round(Number(r.supply_amount) || 0),
          taxAmount: Math.round(Number(r.tax_amount) || 0),
          issueDate: writeDate,
          partnerId: partner?.id,
          taxKind: r.tax_kind,
          items,
          itemName: items[0]?.name || r.title || undefined,
          label: r.purpose,
          remark: remark || undefined,
        });
        invoiceId = (inv as { id?: string } | null)?.id || "";
      }
      if (!invoiceId) throw new Error("계산서를 만들지 못했습니다");
      try {
        await issueTaxInvoice(invoiceId);
      } catch (e) {
        const err = e as Error & { hint?: string };
        toast(`발행 실패: ${err.message}${err.hint ? " — " + err.hint : ""} (계산서는 '발행 대기'에 남았습니다)`, "error");
        return;
      }
      await markRequestIssued(r.id, invoiceId);
      toast("발행했습니다. 요청 회사에도 발행 완료로 표시됩니다.", "success");
      onIssued();
    } catch (e) {
      toast(friendlyError(e, "발행하지 못했습니다"), "error");
    } finally { setBusy(false); }
  };

  return (
    <div className="ti-cfm-overlay" onClick={onClose}>
      <div className="ti-cfm tir-modal" onClick={(e) => e.stopPropagation()}>
        <div className="ti-cfm-head">
          <b>{r.buyer_name}<span className="ui-sub">받은 발행 요청</span></b>
          <span>내용은 요청 회사가 채웠습니다. 작성일자만 넣고 발행하면 우리 회사 명의로 국세청에 나갑니다.</span>
        </div>
        <div className="ti-cfm-body">
          <IssueRequestInvoice data={r} slot={live ? (
            <div className="tir-issue-slot">
              <label className="tir-fld"><span>작성일자 *</span>
                <DateField value={writeDate} max={todayKst()} onChange={(e) => setWriteDate(e.target.value)} /></label>
              {dateProblem && <span className="ti-cfm-block">{dateProblem}</span>}
            </div>
          ) : (
            <div className="tir-issue-slot">
              <StatusChip r={r} />
              {r.status === "issued" && <span>작성일 {r.write_date || "-"}{r.nts_confirm_no ? ` · 승인번호 ${formatConfirmNo(r.nts_confirm_no)}` : ""}</span>}
              {isRequestExpired(r) && <span>링크 기한이 지났습니다. 요청 회사에 다시 보내 달라고 해 주세요.</span>}
            </div>
          )} />
          {live && !isHometaxConnected && (
            <div className="tir-guide">
              전자발행은 홈택스 연결과 <b>발행 등록</b>(처음 한 번)이 필요합니다.{" "}
              <Link href="/settings?tab=bank">설정 › 은행연동</Link>에서 홈택스를 먼저 연결해 주세요.
            </div>
          )}
          {live && isHometaxConnected && (
            <div className="tir-guide">
              전자발행은 처음 한 번 <b>발행 등록</b>(팝빌 회원가입 + 공동인증서 등록, 윈도우 PC·30초 유효)이 필요합니다.
              이미 했다면 바로 발행하면 됩니다.
            </div>
          )}
          {live && limitReached && (
            <div className="tir-guide tir-guide-warn">
              {issuanceStatus?.planName || "현재 요금제"}의 이번 달 발행 한도({issuanceStatus?.limit}건)를 모두 썼습니다. 요금제 › 충전에서 늘릴 수 있습니다.
            </div>
          )}
        </div>
        <div className="ti-cfm-foot">
          {live && isHometaxConnected && (
            <button type="button" className="btn-secondary btn-sm" onClick={register} disabled={registering}>
              {registering ? "등록 페이지 여는 중…" : "발행 등록 (회원가입+인증서)"}
            </button>
          )}
          <span className="flex-1" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={busy}>닫기</button>
          {live && (
            <button type="button" className="btn-primary btn-sm" onClick={issue}
              disabled={busy || !isHometaxConnected || limitReached || !!dateProblem}>
              {busy ? "발행 중…" : "세금계산서 발행"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
