// OP-E: 운영자용 비전공자 친화 에러 해석.
// 코드/메시지를 받아 { what, why, fix, severity, category, code } 반환.
// 매핑: Postgres SQLSTATE + PostgREST + CODEF + Stripe + 일반 JS/Network.

export type ErrorSeverity = "low" | "medium" | "high" | "critical";
export type ErrorCategory = "db" | "auth" | "network" | "external" | "client" | "unknown";

export type ErrorExplanation = {
  what: string;          // 무슨 일이에요? (한 줄)
  why: string;           // 왜 났을까? (가능한 원인)
  fix: string;           // 어떻게 고치나? (운영자 행동)
  severity: ErrorSeverity;
  category: ErrorCategory;
  code: string;          // 매칭된 코드 또는 패턴 키
};

// ──────────────────────────────────────────────────────────────────
// 1) Postgres SQLSTATE (5-char)
// ──────────────────────────────────────────────────────────────────
const POSTGRES_CODES: Record<string, Omit<ErrorExplanation, "code">> = {
  "23505": {
    what: "이미 같은 값이 있어 저장에 실패했어요. (중복 unique)",
    why: "사업자번호·이메일·외부ID 등 '하나만 있어야 하는' 컬럼에 같은 값을 두 번 넣으려 했습니다.",
    fix: "에러 메시지의 컬럼명 확인 → 기존 행을 찾아서 update 하거나, upsert 로직으로 바꿉니다.",
    severity: "medium",
    category: "db",
  },
  "23503": {
    what: "참조하는 데이터가 없어 저장에 실패했어요. (외래키)",
    why: "예: deal_id 로 거래를 가리켰는데 그 deal 이 이미 삭제되었거나 아직 생성되지 않음.",
    fix: "원본 행이 실제 있는지 확인. 부모를 먼저 만들고 자식을 만드세요.",
    severity: "medium",
    category: "db",
  },
  "23502": {
    what: "필수 컬럼이 비어 있어요. (NOT NULL)",
    why: "회사 가입 시 사업자번호처럼 반드시 채워야 하는 값을 안 넣었습니다.",
    fix: "프론트에서 입력 검증 추가하거나 컬럼 default 지정.",
    severity: "medium",
    category: "db",
  },
  "23514": {
    what: "값이 허용 범위를 벗어났어요. (CHECK 제약)",
    why: "예: status 컬럼이 'draft/sent/paid' 중 하나만 허용인데 'foo' 같은 값이 들어옴.",
    fix: "허용된 값 목록 확인 후 코드에서 enum 강제. 마이그레이션의 CHECK 제약 확인.",
    severity: "medium",
    category: "db",
  },
  "42501": {
    what: "권한이 없어 데이터를 못 봤어요. (RLS 또는 함수 권한)",
    why: "RLS 정책에서 차단됐거나 SECURITY DEFINER 함수에 GRANT EXECUTE 가 빠짐.",
    fix: "RLS 정책 점검 (현재 사용자 role 이 SELECT 가능한지), GRANT EXECUTE TO authenticated 확인.",
    severity: "high",
    category: "auth",
  },
  "42P01": {
    what: "그런 테이블이 없어요.",
    why: "마이그레이션 누락 또는 search_path 가 'public' 이 아닌 함수.",
    fix: "list_migrations 로 적용 상태 확인. SET search_path TO 'public' 함수 확인.",
    severity: "high",
    category: "db",
  },
  "42883": {
    what: "그런 함수가 없거나 인자가 안 맞아요.",
    why: "RPC 이름 오타, 인자 개수/타입 불일치, schema cache 미갱신.",
    fix: "함수 시그니처 확인 후 NOTIFY pgrst, 'reload schema'.",
    severity: "medium",
    category: "db",
  },
  "42703": {
    what: "그런 컬럼이 없어요.",
    why: "DB 컬럼은 있는데 클라이언트 select() 에 오타. 또는 컬럼이 drop 됐는데 코드만 옛날 버전.",
    fix: "정확한 컬럼명 grep, 클라이언트 타입(database.ts) 재생성.",
    severity: "medium",
    category: "db",
  },
  "P0001": {
    what: "DB 함수가 의도적으로 발생시킨 비즈니스 에러.",
    why: "함수 내부 RAISE EXCEPTION (예: 잔액 부족, 권한 없음 등 — 메시지에 사유 적힘).",
    fix: "메시지를 그대로 사용자에게 노출 (이미 한국어). 기획 변경이 필요한 경우 RPC 수정.",
    severity: "medium",
    category: "db",
  },
  "P0002": {
    what: "찾던 행이 없어요. (NO_DATA_FOUND)",
    why: "RPC 내부에서 SELECT … INTO 한 값이 NULL — 잘못된 ID 또는 삭제된 행.",
    fix: "프론트에서 ID 검증, RPC 가 NULL 처리하도록 보강.",
    severity: "low",
    category: "db",
  },
  "22P02": {
    what: "값 형식이 잘못됐어요. (예: 'abc'를 UUID 자리에)",
    why: "프론트가 빈 문자열·잘못된 UUID·non-numeric 을 보냈습니다.",
    fix: "프론트에서 빈 값 null 로 변환. 입력 검증 추가.",
    severity: "medium",
    category: "client",
  },
  "22001": {
    what: "텍스트가 컬럼 길이 한도를 넘어요.",
    why: "varchar(50) 인데 100자 넣음.",
    fix: "컬럼을 TEXT 로 늘리거나 프론트에서 maxlength 강제.",
    severity: "low",
    category: "db",
  },
  "28000": {
    what: "로그인 인증이 실패했어요.",
    why: "auth.uid() 가 NULL 이거나 jwt 만료.",
    fix: "auth 세션 새로고침, refresh token 동작 확인.",
    severity: "high",
    category: "auth",
  },
  "40001": {
    what: "동시에 같은 행을 고치려다 충돌했어요. (직렬화 실패)",
    why: "두 트랜잭션이 같은 row를 동시에 update.",
    fix: "클라이언트에서 자동 retry. RPC 내부 advisory lock 검토.",
    severity: "low",
    category: "db",
  },
  "40P01": {
    what: "두 작업이 서로의 lock 을 기다리다 멈췄어요. (deadlock)",
    why: "여러 테이블을 다른 순서로 update.",
    fix: "트랜잭션 안에서 항상 같은 순서로 lock 잡도록 RPC 정리.",
    severity: "high",
    category: "db",
  },
  "53300": {
    what: "DB 연결이 너무 많아요.",
    why: "PgBouncer 풀 한도 초과 — 클라이언트 connection leak 의심.",
    fix: "Supabase 대시보드에서 connection 그래프 확인. Edge function 의 close 누락 점검.",
    severity: "critical",
    category: "db",
  },
  "57014": {
    what: "쿼리가 너무 오래 걸려 자동 취소됐어요.",
    why: "statement_timeout 초과. 인덱스 부족 또는 비효율 쿼리.",
    fix: "EXPLAIN ANALYZE 로 슬로우 부분 식별 → 인덱스 추가.",
    severity: "high",
    category: "db",
  },
  "08006": {
    what: "DB 연결이 끊겼어요.",
    why: "네트워크 문제 또는 Supabase 일시 재시작.",
    fix: "Supabase status 페이지 확인. 클라이언트 재연결 로직 작동 여부.",
    severity: "high",
    category: "network",
  },
  "XX000": {
    what: "DB 내부 오류.",
    why: "Postgres 자체의 예기치 못한 에러.",
    fix: "메시지 전문을 Supabase 로그와 함께 운영팀에 보고.",
    severity: "critical",
    category: "db",
  },
};

