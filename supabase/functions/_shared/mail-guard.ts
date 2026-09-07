// 메일 발송 함수 공용 가드 (2026-09-07 보안 정비)
//   send-* 함수들이 "로그인만 돼 있으면" 받는 사람·본문·링크를 요청 그대로 써서
//   오너뷰 도메인(noreply@owner-view.com)으로 아무 주소에나 피싱 메일을 보낼 수 있었다.
//   · escapeHtml   본문에 들어가는 모든 문자열
//   · isAppUrl     버튼 링크는 우리 사이트로만
//   · resolveCaller 호출자의 회사·역할
//   · recipientInCompany 받는 사람이 그 회사의 구성원·초대·거래처인지
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

export function escapeHtml(s: unknown): string {
  return String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

const APP_HOSTS = new Set(["www.owner-view.com", "owner-view.com"]);
for (const k of ["SITE_URL", "NEXT_PUBLIC_SITE_URL", "APP_URL"]) {
  const v = Deno.env.get(k);
  if (v) { try { APP_HOSTS.add(new URL(v).host); } catch { /* 무시 */ } }
}
export function isAppUrl(u: unknown): boolean {
  if (typeof u !== "string" || !u) return false;
  try { const p = new URL(u); return p.protocol === "https:" && APP_HOSTS.has(p.host); } catch { return false; }
}

export type Caller = { authId: string; email: string; userId: string; companyId: string; role: string; isMaster: boolean };

/** Authorization 헤더의 사용자 JWT 로 호출자를 확정한다. 회사가 없으면 null. */
export async function resolveCaller(req: Request): Promise<Caller | null> {
  const authHeader = req.headers.get("Authorization") || req.headers.get("authorization") || "";
  if (!authHeader) return null;
  const anon = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "",
    { global: { headers: { Authorization: authHeader } } });
  const { data: { user } } = await anon.auth.getUser();
  if (!user) return null;
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const { data: row } = await admin.from("users").select("id, company_id, role, is_master, email").eq("auth_id", user.id).maybeSingle();
  if (!row?.company_id) return null;
  return { authId: user.id, email: String(row.email || user.email || ""), userId: row.id, companyId: row.company_id, role: String(row.role || ""), isMaster: !!row.is_master };
}

export type RecipientKind = "user" | "employee" | "invitation" | "partner";

/** 받는 사람이 호출자 회사에 속한 사람인지 — 지정한 종류 안에서 이메일이 일치하면 true */
export async function recipientInCompany(companyId: string, email: unknown, kinds: RecipientKind[]): Promise<boolean> {
  const e = String(email || "").trim().toLowerCase();
  if (!e || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) return false;
  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  for (const k of kinds) {
    if (k === "user") {
      const { data } = await admin.from("users").select("id").eq("company_id", companyId).ilike("email", e).limit(1);
      if (data?.length) return true;
    } else if (k === "employee") {
      const { data } = await admin.from("employees").select("id").eq("company_id", companyId).ilike("email", e).limit(1);
      if (data?.length) return true;
    } else if (k === "invitation") {
      const { data: a } = await admin.from("employee_invitations").select("id").eq("company_id", companyId).ilike("email", e).eq("status", "pending").limit(1);
      if (a?.length) return true;
      const { data: b } = await admin.from("partner_invitations").select("id").eq("company_id", companyId).ilike("email", e).eq("status", "pending").limit(1);
      if (b?.length) return true;
    } else if (k === "partner") {
      const { data } = await admin.from("partners").select("id").eq("company_id", companyId).or(`email.ilike.${e},contact_email.ilike.${e}`).limit(1);
      if (data?.length) return true;
    }
  }
  return false;
}

export function deny(msg: string, status = 403, cors: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ error: msg }), { status, headers: { ...cors, "Content-Type": "application/json" } });
}
