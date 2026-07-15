"use client";

// HR 양식관리 — PDF 업로드 → 채울 필드 위치 정의 → 양식으로 저장 (2026-07-01)
//   결정: "빈 양식 필드만 정의"(직원 데이터 자동기입 없음). 여러 양식을 라이브러리로 보관.
//   견적/계약 PDF오버레이 인프라(rasterizePdf·FormTemplateEditor·fillFormTemplate) 재사용.
//   견적/계약과 달리 '활성 1개' 개념 없음 → setActiveTemplate 미사용, doc_type='hr_form' 로 다중 저장.
//   활용: 저장한 양식에 값을 직접 입력해 채워 출력하거나, 빈 양식을 내려받아 손으로 작성.

import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import FormTemplateEditor from "@/components/form-template-editor";
import { TextTemplateEditorModal } from "@/components/text-template-editor-modal";
import { fillFormTemplate } from "@/lib/pdf-overlay";
import {
  rasterizePdf, uploadTemplateFile, saveFormTemplate, updateFormTemplateFields, listFormTemplates, deleteFormTemplate,
  downloadTemplateFile, extractPdfText, templateTextToHtml, fillTextTemplate, wrapTemplatePrintHtml, updateFormTemplateContent,
  type OverlayField, type PdfFormTemplate,
} from "@/lib/form-templates";
import { useModalKeys } from "@/hooks/use-modal-keys";

const HR_VARS = ["{{성명}}", "{{주민번호}}", "{{부서}}", "{{직급}}", "{{입사일}}", "{{연봉}}", "{{연락처}}", "{{주소}}", "{{작성일자}}"];
// content_html 의 {{키}} 목록 추출
function contentVarKeys(html: string): string[] {
  return [...new Set([...html.matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)].map((m) => m[1].trim()))];
}
async function renderHtmlPdf(html: string): Promise<Blob> {
  const res = await fetch("/api/html-pdf", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ html }) });
  if (!res.ok) {
    // 2026-07-15 QA: 서버가 준 실제 오류(err.message)를 버리고 항상 "PDF 렌더 실패"만 던져서
    //   원인 파악이 불가능했음 — 응답 JSON의 error 를 읽어 그대로 노출.
    const body = await res.json().catch(() => null);
    throw new Error(body?.error || `PDF 렌더 실패 (HTTP ${res.status})`);
  }
  return res.blob();
}

