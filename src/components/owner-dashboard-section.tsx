"use client";

// 2026-05-21 대표 대시보드 재설계 — 프로젝트 중심 종합 뷰 (사장님 요청 자율 설계).
//
// 단일 RPC get_owner_dashboard_summary 1회 호출로 6 섹션 데이터 fetch:
//   1) 이번 분기 KPI (5개)
//   2) 단계 분포 (5단계 카드)
//   3) TOP 거래처·담당자 (좌우)
//   4) 분기별 완료 추이 (최근 4분기 막대 차트)
//   5) 진행 중 프로젝트 리스트
//   6) 완료 보고서 보관함 (분기별 폴더)
//
// 게이트: dashboard/page.tsx 가 role === 'owner' || 'admin' 일 때만 마운트.
//   RPC 자체도 is_company_admin() 가드 — 이중 안전.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useDocumentViewer } from "@/contexts/document-viewer-context";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { STAGE_LABEL, STAGE_COLOR, type ProjectStage } from "@/lib/project-rules";

const db = supabase as any;

type StageDist = { stage: string; count: number; contract_sum: number };
type TopPartner = { id: string; name: string; representative: string | null; deal_count: number; revenue_q: number };
type TopManager = { id: string; name: string; email: string; deal_count: number; revenue_q: number };
type QTrend = { label: string; q_start: string; q_end: string; done_count: number; revenue: number; profit: number };
type InProgress = {
  id: string; name: string; stage: ProjectStage; contract_total: number;
  next_action_text: string | null; priority: string | null;
  start_date: string | null; end_date: string | null;
  partner: { id: string; name: string } | null;
  manager: { id: string; name: string } | null;
  cost_total: number; expected_margin: number;
  progress_pct_override: number | null;
};
type DoneReport = {
  id: string; name: string; partner_name: string | null;
  done_at: string | null; quarter_label: string;
  revenue: number; profit: number;
  settlement_url: string | null; settlement_id: string | null;
  completion_url: string | null; completion_id: string | null;
};
type Summary = {
  quarter: { label: string; from: string; to: string; prev_label: string };
  kpi: {
    active_count: number; done_count_q: number;
    revenue_q: number; profit_q: number; profit_pct_q: number;
    done_count_pq: number; revenue_pq: number; profit_pq: number;
  };
  stage_distribution: StageDist[];
  top_partners: TopPartner[];
  top_managers: TopManager[];
  quarterly_trend: QTrend[];
  in_progress: InProgress[];
  completed_reports: DoneReport[];
  generated_at: string;
};

const STAGE_PROGRESS: Record<ProjectStage, number> = {
  estimate: 20, contract: 40, in_progress: 60, completed: 80, settlement: 100,
};

function fmtW(n: number | null | undefined): string {
  const x = Number(n || 0);
  const abs = Math.abs(x);
  const sign = x < 0 ? "-" : "";
  if (abs >= 1e8) return `${sign}${(abs / 1e8).toFixed(1)}억`;
  if (abs >= 1e4) return `${sign}${Math.round(abs / 1e4).toLocaleString()}만`;
  return `${sign}₩${abs.toLocaleString()}`;
}

function deltaLabel(now: number, prev: number): { text: string; color: string } {
  if (prev === 0 && now === 0) return { text: "직전 분기 0", color: "text-[var(--text-dim)]" };
  if (prev === 0) return { text: "신규 (직전 0)", color: "text-[var(--success)]" };
  const diff = now - prev;
  const pct = Math.round((diff / Math.abs(prev)) * 100);
  if (diff > 0) return { text: `↑ ${pct}% (직전 ${fmtW(prev)})`, color: "text-[var(--success)]" };
  if (diff < 0) return { text: `↓ ${Math.abs(pct)}% (직전 ${fmtW(prev)})`, color: "text-[var(--danger)]" };
  return { text: "직전 분기 동일", color: "text-[var(--text-dim)]" };
}

