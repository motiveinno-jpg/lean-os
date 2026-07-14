"use client";

// 회사 양식 PDF 관리 (2026-06-29, P2 진입점) — 업로드 → 자동인식 → 매핑 보정 → 저장·활성.
//   견적/계약 생성 시 활성 양식이 있으면 오버레이로 회사 실제 디자인 재현(없으면 현행 폴백).

import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import FormTemplateEditor from "@/components/form-template-editor";
import { TextTemplateEditorModal } from "@/components/text-template-editor-modal";
import { useModalKeys } from "@/hooks/use-modal-keys";
import {
  rasterizePdf, detectFields, uploadTemplateFile, saveFormTemplate, setActiveTemplate,
  listFormTemplates, deleteFormTemplate, extractPdfText, templateTextToHtml, updateFormTemplateContent,
  type DocType, type OverlayField, type PdfFormTemplate,
} from "@/lib/form-templates";

// 텍스트변환 양식에서 클릭 삽입할 변수 목록 (문서 종류별)
const TEMPLATE_VARS: Record<DocType, string[]> = {
  quote: ["{{거래처명}}", "{{사업자번호}}", "{{대표자}}", "{{작성일자}}", "{{품목}}", "{{수량}}", "{{단가}}", "{{공급가액}}", "{{세액}}", "{{합계금액}}"],
  contract: ["{{거래처명}}", "{{사업자번호}}", "{{대표자}}", "{{계약일자}}", "{{계약금액}}", "{{서명}}"],
  hr_form: ["{{성명}}", "{{주민번호}}", "{{부서}}", "{{직급}}", "{{입사일}}", "{{연봉}}", "{{작성일자}}"],
};

const DOC_LABEL: Record<DocType, string> = { quote: "견적서", contract: "전자계약", hr_form: "인사 양식" };

