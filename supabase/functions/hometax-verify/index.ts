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

// PFX 구조 진단 — 어떤 PBE 알고리즘으로 포장됐는지 OID 바이트 패턴으로 식별 (키 재료는 읽지 않음).
//   엔진 추출 PFX 가 CODEF 계정등록에서 CF-04009 로 거부되는 원인 판별용 (2026-08-05).
//   SEED 류(한국 표준)면 계정등록 파서 미지원 가능성 — 재암호화 변환으로 해결 예정.
const PBE_OID_HEX: Record<string, string> = {
  seedCBC: "2a831a8c9a440104",
  seedCBCWithSHA1: "2a831a8c9a44010f",
  ariaCBC: "2a831a8c9a6e010102",
  aes128CBC: "608648016503040102",
  aes256CBC: "60864801650304012a",
  pbeSHA_3DES: "2a864886f70d010c0103",
  pbeSHA_RC2_40: "2a864886f70d010c0106",
  PBES2: "2a864886f70d01050d",
};
function sniffPfxAlgos(pfxB64: string): string[] {
  try {
    const bytes = Uint8Array.from(atob(pfxB64), (c) => c.charCodeAt(0));
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    const found: string[] = [];
    for (const [name, oid] of Object.entries(PBE_OID_HEX)) {
      if (hex.includes(oid)) found.push(name);
    }
    const validMagic = bytes[0] === 0x30; // DER SEQUENCE — PKCS#12 시작
    return [validMagic ? "der-ok" : `der-bad(0x${bytes[0]?.toString(16)})`, ...found];
  } catch (_) {
    return ["b64-decode-fail"];
  }
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

    const { companyId, pfxFile, derFile, keyFile, certPassword, loginType = "0", id, userPassword } = await req.json();
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
    let pfxAlgos: string[] | undefined;
    if (loginType === "1") {
      certAuth = { id };
    } else if (derFile && keyFile) {
      // 저장 전 사전 검증(transient) — 통과해야만 클라이언트가 storage 에 저장한다 (2026-08-05:
      //   변환 der/key 를 검증 없이 먼저 저장했다가 정상 파일을 덮어쓴 사고 재발 방지).
      certAuth = { certType: "1", certFile: derFile, keyFile };
    } else if (pfxFile) {
      pfxAlgos = sniffPfxAlgos(pfxFile);
      console.log(`[hometax-verify] pfx algos: ${pfxAlgos.join(",")} len=${pfxFile.length}`);
      // CODEF API팀 답변(2026-08-05): pfx 인증서는 certType "0" 이 아니라 "pfx" — 은행 등록에서 실증.
      certAuth = { certType: "pfx", certFile: pfxFile };
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
      return json({ registered: true, message: "홈택스 인증 성공 — 인증서로 세금계산서 조회가 가능합니다.", code, method: pfxFile ? "pfx" : "derkey", pfxAlgos });
    }
    // 인증 실패류 — 화면에서 원인 구분 가능하게 코드·PFX 알고리즘 진단 그대로 반환
    return json({
      registered: false,
      code,
      message: (result.result?.message || "홈택스 인증 실패") + (pfxAlgos ? ` [pfx: ${pfxAlgos.join(",")}]` : ""),
      method: pfxFile ? "pfx" : "derkey",
      pfxAlgos,
    });
  } catch (err: any) {
    return json({ error: err.message || "Internal error" }, 500);
  } finally {
    await flushCodefUsage(meterStore);
  }
  });
}));
