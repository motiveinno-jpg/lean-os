// supabase/functions/toss-billing-key/index.ts
// 토스페이먼츠 자동결제 1단계 — 카드 등록(빌링키 발급/보관/삭제) (2026-08-06)
//
// action:
//   "prepare" → 이 회사의 customerKey 를 만들어(없으면) 돌려준다. 클라이언트가 카드 등록창을 열 때 쓴다.
//   "issue"   → 카드 등록 후 돌아온 authKey 로 토스에서 billingKey 를 발급받아 암호화 저장한다.
//   "remove"  → 등록된 카드를 지운다(다음 결제가 안 나가게).
//
// ⚠️ billingKey 는 "이 카드로 임의 금액을 결제할 수 있는 열쇠"다. 응답에 절대 싣지 않는다.
//    저장도 평문이 아니라 AES-GCM 암호문 — 키는 엣지 시크릿 TOSS_BILLING_ENC_KEY(base64 32바이트).
//
// Deploy: supabase functions deploy toss-billing-key --use-api

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";
import { tfetch } from "../_shared/http.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const TOSS_ISSUE_URL = "https://api.tosspayments.com/v1/billing/authorizations/issue";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// ── 빌링키 암호화 (AES-GCM) ──
//   저장 형식: base64(iv(12바이트) + 암호문). 복호화는 정기결제 함수(2단계)에서만 한다.
async function encryptSecret(plain: string): Promise<string> {
  const raw = Deno.env.get("TOSS_BILLING_ENC_KEY");
  if (!raw) throw new Error("TOSS_BILLING_ENC_KEY not configured");
  const keyBytes = Uint8Array.from(atob(raw), (c) => c.charCodeAt(0));
  if (keyBytes.length !== 32) throw new Error("TOSS_BILLING_ENC_KEY must be 32 bytes (base64)");
  const key = await crypto.subtle.importKey("raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, new TextEncoder().encode(plain)),
  );
  const out = new Uint8Array(iv.length + cipher.length);
  out.set(iv, 0);
  out.set(cipher, iv.length);
  return btoa(String.fromCharCode(...out));
}

