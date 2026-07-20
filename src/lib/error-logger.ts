import { logRead } from "@/lib/log-read";
// 서비스 에러 로깅 + 한국어 설명 분류기.
// error_logs 테이블에 적재 → 운영자 화면에서 그대로 조회.

import { supabase } from "./supabase";

const db = supabase;

export type ErrorSource = "mutation" | "boundary" | "window" | "promise" | "manual";

export interface ExplainResult {
  type: string;       // 분류 키
  title: string;      // 한국어 한 줄 제목
  detail: string;     // 한국어 설명 (무슨 에러인지)
  hint: string;       // 한 줄 원인 요약
  fix: string[];      // 어떻게 고치는지 — 단계별 한국어
  severity: "high" | "medium" | "low";
}

/**
 * 에러 메시지/코드를 보고 한국어로 분류·설명.
 * Postgres 에러코드, Supabase/PostgREST, 네트워크, 인증 등 흔한 패턴 커버.
 */
export function explainError(rawMessage: string, context?: Record<string, unknown>): ExplainResult {
  const m = (rawMessage || "").toString();
  const lower = m.toLowerCase();
  const ctxStr = context ? JSON.stringify(context).toLowerCase() : "";
  const hay = `${lower} ${ctxStr}`;

  // ── Postgres 에러코드 ──
  if (/22p02|invalid input syntax for type uuid/.test(hay)) {
    return {
      type: "postgres_22P02_uuid", severity: "high",
      title: "잘못된 UUID 값 입력",
      detail: "UUID 형식이어야 하는 컬럼에 'system' 같은 문자열이나 빈 값이 들어갔습니다. 보통 사용자 ID/외래키가 비어있을 때 발생합니다.",
      hint: "INSERT/UPDATE 에 전달된 ID 값이 실제 UUID 인지 확인 필요",
      fix: [
        "에러 메시지에 적힌 값(예: \"system\")이 어느 컬럼에 들어갔는지 확인",
        "해당 코드에서 그 값을 user.id 등 실제 UUID 로 바꾸거나, 값이 없으면 null 로 전달",
        "비-UUID 가 들어올 수 있으면 저장 전 정규화(정규식 검증 → null) 추가",
      ],
    };
  }
  if (/23505|duplicate key|unique constraint/.test(hay)) {
    return {
      type: "postgres_23505_unique", severity: "medium",
      title: "중복 데이터 (유니크 제약 위반)",
      detail: "이미 존재하는 값을 다시 저장하려 했습니다 (예: 같은 이메일/기간/코드 중복).",
      hint: "유니크 제약이 걸린 컬럼 조합이 중복됨",
      fix: [
        "중복 키가 무엇인지 메시지의 (key)=(value) 부분 확인",
        "INSERT 대신 upsert({ onConflict: '컬럼' }) 로 변경하거나",
        "저장 전에 동일 레코드 존재 여부를 먼저 조회해 막기",
      ],
    };
  }
  if (/23502|null value in column|not-null constraint/.test(hay)) {
    return {
      type: "postgres_23502_notnull", severity: "high",
      title: "필수 값 누락 (NOT NULL 위반)",
      detail: "비어있으면 안 되는 컬럼에 값을 보내지 않았습니다.",
      hint: "메시지의 column \"...\" 가 비어서 거부됨",
      fix: [
        "메시지에 나온 컬럼명 확인",
        "그 컬럼을 채우도록 폼/코드에서 값 전달 추가",
        "선택값이어야 하면 DB에서 해당 컬럼 NOT NULL 제거 또는 기본값 부여",
      ],
    };
  }
  if (/23503|foreign key constraint/.test(hay)) {
    return {
      type: "postgres_23503_fk", severity: "high",
      title: "참조 무결성 오류 (외래키 위반)",
      detail: "존재하지 않는 부모 레코드를 참조했거나, 다른 곳에서 참조 중인 데이터를 삭제하려 했습니다.",
      hint: "참조 대상이 없거나, 삭제 순서가 잘못됨",
      fix: [
        "메시지의 제약 이름으로 어느 테이블 참조인지 확인",
        "참조하는 ID 가 실제로 존재하는지 먼저 조회",
        "삭제라면 자식 레코드부터 지우거나 ON DELETE CASCADE 검토",
      ],
    };
  }
  if (/42703|column .* does not exist/.test(hay)) {
    return {
      type: "postgres_42703_column", severity: "high",
      title: "존재하지 않는 컬럼 참조",
      detail: "DB에 없는 컬럼명을 쿼리에서 사용했습니다. 마이그레이션 누락 또는 컬럼명 오타입니다.",
      hint: "코드의 select/insert 컬럼명과 실제 스키마 불일치",
      fix: [
        "메시지의 column \"...\" 이름 확인",
        "해당 컬럼 추가 마이그레이션이 운영 DB에 적용됐는지 확인",
        "오타면 코드의 컬럼명을 실제 스키마에 맞게 수정",
      ],
    };
  }
  if (/42501|permission denied|violates row-level security|\brls\b/.test(hay)) {
    return {
      type: "postgres_rls", severity: "high",
      title: "권한 없음 (RLS 차단)",
      detail: "행 수준 보안(RLS) 정책에 의해 데이터 접근/쓰기가 거부됐습니다. 익명 접근이거나 회사/역할 조건 불일치일 때 발생합니다.",
      hint: "RLS 정책 조건을 통과하지 못함",
      fix: [
        "사용자가 로그인 상태인지(익명 아님) 확인",
        "정책의 company_id/역할 조건과 현재 사용자 정보가 맞는지 확인",
        "익명 경로(이메일 링크 등)면 service role Edge Function 으로 우회",
      ],
    };
  }
  if (/42p01|relation .* does not exist/.test(hay)) {
    return {
      type: "postgres_42P01_table", severity: "high",
      title: "존재하지 않는 테이블",
      detail: "DB에 없는 테이블을 조회했습니다. 마이그레이션이 운영 DB에 적용되지 않았을 가능성이 큽니다.",
      hint: "테이블 자체가 운영 DB에 없음",
      fix: [
        "메시지의 relation \"...\" 테이블명 확인",
        "해당 테이블 생성 마이그레이션을 운영 DB에 적용",
        "테이블명 오타면 코드 수정",
      ],
    };
  }

  // ── 네트워크 / 인프라 ──
  if (/\b546\b|edge function.*timeout|deno.*timeout/.test(hay)) {
    return {
      type: "edge_timeout_546", severity: "medium",
      title: "Edge Function 타임아웃 (HTTP 546)",
      detail: "Supabase Edge Function 이 제한 시간(약 150초) 안에 끝나지 않았습니다.",
      hint: "함수 처리량이 너무 큼",
      fix: [
        "조회 기간을 3개월 등으로 나눠 순차 호출",
        "한 번에 처리하는 건수를 줄이고 배치 분할",
        "무거운 집계는 DB 함수/뷰로 옮기기",
      ],
    };
  }
  if (/\b504\b|gateway timeout/.test(hay)) {
    return {
      type: "http_504", severity: "high",
      title: "게이트웨이 타임아웃 (504)",
      detail: "서버 또는 DB가 제때 응답하지 못했습니다. DB 과부하/다운 또는 무거운 쿼리일 수 있습니다.",
      hint: "백엔드 응답 지연",
      fix: [
        "Supabase 프로젝트 상태(헬스) 확인 — db/auth/rest",
        "필요 시 DB 재시작 또는 느린 쿼리 인덱스 추가",
        "동일 시간대 반복되면 인프라(요금제/커넥션) 점검",
      ],
    };
  }
  if (/\b401\b|unauthorized|jwt expired|invalid token|인증 세션/.test(hay)) {
    return {
      type: "auth_401", severity: "medium",
      title: "인증 실패 (401)",
      detail: "로그인 세션이 만료됐거나 토큰이 유효하지 않습니다.",
      hint: "세션 만료/무효",
      fix: [
        "사용자에게 재로그인 안내",
        "세션 자동 갱신(refresh) 동작 확인",
        "Edge Function 호출 시 Authorization 헤더 전달 여부 확인",
      ],
    };
  }
  if (/\b403\b|forbidden/.test(hay)) {
    return {
      type: "http_403", severity: "medium",
      title: "접근 거부 (403)",
      detail: "권한이 없는 리소스에 접근했습니다.",
      hint: "역할/권한 부족",
      fix: [
        "사용자 역할과 해당 기능 권한 요구사항 비교",
        "RLS 정책 또는 라우트 가드 확인",
      ],
    };
  }
  if (/\b1000\b.*row|db-max-rows|pagination/.test(hay)) {
    return {
      type: "postgrest_row_limit", severity: "medium",
      title: "조회 행 수 제한 (1000행)",
      detail: "PostgREST 기본 1000행 제한으로 데이터가 잘렸을 수 있습니다 (합계가 실제보다 작게 보임).",
      hint: "한 번에 1000행까지만 반환됨",
      fix: [
        "fetchAllPaginated 헬퍼로 .range() 페이지네이션 적용",
        "또는 집계가 필요하면 DB 쪽에서 합산",
      ],
    };
  }
  if (/failed to fetch|networkerror|network request failed|load failed/.test(hay)) {
    return {
      type: "network", severity: "low",
      title: "네트워크 오류",
      detail: "서버에 연결하지 못했습니다 (오프라인·CORS·서버 다운 등).",
      hint: "클라이언트-서버 연결 실패",
      fix: [
        "사용자 네트워크 상태 확인 (단발성이면 무시 가능)",
        "반복되면 Supabase/서버 다운 또는 CORS 설정 확인",
      ],
    };
  }
  if (/resend|이메일 발송|email.*fail|smtp/.test(hay)) {
    return {
      type: "email_send", severity: "medium",
      title: "이메일 발송 실패",
      detail: "Resend 등 메일 발송이 실패했습니다. API 키 미설정 또는 도메인 미인증일 수 있습니다.",
      hint: "메일 게이트웨이 거부",
      fix: [
        "Supabase secrets 의 RESEND_API_KEY 확인",
        "Resend 대시보드에서 발신 도메인 인증 상태 확인",
        "메일 실패해도 인앱 알림으로 대체되는지 확인",
      ],
    };
  }
  if (/chunk|loading chunk|dynamically imported module/.test(hay)) {
    return {
      type: "chunk_load", severity: "low",
      title: "코드 청크 로드 실패",
      detail: "배포 직후 캐시된 구버전이 새 빌드 파일을 못 찾는 경우입니다.",
      hint: "배포 직후 캐시 불일치",
      fix: [
        "사용자에게 새로고침(Ctrl+F5) 안내",
        "반복되면 CDN/서비스워커 캐시 무효화 검토",
      ],
    };
  }
  if (/aborted|abort/.test(hay)) {
    return {
      type: "aborted", severity: "low",
      title: "요청 중단됨",
      detail: "사용자가 페이지를 이동했거나 요청이 취소됐습니다 (대개 무해).",
      hint: "사용자 이탈/취소",
      fix: ["반복·대량 발생이 아니면 무시"],
    };
  }

  return {
    type: "unknown", severity: "medium",
    title: "분류되지 않은 오류",
    detail: "자동 분류 규칙에 매칭되지 않은 에러입니다. 아래 원본 메시지와 스택을 보고 원인을 파악하세요.",
    hint: "신규 패턴 — 분류 미등록",
    fix: [
      "원본 메시지/스택으로 원인 파악",
      "자주 보이면 explainError 에 분류 규칙 추가",
    ],
  };
}

