"use client";

// 대표 경영 탭 — CEO 커맨드 센터 (2026-06-12 전면 재설계).
//   "대표가 아침에 열어서 3분 안에: 처리할 것 처리하고, 회사 상태 확인하고, 닫는다" 컨셉.
//   ① 오늘의 결재 액션 센터 — 7종 결재 통합(approval-center) + 즉시 승인 + 비결재 액션 칩
//   ② 현금 펄스 / 이번 달 목표 / 리스크 3열
//   전부 기존 lib·데이터 재사용(가짜 metric 0). 디자인: 흰 라운드 카드(TeamHub 라운드) + 토큰 표면.

import { useMemo, useState } from "react";
import { Ico } from "@/components/ui-icon";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCEOPendingActions, approveAction, rejectAction, canRejectAction, type PendingAction } from "@/lib/approval-center";
import { useToast } from "@/components/toast";

const db = supabase;
const won = (n: number) => `₩${Math.round(Number(n || 0)).toLocaleString()}`;
const fmtW = (n: number) => {
  const abs = Math.abs(n);
  if (abs >= 100_000_000) return `${(n / 100_000_000).toFixed(1)}억`;
  if (abs >= 10_000) return `${Math.round(n / 10_000).toLocaleString()}만`;
  return Math.round(n).toLocaleString();
};

const ACTION_META: Record<string, { icon: string; label: string; href: string }> = {
  // 2026-07-15 버그수정: expense/leave 는 approval_requests 가 아니라 별도 테이블
  // (expense_requests/leave_requests) — /approvals(내결재함) 로 보내면 항목이 안 보임.
  // 실제로 그 항목을 처리할 수 있는 화면으로 정정.
  payment: { icon: "💸", label: "결제", href: "/payments" },
  expense: { icon: "🧾", label: "경비", href: "/payments" },
  document: { icon: "📄", label: "문서", href: "/documents" },
  leave: { icon: "🏖", label: "휴가", href: "/approvals" },
  signature: { icon: "✍️", label: "서명", href: "/signatures" },
  cost: { icon: "📦", label: "프로젝트 비용", href: "/projects" },
  approval: { icon: "✅", label: "결재", href: "/approvals" },
};

