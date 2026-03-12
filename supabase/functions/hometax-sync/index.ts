// supabase/functions/hometax-sync/index.ts
// HomeTax API integration Edge Function (Deno runtime)
// Reads NPKI cert files from Storage, validates credentials, and syncs HomeTax data.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// ─── HomeTax API Constants ───
const HOMETAX_BASE_URL = "https://www.hometax.go.kr";
const HOMETAX_WQACTION = `${HOMETAX_BASE_URL}/wqAction.do`;
const HOMETAX_PUBDATA_API = "https://apis.data.go.kr/1613000/BizInvoiceService";

// HomeTax action IDs for SOAP/XML requests
const HOMETAX_ACTIONS = {
  LOGIN_CERT: "ATXPPZXA001R01", // 공동인증서 로그인
  LOGIN_IDPW: "ATXPPZXA001R02", // ID/PW 로그인
  TAX_INVOICE_ISSUED: "ATEETBDA001R01", // 매출 전자세금계산서 조회
  TAX_INVOICE_RECEIVED: "ATEETBDA002R01", // 매입 전자세금계산서 조회
  WITHHOLDING_TAX: "ATESFBDA001R01", // 원천세 신고내역 조회
};

interface HometaxSyncRequest {
  companyId: string;
  syncTypes?: ("tax_invoice" | "withholding_tax")[];
  startDate?: string; // YYYY-MM-DD
  endDate?: string;   // YYYY-MM-DD
}

interface HometaxSyncResponse {
  success: boolean;
  message: string;
  data?: {
    taxInvoices?: { count: number; synced: boolean };
    withholdingTax?: { count: number; synced: boolean };
  };
  errors?: string[];
}

interface HometaxSession {
  tin: string; // Taxpayer ID number (사업자등록번호)
  sessionCookie: string;
  requestToken: string;
  authenticated: boolean;
}

interface TaxInvoice {
  invoice_number: string;       // 승인번호
  issue_date: string;           // 작성일자
  supplier_brn: string;         // 공급자 사업자등록번호
  supplier_name: string;        // 공급자 상호
  buyer_brn: string;            // 공급받는자 사업자등록번호
  buyer_name: string;           // 공급받는자 상호
  supply_amount: number;        // 공급가액
  tax_amount: number;           // 세액
  total_amount: number;         // 합계금액
  invoice_type: string;         // 세금계산서 유형 (01=일반, 02=영세율 등)
  direction: "issued" | "received"; // 매출/매입
  raw_xml?: string;             // 원본 XML (디버깅용)
}

// ─── NPKI Certificate Helpers ───

/**
 * Decrypt NPKI private key (signPri.key).
 * Korean NPKI uses SEED-CBC-128 or ARIA-CBC to encrypt the private key.
 * The key is in PKCS#8 EncryptedPrivateKeyInfo format (DER-encoded).
 *
 * Structure:
 *   SEQUENCE {
 *     SEQUENCE { algorithm OID, SEQUENCE { salt, iteration_count } }
 *     OCTET STRING (encrypted key data)
 *   }
 *
 * For SEED-CBC: OID 1.2.410.200004.1.15 (KISA SEED-CBC)
 * For ARIA-CBC: OID 1.2.410.200046.1.1.x
 */
