"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getCurrentUser, clearCurrentUserCache, type CurrentUser } from "@/lib/queries";

//   계정 종류. 대표·관리자·직원 구분은 2026-09-11 에 없앴다 — 마스터 여부(is_master)와
//   권한(member_permissions)이 전부다. partner 는 외부 협력사, advisor 는 제휴 세무사 계정.
export type UserRole = "member" | "partner" | "advisor";

interface UserContextType {
  user: CurrentUser | null;
  role: UserRole;
  loading: boolean;
  refresh: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  user: null,
  role: "member",
  loading: true,
  refresh: async () => {},
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
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    refresh();
  }, []);

  const role = (user?.role as UserRole) || "member";

  return (
    <UserContext.Provider value={{ user, role, loading, refresh }}>
      {children}
    </UserContext.Provider>
  );
}
