"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const db = supabase as any;

type Incident = {
  id: string;
  title: string;
  occurred_at: string;
  resolved_at: string | null;
  severity: "low" | "medium" | "high" | "critical";
  symptoms: string | null;
  root_cause: string | null;
  prevention: string | null;
  related_commit: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

const SEVERITY_TONE = {
  low: "bg-emerald-500/15 text-emerald-300",
  medium: "bg-amber-500/15 text-amber-300",
  high: "bg-orange-500/15 text-orange-300",
  critical: "bg-red-500/20 text-red-300",
} as const;

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

function durationLabel(start: string, end: string | null): string {
  if (!end) return "복구 중";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}시간 ${m}분`;
  return `${m}분`;
}

export default function PlatformIncidentsPage() {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<Partial<Incident> | null>(null);

  const { data: items = [], isLoading } = useQuery<Incident[]>({
    queryKey: ["op-incidents"],
    queryFn: async () => {
      const { data, error } = await db.from("operator_incidents").select("*").order("occurred_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Incident[];
    },
  });

  const upsert = useMutation({
    mutationFn: async (input: Partial<Incident>) => {
      const { data, error } = await db.rpc("operator_upsert_incident", {
        p_id: input.id || null,
        p_title: input.title,
        p_occurred_at: input.occurred_at || null,
        p_resolved_at: input.resolved_at || null,
        p_severity: input.severity || "medium",
        p_symptoms: input.symptoms || null,
        p_root_cause: input.root_cause || null,
        p_prevention: input.prevention || null,
        p_related_commit: input.related_commit || null,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["op-incidents"] });
      setEditing(null);
    },
  });

  return (
    <div className="max-w-5xl">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold text-white">사고 기록</h1>
          <p className="text-sm text-[#64748b] mt-1">
            운영 사고 타임라인 · {items.length}건 (해결 {items.filter((i) => i.resolved_at).length})
          </p>
        </div>
        <button
          onClick={() => setEditing({ severity: "medium", occurred_at: new Date().toISOString() })}
          className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white text-sm font-semibold rounded-lg transition"
        >
          + 신규 사고 기록
        </button>
      </div>

      {editing && (
        <IncidentForm
          value={editing}
          onChange={setEditing}
          onSubmit={() => upsert.mutate(editing)}
          onCancel={() => setEditing(null)}
          pending={upsert.isPending}
          error={(upsert.error as any)?.message}
        />
      )}

      {isLoading && <div className="text-sm text-[#64748b]">불러오는 중…</div>}

      <div className="space-y-3">
        {items.map((i) => (
          <div key={i.id} className={`bg-[#111827] rounded-2xl border ${i.resolved_at ? "border-[#1e293b]" : "border-orange-500/30"} p-5`}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${SEVERITY_TONE[i.severity]}`}>
                    {i.severity.toUpperCase()}
                  </span>
                  {i.resolved_at ? (
                    <span className="text-[10px] text-emerald-400 font-semibold">✓ 해결</span>
                  ) : (
                    <span className="text-[10px] text-orange-400 font-semibold animate-pulse">● 진행</span>
                  )}
                  {i.related_commit && (
                    <span className="text-[10px] font-mono text-[#64748b]">{i.related_commit}</span>
                  )}
                </div>
                <div className="text-base font-bold text-white">{i.title}</div>
                <div className="text-xs text-[#64748b] mt-0.5">
                  {fmtDate(i.occurred_at)} → {fmtDate(i.resolved_at)} ({durationLabel(i.occurred_at, i.resolved_at)})
                </div>
              </div>
              <button
                onClick={() => setEditing(i)}
                className="text-xs text-cyan-400 hover:underline shrink-0"
              >
                수정
              </button>
            </div>
            <div className="space-y-2 mt-3 text-xs">
              {i.symptoms && <Field label="증상" value={i.symptoms} />}
              {i.root_cause && <Field label="근본원인" value={i.root_cause} accent />}
              {i.prevention && <Field label="재발방지" value={i.prevention} />}
            </div>
          </div>
        ))}
      </div>

      <div className="mt-6 bg-cyan-600/5 border border-cyan-600/20 rounded-2xl p-4 text-xs text-[#94a3b8]">
        <span className="text-cyan-400 font-bold">OP-F</span> · 새 사고 발생 시 즉시 기록.
        근본원인·재발방지는 사후 분석 후 갱신. 관련 commit hash로 코드 변경 추적.
      </div>
    </div>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className={`p-3 rounded-lg ${accent ? "bg-cyan-600/10 border border-cyan-600/20" : "bg-[#0b0f1a]"}`}>
      <div className="text-[10px] font-bold text-[#64748b] uppercase tracking-wider mb-1">{label}</div>
      <div className="text-white whitespace-pre-wrap">{value}</div>
    </div>
  );
}

