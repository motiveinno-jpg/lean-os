"use client";

/**
 * 전자서명 통합 대시보드
 * - 전체 서명 요청 현황 (상태별 카운트)
 * - 필터/검색
 * - 일괄 리마인더
 * - 새 서명 요청 (문서 선택 → 다중 서명자 초대)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { friendlyError } from "@/lib/friendly-error";
// 단체일괄 행에서 계약서 상세/PDF 진입용 router (2026-05-21 PR-B)
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, getDocuments, getDocTemplates } from "@/lib/queries";
import { TemplatesTab } from "@/components/templates-tab";
import ContractTemplatesManager from "@/components/contract-templates-manager";
import {
  getSignatureRequests,
  getSignatureProof,
  sendSignatureReminder,
  bulkSendReminders,
  cancelSignature,
  deleteSignatureRequest,
  getSignatureStatusInfo,
  SIGNATURE_STATUS,
  type SignatureStatusValue,
} from "@/lib/signatures";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { useDocumentViewer } from "@/contexts/document-viewer-context";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { uniquePdfName, downloadBlob } from "./_components/pdf-utils";
import { FailurePanel } from "./_components/FailurePanel";
import { InviteModal } from "./_components/InviteModal";
import { OrgBulkWizard } from "./_components/OrgBulkWizard";
import { DocumentTemplatesPanel } from "@/components/document-templates-panel";

export default function SignaturesDashboardPage() {
  const { role } = useUser();
  // 직원도 전자계약 발송 가능. 외부 파트너만 차단. (영구 삭제·발송실패 패널은 아래에서 관리자 전용)
  if (role === "partner") {
    return <AccessDenied detail="전자서명 대시보드는 회사 구성원 전용입니다." />;
  }
  const { toast } = useToast();
  const qc = useQueryClient();
  const { open: openDocViewer } = useDocumentViewer();
  const [userId, setUserId] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<"requests" | "templates">("requests");
  const [statusFilter, setStatusFilter] = useState<"all" | SignatureStatusValue>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showInviteModal, setShowInviteModal] = useState(false);
  const [showOrgBulkWizard, setShowOrgBulkWizard] = useState(false);
  const searchParams = useSearchParams();
  useEffect(() => { if (searchParams.get("bulk") === "1") setShowOrgBulkWizard(true); }, [searchParams]);
  // U4 페이지네이션 — 한 페이지 10/25/50건. 필터/검색 변경 시 1페이지 리셋.
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState<number>(1);
  // PR-3: signed 행 서명본 보기 모달 (signature_data jsonb 이미지)
  // 2026-05-28 signer_inputs(라디오/조건부 텍스트 응답) 표시 추가
  const [viewSignedRow, setViewSignedRow] = useState<{ id: string; signer_name: string; signed_at: string | null; signature_data: { type?: string; data?: string } | null; title: string; signer_inputs?: Record<string, string> | null } | null>(null);
  // 2026-05-29 발송 실패 패널 (최근 7일) — 대표/관리자만 노출, RLS 자동 차단.
  //   role 이 employee/partner 면 컴포넌트 상단에서 이미 AccessDenied 로 차단되므로
  //   여기까지 도달했다는 건 owner/admin. RLS 가 2차 안전망.
  const [showFailurePanel, setShowFailurePanel] = useState(false);
  // 일괄 PDF 저장 — 현재 필터+검색 결과 중 서명완료 건을 한 zip 으로 (서버 네이티브 렌더)
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const isManager = role === "owner" || role === "admin";
  useEffect(() => { setPage(1); }, [statusFilter, search, pageSize]);

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setUserId(u.id);
        setCompanyId(u.company_id);
      }
    });
  }, []);

  const { data: requests = [], isLoading, error } = useQuery({
    queryKey: ["signature-requests", companyId],
    queryFn: () => getSignatureRequests(companyId!),
    enabled: !!companyId,
    refetchInterval: 30_000,
  });

  const { data: documents = [] } = useQuery({
    queryKey: ["documents-for-sign", companyId],
    queryFn: () => getDocuments(companyId!),
    enabled: !!companyId,
  });

  // 양식 관리 탭 — 전자계약(비즈니스) 양식 doc_templates
  const { data: docTemplates = [] } = useQuery({
    queryKey: ["doc-templates", companyId],
    queryFn: () => getDocTemplates(companyId!),
    enabled: !!companyId,
  });

  const filtered = useMemo(() => {
    return (requests as any[]).filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.title || ""} ${r.signer_name || ""} ${r.signer_email || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [requests, statusFilter, search]);

  // 현재 필터+검색 결과 중 서명완료 건 (일괄 PDF 대상)
  const signedFiltered = useMemo(
    () => (filtered as any[]).filter((r) => r.status === "signed"),
    [filtered],
  );
  // 체크박스로 고른 서명완료 건 (선택이 있으면 이것만 PDF 대상)
  const selectedSignedTargets = useMemo(
    () => signedFiltered.filter((r) => selectedIds.has(r.id)),
    [signedFiltered, selectedIds],
  );
  const allSignedSelected =
    signedFiltered.length > 0 && selectedSignedTargets.length === signedFiltered.length;

  // 서명완료 계약서 일괄 PDF 저장 — 서버(headless Chrome)가 단건 인쇄와 동일 품질로 렌더,
  // 업체별 1파일(`소상공인 개별계약서_(업체명).pdf`)을 zip 한 개로.
  const handleBulkExport = useCallback(async () => {
    if (exporting) return;
    // 선택한 서명완료 건만 저장 (전체 일괄저장 제거 — 2026-06-29)
    const targets = selectedSignedTargets;
    if (targets.length === 0) {
      toast("저장할 서명완료 계약을 먼저 선택하세요", "error");
      return;
    }
    // 업체명 = partners.name (리스트엔 partner_id 만 있어 별도 조회). 없으면 signer_name fallback.
    const partnerIds = [...new Set(targets.map((t) => t.partner_id).filter(Boolean))];
    const nameMap = new Map<string, string>();
    if (partnerIds.length) {
      const { data } = await (supabase as any).from("partners").select("id, name").in("id", partnerIds);
      (data || []).forEach((p: any) => p?.name && nameMap.set(p.id, p.name));
    }
    const nameById = new Map<string, string>(
      targets.map((t) => [t.id, (t.partner_id && nameMap.get(t.partner_id)) || t.signer_name || "무명"]),
    );

    setExporting(true);
    setExportProgress({ done: 0, total: targets.length });
    try {
      const JSZip = (await import("jszip")).default;
      const zip = new JSZip();
      const used = new Set<string>();
      const failed: string[] = [];
      const ids = targets.map((t) => t.id);
      const CHUNK = 8; // 서버 타임아웃 회피 — chunk 당 짧게
      let done = 0;
      for (let i = 0; i < ids.length; i += CHUNK) {
        const chunk = ids.slice(i, i + CHUNK);
        const res = await fetch("/api/contract-pdf", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids: chunk }),
        });
        if (!res.ok) {
          const j = await res.json().catch(() => ({}));
          throw new Error(j?.error || `PDF 서버 오류 (${res.status})`);
        }
        const { results } = await res.json();
        for (const r of results as { id: string; pdfBase64?: string }[]) {
          const company = nameById.get(r.id) || "무명";
          if (r.pdfBase64) zip.file(uniquePdfName(used, company), r.pdfBase64, { base64: true });
          else failed.push(company);
          done++;
          setExportProgress({ done, total: targets.length });
        }
      }
      const blob = await zip.generateAsync({ type: "blob" });
      downloadBlob(blob, "소상공인_개별계약서_일괄.zip");
      toast(
        `PDF ${targets.length - failed.length}건 저장 완료${failed.length ? `, ${failed.length}건 실패` : ""}`,
        failed.length ? "error" : "success",
      );
    } catch (e: any) {
      toast(friendlyError(e, "PDF 생성에 실패했습니다"), "error");
    } finally {
      setExporting(false);
      setExportProgress(null);
    }
  }, [exporting, selectedSignedTargets, signedFiltered, toast]);

  // 서명완료 전체 선택 / 해제 (PDF 대상 빠른 지정)
  const toggleSelectAllSigned = useCallback(() => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (allSignedSelected) {
        signedFiltered.forEach((r) => next.delete(r.id));
      } else {
        signedFiltered.forEach((r) => next.add(r.id));
      }
      return next;
    });
  }, [allSignedSelected, signedFiltered]);

  // 단체일괄 "우리 서명 일괄 적용" UI 는 2026-05-21 사용자 요청으로 제거됨 (동작 미완료).
  //   백엔드 RPC submit_our_signature_bulk 는 보존 (마이그·DB 미터치, 향후 재사용 가능).

  const counts = useMemo(() => {
    const map: Record<string, number> = { all: requests.length };
    for (const s of SIGNATURE_STATUS) map[s.value] = 0;
    for (const r of requests as any[]) {
      map[r.status] = (map[r.status] || 0) + 1;
    }
    return map;
  }, [requests]);

  // 최근 7일 발송 실패 요약 — 대표/관리자만, 1분마다 폴링.
  const { data: failureSummary = [] } = useQuery({
    queryKey: ["signature-failure-summary", companyId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("get_recent_send_failures_summary", { p_days: 7 });
      if (error) throw error;
      return (data || []) as { error_code: string; count: number; latest_failed_at: string }[];
    },
    enabled: !!companyId && isManager,
    refetchInterval: 60_000,
  });
  const totalFailures = useMemo(
    () => failureSummary.reduce((acc, r) => acc + Number(r.count || 0), 0),
    [failureSummary],
  );

  const reminderMut = useMutation({
    mutationFn: (id: string) => sendSignatureReminder(id),
    onSuccess: (r) => {
      if (r.success) toast("리마인더 발송됨", "success");
      else toast(r.error || "리마인더 실패", "error");
      qc.invalidateQueries({ queryKey: ["signature-requests"] });
    },
    onError: (err: any) => toast("리마인더 발송 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const bulkRemindMut = useMutation({
    mutationFn: (ids: string[]) => bulkSendReminders(ids),
    onSuccess: (r) => {
      toast(`발송 ${r.sent} / 실패 ${r.failed}`, r.failed === 0 ? "success" : "error");
      qc.invalidateQueries({ queryKey: ["signature-requests"] });
      setSelectedIds(new Set());
    },
    onError: (err: any) => toast("일괄 리마인더 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const cancelMut = useMutation({
    mutationFn: (id: string) => cancelSignature(id),
    onSuccess: () => {
      toast("취소되었습니다", "success");
      qc.invalidateQueries({ queryKey: ["signature-requests"] });
    },
    onError: (err: any) => toast("서명 취소 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  // 영구 삭제 — 취소(soft)와 별개. 행 완전 삭제 + 선택목록에서 제거.
  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteSignatureRequest(id),
    onSuccess: (_d, id) => {
      toast("삭제되었습니다", "success");
      setSelectedIds((prev) => { const next = new Set(prev); next.delete(id); return next; });
      qc.invalidateQueries({ queryKey: ["signature-requests"] });
    },
    onError: (err: any) => toast("삭제 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const toggleSel = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const remindableSelected = useMemo(() => {
    return Array.from(selectedIds).filter((id) => {
      const r = (requests as any[]).find((x) => x.id === id);
      return r && r.status !== "signed" && r.status !== "expired" && r.status !== "rejected";
    });
  }, [selectedIds, requests]);

  if (!companyId) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;
  if (error) return <div className="p-6 text-center text-red-400">데이터를 불러올 수 없습니다. 새로고침해 주세요.</div>;

  return (
    <div className="space-y-6">
      {/* 툴바 — 탭 토글(서명 요청 / 양식 관리) + 액션 */}
      <header className="page-sticky-header flex flex-wrap items-center justify-between gap-2">
        <div className="seg-bar">
          <button
            onClick={() => setSubTab("requests")}
            className={`seg-item ${subTab === "requests" ? "seg-item-active" : ""}`}
          >
            서명 요청
          </button>
          <button
            onClick={() => setSubTab("templates")}
            className={`seg-item ${subTab === "templates" ? "seg-item-active" : ""}`}
          >
            양식 관리
          </button>
        </div>
        {subTab === "requests" && (
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowOrgBulkWizard(true)}
              className="btn-secondary"
              title="여러 거래처(미가입 단체)에 같은 계약서를 변수만 바꿔 한 번에 발송"
            >
              + 단체 일괄 발송
            </button>
            <button
              onClick={() => setShowInviteModal(true)}
              className="btn-primary"
            >
              + 새 서명 요청
            </button>
          </div>
        )}
      </header>

      {subTab === "templates" && companyId && userId && (
        <div className="space-y-6">
          {/* 온라인홍보사업 계약서·포기신청서 등 — "단체 일괄 발송"/"새 서명 요청"에서 실제 사용되는
              문서(documents 테이블) 원본을 여기서 바로 보고 수정. OrgBulkWizard/InviteModal 이 같은
              데이터(getDocuments)를 그대로 읽으므로 여기서 수정하면 발송 시 바로 반영됨. */}
          <DocumentTemplatesPanel
            companyId={companyId}
            userId={userId}
            documents={documents as any[]}
            onSaved={() => qc.invalidateQueries({ queryKey: ["documents-for-sign", companyId] })}
          />
          <TemplatesTab
            scope="business"
            companyId={companyId}
            userId={userId}
            templates={docTemplates as any[]}
            onInvalidate={() => qc.invalidateQueries({ queryKey: ["doc-templates", companyId] })}
          />
          {/* 계약서 본문 양식(변수 치환형) — 회사설정에서 이관 (2026-07-01) */}
          <ContractTemplatesManager companyId={companyId} />
        </div>
      )}

      {subTab === "requests" && (
        <>

      {/* 최근 7일 발송 실패 (대표/관리자만, 실패가 있을 때만 노출) */}
      {isManager && totalFailures > 0 && (
        <button
          onClick={() => setShowFailurePanel(true)}
          className="w-full flex items-center justify-between gap-3 p-3 rounded-xl bg-red-500/10 border border-red-500/30 text-red-500 hover:bg-red-500/15 transition text-left"
          title="최근 7일간 이메일 발송에 실패한 건을 확인하고 재발송하세요"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center text-lg">⚠️</span>
            <div className="min-w-0">
              <div className="text-xs font-semibold">최근 7일 발송 실패</div>
              <div className="text-[11px] opacity-80 truncate">
                {failureSummary.length}가지 사유 · 클릭해서 사유별 상세 보기
              </div>
            </div>
          </div>
          <span className="shrink-0 px-2.5 py-1 rounded-full bg-red-500/20 text-xs font-bold tabular-nums">{totalFailures}건</span>
        </button>
      )}

      {/* 상태 카운트 카드 */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-3">
        <button
          onClick={() => setStatusFilter("all")}
          className={`p-4 rounded-xl text-left transition ${
            statusFilter === "all"
              ? "bg-[var(--primary)] text-white shadow-md"
              : "glass-card card-hover"
          }`}
        >
          <div className={`text-[11px] font-semibold uppercase tracking-wider ${statusFilter === "all" ? "text-white/80" : "text-[var(--text-dim)]"}`}>전체</div>
          <div className={`text-2xl font-black mono-number mt-0.5 ${statusFilter === "all" ? "text-white" : "text-[var(--text)]"}`}>{counts.all || 0}</div>
        </button>
        {SIGNATURE_STATUS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`p-4 rounded-xl text-left transition ${
              statusFilter === s.value
                ? `${s.bg} ${s.text} ring-2 ring-current/30`
                : "glass-card card-hover"
            }`}
          >
            <div className={`text-[11px] font-semibold flex items-center gap-1.5 ${s.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} />
              {s.label}
            </div>
            <div className="text-2xl font-black mono-number mt-0.5 text-[var(--text)]">{counts[s.value] || 0}</div>
          </button>
        ))}
      </div>

      {/* 검색 / 일괄 액션 */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <svg className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--text-dim)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="7" strokeWidth={2} /><path strokeLinecap="round" strokeWidth={2} d="M21 21l-4.3-4.3" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="제목·서명자 검색..."
            className="field-input pl-10"
          />
        </div>
        {signedFiltered.length > 0 && (
          <>
            <button
              onClick={toggleSelectAllSigned}
              disabled={exporting}
              className="btn-secondary btn-sm whitespace-nowrap"
              title="현재 목록의 서명완료 계약서를 모두 선택/해제"
            >
              {allSignedSelected ? "☑ 서명완료 전체해제" : "☐ 서명완료 전체선택"}
            </button>
            <button
              onClick={handleBulkExport}
              disabled={exporting || selectedSignedTargets.length === 0}
              className="btn-secondary btn-sm whitespace-nowrap"
              title="체크한 서명완료 계약서를 단건 인쇄와 동일한 품질의 PDF 로 저장 (파일명: 소상공인 개별계약서_업체명)"
            >
              {exporting
                ? `PDF 생성 중… ${exportProgress?.done ?? 0}/${exportProgress?.total ?? 0}`
                : `선택한 ${selectedSignedTargets.length}건 PDF 저장`}
            </button>
          </>
        )}
        {selectedIds.size > 0 && (
          <>
            <span className="text-xs text-[var(--text-muted)]">{selectedIds.size}건 선택됨</span>
            <button
              onClick={() => bulkRemindMut.mutate(remindableSelected)}
              disabled={remindableSelected.length === 0 || bulkRemindMut.isPending}
              className="btn-secondary btn-sm whitespace-nowrap"
            >
              일괄 리마인더 ({remindableSelected.length})
            </button>
            <button
              onClick={() => setSelectedIds(new Set())}
              className="btn-ghost btn-sm"
            >
              선택 해제
            </button>
          </>
        )}
      </div>

      {/* 서명 요청 카드 리스트 (시안) */}
      <div className="space-y-3">
        {isLoading ? (
          <div className="glass-card p-10 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="glass-card py-16 px-6 text-center">
            <div className="text-5xl mb-4">✍️</div>
            <div className="text-base font-bold text-[var(--text)]">문서에 서명을 요청해보세요</div>
            <div className="text-xs text-[var(--text-muted)] mt-1.5">계약서, NDA 등 문서에 전자서명을 받을 수 있습니다</div>
            <button onClick={() => setShowInviteModal(true)} className="btn-primary mt-5">+ 서명 요청</button>
          </div>
        ) : (
          filtered.slice((page - 1) * pageSize, page * pageSize).map((r: any) => {
            const info = getSignatureStatusInfo(r.status);
            const expired = r.expires_at && new Date(r.expires_at) < new Date();
            const canRemind = r.status !== "signed" && r.status !== "expired" && r.status !== "rejected";
            return (
              <div key={r.id} className="group glass-card p-5 flex items-start gap-4">
                <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSel(r.id)} className="mt-1.5 accent-[var(--primary)] shrink-0" aria-label="선택" />
                <span className="kpi-icon shrink-0">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>
                </span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5 flex-wrap mb-0.5">
                        <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${info.bg} ${info.text}`}>
                          <span className={`w-1.5 h-1.5 rounded-full ${info.dot}`} />{info.label}
                        </span>
                        {r.batch_id && (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-semibold bg-[var(--primary)]/10 text-[var(--primary)]" title={`묶음 발송 #${r.batch_seq ?? "?"}`}>
                            📦 묶음{r.batch_seq ? ` #${r.batch_seq}` : ""}
                          </span>
                        )}
                      </div>
                      {/* 제목 클릭 → 상태 무관 항상 계약서 팝업(읽기 전용). 발송/열람도 편집화면 대신 팝업. */}
                      <button onClick={() => openDocViewer({ type: 'contract', id: r.id })} className="block w-full text-left text-sm font-semibold text-[var(--text)] hover:text-[var(--primary)] hover:underline truncate" title="계약서 보기">{r.title}</button>
                      {r.documents?.name && <div className="text-[10px] text-[var(--text-dim)] truncate">{r.documents.name}</div>}
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {canRemind && (
                        <button onClick={() => reminderMut.mutate(r.id)} disabled={reminderMut.isPending} className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-sm hover:bg-[var(--bg-surface)] transition disabled:opacity-50" aria-label="리마인더 발송" title="리마인더 발송">🔔</button>
                      )}
                      {r.sign_token && r.status !== 'signed' && (
                        <a href={`/sign?token=${r.sign_token}`} target="_blank" rel="noopener noreferrer" className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-sm hover:bg-[var(--bg-surface)] transition" aria-label="서명 링크 열기" title="서명 링크">🔗</a>
                      )}
                      <button onClick={() => openDocViewer({ type: 'contract', id: r.id })} className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-sm hover:bg-[var(--bg-surface)] transition" aria-label="계약서 보기 / PDF 다운로드" title="이 계약서 보기 / PDF 다운로드">📄</button>
                      {r.status === 'signed' && (
                        <button onClick={async () => { const proof = await getSignatureProof(r.id); setViewSignedRow({ id: r.id, signer_name: r.signer_name, signed_at: r.signed_at, signature_data: proof.signature_data, title: r.title, signer_inputs: proof.signer_inputs }); }} className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-sm hover:bg-[var(--bg-surface)] transition" aria-label="서명본 보기" title="서명본 보기">✅</button>
                      )}
                      {canRemind && (
                        <button onClick={() => { if (confirm("이 서명 요청을 취소하시겠습니까?")) cancelMut.mutate(r.id); }} className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 transition" aria-label="서명 요청 취소" title="취소(만료 처리)">✕</button>
                      )}
                      {isManager && (
                        <button onClick={() => { if (confirm("이 서명 요청을 영구 삭제할까요?\n삭제하면 복구할 수 없습니다.")) deleteMut.mutate(r.id); }} disabled={deleteMut.isPending} className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 transition disabled:opacity-50" aria-label="영구 삭제" title="영구 삭제">🗑</button>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 mt-2 flex-wrap">
                    <span className="inline-flex items-center gap-2 bg-[var(--bg-surface)]/60 rounded-lg px-2.5 py-1">
                      <span className="w-6 h-6 rounded-full bg-[var(--primary)] flex items-center justify-center text-white text-[10px] font-semibold shrink-0">{(r.signer_name || "?").slice(0, 1)}</span>
                      <span className="min-w-0">
                        <span className="block text-xs font-medium text-[var(--text)] truncate">{r.signer_name}</span>
                        <span className="block text-[10px] text-[var(--text-dim)] truncate">{r.signer_email}</span>
                      </span>
                    </span>
                    <span className="text-[11px] text-[var(--text-dim)]">요청 {r.created_at ? new Date(r.created_at).toLocaleDateString("ko-KR") : "—"}</span>
                    <span className={`text-[11px] ${expired && r.status !== "signed" ? "text-red-500 font-semibold" : "text-[var(--text-dim)]"}`}>만료 {r.expires_at ? new Date(r.expires_at).toLocaleDateString("ko-KR") : "—"}</span>
                    {r.reminder_count ? <span className="text-[11px] text-[var(--text-dim)]">리마인더 {r.reminder_count}회</span> : null}
                    {r.delivery_status && (() => {
                      const m = ({
                        delivered: { t: "전달됨", c: "bg-green-500/10 text-green-500" },
                        bounced: { t: "반송됨", c: "bg-red-500/10 text-red-500" },
                        complained: { t: "스팸신고", c: "bg-red-500/10 text-red-500" },
                        delayed: { t: "전달지연", c: "bg-amber-500/10 text-amber-500" },
                      } as any)[r.delivery_status];
                      return m ? <span className={`text-[11px] px-1.5 py-0.5 rounded-full font-semibold ${m.c}`} title={r.delivery_detail || (r.delivery_at ? new Date(r.delivery_at).toLocaleString("ko-KR") : "")}>✉ {m.t}</span> : null;
                    })()}
                  </div>
                </div>
              </div>
            );
          })
        )}

        {/* 페이지네이션 */}
        {filtered.length > 0 && (() => {
          const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
          const curPage = Math.min(page, totalPages);
          return (
            <div className="glass-card flex items-center justify-between px-4 py-3 text-xs">
              <div className="text-[var(--text-muted)]">
                전체 {filtered.length}건 중 {(curPage - 1) * pageSize + 1}–{Math.min(curPage * pageSize, filtered.length)}
              </div>
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 text-[var(--text-muted)]">
                  페이지당
                  <select value={pageSize} onChange={(e) => setPageSize(Number(e.target.value))} className="px-2 py-1 rounded bg-[var(--bg-surface)] border border-[var(--border)] focus:outline-none focus:border-[var(--primary)]">
                    <option value={10}>10</option>
                    <option value={25}>25</option>
                    <option value={50}>50</option>
                  </select>
                </label>
                <div className="flex items-center gap-1">
                  <button disabled={curPage === 1} onClick={() => setPage(curPage - 1)} className="px-2 py-1 rounded bg-[var(--bg-surface)] disabled:opacity-30 hover:bg-[var(--border)]">←</button>
                  <span className="px-2 font-semibold">{curPage} / {totalPages}</span>
                  <button disabled={curPage === totalPages} onClick={() => setPage(curPage + 1)} className="px-2 py-1 rounded bg-[var(--bg-surface)] disabled:opacity-30 hover:bg-[var(--border)]">→</button>
                </div>
              </div>
            </div>
          );
        })()}
      </div>
        </>
      )}

      {showInviteModal && companyId && userId && (
        <InviteModal
          companyId={companyId}
          userId={userId}
          documents={documents as any[]}
          docTemplates={docTemplates as any[]}
          onClose={() => setShowInviteModal(false)}
          onCreated={() => {
            setShowInviteModal(false);
            qc.invalidateQueries({ queryKey: ["signature-requests"] });
            qc.invalidateQueries({ queryKey: ["documents-for-sign", companyId] });
          }}
        />
      )}

      {showOrgBulkWizard && companyId && userId && (
        <OrgBulkWizard
          companyId={companyId}
          userId={userId}
          documents={documents as any[]}
          docTemplates={docTemplates as any[]}
          onClose={() => setShowOrgBulkWizard(false)}
          onCreated={() => {
            setShowOrgBulkWizard(false);
            qc.invalidateQueries({ queryKey: ["signature-requests"] });
            qc.invalidateQueries({ queryKey: ["documents-for-sign", companyId] });
          }}
        />
      )}

      {/* PR-3: 서명본 보기 모달 (status='signed' 행) */}
      {viewSignedRow && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4" onClick={() => setViewSignedRow(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold">✅ 서명본</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">{viewSignedRow.title}</div>
              </div>
              <button onClick={() => setViewSignedRow(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl leading-none">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <div className="grid grid-cols-2 gap-3 text-xs">
                <div>
                  <div className="text-[var(--text-muted)] mb-1">서명자</div>
                  <div className="font-semibold">{viewSignedRow.signer_name}</div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)] mb-1">서명 시각 (KST)</div>
                  <div className="font-semibold">
                    {viewSignedRow.signed_at
                      ? new Date(viewSignedRow.signed_at).toLocaleString("ko-KR", { timeZone: "Asia/Seoul" })
                      : "—"}
                  </div>
                </div>
                <div>
                  <div className="text-[var(--text-muted)] mb-1">서명 방식</div>
                  <div className="font-semibold">
                    {viewSignedRow.signature_data?.type === "draw" ? "손글씨 서명"
                      : viewSignedRow.signature_data?.type === "type" ? "타이핑 서명"
                      : viewSignedRow.signature_data?.type === "upload" ? "도장/사인 업로드"
                      : "—"}
                  </div>
                </div>
              </div>
              <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--bg-surface)]/50">
                <div className="text-[10px] text-[var(--text-muted)] mb-2">서명 이미지</div>
                {viewSignedRow.signature_data?.data ? (
                  viewSignedRow.signature_data.type === "type" ? (
                    <div className="text-2xl font-bold py-4 text-center" style={{ fontFamily: "'Nanum Pen Script', cursive" }}>
                      {viewSignedRow.signature_data.data}
                    </div>
                  ) : (
                    <img
                      src={viewSignedRow.signature_data.data}
                      alt="서명"
                      className="max-w-full max-h-48 mx-auto bg-white rounded p-2"
                    />
                  )
                ) : (
                  <div className="text-xs text-[var(--text-muted)] text-center py-6">서명 이미지가 저장되어 있지 않습니다.</div>
                )}
              </div>
              {/* 2026-05-28 서명자 입력값(라디오/조건부 텍스트) — signer_inputs 가 있을 때만 노출 */}
              {viewSignedRow.signer_inputs && Object.keys(viewSignedRow.signer_inputs).length > 0 && (
                <div className="border border-[var(--border)] rounded-lg p-3 bg-[var(--bg-surface)]/50">
                  <div className="text-[10px] text-[var(--text-muted)] mb-2">서명자 입력값</div>
                  <div className="space-y-1.5 text-xs">
                    {Object.entries(viewSignedRow.signer_inputs).map(([k, v]) => (
                      <div key={k} className="flex items-start gap-2">
                        <span className="text-[var(--text-muted)] min-w-[80px]">{k}:</span>
                        <span className="font-semibold text-[var(--text)] flex-1">{String(v)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              {/* QA 2026-06-12: sign_token 없는 행(HR 패키지 등)은 빈 토큰 링크가 되던 버그 → 토큰 있을 때만 노출 */}
              {(() => {
                const token = (filtered.find((x) => x.id === viewSignedRow.id) as { sign_token?: string } | undefined)?.sign_token;
                return token ? (
                  <a
                    href={`/sign?token=${token}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="px-4 py-1.5 text-xs bg-[var(--bg-surface)] hover:bg-[var(--border)] text-[var(--text)] rounded-lg"
                  >
                    🔗 외부 보기
                  </a>
                ) : null;
              })()}
              <button onClick={() => setViewSignedRow(null)} className="px-4 py-1.5 text-xs bg-[var(--primary)] text-white rounded-lg font-semibold">닫기</button>
            </div>
          </div>
        </div>
      )}

      {/* 2026-05-29 발송 실패 패널 — 사유별 그룹 + 행 단위 재발송 */}
      {showFailurePanel && isManager && (
        <FailurePanel
          summary={failureSummary}
          onClose={() => setShowFailurePanel(false)}
          onRetried={() => {
            qc.invalidateQueries({ queryKey: ["signature-failure-summary"] });
            qc.invalidateQueries({ queryKey: ["signature-requests"] });
          }}
        />
      )}

    </div>
  );
}

