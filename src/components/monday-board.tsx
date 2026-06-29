"use client";

// 2026-06-11 프로젝트 Monday.com 클론 보드 (사장님: "진짜 아예 똑같다 싶을 정도로").
//   데이터 로직은 Phase 1·2 그대로(행=deals, 컬럼=board_columns, 셀=deals.column_values, 그룹=board_groups).
//   이번 라운드는 비주얼·UX를 먼데이 시그니처로 재현:
//   · 먼데이 정확 팔레트(#00C875 done / #FDAB3D working / #E2445C stuck / #0073EA primary)
//   · 그룹 컬러 좌측 스트립 + 그룹명 그룹색 + 접기 caret
//   · 상태 셀 = 셀 전체 채움(라운드 없음, 흰 글씨), 클릭 풀폭 드롭다운
//   · 행 체크박스 + 하단 플로팅 선택바(그룹 이동)
//   · 그룹 푸터: 상태 분포 바 + 숫자 합계
//   · 툴바: 파란 "새 항목" + 검색 + 담당자 필터, 맨 아래 "+ 새 그룹 추가"
//   · 담당자 셀 = 이니셜 아바타, 날짜 셀 = M월 D일 표시
//   표시·편집 전용, 재무 무변경.

import { useState, useMemo, useEffect, useRef } from "react";
import { DateField } from "@/components/date-field";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

type Col = { id: string; name: string; type: string; settings: any; position: number; in_list?: boolean };
type Grp = { id: string; name: string; color: string; position: number };
type Deal = { id: string; name: string; board_group_id: string | null; column_values: Record<string, any>; contract_total?: number | null };
type SubItem = { id: string; deal_id: string; name: string; column_values: Record<string, any>; position: number };
type Person = { id: string; name: string | null; email: string };

// ── 먼데이 정확 팔레트 ──
const MONDAY = {
  green: "#00C875", orange: "#FDAB3D", red: "#E2445C", blue: "#579BFC",
  purple: "#A25DDC", primary: "#0073EA", lime: "#9CD326", pink: "#FF158A",
  darkPurple: "#784BD1", darkOrange: "#FF642E", lightBlue: "#66CCFF", gray: "#C4C4C4",
  brown: "#7F5347", indigo: "#5559DF",
};
const STATUS_PALETTE = [MONDAY.green, MONDAY.orange, MONDAY.red, MONDAY.blue, MONDAY.purple, MONDAY.lime, MONDAY.gray];
const COLOR_PALETTE = [
  MONDAY.green, MONDAY.orange, MONDAY.red, MONDAY.blue, MONDAY.purple, MONDAY.primary,
  MONDAY.lime, MONDAY.pink, MONDAY.darkPurple, MONDAY.darkOrange, MONDAY.lightBlue, MONDAY.gray,
];

const DEFAULT_COLUMNS: { name: string; type: string; settings: any }[] = [
  { name: "담당자", type: "person", settings: {} },
  { name: "진행상태", type: "status", settings: { options: [
    { id: "todo", label: "준비", color: MONDAY.gray },
    { id: "doing", label: "진행중", color: MONDAY.orange },
    { id: "done", label: "완료", color: MONDAY.green },
    { id: "hold", label: "보류", color: MONDAY.red },
  ] } },
  { name: "우선순위", type: "status", settings: { options: [
    { id: "high", label: "높음", color: MONDAY.darkPurple },
    { id: "mid", label: "보통", color: MONDAY.indigo },
    { id: "low", label: "낮음", color: MONDAY.blue },
  ] } },
  { name: "계약일", type: "date", settings: {} },
  // 계약금액은 커스텀 셀이 아니라 실데이터(deals.contract_total) 바인딩 — 통계 4카드와 동일 소스
  { name: "계약금액", type: "number", settings: { bind: "contract_total" } },
];

// 계약금액 컬럼 판정 — 신규 회사는 settings.bind, 기존 회사는 이름+타입으로 소급 인식
//   (보드 계약금액이 비어 보이는데 상단 총 계약금액엔 합산되던 불일치 해소, 2026-06-12)
const isContractCol = (c: Col) => c.settings?.bind === "contract_total" || (c.type === "number" && String(c.name || "").replace(/\s/g, "") === "계약금액");

// 아바타 색 — userId 해시 → 먼데이 팔레트
function avatarColor(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0;
  return COLOR_PALETTE[Math.abs(h) % COLOR_PALETTE.length];
}
function initials(name: string): string {
  const t = name.trim();
  if (!t) return "?";
  // 한글 이름은 마지막 2글자(이름), 영문은 첫 글자 2개
  if (/[가-힣]/.test(t)) return t.length >= 2 ? t.slice(-2) : t;
  const parts = t.split(/[\s@.]+/).filter(Boolean);
  return (parts[0]?.[0] || "").toUpperCase() + (parts[1]?.[0] || "").toUpperCase();
}

const STRIP_W = 6; // 그룹 컬러 스트립 폭(px)
const ROW_H = 36; // 먼데이 행 높이

