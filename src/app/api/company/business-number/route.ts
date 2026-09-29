import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseServerClient } from '@/lib/supabase-server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';
import { assertSameOrigin } from '@/lib/api-authz';

/**
 * 회사 사업자등록번호 등록·변경 — 가입 뒤 번호를 넣거나 바꾸는 유일한 길 (2026-09-29).
 *   회사 설정 › 회사정보와 온보딩이 이것만 부른다. DB 트리거(companies_business_number_guard)가 브라우저의 직접
 *   변경을 막으므로 여기를 거치지 않으면 바뀌지 않는다.
 *   전에는 두 화면이 companies 를 직접 고쳐 검사가 가입보다 약했다 — 휴·폐업 번호도 확인만 누르면 저장되고,
 *   온보딩은 국세청·중복 확인이 아예 없었으며, 겹치면 DB 원문 오류만 떴다.
 *
 *   검사(가입 화면 assertBizNoActive·checkBusinessNumberRegistered 와 같은 기준):
 *   ① 권한 — 그 회사의 마스터·관리자 또는 설정 권한자(companies UPDATE 정책과 같은 조건)
 *   ② 형식 — 10자리 + 체크섬
 *   ③ 국세청 상태 — 미등록·휴업·폐업 차단, 확인불가(API 장애)는 통과(가입과 같은 fail-open)
 *   ④ 중복 — 다른 회사가 쓰는 번호면 저장하지 않고 그 회사 이름(가림)을 알려 준다
 *   빈 값은 번호 지우기로 본다(검사 없이 비움).
 */

const mask = (name: string) => {
  const n = (name || '').trim();
  if (n.length <= 1) return `${n}*`;
  if (n.length <= 3) return n[0] + '*'.repeat(n.length - 1);
  return n.slice(0, 2) + '*'.repeat(Math.min(4, n.length - 2));
};

function checksumOk(d: string): boolean {
  if (!/^\d{10}$/.test(d)) return false;
  const w = [1, 3, 7, 1, 3, 7, 1, 3, 5];
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(d[i]) * w[i];
  sum += Math.floor((Number(d[8]) * 5) / 10);
  return (10 - (sum % 10)) % 10 === Number(d[9]);
}