function decryptNPKIPrivateKey(
  keyBytes: Uint8Array,
  password: string,
): { success: boolean; privateKeyDer?: Uint8Array; error?: string } {
  if (!keyBytes || keyBytes.length === 0) {
    return { success: false, error: "Private key file is empty" };
  }
  if (!password) {
    return { success: false, error: "Certificate password is required" };
  }

  // Validate DER structure: should start with SEQUENCE tag (0x30)
  if (keyBytes[0] !== 0x30) {
    return { success: false, error: "Invalid DER format: expected SEQUENCE tag" };
  }

  console.log(`[npki] Private key size: ${keyBytes.length} bytes`);
  console.log(`[npki] DER header: ${Array.from(keyBytes.slice(0, 8)).map(b => b.toString(16).padStart(2, "0")).join(" ")}`);

  // Parse the EncryptedPrivateKeyInfo to identify the encryption algorithm
  try {
    const algOidBytes = extractAlgorithmOID(keyBytes);
    const algName = identifyNPKIAlgorithm(algOidBytes);
    console.log(`[npki] Encryption algorithm detected: ${algName}`);

    // TODO: Implement actual SEED-CBC / ARIA-CBC decryption
    // The full implementation requires:
    // 1. Derive key from password using PBKDF1-SHA1 (PKCS#5 v1.5) with salt + iterations
    //    - Extract salt (8 bytes) and iteration count from the DER structure
    //    - PBKDF1: hash = SHA1(password + salt), repeat `iterations` times
    //    - Use first 16 bytes as the SEED/ARIA key
    // 2. Extract IV (16 bytes for SEED-CBC / ARIA-CBC) from the algorithm params
    // 3. Decrypt the encrypted data using SEED-CBC or ARIA-CBC
    // 4. Remove PKCS#5 padding from the decrypted PKCS#8 PrivateKeyInfo
    //
    // Note: Deno's Web Crypto API does not support SEED or ARIA natively.
    // Options:
    //   a) Use a pure JS SEED implementation (e.g., port from node-seed or kisa-seed)
    //   b) Use WebAssembly-compiled OpenSSL for SEED support
    //   c) Use the openssl CLI via Deno.run (if available in Edge Function environment)
    //
    // For now, we validate the structure and return a placeholder.
    // In production, integrate a SEED/ARIA JS library or WASM module.

    return {
      success: false,
      error: `NPKI key decryption not yet implemented for algorithm: ${algName}. ` +
        "Falling back to ID/PW authentication if available.",
    };
  } catch (e: any) {
    return { success: false, error: `Failed to parse NPKI key structure: ${e.message}` };
  }
}

/**
 * Extract the algorithm OID bytes from EncryptedPrivateKeyInfo DER.
 * Minimal ASN.1 parser — just enough for the outer SEQUENCE → SEQUENCE → OID.
 */
function extractAlgorithmOID(der: Uint8Array): Uint8Array {
  let offset = 0;

  // Outer SEQUENCE
  if (der[offset] !== 0x30) throw new Error("Expected outer SEQUENCE");
  offset = skipTagAndLength(der, offset);

  // AlgorithmIdentifier SEQUENCE
  if (der[offset] !== 0x30) throw new Error("Expected AlgorithmIdentifier SEQUENCE");
  offset = skipTagAndLength(der, offset);

  // OID tag
  if (der[offset] !== 0x06) throw new Error("Expected OID tag");
  offset++;
  const oidLen = der[offset];
  offset++;
  return der.slice(offset, offset + oidLen);
}

/** Skip a DER tag + length, returning the offset of the value. */
function skipTagAndLength(der: Uint8Array, offset: number): number {
  offset++; // skip tag
  if (der[offset] < 0x80) {
    return offset + 1;
  }
  const numLenBytes = der[offset] & 0x7f;
  return offset + 1 + numLenBytes;
}

/** Map known Korean crypto OID bytes to human-readable names. */
function identifyNPKIAlgorithm(oidBytes: Uint8Array): string {
  const hex = Array.from(oidBytes).map(b => b.toString(16).padStart(2, "0")).join("");
  // SEED-CBC: 1.2.410.200004.1.15 → 2a 83 1a 8c 9a 44 01 0f
  if (hex.includes("2a831a8c9a44010f")) return "SEED-CBC-128 (KISA)";
  // SEED-CBC (alternate): 1.2.410.200004.1.4
  if (hex.includes("2a831a8c9a440104")) return "SEED-CBC (KISA, alternate)";
  // ARIA-128-CBC: 1.2.410.200046.1.1.2
  if (hex.includes("2a831a8c9a4601010" + "2")) return "ARIA-128-CBC";
  // ARIA-256-CBC: 1.2.410.200046.1.1.4
  if (hex.includes("2a831a8c9a46010104")) return "ARIA-256-CBC";
  // PBKDF2 / PBES2 combo
  if (hex.includes("2a864886f70d01050d")) return "PBES2 (PKCS#5 v2)";
  if (hex.includes("2a864886f70d01050c")) return "PBKDF2";
  return `Unknown (OID hex: ${hex})`;
}

