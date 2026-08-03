"use client";

// 프로젝트 표(보드) 화면 — 새 프로젝트 구조 1단계 (2026-08-03 기획 v2).
//   상단 탭에서 표를 고르고(＋로 추가), 그룹 안에 행을 쌓고, 셀을 눌러 바로 고친다.
//   숫자 컬럼은 그룹마다 합계가 자동으로 붙는다.
//
// 설계 메모
//   · 값은 행의 values(jsonb)에 컬럼ID로 담는다 — 컬럼을 더해도 DB 구조를 안 바꾼다.
//   · 저장은 셀 단위 즉시 반영(낙관적 갱신 없이 서버 응답 후 무효화) — 입력 중 화면이 튀지 않게
//     텍스트·숫자는 blur/Enter 에서만 저장한다.
//   · 정렬은 position 오름차순. 새 행은 그룹 맨 아래.

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { DateField } from "@/components/date-field";
import { getPartners, upsertPartner } from "@/lib/partners";
import { todayKst } from "@/lib/kst";
import {
  BOARD_TEMPLATES, BLANK_TEMPLATE, findTemplate, ITEM_LABEL, sumColumn, buildBoardSummary,
  type BoardColumn, type BoardGroup, type BoardItem, type ColType, type SummaryCard,
} from "@/lib/project-boards";

// ⚠️ 새 표(project_board*)는 아직 생성된 DB 타입(src/types/database.ts)에 없다 —
//   타입 재생성(supabase gen types)은 CLI 가 있는 PC 에서 돌려야 해서, 그때까지는 느슨한 클라이언트를 쓴다.
//   (레포에 이미 쓰이는 방식: (supabase as any).from/rpc)
const db = supabase as any;
const won = (n: number) => Math.round(n).toLocaleString("ko-KR");

