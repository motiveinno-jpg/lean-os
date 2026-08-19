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

function SelectWithAdd({ label, value, options, onChange, onAdd, addPlaceholder }: {
  label: string; value: string; options: string[];
  onChange: (v: string) => void;
  onAdd: (name: string) => Promise<void>;
  addPlaceholder: string;
}) {
  const [adding, setAdding] = useState(false);
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

  return (
    <div>
      <div className="text-[10px] text-[var(--text-dim)] font-medium mb-0.5">{label}</div>
      {adding ? (
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
            onChange(e.target.value);
          }}>
          <option value="">선택 안 함</option>
          {opts.map((o) => <option key={o} value={o}>{o}</option>)}
          <option value={ADD_SENTINEL}>＋ 직접 추가…</option>
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
      }} />
  );
}
