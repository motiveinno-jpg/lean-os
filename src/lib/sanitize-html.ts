// 2026-07-06 보안감사 P1 — 계약/문서 본문 HTML sanitize.
//   RichEditor 로 저작된 HTML 을 dangerouslySetInnerHTML 로 렌더하기 전 반드시 통과시킨다.
//   React innerHTML 은 <script> 는 안 돌지만 <img onerror>·<svg onload>·<iframe> 이벤트는 실행됨.
//   특히 공개 견적/계약 토큰 페이지(무인증)에서 조직 간 stored XSS 전달 벡터였음.
//
// 2026-08-05 — **브라우저 전용 dompurify 로 바꿨다(jsdom 을 물지 않는다).**
//   왜: isomorphic-dompurify 는 서버에서 jsdom 을 끌어오는데, jsdom 의존 사슬에 ESM 전용
//   패키지(@exodus/bytes, @csstools/css-calc …)가 계속 들어와 Turbopack 의 external require 가
//   **모듈 평가 시점에** 죽었다. 그 결과 이 파일을 import 하는 화면들
//   (프로젝트 상세·견적 승인)이 프로덕션에서 500 이 났다. 버전 고정은 계속 재발해서 끊었다.
//   서버에서 정제가 필요한 곳(PDF 렌더)은 sanitize-html.server.ts 를 쓴다.
import DOMPurify from "dompurify";

// 계약/문서 본문에 필요한 서식 태그만 허용. on* 이벤트·script·iframe·object·form 등은 전부 차단.
const ALLOWED_TAGS = [
  // mark: RichEditor 형광펜(Highlight) 출력. 허용 목록에 없어 화면·PDF 양쪽에서 지워지고
  //   있었다(2026-07-27). 이벤트 핸들러가 없는 순수 서식 태그라 허용해도 안전.
  "p", "br", "hr", "span", "div", "b", "strong", "i", "em", "u", "s", "strike", "sub", "sup", "mark",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "pre", "code",
  "ul", "ol", "li", "a", "img",
  "table", "thead", "tbody", "tfoot", "tr", "th", "td", "colgroup", "col", "caption",
];
const ALLOWED_ATTR = [
  "href", "target", "rel", "src", "alt", "title", "width", "height",
  "colspan", "rowspan", "align", "valign", "style", "class",
  "data-field", "data-placeholder", // 서명/양식 필드 자리표시자 보존
];

/** 브라우저에서만 정제할 수 있다(DOM 이 필요). 서버 렌더 때는 아무것도 내보내지 않는다 —
 *  정제 안 된 HTML 을 흘리는 것보다 잠깐 비어 있는 편이 안전하고, 하이드레이션 직후 채워진다. */
const canSanitize = () => typeof window !== "undefined" && typeof DOMPurify.sanitize === "function";

export function sanitizeDocumentHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  if (!canSanitize()) return "";
  return DOMPurify.sanitize(String(dirty), {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // data: URI 이미지(직인·서명 등)는 허용하되 그 외 스킴은 차단. javascript: 자동 차단.
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    ADD_ATTR: ["target"],
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "style", "link", "meta"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "formaction"],
  });
}

// AI 계약서 초안 전용 — 모델 출력에는 외부 요청을 일으킬 수 있는 이미지·링크와
// 임의 CSS가 필요 없다. 일반 문서 에디터보다 더 좁은 허용 목록으로 저장·미리보기한다.
//   ⚠️ 저장 경로에서도 쓰이므로 서버에서는 **조용히 빈 값을 돌려주지 않고 막는다** —
//      빈 본문이 저장되는 사고를 만들지 않기 위해서다(화면 표시와 달리 되돌릴 수 없다).
export function sanitizeAiContractHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  if (!canSanitize()) {
    throw new Error("계약 본문 정제는 브라우저에서만 됩니다. 서버에서 필요하면 sanitize-html.server 를 쓰세요.");
  }
  return DOMPurify.sanitize(String(dirty), {
    ALLOWED_TAGS: [
      "p", "br", "hr", "span", "div", "b", "strong", "i", "em", "u",
      "h1", "h2", "h3", "h4", "ul", "ol", "li",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption",
    ],
    ALLOWED_ATTR: ["colspan", "rowspan", "align", "valign"],
    FORBID_TAGS: [
      "script", "iframe", "object", "embed", "form", "input", "button", "style", "link", "meta", "img", "a",
    ],
    FORBID_ATTR: ["style", "class", "src", "href", "onerror", "onload", "onclick", "onmouseover", "onfocus"],
  });
}
