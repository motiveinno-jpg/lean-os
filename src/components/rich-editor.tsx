"use client";

import { useEditor, EditorContent } from "@tiptap/react";
import { Ico } from "@/components/ui-icon";
import StarterKit from "@tiptap/starter-kit";
import Underline from "@tiptap/extension-underline";
import TextAlign from "@tiptap/extension-text-align";
import Placeholder from "@tiptap/extension-placeholder";
import { TextStyle, Color, FontSize, FontFamily } from "@tiptap/extension-text-style";
import Highlight from "@tiptap/extension-highlight";
import Image from "@tiptap/extension-image";
import { TableKit } from "@tiptap/extension-table";
import { Node, mergeAttributes } from "@tiptap/core";
import { forwardRef, useImperativeHandle, useRef, useState } from "react";
import { useToast } from "@/components/toast";

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
  // 2026-07-15 QA: 호출부가 RichEditor 전체(툴바 포함)를 max-h+overflow-auto 로 감싸면
  //   스크롤 시 툴바(표·서식 버튼)가 같이 밀려 올라가 안 보이는 문제(사장님 리포트).
  //   지정 시 본문 영역만 내부 스크롤하고 툴바는 항상 상단 고정.
  maxHeight?: string;
  // 2026-07-23 지정 시 부모 높이를 꽉 채움(flex-col h-full). 큰 팝업 편집기에서 본문 영역을 넓게.
  fillHeight?: boolean;
  // 2026-07-29 문서형 편집(계약 서식 등): 본문 폭을 A4(794px)로 고정해 PDF 불러오기 시
  //   줄바꿈 위치가 원본과 일치하게. 지정 시 본문이 가운데 정렬된 페이지처럼 보임.
  contentMaxWidth?: string;
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// ── PDF 페이지 노드 (2026-07-29 사장님: "이미지로 정확하게 불러오되 수정 가능하게") ──
//   페이지 이미지(글자 지운 배경)를 깔고, 그 위에 PDF 원좌표대로 글자 span 을 얹는다.
//   보기는 원본과 동일, span 은 contentEditable 이라 클릭해서 글자 수정 가능.
//   좌표계: 페이지 폭 794px(A4@96dpi) 기준 px. 저장 HTML 도 동일 구조라
//   서명 화면(sanitize 렌더)에서도 그대로 보인다.

type PdfPageText = { t: string; x: number; y: number; fs: number; b?: boolean; c?: string };

const PDF_PAGE_W = 794;

// 좌표·글자크기를 페이지 폭 대비 비율로 — 편집 패널·미리보기·서명 화면 어디서든
// 컨테이너 폭에 맞춰 이미지와 함께 스케일된다(px 고정 시 좁은 패널에서 전부 겹치던 버그).
// cqw = 컨테이너 폭의 1% (부모 div 에 container-type:inline-size 필요).
function pdfTextSpanStyle(t: PdfPageText, pageH: number): string {
  const left = ((t.x / PDF_PAGE_W) * 100).toFixed(3);
  const top = pageH > 0 ? ((t.y / pageH) * 100).toFixed(3) : "0";
  const fs = ((t.fs / PDF_PAGE_W) * 100).toFixed(3);
  return `position:absolute;left:${left}%;top:${top}%;font-size:${fs}cqw;${t.b ? "font-weight:700;" : ""}white-space:pre;line-height:1.15;color:${t.c || "#111"};`;
}