// ──────────────────────────────────────────────────────────────────
// 2) PostgREST 메시지 패턴
// ──────────────────────────────────────────────────────────────────
const POSTGREST_PATTERNS: { pattern: RegExp; key: string; explain: Omit<ErrorExplanation, "code"> }[] = [
  {
    pattern: /PGRST116|JSON object requested, multiple \(or no\) rows/i,
    key: "PGRST116",
    explain: {
      what: "정확히 1개를 기대했는데 0개 또는 여러 개가 왔어요.",
      why: ".single() 호출인데 조건에 맞는 행이 없거나 여러 개.",
      fix: "프론트에서 .maybeSingle() 로 변경하거나 조건을 더 좁힘.",
      severity: "low",
      category: "db",
    },
  },
  {
    pattern: /JWT expired|exp claim/i,
    key: "JWT_EXPIRED",
    explain: {
      what: "로그인 토큰이 만료됐어요.",
      why: "장시간 탭을 열어둔 사용자가 토큰 만료 후 첫 클릭.",
      fix: "supabase.auth.onAuthStateChange 로 자동 refresh 동작 확인.",
      severity: "low",
      category: "auth",
    },
  },
  {
    pattern: /row[- ]level security|violates row.level security/i,
    key: "RLS_BLOCK",
    explain: {
      what: "RLS 정책에 의해 차단됐어요.",
      why: "현재 사용자 role 이 해당 행을 볼 권한이 없음.",
      fix: "RLS 정책 SQL 확인 → 의도된 차단인지/정책 누락인지 판단.",
      severity: "high",
      category: "auth",
    },
  },
  {
    pattern: /schema cache|Could not find the function/i,
    key: "SCHEMA_CACHE",
    explain: {
      what: "DB 함수/테이블 변경이 PostgREST 에 반영 안 됐어요.",
      why: "마이그레이션 후 NOTIFY pgrst 누락.",
      fix: "execute_sql 로 NOTIFY pgrst, 'reload schema' 실행.",
      severity: "medium",
      category: "db",
    },
  },
  {
    pattern: /no suitable function|Could not choose the best candidate/i,
    key: "RPC_OVERLOAD",
    explain: {
      what: "같은 이름의 함수가 여러 개라 PostgREST 가 못 골랐어요.",
      why: "RPC 오버로딩 — 같은 이름 다른 인자.",
      fix: "이전 버전 함수 DROP 또는 클라이언트에서 인자 명시.",
      severity: "medium",
      category: "db",
    },
  },
];

