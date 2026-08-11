import { todayKst } from "@/lib/kst";
import { logRead } from "@/lib/log-read";
// 가입·회사 개설·합류 공용 로직 (2026-07-03)
//   원칙: 1 사업자번호 = 1 회사. 가입 시 사업자번호 필수 → 형식/실체/중복 3중 검증.
//   이미 등록된 사업자번호면 회사를 새로 만들지 않고 '합류 요청'으로 전환.
//   auth/page.tsx(즉시 세션)·auth/verify(이메일 인증·OAuth) 양쪽에서 재사용 — 중복 구현 금지.

import { supabase } from "./supabase";
import { verifyBusinessNumber, validateBusinessOwnership } from "./business-verification";
import { logError } from "./error-logger";

// 간편가입 관문 실패는 화면 토스트로만 사라져 "이탈인지 오류인지" 구분이 불가했다(2026-07-29 사장님).
//   실패 지점마다 운영자 오류 로그를 남긴다 — 사업자번호는 앞 3자리만(개인정보 최소화).
const bizMask = (digits: string) => (digits ? `${digits.slice(0, 3)}-**-*****` : "(없음)");
function logSignupIssue(step: string, message: string, extra?: Record<string, unknown>) {
  try {
    logError({ source: "manual", message: `[간편가입] ${step}: ${message}`, context: { step, ...extra } });
  } catch { /* 로깅 실패가 가입을 막으면 안 됨 */ }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

export const bizNoDigits = (input: string) => String(input || "").replace(/[^0-9]/g, "").slice(0, 10);
export const formatBizNo = (digits: string) =>
  digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : digits;
export const isValidBizNo = (input: string) => bizNoDigits(input).length === 10;

// 사업자번호 중복(기등록 회사) 확인 — 서버 API(service role) 경유 (RLS로 클라 직접 조회 불가)
//   유효성 선검사 추가 (2026-08-10 사장님 제보): "123456789…" 같은 가짜 번호도
//   '사용 가능한 사업자번호' 로 통과했다. 유효성은 최종 제출에서만 검사하고 있었기 때문 —
//   중복 확인 단계에서 checksum + 국세청 상태(assertBizNoActive)를 먼저 거른다.
//   auth 가입 폼·/company-setup 양쪽이 이 함수를 쓰므로 여기 한 곳으로 둘 다 잡힌다.
export async function checkBusinessNumberRegistered(bizNo: string): Promise<{ registered: boolean; companyNameMasked?: string }> {
  const active = await assertBizNoActive(bizNo);
  if (!active.ok) {
    logSignupIssue("사업자번호 유효성 실패", active.error || "유효하지 않은 번호", { biz: bizMask(bizNoDigits(bizNo)) });
    throw new Error(active.error || "유효하지 않은 사업자등록번호입니다. 번호를 다시 확인해주세요.");
  }
  const res = await fetch("/api/company/check-business-number", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessNumber: bizNoDigits(bizNo) }),
  });
  if (!res.ok) {
    const msg = (await res.json().catch(() => ({})))?.error || `사업자번호 확인 실패 (HTTP ${res.status})`;
    logSignupIssue("사업자번호 중복확인 실패", msg, { biz: bizMask(bizNoDigits(bizNo)) });
    throw new Error(msg);
  }
  return res.json();
}

// 국세청 상태 기준 가입 가능 판정 — 정상(계속사업자)만 회사 개설 허용 (2026-07-03 사장님 지시).
//   차단: 미등록(국세청에 없는 번호) · 폐업자 · 휴업자 · checksum 불일치.
//   통과: 계속사업자, 그리고 '확인불가'(국세청 API 장애) — 장애로 가입 자체를 막지 않기 위함.
//   auth 가입 폼과 /company-setup(소셜) 양쪽에서 동일하게 사용 — 중복 구현 금지.
export async function assertBizNoActive(bizNo: string): Promise<{ ok: boolean; error?: string }> {
  const v = await verifyBusinessNumber(bizNoDigits(bizNo)).catch(() => null);
  if (!v) return { ok: true }; // 조회 호출 자체가 실패(네트워크) — 장애는 통과
  if (!v.valid) return { ok: false, error: "유효하지 않은 사업자등록번호입니다. 번호를 다시 확인해주세요." };
  switch (v.status) {
    case "미등록": return { ok: false, error: "국세청에 등록되지 않은 사업자등록번호입니다. 번호를 다시 확인해주세요." };
    case "폐업자": return { ok: false, error: "폐업 처리된 사업자번호로는 가입할 수 없습니다." };
    case "휴업자": return { ok: false, error: "휴업 상태의 사업자번호입니다. 정상 영업 중인 사업자만 가입할 수 있습니다." };
    default: return { ok: true }; // 계속사업자 · 확인불가(API 장애)
  }
}