const PdfPage = Node.create({
  name: "pdfPage",
  group: "block",
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      // 재편집 시 저장 HTML 에서 복원 — src 는 자식 img, w/h 는 data-* (없으면 A4 기본)
      src: {
        default: "",
        parseHTML: (el: HTMLElement) => el.querySelector("img")?.getAttribute("src") || "",
        renderHTML: () => ({}),
      },
      w: {
        default: PDF_PAGE_W,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-w")) || PDF_PAGE_W,
        renderHTML: (attrs: { w?: number }) => ({ "data-w": String(attrs.w ?? PDF_PAGE_W) }),
      },
      h: {
        default: 1123,
        parseHTML: (el: HTMLElement) => Number(el.getAttribute("data-h")) || 1123,
        renderHTML: (attrs: { h?: number }) => ({ "data-h": String(attrs.h ?? 1123) }),
      },
      texts: {
        default: [] as PdfPageText[],
        parseHTML: (el: HTMLElement) => {
          try { return JSON.parse(el.getAttribute("data-texts") || "[]"); } catch { return []; }
        },
        renderHTML: (attrs: { texts?: PdfPageText[] }) => ({ "data-texts": JSON.stringify(attrs.texts || []) }),
      },
    };
  },

  parseHTML() {
    return [{ tag: "div[data-pdf-page]" }];
  },

  renderHTML({ node }) {
    const a = node.attrs as { src: string; w: number; h: number; texts: PdfPageText[] };
    const spans = (a.texts || []).map((t) => ["span", { style: pdfTextSpanStyle(t, a.h) }, t.t] as const);
    return [
      "div",
      mergeAttributes({
        "data-pdf-page": "1",
        style: `position:relative;width:${a.w}px;max-width:100%;margin:12px auto;background:#fff;container-type:inline-size;`,
      }),
      ["img", { src: a.src, style: "width:100%;display:block;", draggable: "false" }],
      ...spans as any,
    ];
  },

  addNodeView() {
    return ({ node, editor, getPos }) => {
      let cur = node;
      const dom = document.createElement("div");
      dom.setAttribute("data-pdf-page", "1");
      // 편집 모드는 페이지를 원래 크기(794px)로 고정 — max-width:100% 로 좁은 패널에
      //   맞춰 축소하면 글자가 읽기 힘들 만큼 작아진다(2026-07-29 사장님). 좁으면
      //   본문 영역이 가로 스크롤. 저장 HTML(renderHTML)은 max-width:100% 유지라
      //   서명·미리보기 화면은 기존처럼 반응형.
      dom.style.cssText = `position:relative;width:${cur.attrs.w}px;${editor.isEditable ? "" : "max-width:100%;"}margin:12px auto;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.12);container-type:inline-size;`;

      const img = document.createElement("img");
      img.src = cur.attrs.src;
      img.style.cssText = "width:100%;display:block;pointer-events:none;";
      img.draggable = false;
      dom.appendChild(img);

      const spanEls: HTMLSpanElement[] = [];
      const texts: PdfPageText[] = (cur.attrs.texts || []).map((t: PdfPageText) => ({ ...t }));

      const commit = () => {
        spanEls.forEach((el, i) => { texts[i].t = el.textContent || ""; });
        const pos = typeof getPos === "function" ? getPos() : null;
        if (pos == null) return;
        editor.view.dispatch(
          editor.view.state.tr.setNodeMarkup(pos, undefined, { ...cur.attrs, texts: texts.map((t) => ({ ...t })) })
        );
      };

      texts.forEach((t, i) => {
        const sp = document.createElement("span");
        sp.textContent = t.t;
        sp.style.cssText = pdfTextSpanStyle(t, cur.attrs.h);
        if (editor.isEditable) {
          sp.contentEditable = "true";
          sp.spellcheck = false;
          sp.style.outline = "none";
          // 겹침 방지 — 조각은 절대좌표라 글자를 추가해도 옆 조각이 밀려나지 않고
          //   겹쳤다(2026-07-29 사장님). 편집 시작 시 폭과 같은 줄 오른쪽 조각들의
          //   원래 x 를 기억해 두고, 폭 변화량만큼 그 조각들을 함께 밀어준다
          //   (간격 유지). 커밋 시 새 x 가 저장돼 다음 편집의 기준이 된다.
          let editBase: { w: number; h: number; peers: { j: number; x0: number }[]; below: { j: number; y0: number }[] } | null = null;
          const captureBase = () => {
            const lineTol = (j: number) => Math.max(texts[i].fs, texts[j].fs) * 0.6;
            editBase = {
              w: sp.offsetWidth,
              h: sp.offsetHeight,
              peers: texts
                .map((t2, j) => ({ t2, j }))
                .filter(({ t2, j }) =>
                  j !== i && t2.x > texts[i].x && Math.abs(t2.y - texts[i].y) < lineTol(j))
                .map(({ j }) => ({ j, x0: texts[j].x })),
              // 행간 유지 — 아래 줄 전체(같은 줄 제외). 높이가 변하면(크기 확대·줄 추가)
              //   변화량만큼 같이 내려가/올라와 겹치지 않는다 (2026-07-29 사장님).
              below: texts
                .map((t2, j) => ({ t2, j }))
                .filter(({ t2, j }) => j !== i && t2.y - texts[i].y >= lineTol(j))
                .map(({ j }) => ({ j, y0: texts[j].y })),
            };
          };
          const reposition = () => {
            if (!editBase) return;
            // 편집 모드 페이지 폭은 원크기(w) 고정이라 offset 차이 = 모델 px 차이
            const deltaW = sp.offsetWidth - editBase.w;
            const deltaH = sp.offsetHeight - editBase.h;
            const pageH = cur.attrs.h || 1;
            for (const p of editBase.peers) {
              const nx = Math.max(0, Math.round(p.x0 + deltaW));
              texts[p.j].x = nx;
              const el = spanEls[p.j];
              if (el) el.style.left = `${((nx / (cur.attrs.w || PDF_PAGE_W)) * 100).toFixed(3)}%`;
            }
            for (const p of editBase.below) {
              const ny = Math.max(0, Math.round(p.y0 + deltaH));
              texts[p.j].y = ny;
              const el = spanEls[p.j];
              if (el) el.style.top = `${((ny / pageH) * 100).toFixed(3)}%`;
            }
          };
          sp.addEventListener("input", reposition);
          // 마지막으로 포커스한 글자 조각을 editor.storage 에 등록 — 툴바 글자크기·
          //   변수 삽입 버튼이 PM 본문이 아니라 이 조각에 적용되게 (2026-07-29 사장님:
          //   "크기 변경이 안 되고 변수가 새 페이지에 생긴다").
          const saveCaret = () => {
            const sel = document.getSelection();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pa = (editor.storage as any).pdfActive;
            if (pa?.el === sp && sel?.anchorNode && sp.contains(sel.anchorNode)) pa.caret = sel.anchorOffset;
          };
          sp.addEventListener("focus", () => {
            sp.style.background = "rgba(59,130,246,0.12)";
            captureBase();
            // 크기·굵기 변경도 폭이 변하므로 다음 프레임에 같은 줄 조각을 재배치 후 저장
            const restyleAndCommit = () => {
              sp.style.cssText = pdfTextSpanStyle(texts[i], cur.attrs.h) + "outline:none;";
              requestAnimationFrame(() => { reposition(); commit(); });
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (editor.storage as any).pdfActive = {
              el: sp,
              caret: null as number | null,
              setFontSize: (px: number) => { texts[i].fs = px; restyleAndCommit(); },
              toggleBold: () => { texts[i].b = texts[i].b ? undefined : true; restyleAndCommit(); },
              setColor: (c: string | null) => { texts[i].c = c || undefined; restyleAndCommit(); },
              insertText: (text: string) => {
                sp.focus();
                const sel = document.getSelection();
                const node = sp.firstChild;
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const saved = (editor.storage as any).pdfActive?.caret;
                if (sel && node && node.nodeType === 3) {
                  const off = Math.min(saved ?? (node.textContent?.length || 0), node.textContent?.length || 0);
                  const range = document.createRange();
                  range.setStart(node, off);
                  range.collapse(true);
                  sel.removeAllRanges();
                  sel.addRange(range);
                }
                let ok = false;
                try { ok = document.execCommand("insertText", false, text); } catch { ok = false; }
                if (!ok) sp.textContent = (sp.textContent || "") + text;
                reposition();
                commit();
              },
            };
          });
          sp.addEventListener("keyup", saveCaret);
          sp.addEventListener("mouseup", saveCaret);
          sp.addEventListener("blur", () => { sp.style.background = "transparent"; commit(); });
        }
        spanEls.push(sp);
        dom.appendChild(sp);
      });

      return {
        dom,
        // span 안 편집 이벤트는 ProseMirror 가 가로채지 않게
        stopEvent: (e: Event) => {
          const t = e.target as HTMLElement | null;
          return !!t && t.tagName === "SPAN" && dom.contains(t);
        },
        ignoreMutation: () => true,
        update: (n) => {
          if (n.type.name !== "pdfPage") return false;
          cur = n;
          return true; // DOM 재구성 없이 유지 (타이핑 중 캐럿 보존)
        },
      };
    };
  },
});

