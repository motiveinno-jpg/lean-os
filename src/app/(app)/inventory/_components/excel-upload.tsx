"use client";

// ── 엑셀 올리기 팝업 (공용, 2026-08-27) — 파일 고르기 → 읽어서 검사 → 미리 보기 → 등록 ─────────
//   화면마다 '칸(cols)·한 줄 해석(parse)·미리 보기 줄(preview)·저장(commit)'만 넘긴다. 오류 줄은 등록에서 빠지고 이유를 적는다.
//   등록은 사람이 누른다. 양식은 같은 cols 로 내려받는다(ExcelMenu 의 '양식 내려받기').

import { useRef, useState } from "react";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { readExcelFile, downloadTemplate, type ExcelColumn, type ExcelRow } from "@/lib/excel-io";

export type ParseResult<T> = { ok: T } | { error: string };

export function ExcelUploadDialog<T>({ title, desc, cols, templateName, sheetName, guide, parse, previewHead, previewRow, commit, onClose, onDone }: {
  title: string; desc?: React.ReactNode; cols: ExcelColumn[]; templateName: string; sheetName: string; guide?: string[];
  /** 한 줄을 화면의 저장 단위로 해석. 품목이 없거나 수량이 비면 error */
  parse: (row: ExcelRow, index: number) => ParseResult<T>;
  previewHead: string[];
  previewRow: (item: T) => React.ReactNode[];
  /** 검사 통과 줄을 저장. 돌려주는 글은 토스트로 */
  commit: (items: T[]) => Promise<string>;
  onClose: () => void; onDone?: () => void;
}) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState("");
  const [items, setItems] = useState<T[]>([]);
  const [errors, setErrors] = useState<string[]>([]);
  const [missing, setMissing] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const load = async (f: File) => {
    setBusy(true); setDone(false);
    try {
      const r = await readExcelFile(f, cols);
      setFileName(f.name); setMissing(r.missing);
      const ok: T[] = []; const bad: string[] = [];
      r.rows.forEach((row, i) => { const p = parse(row, i + 2); if ("ok" in p) ok.push(p.ok); else bad.push(`${i + 2}행: ${p.error}`); });
      setItems(ok); setErrors(bad);
      if (!r.rows.length) toast("읽을 줄이 없습니다 — 첫 시트의 둘째 줄부터 데이터를 넣으세요", "error");
    } catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(false); }
  };
  const run = async () => {
    if (!items.length) return;
    setBusy(true);
    try { const msg = await commit(items); toast(msg, "success"); setDone(true); onDone?.(); onClose(); }
    catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(false); }
  };

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">{title} — 엑셀 올리기</h3>
        <p className="inv-modal-desc">{desc || <>오너뷰 양식에 맞춰 채운 파일을 올리면 먼저 읽어서 보여 줍니다. <b>등록</b>을 눌러야 저장됩니다. 머리줄은 양식 그대로 두세요.</>}</p>
        <div className="inv-bom-base">
          <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) load(f); e.target.value = ""; }} />
          <button type="button" className="btn-secondary btn-sm" onClick={() => downloadTemplate(templateName, sheetName, cols, guide)}>양식 내려받기</button>
          <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => fileRef.current?.click()}>파일 고르기</button>
          <span className="ev-dim">{fileName || "아직 고른 파일이 없습니다"}</span>
        </div>
        {missing.length > 0 && <div className="inv-paste-sum"><span className="inv-paste-bad">양식에 없는 필수 칸: {missing.join(", ")} — 양식을 내려받아 그 머리줄을 쓰세요</span></div>}
        {(items.length > 0 || errors.length > 0) && (
          <>
            <div className="inv-paste-sum">
              <b>{items.length}줄 등록 가능</b>
              {errors.length > 0 && <span className="inv-paste-bad"> · 빠지는 줄 {errors.length}: {errors.slice(0, 3).join(" / ")}{errors.length > 3 ? " …" : ""}</span>}
            </div>
            <div className="stg-table-wrap ch-ship-list">
              <table className="ev-table ev-lined table-inv-status-sm">
                <thead><tr>{previewHead.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{items.slice(0, 100).map((it, i) => <tr key={i}>{previewRow(it).map((c, j) => <td key={j} className={j === 0 ? "text-left" : typeof c === "number" ? "tr mono-number" : "text-left"}>{c}</td>)}</tr>)}</tbody>
              </table>
              {items.length > 100 && <p className="inv-foot">앞 100줄만 보입니다 · 등록은 {items.length}줄 전부</p>}
            </div>
          </>
        )}
        <div className="inv-modal-actions">
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy || done || !items.length} onClick={run}>등록 {items.length ? `(${items.length}줄)` : ""}</button>
        </div>
      </div>
    </div>
  );
}
