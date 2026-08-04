"use client";

// 청구 한 줄의 문서 팝업 — 견적서 · 계약서 · 세금계산서 (2026-08-04).
//
//   1차 버전은 '요약 카드'였다. 사장님 지적: "견적서에는 어떤 품목인지 입력하고 실제 견적서
//   입력을 할 수 있어야 하는데 너무 많은 게 축소돼 있다. 보내기 버튼도 없고."
//   → 문서함에서 쓰는 **품목 테이블(QuoteItemsTable)을 그대로 재사용**해 실제 작성 화면으로 바꿨다.
//     같은 부품을 쓰므로 문서함과 견적서가 서로 다르게 동작할 일이 없다.
//
//   여기서 끝내는 일: 품목 입력 · 저장 · 검토 요청/승인 · 거래처 발송(메일) · 공유 링크 · 계산서 만들기.
//   문서 편집기로 넘어가는 일: PDF·전자서명 이력·버전 비교(드물어서 링크만 남긴다).

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { createTaxInvoice } from "@/lib/tax-invoice";
import { todayKst, kstDateStr } from "@/lib/kst";
import { DateField } from "@/components/date-field";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { QuoteItemsTable } from "@/app/(app)/documents/_components/QuoteItemsTable";
import { saveRevision, submitForReview, approveDocument } from "@/lib/documents";
import { createSignatureRequest, sendSignatureEmail } from "@/lib/signatures";
import { createDocumentShare } from "@/lib/document-sharing";

const db = supabase as any;
const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

export type DocKind = "quote" | "contract" | "issue";
type PayMode = "full" | "two" | "three";

const DOC_LABEL: Record<DocKind, string> = { quote: "견적서", contract: "계약서", issue: "세금계산서" };
const STATUS_LABEL: Record<string, string> = {
  draft: "초안", review: "검토중", approved: "승인", executed: "체결", locked: "잠금",
};

