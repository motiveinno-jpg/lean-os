"use client";

// 청구 한 줄의 문서 팝업 — 견적 · 계약 · 발행 (2026-08-04 사장님 지시).
//
//   "견적이나 계약, 발행 버튼을 클릭하면 페이지 이동보다 팝업으로 보여주는 게 좋겠다.
//    화면 이동이 너무 잦아서 업무의 흐름이 자연스럽지 못하다."
//
//   자주 하는 일(금액 확인 · 승인 · 결제조건 정하기 · 계산서 만들기)은 여기서 끝낸다.
//   PDF·서명처럼 무거운 편집만 문서 편집기로 넘어간다(링크는 남겨 둔다).

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { createTaxInvoice } from "@/lib/tax-invoice";
import { todayKst } from "@/lib/kst";
import { DateField } from "@/components/date-field";
import { useModalKeys } from "@/hooks/use-modal-keys";

const db = supabase as any;
const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

export type DocKind = "quote" | "contract" | "issue";
type PayMode = "full" | "two" | "three";

const DOC_LABEL: Record<DocKind, string> = { quote: "견적서", contract: "계약서", issue: "세금계산서" };
const STATUS_LABEL: Record<string, string> = {
  draft: "초안", review: "검토중", approved: "승인", executed: "체결", locked: "잠금",
};

