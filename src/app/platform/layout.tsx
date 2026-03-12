"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import Link from "next/link";

const SUPER_ADMIN_COMPANY = "모티브이노베이션";

const NAV_ITEMS = [
  { href: "/platform", label: "개요", icon: "chart" },
  { href: "/platform/customers", label: "고객사", icon: "building" },
  { href: "/platform/revenue", label: "수익", icon: "dollar" },
  { href: "/platform/feedback", label: "피드백", icon: "message" },
  { href: "/platform/referral", label: "추천", icon: "gift" },
  { href: "/platform/system", label: "시스템", icon: "cog" },
];

function NavIcon({ type, active }: { type: string; active: boolean }) {
  const cls = `w-4 h-4 ${active ? "text-white" : "text-[#94a3b8]"}`;
  const props = { className: cls, fill: "none", stroke: "currentColor", strokeWidth: 1.8, viewBox: "0 0 24 24" };
  switch (type) {
    case "chart": return <svg {...props}><path d="M3 3v18h18"/><path d="M7 16l4-8 4 4 5-9"/></svg>;
    case "building": return <svg {...props}><rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4M8 6h.01M16 6h.01M12 6h.01M8 10h.01M16 10h.01M12 10h.01M8 14h.01M16 14h.01M12 14h.01"/></svg>;
    case "dollar": return <svg {...props}><line x1="12" y1="1" x2="12" y2="23"/><path d="M17 5H9.5a3.5 3.5 0 000 7h5a3.5 3.5 0 010 7H6"/></svg>;
    case "message": return <svg {...props}><path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/></svg>;
    case "gift": return <svg {...props}><polyline points="20 12 20 22 4 22 4 12"/><rect x="2" y="7" width="20" height="5"/><line x1="12" y1="22" x2="12" y2="7"/><path d="M12 7H7.5a2.5 2.5 0 010-5C11 2 12 7 12 7z"/><path d="M12 7h4.5a2.5 2.5 0 000-5C13 2 12 7 12 7z"/></svg>;
    case "cog": return <svg {...props}><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 01-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 010-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 012.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 014 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 010 4h-.09a1.65 1.65 0 00-1.51 1z"/></svg>;
    default: return null;
  }
}

export default function PlatformLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [status, setStatus] = useState<"loading" | "ready" | "denied">("loading");
  const [userName, setUserName] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await supabase.auth.getSession();
        if (!data.session) { router.replace("/auth"); return; }
        const user = await getCurrentUser();
        if (cancelled) return;
        if (!user || user.role !== "owner" || user.companies?.name !== SUPER_ADMIN_COMPANY) {
          setStatus("denied");
          return;
        }
        setUserName(user.name || user.email || "Admin");
        setStatus("ready");
      } catch {
        if (!cancelled) setStatus("denied");
      }
    })();
    return () => { cancelled = true; };
  }, [router]);

  // 인라인 스타일 — CSS 로딩 전에도 보이도록
  if (status === "denied") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b0f1a", color: "#fff" }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>🔒</div>
          <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 8 }}>접근 권한 없음</h1>
          <p style={{ fontSize: 14, color: "#64748b", marginBottom: 24 }}>OwnerView 플랫폼 관리자만 접근할 수 있습니다.</p>
          <a href="/dashboard" style={{ padding: "10px 24px", background: "#2563eb", color: "#fff", borderRadius: 12, fontSize: 14, fontWeight: 600, textDecoration: "none" }}>
            대시보드로 이동
          </a>
        </div>
      </div>
    );
  }

  if (status === "loading") {
    return (
      <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#0b0f1a" }}>
        <div style={{ width: 32, height: 32, border: "2px solid #3b82f6", borderTopColor: "transparent", borderRadius: "50%", animation: "spin 1s linear infinite" }} />
        <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
      </div>
    );
  }

  return (
    <div style={{ minHeight: "100vh", display: "flex", background: "#0b0f1a" }}>
      {/* Sidebar */}
      <aside className="w-56 bg-[#111827] border-r border-[#1e293b] flex flex-col fixed inset-y-0 left-0 z-40">
        <div className="p-5 border-b border-[#1e293b]">
          <div className="flex items-center gap-2">
            <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center">
              <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/>
              </svg>
            </div>
            <div>
              <div className="text-sm font-bold text-white">OwnerView</div>
              <div className="text-[10px] text-[#64748b] font-medium">Platform Admin</div>
            </div>
          </div>
        </div>

        <nav className="flex-1 py-3 px-2 space-y-0.5">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href || (item.href !== "/platform" && pathname.startsWith(item.href));
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition ${
                  active ? "bg-blue-600/20 text-white" : "text-[#94a3b8] hover:text-white hover:bg-[#1e293b]"
                }`}
              >
                <NavIcon type={item.icon} active={active} />
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="p-4 border-t border-[#1e293b]">
          <div className="flex items-center gap-2 mb-3">
            <div className="w-7 h-7 rounded-full bg-blue-600 flex items-center justify-center text-white text-xs font-bold">
              {userName.charAt(0)}
            </div>
            <div className="text-xs text-[#94a3b8] truncate">{userName}</div>
          </div>
          <Link href="/dashboard" className="flex items-center gap-2 text-xs text-[#64748b] hover:text-white transition">
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M15 19l-7-7 7-7"/></svg>
            고객 앱으로 돌아가기
          </Link>
        </div>
      </aside>

      <main className="flex-1 ml-56 p-6 lg:p-8">
        {children}
      </main>
    </div>
  );
}
