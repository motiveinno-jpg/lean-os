"use client";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";

import {
  getPermissionGroups,
  getPermissionGroupDetail,
  getAllPermissionDefinitions,
  getCompanyMembersWithPermissions,
  createPermissionGroup,
  updatePermissionGroup,
  deletePermissionGroup,
  setGroupPermissions,
  addGroupMember,
  removeGroupMember,
  initializeCompanyPermissions,
  MODULE_LABELS,
  SYSTEM_GROUPS,
  type PermissionGroup,
  type PermissionDefinition,
} from "@/lib/permissions";

export function PermissionsTab({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const { user } = useUser();
  const [subTab, setSubTab] = useState<"groups" | "members">("groups");
  const [selectedGroupId, setSelectedGroupId] = useState<string | null>(null);
  const [showNewGroupForm, setShowNewGroupForm] = useState(false);
  const [newGroupName, setNewGroupName] = useState("");
  const [newGroupDesc, setNewGroupDesc] = useState("");
  const [initialized, setInitialized] = useState(false);

  // 초기 셋업
  useEffect(() => {
    if (companyId && user?.id && !initialized) {
      initializeCompanyPermissions(companyId, user.id).then(() => {
        setInitialized(true);
      });
    }
  }, [companyId, user?.id, initialized]);

  // 권한 그룹 목록
  const { data: groups = [], refetch: refetchGroups } = useQuery({
    queryKey: ["permission-groups", companyId, initialized],
    queryFn: () => getPermissionGroups(companyId),
    enabled: !!companyId && initialized,
  });

  // 선택된 그룹 상세
  const { data: groupDetail, refetch: refetchDetail } = useQuery({
    queryKey: ["permission-group-detail", selectedGroupId],
    queryFn: () => getPermissionGroupDetail(selectedGroupId!),
    enabled: !!selectedGroupId,
  });

  // 전체 권한 정의
  const { data: permDefs = {} } = useQuery({
    queryKey: ["permission-definitions"],
    queryFn: () => getAllPermissionDefinitions(),
  });

  // 구성원별 권한
  const { data: membersWithPerms = [], refetch: refetchMembers } = useQuery({
    queryKey: ["members-permissions", companyId, initialized],
    queryFn: () => getCompanyMembersWithPermissions(companyId),
    enabled: !!companyId && initialized,
  });

  // 회사 유저 (멤버 추가용)
  const { data: companyUsers = [] } = useQuery({
    queryKey: ["company-users", companyId],
    queryFn: async () => {
      const { data } = await (supabase as ReturnType<typeof import("@supabase/supabase-js").createClient>)
        .from("users")
        .select("id, name, email, role, avatar_url")
        .eq("company_id", companyId)
        .order("name");
      return data || [];
    },
    enabled: !!companyId,
  });

  const handleCreateGroup = async () => {
    if (!newGroupName.trim()) return;
    try {
      await createPermissionGroup({
        companyId,
        name: newGroupName.trim(),
        description: newGroupDesc.trim(),
      });
      toast("권한 그룹이 생성되었습니다", "success");
      setNewGroupName("");
      setNewGroupDesc("");
      setShowNewGroupForm(false);
      refetchGroups();
    } catch (err) {
      toast(`생성 실패: ${(err as Error).message}`, "error");
    }
  };

  const handleDeleteGroup = async (groupId: string) => {
    if (!confirm("이 권한 그룹을 삭제하시겠습니까?")) return;
    try {
      await deletePermissionGroup(groupId);
      toast("권한 그룹이 삭제되었습니다", "success");
      if (selectedGroupId === groupId) setSelectedGroupId(null);
      refetchGroups();
    } catch (err) {
      toast(`삭제 실패: ${(err as Error).message}`, "error");
    }
  };

  const handleTogglePermission = async (permId: string) => {
    if (!groupDetail) return;
    const currentIds = (groupDetail.permissions || []).map((p) => p.id);
    const newIds = currentIds.includes(permId)
      ? currentIds.filter((id) => id !== permId)
      : [...currentIds, permId];
    try {
      await setGroupPermissions(groupDetail.id, newIds);
      refetchDetail();
    } catch (err) {
      toast(`권한 변경 실패: ${(err as Error).message}`, "error");
    }
  };

  const handleAddMember = async (userId: string) => {
    if (!selectedGroupId) return;
    try {
      await addGroupMember(selectedGroupId, userId, companyId);
      refetchDetail();
      refetchMembers();
      toast("구성원이 추가되었습니다", "success");
    } catch (err) {
      toast(`추가 실패: ${(err as Error).message}`, "error");
    }
  };

  const handleRemoveMember = async (userId: string) => {
    if (!selectedGroupId) return;
    try {
      await removeGroupMember(selectedGroupId, userId);
      refetchDetail();
      refetchMembers();
      toast("구성원이 제거되었습니다", "success");
    } catch (err) {
      toast(`제거 실패: ${(err as Error).message}`, "error");
    }
  };

  const groupIcon = (icon: string, name: string) => {
    if (name === SYSTEM_GROUPS.SUPER_ADMIN) return <span className="text-lg">👑</span>;
    if (name === SYSTEM_GROUPS.TEAM_LEAD) return <span className="text-lg">🚩</span>;
    if (name === SYSTEM_GROUPS.DEFAULT) return <span className="text-lg">👥</span>;
    return <span className="text-lg">🛡️</span>;
  };

  const getInitials = (name: string) => {
    return name ? name.slice(0, 2) : "?";
  };

  return (
    <div className="space-y-6">
      <h2 className="text-xl font-bold">권한 설정</h2>

      {/* Sub tabs */}
      <div className="flex rounded-xl border border-[var(--border)] overflow-hidden">
        <button
          onClick={() => setSubTab("groups")}
          className={`flex-1 py-3 text-sm font-semibold transition min-h-[44px] ${
            subTab === "groups" ? "bg-[var(--bg-card)] text-[var(--text)]" : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
          }`}
        >
          권한 그룹
        </button>
        <button
          onClick={() => setSubTab("members")}
          className={`flex-1 py-3 text-sm font-semibold transition min-h-[44px] border-l border-[var(--border)] ${
            subTab === "members" ? "bg-[var(--bg-card)] text-[var(--text)]" : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
          }`}
        >
          구성원 권한
        </button>
      </div>

      {/* ── 권한 그룹 탭 ── */}
      {subTab === "groups" && !selectedGroupId && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="font-bold">권한 그룹</h3>
              <p className="text-xs text-[var(--text-muted)]">그룹별 권한을 설정하고 구성원을 추가해 보세요.</p>
            </div>
            <button
              onClick={() => setShowNewGroupForm(true)}
              className="px-4 py-2 text-sm font-semibold border border-[var(--border)] rounded-lg hover:bg-[var(--bg-surface)] transition min-h-[44px]"
            >
              + 권한 그룹 추가
            </button>
          </div>

          {/* New group form */}
          {showNewGroupForm && (
            <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--primary)] space-y-3">
              <input
                type="text"
                value={newGroupName}
                onChange={(e) => setNewGroupName(e.target.value)}
                placeholder="그룹 이름"
                className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm focus:ring-2 focus:ring-[var(--primary)] outline-none"
                autoFocus
              />
              <input
                type="text"
                value={newGroupDesc}
                onChange={(e) => setNewGroupDesc(e.target.value)}
                placeholder="설명 (선택)"
                className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm focus:ring-2 focus:ring-[var(--primary)] outline-none"
              />
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { setShowNewGroupForm(false); setNewGroupName(""); setNewGroupDesc(""); }}
                  className="px-4 py-2 text-sm text-[var(--text-muted)] hover:text-[var(--text)] transition min-h-[44px]"
                >
                  취소
                </button>
                <button
                  onClick={handleCreateGroup}
                  disabled={!newGroupName.trim()}
                  className="px-4 py-2 text-sm font-semibold bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] transition disabled:opacity-50 min-h-[44px]"
                >
                  생성
                </button>
              </div>
            </div>
          )}

          {/* Group list */}
          <div className="space-y-2">
            {groups.map((g: PermissionGroup & { member_count?: number }) => (
              <button
                key={g.id}
                onClick={() => setSelectedGroupId(g.id)}
                className="w-full bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)] hover:border-[var(--primary)]/50 transition text-left flex items-center justify-between group"
              >
                <div className="flex items-center gap-3">
                  {groupIcon(g.icon, g.name)}
                  <div>
                    <div className="font-semibold text-sm">{g.name}</div>
                    <div className="text-xs text-[var(--text-muted)]">{g.description}</div>
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {(g.member_count || 0) > 0 && (
                    <span className="text-xs text-[var(--text-muted)]">{g.member_count}명</span>
                  )}
                  {!g.is_system && (
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteGroup(g.id); }}
                      className="opacity-0 group-hover:opacity-100 text-xs text-red-400 hover:text-red-300 transition px-2 min-h-[44px]"
                    >
                      ···
                    </button>
                  )}
                  <span className="text-[var(--text-muted)]">›</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* ── 그룹 상세 (권한 편집 + 멤버 관리) ── */}
      {subTab === "groups" && selectedGroupId && groupDetail && (
        <div className="space-y-6">
          <button
            onClick={() => setSelectedGroupId(null)}
            className="text-sm text-[var(--primary)] hover:underline min-h-[44px]"
          >
            ← 목록으로
          </button>

          <div className="flex items-center gap-3">
            {groupIcon(groupDetail.icon, groupDetail.name)}
            <div>
              <h3 className="text-lg font-bold">{groupDetail.name}</h3>
              <p className="text-xs text-[var(--text-muted)]">{groupDetail.description}</p>
            </div>
          </div>

          {/* 멤버 섹션 */}
          <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)] space-y-3">
            <h4 className="font-semibold text-sm">구성원 ({groupDetail.members?.length || 0}명)</h4>
            <div className="space-y-2">
              {(groupDetail.members || []).map((m) => (
                <div key={m.user_id} className="flex items-center justify-between py-2">
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-xs font-bold text-[var(--primary)]">
                      {getInitials(m.user?.name || "")}
                    </div>
                    <div>
                      <div className="text-sm font-medium">{m.user?.name || m.user?.email}</div>
                      <div className="text-[10px] text-[var(--text-muted)]">{m.user?.email}</div>
                    </div>
                  </div>
                  <button
                    onClick={() => handleRemoveMember(m.user_id)}
                    className="text-xs text-red-400 hover:text-red-300 transition px-2 min-h-[44px]"
                  >
                    제거
                  </button>
                </div>
              ))}
            </div>

            {/* 멤버 추가 */}
            <div className="pt-2 border-t border-[var(--border)]">
              <select
                onChange={(e) => { if (e.target.value) handleAddMember(e.target.value); e.target.value = ""; }}
                className="w-full px-4 py-3 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm outline-none"
                defaultValue=""
              >
                <option value="" disabled>+ 구성원 추가...</option>
                {companyUsers
                  .filter((u: { id: string }) => !(groupDetail.members || []).some((m) => m.user_id === u.id))
                  .map((u: { id: string; name: string; email: string }) => (
                    <option key={u.id} value={u.id}>{u.name || u.email}</option>
                  ))}
              </select>
            </div>
          </div>

          {/* 권한 편집 섹션 */}
          <div className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)] space-y-4">
            <h4 className="font-semibold text-sm">모듈별 권한</h4>
            {Object.entries(permDefs).map(([module, perms]) => {
              const activePermIds = new Set((groupDetail.permissions || []).map((p) => p.id));
              const allChecked = (perms as PermissionDefinition[]).every((p) => activePermIds.has(p.id));
              return (
                <div key={module} className="space-y-2">
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-semibold">{MODULE_LABELS[module] || module}</span>
                    <button
                      onClick={async () => {
                        const currentIds = (groupDetail.permissions || []).map((p) => p.id);
                        const modulePermIds = (perms as PermissionDefinition[]).map((p) => p.id);
                        let newIds: string[];
                        if (allChecked) {
                          newIds = currentIds.filter((id) => !modulePermIds.includes(id));
                        } else {
                          newIds = [...new Set([...currentIds, ...modulePermIds])];
                        }
                        await setGroupPermissions(groupDetail.id, newIds);
                        refetchDetail();
                      }}
                      className="text-[10px] text-[var(--primary)] hover:underline"
                    >
                      {allChecked ? "전체 해제" : "전체 선택"}
                    </button>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {(perms as PermissionDefinition[]).map((p) => {
                      const isActive = activePermIds.has(p.id);
                      return (
                        <button
                          key={p.id}
                          onClick={() => handleTogglePermission(p.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-medium transition min-h-[44px] ${
                            isActive
                              ? "bg-[var(--primary)] text-white"
                              : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
                          }`}
                        >
                          {p.label}
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── 구성원 권한 탭 ── */}
      {subTab === "members" && (
        <div className="space-y-4">
          <div>
            <h3 className="font-bold">구성원 권한</h3>
            <p className="text-xs text-[var(--text-muted)]">각 구성원이 속한 권한 그룹을 확인하세요.</p>
          </div>

          <div className="space-y-2">
            {membersWithPerms.map((m) => (
              <div
                key={m.user.id}
                className="bg-[var(--bg-card)] rounded-xl p-4 border border-[var(--border)] flex items-center justify-between gap-3"
              >
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-full bg-[var(--primary)]/20 flex items-center justify-center text-sm font-bold text-[var(--primary)]">
                    {getInitials(m.user.name || "")}
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm">{m.user.name || m.user.email}</span>
                      {m.isSuperAdmin && <span className="text-xs">👑</span>}
                    </div>
                    {m.user.department && (
                      <span className="text-xs text-[var(--text-muted)]">{m.user.department}</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                  {m.groups.map((g) => (
                    <span
                      key={g.id}
                      className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${
                        g.name === SYSTEM_GROUPS.SUPER_ADMIN
                          ? "bg-yellow-500/10 text-yellow-400"
                          : g.name === SYSTEM_GROUPS.TEAM_LEAD
                            ? "bg-purple-500/10 text-purple-400"
                            : g.name === SYSTEM_GROUPS.DEFAULT
                              ? "bg-gray-500/10 text-gray-400"
                              : "bg-blue-500/10 text-blue-400"
                      }`}
                    >
                      {g.name === SYSTEM_GROUPS.SUPER_ADMIN ? "👑 " : g.name === SYSTEM_GROUPS.TEAM_LEAD ? "🚩 " : "👥 "}
                      {g.name}
                    </span>
                  ))}
                  {m.groups.length === 0 && (
                    <span className="text-xs text-[var(--text-muted)]">그룹 없음</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
