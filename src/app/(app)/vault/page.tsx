"use client";

import { useEffect, useState } from "react";
import { DateField } from "@/components/date-field";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTabParam } from "@/lib/use-tab-param";
import { friendlyError } from "@/lib/friendly-error";
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
  deleteVaultAsset,
  deleteVaultDoc,
  getDeals,
} from "@/lib/queries";
import { decryptCredential } from "@/lib/crypto";
import { analyzeTransactionPatterns, saveDiscoveryResults, acceptDiscovery, dismissDiscovery } from "@/lib/auto-discovery";
import { uploadFile, openStoredFile } from "@/lib/file-storage";
import { useToast } from "@/components/toast";
import { CurrencyInput } from "@/components/currency-input";
import { QueryErrorBanner } from "@/components/query-status";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";

type Tab = "accounts" | "assets" | "docs" | "discovery";

function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}${abs.toLocaleString()}`;
}

// 2026-05-22 정액법 감가상각 장부가. 내용연수·취득일 없으면 취득가 유지(감가 미설정).
function computeBookValue(value: number, purchaseDate: string | null | undefined, usefulLifeMonths: number | null | undefined): { book: number; depreciated: boolean } {
  const v = Number(value || 0);
  if (!usefulLifeMonths || usefulLifeMonths <= 0 || !purchaseDate) return { book: v, depreciated: false };
  const start = new Date(purchaseDate).getTime();
  if (isNaN(start)) return { book: v, depreciated: false };
  const monthsElapsed = Math.max(0, (Date.now() - start) / (1000 * 60 * 60 * 24 * 30.44));
  const ratio = Math.min(monthsElapsed / usefulLifeMonths, 1);
  return { book: Math.max(Math.round(v * (1 - ratio)), 0), depreciated: true };
}

const ACCOUNT_STATUS: Record<string, { label: string; color: string; bg: string; text: string }> = {
  active: { label: "활성", color: "green", bg: "bg-green-500/10", text: "text-green-400" },
  paused: { label: "일시중지", color: "yellow", bg: "bg-yellow-500/10", text: "text-yellow-400" },
  cancelled: { label: "해지", color: "red", bg: "bg-red-500/10", text: "text-red-400" },
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
  const { role } = useUser();
  if (role !== "owner") {
    return <AccessDenied detail="보관함(중요 자료)은 대표 계정 전용입니다." />;
  }
  const { toast } = useToast();
  const router = useRouter();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [tab, setTab] = useTabParam<Tab>("assets", { valid: ["accounts", "assets", "docs", "discovery"] });
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
    type: "tangible", name: "", purchaseDate: "", value: "", location: "", notes: "", usefulLifeMonths: "", attachmentUrl: "",
  });
  // Doc form
  const [docForm, setDocForm] = useState({
    category: "contract", name: "", fileUrl: "", linkedDealId: "", expiryDate: "", tags: "",
  });

  useEffect(() => {
    getCurrentUser().then((u) => { if (u) { setCompanyId(u.company_id); setUserId(u.id); } });
  }, []);

  const { data: vault, error: mainError, refetch: mainRefetch } = useQuery({
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
      serviceName: accForm.serviceName.trim(),
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
    onError: (err: any) => toast(`계정 추가 실패: ${err.message || err}`, "error"),
  });

  const createAssetMut = useMutation({
    mutationFn: () => createVaultAsset({
      companyId: companyId!,
      type: assetForm.type,
      name: assetForm.name.trim(),
      purchaseDate: assetForm.purchaseDate || undefined,
      value: Number(assetForm.value) || 0,
      location: assetForm.location || undefined,
      notes: assetForm.notes || undefined,
      usefulLifeMonths: assetForm.usefulLifeMonths ? Number(assetForm.usefulLifeMonths) : undefined,
      attachmentUrl: assetForm.attachmentUrl || undefined,
    }),
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setEditingId(null);
      setAssetForm({ type: "tangible", name: "", purchaseDate: "", value: "", location: "", notes: "", usefulLifeMonths: "", attachmentUrl: "" });
    },
    onError: (err: any) => toast(`자산 추가 실패: ${err.message || err}`, "error"),
  });

  const createDocMut = useMutation({
    mutationFn: () => createVaultDoc({
      companyId: companyId!,
      category: docForm.category,
      name: docForm.name.trim(),
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
    onError: (err: any) => toast(`문서 추가 실패: ${err.message || err}`, "error"),
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
    onError: (err: any) => toast(`계정 수정 실패: ${err.message || err}`, "error"),
  });

  const updateAssetMut = useMutation({
    mutationFn: () => updateVaultAsset(editingId!, {
      type: assetForm.type,
      name: assetForm.name,
      purchase_date: assetForm.purchaseDate || null,
      value: Number(assetForm.value) || 0,
      location: assetForm.location || null,
      notes: assetForm.notes || null,
      useful_life_months: assetForm.usefulLifeMonths ? Number(assetForm.usefulLifeMonths) : null,
      attachment_url: assetForm.attachmentUrl || null,
    }),
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setEditingId(null);
      setAssetForm({ type: "tangible", name: "", purchaseDate: "", value: "", location: "", notes: "", usefulLifeMonths: "", attachmentUrl: "" });
    },
    onError: (err: any) => toast(`자산 수정 실패: ${err.message || err}`, "error"),
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
    onError: (err: any) => toast(`문서 수정 실패: ${err.message || err}`, "error"),
  });

  const deleteAssetMut = useMutation({
    mutationFn: (id: string) => deleteVaultAsset(id),
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setEditingId(null);
    },
    onError: (err: any) => toast(`자산 삭제 실패: ${err.message || err}`, "error"),
  });

  const deleteDocMut = useMutation({
    mutationFn: (id: string) => deleteVaultDoc(id),
    onSuccess: () => {
      invalidate();
      setShowForm(false);
      setEditingId(null);
    },
    onError: (err: any) => toast(`문서 삭제 실패: ${err.message || err}`, "error"),
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
      toast("파일 업로드 실패: " + (friendlyError(err, "알 수 없는 오류")), "error");
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
    onError: (err: any) => toast("패턴 분석 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const acceptMut = useMutation({
    mutationFn: (id: string) => acceptDiscovery(id, companyId!),
    onSuccess: () => invalidate(),
    onError: (err: any) => toast("발견 항목 수락 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const ignoreMut = useMutation({
    mutationFn: (id: string) => dismissDiscovery(id),
    onSuccess: () => invalidate(),
    onError: (err: any) => toast("발견 항목 무시 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const cancelAccMut = useMutation({
    mutationFn: (id: string) => updateVaultAccount(id, { status: "cancelled" }),
    onSuccess: () => invalidate(),
    onError: (err: any) => toast("계정 해지 실패: " + (friendlyError(err, "알 수 없는 오류")), "error"),
  });

  const stats = vault?.stats || {
    activeSubscriptions: 0, totalMonthlyCost: 0, totalAssetValue: 0,
    totalDocs: 0, expiringDocsCount: 0, pendingDiscoveryCount: 0,
  };

  // ── 사용량 추적 (localStorage 기반) ──
  // { [accountId]: { lastOpenedAt: ISO, opens: [{ at, by }], seats: number, usedSeats: number } }
  const usageKey = companyId ? `vault:usage:${companyId}` : "";
  const [usage, setUsage] = useState<Record<string, { lastOpenedAt?: string; opens?: { at: string; by?: string }[]; seats?: number; usedSeats?: number }>>({});
  const [showAccessLogId, setShowAccessLogId] = useState<string | null>(null);
  const [showUnusedOnly, setShowUnusedOnly] = useState(false);

  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { setShowAccessLogId(null); setShowForm(false); }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, []);

  useEffect(() => {
    if (!usageKey) return;
    try { setUsage(JSON.parse(localStorage.getItem(usageKey) || "{}")); } catch { setUsage({}); }
  }, [usageKey]);

  const persistUsage = (next: typeof usage) => {
    setUsage(next);
    if (usageKey) { try { localStorage.setItem(usageKey, JSON.stringify(next)); } catch { /* ignore */ } }
  };

  const recordOpen = (accountId: string, accountUrl?: string) => {
    const now = new Date().toISOString();
    const cur = usage[accountId] || {};
    const opens = [...(cur.opens || []), { at: now, by: userId || undefined }].slice(-50);
    persistUsage({ ...usage, [accountId]: { ...cur, lastOpenedAt: now, opens } });
    if (accountUrl) {
      try { window.open(accountUrl, "_blank", "noopener,noreferrer"); } catch { /* ignore */ }
    }
  };

  const setSeats = (accountId: string, field: "seats" | "usedSeats", value: number) => {
    const cur = usage[accountId] || {};
    persistUsage({ ...usage, [accountId]: { ...cur, [field]: value } });
  };

  // 미사용 분석
  const UNUSED_DAYS = 30;
  const now = Date.now();
  const DAY = 1000 * 60 * 60 * 24;
  const unusedAccounts = (vault?.accounts || []).filter((a: any) => {
    if (a.status !== "active") return false;
    const lastOpen = usage[a.id]?.lastOpenedAt;
    if (!lastOpen) return true; // 아예 한 번도 안 열림
    const days = (now - new Date(lastOpen).getTime()) / DAY;
    return days >= UNUSED_DAYS;
  });
  const unusedMonthlyCost = unusedAccounts.reduce((s: number, a: any) => s + Number(a.monthly_cost || 0), 0);

  // ── Renewal alert analysis ──
  const accounts: any[] = vault?.accounts || [];
  const docs: any[] = vault?.docs || [];

  type AlertLevel = "critical" | "warning" | "info";
  interface RenewalAlert {
    id: string;
    level: AlertLevel;
    title: string;
    subtitle: string;
    daysLeft: number;
    kind: "account" | "doc";
    targetId: string;
  }

  const renewalAlerts: RenewalAlert[] = [];
  accounts.forEach((a) => {
    if (a.status !== "active" || !a.renewal_date) return;
    const days = Math.round((new Date(a.renewal_date).getTime() - now) / DAY);
    if (days > 30 || days < -3) return;
    renewalAlerts.push({
      id: `acc-${a.id}`,
      level: days < 0 ? "critical" : days <= 7 ? "critical" : days <= 14 ? "warning" : "info",
      title: a.service_name || "이름 없음",
      subtitle: days < 0
        ? `${Math.abs(days)}일 전 갱신 예정이었음 — 상태 확인 필요`
        : days === 0
        ? "오늘 갱신"
        : `${days}일 후 갱신 · 월 ${fmtW(a.monthly_cost || 0)}원`,
      daysLeft: days,
      kind: "account",
      targetId: a.id,
    });
  });
  docs.forEach((d) => {
    if (!d.expiry_date) return;
    const days = Math.round((new Date(d.expiry_date).getTime() - now) / DAY);
    if (days > 30 || days < -3) return;
    renewalAlerts.push({
      id: `doc-${d.id}`,
      level: days < 0 ? "critical" : days <= 7 ? "critical" : days <= 14 ? "warning" : "info",
      title: d.name || "문서",
      subtitle: days < 0
        ? `${Math.abs(days)}일 전 만료됨`
        : days === 0
        ? "오늘 만료"
        : `${days}일 후 만료 · ${DOC_CATEGORIES[d.category] || d.category || "문서"}`,
      daysLeft: days,
      kind: "doc",
      targetId: d.id,
    });
  });
  renewalAlerts.sort((a, b) => a.daysLeft - b.daysLeft);

  // ── Duplicate subscription detection ──
  const normalize = (s: string) =>
    (s || "").toLowerCase().replace(/\s+/g, "").replace(/[-_.]/g, "").replace(/(pro|plus|team|enterprise|business|personal|프로|팀|비즈니스)$/i, "");
  const groups = new Map<string, any[]>();
  accounts.filter((a) => a.status === "active").forEach((a) => {
    const key = normalize(a.service_name);
    if (!key) return;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(a);
  });
  const duplicateGroups = Array.from(groups.values()).filter((g) => g.length > 1);
  const duplicateWaste = duplicateGroups.reduce((sum, g) => {
    const sorted = [...g].sort((x, y) => (y.monthly_cost || 0) - (x.monthly_cost || 0));
    return sum + sorted.slice(1).reduce((s, a) => s + (a.monthly_cost || 0), 0);
  }, 0);

  const [showAlerts, setShowAlerts] = useState(true);
  const [dismissedAlerts, setDismissedAlerts] = useState<Set<string>>(new Set());
  const visibleAlerts = renewalAlerts.filter((a) => !dismissedAlerts.has(a.id));

  // 2026-05-22 자산 전용으로 축소 — 구독/계정·문서 탭은 /subscriptions 통합 화면으로 이동(PR3).
  //   자동 탐지는 자산 관련 발견만 (구독 발견은 구독 화면에서).
  const TABS: { key: Tab; label: string; count: number }[] = [
    { key: "assets", label: "자산", count: vault?.assets?.length || 0 },
    { key: "discovery", label: "자동 탐지", count: stats.pendingDiscoveryCount },
  ];

  if (!companyId) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;

  return (
    <div className="">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      {/* Header */}
      <div className="page-sticky-header flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-extrabold">자산 관리</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            회사 유형/무형 자산 대장 — 감가상각 장부가 + 자동 탐지 (구독은 구독 메뉴에서)
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
              onClick={() => { setShowForm(!showForm); setEditingId(null); if (tab === "accounts") setAccForm({ serviceName: "", url: "", loginId: "", loginPassword: "", monthlyCost: "", paymentMethod: "", billingDay: "", renewalDate: "", notes: "" }); if (tab === "assets") setAssetForm({ type: "tangible", name: "", purchaseDate: "", value: "", location: "", notes: "", usefulLifeMonths: "", attachmentUrl: "" }); if (tab === "docs") setDocForm({ category: "contract", name: "", fileUrl: "", linkedDealId: "", expiryDate: "", tags: "" }); }}
              className="px-4 py-2.5 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition"
            >
              + 추가
            </button>
          )}
        </div>
      </div>

      {/* ── Renewal & Duplicate Alerts ── */}
      {showAlerts && (visibleAlerts.length > 0 || duplicateGroups.length > 0) && (
        <div className="mb-5 space-y-2">
          {visibleAlerts.length > 0 && (
            <div className={`rounded-xl border p-4 ${
              visibleAlerts.some((a) => a.level === "critical")
                ? "bg-red-500/5 border-red-500/30"
                : "bg-yellow-500/5 border-yellow-500/30"
            }`}>
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="flex items-center gap-2">
                  <span className="text-base">🔔</span>
                  <div>
                    <div className="text-sm font-bold">
                      갱신/만료 예정 {visibleAlerts.length}건
                    </div>
                    <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                      30일 이내 갱신되거나 만료되는 항목입니다
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setShowAlerts(false)}
                  className="text-[10px] text-[var(--text-dim)] hover:text-[var(--text)] transition"
                >
                  모두 접기
                </button>
              </div>
              <div className="space-y-1.5 max-h-[260px] overflow-y-auto">
                {visibleAlerts.slice(0, 8).map((alert) => {
                  const levelColor =
                    alert.level === "critical" ? "text-red-400 bg-red-500/10" :
                    alert.level === "warning" ? "text-yellow-400 bg-yellow-500/10" :
                    "text-blue-400 bg-blue-500/10";
                  return (
                    <div
                      key={alert.id}
                      className="flex items-center justify-between gap-3 px-3 py-2 bg-[var(--bg-card)] rounded-lg border border-[var(--border)]/50"
                    >
                      <div className="flex items-center gap-3 min-w-0 flex-1">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold shrink-0 ${levelColor}`}>
                          {alert.daysLeft < 0 ? `D+${Math.abs(alert.daysLeft)}` : `D-${alert.daysLeft}`}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-semibold truncate">{alert.title}</div>
                          <div className="text-[10px] text-[var(--text-muted)] truncate">{alert.subtitle}</div>
                        </div>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => {
                            // 2026-05-22 구독/계정 발견은 /subscriptions 통합 화면으로, 그 외(문서 등)는 자산 탭.
                            if (alert.kind === "account") {
                              router.push("/subscriptions");
                              return;
                            }
                            setTab("assets");
                            setTimeout(() => {
                              const row = document.getElementById(`vault-row-${alert.targetId}`);
                              if (row) {
                                row.scrollIntoView({ behavior: "smooth", block: "center" });
                                row.classList.add("ring-2", "ring-[var(--primary)]");
                                setTimeout(() => row.classList.remove("ring-2", "ring-[var(--primary)]"), 2000);
                              }
                            }, 100);
                          }}
                          className="text-[10px] px-2 py-1 bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20 rounded transition font-medium"
                        >
                          이동
                        </button>
                        <button
                          onClick={() => setDismissedAlerts((prev) => new Set(prev).add(alert.id))}
                          className="text-[10px] px-2 py-1 text-[var(--text-dim)] hover:text-[var(--text-muted)] transition"
                          title="접기"
                        >
                          ×
                        </button>
                      </div>
                    </div>
                  );
                })}
                {visibleAlerts.length > 8 && (
                  <div className="text-[10px] text-[var(--text-dim)] text-center py-1">
                    외 {visibleAlerts.length - 8}건 더
                  </div>
                )}
              </div>
            </div>
          )}
          {duplicateGroups.length > 0 && (
            <div className="rounded-xl border border-purple-500/30 bg-purple-500/5 p-4">
              <div className="flex items-center gap-2 mb-3">
                <span className="text-base">🔍</span>
                <div>
                  <div className="text-sm font-bold">중복 구독 의심 {duplicateGroups.length}건</div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                    유사한 서비스에 월 <span className="font-semibold text-purple-400">{fmtW(duplicateWaste)}원</span> 중복 지출 가능성
                  </div>
                </div>
              </div>
              <div className="space-y-2">
                {duplicateGroups.map((group, gi) => (
                  <div key={gi} className="bg-[var(--bg-card)] rounded-lg border border-[var(--border)]/50 p-3">
                    <div className="text-[10px] text-[var(--text-muted)] mb-1.5">
                      유사 서비스 {group.length}개 그룹
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {group.map((a: any) => (
                        <div
                          key={a.id}
                          className="flex items-center gap-2 px-2.5 py-1 bg-[var(--bg-surface)] rounded-md text-xs"
                        >
                          <span className="font-semibold">{a.service_name}</span>
                          <span className="text-[10px] text-[var(--text-muted)]">
                            월 {(a.monthly_cost || 0).toLocaleString()}원
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
      {!showAlerts && (visibleAlerts.length > 0 || duplicateGroups.length > 0) && (
        <button
          onClick={() => setShowAlerts(true)}
          className="mb-4 text-[11px] text-[var(--text-muted)] hover:text-[var(--text)] transition flex items-center gap-1"
        >
          🔔 알림 {visibleAlerts.length + duplicateGroups.length}건 펼치기
        </button>
      )}

      {/* 미사용 구독 경고 */}
      {tab === "accounts" && unusedAccounts.length > 0 && (
        <div className="rounded-xl border border-orange-500/30 bg-orange-500/5 p-4 mb-4">
          <div className="flex items-center justify-between gap-3 flex-wrap">
            <div className="flex items-center gap-3">
              <span className="text-base">💤</span>
              <div>
                <div className="text-sm font-bold">{UNUSED_DAYS}일 이상 미사용 구독 {unusedAccounts.length}건</div>
                <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                  월 <span className="font-semibold text-orange-400">{fmtW(unusedMonthlyCost)}원</span> 절감 가능 — 해지 검토 권장
                </div>
              </div>
            </div>
            <button
              onClick={() => setShowUnusedOnly(!showUnusedOnly)}
              className="text-[10px] px-3 py-1.5 bg-orange-500/10 hover:bg-orange-500/20 text-orange-400 rounded-md font-semibold transition border border-orange-500/30"
            >
              {showUnusedOnly ? "전체 보기" : "미사용만 필터"}
            </button>
          </div>
        </div>
      )}

      {/* Summary Cards — 자산 관리 스코프(자산·자동탐지)만. 구독은 '구독' 메뉴, 문서는 '파일보관함'으로 이동(2026-05-22)했으므로 제외해 혼란 방지. */}
      <div className="grid grid-cols-2 gap-3 mb-6">
        <div className="glass-card p-4">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider mb-1">자산 가치</div>
          <div className="text-xl font-black">{fmtW(stats.totalAssetValue)}원</div>
          <div className="text-xs text-[var(--text-muted)] mt-1">{vault?.assets?.length || 0}건</div>
        </div>
        <div className="glass-card p-4">
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
        <div className="glass-card p-6 mb-4">
          <h3 className="section-title">{editingId ? "구독/계정 수정" : "구독/계정 추가"}</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">서비스명 *</label>
              <input value={accForm.serviceName} onChange={(e) => setAccForm({ ...accForm, serviceName: e.target.value })}
                placeholder="예: Notion, AWS" className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">URL</label>
              <input value={accForm.url} onChange={(e) => setAccForm({ ...accForm, url: e.target.value })}
                placeholder="https://..." className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">월 비용 (원)</label>
              <CurrencyInput value={accForm.monthlyCost} onValueChange={(raw) => setAccForm({ ...accForm, monthlyCost: raw })}
                placeholder="0" className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">로그인 ID</label>
              <input value={accForm.loginId} onChange={(e) => setAccForm({ ...accForm, loginId: e.target.value })}
                className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">비밀번호</label>
              <input type="password" value={accForm.loginPassword} onChange={(e) => setAccForm({ ...accForm, loginPassword: e.target.value })}
                className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">결제수단</label>
              <select value={accForm.paymentMethod} onChange={(e) => setAccForm({ ...accForm, paymentMethod: e.target.value })}
                className="field-input">
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
                className="field-input">
                <option value="">해당없음</option>
                {Array.from({ length: 31 }, (_, i) => i + 1).map((d) => (
                  <option key={d} value={d}>{d}일</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">갱신일</label>
              <DateField value={accForm.renewalDate} onChange={(e) => setAccForm({ ...accForm, renewalDate: e.target.value })}
                className="field-input" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { if (!accForm.serviceName.trim()) return; if (editingId) updateAccMut.mutate(); else createAccMut.mutate(); }} disabled={!accForm.serviceName.trim() || createAccMut.isPending || updateAccMut.isPending}
              className="btn-primary">{editingId ? "저장" : "추가"}</button>
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* ── Asset Form ── */}
      {showForm && tab === "assets" && (
        <div className="glass-card p-6 mb-4">
          <h3 className="section-title">{editingId ? "자산 수정" : "자산 추가"}</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">자산명 *</label>
              <input value={assetForm.name} onChange={(e) => setAssetForm({ ...assetForm, name: e.target.value })}
                placeholder="예: MacBook Pro, 특허권" className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">유형</label>
              <select value={assetForm.type} onChange={(e) => setAssetForm({ ...assetForm, type: e.target.value })}
                className="field-input">
                <option value="tangible">유형자산</option>
                <option value="intangible">무형자산</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">가치 (원)</label>
              <CurrencyInput value={assetForm.value} onValueChange={(raw) => setAssetForm({ ...assetForm, value: raw })}
                placeholder="0" className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">취득일</label>
              <DateField value={assetForm.purchaseDate} onChange={(e) => setAssetForm({ ...assetForm, purchaseDate: e.target.value })}
                className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">위치/보관</label>
              <input value={assetForm.location} onChange={(e) => setAssetForm({ ...assetForm, location: e.target.value })}
                placeholder="사무실 / 클라우드" className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">내용연수 (개월)</label>
              <input type="number" min={0} value={assetForm.usefulLifeMonths} onChange={(e) => setAssetForm({ ...assetForm, usefulLifeMonths: e.target.value })}
                placeholder="예: 60 (5년) · 비우면 감가 미적용" className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">메모</label>
              <input value={assetForm.notes} onChange={(e) => setAssetForm({ ...assetForm, notes: e.target.value })}
                className="field-input" />
            </div>
            <div className="col-span-3">
              <label className="block text-xs text-[var(--text-muted)] mb-1">증빙 문서 (영수증·계약서 등)</label>
              {assetForm.attachmentUrl ? (
                <div className="flex items-center gap-2">
                  <a href={assetForm.attachmentUrl} target="_blank" rel="noreferrer" className="text-xs text-[var(--primary)] hover:underline truncate flex-1">📎 첨부된 문서 보기</a>
                  <button type="button" onClick={() => setAssetForm({ ...assetForm, attachmentUrl: "" })} className="text-[10px] text-red-400 hover:underline">제거</button>
                </div>
              ) : (
                <input type="file" disabled={fileUploading}
                  onChange={async (e) => {
                    const f = e.target.files?.[0];
                    if (!f || !companyId || !userId) return;
                    setFileUploading(true);
                    try {
                      const res = await uploadFile({ companyId, bucket: "company-assets", file: f, userId });
                      setAssetForm((prev) => ({ ...prev, attachmentUrl: res.fileUrl }));
                    } catch (err) { toast(`업로드 실패: ${friendlyError(err, "파일 업로드 실패")}`, "error"); }
                    setFileUploading(false);
                  }}
                  className="w-full text-xs text-[var(--text-muted)] file:mr-2 file:px-3 file:py-1.5 file:rounded-lg file:border-0 file:bg-[var(--bg-surface)] file:text-[var(--text)] file:text-xs" />
              )}
              {fileUploading && <div className="text-[10px] text-[var(--text-dim)] mt-1">업로드 중...</div>}
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { if (!assetForm.name.trim()) return; if (editingId) updateAssetMut.mutate(); else createAssetMut.mutate(); }} disabled={!assetForm.name.trim() || createAssetMut.isPending || updateAssetMut.isPending}
              className="btn-primary">{editingId ? "저장" : "추가"}</button>
            {editingId && <button onClick={() => { if (confirm("이 자산을 삭제하시겠습니까?")) deleteAssetMut.mutate(editingId); }} disabled={deleteAssetMut.isPending}
              className="px-4 py-2 bg-red-500/10 text-red-500 rounded-lg text-sm font-semibold disabled:opacity-50">삭제</button>}
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* ── Doc Form ── */}
      {showForm && tab === "docs" && (
        <div className="glass-card p-6 mb-4">
          <h3 className="section-title">{editingId ? "문서 수정" : "문서 추가"}</h3>
          <div className="grid grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">문서명 *</label>
              <input value={docForm.name} onChange={(e) => setDocForm({ ...docForm, name: e.target.value })}
                placeholder="예: 사업자등록증" className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">카테고리</label>
              <select value={docForm.category} onChange={(e) => setDocForm({ ...docForm, category: e.target.value })}
                className="field-input">
                <option value="license">라이선스</option>
                <option value="certificate">인증서</option>
                <option value="contract">계약서</option>
                <option value="insurance">보험</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">연결 프로젝트</label>
              <select value={docForm.linkedDealId} onChange={(e) => setDocForm({ ...docForm, linkedDealId: e.target.value })}
                className="field-input">
                <option value="">선택 안함</option>
                {deals.map((d: any) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">만료일</label>
              <DateField value={docForm.expiryDate} onChange={(e) => setDocForm({ ...docForm, expiryDate: e.target.value })}
                className="field-input" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">태그 (쉼표 구분)</label>
              <input value={docForm.tags} onChange={(e) => setDocForm({ ...docForm, tags: e.target.value })}
                placeholder="세무, 법인" className="field-input" />
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
            <button onClick={() => { if (!docForm.name.trim()) return; if (editingId) updateDocMut.mutate(); else createDocMut.mutate(); }} disabled={!docForm.name.trim() || createDocMut.isPending || updateDocMut.isPending}
              className="btn-primary">{editingId ? "저장" : "추가"}</button>
            {editingId && <button onClick={() => { if (confirm("이 문서를 삭제하시겠습니까?")) deleteDocMut.mutate(editingId); }} disabled={deleteDocMut.isPending}
              className="px-4 py-2 bg-red-500/10 text-red-500 rounded-lg text-sm font-semibold disabled:opacity-50">삭제</button>}
            <button onClick={() => { setShowForm(false); setEditingId(null); }} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* ═══ Accounts Tab ═══ */}
      {tab === "accounts" && (
        <div className="glass-card overflow-x-auto">
          {!vault?.accounts?.length ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">🔐</div>
              <div className="text-sm font-medium text-[var(--text)]">구독 서비스와 공용 계정을 등록하세요</div>
              <div className="text-xs text-[var(--text-muted)] mt-1">SaaS 구독, 서비스 계정을 등록하여 비용을 관리하세요</div>
              <button onClick={() => { setTab("accounts"); setShowForm(true); }} className="mt-4 px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold hover:opacity-90">+ 계정 추가</button>
            </div>
          ) : (
            <table className="w-full text-sm min-w-[700px]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left p-4 text-xs text-[var(--text-dim)] font-medium">서비스</th>
                  <th className="text-right p-4 text-xs text-[var(--text-dim)] font-medium">월 비용</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">사용 좌석</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">마지막 사용</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">갱신일</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">상태</th>
                  <th className="p-4"></th>
                </tr>
              </thead>
              <tbody>
                {vault.accounts
                  .filter((acc: any) => !showUnusedOnly || unusedAccounts.some((u: any) => u.id === acc.id))
                  .map((acc: any) => {
                  const st = ACCOUNT_STATUS[acc.status || "active"] || ACCOUNT_STATUS.active;
                  const u = usage[acc.id] || {};
                  const lastOpenDays = u.lastOpenedAt ? Math.floor((now - new Date(u.lastOpenedAt).getTime()) / DAY) : null;
                  const isUnused = unusedAccounts.some((x: any) => x.id === acc.id);
                  const seatPct = u.seats && u.seats > 0 ? Math.min(100, Math.round(((u.usedSeats || 0) / u.seats) * 100)) : null;
                  return (
                    <tr id={`vault-row-${acc.id}`} key={acc.id} className="border-b border-[var(--border)]/30 hover:bg-[var(--bg-surface)] transition cursor-pointer" onClick={async () => {
                      setEditingId(acc.id);
                      // Decrypt the password if it's stored encrypted
                      let plainPassword = "";
                      if (acc.encrypted_password) {
                        try {
                          plainPassword = (await decryptCredential(acc.encrypted_password)) || "";
                        } catch {
                          plainPassword = "";
                        }
                      } else if (acc.login_password && acc.login_password !== "***encrypted***") {
                        plainPassword = acc.login_password;
                      }
                      setAccForm({ serviceName: acc.service_name || "", url: acc.url || "", loginId: acc.login_id || "", loginPassword: plainPassword, monthlyCost: String(acc.monthly_cost || ""), paymentMethod: acc.payment_method || "", billingDay: acc.billing_day ? String(acc.billing_day) : "", renewalDate: acc.renewal_date || "", notes: acc.notes || "" }); setShowForm(true); }}>
                      <td className="p-4">
                        <div className="font-semibold">{acc.service_name}</div>
                        {acc.url && <div className="text-[10px] text-[var(--text-dim)] truncate max-w-[200px]">{acc.url}</div>}
                      </td>
                      <td className="p-4 text-right font-bold mono-number">
                        {(acc.monthly_cost || 0).toLocaleString()}원
                        <div className="text-[10px] text-[var(--text-dim)] font-normal">{acc.payment_method || ""}{acc.billing_day ? ` · ${acc.billing_day}일` : ""}</div>
                      </td>
                      <td className="p-4 text-center" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-center gap-1">
                          <input
                            type="number"
                            min={0}
                            value={u.usedSeats ?? ""}
                            onChange={(e) => setSeats(acc.id, "usedSeats", Number(e.target.value))}
                            placeholder="0"
                            className="w-10 px-1 py-0.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-center"
                          />
                          <span className="text-[var(--text-dim)] text-xs">/</span>
                          <input
                            type="number"
                            min={0}
                            value={u.seats ?? ""}
                            onChange={(e) => setSeats(acc.id, "seats", Number(e.target.value))}
                            placeholder="총"
                            className="w-10 px-1 py-0.5 bg-[var(--bg)] border border-[var(--border)] rounded text-xs text-center"
                          />
                        </div>
                        {seatPct !== null && (
                          <div className="mt-1 h-1 bg-[var(--bg-surface)] rounded-full overflow-hidden w-16 mx-auto">
                            <div className={`h-full ${seatPct >= 90 ? "bg-red-500" : seatPct >= 70 ? "bg-yellow-500" : "bg-green-500"}`} style={{ width: `${seatPct}%` }} />
                          </div>
                        )}
                      </td>
                      <td className="p-4 text-center text-xs">
                        {lastOpenDays === null ? (
                          <span className="text-red-400">미접속</span>
                        ) : (
                          <span className={lastOpenDays >= UNUSED_DAYS ? "text-orange-400" : "text-[var(--text-muted)]"}>
                            {lastOpenDays === 0 ? "오늘" : `${lastOpenDays}일 전`}
                          </span>
                        )}
                        <div className="text-[10px] text-[var(--text-dim)] mt-0.5">{(u.opens?.length || 0)}회</div>
                      </td>
                      <td className="p-4 text-center text-xs text-[var(--text-muted)]">
                        {acc.renewal_date ? new Date(acc.renewal_date).toLocaleDateString("ko") : "—"}
                      </td>
                      <td className="p-4 text-center">
                        <span className={`text-[10px] px-2 py-0.5 rounded-full ${st.bg} ${st.text}`}>
                          {st.label}
                        </span>
                        {isUnused && (
                          <div className="text-[10px] text-orange-400 mt-1">💤 미사용</div>
                        )}
                      </td>
                      <td className="p-4 text-right" onClick={(e) => e.stopPropagation()}>
                        <div className="flex flex-col items-end gap-1">
                          {acc.url && (
                            <button
                              onClick={() => recordOpen(acc.id, acc.url)}
                              className="text-[10px] px-2 py-1 bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 rounded transition font-medium"
                              title="방문 (사용 기록 적재)"
                            >
                              ↗ 방문
                            </button>
                          )}
                          <button
                            onClick={() => setShowAccessLogId(acc.id)}
                            className="text-[10px] px-2 py-1 bg-[var(--bg-surface)] hover:bg-[var(--bg)] text-[var(--text-muted)] rounded transition"
                          >
                            로그
                          </button>
                          {acc.status === "active" && (
                            <button onClick={() => cancelAccMut.mutate(acc.id)}
                              className="text-[10px] text-red-400 hover:text-red-300 transition">해지</button>
                          )}
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

      {/* ═══ Assets Tab ═══ */}
      {tab === "assets" && (
        <>
          {/* 요약 — 총 취득가 / 총 장부가 */}
          {!!vault?.assets?.length && (() => {
            const active = (vault.assets as any[]).filter((a) => a.status !== "disposed");
            const acquire = active.reduce((s, a) => s + Number(a.value || 0), 0);
            const book = active.reduce((s, a) => s + computeBookValue(a.value, a.purchase_date, a.useful_life_months).book, 0);
            return (
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="glass-card p-4">
                  <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">총 취득가</div>
                  <div className="text-xl font-extrabold mt-1">{fmtW(acquire)}</div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">총 장부가 (감가 후)</div>
                  <div className="text-xl font-extrabold mt-1 text-[var(--primary)]">{fmtW(book)}</div>
                </div>
                <div className="glass-card p-4">
                  <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">누적 감가상각</div>
                  <div className="text-xl font-extrabold mt-1 text-amber-500">{fmtW(acquire - book)}</div>
                </div>
              </div>
            );
          })()}
          <div className="glass-card overflow-x-auto">
          {!vault?.assets?.length ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">📦</div>
              <div className="text-lg font-bold mb-2">자산이 없습니다</div>
              <div className="text-sm text-[var(--text-muted)]">유형/무형 자산을 등록하세요</div>
            </div>
          ) : (
            <table className="w-full text-sm min-w-[760px]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left p-4 text-xs text-[var(--text-dim)] font-medium">자산명</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">유형</th>
                  <th className="text-right p-4 text-xs text-[var(--text-dim)] font-medium">취득가</th>
                  <th className="text-right p-4 text-xs text-[var(--text-dim)] font-medium">장부가</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">취득일</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">상태</th>
                </tr>
              </thead>
              <tbody>
                {vault.assets.map((a: any) => {
                  const bv = computeBookValue(a.value, a.purchase_date, a.useful_life_months);
                  return (
                  <tr key={a.id} className="border-b border-[var(--border)]/30 hover:bg-[var(--bg-surface)] transition cursor-pointer" onClick={() => { setEditingId(a.id); setAssetForm({ type: a.type || "tangible", name: a.name || "", purchaseDate: a.purchase_date || "", value: String(a.value || ""), location: a.location || "", notes: a.notes || "", usefulLifeMonths: a.useful_life_months ? String(a.useful_life_months) : "", attachmentUrl: a.attachment_url || "" }); setShowForm(true); }}>
                    <td className="p-4">
                      <div className="font-semibold flex items-center gap-1.5">
                        {a.name}
                        {a.attachment_url && (
                          <button type="button" onClick={(e) => { e.stopPropagation(); openStoredFile(a.attachment_url); }} className="text-[10px] text-[var(--primary)] hover:underline" title="증빙 문서">📎</button>
                        )}
                      </div>
                      {a.notes && <div className="caption">{a.notes}</div>}
                    </td>
                    <td className="p-4 text-center">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full ${
                        a.type === "tangible" ? "bg-blue-500/10 text-blue-400" : "bg-purple-500/10 text-purple-400"
                      }`}>
                        {ASSET_TYPES[a.type] || a.type}
                      </span>
                    </td>
                    <td className="p-4 text-right text-[var(--text-muted)] mono-number">{(a.value || 0).toLocaleString()}원</td>
                    <td className="p-4 text-right font-bold mono-number">
                      {bv.book.toLocaleString()}원
                      {!bv.depreciated && <div className="text-[9px] text-[var(--text-dim)] font-normal">감가 미설정</div>}
                    </td>
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
                  );
                })}
              </tbody>
            </table>
          )}
          </div>
        </>
      )}

      {/* ═══ Docs Tab ═══ */}
      {tab === "docs" && (
        <div className="glass-card overflow-x-auto">
          {!vault?.docs?.length ? (
            <div className="p-16 text-center">
              <div className="text-4xl mb-4">📄</div>
              <div className="text-lg font-bold mb-2">보관 문서가 없습니다</div>
              <div className="text-sm text-[var(--text-muted)]">중요 문서를 안전하게 보관하세요</div>
            </div>
          ) : (
            <table className="w-full text-sm min-w-[600px]">
              <thead>
                <tr className="border-b border-[var(--border)]">
                  <th className="text-left p-4 text-xs text-[var(--text-dim)] font-medium">문서명</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">카테고리</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">연결 프로젝트</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">만료일</th>
                  <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">태그</th>
                </tr>
              </thead>
              <tbody>
                {vault.docs.map((d: any) => {
                  const isExpiring = d.expiry_date && ((new Date(d.expiry_date).getTime() - Date.now()) / (1000 * 60 * 60 * 24)) <= 30;
                  return (
                    <tr id={`vault-row-${d.id}`} key={d.id} className="border-b border-[var(--border)]/30 hover:bg-[var(--bg-surface)] transition cursor-pointer" onClick={() => { setEditingId(d.id); setDocForm({ category: d.category || "contract", name: d.name || "", fileUrl: d.file_url || "", linkedDealId: d.linked_deal_id || "", expiryDate: d.expiry_date || "", tags: (d.tags || []).join(", ") }); setShowForm(true); }}>
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
        <>
        <div className="mb-3 rounded-xl border border-[var(--primary)]/20 bg-[var(--primary)]/5 p-3 text-[11px] text-[var(--text-muted)]">
          반복 결제 패턴(카드·자동이체)에서 미등록 구독을 자동으로 찾습니다. 수락하면{" "}
          <Link href="/subscriptions" className="text-[var(--primary)] font-semibold hover:underline">구독 목록</Link>
          에 추가됩니다.
        </div>
        <div className="glass-card overflow-hidden">
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
        </>
      )}

      {/* 접근 로그 모달 */}
      {showAccessLogId && (() => {
        const acc = (vault?.accounts || []).find((a: any) => a.id === showAccessLogId);
        const u = usage[showAccessLogId] || {};
        const opens = (u.opens || []).slice().reverse();
        return (
          <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4" onClick={() => setShowAccessLogId(null)}>
            <div className="glass-card w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
              <div className="px-5 py-4 border-b border-[var(--border)] flex items-center justify-between">
                <div>
                  <div className="text-sm font-bold">{acc?.service_name} 접근 로그</div>
                  <div className="text-[11px] text-[var(--text-muted)] mt-0.5">최근 50건 · 총 {opens.length}회 접속</div>
                </div>
                <button onClick={() => setShowAccessLogId(null)} className="text-[var(--text-muted)] hover:text-[var(--text)] text-lg">✕</button>
              </div>
              <div className="overflow-y-auto p-4">
                {opens.length === 0 ? (
                  <div className="text-center py-8 text-sm text-[var(--text-dim)]">기록된 접근이 없습니다<br /><span className="text-[10px]">"방문" 버튼을 클릭하면 자동으로 기록됩니다</span></div>
                ) : (
                  <div className="space-y-1">
                    {opens.map((o, i) => (
                      <div key={i} className="flex items-center justify-between px-3 py-2 rounded-lg hover:bg-[var(--bg-surface)] text-xs">
                        <span className="font-mono text-[var(--text-muted)]">{new Date(o.at).toLocaleString("ko")}</span>
                        <span className="caption">{o.by ? `사용자 ${o.by.slice(0, 8)}` : "—"}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="px-5 py-3 border-t border-[var(--border)] text-[10px] text-[var(--text-dim)]">
                ※ 로컬 기록 (이 디바이스 기준). 다른 사용자의 접근은 각자 디바이스에서 추적됩니다.
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
