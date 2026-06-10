"use client";

// 2026-06-10 프로젝트 Monday.com 스타일 보드 (Phase 2 UI).
//   행 = deals(재무 연동 보존), 컬럼 = board_columns(커스텀), 셀 = deals.column_values[colId].
//   그룹 = board_groups. 첫 진입 시 기본 컬럼/그룹 자동 생성(lazy init). 표시·편집 전용, 재무 무변경.
//   타입: text|status|date|person|number. (priority 는 status 동일 렌더)

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Col = { id: string; name: string; type: string; settings: any; position: number };
type Grp = { id: string; name: string; color: string; position: number };
type Deal = { id: string; name: string; board_group_id: string | null; column_values: Record<string, any>; contract_total?: number | null };
type Person = { id: string; name: string | null; email: string };

const STATUS_PALETTE = ["#1FAE6B", "#2F7DE1", "#E0A33A", "#E0524F", "#8B5CF6", "#5E8C92", "#9AA1AC"];

const DEFAULT_COLUMNS: { name: string; type: string; settings: any }[] = [
  { name: "담당자", type: "person", settings: {} },
  { name: "진행상태", type: "status", settings: { options: [
    { id: "todo", label: "준비", color: "#9AA1AC" },
    { id: "doing", label: "진행중", color: "#2F7DE1" },
    { id: "done", label: "완료", color: "#1FAE6B" },
    { id: "hold", label: "보류", color: "#E0A33A" },
  ] } },
  { name: "우선순위", type: "status", settings: { options: [
    { id: "high", label: "높음", color: "#E0524F" },
    { id: "mid", label: "보통", color: "#E0A33A" },
    { id: "low", label: "낮음", color: "#9AA1AC" },
  ] } },
  { name: "계약일", type: "date", settings: {} },
  { name: "계약금액", type: "number", settings: {} },
];

