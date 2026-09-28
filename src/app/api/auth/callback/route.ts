import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import type { EmailOtpType } from '@supabase/supabase-js';

// 가입 확인·비밀번호 재설정 메일의 링크는 supabase.co 가 아니라 여기로 온다(메일 템플릿 supabase/templates/auth/).
//   ?token_hash=…&type=signup|recovery 를 서버에서 verifyOtp 로 바꿔 세션 쿠키를 심는다 —
//   PKCE code 와 달리 가입한 브라우저가 아닌 휴대폰 메일 앱에서 열어도 된다.
const EMAIL_OTP_TYPES = new Set<EmailOtpType>(['signup', 'recovery', 'email', 'magiclink', 'invite', 'email_change']);

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get('code');
  // open redirect 방지 (2026-07-06 보안감사 P2) — 내부 경로만 허용. //evil, https://evil 등 차단.
  const rawNext = searchParams.get('next') ?? '/dashboard';
  const next = rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/dashboard';

  const tokenHash = searchParams.get('token_hash');
  const otpType = searchParams.get('type') as EmailOtpType | null;

  if (code || (tokenHash && otpType && EMAIL_OTP_TYPES.has(otpType))) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
      {
        cookies: {
          getAll() {
            return cookieStore.getAll();
          },
          setAll(cookiesToSet) {
            try {
              cookiesToSet.forEach(({ name, value, options }) =>
                cookieStore.set(name, value, options),
              );
            } catch {
              // 서버 컴포넌트에서 쿠키 설정 불가
            }
          },
        },
      },
    );

    if (code) {
      const { error } = await supabase.auth.exchangeCodeForSession(code);
      if (!error) return NextResponse.redirect(`${origin}${next}`);
    } else {
      const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash!, type: otpType! });
      //   이메일 변경은 옛 주소·새 주소 두 통을 다 눌러야 끝난다. 먼저 누른 쪽은 세션 없이 성공만 돌아오므로
      //   그대로 next 로 보내면 설명 없이 로그인 화면이 뜬다 — 나머지 한 통을 누르라고 알린다.
      if (!error && otpType === 'email_change' && !data.session) {
        return NextResponse.redirect(`${origin}/auth?notice=email_change_pending`);
      }
      if (!error) return NextResponse.redirect(`${origin}${next}`);
      //   만료·이미 사용된 링크 — 가입 확인은 대개 이미 끝난 상태라 로그인하면 된다
      return NextResponse.redirect(`${origin}/auth?error=${otpType === 'recovery' ? 'recovery_link_invalid' : 'email_link_invalid'}`);
    }
  }

  return NextResponse.redirect(`${origin}/auth?error=auth_callback_error`);
}
