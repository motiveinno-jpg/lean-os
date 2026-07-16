"use client";

// 견적서 품목 입력 테이블 — 회사별 컬럼 커스터마이징(수량·단가·부가세·적요·비고 등 자유 추가/삭제) + 자동계산.
//   컬럼 설정은 company_settings.settings.quote_columns(jsonb)에 회사별 저장.
import { useState, useEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { supabase } from "@/lib/supabase";
import { CurrencyInput } from "@/components/currency-input";
import { useModalKeys } from "@/hooks/use-modal-keys";

export type QuoteCol = {
  key: string;
  label: string;
  type: "text" | "number" | "calc";
  calc?: "supply" | "tax" | "total" | "unitVat"; // calc 컬럼 계산식
  custom?: boolean; // 사용자 추가 컬럼
};

// 토글 가능한 표준 컬럼 (견적서.PNG 기준)
const STANDARD_COLS: QuoteCol[] = [
  { key: "code", label: "품목코드", type: "text" },
  { key: "name", label: "품목명", type: "text" },
  { key: "spec", label: "규격", type: "text" },
  { key: "quantity", label: "수량", type: "number" },
  { key: "unitPrice", label: "단가", type: "number" },
  { key: "supplyAmount", label: "공급가액", type: "calc", calc: "supply" },
  { key: "taxAmount", label: "부가세", type: "calc", calc: "tax" },
  { key: "summary", label: "적요", type: "text" },
  { key: "unitPriceVat", label: "단가(VAT포함)", type: "calc", calc: "unitVat" },
    { key: "extraQty", label: "추가수량", type: "number" },
  { key: "serial", label: "시리얼/로트", type: "text" },
  { key: "cost", label: "원가", type: "number" },
  { key: "totalAmount", label: "합계", type: "calc", calc: "total" },
  { key: "note", label: "비고", type: "text" },
];

const DEFAULT_KEYS = ["name", "spec", "quantity", "unitPrice", "supplyAmount", "taxAmount", "summary", "totalAmount"];
const DEFAULT_COLS: QuoteCol[] = STANDARD_COLS.filter((c) => DEFAULT_KEYS.includes(c.key));

function calcRow(row: any, taxRate: number): any {
  const q = Number(row.quantity) || 0;
  const u = Number(row.unitPrice) || 0;
  const supply = Math.round(q * u);
  const tax = Math.round(supply * taxRate);
  return { ...row, supplyAmount: supply, taxAmount: tax, totalAmount: supply + tax, unitPriceVat: Math.round(u * (1 + taxRate)) };
}

export function QuoteItemsTable({
  items, onChange, companyId, editable, taxRate = 0.1, discount = 0, onDiscountChange, partnerName,
}: { items: any[]; onChange: (items: any[]) => void; companyId: string | null; editable: boolean; taxRate?: number; discount?: number; onDiscountChange?: (n: number) => void; partnerName?: string }) {
  const [cols, setCols] = useState<QuoteCol[]>(DEFAULT_COLS);
  const [showEditor, setShowEditor] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [showMyItems, setShowMyItems] = useState(false);

  // 선택 품목을 현재 목록에 추가(빈 자리행 제거 후)
  const appendItems = (newItems: any[]) => {
    const base = items.filter((r) => r && (r.name || r.quantity || r.unitPrice || r.code));
    onChange([...base, ...newItems.map((i) => calcRow(i, taxRate))]);
  };

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    (async () => {
      const { data } = await (supabase as any).from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
      const cfg = data?.settings?.quote_columns;
      if (alive && Array.isArray(cfg) && cfg.length) setCols(cfg);
    })();
    return () => { alive = false; };
  }, [companyId]);

  const saveCols = async (next: QuoteCol[]) => {
    setCols(next);
    if (!companyId) return;
    try {
      const { data } = await (supabase as any).from("company_settings").select("id, settings").eq("company_id", companyId).maybeSingle();
      const settings = { ...(data?.settings || {}), quote_columns: next };
      if (data?.id) await (supabase as any).from("company_settings").update({ settings }).eq("id", data.id);
      else await (supabase as any).from("company_settings").insert({ company_id: companyId, settings });
    } catch { /* 저장 실패 비치명 */ }
  };

  const rows = items.length ? items : [{}];
  const setRow = (idx: number, patch: any) => onChange(rows.map((r, i) => (i === idx ? calcRow({ ...r, ...patch }, taxRate) : r)));
  const addRow = () => onChange([...rows, {}]);
  const delRow = (idx: number) => onChange(rows.length > 1 ? rows.filter((_, i) => i !== idx) : [{}]);

  // Enter 로 다음 입력칸 이동 (오른쪽 → 다음 행 → 마지막이면 새 행). 마우스 없이 연속 입력.
  const editableCols = cols.filter((c) => c.type !== "calc");
  const focusCell = (r: number, c: number) => { const el = document.getElementById(`qcell-${r}-${c}`); if (el) (el as HTMLElement).focus(); };
  const onTableKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const active = document.activeElement as HTMLElement | null;
    const m = active?.id?.match(/^qcell-(\d+)-(\d+)$/);
    if (!m) return;
    e.preventDefault();
    const r = Number(m[1]), c = Number(m[2]);
    if (c + 1 < editableCols.length) focusCell(r, c + 1);
    else if (r + 1 < rows.length) focusCell(r + 1, 0);
    else { addRow(); setTimeout(() => focusCell(r + 1, 0), 30); }
  };

  const sums = useMemo(() => {
    const s: Record<string, number> = {};
    for (const c of cols) {
      if (c.type === "number" || c.type === "calc") {
        s[c.key] = rows.reduce((a, r) => a + (Number(r[c.key]) || 0), 0);
      }
    }
    return s;
  }, [rows, cols]);

  const fmt = (n: number) => (Number(n) || 0).toLocaleString("ko");
  const colWidth = (c: QuoteCol) => (c.key === "name" ? "min-w-[140px]" : c.type === "text" ? "w-28" : "w-24");

  return (
    <div className="quote-items-table">
      <div className="quote-items-toolbar">
        <span className="text-xs text-[var(--text-dim)] font-medium">품목 목록</span>
        {editable && (
          <div className="flex items-center gap-2">
            <button onClick={() => setShowHistory(true)} className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)] border border-[var(--border)] rounded px-2 py-0.5">📋 거래내역 불러오기</button>
            <button onClick={() => setShowMyItems(true)} className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)] border border-[var(--border)] rounded px-2 py-0.5">⭐ My품목</button>
            <button onClick={() => setShowEditor(true)} className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)] border border-[var(--border)] rounded px-2 py-0.5">⚙️ 열 편집</button>
            <button onClick={addRow} className="text-xs text-[var(--primary)] hover:underline">+ 품목 추가</button>
          </div>
        )}
      </div>
      <div className="quote-items-table-wrapper" onKeyDown={onTableKeyDown}>
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
              <th className="px-2 py-2 w-8 text-center">#</th>
              {cols.map((c) => (
                <th key={c.key} className={`px-3 py-2 font-medium whitespace-nowrap ${c.type === "text" ? "text-left" : "text-right"} ${colWidth(c)}`}>{c.label}</th>
              ))}
              {editable && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {rows.map((item, idx) => (
              <tr key={idx} className="border-b border-[var(--border)]/40">
                <td className="px-2 py-1.5 text-center text-[var(--text-dim)]">{idx + 1}</td>
                {cols.map((c) => {
                  const eci = editableCols.findIndex((ec) => ec.key === c.key);
                  return (
                  <td key={c.key} className={`px-2 py-1 ${c.type === "text" ? "" : "text-right"}`}>
                    {c.type === "calc" ? (
                      <span className="mono-number text-[var(--text)]">{fmt(item[c.key])}</span>
                    ) : !editable ? (
                      <span className={c.type === "number" ? "mono-number" : ""}>{c.type === "number" ? fmt(item[c.key]) : (item[c.key] || "")}</span>
                    ) : c.type === "number" ? (
                      <CurrencyInput
                        id={`qcell-${idx}-${eci}`}
                        value={item[c.key] ?? ""}
                        onValueChange={(raw) => setRow(idx, { [c.key]: raw })}
                        placeholder="0"
                        className="w-full px-1.5 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-right font-mono focus:outline-none focus:border-[var(--primary)]"
                      />
                    ) : (
                      <input
                        id={`qcell-${idx}-${eci}`}
                        value={item[c.key] || ""}
                        onChange={(e) => setRow(idx, { [c.key]: e.target.value })}
                        className="w-full px-1.5 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]"
                      />
                    )}
                  </td>
                  );
                })}
                {editable && (
                  <td className="px-1 text-center">
                    <button onClick={() => delRow(idx)} className="text-[var(--text-dim)] hover:text-red-500" title="행 삭제">✕</button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="bg-[var(--bg-surface)] font-bold text-[var(--text)] border-t-2 border-[var(--border)]">
              <td className="px-2 py-2 text-center">합계</td>
              {cols.map((c) => (
                <td key={c.key} className={`px-3 py-2 ${c.type === "text" ? "" : "text-right mono-number"}`}>
                  {c.type === "number" || c.type === "calc" ? fmt(sums[c.key]) : ""}
                </td>
              ))}
              {editable && <td />}
            </tr>
          </tfoot>
        </table>
      </div>

      {/* 요약 — 할인 + 이익계산 */}
      {(() => {
        const supplyTotal = rows.reduce((a, r) => a + (Number(r.supplyAmount) || 0), 0);
        const taxTotal = rows.reduce((a, r) => a + (Number(r.taxAmount) || 0), 0);
        const hasCost = cols.some((c) => c.key === "cost");
        const costTotal = rows.reduce((a, r) => a + (Number(r.cost) || 0) * (Number(r.quantity) || 1), 0);
        const grand = supplyTotal + taxTotal - (Number(discount) || 0);
        const profit = supplyTotal - costTotal;
        const profitRate = supplyTotal ? profit / supplyTotal : 0;
        return (
          <div className="quote-items-summary">
            <span className="text-[var(--text-muted)]">공급가액 <b className="mono-number text-[var(--text)]">{fmt(supplyTotal)}</b></span>
            <span className="text-[var(--text-muted)]">부가세 <b className="mono-number text-[var(--text)]">{fmt(taxTotal)}</b></span>
            <span className="flex items-center gap-1.5 text-[var(--text-muted)]">할인
              {editable ? (
                <CurrencyInput value={discount || ""} onValueChange={(raw) => onDiscountChange?.(Number(raw) || 0)} placeholder="0"
                  className="w-24 px-2 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-right font-mono focus:outline-none focus:border-[var(--primary)]" />
              ) : <b className="mono-number text-[var(--text)]">{discount ? `-${fmt(discount)}` : "0"}</b>}
            </span>
            <span className="text-sm text-[var(--text-muted)]">합계 <b className="mono-number text-[var(--primary)]">{fmt(grand)}</b></span>
            {hasCost && (
              <span className="text-[var(--text-dim)]">이익 <b className={`mono-number ${profit >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{fmt(profit)}</b> <span className="text-[10px]">({Math.round(profitRate * 100)}%)</span></span>
            )}
          </div>
        );
      })()}

      {/* 팝업은 portal로 body 에 띄움 — glass-card(backdrop-filter) 안에 갇히지 않게 */}
      {showEditor && typeof document !== "undefined" && createPortal(
        <ColumnEditor cols={cols} onClose={() => setShowEditor(false)} onSave={(next) => { saveCols(next); setShowEditor(false); }} />, document.body)}
      {showHistory && typeof document !== "undefined" && createPortal(
        <HistoryPicker companyId={companyId} partnerName={partnerName} onClose={() => setShowHistory(false)} onPick={(picked) => { appendItems(picked); setShowHistory(false); }} />, document.body)}
      {showMyItems && typeof document !== "undefined" && createPortal(
        <MyItemsPicker companyId={companyId} currentItems={items} onClose={() => setShowMyItems(false)} onPick={(picked) => { appendItems(picked); setShowMyItems(false); }} />, document.body)}
    </div>
  );
}

// ── 거래내역 불러오기 — 과거 견적/계산서 문서의 품목을 모아 선택 추가 ──
function HistoryPicker({ companyId, partnerName, onClose, onPick }: { companyId: string | null; partnerName?: string; onClose: () => void; onPick: (items: any[]) => void }) {
  const [loading, setLoading] = useState(true);
  const [pool, setPool] = useState<any[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [onlyPartner, setOnlyPartner] = useState(!!partnerName);

  useEffect(() => {
    if (!companyId) return;
    let alive = true;
    (async () => {
      const { data } = await (supabase as any).from("documents")
        .select("name, content_json, created_at")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }).limit(60);
      if (!alive) return;
      const seen = new Set<string>();
      const items: any[] = [];
      for (const d of (data || [])) {
        const cj = d.content_json || {};
        const docPartner = cj.header?.partnerName || "";
        for (const it of (Array.isArray(cj.items) ? cj.items : [])) {
          if (!it || !it.name) continue;
          const key = `${it.name}|${it.unitPrice || 0}`;
          if (seen.has(key)) continue;
          seen.add(key);
          items.push({ ...it, _doc: d.name || "문서", _partner: docPartner });
        }
      }
      setPool(items);
      setLoading(false);
    })();
    return () => { alive = false; };
  }, [companyId]);

  const filtered = useMemo(() => onlyPartner && partnerName ? pool.filter((i) => i._partner === partnerName) : pool, [pool, onlyPartner, partnerName]);
  const toggle = (i: number) => setSel((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });

  useModalKeys(true, onClose, sel.size === 0 ? undefined : () => onPick(filtered.filter((_, i) => sel.has(i)).map((it) => { const { _doc, _partner, ...rest } = it; return rest; })));

  return (
    <div className="history-picker-modal" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-xl max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-base font-bold">거래내역 불러오기</h3>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>
        <div className="px-6 py-2 border-b border-[var(--border)] flex items-center gap-3 text-xs">
          {partnerName && <label className="flex items-center gap-1.5 cursor-pointer"><input type="checkbox" checked={onlyPartner} onChange={(e) => setOnlyPartner(e.target.checked)} className="accent-[var(--primary)]" /> 이 거래처({partnerName})만</label>}
          <span className="text-[var(--text-dim)] ml-auto">{filtered.length}개 품목</span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {loading ? <div className="p-8 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
            : filtered.length === 0 ? <div className="p-8 text-center text-sm text-[var(--text-muted)]">불러올 과거 품목이 없습니다.</div>
            : filtered.map((it, i) => (
              <label key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-surface)] cursor-pointer text-xs">
                <input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)} className="accent-[var(--primary)]" />
                <span className="flex-1 font-medium">{it.name}</span>
                <span className="mono-number text-[var(--text-muted)]">{Number(it.unitPrice || 0).toLocaleString("ko")}원</span>
                <span className="text-[10px] text-[var(--text-dim)] w-28 truncate text-right">{it._partner || it._doc}</span>
              </label>
            ))}
        </div>
        <div className="flex items-center justify-end gap-2.5 px-6 py-3 border-t border-[var(--border)]">
          <button onClick={onClose} className="px-5 h-9 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)]">취소</button>
          <button onClick={() => onPick(filtered.filter((_, i) => sel.has(i)).map((it) => { const { _doc, _partner, ...rest } = it; return rest; }))} disabled={sel.size === 0}
            className="px-6 h-9 bg-[var(--primary)] text-white rounded-xl text-sm font-bold disabled:opacity-50">{sel.size}개 추가</button>
        </div>
      </div>
    </div>
  );
}

// ── My품목 — 자주 쓰는 품목 프리셋(회사 설정 저장) ──
function MyItemsPicker({ companyId, currentItems, onClose, onPick }: { companyId: string | null; currentItems: any[]; onClose: () => void; onPick: (items: any[]) => void }) {
  const [presets, setPresets] = useState<any[]>([]);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [loaded, setLoaded] = useState(false);

  const load = async () => {
    if (!companyId) return;
    const { data } = await (supabase as any).from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
    setPresets(Array.isArray(data?.settings?.my_items) ? data.settings.my_items : []);
    setLoaded(true);
  };
  useEffect(() => { load(); /* eslint-disable-next-line */ }, [companyId]);

  const save = async (next: any[]) => {
    setPresets(next);
    if (!companyId) return;
    const { data } = await (supabase as any).from("company_settings").select("id, settings").eq("company_id", companyId).maybeSingle();
    const settings = { ...(data?.settings || {}), my_items: next };
    if (data?.id) await (supabase as any).from("company_settings").update({ settings }).eq("id", data.id);
    else await (supabase as any).from("company_settings").insert({ company_id: companyId, settings });
  };

  const saveCurrent = () => {
    const rows = currentItems.filter((r) => r && r.name);
    if (!rows.length) return;
    const keys = new Set(presets.map((p) => `${p.name}|${p.unitPrice || 0}`));
    const add = rows.filter((r) => !keys.has(`${r.name}|${r.unitPrice || 0}`)).map((r) => ({ name: r.name, spec: r.spec || "", unitPrice: Number(r.unitPrice) || 0, code: r.code || "" }));
    save([...presets, ...add]);
  };
  const remove = (i: number) => save(presets.filter((_, j) => j !== i));
  const toggle = (i: number) => setSel((p) => { const n = new Set(p); n.has(i) ? n.delete(i) : n.add(i); return n; });

  useModalKeys(true, onClose, sel.size === 0 ? undefined : () => onPick(presets.filter((_, i) => sel.has(i)).map((p) => ({ name: p.name, spec: p.spec || "", unitPrice: p.unitPrice || 0, code: p.code || "", quantity: 1 }))));

  return (
    <div className="my-items-picker-modal" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
          <h3 className="text-base font-bold">My품목 (자주 쓰는 품목)</h3>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>
        <div className="px-6 py-2 border-b border-[var(--border)] flex items-center justify-between text-xs">
          <button onClick={saveCurrent} className="text-[var(--primary)] hover:underline font-semibold">＋ 현재 품목을 My품목에 저장</button>
          <span className="text-[var(--text-dim)]">{presets.length}개</span>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-2">
          {!loaded ? <div className="p-8 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
            : presets.length === 0 ? <div className="p-8 text-center text-sm text-[var(--text-muted)]">저장된 My품목이 없습니다.<br /><span className="text-xs">위 "현재 품목을 My품목에 저장"으로 등록하세요.</span></div>
            : presets.map((it, i) => (
              <div key={i} className="flex items-center gap-3 px-3 py-2 rounded-lg hover:bg-[var(--bg-surface)] text-xs">
                <input type="checkbox" checked={sel.has(i)} onChange={() => toggle(i)} className="accent-[var(--primary)] cursor-pointer" />
                <span className="flex-1 font-medium">{it.name}{it.spec ? <span className="text-[var(--text-dim)] ml-1">/ {it.spec}</span> : null}</span>
                <span className="mono-number text-[var(--text-muted)]">{Number(it.unitPrice || 0).toLocaleString("ko")}원</span>
                <button onClick={() => remove(i)} className="text-[var(--text-dim)] hover:text-red-500" title="삭제">✕</button>
              </div>
            ))}
        </div>
        <div className="flex items-center justify-end gap-2.5 px-6 py-3 border-t border-[var(--border)]">
          <button onClick={onClose} className="px-5 h-9 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)]">취소</button>
          <button onClick={() => onPick(presets.filter((_, i) => sel.has(i)).map((p) => ({ name: p.name, spec: p.spec || "", unitPrice: p.unitPrice || 0, code: p.code || "", quantity: 1 })))} disabled={sel.size === 0}
            className="px-6 h-9 bg-[var(--primary)] text-white rounded-xl text-sm font-bold disabled:opacity-50">{sel.size}개 추가</button>
        </div>
      </div>
    </div>
  );
}

// 열 편집 모달 — 표준 컬럼 토글 + 커스텀 컬럼 추가/삭제
function ColumnEditor({ cols, onClose, onSave }: { cols: QuoteCol[]; onClose: () => void; onSave: (cols: QuoteCol[]) => void }) {
  const [active, setActive] = useState<QuoteCol[]>(cols);
  const [newLabel, setNewLabel] = useState("");
  const [newType, setNewType] = useState<"text" | "number">("text");

  const hasKey = (key: string) => active.some((c) => c.key === key);
  const toggleStd = (col: QuoteCol) => {
    if (col.key === "name") return; // 품목명 필수
    setActive((prev) => hasKey(col.key) ? prev.filter((c) => c.key !== col.key) : [...prev, col]);
  };
  const addCustom = () => {
    const label = newLabel.trim();
    if (!label) return;
    const key = "c_" + label.replace(/\s+/g, "_") + "_" + active.length;
    setActive((prev) => [...prev, { key, label, type: newType, custom: true }]);
    setNewLabel("");
  };
  const removeCol = (key: string) => { if (key !== "name") setActive((prev) => prev.filter((c) => c.key !== key)); };
  const move = (idx: number, dir: -1 | 1) => {
    setActive((prev) => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });
  };

  useModalKeys(true, onClose, () => onSave(active));

  return (
    <div className="column-editor-modal" onClick={onClose}>
      <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-lg max-h-[85vh] overflow-y-auto p-6" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold">품목 열 편집</h3>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none">✕</button>
        </div>

        <div className="mb-4">
          <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">표준 항목 (체크 = 사용)</div>
          <div className="grid grid-cols-2 gap-1.5">
            {STANDARD_COLS.map((c) => (
              <label key={c.key} className={`flex items-center gap-2 px-2.5 py-1.5 rounded-lg border text-xs cursor-pointer ${hasKey(c.key) ? "border-[var(--primary)] bg-[var(--primary)]/5" : "border-[var(--border)]"} ${c.key === "name" ? "opacity-60 cursor-not-allowed" : ""}`}>
                <input type="checkbox" checked={hasKey(c.key)} disabled={c.key === "name"} onChange={() => toggleStd(c)} className="accent-[var(--primary)]" />
                {c.label}{c.type === "calc" && <span className="text-[9px] text-[var(--text-dim)]">(자동)</span>}
              </label>
            ))}
          </div>
        </div>

        <div className="mb-4">
          <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">현재 순서 (▲▼로 이동, ✕로 제거)</div>
          <div className="space-y-1">
            {active.map((c, i) => (
              <div key={c.key} className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] text-xs">
                <span className="flex-1">{c.label}{c.custom && <span className="ml-1 text-[9px] text-[var(--primary)]">커스텀</span>}{c.type === "calc" && <span className="ml-1 text-[9px] text-[var(--text-dim)]">자동계산</span>}</span>
                <button onClick={() => move(i, -1)} className="text-[var(--text-dim)] hover:text-[var(--text)]" title="위로">▲</button>
                <button onClick={() => move(i, 1)} className="text-[var(--text-dim)] hover:text-[var(--text)]" title="아래로">▼</button>
                {c.key !== "name" && <button onClick={() => removeCol(c.key)} className="text-[var(--text-dim)] hover:text-red-500" title="제거">✕</button>}
              </div>
            ))}
          </div>
        </div>

        <div className="mb-5">
          <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">커스텀 항목 추가</div>
          <div className="flex items-center gap-2">
            <input value={newLabel} onChange={(e) => setNewLabel(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") addCustom(); }} placeholder="항목 이름 (예: 할인율, 납기)" className="flex-1 h-9 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
            <select value={newType} onChange={(e) => setNewType(e.target.value as "text" | "number")} className="h-9 px-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm">
              <option value="text">텍스트</option>
              <option value="number">숫자</option>
            </select>
            <button onClick={addCustom} className="h-9 px-4 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm font-semibold hover:border-[var(--primary)]">추가</button>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2.5">
          <button onClick={onClose} className="px-5 h-10 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)]">취소</button>
          <button onClick={() => onSave(active)} className="px-6 h-10 bg-[var(--primary)] text-white rounded-xl text-sm font-bold hover:brightness-110">저장</button>
        </div>
        <p className="text-[10px] text-[var(--text-dim)] mt-3">※ 이 설정은 회사 전체 견적서에 적용됩니다. 공급가액·부가세·합계는 수량×단가로 자동 계산됩니다.</p>
      </div>
    </div>
  );
}
