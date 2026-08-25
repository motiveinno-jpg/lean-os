"use client";

// ── 재고 — 전표 입력기 (2026-08-25 사장님 지시) ────────────────────────────────
//   주문서·판매·구매·생산이 **이것 하나**를 같이 쓴다. 수정 화면도 이것이다(팝업에 그대로 담는다).
//   따로 만들면 칸·규칙이 둘로 갈라지고 한쪽에 칸을 더할 때 다른 쪽엔 없어진다.
//
//   ★ Enter = **그 칸 하나만** 윗줄에서 내리고 다음 칸으로 (2026-08-11 사장님이 매입매출전표에서 정한 규칙).
//     한 줄이 통째로 내려오면 한 칸만 다른 건을 칠 때 내려온 값을 도로 지워야 한다.
//   ★ 새 줄은 백지다 — 내리는 건 Enter 로 사람이 고른다.
//   ★ 합계는 칠 수 없다(공급가액+부가세라 셀 수 있는 값이다). Enter 차례에서도 건너뛴다.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { todayKst } from "@/lib/kst";
import { DateField } from "@/components/date-field";
import { PickList } from "@/components/pick-list";
import { listPartnerPrices, type Product, type Warehouse } from "@/lib/inventory";
import {
  loadLayout, saveLayout, resetLayout, newFieldId, defaultLayout,
  FORM_LABEL, type FormKey, type Field, type Layout, type Order, type OrderLine,
} from "@/lib/inventory-orders";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
const num = (v: unknown) => {
  const n = Number(String(v ?? "").replace(/[,\s₩원]/g, ""));
  return Number.isNaN(n) ? 0 : n;
};

export type Partner = { id: string; name: string };
export type DocRow = {
  key: number;
  id?: string | null;          // 저장된 줄(고칠 때)
  src?: string | null;         // 어느 주문서에서 불러온 줄인가
  srcLineId?: string | null;
  product_id?: string | null;
  sku: string; spec: string; qty: string; price: string; supply: string; vat: string; lnote: string;
  custom: Record<string, string>;
};

let K = 1;
export const blankRow = (): DocRow => ({
  key: K++, sku: "", spec: "", qty: "", price: "", supply: "", vat: "", lnote: "", custom: {},
});

