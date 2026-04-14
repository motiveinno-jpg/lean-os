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

// ── CSV 파서 (간단한 RFC4180 호환, "" 이스케이프 + 줄바꿈 안의 따옴표 처리) ──
function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let field = "", row: string[] = [], inQuote = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuote) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuote = false;
      } else field += c;
    } else {
      if (c === '"') inQuote = true;
      else if (c === ',') { row.push(field); field = ""; }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ""; }
      else if (c === '\r') { /* skip */ }
      else field += c;
    }
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(cell => cell.trim().length > 0));
}

const CSV_FIELD_MAP: Record<string, string> = {
  "이름": "name", "name": "name", "거래처명": "name",
  "구분": "type", "type": "type",
  "분류": "classification", "classification": "classification",
  "사업자번호": "businessNumber", "business_number": "businessNumber", "businessnumber": "businessNumber",
  "대표자": "representative", "representative": "representative",
  "담당자": "contactName", "contact_name": "contactName", "contactname": "contactName",
  "이메일": "contactEmail", "contact_email": "contactEmail", "contactemail": "contactEmail", "email": "contactEmail",
  "연락처": "contactPhone", "contact_phone": "contactPhone", "contactphone": "contactPhone", "phone": "contactPhone",
  "주소": "address", "address": "address",
  "은행명": "bankName", "bank_name": "bankName", "bankname": "bankName",
  "계좌번호": "accountNumber", "account_number": "accountNumber", "accountnumber": "accountNumber",
  "태그": "tags", "tags": "tags",
  "메모": "notes", "notes": "notes",
};

const TYPE_LABEL_TO_VALUE: Record<string, string> = {
  "공급업체": "vendor", "vendor": "vendor",
  "고객사": "client", "client": "client",
  "파트너": "partner", "partner": "partner",
  "정부": "government", "정부/공공기관": "government", "government": "government",
  "기타": "other", "other": "other",
};

