"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

type Action = {
  id: string;
  actor_user_id: string;
  actor_email: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  context: any;
  created_at: string;
};

function fmtRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const m = Math.floor(ms / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

const ACTION_LABEL: Record<string, string> = {
  view_company: "회사 조회",
  set_industry: "업종 분류",
  resolve_error: "에러 해결",
  upsert_incident: "사고 기록",
  log_action: "기타",
};

export default function PlatformAuditPage() {
  const [hours, setHours] = useState<number>(168);

  const { data: items = [], isLoading } = useQuery<Action[]>({
    queryKey: ["op-actions", hours],
    queryFn: async () => {
      const { data, error } = await db.rpc("operator_list_actions", { p_limit: 500, p_hours: hours });
      if (error) throw error;
      return (data || []) as Action[];
    },
  });

  return (
    <div className="max-w-5xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">감사 로그</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            운영자의 회사 조회·변경 이력 — {items.length}건
          </p>
        </div>
        <select
          value={hours}
          onChange={(e) => setHours(Number(e.target.value))}
          className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)]"
        >
          <option value={24}>최근 24시간</option>
          <option value={168}>최근 7일</option>
          <option value={720}>최근 30일</option>
        </select>
      </div>

      {isLoading && <div className="text-sm text-[var(--text-dim)]">불러오는 중…</div>}

      {!isLoading && items.length === 0 && (
        <div className="glass-card p-8 text-center text-sm text-[var(--text-dim)]">
          이 기간에 감사 로그가 없습니다.
          <div className="mt-2 text-[11px]">
            운영자 페이지가 자동 기록을 호출하면 누적됩니다.
            (회사 드릴다운 진입·업종 분류·에러 해결 등)
          </div>
        </div>
      )}

      <div className="glass-card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="table-head-row">
                <th className="px-4 py-3 font-medium text-left">시각</th>
                <th className="px-4 py-3 font-medium text-left">운영자</th>
                <th className="px-4 py-3 font-medium text-left">행동</th>
                <th className="px-4 py-3 font-medium text-left">대상</th>
                <th className="px-4 py-3 font-medium text-left">컨텍스트</th>
              </tr>
            </thead>
            <tbody>
              {items.map((a) => (
                <tr key={a.id} className="border-b border-[var(--border)] hover:bg-[var(--bg-surface)]/60 transition">
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="text-xs text-[var(--text)]">{fmtRelative(a.created_at)}</div>
                    <div className="text-[10px] text-[var(--text-dim)]">{new Date(a.created_at).toLocaleString("ko-KR")}</div>
                  </td>
                  <td className="px-4 py-3 text-[var(--text-muted)] text-xs">{a.actor_email || a.actor_user_id.slice(0, 8)}</td>
                  <td className="px-4 py-3">
                    <span className="px-2.5 py-1 rounded-full bg-[var(--primary-light)] text-[var(--primary)] text-[11px] font-semibold">
                      {ACTION_LABEL[a.action] || a.action}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-[var(--text-muted)]">
                    {a.target_type && <span className="text-[var(--text-dim)]">{a.target_type}:</span>} {a.target_id || "—"}
                  </td>
                  <td className="px-4 py-3 text-[10px] text-[var(--text-dim)] font-mono max-w-xs truncate">
                    {a.context ? JSON.stringify(a.context) : "—"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="kpi-callout">
        <b>OP-F</b> · 운영자 행동은 RPC <span className="font-mono text-[var(--primary)]">operator_log_action</span> 호출로만 적재 (직접 INSERT 차단).
        회사 드릴다운 진입은 [id] 페이지에서 자동 호출.
      </div>
    </div>
  );
}
