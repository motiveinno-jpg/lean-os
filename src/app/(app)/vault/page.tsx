"use client";

import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import {
  getCurrentUser,
  getVaultSummary,
  createVaultAccount,
  createVaultAsset,
  createVaultDoc,
  updateVaultAccount,
  updateVaultAsset,
  updateVaultDoc,
  getDeals,
} from "@/lib/queries";
import { analyzeTransactionPatterns, saveDiscoveryResults, acceptDiscovery, dismissDiscovery } from "@/lib/auto-discovery";
import { uploadFile } from "@/lib/file-storage";

type Tab = "accounts" | "assets" | "docs" | "discovery";

function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}${abs.toLocaleString()}`;
}

const ACCOUNT_STATUS: Record<string, { label: string; color: string }> = {
  active: { label: "활성", color: "green" },
  paused: { label: "일시중지", color: "yellow" },
  cancelled: { label: "해지", color: "red" },
};

const ASSET_TYPES: Record<string, string> = {
  tangible: "유형자산",
  intangible: "무형자산",
};

const DOC_CATEGORIES: Record<string, string> = {
  license: "라이선스",
  certificate: "인증서",
  contract: "계약서",
  insurance: "보험",
};

export default function VaultPage() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>("accounts");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [fileUploading, setFileUploading] = useState(false);
  const queryClient = useQueryClient();

  // Account form
  const [accForm, setAccForm] = useState({
    serviceName: "", url: "", loginId: "", loginPassword: "", monthlyCost: "",
    paymentMethod: "", billingDay: "", renewalDate: "", notes: "",
  });
  // Asset form
  const [assetForm, setAssetForm] = useState({
    type: "tangible", name: "", purchaseDate: "", value: "", location: "", notes: "",
  });
  // Doc form
  const [docForm, setDocForm] = useState({
    category: "contract", name: "", fileUrl: "", linkedDealId: "", expiryDate: "", tags: "",
  });

  useEffect(() => {
    getCurrentUser().then((u) => { if (u) { setCompanyId(u.company_id); setUserId(u.id); } });
  }, []);

  const { data: vault } = useQuery({
    queryKey: ["vault-summary", companyId],
    queryFn: () => getVaultSummary(companyId!),
    enabled: !!companyId,
  });

  const { data: deals = [] } = useQuery({
    queryKey: ["deals", companyId],
    queryFn: () => getDeals(companyId!),
    enabled: !!companyId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["vault-summary"] });

  const createAccMut = useMutation({
    mutationFn: () => createVaultAccount({
      companyId: companyId!,
      serviceName: accForm.serviceName,
      url: accForm.url || undefined,
      loginId: accForm.loginId || undefined,
      loginPassword: accForm.loginPassword || undefined,
      monthlyCost: Number(accForm.monthlyCost) || 0,
      paymentMethod: accForm.paymentMethod || undefined,
      billingDay: accForm.billingDay ? Number(accForm.billingDay) : undefined,
      renewalDate: accForm.renewalDate || undefined,
      notes: accForm.notes || undefined,
    }),
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setEditingId(null);
      setAccForm({ serviceName: "", url: "", loginId: "", loginPassword: "", monthlyCost: "", paymentMethod: "", billingDay: "", renewalDate: "", notes: "" });
    },
  });

  const createAssetMut = useMutation({
    mutationFn: () => createVaultAsset({
      companyId: companyId!,
      type: assetForm.type,
      name: assetForm.name,
      purchaseDate: assetForm.purchaseDate || undefined,
      value: Number(assetForm.value) || 0,
      location: assetForm.location || undefined,
      notes: assetForm.notes || undefined,
    }),
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setEditingId(null);
      setAssetForm({ type: "tangible", name: "", purchaseDate: "", value: "", location: "", notes: "" });
    },
  });

  const createDocMut = useMutation({
    mutationFn: () => createVaultDoc({
      companyId: companyId!,
      category: docForm.category,
      name: docForm.name,
      fileUrl: docForm.fileUrl || undefined,
      linkedDealId: docForm.linkedDealId || undefined,
      expiryDate: docForm.expiryDate || undefined,
      tags: docForm.tags ? docForm.tags.split(",").map((t) => t.trim()) : undefined,
    }),
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setEditingId(null);
      setDocForm({ category: "contract", name: "", fileUrl: "", linkedDealId: "", expiryDate: "", tags: "" });
    },
  });

  const updateAccMut = useMutation({
    mutationFn: () => updateVaultAccount(editingId!, {
      service_name: accForm.serviceName,
      url: accForm.url || null,
      login_id: accForm.loginId || null,
      login_password: accForm.loginPassword || null,
      monthly_cost: Number(accForm.monthlyCost) || 0,
      payment_method: accForm.paymentMethod || null,
      billing_day: accForm.billingDay ? Number(accForm.billingDay) : null,
      renewal_date: accForm.renewalDate || null,
      notes: accForm.notes || null,
    }),
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setEditingId(null);
      setAccForm({ serviceName: "", url: "", loginId: "", loginPassword: "", monthlyCost: "", paymentMethod: "", billingDay: "", renewalDate: "", notes: "" });
    },
  });

  const updateAssetMut = useMutation({
    mutationFn: () => updateVaultAsset(editingId!, {
      type: assetForm.type,
      name: assetForm.name,
      purchase_date: assetForm.purchaseDate || null,
      value: Number(assetForm.value) || 0,
      location: assetForm.location || null,
      notes: assetForm.notes || null,
    }),
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setEditingId(null);
      setAssetForm({ type: "tangible", name: "", purchaseDate: "", value: "", location: "", notes: "" });
    },
  });

  const updateDocMut = useMutation({
    mutationFn: () => updateVaultDoc(editingId!, {
      category: docForm.category,
      name: docForm.name,
      file_url: docForm.fileUrl || null,
      linked_deal_id: docForm.linkedDealId || null,
      expiry_date: docForm.expiryDate || null,
      tags: docForm.tags ? docForm.tags.split(",").map((t: string) => t.trim()) : [],
    }),
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setEditingId(null);
      setDocForm({ category: "contract", name: "", fileUrl: "", linkedDealId: "", expiryDate: "", tags: "" });
    },
  });

  async function handleFileUpload(file: File) {
    if (!companyId || !userId) return;
    setFileUploading(true);
    try {
      const result = await uploadFile({
        companyId,
        bucket: "document-files",
        file,
        context: {},
        userId,
      });
      setDocForm((prev) => ({ ...prev, fileUrl: result.fileUrl }));
    } catch (err: any) {
      alert("파일 업로드 실패: " + (err?.message || "알 수 없는 오류"));
    } finally {
      setFileUploading(false);
    }
  }

  const runDiscMut = useMutation({
    mutationFn: async () => {
      const patterns = await analyzeTransactionPatterns(companyId!);
      if (patterns.length > 0) await saveDiscoveryResults(companyId!, patterns);
      return patterns;
    },
    onSuccess: () => invalidate(),
  });

  const acceptMut = useMutation({
    mutationFn: (id: string) => acceptDiscovery(id, companyId!),
    onSuccess: () => invalidate(),
  });

  const ignoreMut = useMutation({
    mutationFn: (id: string) => dismissDiscovery(id),
    onSuccess: () => invalidate(),
  });

  const cancelAccMut = useMutation({
    mutationFn: (id: string) => updateVaultAccount(id, { status: "cancelled" }),
    onSuccess: () => invalidate(),
  });

  const stats = vault?.stats || {
    activeSubscriptions: 0, totalMonthlyCost: 0, totalAssetValue: 0,
    totalDocs: 0, expiringDocsCount: 0, pendingDiscoveryCount: 0,
  };

  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "accounts", label: "구독/계정", count: vault?.accounts?.length || 0 },
    { key: "assets", label: "자산", count: vault?.assets?.length || 0 },
    { key: "docs", label: "문서", count: vault?.docs?.length || 0 },
    { key: "discovery", label: "자동 탐지", count: stats.pendingDiscoveryCount },
  ];

  return (
    <div className="max-w-[900px]">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">금고</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            구독/자산/문서 통합 관리 + AI 반복결제 자동 탐지
          </p>
        </div>
        <div className="flex gap-2">
          {tab === "discovery" && (
            <button
              onClick={() => runDiscMut.mutate()}
              disabled={runDiscMut.isPending}
              className="px-4 py-2.5 bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 rounded-xl text-sm font-semibold transition disabled:opacity-50"
            >
              {runDiscMut.isPending ? "분석 중..." : "패턴 분석 실행"}
            </button>
          )}
          {tab !== "discovery" && (
            <button
              onClick={() => { setShowForm(!showForm); setEditingId(null); if (tab === "accounts") setAccForm({ serviceName: "", url: "", loginId: "", loginPassword: "", monthlyCost: "", paymentMethod: "", billingDay: "", renewalDate: "", notes: "" }); if (tab === "assets") setAssetForm({ type: "tangible", name: "", purchaseDate: "", value: "", location: "", notes: "" }); if (tab === "docs") setDocForm({ category: "contract", name: "", fileUrl: "", linkedDealId: "", expiryDate: "", tags: "" }); }}
              className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition"
            >
              + 추가
            </button>
          )}
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3 mb-6">
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-1">구독 서비스</div>
          <div className="text-xl font-black">{stats.activeSubscriptions}개</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">월 {fmtW(stats.totalMonthlyCost)}원</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-1">자산 가치</div>
          <div className="text-xl font-black">{fmtW(stats.totalAssetValue)}원</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">{vault?.assets?.length || 0}건</div>
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-1">보관 문서</div>
          <div className="text-xl font-black">{stats.totalDocs}건</div>
          {stats.expiringDocsCount > 0 && (
            <div className="text-xs text-yellow-400 mt-1">만료 임박 {stats.expiringDocsCount}건</div>
          )}
        </div>
        <div className="bg-[var(--bg-card)] rounded-xl border border-[var(--border)] p-4">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-1">자동 탐지</div>
          <div className={`text-xl font-black ${stats.pendingDiscoveryCount > 0 ? "text-purple-400" : ""}`}>
            {stats.pendingDiscoveryCount}건
          </div>
          <div className="text-xs text-[var(--text-muted)] mt-1">검토 대기</div>
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--bg-surface)] rounded-xl p-1 mb-4">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => { setTab(t.key); setShowForm(false); setEditingId(null); }}
            className={`flex-1 py-2 rounded-lg text-xs font-semibold transition-all ${
              tab === t.key
                ? "bg-[var(--primary)] text-white"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.label} ({t.count})
          </button>
        ))}
      </div>

      {/* ── Account Form ── */}
      {showForm && tab === "accounts" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-4">
          <h3 className="text-sm font-bold mb-4">{editingId ? "구독/계정 수정" : "구독/계정 추가"}</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">서비스명 *</label>
              <input value={accForm.serviceName} onChange={(e) => setAccForm({ ...accForm, serviceName: e.target.value })}
                placeholder="예: Notion, AWS" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">URL</label>
              <input value={accForm.url} onChange={(e) => setAccForm({ ...accForm, url: e.target.value })}
                placeholder="https://..." className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">월 비용 (원)</label>
              <input type="number" value={accForm.monthlyCost} onChange={(e) => setAccForm({ ...accForm, monthlyCost: e.target.value })}
                placeholder="0" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">로그인 ID</label>
              <input value={accForm.loginId} onChange={(e) => setAccForm({ ...accForm, loginId: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">비밀번호</label>
              <input type="password" value={accForm.loginPassword} onChange={(e) => setAccForm({ ...accForm, loginPassword: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">결제수단</label>
              <select value={accForm.paymentMethod} onChange={(e) => setAccForm({ ...accForm, paymentMethod: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                <option value="">선택</option>
                <option value="법인카드">법인카드</option>
                <option value="계좌이체">계좌이체</option>
                <option value="자동이체">자동이체</option>
                <option value="자동결제">자동결제 (카드)</option>
                <option value="기타">기타</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">자동결제일 (매월)</label>
              <select value={accForm.billingDay} onChange={(e) => setAccForm({ ...accForm, billingDay: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                <option value="">해당없음</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}일</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">갱신일</label>
              <input type="date" value={accForm.renewalDate} onChange={(e) => setAccForm({ ...accForm, renewalDate: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { if (!accForm.serviceName) return; if (editingId) updateAccMut.mutate(); else createAccMut.mutate(); }} disabled={!accForm.serviceName || createAccMut.isPending || updateAccMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">{editingId ? "저장" : "추가"}</button>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* ── Asset Form ── */}
      {showForm && tab === "assets" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-4">
          <h3 className="text-sm font-bold mb-4">{editingId ? "자산 수정" : "자산 추가"}</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">자산명 *</label>
              <input value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
                placeholder="예: MacBook Pro, 특허권" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">유형</label>
              <select value={assetForm.type} onChange={(e) => setAssetForm({ ...assetForm, type: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                <option value="tangible">유형자산</option>
                <option value="intangible">무형자산</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">가치 (원)</label>
              <input type="number" value={assetForm.value} onChange={(e) => setAssetForm({ ...assetForm, value: e.target.value })}
                placeholder="0" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">취득일</label>
              <input type="date" value={assetForm.purchaseDate} onChange={(e) => setAssetForm({ ...assetForm, purchaseDate: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">위치/보관</label>
              <input value={assetForm.location} onChange={(e) => setAssetForm({ ...assetForm, location: e.target.value })}
                placeholder="사무실 / 클라우드" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">메모</label>
              <input value={assetForm.notes} onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { if (!assetForm.name) return; if (editingId) updateAssetMut.mutate(); else createAssetMut.mutate(); }} disabled={!assetForm.name || createAssetMut.isPending || updateAssetMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">{editingId ? "저장" : "추가"}</button>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* ── Doc Form ── */}
      {showForm && tab === "docs" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6 mb-4">
          <h3 className="text-sm font-bold mb-4">{editingId ? "문서 수정" : "문서 추가"}</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">문서명 *</label>
              <input value={docForm.name} onChange={(e) => setDocForm({ ...docForm, name: e.target.value })}
                placeholder="예: 사업자등록증" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">카테고리</label>
              <select value={docForm.category} onChange={(e) => setDocForm({ ...docForm, category: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                <option value="license">라이선스</option>
                <option value="certificate">인증서</option>
                <option value="contract">계약서</option>
                <option value="insurance">보험</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">연결 딜</label>
              <select value={docForm.linkedDealId} onChange={(e) => setDocForm({ ...docForm, linkedDealId: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                <option value="">선택 안함</option>
                {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">만료일</label>
              <input type="date" value={docForm.expiryDate} onChange={(e) => setDocForm({ ...docForm, expiryDate: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">태그 (쉼표 구분)</label>
              <input value={docForm.tags} onChange={(e) => setDocForm({ ...docForm, tags: e.target.value })}
                placeholder="세무, 법인" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div className="col-span-3">
              <label className="block text-xs text-[var(--text-muted)] mb-1">파일 첨부</label>
              <div className="flex items-center gap-3">
                <label className="px-4 py-2.5 bg-[var(--bg-surface)] border border-[var(--border)] rounded-xl text-sm cursor-pointer hover:border-[var(--primary)] transition inline-flex items-center gap-2">
                  <span>{fileUploading ? "업로드 중..." : "파일 선택"}</span>
                  <input
                    type="file"
                    className="hidden"
                    disabled={fileUploading}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) handleFileUpload(file);
                      e.target.value = "";
                    }}
                    accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.jpg,.jpeg,.png,.gif,.csv,.txt,.zip"
                  />
                </label>
                {docForm.fileUrl && (
                  <a href={docForm.fileUrl} target="_blank" rel="noopener noreferrer"
                    className="text-xs text-[var(--primary)] hover:underline truncate max-w-[300px]">
                    {docForm.fileUrl.split("/").pop() || "업로드된 파일"}
                  </a>
                )}
              </div>
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { if (!docForm.name) return; if (editingId) updateDocMut.mutate(); else createDocMut.mutate(); }} disabled={!docForm.name || createDocMut.isPending || updateDocMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">{editingId ? "저장" : "추가"}</button>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* ═══ Accounts Tab ═══ */}
      {tab === "accounts" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {!vault?.accounts?.length ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">🔐</div>
              <div className="text-lg font-bold mb-2">구독/계정이 없습니다</div>
              <div className="text-sm text-[var(--text-muted)]">SaaS 구독, 서비스 계정을 등록하여 비용을 관리하세요</div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left p-4 text-xs text-[var(--text-dim)] font-medium">서비스</th>
                  <th className="text-right p-4 text-xs text-[var(--text-dim)] font-medium">월 비용</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">결제수단</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">갱신일</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">상태</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">출처</th>
                  <th className="p-4"></th>
                </tr>
              </thead>
              <tbody>
                {vault.accounts.map((acc: any) => {
                  const st = ACCOUNT_STATUS[acc.status || "active"] || ACCOUNT_STATUS.active;
                  return (
                    <tr key={acc.id} className="border-b border-[var(--border)]/30 hover:bg-[var(--bg-surface)] transition cursor-pointer" onClick={() => { setEditingId(acc.id); setAccForm({ serviceName: acc.service_name || "", url: acc.url || "", loginId: acc.login_id || "", loginPassword: acc.login_password || "", monthlyCost: String(acc.monthly_cost || ""), paymentMethod: acc.payment_method || "", billingDay: acc.billing_day ? String(acc.billing_day) : "", renewalDate: acc.renewal_date || "", notes: acc.notes || "" }); setShowForm(true); }}>
                      <td className="p-4">
                        <div className="font-semibold">{acc.service_name}</div>
                        {acc.url && <div className="text-[10px] text-[var(--text-dim)] truncate max-w-[200px]">{acc.url}</div>}
                      </td>
                      <td className="p-4 text-right font-bold mono-number">
                        {(acc.monthly_cost || 0).toLocaleString()}원
                      </td>
                      <td className="p-4 text-center text-xs text-[var(--text-muted)]">
                        <div>{acc.payment_method || "—"}</div>
                        {acc.billing_day && <div className="text-[10px] text-[var(--text-dim)]">매월 {acc.billing_day}일</div>}
                      </td>
                      <td className="p-4 text-center text-xs text-[var(--text-muted)]">
                        {acc.renewal_date ? new Date(acc.renewal_date).toLocaleDateString("ko") : "—"}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full bg-${st.color}-500/10 text-${st.color}-400`}>
                          {st.label}
                        </span>
                      </td>
                      <td className="p-4 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                          acc.source === "auto_discovered"
                            ? "bg-purple-500/10 text-purple-400"
                            : "bg-gray-500/10 text-gray-400"
                        }`}>
                          {acc.source === "auto_discovered" ? "AI탐지" : "수동"}
                        </span>
                      </td>
                      <td className="p-4 text-right">
                        {acc.status === "active" && (
                          <button onClick={(e) => { e.stopPropagation(); cancelAccMut.mutate(acc.id); }}
                            className="text-[10px] text-red-400 hover:text-red-300 transition">해지</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ═══ Assets Tab ═══ */}
      {tab === "assets" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {!vault?.assets?.length ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">📦</div>
              <div className="text-lg font-bold mb-2">자산이 없습니다</div>
              <div className="text-sm text-[var(--text-muted)]">유형/무형 자산을 등록하세요</div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left p-4 text-xs text-[var(--text-dim)] font-medium">자산명</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">유형</th>
                  <th className="text-right p-4 text-xs text-[var(--text-dim)] font-medium">가치</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">위치</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">취득일</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {vault.assets.map((a: any) => (
                  <tr key={a.id} className="border-b border-[var(--border)]/30 hover:bg-[var(--bg-surface)] transition cursor-pointer" onClick={() => { setEditingId(a.id); setAssetForm({ type: a.type || "tangible", name: a.name || "", purchaseDate: a.purchase_date || "", value: String(a.value || ""), location: a.location || "", notes: a.notes || "" }); setShowForm(true); }}>
                    <td className="p-4">
                      <div className="font-semibold">{a.name}</div>
                      {a.notes && <div className="text-[10px] text-[var(--text-dim)]">{a.notes}</div>}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        a.type === "tangible" ? "bg-blue-500/10 text-blue-400" : "bg-purple-500/10 text-purple-400"
                      }`}>
                        {ASSET_TYPES[a.type] || a.type}
                      </span>
                    </td>
                    <td className="p-4 text-right font-bold mono-number">{(a.value || 0).toLocaleString()}원</td>
                    <td className="p-4 text-center text-xs text-[var(--text-muted)]">{a.location || "—"}</td>
                    <td className="p-4 text-center text-xs text-[var(--text-muted)]">
                      {a.purchase_date ? new Date(a.purchase_date).toLocaleDateString("ko") : "—"}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        a.status === "in_use" ? "bg-green-500/10 text-green-400" :
                        a.status === "disposed" ? "bg-red-500/10 text-red-400" :
                        "bg-gray-500/10 text-gray-400"
                      }`}>
                        {a.status === "in_use" ? "사용중" : a.status === "disposed" ? "처분" : a.status || "—"}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ═══ Docs Tab ═══ */}
      {tab === "docs" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {!vault?.docs?.length ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">📄</div>
              <div className="text-lg font-bold mb-2">보관 문서가 없습니다</div>
              <div className="text-sm text-[var(--text-muted)]">중요 문서를 안전하게 보관하세요</div>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left p-4 text-xs text-[var(--text-dim)] font-medium">문서명</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">카테고리</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">연결 딜</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">만료일</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">태그</th>
                </tr>
              </thead>
              <tbody>
                {vault.docs.map((d: any) => {
                  const isExpiring = d.expiry_date && ((new Date(d.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) <= 30;
                  return (
                    <tr key={d.id} className="border-b border-[var(--border)]/30 hover:bg-[var(--bg-surface)] transition cursor-pointer" onClick={() => { setEditingId(d.id); setDocForm({ category: d.category || "contract", name: d.name || "", fileUrl: d.file_url || "", linkedDealId: d.linked_deal_id || "", expiryDate: d.expiry_date || "", tags: (d.tags || []).join(", ") }); setShowForm(true); }}>
                      <td className="p-4">
                        <div className="font-semibold">{d.name}</div>
                      </td>
                      <td className="p-4 text-center">
                        <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400">
                          {DOC_CATEGORIES[d.category] || d.category}
                        </span>
                      </td>
                      <td className="p-4 text-center text-xs text-[var(--text-muted)]">
                        {d.deals?.name || "—"}
                      </td>
                      <td className={`p-4 text-center text-xs ${isExpiring ? "text-yellow-400 font-semibold" : "text-[var(--text-muted)]"}`}>
                        {d.expiry_date ? new Date(d.expiry_date).toLocaleDateString("ko") : "—"}
                        {isExpiring && " ⚠"}
                      </td>
                      <td className="p-4 text-center">
                        <div className="flex gap-1 justify-center flex-wrap">
                          {(d.tags || []).map((tag: string, i: number) => (
                            <span key={i} className="text-[9px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)]">
                              {tag}
                            </span>
                          ))}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ═══ Discovery Tab ═══ */}
      {tab === "discovery" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          {!vault?.pendingDiscoveries?.length && !(vault as any)?.discovery?.length ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">🔍</div>
              <div className="text-lg font-bold mb-2">탐지된 패턴이 없습니다</div>
              <div className="text-sm text-[var(--text-muted)] mb-4">
                거래내역에서 반복 결제 패턴을 자동으로 찾아드립니다
              </div>
              <button
                onClick={() => runDiscMut.mutate()}
                disabled={runDiscMut.isPending}
                className="px-6 py-3 bg-purple-500/10 text-purple-400 border border-purple-500/20 hover:bg-purple-500/20 rounded-xl text-sm font-semibold transition disabled:opacity-50"
              >
                {runDiscMut.isPending ? "분석 중..." : "지금 분석 실행"}
              </button>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]/50">
              {(vault?.pendingDiscoveries || []).map((d: any) => (
                <div key={d.id} className="p-5 flex items-center justify-between">
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-xl bg-purple-500/10 flex items-center justify-center">
                      <span className="text-sm">🔍</span>
                    </div>
                    <div>
                      <div className="font-semibold text-sm">{d.name}</div>
                      <div className="text-[10px] text-[var(--text-dim)] mt-0.5">
                        {d.suggested_type}
                        {" · "}
                        {d.pattern_description}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <div className="text-right mr-4">
                      <div className="text-sm font-bold mono-number text-purple-400">
                        월 {(d.estimated_monthly_cost || 0).toLocaleString()}원
                      </div>
                    </div>
                    <button
                      onClick={() => acceptMut.mutate(d.id)}
                      disabled={acceptMut.isPending}
                      className="px-3 py-1.5 bg-green-500/10 text-green-400 rounded-lg text-xs font-semibold hover:bg-green-500/20 transition disabled:opacity-50"
                    >
                      수락
                    </button>
                    <button
                      onClick={() => ignoreMut.mutate(d.id)}
                      disabled={ignoreMut.isPending}
                      className="px-3 py-1.5 bg-red-500/10 text-red-400 rounded-lg text-xs font-semibold hover:bg-red-500/20 transition disabled:opacity-50"
                    >
                      무시
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
