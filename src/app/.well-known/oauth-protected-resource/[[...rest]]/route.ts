// MCP 보호 자원 안내(RFC 9728) — Claude 가 /api/mcp 에서 401 을 받으면 여기서 인증 서버 주소를 읽는다.
//   /.well-known/oauth-protected-resource 와 /…/api/mcp 처럼 경로가 붙은 형태 모두 같은 답.
import { mcpUrl, originOf, MCP_SCOPE } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

export function GET(req: Request) {
  const origin = originOf(req);
  return Response.json({
    resource: mcpUrl(origin),
    authorization_servers: [origin],
    scopes_supported: [MCP_SCOPE],
    bearer_methods_supported: ["header"],
    resource_name: "오너뷰",
  }, { headers: { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=300" } });
}
