import { reportError } from './friendly-error';

// ── 무음 읽기 방지 공용 통과 지점 (2026-07-16) ──
// `const { data } = await supabase...` 처럼 error 를 아예 안 받던 쿼리들의 관찰 지점.
// 실패 시 Sentry/콘솔로 보고하고 data 는 그대로 반환 — 기존 빈 폴백(`data || []` 등)
// 동작을 절대 바꾸지 않는다. scope 는 `파일:변수` 규칙(코드모드 자동 부여).
export function logRead<T extends { data: unknown; error: unknown }>(scope: string, res: T): T['data'] {
  if (res.error) reportError(`read.${scope}`, res.error);
  return res.data;
}
