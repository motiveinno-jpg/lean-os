"use client";

// ── 마스터 권한 부여 트리 (2026-07-30 개편 P1) ──
//   마스터가 구성원에게 전 메뉴·세부탭 권한을 체크박스로 부여. 저장은 set_member_permissions RPC(전체 교체).
//   P1 단계에서는 저장만 되고 화면 게이트는 P2(사이드바 단일화)부터 이 권한을 소비한다.
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { PermissionTree, useAllPermissionKeys } from "./PermissionTree";
import { PermissionTemplateModal } from "./PermissionTemplateModal";

export function PermissionSection({ targetUserId, empName, viewerIsMaster = true }: { targetUserId: string | null; empName: string; viewerIsMaster?: boolean }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [dirty, setDirty] = useState(false);

  const { data: saved, isLoading } = useQuery({
    queryKey: ["member-permissions", targetUserId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("member_permissions").select("perm_key").eq("user_id", targetUserId!);
      return new Set<string>((data || []).map((r: any) => r.perm_key));
    },
    enabled: !!targetUserId,
  });
  useEffect(() => { if (saved && !dirty) setChecked(new Set(saved)); }, [saved, dirty]);

  // 권한 템플릿 (2026-07-30 사장님) — 팀별 세트 저장·즉시 적용.
  //   만들기·수정·삭제는 별도 팝업(PermissionTemplateModal)에서 한다 (2026-08-06 사장님 요청).
  const [showTemplateModal, setShowTemplateModal] = useState(false);
  const { data: templates = [] } = useQuery({
    queryKey: ["permission-templates"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("permission_templates").select("id, name, perm_keys").order("name");
      return data || [];
    },
  });

  const applyTemplate = async (tpl: { name: string; perm_keys: string[] }) => {
    // 체크 상태 교체 + 즉시 저장(서버 RPC — 위임 권한 보호 규칙 동일 적용)
    setChecked(new Set(tpl.perm_keys || []));
    setDirty(true);
    try {
      const { data, error } = await (supabase as any).rpc("set_member_permissions", {
        p_user_id: targetUserId, p_perm_keys: tpl.perm_keys || [],
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "적용 실패");
      setDirty(false);
      toast(`"${tpl.name}" 템플릿이 ${empName}님에게 적용되었습니다`, "success");
      qc.invalidateQueries({ queryKey: ["member-permissions", targetUserId] });
    } catch (e: any) {
      toast(friendlyError(e, "템플릿 적용 실패"), "error");
    }
  };

  const { data: targetIsMaster = false } = useQuery({
    queryKey: ["target-is-master", targetUserId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("users").select("is_master").eq("id", targetUserId!).maybeSingle();
      return !!data?.is_master;
    },
    enabled: !!targetUserId,
  });

  const saveMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await (supabase as any).rpc("set_member_permissions", {
        p_user_id: targetUserId, p_perm_keys: Array.from(checked),
      });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "저장 실패");
      return data;
    },
    onSuccess: () => {
      toast(`${empName}님의 권한이 저장되었습니다`, "success");
      setDirty(false);
      qc.invalidateQueries({ queryKey: ["member-permissions", targetUserId] });
    },
    onError: (e: any) => toast(friendlyError(e, "권한 저장 실패"), "error"),
  });

  const allKeys = useAllPermissionKeys();

  const toggle = (keys: string[], on: boolean) => {
    setChecked((cur) => {
      const next = new Set(cur);
      for (const k of keys) { if (on) next.add(k); else next.delete(k); }
      return next;
    });
    setDirty(true);
  };

  if (!targetUserId) {
    return <div className="text-xs text-[var(--text-dim)] py-4">아직 계정에 연결되지 않은 구성원입니다 — 초대 수락 후 권한을 부여할 수 있습니다.</div>;
  }
  if (targetIsMaster) {
    return <div className="text-xs text-[var(--text-muted)] py-4">이 구성원은 <b>마스터</b>입니다 — 모든 메뉴·기능 권한을 항상 보유합니다.</div>;
  }
  if (isLoading) return <div className="text-xs text-[var(--text-dim)] py-4">권한 불러오는 중...</div>;

  return (
    <div className="member-permission-tree">
      <div className="flex items-center justify-between flex-wrap gap-2 mb-3">
        <div>
          <div className="text-sm font-bold text-[var(--text)]">메뉴·기능 권한</div>
          <div className="text-[11px] text-[var(--text-muted)] mt-0.5">체크된 메뉴와 세부 기능만 {empName}님에게 표시·허용됩니다. (마이페이지·알림·게시판 등 개인 영역은 기본 제공)</div>
        </div>
        <div className="flex gap-2 flex-wrap items-center">
          {/* 템플릿이 없어도 자리를 지킨다 — 비활성으로 두어 버튼 배치가 흔들리지 않게 (2026-08-06 사장님) */}
          <select
            className="perm-apply-select"
            value=""
            disabled={templates.length === 0}
            title={templates.length === 0 ? "만들어 둔 템플릿이 없습니다 — 템플릿 관리에서 먼저 만드세요" : undefined}
            onChange={(e) => {
              const tpl = (templates as any[]).find((t) => t.id === e.target.value);
              if (tpl) applyTemplate(tpl);
            }}
          >
            <option value="">{templates.length === 0 ? "템플릿 없음" : "템플릿 적용..."}</option>
            {(templates as any[]).map((t) => <option key={t.id} value={t.id}>{t.name} ({(t.perm_keys || []).length})</option>)}
          </select>
          <button onClick={() => setShowTemplateModal(true)} className="btn-secondary btn-sm">템플릿 관리</button>
          <button onClick={() => toggle(allKeys, true)} className="btn-secondary btn-sm">전체 선택</button>
          <button onClick={() => toggle(allKeys, false)} className="btn-secondary btn-sm">전체 해제</button>
          <button onClick={() => saveMut.mutate()} disabled={!dirty || saveMut.isPending} className="btn-primary btn-sm disabled:opacity-40">
            {saveMut.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
      <PermissionTree checked={checked} onToggle={toggle} viewerIsMaster={viewerIsMaster} />
      {dirty && <div className="text-[11px] text-[var(--warning)] mt-2">변경사항이 있습니다 — 저장을 눌러야 반영됩니다.</div>}

      <PermissionTemplateModal
        open={showTemplateModal}
        onClose={() => setShowTemplateModal(false)}
        viewerIsMaster={viewerIsMaster}
        currentChecked={checked}
        currentEmpName={empName}
      />
    </div>
  );
}
