import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

//   외부 서명 페이지(/sign)의 갑 직인 이미지 — 직인은 비공개 버킷(company-private)이라
//   익명 서명자는 서명 URL 을 만들 수 없다(RLS: 회사 사용자만). 그래서 서명 토큰(=secret)으로만
//   접근하는 이 서버 라우트가 토큰을 검증(SECURITY DEFINER RPC)해 그 계약의 회사 직인을
//   service_role 로 내려받아 이미지 바이트로 돌려준다. 유효 토큰이 없으면 아무 것도 주지 않는다.
export const runtime = "nodejs";

function parseStorage(url: string): { bucket: string; path: string } | null {
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/([^/?#]+)\/([^?#]+)/);
  if (!m) return null;
  try { return { bucket: m[1], path: decodeURIComponent(m[2]) }; } catch { return { bucket: m[1], path: m[2] }; }
}

function sealFromNotes(notes: unknown): string | null {
  if (typeof notes !== "string") return null;
  try { const p = JSON.parse(notes); return (p && typeof p.seal_url === "string") ? p.seal_url : null; } catch { return null; }
}

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "no token" }, { status: 400 });

  const admin = createSupabaseAdminClient();

  //   토큰으로 직인 저장 URL 을 찾는다 — 계약 패키지·단체 서명요청 두 흐름 모두 시도.
  let sealUrl: string | null = null;
  try {
    const { data: pkg } = await admin.rpc("get_contract_package_by_token", { p_token: token });
    if (pkg) {
      sealUrl = sealFromNotes((pkg as { notes?: unknown }).notes)
        || ((pkg as { companies?: { seal_url?: string | null } | null }).companies?.seal_url ?? null);
    }
  } catch { /* 아래 흐름 시도 */ }
  if (!sealUrl) {
    try {
      const { data: ctx } = await admin.rpc("get_signature_context_by_token", { p_sign_token: token });
      sealUrl = (ctx as { company?: { seal_url?: string | null } | null } | null)?.company?.seal_url ?? null;
    } catch { /* 없음 */ }
  }
  if (!sealUrl) return NextResponse.json({ error: "no seal" }, { status: 404 });

  //   data: 는 그대로 이미지로 되돌린다.
  if (sealUrl.startsWith("data:")) {
    const m = sealUrl.match(/^data:([^;,]+)[^,]*,([\s\S]*)$/);
    if (!m) return NextResponse.json({ error: "bad data url" }, { status: 404 });
    const isB64 = /;base64/i.test(sealUrl);
    const buf = isB64 ? Buffer.from(m[2], "base64") : Buffer.from(decodeURIComponent(m[2]), "utf8");
    return new NextResponse(buf, { headers: { "Content-Type": m[1] || "image/png", "Cache-Control": "private, max-age=300" } });
  }

  const parsed = parseStorage(sealUrl);
  if (!parsed) return NextResponse.json({ error: "unsupported seal url" }, { status: 404 });
  try {
    const { data, error } = await admin.storage.from(parsed.bucket).download(parsed.path);
    if (error || !data) return NextResponse.json({ error: "seal not found" }, { status: 404 });
    const ct = data.type && data.type.startsWith("image/") ? data.type : "image/png";
    const buf = Buffer.from(await data.arrayBuffer());
    if (buf.byteLength > 5 * 1024 * 1024) return NextResponse.json({ error: "seal too large" }, { status: 413 });
    return new NextResponse(buf, { headers: { "Content-Type": ct, "Cache-Control": "private, max-age=300" } });
  } catch {
    return NextResponse.json({ error: "seal read failed" }, { status: 502 });
  }
}
