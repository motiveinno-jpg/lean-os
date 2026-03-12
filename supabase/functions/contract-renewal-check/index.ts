// supabase/functions/contract-renewal-check/index.ts
// Contract Renewal Check — Deno Edge Function
// Designed to run on a daily cron schedule (pg_cron or external).
// Checks all companies for expiring contracts, creates reminders,
// and sends notification emails for due reminders.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// ── Renewal thresholds (mirrored from src/lib/contract-renewal.ts) ──

const RENEWAL_THRESHOLDS = [
  { days: 90, label: "3개월 전" },
  { days: 60, label: "2개월 전" },
  { days: 30, label: "1개월 전" },
  { days: 14, label: "2주 전" },
  { days: 7, label: "1주 전" },
] as const;

// ── Types ──

interface ExpiringContract {
  id: string;
  name: string;
  expiry_date: string;
  days_remaining: number;
  deal_id: string | null;
  company_id: string;
  created_by: string;
}

interface RenewalReminder {
  id: string;
  company_id: string;
  document_id: string;
  document_name: string;
  reminder_date: string;
  recipient_email: string;
  note: string | null;
  status: string;
  threshold_label: string | null;
}

interface RunSummary {
  companies_checked: number;
  contracts_found: number;
  reminders_created: number;
  notifications_sent: number;
  errors: string[];
}

// ── Main Handler ──

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  const startTime = Date.now();

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Optional: restrict to a specific company (for manual triggers)
    let targetCompanyId: string | null = null;
    try {
      const body = await req.json();
      targetCompanyId = body?.companyId ?? null;
    } catch {
      // No body — process all companies
    }

    const summary: RunSummary = {
      companies_checked: 0,
      contracts_found: 0,
      reminders_created: 0,
      notifications_sent: 0,
      errors: [],
    };

    // ── Step 1: Fetch companies to process ──
    let companiesQuery = supabase.from("companies").select("id, name, owner_id");
    if (targetCompanyId) {
      companiesQuery = companiesQuery.eq("id", targetCompanyId);
    }

    const { data: companies, error: compError } = await companiesQuery;
    if (compError) {
      throw new Error(`Failed to fetch companies: ${compError.message}`);
    }

    if (!companies || companies.length === 0) {
      return jsonResponse(200, {
        success: true,
        message: "처리할 회사가 없습니다.",
        summary,
      });
    }

    summary.companies_checked = companies.length;
    console.log(
      `[renewal-check] Processing ${companies.length} companies`,
    );

    // ── Step 2: For each company, find expiring contracts & create reminders ──
    for (const company of companies) {
      try {
        const result = await processCompanyRenewals(supabase, company.id);
        summary.contracts_found += result.contracts_found;
        summary.reminders_created += result.reminders_created;
      } catch (err: any) {
        const msg = `Company ${company.id}: ${err.message}`;
        console.error(`[renewal-check] ${msg}`);
        summary.errors.push(msg);
      }
    }

    // ── Step 3: Send notifications for due reminders ──
    try {
      const sent = await sendDueNotifications(supabase);
      summary.notifications_sent = sent;
    } catch (err: any) {
      console.error(`[renewal-check] Notification error: ${err.message}`);
      summary.errors.push(`Notification send failed: ${err.message}`);
    }

    // ── Step 4: Log the run ──
    const elapsed = Date.now() - startTime;
    console.log(
      `[renewal-check] Done in ${elapsed}ms — ` +
        `${summary.contracts_found} contracts, ` +
        `${summary.reminders_created} reminders created, ` +
        `${summary.notifications_sent} notifications sent`,
    );

    await supabase
      .from("automation_logs")
      .insert({
        company_id: targetCompanyId ?? "system",
        service: "contract-renewal",
        action: "daily-check",
        status: summary.errors.length === 0 ? "success" : "partial",
        details: { ...summary, elapsed_ms: elapsed },
        created_at: new Date().toISOString(),
      })
      .then(() => {})
      .catch((e: any) => {
        console.warn("[renewal-check] Could not write automation log:", e.message);
      });

    return jsonResponse(200, {
      success: true,
      message:
        `계약 갱신 점검 완료: ${summary.contracts_found}건 확인, ` +
        `${summary.reminders_created}건 알림 생성, ` +
        `${summary.notifications_sent}건 알림 발송`,
      summary,
    });
  } catch (err: any) {
    console.error("[renewal-check] Fatal error:", err);
    return jsonResponse(500, {
      success: false,
      message: "계약 갱신 점검 중 오류 발생",
      error: err.message,
    });
  }
});

