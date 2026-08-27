"use client";

// ── 부족분 채우기 — 발주 제안 (2026-08-26 사장님 지시 ③) ────────────────────────
//   재고 › 창고관리와 현황이 '부족'을 세어 주기만 했다. 여기서는 그 부족분을 **구매 입력 격자에 채워 준다.**
//   ★ 제안은 자동, 확정은 사람 — 수량은 사람이 고치고, 저장(매입 저장)도 사람이 누른다. 발주서를 자동으로 보내지 않는다.
//   ★ 기준 — 부족 = 안전재고 − 현재고(창고 합). 안전재고를 안 적은 품목은 제안하지 않는다(무엇이 부족인지 회사가 정한 값이 없다).
//     제안 수량 = 부족분(안전재고까지 채우는 최소). 더 사고 싶으면 칸에서 고친다.
//   ★ 단가 = 거래처별 단가 → 품목 매입가(fillFrom 이 채운다). 거래처는 격자 머리에서 고른다.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listProducts, listOnHand } from "@/lib/inventory";
import { fetchOutflowStats, fetchLastPurchase, soonShort } from "@/lib/inventory-suggest";
import { blankRow, docWon as won, type DocCtl } from "./doc-editor";

export function FillShortageButton({ ctl }: { ctl: DocCtl }) {
  const [open, setOpen] = useState(false);
  //   현황 › 바로 처리할 것 › 재고 부족 에서 오면 바로 열린다 (?fill=1)
  useEffect(() => {
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("fill") === "1") setOpen(true);
  }, []);
  return (
    <>
      <button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(true)}>부족분 채우기</button>
      {open && <FillDialog ctl={ctl} onClose={() => setOpen(false)} />}
    </>
  );
}

