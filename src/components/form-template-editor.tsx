// 핸드오프 → 적용 경로: src/components/form-template-editor.tsx  (2026-06-29, P2)
//
// 양식 매핑 보정 에디터 — 자동 인식(parse-form-template)은 "초안", 사람이 좌표/키를 확정한다.
//   PDF 페이지 PNG(rasterizePdf 결과) 배경 위에 필드 박스를 드래그/리사이즈/추가/삭제 + 데이터키 매핑.
//   좌표는 정규화(0~1, 좌상단). 저장 시 fields → pdf_form_templates.
//
// 사용 흐름(부모): 파일선택 → rasterizePdf → detectFields → uploadTemplateFile → <FormTemplateEditor>
//   → onSave(fields) → saveFormTemplate + setActiveTemplate.

"use client";

import { useRef, useState, useCallback } from "react";
import type { OverlayField, DocType } from "@/lib/form-templates";

// edge KEYS 와 동일 — 드롭다운 옵션
const KEY_OPTIONS: Record<DocType, string[]> = {
  quote: ["회사명", "대표자명", "거래처명", "거래처대표", "프로젝트명", "견적번호", "작성일", "유효기간", "공급가액", "부가세", "합계금액", "품목표", "비고", "서명_공급자"],
  contract: ["회사명", "대표자명", "거래처명", "거래처대표", "프로젝트명", "계약번호", "작성일", "계약시작일", "계약종료일", "계약금액", "부가세", "합계금액", "서명_갑", "서명_을", "비고"],
  // HR 양식은 서식이 자유로워 정해진 키가 없음 — 아래는 새 필드 추가 시 기본 라벨 후보(속성 패널에서 자유 편집).
  hr_form: ["성명", "주민등록번호", "생년월일", "주소", "연락처", "부서", "직위", "입사일", "날짜", "금액", "서명", "기타"],
};

const KIND_BY_KEY = (key: string): OverlayField["kind"] => {
  if (key.startsWith("서명")) return "signature";
  if (key === "품목표") return "items_table";
  if (/금액|가액|부가세/.test(key)) return "amount";
  if (/일$|기간|작성일/.test(key)) return "date";
  return "text";
};

interface Props {
  docType: DocType;
  pageImages: string[]; // rasterizePdf().pages 를 dataURL 로 (data:image/png;base64, 접두 포함)
  pageSizes: { w: number; h: number }[];
  initialFields: OverlayField[];
  onSave: (fields: OverlayField[]) => void;
  onCancel?: () => void;
}

type DragState =
  | { mode: "move"; idx: number; startX: number; startY: number; origX: number; origY: number }
  | { mode: "resize"; idx: number; startX: number; startY: number; origW: number; origH: number }
  | null;

