// 일부 클라이언트는 OAuth 안내 대신 OIDC 주소를 먼저 찾는다 — 같은 내용을 준다(ID 토큰은 발급하지 않음).
import { authServerMetadata } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return Response.json(authServerMetadata(req), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
}
