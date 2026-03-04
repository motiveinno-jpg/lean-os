"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { Sidebar } from "@/components/sidebar";
import { GlobalSearch } from "@/components/global-search";
import { NotificationCenter } from "@/components/notification-center";
import { SidebarProvider, useSidebar } from "@/components/sidebar-context";
import { UserProvider, useUser } from "@/components/user-context";

/* ── Mobile Bottom Nav for Partner / Employee ── */
const PARTNER_TABS = [
  { href: "/dashboard", label: "홈", icon: "home" },
  { href: "/deals", label: "프로젝트", icon: "briefcase" },
  { href: "/documents", label: "서류", icon: "file" },
  { href: "/chat", label: "채팅", icon: "chat" },
];
const EMPLOYEE_TABS = [
  { href: "/dashboard", label: "홈", icon: "home" },
  { href: "/deals", label: "프로젝트", icon: "briefcase" },
  { href: "/employees", label: "근태/급여", icon: "clock" },
  { href: "/chat", label: "채팅", icon: "chat" },
  { href: "/documents", label: "서류", icon: "file" },
];

function BottomTabIcon({ name, active }: { name: string; active: boolean }) {
  const cn = `w-5 h-5 ${active ? "text-[var(--primary)]" : "text-[var(--text-muted)]"}`;
  const p = { className: cn, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24", strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  switch (name) {
    case "home": return <svg {...p}><path d="M3 12l9-8 9 8"/><path d="M5 10v10a1 1 0 001 1h3a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1h3a1 1 0 001-1V10"/></svg>;
    case "briefcase": return <svg {...p}><rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 00-2-2h-4a2 2 0 00-2 2v2"/></svg>;
    case "file": return <svg {...p}><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>;
    case "chat": return <svg {...p}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
    case "clock": return <svg {...p}><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>;
    default: return null;
  }
}

function MobileBottomNav() {
  const { role } = useUser();
  const pathname = usePathname();
  if (role !== "partner" && role !== "employee") return null;
  const tabs = role === "partner" ? PARTNER_TABS : EMPLOYEE_TABS;

  return (
    <nav className="md:hidden fixed bottom-0 left-0 right-0 z-40 bg-[var(--bg-card)] border-t border-[var(--border)] safe-area-bottom" style={{ boxShadow: "0 -1px 8px rgba(0,0,0,0.06)" }}>
      <div className="flex items-center justify-around h-14 px-1">
        {tabs.map((tab) => {
          const active = pathname === tab.href || pathname.startsWith(tab.href + "/");
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex flex-col items-center justify-center gap-0.5 flex-1 py-1 min-w-0 transition-colors ${active ? "text-[var(--primary)]" : "text-[var(--text-muted)]"}`}
            >
              <BottomTabIcon name={tab.icon} active={active} />
              <span className={`text-[10px] font-medium truncate ${active ? "text-[var(--primary)]" : ""}`}>{tab.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}

function AppContent({ children }: { children: React.ReactNode }) {
  const { collapsed, setMobileOpen } = useSidebar();
  const { role } = useUser();
  const isLimitedRole = role === "partner" || role === "employee";

  return (
    <div className="flex min-h-screen">
      <Sidebar />
      {/* Top header bar (mobile: hamburger + notification, desktop: notification only) */}
      <div
        className={`fixed top-0 right-0 z-30 h-12 flex items-center justify-between px-3 transition-[left] duration-200 ${
          collapsed ? "md:left-[68px]" : "md:left-60"
        } left-0`}
      >
        {/* Left: Mobile hamburger — hide for limited roles on mobile (they use bottom nav) */}
        <button
          onClick={() => setMobileOpen(true)}
          className={`${isLimitedRole ? "hidden" : "md:hidden"} p-2 rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition`}
          style={{ boxShadow: "var(--shadow-sm)" }}
          aria-label="메뉴 열기"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24" strokeLinecap="round" strokeLinejoin="round">
            <line x1="3" y1="6" x2="21" y2="6" />
            <line x1="3" y1="12" x2="21" y2="12" />
            <line x1="3" y1="18" x2="21" y2="18" />
          </svg>
        </button>
        {/* Logo for limited roles on mobile */}
        {isLimitedRole && (
          <div className="md:hidden flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg text-white text-xs font-black flex items-center justify-center" style={{ background: "linear-gradient(135deg, #2563EB, #7C3AED)" }}>L</div>
            <span className="text-sm font-bold text-[var(--text)]">LeanOS</span>
          </div>
        )}
        <div className="hidden md:block" />

        {/* Right: Notification bell */}
        <NotificationCenter />
      </div>

      {/* Main content */}
      <main
        className={`flex-1 max-w-[1440px] transition-[margin] duration-200 pt-14 md:pt-14 ${
          collapsed ? "md:ml-[68px]" : "md:ml-60"
        } ml-0 ${isLimitedRole ? "p-4 pb-20 md:p-6 md:pb-6" : "p-6"}`}
      >
        {children}
      </main>
      <MobileBottomNav />
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
    <UserProvider>
      <SidebarProvider>
        <AppContent>{children}</AppContent>
      </SidebarProvider>
    </UserProvider>
  );
}
