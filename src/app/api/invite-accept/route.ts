import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

export async function POST(req: NextRequest) {
  try {
    const { email, password, name, token } = await req.json();

    if (!email || !password || !token) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }
    const normEmail = String(email).trim().toLowerCase();

    const admin = createSupabaseAdminClient();

    // 1) 초대 토큰 검증
    const ei = logRead('invite-accept/route:ei', await admin
      .from('employee_invitations')
      .select('*')
      .eq('invite_token', token)
      .eq('status', 'pending')
      .maybeSingle());

    const { data: pi } = !ei
      ? await admin
          .from('partner_invitations')
          .select('*')
          .eq('invite_token', token)
          .eq('status', 'pending')
          .maybeSingle()
      : { data: null };

    const invite = ei || pi;
    if (!invite) {
      return NextResponse.json({ error: '유효하지 않은 초대입니다.' }, { status: 404 });
    }
    if (invite.expires_at && new Date(invite.expires_at) < new Date()) {
      return NextResponse.json({ error: '만료된 초대입니다.' }, { status: 410 });
    }
    // 토큰을 초대 대상 이메일에 바인딩 — 임의 이메일로 타인 계정 탈취 차단.
    // (보안감사: 토큰만 알면 body 의 아무 이메일이나 넣어 그 계정 비번을 재설정할 수 있었음)
    const inviteEmail = String(invite.email || '').trim().toLowerCase();
    if (!inviteEmail || inviteEmail !== normEmail) {
      return NextResponse.json({ error: '초대된 이메일과 일치하지 않습니다.' }, { status: 403 });
    }

    const inviteType: 'employee' | 'partner' = ei ? 'employee' : 'partner';
    const role = inviteType === 'partner' ? 'partner' : (invite.role || 'employee');

    // 2) auth 에 같은 이메일 사용자 존재 확인 — RPC 로 직접 SQL 조회 (listUsers 회피)
    let existingUser: any = null;
    const { data: rpcRows, error: rpcErr } = await (admin as any).rpc('find_auth_user_by_email', { p_email: normEmail });
    if (rpcErr) {
      return NextResponse.json({ error: `사용자 조회 실패: ${rpcErr.message}` }, { status: 500 });
    }
    const rpcArr = Array.isArray(rpcRows) ? (rpcRows as any[]) : [];
    if (rpcArr.length > 0) {
      existingUser = { id: rpcArr[0].id, email: rpcArr[0].email, user_metadata: rpcArr[0].raw_user_meta_data };
    }

    let authUserId: string;
    if (existingUser) {
      // 3-A) 기존 가입자 — 비번 갱신 + 회사 연결
      const { error: updErr } = await admin.auth.admin.updateUserById(existingUser.id, {
        password,
        email_confirm: true,
        user_metadata: { name: name || existingUser.user_metadata?.name || normEmail.split('@')[0] },
      });
      if (updErr) {
        return NextResponse.json({ error: `사용자 업데이트 실패: ${updErr.message}` }, { status: 500 });
      }
      authUserId = existingUser.id;
    } else {
      // 3-B) 신규 가입자 — createUser
      const { data: authData, error: createErr } = await admin.auth.admin.createUser({
        email: normEmail,
        password,
        email_confirm: true,
        user_metadata: { name },
      });
      if (createErr || !authData?.user) {
        // 동시성 / 페이지네이션 누락으로 못 잡힌 경우 한 번 더 시도
        const m = (createErr?.message || '').toLowerCase();
        if (m.includes('already') || m.includes('exists') || m.includes('registered')) {
          // RPC 로 다시 조회 (race condition)
          const retryRows = logRead('invite-accept/route:retryRows', await (admin as any).rpc('find_auth_user_by_email', { p_email: normEmail }));
          const retryArr = Array.isArray(retryRows) ? (retryRows as any[]) : [];
          const retryUser = retryArr.length > 0 ? retryArr[0] : null;
          if (retryUser) {
            await admin.auth.admin.updateUserById(retryUser.id, {
              password,
              email_confirm: true,
              user_metadata: { name: name || retryUser.raw_user_meta_data?.name },
            });
            authUserId = retryUser.id;
          } else {
            return NextResponse.json({ error: `가입 실패: ${createErr?.message || '알 수 없는 오류'}` }, { status: 500 });
          }
        } else {
          return NextResponse.json({ error: createErr?.message || '계정 생성 실패' }, { status: 500 });
        }
      } else {
        authUserId = authData.user.id;
      }
    }

    // 4) public.users 동기화 — upsert (id 충돌 시 update)
    const { error: userErr } = await admin.from('users').upsert({
      id: authUserId,
      auth_id: authUserId,
      company_id: invite.company_id,
      email: normEmail,
      name: name || normEmail.split('@')[0],
      role,
    }, { onConflict: 'id' });
    if (userErr) {
      return NextResponse.json({ error: `users 동기화 실패: ${userErr.message}` }, { status: 500 });
    }

    // 5) invitation status accepted
    const table = inviteType === 'employee' ? 'employee_invitations' : 'partner_invitations';
    await admin.from(table).update({
      status: 'accepted',
      accepted_at: new Date().toISOString(),
    }).eq('invite_token', token);

    // 6) employees row 있으면 join (직원만)
    if (inviteType === 'employee') {
      const emp = logRead('invite-accept/route:emp', await admin
        .from('employees')
        .select('id')
        .eq('company_id', invite.company_id)
        .eq('email', normEmail)
        .maybeSingle());

      if (emp?.id) {
        await admin.from('employees').update({
          user_id: authUserId,
          status: 'joined',
          ...(name ? { name } : {}),
        }).eq('id', emp.id);
      }
    }

    return NextResponse.json({
      userId: authUserId,
      inviteType,
      message: '가입이 완료되었습니다.',
      existingUser: !!existingUser,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '서버 오류' }, { status: 500 });
  }
}
