"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import Link from "next/link";

interface NotificationRow {
  id: string;
  type: string;
  title: string;
  message: string | null;
  entity_type: string | null;
  entity_id: string | null;
  is_read: boolean;
  created_at: string;
}

const ENTITY_HREF: Record<string, (id: string) => string> = {
  deal: (id) => `/deals?id=${id}`,
  approval: () => `/approvals`,
  invoice: () => `/tax-invoices`,
  payment: () => `/payments`,
  chat: () => `/chat`,
  document: () => `/documents`,
  hr_contract_package: () => `/my-contracts`,
  leave_request: () => `/employees?tab=leave`,
};

export default function NotificationsPage() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const u = await getCurrentUser();
      if (!u) { setLoading(false); return; }
      const { data } = await (supabase as any)
        .from('notifications')
        .select('id, type, title, message, entity_type, entity_id, is_read, created_at')
        .eq('user_id', u.id)
        .order('created_at', { ascending: false })
        .limit(100);
      setRows((data || []) as NotificationRow[]);
      setLoading(false);
    })();
  }, []);

  const markAllRead = async () => {
    const u = await getCurrentUser();
    if (!u) return;
    await (supabase as any).from('notifications').update({ is_read: true }).eq('user_id', u.id).eq('is_read', false);
    setRows(rs => rs.map(r => ({ ...r, is_read: true })));
    // 사이드바 뱃지 즉시 갱신
    window.dispatchEvent(new Event('sidebar-refresh-badges'));
  };

  const markOneRead = async (id: string) => {
    const u = await getCurrentUser();
    if (!u) return;
    await (supabase as any).from('notifications').update({ is_read: true }).eq('id', id);
    setRows(rs => rs.map(r => (r.id === id ? { ...r, is_read: true } : r)));
    window.dispatchEvent(new Event('sidebar-refresh-badges'));
  };

  const unread = rows.filter(r => !r.is_read).length;

  return (
    <div className="p-6 max-w-3xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">알림</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">{rows.length}건 · 안읽음 {unread}건</p>
        </div>
        {unread > 0 && (
          <button onClick={markAllRead}
            className="px-3 py-1.5 text-xs font-semibold rounded-lg bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)] transition">
            모두 읽음 표시
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-[var(--text-dim)]">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16 bg-[var(--bg-card)] rounded-xl border border-[var(--border)]">
          <div className="text-3xl mb-2">🔔</div>
          <div className="text-sm text-[var(--text)]">알림이 없습니다</div>
          <div className="text-[11px] text-[var(--text-dim)] mt-1">새 알림이 도착하면 여기에 표시됩니다.</div>
        </div>
      ) : (
        <div className="space-y-2">
          {rows.map(n => {
            const href = n.entity_type && n.entity_id && ENTITY_HREF[n.entity_type]
              ? ENTITY_HREF[n.entity_type](n.entity_id)
              : '/dashboard';
            const date = n.created_at ? new Date(n.created_at).toLocaleString('ko-KR') : '';
            return (
              <Link key={n.id} href={href}
                onClick={() => { if (!n.is_read) markOneRead(n.id); }}
                className={`block rounded-xl border transition px-4 py-3 ${
                  n.is_read
                    ? 'bg-[var(--bg-card)] border-[var(--border)] hover:bg-[var(--bg-surface)]'
                    : 'bg-[var(--primary)]/5 border-[var(--primary)]/30 hover:bg-[var(--primary)]/10'
                }`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className={`text-sm font-semibold ${n.is_read ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>
                      {!n.is_read && <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--primary)] mr-1.5 align-middle" />}
                      {n.title}
                    </div>
                    {n.message && (
                      <div className="text-xs text-[var(--text-dim)] mt-1 line-clamp-2">{n.message}</div>
                    )}
                  </div>
                  <div className="text-[10px] text-[var(--text-dim)] shrink-0">{date}</div>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
