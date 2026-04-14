"use client";

import { useState, useEffect } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { QueryErrorBanner } from "@/components/query-status";

// 신규 테이블 타입이 아직 database.ts에 없으므로 any 캐스팅
const db = supabase as any;

type Tab = "plan" | "payment" | "invoices" | "referral";
type BillingCycle = "monthly" | "annual";

const PLAN_FEATURES: Record<string, { icon: string; features: string[]; recommended?: boolean }> = {
  free: { icon: "🆓", features: ["직원 3명까지", "프로젝트 3개", "전자서명 월 3건", "생존 대시보드", "AI 분석 월 5회", "팀 채팅"] },
  starter: { icon: "🚀", features: ["직원/프로젝트 무제한", "4개 엔진 전체", "서명 월 50건", "AI 분석 월 100회", "파트너 10개", "거래처 DB 무제한", "이메일 지원"] },
  business: { icon: "🏢", recommended: true, features: ["Starter 전체 +", "AI 무제한", "급여 자동정산", "서명 무제한", "자동화 무제한", "파트너 무제한", "세무 리포트", "생존 시뮬레이터", "우선 지원"] },
  enterprise: { icon: "🏗️", features: ["Business 전체 +", "SSO/SAML", "감사 로그 무제한", "API 접근", "전담 CSM", "맞춤 개발", "SLA 보장"] },
};

function fmtW(n: number): string {
  if (n === 0) return "무료";
  return `₩${n.toLocaleString()}`;
}

