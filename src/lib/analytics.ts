// GA4 커스텀 이벤트 헬퍼 (2026-08-13) — 컴포넌트 어디서든 track("이벤트", {…}) 한 줄.
//   GA 미설치(env 없음)·서버 렌더에서는 조용히 무시된다.
//
// 퍼널 표준 이벤트 이름 (보고서 정의 — 이름 바꾸면 GA 리포트가 끊긴다):
//   tool_calculate  { tool }   무료 계산기에서 결과를 봄
//   sign_up         { method } 회원가입 완료
//   bank_connect    {}         계좌 첫 연결 (북극성 지표)
//   checkout_start  { plan }   결제 시작
export function track(event: string, params?: Record<string, string | number | boolean>) {
  if (typeof window === "undefined") return;
  const gtag = (window as any).gtag;
  if (typeof gtag !== "function") return;
  try { gtag("event", event, params || {}); } catch { /* 계측 실패는 무해 */ }
}

/** 첫 데이터 연동(북극성 지표) — 기존 codef-connected 마커를 그대로 쓰되,
 *  마커가 없던 최초 1회만 bank_connect 를 보낸다. 마커 세팅까지 이 함수가 책임진다. */
export function markConnectedOnce(companyId: string, source: "bank" | "card" | "transactions") {
  try {
    const key = `codef-connected-${companyId}`;
    if (!localStorage.getItem(key)) track("bank_connect", { source });
    localStorage.setItem(key, "1");
  } catch { /* localStorage 불가 환경 — 계측만 포기 */ }
}
