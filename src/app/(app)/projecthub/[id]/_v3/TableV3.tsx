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
//   feature_on('projecthub_v3') 게이트 뒤에서만 렌더. 칸반 보기는 ＋보기로 켠다(2026-08-31 사장님
//   "목업대로 안 보인다" — 2단계 예정을 앞당김). 서랍·기록·기능 토글·간트는 2~3단계.

import { useMemo, useRef, useState, useEffect } from "react";
import { useParams } from "next/navigation";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { logRead } from "@/lib/log-read";
import { friendlyError } from "@/lib/friendly-error";
import { getCompanyUsers } from "@/lib/queries";
import { stagesOf, FIELD_TYPES, type ItemStage, type FieldType } from "@/lib/project-items";
import { TEMPLATES, type Tpl } from "./templates";
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
  | { kind: "addcol"; x: number; y: number }
  | { kind: "addview"; x: number; y: number };

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

  // ── 검색 — 구분(kind) 칩 줄은 뺐다: v2.6 탭과 똑같이 생겨 "옛 화면 아니냐" 혼란을 줬다
  //   (2026-08-31 사장님 지적). 돈·메모 구분은 2단계 서랍·보기에서 다룬다.
  const [q, setQ] = useState("");
  const shown = useMemo(() => items.filter((it) => {
    if (!q.trim()) return true;
    const hay = [it.name, userName(it.assignee_id), ...(it.tags || []),
      ...Object.values(it.fields || {}).map((v) => String(v ?? ""))].join(" ").toLowerCase();
    return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [items, q, users]);
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
      company_id: companyId, deal_id: dealId, kind: "todo",
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

  // ── 보기 — 표가 기본(결정 130), 칸반은 ＋보기로 추가한 '보는 형태'.
  //   추가 상태는 임시로 브라우저에 기억(3단계에서 deals.v3_views 로 팀 공유 저장 — 결정 129) ──
  const VIEWS_LS = `ov.pjv3.views.${dealId}`;
  const [views, setViews] = useState<string[]>([]);
  const [curView, setCurView] = useState<"table" | "kanban">("table");
  useEffect(() => {
    try { const v = JSON.parse(localStorage.getItem(VIEWS_LS) || "[]"); if (Array.isArray(v)) setViews(v); } catch { /* 무시 */ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dealId]);
  const addKanban = () => {
    const next = views.includes("kanban") ? views : [...views, "kanban"];
    setViews(next); setCurView("kanban"); setPop(null);
    try { localStorage.setItem(VIEWS_LS, JSON.stringify(next)); } catch { /* 무시 */ }
  };
  const removeView = (v: string) => {
    const next = views.filter((x) => x !== v);
    setViews(next); if (curView === v) setCurView("table");
    try { localStorage.setItem(VIEWS_LS, JSON.stringify(next)); } catch { /* 무시 */ }
  };

  // ── 칸반 끌어 옮기기 — 놓는 곳의 상태로 바뀐다(표의 상태 셀과 같은 저장).
  //   끄는 항목은 ref 로 든다 — dragstart 의 setState 가 커밋되기 전에 drop 이 오면 놓친다 ──
  const dragIdRef = useRef<string | null>(null);
  const [dragOverStage, setDragOverStage] = useState<string | null>(null);
  const dropTo = async (stageId: string) => {
    const id = dragIdRef.current; dragIdRef.current = null; setDragOverStage(null);
    if (!id) return;
    const it = items.find((x) => x.id === id);
    if (!it || it.status === stageId) return;
    await saveItem(id, { status: stageId });
  };

  // ── 템플릿 팝업 — monday 템플릿 센터 벤치마킹(2026-08-31 사장님: 생성 때 고르지 않고 버튼→팝업).
  //   템플릿은 **가로형**(사장님: "한 태스크당 업무처리를 하려면 가로로 보는 게 편함") —
  //   항목을 세로로 시드하지 않고 **컬럼 정의**를 시드한다. 그룹은 안 건드린다(_v3/templates.ts) ──
  const [tplOpen, setTplOpen] = useState(false);
  const [tplSel, setTplSel] = useState<Tpl | null>(null);
  const [tplSaving, setTplSaving] = useState(false);
  const applyTemplate = async (tpl: Tpl) => {
    if (tplSaving) return;
    setTplSaving(true);
    try {
      //   같은 이름의 열이 이미 있으면 건너뛴다(deal_id+key unique) — 두 번 눌러도 안 겹치게
      const existing = new Set(cols.map((c) => c.key));
      const newCols = tpl.cols.filter((c) => !existing.has(c.name));
      if (newCols.length > 0) {
        const base = cols.length > 0 ? Math.max(...cols.map((c) => c.position ?? 0)) + 1 : 0;
        const { error } = await db.from("project_item_columns").insert(newCols.map((c, i) => ({
          company_id: companyId, deal_id: dealId, key: c.name, name: c.name, type: c.type,
          settings: c.options ? { options: c.options } : {}, position: base + i,
        })));
        if (error) throw new Error(error.message);
      }
      //   예시 줄은 빈 표에만 — 쓰던 표에 예시가 끼면 방해다
      if (items.length === 0 && stages[0]) {
        const { error } = await db.from("project_items").insert({
          company_id: companyId, deal_id: dealId, kind: "todo",
          name: tpl.example, status: stages[0].id, position: 0, created_by: user?.id ?? null,
        });
        if (error) throw new Error(error.message);
      }
      toast(newCols.length > 0
        ? `'${tpl.name}' 양식을 적용했습니다 — 열 ${newCols.length}개가 오른쪽에 붙었습니다`
        : `'${tpl.name}' 양식의 열이 이미 다 있습니다`, "success");
      setTplOpen(false); setTplSel(null);
      qc.invalidateQueries({ queryKey: ["pjv3-cols", dealId] });
      qc.invalidateQueries({ queryKey: ["pjv3-items", dealId] });
    } catch (e: any) {
      toast(`적용 실패: ${e.message || e}`, "error");
    } finally {
      setTplSaving(false);
    }
  };

  // ── 그룹(단계) — 처음엔 한 그룹, 이름은 눌러서 바꾸고 ＋ 새 그룹으로 늘린다(2026-08-31 사장님) ──
  const [stageEdit, setStageEdit] = useState<string | null>(null);
  const stageEditRef = useRef<HTMLInputElement | null>(null);
  useEffect(() => { stageEditRef.current?.focus(); stageEditRef.current?.select(); }, [stageEdit]);
  const saveStages = async (next: ItemStage[]) => {
    const { error } = await db.from("deals").update({ item_stages: next }).eq("id", dealId);
    if (error) { toast(friendlyError(error), "error"); return false; }
    qc.invalidateQueries({ queryKey: ["pjv3-deal", dealId] });
    return true;
  };
  const renameStage = async (id: string, label: string) => {
    setStageEdit(null);
    const v = label.trim();
    const cur = stages.find((s) => s.id === id);
    if (!v || !cur || cur.label === v) return;
    await saveStages(stages.map((s) => (s.id === id ? { ...s, label: v } : s)));
  };
  const STAGE_COLORS: ItemStage["color"][] = ["indigo", "orange", "green", "red", "gray"];
  const addStage = async () => {
    const id = `g_${Date.now().toString(36)}`;
    const ok = await saveStages([...stages, { id, label: "새 그룹", color: STAGE_COLORS[stages.length % STAGE_COLORS.length] }]);
    if (ok) setStageEdit(id);
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
          {it.kind !== "todo" && (
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
          //   옵션에 색이 있으면 상태 셀처럼 색으로 채운다 — 가로 흐름이 색으로 읽힌다(monday 문법)
          if (opt?.color) {
            return <td key={c.id}><button type="button" className="pjv3-stcell" style={{ background: opt.color }}
              onClick={(e) => setPop({ kind: "select", itemId: it.id, colKey: c.key, ...at(e) })}>{opt.label}</button></td>;
          }
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
      {/* 한 상자 — 제목·보기·검색·표 전부 이 안(2026-08-31 사장님: 다른 메뉴처럼 한 박스로) */}
      <div className="pjv3-box">
      <div className="pjv3-head">
        <h1>{deal.name}</h1>
        {period && <span className="pjv3-head-sub mono-number">{period}</span>}
        <span className="pjv3-head-sub">표가 곧 입력입니다 — 다른 보기는 ＋ 보기로 켭니다</span>
        <button type="button" className="btn-secondary btn-sm ml-auto" title="업무에 맞는 시작 양식을 예시로 보고 채웁니다"
          onClick={() => { setTplSel(TEMPLATES[0] ?? null); setTplOpen(true); }}>템플릿</button>
      </div>

      {/* 보기 줄 — 표가 기본, 칸반은 '표를 보는 형태'(결정 130). 간트·캘린더·현황은 다음 단계 */}
      <div className="pjv3-views">
        <button type="button" className={`pjv3-vchip ${curView === "table" ? "on" : ""}`} onClick={() => setCurView("table")}>표</button>
        {views.includes("kanban") && (
          <button type="button" className={`pjv3-vchip ${curView === "kanban" ? "on" : ""}`} onClick={() => setCurView("kanban")}>
            칸반
            {curView === "kanban" && <span className="x" title="이 보기 빼기" onClick={(e) => { e.stopPropagation(); removeView("kanban"); }}>✕</span>}
          </button>
        )}
        <button type="button" className="pjv3-addview" onClick={(e) => setPop({ kind: "addview", ...at(e) })}>＋ 보기</button>
      </div>

      <div className="pjv3-toolbar">
        <span className="pjv3-search">🔍<input value={q} onChange={(e) => setQ(e.target.value)} placeholder="이름 · 담당 · 칸에 든 글자 — 검색" aria-label="검색" /></span>
        <span className="pjv3-count num">{shown.length}건{shown.length !== items.length ? ` / 전체 ${items.length}` : ""}</span>
      </div>

      {curView === "kanban" ? (
        <div className="pjv3-kbwrap">
          <div className="pjv3-kb">
            {stages.map((s) => {
              const group = byStage.m.get(s.id) || [];
              return (
                <div key={s.id} className={`pjv3-kcol ${dragOverStage === s.id ? "dragover" : ""}`}
                  onDragOver={(e) => { e.preventDefault(); setDragOverStage(s.id); }}
                  onDragLeave={() => setDragOverStage((cur) => (cur === s.id ? null : cur))}
                  onDrop={() => dropTo(s.id)}>
                  <h3><span className="dot" style={{ background: STAGE_HEX[s.color] }} />{s.label}<span className="cnt num">{group.length}</span></h3>
                  <div className="pjv3-kcards">
                    {group.map((it) => {
                      const late = it.due_date && it.status !== stages[stages.length - 1]?.id && it.due_date < new Date().toISOString().slice(0, 10);
                      return (
                        <div key={it.id} className="pjv3-kc" draggable
                          onDragStart={() => { dragIdRef.current = it.id; }} onDragEnd={() => { dragIdRef.current = null; setDragOverStage(null); }}>
                          <div className="tt">{it.name}</div>
                          {(it.assignee_id || it.due_date || it.plan_amount != null) && (
                            <div className="meta">
                              {userName(it.assignee_id) && <span>{userName(it.assignee_id)}</span>}
                              {it.due_date && <span className={`mono-number ${late ? "late" : ""}`}>{it.due_date}</span>}
                              {it.plan_amount != null && <span className="mono-number">{Number(it.plan_amount).toLocaleString("ko-KR")}</span>}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                  <div className="pjv3-kadd">
                    <input placeholder={`＋ ${s.label}에 추가`}
                      onKeyDown={(e) => {
                        const v = (e.target as HTMLInputElement).value;
                        if (e.key === "Enter" && !e.nativeEvent.isComposing && v.trim()) {
                          addItem(s.id, v.trim()); (e.target as HTMLInputElement).value = "";
                        }
                      }} />
                  </div>
                </div>
              );
            })}
            {byStage.etc.length > 0 && (
              <div className={`pjv3-kcol ${dragOverStage === "__etc" ? "dragover" : ""}`}>
                <h3><span className="dot" style={{ background: STAGE_HEX.gray }} />단계 밖<span className="cnt num">{byStage.etc.length}</span></h3>
                <div className="pjv3-kcards">
                  {byStage.etc.map((it) => (
                    <div key={it.id} className="pjv3-kc" draggable
                      onDragStart={() => { dragIdRef.current = it.id; }} onDragEnd={() => { dragIdRef.current = null; setDragOverStage(null); }}>
                      <div className="tt">{it.name}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      ) : (
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
                    {stageEdit === s.id ? (
                      <input ref={stageEditRef} className="pjv3-grow-edit" defaultValue={s.label}
                        onBlur={(e) => renameStage(s.id, e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter" && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
                          if (e.key === "Escape") setStageEdit(null);
                        }} />
                    ) : (
                      <span className="pjv3-grow-label" title="눌러서 그룹 이름 바꾸기" onClick={() => setStageEdit(s.id)}>{s.label}</span>
                    )}
                    <em className="num">{group.length}</em>
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
            <tr key="addgroup" className="pjv3-addgroup">
              <td colSpan={totalCols}>
                <button type="button" onClick={addStage}>＋ 새 그룹</button>
              </td>
            </tr>
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
      )}
      <p className="pjv3-foot">
        {curView === "kanban"
          ? "카드를 끌어 다른 열에 놓으면 상태가 바뀝니다(표의 상태 셀과 같은 저장) · 열 아래 칸에 적고 Enter로 추가"
          : "셀을 누르면 그 자리에서 고칩니다 · 상태 셀은 색 팔레트 · 오른쪽 ＋로 컬럼(글·숫자·날짜·선택·사람·거래처) 추가"}
      </p>
      </div>

      {/* ── 템플릿 팝업 — 왼쪽 목록에서 고르면 오른쪽에 단계·시작 항목이 실물로 미리 보인다 ── */}
      {tplOpen && (
        <div className="phv3-overlay" onClick={(e) => { if (e.target === e.currentTarget) setTplOpen(false); }}>
          <div className="phv3-modal pjv3-tpl-modal" role="dialog" aria-modal="true" aria-label="템플릿">
            <h3 className="phv3-modal-title">템플릿 — 업무에 맞는 가로 양식</h3>
            <p className="phv3-modal-desc">
              적용하면 <b>처리 단계가 열(가로)로 붙습니다</b> — 한 줄이 한 건이라, 줄만 훑으면 어디까지 갔는지 보입니다.
              열은 나중에 자유롭게 고치고 지워도 됩니다.
            </p>
            <div className="pjv3-tpl-layout">
              <div className="pjv3-tpl-list">
                {TEMPLATES.map((s) => (
                  <button key={s.key} type="button" className={`pjv3-tpl-item ${tplSel?.key === s.key ? "on" : ""}`}
                    onClick={() => setTplSel(s)}>
                    <b>{s.icon} {s.name}</b><span>{s.desc.split(".")[0]}</span>
                  </button>
                ))}
                <div className="pjv3-tpl-mine">우리 회사 양식 — 자주 쓰는 표를 양식으로 저장하는 기능은 다음 단계에서 붙습니다</div>
              </div>
              {tplSel && (
                <div className="pjv3-tpl-preview">
                  <b>{tplSel.icon} {tplSel.name}</b>
                  <p>{tplSel.desc}</p>
                  {/* 실물 미리보기 — 붙을 열 그대로, 예시 한 줄(색 옵션은 첫 값으로) */}
                  <div className="pjv3-tpl-minisheet">
                    <table>
                      <thead><tr>
                        <th className="!text-left">이름</th>
                        {tplSel.cols.map((c) => <th key={c.name}>{c.name}</th>)}
                      </tr></thead>
                      <tbody><tr>
                        <td className="!text-left">{tplSel.example}</td>
                        {tplSel.cols.map((c) => (
                          <td key={c.name}>
                            {c.options?.[0]?.color
                              ? <span className="pjv3-tpl-badge" style={{ background: c.options[0].color }}>{c.options[0].label}</span>
                              : <span className="text-[var(--text-dim)]">{FIELD_TYPES.find((t) => t.id === c.type)?.label || "—"}</span>}
                          </td>
                        ))}
                      </tr></tbody>
                    </table>
                  </div>
                  <div className="phv3-modal-actions">
                    <button type="button" className="btn-secondary btn-sm" onClick={() => setTplOpen(false)}>닫기</button>
                    <button type="button" className="btn-primary btn-sm" disabled={tplSaving}
                      onClick={() => applyTemplate(tplSel)}>이 템플릿 적용</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

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
          {pop.kind === "addview" && (<>
            <div className="pjv3-pop-title">보기 추가 — 표를 보는 다른 형태</div>
            <button type="button" onClick={addKanban}>칸반 — 상태별 카드로 보고, 끌어서 옮깁니다</button>
            <div className="pjv3-pop-title">간트·캘린더·현황은 다음 단계에서 붙습니다</div>
          </>)}
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