// ──────────────────────────────────────────────────────────────────
// 3) CODEF (한국 신용/금융 API) 에러
// ──────────────────────────────────────────────────────────────────
const CODEF_CODES: Record<string, Omit<ErrorExplanation, "code">> = {
  "CF-00000": {
    what: "CODEF 일반 오류.",
    why: "원인이 다양함 — 메시지 본문 추가 단서 필요.",
    fix: "원본 에러 메시지 + 호출 시점을 운영팀에 보고.",
    severity: "medium",
    category: "external",
  },
  "CF-00007": {
    what: "홈택스 인증서 인증 실패. (BLOCKED 상태)",
    why: "공동인증서 비밀번호 또는 인증서 자체 문제. CODEF 운영팀 답변 대기 중.",
    fix: "사용자에게 인증서 재발급/비번 확인 안내. 이 에러는 자동 추측 시도 금지(memory: project_hometax_blocked).",
    severity: "high",
    category: "external",
  },
  "CF-10302": {
    what: "은행 비밀번호가 틀려요.",
    why: "사용자가 비밀번호를 잘못 입력.",
    fix: "사용자에게 비밀번호 재확인 안내. 5회 연속 시 계정 잠금 가능 — 더 시도 말 것.",
    severity: "medium",
    category: "external",
  },
  "CF-10303": {
    what: "캡차/이미지 인증이 필요해요.",
    why: "은행이 자동화 의심으로 추가 인증 요구.",
    fix: "수기로 은행 로그인 1회 후 재시도. 빈도 잦으면 동기화 주기 늘림.",
    severity: "medium",
    category: "external",
  },
  "CF-12200": {
    what: "추가 인증(SMS·OTP) 필요. (BLOCKED 상태)",
    why: "은행/홈택스가 추가 본인확인 요구. CODEF 운영 답변 대기 중.",
    fix: "memory: project_hometax_blocked — 자동 우회 시도 금지. 사용자 수기 인증 안내.",
    severity: "high",
    category: "external",
  },
  "CF-13800": {
    what: "SMS 인증 단계.",
    why: "휴대폰 본인확인 요구.",
    fix: "사용자가 직접 SMS 인증 완료해야 함.",
    severity: "low",
    category: "external",
  },
};

// ──────────────────────────────────────────────────────────────────
// 4) Stripe 에러
// ──────────────────────────────────────────────────────────────────
const STRIPE_CODES: Record<string, Omit<ErrorExplanation, "code">> = {
  card_declined: {
    what: "카드사가 결제를 거절했어요.",
    why: "한도 초과, 의심 거래, 발급사 정책.",
    fix: "사용자에게 다른 카드 사용 또는 카드사 문의 안내.",
    severity: "medium",
    category: "external",
  },
  insufficient_funds: {
    what: "잔액 부족.",
    why: "체크카드/직불 잔고 모자람.",
    fix: "다른 결제수단 안내.",
    severity: "low",
    category: "external",
  },
  expired_card: {
    what: "카드 유효기간이 지났어요.",
    why: "사용자가 만료된 카드로 결제 시도.",
    fix: "유효기간 갱신 또는 새 카드 등록 안내.",
    severity: "low",
    category: "external",
  },
  incorrect_cvc: {
    what: "보안코드(CVC)가 틀려요.",
    why: "오타 또는 잘못된 카드.",
    fix: "CVC 재입력 안내. 3회 이상 실패 시 카드사 확인.",
    severity: "low",
    category: "external",
  },
  rate_limit: {
    what: "Stripe API 호출이 너무 많아요.",
    why: "짧은 시간에 같은 결제를 반복 시도.",
    fix: "클라이언트 debounce 추가. webhook 로 상태 추적.",
    severity: "medium",
    category: "external",
  },
  authentication_required: {
    what: "3D Secure 본인확인이 필요해요.",
    why: "발급사가 추가 인증 요구.",
    fix: "Stripe Elements 의 confirmCardPayment 흐름 점검.",
    severity: "medium",
    category: "external",
  },
  payment_intent_authentication_failure: {
    what: "3D Secure 인증이 실패했어요.",
    why: "사용자가 본인확인 단계에서 취소 또는 실패.",
    fix: "다른 결제수단 시도 안내.",
    severity: "low",
    category: "external",
  },
  processing_error: {
    what: "Stripe 내부 처리 오류.",
    why: "일시적 — 보통 재시도하면 해결.",
    fix: "exponential backoff 으로 자동 재시도.",
    severity: "medium",
    category: "external",
  },
};

