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
import type { Product, Warehouse } from "@/lib/inventory";
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
  const [head, setHead] = useState<Record<string, string>>({});
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

  const priceOf = useCallback((p: Product) => (formKey === "buy" || formKey === "make" ? p.cost_price : p.sale_price), [formKey]);

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
      if (key === "supply") n.vat = String(Math.round(num(v) * 0.1));
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
    setHead({}); setRows(Array.from({ length: 5 }, blankRow)); setEditing(null);
  }, []);

  /** 저장분을 불러 그대로 편다 — 치던 화면 그대로다. */
  const loadDoc = useCallback((o: Order, ls: OrderLine[]) => {
    setEditing(o);
    setHead({
      y: o.order_date.slice(0, 4), m: String(Number(o.order_date.slice(5, 7))), d: String(Number(o.order_date.slice(8, 10))),
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

  /** 다른 주문서에서 줄을 가져온다 — 남은 수량만. 어디서 왔는지 줄에 남는다. */
  const pullLines = useCallback((src: { no: string; lineId: string; product_id: string; qty: number; price: number | null; lnote?: string }[]) => {
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
    const date = `${head.y || new Date().getFullYear()}-${String(head.m || "").padStart(2, "0")}-${String(head.d || "").padStart(2, "0")}`;
    const valid = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number(head.m) >= 1 && Number(head.m) <= 12 && Number(head.d) >= 1 && Number(head.d) <= 31;
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
      toast("양식을 저장했습니다 — 이 회사 전체에 쓰입니다", "success");
    } catch (e) { toast(friendlyError(e, "양식을 저장하지 못했습니다"), "error"); }
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
export function DocHead({ ctl, warehouses, partners }: { ctl: DocCtl; warehouses: Warehouse[]; partners: Partner[] }) {
  const { head, setHead, onHead } = ctl;
  const set = (k: string, v: string) => setHead((s) => ({ ...s, [k]: v }));
  useEffect(() => {
    if (!head.y) set("y", String(new Date().getFullYear()));
    if (!head.wh && warehouses.length) set("wh", warehouses.find((w) => w.is_default)?.id || warehouses[0].id);
  }, [warehouses]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="doc-head">
      {onHead.map((f) => (
        <label key={f.field_id} className="doc-fld">
          <span className="field-label">{f.name}{f.lock ? <b> *</b> : null}</span>
          <div className="doc-fld-in">
            {f.field_id === "date" ? (
              <div className="doc-d3">
                <input className="field-input doc-y" inputMode="numeric" maxLength={4} value={head.y || ""} onChange={(e) => set("y", e.target.value)} />
                <input className="field-input doc-md" inputMode="numeric" maxLength={2} placeholder="월" value={head.m || ""} onChange={(e) => set("m", e.target.value)} />
                <input className="field-input doc-md" inputMode="numeric" maxLength={2} placeholder="일" value={head.d || ""} onChange={(e) => set("d", e.target.value)} />
              </div>
            ) : f.field_id === "partner" ? (
              <>
                <input className="field-input" list="doc-partners" placeholder="거래처" value={head.partner || ""}
                  onChange={(e) => {
                    const hit = partners.find((p) => p.name === e.target.value);
                    setHead((s) => ({ ...s, partner: e.target.value, partner_id: hit?.id || "" }));
                  }} />
                <datalist id="doc-partners">{partners.map((p) => <option key={p.id} value={p.name} />)}</datalist>
              </>
            ) : f.field_id === "wh" ? (
              <select className="field-input" value={head.wh || ""} onChange={(e) => set("wh", e.target.value)}>
                {!warehouses.length && <option value="">창고 없음</option>}
                {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            ) : f.field_id === "due" ? (
              <input type="date" className="field-input" value={head.due || ""} onChange={(e) => set("due", e.target.value)} />
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

  const cands = useMemo(() => {
    if (!pick) return [];
    const q = pick.q.trim().toLowerCase();
    return products.filter((p) => p.is_active &&
      (!q || `${p.sku} ${p.name} ${p.spec || ""}`.toLowerCase().includes(q))).slice(0, 7);
  }, [pick, products]);

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
            {anySrc && <th style={{ width: "116px" }}>불러온 곳</th>}
            {onLine.map((f) => <th key={f.field_id} style={{ width: W[f.field_id] || "130px" }}>{f.name}</th>)}
            <th style={{ width: "116px" }}>합계</th>
            <th style={{ width: "34px" }}></th>
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
                        onFocus={() => { if (id === "sku" && !r.product_id) setPick({ row: i, q: raw, idx: 0 }); }}
                        onBlur={() => setTimeout(() => setPick((p) => (p && p.row === i ? null : p)), 140)}
                        onKeyDown={(e) => {
                          if (pick && pick.row === i && cands.length) {
                            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
                              e.preventDefault();
                              setPick((p) => p && ({ ...p, idx: Math.max(0, Math.min(cands.length - 1, p.idx + (e.key === "ArrowDown" ? 1 : -1))) }));
                              return;
                            }
                            if (e.key === "Enter") { e.preventDefault(); choose(i, cands[pick.idx]); return; }
                            if (e.key === "Escape") { setPick(null); return; }
                          }
                          onCellKey(e, i, id);
                        }} />
                      {id === "sku" && pick && pick.row === i && cands.length > 0 && (
                        <div className="doc-pick">
                          {cands.map((p, n) => (
                            <div key={p.id} aria-selected={n === pick.idx}
                              onMouseDown={(e) => { e.preventDefault(); choose(i, p); }}>
                              <code>{p.sku}</code>
                              <span>{p.name}{p.spec ? <em> {p.spec}</em> : null}</span>
                              <small>{priceOf(p) != null ? `₩${won(Number(priceOf(p)))}` : "—"}</small>
                            </div>
                          ))}
                        </div>
                      )}
                    </td>
                  );
                })}
                <td className="doc-auto"><b>{has ? won(tot) : "—"}</b></td>
                <td className="tc">
                  <button type="button" className="inv-line-x" aria-label="줄 지우기"
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
    if (!nm) { toast("칸은 이름부터 지어야 만들 수 있습니다", "error"); return; }
    setDraft((d) => d && ({ ...d, [sec]: [...d[sec], { field_id: newFieldId(), name: nm, on: true, custom: true }] }));
    clear();
  };

  const rowOf = (sec: "head" | "line") => (f: Field) => (
    <div key={f.field_id} className={`fl-row${f.on ? " fl-on" : ""}${f.lock ? " fl-lock" : ""}`}>
      <input type="checkbox" checked={f.on} disabled={f.lock}
        onChange={(e) => setField(sec, f.field_id, { on: e.target.checked })} />
      <input className="fl-name" value={f.name} readOnly={f.lock}
        onChange={(e) => setField(sec, f.field_id, { name: e.target.value })} />
      {f.lock ? <span className="fl-why">끌 수 없음</span> : <span className="fl-why">{f.why || (f.custom ? "직접 만든 칸" : "")}</span>}
      {f.custom && (
        <button type="button" className="inv-line-x" title="이 칸 지우기"
          onClick={() => setDraft((d) => d && ({ ...d, [sec]: d[sec].filter((x) => x.field_id !== f.field_id) }))}>✕</button>
      )}
    </div>
  );

  return (
    <div className="inv-modal" onClick={() => setFormOpen(false)}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">양식 고치기 — {FORM_LABEL[formKey]}</h3>
        <p className="inv-modal-desc">
          쓰는 칸만 켜세요. <b>이름을 눌러 바꿀 수 있습니다.</b>
          이 설정은 <b>이 양식에만</b>, 그리고 <b>회사 전체에</b> 쓰입니다.
        </p>

        <div className="fl-grp">
          <h4>머리 칸 — 전표 하나에 한 번 적는 것</h4>
          <p className="fl-desc">일자·거래처는 없으면 전표가 서지 않아 끌 수 없습니다.</p>
          <div className="fl-list">{draft.head.map(rowOf("head"))}</div>
          <div className="fl-add">
            <input className="field-input" placeholder="새 칸 이름 (예: 현장명 · 결제조건)" value={nh} onChange={(e) => setNh(e.target.value)} />
            <button type="button" className="btn-secondary btn-sm" onClick={() => addField("head", nh, () => setNh(""))}>머리에 더하기</button>
          </div>
        </div>

        <div className="fl-grp">
          <h4>줄 칸 — 품목마다 적는 것</h4>
          <p className="fl-desc">품목·수량·공급가액은 계산의 뼈대라 끌 수 없습니다.</p>
          <div className="fl-list">{draft.line.map(rowOf("line"))}</div>
          <div className="fl-add">
            <input className="field-input" placeholder="새 칸 이름 (예: 도면번호 · 색상)" value={nl} onChange={(e) => setNl(e.target.value)} />
            <button type="button" className="btn-secondary btn-sm" onClick={() => addField("line", nl, () => setNl(""))}>줄에 더하기</button>
          </div>
        </div>

        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm"
            onClick={async () => {
              if (!window.confirm(`${FORM_LABEL[formKey]} 양식을 처음 상태로 되돌릴까요?`)) return;
              try {
                await resetLayout(companyId!, formKey);
                await qc.invalidateQueries({ queryKey: ["form-layout", companyId, formKey] });
                setFormOpen(false); toast("되돌렸습니다", "success");
              } catch (e) { toast(friendlyError(e), "error"); }
            }}>처음으로</button>
          <span className="fl-note">끈 칸에 적힌 값은 지워지지 않습니다 — 다시 켜면 그대로 있습니다.</span>
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
