/**
 * OwnerView — Stripe Checkout Session 생성
 * 구독 결제: Free / Starter ₩49,000 / Pro ₩149,000 / Enterprise ₩299,000
 * 6개월 10% 할인, 연간 20% 할인
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

// 플랜별 월간 가격 (KRW)
const PLAN_PRICES: Record<string, number> = {
  starter: 49000,
  pro: 149000,
  enterprise: 299000,
};

// 할인율
const DISCOUNT_RATES: Record<string, number> = {
  monthly: 0,
  semiannual: 0.10,  // 6개월 10%
  annual: 0.20,       // 연간 20%
};

// 결제 주기별 개월 수
const CYCLE_MONTHS: Record<string, number> = {
  monthly: 1,
  semiannual: 6,
  annual: 12,
};

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
      console.error("[ov-checkout] STRIPE_SECRET_KEY not configured");
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
    const { plan, billing_cycle } = body;

    // Validate plan
    if (!plan || !PLAN_PRICES[plan]) {
      return jsonResponse({ error: "Invalid plan. Choose: starter, pro, enterprise" }, 400);
    }

    // Validate billing cycle
    const cycle = billing_cycle || "monthly";
    if (!DISCOUNT_RATES.hasOwnProperty(cycle)) {
      return jsonResponse({ error: "Invalid billing cycle. Choose: monthly, semiannual, annual" }, 400);
    }

    // Validate redirect URLs
    const REDIRECT_ALLOWED_ORIGINS = ["https://www.owner-view.com", "https://owner-view.com", "http://localhost:3000"];
    const validateRedirectUrl = (url: string | undefined): string | undefined => {
      if (!url) return undefined;
      try {
        const parsed = new URL(url);
        if (REDIRECT_ALLOWED_ORIGINS.includes(parsed.origin)) return url;
      } catch { /* invalid URL */ }
      return undefined;
    };
    const success_url = validateRedirectUrl(body.success_url);
    const cancel_url = validateRedirectUrl(body.cancel_url);

    // Get user profile + company
    const { data: profile } = await supabase
      .from("users")
      .select("id, email, company_id, companies(id, name, stripe_customer_id)")
      .eq("auth_id", user.id)
      .maybeSingle();

    if (!profile || !profile.company_id) {
      return jsonResponse({ error: "Company not found" }, 400);
    }

    const company = (profile as any).companies;

    // Find or create Stripe customer
    let customerId: string | undefined = company?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        metadata: {
          supabase_uid: user.id,
          company_id: profile.company_id,
          company_name: company?.name || "",
        },
      });
      customerId = customer.id;

      // Save stripe_customer_id to company
      await sbAdmin
        .from("companies")
        .update({ stripe_customer_id: customer.id })
        .eq("id", profile.company_id);
    }

    // Calculate price
    const monthlyPrice = PLAN_PRICES[plan];
    const discountRate = DISCOUNT_RATES[cycle];
    const months = CYCLE_MONTHS[cycle];
    const discountedMonthly = Math.round(monthlyPrice * (1 - discountRate));
    const totalAmount = discountedMonthly * months;

    // Plan display names
    const planNames: Record<string, string> = {
      starter: "Starter",
      pro: "Pro",
      enterprise: "Enterprise",
    };

    const cycleNames: Record<string, string> = {
      monthly: "월간",
      semiannual: "6개월",
      annual: "연간",
    };

    // Check if we have a Stripe Price ID stored, otherwise use price_data
    const { data: planRecord } = await sbAdmin
      .from("subscription_plans")
      .select("stripe_price_monthly, stripe_price_semiannual, stripe_price_annual, stripe_product_id")
      .eq("slug", plan)
      .maybeSingle();

    const stripePriceField = cycle === "semiannual"
      ? "stripe_price_semiannual"
      : cycle === "annual"
        ? "stripe_price_annual"
        : "stripe_price_monthly";

    const existingPriceId = planRecord?.[stripePriceField];

    let lineItems: Stripe.Checkout.SessionCreateParams.LineItem[];

    if (existingPriceId) {
      // Use pre-configured Stripe Price
      lineItems = [{ price: existingPriceId, quantity: 1 }];
    } else {
      // Create price_data on the fly
      lineItems = [
        {
          price_data: {
            currency: "krw",
            product_data: {
              name: `OwnerView ${planNames[plan]}`,
              description: `${planNames[plan]} 플랜 (${cycleNames[cycle]})${discountRate > 0 ? ` — ${Math.round(discountRate * 100)}% 할인 적용` : ""}`,
            },
            unit_amount: totalAmount, // KRW has no decimal
            recurring: {
              interval: cycle === "annual" ? "year" : cycle === "semiannual" ? "month" : "month",
              interval_count: cycle === "semiannual" ? 6 : 1,
            },
          },
          quantity: 1,
        },
      ];
    }

    const sessionConfig: Stripe.Checkout.SessionCreateParams = {
      customer: customerId,
      mode: "subscription",
      line_items: lineItems,
      success_url: success_url || `https://www.owner-view.com/billing?payment=success&plan=${plan}&cycle=${cycle}`,
      cancel_url: cancel_url || "https://www.owner-view.com/billing?payment=cancel",
      subscription_data: {
        metadata: {
          company_id: profile.company_id,
          user_id: profile.id,
          plan,
          billing_cycle: cycle,
        },
      },
      metadata: {
        company_id: profile.company_id,
        user_id: profile.id,
        type: "subscription",
        plan,
        billing_cycle: cycle,
        stripe_price_id: existingPriceId || "",
      },
      locale: "ko",
      allow_promotion_codes: true,
    };

    const session = await stripe.checkout.sessions.create(sessionConfig);

    return jsonResponse({
      url: session.url,
      sessionId: session.id,
      amount: totalAmount,
      discountRate,
      monthlyPrice: discountedMonthly,
    });
  } catch (err) {
    console.error("[ov-checkout] Unhandled error:", err);
    return jsonResponse(
      { error: "결제 처리 중 오류가 발생했습니다. 다시 시도해주세요." },
      500,
    );
  }
});