// ─── HomeTax SOAP/XML Request Builders ───

function buildHometaxSoapEnvelope(actionId: string, params: Record<string, string>): string {
  const paramXml = Object.entries(params)
    .map(([k, v]) => `<${k}>${escapeXml(v)}</${k}>`)
    .join("\n      ");

  return `<?xml version="1.0" encoding="UTF-8"?>
<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"
               xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
  <soap:Header>
    <ActionId>${escapeXml(actionId)}</ActionId>
  </soap:Header>
  <soap:Body>
    <Request>
      ${paramXml}
    </Request>
  </soap:Body>
</soap:Envelope>`;
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

// ─── HomeTax Authentication ───

async function authenticateHomeTax(
  loginMethod: string,
  credentials: {
    loginId?: string;
    loginPassword?: string;
    certPassword?: string;
    certBytes?: Uint8Array;
    keyBytes?: Uint8Array;
  },
): Promise<{ session: HometaxSession | null; error?: string }> {
  console.log(`[hometax-auth] Attempting authentication via ${loginMethod}`);

  if (loginMethod === "id_pw") {
    return authenticateWithIdPw(credentials.loginId!, credentials.loginPassword!);
  } else if (loginMethod === "certificate") {
    return authenticateWithCertificate(
      credentials.certBytes!,
      credentials.keyBytes!,
      credentials.certPassword!,
    );
  }

  return { session: null, error: `Unknown login method: ${loginMethod}` };
}

async function authenticateWithIdPw(
  loginId: string,
  loginPassword: string,
): Promise<{ session: HometaxSession | null; error?: string }> {
  console.log(`[hometax-auth] ID/PW login for user: ${loginId.slice(0, 3)}***`);

  try {
    // Step 1: Get initial session cookie from HomeTax main page
    const initRes = await fetch(HOMETAX_BASE_URL, {
      method: "GET",
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "Accept": "text/html,application/xhtml+xml",
      },
      redirect: "manual",
    });

    const setCookies = initRes.headers.getSetCookie?.() || [];
    const sessionCookie = setCookies
      .map((c: string) => c.split(";")[0])
      .join("; ");

    console.log(`[hometax-auth] Initial session established, cookies: ${sessionCookie ? "yes" : "no"}`);

    // Step 2: POST login request via wqAction.do
    const loginSoap = buildHometaxSoapEnvelope(HOMETAX_ACTIONS.LOGIN_IDPW, {
      userId: loginId,
      userPw: loginPassword,
      selLoginType: "04", // ID/PW type
    });

    const loginRes = await fetch(HOMETAX_WQACTION, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=UTF-8",
        "Cookie": sessionCookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "SOAPAction": HOMETAX_ACTIONS.LOGIN_IDPW,
        "Referer": `${HOMETAX_BASE_URL}/websquare/websquare.wq`,
      },
      body: loginSoap,
    });

    const loginBody = await loginRes.text();
    console.log(`[hometax-auth] Login response status: ${loginRes.status}, body length: ${loginBody.length}`);

    // Merge login response cookies with initial session
    const loginCookies = loginRes.headers.getSetCookie?.() || [];
    const mergedCookie = [
      sessionCookie,
      ...loginCookies.map((c: string) => c.split(";")[0]),
    ].filter(Boolean).join("; ");

    // Check for success indicators in response
    if (loginRes.status !== 200) {
      return {
        session: null,
        error: `HomeTax login failed with HTTP ${loginRes.status}`,
      };
    }

    // Parse response XML for error codes
    const errorMatch = loginBody.match(/<errCd>(\w+)<\/errCd>/);
    const errorMsg = loginBody.match(/<errMsg>([^<]+)<\/errMsg>/);
    if (errorMatch && errorMatch[1] !== "0000" && errorMatch[1] !== "S") {
      return {
        session: null,
        error: `HomeTax login error: ${errorMatch[1]} - ${errorMsg?.[1] || "Unknown error"}`,
      };
    }

    // Extract request token (TIN or TXPPSESSID) from response
    const tinMatch = loginBody.match(/<tin>(\d+)<\/tin>/) ||
      loginBody.match(/<bizNo>(\d+)<\/bizNo>/);
    const tokenMatch = loginBody.match(/<requestToken>([^<]+)<\/requestToken>/) ||
      loginBody.match(/<CSRF_TOKEN>([^<]+)<\/CSRF_TOKEN>/);

    return {
      session: {
        tin: tinMatch?.[1] || "",
        sessionCookie: mergedCookie,
        requestToken: tokenMatch?.[1] || "",
        authenticated: true,
      },
    };
  } catch (err: any) {
    console.error(`[hometax-auth] ID/PW authentication failed:`, err.message);
    return {
      session: null,
      error: `HomeTax authentication request failed: ${err.message}`,
    };
  }
}

