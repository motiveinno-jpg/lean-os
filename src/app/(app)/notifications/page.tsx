"use client";

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import Link from "next/link";
import { EmptyState } from "@/components/empty-state";
import { resolveNotificationHref, type NotificationRow } from "@/lib/notification-routes";

type NotifData = { rows: NotificationRow[]; quoteMap: Record<string, { deal_id: string; stage: string }> };

export default function NotificationsPage() {
  const queryClient = useQueryClient();

  // react-query 캐시 — 30초 내 재방문은 즉시 표시(staleTime 전역 30s). rows + quote_approval 라우팅 맵 동시 로드.
  const { data, isLoading: loading } = useQuery<NotifData>({
    queryKey: ['notifications'],
    queryFn: async () => {
      const u = await getCurrentUser();
      if (!u) return { rows: [], quoteMap: {} };
      const { data: nRows } = await (supabase as any)
        .from('notifications')
        .select('id, type, title, message, entity_type, entity_id, is_read, created_at')
        .eq('user_id', u.id)
        .order('created_at', { ascending: false })
        .limit(100);
      const list = (nRows || []) as NotificationRow[];

      // quote_approval entity_ids 추려서 deal_id+stage 한 번에 prefetch
      const quoteIds = Array.from(new Set(
        list.filter(n => n.entity_type === 'quote_approval' && n.entity_id).map(n => n.entity_id as string),
      ));
      const map: Record<string, { deal_id: string; stage: string }> = {};
      if (quoteIds.length > 0) {
        const { data: qaRows } = await (supabase as any)
          .from('quote_approvals')
          .select('id, deal_id, stage')
          .in('id', quoteIds);
        for (const r of (qaRows || []) as Array<{ id: string; deal_id: string; stage: string }>) {
          map[r.id] = { deal_id: r.deal_id, stage: r.stage };
        }
      }
      return { rows: list, quoteMap: map };
    },
  });

  const rows = data?.rows ?? [];
  const quoteMap = data?.quoteMap ?? {};

  // 캐시 내 rows 의 is_read 만 즉시 패치 (낙관적 갱신)
  const patchCache = (fn: (r: NotificationRow) => NotificationRow) => {
    queryClient.setQueryData<NotifData>(['notifications'], (old) =>
      old ? { ...old, rows: old.rows.map(fn) } : old,
    );
  };

  const markAllRead = async () => {
    const u = await getCurrentUser();
    if (!u) return;
    await (supabase as any).from('notifications').update({ is_read: true }).eq('user_id', u.id).eq('is_read', false);
    patchCache(r => ({ ...r, is_read: true }));
    // 사이드바 뱃지 즉시 갱신
    window.dispatchEvent(new Event('sidebar-refresh-badges'));
  };

  const markOneRead = async (id: string) => {
    const u = await getCurrentUser();
    if (!u) return;
    await (supabase as any).from('notifications').update({ is_read: true }).eq('id', id);
    patchCache(r => (r.id === id ? { ...r, is_read: true } : r));
    window.dispatchEvent(new Event('sidebar-refresh-badges'));
  };

  const unread = rows.filter(r => !r.is_read).length;

  return (
    <div>
      <div className="page-sticky-header flex flex-wrap items-center justify-between gap-2 mb-6">
        <p className="text-xs text-[var(--text-dim)]">
          전체 <span className="mono-number font-semibold text-[var(--text-muted)]">{rows.length}</span>건 · 안읽음{" "}
          <span className={`mono-number font-semibold ${unread > 0 ? "text-[var(--primary)]" : "text-[var(--text-muted)]"}`}>{unread}</span>건
        </p>
        {unread > 0 && (
          <button onClick={markAllRead} className="btn-secondary">
            모두 읽음 표시
          </button>
        )}
      </div>

      {loading ? (
        <div className="text-center py-12 text-sm text-[var(--text-dim)]">불러오는 중...</div>
      ) : rows.length === 0 ? (
        <EmptyState
          card
          icon="🔔"
          title="알림이 없습니다"
          desc="새 알림이 도착하면 여기에 표시됩니다."
          action={<Link href="/dashboard" className="btn-secondary">대시보드로 이동</Link>}
        />
      ) : (
        <div className="glass-card overflow-hidden divide-y divide-[var(--border)]">
          {rows.map(n => {
            const href = resolveNotificationHref(n, quoteMap);
            const date = n.created_at ? new Date(n.created_at).toLocaleString('ko-KR') : '';
            return (
              <Link key={n.id} href={href}
                onClick={() => { if (!n.is_read) markOneRead(n.id); }}
                className={`flex items-start gap-3 px-5 py-3.5 transition ${
                  n.is_read
                    ? 'hover:bg-[var(--bg-surface)]/60'
                    : 'bg-[var(--primary)]/5 hover:bg-[var(--primary)]/10'
                }`}>
                <span className="kpi-icon">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15 17h5l-1.4-1.4A2 2 0 0118 14.2V11a6 6 0 00-4-5.7V5a2 2 0 10-4 0v.3A6 6 0 006 11v3.2a2 2 0 01-.6 1.4L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                  </svg>
                </span>
                <div className="flex-1 min-w-0">
                  <div className={`text-sm font-semibold ${n.is_read ? 'text-[var(--text-muted)]' : 'text-[var(--text)]'}`}>
                    {!n.is_read && <span className="inline-block w-1.5 h-1.5 rounded-full bg-[var(--primary)] mr-1.5 align-middle" />}
                    {n.title}
                  </div>
                  {n.message && (
                    <div className="text-xs text-[var(--text-dim)] mt-1 line-clamp-2">{n.message}</div>
                  )}
                </div>
                <div className="text-[10px] text-[var(--text-dim)] shrink-0 mt-0.5">{date}</div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
