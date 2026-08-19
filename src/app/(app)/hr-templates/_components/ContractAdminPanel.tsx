"use client";
import { kstDateStr } from "@/lib/kst";
import { Ico } from "@/components/ui-icon";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

import { useMemo, useRef, useState, type ReactNode } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import dynamic from "next/dynamic";
import Link from "next/link";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ConditionPanel, ConditionRow, TokenField, ChipGroup, AppliedChips,
  QuickSearch, quickSearchHit, ResultStrip, Stat, RowsPerPage, Pager, usePager, SelectionBar, type TokenItem, type AppliedChip,
} from "@/components/query-kit";
import { SortableTh, nextSort, cmp, useColWidths, useColFilters, type SortState } from "@/components/sortable-th";
import { DateRangeField } from "@/components/date-range-field";
import { supabase } from "@/lib/supabase";
import { friendlyError } from "@/lib/friendly-error";
import { useToast } from "@/components/toast";
import { CONTRACT_TYPES } from "@/lib/hr";
import { getContractPackages, sendContractPackage, getContractTemplates, cancelContractPackage, PACKAGE_STATUS } from "@/lib/hr-contracts";
import { getCurrentUser } from "@/lib/queries";
import { uploadFile } from "@/lib/file-storage";
import type { RichEditorRef } from "@/components/rich-editor";

const RichEditor = dynamic(() => import("@/components/rich-editor").then(m => ({ default: m.RichEditor })), { ssr: false, loading: () => <div className="h-48 bg-[var(--bg-surface)] rounded-xl animate-pulse" /> });

// ── 계약서/서약서 템플릿 편집 + 회사 문서 + 발송 현황 — 구성원 상세패널의 "+ 계약서 보내기"로
//   개별 발송이 이관된 뒤, 회사 전체 관점(서식 관리·회사 문서·발송 현황/일괄발송)만 여기 남음.
//   (2026-07-15 employees/_components/ContractTab.tsx 에서 이관)
type CaCond = { emp: string[]; dept: string[]; cFrom: string; cTo: string; sFrom: string; sTo: string; rows: number };
const CA_EMPTY: CaCond = { emp: [], dept: [], cFrom: "", cTo: "", sFrom: "", sTo: "", rows: 50 };
const caCount = (c: CaCond) => c.emp.length + c.dept.length + ((c.cFrom || c.cTo) ? 1 : 0) + ((c.sFrom || c.sTo) ? 1 : 0);
type CaSort = "title" | "emp" | "dept" | "status" | "created" | "sent" | "completed";
const STATUS_CHIPS = [
  { value: "all", label: "전체" }, { value: "draft", label: "임시저장" }, { value: "sent", label: "진행 중" },
  { value: "completed", label: "완료" }, { value: "cancelled", label: "취소" },
] as const;

