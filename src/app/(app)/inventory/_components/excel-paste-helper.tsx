"use client";

// ── 붙여넣기 팝업에 붙는 '양식 내려받기 · 파일 고르기' 한 줄 (2026-08-27) ─────────────────
//   엑셀 파일을 고르면 첫 시트를 탭 글자로 바꿔 붙여넣기 칸에 채운다 — 기존 해석기(붙여넣기 규칙)를 그대로 쓴다.

import { useRef } from "react";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { downloadTemplate, excelFileToTsv, type ExcelColumn } from "@/lib/excel-io";

export function ExcelPasteHelper({ cols, templateName, sheetName, guide, onText }: { cols: ExcelColumn[]; templateName: string; sheetName: string; guide?: string[]; onText: (tsv: string) => void }) {
  const { toast } = useToast();
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="inv-bom-base">
      <span className="field-label">엑셀 파일로</span>
      <input ref={ref} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; e.target.value = ""; if (!f) return; try { onText(await excelFileToTsv(f, cols)); } catch (err) { toast(friendlyError(err), "error"); } }} />
      <button type="button" className="btn-secondary btn-sm" onClick={() => downloadTemplate(templateName, sheetName, cols, guide)}>양식 내려받기</button>
      <button type="button" className="btn-secondary btn-sm" onClick={() => ref.current?.click()}>파일 고르기</button>
      <em className="inv-hint">양식에 맞춰 채운 파일을 고르면 아래 칸에 채워집니다 — 붙여넣기와 같은 규칙으로 읽습니다</em>
    </div>
  );
}
