"use client";
import { kstDateStr } from "@/lib/kst";
import { logRead } from "@/lib/log-read";
import { fetchPagedRes } from "@/lib/fetch-paged";

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
import { loadTossPayments } from "@tosspayments/tosspayments-sdk";
import { TossCardSection } from "./_components/TossCardSection";
import { QueryScreen, QueryHead, QueryBody } from "@/components/query-kit";
import { fmtBytes } from "@/lib/storage-quota";

// 신규 테이블 타입이 아직 database.ts에 없으므로 any 캐스팅
const db = supabase;

type Tab = "plan" | "credits" | "payment" | "invoices";
type BillingCycle = "monthly" | "annual";

// 2026-08-06 요금제 개편 — 무료(영구) + 오너뷰 단일 유료(2026-08-11 39,000원·VAT 별도). 구 티어는 기존 구독자 표시용.
//   2026-08-19 재편: 요금제 카드(기능 불릿)는 비교 표(요금제 탭 안 rows)로 바뀌어 PLAN_FEATURES 는 없앴다.

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
  // 스토리지 팩 추가·해지는 대표(소유자)만 — 서버 RPC(set_storage_packs)도 같은 기준. 화면에서 미리 알려준다.
  const { role: myRole } = useUser();
  const isOwner = myRole === "owner";
  // 결제수단 등록은 마스터만 — 서버(엣지 함수)에서도 동일하게 막는다.
  const { isMaster: billingIsMaster } = useMyPermissions();
  const [tab, setTab] = useState<Tab>("plan");
  const [cycle, setCycle] = useState<BillingCycle>("monthly"); // 2026-07-22 연간 토글 복원 (연간 10% 할인)
  // 결제수단 — 국내카드(토스) 기본, 해외카드(Stripe) 선택 (2026-08-14)
  const [payMethod, setPayMethod] = useState<"toss" | "stripe">("toss");
  const [packDraft, setPackDraft] = useState<number | null>(null); // 스토리지 팩 목표 수량(입력 중)
  const [packLoading, setPackLoading] = useState(false);
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

  // 스토리지 팩 수량 적용(구매/해지) — 좌석과 동일 단가, provider 별 결제 반영은 서버가 처리.
  async function applyStoragePacks(target: number) {
    setPackLoading(true);
    try {
      const res = await fetch("/api/billing/storage-pack", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ count: target }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || "변경하지 못했습니다");
      await Promise.all([refetchStorage(), qc.invalidateQueries({ queryKey: ["subscription", companyId] })]);
      setPackDraft(null);
      // 결제 반영 시점이 결제수단마다 달라 그대로 알려준다 — Stripe 즉시 일할청구 / Toss 다음 결제일부터.
      const provider = json?.data?.provider as string | null | undefined;
      const grew = target > (storage?.storage_packs ?? 0);
      const msg = json?.data?.charged
        ? (grew ? "저장공간을 늘렸습니다 · 차액이 바로 결제됐어요" : "저장공간을 줄였습니다 · 다음 청구액에 반영돼요")
        : provider === "toss"
          ? (grew ? "저장공간을 늘렸습니다 · 다음 결제일부터 요금에 반영돼요" : "저장공간을 줄였습니다 · 다음 결제일부터 요금이 내려가요")
          : (grew ? "저장공간을 늘렸습니다" : "저장공간을 줄였습니다");
      toast(msg, "success");
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : "변경하지 못했습니다", "error");
    } finally {
      setPackLoading(false);
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
        fetchPagedRes<any>("billing/page:codef_usage", () => db.from("codef_usage").select("units").eq("company_id", companyId).gte("created_at", iso).order("id"), 50000),
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

  // 저장공간 사용량/쿼터 (get_company_storage RPC) — 스토리지 팩 카드용
  const { data: storage, refetch: refetchStorage } = useQuery({
    queryKey: ["company-storage", companyId],
    queryFn: async () => {
      if (!companyId) return null;
      const { data } = await (db as any).rpc("get_company_storage", { p_company: companyId });
      return (Array.isArray(data) ? data[0] : data) as {
        used_bytes: number; quota_bytes: number; included_bytes: number;
        per_unit_bytes: number; extra_seats: number; storage_packs: number; effective_paid: boolean;
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
  // 국내카드(토스) 구독 — 청구 주체가 토스면 Stripe 잔재(stripe_customer_id)가 남아 있어도 토스로 판정.
  //   payment_provider 는 생성 타입(database.ts)에 아직 없어 any 캐스팅.
  const hasTossSubscription = (subscription as any)?.payment_provider === "toss"
    && ["active", "past_due"].includes(subscription?.status || "");
  // 국내카드 결제는 토스 클라이언트 키가 배선된 환경에서만 노출.
  const tossEnabled = !!process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY;

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
    enabled: (tab === "payment" || tab === "invoices") && hasStripeSubscription,
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

  /** 연간 결제 동의 확인·기록 — 미동의면 false (국내카드·해외카드 공통) */
  async function ensureAnnualConsent(planSlug: string): Promise<boolean> {
    if (cycle !== "annual") return true;
    // 연간은 환불 불가 고지에 동의해야만 진행 — 동의 없이는 결제를 만들지 않는다.
    if (!annualRefundAck) {
      toast("연간 결제는 환불 불가 안내에 동의해야 진행할 수 있습니다.", "error");
      return false;
    }
    // 연간 동의는 결제 건마다 남긴다(가입 동의와 달리 1회성이 아님).
    const { data: { user: authUser } } = await supabase.auth.getUser();
    if (authUser) {
      await recordConsent({
        authId: authUser.id,
        consentType: "annual_billing_no_refund",
        companyId,
        context: { planSlug, billingCycle: cycle, seatCount: usage?.employees || 1 },
      });
    }
    return true;
  }

  /** Stripe Checkout */
  async function handleStripeCheckout(planSlug: string) {
    if (!companyId) return;
    if (!(await ensureAnnualConsent(planSlug))) return;
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

  /** 국내카드(토스) 결제 시작 — 카드가 없으면 등록창부터, 있으면 즉시 청구 (2026-08-14) */
  async function handleTossStart(planSlug: string) {
    if (!companyId) return;
    if (!(await ensureAnnualConsent(planSlug))) return;
    setIsPaymentLoading(true);
    track("checkout_start", { plan: planSlug, cycle, method: "toss" });
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("로그인이 필요합니다");

      const { data: cardInfo } = await (db as any).rpc("get_toss_card_info", { p_company_id: companyId });
      const card = Array.isArray(cardInfo) ? cardInfo[0] : cardInfo;
      if (!card?.registered_at) {
        // 카드가 없다 — 등록창을 띄우고, 등록 콜백 화면이 아래 저장값으로 결제까지 잇는다.
        //   authId·ts 를 함께 묶는다 — 다른 사용자 세션이나 한참 뒤 등록이 이 예약을
        //   주워 예고 없이 결제되는 것을 콜백이 걸러낸다 (2026-08-14 보안 리뷰 H-2).
        sessionStorage.setItem("toss-pending-start", JSON.stringify({
          planSlug, billingCycle: cycle, authId: session.user.id, ts: Date.now(),
        }));
        const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toss-billing-key`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
          body: JSON.stringify({ action: "prepare" }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j?.error || "카드 등록 준비에 실패했습니다");
        const tossPayments = await loadTossPayments(process.env.NEXT_PUBLIC_TOSS_CLIENT_KEY!);
        const payment = tossPayments.payment({ customerKey: j.customerKey });
        await payment.requestBillingAuth({
          method: "CARD",
          successUrl: `${window.location.origin}/billing/toss-callback/`,
          failUrl: `${window.location.origin}/billing/toss-callback/`,
        });
        return; // 등록창으로 이동 — 이후는 콜백 화면 몫
      }

      const res = await fetch(`${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/toss-charge`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}` },
        body: JSON.stringify({ mode: "start", planSlug, billingCycle: cycle }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) throw new Error(j?.error || "결제에 실패했습니다");
      qc.invalidateQueries({ queryKey: ["subscription"] });
      qc.invalidateQueries({ queryKey: ["entitlement"] });
      qc.invalidateQueries({ queryKey: ["invoices"] });
      toast(
        j.chargedNow
          ? "국내카드 결제가 완료되었습니다! 플랜이 열렸습니다."
          : "남은 이용 기간 종료 후 국내카드로 자동 결제됩니다.",
        "success",
      );
    } catch (e: any) {
      // 사용자가 등록창을 닫은 건 오류가 아니다.
      if (e?.code !== "USER_CANCEL") toast(friendlyError(e, "국내카드 결제에 실패했습니다."), "error");
    } finally {
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

  //   2026-08-19 재편(docs/20260819_PLAN_billing_redesign.md): 결제 수단 + 청구서 = '결제' 한 탭. 옛 "invoices" 값은 결제 탭으로 읽는다
  const TABS: { key: Tab; label: string; icon: string }[] = [
    { key: "plan", label: "요금제", icon: "💳" },
    { key: "credits", label: "충전", icon: "🔋" },
    { key: "payment", label: "결제", icon: "🏦" },
  ];
  const tabOn = (k: Tab) => (k === "payment" ? tab === "payment" || tab === "invoices" : tab === k);

  /** 플랜 변경 모달 확인 */
  async function handleUpgradeConfirm() {
    if (!showUpgradeModal) return;
    if (showUpgradeModal === "free") {
      setShowUpgradeModal(null);
      // Stripe 구독자는 portal에서 정식 해지 → 결제기간 종료시 free 전환 (직접 DB조작 금지)
      //   토스 구독자는 포털이 아니라 아래 자체 해지 API 로 — Stripe 에 구독이 없다.
      if (hasStripeSubscription && !hasTossSubscription) {
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
    if (hasStripeSubscription && !hasTossSubscription && currentSlug !== 'free') {
      await handleOpenPortal();
      return;
    }
    // 결제수단 분기 — 국내카드는 토스 빌링, 해외카드는 Stripe 체크아웃.
    if (tossEnabled && payMethod === "toss") {
      await handleTossStart(slug);
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
    <div className="qk-shell billing-page">
      {/* ── 조회 화면 표준 상자 (2026-08-19 확산) — 상자 밖 seg-bar 툴바 → 갈래 탭 상자 안 파란 밑줄 ‖ 구독 관리, 본문만 스크롤 ── */}
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {TABS.map((t) => (
              <button key={t.key} type="button" onClick={() => setTab(t.key)} className={tabOn(t.key) ? "collect-tab collect-tab-on" : "collect-tab"}>
                {t.label}
              </button>
            ))}
            {hasStripeSubscription && (
              <span className="ml-auto flex items-center pr-2">
                <button type="button" onClick={handleOpenPortal} disabled={isPaymentLoading} className="btn-secondary btn-sm">{isPaymentLoading ? "로딩 중…" : "구독 관리"}</button>
              </span>
            )}
          </div>
        </QueryHead>
        <QueryBody>
        <div className="billing-scroll">
      <QueryErrorBanner error={mainError as Error | null} onRetry={mainRefetch} />

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

      {/* 요약 한 줄 — 모든 탭 공통 (2026-08-19 재편: KPI 카드 4장 → 한 줄. 경고 칩을 누르면 결제 탭) */}
      {(() => {
        const extraSeats = Math.max(0, (subscription?.seat_count || 1) - (currentPlan?.included_seats || 0));
        const storagePacks = (subscription as any)?.storage_pack_count || 0;
        // 청구액 = 기본가 + (추가좌석 + 스토리지팩) × 좌석단가 (팩은 좌석과 동일 단가)
        const monthly = (currentPlan?.base_price || 0) + (currentPlan?.per_seat_price || 0) * (extraSeats + storagePacks);
        const noCard = entitlement?.entitled && currentSlug !== "free" && !hasTossSubscription && !hasStripeSubscription;
        return (
          <div className="billing-strip">
            <span>현재 요금제 <b>{planDisplayName}</b></span>
            {currentSlug !== "free" && (
              <span>{subscription?.billing_cycle === "annual" ? "연간" : "월"} <b className="mono-number">{fmtW(monthly)}</b> <small className="text-[var(--text-dim)]">기본 {currentPlan?.included_seats || 5}명{extraSeats > 0 ? ` + 추가 ${extraSeats}명` : ""}{storagePacks > 0 ? ` + 저장공간 ${storagePacks}팩` : ""} · VAT 별도</small></span>
            )}
            {cancelScheduled && effectiveUntilStr ? (
              <span className="billing-chip-warn">해지 예약 · {effectiveUntilStr}까지 이용 후 무료 전환</span>
            ) : subscription?.status === "trialing" ? (
              <span>첫 결제 <b className="mono-number">{subscription?.trial_ends_at ? kstDateStr(new Date(subscription.trial_ends_at)) : "—"}</b></span>
            ) : currentSlug !== "free" ? (
              <span>다음 결제 <b className="mono-number">{subscription?.current_period_end ? kstDateStr(new Date(subscription.current_period_end)) : "—"}</b></span>
            ) : null}
            {noCard
              ? <button type="button" className="billing-chip-warn" onClick={() => setTab("payment")} title="결제 수단을 등록하세요">⚠ 결제 수단 없음</button>
              : currentSlug !== "free" ? <span className="text-[var(--text-dim)]">{hasTossSubscription ? "국내카드 자동 결제" : hasStripeSubscription ? "해외카드 자동 결제" : ""}</span> : null}
            <span>구성원 <b className="mono-number">{usage ? usage.employees.toLocaleString() : "—"}</b>명</span>
            <span className="flex-1" />
            <span className="text-[var(--text-dim)] text-[11px]">{new Date().toLocaleDateString("ko-KR", { year: "numeric", month: "long" })}</span>
          </div>
        );
      })()}

      {/* 충전 탭 — 월 제공량을 다 쓴 뒤 이어 쓰는 잔액 (2026-08-07) */}
      {tab === "credits" && (
        <div className="billing-credits">
          {/* 남은 양 한 줄 */}
          <div className="billing-strip billing-strip-inner">
            <span>남은 발행 충전 <b className="mono-number">{(credits?.issue_credits ?? 0).toLocaleString()}</b>건</span>
            <span>남은 AI 토큰 충전 <b className="mono-number">{(credits?.ai_tokens ?? 0).toLocaleString()}</b>토큰</span>
            <span className="text-[var(--text-dim)] text-[11px]">요금제 월 제공량을 먼저 쓰고, 다 쓰면 충전분에서 빠집니다 · 토큰은 유효기간 없음</span>
          </div>

          {/* 충전 표 */}
          <div className="billing-sec">
            <div className="billing-sec-head"><span className="billing-sec-title">충전하기</span><span className="billing-sec-sub">결제 즉시 잔액에 더해짐 · VAT 별도 · 유료 요금제만</span></div>
            <div className="ev-scroll"><table className="ev-table ev-lined billing-table">
              <thead><tr><th className="text-left">항목</th><th className="text-left">단위 · 가격</th><th style={{ width: 120 }}>수량</th><th style={{ width: 110 }}>금액</th><th style={{ width: 90 }}></th></tr></thead>
              <tbody>
                <tr>
                  <td className="text-left font-semibold">세금계산서·현금영수증 발행</td>
                  <td className="text-left text-[var(--text-muted)]">10건 묶음 · 3,000원 (건당 300원)</td>
                  <td className="text-center"><input type="number" min={1} max={100} value={issuePacks} onChange={(e) => setIssuePacks(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} className="billing-qty" /> <span className="text-[11px] text-[var(--text-dim)]">= {(issuePacks * 10).toLocaleString()}건</span></td>
                  <td className="tr mono-number font-semibold">{(issuePacks * 3000).toLocaleString()}원</td>
                  <td className="text-center"><button onClick={() => startTopUp("issue", issuePacks)} disabled={creditLoading !== null} className="btn-secondary btn-sm disabled:opacity-50">{creditLoading === "issue" ? "이동 중…" : "결제"}</button></td>
                </tr>
                <tr>
                  <td className="text-left font-semibold">AI 참모 토큰</td>
                  <td className="text-left text-[var(--text-muted)]">50만 토큰 묶음 · 10,000원</td>
                  <td className="text-center"><input type="number" min={1} max={100} value={tokenPacks} onChange={(e) => setTokenPacks(Math.min(100, Math.max(1, Number(e.target.value) || 1)))} className="billing-qty" /> <span className="text-[11px] text-[var(--text-dim)]">= {(tokenPacks * 50).toLocaleString()}만</span></td>
                  <td className="tr mono-number font-semibold">{(tokenPacks * 10000).toLocaleString()}원</td>
                  <td className="text-center"><button onClick={() => startTopUp("ai_tokens", tokenPacks)} disabled={creditLoading !== null} className="btn-secondary btn-sm disabled:opacity-50">{creditLoading === "ai_tokens" ? "이동 중…" : "결제"}</button></td>
                </tr>
              </tbody>
            </table></div>
          </div>

          {/* 충전 내역 표 */}
          <div className="billing-sec">
            <div className="billing-sec-head"><span className="billing-sec-title">충전 내역</span></div>
            {creditHistory.length === 0 ? (
              <div className="collect-empty">아직 충전한 내역이 없습니다</div>
            ) : (
              <div className="ev-scroll"><table className="ev-table ev-lined billing-table">
                <thead><tr><th style={{ width: 110 }}>날짜</th><th className="text-left">항목</th><th style={{ width: 120 }}>수량</th><th style={{ width: 110 }}>금액</th><th style={{ width: 90 }}>상태</th></tr></thead>
                <tbody>
                  {creditHistory.map((h) => (
                    <tr key={h.id}>
                      <td className="tc mono-number">{kstDateStr(new Date(h.created_at))}</td>
                      <td className="text-left">{h.kind === "issue" ? "발행" : "AI 토큰"}</td>
                      <td className="tr mono-number">{Number(h.quantity).toLocaleString()}{h.kind === "issue" ? "건" : "토큰"}</td>
                      <td className="tr mono-number font-semibold">{Number(h.amount_krw).toLocaleString()}원</td>
                      <td className="tc"><span className={h.status === "paid" ? "ol-sure ol-sure-ok" : "ol-sure"}>{h.status === "paid" ? "충전 완료" : h.status === "pending" ? "결제 대기" : "실패"}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

      {/* Plan Tab — 사용량 표 + 요금제 비교 표 (2026-08-19 재편) */}
      {tab === "plan" && (
        <div className="billing-plan-tab">
          {/* 사용량 표 — 현재 플랜 한도 대비 */}
          {usage && (() => {
            // ⚠️ standard(오너뷰)가 빠져 있어 유료 구독자도 무료 한도(직원 3명·서명 3건)로 표시되고 있었다 (2026-08-07). 9999 = 무제한 표기.
            const limits: Record<string, { employees: number; aiCalls: number; signatures: number; partners: number }> = {
              free:       { employees: 5,    aiCalls: 9999, signatures: 5,    partners: 9999 },
              standard:   { employees: 9999, aiCalls: 9999, signatures: 9999, partners: 9999 },
              basic:      { employees: 9999, aiCalls: 9999, signatures: 9999, partners: 9999 },
              ultra:      { employees: 9999, aiCalls: 9999, signatures: 9999, partners: 9999 },
              enterprise: { employees: 9999, aiCalls: 9999, signatures: 9999, partners: 9999 },
            };
            const lim = limits[currentSlug] || limits.free;
            const codefLimit = subscription?.subscription_plans?.monthly_credits ?? 9999;
            const items: { label: string; used: number; limit: number }[] = [
              { label: "구성원", used: usage.employees, limit: lim.employees },
              { label: "전자서명 (이번 달)", used: usage.signatures, limit: lim.signatures },
              { label: "거래처", used: usage.partners, limit: lim.partners },
              { label: "동기화 크레딧 (이번 달)", used: usage.codefUnits, limit: codefLimit },
              { label: "세금계산서 발행 (이번 달)", used: issuance?.taxUsed ?? 0, limit: issuance?.taxLimit ?? 9999 },
              { label: "현금영수증 발행 (이번 달)", used: issuance?.cashUsed ?? 0, limit: issuance?.cashLimit ?? 9999 },
            ];
            return (
              <div className="billing-sec">
                <div className="billing-sec-head"><span className="billing-sec-title">이번 달 사용량</span><span className="billing-sec-sub">제공량 대비</span></div>
                <div className="ev-scroll"><table className="ev-table ev-lined billing-table">
                  <thead><tr><th className="text-left">항목</th><th style={{ width: 110 }}>이번 달</th><th style={{ width: 110 }}>제공량</th><th className="text-left" style={{ width: 260 }}>남음</th></tr></thead>
                  <tbody>
                    {items.map((it) => {
                      const unlimited = it.limit >= 9999;
                      const pct = unlimited ? 0 : Math.min(100, Math.round((it.used / Math.max(1, it.limit)) * 100));
                      const tone = pct >= 100 ? "var(--danger)" : pct >= 80 ? "var(--warning)" : "var(--primary)";
                      return (
                        <tr key={it.label}>
                          <td className="text-left">{it.label}</td>
                          <td className="tr mono-number font-semibold" style={pct >= 80 ? { color: tone } : undefined}>{it.used.toLocaleString()}</td>
                          <td className="tr mono-number text-[var(--text-muted)]">{unlimited ? "무제한" : it.limit.toLocaleString()}</td>
                          <td className="text-left">
                            {unlimited ? <span className="text-[var(--text-dim)]">—</span> : (
                              <span className="inline-flex items-center gap-2">
                                <span className="billing-bar"><span style={{ width: `${pct}%`, background: tone }} /></span>
                                <span className="text-[11px] text-[var(--text-muted)] mono-number">{Math.max(0, it.limit - it.used).toLocaleString()} 남음{pct >= 80 ? " · 한도 임박" : ""}</span>
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table></div>
              </div>
            );
          })()}

          {/* 저장공간 — 사용량 + 스토리지 팩(좌석과 분리, 동일 단가) (2026-09-02 사장님) */}
          {storage && (() => {
            const used = Number(storage.used_bytes) || 0;
            const quota = Number(storage.quota_bytes) || 0;
            const unit = Number(storage.per_unit_bytes) || 10737418240;
            const included = Number(storage.included_bytes) || 524288000;
            const packs = Number(storage.storage_packs) || 0;
            const seatUnits = Number(storage.extra_seats) || 0;
            const perSeat = currentPlan?.per_seat_price || 5000;
            const pct = quota > 0 ? Math.min(100, Math.floor((used / quota) * 100)) : 0; // 내림 — 남은 공간이 있으면 '가득'이라 하지 않는다
            const tone = pct >= 100 ? "var(--danger)" : pct >= 80 ? "var(--warning)" : "var(--primary)";
            const draft = packDraft ?? packs;
            // '유료' 판정은 DB 실효 플랜(effective_paid)을 따른다 — 구독 행이 남아 있어도 만료·해지면 기본 한도.
            const isPaid = !!storage.effective_paid;
            const lapsed = !isPaid && currentSlug !== "free"; // 유료였다가 만료·해지된 회사
            const left = Math.max(0, quota - used);
            const isAnnual = subscription?.billing_cycle === "annual";
            // 연간은 Toss 크론과 같은 식(단가 × 12 × (1 − 연간할인)) — 화면 숫자와 청구 숫자가 어긋나지 않게.
            const unitPrice = isAnnual ? Math.round(perSeat * 12 * (1 - Number(currentPlan?.annual_discount || 0))) : perSeat;
            const priceUnitLabel = isAnnual ? "연" : "월";
            // 줄일 때: 줄인 뒤 한도보다 사용량이 크면 서버가 409 로 거부한다 — 미리 계산해 버튼을 잠그고 이유를 보여준다.
            const draftQuota = included + (seatUnits + draft) * unit;
            const shrinkBlocked = draft < packs && used > draftQuota;
            const diff = draft - packs;
            const applyPacks = async () => {
              if (diff < 0) {
                const r = await confirmDialog({
                  title: `저장공간 ${Math.abs(diff)}팩 줄이기`,
                  desc: `한도가 ${fmtBytes(quota)} → ${fmtBytes(draftQuota)} 로 줄고, ${priceUnitLabel} ₩${(Math.abs(diff) * unitPrice).toLocaleString()} 이 다음 청구액에서 빠집니다.`,
                  confirmLabel: "줄이기",
                  danger: true,
                });
                if (!r || !(r as any).ok) return;
              }
              await applyStoragePacks(draft);
            };
            return (
              <div className="billing-sec">
                <div className="billing-sec-head">
                  <span className="billing-sec-title">저장공간</span>
                  <span className="billing-sec-sub">회사가 올린 모든 파일(문서·첨부·이미지 등) 합계 · 팩 1개 = +{fmtBytes(unit)} / {priceUnitLabel} ₩{unitPrice.toLocaleString()}(VAT 별도)</span>
                </div>
                <div className="billing-storage">
                  <div className="billing-storage-gauge">
                    <span className="billing-bar billing-bar-lg"><span style={{ width: `${pct}%`, background: tone }} /></span>
                    <span className="mono-number" style={pct >= 80 ? { color: tone } : undefined}>
                      <b>{fmtBytes(used)}</b> <span className="text-[var(--text-dim)]">/ {fmtBytes(quota)} 사용 ({pct}%)</span>
                    </span>
                    <span className="text-[11px] text-[var(--text-dim)]">남은 공간 <b className="mono-number">{fmtBytes(left)}</b></span>
                  </div>
                  {lapsed && (
                    <div className="text-[11px] text-[var(--text-dim)]">
                      요금제가 만료·해지되어 저장공간이 기본 {fmtBytes(included)} 으로 돌아갔습니다. 올려 둔 파일은 그대로 있고, 다시 결제하면 이전 한도가 바로 돌아옵니다.
                    </div>
                  )}
                  {pct >= 80 && (
                    <div className="text-[11px] font-semibold" style={{ color: tone }}>
                      {used >= quota
                        ? "저장공간이 가득 찼습니다 — 지금은 새 파일을 올릴 수 없어요. 안 쓰는 파일을 지우거나 저장공간을 늘려 주세요."
                        : "저장공간이 거의 찼습니다 — 가득 차면 새 파일을 올릴 수 없어요."}
                    </div>
                  )}
                  <div className="text-[11px] text-[var(--text-dim)]">
                    한도 = 기본 {fmtBytes(included)}{seatUnits > 0 ? ` + 추가 좌석 ${seatUnits}명 × ${fmtBytes(unit)}` : ""}{packs > 0 ? ` + 저장공간 팩 ${packs}개 × ${fmtBytes(unit)}` : ""}
                    {isPaid && seatUnits === 0 && packs === 0 ? ` · 추가 좌석 1명당 +${fmtBytes(unit)} 가 함께 붙습니다` : ""}
                  </div>
                  {!isPaid ? (
                    <div className="billing-storage-buy">
                      <span className="text-[11px] text-[var(--text-dim)]">{lapsed ? "유료 요금제로 돌아가면" : `무료 요금제는 ${fmtBytes(included)} 까지입니다. 유료 요금제에서`} 저장공간 팩(+{fmtBytes(unit)})을 추가할 수 있어요.</span>
                      <button type="button" className="btn-secondary btn-sm" onClick={() => document.getElementById("billing-plan-cards")?.scrollIntoView({ behavior: "smooth", block: "start" })}>요금제 보기</button>
                    </div>
                  ) : !isOwner ? (
                    <div className="text-[11px] text-[var(--text-dim)]">저장공간 팩 추가·해지는 대표(소유자)만 할 수 있습니다. 현재 팩 <b className="mono-number">{packs}</b>개.</div>
                  ) : (
                    <>
                      <div className="billing-storage-buy">
                        <span className="text-[var(--text-muted)]">저장공간 팩</span>
                        <button type="button" className="billing-step" aria-label="팩 1개 줄이기" disabled={packLoading || draft <= 0} onClick={() => setPackDraft(Math.max(0, draft - 1))}>−</button>
                        <input
                          type="number" min={0} max={10000} value={draft} aria-label="저장공간 팩 수량"
                          onChange={(e) => setPackDraft(Math.max(0, Math.min(10000, Math.floor(Number(e.target.value)) || 0)))}
                          onKeyDown={(e) => { if (e.key === "Enter" && draft !== packs && !shrinkBlocked && !packLoading) void applyPacks(); if (e.key === "Escape") setPackDraft(null); }}
                          className="billing-qty" disabled={packLoading}
                        />
                        <button type="button" className="billing-step" aria-label="팩 1개 늘리기" disabled={packLoading || draft >= 10000} onClick={() => setPackDraft(Math.min(10000, draft + 1))}>+</button>
                        <span className="text-[11px] text-[var(--text-dim)]">
                          {draft === packs
                            ? <>현재 {packs}개 · {priceUnitLabel} <b className="mono-number">₩{(packs * unitPrice).toLocaleString()}</b></>
                            : <>{diff > 0 ? "+" : "−"}{Math.abs(diff)}개 → 한도 <b className="mono-number">{fmtBytes(draftQuota)}</b> · {priceUnitLabel} {diff > 0 ? "+" : "−"}<b className="mono-number">₩{(Math.abs(diff) * unitPrice).toLocaleString()}</b></>}
                        </span>
                        {draft !== packs && (
                          <button type="button" className="btn-secondary btn-sm" disabled={packLoading || shrinkBlocked} onClick={() => void applyPacks()}>
                            {packLoading ? "적용 중…" : diff > 0 ? `${diff}팩 추가하기` : `${Math.abs(diff)}팩 줄이기`}
                          </button>
                        )}
                        {draft !== packs && (
                          <button type="button" className="billing-storage-cancel" disabled={packLoading} onClick={() => setPackDraft(null)}>취소</button>
                        )}
                      </div>
                      {shrinkBlocked && (
                        <div className="text-[11px]" style={{ color: "var(--danger)" }}>
                          지금 쓰는 용량({fmtBytes(used)})이 줄인 뒤 한도({fmtBytes(draftQuota)})보다 커서 줄일 수 없어요. 파일을 먼저 정리해 주세요.
                        </div>
                      )}
                      {draft > packs && (
                        <div className="text-[11px] text-[var(--text-dim)]">
                          {hasStripeSubscription ? "차액은 바로 결제되고 다음 결제부터 정기 요금에 포함돼요." : hasTossSubscription ? "용량은 바로 늘고, 요금은 다음 결제일부터 반영돼요." : "용량은 바로 늘어요."}
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>
            );
          })()}

          {/* 연간 결제 혜택 쿠폰 — 발급/사용 (2026-07-30 사장님) */}
          {(seatCoupons as any[]).length > 0 && (
            <div className="billing-sec">
              <div className="billing-sec-head"><span className="billing-sec-title">내 쿠폰</span></div>
              <div className="billing-coupon-list">
                {(seatCoupons as any[]).map((c: any) => (
                  <div key={c.id} className={`billing-coupon-row ${c.status === "redeemed" ? "billing-coupon-card-used" : ""}`}>
                    <div className="flex-1 min-w-0">
                      <span className="text-[12.5px] font-semibold text-[var(--text)]">추가인원 {c.free_seats}명 무료 등록 쿠폰</span>
                      <span className="text-[11px] text-[var(--text-muted)] ml-2">연간 결제 혜택 · 발급 {new Date(c.issued_at).toLocaleDateString("ko-KR")}{c.status === "redeemed" && c.redeemed_at && <> · 사용 {new Date(c.redeemed_at).toLocaleDateString("ko-KR")}</>}</span>
                      <div className="text-[11px] text-[var(--text-dim)] mt-0.5">{c.status === "issued" ? "사용하면 기본 5명 외 추가 인원을 등록해도 그 인원만큼 추가좌석 요금이 청구되지 않습니다." : "적용 중 — 추가 인원 등록 시 이 쿠폰 좌석만큼은 결제에서 제외됩니다."}</div>
                    </div>
                    {c.status === "issued"
                      ? <button onClick={() => redeemCouponMut.mutate(c.id)} disabled={redeemCouponMut.isPending} className="btn-secondary btn-sm shrink-0">{redeemCouponMut.isPending ? "적용 중…" : "쿠폰 사용하기"}</button>
                      : <span className="billing-coupon-used-badge">적용 중</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* 요금제 비교 표 — 행 = 기능, 열 = 무료 · 오너뷰(추천) · 울트라(비용 협의) */}
          <div className="billing-sec" id="billing-plan-cards">
            <div className="billing-sec-head">
              <span className="billing-sec-title">요금제 비교</span>
              {ANNUAL_BILLING_AVAILABLE && (
                <span className="qk-quicks">
                  {([["monthly", "월간"], ["annual", "연간 (10% 할인)"]] as const).map(([k, l]) => (
                    <button key={k} type="button" onClick={() => { setCycle(k); if (k === "monthly") setAnnualRefundAck(false); }} className={cycle === k ? "qk-quick qk-quick-on" : "qk-quick"}>{l}</button>
                  ))}
                </span>
              )}
              <span className="flex-1" />
              <span className="billing-sec-sub">기본 5명 포함 · VAT 별도</span>
            </div>
            {(() => {
              const std = (plans || []).find((p: any) => p.slug === "standard") as any;
              const freeP = (plans || []).find((p: any) => p.slug === "free") as any;
              const disc = (n: number) => (cycle === "annual" ? Math.round(n * (1 - ANNUAL_DISCOUNT_DISPLAY)) : n);
              const stdMonthly = std ? disc(std.base_price) : 39000;
              const stdSeat = std ? disc(std.per_seat_price) : 5000;
              const isStd = currentSlug === "standard";
              const isFree = currentSlug === "free" || !entitlement?.entitled;
              //   옛 요금제(프로·울트라·엔터프라이즈) 구독 중이면 울트라 열이 '사용 중'으로 — 판매는 안 해도 쓰는 회사가 있다
              const isLegacy = !isStd && !isFree;
              //   파란(확정) 버튼은 화면에 하나 — 추천(오너뷰)을 안 쓰고 있으면 오너뷰 변경, 쓰고 있으면 울트라 도입 문의
              const primaryCol: "standard" | "ultra" = isStd ? "ultra" : "standard";
              //   행 자료 — 무료/오너뷰는 lib/billing 요금제 행(features)이 아니라 기능 단위로 적는다(비교가 목적). 울트라는 사장님 기획(2026-08-19).
              const rows: { f: string; free: string; std: string; ultra: string }[] = [
                { f: "구성원", free: "5명", std: `기본 5명 + 1명 ₩${stdSeat.toLocaleString()}/월`, ultra: "무제한" },
                { f: "저장공간", free: "500 MB", std: `500 MB + 추가 1명당 10 GB · 팩(+10 GB) ₩${stdSeat.toLocaleString()}/월`, ultra: "협의(전용 용량)" },
                { f: "세금계산서·현금영수증 발행", free: "월 5건 · 5건", std: "월 100건 · 100건", ultra: "무제한" },
                { f: "전자계약", free: "월 5건", std: "무제한", ultra: "무제한" },
                { f: "통장·카드 연결", free: "3개 · 하루 2회", std: "무제한 · 하루 2회 + 즉시", ultra: "무제한 + 연동 주기 협의" },
                { f: "홈택스 자동 수집", free: "—", std: "✓", ultra: "✓" },
                { f: "AI 참모", free: "월 10만 토큰", std: "월 50만 토큰", ultra: "협의(전용 한도)" },
                { f: "AI 브리핑", free: "기본형(규칙)", std: "매일 자동 분석", ultra: "회사 지표에 맞춘 브리핑" },
                { f: "전자결재·근태·급여·프로젝트·게시판", free: "무제한", std: "무제한", ultra: "무제한" },
                { f: "회사 시스템에 맞춘 별도 UX 구축", free: "—", std: "—", ultra: "✓ 화면·흐름 맞춤 설계" },
                { f: "기존 시스템 연동(ERP·그룹웨어·회계)", free: "—", std: "—", ultra: "✓ 협의" },
                { f: "데이터 이관 · 온보딩 교육", free: "—", std: "셀프 가이드", ultra: "✓ 전담 담당자" },
                { f: "지원", free: "고객센터", std: "고객센터 · 우선 답변", ultra: "전담 채널 · 응답 시간 약속(SLA)" },
              ];
              const cell = (v: string) => v === "—" ? <span className="text-[var(--text-dim)]">—</span> : v === "✓" ? <span className="billing-ok">✓</span> : v.startsWith("✓") ? <><span className="billing-ok">✓</span> {v.slice(1).trim()}</> : v;
              return (
                <div className="ev-scroll"><table className="ev-table ev-lined billing-table billing-matrix">
                  <thead>
                    <tr>
                      <th className="text-left align-bottom" style={{ width: 220 }}>기능</th>
                      <th className={isFree ? "billing-col-cur" : ""}>
                        <div className="billing-col-name">무료</div>
                        <div className="billing-col-price mono-number">₩0</div>
                        <div className="billing-col-sub">카드 등록 없이 계속 무료</div>
                        {isFree ? <span className="billing-col-btn-cur">사용 중</span>
                          : freeP ? <button type="button" onClick={() => setShowUpgradeModal("free")} className="btn-secondary btn-sm">이 요금제로 변경</button> : null}
                      </th>
                      <th className={`billing-col-rec ${isStd ? "billing-col-cur" : ""}`}>
                        <div className="billing-col-name">오너뷰 <span className="billing-col-tag">추천</span></div>
                        <div className="billing-col-price mono-number">₩{stdMonthly.toLocaleString()} <small>/월</small></div>
                        <div className="billing-col-sub">{cycle === "annual" ? `연 ₩${(stdMonthly * 12).toLocaleString()} 일시 청구 · ` : ""}추가 1명 ₩{stdSeat.toLocaleString()}/월{isStd ? " · 지금 쓰는 요금제" : ""}</div>
                        {isStd ? <span className="billing-col-btn-cur">사용 중</span>
                          : std ? <button type="button" onClick={() => setShowUpgradeModal("standard")} className={primaryCol === "standard" ? "btn-primary btn-sm" : "btn-secondary btn-sm"}>이 요금제로 변경</button> : null}
                      </th>
                      <th className={isLegacy ? "billing-col-cur" : ""}>
                        {/* 울트라는 항상 '비용 협의' — 옛 울트라 구독 계정이라도 금액을 여기 안 적는다(내는 금액은 위 요약 줄, 2026-08-20 사장님) */}
                        <div className="billing-col-name">{isLegacy ? (currentPlan?.name || "울트라") : "울트라"}</div>
                        <div className="billing-col-price">비용 협의</div>
                        <div className="billing-col-sub">회사 시스템에 맞춘 별도 UX 구축 · 도입 범위에 따라 견적{isLegacy ? ` · 지금 쓰는 요금제(${subscription?.seat_count || 1}명)` : ""}</div>
                        {isLegacy ? <span className="billing-col-btn-cur">사용 중</span>
                          : <a href="/support?topic=ultra" className={`${primaryCol === "ultra" ? "btn-primary" : "btn-secondary"} btn-sm no-underline inline-flex`}>도입 문의</a>}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.f}>
                        <td className="text-left text-[var(--text-muted)]">{r.f}</td>
                        <td className="tc">{cell(r.free)}</td>
                        <td className="tc billing-cell-rec">{cell(r.std)}</td>
                        <td className="tc">{cell(r.ultra)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              );
            })()}

            {cycle === "annual" && (
              <label className="billing-annual-ack">
                <input type="checkbox" checked={annualRefundAck} onChange={(e) => setAnnualRefundAck(e.target.checked)} className="mt-0.5 shrink-0" />
                <span className="text-xs leading-6 text-[var(--text-muted)]">
                  <b className="text-[var(--text)]">연간 결제는 1년치 요금이 한 번에 청구되며, 중도 해지하더라도 환불되지 않습니다.</b>{" "}
                  해지 시 결제한 1년의 잔여기간 동안 추가 비용 없이 계속 이용하실 수 있고, 기간이 끝나면 자동 갱신 없이 종료됩니다. 위 내용을 확인했으며 이에 동의합니다.{" "}
                  <a href="/refund" target="_blank" rel="noreferrer" className="underline underline-offset-2 text-[var(--primary)]">환불규정 보기</a>
                </span>
              </label>
            )}

            <p className="billing-note"><b>울트라</b>는 정가가 없습니다 — 회사 업무 흐름을 듣고 화면·연동 범위를 정한 뒤 견적을 드립니다(도입 문의 → 담당자 연락). 기존 오너뷰 기능은 전부 포함.</p>
            {/* 결제 가능 카드 안내 (2026-07-31 사장님) — 배너 대신 각주로 */}
            <p className="billing-note">국내카드는 토스페이먼츠, 해외카드는 Stripe 로 결제됩니다 — 해외 결제를 차단해 둔 카드(법인카드 포함)는 Stripe 승인이 거절될 수 있으니 국내카드를 쓰거나 카드사에 확인하세요 · 요금은 원화, VAT 10% 별도 · 월간은 매월 같은 날 자동 결제.</p>

            {entitlement?.entitled && currentSlug !== "free" && (
              <p className="billing-cancel-line">
                {cancelScheduled && effectiveUntilStr ? (
                  <>해지 예약됨 — {effectiveUntilStr}까지 그대로 이용하고 이후 무료로 전환됩니다.{hasStripeSubscription && !hasTossSubscription && <> 예약 취소는 <button type="button" className="billing-cancel-link" onClick={handleOpenPortal} disabled={isPaymentLoading}>구독 관리</button>에서.</>}</>
                ) : (
                  <>요금제를 더 쓰지 않으려면 <button type="button" className="billing-cancel-link" onClick={() => setShowCancelModal(true)}>구독 해지…</button> (결제 기간이 끝나면 무료로 전환)</>
                )}
              </p>
            )}
          </div>
        </div>
      )}

      {/* 결제 탭 — 결제 수단 한 줄 + 국내카드(토스) + 각주 + 청구서 표 (2026-08-19 재편: 결제 수단·청구서 합침) */}
      {(tab === "payment" || tab === "invoices") && (
        <div className="billing-pay-tab">
          <div className="billing-sec">
            <div className="billing-sec-head"><span className="billing-sec-title">결제 수단</span><span className="billing-sec-sub">해외카드(Stripe)</span></div>
            {hasStripeSubscription ? (
              pmLoading ? <div className="collect-empty">카드 정보를 불러오는 중…</div>
              : (pmData?.cards?.length ?? 0) === 0 ? (
                <div className="billing-strip billing-strip-inner"><span className="billing-chip-warn">⚠ 등록된 카드 없음</span><span className="flex-1" /><button onClick={handleOpenPortal} disabled={isPaymentLoading} className="btn-secondary btn-sm">{isPaymentLoading ? "로딩 중…" : "카드 등록 (Stripe)"}</button></div>
              ) : (
                <div className="ev-scroll"><table className="ev-table ev-lined billing-table">
                  <thead><tr><th className="text-left">카드</th><th style={{ width: 120 }}>만료</th><th style={{ width: 90 }}>기본</th><th style={{ width: 200 }}></th></tr></thead>
                  <tbody>
                    {pmData!.cards.map((card) => (
                      <tr key={card.id}>
                        <td className="text-left font-semibold"><span className="uppercase">{card.brand}</span> <span className="mono-number">**** {card.last4}</span></td>
                        <td className="tc mono-number text-[var(--text-muted)]">{card.expMonth && card.expYear ? `${String(card.expMonth).padStart(2, "0")}/${String(card.expYear).slice(-2)}` : "—"}</td>
                        <td className="tc">{card.isDefault && <span className="ol-sure ol-sure-ok">기본</span>}</td>
                        <td className="tr">
                          <button onClick={handleOpenPortal} disabled={isPaymentLoading} className="btn-secondary btn-sm mr-1">{isPaymentLoading ? "로딩 중…" : "변경·추가"}</button>
                          <button onClick={async () => {
                            if (!(await confirmDialog({ title: `카드 삭제 (**** ${card.last4})`, desc: "이 카드를 결제 수단에서 삭제합니다. 구독이 유지 중이면 마지막 카드는 삭제할 수 없습니다.", danger: true }))) return;
                            deleteCardMut.mutate(card.id);
                          }} disabled={deleteCardMut.isPending} className="btn-secondary btn-sm text-[var(--danger)] disabled:opacity-50">{deleteCardMut.isPending ? "삭제 중…" : "삭제"}</button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table></div>
              )
            ) : (
              <div className="billing-strip billing-strip-inner">
                <span className="text-[var(--text-muted)]">해외카드(Stripe)는 요금제를 결제할 때 등록됩니다 · 국내카드는 아래에서 등록</span>
                <span className="flex-1" />
                <button onClick={() => setTab("plan")} className="btn-secondary btn-sm">요금제 고르기</button>
              </div>
            )}
          </div>

          {/* 국내카드(토스) 자동결제 — 해외카드 Stripe 와 별도 등록 (2026-08-06) */}
          <TossCardSection companyId={companyId} isMaster={billingIsMaster} />

          <p className="billing-note">국내카드는 토스페이먼츠, 해외카드는 Stripe 로 안전하게 결제(PCI DSS Level 1) · 결제 즉시 기능이 열립니다(무료체험 없음) · VAT 10% 별도 · 결제 실패 시 3일 뒤 재시도, 3회 실패하면 무료로 전환.</p>

          {/* 청구서 표 */}
          <div className="billing-sec">
            <div className="billing-sec-head"><span className="billing-sec-title">청구서</span></div>
            {invoicesLoading ? (
              <div className="collect-empty">불러오는 중…</div>
            ) : (invoices || []).length === 0 ? (
              <div className="collect-empty">청구서가 없습니다 — 유료 요금제를 시작하면 여기에 쌓입니다</div>
            ) : (
              <div className="ev-scroll"><table className="ev-table ev-lined billing-table">
                <thead><tr><th style={{ width: 110 }}>날짜</th><th style={{ width: 150 }}>번호</th><th className="text-left">내용</th><th style={{ width: 120 }}>금액</th><th style={{ width: 90 }}>상태</th><th style={{ width: 130 }}></th></tr></thead>
                <tbody>
                  {(invoices || []).map((inv: any) => {
                    const statusLabel = inv.status === "paid" ? "결제 완료" : inv.status === "failed" ? "결제 실패" : inv.status === "refunded" ? "환불" : "대기";
                    const cls = inv.status === "paid" ? "ol-sure ol-sure-ok" : inv.status === "failed" ? "ol-sure ol-sure-est" : "ol-sure";
                    return (
                      <tr key={inv.id}>
                        <td className="tc mono-number">{kstDateStr(new Date(inv.created_at))}</td>
                        <td className="tc mono-number text-[var(--text-muted)]">{inv.invoice_number}</td>
                        <td className="text-left">{inv.description || "구독 결제"}</td>
                        <td className="tr mono-number font-semibold">₩{(inv.total_amount || 0).toLocaleString()}</td>
                        <td className="tc"><span className={cls}>{statusLabel}</span></td>
                        <td className="tr">
                          {inv.status === "failed" && hasStripeSubscription && (
                            <button onClick={handleOpenPortal} disabled={isPaymentLoading} className="btn-secondary btn-sm text-[var(--danger)] mr-1">재시도</button>
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
                          }} className="btn-secondary btn-sm">PDF</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table></div>
            )}
          </div>
        </div>
      )}

        </div>
        </QueryBody>
      </QueryScreen>

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
            {/* 결제수단 선택 — 국내카드(토스) 기본 / 해외카드(Stripe) (2026-08-14) */}
            {showUpgradeModal !== "free" && !(hasStripeSubscription && !hasTossSubscription && currentSlug !== "free") && tossEnabled && (
              <div className="billing-method-choice">
                <button
                  type="button"
                  onClick={() => setPayMethod("toss")}
                  className={`billing-method-option ${payMethod === "toss" ? "billing-method-option-active" : ""}`}
                >
                  <span className="billing-method-name">국내카드</span>
                  <span className="billing-method-desc">국내 발급 카드 · 토스페이먼츠</span>
                </button>
                <button
                  type="button"
                  onClick={() => setPayMethod("stripe")}
                  className={`billing-method-option ${payMethod === "stripe" ? "billing-method-option-active" : ""}`}
                >
                  <span className="billing-method-name">해외카드</span>
                  <span className="billing-method-desc">Visa·Master 등 · Stripe</span>
                </button>
              </div>
            )}
            {/* 무료체험 폐지 (2026-08-11 사장님) — 즉시 청구를 명시 */}
            {showUpgradeModal !== "free" && !(hasStripeSubscription && !hasTossSubscription && currentSlug !== "free") && (
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
                  : hasStripeSubscription && !hasTossSubscription && currentSlug !== "free" ? "구독 관리에서 변경"
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
