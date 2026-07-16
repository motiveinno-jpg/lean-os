import { logRead } from "@/lib/log-read";
// Slack Incoming Webhook 알림 — Granter 패턴
// 회사 설정에 webhook URL 등록 후 결제/결재/큰 거래 발생 시 자동 알림
import { supabase } from "./supabase";

const db = supabase;

export type SlackEvent =
  | "payment_request"      // 결제 요청 (payment_queue 추가)
  | "approval_pending"     // 결재 요청
  | "large_transaction"    // 큰 금액 거래
  | "tax_invoice_issued"   // 세금계산서 발행
  | "monthly_closed"       // 월결산 자동 마감 완료
  | "test";

export interface SlackPayload {
  event: SlackEvent;
  companyName?: string;
  title: string;
  message?: string;
  amount?: number;
  link?: string;
  fields?: Array<{ label: string; value: string }>;
}

/**
 * Slack webhook 으로 메시지 발송 (server-side / API route 에서 호출 권장).
 * client-side 호출 시 CORS 영향. 가능하면 백엔드에서.
 */
export async function sendSlackNotification(webhookUrl: string, payload: SlackPayload): Promise<boolean> {
  if (!webhookUrl) return false;
  const emoji: Record<SlackEvent, string> = {
    payment_request: "💸",
    approval_pending: "📋",
    large_transaction: "⚠️",
    tax_invoice_issued: "🧾",
    monthly_closed: "📕",
    test: "🔔",
  };
  const color: Record<SlackEvent, string> = {
    payment_request: "#FACC15",
    approval_pending: "#FACC15",
    large_transaction: "#DC2626",
    tax_invoice_issued: "#059669",
    monthly_closed: "#18181B",
    test: "#18181B",
  };
  const blocks: any[] = [
    {
      type: "header",
      text: { type: "plain_text", text: `${emoji[payload.event]} ${payload.title}`, emoji: true },
    },
  ];
  if (payload.message) {
    blocks.push({
      type: "section",
      text: { type: "mrkdwn", text: payload.message },
    });
  }
  if (payload.amount !== undefined) {
    blocks.push({
      type: "section",
      fields: [
        { type: "mrkdwn", text: `*금액*\n₩${Math.round(payload.amount).toLocaleString("ko-KR")}` },
        ...(payload.companyName ? [{ type: "mrkdwn", text: `*회사*\n${payload.companyName}` }] : []),
      ],
    });
  }
  if (payload.fields && payload.fields.length > 0) {
    blocks.push({
      type: "section",
      fields: payload.fields.map(f => ({ type: "mrkdwn", text: `*${f.label}*\n${f.value}` })),
    });
  }
  if (payload.link) {
    blocks.push({
      type: "actions",
      elements: [{
        type: "button",
        text: { type: "plain_text", text: "OwnerView 에서 보기" },
        url: payload.link,
      }],
    });
  }
  try {
    const res = await fetch(webhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        attachments: [{ color: color[payload.event], blocks }],
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export interface SlackSettings {
  slack_webhook_url: string | null;
  slack_notify_payment: boolean;
  slack_notify_approval: boolean;
  slack_notify_large_tx: boolean;
  slack_large_tx_threshold: number;
}

export async function getSlackSettings(companyId: string): Promise<SlackSettings | null> {
  const data = logRead('lib/slack:data', await db.from("company_settings")
    .select("slack_webhook_url, slack_notify_payment, slack_notify_approval, slack_notify_large_tx, slack_large_tx_threshold")
    .eq("company_id", companyId)
    .maybeSingle());
  return data || null;
}

export async function updateSlackSettings(companyId: string, settings: Partial<SlackSettings>): Promise<void> {
  const { error } = await db.from("company_settings").upsert({
    company_id: companyId,
    ...settings,
  }, { onConflict: "company_id" });
  if (error) throw error;
}
