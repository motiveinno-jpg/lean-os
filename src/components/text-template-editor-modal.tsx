"use client";

// 텍스트변환 양식 공용 편집 모달 (2026-07-10) — 견적서·계약서·인사 양식 공용.
//   사장님 QA: "편집화면이 어렵고 표나 글자서식 설정도 없어" → 평문 textarea 를 버리고
//   기존 RichEditor(TipTap: 표·굵기·정렬·색·크기·이미지)를 재사용. {{변수}}는 버튼으로 커서에 삽입.
//   content_html 을 직접 편집·저장하므로 굵기/표가 발급 PDF(wrapTemplatePrintHtml)에 그대로 반영.
// 2026-07-31 사장님: 옆 미리보기 때문에 편집칸이 좁아 PDF 원본이 가로 스크롤로 잘렸다
//   → 상시 미리보기 제거, 편집기가 전체 폭·높이 사용.
//   (2차) 미리보기는 별도 버튼으로 — '미리보기'를 누르면 미리보기 화면, '양식 저장'은 바로 저장.

import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { RichEditor, type RichEditorRef } from "@/components/rich-editor";
import { fillTextTemplate } from "@/lib/form-templates";
import { sanitizeDocumentHtml } from "@/lib/sanitize-html";
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
  // edit(전체 폭 편집) ↔ preview(발급 미리보기, '미리보기' 버튼으로 진입). 저장은 어느 단계에서든 즉시.
  const [step, setStep] = useState<"edit" | "preview">("edit");
  const editorRef = useRef<RichEditorRef>(null);

  const insertVar = (v: string) => editorRef.current?.insertText(v);

  const save = async () => {
    setSaving(true);
    try { await onSave(html); } finally { setSaving(false); }
  };

  // ESC: 미리보기 단계에선 편집으로 복귀, 편집 단계에선 모달 닫기.
  // Enter: 바로 저장(버튼과 동일). 리치에디터(contenteditable) 줄바꿈 Enter 는 제외.
  useModalKeys(
    true,
    step === "preview" ? () => setStep("edit") : onClose,
    saving ? undefined : () => {
      const ae = document.activeElement as HTMLElement | null;
      if (ae?.isContentEditable) return;
      save();
    },
  );

  if (typeof document === "undefined") return null;
  return createPortal(
    <div className="tpl-editor-overlay fixed inset-0">
      <div className="tpl-editor-panel" onClick={(e) => e.stopPropagation()}>
        <div className="tpl-editor-header">
          <div className="text-sm font-bold text-[var(--text)]">
            {step === "edit" ? "텍스트 양식 편집" : "발급 미리보기"} — {title}
          </div>
        </div>
        {step === "edit" ? (
          <>
            <p className="tpl-editor-hint">
              내용을 자유롭게 고치세요 — 굵게·정렬·글자크기·<b>표(▦)</b> 모두 툴바에서. 값이 채워질 자리는 아래 변수 버튼으로 <code>{"{{변수}}"}</code>를 넣으면 발급 시 실제 값으로 채워집니다. 발급 모습은 &lsquo;미리보기&rsquo; 버튼으로 확인하세요.
            </p>
            <div className="tpl-var-buttons">
              {vars.map((v) => (
                <button key={v} type="button" onClick={() => insertVar(v)}
                  className="text-[11px] px-2 py-1 rounded-md bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--primary)] hover:bg-[var(--primary)]/10 font-medium">{v}</button>
              ))}
            </div>
            {/* 편집기 단독 전체 폭·높이 — step 왕복 시 최신 html 로 재마운트(content 는 초기값 전용) */}
            {/* contract-tpl-editor: 표 편집 UX 스코프(고정 레이아웃·열 조절 핸들·셀 선택 하이라이트) —
                전자계약 양식 편집기와 동일. 기존 서식의 표도 열/행/전체 크기 조절·셀 정렬 가능 (2026-08-10 사장님) */}
            <div className="tpl-editor-single contract-tpl-editor">
              <RichEditor ref={editorRef} content={html} onChange={setHtml} placeholder="양식 내용을 입력하세요..." fillHeight />
            </div>
          </>
        ) : (
          <>
            <p className="tpl-editor-hint">
              발급 시 이렇게 나갑니다 — <code>{"{{변수}}"}</code> 자리는 실제 값으로 채워집니다. 고칠 곳이 있으면 &lsquo;돌아가서 수정&rsquo;을 누르세요.
            </p>
            <div className="tpl-preview-stage">
              <div className="tpl-preview w-full min-h-full px-6 py-5 bg-white text-black text-[13px] leading-relaxed"
                style={{ fontFamily: "'Pretendard', system-ui, sans-serif" }}
                dangerouslySetInnerHTML={{ __html: sanitizeDocumentHtml(fillTextTemplate(html, {}, { highlightMissing: true })) }} />
            </div>
          </>
        )}
        <div className="tpl-editor-footer">
          {step === "edit" ? (
            <>
              <button onClick={onClose} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
              <button onClick={() => setStep("preview")} className="btn-secondary btn-sm">미리보기</button>
              <button onClick={save} disabled={saving} className="btn-primary btn-sm">
                {saving ? "저장 중…" : (saveLabel || "텍스트 양식 저장")}
              </button>
            </>
          ) : (
            <>
              <button onClick={() => setStep("edit")} disabled={saving} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">돌아가서 수정</button>
              <button onClick={save} disabled={saving} className="btn-primary btn-sm">
                {saving ? "저장 중…" : (saveLabel || "텍스트 양식 저장")}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}
