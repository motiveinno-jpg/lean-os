"use client";

import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { supabase } from "@/lib/supabase";

interface SidebarContextValue {
  collapsed: boolean;
  toggleSidebar: () => void;
  mobileOpen: boolean;
  setMobileOpen: (open: boolean) => void;
  pinnedPages: string[];
  togglePin: (path: string) => void;
  isPinned: (path: string) => boolean;
}

const SidebarContext = createContext<SidebarContextValue | null>(null);

const STORAGE_KEY = "leanos-sidebar-collapsed";
const PIN_STORAGE_KEY = "leanos-pinned-pages";

export function SidebarProvider({ children }: { children: ReactNode }) {
  const [collapsed, setCollapsed] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [pinnedPages, setPinnedPages] = useState<string[]>([]);
  const [hydrated, setHydrated] = useState(false);

  // Read from localStorage after hydration
  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored === "true") setCollapsed(true);
    } catch {}
    try {
      const pins = localStorage.getItem(PIN_STORAGE_KEY);
      if (pins) setPinnedPages(JSON.parse(pins));
    } catch {}
    setHydrated(true);
  }, []);

  // Load pins from Supabase (overwrites localStorage)
  useEffect(() => {
    if (!hydrated) return;
    (async () => {
      try {
        const { data: { user } } = await supabase.auth.getUser();
        if (!user) return;
        const db = supabase as any;
        const { data } = await db
          .from("user_preferences")
          .select("pinned_pages")
          .eq("user_id", user.id)
          .single();
        if (data?.pinned_pages && Array.isArray(data.pinned_pages)) {
          setPinnedPages(data.pinned_pages);
        }
      } catch {}
    })();
  }, [hydrated]);

  // Persist to localStorage
  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(STORAGE_KEY, String(collapsed));
    } catch {}
  }, [collapsed, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    try {
      localStorage.setItem(PIN_STORAGE_KEY, JSON.stringify(pinnedPages));
    } catch {}
  }, [pinnedPages, hydrated]);

  // Close mobile drawer on resize to desktop
  useEffect(() => {
    function handleResize() {
      if (window.innerWidth >= 768) {
        setMobileOpen(false);
      }
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const toggleSidebar = useCallback(() => {
    setCollapsed((prev) => !prev);
  }, []);

  const isPinned = useCallback((path: string) => pinnedPages.includes(path), [pinnedPages]);

  const togglePin = useCallback((path: string) => {
    setPinnedPages(prev => {
      const next = prev.includes(path) ? prev.filter(p => p !== path) : [...prev, path];
      // Debounced Supabase save
      setTimeout(async () => {
        try {
          const { data: { user } } = await supabase.auth.getUser();
          if (!user) return;
          const db = supabase as any;
          const { data: userData } = await db.from("users").select("company_id").eq("id", user.id).single();
          if (!userData?.company_id) return;
          await db
            .from("user_preferences")
            .upsert({
              user_id: user.id,
              company_id: userData.company_id,
              pinned_pages: next,
              updated_at: new Date().toISOString(),
            }, { onConflict: "user_id,company_id" });
        } catch {}
      }, 500);
      return next;
    });
  }, []);

  return (
    <SidebarContext.Provider value={{ collapsed, toggleSidebar, mobileOpen, setMobileOpen, pinnedPages, togglePin, isPinned }}>
      {children}
    </SidebarContext.Provider>
  );
}

export function useSidebar(): SidebarContextValue {
  const ctx = useContext(SidebarContext);
  if (!ctx) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return ctx;
}
