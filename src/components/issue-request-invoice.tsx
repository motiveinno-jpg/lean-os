"use client";

// 세금계산서 발행 요청서 — 공급자에게 보여 주는 '미리 채운 세금계산서'.
//   받는 쪽이 채운 공급받는자·품목·금액·발주번호·입금계좌·지급예정일·비고를 한 장에 보여 주고,
//   공급자가 넣을 칸(작성일자)은 아래 slot 으로 받는다.
//   종이 문서처럼 늘 밝게 그린다(오너뷰 안 팝업과 외부 링크 화면이 같은 모양 — 계산서 상세 팝업과 같은 원칙).
//   copyable 이면 칸마다 [복사] — 홈택스에 손으로 옮겨 적을 때 쓴다.

import { useState, type ReactNode } from "react";
import {
  TAX_KIND_LABEL, formatBizNo, requestRemark, type RequestItem, type RequestTaxKind, type RequestPurpose,
} from "@/lib/tax-invoice-request";

export type IssueRequestInvoiceData = {
  title?: string | null;
  po_number?: string | null;
  items?: RequestItem[] | null;
  supply_amount?: number | null;
  tax_amount?: number | null;
  total_amount?: number | null;
  tax_kind?: RequestTaxKind | null;
  purpose?: RequestPurpose | null;
  pay_bank_text?: string | null;
  pay_due_date?: string | null;
  memo?: string | null;
  buyer_name?: string | null;
  buyer_business_number?: string | null;
  buyer_representative?: string | null;
  buyer_address?: string | null;
  buyer_business_type?: string | null;
  buyer_business_item?: string | null;
  buyer_email?: string | null;
  supplier_name?: string | null;
  supplier_business_number?: string | null;
};

const won = (n: unknown) => Math.round(Number(n) || 0).toLocaleString("ko-KR");

function CopyBtn({ value }: { value: string }) {
  const [done, setDone] = useState(false);
  if (!value) return null;
  return (
    <button type="button" className="irv-copy"
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setDone(true); setTimeout(() => setDone(false), 1500); } catch { /* 클립보드 차단 */ }
      }}>
      {done ? "복사됨" : "복사"}
    </button>
  );
}

function Field({ label, value, copy, mono }: { label: string; value: string | null | undefined; copy?: boolean; mono?: boolean }) {
  const v = String(value ?? "").trim();
  return (
    <div className="irv-field">
      <span className="irv-field-label">{label}</span>
      <span className={mono ? "irv-field-value irv-mono" : "irv-field-value"}>{v || "—"}</span>
      {copy && <CopyBtn value={v} />}
    </div>
  );
}

export function IssueRequestInvoice({ data, copyable = false, slot }: {
  data: IssueRequestInvoiceData;
  copyable?: boolean;
  /** 공급자가 넣을 칸(작성일자 등) — 표 아래에 붙는다 */
  slot?: ReactNode;
}) {
  const items = (data.items || []).filter((it) => String(it?.name || "").trim());
  const remark = requestRemark(data.po_number, data.memo);
  const bizNo = formatBizNo(data.buyer_business_number);
  return (
    <div className="irv-paper">
      <div className="irv-head">
        <div>
          <div className="irv-kicker">세금계산서 발행 요청</div>
          <div className="irv-title">{data.title || (items[0]?.name ?? "세금계산서")}</div>
        </div>
        <div className="irv-total">
          <span>대금지급액 (세금 포함)</span>
          <b className="irv-mono">{won(data.total_amount)}원</b>
        </div>
      </div>

      <div className="irv-parties">
        <section className="irv-party">
          <div className="irv-party-title">공급받는자 <em>요청한 회사</em></div>
          <Field label="법인명" value={data.buyer_name} copy={copyable} />
          <Field label="등록번호" value={bizNo} copy={copyable} mono />
          <Field label="대표자" value={data.buyer_representative} copy={copyable} />
          <Field label="주소" value={data.buyer_address} copy={copyable} />
          <Field label="업태" value={data.buyer_business_type} copy={copyable} />
          <Field label="종목" value={data.buyer_business_item} copy={copyable} />
          <Field label="담당자 이메일" value={data.buyer_email} copy={copyable} />
        </section>
        <section className="irv-party">
          <div className="irv-party-title">공급자 <em>발행하는 회사</em></div>
          <Field label="상호" value={data.supplier_name} />
          <Field label="등록번호" value={formatBizNo(data.supplier_business_number)} mono />
          <div className="irv-sum">
            <Field label="공급가액" value={`${won(data.supply_amount)}원`} copy={copyable} mono />
            <Field label="세액" value={`${won(data.tax_amount)}원`} copy={copyable} mono />
            <Field label="세금유형" value={TAX_KIND_LABEL[(data.tax_kind || "taxable") as RequestTaxKind]} />
            <Field label="영수/청구" value={data.purpose || "청구"} />
          </div>
        </section>
      </div>

      <div className="irv-table-wrap">
        <table className="irv-table">
          <thead>
            <tr>
              <th>발주번호</th><th>품목</th><th>규격</th><th>단가</th><th>수량</th><th>공급가액</th><th>세액</th><th>지급금액</th>
              {copyable && <th />}
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? (
              <tr><td colSpan={copyable ? 9 : 8} className="irv-empty">품목이 없습니다</td></tr>
            ) : items.map((it, i) => (
              <tr key={i}>
                <td className="irv-c">{data.po_number || "—"}</td>
                <td>{it.name}</td>
                <td className="irv-c">{it.spec || ""}</td>
                <td className="irv-r irv-mono">{won(it.unit_price)}</td>
                <td className="irv-r irv-mono">{Number(it.qty || 0).toLocaleString("ko-KR")}</td>
                <td className="irv-r irv-mono">{won(it.supply_amount)}</td>
                <td className="irv-r irv-mono">{won(it.tax_amount)}</td>
                <td className="irv-r irv-mono">{won(Number(it.supply_amount || 0) + Number(it.tax_amount || 0))}</td>
                {copyable && (
                  <td className="irv-c">
                    <CopyBtn value={[it.name, it.spec || "", it.unit_price, it.qty, it.supply_amount, it.tax_amount].join("\t")} />
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={5} className="irv-c">합계</td>
              <td className="irv-r irv-mono">{won(data.supply_amount)}</td>
              <td className="irv-r irv-mono">{won(data.tax_amount)}</td>
              <td className="irv-r irv-mono irv-strong">{won(data.total_amount)}</td>
              {copyable && <td className="irv-c"><CopyBtn value={String(Math.round(Number(data.total_amount) || 0))} /></td>}
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="irv-foot">
        <Field label="입금계좌" value={data.pay_bank_text} />
        <Field label="입금예정일" value={data.pay_due_date} />
        <Field label="비고" value={remark} copy={copyable} />
      </div>

      {slot && <div className="irv-slot">{slot}</div>}
    </div>
  );
}
