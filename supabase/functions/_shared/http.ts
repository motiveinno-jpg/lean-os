// 엣지 함수 공통 아웃바운드 fetch 타임아웃 (2026-07-16 하드닝 백로그).
// 외부 API(Resend·Anthropic·CODEF·Toss·국세청 등)가 응답을 안 주면 함수가 플랫폼
// 월클럭 한계까지 매달리며 사용자는 무한 대기 — 모든 아웃바운드 호출에 상한을 건다.
// 타임아웃 시 AbortError 가 던져지고, 각 함수의 기존 catch 가 일반 실패로 처리한다.
//
// 기본 60초. 원래 느린 호스트(AI 추론·CODEF 은행 스크래핑)는 자동 180초.
// 개별 호출에서 3번째 인자로 명시 오버라이드 가능.

const SLOW_HOSTS = [
  "api.anthropic.com", // Claude 추론 (브리핑·분류·OCR·PDF 파싱)
  "development.codef.io",
  "api.codef.io",
  "oapi.codef.io",
];

const DEFAULT_TIMEOUT_MS = 60_000;
const SLOW_TIMEOUT_MS = 180_000;

export function tfetch(url: string | URL, init?: RequestInit, timeoutMs?: number): Promise<Response> {
  const u = String(url);
  const ms = timeoutMs ?? (SLOW_HOSTS.some((h) => u.includes(h)) ? SLOW_TIMEOUT_MS : DEFAULT_TIMEOUT_MS);
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}
