import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

// 회원 탈퇴 — 본인 계정만. auth 로그인 계정을 삭제(로그인 영구 차단)하고
//   public.users 는 익명화(PII 제거). users 로 들어오는 FK 가 수십 개(NO ACTION)라
//   행 자체 삭제는 막히므로, 행은 참조 무결성 위해 유지하고 이메일/이름만 파기.
export async function POST(req: NextRequest) {
  try {
    const ss = await createSupabaseServerClient();
    const { data: { user: caller } } = await ss.auth.getUser();
    if (!caller) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

    const admin = createSupabaseAdminClient();
    const urow = logRead('delete-account/route:urow', await admin.from('users').select('id').eq('auth_id', caller.id).maybeSingle());

    // 1) public.users 익명화 (행 유지, PII 파기)
    if (urow?.id) {
      await admin.from('users').update({
        email: `withdrawn+${urow.id}@deleted.local`,
        name: '(탈퇴한 회원)',
        avatar_url: null,
      }).eq('id', urow.id);
    }

    // 2) auth 계정 삭제 — 로그인 영구 차단 (= 탈퇴 완료)
    const { error: delErr } = await admin.auth.admin.deleteUser(caller.id);
    if (delErr) {
      return NextResponse.json({ error: `탈퇴 처리 실패: ${delErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '서버 오류' }, { status: 500 });
  }
}