async function authenticateWithCertificate(
  certBytes: Uint8Array,
  keyBytes: Uint8Array,
  certPassword: string,
): Promise<{ session: HometaxSession | null; error?: string }> {
  console.log(`[hometax-auth] Certificate-based login`);

  // Step 1: Decrypt the NPKI private key
  const decryptResult = decryptNPKIPrivateKey(keyBytes, certPassword);
  if (!decryptResult.success || !decryptResult.privateKeyDer) {
    console.warn(`[hometax-auth] NPKI decryption failed: ${decryptResult.error}`);
    return {
      session: null,
      error: `인증서 개인키 복호화 실패: ${decryptResult.error}`,
    };
  }

  // Step 2: Build PKCS#7 signed data for HomeTax certificate login
  // HomeTax expects a signed challenge (nonce) using the NPKI private key.
  //
  // Flow:
  //   a) GET challenge nonce from HomeTax
  //   b) Sign the nonce with the decrypted private key (RSA-SHA256)
  //   c) POST the signed data + certificate to HomeTax
  //
  // TODO: Implement full PKCS#7 signing once SEED decryption is available.
  // For now, this path will fail gracefully and suggest ID/PW fallback.

  return {
    session: null,
    error: "Certificate login requires SEED/ARIA decryption (not yet implemented). " +
      "Please use ID/PW login method.",
  };
}

// ─── Tax Invoice Fetching ───

async function fetchTaxInvoices(
  session: HometaxSession,
  startDate: string,
  endDate: string,
  direction: "issued" | "received",
): Promise<{ invoices: TaxInvoice[]; error?: string }> {
  const actionId = direction === "issued"
    ? HOMETAX_ACTIONS.TAX_INVOICE_ISSUED
    : HOMETAX_ACTIONS.TAX_INVOICE_RECEIVED;

  // Format dates for HomeTax (YYYYMMDD, no dashes)
  const fromDate = startDate.replace(/-/g, "");
  const toDate = endDate.replace(/-/g, "");

  console.log(`[hometax-invoice] Fetching ${direction} invoices: ${fromDate} ~ ${toDate}`);

  try {
    const soapBody = buildHometaxSoapEnvelope(actionId, {
      tin: session.tin,
      dteStrtDt: fromDate,
      dteEndDt: toDate,
      inqrDvCd: direction === "issued" ? "01" : "02", // 01=매출, 02=매입
      pageNum: "1",
      pageCnt: "500", // Max records per page
    });

    const res = await fetch(HOMETAX_WQACTION, {
      method: "POST",
      headers: {
        "Content-Type": "text/xml; charset=UTF-8",
        "Cookie": session.sessionCookie,
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
        "SOAPAction": actionId,
        "Referer": `${HOMETAX_BASE_URL}/websquare/websquare.wq`,
        ...(session.requestToken ? { "CSRF": session.requestToken } : {}),
      },
      body: soapBody,
    });

    if (!res.ok) {
      return {
        invoices: [],
        error: `HomeTax API returned HTTP ${res.status} for ${direction} invoices`,
      };
    }

    const responseXml = await res.text();
    console.log(`[hometax-invoice] Response length: ${responseXml.length} chars`);

    // Parse the invoice XML
    const invoices = parseTaxInvoiceXml(responseXml, direction);
    console.log(`[hometax-invoice] Parsed ${invoices.length} ${direction} invoices`);

    return { invoices };
  } catch (err: any) {
    console.error(`[hometax-invoice] Fetch error (${direction}):`, err.message);
    return { invoices: [], error: err.message };
  }
}

