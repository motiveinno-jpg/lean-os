"use client";

// 회사 양식 PDF 관리 (2026-06-29, P2 진입점) — 업로드 → 자동인식 → 매핑 보정 → 저장·활성.
//   견적/계약 생성 시 활성 양식이 있으면 오버레이로 회사 실제 디자인 재현(없으면 현행 폴백).

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import FormTemplateEditor from "@/components/form-template-editor";
import {
  rasterizePdf, detectFields, uploadTemplateFile, saveFormTemplate, setActiveTemplate,
  listFormTemplates, deleteFormTemplate, type DocType, type OverlayField, type PdfFormTemplate,
} from "@/lib/form-templates";

const DOC_LABEL: Record<DocType, string> = { quote: "견적서", contract: "전자계약" };

export function FormTemplateManager({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [docType, setDocType] = useState<DocType>("quote");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // 인식 후 에디터에 넘길 상태
  const [editing, setEditing] = useState<null | {
    pageImages: string[]; pageSizes: { w: number; h: number }[]; fields: OverlayField[]; filePath: string; pageCount: number;
  }>(null);

  const { data: templates = [] } = useQuery({
    queryKey: ["form-templates", companyId],
    queryFn: () => listFormTemplates(),
    enabled: !!companyId,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["form-templates", companyId] });

  const onFile = async (file: File) => {
    if (!companyId) return;
    if (!name.trim()) { toast("양식 이름을 먼저 입력하세요", "error"); return; }
    if (file.type !== "application/pdf") { toast("PDF 파일만 업로드할 수 있습니다", "error"); return; }
    setBusy(true);
    try {
      const { pages, pageSizes } = await rasterizePdf(file);
      const detected = await detectFields(docType, pages);
      const filePath = await uploadTemplateFile(companyId, file);
      setEditing({
        pageImages: pages.map((b) => `data:image/png;base64,${b}`),
        pageSizes, fields: detected, filePath, pageCount: pages.length,
      });
      toast(detected.length > 0 ? `${detected.length}개 필드 자동 인식 — 위치를 보정하세요` : "필드를 직접 추가·배치하세요", "info");
    } catch (e: any) {
      toast("처리 실패: " + (e?.message || ""), "error");
    } finally { setBusy(false); }
  };

  const onSaveFields = async (fields: OverlayField[]) => {
    if (!companyId || !editing) return;
    try {
      const t = await saveFormTemplate({ companyId, name: name.trim(), docType, filePath: editing.filePath, pageCount: editing.pageCount, pageSizes: editing.pageSizes, fields });
      await setActiveTemplate(companyId, docType, t.id);
      toast(`'${name.trim()}' 양식을 저장하고 활성화했습니다`, "success");
      setEditing(null); setName(""); refresh();
    } catch (e: any) { toast("저장 실패: " + (e?.message || ""), "error"); }
  };

  const activate = async (t: PdfFormTemplate) => {
    if (!companyId) return;
    try { await setActiveTemplate(companyId, t.doc_type, t.id); toast("활성 양식으로 지정했습니다", "success"); refresh(); }
    catch (e: any) { toast("지정 실패: " + (e?.message || ""), "error"); }
  };
  const remove = async (t: PdfFormTemplate) => {
    if (!confirm(`'${t.name}' 양식을 삭제할까요? (원본 PDF도 함께 삭제)`)) return;
    try { await deleteFormTemplate(t.id, t.file_path); toast("삭제했습니다", "info"); refresh(); }
    catch (e: any) { toast("삭제 실패: " + (e?.message || ""), "error"); }
  };

  if (!companyId) return null;
  const byType = (dt: DocType) => (templates as PdfFormTemplate[]).filter((t) => t.doc_type === dt);

  return (
    <div className="glass-card p-5">
      <h2 className="text-base font-bold text-[var(--text)] mb-1">회사 양식 PDF</h2>
      <p className="text-xs text-[var(--text-muted)] mb-4">회사가 쓰던 견적서·전자계약 PDF를 올리면 인식해서, 견적/계약 생성 시 그 디자인 그대로 값만 채워 출력합니다. 활성 양식이 없으면 기본 디자인으로 생성됩니다.</p>

      {/* 업로드 폼 */}
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div>
          <label className="block text-[11px] text-[var(--text-muted)] mb-1">종류</label>
          <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)} className="h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm">
            <option value="quote">견적서</option>
            <option value="contract">전자계약</option>
          </select>
        </div>
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[11px] text-[var(--text-muted)] mb-1">양식 이름</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 2026 표준 견적서" className="w-full h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm" />
        </div>
        <label className={`h-9 px-4 inline-flex items-center rounded-lg text-sm font-semibold cursor-pointer ${busy ? "bg-[var(--bg-surface)] text-[var(--text-dim)]" : "bg-[var(--primary)] text-white hover:opacity-90"}`}>
          {busy ? "처리 중…" : "PDF 업로드"}
          <input type="file" accept="application/pdf" className="hidden" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        </label>
      </div>

      {/* 양식 목록 */}
      {(["quote", "contract"] as DocType[]).map((dt) => (
        <div key={dt} className="mb-3">
          <div className="text-xs font-bold text-[var(--text-muted)] mb-1.5">{DOC_LABEL[dt]} 양식</div>
          {byType(dt).length === 0 ? (
            <div className="text-xs text-[var(--text-dim)] px-1 py-2">등록된 양식이 없습니다 (기본 디자인 사용 중).</div>
          ) : (
            <div className="space-y-1.5">
              {byType(dt).map((t) => (
                <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
                  <span className="flex-1 text-sm text-[var(--text)] font-medium truncate">{t.name}
                    <span className="ml-1 text-[10px] text-[var(--text-dim)]">{t.page_count}p · 필드 {t.fields?.length || 0}</span>
                  </span>
                  {t.is_active
                    ? <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">활성</span>
                    : <button onClick={() => activate(t)} className="text-xs px-2 py-1 rounded text-[var(--primary)] hover:bg-[var(--primary)]/10">활성화</button>}
                  <button onClick={() => remove(t)} className="text-xs px-2 py-1 rounded text-[var(--danger)] hover:bg-[var(--danger)]/10">삭제</button>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}

      {/* 매핑 보정 에디터 (모달) */}
      {editing && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-[var(--bg-card)] rounded-xl max-w-[1000px] w-full max-h-[90vh] overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-bold text-[var(--text)] mb-2">필드 위치 보정 — {DOC_LABEL[docType]} · {name}</div>
            <FormTemplateEditor
              docType={docType}
              pageImages={editing.pageImages}
              pageSizes={editing.pageSizes}
              initialFields={editing.fields}
              onSave={onSaveFields}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>
      )}
    </div>
  );
}