export function MondayBoard({ companyId, users = [] }: { companyId: string; users?: Person[] }) {
  const qc = useQueryClient();
  const initRef = useRef(false);

  const { data: columns = [], isFetched: colsFetched } = useQuery<Col[]>({
    queryKey: ["board-columns", companyId],
    queryFn: async () => {
      const { data } = await db.from("board_columns").select("*").eq("company_id", companyId).order("position");
      return (data || []) as Col[];
    },
    enabled: !!companyId,
  });
  const { data: groups = [], isFetched: groupsFetched } = useQuery<Grp[]>({
    queryKey: ["board-groups", companyId],
    queryFn: async () => {
      const { data } = await db.from("board_groups").select("*").eq("company_id", companyId).order("position");
      return (data || []) as Grp[];
    },
    enabled: !!companyId,
  });
  const { data: deals = [] } = useQuery<Deal[]>({
    queryKey: ["board-deals", companyId],
    queryFn: async () => {
      const { data } = await db.from("deals").select("id, name, board_group_id, column_values, contract_total").eq("company_id", companyId).order("created_at", { ascending: true });
      return (data || []).map((d: any) => ({ ...d, column_values: d.column_values || {} })) as Deal[];
    },
    enabled: !!companyId,
  });

  // ── lazy init: 쿼리 settled 후 기본 컬럼/그룹 없으면 생성 (로딩 중 빈 [] 로 중복생성 방지) ──
  useEffect(() => {
    if (!companyId || initRef.current || !colsFetched || !groupsFetched) return;
    initRef.current = true;
    (async () => {
      let changed = false;
      if (columns.length === 0) {
        await db.from("board_columns").insert(DEFAULT_COLUMNS.map((c, i) => ({ company_id: companyId, name: c.name, type: c.type, settings: c.settings, position: i })));
        changed = true;
      }
      if (groups.length === 0) {
        const { data: g } = await db.from("board_groups").insert({ company_id: companyId, name: "프로젝트", color: "#4F46E5", position: 0 }).select("id").maybeSingle();
        if (g?.id) await db.from("deals").update({ board_group_id: g.id }).eq("company_id", companyId).is("board_group_id", null);
        changed = true;
      }
      if (changed) {
        qc.invalidateQueries({ queryKey: ["board-columns", companyId] });
        qc.invalidateQueries({ queryKey: ["board-groups", companyId] });
        qc.invalidateQueries({ queryKey: ["board-deals", companyId] });
      }
    })();
  }, [companyId, colsFetched, groupsFetched, columns.length, groups.length, qc]);

  const refetchAll = () => {
    qc.invalidateQueries({ queryKey: ["board-deals", companyId] });
    qc.invalidateQueries({ queryKey: ["board-columns", companyId] });
    qc.invalidateQueries({ queryKey: ["board-groups", companyId] });
  };

  const dealsByGroup = useMemo(() => {
    const m = new Map<string | null, Deal[]>();
    for (const d of deals) {
      const k = d.board_group_id ?? null;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(d);
    }
    return m;
  }, [deals]);

  // ── 셀 값 저장 ──
  const setCell = async (deal: Deal, colId: string, value: any) => {
    const next = { ...(deal.column_values || {}), [colId]: value };
    await db.from("deals").update({ column_values: next }).eq("id", deal.id);
    refetchAll();
  };
  const setName = async (deal: Deal, name: string) => {
    if (name === deal.name) return;
    await db.from("deals").update({ name }).eq("id", deal.id);
    refetchAll();
  };

  // ── 추가/삭제 ──
  const addColumn = async (type: string) => {
    const name = { text: "텍스트", status: "상태", date: "날짜", person: "담당자", number: "숫자" }[type] || "컬럼";
    const settings = (type === "status")
      ? { options: [{ id: "opt1", label: "옵션1", color: STATUS_PALETTE[0] }, { id: "opt2", label: "옵션2", color: STATUS_PALETTE[2] }] }
      : {};
    await db.from("board_columns").insert({ company_id: companyId, name, type, settings, position: columns.length });
    refetchAll();
  };
  const renameColumn = async (col: Col, name: string) => {
    if (!name.trim() || name === col.name) return;
    await db.from("board_columns").update({ name: name.trim() }).eq("id", col.id);
    refetchAll();
  };
  const deleteColumn = async (col: Col) => {
    if (!confirm(`컬럼 "${col.name}" 삭제? (각 항목의 이 값도 사라집니다)`)) return;
    await db.from("board_columns").delete().eq("id", col.id);
    refetchAll();
  };
  const addGroup = async () => {
    await db.from("board_groups").insert({ company_id: companyId, name: "새 그룹", color: STATUS_PALETTE[Math.min(groups.length, 5)], position: groups.length });
    refetchAll();
  };
  const renameGroup = async (g: Grp, name: string) => {
    if (!name.trim() || name === g.name) return;
    await db.from("board_groups").update({ name: name.trim() }).eq("id", g.id);
    refetchAll();
  };
  const addItem = async (groupId: string | null) => {
    // status/stage 는 deals 기본값(active/estimate) 적용. name NOT NULL 만 채움.
    await db.from("deals").insert({ company_id: companyId, name: "새 항목", board_group_id: groupId, column_values: {} });
    refetchAll();
  };

  const orderedGroups: (Grp | null)[] = [...groups];
  // 그룹 미지정 deal 이 있으면 맨 끝에 "그룹 없음" 섹션
  if (dealsByGroup.has(null)) orderedGroups.push(null);

  return (
    <div className="space-y-6 pb-10">
      <div className="flex items-center justify-end gap-2">
        <button onClick={addGroup} className="px-3 py-1.5 rounded-lg text-xs font-semibold bg-[var(--bg-surface)] text-[var(--text-muted)] hover:text-[var(--text)] border border-[var(--border)]">+ 그룹</button>
      </div>

      {orderedGroups.map((g) => {
        const gid = g?.id ?? null;
        const rows = dealsByGroup.get(gid) || [];
        const color = g?.color || "#9AA1AC";
        return (
          <div key={gid ?? "none"} className="glass-card overflow-hidden">
            {/* 그룹 헤더 */}
            <div className="flex items-center gap-2 px-4 py-2.5 border-b border-[var(--border)]" style={{ borderLeft: `4px solid ${color}` }}>
              <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
              {g ? (
                <EditableText value={g.name} onSave={(v) => renameGroup(g, v)} className="text-sm font-bold text-[var(--text)]" />
              ) : (
                <span className="text-sm font-bold text-[var(--text-muted)]">그룹 없음</span>
              )}
              <span className="text-[11px] text-[var(--text-dim)]">· {rows.length}건</span>
            </div>
            {/* 표 */}
            <div className="overflow-x-auto">
              <table className="w-full border-collapse" style={{ minWidth: 640 }}>
                <thead>
                  <tr className="bg-[var(--bg-surface)]">
                    <th className="text-left px-3 py-2 text-[11px] font-semibold text-[var(--text-muted)] sticky left-0 bg-[var(--bg-surface)] min-w-[180px]">업체명</th>
                    {columns.map((c) => (
                      <th key={c.id} className="px-3 py-2 text-[11px] font-semibold text-[var(--text-muted)] whitespace-nowrap group/col min-w-[110px]">
                        <span className="inline-flex items-center gap-1">
                          <EditableText value={c.name} onSave={(v) => renameColumn(c, v)} className="text-[11px] font-semibold text-[var(--text-muted)]" />
                          <button onClick={() => deleteColumn(c)} className="opacity-0 group-hover/col:opacity-60 hover:!opacity-100 text-[var(--text-dim)] text-[10px]" title="컬럼 삭제">✕</button>
                        </span>
                      </th>
                    ))}
                    <th className="px-2 py-2 w-10">
                      <AddColumnButton onAdd={addColumn} />
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((d) => (
                    <tr key={d.id} className="border-t border-[var(--border)]/60 hover:bg-[var(--bg-surface)]/40">
                      <td className="px-3 py-1.5 sticky left-0 bg-[var(--bg-card)]">
                        <EditableText value={d.name} onSave={(v) => setName(d, v)} className="text-sm text-[var(--text)] font-medium" placeholder="업체명" />
                      </td>
                      {columns.map((c) => (
                        <td key={c.id} className="px-1 py-1 text-center align-middle">
                          <Cell col={c} value={d.column_values?.[c.id]} users={users} onChange={(v) => setCell(d, c.id, v)} />
                        </td>
                      ))}
                      <td />
                    </tr>
                  ))}
                  <tr className="border-t border-[var(--border)]/60">
                    <td className="px-3 py-1.5 sticky left-0 bg-[var(--bg-card)]">
                      <button onClick={() => addItem(gid)} className="text-[12px] text-[var(--text-dim)] hover:text-[var(--primary)]">+ 항목 추가</button>
                    </td>
                    <td colSpan={columns.length + 1} />
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── 셀 (타입별) ──
function Cell({ col, value, users, onChange }: { col: Col; value: any; users: Person[]; onChange: (v: any) => void }) {
  if (col.type === "status") {
    const options: { id: string; label: string; color: string }[] = col.settings?.options || [];
    const cur = options.find((o) => o.id === value);
    return <StatusCell options={options} current={cur} onPick={(id) => onChange(id)} />;
  }
  if (col.type === "person") {
    return (
      <select value={value || ""} onChange={(e) => onChange(e.target.value || null)}
        className="w-full text-xs bg-transparent text-[var(--text)] text-center cursor-pointer focus:outline-none">
        <option value="">—</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name || u.email}</option>)}
      </select>
    );
  }
  if (col.type === "date") {
    return <input type="date" value={value || ""} onChange={(e) => onChange(e.target.value || null)}
      className="w-full text-xs bg-transparent text-[var(--text)] text-center focus:outline-none cursor-pointer" />;
  }
  if (col.type === "number") {
    return <input type="number" value={value ?? ""} onChange={(e) => onChange(e.target.value === "" ? null : Number(e.target.value))}
      className="w-full text-xs bg-transparent text-[var(--text)] text-right px-2 mono-number focus:outline-none" />;
  }
  // text
  return <EditableText value={value || ""} onSave={onChange} className="text-xs text-[var(--text)]" placeholder="—" center />;
}

function StatusCell({ options, current, onPick }: { options: { id: string; label: string; color: string }[]; current?: { id: string; label: string; color: string }; onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)}
        className="w-full min-w-[90px] px-2 py-1.5 rounded text-[11px] font-semibold text-white transition"
        style={{ background: current?.color || "var(--bg-surface)", color: current ? "#fff" : "var(--text-dim)" }}>
        {current?.label || "—"}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 left-1/2 -translate-x-1/2 min-w-[120px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-lg p-1">
            {options.map((o) => (
              <button key={o.id} onClick={() => { onPick(o.id); setOpen(false); }}
                className="w-full px-2 py-1.5 rounded text-[11px] font-semibold text-white text-left mb-0.5" style={{ background: o.color }}>
                {o.label}
              </button>
            ))}
            <button onClick={() => { onPick(""); setOpen(false); }} className="w-full px-2 py-1 rounded text-[11px] text-[var(--text-dim)] hover:bg-[var(--bg-surface)]">지우기</button>
          </div>
        </>
      )}
    </div>
  );
}

