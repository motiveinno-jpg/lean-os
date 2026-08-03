// 2026-07-06 보안감사 P1 — 계약/문서 본문 HTML sanitize.
//   RichEditor 로 저작된 HTML 을 dangerouslySetInnerHTML 로 렌더하기 전 반드시 통과시킨다.
//   React innerHTML 은 <script> 는 안 돌지만 <img onerror>·<svg onload>·<iframe> 이벤트는 실행됨.
//   특히 공개 견적/계약 토큰 페이지(무인증)에서 조직 간 stored XSS 전달 벡터였음.
import DOMPurify from "isomorphic-dompurify";

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

export function sanitizeDocumentHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
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
export function sanitizeAiContractHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
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

// PDF 서버 렌더용 — 회사양식 레이아웃을 위해 <style>/<head> 를 허용하되 script·on*·iframe·object·link·meta 는 차단.
//   (실행 위험은 sanitize + puppeteer 네트워크 차단으로 이중 방어. DOMPurify 가 CSS 내 expression/javascript: 도 정제.)
export function sanitizePdfHtml(dirty: string | null | undefined): string {
  if (!dirty) return "";
  return DOMPurify.sanitize(String(dirty), {
    WHOLE_DOCUMENT: true,
    ADD_TAGS: ["style", "html", "head", "body", "meta"],
    ADD_ATTR: ["style", "class"],
    ALLOWED_URI_REGEXP: /^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i,
    FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "link"],
    FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "formaction", "srcdoc"],
  });
}
