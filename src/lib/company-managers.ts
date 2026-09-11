//   "이 회사에서 이 일을 맡은 사람이 누구인가" 를 한 곳에서 정한다.
//
//   권한 모델을 역할(대표·관리자·직원)에서 마스터+권한으로 바꾸면서 users.role 값을 전부
//   'member' 로 정규화했다. 그런데 사람을 찾는 조회 30여 곳이 `.in('role', ['owner','admin'])`
//   그대로 남아 있었다. 이 조건은 이제 한 줄도 맞히지 못하므로 오류 없이 빈 배열이 돌아온다 —
//   알림이 아무에게도 안 가고, 결재선 폴백이 승인자를 못 찾고, 세금계산서 담당자 메일이 빈다.
//   전부 조용히 실패해서 화면에는 아무 표시가 없었다.
//
//   ⚠️ 새 코드에서 users.role 로 사람을 찾지 말 것. 기준은 둘뿐이다:
//      · 마스터            → users.is_master
//      · 그 일의 권한 보유 → member_permissions.perm_key
//   두 집합의 합집합이 "관리자" 다. 마스터는 권한 표에 줄이 없어도 항상 포함된다.

import { supabase } from './supabase';
import { logRead } from './log-read';

const db = supabase;

/** 회사의 마스터 user id 목록. 회사마다 보통 1명이다. */
export async function getCompanyMasterIds(companyId: string): Promise<string[]> {
  if (!companyId) return [];
  const rows = logRead(
    'company-managers:masters',
    await db.from('users').select('id').eq('company_id', companyId).eq('is_master', true).limit(100),
  ) as { id: string }[] | null;
  return (rows || []).map((u) => u.id);
}

/**
 *  이 일을 받아야 할 사람들 — 마스터 + 해당 권한 보유자.
 *  `permKey` 를 주면 그 권한을 받은 구성원까지 합친다(예: '/approvals', '/employees').
 *  안 주면 마스터만. 중복은 제거한다.
 */
export async function getCompanyManagerIds(
  companyId: string,
  permKey?: string,
): Promise<string[]> {
  if (!companyId) return [];
  const ids = new Set(await getCompanyMasterIds(companyId));
  if (permKey) {
    const rows = logRead(
      'company-managers:perm',
      await db
        .from('member_permissions')
        .select('user_id')
        .eq('company_id', companyId)
        .eq('perm_key', permKey)
        .limit(1000),
    ) as { user_id: string }[] | null;
    for (const r of rows || []) if (r.user_id) ids.add(r.user_id);
  }
  return [...ids];
}

/**
 *  자동화가 사람 대신 서 있을 때 쓸 user id — 회사 마스터.
 *
 *  approval_requests.requester_id·documents.created_by 같은 칸은 uuid NOT NULL 이라
 *  'system' 같은 문자열을 넣으면 22P02 로 저장 자체가 실패한다. 그래서 자동 생성 결재가
 *  단 한 건도 만들어지지 않았고, 화면에는 "단계 실패" 만 떴다.
 *  마스터가 없으면 null 을 돌려주므로 호출부는 그 단계를 건너뛴다 — 가짜 id 를 지어내지 않는다.
 */
export async function getAutomationActorId(companyId: string): Promise<string | null> {
  const [first] = await getCompanyMasterIds(companyId);
  return first || null;
}

/** 회사 대표 연락 메일 — 마스터의 이메일. 세금계산서·구독 안내가 여기로 간다. */
export async function getCompanyMasterEmail(companyId: string): Promise<string | null> {
  if (!companyId) return null;
  const rows = logRead(
    'company-managers:master-email',
    await db
      .from('users')
      .select('email')
      .eq('company_id', companyId)
      .eq('is_master', true)
      .limit(1),
  ) as { email: string | null }[] | null;
  return rows?.[0]?.email || null;
}

/**
 *  지금 로그인한 사람이 이 일의 관리자인가 — 마스터이거나 그 권한을 받았으면 참.
 *  이미 읽어 둔 users 행을 넘겨 재조회를 피한다. 화면 가드용이고 최종 판정은 RLS 가 한다.
 */
export async function currentUserIsManager(
  user: { id?: string | null; company_id?: string | null; is_master?: boolean | null } | null | undefined,
  permKey?: string,
): Promise<boolean> {
  if (!user) return false;
  if (user.is_master) return true;
  if (!permKey || !user.id || !user.company_id) return false;
  const rows = logRead(
    'company-managers:me-perm',
    await db
      .from('member_permissions')
      .select('perm_key')
      .eq('company_id', user.company_id)
      .eq('user_id', user.id)
      .eq('perm_key', permKey)
      .limit(1),
  ) as { perm_key: string }[] | null;
  return !!rows?.length;
}
