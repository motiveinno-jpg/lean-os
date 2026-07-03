"use client";

import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import {
  explainError,
  SEVERITY_TONE,
  CATEGORY_LABEL,
  type ErrorExplanation,
} from "@/lib/operator-error-explain";

const db = supabase as any;

// 라이트/다크 토큰 기반 심각도 색 (SEVERITY_TONE 의 다크 고정색 대체 — 라벨은 lib 유지)
const SEVERITY_CLS: Record<string, string> = {
  low: "bg-[var(--success-dim)] text-[var(--success)]",
  medium: "bg-[var(--warning-dim)] text-[var(--warning)]",
  high: "bg-[var(--danger-dim)] text-[var(--danger)]",
  critical: "bg-[var(--danger)] text-white",
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

  return (
    <div className="max-w-6xl space-y-6">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">에러 해석</h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            최근 {hours}시간 · {errors.length}건 · 코드별 그룹핑 {grouped.length}종
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-sm text-[var(--text)] focus:outline-none focus:border-[var(--primary)]"
          >
            <option value={24}>최근 24시간</option>
            <option value={72}>최근 3일</option>
            <option value={168}>최근 7일</option>
          </select>
          <div className="seg-bar">
            {[
              { k: "all", l: "전체" },
              { k: "unresolved", l: "미해결" },
              { k: "critical", l: "심각" },
            ].map((f) => (
              <button
                key={f.k}
                onClick={() => setFilter(f.k as any)}
                className={`seg-item ${filter === f.k ? "seg-item-active" : ""}`}
              >
                {f.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && <div className="text-sm text-[var(--text-dim)]">불러오는 중…</div>}
      {!isLoading && errors.length === 0 && (
        <div className="glass-card p-8 text-center text-sm text-[var(--success)]">
          🎉 이 기간에 에러 없음.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 좌: 코드별 그룹 */}
        <div className="lg:col-span-2 space-y-4">
          {filteredGroups.map((g) => {
            const tone = SEVERITY_TONE[g.explanation.severity];
            const unresolvedCount = g.rows.filter((r) => !r.resolved).length;
            return (
              <div key={g.code} className="glass-card overflow-hidden">
                <div className="px-5 py-3 border-b border-[var(--border)] flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${SEVERITY_CLS[g.explanation.severity] || SEVERITY_CLS.medium}`}>
                      {tone.label}
                    </span>
                    <span className="text-[10px] font-bold text-[var(--text-dim)] uppercase tracking-wider">
                      {CATEGORY_LABEL[g.explanation.category]}
                    </span>
                    <span className="text-xs font-mono text-[var(--text-muted)]">{g.code}</span>
                    <span className="text-xs text-[var(--text)] font-bold">
                      {g.rows.length}회{unresolvedCount > 0 && ` (미해결 ${unresolvedCount})`}
                    </span>
                  </div>
                </div>
                <div className="px-5 py-4 bg-[var(--bg-surface)]/60">
                  <div className="text-sm text-[var(--text)] font-semibold mb-1">{g.explanation.what}</div>
                  <div className="text-xs text-[var(--text-muted)] mb-1">
                    <span className="text-[var(--text-dim)]">왜 났을까?</span> {g.explanation.why}
                  </div>
                  <div className="text-xs text-[var(--primary)]">
                    <span className="text-[var(--text-dim)]">어떻게 고치나?</span> {g.explanation.fix}
                  </div>
                </div>
                <div className="divide-y divide-[var(--border)]">
                  {g.rows.slice(0, 5).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={`w-full text-left px-5 py-2.5 hover:bg-[var(--bg-surface)]/60 transition ${
                        selectedId === r.id ? "bg-[var(--primary-light)]" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] text-[var(--text-muted)] truncate flex-1">
                          {r.company_name || "(no company)"} · {r.user_email || r.user_name || "—"} · {r.url || r.source || "?"}
                        </div>
                        <div className="text-[10px] text-[var(--text-dim)] shrink-0">
                          {fmtRelative(r.created_at)}
                          {r.resolved && <span className="ml-2 text-[var(--success)]">✓ 해결</span>}
                        </div>
                      </div>
                      <div className="text-[11px] text-[var(--text-dim)] truncate mt-0.5">{r.message}</div>
                    </button>
                  ))}
                  {g.rows.length > 5 && (
                    <div className="px-5 py-2 text-[11px] text-[var(--text-dim)] text-center">
                      … 외 {g.rows.length - 5}건
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>

        {/* 우: 선택 상세 */}
        <div className="lg:col-span-1">
          {selected && selectedExp ? (
            <div className="glass-card p-5 sticky top-4">
              <div className="flex items-center justify-between mb-3">
                <span className={`px-2.5 py-1 rounded-full text-[10px] font-bold ${SEVERITY_CLS[selectedExp.severity] || SEVERITY_CLS.medium}`}>
                  {SEVERITY_TONE[selectedExp.severity].label}
                </span>
                <button
                  onClick={() => resolve.mutate({ id: selected.id, resolved: !selected.resolved })}
                  disabled={resolve.isPending}
                  className={`text-[11px] font-semibold px-2 py-1 rounded ${
                    selected.resolved
                      ? "bg-[var(--bg-surface)] text-[var(--text-dim)]"
                      : "bg-[var(--success)] text-white hover:opacity-90"
                  } disabled:opacity-50`}
                >
                  {selected.resolved ? "↺ 미해결로" : "✓ 해결로"}
                </button>
              </div>
              <div className="text-xs text-[var(--text-dim)] mb-2">{selectedExp.code}</div>
              <div className="text-base text-[var(--text)] font-bold mb-2">{selectedExp.what}</div>
              <div className="text-xs text-[var(--text-muted)] mb-3">
                <div className="text-[var(--text-dim)] font-semibold">왜 났을까?</div>
                <div className="mt-0.5">{selectedExp.why}</div>
              </div>
              <div className="text-xs text-[var(--primary)] mb-4">
                <div className="text-[var(--text-dim)] font-semibold">어떻게 고치나?</div>
                <div className="mt-0.5">{selectedExp.fix}</div>
              </div>

              <div className="border-t border-[var(--border)] pt-3 space-y-2 text-[11px]">
                <Row label="회사" value={selected.company_name || "—"} />
                <Row label="사용자" value={selected.user_email || selected.user_name || "—"} />
                <Row label="URL" value={selected.url || "—"} />
                <Row label="소스" value={selected.source || "—"} />
                <Row label="시각" value={new Date(selected.created_at).toLocaleString("ko-KR")} />
              </div>

              <details className="mt-3">
                <summary className="text-[11px] text-[var(--primary)] cursor-pointer">원문 메시지</summary>
                <pre className="mt-2 p-2 bg-[var(--bg-surface)] rounded-lg text-[10px] text-[var(--text-muted)] overflow-auto whitespace-pre-wrap break-words max-h-40">
                  {selected.message}
                </pre>
              </details>
              {selected.stack && (
                <details className="mt-2">
                  <summary className="text-[11px] text-[var(--primary)] cursor-pointer">스택트레이스</summary>
                  <pre className="mt-2 p-2 bg-[var(--bg-surface)] rounded-lg text-[10px] text-[var(--text-dim)] overflow-auto whitespace-pre max-h-60">
                    {selected.stack}
                  </pre>
                </details>
              )}
            </div>
          ) : (
            <div className="glass-card p-8 text-center text-sm text-[var(--text-dim)]">
              왼쪽에서 에러를 선택하면 상세 해석이 표시됩니다.
            </div>
          )}
        </div>
      </div>

      <div className="kpi-callout">
        <b>OP-E</b> · 코드 매핑은{" "}
        <span className="font-mono text-[var(--primary)]">src/lib/operator-error-explain.ts</span> 에 누적.
        새 패턴 발생 시 같은 파일에 PG/PostgREST/CODEF/Stripe/Generic 섹션 중 알맞은 곳에 추가.
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="w-12 shrink-0 text-[var(--text-dim)]">{label}</div>
      <div className="text-[var(--text)] break-all">{value}</div>
    </div>
  );
}
