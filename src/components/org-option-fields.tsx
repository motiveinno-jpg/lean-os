"use client";

// 부서·직책 선택 필드 (2026-08-19 사장님: "하나하나 입력하기 번거로우니 목록에서 고르고,
//   기본 목록 + 추가도 가능하게").
// - 부서: settings > 부서 관리와 같은 departments 테이블을 목록으로 사용, 없으면 즉석 추가(테이블 insert)
// - 직책: company_settings.settings.position_options (jsonb) — 기본 목록 제공, 즉석 추가 시 저장
// - 목록에 없는 기존 값(자유입력 시절 데이터)도 옵션으로 노출해 저장값이 사라져 보이지 않게 한다.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { logRead } from "@/lib/log-read";

const DEFAULT_POSITIONS = ["대표", "이사", "부장", "차장", "과장", "대리", "주임", "사원"];

const FIELD_CLS = "w-full px-2 py-1.5 bg-[var(--bg)] border border-[var(--border)] rounded-lg text-xs focus:outline-none focus:border-[var(--primary)]";
const ADD_SENTINEL = "__add__";
const MANAGE_SENTINEL = "__manage__";

function useDepartmentOptions(companyId: string | null) {
  return useQuery({
    queryKey: ["departments", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const data = logRead("components/org-option-fields:data", await supabase
        .from("departments").select("id, name, sort_order, archived_at")
        .eq("company_id", companyId!).order("sort_order"));
      return ((data || []) as { name: string; archived_at: string | null }[])
        .filter((d) => !d.archived_at).map((d) => d.name);
    },
  });
}

function usePositionOptions(companyId: string | null) {
  return useQuery({
    queryKey: ["position-options", companyId],
    enabled: !!companyId,
    staleTime: 60_000,
    queryFn: async () => {
      const { data } = await supabase.from("company_settings").select("settings").eq("company_id", companyId!).maybeSingle();
      const list = (data?.settings as Record<string, unknown> | null)?.position_options;
      return Array.isArray(list) && list.length > 0 ? (list as string[]) : DEFAULT_POSITIONS;
    },
  });
}

function SelectWithAdd({ label, value, options, onChange, onAdd, onRemove, addPlaceholder }: {
  label: string; value: string; options: string[];
  onChange: (v: string) => void;
  onAdd: (name: string) => Promise<void>;
  onRemove: (name: string) => Promise<void>;
  addPlaceholder: string;
}) {
  const [adding, setAdding] = useState(false);
  const [managing, setManaging] = useState(false);
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  // 자유입력 시절 저장값이 목록에 없으면 옵션으로 함께 노출
  const opts = value && !options.includes(value) ? [value, ...options] : options;

  const submitAdd = async () => {
    const name = draft.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      await onAdd(name);
      onChange(name);
      setAdding(false);
      setDraft("");
    } finally {
      setSaving(false);
    }
  };

  // 삭제는 목록에서만 뺀다 — 이미 저장된 직원 값은 그대로 두고, 화면에선 '목록에 없는 값' 폴백으로 계속 보인다.
  const removeOne = async (name: string) => {
    if (saving) return;
    setSaving(true);
    try { await onRemove(name); } finally { setSaving(false); }
  };

  return (
    <div>
      <div className="text-[10px] text-[var(--text-dim)] font-medium mb-0.5">{label}</div>
      {managing ? (
        <div className="border border-[var(--border)] rounded-lg p-1.5 space-y-1 bg-[var(--bg)]">
          {options.length === 0 && (
            <div className="text-[11px] text-[var(--text-dim)] px-1 py-0.5">삭제할 항목이 없습니다</div>
          )}
          {options.map((o) => (
            <div key={o} className="flex items-center justify-between gap-2 px-1">
              <span className="text-xs truncate">{o}</span>
              <button type="button" onClick={() => removeOne(o)} disabled={saving}
                title="목록에서 삭제 (이미 지정된 직원의 값은 유지)"
                className="text-[11px] text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded px-1.5 py-0.5 shrink-0">✕</button>
            </div>
          ))}
          <div className="flex justify-end pt-0.5">
            <button type="button" onClick={() => setManaging(false)}
              className="px-2 py-1 text-[11px] text-[var(--text-muted)] rounded-lg">닫기</button>
          </div>
        </div>
      ) : adding ? (
        <div className="flex gap-1">
          <input autoFocus value={draft} onChange={(e) => setDraft(e.target.value)} placeholder={addPlaceholder}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); submitAdd(); } if (e.key === "Escape") setAdding(false); }}
            className={FIELD_CLS} />
          <button type="button" onClick={submitAdd} disabled={saving}
            className="px-2 py-1.5 text-[11px] font-semibold text-[var(--primary)] bg-[var(--primary)]/10 rounded-lg shrink-0">추가</button>
          <button type="button" onClick={() => { setAdding(false); setDraft(""); }}
            className="px-2 py-1.5 text-[11px] text-[var(--text-muted)] rounded-lg shrink-0">취소</button>
        </div>
      ) : (
        <select value={value || ""} className={FIELD_CLS}
          onChange={(e) => {
            if (e.target.value === ADD_SENTINEL) { setAdding(true); return; }
            if (e.target.value === MANAGE_SENTINEL) { setManaging(true); return; }
            onChange(e.target.value);
          }}>
          <option value="">선택 안 함</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value={ADD_SENTINEL}>＋ 직접 추가…</option>
          <option value={MANAGE_SENTINEL}>－ 목록에서 삭제…</option>
        </select>
      )}
    </div>
  );
}