let lastSignature = "";
let lastTime = 0;

/**
 * 에러를 error_logs 에 적재. 같은 에러 5초 내 중복은 스킵.
 * 실패해도 절대 throw 하지 않음 (로깅이 앱을 막으면 안 됨).
 */
export async function logError(params: {
  source: ErrorSource;
  message: string;
  stack?: string;
  context?: Record<string, unknown>;
}): Promise<void> {
  try {
    const message = (params.message || "").toString().slice(0, 2000);
    if (!message) return;
    if (/aborted/i.test(message)) return; // 취소성 에러는 적재 안 함

    const sig = `${params.source}|${message.slice(0, 120)}`;
    const now = Date.now();
    if (sig === lastSignature && now - lastTime < 5000) return;
    lastSignature = sig;
    lastTime = now;

    let userEmail: string | null = null;
    let userName: string | null = null;
    let companyId: string | null = null;
    try {
      const data = logRead('lib/error-logger:data', await supabase.auth.getUser());
      userEmail = data.user?.email ?? null;
      if (data.user?.id) {
        const u = logRead('lib/error-logger:u', await db
          .from("users")
          .select("name, company_id")
          .eq("auth_id", data.user.id)
          .maybeSingle());
        userName = u?.name ?? null;
        companyId = u?.company_id ?? null;
      }
    } catch { /* ignore */ }

    const explained = explainError(message, params.context);

    await db.from("error_logs").insert({
      company_id: companyId,
      user_email: userEmail,
      user_name: userName,
      source: params.source,
      error_type: explained.type,
      message,
      stack: params.stack ? String(params.stack).slice(0, 4000) : null,
      url: typeof window !== "undefined" ? window.location.href : null,
      user_agent: typeof navigator !== "undefined" ? navigator.userAgent : null,
      context: (params.context ?? null) as never, // Json 타입 소음 — 컬럼 실존 확인됨
    });
  } catch {
    // 로깅 실패는 무시
  }
}
