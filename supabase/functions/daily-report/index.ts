import { withSentry } from "../_shared/sentry.ts";
// 자금일보 자동 발송 — 매일 KST 09:00 pg_cron 호출.
// granter 같은 카카오 알림톡 패턴. 검수 전엔 이메일 fallback.
//
// Actions:
//   tick — pg_cron 호출. 활성화된 회사 모두 발송.
//   send-now — 사용자 수동 테스트 (특정 회사 + 날짜).
//
// 인증: HOMETAX_CRON_SECRET 또는 user JWT.
// Solapi 발송: SOLAPI_API_KEY/SECRET/PFID/TEMPLATE_ID 4개 secret 필요. 없으면 skip.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { createHmac, randomBytes } from "node:crypto";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

// ─── 자금일보 데이터 집계 ───
async function buildReport(supabase: any, companyId: string, reportDate: string) {
  // reportDate = YYYY-MM-DD (어제). 그날 00:00 ~ 23:59 데이터 집계.
  const dayStart = `${reportDate}T00:00:00`;
  const dayEnd = `${reportDate}T23:59:59`;

  const [companyRow, cardTx, bankTx, taxInv, banks] = await Promise.all([
    supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
    supabase.from("card_transactions").select("amount").eq("company_id", companyId)
      .gte("transaction_date", reportDate).lte("transaction_date", reportDate),
    supabase.from("bank_transactions").select("amount, type").eq("company_id", companyId)
      .gte("transaction_date", reportDate).lte("transaction_date", reportDate),
    supabase.from("tax_invoices").select("total_amount, type").eq("company_id", companyId)
      .gte("issue_date", reportDate).lte("issue_date", reportDate),
    supabase.from("bank_accounts").select("balance").eq("company_id", companyId),
  ]);

  const sum = (rows: any[], field = "amount", filter?: (r: any) => boolean) =>
    (rows || [])
      .filter(r => !filter || filter(r))
      .reduce((s, r) => s + Number(r[field] || 0), 0);

  return {
    회사명: companyRow.data?.name || "회사",
    기준일: reportDate,
    카드지출: sum(cardTx.data, "amount"),
    은행출금: sum(bankTx.data, "amount", r => r.type === "expense"),
    은행입금: sum(bankTx.data, "amount", r => r.type === "income"),
    매입계산서: sum(taxInv.data, "total_amount", r => r.type === "purchase"),
    매출계산서: sum(taxInv.data, "total_amount", r => r.type === "sales"),
    잔액: sum(banks.data, "balance"),
  };
}

// ─── Solapi 알림톡 발송 ───
// HMAC SHA256 서명 — Solapi 인증 표준.
function buildSolapiAuth(apiKey: string, apiSecret: string) {
  const date = new Date().toISOString();
  const salt = randomBytes(16).toString("hex");
  const data = date + salt;
  const signature = createHmac("sha256", apiSecret).update(data).digest("hex");
  return `HMAC-SHA256 apiKey=${apiKey}, date=${date}, salt=${salt}, signature=${signature}`;
}

