// OwnerView — Telegram Notification Edge Function
// Sends messages to Telegram (approval alerts, cash alerts, etc.)
// Payload: { chatId, message, markdown?, keyboard?: InlineButton[][] }
// Required env: TELEGRAM_BOT_TOKEN

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

type InlineButton = { text: string; url?: string; callback_data?: string };

interface TelegramPayload {
  chatId: string | number;
  message: string;
  markdown?: boolean;
  keyboard?: InlineButton[][];
  disableNotification?: boolean;
}

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: CORS_HEADERS,
    });
  }

  const token = Deno.env.get("TELEGRAM_BOT_TOKEN");
  if (!token) {
    return new Response(
      JSON.stringify({ error: "TELEGRAM_BOT_TOKEN not configured" }),
      { status: 500, headers: CORS_HEADERS }
    );
  }

  let body: TelegramPayload;
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
      status: 400,
      headers: CORS_HEADERS,
    });
  }

  if (!body.chatId || !body.message) {
    return new Response(
      JSON.stringify({ error: "chatId and message are required" }),
      { status: 400, headers: CORS_HEADERS }
    );
  }

  const telegramBody: Record<string, unknown> = {
    chat_id: body.chatId,
    text: body.message,
    disable_notification: body.disableNotification ?? false,
  };
  if (body.markdown) telegramBody.parse_mode = "MarkdownV2";
  if (body.keyboard && body.keyboard.length > 0) {
    telegramBody.reply_markup = { inline_keyboard: body.keyboard };
  }

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${token}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(telegramBody),
      }
    );
    const result = await res.json();
    if (!res.ok || !result.ok) {
      return new Response(
        JSON.stringify({ error: "Telegram API error", detail: result }),
        { status: res.status || 502, headers: CORS_HEADERS }
      );
    }
    return new Response(
      JSON.stringify({ success: true, messageId: result.result?.message_id }),
      { status: 200, headers: CORS_HEADERS }
    );
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "Network error",
        detail: err instanceof Error ? err.message : String(err),
      }),
      { status: 502, headers: CORS_HEADERS }
    );
  }
});
