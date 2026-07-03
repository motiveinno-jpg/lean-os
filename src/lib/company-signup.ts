// 가입·회사 개설·합류 공용 로직 (2026-07-03)
//   원칙: 1 사업자번호 = 1 회사. 가입 시 사업자번호 필수 → 형식/실체/중복 3중 검증.
//   이미 등록된 사업자번호면 회사를 새로 만들지 않고 '합류 요청'으로 전환.
//   auth/page.tsx(즉시 세션)·auth/verify(이메일 인증·OAuth) 양쪽에서 재사용 — 중복 구현 금지.

import { supabase } from "./supabase";
import { createTrialingSubscription } from "./billing";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export const bizNoDigits = (input: string) => String(input || "").replace(/[^0-9]/g, "").slice(0, 10);
export const formatBizNo = (digits: string) =>
  digits.length === 10 ? `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}` : digits;
export const isValidBizNo = (input: string) => bizNoDigits(input).length === 10;

// 사업자번호 중복(기등록 회사) 확인 — 서버 API(service role) 경유 (RLS로 클라 직접 조회 불가)
export async function checkBusinessNumberRegistered(bizNo: string): Promise<{ registered: boolean; companyNameMasked?: string }> {
  const res = await fetch("/api/company/check-business-number", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessNumber: bizNoDigits(bizNo) }),
  });
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "사업자번호 확인 실패");
  return res.json();
}

// 합류 요청 생성 (로그인 세션 필요 — 쿠키 인증)
export async function submitJoinRequest(bizNo: string, name?: string): Promise<{ ok: boolean; status?: string; error?: string }> {
  const res = await fetch("/api/join-request", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ businessNumber: bizNoDigits(bizNo), name: name || undefined }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok) return { ok: false, error: j?.error || "합류 요청 실패" };
  return { ok: true, status: j?.status };
}

export type ProvisionResult = "exists" | "created" | "join_pending" | "needs_company_setup" | "error";

// 회사 개설 + owner 연결 + 초기 데이터(스냅샷·30일 트라이얼) — 단일 진입점.
//   companies.business_number 유니크 충돌(동시 가입 레이스)은 duplicate 로 반환 → 호출부가 합류 요청으로 전환.
export async function createCompanyWithOwner(
  authId: string, email: string, companyName: string, displayName: string, bizDigits: string,
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
    return { ok: false, error: compErr.message };
  }

  const { error: userErr } = await db.from("users").insert({
    id: authId, auth_id: authId, company_id: companyId,
    email, name: displayName, role: "owner",
  });
  if (userErr) {
    await db.from("companies").delete().eq("id", companyId); // 고아 회사 정리
    return { ok: false, error: userErr.message };
  }

  await db.from("cash_snapshot").insert({ company_id: companyId, current_balance: 0, monthly_fixed_cost: 0 });
  await createTrialingSubscription(companyId, "starter", 30);
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
  const { data: existingUser } = await db.from("users").select("id").eq("auth_id", user.id).maybeSingle();
  if (existingUser) return "exists";

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
  const r = await createCompanyWithOwner(user.id, user.email || "", companyName, displayName, bizDigits);
  if (r.ok) return "created";
  if (r.duplicate) {
    // 유니크 충돌 = 그 사이 같은 사업자번호로 회사가 생김 → 합류 요청으로 전환
    const jr = await submitJoinRequest(bizDigits, displayName);
    return jr.ok ? "join_pending" : "error";
  }
  return "error";
}