async function sendKakaoAlimtalk(
  to: string,
  templateId: string,
  pfId: string,
  variables: Record<string, string>,
  apiKey: string,
  apiSecret: string,
) {
  const auth = buildSolapiAuth(apiKey, apiSecret);
  const body = {
    message: {
      to,
      from: undefined,  // 알림톡은 발신번호 미사용 (PFID 가 발신 식별)
      kakaoOptions: {
        pfId,
        templateId,
        variables,
      },
    },
  };
  const res = await fetch("https://api.solapi.com/messages/v4/send", {
    method: "POST",
    headers: {
      Authorization: auth,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  const txt = await res.text();
  return { ok: res.status >= 200 && res.status < 300, status: res.status, body: txt };
}

// ─── 한 회사의 자금일보 발송 ───
async function sendForCompany(
  supabase: any,
  companyId: string,
  reportDate: string,
  config: {
    apiKey?: string;
    apiSecret?: string;
    pfId?: string;
    templateId?: string;
  },
) {
  const { data: setting } = await supabase
    .from("notification_settings")
    .select("daily_report_phones, daily_report_emails")
    .eq("company_id", companyId)
    .maybeSingle();
  if (!setting) return { sent: 0, skipped: "no settings" };

  const phones: string[] = setting.daily_report_phones || [];
  if (phones.length === 0) return { sent: 0, skipped: "no recipients" };

  const r = await buildReport(supabase, companyId, reportDate);
  const variables = {
    "#{회사명}": r.회사명,
    "#{기준일}": r.기준일,
    "#{카드지출}": r.카드지출.toLocaleString(),
    "#{은행출금}": r.은행출금.toLocaleString(),
    "#{은행입금}": r.은행입금.toLocaleString(),
    "#{매입계산서}": r.매입계산서.toLocaleString(),
    "#{매출계산서}": r.매출계산서.toLocaleString(),
    "#{잔액}": r.잔액.toLocaleString(),
  };

  // Solapi 키 없으면 dry-run (검수 전 확인용)
  if (!config.apiKey || !config.apiSecret || !config.pfId || !config.templateId) {
    return {
      sent: 0,
      skipped: "solapi_not_configured",
      report: r,
      variables,
      recipients: phones,
    };
  }

  const results = [];
  for (const to of phones) {
    const r = await sendKakaoAlimtalk(
      to.replace(/[^0-9]/g, ""),
      config.templateId,
      config.pfId,
      variables,
      config.apiKey,
      config.apiSecret,
    );
    results.push({ to, ...r });
  }
  const sent = results.filter(x => x.ok).length;
  return { sent, total: phones.length, results, report: r };
}

serve(withSentry("daily-report", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    const body = await req.json().catch(() => ({}));
    const action = body.action || "tick";

    // 인증
    const CRON_SECRET = Deno.env.get("HOMETAX_CRON_SECRET") || "";
    const cronHeader = req.headers.get("x-cron-secret") || "";
    const authHeader = req.headers.get("authorization") || "";
    const isCronAuth = !!CRON_SECRET && cronHeader === CRON_SECRET;

    let user: any = null;
    if (!isCronAuth) {
      const userClient = createClient(
        Deno.env.get("SUPABASE_URL") ?? "",
        Deno.env.get("SUPABASE_ANON_KEY") ?? "",
        { global: { headers: { Authorization: authHeader } } },
      );
      const result = await userClient.auth.getUser();
      user = result.data?.user;
      if (!user) {
        return new Response(JSON.stringify({ error: "Unauthorized" }), {
          status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // Solapi config
    const cfg = {
      apiKey: Deno.env.get("SOLAPI_API_KEY"),
      apiSecret: Deno.env.get("SOLAPI_API_SECRET"),
      pfId: Deno.env.get("SOLAPI_KAKAO_PFID"),
      templateId: Deno.env.get("SOLAPI_TEMPLATE_ID_DAILY"),
    };

    if (action === "send-now") {
      // 사용자 수동 테스트. companyId + reportDate (옵션, default 어제) 받음.
      const { companyId, reportDate } = body;
      if (!companyId) {
        return new Response(JSON.stringify({ error: "companyId required" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (user) {
        // 본인 회사만
        const { data: u } = await supabase.from("users").select("company_id").eq("auth_id", user.id).maybeSingle();
        if (!u || u.company_id !== companyId) {
          return new Response(JSON.stringify({ error: "권한 없음" }), {
            status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      }
      const date = reportDate || (() => {
        const d = new Date();
        d.setDate(d.getDate() - 1);
        return d.toISOString().slice(0, 10);
      })();
      const result = await sendForCompany(supabase, companyId, date, cfg);
      await supabase.from("notification_settings").update({
        last_sent_at: new Date().toISOString(),
        last_sent_status: result.skipped || `sent ${result.sent}/${result.total ?? 0}`,
      }).eq("company_id", companyId);
      return new Response(JSON.stringify({ ok: true, ...result }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "tick") {
      // pg_cron 매일 KST 09:00 호출. 현재 KST 시각의 hour 와 일치하는 회사만.
      const nowUtc = new Date();
      const kstHour = (nowUtc.getUTCHours() + 9) % 24;
      const reportDate = (() => {
        const kst = new Date(nowUtc.getTime() + 9 * 60 * 60 * 1000);
        kst.setUTCDate(kst.getUTCDate() - 1);  // 어제 (KST)
        return kst.toISOString().slice(0, 10);
      })();

      const { data: companies } = await supabase
        .from("notification_settings")
        .select("company_id, daily_report_send_hour")
        .eq("daily_report_enabled", true)
        .eq("daily_report_send_hour", kstHour);

      const results = [];
      for (const c of (companies || [])) {
        try {
          const r = await sendForCompany(supabase, c.company_id, reportDate, cfg);
          results.push({ companyId: c.company_id, ...r });
          await supabase.from("notification_settings").update({
            last_sent_at: new Date().toISOString(),
            last_sent_status: r.skipped || `sent ${r.sent}/${r.total ?? 0}`,
          }).eq("company_id", c.company_id);
        } catch (e: any) {
          results.push({ companyId: c.company_id, error: e.message });
        }
      }
      return new Response(JSON.stringify({
        ok: true, kstHour, reportDate,
        triggered: companies?.length || 0,
        results,
        solapi_configured: !!(cfg.apiKey && cfg.pfId && cfg.templateId),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || String(err) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
