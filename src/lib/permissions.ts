/**
 * OwnerView Permission Management System
 * 플렉스 스타일 권한 그룹 관리
 */

import { supabase } from './supabase';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

// ── Types ──

export interface PermissionGroup {
  id: string;
  company_id: string;
  name: string;
  description: string;
  icon: string;
  is_system: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  member_count?: number;
  members?: PermissionGroupMember[];
  permissions?: PermissionDefinition[];
}

export interface PermissionDefinition {
  id: string;
  module: string;
  action: string;
  label: string;
  description: string;
  sort_order: number;
}

export interface PermissionGroupMember {
  id: string;
  group_id: string;
  user_id: string;
  company_id: string;
  created_at: string;
  user?: {
    id: string;
    name: string;
    email: string;
    role: string;
    avatar_url?: string;
  };
}

// ── Module labels ──

export const MODULE_LABELS: Record<string, string> = {
  dashboard: '대시보드',
  deals: '딜 파이프라인',
  invoices: '세금계산서',
  hr: '구성원 관리',
  payroll: '급여',
  attendance: '근태',
  accounting: '회계/거래내역',
  documents: '계약/문서',
  chat: '채팅',
  contacts: '거래처',
  settings: '설정',
};

export const ACTION_LABELS: Record<string, string> = {
  view: '조회',
  create: '생성',
  edit: '수정',
  delete: '삭제',
  approve: '승인',
  export: '내보내기',
  manage_members: '구성원 관리',
  manage_billing: '구독 관리',
};

// ── System group constants ──

export const SYSTEM_GROUPS = {
  SUPER_ADMIN: '최고 관리자',
  TEAM_LEAD: '조직장',
  DEFAULT: '기본 권한',
} as const;

// ── Queries ──

/** 회사의 모든 권한 그룹 조회 (멤버 수 포함) */
export async function getPermissionGroups(companyId: string): Promise<PermissionGroup[]> {
  const { data: groups, error } = await db
    .from('permission_groups')
    .select('*')
    .eq('company_id', companyId)
    .order('sort_order', { ascending: true });

  if (error) throw error;
  if (!groups || groups.length === 0) return [];

  // 각 그룹의 멤버 수 조회
  const { data: memberCounts } = await db
    .from('permission_group_members')
    .select('group_id')
    .eq('company_id', companyId);

  const countMap: Record<string, number> = {};
  (memberCounts || []).forEach((m: { group_id: string }) => {
    countMap[m.group_id] = (countMap[m.group_id] || 0) + 1;
  });

  return groups.map((g: PermissionGroup) => ({
    ...g,
    member_count: countMap[g.id] || 0,
  }));
}

/** 특정 권한 그룹 상세 (멤버 + 권한 포함) */
export async function getPermissionGroupDetail(groupId: string): Promise<PermissionGroup | null> {
  const { data: group, error } = await db
    .from('permission_groups')
    .select('*')
    .eq('id', groupId)
    .single();

  if (error || !group) return null;

  // 멤버 조회
  const { data: members } = await db
    .from('permission_group_members')
    .select(`
      id, group_id, user_id, company_id, created_at,
      users:user_id (id, name, email, role, avatar_url)
    `)
    .eq('group_id', groupId);

  // 권한 조회
  const { data: permLinks } = await db
    .from('permission_group_permissions')
    .select('permission_id')
    .eq('group_id', groupId);

  let permissions: PermissionDefinition[] = [];
  if (permLinks && permLinks.length > 0) {
    const permIds = permLinks.map((p: { permission_id: string }) => p.permission_id);
    const { data: perms } = await db
      .from('permission_definitions')
      .select('*')
      .in('id', permIds)
      .order('sort_order');
    permissions = perms || [];
  }

  return {
    ...group,
    members: (members || []).map((m: PermissionGroupMember & { users: unknown }) => ({
      ...m,
      user: m.users,
    })),
    permissions,
    member_count: members?.length || 0,
  };
}

/** 전체 권한 정의 목록 (모듈별 그룹핑) */
export async function getAllPermissionDefinitions(): Promise<Record<string, PermissionDefinition[]>> {
  const { data, error } = await db
    .from('permission_definitions')
    .select('*')
    .order('sort_order');

  if (error) throw error;

  const grouped: Record<string, PermissionDefinition[]> = {};
  (data || []).forEach((p: PermissionDefinition) => {
    if (!grouped[p.module]) grouped[p.module] = [];
    grouped[p.module].push(p);
  });
  return grouped;
}

