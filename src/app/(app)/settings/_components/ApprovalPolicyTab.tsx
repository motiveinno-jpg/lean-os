"use client";
import { logRead } from "@/lib/log-read";

// settings/page.tsx 에서 추출 (2026-06-23, 거대 파일 분할) — 동작 무변경.
import { useState } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";

const DOCUMENT_TYPES = [
  { value: "expense", label: "경비" },
  { value: "payment", label: "지급" },
  { value: "leave", label: "휴가" },
  { value: "overtime", label: "초과근무" },
  { value: "purchase", label: "구매" },
  { value: "contract", label: "계약" },
  { value: "travel", label: "출장" },
  { value: "card_expense", label: "법인카드" },
  { value: "equipment", label: "장비" },
  { value: "custom", label: "기타" },
];

const APPROVER_ROLES = [
  { value: "owner", label: "대표" },
  { value: "admin", label: "관리자" },
  { value: "manager", label: "팀장" },
  { value: "member", label: "멤버" },
];

interface ApprovalStage {
  step: number;
  title: string;
  approver_role: string;
  min_approvers: number;
}

export function ApprovalPolicyTab({ companyId }: { companyId: string | null }) {
  const db = supabase;
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({
    entity_type: "expense",
    required_role: "admin",
    auto_approve: false,
    auto_approve_threshold: 0,
    min_amount: 0,
    max_amount: 0,
  });
  const [stages, setStages] = useState<ApprovalStage[]>([
    { step: 1, title: "1차 승인", approver_role: "manager", min_approvers: 1 },
  ]);

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["approval-policies", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const data = logRead('_components/ApprovalPolicyTab:data', await db
        .from("approval_policies")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }));
      return data || [];
    },
    enabled: !!companyId,
  });

  const upsertMut = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("회사 ID 없음");
      const row: any = {
        company_id: companyId,
        entity_type: form.entity_type,
        required_role: form.required_role,
        auto_approve: form.auto_approve,
        auto_approve_threshold: form.auto_approve_threshold || null,
        min_amount: form.min_amount || null,
        max_amount: form.max_amount || null,
        stages: stages.length > 0 ? stages : null,
      };
      if (editId) {
        const { error } = await db
          .from("approval_policies")
          .update(row)
          .eq("id", editId);
        if (error) throw error;
      } else {
        const { error } = await db
          .from("approval_policies")
          .insert(row);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["approval-policies"] });
      resetForm();
    },
    onError: (err: any) => toast("결재 정책 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const deleteMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.from("approval_policies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["approval-policies"] }),
    onError: (err: any) => toast(`삭제 실패: ${err.message || err}`, "error"),
  });

  function resetForm() {
    setShowForm(false);
    setEditId(null);
    setForm({
      entity_type: "expense",
      required_role: "admin",
      auto_approve: false,
      auto_approve_threshold: 0,
      min_amount: 0,
      max_amount: 0,
    });
    setStages([{ step: 1, title: "1차 승인", approver_role: "manager", min_approvers: 1 }]);
  }

  function editPolicy(p: any) {
    setEditId(p.id);
    setForm({
      entity_type: p.entity_type || "expense",
      required_role: p.required_role || "admin",
      auto_approve: p.auto_approve || false,
      auto_approve_threshold: p.auto_approve_threshold || 0,
      min_amount: p.min_amount || 0,
      max_amount: p.max_amount || 0,
    });
    if (p.stages && Array.isArray(p.stages) && p.stages.length > 0) {
      setStages(p.stages);
    } else {
      setStages([{ step: 1, title: "1차 승인", approver_role: "manager", min_approvers: 1 }]);
    }
    setShowForm(true);
  }

  function addStage() {
    const next = stages.length + 1;
    setStages([...stages, { step: next, title: `${next}차 승인`, approver_role: "admin", min_approvers: 1 }]);
  }

  function removeStage(idx: number) {
    const updated = stages.filter((_, i) => i !== idx).map((s, i) => ({ ...s, step: i + 1 }));
    setStages(updated);
  }

  function updateStage(idx: number, field: keyof ApprovalStage, value: any) {
    const updated = [...stages];
    (updated[idx] as any)[field] = value;
    setStages(updated);
  }

  if (!companyId) {
    return (
      <div className="glass-card p-6">
        <div className="text-center py-8 text-sm text-[var(--text-muted)]">로딩 중...</div>
      </div>
    );
  }

  return (
    <div className="approval-policy-tab">
      {/* Policy List */}
      <div className="approval-policy-list-card glass-card">
        <div className="flex items-center justify-between mb-4">
          <div>
            <h2 className="text-sm font-bold">승인 정책 관리</h2>
            <p className="text-xs text-[var(--text-dim)] mt-0.5">문서 유형별 결재 정책을 설정합니다</p>
          </div>
          <button
            onClick={() => { resetForm(); setShowForm(true); }}
            className="text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold transition"
          >
            + 정책 추가
          </button>
        </div>

        {/* Create / Edit Form */}
        {showForm && (
          <div className="approval-policy-settings-form">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="field-label">문서 유형 *</label>
                <select
                  value={form.entity_type}
                  onChange={(e) => setForm({ ...form, entity_type: e.target.value })}
                  className="field-input-sm"
                >
                  {DOCUMENT_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">필요 권한</label>
                <select
                  value={form.required_role}
                  onChange={(e) => setForm({ ...form, required_role: e.target.value })}
                  className="field-input-sm"
                >
                  {APPROVER_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>{r.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label">최소 금액 (원)</label>
                <input
                  type="number"
                  value={form.min_amount || ""}
                  onChange={(e) => setForm({ ...form, min_amount: Number(e.target.value) || 0 })}
                  placeholder="0"
                  className="field-input-sm"
                />
              </div>
              <div>
                <label className="field-label">최대 금액 (원)</label>
                <input
                  type="number"
                  value={form.max_amount || ""}
                  onChange={(e) => setForm({ ...form, max_amount: Number(e.target.value) || 0 })}
                  placeholder="무제한"
                  className="field-input-sm"
                />
              </div>
            </div>

            {/* Auto Approve */}
            <div className="approval-policy-auto-approve">
              <label className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                <input
                  type="checkbox"
                  checked={form.auto_approve}
                  onChange={(e) => setForm({ ...form, auto_approve: e.target.checked })}
                  className="rounded"
                />
                자동 승인
              </label>
              {form.auto_approve && (
                <div className="flex items-center gap-2">
                  <span className="text-xs text-[var(--text-dim)]">기준 금액 이하:</span>
                  <input
                    type="number"
                    value={form.auto_approve_threshold || ""}
                    onChange={(e) => setForm({ ...form, auto_approve_threshold: Number(e.target.value) || 0 })}
                    placeholder="100000"
                    className="w-32 px-3 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]"
                  />
                  <span className="text-xs text-[var(--text-dim)]">원</span>
                </div>
              )}
            </div>

            {/* Approval Stages */}
            <div className="approval-policy-stages">
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs text-[var(--text-muted)] font-semibold">결재 단계 설정</label>
                <button
                  onClick={addStage}
                  className="text-[10px] text-[var(--primary)] hover:underline font-semibold"
                >
                  + 단계 추가
                </button>
              </div>
              <div className="space-y-2">
                {stages.map((stage, idx) => (
                  <div key={idx} className="approval-policy-stage-row">
                    <span className="text-xs font-bold text-[var(--primary)] w-8 text-center shrink-0">{stage.step}</span>
                    <input
                      value={stage.title}
                      onChange={(e) => updateStage(idx, "title", e.target.value)}
                      placeholder="승인 단계명"
                      className="flex-1 px-2 py-1.5 bg-transparent text-xs focus:outline-none"
                    />
                    <select
                      value={stage.approver_role}
                      onChange={(e) => updateStage(idx, "approver_role", e.target.value)}
                      className="px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded text-xs focus:outline-none"
                    >
                      {APPROVER_ROLES.map((r) => (
                        <option key={r.value} value={r.value}>{r.label}</option>
                      ))}
                    </select>
                    <input
                      type="number"
                      value={stage.min_approvers}
                      onChange={(e) => updateStage(idx, "min_approvers", Number(e.target.value) || 1)}
                      min={1}
                      className="w-12 px-2 py-1.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded text-xs text-center focus:outline-none"
                      title="최소 승인 인원"
                    />
                    <span className="text-[10px] text-[var(--text-dim)] shrink-0">명</span>
                    {stages.length > 1 && (
                      <button
                        onClick={() => removeStage(idx)}
                        className="text-xs text-red-400/60 hover:text-red-400 shrink-0"
                      >
                        X
                      </button>
                    )}
                  </div>
                ))}
              </div>

              {/* Stage Preview */}
              {stages.length > 0 && (
                <div className="approval-policy-stage-preview">
                  <div className="text-[10px] text-[var(--text-dim)] mb-2">결재 흐름 미리보기</div>
                  <div className="flex items-center gap-1 flex-wrap">
                    {stages.map((stage, idx) => (
                      <div key={idx} className="flex items-center gap-1">
                        <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-[var(--primary)]/10 border border-[var(--primary)]/20">
                          <span className="text-[10px] font-bold text-[var(--primary)]">{stage.step}</span>
                          <span className="text-[10px] text-[var(--text)]">{stage.title}</span>
                          <span className="text-[9px] px-1 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)]">
                            {APPROVER_ROLES.find(r => r.value === stage.approver_role)?.label}
                          </span>
                        </div>
                        {idx < stages.length - 1 && (
                          <span className="text-[var(--text-dim)] text-xs mx-0.5">→</span>
                        )}
                      </div>
                    ))}
                    <span className="text-[var(--text-dim)] text-xs mx-0.5">→</span>
                    <div className="px-2.5 py-1.5 rounded-lg bg-green-500/10 border border-green-500/20">
                      <span className="text-[10px] text-green-500 font-semibold">완료</span>
                    </div>
                  </div>
                </div>
              )}
            </div>

            <div className="flex gap-2 pt-1">
              <button
                onClick={() => upsertMut.mutate()}
                disabled={!form.entity_type || upsertMut.isPending}
                className="btn-primary"
              >
                {upsertMut.isPending ? "저장 중..." : editId ? "수정" : "추가"}
              </button>
              <button onClick={resetForm} className="btn-ghost">
                취소
              </button>
            </div>
          </div>
        )}

        {/* Policy List */}
        {isLoading ? (
          <div className="text-center py-6 text-sm text-[var(--text-muted)]">로딩 중...</div>
        ) : policies.length === 0 ? (
          <div className="text-center py-8 text-sm text-[var(--text-muted)]">
            등록된 승인 정책이 없습니다
          </div>
        ) : (
          <div className="space-y-2">
            {policies.map((p: any) => {
              const docType = DOCUMENT_TYPES.find(t => t.value === p.entity_type);
              const roleLabel = APPROVER_ROLES.find(r => r.value === p.required_role)?.label;
              return (
                <div
                  key={p.id}
                  className="approval-policy-row"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{docType?.label || p.entity_type}</span>
                      <span className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-semibold">
                        {roleLabel || p.required_role}
                      </span>
                      {p.auto_approve && (
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-500 font-semibold">
                          자동승인
                        </span>
                      )}
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => editPolicy(p)}
                        className="text-xs text-[var(--text-muted)] hover:text-[var(--primary)] transition"
                      >
                        수정
                      </button>
                      <button
                        onClick={() => deleteMut.mutate(p.id)}
                        className="text-xs text-red-400/60 hover:text-red-400 transition"
                      >
                        삭제
                      </button>
                    </div>
                  </div>
                  <div className="flex items-center gap-3 mt-1.5 text-xs text-[var(--text-dim)]">
                    {(p.min_amount || p.max_amount) && (
                      <span>
                        금액: {p.min_amount ? `₩${Number(p.min_amount).toLocaleString()}` : "0"}
                        {" ~ "}
                        {p.max_amount ? `₩${Number(p.max_amount).toLocaleString()}` : "무제한"}
                      </span>
                    )}
                    {p.auto_approve && p.auto_approve_threshold && (
                      <span>
                        자동승인: ₩{Number(p.auto_approve_threshold).toLocaleString()} 이하
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