export function DepartmentField({ companyId, value, onChange, label = "부서" }: {
  companyId: string | null; value: string; onChange: (v: string) => void; label?: string;
}) {
  const { data: options = [] } = useDepartmentOptions(companyId);
  const qc = useQueryClient();
  const { toast } = useToast();
  return (
    <SelectWithAdd label={label} value={value} options={options} onChange={onChange} addPlaceholder="새 부서 이름"
      onAdd={async (name) => {
        // settings > 부서 관리와 같은 테이블 — 여기서 추가해도 그 화면에 같이 보인다.
        const nextOrder = options.length;
        const { error } = await supabase.from("departments").insert({ company_id: companyId as string, name, sort_order: nextOrder });
        if (error && (error as { code?: string }).code !== "23505") { toast(`부서 추가 실패: ${error.message}`, "error"); throw error; }
        qc.invalidateQueries({ queryKey: ["departments", companyId] });
        qc.invalidateQueries({ queryKey: ["settings-departments", companyId] });
      }}
      onRemove={async (name) => {
        // 설정 > 부서 관리와 같은 소프트 삭제 — 그 화면의 '보관됨' 목록에서 복원 가능
        const { error } = await supabase.from("departments")
          .update({ archived_at: new Date().toISOString() })
          .eq("company_id", companyId as string).eq("name", name).is("archived_at", null);
        if (error) { toast(`부서 삭제 실패: ${error.message}`, "error"); throw error; }
        qc.invalidateQueries({ queryKey: ["departments", companyId] });
        qc.invalidateQueries({ queryKey: ["settings-departments", companyId] });
      }} />
  );
}

export function PositionField({ companyId, value, onChange, label = "직책" }: {
  companyId: string | null; value: string; onChange: (v: string) => void; label?: string;
}) {
  const { data: options = DEFAULT_POSITIONS } = usePositionOptions(companyId);
  const qc = useQueryClient();
  const { toast } = useToast();
  return (
    <SelectWithAdd label={label} value={value} options={options} onChange={onChange} addPlaceholder="새 직책 이름"
      onAdd={async (name) => {
        if (options.includes(name)) return;
        // 다른 settings 키 보존 병합 — position_options 만 갱신
        const { data: row } = await supabase.from("company_settings").select("settings").eq("company_id", companyId!).maybeSingle();
        const merged = { ...((row?.settings as Record<string, unknown>) || {}), position_options: [...options, name] };
        const { error } = await supabase.from("company_settings")
          .upsert({ company_id: companyId as string, settings: merged }, { onConflict: "company_id" });
        if (error) { toast(`직책 추가 실패: ${error.message}`, "error"); throw error; }
        qc.invalidateQueries({ queryKey: ["position-options", companyId] });
      }}
      onRemove={async (name) => {
        const { data: row } = await supabase.from("company_settings").select("settings").eq("company_id", companyId!).maybeSingle();
        const merged = { ...((row?.settings as Record<string, unknown>) || {}), position_options: options.filter((o) => o !== name) };
        const { error } = await supabase.from("company_settings")
          .upsert({ company_id: companyId as string, settings: merged }, { onConflict: "company_id" });
        if (error) { toast(`직책 삭제 실패: ${error.message}`, "error"); throw error; }
        qc.invalidateQueries({ queryKey: ["position-options", companyId] });
      }} />
  );
}
