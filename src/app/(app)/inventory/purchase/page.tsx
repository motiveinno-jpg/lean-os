"use client";

// ── 재고 › 구매 (2026-08-25 사장님 지시로 격자 입력으로 바꿈) ──────────────────
//   들어오면 **입력이 먼저**. 이력에서 줄을 누르면 치던 그 화면이 팝업으로 떠서 고친다.
//   ★ 여기서 저장하면 **재고가 바로 는다.** 주문서(약속)와 다른 점이 그것이다.

import { DocScreen, type HistRow } from "../_components/doc-screen";
import { PullOrderButton } from "../_components/pull-order";
import { FillShortageButton } from "../_components/fill-shortage";
import {
  createStockDoc, updateStockDoc, getStockDoc, listStockDocs, listProducts, listWarehouses, returnStockDoc, cancelStockDoc, rememberPartnerPrices,
} from "@/lib/inventory";
import { listOrders } from "@/lib/inventory-orders";

export default function PurchasePage() {
  return (
    <DocScreen
      formKey="buy"
      perm="/inventory/purchase"
      pull={(ctl) => <><PullOrderButton ctl={ctl} /><FillShortageButton ctl={ctl} /></>}
      saveActions={[{ key: "save", label: "매입 저장", primary: true, hint: "재고가 즉시 증가합니다" }]}
      headNote={<span className="inv-hint doc-note-move">저장하면 <b>재고가 즉시 증가합니다</b>.</span>}
      onImport={async ({ docs, ctl }) => {
        const nos: string[] = [];
        for (const d of docs) {
          const r = await createStockDoc(ctl.companyId!, { reason: "purchase", docDate: d.date, warehouseId: d.warehouseId, partnerId: d.partnerId,
            note: [d.note, d.partnerName && !d.partnerId ? `거래처: ${d.partnerName}` : ""].filter(Boolean).join(" · ") || null,
            lines: d.lines.map((l) => ({ product_id: l.product_id, qty: l.qty, unit_price: l.unit_price, note: l.note })) }, ctl.userId);
          nos.push(r.docNo);
        }
        return `${nos.length}건 기록했습니다 — ${nos.slice(0, 5).join(", ")}${nos.length > 5 ? " …" : ""}`;
      }}
      onSave={async ({ built, ctl, editingId }) => {
        const wh = built.head.wh;
        if (!wh) throw new Error("받을 창고를 고르세요");
        const input = {
          reason: "purchase" as const, docDate: built.date, warehouseId: wh,
          partnerId: built.head.partner_id || null,
          note: [built.head.note, built.head.partner && !built.head.partner_id ? `거래처: ${built.head.partner}` : ""]
            .filter(Boolean).join(" · ") || null,
          lines: built.lines.map((l) => ({
            product_id: l.product_id, qty: l.qty, unit_price: l.unit_price,
            vat_amount: l.vat_amount, note: l.note, order_line_id: l.srcLineId,
          })),
        };
        if (editingId) {
          const r = await updateStockDoc(ctl.companyId!, editingId, input, ctl.userId);
          return `${r.docNo} 을 수정했습니다 — 재고가 수정한 수량으로 반영됩니다`;
        }
        const r = await createStockDoc(ctl.companyId!, input, ctl.userId);
        //   거래처별 단가가 저절로 남는다(결정 26) — 실패해도 저장은 된 것이라 조용히 넘긴다
        rememberPartnerPrices(ctl.companyId!, built.head.partner_id, "buy", built.lines, r.id).catch(() => {});
        return (r.skipped > 0
          ? `${r.docNo} 로 기록했습니다 · 수량 관리 대상이 아닌 ${r.skipped}줄은 제외했습니다`
          : `${r.docNo} 로 기록했습니다`)
          + " · 전표는 매입매출전표 › 증빙에서 불러오기로 만듭니다";
      }}
      history={async ({ companyId, from, to }) => {
        const [docs, prods, whs, orders] = await Promise.all([
          listStockDocs(companyId, ["purchase"], from, to),
          listProducts(companyId), listWarehouses(companyId),
          listOrders(companyId, "1900-01-01", "2999-12-31"),
        ]);
        const orderNo = new Map(orders.map((o) => [o.id, o.order_no]));
        return docs.map((d): HistRow => ({
          id: d.id, no: d.doc_no, date: d.doc_date,
          who: d.note || whs.find((w) => w.id === d.warehouse_id)?.name || "",
          label: (d.order_id ? `${orderNo.get(d.order_id) || "주문"} 에서 · ` : "") + `${d.lines}품목`,
          lines: d.lines, total: d.supply + d.vat,
          //   전표가 섰는지 — 매입매출전표 › 증빙에서 불러오기로 만든다(제안은 자동, 확정은 사람)
          state: d.status === "cancelled" ? `취소${d.cancel_reason ? " · " + d.cancel_reason : ""}` : d.journal_entry_id ? "전표 있음" : "전표 없음",
          stateTone: d.status === "cancelled" ? "danger" : d.journal_entry_id ? "ok" : "warn",
        }));
      }}
      onOpen={async ({ id, ctl }) => {
        const { doc, moves } = await getStockDoc(id);
        ctl.loadDoc(
          {
            id: doc.id, order_no: doc.doc_no, order_date: doc.doc_date, due_date: null,
            partner_id: doc.partner_id, partner_name: null, warehouse_id: doc.warehouse_id,
            status: doc.status === "cancelled" ? "cancelled" : "open", note: doc.note, custom: {}, created_at: "",
          },
          moves.map((m: any, i: number) => ({
            id: m.id, order_id: id, product_id: m.product_id,
            qty: Math.abs(m.qty),                     // 들어온 것을 양수로 되읽는다
            unit_price: m.unit_price,
            supply_amount: Math.abs(Number(m.unit_price || 0) * m.qty),
            vat_amount: Math.abs(Number(m.vat_amount || 0)),
            note: m.note, custom: {}, sort_no: i,
          })),
        );
      }}
      onCancel={async ({ id, ctl, reason }) => { await cancelStockDoc(id, reason, ctl.userId); }}
      onReturn={async ({ id, ctl }) => { const r = await returnStockDoc(ctl.companyId!, id, ctl.userId); return `${r.docNo} 로 반품 처리했습니다 — 재고가 되돌아갔습니다`; }}
    />
  );
}
