"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getCurrentUser, clearCurrentUserCache, type CurrentUser } from "@/lib/queries";
import { supabase } from "@/lib/supabase";

//   계정 종류. 대표·관리자·직원 구분은 2026-09-11 에 없앴다 — 마스터 여부(is_master)와
//   권한(member_permissions)이 전부다. partner 는 외부 협력사, advisor 는 제휴 세무사 계정.
export type UserRole = "member" | "partner" | "advisor";

interface UserContextType {
  user: CurrentUser | null;
  role: UserRole;
  loading: boolean;
  refresh: () => Promise<CurrentUser | null>;
}

const UserContext = createContext<UserContextType>({
  user: null,
  role: "member",
  loading: true,
  refresh: async () => null,
});

export function useUser() {
  return useContext(UserContext);
}

export function UserProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<CurrentUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async () => {
    try {
      clearCurrentUserCache(); // 명시적 새로고침은 항상 최신 조회
      const u = await getCurrentUser();
      setUser(u);
      return u;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let stop = false;
    //   조회가 실패하면 user 가 null 로 굳어 회사·권한이 통째로 사라진 화면이 된다
    //   (사이드바는 기본 메뉴만, 통장·구성원은 대시보드로 튕김). 예전엔 사용자가 직접
    //   새로고침해야만 풀렸다. 세션이 살아 있는데 사용자만 못 읽은 경우에 한해
    //   뒤에서 몇 번 더 시도한다 — 네트워크가 돌아오면 스스로 복구된다.
    (async () => {
      const u = await refresh();
      if (u || stop) return;
      for (const wait of [2000, 5000, 15000]) {
        await new Promise((r) => setTimeout(r, wait));
        if (stop) return;
        const { data: { session } } = await supabase.auth.getSession().catch(() => ({ data: { session: null } }) as any);
        if (!session) return;          // 정말 로그아웃 상태면 더 시도하지 않는다
        const again = await refresh();
        if (again) return;
      }
    })();
    return () => { stop = true; };
  }, []);

  const role = (user?.role as UserRole) || "member";

  return (
    <UserContext.Provider value={{ user, role, loading, refresh }}>
      {children}
    </UserContext.Provider>
  );
}
