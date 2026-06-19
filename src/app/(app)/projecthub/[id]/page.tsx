"use client";

// 프로젝트 상세 (라이프사이클 탭) — 기존 deal 데이터 재사용. 2026-06-17 핸드오프 v2.
//   탭: 개요 / 견적서 / 계약 / 진행현황 / 손익. 모두 기존 테이블 읽기(연결·표시), 원본 무수정.
//   손익(원가율) 은 journal_entries.deal_id + v_deal_pnl 추가 후 별도 단계에서 채움.

import { useMemo, useState, useEffect, useRef } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { AccessDenied } from "@/components/access-denied";
import { STAGE_LABEL, STAGE_COLOR, STAGE_ORDER, type ProjectStage } from "@/lib/project-rules";
import { createFromTemplate } from "@/lib/documents";
import { seedDefaultDocTemplates } from "@/lib/default-doc-templates";

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
const won = (n: number | null | undefined) => `${Math.round(Number(n || 0)).toLocaleString("ko-KR")}원`;
const fmtDate = (d: string | null | undefined) => (d ? String(d).slice(0, 10) : "—");

type TabKey = "overview" | "quote" | "contract" | "pnl";
const TABS: { key: TabKey; label: string }[] = [
  { key: "overview", label: "개요" },
  { key: "quote", label: "견적서" },
  { key: "contract", label: "전자계약" },
  { key: "pnl", label: "프로젝트 운영" },
];

