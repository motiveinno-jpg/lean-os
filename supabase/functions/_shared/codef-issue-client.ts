// CODEF 발행 계열 API 공용 클라이언트 — 토큰 발급 + 요청(응답 디코딩·사용량 계측 포함).
//   hometax-issue 와 issue-request-public 이 같이 쓴다. 코드는 hometax-issue 에 있던 그대로다.
import { tfetch } from "./http.ts";
import { meterPush } from "./codef-meter.ts";

// CODEF API endpoints
export const CODEF_ENV = Deno.env.get("CODEF_ENV") || "sandbox";
export const CODEF_BASE = CODEF_ENV === "production"
  ? "https://api.codef.io"
  : CODEF_ENV === "development"
    ? "https://development.codef.io"
    : "https://sandbox.codef.io";
const CODEF_TOKEN_URL = "https://oauth.codef.io/oauth/token";

// Token cache
let tokenCache: { token: string; expiresAt: number } | null = null;

export async function getCodefToken(clientId: string, clientSecret: string): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now()) return tokenCache.token;
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const res = await tfetch(CODEF_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basicAuth}` },
    body: "grant_type=client_credentials&scope=read",
  });
  if (!res.ok) throw new Error(`CODEF token error: ${res.status}`);
  const data = await res.json();
  tokenCache = { token: data.access_token, expiresAt: Date.now() + (data.expires_in - 60) * 1000 };
  return data.access_token;
}

export async function codefRequest(token: string, path: string, body: Record<string, unknown>): Promise<any> {
  let res: Response;
  try {
    res = await tfetch(`${CODEF_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${token}` },
      body: encodeURIComponent(JSON.stringify(body)),
    });
  } catch (e) {
    meterPush(path, "FETCH_ERROR");
    throw e;
  }
  if (!res.ok) {
    meterPush(path, `HTTP_${res.status}`);
    throw new Error(`CODEF API error: ${res.status}`);
  }
  const text = await res.text();
  // 2026-07-16 QA: CODEF 응답은 application/x-www-form-urlencoded 라 공백이 '+' 로 옴.
  //   decodeURIComponent 는 '+' 를 공백으로 안 바꿔줘서(%XX 만 디코딩) 메시지가
  //   "API+요청+처리중..." 처럼 깨져 저장되던 버그 — '+' → 공백 치환을 먼저 해준다.
  let parsed: any;
  try { parsed = JSON.parse(decodeURIComponent(text.replace(/\+/g, " "))); }
  catch { parsed = JSON.parse(text); }
  meterPush(path, parsed?.result?.code || "UNKNOWN");
  return parsed;
}
