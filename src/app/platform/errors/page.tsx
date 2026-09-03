"use client";
// 에러 해석 (운영자) — 2026-09-03 v2 리디자인(사장님: "운영자 페이지는 비전공자도 알아보게").
//   오류 하나가 "사고 카드"처럼 읽힌다: 무슨 일이에요 → 왜 났을까 → 지금 할 일. 기술 원문은 접어 둔다.
//   데이터·해결 처리(RPC operator_recent_errors / operator_resolve_error / operator_resolve_errors)는 그대로.
import { SystemTabs } from "../_components/system-tabs";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  explainError,
  SEVERITY_TONE,
  CATEGORY_LABEL,
  type ErrorExplanation,
  type ErrorSeverity,
} from "@/lib/operator-error-explain";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfSkeleton, PfEmpty, PfSeg } from "../_components/pf/ui";
import { PfDonut, PfTrend } from "../_components/pf/charts";

const db = supabase;

// 심각도 → 배지 톤 (SEVERITY_TONE 의 라벨은 그대로 쓴다)
const SEV_BADGE: Record<ErrorSeverity, "ok" | "warn" | "danger" | "muted"> = {
  low: "ok",
  medium: "warn",
  high: "danger",
  critical: "danger",
};
// 심각도 → 도넛 색 (검증된 팔레트: 낮음 teal · 보통 amber · 높음 rose · 치명 indigo)
const SEV_COLOR: Record<ErrorSeverity, string> = {
  low: "var(--chart-3)",
  medium: "var(--chart-2)",
  high: "var(--chart-4)",
  critical: "var(--chart-1)",
};

type ErrorRow = {
  id: string;
  company_id: string | null;
  company_name: string | null;
  user_email: string | null;
  user_name: string | null;
  source: string | null;
  error_type: string | null;
  message: string;
  stack: string | null;
  url: string | null;
  context: any;
  resolved: boolean;
  created_at: string;
};

function fmtRelative(iso: string): string {
  const t = new Date(iso).getTime();
  const diff = Date.now() - t;
  const m = Math.floor(diff / 60000);
  if (m < 1) return "방금";
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  const d = Math.floor(h / 24);
  return `${d}일 전`;
}

