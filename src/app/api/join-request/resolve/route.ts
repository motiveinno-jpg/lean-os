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
    const role = body.role === 'admin' ? 'admin' : 'employee'; // owner 조작 금지 — RPC 도 재차 강제
    const reason = String(body.reason || '').slice(0, 500) || null;

    // 원자적 처리 — 권한·상태·만료·타회사소속 재검증 + users 연결 + 요청 상태 + 알림을 단일 트랜잭션 RPC 로.
    //   멱등: 이미 원하는 상태면 그대로 성공 반환. 중간 실패 시 함수 예외로 전체 롤백.
    const { data: rpcData, error: rpcErr } = await admin.rpc('resolve_company_join_request', {
      p_request_id: requestId,
      p_action: action,
      p_role: role,
      p_reason: reason,
      p_resolver_user_id: callerRow.id,
    });
    if (rpcErr) return NextResponse.json({ error: `처리 실패: ${rpcErr.message}` }, { status: 500 });

    const result = Array.isArray(rpcData) ? rpcData[0] : rpcData;
    if (result?.error) {
      const map: Record<string, number> = {
        bad_action: 400, resolver_no_company: 403, forbidden_not_admin: 403,
        not_found: 404, forbidden_other_company: 403, already_resolved: 409,
        expired: 409, requester_in_other_company: 409,
      };
      const msg: Record<string, string> = {
        forbidden_other_company: '다른 회사의 요청입니다.',
        already_resolved: '이미 처리된 요청입니다.',
        expired: '만료된 요청입니다.',
        requester_in_other_company: '요청자가 이미 다른 회사에 소속되어 있습니다.',
        forbidden_not_admin: '합류 요청 처리는 대표/관리자만 가능합니다.',
      };
      return NextResponse.json({ error: msg[result.error] || '요청을 처리할 수 없습니다.' }, { status: map[result.error] || 400 });
    }

    // 결과 메일은 클라이언트가 send-join-result-email 로 트리거(수신자·URL 은 서버가 DB 에서 결정).
    return NextResponse.json({
      ok: true,
      status: result?.status,
      role: result?.granted_role,
      requestId,
      already: !!result?.already,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '서버 오류' }, { status: 500 });
  }
}
