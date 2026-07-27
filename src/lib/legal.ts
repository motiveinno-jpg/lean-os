import { supabase } from "@/lib/supabase";

/**
 * 약관 버전 + 동의 기록 (2026-07-27).
 *
 * 동의는 "진행을 막는 것"만으로는 분쟁 시 입증이 안 된다 — 누가·언제·어느 버전에
 * 동의했는지 남겨야 한다. 버전은 각 문서의 시행일을 그대로 쓴다.
 *
 * ⚠️ 문서를 개정하면 아래 버전과 해당 페이지 하단의 "시행일" 표기를 함께 바꿔야 한다.
 *    두 곳이 어긋나면 기록된 동의 버전이 실제 본 문서와 달라진다.
 */
export const LEGAL_DOC_VERSIONS = {
  terms: "2026-03-05",   // /terms 시행일
  privacy: "2026-04-29", // /privacy 시행일
  refund: "2026-07-27",  // /refund 시행일 (연간 결제·체험 44일 반영 개정)
} as const;

export type ConsentType =
  | "signup"                     // 가입 시 이용약관·개인정보처리방침·환불규정 동의
  | "annual_billing_no_refund";  // 연간 결제 환불불가 고지 동의(결제 건마다)

const db = supabase as any;

/**
 * 동의 기록. 실패해도 사용자 흐름을 막지 않는다(기록은 부가 기능).
 *
 * auth_id 기준으로 저장한다 — 가입 직후에는 public.users 행이 아직 없을 수 있어
 * user_id FK 로는 기록 시점을 잡을 수 없기 때문. user_id 는 알 수 있으면 함께 남긴다.
 * 'signup' 은 계정당 1건이면 충분하므로 중복 호출돼도 조용히 무시된다(부분 유니크 인덱스).
 */
export async function recordConsent(params: {
  authId: string;
  consentType: ConsentType;
  userId?: string | null;
  companyId?: string | null;
  /** 결제 동의처럼 부가 맥락이 필요한 경우 (예: 요금제·주기) */
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.from("user_consents").insert({
      auth_id: params.authId,
      user_id: params.userId ?? null,
      company_id: params.companyId ?? null,
      consent_type: params.consentType,
      document_versions: LEGAL_DOC_VERSIONS,
      context: params.context ?? null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent.slice(0, 500) : null,
    });
  } catch {
    /* 동의 기록 실패가 가입·결제를 막지 않는다 */
  }
}

// ── 소셜 로그인 경로용 임시 보관 ──────────────────────────────────────────
//   소셜은 동의 체크 직후 외부로 리다이렉트돼 그 시점엔 세션이 없다.
//   동의 사실을 잠시 보관했다가 콜백 후(세션 생김) 기록한다.
const PENDING_KEY = "ownerview_pending_consent";

export function markConsentPending(): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify({ at: new Date().toISOString(), versions: LEGAL_DOC_VERSIONS }));
  } catch { /* 스토리지 차단 환경 무시 */ }
}

export function hasConsentPending(): boolean {
  try {
    return !!sessionStorage.getItem(PENDING_KEY);
  } catch {
    return false;
  }
}

export function clearConsentPending(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch { /* noop */ }
}
