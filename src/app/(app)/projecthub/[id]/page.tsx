"use client";

// 프로젝트 상세 (라이프사이클 탭) — 기존 deal 데이터 재사용. 2026-06-17 핸드오프 v2.
//   탭: 개요 / 견적서 / 계약 / 진행현황 / 손익. 모두 기존 테이블 읽기(연결·표시), 원본 무수정.
//   손익(원가율) 은 journal_entries.deal_id + v_deal_pnl 추가 후 별도 단계에서 채움.

import { useMemo, useState, useEffect, useRef } from "react";
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
import { SubDealsTab } from "./_components/SubDealsTab";

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

type TabKey = "overview" | "quote" | "contract" | "subdeals" | "subprojects" | "pnl";
const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "개요" },
  { key: "quote", label: "견적서" },
  { key: "contract", label: "전자계약" },
  { key: "subdeals", label: "매출/매입 관리" },
  { key: "subprojects", label: "세부 프로젝트(캠페인)" },
  { key: "pnl", label: "프로젝트 운영" },
];

export default function ProjectHubDetailPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const role = user?.role;
  const params = useParams();
  const router = useRouter();
  const dealId = String(params?.id || "");
  const [tab, setTab] = useTabParam<TabKey>("overview", { valid: ["overview", "quote", "contract", "subdeals", "subprojects", "pnl"] });
  // 세부 프로젝트(캠페인) 추가 폼 — 금액은 생성 후 '매출/매입 관리'에서 입력
  const [showChildForm, setShowChildForm] = useState(false);
  const [childName, setChildName] = useState("");
  const [creatingChild, setCreatingChild] = useState(false);
  // 세부 프로젝트(캠페인) 생성 시 매출/매입 계획(개요) — 저장 시 sub_deals 로 seed. 계획은 개요(참고)에만, 총비용/마진(실적)엔 미반영.
  const [childSalesPlan, setChildSalesPlan] = useState("");
  const [childSalesVat, setChildSalesVat] = useState<"exclude" | "include">("exclude");
  const [childPurchasePlan, setChildPurchasePlan] = useState("");
  const [childPurchaseVat, setChildPurchaseVat] = useState<"exclude" | "include">("exclude");
  const numComma = (s: string) => { const n = Number(String(s).replace(/[^0-9]/g, "")); return n ? n.toLocaleString("ko-KR") : ""; };
  const resetChildForm = () => { setChildName(""); setChildSalesPlan(""); setChildPurchasePlan(""); setChildSalesVat("exclude"); setChildPurchaseVat("exclude"); };
  const { toast } = useToast();
  const qc = useQueryClient();
  // 견적 리스트 노출 컬럼 (커스터마이징) — 브라우저 localStorage 저장
  const [visibleCols, setVisibleCols] = useState<Record<string, boolean>>(() => {
    const init: Record<string, boolean> = {};
    QUOTE_LIST_COLS.forEach((c) => (init[c.key] = c.default));
    return init;
  });
  const [showColSettings, setShowColSettings] = useState(false);
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

  // 매출/매입 관리(sub_deals) — 자기 + 모든 캠페인 롤업. 개요=계획 마진 산출, 캠페인 목록=항목별 합.
  //   금액은 '입력 총액'으로 저장되고 vat_type 플래그를 가짐 → 마진은 공급가액(net)으로 환산(inclusive ÷1.1).
  const { data: subDeals = [] } = useQuery({
    queryKey: ["projecthub-subdeals-roll", dealId, childIds.length],
    queryFn: async () => {
      const { data } = await db.from("sub_deals")
        .select("id, parent_deal_id, type, contract_amount, vat_type")
        .in("parent_deal_id", costDealIds);
      return (data || []) as any[];
    },
    enabled: !!companyId && !!dealId && (tab === "overview" || tab === "pnl" || tab === "subprojects"),
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
      // 매출/매입 계획(개요) → 새 캠페인의 sub_deals 로 seed. (계획은 개요 마진에만, 실적 비용/마진엔 미반영)
      const newChildId = data?.id;
      if (newChildId) {
        const sp = Number(String(childSalesPlan).replace(/[^0-9]/g, "")) || 0;
        const pp = Number(String(childPurchasePlan).replace(/[^0-9]/g, "")) || 0;
        const seeds: any[] = [];
        if (sp > 0) seeds.push({ parent_deal_id: newChildId, name: "매출 계획", type: "sales", partner_id: deal?.partner_id || null, contract_amount: sp, vat_type: childSalesVat === "include" ? "inclusive" : "exclusive", status: "estimate" });
        if (pp > 0) seeds.push({ parent_deal_id: newChildId, name: "매입 계획", type: "purchase", partner_id: deal?.partner_id || null, contract_amount: pp, vat_type: childPurchaseVat === "include" ? "inclusive" : "exclusive", status: "estimate" });
        if (seeds.length) { const { error: seedErr } = await db.from("sub_deals").insert(seeds); if (seedErr) throw new Error(seedErr.message); }
      }
      qc.invalidateQueries({ queryKey: ["projecthub-children", dealId] });
      qc.invalidateQueries({ queryKey: ["projecthub-deals"] });
      setShowChildForm(false); resetChildForm();
      toast("세부 프로젝트를 생성했습니다", "success");
      if (newChildId) router.push(`/projecthub/${newChildId}`);
    } catch (e: any) { toast(e?.message || "생성 실패", "error"); } finally { setCreatingChild(false); }
  };

  // 견적/계약 — documents(deal_id) + quote_tracking + quote_approvals + signature_requests
  const { data: documents = [] } = useQuery({
    queryKey: ["projecthub-docs", dealId],
    queryFn: async () => {
      const { data } = await db.from("documents").select("id, name, status, content_type, contract_amount, document_number, created_at, content_json, sub_deal_id").eq("deal_id", dealId).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!dealId && (tab === "quote" || tab === "contract"),
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
    enabled: !!dealId && tab === "quote",
  });
  const { data: quoteTracking = [] } = useQuery({
    queryKey: ["projecthub-quotes", dealId, docIds.length],
    queryFn: async () => {
      if (docIds.length === 0) return [];
      const { data } = await db.from("quote_tracking").select("*").in("document_id", docIds);
      return (data || []) as any[];
    },
    enabled: tab === "quote" && docIds.length > 0,
  });
  const { data: approvals = [] } = useQuery({
    queryKey: ["projecthub-approvals", dealId],
    queryFn: async () => {
      const { data } = await db.from("quote_approvals").select("*").eq("deal_id", dealId).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: (tab === "quote" || tab === "contract") && !!dealId,
  });
  const { data: sigRequests = [] } = useQuery({
    queryKey: ["projecthub-sigs", dealId, docIds.length],
    queryFn: async () => {
      if (docIds.length === 0) return [];
      const { data } = await db.from("signature_requests").select("id, title, status, signer_name, signer_email, signed_at, our_signed_at, signed_contract_url, document_id").in("document_id", docIds).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: tab === "contract" && docIds.length > 0,
  });

  // 손익 — 프로젝트(deal_id)에 태그된 비용처리 내역: 세금계산서(매입)·현금영수증·카드사용·수동전표
  const costEnabled = (tab === "overview" || tab === "pnl") && !!dealId;
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

  if (role && role !== "owner" && role !== "admin") return <AccessDenied />;
  if (isLoading) return <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>;
  if (!deal) return <div className="p-12 text-center text-sm text-[var(--text-muted)]">프로젝트를 찾을 수 없습니다. <Link href="/projecthub" className="text-[var(--primary)] hover:underline">목록으로</Link></div>;

  const stage = (STAGE_ORDER.includes(deal.stage) ? deal.stage : "estimate") as ProjectStage;
  const sc = STAGE_COLOR[stage];
  const hasChildren = (children as any[]).length > 0;
  // 계약금액 = 자기 자신 + 세부 프로젝트 합계 (롤업). 비용도 costDealIds(자기+자식) 기준으로 이미 합산됨.
  const ownContract = Number(deal.contract_total || 0);
  const childContractSum = (children as any[]).reduce((s, c) => s + Number(c.contract_total || 0), 0);
  const contract = ownContract + childContractSum;
  // 비용 = 프로젝트에 태그된 각 비용원 합 (카테고리별 — 같은 비용을 두 곳에 태그하면 중복이니 한 곳만)
  const sumBy = (arr: any[], f: (x: any) => number) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const costInvoiceSum = sumBy(costInvoices as any[], (i) => i.supply_amount || i.total_amount);
  const costCashSum = sumBy(costCash as any[], (c) => c.supply_amount || c.amount);
  const costCardSum = sumBy(costCards as any[], (c) => c.amount);
  const costVoucherSum = sumBy(costVouchers as any[], (v) =>
    (v.journal_lines || []).filter((l: any) => l.chart_of_accounts?.account_type === "expense").reduce((s: number, l: any) => s + Number(l.debit || 0), 0));
  const totalCost = costInvoiceSum + costCashSum + costCardSum + costVoucherSum;
  // 실적(전표 태그 기준) — '프로젝트 운영' 탭
  const margin = contract - totalCost;
  const marginRate = contract > 0 ? margin / contract : null;
  const marginRatePct = marginRate == null ? "—" : `${Math.round(marginRate * 100)}%`;
  // 계획(매출/매입 관리 입력값 기준, 캠페인까지 롤업) — '개요' 탭
  const planRevenue = ownContract + subSalesSum;   // 매출 = 상위 자체 계약 + 매출형 sub_deals
  const planCost = subPurchaseSum;                 // 총비용 = 매입형 sub_deals
  const planMargin = planRevenue - planCost;
  const planMarginRate = planRevenue > 0 ? planMargin / planRevenue : null;
  const planMarginRatePct = planMarginRate == null ? "—" : `${Math.round(planMarginRate * 100)}%`;
  // MarginRollup(계획·실적 병기)용 — v_project_margin 대체. 캠페인 합산 반영.
  const marginRow = {
    sub_sales_planned: subSalesSum, sub_purchase_planned: subPurchaseSum,
    planned_margin: planMargin, actual_margin: contract - totalCost, actual_direct_cost: totalCost,
  };
  const COST_SOURCES = [
    { key: "invoice", label: "세금계산서(매입)", total: costInvoiceSum, count: costInvoices.length, items: costInvoices as any[] },
    { key: "cash", label: "현금영수증", total: costCashSum, count: costCash.length, items: costCash as any[] },
    { key: "card", label: "카드사용", total: costCardSum, count: costCards.length, items: costCards as any[] },
    { key: "voucher", label: "수동 전표", total: costVoucherSum, count: costVouchers.length, items: costVouchers as any[] },
  ];

  return (
    <div className="space-y-4">
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            {deal.parent_deal_id ? (
              <Link href={`/projecthub/${deal.parent_deal_id}`} className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]" title="상위 프로젝트로">← {parentDeal?.name || "상위 프로젝트"}</Link>
            ) : (
              <Link href="/projecthub" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">← 프로젝트</Link>
            )}
            {deal.parent_deal_id && <span className="text-[10px] px-1.5 py-0.5 rounded-full font-semibold bg-[var(--primary)]/10 text-[var(--primary)]">세부 프로젝트</span>}
            <span className={`text-[10px] px-1.5 py-0.5 rounded-full font-semibold ${sc.bg} ${sc.text}`}>{STAGE_LABEL[stage]}</span>
          </div>
          {editingName ? (
            <input
              value={nameInput} autoFocus
              onChange={(e) => setNameInput(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setEditingName(false); }}
              className="text-2xl font-extrabold bg-transparent border-b-2 border-[var(--primary)] text-[var(--text)] focus:outline-none mt-1 w-full max-w-md"
            />
          ) : (
            <h1 onClick={() => { setNameInput(deal.name || ""); setEditingName(true); }}
              className="text-2xl font-extrabold text-[var(--text)] mt-1 truncate cursor-text hover:opacity-80 inline-flex items-center gap-1.5"
              title="클릭하여 프로젝트명 수정">
              {deal.name || "(이름 없음)"}
              <svg className="w-3.5 h-3.5 text-[var(--text-dim)] shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" strokeLinecap="round" strokeLinejoin="round" /><path d="M18.5 2.5a2.12 2.12 0 013 3L12 15l-4 1 1-4 9.5-9.5z" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </h1>
          )}
          <p className="text-xs text-[var(--text-dim)] mt-1">{partner?.name || "거래처 미지정"}{manager?.name ? ` · 담당 ${manager.name}` : ""}</p>
        </div>
        <Link href={`/projects/${dealId}`} className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] shrink-0">
          워크플로우에서 열기 →
        </Link>
      </div>

      {/* 탭 — 세부 프로젝트(캠페인) 화면에서는 '세부 프로젝트'(2단계 제한)·'프로젝트 운영'(전체 현황) 숨김 */}
      <div className="flex gap-2 border-b border-[var(--border)] overflow-x-auto">
        {TABS.filter((t) => !(deal.parent_deal_id && (t.key === "subprojects" || t.key === "pnl"))).map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition whitespace-nowrap ${tab === t.key ? "border-[var(--primary)] text-[var(--primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
            {t.label}
            {t.key === "subprojects" && hasChildren && <span className="ml-1.5 text-[10px] px-1.5 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">{(children as any[]).length}</span>}
          </button>
        ))}
      </div>

      {/* 개요 */}
      {tab === "overview" && (
        <div className="space-y-4">
          <p className="text-[11px] text-[var(--text-dim)]">금액·마진은 <b className="text-[var(--text-muted)]">매출/매입 관리</b> 입력값(계획) 기준입니다{hasChildren ? <> · 이 프로젝트 + 세부 프로젝트(캠페인) {(children as any[]).length}개 <b className="text-[var(--text-muted)]">합산(롤업)</b></> : null}. 실제 전표 기준 손익은 ‘프로젝트 운영’ 탭에서 확인하세요.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="매출(계획)" value={won(planRevenue)} hint={subSalesSum > 0 ? `자체 계약 ${won(ownContract)} + 매출형 ${won(subSalesSum)}` : undefined} />
            <Metric label="총 비용(계획)" value={won(planCost)} hint="매입형 ‘매출/매입 관리’ 합계" />
            <Metric label="마진금액(계획)" value={won(planMargin)} accent={planMargin < 0 ? "danger" : "primary"} />
            <Metric label="마진률(계획)" value={planMarginRatePct} accent={planMarginRate != null && planMarginRate < 0 ? "danger" : "primary"} />
          </div>
          {hasInclusiveSub && (
            <p className="text-[11px] text-[var(--text-dim)]">※ VAT <b className="text-[var(--text-muted)]">포함</b>으로 입력한 매출/매입 항목은 <b className="text-[var(--text-muted)]">공급가액(VAT 제외)</b>으로 환산해 표시·계산됩니다. 입력한 총액은 ‘매출/매입 관리’ 탭에서 확인하세요.</p>
          )}
          <MarginRollup contract={ownContract} marginRow={marginRow} totalCost={totalCost} />
          <div className="glass-card p-5 grid grid-cols-1 sm:grid-cols-2 gap-x-8 gap-y-3 text-sm">
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
      )}

      {/* 세부 프로젝트 */}
      {tab === "subdeals" && companyId && <SubDealsTab dealId={dealId} companyId={companyId} />}

      {/* 견적서 */}
      {tab === "quote" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-[var(--text-muted)]">이 프로젝트의 견적서·연결 문서입니다. <span className="text-[var(--text-dim)]">견적No.를 클릭하면 수정 화면으로 이동합니다.</span></p>
            <div className="flex items-center gap-2 relative">
              <button onClick={() => setShowColSettings((v) => !v)}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)]">⚙ 열 설정</button>
              <button onClick={createQuoteInstant} disabled={creatingQuote}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-50">{creatingQuote ? "생성 중..." : "+ 견적서 작성"}</button>
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

          {quoteDocs.length === 0 ? (
            <Empty text="이 프로젝트에 연결된 견적서가 없습니다. 위 “+ 견적서 작성”으로 만들어 보세요." />
          ) : (
            <div className="glass-card overflow-x-auto">
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                    {cols.map((c) => (
                      <th key={c.key} className={`px-3 py-2.5 text-[12px] font-bold whitespace-nowrap border-b border-[var(--border)] ${c.align === "r" ? "text-right" : c.align === "c" ? "text-center" : "text-left"}`}>{c.label}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {quoteDocs.map((doc) => {
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
                          if (c.key === "print") return <td key={c.key} className={cellCls(c)}><Link href={`/documents?id=${doc.id}&print=1`} className="text-[11px] font-semibold text-[var(--text-muted)] hover:text-[var(--primary)] hover:underline whitespace-nowrap">인쇄</Link></td>;
                          return <td key={c.key} className={cellCls(c)}>—</td>;
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {approvals.filter((a) => a.stage === "견적" || a.stage === "estimate").length > 0 && (
            <div className="glass-card p-4">
              <div className="text-xs font-bold text-[var(--text-muted)] mb-2">견적 승인 흐름</div>
              {approvals.filter((a) => a.stage === "견적" || a.stage === "estimate").map((a) => (
                <ApprovalRow key={a.id} a={a} />
              ))}
            </div>
          )}
        </div>
      )}

      {/* 계약 */}
      {tab === "contract" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-[var(--text-muted)]">이 프로젝트의 계약서·전자서명입니다. <span className="text-[var(--text-dim)]">계약서 작성·발송은 여기서 관리합니다(견적서와 분리).</span></p>
            <div className="flex items-center gap-2">
              <button onClick={() => { setFormKind("contract"); setSelectedTemplateId(""); setQuoteSubDealId(""); setQuoteName(`${deal?.name || "프로젝트"} 계약서`); setShowQuoteForm(true); }}
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">+ 계약서 작성</button>
              <Link href="/signatures?bulk=1" className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-emerald-600 text-white hover:opacity-90">📤 단체 일괄 발송</Link>
              <Link href="/signatures" className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">전자계약 메뉴 →</Link>
            </div>
          </div>

          {/* 계약 문서 (견적서 제외) — 작성·편집 */}
          {contractDocs.length > 0 && (
            <div className="glass-card overflow-hidden divide-y divide-[var(--border)]/40">
              <div className="px-4 py-2.5 bg-[var(--bg-surface)] text-[11px] font-bold text-[var(--text-muted)]">계약 문서</div>
              {contractDocs.map((doc) => (
                <div key={doc.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                  <Link href={`/documents?id=${doc.id}`} className="min-w-0 flex-1 text-sm text-[var(--primary)] font-medium hover:underline truncate">{doc.name || "계약서"}</Link>
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] shrink-0">{doc.status || "draft"}</span>
                  <span className="text-[11px] text-[var(--text-dim)] shrink-0 mono-number">{fmtDate(doc.created_at)}</span>
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
                <div className="glass-card p-4">
                  <div className="text-xs font-bold text-[var(--text-muted)] mb-2">단계별 승인</div>
                  {approvals.map((a) => <ApprovalRow key={a.id} a={a} />)}
                </div>
              )}
            </>
          )}
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
                className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">+ 세부 프로젝트 추가</button>
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
                <div className="text-xs font-medium text-[var(--text-muted)] mb-1.5">매출/매입 계획 <span className="font-normal text-[var(--text-dim)]">(개요 · 선택)</span></div>
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
                <p className="text-[11px] text-[var(--text-dim)] mt-2">입력한 매출/매입은 <b className="text-[var(--text-muted)]">계획(개요)</b>으로 저장돼 상위 프로젝트 개요 마진에 반영됩니다. <b className="text-[var(--text-muted)]">총 비용·마진(실적)</b>에는 실제 전표만 반영(계획 제외). 비우면 생성 후 ‘매출/매입 관리’에서 입력 가능. 거래처·담당자는 상위 프로젝트({partner?.name || "미지정"})에서 상속됩니다.</p>
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
                  <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)]">
                    <th className="px-3 py-2.5 text-[12px] font-bold text-left border-b border-[var(--border)]">캠페인명</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-center border-b border-[var(--border)] w-[80px]">단계</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-right border-b border-[var(--border)] w-[120px]">매출(계획)</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-right border-b border-[var(--border)] w-[120px]">마진(계획)</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-left border-b border-[var(--border)] w-[170px]">기간</th>
                    <th className="px-3 py-2.5 text-[12px] font-bold text-center border-b border-[var(--border)] w-[60px]"></th>
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
                        <td className="px-3 py-2.5 border-b border-[var(--border)]/40 text-center text-[var(--text-dim)]">→</td>
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
        </div>
      )}

      {/* 프로젝트 운영 — 진행 단계 + 손익 */}
      {tab === "pnl" && (
        <div className="space-y-4">
          <div className="glass-card p-4">
            <div className="text-xs font-bold text-[var(--text-muted)] mb-3">진행 단계 <span className="font-normal text-[var(--text-dim)]">— 단계를 클릭해 변경하세요</span></div>
            <div className="flex items-center gap-1.5 flex-wrap">
              {STAGE_ORDER.map((st) => {
                const active = st === stage;
                const passed = STAGE_ORDER.indexOf(st) < STAGE_ORDER.indexOf(stage);
                const c = STAGE_COLOR[st];
                return (
                  <button key={st} onClick={() => !stageMut.isPending && stageMut.mutate(st)} disabled={stageMut.isPending}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition disabled:opacity-60 ${active ? `${c.bg} ${c.text} ring-2 ring-[var(--primary)]/40` : passed ? "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]" : "bg-[var(--bg)] text-[var(--text-dim)] border border-[var(--border)] hover:border-[var(--primary)]"}`}>
                    {STAGE_LABEL[st]}
                  </button>
                );
              })}
            </div>
          </div>
          <p className="text-[11px] text-[var(--text-dim)]">아래는 <b className="text-[var(--text-muted)]">실제 태그된 전표·계산서</b> 기준(실적)입니다. 계획(매출/매입 관리 입력값) 기준 마진은 ‘개요’ 탭에서 확인하세요.</p>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="계약금액(매출)" value={won(contract)} />
            <Metric label="총 비용(실적)" value={won(totalCost)} hint="태그된 전표·계산서 합계" />
            <Metric label="마진금액(실적)" value={won(margin)} accent={margin < 0 ? "danger" : "primary"} />
            <Metric label="마진률(실적)" value={marginRatePct} accent={marginRate != null && marginRate < 0 ? "danger" : "primary"} />
          </div>
          <MarginRollup contract={ownContract} marginRow={marginRow} totalCost={totalCost} />
          <div className="glass-card overflow-hidden">
            <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] flex items-center justify-between">
              <span className="text-xs font-bold text-[var(--text-muted)]">비용 구성 (프로젝트에 태그된 비용처리 내역)</span>
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
          <div className="glass-card p-4 text-[11px] text-[var(--text-muted)] space-y-1 leading-relaxed">
            <p>· <b className="text-[var(--text)]">비용</b> = 이 프로젝트에 태그된 세금계산서(매입)·현금영수증·카드사용·수동 전표 합계. 마진 = 계약금액 − 비용.</p>
            <p>· 각 내역 화면에서 프로젝트를 지정하면 자동 집계됩니다. <b className="text-[var(--text)]">같은 지출을 두 곳(예: 카드+전표)에 중복 태그하지 마세요</b> — 비용이 이중 계상됩니다.</p>
          </div>
        </div>
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
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">세부 프로젝트 연결 <span className="font-normal text-[var(--text-dim)]">(선택 — 매출/매입 견적을 세부에 부착)</span></label>
                <select
                  value={quoteSubDealId}
                  onChange={(e) => setQuoteSubDealId(e.target.value)}
                  className="w-full h-11 px-3.5 mb-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                >
                  <option value="">프로젝트 전체 (세부 미지정)</option>
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
    </div>
  );
}

// 계획 마진(세부 포함) vs 실적 마진 — 합산 금지(계획·실적 별도 축). marginRow 는 앱사이드 롤업(캠페인 포함).
function MarginRollup({ contract, marginRow, totalCost }: { contract: number; marginRow: any; totalCost: number }) {
  const subSales = Number(marginRow?.sub_sales_planned || 0);
  const subPurchase = Number(marginRow?.sub_purchase_planned || 0);
  if (subSales === 0 && subPurchase === 0) return null; // 세부 없으면 롤업 숨김(기존 카드로 충분)
  const planned = marginRow?.planned_margin != null ? Number(marginRow.planned_margin) : contract + subSales - subPurchase;
  const plannedRevenue = contract + subSales;
  const plannedRate = plannedRevenue > 0 ? Math.round((planned / plannedRevenue) * 100) : null;
  const actualMargin = marginRow?.actual_margin != null ? Number(marginRow.actual_margin) : contract - totalCost;
  return (
    <div className="glass-card overflow-hidden">
      <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)]">
        <span className="text-xs font-bold text-[var(--text-muted)]">마진 롤업 <span className="font-normal text-[var(--text-dim)]">— 세부 프로젝트 포함(계획) · 전표(실적) 병기</span></span>
      </div>
      <div className="p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <Metric label="총계약금액(주매출)" value={won(contract)} />
          <Metric label="Σ 매출형 세부" value={won(subSales)} accent="primary" />
          <Metric label="Σ 매입형 세부" value={won(subPurchase)} accent="danger" />
          <Metric label="계획 마진" value={won(planned)} hint="(총계약 + 매출형세부) − 매입형세부" accent={planned < 0 ? "danger" : "primary"} />
        </div>
        <div className="flex items-center justify-between text-xs px-1">
          <span className="text-[var(--text-muted)]">계획 마진율 <b className="text-[var(--text)] mono-number">{plannedRate == null ? "—" : `${plannedRate}%`}</b></span>
          <span className="text-[var(--text-dim)]">실적 마진(전표 기준) <b className="text-[var(--text)] mono-number">{won(actualMargin)}</b> · 실적원가 {won(Number(marginRow?.actual_direct_cost || totalCost))}</span>
        </div>
        <p className="text-[11px] text-[var(--text-dim)] leading-relaxed">· 계획 마진 = 약정 기준(세부 매출형 더하고 매입형 뺌). 실적 마진 = 전표 직접원가 기준. <b className="text-[var(--text)]">두 축은 합산하지 않습니다</b>(이중계상 방지).</p>
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
    <div className="glass-card px-3 py-2.5">
      <div className="text-[11px] text-[var(--text-muted)]">{label}</div>
      <div className={`text-base font-bold mono-number mt-0.5 ${color}`} title={hint}>{value}</div>
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
  return <div className="glass-card p-10 text-center text-sm text-[var(--text-muted)]">{text}</div>;
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
