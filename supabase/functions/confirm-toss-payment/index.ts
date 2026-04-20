// supabase/functions/confirm-toss-payment/index.ts
// 토스페이먼츠 결제 승인 Edge Function (Deno runtime)
//
// 클라이언트가 토스 위젯에서 결제를 완료하면 paymentKey/orderId/amount를 받는다.
// 이 함수는 토스 /v1/payments/confirm API를 호출하여 결제를 최종 승인하고,
// 성공 시 subscriptions + billing_events 테이블을 업데이트한다.
//
// 시크릿 키(TOSS_SECRET_KEY)는 절대 클라이언트로 노출되면 안 된다.
//
// 호출: src/lib/billing.ts → confirmTossPayment(paymentKey, orderId, amount)
// Deploy: supabase functions deploy confirm-toss-payment

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOSS_CONFIRM_URL = "https://api.tosspayments.com/v1/payments/confirm";

interface ConfirmRequest {
  paymentKey: string;
  orderId: string;
  amount: number;
}

interface TossConfirmResponse {
  paymentKey: string;
  orderId: string;
  orderName: string;
  status: string;
  method: string;
  approvedAt: string;
  totalAmount: number;
  receipt: { url: string } | null;
  card?: {
    company: string;
    number: string;
    installmentPlanMonths: number;
  };
  [key: string]: unknown;
}

interface TossErrorResponse {
  code: string;
  message: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return jsonResponse({ error: "Method not allowed" }, 405);
  }

  // 1. Auth — supabase JWT required
  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return jsonResponse({ error: "Missing authorization" }, 401);
  }

  // 2. Parse body
  let body: ConfirmRequest;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON body" }, 400);
  }

  const { paymentKey, orderId, amount } = body;
  if (!paymentKey || !orderId || typeof amount !== "number" || amount <= 0) {
    return jsonResponse(
      { error: "paymentKey, orderId, amount are required" },
      400,
    );
  }

  // 3. Load secret
  const secretKey = Deno.env.get("TOSS_SECRET_KEY");
  if (!secretKey) {
    console.error("TOSS_SECRET_KEY not configured");
    return jsonResponse({ error: "Payment gateway not configured" }, 500);
  }

  // 4. Supabase client (service role for DB writes)
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const supabase = createClient(supabaseUrl, serviceRoleKey);

  // 5. Verify caller and fetch user/company
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: userData, error: userError } = await userClient.auth.getUser();
  if (userError || !userData.user) {
    return jsonResponse({ error: "Unauthorized" }, 401);
  }

  const { data: profile } = await supabase
    .from("users")
    .select("id, company_id")
    .eq("id", userData.user.id)
    .single();

  if (!profile?.company_id) {
    return jsonResponse({ error: "Company not found" }, 403);
  }

  // 6. Verify amount against subscriptions or invoices by orderId
  //    — prevents client from tampering with amount before confirm call.
  const { data: invoice } = await supabase
    .from("invoices")
    .select("id, company_id, amount, status")
    .eq("toss_order_id", orderId)
    .maybeSingle();

  if (invoice && invoice.amount !== amount) {
    console.error(
      `Amount mismatch: orderId=${orderId} expected=${invoice.amount} got=${amount}`,
    );
    return jsonResponse({ error: "Amount mismatch" }, 400);
  }

  if (invoice && invoice.company_id !== profile.company_id) {
    return jsonResponse({ error: "Order does not belong to your company" }, 403);
  }

  // 7. Call Toss confirm API
  const basicAuth = btoa(`${secretKey}:`);
  let tossResponse: TossConfirmResponse;
  try {
    const res = await fetch(TOSS_CONFIRM_URL, {
      method: "POST",
      headers: {
        Authorization: `Basic ${basicAuth}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ paymentKey, orderId, amount }),
    });

    const data = await res.json();

    if (!res.ok) {
      const err = data as TossErrorResponse;
      console.error("Toss confirm failed:", err);

      // Log failure to billing_events for auditability
      await supabase.from("billing_events").insert({
        company_id: profile.company_id,
        event_type: "payment_confirm_failed",
        metadata: { paymentKey, orderId, amount, error: err },
      });

      return jsonResponse(
        { error: err.message || "Payment confirmation failed", code: err.code },
        res.status,
      );
    }

    tossResponse = data as TossConfirmResponse;
  } catch (err) {
    console.error("Toss API call exception:", err);
    return jsonResponse({ error: "Payment gateway unreachable" }, 502);
  }

  // 8. Update invoice status (if present)
  if (invoice) {
    await supabase
      .from("invoices")
      .update({
        status: "paid",
        paid_at: tossResponse.approvedAt,
        toss_payment_key: tossResponse.paymentKey,
      })
      .eq("id", invoice.id);
  }

  // 9. Log success event
  await supabase.from("billing_events").insert({
    company_id: profile.company_id,
    event_type: "payment_confirmed",
    metadata: {
      paymentKey: tossResponse.paymentKey,
      orderId: tossResponse.orderId,
      amount: tossResponse.totalAmount,
      method: tossResponse.method,
      approvedAt: tossResponse.approvedAt,
    },
  });

  // 10. Return minimal confirmation payload to client
  return jsonResponse(
    {
      paymentKey: tossResponse.paymentKey,
      orderId: tossResponse.orderId,
      amount: tossResponse.totalAmount,
      status: tossResponse.status,
      method: tossResponse.method,
      approvedAt: tossResponse.approvedAt,
      receipt: tossResponse.receipt,
    },
    200,
  );
});

function jsonResponse(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
