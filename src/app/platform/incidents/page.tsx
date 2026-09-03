"use client";
// 사고 기록 — 2026-09-03 v2 pf 디자인. 조회·저장 RPC(operator_upsert_incident)와 폼 로직은 그대로.
import { SystemTabs } from "../_components/system-tabs";

import { useState } from "react";
import { DateTimeField } from "@/components/datetime-field";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { PfPage, PfPageHead, PfCard, PfCardHead, PfCardBody, PfKpi, PfBadge, PfSkeleton, PfEmpty } from "../_components/pf/ui";

const db = supabase;

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

const SEVERITY_LABEL: Record<Incident["severity"], string> = { low: "낮음", medium: "보통", high: "높음", critical: "치명" };
const SEVERITY_BADGE: Record<Incident["severity"], "ok" | "warn" | "danger"> = { low: "ok", medium: "warn", high: "danger", critical: "danger" };

function fmtDate(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString("ko-KR", { dateStyle: "medium", timeStyle: "short" });
}

// DateTimeField 는 로컬 벽시계("YYYY-MM-DDTHH:MM")를 주고받는다.
//   저장값(ISO/UTC)을 폼에 넣을 땐 toISOString(UTC) 이 아니라 로컬 시각으로 변환해야
//   KST(+9) 기준 9시간 밀림이 생기지 않는다. (증상: 폼 열고 저장만 해도 시각이 밀림)
function toLocalInput(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function fromLocalInput(local: string): string | null {
  if (!local) return null;
  const d = new Date(local); // 로컬 벽시계로 파싱 → 내부 UTC 타임스탬프
  if (isNaN(d.getTime())) return null;
  return d.toISOString();
}

function durationLabel(start: string, end: string | null): string {
  if (!end) return "복구 중";
  const ms = new Date(end).getTime() - new Date(start).getTime();
  if (ms < 0) return "시간 오류"; // 해결시각이 발생시각보다 앞선 입력 실수 방어
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
        p_id: input.id || undefined,
        p_title: input.title,
        p_occurred_at: input.occurred_at || undefined,
        p_resolved_at: input.resolved_at || undefined,
        p_severity: input.severity || "medium",
        p_symptoms: input.symptoms || undefined,
        p_root_cause: input.root_cause || undefined,
        p_prevention: input.prevention || undefined,
        p_related_commit: input.related_commit || undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["op-incidents"] });
      setEditing(null);
    },
  });

  const resolvedCount = items.filter((i) => i.resolved_at).length;
  const openCount = items.length - resolvedCount;
  const criticalCount = items.filter((i) => i.severity === "critical" || i.severity === "high").length;

  return (
    <PfPage>
      <PfPageHead
        eyebrow="운영"
        title="사고 기록"
        desc="서비스에 문제가 생겼던 일을 기록해 둡니다. 사고가 나면 바로 적고, 원인과 재발 방지책은 정리된 뒤에 채우세요."
        actions={
          <button
            type="button"
            onClick={() => setEditing({ severity: "medium", occurred_at: new Date().toISOString() })}
            className="pf-btn pf-btn-primary"
          >
            + 새 사고 기록
          </button>
        }
      />
      <SystemTabs />

      <div className="pf-kpi-grid">
        <PfCard i={2} className="pf-kpi-tile"><PfKpi label="전체 사고" value={items.length} unit="건" /></PfCard>
        <PfCard i={3} className="pf-kpi-tile"><PfKpi label="복구 중" value={openCount} unit="건" accent={openCount > 0} live={openCount > 0} /></PfCard>
        <PfCard i={4} className="pf-kpi-tile"><PfKpi label="해결됨" value={resolvedCount} unit="건" /></PfCard>
        <PfCard i={5} className="pf-kpi-tile"><PfKpi label="높음 이상" value={criticalCount} unit="건" /></PfCard>
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

      {isLoading && <PfCard i={6}><PfCardBody className="pt-5"><PfSkeleton rows={4} h={16} /></PfCardBody></PfCard>}

      {!isLoading && items.length === 0 && (
        <PfCard i={6}><PfEmpty ok>기록된 사고가 없습니다. 오른쪽 위 버튼으로 첫 사고를 기록하세요.</PfEmpty></PfCard>
      )}

      <div className="space-y-3">
        {items.map((i, idx) => (
          <PfCard key={i.id} i={6 + idx} hover={false} className={i.resolved_at ? "" : "ring-1 ring-[#D97706]/40"}>
            <PfCardHead
              title={
                <span className="flex items-center gap-2 flex-wrap">
                  <PfBadge tone={SEVERITY_BADGE[i.severity]}>{SEVERITY_LABEL[i.severity]}</PfBadge>
                  {i.resolved_at
                    ? <PfBadge tone="ok">✓ 해결</PfBadge>
                    : <PfBadge tone="warn"><span className="pf-live" style={{ background: "#D97706" }} /> 복구 중</PfBadge>}
                  {i.related_commit && <span className="text-[10px] font-mono text-[var(--text-dim)]">{i.related_commit}</span>}
                </span>
              }
              action={<button type="button" onClick={() => setEditing(i)} className="pf-btn pf-btn-sm">수정</button>}
            />
            <PfCardBody>
              <div className="text-[15px] font-bold text-[var(--text)] leading-snug">{i.title}</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-1 mono-number">
                {fmtDate(i.occurred_at)} → {fmtDate(i.resolved_at)} <span className="font-semibold text-[var(--text-muted)]">({durationLabel(i.occurred_at, i.resolved_at)})</span>
              </div>
              {(i.symptoms || i.root_cause || i.prevention) && (
                <div className="grid grid-cols-1 md:grid-cols-3 gap-2 mt-3 text-[12px]">
                  {i.symptoms && <Field label="무슨 일이" value={i.symptoms} />}
                  {i.root_cause && <Field label="왜 났나" value={i.root_cause} accent />}
                  {i.prevention && <Field label="다시 안 나게" value={i.prevention} />}
                </div>
              )}
            </PfCardBody>
          </PfCard>
        ))}
      </div>
    </PfPage>
  );
}

