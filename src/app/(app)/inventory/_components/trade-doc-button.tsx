"use client";

// 판매 팝업의 「거래명세서 PDF」 · 구매 팝업의 「발주서 PDF」 (2026-09-22 ERP 공백 2차 ③)
//   주문서의 「PDF 내려받기」와 같은 자리(popupExtra)·같은 방식 — 지금 화면의 값(ctl.build())으로 만든다.
//   저장 전이면 문서번호 자리에 (저장 전) 이 찍힌다.

import { useState } from "react";
import type { DocCtl } from "./doc-editor";
import type { Product, Warehouse } from "@/lib/inventory";
import { buildTradeStatementPdf, buildPurchaseOrderPdf, downloadBlob, type TradeLine } from "@/lib/trade-docs-pdf";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";

export function TradeDocButton({ ctl, products, warehouses, kind }: { ctl: DocCtl; products: Product[]; warehouses?: Warehouse[]; kind: "statement" | "purchase_order" }) {
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const label = kind === "statement" ? "거래명세서 PDF" : "발주서 PDF";
  const run = async () => {
    if (busy) return;
    const b = ctl.build();
    if (!b.lines.length) { toast("품목 줄이 없습니다", "error"); return; }
    const byId = new Map(products.map((p) => [p.id, p]));
    const lines: TradeLine[] = b.lines.filter((l) => l.product_id).map((l) => { const p = byId.get(l.product_id); return {
      name: p?.name || "", spec: p?.spec || "", unit: p?.unit || "", qty: l.qty, unitPrice: l.unit_price ?? 0, supply: l.supply_amount, vat: l.vat_amount, note: l.note }; });
    const input = {
      companyId: ctl.companyId!, docNo: ctl.editing?.order_no || null, date: b.date,
      partnerId: b.head.partner_id || null, partnerName: b.head.partner || null,
      warehouseName: warehouses?.find((w) => w.id === b.head.wh)?.name || null,
      dueDate: b.head.due || null, note: b.head.note || null, lines,
    };
    setBusy(true);
    try {
      const blob = kind === "statement" ? await buildTradeStatementPdf(input) : await buildPurchaseOrderPdf(input);
      downloadBlob(blob, `${kind === "statement" ? "거래명세서" : "발주서"}_${input.docNo || "저장전"}_${b.date}.pdf`);
    } catch (e) { toast(friendlyError(e, "PDF 를 만들지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };
  return <button type="button" className="btn-secondary btn-sm" onClick={() => void run()} disabled={busy} title="지금 화면의 값으로 만듭니다 · 회사 정보는 회사 설정, 거래처 정보는 거래처에서">{busy ? "만드는 중…" : label}</button>;
}
