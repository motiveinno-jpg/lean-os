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
// 업무 도메인 패턴 (2026-07-28) — 발행·결제·가입 실패를 비개발자 언어로.
//   클라이언트/서버 적재 시 붙이는 [프리픽스] 와 매칭 — POSTGREST/GENERIC 보다 먼저 평가.
const DOMAIN_PATTERNS: { pattern: RegExp; key: string; explain: Omit<ErrorExplanation, "code"> }[] = [
  {
    pattern: /\[세금계산서 발행 실패\]|hometax-issue/i,
    key: "TAX_INVOICE_ISSUE",
    explain: {
      what: "고객이 세금계산서 전자발행을 시도했는데 실패했어요.",
      why: "홈택스/CODEF 연동 오류 — 인증서 만료, 발행 등록 미완료, 국세청 점검시간(23:30~06:00), 또는 CF-코드 오류.",
      fix: "메시지의 CF-코드를 확인하세요. 인증서 문제면 고객에게 설정→인증서 재등록 안내, CF-12200 계열은 CODEF 문의(알려진 BLOCKED 이슈).",
      severity: "high",
      category: "external",
    },
  },
  {
    pattern: /\[현금영수증 발행 실패\]|cashbill-issue/i,
    key: "CASHBILL_ISSUE",
    explain: {
      what: "고객이 현금영수증 발행을 시도했는데 실패했어요.",
      why: "국세청(팝빌/CODEF) 연동 오류 — 식별번호 오류, 발행 등록 미완료, 또는 연동 장애.",
      fix: "식별번호(휴대폰/사업자번호) 형식 문제면 고객 안내로 충분. 반복되면 현금영수증 연동 상태 확인(알려진 취약 경로 — 프로덕션 성공 0건 이력).",
      severity: "high",
      category: "external",
    },
  },
  {
    pattern: /\[stripe-checkout\]|\[stripe-webhook\]/i,
    key: "PAYMENT",
    explain: {
      what: "결제 처리(카드 등록·구독 반영)가 실패했어요.",
      why: "Stripe 연동 오류 — 웹훅 서명·시크릿 불일치, price 설정, 또는 카드 거절.",
      fix: "webhook 실패면 구독이 DB에 반영 안 됐을 수 있음 — 고객사 상세에서 구독 상태를 Stripe 와 대조하세요. 반복 시 즉시 개발 확인 필요.",
      severity: "critical",
      category: "external",
    },
  },
  {
    pattern: /\[가입\/로그인\]|\[join-request\]|\[invite-accept\]/i,
    key: "SIGNUP",
    explain: {
      what: "가입·로그인·합류 과정에서 오류가 났어요.",
      why: "회사 연결 실패, 합류요청/초대 처리 오류 등 — 사용자가 진행을 못 하고 있을 가능성.",
      fix: "해당 이메일 사용자가 회사에 정상 연결됐는지 사용자 관리에서 확인하고, 안 됐으면 재로그인(회사 설정 재시도) 안내.",
      severity: "high",
      category: "auth",
    },
  },
  {
    pattern: /CF-\d{5}/,
    key: "CODEF",
    explain: {
      what: "은행·카드·홈택스 연동(CODEF)에서 오류 코드가 반환됐어요.",
      why: "인증 만료, 기관 점검, 또는 CODEF 측 제한 — CF-코드가 원인을 특정합니다.",
      fix: "CF-12200/CF-00007/CF-00000 은 알려진 BLOCKED 이슈(운영팀 답변 대기). 그 외 코드는 에러 해석 화면에서 코드로 검색.",
      severity: "medium",
      category: "external",
    },
  },
];

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
    pattern: /504 Gateway Timeout|Gateway Time-out|Request idle timeout limit|\[DB\s+504\].*\/functions\/v1\//i,
    key: "HTTP_504",
    explain: {
      what: "서버가 응답을 안 줘서 시간 초과됐어요.",
      why: "Vercel 또는 Supabase Edge 함수가 플랫폼 제한 안에 응답하지 못했습니다.",
      fix: "원문 경로로 느린 호출을 찾고, 내부 timeout을 바깥 gateway보다 짧게 설정한 뒤 무거운 작업을 단일 호출·배치로 분리하세요.",
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
// ──────────────────────────────────────────────────────────────────
// 0) 운영자 화면 우선 규칙 — 2026-09-03 사장님: "운영자 페이지는 비전공자도 쉽게 알아볼 수 있게".
//    오늘부터 error_logs 에 들어오는 서버 기능([edge …])·예약 작업([cron …])·AI 공급사·DB 상태코드([DB 4xx])
//    행이 전부 "정해진 패턴에 매칭 안 된 에러"로 떨어졌다. 기술 코드보다 먼저, 사람 말로 설명한다.
// ──────────────────────────────────────────────────────────────────
const EDGE_FN_LABEL: Record<string, string> = {
  "owner-copilot": "AI 대표 참모",
  "ai-briefing": "아침 브리핑(AI)",
  "codef-sync": "은행·카드·홈택스 자동 수집",
  "codef-cert-relay": "공동인증서 불러오기",
  "codef-cert-token": "공동인증서 불러오기",
  "codef-transfer": "계좌 이체",
  "hometax-issue": "세금계산서 발행",
  "hometax-sync": "홈택스 수집",
  "hometax-verify": "홈택스 인증 확인",
  "cashbill-issue": "현금영수증 발행",
  "cashbill-purchase-sync": "현금영수증 수집",
  "modify-tax-invoice": "세금계산서 수정",
  "classify-transactions": "거래 자동 분류(AI)",
  "auto-match-payments": "입금 자동 대사",
  "settlement-ai-match": "정산 자동 대사(AI)",
  "toss-charge": "정기 결제 청구(토스)",
  "toss-billing-key": "결제 카드 등록(토스)",
  "toss-webhook": "결제 알림 수신(토스)",
  "confirm-toss-payment": "결제 확인(토스)",
  "create-billing-portal": "결제 관리 화면",
  "cancel-subscription": "구독 해지",
  "send-approval-email": "결재 메일 발송",
  "send-contract-email": "계약 메일 발송",
  "send-invite-email": "초대 메일 발송",
  "send-payslip-email": "급여명세서 메일 발송",
  "send-signature-email": "서명 요청 메일 발송",
  "send-tax-invoice-email": "세금계산서 메일 발송",
  "send-share-email": "문서 공유 메일 발송",
  "send-billing-notification": "결제 안내 메일",
  "send-join-result-email": "가입 결과 메일",
  "send-leave-promotion-email": "연차 촉진 메일",
  "send-feedback-notification": "피드백 알림",
  "send-kakao-alimtalk": "카카오 알림톡 발송",
  "send-web-push": "웹 푸시 알림",
  "attendance-checkin": "출퇴근 기록",
  "generate-monthly-batches": "월 정산 생성",
  "daily-report": "일일 리포트",
  "advisor-notify": "자문 알림",
  "complete-signing": "전자서명 완료 처리",
  "parse-closing-pdf": "결산 PDF 읽기",
  "parse-form-template": "양식 읽기",
  "process-invoice-queue": "세금계산서 대기열 처리",
  "receive-bank-transactions": "은행 거래 수신",
  "receive-tax-invoices": "세금계산서 수신",
  "resend-webhook": "메일 발송 결과 수신",
  "verify-business-number": "사업자번호 확인",
  "operator-user-admin": "운영자 계정 관리",
  "project-survey": "프로젝트 설문",
  "gov-programs-sync": "정부지원사업 수집",
  "ads-sync": "광고 성과 수집",
  "support-ticket-analyze": "고객문의 자동 분석(AI)",
};

function explainPlatformFirst(joined: string, msg: string): ErrorExplanation | null {
  // AI 공급사(Anthropic) — 잔액 소진은 전 고객 AI 기능 중단이라 가장 먼저
  if (/credit balance is too low|PROVIDER_BILLING|AI 서비스 이용 잔액이 부족/i.test(joined)) {
    return {
      what: "AI 공급사(Anthropic)의 선불 잔액이 떨어져 AI 기능(대표 참모·아침 브리핑·자동 분류)이 모든 고객에서 멈췄어요.",
      why: "오너뷰 프로그램 문제가 아니라 우리 회사의 AI 공급사 계정 잔액 문제예요.",
      fix: "console.anthropic.com → Plans & Billing 에서 크레딧을 충전하세요. 충전 뒤 AI 참모에 질문 1번 보내 답이 오면 이 오류를 '해결'로 닫고, 자동 충전(auto-reload)을 켜 두세요.",
      severity: "critical", category: "external", code: "ai:provider_billing",
    };
  }
  if (/invalid_request_error/i.test(joined)) {
    return {
      what: "AI 공급사가 우리 요청을 거부했어요. AI 참모나 브리핑이 답을 못 했어요.",
      why: "대부분 AI 공급사 계정 잔액 부족이에요(2026-09-03 실제 사례). 드물게 요청 형식 문제일 수 있어요.",
      fix: "먼저 console.anthropic.com 잔액을 확인해 부족하면 충전하세요. 잔액이 충분한데도 반복되면 개발팀에 이 화면을 전달하세요.",
      severity: "high", category: "external", code: "ai:invalid_request",
    };
  }
  if (/CALL_CAP|COST_CAP|AI 사용 횟수|AI 사용 한도/i.test(joined)) {
    return {
      what: "고객사가 이번 달 AI 사용 한도를 다 써서 '다음 달에 초기화' 안내가 나간 것이에요. 고장이 아니에요.",
      why: "요금제마다 월 AI 사용 횟수가 정해져 있어요(무료 5회, 오너뷰 100회).",
      fix: "따로 할 일은 없어요. 같은 회사에서 자주 보이면 상위 요금제를 안내하세요.",
      severity: "low", category: "external", code: "ai:monthly_cap",
    };
  }
  // 서버 기능(엣지 함수) — 함수 이름을 사람 말로
  const edge = msg.match(/\[edge ([a-z0-9-]+)\]/i);
  if (edge || /^edge\b/.test(joined)) {
    const fn = edge?.[1] || "";
    const label = EDGE_FN_LABEL[fn] || fn || "서버 기능";
    const body = (msg.split(" — ")[1] || "").slice(0, 160);
    return {
      what: `'${label}' 기능이 서버에서 실패했어요.${body ? ` 서버가 남긴 말: ${body}` : ""}`,
      why: "외부 서비스(은행·카드사·국세청·AI·메일) 응답 오류이거나, 처리 중 예외가 났어요.",
      fix: "같은 시각에 같은 기능 오류가 여러 건이면 외부 서비스 장애 가능성이 커요 — 잠시 뒤 다시 시도해 보세요. 한 회사에서만 반복되면 그 회사 설정(인증서·연동 정보)을 확인하고, 계속되면 개발팀에 이 화면을 전달하세요.",
      severity: "high", category: "external", code: `edge:${fn || "unknown"}`,
    };
  }
  if (/\[cron http /i.test(msg) || /^http\b/.test(joined)) {
    return {
      what: "정해진 시각에 도는 자동 작업이 서버 기능을 불렀는데 응답을 못 받았어요.",
      why: "서버 기능이 응답 전에 멈췄거나 시간이 너무 오래 걸렸어요.",
      fix: "같은 시각의 '서버 기능 실패' 오류가 있으면 그것이 원인이에요. 다음 회차(대개 하루 2회)에 자동으로 다시 돌아요. 이틀 연속이면 개발팀에 전달하세요.",
      severity: "medium", category: "network", code: "cron:http",
    };
  }
  const cron = msg.match(/\[cron ([a-z0-9-]+)\]/i);
  if (cron || /^cron\b/.test(joined)) {
    return {
      what: `자동 작업 '${cron?.[1] || "예약 작업"}' 이 실패했어요. 그 회차의 자동 수집·알림·정산이 빠졌을 수 있어요.`,
      why: "데이터베이스 처리 중 오류이거나 외부 서비스 응답 실패예요.",
      fix: "다음 회차에 자동 재시도돼요. 같은 작업이 2번 연속 실패하면 개발팀에 이 화면을 전달하세요.",
      severity: "high", category: "db", code: `cron:${cron?.[1] || "unknown"}`,
    };
  }
  if (/^server\b/.test(joined)) {
    return {
      what: "서버 처리(결제 알림 수신·가입·파일 다운로드 등)가 실패했어요.",
      why: "메시지 앞의 [위치] 가 어느 처리인지 알려줘요.",
      fix: "결제·가입 관련이면 해당 고객이 정상 처리됐는지 먼저 확인하고, 반복되면 개발팀에 전달하세요.",
      severity: "high", category: "network", code: "server",
    };
  }
  // 브라우저에서 잡힌 DB 응답 — [DB 409] 처럼 상태코드로 온다(SQLSTATE 없음)
  const db = msg.match(/^\[DB (\d{3})\]\s+(\w+)\s+(\S+)/);
  if (db) {
    const status = Number(db[1]);
    const path = db[3];
    const table = (path.match(/\/rest\/v1\/(?:rpc\/)?([a-z0-9_]+)/i) || [])[1] || "";
    if (status === 409 || /duplicate key/i.test(msg)) {
      return {
        what: `이미 있는 이름·번호를 또 저장하려 해서 막혔어요(${table || "데이터"}). 화면에는 '이미 같은 항목이 있습니다' 안내가 나갔어요.`,
        why: "같은 회사 안에서 같은 값은 하나만 허용되는 항목이에요.",
        fix: "고객이 다른 이름으로 다시 저장하면 돼요. 따로 할 일은 없어요.",
        severity: "low", category: "db", code: "db:409",
      };
    }
    if ((status === 401 || status === 403 || status === 400) && /platform_|운영자만|forbidden/i.test(msg)) {
      return {
        what: "운영자가 아닌 계정이 운영자 화면을 열었어요. 데이터는 보이지 않았고 차단이 정상 작동한 거예요.",
        why: "운영자 화면은 지정된 운영자 계정만 볼 수 있어요.",
        fix: "그 계정이 운영자여야 하면 운영자 목록에 추가하고, 아니면 무시해도 돼요.",
        severity: "low", category: "auth", code: "db:operator_only",
      };
    }
    if (status === 401 || status === 403) {
      return {
        what: "권한이 없는 요청이 거부됐어요.",
        why: "로그인이 만료됐거나, 자기 회사가 아닌 데이터에 접근하려 했어요.",
        fix: "고객에게 다시 로그인 안내. 같은 계정에서 반복되면 그 계정의 회사·역할 설정을 확인하세요.",
        severity: "medium", category: "auth", code: "db:forbidden",
      };
    }
    if (status === 400 && /invalid input syntax for type uuid/i.test(msg)) {
      return {
        what: `화면이 비어 있는 값을 ID 자리에 넣어 보냈어요(${table || "데이터"}). 그 화면 일부가 안 그려졌을 수 있어요.`,
        why: "프로그램 오류예요 — 값이 아직 준비되기 전에 조회를 시작했어요.",
        fix: "개발팀에 '어느 화면(url)'과 이 메시지를 전달하세요. 고객 데이터는 영향이 없어요.",
        severity: "medium", category: "client", code: "db:400_uuid",
      };
    }
    if (status === 400) {
      return {
        what: `화면이 잘못된 요청을 보냈어요(${table || "데이터"}).`,
        why: "프로그램 오류이거나 오래된 화면(새로고침 전)이 새 서버와 맞지 않아요.",
        fix: "고객에게 새로고침 안내. 반복되면 개발팀에 화면 주소와 이 메시지를 전달하세요.",
        severity: "medium", category: "client", code: "db:400",
      };
    }
    if (status === 404) {
      return {
        what: `찾으려는 데이터가 없었어요(${table || "데이터"}).`,
        why: "이미 삭제됐거나 주소가 오래된 링크예요.",
        fix: "반복되지 않으면 무시해도 돼요.",
        severity: "low", category: "client", code: "db:404",
      };
    }
    if (status >= 500) {
      return {
        what: "데이터베이스가 응답을 못 했어요. 그 순간 저장·조회가 실패했어요.",
        why: "데이터베이스 과부하 또는 일시 장애예요.",
        fix: "잠시 뒤 다시 시도. 5분 넘게 계속되면 Supabase 상태 페이지를 확인하고 개발팀에 알리세요.",
        severity: "critical", category: "db", code: `db:${status}`,
      };
    }
  }
  return null;
}

export function explainError(
  message: string | null | undefined,
  errorType?: string | null,
  context?: Record<string, unknown> | null,
): ErrorExplanation {
  const msg = (message || "").trim();
  const type = (errorType || "").trim();
  const joined = `${type} ${msg}`;

  // 0) 사람 말 우선 규칙 (서버 기능·예약 작업·AI 공급사·DB 상태코드)
  const first = explainPlatformFirst(joined, msg);
  if (first) return first;

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
  // 업무 도메인 우선 — 발행·결제·가입 실패는 기술 패턴보다 업무 설명이 먼저다 (2026-07-28)
  for (const p of DOMAIN_PATTERNS) {
    if (p.pattern.test(joined)) {
      return { ...p.explain, code: `app:${p.key}` };
    }
  }
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

  // fallback — 설명이 아직 없는 새 오류. 기술 용어 대신 "무엇을 보고 누구에게 넘길지"만 말한다.
  const tag = (msg.match(/^\[([^\]]{1,40})\]/) || [])[1];
  return {
    what: `아직 설명이 등록되지 않은 새 오류예요${tag ? ` (${tag})` : ""}. 아래 원문을 그대로 개발팀에 전달하면 설명이 추가돼요.`,
    why: "처음 보는 종류라 자동 설명이 없어요.",
    fix: "발생 계정·회사를 보고 고객 영향이 있는지 먼저 확인하세요. 같은 오류가 하루 3번 이상이면 이 화면을 캡처해 개발팀에 전달하세요.",
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