export function OwnerCommandCenter({ companyId, userId, sixPack, growth, risks, riskCounts, cashPulse }: {
  companyId: string;
  userId: string | null;
  sixPack: { cashBalance: number; netCashflow: number; runwayMonths: number; arTotal: number; arOver30: number; pendingApprovals: number; monthlyBurn: number };
  growth: { monthRevenue: number; quarterRevenue: number; yearRevenue: number; monthTarget: number; quarterTarget: number; yearTarget: number };
  risks: { label: string; name: string; detail: string }[];
  riskCounts: Record<string, number>;
  cashPulse: { currentBalance: number; forecast30d: number; forecast90d: number; pulseScore: number; hasData?: boolean } | null | undefined;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [processed, setProcessed] = useState(0); // 이번 세션에서 처리(승인/반려)한 건수 — 진행 체감용

  // ① 결재 액션 (7종 통합 — approval-center 재사용)
  const { data: actions = [] } = useQuery<PendingAction[]>({
    queryKey: ["ceo-pending-actions", companyId],
    queryFn: () => getCEOPendingActions(companyId, userId || undefined),
    enabled: !!companyId,
    staleTime: 30_000,
  });

  // 비결재 액션: 매칭 확인큐 대기 건수
  const { data: queueCount = 0 } = useQuery<number>({
    queryKey: ["ceo-queue-count", companyId],
    queryFn: async () => {
      const { count } = await db.from("v_settlement_review_queue")
        .select("id", { count: "exact", head: true }).eq("company_id", companyId);
      return count || 0;
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });

  const approveMut = useMutation({
    mutationFn: async (a: PendingAction) => {
      if (!userId) throw new Error("로그인이 필요합니다");
      setBusyId(a.id);
      await approveAction(companyId, a.type as any, a.id, userId);
    },
    onSuccess: () => { setProcessed((n) => n + 1); toast("승인 완료", "success"); qc.invalidateQueries({ queryKey: ["ceo-pending-actions", companyId] }); },
    onError: (e: any) => toast(e?.message || "승인 실패", "error"),
    onSettled: () => setBusyId(null),
  });

  const rejectMut = useMutation({
    mutationFn: async ({ a, reason }: { a: PendingAction; reason: string }) => {
      if (!userId) throw new Error("로그인이 필요합니다");
      setBusyId(a.id);
      await rejectAction(companyId, a.type as any, a.id, userId, reason);
    },
    onSuccess: () => { setProcessed((n) => n + 1); toast("반려 완료", "success"); qc.invalidateQueries({ queryKey: ["ceo-pending-actions", companyId] }); },
    onError: (e: any) => toast(e?.message || "반려 실패", "error"),
    onSettled: () => setBusyId(null),
  });

  const handleReject = (a: PendingAction) => {
    const reason = window.prompt("반려 사유를 입력하세요 (취소하면 반려하지 않습니다)", "");
    if (reason === null) return; // 취소
    rejectMut.mutate({ a, reason: reason.trim() });
  };

  // 데이터가 하나도 없는 신규 가입사는 점수가 기본 조합(50)으로 나와 오도 → "—" 처리 (2026-07-28 사장님)
  const pulseReady = !!cashPulse && cashPulse.hasData !== false;
  const score = cashPulse?.pulseScore ?? 0;
  const scoreColor = !pulseReady ? "var(--text-dim)" : score >= 60 ? "var(--success)" : score >= 40 ? "var(--warning)" : "var(--danger)";
  const balance = cashPulse?.currentBalance ?? sixPack.cashBalance;
  const f30 = cashPulse?.forecast30d ?? 0;
  const f90 = cashPulse?.forecast90d ?? 0;
  const runway = sixPack.runwayMonths;

  const monthPct = growth.monthTarget > 0 ? Math.min(999, Math.round((growth.monthRevenue / growth.monthTarget) * 100)) : null;
  const quarterPct = growth.quarterTarget > 0 ? Math.min(999, Math.round((growth.quarterRevenue / growth.quarterTarget) * 100)) : null;
  const yearPct = growth.yearTarget > 0 ? Math.min(999, Math.round((growth.yearRevenue / growth.yearTarget) * 100)) : null;

  const riskTotal = useMemo(() => Object.values(riskCounts).reduce((s, n) => s + n, 0), [riskCounts]);
  const topActions = actions.slice(0, 10);
  const totalTodo = actions.length + queueCount + (sixPack.arOver30 > 0 ? 1 : 0);

  // 도넛 카드용 상태 라벨·인사이트 한 줄 (2026-08-11 시각화 개편 — 규칙 기반, 신규 쿼리 0)
  const pulseLabel = !pulseReady ? "데이터 없음" : score >= 60 ? "안정" : score >= 40 ? "주의" : "위험";
  const pulseInsight = !pulseReady
    ? "거래내역을 연결하면 현금 흐름 점수가 계산됩니다."
    : f30 < 0
      ? "30일 안에 잔고가 마이너스로 내려갈 수 있어요 — 수금과 지출 조정을 서두르세요."
      : runway > 0 && runway < 3
        ? `현재 고정비 기준 런웨이 ${runway.toFixed(1)}개월 — 자금 여력 관리가 필요합니다.`
        : runway >= 6
          ? `현금 흐름이 안정적입니다 — 현재 고정비 기준 ${runway >= 99 ? "충분히" : `${Math.floor(runway)}개월 이상`} 버틸 수 있어요.`
          : `현재 고정비 기준 약 ${runway.toFixed(1)}개월분 자금이 확보돼 있습니다.`;
  const RING_R = 52;
  const RING_C = 2 * Math.PI * RING_R;
  const ringOff = RING_C * (1 - (pulseReady ? Math.max(0, Math.min(100, score)) : 0) / 100);

  // 목표 인라인 설정 (2026-08-11 유지 — 경영 상태 카드 안으로 이동)
  const [editTargets, setEditTargets] = useState(false);
  const [targetVals, setTargetVals] = useState({ month: "", quarter: "", year: "" });
  const now = new Date();
  const TARGET_PERIODS = {
    month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`,
    quarter: `${now.getFullYear()}-Q${Math.ceil((now.getMonth() + 1) / 3)}`,
    year: String(now.getFullYear()),
  };
  const startTargetEdit = () => {
    setTargetVals({
      month: growth.monthTarget > 0 ? String(growth.monthTarget) : "",
      quarter: growth.quarterTarget > 0 ? String(growth.quarterTarget) : "",
      year: growth.yearTarget > 0 ? String(growth.yearTarget) : "",
    });
    setEditTargets(true);
  };
  const saveTargetsMut = useMutation({
    mutationFn: async () => {
      const rows = ([["month", targetVals.month], ["quarter", targetVals.quarter], ["year", targetVals.year]] as const)
        .map(([k, v]) => ({ period: TARGET_PERIODS[k], target_revenue: Number(String(v).replace(/[^0-9]/g, "")) || 0 }));
      for (const r of rows) {
        const { error } = await db.from("growth_targets").upsert(
          { company_id: companyId, period: r.period, target_revenue: r.target_revenue },
          { onConflict: "company_id,period" });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      toast("매출 목표가 저장되었습니다", "success");
      setEditTargets(false);
      qc.invalidateQueries({ queryKey: ["founder-data"] });
    },
    onError: (e: any) => toast(e?.message || "목표 저장 실패", "error"),
  });
  const fmtTargetInput = (v: string) => { const d = v.replace(/[^0-9]/g, ""); return d ? Number(d).toLocaleString() : ""; };

  return (
    <div className="owner-command-center">
      {/* ═══ ① 경영 상태 — 작은 도넛 + 숫자 스트립 + 인사이트 (2026-08-11 심플 개편) ═══ */}
      <div className="master-state-card glass-card">
        <div className="master-card-head">
          <h3 className="master-card-title">경영 상태</h3>
          <div className="flex items-center gap-3">
            <button type="button" onClick={() => (editTargets ? setEditTargets(false) : startTargetEdit())} className="widget-more-link">
              {editTargets ? "닫기" : "목표 설정"}
            </button>
            <Link href="/reports/flow" className="widget-more-link">경영 흐름 →</Link>
          </div>
        </div>
        <div className="master-state-body">
          <div className="master-state-ring">
            <svg viewBox="0 0 120 120" className="w-full h-full">
              <circle cx="60" cy="60" r={RING_R} className="master-ring-track" />
              <circle cx="60" cy="60" r={RING_R} fill="none" stroke={scoreColor} strokeWidth="9" strokeLinecap="round"
                strokeDasharray={RING_C} strokeDashoffset={ringOff} transform="rotate(-90 60 60)" className="master-ring-fill" />
            </svg>
            <div className="master-pulse-ring-center">
              <span className="master-state-score mono-number" style={{ color: scoreColor }}>{pulseReady ? score : "—"}</span>
              <span className="master-pulse-score-sub">{pulseReady ? pulseLabel : "데이터 없음"}</span>
            </div>
          </div>
          <div className="master-state-stats">
            <div className="widget-stat">
              <div className="widget-stat-label">통장 잔고</div>
              <div className="widget-stat-value mono-number" style={balance <= 0 ? { color: "var(--danger)" } : undefined}>{fmtW(balance) === "0" ? "0원" : `₩${fmtW(balance)}`}</div>
            </div>
            <div className="widget-stat">
              <div className="widget-stat-label">30일 뒤 전망</div>
              <div className="widget-stat-value mono-number" style={f30 < 0 ? { color: "var(--danger)" } : undefined}>₩{fmtW(f30)}</div>
            </div>
            <div className="widget-stat">
              <div className="widget-stat-label">버틸 수 있는 기간</div>
              <div className="widget-stat-value mono-number" style={{ color: runway > 0 && runway < 3 ? "var(--danger)" : runway >= 6 ? "var(--success)" : "var(--text)" }}>
                {runway > 0 ? (runway >= 99 ? "충분" : `${runway.toFixed(1)}개월`) : "—"}
              </div>
            </div>
            <div className="widget-stat">
              <div className="widget-stat-label">이번 달 매출</div>
              <div className="widget-stat-value mono-number">₩{fmtW(growth.monthRevenue)}</div>
              <div className="widget-stat-sub">
                {monthPct !== null
                  ? <span style={{ color: monthPct >= 100 ? "var(--success)" : "var(--primary)" }}>목표의 {monthPct}%</span>
                  : "목표 미설정"}
              </div>
            </div>
            <div className="widget-stat">
              <div className="widget-stat-label">밀린 미수금</div>
              <div className="widget-stat-value mono-number" style={{ color: sixPack.arOver30 > 0 ? "var(--danger)" : "var(--success)" }}>
                {sixPack.arOver30 > 0 ? `₩${fmtW(sixPack.arOver30)}` : "없음"}
              </div>
              <div className="widget-stat-sub">30일 이상</div>
            </div>
          </div>
        </div>
        {editTargets && (
          <div className="master-target-editor">
            {([["month", "이번 달"], ["quarter", "분기"], ["year", "연간"]] as const).map(([k, l]) => (
              <div key={k} className="min-w-0">
                <div className="widget-stat-label mb-1">{l} 목표</div>
                <div className="master-target-input-wrap">
                  <span className="text-[12px] text-[var(--text-dim)]">₩</span>
                  <input
                    inputMode="numeric"
                    value={fmtTargetInput(targetVals[k])}
                    onChange={(e) => setTargetVals((v) => ({ ...v, [k]: e.target.value.replace(/[^0-9]/g, "") }))}
                    placeholder="예: 50,000,000"
                    className="master-target-input mono-number"
                  />
                </div>
              </div>
            ))}
            <div className="flex items-end gap-2">
              <button type="button" onClick={() => saveTargetsMut.mutate()} disabled={saveTargetsMut.isPending} className="btn-primary btn-sm">
                {saveTargetsMut.isPending ? "저장 중..." : "저장"}
              </button>
              <button type="button" onClick={() => setEditTargets(false)} disabled={saveTargetsMut.isPending} className="btn-secondary btn-sm">취소</button>
            </div>
          </div>
        )}
        <div className="master-insight-strip">{pulseInsight}</div>
      </div>

      {/* ═══ ② 오늘 처리할 일 — 심플 리스트: 제목·금액·승인 하나, 반려·상세는 호버 ═══ */}
      <div className="master-todo-card glass-card">
        <div className="master-card-head">
          <h3 className="master-card-title">
            오늘 처리할 일
            {totalTodo > 0 && <span className="master-count mono-number">{totalTodo}</span>}
            {processed > 0 && <span className="master-done-note">✓ {processed}건 처리</span>}
          </h3>
          <div className="flex items-center gap-3 flex-wrap">
            {queueCount > 0 && <Link href="/collect?tab=bank" className="widget-more-link">매칭 확인 {queueCount}건</Link>}
            {sixPack.arOver30 > 0 && <Link href="/partners/ledger" className="widget-more-link" style={{ color: "var(--danger)" }}>미수금 30일+ →</Link>}
            <Link href="/approvals" className="widget-more-link">결재함 →</Link>
          </div>
        </div>
        {topActions.length === 0 ? (
          <div className="master-todo-empty">오늘은 처리할 일이 없습니다.</div>
        ) : (
          <div className="master-todo-list">
            {topActions.map((a) => {
              const meta = ACTION_META[a.type] || ACTION_META.approval;
              return (
                <div key={`${a.type}-${a.id}`} className="master-todo-row group">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 min-w-0">
                      <span className="text-[13px] font-semibold text-[var(--text)] truncate">{a.title}</span>
                      {a.urgency === "high" && <span className="master-urgent-pill">긴급</span>}
                    </div>
                    <div className="text-[11px] text-[var(--text-dim)] truncate mt-0.5">
                      {meta.label}{a.requester ? ` · ${a.requester}` : ""}{a.dealName ? ` · ${a.dealName}` : ""}
                    </div>
                  </div>
                  {a.amount !== undefined && a.amount > 0 && (
                    <span className="shrink-0 text-[13px] font-bold mono-number text-[var(--text)]">{won(a.amount)}</span>
                  )}
                  <div className="master-todo-actions">
                    {canRejectAction(a.type) && (
                      <button onClick={() => handleReject(a)} disabled={busyId === a.id} className="master-todo-ghost-btn">
                        반려
                      </button>
                    )}
                    <Link href={meta.href} className="master-todo-ghost-btn">상세</Link>
                    <button onClick={() => approveMut.mutate(a)} disabled={busyId === a.id} className="btn-primary btn-sm">
                      {busyId === a.id ? "..." : "승인"}
                    </button>
                  </div>
                </div>
              );
            })}
            {actions.length > topActions.length && (
              <div className="py-2.5 text-center text-[11px] text-[var(--text-dim)]">
                외 {actions.length - topActions.length}건 — 각 항목의 "상세"에서 처리하세요
              </div>
            )}
          </div>
        )}
      </div>

      {/* ═══ ③ 리스크 — 감지된 것이 있을 때만 (없으면 화면에서 생략) ═══ */}
      {riskTotal > 0 && (
        <div className="master-risk-card glass-card">
          <div className="master-card-head">
            <h3 className="master-card-title">리스크 <span className="master-count master-count-danger mono-number">{riskTotal}</span></h3>
            <Link href="/projects" className="widget-more-link">프로젝트 →</Link>
          </div>
          <div className="space-y-2">
            {risks.slice(0, 4).map((r, i) => (
              <div key={i} className="master-risk-row">
                <div className="text-[12px] font-semibold text-[var(--text)] truncate">{r.name}</div>
                <div className="text-[11px] text-[var(--danger)] truncate">{r.detail}</div>
              </div>
            ))}
            {risks.length > 4 && <div className="text-[10px] text-[var(--text-dim)] text-center">외 {risks.length - 4}건</div>}
          </div>
        </div>
      )}
    </div>
  );
}
