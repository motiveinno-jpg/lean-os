"use client";

import { createContext, useContext, useEffect, useState } from "react";
import { getCurrentUser, type CurrentUser } from "@/lib/queries";

export type UserRole = "owner" | "admin" | "employee" | "partner";

interface UserContextType {
  user: CurrentUser | null;
  role: UserRole;
  loading: boolean;
  refresh: () => Promise<void>;
}

const UserContext = createContext<UserContextType>({
  user: null,
  role: "employee",
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

  const role = (user?.role as UserRole) || "employee";

  return (
    <UserContext.Provider value={{ user, role, loading, refresh }}>
      {children}
    </UserContext.Provider>
  );
}
