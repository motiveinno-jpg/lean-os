"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { friendlyError } from "@/lib/friendly-error";
import { useToast } from "@/components/toast";
import { createContract, CONTRACT_TYPES } from "@/lib/hr";
import { getContractPackages, createContractPackage, sendContractPackage, getContractTemplates, cancelContractPackage, PACKAGE_STATUS } from "@/lib/hr-contracts";
import type { RichEditorRef } from "@/components/rich-editor";

const RichEditor = dynamic(() => import("@/components/rich-editor").then(m => ({ default: m.RichEditor })), { ssr: false, loading: () => <div className="h-48 bg-[var(--bg-surface)] rounded-xl animate-pulse" /> });

// ── HR 기본 서식 정의 ──
const HR_TEMPLATES = [
  { key: "comprehensive_labor", label: "포괄근로계약서", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" },
  { key: "salary_contract", label: "연봉계약서", icon: "M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" },
  { key: "nda", label: "비밀유지서약서", icon: "M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" },
  { key: "non_compete", label: "겸업금지서약서", icon: "M18.364 18.364A9 9 0 005.636 5.636m12.728 12.728A9 9 0 015.636 5.636m12.728 12.728L5.636 5.636" },
  { key: "personal_info_consent", label: "개인정보이용동의서", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z" },
];

// ── Contract Tab — 플렉스 스타일 계약 입력 필드 ──
type ContractFieldType = "text" | "date" | "number" | "select";
interface ContractField {
  key: string;          // 템플릿 변수 키 (영문 가능)
  label: string;        // 표시 + {{label}} 변수
  type: ContractFieldType;
  value: string;
  included: boolean;
  options?: string[];   // type=select 용
  custom?: boolean;     // 사용자 추가 필드
}

function buildDefaultContractFields(emp: any | null): ContractField[] {
  const today = new Date().toISOString().slice(0, 10);
  const year = new Date().getFullYear();
  return [
    { key: "직원명", label: "구성원 이름", type: "text", value: emp?.name || "", included: true },
    { key: "계약일", label: "계약일", type: "date", value: today, included: true },
    { key: "생년월일", label: "생년월일", type: "date", value: emp?.birth_date || "", included: true },
    { key: "수습시작일", label: "수습기간 시작일", type: "date", value: "", included: true },
    { key: "수습종료일", label: "수습기간 종료일", type: "date", value: "", included: true },
    { key: "수습급여율", label: "수습기간 급여지급률", type: "text", value: "90%", included: true },
    { key: "직무", label: "직무", type: "text", value: emp?.position || emp?.department || "", included: true },
    { key: "계약시작일", label: "임금계약 시작일", type: "date", value: `${year}-01-01`, included: true },
    { key: "급여기준", label: "급여기준", type: "select", value: "연봉", included: true, options: ["연봉", "월급", "시급"] },
    { key: "계약금액", label: "계약 금액", type: "number", value: emp?.salary ? String(Number(emp.salary) * 12) : "", included: true },
  ];
}

export function ContractTab({ employees, contracts, companyId, queryClient }: any) {
  const { toast } = useToast();
  const { user } = useUser();
  const [showCreate, setShowCreate] = useState(false);
  const [reqForm, setReqForm] = useState({ employeeId: "", title: "", templateIds: [] as string[] });
  const [sending, setSending] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchSending, setBatchSending] = useState(false);
  const [selectedHrTemplate, setSelectedHrTemplate] = useState<string | null>(null);
  const [sealApplying, setSealApplying] = useState<string | null>(null);
  const [templatePreview, setTemplatePreview] = useState<{
    salary: string;
    workHours: string;
    duty: string;
    includeMealAllowance: boolean;
  }>({ salary: "", workHours: "09:00~18:00", duty: "", includeMealAllowance: false });
  const [wizardStep, setWizardStep] = useState(1); // 1: 대상 선택, 2: 서식 선택, 3: 미리보기/확인
  const [contractSubTab, setContractSubTab] = useState<"contracts" | "company_docs">("contracts");
  const [showTemplateEditor, setShowTemplateEditor] = useState(false);
  const [newTemplateName, setNewTemplateName] = useState("");
  const [newTemplateBody, setNewTemplateBody] = useState("");
  const [savingTemplate, setSavingTemplate] = useState(false);
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [customVariables, setCustomVariables] = useState<{ v: string; desc: string }[]>([]);
  const [newVarName, setNewVarName] = useState("");
  const [newVarDesc, setNewVarDesc] = useState("");
  const editorRef = useRef<RichEditorRef>(null);
  // Flex 스타일 계약 입력 테이블 필드
  const [contractFields, setContractFields] = useState<ContractField[]>(() => buildDefaultContractFields(null));
  const [newFieldLabel, setNewFieldLabel] = useState("");
  const [newFieldType, setNewFieldType] = useState<ContractFieldType>("text");

  // 회사 직인 URL 로드 (계약완료 시 PDF/화면에 표시)
  const { data: companySeal } = useQuery({
    queryKey: ["company-seal", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any).from("companies").select("seal_url, name, representative").eq("id", companyId!).maybeSingle();
      return data || null;
    },
    enabled: !!companyId,
  });
  void companySeal; // ContractTab 자체엔 직접 표시 안 함, sign 페이지에서 사용

  function startEditTemplate(t: any) {
    setEditingTemplateId(t.is_builtin ? null : t.id); // 내장은 신규 저장으로 떨어짐 (복제 편집)
    setNewTemplateName(t.is_builtin ? `${t.name} (복사본)` : t.name);
    const body = typeof t.content_json === 'object' && t.content_json
      ? (t.content_json.body || JSON.stringify(t.content_json))
      : (t.body || '');
    setNewTemplateBody(String(body));
    setShowTemplateEditor(true);
    setTimeout(() => editorRef.current?.setContent(String(body)), 50);
  }

  async function deleteTemplate(id: string) {
    if (!confirm("이 서식을 삭제하시겠습니까? 발송된 계약서엔 영향 없음.")) return;
    try {
      await (supabase as any).from("doc_templates").update({ is_active: false }).eq("id", id);
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

  // 계약서 서식 (활성만 — 발송 마법사용)
  const { data: templates = [] } = useQuery({
    queryKey: ["contract-templates", companyId],
    queryFn: () => getContractTemplates(companyId!),
    enabled: !!companyId,
  });

  // 모든 서식 (임시저장 포함 — 에디터 목록용)
  const { data: allTemplates = [] } = useQuery({
    queryKey: ["contract-templates-all", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("doc_templates")
        .select("*")
        .or(`company_id.eq.${companyId},company_id.is.null`)
        .order("name");
      return data || [];
    },
    enabled: !!companyId,
  });

  // 계약 요청 생성
  const createContract = useMutation({
    mutationFn: async () => {
      const emp = employees.find((e: any) => e.id === reqForm.employeeId);
      // 계약 필드 값 → variableOverrides 매핑 (체크된 필드만)
      const overrides: Record<string, string> = {};
      for (const f of contractFields) {
        if (f.included && f.value) {
          // key 와 한글 라벨 둘 다 등록 — 템플릿에서 {{key}} 또는 {{label}} 모두 동작하게.
          overrides[f.label] = String(f.value);
          if (f.key && f.key !== f.label) overrides[f.key] = String(f.value);
        }
      }
      return createContractPackage({
        companyId: companyId!,
        employeeId: reqForm.employeeId,
        title: reqForm.title || `${emp?.name || ""} ${new Date().getFullYear()}년 계약`,
        templateIds: reqForm.templateIds,
        createdBy: user?.id ?? null,
        variableOverrides: overrides,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
      setShowCreate(false);
      setReqForm({ employeeId: "", title: "", templateIds: [] });
      setContractFields(buildDefaultContractFields(null));
    },
    onError: (err: any) => toast(friendlyError(err, "처리에 실패했습니다. 잠시 후 다시 시도해 주세요."), "error"),
  });

  // 서명 요청 발송
  async function handleSendSignRequest(contractId: string) {
    setSending(contractId);
    try {
      const result = await sendContractPackage(contractId);
      if (!result.success) {
        const msg = result.error || "알 수 없는 오류";
        console.error('[handleSendSignRequest] 실패:', msg);
        // 메시지 종류별 안내
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
        toast(
          channels.length > 0
            ? `서명 요청 발송 완료 (${channels.join(" + ")})`
            : "서명 요청 발송 완료",
          "success",
        );
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

  const allEmployees = employees.filter((e: any) => ["active", "joined", "contract_pending"].includes(e.status));

  // 선택된 직원 데이터로 템플릿 미리보기 자동 채움
  const selectedEmployee = employees.find((e: any) => e.id === reqForm.employeeId);

  // 직원 선택이 바뀌면 기본 필드값을 직원 정보로 자동 채움 (사용자가 직접 수정/추가한 건 유지)
  useEffect(() => {
    if (!selectedEmployee) return;
    setContractFields((prev) => {
      const defaults = buildDefaultContractFields(selectedEmployee);
      // 기존 사용자 추가 필드 보존
      const customs = prev.filter((f) => f.custom);
      // 기존 included 상태 + 사용자가 이미 수정한 값 우선
      const merged = defaults.map((d) => {
        const old = prev.find((p) => p.key === d.key);
        if (!old) return d;
        // 직원 자동 채움 필드(생년월일, 직원명, 직무, 계약금액)는 새 직원 값 우선
        const autoFillKeys = ["직원명", "생년월일", "직무", "계약금액"];
        if (autoFillKeys.includes(d.key)) return { ...d, included: old.included };
        return { ...d, value: old.value || d.value, included: old.included };
      });
      return [...merged, ...customs];
    });
  }, [selectedEmployee?.id]);

  // 직인 적용 핸들러 — 패키지 단위로 적용 (notes JSON 에 seal_applied 표시 + 회사 seal_url 스냅샷)
  async function handleApplySeal(contractId: string) {
    if (!companyId) return;
    setSealApplying(contractId);
    try {
      // 회사 seal_url 조회
      const { data: company } = await (supabase as any)
        .from("companies").select("seal_url, name").eq("id", companyId).maybeSingle();
      if (!company?.seal_url) {
        toast("직인 이미지가 등록돼 있지 않습니다. 회사 설정에서 먼저 등록하세요.", "error");
        setSealApplying(null);
        return;
      }
      // 기존 notes 파싱
      const { data: pkg } = await (supabase as any)
        .from("hr_contract_packages").select("notes").eq("id", contractId).maybeSingle();
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
      await (supabase as any)
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

  function toggleTemplate(id: string) {
    setReqForm(prev => ({
      ...prev,
      templateIds: prev.templateIds.includes(id)
        ? prev.templateIds.filter(t => t !== id)
        : [...prev.templateIds, id],
    }));
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
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-5">
        <div>
          <h3 className="text-base font-bold text-[var(--text)]">전자계약</h3>
          <p className="text-xs text-[var(--text-muted)] mt-0.5">구성원에게 계약서를 발송하고 전자서명을 받습니다</p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => setShowTemplateEditor(!showTemplateEditor)}
            className="px-4 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold transition flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
            + 계약서식 추가
          </button>
          <button
            onClick={() => { setShowCreate(!showCreate); setWizardStep(1); }}
            className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition flex items-center gap-1.5"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M12 5v14M5 12h14"/></svg>
            계약 요청
          </button>
        </div>
      </div>

      {/* 서식 에디터 (WYSIWYG) */}
      {showTemplateEditor && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-emerald-500/20 mb-6 flex flex-col" style={{ height: "80vh" }}>
          <div className="p-6 pb-3 shrink-0">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h4 className="text-sm font-bold text-emerald-600 flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/></svg>
                  계약서식 에디터
                </h4>
                <p className="text-[10px] text-[var(--text-dim)] mt-0.5">서식을 작성하고 저장하면 계약 요청 시 사용할 수 있습니다. {"{{직원명}}, {{부서}}, {{직위}}, {{연봉}}"} 등의 변수를 사용하세요.</p>
              </div>
              <button onClick={() => setShowTemplateEditor(false)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">닫기</button>
            </div>
            <div className="mb-3">
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">서식 이름 *</label>
              <input value={newTemplateName} onChange={(e) => setNewTemplateName(e.target.value)} placeholder="예: 2026년 정규직 근로계약서" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-emerald-500" />
            </div>
          </div>
          <div className="flex-1 flex gap-4 px-6 min-h-0">
            {/* 서식 내용 — 자체 스크롤 */}
            <div className="flex-1 flex flex-col min-h-0">
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 shrink-0">서식 내용 *</label>
              <div className="flex-1 overflow-y-auto bg-[var(--bg)] border border-[var(--border)] rounded-xl">
                <RichEditor ref={editorRef} content={newTemplateBody} onChange={setNewTemplateBody} placeholder="계약서 내용을 입력하세요... {{직원명}}, {{부서}} 등의 변수를 사용할 수 있습니다." />
              </div>
            </div>
            {/* 변수 삽입 — 자체 스크롤 */}
            <div className="w-52 shrink-0 flex flex-col min-h-0">
              <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5 shrink-0">변수 삽입</label>
              <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-3 flex-1 overflow-y-auto flex flex-col gap-1.5">
                <p className="text-[9px] text-[var(--text-dim)] mb-1 shrink-0">클릭하면 커서 위치에 삽입됩니다</p>
                {/* 기본 변수 */}
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
                    className="w-full text-left px-2.5 py-2 rounded-lg bg-emerald-500/5 hover:bg-emerald-500/15 transition group shrink-0">
                    <div className="text-xs font-mono font-semibold text-emerald-600 group-hover:text-emerald-500">{v}</div>
                    <div className="text-[9px] text-[var(--text-dim)]">{desc}</div>
                  </button>
                ))}
                {/* 사용자 추가 변수 */}
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
                {/* 새 변수 추가 폼 */}
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
          {/* 기존 서식 목록 (수정/삭제) — 활성+임시저장 모두 */}
          {(allTemplates.length > 0 || templates.some((t: any) => t.is_builtin)) && (
            <div className="px-6 pb-3 shrink-0">
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
                    <button onClick={() => startEditTemplate(t)} className="text-xs text-[var(--text)] hover:text-emerald-600 transition" title={t.is_builtin ? "내장 서식 — 복제 후 편집" : t.is_active === false ? "임시저장" : "수정"}>
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
          <div className="shrink-0 border-t border-[var(--border)] px-6 py-4 flex items-center gap-3 bg-[var(--bg-card)] rounded-b-2xl">
            <button
              onClick={() => { setShowTemplateEditor(false); setNewTemplateName(""); setNewTemplateBody(""); setEditingTemplateId(null); }}
              className="px-4 py-2.5 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] rounded-xl text-sm font-semibold transition"
            >
              취소
            </button>
            <button
              onClick={async () => {
                // 임시저장 — 이름만 있으면 가능. is_active=false 로 비활성 상태로 저장.
                if (!newTemplateName.trim() || !companyId) return;
                setSavingTemplate(true);
                try {
                  const variables = Array.from(new Set((newTemplateBody.match(/\{\{[^}]+\}\}/g) || []).map((v: string) => v.replace(/[{}]/g, ""))));
                  if (editingTemplateId) {
                    const { error } = await (supabase as any).from("doc_templates").update({
                      name: `[임시] ${newTemplateName.trim().replace(/^\[임시\]\s*/, '')}`,
                      content_json: { body: newTemplateBody || '' },
                      variables,
                      is_active: false,
                    }).eq("id", editingTemplateId);
                    if (error) throw error;
                  } else {
                    const { data: ins, error } = await (supabase as any).from("doc_templates").insert({
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
              className="px-4 py-2.5 bg-[var(--bg-surface)] border border-emerald-500/30 text-emerald-600 hover:bg-emerald-500/10 rounded-xl text-sm font-semibold disabled:opacity-50 transition"
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
                    // UPDATE 기존 서식 — 임시저장 prefix 제거
                    const { error } = await (supabase as any).from("doc_templates").update({
                      name: newTemplateName.trim().replace(/^\[임시\]\s*/, ''),
                      content_json: { body: newTemplateBody },
                      variables,
                      is_active: true,
                    }).eq("id", editingTemplateId);
                    if (error) throw error;
                    toast("서식이 수정되었습니다.", "success");
                  } else {
                    const { error } = await (supabase as any).from("doc_templates").insert({
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
              className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition"
            >
              {savingTemplate ? "저장 중..." : editingTemplateId ? "수정 저장" : "서식 저장"}
            </button>
          </div>
        </div>
      )}

      {/* 서브탭: 계약 관리 / 회사 문서 */}
      <div className="flex gap-1 mb-5 bg-[var(--bg-surface)] rounded-lg p-0.5 w-fit">
        <button onClick={() => setContractSubTab("contracts")} className={`px-4 py-2 rounded-md text-xs font-semibold transition ${contractSubTab === "contracts" ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)]"}`}>계약 관리</button>
        <button onClick={() => setContractSubTab("company_docs")} className={`px-4 py-2 rounded-md text-xs font-semibold transition ${contractSubTab === "company_docs" ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm" : "text-[var(--text-muted)]"}`}>회사 문서</button>
      </div>

      {/* 회사 문서 관리 */}
      {contractSubTab === "company_docs" && (
        <div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-6">
            {[
              { key: "business_reg", label: "사업자등록증", icon: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z", desc: "사업자등록증 사본" },
              { key: "employment_rules", label: "취업규칙", icon: "M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253", desc: "회사 취업규칙/사규" },
              { key: "corporate_reg", label: "법인등기부등본", icon: "M19 21V5a2 2 0 00-2-2H7a2 2 0 00-2 2v16m14 0h2m-2 0h-5m-9 0H3m2 0h5M9 7h1m-1 4h1m4-4h1m-1 4h1m-5 10v-5a1 1 0 011-1h2a1 1 0 011 1v5m-4 0h4", desc: "법인 등기부등본" },
              { key: "seal_cert", label: "인감증명서", icon: "M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z", desc: "법인 인감증명서" },
              { key: "bank_cert", label: "통장사본", icon: "M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z", desc: "법인 통장 사본" },
              { key: "etc_docs", label: "기타 문서", icon: "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z", desc: "기타 회사 필수 문서" },
            ].map(doc => (
              <div key={doc.key} className="glass-card p-5 hover:border-[var(--primary)]/30 transition group">
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
      {/* 기본 HR 서식 */}
      <div className="mb-6">
        <h4 className="text-xs font-bold text-[var(--text-muted)] mb-3 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10"/></svg>
          기본 HR 서식
        </h4>
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-2">
          {HR_TEMPLATES.map((ht) => (
            <button
              key={ht.key}
              onClick={() => {
                setSelectedHrTemplate(selectedHrTemplate === ht.key ? null : ht.key);
                if (selectedHrTemplate !== ht.key) setShowCreate(true);
              }}
              className={`text-left px-4 py-3 rounded-xl border transition group ${
                selectedHrTemplate === ht.key
                  ? "border-[var(--primary)] bg-[var(--primary)]/5"
                  : "border-[var(--border)] bg-[var(--bg-card)] hover:border-[var(--primary)]/40"
              }`}
            >
              <svg className={`w-5 h-5 mb-1.5 ${selectedHrTemplate === ht.key ? "text-[var(--primary)]" : "text-[var(--text-dim)] group-hover:text-[var(--primary)]"}`} fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d={ht.icon} />
              </svg>
              <div className={`text-xs font-medium ${selectedHrTemplate === ht.key ? "text-[var(--primary)]" : "text-[var(--text)]"}`}>{ht.label}</div>
            </button>
          ))}
        </div>
      </div>

      {/* 인라인 서식 미리보기/편집 */}
      {selectedHrTemplate && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--primary)]/20 p-6 mb-6">
          <div className="flex items-center justify-between mb-4">
            <h4 className="text-sm font-bold text-[var(--primary)]">
              {HR_TEMPLATES.find(t => t.key === selectedHrTemplate)?.label} 미리보기
            </h4>
            <button onClick={() => setSelectedHrTemplate(null)} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">닫기</button>
          </div>

          {/* 직원 자동 채움 필드 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">직원명</label>
              <div className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm">
                {selectedEmployee?.name || "(직원 선택 필요)"}
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">직급</label>
              <div className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm">
                {selectedEmployee?.job_grade || selectedEmployee?.position || "—"}
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">직책</label>
              <div className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm">
                {selectedEmployee?.position || "—"}
              </div>
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">부서</label>
              <div className="px-3 py-2 bg-[var(--bg-surface)] border border-[var(--border)] rounded-lg text-sm">
                {selectedEmployee?.department || "—"}
              </div>
            </div>
          </div>

          {/* 편집 가능 필드 */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-4">
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">연봉</label>
              <input
                type="text"
                inputMode="numeric"
                value={(() => { const v = templatePreview.salary || (selectedEmployee ? String(Number(selectedEmployee.salary || 0) * 12) : ""); return v ? Number(v).toLocaleString('ko-KR') : ''; })()}
                onChange={(e) => { const raw = e.target.value.replace(/[^0-9]/g, ''); setTemplatePreview({ ...templatePreview, salary: raw }); }}
                placeholder="36,000,000"
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">근무시간</label>
              <input
                type="text"
                value={templatePreview.workHours}
                onChange={(e) => setTemplatePreview({ ...templatePreview, workHours: e.target.value })}
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div>
              <label className="block text-[10px] text-[var(--text-dim)] mb-1">직무</label>
              <input
                type="text"
                value={templatePreview.duty}
                onChange={(e) => setTemplatePreview({ ...templatePreview, duty: e.target.value })}
                placeholder="소프트웨어 개발"
                className="w-full px-3 py-2 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm focus:outline-none focus:border-[var(--primary)]"
              />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-2 cursor-pointer px-3 py-2">
                <input
                  type="checkbox"
                  checked={templatePreview.includeMealAllowance}
                  onChange={(e) => setTemplatePreview({ ...templatePreview, includeMealAllowance: e.target.checked })}
                  className="rounded border-[var(--border)]"
                />
                <span className="text-xs text-[var(--text)]">식대포함</span>
              </label>
            </div>
          </div>

          <div className="bg-[var(--bg-surface)] rounded-xl border border-[var(--border)] p-4 text-xs text-[var(--text-muted)] leading-relaxed">
            <p className="font-semibold text-[var(--text)] mb-2">{HR_TEMPLATES.find(t => t.key === selectedHrTemplate)?.label}</p>
            <p>상기 {selectedHrTemplate === "nda" ? "비밀유지서약" : selectedHrTemplate === "non_compete" ? "겸업금지서약" : selectedHrTemplate === "personal_info_consent" ? "개인정보 이용 동의" : "근로계약"}에 관하여, 아래와 같이 체결합니다.</p>
            <div className="mt-2 space-y-1">
              <p>성명: {selectedEmployee?.name || "________"}</p>
              <p>부서: {selectedEmployee?.department || "________"} / 직책: {selectedEmployee?.position || "________"}</p>
              {(selectedHrTemplate === "comprehensive_labor" || selectedHrTemplate === "salary_contract") && (
                <>
                  <p>연봉: {templatePreview.salary ? `₩${Number(templatePreview.salary).toLocaleString()}` : "________"}{templatePreview.includeMealAllowance ? " (식대 포함)" : ""}</p>
                  <p>근무시간: {templatePreview.workHours || "________"}</p>
                  <p>직무: {templatePreview.duty || "________"}</p>
                </>
              )}
            </div>
            <p className="mt-3 text-[10px] text-[var(--text-dim)]">* 위 내용은 미리보기이며, 최종 계약서는 서식에 따라 생성됩니다.</p>
          </div>
        </div>
      )}

      {/* 계약 요청 스텝 위저드 */}
      {showCreate && (
        <div className="glass-card p-6 mb-6">
          {/* 스텝 인디케이터 */}
          <div className="flex items-center gap-2 mb-6">
            {[{ n: 1, label: "대상 선택" }, { n: 2, label: "서식 선택" }, { n: 3, label: "확인 및 발송" }].map((s, i) => (
              <div key={s.n} className="flex items-center gap-2">
                <div className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition ${wizardStep >= s.n ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] text-[var(--text-dim)] border border-[var(--border)]"}`}>{s.n}</div>
                <span className={`text-xs font-medium ${wizardStep >= s.n ? "text-[var(--text)]" : "text-[var(--text-dim)]"}`}>{s.label}</span>
                {i < 2 && <div className={`w-8 h-px ${wizardStep > s.n ? "bg-[var(--primary)]" : "bg-[var(--border)]"}`} />}
              </div>
            ))}
          </div>

          {/* Step 1: 대상 선택 */}
          {wizardStep === 1 && (
            <div>
              <h4 className="text-sm font-bold mb-4">Step 1: 구성원 선택</h4>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">구성원 *</label>
                  <select value={reqForm.employeeId} onChange={e => setReqForm({...reqForm, employeeId: e.target.value})} className="field-input">
                    <option value="">구성원을 선택하세요</option>
                    {allEmployees.map((e: any) => (<option key={e.id} value={e.id}>{e.name} · {e.department || "미배정"} · {e.position || "미지정"}</option>))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">계약 제목</label>
                  <input value={reqForm.title} onChange={e => setReqForm({...reqForm, title: e.target.value})} placeholder={`${new Date().getFullYear()}년 연봉계약`} className="field-input" />
                </div>
              </div>
              {reqForm.employeeId && selectedEmployee && (
                <div className="bg-[var(--bg-surface)] rounded-xl p-4 mb-4">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-[var(--primary)]/10 flex items-center justify-center text-[var(--primary)] font-bold">{(selectedEmployee.name || "?")[0]}</div>
                    <div>
                      <div className="text-sm font-semibold">{selectedEmployee.name}</div>
                      <div className="text-xs text-[var(--text-muted)]">{selectedEmployee.department || "미배정"} · {selectedEmployee.position || "미지정"} · {selectedEmployee.email || ""}</div>
                    </div>
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => reqForm.employeeId && setWizardStep(2)} disabled={!reqForm.employeeId} className="px-5 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50">다음</button>
                <button onClick={() => { setShowCreate(false); setWizardStep(1); setReqForm({ employeeId: "", title: "", templateIds: [] }); }} className="px-4 py-2.5 text-sm text-[var(--text-muted)]">취소</button>
              </div>
            </div>
          )}

          {/* Step 2: 서식 선택 */}
          {wizardStep === 2 && (
            <div>
              <h4 className="text-sm font-bold mb-4">Step 2: 계약서 서식 선택</h4>
              {templates.length === 0 ? (
                <p className="text-xs text-[var(--text-dim)] mb-4">등록된 서식이 없습니다. HR 서식을 사용해주세요.</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2 mb-4">
                  {templates.map((t: any) => {
                    const selected = reqForm.templateIds.includes(t.id);
                    return (
                      <button key={t.id} onClick={() => toggleTemplate(t.id)} className={`text-left px-4 py-3 rounded-xl border transition ${selected ? "border-[var(--primary)] bg-[var(--primary)]/5" : "border-[var(--border)] bg-[var(--bg)] hover:border-[var(--primary)]/50"}`}>
                        <div className="flex items-center gap-2">
                          <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${selected ? "border-[var(--primary)] bg-[var(--primary)]" : "border-[var(--border)]"}`}>
                            {selected && <svg className="w-2.5 h-2.5 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24"><polyline points="20 6 9 17 4 12"/></svg>}
                          </div>
                          <span className="text-sm font-medium">{t.name}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
              <div className="flex gap-2">
                <button onClick={() => setWizardStep(1)} className="px-4 py-2.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] rounded-xl">이전</button>
                <button onClick={() => reqForm.templateIds.length > 0 && setWizardStep(3)} disabled={reqForm.templateIds.length === 0} className="px-5 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold disabled:opacity-50">다음</button>
              </div>
            </div>
          )}

          {/* Step 3: 필수 입력 정보 (플렉스 스타일 테이블) */}
          {wizardStep === 3 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h4 className="text-sm font-bold">Step 3: 필수 입력 정보</h4>
                <span className="caption">서식의 {"{{변수명}}"} 자리에 자동 치환됨</span>
              </div>

              {/* 발송 요약 */}
              <div className="bg-[var(--bg-surface)] rounded-xl p-3 mb-3 flex items-center justify-between text-xs">
                <div className="flex gap-4">
                  <span className="text-[var(--text-muted)]">대상 <strong className="text-[var(--text)] ml-1">{selectedEmployee?.name || "—"}</strong></span>
                  <span className="text-[var(--text-muted)]">서식 <strong className="text-[var(--text)] ml-1">{reqForm.templateIds.length}건</strong></span>
                </div>
                <button onClick={() => setContractFields(buildDefaultContractFields(selectedEmployee))} className="text-[var(--primary)] hover:underline">기본값으로 초기화</button>
              </div>

              {/* 필수 입력 정보 테이블 */}
              <div className="border border-[var(--border)] rounded-xl overflow-hidden mb-3">
                <div className="bg-[var(--bg-surface)] px-3 py-2 border-b border-[var(--border)] flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--text)]">필수 입력 정보</span>
                  <span className="caption">체크 해제 시 해당 필드 미사용</span>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-xs" style={{ minWidth: contractFields.length * 130 }}>
                    {/* 컬럼 헤더 — 필드명 + 포함 체크박스 */}
                    <thead>
                      <tr className="border-b border-[var(--border)] bg-[var(--bg-surface)]/30">
                        {contractFields.map((f, i) => (
                          <th key={f.key + i} className="px-3 py-2 text-left font-semibold text-[var(--text)] whitespace-nowrap">
                            <div className="flex items-center gap-1.5">
                              <input
                                type="checkbox"
                                checked={f.included}
                                onChange={(e) => setContractFields(prev => prev.map((p, idx) => idx === i ? { ...p, included: e.target.checked } : p))}
                                className="rounded"
                              />
                              <span>{f.label}</span>
                              {f.custom && (
                                <button
                                  onClick={() => setContractFields(prev => prev.filter((_, idx) => idx !== i))}
                                  className="text-red-400 hover:text-red-500 text-[10px] ml-0.5"
                                  title="삭제"
                                >×</button>
                              )}
                            </div>
                          </th>
                        ))}
                      </tr>
                      {/* 변수 키 표시 행 */}
                      <tr className="border-b border-[var(--border)] bg-[var(--bg)]">
                        {contractFields.map((f, i) => (
                          <th key={f.key + i + 'k'} className="px-3 py-1.5 text-left font-normal text-[10px] text-[var(--text-dim)] whitespace-nowrap font-mono">
                            {`{{${f.key}}}`}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {/* 값 입력 행 */}
                      <tr>
                        {contractFields.map((f, i) => (
                          <td key={f.key + i + 'v'} className={`px-2 py-2 ${f.included ? '' : 'opacity-40'}`}>
                            {f.type === "date" ? (
                              <input
                                type="date"
                                value={f.value}
                                disabled={!f.included}
                                onChange={(e) => setContractFields(prev => prev.map((p, idx) => idx === i ? { ...p, value: e.target.value } : p))}
                                className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]"
                              />
                            ) : f.type === "number" ? (
                              <input
                                type="text"
                                inputMode="numeric"
                                value={f.value ? Number(f.value.replace(/[^0-9]/g, '') || 0).toLocaleString('ko-KR') : ''}
                                disabled={!f.included}
                                onChange={(e) => setContractFields(prev => prev.map((p, idx) => idx === i ? { ...p, value: e.target.value.replace(/[^0-9]/g, '') } : p))}
                                placeholder="0"
                                className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-right focus:outline-none focus:border-[var(--primary)]"
                              />
                            ) : f.type === "select" ? (
                              <select
                                value={f.value}
                                disabled={!f.included}
                                onChange={(e) => setContractFields(prev => prev.map((p, idx) => idx === i ? { ...p, value: e.target.value } : p))}
                                className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]"
                              >
                                {(f.options || []).map(opt => <option key={opt} value={opt}>{opt}</option>)}
                              </select>
                            ) : (
                              <input
                                type="text"
                                value={f.value}
                                disabled={!f.included}
                                onChange={(e) => setContractFields(prev => prev.map((p, idx) => idx === i ? { ...p, value: e.target.value } : p))}
                                placeholder="입력"
                                className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-[var(--primary)]"
                              />
                            )}
                          </td>
                        ))}
                      </tr>
                    </tbody>
                  </table>
                </div>
              </div>

              {/* 필드 추가 */}
              <div className="bg-[var(--bg-card)] border border-dashed border-[var(--border)] rounded-xl p-3 mb-3">
                <div className="text-[10px] font-semibold text-[var(--text-dim)] uppercase mb-2">+ 필드 추가</div>
                <div className="flex flex-wrap gap-2 items-end">
                  <div className="flex-1 min-w-[140px]">
                    <label className="block text-[10px] text-[var(--text-muted)] mb-0.5">필드 이름</label>
                    <input
                      value={newFieldLabel}
                      onChange={(e) => setNewFieldLabel(e.target.value)}
                      placeholder="예: 인센티브, 직책수당"
                      className="w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] text-[var(--text-muted)] mb-0.5">타입</label>
                    <select
                      value={newFieldType}
                      onChange={(e) => setNewFieldType(e.target.value as ContractFieldType)}
                      className="px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs focus:outline-none focus:border-emerald-500"
                    >
                      <option value="text">텍스트</option>
                      <option value="date">날짜</option>
                      <option value="number">숫자</option>
                    </select>
                  </div>
                  <button
                    onClick={() => {
                      const label = newFieldLabel.trim();
                      if (!label) return;
                      if (contractFields.some(f => f.label === label)) {
                        toast("같은 이름의 필드가 이미 있습니다.", "error");
                        return;
                      }
                      setContractFields(prev => [...prev, {
                        key: label, label, type: newFieldType, value: "", included: true, custom: true,
                      }]);
                      setNewFieldLabel("");
                    }}
                    disabled={!newFieldLabel.trim()}
                    className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-lg text-xs font-semibold disabled:opacity-50"
                  >
                    + 추가
                  </button>
                </div>
                <p className="text-[10px] text-[var(--text-dim)] mt-2">
                  추가한 필드는 서식에서 {"{{필드이름}}"} 변수로 사용 가능 (예: 인센티브 필드 → 서식에 {`{{인센티브}}`} 작성)
                </p>
              </div>

              <div className="flex gap-2">
                <button onClick={() => setWizardStep(2)} className="px-4 py-2.5 text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)] rounded-xl">이전</button>
                <button onClick={() => { createContract.mutate(); setWizardStep(1); }} disabled={createContract.isPending} className="px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold disabled:opacity-50 transition">
                  {createContract.isPending ? "생성 중..." : "계약 요청 발송"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 상태 필터 탭 + 일괄 발송 */}
      <div className="flex items-center justify-between gap-3 mb-4">
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
            className="px-4 py-2 text-xs font-semibold bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition whitespace-nowrap"
          >
            {batchSending ? "발송 중..." : `일괄 발송 (${selectedIds.size}건)`}
          </button>
        )}
      </div>

      {/* 계약 내역 리스트 */}
      <div className="space-y-3 mb-8">
        {filteredContracts.length === 0 ? (
          <div className="glass-card p-12 text-center">
            <svg className="w-12 h-12 mx-auto mb-3 text-[var(--text-dim)]" fill="none" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 24 24"><path d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"/></svg>
            <div className="text-sm text-[var(--text-muted)]">계약 내역이 없습니다</div>
            <div className="text-xs text-[var(--text-dim)] mt-1">상단의 &quot;계약 요청&quot; 버튼으로 구성원에게 계약서를 발송하세요</div>
          </div>
        ) : (
          <>
            {/* 전체선택 체크박스 */}
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
              <div key={p.id} className="glass-card p-4">
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
                        {p.created_at && <span>생성: {new Date(p.created_at).toLocaleDateString("ko-KR")}</span>}
                        {p.sent_at && <span>발송: {new Date(p.sent_at).toLocaleDateString("ko-KR")}</span>}
                        {p.completed_at && <span>완료: {new Date(p.completed_at).toLocaleDateString("ko-KR")}</span>}
                      </div>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-3 shrink-0">
                    {p.status === "draft" && (
                      <>
                        <button
                          onClick={() => handleSendSignRequest(p.id)}
                          disabled={sending === p.id}
                          className="px-4 py-2 text-xs font-semibold bg-[var(--primary)] text-white rounded-lg hover:bg-[var(--primary-hover)] disabled:opacity-50 transition"
                        >
                          {sending === p.id ? "발송 중..." : "서명 요청"}
                        </button>
                        <button
                          onClick={() => { if (confirm("이 계약을 취소하시겠습니까?")) cancelContract.mutate(p.id); }}
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
                    {/* 직인 적용 버튼 — 모든 상태에서 사용 가능 */}
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
          <div className="glass-card overflow-hidden">
            <div className="overflow-auto max-h-[560px] relative"><table className="w-full min-w-[700px]">
              <thead className="sticky top-0 z-10 bg-[var(--bg-card)] shadow-[0_1px_0_0_var(--border)]"><tr className="table-head-row">
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

