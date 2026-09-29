// 토큰 발급(OAuth 2.1) — 코드 + PKCE 검증 → 접속 토큰(1시간)·갱신 토큰(90일). 갱신 때마다 둘 다 새로 준다.
import {
  oauthDb, oauthError, sha256Hex, randomToken, pkceOk, mcpEnabledFor,
  ACCESS_TTL_SEC, REFRESH_TTL_SEC, MCP_SCOPE,
} from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type, authorization", "Access-Control-Allow-Methods": "POST, OPTIONS" };
export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

async function params(req: Request): Promise<Record<string, string>> {
  const ct = req.headers.get("content-type") || "";
  if (ct.includes("application/json")) return (await req.json().catch(() => ({}))) as Record<string, string>;
  const f = new URLSearchParams(await req.text());
  return Object.fromEntries(f.entries());
}

function issue(access: string, refresh: string) {
  return Response.json({
    access_token: access, token_type: "Bearer", expires_in: ACCESS_TTL_SEC,
    refresh_token: refresh, scope: MCP_SCOPE,
  }, { headers: { ...CORS, "Cache-Control": "no-store", Pragma: "no-cache" } });
}

export async function POST(req: Request) {
  const p = await params(req);
  const db = oauthDb();
  const now = Date.now();
  const access = randomToken("ovm_"), refresh = randomToken("ovr_");
  const times = {
    token_hash: sha256Hex(access), refresh_hash: sha256Hex(refresh),
    expires_at: new Date(now + ACCESS_TTL_SEC * 1000).toISOString(),
    refresh_expires_at: new Date(now + REFRESH_TTL_SEC * 1000).toISOString(),
  };

  if (p.grant_type === "authorization_code") {
    if (!p.code || !p.code_verifier || !p.client_id || !p.redirect_uri) return oauthError("invalid_request", "code·code_verifier·client_id·redirect_uri 가 필요합니다.");
    //   코드는 한 번만 — used_at 을 먼저 찍고 성공한 쪽만 진행(동시에 두 번 바꾸기 방지)
    const { data: row } = await db.from("oauth_auth_codes")
      .update({ used_at: new Date().toISOString() })
      .eq("code_hash", sha256Hex(p.code)).is("used_at", null)
      .select("client_id, user_id, company_id, redirect_uri, code_challenge, scope, expires_at").maybeSingle();
    if (!row) return oauthError("invalid_grant", "코드가 없거나 이미 쓰였습니다.");
    if (Date.parse(row.expires_at) <= now) return oauthError("invalid_grant", "코드가 만료됐습니다.");
    if (row.client_id !== p.client_id || row.redirect_uri !== p.redirect_uri) return oauthError("invalid_grant", "코드를 받은 앱·주소와 다릅니다.");
    if (!pkceOk(p.code_verifier, row.code_challenge)) return oauthError("invalid_grant", "PKCE 확인값이 맞지 않습니다.");
    const { data: client } = await db.from("oauth_clients").select("client_name").eq("client_id", row.client_id).maybeSingle();
    const { error } = await db.from("oauth_tokens").insert({
      ...times, client_id: row.client_id, client_name: client?.client_name ?? "", user_id: row.user_id, company_id: row.company_id, scope: row.scope,
    });
    if (error) return oauthError("server_error", "토큰을 만들지 못했습니다.", 500);
    await db.from("oauth_clients").update({ last_used_at: new Date().toISOString() }).eq("client_id", row.client_id);
    return issue(access, refresh);
  }

  if (p.grant_type === "refresh_token") {
    if (!p.refresh_token) return oauthError("invalid_request", "refresh_token 이 필요합니다.");
    const { data: tok } = await db.from("oauth_tokens")
      .select("id, client_id, company_id, revoked_at, refresh_expires_at")
      .eq("refresh_hash", sha256Hex(p.refresh_token)).maybeSingle();
    if (!tok || tok.revoked_at || Date.parse(tok.refresh_expires_at) <= now) return oauthError("invalid_grant", "연결이 끊겼거나 만료됐습니다. 다시 연결해 주세요.");
    if (p.client_id && p.client_id !== tok.client_id) return oauthError("invalid_grant", "다른 앱의 갱신 토큰입니다.");
    if (!(await mcpEnabledFor(tok.company_id))) return oauthError("invalid_grant", "이 회사의 AI 커넥터가 꺼졌습니다.");
    //   같은 갱신 토큰으로 두 번 바꾸면 한쪽만 성공한다(해시 조건부 update)
    const { data: upd } = await db.from("oauth_tokens").update(times)
      .eq("id", tok.id).eq("refresh_hash", sha256Hex(p.refresh_token)).select("id").maybeSingle();
    if (!upd) return oauthError("invalid_grant", "갱신 토큰이 이미 쓰였습니다.");
    return issue(access, refresh);
  }

  return oauthError("unsupported_grant_type", "authorization_code 또는 refresh_token 만 지원합니다.");
}
