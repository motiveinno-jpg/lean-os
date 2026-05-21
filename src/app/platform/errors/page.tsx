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
    <div className="max-w-6xl">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white">에러 해석</h1>
          <p className="text-sm text-[#64748b] mt-1">
            최근 {hours}시간 · {errors.length}건 · 코드별 그룹핑 {grouped.length}종
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="px-3 py-2 bg-[#111827] border border-[#1e293b] rounded-lg text-sm text-white"
          >
            <option value={24}>최근 24시간</option>
            <option value={72}>최근 3일</option>
            <option value={168}>최근 7일</option>
          </select>
          <div className="flex gap-1">
            {[
              { k: "all", l: "전체" },
              { k: "unresolved", l: "미해결" },
              { k: "critical", l: "심각" },
            ].map((f) => (
              <button
                key={f.k}
                onClick={() => setFilter(f.k as any)}
                className={`px-3 py-2 rounded-lg text-xs font-semibold transition ${
                  filter === f.k ? "bg-cyan-600 text-white" : "bg-[#1e293b] text-[#94a3b8] hover:text-white"
                }`}
              >
                {f.l}
              </button>
            ))}
          </div>
        </div>
      </div>

      {isLoading && <div className="text-sm text-[#64748b]">불러오는 중…</div>}
      {!isLoading && errors.length === 0 && (
        <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-8 text-center text-sm text-emerald-400">
          🎉 이 기간에 에러 없음.
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* 좌: 코드별 그룹 */}
        <div className="lg:col-span-2 space-y-3">
          {filteredGroups.map((g) => {
            const tone = SEVERITY_TONE[g.explanation.severity];
            const unresolvedCount = g.rows.filter((r) => !r.resolved).length;
            return (
              <div key={g.code} className="bg-[#111827] rounded-2xl border border-[#1e293b] overflow-hidden">
                <div className="px-5 py-3 border-b border-[#1e293b] flex items-center justify-between">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${tone.bg} ${tone.text}`}>
                      {tone.label}
                    </span>
                    <span className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider">
                      {CATEGORY_LABEL[g.explanation.category]}
                    </span>
                    <span className="text-xs font-mono text-[#94a3b8]">{g.code}</span>
                    <span className="text-xs text-white font-bold">
                      {g.rows.length}회{unresolvedCount > 0 && ` (미해결 ${unresolvedCount})`}
                    </span>
                  </div>
                </div>
                <div className="px-5 py-4 bg-[#0b0f1a]/60">
                  <div className="text-sm text-white font-semibold mb-1">{g.explanation.what}</div>
                  <div className="text-xs text-[#94a3b8] mb-1">
                    <span className="text-[#64748b]">왜 났을까?</span> {g.explanation.why}
                  </div>
                  <div className="text-xs text-cyan-300">
                    <span className="text-[#64748b]">어떻게 고치나?</span> {g.explanation.fix}
                  </div>
                </div>
                <div className="divide-y divide-[#1e293b]">
                  {g.rows.slice(0, 5).map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedId(r.id)}
                      className={`w-full text-left px-5 py-2.5 hover:bg-[#1e293b]/50 transition ${
                        selectedId === r.id ? "bg-cyan-600/10" : ""
                      }`}
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div className="text-[11px] text-[#94a3b8] truncate flex-1">
                          {r.company_name || "(no company)"} · {r.user_email || r.user_name || "—"} · {r.url || r.source || "?"}
                        </div>
                        <div className="text-[10px] text-[#64748b] shrink-0">
                          {fmtRelative(r.created_at)}
                          {r.resolved && <span className="ml-2 text-emerald-400">✓ 해결</span>}
                        </div>
                      </div>
                      <div className="text-[11px] text-[#64748b] truncate mt-0.5">{r.message}</div>
                    </button>
                  ))}
                  {g.rows.length > 5 && (
                    <div className="px-5 py-2 text-[11px] text-[#64748b] text-center">
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
            <div className="bg-[#111827] rounded-2xl border border-cyan-600/30 p-5 sticky top-4">
              <div className="flex items-center justify-between mb-3">
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${SEVERITY_TONE[selectedExp.severity].bg} ${SEVERITY_TONE[selectedExp.severity].text}`}>
                  {SEVERITY_TONE[selectedExp.severity].label}
                </span>
                <button
                  onClick={() => resolve.mutate({ id: selected.id, resolved: !selected.resolved })}
                  disabled={resolve.isPending}
                  className={`text-[11px] font-semibold px-2 py-1 rounded ${
                    selected.resolved
                      ? "bg-[#1e293b] text-[#64748b]"
                      : "bg-emerald-600 text-white hover:bg-emerald-500"
                  } disabled:opacity-50`}
                >
                  {selected.resolved ? "↺ 미해결로" : "✓ 해결로"}
                </button>
              </div>
              <div className="text-xs text-[#64748b] mb-2">{selectedExp.code}</div>
              <div className="text-base text-white font-bold mb-2">{selectedExp.what}</div>
              <div className="text-xs text-[#94a3b8] mb-3">
                <div className="text-[#64748b] font-semibold">왜 났을까?</div>
                <div className="mt-0.5">{selectedExp.why}</div>
              </div>
              <div className="text-xs text-cyan-200 mb-4">
                <div className="text-[#64748b] font-semibold">어떻게 고치나?</div>
                <div className="mt-0.5">{selectedExp.fix}</div>
              </div>

              <div className="border-t border-[#1e293b] pt-3 space-y-2 text-[11px]">
                <Row label="회사" value={selected.company_name || "—"} />
                <Row label="사용자" value={selected.user_email || selected.user_name || "—"} />
                <Row label="URL" value={selected.url || "—"} />
                <Row label="소스" value={selected.source || "—"} />
                <Row label="시각" value={new Date(selected.created_at).toLocaleString("ko-KR")} />
              </div>

              <details className="mt-3">
                <summary className="text-[11px] text-cyan-400 cursor-pointer">원문 메시지</summary>
                <pre className="mt-2 p-2 bg-[#0b0f1a] rounded-lg text-[10px] text-[#94a3b8] overflow-auto whitespace-pre-wrap break-words max-h-40">
                  {selected.message}
                </pre>
              </details>
              {selected.stack && (
                <details className="mt-2">
                  <summary className="text-[11px] text-cyan-400 cursor-pointer">스택트레이스</summary>
                  <pre className="mt-2 p-2 bg-[#0b0f1a] rounded-lg text-[10px] text-[#64748b] overflow-auto whitespace-pre max-h-60">
                    {selected.stack}
                  </pre>
                </details>
              )}
            </div>
          ) : (
            <div className="bg-[#111827] rounded-2xl border border-[#1e293b] p-8 text-center text-sm text-[#64748b]">
              왼쪽에서 에러를 선택하면 상세 해석이 표시됩니다.
            </div>
          )}
        </div>
      </div>

      <div className="mt-6 bg-cyan-600/5 border border-cyan-600/20 rounded-2xl p-4 text-xs text-[#94a3b8]">
        <span className="text-cyan-400 font-bold">OP-E</span> · 코드 매핑은{" "}
        <span className="font-mono text-cyan-300">src/lib/operator-error-explain.ts</span> 에 누적.
        새 패턴 발생 시 같은 파일에 PG/PostgREST/CODEF/Stripe/Generic 섹션 중 알맞은 곳에 추가.
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="w-12 shrink-0 text-[#64748b]">{label}</div>
      <div className="text-white break-all">{value}</div>
    </div>
  );
}
