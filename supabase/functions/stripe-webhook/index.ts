/**
 * OwnerView — Stripe Webhook Handler
 * 구독 생성/변경/취소, 결제 성공/실패 처리
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@14.14.0?target=deno";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { status: 200 });
  }

  try {
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    const webhookSecret = Deno.env.get("STRIPE_WEBHOOK_SECRET");
    if (!stripeKey || !webhookSecret) {
      return new Response("Webhook not configured", { status: 500 });
    }

    const stripe = new Stripe(stripeKey, {
      apiVersion: "2023-10-16",
      httpClient: Stripe.createFetchHttpClient(),
    });

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body = await req.text();
    const sig = req.headers.get("stripe-signature");
    if (!sig) {
      return new Response("Missing signature", { status: 400 });
    }

    let event: Stripe.Event;
    try {
      event = stripe.webhooks.constructEvent(body, sig, webhookSecret);
    } catch (err) {
      console.error("Webhook signature verification failed:", err.message);
      return new Response("Invalid signature", { status: 400 });
    }

    switch (event.type) {
      /* ─── CHECKOUT COMPLETED → 구독 생성 ─── */
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
        const meta = session.metadata || {};

        if (meta.type !== "subscription" || !meta.company_id) break;

        const plan = meta.plan || "starter";
        const billingCycle = meta.billing_cycle || "monthly";

        // Get plan record
        const { data: planRecord, error: planErr } = await supabase
          .from("subscription_plans")
          .select("id")
          .eq("slug", plan)
          .eq("is_active", true)
          .maybeSingle();

        if (planErr || !planRecord) {
          console.error(`[webhook] Plan not found: ${plan}`, planErr);
          return new Response(JSON.stringify({ error: "Plan not found" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Idempotency: skip if this checkout session already created a subscription
        const { data: existingSub } = await supabase
          .from("subscriptions")
          .select("id")
          .eq("company_id", meta.company_id)
          .eq("stripe_subscription_id", session.subscription as string)
          .maybeSingle();

        if (existingSub) {
          console.log(`[webhook] Subscription already exists for session, skipping: ${session.id}`);
          break;
        }

        // Deactivate existing subscriptions for this company
        await supabase
          .from("subscriptions")
          .update({ status: "canceled", updated_at: new Date().toISOString() })
          .eq("company_id", meta.company_id)
          .in("status", ["active", "past_due"]);

        // Get actual period from Stripe subscription
        const now = new Date();
        let periodStart = now;
        let periodEnd = new Date(now);
        if (session.subscription) {
          try {
            const stripeSub = await stripe.subscriptions.retrieve(session.subscription as string);
            periodStart = new Date((stripeSub as any).current_period_start * 1000);
            periodEnd = new Date((stripeSub as any).current_period_end * 1000);
          } catch (e) {
            console.warn("[webhook] Could not retrieve Stripe subscription period, using fallback:", e);
            if (billingCycle === "annual") {
              periodEnd.setFullYear(periodEnd.getFullYear() + 1);
            } else if (billingCycle === "semiannual") {
              periodEnd.setMonth(periodEnd.getMonth() + 6);
            } else {
              periodEnd.setMonth(periodEnd.getMonth() + 1);
            }
          }
        }

        // Create subscription record
        const { data: newSub, error: subErr } = await supabase.from("subscriptions").insert({
          company_id: meta.company_id,
          plan_id: planRecord.id,
          plan_slug: plan,
          billing_cycle: billingCycle,
          status: "active",
          seat_count: 1,
          stripe_customer_id: session.customer as string,
          stripe_subscription_id: session.subscription as string,
          stripe_price_id: meta.stripe_price_id || null,
          cancel_at_period_end: false,
          current_period_start: periodStart.toISOString(),
          current_period_end: periodEnd.toISOString(),
        }).select("id").maybeSingle();

        if (subErr) {
          console.error("[webhook] Failed to create subscription:", subErr);
          return new Response(JSON.stringify({ error: "DB insert failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Create invoice record (retrieve Stripe invoice for URL)
        const amt = (session.amount_total || 0);
        let stripeInvoiceUrl: string | null = null;
        let stripeInvoiceId: string | null = null;
        if (session.invoice) {
          try {
            const stripeInvoice = await stripe.invoices.retrieve(session.invoice as string);
            stripeInvoiceUrl = stripeInvoice.hosted_invoice_url || null;
            stripeInvoiceId = stripeInvoice.id;
          } catch (e) {
            console.warn("[webhook] Could not retrieve Stripe invoice:", e);
          }
        }

        const { error: invErr } = await supabase.from("invoices").insert({
          company_id: meta.company_id,
          subscription_id: newSub?.id || null,
          invoice_number: stripeInvoiceId ? `INV-${stripeInvoiceId.replace("in_", "")}` : `INV-${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}-${session.id.slice(-8)}`,
          amount: amt,
          total_amount: amt,
          status: "paid",
          description: `OwnerView ${plan} 플랜 구독 (${billingCycle})`,
          paid_at: now.toISOString(),
          stripe_invoice_id: stripeInvoiceId,
          stripe_invoice_url: stripeInvoiceUrl,
        });

        if (invErr) {
          console.error("[webhook] Failed to create invoice record:", invErr);
          // Non-fatal: subscription was created successfully
        }

        // Log billing event
        await supabase.from("billing_events").insert({
          company_id: meta.company_id,
          event_type: "subscription_created",
          metadata: {
            plan,
            billing_cycle: billingCycle,
            stripe_session_id: session.id,
            stripe_subscription_id: session.subscription,
            amount: amt,
          },
        });

        console.log(`[webhook] Subscription created: company=${meta.company_id} plan=${plan}`);
        break;
      }

      /* ─── SUBSCRIPTION UPDATED ─── */
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        const companyId = sub.metadata?.company_id;
        if (!companyId) break;

        const status = sub.cancel_at_period_end
          ? "cancelling"
          : sub.status === "active"
            ? "active"
            : sub.status === "past_due"
              ? "past_due"
              : sub.status;

        const { error: updateErr } = await supabase
          .from("subscriptions")
          .update({
            status,
            cancel_at_period_end: sub.cancel_at_period_end,
            current_period_start: new Date((sub as any).current_period_start * 1000).toISOString(),
            current_period_end: new Date((sub as any).current_period_end * 1000).toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", sub.id);

        if (updateErr) {
          console.error("[webhook] Failed to update subscription:", updateErr);
          return new Response(JSON.stringify({ error: "DB update failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        break;
      }

      /* ─── SUBSCRIPTION DELETED (취소 완료) ─── */
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        const companyId = sub.metadata?.company_id;
        if (!companyId) break;

        // Mark subscription as canceled
        const { error: delErr } = await supabase
          .from("subscriptions")
          .update({
            status: "canceled",
            canceled_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          })
          .eq("stripe_subscription_id", sub.id);

        if (delErr) {
          console.error("[webhook] Failed to cancel subscription:", delErr);
          return new Response(JSON.stringify({ error: "DB update failed" }), {
            status: 500,
            headers: { "Content-Type": "application/json" },
          });
        }

        // Re-create free plan subscription so user keeps access
        const { data: freePlan } = await supabase
          .from("subscription_plans")
          .select("id")
          .eq("slug", "free")
          .eq("is_active", true)
          .maybeSingle();

        if (freePlan) {
          // Idempotency: skip if active free subscription already exists
          const { data: existingFree } = await supabase
            .from("subscriptions")
            .select("id")
            .eq("company_id", companyId)
            .eq("plan_slug", "free")
            .eq("status", "active")
            .maybeSingle();

          if (!existingFree) {
            const farFuture = new Date();
            farFuture.setFullYear(farFuture.getFullYear() + 100);
            await supabase.from("subscriptions").insert({
              company_id: companyId,
              plan_id: freePlan.id,
              plan_slug: "free",
              billing_cycle: "monthly",
              status: "active",
              seat_count: 1,
              cancel_at_period_end: false,
              current_period_start: new Date().toISOString(),
              current_period_end: farFuture.toISOString(),
            });
            console.log(`[webhook] Free plan restored for company=${companyId}`);
          } else {
            console.log(`[webhook] Free plan already active for company=${companyId}, skipping`);
          }
        }

        // Log
        await supabase.from("billing_events").insert({
          company_id: companyId,
          event_type: "subscription_ended",
          metadata: { stripe_subscription_id: sub.id },
        });

        console.log(`[webhook] Subscription ended: company=${companyId}`);
        break;
      }

      /* ─── INVOICE PAID (갱신 결제 성공) ─── */
      case "invoice.payment_succeeded": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.subscription;
        const billingReason = (invoice as any).billing_reason || "";
        // Stripe sends 'subscription_cycle' for renewals, 'subscription_create' for first invoice
        if (!subId || billingReason === "subscription_create") break;

        // Find company from subscription
        const { data: subRecord } = await supabase
          .from("subscriptions")
          .select("id, company_id, plan_slug")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();

        if (subRecord) {
          // Idempotency: skip if invoice already recorded
          const { data: existingInv } = await supabase
            .from("invoices")
            .select("id")
            .eq("stripe_invoice_id", invoice.id)
            .maybeSingle();

          if (existingInv) {
            console.log(`[webhook] Invoice already exists: ${invoice.id}, skipping`);
            break;
          }

          const { error: invErr } = await supabase.from("invoices").insert({
            company_id: subRecord.company_id,
            subscription_id: subRecord.id,
            invoice_number: `INV-${invoice.id.replace("in_", "")}`,
            amount: (invoice.amount_paid || 0),
            total_amount: (invoice.amount_paid || 0),
            status: "paid",
            description: `OwnerView ${subRecord.plan_slug} 갱신 결제`,
            paid_at: new Date().toISOString(),
            stripe_invoice_id: invoice.id,
            stripe_invoice_url: (invoice as any).hosted_invoice_url || null,
          });

          if (invErr) {
            console.error("[webhook] Failed to create renewal invoice:", invErr);
            return new Response(JSON.stringify({ error: "DB insert failed" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }
        }
        break;
      }

      /* ─── INVOICE PAYMENT FAILED (갱신 결제 실패) ─── */
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = invoice.subscription;
        if (!subId) break;

        const { data: subRecord } = await supabase
          .from("subscriptions")
          .select("company_id")
          .eq("stripe_subscription_id", subId)
          .maybeSingle();

        if (subRecord) {
          const { error: failErr } = await supabase
            .from("subscriptions")
            .update({ status: "past_due", updated_at: new Date().toISOString() })
            .eq("stripe_subscription_id", subId);

          if (failErr) {
            console.error("[webhook] Failed to mark subscription past_due:", failErr);
            return new Response(JSON.stringify({ error: "DB update failed" }), {
              status: 500,
              headers: { "Content-Type": "application/json" },
            });
          }

          await supabase.from("billing_events").insert({
            company_id: subRecord.company_id,
            event_type: "payment_failed",
            metadata: {
              stripe_invoice_id: invoice.id,
              amount: (invoice.amount_due || 0),
            },
          });
        }
        break;
      }

      default:
        console.log("[webhook] Unhandled event:", event.type);
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (err) {
    console.error("[webhook] Error:", err);
    return new Response(
      JSON.stringify({ error: "Internal error" }),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
});