export function MondayBoard({ companyId, users = [] }: { companyId: string; users?: Person[] }) {
  const qc = useQueryClient();
  const initRef = useRef(false);
  const [configCol, setConfigCol] = useState<Col | null>(null);
  const [openDealId, setOpenDealId] = useState<string | null>(null);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [personFilter, setPersonFilter] = useState<string>("");
  // 먼데이 말풍선: 아이템 업데이트(히스토리) 패널 대상
  const [updatesDeal, setUpdatesDeal] = useState<Deal | null>(null);
  // 푸터 분포 바 클릭 → 텍스트 내역 팝오버
  const [distPop, setDistPop] = useState<{ anchor: DOMRect; title: string; rows: { label: string; color: string; n: number }[]; total: number; empty: number } | null>(null);

  // 말풍선 배지용 — deal 별 업데이트 개수 (프로젝트 레벨만 — 서브아이템 글은 각 행 배지로)
  const { data: updateCounts } = useQuery<Map<string, number>>({
    queryKey: ["board-update-counts", companyId],
    queryFn: async () => {
      const { data } = await db.from("board_item_updates").select("deal_id").eq("company_id", companyId).is("subitem_id", null).limit(5000);
      const m = new Map<string, number>();
      (data || []).forEach((r: any) => m.set(r.deal_id, (m.get(r.deal_id) || 0) + 1));
      return m;
    },
    enabled: !!companyId,
    staleTime: 30_000,
  });

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
      const { data } = await db.from("deals").select("id, name, board_group_id, column_values, contract_total").eq("company_id", companyId).is("archived_at", null).order("created_at", { ascending: true });
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
        await db.from("board_columns").insert(DEFAULT_COLUMNS.map((c, i) => ({ company_id: companyId, name: c.name, type: c.type, settings: c.settings, position: i, in_list: true })));
        changed = true;
      }
      if (groups.length === 0) {
        const { data: g } = await db.from("board_groups").insert({ company_id: companyId, name: "프로젝트", color: MONDAY.primary, position: 0 }).select("id").maybeSingle();
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

  // 메인 리스트는 in_list 컬럼만(기본 5). 상세에서 추가한 컬럼(in_list=false)은 상세에만.
  const listColumns = columns.filter((c) => c.in_list);
  const personColIds = useMemo(() => listColumns.filter((c) => c.type === "person").map((c) => c.id), [listColumns]);

  // 검색·담당자 필터 (클라이언트, 표시만)
  const filteredDeals = useMemo(() => {
    let arr = deals;
    if (search.trim()) {
      const q = search.trim().toLowerCase();
      arr = arr.filter((d) => (d.name || "").toLowerCase().includes(q));
    }
    if (personFilter) {
      arr = arr.filter((d) => personColIds.some((cid) => d.column_values?.[cid] === personFilter));
    }
    return arr;
  }, [deals, search, personFilter, personColIds]);

  const dealsByGroup = useMemo(() => {
    const m = new Map<string | null, Deal[]>();
    for (const d of filteredDeals) {
      const k = d.board_group_id ?? null;
      if (!m.has(k)) m.set(k, []);
      m.get(k)!.push(d);
    }
    return m;
  }, [filteredDeals]);

  // ── 셀 값 저장 ──
  const setCell = async (deal: Deal, colId: string, value: any) => {
    const next = { ...(deal.column_values || {}), [colId]: value };
    await db.from("deals").update({ column_values: next }).eq("id", deal.id);
    refetchAll();
  };
  // 계약금액(바인딩 컬럼) — deals.contract_total 직접 갱신 → 상단 통계·재무 연동과 즉시 일치
  const setContractTotal = async (deal: Deal, value: any) => {
    const num = value === null || value === "" ? null : Number(value);
    await db.from("deals").update({ contract_total: num }).eq("id", deal.id);
    qc.invalidateQueries({ queryKey: ["projects-deals"] }); // 통계 4카드 동기화
    refetchAll();
  };
  const setName = async (deal: Deal, name: string) => {
    if (name === deal.name) return;
    await db.from("deals").update({ name }).eq("id", deal.id);
    refetchAll();
  };

  // ── 추가/삭제 ──
  const addColumn = async (type: string, inList = false) => {
    const name = { text: "텍스트", status: "상태", date: "날짜", person: "담당자", number: "숫자" }[type] || "컬럼";
    const settings = (type === "status")
      ? { options: [{ id: "opt1", label: "옵션1", color: STATUS_PALETTE[0] }, { id: "opt2", label: "옵션2", color: STATUS_PALETTE[1] }] }
      : {};
    await db.from("board_columns").insert({ company_id: companyId, name, type, settings, position: columns.length, in_list: inList });
    refetchAll();
  };
  const deleteColumn = async (col: Col) => {
    await db.from("board_columns").delete().eq("id", col.id);
    setConfigCol(null);
    refetchAll();
  };
  const saveColumn = async (col: Col, patch: { name?: string; settings?: any }) => {
    await db.from("board_columns").update(patch).eq("id", col.id);
    refetchAll();
  };
  // 컬럼 드래그 정렬: 전체 columns 배열(position 순)에서 dragged 를 target 앞으로 이동 후 position 재기록
  const moveColumn = async (draggedId: string, targetId: string) => {
    if (draggedId === targetId) return;
    const arr = [...columns];
    const from = arr.findIndex((c) => c.id === draggedId);
    const to = arr.findIndex((c) => c.id === targetId);
    if (from < 0 || to < 0) return;
    const [moved] = arr.splice(from, 1);
    arr.splice(to, 0, moved);
    await Promise.all(arr.map((c, i) => (c.position === i ? null : db.from("board_columns").update({ position: i }).eq("id", c.id))));
    refetchAll();
  };
  const addGroup = async () => {
    await db.from("board_groups").insert({ company_id: companyId, name: "새 그룹", color: COLOR_PALETTE[groups.length % COLOR_PALETTE.length], position: groups.length });
    refetchAll();
  };
  const renameGroup = async (g: Grp, name: string) => {
    if (!name.trim() || name === g.name) return;
    await db.from("board_groups").update({ name: name.trim() }).eq("id", g.id);
    refetchAll();
  };
  const recolorGroup = async (g: Grp, color: string) => {
    await db.from("board_groups").update({ color }).eq("id", g.id);
    refetchAll();
  };
  const deleteGroup = async (g: Grp) => {
    // 항목은 지우지 않고 그룹만 해제 (deals 는 재무 연동 — 삭제 금지)
    await db.from("deals").update({ board_group_id: null }).eq("board_group_id", g.id);
    await db.from("board_groups").delete().eq("id", g.id);
    refetchAll();
  };
  const addItem = async (groupId: string | null) => {
    // status/stage 는 deals 기본값(active/estimate) 적용. name NOT NULL 만 채움.
    await db.from("deals").insert({ company_id: companyId, name: "새 항목", board_group_id: groupId, column_values: {} });
    refetchAll();
  };

  // ── 선택 (먼데이 플로팅 선택바) ──
  const toggleSelect = (id: string) => {
    setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  };
  const toggleSelectGroup = (rows: Deal[], on: boolean) => {
    setSelected((s) => { const n = new Set(s); rows.forEach((d) => (on ? n.add(d.id) : n.delete(d.id))); return n; });
  };
  const moveSelectedToGroup = async (groupId: string) => {
    const ids = [...selected];
    if (!ids.length) return;
    await db.from("deals").update({ board_group_id: groupId }).in("id", ids);
    setSelected(new Set());
    refetchAll();
  };
  // 선택 항목 삭제 — 프로젝트 목록과 동일 정책: 소프트삭제(archived_at). 재무 연동 데이터 보존.
  const deleteSelected = async () => {
    const ids = [...selected];
    if (!ids.length) return;
    if (!confirm(`${ids.length}개 항목을 삭제(보관)할까요?\n보드/목록에서 사라지며, 연결된 재무 데이터는 보존됩니다.`)) return;
    const { error } = await db.from("deals").update({ archived_at: new Date().toISOString() }).in("id", ids);
    if (error) { alert("삭제 실패: " + error.message); return; }
    setSelected(new Set());
    refetchAll();
  };

  const toggleCollapse = (gid: string) => {
    setCollapsed((s) => { const n = new Set(s); if (n.has(gid)) n.delete(gid); else n.add(gid); return n; });
  };

  const orderedGroups: (Grp | null)[] = [...groups];
  // 그룹 미지정 deal 이 있으면 맨 끝에 "그룹 없음" 섹션
  if (dealsByGroup.has(null)) orderedGroups.push(null);

  // 상세 페이지: 최신 deals 에서 파생(쿼리 refetch 후 stale 방지)
  const openDeal = openDealId ? deals.find((d) => d.id === openDealId) || null : null;

  // ── 프로젝트명 클릭 → 컬럼 상세 페이지로 전환 ──
  if (openDeal) {
    return (
      <>
        <DealDetailView
          key={openDeal.id}
          companyId={companyId}
          deal={openDeal}
          columns={columns}
          users={users}
          updatesCount={updateCounts?.get(openDeal.id) ?? 0}
          onOpenUpdates={() => setUpdatesDeal(openDeal)}
          onBack={() => setOpenDealId(null)}
          onSetName={setName}
          onAddColumn={addColumn}
          onConfigColumn={(c) => setConfigCol(c)}
          onMoveColumn={moveColumn}
        />
        {configCol && (
          <ColumnConfigModal
            key={configCol.id}
            col={configCol}
            onClose={() => setConfigCol(null)}
            onSave={(patch) => saveColumn(configCol, patch)}
            onDelete={() => deleteColumn(configCol)}
          />
        )}
        {/* 상세 화면에서도 말풍선 업데이트 패널 사용 가능 */}
        {updatesDeal && (
          <ItemUpdatesPanel
            companyId={companyId}
            deal={updatesDeal}
            onClose={() => { setUpdatesDeal(null); qc.invalidateQueries({ queryKey: ["board-update-counts", companyId] }); }}
          />
        )}
      </>
    );
  }

  const firstGroupId = groups[0]?.id ?? null;

  return (
    <div className="pb-16">
      {/* ── 먼데이 툴바: 파란 새 항목 + 검색 + 담당자 필터 ── */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button
          onClick={() => addItem(firstGroupId)}
          className="px-4 h-8 rounded text-[13px] font-semibold text-white transition hover:brightness-110"
          style={{ background: MONDAY.primary }}
        >
          새 항목
        </button>
        <div className="flex items-center gap-1.5 h-8 px-2.5 rounded border border-transparent hover:border-[var(--border)] focus-within:border-[var(--primary)] transition">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="text-[var(--text-dim)] shrink-0"><circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.5" y2="16.5" /></svg>
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="검색"
            className="bg-transparent text-[13px] text-[var(--text)] placeholder-[var(--text-dim)] focus:outline-none w-28 focus:w-44 transition-all"
          />
        </div>
        <PersonFilterButton users={users} value={personFilter} onChange={setPersonFilter} />
      </div>

      <div className="space-y-7">
        {orderedGroups.map((g) => {
          const gid = g?.id ?? null;
          const rows = dealsByGroup.get(gid) || [];
          const color = g?.color || MONDAY.gray;
          const isCollapsed = gid ? collapsed.has(gid) : false;
          const allChecked = rows.length > 0 && rows.every((d) => selected.has(d.id));

          return (
            <div key={gid ?? "none"}>
              {/* ── 그룹 헤더: caret + 그룹색 그룹명 + 카운트 + ⋯ ── */}
              <div className="flex items-center gap-1.5 mb-1.5 group/ghead">
                <button
                  onClick={() => gid && toggleCollapse(gid)}
                  className="w-6 h-6 rounded flex items-center justify-center hover:bg-[var(--bg-surface)] transition shrink-0"
                  style={{ color }}
                  aria-label="그룹 접기/펼치기"
                >
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className={`transition-transform ${isCollapsed ? "-rotate-90" : ""}`}>
                    <path d="M7 10l5 5 5-5z" />
                  </svg>
                </button>
                {g ? (
                  <EditableText value={g.name} onSave={(v) => renameGroup(g, v)} className="text-[16px] font-bold" style={{ color }} />
                ) : (
                  <span className="text-[16px] font-bold text-[var(--text-muted)]">그룹 없음</span>
                )}
                <span className="text-[12px] text-[var(--text-dim)] ml-1">{rows.length}개 항목</span>
                {g && (
                  <GroupMenu
                    color={g.color}
                    onRecolor={(c) => recolorGroup(g, c)}
                    onDelete={() => { if (confirm(`"${g.name}" 그룹을 삭제할까요? 항목은 삭제되지 않고 그룹만 해제됩니다.`)) deleteGroup(g); }}
                  />
                )}
              </div>

              {/* ── 표 ── */}
              {!isCollapsed && (
                <div className="overflow-x-auto rounded-md" style={{ boxShadow: "var(--shadow-sm)" }}>
                  <table className="border-collapse bg-[var(--bg-card)]" style={{ minWidth: 760, width: "100%" }}>
                    <thead>
                      <tr>
                        {/* 그룹색 스트립 (헤더는 둥근 모서리 시작) — 좌측 3칸은 가로 스크롤 시 고정(sticky) */}
                        <th style={{ width: STRIP_W, minWidth: STRIP_W, background: color, borderTopLeftRadius: 6, position: "sticky", left: 0, zIndex: 6 }} />
                        <th className="w-9 border border-[var(--border)] bg-[var(--bg-card)]" style={{ position: "sticky", left: STRIP_W, zIndex: 6 }}>
                          <input
                            type="checkbox"
                            checked={allChecked}
                            onChange={(e) => toggleSelectGroup(rows, e.target.checked)}
                            className="w-[15px] h-[15px] rounded cursor-pointer align-middle"
                            style={{ accentColor: MONDAY.primary }}
                          />
                        </th>
                        <th className="text-left px-3 border border-[var(--border)] bg-[var(--bg-card)] text-[13px] font-normal text-[var(--text-muted)] min-w-[260px]" style={{ height: ROW_H, position: "sticky", left: STRIP_W + 36, zIndex: 6 }}>
                          항목
                        </th>
                        {listColumns.map((c) => (
                          <th
                            key={c.id}
                            draggable
                            onDragStart={() => setDragCol(c.id)}
                            onDragOver={(e) => e.preventDefault()}
                            onDrop={() => { if (dragCol) moveColumn(dragCol, c.id); setDragCol(null); }}
                            onDragEnd={() => setDragCol(null)}
                            className={`border border-[var(--border)] bg-[var(--bg-card)] text-[13px] font-normal text-[var(--text-muted)] whitespace-nowrap min-w-[130px] text-center cursor-grab active:cursor-grabbing group/th ${dragCol === c.id ? "opacity-40" : ""}`}
                            style={{ height: ROW_H }}
                          >
                            <button onClick={() => setConfigCol(c)} className="inline-flex items-center gap-1 hover:text-[var(--text)] transition" title="컬럼 설정 (이름·옵션·색) · 드래그로 위치 변경">
                              {c.name}
                              <span className="text-[10px] opacity-0 group-hover/th:opacity-50 transition">⚙</span>
                            </button>
                          </th>
                        ))}
                        <th className="border border-[var(--border)] bg-[var(--bg-card)] w-10">
                          <AddColumnButton onAdd={(t) => addColumn(t, true)} />
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((d) => (
                        <tr key={d.id} className="group/row hover:bg-[var(--bg-surface)]/50">
                          <td style={{ width: STRIP_W, background: color, position: "sticky", left: 0, zIndex: 5 }} />
                          <td className="border border-[var(--border)] text-center bg-[var(--bg-card)] group-hover/row:bg-[var(--bg-surface)]" style={{ height: ROW_H, position: "sticky", left: STRIP_W, zIndex: 5 }}>
                            <input
                              type="checkbox"
                              checked={selected.has(d.id)}
                              onChange={() => toggleSelect(d.id)}
                              className="w-[15px] h-[15px] rounded cursor-pointer align-middle"
                              style={{ accentColor: MONDAY.primary }}
                            />
                          </td>
                          <td className="border border-[var(--border)] px-3 bg-[var(--bg-card)] group-hover/row:bg-[var(--bg-surface)]" style={{ height: ROW_H, position: "sticky", left: STRIP_W + 36, zIndex: 5 }}>
                            <div className="flex items-center justify-between gap-1.5">
                              <EditableText value={d.name} onSave={(v) => setName(d, v.trim() || d.name)} className="text-[14px] text-[var(--text)]" placeholder="업체명" />
                              <span className="flex items-center gap-1 shrink-0">
                                {/* 먼데이 말풍선 — 업데이트(히스토리). 글 있으면 카운트와 함께 상시 노출, 없으면 호버 시 + 말풍선 */}
                                {(() => {
                                  const n = updateCounts?.get(d.id) ?? 0;
                                  return (
                                    <button
                                      onClick={() => setUpdatesDeal(d)}
                                      className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded transition ${n > 0 ? "text-[var(--text-muted)] hover:text-[var(--text)]" : "opacity-0 group-hover/row:opacity-100 text-[var(--text-dim)] hover:text-[var(--text-muted)]"}`}
                                      title="업데이트 (메모·히스토리)"
                                    >
                                      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                        <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
                                        {n === 0 && <path d="M12 8v6M9 11h6" />}
                                      </svg>
                                      {n > 0 && <span className="text-[10px] font-bold" style={{ color: MONDAY.primary }}>{n}</span>}
                                    </button>
                                  );
                                })()}
                                <button
                                  onClick={() => setOpenDealId(d.id)}
                                  className="opacity-0 group-hover/row:opacity-100 transition inline-flex items-center gap-1 px-2 py-0.5 rounded text-[11px] font-semibold border shrink-0"
                                  style={{ color: MONDAY.primary, borderColor: MONDAY.primary, background: "transparent" }}
                                >
                                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M9 18l6-6-6-6" /></svg>
                                  열기
                                </button>
                              </span>
                            </div>
                          </td>
                          {listColumns.map((c) => {
                            const bound = isContractCol(c);
                            return (
                              <td key={c.id} className="border border-[var(--border)] p-0 text-center align-middle" style={{ height: ROW_H }}>
                                <Cell col={c}
                                  value={bound ? d.contract_total : d.column_values?.[c.id]}
                                  users={users}
                                  onChange={(v) => (bound ? setContractTotal(d, v) : setCell(d, c.id, v))} />
                              </td>
                            );
                          })}
                          <td className="border border-[var(--border)]" />
                        </tr>
                      ))}

                      {/* + 항목 추가 행 — 스트립은 연하게 이어짐. 좌측 3칸 sticky 로 가로 스크롤에도 고정 */}
                      <tr>
                        <td style={{ width: STRIP_W, background: `color-mix(in srgb, ${color} 45%, var(--bg-card))`, borderBottomLeftRadius: rows.length === 0 ? 6 : 0, position: "sticky", left: 0, zIndex: 5 }} />
                        <td className="border border-[var(--border)] bg-[var(--bg-card)]" style={{ height: ROW_H - 4, position: "sticky", left: STRIP_W, zIndex: 5 }} />
                        <td className="border border-[var(--border)] px-3 bg-[var(--bg-card)]" style={{ position: "sticky", left: STRIP_W + 36, zIndex: 5 }}>
                          <button onClick={() => addItem(gid)} className="text-[13px] text-[var(--text-dim)] hover:text-[var(--text)] transition inline-flex items-center gap-1.5 w-full text-left">
                            <span className="text-base leading-none">+</span> 항목 추가
                          </button>
                        </td>
                        <td colSpan={listColumns.length + 1} className="border border-[var(--border)]" />
                      </tr>

                      {/* 그룹 푸터: 상태 분포 바 + 숫자 합계 (먼데이 시그니처) */}
                      {rows.length > 0 && (
                        <tr>
                          <td style={{ width: STRIP_W, position: "sticky", left: 0, zIndex: 5, background: "var(--bg-card)" }} />
                          <td className="border-0 bg-[var(--bg-card)]" style={{ position: "sticky", left: STRIP_W, zIndex: 5 }} />
                          <td className="border-0 bg-[var(--bg-card)]" style={{ position: "sticky", left: STRIP_W + 36, zIndex: 5 }} />
                          {listColumns.map((c) => {
                            if (c.type === "status") {
                              const options: { id: string; label: string; color: string }[] = c.settings?.options || [];
                              const counts = new Map<string, number>();
                              rows.forEach((d) => { const v = d.column_values?.[c.id]; if (v) counts.set(v, (counts.get(v) || 0) + 1); });
                              const total = rows.length;
                              const empty = total - [...counts.values()].reduce((s, n) => s + n, 0);
                              return (
                                <td key={c.id} className="px-1 py-1.5 align-middle">
                                  {/* 분포 바 — 호버 시 살짝 떠오르고, 클릭하면 텍스트 내역 팝오버 */}
                                  <button
                                    onClick={(e) => setDistPop({
                                      anchor: e.currentTarget.getBoundingClientRect(),
                                      title: `${g?.name ?? "그룹 없음"} · ${c.name}`,
                                      rows: options.filter((o) => (counts.get(o.id) || 0) > 0).map((o) => ({ label: o.label, color: o.color, n: counts.get(o.id) || 0 })),
                                      total, empty,
                                    })}
                                    className="block w-full transition hover:-translate-y-px hover:shadow-md rounded cursor-pointer"
                                    title="클릭하면 상태별 내역을 봅니다"
                                  >
                                    <span className="flex h-6 rounded overflow-hidden">
                                      {options.map((o) => {
                                        const n = counts.get(o.id) || 0;
                                        return n > 0 ? <span key={o.id} className="transition hover:brightness-110" style={{ width: `${(n / total) * 100}%`, background: o.color }} /> : null;
                                      })}
                                      {empty > 0 && <span style={{ width: `${(empty / total) * 100}%`, background: "var(--bg-surface)" }} />}
                                    </span>
                                  </button>
                                </td>
                              );
                            }
                            if (c.type === "number") {
                              const bound = isContractCol(c);
                              const sum = rows.reduce((s, d) => s + (Number(bound ? d.contract_total : d.column_values?.[c.id]) || 0), 0);
                              return (
                                <td key={c.id} className="px-2 py-1.5 text-right align-middle">
                                  <div className="text-[13px] font-semibold mono-number text-[var(--text)]">{sum ? sum.toLocaleString("ko-KR") : "—"}</div>
                                  <div className="text-[9px] text-[var(--text-dim)] uppercase tracking-wide">합계</div>
                                </td>
                              );
                            }
                            return <td key={c.id} />;
                          })}
                          <td />
                        </tr>
                      )}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* ── 맨 아래: + 새 그룹 추가 (먼데이 위치) ── */}
      <button
        onClick={addGroup}
        className="mt-6 inline-flex items-center gap-1.5 px-3 h-8 rounded border border-[var(--border)] text-[13px] font-medium text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition"
      >
        <span className="text-base leading-none">+</span> 새 그룹 추가
      </button>

      {/* ── 플로팅 선택바 (먼데이 하단 블루바) ── */}
      {selected.size > 0 && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-40 flex items-center rounded-lg overflow-hidden shadow-xl border border-[var(--border)] bg-[var(--bg-card)]">
          <div className="flex items-center justify-center w-12 self-stretch text-white text-lg font-bold" style={{ background: MONDAY.primary }}>
            {selected.size}
          </div>
          <div className="px-4 py-2.5 text-[13px] font-semibold text-[var(--text)]">개 항목 선택됨</div>
          <MoveToGroupButton groups={groups} onMove={moveSelectedToGroup} />
          {selected.size === 1 && (
            <button onClick={() => { const id = [...selected][0]; setSelected(new Set()); setOpenDealId(id); }}
              className="px-4 py-2.5 self-stretch text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition border-l border-[var(--border)]">수정</button>
          )}
          <button onClick={deleteSelected}
            className="px-4 py-2.5 self-stretch text-[13px] font-semibold text-[var(--danger)] hover:bg-[var(--danger)]/10 transition border-l border-[var(--border)]">삭제</button>
          <button onClick={() => setSelected(new Set())} className="px-3 self-stretch text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition border-l border-[var(--border)]" aria-label="선택 해제">✕</button>
        </div>
      )}

      {configCol && (
        <ColumnConfigModal
          key={configCol.id}
          col={configCol}
          onClose={() => setConfigCol(null)}
          onSave={(patch) => saveColumn(configCol, patch)}
          onDelete={() => deleteColumn(configCol)}
        />
      )}

      {/* 푸터 분포 바 클릭 → 상태별 텍스트 내역 */}
      {distPop && (
        <DropMenu anchor={distPop.anchor} width={220} onClose={() => setDistPop(null)} pad="p-2.5">
          <div className="text-[11px] font-bold text-[var(--text)] mb-1.5 truncate">{distPop.title}</div>
          <div className="space-y-1">
            {distPop.rows.map((r) => (
              <div key={r.label} className="flex items-center gap-2 text-[12px]">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: r.color }} />
                <span className="flex-1 truncate text-[var(--text)]">{r.label}</span>
                <span className="font-semibold mono-number text-[var(--text)]">{r.n}/{distPop.total}</span>
                <span className="text-[var(--text-dim)] w-9 text-right mono-number">{Math.round((r.n / distPop.total) * 100)}%</span>
              </div>
            ))}
            {distPop.empty > 0 && (
              <div className="flex items-center gap-2 text-[12px]">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0 bg-[var(--bg-surface)] border border-[var(--border)]" />
                <span className="flex-1 text-[var(--text-dim)]">미지정</span>
                <span className="font-semibold mono-number text-[var(--text-muted)]">{distPop.empty}/{distPop.total}</span>
                <span className="text-[var(--text-dim)] w-9 text-right mono-number">{Math.round((distPop.empty / distPop.total) * 100)}%</span>
              </div>
            )}
            {distPop.rows.length === 0 && distPop.empty === 0 && (
              <div className="text-[11px] text-[var(--text-dim)]">항목 없음</div>
            )}
          </div>
        </DropMenu>
      )}

      {/* 먼데이 말풍선 — 아이템 업데이트 패널 */}
      {updatesDeal && (
        <ItemUpdatesPanel
          companyId={companyId}
          deal={updatesDeal}
          onClose={() => { setUpdatesDeal(null); qc.invalidateQueries({ queryKey: ["board-update-counts", companyId] }); }}
        />
      )}
    </div>
  );
}

// ── 먼데이 말풍선: 아이템 업데이트(히스토리) 우측 드로어 ──
//   board_item_updates 테이블(회사격리 RLS). 작성·목록·본인 글 삭제.
//   subitem 전달 시 = 해당 서브아이템 전용 피드 (subitem_id), 없으면 프로젝트 레벨(subitem_id null).
function ItemUpdatesPanel({ companyId, deal, subitem, onClose }: { companyId: string; deal: Deal; subitem?: { id: string; name: string } | null; onClose: () => void }) {
  const qc = useQueryClient();
  const [body, setBody] = useState("");
  const [me, setMe] = useState<{ id: string; name: string | null; email: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { getCurrentUser().then((u) => { if (u) setMe({ id: u.id, name: u.name, email: u.email }); }); }, []);

  const { data: updates = [] } = useQuery<any[]>({
    queryKey: ["board-item-updates", deal.id, subitem?.id ?? "deal"],
    queryFn: async () => {
      let qb = db.from("board_item_updates").select("*").eq("deal_id", deal.id);
      qb = subitem ? qb.eq("subitem_id", subitem.id) : qb.is("subitem_id", null);
      const { data } = await qb.order("created_at", { ascending: false }).limit(200);
      return (data || []) as any[];
    },
  });
  const refetch = () => qc.invalidateQueries({ queryKey: ["board-item-updates", deal.id, subitem?.id ?? "deal"] });

  const submit = async () => {
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    await db.from("board_item_updates").insert({
      company_id: companyId, deal_id: deal.id, subitem_id: subitem?.id ?? null,
      author_user_id: me?.id ?? null, author_name: me?.name || me?.email || null, body: text,
    });
    setBusy(false);
    setBody("");
    refetch();
  };
  const remove = async (id: string) => {
    await db.from("board_item_updates").delete().eq("id", id);
    refetch();
  };

  const rel = (iso: string) => {
    const diff = Date.now() - new Date(iso).getTime();
    const min = Math.floor(diff / 60000);
    if (min < 1) return "방금";
    if (min < 60) return `${min}분 전`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h}시간 전`;
    const d = Math.floor(h / 24);
    if (d < 7) return `${d}일 전`;
    return new Date(iso).toLocaleDateString("ko-KR");
  };

  return (
    <div className="fixed inset-0 z-[80] flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30" />
      <div className="relative w-full max-w-md h-full bg-[var(--bg-card)] border-l border-[var(--border)] shadow-2xl flex flex-col" onClick={(e) => e.stopPropagation()}>
        {/* 헤더 */}
        <div className="px-5 py-4 border-b border-[var(--border)] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="text-base font-bold text-[var(--text)] truncate">{subitem ? subitem.name : deal.name}</div>
            <div className="text-[11px] text-[var(--text-dim)] mt-0.5">
              {subitem ? `${deal.name} · 항목 업데이트` : "업데이트 · 메모와 진행 히스토리를 기록합니다"}
            </div>
          </div>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)] text-xl leading-none shrink-0">✕</button>
        </div>
        {/* 작성 박스 (먼데이처럼 상단) */}
        <div className="px-5 py-3 border-b border-[var(--border)]">
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) submit(); }}
            placeholder="업데이트 작성... (Ctrl+Enter 등록)"
            rows={3}
            className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] resize-none focus:outline-none"
            style={{ borderColor: body.trim() ? MONDAY.primary : undefined }}
          />
          <div className="flex justify-end mt-2">
            <button onClick={submit} disabled={!body.trim() || busy}
              className="px-4 h-8 rounded text-[13px] font-semibold text-white transition hover:brightness-110 disabled:opacity-40"
              style={{ background: MONDAY.primary }}>
              {busy ? "등록 중..." : "등록"}
            </button>
          </div>
        </div>
        {/* 피드 */}
        <div className="flex-1 overflow-y-auto px-5 py-3 space-y-3">
          {updates.length === 0 ? (
            <div className="py-12 text-center text-[13px] text-[var(--text-dim)]">
              <div className="text-3xl mb-2">💬</div>
              아직 업데이트가 없습니다.<br />첫 메모를 남겨보세요.
            </div>
          ) : updates.map((u) => (
            <div key={u.id} className="rounded-xl border border-[var(--border)] p-3 group/upd">
              <div className="flex items-center gap-2 mb-1.5">
                <span className="w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0"
                  style={{ background: avatarColor(u.author_user_id || u.author_name || "?") }}>
                  {initials(u.author_name || "?")}
                </span>
                <span className="text-[13px] font-semibold text-[var(--text)] truncate">{u.author_name || "알 수 없음"}</span>
                <span className="text-[11px] text-[var(--text-dim)] shrink-0">{rel(u.created_at)}</span>
                {me && u.author_user_id === me.id && (
                  <button onClick={() => remove(u.id)}
                    className="ml-auto opacity-0 group-hover/upd:opacity-100 text-[var(--text-dim)] hover:text-[var(--danger)] text-xs transition shrink-0" title="삭제">✕</button>
                )}
              </div>
              <div className="text-[13px] text-[var(--text)] whitespace-pre-wrap break-words leading-relaxed">{u.body}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ── 담당자 필터 (툴바) ──
function PersonFilterButton({ users, value, onChange }: { users: Person[]; value: string; onChange: (v: string) => void }) {
  const [open, setOpen] = useState(false);
  const cur = users.find((u) => u.id === value);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-1.5 h-8 px-2.5 rounded text-[13px] transition border ${value ? "border-[var(--primary)] text-[var(--primary)]" : "border-transparent text-[var(--text-muted)] hover:border-[var(--border)]"}`}
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
        {cur ? (cur.name || cur.email) : "담당자"}
        {value && <span onClick={(e) => { e.stopPropagation(); onChange(""); setOpen(false); }} className="ml-0.5 hover:opacity-70">✕</span>}
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 left-0 min-w-[180px] max-h-64 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-lg p-1">
            {users.map((u) => (
              <button key={u.id} onClick={() => { onChange(u.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] text-left text-[var(--text)] hover:bg-[var(--bg-surface)]">
                <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: avatarColor(u.id) }}>
                  {initials(u.name || u.email)}
                </span>
                <span className="truncate">{u.name || u.email}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── 그룹 ⋯ 메뉴 (색 변경 / 그룹 삭제) ──
function GroupMenu({ color, onRecolor, onDelete }: { color: string; onRecolor: (c: string) => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="w-6 h-6 rounded flex items-center justify-center text-[var(--text-dim)] hover:bg-[var(--bg-surface)] opacity-0 group-hover/ghead:opacity-100 transition"
        aria-label="그룹 메뉴"
      >
        <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor"><circle cx="5" cy="12" r="1.8" /><circle cx="12" cy="12" r="1.8" /><circle cx="19" cy="12" r="1.8" /></svg>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 left-0 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-lg p-2.5 w-[190px]">
            <div className="text-[11px] font-semibold text-[var(--text-dim)] mb-1.5">그룹 색상</div>
            <div className="grid grid-cols-6 gap-1.5 mb-2.5">
              {COLOR_PALETTE.map((c) => (
                <button key={c} onClick={() => { onRecolor(c); setOpen(false); }}
                  className={`w-6 h-6 rounded-md border-2 ${c === color ? "border-[var(--text)]" : "border-transparent"}`} style={{ background: c }} />
              ))}
            </div>
            <button onClick={() => { setOpen(false); onDelete(); }} className="w-full px-2 py-1.5 rounded text-[12px] text-left text-[var(--danger)] hover:bg-[var(--bg-surface)]">그룹 삭제</button>
          </div>
        </>
      )}
    </div>
  );
}

// ── 선택바: 그룹 이동 ──
function MoveToGroupButton({ groups, onMove }: { groups: Grp[]; onMove: (gid: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative self-stretch">
      <button onClick={() => setOpen((v) => !v)} className="h-full px-3 text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition border-l border-[var(--border)]">
        그룹 이동
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 bottom-full mb-1 left-0 min-w-[160px] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-lg p-1">
            {groups.map((g) => (
              <button key={g.id} onClick={() => { onMove(g.id); setOpen(false); }}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] text-left text-[var(--text)] hover:bg-[var(--bg-surface)]">
                <span className="w-2.5 h-2.5 rounded-sm shrink-0" style={{ background: g.color }} />
                {g.name}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ── 프로젝트 상세 = 먼데이 서브아이템 표 (리스트에서 전환).
//   헤더 첫 줄 = 컬럼(옆으로 추가/⚙설정), 아래 = 항목 행(밑으로 추가, 같은 컬럼 공유). ──
function DealDetailView({ companyId, deal, columns, users, updatesCount = 0, onOpenUpdates, onBack, onSetName, onAddColumn, onConfigColumn, onMoveColumn }: {
  companyId: string;
  deal: Deal;
  columns: Col[];
  users: Person[];
  updatesCount?: number;
  onOpenUpdates?: () => void;
  onBack: () => void;
  onSetName: (deal: Deal, name: string) => void;
  onAddColumn: (type: string) => void;
  onConfigColumn: (col: Col) => void;
  onMoveColumn: (draggedId: string, targetId: string) => void;
}) {
  const qc = useQueryClient();
  const [name, setNameLocal] = useState(deal.name);
  const [dragCol, setDragCol] = useState<string | null>(null);
  const SUB_COLOR = MONDAY.blue; // 먼데이 서브아이템 시그니처 블루 스트립

  const { data: items = [] } = useQuery<SubItem[]>({
    queryKey: ["project-subitems", deal.id],
    queryFn: async () => {
      const { data } = await db.from("project_subitems").select("*").eq("deal_id", deal.id).order("position");
      return (data || []).map((r: any) => ({ ...r, column_values: r.column_values || {} })) as SubItem[];
    },
  });
  const refetch = () => qc.invalidateQueries({ queryKey: ["project-subitems", deal.id] });

  // 항목(서브아이템)별 말풍선 — 업데이트 패널 대상 + 개수 배지
  const [updSub, setUpdSub] = useState<SubItem | null>(null);
  const { data: subCounts } = useQuery<Map<string, number>>({
    queryKey: ["subitem-update-counts", deal.id],
    queryFn: async () => {
      const { data } = await db.from("board_item_updates").select("subitem_id")
        .eq("deal_id", deal.id).not("subitem_id", "is", null).limit(2000);
      const m = new Map<string, number>();
      (data || []).forEach((r: any) => { if (r.subitem_id) m.set(r.subitem_id, (m.get(r.subitem_id) || 0) + 1); });
      return m;
    },
    staleTime: 30_000,
  });

  const addItem = async () => {
    await db.from("project_subitems").insert({ company_id: companyId, deal_id: deal.id, name: "새 항목", column_values: {}, position: items.length });
    refetch();
  };

  // 계약금액 롤업 (2026-06-12): 항목들의 계약금액 합 → 프로젝트(deals.contract_total) 자동 반영.
  //   전부 비어있으면 덮어쓰지 않음(수동 입력값 보호). 보드·통계 4카드 즉시 동기화.
  const rollupContract = async (nextItems: { column_values: Record<string, any> }[], colId: string) => {
    const vals = nextItems.map((x) => Number(x.column_values?.[colId])).filter((n) => !isNaN(n) && n !== 0);
    const hasAny = nextItems.some((x) => x.column_values?.[colId] !== null && x.column_values?.[colId] !== undefined && x.column_values?.[colId] !== "");
    if (!hasAny) return; // 항목 금액이 하나도 없으면 프로젝트 수동값 유지
    const sum = vals.reduce((s, n) => s + n, 0);
    await db.from("deals").update({ contract_total: sum }).eq("id", deal.id);
    qc.invalidateQueries({ queryKey: ["board-deals"] });
    qc.invalidateQueries({ queryKey: ["projects-deals"] });
  };

  const setItemCell = async (it: SubItem, colId: string, value: any) => {
    await db.from("project_subitems").update({ column_values: { ...(it.column_values || {}), [colId]: value } }).eq("id", it.id);
    const col = columns.find((c) => c.id === colId);
    if (col && isContractCol(col)) {
      const nextItems = items.map((x) => x.id === it.id ? { ...x, column_values: { ...(x.column_values || {}), [colId]: value } } : x);
      await rollupContract(nextItems, colId);
    }
    refetch();
  };
  const setItemName = async (it: SubItem, nm: string) => {
    if (nm === it.name) return;
    await db.from("project_subitems").update({ name: nm }).eq("id", it.id);
    refetch();
  };
  const delItem = async (it: SubItem) => {
    await db.from("project_subitems").delete().eq("id", it.id);
    const contractCol = columns.find((c) => isContractCol(c));
    if (contractCol) await rollupContract(items.filter((x) => x.id !== it.id), contractCol.id);
    refetch();
  };

  return (
    <div className="space-y-4 pb-10 panel-slide-in">
      {/* 뒤로가기 */}
      <div className="flex items-center gap-3">
        <button onClick={onBack}
          className="inline-flex items-center gap-1.5 px-3 h-8 rounded text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] border border-[var(--border)] transition shrink-0">
          ← 프로젝트 목록
        </button>
      </div>

      {/* 프로젝트명 (먼데이 아이템 페이지 타이틀) + 말풍선 업데이트 */}
      <div className="flex items-center gap-3">
        <input
          value={name}
          onChange={(e) => setNameLocal(e.target.value)}
          onBlur={() => onSetName(deal, name.trim() || deal.name)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
          placeholder="업체명"
          className="flex-1 min-w-0 bg-transparent text-2xl font-bold text-[var(--text)] focus:outline-none focus:border-b-2 pb-1"
          style={{ borderColor: MONDAY.primary }}
        />
        {onOpenUpdates && (
          <button
            onClick={onOpenUpdates}
            className="shrink-0 inline-flex items-center gap-1.5 px-3 h-9 rounded-lg border border-[var(--border)] text-[13px] font-semibold text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] transition"
            title="업데이트 (메모·히스토리)"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
            </svg>
            업데이트
            {updatesCount > 0 && (
              <span className="min-w-[18px] h-[18px] px-1 rounded-full text-[10px] font-bold text-white flex items-center justify-center" style={{ background: MONDAY.primary }}>
                {updatesCount}
              </span>
            )}
          </button>
        )}
      </div>

      {/* 표: 헤더=컬럼(옆으로 추가), 행=항목(밑으로 추가) */}
      <div className="overflow-x-auto rounded-md" style={{ boxShadow: "var(--shadow-sm)" }}>
        <table className="border-collapse bg-[var(--bg-card)]" style={{ minWidth: 720, width: "100%" }}>
          <thead>
            <tr>
              {/* 좌측 스트립 + 항목 칸은 가로 스크롤 시 고정(sticky) */}
              <th style={{ width: STRIP_W, minWidth: STRIP_W, background: SUB_COLOR, borderTopLeftRadius: 6, position: "sticky", left: 0, zIndex: 6 }} />
              <th className="text-left px-3 border border-[var(--border)] bg-[var(--bg-card)] text-[13px] font-normal text-[var(--text-muted)] min-w-[220px]" style={{ height: ROW_H, position: "sticky", left: STRIP_W, zIndex: 6 }}>
                항목
              </th>
              {columns.map((c) => (
                <th key={c.id} draggable
                  onDragStart={() => setDragCol(c.id)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => { if (dragCol) onMoveColumn(dragCol, c.id); setDragCol(null); }}
                  onDragEnd={() => setDragCol(null)}
                  className={`border border-[var(--border)] bg-[var(--bg-card)] text-[13px] font-normal text-[var(--text-muted)] whitespace-nowrap min-w-[130px] text-center cursor-grab active:cursor-grabbing group/th ${dragCol === c.id ? "opacity-40" : ""}`}
                  style={{ height: ROW_H }}>
                  <button onClick={() => onConfigColumn(c)} className="inline-flex items-center gap-1 hover:text-[var(--text)] transition" title="컬럼 설정 (이름·옵션·색) · 드래그로 위치 변경">
                    {c.name}
                    <span className="text-[10px] opacity-0 group-hover/th:opacity-50 transition">⚙</span>
                  </button>
                </th>
              ))}
              {/* 옆으로 컬럼 추가 */}
              <th className="border border-[var(--border)] bg-[var(--bg-card)] w-10"><AddColumnButton onAdd={onAddColumn} /></th>
            </tr>
          </thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id} className="group/row hover:bg-[var(--bg-surface)]/50">
                <td style={{ width: STRIP_W, background: SUB_COLOR, position: "sticky", left: 0, zIndex: 5 }} />
                <td className="border border-[var(--border)] px-3 bg-[var(--bg-card)] group-hover/row:bg-[var(--bg-surface)]" style={{ height: ROW_H, position: "sticky", left: STRIP_W, zIndex: 5 }}>
                  <div className="flex items-center gap-2">
                    <EditableText value={it.name} onSave={(v) => setItemName(it, v)} className="text-[14px] text-[var(--text)]" placeholder="항목명" />
                    <span className="ml-auto flex items-center gap-1 shrink-0">
                      {/* 항목별 말풍선 — 글 있으면 카운트 상시, 없으면 행 호버 시 + 말풍선 */}
                      {(() => {
                        const n = subCounts?.get(it.id) ?? 0;
                        return (
                          <button
                            onClick={() => setUpdSub(it)}
                            className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded transition ${n > 0 ? "text-[var(--text-muted)] hover:text-[var(--text)]" : "opacity-0 group-hover/row:opacity-100 text-[var(--text-dim)] hover:text-[var(--text-muted)]"}`}
                            title="업데이트 (메모·히스토리)"
                          >
                            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                              <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z" />
                              {n === 0 && <path d="M12 8v6M9 11h6" />}
                            </svg>
                            {n > 0 && <span className="text-[10px] font-bold" style={{ color: MONDAY.primary }}>{n}</span>}
                          </button>
                        );
                      })()}
                      <button onClick={() => delItem(it)} className="opacity-0 group-hover/row:opacity-100 text-[var(--text-dim)] hover:text-[var(--danger)] text-xs shrink-0 transition" title="항목 삭제">✕</button>
                    </span>
                  </div>
                </td>
                {columns.map((c) => (
                  <td key={c.id} className="border border-[var(--border)] p-0 text-center align-middle" style={{ height: ROW_H }}>
                    <Cell col={c} value={it.column_values?.[c.id]} users={users} onChange={(v) => setItemCell(it, c.id, v)} />
                  </td>
                ))}
                <td className="border border-[var(--border)]" />
              </tr>
            ))}
            {/* 밑으로 항목 추가 — 항목 칸 sticky 로 가로 스크롤에도 고정 */}
            <tr>
              <td style={{ width: STRIP_W, background: `color-mix(in srgb, ${SUB_COLOR} 45%, var(--bg-card))`, borderBottomLeftRadius: 6, position: "sticky", left: 0, zIndex: 5 }} />
              <td className="border border-[var(--border)] px-3 bg-[var(--bg-card)]" style={{ height: ROW_H - 4, position: "sticky", left: STRIP_W, zIndex: 5 }}>
                <button onClick={addItem} className="text-[13px] text-[var(--text-dim)] hover:text-[var(--text)] transition inline-flex items-center gap-1.5 w-full text-left">
                  <span className="text-base leading-none">+</span> 항목 추가
                </button>
              </td>
              <td colSpan={columns.length + 1} className="border border-[var(--border)]" />
            </tr>
            {/* 합계 행 — 숫자 컬럼 합산. 계약금액 컬럼 합은 프로젝트 계약금액으로 자동 반영(롤업) */}
            {items.length > 0 && columns.some((c) => c.type === "number") && (
              <tr>
                <td style={{ width: STRIP_W, position: "sticky", left: 0, zIndex: 5, background: "var(--bg-card)" }} />
                <td className="px-3 py-2 text-[11px] font-bold text-[var(--text-muted)] bg-[var(--bg-card)]" style={{ position: "sticky", left: STRIP_W, zIndex: 5 }}>합계</td>
                {columns.map((c) => {
                  if (c.type !== "number") return <td key={c.id} />;
                  const sum = items.reduce((s, it) => s + (Number(it.column_values?.[c.id]) || 0), 0);
                  const bound = isContractCol(c);
                  return (
                    <td key={c.id} className="px-2 py-2 text-center align-middle">
                      <div className="text-[12px] font-bold mono-number text-[var(--text)]">{sum ? sum.toLocaleString("ko-KR") : "—"}</div>
                      {bound && sum > 0 && <div className="text-[9px] font-semibold" style={{ color: MONDAY.primary }}>→ 프로젝트 계약금액 반영</div>}
                    </td>
                  );
                })}
                <td />
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 항목(서브아이템) 말풍선 업데이트 패널 */}
      {updSub && (
        <ItemUpdatesPanel
          companyId={companyId}
          deal={deal}
          subitem={{ id: updSub.id, name: updSub.name }}
          onClose={() => { setUpdSub(null); qc.invalidateQueries({ queryKey: ["subitem-update-counts", deal.id] }); }}
        />
      )}
    </div>
  );
}

// ── 컬럼 설정 모달 (이름 + 상태옵션 라벨/색 + 삭제) ──
const TYPE_LABEL: Record<string, string> = { text: "텍스트", status: "상태", date: "날짜", person: "담당자", number: "숫자" };

function ColumnConfigModal({ col, onClose, onSave, onDelete }: { col: Col; onClose: () => void; onSave: (patch: { name?: string; settings?: any }) => void; onDelete: () => void }) {
  const [name, setName] = useState(col.name);
  const [options, setOptions] = useState<{ id: string; label: string; color: string }[]>(col.settings?.options || []);
  const isStatus = col.type === "status";

  const addOption = () => setOptions((o) => [...o, { id: `o${Date.now()}`, label: "새 옵션", color: COLOR_PALETTE[o.length % COLOR_PALETTE.length] }]);
  const setOpt = (i: number, patch: Partial<{ label: string; color: string }>) => setOptions((o) => o.map((x, idx) => idx === i ? { ...x, ...patch } : x));
  const removeOpt = (i: number) => setOptions((o) => o.filter((_, idx) => idx !== i));
  const save = () => { onSave({ name: name.trim() || col.name, ...(isStatus ? { settings: { ...(col.settings || {}), options } } : {}) }); onClose(); };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/40" onClick={onClose}>
      <div className="glass-card w-full max-w-md p-5 max-h-[85vh] overflow-y-auto" onClick={(e) => e.stopPropagation()} style={{ background: "var(--bg-card)" }}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-base font-bold text-[var(--text)]">컬럼 설정 <span className="text-[11px] font-normal text-[var(--text-dim)]">· {TYPE_LABEL[col.type] || col.type}</span></h3>
          <button onClick={onClose} className="text-[var(--text-dim)] hover:text-[var(--text)]">✕</button>
        </div>

        <label className="block text-[11px] font-semibold text-[var(--text-muted)] mb-1">컬럼 이름</label>
        <input value={name} onChange={(e) => setName(e.target.value)}
          className="w-full px-3 py-2 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-sm text-[var(--text)] mb-4 focus:outline-none focus:border-[var(--primary)]" />

        {isStatus && (
          <div className="mb-4">
            <div className="text-[11px] font-semibold text-[var(--text-muted)] mb-2">상태 옵션 (라벨·색)</div>
            <div className="space-y-2">
              {options.map((o, i) => (
                <div key={o.id} className="flex items-center gap-2">
                  <ColorSwatch color={o.color} onChange={(c) => setOpt(i, { color: c })} />
                  <input value={o.label} onChange={(e) => setOpt(i, { label: e.target.value })}
                    className="flex-1 px-2.5 py-1.5 rounded text-sm font-semibold text-white focus:outline-none" style={{ background: o.color }} />
                  <button onClick={() => removeOpt(i)} className="text-[var(--text-dim)] hover:text-[var(--danger)] text-sm shrink-0">✕</button>
                </div>
              ))}
            </div>
            <button onClick={addOption} className="mt-2 text-[12px] font-semibold text-[var(--primary)] hover:underline">+ 옵션 추가</button>
          </div>
        )}

        <div className="flex items-center justify-between pt-3 border-t border-[var(--border)]">
          <button onClick={() => { if (confirm(`컬럼 "${col.name}" 삭제? 각 항목의 이 값도 사라집니다.`)) onDelete(); }}
            className="text-[12px] font-semibold text-[var(--danger)] hover:underline">컬럼 삭제</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm text-[var(--text-muted)] hover:bg-[var(--bg-surface)]">취소</button>
            <button onClick={save} className="px-4 py-2 rounded-lg text-sm font-semibold text-white" style={{ background: MONDAY.primary }}>저장</button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ColorSwatch({ color, onChange }: { color: string; onChange: (c: string) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative shrink-0">
      <button onClick={() => setOpen((v) => !v)} className="w-7 h-7 rounded-lg border border-black/10" style={{ background: color }} title="색 변경" />
      {open && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} />
          <div className="absolute z-20 mt-1 left-0 p-2 rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-lg grid grid-cols-6 gap-1.5 w-[180px]">
            {COLOR_PALETTE.map((c) => (
              <button key={c} onClick={() => { onChange(c); setOpen(false); }} className="w-6 h-6 rounded-md border border-black/10" style={{ background: c }} />
            ))}
          </div>
        </>
      )}
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
    return <PersonCell users={users} value={value} onChange={onChange} />;
  }
  if (col.type === "date") {
    return <DateCell value={value} onChange={onChange} />;
  }
  if (col.type === "number") {
    return <NumberCell value={value} onChange={onChange} />;
  }
  // text — 셀 전체가 클릭 타깃 (빈 값일 때 클릭 영역 0 으로 입력 불가하던 버그 수정)
  return <TextCell value={value} onChange={onChange} />;
}

// ── 텍스트 셀: 셀 전체 클릭 → 인라인 입력 ──
function TextCell({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<string>(value || "");
  useEffect(() => { setV(value || ""); }, [value]);
  if (editing) {
    return (
      <input
        autoFocus value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { setEditing(false); onChange(v); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setEditing(false); setV(value || ""); } }}
        className="w-full text-[13px] bg-transparent text-[var(--text)] text-center focus:outline-none"
        style={{ minHeight: ROW_H - 2 }}
      />
    );
  }
  return (
    <button onClick={() => setEditing(true)}
      className="w-full h-full flex items-center justify-center text-[13px] text-[var(--text)] hover:bg-[var(--bg-surface)]/60 transition truncate px-2"
      style={{ minHeight: ROW_H - 2 }}>
      {value || ""}
    </button>
  );
}

// ── 드롭다운 포털: 표의 overflow 컨테이너에 잘리지 않게 body 에 fixed 로 띄운다.
//   아래 공간이 부족하면 위로 펼침. 스크롤하면 자동 닫힘(앵커 어긋남 방지).
function DropMenu({ anchor, width, onClose, children, pad = "p-2" }: {
  anchor: DOMRect; width: number; onClose: () => void; children: React.ReactNode; pad?: string;
}) {
  useEffect(() => {
    const close = () => onClose();
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("scroll", close, true); window.removeEventListener("resize", close); };
  }, [onClose]);
  if (typeof document === "undefined") return null;
  const spaceBelow = window.innerHeight - anchor.bottom;
  const openUp = spaceBelow < 240 && anchor.top > spaceBelow;
  const left = Math.max(8, Math.min(anchor.left + anchor.width / 2 - width / 2, window.innerWidth - width - 8));
  const style: React.CSSProperties = {
    position: "fixed", left, width, zIndex: 70, maxHeight: 280, overflowY: "auto",
    ...(openUp ? { bottom: window.innerHeight - anchor.top + 4 } : { top: anchor.bottom + 4 }),
  };
  return createPortal(
    <>
      <div style={{ position: "fixed", inset: 0, zIndex: 69 }} onClick={onClose} />
      <div style={style} className={`rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-xl ${pad}`}>
        {children}
      </div>
    </>,
    document.body,
  );
}

// ── 상태 셀: 먼데이 시그니처 — 셀 전체 채움(라운드 0) + 포털 드롭다운(잘림 없음) ──
function StatusCell({ options, current, onPick }: { options: { id: string; label: string; color: string }[]; current?: { id: string; label: string; color: string }; onPick: (id: string) => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  return (
    <div className="relative w-full h-full">
      <button
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())}
        className="w-full h-full flex items-center justify-center text-[13px] font-medium text-white transition hover:brightness-95"
        style={{ background: current?.color || "var(--bg-surface)", color: current ? "#fff" : "var(--text-dim)", minHeight: ROW_H - 2 }}
      >
        {current?.label || ""}
      </button>
      {anchor && (
        <DropMenu anchor={anchor} width={170} onClose={() => setAnchor(null)}>
          <div className="space-y-1.5">
            {options.map((o) => (
              <button key={o.id} onClick={() => { onPick(o.id); setAnchor(null); }}
                className="w-full h-8 rounded text-[13px] font-medium text-white transition hover:brightness-110" style={{ background: o.color }}>
                {o.label}
              </button>
            ))}
            <button onClick={() => { onPick(""); setAnchor(null); }}
              className="w-full h-8 rounded text-[12px] text-[var(--text-dim)] border border-dashed border-[var(--border)] hover:bg-[var(--bg-surface)]">
              지우기
            </button>
          </div>
        </DropMenu>
      )}
    </div>
  );
}

