"use client";

import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { useState, useEffect } from "react";
import { ThemeProvider } from "@/components/theme-context";

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
            const msg = error instanceof Error ? error.message : "알 수 없는 오류";
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
    </QueryClientProvider>
  );
}
