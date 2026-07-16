import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

// 이미 가입된 회원을 초대/가입 단계 없이 바로 우리 회사 직원으로 추가.
//   초대 수락(api/invite-accept) 과 동일 패턴: public.users 를 우리 회사+역할로 전환 + employees join.
//   다른 회원 레코드를 수정하므로 service role 필요 → caller 가 대표/관리자인지 먼저 검증.
export async function POST(req: NextRequest) {
  try {
    // 1) 호출자 인증 + 권한 (대표/관리자만)
    const ss = await createSupabaseServerClient();
    const { data: { user: caller } } = await ss.auth.getUser();
    if (!caller) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

    const admin = createSupabaseAdminClient();
    const callerRow = logRead('add-existing-employee/route:callerRow', await admin.from('users').select('id, company_id, role').eq('auth_id', caller.id).maybeSingle());
    if (!callerRow?.company_id) return NextResponse.json({ error: '회사 정보를 찾을 수 없습니다.' }, { status: 403 });
    if (!['owner', 'admin'].includes(callerRow.role || '')) {
      return NextResponse.json({ error: '직원 추가는 대표/관리자만 가능합니다.' }, { status: 403 });
    }
    const companyId = callerRow.company_id;

    // 2) 입력 검증
    const body = await req.json();
    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return NextResponse.json({ error: '올바른 이메일을 입력하세요.' }, { status: 400 });
    }
    const role = body.role === 'admin' ? 'admin' : 'employee';
    const inName = String(body.name || '').trim();
    const department = body.department?.trim() || null;
    const position = body.position?.trim() || null;
    const salaryMonthly = Math.round((Number(body.salary) || 0) / 12); // 연봉 → 월급
    const hireDate = body.hireDate || new Date().toISOString().slice(0, 10);

    // 3) 대상 회원 조회 — public.users 우선, 없으면 auth 에서
    const targetRow = logRead('add-existing-employee/route:targetRow', await admin.from('users').select('id, name').ilike('email', email).maybeSingle());
    let targetUserId: string | undefined = targetRow?.id;
    let targetName = inName || targetRow?.name || email.split('@')[0];

    if (!targetUserId) {
      const authRows = logRead('add-existing-employee/route:authRows', await (admin as any).rpc('find_auth_user_by_email', { p_email: email }));
      const arr = Array.isArray(authRows) ? authRows : [];
      if (arr.length === 0) {
        return NextResponse.json({ error: '가입된 회원이 아닙니다. 먼저 가입하도록 안내하거나 "직원 초대"를 이용하세요.' }, { status: 404 });
      }
      targetUserId = arr[0].id;
      targetName = inName || arr[0].raw_user_meta_data?.name || email.split('@')[0];
    }

    // 4) 본인은 추가 불가
    if (targetUserId === callerRow.id) {
      return NextResponse.json({ error: '본인은 직원으로 추가할 수 없습니다.' }, { status: 400 });
    }

    // 5) 이미 이 회사 직원인지 확인
    const emps = logRead('add-existing-employee/route:emps', await admin.from('employees').select('id, status')
      .eq('company_id', companyId).or(`user_id.eq.${targetUserId},email.eq.${email}`).limit(1));
    const existingEmp = emps?.[0];
    if (existingEmp?.status === 'joined') {
      return NextResponse.json({ error: '이미 직원으로 등록된 회원입니다.' }, { status: 409 });
    }

    // 6) public.users 를 우리 회사 + 역할로 전환 (초대 수락과 동일 — 소속 이동)
    const { error: uErr } = await admin.from('users').upsert({
      id: targetUserId, auth_id: targetUserId, email, name: targetName, company_id: companyId, role,
    }, { onConflict: 'id' });
    if (uErr) return NextResponse.json({ error: `회원 업데이트 실패: ${uErr.message}` }, { status: 500 });

    // 7) employees — 기존(초대 등) 있으면 join 처리, 없으면 신규
    if (existingEmp?.id) {
      await admin.from('employees').update({
        user_id: targetUserId, status: 'joined', name: targetName, email,
        department, position, salary: salaryMonthly, hire_date: hireDate,
      }).eq('id', existingEmp.id);
    } else {
      const { error: eErr } = await admin.from('employees').insert({
        company_id: companyId, user_id: targetUserId, name: targetName, email,
        department, position, salary: salaryMonthly, hire_date: hireDate, status: 'joined',
      });
      if (eErr) return NextResponse.json({ error: `직원 등록 실패: ${eErr.message}` }, { status: 500 });
    }

    return NextResponse.json({ ok: true, userId: targetUserId, name: targetName });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '서버 오류' }, { status: 500 });
  }
}
