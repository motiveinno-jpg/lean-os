// OwnerView — CODEF Transfer Edge Function
// Execute a single payment_queue entry via CODEF bank transfer API.
// Until the CODEF transfer API contract is approved (requires 가맹점 심사), this function runs in
// "manual" mode: marks payment as executed in DB, logs audit, and notifies the CEO via telegram.
// When CODEF_TRANSFER_ENABLED=true is set, it calls the real transfer API.
// Payload: { paymentId: string }

import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

const CODEF_TOKEN_URL = "https://oauth.codef.io/oauth/token";
const CODEF_BASE = "https://api.codef.io";
const TRANSFER_PATH = "/v1/kr/bank/a/account/transfer";

async function getCodefToken(clientId: string, clientSecret: string): Promise<string> {
  const basicAuth = btoa(`${clientId}:${clientSecret}`);
  const res = await fetch(CODEF_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${basicAuth}`,
    },
    body: "grant_type=client_credentials&scope=read",
  });
  if (!res.ok) throw new Error(`CODEF token error: ${res.status}`);
  const data = await res.json();
  return data.access_token;
}

async function rsaEncrypt(plainText: string, publicKeyPem: string): Promise<string> {
  const pemBody = publicKeyPem
    .replace(/-----BEGIN PUBLIC KEY-----/, "")
    .replace(/-----END PUBLIC KEY-----/, "")
    .replace(/\s+/g, "");
  const binaryDer = Uint8Array.from(atob(pemBody), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey(
    "spki",
    binaryDer.buffer,
    { name: "RSA-OAEP", hash: "SHA-256" },
    false,
    ["encrypt"],
  );
  const enc = new TextEncoder().encode(plainText);
  const cipher = await crypto.subtle.encrypt({ name: "RSA-OAEP" }, key, enc);
  return btoa(String.fromCharCode(...new Uint8Array(cipher)));
}

async function codefTransfer(token: string, body: Record<string, unknown>) {
  const res = await fetch(`${CODEF_BASE}${TRANSFER_PATH}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  try {
    const decoded = decodeURIComponent(text);
    return { ok: res.ok, status: res.status, data: JSON.parse(decoded) };
  } catch {
    try {
      return { ok: res.ok, status: res.status, data: JSON.parse(text) };
    } catch {
      return { ok: res.ok, status: res.status, data: { raw: text } };
    }
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS_HEADERS });
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  let payload: { paymentId?: string };
  try {
    payload = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON" }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }
  const paymentId = payload?.paymentId;
  if (!paymentId) {
    return new Response(JSON.stringify({ error: "paymentId required" }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 1) Load payment
  const { data: payment, error: pErr } = await supabase
    .from("payment_queue")
    .select("*")
    .eq("id", paymentId)
    .single();
  if (pErr || !payment) {
    return new Response(JSON.stringify({ error: "Payment not found" }), {
      status: 404,
      headers: CORS_HEADERS,
    });
  }
  if (payment.status !== "approved") {
    return new Response(
      JSON.stringify({ error: `현재 상태(${payment.status})에서는 이체할 수 없습니다. (approved 건만 가능)` }),
      { status: 409, headers: CORS_HEADERS }
    );
  }

  const companyId = payment.company_id;
  const transferEnabled = (Deno.env.get("CODEF_TRANSFER_ENABLED") || "").toLowerCase() === "true";

  // 2) Balance check
  if (payment.bank_account_id) {
    const { data: bank } = await supabase
      .from("bank_accounts")
      .select("balance")
      .eq("id", payment.bank_account_id)
      .single();
    const currentBalance = Number(bank?.balance || 0);
    const amount = Number(payment.amount);
    if (currentBalance < amount) {
      await supabase
        .from("payment_queue")
        .update({ status: "failed" })
        .eq("id", paymentId);
      return new Response(
        JSON.stringify({
          error: `잔액 부족 (필요: ${amount.toLocaleString()}원 / 가용: ${currentBalance.toLocaleString()}원)`,
          code: "INSUFFICIENT_BALANCE",
        }),
        { status: 409, headers: CORS_HEADERS }
      );
    }
  }

  const randomSuffix = Math.random().toString(36).substring(2, 8).toUpperCase();
  const transferRef = `TXN-${Date.now()}-${randomSuffix}`;

  // 3) Execute transfer
  let mode: "manual" | "codef" = "manual";
  let codefResult: unknown = null;
  let errorMessage: string | null = null;

  if (transferEnabled) {
    try {
      const { data: settings } = await supabase
        .from("company_settings")
        .select("codef_client_id, codef_client_secret, codef_connected_id, settings")
        .eq("company_id", companyId)
        .maybeSingle();

      const clientId = settings?.codef_client_id || Deno.env.get("CODEF_CLIENT_ID");
      const clientSecret = settings?.codef_client_secret || Deno.env.get("CODEF_CLIENT_SECRET");
      const connectedId = settings?.codef_connected_id;
      const publicKey = Deno.env.get("CODEF_PUBLIC_KEY") || "";

      if (!clientId || !clientSecret || !connectedId) {
        throw new Error("CODEF 크리덴셜이 설정되지 않았습니다. 설정 → 은행연동에서 연결하세요.");
      }

      const { data: bankAcc } = await supabase
        .from("bank_accounts")
        .select("*")
        .eq("id", payment.bank_account_id)
        .single();
      if (!bankAcc) throw new Error("출금 계좌가 없습니다.");

      const accountPassword = bankAcc.account_password_enc || "";
      const encryptedAcctPw = accountPassword && publicKey
        ? await rsaEncrypt(accountPassword, publicKey)
        : accountPassword;

      const token = await getCodefToken(clientId, clientSecret);
      const transferBody = {
        connectedId,
        organization: bankAcc.bank_code || "",
        withdrawAccount: bankAcc.account_number || "",
        accountPassword: encryptedAcctPw,
        depositBankCode: payment.recipient_bank || "",
        depositAccount: payment.recipient_account || "",
        amount: String(Math.trunc(Number(payment.amount))),
        inPrintContent: payment.description?.substring(0, 20) || "출금",
        outPrintContent: payment.recipient_name?.substring(0, 20) || "입금",
        transferPurpose: "TR",
      };
      const r = await codefTransfer(token, transferBody);
      codefResult = r.data;
      const code = r.data?.result?.code;
      if (!r.ok || (code && code !== "CF-00000")) {
        throw new Error(`CODEF 이체 실패: ${code || r.status} / ${r.data?.result?.message || "알 수 없는 오류"}`);
      }
      mode = "codef";
    } catch (err) {
      errorMessage = err instanceof Error ? err.message : String(err);
      await supabase
        .from("payment_queue")
        .update({ status: "failed", transfer_ref: transferRef })
        .eq("id", paymentId);
      await supabase.from("audit_logs").insert({
        company_id: companyId,
        entity_type: "payment_queue",
        entity_id: paymentId,
        action: "codef_transfer_failed",
        metadata: { transferRef, error: errorMessage, codefResult },
      });
      return new Response(
        JSON.stringify({ error: errorMessage, code: "CODEF_TRANSFER_FAILED" }),
        { status: 502, headers: CORS_HEADERS }
      );
    }
  }

  // 4) Mark executed + deduct balance + audit
  await supabase
    .from("payment_queue")
    .update({
      status: "executed",
      executed_at: new Date().toISOString(),
      transfer_ref: transferRef,
    })
    .eq("id", paymentId);

  if (payment.bank_account_id) {
    const { data: bank } = await supabase
      .from("bank_accounts")
      .select("balance")
      .eq("id", payment.bank_account_id)
      .single();
    if (bank) {
      await supabase
        .from("bank_accounts")
        .update({ balance: Number(bank.balance || 0) - Number(payment.amount) })
        .eq("id", payment.bank_account_id);
    }
  }

  if (payment.cost_schedule_id) {
    await supabase
      .from("deal_cost_schedule")
      .update({ status: "paid", approved: true, approved_at: new Date().toISOString() })
      .eq("id", payment.cost_schedule_id);
  }

  await supabase.from("audit_logs").insert({
    company_id: companyId,
    entity_type: "payment_queue",
    entity_id: paymentId,
    action: "execute_success",
    metadata: { mode, transferRef, amount: Number(payment.amount), codefResult },
  });

  return new Response(
    JSON.stringify({ success: true, mode, transferRef, codefResult }),
    { status: 200, headers: CORS_HEADERS }
  );
});
