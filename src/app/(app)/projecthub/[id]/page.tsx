"use client";

// 프로젝트 상세 (라이프사이클 탭) — 기존 deal 데이터 재사용. 2026-06-17 핸드오프 v2.
//   탭: 개요 / 견적서 / 계약 / 진행현황 / 손익. 모두 기존 테이블 읽기(연결·표시), 원본 무수정.
//   손익(원가율) 은 journal_entries.deal_id + v_deal_pnl 추가 후 별도 단계에서 채움.

import { useMemo, useState, useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { AccessDenied } from "@/components/access-denied";
import { STAGE_LABEL, STAGE_COLOR, STAGE_ORDER, type ProjectStage } from "@/lib/project-rules";
import { createFromTemplate, nextQuoteNumber } from "@/lib/documents";
import { seedDefaultDocTemplates } from "@/lib/default-doc-templates";
import { useTabParam } from "@/lib/use-tab-param";
import { DateField } from "@/components/date-field";
import { ProjectSlideOver } from "@/components/project-slide-over";
import { SubDealsTab } from "./_components/SubDealsTab";
import { getProjectTypeConfig, normalizeProjectType, type ProjectTabKey } from "@/lib/project-types";
import { PerformanceTab } from "./_components/PerformanceTab";
import { GoalOverviewTab } from "./_components/GoalOverviewTab";
import { FormTemplateManager } from "@/components/form-template-manager";
import { buildQuoteBlobFromDoc } from "@/lib/quote-pdf";
import { createTaxInvoice } from "@/lib/tax-invoice";
import { TasksTab } from "./_components/TasksTab";
import { MondayBoard } from "@/components/monday-board";

const db = supabase as any;

// 견적서 기본 구조 — 프로젝트에서 바로 생성(문서함 이동 없이). 품목은 생성 후 편집기에서 추가.
const QUOTE_CONTENT = {
  title: "견적서",
  sections: [
    { title: "견적 정보", content: "공급자: {{회사명}} (대표: {{대표자명}})\n수신: {{거래처명}}\n견적일자: {{견적일자}}\n유효기간: {{유효기간}}" },
    { title: "견적 품목", content: "[품목 테이블]\n\n※ 품목은 문서 생성 후 품목 편집 테이블에서 추가해 주세요.\n각 품목의 공급가액, 세액(10%), 합계가 자동 계산됩니다." },
    { title: "거래 조건", content: "납품 조건: {{납품조건}}\n결제 조건: {{결제조건}}\n\n※ 상기 금액은 부가가치세 별도 금액이며, 세금계산서를 발행합니다." },
    { title: "비고", content: "1. 본 견적서의 유효기간은 견적일로부터 {{유효기간}}입니다.\n2. 수량 및 사양 변경 시 단가가 변동될 수 있습니다.\n3. 기타 문의사항은 담당자에게 연락 바랍니다." },
  ],
};
// 계약서 기본 구조 — 전자계약 탭에서 생성. (견적서와 분리: 계약서는 본문 텍스트형)
const CONTRACT_CONTENT = {
  title: "계약서",
  sections: [{ title: "계약 내용", content: "" }],
};
const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const fmtDate = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "—");
const fmtNo = (d: any) => (d.document_number ? d.document_number : d.created_at ? String(d.created_at).slice(0, 10).replace(/-/g, "/") : "—");
// 문서 분류: 견적서(invoice/quote) vs 계약(나머지·전자계약). content_json.type → content_type 순.
const docKind = (d: any): "quote" | "contract" => {
  const t = (d?.content_json?.type as string) || d?.content_type || "";
  return t === "invoice" || t === "quote" ? "quote" : "contract";
};

// 견적 리스트 컬럼 — 노출 항목 커스터마이징(브라우저별 저장). align 'r' = 우측(금액)
type QCol = { key: string; label: string; default: boolean; align?: "l" | "c" | "r" };
const QUOTE_LIST_COLS: QCol[] = [
  { key: "no", label: "견적No.", default: true, align: "l" },
  { key: "partner", label: "거래처명", default: true, align: "l" },
  { key: "manager", label: "사원(담당)명", default: true, align: "c" },
  { key: "items", label: "품목명(요약)", default: true, align: "l" },
  { key: "subdeal", label: "매출/매입 관리", default: false, align: "l" },
  { key: "valid", label: "유효기간", default: true, align: "c" },
  { key: "amount", label: "견적금액합계", default: true, align: "r" },
  { key: "status", label: "진행상태", default: true, align: "c" },
  { key: "created", label: "작성일", default: false, align: "c" },
  { key: "views", label: "열람수", default: false, align: "c" },
  { key: "print", label: "인쇄", default: true, align: "c" },
];
const QUOTE_COLS_LSKEY = "projecthub_quote_cols_v1";

// content_json 에서 견적 품목/금액 추출 (필드명 방어적)
const quoteItems = (doc: any): any[] => {
  const cj = doc?.content_json;
  return Array.isArray(cj?.items) ? cj.items : [];
};
const quoteItemSummary = (doc: any): string => {
  const items = quoteItems(doc);
  if (items.length === 0) return "—";
  const first = items[0]?.name || items[0]?.품목명 || items[0]?.spec || "(품목)";
  return items.length > 1 ? `${first} 외 ${items.length - 1}건` : String(first);
};
const quoteAmount = (doc: any): number => {
  if (doc?.contract_amount != null) return Number(doc.contract_amount) || 0;
  return quoteItems(doc).reduce((s: number, it: any) => {
    const total = it.totalAmount ?? it.total ?? (Number(it.supplyAmount ?? Number(it.quantity || 0) * Number(it.unitPrice || 0)) + Number(it.taxAmount ?? 0));
    return s + (Number(total) || 0);
  }, 0);
};

type TabKey = ProjectTabKey;
// 전체 탭 라벨 사전 — 유형별로 보이는 탭만 PROJECT_TYPES[type].tabs 로 필터.
const TAB_LABEL: Record<TabKey, string> = {
  overview: "개요",
  quote: "견적서",
  contract: "전자계약",
  subdeals: "매출/매입 관리",
  sales_pipeline: "수주(매출)",
  purchase_pipeline: "발주(매입)",
  subprojects: "세부 프로젝트(캠페인)",
  pnl: "프로젝트 운영",
  performance: "성과",
  tasks: "태스크",
  workflow: "워크플로우",
};
const ALL_TAB_KEYS: TabKey[] = ["overview", "quote", "contract", "subdeals", "sales_pipeline", "purchase_pipeline", "subprojects", "pnl", "performance", "tasks", "workflow"];

