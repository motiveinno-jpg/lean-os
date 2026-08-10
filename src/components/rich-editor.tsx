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
import { TableKit, TableRow } from "@tiptap/extension-table";
import { TableMap } from "@tiptap/pm/tables";
import { Node, mergeAttributes } from "@tiptap/core";
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { useToast } from "@/components/toast";
import {
  PDF_PAGE_W,
  pdfTextSpanStyle,
  pdfToEditableHtml,
  type PdfEditableText,
} from "@/lib/pdf-editable";

// 흐름형 PDF에서 추출한 로고·직인 등 개별 이미지의 원래 폭/들여쓰기를 저장한다.
// 페이지 전체 배경은 pdf-flow 단계에서 제외되며, 이 이미지는 일반 문서 요소라
// 앞에 표·문장을 삽입하면 다른 내용과 함께 자연스럽게 아래로 이동한다.
const FlowImage = Image.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      flowImage: {
        default: false,
        parseHTML: (element: HTMLElement) => element.getAttribute("data-flow-image") === "1",
        renderHTML: (attributes: { flowImage?: boolean; flowWidth?: number; flowOffset?: number }) =>
          attributes.flowImage
            ? {
                "data-flow-image": "1",
                style:
                  `width:${Math.max(16, Number(attributes.flowWidth) || 160)}px;max-width:100%;height:auto;` +
                  `display:block;margin-left:${Math.max(0, Number(attributes.flowOffset) || 0)}px;`,
              }
            : {},
      },
      flowWidth: {
        default: null,
        parseHTML: (element: HTMLElement) => Number(element.getAttribute("data-flow-width")) || null,
        renderHTML: (attributes: { flowWidth?: number }) =>
          attributes.flowWidth ? { "data-flow-width": String(attributes.flowWidth) } : {},
      },
      flowOffset: {
        default: null,
        parseHTML: (element: HTMLElement) => Number(element.getAttribute("data-flow-offset")) || null,
        renderHTML: (attributes: { flowOffset?: number }) =>
          attributes.flowOffset != null ? { "data-flow-offset": String(attributes.flowOffset) } : {},
      },
    };
  },
});

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

type PdfPageText = PdfEditableText;

