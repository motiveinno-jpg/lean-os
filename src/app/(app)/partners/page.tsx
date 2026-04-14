"use client";

import { useEffect, useState, useCallback } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getPartners, upsertPartner, deletePartner, searchPartners } from "@/lib/partners";
import { getCurrentUser, getDeals } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { verifyBusinessNumber } from "@/lib/business-verification";
import { QueryErrorBanner } from "@/components/query-status";

const TYPE_OPTIONS = [
  { value: "", label: "전체" },
  { value: "vendor", label: "공급업체" },
  { value: "client", label: "고객사" },
  { value: "partner", label: "파트너" },
  { value: "government", label: "정부/공공기관" },
  { value: "other", label: "기타" },
];

const TYPE_BADGE: Record<string, { bg: string; text: string; label: string }> = {
  vendor: { bg: "bg-purple-500/15", text: "text-purple-400", label: "공급업체" },
  client: { bg: "bg-blue-500/15", text: "text-blue-400", label: "고객사" },
  partner: { bg: "bg-green-500/15", text: "text-green-400", label: "파트너" },
  government: { bg: "bg-red-500/15", text: "text-red-400", label: "정부/공공기관" },
  other: { bg: "bg-gray-500/15", text: "text-gray-400", label: "기타" },
};

const EMPTY_FORM = {
  name: "", type: "client", classification: "", businessNumber: "",
  representative: "", contactName: "", contactEmail: "", contactPhone: "",
  address: "", bankName: "", accountNumber: "", tags: "", notes: "",
};

const inputCls = "w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]";
const labelCls = "block text-xs text-[var(--text-muted)] mb-1";

