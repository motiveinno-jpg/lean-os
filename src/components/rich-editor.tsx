"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle, Color, FontSize, FontFamily } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";

export interface RichEditorRef {
  insertText: (text: string) => void;
  setContent: (content: string) => void;
}

interface RichEditorProps {
  content?: string;
  onChange?: (html: string) => void;
  placeholder?: string;
  editable?: boolean;
  // 2026-05-22 PDF 페이지 이미지·일반 이미지를 회사격리 스토리지에 올릴 때 주입.
  //   미지정 시 dataURL 인라인 (간단·소용량). 대용량 PDF 는 업로더 주입 권장.
  onUploadImage?: (file: File) => Promise<string>;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// 글자 색상 팔레트
const COLORS = ["#000000", "#374151", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#ffffff"];
const FONT_SIZES = [
  { label: "작게", value: "12px" },
  { label: "보통", value: "15px" },
  { label: "크게", value: "20px" },
  { label: "제목급", value: "28px" },
];
const FONT_FAMILIES = [
  { label: "기본", value: "" },
  { label: "명조", value: "'Nanum Myeongjo', serif" },
  { label: "고딕", value: "'Noto Sans KR', sans-serif" },
];

export const RichEditor = forwardRef<RichEditorRef, RichEditorProps>(function RichEditor(
  { content = "", onChange, placeholder = "내용을 입력하세요...", editable = true, onUploadImage },
  ref
) {
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);

  const editor = useEditor({
    extensions: [
      StarterKit,
      Underline,
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      Placeholder.configure({ placeholder }),
      TextStyle,
      Color,
      FontSize,
      FontFamily,
      Highlight.configure({ multicolor: true }),
      Image.configure({ inline: false, allowBase64: true }),
    ],
    content,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
  });

  useImperativeHandle(ref, () => ({
    insertText(text: string) {
      if (!editor) return;
      editor.chain().focus().insertContent(text).run();
    },
    setContent(c: string) {
      if (!editor) return;
      editor.commands.setContent(c || '');
    },
  }), [editor]);

  if (!editor) return null;

  const btnCls = (active: boolean) =>
    `px-2 py-1.5 rounded text-xs font-medium transition ${
      active
        ? "bg-[var(--primary)] text-white"
        : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)]"
    }`;

  // 이미지를 에디터에 삽입 (업로더 있으면 URL, 없으면 dataURL)
  const insertImageFromFile = async (file: File): Promise<void> => {
    let src: string;
    if (onUploadImage) {
      src = await onUploadImage(file);
    } else {
      src = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }
    editor.chain().focus().setImage({ src }).run();
  };

  // PDF → 각 페이지 PNG → 본문에 순서대로 삽입 (그래프·표 레이아웃 100% 보존)
  const handlePdfInsert = async (file: File) => {
    setPdfProgress("PDF 불러오는 중...");
    try {
      const pdfjs: any = await import("pdfjs-dist");
      pdfjs.GlobalWorkerOptions.workerSrc = new URL(
        "pdfjs-dist/build/pdf.worker.min.mjs",
        import.meta.url
      ).toString();
      const OPS = pdfjs.OPS;

      const buf = await file.arrayBuffer();
      const pdf = await pdfjs.getDocument({ data: buf }).promise;
      const total = pdf.numPages;

      // 페이지별로 HTML 조각을 누적 → 마지막에 한 번에 삽입 (전체 페이지 보장 = 마지막장만 나오던 버그 해소).
      const parts: string[] = [];

      for (let i = 1; i <= total; i++) {
        setPdfProgress(`${total}페이지 중 ${i}페이지 변환 중...`);
        const page = await pdf.getPage(i);

        // 1) 텍스트 레이어 추출 (편집 가능) — y좌표로 줄 복원
        let pageText = "";
        try {
          const tc = await page.getTextContent();
          let lastY: number | null = null;
          for (const it of tc.items as any[]) {
            if (typeof it.str !== "string") continue;
            const y = it.transform?.[5];
            if (lastY !== null && typeof y === "number" && Math.abs(y - lastY) > 3) pageText += "\n";
            pageText += it.str;
            if (typeof y === "number") lastY = y;
          }
        } catch { /* 텍스트 없는 페이지 무시 */ }
        const trimmedText = pageText.trim();

        // 2) 그래픽(이미지·표·그래프) 포함 여부 판정
        let hasGraphic = false;
        try {
          const ops = await page.getOperatorList();
          hasGraphic = (ops.fnArray as number[]).some((fn) =>
            fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject ||
            fn === OPS.paintImageMaskXObject || fn === OPS.paintInlineImageXObject);
        } catch { /* ignore */ }

        // 페이지 구분 헤더 (2페이지 이상일 때만)
        if (total > 1) parts.push(`<p><strong>— ${i} / ${total} 페이지 —</strong></p>`);

        // 3) 텍스트가 있으면 편집 가능한 문단으로
        if (trimmedText.length > 0) {
          const paras = trimmedText
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean)
            .map((l) => `<p>${escapeHtml(l)}</p>`)
            .join("");
          parts.push(paras);
        }

        // 4) 그래픽 포함 페이지(또는 텍스트가 거의 없는 페이지)는 페이지 이미지도 삽입 (표·그래프 그대로 보존)
        if (hasGraphic || trimmedText.length < 10) {
          const viewport = page.getViewport({ scale: 2.0 });
          const canvas = document.createElement("canvas");
          canvas.width = viewport.width;
          canvas.height = viewport.height;
          const ctx = canvas.getContext("2d");
          if (ctx) {
            await page.render({ canvasContext: ctx, viewport }).promise;
            let src: string;
            if (onUploadImage) {
              const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
              src = blob
                ? await onUploadImage(new File([blob], `${file.name.replace(/\.pdf$/i, "")}-p${i}.png`, { type: "image/png" }))
                : canvas.toDataURL("image/png");
            } else {
              src = canvas.toDataURL("image/png");
            }
            parts.push(`<img src="${src}" alt="PDF ${i}페이지" />`);
          }
        }
      }

      setPdfProgress("본문에 삽입 중...");
      editor.chain().focus().insertContent(parts.join("")).run();
      setPdfProgress(null);
    } catch (e) {
      console.error("PDF 삽입 실패:", e);
      setPdfProgress(null);
      alert("PDF 변환에 실패했습니다. 다시 시도해 주세요.");
    }
  };

  return (
    <div className="border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--bg)]">
      {editable && (
        <div className="flex flex-wrap gap-0.5 px-3 py-2 border-b border-[var(--border)] bg-[var(--bg-surface)]">
          {/* 서식 */}
          <button type="button" onClick={() => editor.chain().focus().toggleBold().run()} className={btnCls(editor.isActive("bold"))} title="굵게"><strong>B</strong></button>
          <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btnCls(editor.isActive("italic"))} title="기울임"><em>I</em></button>
          <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btnCls(editor.isActive("underline"))} title="밑줄"><u>U</u></button>
          <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()} className={btnCls(editor.isActive("strike"))} title="취소선"><s>S</s></button>
          <button type="button" onClick={() => editor.chain().focus().toggleHighlight({ color: "#fde68a" }).run()} className={btnCls(editor.isActive("highlight"))} title="형광펜">🖍</button>
          <div className="w-px h-5 bg-[var(--border)] mx-1 self-center" />

          {/* 글자 색상 */}
          <div className="flex items-center gap-0.5 px-1" title="글자 색상">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => editor.chain().focus().setColor(c).run()}
                className="w-4 h-4 rounded-full border border-[var(--border)] hover:scale-110 transition" style={{ background: c }} title={c} />
            ))}
            <button type="button" onClick={() => editor.chain().focus().unsetColor().run()} className={btnCls(false)} title="색 제거">✕</button>
          </div>
          <div className="w-px h-5 bg-[var(--border)] mx-1 self-center" />

          {/* 글자 크기 */}
          <select onChange={(e) => { const v = e.target.value; if (v) editor.chain().focus().setFontSize(v).run(); else editor.chain().focus().unsetFontSize().run(); }}
            defaultValue="" className="px-1.5 py-1 rounded text-xs bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)]" title="글자 크기">
            <option value="">크기</option>
            {FONT_SIZES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          {/* 폰트 */}
          <select onChange={(e) => { const v = e.target.value; if (v) editor.chain().focus().setFontFamily(v).run(); else editor.chain().focus().unsetFontFamily().run(); }}
            defaultValue="" className="px-1.5 py-1 rounded text-xs bg-[var(--bg)] border border-[var(--border)] text-[var(--text-muted)]" title="글꼴">
            <option value="">글꼴</option>
            {FONT_FAMILIES.map((f) => <option key={f.label} value={f.value}>{f.label}</option>)}
          </select>
          <div className="w-px h-5 bg-[var(--border)] mx-1 self-center" />

          {/* 제목 */}
          <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} className={btnCls(editor.isActive("heading", { level: 2 }))} title="제목">H2</button>
          <button type="button" onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} className={btnCls(editor.isActive("heading", { level: 3 }))} title="소제목">H3</button>
          <div className="w-px h-5 bg-[var(--border)] mx-1 self-center" />

          {/* 목록 */}
          <button type="button" onClick={() => editor.chain().focus().toggleBulletList().run()} className={btnCls(editor.isActive("bulletList"))} title="목록">• 목록</button>
          <button type="button" onClick={() => editor.chain().focus().toggleOrderedList().run()} className={btnCls(editor.isActive("orderedList"))} title="번호 목록">1. 번호</button>
          <div className="w-px h-5 bg-[var(--border)] mx-1 self-center" />

          {/* 정렬 */}
          <button type="button" onClick={() => editor.chain().focus().setTextAlign("left").run()} className={btnCls(editor.isActive({ textAlign: "left" }))} title="왼쪽 정렬">좌</button>
          <button type="button" onClick={() => editor.chain().focus().setTextAlign("center").run()} className={btnCls(editor.isActive({ textAlign: "center" }))} title="가운데 정렬">중</button>
          <button type="button" onClick={() => editor.chain().focus().setTextAlign("right").run()} className={btnCls(editor.isActive({ textAlign: "right" }))} title="오른쪽 정렬">우</button>
          <div className="w-px h-5 bg-[var(--border)] mx-1 self-center" />

          {/* 삽입 */}
          <button type="button" onClick={() => editor.chain().focus().setHorizontalRule().run()} className={btnCls(false)} title="구분선">─</button>
          <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btnCls(editor.isActive("blockquote"))} title="인용">" 인용</button>
          <button type="button" onClick={() => imgInputRef.current?.click()} className={btnCls(false)} title="이미지 삽입">🖼 이미지</button>
          <button type="button" onClick={() => pdfInputRef.current?.click()} className={btnCls(false)} title="PDF 페이지 삽입 (그래프·표 그대로)">📎 PDF</button>

          <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { await insertImageFromFile(f); } catch { alert("이미지 삽입 실패"); } } e.target.value = ""; }} />
          <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden"
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) await handlePdfInsert(f); e.target.value = ""; }} />

          {pdfProgress && <span className="text-[11px] text-[var(--primary)] self-center ml-2 animate-pulse">{pdfProgress}</span>}
        </div>
      )}
      <EditorContent
        editor={editor}
        className="prose prose-sm max-w-none px-4 py-3 min-h-[200px] focus:outline-none [&_.tiptap]:outline-none [&_.tiptap]:min-h-[180px] [&_.tiptap_img]:max-w-full [&_.tiptap_img]:rounded-lg [&_.tiptap_img]:my-2 [&_.is-editor-empty:first-child::before]:text-[var(--text-dim)] [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:pointer-events-none"
      />
    </div>
  );
});