export function FormTemplateManager({ companyId, only }: { companyId: string | null; only?: DocType }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [docType, setDocType] = useState<DocType>(only ?? "quote");
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  // 인식 후 에디터에 넘길 상태
  const [editing, setEditing] = useState<null | {
    pageImages: string[]; pageSizes: { w: number; h: number }[]; fields: OverlayField[]; filePath: string; pageCount: number;
  }>(null);
  // 텍스트변환 양식 — 리치에디터(표·서식)로 content_html 직접 편집. editId 있으면 기존 양식 재편집.
  const [textEditing, setTextEditing] = useState<null | {
    filePath: string; pageCount: number; initialHtml: string; editId?: string; editName?: string; editDocType?: DocType;
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
    // MIME 은 OS/브라우저에 따라 빈값·octet-stream 일 수 있어 확장자도 함께 허용.
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) { toast("PDF 파일만 업로드할 수 있습니다", "error"); return; }
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

  // 텍스트변환 업로드 → 평문 추출 → 편집 모달
  const onFileText = async (file: File) => {
    if (!companyId) return;
    if (!name.trim()) { toast("양식 이름을 먼저 입력하세요", "error"); return; }
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) { toast("PDF 파일만 업로드할 수 있습니다", "error"); return; }
    setBusy(true);
    try {
      const text = await extractPdfText(file);
      const filePath = await uploadTemplateFile(companyId, file);
      const pageCount = text.split("페이지 구분").length;
      setTextEditing({ filePath, pageCount, initialHtml: templateTextToHtml(text) });
      toast("PDF 텍스트를 추출했습니다 — 내용을 다듬고 {{변수}}를 넣으세요", "info");
    } catch (e: any) {
      toast("텍스트 추출 실패: " + (e?.message || ""), "error");
    } finally { setBusy(false); }
  };

  // 기존 텍스트 양식 재편집 — 저장된 content_html 을 리치에디터로 다시 열기
  const startEditText = (t: PdfFormTemplate) => {
    setTextEditing({
      filePath: t.file_path, pageCount: t.page_count || 1,
      initialHtml: t.content_html || "", editId: t.id, editName: t.name, editDocType: t.doc_type,
    });
  };

  const onSaveText = async (html: string) => {
    if (!companyId || !textEditing) return;
    try {
      if (textEditing.editId) {
        await updateFormTemplateContent(textEditing.editId, html);
        toast(`'${textEditing.editName || "양식"}' 내용을 수정했습니다`, "success");
      } else {
        const t = await saveFormTemplate({
          companyId, name: name.trim(), docType, filePath: textEditing.filePath,
          pageCount: textEditing.pageCount, pageSizes: [], fields: [],
          contentHtml: html, templateMode: "text",
        });
        await setActiveTemplate(companyId, docType, t.id);
        toast(`'${name.trim()}' 텍스트 양식을 저장·활성화했습니다`, "success");
        setName("");
      }
      setTextEditing(null); refresh();
    } catch (e: any) { toast("저장 실패: " + (e?.message || ""), "error"); }
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

  // 매핑 보정 에디터(FormTemplateEditor)는 내부 fields 상태를 자체 관리 — 저장 버튼은 그 안에서만
  // 트리거 가능하므로 여기서는 ESC 닫기만 연결(Enter 저장 확인은 미배선).
  useModalKeys(!!editing, () => setEditing(null));

  if (!companyId) return null;
  const byType = (dt: DocType) => (templates as PdfFormTemplate[]).filter((t) => t.doc_type === dt);

  return (
    <div className="glass-card p-5">
      <h2 className="text-base font-bold text-[var(--text)] mb-1">{only ? `${DOC_LABEL[only]} 양식 PDF` : "회사 양식 PDF"}</h2>
      <p className="text-xs text-[var(--text-muted)] mb-4">회사가 쓰던 {only ? DOC_LABEL[only] : "견적서·전자계약"} PDF를 올리면 자동 인식해서, {only === "contract" ? "계약 서명" : only === "quote" ? "견적" : "견적/계약"} 생성 시 그 디자인 그대로 값(거래처·금액·날짜{only === "contract" ? "·서명" : "·품목"})만 채워 출력합니다. 활성 양식이 없으면 기본 디자인으로 생성됩니다.</p>

      {/* 업로드 폼 */}
      <div className="flex flex-wrap items-end gap-2 mb-4">
        {!only && (
        <div>
          <label className="block text-[11px] text-[var(--text-muted)] mb-1">종류</label>
          <select value={docType} onChange={(e) => setDocType(e.target.value as DocType)} className="h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm">
            <option value="quote">견적서</option>
            <option value="contract">전자계약</option>
          </select>
        </div>
        )}
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[11px] text-[var(--text-muted)] mb-1">양식 이름</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 2026 표준 견적서" className="w-full h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm" />
        </div>
        {/* 텍스트변환이 기본(권장) — 내용 수정·표·서식·{{변수}} 가능. 오버레이는 디자인 100% 보존용 보조. */}
        <label className={`h-9 px-4 inline-flex items-center rounded-lg text-sm font-semibold cursor-pointer ${busy ? "bg-[var(--bg-surface)] text-[var(--text-dim)]" : "bg-[var(--primary)] text-white hover:opacity-90"}`} title="PDF를 편집 가능한 텍스트로 변환 — 내용을 직접 고치고 표·서식·{{변수}}를 넣습니다 (권장)">
          {busy ? "처리 중…" : "PDF 업로드 (텍스트 변환·권장)"}
          <input type="file" accept=".pdf,application/pdf" className="hidden" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileText(f); e.target.value = ""; }} />
        </label>
        <label className={`h-9 px-4 inline-flex items-center rounded-lg text-sm font-semibold cursor-pointer border ${busy ? "border-[var(--border)] text-[var(--text-dim)]" : "border-[var(--primary)]/40 text-[var(--primary)] hover:bg-[var(--primary)]/10"}`} title="PDF 디자인을 배경 이미지로 두고 변수 위치만 지정(원본 100% 보존, 내용 수정 불가)">
          {busy ? "처리 중…" : "디자인 그대로 (오버레이)"}
          <input type="file" accept=".pdf,application/pdf" className="hidden" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        </label>
      </div>

      {/* 양식 목록 */}
      {(only ? [only] : (["quote", "contract"] as DocType[])).map((dt) => (
        <div key={dt} className="mb-3">
          <div className="text-xs font-bold text-[var(--text-muted)] mb-1.5">{DOC_LABEL[dt]} 양식</div>
          {byType(dt).length === 0 ? (
            <div className="text-xs text-[var(--text-dim)] px-1 py-2">등록된 양식이 없습니다 (기본 디자인 사용 중).</div>
          ) : (
            <div className="space-y-1.5">
              {byType(dt).map((t) => (
                <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
                  <span className="flex-1 text-sm text-[var(--text)] font-medium truncate">{t.name}
                    <span className="ml-1 text-[10px] text-[var(--text-dim)]">
                      {t.template_mode === "text" ? "텍스트" : `${t.page_count}p · 필드 ${t.fields?.length || 0}`}
                    </span>
                  </span>
                  {t.template_mode === "text" && (
                    <button onClick={() => startEditText(t)} className="text-xs px-2 py-1 rounded text-[var(--text)] font-medium hover:bg-[var(--bg-card)]">편집</button>
                  )}
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

      {/* 매핑 보정 에디터 (모달) — body 포털(transform/backdrop-filter 조상 회피) */}
      {editing && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
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
        </div>,
        document.body,
      )}

      {/* 텍스트변환 편집 모달 — 리치에디터(표·굵기·정렬·크기) + {{변수}} 삽입 + 실시간 미리보기 */}
      {textEditing && (
        <TextTemplateEditorModal
          title={`${DOC_LABEL[textEditing.editDocType || docType]} · ${textEditing.editName || name}`}
          vars={TEMPLATE_VARS[textEditing.editDocType || docType]}
          initialHtml={textEditing.initialHtml}
          saveLabel={textEditing.editId ? "수정 저장" : "텍스트 양식 저장·활성화"}
          onSave={onSaveText}
          onClose={() => setTextEditing(null)}
        />
      )}
    </div>
  );
}
