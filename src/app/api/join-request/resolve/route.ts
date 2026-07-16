import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

// 합류 요청 승인/거절 — 회사 대표/관리자 전용.
//   승인 = 요청자의 public.users 를 이 회사로 생성/연결 (invite-accept 와 동일 shape).
//   다른 사용자의 users 행을 만들므로 service role 필요 → caller 권한 선검증 (add-existing-employee 패턴).
export async function POST(req: NextRequest) {
  try {
    const ss = await createSupabaseServerClient();
    const { data: { user: caller } } = await ss.auth.getUser();
    if (!caller) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

    // company_join_requests 는 신규 테이블 — 생성 타입 미반영이라 any (기존 코드 관례)
    const admin = createSupabaseAdminClient() as any;
    const callerRow = logRead('resolve/route:callerRow', await admin.from('users').select('id, company_id, role').eq('auth_id', caller.id).maybeSingle());
    if (!callerRow?.company_id) return NextResponse.json({ error: '회사 정보를 찾을 수 없습니다.' }, { status: 403 });
    if (!['owner', 'admin'].includes(callerRow.role || '')) {
      return NextResponse.json({ error: '합류 요청 처리는 대표/관리자만 가능합니다.' }, { status: 403 });
    }

    const body = await req.json();
    const requestId = String(body.requestId || '');
    const action = body.action === 'approve' ? 'approve' : body.action === 'reject' ? 'reject' : null;
    if (!requestId || !action) return NextResponse.json({ error: 'requestId, action(approve|reject)이 필요합니다.' }, { status: 400 });

    const reqRow = logRead('resolve/route:reqRow', await admin.from('company_join_requests').select('*').eq('id', requestId).maybeSingle());
    if (!reqRow) return NextResponse.json({ error: '요청을 찾을 수 없습니다.' }, { status: 404 });
    if (reqRow.company_id !== callerRow.company_id) return NextResponse.json({ error: '다른 회사의 요청입니다.' }, { status: 403 });
    if (reqRow.status !== 'pending') return NextResponse.json({ error: '이미 처리된 요청입니다.' }, { status: 409 });

    if (action === 'reject') {
      await admin.from('company_join_requests').update({
        status: 'rejected', resolved_by: callerRow.id, resolved_at: new Date().toISOString(),
      }).eq('id', requestId);
      return NextResponse.json({ ok: true, status: 'rejected' });
    }

    // approve — 요청자가 그 사이 다른 회사에 소속됐으면 중단 (소속 강제 이동 금지)
    const targetRow = logRead('resolve/route:targetRow', await admin.from('users').select('id, company_id').eq('auth_id', reqRow.requester_auth_id).maybeSingle());
    if (targetRow?.company_id && targetRow.company_id !== callerRow.company_id) {
      return NextResponse.json({ error: '요청자가 이미 다른 회사에 소속되어 있습니다.' }, { status: 409 });
    }

    const role = body.role === 'admin' ? 'admin' : 'employee';
    const name = reqRow.requester_name || reqRow.requester_email.split('@')[0];
    const { error: uErr } = await admin.from('users').upsert({
      id: reqRow.requester_auth_id, auth_id: reqRow.requester_auth_id,
      email: reqRow.requester_email, name, company_id: callerRow.company_id, role,
    }, { onConflict: 'id' });
    if (uErr) return NextResponse.json({ error: `회원 연결 실패: ${uErr.message}` }, { status: 500 });

    await admin.from('company_join_requests').update({
      status: 'approved', resolved_by: callerRow.id, resolved_at: new Date().toISOString(),
    }).eq('id', requestId);

    return NextResponse.json({ ok: true, status: 'approved', userId: reqRow.requester_auth_id, role });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '서버 오류' }, { status: 500 });
  }
}