// 회사 개설 통합 게이트 (2026-07-06) — 진위확인(대표자성명+개업일자 국세청 일치) + 상태(정상 사업자).
//   사업자번호는 공개정보라 번호만으로는 선점 가능 → 대표자·개업일자까지 일치해야 개설 허용.
//   진위 API 장애 시엔 상태 조회(assertBizNoActive)로 폴백 — 이중 fail-open (장애가 가입을 막지 않음).
export async function assertBizNoOwnerValid(
  bizNo: string,
  ownerName: string,
  startDateYYYYMMDD: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!ownerName.trim()) return { ok: false, error: "대표자 성명을 입력해주세요." };
  if (startDateYYYYMMDD.replace(/[^0-9]/g, "").length !== 8) return { ok: false, error: "개업일자를 입력해주세요." };
  const v = await validateBusinessOwnership(bizNo, ownerName, startDateYYYYMMDD).catch(() => null);
  if (!v || v.result === "unavailable") return assertBizNoActive(bizNo); // 진위 API 장애 → 상태 조회 폴백
  if (v.result === "mismatch") {
    return { ok: false, error: "사업자 정보가 국세청 등록 정보와 일치하지 않습니다. 사업자등록증의 대표자 성명과 개업일자를 확인해주세요." };
  }
  // 진위 일치 — 상태까지 확인 (validate 응답에 동봉)
  switch (v.status) {
    case "폐업자": return { ok: false, error: "폐업 처리된 사업자번호로는 가입할 수 없습니다." };
    case "휴업자": return { ok: false, error: "휴업 상태의 사업자번호입니다. 정상 영업 중인 사업자만 가입할 수 있습니다." };
    default: return { ok: true };
  }
}

// 합류 요청 생성 (로그인 세션 필요 — 쿠키 인증)
export async function submitJoinRequest(bizNo: string, name?: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const res = await fetch("/api/join-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessNumber: bizNoDigits(bizNo), name: name || undefined }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) {
    logSignupIssue("합류 요청 실패", j?.error || `HTTP ${res.status}`, { biz: bizMask(bizNoDigits(bizNo)) });
    return { ok: false, error: j?.error || "합류 요청 실패" };
  }
  return { ok: true, status: j?.status };
}

export type ProvisionResult = "exists" | "created" | "join_pending" | "needs_company_setup" | "error";

