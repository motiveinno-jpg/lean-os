"use client";

// ── 불량 처분 도우미 (결정 30·31 Phase 4, 2026-08-26) ────────────────────────────────
//   불량 보류 창고에 있는 재고를 품목별로 보여 주고, 사람이 처분을 고른다 — 자동으로 못 푸는 일(기획 ④).
//   · 폐기: 불량 보류 창고에서 disposal 문서 → 주기 전표 초안이 재고자산감모손실로 집는다(결정 33).
//   · 양품 전환(재작업 완료): 불량 보류 → 고른 창고로 창고 이동(move) — 재고 총량은 그대로, 팔 수 있는 재고가 는다.
//   · B급 판매: 판매 입력에서 창고를 '불량 보류'로 두고 판다 — 여기서는 안내만(판매 화면이 그 일을 안다).
//   원가는 그대로 따라간다(이동평균). 취소는 각 문서에서(기존 규칙).

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { listOnHand, listWarehouses, listAvgCost, createStockDoc, DEFECT_WAREHOUSE_CODE, type Product } from "@/lib/inventory";
import { todayKst } from "@/lib/kst";
import { docWon as won } from "./doc-editor";

const num = (v: string) => { const n = Number(String(v).replace(/[,\s]/g, "")); return Number.isNaN(n) ? 0 : n; };

export function DefectDisposeDialog({ companyId, userId, products, onClose }: { companyId: string; userId: string | null; products: Product[]; onClose: () => void }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: warehouses = [] } = useQuery({ queryKey: ["inv-warehouses", companyId], queryFn: () => listWarehouses(companyId) });
  const { data: onhand = [], refetch } = useQuery({ queryKey: ["inv-onhand", companyId], queryFn: () => listOnHand(companyId) });
  const { data: avgCost = new Map<string, number>() } = useQuery({ queryKey: ["inv-avg-cost", companyId], queryFn: () => listAvgCost(companyId) });
  const defectWh = warehouses.find((w) => w.code === DEFECT_WAREHOUSE_CODE) || null;
  const mainWh = warehouses.find((w) => w.is_default) || warehouses.find((w) => w.code !== DEFECT_WAREHOUSE_CODE) || null;
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const rows = useMemo(() => defectWh ? onhand.filter((o) => o.warehouse_id === defectWh.id && Number(o.qty) > 0).map((o) => ({
    product: byId.get(o.product_id), product_id: o.product_id, qty: Number(o.qty), cost: avgCost.get(o.product_id) ?? Number(byId.get(o.product_id)?.cost_price || 0),
  })).sort((a, b) => b.qty * b.cost - a.qty * a.cost) : [], [onhand, defectWh, byId, avgCost]);
  const [edit, setEdit] = useState<Record<string, { qty: string; action: "scrap" | "rework"; to: string }>>({});
  const [busy, setBusy] = useState(false);
  const e = (pid: string, max: number) => edit[pid] || { qty: String(max), action: "scrap" as const, to: mainWh?.id || "" };
  const set = (pid: string, max: number, v: Partial<{ qty: string; action: "scrap" | "rework"; to: string }>) => setEdit((s) => ({ ...s, [pid]: { ...e(pid, max), ...v } }));

  const run = async (pid: string, max: number) => {
    if (!defectWh) return;
    const v = e(pid, max); const q = num(v.qty);
    if (!(q > 0) || q > max) { toast(`수량은 1 ~ ${won(max)} 사이여야 합니다`, "error"); return; }
    setBusy(true);
    try {
      const name = byId.get(pid)?.name || "";
      if (v.action === "scrap") {
        const r = await createStockDoc(companyId, { reason: "disposal", docDate: todayKst(), warehouseId: defectWh.id, note: "불량 폐기", lines: [{ product_id: pid, qty: q, note: "불량 폐기" }] }, userId);
        toast(`${name} ${won(q)}개 폐기 — ${r.docNo}. 손실은 다음 생산 전표 초안에 재고자산감모손실로 잡힙니다`, "success");
      } else {
        if (!v.to) { toast("옮길 창고를 고르세요", "error"); setBusy(false); return; }
        const r = await createStockDoc(companyId, { reason: "move", docDate: todayKst(), warehouseId: defectWh.id, toWarehouseId: v.to, note: "재작업 완료 · 양품 전환", lines: [{ product_id: pid, qty: q, note: "재작업 완료" }] }, userId);
        toast(`${name} ${won(q)}개를 양품으로 옮겼습니다 — ${r.docNo}`, "success");
      }
      setEdit((s) => { const n = { ...s }; delete n[pid]; return n; });
      await refetch(); qc.invalidateQueries({ queryKey: ["inv-moves"] });
    } catch (err) { toast(friendlyError(err), "error"); } finally { setBusy(false); }
  };

  const total = rows.reduce((n, r) => n + r.qty * r.cost, 0);
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">불량 처분</h3>
        <p className="inv-modal-desc">불량 보류 창고의 재고입니다 — <b>{rows.length}종 · ₩{won(Math.round(total))}</b>(이동평균). 처분은 사람이 고릅니다: <b>폐기</b>(손실은 생산 전표 초안이 잡음) · <b>양품 전환</b>(재작업이 끝난 것을 창고 이동) · <b>B급 판매</b>는 <Link href="/inventory/sales" className="bz-link">판매 입력</Link>에서 창고를 &apos;불량 보류&apos;로 두고 팝니다.</p>
        {!defectWh || rows.length === 0 ? <div className="inv-status-empty">불량 보류 재고가 없습니다</div> : (
          <div className="stg-table-wrap ch-ship-list">
            <table className="ev-table ev-lined table-inv-status-sm">
              <thead><tr><th>품목</th><th>불량 보류</th><th>금액</th><th>처분 수량</th><th>처분</th><th>옮길 창고</th><th></th></tr></thead>
              <tbody>{rows.map((r) => { const v = e(r.product_id, r.qty); return (
                <tr key={r.product_id}>
                  <td className="text-left"><b>{r.product?.name || "?"}</b> <span className="ev-dim">{r.product?.sku}</span></td>
                  <td className="tr mono-number">{won(r.qty)}</td><td className="tr mono-number">₩{won(Math.round(r.qty * r.cost))}</td>
                  <td className="num"><input className="doc-in inv-count-input" inputMode="numeric" value={v.qty} onChange={(x) => set(r.product_id, r.qty, { qty: x.target.value })} /></td>
                  <td className="tc"><select className="field-input inv-loss-reason" value={v.action} onChange={(x) => set(r.product_id, r.qty, { action: x.target.value as "scrap" | "rework" })}><option value="scrap">폐기</option><option value="rework">양품 전환</option></select></td>
                  <td className="tc">{v.action === "rework" ? (
                    <select className="field-input inv-loss-reason" value={v.to} onChange={(x) => set(r.product_id, r.qty, { to: x.target.value })}>
                      <option value="">창고</option>{warehouses.filter((w) => w.id !== defectWh.id && w.is_active !== false).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>) : <span className="ev-dim">—</span>}</td>
                  <td className="tc"><button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => run(r.product_id, r.qty)}>{v.action === "scrap" ? "폐기" : "옮기기"}</button></td>
                </tr>
              ); })}</tbody>
            </table>
          </div>
        )}
        <div className="inv-modal-actions">
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}
