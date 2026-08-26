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
  getStockDoc, listStockDocs, listProducts, listWarehouses,
} from "@/lib/inventory";
import { listBoms } from "@/lib/inventory-production";
import { produceLines, updateProduceDoc, cancelProduceDoc } from "@/lib/inventory-production";
import { listOrders } from "@/lib/inventory-orders";
import { BomNeedDialog, MaterialShortBadge } from "../_components/bom-editor";
import { materialShortages } from "@/lib/inventory-production";
import { listOnHand } from "@/lib/inventory";
import type { DocCtl } from "../_components/doc-editor";

export default function ProductionPage() {
  const [need, setNeed] = useState<{ ctl: DocCtl } | null>(null);
  const qc = useQueryClient();

  return (
    <>
      <DocScreen
        formKey="make"
        perm="/inventory/production"
        pull={(ctl) => (
          <>
            <PullOrderButton ctl={ctl} />
            {/*   ★ 자재구성 편집은 재고 › 품목으로 갔다(2026-08-26). 여기서는 친 품목의 자재 소요만 본다. */}
            <button type="button" className="btn-secondary btn-sm" onClick={() => setNeed({ ctl })}>자재 소요</button>
            {/*   ★ 자재가 모자라면 치는 동안 바로 보인다(2026-08-26 사장님: "부족하면 알려주는 장치") — 누르면 소요 팝업 */}
            <MaterialShortBadge ctl={ctl} onOpen={() => setNeed({ ctl })} />
          </>
        )}
        saveActions={[{ key: "save", label: "완성 기록", primary: true, hint: "자재가 차감되고 완제품이 증가합니다" }]}
        headNote={
          <span className="inv-hint doc-note-move">
            저장하면 <b>자재가 차감되고 완제품이 증가합니다</b> — 자재는 <b>자재구성</b>에 따릅니다.
          </span>
        }
        onSave={async ({ built, ctl, editingId }) => {
          const wh = built.head.wh;
          if (!wh) throw new Error("창고를 고르세요");
          if (editingId) {
            //   완제품과 자재 문서를 **같이** 고친다(3순위) — 자재구성 × 새 수량으로 자재를 다시 낸다
            const boms0 = await listBoms(ctl.companyId!);
            const r = await updateProduceDoc(ctl.companyId!, editingId, {
              docDate: built.date, warehouseId: wh, note: built.head.note || null,
              lines: built.lines.map((l) => ({
                product_id: l.product_id, qty: l.qty, unit_price: l.unit_price,
                vat_amount: l.vat_amount, note: l.note, order_line_id: l.srcLineId,
              })),
            }, boms0, ctl.userId);
            qc.invalidateQueries({ queryKey: ["inv-onhand", ctl.companyId] });
            return r.matDocNo ? `${r.prodDocNo} · 자재 ${r.matDocNo} 을 수정했습니다` : `${r.prodDocNo} 을 수정했습니다`;
          }
          const boms = await listBoms(ctl.companyId!);
          //   ★ 저장 직전 자재 부족 확인 — 제안은 자동, 확정은 사람. 모자라도 기록할 수는 있지만(실물이 먼저 들어온 경우) 알고 눌러야 한다.
          const onhand = await listOnHand(ctl.companyId!);
          const short = materialShortages(built.lines.map((l) => ({ product_id: l.product_id, qty: l.qty })), boms, onhand, wh);
          if (short.length) {
            const nameOf = new Map(ctl.products.map((p) => [p.id, p.name]));
            const msg = `자재가 부족합니다:\n${short.map((x) => `- ${nameOf.get(x.component_id) || "?"}: 소요 ${x.need} · 현재고 ${x.have} (부족 ${x.need - x.have})`).join("\n")}\n\n그래도 완성 기록할까요? 자재 재고가 음수가 됩니다.`;
            if (!window.confirm(msg)) throw new Error("자재 부족으로 완성 기록을 멈췄습니다 — 자재를 먼저 입고하거나 수량을 줄이세요");
          }
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
            : `${r.prodDocNo} 로 기록했습니다 (자재구성이 없어 자재는 차감하지 않았습니다)`;
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
            state: d.status === "cancelled" ? `취소${d.cancel_reason ? " · " + d.cancel_reason : ""}` : "재고 반영됨",
            stateTone: d.status === "cancelled" ? "danger" : "ok",
          }));
        }}
        onOpen={async ({ id, ctl }) => {
          const { doc, moves } = await getStockDoc(id);
          ctl.loadDoc(
            {
              id: doc.id, order_no: doc.doc_no, order_date: doc.doc_date, due_date: null,
              partner_id: null, partner_name: null, warehouse_id: doc.warehouse_id,
              status: doc.status === "cancelled" ? "cancelled" : "open", note: doc.note, custom: {}, created_at: "",
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
        onCancel={async ({ id, ctl, reason }) => { await cancelProduceDoc(id, reason, ctl.userId); }}
      />
      {need && need.ctl.companyId && (
        <BomNeedDialog companyId={need.ctl.companyId} warehouseId={need.ctl.head.wh || null}
          items={need.ctl.build().lines.map((l) => ({ product_id: l.product_id, qty: l.qty }))}
          products={need.ctl.products}
          onClose={() => setNeed(null)} />
      )}
    </>
  );
}