// ──────────────────────────────────────────────────────────────────
// 5) 일반 JS/네트워크 패턴
// ──────────────────────────────────────────────────────────────────
const GENERIC_PATTERNS: { pattern: RegExp; key: string; explain: Omit<ErrorExplanation, "code"> }[] = [
  {
    pattern: /Failed to fetch|NetworkError|net::ERR/i,
    key: "NETWORK_FAIL",
    explain: {
      what: "서버에 연결을 못 했어요.",
      why: "사용자 네트워크 끊김, CORS 차단, 또는 서버 down.",
      fix: "Supabase·Vercel status 페이지 확인. 사용자에게 새로고침 안내.",
      severity: "medium",
      category: "network",
    },
  },
  {
    pattern: /504 Gateway Timeout|Gateway Time-out/i,
    key: "HTTP_504",
    explain: {
      what: "서버가 응답을 안 줘서 시간 초과됐어요.",
      why: "Vercel 함수가 60초 안에 응답 못함. Supabase 쿼리 느림 또는 RLS 재귀.",
      fix: "RPC 슬로우 쿼리 추적. RLS 정책 재귀 의심 시 [[feedback_rls_recursion_gate]] 참조.",
      severity: "high",
      category: "network",
    },
  },
  {
    pattern: /502 Bad Gateway/i,
    key: "HTTP_502",
    explain: {
      what: "프록시가 백엔드와 통신 실패.",
      why: "Vercel·Supabase 일시 장애.",
      fix: "상태 페이지 확인. 자동 재시도 추가.",
      severity: "high",
      category: "network",
    },
  },
  {
    pattern: /401 Unauthorized/i,
    key: "HTTP_401",
    explain: {
      what: "로그인이 안 돼 있거나 토큰 만료.",
      why: "세션 만료 후 첫 호출.",
      fix: "auth refresh 동작 확인 → /auth 로 redirect.",
      severity: "low",
      category: "auth",
    },
  },
  {
    pattern: /403 Forbidden/i,
    key: "HTTP_403",
    explain: {
      what: "권한이 없어 차단됐어요.",
      why: "RLS 또는 라우트 게이트.",
      fix: "사용자 role 확인. 의도된 차단인지 정책 누락인지 판단.",
      severity: "medium",
      category: "auth",
    },
  },
  {
    pattern: /429 Too Many Requests/i,
    key: "HTTP_429",
    explain: {
      what: "요청이 너무 많아 잠시 차단됐어요.",
      why: "Supabase·Stripe rate limit.",
      fix: "exponential backoff. 동시 호출 debounce.",
      severity: "medium",
      category: "network",
    },
  },
  {
    pattern: /TypeError: Cannot read propert(?:y|ies)/i,
    key: "TYPE_ERROR_READ",
    explain: {
      what: "코드가 비어있는 데이터를 사용하려 했어요.",
      why: "null/undefined 체크 없이 .x 접근.",
      fix: "옵셔널 체이닝(?.) 추가. 데이터 fetch 가드 보강.",
      severity: "medium",
      category: "client",
    },
  },
  {
    pattern: /Maximum update depth exceeded/i,
    key: "REACT_INFINITE",
    explain: {
      what: "React 무한 렌더 루프.",
      why: "useEffect 의존성에 setState 매번 새 객체 생성.",
      fix: "useEffect deps 점검. useMemo/useCallback 활용.",
      severity: "high",
      category: "client",
    },
  },
  {
    pattern: /Hydration failed|did not match/i,
    key: "HYDRATION",
    explain: {
      what: "서버와 클라이언트 렌더 결과가 다릅니다.",
      why: "Date·random·typeof window 등 환경 차이.",
      fix: "해당 부분 useEffect 안으로 이동하거나 dynamic import ssr:false.",
      severity: "medium",
      category: "client",
    },
  },
  {
    pattern: /ChunkLoadError|Loading chunk \d+ failed/i,
    key: "CHUNK_LOAD",
    explain: {
      what: "JS 청크 다운로드 실패.",
      why: "사용자가 옛날 버전 페이지에서 새 청크 요청 — 배포 후 발생.",
      fix: "프론트에서 router.refresh() 강제. 또는 Service Worker 캐시 정리.",
      severity: "low",
      category: "client",
    },
  },
  {
    pattern: /unhandled rejection|unhandledrejection/i,
    key: "UNHANDLED_REJECT",
    explain: {
      what: "Promise 가 reject 됐는데 catch 없음.",
      why: "fetch / supabase 호출 await + try/catch 누락.",
      fix: "에러 스택에서 호출 지점 찾아 try/catch 또는 .catch 추가.",
      severity: "medium",
      category: "client",
    },
  },
];

