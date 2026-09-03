"use client";
// 운영자 로그 — 2026-09-03 v2 pf 디자인. 조회 RPC(operator_list_actions)와 기간 필터는 그대로.
import { SystemTabs } from "../_components/system-tabs";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfSeg, PfSkeleton, PfEmpty } from "../_components/pf/ui";
import { PfBars } from "../_components/pf/charts";

const db = supabase;

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
  // 운영자 액션 API (admin-action) — 계정 지원
  admin_reset_password: "임시 비밀번호 발급",
  admin_reset_link: "재설정 링크 생성",
  admin_change_email: "이메일 변경",
  admin_set_role: "역할 변경",
  admin_ban: "계정 잠금",
  admin_unban: "잠금 해제",
  // 운영자 액션 API — 구독 관리
  admin_extend_trial: "체험 연장",
  admin_change_plan: "플랜 변경",
  admin_set_subscription_status: "구독 상태 변경",
  admin_set_seats: "좌석 조정",
};
// 되돌리기 어려운(민감한) 행동 — 표에서 눈에 띄게
const SENSITIVE = new Set(["admin_reset_password", "admin_reset_link", "admin_change_email", "admin_set_role", "admin_ban", "admin_unban", "admin_change_plan", "admin_set_subscription_status", "admin_set_seats", "admin_extend_trial"]);

const TARGET_LABEL: Record<string, string> = { company: "회사", user: "사용자", error: "오류", incident: "사고", subscription: "구독" };

export default function PlatformAuditPage() {
  const [hours, setHours] = useState<number>(168);
  const [actionFilter, setActionFilter] = useState<string>("all");

  const { data: items = [], isLoading } = useQuery<Action[]>({
    queryKey: ["op-actions", hours],
    queryFn: async () => {
      const { data, error } = await db.rpc("operator_list_actions", { p_limit: 500, p_hours: hours });
      if (error) throw error;
      return (data || []) as Action[];
    },
  });

  // 행동별 건수 (막대 차트 + 필터 칩)
  const byAction = useMemo(() => {
    const m = new Map<string, number>();
    for (const a of items) m.set(a.action, (m.get(a.action) || 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]).map(([action, n]) => ({ action, name: ACTION_LABEL[action] || action, n }));
  }, [items]);
  const sensitiveCount = items.filter((a) => SENSITIVE.has(a.action)).length;
  const operators = new Set(items.map((a) => a.actor_email || a.actor_user_id)).size;
  const shown = actionFilter === "all" ? items : items.filter((a) => a.action === actionFilter);
  const hoursLabel = hours === 24 ? "최근 24시간" : hours === 168 ? "최근 7일" : "최근 30일";

  return (
    <PfPage>
      <PfPageHead
        eyebrow="운영"
        title="운영자 로그"
        desc="운영자가 고객사를 조회하거나 계정·구독을 바꾼 기록입니다. 시스템이 자동으로 남기며 지우거나 고칠 수 없습니다."
        actions={
          <PfSeg
            value={String(hours) as "24" | "168" | "720"}
            onChange={(v) => setHours(Number(v))}
            options={[{ value: "24", label: "24시간" }, { value: "168", label: "7일" }, { value: "720", label: "30일" }]}
          />
        }
      />
      <SystemTabs />

      <div className="pf-kpi-grid">
        <PfCard i={2} className="pf-kpi-tile"><PfKpi label={`${hoursLabel} 기록`} value={items.length} unit="건" /></PfCard>
        <PfCard i={3} className="pf-kpi-tile"><PfKpi label="계정·구독 변경" value={sensitiveCount} unit="건" accent={sensitiveCount > 0} /></PfCard>
        <PfCard i={4} className="pf-kpi-tile"><PfKpi label="활동한 운영자" value={operators} unit="명" /></PfCard>
        <PfCard i={5} className="pf-kpi-tile"><PfKpi label="행동 종류" value={byAction.length} unit="가지" /></PfCard>
      </div>

      {byAction.length > 0 && (
        <PfCard i={6}>
          <PfCardHead title="무슨 행동이 많았나" sub="막대를 보고 아래 칩으로 골라 보세요" />
          <PfCardBody>
            <PfBars data={byAction.slice(0, 8)} series={[{ key: "n", label: "건수" }]} xKey="name" height={170} revealKey={`${hours}-${items.length}`} />
            <div className="flex flex-wrap gap-1.5 mt-3">
              <button type="button" onClick={() => setActionFilter("all")} className={`pf-chip ${actionFilter === "all" ? "pf-chip-on" : ""}`}>전체 {items.length}</button>
              {byAction.map((b) => (
                <button key={b.action} type="button" onClick={() => setActionFilter(b.action === actionFilter ? "all" : b.action)} className={`pf-chip ${actionFilter === b.action ? "pf-chip-on" : ""}`}>{b.name} {b.n}</button>
              ))}
            </div>
          </PfCardBody>
        </PfCard>
      )}

      {isLoading && <PfCard i={7}><PfCardBody className="pt-5"><PfSkeleton rows={5} h={14} /></PfCardBody></PfCard>}

      {!isLoading && items.length === 0 && (
        <PfCard i={7}>
          <PfEmpty>
            이 기간에 운영자 기록이 없습니다.
            <div className="mt-2 text-[11px]">회사 상세로 들어가거나 업종을 분류하거나 오류를 해결하면 자동으로 쌓입니다.</div>
          </PfEmpty>
        </PfCard>
      )}

      {!isLoading && items.length > 0 && (
        <PfCard i={7} hover={false}>
          <PfCardHead title="기록" sub={`${shown.length}건 · 최신순`} />
          <div className="pf-table-wrap">
            <table className="pf-table">
              <thead>
                <tr>
                  <th>언제</th>
                  <th>누가</th>
                  <th>무엇을</th>
                  <th>대상</th>
                  <th>상세</th>
                </tr>
              </thead>
              <tbody>
                {shown.map((a) => (
                  <tr key={a.id}>
                    <td className="whitespace-nowrap">
                      <div className="text-[12px] text-[var(--text)]">{fmtRelative(a.created_at)}</div>
                      <div className="text-[10px] text-[var(--text-dim)] mono-number">{new Date(a.created_at).toLocaleString("ko-KR")}</div>
                    </td>
                    <td className="text-[var(--text-muted)] max-w-[200px] truncate">{a.actor_email || a.actor_user_id?.slice(0, 8) || "—"}</td>
                    <td><PfBadge tone={SENSITIVE.has(a.action) ? "warn" : "info"}>{ACTION_LABEL[a.action] || a.action}</PfBadge></td>
                    <td className="text-[var(--text-muted)]">
                      {a.target_type && <span className="text-[var(--text-dim)]">{TARGET_LABEL[a.target_type] || a.target_type}: </span>}{a.target_id || "—"}
                    </td>
                    <td className="text-[10px] text-[var(--text-dim)] font-mono max-w-xs truncate">{a.context ? JSON.stringify(a.context) : "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </PfCard>
      )}
    </PfPage>
  );
}
