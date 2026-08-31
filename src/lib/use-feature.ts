// feature_rollout 게이트를 화면에서 읽는 훅 (2026-08-31)
//   CLAUDE.md 규칙: 회사 데이터를 만드는 변화는 모티브에만 먼저 — UI 도 같은 게이트를 읽는다.
//   public.feature_on(p_feature, p_company) RPC (authenticated 실행 허용) 를 호출한다.
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useFeature(feature: string, companyId?: string | null) {
  return useQuery({
    queryKey: ["feature-on", feature, companyId],
    enabled: !!companyId,
    staleTime: 5 * 60 * 1000,
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("feature_on", {
        p_feature: feature,
        p_company: companyId,
      });
      // RPC 실패(권한 등)면 조용히 꺼진 것으로 — 게이트는 보수적으로 닫는다
      if (error) return false;
      return !!data;
    },
  });
}