export default function BillingPage() {
  const { toast } = useToast();
  const [tab, setTab] = useState<Tab>("plan");
  const [cycle, setCycle] = useState<BillingCycle>("monthly");
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showUpgradeModal, setShowUpgradeModal] = useState<string | null>(null);
  const [referralCopied, setReferralCopied] = useState(false);
  const [isPaymentLoading, setIsPaymentLoading] = useState(false);
  const qc = useQueryClient();

  const { data: user, error: mainError, refetch: mainRefetch } = useQuery({ queryKey: ["currentUser"], queryFn: getCurrentUser });
  const companyId = user?.company_id;

  // 요금제 목록
  const { data: plans } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => {
      const { data } = await db.from("subscription_plans").select("*").eq("is_active", true).order("sort_order");
      return data || [];
    },
  });

  // 현재 구독
  const { data: subscription } = useQuery({
    queryKey: ["subscription", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const { data } = await db
        .from("subscriptions")
        .select("*, subscription_plans(*)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .single();
      return data;
    },
    enabled: !!companyId,
  });

  // 청구서 목록
  const { data: invoices } = useQuery({
    queryKey: ["invoices", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data } = await db
        .from("invoices")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });

  // 추천 코드
  const { data: referral } = useQuery({
    queryKey: ["referral", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const { data } = await db
        .from("referral_codes")
        .select("*")
        .eq("company_id", companyId)
        .eq("is_active", true)
        .single();
      return data;
    },
    enabled: !!companyId,
  });

  // 추천 코드 생성
  const createReferral = useMutation({
    mutationFn: async () => {
      if (!companyId) throw new Error("No company");
      const code = Array.from({ length: 8 }, () => "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"[Math.floor(Math.random() * 32)]).join("");
      const { data, error } = await db
        .from("referral_codes")
        .insert({ company_id: companyId, code })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["referral"] }),
  });

  // 피드백 제출
  const [fbCategory, setFbCategory] = useState("feature_request");
  const [fbTitle, setFbTitle] = useState("");
  const [fbDesc, setFbDesc] = useState("");
  const [fbSent, setFbSent] = useState(false);

  const submitFeedback = useMutation({
    mutationFn: async () => {
      if (!companyId || !user?.id) throw new Error("No user");
      const { error } = await db.from("feedback").insert({
        company_id: companyId,
        user_id: user.id,
        category: fbCategory,
        title: fbTitle,
        description: fbDesc,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      setFbSent(true);
      setFbTitle("");
      setFbDesc("");
    },
  });

  // Handle Stripe checkout callback
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const paymentStatus = params.get('payment');
    if (paymentStatus === 'success') {
      qc.invalidateQueries({ queryKey: ['subscription'] });
      toast("결제가 완료되었습니다! 플랜이 업그레이드되었습니다.", "success");
      window.history.replaceState({}, '', '/billing');
    } else if (paymentStatus === 'cancel') {
      toast("결제가 취소되었습니다.", "info");
      window.history.replaceState({}, '', '/billing');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const currentPlan = subscription?.subscription_plans as any;
  const currentSlug = currentPlan?.slug || "free";
  const hasStripeSubscription = !!subscription?.stripe_customer_id;

  /** Stripe Checkout */
  async function handleStripeCheckout(planSlug: string) {
    if (!companyId) return;
    setIsPaymentLoading(true);
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planSlug,
          companyId,
          billingCycle: cycle,
          successUrl: `${window.location.origin}/billing?payment=success`,
          cancelUrl: `${window.location.origin}/billing?payment=cancel`,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.message || '결제 세션 생성 실패');
      }
      window.location.href = result.data.url;
    } catch (err: any) {
      toast(err.message || "결제 처리 중 오류가 발생했습니다.", "error");
      setIsPaymentLoading(false);
    }
  }

  /** Stripe Billing Portal */
  async function handleOpenPortal() {
    if (!companyId) return;
    setIsPaymentLoading(true);
    try {
      const response = await fetch('/api/stripe/portal', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId,
          returnUrl: `${window.location.origin}/billing`,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        throw new Error(result.error?.message || 'Billing portal 생성 실패');
      }
      window.location.href = result.data.url;
    } catch (err: any) {
      toast(err.message || "구독 관리 페이지를 열 수 없습니다.", "error");
      setIsPaymentLoading(false);
    }
  }

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: "plan", label: "요금제", icon: "💳" },
    { key: "payment", label: "결제 수단", icon: "🏦" },
    { key: "invoices", label: "청구서", icon: "🧾" },
    { key: "referral", label: "추천/피드백", icon: "🎁" },
  ];

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-extrabold text-[var(--text)]">구독 & 결제</h1>
        <p className="text-sm text-[var(--text-muted)] mt-1">요금제 관리, 결제 수단, 청구서 확인</p>
      </div>

      {/* Current plan summary */}
      <div className="bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl p-6 mb-6 text-white">
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <div className="text-xs font-semibold opacity-80 mb-1">현재 플랜</div>
            <div className="text-2xl font-extrabold">{currentPlan?.name || "Free"}</div>
            <div className="text-sm opacity-80 mt-1">
              {subscription?.seat_count || 1}명 · {subscription?.billing_cycle === "annual" ? "연간" : "월간"} 결제
            </div>
          </div>
          <div className="text-right">
            <div className="text-xs font-semibold opacity-80 mb-1">월 결제 금액</div>
            <div className="text-3xl font-extrabold">
              {fmtW((currentPlan?.base_price || 0) + (currentPlan?.per_seat_price || 0) * (subscription?.seat_count || 1))}
            </div>
            {subscription?.current_period_end && (
              <div className="text-xs opacity-70 mt-1">
                다음 결제: {new Date(subscription.current_period_end).toLocaleDateString("ko-KR")}
              </div>
            )}
          </div>
        </div>
        {hasStripeSubscription && (
          <button
            onClick={handleOpenPortal}
            disabled={isPaymentLoading}
            className="mt-4 px-5 py-2 rounded-xl text-sm font-semibold bg-white/20 hover:bg-white/30 transition disabled:opacity-50"
          >
            {isPaymentLoading ? "로딩 중..." : "구독 관리"}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1 bg-[var(--bg-surface)] rounded-xl p-1 mb-6 overflow-x-auto">
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
            className={`flex items-center gap-1.5 px-4 py-2.5 rounded-lg text-sm font-semibold whitespace-nowrap transition ${
              tab === t.key
                ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm"
                : "text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            <span>{t.icon}</span> {t.label}
          </button>
        ))}
      </div>

      {/* Plan Tab */}
      {tab === "plan" && (
        <div>
          <div className="flex justify-center gap-2 mb-6">
            <button
              onClick={() => setCycle("monthly")}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${
                cycle === "monthly" ? "bg-blue-600 text-white" : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
              }`}
            >
              월간
            </button>
            <button
              onClick={() => setCycle("annual")}
              className={`px-5 py-2 rounded-xl text-sm font-semibold transition ${
                cycle === "annual" ? "bg-blue-600 text-white" : "bg-[var(--bg-surface)] text-[var(--text-muted)]"
              }`}
            >
              연간 <span className="text-xs opacity-80">(20% 할인)</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
            {(plans || []).map((plan: any) => {
              const slug = plan.slug as string;
              const meta = PLAN_FEATURES[slug] || { icon: "📦", features: [] };
              const isCurrent = currentSlug === slug;
              const monthlyPrice = cycle === "annual" ? Math.round(plan.base_price * 0.8) : plan.base_price;
              const monthlySeat = cycle === "annual" ? Math.round(plan.per_seat_price * 0.8) : plan.per_seat_price;

              return (
                <div
                  key={plan.id}
                  className={`relative rounded-2xl border-2 p-6 transition ${
                    isCurrent
                      ? "border-blue-500 bg-blue-50/50 dark:bg-blue-950/20"
                      : meta.recommended
                      ? "border-purple-300 bg-[var(--bg-card)]"
                      : "border-[var(--border)] bg-[var(--bg-card)]"
                  }`}
                >
                  {meta.recommended && !isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-bold bg-purple-600 text-white">
                      추천
                    </div>
                  )}
                  {isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-bold bg-blue-600 text-white">
                      현재 플랜
                    </div>
                  )}
                  <div className="text-center mb-4">
                    <div className="text-2xl mb-2">{meta.icon}</div>
                    <div className="text-lg font-extrabold text-[var(--text)]">{plan.name}</div>
                    <div className="mt-2">
                      {plan.base_price === 0 && slug !== "enterprise" ? (
                        <div className="text-3xl font-extrabold text-[var(--text)]">무료</div>
                      ) : slug === "enterprise" ? (
                        <div className="text-xl font-bold text-[var(--text)]">별도 협의</div>
                      ) : (
                        <>
                          <div className="text-3xl font-extrabold text-[var(--text)]">
                            ₩{monthlyPrice.toLocaleString()}
                          </div>
                          <div className="text-xs text-[var(--text-muted)] mt-1">
                            /월 + ₩{monthlySeat.toLocaleString()}/인
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  <ul className="space-y-2 mb-6">
                    {meta.features.map((f, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-[var(--text-muted)]">
                        <span className="text-green-500 mt-0.5">✓</span>
                        {f}
                      </li>
                    ))}
                  </ul>
                  {isCurrent ? (
                    <button
                      disabled
                      className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[var(--bg-surface)] text-[var(--text-muted)]"
                    >
                      현재 플랜
                    </button>
                  ) : slug === "enterprise" ? (
                    <button
                      onClick={() => window.open("mailto:creative@mo-tive.com?subject=Enterprise 문의")}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[var(--bg-surface)] text-[var(--text)] hover:bg-[var(--border)] transition"
                    >
                      문의하기
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowUpgradeModal(slug)}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold bg-blue-600 hover:bg-blue-700 text-white transition"
                    >
                      {slug === "free" ? "다운그레이드" : "업그레이드"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {currentSlug !== "free" && (
            <div className="mt-8 p-4 rounded-xl border border-red-200 dark:border-red-800 bg-red-50/50 dark:bg-red-950/10">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm text-[var(--text)]">구독 해지</div>
                  <div className="text-xs text-[var(--text-muted)]">현재 결제 기간이 끝나면 Free 플랜으로 전환됩니다.</div>
                </div>
                {hasStripeSubscription ? (
                  <button
                    onClick={handleOpenPortal}
                    disabled={isPaymentLoading}
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-red-500 dark:text-red-400 border border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/30 transition disabled:opacity-50"
                  >
                    {isPaymentLoading ? "로딩 중..." : "Stripe에서 해지"}
                  </button>
                ) : (
                  <button
                    onClick={() => setShowCancelModal(true)}
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-red-500 dark:text-red-400 border border-red-300 dark:border-red-700 hover:bg-red-100 dark:hover:bg-red-900/30 transition"
                  >
                    해지하기
                  </button>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Payment Tab */}
      {tab === "payment" && (
        <div className="space-y-4">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
            <h3 className="font-bold text-[var(--text)] mb-4">결제 수단</h3>
            {hasStripeSubscription ? (
              <div className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-surface)]">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 rounded-lg bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center text-blue-600 dark:text-blue-400 text-lg">💳</div>
                  <div>
                    <div className="font-semibold text-sm text-[var(--text)]">Stripe 구독 결제</div>
                    <div className="text-xs text-[var(--text-muted)]">등록된 카드로 자동 결제됩니다</div>
                  </div>
                </div>
                <button
                  onClick={handleOpenPortal}
                  disabled={isPaymentLoading}
                  className="px-3 py-1.5 rounded-lg text-xs font-semibold text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-700 hover:bg-blue-50 dark:hover:bg-blue-900/30 transition disabled:opacity-50"
                >
                  {isPaymentLoading ? "로딩 중..." : "카드 변경"}
                </button>
              </div>
            ) : (
              <div className="text-center py-8">
                <div className="text-4xl mb-3">💳</div>
                <p className="text-sm text-[var(--text-muted)] mb-4">등록된 결제 수단이 없습니다</p>
                <p className="text-xs text-[var(--text-muted)]">유료 플랜 결제 시 Stripe를 통해 카드가 등록됩니다</p>
              </div>
            )}
          </div>

          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
            <h3 className="font-bold text-[var(--text)] mb-3">결제 안내</h3>
            <div className="space-y-2 text-sm text-[var(--text-muted)]">
              <div className="flex items-start gap-2"><span>•</span> Stripe를 통해 안전하게 결제됩니다 (PCI DSS Level 1)</div>
              <div className="flex items-start gap-2"><span>•</span> 월간 결제: 매월 동일일에 자동 결제</div>
              <div className="flex items-start gap-2"><span>•</span> 연간 결제: 20% 할인, 연 1회 결제</div>
              <div className="flex items-start gap-2"><span>•</span> 부가세(VAT) 10%는 별도 청구됩니다</div>
              <div className="flex items-start gap-2"><span>•</span> 결제 실패 시 3일 후 재시도, 3회 실패 시 Free 전환</div>
            </div>
          </div>
        </div>
      )}

      {/* Invoices Tab */}
      {tab === "invoices" && (
        <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] overflow-hidden">
          <div className="p-4 border-b border-[var(--border)]">
            <h3 className="font-bold text-[var(--text)]">청구서 내역</h3>
          </div>
          {(invoices || []).length === 0 ? (
            <div className="text-center py-12">
              <div className="text-4xl mb-3">🧾</div>
              <p className="text-sm text-[var(--text-muted)]">청구서 내역이 없습니다</p>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {(invoices || []).map((inv: any) => (
                <div key={inv.id} className="flex items-center justify-between p-4 hover:bg-[var(--bg-surface)] transition">
                  <div className="flex items-center gap-3">
                    <div className={`w-2 h-2 rounded-full ${
                      inv.status === "paid" ? "bg-green-500" : inv.status === "failed" ? "bg-red-500" : "bg-yellow-500"
                    }`} />
                    <div>
                      <div className="font-semibold text-sm text-[var(--text)]">{inv.invoice_number}</div>
                      <div className="text-xs text-[var(--text-muted)]">{inv.description || "구독 결제"}</div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="font-bold text-sm text-[var(--text)]">₩{(inv.total_amount || 0).toLocaleString()}</div>
                    <div className="text-xs text-[var(--text-muted)]">
                      {new Date(inv.created_at).toLocaleDateString("ko-KR")}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Referral & Feedback Tab */}
      {tab === "referral" && (
        <div className="space-y-6">
          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
            <h3 className="font-bold text-[var(--text)] mb-1">추천인 프로그램</h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">친구가 가입하면 양쪽 모두 ₩10,000 크레딧!</p>

            {referral ? (
              <div className="space-y-4">
                <div className="flex items-center gap-3 p-4 rounded-xl bg-[var(--bg-surface)]">
                  <div className="flex-1">
                    <div className="text-xs text-[var(--text-muted)] mb-1">내 추천 코드</div>
                    <div className="text-xl font-mono font-extrabold text-[var(--text)] tracking-wider">
                      {referral.code}
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(`https://www.owner-view.com/auth?ref=${referral.code}`);
                      setReferralCopied(true);
                      setTimeout(() => setReferralCopied(false), 2000);
                    }}
                    className="px-4 py-2 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition"
                  >
                    {referralCopied ? "복사됨!" : "링크 복사"}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 rounded-xl bg-[var(--bg-surface)] text-center">
                    <div className="text-2xl font-extrabold text-blue-600 dark:text-blue-400">{referral.referred_count || 0}</div>
                    <div className="text-xs text-[var(--text-muted)]">추천 가입</div>
                  </div>
                  <div className="p-4 rounded-xl bg-[var(--bg-surface)] text-center">
                    <div className="text-2xl font-extrabold text-purple-600 dark:text-purple-400">₩{((referral.credit_earned || 0)).toLocaleString()}</div>
                    <div className="text-xs text-[var(--text-muted)]">적립 크레딧</div>
                  </div>
                </div>
              </div>
            ) : (
              <button
                onClick={() => createReferral.mutate()}
                disabled={createReferral.isPending}
                className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50"
              >
                {createReferral.isPending ? "생성 중..." : "추천 코드 생성하기"}
              </button>
            )}
          </div>

          <div className="bg-[var(--bg-card)] rounded-2xl border border-[var(--border)] p-6">
            <h3 className="font-bold text-[var(--text)] mb-1">피드백</h3>
            <p className="text-xs text-[var(--text-muted)] mb-4">OwnerView를 더 좋게 만들어 주세요</p>

            {fbSent ? (
              <div className="text-center py-6">
                <div className="text-3xl mb-2">🙏</div>
                <p className="font-semibold text-[var(--text)]">피드백 감사합니다!</p>
                <p className="text-xs text-[var(--text-muted)] mt-1">검토 후 반영하겠습니다.</p>
                <button onClick={() => setFbSent(false)} className="mt-3 text-sm text-blue-600 hover:underline">
                  추가 피드백
                </button>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2 flex-wrap">
                  {[
                    { key: "feature_request", label: "기능 요청" },
                    { key: "bug_report", label: "버그 제보" },
                    { key: "ux_improvement", label: "UX 개선" },
                    { key: "general", label: "일반" },
                  ].map((c) => (
                    <button
                      key={c.key}
                      onClick={() => setFbCategory(c.key)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold transition ${
                        fbCategory === c.key
                          ? "bg-blue-600 text-white"
                          : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
                      }`}
                    >
                      {c.label}
                    </button>
                  ))}
                </div>
                <input
                  type="text"
                  value={fbTitle}
                  onChange={(e) => setFbTitle(e.target.value)}
                  placeholder="제목"
                  className="w-full px-4 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)]"
                />
                <textarea
                  value={fbDesc}
                  onChange={(e) => setFbDesc(e.target.value)}
                  placeholder="상세 내용 (선택)"
                  rows={3}
                  className="w-full px-4 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)] resize-none"
                />
                <button
                  onClick={() => submitFeedback.mutate()}
                  disabled={!fbTitle.trim() || submitFeedback.isPending}
                  className="px-6 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50"
                >
                  {submitFeedback.isPending ? "전송 중..." : "피드백 보내기"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowUpgradeModal(null)}>
          <div className="bg-[var(--bg-card)] rounded-2xl p-6 max-w-md w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold text-[var(--text)] mb-2">플랜 변경</h3>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              {showUpgradeModal === "free"
                ? "Free 플랜으로 다운그레이드하시겠습니까? 현재 결제 기간이 끝나면 기능이 제한됩니다."
                : `${showUpgradeModal.charAt(0).toUpperCase() + showUpgradeModal.slice(1)} 플랜으로 업그레이드합니다.`}
            </p>
            <div className="bg-[var(--bg-surface)] rounded-xl p-4 mb-4">
              <div className="text-xs text-[var(--text-muted)] mb-1">변경 후 예상 금액</div>
              <div className="text-xl font-extrabold text-[var(--text)]">
                {showUpgradeModal === "free" ? "무료" : (() => {
                  const p = (plans || []).find((pl: any) => pl.slug === showUpgradeModal);
                  if (!p) return "-";
                  const base = cycle === "annual" ? Math.round(p.base_price * 0.8) : p.base_price;
                  const seat = cycle === "annual" ? Math.round(p.per_seat_price * 0.8) : p.per_seat_price;
                  const total = base + seat * (subscription?.seat_count || 1);
                  return `₩${total.toLocaleString()}/월`;
                })()}
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setShowUpgradeModal(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[var(--bg-surface)] text-[var(--text)] hover:bg-[var(--border)] transition"
              >
                취소
              </button>
              <button
                disabled={isPaymentLoading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-blue-600 text-white hover:bg-blue-700 transition disabled:opacity-50"
                onClick={async () => {
                  if (showUpgradeModal === "free") {
                    setShowUpgradeModal(null);
                    // Stripe 구독자는 portal에서 정식 해지 → 결제기간 종료시 free 전환 (직접 DB조작 금지)
                    if (hasStripeSubscription) {
                      await handleOpenPortal();
                      return;
                    }
                    if (!subscription?.id) return;
                    await db.from('subscriptions').update({
                      status: 'canceled',
                      cancel_reason: '사용자 다운그레이드 (Free)',
                      canceled_at: new Date().toISOString(),
                      updated_at: new Date().toISOString(),
                    }).eq('id', subscription.id);
                    qc.invalidateQueries({ queryKey: ['subscription'] });
                    toast("Free 플랜으로 변경되었습니다.", "success");
                    return;
                  }

                  setShowUpgradeModal(null);
                  // 이미 Stripe 구독자이면 portal에서 플랜 변경 (중복 구독 방지)
                  if (hasStripeSubscription && currentSlug !== 'free') {
                    await handleOpenPortal();
                    return;
                  }
                  await handleStripeCheckout(showUpgradeModal);
                }}
              >
                {isPaymentLoading ? "로딩 중..." : showUpgradeModal === "free" ? "다운그레이드" : "결제하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setShowCancelModal(false)}>
          <div className="bg-[var(--bg-card)] rounded-2xl p-6 max-w-md w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold text-red-600 dark:text-red-400 mb-2">구독 해지</h3>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              현재 결제 기간이 끝나면 Free 플랜으로 전환됩니다. 데이터는 유지됩니다.
            </p>
            <textarea
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="해지 사유를 알려주시면 서비스 개선에 참고하겠습니다 (선택)"
              rows={3}
              className="w-full px-4 py-2.5 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm text-[var(--text)] focus:outline-none focus:border-red-400 resize-none mb-4"
            />
            <div className="flex gap-2">
              <button
                onClick={() => setShowCancelModal(false)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[var(--bg-surface)] text-[var(--text)] hover:bg-[var(--border)] transition"
              >
                유지하기
              </button>
              <button
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-red-600 text-white hover:bg-red-700 transition"
                onClick={async () => {
                  try {
                    if (subscription?.id) {
                      await db.from('subscriptions').update({
                        status: 'canceled',
                        cancel_reason: cancelReason || null,
                        canceled_at: new Date().toISOString(),
                        updated_at: new Date().toISOString(),
                      }).eq('id', subscription.id);

                      await db.from('billing_events').insert({
                        company_id: companyId,
                        event_type: 'subscription_cancel',
                        metadata: { plan: currentSlug, reason: cancelReason },
                      });

                      qc.invalidateQueries({ queryKey: ['subscription'] });
                      toast("해지 요청이 접수되었습니다. 현재 결제 기간 종료 후 Free로 전환됩니다.", "success");
                    }
                  } catch {
                    toast("해지 처리 중 오류가 발생했습니다.", "error");
                  }
                  setShowCancelModal(false);
                }}
              >
                해지 확인
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
