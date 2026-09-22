// 2단계 인증(OTP) — Supabase Auth TOTP 를 감싼 얇은 함수들 (2026-09-22 ERP 공백 2차 ②, docs/20260921_PLAN_erp_gap_audit2.md)
//
//   기준(무엇으로 판단하나)
//   · 켜짐 = 그 계정에 **확인을 마친(verified) TOTP 인증기**가 하나 이상 있다. 등록만 하고 6자리를 안 넣은 것은 켜진 게 아니다.
//   · 관문이 필요한 상태 = 켜진 계정인데 이번 세션이 아직 6자리를 안 넣었다(currentLevel aal1, nextLevel aal2).
//   · 회사 강제 = company_settings.settings.mfa_policy.required_for: "none" | "masters" | "all". 기본 none. 마스터가 정한다.
//     대상인데 안 켠 사람은 앱에 들어올 때 등록 화면부터 본다(잠그는 게 아니라 등록시켜 들여보낸다).
//   · 되돌리기(끄기)는 6자리를 다시 넣어야 한다 — 남이 열린 화면에서 끄지 못하게.
//   · 자동으로 못 푸는 것: 인증기 기기를 잃어버린 경우. 브라우저에서는 풀 수 없고(관리 키 필요) 고객센터(운영자)가 푼다. 화면에 적는다.

import { supabase } from "@/lib/supabase";

export type MfaPolicy = { required_for: "none" | "masters" | "all" };
export const MFA_POLICY_LABEL: Record<MfaPolicy["required_for"], string> = { none: "선택 (각자 마이페이지에서)", masters: "마스터 계정 필수", all: "모든 구성원 필수" };

/** 확인을 마친 TOTP 인증기 — 켜짐 여부의 단일 기준 */
export async function listVerifiedTotp(): Promise<{ id: string; friendly_name: string | null; created_at: string }[]> {
  const { data, error } = await supabase.auth.mfa.listFactors();
  if (error) throw error;
  return ((data?.totp || []) as any[]).filter((f) => f.status === "verified").map((f) => ({ id: f.id, friendly_name: f.friendly_name ?? null, created_at: f.created_at }));
}

/** 등록만 하고 확인을 안 마친 찌꺼기 — 다시 등록하기 전에 지운다(같은 이름으로 다시 만들면 거절된다) */
async function dropUnverified() {
  const { data } = await supabase.auth.mfa.listFactors();
  for (const f of ((data?.all || []) as any[])) {
    if (f.status !== "verified") await supabase.auth.mfa.unenroll({ factorId: f.id }).catch(() => {});
  }
}

/** 등록 시작 — QR(svg data URI)·수동 입력용 키를 돌려준다. 6자리를 넣어야(verifyEnrollment) 켜진다 */
export async function startEnrollment(): Promise<{ factorId: string; qr: string; secret: string }> {
  await dropUnverified();
  const { data, error } = await supabase.auth.mfa.enroll({ factorType: "totp", friendlyName: `오너뷰 ${new Date().toISOString().slice(0, 10)}` });
  if (error) throw error;
  return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
}

/** 등록 확인(6자리) — 성공하면 이 세션도 2단계를 통과한 상태(aal2)가 된다 */
export async function verifyEnrollment(factorId: string, code: string) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (error) throw error;
}

/** 로그인 뒤 관문 — 6자리 확인 */
export async function verifyLogin(factorId: string, code: string) {
  const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: code.trim() });
  if (error) throw error;
}

/** 끄기 — 6자리를 다시 넣어 본인임을 확인한 뒤 인증기를 지운다 */
export async function disableTotp(factorId: string, code: string) {
  await verifyLogin(factorId, code);
  const { error } = await supabase.auth.mfa.unenroll({ factorId });
  if (error) throw error;
}

/** 이번 세션이 관문을 지나야 하는가 — 켜진 계정인데 아직 6자리를 안 넣었다 */
export async function needsLoginVerification(): Promise<{ needed: boolean; factorId: string | null }> {
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
  if (error) throw error;
  if (data?.nextLevel === "aal2" && data.currentLevel !== "aal2") {
    const factors = await listVerifiedTotp();
    return { needed: true, factorId: factors[0]?.id ?? null };
  }
  return { needed: false, factorId: null };
}

export async function loadMfaPolicy(): Promise<MfaPolicy> {
  const { data } = await (supabase as any).from("company_settings").select("settings").maybeSingle();
  const v = data?.settings?.mfa_policy?.required_for;
  return { required_for: v === "masters" || v === "all" ? v : "none" };
}

export async function saveMfaPolicy(companyId: string, policy: MfaPolicy) {
  const { data } = await (supabase as any).from("company_settings").select("id, settings").eq("company_id", companyId).maybeSingle();
  const settings = { ...((data?.settings as Record<string, unknown>) || {}), mfa_policy: policy };
  const { error } = data?.id
    ? await (supabase as any).from("company_settings").update({ settings }).eq("id", data.id)
    : await (supabase as any).from("company_settings").insert({ company_id: companyId, settings });
  if (error) throw error;
}

/** 오류 문구 — Supabase 영어 메시지를 사람이 읽는 말로 */
export function mfaErrorText(e: unknown): string {
  const m = String((e as any)?.message || e || "");
  if (/invalid.*code|Invalid TOTP|code.*invalid/i.test(m)) return "6자리 번호가 맞지 않습니다. 인증 앱의 새 번호를 넣어 보세요.";
  if (/expired/i.test(m)) return "시간이 지났습니다. 인증 앱의 새 번호를 넣어 보세요.";
  if (/AAL2|insufficient/i.test(m)) return "본인 확인(6자리)이 먼저 필요합니다. 다시 로그인해 주세요.";
  if (/MFA.*disabled|not enabled|unsupported/i.test(m)) return "이 서비스에 2단계 인증이 아직 열려 있지 않습니다. 고객센터에 알려 주세요.";
  return m || "처리하지 못했습니다.";
}
