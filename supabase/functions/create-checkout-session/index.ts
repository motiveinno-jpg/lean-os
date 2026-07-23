// OwnerView — 봉인된(deprecated) 엣지 함수. 2026-07-23.
//   체크아웃은 Next 라우트(/api/stripe/checkout)로 일원화됨(트라이얼·좌석·VAT 정합 처리).
//   이 엣지는 구 가격/구 메타데이터 기반이라 현재 웹훅과 호환되지 않으며, 프론트 어디서도 호출되지 않는다(전수 확인).
//   실수 호출·재활성화 방지를 위해 무동작(410)으로 봉인. ⚠️ Stripe/DB 호출 없음.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve((_req) =>
  new Response(
    JSON.stringify({
      error: "gone",
      message: "This endpoint is retired. Checkout runs through the Next.js route /api/stripe/checkout.",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
