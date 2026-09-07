// 서버 라우트용 인가 게이트 — 마스터 + 부여된 권한만 (2026-07-31 사장님: 역할 폐지).
//   service_role 로 RLS 를 우회하는 API 는 앱 레벨 인가가 유일한 방어선이라, DB 의
//   is_company_admin()/has_perm() 과 같은 기준을 여기서도 그대로 적용한다.
//   users.role(owner/admin) 은 더 이상 접근 판단에 쓰지 않는다.
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/** 상태를 바꾸는 라우트의 교차 사이트 요청 차단.
 *  브라우저는 POST 에 Origin 을 붙인다 — 있으면 우리 사이트여야 하고, 없으면 Sec-Fetch-Site 가 같은 사이트여야 한다.
 *  (SameSite=Lax 쿠키 하나에만 기대던 것을 명시적 검사로) 실패면 403 응답을 돌려주고, 통과면 null. */
export function assertSameOrigin(req: Request): NextResponse | null {
  const self = (() => { try { return new URL(req.url).origin; } catch { return ""; } })();
  const allowed = new Set([self, "https://www.owner-view.com", "https://owner-view.com", (process.env.NEXT_PUBLIC_SITE_URL || "").replace(/\/$/, "")].filter(Boolean));
  const origin = req.headers.get("origin");
  if (origin) {
    if (allowed.has(origin)) return null;
    return NextResponse.json({ error: { code: "CSRF", message: "허용되지 않은 출처의 요청입니다." } }, { status: 403 });
  }
  const site = req.headers.get("sec-fetch-site");
  if (!site || site === "same-origin" || site === "none") return null;
  return NextResponse.json({ error: { code: "CSRF", message: "허용되지 않은 출처의 요청입니다." } }, { status: 403 });
}

export type Caller = { id: string; companyId: string; isMaster: boolean };

/**
 * 호출자 조회 + 권한 검사.
 * @param admin service_role 클라이언트
 * @param authId auth.users.id (세션 사용자)
 * @param permKey 허용할 권한 키(메뉴/탭). 마스터는 키 없이 통과.
 * @returns 통과 시 Caller, 실패 시 에러 사유
 */
export async function requirePerm(
  admin: SupabaseClient,
  authId: string,
  permKey: string,
): Promise<{ ok: true; caller: Caller } | { ok: false; status: number; error: string }> {
  const { data: row } = await (admin as any)
    .from("users")
    .select("id, company_id, is_master")
    .eq("auth_id", authId)
    .maybeSingle();

  if (!row?.company_id) return { ok: false, status: 403, error: "회사 정보를 찾을 수 없습니다." };

  const caller: Caller = { id: row.id, companyId: row.company_id, isMaster: !!row.is_master };
  if (caller.isMaster) return { ok: true, caller };

  const { data: perm } = await (admin as any)
    .from("member_permissions")
    .select("perm_key")
    .eq("user_id", row.id)
    .eq("perm_key", permKey)
    .maybeSingle();

  if (!perm) return { ok: false, status: 403, error: "권한이 없습니다. 마스터에게 권한을 요청하세요." };
  return { ok: true, caller };
}
