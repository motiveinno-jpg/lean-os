"use client";

// 프로젝트 v3 — 먼데이식 표 입력 (2026-08-31 결정 130·124·132, docs/20260831_PLAN_projecthub_v3_impl.md 1단계)
//
//   사장님 확정: "입력은 기본적인 형태로 먼데이 형태로 — 처음 들어갔을 때부터. 간트·칸반은 보는 형태일 뿐."
//   프로젝트에 들어오면 이 표가 먼저다. 표가 곧 입력이다:
//   · 그룹 = 상태(단계) 색 띠 — 결정 132: 상태=단계=색 라벨 한 축 (deals.item_stages)
//   · 그룹마다 인라인 ＋줄(치고 Enter), 셀 클릭 즉시 편집, 상태 셀은 색 팔레트
//   · 커스텀 컬럼(project_item_columns) — 오른쪽 ＋로 추가, 값은 project_items.fields[key]
//   · 숫자 컬럼은 아래 합계 줄
//   데이터 모델은 v2.6(project_items)을 그대로 승계 — 이 파일은 화면만 바꾼다(결정 131·133).
//   feature_on('projecthub_v3') 게이트 뒤에서만 렌더. 보기(칸반 등)·서랍·기능 토글은 2~3단계.

import { useMemo, useRef, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { logRead } from "@/lib/log-read";
import { friendlyError } from "@/lib/friendly-error";
import { getCompanyUsers } from "@/lib/queries";
import { stagesOf, FIELD_TYPES, type ItemStage, type FieldType, type ItemKind } from "@/lib/project-items";
import type { ItemRow } from "./HubV3";

const db = supabase as any;

/** 단계 색 이름 → 실제 색 (v2.6 ItemStage.color 5종) */
const STAGE_HEX: Record<ItemStage["color"], string> = {
  gray: "#9aa0b5", indigo: "#5559DF", orange: "#FDAB3D", green: "#00C875", red: "#E2445C",
};
const KIND_CHIP: Record<string, { label: string; cls: string }> = {
  todo: { label: "할 일", cls: "text-[var(--primary)] bg-[var(--primary)]/10" },
  money: { label: "돈", cls: "text-emerald-600 bg-emerald-500/10" },
  note: { label: "메모", cls: "text-amber-600 bg-amber-500/10" },
};

export type ColumnDef = {
  id: string; deal_id: string; key: string; name: string; type: FieldType;
  settings: { options?: { id: string; label: string; color?: string }[] } | null;
  position: number; archived_at: string | null;
};
type UserRow = { id: string; name: string | null; email: string | null };

/** 떠 있는 선택 팝 — 상태 팔레트·담당·선택지·컬럼 추가가 같은 그릇을 쓴다 */
type Pop =
  | { kind: "status"; itemId: string; x: number; y: number }
  | { kind: "person"; itemId: string; colKey?: string; x: number; y: number }
  | { kind: "select"; itemId: string; colKey: string; x: number; y: number }
  | { kind: "addcol"; x: number; y: number };

export function TableV3() {
  const params = useParams();
  const dealId = String(params?.id || "");
  const qc = useQueryClient();
  const { toast } = useToast();
  const { user } = useUser();
  const companyId = user?.company_id ?? null;

  // ── 데이터 (v2.6 훅 패턴 승계 — 쿼리 키는 분리해 화면끼리 안 엮이게) ──
  const { data: deal, isLoading: dealLoading } = useQuery({
    queryKey: ["pjv3-deal", dealId],
    enabled: !!dealId,
    queryFn: async () => logRead("pjv3:deal", await db.from("deals")
      .select("id, name, company_id, stage, start_date, end_date, item_stages")
      .eq("id", dealId).maybeSingle()),
  });
  const { data: items = [], isLoading: itemsLoading } = useQuery({
    queryKey: ["pjv3-items", dealId],
    enabled: !!dealId,
    queryFn: async () => (logRead("pjv3:items", await db.from("project_items")
      .select("*").eq("deal_id", dealId).is("archived_at", null)
      .order("position").order("created_at")) || []) as ItemRow[],
  });
  const { data: cols = [] } = useQuery({
    queryKey: ["pjv3-cols", dealId],
    enabled: !!dealId,
    queryFn: async () => (logRead("pjv3:cols", await db.from("project_item_columns")
      .select("*").eq("deal_id", dealId).is("archived_at", null)
      .order("position").order("created_at")) || []) as ColumnDef[],
  });
  const { data: users = [] } = useQuery({
    queryKey: ["pjv3-users", companyId],
    enabled: !!companyId,
    queryFn: () => getCompanyUsers(companyId!) as Promise<UserRow[]>,
  });

  const stages = useMemo(() => stagesOf(deal?.item_stages), [deal?.item_stages]);
  const userName = (id: string | null) => users.find((u) => u.id === id)?.name || "";

  // ── 걸러 보기: 구분 칩(결정 136 — 옛 다중 표는 kind 로 접혔다) + 검색 ──
  const [kindFilter, setKindFilter] = useState<"all" | ItemKind>("all");
  const [q, setQ] = useState("");
  const shown = useMemo(() => items.filter((it) => {
    if (kindFilter !== "all" && it.kind !== kindFilter) return false;
    if (!q.trim()) return true;
    const hay = [it.name, userName(it.assignee_id), ...(it.tags || []),
      ...Object.values(it.fields || {}).map((v) => String(v ?? ""))].join(" ").toLowerCase();
    return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [items, kindFilter, q, users]);
  const byStage = useMemo(() => {
    const m = new Map<string, ItemRow[]>();
    for (const s of stages) m.set(s.id, []);
    const etc: ItemRow[] = [];
    for (const it of shown) (m.get(it.status) ?? etc).push(it);
    return { m, etc };
  }, [shown, stages]);

  // ── 저장 — 셀 하나가 곧 저장 단위(표가 입력이다) ──
  const saveItem = async (id: string, patch: Record<string, unknown>) => {
    const { error } = await db.from("project_items")
      .update({ ...patch, updated_at: new Date().toISOString() }).eq("id", id);
    if (error) { toast(friendlyError(error), "error"); return false; }
    qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
    return true;
  };
  const saveField = (it: ItemRow, key: string, value: unknown) =>
    saveItem(it.id, { fields: { ...(it.fields || {}), [key]: value === "" ? null : value } });
  const addItem = async (stageId: string, name: string) => {
    const group = byStage.m.get(stageId) || [];
    const { error } = await db.from("project_items").insert({
      company_id: companyId, deal_id: dealId, kind: kindFilter === "all" ? "todo" : kindFilter,
      money_kind: kindFilter === "money" ? "spend" : null,
      name, status: stageId, position: (group[group.length - 1]?.position ?? 0) + 1,
      created_by: user?.id ?? null,
    });
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
  };
  const addColumn = async (name: string, type: FieldType) => {
    const { error } = await db.from("project_item_columns").insert({
      company_id: companyId, deal_id: dealId, key: name, name, type,
      settings: type === "select" ? { options: [] } : {},
      position: (cols[cols.length - 1]?.position ?? 0) + 1,
    });
    if (error) { toast(friendlyError(error), "error"); return; }
    qc.invalidateQueries({ queryKey: ["pjv3-cols", dealId] });
    toast(`'${name}' 컬럼을 추가했습니다 — 셀을 눌러 바로 채우세요`, "success");
  };

  // ── 팝(팔레트·담당·선택지·컬럼 추가) — 화면에 하나만 ──
  const [pop, setPop] = useState<Pop | null>(null);
  useEffect(() => {
    if (!pop) return;
    const close = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".pjv3-pop")) setPop(null); };
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setPop(null); };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", close); document.removeEventListener("keydown", esc); };
  }, [pop]);
  const at = (e: React.MouseEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.min(r.left, window.innerWidth - 210), y: r.bottom + 4 };
  };

  // ── 셀 인라인 편집(글·숫자·날짜) — 누르면 그 자리가 입력칸 ──
  const [edit, setEdit] = useState<{ itemId: string; colKey: string } | null>(null);
  const editRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { editRef.current?.focus(); editRef.current?.select(); }, [edit]);
  const EditCell = ({ it, colKey, value, type, align }: {
    it: ItemRow; colKey: string; value: string; type?: "text" | "number" | "date"; align?: "left";
  }) => {
    const editing = edit?.itemId === it.id && edit?.colKey === colKey;
    const commit = async (v: string) => {
      setEdit(null);
      if (v === value) return;
      if (colKey === "name") { if (v.trim()) await saveItem(it.id, { name: v.trim() }); return; }
      if (colKey === "due_date") { await saveItem(it.id, { due_date: v || null }); return; }
      if (colKey === "plan_amount") { await saveItem(it.id, { plan_amount: v === "" ? null : Number(v.replace(/[^0-9.-]/g, "")) }); return; }
      await saveField(it, colKey, type === "number" ? (v === "" ? null : Number(v)) : v);
    };
    if (editing) return (
      <input ref={editRef} className="pjv3-cell" defaultValue={value} type={type === "date" ? "date" : "text"}
        inputMode={type === "number" ? "decimal" : undefined}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
          if (e.key === "Escape") setEdit(null);
        }} />
    );
    //   숫자는 읽을 땐 콤마, 고칠 땐 원값 (표가 입력이자 장부다)
    const shownValue = type === "number" && value !== "" && Number.isFinite(Number(value))
      ? Number(value).toLocaleString("ko-KR") : value;
    return (
      <span className={`pjv3-cell ${align === "left" ? "text-left" : ""} ${value ? "" : "text-[var(--text-dim)]"}`}
        onClick={() => setEdit({ itemId: it.id, colKey })}>{shownValue || "—"}</span>
    );
  };

  // ── 숫자 컬럼 합계(먼데이 M6) ──
  const numberCols = cols.filter((c) => c.type === "number");
  const sumOf = (key: string) => shown.reduce((s, it) => {
    const v = Number((it.fields || {})[key]); return s + (Number.isFinite(v) ? v : 0);
  }, 0);

  if (dealLoading || itemsLoading) return <div className="pjv3-wrap"><div className="collect-empty">불러오는 중…</div></div>;
  if (!deal) return <div className="pjv3-wrap"><div className="collect-empty">프로젝트를 찾을 수 없습니다.</div></div>;

  const stageOf = (id: string) => stages.find((s) => s.id === id);
  const period = [deal.start_date, deal.end_date].filter(Boolean).join(" ~ ");
  const totalCols = 5 + cols.length + 1; // 이름·담당·상태·마감·금액 + 커스텀 + ＋

  const renderRow = (it: ItemRow) => (
    <tr key={it.id}>
      <td className="pjv3-namecell pjv3-ecell">
        <span className="flex items-center gap-1.5 px-0">
          {kindFilter === "all" && it.kind !== "todo" && (
            <span className={`pjv3-kind ${KIND_CHIP[it.kind]?.cls || ""}`}>{KIND_CHIP[it.kind]?.label}</span>
          )}
          <span className="min-w-0 flex-1"><EditCell it={it} colKey="name" value={it.name} align="left" /></span>
        </span>
      </td>
      <td><button type="button" className="pjv3-cell" onClick={(e) => setPop({ kind: "person", itemId: it.id, ...at(e) })}>
        {userName(it.assignee_id) || <span className="text-[var(--text-dim)]">—</span>}</button></td>
      <td><button type="button" className="pjv3-stcell" style={{ background: STAGE_HEX[stageOf(it.status)?.color || "gray"] }}
        onClick={(e) => setPop({ kind: "status", itemId: it.id, ...at(e) })}>
        {stageOf(it.status)?.label || it.status}</button></td>
      <td className="pjv3-ecell mono-number"><EditCell it={it} colKey="due_date" value={it.due_date || ""} type="date" /></td>
      <td className="pjv3-ecell mono-number">
        <EditCell it={it} colKey="plan_amount" value={it.plan_amount == null ? "" : String(it.plan_amount)} type="number" />
      </td>
      {cols.map((c) => {
        const raw = (it.fields || {})[c.key];
        const val = raw == null ? "" : String(raw);
        if (c.type === "select") {
          const opt = (c.settings?.options || []).find((o) => o.id === val || o.label === val);
          return <td key={c.id}><button type="button" className="pjv3-cell" onClick={(e) => setPop({ kind: "select", itemId: it.id, colKey: c.key, ...at(e) })}>
            {opt?.label || val || <span className="text-[var(--text-dim)]">—</span>}</button></td>;
        }
        if (c.type === "person") {
          return <td key={c.id}><button type="button" className="pjv3-cell" onClick={(e) => setPop({ kind: "person", itemId: it.id, colKey: c.key, ...at(e) })}>
            {userName(val || null) || val || <span className="text-[var(--text-dim)]">—</span>}</button></td>;
        }
        if (c.type === "partner") {
          return <td key={c.id} className="text-[var(--text-dim)]"><span className="pjv3-cell" title="거래처 칸은 2단계에서 고릅니다">{val || "—"}</span></td>;
        }
        return <td key={c.id} className={`pjv3-ecell ${c.type === "number" ? "mono-number" : ""}`}>
          <EditCell it={it} colKey={c.key} value={val} type={c.type === "number" ? "number" : c.type === "date" ? "date" : "text"} /></td>;
      })}
      <td></td>
    </tr>
  );

  return (
    <div className="pjv3-wrap">
      <div className="pjv3-head">
        <h1>{deal.name}</h1>
        {period && <span className="pjv3-head-sub mono-number">{period}</span>}
        <span className="pjv3-head-sub">표가 곧 입력입니다 — 칸반·간트 같은 보기와 기능 켜기는 다음 단계에서 붙습니다</span>
      </div>

      <div className="pjv3-toolbar">
        <span className="qk-chips">
          {([["all", "전체"], ["todo", "할 일"], ["money", "매출·지출"], ["note", "회의·메모"]] as const).map(([k, label]) => (
            <button key={k} type="button" className={kindFilter === k ? "qk-chip qk-chip-on" : "qk-chip"}
              onClick={() => setKindFilter(k)}>{label}</button>
          ))}
        </span>
        <span className="pjv3-search">🔍<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="검색" aria-label="검색" /></span>
        <span className="pjv3-foot num !mt-0 ml-auto">{shown.length}건{shown.length !== items.length ? ` / 전체 ${items.length}` : ""}</span>
      </div>

      <div className="pjv3-sheetwrap">
        <table className="pjv3-sheet">
          <thead><tr>
            <th className="!text-left" style={{ minWidth: 220 }}>이름</th>
            <th style={{ minWidth: 84 }}>담당</th>
            <th style={{ minWidth: 92 }}>상태</th>
            <th style={{ minWidth: 106 }}>마감</th>
            <th style={{ minWidth: 96 }} title="예정 금액 — 확정 금액은 장부(전표·계산서)가 갖습니다">금액</th>
            {cols.map((c) => <th key={c.id} style={{ minWidth: 96 }} title={`${c.name} (${FIELD_TYPES.find((t) => t.id === c.type)?.label || c.type})`}>{c.name}</th>)}
            <th className="pjv3-colplus" title="컬럼 추가 — 글·숫자·날짜·선택·사람·거래처"
              onClick={(e) => setPop({ kind: "addcol", ...at(e as unknown as React.MouseEvent) })}>＋</th>
          </tr></thead>
          <tbody>
            {stages.map((s) => {
              const group = byStage.m.get(s.id) || [];
              return [
                <tr key={`g-${s.id}`}>
                  <td colSpan={totalCols} className="pjv3-grow"
                    style={{ borderLeftColor: STAGE_HEX[s.color], background: `color-mix(in srgb, ${STAGE_HEX[s.color]} 7%, var(--bg-card))` }}>
                    {s.label}<em className="num">{group.length}</em>
                  </td>
                </tr>,
                ...group.map(renderRow),
                <tr key={`a-${s.id}`} className="pjv3-addrow">
                  <td colSpan={totalCols}>
                    <input placeholder={`＋ ${s.label}에 적고 Enter — 담당·마감은 셀에서 바로`}
                      onKeyDown={(e) => {
                        const v = (e.target as HTMLInputElement).value;
                        if (e.key === "Enter" && !e.nativeEvent.isComposing && v.trim()) {
                          addItem(s.id, v.trim()); (e.target as HTMLInputElement).value = "";
                        }
                      }} />
                  </td>
                </tr>,
              ];
            })}
            {byStage.etc.length > 0 && [
              <tr key="g-etc"><td colSpan={totalCols} className="pjv3-grow" style={{ borderLeftColor: STAGE_HEX.gray }}>
                단계 밖<em className="num">{byStage.etc.length}</em></td></tr>,
              ...byStage.etc.map(renderRow),
            ]}
            {(shown.length > 0 || numberCols.length > 0) && (
              <tr className="pjv3-sumrow">
                <td className="!text-left num">{shown.length}건</td><td></td>
                <td className="font-bold">{stages.map((s) => `${s.label} ${(byStage.m.get(s.id) || []).length}`).join(" · ")}</td>
                <td></td>
                <td className="mono-number font-bold">{shown.reduce((s, it) => s + (Number(it.plan_amount) || 0), 0).toLocaleString("ko-KR")}</td>
                {cols.map((c) => <td key={c.id} className="mono-number font-bold">
                  {c.type === "number" ? sumOf(c.key).toLocaleString("ko-KR") : ""}</td>)}
                <td></td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <p className="pjv3-foot">셀을 누르면 그 자리에서 고칩니다 · 상태 셀은 색 팔레트 · 오른쪽 ＋로 컬럼 추가 · 구분(할 일/매출·지출/회의·메모)은 위 칩으로 걸러 봅니다</p>

      {/* ── 떠 있는 팝 — 상태·담당·선택지·컬럼 추가 ── */}
      {pop && (
        <div className="pjv3-pop" style={{ left: pop.x, top: pop.y }}>
          {pop.kind === "status" && (<>
            <div className="pjv3-pop-title">상태 — 그룹·칸반 열이 같이 바뀝니다</div>
            {stages.map((s) => (
              <button key={s.id} type="button" className="pjv3-pop-color" style={{ background: STAGE_HEX[s.color] }}
                onClick={() => { saveItem(pop.itemId, { status: s.id }); setPop(null); }}>{s.label}</button>
            ))}
          </>)}
          {pop.kind === "person" && (<>
            <div className="pjv3-pop-title">담당</div>
            <button type="button" className="text-[var(--text-dim)]" onClick={() => {
              if (pop.colKey) { const it = items.find((x) => x.id === pop.itemId); if (it) saveField(it, pop.colKey!, null); }
              else saveItem(pop.itemId, { assignee_id: null });
              setPop(null);
            }}>없음</button>
            {users.map((u) => (
              <button key={u.id} type="button" onClick={() => {
                if (pop.colKey) { const it = items.find((x) => x.id === pop.itemId); if (it) saveField(it, pop.colKey!, u.id); }
                else saveItem(pop.itemId, { assignee_id: u.id });
                setPop(null);
              }}>{u.name || u.email}</button>
            ))}
          </>)}
          {pop.kind === "select" && (() => {
            const col = cols.find((c) => c.key === pop.colKey);
            const opts = col?.settings?.options || [];
            return (<>
              <div className="pjv3-pop-title">{col?.name}</div>
              <button type="button" className="text-[var(--text-dim)]" onClick={() => {
                const it = items.find((x) => x.id === pop.itemId); if (it) saveField(it, pop.colKey, null); setPop(null);
              }}>없음</button>
              {opts.map((o) => (
                <button key={o.id} type="button" className={o.color ? "pjv3-pop-color" : ""}
                  style={o.color ? { background: o.color } : undefined}
                  onClick={() => { const it = items.find((x) => x.id === pop.itemId); if (it) saveField(it, pop.colKey, o.id); setPop(null); }}>
                  {o.label}</button>
              ))}
              {opts.length === 0 && <div className="pjv3-pop-title">선택지가 없습니다 — 컬럼 설정은 2단계에서</div>}
            </>);
          })()}
          {pop.kind === "addcol" && <AddColPop onAdd={(name, type) => { addColumn(name, type); setPop(null); }} />}
        </div>
      )}
    </div>
  );
}

/** 컬럼 추가 팝 — 이름 적고 타입 고르면 끝 (결정 125: 컬럼이 곧 구조) */
function AddColPop({ onAdd }: { onAdd: (name: string, type: FieldType) => void }) {
  const [name, setName] = useState("");
  return (
    <>
      <div className="pjv3-pop-title">컬럼 추가 — 이름 적고 타입을 고르세요</div>
      <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="예: 광고 ID, KPI 목표" />
      {FIELD_TYPES.map((t) => (
        <button key={t.id} type="button" className={name.trim() ? "" : "opacity-40"}
          onClick={() => { if (name.trim()) onAdd(name.trim(), t.id); }}>{t.label}</button>
      ))}
    </>
  );
}