/**
 * Parse HomeTax tax invoice XML response into structured TaxInvoice objects.
 *
 * HomeTax response structure (simplified):
 * <Response>
 *   <dtaList>
 *     <dta>
 *       <aprvNo>승인번호</aprvNo>
 *       <wrtDt>작성일자</wrtDt>
 *       <splrTxprDscmNo>공급자 사업자등록번호</splrTxprDscmNo>
 *       <splrTnm>공급자 상호</splrTnm>
 *       <dmnrTxprDscmNo>공급받는자 사업자등록번호</dmnrTxprDscmNo>
 *       <dmnrTnm>공급받는자 상호</dmnrTnm>
 *       <splCft>공급가액</splCft>
 *       <txAmt>세액</txAmt>
 *       <totAmt>합계금액</totAmt>
 *       <dtaClCd>세금계산서 유형코드</dtaClCd>
 *     </dta>
 *   </dtaList>
 * </Response>
 */
function parseTaxInvoiceXml(xml: string, direction: "issued" | "received"): TaxInvoice[] {
  const invoices: TaxInvoice[] = [];

  // Simple XML extraction using regex (no external XML parser in Deno Edge Functions)
  const dtaPattern = /<dta>([\s\S]*?)<\/dta>/g;
  let match;

  while ((match = dtaPattern.exec(xml)) !== null) {
    const dta = match[1];
    const get = (tag: string): string => {
      const m = dta.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
      return m?.[1]?.trim() || "";
    };

    const supplyAmount = parseInt(get("splCft") || "0", 10);
    const taxAmount = parseInt(get("txAmt") || "0", 10);
    const totalAmount = parseInt(get("totAmt") || "0") || (supplyAmount + taxAmount);

    // Format date from YYYYMMDD to YYYY-MM-DD
    const rawDate = get("wrtDt");
    const issueDate = rawDate.length === 8
      ? `${rawDate.slice(0, 4)}-${rawDate.slice(4, 6)}-${rawDate.slice(6, 8)}`
      : rawDate;

    const invoice: TaxInvoice = {
      invoice_number: get("aprvNo"),
      issue_date: issueDate,
      supplier_brn: get("splrTxprDscmNo"),
      supplier_name: get("splrTnm"),
      buyer_brn: get("dmnrTxprDscmNo"),
      buyer_name: get("dmnrTnm"),
      supply_amount: supplyAmount,
      tax_amount: taxAmount,
      total_amount: totalAmount,
      invoice_type: get("dtaClCd") || "01",
      direction,
    };

    // Only include if we have at least an invoice number
    if (invoice.invoice_number) {
      invoices.push(invoice);
    }
  }

  return invoices;
}

// ─── Fallback: data.go.kr Public API ───

