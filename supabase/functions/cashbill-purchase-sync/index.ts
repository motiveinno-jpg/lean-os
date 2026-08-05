import { withSentry } from "../_shared/sentry.ts";
import { tfetch } from "../_shared/http.ts";
import { createMeterStore, runWithMeter, meterPush, flushCodefUsage } from "../_shared/codef-meter.ts";
// cashbill-purchase-sync: 현금영수증 매입내역 수집 (CODEF 국세청 현금영수증 매입내역 API)
//
// 공식 가이드(developer.codef.io, 2026-06-11) 기준:
//   POST /v1/kr/public/nt/cash-receipt/purchase-details — organization "0003" 고정
//   인증: 홈택스 공동인증서(loginType "0" + certType "1" + certFile/keyFile + RSA 암호화 비밀번호)
//   조회가능기간 최근 37개월. 요청 시작일이 그보다 이르면 CODEF 가 가능 시작일로 자동 보정.
//   추가인증(2-way, CF-03002/continue2Way)은 간편인증(loginType "5") 경로에서 발생 —
//   인증서 로그인에서는 원칙적으로 없지만, 오면 그대로 사용자에게 안내한다(자동 승인 시도 금지).
//
// ⚠️ codef-sync 의 홈택스 분기(BLOCKED 영역)와 별개의 신규 함수 — 기존 sync 코드는 건드리지 않는다.
//    인증서 로딩 방식(storage certificates/{companyId} + automation_credentials.hometax)은 동일 규약.
//
// 결과는 cash_receipts 에 type='expense', source='hometax_sync' 로 적재.
// 중복 방지: 같은 회사·같은 승인번호(resApprovalNo)·같은 매입일자 조합은 스킵.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { publicEncrypt, constants } from "node:crypto";
import { Buffer } from "node:buffer";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const CODEF_ENV = Deno.env.get("CODEF_ENV") || "sandbox";
const CODEF_BASE = CODEF_ENV === "production"
  ? "https://api.codef.io"
  : CODEF_ENV === "development"
    ? "https://development.codef.io"
    : "https://sandbox.codef.io";
const CODEF_TOKEN_URL = "https://oauth.codef.io/oauth/token";

const PURCHASE_PATH = "/v1/kr/public/nt/cash-receipt/purchase-details";
// 현금영수증 organization 코드 (가이드 고정값)
const CASH_RECEIPT_ORG = "0003";
// 가이드 Timeout 300초지만 Supabase Edge 게이트웨이 한계(150초) 안에서 응답해야 한다 —
// 135초로 cap 하고, 초과 시 기간을 줄여 재시도하도록 안내한다.
const REQUEST_TIMEOUT_MS = 135_000;

let tokenCache: { token: string; expiresAt: number } | null = null;