export function ProjectBoards({ dealId, companyId, users }: {
  dealId: string; companyId: string; users: { id: string; name: string }[];
}) {
  const qc = useQueryClient();
  const { toast } = useToast();
  const [activeId, setActiveId] = useState<string>("");
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [showSummary, setShowSummary] = useState(false);   // 마지막 탭 '정리'
  const [renaming, setRenaming] = useState(false);
  // 정렬 — 컬럼 이름을 누르면 그 컬럼 기준. 표마다 따로 기억한다(저장은 안 한다, 보기 상태일 뿐).
  const [sort, setSort] = useState<{ colId: string; dir: "asc" | "desc" } | null>(null);

  const { data: boards = [], isLoading } = useQuery({
    queryKey: ["pb-boards", dealId],
    queryFn: async () => {
      const data = logRead("ProjectBoards:boards", await db.from("project_boards")
        .select("id, name, template_key, position").eq("deal_id", dealId).is("archived_at", null)
        .order("position", { ascending: true }));
      return (data || []) as any[];
    },
    enabled: !!dealId,
  });

  const boardId = activeId && boards.some((b) => b.id === activeId) ? activeId : (boards[0]?.id || "");
  const board = boards.find((b) => b.id === boardId);

  const { data: cols = [] } = useQuery({
    queryKey: ["pb-cols", boardId],
    queryFn: async () => {
      const data = logRead("ProjectBoards:cols", await db.from("project_board_columns")
        .select("id, board_id, name, type, settings, position").eq("board_id", boardId).order("position", { ascending: true }));
      return (data || []) as BoardColumn[];
    },
    enabled: !!boardId,
  });
  const { data: groups = [] } = useQuery({
    queryKey: ["pb-groups", boardId],
    queryFn: async () => {
      const data = logRead("ProjectBoards:groups", await db.from("project_board_groups")
        .select("id, board_id, name, color, position").eq("board_id", boardId).order("position", { ascending: true }));
      return (data || []) as BoardGroup[];
    },
    enabled: !!boardId,
  });
  const { data: items = [] } = useQuery({
    queryKey: ["pb-items", boardId],
    queryFn: async () => {
      const data = logRead("ProjectBoards:items", await db.from("project_board_items")
        .select("id, board_id, group_id, parent_item_id, name, values, position").eq("board_id", boardId)
        .order("position", { ascending: true }));
      return (data || []) as BoardItem[];
    },
    enabled: !!boardId,
  });

  // ── 정리는 **프로젝트 전체** 를 본다(2026-08-03 시연: 표 3개짜리 프로젝트에서
  //    보고 있던 표 하나만 요약돼 "프로젝트 정리" 라는 이름과 어긋났다).
  //    누르기 전에는 안 불러온다 — 표 화면은 지금 보는 표만 있으면 된다.
  const boardIds = useMemo(() => boards.map((b) => b.id), [boards]);
  const { data: allCols = [] } = useQuery({
    queryKey: ["pb-all-cols", dealId, boardIds.length],
    queryFn: async () => {
      const data = logRead("ProjectBoards:allCols", await db.from("project_board_columns")
        .select("id, board_id, name, type, settings, position").in("board_id", boardIds).order("position", { ascending: true }));
      return (data || []) as BoardColumn[];
    },
    enabled: showSummary && boardIds.length > 0,
  });
  const { data: allGroups = [] } = useQuery({
    queryKey: ["pb-all-groups", dealId, boardIds.length],
    queryFn: async () => {
      const data = logRead("ProjectBoards:allGroups", await db.from("project_board_groups")
        .select("id, board_id, name, color, position").in("board_id", boardIds).order("position", { ascending: true }));
      return (data || []) as BoardGroup[];
    },
    enabled: showSummary && boardIds.length > 0,
  });
  const { data: allItems = [] } = useQuery({
    queryKey: ["pb-all-items", dealId, boardIds.length],
    queryFn: async () => {
      const data = logRead("ProjectBoards:allItems", await db.from("project_board_items")
        .select("id, board_id, group_id, parent_item_id, name, values, position").in("board_id", boardIds)
        .order("position", { ascending: true }).limit(2000));
      return (data || []) as BoardItem[];
    },
    enabled: showSummary && boardIds.length > 0,
  });

  // 거래처 컬럼이 있는 표에서만 목록을 불러온다(620개 규모 — 필요할 때만)
  const hasPartnerCol = cols.some((c) => c.type === "partner");
  const { data: partners = [] } = useQuery({
    queryKey: ["pb-partners", companyId],
    queryFn: () => getPartners(companyId),
    enabled: !!companyId && hasPartnerCol,
    staleTime: 5 * 60 * 1000,
  });

  const itemsByGroup = useMemo(() => {
    const m: Record<string, BoardItem[]> = {};
    for (const it of items) {
      const k = it.group_id || "__none__";
      (m[k] = m[k] || []).push(it);
    }
    return m;
  }, [items]);

  // ── 표 만들기 — 템플릿의 컬럼·그룹을 그대로 심는다 ──
  const createBoard = async (key: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const tpl = key === "blank" ? BLANK_TEMPLATE : findTemplate(key);
      const { data: b, error } = await db.from("project_boards").insert({
        company_id: companyId, deal_id: dealId, name: tpl.name, template_key: tpl.key, position: boards.length,
      }).select("id").single();
      if (error) throw new Error(error.message);
      const bid = b!.id as string;
      const colRows = tpl.columns.map((c, i) => ({ board_id: bid, name: c.name, type: c.type, settings: c.settings || {}, position: i }));
      const grpRows = tpl.groups.map((g, i) => ({ board_id: bid, name: g.name, color: g.color, position: i }));
      const [cRes, gRes] = await Promise.all([
        db.from("project_board_columns").insert(colRows),
        db.from("project_board_groups").insert(grpRows),
      ]);
      if (cRes.error) throw new Error(cRes.error.message);
      if (gRes.error) throw new Error(gRes.error.message);
      setActiveId(bid);
      setPicking(false);
      qc.invalidateQueries({ queryKey: ["pb-boards", dealId] });
      toast(`'${tpl.name}' 템플릿을 만들었습니다.`, "success");
    } catch (e: any) {
      toast(e?.message || "템플릿 생성 실패", "error");
    } finally {
      setBusy(false);
    }
  };

  const renameBoard = async (name: string) => {
    setRenaming(false);
    if (!board || !name.trim() || name === board.name) return;
    await db.from("project_boards").update({ name: name.trim() }).eq("id", boardId);
    qc.invalidateQueries({ queryKey: ["pb-boards", dealId] });
  };
  const removeBoard = async () => {
    if (!board) return;
    if (!window.confirm(`'${board.name}' 템플릿을 지울까요? 안에 입력한 행도 함께 사라집니다.`)) return;
    await db.from("project_boards").update({ archived_at: new Date().toISOString() }).eq("id", boardId);
    setActiveId("");
    qc.invalidateQueries({ queryKey: ["pb-boards", dealId] });
    toast("템플릿을 지웠습니다.", "success");
  };
  const renameGroup = async (g: BoardGroup, name: string) => {
    if (!name.trim() || name === g.name) return;
    await db.from("project_board_groups").update({ name: name.trim() }).eq("id", g.id);
    qc.invalidateQueries({ queryKey: ["pb-groups", boardId] });
  };
  const renameColumn = async (c: BoardColumn, name: string) => {
    if (!name.trim() || name === c.name) return;
    await db.from("project_board_columns").update({ name: name.trim() }).eq("id", c.id);
    qc.invalidateQueries({ queryKey: ["pb-cols", boardId] });
  };

  const removeColumn = async (c: BoardColumn) => {
    if (!window.confirm(`'${c.name}' 컬럼을 지울까요? 이 컬럼에 넣은 값도 화면에서 사라집니다.`)) return;
    await db.from("project_board_columns").delete().eq("id", c.id);
    if (sort?.colId === c.id) setSort(null);
    qc.invalidateQueries({ queryKey: ["pb-cols", boardId] });
  };
  // 숫자 컬럼 단위 — 단위를 알아야 '정리'가 합계를 제대로 읽는다(원끼리만 빼고, %는 평균을 낸다)
  const setUnit = async (c: BoardColumn, unit: string) => {
    const next = { ...(c.settings || {}), unit: unit.trim() || undefined };
    await db.from("project_board_columns").update({ settings: next }).eq("id", c.id);
    qc.invalidateQueries({ queryKey: ["pb-cols", boardId] });
  };

  const addItem = async (groupId: string) => {
    const pos = (itemsByGroup[groupId] || []).length;
    const { error } = await db.from("project_board_items").insert({ board_id: boardId, group_id: groupId, name: "", position: pos });
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
  };
  const saveName = async (item: BoardItem, name: string) => {
    if (name === item.name) return;
    await db.from("project_board_items").update({ name, updated_at: new Date().toISOString() }).eq("id", item.id);
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
  };
  const saveValue = async (item: BoardItem, colId: string, value: any) => {
    const next = { ...(item.values || {}), [colId]: value };
    await db.from("project_board_items").update({ values: next, updated_at: new Date().toISOString() }).eq("id", item.id);
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
  };
  const removeItem = async (item: BoardItem) => {
    await db.from("project_board_items").delete().eq("id", item.id);
    qc.invalidateQueries({ queryKey: ["pb-items", boardId] });
  };
  const addGroup = async () => {
    const { error } = await db.from("project_board_groups").insert({ board_id: boardId, name: `그룹 ${groups.length + 1}`, position: groups.length });
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-groups", boardId] });
  };
  const addColumn = async (type: ColType) => {
    const label = { text: "텍스트", number: "숫자", date: "날짜", status: "상태", person: "사람", partner: "거래처" }[type];
    const settings = type === "status"
      ? { options: [{ id: "a", label: "미정", color: "#C4C4C4" }, { id: "b", label: "진행", color: "#FDAB3D" }, { id: "c", label: "완료", color: "#00C875" }] }
      : {};
    const { error } = await db.from("project_board_columns").insert({ board_id: boardId, name: label, type, settings, position: cols.length });
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-cols", boardId] });
  };

  if (isLoading) return <p className="pj-sec-empty">불러오는 중…</p>;

  // ── 템플릿이 하나도 없을 때 — 고르는 화면부터 띄운다(빈 표 앞에서 막히지 않게) ──
  if (boards.length === 0 || picking) {
    return (
      <div className="pb-pick">
        <div className="pb-pick-head">
          <b>{boards.length === 0 ? "어떤 템플릿으로 시작할까요?" : "템플릿 추가"}</b>
          <span>부서가 아니라 <b>일의 형태</b>로 고릅니다 · 나중에 얼마든지 더 붙일 수 있어요</span>
          {boards.length > 0 && <button type="button" className="pb-pick-close" onClick={() => setPicking(false)}>닫기</button>}
        </div>
        <div className="pb-tpls">
          {BOARD_TEMPLATES.map((t) => (
            <button key={t.key} type="button" className="pb-tpl" disabled={busy} onClick={() => createBoard(t.key)}>
              <b>{t.name}</b>
              <span>{t.desc}</span>
              <em>{t.uses}</em>
              {/* 무슨 칸이 생기는지 미리 보여준다 — 이름보다 이게 고르는 기준이다 */}
              <span className="pb-tpl-cols">
                {[ITEM_LABEL[t.key] || "이름", ...t.columns.map((c) => c.name)].slice(0, 6).map((n) => (
                  <i key={n}>{n}</i>
                ))}
                {t.columns.length + 1 > 6 && <i className="pb-tpl-more">+{t.columns.length + 1 - 6}</i>}
              </span>
            </button>
          ))}
          <button type="button" className="pb-tpl pb-tpl-blank" disabled={busy} onClick={() => createBoard("blank")}>
            <b>빈 템플릿</b>
            <span>컬럼을 직접 만들어 씁니다</span>
            <em>위 형태에 안 맞는 일</em>
          </button>
        </div>
      </div>
    );
  }

  const nameLabel = ITEM_LABEL[board?.template_key || "blank"] || "이름";
  const numberCols = cols.filter((c) => c.type === "number");

  return (
    <div className="pb">
      {/* 템플릿 탭 — ＋ 로 같은 프로젝트에 템플릿을 더 붙인다 */}
      <div className="pb-tabs">
        {boards.map((b) => (
          <button key={b.id} type="button" onClick={() => { setActiveId(b.id); setShowSummary(false); setSort(null); }}
            onDoubleClick={() => { if (b.id === boardId) setRenaming(true); }}
            title="더블클릭하면 이름을 바꿉니다"
            className={`pb-tab ${b.id === boardId && !showSummary ? "pb-tab-on" : ""}`}>{b.name}</button>
        ))}
        <button type="button" className="pb-tab pb-tab-add" onClick={() => setPicking(true)} title="템플릿 추가">＋</button>
        {/* 정리 — 입력된 값만으로 자동 요약(2026-08-03 기획 v2 4단계) */}
        <button type="button" className={`pb-tab pb-tab-sum ${showSummary ? "pb-tab-on" : ""}`} onClick={() => setShowSummary(true)}>정리</button>
        <div className="pb-tab-tools">
          <span className="pb-addcol">
            컬럼 추가
            <select value="" onChange={(e) => { if (e.target.value) addColumn(e.target.value as ColType); }}>
              <option value="">선택</option>
              <option value="text">텍스트</option>
              <option value="number">숫자</option>
              <option value="date">날짜</option>
              <option value="status">상태</option>
              <option value="person">사람</option>
              <option value="partner">거래처</option>
            </select>
          </span>
          <button type="button" className="pb-mini" onClick={addGroup}>＋ 그룹</button>
          <button type="button" className="pb-mini pb-mini-x" onClick={removeBoard} title="이 템플릿 지우기">템플릿 삭제</button>
        </div>
      </div>

      {renaming && board && (
        <input autoFocus defaultValue={board.name} className="pb-rename"
          onBlur={(e) => renameBoard(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(false); }} />
      )}

      {showSummary ? (
        <ProjectSummary boards={boards} cols={allCols} groups={allGroups} items={allItems} users={users} />
      ) : (<>

      {groups.map((g) => {
        const rows = sortRows(itemsByGroup[g.id] || [], sort, cols, users);
        return (
          <section key={g.id} className="pb-group">
            <div className="pb-group-head">
              <span className="pb-group-dot" style={{ background: g.color }} />
              <input defaultValue={g.name} className="pb-group-name"
                onBlur={(e) => renameGroup(g, e.target.value)}
                onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
              <span className="pb-group-n">{rows.length}건</span>
            </div>
            <div className="pb-scroll">
              <table className="pb-table">
                <thead>
                  <tr>
                    <th className="pb-th-name">{nameLabel}</th>
                    {cols.map((c) => (
                      <th key={c.id} className={c.type === "number" ? "pb-th-num" : ""}>
                        <span className="pb-th-in">
                          <input defaultValue={c.name} className="pb-col-name"
                            onBlur={(e) => renameColumn(c, e.target.value)}
                            onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                          {/* 정렬 — 화살표를 눌러야 정렬된다(이름 칸은 이름 고치는 자리라 겹치면 안 된다) */}
                          <button type="button" className={`pb-col-sort ${sort?.colId === c.id ? "pb-col-sort-on" : ""}`}
                            title="이 컬럼으로 정렬"
                            onClick={() => setSort((s0) => s0?.colId === c.id ? (s0.dir === "asc" ? { colId: c.id, dir: "desc" } : null) : { colId: c.id, dir: "asc" })}>
                            {sort?.colId === c.id ? (sort.dir === "asc" ? "▲" : "▼") : "↕"}
                          </button>
                          {/* 숫자 컬럼은 단위를 직접 정한다 — 정리가 원끼리만 빼고 %는 평균을 낸다 */}
                          {c.type === "number" && (
                            <input defaultValue={c.settings?.unit || ""} placeholder="단위" className="pb-col-unit"
                              onBlur={(e) => setUnit(c, e.target.value)}
                              onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
                          )}
                          <button type="button" className="pb-col-x" title="이 컬럼 지우기" onClick={() => removeColumn(c)}>✕</button>
                        </span>
                      </th>
                    ))}
                    <th className="pb-th-x" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((it) => (
                    <tr key={it.id}>
                      <td className="pb-td-name">
                        <input defaultValue={it.name} placeholder={`${nameLabel} 입력`}
                          onBlur={(e) => saveName(it, e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                          className="pb-in" />
                      </td>
                      {cols.map((c) => (
                        <td key={c.id} className={c.type === "number" ? "pb-td-num" : ""}>
                          <Cell col={c} item={it} users={users} partners={partners as any[]} companyId={companyId}
                            onPartnerCreated={() => qc.invalidateQueries({ queryKey: ["pb-partners", companyId] })}
                            onSave={(v) => saveValue(it, c.id, v)} />
                        </td>
                      ))}
                      <td className="pb-td-x">
                        <button type="button" className="pb-x" title="행 삭제" onClick={() => removeItem(it)}>✕</button>
                      </td>
                    </tr>
                  ))}
                  <tr>
                    <td colSpan={cols.length + 2} className="pb-add" onClick={() => addItem(g.id)}>＋ {nameLabel} 추가</td>
                  </tr>
                  {rows.length > 0 && numberCols.length > 0 && (
                    <tr className="pb-sum">
                      <td>합계</td>
                      {cols.map((c) => (
                        <td key={c.id} className={c.type === "number" ? "pb-td-num" : ""}>
                          {c.type === "number" ? won(sumColumn(rows, c.id)) : ""}
                        </td>
                      ))}
                      <td />
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </section>
        );
      })}
      </>)}
    </div>
  );
}

/** 행 정렬 — 컬럼 타입에 맞게. 값이 빈 행은 방향과 무관하게 늘 뒤로 보낸다. */
function sortRows(rows: BoardItem[], sort: { colId: string; dir: "asc" | "desc" } | null,
  cols: BoardColumn[], users: { id: string; name: string }[]): BoardItem[] {
  if (!sort) return rows;
  const c = cols.find((x) => x.id === sort.colId);
  if (!c) return rows;
  const key = (it: BoardItem): string | number | null => {
    const v = it.values?.[c.id];
    if (v === null || v === undefined || v === "") return null;
    if (c.type === "number") return Number(v) || 0;
    if (c.type === "status") {
      const i = (c.settings?.options || []).findIndex((o: any) => o.id === v);
      return i < 0 ? null : i;
    }
    if (c.type === "person") return users.find((u) => u.id === v)?.name || "";
    return String(v);
  };
  const sign = sort.dir === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const ka = key(a), kb = key(b);
    if (ka === null && kb === null) return 0;
    if (ka === null) return 1;      // 빈 값은 늘 아래
    if (kb === null) return -1;
    if (typeof ka === "number" && typeof kb === "number") return (ka - kb) * sign;
    return String(ka).localeCompare(String(kb), "ko") * sign;
  });
}