// ── 담당자 셀: 이니셜 아바타 (먼데이 person 셀) — 포털 드롭다운 ──
function PersonCell({ users, value, onChange }: { users: Person[]; value: any; onChange: (v: any) => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const cur = users.find((u) => u.id === value);
  return (
    <div className="relative w-full h-full">
      <button onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())} className="w-full h-full flex items-center justify-center group/person" style={{ minHeight: ROW_H - 2 }}>
        {cur ? (
          <span className="w-[26px] h-[26px] rounded-full flex items-center justify-center text-[10px] font-bold text-white" style={{ background: avatarColor(cur.id) }} title={cur.name || cur.email}>
            {initials(cur.name || cur.email)}
          </span>
        ) : (
          <span className="w-[26px] h-[26px] rounded-full border border-dashed border-[var(--border)] flex items-center justify-center text-[var(--text-dim)] opacity-0 group-hover/person:opacity-100 transition">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
          </span>
        )}
      </button>
      {anchor && (
        <DropMenu anchor={anchor} width={190} onClose={() => setAnchor(null)} pad="p-1">
          {users.map((u) => (
            <button key={u.id} onClick={() => { onChange(u.id); setAnchor(null); }}
              className="w-full flex items-center gap-2 px-2 py-1.5 rounded text-[13px] text-left text-[var(--text)] hover:bg-[var(--bg-surface)]">
              <span className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-bold text-white shrink-0" style={{ background: avatarColor(u.id) }}>
                {initials(u.name || u.email)}
              </span>
              <span className="truncate">{u.name || u.email}</span>
            </button>
          ))}
          {value && (
            <button onClick={() => { onChange(null); setAnchor(null); }} className="w-full px-2 py-1.5 rounded text-[12px] text-[var(--text-dim)] text-left hover:bg-[var(--bg-surface)]">지우기</button>
          )}
        </DropMenu>
      )}
    </div>
  );
}

