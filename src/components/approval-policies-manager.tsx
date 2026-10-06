"use client";
//   결재선 관리 — 2026-10-06 결정 5(사장님 추천안 승인)로 결재 허브 탭에서 설정 › 결재 양식·결재선으로 옮기며 페이지에서 떼어 냈다.
//   본문은 approvals/page.tsx 의 PoliciesTab 그대로(로직 변경 없음).
import { typeMeta, TypeIcon } from "@/components/approval-type-icon";
import { logRead } from "@/lib/log-read";
import { appConfirm } from "@/components/global-confirm";
import { useState } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { useQuery, useMutation } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getApprovalPolicies, upsertApprovalPolicy, deleteApprovalPolicy, policyRules, REQUEST_TYPE_LABELS, type RequestType, type ApprovalPolicy, type ApprovalStageConfig, type ApprovalPolicyRule, type PolicyRuleTargetMode } from "@/lib/approval-workflow";
import { useToast } from "@/components/toast";
import { QueryBar, QuickSearch, quickSearchHit } from "@/components/query-kit";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { listApprovalForms, type ApprovalForm } from "@/lib/approval-forms";

const db = supabase;

// ══════════════════════════════════════════════
// Tab 6: 정책 관리 (Admin)
// ══════════════════════════════════════════════

// 결재선 폼에서 편집 중인 규칙 한 줄 · 저장 시 ApprovalPolicyRule 로 접힌다. (2026-08-20)
//   mode 별로 쓰는 칸이 다르지만(users→userIds, department→department, position→position)
//   모드를 오갈 때 값이 날아가지 않게 draft 는 네 칸을 다 들고 있는다.
type RuleDraft =  {
  key: string;
  mode: PolicyRuleTargetMode;
  userIds: string[];
  department: string;
  position: string;
  stages: ApprovalStageConfig[];
  referenceIds: string[];
};

let ruleKeySeq = 0;
function newRuleDraft(mode: PolicyRuleTargetMode): RuleDraft {
  return {
    key: `rule-${++ruleKeySeq}`,
    mode,
    userIds: [],
    department: "",
    position: "",
    stages: [{ stage: 1, name: "팀장 승인", approver_role: "manager" }],
    referenceIds: [],
  };
}

const RULE_MODE_LABELS: Record<PolicyRuleTargetMode, string> = {
  all: "회사 전체",
  users: "특정 직원",
  department: "팀 (부서)",
  position: "직급",
};

/** 목록 표에 적는 적용 대상 한 줄. (2026-08-20) */
function ruleTargetText(rule: ApprovalPolicyRule, orgUsers: { id: string; name: string | null; email: string }[]): string {
  const t = rule.target;
  if (t.mode === "department") return `${t.department} 팀`;
  if (t.mode === "position") return `${t.position} 직급`;
  if (t.mode === "users") {
    const names = (t.userIds || []).map((id) => { const u = orgUsers.find((x) => x.id === id); return u?.name || u?.email || "?"; });
    if (names.length === 0) return "—";
    return `${names.slice(0, 2).join("·")}${names.length > 2 ? ` 외 ${names.length - 2}명` : ""}`;
  }
  return "그 외 전체";
}

/** 폼 draft → 저장 형태. 단계 번호·이름을 여기서 정규화한다(빈 이름은 'N차 승인'). (2026-08-20) */
function draftsToRules(drafts: RuleDraft[]): ApprovalPolicyRule[] {
  return drafts.map((d) => ({
    id: d.key,
    target:
      d.mode === "users" ? { mode: "users" as const, userIds: d.userIds }
      : d.mode === "department" ? { mode: "department" as const, department: d.department.trim() }
      : d.mode === "position" ? { mode: "position" as const, position: d.position.trim() }
      : { mode: "all" as const },
    stages: d.stages.map((st, si) => ({ ...st, stage: si + 1, name: (st.name || "").trim() || `${si + 1}차 승인` })),
    reference_user_ids: d.referenceIds,
  }));
}