export function OwnerDashboardSection() {
  const { data, isLoading, error } = useQuery<Summary | null>({
    queryKey: ["owner-dashboard"],
    queryFn: async () => {
      const { data, error } = await db.rpc("get_owner_dashboard_summary");
      if (error) throw error;
      return data as Summary | null;
    },
    staleTime: 60_000,
  });

  if (isLoading) {
    return <div className="text-sm text-[var(--text-muted)] py-6 text-center">대표 대시보드 불러오는 중…</div>;
  }
  if (error) {
    return <div className="text-sm text-red-500 py-6">대시보드 조회 실패: {(error as any)?.message}</div>;
  }
  if (!data) {
    // 직원/파트너는 RPC 가 NULL 반환 → 새 섹션 0 노출
    return null;
  }

  return (
    <div className="owner-dashboard-section">
      <KpiSection data={data} />
      <StageDistributionSection data={data.stage_distribution} />
      {/* 2026-05-22 사장님 요청 — 프로젝트 추이·진행 중 프로젝트 섹션 제거 */}
      <CompletedReportsSection data={data.completed_reports} />
    </div>
  );
}

// ─────────── 1. KPI ───────────
function KpiSection({ data }: { data: Summary }) {
  const { kpi, quarter } = data;
  const revD = deltaLabel(Number(kpi.revenue_q), Number(kpi.revenue_pq));
  const profD = deltaLabel(Number(kpi.profit_q), Number(kpi.profit_pq));
  const doneD = deltaLabel(Number(kpi.done_count_q), Number(kpi.done_count_pq));

  return (
    <div className="kpi-section">
      <div className="flex items-end justify-between mb-3 gap-2 flex-wrap">
        <div>
          <h2 className="text-lg font-extrabold text-[var(--text)]">{quarter.label} 한눈에</h2>
          <p className="text-xs text-[var(--text-dim)]">{quarter.from} ~ {quarter.to} · 직전 {quarter.prev_label} 대비</p>
        </div>
      </div>
      <div className="kpi-card-grid">
        <KpiCard label="진행 중 프로젝트" value={`${kpi.active_count}건`} sub="견적·계약·진행" />
        <KpiCard label="이번 분기 완료" value={`${kpi.done_count_q}건`} sub={doneD.text} subColor={doneD.color} />
        <KpiCard label="이번 분기 매출" value={fmtW(kpi.revenue_q)} sub={revD.text} subColor={revD.color} />
        <KpiCard label="이번 분기 이윤" value={fmtW(kpi.profit_q)} sub={profD.text} subColor={profD.color} />
        <KpiCard label="이윤율" value={`${kpi.profit_pct_q}%`} sub="이윤 ÷ 매출" />
      </div>
    </div>
  );
}

function KpiCard({ label, value, sub, subColor }: { label: string; value: string; sub: string; subColor?: string }) {
  return (
    <div className="stat-tile">
      <span className="stat-tile-label">{label}</span>
      <span className="stat-tile-value mono-number">{value}</span>
      <span className={`text-[11px] mt-0.5 ${subColor || "text-[var(--text-dim)]"}`}>{sub}</span>
    </div>
  );
}

