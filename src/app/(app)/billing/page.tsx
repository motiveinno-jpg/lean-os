"use client";
import { kstDateStr } from "@/lib/kst";
import { Ico } from "@/components/ui-icon";
import { logRead } from "@/lib/log-read";

import { useState, useEffect } from "react";
import { friendlyError } from "@/lib/friendly-error";
import { logError } from "@/lib/error-logger";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { getIssuanceStatus } from "@/lib/billing";
import { supabase } from "@/lib/supabase";
import { track } from "@/lib/analytics";
import { useToast } from "@/components/toast";
import { recordConsent } from "@/lib/legal";
import { useUser } from "@/components/user-context";
import { QueryErrorBanner } from "@/components/query-status";
import { AccessDenied } from "@/components/access-denied";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { useConfirm } from "@/components/confirm-dialog";
import { useMyPermissions } from "@/lib/permissions";
import { TossCardSection } from "./_components/TossCardSection";

// 신규 테이블 타입이 아직 database.ts에 없으므로 any 캐스팅
const db = supabase;

type Tab = "plan" | "credits" | "payment" | "invoices";
type BillingCycle = "monthly" | "annual";

// 2026-08-06 요금제 개편 — 무료(영구) + 오너뷰 단일 유료(2026-08-11 39,000원·VAT 별도). 구 티어는 기존 구독자 표시용으로만 남긴다.
const PLAN_FEATURES: Record<string, { icon: string; features: string[]; recommended?: boolean }> = {
  free: { icon: "🎁", features: ["구성원 5명", "전자결재·근태·급여·프로젝트·게시판 무제한", "세금계산서 발행 월 5건 · 현금영수증 발행 월 5건", "전자계약 월 5건", "AI 참모 월 10만 토큰", "통장·카드 3개까지 연결 · 하루 2회 자동 동기화", "AI 브리핑은 기본형(요약 규칙)"] },
  standard: { icon: "⚡", recommended: true, features: ["기본 5명 포함 · 추가 1명 ₩5,000/월", "세금계산서 발행 월 100건 · 현금영수증 발행 월 100건", "전자계약 무제한", "통장·카드 무제한 연결 · 하루 2회 자동 + 필요할 때 즉시 동기화", "홈택스 자동 수집", "AI 대표 참모 월 50만 토큰", "AI 브리핑(매일 자동 분석)"] },
  // 구 요금제(프로·울트라·엔터프라이즈)는 2026-08-07 판매 종료 — 목록은 is_active 로 걸러진다.
  //   기존 구독자의 한도·권한은 subscription_plans 행이 남아 있어 그대로 유지된다.
};

function fmtW(n: number): string {
  if (n === 0) return "무료";
  return `₩${n.toLocaleString()}`;
}

// 연간 결제 노출 여부. Stripe 라이브 연간 price(STRIPE_PRICE_*_ANNUAL) 등록 전까지는
//   고르면 서버가 400 으로 막으므로 화면에서도 감춘다. 등록 후 true 로 바꾸면 열린다.
const ANNUAL_BILLING_AVAILABLE = true;
// 연간 할인율 표기 — lib/billing.ts 의 ANNUAL_DISCOUNT_RATE 와 같은 값을 유지할 것.
const ANNUAL_DISCOUNT_DISPLAY = 0.1;

export default function BillingPage() {
  const { role } = useUser();
  // 게이트 early return 뒤 훅 = React #310 결함류 — 본문 분리 (2026-08-03)
  if (role === "partner" /* (P3) 멤버는 권한 게이트가 판정 */) {
    return <AccessDenied detail="요금제 / 결제는 회사 구성원 전용입니다 (외부 파트너 제외)." />;
  }
  return <BillingPageInner />;
}

