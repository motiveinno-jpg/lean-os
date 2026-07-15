"use client";

// 텍스트변환 양식 공용 편집 모달 (2026-07-10) — 견적서·계약서·인사 양식 공용.
//   사장님 QA: "편집화면이 어렵고 표나 글자서식 설정도 없어" → 평문 textarea 를 버리고
//   기존 RichEditor(TipTap: 표·굵기·정렬·색·크기·이미지)를 재사용. {{변수}}는 버튼으로 커서에 삽입.
//   content_html 을 직접 편집·저장하므로 굵기/표가 발급 PDF(wrapTemplatePrintHtml)에 그대로 반영.

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RichEditor, type RichEditorRef } from "@/components/rich-editor";
import { fillTextTemplate } from "@/lib/form-templates";
import { useModalKeys } from "@/hooks/use-modal-keys";

export function TextTemplateEditorModal({ title, vars, initialHtml, saveLabel, onSave, onClose }: {
  title: string;
  vars: string[];                       // 클릭 삽입할 {{변수}} 버튼 목록
  initialHtml: string;                  // 시작 HTML (신규=PDF 추출 변환본, 편집=저장된 content_html)
  saveLabel?: string;
  onSave: (html: string) => Promise<void> | void;
  onClose: () => void;
}) {
  const [html, setHtml] = useState(initialHtml);
  const [saving, setSaving] = useState(false);
  const [showPreview, setShowPreview] = useState(true);
  const editorRef = useRef<RichEditorRef>(null);

  const insertVar = (v: string) => editorRef.current?.insertText(v);

  const save = async () => {
    setSaving(true);
    try { await onSave(html); } finally { setSaving(false); }
  };

  // 리치에디터(Tiptap, contenteditable) 안의 줄바꿈용 Enter는 저장으로 새지 않게 제외.
  useModalKeys(true, onClose, saving ? undefined : () => {
    const ae = document.activeElement as HTMLElement | null;
    if (ae?.isContentEditable) return;
    save();
  });

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[var(--bg-card)] rounded-xl max-w-[1100px] w-full max-h-[94vh] overflow-auto p-4" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-1">
          <div className="text-sm font-bold text-[var(--text)]">텍스트 양식 편집 — {title}</div>
          <button type="button" onClick={() => setShowPreview((v) => !v)}
            className="text-[11px] px-2 py-1 rounded-md border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">
            {showPreview ? "미리보기 접기" : "미리보기 펼치기"}
          </button>
        </div>
        <p className="text-[11px] text-[var(--text-muted)] mb-2">
          내용을 자유롭게 고치세요 — 굵게·정렬·글자크기·<b>표(▦)</b> 모두 툴바에서. 값이 채워질 자리는 아래 변수 버튼으로 <code>{"{{변수}}"}</code>를 넣으면 발급 시 실제 값으로 채워집니다.
        </p>
        <div className="flex flex-wrap gap-1 mb-2">
          {vars.map((v) => (
            <button key={v} type="button" onClick={() => insertVar(v)}
              className="text-[11px] px-2 py-1 rounded-md bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--primary)] hover:bg-[var(--primary)]/10 font-medium">{v}</button>
          ))}
        </div>
        <div className={`grid gap-3 ${showPreview ? "lg:grid-cols-2" : "grid-cols-1"}`}>
          <div>
            <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1">편집</div>
            <RichEditor ref={editorRef} content={initialHtml} onChange={setHtml} placeholder="양식 내용을 입력하세요..." maxHeight="52vh" />
          </div>
          {showPreview && (
            <div>
              <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-1">발급 미리보기 <span className="text-[var(--text-dim)]">(변수는 발급 시 값으로 채워짐)</span></div>
              <div className="tpl-preview w-full max-h-[58vh] min-h-[300px] px-4 py-3 rounded-xl bg-white text-black border border-[var(--border)] overflow-auto text-[13px] leading-relaxed"
                style={{ fontFamily: "'Pretendard', system-ui, sans-serif" }}
                dangerouslySetInnerHTML={{ __html: fillTextTemplate(html, {}, { highlightMissing: true }) }} />
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2 mt-3">
          <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">
            {saving ? "저장 중…" : (saveLabel || "텍스트 양식 저장")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