/** 특정 사용자의 모든 권한 조회 */
export async function getUserPermissions(
  userId: string,
  companyId: string,
): Promise<{ modules: Record<string, string[]>; groupNames: string[] }> {
  // 사용자가 속한 그룹 조회
  const { data: memberships } = await db
    .from('permission_group_members')
    .select('group_id, permission_groups(id, name, is_system)')
    .eq('user_id', userId)
    .eq('company_id', companyId);

  if (!memberships || memberships.length === 0) {
    return { modules: {}, groupNames: [] };
  }

  const groupIds = memberships.map((m: { group_id: string }) => m.group_id);
  const groupNames = memberships.map(
    (m: { permission_groups: { name: string } }) => m.permission_groups?.name || '',
  ).filter(Boolean);

  // 그룹들의 권한 조회
  const { data: permLinks } = await db
    .from('permission_group_permissions')
    .select('permission_id, permission_definitions(module, action)')
    .in('group_id', groupIds);

  const modules: Record<string, string[]> = {};
  (permLinks || []).forEach((p: { permission_definitions: { module: string; action: string } }) => {
    const def = p.permission_definitions;
    if (!def) return;
    if (!modules[def.module]) modules[def.module] = [];
    if (!modules[def.module].includes(def.action)) {
      modules[def.module].push(def.action);
    }
  });

  return { modules, groupNames };
}

/** 특정 사용자가 특정 권한을 가지고 있는지 확인 */
export async function hasPermission(
  userId: string,
  companyId: string,
  module: string,
  action: string,
): Promise<boolean> {
  // owner는 항상 전체 권한
  const { data: user } = await db
    .from('users')
    .select('role')
    .eq('id', userId)
    .single();

  if (user?.role === 'owner') return true;

  const { modules } = await getUserPermissions(userId, companyId);
  return modules[module]?.includes(action) || false;
}

// ── Mutations ──

/** 권한 그룹 생성 */
export async function createPermissionGroup(params: {
  companyId: string;
  name: string;
  description?: string;
  icon?: string;
}): Promise<PermissionGroup> {
  // 정렬 순서 계산
  const { data: existing } = await db
    .from('permission_groups')
    .select('sort_order')
    .eq('company_id', params.companyId)
    .order('sort_order', { ascending: false })
    .limit(1);

  const nextOrder = (existing?.[0]?.sort_order || 0) + 10;

  const { data, error } = await db
    .from('permission_groups')
    .insert({
      company_id: params.companyId,
      name: params.name,
      description: params.description || '',
      icon: params.icon || 'shield',
      sort_order: nextOrder,
    })
    .select()
    .single();

  if (error) throw error;
  return data;
}

/** 권한 그룹 수정 */
export async function updatePermissionGroup(
  groupId: string,
  updates: { name?: string; description?: string; icon?: string },
): Promise<void> {
  const { error } = await db
    .from('permission_groups')
    .update({ ...updates, updated_at: new Date().toISOString() })
    .eq('id', groupId);

  if (error) throw error;
}

/** 권한 그룹 삭제 (시스템 그룹 불가) */
export async function deletePermissionGroup(groupId: string): Promise<void> {
  const { error } = await db
    .from('permission_groups')
    .delete()
    .eq('id', groupId)
    .eq('is_system', false);

  if (error) throw error;
}

/** 그룹에 권한 설정 (기존 전체 교체) */
export async function setGroupPermissions(
  groupId: string,
  permissionIds: string[],
): Promise<void> {
  // 기존 권한 삭제
  await db
    .from('permission_group_permissions')
    .delete()
    .eq('group_id', groupId);

  // 새 권한 추가
  if (permissionIds.length > 0) {
    const rows = permissionIds.map((pid) => ({
      group_id: groupId,
      permission_id: pid,
    }));

    const { error } = await db
      .from('permission_group_permissions')
      .insert(rows);

    if (error) throw error;
  }
}

/** 그룹에 구성원 추가 */
export async function addGroupMember(
  groupId: string,
  userId: string,
  companyId: string,
): Promise<void> {
  const { error } = await db
    .from('permission_group_members')
    .upsert({
      group_id: groupId,
      user_id: userId,
      company_id: companyId,
    }, { onConflict: 'group_id,user_id' });

  if (error) throw error;
}

/** 그룹에서 구성원 제거 */
export async function removeGroupMember(
  groupId: string,
  userId: string,
): Promise<void> {
  const { error } = await db
    .from('permission_group_members')
    .delete()
    .eq('group_id', groupId)
    .eq('user_id', userId);

  if (error) throw error;
}

