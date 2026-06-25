"use client";

import { useState } from "react";
import { useQueryClient, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { DOC_TYPES } from "@/lib/documents";
import { DEFAULT_DOC_TEMPLATES } from "@/lib/default-doc-templates";

// ── 인사(HR) 양식 type 집합 ──
//   전자계약(비즈니스) 양식과 분리해 관리 화면을 나눈다. 데이터(doc_templates)는 그대로.
export const HR_TYPES = [
  "contract_labor",
  "employment",
  "salary_contract",
  "comprehensive_labor",
  "non_compete",
  "privacy_consent",
];

type TemplatesScope = "business" | "hr";

const isHrType = (type?: string) => HR_TYPES.includes(type || "");

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
        await (supabase as any).from("doc_templates").insert({
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
      const payload = {
        name: form.name,
        type: form.type,
        content_json: form.content_json,
        variables: form.variables,
        updated_at: new Date().toISOString(),
      };
      if (editingId) {
        const { error } = await (supabase as any).from("doc_templates").update(payload).eq("id", editingId);
        if (error) throw error;
      } else {
        const { error } = await (supabase as any).from("doc_templates").insert({
          ...payload,
          company_id: companyId,
          is_active: true,
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doc-templates"] });
      onInvalidate();
      resetForm();
    },
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("doc_templates").update({ is_active: false }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["doc-templates"] });
      onInvalidate();
    },
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
      <div className="flex items-center justify-between">
        <p className="text-sm text-[var(--text-muted)]">
          {scope === "hr" ? "인사 양식을 관리하고, 커스텀 양식을 등록하세요" : "문서 양식을 관리하고, 커스텀 양식을 등록하세요"}
        </p>
        <button
          onClick={() => { resetForm(); setShowForm(true); }}
          className="px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-xl text-sm font-semibold transition"
        >
          + 새 양식 등록
        </button>
      </div>

      {/* Template Form (Create / Edit) */}
      {showForm && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-purple-500/20 p-6">
          <h3 className="text-sm font-bold mb-4 text-purple-600">
            {editingId ? "양식 수정" : "새 양식 등록"}
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">양식명 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder={scope === "hr" ? "표준근로계약서" : "마케팅대행 계약서"}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-purple-500" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">문서 유형</label>
              <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-purple-500">
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
              className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-purple-500" />
          </div>

          {/* Sections */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs text-[var(--text-muted)]">섹션</label>
              <button onClick={addSection} className="text-xs text-purple-500 hover:text-purple-600 font-medium">
                + 섹션 추가
              </button>
            </div>
            <div className="space-y-3">
              {form.content_json.sections.map((sec: any, idx: number) => (
                <div key={idx} className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-4">
                  <div className="flex items-center justify-between mb-2">
                    <span className="text-[10px] text-[var(--text-dim)] font-medium">섹션 {idx + 1}</span>
                    {form.content_json.sections.length > 1 && (
                      <button onClick={() => removeSection(idx)} className="text-[10px] text-red-400 hover:text-red-500">삭제</button>
                    )}
                  </div>
                  <input value={sec.title} onChange={(e) => updateSection(idx, "title", e.target.value)}
                    placeholder="섹션 제목 (예: 제1조 목적)"
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm mb-2 focus:outline-none focus:border-purple-500" />
                  <textarea value={sec.content} onChange={(e) => updateSection(idx, "content", e.target.value)}
                    placeholder="섹션 내용... {{변수명}} 형식으로 변수를 삽입할 수 있습니다"
                    rows={4}
                    className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-purple-500 resize-y font-mono" />
                </div>
              ))}
            </div>
          </div>

          {/* Variables */}
          <div className="mb-4">
            <label className="block text-xs text-[var(--text-muted)] mb-2">변수 (&#123;&#123;변수명&#125;&#125; 형식으로 본문에 사용)</label>
            <div className="flex flex-wrap gap-2 mb-2">
              {form.variables.map((v: string) => (
                <span key={v} className="inline-flex items-center gap-1 px-2.5 py-1 bg-purple-500/10 text-purple-500 rounded-full text-xs">
                  {`{{${v}}}`}
                  <button onClick={() => removeVariable(v)} className="text-purple-400 hover:text-red-400">&times;</button>
                </span>
              ))}
            </div>
            <div className="flex gap-2">
              <input value={newVar} onChange={(e) => setNewVar(e.target.value)}
                placeholder="변수명 (예: employee_name)"
                onKeyDown={(e) => e.key === "Enter" && (e.preventDefault(), addVariable())}
                className="flex-1 px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-purple-500" />
              <button onClick={addVariable}
                className="px-3 py-2 bg-purple-500/10 text-purple-500 rounded-lg text-xs font-semibold hover:bg-purple-500/20 transition">
                추가
              </button>
            </div>
          </div>

          <div className="flex gap-2">
            <button onClick={() => form.name && saveMut.mutate()} disabled={!form.name || saveMut.isPending}
              className="px-4 py-2 bg-purple-500 text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {saveMut.isPending ? "저장 중..." : editingId ? "수정" : "등록"}
            </button>
            <button onClick={resetForm} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* Templates List */}
      <div className="glass-card overflow-hidden">
        {scopedTemplates.length === 0 ? (
          <div className="p-16 text-center">
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
              className="px-5 py-2.5 bg-purple-500 text-white rounded-xl text-sm font-semibold hover:bg-purple-600 transition disabled:opacity-50"
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
                <div key={tpl.id}>
                  <div className="px-5 py-4 hover:bg-[var(--bg-surface)] transition">
                    <div className="flex items-center justify-between">
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{tpl.name}</span>
                          <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-500">{typeLabel}</span>
                          {sectionCount > 0 && (
                            <span className="caption">{sectionCount}개 섹션</span>
                          )}
                        </div>
                        {vars.length > 0 && (
                          <div className="flex flex-wrap gap-1 mt-1.5">
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
                      <div className="flex items-center gap-2">
                        <button onClick={() => setPreviewId(isPreview ? null : tpl.id)}
                          className="text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition">
                          {isPreview ? "접기" : "미리보기"}
                        </button>
                        <button onClick={() => startEdit(tpl)}
                          className="text-xs text-purple-500 hover:text-purple-600 font-medium transition">
                          수정
                        </button>
                        <button onClick={() => {
                          if (confirm(`"${tpl.name}" 양식을 삭제하시겠습니까?`)) deleteMut.mutate(tpl.id);
                        }}
                          className="text-xs text-red-400 hover:text-red-500 font-medium transition">
                          삭제
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Preview Panel */}
                  {isPreview && previewTemplate && (
                    <div className="px-5 pb-4">
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
                                <span key={v} className="text-[10px] px-2 py-0.5 bg-purple-500/10 text-purple-500 rounded-full font-mono">
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
