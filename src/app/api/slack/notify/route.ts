// Slack webhook 발송 API — 회사 settings 의 webhook URL 사용
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sendSlackNotification, type SlackPayload, type SlackEvent } from "@/lib/slack";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { companyId, payload } = body as { companyId?: string; payload?: SlackPayload };
    if (!companyId || !payload) {
      return NextResponse.json({ error: "companyId, payload 필수" }, { status: 400 });
    }
    const admin = createSupabaseAdminClient() as any;
    const { data: settingsRaw } = await admin
      .from("company_settings")
      .select("slack_webhook_url, slack_notify_payment, slack_notify_approval, slack_notify_large_tx, slack_large_tx_threshold")
      .eq("company_id", companyId)
      .maybeSingle();
    const settings = settingsRaw as any;
    if (!settings?.slack_webhook_url) {
      return NextResponse.json({ ok: false, skipped: "no_webhook" });
    }
    // 이벤트별 toggle 확인
    const eventEnabled: Record<SlackEvent, boolean> = {
      payment_request: !!settings.slack_notify_payment,
      approval_pending: !!settings.slack_notify_approval,
      large_transaction: !!settings.slack_notify_large_tx,
      tax_invoice_issued: true,
      test: true,
    };
    if (!eventEnabled[payload.event]) {
      return NextResponse.json({ ok: false, skipped: "event_disabled" });
    }
    // large_transaction 의 경우 threshold 체크
    if (payload.event === "large_transaction" && payload.amount !== undefined) {
      const threshold = Number(settings.slack_large_tx_threshold || 1000000);
      if (payload.amount < threshold) {
        return NextResponse.json({ ok: false, skipped: "below_threshold" });
      }
    }
    const ok = await sendSlackNotification(settings.slack_webhook_url, payload);
    return NextResponse.json({ ok, sent: ok });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "서버 오류" }, { status: 500 });
  }
}
