// 서버 전용 sanitize — PDF 렌더(api/html-pdf)처럼 **서버에서 반드시 정제해야 하는** 곳만 쓴다.
//
//   여기서만 isomorphic-dompurify(→ jsdom)를 import 한다.
//   화면 컴포넌트가 쓰는 sanitize-html.ts 는 jsdom 을 물지 않는다 — 그게 프로덕션 500 의 원인이었다
//   (2026-08-05: jsdom 의존 사슬에 ESM 전용 패키지가 계속 들어와 Turbopack 의 external require 가
//    모듈 평가 시점에 죽었다. 버전 고정으로는 계속 재발한다).
//
//   ⚠️ 이 파일을 클라이언트 컴포넌트에서 import 하지 말 것. 그러면 그 화면이 다시 죽는다.
import DOMPurify from "isomorphic-dompurify";

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
