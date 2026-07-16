"use client";

// 프로필 사진 맵 훅 — user id 목록으로 users.avatar_url 을 한 번에 조회해
//   { userId: avatar_url } 맵으로 반환. users SELECT RLS 가 회사 스코프
//   (company_id = get_my_company_id()) 라 같은 회사 구성원 사진만 조회된다.
//   결재 타임라인·참조·댓글처럼 companyId 없이 user id 만 있는 화면용.

import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

export function useAvatarMap(userIds: (string | null | undefined)[]): Record<string, string | null> {
  const ids = [...new Set(userIds.filter(Boolean) as string[])].sort();
  const { data } = useQuery({
    queryKey: ["avatar-map", ids.join(",")],
    queryFn: async () => {
      const { data: rows } = await supabase
        .from("users")
        .select("id, avatar_url")
        .in("id", ids);
      const map: Record<string, string | null> = {};
      for (const u of rows || []) map[u.id] = u.avatar_url;
      return map;
    },
    enabled: ids.length > 0,
    staleTime: 60_000,
  });
  return data || {};
}
