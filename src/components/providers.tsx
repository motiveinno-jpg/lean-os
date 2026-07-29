"use client";

import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { ThemeProvider } from "@/components/theme-context";
import { PageViewBeacon } from "@/components/page-view-beacon";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          // refetchOnWindowFocus: 탭 복귀마다 전 쿼리 재조회 → 체감 렉. staleTime 내 재방문은 캐시 즉시 표시.
          queries: { staleTime: 30_000, retry: 1, refetchOnWindowFocus: false },
        },
        mutationCache: new MutationCache({
          onError: (error, variables, _ctx, mutation) => {
            console.error("[Mutation Error]", error);
            // 글로벌 에러 표시 — 개별 onError가 없는 mutation을 커버
            //   Supabase/PostgREST 는 Error 가 아닌 플레인 객체({message,code,details,hint})를
            //   throw 하는 경우가 있어, instanceof Error 만 보면 전부 "알 수 없는 오류"로
            //   뭉개져 error_logs 에 원인이 하나도 안 남았다(2026-07-29, 누적 22건 진단 불가).
            const eo = (error && typeof error === "object" ? error : {}) as Record<string, unknown>;
            const parts = [
              typeof eo.code === "string" ? `[${eo.code}]` : null,
              error instanceof Error ? error.message : typeof eo.message === "string" ? eo.message : null,
              typeof eo.details === "string" ? eo.details : null,
              typeof eo.hint === "string" ? eo.hint : null,
            ].filter(Boolean);
            let msg: string;
            if (parts.length) {
              msg = parts.join(" ");
            } else {
              try { msg = `알 수 없는 오류: ${JSON.stringify(error).slice(0, 300)}`; }
              catch { msg = "알 수 없는 오류"; }
            }
            if (typeof window !== "undefined" && !msg.includes("aborted")) {
              const event = new CustomEvent("ownerview:mutation-error", { detail: msg });
              window.dispatchEvent(event);
              // 운영자 조회용 DB 적재 — 어떤 작업/페이지였는지 context 에 기록
              const mKey = mutation?.options?.mutationKey;
              const actionLabel = Array.isArray(mKey) ? mKey.join(" / ") : (mKey ? String(mKey) : "데이터 저장/수정");
              import("@/lib/error-logger").then(({ logError }) => {
                logError({
                  source: "mutation",
                  message: msg,
                  stack: error instanceof Error ? error.stack : undefined,
                  context: {
                    action: actionLabel,
                    page: window.location.pathname,
                    // 변수는 민감정보 가능 — 키 이름만 기록
                    variableKeys: variables && typeof variables === "object" ? Object.keys(variables as object).slice(0, 20) : undefined,
                  },
                });
              }).catch(() => {});
            }
          },
        }),
      })
  );

  useEffect(() => {
    if ("serviceWorker" in navigator && process.env.NODE_ENV === "production") {
      navigator.serviceWorker.register("/sw.js").catch(() => {});
    }
  }, []);

  // 숫자 input 위에서 휠 스크롤 시 값이 슬쩍 바뀌는 오입력 방지 (2026-07-21 QA 스윕)
  //   포커스된 input[type=number] 위에서 휠이 돌면 blur — 페이지 스크롤은 그대로, 값 변경만 차단.
  useEffect(() => {
    const onWheel = (e: WheelEvent) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement && el.type === "number" && el === e.target) el.blur();
    };
    document.addEventListener("wheel", onWheel, { passive: true });
    return () => document.removeEventListener("wheel", onWheel);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>{children}</ThemeProvider>
      {/* 방문자·페이지뷰 수집 — 화면을 그리지 않는 비콘. 실패해도 무시된다. */}
      <PageViewBeacon />
    </QueryClientProvider>
  );
}
