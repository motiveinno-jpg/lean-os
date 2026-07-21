"use client";

import { appConfirm } from "@/components/global-confirm";
import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { DOC_TYPES } from "@/lib/documents";
import { DEFAULT_DOC_TEMPLATES } from "@/lib/default-doc-templates";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";

// ── 인사(HR) 양식 type 집합 ──
//   전자계약(비즈니스) 양식과 분리해 관리 화면을 나눈다. 데이터(doc_templates)는 그대로.
export const HR_TYPES = [
  "contract_labor",
  "hr_contract",
  "employment",
  "salary_contract",
  "comprehensive_labor",
  "non_compete",
  "privacy_consent",
];

type TemplatesScope = "business" | "hr";

export const isHrType = (type?: string) => HR_TYPES.includes(type || "");

// ── Templates Tab (공용) ──
//   scope="business" → 전자계약 양식(계약서·견적서 등), scope="hr" → 인사 양식(근로계약서 등).
export function TemplatesTab({ scope, companyId, userId, templates, onInvalidate }: {
  scope: TemplatesScope;
  companyId: string;
  userId: string;
  templates: any[];
  onInvalidate: () => void;
}) {
  void userId; // doc_templates 에 created_by 없음 — 시그니처 호환용
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [seeding, setSeeding] = useState(false);

  // 목록 필터 — scope 에 맞는 양식만 노출
  const scopedTemplates = templates.filter((t: any) =>
    scope === "hr" ? isHrType(t.type) : !isHrType(t.type)
  );

  // 폼 '문서 유형' select 옵션
  const typeOptions = scope === "hr"
    ? DOC_TYPES.filter((t) => isHrType(t.value))
    : DOC_TYPES.filter((t) => !isHrType(t.value));
  const defaultType = scope === "hr" ? "contract_labor" : "contract";

  const seedDefaults = async () => {
    setSeeding(true);
    try {
      const rows = DEFAULT_DOC_TEMPLATES.filter((tpl) =>
        scope === "hr" ? isHrType(tpl.type) : !isHrType(tpl.type)
      );
      for (const tpl of rows) {
        await supabase.from("doc_templates").insert({
          company_id: companyId,
          name: tpl.name,
          type: tpl.type,
          content_json: tpl.content_json,
          variables: tpl.variables,
          is_active: true,
        });
      }
      queryClient.invalidateQueries({ queryKey: ["doc-templates"] });
      onInvalidate();
    } finally {
      setSeeding(false);
    }
  };
  const [editingId, setEditingId] = useState<string | null>(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: "", type: defaultType, content_json: { title: "", sections: [{ title: "", content: "" }] }, variables: [] as string[],
  });
  const [newVar, setNewVar] = useState("");

  const resetForm = () => {
    setForm({ name: "", type: defaultType, content_json: { title: "", sections: [{ title: "", content: "" }] }, variables: [] });
    setNewVar("");
    setEditingId(null);
    setShowForm(false);
  };

  const startEdit = (tpl: any) => {
    const cj = tpl.content_json || { title: "", sections: [] };
    setForm({
      name: tpl.name,
      type: tpl.type || defaultType,
      content_json: {
        title: cj.title || tpl.name,
        sections: Array.isArray(cj.sections) && cj.sections.length > 0 ? cj.sections : [{ title: "", content: "" }],
      },
      variables: Array.isArray(tpl.variables) ? tpl.variables : [],
    });
    setEditingId(tpl.id);
    setShowForm(true);
    setPreviewId(null);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      // QA 2026-07-13: doc_templates 에 updated_at 컬럼이 없음 — 포함 시 PGRST204 400 (등록/수정 항상 실패).
      const payload = {
        name: form.name,
        type: form.type,
        content_json: form.content_json,
        variables: form.variables,
      };
      if (editingId) {
        const { error } = await supabase.from("doc_templates").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await supabase.from("doc_templates").insert({
          ...payload,
          company_id: companyId,
          is_active: true,
          is_custom: true,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doc-templates"] });
      onInvalidate();
      resetForm();
      toast(editingId ? "양식 수정 완료" : "양식 등록 완료", "success");
    },
    onError: (e: any) => toast(`저장 실패: ${friendlyError(e, "권한이 없거나 일시 오류")}`, "error"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("doc_templates").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doc-templates"] });
      onInvalidate();
      toast("양식 삭제 완료", "success");
    },
    onError: (e: any) => toast(`삭제 실패: ${friendlyError(e, "권한이 없거나 일시 오류")}`, "error"),
  });

  const addSection = () => {
    setForm({
      ...form,
      content_json: {
        ...form.content_json,
        sections: [...form.content_json.sections, { title: "", content: "" }],
      },
    });
  };

  const removeSection = (idx: number) => {
    setForm({
      ...form,
      content_json: {
        ...form.content_json,
        sections: form.content_json.sections.filter((_: any, i: number) => i !== idx),
      },
    });
  };

  const updateSection = (idx: number, field: "title" | "content", value: string) => {
    const sections = [...form.content_json.sections];
    sections[idx] = { ...sections[idx], [field]: value };
    setForm({ ...form, content_json: { ...form.content_json, sections } });
  };

  const addVariable = () => {
    const v = newVar.trim().replace(/\s+/g, "_");
    if (v && !form.variables.includes(v)) {
      setForm({ ...form, variables: [...form.variables, v] });
      setNewVar("");
    }
  };

  const removeVariable = (v: string) => {
    setForm({ ...form, variables: form.variables.filter((x: string) => x !== v) });
  };

  const previewTemplate = scopedTemplates.find((t: any) => t.id === previewId);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="templates-tab-header">
        <p className="text-sm text-[var(--text-muted)]">
          {scope === "hr" ? "인사 양식을 관리하고, 커스텀 양식을 등록하세요" : "문서 양식을 관리하고, 커스텀 양식을 등록하세요"}
        </p>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="btn-primary"
        >
          + 새 양식 등록
        </button>
      </div>

      {/* Template Form (Create / Edit) */}
      {showForm && (
        <div className="templates-form glass-card">
          <h3 className="text-sm font-bold mb-4 text-[var(--text)]">
            {editingId ? "양식 수정" : "새 양식 등록"}
          </h3>

          <div className="templates-form-grid">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">양식명 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={scope === "hr" ? "표준근로계약서" : "마케팅대행 계약서"}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">문서 유형</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                {typeOptions.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
          </div>

          {/* Title */}
          <div className="mb-4">
            <label className="block text-xs text-[var(--text-muted)] mb-1">제목</label>
            <input value={form.content_json.title}
              onChange={(e) => setForm({ ...form, content_json: { ...form.content_json, title: e.target.value } })}
              placeholder="문서 제목"
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
          </div>

          {/* Sections */}
          <div className="templates-sections">
            <div className="templates-section-header">
              <label className="text-xs text-[var(--text-muted)]">섹션</label>
              <button onClick={addSection} className="text-xs text-[var(--primary)] hover:underline font-medium">
                + 섹션 추가
              </button>
            </div>
            <div className="space-y-3">
              {form.content_json.sections.map((sec: any, idx: number) => (
                <div key={idx} className="templates-section-item">
                  <div className="templates-section-item-header">
                    <span className="text-[10px] text-[var(--text-dim)] font-medium">섹션 {idx + 1}</span>
                    {form.content_json.sections.length > 1 && (
                      <button onClick={() => removeSection(idx)} className="text-[10px] text-red-400 hover:text-red-500">삭제</button>
                    )}
                  </div>
                  <input value={sec.title} onChange={(e) => updateSection(idx, "title", e.target.value)}
                    placeholder="섹션 제목 (예: 제1조 목적)"
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm mb-2 focus:outline-none focus:border-[var(--primary)]" />
                  <textarea value={sec.content} onChange={(e) => updateSection(idx, "content", e.target.value)}
                    placeholder="섹션 내용... {{변수명}} 형식으로 변수를 삽입할 수 있습니다"
                    rows={4}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)] resize-y font-mono" />
                </div>
              ))}
            </div>
          </div>

          {/* Variables */}
          <div className="templates-variables">
            <label className="block text-xs text-[var(--text-muted)] mb-2">변수 (&#123;&#123;변수명&#125;&#125; 형식으로 본문에 사용)</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {form.variables.map((v: string) => (
                <span key={v} className="templates-variable-chip">
                  {`{{${v}}}`}
                  <button onClick={() => removeVariable(v)} className="text-[var(--primary)] hover:text-red-400">&times;</button>
                </span>
              ))}
            </div>
            <div className="templates-variable-input-row">
              <input value={newVar} onChange={(e) => setNewVar(e.target.value)}
                placeholder="변수명 (예: employee_name)"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addVariable())}
                className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]" />
              <button onClick={addVariable}
                className="px-3 py-2 bg-[var(--primary)]/10 text-[var(--primary)] rounded-lg text-xs font-semibold hover:bg-[var(--primary)]/20 transition">
                추가
              </button>
            </div>
          </div>

          <div className="templates-form-actions">
            <button onClick={() => form.name && saveMut.mutate()} disabled={!form.name || saveMut.isPending}
              className="btn-primary">
              {saveMut.isPending ? "저장 중..." : editingId ? "수정" : "등록"}
            </button>
            <button onClick={resetForm} className="btn-ghost">취소</button>
          </div>
        </div>
      )}

      {/* Templates List */}
      <div className="templates-list glass-card">
        {scopedTemplates.length === 0 ? (
          <div className="templates-list-empty">
            <div className="text-4xl mb-4">📝</div>
            <div className="text-lg font-bold mb-2">등록된 양식이 없습니다</div>
            <div className="text-sm text-[var(--text-muted)] mb-4">
              {scope === "hr"
                ? "표준근로계약서 등 인사 양식을 한번에 등록하거나, 직접 만들 수 있습니다"
                : "계약서·견적서 등 기본 양식을 한번에 등록하거나, 직접 만들 수 있습니다"}
            </div>
            <button
              onClick={seedDefaults}
              disabled={seeding}
              className="btn-primary"
            >
              {seeding ? "등록 중..." : "기본 양식 등록하기"}
            </button>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)]/50">
            {scopedTemplates.map((tpl: any) => {
              const typeLabel = DOC_TYPES.find(t => t.value === tpl.type)?.label || tpl.type;
              const vars = Array.isArray(tpl.variables) ? tpl.variables : [];
              const isPreview = previewId === tpl.id;
              const sectionCount = Array.isArray(tpl.content_json?.sections) ? tpl.content_json.sections.length : 0;

              return (
                <div key={tpl.id} className="template-row">
                  <div className="template-row-header">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="template-row-badges">
                          <span className="text-sm font-medium">{tpl.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">{typeLabel}</span>
                          {sectionCount > 0 && (
                            <span className="caption">{sectionCount}개 섹션</span>
                          )}
                        </div>
                        {vars.length > 0 && (
                          <div className="template-row-vars">
                            {vars.slice(0, 6).map((v: string) => (
                              <span key={v} className="text-[10px] px-1.5 py-0.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded text-[var(--text-dim)] font-mono">
                                {`{{${v}}}`}
                              </span>
                            ))}
                            {vars.length > 6 && (
                              <span className="caption">+{vars.length - 6}개</span>
                            )}
                          </div>
                        )}
                      </div>
                      <div className="template-row-actions">
                        <button onClick={() => setPreviewId(isPreview ? null : tpl.id)}
                          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition">
                          {isPreview ? "접기" : "미리보기"}
                        </button>
                        <button onClick={() => startEdit(tpl)}
                          className="text-xs text-[var(--primary)] hover:underline font-medium transition">
                          수정
                        </button>
                        <button onClick={async () => {
                          if (await appConfirm(`"${tpl.name}" 양식을 삭제하시겠습니까?`, { danger: true })) deleteMut.mutate(tpl.id);
                        }}
                          className="text-xs text-red-400 hover:text-red-500 font-medium transition">
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Preview Panel */}
                  {isPreview && previewTemplate && (
                    <div className="template-preview-panel">
                      <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-5">
                        <h4 className="text-sm font-bold mb-3">{previewTemplate.content_json?.title || previewTemplate.name}</h4>
                        <div className="space-y-3">
                          {(previewTemplate.content_json?.sections || []).map((sec: any, idx: number) => (
                            <div key={idx}>
                              {sec.title && <div className="text-xs font-semibold text-[var(--text)] mb-1">{sec.title}</div>}
                              <pre className="text-xs text-[var(--text-muted)] whitespace-pre-wrap font-mono leading-relaxed">{sec.content}</pre>
                            </div>
                          ))}
                        </div>
                        {vars.length > 0 && (
                          <div className="mt-4 pt-3 border-t border-[var(--border)]">
                            <span className="text-[10px] text-[var(--text-dim)] uppercase">입력 필요 변수</span>
                            <div className="flex flex-wrap gap-1.5 mt-1.5">
                              {vars.map((v: string) => (
                                <span key={v} className="text-[10px] px-2 py-0.5 bg-[var(--primary)]/10 text-[var(--primary)] rounded-full font-mono">
                                  {v}
                                </span>
                              ))}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
