import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

export async function POST(req: NextRequest) {
  try {
    const { email, password, name, token } = await req.json();

    if (!email || !password || !token) {
      return NextResponse.json({ error: '필수 항목이 누락되었습니다.' }, { status: 400 });
    }

    const admin = createSupabaseAdminClient();

    const { data: ei } = await admin
      .from('employee_invitations')
      .select('*')
      .eq('invite_token', token)
      .eq('status', 'pending')
      .maybeSingle();

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

    const { data: authData, error: authErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { name },
    });

    if (authErr) {
      const m = (authErr.message || '').toLowerCase();
      const isAlreadyRegistered =
        m.includes('already been registered') ||
        m.includes('already registered') ||
        m.includes('already exists') ||
        m.includes('user already') ||
        m.includes('email_exists') ||
        (authErr as any).code === 'email_exists' ||
        (authErr as any).code === 'user_already_exists';
      if (isAlreadyRegistered) {
        // 페이지네이션으로 전체 검색 (기본 perPage=50, 50명+ 시 못 찾음)
        let existingUser: any = null;
        const normEmail = (email || '').toLowerCase();
        for (let page = 1; page <= 20; page++) {
          const { data: ul } = await admin.auth.admin.listUsers({ page, perPage: 200 });
          const users = ul?.users || [];
          existingUser = users.find((u: any) => (u.email || '').toLowerCase() === normEmail);
          if (existingUser) break;
          if (users.length < 200) break;
        }
        if (existingUser) {
          await admin.auth.admin.updateUserById(existingUser.id, {
            password,
            email_confirm: true,
            user_metadata: { name: name || existingUser.user_metadata?.name },
          });

          const inviteType = ei ? 'employee' : 'partner';
          const role = inviteType === 'partner' ? 'partner' : (invite.role || 'employee');

          await admin.from('users').upsert({
            id: existingUser.id,
            auth_id: existingUser.id,
            company_id: invite.company_id,
            email,
            name: name || email.split('@')[0],
            role,
          }, { onConflict: 'id' });

          const table = inviteType === 'employee' ? 'employee_invitations' : 'partner_invitations';
          await admin.from(table).update({ status: 'accepted' }).eq('invite_token', token);

          if (inviteType === 'employee') {
            const { data: emp } = await admin
              .from('employees')
              .select('id')
              .eq('company_id', invite.company_id)
              .eq('email', email)
              .maybeSingle();

            if (emp) {
              await admin.from('employees').update({
                user_id: existingUser.id,
                status: 'joined',
                name: name || undefined,
              }).eq('id', emp.id);
            }
          }

          return NextResponse.json({
            userId: existingUser.id,
            inviteType,
            message: '가입이 완료되었습니다.',
            existingUser: true,
          });
        }
      }
      return NextResponse.json({ error: authErr.message }, { status: 400 });
    }

    if (!authData.user) {
      return NextResponse.json({ error: '계정 생성 실패' }, { status: 500 });
    }

    const inviteType = ei ? 'employee' : 'partner';
    const role = inviteType === 'partner' ? 'partner' : (invite.role || 'employee');

    const { error: userErr } = await admin.from('users').insert({
      id: authData.user.id,
      auth_id: authData.user.id,
      company_id: invite.company_id,
      email,
      name: name || email.split('@')[0],
      role,
    });

    if (userErr && !userErr.message?.includes('duplicate')) {
      return NextResponse.json({ error: userErr.message }, { status: 500 });
    }

    const table = inviteType === 'employee' ? 'employee_invitations' : 'partner_invitations';
    await admin.from(table).update({ status: 'accepted' }).eq('invite_token', token);

    if (inviteType === 'employee') {
      const { data: emp } = await admin
        .from('employees')
        .select('id')
        .eq('company_id', invite.company_id)
        .eq('email', email)
        .maybeSingle();

      if (emp) {
        await admin.from('employees').update({
          user_id: authData.user.id,
          status: 'joined',
          name: name || undefined,
        }).eq('id', emp.id);
      }
    }

    return NextResponse.json({
      userId: authData.user.id,
      inviteType,
      message: '가입이 완료되었습니다.',
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || '서버 오류' }, { status: 500 });
  }
}