export default function PartnersPage() {
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [typeFilter, setTypeFilter] = useState("");
  const [activeFilter, setActiveFilter] = useState<boolean | undefined>(true);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [detailPartner, setDetailPartner] = useState<any>(null);
  const [detailTab, setDetailTab] = useState<"info" | "deals" | "payments" | "docs">("info");
  const [tagFilter, setTagFilter] = useState<string>("");
  const [bizVerifyResults, setBizVerifyResults] = useState<Record<string, { status: string; loading: boolean }>>({});

  const handleVerifyBiz = useCallback(async (bizNo: string, e?: React.MouseEvent) => {
    if (e) e.stopPropagation();
    if (!bizNo) return;
    const cleaned = bizNo.replace(/[^0-9]/g, "");
    if (!cleaned) return;
    setBizVerifyResults((prev) => ({ ...prev, [cleaned]: { status: "loading", loading: true } }));
    const result = await verifyBusinessNumber(cleaned);
    setBizVerifyResults((prev) => ({ ...prev, [cleaned]: { status: result.status, loading: false } }));
  }, []);

  useEffect(() => {
    getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); });
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  const { data: partners = [], isLoading, error: mainError, refetch: mainRefetch } = useQuery({
    queryKey: ["partners", companyId, typeFilter, activeFilter, debouncedSearch, tagFilter],
    queryFn: async () => {
      if (debouncedSearch && debouncedSearch.length >= 2) {
        // 복합검색: 이름+담당자+이메일+사업자번호
        let results = await searchPartners(companyId!, debouncedSearch);
        if (typeFilter) results = results.filter((p: any) => p.type === typeFilter);
        if (activeFilter !== undefined) results = results.filter((p: any) => p.is_active === activeFilter);
        if (tagFilter) results = results.filter((p: any) => (p.tags || []).includes(tagFilter));
        return results;
      }
      return getPartners(companyId!, {
        type: typeFilter || undefined,
        isActive: activeFilter,
        search: undefined,
        tags: tagFilter ? [tagFilter] : undefined,
      });
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });

  // 360도뷰: 거래처의 딜/문서/결제 데이터
  const { data: partnerDeals = [] } = useQuery({
    queryKey: ["partner-deals", detailPartner?.id],
    queryFn: async () => {
      if (!detailPartner) return [];
      const { data } = await (supabase as any).from("deals")
        .select("id, name, status, contract_total, classification, created_at")
        .eq("company_id", companyId)
        .eq("partner_id", detailPartner.id)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!detailPartner?.id,
  });

  const { data: partnerDocs = [] } = useQuery({
    queryKey: ["partner-docs", detailPartner?.id],
    queryFn: async () => {
      if (!detailPartner || partnerDeals.length === 0) return [];
      const dealIds = partnerDeals.map((d: any) => d.id);
      const { data } = await (supabase as any).from("documents")
        .select("id, name, status, created_at, content_json")
        .in("deal_id", dealIds)
        .order("created_at", { ascending: false })
        .limit(20);
      return data || [];
    },
    enabled: !!detailPartner?.id && partnerDeals.length > 0,
  });

  const { data: partnerPayments = [] } = useQuery({
    queryKey: ["partner-payments", detailPartner?.id],
    queryFn: async () => {
      if (!detailPartner || partnerDeals.length === 0) return [];
      const dealIds = partnerDeals.map((d: any) => d.id);
      const { data } = await (supabase as any).from("deal_revenue_schedule")
        .select("*")
        .in("deal_id", dealIds)
        .order("due_date", { ascending: false })
        .limit(20);
      return data || [];
    },
    enabled: !!detailPartner?.id && partnerDeals.length > 0,
  });

  // 태그 목록 수집 (필터용)
  const allTags = Array.from(new Set(partners.flatMap((p: any) => p.tags || []))) as string[];

  const saveMutation = useMutation({
    mutationFn: () => upsertPartner({
      id: editingId || undefined, companyId: companyId!, name: form.name, type: form.type,
      classification: form.classification || undefined,
      businessNumber: form.businessNumber || undefined,
      representative: form.representative || undefined,
      contactName: form.contactName || undefined,
      contactEmail: form.contactEmail || undefined,
      contactPhone: form.contactPhone || undefined,
      address: form.address || undefined,
      bankName: form.bankName || undefined,
      accountNumber: form.accountNumber || undefined,
      tags: form.tags ? form.tags.split(",").map((t) => t.trim()).filter(Boolean) : [],
      notes: form.notes || undefined,
    }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["partners"] }); closeModal(); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deletePartner(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["partners"] }); closeModal(); },
  });

  const toggleActiveMutation = useMutation({
    mutationFn: (p: any) => upsertPartner({ id: p.id, companyId: companyId!, name: p.name, isActive: !p.is_active }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["partners"] }); },
  });

  const openCreate = useCallback(() => {
    setEditingId(null); setForm(EMPTY_FORM); setShowModal(true);
  }, []);

  const openEdit = useCallback((p: any) => {
    setEditingId(p.id);
    setForm({
      name: p.name || "", type: p.type || "client", classification: p.classification || "",
      businessNumber: p.business_number || "", representative: p.representative || "",
      contactName: p.contact_name || "", contactEmail: p.contact_email || "",
      contactPhone: p.contact_phone || "", address: p.address || "",
      bankName: p.bank_name || "", accountNumber: p.account_number || "",
      tags: (p.tags || []).join(", "), notes: p.notes || "",
    });
    setShowModal(true);
  }, []);

  const closeModal = useCallback(() => {
    setShowModal(false); setEditingId(null); setForm(EMPTY_FORM);
  }, []);

  const handleExport = useCallback(async () => {
    const XLSX = await import("xlsx");
    const rows = partners.map((p: any) => ({
      이름: p.name, 구분: p.type || "", 사업자번호: p.business_number || "",
      담당자: p.contact_name || "", 이메일: p.contact_email || "",
      연락처: p.contact_phone || "", 태그: (p.tags || []).join(", "),
      상태: p.is_active ? "활성" : "비활성",
    }));
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "거래처");
    XLSX.writeFile(wb, `거래처_${new Date().toISOString().slice(0, 10)}.xlsx`);
  }, [partners]);

  const setField = useCallback(
    (key: string, value: string) => setForm((prev) => ({ ...prev, [key]: value })),
    []
  );

  return (
    <div className="max-w-[1100px]">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-2xl font-extrabold">거래처 관리</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">Partners / CRM</p>
        </div>
        <div className="flex gap-2">
          <button onClick={handleExport}
            className="px-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-surface)] text-[var(--text-main)] rounded-xl text-sm font-semibold transition">
            Excel 내보내기
          </button>
          <button onClick={openCreate}
            className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition">
            + 새 거래처
          </button>
        </div>
      </div>

      {/* Filter Bar */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}
          className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
          {TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        <button onClick={() => setActiveFilter(activeFilter === true ? undefined : true)}
          className={`px-3 py-2 rounded-xl text-sm font-medium border transition ${
            activeFilter === true
              ? "bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--primary)]"
              : "bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-muted)]"
          }`}>
          {activeFilter === true ? "활성만" : "전체"}
        </button>
        <input type="text" placeholder="이름, 담당자, 사업자번호 검색..." value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
        <span className="text-xs text-[var(--text-dim)]">{partners.length}건</span>
      </div>

      {/* Tag Filter Chips */}
      {allTags.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 mb-4">
          <span className="text-xs text-[var(--text-dim)]">태그:</span>
          {allTags.map((tag) => (
            <button key={tag} onClick={() => setTagFilter(tagFilter === tag ? "" : tag)}
              className={`text-xs px-2.5 py-1 rounded-full border transition ${
                tagFilter === tag
                  ? "bg-[var(--primary)]/15 border-[var(--primary)] text-[var(--primary)]"
                  : "bg-[var(--bg-card)] border-[var(--border)] text-[var(--text-muted)] hover:border-[var(--text-dim)]"
              }`}>
              {tag}
            </button>
          ))}
          {tagFilter && (
            <button onClick={() => setTagFilter("")}
              className="text-xs text-[var(--text-dim)] hover:text-[var(--text-main)] transition underline">
              전체 보기
            </button>
          )}
        </div>
      )}

      {/* Table */}
      <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
        {isLoading ? (
          <div className="p-16 text-center">
            <div className="text-sm text-[var(--text-muted)]">불러오는 중...</div>
          </div>
        ) : partners.length === 0 ? (
          <div className="p-16 text-center">
            <div className="text-4xl mb-4">🏢</div>
            <div className="text-sm text-[var(--text-muted)]">등록된 거래처가 없습니다</div>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                  <th className="text-left px-5 py-3 font-medium">이름</th>
                  <th className="text-center px-4 py-3 font-medium">구분</th>
                  <th className="text-left px-4 py-3 font-medium">사업자번호</th>
                  <th className="text-left px-4 py-3 font-medium">담당자</th>
                  <th className="text-left px-4 py-3 font-medium">연락처</th>
                  <th className="text-left px-4 py-3 font-medium">태그</th>
                  <th className="text-center px-4 py-3 font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {partners.map((p: any) => {
                  const badge = TYPE_BADGE[p.type] || TYPE_BADGE.other;
                  return (
                    <tr key={p.id} onClick={() => { setDetailPartner(p); setDetailTab("info"); }}
                      className="border-b border-[var(--border)]/50 hover:bg-[var(--bg-surface)] cursor-pointer transition">
                      <td className="px-5 py-3 text-sm font-medium">{p.name}</td>
                      <td className="px-4 py-3 text-center">
                        <span className={`text-xs px-2 py-0.5 rounded-full ${badge.bg} ${badge.text}`}>{badge.label}</span>
                      </td>
                      <td className="px-4 py-3 text-sm text-[var(--text-muted)]">
                        <div className="flex items-center gap-1.5">
                          <span>{p.business_number || "—"}</span>
                          {p.business_number && (() => {
                            const cleaned = (p.business_number as string).replace(/[^0-9]/g, "");
                            const vr = bizVerifyResults[cleaned];
                            if (vr?.loading) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400 animate-pulse">...</span>;
                            if (vr && !vr.loading) {
                              const color = vr.status === "계속사업자" ? "bg-green-500/10 text-green-400"
                                : vr.status === "휴업자" ? "bg-yellow-500/10 text-yellow-400"
                                : vr.status === "폐업자" ? "bg-red-500/10 text-red-400"
                                : "bg-gray-500/10 text-gray-400";
                              return <span className={`text-[10px] px-1.5 py-0.5 rounded ${color}`}>{vr.status}</span>;
                            }
                            return (
                              <button onClick={(e) => handleVerifyBiz(p.business_number, e)}
                                className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 transition whitespace-nowrap"
                                title="국세청 사업자 진위확인">
                                확인
                              </button>
                            );
                          })()}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-sm">{p.contact_name || "—"}</td>
                      <td className="px-4 py-3 text-sm text-[var(--text-muted)]">{p.contact_phone || p.contact_email || "—"}</td>
                      <td className="px-4 py-3">
                        {(p.tags || []).length > 0 ? (
                          <div className="flex flex-wrap gap-1">
                            {(p.tags as string[]).slice(0, 3).map((tag: string) => (
                              <span key={tag} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]">{tag}</span>
                            ))}
                            {(p.tags as string[]).length > 3 && (
                              <span className="text-[10px] text-[var(--text-dim)]">+{(p.tags as string[]).length - 3}</span>
                            )}
                          </div>
                        ) : <span className="text-sm text-[var(--text-dim)]">—</span>}
                      </td>
                      <td className="px-4 py-3 text-center">
                        <button onClick={(e) => { e.stopPropagation(); toggleActiveMutation.mutate(p); }}
                          className={`text-xs px-2 py-0.5 rounded-full transition ${
                            p.is_active ? "bg-green-500/10 text-green-400 hover:bg-green-500/20" : "bg-gray-500/10 text-gray-400 hover:bg-gray-500/20"
                          }`}>
                          {p.is_active ? "활성" : "비활성"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 360도뷰 Detail Panel */}
      {detailPartner && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setDetailPartner(null)}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-[900px] max-h-[90vh] overflow-hidden shadow-2xl flex flex-col"
            onClick={(e) => e.stopPropagation()}>
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-xl bg-[var(--primary)]/15 flex items-center justify-center text-[var(--primary)] font-bold text-lg">
                  {detailPartner.name?.charAt(0) || "?"}
                </div>
                <div>
                  <h2 className="text-lg font-bold">{detailPartner.name}</h2>
                  <div className="flex items-center gap-2 mt-0.5">
                    {(() => { const b = TYPE_BADGE[detailPartner.type] || TYPE_BADGE.other; return <span className={`text-[10px] px-2 py-0.5 rounded-full ${b.bg} ${b.text}`}>{b.label}</span>; })()}
                    {detailPartner.business_number && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs text-[var(--text-dim)]">{detailPartner.business_number}</span>
                        {(() => {
                          const cleaned = (detailPartner.business_number as string).replace(/[^0-9]/g, "");
                          const vr = bizVerifyResults[cleaned];
                          if (vr?.loading) return <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-500/10 text-gray-400 animate-pulse">확인중...</span>;
                          if (vr && !vr.loading) {
                            const color = vr.status === "계속사업자" ? "bg-green-500/10 text-green-400"
                              : vr.status === "휴업자" ? "bg-yellow-500/10 text-yellow-400"
                              : vr.status === "폐업자" ? "bg-red-500/10 text-red-400"
                              : "bg-gray-500/10 text-gray-400";
                            return <span className={`text-[10px] px-1.5 py-0.5 rounded ${color}`}>{vr.status}</span>;
                          }
                          return (
                            <button onClick={() => handleVerifyBiz(detailPartner.business_number)}
                              className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 transition">
                              사업자 확인
                            </button>
                          );
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-2">
                <button onClick={() => { openEdit(detailPartner); setDetailPartner(null); }}
                  className="px-3 py-1.5 text-xs bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] rounded-lg hover:bg-[var(--primary)]/10 hover:text-[var(--primary)] transition">
                  편집
                </button>
                <button onClick={() => setDetailPartner(null)} className="text-[var(--text-dim)] hover:text-[var(--text-main)] text-xl transition">✕</button>
              </div>
            </div>

            {/* Tabs */}
            <div className="flex border-b border-[var(--border)]">
              {([
                { key: "info" as const, label: "기본정보" },
                { key: "deals" as const, label: `딜 (${partnerDeals.length})` },
                { key: "payments" as const, label: `결제 (${partnerPayments.length})` },
                { key: "docs" as const, label: `문서 (${partnerDocs.length})` },
              ]).map((tab) => (
                <button key={tab.key} onClick={() => setDetailTab(tab.key)}
                  className={`px-5 py-3 text-sm font-medium transition border-b-2 ${
                    detailTab === tab.key
                      ? "border-[var(--primary)] text-[var(--primary)]"
                      : "border-transparent text-[var(--text-muted)] hover:text-[var(--text-main)]"
                  }`}>
                  {tab.label}
                </button>
              ))}
            </div>

            {/* Tab Content */}
            <div className="flex-1 overflow-y-auto p-6">
              {/* 기본정보 */}
              {detailTab === "info" && (
                <div className="grid grid-cols-2 gap-4">
                  {[
                    ["대표자", detailPartner.representative],
                    ["담당자", detailPartner.contact_name],
                    ["이메일", detailPartner.contact_email],
                    ["연락처", detailPartner.contact_phone],
                    ["주소", detailPartner.address],
                    ["분류", detailPartner.classification],
                    ["은행", detailPartner.bank_name],
                    ["계좌번호", detailPartner.account_number],
                  ].map(([label, value]) => (
                    <div key={label as string} className="bg-[var(--bg-surface)] rounded-xl p-3">
                      <div className="text-[10px] text-[var(--text-dim)] mb-1">{label}</div>
                      <div className="text-sm">{(value as string) || "—"}</div>
                    </div>
                  ))}
                  {(detailPartner.tags || []).length > 0 && (
                    <div className="col-span-2 bg-[var(--bg-surface)] rounded-xl p-3">
                      <div className="text-[10px] text-[var(--text-dim)] mb-1">태그</div>
                      <div className="flex flex-wrap gap-1">
                        {(detailPartner.tags as string[]).map((tag: string) => (
                          <span key={tag} className="text-xs px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">{tag}</span>
                        ))}
                      </div>
                    </div>
                  )}
                  {detailPartner.notes && (
                    <div className="col-span-2 bg-[var(--bg-surface)] rounded-xl p-3">
                      <div className="text-[10px] text-[var(--text-dim)] mb-1">메모</div>
                      <div className="text-sm whitespace-pre-wrap">{detailPartner.notes}</div>
                    </div>
                  )}
                </div>
              )}

              {/* 딜 탭 */}
              {detailTab === "deals" && (
                <div>
                  {partnerDeals.length === 0 ? (
                    <div className="p-12 text-center text-sm text-[var(--text-muted)]">연결된 딜이 없습니다</div>
                  ) : (
                    <>
                      <div className="bg-[var(--bg-surface)] rounded-xl p-4 mb-4 flex gap-6">
                        <div>
                          <div className="text-[10px] text-[var(--text-dim)]">총 딜</div>
                          <div className="text-lg font-bold">{partnerDeals.length}건</div>
                        </div>
                        <div>
                          <div className="text-[10px] text-[var(--text-dim)]">총 계약금액</div>
                          <div className="text-lg font-bold text-[var(--primary)]">
                            {partnerDeals.reduce((s: number, d: any) => s + Number(d.contract_total || 0), 0).toLocaleString()}원
                          </div>
                        </div>
                      </div>
                      <table className="w-full">
                        <thead>
                          <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                            <th className="text-left px-4 py-2 font-medium">딜 이름</th>
                            <th className="text-center px-4 py-2 font-medium">상태</th>
                            <th className="text-right px-4 py-2 font-medium">금액</th>
                            <th className="text-right px-4 py-2 font-medium">생성일</th>
                          </tr>
                        </thead>
                        <tbody>
                          {partnerDeals.map((d: any) => (
                            <tr key={d.id} className="border-b border-[var(--border)]/30">
                              <td className="px-4 py-2.5 text-sm font-medium">{d.name}</td>
                              <td className="px-4 py-2.5 text-center">
                                <span className={`text-xs px-2 py-0.5 rounded-full ${
                                  d.status === "won" ? "bg-green-500/10 text-green-400"
                                  : d.status === "lost" ? "bg-red-500/10 text-red-400"
                                  : d.status === "in_progress" ? "bg-blue-500/10 text-blue-400"
                                  : "bg-gray-500/10 text-gray-400"
                                }`}>{d.status}</span>
                              </td>
                              <td className="px-4 py-2.5 text-sm text-right">{Number(d.contract_total || 0).toLocaleString()}원</td>
                              <td className="px-4 py-2.5 text-xs text-right text-[var(--text-muted)]">{d.created_at?.slice(0, 10)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </>
                  )}
                </div>
              )}

              {/* 결제 탭 */}
              {detailTab === "payments" && (
                <div>
                  {partnerPayments.length === 0 ? (
                    <div className="p-12 text-center text-sm text-[var(--text-muted)]">결제 이력이 없습니다</div>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                          <th className="text-left px-4 py-2 font-medium">라벨</th>
                          <th className="text-right px-4 py-2 font-medium">금액</th>
                          <th className="text-center px-4 py-2 font-medium">상태</th>
                          <th className="text-right px-4 py-2 font-medium">예정일</th>
                        </tr>
                      </thead>
                      <tbody>
                        {partnerPayments.map((p: any) => (
                          <tr key={p.id} className="border-b border-[var(--border)]/30">
                            <td className="px-4 py-2.5 text-sm">{p.label || "—"}</td>
                            <td className="px-4 py-2.5 text-sm text-right font-medium">{Number(p.amount || 0).toLocaleString()}원</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                p.status === "received" ? "bg-green-500/10 text-green-400"
                                : p.status === "overdue" ? "bg-red-500/10 text-red-400"
                                : "bg-yellow-500/10 text-yellow-400"
                              }`}>{p.status === "received" ? "수금완료" : p.status === "overdue" ? "연체" : "대기"}</span>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-right text-[var(--text-muted)]">{p.due_date || "—"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}

              {/* 문서 탭 */}
              {detailTab === "docs" && (
                <div>
                  {partnerDocs.length === 0 ? (
                    <div className="p-12 text-center text-sm text-[var(--text-muted)]">연결된 문서가 없습니다</div>
                  ) : (
                    <table className="w-full">
                      <thead>
                        <tr className="text-xs text-[var(--text-dim)] border-b border-[var(--border)]">
                          <th className="text-left px-4 py-2 font-medium">문서명</th>
                          <th className="text-center px-4 py-2 font-medium">상태</th>
                          <th className="text-right px-4 py-2 font-medium">생성일</th>
                        </tr>
                      </thead>
                      <tbody>
                        {partnerDocs.map((doc: any) => (
                          <tr key={doc.id} className="border-b border-[var(--border)]/30">
                            <td className="px-4 py-2.5 text-sm font-medium">{doc.title || "—"}</td>
                            <td className="px-4 py-2.5 text-center">
                              <span className={`text-xs px-2 py-0.5 rounded-full ${
                                doc.status === "approved" || doc.status === "signed" ? "bg-green-500/10 text-green-400"
                                : doc.status === "rejected" ? "bg-red-500/10 text-red-400"
                                : "bg-yellow-500/10 text-yellow-400"
                              }`}>{doc.status}</span>
                            </td>
                            <td className="px-4 py-2.5 text-xs text-right text-[var(--text-muted)]">{doc.created_at?.slice(0, 10)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={closeModal}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-[640px] max-h-[90vh] overflow-y-auto p-6 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-lg font-bold">{editingId ? "거래처 수정" : "새 거래처 등록"}</h2>
              <button onClick={closeModal} className="text-[var(--text-dim)] hover:text-[var(--text-main)] text-xl transition">✕</button>
            </div>
            <div className="grid grid-cols-2 gap-4 mb-4">
              <div>
                <label className={labelCls}>이름 *</label>
                <input value={form.name} onChange={(e) => setField("name", e.target.value)} placeholder="거래처명" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>구분 *</label>
                <select value={form.type} onChange={(e) => setField("type", e.target.value)} className={inputCls}>
                  <option value="vendor">공급업체</option>
                  <option value="client">고객사</option>
                  <option value="partner">파트너</option>
                  <option value="government">정부/공공기관</option>
                  <option value="other">기타</option>
                </select>
              </div>
              <div>
                <label className={labelCls}>분류</label>
                <input value={form.classification} onChange={(e) => setField("classification", e.target.value)} placeholder="예: 원자재, IT, 물류" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>사업자번호</label>
                <input value={form.businessNumber} onChange={(e) => setField("businessNumber", e.target.value)} placeholder="000-00-00000" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>대표자</label>
                <input value={form.representative} onChange={(e) => setField("representative", e.target.value)} placeholder="대표자명" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>담당자</label>
                <input value={form.contactName} onChange={(e) => setField("contactName", e.target.value)} placeholder="담당자명" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>이메일</label>
                <input type="email" value={form.contactEmail} onChange={(e) => setField("contactEmail", e.target.value)} placeholder="email@example.com" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>연락처</label>
                <input value={form.contactPhone} onChange={(e) => setField("contactPhone", e.target.value)} placeholder="010-0000-0000" className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>주소</label>
                <input value={form.address} onChange={(e) => setField("address", e.target.value)} placeholder="사업장 주소" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>은행명</label>
                <input value={form.bankName} onChange={(e) => setField("bankName", e.target.value)} placeholder="은행명" className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>계좌번호</label>
                <input value={form.accountNumber} onChange={(e) => setField("accountNumber", e.target.value)} placeholder="계좌번호" className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>태그 (쉼표 구분)</label>
                <input value={form.tags} onChange={(e) => setField("tags", e.target.value)} placeholder="예: VIP, 장기거래, 해외" className={inputCls} />
              </div>
              <div className="col-span-2">
                <label className={labelCls}>메모</label>
                <textarea value={form.notes} onChange={(e) => setField("notes", e.target.value)} rows={3} placeholder="특이사항, 메모..." className={inputCls + " resize-none"} />
              </div>
            </div>
            <div className="flex items-center justify-between pt-4 border-t border-[var(--border)]">
              <div>
                {editingId && (
                  <button onClick={() => { if (confirm("이 거래처를 삭제하시겠습니까?")) deleteMutation.mutate(editingId); }}
                    className="px-4 py-2 text-sm font-semibold text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-xl transition">
                    삭제
                  </button>
                )}
              </div>
              <div className="flex gap-2">
                <button onClick={closeModal}
                  className="px-4 py-2.5 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-main)] rounded-xl text-sm font-semibold transition hover:bg-[var(--border)]">
                  취소
                </button>
                <button onClick={() => form.name && saveMutation.mutate()} disabled={!form.name || saveMutation.isPending}
                  className="px-5 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
                  {saveMutation.isPending ? "저장 중..." : "저장"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
