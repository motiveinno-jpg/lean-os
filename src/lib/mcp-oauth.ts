// 오너뷰 MCP 커넥터 — OAuth 2.1(동적 등록 + PKCE) 공용 도구. 서버 전용.
//   흐름: Claude 가 /.well-known 으로 주소를 알아내 → /api/oauth/register 로 스스로 등록 →
//   사용자를 /oauth/authorize(오너뷰 로그인·허용) 로 보냄 → 코드 → /api/oauth/token 으로 접속 토큰 →
//   /api/mcp 에 토큰을 들고 조회. 토큰은 해시만 DB 에 둔다(마이그 20260929300000).
import { createHash, randomBytes } from "node:crypto";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

export const MCP_SCOPE = "ownerview.read";
export const ACCESS_TTL_SEC = 3600;              // 접속 토큰 1시간
export const REFRESH_TTL_SEC = 90 * 24 * 3600;   // 갱신 토큰 90일(쓸 때마다 새로 발급·연장)
export const CODE_TTL_SEC = 300;                 // 허용 뒤 코드 5분

// 테이블이 생성 타입에 아직 없어 느슨하게 쓴다
export const oauthDb = () => createSupabaseAdminClient() as any;

export const sha256Hex = (s: string) => createHash("sha256").update(s).digest("hex");
export const randomToken = (prefix: string) => `${prefix}${randomBytes(32).toString("base64url")}`;

/** PKCE S256 — base64url(sha256(verifier)) === challenge */
export function pkceOk(verifier: string, challenge: string): boolean {
  if (!/^[A-Za-z0-9._~-]{43,128}$/.test(verifier)) return false;
  return createHash("sha256").update(verifier).digest("base64url") === challenge;
}

/** 이 서버의 바깥 주소 — Vercel 뒤에서는 요청 주소가 곧 공개 주소다 */
export function originOf(req: Request): string {
  const u = new URL(req.url);
  const host = req.headers.get("x-forwarded-host") || u.host;
  const proto = req.headers.get("x-forwarded-proto") || u.protocol.replace(":", "");
  return `${proto}://${host}`;
}
/** MCP 입구 주소 — trailingSlash 설정 때문에 끝 '/' 를 붙인 쪽이 정본(붙이지 않으면 308 한 번 거친다) */
export const mcpUrl = (origin: string) => `${origin}/api/mcp/`;

// 연결을 허용하는 돌아갈 주소 — 가짜 앱을 등록해 오너뷰 계정을 가로채는 수법을 막으려고 알려진 AI 만.
//   Claude(웹·데스크톱은 claude.ai/claude.com 콜백), Claude Code 등 로컬 도구(localhost).
//   다른 AI(예: ChatGPT)를 붙일 땐 여기에 그 콜백 도메인을 더한다.
const ALLOWED_REDIRECT_HOSTS = ["claude.ai", "claude.com"];
export function redirectAllowed(uri: string): boolean {
  let u: URL;
  try { u = new URL(uri); } catch { return false; }
  if (u.hash) return false;
  if (u.protocol === "https:") return ALLOWED_REDIRECT_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
  if (u.protocol === "http:") return u.hostname === "localhost" || u.hostname === "127.0.0.1";
  return false;
}

export function oauthError(error: string, description: string, status = 400) {
  return new Response(JSON.stringify({ error, error_description: description }), {
    status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}

/** 회사에 커넥터가 켜져 있나 — feature_rollout 'mcp_connector'(회사 지정 또는 전체) */
export async function mcpEnabledFor(companyId: string): Promise<boolean> {
  const { data } = await oauthDb().from("feature_rollout").select("feature")
    .eq("feature", "mcp_connector").or(`company_id.is.null,company_id.eq.${companyId}`).limit(1);
  return !!data?.length;
}

/** 접속 토큰 → 유효하면 행, 아니면 null */
export async function lookupAccessToken(token: string) {
  if (!token.startsWith("ovm_")) return null;
  const { data } = await oauthDb().from("oauth_tokens")
    .select("id, user_id, company_id, client_id, expires_at, revoked_at")
    .eq("token_hash", sha256Hex(token)).maybeSingle();
  if (!data || data.revoked_at || Date.parse(data.expires_at) <= Date.now()) return null;
  return data as { id: string; user_id: string; company_id: string; client_id: string };
}

/** OAuth 인증 서버 안내(RFC 8414) — /.well-known/oauth-authorization-server·openid-configuration 공용 */
export function authServerMetadata(req: Request) {
  const origin = originOf(req);
  return {
    issuer: origin,
    authorization_endpoint: `${origin}/oauth/authorize/`,
    token_endpoint: `${origin}/api/oauth/token/`,
    registration_endpoint: `${origin}/api/oauth/register/`,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    code_challenge_methods_supported: ["S256"],
    token_endpoint_auth_methods_supported: ["none"],
    scopes_supported: [MCP_SCOPE],
  };
}
