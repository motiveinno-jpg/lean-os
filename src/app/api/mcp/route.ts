// 오너뷰 MCP 입구(Streamable HTTP, JSON 응답) — Claude 커넥터 주소: https://www.owner-view.com/api/mcp/
//   토큰이 없거나 만료면 401 + WWW-Authenticate 로 로그인 연결(OAuth)을 시작시킨다.
//   도구 목록·실행은 AI 참모 함수(owner-copilot)의 MCP 입구에 맡긴다 — 같은 도구·같은 권한 규칙 한 벌.
import { lookupAccessToken, mcpEnabledFor, mcpUrl, originOf } from "@/lib/mcp-oauth";
import { VAULT_TOOLS, isVaultTool, callVaultTool } from "@/lib/mcp-vault";

export const dynamic = "force-dynamic";
export const maxDuration = 300;   // 파일보관함 큰 파일(100MB) 글자 뽑기

const SUPPORTED = ["2025-06-18", "2025-03-26", "2024-11-05"];
//   무언가를 만드는 도구 — AI 쪽에 읽기 전용으로 표시하지 않는다(지우거나 고치는 도구는 없다)
const WRITE_TOOLS = new Set(["create_vault_folder", "upload_vault_file", "finish_vault_upload", "delete_vault_files"]);
//   지우는 도구 — AI 쪽이 쓰기 전에 사람에게 확인받도록 destructive 로 표시한다
const DESTRUCTIVE_TOOLS = new Set(["delete_vault_files"]);
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, mcp-protocol-version, mcp-session-id",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

type Rpc = { jsonrpc?: string; id?: string | number | null; method?: string; params?: Record<string, unknown> };

export function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }
export function GET() {
  // 서버→클라이언트 알림 스트림은 쓰지 않는다(조회 전용·상태 없음)
  return new Response(null, { status: 405, headers: { ...CORS, Allow: "POST" } });
}

function unauthorized(req: Request, detail: string) {
  const origin = originOf(req);
  return new Response(JSON.stringify({ error: "invalid_token", error_description: detail }), {
    status: 401,
    headers: {
      ...CORS, "Content-Type": "application/json",
      //   HTTP 머리글은 ASCII 만 — 한글 설명은 본문에만 둔다(머리글에 넣으면 500)
      "WWW-Authenticate": `Bearer realm="ownerview", resource_metadata="${origin}/.well-known/oauth-protected-resource/", error="invalid_token"`,
    },
  });
}