type NtsStatus = '계속사업자' | '휴업자' | '폐업자' | '미등록' | '확인불가';
async function ntsStatus(digits: string): Promise<{ status: NtsStatus; taxType?: string }> {
  try {
    const url = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/verify-business-number`;
    //   국세청 조회 엣지는 JWT 검사를 안 한다(verify_jwt=false) — 권한이 가장 낮은 공개 키로 부른다
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, apikey: key },
      body: JSON.stringify({ businessNumbers: [digits] }),
      cache: 'no-store',
    });
    if (!res.ok) return { status: '확인불가' };
    const j = await res.json();
    const r = j?.results?.[0];
    if (!r) return { status: '확인불가' };
    const map: Record<string, NtsStatus> = { '01': '계속사업자', '02': '휴업자', '03': '폐업자' };
    return { status: map[r.b_stt_cd] || '미등록', taxType: r.tax_type };
  } catch {
    return { status: '확인불가' };
  }
}

const fail = (status: number, code: string, message: string, extra: Record<string, unknown> = {}) =>
  NextResponse.json({ ok: false, code, error: message, ...extra }, { status });

export async function POST(request: NextRequest) {
  { const csrf = assertSameOrigin(request); if (csrf) return csrf; }
  try {
    const supabase = await createSupabaseServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return fail(401, 'UNAUTHORIZED', '로그인이 필요합니다.');

    const admin = createSupabaseAdminClient() as any;
    const { data: me } = await admin.from('users').select('company_id, is_master').eq('auth_id', user.id).maybeSingle();
    if (!me?.company_id) return fail(403, 'NO_COMPANY', '회사 정보를 찾을 수 없습니다.');
    // ① 권한 — companies UPDATE 정책과 같은 조건(마스터·관리자·설정 권한). 사용자 세션으로 물어 본다.
    let allowed = !!me.is_master;
    if (!allowed) {
      const [{ data: mgr }, { data: perm }] = await Promise.all([
        (supabase as any).rpc('is_company_manager'),
        (supabase as any).rpc('has_any_settings_perm'),
      ]);
      allowed = mgr === true || perm === true;
    }
    if (!allowed) return fail(403, 'FORBIDDEN', '사업자등록번호는 대표(마스터)나 설정 권한이 있는 사람만 바꿀 수 있습니다.');

    const body = await request.json().catch(() => ({}));
    const digits = String(body?.businessNumber ?? '').replace(/[^0-9]/g, '');
    const { data: company } = await admin.from('companies').select('id, business_number').eq('id', me.company_id).maybeSingle();
    if (!company) return fail(404, 'NO_COMPANY', '회사 정보를 찾을 수 없습니다.');
    const currentDigits = String(company.business_number || '').replace(/[^0-9]/g, '');

    // 빈 값 = 지우기
    if (!digits) {
      if (!currentDigits) return NextResponse.json({ ok: true, unchanged: true });
      const { error } = await admin.from('companies').update({ business_number: null }).eq('id', company.id);
      if (error) return fail(500, 'DB_ERROR', '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
      return NextResponse.json({ ok: true, cleared: true });
    }
    // ② 형식
    if (digits.length !== 10) return fail(400, 'INVALID_FORMAT', '사업자등록번호는 10자리입니다.');
    if (!checksumOk(digits)) return fail(400, 'INVALID_CHECKSUM', '올바르지 않은 사업자등록번호입니다. 번호를 다시 확인해 주세요.');
    const formatted = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;
    if (digits === currentDigits) {
      // 같은 번호 — 표기만 맞춘다
      if (company.business_number !== formatted) await admin.from('companies').update({ business_number: formatted }).eq('id', company.id);
      return NextResponse.json({ ok: true, unchanged: true });
    }

    // ④ 중복 — 숫자만 비교(저장 표기가 섞여 있어도). 유니크 인덱스(companies_business_number_uniq)와 같은 기준.
    const { data: dup } = await admin.from('companies').select('id, name')
      .in('business_number', [formatted, digits]).neq('id', company.id).limit(1);
    if (dup && dup.length > 0) {
      return fail(409, 'DUPLICATE',
        `이미 오너뷰에서 다른 회사 공간(${mask(dup[0].name)})이 쓰고 있는 사업자등록번호입니다. 같은 회사라면 그 공간의 대표에게 초대를 요청해 주세요. 우리 번호가 잘못 등록된 것 같으면 고객센터로 알려 주세요.`,
        { companyNameMasked: mask(dup[0].name) });
    }

    // ③ 국세청 상태
    const nts = await ntsStatus(digits);
    if (nts.status === '미등록') return fail(400, 'NTS_UNREGISTERED', '국세청에 등록되지 않은 사업자등록번호입니다. 번호를 다시 확인해 주세요.');
    if (nts.status === '폐업자') return fail(400, 'NTS_CLOSED', '폐업 처리된 사업자등록번호는 등록할 수 없습니다.');
    if (nts.status === '휴업자') return fail(400, 'NTS_SUSPENDED', '휴업 상태의 사업자등록번호는 등록할 수 없습니다. 정상 영업 중인 번호를 입력해 주세요.');

    const { error } = await admin.from('companies').update({ business_number: formatted }).eq('id', company.id);
    if (error) {
      // 검사와 저장 사이에 같은 번호가 먼저 등록된 경우(유니크 인덱스)
      if (error.code === '23505') return fail(409, 'DUPLICATE', '방금 다른 회사 공간이 같은 사업자등록번호를 등록했습니다. 고객센터로 알려 주세요.');
      return fail(500, 'DB_ERROR', '저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
    }
    return NextResponse.json({ ok: true, status: nts.status, taxType: nts.taxType ?? null, businessNumber: formatted });
  } catch (err) {
    console.error('[company/business-number]', err instanceof Error ? err.message : err);
    return fail(500, 'INTERNAL_ERROR', '사업자등록번호를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.');
  }
}
