"use client";

// ── 재고 › 주문서 (2026-08-25 사장님 지시) ─────────────────────────────────────
//   ★ 주문(견적)을 판매와 **다른 메뉴**로 갈랐다. 차례는 주문 · 판매 · 구매 · 생산.
//   ★ **여기서 친 것은 재고수량에 반영되지 않는다**(사장님 지시). 종이일 뿐이다.
//     재고는 이 주문서를 **판매·구매·생산에서 불러와 저장할 때** 움직인다.

import { useQueryClient } from "@tanstack/react-query";
import { DocScreen, type HistRow } from "../_components/doc-screen";
import {
  listOrders, listOrderLines, listUsed, saveOrder, deleteOrder,
} from "@/lib/inventory-orders";
import { listProducts } from "@/lib/inventory";

export default function OrdersPage() {
  const qc = useQueryClient();

  return (
    <DocScreen
      formKey="order"
      perm="/inventory/orders"
      saveActions={[{ key: "save", label: "주문서 저장", primary: true, hint: "재고는 움직이지 않습니다" }]}
      headNote={
        <span className="inv-hint doc-note-safe">
          여기서 친 것은 <b>재고에 반영되지 않습니다</b> — 판매·구매·생산에서 불러와 저장할 때 움직입니다.
        </span>
      }
      onSave={async ({ built, ctl, editingId }) => {
        const r = await saveOrder(ctl.companyId!, {
          orderDate: built.date,
          dueDate: built.head.due || null,
          partnerId: built.head.partner_id || null,
          partnerName: built.head.partner || null,
          warehouseId: built.head.wh || null,
          note: built.head.note || null,
          custom: built.head.custom,
          lines: built.lines.map((l) => ({
            product_id: l.product_id, qty: l.qty, unit_price: l.unit_price,
            supply_amount: l.supply_amount, vat_amount: l.vat_amount,
            note: l.note, custom: l.custom,
          })),
        }, ctl.userId, editingId);
        qc.invalidateQueries({ queryKey: ["orders-list", ctl.companyId] });
        return editingId ? `${r.orderNo} 을 고쳐 저장했습니다` : `${r.orderNo} 로 주문서를 만들었습니다`;
      }}
      history={async ({ companyId, from, to }) => {
        const [orders, prods] = await Promise.all([listOrders(companyId, from, to), listProducts(companyId)]);
        if (!orders.length) return [];
        const used = await listUsed(companyId, orders.map((o) => o.id));
        const byOrder = new Map<string, { ordered: number; used: number }>();
        for (const u of used) {
          const c = byOrder.get(u.order_id) || { ordered: 0, used: 0 };
          byOrder.set(u.order_id, { ordered: c.ordered + u.ordered_qty, used: c.used + u.used_qty });
        }
        //   줄 이름은 목록에서 한 눈에 보이라고 첫 품목만 + 외 N
        const lines = await Promise.all(orders.map((o) => listOrderLines(o.id)));
        const nameOf = new Map(prods.map((p) => [p.id, p.name]));
        return orders.map((o, i): HistRow => {
          const ls = lines[i];
          const first = ls[0] ? nameOf.get(ls[0].product_id) || "?" : "—";
          const u = byOrder.get(o.id);
          const rate = u && u.ordered > 0 ? Math.round((u.used / u.ordered) * 100) : 0;
          return {
            id: o.id, no: o.order_no, date: o.order_date,
            who: o.partner_name || "", label: first + (ls.length > 1 ? ` 외 ${ls.length - 1}` : ""),
            lines: ls.length,
            total: ls.reduce((n, l) => n + l.supply_amount + l.vat_amount, 0),
            state: o.status === "cancelled" ? "접음" : rate >= 100 ? "다 씀" : rate > 0 ? `${rate}% 씀` : "안 씀",
            stateTone: o.status === "cancelled" ? "danger" : rate >= 100 ? "ok" : "warn",
          };
        });
      }}
      onOpen={async ({ id, ctl }) => {
        const [orders, ls] = await Promise.all([
          listOrders(ctl.companyId!, "1900-01-01", "2999-12-31"),
          listOrderLines(id),
        ]);
        const o = orders.find((x) => x.id === id);
        if (!o) throw new Error("주문서를 찾을 수 없습니다");
        ctl.loadDoc(o, ls);
      }}
      onDelete={async ({ id, ctl }) => { await deleteOrder(ctl.companyId!, id); }}
    />
  );
}
