"use client";

// 결재 양식 관리 + 빌더 (2026-07-01, 플렉스식) — approvals '양식 관리' 탭에서 사용.
//   양식 목록 + '새 양식 추가' → 빌더(이름·분류·설명·커스텀 필드·내용 템플릿·결재선 단계·옵션).
//   저장은 approval_forms. 새 요청에서 이 양식을 선택하면 필드/템플릿/결재선이 적용된다.

import { useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import {
  listApprovalForms, saveApprovalForm, deleteApprovalForm,
  FIELD_TYPE_LABEL, type ApprovalForm, type ApprovalFormField, type ApprovalFormStage, type ApprovalFieldType, type ApproverType,
} from "@/lib/approval-forms";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const uid = () => crypto.randomUUID();
const ROLE_OPTS: { v: string; l: string }[] = [
  { v: "manager", l: "팀장/매니저" }, { v: "admin", l: "관리자" }, { v: "owner", l: "대표/CEO" },
];
const roleLabel = (r?: string | null) => ROLE_OPTS.find((o) => o.v === r)?.l || r || "관리자";

const emptyField = (): ApprovalFormField => ({ key: uid().slice(0, 8), label: "", type: "text", required: false, options: [] });
const emptyStage = (n: number): ApprovalFormStage => ({ stage: n, name: `${n}차 승인`, approver_type: "role", approver_role: "manager", approver_user_ids: [], required_count: 1 });

export function ApprovalFormsManager({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [editing, setEditing] = useState<null | Partial<ApprovalForm>>(null);
  const [saving, setSaving] = useState(false);

  const { data: forms = [] } = useQuery({
    queryKey: ["approval-forms", companyId],
    queryFn: () => listApprovalForms(),
    enabled: !!companyId,
  });
  const { data: users = [] } = useQuery({
    queryKey: ["approval-forms-users", companyId],
    queryFn: async () => {
      const { data } = await db.from("users").select("id, name, email, role").eq("company_id", companyId).order("name");
      return (data || []) as { id: string; name: string | null; email: string | null; role: string }[];
    },
    enabled: !!companyId,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["approval-forms", companyId] });
  const userName = (id: string) => { const u = (users as any[]).find((x) => x.id === id); return u?.name || u?.email || "구성원"; };

  const openNew = () => setEditing({ name: "", category: "", description: "", fields: [], content_template: "", stages: [emptyStage(1)], allow_requester_edit: true, use_attachment: true });
  const openEdit = (f: ApprovalForm) => setEditing({ ...f });

  const save = async () => {
    if (!editing) return;
    if (!(editing.name || "").trim()) { toast("양식 이름을 입력하세요", "error"); return; }
    if (!(editing.stages || []).length) { toast("승인 단계를 1개 이상 추가하세요", "error"); return; }
    setSaving(true);
    try {
      await saveApprovalForm({
        id: editing.id, companyId,
        name: editing.name!.trim(), category: editing.category || null, description: editing.description || null,
        fields: (editing.fields || []).filter((f) => (f.label || "").trim()),
        contentTemplate: editing.content_template || null,
        stages: (editing.stages || []).map((s, i) => ({ ...s, stage: i + 1 })),
        allowRequesterEdit: editing.allow_requester_edit ?? true,
        useAttachment: editing.use_attachment ?? true,
      });
      toast(editing.id ? "양식을 수정했습니다" : "양식을 추가했습니다", "success");
      setEditing(null); refresh();
    } catch (e: any) { toast("저장 실패: " + (e?.message || ""), "error"); }
    finally { setSaving(false); }
  };

  const remove = async (f: ApprovalForm) => {
    if (!confirm(`'${f.name}' 양식을 삭제할까요?`)) return;
    try { await deleteApprovalForm(f.id); toast("삭제했습니다", "info"); refresh(); }
    catch (e: any) { toast("삭제 실패: " + (e?.message || ""), "error"); }
  };

  // ── 빌더 내부 편집 헬퍼 ──
  const patch = (p: Partial<ApprovalForm>) => setEditing((s) => s && ({ ...s, ...p }));
  const setField = (i: number, p: Partial<ApprovalFormField>) => patch({ fields: (editing!.fields || []).map((f, j) => (j === i ? { ...f, ...p } : f)) });
  const setStage = (i: number, p: Partial<ApprovalFormStage>) => patch({ stages: (editing!.stages || []).map((s, j) => (j === i ? { ...s, ...p } : s)) });

  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-5 gap-2 flex-wrap">
        <div>
          <h2 className="text-sm font-bold text-[var(--text)]">결재 양식 관리</h2>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">회사에서 쓰는 결재 양식(필드·내용·결재선)을 만들어 새 요청에서 선택합니다.</p>
        </div>
        <button onClick={openNew} className="btn-primary">+ 새 양식 추가</button>
      </div>

      {(forms as ApprovalForm[]).length === 0 ? (
        <div className="text-center py-14">
          <div className="mx-auto w-14 h-14 mb-3 rounded-2xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          </div>
          <div className="text-sm font-bold mb-1">등록된 결재 양식이 없습니다</div>
          <div className="text-xs text-[var(--text-muted)]">&ldquo;+ 새 양식 추가&rdquo;로 우리 회사만의 결재 양식을 만들어 보세요</div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {(forms as ApprovalForm[]).map((f) => (
            <div key={f.id} className="glass-card group p-4 hover:border-[var(--primary)]/40 hover:shadow-md transition">
              <div className="flex items-start gap-3">
                <span className="w-10 h-10 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={1.7} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <span className="text-sm font-bold text-[var(--text)] truncate">{f.name}</span>
                    {f.category && <span className="badge badge-primary">{f.category}</span>}
                  </div>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="badge badge-muted">입력 필드 {f.fields?.length || 0}</span>
                    <span className="badge badge-muted">결재 {f.stages?.length || 0}단계</span>
                  </div>
                </div>
                <div className="flex gap-1 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => openEdit(f)} className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--primary)] hover:bg-[var(--primary)]/10 transition" title="편집">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/></svg>
                  </button>
                  <button onClick={() => remove(f)} className="p-2 rounded-lg text-[var(--text-muted)] hover:text-[var(--danger)] hover:bg-[var(--danger-dim)] transition" title="삭제">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 빌더 모달 */}
      {editing && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="glass-card w-full max-w-2xl max-h-[90vh] overflow-y-auto p-5" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2.5 mb-4">
              <span className="w-8 h-8 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              </span>
              <div className="text-sm font-bold text-[var(--text)]">{editing.id ? "양식 편집" : "새 결재 양식"}</div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">양식 이름 *</label>
                <input value={editing.name || ""} onChange={(e) => patch({ name: e.target.value })} placeholder="예: 법인카드 지출 결의서"
                  className="w-full h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">분류</label>
                <input value={editing.category || ""} onChange={(e) => patch({ category: e.target.value })} placeholder="예: 비용 처리"
                  className="w-full h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm" />
              </div>
            </div>
            <div className="mb-3">
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">설명</label>
              <input value={editing.description || ""} onChange={(e) => patch({ description: e.target.value })} placeholder="작성자에게 보이는 안내"
                className="w-full h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm" />
            </div>

            {/* 커스텀 필드 */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">입력 필드</label>
                <button onClick={() => patch({ fields: [...(editing.fields || []), emptyField()] })} className="text-[11px] px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">+ 필드 추가</button>
              </div>
              {(editing.fields || []).length === 0 ? (
                <div className="text-[11px] text-[var(--text-dim)] px-1 py-1.5">필드를 추가하면 작성자가 채웁니다(예: 지출 항목, 금액, 사유).</div>
              ) : (
                <div className="space-y-1.5">
                  {(editing.fields || []).map((f, i) => (
                    <div key={f.key} className="flex flex-wrap items-center gap-1.5 bg-[var(--bg-surface)] rounded-lg p-2">
                      <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="필드 이름"
                        className="flex-1 min-w-[120px] h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs" />
                      <select value={f.type} onChange={(e) => setField(i, { type: e.target.value as ApprovalFieldType })}
                        className="h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs">
                        {(Object.keys(FIELD_TYPE_LABEL) as ApprovalFieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
                      </select>
                      {f.type === "select" && (
                        <input value={(f.options || []).join(", ")} onChange={(e) => setField(i, { options: e.target.value.split(",").map((s) => s.trim()).filter(Boolean) })}
                          placeholder="옵션1, 옵션2" className="flex-1 min-w-[100px] h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs" />
                      )}
                      <label className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                        <input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} className="accent-[var(--primary)]" /> 필수
                      </label>
                      <button onClick={() => patch({ fields: (editing.fields || []).filter((_, j) => j !== i) })} className="text-[var(--danger)] text-xs px-1">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 내용 템플릿 */}
            <div className="mb-3">
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">기본 내용(템플릿)</label>
              <textarea value={editing.content_template || ""} onChange={(e) => patch({ content_template: e.target.value })} rows={3}
                placeholder={"작성 시 상세 내용에 기본으로 채워집니다.\n예: 1. 지출 항목\n2. 사유"}
                className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm resize-y" />
            </div>

            {/* 결재선 단계 */}
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">결재선 (승인 단계)</label>
                <button onClick={() => patch({ stages: [...(editing.stages || []), emptyStage((editing.stages || []).length + 1)] })} className="text-[11px] px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">+ 단계 추가</button>
              </div>
              <div className="space-y-1.5">
                {(editing.stages || []).map((s, i) => (
                  <div key={i} className="bg-[var(--bg-surface)] rounded-lg p-2 space-y-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="text-[10px] font-bold w-5 h-5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center shrink-0">{i + 1}</span>
                      <input value={s.name} onChange={(e) => setStage(i, { name: e.target.value })} placeholder="단계 이름(예: 팀장 승인)"
                        className="flex-1 h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs" />
                      <select value={s.approver_type} onChange={(e) => setStage(i, { approver_type: e.target.value as ApproverType })}
                        className="h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs">
                        <option value="role">역할</option><option value="user">특정 인물</option>
                      </select>
                      <button onClick={() => patch({ stages: (editing.stages || []).filter((_, j) => j !== i) })} className="text-[var(--danger)] text-xs px-1">✕</button>
                    </div>
                    {s.approver_type === "role" ? (
                      <select value={s.approver_role || "manager"} onChange={(e) => setStage(i, { approver_role: e.target.value })}
                        className="w-full h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs">
                        {ROLE_OPTS.map((o) => <option key={o.v} value={o.v}>{o.l}</option>)}
                      </select>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {(users as any[]).map((u) => {
                          const on = (s.approver_user_ids || []).includes(u.id);
                          return (
                            <button key={u.id} onClick={() => setStage(i, { approver_user_ids: on ? (s.approver_user_ids || []).filter((x) => x !== u.id) : [...(s.approver_user_ids || []), u.id] })}
                              className={`text-[10px] px-2 py-0.5 rounded-full border ${on ? "bg-[var(--primary)] text-white border-[var(--primary)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}>
                              {u.name || u.email}
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            {/* 옵션 토글 */}
            <div className="flex flex-wrap gap-4 mb-4">
              <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer">
                <input type="checkbox" checked={editing.allow_requester_edit ?? true} onChange={(e) => patch({ allow_requester_edit: e.target.checked })} className="accent-[var(--primary)]" /> 작성자 내용 수정 허용
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer">
                <input type="checkbox" checked={editing.use_attachment ?? true} onChange={(e) => patch({ use_attachment: e.target.checked })} className="accent-[var(--primary)]" /> 첨부파일 사용
              </label>
            </div>

            <div className="flex gap-2">
              <button onClick={() => setEditing(null)} className="btn-secondary flex-1">취소</button>
              <button onClick={save} disabled={saving} className="btn-primary flex-1">{saving ? "저장 중…" : "양식 저장"}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
