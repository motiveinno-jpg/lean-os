"use client";
import { kstDateStr } from "@/lib/kst";
import { DateRangeField } from "@/components/date-range-field";
import { Ico } from "@/components/ui-icon";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

/**
 * 전자서명 통합 대시보드
 * - 전체 서명 요청 현황 (상태별 카운트)
 * - 필터/검색
 * - 일괄 리마인더
 * - 새 서명 요청 (문서 선택 → 다중 서명자 초대)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { SortableTh, nextSort, useColFilters } from "@/components/sortable-th";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, SavedTabs, ConditionSave,
  ConditionPanel, ConditionRow, TokenField, AppliedChips, QuickSearch, quickSearchHit, quickTerms,
  RowsPerPage, Pager, usePager, useSavedQueries, SelectionBar, periodQuicks,
  type AppliedChip,
} from "@/components/query-kit";
import { useSearchParams } from "next/navigation";
import { friendlyError } from "@/lib/friendly-error";
// 단체일괄 행에서 계약서 상세/PDF 진입용 router (2026-05-21 PR-B)
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser, getDocuments } from "@/lib/queries";
import ContractTemplatesManager from "@/components/contract-templates-manager";
import { listContractTemplates, getHiddenContractTemplateIds, getContractTemplateOrder, sortTemplatesByOrder } from "@/lib/contract-templates";
import {
  getSignatureRequests,
  getSignatureProof,
  sendSignatureReminder,
  bulkSendReminders,
  cancelSignature,
  deleteSignatureRequest,
  getSignatureStatusInfo,
  expireOverdueSignatures,
  finalizeFullySignedDocuments,
  SIGNATURE_STATUS,
  type SignatureStatusValue,
} from "@/lib/signatures";
import { getContractIssuanceStatus } from "@/lib/billing";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { useDocumentViewer } from "@/contexts/document-viewer-context";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { uniquePdfName, downloadBlob } from "./_components/pdf-utils";
// 인사(근로계약·서식) 서식 카테고리 — hr-contracts.getContractTemplates 가 인사 화면에 노출하는 것과 같은 목록.
const HR_TEMPLATE_CATEGORIES = new Set([
  "salary_contract", "nda", "non_compete", "privacy_consent", "comprehensive_labor", "contract_labor",
]);
import { FailurePanel } from "./_components/FailurePanel";
import { OrgBulkWizard } from "./_components/OrgBulkWizard";
import { useModalKeys } from "@/hooks/use-modal-keys";

export default function SignaturesDashboardPage() {
  const { role } = useUser();
  // 직원도 전자계약 발송 가능. 외부 파트너만 차단. (영구 삭제·발송실패 패널은 아래에서 관리자 전용)
  // 게이트 early return 뒤 훅 = React #310 결함류 — 본문 분리 (2026-08-03)
  if (role === "partner") {
    return <AccessDenied detail="전자서명 대시보드는 회사 구성원 전용입니다." />;
  }
  return <SignaturesDashboardInner />;
}

function SignaturesDashboardInner() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { open: openDocViewer } = useDocumentViewer();
  const [userId, setUserId] = useState<string | null>(null);
  // user_preferences.user_id 는 auth.users(id) 를 참조한다 — users.id 와 다른 계정이 있어
  //   users.id 로 쓰면 조회·저장이 조용히 어긋난다(사이드바 고정핀에서 이미 겪은 함정).
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<"requests" | "templates">("requests");
  const [statusFilter, setStatusFilter] = useState<"all" | SignatureStatusValue>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showOrgBulkWizard, setShowOrgBulkWizard] = useState(false);
  const searchParams = useSearchParams();
  useEffect(() => { if (searchParams.get("bulk") === "1") setShowOrgBulkWizard(true); }, [searchParams]);
  // U4 페이지네이션 — 한 페이지 10/25/50건. 필터/검색 변경 시 1페이지 리셋.
  //   ── 조회 화면 표준 (2026-08-18 Wave 3) — 쪽은 usePager(기본 50). 검색조건은 '조회'를 눌러야 반영 ──
  const [rowsPer, setRowsPer] = useState(50);
  const [panelOpen, setPanelOpen] = useState(false);
  // 표 정렬·기간 설정 (2026-08-05 사장님 시안) — 마지막 값은 계정별로 서버에 기억한다.
  type SortKey = "docNo" | "status" | "batch" | "title" | "signer" | "manager" | "created" | "signed";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "created", dir: "desc" });
  const [reqFrom, setReqFrom] = useState("");   // 요청일 시작 (YYYY-MM-DD) — 조회 줄, 즉시. 빈 값 = 전체 기간
  const [reqTo, setReqTo] = useState("");       // 요청일 끝
  const [expFrom, setExpFrom] = useState("");   // 서명완료일 시작 — 검색조건 안
  const [expTo, setExpTo] = useState("");       // 서명완료일 끝
  //   검색조건 초안(draft) — 서명완료일·그룹·담당자는 '조회'를 눌러야 반영된다
  const [dExpFrom, setDExpFrom] = useState(""); const [dExpTo, setDExpTo] = useState("");
  const [dBatch, setDBatch] = useState<string[]>([]); const [dManager, setDManager] = useState<string[]>([]);
  // 그룹(묶음)·담당자 필터 — 그 값만 골라 보기 (2026-08-05 사장님 요청)
  const [batchFilter, setBatchFilter] = useState("");   // "" 전체 / "none" 묶음 없음 / batch_id  (표 안 묶음 칩으로도 건다)
  const [managerFilter, setManagerFilter] = useState(""); // "" 전체 / created_by(uuid)   (표 안 담당자 이름으로도 건다)
  // PR-3: signed 행 서명본 보기 모달 (signature_data jsonb 이미지)
  // 2026-05-28 signer_inputs(라디오/조건부 텍스트 응답) 표시 추가
  const [viewSignedRow, setViewSignedRow] = useState<{ id: string; signer_name: string; signed_at: string | null; signature_data: { type?: string; data?: string } | null; title: string; signer_inputs?: Record<string, string> | null } | null>(null);
  useModalKeys(!!viewSignedRow, () => setViewSignedRow(null));
  // 2026-05-29 발송 실패 패널 (최근 7일) — 대표/관리자만 노출, RLS 자동 차단.
  //   role 이 employee/partner 면 컴포넌트 상단에서 이미 AccessDenied 로 차단되므로
  //   여기까지 도달했다는 건 owner/admin. RLS 가 2차 안전망.
  const [showFailurePanel, setShowFailurePanel] = useState(false);
  // 일괄 PDF 저장 — 현재 필터+검색 결과 중 서명완료 건을 한 zip 으로 (서버 네이티브 렌더)
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState<{ done: number; total: number } | null>(null);
  const isManager = true; // (P3) 전자계약 권한 보유자 전원 관리 뷰 (진입 자체가 권한 게이트)
  //   목록 보기 설정을 계정(user_preferences.signature_list_prefs)에 기억하던 것은 뺐다 (2026-08-18 조회 화면 표준:
  //   조회값 자동 기억 금지 — 나갔다 오면 기본값). 편의는 '내 조건'(★ 기본, saved_queries)이 맡는다.
  const toggleSort = (key: SortKey) => setSort((c) => nextSort(c, key, key === "created" || key === "signed" ? "desc" : "asc"));

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setUserId(u.id);
        setCompanyId(u.company_id);
        // 만료일이 지난 요청을 실제 'expired' 로 정리한다 (2026-08-21 감사) — 이 함수를
        //   부르는 곳이 어디에도 없어 215건이 '발송' 으로 남아 통계의 만료 건수는 늘 0 이었고
        //   죽은 링크로 리마인더가 계속 나갔다. 화면을 열 때 그 회사 것만 훑는다.
        expireOverdueSignatures(u.company_id).catch(() => { /* 정리 실패가 목록을 막지 않는다 */ });
        // 외부 서명자가 메일 링크로 끝낸 계약은 익명 세션이라 문서 승인·잠금이 안 돈다 —
        //   권한 있는 이 세션에서 밀린 것을 마무리한다 (2026-08-21 감사).
        finalizeFullySignedDocuments(u.company_id).catch(() => { /* 무시 */ });
      }
    });
  }, []);

  const { data: requests = [], isLoading, error } = useQuery({
    queryKey: ["signature-requests", companyId],
    queryFn: () => getSignatureRequests(companyId!),
    enabled: !!companyId,
    refetchInterval: 30_000,
  });

  // 전자계약 월 발송 한도 (프로=20건, 울트라=무제한). 서버 강제는 signature_requests 트리거.
  const { data: contractStatus } = useQuery({
    queryKey: ["contract-issuance-status", companyId],
    queryFn: () => getContractIssuanceStatus(companyId!),
    enabled: !!companyId,
    staleTime: 60_000,
  });
  const contractLimitReached = !!contractStatus && contractStatus.limit !== null && (contractStatus.remaining ?? 0) <= 0;

  const { data: allDocuments = [] } = useQuery({
    queryKey: ["documents-for-sign", companyId],
    queryFn: () => getDocuments(companyId!),
    enabled: !!companyId,
  });

  // 인사(근로계약·서식) 문서는 이 화면의 발송 목록에서 제외한다 — 2026-08-03 사장님:
  //   "일괄발송·새 계약 요청에 근로계약·서식 계약서까지 다 나온다".
  //   그 문서들은 구성원 상세 > 근로계약 탭에서 직원별로 보내는 경로가 따로 있다.
  //   판별 두 갈래: ① 서식 카테고리(회사가 만든 인사 서식) ② 인사 계약 패키지가 만든 문서
  //   (내장 서식은 template_id 가 없어 카테고리로 못 잡히므로 패키지 쪽도 함께 본다).
  const { data: hrPackageDocIds } = useQuery({
    queryKey: ["hr-package-doc-ids", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("hr_contract_package_items")
        .select("document_id, hr_contract_packages!inner(company_id)")
        .eq("hr_contract_packages.company_id", companyId!);
      return new Set<string>((data || []).map((r: any) => r.document_id).filter(Boolean));
    },
    enabled: !!companyId,
  });

  // 회사가 정한 노출 순서(양식관리 ▲▼·일괄발송 드래그) — 문서·양식 모두 이 순서를 따른다.
  const { data: templateOrder = [] } = useQuery({
    queryKey: ["contract-template-order", companyId],
    queryFn: () => getContractTemplateOrder(companyId!),
    enabled: !!companyId,
  });

  const documents = useMemo(() => {
    const hrIds = hrPackageDocIds || new Set<string>();
    const list = (allDocuments as any[]).filter(
      (d) =>
        !HR_TEMPLATE_CATEGORIES.has(d.doc_templates?.category || "") &&
        !hrIds.has(d.id) &&
        // 프로젝트에서 만든 견적·계약(deal_id 보유)도 제외 — 2026-08-03 사장님:
        //   "프로젝트에서 생성된 계약서는 프로젝트에서 따로 모아 보게".
        //   프로젝트 상세 > 견적서/전자계약 탭이 deal_id 로 같은 문서를 이미 모아 보여준다.
        !d.deal_id &&
        // 양식 실체화 사본(source_template_id)도 제외 — 양식 자체가 목록에 있으므로
        //   사본까지 보이면 같은 계약서가 2개씩 나온다(2026-08-03 사장님).
        !(d.content_json as any)?.source_template_id,
    );
    return sortTemplatesByOrder(list, templateOrder);
  }, [allDocuments, hrPackageDocIds, templateOrder]);

  // 계약 양식(contract_templates) — 전자계약 양식 통합(2026-07-23). 발송 목록의 양식 소스는 이걸로 일원화.
  const { data: allContractTemplates = [] } = useQuery({
    queryKey: ["contract-templates", companyId],
    queryFn: () => listContractTemplates(companyId!),
    enabled: !!companyId,
  });
  // 양식관리에서 숨긴 표준 양식은 발송 목록에서도 뺀다 — 2026-08-03 사장님:
  //   "양식관리에서 삭제하면 발송하기에 안 나타나야 한다". 회사 양식은 실제 삭제라 목록에서 바로 빠진다.
  const { data: hiddenTemplateIds = [] } = useQuery({
    queryKey: ["hidden-contract-templates", companyId],
    queryFn: () => getHiddenContractTemplateIds(companyId!),
    enabled: !!companyId,
  });
  const contractTemplates = useMemo(() => {
    const hidden = new Set(hiddenTemplateIds);
    return sortTemplatesByOrder(
      (allContractTemplates as any[]).filter((t) => !hidden.has(t.id)),
      templateOrder,
    );
  }, [allContractTemplates, hiddenTemplateIds, templateOrder]);

  // 문서번호 — 회사 안에서 만들어진 순서(오래된 것이 1번). 정렬·필터를 바꿔도 번호는 고정.
  const docNoById = useMemo(() => {
    const map = new Map<string, number>();
    [...(requests as any[])]
      .sort((a, b) => String(a.created_at || "").localeCompare(String(b.created_at || "")))
      .forEach((r, i) => map.set(r.id, i + 1));
    return map;
  }, [requests]);

  // 담당자(요청 보낸 사람) 이름 — created_by 는 uuid 라 구성원 이름으로 바꿔 보여준다.
  const { data: memberNames = {} } = useQuery({
    queryKey: ["signature-member-names", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("users").select("id, name, email").eq("company_id", companyId!);
      const map: Record<string, string> = {};
      for (const u of (data || []) as any[]) map[u.id] = u.name || u.email || "-";
      return map;
    },
    enabled: !!companyId,
  });

  //   머리단 ≡ 필터 — 상태·그룹·대표자·담당자
  const cf = useColFilters();
  const colVal = (r: any) => ({
    status: getSignatureStatusInfo(r.status).label || r.status || "", batch: r.batch_id ? `묶음#${r.batch_seq ?? "?"}` : "—",
    signer: r.signer_name || "", manager: memberNames[r.created_by] || "",
  });
  const cfSpec = (k: keyof ReturnType<typeof colVal>) => cf.spec(k, (requests as any[]).filter((r) => statusFilter === "all" || r.status === statusFilter).map((r) => colVal(r)[k]));
  const filtered = useMemo(() => {
    const rows = (requests as any[]).filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (!cf.hit(colVal(r))) return false;
      if (!quickSearchHit(search, [r.title, r.signer_name, r.signer_email, memberNames[r.created_by], String(docNoById.get(r.id) ?? "")])) return false;
      // 그룹(묶음)·담당자 — 고른 값만 보기
      if (batchFilter === "none" && r.batch_id) return false;
      if (batchFilter && batchFilter !== "none" && r.batch_id !== batchFilter) return false;
      if (managerFilter && r.created_by !== managerFilter) return false;
      // 기간 설정 — 요청일/서명완료일 각각 범위 지정 (빈 값이면 제한 없음)
      if (reqFrom && String(r.created_at || "") < reqFrom) return false;
      if (reqTo && String(r.created_at || "") > `${reqTo}T23:59:59.999Z`) return false;
      if (expFrom && (!r.signed_at || String(r.signed_at) < expFrom)) return false;
      if (expTo && (!r.signed_at || String(r.signed_at) > `${expTo}T23:59:59.999Z`)) return false;
      return true;
    });
    // 열 머리 클릭 정렬
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (r: any): string | number => {
      switch (sort.key) {
        case "docNo": return docNoById.get(r.id) || 0;
        case "status": return getSignatureStatusInfo(r.status).label || r.status || "";
        case "batch": return r.batch_id ? (r.batch_seq ?? 0) : -1;
        case "title": return r.title || "";
        case "signer": return r.signer_name || "";
        case "manager": return memberNames[r.created_by] || "";
        case "signed": return r.signed_at || "";
        default: return r.created_at || "";
      }
    };
    return [...rows].sort((a, b) => {
      const av = val(a), bv = val(b);
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv), "ko") * dir;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requests, statusFilter, search, memberNames, reqFrom, reqTo, expFrom, expTo, sort, docNoById, batchFilter, managerFilter, cf.key]);

  // 필터 선택지 — 실제 목록에 존재하는 묶음·담당자만 (빈 선택지를 보여주지 않는다)
  const batchOptions = useMemo(() => {
    const seen = new Map<string, { id: string; label: string; count: number; first: string }>();
    for (const r of requests as any[]) {
      if (!r.batch_id) continue;
      const cur = seen.get(r.batch_id);
      if (cur) { cur.count++; if (String(r.created_at || "") < cur.first) cur.first = String(r.created_at || ""); }
      else seen.set(r.batch_id, { id: r.batch_id, label: `묶음#${r.batch_seq ?? "?"}`, count: 1, first: String(r.created_at || "") });
    }
    // 최근 발송이 위로
    return Array.from(seen.values()).sort((a, b) => b.first.localeCompare(a.first));
  }, [requests]);
  const managerOptions = useMemo(() => {
    const seen = new Map<string, number>();
    for (const r of requests as any[]) if (r.created_by) seen.set(r.created_by, (seen.get(r.created_by) || 0) + 1);
    return Array.from(seen.entries())
      .map(([id, count]) => ({ id, name: memberNames[id] || "-", count }))
      .sort((a, b) => a.name.localeCompare(b.name, "ko"));
  }, [requests, memberNames]);

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
      const data = logRead('signatures/page:data', await supabase.from("partners").select("id, name").in("id", partnerIds));
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

  // 상태별 건수도 목록과 같은 필터 기준 (2026-08-19 감사: 옆의 "건수"는 필터 반영,
  //   상태 건수는 전체 기준이라 "건수 3 · 서명완료 47"이 한 줄에 나란히 떴다).
  //   상태 필터 자체는 제외 — 상태 칩을 눌러도 다른 상태 건수가 0이 되지 않게.
  const counts = useMemo(() => {
    const base = (requests as any[]).filter((r) => {
      if (!cf.hit(colVal(r))) return false;
      if (!quickSearchHit(search, [r.title, r.signer_name, r.signer_email, memberNames[r.created_by], String(docNoById.get(r.id) ?? "")])) return false;
      if (batchFilter === "none" && r.batch_id) return false;
      if (batchFilter && batchFilter !== "none" && r.batch_id !== batchFilter) return false;
      if (managerFilter && r.created_by !== managerFilter) return false;
      if (reqFrom && String(r.created_at || "") < reqFrom) return false;
      if (reqTo && String(r.created_at || "") > `${reqTo}T23:59:59.999Z`) return false;
      if (expFrom && (!r.signed_at || String(r.signed_at) < expFrom)) return false;
      if (expTo && (!r.signed_at || String(r.signed_at) > `${expTo}T23:59:59.999Z`)) return false;
      return true;
    });
    const map: Record<string, number> = { all: base.length };
    for (const s of SIGNATURE_STATUS) map[s.value] = 0;
    for (const r of base) {
      map[r.status] = (map[r.status] || 0) + 1;
    }
    return map;
  }, [requests, cf, search, memberNames, docNoById, batchFilter, managerFilter, reqFrom, reqTo, expFrom, expTo]);

  //   쪽 넘김 — 기본 50줄. 조건이 바뀌면 1쪽으로
  const pager = usePager(filtered as any[], rowsPer, `${statusFilter}|${search}|${reqFrom}|${reqTo}|${expFrom}|${expTo}|${batchFilter}|${managerFilter}|${sort.key}${sort.dir}|${cf.key}`);
  const condCountLive = (statusFilter !== "all" ? 1 : 0) + (expFrom || expTo ? 1 : 0) + (batchFilter ? 1 : 0) + (managerFilter ? 1 : 0);
  const condCountDraft = (statusFilter !== "all" ? 1 : 0) + (dExpFrom || dExpTo ? 1 : 0) + dBatch.length + dManager.length;
  const applyDraft = () => {
    setExpFrom(dExpFrom); setExpTo(dExpTo);
    setBatchFilter(dBatch[0] || ""); setManagerFilter(dManager[0] || "");
  };
  const syncDraft = () => { setDExpFrom(expFrom); setDExpTo(expTo); setDBatch(batchFilter ? [batchFilter] : []); setDManager(managerFilter ? [managerFilter] : []); };
  useEffect(() => { syncDraft(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [expFrom, expTo, batchFilter, managerFilter]);
  //   내 조건 — ★ 하나가 이 화면의 기본값 (DB 라 PC 를 바꿔도 따라온다 — 예전 user_preferences 가 하던 일)
  const saved = useSavedQueries("signatures", companyId);
  const paramsNow = { status: statusFilter, q: search, reqFrom, reqTo, expFrom, expTo, batch: batchFilter, manager: managerFilter, sort, rows: rowsPer };
  const paramsBasic = { status: "all", q: "", reqFrom: "", reqTo: "", expFrom: "", expTo: "", batch: "", manager: "", sort: { key: "created", dir: "desc" }, rows: 50 };
  const applySaved = (p: Record<string, unknown>) => {
    if (typeof p.status === "string") setStatusFilter(p.status as any);
    if (typeof p.q === "string") setSearch(p.q);
    setReqFrom(String(p.reqFrom || "")); setReqTo(String(p.reqTo || ""));
    setExpFrom(String(p.expFrom || "")); setExpTo(String(p.expTo || ""));
    setBatchFilter(String(p.batch || "")); setManagerFilter(String(p.manager || ""));
    const so = p.sort as { key?: SortKey; dir?: "asc" | "desc" } | undefined;
    if (so?.key) setSort({ key: so.key, dir: so.dir === "asc" ? "asc" : "desc" });
    if (typeof p.rows === "number") setRowsPer(p.rows);
  };
  const [defDone, setDefDone] = useState(false);
  useEffect(() => {
    if (defDone || !saved.isFetched) return;
    setDefDone(true);
    if (saved.def) applySaved(saved.def.params || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.isFetched, saved.def, defDone]);
  const suggestName = () => [statusFilter !== "all" ? (SIGNATURE_STATUS.find((x) => x.value === statusFilter)?.label || "") : "", dManager[0] ? memberNames[dManager[0]] : "", dBatch[0] ? (dBatch[0] === "none" ? "묶음 없음" : batchOptions.find((b) => b.id === dBatch[0])?.label || "") : ""].filter(Boolean).slice(0, 3).join(" · ") || "내 조건";
  const chips: AppliedChip[] = [
    ...quickTerms(search).map((t, i) => ({ group: "빠른검색", label: t, onRemove: () => setSearch(quickTerms(search).filter((_, j) => j !== i).join(", ")) })),
    ...(statusFilter !== "all" ? [{ group: "상태", label: SIGNATURE_STATUS.find((x) => x.value === statusFilter)?.label || statusFilter, onRemove: () => setStatusFilter("all") }] : []),
    ...((expFrom || expTo) ? [{ group: "서명완료일", label: `${expFrom || "…"} ~ ${expTo || "…"}`, onRemove: () => { setExpFrom(""); setExpTo(""); } }] : []),
    ...(batchFilter ? [{ group: "그룹", label: batchFilter === "none" ? "묶음 없음" : (batchOptions.find((b) => b.id === batchFilter)?.label || "묶음"), onRemove: () => setBatchFilter("") }] : []),
    ...(managerFilter ? [{ group: "담당자", label: memberNames[managerFilter] || "담당자", onRemove: () => setManagerFilter("") }] : []),
  ];
  const clearAll = () => { setSearch(""); setStatusFilter("all"); setExpFrom(""); setExpTo(""); setBatchFilter(""); setManagerFilter(""); };

  // 최근 7일 발송 실패 요약 — 대표/관리자만, 1분마다 폴링.
  const { data: failureSummary = [] } = useQuery({
    queryKey: ["signature-failure-summary", companyId],
    queryFn: async () => {
      const { data, error } = await supabase.rpc("get_recent_send_failures_summary", { p_days: 7 });
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

  // 체크한 건 일괄 삭제 (2026-08-05 사장님 시안) — 한 건이라도 실패하면 건수로 알린다.
  const bulkDeleteMut = useMutation({
    mutationFn: async (ids: string[]) => {
      let ok = 0;
      const failed: string[] = [];
      for (const id of ids) {
        try { await deleteSignatureRequest(id); ok++; } catch { failed.push(id); }
      }
      return { ok, failed };
    },
    onSuccess: ({ ok, failed }) => {
      setSelectedIds(new Set(failed));
      qc.invalidateQueries({ queryKey: ["signature-requests"] });
      toast(failed.length ? `${ok}건 삭제 · ${failed.length}건 실패` : `${ok}건 삭제되었습니다`, failed.length ? "error" : "success");
    },
    onError: (err: any) => toast("삭제 실패: " + friendlyError(err, "알 수 없는 오류"), "error"),
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
    <div className="qk-shell">
      {/* ── 조회 화면 표준 — 탭 · 조회 줄 · 걸린 조건 · 결과 요약 · 표 · 쪽 넘김 · 확정 줄 (2026-08-18 Wave 3) ── */}
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {([["requests", "계약 요청", requests.length], ["templates", "양식 관리", null]] as const).map(([k, label, n]) => (
              <button key={k} type="button" onClick={() => setSubTab(k)}
                className={subTab === k ? "collect-tab collect-tab-on" : "collect-tab"}>
                {label}{n != null && <span className="collect-tab-cnt">{n.toLocaleString()}</span>}
              </button>
            ))}
          </div>

          {subTab === "requests" && (<>
          <QueryBar right={<>
            {/* 2026-08-05 사장님: '새 계약 요청'을 단체 일괄 발송 마법사로 통합 — 한 곳에서 1건이든 여러 거래처든 같은 흐름 */}
            <button type="button" onClick={() => setShowOrgBulkWizard(true)} disabled={contractLimitReached}
              className="btn-primary btn-sm"
              title={contractLimitReached ? `${contractStatus?.planName || "현재 요금제"}의 이번 달 전자계약 발송 한도(${contractStatus?.limit}건)를 모두 사용했습니다. 오너뷰 요금제로 올리면 무제한으로 보낼 수 있습니다.` : "계약서를 골라 거래처에 발송 — 여러 곳에 변수만 바꿔 한 번에 보낼 수도 있습니다"}>
              {contractLimitReached ? "이번 달 발송 한도 소진" : "+ 새 계약 요청"}
            </button>
          </>}>
            {/* 요청일 — 안 걸 수도 있는 기간(onClear = 전체 기간). 서명완료일·그룹·담당자는 검색조건 안 */}
            <DateRangeField label={null} parts="segments" from={reqFrom} to={reqTo}
              onChange={(f, t) => { setReqFrom(f); setReqTo(t); }} onClear={() => { setReqFrom(""); setReqTo(""); }}
              trailing={
                <ConditionPanel open={panelOpen} onOpenChange={(v) => { if (v) syncDraft(); setPanelOpen(v); }} activeCount={condCountLive} anchorSel=".drf"
                  tabs={<SavedTabs list={saved.list} current={paramsNow} basic={paramsBasic}
                    onApply={(sv) => { applySaved(sv.params || {}); setPanelOpen(false); }}
                    onBasic={() => { setStatusFilter("all"); setReqFrom(""); setReqTo(""); clearAll(); setSort({ key: "created", dir: "desc" }); setRowsPer(50); }}
                    onRemove={saved.remove} onSetDefault={saved.setDefault} />}
                  foot={<>
                    <button type="button" className="btn-secondary btn-sm" disabled={condCountDraft === 0} onClick={() => { setDExpFrom(""); setDExpTo(""); setDBatch([]); setDManager([]); }}>조건 지우기</button>
                    <ConditionSave suggest={suggestName}
                      onSave={(name, asDefault) => { saved.save(name, { ...paramsNow, expFrom: dExpFrom, expTo: dExpTo, batch: dBatch[0] || "", manager: dManager[0] || "" }, asDefault); applyDraft(); setPanelOpen(false); }} />
                    <RowsPerPage value={rowsPer} onChange={setRowsPer} />
                    <button type="button" className="btn-primary btn-sm" onClick={() => { applyDraft(); setPanelOpen(false); }}>조회</button>
                  </>}>
                  <ConditionRow label="요청일" hint="비우면 전체 기간">
                    <span className="qk-range-txt">{reqFrom || reqTo ? `${reqFrom || "…"} ~ ${reqTo || "…"}` : "전체 기간"}</span>
                    <DateRangeField label={null} parts="calendar" confirm from={reqFrom} to={reqTo}
                      onChange={(f, t) => { setReqFrom(f); setReqTo(t); }} />
                    <span className="qk-quicks">
                      {periodQuicks().map((pq) => (
                        <button key={pq.key} type="button" onClick={() => { setReqFrom(pq.from); setReqTo(pq.to); }}
                          className={reqFrom === pq.from && reqTo === pq.to ? "qk-quick qk-quick-on" : "qk-quick"}>{pq.label}</button>
                      ))}
                      <button type="button" onClick={() => { setReqFrom(""); setReqTo(""); }} className={!reqFrom && !reqTo ? "qk-quick qk-quick-on" : "qk-quick"}>전체 기간</button>
                    </span>
                  </ConditionRow>
                  {/* 상태 — 조회 줄의 칩 줄을 검색조건 안으로 (2026-08-18 사장님: 값 필터는 검색조건). 대기·거부는 실제로 도달 불가능한 상태라 뺐다 (2026-08-10) */}
                  <ConditionRow label="상태" hint="값 하나 · 바로 반영">
                    <span className="qk-quicks">
                      <button type="button" onClick={() => setStatusFilter("all")} className={statusFilter === "all" ? "qk-quick qk-quick-on" : "qk-quick"}>전체 {counts.all || 0}</button>
                      {SIGNATURE_STATUS.filter((x) => x.value !== "pending" && x.value !== "rejected").map((x) => (
                        <button key={x.value} type="button" onClick={() => setStatusFilter(x.value)} className={statusFilter === x.value ? "qk-quick qk-quick-on" : "qk-quick"}>
                          <span className={`inline-block w-1.5 h-1.5 rounded-full mr-1 ${x.dot}`} />{x.label} {counts[x.value] || 0}
                        </button>
                      ))}
                    </span>
                  </ConditionRow>
                  <ConditionRow label="서명완료일" hint="비우면 제한 없음">
                    <DateRangeField label={null} from={dExpFrom} to={dExpTo} onChange={(f, t) => { setDExpFrom(f); setDExpTo(t); }} onClear={() => { setDExpFrom(""); setDExpTo(""); }} />
                  </ConditionRow>
                  <ConditionRow label="그룹" hint="묶음 발송 단위">
                    <TokenField items={[{ value: "none", label: "묶음 없음" }, ...batchOptions.map((b) => ({ value: b.id, label: `${b.label} (${b.count}건)` }))]}
                      value={dBatch} onChange={(v) => setDBatch(v.slice(-1))} placeholder="묶음 번호 (예: 12)" />
                  </ConditionRow>
                  <ConditionRow label="담당자">
                    <TokenField items={managerOptions.map((m) => ({ value: m.id, label: `${m.name} (${m.count}건)` }))}
                      value={dManager} onChange={(v) => setDManager(v.slice(-1))} placeholder="이름 일부" />
                  </ConditionRow>
                </ConditionPanel>
              } />
            <QuickSearch value={search} onApply={setSearch} placeholder="제목 · 서명자 · 이메일 · 담당자 · 문서번호 — 쉼표로 여러 개, Enter" />
          </QueryBar>

          <AppliedChips chips={chips} onClearAll={clearAll} />

          <ResultStrip right={<>
            {signedFiltered.length > 0 && (
              <button type="button" onClick={toggleSelectAllSigned} disabled={exporting} className="btn-secondary btn-sm whitespace-nowrap"
                title="현재 목록의 서명완료 계약서를 모두 선택/해제 — 고르면 아래 줄에서 PDF 로 저장">
                {allSignedSelected ? "서명완료 전체 해제" : `서명완료 ${signedFiltered.length}건 고르기`}
              </button>
            )}
            {isManager && totalFailures > 0 && (
              <button type="button" onClick={() => setShowFailurePanel(true)} className="sig-fail-chip"
                title="최근 7일간 이메일 발송에 실패한 건을 확인하고 재발송하세요">
                ⚠ 발송 실패 <b className="mono-number">{totalFailures}건</b> · {failureSummary.length}가지 사유
              </button>
            )}
            {contractStatus && (
              <span className="contract-usage-chip" data-reached={contractLimitReached ? "1" : undefined}
                title={contractStatus.limit !== null
                  ? `${contractStatus.planName || "현재 요금제"} — 전자계약(계약 요청)은 월 ${contractStatus.limit}건까지 발송 가능합니다`
                  : `${contractStatus.planName || "현재 요금제"} — 전자계약 발송 무제한`}>
                {contractStatus.limit !== null ? `이번 달 발송 ${contractStatus.used}/${contractStatus.limit}건` : `이번 달 발송 ${contractStatus.used}건`}
              </span>
            )}
          </>}>
            <Stat label="건수" value={`${filtered.length.toLocaleString("ko")}건`} />
            {SIGNATURE_STATUS.filter((x) => x.value !== "pending" && x.value !== "rejected").map((x) => (
              <Stat key={x.value} label={x.label} value={`${(counts[x.value] || 0).toLocaleString("ko")}건`} tone={x.value === "signed" ? "plus" : undefined} />
            ))}
          </ResultStrip>
          </>)}
        </QueryHead>

        <QueryBody>
          {subTab === "templates" && companyId && userId && (
            <div className="sig-scroll">
              {/* 계약 양식 단일 시스템 — 우리 회사가 만든 계약 양식만 노출(2026-07-23). OrgBulkWizard 가 같은 데이터를 읽는다 */}
              <ContractTemplatesManager companyId={companyId} />
            </div>
          )}
          {subTab === "requests" && (
            isLoading ? (
              <div className="collect-empty">불러오는 중…</div>
            ) : (requests as any[]).length === 0 ? (
              <div className="collect-empty">문서에 서명을 요청해 보세요 — 계약서·NDA 등에 전자서명을 받을 수 있습니다. 오른쪽 위 [+ 새 계약 요청]</div>
            ) : filtered.length === 0 ? (
              <div className="collect-empty">이 조건에 맞는 계약 요청이 없습니다 — 검색조건을 풀어 보세요</div>
            ) : (
              <div className="ev-scroll">
                <table className="ev-table ev-lined signature-table">
                  <thead>
                    <tr>
                      <th className="signature-table-check">
                        <button type="button" aria-label="이 쪽 전체 선택"
                          onClick={() => setSelectedIds((prev) => { const next = new Set(prev); const all = (pager.view as any[]).every((r) => next.has(r.id)); for (const r of pager.view as any[]) { if (all) next.delete(r.id); else next.add(r.id); } return next; })}
                          className={pager.view.length > 0 && (pager.view as any[]).every((r) => selectedIds.has(r.id)) ? "collect-chk collect-chk-on" : "collect-chk"}>
                          {pager.view.length > 0 && (pager.view as any[]).every((r) => selectedIds.has(r.id)) ? "✓" : ""}
                        </button>
                      </th>
                      <SortableTh label="문서번호" sortKey="docNo" sort={sort} onSort={toggleSort} style={{ width: 84 }} />
                      <SortableTh label="상태" sortKey="status" sort={sort} onSort={toggleSort} style={{ width: 110 }} filter={cfSpec("status")} />
                      <SortableTh label="그룹" sortKey="batch" sort={sort} onSort={toggleSort} style={{ width: 96 }} filter={cfSpec("batch")} />
                      <SortableTh label="제목" sortKey="title" sort={sort} onSort={toggleSort} />
                      <SortableTh label="대표자" sortKey="signer" sort={sort} onSort={toggleSort} style={{ width: 208 }} filter={cfSpec("signer")} />
                      <SortableTh label="담당자" sortKey="manager" sort={sort} onSort={toggleSort} style={{ width: 110 }} filter={cfSpec("manager")} />
                      <SortableTh label="요청일" sortKey="created" sort={sort} onSort={toggleSort} style={{ width: 100 }} />
                      <SortableTh label="서명완료일" sortKey="signed" sort={sort} onSort={toggleSort} style={{ width: 100 }} />
                      <SortableTh label="관리" style={{ width: 190 }} />
                    </tr>
                  </thead>
                  <tbody>
                    {(pager.view as any[]).map((r: any) => {
                      const info = getSignatureStatusInfo(r.status);
                      // 만료일이 지났으면 상태가 아직 '발송' 이어도 리마인드 금지 (2026-08-21 감사):
                      //   만료 처리 함수를 부르는 곳이 없어 215건이 'sent/viewed' 로 남아 있었고,
                      //   죽은 링크로 리마인더가 계속 나가 받는 사람은 "만료되었습니다" 만 봤다.
                      const isOverdue = !!r.expires_at && new Date(r.expires_at) < new Date();
                      const canRemind = r.status !== "signed" && r.status !== "expired" && r.status !== "rejected" && !isOverdue;
                      const delivery = ({
                        delivered: { t: "전달됨", c: "bg-green-500/10 text-green-500" },
                        bounced: { t: "반송됨", c: "bg-red-500/10 text-red-500" },
                        complained: { t: "스팸신고", c: "bg-red-500/10 text-red-500" },
                        delayed: { t: "전달지연", c: "bg-amber-500/10 text-amber-500" },
                      } as any)[r.delivery_status];
                      return (
                        <tr key={r.id} className={selectedIds.has(r.id) ? "ev-on" : undefined}>
                          <td className="signature-table-check">
                            <button type="button" onClick={() => toggleSel(r.id)} aria-label="선택"
                              className={selectedIds.has(r.id) ? "collect-chk collect-chk-on" : "collect-chk"}>{selectedIds.has(r.id) ? "✓" : ""}</button>
                          </td>
                          <td className="signature-table-no mono-number">{docNoById.get(r.id) ?? "—"}</td>
                          <td className="signature-table-status">
                            <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold whitespace-nowrap ${info.bg} ${info.text}`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${info.dot}`} />{info.label}
                            </span>
                          </td>
                          <td className="signature-table-group">
                            {/* 값을 눌러 그 묶음만 보기 — 다시 누르면 해제 */}
                            {r.batch_id ? (
                              <button
                                type="button"
                                onClick={() => setBatchFilter((v) => (v === r.batch_id ? "" : r.batch_id))}
                                className={`signature-table-batch ${batchFilter === r.batch_id ? "is-on" : ""}`}
                                title={batchFilter === r.batch_id ? "이 묶음 필터 해제" : `이 묶음(#${r.batch_seq ?? "?"})만 보기`}
                              >
                                묶음{r.batch_seq ? `#${r.batch_seq}` : ""}
                              </button>
                            ) : <span className="text-[var(--text-dim)]">—</span>}
                          </td>
                          <td className="signature-table-title">
                            {/* 제목 클릭 → 상태 무관 항상 계약서 팝업(읽기 전용) */}
                            <button onClick={() => openDocViewer({ type: 'contract', id: r.id })} className="signature-table-title-link" title={r.title}>{r.title}</button>
                            {delivery && (
                              <span className={`ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full font-semibold whitespace-nowrap ${delivery.c}`} title={r.delivery_detail || (r.delivery_at ? new Date(r.delivery_at).toLocaleString("ko-KR") : "")}>
                                <Ico e="✉" /> {delivery.t}
                              </span>
                            )}
                          </td>
                          <td className="signature-table-signer" title={`${r.signer_name || ""} ${r.signer_email ? `(${r.signer_email})` : ""}`.trim()}>
                            <span className="text-[var(--text)]">{r.signer_name || "—"}</span>
                            {r.signer_email && <span className="text-[var(--text-dim)]">({r.signer_email})</span>}
                          </td>
                          <td className="signature-table-manager">
                            {r.created_by ? (
                              <button
                                type="button"
                                onClick={() => setManagerFilter((v) => (v === r.created_by ? "" : r.created_by))}
                                className={`signature-table-filter-link ${managerFilter === r.created_by ? "is-on" : ""}`}
                                title={managerFilter === r.created_by ? "이 담당자 필터 해제" : "이 담당자 건만 보기"}
                              >
                                {memberNames[r.created_by] || "—"}
                              </button>
                            ) : "—"}
                          </td>
                          <td className="signature-table-date">{r.created_at ? kstDateStr(new Date(r.created_at)) : "—"}</td>
                          {/* 서명완료일 — 아직 서명 전이면 공백 (2026-08-06 사장님) */}
                          <td className="signature-table-date">
                            {r.signed_at ? kstDateStr(new Date(r.signed_at)) : ""}
                          </td>
                          <td className="signature-table-actions">
                            <div className="signature-request-actions">
                              {/* 실수 발송 방지 — 확인을 눌렀을 때만 보낸다 (2026-08-06 사장님) */}
                              {canRemind && (
                                <button onClick={async () => { if (await appConfirm(`${r.signer_name}님에게 리마인더를 발송하시겠습니까?`, { confirmLabel: "발송" })) reminderMut.mutate(r.id); }} disabled={reminderMut.isPending} className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-sm hover:bg-[var(--bg-surface)] transition disabled:opacity-50" aria-label="리마인더 발송" title="리마인더 발송"><Ico e="🔔" /></button>
                              )}
                              {r.sign_token && r.status !== 'signed' && (
                                <a href={`/sign?token=${r.sign_token}`} target="_blank" rel="noopener noreferrer" className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-sm hover:bg-[var(--bg-surface)] transition" aria-label="서명 링크 열기" title="서명 링크"><Ico e="🔗" /></a>
                              )}
                              <button onClick={() => openDocViewer({ type: 'contract', id: r.id })} className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-sm hover:bg-[var(--bg-surface)] transition" aria-label="계약서 보기 / PDF 다운로드" title="이 계약서 보기 / PDF 다운로드"><Ico e="📄" /></button>
                              {r.status === 'signed' && (
                                <button onClick={async () => { const proof = await getSignatureProof(r.id); setViewSignedRow({ id: r.id, signer_name: r.signer_name, signed_at: r.signed_at, signature_data: proof.signature_data, title: r.title, signer_inputs: proof.signer_inputs }); }} className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-sm hover:bg-[var(--bg-surface)] transition" aria-label="서명본 보기" title="서명본 보기"><Ico e="✅" /></button>
                              )}
                              {canRemind && (
                                <button onClick={async () => { if (await appConfirm("이 계약 요청을 취소하시겠습니까?", { danger: true, confirmLabel: "취소 처리" })) cancelMut.mutate(r.id); }} className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 transition" aria-label="계약 요청 취소" title="취소(만료 처리)">✕</button>
                              )}
                              {isManager && (
                                <button onClick={async () => { if (await appConfirm("이 계약 요청을 영구 삭제할까요?\n삭제하면 복구할 수 없습니다.", { danger: true })) deleteMut.mutate(r.id); }} disabled={deleteMut.isPending} className="w-7 h-7 inline-flex items-center justify-center rounded-lg text-sm text-[var(--danger)] hover:bg-[var(--danger)]/10 transition disabled:opacity-50" aria-label="영구 삭제" title="영구 삭제"><Ico e="🗑" /></button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* ── 3줄 · 고른 건으로 하는 일 — 파란 버튼은 PDF 저장 하나. 삭제는 되돌릴 수 없어 확인창을 거친다 ── */}
          {subTab === "requests" && (
            <SelectionBar count={selectedIds.size} onClear={() => setSelectedIds(new Set())}
              summary={selectedSignedTargets.length > 0 ? <>서명완료 <b>{selectedSignedTargets.length}건</b> 포함</> : undefined}>
              <button type="button" onClick={() => bulkRemindMut.mutate(remindableSelected)} disabled={remindableSelected.length === 0 || bulkRemindMut.isPending}
                className="btn-secondary btn-sm whitespace-nowrap disabled:opacity-50">일괄 리마인더 ({remindableSelected.length})</button>
              <button type="button" disabled={bulkDeleteMut.isPending}
                onClick={async () => {
                  const ids = Array.from(selectedIds);
                  if (await appConfirm(`선택한 ${ids.length}건을 영구 삭제할까요?\n삭제하면 복구할 수 없습니다.`, { danger: true, confirmLabel: `${ids.length}건 삭제` })) bulkDeleteMut.mutate(ids);
                }}
                className="btn-secondary btn-sm text-[var(--danger)] whitespace-nowrap disabled:opacity-50">
                {bulkDeleteMut.isPending ? "삭제 중…" : `선택 삭제 (${selectedIds.size})`}
              </button>
              <button type="button" onClick={handleBulkExport} disabled={exporting || selectedSignedTargets.length === 0}
                className="btn-primary btn-sm whitespace-nowrap disabled:opacity-50"
                title="체크한 서명완료 계약서를 단건 인쇄와 동일한 품질의 PDF 로 저장 (파일명: 소상공인 개별계약서_업체명)">
                {exporting ? `PDF 생성 중… ${exportProgress?.done ?? 0}/${exportProgress?.total ?? 0}` : `서명완료 ${selectedSignedTargets.length}건 PDF 저장`}
              </button>
            </SelectionBar>
          )}
        </QueryBody>

        {subTab === "requests" && (
          <Pager page={pager.page} pages={pager.pages} total={filtered.length} size={rowsPer} from={pager.from} to={pager.to} onPage={pager.setPage} />
        )}
      </QueryScreen>

      {showOrgBulkWizard && companyId && userId && (
        <OrgBulkWizard
          companyId={companyId}
          userId={userId}
          documents={documents as any[]}
          contractTemplates={contractTemplates as any[]}
          templateOrder={templateOrder}
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
        <div className="signature-proof-modal fixed inset-0" onClick={() => setViewSignedRow(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
              <div>
                <div className="text-sm font-bold"><Ico e="✅" /> 서명본</div>
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
                    <div className="text-2xl font-bold py-4 text-center font-['Nanum_Pen_Script',_cursive]">
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
                    <Ico e="🔗" /> 외부 보기
                  </a>
                ) : null;
              })()}
              <button onClick={() => setViewSignedRow(null)} className="btn-primary btn-sm">닫기</button>
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

