import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// CodefCert 2.1.0 부터 인증서 서비스 전용 OAuth 서버가 분리됨(2026-07-23 헥토데이터 배포).
//   전용 토큰 엔드포인트: /oauth/token/cert. 계약이 아직 미프로비저닝일 경우 대비해 구 엔드포인트로 폴백(무중단).
const CERT_TOKEN_URL = "https://oauth.codef.io/oauth/token/cert";
const LEGACY_TOKEN_URL = "https://oauth.codef.io/oauth/token";

// CODEF 토큰 응답은 URL 인코딩되어 올 수 있어(공식 샘플 CodefOAuthConnector 참조) 디코드 후 파싱.
function parseAccessToken(raw: string): string | null {
  for (const candidate of [raw, safeDecode(raw)]) {
    try {
      const token = JSON.parse(candidate)?.access_token;
      if (typeof token === "string" && token.length > 0) return token;
    } catch { /* 다음 후보 시도 */ }
  }
  return null;
}
function safeDecode(s: string): string {
  try { return decodeURIComponent(s); } catch { return s; }
}

async function fetchToken(url: string, basicAuth: string): Promise<string | null> {
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: "grant_type=client_credentials&scope=read",
  });
  if (!res.ok) return null;
  return parseAccessToken(await res.text());
}

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.CODEF_CLIENT_ID;
  const clientSecret = process.env.CODEF_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return NextResponse.json(
      { error: "CODEF credentials not configured" },
      { status: 500 },
    );
  }

  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  // 전용 인증서 OAuth 우선, 실패 시 구 엔드포인트로 폴백(등록 흐름 무중단 보장).
  let token = await fetchToken(CERT_TOKEN_URL, basicAuth);
  if (!token) {
    console.warn("[codef/cert-token] /oauth/token/cert 실패 → 구 /oauth/token 폴백");
    token = await fetchToken(LEGACY_TOKEN_URL, basicAuth);
  }

  if (!token) {
    return NextResponse.json({ error: "CODEF token request failed" }, { status: 502 });
  }

  return NextResponse.json({ token });
}