async function fetchInvoicesFromPublicApi(
  brn: string,
  startDate: string,
  endDate: string,
  apiKey: string,
): Promise<{ invoices: TaxInvoice[]; error?: string }> {
  console.log(`[hometax-pubapi] Attempting data.go.kr fallback for BRN: ${brn.slice(0, 5)}***`);

  const fromDate = startDate.replace(/-/g, "");
  const toDate = endDate.replace(/-/g, "");

  try {
    const url = new URL(`${HOMETAX_PUBDATA_API}/getBizInvoiceList`);
    url.searchParams.set("serviceKey", apiKey);
    url.searchParams.set("bizrno", brn);
    url.searchParams.set("startDt", fromDate);
    url.searchParams.set("endDt", toDate);
    url.searchParams.set("numOfRows", "500");
    url.searchParams.set("pageNo", "1");
    url.searchParams.set("type", "xml");

    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { "Accept": "application/xml" },
    });

    if (!res.ok) {
      return { invoices: [], error: `Public API returned HTTP ${res.status}` };
    }

    const xml = await res.text();
    console.log(`[hometax-pubapi] Response length: ${xml.length} chars`);

    // Parse public API response (different format from HomeTax direct)
    const invoices: TaxInvoice[] = [];
    const itemPattern = /<item>([\s\S]*?)<\/item>/g;
    let match;

    while ((match = itemPattern.exec(xml)) !== null) {
      const item = match[1];
      const get = (tag: string): string => {
        const m = item.match(new RegExp(`<${tag}>([^<]*)</${tag}>`));
        return m?.[1]?.trim() || "";
      };

      const supplyAmount = parseInt(get("splCft") || get("supAmt") || "0", 10);
      const taxAmount = parseInt(get("taxAmt") || get("txAmt") || "0", 10);

      invoices.push({
        invoice_number: get("aprvNo") || get("invoiceNo"),
        issue_date: get("issDt") || get("wrtDt"),
        supplier_brn: get("splrBizrno") || get("splrTxprDscmNo"),
        supplier_name: get("splrNm") || get("splrTnm"),
        buyer_brn: get("dmnrBizrno") || get("dmnrTxprDscmNo"),
        buyer_name: get("dmnrNm") || get("dmnrTnm"),
        supply_amount: supplyAmount,
        tax_amount: taxAmount,
        total_amount: supplyAmount + taxAmount,
        invoice_type: get("invoiceType") || "01",
        direction: get("direction") === "02" ? "received" : "issued",
      });
    }

    return { invoices };
  } catch (err: any) {
    console.error(`[hometax-pubapi] Public API error:`, err.message);
    return { invoices: [], error: err.message };
  }
}

// ─── Supabase Upsert ───

async function upsertTaxInvoices(
  supabase: any,
  companyId: string,
  invoices: TaxInvoice[],
): Promise<{ count: number; error?: string }> {
  if (invoices.length === 0) {
    return { count: 0 };
  }

  console.log(`[hometax-upsert] Upserting ${invoices.length} invoices for company ${companyId}`);

  const rows = invoices.map((inv) => ({
    company_id: companyId,
    invoice_number: inv.invoice_number,
    issue_date: inv.issue_date,
    supplier_brn: inv.supplier_brn,
    supplier_name: inv.supplier_name,
    buyer_brn: inv.buyer_brn,
    buyer_name: inv.buyer_name,
    supply_amount: inv.supply_amount,
    tax_amount: inv.tax_amount,
    total_amount: inv.total_amount,
    invoice_type: inv.invoice_type,
    direction: inv.direction,
    synced_at: new Date().toISOString(),
  }));

  const { data, error } = await supabase
    .from("tax_invoices")
    .upsert(rows, {
      onConflict: "company_id,invoice_number",
      ignoreDuplicates: false, // Update existing records
    })
    .select("invoice_number");

  if (error) {
    console.error(`[hometax-upsert] Upsert error:`, error.message);
    return { count: 0, error: error.message };
  }

  const count = data?.length || rows.length;
  console.log(`[hometax-upsert] Successfully upserted ${count} invoices`);
  return { count };
}

