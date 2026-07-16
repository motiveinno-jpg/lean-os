import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

// 회사 합류 요청 — 가입 시 사업자번호가 기등록 회사와 일치할 때 회사 생성 대신 생성.
//   보안: 사업자번호는 공개정보 → 자동 합류 금지. 요청만 만들고 owner/admin 승인 필수.
//   요청자는 아직 public.users 미보유(무소속) 상태 → service role 로 처리.

const mask = (name: string) => {
  const n = (name || '').trim();
  if (n.length <= 1) return `${n}*`;
  if (n.length <= 3) return n[0] + '*'.repeat(n.length - 1);
  return n.slice(0, 2) + '*'.repeat(Math.min(4, n.length - 2));
};

async function resolveCompany(admin: any, digits: string) {
  const formatted = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
  const data = logRead('join-request/route:data', await admin.from('companies').select('id, name').in('business_number', [formatted, digits]).limit(1));
  return data?.[0] || null;
}

export async function POST(req: NextRequest) {
  try {
    const ss = await createSupabaseServerClient();
    const { data: { user: caller } } = await ss.auth.getUser();
    if (!caller) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

    const body = await req.json();
    const digits = String(body.businessNumber || '').replace(/[^0-9]/g, '');
    if (digits.length !== 10) return NextResponse.json({ error: '사업자번호 10자리가 필요합니다.' }, { status: 400 });

    // company_join_requests 는 신규 테이블 — 생성 타입 미반영이라 any (기존 코드 관례)
    const admin = createSupabaseAdminClient() as any;

    // 이미 회사 소속이면 요청 불가 (소속 이동은 관리자의 '기존 회원 추가' 기능 사용)
    const callerRow = logRead('join-request/route:callerRow', await admin.from('users').select('id, company_id').eq('auth_id', caller.id).maybeSingle());
    if (callerRow?.company_id) {
      return NextResponse.json({ error: '이미 회사에 소속된 계정입니다.' }, { status: 409 });
    }

    const company = await resolveCompany(admin, digits);
    if (!company) return NextResponse.json({ error: '해당 사업자번호로 등록된 회사가 없습니다.' }, { status: 404 });

    // 동일 요청 dedupe — pending 이 있으면 그대로 반환 (스팸 방지 겸)
    const existing = logRead('join-request/route:existing', await admin.from('company_join_requests')
      .select('id, status')
      .eq('requester_auth_id', caller.id).eq('company_id', company.id).eq('status', 'pending')
      .limit(1));
    if (existing?.[0]) {
      return NextResponse.json({ ok: true, status: 'pending', requestId: existing[0].id, companyNameMasked: mask(company.name) });
    }

    const requesterName = String(body.name || caller.user_metadata?.display_name || caller.email?.split('@')[0] || '').trim() || null;
    const { data: reqRow, error: insErr } = await admin.from('company_join_requests').insert({
      company_id: company.id,
      requester_auth_id: caller.id,
      requester_email: caller.email || '',
      requester_name: requesterName,
      message: String(body.message || '').slice(0, 500) || null,
    }).select('id').single();
    if (insErr) return NextResponse.json({ error: `요청 생성 실패: ${insErr.message}` }, { status: 500 });

    // 회사 대표/관리자에게 인앱 알림
    const admins = logRead('join-request/route:admins', await admin.from('users').select('id').eq('company_id', company.id).in('role', ['owner', 'admin']));
    if (admins?.length) {
      await admin.from('notifications').insert(admins.map((a: any) => ({
        company_id: company.id, user_id: a.id, type: 'company_join_request',
        title: `[합류 요청] ${requesterName || caller.email}`,
        message: '회사 합류 요청이 도착했습니다. 설정 → 팀 관리에서 승인하거나 거절하세요.',
        entity_type: 'company_join_request', entity_id: reqRow.id, is_read: false,
      })));
    }

    return NextResponse.json({ ok: true, status: 'pending', requestId: reqRow.id, companyNameMasked: mask(company.name) });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '서버 오류' }, { status: 500 });
  }
}

// 내 최근 합류 요청 상태 — /join-pending 대기 화면용
export async function GET() {
  try {
    const ss = await createSupabaseServerClient();
    const { data: { user: caller } } = await ss.auth.getUser();
    if (!caller) return NextResponse.json({ error: '인증이 필요합니다.' }, { status: 401 });

    const admin = createSupabaseAdminClient() as any;

    // 승인되어 이미 소속이 생겼으면 approved 로 간주 (요청행보다 users 가 진실)
    const callerRow = logRead('join-request/route:callerRow', await admin.from('users').select('company_id').eq('auth_id', caller.id).maybeSingle());
    if (callerRow?.company_id) return NextResponse.json({ status: 'approved' });

    const data = logRead('join-request/route:data', await admin.from('company_join_requests')
      .select('id, status, created_at, expires_at, company_id, companies(name)')
      .eq('requester_auth_id', caller.id)
      .order('created_at', { ascending: false })
      .limit(1));
    const row: any = data?.[0];
    if (!row) return NextResponse.json({ status: 'none' });

    // 만료 처리 (지연 평가)
    if (row.status === 'pending' && row.expires_at && new Date(row.expires_at) < new Date()) {
      await admin.from('company_join_requests').update({ status: 'expired' }).eq('id', row.id);
      row.status = 'expired';
    }

    return NextResponse.json({
      status: row.status,
      companyNameMasked: mask(row.companies?.name || ''),
      createdAt: row.created_at,
      expiresAt: row.expires_at,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '서버 오류' }, { status: 500 });
  }
}
