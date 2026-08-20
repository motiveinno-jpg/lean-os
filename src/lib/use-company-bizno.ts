"use client";
// 우리 회사에 사업자번호가 등록돼 있나 (2026-08-20).
//   가입 관문에서 필수로 받던 것을 '필요한 자리'로 옮기면서 신설 — 그 자리에서 이 훅으로 판정한다.
//   ⚠️ 막는 곳은 사업자번호가 없으면 **실제로 동작하지 않는** 기능만:
//      통장·카드 자동수집(CODEF 계정등록), 세금계산서 발행(홈택스).
//      결제(billing)는 일부러 막지 않는다 — 돈을 내겠다는 사람을 막을 이유가 없다.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";

export function useCompanyBizNo(): { hasBizNo: boolean; loading: boolean; companyId?: string | null } {
  const { user } = useUser();
  const companyId = user?.company_id;
  const { data, isLoading } = useQuery({
    queryKey: ["company-bizno", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("companies").select("business_number").eq("id", companyId!).maybeSingle();
      return (data?.business_number || "").replace(/\D/g, "");
    },
    enabled: !!companyId,
    staleTime: 60_000,
  });
  return {
    // 로딩 중에는 막지 않는다 — 잠깐의 미확정으로 기능이 깜빡이면 안 된다.
    hasBizNo: isLoading ? true : (data || "").length === 10,
    loading: isLoading,
    companyId,
  };
}