const PdfPage = Node.create({
  name: "pdfPage",
  group: "block",
  atom: true,
  // PDF 페이지나 문장 조각을 별도 개체처럼 선택하지 않는다. 일반 워드프로세서처럼
  // 글자에 바로 커서가 놓이게 하고, 페이지/문장 단위 선택 테두리는 표시하지 않는다.
  selectable: false,
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
          sp.style.border = "0";
          sp.style.boxShadow = "none";
          sp.style.cursor = "text";
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
          const applyStoredStyle = (forceVisible = false) => {
            sp.style.cssText =
              pdfTextSpanStyle(texts[i], cur.attrs.h, forceVisible)
              + "outline:none;border:0;box-shadow:none;cursor:text;";
          };
          const markEdited = () => {
            if (!texts[i].e) texts[i].e = true;
            applyStoredStyle();
          };
          sp.addEventListener("input", () => {
            markEdited();
            reposition();
            commit();
          });
          // 마지막으로 포커스한 글자 조각을 editor.storage 에 등록 — 툴바 글자크기·
          //   변수 삽입 버튼이 PM 본문이 아니라 이 조각에 적용되게 (2026-07-29 사장님:
          //   "크기 변경이 안 되고 변수가 새 페이지에 생긴다").
          const saveSelection = () => {
            const sel = document.getSelection();
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            const pa = (editor.storage as any).pdfActive;
            if (pa?.el !== sp || !sel?.anchorNode || !sel.focusNode
              || !sp.contains(sel.anchorNode) || !sp.contains(sel.focusNode)) return;
            const selectedRange = sel.rangeCount ? sel.getRangeAt(0) : null;
            if (!selectedRange) return;
            const before = document.createRange();
            before.selectNodeContents(sp);
            before.setEnd(selectedRange.startContainer, selectedRange.startOffset);
            const start = before.toString().length;
            pa.selection = {
              start,
              end: start + selectedRange.toString().length,
            };
          };
          sp.addEventListener("focus", () => {
            captureBase();
            // 미수정 조각은 평소 투명해 원본 이미지의 폰트·색이 그대로 보인다.
            // 포커스한 동안만 추출한 서식으로 표시하되, 워드/한글처럼 커서만 보이고
            // 문장 단위의 테두리나 편집 영역 박스는 만들지 않는다.
            applyStoredStyle(true);
            // 크기·굵기 변경도 폭이 변하므로 다음 프레임에 같은 줄 조각을 재배치 후 저장
            const restyleAndCommit = () => {
              texts[i].e = true;
              applyStoredStyle();
              requestAnimationFrame(() => { reposition(); commit(); });
            };
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            (editor.storage as any).pdfActive = {
              el: sp,
              selection: null as { start: number; end: number } | null,
              setFontSize: (px: number) => { texts[i].fs = px; restyleAndCommit(); },
              toggleBold: () => { texts[i].b = texts[i].b ? undefined : true; restyleAndCommit(); },
              setColor: (c: string | null) => { texts[i].c = c || undefined; restyleAndCommit(); },
              insertText: (text: string) => {
                // 변수 버튼을 누르면 span 이 blur 됐다가 다시 focus 되며 focus 핸들러가
                // pdfActive 를 새로 만든다. 재포커스 전에 선택 범위를 먼저 보존해야
                // 선택한 기존 값 전체를 {{변수}}로 교체할 수 있다.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                const saved = (editor.storage as any).pdfActive?.selection as
                  { start: number; end: number } | null | undefined;
                sp.focus();
                texts[i].e = true;
                applyStoredStyle();
                const sel = document.getSelection();
                const node = sp.firstChild;
                if (sel && node && node.nodeType === 3) {
                  const length = node.textContent?.length || 0;
                  const start = Math.min(saved?.start ?? length, length);
                  const end = Math.min(saved?.end ?? start, length);
                  const range = document.createRange();
                  range.setStart(node, start);
                  range.setEnd(node, end);
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
          sp.addEventListener("keyup", saveSelection);
          sp.addEventListener("mouseup", saveSelection);
          sp.addEventListener("blur", () => { applyStoredStyle(); commit(); });
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

// 표 행 높이 (2026-08-10 사장님 요청 — "행 높이도 조절 가능하게") —
//   prosemirror-tables 는 열 너비만 지원해서 행은 직접 구현한다.
//   ① tr 에 rowheight 속성을 저장(HTML 로는 style height 로 나가 미리보기·PDF 에서도 유지)
//   ② 드래그 상호작용은 RichEditor 의 DOM 핸들러(아래 useEffect)가 담당
const ResizableTableRow = TableRow.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      rowheight: {
        default: null,
        parseHTML: (el: HTMLElement) => {
          const n = parseInt(el.style?.height || "", 10);
          return Number.isFinite(n) && n > 0 ? n : null;
        },
        renderHTML: (attrs: { rowheight?: number | null }) =>
          attrs.rowheight ? { style: `height: ${attrs.rowheight}px` } : {},
      },
    };
  },
});

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
      FlowImage.configure({ inline: false, allowBase64: true }),
      TableKit.configure({ table: { resizable: true }, tableRow: false }),
      ResizableTableRow,
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

  // 초기 content 반영 — immediatelyRender:false 라 첫 렌더에는 editor 가 없다.
  //   그 사이에 부모가 setContent() 로 밀어넣은 템플릿은 조용히 유실된다
  //   (결재 새 요청에서 유형을 처음 고르면 상세내용 템플릿이 안 뜨고 두 번째 선택부터
  //    보이던 원인 — 그 화면은 유형 선택 시점에 에디터를 새로 마운트한다. 2026-08-06)
  //   에디터가 준비된 뒤 '아직 빈 상태일 때 한 번만' 넘어온 content 를 채운다.
  //   사용자가 이미 입력한 내용은 건드리지 않고, 이후 타이핑과도 충돌하지 않는다.
  const contentSyncedRef = useRef(false);
  useEffect(() => {
    if (!editor || contentSyncedRef.current) return;
    const incoming = content || "";
    if (!incoming) return;              // 채울 게 아직 없으면 계속 기다린다
    contentSyncedRef.current = true;
    if (editor.isEmpty) editor.commands.setContent(incoming);
  }, [editor, content]);

  // ── 표 행 높이 드래그 (2026-08-10) — 행 아래 경계 4px 안에서 잡아 끌면 높이가 바뀐다.
  //   열 경계(오른쪽 8px)와 겹치면 열 조절(columnResizing)에 양보한다.
  //   드래그 중에는 DOM style 로 미리 보여 주고, 놓는 순간 rowheight 속성 트랜잭션으로 확정
  //   (DOM 만 바꾸면 PM 재렌더에 지워진다).
  // ── 표 전체 크기 드래그 (2026-08-10 사장님 — "표 전체 크기도 변경가능하게") —
  //   표 우하단 모서리 10px 안을 잡아 끌면 표 전체가 커지고 작아진다.
  //   확정 시 가로는 모든 열 너비(colwidth)를 비율대로, 세로는 모든 행 높이(rowheight)를
  //   비율대로 한 트랜잭션에 저장 — colwidth 는 tiptap 이 colgroup 으로 HTML 에 내보내
  //   미리보기·발송 스냅샷·PDF 에서도 유지된다.
  useEffect(() => {
    if (!editor || !editable) return;
    const dom = editor.view.dom as HTMLElement;
    const EDGE = 4, COL_EDGE = 8, CORNER = 10, MIN_H = 22, MIN_W = 80, MIN_COL = 30;
    // 커밋 값은 DOM 재측정이 아니라 lastH/lastW/lastRowH 로 추적 — PM 이 mousemove 마다
    //   DOM 프리뷰를 모델대로 되돌리기 때문에(관찰: 같은 이벤트의 두 리스너 사이에 tr 교체)
    //   mouseup 시점 DOM 측정은 되돌려진 값을 읽을 수 있다.
    let drag:
      | { kind: "row"; tr: HTMLTableRowElement; table: HTMLTableElement; rowIndex: number; startY: number; startH: number; lastH?: number }
      | { kind: "table"; table: HTMLTableElement; startX: number; startY: number; startW: number; startH: number;
          rows: { el: HTMLTableRowElement; h0: number }[]; cols: number[]; lastW?: number; lastH?: number; lastRowH?: number[] }
      | null = null;

    // 표 노드 위치 — nodeDOM 이 tableWrapper 를 돌려주므로 contains 로 대조.
    //   tr 엘리먼트는 PM 이 드래그 중 교체하므로 직접 대조하지 않는다(표 엘리먼트는 nodeview 라 유지됨).
    const findTablePos = (tableEl: HTMLTableElement): number => {
      let tablePos = -1;
      editor.state.doc.descendants((node, pos) => {
        if (tablePos >= 0) return false;
        if (node.type.name === "table") {
          const nd = editor.view.nodeDOM(pos) as HTMLElement | null;
          if (nd && (nd === tableEl || nd.contains(tableEl))) { tablePos = pos; }
          return false; // 표 내부까지 볼 필요 없음
        }
        return true;
      });
      return tablePos;
    };

    const rowUnderPointer = (e: MouseEvent): HTMLTableRowElement | null => {
      const cell = (e.target as HTMLElement | null)?.closest?.("td, th");
      if (!cell || !dom.contains(cell)) return null;
      const r = cell.getBoundingClientRect();
      if (r.bottom - e.clientY > EDGE || e.clientY > r.bottom) return null;
      if (r.right - e.clientX < COL_EDGE) return null;   // 열 조절 구역 — 양보
      return cell.closest("tr");
    };

    // 표 우하단 모서리 — 행/열 경계보다 우선한다 (모서리는 표 전체 조절 전용)
    const tableCornerUnderPointer = (e: MouseEvent): HTMLTableElement | null => {
      const table = (e.target as HTMLElement | null)?.closest?.("table");
      if (!table || !dom.contains(table)) return null;
      const r = table.getBoundingClientRect();
      if (Math.abs(r.right - e.clientX) > CORNER || Math.abs(r.bottom - e.clientY) > CORNER) return null;
      return table as HTMLTableElement;
    };

    const onMove = (e: MouseEvent) => {
      if (drag?.kind === "table") {
        const w = Math.max(MIN_W, drag.startW + (e.clientX - drag.startX));
        const h = Math.max(drag.rows.length * MIN_H, drag.startH + (e.clientY - drag.startY));
        const ratioY = h / drag.startH;
        const rowHs = drag.rows.map((r) => Math.max(MIN_H, Math.round(r.h0 * ratioY)));
        drag.lastW = w;
        drag.lastH = h;
        drag.lastRowH = rowHs;
        // 프리뷰 — PM 이 되돌려도 다음 이벤트마다 재적용 (행 DOM 이 교체됐을 수 있어 현재 표에서 다시 찾음)
        if (drag.table.isConnected) {
          drag.table.style.width = `${w}px`;
          Array.from(drag.table.rows).forEach((el, i) => { el.style.height = `${rowHs[i] ?? MIN_H}px`; });
        }
        e.preventDefault();
        return;
      }
      if (drag?.kind === "row") {
        const h = Math.max(MIN_H, drag.startH + (e.clientY - drag.startY));
        drag.lastH = h;
        if (drag.tr.isConnected) drag.tr.style.height = `${h}px`;
        e.preventDefault();
        return;
      }
      const corner = tableCornerUnderPointer(e);
      dom.classList.toggle("rich-editor-table-corner", !!corner);
      dom.classList.toggle("rich-editor-row-resize", !corner && !!rowUnderPointer(e));
    };
    const onDown = (e: MouseEvent) => {
      const table = tableCornerUnderPointer(e);
      if (table) {
        e.preventDefault();
        e.stopPropagation();
        const r = table.getBoundingClientRect();
        const rowsEls = Array.from(table.rows);
        // 열 기준 너비 — 셀이 가장 많은 행(병합 없는 행)에서 측정
        const refRow = rowsEls.reduce((a, b) => (b.cells.length > a.cells.length ? b : a), rowsEls[0]);
        drag = {
          kind: "table", table, startX: e.clientX, startY: e.clientY, startW: r.width, startH: r.height,
          rows: rowsEls.map((el) => ({ el, h0: el.getBoundingClientRect().height })),
          cols: refRow ? Array.from(refRow.cells).map((c) => c.getBoundingClientRect().width) : [],
        };
        return;
      }
      const tr = rowUnderPointer(e);
      if (!tr) return;
      const rowTable = tr.closest("table");
      if (!rowTable) return;
      e.preventDefault();
      e.stopPropagation();
      drag = { kind: "row", tr, table: rowTable as HTMLTableElement, rowIndex: tr.rowIndex, startY: e.clientY, startH: tr.getBoundingClientRect().height };
    };

    const commitRow = (d: Extract<NonNullable<typeof drag>, { kind: "row" }>) => {
      if (d.lastH == null) return; // 이동 없는 클릭 — 커밋할 것 없음
      const finalH = Math.max(MIN_H, Math.round(d.lastH));
      const tablePos = findTablePos(d.table);
      if (tablePos < 0) return;
      const tableNode = editor.state.doc.nodeAt(tablePos);
      if (!tableNode) return;
      let i = 0;
      let trx: typeof editor.state.tr | null = null;
      tableNode.forEach((rowNode, offset) => {
        if (trx || rowNode.type.name !== "tableRow") return;
        if (i++ === d.rowIndex) {
          trx = editor.state.tr.setNodeMarkup(tablePos + 1 + offset, undefined, { ...rowNode.attrs, rowheight: finalH });
        }
      });
      if (trx) editor.view.dispatch(trx);
    };

    const commitTable = (d: Extract<NonNullable<typeof drag>, { kind: "table" }>) => {
      if (d.lastW == null || d.lastH == null) return; // 이동 없는 클릭
      const finalW = d.lastW;
      const tablePos = findTablePos(d.table);
      if (tablePos < 0) return;
      const tableNode = editor.state.doc.nodeAt(tablePos);
      if (!tableNode) return;
      const map = TableMap.get(tableNode);
      let trx = editor.state.tr;

      // 가로 — 열 너비를 비율대로 (측정 못 한 병합 표는 균등 분배)
      if (Math.abs(finalW - d.startW) >= 2) {
        const ratioX = finalW / d.startW;
        const targetCols = d.cols.length === map.width
          ? d.cols.map((w) => Math.max(MIN_COL, Math.round(w * ratioX)))
          : Array.from({ length: map.width }, () => Math.max(MIN_COL, Math.round(finalW / map.width)));
        const seen = new Set<number>();
        for (let row = 0; row < map.height; row++) {
          for (let col = 0; col < map.width; col++) {
            const rel = map.map[row * map.width + col];
            if (seen.has(rel)) continue;
            seen.add(rel);
            const cellPos = tablePos + 1 + rel;
            const cellNode = editor.state.doc.nodeAt(cellPos);
            if (!cellNode) continue;
            const span = Number(cellNode.attrs.colspan) || 1;
            trx = trx.setNodeMarkup(cellPos, undefined, { ...cellNode.attrs, colwidth: targetCols.slice(col, col + span) });
          }
        }
      }

      // 세로 — 각 행의 추적 높이를 rowheight 로 확정 (가로만 끌었으면 건드리지 않음)
      if (Math.abs(d.lastH - d.startH) >= 2 && d.lastRowH) {
        let i = 0;
        tableNode.forEach((rowNode, offset) => {
          if (rowNode.type.name !== "tableRow") return;
          const h = d.lastRowH![i++];
          if (h == null) return;
          trx = trx.setNodeMarkup(tablePos + 1 + offset, undefined, { ...rowNode.attrs, rowheight: h });
        });
      }

      if (trx.steps.length) editor.view.dispatch(trx);
    };

    const onUp = () => {
      if (!drag) return;
      const d = drag;
      drag = null;
      if (d.kind === "row") commitRow(d);
      else commitTable(d);
    };

    dom.addEventListener("mousemove", onMove);
    dom.addEventListener("mousedown", onDown, true); // capture — 모서리에서 열 조절(columnResizing)보다 먼저
    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
    return () => {
      dom.removeEventListener("mousemove", onMove);
      dom.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onUp);
    };
  }, [editor, editable]);

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

  // exact: 원본 페이지 이미지를 유지한 채 같은 좌표에 투명 편집 레이어를 얹는다.
  // text: PDF 텍스트를 일반 문단/표 흐름으로 재구성한다.
  const handlePdfInsert = async (file: File) => {
    setPdfProgress("PDF 불러오는 중...");
    try {
      // 워드/한글식 흐름 문서 변환 — 공용 lib (hr 서식 새양식 업로드와 동일 경로)
      if (pdfModeRef.current === "text") {
        const { pdfToFlowHtml } = await import("@/lib/pdf-flow");
        const { html } = await pdfToFlowHtml(file, onUploadImage, (m) => setPdfProgress(m));
        setPdfProgress("본문에 삽입 중...");
        editor.chain().focus().insertContent(html).run();
        setPdfProgress(null);
        return;
      }

      if (pdfModeRef.current === "exact") {
        const { html } = await pdfToEditableHtml(
          file,
          onUploadImage,
          (message) => setPdfProgress(message),
        );
        setPdfProgress("본문에 삽입 중...");
        editor.chain().focus().insertContent(html).run();
        setPdfProgress(null);
        return;
      }

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