// ── 프로젝트 정리 — 이 프로젝트의 **모든 템플릿**을 하나씩 구획으로 ──
//   한 프로젝트에 템플릿을 여러 개 붙이는 게 기본이라(＋), 정리도 그 단위여야 맞다.
function ProjectSummary({ boards, cols, groups, items, users }: {
  boards: { id: string; name: string; template_key: string | null }[];
  cols: BoardColumn[]; groups: BoardGroup[]; items: BoardItem[]; users: { id: string; name: string }[];
}) {
  const filled = boards.filter((b) => items.some((i) => i.board_id === b.id));
  if (filled.length === 0) {
    return <p className="pj-sec-empty">템플릿에 값을 채우면 여기에 합계·분포·마감이 자동으로 정리돼요.</p>;
  }
  return (
    <div className="pb-sum-all">
      <p className="pb-sum-top">템플릿 {filled.length}개 · 총 {items.length}행 — 입력된 칸만 요약했어요.</p>
      {filled.map((b) => (
        <section key={b.id} className="pb-sum-sec">
          <h4 className="pb-sum-sec-h">{b.name}<em>{items.filter((i) => i.board_id === b.id).length}행</em></h4>
          <BoardSummary
            cols={cols.filter((c) => c.board_id === b.id)}
            items={items.filter((i) => i.board_id === b.id)}
            groups={groups.filter((g) => g.board_id === b.id)}
            users={users} />
        </section>
      ))}
    </div>
  );
}