/** 회사 초기 셋업: 시스템 기본 그룹 3개 생성 */
export async function initializeCompanyPermissions(companyId: string, ownerId: string): Promise<void> {
  // 이미 그룹이 있으면 스킵
  const { data: existing } = await db
    .from('permission_groups')
    .select('id')
    .eq('company_id', companyId)
    .limit(1);

  if (existing && existing.length > 0) return;

  // 전체 권한 ID 조회
  const { data: allPerms } = await db
    .from('permission_definitions')
    .select('id, module, action');

  const allPermIds = (allPerms || []).map((p: { id: string }) => p.id);
  const viewPermIds = (allPerms || [])
    .filter((p: { action: string }) => p.action === 'view')
    .map((p: { id: string }) => p.id);

  // 1. 최고 관리자 (모든 권한)
  const { data: superAdmin } = await db
    .from('permission_groups')
    .insert({
      company_id: companyId,
      name: SYSTEM_GROUPS.SUPER_ADMIN,
      description: '모든 권한을 보유한 구성원을 지정할 수 있어요.',
      icon: 'crown',
      is_system: true,
      sort_order: 1,
    })
    .select()
    .single();

  // 2. 조직장
  const { data: teamLead } = await db
    .from('permission_groups')
    .insert({
      company_id: companyId,
      name: SYSTEM_GROUPS.TEAM_LEAD,
      description: '조직장에게만 적용되는 권한을 설정할 수 있어요.',
      icon: 'flag',
      is_system: true,
      sort_order: 2,
    })
    .select()
    .single();

  // 3. 기본 권한 (조회만)
  const { data: defaultGroup } = await db
    .from('permission_groups')
    .insert({
      company_id: companyId,
      name: SYSTEM_GROUPS.DEFAULT,
      description: '모든 구성원이 공통으로 가지는 권한이에요.',
      icon: 'users',
      is_system: true,
      sort_order: 3,
    })
    .select()
    .single();

  // 권한 매핑
  if (superAdmin && allPermIds.length > 0) {
    await db.from('permission_group_permissions').insert(
      allPermIds.map((pid: string) => ({ group_id: superAdmin.id, permission_id: pid })),
    );
  }

  if (defaultGroup && viewPermIds.length > 0) {
    await db.from('permission_group_permissions').insert(
      viewPermIds.map((pid: string) => ({ group_id: defaultGroup.id, permission_id: pid })),
    );
  }

  // owner를 최고 관리자 + 기본 권한에 추가
  if (superAdmin) {
    await addGroupMember(superAdmin.id, ownerId, companyId);
  }
  if (defaultGroup) {
    await addGroupMember(defaultGroup.id, ownerId, companyId);
  }
  if (teamLead) {
    await addGroupMember(teamLead.id, ownerId, companyId);
  }
}

/** 구성원별 권한 그룹 목록 조회 */
export async function getMemberPermissionGroups(
  userId: string,
  companyId: string,
): Promise<PermissionGroup[]> {
  const { data, error } = await db
    .from('permission_group_members')
    .select('group_id, permission_groups(*)')
    .eq('user_id', userId)
    .eq('company_id', companyId);

  if (error) throw error;
  return (data || []).map(
    (m: { permission_groups: PermissionGroup }) => m.permission_groups,
  );
}

/** 회사 전체 구성원 + 권한 그룹 조회 (구성원 권한 탭용) */
export async function getCompanyMembersWithPermissions(companyId: string): Promise<
  Array<{
    user: { id: string; name: string; email: string; role: string; avatar_url?: string; department?: string };
    groups: PermissionGroup[];
    isSuperAdmin: boolean;
  }>
> {
  // 회사 구성원 조회
  const { data: users, error } = await db
    .from('users')
    .select('id, name, email, role, avatar_url')
    .eq('company_id', companyId)
    .order('name');

  if (error) throw error;
  if (!users || users.length === 0) return [];

  // 직원 정보 (부서)
  const { data: employees } = await db
    .from('employees')
    .select('user_id, department')
    .eq('company_id', companyId);

  const deptMap: Record<string, string> = {};
  (employees || []).forEach((e: { user_id: string; department: string }) => {
    if (e.user_id) deptMap[e.user_id] = e.department;
  });

  // 전체 멤버십 조회
  const { data: memberships } = await db
    .from('permission_group_members')
    .select('user_id, group_id, permission_groups(id, name, icon, is_system, sort_order)')
    .eq('company_id', companyId);

  const userGroupMap: Record<string, PermissionGroup[]> = {};
  const superAdminSet = new Set<string>();

  (memberships || []).forEach((m: { user_id: string; permission_groups: PermissionGroup }) => {
    if (!userGroupMap[m.user_id]) userGroupMap[m.user_id] = [];
    if (m.permission_groups) {
      userGroupMap[m.user_id].push(m.permission_groups);
      if (m.permission_groups.name === SYSTEM_GROUPS.SUPER_ADMIN) {
        superAdminSet.add(m.user_id);
      }
    }
  });

  return users.map((u: { id: string; name: string; email: string; role: string; avatar_url?: string }) => ({
    user: { ...u, department: deptMap[u.id] || '' },
    groups: (userGroupMap[u.id] || []).sort((a: PermissionGroup, b: PermissionGroup) => a.sort_order - b.sort_order),
    isSuperAdmin: superAdminSet.has(u.id),
  }));
}