function BillingPageInner() {
  const { toast } = useToast();
  // 결제수단 등록은 마스터만 — 서버(엣지 함수)에서도 동일하게 막는다.
  const { isMaster: billingIsMaster } = useMyPermissions();
  const [tab, setTab] = useState<Tab>("plan");
  const [cycle, setCycle] = useState<BillingCycle>("monthly"); // 2026-07-22 연간 토글 복원 (연간 10% 할인)
  const [showCancelModal, setShowCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState("");
  const [showUpgradeModal, setShowUpgradeModal] = useState<string | null>(null);
  const [isPaymentLoading, setIsPaymentLoading] = useState(false);
  // 영업사원 영업코드 — 무료체험 폐지(2026-08-11) 후 영업 실적 추적용 기록만 남는다.
  //   유효성은 서버(/api/stripe/checkout)가 판정한다 — 클라에서 코드 목록을 조회할 수 없다.
  const [salesCode, setSalesCode] = useState("");
  // 연간 결제 "중도해지 시 환불 불가" 동의 — 약관규제법상 고객에게 불리한 중요 조항은
  //   약관 게시만으로 부족하고 결제 시점에 명확히 고지·확인받아야 한다(2026-07-27 사장님 요청).
  const [annualRefundAck, setAnnualRefundAck] = useState(false);
  const qc = useQueryClient();

  const { data: user, isLoading: isUserLoading, error: mainError, refetch: mainRefetch } = useQuery({ queryKey: ["currentUser"], queryFn: getCurrentUser });
  const companyId = user?.company_id;

  // 충전 잔액·이력 (2026-08-07) — 월 제공량을 다 쓴 뒤 이어 쓰는 잔액.
  //   적립은 결제 웹훅에서만 일어난다. 여기서는 보여주고 결제창을 열 뿐이다.
  const { data: credits, refetch: refetchCredits } = useQuery({
    queryKey: ["credit-balance", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const { data } = await supabase
        .from("credit_balances").select("ai_tokens, issue_credits").eq("company_id", companyId).maybeSingle();
      return data ?? { ai_tokens: 0, issue_credits: 0 };
    },
    enabled: !!companyId,
  });
  const { data: creditHistory = [] } = useQuery({
    queryKey: ["credit-purchases", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const { data } = await supabase
        .from("credit_purchases")
        .select("id, kind, quantity, amount_krw, status, created_at, paid_at")
        .eq("company_id", companyId).order("created_at", { ascending: false }).limit(20);
      return data || [];
    },
    enabled: !!companyId && tab === "credits",
  });
  const [issuePacks, setIssuePacks] = useState(1);
  const [tokenPacks, setTokenPacks] = useState(1);
  const [creditLoading, setCreditLoading] = useState<string | null>(null);

  // 결제 후 ?credit=success 로 돌아오면 충전 탭을 열고 잔액을 다시 읽는다.
  //   적립은 웹훅이 하므로 몇 초 늦을 수 있어 잠깐 뒤 한 번 더 조회한다.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("credit");
    if (!q) return;
    setTab("credits");
    if (q === "success") {
      toast("결제가 완료됐습니다. 잠시 후 잔액에 반영됩니다.", "success");
      refetchCredits();
      const t = setTimeout(() => refetchCredits(), 4000);
      window.history.replaceState({}, "", "/billing");
      return () => clearTimeout(t);
    }
    window.history.replaceState({}, "", "/billing");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function startTopUp(kind: "issue" | "ai_tokens", packs: number) {
    setCreditLoading(kind);
    try {
      const res = await fetch("/api/stripe/credits", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind, packs,
          successUrl: `${window.location.origin}/billing?credit=success`,
          cancelUrl: `${window.location.origin}/billing?credit=cancel`,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || "충전을 시작하지 못했습니다");
      window.location.href = json.data.url;
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "충전을 시작하지 못했습니다", "error");
      setCreditLoading(null);
    }
  }

  // 사용량 통계 (현재 월 기준)
  const { data: usage } = useQuery({
    queryKey: ["usage", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0,0,0,0);
      const iso = monthStart.toISOString();
      const [emp, deals, sigs, partners, codef] = await Promise.all([
        db.from("employees").select("id", { count: "exact", head: true }).eq("company_id", companyId).in("status", ["active", "joined"]),
        db.from("deals").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        db.from("signature_requests").select("id", { count: "exact", head: true }).eq("company_id", companyId).gte("created_at", iso),
        db.from("partners").select("id", { count: "exact", head: true }).eq("company_id", companyId),
        // CODEF 동기화 크레딧 — codef_usage 원장(units=과금 추정 건수)의 이번 달 합계.
        //   테이블 미생성(마이그 미적용) 시 error 로 떨어지고 0으로 폴백 — 화면은 항상 정상.
        db.from("codef_usage").select("units").eq("company_id", companyId).gte("created_at", iso).limit(2000),
      ]);
      // ai_usage_logs 테이블 미존재(AI 사용량 미추적) — 쿼리 제거(404 방지). 추적 도입 시 복원.
      return {
        employees: emp.count || 0,
        deals: deals.count || 0,
        signatures: sigs.count || 0,
        aiCalls: 0,
        partners: partners.count || 0,
        codefUnits: ((codef.data as { units: number }[] | null) || []).reduce((s, r) => s + (r.units || 0), 0),
      };
    },
    enabled: !!companyId,
  });

  // 발행 사용량(세금계산서·현금영수증 각각, 2026-08-11 분리) — 각 화면 칩과 같은 산식(getIssuanceStatus).
  //   요금제 화면에서도 발행 한도를 한눈에 (2026-08-11 사장님).
  const { data: issuance } = useQuery({
    queryKey: ["issuance-status-billing", companyId],
    queryFn: () => getIssuanceStatus(companyId!),
    enabled: !!companyId,
    staleTime: 60_000,
  });

  // 요금제 목록
  // 연간 결제 혜택 쿠폰 — 추가인원 12명 무료 등록 (2026-07-30 사장님)
  const { data: seatCoupons = [] } = useQuery({
    queryKey: ["seat-coupons", companyId],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("billing_seat_coupons")
        .select("id, free_seats, status, issued_at, redeemed_at")
        .eq("company_id", companyId)
        .order("issued_at", { ascending: false });
      return data || [];
    },
    enabled: !!companyId,
  });
  const redeemCouponMut = useMutation({
    mutationFn: async (couponId: string) => {
      const { data, error } = await (supabase as any).rpc("redeem_seat_coupon", { p_coupon_id: couponId });
      if (error) throw error;
      if (!data?.ok) throw new Error(data?.error || "쿠폰 사용 실패");
      return data;
    },
    onSuccess: (d: any) => {
      toast(`쿠폰이 적용되었습니다 — 추가인원 ${d.free_seats}명이 무료로 등록됩니다`, "success");
      qc.invalidateQueries({ queryKey: ["seat-coupons", companyId] });
    },
    onError: (e: any) => toast(friendlyError(e, "쿠폰 사용 실패"), "error"),
  });
  const redeemedFreeSeats = (seatCoupons as any[]).filter((c) => c.status === "redeemed").reduce((s, c) => s + Number(c.free_seats || 0), 0);

  const { data: plans } = useQuery({
    queryKey: ["plans"],
    queryFn: async () => {
      const data = logRead('billing/page:data', await db.from("subscription_plans").select("*").eq("is_active", true).order("sort_order"));
      return data || [];
    },
  });

  // 현재 구독
  const { data: subscription } = useQuery({
    queryKey: ["subscription", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const data = logRead('billing/page:data', await db
        .from("subscriptions")
        .select("*, subscription_plans(*)")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(1)
        .maybeSingle());
      return data;
    },
    enabled: !!companyId,
  });

  // entitlement 단일 소스(get_company_entitlement RPC) — 해지 예약/유효기간/실효 플랜 표시.
  //   RLS: SECURITY DEFINER + 호출자 회사 검증 가드(타 회사 조회 시 none 반환).
  const { data: entitlement } = useQuery({
    queryKey: ["entitlement", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const { data } = await (db as any).rpc("get_company_entitlement", { p_company_id: companyId });
      return (Array.isArray(data) ? data[0] : data) as {
        effective_plan_slug: string; entitled: boolean; cancel_at_period_end: boolean;
        effective_until: string | null; display_status: string;
      } | null;
    },
    enabled: !!companyId,
  });

  // 청구서 목록
  const { data: invoices, isLoading: invoicesLoading } = useQuery({
    queryKey: ["invoices", companyId],
    queryFn: async () => {
      if (!companyId) return [];
      const data = logRead('billing/page:data', await db
        .from("invoices")
        .select("*")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false }));
      return data || [];
    },
    enabled: !!companyId,
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

  // entitlement 기반 표시: 해지 예약 중이면 기존 플랜 유지 노출, 실효(만료/해지 완료) 시 Free.
  const cancelScheduled = entitlement?.display_status === "cancel_scheduled";
  const { confirm: confirmDialog, confirmElement } = useConfirm();

  // 등록 카드 목록 (2026-08-05 사장님: 카드 삭제 가능하게) — 결제 수단 탭에서만 조회
  const { data: pmData, isLoading: pmLoading } = useQuery({
    queryKey: ["payment-methods", companyId],
    queryFn: async () => {
      const res = await fetch("/api/stripe/payment-methods");
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error?.message || "카드 조회 실패");
      return j.data as { cards: { id: string; brand: string; last4: string; expMonth: number | null; expYear: number | null; isDefault: boolean }[]; cancelScheduled: boolean };
    },
    enabled: tab === "payment" && hasStripeSubscription,
    retry: 1,
  });
  const deleteCardMut = useMutation({
    mutationFn: async (pmId: string) => {
      const res = await fetch("/api/stripe/payment-methods", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "detach", paymentMethodId: pmId }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j.error?.message || "카드 삭제 실패");
    },
    onSuccess: () => {
      toast("카드가 삭제되었습니다.", "success");
      qc.invalidateQueries({ queryKey: ["payment-methods", companyId] });
    },
    onError: (e: any) => toast(friendlyError(e, "카드 삭제에 실패했습니다."), "error"),
  });
  const planDisplayName = entitlement?.entitled
    ? (currentPlan?.name || "Free")
    : "Free";
  const effectiveUntilStr = entitlement?.effective_until
    ? kstDateStr(new Date(entitlement.effective_until))
    : null;

  /** Stripe Checkout */
  async function handleStripeCheckout(planSlug: string) {
    if (!companyId) return;
    // 연간은 환불 불가 고지에 동의해야만 진행 — 동의 없이는 결제 세션을 만들지 않는다.
    if (cycle === "annual" && !annualRefundAck) {
      toast("연간 결제는 환불 불가 안내에 동의해야 진행할 수 있습니다.", "error");
      return;
    }
    // 연간 동의는 결제 건마다 남긴다(가입 동의와 달리 1회성이 아님).
    if (cycle === "annual") {
      const { data: { user: authUser } } = await supabase.auth.getUser();
      if (authUser) {
        await recordConsent({
          authId: authUser.id,
          consentType: "annual_billing_no_refund",
          companyId,
          context: { planSlug, billingCycle: cycle, seatCount: usage?.employees || 1 },
        });
      }
    }
    setIsPaymentLoading(true);
    track("checkout_start", { plan: planSlug, cycle }); // 계측 — 결제 페이지로 넘어가기 직전
    try {
      const response = await fetch('/api/stripe/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          planSlug,
          companyId,
          // 좌석 수 = 현재 활성 직원 수(서버가 다시 검증). 기본 5명 포함, 초과분만 추가 과금.
          seatCount: usage?.employees || 1,
          // 결제주기 — 화면 토글값. 연간은 1년치를 한 번에 청구(체험 종료 후).
          billingCycle: cycle,
          // 영업코드(선택) — 서버가 유효성 검증 후 결제 메타데이터에 기록(추적용). 잘못된 코드면 400.
          salesCode: salesCode.trim() || undefined,
          successUrl: `${window.location.origin}/billing?payment=success`,
          cancelUrl: `${window.location.origin}/billing?payment=cancel`,
        }),
      });
      const result = await response.json();
      if (!response.ok) {
        const code = result.error?.code as string | undefined;
        const serverMsg = result.error?.message || "결제 세션 생성 실패";
        // 서버가 이미 한국어로 안내하는 사용자 원인 오류는 그대로 보여준다
        if (code === "CYCLE_UNAVAILABLE" || code === "INVALID_SALES_CODE" || code === "VALIDATION_ERROR" || code === "FORBIDDEN") {
          toast(serverMsg, "error");
          setIsPaymentLoading(false);
          return;
        }
        // 원인 불명(500 등) — 실제 서버 메시지는 사용자에게 숨겨지므로(friendlyError 가
        // 영문·기술 메시지를 일반 문구로 대체) error_logs 에 남겨 운영자가 추적 가능하게 (2026-07-28)
        logError({
          source: "manual",
          message: `[stripe-checkout] ${code || response.status}: ${serverMsg}`,
          context: { planSlug, billingCycle: cycle, seatCount: usage?.employees || 1 },
        });
        throw new Error("결제 시스템 연결에 문제가 발생했습니다. 잠시 후 다시 시도해 주세요.");
      }
      window.location.href = result.data.url;
    } catch (err: any) {
      toast(friendlyError(err, "결제 처리 중 오류가 발생했습니다."), "error");
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
      setIsPaymentLoading(false);
      // 포털 실패 폴백(2026-08-05 사장님 제보 — Stripe 키의 포털 권한 부족으로 포털이 안 열림):
      //   해지 목적이면 자체 해지 모달로 이어간다. /api/stripe/cancel 은 포털이 아니라
      //   구독 API 권한을 쓰므로 포털이 막혀도 해지는 진행 가능하다.
      if (!cancelScheduled) {
        toast("Stripe 관리 페이지를 열 수 없어 자체 해지로 진행합니다.", "info");
        setShowCancelModal(true);
        return;
      }
      toast(friendlyError(err, "구독 관리 페이지를 열 수 없습니다."), "error");
    }
  }

  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: "plan", label: "요금제", icon: "💳" },
    { key: "credits", label: "충전", icon: "🔋" },
    { key: "payment", label: "결제 수단", icon: "🏦" },
    { key: "invoices", label: "청구서", icon: "🧾" },
  ];

  /** 플랜 변경 모달 확인 */
  async function handleUpgradeConfirm() {
    if (!showUpgradeModal) return;
    if (showUpgradeModal === "free") {
      setShowUpgradeModal(null);
      // Stripe 구독자는 portal에서 정식 해지 → 결제기간 종료시 free 전환 (직접 DB조작 금지)
      if (hasStripeSubscription) {
        await handleOpenPortal();
        return;
      }
      if (!subscription?.id) return;
      try {
        const res = await fetch('/api/stripe/cancel', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason: '사용자 다운그레이드 (Free)', immediate: true }),
        });
        const result = await res.json();
        if (!res.ok) throw new Error(result.error?.message || 'Free 전환 실패');
        qc.invalidateQueries({ queryKey: ['subscription'] });
        toast("Free 플랜으로 변경되었습니다.", "success");
      } catch (err: any) {
        toast(friendlyError(err, "Free 전환 중 오류가 발생했습니다."), "error");
      }
      return;
    }

    const slug = showUpgradeModal;
    setShowUpgradeModal(null);
    // 이미 Stripe 구독자이면 portal에서 플랜 변경 (중복 구독 방지)
    if (hasStripeSubscription && currentSlug !== 'free') {
      await handleOpenPortal();
      return;
    }
    await handleStripeCheckout(slug);
  }

  /** 구독 해지 모달 확인 — 서버에서 Stripe 취소까지 수행(클라 DB 직접조작 금지) */
  async function handleCancelConfirm() {
    try {
      const res = await fetch('/api/stripe/cancel', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: cancelReason || null }),
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error?.message || '해지 처리 실패');
      qc.invalidateQueries({ queryKey: ['subscription'] });
      toast("해지 요청이 접수되었습니다. 현재 결제 기간 종료 후 Free로 전환됩니다.", "success");
    } catch (err: any) {
      toast(friendlyError(err, "해지 처리 중 오류가 발생했습니다."), "error");
    }
    setShowCancelModal(false);
  }

  useModalKeys(!!showUpgradeModal, () => setShowUpgradeModal(null), isPaymentLoading ? undefined : handleUpgradeConfirm);
  useModalKeys(showCancelModal, () => setShowCancelModal(false), handleCancelConfirm);

  if (isUserLoading) return <div className="p-6 text-center text-[var(--text-muted)]">불러오는 중...</div>;
  if (mainError) return <div className="p-6 text-center text-red-400">데이터를 불러올 수 없습니다. 새로고침해 주세요.</div>;

  return (
    <div className="mx-auto">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />

      {/* 툴바 — 탭(좌) + 액션(우) */}
      <div className="page-sticky-header mb-6">
        <div className="billing-toolbar">
          <div className="seg-bar overflow-x-auto">
            {TABS.map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`seg-item inline-flex items-center gap-1.5 ${tab === t.key ? "seg-item-active" : ""}`}
              >
                <span><Ico e={t.icon} tone="mono" /></span> {t.label}
              </button>
            ))}
          </div>
          {hasStripeSubscription && (
            <button
              onClick={handleOpenPortal}
              disabled={isPaymentLoading}
              className="btn-secondary"
            >
              {isPaymentLoading ? "로딩 중..." : "구독 관리"}
            </button>
          )}
        </div>
      </div>

      {/* 업그레이드 배너 — 무료 플랜이면 노출 (2026-08-06 개편: 무료가 영구 플랜이 되어 '체험 만료' 개념이 사라짐) */}
      {entitlement && entitlement.effective_plan_slug === "free" && subscription?.status !== "trialing" && (
        <div className="billing-trial-start-banner">
          <div>
            <div className="font-bold text-sm text-[var(--text)]">지금은 무료 플랜입니다</div>
            <div className="text-xs text-[var(--text-muted)] mt-0.5">
              월 <b>39,000원</b>(VAT 별도)이면 세금계산서 월 100건·현금영수증 월 100건, 전자계약 무제한,
              <b> 통장·카드 무제한 연결 + 필요할 때 즉시 동기화</b>까지 열립니다. 기본 5명 포함, 추가 1명당 5,000원.
            </div>
            {/* 영업코드 — 영업 실적 추적용 기록(무료체험 폐지, 2026-08-11). 코드가 없으면 비워두면 된다. */}
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <input
                value={salesCode}
                onChange={(e) => setSalesCode(e.target.value.toUpperCase())}
                placeholder="영업코드 (선택)"
                className="px-3 py-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-xs w-[180px] focus:outline-none focus:border-[var(--primary)]"
              />
              <span className="text-[11px] text-[var(--text-dim)]">
                {salesCode.trim()
                  ? "결제 시 영업코드가 함께 기록됩니다"
                  : "영업 담당자에게 받은 코드가 있다면 입력하세요"}
              </span>
            </div>
          </div>
          <button
            onClick={() => {
              // 이 배너는 요금제 탭에서도 보이므로 setTab 만으론 무반응 (2026-07-28 사장님 제보)
              //   → 탭 전환 + 플랜 카드로 스크롤
              setTab("plan");
              setTimeout(() => document.getElementById("billing-plan-cards")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
            }}
            className="btn-primary btn-sm whitespace-nowrap"
          >플랜 선택하고 시작</button>
        </div>
      )}

      {/* KPI 행 — 현재 플랜 · 월 결제 금액 · 다음 결제 · 사용량 */}
      <div className="billing-kpi-row">
        <div className="stat-tile">
          <div className="stat-tile-label">현재 플랜</div>
          <div className="stat-tile-value">{planDisplayName}</div>
          {cancelScheduled && effectiveUntilStr ? (
            <div className="billing-cancel-scheduled-badge">
              {effectiveUntilStr}까지 이용 가능 · 이후 Free 전환
            </div>
          ) : (
            <div className="text-xs text-[var(--text-dim)]">
              {subscription?.seat_count || 1}명 · {subscription?.billing_cycle === "annual" ? "연간" : "월간"} 결제
            </div>
          )}
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">월 결제 금액</div>
          <div className="stat-tile-value text-[var(--primary)]">
            {fmtW((currentPlan?.base_price || 0) + (currentPlan?.per_seat_price || 0) * Math.max(0, (subscription?.seat_count || 1) - (currentPlan?.included_seats || 0)))}
          </div>
          <div className="text-xs text-[var(--text-dim)]">기본 {currentPlan?.included_seats || 5}명 포함 · VAT 별도</div>
        </div>
        <div className="stat-tile">
          {/* 해지 예약이면 결제 예정이 아니라 '이용 종료 예정'이다 — 결제 문구가 남아 있으면 해지가 안 된 걸로 오해(2026-08-05 사장님) */}
          <div className="stat-tile-label">{cancelScheduled ? "이용 종료 예정" : subscription?.status === "trialing" ? "첫 결제 예정일" : "다음 결제"}</div>
          {cancelScheduled ? (
            <>
              <div className="stat-tile-value">{effectiveUntilStr || "—"}</div>
              <div className="text-xs text-[var(--text-dim)]">해지 예약됨 · 이날까지 이용 후 결제 없이 Free 전환</div>
            </>
          ) : subscription?.status === "trialing" ? (
            <>
              <div className="stat-tile-value">
                {subscription?.trial_ends_at ? kstDateStr(new Date(subscription.trial_ends_at)) : "—"}
              </div>
              <div className="text-xs text-[var(--warning)]">무료체험 종료 · 이날 선택 플랜 자동 결제</div>
            </>
          ) : (
            <>
              <div className="stat-tile-value">
                {subscription?.current_period_end ? kstDateStr(new Date(subscription.current_period_end)) : "—"}
              </div>
              <div className="text-xs text-[var(--text-dim)]">{hasStripeSubscription ? "자동 결제 예정" : "결제 수단 미등록"}</div>
            </>
          )}
        </div>
        <div className="stat-tile">
          <div className="stat-tile-label">활성 직원</div>
          <div className="stat-tile-value">
            {usage ? `${usage.employees.toLocaleString()}명` : "—"}
          </div>
          <div className="text-xs text-[var(--text-dim)]">이번 달 전자서명 {usage?.signatures ?? 0}건</div>
        </div>
      </div>

      {/* 충전 탭 — 월 제공량을 다 쓴 뒤 이어 쓰는 잔액 (2026-08-07) */}
      {tab === "credits" && (
        <div className="billing-credits">
          <div className="billing-credit-balances">
            <div className="billing-credit-balance glass-card">
              <div className="caption">남은 발행 충전</div>
              <div className="billing-credit-amount mono-number">{(credits?.issue_credits ?? 0).toLocaleString()}<span className="billing-credit-unit">건</span></div>
              <p className="billing-credit-hint">요금제의 월 제공량을 먼저 쓰고, 다 쓰면 여기서 빠집니다.</p>
            </div>
            <div className="billing-credit-balance glass-card">
              <div className="caption">남은 AI 토큰 충전</div>
              <div className="billing-credit-amount mono-number">{(credits?.ai_tokens ?? 0).toLocaleString()}<span className="billing-credit-unit">토큰</span></div>
              <p className="billing-credit-hint">유효기간 없이 다 쓸 때까지 이월됩니다.</p>
            </div>
          </div>

          <div className="billing-credit-shop glass-card">
            <h3 className="section-title">충전하기</h3>
            <p className="text-[11px] text-[var(--text-dim)] mb-4">결제하면 바로 잔액에 더해집니다. 금액은 VAT 별도입니다.</p>

            <div className="billing-credit-item">
              <div className="min-w-0">
                <div className="text-sm font-bold">세금계산서·현금영수증 발행</div>
                <div className="caption">10건 묶음 · 3,000원 (건당 300원)</div>
              </div>
              <div className="billing-credit-buy">
                <input
                  type="number" min={1} max={100} value={issuePacks}
                  onChange={(e) => setIssuePacks(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                  className="billing-credit-qty field-input"
                />
                <span className="caption">묶음 = {(issuePacks * 10).toLocaleString()}건</span>
                <button
                  onClick={() => startTopUp("issue", issuePacks)}
                  disabled={creditLoading !== null}
                  className="btn-primary btn-sm disabled:opacity-50"
                >
                  {creditLoading === "issue" ? "이동 중..." : `${(issuePacks * 3000).toLocaleString()}원 결제`}
                </button>
              </div>
            </div>

            <div className="billing-credit-item">
              <div className="min-w-0">
                <div className="text-sm font-bold">AI 참모 토큰</div>
                <div className="caption">50만 토큰 묶음 · 10,000원</div>
              </div>
              <div className="billing-credit-buy">
                <input
                  type="number" min={1} max={100} value={tokenPacks}
                  onChange={(e) => setTokenPacks(Math.min(100, Math.max(1, Number(e.target.value) || 1)))}
                  className="billing-credit-qty field-input"
                />
                <span className="caption">묶음 = {(tokenPacks * 50).toLocaleString()}만 토큰</span>
                <button
                  onClick={() => startTopUp("ai_tokens", tokenPacks)}
                  disabled={creditLoading !== null}
                  className="btn-primary btn-sm disabled:opacity-50"
                >
                  {creditLoading === "ai_tokens" ? "이동 중..." : `${(tokenPacks * 10000).toLocaleString()}원 결제`}
                </button>
              </div>
            </div>

            <p className="text-[11px] text-[var(--text-dim)] mt-3">
              충전은 유료 요금제에서 이용할 수 있습니다. 무료 요금제는 월 제공량까지만 사용합니다.
            </p>
          </div>

          <div className="billing-credit-history glass-card">
            <h3 className="section-title">충전 내역</h3>
            {creditHistory.length === 0 ? (
              <div className="templates-empty">아직 충전한 내역이 없습니다.</div>
            ) : (
              <div className="space-y-1.5">
                {creditHistory.map((h) => (
                  <div key={h.id} className="billing-credit-history-row">
                    <div>
                      <div className="text-xs font-semibold">
                        {h.kind === "issue" ? "발행" : "AI 토큰"} {Number(h.quantity).toLocaleString()}{h.kind === "issue" ? "건" : "토큰"}
                      </div>
                      <div className="caption">{kstDateStr(new Date(h.created_at))}</div>
                    </div>
                    <div className="text-right">
                      <div className="text-xs font-bold mono-number">{Number(h.amount_krw).toLocaleString()}원</div>
                      <div className={`caption ${h.status === "paid" ? "text-[var(--success)]" : ""}`}>
                        {h.status === "paid" ? "충전 완료" : h.status === "pending" ? "결제 대기" : "실패"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Plan Tab */}
      {tab === "plan" && (
        <div>
          {/* 사용량 카드 — 현재 플랜 한도 대비 */}
          {usage && (() => {
            // ⚠️ standard(오너뷰)가 빠져 있어 유료 구독자도 무료 한도(직원 3명·서명 3건)로
            //    표시되고 있었다 (2026-08-07). 9999 = 무제한 표기.
            //    구 요금제(프로·울트라·엔터프라이즈)는 기존 구독자가 남아 있어 그대로 둔다.
            const limits: Record<string, { employees: number; aiCalls: number; signatures: number; partners: number }> = {
              free:       { employees: 5,    aiCalls: 9999, signatures: 5,    partners: 9999 },
              standard:   { employees: 9999, aiCalls: 9999, signatures: 9999, partners: 9999 },
              basic:      { employees: 9999, aiCalls: 9999, signatures: 9999, partners: 9999 },
              ultra:      { employees: 9999, aiCalls: 9999, signatures: 9999, partners: 9999 },
              enterprise: { employees: 9999, aiCalls: 9999, signatures: 9999, partners: 9999 },
            };
            const lim = limits[currentSlug] || limits.free;
            // CODEF 동기화 크레딧 한도 — 플랜의 monthly_credits (null=무제한/미시행 → 측정만 표시)
            const codefLimit = subscription?.subscription_plans?.monthly_credits ?? 9999;
            const items: { label: string; used: number; limit: number }[] = [
              { label: "활성 직원", used: usage.employees, limit: lim.employees },
              { label: "전자서명 (이번 달)", used: usage.signatures, limit: lim.signatures },
              { label: "거래처", used: usage.partners, limit: lim.partners },
              { label: "동기화 크레딧 (이번 달)", used: usage.codefUnits, limit: codefLimit },
              // 발행 한도 — 2026-08-11 개편: 세금계산서·현금영수증 각각. 각 화면 칩과 동일 산식(getIssuanceStatus)
              { label: "세금계산서 발행 (이번 달)", used: issuance?.taxUsed ?? 0, limit: issuance?.taxLimit ?? 9999 },
              { label: "현금영수증 발행 (이번 달)", used: issuance?.cashUsed ?? 0, limit: issuance?.cashLimit ?? 9999 },
            ];
            return (
              <div className="billing-usage-card glass-card">
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-sm font-bold text-[var(--text)]">이번 달 사용량</h3>
                  <span className="text-xs text-[var(--text-muted)]">{new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long" })}</span>
                </div>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  {items.map((it) => {
                    const unlimited = it.limit >= 9999;
                    const pct = unlimited ? 0 : Math.min(100, Math.round((it.used / Math.max(1, it.limit)) * 100));
                    const danger = !unlimited && pct >= 80;
                    const barColor = danger ? "bg-[var(--danger)]" : pct >= 60 ? "bg-[var(--warning)]" : "bg-[var(--primary)]";
                    return (
                      <div key={it.label} className="bg-[var(--bg-surface)] rounded-xl p-4">
                        <div className="mb-1.5"><span className="text-[11px] font-semibold text-[var(--text-dim)] tracking-wide">{it.label}</span></div>
                        <div className="flex items-baseline gap-1">
                          <span className={`text-xl font-black mono-number ${danger ? "text-[var(--danger)]" : "text-[var(--text)]"}`}>{it.used.toLocaleString()}</span>
                          <span className="text-xs text-[var(--text-dim)]">/ {unlimited ? "무제한" : it.limit.toLocaleString()}</span>
                        </div>
                        {!unlimited && (
                          <div className="mt-2 h-1.5 bg-[var(--bg)] rounded-full overflow-hidden">
                            <div className={`h-full ${barColor} transition-all`} style={{ width: `${pct}%` }} />
                          </div>
                        )}
                        {danger && <div className="text-[10px] text-[var(--danger)] mt-1 font-semibold">한도 임박 - 업그레이드 권장</div>}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })()}

          {/* 결제 주기 — 연간은 Stripe 라이브 연간 price 등록 후 열린다.
              ANNUAL_BILLING_AVAILABLE 만 true 로 바꾸면 노출된다(서버 분기는 이미 구현됨). */}
          {ANNUAL_BILLING_AVAILABLE && (
            <div className="mb-5">
              <div className="seg-bar w-fit">
                {([["monthly", "월간"], ["annual", "연간 (10% 할인)"]] as const).map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => { setCycle(k); if (k === "monthly") setAnnualRefundAck(false); }}
                    className={`seg-item ${cycle === k ? "seg-item-active" : ""}`}
                  >
                    {l}
                  </button>
                ))}
              </div>

              {cycle === "annual" && (
                <label className="billing-annual-ack">
                  <input
                    type="checkbox"
                    checked={annualRefundAck}
                    onChange={(e) => setAnnualRefundAck(e.target.checked)}
                    className="mt-0.5 shrink-0"
                  />
                  <span className="text-xs leading-6 text-[var(--text-muted)]">
                    <b className="text-[var(--text)]">
                      연간 결제는 1년치 요금이 한 번에 청구되며, 중도 해지하더라도 환불되지 않습니다.
                    </b>{" "}
                    해지 시 결제한 1년의 잔여기간 동안 추가 비용 없이 계속 이용하실 수 있고, 기간이
                    끝나면 자동 갱신 없이 종료됩니다. 위 내용을 확인했으며 이에 동의합니다.{" "}
                    <a href="/refund" target="_blank" rel="noreferrer" className="underline underline-offset-2 text-[var(--primary)]">
                      환불규정 보기
                    </a>
                  </span>
                </label>
              )}
            </div>
          )}


          {/* 연간 결제 혜택 쿠폰 — 발급/사용 (2026-07-30 사장님) */}
          {(seatCoupons as any[]).length > 0 && (
            <div className="billing-coupon-section">
              <div className="text-xs font-bold text-[var(--text-muted)] uppercase tracking-wider mb-2">내 쿠폰</div>
              <div className="billing-coupon-list">
                {(seatCoupons as any[]).map((c: any) => (
                  <div key={c.id} className={`billing-coupon-card glass-card ${c.status === "redeemed" ? "billing-coupon-card-used" : ""}`}>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-bold text-[var(--text)]">추가인원 {c.free_seats}명 무료 등록 쿠폰</div>
                      <div className="text-[11px] text-[var(--text-muted)] mt-0.5">
                        연간 결제 혜택 · 발급 {new Date(c.issued_at).toLocaleDateString("ko-KR")}
                        {c.status === "redeemed" && c.redeemed_at && <> · 사용 {new Date(c.redeemed_at).toLocaleDateString("ko-KR")}</>}
                      </div>
                      <div className="text-[11px] text-[var(--text-dim)] mt-1">
                        {c.status === "issued"
                          ? "사용하면 기본 5명 외에 추가로 인원을 등록해도 그 인원만큼 추가좌석 요금이 청구되지 않습니다."
                          : "적용 중 — 추가 인원 등록 시 이 쿠폰 좌석만큼은 결제(자동결제 포함)에서 제외됩니다."}
                      </div>
                    </div>
                    {c.status === "issued" ? (
                      <button
                        onClick={() => redeemCouponMut.mutate(c.id)}
                        disabled={redeemCouponMut.isPending}
                        className="btn-primary btn-sm shrink-0"
                      >
                        {redeemCouponMut.isPending ? "적용 중..." : "쿠폰 사용하기"}
                      </button>
                    ) : (
                      <span className="billing-coupon-used-badge">적용 중</span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 결제 가능 카드 안내 — 결제 대행사(Stripe) 가맹점이 해외라 카드사에는 '해외 승인'으로 잡힌다.
              국내전용 카드·해외결제 차단 카드는 승인이 거절되는데, 안내가 없어 원인을 모른 채
              이탈하던 문제(2026-07-31 사장님). 결제 진입 직전인 플랜 선택 위에 고정 노출. */}
          <div className="billing-overseas-card-notice">
            <span className="shrink-0"><Ico e="💳" /></span>
            <span>
              <b className="text-[var(--text)]">해외 결제가 가능한 카드로만 결제됩니다.</b>{" "}
              요금은 원화(KRW)로 청구되지만 결제는 해외 승인으로 처리돼, <b>국내 전용 카드</b>나
              카드사에서 <b>해외 결제를 차단</b>해 둔 카드(법인카드 포함)는 승인이 거절될 수 있습니다.
              결제가 거절되면 카드사에 해외 결제 허용 여부를 확인하시거나 다른 카드로 시도해 주세요.
            </span>
          </div>

          <div id="billing-plan-cards" className="billing-plan-grid scroll-mt-24">
            {(plans || []).map((plan: any) => {
              const slug = plan.slug as string;
              const meta = PLAN_FEATURES[slug] || { icon: "📦", features: [] };
              const isCurrent = currentSlug === slug;
              // 연간을 고르면 할인가로 보여준다 — 종전엔 토글을 바꿔도 월간 정가 그대로였다(2026-08-07).
              //   표기는 '월 환산' 기준이고, 실제 청구는 1년치 일시불이라 아래에 연 총액을 함께 적는다.
              const listMonthly = plan.base_price;
              const monthlyPrice = cycle === "annual"
                ? Math.round(listMonthly * (1 - ANNUAL_DISCOUNT_DISPLAY))
                : listMonthly;
              const monthlySeat = cycle === "annual"
                ? Math.round(plan.per_seat_price * (1 - ANNUAL_DISCOUNT_DISPLAY))
                : plan.per_seat_price;
              const includedSeats = plan.included_seats || 5;

              // Free 플랜은 유료 구독 중일 때만 표시 (다운그레이드 옵션용)
              if (slug === "free" && !entitlement?.entitled) {
                return null;
              }

              return (
                <div
                  key={plan.id}
                  className={`billing-plan-card ${
                    isCurrent
                      ? "border-[var(--primary)] bg-[var(--primary)]/5"
                      : meta.recommended
                      ? "border-[var(--primary)]/40 bg-[var(--bg-card)]"
                      : "border-[var(--border)] bg-[var(--bg-card)]"
                  }`}
                >
                  {meta.recommended && !isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-bold bg-[var(--primary)] text-white">
                      추천
                    </div>
                  )}
                  {isCurrent && (
                    <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-3 py-0.5 rounded-full text-xs font-bold bg-[var(--primary)] text-white">
                      현재 플랜
                    </div>
                  )}
                  <div className="text-center mb-4">
                    <div className="text-2xl mb-2"><Ico e={meta.icon} /></div>
                    <div className="text-lg font-extrabold text-[var(--text)]">{plan.name}</div>
                    <div className="mt-2">
                      {slug === "enterprise" ? (
                        <div className="text-xl font-bold text-[var(--text)]">별도 가격 문의</div>
                      ) : plan.base_price === 0 ? (
                        <>
                          <div className="text-3xl font-extrabold text-[var(--text)]">무료</div>
                          <div className="text-xs text-[var(--text-muted)] mt-1">카드 등록 없이 계속 무료</div>
                        </>
                      ) : (
                        <>
                          {(cycle === "annual" ? listMonthly : Number(plan.list_price || 0)) > monthlyPrice && (
                            <div className="text-sm line-through text-[var(--text-dim)]">
                              ₩{(cycle === "annual" ? listMonthly : Number(plan.list_price)).toLocaleString()}
                            </div>
                          )}
                          <div className="text-3xl font-extrabold text-[var(--text)]">
                            ₩{monthlyPrice.toLocaleString()}
                          </div>
                          <div className="text-xs text-[var(--text-muted)] mt-1">
                            /월 (VAT 별도)
                            {cycle === "annual" && (
                              <div className="mt-0.5">연 ₩{(monthlyPrice * 12).toLocaleString()} 일시 청구 (10% 할인 적용)</div>
                            )}
                            {monthlySeat > 0 && (
                              <div className="mt-0.5">기본 {includedSeats}명 포함 · 추가 1명 ₩{monthlySeat.toLocaleString()}/월</div>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                  {/* flex-1: 리스트가 남는 높이를 차지 → 아래 버튼이 카드 하단 고정 */}
                  <ul className="space-y-2 mb-6 flex-1">
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
                      onClick={() => { window.location.href = "/support"; }}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[var(--bg-surface)] text-[var(--text)] hover:bg-[var(--border)] transition"
                    >
                      가격 문의하기
                    </button>
                  ) : (
                    <button
                      onClick={() => setShowUpgradeModal(slug)}
                      className="w-full py-2.5 rounded-xl text-sm font-semibold bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white transition"
                    >
                      {slug === "free" ? "다운그레이드" : "업그레이드"}
                    </button>
                  )}
                </div>
              );
            })}
          </div>

          {entitlement?.entitled && currentSlug !== "free" && (
            <div className="billing-cancel-section">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-semibold text-sm text-[var(--text)]">
                    {cancelScheduled ? "해지 예약됨" : "구독 해지"}
                  </div>
                  <div className="text-xs text-[var(--text-muted)]">
                    {cancelScheduled && effectiveUntilStr
                      ? `${effectiveUntilStr}까지 기존 플랜을 그대로 이용하고, 이후 Free로 전환됩니다. 예약 취소는 아래에서 가능합니다.`
                      : "현재 결제 기간이 끝나면 Free 플랜으로 전환됩니다."}
                  </div>
                </div>
                {/* 해지는 자체 모달로 통일(2026-08-05 사장님) — 포털은 해지 예약 후 '구독 관리'에만 사용 */}
                {hasStripeSubscription && !cancelScheduled ? (
                  <button
                    onClick={() => setShowCancelModal(true)}
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-[var(--danger)] border border-[var(--danger)]/40 hover:bg-[var(--danger-dim)] transition"
                  >
                    구독 해지
                  </button>
                ) : hasStripeSubscription && cancelScheduled ? (
                  <button
                    onClick={handleOpenPortal}
                    disabled={isPaymentLoading}
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-[var(--danger)] border border-[var(--danger)]/40 hover:bg-[var(--danger-dim)] transition disabled:opacity-50"
                  >
                    {isPaymentLoading ? "로딩 중..." : "구독 관리"}
                  </button>
                ) : cancelScheduled ? (
                  <span className="px-4 py-2 rounded-xl text-sm font-semibold text-[var(--text-muted)] border border-[var(--border)]">
                    예약 완료
                  </span>
                ) : (
                  <button
                    onClick={() => setShowCancelModal(true)}
                    className="px-4 py-2 rounded-xl text-sm font-semibold text-[var(--danger)] border border-[var(--danger)]/40 hover:bg-[var(--danger-dim)] transition"
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
          <div className="billing-payment-method-card glass-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[var(--text)]">결제 수단</h3>
            </div>
            {hasStripeSubscription ? (
              <div className="space-y-2">
                {pmLoading ? (
                  <div className="p-4 rounded-xl bg-[var(--bg-surface)] text-xs text-[var(--text-muted)]">카드 정보를 불러오는 중...</div>
                ) : (pmData?.cards?.length ?? 0) === 0 ? (
                  <div className="p-4 rounded-xl bg-[var(--bg-surface)] text-xs text-[var(--text-muted)]">등록된 카드가 없습니다. 카드 변경으로 새 카드를 등록할 수 있습니다.</div>
                ) : (
                  pmData!.cards.map((card) => (
                    <div key={card.id} className="flex items-center justify-between p-4 rounded-xl bg-[var(--bg-surface)]">
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-10 h-10 rounded-lg bg-[var(--info-dim)] flex items-center justify-center text-[var(--info)] text-lg shrink-0"><Ico e="💳" /></div>
                        <div className="min-w-0">
                          <div className="font-semibold text-sm text-[var(--text)] flex items-center gap-2">
                            <span className="uppercase">{card.brand}</span>
                            <span className="mono-number">**** {card.last4}</span>
                            {card.isDefault && <span className="text-[10px] font-bold px-1.5 py-0.5 rounded-full bg-[var(--info-dim)] text-[var(--info)]">기본</span>}
                          </div>
                          <div className="text-xs text-[var(--text-muted)] mono-number">
                            {card.expMonth && card.expYear ? `만료 ${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}` : "자동 결제 카드"}
                          </div>
                        </div>
                      </div>
                      <button
                        onClick={async () => {
                          if (!(await confirmDialog({
                            title: `카드 삭제 (**** ${card.last4})`,
                            desc: "이 카드를 결제 수단에서 삭제합니다. 구독이 유지 중이면 마지막 카드는 삭제할 수 없습니다.",
                            danger: true,
                          }))) return;
                          deleteCardMut.mutate(card.id);
                        }}
                        disabled={deleteCardMut.isPending}
                        className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--danger)] border border-[var(--danger)]/30 hover:bg-[var(--danger-dim)] transition disabled:opacity-50"
                      >
                        {deleteCardMut.isPending ? "삭제 중..." : "삭제"}
                      </button>
                    </div>
                  ))
                )}
                <div className="flex justify-end">
                  <button
                    onClick={handleOpenPortal}
                    disabled={isPaymentLoading}
                    className="px-3 py-1.5 rounded-lg text-xs font-semibold text-[var(--info)] border border-[var(--info)]/30 hover:bg-[var(--info-dim)] transition disabled:opacity-50"
                  >
                    {isPaymentLoading ? "로딩 중..." : "카드 변경·추가 (Stripe)"}
                  </button>
                </div>
              </div>
            ) : (
              <div className="text-center py-12">
                <div className="text-4xl mb-3"><Ico e="💳" /></div>
                <p className="text-sm font-semibold text-[var(--text-muted)] mb-1">등록된 결제 수단이 없습니다</p>
                <p className="text-xs text-[var(--text-dim)]">유료 플랜 결제 시 Stripe를 통해 카드가 등록됩니다</p>
                <button onClick={() => setTab("plan")} className="btn-secondary btn-sm mt-4">플랜 선택하고 등록하기</button>
              </div>
            )}
          </div>

          {/* 국내카드(토스) 자동결제 — 해외카드 Stripe 와 별도 등록 (2026-08-06) */}
          <TossCardSection companyId={companyId} isMaster={billingIsMaster} />

          <div className="billing-payment-info-card glass-card">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-bold text-[var(--text)]">결제 안내</h3>
            </div>
            <div className="space-y-2 text-sm text-[var(--text-muted)]">
              <div className="flex items-start gap-2"><span>•</span> Stripe를 통해 안전하게 결제됩니다 (PCI DSS Level 1)</div>
              <div className="flex items-start gap-2"><span>•</span> 월간 결제: 매월 동일일에 자동 결제</div>
              <div className="flex items-start gap-2"><span>•</span> 결제 즉시 오너뷰 기능이 열립니다 (무료체험 없음)</div>
              <div className="flex items-start gap-2"><span>•</span> 부가세(VAT) 10%는 별도 청구됩니다</div>
              <div className="flex items-start gap-2"><span>•</span> 결제 실패 시 3일 후 재시도, 3회 실패 시 Free 전환</div>
            </div>
          </div>
        </div>
      )}

      {/* Invoices Tab */}
      {tab === "invoices" && (
        <div className="billing-invoices-card glass-card">
          <div className="p-4 border-b border-[var(--border)]">
            <h3 className="text-sm font-bold text-[var(--text)]">청구서 내역</h3>
          </div>
          {invoicesLoading ? (
            <div className="text-center py-14 text-sm text-[var(--text-muted)]">불러오는 중...</div>
          ) : (invoices || []).length === 0 ? (
            <div className="text-center py-14">
              <div className="text-4xl mb-3"><Ico e="🧾" /></div>
              <p className="text-sm font-semibold text-[var(--text-muted)] mb-1">청구서 내역이 없습니다</p>
              <p className="text-xs text-[var(--text-dim)]">유료 플랜을 시작하면 청구서가 이곳에 표시됩니다</p>
              <button onClick={() => setTab("plan")} className="btn-secondary btn-sm mt-4">유료 플랜 보러가기</button>
            </div>
          ) : (
            <div className="divide-y divide-[var(--border)]">
              {(invoices || []).map((inv: any) => {
                const statusLabel = inv.status === "paid" ? "결제완료" : inv.status === "failed" ? "결제실패" : inv.status === "refunded" ? "환불" : "대기";
                const statusColor = inv.status === "paid" ? "text-green-400" : inv.status === "failed" ? "text-red-400" : inv.status === "refunded" ? "text-orange-400" : "text-yellow-400";
                return (
                  <div key={inv.id} className="flex items-center justify-between p-4 hover:bg-[var(--bg-surface)] transition gap-3 flex-wrap">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-2 h-2 rounded-full flex-shrink-0 ${
                        inv.status === "paid" ? "bg-green-500" : inv.status === "failed" ? "bg-red-500" : inv.status === "refunded" ? "bg-orange-500" : "bg-yellow-500"
                      }`} />
                      <div className="min-w-0">
                        <div className="font-semibold text-sm text-[var(--text)] truncate">{inv.invoice_number}</div>
                        <div className="text-xs text-[var(--text-muted)] truncate">{inv.description || "구독 결제"} · <span className={statusColor}>{statusLabel}</span></div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="text-right">
                        <div className="font-bold text-sm text-[var(--text)]">₩{(inv.total_amount || 0).toLocaleString()}</div>
                        <div className="text-xs text-[var(--text-muted)]">{kstDateStr(new Date(inv.created_at))}</div>
                      </div>
                      <div className="flex gap-1.5">
                        {inv.status === "failed" && hasStripeSubscription && (
                          <button onClick={handleOpenPortal} disabled={isPaymentLoading}
                            className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-red-500/10 text-red-400 hover:bg-red-500/20 transition disabled:opacity-50">
                            재시도
                          </button>
                        )}
                        <button onClick={() => {
                          const w = window.open('', '_blank', 'width=700,height=900');
                          if (!w) { toast('팝업이 차단되었습니다', 'error'); return; }
                          const rows = [
                            ['청구서 번호', inv.invoice_number || '—'],
                            ['상태', statusLabel],
                            ['발행일', kstDateStr(new Date(inv.created_at))],
                            ['설명', inv.description || '구독 결제'],
                            ['소계', `₩${Number(inv.subtotal || inv.total_amount || 0).toLocaleString()}`],
                            ['VAT', `₩${Number(inv.tax_amount || 0).toLocaleString()}`],
                          ];
                          w.document.write(`<html><head><title>${inv.invoice_number || 'Invoice'}</title>
<style>body{font-family:'Apple SD Gothic Neo',sans-serif;padding:40px;color:#000;max-width:600px;margin:0 auto}
h1{font-size:24px;margin:0 0 4px}.sub{color:#666;font-size:12px;margin-bottom:24px}
table{width:100%;border-collapse:collapse;margin:16px 0}
td{padding:8px 0;border-bottom:1px solid #eee;font-size:14px}
td:first-child{color:#666;width:140px}td:last-child{text-align:right;font-weight:600}
.total{font-size:24px;font-weight:900;text-align:right;margin-top:20px;padding-top:16px;border-top:2px solid #000}
.foot{text-align:center;color:#999;font-size:10px;margin-top:40px}</style></head>
<body onload="window.print()"><h1>청구서 / INVOICE</h1><div class="sub">OwnerView (오너뷰) · (주)모티브이노베이션</div>
<table>${rows.map(([k, v]) => `<tr><td>${k}</td><td>${v}</td></tr>`).join('')}</table>
<div class="total">총액: ₩${Number(inv.total_amount || 0).toLocaleString()}</div>
<div class="foot">본 청구서는 전자적으로 발행되었으며 날인이 없어도 유효합니다.</div>
</body></html>`);
                          w.document.close();
                        }} className="px-2.5 py-1.5 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] text-[var(--text)] hover:bg-[var(--border)] transition">
                          PDF
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Upgrade Modal */}
      {showUpgradeModal && (
        <div className="billing-upgrade-modal fixed inset-0" onClick={() => setShowUpgradeModal(null)}>
          <div className="bg-[var(--bg-card)] rounded-2xl p-6 max-w-md w-full shadow-xl" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-extrabold text-[var(--text)] mb-2">플랜 변경</h3>
            <p className="text-sm text-[var(--text-muted)] mb-4">
              {showUpgradeModal === "free"
                ? "Free 플랜으로 다운그레이드하시겠습니까? 현재 결제 기간이 끝나면 기능이 제한됩니다."
                : `${(plans || []).find((pl: any) => pl.slug === showUpgradeModal)?.name || showUpgradeModal} 플랜으로 업그레이드합니다.`}
            </p>
            {/* 금액 내역 — 기본요금 + 인원 추가를 항목으로 풀어서 (2026-08-11 사장님:
                "39,000원 눌렀는데 74,000원이라고 나오면 오해한다"). 좌석 기준은 실제 결제와
                동일한 활성 직원 수(구독행 seat_count 레거시 값 금지 — 514,000원 오표시 사고). */}
            <div className="bg-[var(--bg-surface)] rounded-xl p-4 mb-4">
              <div className="text-xs text-[var(--text-muted)] mb-1">변경 후 예상 금액</div>
              {showUpgradeModal === "free" ? (
                <div className="text-xl font-extrabold text-[var(--text)]">무료</div>
              ) : (() => {
                const p = (plans || []).find((pl: any) => pl.slug === showUpgradeModal);
                if (!p) return <div className="text-xl font-extrabold text-[var(--text)]">-</div>;
                const included = (p as any).included_seats || 0;
                const members = usage?.employees || 1;
                const extra = Math.max(0, members - included - redeemedFreeSeats);
                const monthlyTotal = p.base_price + p.per_seat_price * extra;
                const discounted = Math.round(monthlyTotal * (1 - ANNUAL_DISCOUNT_DISPLAY));
                return (
                  <>
                    <div className="space-y-1 text-sm text-[var(--text-muted)]">
                      <div className="flex justify-between">
                        <span>기본 요금제 (구성원 {included}명 포함)</span>
                        <b className="text-[var(--text)] mono-number">₩{Number(p.base_price).toLocaleString()}</b>
                      </div>
                      {extra > 0 && (
                        <div className="flex justify-between">
                          <span>추가 구성원 {extra}명 × ₩{Number(p.per_seat_price).toLocaleString()}</span>
                          <b className="text-[var(--text)] mono-number">₩{(p.per_seat_price * extra).toLocaleString()}</b>
                        </div>
                      )}
                      {redeemedFreeSeats > 0 && (
                        <div className="flex justify-between text-[var(--success)]">
                          <span>연간 혜택 무료 좌석 {redeemedFreeSeats}명</span>
                          <b>₩0</b>
                        </div>
                      )}
                    </div>
                    <div className="mt-2 pt-2 border-t border-[var(--border)] flex justify-between items-baseline">
                      <span className="text-xs text-[var(--text-muted)]">합계</span>
                      <div className="text-xl font-extrabold text-[var(--text)]">
                        {cycle === "annual"
                          ? <>₩{discounted.toLocaleString()}<span className="text-xs font-normal text-[var(--text-muted)]">/월 (VAT 별도)</span></>
                          : <>₩{monthlyTotal.toLocaleString()}<span className="text-xs font-normal text-[var(--text-muted)]">/월 (VAT 별도)</span></>}
                      </div>
                    </div>
                    {cycle === "annual" && (
                      <div className="text-[11px] text-[var(--text-muted)] mt-1 text-right">연 ₩{(discounted * 12).toLocaleString()} 일시 청구 · 10% 할인 적용</div>
                    )}
                    <p className="text-[11px] text-[var(--text-dim)] mt-2">
                      현재 활성 구성원이 {members}명이라 기본 {included}명을 넘는 인원만큼 추가 요금이 붙습니다. 구성원을 줄이면 다음 결제부터 자동 반영됩니다.
                    </p>
                  </>
                );
              })()}
            </div>
            {/* 무료체험 폐지 (2026-08-11 사장님) — 즉시 청구를 명시 */}
            {showUpgradeModal !== "free" && !(hasStripeSubscription && currentSlug !== "free") && (
              <p className="text-[11px] text-[var(--text-dim)] mb-4">
                결제 완료 <b>즉시 위 금액이 청구</b>되고 오너뷰 기능이 열립니다. {cycle === "annual" ? "연간은 1년치가 한 번에 청구됩니다." : "이후 매월 같은 날 자동 결제됩니다."}
              </p>
            )}
            {/* 할인코드 적용 표시 — 배너에서 입력한 코드가 결제에 실린다는 걸 결제 직전에 보여준다 (2026-07-28) */}
            {showUpgradeModal !== "free" && salesCode.trim() && (
              <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-xl bg-[var(--primary)]/10 border border-[var(--primary)]/30">
                <span className="text-sm">🎟️</span>
                <span className="text-xs font-semibold text-[var(--primary)]">
                  영업코드 {salesCode.trim()} 적용 — 결제에 함께 기록됩니다
                </span>
              </div>
            )}
            <div className="flex gap-2">
              <button
                onClick={() => setShowUpgradeModal(null)}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[var(--bg-surface)] text-[var(--text)] hover:bg-[var(--border)] transition"
              >
                취소
              </button>
              <button
                disabled={isPaymentLoading}
                className="flex-1 py-2.5 rounded-xl text-sm font-semibold bg-[var(--primary)] text-white hover:bg-[var(--primary-hover)] transition disabled:opacity-50"
                onClick={handleUpgradeConfirm}
              >
                {isPaymentLoading ? "로딩 중..."
                  : showUpgradeModal === "free" ? "다운그레이드"
                  : hasStripeSubscription && currentSlug !== "free" ? "구독 관리에서 변경"
                  : "지금 결제하기"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Cancel Modal */}
      {showCancelModal && (
        <div className="billing-cancel-modal fixed inset-0">
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
                onClick={handleCancelConfirm}
              >
                해지 확인
              </button>
            </div>
          </div>
        </div>
      )}
      {confirmElement}
    </div>
  );
}
