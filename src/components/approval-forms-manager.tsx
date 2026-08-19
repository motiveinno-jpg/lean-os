"use client";
import { appConfirm } from "@/components/global-confirm";
import { QueryBar, ChipGroup, QuickSearch, quickSearchHit } from "@/components/query-kit";
import { logRead } from "@/lib/log-read";

// 결재 양식 관리 + 빌더 (2026-07-01, HR 서비스식) — approvals '양식 관리' 탭에서 사용.
//   양식 목록 + '새 양식 추가' → 빌더(이름·분류·설명·커스텀 필드·내용 템플릿·결재선 단계·옵션).
//   저장은 approval_forms. 새 요청에서 이 양식을 선택하면 필드/템플릿/결재선이 적용된다.

import { useState } from "react";
import { createPortal } from "react-dom";
import dynamic from "next/dynamic";
// 기본 내용(템플릿)에도 표·서식 지원 (2026-07-29 사장님) — 저장은 HTML, 상세 화면이 sanitize 렌더.
const RichEditor = dynamic(() => import("@/components/rich-editor").then((m) => ({ default: m.RichEditor })), {
  ssr: false,
  loading: () => <div className="h-32 bg-[var(--bg-surface)] rounded-xl animate-pulse" />,
});

/** 평문 템플릿 → RichEditor 초기 HTML (이미 HTML 이면 그대로) */
function tplToHtml(text: string): string {
  if (!text) return "";
  if (/^\s*</.test(text)) return text;
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return text.split("\n").map((l) => (l.trim() === "" ? "<p><br/></p>" : `<p>${esc(l)}</p>`)).join("");
}
/** RichEditor 빈 문서 판별 — 표·이미지 없고 텍스트도 없으면 빈 값으로 저장 */
function htmlOrEmpty(html: string): string {
  if (!html) return "";
  if (/<(img|table)/i.test(html)) return html;
  return html.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim() === "" ? "" : html;
}
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import {
  listApprovalForms, saveApprovalForm, deleteApprovalForm,
  FIELD_TYPE_LABEL, type ApprovalForm, type ApprovalFormField, type ApprovalFormStage, type ApprovalFieldType, type ApproverType,
} from "@/lib/approval-forms";
import {
  getApprovalPolicies, upsertApprovalPolicy,
  REQUEST_TYPE_LABELS, type ApprovalPolicy, type ApprovalStageConfig,
} from "@/lib/approval-workflow";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;
const uid = () => crypto.randomUUID();
const ROLE_OPTS: { v: string; l: string }[] = [
  { v: "manager", l: "팀장/매니저" }, { v: "admin", l: "관리자" }, { v: "owner", l: "대표/CEO" },
];
const roleLabel = (r?: string | null) => ROLE_OPTS.find((o) => o.v === r)?.l || r || "관리자";

const emptyField = (): ApprovalFormField => ({ key: uid().slice(0, 8), label: "", type: "text", required: false, options: [] });
const emptyStage = (n: number): ApprovalFormStage => ({ stage: n, name: `${n}차 승인`, approver_type: "role", approver_role: "manager", approver_user_ids: [], required_count: 1 });

// 기본 제공 유형(경비청구 등) 결재선 역할 옵션 — 정책 관리 탭과 동일.
const POLICY_ROLE_OPTS: { value: string; label: string }[] = [
  { value: "manager", label: "팀장" }, { value: "director", label: "이사" }, { value: "ceo", label: "대표" },
  { value: "admin", label: "관리자" }, { value: "owner", label: "소유자" }, { value: "finance", label: "재무" },
];
const emptyPolicyStage = (n: number): ApprovalStageConfig => ({ stage: n, name: `${n}차 승인`, approver_role: "manager" });

