"use client";
import { kstDateStr } from "@/lib/kst";
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
  const [authUid, setAuthUid] = useState<string | null>(null);
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [subTab, setSubTab] = useState<"requests" | "templates">("requests");
  const [statusFilter, setStatusFilter] = useState<"all" | SignatureStatusValue>("all");
  const [search, setSearch] = useState("");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showOrgBulkWizard, setShowOrgBulkWizard] = useState(false);
  const searchParams = useSearchParams();
  useEffect(() => { if (searchParams.get("bulk") === "1") setShowOrgBulkWizard(true); }, [searchParams]);
  // U4 페이지네이션 — 한 페이지 10/25/50건. 필터/검색 변경 시 1페이지 리셋.
  const [pageSize, setPageSize] = useState<number>(10);
  const [page, setPage] = useState<number>(1);
  // 표 정렬·기간 설정 (2026-08-05 사장님 시안) — 마지막 값은 계정별로 서버에 기억한다.
  type SortKey = "docNo" | "status" | "batch" | "title" | "signer" | "manager" | "created" | "signed";
  const [sort, setSort] = useState<{ key: SortKey; dir: "asc" | "desc" }>({ key: "created", dir: "desc" });
  const [reqFrom, setReqFrom] = useState("");   // 요청일 시작 (YYYY-MM-DD)
  const [reqTo, setReqTo] = useState("");       // 요청일 끝
  const [expFrom, setExpFrom] = useState("");   // 만료일 시작
  const [expTo, setExpTo] = useState("");       // 만료일 끝
  // 그룹(묶음)·담당자 필터 — 그 값만 골라 보기 (2026-08-05 사장님 요청)
  const [batchFilter, setBatchFilter] = useState("");   // "" 전체 / "none" 묶음 없음 / batch_id
  const [managerFilter, setManagerFilter] = useState(""); // "" 전체 / created_by(uuid)
  const [prefsLoaded, setPrefsLoaded] = useState(false);
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
  useEffect(() => { setPage(1); }, [statusFilter, search, pageSize, reqFrom, reqTo, expFrom, expTo, sort]);

  // 목록 보기 설정을 계정에 기억 — 다른 PC 로 로그인해도 같은 정렬·기간·페이지 크기.
  useEffect(() => {
    if (!authUid) return;
    let alive = true;
    (async () => {
      const { data } = await (supabase as any)
        .from("user_preferences").select("signature_list_prefs").eq("user_id", authUid).maybeSingle();
      const p = data?.signature_list_prefs;
      if (alive && p) {
        if (p.sort?.key) setSort({ key: p.sort.key, dir: p.sort.dir === "asc" ? "asc" : "desc" });
        if (typeof p.pageSize === "number") setPageSize(p.pageSize);
        if (typeof p.statusFilter === "string") setStatusFilter(p.statusFilter);
        setReqFrom(p.reqFrom || ""); setReqTo(p.reqTo || "");
        setExpFrom(p.expFrom || ""); setExpTo(p.expTo || "");
        setBatchFilter(p.batchFilter || ""); setManagerFilter(p.managerFilter || "");
      }
      if (alive) setPrefsLoaded(true);
    })();
    return () => { alive = false; };
  }, [authUid]);

  useEffect(() => {
    if (!authUid || !companyId || !prefsLoaded) return; // 로드 전에 기본값으로 덮어쓰지 않게
    const t = setTimeout(() => {
      // 유니크 제약은 (user_id, company_id) 다. onConflict 를 user_id 로만 주면
      //   42P10 으로 매번 실패하는데 void 로 삼켜서 무증상이었다 — 그래서 설정이
      //   한 번도 저장되지 않았다(운영 15행 중 signature_list_prefs 0건, 2026-08-06).
      void (supabase as any).from("user_preferences").upsert(
        {
          user_id: authUid,
          company_id: companyId,
          signature_list_prefs: { sort, pageSize, statusFilter, reqFrom, reqTo, expFrom, expTo, batchFilter, managerFilter },
          updated_at: new Date().toISOString(),
        },
        { onConflict: "user_id,company_id" },
      ).then(({ error }: { error: { message: string } | null }) => {
        if (error) console.error("전자계약 목록 설정 저장 실패:", error.message);
      });
    }, 600);
    return () => clearTimeout(t);
  }, [authUid, companyId, prefsLoaded, sort, pageSize, statusFilter, reqFrom, reqTo, expFrom, expTo, batchFilter, managerFilter]);

  const toggleSort = (key: SortKey) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));

  useEffect(() => {
    getCurrentUser().then((u) => {
      if (u) {
        setUserId(u.id);
        setAuthUid((u as any).auth_id || u.id);
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

  const filtered = useMemo(() => {
    const rows = (requests as any[]).filter((r) => {
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      if (search) {
        const q = search.toLowerCase();
        const hay = `${r.title || ""} ${r.signer_name || ""} ${r.signer_email || ""} ${memberNames[r.created_by] || ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
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
  }, [requests, statusFilter, search, memberNames, reqFrom, reqTo, expFrom, expTo, sort, docNoById, batchFilter, managerFilter]);

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
    <div className="space-y-6">
      {/* 툴바 — 탭 토글(서명 요청 / 양식 관리) + 액션 */}
      <header className="signature-dashboard-toolbar page-sticky-header">
        <div className="signature-tab-toggle seg-bar">
          <button
            onClick={() => setSubTab("requests")}
            className={`seg-item ${subTab === "requests" ? "seg-item-active" : ""}`}
          >
            계약 요청
          </button>
          <button
            onClick={() => setSubTab("templates")}
            className={`seg-item ${subTab === "templates" ? "seg-item-active" : ""}`}
          >
            양식 관리
          </button>
        </div>
        {subTab === "requests" && (
          <div className="signature-toolbar-actions">
            {contractStatus && contractStatus.limit !== null && (
              <span
                className="contract-usage-chip"
                data-reached={contractLimitReached ? "1" : undefined}
                title={`${contractStatus.planName || "현재 요금제"} — 전자계약(계약 요청)은 월 ${contractStatus.limit}건까지 발송 가능합니다`}
              >
                이번 달 발송 {contractStatus.used}/{contractStatus.limit}건
              </span>
            )}
            {/* 2026-08-05 사장님: '새 계약 요청'을 단체 일괄 발송 마법사로 통합 — 별도 '단체 일괄 발송' 버튼 제거.
                한 곳에서 1건이든 여러 거래처든 같은 흐름으로 보낸다. */}
            <button
              onClick={() => setShowOrgBulkWizard(true)}
              disabled={contractLimitReached}
              className="btn-primary"
              title={contractLimitReached ? `${contractStatus?.planName || "현재 요금제"}의 이번 달 전자계약 발송 한도(${contractStatus?.limit}건)를 모두 사용했습니다. 울트라로 업그레이드하면 무제한 발송할 수 있습니다.` : "계약서를 골라 거래처에 발송 — 여러 곳에 변수만 바꿔 한 번에 보낼 수도 있습니다"}
            >
              {contractLimitReached ? "이번 달 발송 한도 소진" : "+ 새 계약 요청"}
            </button>
          </div>
        )}
      </header>

      {subTab === "templates" && companyId && userId && (
        <div className="signature-templates-panel">
          {/* 온라인홍보사업 계약서·포기신청서 등 — "새 계약 요청"에서 실제 사용되는
              문서(documents 테이블) 원본을 여기서 바로 보고 수정. OrgBulkWizard 가 같은
              데이터(getDocuments)를 그대로 읽으므로 여기서 수정하면 발송 시 바로 반영됨. */}
          {/* 계약 양식 단일 시스템 — 우리 회사가 만든 계약 양식만 노출(2026-07-23). 표준 계약서는 '양식 추가 › 직접 작성'에서 시작점으로 선택. */}
          <ContractTemplatesManager companyId={companyId} />
        </div>
      )}

      {subTab === "requests" && (
        <>

      {/* 최근 7일 발송 실패 (대표/관리자만, 실패가 있을 때만 노출) */}
      {isManager && totalFailures > 0 && (
        <button
          onClick={() => setShowFailurePanel(true)}
          className="signature-failure-alert"
          title="최근 7일간 이메일 발송에 실패한 건을 확인하고 재발송하세요"
        >
          <div className="flex items-center gap-3 min-w-0">
            <span className="shrink-0 w-9 h-9 rounded-lg bg-red-500/20 flex items-center justify-center text-lg text-red-500"><Ico e="⚠" tone="mono" /></span>
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
      <div className="signature-status-cards">
        {/* 라벨+숫자를 한 줄로, 높이를 절반으로 (2026-08-06 사장님 스케치) */}
        <button
          onClick={() => setStatusFilter("all")}
          className={`signature-status-chip ${
            statusFilter === "all"
              ? "bg-[var(--primary)] text-white shadow-md"
              : "glass-card card-hover"
          }`}
        >
          <span className={`signature-status-chip-label ${statusFilter === "all" ? "text-white/85" : "text-[var(--text-dim)]"}`}>전체</span>
          <span className={`signature-status-chip-count mono-number ${statusFilter === "all" ? "text-white" : "text-[var(--text)]"}`}>{counts.all || 0}</span>
        </button>
        {SIGNATURE_STATUS.map((s) => (
          <button
            key={s.value}
            onClick={() => setStatusFilter(s.value)}
            className={`signature-status-chip ${
              statusFilter === s.value
                ? `${s.bg} ${s.text} ring-2 ring-current/30`
                : "glass-card card-hover"
            }`}
          >
            <span className={`signature-status-chip-label ${s.text}`}>
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${s.dot}`} />
              {s.label}
            </span>
            <span className="signature-status-chip-count mono-number text-[var(--text)]">{counts[s.value] || 0}</span>
          </button>
        ))}
      </div>

      {/* 검색 / 일괄 액션 */}
      <div className="signature-search-bar">
        <div className="signature-search-input-wrap">
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
            {/* 체크한 건 일괄 삭제 — 되돌릴 수 없어 건수를 확인 문구에 박아 둔다 */}
            <button
              onClick={async () => {
                const ids = Array.from(selectedIds);
                if (await appConfirm(`선택한 ${ids.length}건을 영구 삭제할까요?\n삭제하면 복구할 수 없습니다.`, { danger: true, confirmLabel: `${ids.length}건 삭제` })) {
                  bulkDeleteMut.mutate(ids);
                }
              }}
              disabled={bulkDeleteMut.isPending}
              className="btn-danger btn-sm whitespace-nowrap disabled:opacity-50"
            >
              {bulkDeleteMut.isPending ? "삭제 중..." : `선택 삭제 (${selectedIds.size})`}
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

      {/* 기간 설정 + 그룹·담당자 필터 (2026-08-05 사장님 시안·요청) */}
      <div className="signature-period-bar">
        <span className="signature-period-group">
          <span className="signature-period-label">그룹</span>
          <select value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)} className="signature-period-input" aria-label="그룹(묶음) 필터">
            <option value="">전체</option>
            <option value="none">묶음 없음</option>
            {batchOptions.map((b) => <option key={b.id} value={b.id}>{b.label} ({b.count}건)</option>)}
          </select>
        </span>
        <span className="signature-period-group">
          <span className="signature-period-label">담당자</span>
          <select value={managerFilter} onChange={(e) => setManagerFilter(e.target.value)} className="signature-period-input" aria-label="담당자 필터">
            <option value="">전체</option>
            {managerOptions.map((m) => <option key={m.id} value={m.id}>{m.name} ({m.count}건)</option>)}
          </select>
        </span>
        <span className="signature-period-group">
          <span className="signature-period-label">요청일</span>
          <input type="date" value={reqFrom} onChange={(e) => setReqFrom(e.target.value)} className="signature-period-input" aria-label="요청일 시작" />
          <span className="text-[var(--text-dim)]">~</span>
          <input type="date" value={reqTo} onChange={(e) => setReqTo(e.target.value)} className="signature-period-input" aria-label="요청일 끝" />
        </span>
        <span className="signature-period-group">
          <span className="signature-period-label">서명완료일</span>
          <input type="date" value={expFrom} onChange={(e) => setExpFrom(e.target.value)} className="signature-period-input" aria-label="서명완료일 시작" />
          <span className="text-[var(--text-dim)]">~</span>
          <input type="date" value={expTo} onChange={(e) => setExpTo(e.target.value)} className="signature-period-input" aria-label="서명완료일 끝" />
        </span>
        {(reqFrom || reqTo || expFrom || expTo || batchFilter || managerFilter) && (
          <button
            onClick={() => { setReqFrom(""); setReqTo(""); setExpFrom(""); setExpTo(""); setBatchFilter(""); setManagerFilter(""); }}
            className="btn-ghost btn-sm"
          >
            필터 초기화
          </button>
        )}
        <span className="ml-auto text-[11px] text-[var(--text-dim)]">정렬·필터·페이지 크기는 계정에 저장됩니다</span>
      </div>

      {/* 계약 목록 표 (2026-08-05 사장님 시안) — 열 머리 클릭 정렬, 본문만 스크롤 */}
      <div className="signature-request-list">
        {isLoading ? (
          <div className="glass-card p-10 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
        ) : filtered.length === 0 ? (
          <div className="signature-empty-state glass-card">
            <div className="text-5xl mb-4"><Ico e="✍" /></div>
            <div className="text-base font-bold text-[var(--text)]">문서에 서명을 요청해보세요</div>
            <div className="text-xs text-[var(--text-muted)] mt-1.5">계약서, NDA 등 문서에 전자서명을 받을 수 있습니다</div>
            <button onClick={() => setShowOrgBulkWizard(true)} className="btn-primary mt-5">+ 새 계약 요청</button>
          </div>
        ) : (() => {
          const pageRows = filtered.slice((page - 1) * pageSize, page * pageSize);
          const allPageSelected = pageRows.length > 0 && pageRows.every((r: any) => selectedIds.has(r.id));
          const SortHead = ({ k, label, className }: { k: SortKey; label: string; className?: string }) => (
            <th className={className}>
              <button type="button" onClick={() => toggleSort(k)} className="signature-table-sort" title={`${label} 기준 정렬`}>
                {label}
                <span className={`signature-table-sort-mark ${sort.key === k ? "is-active" : ""}`}>
                  {sort.key === k ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                </span>
              </button>
            </th>
          );
          return (
            <div className="signature-table-wrap glass-card">
              <div className="signature-table-scroll">
                <table className="signature-table">
                  <thead>
                    <tr>
                      <th className="signature-table-check">
                        <input
                          type="checkbox"
                          checked={allPageSelected}
                          onChange={(e) => setSelectedIds((prev) => {
                            const next = new Set(prev);
                            for (const r of pageRows as any[]) { if (e.target.checked) next.add(r.id); else next.delete(r.id); }
                            return next;
                          })}
                          className="accent-[var(--primary)]"
                          aria-label="이 페이지 전체 선택"
                        />
                      </th>
                      <SortHead k="docNo" label="문서번호" className="signature-table-no" />
                      <SortHead k="status" label="상태" className="signature-table-status" />
                      <SortHead k="batch" label="그룹" className="signature-table-group" />
                      <SortHead k="title" label="제목" />
                      <SortHead k="signer" label="대표자" className="signature-table-signer" />
                      <SortHead k="manager" label="담당자" className="signature-table-manager" />
                      <SortHead k="created" label="요청일" className="signature-table-date" />
                      <SortHead k="signed" label="서명완료일" className="signature-table-date" />
                      <th className="signature-table-actions-head">관리</th>
                    </tr>
                  </thead>
                  <tbody>
                    {pageRows.map((r: any) => {
                      const info = getSignatureStatusInfo(r.status);
                      const canRemind = r.status !== "signed" && r.status !== "expired" && r.status !== "rejected";
                      const delivery = ({
                        delivered: { t: "전달됨", c: "bg-green-500/10 text-green-500" },
                        bounced: { t: "반송됨", c: "bg-red-500/10 text-red-500" },
                        complained: { t: "스팸신고", c: "bg-red-500/10 text-red-500" },
                        delayed: { t: "전달지연", c: "bg-amber-500/10 text-amber-500" },
                      } as any)[r.delivery_status];
                      return (
                        <tr key={r.id} className={selectedIds.has(r.id) ? "is-selected" : undefined}>
                          <td className="signature-table-check">
                            <input type="checkbox" checked={selectedIds.has(r.id)} onChange={() => toggleSel(r.id)} className="accent-[var(--primary)]" aria-label="선택" />
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
            </div>
          );
        })()}

        {/* 페이지네이션 */}
        {filtered.length > 0 && (() => {
          const totalPages = Math.max(1, Math.ceil(filtered.length / pageSize));
          const curPage = Math.min(page, totalPages);
          return (
            <div className="signature-pagination-bar glass-card">
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