export function useDocEditor(companyId: string | null, userId: string | null, formKey: FormKey, products: Product[]) {
  const { toast } = useToast();
  const qc = useQueryClient();
  //   ★ 들어오면 **오늘 날짜**가 이미 들어가 있다(사장님 지시) — 매번 치게 하지 않는다.
  const [head, setHead] = useState<Record<string, string>>(() => ({ date: todayKst() }));
  const [rows, setRows] = useState<DocRow[]>(() => Array.from({ length: 5 }, blankRow));
  const [editing, setEditing] = useState<Order | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [draft, setDraft] = useState<Layout | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const { data: layout = defaultLayout(formKey) } = useQuery({
    queryKey: ["form-layout", companyId, formKey],
    queryFn: () => loadLayout(companyId!, formKey),
    enabled: !!companyId,
  });

  const onHead = useMemo(() => layout.head.filter((f) => f.on), [layout]);
  const onLine = useMemo(() => layout.line.filter((f) => f.on), [layout]);
  //   Enter 가 훑는 차례 — 화면에 보이는 왼→오 그대로(합계는 자동이라 없다)
  const cells = useMemo(() => onLine.map((f) => f.field_id), [onLine]);

  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const bySku = useMemo(() => new Map(products.map((p) => [p.sku.toUpperCase(), p])), [products]);

  //   ★ 거래처별 단가(결정 26) — 거래처를 고르면 그 거래처와 마지막에 거래한 단가가 먼저 온다.
  //     없으면 품목의 판매가·매입가. 채워만 주고 정하는 것은 사람이다.
  const [partnerPrices, setPartnerPrices] = useState<Map<string, number>>(new Map());
  const side: "sale" | "buy" = formKey === "buy" || formKey === "make" ? "buy" : "sale";
  useEffect(() => {
    let alive = true;
    if (!companyId || !head.partner_id) { setPartnerPrices(new Map()); return; }
    listPartnerPrices(companyId, head.partner_id, side).then((m) => { if (alive) setPartnerPrices(m); }).catch(() => {});
    return () => { alive = false; };
  }, [companyId, head.partner_id, side]);
  const priceOf = useCallback((p: Product) => partnerPrices.get(p.id) ?? (side === "buy" ? p.cost_price : p.sale_price), [partnerPrices, side]);

  /** 품목을 고르면 규격·단가를 채워 준다 — 채워만 주고 정하는 것은 사람이다. */
  const fillFrom = useCallback((r: DocRow, p: Product) => {
    r.product_id = p.id;
    r.sku = `${p.sku} ${p.name}`;
    if (!r.spec) r.spec = p.spec || "";
    const unit = priceOf(p);
    if (unit != null && !num(r.price)) r.price = String(unit);
    if (num(r.qty) && !num(r.supply)) {
      const sup = num(r.price) * num(r.qty);
      r.supply = String(sup);
      r.vat = String(Math.round(sup * 0.1));
    }
  }, [priceOf]);

  const setCell = useCallback((i: number, key: string, v: string) => {
    setRows((s) => s.map((r, j) => {
      if (j !== i) return r;
      const n = { ...r, custom: { ...r.custom } };
      if (key.startsWith("f_")) { n.custom[key] = v; return n; }
      (n as any)[key] = v;
      //   공급가액을 치면 부가세 10% 가 저절로 선다 — 면세·영세면 부가세만 0 으로 고친다
      //   ★ 단가도 다시 낸다 — 단가 칸이 꺼진 양식에서 공급가액을 고치면 저장 단가가 옛 값으로 남았다(2026-08-25 검증에서 잡음)
      if (key === "supply") { n.vat = String(Math.round(num(v) * 0.1)); if (num(n.qty)) n.price = String(num(v) / num(n.qty)); }
      //   수량을 치면 단가가 있는 한 공급가액이 따라온다 — 단가를 직접 치지 않아도 되게
      if (key === "qty" && num(n.price)) {
        const sup = num(n.price) * num(v);
        n.supply = String(sup); n.vat = String(Math.round(sup * 0.1));
      }
      if (key === "price" && num(n.qty)) {
        const sup = num(v) * num(n.qty);
        n.supply = String(sup); n.vat = String(Math.round(sup * 0.1));
      }
      return n;
    }));
  }, []);

  const focusCell = useCallback((i: number, key: string) => {
    const el = gridRef.current?.querySelector<HTMLInputElement>(`[data-cell="${key}-${i}"]`);
    if (el) { el.focus(); el.select?.(); }
  }, []);

  /** ★ Enter — 그 칸 하나만 윗줄에서 내리고 다음 칸으로. 끝 칸이면 아래 줄 첫 칸(없으면 새 줄). */
  const onCellKey = useCallback((e: React.KeyboardEvent, i: number, key: string) => {
    if (e.key !== "Enter") return;
    e.preventDefault();
    const ci = cells.indexOf(key);
    setRows((s) => {
      const next = s.map((r) => ({ ...r, custom: { ...r.custom } }));
      const cur = key.startsWith("f_") ? next[i].custom[key] : (next[i] as any)[key];
      if (i > 0 && !String(cur ?? "").trim()) {
        const up = key.startsWith("f_") ? next[i - 1].custom[key] : (next[i - 1] as any)[key];
        if (key.startsWith("f_")) next[i].custom[key] = up || "";
        else {
          (next[i] as any)[key] = up ?? "";
          if (key === "sku") { next[i].product_id = next[i - 1].product_id; next[i].spec = next[i - 1].spec; }
          if (key === "supply") next[i].vat = String(Math.round(num(up) * 0.1));
        }
      }
      if (ci >= cells.length - 1 && i === s.length - 1) next.push(blankRow());
      return next;
    });
    setTimeout(() => {
      if (ci < cells.length - 1) focusCell(i, cells[ci + 1]);
      else focusCell(i + 1, cells[0]);
    }, 0);
  }, [cells, focusCell]);

  const live = useMemo(() => rows.filter((r) => r.product_id || r.sku.trim() || num(r.qty) || num(r.supply)), [rows]);
  const sums = useMemo(() => ({
    lines: live.length,
    supply: live.reduce((n, r) => n + num(r.supply), 0),
    vat: live.reduce((n, r) => n + num(r.vat), 0),
    total: live.reduce((n, r) => n + num(r.supply) + num(r.vat), 0),
  }), [live]);

  const reset = useCallback(() => {
    setHead({ date: todayKst() }); setRows(Array.from({ length: 5 }, blankRow)); setEditing(null);
  }, []);

  /** 저장분을 불러 그대로 편다 — 치던 화면 그대로다. */
  const loadDoc = useCallback((o: Order, ls: OrderLine[]) => {
    setEditing(o);
    setHead({
      date: o.order_date,
      partner: o.partner_name || "", partner_id: o.partner_id || "",
      wh: o.warehouse_id || "", due: o.due_date || "", note: o.note || "",
      ...(o.custom || {}),
    });
    setRows([
      ...ls.map((l) => {
        const p = byId.get(l.product_id);
        return {
          ...blankRow(), id: l.id, product_id: l.product_id,
          sku: p ? `${p.sku} ${p.name}` : "", spec: p?.spec || "",
          qty: String(l.qty), price: l.unit_price == null ? "" : String(l.unit_price),
          supply: String(l.supply_amount), vat: String(l.vat_amount),
          lnote: l.note || "", custom: l.custom || {},
        } as DocRow;
      }),
      blankRow(),
    ]);
  }, [byId]);

  /** 다른 주문서에서 줄을 가져온다 — 남은 수량만. 어디서 왔는지 줄에 남는다.
   *  ★ 머리(거래처·창고·납기)도 같이 가져온다 — 주문서에 이미 적힌 것을 다시 치게 하지 않는다.
   *    다만 **이미 적어 둔 값은 덮지 않는다**(사람이 고쳐 둔 것이 이긴다). */
  const pullLines = useCallback((
    src: { no: string; lineId: string; product_id: string; qty: number; price: number | null; lnote?: string }[],
    from?: { partner?: string | null; partner_id?: string | null; wh?: string | null; due?: string | null; date?: string | null },
  ) => {
    if (from) {
      setHead((h) => ({
        ...h,
        partner: h.partner || from.partner || "",
        partner_id: h.partner_id || from.partner_id || "",
        wh: h.wh || from.wh || "",
        due: h.due || from.due || "",
      }));
    }
    setRows((s) => {
      const keep = s.filter((r) => r.product_id || r.sku.trim());
      const add = src.map((x) => {
        const r = blankRow();
        const p = byId.get(x.product_id);
        r.src = x.no; r.srcLineId = x.lineId; r.product_id = x.product_id;
        r.sku = p ? `${p.sku} ${p.name}` : ""; r.spec = p?.spec || "";
        r.qty = String(x.qty); r.price = x.price == null ? "" : String(x.price);
        const sup = (x.price || 0) * x.qty;
        r.supply = String(sup); r.vat = String(Math.round(sup * 0.1));
        r.lnote = x.lnote || "";
        return r;
      });
      return [...keep, ...add, blankRow()];
    });
  }, [byId]);

  /** 저장할 값으로 빚는다 — 화면 값이 아니라 **셀 수 있는 값**으로. */
  const build = useCallback(() => {
    const date = head.date || todayKst();
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(date);
    const customHead: Record<string, string> = {};
    onHead.forEach((f) => { if (f.custom && head[f.field_id]) customHead[f.field_id] = head[f.field_id]; });
    const lines = live.map((r) => {
      const p = r.product_id ? byId.get(r.product_id) : bySku.get(r.sku.split(" ")[0]?.toUpperCase() || "");
      const customLine: Record<string, string> = {};
      onLine.forEach((f) => { if (f.custom && r.custom[f.field_id]) customLine[f.field_id] = r.custom[f.field_id]; });
      return {
        id: r.id || null, srcLineId: r.srcLineId || null,
        product_id: p?.id || "", qty: num(r.qty),
        unit_price: num(r.price) || (num(r.qty) ? num(r.supply) / num(r.qty) : null),
        supply_amount: num(r.supply), vat_amount: num(r.vat),
        note: r.lnote || null, custom: customLine,
      };
    });
    return {
      ok: valid && lines.length > 0 && lines.every((l) => l.product_id && l.qty > 0),
      date,
      head: { ...head, custom: customHead } as Record<string, string> & { custom: Record<string, string> },
      lines, sums,
    };
  }, [head, live, onHead, onLine, byId, bySku, sums]);

  // ── 양식 고치기 ──
  const openForm = useCallback(() => { setDraft(JSON.parse(JSON.stringify(layout))); setFormOpen(true); }, [layout]);
  const commitForm = useCallback(async () => {
    if (!draft || !companyId) { setFormOpen(false); return; }
    try {
      await saveLayout(companyId, formKey, draft, userId);
      await qc.invalidateQueries({ queryKey: ["form-layout", companyId, formKey] });
      setFormOpen(false);
      toast("입력 항목을 저장했습니다 — 회사 전체에 적용됩니다", "success");
    } catch (e) { toast(friendlyError(e, "입력 항목을 저장하지 못했습니다"), "error"); }
  }, [draft, companyId, formKey, userId, qc, toast]);

  return {
    formKey, companyId, userId, toast, qc, gridRef,
    layout, onHead, onLine, cells, head, setHead, rows, setRows, setCell, onCellKey, focusCell,
    live, sums, editing, setEditing, reset, loadDoc, pullLines, build, fillFrom, priceOf,
    formOpen, setFormOpen, draft, setDraft, openForm, commitForm,
  };
}
export type DocCtl = ReturnType<typeof useDocEditor>;

