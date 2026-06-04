"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { explainError } from "@/lib/error-logger";
import { AccessDenied } from "@/components/access-denied";

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}초 전`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 전`;
  return `${Math.floor(h / 24)}일 전`;
}

const SEVERITY_META: Record<string, { label: string; cls: string }> = {
  high: { label: "심각", cls: "bg-red-500/15 text-red-500" },
  medium: { label: "보통", cls: "bg-amber-500/15 text-amber-500" },
  low: { label: "낮음", cls: "bg-gray-500/15 text-gray-400" },
};

function isPlatformOperator(email?: string | null): boolean {
  return !!email && /@mo-tive\.com$/i.test(email.trim());
}

type ErrorLog = {
  id: string;
  company_id: string | null;
  user_email: string | null;
  user_name: string | null;
  source: string | null;
  error_type: string | null;
  message: string;
  stack: string | null;
  url: string | null;
  user_agent: string | null;
  context: any;
  resolved: boolean;
  created_at: string;
};

const SOURCE_LABEL: Record<string, string> = {
  mutation: "데이터 저장",
  boundary: "화면 크래시",
  window: "JS 오류",
  promise: "비동기 오류",
  manual: "수동 기록",
};

export default function ErrorLogsPage() {
  const { user, loading } = useUser();
  const { toast } = useToast();
  const qc = useQueryClient();
  const isOperator = isPlatformOperator(user?.email);

  const [filter, setFilter] = useState<"unresolved" | "all" | "resolved">("unresolved");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { data: rows = [], isLoading, refetch, isFetching } = useQuery({
    queryKey: ["error-logs"],
    queryFn: async () => {
      const { data } = await (supabase as any)
        .from("error_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(500);
      return (data || []) as ErrorLog[];
    },
    enabled: isOperator,
    refetchInterval: 15_000,
  });

  // 실시간 — error_logs INSERT 구독해서 새 에러 즉시 반영
  const [liveCount, setLiveCount] = useState(0);
  useEffect(() => {
    if (!isOperator) return;
    const ch = (supabase as any)
      .channel("error_logs_live")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "error_logs" },
        () => {
          setLiveCount((c) => c + 1);
          qc.invalidateQueries({ queryKey: ["error-logs"] });
        },
      )
      .subscribe();
    return () => { (supabase as any).removeChannel(ch); };
  }, [isOperator, qc]);

  const toggleResolve = useMutation({
    mutationFn: async (p: { id: string; resolved: boolean }) => {
      const { error } = await (supabase as any)
        .from("error_logs")
        .update({ resolved: p.resolved })
        .eq("id", p.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["error-logs"] }),
    onError: (e: any) => toast("처리 실패: " + (e?.message || ""), "error"),
  });

  const clearResolved = useMutation({
    mutationFn: async () => {
      const { error } = await (supabase as any).from("error_logs").delete().eq("resolved", true);
      if (error) throw error;
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["error-logs"] }); toast("해결된 로그를 삭제했습니다.", "success"); },
    onError: (e: any) => toast("삭제 실패: " + (e?.message || ""), "error"),
  });

  const typeCounts = useMemo(() => {
    const map: Record<string, number> = {};
    for (const r of rows) {
      if (r.resolved) continue;
      const t = r.error_type || "unknown";
      map[t] = (map[t] || 0) + 1;
    }
    return map;
  }, [rows]);

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (filter === "unresolved" && r.resolved) return false;
      if (filter === "resolved" && !r.resolved) return false;
      if (typeFilter !== "all" && (r.error_type || "unknown") !== typeFilter) return false;
      return true;
    });
  }, [rows, filter, typeFilter]);

  const unresolvedCount = useMemo(() => rows.filter((r) => !r.resolved).length, [rows]);

  if (loading) {
    return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }
  if (!isOperator) {
    return <AccessDenied title="서비스 운영자 전용 페이지" detail="에러 로그 열람은 OwnerView 운영자만 가능합니다." />;
  }

  return (
    <div data-theme="light" className="bg-[var(--bg)] text-[var(--text)] -mx-6 -my-6 px-6 py-6 min-h-screen rounded-none">
      <div className="page-sticky-header flex items-center justify-between mb-6 gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">
            에러 모니터링
            <span className="inline-flex items-center gap-1 text-[11px] font-normal text-emerald-500">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" /> 실시간
            </span>
          </h1>
          <p className="text-sm text-[var(--text-muted)] mt-1">
            서비스 내 발생 에러 — 미해결 <span className="text-red-400 font-semibold">{unresolvedCount}</span>건
            {liveCount > 0 && <span className="ml-2 text-emerald-500">· 세션 중 신규 {liveCount}건 수신</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-xs text-[var(--text-muted)] hover:text-[var(--text)] transition disabled:opacity-50"
          >
            {isFetching ? "갱신 중..." : "🔄 새로고침"}
          </button>
          <button
            onClick={() => { if (confirm("해결 처리된 로그를 모두 삭제할까요?")) clearResolved.mutate(); }}
            className="px-3 py-2 bg-[var(--bg-card)] border border-[var(--border)] rounded-xl text-xs text-[var(--text-muted)] hover:text-red-400 transition"
          >
            해결됨 비우기
          </button>
        </div>
      </div>

      {/* 필터 */}
      <div className="flex flex-wrap gap-2 mb-4">
        {[
          { k: "unresolved" as const, label: "미해결" },
          { k: "all" as const, label: "전체" },
          { k: "resolved" as const, label: "해결됨" },
        ].map((f) => (
          <button
            key={f.k}
            onClick={() => setFilter(f.k)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition ${
              filter === f.k ? "bg-[var(--primary)] text-white" : "bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)]"
            }`}
          >
            {f.label}
          </button>
        ))}
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="px-2 py-1.5 bg-[var(--bg-card)] border border-[var(--border)] rounded-lg text-xs"
        >
          <option value="all">전체 유형</option>
          {Object.entries(typeCounts).sort((a, b) => b[1] - a[1]).map(([t, c]) => (
            <option key={t} value={t}>{explainError(t).title} ({c})</option>
          ))}
        </select>
      </div>

      {isLoading ? (
        <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : filtered.length === 0 ? (
        <div className="glass-card p-16 text-center">
          <div className="text-4xl mb-3">✅</div>
          <div className="text-sm text-[var(--text-muted)]">
            {filter === "unresolved" ? "미해결 에러가 없습니다" : "에러 로그가 없습니다"}
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((r) => {
            const ex = explainError(r.message, r.context);
            const expanded = expandedId === r.id;
            return (
              <div
                key={r.id}
                className={`bg-[var(--bg-card)] rounded-2xl border transition ${
                  r.resolved ? "border-[var(--border)] opacity-60" : "border-red-500/20"
                }`}
              >
                <div className="w-full px-5 py-4 flex items-start gap-3">
                  <button
                    onClick={() => setExpandedId(expanded ? null : r.id)}
                    className="flex-1 text-left min-w-0"
                  >
                    <div className="flex items-center gap-2 flex-wrap mb-1.5">
                      <span className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${SEVERITY_META[ex.severity]?.cls || ""}`}>
                        {SEVERITY_META[ex.severity]?.label || ex.severity}
                      </span>
                      <span className="text-sm font-bold text-[var(--text)]">{ex.title}</span>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-[var(--bg-surface)] text-[var(--text-dim)]">
                        {SOURCE_LABEL[r.source || ""] || r.source || "기타"}
                      </span>
                      {r.resolved && <span className="text-[10px] px-2 py-0.5 rounded-full bg-green-500/10 text-green-500">해결됨</span>}
                    </div>
                    {/* 누가 / 무슨 작업 / 언제 */}
                    <div className="flex items-center gap-2 flex-wrap text-[11px] mb-1">
                      <span className="px-2 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)]">
                        👤 {r.user_name || r.user_email || "익명 사용자"}
                      </span>
                      {r.context?.action && (
                        <span className="px-2 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)]">
                          🛠 {String(r.context.action)}
                        </span>
                      )}
                      {(r.context?.page || r.url) && (
                        <span className="px-2 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)] truncate max-w-[200px]">
                          📄 {r.context?.page || (() => { try { return new URL(r.url!).pathname; } catch { return r.url; } })()}
                        </span>
                      )}
                      <span className="text-[var(--text-dim)]">
                        🕒 {timeAgo(r.created_at)} ({new Date(r.created_at).toLocaleString("ko-KR")})
                      </span>
                    </div>
                    <div className="text-xs text-[var(--text-muted)] truncate">{r.message}</div>
                  </button>
                  {/* 빠른 해결/미해결 토글 */}
                  <button
                    onClick={() => toggleResolve.mutate({ id: r.id, resolved: !r.resolved })}
                    className={`shrink-0 px-2.5 py-1 rounded-lg text-[11px] font-semibold transition ${
                      r.resolved
                        ? "bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]"
                        : "bg-green-500/10 text-green-500 hover:bg-green-500/20"
                    }`}
                    title={r.resolved ? "미해결로 되돌리기" : "해결 처리"}
                  >
                    {r.resolved ? "↺ 미해결" : "✓ 해결"}
                  </button>
                  <button onClick={() => setExpandedId(expanded ? null : r.id)} className="shrink-0">
                    <svg className={`w-4 h-4 text-[var(--text-dim)] transition-transform ${expanded ? "rotate-180" : ""}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <polyline points="6 9 12 15 18 9" />
                    </svg>
                  </button>
                </div>
                {expanded && (
                  <div className="px-5 pb-4 border-t border-[var(--border)] pt-3 space-y-3">
                    {/* 한국어 설명 */}
                    <div className="bg-[var(--bg-surface)] rounded-xl p-3">
                      <div className="text-xs font-semibold text-[var(--text)] mb-1">🔎 무슨 에러인가요?</div>
                      <div className="text-xs text-[var(--text-muted)] leading-relaxed">{ex.detail}</div>
                      <div className="text-[11px] text-[var(--text-dim)] mt-1.5">원인 요약: {ex.hint}</div>
                    </div>
                    {/* 어떻게 고치나요 */}
                    <div className="bg-[var(--primary)]/5 border border-[var(--primary)]/15 rounded-xl p-3">
                      <div className="text-xs font-semibold text-[var(--primary)] mb-1.5">🛠 어떻게 고치나요?</div>
                      <ol className="text-xs text-[var(--text-muted)] leading-relaxed list-decimal pl-4 space-y-1">
                        {ex.fix.map((step, i) => <li key={i}>{step}</li>)}
                      </ol>
                    </div>
                    {/* 발생 맥락 */}
                    <div className="grid grid-cols-2 gap-2 text-[11px]">
                      <div className="bg-[var(--bg-surface)] rounded-lg px-3 py-2">
                        <div className="text-[var(--text-dim)]">사용자</div>
                        <div className="text-[var(--text)] font-medium truncate">{r.user_name || "-"} {r.user_email ? `(${r.user_email})` : ""}</div>
                      </div>
                      <div className="bg-[var(--bg-surface)] rounded-lg px-3 py-2">
                        <div className="text-[var(--text-dim)]">작업</div>
                        <div className="text-[var(--text)] font-medium truncate">{r.context?.action ? String(r.context.action) : (SOURCE_LABEL[r.source || ""] || "-")}</div>
                      </div>
                      <div className="bg-[var(--bg-surface)] rounded-lg px-3 py-2">
                        <div className="text-[var(--text-dim)]">발생 시각</div>
                        <div className="text-[var(--text)] font-medium">{new Date(r.created_at).toLocaleString("ko-KR")} ({timeAgo(r.created_at)})</div>
                      </div>
                      <div className="bg-[var(--bg-surface)] rounded-lg px-3 py-2">
                        <div className="text-[var(--text-dim)]">페이지</div>
                        <div className="text-[var(--text)] font-medium truncate">{r.context?.page || r.url || "-"}</div>
                      </div>
                    </div>
                    {/* 원문 */}
                    <div>
                      <div className="text-[11px] font-semibold text-[var(--text-dim)] uppercase mb-1">원본 메시지</div>
                      <pre className="text-[11px] bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 overflow-auto max-h-32 text-[var(--text-muted)] whitespace-pre-wrap">{r.message}</pre>
                    </div>
                    {r.stack && (
                      <div>
                        <div className="text-[11px] font-semibold text-[var(--text-dim)] uppercase mb-1">스택</div>
                        <pre className="text-[10px] bg-[var(--bg)] border border-[var(--border)] rounded-lg p-3 overflow-auto max-h-40 text-[var(--text-dim)] whitespace-pre-wrap">{r.stack}</pre>
                      </div>
                    )}
                    <div className="grid grid-cols-2 gap-2 text-[11px] text-[var(--text-dim)]">
                      <div>유형: <span className="text-[var(--text-muted)] font-mono">{r.error_type}</span></div>
                      <div>회사ID: <span className="text-[var(--text-muted)] font-mono">{r.company_id || "-"}</span></div>
                      <div className="col-span-2 truncate">URL: <span className="text-[var(--text-muted)]">{r.url || "-"}</span></div>
                    </div>
                    <button
                      onClick={() => toggleResolve.mutate({ id: r.id, resolved: !r.resolved })}
                      className={`text-xs px-3 py-1.5 rounded-lg font-semibold transition ${
                        r.resolved
                          ? "bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)]"
                          : "bg-green-500/10 text-green-500 hover:bg-green-500/20"
                      }`}
                    >
                      {r.resolved ? "미해결로 되돌리기" : "✓ 해결 처리"}
                    </button>
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
