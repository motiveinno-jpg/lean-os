// 홈택스 연결 검증 (2026-08-05) — 클라이언트가 호출하던 codef-sync action 'hometax-verify' 는
//   서버에 구현된 적이 없어 기본 sync 로 폴스루되던 결함. 전용 함수로 신설.
//   검증 방식: 등록여부 전용 API(스펙 미보유) 추측 대신, 매일 cron 으로 검증되는
//   '전자세금계산서 통합' 조회를 1일 범위로 호출해 인증 성공(CF-00000) 여부로 판정.
//   CodefCert 웹 샘플가이드(v1.3.0 §5)에 따라 엔진 추출 PFX(certType "0")를 정식 지원 —
//   pfxFile 이 오면 PFX 로, 없으면 storage 의 der/key(certType "1")로 인증.
import { withSentry } from "../_shared/sentry.ts";
import { createMeterStore, runWithMeter, meterPush, flushCodefUsage } from "../_shared/codef-meter.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { publicEncrypt, constants } from "node:crypto";
import { Buffer } from "node:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const CODEF_BASE = (Deno.env.get("CODEF_ENV") || "sandbox") === "production"
  ? "https://api.codef.io"
  : "https://development.codef.io";
const CODEF_TOKEN_URL = "https://oauth.codef.io/oauth/token";

function rsaEncrypt(plainText: string, publicKeyRaw: string): string {
  const base64Body = publicKeyRaw.replace(/-----BEGIN PUBLIC KEY-----/, "").replace(/-----END PUBLIC KEY-----/, "").replace(/\s/g, "");
  const lines = base64Body.match(/.{1,64}/g)?.join("\n") || base64Body;
  const pem = `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
  return publicEncrypt({ key: pem, padding: constants.RSA_PKCS1_PADDING }, Buffer.from(plainText, "utf8")).toString("base64");
}

async function getCodefToken(clientId: string, clientSecret: string): Promise<string> {
  const res = await fetch(CODEF_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${clientId}:${clientSecret}`)}` },
    body: "grant_type=client_credentials&scope=read",
  });
  if (!res.ok) throw new Error(`CODEF token error: ${res.status}`);
  return (await res.json()).access_token;
}

async function codefRequest(token: string, path: string, body: Record<string, any>): Promise<any> {
  console.log(`[CODEF] ${path}`); // 요청 body 미로깅(민감정보)
  const res = await fetch(`${CODEF_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${token}` },
    body: encodeURIComponent(JSON.stringify(body)),
  });
  if (!res.ok) {
    meterPush(path, `HTTP_${res.status}`);
    throw new Error(`CODEF API error: ${res.status}`);
  }
  const text = await res.text();
  let parsed: any;
  try { parsed = JSON.parse(decodeURIComponent(text)); } catch { parsed = JSON.parse(text); }
  meterPush(path, parsed.result?.code || "UNKNOWN");
  return parsed;
}

serve(withSentry("hometax-verify", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const meterStore = createMeterStore("hometax-verify");
  return await runWithMeter(meterStore, async () => {
  try {
    const authHeader = req.headers.get("authorization") || "";
    const jwt = authHeader.replace(/^Bearer\s+/i, "");
    if (!jwt) return json({ error: "Unauthorized" }, 401);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );
    // getUser 는 반드시 토큰 명시 전달 — 고정버전 supabase-js 무인자 호출 함정 회피.
    const anon = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_ANON_KEY") ?? "");
    const { data: { user } } = await anon.auth.getUser(jwt);
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { companyId, pfxFile, certPassword, loginType = "0", id, userPassword } = await req.json();
    if (!companyId) return json({ error: "companyId required" }, 400);
    meterStore.companyId = companyId;

    // IDOR 가드 — codef-sync 와 동일 규칙: 호출자가 그 회사 소속이어야 함.
    const { data: callerRow } = await supabase.from("users").select("company_id").eq("auth_id", user.id).maybeSingle();
    if (!callerRow || callerRow.company_id !== companyId) {
      return json({ error: "권한이 없습니다." }, 403);
    }

    if (loginType === "0" && !certPassword) return json({ error: "certPassword 필수" }, 400);
    if (loginType === "1" && (!id || !userPassword)) return json({ error: "id, userPassword 필수" }, 400);

    // 인증 자료 구성 — 인증서(loginType 0): pfxFile 우선(certType "0"), 없으면 storage 의 der/key(certType "1")
    let certAuth: Record<string, string>;
    if (loginType === "1") {
      certAuth = { id };
    } else if (pfxFile) {
      certAuth = { certType: "0", certFile: pfxFile };
    } else {
      const [certDl, keyDl] = await Promise.all([
        supabase.storage.from("certificates").download(`${companyId}/signCert.der`),
        supabase.storage.from("certificates").download(`${companyId}/signPri.key`),
      ]);
      if (certDl.error || !certDl.data || keyDl.error || !keyDl.data) {
        return json({ error: "인증서 파일이 없습니다. PC 자동 선택 또는 파일 업로드로 인증서를 제공해주세요." }, 400);
      }
      certAuth = {
        certType: "1",
        certFile: Buffer.from(new Uint8Array(await certDl.data.arrayBuffer())).toString("base64"),
        keyFile: Buffer.from(new Uint8Array(await keyDl.data.arrayBuffer())).toString("base64"),
      };
    }

    const clientId = (Deno.env.get("CODEF_CLIENT_ID") || "").trim();
    const clientSecret = (Deno.env.get("CODEF_CLIENT_SECRET") || "").trim();
    const publicKey = Deno.env.get("CODEF_PUBLIC_KEY") || "";
    if (!clientId || !clientSecret) return json({ error: "CODEF 인증정보 미설정" }, 500);

    const token = await getCodefToken(clientId, clientSecret);
    const plainPw = loginType === "1" ? userPassword : certPassword;
    const encryptedPw = publicKey ? rsaEncrypt(plainPw, publicKey) : plainPw;
    const pwField = loginType === "1" ? { password: encryptedPw } : { certPassword: encryptedPw };

    // 오늘 1일 범위 매출 목록 조회 — 인증 성공 여부만 판정 (성공 시 국세청 조회 1건 과금)
    const todayYmd = new Date().toISOString().slice(0, 10).replaceAll("-", "");
    const result = await codefRequest(token, "/v1/kr/public/nt/tax-invoice/integrated-check-list", {
      organization: "0002",
      loginType,
      ...certAuth,
      ...pwField,
      inquiryType: "01",
      searchType: "01",
      startDate: todayYmd,
      endDate: todayYmd,
      sortby: "1",
      orderBy: "0",
      transeType: "01",
      type: "0",
    });

    const code = result.result?.code || "UNKNOWN";
    if (code === "CF-00000") {
      return json({ registered: true, message: "홈택스 인증 성공 — 인증서로 세금계산서 조회가 가능합니다.", code, method: pfxFile ? "pfx" : "derkey" });
    }
    // 인증 실패류 — 화면에서 원인 구분 가능하게 코드 그대로 반환
    return json({
      registered: false,
      code,
      message: result.result?.message || "홈택스 인증 실패",
      method: pfxFile ? "pfx" : "derkey",
    });
  } catch (err: any) {
    return json({ error: err.message || "Internal error" }, 500);
  } finally {
    await flushCodefUsage(meterStore);
  }
  });
}));