async function getCodefToken(clientId: string, clientSecret: string): Promise<string> {
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

async function codefRequest(token: string, path: string, body: Record<string, unknown>, timeoutMs?: number): Promise<any> {
  let res: Response;
  try {
    res = await tfetch(`${CODEF_BASE}${path}`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Bearer ${token}` },
      body: encodeURIComponent(JSON.stringify(body)),
    }, timeoutMs);
  } catch (e) {
    meterPush(path, "FETCH_ERROR");
    throw e;
  }
  if (!res.ok) {
    meterPush(path, `HTTP_${res.status}`);
    throw new Error(`CODEF API error: ${res.status}`);
  }
  const text = await res.text();
  // urlencoded 응답의 공백이 '+' 로 오는 버그 — hometax-issue 7/16 수정과 동일 치환 (2026-08-04)
  let parsed: any;
  try { parsed = JSON.parse(decodeURIComponent(text.replace(/\+/g, " "))); }
  catch { parsed = JSON.parse(text); }
  meterPush(path, parsed?.result?.code || "UNKNOWN");
  return parsed;
}

// RSA encrypt password with CODEF public key (PKCS1v1.5 padding required by CODEF)
function rsaEncrypt(plainText: string, publicKeyRaw: string): string {
  const base64Body = publicKeyRaw
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s/g, "");
  const lines = base64Body.match(/.{1,64}/g)?.join("\n") || base64Body;
  const pem = `-----BEGIN PUBLIC KEY-----\n${lines}\n-----END PUBLIC KEY-----`;
  const encrypted = publicEncrypt(
    { key: pem, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(plainText, "utf8"),
  );
  return encrypted.toString("base64");
}

function codefErrorHint(code?: string, message?: string): string {
  if (!code) return "응답이 없습니다. CODEF 연동 상태를 확인하세요.";
  if (code === "CF-00003" || code === "CF-00401") {
    return "CODEF 대시보드에서 '현금영수증 매입내역' 상품이 승인되지 않았습니다. 상품 신청·승인 후 다시 시도하세요.";
  }
  if (code === "CF-12411") return "사업장이 2개 이상인 계정입니다 — 회사 사업자등록번호(identity) 확인이 필요합니다.";
  if (code === "CF-03002") return "홈택스가 추가 인증을 요구했습니다. 인증서 로그인 상태를 확인하거나 잠시 후 다시 시도하세요.";
  if (code.startsWith("CF-12")) return "기관(국세청) 응답 지연·오류입니다. 조회 기간을 줄이거나 잠시 후 재시도하세요.";
  return `CODEF 오류 (${code}${message ? `: ${message}` : ""})`;
}

// 금액 문자열("3,100" 등) → 정수. 숫자 없으면 0.
const toAmount = (v: unknown): number => {
  const n = Number(String(v ?? "").replace(/[^\d.-]/g, ""));
  return Number.isFinite(n) ? Math.round(n) : 0;
};
// "20181127" → "2018-11-27" (형식 불량이면 null)
const toIsoDate = (v: unknown): string | null => {
  const s = String(v ?? "").replace(/\D/g, "").slice(0, 8);
  return s.length === 8 ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null;
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

serve(withSentry("cashbill-purchase-sync", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // CODEF 사용량 계측 — codefRequest 호출을 수집해 finally 에서 원장 적재 (fail-open)
  const meterStore = createMeterStore("cashbill-purchase-sync");
  return await runWithMeter(meterStore, async () => {
  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const SUPABASE_URL = Deno.env.get("SUPABASE_URL") ?? "";
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
    const ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const { data: { user } } = await createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    }).auth.getUser();
    if (!user) return json({ error: "Unauthorized" }, 401);

    const { data: userRow } = await admin.from("users").select("company_id").eq("auth_id", user.id).maybeSingle();
    if (!userRow?.company_id) return json({ error: "회사 정보를 찾을 수 없습니다." }, 403);
    const companyId = userRow.company_id;
    meterStore.companyId = companyId;

    const clientId = Deno.env.get("CODEF_CLIENT_ID");
    const clientSecret = Deno.env.get("CODEF_CLIENT_SECRET");
    if (!clientId || !clientSecret) return json({ error: "CODEF API 인증정보가 없습니다." }, 500);

    // ── 기간 파라미터 (yyyy-MM-dd 또는 yyyyMMdd 허용) ──
    const body = await req.json().catch(() => ({}));
    const rawStart = String(body.startDate || "").replace(/\D/g, "").slice(0, 8);
    const rawEnd = String(body.endDate || "").replace(/\D/g, "").slice(0, 8);
    if (rawStart.length !== 8 || rawEnd.length !== 8) {
      return json({ error: "조회 시작일/종료일을 입력하세요. (YYYY-MM-DD)" }, 400);
    }
    // 미래 종료일은 오늘로 cap, 시작 > 종료면 거부
    const todayYmd = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10).replaceAll("-", "");
    const endDate = rawEnd > todayYmd ? todayYmd : rawEnd;
    const startDate = rawStart;
    if (startDate > endDate) return json({ error: "조회 시작일이 종료일보다 늦습니다." }, 400);

    // ── 회사 사업자번호 — 사업장 2개 이상 계정의 CF-12411 방지용 identity ──
    const { data: company } = await admin.from("companies").select("business_number").eq("id", companyId).maybeSingle();
    const corpNum = String(company?.business_number || "").replace(/\D/g, "");

    // ── 홈택스 공동인증서 로딩 (codef-sync 와 동일 규약: storage + automation_credentials) ──
    const certPath = `${companyId}/signCert.der`;
    const keyPath = `${companyId}/signPri.key`;
    const [certDl, keyDl, credRow] = await Promise.all([
      admin.storage.from("certificates").download(certPath),
      admin.storage.from("certificates").download(keyPath),
      admin.from("automation_credentials").select("credentials").eq("company_id", companyId).eq("service", "hometax").maybeSingle(),
    ]);
    if (certDl.error || !certDl.data || keyDl.error || !keyDl.data) {
      return json({
        error: "홈택스 공동인증서가 등록되어 있지 않습니다.",
        hint: "설정 → 은행연동 → 홈택스에서 공동인증서를 먼저 등록하세요.",
        code: "HOMETAX_CERT_MISSING",
      }, 400);
    }
    const encryptedPw = credRow.data?.credentials?.cert_password;
    if (!encryptedPw) {
      return json({
        error: "홈택스 공동인증서 비밀번호가 등록되어 있지 않습니다.",
        hint: "설정 → 은행연동 → 홈택스에서 인증서 비밀번호를 입력하세요.",
        code: "HOMETAX_CERT_PASSWORD_MISSING",
      }, 400);
    }
    const { data: plainPw, error: decErr } = await admin.rpc("decrypt_credential", { p_ciphertext: encryptedPw });
    if (decErr || !plainPw) {
      return json({
        error: `인증서 비밀번호 복호화 실패: ${decErr?.message || "응답 없음"}`,
        hint: "설정에서 인증서 비밀번호를 다시 저장하세요.",
        code: "HOMETAX_CERT_DECRYPT_FAILED",
      }, 500);
    }
    const certB64 = Buffer.from(new Uint8Array(await certDl.data.arrayBuffer())).toString("base64");
    const keyB64 = Buffer.from(new Uint8Array(await keyDl.data.arrayBuffer())).toString("base64");
    const publicKey = Deno.env.get("CODEF_PUBLIC_KEY") || "";
    const encryptedCertPw = publicKey ? rsaEncrypt(String(plainPw), publicKey) : String(plainPw);

    // ── CODEF 호출 — 가이드 입력부의 인증서 로그인 필수 키만 보낸다 ──
    const token = await getCodefToken(clientId, clientSecret);
    const payload: Record<string, unknown> = {
      organization: CASH_RECEIPT_ORG,
      loginType: "0",
      certType: "1",
      certFile: certB64,
      keyFile: keyB64,
      certPassword: encryptedCertPw,
      startDate,
      endDate,
      orderBy: "0",
      inquiryType: "0",
    };
    if (corpNum.length === 10) payload.identity = corpNum; // 사업장 2+ 계정 CF-12411 방지
    const resp = await codefRequest(token, PURCHASE_PATH, payload, REQUEST_TIMEOUT_MS);
    const rc = resp?.result?.code;

    // 추가인증 요구(간편인증 경로) — 인증서 로그인에선 원칙적으로 없음. 자동 승인 시도하지 않고 안내만.
    if (rc === "CF-03002" || resp?.data?.continue2Way === true) {
      return json({
        error: "홈택스가 추가 인증을 요구해 조회를 진행할 수 없습니다.",
        hint: "공동인증서 로그인에서는 발생하지 않아야 하는 응답입니다. 인증서가 유효한지(만료 여부) 확인하고 잠시 후 다시 시도하세요.",
        code: "CF-03002",
      }, 400);
    }
    if (rc !== "CF-00000") {
      const msg = resp?.result?.message || "조회 실패";
      return json({ error: `매입내역 조회 실패: ${msg}`, code: rc, hint: codefErrorHint(rc, msg), raw: resp?.result }, 400);
    }

    // ── 결과 파싱 — 단건은 객체형, 다건은 리스트형(가이드) ──
    const rows: any[] = Array.isArray(resp?.data) ? resp.data : resp?.data ? [resp.data] : [];
    // continue2Way 안내 객체 등 매입 행이 아닌 것 제외 — 승인번호·사용일자 있는 행만
    const purchases = rows.filter((r) => r && (r.resApprovalNo || r.resUsedDate));

    // ── 중복 방지 — 기존 매입 건의 승인번호+일자 집합과 대조 ──
    const { data: existing } = await admin
      .from("cash_receipts")
      .select("approval_number, issue_date")
      .eq("company_id", companyId)
      .eq("type", "expense")
      .not("approval_number", "is", null);
    const seen = new Set((existing || []).map((r: any) => `${r.approval_number}|${r.issue_date}`));

    const inserts: Record<string, unknown>[] = [];
    let skippedDup = 0, skippedBad = 0;
    for (const r of purchases) {
      const issueDate = toIsoDate(r.resUsedDate);
      const approvalNo = String(r.resApprovalNo || "").trim() || null;
      const total = toAmount(r.resTotalAmount);
      const supply = toAmount(r.resSupplyValue);
      const vat = toAmount(r.resVAT);
      const tip = toAmount(r.resTip);
      const amount = total || supply + vat + tip;
      if (!issueDate || amount <= 0) { skippedBad++; continue; }
      const dupKey = `${approvalNo}|${issueDate}`;
      if (approvalNo && seen.has(dupKey)) { skippedDup++; continue; }
      if (approvalNo) seen.add(dupKey);
      const transType = String(r.resTransTypeNm || "").trim();     // 승인거래/취소거래 등
      const deduct = String(r.resDeductDescription || "").trim();  // 공제/불공제
      inserts.push({
        company_id: companyId,
        type: "expense",
        amount,
        supply_amount: supply || null,
        tax_amount: vat || null,
        counterparty_name: String(r.resMemberStoreName || "").trim() || null,
        counterparty_bizno: String(r.resMemberStoreCorpNo || "").replace(/\D/g, "") || null,
        issue_date: issueDate,
        approval_number: approvalNo,
        purpose: "expenditure_proof",
        // 취소거래로 내려온 행은 취소 상태로 적재 — 합계 이중집계 방지
        status: /취소/.test(transType) ? "cancelled" : "issued",
        source: "hometax_sync",
        memo: [transType, deduct, tip > 0 ? `봉사료 ${tip.toLocaleString("ko-KR")}원` : ""]
          .filter(Boolean).join(" · ") || null,
      });
    }

    let insertedCount = 0;
    if (inserts.length > 0) {
      const { data: ins, error: insErr } = await admin.from("cash_receipts").insert(inserts).select("id");
      if (insErr) return json({ error: `조회는 성공했지만 저장 실패: ${insErr.message}` }, 500);
      insertedCount = ins?.length || 0;
    }

    // CODEF 가 실제 조회한 기간(37개월 자동 보정 반영) — 응답 행의 commStartDate/commEndDate
    const commStart = purchases[0]?.commStartDate || "";
    const commEnd = purchases[0]?.commEndDate || "";
    return json({
      success: true,
      fetched: purchases.length,
      inserted: insertedCount,
      skipped_duplicate: skippedDup,
      skipped_invalid: skippedBad,
      period: commStart && commEnd ? `${commStart}~${commEnd}` : `${startDate}~${endDate}`,
      message: insertedCount > 0
        ? `홈택스 매입 현금영수증 ${insertedCount}건을 가져왔습니다.${skippedDup ? ` (중복 ${skippedDup}건 제외)` : ""}`
        : purchases.length > 0
          ? `조회된 ${purchases.length}건이 모두 이미 등록되어 있습니다.`
          : "조회 기간에 매입 현금영수증이 없습니다.",
    });
  } catch (err: any) {
    // tfetch 타임아웃(AbortError) — 게이트웨이 한계 안에서 자체 종료한 경우
    if (String(err?.name) === "TimeoutError" || String(err?.name) === "AbortError") {
      return json({
        error: "국세청 응답이 지연되어 조회를 중단했습니다.",
        hint: "조회 기간을 1~3개월 단위로 줄여 다시 시도하세요.",
        code: "TIMEOUT",
      }, 504);
    }
    return json({ error: err.message || "Internal error" }, 500);
  } finally {
    // 사용량 원장 적재 — 실패해도 응답에 영향 없음 (내부 try/catch)
    await flushCodefUsage(meterStore);
  }
  });
}));