// ── 날짜 셀: "M월 D일" 표시, 클릭 시 네이티브 피커 ──
function DateCell({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const [editing, setEditing] = useState(false);
  if (editing) {
    return (
      <DateField autoFocus value={value || ""}
        onChange={(e) => { onChange(e.target.value || null); }}
        onBlur={() => setEditing(false)}
        className="w-full text-[12px] bg-transparent text-[var(--text)] text-center focus:outline-none"
        style={{ minHeight: ROW_H - 2 }}
      />
    );
  }
  let label = "";
  if (value) {
    const d = new Date(value);
    if (!isNaN(d.getTime())) {
      const now = new Date();
      label = d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1}월 ${d.getDate()}일` : `${d.getFullYear()}. ${d.getMonth() + 1}. ${d.getDate()}.`;
    }
  }
  return (
    <button onClick={() => setEditing(true)} className="w-full h-full flex items-center justify-center text-[13px] text-[var(--text)] hover:bg-[var(--bg-surface)]/60 transition group/date" style={{ minHeight: ROW_H - 2 }}>
      {label || (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="text-[var(--text-dim)] opacity-0 group-hover/date:opacity-100 transition">
          <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
        </svg>
      )}
    </button>
  );
}

// ── 숫자 셀: 표시는 천단위 콤마, 클릭 시 입력 ──
function NumberCell({ value, onChange }: { value: any; onChange: (v: any) => void }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState<string>(value ?? "");
  useEffect(() => { setV(value ?? ""); }, [value]);
  if (editing) {
    return (
      <input
        type="number" autoFocus value={v}
        onChange={(e) => setV(e.target.value)}
        onBlur={() => { setEditing(false); onChange(v === "" ? null : Number(v)); }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") { setEditing(false); setV(value ?? ""); } }}
        className="w-full text-[13px] bg-transparent text-[var(--text)] text-center mono-number focus:outline-none"
        style={{ minHeight: ROW_H - 2 }}
      />
    );
  }
  const num = value === null || value === undefined || value === "" ? null : Number(value);
  return (
    <button onClick={() => setEditing(true)} className="w-full h-full flex items-center justify-center text-[13px] mono-number text-[var(--text)] hover:bg-[var(--bg-surface)]/60 transition" style={{ minHeight: ROW_H - 2 }}>
      {num !== null && !isNaN(num) ? num.toLocaleString("ko-KR") : ""}
    </button>
  );
}

function AddColumnButton({ onAdd }: { onAdd: (type: string) => void }) {
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const TYPES: { t: string; label: string }[] = [
    { t: "status", label: "🟢 상태" }, { t: "text", label: "🔤 텍스트" }, { t: "person", label: "👤 담당자" },
    { t: "date", label: "📅 날짜" }, { t: "number", label: "🔢 숫자" },
  ];
  return (
    <div className="relative">
      <button onClick={(e) => setAnchor(anchor ? null : e.currentTarget.getBoundingClientRect())} className="w-7 h-7 rounded text-[var(--text-dim)] hover:text-[var(--text)] hover:bg-[var(--bg-surface)] text-lg leading-none" title="컬럼 추가">+</button>
      {anchor && (
        <DropMenu anchor={anchor} width={140} onClose={() => setAnchor(null)} pad="p-1">
          <div className="text-[10px] text-[var(--text-dim)] px-2 py-1 font-semibold">컬럼 타입</div>
          {TYPES.map((x) => (
            <button key={x.t} onClick={() => { onAdd(x.t); setAnchor(null); }} className="w-full px-2 py-1.5 rounded text-[12px] text-left text-[var(--text)] hover:bg-[var(--bg-surface)]">{x.label}</button>
          ))}
        </DropMenu>
      )}
    </div>
  );
}

function EditableText({ value, onSave, className = "", placeholder = "", center = false, style }: { value: string; onSave: (v: string) => void; className?: string; placeholder?: string; center?: boolean; style?: React.CSSProperties }) {
  const [editing, setEditing] = useState(false);
  const [v, setV] = useState(value);
  useEffect(() => { setV(value); }, [value]);
  if (editing) {
    return (
      <input autoFocus value={v} onChange={(e) => setV(e.target.value)}
        onBlur={() => { setEditing(false); onSave(v); }}
        onKeyDown={(e) => { if (e.key === "Enter") { setEditing(false); onSave(v); } if (e.key === "Escape") { setEditing(false); setV(value); } }}
        className={`bg-[var(--bg-card)] border rounded px-1.5 py-0.5 w-full focus:outline-none ${center ? "text-center" : ""} ${className}`}
        style={{ borderColor: MONDAY.primary, ...style }} />
    );
  }
  return (
    <span onClick={() => setEditing(true)} className={`cursor-text inline-block truncate max-w-full ${center ? "w-full text-center" : ""} ${className} ${!value ? "text-[var(--text-dim)]" : ""}`} style={style}>
      {value || placeholder}
    </span>
  );
}
