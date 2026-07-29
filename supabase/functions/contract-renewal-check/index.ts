// OwnerView — 봉인된(deprecated) 엣지 함수. 2026-07-29.
//   계약 갱신 리마인더 데몬으로 설계됐으나 어디에도 연결된 적이 없다(전수 확인):
//   프론트 호출 0곳, 다른 엣지에서 호출 0곳, pg_cron 스케줄 0건, DB 함수 참조 0건.
//   구현도 현재 스키마와 어긋나 있었다(존재하지 않는 컬럼 참조).
//   실수 호출·재활성화 방지를 위해 무동작(410)으로 봉인. 원본은 git 히스토리(2026-07-29 이전) 참조.
//   ⚠️ DB 쓰기·외부 호출 없음.
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve((_req) =>
  new Response(
    JSON.stringify({
      error: "gone",
      message: "This function is retired (2026-07-29). It was never scheduled or called; contract renewal reminders do not run through this endpoint.",
    }),
    { status: 410, headers: { "Content-Type": "application/json" } },
  )
);
