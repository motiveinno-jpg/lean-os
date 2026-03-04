"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { Sidebar } from "@/components/sidebar";
import { GlobalSearch } from "@/components/global-search";
import { NotificationCenter } from "@/components/notification-center";
import { SidebarProvider, useSidebar } from "@/components/sidebar-context";

function AppContent({ children }: { children: React.ReactNode }) {
  const { collapsed, setMobileOpen } = useSidebar();

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      {/* Top header bar (mobile: hamburger + notification, desktop: notification only) */}
      <div
        className={`fixed top-0 right-0 z-30 h-12 flex items-center justify-between px-3 transition-[left] duration-200 ${
          collapsed ? "md:left-[68px]" : "md:left-60"
        } left-0`}
      >
        {/* Left: Mobile hamburger */}
        <button
          onClick={() => setMobileOpen(true)}
          className="md:hidden p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition"
          style={{ boxShadow: "var(--shadow-sm)" }}
          aria-label="메뉴 열기"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        <div className="hidden md:block" />

        {/* Right: Notification bell */}
        <NotificationCenter />
      </div>

      {/* Main content: on desktop adjust margin based on sidebar state, on mobile full width with top padding for header */}
      <main
        className={`flex-1 p-6 max-w-[1440px] transition-[margin] duration-200 pt-14 md:pt-14 ${
          collapsed ? "md:ml-[68px]" : "md:ml-60"
        } ml-0`}
      >
        {children}
      </main>
      <GlobalSearch />
    </div>
  );
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      if (!data.session) router.replace("/auth");
      else setReady(true);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") router.replace("/auth");
    });
    return () => subscription.unsubscribe();
  }, [router]);

  if (!ready) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[var(--primary)] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <SidebarProvider>
      <AppContent>{children}</AppContent>
    </SidebarProvider>
  );
}
