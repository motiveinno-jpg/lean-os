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

export function OwnerCommandCenter({ companyId, userId, sixPack, growth, risks, riskCounts, cashPulse, closingSlot }: {
  companyId: string;
  userId: string | null;
  sixPack: { cashBalance: number; netCashflow: number; runwayMonths: number; arTotal: number; arOver30: number; pendingApprovals: number; monthlyBurn: number };
  growth: { monthRevenue: number; quarterRevenue: number; yearRevenue: number; monthTarget: number; quarterTarget: number; yearTarget: number };
  risks: { label: string; name: string; detail: string }[];
  riskCounts: Record<string, number>;
  cashPulse: { currentBalance: number; forecast30d: number; forecast90d: number; pulseScore: number; hasData?: boolean } | null | undefined;
  /** 1행 3번째 칸(월 마감 링 카드) — 마스터 페이지가 ClosingChecklistWidget 을 꽂는다 (2026-08-11 시각화 개편) */
  closingSlot?: React.ReactNode;
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

  return (
    <div className="owner-command-center">
      {/* ═══ 1행 — 비주얼 3카드: 현금 펄스(도넛) · 매출 목표(게이지) · 월 마감(링, 슬롯) ═══ */}
      <div className="master-hero-grid">
        {/* 현금 펄스 — 대형 도넛 + 핵심 지표 + 인사이트 스트립 */}
        <div className="master-pulse-card glass-card">
          <div className="master-card-head">
            <h3 className="master-card-title">현금 펄스</h3>
            <Link href="/reports/flow" className="widget-more-link">경영 흐름 →</Link>
          </div>
          <div className="master-pulse-body">
            <div className="master-pulse-ring">
              <svg viewBox="0 0 120 120" className="w-full h-full">
                <circle cx="60" cy="60" r={RING_R} className="master-ring-track" />
                <circle cx="60" cy="60" r={RING_R} fill="none" stroke={scoreColor} strokeWidth="9" strokeLinecap="round"
                  strokeDasharray={RING_C} strokeDashoffset={ringOff} transform="rotate(-90 60 60)" className="master-ring-fill" />
              </svg>
              <div className="master-pulse-ring-center">
                <span className="master-pulse-score mono-number" style={{ color: scoreColor }}>{pulseReady ? score : "—"}</span>
                <span className="master-pulse-score-sub">/100</span>
                <span className="master-pulse-state" style={{ color: scoreColor, background: `color-mix(in srgb, ${scoreColor} 12%, transparent)` }}>{pulseLabel}</span>
              </div>
            </div>
            <div className="master-pulse-rows">
              {[
                { l: "통장 잔고", v: won(balance), c: balance <= 0 ? "var(--danger)" : "var(--text)" },
                { l: "D+30 전망", v: won(f30), c: f30 < 0 ? "var(--danger)" : "var(--text-muted)" },
                { l: "D+90 전망", v: won(f90), c: f90 < 0 ? "var(--danger)" : "var(--text-muted)" },
                { l: "런웨이", v: runway > 0 ? `${runway.toFixed(1)}개월` : "—", c: runway > 0 && runway < 3 ? "var(--danger)" : "var(--text-muted)" },
              ].map((r) => (
                <div key={r.l} className="master-pulse-row">
                  <span className="text-[var(--text-dim)]">{r.l}</span>
                  <span className="font-bold mono-number" style={{ color: r.c }}>{r.v}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="master-insight-strip">{pulseInsight}</div>
        </div>

        {/* 매출 목표 — 게이지 바 + 달성률 점수 */}
        <div className="master-target-card glass-card">
          <div className="master-card-head">
            <h3 className="master-card-title">매출 목표</h3>
            <Link href="/reports/pnl" className="widget-more-link">손익 →</Link>
          </div>
          <div className="master-target-rows">
            {[
              { l: "이번 달", cur: growth.monthRevenue, tgt: growth.monthTarget, pct: monthPct },
              { l: "분기", cur: growth.quarterRevenue, tgt: growth.quarterTarget, pct: quarterPct },
              { l: "연간", cur: growth.yearRevenue, tgt: growth.yearTarget, pct: yearPct },
            ].map((g) => (
              <div key={g.l} className="master-target-row">
                <div className="flex items-center justify-between text-[11px] mb-1.5">
                  <span className="text-[var(--text-dim)]">{g.l}</span>
                  <span className="font-bold mono-number text-[var(--text)]">
                    ₩{fmtW(g.cur)}
                    {g.tgt > 0 && <span className="text-[var(--text-dim)] font-semibold"> / {fmtW(g.tgt)}</span>}
                  </span>
                </div>
                <div className="flex items-center gap-2.5">
                  <div className="flex-1 h-2 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                    <div className="h-full rounded-full transition-all"
                      style={{ width: `${Math.min(100, g.pct ?? 0)}%`, background: (g.pct ?? 0) >= 100 ? "var(--success)" : "var(--primary)" }} />
                  </div>
                  <span className="master-target-score mono-number" style={{ color: g.pct == null ? "var(--text-dim)" : g.pct >= 100 ? "var(--success)" : "var(--primary)" }}>
                    {g.pct !== null ? `${g.pct}%` : "—"}
                  </span>
                </div>
                {g.tgt === 0 && <div className="text-[10px] text-[var(--text-dim)] mt-1">목표 미설정 — 설정에서 등록하세요</div>}
              </div>
            ))}
          </div>
          <div className="master-insight-strip">
            {monthPct !== null
              ? monthPct >= 100
                ? `이번 달 목표를 이미 ${monthPct}% 달성했습니다 — 훌륭해요.`
                : `이번 달 목표까지 ${Math.max(0, 100 - monthPct)}% 남았습니다.`
              : "월 목표를 설정하면 달성률을 추적해 드립니다."}
          </div>
        </div>

        {/* 월 마감 — 완료 링 카드 (마스터 페이지가 꽂는 슬롯) */}
        {closingSlot}
      </div>

      {/* ═══ 2행 — 오늘 처리할 일(넓게) + 리스크 ═══ */}
      <div className="master-mid-grid">
      <div className="today-action-center glass-card">
        <div className="today-action-center-header">
          <div>
            <div className="text-[15px] font-bold text-[var(--text)]">오늘 처리할 일</div>
            <div className="text-[11px] text-[var(--text-dim)] mt-0.5">결재 · 입금 확인 · 미수금 — 여기서 바로 끝내세요</div>
          </div>
          <span className="text-2xl font-black mono-number ml-1" style={{ color: totalTodo > 0 ? "var(--warning)" : "var(--success)" }}>{totalTodo}</span>
          {processed > 0 && (
            <span className="text-[11px] font-bold px-2 py-0.5 rounded-full bg-[var(--success)]/12 text-[var(--success)]">✓ {processed}건 처리됨</span>
          )}
          <div className="ml-auto flex items-center gap-1.5 flex-wrap">
            {queueCount > 0 && (
              <Link href="/partners/reconciliation" className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition bg-[var(--primary)]/10 text-[var(--primary)] hover:bg-[var(--primary)]/20">
                매칭 확인 {queueCount}건 →
              </Link>
            )}
            {sixPack.arOver30 > 0 && (
              <Link href="/partners/ledger" className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition bg-[var(--danger)]/10 text-[var(--danger)] hover:bg-[var(--danger)]/20">
                미수금 30일+ {fmtW(sixPack.arOver30)} →
              </Link>
            )}
            {riskTotal > 0 && (
              <Link href="/projects" className="px-3 py-1.5 rounded-lg text-[11px] font-bold transition bg-[var(--warning)]/10 text-[var(--warning)] hover:bg-[var(--warning)]/20">
                위험 프로젝트 {riskTotal} →
              </Link>
            )}
            <Link href="/approvals" className="btn-secondary rounded-lg text-[11px] font-bold">
              결재함 열기
            </Link>
          </div>
        </div>

        {/* 결재 리스트 */}
        <div className="pending-approval-list">
          {topActions.length === 0 ? (
            <div className="pending-approval-empty">
              <span className="text-2xl"><Ico e="🎉" /></span>
              <div>
                <div className="text-sm font-bold text-[var(--text)]">대기 중인 결재가 없습니다</div>
                <div className="text-[11px] text-[var(--text-dim)]">새 결재가 올라오면 여기에 바로 표시됩니다</div>
              </div>
            </div>
          ) : (
            <>
              {topActions.map((a) => {
                const meta = ACTION_META[a.type] || ACTION_META.approval;
                return (
                  <div key={`${a.type}-${a.id}`} className="pending-approval-row">
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 bg-[var(--bg-surface)]"><Ico e={meta.icon} /></span>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-[13px] font-semibold text-[var(--text)] truncate">{a.title}</span>
                        {a.urgency === "high" && <span className="shrink-0 text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/10 text-red-500 font-bold">긴급</span>}
                      </div>
                      <div className="text-[10px] text-[var(--text-dim)] truncate">
                        {meta.label}{a.requester ? ` · ${a.requester}` : ""}{a.dealName ? ` · ${a.dealName}` : ""}
                      </div>
                    </div>
                    {a.amount !== undefined && a.amount > 0 && (
                      <span className="shrink-0 text-[13px] font-bold mono-number text-[var(--text)]">{won(a.amount)}</span>
                    )}
                    <div className="shrink-0 flex items-center gap-1.5">
                      <button
                        onClick={() => approveMut.mutate(a)}
                        disabled={busyId === a.id}
                        className="px-3 py-1.5 rounded-lg text-[11px] font-bold text-white bg-emerald-500 hover:opacity-90 transition disabled:opacity-50">
                        {busyId === a.id ? "..." : "승인"}
                      </button>
                      {canRejectAction(a.type) && (
                        <button
                          onClick={() => handleReject(a)}
                          disabled={busyId === a.id}
                          className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-[var(--danger)]/30 text-[var(--danger)] hover:bg-[var(--danger)]/10 transition disabled:opacity-50">
                          반려
                        </button>
                      )}
                      <Link href={meta.href} className="px-2.5 py-1.5 rounded-lg text-[11px] font-semibold border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition">
                        상세
                      </Link>
                    </div>
                  </div>
                );
              })}
              {actions.length > topActions.length && (
                <div className="px-5 py-2.5 text-center text-[11px] text-[var(--text-dim)]">
                  외 {actions.length - topActions.length}건 더 있음 — 각 항목의 "상세"로 이동해 처리하세요
                </div>
              )}
            </>
          )}
        </div>
      </div>

        {/* 리스크 */}
        <div className="risk-summary-card glass-card">
          <div className="master-card-head">
            <h3 className="master-card-title">리스크</h3>
            <Link href="/projects" className="widget-more-link">프로젝트 →</Link>
          </div>
          {riskTotal === 0 ? (
            <div className="risk-summary-empty">
              <div className="text-2xl mb-1.5">🛡️</div>
              <div className="text-[12px] font-semibold text-emerald-500">감지된 리스크 없음</div>
              <div className="text-[10px] text-[var(--text-dim)] mt-0.5">마진·마감·미수금·외주비 자동 감시 중</div>
            </div>
          ) : (
            <div className="space-y-2">
              {risks.slice(0, 5).map((r, i) => (
                <div key={i} className="px-3 py-2 rounded-lg bg-red-500/[.06] border border-red-500/15">
                  <div className="text-[11px] font-bold text-[var(--text)] truncate">{r.name}</div>
                  <div className="text-[10px] text-red-500/90 truncate">{r.detail}</div>
                </div>
              ))}
              {risks.length > 5 && <div className="text-[10px] text-[var(--text-dim)] text-center">외 {risks.length - 5}건</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