function AddColumnButton({ onAdd }: { onAdd: (type: string) => void }) {
  const [open, setOpen] = useState(false);
  const TYPES: { t: string; label: string }[] = [
    { t: "status", label: "🟢 상태" }, { t: "text", label: "🔤 텍스트" }, { t: "person", label: "👤 담당자" },
    { t: "date", label: "📅 날짜" }, { t: "number", label: "🔢 숫자" },
  ];
  return (
    <div className="relative">
      <button onClick={() => setOpen((v) => !v)} className="w-7 h-7 rounded-lg text-[var(--text-dim)] hover:text-[var(--primary)] hover:bg-[var(--bg-surface)] text-base" title="컬럼 추가">+</button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 right-0 min-w-[130px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-lg p-1">
            <div className="text-[10px] text-[var(--text-dim)] px-2 py-1 font-semibold">컬럼 타입</div>
            {TYPES.map((x) => (
              <button key={x.t} onClick={() => { onAdd(x.t); setOpen(false); }} className="w-full px-2 py-1.5 rounded text-[12px] text-left text-[var(--text)] hover:bg-[var(--bg-surface)]">{x.label}</button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function EditableText({ value, onSave, className = "", placeholder = "", center = false }: { value: string; onSave: (v: string) => void; className?: string; placeholder?: string; center?: boolean }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  if (editing) {
    return (
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)}
        onBlur={() => { setEditing(false); onSave(v); }}
        onKeyDown={(e) => { if (e.key === "Enter") { setEditing(false); onSave(v); } if (e.key === "Escape") { setEditing(false); setV(value); } }}
        className={`bg-[var(--bg-surface)] border border-[var(--primary)]/40 rounded px-1.5 py-0.5 w-full focus:outline-none ${center ? "text-center" : ""} ${className}`} />
    );
  }
  return (
    <span onClick={() => setEditing(true)} className={`cursor-text inline-block ${center ? "w-full text-center" : ""} ${className} ${!value ? "text-[var(--text-dim)]" : ""}`}>
      {value || placeholder}
    </span>
  );
}
