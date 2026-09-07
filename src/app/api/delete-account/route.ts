import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { createClient } from '@supabase/supabase-js';
import { assertSameOrigin } from '@/lib/api-authz';

// 회원 탈퇴 — 본인 계정만. auth 로그인 계정을 삭제(로그인 영구 차단)하고
//   public.users 는 익명화(PII 제거). users 로 들어오는 FK 가 수십 개(NO ACTION)라
//   행 자체 삭제는 막히므로, 행은 참조 무결성 위해 유지하고 이메일/이름만 파기.
export async function POST(req: NextRequest) {
  { const csrf = assertSameOrigin(req); if (csrf) return csrf; }
  try {
    const ss = await createSupabaseServerClient();
    const { data: { user: caller } } = await ss.auth.getUser();
    if (!caller) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

    // 되돌릴 수 없는 작업 — 비밀번호 계정은 비밀번호를 다시 받아 확인한다(세션 탈취만으로 탈퇴가 안 되게).
    //   소셜(네이버) 전용 계정은 비밀번호가 없어 확인 문구로 대신한다.
    const body = await req.json().catch(() => ({} as Record<string, unknown>));
    const providers: string[] = (caller.app_metadata as { providers?: string[] } | undefined)?.providers || [];
    const hasPassword = providers.length === 0 || providers.includes('email');
    if (hasPassword) {
      const password = String((body as { password?: unknown }).password || '');
      if (!password) return NextResponse.json({ error: '비밀번호를 입력해 주세요.', code: 'PASSWORD_REQUIRED' }, { status: 400 });
      const verifier = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(), { auth: { persistSession: false, autoRefreshToken: false } });
      const { error: pwErr } = await verifier.auth.signInWithPassword({ email: caller.email || '', password });
      if (pwErr) return NextResponse.json({ error: '비밀번호가 맞지 않습니다.', code: 'PASSWORD_MISMATCH' }, { status: 403 });
    } else if (String((body as { confirm?: unknown }).confirm || '') !== '탈퇴') {
      return NextResponse.json({ error: '확인 문구가 맞지 않습니다.' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();
    const urow = logRead('delete-account/route:urow', await admin.from('users').select('id, company_id, role').eq('auth_id', caller.id).maybeSingle());

    // 1) public.users 익명화 (행 유지, PII 파기)
    if (urow?.id) {
      await admin.from('users').update({
        email: `withdrawn+${urow.id}@deleted.local`,
        name: '(탈퇴한 회원)',
        avatar_url: null,
      }).eq('id', urow.id);
    }

    // 1.5) 탈퇴 시점 기록 — 운영자 대시보드 탈퇴 추이용, PII 없음 (2026-07-28)
    await admin.from('account_deletions' as never).insert({
      company_id: (urow as any)?.company_id ?? null,
      role: (urow as any)?.role ?? null,
    } as never);

    // 2) auth 계정 삭제 — 로그인 영구 차단 (= 탈퇴 완료)
    const { error: delErr } = await admin.auth.admin.deleteUser(caller.id);
    if (delErr) {
      console.error('[delete-account] auth delete failed:', delErr.message);
      return NextResponse.json({ error: '탈퇴 처리에 실패했습니다. 고객센터로 문의해 주세요.' }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    console.error('[delete-account]', err?.message || err);
    return NextResponse.json({ error: '서버 오류' }, { status: 500 });
  }
}
