"use client";

// ── 재고 › 생산 (2026-08-25 사장님 지시로 격자 입력으로 바꿈) ──────────────────
//   ★ 격자에 치는 것은 **만들 완제품**뿐이다. 자재는 자재구성(BOM)이 정하므로 사람이 칠 것이 없다.
//   ★ 저장하면 **자재가 빠지고 완제품이 는다** — 두 문서가 같이 선다(결정 14).
//   ★ 작업지시를 따로 두지 않는다 — **주문서가 그 자리**다(사장님 지시대로 주문서를 불러와 바로 저장).

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { DocScreen, type HistRow } from "../_components/doc-screen";
import { PullOrderButton } from "../_components/pull-order";
import {
  updateStockDoc, getStockDoc, deleteStockDoc, listStockDocs, listProducts, listWarehouses,
} from "@/lib/inventory";
import { listBoms } from "@/lib/inventory-production";
import { produceLines } from "@/lib/inventory-production";
import { listOrders } from "@/lib/inventory-orders";
import { BomPanel } from "../_components/bom-panel";

export default function ProductionPage() {
  const [bomOpen, setBomOpen] = useState(false);
  const qc = useQueryClient();

  return (
    <>
      <DocScreen
        formKey="make"
        perm="/inventory/production"
        pull={(ctl) => (
          <>
            <PullOrderButton ctl={ctl} />
            <button type="button" className="btn-secondary btn-sm" onClick={() => setBomOpen(true)}>자재구성</button>
          </>
        )}
        saveActions={[{ key: "save", label: "완성 기록", primary: true, hint: "자재가 빠지고 완제품이 늡니다" }]}
        headNote={
          <span className="inv-hint doc-note-move">
            저장하면 <b>자재가 빠지고 완제품이 늡니다</b> — 자재는 <b>자재구성</b>이 정합니다.
          </span>
        }
        onSave={async ({ built, ctl, editingId }) => {
          const wh = built.head.wh;
          if (!wh) throw new Error("창고를 고르세요");
          if (editingId) {
            //   완제품 문서만 고친다 — 자재 문서는 그 짝이라 같이 고쳐야 하는데,
            //   그건 지금 범위 밖이다. 그래서 자재가 붙은 전표는 고치지 못하게 막는다.
            const r = await updateStockDoc(ctl.companyId!, editingId, {
              reason: "produce", docDate: built.date, warehouseId: wh, note: built.head.note || null,
              lines: built.lines.map((l) => ({
                product_id: l.product_id, qty: l.qty, unit_price: l.unit_price,
                vat_amount: l.vat_amount, note: l.note, order_line_id: l.srcLineId,
              })),
            }, ctl.userId);
            return `${r.docNo} 을 고쳐 저장했습니다`;
          }
          const boms = await listBoms(ctl.companyId!);
          const r = await produceLines(ctl.companyId!, {
            docDate: built.date, warehouseId: wh, note: built.head.note || null,
            lines: built.lines.map((l) => ({
              product_id: l.product_id, qty: l.qty, unit_price: l.unit_price,
              vat_amount: l.vat_amount, note: l.note, order_line_id: l.srcLineId,
            })),
          }, boms, ctl.userId);
          qc.invalidateQueries({ queryKey: ["inv-onhand", ctl.companyId] });
          return r.matDocNo
            ? `${r.prodDocNo} · 자재 ${r.matDocNo} 로 기록했습니다`
            : `${r.prodDocNo} 로 기록했습니다 (자재구성이 없어 자재는 안 뺐습니다)`;
        }}
        history={async ({ companyId, from, to }) => {
          const [docs, prods, orders] = await Promise.all([
            listStockDocs(companyId, ["produce"], from, to),
            listProducts(companyId),
            listOrders(companyId, "1900-01-01", "2999-12-31"),
          ]);
          const orderNo = new Map(orders.map((o) => [o.id, o.order_no]));
          return docs.map((d): HistRow => ({
            id: d.id, no: d.doc_no, date: d.doc_date,
            who: d.note || "",
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
              partner_id: null, partner_name: null, warehouse_id: doc.warehouse_id,
              status: "open", note: doc.note, custom: {}, created_at: "",
            },
            moves.map((m: any, i: number) => ({
              id: m.id, order_id: id, product_id: m.product_id, qty: Math.abs(m.qty),
              unit_price: m.unit_price,
              supply_amount: Math.abs(Number(m.unit_price || 0) * m.qty),
              vat_amount: Math.abs(Number(m.vat_amount || 0)),
              note: m.note, custom: {}, sort_no: i,
            })),
          );
        }}
        onDelete={async ({ id }) => { await deleteStockDoc(id); }}
      />
      {bomOpen && <BomPanel onClose={() => setBomOpen(false)} />}
    </>
  );
}