function IncidentForm({
  value, onChange, onSubmit, onCancel, pending, error,
}: {
  value: Partial<Incident>;
  onChange: (v: Partial<Incident>) => void;
  onSubmit: () => void;
  onCancel: () => void;
  pending: boolean;
  error?: string;
}) {
  return (
    <div className="bg-[#111827] rounded-2xl border border-cyan-600/30 p-5 mb-4 space-y-3">
      <div className="text-sm font-bold text-white">{value.id ? "사고 수정" : "신규 사고 기록"}</div>
      <input
        type="text"
        placeholder="제목 *"
        value={value.title || ""}
        onChange={(e) => onChange({ ...value, title: e.target.value })}
        className="w-full px-3 py-2 bg-[#0b0f1a] border border-[#1e293b] rounded-lg text-sm text-white"
      />
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <input
          type="datetime-local"
          value={value.occurred_at ? new Date(value.occurred_at).toISOString().slice(0, 16) : ""}
          onChange={(e) => onChange({ ...value, occurred_at: new Date(e.target.value).toISOString() })}
          className="px-3 py-2 bg-[#0b0f1a] border border-[#1e293b] rounded-lg text-sm text-white"
        />
        <input
          type="datetime-local"
          placeholder="해결시각"
          value={value.resolved_at ? new Date(value.resolved_at).toISOString().slice(0, 16) : ""}
          onChange={(e) => onChange({ ...value, resolved_at: e.target.value ? new Date(e.target.value).toISOString() : null })}
          className="px-3 py-2 bg-[#0b0f1a] border border-[#1e293b] rounded-lg text-sm text-white"
        />
        <select
          value={value.severity || "medium"}
          onChange={(e) => onChange({ ...value, severity: e.target.value as Incident["severity"] })}
          className="px-3 py-2 bg-[#0b0f1a] border border-[#1e293b] rounded-lg text-sm text-white"
        >
          <option value="low">낮음</option>
          <option value="medium">보통</option>
          <option value="high">높음</option>
          <option value="critical">치명</option>
        </select>
      </div>
      <textarea
        rows={2}
        placeholder="증상"
        value={value.symptoms || ""}
        onChange={(e) => onChange({ ...value, symptoms: e.target.value })}
        className="w-full px-3 py-2 bg-[#0b0f1a] border border-[#1e293b] rounded-lg text-sm text-white"
      />
      <textarea
        rows={2}
        placeholder="근본원인"
        value={value.root_cause || ""}
        onChange={(e) => onChange({ ...value, root_cause: e.target.value })}
        className="w-full px-3 py-2 bg-[#0b0f1a] border border-[#1e293b] rounded-lg text-sm text-white"
      />
      <textarea
        rows={2}
        placeholder="재발방지"
        value={value.prevention || ""}
        onChange={(e) => onChange({ ...value, prevention: e.target.value })}
        className="w-full px-3 py-2 bg-[#0b0f1a] border border-[#1e293b] rounded-lg text-sm text-white"
      />
      <input
        type="text"
        placeholder="related commit hash (선택)"
        value={value.related_commit || ""}
        onChange={(e) => onChange({ ...value, related_commit: e.target.value })}
        className="w-full px-3 py-2 bg-[#0b0f1a] border border-[#1e293b] rounded-lg text-sm font-mono text-white"
      />
      {error && <div className="text-xs text-red-400">{error}</div>}
      <div className="flex justify-end gap-2">
        <button onClick={onCancel} className="px-3 py-1.5 bg-[#1e293b] text-[#94a3b8] text-xs rounded-lg">취소</button>
        <button
          onClick={onSubmit}
          disabled={pending || !value.title}
          className="px-4 py-1.5 bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-semibold rounded-lg disabled:opacity-50"
        >
          {pending ? "저장중…" : "저장"}
        </button>
      </div>
    </div>
  );
}