export default function ProjectHubDetailPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const userId = user?.id ?? null;
  const role = user?.role;
  const params = useParams();
  const dealId = String(params?.id || "");
  const [tab, setTab] = useState<TabKey>("overview");
  const { toast } = useToast();
  const qc = useQueryClient();
  // 견적서 작성(인라인) — 문서함으로 넘어가지 않고 프로젝트에서 바로 생성
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [quoteName, setQuoteName] = useState("");
  const [selectedTemplateId, setSelectedTemplateId] = useState("");
  const [creatingQuote, setCreatingQuote] = useState(false);
  const createQuote = async () => {
    if (!companyId || !userId || creatingQuote) return;
    setCreatingQuote(true);
    try {
      if (selectedTemplateId) {
        // 선택한 양식(계약서 등)으로 생성
        await createFromTemplate({ companyId, templateId: selectedTemplateId, dealId, name: quoteName.trim() || "문서", createdBy: userId });
      } else {
        // 기본 견적서 구조로 생성
        const { error } = await db.from("documents").insert({
          company_id: companyId,
          deal_id: dealId,
          name: quoteName.trim() || "견적서",
          status: "draft",
          content_type: "invoice",
          content_json: QUOTE_CONTENT,
          version: 1,
          created_by: userId,
        });
        if (error) throw error;
      }
      qc.invalidateQueries({ queryKey: ["projecthub-docs", dealId] });
      setShowQuoteForm(false);
      setQuoteName("");
      setSelectedTemplateId("");
      toast("문서를 생성했습니다. 목록에서 ‘열기/편집’으로 내용을 작성하세요.", "success");
    } catch (e: any) {
      toast(e?.message || "문서 생성 실패", "error");
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
  const selectableTemplates = useMemo(
    () => (docTemplates as any[]).filter((t: any) => ["contract", "quote", "agreement", "nda"].includes(t.type)),
    [docTemplates],
  );
  const didSeedTplRef = useRef(false);
  useEffect(() => {
    if (!companyId || !userId || !templatesLoaded || didSeedTplRef.current) return;
    if (selectableTemplates.length > 0) return;
    didSeedTplRef.current = true;
    seedDefaultDocTemplates(companyId, userId).then(() => qc.invalidateQueries({ queryKey: ["projecthub-doc-templates", companyId] }));
  }, [companyId, userId, templatesLoaded, selectableTemplates, qc]);
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

  // 견적/계약 — documents(deal_id) + quote_tracking + quote_approvals + signature_requests
  const { data: documents = [] } = useQuery({
    queryKey: ["projecthub-docs", dealId],
    queryFn: async () => {
      const { data } = await db.from("documents").select("id, name, status, content_type, contract_amount, document_number, created_at").eq("deal_id", dealId).order("created_at", { ascending: false });
      return (data || []) as any[];
    },
    enabled: !!dealId && (tab === "quote" || tab === "contract"),
  });
  const docIds = useMemo(() => documents.map((d) => d.id), [documents]);
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
    queryKey: ["projecthub-cost-inv", dealId],
    queryFn: async () => {
      const { data } = await db.from("tax_invoices").select("id, issue_date, counterparty_name, supply_amount, total_amount").eq("deal_id", dealId).eq("type", "purchase").neq("status", "void").order("issue_date", { ascending: false });
      return (data || []) as any[];
    },
    enabled: costEnabled,
  });
  const { data: costCash = [] } = useQuery({
    queryKey: ["projecthub-cost-cash", dealId],
    queryFn: async () => {
      const { data } = await db.from("cash_receipts").select("id, issue_date, counterparty_name, amount, supply_amount").eq("deal_id", dealId).order("issue_date", { ascending: false });
      return (data || []) as any[];
    },
    enabled: costEnabled,
  });
  const { data: costCards = [] } = useQuery({
    queryKey: ["projecthub-cost-card", dealId],
    queryFn: async () => {
      const { data } = await db.from("card_transactions").select("id, transaction_date, merchant_name, amount, card_name").eq("deal_id", dealId).is("journal_entry_id", null).order("transaction_date", { ascending: false });
      return (data || []) as any[];
    },
    enabled: costEnabled,
  });
  const { data: costVouchers = [] } = useQuery({
    queryKey: ["projecthub-cost-voucher", dealId],
    queryFn: async () => {
      const { data } = await db.from("journal_entries").select("id, entry_date, description, journal_lines(debit, chart_of_accounts(code, name, account_type))").eq("deal_id", dealId).eq("source", "manual").eq("status", "confirmed").order("entry_date", { ascending: false });
      return (data || []) as any[];
    },
    enabled: costEnabled,
  });

  if (role && role !== "owner" && role !== "admin") return <AccessDenied />;
  if (isLoading) return <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>;
  if (!deal) return <div className="p-12 text-center text-sm text-[var(--text-muted)]">프로젝트를 찾을 수 없습니다. <Link href="/projecthub" className="text-[var(--primary)] hover:underline">목록으로</Link></div>;

  const stage = (STAGE_ORDER.includes(deal.stage) ? deal.stage : "estimate") as ProjectStage;
  const sc = STAGE_COLOR[stage];
  const contract = Number(deal.contract_total || 0);
  // 비용 = 프로젝트에 태그된 각 비용원 합 (카테고리별 — 같은 비용을 두 곳에 태그하면 중복이니 한 곳만)
  const sumBy = (arr: any[], f: (x: any) => number) => arr.reduce((s, x) => s + (Number(f(x)) || 0), 0);
  const costInvoiceSum = sumBy(costInvoices as any[], (i) => i.supply_amount || i.total_amount);
  const costCashSum = sumBy(costCash as any[], (c) => c.supply_amount || c.amount);
  const costCardSum = sumBy(costCards as any[], (c) => c.amount);
  const costVoucherSum = sumBy(costVouchers as any[], (v) =>
    (v.journal_lines || []).filter((l: any) => l.chart_of_accounts?.account_type === "expense").reduce((s: number, l: any) => s + Number(l.debit || 0), 0));
  const totalCost = costInvoiceSum + costCashSum + costCardSum + costVoucherSum;
  const margin = contract - totalCost;
  const marginRate = contract > 0 ? margin / contract : null;
  const marginRatePct = marginRate == null ? "—" : `${Math.round(marginRate * 100)}%`;
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
            <Link href="/projecthub" className="text-xs text-[var(--text-muted)] hover:text-[var(--text)]">← 프로젝트</Link>
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

      {/* 탭 */}
      <div className="flex gap-2 border-b border-[var(--border)] overflow-x-auto">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`px-4 py-2 text-sm font-semibold border-b-2 -mb-px transition whitespace-nowrap ${tab === t.key ? "border-[var(--primary)] text-[var(--primary)]" : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* 개요 */}
      {tab === "overview" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="계약금액(매출)" value={won(contract)} />
            <Metric label="총 비용" value={won(totalCost)} hint="프로젝트 태그 비용 합계" />
            <Metric label="마진금액" value={won(margin)} accent={margin < 0 ? "danger" : "primary"} />
            <Metric label="마진률" value={marginRatePct} accent={marginRate != null && marginRate < 0 ? "danger" : "primary"} />
          </div>
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

      {/* 견적서 */}
      {tab === "quote" && (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2 flex-wrap">
            <p className="text-xs text-[var(--text-muted)]">이 프로젝트의 견적서·연결 문서입니다.</p>
            <button onClick={() => { setQuoteName(`${deal?.name || "프로젝트"} 견적서`); setShowQuoteForm(true); }}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">+ 견적서 작성</button>
          </div>

          {/* 견적서 작성 모달 — 문서함 이동 없이 이 자리에서 생성 */}
          {showQuoteForm && (
            <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/40 p-4" onClick={() => setShowQuoteForm(false)}>
              <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl shadow-xl w-full max-w-md p-6" onClick={(e) => e.stopPropagation()}>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-base font-bold">문서 작성</h3>
                  <button onClick={() => setShowQuoteForm(false)} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none" aria-label="닫기">✕</button>
                </div>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">양식 선택</label>
                <select
                  value={selectedTemplateId}
                  onChange={(e) => {
                    setSelectedTemplateId(e.target.value);
                    const t = selectableTemplates.find((x: any) => x.id === e.target.value);
                    setQuoteName(`${deal?.name || "프로젝트"} ${t ? t.name : "견적서"}`);
                  }}
                  className="w-full h-11 px-3.5 mb-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]"
                >
                  <option value="">견적서 (기본 양식)</option>
                  {selectableTemplates.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select>
                <label className="block text-xs font-medium text-[var(--text-muted)] mb-1.5">문서명</label>
                <input
                  autoFocus
                  value={quoteName}
                  onChange={(e) => setQuoteName(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") createQuote(); }}
                  placeholder="견적서명"
                  className="w-full h-11 px-3.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)] focus:ring-2 focus:ring-[var(--primary)]/15 transition"
                />
                <p className="text-[11px] text-[var(--text-dim)] mt-2">선택한 양식으로 이 프로젝트에 연결된 문서가 생성됩니다. 생성 후 목록의 ‘열기/편집’으로 내용을 작성·수정하세요.</p>
                <div className="flex items-center justify-end gap-2.5 mt-5">
                  <button onClick={() => setShowQuoteForm(false)} className="px-5 h-10 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)] hover:bg-[var(--bg-surface)] transition">취소</button>
                  <button onClick={createQuote} disabled={creatingQuote} className="px-6 h-10 bg-[var(--primary)] text-white rounded-xl text-sm font-bold disabled:opacity-50 hover:brightness-110 transition">{creatingQuote ? "생성 중..." : "생성"}</button>
                </div>
              </div>
            </div>
          )}
          {documents.length === 0 ? (
            <Empty text="이 프로젝트에 연결된 문서(견적서)가 없습니다. 위 “+ 견적서 작성”으로 만들어 보세요." />
          ) : (
            <div className="glass-card overflow-hidden divide-y divide-[var(--border)]/40">
              {documents.map((doc) => {
                const qt = quoteTracking.find((q) => q.document_id === doc.id);
                return (
                  <div key={doc.id} className="px-4 py-3 flex items-center gap-3 flex-wrap">
                    <div className="min-w-0 flex-1">
                      <div className="text-sm text-[var(--text)] truncate">{doc.name || qt?.quote_title || "문서"}</div>
                      <div className="text-[11px] text-[var(--text-dim)]">{doc.content_type || "문서"} · {fmtDate(doc.created_at)}{doc.document_number ? ` · ${doc.document_number}` : ""}</div>
                    </div>
                    {qt && (
                      <div className="text-[11px] text-[var(--text-muted)] shrink-0">
                        열람 {qt.view_count ?? 0}회{qt.viewed_at ? ` · 최근 ${fmtDate(qt.viewed_at)}` : ""}
                      </div>
                    )}
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] shrink-0">{qt?.status || doc.status || "—"}</span>
                    {doc.contract_amount != null && <span className="text-xs mono-number text-[var(--text)] shrink-0">{won(doc.contract_amount)}</span>}
                    <Link href={`/documents?id=${doc.id}`} className="text-[11px] font-semibold text-[var(--primary)] hover:underline shrink-0">열기/편집 →</Link>
                  </div>
                );
              })}
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
          <div className="flex items-center justify-between">
            <p className="text-xs text-[var(--text-muted)]">전자계약(전자서명) 상태입니다. 발송·관리는 전자계약 메뉴에서 합니다.</p>
            <Link href="/signatures" className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90">전자계약 메뉴 →</Link>
          </div>
          {sigRequests.length === 0 && approvals.length === 0 ? (
            <Empty text="이 프로젝트에 연결된 전자계약·승인 내역이 없습니다." />
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

      {/* 손익 — 계약금액(매출) - 비용 = 마진금액 / 마진률 */}
      {tab === "pnl" && (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <Metric label="계약금액(매출)" value={won(contract)} />
            <Metric label="총 비용" value={won(totalCost)} />
            <Metric label="마진금액" value={won(margin)} accent={margin < 0 ? "danger" : "primary"} />
            <Metric label="마진률" value={marginRatePct} accent={marginRate != null && marginRate < 0 ? "danger" : "primary"} />
          </div>
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
