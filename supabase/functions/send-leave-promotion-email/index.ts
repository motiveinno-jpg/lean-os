import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const FROM_EMAIL = 'OwnerView <noreply@owner-view.com>';

// 2026-07-06 보안감사 P1: 무인증 발송 → 브랜드 사칭 피싱 방지. 로그인 유저(실 JWT)만 발송 가능.
async function requireUser(req: Request): Promise<boolean> {
  try {
    const authHeader = req.headers.get('Authorization') || '';
    if (!authHeader) return false;
    const { data: { user } } = await createClient(
      Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    ).auth.getUser();
    return !!user;
  } catch { return false; }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }
  if (!(await requireUser(req))) return new Response(JSON.stringify({ error: '인증이 필요합니다.' }), { status: 401, headers: { 'Access-Control-Allow-Origin': '*', 'Content-Type': 'application/json' } });

  try {
    const { to, employeeName, companyName, year, noticeType, unusedDays, deadline } = await req.json();

    if (!to || !employeeName) {
      return new Response(JSON.stringify({ error: 'Missing required fields' }), { status: 400 });
    }

    const isFirst = noticeType === 'first';
    const noticeLabel = isFirst ? '1차 (연차사용 촉진 통보)' : '2차 (연차사용 최종 촉진 통보)';
    const deadlineFormatted = deadline ? new Date(deadline + 'T00:00:00').toLocaleDateString('ko-KR') : '';

    const html = `
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; background: #f5f5f5; padding: 40px 0;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="background: linear-gradient(135deg, #f59e0b, #d97706); padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 22px;">연차유급휴가 사용 촉진 통보</h1>
      <p style="color: rgba(255,255,255,0.9); margin: 8px 0 0; font-size: 14px;">${noticeLabel}</p>
    </div>
    <div style="padding: 32px;">
      <p style="font-size: 16px; color: #333; line-height: 1.6;">
        <strong>${employeeName}</strong>님께,
      </p>
      <p style="font-size: 15px; color: #555; line-height: 1.8;">
        근로기준법 제61조에 따라 <strong>${year || new Date().getFullYear()}년</strong> 귀하의 미사용 연차유급휴가에 대해 사용을 촉진합니다.
      </p>
      
      <div style="background: #fffbeb; border: 1px solid #fbbf24; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px;">미사용 연차일수</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 700; color: #d97706; font-size: 18px;">${unusedDays}일</td>
          </tr>
          <tr>
            <td style="padding: 8px 0; color: #666; font-size: 14px; border-top: 1px solid #fde68a;">사용계획 제출 기한</td>
            <td style="padding: 8px 0; text-align: right; font-weight: 600; color: #333; font-size: 14px; border-top: 1px solid #fde68a;">${deadlineFormatted}</td>
          </tr>
        </table>
      </div>

      ${isFirst ? `
      <div style="background: #f9fafb; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0; font-size: 14px; color: #555; line-height: 1.6;">
          <strong>안내사항:</strong><br>
          1. 위 기한까지 미사용 연차의 사용 시기를 정하여 서면으로 제출해 주세요.<br>
          2. 기한 내 사용 계획을 제출하지 않을 경우, 회사가 사용 시기를 지정할 수 있습니다.<br>
          3. 연차를 사용하지 않으면 소멸될 수 있으며, 사용 촉진 절차를 이행한 경우 미사용 연차에 대한 보상 의무가 면제됩니다.
        </p>
      </div>
      ` : `
      <div style="background: #fef2f2; border-radius: 8px; padding: 16px; margin: 16px 0;">
        <p style="margin: 0; font-size: 14px; color: #b91c1c; line-height: 1.6;">
          <strong>최종 통보:</strong><br>
          이전 1차 통보에 대한 사용 계획이 미제출되었거나 계획대로 사용하지 않은 연차가 있어 2차 통보합니다.<br>
          <strong>${deadlineFormatted}까지</strong> 잔여 연차를 사용해 주시기 바랍니다. 미사용 시 해당 연차는 소멸됩니다.
        </p>
      </div>
      `}

      <p style="font-size: 14px; color: #555; line-height: 1.6; margin-top: 24px;">
        본 통보는 근로기준법 제61조(연차유급휴가의 사용 촉진)에 따른 것입니다.
      </p>
      <p style="font-size: 14px; color: #555;">
        감사합니다.<br>
        <strong>${companyName || ''}</strong>
      </p>
    </div>
    <div style="background: #f9fafb; padding: 20px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
      <p style="margin: 0; font-size: 12px; color: #9ca3af;">OwnerView에서 자동 발송된 이메일입니다.</p>
    </div>
  </div>
</body>
</html>`;

    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: [to],
        subject: `[${companyName || 'OwnerView'}] ${year}년 연차사용 촉진 통보 (${isFirst ? '1차' : '2차'})`,
        html,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      return new Response(JSON.stringify({ error: err }), { status: 500 });
    }

    const result = await res.json();
    return new Response(JSON.stringify({ success: true, id: result.id }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), { status: 500 });
  }
});
