"use client";

// ── 주문서에서 줄 불러오기 (2026-08-25 사장님 지시) ────────────────────────────
//   판매·구매·생산이 **같은 주문서**를 불러간다. 하나의 주문이 세 갈래로 퍼질 수 있다 —
//   "간판 5개 주문받음" 이 판매(출고)로도, 구매(자재 발주)로도, 생산(작업지시)으로도 간다.
//   ★ 남은 수량만 가져온다(주문 − 이미 가져간 것). 두 번 가져가 재고가 두 번 움직이는 것을 막는다.

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { listProducts } from "@/lib/inventory";
import { listOrders, listOrderLines, listUsed } from "@/lib/inventory-orders";
import { docWon as won, type DocCtl } from "./doc-editor";

export function PullOrderButton({ ctl }: { ctl: DocCtl }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(true)}>주문서 불러오기</button>
      {open && <PullDialog ctl={ctl} onClose={() => setOpen(false)} />}
    </>
  );
}

function PullDialog({ ctl, onClose }: { ctl: DocCtl; onClose: () => void }) {
  const { toast } = useToast();
  const companyId = ctl.companyId;
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [seeded, setSeeded] = useState(false);

  const { data: products = [] } = useQuery({ queryKey: ["inv-products", companyId], queryFn: () => listProducts(companyId!), enabled: !!companyId });
  const { data, isLoading } = useQuery({
    queryKey: ["pull-orders", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const orders = (await listOrders(companyId!, "1900-01-01", "2999-12-31"))
        .filter((o) => o.status !== "cancelled");
      if (!orders.length) return { orders: [], lines: {} as Record<string, any[]>, used: new Map<string, number>() };
      const [lineSets, used] = await Promise.all([
        Promise.all(orders.map((o) => listOrderLines(o.id))),
        listUsed(companyId!, orders.map((o) => o.id)),
      ]);
      const usedBy = new Map(used.map((u) => [u.order_line_id, u.used_qty]));
      const lines: Record<string, any[]> = {};
      orders.forEach((o, i) => { lines[o.id] = lineSets[i]; });
      return { orders, lines, used: usedBy };
    },
  });

  const nameOf = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);

  //   남은 것이 있는 주문만 보여 준다 — 다 쓴 주문을 늘어놓으면 고를 것을 못 찾는다
  const shown = useMemo(() => {
    if (!data) return [];
    return data.orders.map((o) => {
      const ls = (data.lines[o.id] || []).map((l: any) => {
        const gone = data.used.get(l.id) ?? 0;
        return { ...l, gone, rest: Math.max(l.qty - gone, 0) };
      }).filter((l: any) => l.rest > 0);
      return { o, ls };
    }).filter((x) => x.ls.length > 0);
  }, [data]);

  //   처음 열면 남은 줄을 다 켜 둔다 — 대개 다 가져간다
  if (!seeded && shown.length) {
    const init: Record<string, boolean> = {};
    shown.forEach((x) => x.ls.forEach((l: any) => { init[l.id] = true; }));
    setPicked(init); setSeeded(true);
  }

  const chosen = useMemo(() => {
    const out: { no: string; lineId: string; product_id: string; qty: number; price: number | null; lnote?: string }[] = [];
    shown.forEach((x) => x.ls.forEach((l: any) => {
      if (!picked[l.id]) return;
      out.push({
        no: x.o.order_no, lineId: l.id, product_id: l.product_id,
        qty: l.rest, price: l.unit_price, lnote: l.note || "",
      });
    }));
    return out;
  }, [shown, picked]);

  //   고른 줄이 **한 주문서에서만** 왔으면 그 머리(거래처·창고·납기)도 같이 가져온다.
  //   여러 주문서에서 골랐으면 어느 거래처를 넣을지 알 수 없어 넣지 않는다.
  const fromHead = useMemo(() => {
    const nos = [...new Set(chosen.map((c) => c.no))];
    if (nos.length !== 1) return undefined;
    const o = shown.find((x) => x.o.order_no === nos[0])?.o;
    if (!o) return undefined;
    return { partner: o.partner_name, partner_id: o.partner_id, wh: o.warehouse_id, due: o.due_date };
  }, [chosen, shown]);

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">주문서 불러오기</h3>
        <p className="inv-modal-desc">
          아직 처리되지 않은 주문서입니다. 가져올 항목을 선택하면 <b>남은 수량</b>이 입력되고,
          한 주문서에서만 골랐다면 <b>거래처·창고·납기일</b>도 함께 채워집니다.
        </p>

        <div className="inv-ship-table">
          {isLoading ? <p className="collect-empty">읽는 중…</p>
            : shown.length === 0 ? (
              <p className="collect-empty">가져올 주문서가 없습니다 — <b>재고 › 주문서</b>에서 먼저 등록하세요.</p>
            ) : shown.map((x) => (
              <div key={x.o.id} className="pull-order">
                <div className="pull-order-head">
                  <span className="doc-src">{x.o.order_no}</span>
                  <b>{x.o.order_date}</b> · {x.o.partner_name || "거래처 없음"}
                  {x.o.note ? <em>{x.o.note}</em> : null}
                </div>
                <table className="ev-table ev-lined">
                  <tbody>
                    {x.ls.map((l: any) => {
                      const p = nameOf.get(l.product_id);
                      return (
                        <tr key={l.id}>
                          <td className="tc doc-th-x">
                            <input type="checkbox" checked={!!picked[l.id]}
                              onChange={(e) => setPicked((s) => ({ ...s, [l.id]: e.target.checked }))} />
                          </td>
                          <td className="text-left"><b>{p?.name || "—"}</b> <span className="ev-dim">{p?.sku}</span></td>
                          <td className="tr mono-number ev-dim">주문 {won(l.qty)}</td>
                          <td className="tr mono-number ev-dim">처리 {won(l.gone)}</td>
                          <td className="tr mono-number"><b className="inv-diff-minus">남음 {won(l.rest)}</b></td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ))}
        </div>

        <div className="inv-modal-actions">
          <span className="inv-hint">선택한 항목 <b>{chosen.length}</b>개</span>
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!chosen.length}
            onClick={() => {
              try { ctl.pullLines(chosen, fromHead); onClose(); }
              catch (e) { toast(friendlyError(e), "error"); }
            }}>가져오기</button>
        </div>
      </div>
    </div>
  );
}