// ─────────── 2. 단계 분포 ───────────
function StageDistributionSection({ data }: { data: StageDist[] }) {
  // 5단계 모두 채우기 (DB 에 없는 단계도 0건 표시)
  const STAGES: ProjectStage[] = ["estimate", "contract", "in_progress", "completed", "settlement"];
  const map = new Map(data.map((d) => [d.stage, d]));

  return (
    <div className="stage-distribution-section">
      <h2 className="text-lg font-extrabold text-[var(--text)] mb-3">프로젝트 현황</h2>
      <div className="stage-card-grid">
        {STAGES.map((s) => {
          const d = map.get(s);
          const c = STAGE_COLOR[s];
          return (
            <Link
              key={s}
              href={`/projects?stage=${s}`}
              className={`stage-card glass-card`}
            >
              <div className="flex items-center gap-1.5 mb-2">
                <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                <span className={`text-xs font-bold ${c.text}`}>{STAGE_LABEL[s]}</span>
              </div>
              <div className="text-2xl font-extrabold text-[var(--text)]">{d?.count ?? 0}건</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-1">{fmtW(d?.contract_sum)}</div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─────────── 3. TOP 거래처·담당자 ───────────
// TopActorsSection (🏢 누구랑 했나 TOP 5) — 2026-05-21 사장님 요청으로 통째 제거.

// ─────────── 4. 프로젝트 추이 (월/분기/년 토글) ───────────
type TrendPeriod = "month" | "quarter" | "year";
type TrendRow = { label: string; p_start: string; p_end: string; done_count: number; revenue: number; profit: number };

function ProjectTrendSection({ fallback }: { fallback: QTrend[] }) {
  const [metric, setMetric] = useState<"done_count" | "revenue" | "profit">("revenue");
  const [period, setPeriod] = useState<TrendPeriod>("quarter");
  const [open, setOpen] = useState(false);

  // period 별 RPC fetch. quarter 는 메인 RPC fallback 사용해 첫 페인트 빠름.
  const { data: rpcData } = useQuery<TrendRow[]>({
    queryKey: ["owner-project-trend", period],
    queryFn: async () => {
      const { data, error } = await db.rpc("get_owner_project_trend", { p_period: period });
      if (error) throw error;
      return (data as TrendRow[]) || [];
    },
    enabled: period !== "quarter", // quarter 는 fallback 즉시 사용
    staleTime: 60_000,
  });

  const data: TrendRow[] = period === "quarter"
    ? fallback.map((q) => ({ label: q.label, p_start: q.q_start, p_end: q.q_end, done_count: q.done_count, revenue: q.revenue, profit: q.profit }))
    : (rpcData || []);

  const max = useMemo(() => Math.max(1, ...data.map((d) => Number(d[metric]) || 0)), [data, metric]);
  const summary = useMemo(() => {
    const sum = data.reduce((acc, q) => acc + (Number(q[metric]) || 0), 0);
    return metric === "done_count" ? `${sum}건` : fmtW(sum);
  }, [data, metric]);

  return (
    <div className="project-trend-section">
      <div className="flex items-end justify-between mb-3 gap-2 flex-wrap">
        <h2 className="text-lg font-extrabold text-[var(--text)]">📈 프로젝트 추이</h2>
        <div className="flex items-center gap-2 flex-wrap">
          {/* 기간 단위 토글 */}
          <div className="trend-period-toggle">
            {([
              { k: "month", l: "월" },
              { k: "quarter", l: "분기" },
              { k: "year", l: "년" },
            ] as { k: TrendPeriod; l: string }[]).map((p) => (
              <button
                key={p.k}
                onClick={() => setPeriod(p.k)}
                className={`px-2.5 py-1 rounded-md font-semibold transition ${
                  period === p.k
                    ? "bg-[var(--bg-card)] text-[var(--text)] shadow-sm"
                    : "text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {p.l}
              </button>
            ))}
          </div>
          {/* metric 토글 */}
          <div className="trend-metric-toggle">
            {[
              { k: "revenue", l: "매출" },
              { k: "profit", l: "이윤" },
              { k: "done_count", l: "완료수" },
            ].map((m) => (
              <button
                key={m.k}
                onClick={() => setMetric(m.k as any)}
                className={`px-2.5 py-1 rounded-lg font-semibold transition ${
                  metric === m.k
                    ? "bg-[var(--primary)] text-white"
                    : "bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)]"
                }`}
              >
                {m.l}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="trend-chart-card rounded-2xl bg-[var(--bg-card)]">
        {/* 헤더 토글 — 접혀있으면 합계 1줄, 펼치면 큰 그래프 */}
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="trend-chart-toggle"
          aria-expanded={open}
        >
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-bold text-[var(--text-muted)] uppercase">합계</span>
            <span className="text-sm font-extrabold text-[var(--text)] tabular-nums truncate">{summary}</span>
          </div>
          <span className="text-xs font-semibold text-[var(--primary)] shrink-0 flex items-center gap-1">
            {open ? "접기" : "펼쳐보기"}
            <svg
              className={`w-3.5 h-3.5 transition-transform ${open ? "rotate-180" : ""}`}
              viewBox="0 0 20 20"
              fill="currentColor"
              aria-hidden="true"
            >
              <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 11.06l3.71-3.83a.75.75 0 111.08 1.04l-4.25 4.39a.75.75 0 01-1.08 0L5.21 8.27a.75.75 0 01.02-1.06z" clipRule="evenodd" />
            </svg>
          </span>
        </button>
        {open && (
          <div className="px-4 pb-4 pt-1 border-t border-[var(--border)]">
            {/* 펼친 상태: 막대 너비 동적(데이터 수에 맞춰), h-72. 데이터 없으면 empty placeholder. */}
            {data.length === 0 ? (
              <div className="h-72 mt-3 flex items-center justify-center text-xs text-[var(--text-dim)]">
                불러오는 중…
              </div>
            ) : (
            <div
              className="trend-bar-grid"
              style={{ gridTemplateColumns: `repeat(${data.length}, minmax(0, 1fr))` }}
            >
              {data.map((q) => {
                const v = Number(q[metric]) || 0;
                const h = max > 0 ? (Math.abs(v) / max) * 100 : 0;
                return (
                  <div key={q.label} className="trend-bar-col">
                    <div className="text-sm font-bold text-[var(--text)] tabular-nums">
                      {metric === "done_count" ? `${v}건` : fmtW(v)}
                    </div>
                    <div className="flex-1 w-full flex items-end">
                      <div
                        className={`w-full rounded-t-lg transition-all ${
                          metric === "profit" ? (v < 0 ? "bg-red-500/60" : "bg-purple-500/60") :
                          metric === "revenue" ? "bg-cyan-500/60" : "bg-emerald-500/60"
                        }`}
                        style={{ height: `${h}%` }}
                      />
                    </div>
                    <div className="text-xs font-semibold text-[var(--text-muted)] whitespace-nowrap">{q.label}</div>
                  </div>
                );
              })}
            </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─────────── 5. 진행 중 리스트 ───────────
function InProgressListSection({ data }: { data: InProgress[] }) {
  if (data.length === 0) {
    return (
      <div className="in-progress-list-section">
        <h2 className="text-lg font-extrabold text-[var(--text)] mb-3">🔄 진행 중 프로젝트</h2>
        <div className="in-progress-empty rounded-2xl bg-[var(--bg-card)]">
          진행 중 프로젝트가 없습니다
        </div>
      </div>
    );
  }
  return (
    <div className="in-progress-list-section">
      <div className="flex items-end justify-between mb-3 gap-2">
        <h2 className="text-lg font-extrabold text-[var(--text)]">🔄 진행 중 프로젝트 ({data.length})</h2>
        <Link href="/projects" className="text-xs text-[var(--primary)] hover:underline">전체 칸반 →</Link>
      </div>
      <div className="in-progress-list rounded-2xl bg-[var(--bg-card)]">
        {data.map((d) => {
          const stagePct = STAGE_PROGRESS[d.stage] ?? 20;
          const pct = d.progress_pct_override ?? stagePct;
          const c = STAGE_COLOR[d.stage];
          const marginColor = d.expected_margin >= 0 ? "text-emerald-500" : "text-red-500";
          return (
            <Link
              key={d.id}
              href={`/projects/${d.id}`}
              className="in-progress-row"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                  <span className={`text-[10px] px-1.5 py-0.5 rounded font-bold ${c.bg} ${c.text}`}>{STAGE_LABEL[d.stage]}</span>
                  <span className="text-sm font-bold text-[var(--text)] truncate">{d.name}</span>
                </div>
                <div className="text-[11px] text-[var(--text-dim)] truncate">
                  {d.partner?.name || "거래처 미지정"} · {d.manager?.name || "담당 미지정"}
                  {d.end_date && <> · 마감 {new Date(d.end_date).toLocaleDateString("ko-KR")}</>}
                </div>
                {d.next_action_text && (
                  <div className="text-[11px] text-[var(--primary)] truncate mt-0.5">→ {d.next_action_text}</div>
                )}
              </div>
              <div className="w-24 shrink-0">
                <div className="text-[10px] text-[var(--text-dim)] text-right mb-0.5">{pct}%</div>
                <div className="h-1.5 bg-[var(--bg-surface)] rounded overflow-hidden">
                  <div className="h-full bg-[var(--primary)]" style={{ width: `${pct}%` }} />
                </div>
              </div>
              <div className="text-right shrink-0 w-24">
                <div className="text-xs font-bold text-[var(--text)] tabular-nums">{fmtW(d.contract_total)}</div>
                <div className={`text-[10px] tabular-nums ${marginColor}`}>마진 {fmtW(d.expected_margin)}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}

// ─────────── 6. 완료 보고서 보관함 ───────────
function CompletedReportsSection({ data }: { data: DoneReport[] }) {
  const { open: openDocViewer } = useDocumentViewer();
  // 분기별 grouping
  const groups = useMemo(() => {
    const map = new Map<string, DoneReport[]>();
    for (const r of data) {
      const key = r.quarter_label || "분기 미상";
      const arr = map.get(key) || [];
      arr.push(r);
      map.set(key, arr);
    }
    return Array.from(map.entries()).sort((a, b) => b[0].localeCompare(a[0]));
  }, [data]);

  const [open, setOpen] = useState<Set<string>>(() => new Set(groups[0] ? [groups[0][0]] : []));
  const toggle = (k: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k); else next.add(k);
      return next;
    });
  };

  return (
    <div className="completed-reports-section">
      <h2 className="text-lg font-extrabold text-[var(--text)] mb-3">완료 보고서 보관함</h2>
      {groups.length === 0 ? (
        <div className="completed-reports-empty glass-card">
          완료된 프로젝트 보고서가 아직 없습니다
        </div>
      ) : (
        <div className="completed-reports-groups">
          {groups.map(([qLabel, items]) => {
            const isOpen = open.has(qLabel);
            const totalRev = items.reduce((s, x) => s + Number(x.revenue || 0), 0);
            const totalProf = items.reduce((s, x) => s + Number(x.profit || 0), 0);
            return (
              <div key={qLabel} className="completed-reports-group glass-card">
                <button
                  type="button"
                  onClick={() => toggle(qLabel)}
                  className="completed-reports-group-header"
                >
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-bold text-[var(--text)]">{qLabel}</span>
                    <span className="text-xs text-[var(--text-dim)]">{items.length}건 · 매출 {fmtW(totalRev)} · 이윤 {fmtW(totalProf)}</span>
                  </div>
                  <span className="text-[var(--text-dim)] text-xs">{isOpen ? "▼" : "▶"}</span>
                </button>
                {isOpen && (
                  <div className="completed-reports-group-list">
                    {items.map((r) => (
                      <div key={r.id} className="completed-report-row">
                        <Link href={`/projects/${r.id}`} className="flex-1 min-w-0 hover:underline">
                          <div className="text-sm font-medium text-[var(--text)] truncate">{r.name}</div>
                          <div className="text-[11px] text-[var(--text-dim)] truncate">
                            {r.partner_name || "거래처 미상"}
                            {r.done_at && <> · {new Date(r.done_at).toLocaleDateString("ko-KR")}</>}
                          </div>
                        </Link>
                        <div className="text-right shrink-0 w-24">
                          <div className="text-xs font-bold text-[var(--text)] tabular-nums">{fmtW(r.revenue)}</div>
                          <div className="text-[10px] text-[var(--text-dim)] tabular-nums">이윤 {fmtW(r.profit)}</div>
                        </div>
                        <div className="completed-report-actions">
                          {r.settlement_id && (
                            <button
                              onClick={() => openDocViewer({ type: 'contract', id: r.settlement_id! })}
                              className="text-[10px] px-2 py-1 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-semibold hover:bg-[var(--primary)]/20"
                              title="정산서 보기"
                            >
                              📄 정산서
                            </button>
                          )}
                          {r.completion_id && (
                            <button
                              onClick={() => openDocViewer({ type: 'contract', id: r.completion_id! })}
                              className="text-[10px] px-2 py-1 rounded bg-[var(--success)]/10 text-[var(--success)] font-semibold hover:bg-[var(--success)]/20"
                              title="완료확인서 보기"
                            >
                              📄 완료
                            </button>
                          )}
                          {!r.settlement_id && !r.completion_id && (
                            <span className="text-[10px] text-[var(--text-dim)] px-2 py-1">서명본 없음</span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
