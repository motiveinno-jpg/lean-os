// OAuth 인증 서버 안내(RFC 8414) — Claude 가 등록·로그인·토큰 주소를 여기서 읽는다.
import { authServerMetadata } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  return Response.json(authServerMetadata(req), { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
}
