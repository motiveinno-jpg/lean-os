"use client";

// ── 마스터 권한 부여 트리 (2026-07-30 개편 P1) ──
//   마스터가 구성원에게 전 메뉴·세부탭 권한을 체크박스로 부여. 저장은 set_member_permissions RPC(전체 교체).
//   P1 단계에서는 저장만 되고 화면 게이트는 P2(사이드바 단일화)부터 이 권한을 소비한다.
import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { PERMISSION_CATALOG } from "@/lib/permissions";

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

  // 권한 템플릿 (2026-07-30 사장님) — 팀별 세트 저장·즉시 적용
  const [templateNameInput, setTemplateNameInput] = useState("");
  const [showTemplateSave, setShowTemplateSave] = useState(false);
  const { data: templates = [] } = useQuery({
    queryKey: ["permission-templates"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("permission_templates").select("id, name, perm_keys").order("name");
      return data || [];
    },
  });
  const saveTemplateMut = useMutation({
    mutationFn: async (name: string) => {
      const { data: me } = await (supabase as any).auth.getUser();
      const { error } = await (supabase as any).from("permission_templates")
        .upsert({
          company_id: (await (supabase as any).rpc("get_my_company_id")).data,
          name,
          perm_keys: Array.from(checked),
          updated_at: new Date().toISOString(),
        }, { onConflict: "company_id,name" });
      if (error) throw error;
      void me;
    },
    onSuccess: (_d, name) => {
      toast(`템플릿 "${name}" 저장됨 — 다른 구성원에게 바로 적용할 수 있습니다`, "success");
      setShowTemplateSave(false); setTemplateNameInput("");
      qc.invalidateQueries({ queryKey: ["permission-templates"] });
    },
    onError: (e: any) => toast(friendlyError(e, "템플릿 저장 실패"), "error"),
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

  const allKeys = useMemo(() => {
    const keys: string[] = [];
    for (const g of PERMISSION_CATALOG) for (const m of g.menus) {
      if (!m.always) keys.push(m.route);
      for (const t of m.tabs || []) keys.push(`${m.route}:${t.key}`); // always 메뉴의 세부탭도 부여 대상
    }
    return keys;
  }, []);

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
          {templates.length > 0 && (
            <select
              className="h-8 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs"
              value=""
              onChange={(e) => {
                const tpl = (templates as any[]).find((t) => t.id === e.target.value);
                if (tpl) applyTemplate(tpl);
              }}
            >
              <option value="">템플릿 적용...</option>
              {(templates as any[]).map((t) => <option key={t.id} value={t.id}>{t.name} ({(t.perm_keys || []).length})</option>)}
            </select>
          )}
          <button onClick={() => setShowTemplateSave((v) => !v)} className="btn-secondary btn-sm">템플릿 만들기</button>
          <button onClick={() => toggle(allKeys, true)} className="btn-secondary btn-sm">전체 선택</button>
          <button onClick={() => toggle(allKeys, false)} className="btn-secondary btn-sm">전체 해제</button>
          <button onClick={() => saveMut.mutate()} disabled={!dirty || saveMut.isPending} className="btn-primary btn-sm disabled:opacity-40">
            {saveMut.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>
      {showTemplateSave && (
        <div className="flex items-center gap-2 mb-3 p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
          <span className="text-xs text-[var(--text-muted)] shrink-0">현재 체크된 권한 {checked.size}개를 템플릿으로 저장:</span>
          <input
            value={templateNameInput}
            onChange={(e) => setTemplateNameInput(e.target.value)}
            placeholder="예: 마케팅팀, 회계팀"
            className="flex-1 h-8 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs"
            onKeyDown={(e) => { if (e.key === "Enter" && templateNameInput.trim()) saveTemplateMut.mutate(templateNameInput.trim()); }}
          />
          <button onClick={() => templateNameInput.trim() && saveTemplateMut.mutate(templateNameInput.trim())}
            disabled={!templateNameInput.trim() || saveTemplateMut.isPending} className="btn-primary btn-sm disabled:opacity-40">
            {saveTemplateMut.isPending ? "저장 중..." : "저장"}
          </button>
          <span className="text-[10px] text-[var(--text-dim)]">같은 이름이면 덮어씁니다</span>
        </div>
      )}

      <div className="member-permission-groups">
        {PERMISSION_CATALOG.map((g) => {
          const groupKeys = g.menus.flatMap((m) => [...(m.always ? [] : [m.route]), ...(m.tabs || []).map((t) => `${m.route}:${t.key}`)]);
          if (groupKeys.length === 0) return null;
          const groupAll = groupKeys.every((k) => checked.has(k));
          return (
            <div key={g.group} className="member-permission-group glass-card">
              <label className="flex items-center gap-2 mb-2 cursor-pointer">
                <input type="checkbox" checked={groupAll} onChange={(e) => toggle(groupKeys, e.target.checked)} className="accent-[var(--primary)]" />
                <span className="text-xs font-bold text-[var(--text)]">{g.group}</span>
              </label>
              <div className="space-y-2">
                {g.menus.filter((m) => !m.always || (m.tabs || []).length > 0).map((m) => {
                  const menuKeys = [...(m.always ? [] : [m.route]), ...(m.tabs || []).map((t) => `${m.route}:${t.key}`)];
                  const menuOn = m.always ? true : checked.has(m.route); // 기본 제공 메뉴는 항상 열림 — 세부탭만 부여
                  return (
                    <div key={m.route} className="member-permission-menu">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input type="checkbox" checked={menuOn} disabled={!!m.always}
                          onChange={(e) => toggle(menuKeys, e.target.checked)}
                          className="accent-[var(--primary)]" />
                        <span className="text-xs font-semibold text-[var(--text)]">{m.label}</span>
                        {m.always && <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-[var(--success-dim)] text-[var(--success)]">기본 제공</span>}
                        <span className="text-[10px] text-[var(--text-dim)] mono-number">{m.route}</span>
                      </label>
                      {(m.tabs || []).length > 0 && (
                        <div className="member-permission-tabs">
                          {(m.tabs || []).map((t) => {
                            const k = `${m.route}:${t.key}`;
                            // 위임 권한 자체는 마스터만 조작(서버에서도 강제) — 위임받은 부여자는 비활성 표시
                            const masterOnlyKey = k === "/employees:permissions" && !viewerIsMaster;
                            return (
                              <label key={k} className={`flex items-center gap-1.5 cursor-pointer ${!menuOn || masterOnlyKey ? "opacity-50" : ""}`} title={masterOnlyKey ? "이 권한은 마스터만 부여/회수할 수 있습니다" : undefined}>
                                <input type="checkbox" checked={checked.has(k)} disabled={!menuOn || masterOnlyKey}
                                  onChange={(e) => toggle([k], e.target.checked)} className="accent-[var(--primary)]" />
                                <span className="text-[11px] text-[var(--text-muted)]">{t.label}</span>
                              </label>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {dirty && <div className="text-[11px] text-[var(--warning)] mt-2">변경사항이 있습니다 — 저장을 눌러야 반영됩니다.</div>}
    </div>
  );
}