// 글자 색상 팔레트
const COLORS = ["#000000", "#374151", "#ef4444", "#f97316", "#eab308", "#22c55e", "#3b82f6", "#8b5cf6", "#ec4899", "#ffffff"];
// 2026-07-28 사장님 요청: 작게/보통/크게 프리셋 대신 한글 프로그램처럼 숫자 px 로 직접 선택
const FONT_SIZES = [8, 9, 10, 11, 12, 13, 14, 15, 16, 18, 20, 22, 24, 26, 28, 32, 36, 40, 48].map(
  (n) => ({ label: `${n}px`, value: `${n}px` })
);
const FONT_FAMILIES = [
  { label: "기본", value: "" },
  { label: "명조", value: "'Nanum Myeongjo', serif" },
  { label: "고딕", value: "'Noto Sans KR', sans-serif" },
];

export const RichEditor = forwardRef<RichEditorRef, RichEditorProps>(function RichEditor(
  { content = "", onChange, placeholder = "내용을 입력하세요...", editable = true, onUploadImage, maxHeight, fillHeight, contentMaxWidth },
  ref
) {
  const { toast } = useToast();
  const pdfInputRef = useRef<HTMLInputElement>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const [pdfProgress, setPdfProgress] = useState<string | null>(null);
  // PDF 삽입 모드 (2026-07-29 사장님: "아예 pdf를 그대로 똑같이 불러와야돼")
  //   exact = 페이지를 고해상도 이미지로 — 표·서식·줄바꿈 원본과 100% 동일 (기본값)
  //   text  = 글자를 편집 가능한 텍스트로 추출 — 모양은 달라질 수 있음
  const pdfModeRef = useRef<"exact" | "text">("exact");

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
      TableKit.configure({ table: { resizable: true } }),
      PdfPage,
    ],
    content,
    editable,
    immediatelyRender: false,
    onUpdate: ({ editor }) => {
      onChange?.(editor.getHTML());
    },
    // PM 본문에 포커스가 돌아오면 PDF 조각 타깃 해제 — 툴바가 다시 일반 본문에 적용
    onFocus: ({ editor }) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (editor.storage as any).pdfActive = null;
    },
  });

  useImperativeHandle(ref, () => ({
    insertText(text: string) {
      if (!editor) return;
      // PDF 글자 조각을 편집 중이면 그 조각의 커서 위치에 삽입 — PM 본문에 넣으면
      //   페이지 밖(아래)에 새 문단으로 생겨 "새 페이지에 생성"으로 보였다(2026-07-29).
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const pa = (editor.storage as any).pdfActive;
      if (pa?.el?.isConnected) { pa.insertText(text); return; }
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

  // PDF → 원형 그대로 복원 (2026-07-28 사장님: "pdf 모양 그대로 — 줄바꿈·정렬·서식·표 그대로")
  //   · 줄바꿈: PDF 의 시각적 줄(y좌표) 하나 = 한 줄. 임의 재줄바꿈 없음.
  //   · 글자 크기: PDF 폰트 크기(pt)를 px(×4/3)로 환산해 줄마다 그대로 적용.
  //   · 정렬: 줄의 좌우 여백으로 가운데/오른쪽 정렬 감지 → text-align 부여.
  //   · 표: 연속된 다열(多列) 줄들을 열 좌표로 묶어 실제 편집 가능한 <table> 로 재구성.
  //     표 재구성이 안 된 괘선 페이지·이미지 페이지만 기존처럼 페이지 PNG 로 보존.
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

      // ── "PDF 그대로" 모드 (2026-07-29 사장님: 원본 모양 그대로 + 글자 수정 가능) ──
      //   ① 페이지를 고해상도로 렌더 → 글자 영역만 흰색으로 지운 배경 이미지 생성
      //   ② 글자들은 PDF 원좌표(794px 페이지 기준)대로 편집 가능한 span 으로 얹음 (PdfPage 노드)
      //   → 보기는 원본과 동일, 글자는 클릭해서 바로 수정.
      if (pdfModeRef.current === "exact") {
        const Util = pdfjs.Util;
        const nodes: any[] = [];
        for (let i = 1; i <= total; i++) {
          setPdfProgress(`${total}페이지 중 ${i}페이지 변환 중...`);
          const page = await pdf.getPage(i);
          const vp1 = page.getViewport({ scale: 1.0 });
          const factor = 794 / vp1.width;           // 페이지 → 화면(794px) 배율
          const S = 2.5;                             // 배경 이미지 해상도 배율
          const vpImg = page.getViewport({ scale: S });

          const canvas = document.createElement("canvas");
          canvas.width = vpImg.width;
          canvas.height = vpImg.height;
          const ctx = canvas.getContext("2d");
          if (!ctx) continue;
          await page.render({ canvasContext: ctx, viewport: vpImg }).promise;

          // 글자 수집 + 배경에서 글자 지우기 (흰 사각형 — 계약서류는 흰 배경이라 안전)
          const texts: { t: string; x: number; y: number; fs: number; b?: boolean }[] = [];
          try {
            try { await page.getOperatorList(); } catch { /* 폰트 로딩 실패 무시 */ }
            const boldCache = new Map<string, boolean>();
            const isBold = (fn: string): boolean => {
              if (!fn) return false;
              if (boldCache.has(fn)) return boldCache.get(fn)!;
              let b = false;
              try {
                const fo: any = (page as any).commonObjs.has(fn) ? (page as any).commonObjs.get(fn) : null;
                b = /bold|black|heavy|extrab|semib/i.test(String(fo?.name || ""));
              } catch { /* ignore */ }
              boldCache.set(fn, b);
              return b;
            };
            const tc = await page.getTextContent();
            for (const it of tc.items as any[]) {
              if (typeof it.str !== "string" || !Array.isArray(it.transform)) continue;
              const fh = Math.hypot(it.transform[2] || 0, it.transform[3] || 0) || 10;
              // 페이지 좌표 → 화면 px (vp1.transform 적용 후 factor 배)
              const [dx, dy] = Util.applyTransform([it.transform[4], it.transform[5]], vp1.transform);
              const fs = Math.max(6, Math.round(fh * factor * 10) / 10);
              if (it.str.trim().length > 0) {
                texts.push({ t: it.str, x: Math.round(dx * factor), y: Math.round(dy * factor - fs * 0.83), fs, b: isBold(it.fontName) || undefined });
              }
              // 배경 이미지에서 이 글자 영역을 흰색으로 (테두리·표 괘선은 보존)
              const ex = dx * S, ey = dy * S;
              const ew = (it.width || 0) * S, eh = fh * S;
              ctx.fillStyle = "#ffffff";
              ctx.fillRect(ex - 1, ey - eh * 1.06, Math.max(0, ew + 2), eh * 1.32);
            }
          } catch { /* 텍스트 레이어 없으면 이미지만 */ }

          let src: string;
          if (onUploadImage) {
            const blob: Blob | null = await new Promise((res) => canvas.toBlob((b) => res(b), "image/png"));
            try {
              src = blob
                ? await onUploadImage(new File([blob], `${file.name.replace(/\.pdf$/i, "")}-p${i}.png`, { type: "image/png" }))
                : canvas.toDataURL("image/png");
            } catch {
              // 스토리지 업로드 실패해도 삽입은 계속 — 인라인 dataURL 폴백
              src = canvas.toDataURL("image/png");
            }
          } else {
            src = canvas.toDataURL("image/png");
          }

          nodes.push({
            type: "pdfPage",
            attrs: { src, w: 794, h: Math.round(vp1.height * factor), texts },
          });
        }
        setPdfProgress("본문에 삽입 중...");
        editor.chain().focus().insertContent(nodes).run();
        setPdfProgress(null);
        return;
      }

      type Run = { text: string; x0: number; x1: number; h: number; b: boolean };
      type VLine = { y: number; h: number; runs: Run[] };

      for (let i = 1; i <= total; i++) {
        setPdfProgress(`${total}페이지 중 ${i}페이지 변환 중...`);
        const page = await pdf.getPage(i);
        const pageW = page.getViewport({ scale: 1.0 }).width;

        // 1) 텍스트 아이템 수집 (x·y·폭·글자크기·굵기)
        //    굵기: getOperatorList 로 폰트가 로드된 뒤 commonObjs 에서 실제 폰트명(…-Bold 등) 조회
        try { await page.getOperatorList(); } catch { /* 폰트 로딩 실패는 무시 */ }
        const boldFontCache = new Map<string, boolean>();
        const isBoldFont = (fontName: string): boolean => {
          if (!fontName) return false;
          const hit = boldFontCache.get(fontName);
          if (hit !== undefined) return hit;
          let bold = false;
          try {
            const fontObj: any = page.commonObjs.has(fontName) ? page.commonObjs.get(fontName) : null;
            bold = /bold|black|heavy|extrab|semib/i.test(String(fontObj?.name || ""));
          } catch { /* 미해석 폰트는 일반 취급 */ }
          boldFontCache.set(fontName, bold);
          return bold;
        };
        const rawItems: { str: string; x: number; y: number; w: number; h: number; b: boolean }[] = [];
        try {
          const tc = await page.getTextContent();
          for (const it of tc.items as any[]) {
            if (typeof it.str !== "string" || !Array.isArray(it.transform)) continue;
            const h = Math.hypot(it.transform[2] || 0, it.transform[3] || 0) || 10;
            rawItems.push({ str: it.str, x: it.transform[4] || 0, y: it.transform[5] || 0, w: it.width || 0, h, b: isBoldFont(it.fontName) });
          }
        } catch { /* 텍스트 레이어 없는 페이지 */ }

        // 2) y좌표로 시각적 줄 복원 → 줄 안에서 x 간격으로 run(연속 글자 덩어리) 분리
        rawItems.sort((a, b) => (b.y - a.y) || (a.x - b.x));
        const vlines: VLine[] = [];
        for (const it of rawItems) {
          const last = vlines[vlines.length - 1];
          if (last && Math.abs(last.y - it.y) <= Math.max(2.5, last.h * 0.5)) {
            last.runs.push({ text: it.str, x0: it.x, x1: it.x + it.w, h: it.h, b: it.b });
            last.h = Math.max(last.h, it.h);
          } else {
            vlines.push({ y: it.y, h: it.h, runs: [{ text: it.str, x0: it.x, x1: it.x + it.w, h: it.h, b: it.b }] });
          }
        }
        // run 병합: 좁은 간격은 같은 덩어리(공백 복원), 넓은 간격은 열 구분으로 유지
        for (const ln of vlines) {
          ln.runs.sort((a, b) => a.x0 - b.x0);
          const merged: Run[] = [];
          for (const r of ln.runs) {
            const cur = merged[merged.length - 1];
            const em = Math.max(cur?.h || 0, r.h, 6);
            if (cur && r.x0 - cur.x1 <= em * 1.1) {
              cur.text += (r.x0 - cur.x1 > em * 0.22 ? " " : "") + r.text;
              cur.x1 = Math.max(cur.x1, r.x1);
              cur.h = Math.max(cur.h, r.h);
            } else {
              merged.push({ ...r });
            }
          }
          ln.runs = merged.filter((r) => r.text.trim().length > 0);
        }
        const textLines = vlines.filter((l) => l.runs.length > 0);
        const totalChars = textLines.reduce((s, l) => s + l.runs.reduce((a, r) => a + r.text.length, 0), 0);

        const pxOf = (h: number) => Math.min(72, Math.max(6, Math.round((h * 4) / 3)));
        const spanOf = (r: Run) => {
          const inner = `<span style="font-size: ${pxOf(r.h)}px">${escapeHtml(r.text.trim())}</span>`;
          return r.b ? `<strong>${inner}</strong>` : inner;
        };
        const alignOf = (l: VLine): "left" | "center" | "right" => {
          const x0 = Math.min(...l.runs.map((r) => r.x0));
          const x1 = Math.max(...l.runs.map((r) => r.x1));
          const lm = x0, rm = pageW - x1;
          if (Math.abs(lm - rm) < pageW * 0.1 && lm > pageW * 0.15) return "center";
          if (rm < pageW * 0.08 && lm > pageW * 0.3) return "right";
          return "left";
        };

        // 3) 표 재구성 — 연속 2줄 이상이 다열(runs≥2)이면 표 밴드로 보고 열 좌표를 클러스터링
        let tablesBuilt = 0;
        const pageHtml: string[] = [];
        let para: { align: string; lines: string[] } | null = null;
        let prevY: number | null = null;
        let prevH = 0;
        const flushPara = () => {
          if (para && para.lines.length) {
            const alignStyle = para.align !== "left" ? ` style="text-align: ${para.align}"` : "";
            pageHtml.push(`<p${alignStyle}>${para.lines.join("<br>")}</p>`);
          }
          para = null;
        };

        let li = 0;
        while (li < textLines.length) {
          const ln = textLines[li];
          // 표 밴드 감지: 이 줄부터 연속으로 다열인 줄 세기
          let bandEnd = li;
          while (bandEnd < textLines.length && textLines[bandEnd].runs.length >= 2) bandEnd++;
          if (bandEnd - li >= 2) {
            flushPara();
            const band = textLines.slice(li, bandEnd);
            // 열 좌표 클러스터링 (시작 x 기준, 페이지폭 3% 허용)
            const cols: number[] = [];
            for (const bl of band) {
              for (const r of bl.runs) {
                const hit = cols.findIndex((c) => Math.abs(c - r.x0) <= pageW * 0.03);
                if (hit < 0) cols.push(r.x0);
              }
            }
            cols.sort((a, b) => a - b);
            const rows = band.map((bl) => {
              const cells: string[] = new Array(cols.length).fill("");
              for (const r of bl.runs) {
                let ci = 0, best = Infinity;
                cols.forEach((c, idx) => { const d = Math.abs(c - r.x0); if (d < best) { best = d; ci = idx; } });
                cells[ci] = cells[ci] ? `${cells[ci]} ${spanOf(r)}` : spanOf(r);
              }
              return `<tr>${cells.map((c) => `<td>${c}</td>`).join("")}</tr>`;
            });
            // 열 너비를 원본 x좌표 비율대로 — 표 모양이 PDF 와 최대한 같게
            const bandRight = Math.max(...band.flatMap((bl) => bl.runs.map((r) => r.x1)));
            const bounds = [...cols.slice(1), bandRight + 8];
            const totalW = bounds[bounds.length - 1] - cols[0] || 1;
            const colgroup = `<colgroup>${cols.map((c, idx) =>
              `<col style="width: ${Math.max(5, Math.round(((bounds[idx] - c) / totalW) * 100))}%">`
            ).join("")}</colgroup>`;
            pageHtml.push(`<table>${colgroup}<tbody>${rows.join("")}</tbody></table>`);
            tablesBuilt++;
            prevY = band[band.length - 1].y;
            prevH = band[band.length - 1].h;
            li = bandEnd;
            continue;
          }

          // 일반 줄: PDF 줄바꿈 그대로 — 정렬 같고 줄간격이 촘촘하면 같은 문단에 <br> 로 잇는다
          const align = alignOf(ln);
          const lineHtml = ln.runs.map(spanOf).join("&nbsp;&nbsp;&nbsp;");
          const gapBig = prevY !== null && prevY - ln.y > Math.max(prevH, ln.h) * 1.9;
          if (!para || para.align !== align || gapBig) {
            flushPara();
            para = { align, lines: [lineHtml] };
          } else {
            para.lines.push(lineHtml);
          }
          prevY = ln.y;
          prevH = ln.h;
          li++;
        }
        flushPara();

        // 4) 그래픽 판정 — 이미지 포함, 또는 괘선(벡터)이 많은데 표 재구성이 안 된 페이지만 PNG 보존
        let imageOps = 0;
        let vectorOps = 0;
        try {
          const ops = await page.getOperatorList();
          for (const fn of ops.fnArray as number[]) {
            if (fn === OPS.paintImageXObject || fn === OPS.paintJpegXObject ||
                fn === OPS.paintImageMaskXObject || fn === OPS.paintInlineImageXObject) {
              imageOps++;
            } else if (fn === OPS.constructPath || fn === OPS.stroke || fn === OPS.fill ||
                       fn === OPS.eoFill || fn === OPS.fillStroke || fn === OPS.eoFillStroke ||
                       fn === OPS.rectangle) {
              vectorOps++;
            }
          }
        } catch { /* ignore */ }
        const hasGraphic = imageOps > 0 || (vectorOps >= 5 && tablesBuilt === 0);

        // 페이지 구분 헤더 (2페이지 이상일 때만)
        if (total > 1) parts.push(`<p><strong>— ${i} / ${total} 페이지 —</strong></p>`);

        // 5) 복원한 텍스트/표 삽입
        if (pageHtml.length > 0) parts.push(pageHtml.join(""));

        // 6) 이미지 페이지·표 재구성 실패 괘선 페이지 → 페이지 이미지도 삽입 (내용 유실 방지)
        if (hasGraphic || totalChars < 10) {
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
      toast("PDF 변환에 실패했습니다. 다시 시도해 주세요.", "error");
    }
  };

  return (
    <div className={`rich-editor ${fillHeight ? "flex flex-col h-full min-h-0" : ""}`}>
      {editable && (
        <div className={`rich-editor-toolbar ${fillHeight ? "shrink-0" : ""}`}>
          {/* 서식 — 굵게·색상은 PDF 글자 조각 편집 중이면 그 조각에 적용 */}
          <button type="button" onClick={() => {
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pa = (editor.storage as any).pdfActive;
            if (pa?.el?.isConnected) { pa.toggleBold(); return; }
            editor.chain().focus().toggleBold().run();
          }} className={btnCls(editor.isActive("bold"))} title="굵게"><strong>B</strong></button>
          <button type="button" onClick={() => editor.chain().focus().toggleItalic().run()} className={btnCls(editor.isActive("italic"))} title="기울임"><em>I</em></button>
          <button type="button" onClick={() => editor.chain().focus().toggleUnderline().run()} className={btnCls(editor.isActive("underline"))} title="밑줄"><u>U</u></button>
          <button type="button" onClick={() => editor.chain().focus().toggleStrike().run()} className={btnCls(editor.isActive("strike"))} title="취소선"><s>S</s></button>
          <button type="button" onClick={() => editor.chain().focus().toggleHighlight({ color: "#fde68a" }).run()} className={btnCls(editor.isActive("highlight"))} title="형광펜">🖍</button>
          <div className="w-px h-5 bg-[var(--border)] mx-1 self-center" />

          {/* 글자 색상 */}
          <div className="rich-editor-color-palette" title="글자 색상">
            {COLORS.map((c) => (
              <button key={c} type="button" onClick={() => {
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const pa = (editor.storage as any).pdfActive;
                if (pa?.el?.isConnected) { pa.setColor(c); return; }
                editor.chain().focus().setColor(c).run();
              }}
                className="w-4 h-4 rounded-full border border-[var(--border)] hover:scale-110 transition" style={{ background: c }} title={c} />
            ))}
            <button type="button" onClick={() => {
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const pa = (editor.storage as any).pdfActive;
              if (pa?.el?.isConnected) { pa.setColor(null); return; }
              editor.chain().focus().unsetColor().run();
            }} className={btnCls(false)} title="색 제거">✕</button>
          </div>
          <div className="w-px h-5 bg-[var(--border)] mx-1 self-center" />

          {/* 글자 크기 — PDF 글자 조각 편집 중이면 그 조각에 적용 */}
          <select onChange={(e) => {
            const v = e.target.value;
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pa = (editor.storage as any).pdfActive;
            if (v && pa?.el?.isConnected) { pa.setFontSize(parseInt(v, 10)); e.target.value = ""; return; }
            if (v) editor.chain().focus().setFontSize(v).run(); else editor.chain().focus().unsetFontSize().run();
          }}
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
          <button type="button" onClick={() => editor.chain().focus().setTextAlign("left").run()} className={btnCls(editor.isActive({ textAlign: "left" }))} title="왼쪽 정렬" aria-label="왼쪽 정렬">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="15" y2="12"/><line x1="3" y1="18" x2="18" y2="18"/></svg>
          </button>
          <button type="button" onClick={() => editor.chain().focus().setTextAlign("center").run()} className={btnCls(editor.isActive({ textAlign: "center" }))} title="가운데 정렬" aria-label="가운데 정렬">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="6" y1="12" x2="18" y2="12"/><line x1="5" y1="18" x2="19" y2="18"/></svg>
          </button>
          <button type="button" onClick={() => editor.chain().focus().setTextAlign("right").run()} className={btnCls(editor.isActive({ textAlign: "right" }))} title="오른쪽 정렬" aria-label="오른쪽 정렬">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round"><line x1="3" y1="6" x2="21" y2="6"/><line x1="9" y1="12" x2="21" y2="12"/><line x1="6" y1="18" x2="21" y2="18"/></svg>
          </button>
          <div className="w-px h-5 bg-[var(--border)] mx-1 self-center" />

          {/* 삽입 */}
          <button type="button" onClick={() => editor.chain().focus().setHorizontalRule().run()} className={btnCls(false)} title="구분선">─</button>
          <button type="button" onClick={() => editor.chain().focus().toggleBlockquote().run()} className={btnCls(editor.isActive("blockquote"))} title="인용">" 인용</button>
          <button type="button" onClick={() => imgInputRef.current?.click()} className={btnCls(false)} title="이미지/그래프 삽입 (그래프 이미지를 넣으세요)"><Ico e="🖼" /> 이미지</button>
          <button type="button" onClick={() => { pdfModeRef.current = "exact"; pdfInputRef.current?.click(); }} className={btnCls(false)} title="PDF 원본 모양 그대로 삽입 — 표·서식·줄바꿈이 PDF와 100% 동일 (이미지로 들어가 글자 수정은 불가)"><Ico e="📎" /> PDF 그대로</button>
          <button type="button" onClick={() => { pdfModeRef.current = "text"; pdfInputRef.current?.click(); }} className={btnCls(false)} title="PDF 글자를 편집 가능한 텍스트·표로 추출 — 내용 수정이 필요할 때 (모양은 원본과 달라질 수 있음)"><Ico e="📝" /> PDF 글자만</button>
          <div className="w-px h-5 bg-[var(--border)] mx-1 self-center" />

          {/* 표 */}
          <button type="button" onClick={() => editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()} className={btnCls(false)} title="표 삽입 (3×3)">▦ 표</button>
          {editor.isActive("table") && (
            <>
              <button type="button" onClick={() => editor.chain().focus().addColumnAfter().run()} className={btnCls(false)} title="열 추가">+열</button>
              <button type="button" onClick={() => editor.chain().focus().deleteColumn().run()} className={btnCls(false)} title="열 삭제">-열</button>
              <button type="button" onClick={() => editor.chain().focus().addRowAfter().run()} className={btnCls(false)} title="행 추가">+행</button>
              <button type="button" onClick={() => editor.chain().focus().deleteRow().run()} className={btnCls(false)} title="행 삭제">-행</button>
              <button type="button" onClick={() => editor.chain().focus().toggleHeaderRow().run()} className={btnCls(false)} title="머리행 토글">머리</button>
              <button type="button" onClick={() => editor.chain().focus().deleteTable().run()} className={btnCls(false)} title="표 삭제">표✕</button>
            </>
          )}

          <input ref={imgInputRef} type="file" accept="image/*" className="hidden"
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) { try { await insertImageFromFile(f); } catch { toast("이미지 삽입 실패", "error"); } } e.target.value = ""; }} />
          <input ref={pdfInputRef} type="file" accept="application/pdf" className="hidden"
            onChange={async (e) => { const f = e.target.files?.[0]; if (f) await handlePdfInsert(f); e.target.value = ""; }} />

          {pdfProgress && <span className="text-[11px] text-[var(--primary)] self-center ml-2 animate-pulse">{pdfProgress}</span>}
        </div>
      )}
      <div className={`rich-editor-body ${fillHeight ? "flex-1 min-h-0" : ""}`}
        style={fillHeight ? { overflowY: "auto", overflowX: "auto" } : maxHeight ? { maxHeight, overflowY: "auto", overflowX: "auto" } : { overflowX: "auto" }}>
        <EditorContent
          editor={editor}
          style={contentMaxWidth ? { maxWidth: contentMaxWidth, margin: "0 auto" } : undefined}
          className={`prose prose-sm max-w-none px-4 py-3 focus:outline-none [&_.tiptap]:outline-none [&_.tiptap_img]:max-w-full ${fillHeight ? "h-full [&_.tiptap]:min-h-full" : "min-h-[200px] [&_.tiptap]:min-h-[180px]"} [&_.tiptap_img]:rounded-lg [&_.tiptap_img]:my-2 [&_.tiptap_table]:border-collapse [&_.tiptap_table]:w-full [&_.tiptap_table]:my-2 [&_.tiptap_td]:border [&_.tiptap_td]:border-[var(--border)] [&_.tiptap_td]:p-2 [&_.tiptap_th]:border [&_.tiptap_th]:border-[var(--border)] [&_.tiptap_th]:p-2 [&_.tiptap_th]:bg-[var(--bg-surface)] [&_.tiptap_th]:font-bold [&_.is-editor-empty:first-child::before]:text-[var(--text-dim)] [&_.is-editor-empty:first-child::before]:content-[attr(data-placeholder)] [&_.is-editor-empty:first-child::before]:float-left [&_.is-editor-empty:first-child::before]:h-0 [&_.is-editor-empty:first-child::before]:pointer-events-none`}
        />
      </div>
    </div>
  );
});
