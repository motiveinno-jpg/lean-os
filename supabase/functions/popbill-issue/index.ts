// OwnerView — 봉인된(deprecated) 엣지 함수. 2026-07-29.
//   팝빌(Popbill) 세금계산서 발행 잔재. 발행은 전부 CODEF 경로로 일원화됨
//   (cashbill-issue · hometax-issue · codef-sync → api.codef.io).
//   호출부 0곳 확인(프론트·엣지·pg_cron·DB 함수 전수). 배포본만 남아 있어
//   실수 호출·재활성화 방지를 위해 무동작(410)으로 봉인.
//   이 로컬 파일은 배포본과 저장소를 일치시키기 위한 스텁이다(원본 소스는 저장소에 없었음).
//   ⚠️ DB 쓰기·외부 호출 없음. 발행을 절대 수행하지 않는다.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve((_req) =>
  new Response(
    JSON.stringify({
      error: "gone",
      message: "This endpoint is retired (2026-07-29). Tax invoice issuance runs through the CODEF path (cashbill-issue / hometax-issue), not Popbill.",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
