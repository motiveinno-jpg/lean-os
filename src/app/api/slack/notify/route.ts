import { logRead } from "@/lib/log-read";
// Slack webhook 발송 API — 회사 settings 의 webhook URL 사용
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";
import { sendSlackNotification, type SlackPayload, type SlackEvent } from "@/lib/slack";

export async function POST(req: NextRequest) {
  try {
    // 호출자 인증 + 회사 스코프 파생. service_role 로 임의 회사 webhook 에 위조 발송 가능했던 무인증 라우트.
    const ss = await createSupabaseServerClient();
    const { data: { user: caller } } = await ss.auth.getUser();
    if (!caller) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const admin = createSupabaseAdminClient() as any;
    const callerRow = logRead('notify/route:callerRow', await admin
      .from("users")
      .select("company_id, role")
      .eq("auth_id", caller.id)
      .maybeSingle());
    if (!callerRow?.company_id) return NextResponse.json({ error: "회사 정보를 찾을 수 없습니다." }, { status: 403 });
    if (!["owner", "admin"].includes(callerRow.role || "")) {
      return NextResponse.json({ error: "Slack 발송은 대표/관리자만 가능합니다." }, { status: 403 });
    }
    // 회사 스코프는 body 가 아니라 호출자 소속에서 결정 — 남의 회사 지정 불가
    const companyId: string = callerRow.company_id;

    const body = await req.json();
    const { payload } = body as { payload?: SlackPayload };
    if (!payload) {
      return NextResponse.json({ error: "payload 필수" }, { status: 400 });
    }
    const settingsRaw = logRead('notify/route:settingsRaw', await admin
      .from("company_settings")
      .select("slack_webhook_url, slack_notify_payment, slack_notify_approval, slack_notify_large_tx, slack_large_tx_threshold")
      .eq("company_id", companyId)
      .maybeSingle());
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
      monthly_closed: true,
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