export default function FormTemplateEditor({ docType, pageImages, pageSizes, initialFields, onSave, onCancel }: Props) {
  const [fields, setFields] = useState<OverlayField[]>(initialFields);
  const [selected, setSelected] = useState<number | null>(null);
  const [pageIdx, setPageIdx] = useState(0);
  const pageRef = useRef<HTMLDivElement>(null);
  const drag = useRef<DragState>(null);

  const keyOptions = KEY_OPTIONS[docType];
  const pageFields = fields.map((f, i) => ({ f, i })).filter(({ f }) => f.page === pageIdx + 1);

  const onPointerMove = useCallback((e: PointerEvent) => {
    const d = drag.current;
    const box = pageRef.current?.getBoundingClientRect();
    if (!d || !box) return;
    const dx = (e.clientX - d.startX) / box.width;
    const dy = (e.clientY - d.startY) / box.height;
    setFields((prev) => {
      const next = [...prev];
      const f = { ...next[d.idx] };
      if (d.mode === "move") {
        f.x = Math.max(0, Math.min(1 - f.w, d.origX + dx));
        f.y = Math.max(0, Math.min(1 - f.h, d.origY + dy));
      } else {
        f.w = Math.max(0.02, Math.min(1 - f.x, d.origW + dx));
        f.h = Math.max(0.01, Math.min(1 - f.y, d.origH + dy));
      }
      next[d.idx] = f;
      return next;
    });
  }, []);

  const endDrag = useCallback(() => {
    drag.current = null;
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerup", endDrag);
  }, [onPointerMove]);

  const startMove = (e: React.PointerEvent, idx: number) => {
    e.stopPropagation();
    setSelected(idx);
    drag.current = { mode: "move", idx, startX: e.clientX, startY: e.clientY, origX: fields[idx].x, origY: fields[idx].y };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  };

  const startResize = (e: React.PointerEvent, idx: number) => {
    e.stopPropagation();
    setSelected(idx);
    drag.current = { mode: "resize", idx, startX: e.clientX, startY: e.clientY, origW: fields[idx].w, origH: fields[idx].h };
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", endDrag);
  };

  const addField = () => {
    const key = keyOptions[0];
    const f: OverlayField = { key, label: key, page: pageIdx + 1, x: 0.4, y: 0.4, w: 0.2, h: 0.04, align: "left", font_size: 10, kind: KIND_BY_KEY(key) };
    setFields((p) => [...p, f]);
    setSelected(fields.length);
  };

  const patchField = (idx: number, patch: Partial<OverlayField>) =>
    setFields((p) => p.map((f, i) => (i === idx ? { ...f, ...patch } : f)));

  const removeField = (idx: number) => {
    setFields((p) => p.filter((_, i) => i !== idx));
    setSelected(null);
  };

  const sel = selected != null ? fields[selected] : null;
  const ar = pageSizes[pageIdx] ? pageSizes[pageIdx].w / pageSizes[pageIdx].h : 0.707;

  return (
    <div className="form-template-editor">
      {/* 좌: PDF 미리보기 + 박스 오버레이 */}
      <div className="template-editor-preview">
        <div className="template-editor-page-toolbar">
          {pageImages.map((_, i) => (
            <button key={i} onClick={() => setPageIdx(i)} className={`rounded px-2 py-1 text-sm ${i === pageIdx ? "bg-indigo-600 text-white" : "bg-[var(--bg-surface)] text-[var(--text-muted)]"}`}>
              {i + 1}p
            </button>
          ))}
          <button onClick={addField} className="ml-auto rounded bg-emerald-600 px-3 py-1 text-sm text-white">+ 필드 추가</button>
        </div>
        <div
          ref={pageRef}
          onPointerDown={() => setSelected(null)}
          className="template-editor-page"
          style={{ aspectRatio: String(ar) }}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={pageImages[pageIdx]} alt={`${pageIdx + 1}페이지`} className="absolute inset-0 h-full w-full object-contain" draggable={false} />
          {pageFields.map(({ f, i }) => (
            <div
              key={i}
              onPointerDown={(e) => startMove(e, i)}
              className={`template-field-box ${i === selected ? "border-indigo-600 bg-indigo-500/20" : "border-amber-500 bg-amber-400/15"}`}
              style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.w * 100}%`, height: `${f.h * 100}%` }}
              title={f.label || f.key}
            >
              <span className="absolute -top-4 left-0 whitespace-nowrap rounded bg-black/70 px-1 text-white">{f.label || f.key}</span>
              <span
                onPointerDown={(e) => startResize(e, i)}
                className="absolute -bottom-1.5 -right-1.5 h-3 w-3 cursor-se-resize rounded-sm border border-white bg-indigo-600"
              />
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-gray-500">박스를 드래그해 이동, 우하단 점으로 크기 조절. 자동 인식은 초안이니 위치·키를 확정하세요.</p>
      </div>

      {/* 우: 속성 패널 */}
      <div className="template-editor-properties">
        {sel ? (
          <div className="template-field-properties">
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">{docType === "hr_form" ? "필드 이름" : "데이터 키"}</label>
              {docType === "hr_form" ? (
                // HR 양식은 자유 서식 — 필드 이름을 직접 입력(자동기입 없음, 라벨 용도).
                <input
                  value={sel.label ?? sel.key}
                  onChange={(e) => patchField(selected!, { key: e.target.value || "필드", label: e.target.value })}
                  placeholder="예: 성명"
                  className="w-full rounded border px-2 py-1 text-sm"
                />
              ) : (
                <select
                  value={sel.key}
                  onChange={(e) => patchField(selected!, { key: e.target.value, label: e.target.value, kind: KIND_BY_KEY(e.target.value) })}
                  className="w-full rounded border px-2 py-1 text-sm"
                >
                  {keyOptions.map((k) => <option key={k} value={k}>{k}</option>)}
                </select>
              )}
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium text-gray-500">종류(kind)</label>
              <select value={sel.kind} onChange={(e) => patchField(selected!, { kind: e.target.value as OverlayField["kind"] })} className="w-full rounded border px-2 py-1 text-sm">
                {["text", "amount", "date", "signature", "items_table"].map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </div>
            <div className="template-field-align-size-row">
              <div className="flex-1">
                <label className="mb-1 block text-xs font-medium text-gray-500">정렬</label>
                <select value={sel.align ?? "left"} onChange={(e) => patchField(selected!, { align: e.target.value as OverlayField["align"] })} className="w-full rounded border px-2 py-1 text-sm">
                  {["left", "center", "right"].map((a) => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>
              <div className="w-20">
                <label className="mb-1 block text-xs font-medium text-gray-500">크기pt</label>
                <input type="number" value={sel.font_size ?? 10} onChange={(e) => patchField(selected!, { font_size: Number(e.target.value) || 10 })} className="w-full rounded border px-2 py-1 text-sm" />
              </div>
            </div>
            <button onClick={() => removeField(selected!)} className="w-full rounded bg-[var(--danger-dim)] py-1 text-sm text-[var(--danger)]">필드 삭제</button>
          </div>
        ) : (
          <p className="rounded border border-dashed border-gray-300 p-4 text-center text-sm text-gray-400">필드 박스를 선택하면 속성이 표시됩니다.</p>
        )}

        <div className="template-editor-footer-actions">
          {onCancel && <button onClick={onCancel} className="flex-1 rounded border py-2 text-sm">취소</button>}
          <button onClick={() => onSave(fields)} className="flex-1 rounded bg-indigo-600 py-2 text-sm font-medium text-white">양식 저장</button>
        </div>
      </div>
    </div>
  );
}
