// P0-E: 사용자 친화 에러 메시지 변환기.
//   raw Postgres/Supabase/네트워크 에러가 토스트로 그대로 노출되던 패턴을
//   "사용자가 무엇을 해야 하는지" 알 수 있는 한국어로 변환. 기술 디테일은
//   console + Sentry 로만 보내고 화면엔 의도 가능한 문구만.
//
// 사용 예:
//   toast(friendlyError(err, "저장에 실패했습니다"), "error");
//   try { ... } catch (e) { reportError(e); toast(friendlyError(e), "error"); }
//
// "default 폴백 메시지" 인자는 항목 액션 단위(예: "결재 승인에 실패했습니다")
// 로 넘기면 사용자 화면에서 맥락이 살아남는다.

import * as Sentry from "@sentry/nextjs";

type AnyErr = unknown;

const PG_CODE_MSG: Record<string, string> = {
  // 무결성 / 권한
  "23505": "이미 같은 항목이 있습니다. 중복 등록은 불가합니다.",
  "23503": "연결된 다른 데이터가 있어 변경할 수 없습니다.",
  "23502": "필수 항목이 비어있습니다. 다시 확인해 주세요.",
  "23514": "입력값이 허용 범위를 벗어났습니다.",
  "42501": "이 작업을 수행할 권한이 없습니다. 관리자에게 문의하세요.",
  "22P02": "입력 형식이 올바르지 않습니다.",
  // 연결/타임아웃 (PostgREST)
  "PGRST116": "데이터를 찾을 수 없습니다. 새로고침 후 다시 시도해 주세요.",
  "PGRST301": "요청이 너무 많습니다. 잠시 후 다시 시도해 주세요.",
  "57014": "처리 시간이 초과됐습니다. 잠시 후 다시 시도해 주세요.",
};

// Supabase Auth / GoTrue 에러 메시지 → 한국어
function authMap(msg: string): string | null {
  const m = msg.toLowerCase();
  if (m.includes("invalid login credentials")) return "이메일 또는 비밀번호가 올바르지 않습니다.";
  if (m.includes("email not confirmed")) return "이메일 인증이 완료되지 않았습니다. 받은편지함을 확인해 주세요.";
  if (m.includes("user already registered") || m.includes("already exists")) return "이미 가입된 이메일입니다.";
  if (m.includes("rate limit") || m.includes("too many")) return "요청이 너무 많습니다. 1분 후 다시 시도해 주세요.";
  if (m.includes("password should be at least")) return "비밀번호는 6자 이상이어야 합니다.";
  if (m.includes("network") || m.includes("fetch") || m.includes("failed to fetch")) return "네트워크 연결을 확인해 주세요.";
  return null;
}

function pickMessage(err: AnyErr): string | null {
  if (!err) return null;
  if (typeof err === "string") return err;
  if (err instanceof Error) return err.message;
  if (typeof err === "object") {
    const e = err as Record<string, unknown>;
    if (typeof e.message === "string") return e.message;
    if (typeof e.error === "string") return e.error;
    if (e.error && typeof (e.error as { message?: unknown }).message === "string") {
      return (e.error as { message: string }).message;
    }
  }
  return null;
}

function pickCode(err: AnyErr): string | null {
  if (!err || typeof err !== "object") return null;
  const e = err as Record<string, unknown>;
  if (typeof e.code === "string") return e.code;
  if (typeof e.statusCode === "string") return e.statusCode;
  return null;
}

/**
 * 사용자에게 노출할 안전한 메시지 1줄.
 *   fallback: 액션 단위 폴백 ("저장에 실패했습니다" 등)
 */
export function friendlyError(err: AnyErr, fallback = "일시적인 오류가 발생했습니다. 잠시 후 다시 시도해 주세요."): string {
  // 1) Postgres code 우선 매핑
  const code = pickCode(err);
  if (code && PG_CODE_MSG[code]) return PG_CODE_MSG[code];

  const raw = pickMessage(err);
  if (!raw) return fallback;

  // 2) Auth 메시지 영문 → 한국어
  const auth = authMap(raw);
  if (auth) return auth;

  // 3) 명백히 raw 한 기술 메시지(SQL/스택/JSON 덤프 등)는 숨기고 fallback.
  //    - 영문 비율이 높거나
  //    - 코드/스택 키워드 포함
  //    - 80자 초과 ← 한국어 폴백이 훨씬 짧고 깨끗
  const TECH_PATTERNS = /\b(SQLSTATE|PostgresError|SyntaxError|TypeError|undefined is not|relation .* does not exist|column .* does not exist|null value in column|new row violates|permission denied for|stack:|at \w+ \()/i;
  if (TECH_PATTERNS.test(raw)) return fallback;

  // 4) 이미 한국어로 친절히 작성된 앱 레벨 메시지면 그대로 보여줌
  //    (Hangul codepoint U+AC00..U+D7AF 포함 + 80자 이내)
  const hasHangul = /[가-힯]/.test(raw);
  if (hasHangul && raw.length <= 80) return raw;

  // 5) 외에는 폴백
  return fallback;
}

/**
 * 콘솔/Sentry 로 raw 정보를 흘려보낼 때 사용. 호출 측에서 보고 직후 toast 는
 * friendlyError 로만 띄우도록 분리하기 위한 헬퍼.
 */
export function reportError(scope: string, err: AnyErr): void {
  try {
    // @sentry/nextjs — 클라/서버 양쪽. DSN·prod 아니면 no-op(안전). 과거 window.Sentry 는 미설정이라 전면 무음이었음.
    Sentry.captureException(err, { tags: { scope } });
  } catch { /* never throw from reporter */ }
  // 콘솔은 개발자만 보는 채널 — 운영 영향 없음.
  if (process.env.NODE_ENV !== "production") {
    // eslint-disable-next-line no-console
    console.error(`[${scope}]`, err);
  }
}
