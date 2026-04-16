/**
 * OwnerView Telegram helper — invokes the telegram-notify Edge Function.
 * CEO's chat_id is stored in company_settings.settings.telegram_chat_id.
 */

import { supabase } from './supabase';

export interface TelegramInlineButton {
  text: string;
  url?: string;
  callback_data?: string;
}

export async function sendTelegramMessage(params: {
  chatId: string | number;
  message: string;
  markdown?: boolean;
  keyboard?: TelegramInlineButton[][];
}): Promise<{ success: boolean; error?: string }> {
  try {
    const { data, error } = await supabase.functions.invoke('telegram-notify', {
      body: params,
    });
    if (error) return { success: false, error: error.message };
    if (data && data.success) return { success: true };
    return { success: false, error: data?.error || '알 수 없는 오류' };
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) };
  }
}

/** Retrieve the CEO's telegram chat_id stored in companies.automation_settings. */
export async function getCompanyTelegramChatId(companyId: string): Promise<string | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data } = await (supabase as any)
    .from('companies')
    .select('automation_settings')
    .eq('id', companyId)
    .maybeSingle();
  const chatId = data?.automation_settings?.ceo_telegram_chat_id;
  return chatId ? String(chatId) : null;
}

/** Notify the CEO about a payment approval that exceeds the auto-execute limit. */
export async function notifyCeoPaymentApproval(params: {
  companyId: string;
  paymentId: string;
  amount: number;
  description: string;
  recipientName?: string | null;
  approveUrl?: string;
}): Promise<{ success: boolean; error?: string; skipped?: boolean }> {
  const chatId = await getCompanyTelegramChatId(params.companyId);
  if (!chatId) return { success: false, skipped: true, error: '텔레그램 chat_id 미설정' };

  const amountFmt = params.amount.toLocaleString();
  const lines = [
    `💸 *승인 필요* — 자동이체 한도 초과`,
    ``,
    `• 금액: ${amountFmt}원`,
    params.recipientName ? `• 수취: ${params.recipientName}` : null,
    `• 내용: ${params.description}`,
    ``,
    params.approveUrl ? `검토/승인: ${params.approveUrl}` : '오너뷰 앱에서 결제관리 → 승인대기 확인',
  ].filter(Boolean);
  const message = lines.join('\n');

  const keyboard: TelegramInlineButton[][] | undefined = params.approveUrl
    ? [[{ text: '✅ 앱에서 확인', url: params.approveUrl }]]
    : undefined;

  return sendTelegramMessage({ chatId, message, keyboard });
}