async function callTools(token: string, body: Record<string, unknown>) {
  const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/owner-copilot`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      Authorization: `Bearer ${process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY}`,
      "x-ownerview-mcp": "1",
      "x-mcp-token": token,
    },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data: data as Record<string, any> };
}

const ok = (id: Rpc["id"], result: unknown) => ({ jsonrpc: "2.0", id, result });
const fail = (id: Rpc["id"], code: number, message: string) => ({ jsonrpc: "2.0", id, error: { code, message } });

export async function POST(req: Request) {
  const auth = req.headers.get("authorization") || "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return unauthorized(req, "로그인이 필요합니다");
  const tok = await lookupAccessToken(token);
  if (!tok) return unauthorized(req, "토큰이 만료됐거나 끊겼습니다");

  const raw = await req.json().catch(() => null);
  if (!raw) return Response.json(fail(null, -32700, "JSON 을 읽지 못했습니다"), { status: 400, headers: CORS });
  const batch = Array.isArray(raw);
  const msgs = (batch ? raw : [raw]) as Rpc[];

  const out: unknown[] = [];
  for (const m of msgs) {
    if (m.id === undefined || m.id === null) continue;   // 알림(notifications/*)은 답하지 않는다
    try {
      switch (m.method) {
        case "initialize": {
          const want = String(m.params?.protocolVersion || "");
          out.push(ok(m.id, {
            protocolVersion: SUPPORTED.includes(want) ? want : SUPPORTED[0],
            capabilities: { tools: { listChanged: false } },
            serverInfo: { name: "ownerview", title: "오너뷰", version: "1.0.0" },
            instructions:
              "오너뷰(한국 중소기업 경영 관리 앱)의 회사 데이터를 조회합니다. 파일보관함 폴더 만들기·파일 올리기·파일 삭제 외에는 조회만 합니다. " +
              "회사 전체 질문은 get_company_overview 부터 보고, 직원·근태·급여·미수금·통장·세금계산서·결재·일정 등은 해당 도구를 부르세요. " +
              "업무 › 파일보관함 파일은 list_vault_files 로 찾고 read_vault_file 로 내용을 읽으며, 원본 파일이 필요하면 download_vault_files 로 10분짜리 다운로드 링크를 받습니다. 폴더는 create_vault_folder, 파일 올리기는 upload_vault_file → (링크로 PUT) → finish_vault_upload 순서, 삭제는 delete_vault_files(되돌릴 수 없으니 사용자에게 확인받고 id·이름을 함께). " +
              "돈 숫자는 오너뷰 화면과 같은 기준이며, 결과의 basis·note 에 적힌 기준과 '빠진 자료(전표 안 친 건 등)'를 답에 함께 밝히세요. " +
              `연결 주소: ${mcpUrl(originOf(req))}`,
          }));
          break;
        }
        case "ping":
          out.push(ok(m.id, {}));
          break;
        case "tools/list": {
          const r = await callTools(token, { op: "list" });
          if (r.status === 401) return unauthorized(req, "토큰이 만료됐거나 끊겼습니다");
          if (r.status !== 200) { out.push(fail(m.id, -32000, String(r.data?.message || r.data?.error || "도구 목록을 불러오지 못했습니다"))); break; }
          out.push(ok(m.id, {
            tools: [
              ...(r.data.tools || []).map((t: { name: string; description: string; input_schema: unknown }) => ({
                name: t.name, description: t.description, inputSchema: t.input_schema,
              })),
              //   파일보관함 — 권한은 DB 가 그 사람 RLS 로 판정하므로 대표·직원 모두에게 준다(볼 수 있는 것만 나온다)
              ...VAULT_TOOLS,
            ].map((t) => ({ ...t, annotations: { readOnlyHint: !WRITE_TOOLS.has(t.name), destructiveHint: DESTRUCTIVE_TOOLS.has(t.name), openWorldHint: false } })),
          }));
          break;
        }
        case "tools/call": {
          const name = String(m.params?.name || "");
          const args = (m.params?.arguments && typeof m.params.arguments === "object") ? m.params.arguments : {};
          if (isVaultTool(name)) {
            if (!(await mcpEnabledFor(tok.company_id))) { out.push(fail(m.id, -32000, "이 회사는 아직 AI 커넥터가 켜져 있지 않습니다")); break; }
            out.push(ok(m.id, await callVaultTool(tok, name, args as Record<string, unknown>)));
            break;
          }
          const r = await callTools(token, { op: "call", name, args });
          if (r.status === 401) return unauthorized(req, "토큰이 만료됐거나 끊겼습니다");
          if (r.status === 400 && r.data?.error === "unknown_tool") { out.push(fail(m.id, -32602, `알 수 없는 도구입니다: ${name}`)); break; }
          if (r.status !== 200) { out.push(fail(m.id, -32000, String(r.data?.message || r.data?.error || "조회하지 못했습니다"))); break; }
          const result = r.data.result ?? {};
          const isError = !!(result && typeof result === "object" && "error" in result);
          out.push(ok(m.id, { content: [{ type: "text", text: JSON.stringify(result) }], isError }));
          break;
        }
        default:
          out.push(fail(m.id, -32601, `지원하지 않는 요청입니다: ${m.method}`));
      }
    } catch {
      out.push(fail(m.id, -32603, "처리 중 오류가 발생했습니다"));
    }
  }
  if (out.length === 0) return new Response(null, { status: 202, headers: CORS });
  return Response.json(batch ? out : out[0], { headers: { ...CORS, "Cache-Control": "no-store" } });
}
