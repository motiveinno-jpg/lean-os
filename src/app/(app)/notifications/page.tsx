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

// v4 D4: entity_type 기반 1차 라우팅. entity_id 가 있으면 상세 진입.
const ENTITY_HREF: Record<string, (id: string) => string> = {
  deal: (id) => `/projects/${id}`,
  approval: () => `/approvals`,
  invoice: () => `/tax-invoices`,
  payment: () => `/payments`,
  chat: () => `/chat`,
  document: (id) => `/documents?id=${id}`,           // 견적서/계약서 상세
  document_share: (id) => `/documents?id=${id}`,     // 공유 피드백 → 문서 상세
  signature_request: () => `/signatures`,
  hr_contract_package: () => `/my-contracts`,
  leave_request: () => `/employees?tab=leave`,
  attendance_edit_request: () => `/employees?tab=attendance`,
  expense_request: () => `/payments?tab=expenses`,
  // STEP 4 (PR-F): 외부 견적 승인 결정 알림 (submit_quote_decision RPC 가 서버측 INSERT).
  //   entity_id 는 quote_approvals.id — quoteApprovalsMap (entity_id → {deal_id, stage}) 가
  //   있으면 /projects?deal=<id>&action=<quote|contract> 로 점프, 없으면 fallback /projects.
  quote_approval: () => `/projects`,
};

// stage → ACTION_TAB key (project-slide-over.tsx): 'quote' 또는 'contract' 가 sec-quote 로 스크롤
function stageToAction(stage: string | null | undefined): 'quote' | 'contract' {
  return stage === 'contract' ? 'contract' : 'quote';
}

// v4 D4: type 기반 fallback — entity_type=null 인 경우 (피드백 알림 등).
//   직원 보고 캡처: type='document', entity_type=null, entity_id=<doc_id> 였음 →
//   기존 코드는 entity_type 매핑 실패 후 /dashboard 로 가버림 (버그).
const TYPE_HREF: Record<string, (id: string | null) => string> = {
  document: (id) => id ? `/documents?id=${id}` : `/documents`,
  document_feedback: (id) => id ? `/documents?id=${id}` : `/documents`,
  signature_request: (id) => id ? `/sign?id=${id}` : `/signatures`,
  deal_update: (id) => id ? `/projects/${id}` : `/projects`,
  payment_due: () => `/payments`,
  expense_request: () => `/payments?tab=expenses`,
  contract_expiry: (id) => id ? `/documents?id=${id}` : `/documents`,
  approval: () => `/approvals`,
  chat: () => `/chat`,
  // STEP 4 (PR-F): 견적 승인 결정 알림 (entity_type=null 인 경우의 보조 fallback).
  //   type='approval' + entity_type='quote_approval' 이면 ENTITY_HREF 우선이라
  //   여기 안 옴 — 안전망용.
};

export default function NotificationsPage() {
  const [rows, setRows] = useState<NotificationRow[]>([]);
  const [loading, setLoading] = useState(true);
  // quote_approval entity_id → { deal_id, stage } 매핑 — Link href 에서 사용
  const [quoteMap, setQuoteMap] = useState<Record<string, { deal_id: string; stage: string }>>({});

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
      const list = (data || []) as NotificationRow[];
      setRows(list);

      // quote_approval entity_ids 추려서 deal_id+stage 한 번에 prefetch
      const quoteIds = Array.from(new Set(
        list.filter(n => n.entity_type === 'quote_approval' && n.entity_id).map(n => n.entity_id as string),
      ));
      if (quoteIds.length > 0) {
        const { data: qaRows } = await (supabase as any)
          .from('quote_approvals')
          .select('id, deal_id, stage')
          .in('id', quoteIds);
        const map: Record<string, { deal_id: string; stage: string }> = {};
        for (const r of (qaRows || []) as Array<{ id: string; deal_id: string; stage: string }>) {
          map[r.id] = { deal_id: r.deal_id, stage: r.stage };
        }
        setQuoteMap(map);
      }

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
            // v4 D4: 1) entity_type 매핑 우선, 2) entity_type=null 이면 type 기반 fallback,
            //          3) 둘 다 실패 시에만 /dashboard.
            // L 견적/계약: quote_approval 알림은 quoteMap 으로 deal_id+stage 알면 정확한 라우팅.
            let href: string;
            if (n.entity_type === 'quote_approval' && n.entity_id && quoteMap[n.entity_id]) {
              const { deal_id, stage } = quoteMap[n.entity_id];
              href = `/projects/${encodeURIComponent(deal_id)}?action=${stageToAction(stage)}`;
            } else if (n.entity_type && n.entity_id && ENTITY_HREF[n.entity_type]) {
              href = ENTITY_HREF[n.entity_type](n.entity_id);
            } else if (TYPE_HREF[n.type]) {
              href = TYPE_HREF[n.type](n.entity_id);
            } else {
              href = '/dashboard';
            }
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
