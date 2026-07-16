"use client";

// 대표 경영 탭 — CEO 커맨드 센터 (2026-06-12 전면 재설계).
//   "대표가 아침에 열어서 3분 안에: 처리할 것 처리하고, 회사 상태 확인하고, 닫는다" 컨셉.
//   ① 오늘의 결재 액션 센터 — 7종 결재 통합(approval-center) + 즉시 승인 + 비결재 액션 칩
//   ② 현금 펄스 / 이번 달 목표 / 리스크 3열
//   전부 기존 lib·데이터 재사용(가짜 metric 0). 디자인: 흰 라운드 카드(TeamHub 라운드) + 토큰 표면.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCEOPendingActions, approveAction, rejectAction, canRejectAction, type PendingAction } from "@/lib/approval-center";
import { useToast } from "@/components/toast";

const db = supabase as any;
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
  cashPulse: { currentBalance: number; forecast30d: number; forecast90d: number; pulseScore: number } | null | undefined;
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

  const score = cashPulse?.pulseScore ?? 0;
  const scoreColor = score >= 60 ? "var(--success)" : score >= 40 ? "var(--warning)" : "var(--danger)";
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

  return (
    <div className="owner-command-center">
      {/* ═══ ① 오늘의 액션 센터 ═══ */}
      <div className="today-action-center glass-card">
        {/* 흰 카드 헤더 (TeamHub 라운드) */}
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
              <span className="text-2xl">🎉</span>
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
                    <span className="w-9 h-9 rounded-xl flex items-center justify-center text-base shrink-0 bg-[var(--bg-surface)]">{meta.icon}</span>
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
                // 2026-07-15: 남은 항목은 결제/경비/휴가/문서/서명/비용/결재 7종이 섞여 있어
                // 단일 링크(예 /approvals)로 보내면 실제로 없는 화면으로 안내하는 문제가 있었음.
                // 유형별 상세 버튼을 이용하도록 안내만 하고 잘못된 단일 링크는 제거.
                <div className="px-5 py-2.5 text-center text-[11px] text-[var(--text-dim)]">
                  외 {actions.length - topActions.length}건 더 있음 — 각 항목의 "상세"로 이동해 처리하세요
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {/* ═══ ② 현금 펄스 / 이번 달 목표 / 리스크 ═══ */}
      <div className="command-center-summary-grid">
        {/* 현금 펄스 */}
        <div className="cash-pulse-card glass-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-bold text-[var(--text)]">현금 펄스</h3>
            <Link href="/reports/flow" className="text-[10px] font-semibold text-[var(--primary)]">경영 흐름 →</Link>
          </div>
          <div className="flex items-center gap-4">
            {/* 스코어 링 */}
            <div className="cash-pulse-score-ring" style={{ width: 84, height: 84 }}>
              <svg viewBox="0 0 36 36" className="w-full h-full -rotate-90">
                <circle cx="18" cy="18" r="15.9155" fill="none" stroke="var(--bg-surface)" strokeWidth="3.2" />
                <circle cx="18" cy="18" r="15.9155" fill="none" stroke={scoreColor} strokeWidth="3.2"
                  strokeDasharray={`${Math.max(0, Math.min(100, score))} ${100 - Math.max(0, Math.min(100, score))}`} strokeLinecap="round" />
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-xl font-black mono-number" style={{ color: scoreColor }}>{score}</span>
                <span className="text-[8px] text-[var(--text-dim)]">/ 100</span>
              </div>
            </div>
            <div className="min-w-0 flex-1 space-y-1.5">
              {[
                { l: "통장 잔고", v: won(balance), c: balance <= 0 ? "var(--danger)" : "var(--text)" },
                { l: "D+30 전망", v: won(f30), c: f30 < 0 ? "var(--danger)" : "var(--text-muted)" },
                { l: "D+90 전망", v: won(f90), c: f90 < 0 ? "var(--danger)" : "var(--text-muted)" },
                { l: "런웨이", v: runway > 0 ? `${runway.toFixed(1)}개월` : "—", c: runway > 0 && runway < 3 ? "var(--danger)" : "var(--text-muted)" },
              ].map((r) => (
                <div key={r.l} className="flex items-center justify-between text-[11px]">
                  <span className="text-[var(--text-dim)]">{r.l}</span>
                  <span className="font-bold mono-number" style={{ color: r.c }}>{r.v}</span>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* 이번 달 목표 */}
        <div className="revenue-target-card glass-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-bold text-[var(--text)]">매출 목표</h3>
            <Link href="/reports/pnl" className="text-[10px] font-semibold text-[var(--primary)]">손익 →</Link>
          </div>
          {[
            { l: "이번 달", cur: growth.monthRevenue, tgt: growth.monthTarget, pct: monthPct },
            { l: "분기", cur: growth.quarterRevenue, tgt: growth.quarterTarget, pct: quarterPct },
            { l: "연간", cur: growth.yearRevenue, tgt: growth.yearTarget, pct: yearPct },
          ].map((g) => (
            <div key={g.l} className="mb-3 last:mb-0">
              <div className="flex items-center justify-between text-[11px] mb-1">
                <span className="text-[var(--text-dim)]">{g.l}</span>
                <span className="font-bold mono-number text-[var(--text)]">
                  ₩{fmtW(g.cur)}
                  {g.tgt > 0 && <span className="text-[var(--text-dim)] font-semibold"> / {fmtW(g.tgt)}</span>}
                  {g.pct !== null && <span className="ml-1.5" style={{ color: g.pct >= 100 ? "var(--success)" : "var(--primary)" }}>{g.pct}%</span>}
                </span>
              </div>
              <div className="h-2 rounded-full bg-[var(--bg-surface)] overflow-hidden">
                <div className="h-full rounded-full transition-all"
                  style={{ width: `${Math.min(100, g.pct ?? 0)}%`, background: (g.pct ?? 0) >= 100 ? "var(--success)" : "var(--primary)" }} />
              </div>
              {g.tgt === 0 && <div className="text-[9px] text-[var(--text-dim)] mt-0.5">목표 미설정 — 설정에서 등록</div>}
            </div>
          ))}
        </div>

        {/* 리스크 */}
        <div className="risk-summary-card glass-card">
          <div className="flex items-center justify-between mb-3">
            <h3 className="text-[13px] font-bold text-[var(--text)]">리스크</h3>
            <Link href="/projects" className="text-[10px] font-semibold text-[var(--primary)]">프로젝트 →</Link>
          </div>
          {riskTotal === 0 ? (
            <div className="risk-summary-empty">
              <div className="text-2xl mb-1.5">🛡️</div>
              <div className="text-[12px] font-semibold text-emerald-500">감지된 리스크 없음</div>
              <div className="text-[10px] text-[var(--text-dim)] mt-0.5">마진·마감·미수금·외주비 자동 감시 중</div>
            </div>
          ) : (
            <div className="space-y-2">
              {risks.slice(0, 3).map((r, i) => (
                <div key={i} className="px-3 py-2 rounded-lg bg-red-500/[.06] border border-red-500/15">
                  <div className="text-[11px] font-bold text-[var(--text)] truncate">{r.name}</div>
                  <div className="text-[10px] text-red-500/90 truncate">{r.detail}</div>
                </div>
              ))}
              {risks.length > 3 && <div className="text-[10px] text-[var(--text-dim)] text-center">외 {risks.length - 3}건</div>}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