// ──────────────────────────────────────────────────────────────────
// 통합 해석기
// ──────────────────────────────────────────────────────────────────
export function explainError(
  message: string | null | undefined,
  errorType?: string | null,
  context?: Record<string, unknown> | null,
): ErrorExplanation {
  const msg = (message || "").trim();
  const type = (errorType || "").trim();
  const joined = `${type} ${msg}`;

  // 1) SQLSTATE (5-char) 정확매칭
  const sqlState = joined.match(/\b(2[2-3]\d{3}|4[02]\d{3}|42P0[12]|P000[12]|408\d{2}|40P01|28\d{3}|XX000)\b/);
  if (sqlState && POSTGRES_CODES[sqlState[1]]) {
    const c = sqlState[1];
    return { ...POSTGRES_CODES[c], code: `PG-${c}` };
  }

  // 2) CODEF 코드 (CF-NNNNN)
  const codef = joined.match(/\b(CF-\d{5})\b/);
  if (codef && CODEF_CODES[codef[1]]) {
    return { ...CODEF_CODES[codef[1]], code: codef[1] };
  }

  // 3) Stripe 코드 (snake_case)
  for (const stripeKey of Object.keys(STRIPE_CODES)) {
    if (joined.toLowerCase().includes(stripeKey)) {
      return { ...STRIPE_CODES[stripeKey], code: `stripe:${stripeKey}` };
    }
  }

  // 4) PostgREST 패턴
  for (const p of POSTGREST_PATTERNS) {
    if (p.pattern.test(joined)) {
      return { ...p.explain, code: `pgrst:${p.key}` };
    }
  }

  // 5) 일반 JS/네트워크
  for (const p of GENERIC_PATTERNS) {
    if (p.pattern.test(joined)) {
      return { ...p.explain, code: `js:${p.key}` };
    }
  }

  // 6) 컨텍스트 hint
  if (context && typeof context === "object") {
    const ctxStr = JSON.stringify(context);
    if (/Stripe|stripe/.test(ctxStr)) {
      return {
        what: "Stripe 결제 중 알 수 없는 오류.",
        why: "Stripe 코드 매핑에는 없음 — context 본문 점검 필요.",
        fix: "context 전문 + Stripe 대시보드의 동일 시각 이벤트 비교.",
        severity: "medium",
        category: "external",
        code: "stripe:unknown",
      };
    }
  }

  // fallback
  return {
    what: "정해진 패턴에 매칭 안 된 에러.",
    why: "신규 에러 유형. 메시지·스택·컨텍스트 직접 분석 필요.",
    fix: "이 에러가 반복되면 operator-error-explain.ts 에 패턴 추가.",
    severity: "low",
    category: "unknown",
    code: "unknown",
  };
}

// 카테고리/심각도 라벨/색상 헬퍼
export const SEVERITY_TONE: Record<ErrorSeverity, { label: string; bg: string; text: string }> = {
  low: { label: "낮음", bg: "bg-emerald-500/15", text: "text-emerald-300" },
  medium: { label: "보통", bg: "bg-amber-500/15", text: "text-amber-300" },
  high: { label: "높음", bg: "bg-orange-500/15", text: "text-orange-300" },
  critical: { label: "치명", bg: "bg-red-500/20", text: "text-red-300" },
};

export const CATEGORY_LABEL: Record<ErrorCategory, string> = {
  db: "DB",
  auth: "인증",
  network: "네트워크",
  external: "외부 API",
  client: "프론트",
  unknown: "기타",
};