// ── 머리 ──────────────────────────────────────────────────────────────────────
export function DocHead({ ctl, warehouses, partners, staff }: {
  ctl: DocCtl; warehouses: Warehouse[]; partners: Partner[]; staff?: Partner[];
}) {
  const { head, setHead, onHead } = ctl;
  const [drop, setDrop] = useState<string | null>(null);
  const set = (k: string, v: string) => setHead((s) => ({ ...s, [k]: v }));
  useEffect(() => {
    if (!head.wh && warehouses.length) set("wh", warehouses.find((w) => w.is_default)?.id || warehouses[0].id);
  }, [warehouses]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="doc-head">
      {onHead.map((f) => (
        <label key={f.field_id} className="doc-fld">
          <span className="field-label">{f.name}{f.lock ? <b> *</b> : null}</span>
          <div className="doc-fld-in">
            {/*   ★ 날짜는 한 칸에 다 친다(사장님 지시) — 20260825 · 0825 · 8-25 다 알아듣고,
                  오른쪽 달력으로 골라도 된다. 일반전표·매입매출전표가 쓰는 그 칸이다. */}
            {f.field_id === "date" ? (
              <DateField value={head.date || ""} onChange={(e) => set("date", e.target.value)} className="field-input" />
            ) : f.field_id === "due" ? (
              <DateField value={head.due || ""} onChange={(e) => set("due", e.target.value)} className="field-input" />
            ) : f.field_id === "partner" || f.field_id === "staff" ? (
              //   ★ 거래처·담당자는 일반전표와 **같은 방식**으로 고른다 — 치면 목록, ↑↓ 이동, Enter 고르기
              <div className="doc-pick-wrap">
                <input className="field-input" placeholder={f.name}
                  value={head[f.field_id] || ""}
                  onChange={(e) => {
                    setHead((s) => ({ ...s, [f.field_id]: e.target.value,
                      ...(f.field_id === "partner" ? { partner_id: "" } : {}) }));
                    setDrop(f.field_id);
                  }}
                  //   ★ 커서만 왔다고 목록을 펼치지 않는다 — 남의 칸을 덮는다(2026-08-18 사장님 규칙).
                  //     글자를 치면 열리고, 빈 칸에서 목록을 보고 싶으면 ↓ 를 누른다.
                  onKeyDown={(e) => { if (e.key === "ArrowDown" && drop !== f.field_id) { e.preventDefault(); setDrop(f.field_id); } }} />
                {drop === f.field_id && (
                  //   ★ 칸에 친 글자로 **미리 좁혀서** 넘긴다 — 안 그러면 고르개 검색칸에 또 쳐야 한다.
                  //     고르개 안에서 더 좁힐 수도 있다(두 겹).
                  <PickList
                    items={(f.field_id === "partner" ? partners : (staff || []))
                      .filter((p) => { const q = (head[f.field_id] || "").trim().toLowerCase();
                        return !q || p.name.toLowerCase().includes(q); })
                      .map((p) => ({ id: p.id, name: p.name }))}
                    placeholder={`${f.name} 검색`}
                    empty={f.field_id === "partner" ? "등록된 거래처가 없습니다 — 이름만 입력해도 됩니다" : "등록된 구성원이 없습니다"}
                    onPick={(sel) => {
                      setHead((s) => ({ ...s, [f.field_id]: sel.name,
                        ...(f.field_id === "partner" ? { partner_id: sel.id } : {}) }));
                      setDrop(null);
                    }}
                    onClose={() => setDrop(null)} />
                )}
              </div>
            ) : f.field_id === "wh" ? (
              <select className="field-input" value={head.wh || ""} onChange={(e) => set("wh", e.target.value)}>
                {!warehouses.length && <option value="">창고 없음</option>}
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            ) : (
              <input className="field-input" placeholder={f.name} value={head[f.field_id] || ""} onChange={(e) => set(f.field_id, e.target.value)} />
            )}
          </div>
        </label>
      ))}
    </div>
  );
}