// ── 템플릿 하나 — 컬럼 타입만 보고 만든 요약. 값이 없는 항목은 그리지 않는다 ──
function BoardSummary({ cols, items, groups, users }: {
  cols: BoardColumn[]; items: BoardItem[]; groups: BoardGroup[]; users: { id: string; name: string }[];
}) {
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name || "";
  const cards: SummaryCard[] = buildBoardSummary(cols, items, groups, nameOf, todayKst());
  if (cards.length === 0) {
    return <p className="pj-sec-empty">템플릿에 값을 채우면 여기에 합계·분포·마감이 자동으로 정리돼요.</p>;
  }
  return (
    <div className="pb-sum-grid">
      {cards.map((c, i) => {
        if (c.kind === "number") return (
          <div key={i} className="pb-sum-card"><span>{c.label} {c.mode === "avg" ? "평균" : "합계"}</span>
            <b>{(c.mode === "avg" ? c.avg : c.sum).toLocaleString("ko-KR")}{c.unit}</b>
            <em>{c.filled}건 입력{c.mode === "avg" ? "" : ` · 평균 ${c.avg.toLocaleString("ko-KR")}${c.unit}`}</em></div>
        );
        if (c.kind === "weighted") return (
          <div key={i} className="pb-sum-card"><span>{c.label}</span>
            <b>{c.value.toLocaleString("ko-KR")}원</b>
            <em>{c.a} × {c.b} — 확률까지 반영한 값</em></div>
        );
        if (c.kind === "diff") return (
          <div key={i} className="pb-sum-card"><span>{c.label}</span>
            <b className={c.value < 0 ? "pb-sum-bad" : "pb-sum-ok"}>{c.value.toLocaleString("ko-KR")}{c.unit}</b>
            <em>{c.a}에서 {c.b}을 뺀 값</em></div>
        );
        if (c.kind === "status" || c.kind === "group") {
          const total = c.parts.reduce((n, p) => n + p.count, 0) || 1;
          return (
            <div key={i} className="pb-sum-card pb-sum-wide"><span>{c.label}</span>
              <b>{c.kind === "status" && c.doneRate != null ? `완료율 ${c.doneRate}%` : `${total}건`}</b>
              <span className="pb-sum-bar">
                {c.parts.map((p) => <i key={p.label} style={{ width: `${(p.count / total) * 100}%`, background: p.color }} />)}
              </span>
              <span className="pb-sum-legend">
                {c.parts.map((p) => <span key={p.label}><i style={{ background: p.color }} />{p.label} {p.count}</span>)}
              </span></div>
          );
        }
        if (c.kind === "date") return (
          <div key={i} className="pb-sum-card"><span>{c.label}</span>
            <b className={c.late > 0 ? "pb-sum-bad" : ""}>{c.late > 0 ? `지난 것 ${c.late}건` : `이번 주 ${c.soon}건`}</b>
            <em>{c.next ? `다음 ${c.next}` : "예정된 날짜 없음"}{c.late > 0 ? ` · 이번 주 ${c.soon}건` : ""}</em></div>
        );
        return (
          <div key={i} className="pb-sum-card pb-sum-wide"><span>{c.label}별</span>
            <b>{c.rows.length}명</b>
            <em>{c.rows.map((r) => `${r.name} ${r.count}건`).join(" · ")}</em></div>
        );
      })}
    </div>
  );
}

