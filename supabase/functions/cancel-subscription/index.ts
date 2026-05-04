/**
 * OwnerView — Stripe 구독 취소
 * cancel_at_period_end: true → 잔여기간까지 이용 후 해지
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

serve(async (req) => {
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
    const {
      data: { user },
      error: userErr,
    } = await sbAdmin.auth.getUser(token);
    if (!user || userErr) {
      return jsonResponse({ error: "Unauthorized" }, 401);
    }

    const supabaseKey =
      Deno.env.get("CUSTOM_ANON_KEY") || Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const body = await req.json();
    const { subscription_id, reason } = body;

    if (!subscription_id) {
      return jsonResponse({ error: "subscription_id is required" }, 400);
    }

    // IDOR protection: verify ownership
    const { data: profile } = await supabase
      .from("users")
      .select("id, company_id")
      .eq("auth_id", user.id)
      .maybeSingle();

    if (!profile || !profile.company_id) {
      return jsonResponse({ error: "User not found" }, 400);
    }

    const { data: sub } = await sbAdmin
      .from("subscriptions")
      .select("id, company_id, stripe_subscription_id, plan_slug")
      .eq("id", subscription_id)
      .maybeSingle();

    if (!sub || sub.company_id !== profile.company_id) {
      return jsonResponse({ error: "권한이 없습니다" }, 403);
    }

    // Call Stripe API to cancel at period end
    if (sub.stripe_subscription_id) {
      await stripe.subscriptions.update(sub.stripe_subscription_id, {
        cancel_at_period_end: true,
      });
    }

    // Update local DB
    const { error: dbErr } = await sbAdmin
      .from("subscriptions")
      .update({
        status: "cancelling",
        cancel_at_period_end: true,
        cancel_reason: reason || null,
        cancel_requested_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", subscription_id);

    if (dbErr) {
      console.error("[cancel-sub] DB update failed after Stripe success:", dbErr);
      return jsonResponse({ error: "DB update failed" }, 500);
    }

    // Log billing event
    await sbAdmin.from("billing_events").insert({
      company_id: profile.company_id,
      event_type: "subscription_cancel_requested",
      metadata: {
        subscription_id,
        stripe_subscription_id: sub.stripe_subscription_id,
        plan: sub.plan_slug,
        reason: reason || null,
      },
    });

    console.log(
      `[cancel-sub] Cancelled: company=${profile.company_id} plan=${sub.plan_slug}`
    );

    return jsonResponse({ success: true, cancel_at_period_end: true });
  } catch (err) {
    console.error("[cancel-sub] Error:", err);
    return jsonResponse(
      { error: "구독 해지 처리 중 오류가 발생했습니다." },
      500
    );
  }
});
