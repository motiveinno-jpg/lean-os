// owner-copilot은 Supabase Edge gateway의 150초 idle 제한보다 먼저 응답해야 한다.
// 인증·스냅샷 조회·사용량 로깅·JSON 직렬화 시간을 남기기 위해 AI 작업은 요청 시작 후
// 120초까지만 허용하고, 개별 Anthropic 호출은 최대 105초로 제한한다.
export const OWNER_COPILOT_REQUEST_BUDGET_MS = 120_000;
export const OWNER_COPILOT_MAX_CALL_TIMEOUT_MS = 105_000;
export const OWNER_COPILOT_MIN_CALL_WINDOW_MS = 5_000;

export function remainingOwnerCopilotCallTimeout(
  requestStartedAt: number,
  now = Date.now(),
): number {
  const remaining = requestStartedAt + OWNER_COPILOT_REQUEST_BUDGET_MS - now;
  if (remaining < OWNER_COPILOT_MIN_CALL_WINDOW_MS) return 0;
  return Math.min(OWNER_COPILOT_MAX_CALL_TIMEOUT_MS, remaining);
}

/**
 * 첨부 계약서는 범용 다중 턴 에이전트가 아니라 단일 목적 호출로 처리한다.
 * 파일명만 계약서여도 단순 요약 요청을 생성 요청으로 오인하지 않도록 생성 의도와
 * 계약 맥락을 둘 다 요구한다.
 */
export function isAttachmentContractDraftRequest(
  question: string,
  fileNames: string[],
  mode: "manager" | "employee",
): boolean {
  if (mode !== "manager" || fileNames.length === 0) return false;

  const normalizedQuestion = String(question ?? "").trim();
  const contractContext = [normalizedQuestion, ...fileNames].join(" ");
  const hasContractContext = /전자\s*계약|계약서|계약\s*(?:양식|초안)|비밀유지\s*계약|\b(?:contract|agreement|nda)\b/i
    .test(contractContext);
  const hasCreateIntent = /만들|작성|생성|초안|양식|변환|재구성|등록|저장|올려|추가|\b(?:create|draft|make|convert|register|save)\b/i
    .test(normalizedQuestion);

  return hasContractContext && hasCreateIntent;
}