// 회사 개설 + owner 연결 + 초기 데이터(스냅샷·14일 트라이얼) — 단일 진입점.
//   companies.business_number 유니크 충돌(동시 가입 레이스)은 duplicate 로 반환 → 호출부가 합류 요청으로 전환.
export async function createCompanyWithOwner(
  authId: string, email: string, companyName: string, displayName: string, bizDigits: string,
  phone?: string | null,   // 가입 시 입력한 휴대전화 — 알림톡 발송 대상(2026-07-29)
): Promise<{ ok: boolean; duplicate?: boolean; error?: string }> {
  const companyId = crypto.randomUUID();
  const { error: compErr } = await db.from("companies").insert({
    id: companyId,
    name: companyName,
    ...(bizDigits.length === 10 ? { business_number: formatBizNo(bizDigits) } : {}),
  });
  if (compErr) {
    if (bizDigits.length === 10 && (compErr.code === "23505" || /business_number/i.test(compErr.message || ""))) {
      return { ok: false, duplicate: true };
    }
    logSignupIssue("회사 생성 실패", compErr.message, { code: compErr.code, biz: bizMask(bizDigits) });
    return { ok: false, error: compErr.message };
  }

  // ⚠️ upsert(ON CONFLICT DO UPDATE) 금지 (2026-07-28 핫픽스): Postgres 는 upsert 의 INSERT
  //   경로에도 SELECT 정책을 추가 검사하는데, users 의 SELECT 정책(company_id = get_my_company_id())은
  //   아직 회사가 없는 신규 가입자에게 항상 false → 모든 신규 개설이 RLS 위반으로 실패했다.
  //   insert 후 id 충돌(23505 = 레거시 limbo 행)일 때만 본인 행 update 로 연결하는 2단계 방식 사용.
  // is_master: 역할 폐지 개편(2026-07-30) 후 관리 권한 판정은 is_master 뿐인데 신규 개설 경로가
  //   이걸 안 세팅해 새 회사 대표가 권한 0 이 되던 버그(2026-08-03 (주)노딕스 실사례 — employees
  //   생성 RLS 403, 메뉴 접근 불가). 개설자는 그 회사의 마스터다.
  let userErr: { code?: string; message: string } | null = (await db.from("users").insert({
    id: authId, auth_id: authId, company_id: companyId,
    email, name: displayName, role: "owner", is_master: true,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any)).error;
  if (userErr?.code === "23505") {
    // 레거시 limbo(행은 있는데 company_id NULL) — 본인 행 update 는 UPDATE 정책(auth_id=auth.uid())으로 허용.
    const { data: updated, error: updErr } = await db.from("users")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .update({ company_id: companyId, role: "owner", is_master: true, name: displayName, email } as any)
      .eq("id", authId)
      .select("id");
    userErr = updErr || (updated && updated.length > 0 ? null : { message: "기존 계정 정보를 갱신하지 못했습니다. 고객센터로 문의해주세요." });
  }
  if (userErr) {
    logSignupIssue("대표 계정 연결 실패", userErr.message, { code: userErr.code, biz: bizMask(bizDigits) });
    // 고아 회사 정리 — 직접 delete 는 소속 없는 사용자의 RLS 에 조용히 막힌다(0행 매칭).
    //   2026-07-28 실사례: 정리 실패로 유령 회사가 남아 그 사업자번호가 영구 잠김.
    //   소속 0명 회사만 지우는 SECURITY DEFINER RPC 로 정리.
    await (db as any).rpc("cleanup_orphan_company", { p_company_id: companyId });
    return { ok: false, error: userErr.message };
  }

  // 2026-07-16 QA: 대표는 companies+users 만 생성되고 employees 행이 없어 구성원
  //   디렉토리에 본인이 안 보이던 버그. "기존 회원을 직원으로 추가"는 본인 추가를
  //   명시적으로 막아둬서(api/add-existing-employee) 대표가 스스로를 넣을 방법이
  //   UI 에 없었음 — 가입 시점에 바로 employees 행을 만들어준다.
  const { error: empErr } = await db.from("employees").insert({
    company_id: companyId, user_id: authId, name: displayName, email,
    position: "대표", hire_date: todayKst(), status: "joined",
    // 가입 폼에서 받은 번호를 그대로 직원 레코드에 심는다 — 안 하면 알림톡 대상이 0명이 된다.
    ...(phone ? { phone } : {}),
  });
  // 실패해도 가입은 계속하되 기록은 남긴다 — 조용히 삼켜서 노딕스 건을 늦게 발견했다(2026-08-03).
  if (empErr) logSignupIssue("대표 직원 행 생성 실패", empErr.message, { code: empErr.code, biz: bizMask(bizDigits) });

  await db.from("cash_snapshot").insert({ company_id: companyId, current_balance: 0, monthly_fixed_cost: 0 });
  // 2026-07-23 가격정책: 가입 즉시 트라이얼 DB행을 만들지 않는다. 카드 등록(Stripe Checkout)
  //   완료 → webhook(checkout.session.completed) 확인 시에만 구독을 생성한다(무료체험 폐지 — 즉시 결제).
  //   그 전까지 회사는 무료 요금제(영구 무료) — billing 화면에서 오너뷰 결제 유도.
  return { ok: true };
}

// 로그인/인증 직후 public.users 부재 시 처리 — 회사 개설 또는 합류 요청.
//   metadata.join_business_number = "기존 회사 합류" 경로 → 회사 생성 대신 합류 요청.
//   metadata.business_number = 이메일 가입의 회사 개설 경로 → 사업자번호 포함 생성.
//   둘 다 없음(카카오/구글 OAuth, 구버전 가입) = needs_company_setup → /company-setup 에서
//   사업자번호 입력·중복체크·합류 흐름을 거친다. 사업자번호 없는 자동 회사 생성은 더 이상 없음.
export async function provisionCompanyForUser(user: {
  id: string; email?: string; user_metadata?: Record<string, string>;
}): Promise<ProvisionResult> {
  // 2026-07-28 P0: company_id 없는 행(레거시 limbo)을 "exists" 로 통과시키면 대시보드에서
  //   무한 로딩/리다이렉트 — 회사 연결까지 있어야 exists, 아니면 아래 개설/합류 흐름으로.
  const existingUser = logRead('lib/company-signup:existingUser', await db.from("users").select("id, company_id").eq("auth_id", user.id).maybeSingle());
  if (existingUser?.company_id) return "exists";

  const meta = user.user_metadata || {};

  // 합류 경로 — 회사 생성 금지, 합류 요청만 (API 가 중복 요청은 dedupe)
  const joinBizNo = bizNoDigits(meta.join_business_number || "");
  if (joinBizNo.length === 10) {
    const r = await submitJoinRequest(joinBizNo, meta.display_name);
    return r.ok ? "join_pending" : "error";
  }

  const bizDigits = bizNoDigits(meta.business_number || "");
  if (bizDigits.length !== 10) return "needs_company_setup";

  const companyName = meta.company_name || user.email?.split("@")[0] || "내 회사";
  const displayName = meta.display_name || user.email?.split("@")[0] || "사용자";
  const r = await createCompanyWithOwner(user.id, user.email || "", companyName, displayName, bizDigits, meta.phone || null);
  if (r.ok) return "created";
  if (r.duplicate) {
    // 유니크 충돌 = 그 사이 같은 사업자번호로 회사가 생김 → 합류 요청으로 전환
    const jr = await submitJoinRequest(bizDigits, displayName);
    return jr.ok ? "join_pending" : "error";
  }
  return "error";
}