// ─── Main Handler ───

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Initialize Supabase client with service role for storage access
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request
    const { companyId, syncTypes, startDate, endDate }: HometaxSyncRequest = await req.json();

    if (!companyId) {
      return jsonResponse(400, { success: false, message: "companyId is required" });
    }

    const errors: string[] = [];
    const typesToSync = syncTypes || ["tax_invoice", "withholding_tax"];

    // ─── Step 1: Validate NPKI cert files exist in Storage ───
    const certPath = `${companyId}/signCert.der`;
    const keyPath = `${companyId}/signPri.key`;

    const { data: certFile, error: certError } = await supabase.storage
      .from("certificates")
      .download(certPath);

    if (certError || !certFile) {
      return jsonResponse(400, {
        success: false,
        message: "NPKI 인증서 파일(signCert.der)이 없습니다. 설정에서 인증서를 업로드해주세요.",
        errors: [certError?.message || "cert file not found"],
      });
    }

    const { data: keyFile, error: keyError } = await supabase.storage
      .from("certificates")
      .download(keyPath);

    if (keyError || !keyFile) {
      return jsonResponse(400, {
        success: false,
        message: "NPKI 개인키 파일(signPri.key)이 없습니다. 설정에서 개인키를 업로드해주세요.",
        errors: [keyError?.message || "key file not found"],
      });
    }

    // Convert cert files to ArrayBuffer for later use
    const certBytes = new Uint8Array(await certFile.arrayBuffer());
    const keyBytes = new Uint8Array(await keyFile.arrayBuffer());

    console.log(`[hometax-sync] Cert loaded: ${certBytes.length} bytes, Key loaded: ${keyBytes.length} bytes`);

    // ─── Step 2: Read HomeTax credentials from automation_credentials ───
    const { data: credRows, error: credError } = await supabase
      .from("automation_credentials")
      .select("service, credentials")
      .eq("company_id", companyId)
      .in("service", ["hometax", "npki_cert"]);

    if (credError) {
      return jsonResponse(500, {
        success: false,
        message: "인증정보 조회 실패",
        errors: [credError.message],
      });
    }

    const hometaxCred = credRows?.find((r: any) => r.service === "hometax");
    const npkiCred = credRows?.find((r: any) => r.service === "npki_cert");

    if (!hometaxCred?.credentials) {
      return jsonResponse(400, {
        success: false,
        message: "홈택스 로그인 정보가 없습니다. 설정에서 홈택스 인증정보를 등록해주세요.",
      });
    }

    const { login_method, cert_password, login_id, login_password } = hometaxCred.credentials;

    // Validate credentials based on login method
    if (login_method === "certificate" && !cert_password) {
      return jsonResponse(400, {
        success: false,
        message: "공동인증서 비밀번호가 설정되지 않았습니다.",
      });
    }
    if (login_method === "id_pw" && (!login_id || !login_password)) {
      return jsonResponse(400, {
        success: false,
        message: "홈택스 아이디/비밀번호가 설정되지 않았습니다.",
      });
    }

    console.log(`[hometax-sync] Company: ${companyId}, Method: ${login_method}, Types: ${typesToSync.join(",")}`);

    // ─── Step 3: Determine date range ───
    const now = new Date();
    const syncStartDate = startDate || new Date(now.getFullYear(), now.getMonth() - 1, 1).toISOString().slice(0, 10);
    const syncEndDate = endDate || new Date(now.getFullYear(), now.getMonth(), 0).toISOString().slice(0, 10);

    console.log(`[hometax-sync] Date range: ${syncStartDate} ~ ${syncEndDate}`);

    // ─── Step 4: Authenticate to HomeTax ───
    const { session, error: authError } = await authenticateHomeTax(login_method, {
      loginId: login_id,
      loginPassword: login_password,
      certPassword: cert_password,
      certBytes,
      keyBytes,
    });

    // ─── Step 5: Fetch and sync data ───
    const result: HometaxSyncResponse["data"] = {};
    let syncStatus: "success" | "partial" | "auth_failed" | "error" = "success";

    if (typesToSync.includes("tax_invoice")) {
      if (session?.authenticated) {
        // Primary path: HomeTax direct API with authenticated session
        console.log(`[hometax-sync] Fetching tax invoices via HomeTax direct API`);

        const [issuedResult, receivedResult] = await Promise.all([
          fetchTaxInvoices(session, syncStartDate, syncEndDate, "issued"),
          fetchTaxInvoices(session, syncStartDate, syncEndDate, "received"),
        ]);

        const allInvoices = [
          ...issuedResult.invoices,
          ...receivedResult.invoices,
        ];

        if (issuedResult.error) errors.push(`매출 세금계산서 조회 오류: ${issuedResult.error}`);
        if (receivedResult.error) errors.push(`매입 세금계산서 조회 오류: ${receivedResult.error}`);

        // Upsert to Supabase
        const { count, error: upsertError } = await upsertTaxInvoices(supabase, companyId, allInvoices);
        if (upsertError) errors.push(`DB 저장 오류: ${upsertError}`);

        result.taxInvoices = { count, synced: count > 0 };
      } else {
        // Fallback path: Try data.go.kr public API
        console.warn(`[hometax-sync] HomeTax auth failed (${authError}), trying public API fallback`);

        const publicApiKey = Deno.env.get("DATA_GO_KR_API_KEY") || "";
        const companyBrn = npkiCred?.credentials?.brn || session?.tin || "";

        if (publicApiKey && companyBrn) {
          const pubResult = await fetchInvoicesFromPublicApi(
            companyBrn,
            syncStartDate,
            syncEndDate,
            publicApiKey,
          );

          if (pubResult.error) errors.push(`공공데이터 API 오류: ${pubResult.error}`);

          const { count, error: upsertError } = await upsertTaxInvoices(
            supabase,
            companyId,
            pubResult.invoices,
          );
          if (upsertError) errors.push(`DB 저장 오류: ${upsertError}`);

          result.taxInvoices = { count, synced: count > 0 };
          if (count > 0) {
            syncStatus = "partial";
          }
        } else {
          errors.push(
            `홈택스 인증 실패: ${authError || "unknown"}. ` +
            "data.go.kr API 키 또는 사업자등록번호가 없어 대체 조회도 불가합니다.",
          );
          result.taxInvoices = { count: 0, synced: false };
          syncStatus = "auth_failed";
        }
      }
    }

    if (typesToSync.includes("withholding_tax")) {
      if (session?.authenticated) {
        // TODO: Implement withholding tax fetch similar to tax invoices
        // Uses HOMETAX_ACTIONS.WITHHOLDING_TAX action ID
        // Parse response XML for withholding tax records
        // Upsert into withholding_tax table
        console.log(`[hometax-sync] Withholding tax sync not yet implemented`);
        result.withholdingTax = { count: 0, synced: false };
        errors.push("원천세 조회: 홈택스 API 연동 준비 중");
      } else {
        result.withholdingTax = { count: 0, synced: false };
        errors.push("원천세 조회: 홈택스 인증 실패로 조회 불가");
      }
    }

    // ─── Step 6: Log sync attempt ───
    await supabase.from("automation_logs").insert({
      company_id: companyId,
      service: "hometax",
      action: "sync",
      status: syncStatus,
      details: {
        sync_types: typesToSync,
        date_range: { start: syncStartDate, end: syncEndDate },
        login_method,
        auth_success: session?.authenticated || false,
        auth_error: authError || null,
        tax_invoices_count: result.taxInvoices?.count || 0,
        withholding_tax_count: result.withholdingTax?.count || 0,
        cert_loaded: certBytes.length > 0,
        key_loaded: keyBytes.length > 0,
      },
      created_at: new Date().toISOString(),
    }).then(() => {}).catch((e: any) => {
      // Non-critical: log table may not exist yet
      console.warn("[hometax-sync] Could not write automation log:", e.message);
    });

    // Build response message
    const totalSynced = (result.taxInvoices?.count || 0) + (result.withholdingTax?.count || 0);
    let message: string;
    if (syncStatus === "success" && totalSynced > 0) {
      message = `홈택스 연동 완료: ${totalSynced}건 동기화됨`;
    } else if (syncStatus === "partial") {
      message = `홈택스 직접 연동 실패, 공공데이터 API로 ${totalSynced}건 동기화됨`;
    } else if (syncStatus === "auth_failed") {
      message = "홈택스 인증 실패. 로그인 정보를 확인해주세요.";
    } else {
      message = "홈택스 연동 완료 (동기화된 데이터 없음)";
    }

    return jsonResponse(200, {
      success: syncStatus !== "auth_failed",
      message,
      data: result,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (err: any) {
    console.error("[hometax-sync] Unexpected error:", err);
    return jsonResponse(500, {
      success: false,
      message: "서버 오류가 발생했습니다.",
      errors: [err.message || "Unknown error"],
    });
  }
});

function jsonResponse(status: number, body: HometaxSyncResponse) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
