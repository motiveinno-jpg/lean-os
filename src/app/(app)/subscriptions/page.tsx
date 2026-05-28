"use client";

// 2026-05-22 구독 통합 화면 (사장님 방향) — 회사가 쓰는 모든 외부 프로그램/AI 구독을 한 곳에.
//   외부 구독 = vault_accounts 재사용 (Claude·ChatGPT·Adobe·AWS·Notion 등)
//   OwnerView 구독 = subscriptions + subscription_plans 에서 1행 자동 포함 (관리 → /billing 딥링크)
//   요약: 월 총 구독비 / 연 환산 / 카테고리 분포. 등록·수정은 owner/admin.

import { useEffect, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  getCurrentUser, getVaultAccounts, createVaultAccount, updateVaultAccount, deleteVaultAccount,
  getCompanyUsers,
} from "@/lib/queries";
import { useToast } from "@/components/toast";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { CurrencyInput } from "@/components/currency-input";

const db = supabase as any;

function fmtW(n: number): string {
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}₩${abs.toLocaleString()}`;
}

const CATEGORIES = [
  { value: "ai", label: "AI" },
  { value: "design", label: "디자인" },
  { value: "infra", label: "인프라/클라우드" },
  { value: "collab", label: "협업/생산성" },
  { value: "other", label: "기타" },
];
const CATEGORY_LABEL: Record<string, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label]));

const STATUS_TONE: Record<string, { label: string; cls: string }> = {
  active: { label: "활성", cls: "bg-green-500/10 text-green-500" },
  paused: { label: "일시중지", cls: "bg-yellow-500/10 text-yellow-500" },
  cancelled: { label: "해지", cls: "bg-red-500/10 text-red-400" },
};

export default function SubscriptionsPage() {
  const { role } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const canEdit = role === "owner" || role === "admin";

  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState({
    serviceName: "", category: "ai", monthlyCost: "", billingCycle: "monthly",
    renewalDate: "", paymentMethod: "", ownerId: "", url: "", notes: "",
  });

  useEffect(() => {
    getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); });
  }, []);

  const { data: accounts = [] } = useQuery({
    queryKey: ["vault-accounts", companyId],
    queryFn: () => getVaultAccounts(companyId!),
    enabled: !!companyId,
  });

  const { data: ownerViewSub } = useQuery({
    queryKey: ["ov-subscription", companyId],
    queryFn: async () => {
      const { data } = await db
        .from("subscriptions")
        .select("*, subscription_plans(*)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      return data;
    },
    enabled: !!companyId,
  });

  const { data: users = [] } = useQuery({
    queryKey: ["company-users-subs", companyId],
    queryFn: () => getCompanyUsers(companyId!),
    enabled: !!companyId && canEdit,
  });

  const resetForm = () => {
    setForm({ serviceName: "", category: "ai", monthlyCost: "", billingCycle: "monthly", renewalDate: "", paymentMethod: "", ownerId: "", url: "", notes: "" });
    setEditingId(null);
    setShowForm(false);
  };

  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = {
        serviceName: form.serviceName.trim(),
        category: form.category,
        monthlyCost: Number(form.monthlyCost) || 0,
        billingCycle: form.billingCycle,
        renewalDate: form.renewalDate || undefined,
        paymentMethod: form.paymentMethod || undefined,
        ownerId: form.ownerId || undefined,
        url: form.url || undefined,
        notes: form.notes || undefined,
      };
      if (editingId) {
        await updateVaultAccount(editingId, {
          service_name: payload.serviceName, category: payload.category,
          monthly_cost: payload.monthlyCost, billing_cycle: payload.billingCycle,
          renewal_date: payload.renewalDate || null, payment_method: payload.paymentMethod || null,
          owner_id: payload.ownerId || null, url: payload.url || null, notes: payload.notes || null,
        });
      } else {
        await createVaultAccount({ companyId: companyId!, ...payload });
      }
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vault-accounts", companyId] }); resetForm(); toast("구독이 저장되었습니다", "success"); },
    onError: (e: any) => toast(`저장 실패: ${e?.message || e}`, "error"),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => deleteVaultAccount(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["vault-accounts", companyId] }); resetForm(); toast("해지 처리되었습니다", "success"); },
    onError: (e: any) => toast(`처리 실패: ${e?.message || e}`, "error"),
  });

  if (role !== "owner" && role !== "admin" && role !== "employee") {
    return <AccessDenied detail="구독 현황은 회사 구성원만 볼 수 있습니다." />;
  }
  if (!companyId) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;

  // OwnerView 월 환산액
  const ovPlan = ownerViewSub?.subscription_plans;
  const ovMonthly = ovPlan ? (Number(ovPlan.base_price || 0) + Number(ovPlan.per_seat_price || 0) * Number(ownerViewSub?.seat_count || 1)) : 0;

  // 외부 구독 (해지 제외) 월합
  const activeAccounts = (accounts as any[]).filter((a) => a.status !== "cancelled");
  const externalMonthly = activeAccounts.reduce((s, a) => s + Number(a.monthly_cost || 0), 0);
  const totalMonthly = externalMonthly + ovMonthly;

  // 카테고리 분포
  const byCategory = new Map<string, number>();
  for (const a of activeAccounts) {
    const k = a.category || "other";
    byCategory.set(k, (byCategory.get(k) || 0) + Number(a.monthly_cost || 0));
  }
  if (ovMonthly > 0) byCategory.set("collab", (byCategory.get("collab") || 0) + ovMonthly);

  return (
    <div className="max-w-[960px]">
      <div className="page-sticky-header flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold">구독 관리</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            회사가 쓰는 모든 외부 프로그램·AI 구독을 한 곳에. OwnerView 요금제도 포함.
          </p>
        </div>
        {canEdit && (
          <button onClick={() => { resetForm(); setShowForm(true); }}
            className="px-4 py-2.5 bg-[var(--primary)] text-white rounded-xl text-sm font-semibold hover:opacity-90">
            + 구독 추가
          </button>
        )}
      </div>

      {/* 요약 */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-6">
        <div className="glass-card p-4">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">월 총 구독비</div>
          <div className="text-xl font-extrabold mt-1 text-[var(--primary)]">{fmtW(totalMonthly)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">연 환산</div>
          <div className="text-xl font-extrabold mt-1">{fmtW(totalMonthly * 12)}</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">외부 구독</div>
          <div className="text-xl font-extrabold mt-1">{activeAccounts.length}개</div>
        </div>
        <div className="glass-card p-4">
          <div className="text-[10px] text-[var(--text-dim)] uppercase tracking-wider">카테고리</div>
          <div className="text-xs mt-1.5 space-y-0.5">
            {Array.from(byCategory.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <span className="text-[var(--text-muted)]">{CATEGORY_LABEL[k] || k}</span>
                <span className="font-semibold">{fmtW(v)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* 등록/수정 폼 */}
      {showForm && canEdit && (
        <div className="glass-card p-6 mb-4">
          <h3 className="text-sm font-bold mb-4">{editingId ? "구독 수정" : "구독 추가"}</h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-4">
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">서비스명 *</label>
              <input value={form.serviceName} onChange={(e) => setForm({ ...form, serviceName: e.target.value })}
                placeholder="예: Claude, ChatGPT, Adobe" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">카테고리</label>
              <select value={form.category} onChange={(e) => setForm({ ...form, category: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">월 금액 (원)</label>
              <CurrencyInput value={form.monthlyCost} onValueChange={(raw) => setForm({ ...form, monthlyCost: raw })}
                placeholder="0" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">결제주기</label>
              <select value={form.billingCycle} onChange={(e) => setForm({ ...form, billingCycle: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                <option value="monthly">월간</option>
                <option value="yearly">연간</option>
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">다음 결제일</label>
              <input type="date" value={form.renewalDate} onChange={(e) => setForm({ ...form, renewalDate: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">담당자</label>
              <select value={form.ownerId} onChange={(e) => setForm({ ...form, ownerId: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]">
                <option value="">선택 안함</option>
                {(users as any[]).map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">결제수단</label>
              <input value={form.paymentMethod} onChange={(e) => setForm({ ...form, paymentMethod: e.target.value })}
                placeholder="법인카드 끝4자리 등" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">해지 링크/URL</label>
              <input value={form.url} onChange={(e) => setForm({ ...form, url: e.target.value })}
                placeholder="https://" className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
            <div>
              <label className="block text-xs text-[var(--text-muted)] mb-1">메모</label>
              <input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })}
                className="w-full px-3 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
            </div>
          </div>
          <div className="flex gap-2">
            <button onClick={() => { if (!form.serviceName.trim()) return; saveMut.mutate(); }}
              disabled={!form.serviceName.trim() || saveMut.isPending}
              className="px-4 py-2 bg-[var(--primary)] text-white rounded-lg text-sm font-semibold disabled:opacity-50">
              {editingId ? "저장" : "추가"}
            </button>
            {editingId && (
              <button onClick={() => { if (confirm("이 구독을 해지 처리할까요?")) deleteMut.mutate(editingId); }} disabled={deleteMut.isPending}
                className="px-4 py-2 bg-red-500/10 text-red-500 rounded-lg text-sm font-semibold disabled:opacity-50">해지</button>
            )}
            <button onClick={resetForm} className="px-4 py-2 text-[var(--text-muted)] text-sm">취소</button>
          </div>
        </div>
      )}

      {/* 목록 */}
      <div className="glass-card overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead>
            <tr className="border-b border-[var(--border)]">
              <th className="text-left p-4 text-xs text-[var(--text-dim)] font-medium">서비스</th>
              <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">카테고리</th>
              <th className="text-right p-4 text-xs text-[var(--text-dim)] font-medium">월 금액</th>
              <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">주기</th>
              <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">다음 결제</th>
              <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">담당자</th>
              <th className="text-center p-4 text-xs text-[var(--text-dim)] font-medium">상태</th>
            </tr>
          </thead>
          <tbody>
            {/* OwnerView 항목 (자동 포함) */}
            {ovPlan && (
              <tr className="border-b border-[var(--border)]/30 bg-[var(--primary)]/5">
                <td className="p-4">
                  <div className="font-semibold flex items-center gap-1.5">
                    <span className="text-[var(--primary)]">★</span> OwnerView
                    <span className="text-[10px] text-[var(--text-dim)]">{ovPlan.name || ovPlan.slug}</span>
                  </div>
                </td>
                <td className="p-4 text-center"><span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--primary)]/10 text-[var(--primary)]">자체 SaaS</span></td>
                <td className="p-4 text-right font-bold mono-number">{fmtW(ovMonthly)}</td>
                <td className="p-4 text-center text-xs text-[var(--text-muted)]">월간</td>
                <td className="p-4 text-center text-xs text-[var(--text-muted)]">
                  {ownerViewSub?.current_period_end ? new Date(ownerViewSub.current_period_end).toLocaleDateString("ko") : "—"}
                </td>
                <td className="p-4 text-center text-xs text-[var(--text-muted)]">—</td>
                <td className="p-4 text-center">
                  <Link href="/billing" className="text-[11px] px-2 py-1 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-semibold hover:bg-[var(--primary)]/20">관리 →</Link>
                </td>
              </tr>
            )}
            {/* 외부 구독 */}
            {activeAccounts.map((a: any) => {
              const st = STATUS_TONE[a.status] || STATUS_TONE.active;
              return (
                <tr key={a.id} className={`border-b border-[var(--border)]/30 hover:bg-[var(--bg-surface)] transition ${canEdit ? "cursor-pointer" : ""}`}
                  onClick={() => { if (!canEdit) return; setEditingId(a.id); setForm({ serviceName: a.service_name || "", category: a.category || "other", monthlyCost: String(a.monthly_cost || ""), billingCycle: a.billing_cycle || "monthly", renewalDate: a.renewal_date || "", paymentMethod: a.payment_method || "", ownerId: a.owner_id || "", url: a.url || "", notes: a.notes || "" }); setShowForm(true); }}>
                  <td className="p-4">
                    <div className="font-semibold">{a.service_name}</div>
                    {a.notes && <div className="text-[10px] text-[var(--text-dim)]">{a.notes}</div>}
                  </td>
                  <td className="p-4 text-center"><span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-muted)]">{CATEGORY_LABEL[a.category] || "기타"}</span></td>
                  <td className="p-4 text-right font-bold mono-number">{Number(a.monthly_cost || 0).toLocaleString()}원</td>
                  <td className="p-4 text-center text-xs text-[var(--text-muted)]">{a.billing_cycle === "yearly" ? "연간" : "월간"}</td>
                  <td className="p-4 text-center text-xs text-[var(--text-muted)]">{a.renewal_date ? new Date(a.renewal_date).toLocaleDateString("ko") : "—"}</td>
                  <td className="p-4 text-center text-xs text-[var(--text-muted)]">{a.users?.name || a.users?.email || "—"}</td>
                  <td className="p-4 text-center"><span className={`text-[10px] px-2 py-0.5 rounded-full ${st.cls}`}>{st.label}</span></td>
                </tr>
              );
            })}
            {activeAccounts.length === 0 && !ovPlan && (
              <tr><td colSpan={7} className="p-16 text-center text-sm text-[var(--text-muted)]">등록된 구독이 없습니다. + 구독 추가로 Claude·ChatGPT 등을 등록하세요.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="mt-4 text-[11px] text-[var(--text-dim)]">
        · 월 금액은 결제주기와 무관하게 월 환산액으로 입력하세요 (연간 결제는 ÷12).
        · OwnerView 요금제는 자동 표시되며 "관리"에서 플랜·결제수단을 변경합니다.
      </div>
    </div>
  );
}
