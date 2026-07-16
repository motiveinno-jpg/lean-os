import { logRead } from "@/lib/log-read";
import { NextRequest, NextResponse } from 'next/server';
import { createSupabaseAdminClient } from '@/lib/supabase-admin';

// 가입 화면에서 사업자번호 기등록 여부 확인 (RLS 로 클라 직접 조회 불가 → service role).
//   공개 엔드포인트 — 회사 내부 정보 노출 금지: 존재 여부 + 마스킹된 회사명만 반환.
const mask = (name: string) => {
  const n = (name || '').trim();
  if (n.length <= 1) return `${n}*`;
  if (n.length <= 3) return n[0] + '*'.repeat(n.length - 1);
  return n.slice(0, 2) + '*'.repeat(Math.min(4, n.length - 2));
};

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const digits = String(body.businessNumber || '').replace(/[^0-9]/g, '');
    if (digits.length !== 10) {
      return NextResponse.json({ error: '사업자번호 10자리를 입력하세요.' }, { status: 400 });
    }
    const formatted = `${digits.slice(0, 3)}-${digits.slice(3, 5)}-${digits.slice(5)}`;

    const admin = createSupabaseAdminClient();
    // 저장 형식이 하이픈 포함/미포함 혼재 가능 → 양쪽 모두 조회
    const data = logRead('check-business-number/route:data', await admin.from('companies')
      .select('id, name')
      .in('business_number', [formatted, digits])
      .limit(1));
    const row = data?.[0];

    return NextResponse.json({
      registered: !!row,
      companyNameMasked: row ? mask(row.name) : undefined,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || '서버 오류' }, { status: 500 });
  }
}
