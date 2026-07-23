"use client";
import { kstDateStr } from "@/lib/kst";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

import { useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/friendly-error";
import { useToast } from "@/components/toast";
import { CONTRACT_TYPES } from "@/lib/hr";
import { getContractPackages, sendContractPackage, getContractTemplates, cancelContractPackage, PACKAGE_STATUS } from "@/lib/hr-contracts";
import type { RichEditorRef } from "@/components/rich-editor";

const RichEditor = dynamic(() => import("@/components/rich-editor").then(m => ({ default: m.RichEditor })), { ssr: false, loading: () => <div className="h-48 bg-[var(--bg-surface)] rounded-xl animate-pulse" /> });

// ── 계약서/서약서 템플릿 편집 + 회사 문서 + 발송 현황 — 구성원 상세패널의 "+ 계약서 보내기"로
//   개별 발송이 이관된 뒤, 회사 전체 관점(서식 관리·회사 문서·발송 현황/일괄발송)만 여기 남음.
//   (2026-07-15 employees/_components/ContractTab.tsx 에서 이관)
export function ContractAdminPanel({ companyId, contracts }: { companyId: string; contracts: any[] }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchSending, setBatchSending] = useState(false);
  const [sealApplying, setSealApplying] = useState<string | null>(null);
  const [contractSubTab, setContractSubTab] = useState<"contracts" | "company_docs">("contracts");
  // 서식 편집은 [서식] 탭으로 이관(2026-07-23). 여는 진입점(헤더 버튼·편집 클릭)을 제거해 항상 false → 아래 에디터 블록 미렌더.
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateBody, setNewTemplateBody] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [customVariables, setCustomVariables] = useState<{ v: string; desc: string }[]>([]);
  const [newVarName, setNewVarName] = useState("");
  const [newVarDesc, setNewVarDesc] = useState("");
  const editorRef = useRef<RichEditorRef>(null);

  function startEditTemplate(t: any) {
    setEditingTemplateId(t.is_builtin ? null : t.id); // 내장은 신규 저장으로 떨어짐 (복제 편집)
    setNewTemplateName(t.is_builtin ? `${t.name} (복사본)` : t.name);
    const body = typeof t.content_json === 'object' && t.content_json
      ? (t.content_json.body || JSON.stringify(t.content_json))
      : (t.body || '');
    setNewTemplateBody(String(body));
    setTimeout(() => editorRef.current?.setContent(String(body)), 50);
  }

  async function deleteTemplate(id: string) {
    if (!(await appConfirm("이 서식을 삭제하시겠습니까? 발송된 계약서엔 영향 없음.", { danger: true }))) return;
    try {
      await supabase.from("doc_templates").update({ is_active: false }).eq("id", id);
      queryClient.invalidateQueries({ queryKey: ["contract-templates"] });
      queryClient.invalidateQueries({ queryKey: ["contract-templates-all"] });
      toast("서식이 삭제되었습니다.", "success");
    } catch (err: any) {
      toast("삭제 실패: " + (err.message || ""), "error");
    }
  }

  // 계약 내역
  const { data: contractList = [] } = useQuery({
    queryKey: ["contract-packages", companyId],
    queryFn: () => getContractPackages(companyId!),
    enabled: !!companyId,
  });

  // 계약서 서식 (활성만)
  const { data: templates = [] } = useQuery({
    queryKey: ["contract-templates", companyId],
    queryFn: () => getContractTemplates(companyId!),
    enabled: !!companyId,
  });

  // 모든 서식 (임시저장 포함 — 에디터 목록용)
  const { data: allTemplates = [] } = useQuery({
    queryKey: ["contract-templates-all", companyId],
    queryFn: async () => {
      const data = logRead('_components/ContractAdminPanel:data', await supabase
        .from("doc_templates")
        .select("*")
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .order("name"));
      return data || [];
    },
    enabled: !!companyId,
  });

  // 서명 요청 발송/재발송
  async function handleSendSignRequest(contractId: string) {
    setSending(contractId);
    try {
      const result = await sendContractPackage(contractId);
      if (!result.success) {
        const msg = result.error || "알 수 없는 오류";
        console.error('[handleSendSignRequest] 실패:', msg);
        if (/RESEND_API_KEY/i.test(msg)) {
          toast("Supabase secrets 에 RESEND_API_KEY 미등록 — Edge Function Secrets 페이지에서 등록하세요.", "error");
        } else if (/verify|verif|domain|not\s*verified/i.test(msg)) {
          toast("Resend 도메인 인증 필요 — owner-view.com 을 Resend dashboard 에서 verify 후 재시도.", "error");
        } else if (/invalid.*api.*key|unauthor/i.test(msg)) {
          toast("Resend API 키 오류 — Supabase secrets 의 RESEND_API_KEY 값 확인 필요.", "error");
        } else {
          toast("발송 실패: " + msg.slice(0, 200), "error");
        }
      } else {
        const channels: string[] = [];
        if ((result as any).inAppDelivered) channels.push("OwnerView 알림");
        if ((result as any).emailSent) channels.push("이메일");
        toast(channels.length > 0 ? `서명 요청 발송 완료 (${channels.join(" + ")})` : "서명 요청 발송 완료", "success");
      }
      queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
    } catch (err: any) {
      console.error('[handleSendSignRequest] catch:', err);
      toast("발송 실패: " + (friendlyError(err, "오류")).slice(0, 200), "error");
    } finally {
      setSending(null);
    }
  }

  // 계약 취소
  const cancelContract = useMutation({
    mutationFn: cancelContractPackage,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["contract-packages"] }),
    onError: (err: any) => toast("계약 취소 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // 일괄 발송
  async function handleBatchSend() {
    const draftIds = Array.from(selectedIds).filter(id =>
      contractList.find((c: any) => c.id === id && c.status === "draft")
    );
    if (draftIds.length === 0) return;
    setBatchSending(true);
    for (const id of draftIds) {
      try {
        await sendContractPackage(id);
      } catch (_) { /* skip failures */ }
    }
    queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
    setSelectedIds(new Set());
    setBatchSending(false);
  }

  function toggleSelect(id: string) {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  // 직인 적용 핸들러 — 패키지 단위로 적용 (notes JSON 에 seal_applied 표시 + 회사 seal_url 스냅샷)
  async function handleApplySeal(contractId: string) {
    if (!companyId) return;
    setSealApplying(contractId);
    try {
      const company = logRead('_components/ContractAdminPanel:company', await supabase
        .from("companies").select("seal_url, name").eq("id", companyId).maybeSingle());
      if (!company?.seal_url) {
        toast("직인 이미지가 등록돼 있지 않습니다. 회사 설정에서 먼저 등록하세요.", "error");
        setSealApplying(null);
        return;
      }
      const pkg = logRead('_components/ContractAdminPanel:pkg', await supabase
        .from("hr_contract_packages").select("notes").eq("id", contractId).maybeSingle());
      let notesObj: Record<string, any> = {};
      if (pkg?.notes) {
        try {
          const parsed = JSON.parse(pkg.notes);
          if (typeof parsed === 'object' && parsed && !Array.isArray(parsed)) notesObj = parsed;
        } catch { /* keep empty */ }
      }
      notesObj.seal_applied_at = new Date().toISOString();
      notesObj.seal_url = company.seal_url;
      notesObj.seal_company_name = company.name || '';
      await supabase
        .from("hr_contract_packages")
        .update({ notes: JSON.stringify(notesObj) })
        .eq("id", contractId);
      queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
      toast("직인이 적용되었습니다 (서명본/PDF에 반영됨)", "success");
    } catch (err: any) {
      toast("직인 적용 실패: " + (friendlyError(err, "알 수 없는 오류")), "error");
    } finally {
      setSealApplying(null);
    }
  }

  // 상태 필터링
  const filteredContracts = statusFilter === "all"
    ? contractList
    : contractList.filter((c: any) => c.status === statusFilter);

  // 상태별 카운트
  const statusCounts = {
    all: contractList.length,
    draft: contractList.filter((c: any) => c.status === "draft").length,
    sent: contractList.filter((c: any) => c.status === "sent" || c.status === "partially_signed").length,
    completed: contractList.filter((c: any) => c.status === "completed").length,
    cancelled: contractList.filter((c: any) => c.status === "cancelled").length,
  };

  return (
    <div>
      {/* 상단 헤더 */}
      <div className="contract-admin-header flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h3 className="text-base font-bold text-[var(--text)]">계약 발송 현황</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">발송된 계약의 서명 현황을 확인하고 일괄 발송합니다. <b className="text-[var(--text)]">서식 만들기·편집은 위 [서식] 탭</b>에서, 개별 직원 발송은 구성원 상세 › 근로계약에서 하세요.</p>
        </div>
      </div>

      {/* 서식 에디터는 [서식] 탭으로 이관(2026-07-23) — 중복 제거. showTemplateEditor 는 항상 false(진입점 제거). */}
      {showTemplateEditor && (
        <div className="contract-template-editor glass-card mb-6 flex flex-col h-[80vh]">
          <div className="p-6 pb-3 shrink-0">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm font-bold text-[var(--primary)] flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                  계약서식 에디터
                </h4>
                <p className="text-[10px] text-[var(--text-dim)] mt-0.5">서식을 작성하고 저장하면 계약 요청 시 사용할 수 있습니다. {"{{직원명}}, {{부서}}, {{직위}}, {{연봉}}"} 등의 변수를 사용하세요.</p>
              </div>
              <button onClick={() => setShowTemplateEditor(false)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">닫기</button>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">서식 이름 *</label>
              <input value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} placeholder="예: 2026년 정규직 근로계약서" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
          </div>
          <div className="contract-template-editor-body flex-1 flex gap-4 px-6 min-h-0">
            <div className="flex-1 flex flex-col min-h-0">
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 shrink-0">서식 내용 *</label>
              <RichEditor ref={editorRef} content={newTemplateBody} onChange={setNewTemplateBody} placeholder="계약서 내용을 입력하세요... {{직원명}}, {{부서}} 등의 변수를 사용할 수 있습니다." maxHeight="calc(80vh - 220px)" />
            </div>
            <div className="contract-template-variable-panel w-52 shrink-0 flex flex-col min-h-0">
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 shrink-0">변수 삽입</label>
              <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-3 flex-1 overflow-y-auto flex flex-col gap-1.5">
                <p className="text-[9px] text-[var(--text-dim)] mb-1 shrink-0">클릭하면 커서 위치에 삽입됩니다</p>
                {[
                  { v: "{{직원명}}", desc: "직원 이름" },
                  { v: "{{부서}}", desc: "소속 부서" },
                  { v: "{{직위}}", desc: "직급/직위" },
                  { v: "{{연봉}}", desc: "연봉 금액" },
                  { v: "{{입사일}}", desc: "입사 일자" },
                  { v: "{{회사명}}", desc: "회사 이름" },
                  { v: "{{대표자}}", desc: "대표자명" },
                  { v: "{{계약시작일}}", desc: "계약 시작일" },
                  { v: "{{계약종료일}}", desc: "계약 종료일" },
                  { v: "{{근무시간}}", desc: "근무 시간" },
                ].map(({ v, desc }) => (
                  <button key={v} type="button" onClick={() => editorRef.current?.insertText(v)}
                    className="w-full text-left px-2.5 py-2 rounded-lg bg-[var(--primary-light)] hover:brightness-95 transition group shrink-0">
                    <div className="text-xs font-mono font-semibold text-[var(--primary)]">{v}</div>
                    <div className="text-[9px] text-[var(--text-dim)]">{desc}</div>
                  </button>
                ))}
                {customVariables.length > 0 && (
                  <div className="border-t border-[var(--border)] my-1 pt-2 shrink-0">
                    <p className="text-[9px] font-semibold text-[var(--text-dim)] uppercase mb-1">사용자 추가</p>
                  </div>
                )}
                {customVariables.map((cv, i) => (
                  <div key={cv.v + i} className="flex items-stretch gap-1 shrink-0">
                    <button type="button" onClick={() => editorRef.current?.insertText(cv.v)}
                      className="flex-1 text-left px-2.5 py-2 rounded-lg bg-amber-500/5 hover:bg-amber-500/15 transition group">
                      <div className="text-xs font-mono font-semibold text-amber-600 group-hover:text-amber-500">{cv.v}</div>
                      <div className="text-[9px] text-[var(--text-dim)]">{cv.desc}</div>
                    </button>
                    <button type="button" onClick={() => setCustomVariables(prev => prev.filter((_, idx) => idx !== i))}
                      className="px-1.5 text-[var(--text-dim)] hover:text-red-500 transition text-xs">×</button>
                  </div>
                ))}
                <div className="border-t border-[var(--border)] mt-2 pt-2 shrink-0">
                  <p className="text-[9px] font-semibold text-[var(--text-dim)] uppercase mb-1.5">+ 새 변수 추가</p>
                  <input
                    value={newVarName}
                    onChange={(e) => setNewVarName(e.target.value.replace(/[{}]/g, ""))}
                    placeholder="예: 직책수당"
                    className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-md text-[10px] mb-1 focus:outline-none focus:border-amber-500"
                  />
                  <input
                    value={newVarDesc}
                    onChange={(e) => setNewVarDesc(e.target.value)}
                    placeholder="설명 (선택)"
                    className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-md text-[10px] mb-1 focus:outline-none focus:border-amber-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const name = newVarName.trim();
                      if (!name) return;
                      const formatted = `{{${name}}}`;
                      if (customVariables.some(cv => cv.v === formatted)) {
                        toast("이미 추가된 변수입니다.", "error");
                        return;
                      }
                      setCustomVariables(prev => [...prev, { v: formatted, desc: newVarDesc.trim() || name }]);
                      setNewVarName("");
                      setNewVarDesc("");
                    }}
                    disabled={!newVarName.trim()}
                    className="w-full px-2 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 text-amber-600 rounded-md text-[10px] font-semibold transition disabled:opacity-50"
                  >
                    + 추가
                  </button>
                </div>
              </div>
            </div>
          </div>
          {(allTemplates.length > 0 || templates.some((t: any) => t.is_builtin)) && (
            <div className="contract-template-existing-list px-6 pb-3 shrink-0">
              <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase tracking-wider mb-2">기존 서식</div>
              <div className="flex flex-wrap gap-2 max-h-24 overflow-y-auto">
                {[
                  ...templates.filter((t: any) => t.is_builtin),
                  ...allTemplates,
                ].map((t: any) => (
                  <div key={t.id} className={`flex items-center gap-1 border rounded-lg px-2 py-1 ${
                    t.is_active === false
                      ? 'bg-amber-500/5 border-amber-500/30'
                      : 'bg-[var(--bg-surface)] border-[var(--border)]'
                  }`}>
                    <button onClick={() => startEditTemplate(t)} className="text-xs text-[var(--text)] hover:text-[var(--primary)] transition" title={t.is_builtin ? "내장 서식 — 복제 후 편집" : t.is_active === false ? "임시저장" : "수정"}>
                      {t.is_builtin && <span className="text-[9px] text-amber-500 mr-1">🔒</span>}
                      {t.is_active === false && <span className="text-[9px] text-amber-500 mr-1">📝</span>}
                      {t.name}
                    </button>
                    {!t.is_builtin && (
                      <button onClick={() => deleteTemplate(t.id)} className="text-xs text-red-400 hover:text-red-500 px-1" title="삭제">×</button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[var(--text-dim)] mt-1">🔒 내장 · 📝 임시저장 · 클릭하면 에디터에 로드</p>
            </div>
          )}
          <div className="contract-template-editor-footer shrink-0 border-t border-[var(--border)] px-6 py-4 flex items-center gap-3 bg-[var(--bg-card)] rounded-b-2xl">
            <button
              onClick={() => { setShowTemplateEditor(false); setNewTemplateName(""); setNewTemplateBody(""); setEditingTemplateId(null); }}
              className="px-4 py-2.5 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-xl text-sm font-semibold transition"
            >
              취소
            </button>
            <button
              onClick={async () => {
                if (!newTemplateName.trim() || !companyId) return;
                setSavingTemplate(true);
                try {
                  const variables = Array.from(new Set((newTemplateBody.match(/\{\{[^}]+\}\}/g) || []).map((v: string) => v.replace(/[{}]/g, ""))));
                  if (editingTemplateId) {
                    const { error } = await supabase.from("doc_templates").update({
                      name: `[임시] ${newTemplateName.trim().replace(/^\[임시\]\s*/, '')}`,
                      content_json: { body: newTemplateBody || '' },
                      variables,
                      is_active: false,
                    }).eq("id", editingTemplateId);
                    if (error) throw error;
                  } else {
                    const { data: ins, error } = await supabase.from("doc_templates").insert({
                      company_id: companyId,
                      name: `[임시] ${newTemplateName.trim()}`,
                      type: "hr_contract",
                      content_json: { body: newTemplateBody || '' },
                      variables,
                      category: "comprehensive_labor",
                      is_active: false,
                      is_custom: true,
                    }).select('id').maybeSingle();
                    if (error) throw error;
                    if (ins?.id) setEditingTemplateId(ins.id);
                  }
                  queryClient.invalidateQueries({ queryKey: ["contract-templates"] });
                  queryClient.invalidateQueries({ queryKey: ["contract-templates-all"] });
                  toast("임시 저장되었습니다.", "success");
                } catch (err: any) {
                  const msg = err?.message || err?.details || err?.code || JSON.stringify(err).slice(0, 200);
                  toast("임시 저장 실패: " + msg, "error");
                  console.error('[임시저장] error:', err);
                }
                setSavingTemplate(false);
              }}
              disabled={!newTemplateName.trim() || savingTemplate}
              className="px-4 py-2.5 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--primary)] hover:border-[var(--primary)] rounded-xl text-sm font-semibold disabled:opacity-50 transition"
            >
              임시저장
            </button>
            <button
              onClick={async () => {
                if (!newTemplateName.trim() || !newTemplateBody.trim() || !companyId) return;
                setSavingTemplate(true);
                try {
                  const variables = Array.from(new Set((newTemplateBody.match(/\{\{[^}]+\}\}/g) || []).map((v: string) => v.replace(/[{}]/g, ""))));
                  if (editingTemplateId) {
                    const { error } = await supabase.from("doc_templates").update({
                      name: newTemplateName.trim().replace(/^\[임시\]\s*/, ''),
                      content_json: { body: newTemplateBody },
                      variables,
                      is_active: true,
                    }).eq("id", editingTemplateId);
                    if (error) throw error;
                    toast("서식이 수정되었습니다.", "success");
                  } else {
                    const { error } = await supabase.from("doc_templates").insert({
                      company_id: companyId,
                      name: newTemplateName.trim(),
                      type: "hr_contract",
                      content_json: { body: newTemplateBody },
                      variables,
                      category: "comprehensive_labor",
                      is_active: true,
                      is_custom: true,
                    });
                    if (error) throw error;
                    toast("서식이 저장되었습니다.", "success");
                  }
                  queryClient.invalidateQueries({ queryKey: ["contract-templates"] });
                  queryClient.invalidateQueries({ queryKey: ["contract-templates-all"] });
                  setNewTemplateName("");
                  setNewTemplateBody("");
                  setEditingTemplateId(null);
                  setCustomVariables([]);
                  setShowTemplateEditor(false);
                } catch (err: any) {
                  const msg = err?.message || err?.details || err?.code || JSON.stringify(err).slice(0, 200);
                  toast("저장 실패: " + msg, "error");
                  console.error('[서식 저장] error:', err);
                }
                setSavingTemplate(false);
              }}
              disabled={!newTemplateName.trim() || !newTemplateBody.trim() || savingTemplate}
              className="btn-primary"
            >
              {savingTemplate ? "저장 중..." : editingTemplateId ? "수정 저장" : "서식 저장"}
            </button>
          </div>
        </div>
      )}

      {/* 서브탭: 계약 관리 / 회사 문서 */}
      <div className="contract-subtab-bar flex gap-1 mb-5 bg-[var(--bg-surface)] rounded-lg p-0.5 w-fit">
        <button onClick={() => setContractSubTab("contracts")} className={`px-4 py-2 rounded-md text-xs font-semibold transition ${contractSubTab === "contracts" ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)]"}`}>발송 현황</button>
        <button onClick={() => setContractSubTab("company_docs")} className={`px-4 py-2 rounded-md text-xs font-semibold transition ${contractSubTab === "company_docs" ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)]"}`}>회사 문서</button>
      </div>

      {/* 회사 문서 관리 */}
      {contractSubTab === "company_docs" && (
        <div className="contract-company-docs-panel">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {[
              { key: "business_reg", label: "사업자등록증", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", desc: "사업자등록증 사본" },
              { key: "employment_rules", label: "취업규칙", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253", desc: "회사 취업규칙/사규" },
              { key: "corporate_reg", label: "법인등기부등본", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4", desc: "법인 등기부등본" },
              { key: "seal_cert", label: "인감증명서", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", desc: "법인 인감증명서" },
              { key: "bank_cert", label: "통장사본", icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z", desc: "법인 통장 사본" },
              { key: "etc_docs", label: "기타 문서", icon: "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z", desc: "기타 회사 필수 문서" },
            ].map(doc => (
              <div key={doc.key} className="contract-doc-upload-card glass-card p-5 hover:border-[var(--primary)]/30 transition group">
                <div className="flex items-start justify-between mb-3">
                  <svg className="w-6 h-6 text-[var(--text-dim)] group-hover:text-[var(--primary)] transition" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d={doc.icon} /></svg>
                  <label className="px-2.5 py-1 bg-[var(--primary)]/10 text-[var(--primary)] text-[10px] font-semibold rounded-lg cursor-pointer hover:bg-[var(--primary)]/20 transition">
                    업로드
                    <input type="file" className="hidden" accept=".pdf,.jpg,.jpeg,.png" onChange={async (ev) => {
                      const file = ev.target.files?.[0];
                      if (!file || !companyId) return;
                      try {
                        const path = `company-docs/${companyId}/${doc.key}_${Date.now()}.${file.name.split('.').pop()}`;
                        await supabase.storage.from("documents").upload(path, file, { upsert: true });
                        toast(`${doc.label} 업로드 완료`, "success");
                      } catch (err: any) { toast("업로드 실패: " + (err.message || ""), "error"); }
                    }} />
                  </label>
                </div>
                <div className="text-sm font-semibold mb-0.5">{doc.label}</div>
                <div className="caption">{doc.desc}</div>
              </div>
            ))}
          </div>
          <div className="bg-[var(--bg-surface)] rounded-xl p-4 text-xs text-[var(--text-muted)]">
            <p>회사 필수 문서를 관리합니다. 업로드된 문서는 계약서 발송, 증명서 발급 등에 활용됩니다.</p>
          </div>
        </div>
      )}

      {contractSubTab === "contracts" && <>
      {/* 상태 필터 탭 + 일괄 발송 */}
      <div className="contract-status-filter-bar flex items-center justify-between gap-3 mb-4">
        <div className="flex gap-1 overflow-x-auto scrollbar-hide">
          {[
            { key: "all", label: "전체" },
            { key: "draft", label: "임시저장" },
            { key: "sent", label: "진행 중" },
            { key: "completed", label: "완료" },
            { key: "cancelled", label: "취소" },
          ].map(f => (
            <button
              key={f.key}
              onClick={() => { setStatusFilter(f.key); setSelectedIds(new Set()); }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg whitespace-nowrap transition ${
                statusFilter === f.key
                  ? "bg-[var(--primary)] text-white"
                  : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)]"
              }`}
            >
              {f.label} {(statusCounts as any)[f.key] > 0 && <span className="ml-1 opacity-70">{(statusCounts as any)[f.key]}</span>}
            </button>
          ))}
        </div>
        {selectedIds.size > 0 && (
          <button
            onClick={handleBatchSend}
            disabled={batchSending}
            className="btn-primary btn-sm whitespace-nowrap"
          >
            {batchSending ? "발송 중..." : `일괄 발송 (${selectedIds.size}건)`}
          </button>
        )}
      </div>

      {/* 계약 내역 리스트 */}
      <div className="contract-package-list space-y-3 mb-8">
        {filteredContracts.length === 0 ? (
          <div className="contract-package-empty glass-card p-12 text-center">
            <svg className="w-12 h-12 mx-auto mb-3 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            <div className="text-sm text-[var(--text-muted)]">계약 내역이 없습니다</div>
            <div className="text-xs text-[var(--text-dim)] mt-1">구성원 &gt; 인력관리 &gt; 디렉토리에서 직원을 선택해 계약서를 발송하세요</div>
          </div>
        ) : (
          <>
            {filteredContracts.some((c: any) => c.status === "draft") && (
              <div className="flex items-center gap-2 px-1">
                <label className="flex items-center gap-2 cursor-pointer text-xs text-[var(--text-muted)]">
                  <input
                    type="checkbox"
                    checked={filteredContracts.filter((c: any) => c.status === "draft").every((c: any) => selectedIds.has(c.id))}
                    onChange={(e) => {
                      const draftIds = filteredContracts.filter((c: any) => c.status === "draft").map((c: any) => c.id);
                      if (e.target.checked) {
                        setSelectedIds(new Set([...selectedIds, ...draftIds]));
                      } else {
                        const next = new Set(selectedIds);
                        draftIds.forEach((id: string) => next.delete(id));
                        setSelectedIds(next);
                      }
                    }}
                    className="rounded border-[var(--border)]"
                  />
                  전체선택 (임시저장 {filteredContracts.filter((c: any) => c.status === "draft").length}건)
                </label>
              </div>
            )}
          {filteredContracts.map((p: any) => {
            const st = PACKAGE_STATUS[p.status as keyof typeof PACKAGE_STATUS] || PACKAGE_STATUS.draft;
            return (
              <div key={p.id} className="contract-package-row glass-card p-4">
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    {p.status === "draft" && (
                      <input
                        type="checkbox"
                        checked={selectedIds.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        onClick={(e) => e.stopPropagation()}
                        className="mt-1 rounded border-[var(--border)]"
                      />
                    )}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-sm font-semibold truncate">{p.title}</span>
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${st.bg} ${st.text}`}>{st.label}</span>
                      </div>
                      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs text-[var(--text-muted)]">
                        <span>{p.employees?.name || "미지정"}</span>
                        {p.employees?.department && <span>{p.employees.department}</span>}
                        {p.created_at && <span>생성: {kstDateStr(new Date(p.created_at))}</span>}
                        {p.sent_at && <span>발송: {kstDateStr(new Date(p.sent_at))}</span>}
                        {p.completed_at && <span>완료: {kstDateStr(new Date(p.completed_at))}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-3 shrink-0">
                    {p.status === "draft" && (
                      <>
                        <button
                          onClick={() => handleSendSignRequest(p.id)}
                          disabled={sending === p.id}
                          className="btn-primary btn-sm"
                        >
                          {sending === p.id ? "발송 중..." : "서명 요청"}
                        </button>
                        <button
                          onClick={async () => { if (await appConfirm("이 계약을 취소하시겠습니까?", { danger: true, confirmLabel: "계약 취소" })) cancelContract.mutate(p.id); }}
                          className="px-3 py-2 text-xs text-[var(--text-dim)] hover:text-red-400 rounded-lg hover:bg-red-500/10 transition"
                        >
                          삭제
                        </button>
                      </>
                    )}
                    {(p.status === "sent" || p.status === "partially_signed") && (
                      <button
                        onClick={() => handleSendSignRequest(p.id)}
                        disabled={sending === p.id}
                        className="px-3 py-2 text-xs font-medium text-blue-400 rounded-lg hover:bg-blue-500/10 transition"
                      >
                        {sending === p.id ? "발송 중..." : "재발송"}
                      </button>
                    )}
                    {p.status === "completed" && (
                      <>
                        <button
                          onClick={() => p.sign_token && window.open(`/sign?token=${p.sign_token}`, "_blank", "noopener")}
                          className="px-3 py-2 text-xs font-medium text-green-400 rounded-lg hover:bg-green-500/10 transition flex items-center gap-1"
                          title="서명된 계약서 보기 (감사추적 + 다운로드)"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
                          서명본 보기
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => handleApplySeal(p.id)}
                      disabled={sealApplying === p.id}
                      className="px-3 py-2 text-xs font-medium text-orange-500 rounded-lg hover:bg-orange-500/10 transition disabled:opacity-50 flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
                      {sealApplying === p.id ? "적용 중..." : "직인 적용"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          </>
        )}
      </div>

      {/* 기존 계약 이력 */}
      {contracts.length > 0 && (
        <>
          <h3 className="text-sm font-bold text-[var(--text-muted)] mb-3">계약 이력</h3>
          <div className="contract-history-table glass-card overflow-hidden">
            <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
              <thead className="sticky-bar"><tr className="table-head-row">
                <th className="th-cell text-left">구성원</th>
                <th className="th-cell text-left">계약유형</th>
                <th className="th-cell text-left">기간</th>
                <th className="th-cell text-right">급여</th>
                <th className="th-cell text-center">상태</th>
              </tr></thead>
              <tbody>
                {contracts.map((c: any) => (
                  <tr key={c.id} className="border-b border-[var(--border)]/50">
                    <td className="px-5 py-3 text-sm font-medium">{c.employees?.name || "—"}</td>
                    <td className="px-5 py-3 text-xs">{CONTRACT_TYPES.find(t => t.value === c.contract_type)?.label || c.contract_type}</td>
                    <td className="px-5 py-3 text-xs text-[var(--text-muted)]">{c.start_date} ~ {c.end_date || "무기한"}</td>
                    <td className="px-5 py-3 text-sm text-right">{c.salary ? `₩${Number(c.salary).toLocaleString()}` : "—"}</td>
                    <td className="px-5 py-3 text-center">
                      <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'}`}>{c.status === 'active' ? '유효' : c.status}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          </div>
        </>
      )}
      </>}
    </div>
  );
}