// ── 셀 — 타입별 편집기. 다섯 가지만 쓴다(텍스트·숫자·날짜·상태·사람) ──
function Cell({ col, item, users, partners, companyId, onSave, onPartnerCreated }: {
  col: BoardColumn; item: BoardItem; users: { id: string; name: string }[];
  partners: { id: string; name: string; business_number?: string | null }[];
  companyId: string; onSave: (v: any) => void; onPartnerCreated: () => void;
}) {
  const v = item.values?.[col.id];
  if (col.type === "partner") {
    return <PartnerCell value={v || ""} partners={partners} companyId={companyId} onSave={onSave} onCreated={onPartnerCreated} />;
  }
  if (col.type === "number") {
    return (
      <input defaultValue={v == null || v === "" ? "" : Number(v).toLocaleString("ko-KR")} inputMode="numeric" placeholder="0"
        onBlur={(e) => {
          const n = Number(String(e.target.value).replace(/[^0-9.-]/g, ""));
          e.target.value = n ? n.toLocaleString("ko-KR") : "";
          onSave(Number.isFinite(n) && e.target.value !== "" ? n : null);
        }}
        onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
        className="pb-in pb-in-num" />
    );
  }
  if (col.type === "date") {
    return <DateField value={v || ""} onChange={(e) => onSave(e.target.value || null)} className="pb-in pb-in-date" />;
  }
  if (col.type === "status") {
    const options: any[] = col.settings?.options || [];
    const cur = options.find((o) => o.id === v);
    return (
      <span className="pb-status" style={cur ? { background: cur.color } : undefined}>
        <select value={v || ""} onChange={(e) => onSave(e.target.value || null)}>
          <option value="">—</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
        <i>{cur?.label || "—"}</i>
      </span>
    );
  }
  if (col.type === "person") {
    return (
      <select value={v || ""} onChange={(e) => onSave(e.target.value || null)} className="pb-in pb-in-sel">
        <option value="">—</option>
        {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
      </select>
    );
  }
  return (
    <input defaultValue={v || ""} placeholder="—"
      onBlur={(e) => onSave(e.target.value || null)}
      onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
      className="pb-in" />
  );
}

// ── 거래처 셀 — 검색해서 고르고, 없으면 그 자리에서 만든다(전표입력과 같은 방식) ──
//   값은 partners.id 를 담는다. 이름만으로 만들 수 있게 해서 입력이 끊기지 않게 한다.
function PartnerCell({ value, partners, companyId, onSave, onCreated }: {
  value: string; partners: { id: string; name: string; business_number?: string | null }[];
  companyId: string; onSave: (v: any) => void; onCreated: () => void;
}) {
  const { toast } = useToast();
  const cur = partners.find((p) => p.id === value);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [saving, setSaving] = useState(false);

  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return partners.slice(0, 20);
    const tn = t.replace(/-/g, "");
    return partners.filter((p) =>
      (p.name || "").toLowerCase().includes(t) || (p.business_number || "").replace(/-/g, "").includes(tn)
    ).slice(0, 30);
  }, [partners, q]);
  const exact = matches.some((p) => (p.name || "").trim() === q.trim());

  const createNow = async () => {
    const name = q.trim();
    if (!name || saving) return;
    setSaving(true);
    try {
      const row: any = await upsertPartner({ companyId, name });
      const id = row?.id || row?.data?.id;
      if (!id) throw new Error("등록 실패");
      onSave(id);
      onCreated();
      setOpen(false);
      setQ("");
      toast(`'${name}' 거래처를 등록했습니다.`, "success");
    } catch (e: any) {
      toast(e?.message || "거래처 등록 실패", "error");
    } finally {
      setSaving(false);
    }
  };

  if (!open) {
    return (
      <button type="button" className="pb-in pb-partner-btn" onClick={() => { setOpen(true); setQ(""); }}>
        {cur?.name || <span className="pb-partner-empty">거래처 선택</span>}
      </button>
    );
  }
  return (
    <span className="pb-partner">
      <input autoFocus value={q} placeholder="거래처 검색 또는 새 이름"
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Escape") { setOpen(false); return; }
          if (e.key === "Enter") { if (matches.length === 1 && !q.trim()) return; if (!exact && q.trim()) createNow(); else if (matches[0]) { onSave(matches[0].id); setOpen(false); } }
        }}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
        className="pb-in pb-partner-in" />
      <span className="pb-partner-pop">
        {value && (
          <button type="button" className="pb-partner-opt pb-partner-clear" onMouseDown={(e) => { e.preventDefault(); onSave(null); setOpen(false); }}>선택 해제</button>
        )}
        {matches.map((p) => (
          <button key={p.id} type="button" className="pb-partner-opt"
            onMouseDown={(e) => { e.preventDefault(); onSave(p.id); setOpen(false); }}>
            {p.name}{p.business_number ? <em>{p.business_number}</em> : null}
          </button>
        ))}
        {q.trim() && !exact && (
          <button type="button" className="pb-partner-opt pb-partner-new" disabled={saving}
            onMouseDown={(e) => { e.preventDefault(); createNow(); }}>
            ＋ &apos;{q.trim()}&apos; 새 거래처로 등록
          </button>
        )}
        {matches.length === 0 && !q.trim() && <span className="pb-partner-none">등록된 거래처가 없어요</span>}
      </span>
    </span>
  );
}