function FillDialog({ ctl, onClose }: { ctl: DocCtl; onClose: () => void }) {
  const companyId = ctl.companyId;
  const { data: products = [] } = useQuery({ queryKey: ["inv-products", companyId], queryFn: () => listProducts(companyId!), enabled: !!companyId });
  const { data: onhand = [], isLoading } = useQuery({ queryKey: ["inv-onhand", companyId], queryFn: () => listOnHand(companyId!), enabled: !!companyId });
  //   A2 곧 부족(30일 평균 일 출고 × 리드타임) · A1 지난 매입 거래처·단가 (2026-08-27 규칙형 자동화, 토큰 없음)
  const { data: outflow } = useQuery({ queryKey: ["inv-outflow", companyId], queryFn: () => fetchOutflowStats(companyId!), enabled: !!companyId, staleTime: 60_000 });
  const { data: lastBuy } = useQuery({ queryKey: ["inv-lastbuy", companyId], queryFn: () => fetchLastPurchase(companyId!), enabled: !!companyId, staleTime: 60_000 });
  const { data: partners = [] } = useQuery({ queryKey: ["inv-partners-min", companyId], queryFn: async () => { const { supabase } = await import("@/lib/supabase"); const { data } = await supabase.from("partners").select("id, name").eq("company_id", companyId!).limit(2000); return (data || []) as { id: string; name: string }[]; }, enabled: !!companyId, staleTime: 300_000 });
  const partnerNm = (id: string | null | undefined) => (id ? partners.find((x) => x.id === id)?.name || "" : "");
  const [qty, setQty] = useState<Record<string, string>>({});
  const [picked, setPicked] = useState<Record<string, boolean>>({});
  const [seeded, setSeeded] = useState(false);

  const rows = useMemo(() => {
    const have = new Map<string, number>();
    for (const o of onhand) have.set(o.product_id, (have.get(o.product_id) || 0) + Number(o.qty));
    const out: { p: typeof products[number]; have: number; safety: number; short: number; why: string; days?: number }[] = [];
    for (const p of products) {
      if (!p.track_stock || !p.is_active || p.auto_suggest === false) continue;
      const h = have.get(p.id) || 0;
      if (p.safety_stock != null && p.safety_stock > 0 && h < p.safety_stock) {
        out.push({ p, have: h, safety: p.safety_stock, short: p.safety_stock - h, why: "안전재고 아래" });
        continue;
      }
      //   안전재고가 없거나 아직 위여도, 출고 속도로 보면 리드타임 안에 바닥나는 것 (결정 90)
      const s = soonShort(h, outflow?.get(p.id), p.lead_time_days ?? 7);
      if (s) out.push({ p, have: h, safety: p.safety_stock ?? 0, short: s.need, why: `곧 부족 · ${s.days}일 뒤 0`, days: s.days });
    }
    return out.sort((a, b) => (a.days ?? -1) - (b.days ?? -1) || b.short - a.short);
  }, [products, onhand, outflow]);

  //   처음 한 번 — 전부 고른 상태, 수량은 부족분
  useEffect(() => {
    if (seeded || isLoading) return;
    setPicked(Object.fromEntries(rows.map((r) => [r.p.id, true])));
    setQty(Object.fromEntries(rows.map((r) => [r.p.id, String(r.short)])));
    setSeeded(true);
  }, [rows, seeded, isLoading]);

  const chosen = rows.filter((r) => picked[r.p.id] && Number(qty[r.p.id]) > 0);
  const already = new Set(ctl.rows.map((r) => r.product_id).filter(Boolean));

  const fill = () => {
    ctl.setRows((s) => {
      const keep = s.filter((r) => r.product_id || r.sku.trim());
      const add = chosen.filter((r) => !already.has(r.p.id)).map((r) => {
        const row = blankRow();
        row.qty = qty[r.p.id];
        ctl.fillFrom(row, r.p);
        //   지난 매입 단가가 있으면 그걸 우선(거래처별 단가·품목 매입가보다 최근 사실) — 출처: 장부 대조
        const lb = lastBuy?.get(r.p.id);
        if (lb?.unit_price != null && lb.unit_price > 0) { row.price = String(lb.unit_price); }
        row.lnote = r.days != null ? `곧 부족 — ${r.days}일 뒤 0 (현재 ${won(r.have)})` : `부족분 ${won(r.short)} (안전 ${won(r.safety)} · 현재 ${won(r.have)})`;
        return row;
      });
      return [...keep, ...add, blankRow()];
    });
    //   고른 품목의 지난 거래처가 하나로 모이면 머리 거래처도 채운다(비어 있을 때만) — 확정은 사람
    const pids = new Set(chosen.map((r) => lastBuy?.get(r.p.id)?.partner_id).filter(Boolean));
    if (pids.size === 1 && !ctl.head.partner_id) ctl.setHead((h) => ({ ...h, partner_id: [...pids][0] as string }));
    onClose();
    setTimeout(() => ctl.focusCell(0, ctl.cells[0]), 100);
  };

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">부족분 채우기 — 발주 제안</h3>
        <p className="inv-modal-desc">
          안전재고보다 적은 품목을 <b>부족분만큼</b> 구매 격자에 채웁니다. 수량은 여기서 고칠 수 있고, 저장은 격자에서 <b>매입 저장</b>을 눌러야 됩니다.
          안전재고가 없어도 <b>최근 30일 출고 속도</b>로 리드타임 안에 바닥나는 품목은 <b>곧 부족</b>으로 함께 올립니다(출처: 장부 대조). 거래처·단가는 지난 매입을 따릅니다. 자동 제안을 끈 품목은 빠집니다.
        </p>
        {isLoading ? <div className="inv-status-empty">불러오는 중…</div> : rows.length === 0 ? (
          <div className="inv-status-empty">부족한 품목이 없습니다 — 모두 안전재고 이상입니다.</div>
        ) : (
          <div className="stg-table-wrap ch-ship-list">
            <table className="ev-table ev-lined table-inv-status-sm">
              <thead><tr>
                <th className="w-8"><input type="checkbox" checked={rows.every((r) => picked[r.p.id])}
                  onChange={(e) => setPicked(Object.fromEntries(rows.map((r) => [r.p.id, e.target.checked])))} aria-label="전부 선택" /></th>
                <th>SKU</th><th>품목</th><th>이유</th><th>안전재고</th><th>현재고</th><th>부족</th><th>발주 수량</th><th>지난 매입</th>
              </tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.p.id} className={already.has(r.p.id) ? "doc-row-dup" : undefined} title={already.has(r.p.id) ? "이미 격자에 있는 품목 — 다시 넣지 않습니다" : undefined}>
                  <td className="tc"><input type="checkbox" checked={!!picked[r.p.id]} onChange={(e) => setPicked((s) => ({ ...s, [r.p.id]: e.target.checked }))} /></td>
                  <td className="mono-number text-left">{r.p.sku}</td>
                  <td className="text-left"><b>{r.p.name}</b>{r.p.spec ? <span className="ev-dim"> {r.p.spec}</span> : null}</td>
                  <td className="tc"><span className={r.days != null ? "inv-pill inv-pill-warn" : "inv-pill inv-pill-danger"}>{r.why}</span></td>
                  <td className="tr mono-number">{r.safety ? won(r.safety) : "—"}</td>
                  <td className="tr mono-number">{won(r.have)}</td>
                  <td className="tr mono-number"><b>{won(r.short)}</b></td>
                  <td><input className="field-input doc-in" inputMode="numeric" value={qty[r.p.id] ?? ""} onChange={(e) => setQty((s) => ({ ...s, [r.p.id]: e.target.value }))} /></td>
                  <td className="text-left ev-dim">{(() => { const lb = lastBuy?.get(r.p.id); return lb ? <>{partnerNm(lb.partner_id) || "거래처 없음"} · {lb.unit_price != null ? `₩${won(lb.unit_price)}` : "—"} <span className="mono-number">{lb.doc_date}</span></> : (r.p.cost_price != null ? `매입가 ₩${won(r.p.cost_price)}` : "—"); })()}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="inv-modal-actions">
          <span className="fl-note">{chosen.length}품목 · {won(chosen.reduce((n, r) => n + Number(qty[r.p.id] || 0) * (r.p.cost_price || 0), 0))}원(매입가 기준)</span>
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!chosen.length} onClick={fill}>격자에 채우기</button>
        </div>
      </div>
    </div>
  );
}
