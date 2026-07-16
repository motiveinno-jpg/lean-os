import { withSentry } from "../_shared/sentry.ts";
/**
 * OwnerView — Stripe Billing Portal Session
 * 결제 수단 변경, 청구서 조회, 구독 관리
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const ALLOWED_ORIGINS = [
  "https://www.owner-view.com",
  "https://owner-view.com",
  "http://localhost:3000",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

serve(withSentry("create-billing-portal", async (req) => {
  const corsHeaders = getCorsHeaders(req);

  function jsonResponse(body: Record<string, unknown>, status = 200): Response {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) {
      return jsonResponse({ error: "Payment service unavailable" }, 500);
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    // Auth
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const sbAdmin = createClient(supabaseUrl, supabaseServiceRole);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await sbAdmin.auth.getUser(token);
    if (!user || userErr) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    // Get company's Stripe customer ID
    const { data: profile } = await sbAdmin
      .from("users")
      .select("company_id")
      .eq("auth_id", user.id)
      .maybeSingle();

    if (!profile?.company_id) {
      return jsonResponse({ error: "User not found" }, 400);
    }

    const { data: company } = await sbAdmin
      .from("companies")
      .select("stripe_customer_id")
      .eq("id", profile.company_id)
      .maybeSingle();

    if (!company?.stripe_customer_id) {
      return jsonResponse({ error: "결제 정보가 없습니다. 먼저 플랜을 구독해주세요." }, 400);
    }

    // Determine return URL
    const body = await req.json().catch(() => ({}));
    const origin = req.headers.get("Origin") || "https://www.owner-view.com";
    const returnUrl = ALLOWED_ORIGINS.includes(origin)
      ? `${origin}/billing`
      : `${ALLOWED_ORIGINS[0]}/billing`;

    // Create Billing Portal session
    const session = await stripe.billingPortal.sessions.create({
      customer: company.stripe_customer_id,
      return_url: returnUrl,
    });

    console.log(`[billing-portal] Created session for company=${profile.company_id}`);

    return jsonResponse({ url: session.url });
  } catch (err) {
    console.error("[billing-portal] Error:", err);
    return jsonResponse({ error: "결제 관리 페이지를 열 수 없습니다." }, 500);
  }
}));
