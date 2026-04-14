"use client";

import { QueryClient, QueryClientProvider, MutationCache } from "@tanstack/react-query";
import { useState } from "react";
import { ThemeProvider } from "@/components/theme-context";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 1 },
        },
        mutationCache: new MutationCache({
          onError: (error) => {
            console.error("[Mutation Error]", error);
            // 글로벌 에러 표시 — 개별 onError가 없는 mutation을 커버
            const msg = error instanceof Error ? error.message : "알 수 없는 오류";
            if (typeof window !== "undefined" && !msg.includes("aborted")) {
              const event = new CustomEvent("ownerview:mutation-error", { detail: msg });
              window.dispatchEvent(event);
            }
          },
        }),
      })
  );

  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>{children}</ThemeProvider>
    </QueryClientProvider>
  );
}