export function ContractAdminPanel({ companyId, contracts, tabs }: { companyId: string; contracts: any[]; tabs?: ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [sending, setSending] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [batchSending, setBatchSending] = useState(false);
  const [sealApplying, setSealApplying] = useState<string | null>(null);
  // 회사 문서 서브탭 제거(2026-07-23) — 발송/현황만 남아 항상 contracts.
  const [contractSubTab] = useState<"contracts">("contracts");
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
      const { error } = await supabase.from("doc_templates").update({ is_active: false }).eq("id", id);
      if (error) throw error;   // supabase-js 는 throw 하지 않음 — 미검사 시 실패도 성공 토스트 (2026-08-19)
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
      const { error: sealErr } = await supabase
        .from("hr_contract_packages")
        .update({ notes: JSON.stringify(notesObj) })
        .eq("id", contractId);
      if (sealErr) throw sealErr;   // 미검사 시 실패해도 "직인 적용됨" — 실제 PDF엔 직인 없음 (2026-08-19)
      queryClient.invalidateQueries({ queryKey: ["contract-packages"] });
      toast("직인이 적용되었습니다 (서명본/PDF에 반영됨)", "success");
    } catch (err: any) {
      toast("직인 적용 실패: " + (friendlyError(err, "알 수 없는 오류")), "error");
    } finally {
      setSealApplying(null);
    }
  }

  // ── 조회 표준(2026-08-18 Wave 4) — 상태 칩 + 검색조건(직원·부서·생성일·발송일) + 빠른검색 + 머리단 정렬·≡·너비 + 쪽 ──
  const [q, setQ] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<CaCond>(CA_EMPTY);
  const [live, setLive] = useState<CaCond>(CA_EMPTY);
  const setD = <K extends keyof CaCond>(k: K) => (v: CaCond[K]) => setDraft((c) => ({ ...c, [k]: v }));
  const [sort, setSort] = useState<SortState<CaSort>>({ key: "created", dir: "desc" });
  const onSort = (k: CaSort) => setSort((c) => nextSort(c, k));
  const cf = useColFilters();
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths("hr-contract-packages-colw-v1", {
    title: 260, emp: 100, dept: 110, status: 110, created: 110, sent: 110, completed: 110, action: 220,
  });
  const thResize = (k: string, colIndex: number) => ({ k, colIndex, widths: colW, onResize: setColW, tableRef });
  const day = (v: any) => (v ? kstDateStr(new Date(v)) : "");
  const stLabel = (c: any) => (PACKAGE_STATUS[c.status as keyof typeof PACKAGE_STATUS] || PACKAGE_STATUS.draft).label;
  const statusHit = (c: any) => statusFilter === "all" || (statusFilter === "sent" ? (c.status === "sent" || c.status === "partially_signed") : c.status === statusFilter);
  const condHit = (c: any, k: CaCond) => {
    if (k.emp.length && !k.emp.includes(c.employees?.name || "")) return false;
    if (k.dept.length && !k.dept.includes(c.employees?.department || "")) return false;
    const cd = day(c.created_at), sd = day(c.sent_at);
    if (k.cFrom && cd < k.cFrom) return false;
    if (k.cTo && cd > k.cTo) return false;
    if ((k.sFrom || k.sTo) && !sd) return false;
    if (k.sFrom && sd < k.sFrom) return false;
    if (k.sTo && sd > k.sTo) return false;
    return true;
  };
  const colVal = (c: any) => ({ emp: c.employees?.name || "미지정", dept: c.employees?.department || "—", status: stLabel(c) });
  const empOpts: TokenItem[] = useMemo(() => [...new Set((contractList as any[]).map((c) => c.employees?.name).filter(Boolean))].map((v) => ({ value: v as string, label: v as string })), [contractList]);
  const deptOpts: TokenItem[] = useMemo(() => [...new Set((contractList as any[]).map((c) => c.employees?.department).filter(Boolean))].map((v) => ({ value: v as string, label: v as string })), [contractList]);
  const base = useMemo(() => (contractList as any[]).filter((c) => statusHit(c) && condHit(c, live)
    && quickSearchHit(q, [c.title, c.employees?.name, c.employees?.department, stLabel(c)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [contractList, statusFilter, live, q]);
  const cfSpec = (k: keyof ReturnType<typeof colVal>) => cf.spec(k, base.map((c) => colVal(c)[k]));
  const filteredContracts = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (c: any): string => {
      switch (sort.key) {
        case "title": return c.title || "";
        case "emp": return c.employees?.name || "";
        case "dept": return c.employees?.department || "";
        case "status": return stLabel(c);
        case "sent": return c.sent_at || "";
        case "completed": return c.completed_at || "";
        default: return c.created_at || "";
      }
    };
    return base.filter((c) => cf.hit(colVal(c))).sort((a, b) => cmp(val(a), val(b)) * dir);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, sort, cf.key]);
  const previewCount = (contractList as any[]).filter((c) => statusHit(c) && condHit(c, draft)).length;
  const pager = usePager(filteredContracts, live.rows, `${statusFilter}|${q}|${JSON.stringify(live)}|${cf.key}`);
  const drop = (patch: Partial<CaCond>) => { const n = { ...live, ...patch }; setLive(n); setDraft(n); };
  const clearAll = () => { setLive(CA_EMPTY); setDraft(CA_EMPTY); setQ(""); cf.clear(); setStatusFilter("all"); };
  const chips: AppliedChip[] = [
    ...(q ? [{ group: "빠른검색", label: q, onRemove: () => setQ("") }] : []),
    ...live.emp.map((v) => ({ group: "직원", label: v, onRemove: () => drop({ emp: live.emp.filter((x) => x !== v) }) })),
    ...live.dept.map((v) => ({ group: "부서", label: v, onRemove: () => drop({ dept: live.dept.filter((x) => x !== v) }) })),
    ...((live.cFrom || live.cTo) ? [{ group: "생성일", label: `${live.cFrom || "처음"} ~ ${live.cTo || "오늘"}`, onRemove: () => drop({ cFrom: "", cTo: "" }) }] : []),
    ...((live.sFrom || live.sTo) ? [{ group: "발송일", label: `${live.sFrom || "처음"} ~ ${live.sTo || "오늘"}`, onRemove: () => drop({ sFrom: "", sTo: "" }) }] : []),
    ...cf.active.map((a) => ({ group: "칸 필터", label: `${({ emp: "구성원", dept: "부서", status: "상태" } as Record<string, string>)[a.k] || a.k} ${a.n}개`, onRemove: () => cf.clear(a.k) })),
  ];
  const draftRows = filteredContracts.filter((c: any) => c.status === "draft");

  // 상태별 카운트
  const statusCounts = {
    all: contractList.length,
    draft: contractList.filter((c: any) => c.status === "draft").length,
    sent: contractList.filter((c: any) => c.status === "sent" || c.status === "partially_signed").length,
    completed: contractList.filter((c: any) => c.status === "completed").length,
    cancelled: contractList.filter((c: any) => c.status === "cancelled").length,
  };

  return (
    <QueryScreen>
      <QueryHead>
        {tabs}
        <QueryBar>
          <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen} activeCount={caCount(live)}
            foot={<>
              <button type="button" className="btn-secondary btn-sm" disabled={caCount(draft) === 0}
                onClick={() => setDraft({ ...CA_EMPTY, rows: draft.rows })}>조건 지우기</button>
              <span className="ml-auto text-[11px] text-[var(--text-dim)]">{previewCount.toLocaleString("ko")}건</span>
              <RowsPerPage value={draft.rows} onChange={setD("rows")} />
              <button type="button" className="btn-primary btn-sm" onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
            </>}>
            <ConditionRow label="직원" hint="여러 명">
              <TokenField items={empOpts} value={draft.emp} onChange={setD("emp")} placeholder="이름 일부" />
            </ConditionRow>
            <ConditionRow label="부서" hint="여러 개">
              <TokenField items={deptOpts} value={draft.dept} onChange={setD("dept")} placeholder="부서 이름 일부" />
            </ConditionRow>
            <ConditionRow label="생성일" hint="비우면 전체">
              <DateRangeField label={null} from={draft.cFrom} to={draft.cTo} onChange={(f, t) => setDraft((c) => ({ ...c, cFrom: f, cTo: t }))} onClear={() => setDraft((c) => ({ ...c, cFrom: "", cTo: "" }))} />
            </ConditionRow>
            <ConditionRow label="발송일" hint="발송된 것만 걸린다">
              <DateRangeField label={null} from={draft.sFrom} to={draft.sTo} onChange={(f, t) => setDraft((c) => ({ ...c, sFrom: f, sTo: t }))} onClear={() => setDraft((c) => ({ ...c, sFrom: "", sTo: "" }))} />
            </ConditionRow>
          </ConditionPanel>
          <QuickSearch value={q} onApply={setQ} placeholder="계약 제목 · 직원 · 부서 · 상태 — 쉼표로 여러 개, Enter" />
          {/* 상태 칩 — 갈래를 바로 바꾸는 값 하나짜리라 조회 줄에 둔다 */}
          <ChipGroup value={statusFilter} onChange={(v) => { setStatusFilter(v); setSelectedIds(new Set()); }}
            options={STATUS_CHIPS.map((c) => ({ value: c.value as string, label: (statusCounts as any)[c.value] > 0 ? `${c.label} ${(statusCounts as any)[c.value]}` : c.label }))} />
        </QueryBar>
        <AppliedChips chips={chips} onClearAll={clearAll} />
        <ResultStrip right={<span className="text-[11px] text-[var(--text-dim)]">표시 <b className="mono-number">{filteredContracts.length}</b>건</span>}>
          <Stat label="전체" value={`${statusCounts.all}건`} />
          <Stat label="임시저장" value={`${statusCounts.draft}건`} tone={statusCounts.draft > 0 ? "minus" : undefined} />
          <Stat label="진행 중" value={`${statusCounts.sent}건`} />
          <Stat label="완료" value={`${statusCounts.completed}건`} tone="plus" />
          <Stat label="취소" value={`${statusCounts.cancelled}건`} />
        </ResultStrip>
      </QueryHead>

      <QueryBody>
      <div className="ev-scroll ca-scroll">
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
              <RichEditor ref={editorRef} content={newTemplateBody} onChange={setNewTemplateBody} placeholder="계약서 내용을 입력하세요... {{직원명}}, {{부서}} 등의 변수를 사용할 수 있습니다. 📎 PDF 그대로 버튼으로 PDF 서식을 원본 모양 그대로 가져올 수 있습니다." maxHeight="calc(80vh - 220px)" contentMaxWidth="794px"
                onUploadImage={async (file) => {
                  // PDF 페이지 이미지를 DB(content_json)가 아닌 스토리지에 — 여러 페이지도 서식이 가벼움
                  const u = await getCurrentUser();
                  if (!u) throw new Error("로그인 정보를 확인할 수 없습니다");
                  const res = await uploadFile({ companyId, bucket: "company-assets", file, userId: u.id });
                  return res.fileUrl;
                }} />
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
                      {t.is_builtin && <span className="text-[9px] text-amber-500 mr-1"><Ico e="🔒" /></span>}
                      {t.is_active === false && <span className="text-[9px] text-amber-500 mr-1"><Ico e="📝" /></span>}
                      {t.name}
                    </button>
                    {!t.is_builtin && (
                      <button onClick={() => deleteTemplate(t.id)} className="text-xs text-red-400 hover:text-red-500 px-1" title="삭제">×</button>
                    )}
                  </div>
                ))}
              </div>
              <p className="text-[10px] text-[var(--text-dim)] mt-1"><Ico e="🔒" /> 내장 · 📝 임시저장 · 클릭하면 에디터에 로드</p>
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

      {/* 회사 문서(법인 서류)는 회사 설정 › 회사정보 › 회사 문서로 이관(2026-07-23). 여기선 발송/현황만. */}
      {contractSubTab === "contracts" && <>
      {/* 계약 내역 — 표 하나. 임시저장 줄만 고를 수 있고(발송 대상), 일괄 발송은 바닥 선택 바의 파란 버튼 */}
      {filteredContracts.length === 0 ? (
        <div className="collect-empty">
          {contractList.length === 0
            ? <>계약 내역이 없습니다 — 구성원 &gt; 인력관리에서 직원을 선택해 계약서를 발송하세요</>
            : <>이 조건에 맞는 계약이 없습니다 — 검색조건을 풀어 보세요</>}
        </div>
      ) : (
        <table ref={tableRef} className="ev-table ev-lined ca-table">
          <thead>
            <tr>
              <th className="w-10">
                {draftRows.length > 0 && (
                  <button type="button" aria-label="이 쪽 임시저장 전체 선택"
                    onClick={() => {
                      const ids = (pager.view as any[]).filter((c) => c.status === "draft").map((c) => c.id);
                      const all = ids.length > 0 && ids.every((id) => selectedIds.has(id));
                      const next = new Set(selectedIds);
                      if (all) ids.forEach((id) => next.delete(id)); else ids.forEach((id) => next.add(id));
                      setSelectedIds(next);
                    }}
                    className={(pager.view as any[]).some((c) => c.status === "draft") && (pager.view as any[]).filter((c) => c.status === "draft").every((c) => selectedIds.has(c.id)) ? "collect-chk collect-chk-on" : "collect-chk"}>
                    {(pager.view as any[]).some((c) => c.status === "draft") && (pager.view as any[]).filter((c) => c.status === "draft").every((c) => selectedIds.has(c.id)) ? "✓" : ""}
                  </button>
                )}
              </th>
              <SortableTh label="계약" sortKey="title" sort={sort} onSort={onSort} resize={thResize("title", 2)} />
              <SortableTh label="구성원" sortKey="emp" sort={sort} onSort={onSort} filter={cfSpec("emp")} resize={thResize("emp", 3)} />
              <SortableTh label="부서" sortKey="dept" sort={sort} onSort={onSort} filter={cfSpec("dept")} resize={thResize("dept", 4)} />
              <SortableTh label="상태" sortKey="status" sort={sort} onSort={onSort} filter={cfSpec("status")} resize={thResize("status", 5)} />
              <SortableTh label="생성" sortKey="created" sort={sort} onSort={onSort} resize={thResize("created", 6)} />
              <SortableTh label="발송" sortKey="sent" sort={sort} onSort={onSort} resize={thResize("sent", 7)} />
              <SortableTh label="완료" sortKey="completed" sort={sort} onSort={onSort} resize={thResize("completed", 8)} />
              <SortableTh label="액션" resize={thResize("action", 9)} />
            </tr>
          </thead>
          <tbody>
          {(pager.view as any[]).map((p: any) => {
            const st = PACKAGE_STATUS[p.status as keyof typeof PACKAGE_STATUS] || PACKAGE_STATUS.draft;
            return (
              <tr key={p.id} className={selectedIds.has(p.id) ? "ca-row ca-row-on" : "ca-row"}>
                <td className="text-center">
                  {p.status === "draft" && (
                    <button type="button" aria-label="선택" onClick={() => toggleSelect(p.id)}
                      className={selectedIds.has(p.id) ? "collect-chk collect-chk-on" : "collect-chk"}>{selectedIds.has(p.id) ? "✓" : ""}</button>
                  )}
                </td>
                <td className="text-left font-semibold truncate" title={p.title}>{p.title}</td>
                <td className="text-center">{p.employees?.name || "미지정"}</td>
                <td className="text-center">{p.employees?.department || "—"}</td>
                <td className="text-center"><span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${st.bg} ${st.text}`}>{st.label}</span></td>
                <td className="text-center mono-number">{day(p.created_at) || "—"}</td>
                <td className="text-center mono-number">{day(p.sent_at) || "—"}</td>
                <td className="text-center mono-number">{day(p.completed_at) || "—"}</td>
                <td className="text-center">
                  <div className="flex gap-1 justify-center">
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
                          className="px-2 py-1 text-[11px] text-[var(--text-dim)] hover:text-red-400 rounded-lg hover:bg-red-500/10 transition"
                        >
                          삭제
                        </button>
                      </>
                    )}
                    {(p.status === "sent" || p.status === "partially_signed") && (
                      <button
                        onClick={() => handleSendSignRequest(p.id)}
                        disabled={sending === p.id}
                        className="px-2 py-1 text-[11px] font-medium text-blue-400 rounded-lg hover:bg-blue-500/10 transition"
                      >
                        {sending === p.id ? "발송 중..." : "재발송"}
                      </button>
                    )}
                    {p.status === "completed" && (
                      <>
                        <button
                          onClick={() => p.sign_token && window.open(`/sign?token=${p.sign_token}`, "_blank", "noopener")}
                          className="px-2 py-1 text-[11px] font-medium text-green-400 rounded-lg hover:bg-green-500/10 transition flex items-center gap-1"
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
                      className="px-2 py-1 text-[11px] font-medium text-orange-500 rounded-lg hover:bg-orange-500/10 transition disabled:opacity-50 flex items-center gap-1"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"/></svg>
                      {sealApplying === p.id ? "적용 중..." : "직인 적용"}
                    </button>
                  </div>
                </td>
              </tr>
            );
          })}
          </tbody>
        </table>
      )}

      {/* 기존 계약 이력(유효 근로계약) — 같은 상자 안 두 번째 구역, 선으로 가른다 */}
      {contracts.length > 0 && (
        <div className="ca-history">
          <h3 className="ca-history-title">계약 이력 <small>{contracts.length}건</small></h3>
          <table className="ev-table ev-lined ca-hist-table">
            <thead><tr>
              <th>구성원</th>
              <th>계약유형</th>
              <th>기간</th>
              <th>급여</th>
              <th>상태</th>
            </tr></thead>
            <tbody>
              {contracts.map((c: any) => (
                <tr key={c.id}>
                  <td className="text-center font-medium">{c.employees?.name || "—"}</td>
                  <td className="text-center">{CONTRACT_TYPES.find(t => t.value === c.contract_type)?.label || c.contract_type}</td>
                  <td className="text-center mono-number">{c.start_date} ~ {c.end_date || "무기한"}</td>
                  <td className="text-right mono-number">{c.salary ? `₩${Number(c.salary).toLocaleString()}` : "—"}</td>
                  <td className="text-center">
                    <span className={`text-xs px-2 py-0.5 rounded-full ${c.status === 'active' ? 'bg-green-500/10 text-green-400' : 'bg-gray-500/10 text-gray-400'}`}>{c.status === 'active' ? '유효' : c.status}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      </>}
      </div>

      {/* 일괄 발송 — 고른 순간에만 뜨는 바닥 바. 파란(확정) 버튼은 화면을 통틀어 여기 하나 */}
      <SelectionBar count={selectedIds.size} summary="임시저장 계약" onClear={() => setSelectedIds(new Set())}>
        <button type="button" onClick={handleBatchSend} disabled={batchSending} className="btn-primary btn-sm whitespace-nowrap">
          {batchSending ? "발송 중..." : `일괄 발송 (${selectedIds.size}건)`}
        </button>
      </SelectionBar>
      </QueryBody>

      <Pager page={pager.page} pages={pager.pages} total={filteredContracts.length} size={live.rows}
        from={pager.from} to={pager.to} onPage={pager.setPage} />

      {/* 개별 발송 동선 안내 — 구성원 상세 › 근로계약과 연결 */}
      <div className="collect-note">
        개별 직원의 근로·연봉계약 발송은 <Link href="/employees" className="text-[var(--primary)] font-semibold hover:underline no-underline">구성원 상세 › 근로계약</Link>에서 하세요. 이 탭은 <b className="text-[var(--text)]">회사 전체 일괄 발송과 서명 현황</b>을 관리합니다.
      </div>
    </QueryScreen>
  );
}