export function BoardDocModal({ kind, rowName, doc, amount, partnerName, partnerId, companyId, dealId, onClose, onIssued }: {
  kind: DocKind;
  rowName: string;
  /** 견적·계약일 때의 문서. 발행일 때는 근거 계약서 */
  doc: any | null;
  /** 이 청구 건의 금액(공급가 기준) — 행의 '금액' 칸 */
  amount: number;
  partnerName: string;
  partnerId: string | null;
  companyId: string;
  dealId: string;
  onClose: () => void;
  /** 계산서를 만들면 행을 '발행' 단계로 옮기라고 알린다 */
  onIssued: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);

  const cj = (doc?.content_json as any) || {};
  const existing: any[] = Array.isArray(cj.paymentSchedule) ? cj.paymentSchedule : [];

  const [payMode, setPayMode] = useState<PayMode>(
    existing.length >= 3 ? "three" : existing.length === 2 ? "two" : "full",
  );
  const [adv, setAdv] = useState<number>(Number(existing[0]?.ratio) || 30);
  const [mid, setMid] = useState<number>(existing.length >= 3 ? Number(existing[1]?.ratio) || 40 : 40);
  const [issueDate, setIssueDate] = useState(todayKst());

  const vat = Math.round(amount * 0.1);

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

  const termAmount = (ratio: number) => Math.round((amount * ratio) / 100);

  // ── 저장 ──────────────────────────────────────────────
  const saveTerms = async () => {
    if (!doc || busy) return;
    setBusy(true);
    try {
      let allocated = 0;
      const schedule = terms.map((t, i) => {
        const amt = i === terms.length - 1 ? amount - allocated : termAmount(t.ratio);
        allocated += amt;
        return { label: t.label, ratio: t.ratio, amount: amt, condition: t.condition };
      });
      const next = {
        ...cj,
        paymentSchedule: schedule,
        paymentTerms: schedule.map((s) => `${s.label} ${s.ratio}% (${s.condition || "협의"})`).join(", "),
      };
      const { error } = await db.from("documents").update({ content_json: next }).eq("id", doc.id);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["pb-docs", dealId] });
      toast("결제조건을 저장했습니다. 표 위에서 청구 행을 만들 수 있어요.", "success");
      onClose();
    } catch (e: any) {
      toast(e?.message || "저장 실패", "error");
    } finally { setBusy(false); }
  };

  const approve = async () => {
    if (!doc || busy) return;
    setBusy(true);
    try {
      const { error } = await db.from("documents").update({ status: "approved" }).eq("id", doc.id);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["pb-docs", dealId] });
      toast("승인 처리했습니다.", "success");
    } catch (e: any) {
      toast(e?.message || "승인 실패", "error");
    } finally { setBusy(false); }
  };

  // 계산서는 **발행 대기(초안)** 로만 만든다 — 국세청 발행은 세금계산서 화면에서 사람이 누른다.
  const makeInvoice = async () => {
    if (busy) return;
    if (!partnerName) { toast("거래처를 먼저 지정하세요", "error"); return; }
    if (amount <= 0) { toast("금액을 먼저 입력하세요", "error"); return; }
    setBusy(true);
    try {
      await createTaxInvoice({
        companyId, dealId, type: "sales",
        counterpartyName: partnerName, partnerId: partnerId || undefined,
        supplyAmount: amount, issueDate, label: rowName || "청구", status: "draft",
      });
      qc.invalidateQueries({ queryKey: ["tax-invoices"] });
      toast("세금계산서를 발행 대기로 만들었습니다. 세금계산서 화면에서 발행하세요.", "success");
      onIssued();
      onClose();
    } catch (e: any) {
      toast(e?.message || "생성 실패", "error");
    } finally { setBusy(false); }
  };

  const status = doc?.status || "draft";

  // ESC 로 닫고, Enter 로 주 동작 — 다른 모달과 같은 손버릇을 유지한다
  useModalKeys(true, onClose, busy ? undefined
    : kind === "contract" ? saveTerms
    : kind === "issue" ? makeInvoice
    : status !== "approved" ? approve : undefined);

  return (
    <div className="pb-doc-modal" onClick={onClose}>
      <div className="pb-doc-box" onClick={(e) => e.stopPropagation()}>
        <header className="pb-doc-head">
          <div>
            <b>{rowName || "청구 건"}</b>
            <span>{DOC_LABEL[kind]}{doc?.document_number ? ` · ${doc.document_number}` : ""}</span>
          </div>
          {kind !== "issue" && <span className={`pb-doc-st pb-doc-st-${status}`}>{STATUS_LABEL[status] || status}</span>}
          <button type="button" onClick={onClose} title="닫기">✕</button>
        </header>

        <div className="pb-doc-body">
          <dl className="pb-doc-facts">
            <div><dt>거래처</dt><dd>{partnerName || <em>미지정</em>}</dd></div>
            <div><dt>공급가</dt><dd className="pb-doc-num">{won(amount)}원</dd></div>
            <div><dt>부가세</dt><dd className="pb-doc-num">{won(vat)}원</dd></div>
            <div><dt>합계</dt><dd className="pb-doc-num pb-doc-total">{won(amount + vat)}원</dd></div>
          </dl>

          {kind === "contract" && (
            <section className="pb-doc-terms">
              <b>결제조건</b>
              <div className="pb-doc-modes">
                {([["full", "전액"], ["two", "선금·잔금"], ["three", "선금·중도금·잔금"]] as [PayMode, string][]).map(([m, label]) => (
                  <button key={m} type="button" onClick={() => setPayMode(m)} aria-pressed={payMode === m}
                    className={payMode === m ? "pb-doc-mode-on" : ""}>{label}</button>
                ))}
              </div>
              {payMode !== "full" && (
                <div className="pb-doc-ratios">
                  <label>선금 <input type="number" min={0} max={100} value={adv} onChange={(e) => setAdv(Number(e.target.value))} />%</label>
                  {payMode === "three" && (
                    <label>중도금 <input type="number" min={0} max={100} value={mid} onChange={(e) => setMid(Number(e.target.value))} />%</label>
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
              <p className="pb-doc-hint">저장하면 표 위에 <b>청구 행 만들기</b> 가 뜹니다 — 회차대로 줄이 생겨요.</p>
            </section>
          )}

          {kind === "issue" && (
            <section className="pb-doc-terms">
              <b>세금계산서 만들기</b>
              <div className="pb-doc-ratios">
                <label>발행일 <DateField value={issueDate} onChange={(e) => setIssueDate(e.target.value)} /></label>
              </div>
              <p className="pb-doc-hint">
                <b>발행 대기</b>로만 만듭니다. 국세청 실제 발행은 세금계산서 화면에서 확인하고 누르세요.
              </p>
            </section>
          )}
        </div>

        <footer className="pb-doc-foot">
          {doc?.id && (
            <Link href={`/documents?id=${doc.id}`} className="pb-doc-link">문서 편집기에서 열기 ↗</Link>
          )}
          {kind === "issue" && <Link href="/tax-invoices" className="pb-doc-link">세금계산서 화면 ↗</Link>}
          <span className="pb-doc-spacer" />
          {kind === "quote" && status !== "approved" && (
            <button type="button" className="pb-doc-go" disabled={busy} onClick={approve}>{busy ? "…" : "승인 처리"}</button>
          )}
          {kind === "contract" && (
            <button type="button" className="pb-doc-go" disabled={busy} onClick={saveTerms}>{busy ? "저장 중…" : "결제조건 저장"}</button>
          )}
          {kind === "issue" && (
            <button type="button" className="pb-doc-go" disabled={busy} onClick={makeInvoice}>{busy ? "만드는 중…" : "발행 대기로 만들기"}</button>
          )}
        </footer>
      </div>
    </div>
  );
}