export function BoardDocModal({
  kind, rowName, doc, amount, partnerName, partnerId, companyId, dealId, userId,
  onClose, onIssued, onSent, onApproved,
}: {
  kind: DocKind;
  rowName: string;
  doc: any | null;
  /** 이 청구 건의 금액(공급가) — 품목이 없을 때의 기준값 */
  amount: number;
  partnerName: string;
  partnerId: string | null;
  companyId: string;
  dealId: string;
  userId?: string;
  onClose: () => void;
  /** 계산서를 만들면 행을 '발행' 단계로 */
  onIssued: () => void;
  /** 거래처에 보내면 행을 '견적' 단계로 */
  onSent?: () => void;
  /** 승인되면 행을 '계약' 단계로 */
  onApproved?: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const cj = (doc?.content_json as any) || {};
  const [items, setItems] = useState<any[]>([]);
  const [issueDate, setIssueDate] = useState(todayKst());
  const [validUntil, setValidUntil] = useState("");
  const [dirty, setDirty] = useState(false);

  // 문서를 열 때 한 번만 채운다 — 편집 중에 되돌려지지 않게
  useEffect(() => {
    const c = (doc?.content_json as any) || {};
    const rows = Array.isArray(c.items) && c.items.length > 0 ? c.items : (
      amount > 0
        // 품목이 없으면 행 이름·금액으로 한 줄 깔아 준다 — 빈 표 앞에서 막히지 않게
        ? [{ name: rowName || "품목", quantity: 1, unitPrice: amount, supplyAmount: amount, taxAmount: Math.round(amount * 0.1), totalAmount: Math.round(amount * 1.1) }]
        : []
    );
    setItems(rows);
    setValidUntil(c.validUntil || kstDateStr(new Date(Date.now() + 30 * 86_400_000)));
    setDirty(false);
  }, [doc?.id]);   // eslint-disable-line react-hooks/exhaustive-deps

  const existing: any[] = Array.isArray(cj.paymentSchedule) ? cj.paymentSchedule : [];
  const [payMode, setPayMode] = useState<PayMode>(
    existing.length >= 3 ? "three" : existing.length === 2 ? "two" : "full",
  );
  const [adv, setAdv] = useState<number>(Number(existing[0]?.ratio) || 30);
  const [mid, setMid] = useState<number>(existing.length >= 3 ? Number(existing[1]?.ratio) || 40 : 40);

  // 품목 합계 — 없으면 행 금액을 쓴다
  const supply = items.length > 0
    ? items.reduce((s, i) => s + (Number(i.supplyAmount) || 0), 0)
    : amount;
  const vat = items.length > 0
    ? items.reduce((s, i) => s + (Number(i.taxAmount) || 0), 0)
    : Math.round(amount * 0.1);

  // 이 문서의 발송 이력 — '보냈는지 안 보냈는지' 를 화면에서 알 수 있게(2026-08-04 실측:
  //   서명요청 779건 중 delivery_status 가 전부 비어 있어 발송 여부를 알 길이 없었다)
  const { data: sends = [] } = useQuery({
    queryKey: ["pb-doc-sends", doc?.id],
    queryFn: async () => {
      const data = logRead("BoardDocModal:sends", await db.from("signature_requests")
        .select("id, signer_name, signer_email, status, sent_at, viewed_at, signed_at, delivery_status, delivery_detail")
        .eq("document_id", doc.id).order("created_at", { ascending: false }));
      return (data || []) as any[];
    },
    enabled: !!doc?.id,
  });

  const terms = useMemo(() => {
    const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n || 0)));
    if (payMode === "full") return [{ label: "전액", ratio: 100, condition: "" }];
    if (payMode === "two") {
      const a = clamp(adv);
      return [{ label: "선금", ratio: a, condition: "계약 후 7일 이내" },
              { label: "잔금", ratio: 100 - a, condition: "납품 완료 후 14일 이내" }];
    }
    const a = clamp(adv), m = clamp(mid);
    return [{ label: "선금", ratio: a, condition: "계약 후 7일 이내" },
            { label: "중도금", ratio: m, condition: "중간 산출물 확인 후" },
            { label: "잔금", ratio: Math.max(0, 100 - a - m), condition: "납품 완료 후 14일 이내" }];
  }, [payMode, adv, mid]);
  const termAmount = (ratio: number) => Math.round((supply * ratio) / 100);

  const refreshDoc = () => {
    qc.invalidateQueries({ queryKey: ["pb-docs", dealId] });
    qc.invalidateQueries({ queryKey: ["pb-doc-sends", doc?.id] });
  };

  // ── 저장 — 문서함과 **같은 saveRevision** 을 쓴다(이력도 똑같이 남는다) ──
  const save = async (silent = false) => {
    if (!doc?.id || !userId) return false;
    let allocated = 0;
    const schedule = terms.map((t, i) => {
      const amt = i === terms.length - 1 ? supply - allocated : termAmount(t.ratio);
      allocated += amt;
      return { label: t.label, ratio: t.ratio, amount: amt, condition: t.condition };
    });
    const next = {
      ...cj,
      items,
      validUntil,
      header: { ...(cj.header || {}), partnerId, partnerName },
      ...(kind === "contract" || existing.length > 0 || payMode !== "full"
        ? { paymentSchedule: schedule, paymentTerms: schedule.map((s) => `${s.label} ${s.ratio}% (${s.condition || "협의"})`).join(", ") }
        : {}),
    };
    await saveRevision({ documentId: doc.id, authorId: userId, contentJson: next as any });
    setDirty(false);
    refreshDoc();
    if (!silent) toast("저장했습니다.", "success");
    return true;
  };

  const guard = async (fn: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    try { await fn(); }
    catch (e: any) { toast(e?.message || "처리 실패", "error"); }
    finally { setBusy(false); }
  };

  // ── 거래처에 메일로 보내기 — 문서함의 '거래처에게 발송' 과 같은 경로 ──
  const sendToPartner = () => guard(async () => {
    if (!doc?.id || !userId) return;
    if (dirty) await save(true);
    if (!partnerId) throw new Error("거래처를 먼저 지정하세요");
    const p = logRead("BoardDocModal:partner", await db.from("partners")
      .select("contact_email, contact_name, name").eq("id", partnerId).maybeSingle());
    const email = p?.contact_email || "";
    if (!email) throw new Error(`'${partnerName}' 에 이메일이 없습니다 — 거래처 정보에 담당자 이메일을 넣어 주세요`);
    const req = await createSignatureRequest({
      companyId, documentId: doc.id, title: doc.name || DOC_LABEL[kind],
      signerName: p?.contact_name || p?.name || partnerName || "거래처",
      signerEmail: email, createdBy: userId,
    });
    const r = await sendSignatureEmail(req.id);
    // 발송 결과를 남긴다 — 안 남기면 보냈는지 알 길이 없다
    await db.from("signature_requests").update({
      delivery_status: r.error ? "failed" : "sent",
      delivery_detail: r.error ? String(r.error).slice(0, 300) : email,
      delivery_at: new Date().toISOString(),
    }).eq("id", req.id);
    refreshDoc();
    if (r.error) { toast(`메일 발송 실패: ${r.error} — 아래에서 재발송하거나 공유 링크를 쓰세요`, "error"); return; }
    onSent?.();
    toast(`${email} 로 보냈습니다.`, "success");
  });

  const resend = (reqId: string) => guard(async () => {
    const r = await sendSignatureEmail(reqId);
    await db.from("signature_requests").update({
      delivery_status: r.error ? "failed" : "sent",
      delivery_detail: r.error ? String(r.error).slice(0, 300) : null,
      delivery_at: new Date().toISOString(),
    }).eq("id", reqId);
    refreshDoc();
    toast(r.error ? `재발송 실패: ${r.error}` : "다시 보냈습니다.", r.error ? "error" : "success");
  });

  const copyShareLink = () => guard(async () => {
    if (!doc?.id || !userId) return;
    if (dirty) await save(true);
    const { shareUrl } = await createDocumentShare({ documentId: doc.id, companyId, createdBy: userId, expiresInDays: 30 });
    await navigator.clipboard.writeText(shareUrl);
    toast("공유 링크를 복사했습니다. 메신저로 붙여 넣어 보내세요.", "success");
  });

  const submit = () => guard(async () => {
    if (!doc?.id) return;
    if (dirty) await save(true);
    await submitForReview(doc.id);
    refreshDoc();
    toast("검토 요청했습니다.", "success");
  });

  const approve = () => guard(async () => {
    if (!doc?.id || !userId) return;
    await approveDocument(doc.id, userId);
    refreshDoc();
    onApproved?.();
    toast("승인했습니다.", "success");
  });

  // 계산서는 **발행 대기(초안)** 로만 만든다 — 국세청 발행은 세금계산서 화면에서 사람이 누른다.
  const makeInvoice = () => guard(async () => {
    if (!partnerName) throw new Error("거래처를 먼저 지정하세요");
    if (supply <= 0) throw new Error("금액을 먼저 입력하세요");
    await createTaxInvoice({
      companyId, dealId, type: "sales",
      counterpartyName: partnerName, partnerId: partnerId || undefined,
      supplyAmount: supply, issueDate, label: rowName || "청구", status: "draft",
    });
    qc.invalidateQueries({ queryKey: ["tax-invoices"] });
    toast("세금계산서를 발행 대기로 만들었습니다. 세금계산서 화면에서 발행하세요.", "success");
    onIssued();
    onClose();
  });

  const status = doc?.status || "draft";
  const canEdit = status === "draft" || status === "review";
  const lastSend = sends[0];

  useModalKeys(true, onClose, busy ? undefined : kind === "issue" ? makeInvoice : () => save());

  return (
    <div className="pb-doc-modal" onClick={onClose}>
      <div className="pb-doc-box pb-doc-wide" onClick={(e) => e.stopPropagation()}>
        <header className="pb-doc-head">
          <div>
            <b>{rowName || "청구 건"}</b>
            <span>{DOC_LABEL[kind]}{doc?.document_number ? ` · ${doc.document_number}` : ""}</span>
          </div>
          {kind !== "issue" && <span className={`pb-doc-st pb-doc-st-${status}`}>{STATUS_LABEL[status] || status}</span>}
          {dirty && <span className="pb-doc-dirty">저장 안 됨</span>}
          <button type="button" onClick={onClose} title="닫기">✕</button>
        </header>

        <div className="pb-doc-body">
          <dl className="pb-doc-facts">
            <div><dt>거래처</dt><dd>{partnerName || <em>미지정 — 표에서 거래처를 고르세요</em>}</dd></div>
            {kind === "issue"
              ? <div><dt>발행일</dt><dd><DateField value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></dd></div>
              : <div><dt>{kind === "quote" ? "유효기간" : "계약일"}</dt>
                  <dd><DateField value={validUntil} onChange={(e) => { setValidUntil(e.target.value); setDirty(true); }} /></dd></div>}
            <div><dt>공급가</dt><dd className="pb-doc-num">{won(supply)}원</dd></div>
            <div><dt>합계</dt><dd className="pb-doc-num pb-doc-total">{won(supply + vat)}원 <em>(부가세 {won(vat)})</em></dd></div>
          </dl>

          {/* 품목 — 문서함과 같은 부품. 회사 컬럼 설정·My품목·과거 문서 불러오기가 그대로 붙는다 */}
          {kind !== "issue" && doc?.id && (
            <section className="pb-doc-items">
              <b>{kind === "quote" ? "견적 품목" : "계약 내역"}</b>
              <QuoteItemsTable
                items={items}
                onChange={(next) => { setItems(next); setDirty(true); }}
                companyId={companyId}
                editable={canEdit}
                taxRate={0.1}
                partnerName={partnerName} />
            </section>
          )}

          {kind !== "issue" && (
            <section className="pb-doc-terms">
              <b>결제조건</b>
              <div className="pb-doc-modes">
                {([["full", "전액"], ["two", "선금·잔금"], ["three", "선금·중도금·잔금"]] as [PayMode, string][]).map(([m, label]) => (
                  <button key={m} type="button" onClick={() => { setPayMode(m); setDirty(true); }} aria-pressed={payMode === m}
                    className={payMode === m ? "pb-doc-mode-on" : ""}>{label}</button>
                ))}
              </div>
              {payMode !== "full" && (
                <div className="pb-doc-ratios">
                  <label>선금 <input type="number" min={0} max={100} value={adv} onChange={(e) => { setAdv(Number(e.target.value)); setDirty(true); }} />%</label>
                  {payMode === "three" && (
                    <label>중도금 <input type="number" min={0} max={100} value={mid} onChange={(e) => { setMid(Number(e.target.value)); setDirty(true); }} />%</label>
                  )}
                </div>
              )}
              <ul className="pb-doc-termlist">
                {terms.map((t) => (
                  <li key={t.label}>
                    <span>{t.label} <em>{t.ratio}%</em></span>
                    <b className="pb-doc-num">{won(termAmount(t.ratio))}원</b>
                    <i>{t.condition || "협의"}</i>
                  </li>
                ))}
              </ul>
              {kind === "contract" && (
                <p className="pb-doc-hint">저장하면 표 위에서 이 회차대로 <b>청구 줄을 만들 수 있어요</b>.</p>
              )}
            </section>
          )}

          {/* 발송 이력 — 보냈는지 · 열어봤는지 · 실패했는지 */}
          {kind !== "issue" && sends.length > 0 && (
            <section className="pb-doc-terms">
              <b>보낸 기록</b>
              {sends.slice(0, 3).map((s) => (
                <div key={s.id} className="pb-doc-send">
                  <span className={`pb-doc-sendst ${s.delivery_status === "failed" ? "pb-doc-sendst-bad" : ""}`}>
                    {s.delivery_status === "failed" ? "발송 실패" : s.signed_at ? "서명 완료" : s.viewed_at ? "열어봄" : "보냄"}
                  </span>
                  <span className="pb-doc-sendto">{s.signer_name} · {s.signer_email}</span>
                  <span className="pb-doc-sendwhen">{String(s.sent_at || "").slice(5, 16).replace("T", " ")}</span>
                  <button type="button" onClick={() => resend(s.id)} disabled={busy}>다시 보내기</button>
                </div>
              ))}
            </section>
          )}

          {kind === "issue" && (
            <p className="pb-doc-hint">
              <b>발행 대기</b>로만 만듭니다. 국세청 실제 발행은 세금계산서 화면에서 확인하고 누르세요.
            </p>
          )}
        </div>

        <footer className="pb-doc-foot">
          {doc?.id && <Link href={`/documents?id=${doc.id}`} className="pb-doc-link" title="PDF · 서명 이력 · 버전 비교">편집기 ↗</Link>}
          {kind === "issue" && <Link href="/tax-invoices" className="pb-doc-link">세금계산서 화면 ↗</Link>}
          <span className="pb-doc-spacer" />
          {kind !== "issue" && (<>
            <button type="button" className="pb-doc-sub" disabled={busy || !canEdit} onClick={() => save()}>저장</button>
            {status === "draft" && <button type="button" className="pb-doc-sub" disabled={busy} onClick={submit}>검토 요청</button>}
            {status === "review" && <button type="button" className="pb-doc-sub" disabled={busy} onClick={approve}>승인</button>}
            <button type="button" className="pb-doc-sub" disabled={busy} onClick={copyShareLink}>공유 링크</button>
            <button type="button" className="pb-doc-go" disabled={busy} onClick={sendToPartner}>
              {busy ? "…" : lastSend ? "다시 보내기" : "거래처에 보내기"}
            </button>
          </>)}
          {kind === "issue" && (
            <button type="button" className="pb-doc-go" disabled={busy} onClick={makeInvoice}>{busy ? "만드는 중…" : "발행 대기로 만들기"}</button>
          )}
        </footer>
      </div>
    </div>
  );
}
