"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { getCurrentUser, getSurvivalData, getUnreadCounts, type SurvivalLevel } from "@/lib/queries";
import { openGlobalSearch } from "@/components/global-search";

const NAV = [
  { href: "/dashboard", label: "상황판", desc: "Command Center" },
  { href: "/deals", label: "딜 관리", desc: "Deals & Margins" },
  { href: "/partners", label: "거래처/CRM", desc: "Partners" },
  { href: "/payments", label: "결제 관리", desc: "Payment Queue" },
  { href: "/documents", label: "문서/계약", desc: "Documents" },
  { href: "/transactions", label: "거래내역", desc: "Bank Inbox" },
  { href: "/matching", label: "매칭 엔진", desc: "Auto-Match" },
  { href: "/chat", label: "딜룸 채팅", desc: "Dealroom Chat", badgeKey: "chat" },
  { href: "/vault", label: "금고", desc: "Vault & Assets" },
  { href: "/treasury", label: "자산운용", desc: "Treasury" },
  { href: "/employees", label: "인력/비용", desc: "HR & Costs" },
  { href: "/settings", label: "설정", desc: "Settings" },
];

const LEVEL_COLORS: Record<SurvivalLevel, string> = {
  CRITICAL: '#ff2d55',
  DANGER: '#ef4444',
  WARNING: '#f59e0b',
  STABLE: '#22c55e',
  SAFE: '#22c55e',
};

export function Sidebar() {
  const pathname = usePathname();
  const router = useRouter();
  const [survivalMonths, setSurvivalMonths] = useState<number | null>(null);
  const [survivalLevel, setSurvivalLevel] = useState<SurvivalLevel>('SAFE');
  const [chatUnread, setChatUnread] = useState(0);

  useEffect(() => {
    getCurrentUser().then(async (u) => {
      if (!u) return;
      try {
        const data = await getSurvivalData(u.company_id);
        setSurvivalMonths(data.survivalMonths);
        setSurvivalLevel(data.survivalLevel);
      } catch {}

      // Fetch unread chat count
      try {
        const counts = await getUnreadCounts(u.company_id, u.id);
        const total = Array.from(counts.values()).reduce((s, v) => s + v, 0);
        setChatUnread(total);
      } catch {}
    });

    // Refresh unread count every 30s
    const interval = setInterval(async () => {
      try {
        const u = await getCurrentUser();
        if (!u) return;
        const counts = await getUnreadCounts(u.company_id, u.id);
        const total = Array.from(counts.values()).reduce((s, v) => s + v, 0);
        setChatUnread(total);
      } catch {}
    }, 30000);

    return () => clearInterval(interval);
  }, []);

  async function handleLogout() {
    await supabase.auth.signOut();
    router.push("/auth");
  }

  const levelColor = LEVEL_COLORS[survivalLevel];
  const isDanger = survivalLevel === 'CRITICAL' || survivalLevel === 'DANGER';

  return (
    <aside className="w-56 h-screen fixed left-0 top-0 bg-[var(--bg-card)] border-r border-[var(--border)] flex flex-col z-50">
      {/* Logo + Survival Indicator */}
      <div className="p-4 border-b border-[var(--border)]">
        <div className="flex items-center gap-2.5">
          <div className={`w-8 h-8 rounded-lg flex items-center justify-center text-white font-black text-sm ${isDanger ? 'animate-pulse-danger' : ''}`}
            style={{ background: levelColor }}>
            L
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-xs font-black tracking-tight">LeanOS</div>
            <div className="text-[9px] text-[var(--text-dim)] tracking-wider">SURVIVAL OS</div>
          </div>
        </div>

        {/* Mini Survival Meter */}
        {survivalMonths !== null && (
          <div className="mt-3 px-1">
            <div className="flex items-center justify-between mb-1">
              <span className="text-[9px] text-[var(--text-dim)] uppercase tracking-wider font-semibold">생존</span>
              <span className="text-[9px] font-bold mono-number" style={{ color: levelColor }}>
                {survivalMonths < 999 ? `${survivalMonths}개월` : 'SAFE'}
              </span>
            </div>
            <div className="h-1 rounded-full bg-[var(--bg-surface)] overflow-hidden">
              <div className="h-full rounded-full transition-all duration-1000"
                style={{
                  width: `${Math.min(100, survivalMonths < 999 ? (survivalMonths / 12) * 100 : 100)}%`,
                  background: levelColor,
                }} />
            </div>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="px-2 pt-2">
        <button
          onClick={() => openGlobalSearch()}
          className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-[var(--text-dim)] bg-[var(--bg-surface)] hover:bg-white/[.05] transition border border-[var(--border)]"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35" strokeLinecap="round" strokeWidth="2"/></svg>
          <span>검색</span>
          <kbd className="ml-auto text-[9px] bg-[var(--bg-card)] px-1.5 py-0.5 rounded border border-[var(--border)]">⌘K</kbd>
        </button>
      </div>

      {/* Nav */}
      <nav className="flex-1 p-2 space-y-0.5 overflow-y-auto">
        {NAV.map((item) => {
          const active = pathname === item.href || pathname.startsWith(item.href + "/");
          const badge = (item as any).badgeKey === 'chat' ? chatUnread : 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              className={`flex items-center justify-between px-3 py-2 rounded-lg text-xs transition-all ${
                active
                  ? "bg-[var(--primary)]/10 text-[var(--primary)]"
                  : "text-[var(--text-muted)] hover:text-white hover:bg-white/[.03]"
              }`}
            >
              <div className="flex flex-col">
                <span className="font-semibold">{item.label}</span>
                <span className={`text-[9px] ${active ? 'text-[var(--primary)]/60' : 'text-[var(--text-dim)]'}`}>
                  {item.desc}
                </span>
              </div>
              {badge > 0 && (
                <span className="min-w-[18px] h-[18px] flex items-center justify-center bg-red-500 text-white text-[9px] font-bold rounded-full px-1">
                  {badge > 99 ? '99+' : badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      {/* Footer */}
      <div className="p-2 border-t border-[var(--border)]">
        <button
          onClick={handleLogout}
          className="w-full px-3 py-2 rounded-lg text-xs text-[var(--text-dim)] hover:text-red-400 hover:bg-red-400/5 transition text-left"
        >
          로그아웃
        </button>
      </div>
    </aside>
  );
}
