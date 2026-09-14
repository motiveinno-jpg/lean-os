// 요금제 전용 페이지 (2026-07-27) — 랜딩 스크롤에서는 가격을 빼고, 상단 "가격"을 눌러 들어온다.
//   2026-09-14 랜딩 v8 이관 2단계: 모양은 v8, 숫자·문구는 **DB subscription_plans** 에서 읽는다(pricing-data.ts 머리주석).
//   ISR 1시간 — 요금제를 DB 에서 바꾸면 늦어도 한 시간 안에 이 페이지가 따라온다. 읽기 실패 시 PLAN_FALLBACK.
import type { Metadata } from "next";
import { cache } from "react";
import { createClient } from "@supabase/supabase-js";
import * as Sentry from "@sentry/nextjs";
import PricingView from "@/components/landing-v8/pricing-view";
import { PLAN_COLUMNS, PLAN_FALLBACK, type PlanRow } from "@/components/landing-v8/pricing-data";

export const revalidate = 3600;

const SITE = "https://www.owner-view.com";
const TITLE = "요금제"; // 뒤의 " | 오너뷰" 는 layout 의 title.template 이 붙인다 (전에는 두 번 붙었다)

// source = 어디서 읽었나. 화면엔 안 보이고 루트의 data-plans 로 남긴다 — 운영에서 curl 로 DB 경로를 확인하려고.
const getPlans = cache(async (): Promise<{ rows: PlanRow[]; source: "db" | "fallback" }> => {
  try {
    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!.trim(), {
      auth: { persistSession: false },
    });
    const { data, error } = await db.from("subscription_plans").select(PLAN_COLUMNS).eq("is_active", true).order("sort_order");
    if (error) throw error;
    const rows = (data ?? []) as unknown as PlanRow[];
    // 화면은 무료 + 유료 한 개를 전제로 그린다. 둘 다 있을 때만 DB 값을 쓴다.
    if (rows.some((r) => r.base_price === 0) && rows.some((r) => r.base_price > 0)) return { rows, source: "db" };
    throw new Error(`pricing: unexpected active plans ${rows.map((r) => r.slug).join(",")}`);
  } catch (e) {
    Sentry.captureException(e);
    return { rows: PLAN_FALLBACK, source: "fallback" };
  }
});

export async function generateMetadata(): Promise<Metadata> {
  const { rows: plans } = await getPlans();
  const paid = plans.find((p) => p.base_price > 0) ?? PLAN_FALLBACK[1];
  const desc = `카드 등록 없이 계속 무료로 사용하고, 필요할 때 월 ${paid.base_price.toLocaleString("ko-KR")}원(VAT 별도) 하나만 결제하세요. 기본 ${paid.included_seats}명 포함, 추가 1명당 ₩${paid.per_seat_price.toLocaleString("ko-KR")}/월.`;
  return {
    title: TITLE,
    description: desc,
    alternates: { canonical: `${SITE}/pricing` },
    openGraph: { type: "website", url: `${SITE}/pricing`, siteName: "오너뷰", locale: "ko_KR", title: `${TITLE} | 오너뷰`, description: desc },
  };
}

export default async function Page() {
  const { rows, source } = await getPlans();
  return <PricingView plans={rows} source={source} />;
}