function downloadPdf(bytes: Uint8Array | ArrayBuffer, filename: string) {
  const blob = new Blob([bytes as BlobPart], { type: "application/pdf" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename.endsWith(".pdf") ? filename : `${filename}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

export function HrFormManager({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [editing, setEditing] = useState<null | {
    pageImages: string[]; pageSizes: { w: number; h: number }[]; filePath: string; pageCount: number;
    initialFields?: OverlayField[]; editId?: string;
  }>(null);
  const [filling, setFilling] = useState<null | { tpl: PdfFormTemplate; values: Record<string, string> }>(null);
  // 텍스트변환 양식 — 리치에디터(표·서식)로 content_html 직접 편집. editId 있으면 기존 양식 재편집.
  const [textEditing, setTextEditing] = useState<null | {
    filePath: string; pageCount: number; initialHtml: string; editId?: string; editName?: string;
  }>(null);

  const { data: templates = [] } = useQuery({
    queryKey: ["hr-form-templates", companyId],
    queryFn: () => listFormTemplates("hr_form"),
    enabled: !!companyId,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["hr-form-templates", companyId] });

  const onFile = async (file: File) => {
    if (!companyId) return;
    if (!name.trim()) { toast("양식 이름을 먼저 입력하세요", "error"); return; }
    const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
    if (!isPdf) { toast("PDF 파일만 업로드할 수 있습니다", "error"); return; }
    setBusy(true);
    try {
      const { pages, pageSizes } = await rasterizePdf(file);
      const filePath = await uploadTemplateFile(companyId, file);
      // 빈 필드로 시작 — 사용자가 채울 위치를 직접 지정(자동 인식 없음).
      setEditing({ pageImages: pages.map((b) => `data:image/png;base64,${b}`), pageSizes, filePath, pageCount: pages.length });
      toast("채울 필드 위치를 추가·배치하세요", "info");
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
      setTextEditing({ filePath, pageCount: text.split("페이지 구분").length, initialHtml: templateTextToHtml(text) });
      toast("PDF 텍스트를 추출했습니다 — 내용을 다듬고 {{변수}}를 넣으세요", "info");
    } catch (e: any) { toast("텍스트 추출 실패: " + (e?.message || ""), "error"); }
    finally { setBusy(false); }
  };
  const onSaveText = async (html: string) => {
    if (!companyId || !textEditing) return;
    try {
      if (textEditing.editId) {
        await updateFormTemplateContent(textEditing.editId, html);
        toast(`'${textEditing.editName || "양식"}' 내용을 수정했습니다`, "success");
      } else {
        await saveFormTemplate({
          companyId, name: name.trim(), docType: "hr_form", filePath: textEditing.filePath,
          pageCount: textEditing.pageCount, pageSizes: [], fields: [],
          contentHtml: html, templateMode: "text",
        });
        toast(`'${name.trim()}' 텍스트 양식을 저장했습니다`, "success");
        setName("");
      }
      setTextEditing(null); refresh();
    } catch (e: any) { toast("저장 실패: " + (e?.message || ""), "error"); }
  };

  const onSaveFields = async (fields: OverlayField[]) => {
    if (!companyId || !editing) return;
    try {
      if (editing.editId) {
        // 기존 양식 재편집 — 필드만 갱신(원본 PDF 유지)
        await updateFormTemplateFields(editing.editId, fields);
        toast(`'${name.trim() || "양식"}' 필드를 수정했습니다`, "success");
      } else {
        await saveFormTemplate({
          companyId, name: name.trim(), docType: "hr_form",
          filePath: editing.filePath, pageCount: editing.pageCount, pageSizes: editing.pageSizes, fields,
        });
        toast(`'${name.trim()}' 양식을 저장했습니다`, "success");
      }
      setEditing(null); setName(""); refresh();
    } catch (e: any) { toast("저장 실패: " + (e?.message || ""), "error"); }
  };

  // 저장된 양식 재편집 — 텍스트 양식은 리치에디터로, 오버레이는 원본 PDF 재래스터 후 필드 에디터로.
  const startEdit = async (t: PdfFormTemplate) => {
    if (!companyId || busy) return;
    if (t.template_mode === "text") {
      setTextEditing({
        filePath: t.file_path, pageCount: t.page_count || 1,
        initialHtml: t.content_html || "", editId: t.id, editName: t.name,
      });
      return;
    }
    setBusy(true);
    try {
      const buf = await downloadTemplateFile(t.file_path);
      const file = new File([buf], `${t.name || "form"}.pdf`, { type: "application/pdf" });
      const { pages, pageSizes } = await rasterizePdf(file);
      setName(t.name || "");
      setEditing({
        pageImages: pages.map((b) => `data:image/png;base64,${b}`),
        pageSizes, filePath: t.file_path, pageCount: t.page_count || pages.length,
        initialFields: t.fields || [], editId: t.id,
      });
      toast("필드를 수정한 뒤 저장하세요", "info");
    } catch (e: any) {
      toast("편집 열기 실패: " + (e?.message || ""), "error");
    } finally { setBusy(false); }
  };

  const remove = async (t: PdfFormTemplate) => {
    if (!confirm(`'${t.name}' 양식을 삭제할까요? (원본 PDF도 함께 삭제)`)) return;
    try { await deleteFormTemplate(t.id, t.file_path); toast("삭제했습니다", "info"); refresh(); }
    catch (e: any) { toast("삭제 실패: " + (e?.message || ""), "error"); }
  };

  const downloadBlank = async (t: PdfFormTemplate) => {
    try { const bytes = await downloadTemplateFile(t.file_path); downloadPdf(bytes, t.name); }
    catch (e: any) { toast("다운로드 실패: " + (e?.message || ""), "error"); }
  };

  // 채우기 대상 필드(서명·품목표 제외 — 손서명/미해당)
  const fillableFields = (t: PdfFormTemplate) => (t.fields || []).filter((f) => f.kind !== "signature" && f.kind !== "items_table");
  // 채우기 모달에 표시할 입력 키 — 텍스트양식이면 content_html 의 {{변수}}, 아니면 오버레이 필드
  const fillKeys = (t: PdfFormTemplate): { key: string; label: string }[] =>
    t.template_mode === "text" && t.content_html
      ? contentVarKeys(t.content_html).map((k) => ({ key: k, label: k }))
      : fillableFields(t).map((f) => ({ key: f.key, label: f.label || f.key }));

  const exportFilled = async () => {
    if (!filling) return;
    try {
      const t = filling.tpl;
      if (t.template_mode === "text" && t.content_html) {
        const blob = await renderHtmlPdf(wrapTemplatePrintHtml(fillTextTemplate(t.content_html, filling.values)));
        downloadPdf(await blob.arrayBuffer(), `${t.name}_작성본`);
        setFilling(null);
        return;
      }
      const bytes = await downloadTemplateFile(t.file_path);
      const out = await fillFormTemplate(bytes, t.fields || [], { values: filling.values });
      downloadPdf(out, `${t.name}_작성본`);
      setFilling(null);
    } catch (e: any) { toast("출력 실패: " + (e?.message || ""), "error"); }
  };

  // ESC 닫기. 필드 배치 에디터(editing)는 확인 액션이 하위 FormTemplateEditor 내부(onSave)로 위임돼
  //   있어 여기서 Enter 확인은 바인딩하지 않음(라벨 입력 등 내부 폼과 충돌 우려). 채우기 모달은 출력 버튼으로 확인.
  useModalKeys(!!editing, () => setEditing(null));
  useModalKeys(!!filling, () => setFilling(null), filling ? exportFilled : undefined);

  if (!companyId) return null;
  const list = templates as PdfFormTemplate[];

  return (
    <div className="glass-card p-5">
      <h2 className="text-base font-bold text-[var(--text)] mb-1">인사 양식 (PDF)</h2>
      <p className="text-xs text-[var(--text-muted)] mb-4">
        회사에서 쓰는 근로계약서·각종 신청서 등 PDF를 올리면, 채울 위치(필드)를 지정해 재사용 양식으로 저장합니다.
        저장한 양식에 값을 입력해 채워 출력하거나, 빈 양식을 내려받아 손으로 작성할 수 있습니다.
      </p>

      {/* 업로드 폼 */}
      <div className="flex flex-wrap items-end gap-2 mb-4">
        <div className="flex-1 min-w-[160px]">
          <label className="block text-[11px] text-[var(--text-muted)] mb-1">양식 이름</label>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 표준 근로계약서"
            className="w-full h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm" />
        </div>
        {/* 텍스트변환이 기본(권장) — 내용 수정·표·서식·{{변수}} 가능. 오버레이는 디자인 100% 보존용 보조. */}
        <label className={`h-9 px-4 inline-flex items-center rounded-lg text-sm font-semibold cursor-pointer ${busy ? "bg-[var(--bg-surface)] text-[var(--text-dim)]" : "bg-[var(--primary)] text-white hover:opacity-90"}`} title="PDF를 편집 가능한 텍스트로 변환 — 내용을 고치고 표·서식·{{변수}}를 넣습니다 (권장)">
          {busy ? "처리 중…" : "PDF 업로드 (텍스트 변환·권장)"}
          <input type="file" accept=".pdf,application/pdf" className="hidden" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFileText(f); e.target.value = ""; }} />
        </label>
        <label className={`h-9 px-4 inline-flex items-center rounded-lg text-sm font-semibold cursor-pointer border ${busy ? "border-[var(--border)] text-[var(--text-dim)]" : "border-[var(--primary)]/40 text-[var(--primary)] hover:bg-[var(--primary)]/10"}`} title="PDF 배경 위에 채울 필드 위치를 지정(원본 100% 보존, 내용 수정 불가)">
          {busy ? "처리 중…" : "디자인 그대로 (오버레이)"}
          <input type="file" accept=".pdf,application/pdf" className="hidden" disabled={busy}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ""; }} />
        </label>
      </div>

      {/* 양식 목록 */}
      {list.length === 0 ? (
        <div className="text-xs text-[var(--text-dim)] px-1 py-2">등록된 인사 양식이 없습니다.</div>
      ) : (
        <div className="space-y-1.5">
          {list.map((t) => (
            <div key={t.id} className="flex items-center gap-2 px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)]">
              <span className="flex-1 text-sm text-[var(--text)] font-medium truncate">{t.name}
                <span className="ml-1 text-[10px] text-[var(--text-dim)]">
                  {t.template_mode === "text" ? "텍스트" : `${t.page_count}p · 필드 ${t.fields?.length || 0}`}
                </span>
              </span>
              <button onClick={() => startEdit(t)} disabled={busy} className="text-xs px-2 py-1 rounded text-[var(--text)] font-medium hover:bg-[var(--bg-card)] disabled:opacity-50">편집</button>
              <button onClick={() => setFilling({ tpl: t, values: {} })} className="text-xs px-2 py-1 rounded text-[var(--primary)] hover:bg-[var(--primary)]/10">채우기·출력</button>
              <button onClick={() => downloadBlank(t)} className="text-xs px-2 py-1 rounded text-[var(--text-muted)] hover:bg-[var(--bg-card)]">빈 양식</button>
              <button onClick={() => remove(t)} className="text-xs px-2 py-1 rounded text-[var(--danger)] hover:bg-[var(--danger)]/10">삭제</button>
            </div>
          ))}
        </div>
      )}

      {/* 필드 배치 에디터 (모달) */}
      {editing && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="bg-[var(--bg-card)] rounded-xl max-w-[1000px] w-full max-h-[90vh] overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-bold text-[var(--text)] mb-2">채울 필드 위치 지정 — {name}</div>
            <FormTemplateEditor
              docType="hr_form"
              pageImages={editing.pageImages}
              pageSizes={editing.pageSizes}
              initialFields={editing.initialFields || []}
              onSave={onSaveFields}
              onCancel={() => setEditing(null)}
            />
          </div>
        </div>,
        document.body,
      )}

      {/* 채우기 모달 */}
      {filling && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={() => setFilling(null)}>
          <div className="bg-[var(--bg-card)] rounded-xl max-w-md w-full max-h-[85vh] overflow-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="text-sm font-bold text-[var(--text)] mb-3">{filling.tpl.name} — 값 입력</div>
            {fillKeys(filling.tpl).length === 0 ? (
              <div className="text-xs text-[var(--text-dim)] mb-3">채울 수 있는 필드가 없습니다. 빈 양식을 내려받아 손으로 작성하세요.</div>
            ) : (
              <div className="space-y-2 mb-4">
                {fillKeys(filling.tpl).map((f, i) => (
                  <div key={i}>
                    <label className="block text-[11px] text-[var(--text-muted)] mb-1">{f.label}</label>
                    <input
                      value={filling.values[f.key] ?? ""}
                      onChange={(e) => setFilling((s) => s && ({ ...s, values: { ...s.values, [f.key]: e.target.value } }))}
                      className="w-full h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm"
                    />
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <button onClick={() => setFilling(null)} className="flex-1 py-2 rounded-lg border border-[var(--border)] text-sm text-[var(--text-muted)]">취소</button>
              <button onClick={exportFilled} className="flex-1 py-2 rounded-lg bg-[var(--primary)] text-white text-sm font-semibold">채워서 PDF 출력</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* 텍스트변환 편집 모달 — 리치에디터(표·굵기·정렬·크기) + {{변수}} 삽입 + 실시간 미리보기 */}
      {textEditing && (
        <TextTemplateEditorModal
          title={`인사 · ${textEditing.editName || name}`}
          vars={HR_VARS}
          initialHtml={textEditing.initialHtml}
          saveLabel={textEditing.editId ? "수정 저장" : "텍스트 양식 저장"}
          onSave={onSaveText}
          onClose={() => setTextEditing(null)}
        />
      )}
    </div>
  );
}