// ── Company Processing ──

async function processCompanyRenewals(
  supabase: any,
  companyId: string,
): Promise<{ contracts_found: number; reminders_created: number }> {
  const now = new Date();
  const maxDays = RENEWAL_THRESHOLDS[0].days; // 90
  const cutoff = new Date(now);
  cutoff.setDate(cutoff.getDate() + maxDays);

  const todayStr = now.toISOString().slice(0, 10);
  const cutoffStr = cutoff.toISOString().slice(0, 10);

  // Fetch expiring contracts
  const { data: docs, error } = await supabase
    .from("documents")
    .select("id, name, status, deal_id, created_by, expiry_date, content_json")
    .eq("company_id", companyId)
    .in("status", ["executed", "locked", "approved"])
    .gte("expiry_date", todayStr)
    .lte("expiry_date", cutoffStr)
    .order("expiry_date", { ascending: true });

  if (error) {
    throw new Error(`Document query failed: ${error.message}`);
  }

  const contracts: ExpiringContract[] = [];
  for (const doc of docs || []) {
    const expiryDate =
      doc.expiry_date ?? doc.content_json?.metadata?.expiry_date ?? null;
    if (!expiryDate) continue;

    const expiry = new Date(expiryDate);
    const daysRemaining = Math.ceil(
      (expiry.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
    );
    if (daysRemaining < 0 || daysRemaining > maxDays) continue;

    contracts.push({
      id: doc.id,
      name: doc.name,
      expiry_date: expiryDate,
      days_remaining: daysRemaining,
      deal_id: doc.deal_id,
      company_id: companyId,
      created_by: doc.created_by,
    });
  }

  if (contracts.length === 0) {
    return { contracts_found: 0, reminders_created: 0 };
  }

  // Fetch existing reminders for deduplication
  const { data: existingReminders } = await supabase
    .from("contract_renewals")
    .select("document_id, reminder_date")
    .eq("company_id", companyId)
    .in("status", ["pending", "sent"]);

  const existingKeys = new Set(
    (existingReminders || []).map(
      (r: any) => `${r.document_id}::${r.reminder_date}`,
    ),
  );

  // Resolve notification email
  const recipientEmail = await resolveCompanyEmail(supabase, companyId);

  let created = 0;

  for (const contract of contracts) {
    const expiryDate = new Date(contract.expiry_date);

    for (const threshold of RENEWAL_THRESHOLDS) {
      if (contract.days_remaining > threshold.days) continue;

      const reminderDate = new Date(expiryDate);
      reminderDate.setDate(reminderDate.getDate() - threshold.days);
      const reminderDateStr = reminderDate.toISOString().slice(0, 10);

      // Skip past reminder dates
      if (reminderDateStr < todayStr) continue;

      const key = `${contract.id}::${reminderDateStr}`;
      if (existingKeys.has(key)) continue;

      const { error: insertErr } = await supabase
        .from("contract_renewals")
        .insert({
          company_id: companyId,
          document_id: contract.id,
          document_name: contract.name,
          reminder_date: reminderDateStr,
          recipient_email: recipientEmail,
          note: `자동 알림: ${contract.name} — ${threshold.label} (만료일: ${contract.expiry_date})`,
          status: "pending",
          threshold_label: threshold.label,
        });

      if (insertErr) {
        console.error(
          `[renewal-check] Insert reminder failed for ${contract.id}:`,
          insertErr.message,
        );
        continue;
      }

      existingKeys.add(key);
      created++;
    }
  }

  console.log(
    `[renewal-check] Company ${companyId}: ${contracts.length} contracts, ${created} reminders created`,
  );

  return { contracts_found: contracts.length, reminders_created: created };
}

// ── Notification Sending ──

/**
 * Find all pending reminders due today or earlier and send notifications.
 * Marks reminders as 'sent' after successful delivery.
 */
async function sendDueNotifications(supabase: any): Promise<number> {
  const todayStr = new Date().toISOString().slice(0, 10);

  const { data: dueReminders, error } = await supabase
    .from("contract_renewals")
    .select("*")
    .eq("status", "pending")
    .lte("reminder_date", todayStr)
    .order("reminder_date", { ascending: true });

  if (error) {
    throw new Error(`Failed to fetch due reminders: ${error.message}`);
  }

  if (!dueReminders || dueReminders.length === 0) {
    return 0;
  }

  console.log(`[renewal-check] ${dueReminders.length} reminders due for notification`);

  let sent = 0;

  // Group reminders by recipient for batched emails
  const byRecipient = new Map<string, RenewalReminder[]>();
  for (const reminder of dueReminders) {
    const email = reminder.recipient_email;
    if (!byRecipient.has(email)) {
      byRecipient.set(email, []);
    }
    byRecipient.get(email)!.push(reminder);
  }

  for (const [email, reminders] of byRecipient) {
    try {
      await sendNotificationEmail(supabase, email, reminders);

      // Mark all reminders in this batch as sent
      const ids = reminders.map((r) => r.id);
      const { error: updateErr } = await supabase
        .from("contract_renewals")
        .update({ status: "sent", sent_at: new Date().toISOString() })
        .in("id", ids);

      if (updateErr) {
        console.error(
          `[renewal-check] Failed to mark reminders as sent:`,
          updateErr.message,
        );
      } else {
        sent += reminders.length;
      }
    } catch (err: any) {
      console.error(
        `[renewal-check] Failed to send notification to ${email}:`,
        err.message,
      );
    }
  }

  return sent;
}

/**
 * Send a renewal notification email.
 * Uses a webhook URL if configured, otherwise logs the notification
 * for pickup by the application layer.
 */
async function sendNotificationEmail(
  supabase: any,
  recipientEmail: string,
  reminders: RenewalReminder[],
): Promise<void> {
  const webhookUrl = Deno.env.get("NOTIFICATION_WEBHOOK_URL");

  // Build the email content
  const contractLines = reminders
    .map((r) => {
      const emoji = r.threshold_label?.includes("1주") ? "🔴" : "🟡";
      return `${emoji} ${r.document_name} — ${r.threshold_label ?? ""} (알림일: ${r.reminder_date})`;
    })
    .join("\n");

  const subject = `[계약 갱신 알림] ${reminders.length}건의 계약이 만료 예정입니다`;
  const body =
    `안녕하세요,\n\n` +
    `다음 계약이 곧 만료됩니다. 갱신 여부를 확인해 주세요.\n\n` +
    `${contractLines}\n\n` +
    `OwnerView에서 자세한 내용을 확인할 수 있습니다.\n` +
    `감사합니다.`;

  if (webhookUrl) {
    // Send via external webhook (e.g., SendGrid, Resend, Slack, etc.)
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: recipientEmail,
        subject,
        text: body,
        reminders: reminders.map((r) => ({
          document_id: r.document_id,
          document_name: r.document_name,
          reminder_date: r.reminder_date,
          threshold_label: r.threshold_label,
        })),
      }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "unknown");
      throw new Error(`Webhook returned ${res.status}: ${errText}`);
    }

    console.log(
      `[renewal-check] Webhook notification sent to ${recipientEmail} (${reminders.length} reminders)`,
    );
  } else {
    // Fallback: insert into a notifications table for in-app delivery
    const { error } = await supabase.from("notifications").insert(
      reminders.map((r) => ({
        company_id: r.company_id,
        recipient_email: recipientEmail,
        type: "contract_renewal",
        title: subject,
        body: `${r.document_name} — ${r.threshold_label ?? "만료 임박"}`,
        metadata: {
          document_id: r.document_id,
          reminder_id: r.id,
          threshold_label: r.threshold_label,
        },
        read: false,
        created_at: new Date().toISOString(),
      })),
    );

    if (error) {
      // Non-critical — notifications table may not exist yet
      console.warn(
        `[renewal-check] Could not insert in-app notifications: ${error.message}`,
      );
    }

    console.log(
      `[renewal-check] In-app notification queued for ${recipientEmail} (${reminders.length} reminders)`,
    );
  }
}

// ── Helpers ──

async function resolveCompanyEmail(
  supabase: any,
  companyId: string,
): Promise<string> {
  const { data: company } = await supabase
    .from("companies")
    .select("owner_id")
    .eq("id", companyId)
    .single();

  if (company?.owner_id) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("email")
      .eq("id", company.owner_id)
      .single();

    if (profile?.email) return profile.email;
  }

  return `admin@company-${companyId.slice(0, 8)}.local`;
}

function jsonResponse(status: number, body: Record<string, unknown>) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