// ── 관계점수: 0~100 (딜수, 계약총액, 최근 커뮤니케이션, 결제 이행률 가중) ──
function calcRelationshipScore(opts: { dealCount: number; contractTotal: number; lastCommDaysAgo: number | null; paidRatio: number; }): { score: number; tier: 'A' | 'B' | 'C' | 'D'; color: string; bg: string } {
  let score = 0;
  // 딜 수: 최대 30점 (5건 이상이면 만점)
  score += Math.min(opts.dealCount * 6, 30);
  // 계약 총액: 최대 30점 (1억 이상 만점)
  score += Math.min(Math.floor(opts.contractTotal / 100_000_000 * 30), 30);
  // 최근 커뮤니케이션: 최대 25점 (7일 내 만점, 90일 초과 0점)
  if (opts.lastCommDaysAgo !== null) {
    if (opts.lastCommDaysAgo <= 7) score += 25;
    else if (opts.lastCommDaysAgo <= 30) score += 18;
    else if (opts.lastCommDaysAgo <= 90) score += 10;
  }
  // 결제 이행률: 최대 15점
  score += Math.round(opts.paidRatio * 15);
  score = Math.max(0, Math.min(100, score));
  const tier: 'A' | 'B' | 'C' | 'D' = score >= 75 ? 'A' : score >= 50 ? 'B' : score >= 25 ? 'C' : 'D';
  const palette = {
    A: { color: 'text-emerald-400', bg: 'bg-emerald-500/15' },
    B: { color: 'text-blue-400', bg: 'bg-blue-500/15' },
    C: { color: 'text-yellow-400', bg: 'bg-yellow-500/15' },
    D: { color: 'text-gray-400', bg: 'bg-gray-500/15' },
  };
  return { score, tier, ...palette[tier] };
}

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
  const [detailTab, setDetailTab] = useState<"info" | "deals" | "payments" | "docs" | "comms" | "timeline">("info");
  const [importPreview, setImportPreview] = useState<any[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [showCommForm, setShowCommForm] = useState(false);
  const [commForm, setCommForm] = useState({ type: "phone" as string, summary: "", notes: "" });
  const [tagFilter, setTagFilter] = useState<string>("");
  const [classFilter, setClassFilter] = useState<string>("");
  const [regionFilter, setRegionFilter] = useState<string>("");
  const [sizeFilter, setSizeFilter] = useState<string>("");
  const [bizVerifyResults, setBizVerifyResults] = useState<Record<string, { status: string; loading: boolean }>>({});

  function parseRegion(address?: string | null): string {
    if (!address) return "";
    const first = address.trim().split(/\s+/)[0] || "";
    const map: Record<string, string> = {
      "서울특별시": "서울", "서울시": "서울", "서울": "서울",
      "부산광역시": "부산", "부산시": "부산", "부산": "부산",
      "인천광역시": "인천", "인천시": "인천", "인천": "인천",
      "대구광역시": "대구", "대구시": "대구", "대구": "대구",
      "대전광역시": "대전", "대전시": "대전", "대전": "대전",
      "광주광역시": "광주", "광주시": "광주", "광주": "광주",
      "울산광역시": "울산", "울산시": "울산", "울산": "울산",
      "세종특별자치시": "세종", "세종": "세종",
      "경기도": "경기", "경기": "경기",
      "강원도": "강원", "강원특별자치도": "강원", "강원": "강원",
      "충청북도": "충북", "충북": "충북", "충청남도": "충남", "충남": "충남",
      "전라북도": "전북", "전북": "전북", "전북특별자치도": "전북",
      "전라남도": "전남", "전남": "전남",
      "경상북도": "경북", "경북": "경북", "경상남도": "경남", "경남": "경남",
      "제주특별자치도": "제주", "제주도": "제주", "제주": "제주",
    };
    return map[first] || first;
  }

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

  const { data: rawPartners = [], isLoading, error: mainError, refetch: mainRefetch } = useQuery({
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

  // 파트너별 거래 규모 집계 (전체 딜 합계)
  const { data: partnerTotals = {} } = useQuery<Record<string, number>>({
    queryKey: ["partner-totals", companyId],
    queryFn: async () => {
      if (!companyId) return {};
      const { data } = await (supabase as any).from("deals")
        .select("partner_id, contract_total")
        .eq("company_id", companyId)
        .not("partner_id", "is", null);
      const map: Record<string, number> = {};
      for (const d of (data || [])) {
        if (!d.partner_id) continue;
        map[d.partner_id] = (map[d.partner_id] || 0) + Number(d.contract_total || 0);
      }
      return map;
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });

  // 클라이언트측 필터: 산업/지역/거래규모
  const partners = (rawPartners as any[]).filter((p: any) => {
    if (classFilter && (p.classification || "").trim() !== classFilter) return false;
    if (regionFilter && parseRegion(p.address) !== regionFilter) return false;
    if (sizeFilter) {
      const total = partnerTotals[p.id] || 0;
      if (sizeFilter === "none" && total > 0) return false;
      if (sizeFilter === "lt1000" && !(total > 0 && total < 10_000_000)) return false;
      if (sizeFilter === "1k_10k" && !(total >= 10_000_000 && total < 100_000_000)) return false;
      if (sizeFilter === "gte10k" && !(total >= 100_000_000)) return false;
    }
    return true;
  });

  // 산업/지역 드롭다운 옵션 — rawPartners에서 뽑음
  const classOptions = Array.from(new Set((rawPartners as any[]).map((p: any) => (p.classification || "").trim()).filter(Boolean))).sort();
  const regionOptions = Array.from(new Set((rawPartners as any[]).map((p: any) => parseRegion(p.address)).filter(Boolean))).sort();

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

  // 커뮤니케이션 로그
  const { data: partnerComms = [] } = useQuery({
    queryKey: ["partner-comms", detailPartner?.id],
    queryFn: async () => {
      if (!detailPartner) return [];
      const { data } = await (supabase as any).from("partner_communications")
        .select("id, comm_type, summary, notes, comm_date, created_at")
        .eq("partner_id", detailPartner.id)
        .order("comm_date", { ascending: false });
      return data || [];
    },
    enabled: !!detailPartner?.id,
  });

  const addCommMutation = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("partner_communications").insert({
        partner_id: detailPartner.id,
        company_id: companyId,
        comm_type: commForm.type,
        summary: commForm.summary,
        notes: commForm.notes || null,
        comm_date: new Date().toISOString(),
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partner-comms", detailPartner?.id] });
      setCommForm({ type: "phone", summary: "", notes: "" });
      setShowCommForm(false);
    },
  });

  const deleteCommMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from("partner_communications").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["partner-comms", detailPartner?.id] });
    },
  });

  const COMM_TYPE_LABEL: Record<string, string> = {
    phone: "전화",
    email: "이메일",
    meeting: "미팅",
    other: "기타",
  };

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

  // CSV 임포트: 파일 → 파싱 → 미리보기 (실제 저장은 confirm 시점)
  const handleCSVFile = useCallback(async (file: File) => {
    setImportError(null);
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length < 2) { setImportError("헤더 + 1행 이상이 필요합니다"); return; }
      const headers = rows[0].map(h => h.trim().toLowerCase());
      const fieldKeys = headers.map(h => CSV_FIELD_MAP[h] || CSV_FIELD_MAP[h.replace(/\s+/g, "")] || null);
      if (!fieldKeys.includes("name")) { setImportError("'이름' 또는 'name' 컬럼이 필수입니다"); return; }
      const preview = rows.slice(1).map((row) => {
        const obj: any = { type: "client" };
        row.forEach((cell, i) => {
          const key = fieldKeys[i];
          if (!key) return;
          const value = cell.trim();
          if (!value) return;
          if (key === "type") obj.type = TYPE_LABEL_TO_VALUE[value.toLowerCase()] || TYPE_LABEL_TO_VALUE[value] || "client";
          else if (key === "tags") obj.tags = value.split(/[,;|]/).map(t => t.trim()).filter(Boolean);
          else obj[key] = value;
        });
        return obj;
      }).filter((o: any) => o.name);
      if (preview.length === 0) { setImportError("유효한 행이 없습니다"); return; }
      setImportPreview(preview);
    } catch (err: any) {
      setImportError(err?.message || "CSV 파싱 실패");
    }
  }, []);

  const confirmImport = useCallback(async () => {
    if (!importPreview || !companyId) return;
    setImporting(true);
    try {
      // 직렬 처리(에러 추적 용이) — 행 수가 많지 않은 일반 CRM 사용처를 가정
      for (const row of importPreview) {
        await upsertPartner({
          companyId, name: row.name, type: row.type || "client",
          classification: row.classification || undefined,
          businessNumber: row.businessNumber || undefined,
          representative: row.representative || undefined,
          contactName: row.contactName || undefined,
          contactEmail: row.contactEmail || undefined,
          contactPhone: row.contactPhone || undefined,
          address: row.address || undefined,
          bankName: row.bankName || undefined,
          accountNumber: row.accountNumber || undefined,
          tags: row.tags || [],
          notes: row.notes || undefined,
        });
      }
      setImportPreview(null);
      qc.invalidateQueries({ queryKey: ["partners"] });
    } catch (err: any) {
      setImportError(`저장 실패: ${err?.message || "오류"}`);
    }
    setImporting(false);
  }, [importPreview, companyId, qc]);

  const downloadCSVTemplate = useCallback(() => {
    const headers = ["이름", "구분", "분류", "사업자번호", "대표자", "담당자", "이메일", "연락처", "주소", "은행명", "계좌번호", "태그", "메모"];
    const sample = ["예시상사", "client", "원자재", "123-45-67890", "홍길동", "김담당", "kim@example.com", "010-1234-5678", "서울시 강남구", "신한은행", "110-123-456789", "VIP, 장기거래", "주력 고객"];
    const csv = [headers, sample].map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `거래처_템플릿.csv`;
    a.click(); URL.revokeObjectURL(url);
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
          <button onClick={downloadCSVTemplate}
            className="px-3 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-surface)] text-[var(--text-muted)] rounded-xl text-xs font-semibold transition"
            title="CSV 템플릿 다운로드">
            템플릿
          </button>
          <label className="px-4 py-2.5 bg-[var(--bg-card)] border border-[var(--border)] hover:bg-[var(--bg-surface)] text-[var(--text-main)] rounded-xl text-sm font-semibold transition cursor-pointer">
            CSV 임포트
            <input type="file" accept=".csv,text/csv" className="hidden"
              onChange={(e) => { const f = e.target.files?.[0]; if (f) handleCSVFile(f); e.currentTarget.value = ""; }} />
          </label>
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
        <span className="text-xs text-[var(--text-dim)]">{partners.length}건{partners.length !== (rawPartners as any[]).length && `/${(rawPartners as any[]).length}`}</span>
      </div>

      {/* 고급 필터 바 — 산업/지역/거래규모 */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <span className="text-xs text-[var(--text-dim)]">필터:</span>
        <select value={classFilter} onChange={(e) => setClassFilter(e.target.value)}
          className="px-2.5 py-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]">
          <option value="">산업 전체</option>
          {classOptions.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
        <select value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}
          className="px-2.5 py-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]">
          <option value="">지역 전체</option>
          {regionOptions.map((r) => <option key={r} value={r}>{r}</option>)}
        </select>
        <select value={sizeFilter} onChange={(e) => setSizeFilter(e.target.value)}
          className="px-2.5 py-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]">
          <option value="">거래규모 전체</option>
          <option value="gte10k">1억 이상 (VIP)</option>
          <option value="1k_10k">1천만~1억</option>
          <option value="lt1000">~1천만</option>
          <option value="none">거래 없음</option>
        </select>
        {(classFilter || regionFilter || sizeFilter) && (
          <button onClick={() => { setClassFilter(""); setRegionFilter(""); setSizeFilter(""); }}
            className="text-xs text-[var(--text-dim)] hover:text-[var(--text-main)] transition underline">필터 초기화</button>
        )}
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
                    <tr key={p.id} onClick={() => { setDetailPartner(p); setDetailTab("info"); setShowCommForm(false); }}
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
      {detailPartner && (() => {
        const dealCount = partnerDeals.length;
        const contractTotal = partnerDeals.reduce((s: number, d: any) => s + Number(d.contract_total || 0), 0);
        const lastCommDate = partnerComms[0]?.comm_date ? new Date(partnerComms[0].comm_date) : null;
        const lastCommDaysAgo = lastCommDate ? Math.floor((Date.now() - lastCommDate.getTime()) / (1000 * 60 * 60 * 24)) : null;
        const totalPayments = partnerPayments.length || 0;
        const paidCount = partnerPayments.filter((p: any) => p.status === "received").length;
        const paidRatio = totalPayments > 0 ? paidCount / totalPayments : 0;
        const rs = calcRelationshipScore({ dealCount, contractTotal, lastCommDaysAgo, paidRatio });

        // 타임라인 머지: deals(생성), payments(due/received), comms(comm_date)
        type TimelineItem = { date: string; kind: 'deal' | 'payment' | 'comm'; title: string; sub?: string; amount?: number; status?: string };
        const timeline: TimelineItem[] = [
          ...partnerDeals.map((d: any) => ({ date: d.created_at, kind: 'deal' as const, title: d.name, sub: `상태: ${d.status || '—'}`, amount: Number(d.contract_total || 0), status: d.status })),
          ...partnerPayments.map((p: any) => ({ date: p.due_date || p.created_at, kind: 'payment' as const, title: p.label || '결제', amount: Number(p.amount || 0), status: p.status })),
          ...partnerComms.map((c: any) => ({ date: c.comm_date || c.created_at, kind: 'comm' as const, title: c.summary, sub: COMM_TYPE_LABEL[c.comm_type] || c.comm_type })),
        ].filter(t => t.date).sort((a, b) => (a.date < b.date ? 1 : -1));

        return (
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
                    <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${rs.bg} ${rs.color}`} title={`딜 ${dealCount}건 / 계약 ${contractTotal.toLocaleString()}원 / 최근 소통 ${lastCommDaysAgo === null ? '없음' : lastCommDaysAgo + '일전'} / 결제이행 ${(paidRatio * 100).toFixed(0)}%`}>
                      관계점수 {rs.score} · {rs.tier}
                    </span>
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
                {detailPartner.contact_email && (
                  <a href={`mailto:${detailPartner.contact_email}`}
                    className="px-3 py-1.5 text-xs bg-blue-500/10 border border-blue-500/30 text-blue-400 rounded-lg hover:bg-blue-500/20 transition flex items-center gap-1"
                    title={detailPartner.contact_email}>
                    ✉️ 이메일
                  </a>
                )}
                {detailPartner.contact_phone && (
                  <a href={`tel:${detailPartner.contact_phone}`}
                    className="px-3 py-1.5 text-xs bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 rounded-lg hover:bg-emerald-500/20 transition flex items-center gap-1"
                    title={detailPartner.contact_phone}>
                    📞 전화
                  </a>
                )}
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
                { key: "timeline" as const, label: `타임라인 (${timeline.length})` },
                { key: "deals" as const, label: `딜 (${partnerDeals.length})` },
                { key: "payments" as const, label: `결제 (${partnerPayments.length})` },
                { key: "docs" as const, label: `문서 (${partnerDocs.length})` },
                { key: "comms" as const, label: `커뮤니케이션 (${partnerComms.length})` },
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

              {/* 타임라인 탭 — 모든 활동 시간순 머지 */}
              {detailTab === "timeline" && (
                <div>
                  {timeline.length === 0 ? (
                    <div className="p-12 text-center text-sm text-[var(--text-muted)]">활동 내역이 없습니다</div>
                  ) : (
                    <div className="relative pl-8">
                      <div className="absolute left-3 top-2 bottom-2 w-0.5 bg-[var(--border)]" />
                      <div className="space-y-4">
                        {timeline.map((t, i) => {
                          const palette = t.kind === 'deal'
                            ? { dot: 'bg-blue-500', icon: '📋', tag: 'bg-blue-500/10 text-blue-400', label: '딜' }
                            : t.kind === 'payment'
                            ? { dot: t.status === 'received' ? 'bg-green-500' : t.status === 'overdue' ? 'bg-red-500' : 'bg-yellow-500', icon: '💰', tag: 'bg-purple-500/10 text-purple-400', label: '결제' }
                            : { dot: 'bg-emerald-500', icon: '💬', tag: 'bg-emerald-500/10 text-emerald-400', label: '소통' };
                          return (
                            <div key={i} className="relative">
                              <div className={`absolute -left-[22px] top-2 w-3 h-3 rounded-full ${palette.dot} ring-2 ring-[var(--bg-card)]`} />
                              <div className="bg-[var(--bg-surface)] rounded-xl p-3 border border-[var(--border)]/50">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${palette.tag}`}>{palette.icon} {palette.label}</span>
                                  <span className="text-xs text-[var(--text-dim)]">{(t.date || '').slice(0, 10)}</span>
                                </div>
                                <div className="text-sm font-medium">{t.title}</div>
                                {t.sub && <div className="text-xs text-[var(--text-muted)] mt-0.5">{t.sub}</div>}
                                {typeof t.amount === 'number' && t.amount > 0 && (
                                  <div className="text-xs font-semibold text-[var(--primary)] mt-1">{t.amount.toLocaleString()}원</div>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
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

              {/* 커뮤니케이션 로그 탭 */}
              {detailTab === "comms" && (
                <div>
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-[var(--text-main)]">커뮤니케이션 로그</h3>
                    <button
                      onClick={() => setShowCommForm(!showCommForm)}
                      className="px-3 py-1.5 text-xs bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-lg font-semibold transition">
                      {showCommForm ? "취소" : "+ 새 기록 추가"}
                    </button>
                  </div>

                  {showCommForm && (
                    <div className="bg-[var(--bg-surface)] rounded-xl p-4 mb-4 border border-[var(--border)]">
                      <div className="grid grid-cols-2 gap-3 mb-3">
                        <div>
                          <label className={labelCls}>유형 *</label>
                          <select
                            value={commForm.type}
                            onChange={(e) => setCommForm((prev) => ({ ...prev, type: e.target.value }))}
                            className={inputCls}>
                            <option value="phone">전화</option>
                            <option value="email">이메일</option>
                            <option value="meeting">미팅</option>
                            <option value="other">기타</option>
                          </select>
                        </div>
                        <div>
                          <label className={labelCls}>요약 *</label>
                          <input
                            value={commForm.summary}
                            onChange={(e) => setCommForm((prev) => ({ ...prev, summary: e.target.value }))}
                            placeholder="커뮤니케이션 요약"
                            className={inputCls}
                          />
                        </div>
                      </div>
                      <div className="mb-3">
                        <label className={labelCls}>상세 메모</label>
                        <textarea
                          value={commForm.notes}
                          onChange={(e) => setCommForm((prev) => ({ ...prev, notes: e.target.value }))}
                          rows={3}
                          placeholder="상세 내용..."
                          className={inputCls + " resize-none"}
                        />
                      </div>
                      <div className="flex justify-end">
                        <button
                          onClick={() => commForm.summary && addCommMutation.mutate()}
                          disabled={!commForm.summary || addCommMutation.isPending}
                          className="px-4 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-lg text-sm font-semibold transition disabled:opacity-50">
                          {addCommMutation.isPending ? "저장 중..." : "저장"}
                        </button>
                      </div>
                    </div>
                  )}

                  {partnerComms.length === 0 ? (
                    <div className="p-12 text-center text-sm text-[var(--text-muted)]">커뮤니케이션 기록이 없습니다</div>
                  ) : (
                    <div className="space-y-3">
                      {partnerComms.map((c: any) => {
                        const typeLabel = COMM_TYPE_LABEL[c.comm_type] || c.comm_type;
                        const typeBadge = c.comm_type === "phone" ? "bg-blue-500/10 text-blue-400"
                          : c.comm_type === "email" ? "bg-purple-500/10 text-purple-400"
                          : c.comm_type === "meeting" ? "bg-green-500/10 text-green-400"
                          : "bg-gray-500/10 text-gray-400";
                        return (
                          <div key={c.id} className="bg-[var(--bg-surface)] rounded-xl p-4 border border-[var(--border)]/50">
                            <div className="flex items-start justify-between gap-3">
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2 mb-1">
                                  <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${typeBadge}`}>{typeLabel}</span>
                                  <span className="text-xs text-[var(--text-dim)]">{c.comm_date?.slice(0, 10)}</span>
                                </div>
                                <div className="text-sm font-medium mb-1">{c.summary}</div>
                                {c.notes && (
                                  <div className="text-xs text-[var(--text-muted)] whitespace-pre-wrap">{c.notes}</div>
                                )}
                              </div>
                              <button
                                onClick={() => { if (confirm("이 기록을 삭제하시겠습니까?")) deleteCommMutation.mutate(c.id); }}
                                className="text-xs text-[var(--text-dim)] hover:text-red-400 transition shrink-0"
                                title="삭제">
                                삭제
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
        );
      })()}

      {/* CSV Import Preview Modal */}
      {(importPreview || importError) && (
        <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => { if (!importing) { setImportPreview(null); setImportError(null); } }}>
          <div className="bg-[var(--bg-card)] border border-[var(--border)] rounded-2xl w-full max-w-[800px] max-h-[85vh] overflow-hidden flex flex-col shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--border)]">
              <div>
                <h2 className="text-lg font-bold">CSV 임포트 미리보기</h2>
                <p className="text-xs text-[var(--text-muted)] mt-0.5">{importPreview ? `${importPreview.length}건 가져옵니다` : "오류"}</p>
              </div>
              <button onClick={() => { if (!importing) { setImportPreview(null); setImportError(null); } }}
                className="text-[var(--text-dim)] hover:text-[var(--text-main)] text-xl transition">✕</button>
            </div>
            {importError && (
              <div className="mx-6 mt-4 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">{importError}</div>
            )}
            {importPreview && (
              <div className="flex-1 overflow-auto px-6 py-4">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-[var(--text-dim)] border-b border-[var(--border)]">
                      <th className="text-left px-2 py-2 font-medium">이름</th>
                      <th className="text-left px-2 py-2 font-medium">구분</th>
                      <th className="text-left px-2 py-2 font-medium">사업자번호</th>
                      <th className="text-left px-2 py-2 font-medium">담당자</th>
                      <th className="text-left px-2 py-2 font-medium">이메일</th>
                      <th className="text-left px-2 py-2 font-medium">태그</th>
                    </tr>
                  </thead>
                  <tbody>
                    {importPreview.slice(0, 50).map((r: any, i: number) => (
                      <tr key={i} className="border-b border-[var(--border)]/30">
                        <td className="px-2 py-1.5 font-medium">{r.name}</td>
                        <td className="px-2 py-1.5">{TYPE_BADGE[r.type]?.label || r.type}</td>
                        <td className="px-2 py-1.5 text-[var(--text-muted)]">{r.businessNumber || "—"}</td>
                        <td className="px-2 py-1.5">{r.contactName || "—"}</td>
                        <td className="px-2 py-1.5 text-[var(--text-muted)]">{r.contactEmail || "—"}</td>
                        <td className="px-2 py-1.5 text-[var(--text-muted)]">{(r.tags || []).join(", ") || "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {importPreview.length > 50 && (
                  <div className="text-xs text-[var(--text-dim)] text-center mt-3">… 외 {importPreview.length - 50}건 (저장 시 모두 처리)</div>
                )}
              </div>
            )}
            {importPreview && (
              <div className="flex justify-end gap-2 px-6 py-4 border-t border-[var(--border)]">
                <button onClick={() => setImportPreview(null)} disabled={importing}
                  className="px-4 py-2 bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-main)] rounded-xl text-sm font-semibold hover:bg-[var(--border)] transition disabled:opacity-50">
                  취소
                </button>
                <button onClick={confirmImport} disabled={importing}
                  className="px-5 py-2 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
                  {importing ? `저장 중... (${importPreview.length}건)` : `${importPreview.length}건 저장`}
                </button>
              </div>
            )}
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