export function ApprovalFormsManager({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  // 기본 제공 유형/회사 양식을 탭으로 분리 (2026-08-06 사장님 — 계약 양식 관리와 동일한 방식).
  //   기본은 '회사 결재 양식' — 기본 유형 카드 11개에 밀려 아래로 내려가던 쪽.
  const [listTab, setListTab] = useState<"company" | "default">("company");
  const [q, setQ] = useState("");
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
      const data = logRead('components/approval-forms-manager:data', await db.from("users").select("id, name, email, role").eq("company_id", companyId).order("name"));
      return (data || []) as { id: string; name: string | null; email: string | null; role: string }[];
    },
    enabled: !!companyId,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["approval-forms", companyId] });
  const userName = (id: string) => { const u = (users as any[]).find((x) => x.id === id); return u?.name || u?.email || "구성원"; };

  // 필드 순서 이동 (2026-07-30 사장님 — 입력 필드 배치를 양식에서 자유롭게)
  const [dragField, setDragField] = useState<{ list: "custom" | "default"; i: number } | null>(null);
  const moveArr = <T,>(arr: T[], from: number, to: number): T[] => {
    if (to < 0 || to >= arr.length) return arr;
    const next = [...arr];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
  };

  const openNew = () => setEditing({ name: "", category: "", description: "", fields: [], content_template: "", stages: [emptyStage(1)], reference_user_ids: [], allow_requester_edit: true, use_attachment: true });
  const openEdit = (f: ApprovalForm) => setEditing({ ...f });

  // ── 기본 제공 유형(경비청구 등) — 저장 방식(request_type 값)은 그대로 두고, 표시 이름·결재선만
  //   정책(approval_policies)으로 커스터마이즈. 여기서 "결재 양식 관리"에 같이 노출·편집한다.
  const { data: policies = [] } = useQuery({
    queryKey: ["approval-policies", companyId],
    queryFn: () => getApprovalPolicies(companyId),
    enabled: !!companyId,
  });
  const [editingDefaultKey, setEditingDefaultKey] = useState<string | null>(null);
  //   결재선 관리에서 만든 결재선(document_type = "line") — 양식에 골라 붙인다 (2026-08-18 사장님: "양식에서 생성된 결재선을 선택")
  const lineOptions = (policies as ApprovalPolicy[]).filter((p) => p.is_active && (p.document_type === "line" || p.document_type === "default"));
  const lineToFormStages = (p: ApprovalPolicy): ApprovalFormStage[] => (p.stages as ApprovalStageConfig[]).map((st, i) => ({
    stage: i + 1, name: st.name || `${i + 1}차 승인`,
    approver_type: (st as any).approver_id ? "user" : "role",
    approver_role: (st as any).approver_id ? null : (st.approver_role || "manager"),
    approver_user_ids: (st as any).approver_id ? [(st as any).approver_id] : [],
    required_count: 1,
  }));
  const linePicker = (onPick: (p: ApprovalPolicy) => void) => (
    <select defaultValue="" onChange={(e) => { const p = lineOptions.find((x) => x.id === e.target.value); if (p) onPick(p); e.currentTarget.value = ""; }}
      className="h-8 px-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] text-[var(--text-muted)]">
      <option value="">결재선 관리에서 만든 결재선 불러오기…</option>
      {lineOptions.map((p) => <option key={p.id} value={p.id}>{p.name} · {(p.stages as ApprovalStageConfig[]).length}단계</option>)}
    </select>
  );
  const [defaultForm, setDefaultForm] = useState({ label: "", descriptionTemplate: "", autoApproveBelow: "", stages: [emptyPolicyStage(1)] as ApprovalStageConfig[], fields: [] as ApprovalFormField[], allowLineEdit: true, referenceUserIds: [] as string[] });
  const [savingDefault, setSavingDefault] = useState(false);

  const openEditDefault = (key: string) => {
    const p = (policies as ApprovalPolicy[]).find((x) => x.document_type === key && x.is_active);
    setDefaultForm({
      label: p?.label || "",
      descriptionTemplate: p?.description_template || "",
      autoApproveBelow: p?.auto_approve_below ? String(p.auto_approve_below) : "",
      stages: p?.stages?.length ? p.stages : [emptyPolicyStage(1)],
      fields: p?.fields || [],
      allowLineEdit: p?.allow_line_edit !== false,
      referenceUserIds: p?.reference_user_ids || [],
    });
    setEditingDefaultKey(key);
  };
  const saveDefault = async () => {
    if (!editingDefaultKey) return;
    setSavingDefault(true);
    try {
      const existing = (policies as ApprovalPolicy[]).find((x) => x.document_type === editingDefaultKey && x.is_active);
      await upsertApprovalPolicy({
        id: existing?.id,
        company_id: companyId,
        name: defaultForm.label.trim() || REQUEST_TYPE_LABELS[editingDefaultKey as keyof typeof REQUEST_TYPE_LABELS] || editingDefaultKey,
        document_type: editingDefaultKey,
        label: defaultForm.label.trim() || undefined,
        description_template: defaultForm.descriptionTemplate.trim() || undefined,
        auto_approve_below: Number(defaultForm.autoApproveBelow) || 0,
        // 특정 인물 미선택(빈 approver_id) 단계는 역할 기준으로 정리 + stage 번호 재정렬
        stages: defaultForm.stages.map((st, i) => {
          const { approver_id, approver_name, ...rest } = st;
          return approver_id ? { ...rest, stage: i + 1, approver_id, approver_name } : { ...rest, stage: i + 1 };
        }),
        fields: defaultForm.fields.filter((f) => (f.label || "").trim()),
        allow_line_edit: defaultForm.allowLineEdit,
        reference_user_ids: defaultForm.referenceUserIds,
        is_active: true,
      });
      toast("저장했습니다", "success");
      setEditingDefaultKey(null);
      qc.invalidateQueries({ queryKey: ["approval-policies", companyId] });
    } catch (e: any) { toast("저장 실패: " + (e?.message || ""), "error"); }
    finally { setSavingDefault(false); }
  };
  const setDefaultField = (i: number, p: Partial<ApprovalFormField>) =>
    setDefaultForm((s) => ({ ...s, fields: s.fields.map((f, j) => (j === i ? { ...f, ...p } : f)) }));

  const save = async () => {
    if (!editing) return;
    if (!(editing.name || "").trim()) { toast("양식 이름을 입력하세요", "error"); return; }
    if (!(editing.stages || []).length) { toast("승인 단계를 1개 이상 추가하세요", "error"); return; }
    setSaving(true);
    try {
      await saveApprovalForm({
        id: editing.id, companyId,
        name: editing.name!.trim(), category: editing.category || null, baseType: editing.base_type || null, description: editing.description || null,
        fields: (editing.fields || []).filter((f) => (f.label || "").trim()),
        contentTemplate: editing.content_template || null,
        stages: (editing.stages || []).map((s, i) => ({ ...s, stage: i + 1 })),
        referenceUserIds: editing.reference_user_ids || [],
        allowRequesterEdit: editing.allow_requester_edit ?? true,
        useAttachment: editing.use_attachment ?? true,
      });
      toast(editing.id ? "양식을 수정했습니다" : "양식을 추가했습니다", "success");
      setEditing(null); refresh();
    } catch (e: any) { toast("저장 실패: " + (e?.message || ""), "error"); }
    finally { setSaving(false); }
  };

  const remove = async (f: ApprovalForm) => {
    if (!(await appConfirm(`'${f.name}' 양식을 삭제할까요?`, { danger: true }))) return;
    try { await deleteApprovalForm(f.id); toast("삭제했습니다", "info"); refresh(); }
    catch (e: any) { toast("삭제 실패: " + (e?.message || ""), "error"); }
  };

  // ── 빌더 내부 편집 헬퍼 ──
  const patch = (p: Partial<ApprovalForm>) => setEditing((s) => s && ({ ...s, ...p }));
  const setField = (i: number, p: Partial<ApprovalFormField>) => patch({ fields: (editing!.fields || []).map((f, j) => (j === i ? { ...f, ...p } : f)) });

  //   2026-08-18 조회 표준 — 카드 격자 → 조회 줄(갈래 칩·빠른검색 ‖ + 새 양식 추가) + 표(공용 머리단). 상자 안 상자 없음.
  const qHit = (name: string, extra: string[] = []) => quickSearchHit(q, [name, ...extra]);
  const companyRows = (forms as ApprovalForm[]).filter((f) => qHit(f.name, [f.category || ""]));
  const defaultRows = Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) => {
    const p = (policies as ApprovalPolicy[]).find((x) => x.document_type === k && x.is_active);
    return { key: k, base: v, name: p?.label || v, fields: p?.fields?.length || 0, stages: p?.stages?.length || 1, custom: !!p };
  }).filter((r) => qHit(r.name, [r.base]));

  return (
    <div className="approval-forms-manager ap-list">
      <QueryBar right={<button onClick={openNew} className="btn-primary btn-sm whitespace-nowrap">+ 새 양식 추가</button>}>
        <ChipGroup value={listTab} onChange={setListTab}
          options={[{ value: "company", label: `회사 결재 양식 ${(forms as ApprovalForm[]).length}` }, { value: "default", label: `기본 제공 유형 ${Object.keys(REQUEST_TYPE_LABELS).length}` }] as const} />
        <QuickSearch value={q} onApply={setQ} placeholder="양식 이름 · 분류 — 쉼표로 여러 개, Enter" />
        <span className="text-[11px] text-[var(--text-dim)]">회사에서 쓰는 결재 양식(필드·내용·결재선)을 만들어 새 요청에서 선택합니다.</span>
      </QueryBar>

      {/* 기본 제공 유형 — 표시 이름·결재선을 여기서 편집(저장 방식은 그대로, 정책으로 커스터마이즈) */}
      {listTab === "default" && (
        <div className="ev-scroll">
          <table className="ev-table ev-lined afm-table">
            <thead><tr><th>유형</th><th>기본 이름</th><th>입력 필드</th><th>결재 단계</th><th>커스텀</th><th>관리</th></tr></thead>
            <tbody>
              {defaultRows.map((r) => (
                <tr key={r.key}>
                  <td className="text-left font-semibold">{r.name}</td>
                  <td className="text-center text-[var(--text-muted)]">{r.base}</td>
                  <td className="text-center mono-number">{r.fields}</td>
                  <td className="text-center mono-number">{r.stages}단계</td>
                  <td className="text-center">{r.custom ? <span className="badge badge-primary">적용됨</span> : <span className="badge badge-muted">기본</span>}</td>
                  <td className="text-center"><button onClick={() => openEditDefault(r.key)} className="btn-secondary btn-sm">편집</button></td>
                </tr>
              ))}
              {defaultRows.length === 0 && <tr><td colSpan={6} className="ap-empty text-xs text-[var(--text-muted)]">이 조건에 맞는 유형이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {listTab === "company" && ((forms as ApprovalForm[]).length === 0 ? (
        <div className="forms-empty-state">
          <div className="mx-auto w-14 h-14 mb-3 rounded-2xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
            <svg className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
          </div>
          <div className="text-sm font-bold mb-1">등록된 결재 양식이 없습니다</div>
          <div className="text-xs text-[var(--text-muted)]">&ldquo;+ 새 양식 추가&rdquo;로 우리 회사만의 결재 양식을 만들어 보세요</div>
        </div>
      ) : (
        <div className="ev-scroll">
          <table className="ev-table ev-lined afm-table">
            <thead><tr><th>양식</th><th>연결 유형</th><th>분류</th><th>입력 필드</th><th>결재 단계</th><th>관리</th></tr></thead>
            <tbody>
              {companyRows.map((f) => (
                <tr key={f.id}>
                  <td className="text-left font-semibold">{f.name}</td>
                  <td className="text-center">{f.base_type ? <span className="badge badge-primary">{REQUEST_TYPE_LABELS[f.base_type as keyof typeof REQUEST_TYPE_LABELS] || f.base_type}</span> : <span className="text-[var(--text-dim)]">독립</span>}</td>
                  <td className="text-center">{f.category ? <span className="badge badge-muted">{f.category}</span> : "—"}</td>
                  <td className="text-center mono-number">{f.fields?.length || 0}</td>
                  <td className="text-center mono-number">{f.stages?.length || 0}단계</td>
                  <td className="text-center">
                    <span className="inline-flex gap-1">
                      <button onClick={() => openEdit(f)} className="btn-secondary btn-sm">편집</button>
                      <button onClick={() => remove(f)} className="btn-secondary btn-sm text-[var(--danger)]">삭제</button>
                    </span>
                  </td>
                </tr>
              ))}
              {companyRows.length === 0 && <tr><td colSpan={6} className="ap-empty text-xs text-[var(--text-muted)]">이 조건에 맞는 양식이 없습니다</td></tr>}
            </tbody>
          </table>
        </div>
      ))}

      {/* 빌더 모달 */}
      {editing && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditing(null)}>
          <div className="form-builder-modal glass-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-icon">
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
            {/* 기본 유형 연결 (2026-08-18 사장님) — 고르면 새 요청에서 그 유형(예: 경비 청구)을 선택할 때 이 양식이 나온다 */}
            <div className="mb-3">
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">기본 요청 유형에 연결 <span className="text-[var(--text-dim)]">(선택)</span></label>
              <select value={editing.base_type || ""} onChange={(e) => patch({ base_type: e.target.value || null })}
                className="w-full h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm">
                <option value="">연결 안 함 — 새 요청 목록에 양식 이름으로 따로 나옵니다</option>
                {Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v} — 새 요청에서 '{v}'을(를) 고르면 이 양식이 나옵니다</option>)}
              </select>
            </div>
            <div className="mb-3">
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">설명</label>
              <input value={editing.description || ""} onChange={(e) => patch({ description: e.target.value })} placeholder="작성자에게 보이는 안내"
                className="w-full h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm" />
            </div>

            {/* 커스텀 필드 */}
            <div className="form-fields-section">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">입력 필드</label>
                <button onClick={() => patch({ fields: [...(editing.fields || []), emptyField()] })} className="text-[11px] px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">+ 필드 추가</button>
              </div>
              {(editing.fields || []).length === 0 ? (
                <div className="text-[11px] text-[var(--text-dim)] px-1 py-1.5">필드를 추가하면 작성자가 채웁니다(예: 지출 항목, 금액, 사유).</div>
              ) : (
                <div className="space-y-1.5">
                  {(editing.fields || []).map((f, i) => (
                    <div key={f.key} className="field-row"
                      onDragOver={(e) => { if (dragField?.list === "custom") e.preventDefault(); }}
                      onDrop={(e) => { e.preventDefault(); if (dragField?.list === "custom" && dragField.i !== i) patch({ fields: moveArr(editing.fields || [], dragField.i, i) }); setDragField(null); }}>
                      <span draggable title="끌어서 순서 이동" className="orderable-drag-handle"
                        onDragStart={(e) => { setDragField({ list: "custom", i }); e.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => setDragField(null)}>⠿</span>
                      <input value={f.label} onChange={(e) => setField(i, { label: e.target.value })} placeholder="필드 이름"
                        className="flex-1 min-w-[120px] h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs" />
                      <select value={f.type} onChange={(e) => setField(i, { type: e.target.value as ApprovalFieldType })}
                        className="h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs">
                        {(Object.keys(FIELD_TYPE_LABEL) as ApprovalFieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
                      </select>
                      {f.type === "select" && (
                        <div className="flex-1 min-w-[160px] flex flex-wrap items-center gap-1">
                          {(f.options || []).map((opt, oi) => (
                            <span key={oi} className="inline-flex items-center gap-1 pl-2 pr-1 h-7 rounded-full bg-[var(--bg)] border border-[var(--border)] text-xs">
                              {opt}
                              <button
                                type="button"
                                onClick={() => setField(i, { options: (f.options || []).filter((_, j) => j !== oi) })}
                                className="text-[var(--text-dim)] hover:text-[var(--danger)] px-0.5"
                              >
                                ✕
                              </button>
                            </span>
                          ))}
                          <input
                            placeholder="옵션 입력 후 Enter"
                            className="h-7 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs w-[110px]"
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" || !e.nativeEvent.isComposing) return;
                              e.preventDefault();
                              const v = e.currentTarget.value.trim();
                              if (!v) return;
                              setField(i, { options: [...(f.options || []), v] });
                              e.currentTarget.value = "";
                            }}
                          />
                        </div>
                      )}
                      {f.type === "fixed" && (
                        <input value={f.default_value || ""} onChange={(e) => setField(i, { default_value: e.target.value })}
                          placeholder="고정으로 표시할 값" className="flex-1 min-w-[100px] h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs" />
                      )}
                      <label className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                        <input type="checkbox" checked={!!f.required} onChange={(e) => setField(i, { required: e.target.checked })} className="accent-[var(--primary)]" /> 필수
                      </label>
                      <button onClick={() => patch({ fields: moveArr(editing.fields || [], i, i - 1) })} title="위로" className="orderable-move-btn">↑</button>
                      <button onClick={() => patch({ fields: moveArr(editing.fields || [], i, i + 1) })} title="아래로" className="orderable-move-btn">↓</button>
                      <button onClick={() => patch({ fields: (editing.fields || []).filter((_, j) => j !== i) })} className="text-[var(--danger)] text-xs px-1">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 내용 템플릿 — 표·서식 지원 */}
            <div className="content-template-section">
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">기본 내용(템플릿) — 표·서식 사용 가능</label>
              <RichEditor key={editing.id || "new-form"} content={tplToHtml(editing.content_template || "")}
                onChange={(html) => patch({ content_template: htmlOrEmpty(html) })}
                placeholder={"작성 시 상세 내용에 기본으로 채워집니다. 예: 1. 지출 항목 / 2. 사유"}
                maxHeight="260px" />
            </div>

            {/* 결재선 — 단계 편집은 결재허브 > 결재선 관리에서. 여기선 만든 결재선을 골라 붙이기만 (2026-08-19 사장님) */}
            <div className="approval-stages-section">
              <div className="flex items-center justify-between mb-1.5 gap-2 flex-wrap">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">결재선 (승인 단계)</label>
                {linePicker((p) => patch({ stages: lineToFormStages(p), reference_user_ids: Array.isArray(p.reference_user_ids) ? p.reference_user_ids : (editing.reference_user_ids || []) }))}
              </div>
              <div className="space-y-1">
                {(editing.stages || []).map((s, i) => (
                  <div key={i} className="flex items-center gap-1.5 text-xs px-2 py-1.5 rounded bg-[var(--bg-surface)] border border-[var(--border)]">
                    <span className="text-[10px] font-bold w-5 h-5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center shrink-0">{i + 1}</span>
                    <span className="font-medium truncate">{s.name || `${i + 1}차 승인`}</span>
                    <span className="text-[11px] text-[var(--text-dim)] ml-auto shrink-0">
                      {s.approver_type === "user"
                        ? ((s.approver_user_ids || []).map((id) => { const u = (users as any[]).find((x) => x.id === id); return u?.name || u?.email || "?"; }).join(", ") || "지정 안 됨")
                        : roleLabel(s.approver_role)}
                    </span>
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[var(--text-dim)] mt-1">단계 구성(추가·역할·담당자 변경)은 결재허브 &gt; 결재선 관리에서 합니다.</p>
            </div>

            {/* 참조(CC) — 결재선과 별개, 결과를 통보만 받는 인원 (미리 지정) */}
            <div className="reference-users-section">
              <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">참조 (선택) — 결재 여부와 무관하게 통보만 받는 인원</label>
              <div className="flex flex-wrap gap-1 bg-[var(--bg-surface)] rounded-lg p-2">
                {(users as any[]).length === 0 ? (
                  <span className="text-[11px] text-[var(--text-dim)] px-1 py-1">구성원이 없습니다</span>
                ) : (users as any[]).map((u) => {
                  const on = (editing.reference_user_ids || []).includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => patch({ reference_user_ids: on ? (editing.reference_user_ids || []).filter((x) => x !== u.id) : [...(editing.reference_user_ids || []), u.id] })}
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${on ? "bg-[var(--text-muted)] text-white border-[var(--text-muted)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}
                    >
                      {u.name || u.email}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 옵션 토글 */}
            <div className="options-toggle-row">
              <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer">
                <input type="checkbox" checked={editing.allow_requester_edit ?? true} onChange={(e) => patch({ allow_requester_edit: e.target.checked })} className="accent-[var(--primary)]" /> 작성자 내용 수정 허용
              </label>
              <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer">
                <input type="checkbox" checked={editing.use_attachment ?? true} onChange={(e) => patch({ use_attachment: e.target.checked })} className="accent-[var(--primary)]" /> 첨부파일 사용
              </label>
            </div>

            <div className="modal-footer-actions">
              <button onClick={() => setEditing(null)} className="btn-secondary flex-1">취소</button>
              <button onClick={save} disabled={saving} className="btn-primary flex-1">{saving ? "저장 중…" : "양식 저장"}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {/* 기본 제공 유형 편집 모달 — 회사 결재 양식 빌더와 동일 구성(이름·입력필드·내용템플릿·결재선·옵션).
          저장은 approval_policies (request_type 값은 그대로 유지 — 연차 차감 등 유형별 로직 보호) */}
      {editingDefaultKey && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/50 backdrop-blur-sm flex items-center justify-center p-4" onClick={() => setEditingDefaultKey(null)}>
          <div className="form-builder-modal glass-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header-icon">
              <span className="w-8 h-8 rounded-xl bg-[var(--primary)]/10 text-[var(--primary)] flex items-center justify-center">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth={1.8} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="3" y1="9" x2="21" y2="9"/><line x1="9" y1="21" x2="9" y2="9"/></svg>
              </span>
              <div className="text-sm font-bold text-[var(--text)]">
                기본 유형 편집 — {REQUEST_TYPE_LABELS[editingDefaultKey as keyof typeof REQUEST_TYPE_LABELS]}
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-3">
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">표시 이름 (비우면 기본값)</label>
                <input value={defaultForm.label} onChange={(e) => setDefaultForm((s) => ({ ...s, label: e.target.value }))}
                  placeholder={REQUEST_TYPE_LABELS[editingDefaultKey as keyof typeof REQUEST_TYPE_LABELS]}
                  className="w-full h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm" />
              </div>
              <div>
                <label className="block text-[11px] text-[var(--text-muted)] mb-1">자동승인 기준 금액 (원, 선택)</label>
                <input value={defaultForm.autoApproveBelow} onChange={(e) => setDefaultForm((s) => ({ ...s, autoApproveBelow: e.target.value.replace(/[^0-9]/g, "") }))}
                  placeholder="0 (비활성)"
                  className="w-full h-9 px-3 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-right" />
              </div>
            </div>

            {/* 커스텀 필드 — 회사 결재 양식 빌더와 동일 */}
            <div className="form-fields-section">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-[11px] font-semibold text-[var(--text-muted)]">입력 필드</label>
                <button onClick={() => setDefaultForm((s) => ({ ...s, fields: [...s.fields, emptyField()] }))}
                  className="text-[11px] px-2 py-0.5 rounded bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">+ 필드 추가</button>
              </div>
              {defaultForm.fields.length === 0 ? (
                <div className="text-[11px] text-[var(--text-dim)] px-1 py-1.5">필드를 추가하면 작성자가 채웁니다(예: 지출 항목, 금액, 사유). 비워두면 기존처럼 설명+금액만 사용됩니다.</div>
              ) : (
                <div className="space-y-1.5">
                  {defaultForm.fields.map((f, i) => (
                    <div key={f.key} className="field-row"
                      onDragOver={(e) => { if (dragField?.list === "default") e.preventDefault(); }}
                      onDrop={(e) => { e.preventDefault(); if (dragField?.list === "default" && dragField.i !== i) setDefaultForm((st) => ({ ...st, fields: moveArr(st.fields, dragField.i, i) })); setDragField(null); }}>
                      <span draggable title="끌어서 순서 이동" className="orderable-drag-handle"
                        onDragStart={(e) => { setDragField({ list: "default", i }); e.dataTransfer.effectAllowed = "move"; }}
                        onDragEnd={() => setDragField(null)}>⠿</span>
                      <input value={f.label} onChange={(e) => setDefaultField(i, { label: e.target.value })} placeholder="필드 이름"
                        className="flex-1 min-w-[120px] h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs" />
                      <select value={f.type} onChange={(e) => setDefaultField(i, { type: e.target.value as ApprovalFieldType })}
                        className="h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs">
                        {(Object.keys(FIELD_TYPE_LABEL) as ApprovalFieldType[]).map((t) => <option key={t} value={t}>{FIELD_TYPE_LABEL[t]}</option>)}
                      </select>
                      {f.type === "select" && (
                        <div className="flex-1 min-w-[160px] flex flex-wrap items-center gap-1">
                          {(f.options || []).map((opt, oi) => (
                            <span key={oi} className="inline-flex items-center gap-1 pl-2 pr-1 h-7 rounded-full bg-[var(--bg)] border border-[var(--border)] text-xs">
                              {opt}
                              <button type="button" onClick={() => setDefaultField(i, { options: (f.options || []).filter((_, j) => j !== oi) })}
                                className="text-[var(--text-dim)] hover:text-[var(--danger)] px-0.5">✕</button>
                            </span>
                          ))}
                          <input
                            placeholder="옵션 입력 후 Enter"
                            className="h-7 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs w-[110px]"
                            onKeyDown={(e) => {
                              if (e.key !== "Enter" || !e.nativeEvent.isComposing) return;
                              e.preventDefault();
                              const v = e.currentTarget.value.trim();
                              if (!v) return;
                              setDefaultField(i, { options: [...(f.options || []), v] });
                              e.currentTarget.value = "";
                            }}
                          />
                        </div>
                      )}
                      {f.type === "fixed" && (
                        <input value={f.default_value || ""} onChange={(e) => setDefaultField(i, { default_value: e.target.value })}
                          placeholder="고정으로 표시할 값" className="flex-1 min-w-[100px] h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs" />
                      )}
                      <label className="flex items-center gap-1 text-[10px] text-[var(--text-muted)]">
                        <input type="checkbox" checked={!!f.required} onChange={(e) => setDefaultField(i, { required: e.target.checked })} className="accent-[var(--primary)]" /> 필수
                      </label>
                      <button onClick={() => setDefaultForm((s) => ({ ...s, fields: moveArr(s.fields, i, i - 1) }))} title="위로" className="orderable-move-btn">↑</button>
                      <button onClick={() => setDefaultForm((s) => ({ ...s, fields: moveArr(s.fields, i, i + 1) }))} title="아래로" className="orderable-move-btn">↓</button>
                      <button onClick={() => setDefaultForm((s) => ({ ...s, fields: s.fields.filter((_, j) => j !== i) }))} className="text-[var(--danger)] text-xs px-1">✕</button>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* 내용 템플릿 — 이 유형 선택 시 상세 내용에 기본으로 채워짐 · 표·서식 지원 */}
            <div className="content-template-section">
              <label className="block text-[11px] text-[var(--text-muted)] mb-1">기본 내용(템플릿) — 표·서식 사용 가능</label>
              <RichEditor key={editingDefaultKey || "default-form"} content={tplToHtml(defaultForm.descriptionTemplate)}
                onChange={(html) => setDefaultForm((s) => ({ ...s, descriptionTemplate: htmlOrEmpty(html) }))}
                placeholder={"작성 시 상세 내용에 기본으로 채워집니다. 예: 1. 지출 항목 / 2. 사유"}
                maxHeight="260px" />
            </div>

            {/* 결재선 — 기본양식에서는 아예 고르지 않는다. 결재선 관리에서 만든 결재선이 자동 적용
                (2026-08-19 사장님: "여기는 아무것도 선택 못하고 그냥 결재선 가져오기로").
                저장 시 stages 는 열 때 불러온 값이 그대로 통과 — 기존 결재선 데이터를 건드리지 않는다. */}
            <div className="approval-stages-section">
              <label className="text-[11px] font-semibold text-[var(--text-muted)]">결재선</label>
              <p className="mt-1.5 rounded-lg border border-[var(--border)] bg-[var(--bg-surface)] px-3 py-2 text-[11px] text-[var(--text-muted)]">
                결재선은 <b>결재허브 &gt; 결재선 관리</b>에서 만든 결재선을 자동으로 가져와 적용됩니다 —
                신청자의 부서·직원 대상 결재선이 우선, 없으면 회사 공통 결재선입니다. 여기서는 따로 선택하지 않습니다.
              </p>
            </div>

            {/* 참조(CC) — 결재선과 별개, 결과를 통보만 받는 인원 (빌더와 동일) */}
            <div className="reference-users-section">
              <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1.5">참조 (선택) — 결재 여부와 무관하게 통보만 받는 인원</label>
              <div className="flex flex-wrap gap-1 bg-[var(--bg-surface)] rounded-lg p-2">
                {(users as any[]).length === 0 ? (
                  <span className="text-[11px] text-[var(--text-dim)] px-1 py-1">구성원이 없습니다</span>
                ) : (users as any[]).map((u) => {
                  const on = defaultForm.referenceUserIds.includes(u.id);
                  return (
                    <button
                      key={u.id}
                      type="button"
                      onClick={() => setDefaultForm((s) => ({ ...s, referenceUserIds: on ? s.referenceUserIds.filter((x) => x !== u.id) : [...s.referenceUserIds, u.id] }))}
                      className={`text-[10px] px-2 py-0.5 rounded-full border ${on ? "bg-[var(--text-muted)] text-white border-[var(--text-muted)]" : "border-[var(--border)] text-[var(--text-muted)]"}`}
                    >
                      {u.name || u.email}
                    </button>
                  );
                })}
              </div>
            </div>

            {/* 옵션 토글 */}
            <div className="options-toggle-row">
              <label className="flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer">
                <input type="checkbox" checked={defaultForm.allowLineEdit} onChange={(e) => setDefaultForm((s) => ({ ...s, allowLineEdit: e.target.checked }))} className="accent-[var(--primary)]" /> 작성자 승인라인 변경 허용
              </label>
            </div>

            <div className="modal-footer-actions">
              <button onClick={() => setEditingDefaultKey(null)} className="btn-secondary flex-1">취소</button>
              <button onClick={saveDefault} disabled={savingDefault} className="btn-primary flex-1">{savingDefault ? "저장 중…" : "양식 저장"}</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
