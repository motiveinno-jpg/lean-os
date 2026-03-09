/**
 * OwnerView Referral System
 * 추천인 코드 생성 + 크레딧 적립 + 리더보드
 */

import { supabase } from './supabase';

// 신규 테이블 타입이 아직 database.ts에 없으므로 any 캐스팅
const db = supabase as any;

// ── 추천 1건당 크레딧 (₩10,000) ──
export const CREDIT_PER_REFERRAL = 10000;

// ── 추천 코드 문자셋 (혼동 방지: 0/O, 1/I/L 제외) ──
const CODE_CHARS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 8;

export interface ReferralInfo {
  code: string;
  companyId: string;
  referredCount: number;
  creditEarned: number;
  createdAt: string;
}

export interface ReferralLeaderEntry {
  companyId: string;
  companyName: string | null;
  referredCount: number;
  creditEarned: number;
}

// ── 1. 추천 코드 생성 (8자리 영숫자) ──
export function generateReferralCode(): string {
  let code = '';
  const arr = new Uint8Array(CODE_LENGTH);
  crypto.getRandomValues(arr);
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_CHARS[arr[i] % CODE_CHARS.length];
  }
  return code;
}

// ── 2. 추천 코드 조회 (없으면 생성) ──
export async function getReferralCode(companyId: string): Promise<string> {
  // 기존 코드 조회
  const { data: existing } = await db
    .from('referral_codes')
    .select('code')
    .eq('company_id', companyId)
    .maybeSingle();

  if (existing?.code) return existing.code;

  // 새 코드 생성 (중복 방지 재시도)
  let attempts = 0;
  const maxAttempts = 5;

  while (attempts < maxAttempts) {
    const code = generateReferralCode();

    const { data, error } = await db
      .from('referral_codes')
      .insert({
        company_id: companyId,
        code,
        referred_count: 0,
        credit_earned: 0,
      })
      .select('code')
      .single();

    if (!error && data) return data.code;

    // 유니크 제약 위반이면 재시도, 그 외 에러는 throw
    if (error && !error.message.includes('unique')) {
      throw error;
    }

    attempts++;
  }

  throw new Error('추천 코드 생성에 실패했습니다. 다시 시도해주세요.');
}

// ── 3. 추천 코드 적용 ──
export async function applyReferralCode(
  code: string,
  newCompanyId: string
): Promise<{ referrerCompanyId: string; creditAmount: number }> {
  // 추천 코드 유효성 확인
  const { data: referral, error: findError } = await db
    .from('referral_codes')
    .select('company_id, referred_count, credit_earned')
    .eq('code', code.toUpperCase().trim())
    .single();

  if (findError || !referral) {
    throw new Error('유효하지 않은 추천 코드입니다');
  }

  // 자기 자신 추천 방지
  if (referral.company_id === newCompanyId) {
    throw new Error('자기 자신의 추천 코드는 사용할 수 없습니다');
  }

  // 추천인 카운트 + 크레딧 증가
  const newCount = (referral.referred_count || 0) + 1;
  const newCredit = (referral.credit_earned || 0) + CREDIT_PER_REFERRAL;

  const { error: updateError } = await db
    .from('referral_codes')
    .update({
      referred_count: newCount,
      credit_earned: newCredit,
    })
    .eq('code', code.toUpperCase().trim());

  if (updateError) throw updateError;

  return {
    referrerCompanyId: referral.company_id,
    creditAmount: CREDIT_PER_REFERRAL,
  };
}

// ── 4. 추천 통계 조회 ──
export async function getReferralStats(
  companyId: string
): Promise<ReferralInfo | null> {
  const { data, error } = await db
    .from('referral_codes')
    .select('*')
    .eq('company_id', companyId)
    .maybeSingle();

  if (error) throw error;
  if (!data) return null;

  return {
    code: data.code,
    companyId: data.company_id,
    referredCount: data.referred_count || 0,
    creditEarned: data.credit_earned || 0,
    createdAt: data.created_at,
  };
}

// ── 5. 추천 리더보드 (관리자용) ──
export async function getLeaderboard(
  limit: number = 20
): Promise<ReferralLeaderEntry[]> {
  const { data, error } = await db
    .from('referral_codes')
    .select('company_id, referred_count, credit_earned, companies(name)')
    .gt('referred_count', 0)
    .order('referred_count', { ascending: false })
    .limit(limit);

  if (error) throw error;

  return (data || []).map((row: any) => ({
    companyId: row.company_id,
    companyName: (row.companies as { name: string } | null)?.name || null,
    referredCount: row.referred_count || 0,
    creditEarned: row.credit_earned || 0,
  }));
}
