// CODEF 인증서 중계 서버 왕복 (2026-08-05) — 공식 웹 샘플(codefcert-sample-web back)의
//   CodefCredentialConnector 를 그대로 이식. 엔진(engineGetExportCertificationB64) 산출 PFX 는
//   중계 서버(relay.codef.io)가 받도록 설계된 형식이라, ①인증번호 발급 ②내보내기(export)
//   ③가져오기(import) 왕복을 거쳐 CODEF 가 돌려주는 pfxFile 을 계정등록에 사용한다.
//   (엔진 산출물을 등록 API 에 직접 넣으면 CF-04009 — 2026-08-04~05 실증)
//   토큰: 샘플 back 의 CodefOAuthConnector 와 동일하게 /oauth/token/cert 사용.
import { withSentry } from "../_shared/sentry.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const RELAY_BASE = "https://relay.codef.io";
const CERT_TOKEN_URL = "https://oauth.codef.io/oauth/token/cert";
const LEGACY_TOKEN_URL = "https://oauth.codef.io/oauth/token";

async function getToken(url: string, basic: string): Promise<string | null> {
  const r = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${basic}` },
    body: "grant_type=client_credentials&scope=read",
  });
  if (!r.ok) return null;
  const t = await r.text();
  for (const c of [t, safeDecode(t)]) {
    try { const tok = JSON.parse(c)?.access_token; if (tok) return tok; } catch (_) { /* 다음 후보 */ }
  }
  return null;
}
function safeDecode(s: string): string { try { return decodeURIComponent(s); } catch { return s; } }

async function relay(token: string, method: "GET" | "POST", path: string, body?: unknown): Promise<any> {
  const r = await fetch(`${RELAY_BASE}${path}`, {
    method,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: body ? JSON.stringify(body) : undefined,
  });
  const t = await r.text();
  try { return JSON.parse(t); } catch { return { http: r.status, raw: t.slice(0, 200) }; }
}

serve(withSentry("codef-cert-relay", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);
    const anon = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    // getUser 는 토큰 명시 전달 — 고정버전 supabase-js 무인자 호출 함정 회피
    const { data: { user } } = await anon.auth.getUser(jwt);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { pfxFile } = await req.json();
    if (!pfxFile) return json({ error: "pfxFile 필수" }, 400);

    const cid = (Deno.env.get("CODEF_CLIENT_ID") || "").trim();
    const csec = (Deno.env.get("CODEF_CLIENT_SECRET") || "").trim();
    if (!cid || !csec) return json({ error: "CODEF 인증정보 미설정" }, 500);
    const basic = btoa(`${cid}:${csec}`);
    const token = (await getToken(CERT_TOKEN_URL, basic)) || (await getToken(LEGACY_TOKEN_URL, basic));
    if (!token) return json({ error: "CODEF 토큰 발급 실패" }, 502);

    // ① 인증번호 발급 (샘플: GET /authNo?transferType=0&credential=)
    const authRes = await relay(token, "GET", "/authNo?transferType=0&credential=");
    const authNo = authRes?.data?.authNo;
    if (authRes?.result?.code !== "CF-00000" || !authNo) {
      return json({ error: `인증번호 발급 실패 (${authRes?.result?.code || authRes?.http || "?"}) ${authRes?.result?.message || ""}`, step: "authNo" }, 502);
    }

    // ② 내보내기 (샘플: POST /certification {authNo, pfxFile})
    const expRes = await relay(token, "POST", "/certification?transferType=0&credential=", { authNo, pfxFile });
    if (expRes?.result?.code !== "CF-00000") {
      return json({ error: `내보내기 실패 (${expRes?.result?.code || expRes?.http || "?"}) ${expRes?.result?.message || ""}`, step: "export" }, 502);
    }

    // ③ 가져오기 (샘플: GET /certification/{authNo}) — CODEF 가 보관·반환하는 pfxFile 수신
    const impRes = await relay(token, "GET", `/certification/${authNo}`);
    const outPfx = impRes?.data?.pfxFile;
    if (impRes?.result?.code !== "CF-00000" || !outPfx) {
      return json({ error: `가져오기 실패 (${impRes?.result?.code || impRes?.http || "?"}) ${impRes?.result?.message || ""}`, step: "import" }, 502);
    }

    console.log(`[cert-relay] roundtrip ok — in=${String(pfxFile).length}b64, out=${String(outPfx).length}b64, same=${outPfx === pfxFile}`);
    return json({ pfxFile: outPfx, same: outPfx === pfxFile });
  } catch (err) {
    return json({ error: err instanceof Error ? err.message : String(err) }, 500);
  }
}));