export default function PlatformErrorsPage() {
  const qc = useQueryClient();
  const [hours, setHours] = useState<number>(72);
  const [filter, setFilter] = useState<"all" | "unresolved" | "critical">("all");
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: errors = [], isLoading } = useQuery<ErrorRow[]>({
    queryKey: ["op-errors", hours],
    queryFn: async () => {
      const { data, error } = await db.rpc("operator_recent_errors", {
        p_limit: 200,
        p_hours: hours,
      });
      if (error) throw error;
      return (data || []) as ErrorRow[];
    },
  });

  const resolve = useMutation({
    mutationFn: async ({ id, resolved }: { id: string; resolved: boolean }) => {
      const { error } = await db.rpc("operator_resolve_error", { p_id: id, p_resolved: resolved });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["op-errors"] }),
  });

  // 일괄 해결 (2026-08-20 사장님: 고쳐 놓은 건이 대시보드에 계속 쌓인다) — 한 건씩만 누를 수
  //   있어 아무도 표시를 안 했다. 해결로 표시하면 대시보드 24시간 카운트에서 빠지고,
  //   같은 에러가 다시 나면 새 건으로 올라온다(중복 접기는 미해결 건에만 걸린다).
  const resolveMany = useMutation({
    mutationFn: async ({ ids, resolved }: { ids: string[]; resolved: boolean }) => {
      // 생성 타입에 아직 없는 신규 RPC (database.ts 재생성은 다음 라운드에 — 다른 세션과 충돌 방지)
      const { error } = await (db as any).rpc("operator_resolve_errors", { p_ids: ids, p_resolved: resolved });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["op-errors"] }),
  });

  const unresolvedIds = useMemo(() => errors.filter((e) => !e.resolved).map((e) => e.id), [errors]);

  // 그룹핑: 코드별 빈도
  const grouped = useMemo(() => {
    const map = new Map<string, { code: string; explanation: ErrorExplanation; rows: ErrorRow[] }>();
    for (const e of errors) {
      const exp = explainError(e.message, e.error_type, e.context);
      const g = map.get(exp.code) || { code: exp.code, explanation: exp, rows: [] };
      g.rows.push(e);
      map.set(exp.code, g);
    }
    const arr = Array.from(map.values());
    arr.sort((a, b) => b.rows.length - a.rows.length);
    return arr;
  }, [errors]);

  const filteredGroups = grouped.filter((g) => {
    if (filter === "unresolved") return g.rows.some((r) => !r.resolved);
    if (filter === "critical") return g.explanation.severity === "critical" || g.explanation.severity === "high";
    return true;
  });

  const selected = useMemo(
    () => (selectedId ? errors.find((e) => e.id === selectedId) || null : null),
    [selectedId, errors],
  );
  const selectedExp = selected ? explainError(selected.message, selected.error_type, selected.context) : null;

  // ── 시각화용 집계(이미 불러온 행만 사용, 새 조회 없음) ──
  const sevCounts = useMemo(() => {
    const c: Record<ErrorSeverity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const g of grouped) c[g.explanation.severity] += g.rows.length;
    return c;
  }, [grouped]);
  const criticalCount = sevCounts.critical + sevCounts.high;
  // 시간 추이 — 24h 이하면 시간 단위, 그 이상은 하루 단위 버킷
  const trend = useMemo(() => {
    if (errors.length === 0) return [] as { date: Date; count: number; unresolved: number }[];
    const byDay = hours > 48;
    const bucketMs = byDay ? 86_400_000 : 3_600_000;
    const now = Date.now();
    const start = now - hours * 3_600_000;
    const buckets = new Map<number, { count: number; unresolved: number }>();
    const nBuckets = Math.ceil((hours * 3_600_000) / bucketMs);
    for (let i = 0; i <= nBuckets; i++) {
      const t = Math.floor((start + i * bucketMs) / bucketMs) * bucketMs;
      buckets.set(t, { count: 0, unresolved: 0 });
    }
    for (const e of errors) {
      const t = Math.floor(new Date(e.created_at).getTime() / bucketMs) * bucketMs;
      const b = buckets.get(t) ?? { count: 0, unresolved: 0 };
      b.count += 1;
      if (!e.resolved) b.unresolved += 1;
      buckets.set(t, b);
    }
    return [...buckets.entries()].sort((a, b) => a[0] - b[0]).map(([t, b]) => ({ date: new Date(t), ...b }));
  }, [errors, hours]);
  const trendLabel = hours > 48
    ? (d: Date) => `${d.getMonth() + 1}/${d.getDate()}`
    : (d: Date) => `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}시`;

  const hoursLabel = hours === 24 ? "최근 24시간" : hours === 72 ? "최근 3일" : "최근 7일";

  return (
    <PfPage>
      <PfPageHead
        eyebrow="운영"
        title="에러 해석"
        desc="오너뷰에서 난 오류를 사람 말로 풀어 보여줍니다. 무슨 일인지, 왜 났는지, 지금 무엇을 하면 되는지 순서로 읽으세요."
        actions={
          <>
            <PfSeg
              value={String(hours) as "24" | "72" | "168"}
              onChange={(v) => setHours(Number(v))}
              options={[{ value: "24", label: "24시간" }, { value: "72", label: "3일" }, { value: "168", label: "7일" }]}
            />
            <button
              type="button"
              onClick={() => {
                if (unresolvedIds.length === 0) return;
                if (!confirm(`미해결 ${unresolvedIds.length}건을 모두 해결로 표시할까요?\n(다시 발생하면 새 건으로 올라옵니다)`)) return;
                resolveMany.mutate({ ids: unresolvedIds, resolved: true });
              }}
              disabled={unresolvedIds.length === 0 || resolveMany.isPending}
              className="pf-btn pf-btn-primary disabled:opacity-40"
            >
              ✓ 미해결 {unresolvedIds.length}건 모두 해결
            </button>
          </>
        }
      />
      <SystemTabs />

      {/* 한눈에 — KPI 타일 */}
      <div className="pf-kpi-grid">
        <PfCard i={2} className="pf-kpi-tile"><PfKpi label={`${hoursLabel} 오류`} value={errors.length} unit="건" /></PfCard>
        <PfCard i={3} className="pf-kpi-tile"><PfKpi label="미해결" value={unresolvedIds.length} unit="건" accent={unresolvedIds.length > 0} /></PfCard>
        <PfCard i={4} className="pf-kpi-tile"><PfKpi label="심각(높음 이상)" value={criticalCount} unit="건" /></PfCard>
        <PfCard i={5} className="pf-kpi-tile"><PfKpi label="오류 종류" value={grouped.length} unit="종" /></PfCard>
      </div>

      {/* 시각화 — 심각도 구성 · 시간 추이 */}
      {errors.length > 0 && (
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
          <PfCard i={6} className="lg:col-span-2">
            <PfCardHead title="심각도 구성" sub="치명·높음은 바로 봐야 하는 것, 낮음은 고장이 아닌 안내인 경우가 많아요" />
            <PfCardBody>
              <PfDonut
                slices={(["critical", "high", "medium", "low"] as ErrorSeverity[]).map((s) => ({ label: SEVERITY_TONE[s].label, value: sevCounts[s], color: SEV_COLOR[s] }))}
                size={160}
                centerLabel="전체"
                formatCenter={(t) => `${t}건`}
              />
            </PfCardBody>
          </PfCard>
          <PfCard i={7} className="lg:col-span-3">
            <PfCardHead title="언제 났나" sub={`${hoursLabel} · ${hours > 48 ? "하루" : "한 시간"} 단위`} />
            <PfCardBody>
              <PfTrend
                data={trend}
                series={[{ key: "count", label: "전체" }, { key: "unresolved", label: "미해결", color: "var(--chart-4)" }]}
                height={180}
                dateLabel={trendLabel}
                revealKey={`${hours}-${errors.length}`}
              />
            </PfCardBody>
          </PfCard>
        </div>
      )}

      {/* 필터 */}
      <div className="flex flex-wrap items-center justify-between gap-2 pf-in" style={{ ["--pf-i" as string]: 8 }}>
        <PfSeg
          value={filter}
          onChange={setFilter}
          options={[{ value: "all", label: "전체" }, { value: "unresolved", label: "미해결" }, { value: "critical", label: "심각" }]}
        />
        <span className="text-[11px] text-[var(--text-dim)]">{hoursLabel} · {errors.length}건 · 종류별로 묶어 {grouped.length}종</span>
      </div>

      {isLoading && (
        <PfCard i={9}><PfCardBody className="pt-5"><PfSkeleton rows={4} h={16} /></PfCardBody></PfCard>
      )}
      {!isLoading && errors.length === 0 && (
        <PfCard i={9}><PfEmpty ok>이 기간에 오류가 없습니다. 잘 돌아가고 있어요 ✓</PfEmpty></PfCard>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 좌: 종류별 사고 카드 */}
        <div className="lg:col-span-2 space-y-4">
          {filteredGroups.map((g, gi) => {
            const tone = SEVERITY_TONE[g.explanation.severity];
            const unresolvedCount = g.rows.filter((r) => !r.resolved).length;
            // "미해결" 필터일 땐 그룹 안 행 목록도 미해결만 — 라벨과 표시 내용 일치
            const visibleRows = filter === "unresolved" ? g.rows.filter((r) => !r.resolved) : g.rows;
            const affected = Array.from(new Set(g.rows.map((r) => r.company_name).filter(Boolean))) as string[];
            const latest = g.rows.reduce((a, r) => (a > r.created_at ? a : r.created_at), g.rows[0]?.created_at ?? "");
            return (
              <PfCard key={g.code} i={9 + gi} hover={false} className={g.explanation.severity === "critical" && unresolvedCount > 0 ? "ring-1 ring-[var(--danger)]/40" : ""}>
                <PfCardHead
                  title={
                    <span className="flex items-center gap-2 flex-wrap">
                      <PfBadge tone={SEV_BADGE[g.explanation.severity]}>{tone.label}</PfBadge>
                      <span className="text-[10px] font-bold text-[var(--text-dim)] uppercase tracking-wider">{CATEGORY_LABEL[g.explanation.category]}</span>
                      <span className="text-[12px] font-bold text-[var(--text)]">{g.rows.length}회{unresolvedCount > 0 ? ` · 미해결 ${unresolvedCount}` : " · 모두 해결"}</span>
                    </span>
                  }
                  sub={`마지막 발생 ${latest ? fmtRelative(latest) : "—"}${affected.length ? ` · 영향 회사: ${affected.slice(0, 3).join(", ")}${affected.length > 3 ? ` 외 ${affected.length - 3}곳` : ""}` : ""}`}
                  action={unresolvedCount > 0 ? (
                    <button
                      type="button"
                      onClick={() => resolveMany.mutate({ ids: g.rows.filter((r) => !r.resolved).map((r) => r.id), resolved: true })}
                      disabled={resolveMany.isPending}
                      className="pf-btn pf-btn-sm pf-btn-primary disabled:opacity-50"
                    >
                      ✓ 이 {unresolvedCount}건 해결
                    </button>
                  ) : undefined}
                />
                <PfCardBody className="pb-3">
                  <div className="text-[15px] font-bold text-[var(--text)] leading-snug mb-2">{g.explanation.what}</div>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    <div className="rounded-xl px-3 py-2 bg-[var(--bg-surface)]">
                      <div className="text-[10px] font-bold text-[var(--text-dim)] mb-0.5">왜 났을까</div>
                      <div className="text-[12px] text-[var(--text-muted)] leading-relaxed">{g.explanation.why}</div>
                    </div>
                    <div className="rounded-xl px-3 py-2" style={{ background: "color-mix(in oklab, var(--primary) 8%, transparent)" }}>
                      <div className="text-[10px] font-bold text-[var(--primary)] mb-0.5">지금 할 일</div>
                      <div className="text-[12px] text-[var(--text)] leading-relaxed">{g.explanation.fix}</div>
                    </div>
                  </div>
                </PfCardBody>
                <details className="group border-t border-[var(--border)]/60">
                  <summary className="cursor-pointer select-none px-5 py-2 text-[11px] font-semibold text-[var(--text-dim)] hover:text-[var(--text)] flex items-center gap-1.5">
                    <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    발생 기록 {visibleRows.length}건 · 기술 원문 <span className="font-mono font-normal">{g.code}</span>
                  </summary>
                  <div className="pf-rows border-t border-[var(--border)]/60">
                    {visibleRows.slice(0, 5).map((r) => (
                      <button
                        key={r.id}
                        type="button"
                        onClick={() => setSelectedId(r.id)}
                        className={`pf-row w-full text-left flex-col items-stretch gap-0.5 ${selectedId === r.id ? "bg-[var(--primary-light)]" : ""}`}
                      >
                        <div className="flex items-center justify-between gap-3">
                          <div className="text-[11px] text-[var(--text-muted)] truncate flex-1">
                            {r.company_name || "(회사 없음)"} · {r.user_email || r.user_name || "—"} · {r.url || r.source || "?"}
                          </div>
                          <div className="text-[10px] text-[var(--text-dim)] shrink-0">
                            {fmtRelative(r.created_at)}
                            {r.resolved && <span className="ml-2 text-[var(--success)]">✓ 해결</span>}
                          </div>
                        </div>
                        <div className="text-[10.5px] text-[var(--text-dim)] font-mono truncate">{r.message}</div>
                      </button>
                    ))}
                    {visibleRows.length > 5 && <div className="pf-row-more text-center">… 외 {visibleRows.length - 5}건</div>}
                  </div>
                </details>
              </PfCard>
            );
          })}
        </div>

        {/* 우: 선택 상세 */}
        <div className="lg:col-span-1">
          {selected && selectedExp ? (
            <PfCard hover={false} className="lg:sticky lg:top-24">
              <PfCardHead
                title={<PfBadge tone={SEV_BADGE[selectedExp.severity]}>{SEVERITY_TONE[selectedExp.severity].label}</PfBadge>}
                sub={new Date(selected.created_at).toLocaleString("ko-KR")}
                action={
                  <button
                    type="button"
                    onClick={() => resolve.mutate({ id: selected.id, resolved: !selected.resolved })}
                    disabled={resolve.isPending}
                    className={`pf-btn pf-btn-sm ${selected.resolved ? "" : "pf-btn-primary"} disabled:opacity-50`}
                  >
                    {selected.resolved ? "↺ 미해결로" : "✓ 해결로"}
                  </button>
                }
              />
              <PfCardBody>
                <div className="text-[15px] font-bold text-[var(--text)] leading-snug mb-3">{selectedExp.what}</div>
                <div className="space-y-2 mb-4">
                  <div className="rounded-xl px-3 py-2 bg-[var(--bg-surface)]">
                    <div className="text-[10px] font-bold text-[var(--text-dim)] mb-0.5">왜 났을까</div>
                    <div className="text-[12px] text-[var(--text-muted)] leading-relaxed">{selectedExp.why}</div>
                  </div>
                  <div className="rounded-xl px-3 py-2" style={{ background: "color-mix(in oklab, var(--primary) 8%, transparent)" }}>
                    <div className="text-[10px] font-bold text-[var(--primary)] mb-0.5">지금 할 일</div>
                    <div className="text-[12px] text-[var(--text)] leading-relaxed">{selectedExp.fix}</div>
                  </div>
                </div>

                <div className="border-t border-[var(--border)]/60 pt-3 space-y-1.5 text-[11px]">
                  <Row label="회사" value={selected.company_name || "—"} />
                  <Row label="사용자" value={selected.user_email || selected.user_name || "—"} />
                  <Row label="화면" value={selected.url || "—"} />
                  <Row label="출처" value={selected.source || "—"} />
                </div>

                <details className="mt-3 group">
                  <summary className="cursor-pointer select-none text-[11px] font-semibold text-[var(--text-dim)] hover:text-[var(--text)] flex items-center gap-1.5">
                    <svg className="w-3 h-3 transition-transform group-open:rotate-90" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                    기술 원문 (개발팀 전달용) <span className="font-mono font-normal">{selectedExp.code}</span>
                  </summary>
                  <pre className="mt-2 p-2 bg-[var(--bg-surface)] rounded-lg text-[10px] text-[var(--text-muted)] overflow-auto whitespace-pre-wrap break-words max-h-40">{selected.message}</pre>
                  {selected.context && (
                    <pre className="mt-2 p-2 bg-[var(--bg-surface)] rounded-lg text-[10px] text-[var(--text-dim)] overflow-auto whitespace-pre-wrap break-words max-h-40">{JSON.stringify(selected.context, null, 2)}</pre>
                  )}
                  {selected.stack && (
                    <pre className="mt-2 p-2 bg-[var(--bg-surface)] rounded-lg text-[10px] text-[var(--text-dim)] overflow-auto whitespace-pre max-h-60">{selected.stack}</pre>
                  )}
                </details>
              </PfCardBody>
            </PfCard>
          ) : (
            <PfCard hover={false} i={10}>
              <PfEmpty>왼쪽 카드의 "발생 기록"을 펼쳐 한 건을 누르면 여기에 상세가 나옵니다.</PfEmpty>
            </PfCard>
          )}
        </div>
      </div>
    </PfPage>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-2">
      <div className="w-12 shrink-0 text-[var(--text-dim)]">{label}</div>
      <div className="text-[var(--text)] break-all">{value}</div>
    </div>
  );
}