function Field({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="rounded-xl px-3 py-2" style={accent ? { background: "color-mix(in oklab, var(--primary) 8%, transparent)" } : { background: "var(--bg-surface)" }}>
      <div className={`text-[10px] font-bold mb-0.5 ${accent ? "text-[var(--primary)]" : "text-[var(--text-dim)]"}`}>{label}</div>
      <div className="text-[var(--text)] whitespace-pre-wrap leading-relaxed">{value}</div>
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
    <PfCard i={6} hover={false}>
      <PfCardHead title={value.id ? "사고 수정" : "새 사고 기록"} sub="제목만 있어도 저장됩니다. 나머지는 나중에 채워도 돼요." />
      <PfCardBody className="space-y-3">
        <input
          type="text"
          placeholder="제목 *"
          value={value.title || ""}
          onChange={(e) => onChange({ ...value, title: e.target.value })}
          className="field-input-sm text-sm"
        />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <DateTimeField
            value={toLocalInput(value.occurred_at)}
            onChange={(e) => onChange({ ...value, occurred_at: fromLocalInput(e.target.value) ?? undefined })}
            className="field-input-sm text-sm"
          />
          <DateTimeField
            placeholder="해결시각"
            value={toLocalInput(value.resolved_at)}
            onChange={(e) => onChange({ ...value, resolved_at: fromLocalInput(e.target.value) })}
            className="field-input-sm text-sm"
          />
          <select
            value={value.severity || "medium"}
            onChange={(e) => onChange({ ...value, severity: e.target.value as Incident["severity"] })}
            className="field-input-sm text-sm"
          >
            <option value="low">낮음</option>
            <option value="medium">보통</option>
            <option value="high">높음</option>
            <option value="critical">치명</option>
          </select>
        </div>
        <textarea
          rows={2}
          placeholder="무슨 일이 있었나 (증상)"
          value={value.symptoms || ""}
          onChange={(e) => onChange({ ...value, symptoms: e.target.value })}
          className="field-input-sm text-sm"
        />
        <textarea
          rows={2}
          placeholder="왜 났나 (근본 원인)"
          value={value.root_cause || ""}
          onChange={(e) => onChange({ ...value, root_cause: e.target.value })}
          className="field-input-sm text-sm"
        />
        <textarea
          rows={2}
          placeholder="다시 안 나게 (재발 방지)"
          value={value.prevention || ""}
          onChange={(e) => onChange({ ...value, prevention: e.target.value })}
          className="field-input-sm text-sm"
        />
        <input
          type="text"
          placeholder="관련 코드 변경 기록 (선택)"
          value={value.related_commit || ""}
          onChange={(e) => onChange({ ...value, related_commit: e.target.value })}
          className="field-input-sm text-sm font-mono"
        />
        {error && <div className="text-xs text-[var(--danger)]">{error}</div>}
        <div className="flex justify-end gap-2">
          <button type="button" onClick={onCancel} className="pf-btn pf-btn-ghost">취소</button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={pending || !value.title}
            className="pf-btn pf-btn-primary disabled:opacity-40"
          >
            {pending ? "저장 중…" : "저장"}
          </button>
        </div>
      </PfCardBody>
    </PfCard>
  );
}
