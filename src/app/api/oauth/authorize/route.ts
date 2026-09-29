// 허용 화면(/oauth/authorize)이 부른다 — 로그인한 오너뷰 사용자가 "허용"을 누르면 5분짜리 코드를 만들어
//   Claude 로 돌아갈 주소를 돌려준다. GET 은 화면이 띄우기 전에 연결 앱 이름·돌아갈 곳을 확인하는 용도.
import { NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { assertSameOrigin } from "@/lib/api-authz";
import { oauthDb, sha256Hex, randomToken, mcpEnabledFor, MCP_SCOPE, CODE_TTL_SEC } from "@/lib/mcp-oauth";

export const dynamic = "force-dynamic";

async function loadClient(clientId: string, redirectUri: string) {
  const { data } = await oauthDb().from("oauth_clients").select("client_id, client_name, redirect_uris").eq("client_id", clientId).maybeSingle();
  if (!data) return { error: "연결 앱을 찾을 수 없습니다. AI 쪽에서 커넥터를 다시 추가해 주세요." } as const;
  if (!(data.redirect_uris as string[]).includes(redirectUri)) return { error: "돌아갈 주소가 등록된 것과 다릅니다." } as const;
  return { client: data as { client_id: string; client_name: string } } as const;
}

async function me() {
  const supabase = await createSupabaseServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data: profile } = await oauthDb().from("users").select("id, name, email, company_id, is_master, companies!users_company_id_fkey(name)").eq("auth_id", user.id).maybeSingle();
  return profile ? { authId: user.id, ...profile } as { authId: string; name: string | null; email: string | null; company_id: string | null; is_master: boolean | null; companies: { name: string } | null } : null;
}

export async function GET(req: Request) {
  const u = new URL(req.url);
  const c = await loadClient(u.searchParams.get("client_id") || "", u.searchParams.get("redirect_uri") || "");
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: 400 });
  const who = await me();
  if (!who) return NextResponse.json({ login: true }, { status: 401 });
  if (!who.company_id) return NextResponse.json({ error: "회사에 소속된 계정만 연결할 수 있습니다." }, { status: 403 });
  const enabled = await mcpEnabledFor(who.company_id);
  return NextResponse.json({
    client_name: c.client.client_name,
    redirect_host: new URL(u.searchParams.get("redirect_uri") || "").host,
    user: { name: who.name, email: who.email, company: who.companies?.name ?? null, scope: who.is_master ? "회사 전체(대표·관리자 권한)" : "본인 범위(직원 권한)" },
    enabled,
  });
}

export async function POST(req: Request) {
  const bad = assertSameOrigin(req);
  if (bad) return bad;
  const b = await req.json().catch(() => ({})) as Record<string, string>;
  const redirectUri = String(b.redirect_uri || "");
  const c = await loadClient(String(b.client_id || ""), redirectUri);
  if ("error" in c) return NextResponse.json({ error: c.error }, { status: 400 });
  const back = new URL(redirectUri);
  if (b.state) back.searchParams.set("state", String(b.state));

  if (b.decision !== "allow") {
    back.searchParams.set("error", "access_denied");
    return NextResponse.json({ redirect: back.toString() });
  }
  if (b.response_type && b.response_type !== "code") return NextResponse.json({ error: "지원하지 않는 요청 형식입니다." }, { status: 400 });
  if (b.code_challenge_method !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(String(b.code_challenge || ""))) {
    return NextResponse.json({ error: "보안 확인값(PKCE)이 없습니다. AI 쪽에서 다시 연결해 주세요." }, { status: 400 });
  }
  const who = await me();
  if (!who) return NextResponse.json({ error: "로그인이 필요합니다." }, { status: 401 });
  if (!who.company_id) return NextResponse.json({ error: "회사에 소속된 계정만 연결할 수 있습니다." }, { status: 403 });
  if (!(await mcpEnabledFor(who.company_id))) return NextResponse.json({ error: "이 회사는 아직 AI 커넥터가 켜져 있지 않습니다." }, { status: 403 });

  const code = randomToken("ovk_");
  const { error } = await oauthDb().from("oauth_auth_codes").insert({
    code_hash: sha256Hex(code), client_id: c.client.client_id, user_id: who.authId, company_id: who.company_id,
    redirect_uri: redirectUri, code_challenge: b.code_challenge, scope: MCP_SCOPE,
    resource: b.resource ? String(b.resource).slice(0, 300) : null,
    expires_at: new Date(Date.now() + CODE_TTL_SEC * 1000).toISOString(),
  });
  if (error) return NextResponse.json({ error: "연결 코드를 만들지 못했습니다." }, { status: 500 });
  back.searchParams.set("code", code);
  return NextResponse.json({ redirect: back.toString() });
}
