// OwnerView — 봉인된(deprecated) 엣지 함수. 2026-07-23.
//   결제 웹훅은 Next 라우트(/api/stripe/webhook)로 일원화됨(단일 진실원천).
//   이 함수는 Stripe 어느 엔드포인트에도 등록돼 있지 않고(등록 웹훅은 Next 라우트뿐),
//   코드베이스 어디서도 호출되지 않는다(전수 확인). 실수 호출·재활성화 방지를 위해 무동작(410)으로 봉인.
//   ⚠️ DB 쓰기·외부 호출 없음. 결제 상태를 절대 변경하지 않는다.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve((_req) =>
  new Response(
    JSON.stringify({
      error: "gone",
      message: "This endpoint is retired. Stripe billing runs through the Next.js route /api/stripe/webhook.",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