export default function ProjectHubDetailPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const role = user?.role;
  const params = useParams();
  const router = useRouter();
  const dealId = String(params?.id || "");
  const [tab, setTab] = useTabParam<TabKey>("overview", { valid: ALL_TAB_KEYS });
  // 세부 프로젝트(캠페인) 추가 폼 — 금액은 생성 후 '매출/매입 관리'에서 입력
  const [showChildForm, setShowChildForm] = useState(false);
  const [childName, setChildName] = useState("");
  const [creatingChild, setCreatingChild] = useState(false);
  // 세부 프로젝트(캠페인) 생성 시 매출/매입(개요) — 저장 시 sub_deals 로 seed. 개요(참고)에만 반영, 총비용/마진(실적)엔 미반영.
  const [childSalesPlan, setChildSalesPlan] = useState("");
  const [childSalesVat, setChildSalesVat] = useState<"exclude" | "include">("exclude");
  const [childPurchasePlan, setChildPurchasePlan] = useState("");
  const [childPurchaseVat, setChildPurchaseVat] = useState<"exclude" | "include">("exclude");
  const numComma = (s: string) => { const n = Number(String(s).replace(/[^0-9]/g, "")); return n ? n.toLocaleString("ko-KR") : ""; };
  const resetChildForm = () => { setChildName(""); setChildSalesPlan(""); setChildPurchasePlan(""); setChildSalesVat("exclude"); setChildPurchaseVat("exclude"); };
  // 캠페인 목록 수정/삭제
  const [editChild, setEditChild] = useState<any | null>(null);
  const [editChildName, setEditChildName] = useState("");
  const [editChildStage, setEditChildStage] = useState<string>("estimate");
  const [editChildStart, setEditChildStart] = useState("");
  const [editChildEnd, setEditChildEnd] = useState("");
  const [savingChild, setSavingChild] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deletingChild, setDeletingChild] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  // 견적 리스트 노출 컬럼 (커스터마이징) — 브라우저 localStorage 저장
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    QUOTE_LIST_COLS.forEach((c) => (init[c.key] = c.default));
    return init;
  });
  const [showColSettings, setShowColSettings] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<any | null>(null); // 인쇄 전 견적 PDF 미리보기 팝업
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewBlob, setPreviewBlob] = useState<Blob | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  // 견적 미리보기 — previewDoc 설정 시 실제 PDF Blob 생성 → iframe 미리보기 + 직접 인쇄/저장.
  useEffect(() => {
    if (!previewDoc || !companyId) { setPreviewUrl(null); setPreviewBlob(null); return; }
    let url: string | null = null;
    let alive = true;
    setPreviewLoading(true); setPreviewUrl(null); setPreviewBlob(null);
    buildQuoteBlobFromDoc(previewDoc, companyId, userId)
      .then((blob) => { if (!alive) return; url = URL.createObjectURL(blob); setPreviewBlob(blob); setPreviewUrl(url); })
      .catch((e) => { if (alive) toast("미리보기 생성 실패: " + (e?.message || ""), "error"); })
      .finally(() => { if (alive) setPreviewLoading(false); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewDoc, companyId]);
  useEffect(() => {
    try {
      const raw = localStorage.getItem(QUOTE_COLS_LSKEY);
      if (raw) setVisibleCols((prev) => ({ ...prev, ...JSON.parse(raw) }));
    } catch { /* ignore */ }
  }, []);
  const toggleCol = (key: string) => {
    setVisibleCols((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      try { localStorage.setItem(QUOTE_COLS_LSKEY, JSON.stringify(next)); } catch { /* ignore */ }
      return next;
    });
  };
  const cols = useMemo(() => QUOTE_LIST_COLS.filter((c) => visibleCols[c.key]), [visibleCols]);
  // 견적서 작성(인라인) — 문서함으로 넘어가지 않고 프로젝트에서 바로 생성
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [formKind, setFormKind] = useState<"quote" | "contract">("quote"); // 견적서 탭 vs 전자계약 탭 작성 구분
  const [quoteName, setQuoteName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [quoteSubDealId, setQuoteSubDealId] = useState(""); // 세부 프로젝트 연결(선택, 견적서 전용)
  const [creatingQuote, setCreatingQuote] = useState(false);
  const [creatingContractFrom, setCreatingContractFrom] = useState<string | null>(null);
  const [issuingInvoiceFrom, setIssuingInvoiceFrom] = useState<string | null>(null);
  // ★ 계약 → 계산서 발행 등록 (P2) — 계약금액을 이월해 매출 세금계산서(발행·미전송) 생성.
  //   status='issued'=매출 발행(리포트 매출 집계 기준). 홈택스 실전송은 세금계산서 메뉴 소관(여기선 DB 기록만).
  const createInvoiceFromContract = async (contractDoc: any) => {
    if (!companyId || issuingInvoiceFrom) return;
    const supply = quoteAmount(contractDoc) || Number(deal?.contract_total || 0);
    if (supply <= 0) { toast("계약 금액이 없습니다. 계약서에 금액을 먼저 입력하세요.", "error"); return; }
    setIssuingInvoiceFrom(contractDoc.id);
    try {
      const today = new Date().toISOString().slice(0, 10);
      await createTaxInvoice({
        companyId,
        dealId,
        type: "sales",
        counterpartyName: partner?.name || (contractDoc.content_json as any)?.header?.partnerName || "거래처",
        counterpartyBizno: partner?.business_number || undefined,
        supplyAmount: supply,
        issueDate: today,
        status: "issued",
        partnerId: deal?.partner_id || undefined,
        label: `${deal?.name || "프로젝트"} 계약 기반`,
      });
      qc.invalidateQueries({ queryKey: ["projecthub-pipe-summary", dealId] });
      toast(`매출 세금계산서를 발행 등록했습니다 (${won(supply)} · 미전송). 세금계산서 메뉴에서 국세청 전송하세요.`, "success");
    } catch (e: any) {
      toast(e?.message || "계산서 생성 실패", "error");
    } finally {
      setIssuingInvoiceFrom(null);
    }
  };
  const createDoc = async () => {
    if (!companyId || !userId || creatingQuote) return;
    setCreatingQuote(true);
    try {
      const subDealId = formKind === "quote" ? (quoteSubDealId || null) : null;
      let newId: string | null = null;
      if (selectedTemplateId) {
        // 선택한 양식으로 생성(양식 type → content_type 보존). 견적서면 세부 연결 부착.
        const doc: any = await createFromTemplate({ companyId, templateId: selectedTemplateId, dealId, name: quoteName.trim() || (formKind === "quote" ? "견적서" : "계약서"), createdBy: userId });
        newId = doc?.id || null;
        if (subDealId && newId) await db.from("documents").update({ sub_deal_id: subDealId }).eq("id", newId);
      } else {
        // 기본 구조로 생성 — 견적서(invoice·품목표) / 계약서(contract·본문)
        const { data, error } = await db.from("documents").insert({
          company_id: companyId,
          deal_id: dealId,
          sub_deal_id: subDealId,
          name: quoteName.trim() || (formKind === "quote" ? "견적서" : "계약서"),
          status: "draft",
          document_number: formKind === "quote" ? await nextQuoteNumber(companyId) : null,
          content_type: formKind === "quote" ? "invoice" : "contract",
          content_json: formKind === "quote" ? QUOTE_CONTENT : CONTRACT_CONTENT,
          version: 1,
          created_by: userId,
        }).select("id").single();
        if (error) throw error;
        newId = data?.id || null;
      }
      qc.invalidateQueries({ queryKey: ["projecthub-docs", dealId] });
      setShowQuoteForm(false);
      setQuoteName("");
      setSelectedTemplateId("");
      setQuoteSubDealId("");
      // 견적서는 생성 즉시 입력 화면(문서 편집기)으로 전환. 계약서는 발송·서명 흐름이 따로라 기존 동작 유지.
      if (formKind === "quote" && newId) {
        router.push(`/documents?id=${newId}`);
      } else {
        toast("문서를 생성했습니다. 목록에서 ‘열기/편집’으로 내용을 작성하세요.", "success");
      }
    } catch (e: any) {
      toast(e?.message || "문서 생성 실패", "error");
    } finally {
      setCreatingQuote(false);
    }
  };

  // ★ 견적 → 계약서 원클릭 자동생성 (Phase 1) — 견적 데이터(거래처·금액·품목)를 계약 문서로 이월 + 링크.
  //   방향(매출/매입)은 sub_deal_id 그대로 유지. 계약 PDF는 기존 buildContractVarsFromDeal 오버레이 재사용.
  const createContractFromQuote = async (quoteDoc: any) => {
    if (!companyId || !userId || creatingContractFrom) return;
    setCreatingContractFrom(quoteDoc.id);
    try {
      const q = (quoteDoc.content_json as any) || {};
      const amt = quoteAmount(quoteDoc);
      const partnerName = q.header?.partnerName || partner?.name || "";
      const contractContent = {
        ...CONTRACT_CONTENT,
        direction: q.direction,            // 방향(매출/매입) 유지 — 파이프라인 필터용
        header: { ...(q.header || {}) },   // 거래처·담당자·금액 이월
        items: q.items || [],              // 견적 품목 이월(참조)
        sections: [
          {
            title: "계약 내용",
            content: `본 계약은 견적서(${fmtNo(quoteDoc)})에 근거합니다.\n\n수신: ${partnerName}\n계약금액: ${amt ? amt.toLocaleString("ko-KR") + "원 (VAT 별도)" : "-"}\n\n※ 세부 조항은 편집기에서 작성해 주세요.`,
          },
        ],
      };
      const { data, error } = await db.from("documents").insert({
        company_id: companyId,
        deal_id: dealId,
        sub_deal_id: quoteDoc.sub_deal_id || null,   // 방향(매출/매입) 유지
        name: `${deal?.name || "프로젝트"} 계약서`,
        status: "draft",
        document_number: null,
        content_type: "contract",
        content_json: contractContent,
        source_document_id: quoteDoc.id,             // 견적 원본 링크
        version: 1,
        created_by: userId,
      }).select("id").single();
      if (error) throw error;
      // P2 자동 이월 — 매출 견적이면 계약금액(매출)을 자동 반영. 비어 있고 매출형 항목도 없을 때만(이중계상 방지).
      const isSalesQuote = q.direction !== "purchase" && (subDealOpts as any[]).find((x) => x.id === quoteDoc.sub_deal_id)?.type !== "purchase";
      let reflected = false;
      if (isSalesQuote && amt > 0 && !Number(deal?.contract_total || 0)) {
        const { data: existingSales } = await db.from("sub_deals").select("id").eq("parent_deal_id", dealId).eq("type", "sales").limit(1);
        if (!existingSales?.length) {
          await db.from("deals").update({ contract_total: amt }).eq("id", dealId);
          qc.invalidateQueries({ queryKey: ["projecthub-deal", dealId] });
          qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
          reflected = true;
        }
      }
      qc.invalidateQueries({ queryKey: ["projecthub-docs", dealId] });
      toast(reflected ? `견적서로 계약서를 생성하고 계약금액(매출) ${won(amt)}을 개요에 반영했습니다.` : "견적서로 계약서를 생성했습니다. 계약 탭에서 확인·발송하세요.", "success");
      setTab("contract");
    } catch (e: any) {
      toast(e?.message || "계약 생성 실패", "error");
    } finally {
      setCreatingContractFrom(null);
    }
  };

  // 견적서 작성 — 모달 없이 즉시 기본 견적서 초안 생성 후 편집 화면(/documents)으로 이동.
  //   문서번호는 기존 흐름대로 발행 시점에 부여됨.
  const createQuoteInstant = async () => {
    if (!companyId || !userId || creatingQuote) return;
    setCreatingQuote(true);
    try {
      const { data, error } = await db.from("documents").insert({
        company_id: companyId,
        deal_id: dealId,
        sub_deal_id: null,
        name: `${deal?.name || "프로젝트"} 견적서`,
        status: "draft",
        document_number: await nextQuoteNumber(companyId),
        content_type: "invoice",
        content_json: QUOTE_CONTENT,
        version: 1,
        created_by: userId,
      }).select("id").single();
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["projecthub-docs", dealId] });
      if (data?.id) router.push(`/documents?id=${data.id}`);
    } catch (e: any) {
      toast(e?.message || "견적서 생성 실패", "error");
    } finally {
      setCreatingQuote(false);
    }
  };
  // ★ 협력사 견적 수취(인바운드/매입) — content_json.direction='purchase' 로 매입 방향 견적 등록 (Phase 4)
  const createInboundQuote = async () => {
    if (!companyId || !userId || creatingQuote) return;
    setCreatingQuote(true);
    try {
      const { data, error } = await db.from("documents").insert({
        company_id: companyId,
        deal_id: dealId,
        sub_deal_id: null,
        name: "협력사 견적서",
        status: "draft",
        document_number: await nextQuoteNumber(companyId),
        content_type: "invoice",
        content_json: { ...QUOTE_CONTENT, direction: "purchase", title: "협력사 견적서" },
        version: 1,
        created_by: userId,
      }).select("id").single();
      if (error) throw error;
      qc.invalidateQueries({ queryKey: ["projecthub-docs", dealId] });
      if (data?.id) router.push(`/documents?id=${data.id}`);
    } catch (e: any) {
      toast(e?.message || "협력사 견적 등록 실패", "error");
    } finally {
      setCreatingQuote(false);
    }
  };
  // 양식 목록(계약서/견적서 등) — 없으면 기본양식 1회 시드
  const { data: docTemplates = [], isSuccess: templatesLoaded } = useQuery({
    queryKey: ["projecthub-doc-templates", companyId],
    queryFn: async () => {
      const { data } = await db.from("doc_templates").select("id, name, type").eq("company_id", companyId).eq("is_active", true);
      return (data || []) as any[];
    },
    enabled: !!companyId,
  });
  const quoteTemplates = useMemo(
    () => (docTemplates as any[]).filter((t: any) => ["quote", "invoice"].includes(t.type)),
    [docTemplates],
  );
  const contractTemplates = useMemo(
    () => (docTemplates as any[]).filter((t: any) => ["contract", "agreement", "nda"].includes(t.type)),
    [docTemplates],
  );
  // 작성 모달에 노출할 양식 — 견적서 탭이면 견적서 양식, 전자계약 탭이면 계약서 양식만
  const formTemplates = formKind === "quote" ? quoteTemplates : contractTemplates;
  const didSeedTplRef = useRef(false);
  useEffect(() => {
    if (!companyId || !userId || !templatesLoaded || didSeedTplRef.current) return;
    if (quoteTemplates.length + contractTemplates.length > 0) return;
    didSeedTplRef.current = true;
    seedDefaultDocTemplates(companyId, userId).then(() => qc.invalidateQueries({ queryKey: ["projecthub-doc-templates", companyId] }));
  }, [companyId, userId, templatesLoaded, quoteTemplates, contractTemplates, qc]);
  const [editingName, setEditingName] = useState(false);
  const [nameInput, setNameInput] = useState("");

  const renameMut = useMutation({
    mutationFn: async (name: string) => {
      const { error } = await db.from("deals").update({ name: name.trim() }).eq("id", dealId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["projecthub-deal", dealId] });
      qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
      setEditingName(false);
      toast("프로젝트명이 수정되었습니다", "success");
    },
    onError: (e: any) => toast(e?.message || "수정 실패", "error"),
  });
  const commitRename = () => {
    const v = nameInput.trim();
    if (!v || v === (deal?.name || "")) { setEditingName(false); return; }
    renameMut.mutate(v);
  };
  // 진행 단계 변경 (프로젝트 운영)
  const stageMut = useMutation({
    mutationFn: async (newStage: ProjectStage) => {
      const { error } = await db.from("deals").update({ stage: newStage }).eq("id", dealId);
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["projecthub-deal", dealId] }); qc.invalidateQueries({ queryKey: ["projecthub-deals"] }); toast("진행 단계가 변경되었습니다", "success"); },
    onError: (e: any) => toast(e?.message || "단계 변경 실패", "error"),
  });

  const { data: deal, isLoading } = useQuery({
    queryKey: ["projecthub-deal", dealId],
    queryFn: async () => {
      const { data } = await db.from("deals").select("*").eq("id", dealId).maybeSingle();
      return data as any;
    },
    enabled: !!companyId && !!dealId,
  });
  const { data: partner } = useQuery({
    queryKey: ["projecthub-deal-partner", deal?.partner_id],
    queryFn: async () => {
      const { data } = await db.from("partners").select("id, name, business_number, representative, contact_name, contact_email").eq("id", deal.partner_id).maybeSingle();
      return data as any;
    },
    enabled: !!deal?.partner_id,
  });
  const { data: manager } = useQuery({
    queryKey: ["projecthub-deal-manager", deal?.internal_manager_id],
    queryFn: async () => {
      const { data } = await db.from("users").select("id, name").eq("id", deal.internal_manager_id).maybeSingle();
      return data as any;
    },
    enabled: !!deal?.internal_manager_id,
  });
  // 회사 구성원 — 실행형 태스크 담당 선택용 (delivery 만 로드)
  const { data: companyUsers = [] } = useQuery({
    queryKey: ["projecthub-company-users", companyId],
    queryFn: async () => {
      const { data } = await db.from("users").select("id, name").eq("company_id", companyId).order("name", { ascending: true });
      return (data || []) as any[];
    },
    enabled: !!companyId && normalizeProjectType(deal?.project_type) === "delivery",
  });

  // 세부 프로젝트(캠페인) — 이 프로젝트를 부모로 하는 deals. 손익 롤업·목록 양쪽에 사용 → 항상 로드.
  const { data: children = [] } = useQuery({
    queryKey: ["projecthub-children", dealId],
    queryFn: async () => {
      const { data } = await db.from("deals")
        .select("id, name, contract_total, stage, status, start_date, end_date")
        .eq("parent_deal_id", dealId).is("archived_at", null)
        .order("created_at", { ascending: true });
      return (data || []) as any[];
    },
    enabled: !!companyId && !!dealId,
  });
  const childIds = useMemo(() => (children as any[]).map((c) => c.id), [children]);
  // 손익 집계 대상 = 자기 자신 + 모든 세부 프로젝트 (롤업)
  const costDealIds = useMemo(() => [dealId, ...childIds], [dealId, childIds]);

  // 매출/매입 관리(sub_deals) — 자기 + 모든 캠페인 롤업. 개요=약정 마진 산출, 캠페인 목록=항목별 합.
  //   금액은 '입력 총액'으로 저장되고 vat_type 플래그를 가짐 → 마진은 공급가액(net)으로 환산(inclusive ÷1.1).
  const { data: subDeals = [] } = useQuery({
    queryKey: ["projecthub-subdeals-roll", dealId, childIds.length],
    queryFn: async () => {
      const { data } = await db.from("sub_deals")
        .select("id, parent_deal_id, type, contract_amount, vat_type")
        .in("parent_deal_id", costDealIds);
      return (data || []) as any[];
    },
    enabled: !!companyId && !!dealId && (tab === "overview" || tab === "subprojects"),
  });
  // 공급가액(net) — VAT 포함 입력분은 ÷1.1, 별도면 입력값 그대로. 마진 정확성용.
  const subNet = (s: any) => (s?.vat_type === "inclusive" ? Math.round(Number(s.contract_amount || 0) / 1.1) : Number(s.contract_amount || 0));
  const hasInclusiveSub = useMemo(() => (subDeals as any[]).some((s) => s.vat_type === "inclusive"), [subDeals]);
  const subSalesSum = useMemo(() => (subDeals as any[]).filter((s) => s.type === "sales").reduce((a, s) => a + subNet(s), 0), [subDeals]);
  const subPurchaseSum = useMemo(() => (subDeals as any[]).filter((s) => s.type === "purchase").reduce((a, s) => a + subNet(s), 0), [subDeals]);
  // 캠페인(자식 deal)별 매출/매입 합 — 캠페인 목록 표시용 (공급가액 기준)
  const subByDeal = useMemo(() => {
    const m: Record<string, { sales: number; purchase: number }> = {};
    for (const s of subDeals as any[]) {
      const pid = s.parent_deal_id;
      if (!m[pid]) m[pid] = { sales: 0, purchase: 0 };
      if (s.type === "sales") m[pid].sales += subNet(s);
      else if (s.type === "purchase") m[pid].purchase += subNet(s);
    }
    return m;
  }, [subDeals]);

  // 상위 프로젝트 (이 deal 이 세부 프로젝트일 때) — 브레드크럼·복귀 링크
  const { data: parentDeal } = useQuery({
    queryKey: ["projecthub-parent", deal?.parent_deal_id],
    queryFn: async () => {
      const { data } = await db.from("deals").select("id, name").eq("id", deal.parent_deal_id).maybeSingle();
      return data as any;
    },
    enabled: !!deal?.parent_deal_id,
  });

  const createChild = async () => {
    if (!companyId || creatingChild) return;
    if (!childName.trim()) { toast("세부 프로젝트명을 입력하세요", "error"); return; }
    setCreatingChild(true);
    try {
      // 캠페인 금액은 deals.contract_total 이 아니라 생성 후 '매출/매입 관리'(sub_deals)에 입력 → 개요 마진 자동 산출
      // 거래처·담당자·분류는 상위 프로젝트에서 상속 (캠페인은 같은 거래처 산하가 일반적)
      const { data, error } = await db.from("deals").insert({
        company_id: companyId, parent_deal_id: dealId, name: childName.trim(),
        status: "active", stage: "estimate",
        partner_id: deal?.partner_id || null, internal_manager_id: deal?.internal_manager_id || null,
        classification: deal?.classification || null,
      }).select("id").single();
      if (error) throw new Error(error.message);
      // 매출/매입(개요) → 새 캠페인의 sub_deals 로 seed. (개요 마진에만, 실적 비용/마진엔 미반영)
      const newChildId = data?.id;
      if (newChildId) {
        const sp = Number(String(childSalesPlan).replace(/[^0-9]/g, "")) || 0;
        const pp = Number(String(childPurchasePlan).replace(/[^0-9]/g, "")) || 0;
        const seeds: any[] = [];
        if (sp > 0) seeds.push({ parent_deal_id: newChildId, name: "매출", type: "sales", partner_id: deal?.partner_id || null, contract_amount: sp, vat_type: childSalesVat === "include" ? "inclusive" : "exclusive", status: "estimate" });
        if (pp > 0) seeds.push({ parent_deal_id: newChildId, name: "매입", type: "purchase", partner_id: deal?.partner_id || null, contract_amount: pp, vat_type: childPurchaseVat === "include" ? "inclusive" : "exclusive", status: "estimate" });
        if (seeds.length) { const { error: seedErr } = await db.from("sub_deals").insert(seeds); if (seedErr) throw new Error(seedErr.message); }
      }
      qc.invalidateQueries({ queryKey: ["projecthub-children", dealId] });
      qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
      setShowChildForm(false); resetChildForm();
      toast("세부 프로젝트를 생성했습니다", "success");
      if (newChildId) router.push(`/projecthub/${newChildId}`);
    } catch (e: any) { toast(e?.message || "생성 실패", "error"); } finally { setCreatingChild(false); }
  };

  // 캠페인 수정(이름·단계·기간 — deals 직접 update). 금액은 sub_deals(매출/매입 관리) 소관이라 제외.
  const openEditChild = (c: any) => {
    setEditChild(c);
    setEditChildName(c.name || "");
    setEditChildStage(STAGE_ORDER.includes(c.stage) ? c.stage : "estimate");
    setEditChildStart(c.start_date || "");
    setEditChildEnd(c.end_date || "");
  };
  const saveChild = async () => {
    if (!editChild || savingChild) return;
    if (!editChildName.trim()) { toast("캠페인명을 입력하세요", "error"); return; }
    setSavingChild(true);
    try {
      const { error } = await db.from("deals").update({
        name: editChildName.trim(),
        stage: editChildStage,
        start_date: editChildStart || null,
        end_date: editChildEnd || null,
      }).eq("id", editChild.id);
      if (error) throw new Error(error.message);
      qc.invalidateQueries({ queryKey: ["projecthub-children", dealId] });
      qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
      toast("캠페인을 수정했습니다", "success");
      setEditChild(null);
    } catch (e: any) { toast(e?.message || "수정 실패", "error"); } finally { setSavingChild(false); }
  };
  // 캠페인 삭제 — 소프트 삭제(archived_at). children 쿼리가 archived_at IS NULL 만 보므로 목록에서 사라지고
  //   회계 데이터(매출·매입·견적·계약)는 전부 보존. 상위 프로젝트 삭제(DeleteProjectModal)와 동일 정책.
  const removeChild = async () => {
    if (!deleteTarget || deletingChild) return;
    setDeletingChild(true);
    try {
      const nowIso = new Date().toISOString();
      const { error } = await db.from("deals").update({ archived_at: nowIso }).eq("id", deleteTarget.id);
      if (error) throw new Error(error.message);
      try {
        await db.from("audit_logs").insert({
          company_id: companyId, entity_type: "deal", entity_id: deleteTarget.id, action: "delete",
          before_json: { archived_at: null, name: deleteTarget.name },
          after_json: { archived_at: nowIso },
          metadata: { soft_delete: true, deal_name: deleteTarget.name, source: "projecthub-campaign-list" },
        });
      } catch { /* audit 실패 무시 */ }
      qc.invalidateQueries({ queryKey: ["projecthub-children", dealId] });
      qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
      toast("캠페인을 삭제했습니다", "success");
      setDeleteTarget(null);
    } catch (e: any) { toast(e?.message || "삭제 실패", "error"); } finally { setDeletingChild(false); }
  };

  // 파이프라인(방향) 탭 — 견적/계약/매출·매입을 방향(sub_deal.type)으로 걸러 한 흐름에 표시
  const pipelineDir: "sales" | "purchase" | null = tab === "sales_pipeline" ? "sales" : tab === "purchase_pipeline" ? "purchase" : null;
  const isDocTab = tab === "quote" || tab === "contract" || !!pipelineDir;

  // 견적 승인 시 계약 자동생성 토글 (company_settings.settings.auto_contract_on_approve)
  const { data: autoContractOn = false } = useQuery({
    queryKey: ["auto-contract-setting", companyId],
    queryFn: async () => {
      const { data } = await db.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
      return !!((data?.settings as any)?.auto_contract_on_approve);
    },
    enabled: !!companyId && !!pipelineDir,
  });
  const toggleAutoContract = async (val: boolean) => {
    if (!companyId) return;
    const { data: cur } = await db.from("company_settings").select("settings").eq("company_id", companyId).maybeSingle();
    const settings = { ...((cur?.settings as any) || {}), auto_contract_on_approve: val };
    const { error } = await db.from("company_settings").update({ settings }).eq("company_id", companyId);
    if (error) { toast("설정 저장 실패: " + error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["auto-contract-setting", companyId] });
    toast(val ? "견적 승인 시 계약서 자동 생성 — 켬" : "견적 승인 시 계약서 자동 생성 — 끔", "success");
  };

  // 견적/계약 — documents(deal_id) + quote_tracking + quote_approvals + signature_requests
  const { data: documents = [] } = useQuery({
    queryKey: ["projecthub-docs", dealId],
    queryFn: async () => {
      const { data } = await db.from("documents").select("id, name, status, content_type, contract_amount, document_number, created_at, content_json, sub_deal_id, source_document_id").eq("deal_id", dealId).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!dealId && isDocTab,
  });
  const docIds = useMemo(() => documents.map((d) => d.id), [documents]);
  // 견적서 탭 / 전자계약 탭 문서 분리 — 견적서(invoice·quote) vs 계약(나머지)
  const quoteDocs = useMemo(() => (documents as any[]).filter((d) => docKind(d) === "quote"), [documents]);
  const contractDocs = useMemo(() => (documents as any[]).filter((d) => docKind(d) === "contract"), [documents]);
  // 세부 프로젝트 목록(견적 작성 시 연결용) — 경량 select
  const { data: subDealOpts = [] } = useQuery({
    queryKey: ["sub-deals-mini", dealId],
    queryFn: async () => {
      const { data } = await db.from("sub_deals").select("id, name, type").eq("parent_deal_id", dealId).order("created_at", { ascending: true });
      return (data || []) as { id: string; name: string; type: string | null }[];
    },
    enabled: !!dealId && (tab === "quote" || !!pipelineDir),
  });
  const { data: quoteTracking = [] } = useQuery({
    queryKey: ["projecthub-quotes", dealId, docIds.length],
    queryFn: async () => {
      if (docIds.length === 0) return [];
      const { data } = await db.from("quote_tracking").select("*").in("document_id", docIds);
      return (data || []) as any[];
    },
    enabled: (tab === "quote" || !!pipelineDir) && docIds.length > 0,
  });
  const { data: approvals = [] } = useQuery({
    queryKey: ["projecthub-approvals", dealId],
    queryFn: async () => {
      const { data } = await db.from("quote_approvals").select("*").eq("deal_id", dealId).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: isDocTab && !!dealId,
  });
  const { data: sigRequests = [] } = useQuery({
    queryKey: ["projecthub-sigs", dealId, docIds.length],
    queryFn: async () => {
      if (docIds.length === 0) return [];
      const { data } = await db.from("signature_requests").select("id, title, status, signer_name, signer_email, signed_at, our_signed_at, signed_contract_url, document_id").in("document_id", docIds).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: (tab === "contract" || !!pipelineDir) && docIds.length > 0,
  });

  // 손익 — 프로젝트(deal_id)에 태그된 비용처리 내역: 세금계산서(매입)·현금영수증·카드사용·수동전표
  //   수익형(margin) 개요에서만 — 목표형/실행형은 자체 히어로 사용.
  const costEnabled = (tab === "overview") && !!dealId && normalizeProjectType(deal?.project_type) === "margin";
  const { data: costInvoices = [] } = useQuery({
    queryKey: ["projecthub-cost-inv", dealId, childIds.length],
    queryFn: async () => {
      const { data } = await db.from("tax_invoices").select("id, issue_date, counterparty_name, supply_amount, total_amount").in("deal_id", costDealIds).eq("type", "purchase").neq("status", "void").order("issue_date", { ascending: false });
      return (data || []) as any[];
    },
    enabled: costEnabled,
  });
  const { data: costCash = [] } = useQuery({
    queryKey: ["projecthub-cost-cash", dealId, childIds.length],
    queryFn: async () => {
      const { data } = await db.from("cash_receipts").select("id, issue_date, counterparty_name, amount, supply_amount").in("deal_id", costDealIds).order("issue_date", { ascending: false });
      return (data || []) as any[];
    },
    enabled: costEnabled,
  });
  const { data: costCards = [] } = useQuery({
    queryKey: ["projecthub-cost-card", dealId, childIds.length],
    queryFn: async () => {
      const { data } = await db.from("card_transactions").select("id, transaction_date, merchant_name, amount, card_name").in("deal_id", costDealIds).is("journal_entry_id", null).order("transaction_date", { ascending: false });
      return (data || []) as any[];
    },
    enabled: costEnabled,
  });
  const { data: costVouchers = [] } = useQuery({
    queryKey: ["projecthub-cost-voucher", dealId, childIds.length],
    queryFn: async () => {
      const { data } = await db.from("journal_entries").select("id, entry_date, description, journal_lines(debit, chart_of_accounts(code, name, account_type))").in("deal_id", costDealIds).eq("source", "manual").eq("status", "confirmed").order("entry_date", { ascending: false });
      return (data || []) as any[];
    },
    enabled: costEnabled,
  });

  // 파이프라인 리본(개요) — 견적▶계약▶계산서▶정산 단계별 금액·상태 경량 집계. 수익형 개요에서만.
  const { data: pipe } = useQuery({
    queryKey: ["projecthub-pipe-summary", dealId, childIds.length],
    queryFn: async () => {
      const { data: docsData } = await db.from("documents").select("id, content_type, content_json, contract_amount, status, source_document_id, created_at").eq("deal_id", dealId).order("created_at", { ascending: false });
      const list = (docsData || []) as any[];
      const quotes = list.filter((d) => docKind(d) === "quote");
      const contracts = list.filter((d) => docKind(d) === "contract");
      const ids = list.map((d) => d.id);
      const [sigsRes, invRes] = await Promise.all([
        ids.length ? db.from("signature_requests").select("id, status, signed_at, document_id").in("document_id", ids) : Promise.resolve({ data: [] as any[] }),
        db.from("tax_invoices").select("id, supply_amount, total_amount, status, issue_date").in("deal_id", costDealIds).eq("type", "sales").neq("status", "void"),
      ]);
      return { quotes, contracts, sigs: (sigsRes.data || []) as any[], invoices: (invRes.data || []) as any[] };
    },
    enabled: costEnabled,
  });

  // 접근 권한은 RouteGuard(user_tab_access grant)가 처리 — 여기서 role 하드코딩 차단 제거(담당자 직원 접근 허용)
  if (isLoading) return <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>;
  if (!deal) return <div className="p-12 text-center text-sm text-[var(--text-muted)]">프로젝트를 찾을 수 없습니다. <Link href="/projecthub" className="text-[var(--primary)] hover:underline">목록으로</Link></div>;

  const stage = (STAGE_ORDER.includes(deal.stage) ? deal.stage : "estimate") as ProjectStage;
  const sc = STAGE_COLOR[stage];
  const projectType = normalizeProjectType(deal.project_type);
  const typeCfg = getProjectTypeConfig(deal.project_type);
  const hasChildren = (children as any[]).length > 0;
  const ownContract = Number(deal.contract_total || 0);
  // 확정 비용 = 프로젝트에 태그된 각 비용원 합 (카테고리별 — 같은 비용을 두 곳에 태그하면 중복이니 한 곳만)
  const sumBy = (arr: any[], f: (x: any) => number) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const costInvoiceSum = sumBy(costInvoices as any[], (i) => i.supply_amount || i.total_amount);
  const costCashSum = sumBy(costCash as any[], (c) => c.supply_amount || c.amount);
  const costCardSum = sumBy(costCards as any[], (c) => c.amount);
  const costVoucherSum = sumBy(costVouchers as any[], (v) =>
    (v.journal_lines || []).filter((l: any) => l.chart_of_accounts?.account_type === "expense").reduce((s: number, l: any) => s + Number(l.debit || 0), 0));
  const totalCost = costInvoiceSum + costCashSum + costCardSum + costVoucherSum;
  // 개요 마진 — 매출은 단일 산식(자체 계약 + 매출형 sub_deals, 캠페인 롤업). 비용은 예상(매입형)↔확정(태그전표).
  const planRevenue = ownContract + subSalesSum;   // 계약·약정 기준 매출
  const planCost = subPurchaseSum;                 // 예상 비용 = 매입형 sub_deals
  // 매출 SoT(최고 확정단계) — 계산서 발행분이 있으면 그 금액, 없으면 계약·약정 금액. (P3)
  const confirmedRevenue = ((pipe?.invoices || []) as any[]).reduce((a, i) => a + Number(i.supply_amount || 0), 0);
  const salesSoT = confirmedRevenue > 0 ? confirmedRevenue : planRevenue;
  const revenueBasis = confirmedRevenue > 0 ? "계산서 발행 기준" : planRevenue > 0 ? "계약·약정 기준" : "미입력";
  const COST_SOURCES = [
    { key: "invoice", label: "세금계산서(매입)", total: costInvoiceSum, count: costInvoices.length, items: costInvoices as any[] },
    { key: "cash", label: "현금영수증", total: costCashSum, count: costCash.length, items: costCash as any[] },
    { key: "card", label: "카드사용", total: costCardSum, count: costCards.length, items: costCards as any[] },
    { key: "voucher", label: "수동 전표", total: costVoucherSum, count: costVouchers.length, items: costVouchers as any[] },
  ];

  // 방향별 파이프라인 표시 — 문서 방향 판정(sub_deal.type, 미지정=매출) + 방향 필터 + 진행 스텝
  const dirOfDoc = (d: any): "sales" | "purchase" => {
    const explicit = (d.content_json as any)?.direction;
    if (explicit === "purchase" || explicit === "sales") return explicit;
    const sd = (subDealOpts as any[]).find((x) => x.id === d.sub_deal_id);
    return sd?.type === "purchase" ? "purchase" : "sales";
  };
  const quoteDocsShown = pipelineDir ? (quoteDocs as any[]).filter((d) => dirOfDoc(d) === pipelineDir) : (quoteDocs as any[]);
  const contractDocsShown = pipelineDir ? (contractDocs as any[]).filter((d) => dirOfDoc(d) === pipelineDir) : (contractDocs as any[]);
  const stepReached = (sigRequests as any[]).length > 0 ? 2 : contractDocsShown.length > 0 ? 1 : quoteDocsShown.length > 0 ? 0 : -1;

  return (
    <div className="space-y-6">
      <div className="page-sticky-header flex flex-wrap items-center gap-2">
        {deal.parent_deal_id ? (
          <Link href={`/projecthub/${deal.parent_deal_id}?tab=subprojects`} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]" title="상위 프로젝트의 세부 프로젝트 목록으로">← {parentDeal?.name || "상위 프로젝트"}</Link>
        ) : (
          <Link href="/projecthub" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">← 프로젝트</Link>
        )}
        {deal.parent_deal_id && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-[var(--primary)]/10 text-[var(--primary)]">세부 프로젝트</span>}
        {/* 영업단계 배지는 수익형 전용 — 목표형/실행형엔 견적·계약 개념이 없어 유형 배지로 대체 */}
        {projectType === "margin" ? (
          <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.text}`}>{STAGE_LABEL[stage]}</span>
        ) : (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-[var(--bg-surface)] text-[var(--text-muted)] border border-[var(--border)]">{typeCfg.icon} {typeCfg.label}</span>
        )}
        {editingName ? (
          <input
            value={nameInput} autoFocus
            onChange={(e) => setNameInput(e.target.value)}
            onBlur={commitRename}
            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingName(false); }}
            className="text-lg font-bold bg-transparent border-b-2 border-[var(--primary)] text-[var(--text)] focus:outline-none w-full max-w-md"
          />
        ) : (
          <h1 onClick={() => { setNameInput(deal.name || ""); setEditingName(true); }}
            className="text-lg font-bold text-[var(--text)] truncate cursor-text hover:opacity-80 inline-flex items-center gap-1.5 min-w-0"
            title="클릭하여 프로젝트명 수정">
            {deal.name || "(이름 없음)"}
            <svg className="w-3.5 h-3.5 text-[var(--text-dim)] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" /><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" /></svg>
          </h1>
        )}
        {/* 거래처 문구 — 수익형만 '미지정' 유도. 목표형/실행형(내부 프로젝트)은 있을 때만 표시 */}
        <span className="text-xs text-[var(--text-dim)]">{[partner?.name || (projectType === "margin" ? "거래처 미지정" : null), manager?.name ? `담당 ${manager.name}` : null].filter(Boolean).join(" · ")}</span>
      </div>

      {/* 탭 — 유형별 노출 탭(typeCfg.tabs). 세부 프로젝트(캠페인) 화면에서는 '세부 프로젝트'(2단계 제한)·'프로젝트 운영' 숨김 */}
      <div className="seg-bar overflow-x-auto max-w-full">
        {typeCfg.tabs.filter((k) => !(deal.parent_deal_id && (k === "subprojects" || k === "pnl"))).map((k) => (
          <button key={k} onClick={() => setTab(k)}
            className={`seg-item whitespace-nowrap ${tab === k ? "seg-item-active" : ""}`}>
            {TAB_LABEL[k]}
            {k === "subprojects" && hasChildren && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">{(children as any[]).length}</span>}
          </button>
        ))}
      </div>

      {/* 개요 — 목표형 성과 콕핏(그래프 대시보드) */}
      {tab === "overview" && projectType === "goal" && (
        <GoalOverviewTab deal={deal} />
      )}

      {/* 개요 — 실행형 콕핏(태스크 진행률·상태분포·마감·담당자별 현황) */}
      {tab === "overview" && projectType === "delivery" && (
        <DeliveryOverview deal={deal} dealId={dealId} partner={partner} manager={manager} companyUsers={companyUsers as any[]} />
      )}

      {/* 개요 — 수익형(margin): 마진 콕핏(예상→확정 한 축) + 단계 스텝 + 확정비용/기본정보.
          매출은 단일 산식(자체계약+매출형, 캠페인 롤업)으로 통일 — 약정/실적 매출 불일치 제거. */}
      {tab === "overview" && projectType === "margin" && (
        (planRevenue === 0 && totalCost === 0 && subPurchaseSum === 0) ? (
          <MarginOnboarding onTab={setTab} />
        ) : (
        <div className="space-y-5">
          <MarginCockpit
            revenue={salesSoT}
            revenueBasis={revenueBasis}
            planCost={planCost}
            actualCost={totalCost}
            hasActual={totalCost > 0}
            rolled={hasChildren ? (children as any[]).length : 0}
            stage={stage}
          />
          <PipelineRibbon pipe={pipe} contractTotal={ownContract} onOpen={setTab} />
          <StageStepper stage={stage} onPick={(s) => !stageMut.isPending && stageMut.mutate(s)} pending={stageMut.isPending} />
          {hasInclusiveSub && (
            <p className="text-[11px] text-[var(--text-dim)]">※ VAT <b className="text-[var(--text-muted)]">포함</b>으로 입력한 매출/매입 항목은 <b className="text-[var(--text-muted)]">공급가액(VAT 제외)</b> 기준으로 환산해 계산됩니다.</p>
          )}
          <div className="grid gap-5 lg:grid-cols-3">
            <div className="lg:col-span-2 space-y-5">
              <div className="cost-breakdown glass-card overflow-hidden">
                <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] flex items-center justify-between">
                  <span className="text-xs font-bold text-[var(--text-muted)]">확정 비용 구성 <span className="font-normal text-[var(--text-dim)]">— 프로젝트에 태그된 지출</span></span>
                  <span className="text-sm font-bold mono-number text-[var(--text)]">{won(totalCost)}</span>
                </div>
                <div className="divide-y divide-[var(--border)]/40">
                  {COST_SOURCES.map((s) => (
                    <details key={s.key} className="group">
                      <summary className="px-4 py-3 flex items-center gap-2 cursor-pointer hover:bg-[var(--bg-surface)]/50 list-none">
                        <span className="text-[var(--text-dim)] text-[10px] group-open:rotate-90 transition-transform">▶</span>
                        <span className="text-sm text-[var(--text)] flex-1">{s.label}</span>
                        <span className="text-[11px] text-[var(--text-dim)]">{s.count}건</span>
                        <span className="text-sm font-bold mono-number text-[var(--text)] w-32 text-right">{won(s.total)}</span>
                      </summary>
                      <div className="px-4 pb-3 pl-9 space-y-0.5">
                        {s.count === 0 ? (
                          <div className="text-[11px] text-[var(--text-dim)]">태그된 {s.label} 없음 — 각 내역 화면에서 이 프로젝트로 지정하세요.</div>
                        ) : s.items.slice(0, 80).map((it: any) => <CostItemRow key={it.id} kind={s.key} it={it} />)}
                      </div>
                    </details>
                  ))}
                </div>
              </div>
            </div>
            <div className="space-y-5">
              <div className="project-basic-info glass-card p-5">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold">기본 정보</h3>
                </div>
                <div className="grid grid-cols-1 gap-y-3 text-sm">
                  <Info label="거래처" value={partner?.name || "—"} />
                  <Info label="담당자" value={manager?.name || "—"} />
                  <Info label="분류" value={deal.classification || "—"} />
                  <Info label="단계" value={STAGE_LABEL[stage]} />
                  <Info label="시작일" value={fmtDate(deal.start_date)} />
                  <Info label="종료일" value={fmtDate(deal.end_date)} />
                  <Info label="상태" value={deal.status || "—"} />
                  <Info label="다음 액션" value={deal.next_action_text || "—"} />
                </div>
              </div>
              <div className="glass-card p-4 text-[11px] text-[var(--text-muted)] leading-relaxed">
                · <b className="text-[var(--text)]">확정 비용</b> = 태그된 세금계산서·현금영수증·카드·전표 합계. 각 내역 화면에서 이 프로젝트를 지정하면 자동 집계됩니다. <b className="text-[var(--text)]">같은 지출을 두 곳에 중복 태그하지 마세요</b>(이중 계상).
              </div>
            </div>
          </div>
        </div>
        )
      )}

      {/* 세부 프로젝트 */}
      {tab === "subdeals" && companyId && <SubDealsTab dealId={dealId} companyId={companyId} />}

      {/* 견적서 */}
      {/* 방향별 파이프라인 스텝 인디케이터 (수주/발주 탭 상단) */}
      {pipelineDir && (
        <div className="glass-card p-5">
          <div className="flex items-center justify-between mb-4 gap-2 flex-wrap">
            <h3 className="text-sm font-bold text-[var(--text)]">{pipelineDir === "sales" ? "📤 수주(매출) 파이프라인" : "📥 발주(매입) 파이프라인"}</h3>
            <span className="text-[11px] text-[var(--text-dim)]">{pipelineDir === "sales" ? "고객 견적 발송 → 승인 → 계약 생성 → 서명 → 정산" : "협력사 견적 등록 → 발주 계약 → 서명 → 검수 → 정산"}</span>
          </div>
          <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
            {["견적", "계약", "서명", "진행", "정산"].map((s, i) => (
              <div key={s} className="flex items-center">
                <span className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${i <= stepReached ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] text-[var(--text-dim)]"}`}>{s}</span>
                {i < 4 && <span className={`mx-0.5 text-xs ${i < stepReached ? "text-[var(--primary)]" : "text-[var(--text-dim)]"}`}>▶</span>}
              </div>
            ))}
          </div>
          <label className="mt-2 flex items-center gap-1.5 text-[11px] text-[var(--text-muted)] cursor-pointer w-fit">
            <input type="checkbox" checked={autoContractOn} onChange={(e) => toggleAutoContract(e.target.checked)} className="accent-[var(--primary)]" />
            견적 승인 시 계약서 자동 생성 (회사 전체 설정)
          </label>
        </div>
      )}

      {(tab === "quote" || pipelineDir) && (
        <div className="space-y-3">
          {/* 회사 견적 양식 PDF 업로드 → AI 인식 → 견적 생성 시 그 디자인으로 자동 작성 */}
          {companyId && <FormTemplateManager companyId={companyId} only="quote" />}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-[var(--text-muted)]">이 프로젝트의 견적서·연결 문서입니다. <span className="text-[var(--text-dim)]">견적No.를 클릭하면 수정 화면으로 이동합니다.</span></p>
            <div className="flex items-center gap-2 relative">
              <button onClick={() => setShowColSettings((v) => !v)}
                className="btn-secondary text-xs">⚙ 열 설정</button>
              <button onClick={pipelineDir === "purchase" ? createInboundQuote : createQuoteInstant} disabled={creatingQuote}
                className="btn-primary text-xs hover:opacity-90">{creatingQuote ? "생성 중..." : pipelineDir === "purchase" ? "📥 협력사 견적 등록" : "+ 견적서 작성"}</button>
              {showColSettings && (
                <>
                  <div className="fixed inset-0 z-[60]" onClick={() => setShowColSettings(false)} />
                  <div className="absolute right-0 top-full mt-1.5 z-[61] w-52 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl shadow-xl p-2">
                    <div className="text-[11px] font-bold text-[var(--text-muted)] px-2 py-1.5">리스트에 표시할 항목</div>
                    {QUOTE_LIST_COLS.map((c) => (
                      <label key={c.key} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-[var(--bg-surface)] cursor-pointer text-sm">
                        <input type="checkbox" checked={!!visibleCols[c.key]} onChange={() => toggleCol(c.key)} className="accent-[var(--primary)]" />
                        <span className="text-[var(--text)]">{c.label}</span>
                      </label>
                    ))}
                  </div>
                </>
              )}
            </div>
          </div>

          {quoteDocsShown.length === 0 ? (
            <Empty text="이 프로젝트에 연결된 견적서가 없습니다. 위 “+ 견적서 작성”으로 만들어 보세요." />
          ) : (
            <div className="glass-card overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-xs text-[var(--text-dim)]">
                    {cols.map((c) => (
                      <th key={c.key} className={`px-3 py-2.5 text-[12px] font-bold whitespace-nowrap border-b border-[var(--border)] ${c.align === "r" ? "text-right" : c.align === "c" ? "text-center" : "text-left"}`}>{c.label}</th>
                    ))}
                    <th className="px-3 py-2.5 text-[12px] font-bold whitespace-nowrap border-b border-[var(--border)] text-center">계약</th>
                  </tr>
                </thead>
                <tbody>
                  {quoteDocsShown.map((doc) => {
                    const qt = quoteTracking.find((q) => q.document_id === doc.id);
                    const header = (doc.content_json as any)?.header || {};
                    const st = qt?.status || doc.status || "—";
                    const cellCls = (c: QCol) => `px-3 py-2.5 border-b border-[var(--border)]/40 ${c.align === "r" ? "text-right" : c.align === "c" ? "text-center" : "text-left"}`;
                    return (
                      <tr key={doc.id} className="hover:bg-[var(--bg-surface)]/50">
                        {cols.map((c) => {
                          if (c.key === "no") return <td key={c.key} className={cellCls(c)}><Link href={`/documents?id=${doc.id}`} className="font-semibold text-[var(--primary)] hover:underline whitespace-nowrap">{fmtNo(doc)}</Link></td>;
                          if (c.key === "partner") return <td key={c.key} className={cellCls(c)}><span className="text-[var(--text)] truncate">{header.partnerName || partner?.name || "—"}</span></td>;
                          if (c.key === "manager") return <td key={c.key} className={cellCls(c)}><span className="text-[var(--text)]">{header.manager || manager?.name || "—"}</span></td>;
                          if (c.key === "items") return <td key={c.key} className={cellCls(c)}><span className="text-[var(--text)] truncate" title={quoteItemSummary(doc)}>{quoteItemSummary(doc)}</span></td>;
                          if (c.key === "subdeal") { const sd = subDealOpts.find((x) => x.id === doc.sub_deal_id); return <td key={c.key} className={cellCls(c)}>{sd ? <span className="text-[11px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] whitespace-nowrap">{sd.type === "sales" ? "매출·" : sd.type === "purchase" ? "매입·" : ""}{sd.name}</span> : <span className="text-[var(--text-dim)]">—</span>}</td>; }
                          if (c.key === "valid") return <td key={c.key} className={cellCls(c)}><span className="text-[var(--text-muted)] whitespace-nowrap">{header.validUntil ? fmtDate(header.validUntil) : "—"}</span></td>;
                          if (c.key === "amount") { const a = quoteAmount(doc); return <td key={c.key} className={cellCls(c)}><span className="mono-number text-[var(--text)]">{a ? a.toLocaleString("ko-KR") : "—"}</span></td>; }
                          if (c.key === "status") return <td key={c.key} className={cellCls(c)}><span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] whitespace-nowrap">{st}</span></td>;
                          if (c.key === "created") return <td key={c.key} className={cellCls(c)}><span className="text-[var(--text-muted)] whitespace-nowrap">{fmtDate(doc.created_at)}</span></td>;
                          if (c.key === "views") return <td key={c.key} className={cellCls(c)}><span className="text-[var(--text-muted)]">{qt?.view_count ?? 0}</span></td>;
                          if (c.key === "print") return <td key={c.key} className={cellCls(c)}><button onClick={(e) => { e.stopPropagation(); setPreviewDoc(doc); }} className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--primary)] hover:underline whitespace-nowrap">인쇄</button></td>;
                          return <td key={c.key} className={cellCls(c)}>—</td>;
                        })}
                        <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center whitespace-nowrap">
                          <button
                            onClick={(e) => { e.stopPropagation(); createContractFromQuote(doc); }}
                            disabled={creatingContractFrom === doc.id}
                            className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 disabled:opacity-50 whitespace-nowrap"
                            title="이 견적서 내용으로 계약서를 생성합니다">
                            {creatingContractFrom === doc.id ? "생성 중…" : "📄 계약 생성"}
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {approvals.filter((a) => a.stage === "견적" || a.stage === "estimate").length > 0 && (
            <div className="glass-card p-5">
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2">견적 승인 흐름</div>
              {approvals.filter((a) => a.stage === "견적" || a.stage === "estimate").map((a) => (
                <ApprovalRow key={a.id} a={a} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 계약 */}
      {(tab === "contract" || pipelineDir) && (
        <div className="space-y-3">
          {/* 회사 계약 양식 PDF 업로드 → AI 인식 → 서명완료 계약 PDF를 그 디자인+서명칸으로 자동 생성 */}
          {companyId && <FormTemplateManager companyId={companyId} only="contract" />}
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-[var(--text-muted)]">이 프로젝트의 계약서·전자서명입니다. <span className="text-[var(--text-dim)]">계약서 작성·발송은 여기서 관리합니다(견적서와 분리).</span></p>
            <div className="flex items-center gap-2">
              <button onClick={() => { setFormKind("contract"); setSelectedTemplateId(""); setQuoteSubDealId(""); setQuoteName(`${deal?.name || "프로젝트"} 계약서`); setShowQuoteForm(true); }}
                className="btn-primary text-xs hover:opacity-90">+ 계약서 작성</button>
              <Link href="/signatures?bulk=1" className="btn-secondary text-xs">📤 단체 일괄 발송</Link>
              <Link href="/signatures" className="btn-secondary text-xs">전자계약 메뉴 →</Link>
            </div>
          </div>

          {/* 계약 문서 (견적서 제외) — 작성·편집 */}
          {contractDocsShown.length > 0 && (
            <div className="glass-card overflow-hidden divide-y divide-[var(--border)]/40">
              <div className="px-4 py-2.5 bg-[var(--bg-surface)] text-[11px] font-bold text-[var(--text-muted)]">계약 문서</div>
              {contractDocsShown.map((doc) => (
                <div key={doc.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  <Link href={`/documents?id=${doc.id}`} className="min-w-0 flex-1 text-sm text-[var(--primary)] font-medium hover:underline truncate">{doc.name || "계약서"}</Link>
                  {doc.source_document_id && (() => {
                    const src = (documents as any[]).find((x) => x.id === doc.source_document_id);
                    return <Link href={`/documents?id=${doc.source_document_id}`} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] shrink-0 hover:underline" title="이 계약의 원본 견적서">← 견적 {src ? fmtNo(src) : "원본"}</Link>;
                  })()}
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] shrink-0">{doc.status || "draft"}</span>
                  <span className="text-[11px] text-[var(--text-dim)] shrink-0 mono-number">{fmtDate(doc.created_at)}</span>
                  {pipelineDir !== "purchase" && (
                    <button onClick={() => createInvoiceFromContract(doc)} disabled={issuingInvoiceFrom === doc.id}
                      className="text-[11px] font-semibold px-2 py-1 rounded-lg bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 disabled:opacity-50 whitespace-nowrap shrink-0"
                      title="이 계약금액으로 매출 세금계산서를 발행 등록합니다(미전송)">
                      {issuingInvoiceFrom === doc.id ? "발행 중…" : "🧾 계산서 발행"}
                    </button>
                  )}
                  <Link href={`/documents?id=${doc.id}&print=1`} className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--primary)] hover:underline shrink-0">인쇄</Link>
                </div>
              ))}
            </div>
          )}

          {sigRequests.length === 0 && approvals.length === 0 && contractDocs.length === 0 ? (
            <Empty text="이 프로젝트에 연결된 계약서·전자계약 내역이 없습니다. 위 “+ 계약서 작성”으로 만들어 보세요." />
          ) : (
            <>
              {sigRequests.length > 0 && (
                <div className="glass-card overflow-hidden divide-y divide-[var(--border)]/40">
                  {sigRequests.map((s) => (
                    <div key={s.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                      <div className="min-w-0 flex-1">
                        <div className="text-sm text-[var(--text)] truncate">{s.title || "계약서"}</div>
                        <div className="text-[11px] text-[var(--text-dim)]">{s.signer_name || "—"}{s.signer_email ? ` · ${s.signer_email}` : ""}</div>
                      </div>
                      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] shrink-0">{s.status}</span>
                      {s.signed_at && <span className="text-[11px] text-green-500 shrink-0">서명완료 {fmtDate(s.signed_at)}</span>}
                      {s.signed_contract_url && <a href={s.signed_contract_url} target="_blank" rel="noreferrer" className="text-[11px] text-[var(--primary)] hover:underline shrink-0">계약서</a>}
                    </div>
                  ))}
                </div>
              )}
              {approvals.length > 0 && (
                <div className="glass-card p-5">
                  <div className="text-xs font-bold text-[var(--text-muted)] mb-2">단계별 승인</div>
                  {approvals.map((a) => <ApprovalRow key={a.id} a={a} />)}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* 매출/매입 관리 — 파이프라인 탭(방향별) 하단 */}
      {pipelineDir && companyId && (
        <div>
          <div className="text-xs font-bold text-[var(--text-muted)] mb-2 mt-1">{pipelineDir === "sales" ? "매출 항목 관리" : "매입 항목 관리"}</div>
          {/* 최상위 프로젝트에서만 '캠페인으로도 생성' 허용 (세부 프로젝트 2단계 제한) */}
          <SubDealsTab dealId={dealId} companyId={companyId} direction={pipelineDir}
            campaignInherit={deal.parent_deal_id ? null : { partnerId: deal?.partner_id || null, managerId: deal?.internal_manager_id || null, classification: deal?.classification || null }} />
        </div>
      )}

      {/* 세부 프로젝트 (캠페인 속 캠페인) */}
      {tab === "subprojects" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-[var(--text-muted)]">이 프로젝트 안의 세부 프로젝트(캠페인)입니다. <span className="text-[var(--text-dim)]">행을 클릭하면 해당 캠페인의 개요·견적서·전자계약으로 이동합니다.</span></p>
            {deal.parent_deal_id ? (
              <span className="text-[11px] text-[var(--text-dim)]">세부 프로젝트는 2단계까지만 — 캠페인 안에는 추가할 수 없습니다.</span>
            ) : (
              <button onClick={() => { resetChildForm(); setChildName(`${deal.name || "프로젝트"} 캠페인`); setShowChildForm(true); }}
                className="btn-primary text-xs hover:opacity-90">+ 세부 프로젝트 추가</button>
            )}
          </div>

          {showChildForm && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowChildForm(false)}>
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold">세부 프로젝트(캠페인) 추가</h3>
                  <button onClick={() => setShowChildForm(false)} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none" aria-label="닫기">✕</button>
                </div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">캠페인명 *</label>
                <input autoFocus value={childName} onChange={(e) => setChildName(e.target.value)}
                  placeholder="예: 봄 시즌 캠페인"
                  className="w-full h-11 px-3.5 mb-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                <div className="text-xs font-medium text-[var(--text-muted)] mb-1.5">매출/매입 <span className="font-normal text-[var(--text-dim)]">(개요 · 선택)</span></div>
                <div className="space-y-2 mb-1">
                  <div className="flex items-center gap-2">
                    <span className="w-9 text-[11px] text-[var(--text-muted)] shrink-0">매출</span>
                    <input value={childSalesPlan} onChange={(e) => setChildSalesPlan(numComma(e.target.value))} inputMode="numeric" placeholder="받을 돈 0"
                      className="flex-1 h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm text-right mono-number focus:outline-none focus:border-[var(--primary)]" />
                    <select value={childSalesVat} onChange={(e) => setChildSalesVat(e.target.value as "exclude" | "include")} className="px-2 h-10 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[11px] text-[var(--text-muted)] focus:outline-none focus:border-[var(--primary)]">
                      <option value="exclude">VAT별도</option><option value="include">VAT포함</option>
                    </select>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-9 text-[11px] text-[var(--text-muted)] shrink-0">매입</span>
                    <input value={childPurchasePlan} onChange={(e) => setChildPurchasePlan(numComma(e.target.value))} onKeyDown={(e) => { if (e.key === "Enter") createChild(); }} inputMode="numeric" placeholder="줄 돈 0"
                      className="flex-1 h-10 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-sm text-right mono-number focus:outline-none focus:border-[var(--primary)]" />
                    <select value={childPurchaseVat} onChange={(e) => setChildPurchaseVat(e.target.value as "exclude" | "include")} className="px-2 h-10 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-[11px] text-[var(--text-muted)] focus:outline-none focus:border-[var(--primary)]">
                      <option value="exclude">VAT별도</option><option value="include">VAT포함</option>
                    </select>
                  </div>
                </div>
                <p className="text-[11px] text-[var(--text-dim)] mt-2">입력한 매출/매입은 <b className="text-[var(--text-muted)]">개요</b>에 저장돼 상위 프로젝트 개요 마진에 반영됩니다. <b className="text-[var(--text-muted)]">총 비용·마진(실적)</b>에는 실제 전표만 반영됩니다. 비우면 생성 후 ‘매출/매입 관리’에서 입력 가능. 거래처·담당자는 상위 프로젝트({partner?.name || "미지정"})에서 상속됩니다.</p>
                <div className="flex items-center justify-end gap-2.5 mt-5">
                  <button onClick={() => setShowChildForm(false)} className="px-5 h-10 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)] transition">취소</button>
                  <button onClick={createChild} disabled={creatingChild || !childName.trim()} className="px-6 h-10 bg-[var(--primary)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110 transition">{creatingChild ? "생성 중..." : "생성"}</button>
                </div>
              </div>
            </div>
          )}

          {(children as any[]).length === 0 ? (
            <Empty text={deal.parent_deal_id ? "이 캠페인에는 세부 프로젝트가 없습니다." : "세부 프로젝트(캠페인)가 없습니다. 위 “+ 세부 프로젝트 추가”로 캠페인을 만들어 보세요."} />
          ) : (
            <div className="glass-card overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="text-xs text-[var(--text-dim)]">
                    <th className="px-3 py-2.5 text-[12px] font-bold text-left border-b border-[var(--border)]">캠페인명</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-center border-b border-[var(--border)] w-[80px]">단계</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-right border-b border-[var(--border)] w-[120px]">매출</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-right border-b border-[var(--border)] w-[120px]">마진</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-left border-b border-[var(--border)] w-[170px]">기간</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-center border-b border-[var(--border)] w-[110px]">관리</th>
                  </tr>
                </thead>
                <tbody>
                  {(children as any[]).map((c) => {
                    const cst = (STAGE_ORDER.includes(c.stage) ? c.stage : "estimate") as ProjectStage;
                    const csc = STAGE_COLOR[cst];
                    const cs = subByDeal[c.id] || { sales: 0, purchase: 0 };
                    const cMargin = cs.sales - cs.purchase;
                    return (
                      <tr key={c.id} onClick={() => router.push(`/projecthub/${c.id}`)}
                        className="hover:bg-[var(--bg-surface)]/50 cursor-pointer">
                        <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-[var(--text)] font-medium">{c.name || "(이름 없음)"}</td>
                        <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center"><span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${csc.bg} ${csc.text}`}>{STAGE_LABEL[cst]}</span></td>
                        <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-right mono-number text-[var(--text)]">{won(cs.sales)}</td>
                        <td className={`px-3 py-2.5 border-b border-[var(--border)]/40 text-right mono-number ${cMargin < 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{won(cMargin)}</td>
                        <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-[11px] text-[var(--text-muted)] mono-number">{fmtDate(c.start_date)}{c.end_date ? ` ~ ${fmtDate(c.end_date)}` : ""}</td>
                        <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center" onClick={(e) => e.stopPropagation()}>
                          <div className="flex items-center justify-center gap-1">
                            <button onClick={(e) => { e.stopPropagation(); openEditChild(c); }} className="px-2 py-1 text-[11px] rounded-md text-[var(--text-muted)] hover:bg-[var(--bg-surface)] hover:text-[var(--text)] transition">수정</button>
                            <button onClick={(e) => { e.stopPropagation(); setDeleteTarget(c); }} className="px-2 py-1 text-[11px] rounded-md text-[var(--danger)] hover:bg-[var(--danger)]/10 transition">삭제</button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className="bg-[var(--bg-surface)]/60">
                    <td className="px-3 py-2.5 text-xs font-bold text-[var(--text-muted)]">합계 (세부 {(children as any[]).length}개)</td>
                    <td className="px-3 py-2.5"></td>
                    <td className="px-3 py-2.5 text-right mono-number font-bold text-[var(--text)]">{won((children as any[]).reduce((a, c) => a + (subByDeal[c.id]?.sales || 0), 0))}</td>
                    <td className={`px-3 py-2.5 text-right mono-number font-bold ${(children as any[]).reduce((a, c) => a + ((subByDeal[c.id]?.sales || 0) - (subByDeal[c.id]?.purchase || 0)), 0) < 0 ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{won((children as any[]).reduce((a, c) => a + ((subByDeal[c.id]?.sales || 0) - (subByDeal[c.id]?.purchase || 0)), 0))}</td>
                    <td className="px-3 py-2.5" colSpan={2}></td>
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
          {!deal.parent_deal_id && (
            <p className="text-[11px] text-[var(--text-dim)]">※ 상위 프로젝트의 개요·운영 탭 금액·손익은 자기 자신 + 모든 세부 프로젝트를 <b className="text-[var(--text-muted)]">합산(롤업)</b>해 표시됩니다.</p>
          )}

          {/* 캠페인 수정 모달 */}
          {editChild && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setEditChild(null)}>
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold">캠페인 수정</h3>
                  <button onClick={() => setEditChild(null)} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none" aria-label="닫기">✕</button>
                </div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">캠페인명 *</label>
                <input autoFocus value={editChildName} onChange={(e) => setEditChildName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") saveChild(); }}
                  className="w-full h-11 px-3.5 mb-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">진행 단계</label>
                <select value={editChildStage} onChange={(e) => setEditChildStage(e.target.value)}
                  className="w-full h-11 px-3 mb-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                  {STAGE_ORDER.map((st) => (<option key={st} value={st}>{STAGE_LABEL[st]}</option>))}
                </select>
                <div className="grid grid-cols-2 gap-2 mb-3">
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">시작일</label>
                    <DateField value={editChildStart} onChange={(e) => setEditChildStart(e.target.value)}
                      className="w-full h-11 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">종료일</label>
                    <DateField value={editChildEnd} onChange={(e) => setEditChildEnd(e.target.value)}
                      className="w-full h-11 px-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
                  </div>
                </div>
                <p className="text-[11px] text-[var(--text-dim)]">매출/매입 금액은 캠페인의 <b className="text-[var(--text-muted)]">‘매출/매입 관리’</b> 탭에서 수정하세요.</p>
                <div className="flex items-center justify-end gap-2.5 mt-5">
                  <button onClick={() => setEditChild(null)} className="px-5 h-10 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)] transition">취소</button>
                  <button onClick={saveChild} disabled={savingChild || !editChildName.trim()} className="px-6 h-10 bg-[var(--primary)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110 transition">{savingChild ? "저장 중..." : "저장"}</button>
                </div>
              </div>
            </div>
          )}

          {/* 캠페인 삭제 확인 모달 */}
          {deleteTarget && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setDeleteTarget(null)}>
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-sm p-6" onClick={(e) => e.stopPropagation()}>
                <h3 className="text-base font-bold mb-2">캠페인 삭제</h3>
                <p className="text-sm text-[var(--text-muted)] leading-relaxed mb-1"><b className="text-[var(--text)]">{deleteTarget.name || "(이름 없음)"}</b> 캠페인을 목록에서 삭제할까요?</p>
                <p className="text-[11px] text-[var(--text-dim)] mb-5">매출·매입·견적·계약 등 회계 데이터는 보존되며, 목록에서만 숨겨집니다.</p>
                <div className="flex items-center justify-end gap-2.5">
                  <button onClick={() => setDeleteTarget(null)} className="px-5 h-10 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)] transition">취소</button>
                  <button onClick={removeChild} disabled={deletingChild} className="px-6 h-10 bg-[var(--danger)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110 transition">{deletingChild ? "삭제 중..." : "삭제"}</button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 프로젝트 운영 — 활동 + 일정 (구 '워크플로우' 통합) */}
      {tab === "pnl" && companyId && (
        <ProjectSlideOver variant="embed" dealId={dealId} companyId={companyId} onClose={() => {}} />
      )}

      {/* 목표형 — 성과(KPI 관리 · 실적 · 체크인) */}
      {tab === "performance" && companyId && (
        <PerformanceTab dealId={dealId} companyId={companyId} deal={deal} />
      )}

      {/* 실행형 — 태스크(칸반/간트) */}
      {tab === "tasks" && companyId && (
        <TasksTab dealId={dealId} companyId={companyId} users={companyUsers as any[]} />
      )}

      {/* 실행형 — 워크플로우 (전사 칸반 보드 임베드, 사이드바 '워크플로우' 메뉴 이동) */}
      {tab === "workflow" && companyId && (
        <MondayBoard companyId={companyId} users={companyUsers as any} />
      )}

      {/* 문서 작성 모달 — 견적서 탭(견적서) / 전자계약 탭(계약서) 공용. formKind 로 양식·기본구조 분기 */}
      {showQuoteForm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowQuoteForm(false)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-bold">{formKind === "quote" ? "견적서 작성" : "계약서(전자계약) 작성"}</h3>
              <button onClick={() => setShowQuoteForm(false)} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none" aria-label="닫기">✕</button>
            </div>
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">양식 선택</label>
            <select
              value={selectedTemplateId}
              onChange={(e) => {
                setSelectedTemplateId(e.target.value);
                const t = formTemplates.find((x: any) => x.id === e.target.value);
                setQuoteName(`${deal?.name || "프로젝트"} ${t ? t.name : formKind === "quote" ? "견적서" : "계약서"}`);
              }}
              className="w-full h-11 px-3.5 mb-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
            >
              <option value="">{formKind === "quote" ? "견적서 (기본 양식)" : "계약서 (기본 양식)"}</option>
              {formTemplates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
            {formKind === "quote" && (
              <>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">매출·매입 항목 연결 <span className="font-normal text-[var(--text-dim)]">(선택 — 견적을 특정 항목에 부착)</span></label>
                <select
                  value={quoteSubDealId}
                  onChange={(e) => setQuoteSubDealId(e.target.value)}
                  className="w-full h-11 px-3.5 mb-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                >
                  <option value="">프로젝트 전체 (항목 미지정)</option>
                  {subDealOpts.map((s) => <option key={s.id} value={s.id}>{s.type === "sales" ? "[매출]" : s.type === "purchase" ? "[매입]" : ""} {s.name}</option>)}
                </select>
              </>
            )}
            <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">문서명</label>
            <input
              autoFocus
              value={quoteName}
              onChange={(e) => setQuoteName(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") createDoc(); }}
              placeholder={formKind === "quote" ? "견적서명" : "계약서명"}
              className="w-full h-11 px-3.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15 transition"
            />
            <p className="text-[11px] text-[var(--text-dim)] mt-2">{formKind === "quote" ? "견적서(품목·단가·부가세 표)로 생성되며, 생성 즉시 견적서 입력 화면으로 이동합니다." : "계약서(본문 텍스트)로 생성됩니다. 발송·서명은 ‘단체 일괄 발송 / 전자계약 메뉴’에서 진행하세요. 생성 후 목록의 ‘열기/편집’으로 작성하세요."}</p>
            <div className="flex items-center justify-end gap-2.5 mt-5">
              <button onClick={() => setShowQuoteForm(false)} className="px-5 h-10 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)] transition">취소</button>
              <button onClick={createDoc} disabled={creatingQuote} className="px-6 h-10 bg-[var(--primary)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110 transition">{creatingQuote ? "생성 중..." : (formKind === "quote" ? "작성하기" : "생성")}</button>
            </div>
          </div>
        </div>
      )}

      {/* 견적서 PDF 미리보기 팝업 (실제 인쇄될 PDF) — body 포털, 화면 중앙. 인쇄/저장 직접 처리. */}
      {previewDoc && typeof document !== "undefined" && createPortal(
        <div className="fixed inset-0 z-[100] bg-black/60 flex items-center justify-center p-4" onClick={() => setPreviewDoc(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-xl w-full max-w-3xl h-[88vh] flex flex-col overflow-hidden" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--border)] shrink-0">
              <h2 className="text-base font-bold text-[var(--text)]">{previewDoc.name || "견적서"} <span className="text-xs font-normal text-[var(--text-dim)]">미리보기</span></h2>
              <button onClick={() => setPreviewDoc(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-xl">×</button>
            </div>
            <div className="flex-1 bg-[var(--bg-surface)] overflow-hidden">
              {previewLoading ? (
                <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">견적서 생성 중…</div>
              ) : previewUrl ? (
                <iframe id="quote-preview-iframe" src={previewUrl} title="견적서 미리보기" className="w-full h-full border-0" />
              ) : (
                <div className="h-full flex items-center justify-center text-sm text-[var(--text-muted)]">미리보기를 불러오지 못했습니다.</div>
              )}
            </div>
            <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border)] shrink-0">
              <button onClick={() => setPreviewDoc(null)} className="px-4 py-2 text-sm text-[var(--text-muted)] rounded-lg hover:bg-[var(--bg-surface)]">닫기</button>
              <button
                disabled={!previewBlob}
                onClick={() => {
                  if (!previewBlob) return;
                  const a = document.createElement("a");
                  const u = URL.createObjectURL(previewBlob);
                  a.href = u; a.download = `${(previewDoc.name || "견적서").replace(/[\\/:*?"<>|]/g, "_")}.pdf`; a.click();
                  setTimeout(() => URL.revokeObjectURL(u), 1000);
                }}
                className="px-4 py-2 text-sm font-semibold rounded-lg border border-[var(--border)] text-[var(--text)] hover:bg-[var(--bg-surface)] disabled:opacity-50">PDF 저장</button>
              <button
                disabled={!previewUrl}
                onClick={() => { (document.getElementById("quote-preview-iframe") as HTMLIFrameElement | null)?.contentWindow?.print(); }}
                className="px-4 py-2 text-sm font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">인쇄</button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}

// 마진 콕핏 — 예상→확정 한 축. 매출은 단일 산식, 비용만 예상(약정)↔확정(실적)으로 진행.
function MarginCockpit({ revenue, revenueBasis, planCost, actualCost, hasActual, rolled, stage }: {
  revenue: number; revenueBasis: string; planCost: number; actualCost: number; hasActual: boolean; rolled: number; stage: ProjectStage;
}) {
  const planMargin = revenue - planCost;
  const actualMargin = revenue - actualCost;
  const headMargin = hasActual ? actualMargin : planMargin;
  const headRate = revenue > 0 ? headMargin / revenue : null;
  const danger = headRate != null && headRate < 0;
  const over = hasActual && planCost > 0 && actualCost > planCost;
  const barPct = planMargin > 0 ? Math.max(0, Math.min(100, Math.round((actualMargin / planMargin) * 100))) : actualMargin > 0 ? 100 : 0;
  const sc = STAGE_COLOR[stage];
  return (
    <div className="margin-cockpit glass-card p-5">
      <div className="flex items-center justify-between gap-2 mb-3">
        <h3 className="text-sm font-bold text-[var(--text)]">마진 <span className="text-[var(--text-dim)] font-normal">(수익성)</span>{rolled > 0 && <span className="ml-1.5 text-[11px] text-[var(--text-dim)] font-normal">· 세부 {rolled}개 합산</span>}</h3>
        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.text}`}>{STAGE_LABEL[stage]}</span>
      </div>
      <div className="flex items-end gap-5 flex-wrap">
        <div>
          <div className="text-[11px] text-[var(--text-dim)] mb-0.5">{hasActual ? "확정" : "예상"} 마진률</div>
          <div className={`text-[40px] leading-none font-black mono-number ${danger ? "text-[var(--danger)]" : "text-[var(--primary)]"}`}>{headRate == null ? "—" : `${Math.round(headRate * 100)}%`}</div>
        </div>
        <div className="pb-1">
          <div className="text-[11px] text-[var(--text-dim)] mb-0.5">마진금액</div>
          <div className={`text-xl font-black mono-number ${danger ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{won(headMargin)}</div>
        </div>
      </div>
      {hasActual ? (
        <div className="mt-4">
          <div className="flex items-center justify-between text-[11px] mb-1">
            <span className="text-[var(--text-muted)]">예상 마진 <b className="mono-number text-[var(--text)]">{won(planMargin)}</b></span>
            <span className={over ? "text-[var(--warning)]" : "text-[var(--success)]"}>확정 마진 <b className="mono-number">{won(actualMargin)}</b></span>
          </div>
          <div className="h-2 rounded-full bg-[var(--bg-surface)] overflow-hidden">
            <div className={`h-full rounded-full transition-all ${danger ? "bg-[var(--danger)]" : over ? "bg-[var(--warning)]" : "bg-[var(--success)]"}`} style={{ width: `${barPct}%` }} />
          </div>
          {over && <div className="text-[11px] text-[var(--warning)] mt-1.5">⚠ 확정 비용이 예상보다 {won(actualCost - planCost)} 더 나갔습니다.</div>}
        </div>
      ) : (
        <div className="mt-3 text-[11px] text-[var(--text-dim)]">예상(계획) 기준입니다. 비용을 프로젝트에 태그하면 <b className="text-[var(--text-muted)]">확정 마진</b>이 채워집니다.</div>
      )}
      <div className="mt-4 pt-3 border-t border-[var(--border)]/40 flex flex-wrap gap-x-6 gap-y-1.5 text-[12px]">
        <span className="text-[var(--text-muted)]">매출 <b className="mono-number text-[var(--text)]">{won(revenue)}</b> <span className="text-[10px] text-[var(--text-dim)]">({revenueBasis})</span></span>
        <span className="text-[var(--text-muted)]">예상 비용 <b className="mono-number text-[var(--text)]">{won(planCost)}</b></span>
        <span className="text-[var(--text-muted)]">확정 비용 <b className="mono-number text-[var(--text)]">{won(actualCost)}</b></span>
      </div>
    </div>
  );
}

// 파이프라인 리본 — 견적▶계약▶계산서▶정산 단계별 금액·상태 한 줄. 개요의 흐름 시각화(읽기).
function PipelineRibbon({ pipe, contractTotal, onOpen }: { pipe: any; contractTotal: number; onOpen: (t: TabKey) => void }) {
  const quotes = (pipe?.quotes || []) as any[];
  const contracts = (pipe?.contracts || []) as any[];
  const sigs = (pipe?.sigs || []) as any[];
  const invoices = (pipe?.invoices || []) as any[];
  const quoteAmt = quotes.length ? quoteAmount(quotes[0]) : 0;
  const contractAmt = contracts.length ? (quoteAmount(contracts[0]) || contractTotal) : contractTotal;
  const signed = sigs.some((s) => s.signed_at);
  const invAmt = invoices.reduce((a, i) => a + Number(i.supply_amount || i.total_amount || 0), 0);
  // 정산(수금) — 미수 상태(issued/sent/pending/overdue) 외 = 수금 완료. (queries.ts 미수금 조건과 동일)
  const UNPAID = ["issued", "sent", "pending", "overdue"];
  const unpaidCount = invoices.filter((i) => UNPAID.includes(i.status)).length;
  const paidAmt = invoices.filter((i) => !UNPAID.includes(i.status)).reduce((a, i) => a + Number(i.total_amount || i.supply_amount || 0), 0);
  const stages = [
    { key: "quote", label: "견적", amt: quoteAmt, done: quotes.length > 0, sub: quotes.length ? `${quotes.length}건 작성` : "미작성" },
    { key: "contract", label: "계약", amt: contractAmt, done: contracts.length > 0, sub: contracts.length ? (signed ? "서명완료" : "미서명") : "미작성" },
    { key: "invoice", label: "계산서", amt: invAmt, done: invoices.length > 0, sub: invoices.length ? `발행 ${invoices.length}건` : "미발행" },
    { key: "settle", label: "정산", amt: paidAmt, done: invoices.length > 0 && unpaidCount === 0, sub: invoices.length === 0 ? "미수금" : unpaidCount > 0 ? `미수 ${unpaidCount}건` : "수금완료" },
  ];
  return (
    <div className="pipeline-ribbon glass-card p-4">
      <div className="flex items-center justify-between mb-3 gap-2 flex-wrap">
        <h3 className="text-sm font-bold text-[var(--text)]">진행 파이프라인 <span className="text-[var(--text-dim)] font-normal text-xs">견적 → 계약 → 계산서 → 정산</span></h3>
        <button onClick={() => onOpen("sales_pipeline")} className="text-[11px] font-semibold text-[var(--primary)] hover:underline">수주(매출) 열기 →</button>
      </div>
      <div className="flex items-stretch gap-1 overflow-x-auto pb-1">
        {stages.map((st, i) => (
          <div key={st.key} className="flex items-stretch shrink-0">
            <button onClick={() => onOpen("sales_pipeline")}
              className={`min-w-[124px] text-left px-3 py-2.5 rounded-xl border transition ${st.done ? "border-[var(--primary)]/40 bg-[var(--primary)]/5 hover:bg-[var(--primary)]/10" : "border-[var(--border)] bg-[var(--bg-surface)]/40 hover:bg-[var(--bg-surface)]"}`}>
              <div className="flex items-center gap-1.5">
                <span className={`w-4 h-4 rounded-full flex items-center justify-center text-[9px] font-bold ${st.done ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-surface)] text-[var(--text-dim)] border border-[var(--border)]"}`}>{st.done ? "✓" : i + 1}</span>
                <span className="text-[12px] font-bold text-[var(--text)]">{st.label}</span>
              </div>
              <div className={`text-sm font-black mono-number mt-1 ${st.done ? "text-[var(--text)]" : "text-[var(--text-dim)]"}`}>{st.amt > 0 ? won(st.amt) : "—"}</div>
              <div className={`text-[10px] mt-0.5 ${st.done ? "text-[var(--primary)]" : "text-[var(--text-dim)]"}`}>{st.sub}</div>
            </button>
            {i < stages.length - 1 && <span className="self-center mx-0.5 text-[var(--text-dim)]">▶</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// 영업 단계 — deals.stage(대시보드·위험 판정 기준). pill + ▶ 언어.
function StageStepper({ stage, onPick, pending }: { stage: ProjectStage; onPick: (s: ProjectStage) => void; pending: boolean }) {
  const idx = STAGE_ORDER.indexOf(stage);
  return (
    <div className="stage-stepper glass-card p-4">
      <div className="flex items-center justify-between mb-3">
        <h3 className="text-sm font-bold text-[var(--text)]">영업 단계 <span className="text-[var(--text-dim)] font-normal text-xs">대시보드·위험 판정 기준</span></h3>
        <span className="text-[11px] text-[var(--text-dim)]">단계를 클릭해 변경</span>
      </div>
      <div className="flex items-center gap-0.5 overflow-x-auto pb-1">
        {STAGE_ORDER.map((st, i) => (
          <div key={st} className="flex items-center">
            <button disabled={pending} onClick={() => onPick(st)}
              className={`text-[11px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap transition disabled:opacity-60 ${st === stage ? "bg-[var(--primary)] text-white ring-2 ring-[var(--primary)]/30" : i < idx ? "bg-[var(--primary)]/15 text-[var(--primary)] hover:bg-[var(--primary)]/25" : "bg-[var(--bg-surface)] text-[var(--text-dim)] hover:text-[var(--text)]"}`}>
              {STAGE_LABEL[st]}
            </button>
            {i < STAGE_ORDER.length - 1 && <span className={`mx-0.5 text-xs ${i < idx ? "text-[var(--primary)]" : "text-[var(--text-dim)]"}`}>▶</span>}
          </div>
        ))}
      </div>
    </div>
  );
}

// 첫 진입 온보딩 — 빈 수익형 프로젝트에 흐름(입력→견적/계약→비용태그→마진) 안내.
function MarginOnboarding({ onTab }: { onTab: (t: TabKey) => void }) {
  const steps: { n: number; t: string; d: string; cta?: { label: string; on: () => void } }[] = [
    { n: 1, t: "매출·매입 입력", d: "받을 돈·줄 돈을 등록하면 예상 마진이 자동 계산됩니다.", cta: { label: "수주(매출) 열기 →", on: () => onTab("sales_pipeline") } },
    { n: 2, t: "견적·계약·발주", d: "수주는 고객 견적→계약, 발주는 협력사 매입을 각 파이프라인에서 관리합니다.", cta: { label: "발주(매입) 열기 →", on: () => onTab("purchase_pipeline") } },
    { n: 3, t: "비용 태그", d: "세금계산서·카드·전표를 이 프로젝트로 지정하면 확정 비용이 집계됩니다." },
    { n: 4, t: "마진 확인", d: "예상 → 확정 마진이 이 개요 화면에서 한 축으로 채워집니다." },
  ];
  return (
    <div className="margin-onboarding glass-card p-6">
      <h3 className="text-base font-bold text-[var(--text)]">수익형 프로젝트 시작하기</h3>
      <p className="text-xs text-[var(--text-muted)] mt-1 mb-5">계약·매출·매입으로 <b className="text-[var(--text)]">마진(수익성)</b>을 관리합니다. 아래 순서로 채워 보세요.</p>
      <div className="grid gap-3 sm:grid-cols-2">
        {steps.map((s) => (
          <div key={s.n} className="flex gap-3 p-4 rounded-xl bg-[var(--bg-surface)]/60 border border-[var(--border)]/50">
            <span className="w-7 h-7 rounded-full bg-[var(--primary)] text-white text-sm font-bold flex items-center justify-center shrink-0">{s.n}</span>
            <div className="min-w-0">
              <div className="text-sm font-bold text-[var(--text)]">{s.t}</div>
              <div className="text-[12px] text-[var(--text-muted)] mt-0.5 leading-relaxed">{s.d}</div>
              {s.cta && <button onClick={s.cta.on} className="mt-2 text-[12px] font-semibold text-[var(--primary)] hover:underline">{s.cta.label}</button>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
function Metric({ label, value, hint, accent }: { label: string; value: string; hint?: string; accent?: "primary" | "danger" }) {
  const color = value === "—" ? "text-[var(--text-dim)]"
    : accent === "danger" ? "text-[var(--danger)]"
    : accent === "primary" ? "text-[var(--primary)]"
    : "text-[var(--text)]";
  return (
    <div className="glass-card p-5">
      <div className="text-[11px] font-semibold text-[var(--text-dim)] uppercase tracking-wider">{label}</div>
      <div className={`text-xl font-black mono-number mt-1 ${color}`} title={hint}>{value}</div>
    </div>
  );
}
function CostItemRow({ kind, it }: { kind: string; it: any }) {
  if (kind === "invoice") return <CostRow date={it.issue_date} name={it.counterparty_name} amt={Number(it.supply_amount || it.total_amount || 0)} />;
  if (kind === "cash") return <CostRow date={it.issue_date} name={it.counterparty_name || "현금영수증"} amt={Number(it.supply_amount || it.amount || 0)} />;
  if (kind === "card") return <CostRow date={it.transaction_date} name={it.merchant_name || it.card_name || "카드사용"} amt={Number(it.amount || 0)} />;
  const exp = (it.journal_lines || []).filter((l: any) => l.chart_of_accounts?.account_type === "expense").reduce((s: number, l: any) => s + Number(l.debit || 0), 0);
  return <CostRow date={it.entry_date} name={it.description || "전표"} amt={exp} />;
}
function CostRow({ date, name, amt }: { date: string | null; name: string | null; amt: number }) {
  return (
    <div className="flex items-center gap-2 text-xs py-0.5">
      <span className="text-[var(--text-dim)] mono-number w-[78px] shrink-0">{date ? String(date).slice(0, 10) : "—"}</span>
      <span className="text-[var(--text)] flex-1 truncate">{name || "—"}</span>
      <span className="mono-number text-[var(--text-muted)] shrink-0">{Math.round(Number(amt || 0)).toLocaleString("ko-KR")}원</span>
    </div>
  );
}
function Info({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="text-xs text-[var(--text-muted)] w-20 shrink-0">{label}</span>
      <span className="text-sm text-[var(--text)] min-w-0 break-words">{value}</span>
    </div>
  );
}
function Empty({ text }: { text: string }) {
  return (
    <div className="glass-card py-14 px-6 flex flex-col items-center justify-center text-center gap-2">
      <div className="text-4xl">📂</div>
      <div className="text-sm font-semibold text-[var(--text)]">{text}</div>
      <div className="text-xs text-[var(--text-dim)]">추가하면 이 목록에 바로 나타납니다.</div>
    </div>
  );
}

// 실행형 개요 — 태스크 중심 콕핏: 진행률·상태 분포·다가오는 마감·담당자별 현황 + 실행 정보.
//   영업 개념(단계·견적·계약)은 실행형과 무관 → 미노출. 거래처·예산은 값이 있을 때만 표시.
//   실행 상태(진행 전/진행 중/완료)는 deals.stage 가 아니라 태스크에서 파생.
const DELIVERY_STATUS_META: { key: string; label: string; color: string }[] = [
  { key: "todo", label: "할 일", color: "text-[var(--text-muted)]" },
  { key: "doing", label: "진행", color: "text-amber-500" },
  { key: "review", label: "검토", color: "text-blue-400" },
  { key: "done", label: "완료", color: "text-green-500" },
];
function DeliveryOverview({ deal, dealId, partner, manager, companyUsers }: { deal: any; dealId: string; partner: any; manager: any; companyUsers: any[] }) {
  const today = new Date().toISOString().slice(0, 10);
  const { data: tasks = [] } = useQuery({
    queryKey: ["project-tasks-overview", dealId],
    queryFn: async () => {
      const { data } = await db.from("project_tasks").select("id, title, status, due_date, assignee_id, assignee_ids").eq("deal_id", dealId).is("archived_at", null);
      return (data || []) as any[];
    },
    enabled: !!dealId,
  });
  const total = (tasks as any[]).length;
  const done = (tasks as any[]).filter((t) => t.status === "done").length;
  const delayed = (tasks as any[]).filter((t) => t.due_date && t.status !== "done" && String(t.due_date).slice(0, 10) < today).length;
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  // 상태 분포 — 태스크 탭 칸반 4컬럼과 동일 집합. 알 수 없는 status 는 '할 일'로.
  const byStatus: Record<string, number> = { todo: 0, doing: 0, review: 0, done: 0 };
  (tasks as any[]).forEach((t) => { byStatus[t.status === "doing" || t.status === "review" || t.status === "done" ? t.status : "todo"] += 1; });
  // 실행 상태 (영업단계 대체) — 태스크에서 파생
  const runState = total === 0 ? "태스크 없음" : done === total ? "완료" : byStatus.doing + byStatus.review + done > 0 ? "진행 중" : "진행 전";
  // D-day 표기 (지연이면 D+n)
  const dday = (d: string) => {
    const diff = Math.round((new Date(String(d).slice(0, 10)).getTime() - new Date(today).getTime()) / 86400000);
    return diff < 0 ? `D+${-diff}` : diff === 0 ? "D-Day" : `D-${diff}`;
  };
  // 다가오는 마감 — 미완료 & 마감일 있는 태스크, 지연 포함 마감일 오름차순 상위 5
  const upcoming = (tasks as any[])
    .filter((t) => t.status !== "done" && t.due_date)
    .sort((a, b) => String(a.due_date).localeCompare(String(b.due_date)))
    .slice(0, 5);
  // 담당자별 현황 — 다중 담당(assignee_ids) 우선, 없으면 단일 assignee_id 폴백 (태스크 탭과 동일 규칙)
  const assigneesOf = (t: any): string[] => (Array.isArray(t.assignee_ids) && t.assignee_ids.length > 0 ? t.assignee_ids : t.assignee_id ? [t.assignee_id] : []);
  const userName = (id: string) => (companyUsers as any[]).find((u) => u.id === id)?.name || "(미상)";
  const byAssignee: Record<string, { done: number; total: number }> = {};
  (tasks as any[]).forEach((t) => assigneesOf(t).forEach((id) => {
    if (!byAssignee[id]) byAssignee[id] = { done: 0, total: 0 };
    byAssignee[id].total += 1;
    if (t.status === "done") byAssignee[id].done += 1;
  }));
  const assigneeRows = Object.entries(byAssignee).sort((a, b) => b[1].total - a[1].total);
  const budget = Number(deal.contract_total || 0);
  const endOver = deal.end_date && String(deal.end_date).slice(0, 10) < today && runState !== "완료";
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <Metric label="진행률" value={total > 0 ? `${pct}%` : "—"} accent={pct >= 100 && total > 0 ? "primary" : undefined} />
        <Metric label="완료 / 전체" value={`${done} / ${total}`} />
        <Metric label="지연" value={String(delayed)} accent={delayed > 0 ? "danger" : undefined} />
        <Metric label="마감" value={deal.end_date ? dday(deal.end_date) : "—"} hint={deal.end_date ? `종료일 ${fmtDate(deal.end_date)}` : "종료일을 설정하면 D-day가 표시됩니다"} accent={endOver ? "danger" : undefined} />
      </div>
      <div className="grid gap-5 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-5">
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold">태스크 진행률</h3>
              <span className="text-xs mono-number text-[var(--text)]">{done} / {total}</span>
            </div>
            <div className="h-3 rounded-full bg-[var(--bg-surface)] overflow-hidden">
              <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
            </div>
            <div className="grid grid-cols-4 gap-2 mt-4">
              {DELIVERY_STATUS_META.map((s) => (
                <div key={s.key} className="rounded-xl bg-[var(--bg-surface)] px-3 py-2 text-center">
                  <div className={`text-[11px] font-semibold ${s.color}`}>{s.label}</div>
                  <div className="text-base font-black mono-number text-[var(--text)]">{byStatus[s.key]}</div>
                </div>
              ))}
            </div>
          </div>
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-bold">다가오는 마감</h3>
              <Link href={`/projecthub/${dealId}?tab=tasks`} className="text-[11px] text-[var(--primary)] hover:underline">태스크 탭 →</Link>
            </div>
            {upcoming.length === 0 ? (
              <p className="text-xs text-[var(--text-dim)]">마감일이 지정된 미완료 태스크가 없습니다.</p>
            ) : (
              <div className="divide-y divide-[var(--border)]/40">
                {upcoming.map((t) => {
                  const late = String(t.due_date).slice(0, 10) < today;
                  return (
                    <div key={t.id} className="py-2 flex items-center gap-2 text-sm">
                      <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-bold mono-number shrink-0 ${late ? "bg-[var(--danger)]/10 text-[var(--danger)]" : "bg-[var(--bg-surface)] text-[var(--text-muted)]"}`}>{dday(t.due_date)}</span>
                      <span className="flex-1 truncate text-[var(--text)]">{t.title || "(제목 없음)"}</span>
                      <span className="text-[11px] text-[var(--text-dim)] shrink-0">{assigneesOf(t).map(userName).join(", ") || "미지정"}</span>
                      <span className="text-[11px] text-[var(--text-muted)] mono-number shrink-0">{fmtDate(t.due_date)}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
          {assigneeRows.length > 0 && (
            <div className="glass-card p-5">
              <h3 className="text-sm font-bold mb-3">담당자별 현황</h3>
              <div className="space-y-2.5">
                {assigneeRows.map(([id, v]) => {
                  const p = v.total > 0 ? Math.round((v.done / v.total) * 100) : 0;
                  return (
                    <div key={id} className="flex items-center gap-3">
                      <span className="text-xs text-[var(--text)] w-24 truncate shrink-0">{userName(id)}</span>
                      <div className="flex-1 h-2 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                        <div className="h-full rounded-full bg-[var(--primary)]" style={{ width: `${p}%` }} />
                      </div>
                      <span className="text-[11px] mono-number text-[var(--text-muted)] w-14 text-right shrink-0">{v.done} / {v.total}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
          <p className="text-[11px] text-[var(--text-dim)]">※ 태스크 추가·칸반·간트는 <b className="text-[var(--text-muted)]">태스크</b> 탭에서 관리합니다.</p>
        </div>
        <div className="space-y-5">
          <div className="glass-card p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold">실행 정보</h3>
            </div>
            <div className="grid grid-cols-1 gap-y-3 text-sm">
              <Info label="담당자" value={manager?.name || "—"} />
              <Info label="기간" value={deal.start_date || deal.end_date ? `${fmtDate(deal.start_date)} ~ ${fmtDate(deal.end_date)}` : "—"} />
              <Info label="실행 상태" value={runState} />
              {partner?.name && <Info label="거래처" value={partner.name} />}
              {budget > 0 && <Info label="예산" value={won(budget)} />}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
function ApprovalRow({ a }: { a: any }) {
  return (
    <div className="flex items-center gap-2 py-1.5 text-xs border-b border-[var(--border)]/30 last:border-0">
      <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] shrink-0">{a.stage || "—"}</span>
      <span className="text-[var(--text)] flex-1 truncate">{a.recipient || a.recipient_name || "—"}</span>
      <span className="text-[var(--text-muted)] shrink-0">{a.status || "—"}</span>
      {(a.fully_signed_contract_url || a.signed_contract_url) && (
        <a href={a.fully_signed_contract_url || a.signed_contract_url} target="_blank" rel="noreferrer" className="text-[var(--primary)] hover:underline shrink-0">계약서</a>
      )}
    </div>
  );
}