// customerKey — 토스에 넘어가고 URL 에도 실리므로 회사 UUID 를 쓰지 않는다(고객 식별자 노출 방지).
//   토스 제한: 영문/숫자/-_=.@ 로 2~50자. 16바이트(32자) + 접두사 = 35자로 여유 있게 맞춘다.
function newCustomerKey(): string {
  const b = crypto.getRandomValues(new Uint8Array(16));
  return "ov_" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

serve(withSentry("toss-billing-key", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing authorization" }, 401);
  const token = authHeader.slice("Bearer ".length);

  let body: { action?: string; authKey?: string; customerKey?: string };
  try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
  const action = body.action;

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabase = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  // 신원 확인 — getUser() 를 무인자로 부르면 고정 버전에서 실토큰도 401 이 난다. 토큰을 명시한다.
  const userClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!);
  const { data: userData, error: userErr } = await userClient.auth.getUser(token);
  if (userErr || !userData.user) return json({ error: "Unauthorized" }, 401);

  // auth.uid() 대조는 users.auth_id 로만 한다 — users.id 로 맞추면 레거시 불일치 계정이 무음 403 이 된다.
  const { data: profile } = await supabase
    .from("users")
    .select("id, company_id, is_master")
    .eq("auth_id", userData.user.id)
    .maybeSingle();
  if (!profile?.company_id) return json({ error: "Company not found" }, 403);
  // 결제수단 등록은 회사 대표(마스터)만.
  if (!profile.is_master) return json({ error: "결제수단은 마스터만 등록할 수 있습니다." }, 403);
  const companyId = profile.company_id as string;

  // ── prepare: customerKey 확보 ──
  if (action === "prepare") {
    const { data: existing } = await supabase
      .from("toss_billing_keys").select("customer_key").eq("company_id", companyId).maybeSingle();
    if (existing?.customer_key) return json({ customerKey: existing.customer_key });

    const customerKey = newCustomerKey();
    const { error } = await supabase
      .from("toss_billing_keys").insert({ company_id: companyId, customer_key: customerKey });
    if (error) return json({ error: error.message }, 500);
    return json({ customerKey });
  }

  // ── issue: authKey → billingKey ──
  if (action === "issue") {
    const { authKey, customerKey } = body;
    if (!authKey || !customerKey) return json({ error: "authKey, customerKey required" }, 400);

    // customerKey 가 이 회사 것인지 확인 — 남의 카드 등록을 가로채지 못하게.
    const { data: row } = await supabase
      .from("toss_billing_keys").select("company_id").eq("customer_key", customerKey).maybeSingle();
    if (!row || row.company_id !== companyId) return json({ error: "Invalid customerKey" }, 403);

    const secretKey = Deno.env.get("TOSS_SECRET_KEY");
    if (!secretKey) return json({ error: "Payment gateway not configured" }, 500);

    let issued: Record<string, any>;
    try {
      const res = await tfetch(TOSS_ISSUE_URL, {
        method: "POST",
        headers: {
          Authorization: `Basic ${btoa(`${secretKey}:`)}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ authKey, customerKey }),
      });
      const data = await res.json();
      if (!res.ok) {
        await supabase.from("billing_events").insert({
          company_id: companyId,
          event_type: "billing_key_failed",
          metadata: { code: data?.code, message: data?.message },
        });
        return json({ error: data?.message || "카드 등록에 실패했습니다.", code: data?.code }, 400);
      }
      issued = data;
    } catch (e) {
      console.error("Toss issue call failed:", e);
      return json({ error: "결제 게이트웨이에 연결하지 못했습니다." }, 502);
    }

    const billingKey = String(issued.billingKey || "");
    if (!billingKey) return json({ error: "빌링키를 받지 못했습니다." }, 502);

    let enc: string;
    try { enc = await encryptSecret(billingKey); }
    catch (e) { console.error("encrypt failed:", e); return json({ error: "서버 암호화 설정 오류" }, 500); }

    const card = issued.card || {};
    const { error: upErr } = await supabase.from("toss_billing_keys").update({
      billing_key_enc: enc,
      card_company: card.issuerCode || card.company || null,
      card_number_masked: card.number || null,
      card_type: card.cardType || null,
      registered_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }).eq("company_id", companyId);
    if (upErr) return json({ error: upErr.message }, 500);

    // 이 회사의 결제 공급자를 토스로 표시하되, Stripe 구독이 걸려 있는 행은 건드리지 않는다
    //   (2026-08-19 감사): 카드 "등록"만으로 provider 를 무조건 toss 로 바꾸면, Stripe 가
    //   살아있는 회사가 국내카드를 등록해 두기만 해도 toss-charge cron(due 모드,
    //   payment_provider='toss' 만 조회)이 청구를 시작해 Stripe 와 이중 결제가 된다.
    //   Stripe → 토스 전환은 Stripe 실취소를 수행하는 /api/billing/switch-to-toss 전용.
    await supabase.from("subscriptions")
      .update({ payment_provider: "toss", updated_at: new Date().toISOString() })
      .eq("company_id", companyId)
      .is("stripe_subscription_id", null);

    await supabase.from("billing_events").insert({
      company_id: companyId,
      event_type: "billing_key_registered",
      metadata: { cardCompany: card.issuerCode || null, cardNumber: card.number || null },
    });

    // ⚠️ billingKey 는 응답에 싣지 않는다.
    return json({ ok: true, card: { company: card.issuerCode || null, number: card.number || null } });
  }

  // ── remove: 등록 해제 ──
  if (action === "remove") {
    const { error } = await supabase.from("toss_billing_keys").update({
      billing_key_enc: null, card_company: null, card_number_masked: null,
      card_type: null, registered_at: null, updated_at: new Date().toISOString(),
    }).eq("company_id", companyId);
    if (error) return json({ error: error.message }, 500);
    await supabase.from("billing_events").insert({
      company_id: companyId, event_type: "billing_key_removed", metadata: {},
    });
    return json({ ok: true });
  }

  return json({ error: "Unknown action" }, 400);
}));