// ── 격자 ──────────────────────────────────────────────────────────────────────
const W: Record<string, string> = {
  sku: "220px", spec: "150px", qty: "64px", price: "104px", supply: "116px", vat: "104px", lnote: "170px",
};
const NUMS = new Set(["qty", "price", "supply", "vat"]);
const LEFTS = new Set(["sku", "spec", "lnote"]);

export function DocGrid({ ctl, products }: { ctl: DocCtl; products: Product[] }) {
  const { onLine, rows, setRows, setCell, onCellKey, gridRef, fillFrom, priceOf } = ctl;
  const [pick, setPick] = useState<{ row: number; q: string; idx: number } | null>(null);
  const anySrc = rows.some((r) => r.src);

  const choose = (i: number, p: Product) => {
    setRows((s) => s.map((r, j) => {
      if (j !== i) return r;
      const n = { ...r, custom: { ...r.custom } };
      fillFrom(n, p);
      return n;
    }));
    setPick(null);
    setTimeout(() => {
      const ci = ctl.cells.indexOf("sku");
      ctl.focusCell(i, ctl.cells[Math.min(ci + 1, ctl.cells.length - 1)]);
    }, 0);
  };

  return (
    <div className="stg-table-wrap" ref={gridRef}>
      <table className="ev-table ev-lined table-doc">
        <thead>
          <tr>
            <th className="doc-no"></th>
            {anySrc && <th className="doc-th-src">불러온 곳</th>}
            {onLine.map((f) => <th key={f.field_id} style={{ width: W[f.field_id] || "130px" }}>{f.name}</th>)}
            <th className="doc-th-src">합계</th>
            <th className="doc-th-x"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            const tot = num(r.supply) + num(r.vat);
            const has = !!(r.product_id || r.sku.trim() || num(r.qty) || num(r.supply));
            return (
              <tr key={r.key}>
                <td className="doc-no">{i + 1}</td>
                {anySrc && <td className="tc">{r.src ? <span className="doc-src">{r.src}</span> : null}</td>}
                {onLine.map((f) => {
                  const id = f.field_id;
                  const raw = id.startsWith("f_") ? (r.custom[id] || "") : String((r as any)[id] ?? "");
                  const shown = NUMS.has(id) && raw !== "" ? won(num(raw)) : raw;
                  return (
                    <td key={id} className={`cell ${NUMS.has(id) ? "num" : LEFTS.has(id) ? "text-left" : "tc"}`}>
                      <input className="doc-in" data-cell={`${id}-${i}`}
                        inputMode={NUMS.has(id) ? "numeric" : undefined}
                        placeholder={id === "sku" ? "품목명 · SKU" : f.name}
                        value={shown}
                        onChange={(e) => { setCell(i, id, e.target.value); if (id === "sku") setPick({ row: i, q: e.target.value, idx: 0 }); }}
                        onKeyDown={(e) => {
                          //   품목 고르개가 열려 있으면 ↑↓·Enter 는 그쪽이 먹는다(PickList 안에서 처리)
                          if (id === "sku" && pick && pick.row === i && e.key !== "Escape") return;
                          //   ★ 빈 칸에서 목록을 보고 싶으면 ↓ — 커서만 왔다고 펼치지는 않는다
                          if (id === "sku" && e.key === "ArrowDown") { e.preventDefault(); setPick({ row: i, q: raw, idx: 0 }); return; }
                          onCellKey(e, i, id);
                        }} />
                      {/*   ★ 품목도 일반전표와 같은 고르개 — 치면 목록, ↑↓ 이동, Enter 고르기.
                            아래로 뜨는 자체 목록을 쓰다가 표 안에서 잘렸다. */}
                      {id === "sku" && pick && pick.row === i && (
                        <PickList
                          items={products.filter((p) => {
                            if (!p.is_active) return false;
                            //   ★ 셀에 친 글자로 미리 좁힌다 — 두 번 치지 않게
                            const q = String(r.sku || "").trim().toLowerCase();
                            return !q || `${p.sku} ${p.name} ${p.spec || ""}`.toLowerCase().includes(q);
                          }).map((p) => ({
                            id: p.id, code: p.sku,
                            name: `${p.name}${p.spec ? ` (${p.spec})` : ""}`,
                          }))}
                          placeholder="품목 검색 (이름·SKU·규격)"
                          empty="등록된 품목이 없습니다 — 재고 › 품목에서 먼저 등록하세요"
                          onPick={(sel) => {
                            const p = products.find((x) => x.id === sel.id);
                            if (p) choose(i, p);
                            else setPick(null);
                          }}
                          onClose={() => setPick(null)} />
                      )}
                    </td>
                  );
                })}
                <td className="doc-auto"><b>{has ? won(tot) : "—"}</b></td>
                <td className="tc">
                  <button type="button" className="inv-line-x" aria-label="줄 삭제"
                    onClick={() => setRows((s) => (s.length > 1 ? s.filter((_, j) => j !== i) : [blankRow()]))}>✕</button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── 양식 고치기 ───────────────────────────────────────────────────────────────
export function FormDialog({ ctl }: { ctl: DocCtl }) {
  const { formOpen, setFormOpen, draft, setDraft, commitForm, formKey, companyId, qc, toast } = ctl;
  const [nh, setNh] = useState(""); const [nl, setNl] = useState("");
  if (!formOpen || !draft) return null;

  const setField = (sec: "head" | "line", id: string, patch: Partial<Field>) =>
    setDraft((d) => d && ({ ...d, [sec]: d[sec].map((f) => (f.field_id === id ? { ...f, ...patch } : f)) }));
  const addField = (sec: "head" | "line", name: string, clear: () => void) => {
    const nm = name.trim();
    //   ★ 이름 없이는 못 만든다 — '문자형식2' 같은 칸을 두지 않으려는 것이다
    if (!nm) { toast("항목 이름을 입력해야 추가할 수 있습니다", "error"); return; }
    setDraft((d) => d && ({ ...d, [sec]: [...d[sec], { field_id: newFieldId(), name: nm, on: true, custom: true }] }));
    clear();
  };

  const rowOf = (sec: "head" | "line") => (f: Field) => (
    <div key={f.field_id} className={`fl-row${f.on ? " fl-on" : ""}${f.lock ? " fl-lock" : ""}`}>
      <input type="checkbox" checked={f.on} disabled={f.lock}
        onChange={(e) => setField(sec, f.field_id, { on: e.target.checked })} />
      <input className="fl-name" value={f.name} readOnly={f.lock}
        onChange={(e) => setField(sec, f.field_id, { name: e.target.value })} />
      {f.lock ? <span className="fl-why">해제 불가</span> : <span className="fl-why">{f.why || (f.custom ? "직접 추가한 항목" : "")}</span>}
      {f.custom && (
        <button type="button" className="inv-line-x" title="이 항목 삭제"
          onClick={() => setDraft((d) => d && ({ ...d, [sec]: d[sec].filter((x) => x.field_id !== f.field_id) }))}>✕</button>
      )}
    </div>
  );

  return (
    <div className="inv-modal" onClick={() => setFormOpen(false)}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">입력 항목 설정 — {FORM_LABEL[formKey]}</h3>
        <p className="inv-modal-desc">
          사용할 항목만 선택하세요. <b>이름을 눌러 변경할 수 있습니다.</b>
          이 설정은 <b>이 양식에만</b> 적용되며 <b>회사 전체에</b> 반영됩니다.
        </p>

        <div className="fl-grp">
          <h4>공통 항목 — 전표당 한 번 입력합니다</h4>
          <p className="fl-desc">일자는 필수 항목이라 해제할 수 없습니다.</p>
          <div className="fl-list">{draft.head.map(rowOf("head"))}</div>
          <div className="fl-add">
            <input className="field-input" placeholder="추가할 항목 이름 (예: 현장명 · 결제조건)" value={nh} onChange={(e) => setNh(e.target.value)} />
            <button type="button" className="btn-secondary btn-sm" onClick={() => addField("head", nh, () => setNh(""))}>공통 항목 추가</button>
          </div>
        </div>

        <div className="fl-grp">
          <h4>품목 항목 — 품목마다 입력합니다</h4>
          <p className="fl-desc">품목·수량·공급가액은 계산에 필요해 해제할 수 없습니다.</p>
          <div className="fl-list">{draft.line.map(rowOf("line"))}</div>
          <div className="fl-add">
            <input className="field-input" placeholder="추가할 항목 이름 (예: 도면번호 · 색상)" value={nl} onChange={(e) => setNl(e.target.value)} />
            <button type="button" className="btn-secondary btn-sm" onClick={() => addField("line", nl, () => setNl(""))}>품목 항목 추가</button>
          </div>
        </div>

        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm"
            onClick={async () => {
              if (!window.confirm(`${FORM_LABEL[formKey]} 입력 항목을 기본값으로 되돌릴까요?`)) return;
              try {
                await resetLayout(companyId!, formKey);
                await qc.invalidateQueries({ queryKey: ["form-layout", companyId, formKey] });
                setFormOpen(false); toast("기본값으로 되돌렸습니다", "success");
              } catch (e) { toast(friendlyError(e), "error"); }
            }}>기본값으로</button>
          <span className="fl-note">해제한 항목의 값은 삭제되지 않습니다 — 다시 선택하면 그대로 표시됩니다.</span>
          <button type="button" className="btn-secondary btn-sm" onClick={() => setFormOpen(false)}>취소</button>
          <button type="button" className="btn-primary btn-sm" onClick={commitForm}>저장</button>
        </div>
      </div>
    </div>
  );
}

// ── 바닥 합계 ─────────────────────────────────────────────────────────────────
export function DocSums({ ctl, right }: { ctl: DocCtl; right?: React.ReactNode }) {
  const { sums } = ctl;
  return (
    <div className="doc-sums">
      <span><em>줄</em><b>{won(sums.lines)}</b></span>
      <span><em>공급가액</em><b>{won(sums.supply)}</b></span>
      <span><em>부가세</em><b>{won(sums.vat)}</b></span>
      <span><em>합계</em><b className="doc-total">₩{won(sums.total)}</b></span>
      <span className="doc-sums-sp" />
      {right}
    </div>
  );
}

export { won as docWon, num as docNum, todayKst };
