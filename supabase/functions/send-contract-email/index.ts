import { withSentry } from "../_shared/sentry.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') || '';
const FROM_EMAIL = 'OwnerView <noreply@owner-view.com>';
const APP_URL = Deno.env.get('PUBLIC_APP_URL') || 'https://www.owner-view.com';

Deno.serve(withSentry("send-contract-email", async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    });
  }

  try {
    // /sign 은 익명(anon) 컨텍스트라 사용자 JWT 로 잠글 수 없다. 대신 sign_token(=secret)에 바인딩:
    // 토큰으로 패키지를 조회해 수신자·회사명·링크를 전부 서버에서 파생 → 임의 수신자/링크 발송(오픈 릴레이) 차단.
    const { token } = await req.json();
    if (!token) {
      return new Response(JSON.stringify({ error: 'token required' }), { status: 400 });
    }

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const { data: pkg } = await admin
      .from('hr_contract_packages')
      .select('id, title, expires_at, sign_token, employees(name, email), companies(name)')
      .eq('sign_token', token)
      .maybeSingle();

    if (!pkg) {
      return new Response(JSON.stringify({ error: 'Invalid token' }), { status: 404 });
    }

    const emp = (pkg as any).employees || {};
    const comp = (pkg as any).companies || {};
    const to: string = emp.email || '';
    const employeeName: string = emp.name || '';
    const companyName: string = comp.name || '';
    const packageTitle: string = (pkg as any).title || '';
    const expiresAt: string | null = (pkg as any).expires_at || null;
    const signUrl = `${APP_URL}/sign?token=${(pkg as any).sign_token}`;

    // documentCount 는 표시용 — items 카운트 (실패해도 발송 진행)
    let documentCount = 0;
    try {
      const { count } = await admin
        .from('hr_contract_package_items')
        .select('id', { count: 'exact', head: true })
        .eq('package_id', (pkg as any).id);
      documentCount = count || 0;
    } catch { /* 표시용이므로 무시 */ }

    if (!to) {
      return new Response(JSON.stringify({ error: 'No recipient email on package' }), { status: 400 });
    }

    const expiresDate = expiresAt ? new Date(expiresAt).toLocaleDateString('ko-KR') : '14일 후';

    const html = `
<!DOCTYPE html>
<html lang="ko">
<head><meta charset="UTF-8"></head>
<body style="font-family: 'Apple SD Gothic Neo', 'Malgun Gothic', sans-serif; background: #f5f5f5; padding: 40px 0;">
  <div style="max-width: 600px; margin: 0 auto; background: white; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <div style="background: linear-gradient(135deg, #2563eb, #1d4ed8); padding: 32px; text-align: center;">
      <h1 style="color: white; margin: 0; font-size: 24px;">계약서 서명 요청</h1>
    </div>
    <div style="padding: 32px;">
      <p style="font-size: 16px; color: #333; line-height: 1.6;">
        안녕하세요, <strong>${employeeName || ''}</strong>님.
      </p>
      <p style="font-size: 15px; color: #555; line-height: 1.6;">
        <strong>${companyName || ''}</strong>에서 <strong>${packageTitle || '계약서 패키지'}</strong>에 대한 서명을 요청하였습니다.
      </p>
      <div style="background: #f0f4ff; border-radius: 8px; padding: 20px; margin: 24px 0;">
        <p style="margin: 0 0 8px; font-size: 14px; color: #666;">서명 대상 문서: <strong>${documentCount || 0}건</strong></p>
        <p style="margin: 0; font-size: 14px; color: #666;">서명 기한: <strong>${expiresDate}</strong></p>
      </div>
      <div style="text-align: center; margin: 32px 0;">
        <a href="${signUrl}" style="display: inline-block; background: #2563eb; color: white; padding: 14px 40px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: 600;">
          서명하러 가기
        </a>
      </div>
      <p style="font-size: 13px; color: #999; line-height: 1.5;">
        위 버튼이 작동하지 않으면 아래 링크를 브라우저에 직접 붙여넣으세요:<br>
        <a href="${signUrl}" style="color: #2563eb; word-break: break-all;">${signUrl}</a>
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
        subject: `[${companyName || 'OwnerView'}] ${packageTitle || '계약서'} 서명 요청`,
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
}));
