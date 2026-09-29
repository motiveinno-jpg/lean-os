// 동적 클라이언트 등록(RFC 7591) — Claude 가 커넥터를 추가할 때 스스로 부른다.
//   공개 클라이언트(비밀 없음, PKCE 필수). 돌아갈 주소는 알려진 AI 만(mcp-oauth.redirectAllowed).
import { oauthDb, oauthError, redirectAllowed, randomToken } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(req: Request) {
  const body = await req.json().catch(() => null) as { redirect_uris?: unknown; client_name?: unknown } | null;
  const uris = Array.isArray(body?.redirect_uris) ? (body!.redirect_uris as unknown[]).map(String).slice(0, 10) : [];
  if (uris.length === 0) return oauthError("invalid_redirect_uri", "redirect_uris 가 필요합니다.");
  const bad = uris.find((u) => !redirectAllowed(u));
  if (bad) return oauthError("invalid_redirect_uri", `허용되지 않은 돌아갈 주소입니다: ${bad}`);
  const clientName = String(body?.client_name ?? "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 80) || "AI 연결 앱";
  const clientId = randomToken("ovc_");
  const { error } = await oauthDb().from("oauth_clients").insert({ client_id: clientId, client_name: clientName, redirect_uris: uris });
  if (error) return oauthError("server_error", "등록하지 못했습니다.", 500);
  return Response.json({
    client_id: clientId,
    client_id_issued_at: Math.floor(Date.now() / 1000),
    client_name: clientName,
    redirect_uris: uris,
    grant_types: ["authorization_code", "refresh_token"],
    response_types: ["code"],
    token_endpoint_auth_method: "none",
  }, { status: 201, headers: { ...CORS, "Cache-Control": "no-store" } });
}
