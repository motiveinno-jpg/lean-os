// api/html-pdf 의 DOMPurify 설정 — 순수 데이터. 아무것도 import 하지 않는다.
//
//   왜 분리했나: 서버 정제가 isomorphic-dompurify(→ jsdom)를 물면 jsdom 의존 사슬의
//   ESM 전용 패키지 때문에 프로덕션 함수가 **모듈 평가 시점에** 죽는 사고가 반복됐다
//   (2026-08-05 화면 500 → 서버 파일로 격리, 2026-08-25 그 서버 파일을 무는 api/html-pdf 가
//   빈 500 — 같은 병의 재발. "버전 고정으로는 계속 재발한다"는 그때 결론 그대로였다).
//   그래서 정제를 어차피 띄우는 headless Chrome(진짜 DOM) 안에서 돌리고, jsdom 은 걷어냈다.
//   이 설정은 라우트(브라우저 주입 DOMPurify)와 테스트(vitest + jsdom)가 공유한다.
//
//   ⚠️ RegExp 는 page.evaluate 직렬화가 안 되므로 문자열 소스로 두고 양쪽에서 조립한다.
export const PDF_SANITIZE_URI_REGEXP_SOURCE =
  "^(?:(?:https?|mailto|tel|data):|[^a-z]|[a-z+.-]+(?:[^a-z+.\\-:]|$))";

// 회사양식 레이아웃을 위해 <style>/<head> 를 허용하되 script·on*·iframe·object·link·meta 는 차단.
//   (실행 위험은 sanitize + puppeteer 네트워크 차단으로 이중 방어. DOMPurify 가 CSS 내
//    expression/javascript: 도 정제한다.)
export const PDF_SANITIZE_CONFIG: {
  WHOLE_DOCUMENT: boolean;
  ADD_TAGS: string[];
  ADD_ATTR: string[];
  FORBID_TAGS: string[];
  FORBID_ATTR: string[];
} = {
  WHOLE_DOCUMENT: true,
  ADD_TAGS: ["style", "html", "head", "body", "meta"],
  ADD_ATTR: ["style", "class"],
  FORBID_TAGS: ["script", "iframe", "object", "embed", "form", "input", "button", "link"],
  FORBID_ATTR: ["onerror", "onload", "onclick", "onmouseover", "onfocus", "formaction", "srcdoc"],
};
