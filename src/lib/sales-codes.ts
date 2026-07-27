import { logRead } from "@/lib/log-read";
import { supabase } from "@/lib/supabase";

/**
 * 영업사원 영업코드 (2026-07-27 가격정책).
 *   가입자가 카드 등록 시 코드를 입력하면 기본 체험 14일 + 보너스(기본 30일) = 44일.
 *   referral_codes(고객사 추천인 코드)와는 별개 — 이쪽은 회사에 속하지 않는 플랫폼 전역 코드다.
 *
 * 접근 권한: sales_codes / sales_code_redemptions 는 RLS 로 운영자(is_platform_operator)만
 *   읽고 쓸 수 있다. 사용이력 기록(insert)은 Stripe 웹훅(service_role)만 수행한다.
 */

const db = supabase as any;

export interface SalesCode {
  id: string;
  code: string;
  owner_name: string;
  owner_email: string | null;
  owner_phone: string | null;
  memo: string | null;
  bonus_trial_days: number;
  is_active: boolean;
  created_at: string;
}

/** 운영자 화면 행 — 어떤 영업코드로 어떤 회사가 가입했는지 */
export interface SalesCodeSignup {
  code: string;
  owner_name: string;
  code_active: boolean;
  company_id: string;
  company_name: string;
  business_number: string | null;
  applied_trial_days: number | null;
  redeemed_at: string;
  converted_at: string | null;
  subscription_status: string | null;
  plan_slug: string | null;
}

/** 코드 표기 규칙 — 대문자·숫자·하이픈 4~24자 (DB CHECK 와 동일) */
export const SALES_CODE_PATTERN = /^[A-Z0-9-]{4,24}$/;

export function normalizeSalesCode(raw: string): string {
  return raw.trim().toUpperCase();
}

export async function listSalesCodes(): Promise<SalesCode[]> {
  const { data, error } = await db
    .from("sales_codes")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []) as SalesCode[];
}

export async function createSalesCode(input: {
  code: string;
  ownerName: string;
  ownerEmail?: string;
  ownerPhone?: string;
  memo?: string;
  bonusTrialDays?: number;
  createdBy?: string | null;
}): Promise<void> {
  const code = normalizeSalesCode(input.code);
  if (!SALES_CODE_PATTERN.test(code)) {
    throw new Error("코드는 영문 대문자·숫자·하이픈 4~24자여야 합니다.");
  }
  const { error } = await db.from("sales_codes").insert({
    code,
    owner_name: input.ownerName.trim(),
    owner_email: input.ownerEmail?.trim() || null,
    owner_phone: input.ownerPhone?.trim() || null,
    memo: input.memo?.trim() || null,
    bonus_trial_days: input.bonusTrialDays ?? 30,
    created_by: input.createdBy || null,
  });
  if (error) {
    // unique 위반은 사용자 문구로 바꿔 전달 (코드 중복은 운영자가 자주 마주침)
    if (String(error.message || "").includes("sales_codes_code_key")) {
      throw new Error(`이미 사용 중인 코드입니다: ${code}`);
    }
    throw error;
  }
}

export async function setSalesCodeActive(id: string, isActive: boolean): Promise<void> {
  const { error } = await db
    .from("sales_codes")
    .update({ is_active: isActive, updated_at: new Date().toISOString() })
    .eq("id", id);
  if (error) throw error;
}

/** 코드별 유입 회사 목록 (운영자 전용 RPC — 게이트는 함수 내부에서 검증) */
export async function listSalesCodeSignups(): Promise<SalesCodeSignup[]> {
  const data = logRead(
    "lib/sales-codes:signups",
    await db.rpc("operator_sales_code_signups"),
  );
  return (data || []) as SalesCodeSignup[];
}
