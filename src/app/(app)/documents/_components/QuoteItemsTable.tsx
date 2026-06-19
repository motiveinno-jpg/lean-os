"use client";

// 견적서 품목 입력 테이블 — 회사별 컬럼 커스터마이징(수량·단가·부가세·적요·비고 등 자유 추가/삭제) + 자동계산.
//   컬럼 설정은 company_settings.settings.quote_columns(jsonb)에 회사별 저장.
import { useState, useEffect, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { CurrencyInput } from "@/components/currency-input";

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
  { key: "totalAmount", label: "합계", type: "calc", calc: "total" },
  { key: "note", label: "비고", type: "text" },
];

const DEFAULT_KEYS = ["name", "spec", "quantity", "unitPrice", "supplyAmount", "taxAmount", "summary", "totalAmount"];
const DEFAULT_COLS: QuoteCol[] = STANDARD_COLS.filter((c) => DEFAULT_KEYS.includes(c.key));

function calcRow(row: any): any {
  const q = Number(row.quantity) || 0;
  const u = Number(row.unitPrice) || 0;
  const supply = Math.round(q * u);
  const tax = Math.round(supply * 0.1);
  return { ...row, supplyAmount: supply, taxAmount: tax, totalAmount: supply + tax, unitPriceVat: Math.round(u * 1.1) };
}

export function QuoteItemsTable({
  items, onChange, companyId, editable,
}: { items: any[]; onChange: (items: any[]) => void; companyId: string | null; editable: boolean }) {
  const [cols, setCols] = useState<QuoteCol[]>(DEFAULT_COLS);
  const [showEditor, setShowEditor] = useState(false);

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
  const setRow = (idx: number, patch: any) => onChange(rows.map((r, i) => (i === idx ? calcRow({ ...r, ...patch }) : r)));
  const addRow = () => onChange([...rows, {}]);
  const delRow = (idx: number) => onChange(rows.length > 1 ? rows.filter((_, i) => i !== idx) : [{}]);

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
    <div>
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-[var(--text-dim)] font-medium">품목 목록</span>
        {editable && (
          <div className="flex items-center gap-2">
            <button onClick={() => setShowEditor(true)} className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)] border border-[var(--border)] rounded px-2 py-0.5">⚙️ 열 편집</button>
            <button onClick={addRow} className="text-xs text-[var(--primary)] hover:underline">+ 품목 추가</button>
          </div>
        )}
      </div>
      <div className="overflow-x-auto border border-[var(--border)] rounded-lg">
        <table className="w-full text-xs border-collapse">
          <thead>
            <tr className="bg-[var(--bg-surface)] text-[var(--text-dim)] border-b border-[var(--border)]">
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
                {cols.map((c) => (
                  <td key={c.key} className={`px-2 py-1 ${c.type === "text" ? "" : "text-right"}`}>
                    {c.type === "calc" ? (
                      <span className="mono-number text-[var(--text)]">{fmt(item[c.key])}</span>
                    ) : !editable ? (
                      <span className={c.type === "number" ? "mono-number" : ""}>{c.type === "number" ? fmt(item[c.key]) : (item[c.key] || "")}</span>
                    ) : c.type === "number" ? (
                      <CurrencyInput
                        value={item[c.key] ?? ""}
                        onValueChange={(raw) => setRow(idx, { [c.key]: raw })}
                        placeholder="0"
                        className="w-full px-1.5 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-right font-mono focus:outline-none focus:border-[var(--primary)]"
                      />
                    ) : (
                      <input
                        value={item[c.key] || ""}
                        onChange={(e) => setRow(idx, { [c.key]: e.target.value })}
                        className="w-full px-1.5 py-1 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]"
                      />
                    )}
                  </td>
                ))}
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
              <td className="px-2 py-2 text-center">∑</td>
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

      {showEditor && (
        <ColumnEditor cols={cols} onClose={() => setShowEditor(false)} onSave={(next) => { saveCols(next); setShowEditor(false); }} />
      )}
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

  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
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
