"use client";

// ── 재고 › 구매 (2026-08-25 사장님 지시로 격자 입력으로 바꿈) ──────────────────
//   들어오면 **입력이 먼저**. 이력에서 줄을 누르면 치던 그 화면이 팝업으로 떠서 고친다.
//   ★ 여기서 저장하면 **재고가 바로 는다.** 주문서(약속)와 다른 점이 그것이다.

import { DocScreen, type HistRow } from "../_components/doc-screen";
import { PullOrderButton } from "../_components/pull-order";
import {
  createStockDoc, updateStockDoc, getStockDoc, deleteStockDoc, listStockDocs, listProducts, listWarehouses,
} from "@/lib/inventory";
import { listOrders } from "@/lib/inventory-orders";

export default function PurchasePage() {
  return (
    <DocScreen
      formKey="buy"
      perm="/inventory/purchase"
      pull={(ctl) => <PullOrderButton ctl={ctl} />}
      saveActions={[{ key: "save", label: "매입 저장", primary: true, hint: "재고가 바로 늡니다" }]}
      headNote={<span className="inv-hint doc-note-move">저장하면 <b>재고가 바로 늡니다</b>.</span>}
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
          return `${r.docNo} 을 고쳐 저장했습니다 — 재고가 이 숫자로 다시 섰습니다`;
        }
        const r = await createStockDoc(ctl.companyId!, input, ctl.userId);
        return r.skipped > 0
          ? `${r.docNo} 로 기록했습니다 · 수량을 세지 않는 ${r.skipped}줄은 뺐습니다`
          : `${r.docNo} 로 기록했습니다`;
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
          state: "재고 반영됨", stateTone: "ok",
        }));
      }}
      onOpen={async ({ id, ctl }) => {
        const { doc, moves } = await getStockDoc(id);
        ctl.loadDoc(
          {
            id: doc.id, order_no: doc.doc_no, order_date: doc.doc_date, due_date: null,
            partner_id: doc.partner_id, partner_name: null, warehouse_id: doc.warehouse_id,
            status: "open", note: doc.note, custom: {}, created_at: "",
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
      onDelete={async ({ id }) => { await deleteStockDoc(id); }}
    />
  );
}
