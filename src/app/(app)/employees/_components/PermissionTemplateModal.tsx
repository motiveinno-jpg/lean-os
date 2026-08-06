"use client";

// 권한 템플릿 관리 팝업 (2026-08-06 사장님: "템플릿 신규생성 및 편집이 너무 복잡함 — 별도 팝업창으로").
//   예전에는 구성원 권한 화면에 인라인 패널이 열리고, 템플릿 내용이 "지금 화면에 체크된 권한"에
//   묶여 있어 템플릿 하나 고치려면 구성원 체크박스를 먼저 맞춰야 했다.
//   이제 팝업 안에서 왼쪽 목록으로 템플릿을 고르고, 그 템플릿의 권한을 직접 체크해 저장한다.
import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { friendlyError } from "@/lib/friendly-error";
import { PermissionTree, useAllPermissionKeys } from "./PermissionTree";

type Template = { id: string; name: string; perm_keys: string[] };
type Draft = { id: string | null; name: string; keys: Set<string> };

export function PermissionTemplateModal({ open, onClose, viewerIsMaster = true, currentChecked, currentEmpName }: {
  open: boolean;
  onClose: () => void;
  viewerIsMaster?: boolean;
  /** 지금 보고 있는 구성원의 체크 상태 — "이 구성원 권한 그대로 가져오기"에만 쓴다 */
  currentChecked?: Set<string>;
  currentEmpName?: string;
}) {
  const { toast } = useToast();
  const { confirm: confirmDialog, confirmElement } = useConfirm();
  const qc = useQueryClient();
  const allKeys = useAllPermissionKeys();
  const [draft, setDraft] = useState<Draft | null>(null);

  const { data: templates = [], isLoading } = useQuery({
    queryKey: ["permission-templates"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("permission_templates").select("id, name, perm_keys").order("name");
      return (data || []) as Template[];
    },
    enabled: open,
  });

  // 팝업을 닫으면 편집 중이던 내용은 버린다 — 다음에 열 때 목록부터 다시 시작.
  useEffect(() => { if (!open) setDraft(null); }, [open]);

  const saveMut = useMutation({
    mutationFn: async (d: Draft) => {
      const name = d.name.trim();
      const perm_keys = Array.from(d.keys);
      if (d.id) {
        const { error } = await (supabase as any).from("permission_templates")
          .update({ name, perm_keys, updated_at: new Date().toISOString() }).eq("id", d.id);
        if (error) throw error;
        return name;
      }
      // 새 템플릿 — upsert 대신 insert. (upsert 는 INSERT 경로에도 SELECT 정책을 태워 실패할 수 있다)
      const { data: companyId } = await (supabase as any).rpc("get_my_company_id");
      const { error } = await (supabase as any).from("permission_templates")
        .insert({ company_id: companyId, name, perm_keys });
      if (error) throw error;
      return name;
    },
    onSuccess: (name) => {
      toast(`템플릿 "${name}"을(를) 저장했습니다`, "success");
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["permission-templates"] });
    },
    onError: (e: any) => {
      if (e?.code === "23505") { toast("같은 이름의 템플릿이 이미 있습니다 — 다른 이름을 쓰세요", "error"); return; }
      toast(friendlyError(e, "템플릿 저장 실패"), "error");
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (t: Template) => {
      const { error } = await (supabase as any).from("permission_templates").delete().eq("id", t.id);
      if (error) throw error;
      return t.name;
    },
    onSuccess: (name) => {
      toast(`"${name}" 템플릿을 삭제했습니다 — 이미 적용된 구성원 권한은 그대로 유지됩니다`, "success");
      setDraft(null);
      qc.invalidateQueries({ queryKey: ["permission-templates"] });
    },
    onError: (e: any) => toast(friendlyError(e, "템플릿 삭제 실패"), "error"),
  });

  if (!open) return null;

  const toggle = (keys: string[], on: boolean) => {
    setDraft((d) => {
      if (!d) return d;
      const next = new Set(d.keys);
      for (const k of keys) { if (on) next.add(k); else next.delete(k); }
      return { ...d, keys: next };
    });
  };

  return (
    <div className="perm-template-modal" onClick={onClose}>
      <div className="modal-backdrop" />
      <div className="perm-template-panel modal-panel" onClick={(e) => e.stopPropagation()}>
        <div className="perm-template-head">
          <div>
            <h3 className="text-sm font-bold text-[var(--text)]">템플릿 관리</h3>
            <p className="text-[11px] text-[var(--text-dim)] mt-0.5">자주 쓰는 권한 묶음을 만들어 두면 구성원에게 한 번에 적용할 수 있습니다.</p>
          </div>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)] transition" aria-label="닫기">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12"/></svg>
          </button>
        </div>

        <div className="perm-template-body">
          {/* 왼쪽 — 템플릿 목록 + 추가 */}
          <div className="perm-template-list">
            <button
              onClick={() => setDraft({ id: null, name: "", keys: new Set() })}
              className={`perm-template-add ${draft && !draft.id ? "perm-template-item-active" : ""}`}
            >
              + 템플릿 추가
            </button>
            {isLoading ? (
              <div className="text-[11px] text-[var(--text-dim)] px-2 py-3">불러오는 중…</div>
            ) : templates.length === 0 ? (
              <div className="text-[11px] text-[var(--text-dim)] px-2 py-3">아직 만든 템플릿이 없습니다</div>
            ) : (
              templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setDraft({ id: t.id, name: t.name, keys: new Set(t.perm_keys || []) })}
                  className={`perm-template-item ${draft?.id === t.id ? "perm-template-item-active" : ""}`}
                >
                  <span className="truncate">{t.name}</span>
                  <span className="text-[10px] text-[var(--text-dim)] shrink-0">{(t.perm_keys || []).length}개</span>
                </button>
              ))
            )}
          </div>

          {/* 오른쪽 — 선택한 템플릿 편집 */}
          <div className="perm-template-editor">
            {!draft ? (
              <div className="perm-template-empty">
                왼쪽에서 템플릿을 고르면 여기서 수정할 수 있습니다.<br />
                <span className="text-[var(--text-dim)]">새로 만들려면 <b>+ 템플릿 추가</b>를 누르세요.</span>
              </div>
            ) : (
              <>
                <div className="perm-template-editor-head">
                  <input
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                    placeholder="템플릿 이름 (예: 마케팅팀, 회계팀)"
                    autoFocus={!draft.id}
                    className="perm-template-name-input"
                  />
                  <div className="perm-template-editor-actions">
                    <button onClick={() => toggle(allKeys, true)} className="btn-secondary btn-sm">전체 선택</button>
                    <button onClick={() => toggle(allKeys, false)} className="btn-secondary btn-sm">전체 해제</button>
                    {currentChecked && currentChecked.size > 0 && (
                      <button
                        onClick={() => setDraft({ ...draft, keys: new Set(currentChecked) })}
                        className="btn-secondary btn-sm"
                        title={`${currentEmpName || "지금 보고 있는 구성원"}님에게 체크된 권한을 그대로 가져옵니다`}
                      >
                        구성원 권한 가져오기
                      </button>
                    )}
                  </div>
                </div>
                <div className="perm-template-tree">
                  <PermissionTree checked={draft.keys} onToggle={toggle} viewerIsMaster={viewerIsMaster} />
                </div>
              </>
            )}
          </div>
        </div>

        {draft && (
          <div className="perm-template-foot">
            <div className="text-[11px] text-[var(--text-muted)]">
              선택된 권한 <b>{draft.keys.size}</b>개
              {draft.id && <span className="text-[var(--text-dim)]"> · 수정해도 이미 적용받은 구성원의 권한은 바뀌지 않습니다</span>}
            </div>
            <div className="flex gap-2">
              {draft.id && (
                <button
                  onClick={async () => {
                    const t = templates.find((x) => x.id === draft.id);
                    if (!t) return;
                    if (!(await confirmDialog({ title: `"${t.name}" 템플릿 삭제`, desc: "템플릿만 삭제됩니다 — 이미 적용된 구성원의 권한은 그대로 유지됩니다.", danger: true }))) return;
                    deleteMut.mutate(t);
                  }}
                  disabled={deleteMut.isPending}
                  className="btn-sm px-2.5 rounded-lg bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20 font-semibold disabled:opacity-40"
                >
                  삭제
                </button>
              )}
              <button onClick={() => setDraft(null)} className="btn-secondary btn-sm">취소</button>
              <button
                onClick={() => saveMut.mutate(draft)}
                disabled={!draft.name.trim() || saveMut.isPending}
                className="btn-primary btn-sm disabled:opacity-40"
              >
                {saveMut.isPending ? "저장 중..." : draft.id ? "수정 저장" : "만들기"}
              </button>
            </div>
          </div>
        )}
        {confirmElement}
      </div>
    </div>
  );
}