/** 저장 형태 → 폼 draft. '회사 전체' 규칙은 항상 마지막에 하나 있도록 보정한다. (2026-08-20) */
function rulesToDrafts(rules: ApprovalPolicyRule[]): RuleDraft[] {
  const drafts = rules.map((r) => ({
    key: `rule-${++ruleKeySeq}`,
    mode: r.target?.mode || "all",
    userIds: r.target?.userIds || [],
    department: r.target?.department || "",
    position: r.target?.position || "",
    stages: r.stages?.length ? r.stages : [{ stage: 1, name: "팀장 승인", approver_role: "manager" }],
    referenceIds: r.reference_user_ids || [],
  })) as RuleDraft[];
  const others = drafts.filter((d) => d.mode !== "all");
  const fallback = drafts.find((d) => d.mode === "all") || newRuleDraft("all");
  return [...others, fallback];
}

export function ApprovalPoliciesManager({ companyId, invalidate }: { companyId: string; invalidate: () => void }) {
  const [pq, setPq] = useState("");
  const { toast } = useToast();
  const [showForm, setShowForm] = useState(false);
  const [editingPolicy, setEditingPolicy] = useState<ApprovalPolicy | null>(null);
  const [form, setForm] = useState({
    name: "",
    documentType: "expense",
    customType: "",
    label: "",
    descriptionTemplate: "",
    autoApproveBelow: "",
    allowLineEdit: true,
    // 적용 대상별 규칙 ("적용대상을 여러개 생성하고 그 대상마다 각각의
    //   누구한테결재받나·참조를 하나의 결재선에서 관리") — 한 결재선 안에 [대상 → 단계 → 참조] N개.
    //   종전엔 대상 1묶음 + 단계 1세트 + 참조 1세트라 사람마다 결재선을 따로 만들어야 했다.
    //   맨 아래 '회사 전체' 규칙은 항상 있고 지울 수 없다(어느 규칙에도 안 걸리는 요청자의 몫).
    rules: [newRuleDraft("all")] as RuleDraft[],
  });

  const { data: policies = [], isLoading } = useQuery({
    queryKey: ["approval-policies", companyId],
    queryFn: () => getApprovalPolicies(companyId),
    enabled: !!companyId,
  });

  // 단계별 '특정 인물' 승인자 선택용 회사 구성원
  const { data: orgUsers = [] } = useQuery({
    queryKey: ["policy-org-users", companyId],
    queryFn: async () => {
      const data = logRead('approvals/page:members-role', await db.from("users").select("id, name, email, role").eq("company_id", companyId).order("name"));
      return (data || []) as { id: string; name: string | null; email: string; role: string }[];
    },
    enabled: !!companyId,
  });

  // 회사가 만든 양식 · '적용 양식' 선택지 (우리가 만든 양식도 결재선에 나오게).
  //   커스텀 양식으로 올린 요청의 request_type 은 양식 이름이므로, document_type = 양식 이름이면 자동 매칭된다.
  const  { data: companyForms = [] } = useQuery({
    queryKey: ["approval-forms-for-policies", companyId],
    queryFn: () => listApprovalForms(),
    enabled: !!companyId,
  });

  // 팀(부서) 단위 적용 대상 선택지 · employees.department 고유값 (2026-08-11)
  const  { data: departments = [] } = useQuery({
    queryKey: ["policy-departments", companyId],
    queryFn: async () => {
      const data = logRead('approvals/page:departments', await db.from("employees").select("department").eq("company_id", companyId).not("department", "is", null));
      return [...new Set((data || []).map((r: { department: string | null }) => String(r.department || "").trim()).filter(Boolean))].sort() as string[];
    },
    enabled: !!companyId,
  });

  // 직급 단위 적용 대상 선택지 — employees.position 고유값 (2026-08-20).
  //   ⚠️ users.role(마스터/멤버/파트너)이 아니라 인사기록의 직급이다 — 팀장·사원 같은 직책 개념은 여기에만 있다.
  const { data: positions = [] } = useQuery({
    queryKey: ["policy-positions", companyId],
    queryFn: async () => {
      const data = logRead('approvals/page:positions', await db.from("employees").select("position").eq("company_id", companyId).not("position", "is", null));
      return [...new Set((data || []).map((r: { position: string | null }) => String(r.position || "").trim()).filter(Boolean))].sort() as string[];
    },
    enabled: !!companyId,
  });

  const upsertMut = useMutation({
    mutationFn: () => {
      const rules = draftsToRules(form.rules);
      // 규칙을 쓰는 결재선은 정책 자체가 회사 전체에 걸리고(대상 칸 null), 누구에게 갈지는 규칙이 가른다.
      //   그래야 pickPolicyForRequester 가 이 결재선을 '회사 공통'으로 집어 규칙 매칭까지 도달한다. (2026-08-20)
      const fallback = rules.find((r) => r.target.mode === "all") || rules[0];
      return upsertApprovalPolicy({
        id: editingPolicy?.id,
        company_id: companyId,
        name: form.name,
        document_type: form.documentType === "__custom__" ? (form.customType.trim() || "custom") : form.documentType,
        label: form.label.trim() || undefined,
        description_template: form.descriptionTemplate.trim() || undefined,
        rules,
        // 아래 세 칸은 규칙을 못 읽는 옛 경로(요청 상세·PDF 등)를 위한 거울 — '회사 전체' 규칙을 복사해 둔다.
        stages: fallback.stages,
        reference_user_ids: fallback.reference_user_ids,
        auto_approve_below: Number(form.autoApproveBelow) || 0,
        allow_line_edit: form.allowLineEdit,
        requester_id: null,
        requester_ids: null,
        requester_department: null,
        is_active: true,
      });
    },
    onSuccess: () => {
      invalidate();
      resetForm();
    },
    onError: (err: any) => toast("정책 저장 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteApprovalPolicy(id),
    onSuccess: invalidate,
    onError: (err: any) => toast("정책 삭제 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  function resetForm() {
    setShowForm(false);
    setEditingPolicy(null);
    setForm({
      name: "",
      documentType: "line",
      customType: "",
      label: "",
      descriptionTemplate: "",
      autoApproveBelow: "",
      allowLineEdit: true,
      rules: [newRuleDraft("all")],
    });
  }

  function startEdit(policy: ApprovalPolicy) {
    setEditingPolicy(policy);
    const isBuiltin = policy.document_type === "default" || policy.document_type in REQUEST_TYPE_LABELS;
    setForm({
      name: policy.name,
      documentType: policy.document_type,
      customType: isBuiltin ? "" : policy.document_type,
      label: policy.label || "",
      descriptionTemplate: policy.description_template || "",
      autoApproveBelow: policy.auto_approve_below ? String(policy.auto_approve_below) : "",
      allowLineEdit: policy.allow_line_edit !== false,
      // 개편 전 결재선은 policyRules() 가 기존 대상·단계·참조를 규칙 1개로 돌려준다 — 열면 그대로 보인다.
      rules: rulesToDrafts(policyRules(policy)),
    });
    setShowForm(true);
  }

  // ── 규칙(적용 대상 묶음) 조작 ───────────────────────────────
  function patchRule(idx: number, patch: Partial<RuleDraft>) {
    setForm((st) => ({ ...st, rules: st.rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)) }));
  }
  function addRule() {
    // 새 규칙은 '회사 전체'(맨 아래 기본 규칙) 바로 앞에 끼워 넣는다 — 기본 규칙은 항상 마지막.
    setForm((st) => ({ ...st, rules: [...st.rules.slice(0, -1), newRuleDraft("users"), st.rules[st.rules.length - 1]] }));
  }
  function removeRule(idx: number) {
    setForm((st) => (st.rules[idx]?.mode === "all" ? st : { ...st, rules: st.rules.filter((_, i) => i !== idx) }));
  }

  // ── 규칙 안의 결재 단계 조작 ─────────────────────────────────
  //   단계 수를 고르면 그 수에 맞춰 늘리고 줄인다 ("몇 단계인지 설정하고 누구한테")
  function setStageCount(ruleIdx: number, n: number) {
    const cur = form.rules[ruleIdx].stages;
    const next = Array.from({ length: n }, (_, i) => cur[i] || { stage: i + 1, name: `${i + 1}차 승인`, approver_role: "manager" } as ApprovalStageConfig).map((st, i) => ({ ...st, stage: i + 1 }));
    patchRule(ruleIdx, { stages: next });
  }

  function updateStage(ruleIdx: number, idx: number, patch: Partial<ApprovalStageConfig>) {
    patchRule(ruleIdx, { stages: form.rules[ruleIdx].stages.map((st, i) => (i === idx ? { ...st, ...patch } : st)) });
  }

  function toggleRuleUser(ruleIdx: number, userId: string) {
    const cur = form.rules[ruleIdx].userIds;
    patchRule(ruleIdx, { userIds: cur.includes(userId) ? cur.filter((id) => id !== userId) : [...cur, userId] });
  }

  function toggleRuleReference(ruleIdx: number, userId: string) {
    const cur = form.rules[ruleIdx].referenceIds;
    patchRule(ruleIdx, { referenceIds: cur.includes(userId) ? cur.filter((id) => id !== userId) : [...cur, userId] });
  }

  useModalKeys(showForm, () => { if (!upsertMut.isPending) resetForm(); });

  // 대상을 안 고른 규칙은 저장해도 아무에게도 안 걸린다 — 조용히 새지 않게 저장을 막고 이유를 적는다. (2026-08-20)
  const ruleError = (() => {
    for (const r of form.rules) {
      if (r.mode === "users" && r.userIds.length === 0) return "'특정 직원' 적용 대상에 직원을 한 명 이상 고르세요.";
      if (r.mode === "department" && !r.department.trim()) return "'팀 (부서)' 적용 대상에 부서를 고르세요.";
      if (r.mode === "position" && !r.position.trim()) return "'직급' 적용 대상에 직급을 고르세요.";
    }
    return "";
  })();

  const ROLE_OPTIONS = [
    { value: "manager", label: "팀장" },
    { value: "director", label: "이사" },
    { value: "ceo", label: "대표" },
    { value: "admin", label: "관리자" },
    { value: "owner", label: "소유자" },
    { value: "finance", label: "재무" },
  ];

  if (isLoading) {
    return <div className="text-center py-12 text-[var(--text-muted)]">로딩 중...</div>;
  }

  //   2026-08-18 조회 표준 — 카드 격자 → 조회 줄(빠른검색 ‖ + 정책 추가) + 표(공용 머리단)
  const visiblePolicies = (policies as ApprovalPolicy[]).filter((p) => quickSearchHit(pq, [p.name, p.label, p.document_type === "line" ? "결재선" : REQUEST_TYPE_LABELS[p.document_type as RequestType] || p.document_type]));
  const approverLabel = (st: ApprovalStageConfig) => (st as any).approver_id
    ? ((st as any).approver_name || orgUsers.find((u) => u.id === (st as any).approver_id)?.name || "구성원")
    : (ROLE_OPTIONS.find((r) => r.value === st.approver_role)?.label || st.approver_role || "");

  return (
    <div className="ap-list">
      <QueryBar right={<button onClick={() => { resetForm(); setShowForm(true); }} className="btn-primary btn-sm whitespace-nowrap">+ 결재선 추가</button>}>
        <QuickSearch value={pq} onApply={setPq} placeholder="결재선 이름 · 쉼표로 여러 개, Enter" />
        <span className="text-[11px] text-[var(--text-dim)]">결재선을 만들어 양식에 붙여 씁니다.</span>
      </QueryBar>

      {/* 결재선 폼 — 이름 · 단계 수 · 단계별 승인자 · 참조 · (선택) 적용 대상 (유형·자동승인·설명 템플릿 제거) */}
      {/* 결재선 폼은 팝업 — 목록 줄이 밀리지 않게 */}
      {showForm && (
        <div className="approval-detail-modal" onClick={() => !upsertMut.isPending && resetForm()}>
        <div className="approval-policy-form ap-pol-modal" onClick={(e) => e.stopPropagation()}>
          <div className="ap-pol-head">
            <h3 className="section-title">{editingPolicy ? "결재선 수정" : "새 결재선"}</h3>
          </div>

          <div className="ap-pol-grid">
            <div>
              <label className="field-label">결재선 이름 *</label>
              <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 팀장 → 대표 2단계" className="field-input" />
            </div>
            {/* 적용 양식 — 유형을 고르면 그 유형의 새 요청에 자동 적용된다.
                종전엔 이 칸이 없어 새 결재선이 전부 '공용'으로 만들어졌고, 부서 대상 결재선이
                휴가신청에 자동 적용되지 않는 사고(전략운영팀 휴가)가 났다. */}
            <div>
              <label className="field-label">적용 양식</label>
              <select value={form.documentType} onChange={(e) => setForm({ ...form, documentType: e.target.value })} className="field-input">
                <option value="line">공용 · 양식 관리에서 불러와 사용</option>
                <optgroup label="기본 양식">
                  {Object.entries(REQUEST_TYPE_LABELS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                </optgroup>
                {(companyForms as ApprovalForm[]).length > 0 && (
                  <optgroup label="회사 양식">
                    {(companyForms as ApprovalForm[]).map((f) => <option key={f.id} value={f.name}>{f.name}</option>)}
                  </optgroup>
                )}
                {form.documentType === "default" && <option value="default">기본(공통)</option>}
                {/* 삭제(비활성)된 양식 이름으로 남은 정책 — 옵션이 없으면 셀렉트가 빈 값으로 보인다 */}
                {form.documentType !== "line" && form.documentType !== "default"
                  && !(form.documentType in REQUEST_TYPE_LABELS)
                  && !(companyForms as ApprovalForm[]).some((f) => f.name === form.documentType) && (
                  <option value={form.documentType}>{form.documentType} (삭제된 양식)</option>
                )}
              </select>
            </div>
          </div>
          <p className="mt-1.5 text-[10px] text-[var(--text-dim)]">
            {form.documentType === "line"
              ? "공용 결재선은 양식에 붙일 때만 쓰입니다."
              : "선택한 양식의 새 요청에 자동 적용됩니다."}
          </p>

          {/* 적용 대상별 규칙 — [대상 → 누구에게 결재받나 → 참조] 묶음을 필요한 만큼 */}
          <div className="ap-pol-rules">
            <div className="ap-pol-rules-head">
              <label className="field-label">적용 대상별 결재선</label>
              <button type="button" onClick={addRule} className="btn-secondary btn-sm">+ 적용 대상 추가</button>
            </div>
            <p className="ap-pol-rules-hint">
              
              위에서부터 먼저 맞는 대상이 적용됩니다.

            </p>

            <div className="ap-pol-rule-list">
            {form.rules.map((rule, ruleIdx) => (
              <div key={rule.key} className={`ap-pol-rule ${rule.mode === "all" ? "ap-pol-rule-fallback" : ""}`}>
                <div className="ap-pol-rule-head">
                  {rule.mode === "all" ? (
                    <span className="ap-pol-rule-title">그 외 전체 (기본)</span>
                  ) : (
                    <select value={rule.mode}
                      onChange={(e) => patchRule(ruleIdx, { mode: e.target.value as PolicyRuleTargetMode })}
                      className="field-input ap-pol-rule-mode">
                      {(["users", "department", "position"] as PolicyRuleTargetMode[]).map((m) => (
                        <option key={m} value={m}>{RULE_MODE_LABELS[m]}</option>
                      ))}
                    </select>
                  )}
                  {rule.mode !== "all" && (
                    <button type="button" onClick={() => removeRule(ruleIdx)} className="ap-pol-rule-del" aria-label="이 적용 대상 삭제">&#10005;</button>
                  )}
                </div>

                {/* 대상 지정 — 모드별로 칸이 다르다 */}
                {rule.mode === "users" && (
                  <div className="policy-target-people">
                    {orgUsers.map((u) => (
                      <button key={u.id} type="button" onClick={() => toggleRuleUser(ruleIdx, u.id)}
                        className={`policy-target-chip ${rule.userIds.includes(u.id) ? "policy-target-chip-on" : ""}`}>{u.name || u.email}</button>
                    ))}
                  </div>
                )}
                {rule.mode === "department" && (
                  departments.length > 0 ? (
                    <select value={rule.department} onChange={(e) => patchRule(ruleIdx, { department: e.target.value })} className="field-input ap-pol-rule-pick">
                      <option value="">부서 선택</option>
                      {departments.map((d) => <option key={d} value={d}>{d}</option>)}
                    </select>
                  ) : (
                    <p className="ap-pol-rule-warn">아직 등록된 부서가 없습니다. 구성원에서 부서를 먼저 입력하세요.</p>
                  )
                )}
                {rule.mode === "position" && (
                  positions.length > 0 ? (
                    <select value={rule.position} onChange={(e) => patchRule(ruleIdx, { position: e.target.value })} className="field-input ap-pol-rule-pick">
                      <option value="">직급 선택</option>
                      {positions.map((p) => <option key={p} value={p}>{p}</option>)}
                    </select>
                  ) : (
                    <p className="ap-pol-rule-warn">아직 등록된 직급이 없습니다. 구성원에서 직급을 먼저 입력하세요.</p>
                  )
                )}

                {/* 이 대상의 결재 단계 — 한 줄에 [N차] 단계 이름 · 누구에게(역할 또는 구성원) */}
                <div className="ap-pol-stages">
                  <div className="ap-pol-stages-head">
                    <label className="field-label">누구에게 결재받나</label>
                    <select value={rule.stages.length} onChange={(e) => setStageCount(ruleIdx, Number(e.target.value))} className="field-input ap-pol-stage-count">
                      {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}단계</option>)}
                    </select>
                  </div>
                  {rule.stages.map((stage, idx) => (
                    <div key={idx} className="ap-pol-stage">
                      <span className="ap-pol-stage-no">{stage.stage}차</span>
                      <input value={stage.name} onChange={(e) => updateStage(ruleIdx, idx, { name: e.target.value })} placeholder={`${stage.stage}차 승인`} className="field-input ap-pol-stage-name" />
                      <select
                        value={stage.approver_id ? `u:${stage.approver_id}` : `r:${stage.approver_role || "manager"}`}
                        onChange={(e) => {
                          const v = e.target.value;
                          if (v.startsWith("u:")) {
                            const u = orgUsers.find((x) => x.id === v.slice(2));
                            updateStage(ruleIdx, idx, { approver_id: v.slice(2), approver_name: u?.name || u?.email || "" });
                          } else {
                            updateStage(ruleIdx, idx, { approver_id: undefined, approver_name: undefined, approver_role: v.slice(2) });
                          }
                        }}
                        className="field-input ap-pol-stage-who">
                        <optgroup label="역할로">
                          {ROLE_OPTIONS.map((r) => <option key={r.value} value={`r:${r.value}`}>{r.label}</option>)}
                        </optgroup>
                        <optgroup label="특정 구성원">
                          {orgUsers.map((u) => <option key={u.id} value={`u:${u.id}`}>{u.name || u.email}</option>)}
                        </optgroup>
                      </select>
                    </div>
                  ))}
                </div>

                {/* 이 대상의 참조 — 결재선과 별개로 결과를 통보받는 사람 */}
                <div className="ap-pol-rule-refs">
                  <label className="field-label">참조 <span className="text-[var(--text-dim)] font-normal">(선택 · 여러 명)</span></label>
                  <div className="policy-target-people">
                    {orgUsers.map((u) => (
                      <button key={u.id} type="button" onClick={() => toggleRuleReference(ruleIdx, u.id)}
                        className={`policy-target-chip ${rule.referenceIds.includes(u.id) ? "policy-target-chip-on" : ""}`}>{u.name || u.email}</button>
                    ))}
                  </div>
                </div>
              </div>
            ))}
            </div>
          </div>

          {ruleError && <p className="ap-pol-rule-warn mt-3">{ruleError}</p>}
          <div className="flex gap-2 mt-4">
            <button
              onClick={() => (form.name || "").trim() && !ruleError && upsertMut.mutate()}
              disabled={!(form.name || "").trim() || !!ruleError || upsertMut.isPending}
              className="btn-primary btn-sm disabled:opacity-50">
              {upsertMut.isPending ? "저장 중..." : editingPolicy ? "수정" : "저장"}
            </button>
            <button onClick={resetForm} className="btn-secondary btn-sm">취소</button>
          </div>
        </div>
        </div>
      )}

      {/* Policy List — 표 (2026-08-18) */}
      {policies.length === 0 && !showForm ? (
        <div className="ap-empty">
          <div className="mx-auto w-16 h-16 mb-4 rounded-2xl bg-[var(--primary-light)] text-[var(--primary)] flex items-center justify-center">
            <svg className="w-8 h-8" fill="none" stroke="currentColor" strokeWidth={1.6} viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round"><circle cx="6" cy="19" r="3"/><circle cx="18" cy="5" r="3"/><path d="M12 19h4.5a3.5 3.5 0 000-7h-9a3.5 3.5 0 010-7H12"/></svg>
          </div>
          <div className="text-base font-bold mb-1.5">아직 결재선이 없습니다.</div>
          <div className="text-sm text-[var(--text-muted)]"><b>+ 결재선 추가</b>로 첫 결재선을 만들어 보세요.</div>
        </div>
      ) : (
        <div className="ev-scroll">
          <table className="ev-table ev-lined ap-policy-table">
            <thead><tr><th>결재선</th><th>단계 · 승인자</th><th>참조</th><th>적용 대상</th><th>상태</th><th>관리</th></tr></thead>
            <tbody>
              {/* 결재선 한 줄이 아니라 '적용 대상 한 줄' — 이름·상태·관리는 rowSpan 으로 묶는다. (2026-08-20) */}
              {visiblePolicies.flatMap((policy: ApprovalPolicy) => {
                const m = typeMeta(policy.document_type);
                const rules = policyRules(policy);
                return rules.map((rule, ruleIdx) => (
                  <tr key={`${policy.id}-${rule.id}`}>
                    {ruleIdx === 0 && (
                      <td className="text-left" rowSpan={rules.length}>
                        <span className="inline-flex items-center gap-2">
                          <span className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${m.bg} ${m.text}`}><TypeIcon name={policy.document_type === "line" ? "route" : m.icon} className="w-3.5 h-3.5" /></span>
                          <span className="min-w-0">
                            <span className="block font-semibold">{policy.name}</span>
                            {policy.document_type !== "line" && <span className="block text-[10px] text-[var(--text-dim)]">{REQUEST_TYPE_LABELS[policy.document_type as RequestType] || policy.document_type} 유형에 자동 적용</span>}
                            {rules.length > 1 && <span className="block text-[10px] text-[var(--text-dim)]">적용 대상 {rules.length}개</span>}
                          </span>
                        </span>
                      </td>
                    )}
                    <td className="text-left">
                      <span className="inline-flex items-center gap-1 flex-wrap">
                        {rule.stages.map((stage, idx) => (
                          <span key={idx} className="inline-flex items-center gap-1">
                            <span className="ap-stage-pill" title={stage.name}><b>{stage.stage}</b>{approverLabel(stage)}</span>
                            {idx < rule.stages.length - 1 && <span className="text-[var(--text-dim)]">›</span>}
                          </span>
                        ))}
                      </span>
                    </td>
                    <td className="text-center text-[var(--text-muted)]">
                      {rule.reference_user_ids.length > 0
                        ? rule.reference_user_ids.map((id) => { const u = orgUsers.find((x) => x.id === id); return u?.name || u?.email || "?"; }).join(", ")
                        : "—"}
                    </td>
                    <td className="text-center text-[var(--text-muted)]">{ruleTargetText(rule, orgUsers)}</td>
                    {ruleIdx === 0 && (
                      <td className="text-center" rowSpan={rules.length}>
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${policy.is_active ? "bg-[var(--success-dim)] text-[var(--success)]" : "bg-[var(--bg-surface)] text-[var(--text-dim)]"}`}>
                          {policy.is_active ? "활성" : "비활성"}
                        </span>
                      </td>
                    )}
                    {ruleIdx === 0 && (
                      <td className="text-center" rowSpan={rules.length}>
                        <span className="inline-flex gap-1">
                          <button onClick={() => startEdit(policy)} className="btn-secondary btn-sm">수정</button>
                          <button onClick={async () => { if (await appConfirm("이 정책을 삭제하시겠습니까?", { danger: true })) deleteMut.mutate(policy.id); }} disabled={deleteMut.isPending} className="btn-secondary btn-sm text-[var(--danger)] disabled:opacity-50">삭제</button>
                        </span>
                      </td>
                    )}
                  </tr>
                ));
              })}
              {visiblePolicies.length === 0 && <tr><td colSpan={6} className="ap-empty text-xs text-[var(--text-muted)]">조건에 맞는 정책이 없습니다.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

