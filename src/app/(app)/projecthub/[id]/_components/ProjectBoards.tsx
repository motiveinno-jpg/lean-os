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
      toast(`'${tpl.name}' 표를 만들었습니다.`, "success");
    } catch (e: any) {
      toast(e?.message || "표 생성 실패", "error");
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
    if (!window.confirm(`'${board.name}' 표를 지울까요? 안에 입력한 행도 함께 사라집니다.`)) return;
    await db.from("project_boards").update({ archived_at: new Date().toISOString() }).eq("id", boardId);
    setActiveId("");
    qc.invalidateQueries({ queryKey: ["pb-boards", dealId] });
    toast("표를 지웠습니다.", "success");
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
    const label = { text: "텍스트", number: "숫자", date: "날짜", status: "상태", person: "사람" }[type];
    const settings = type === "status"
      ? { options: [{ id: "a", label: "미정", color: "#C4C4C4" }, { id: "b", label: "진행", color: "#FDAB3D" }, { id: "c", label: "완료", color: "#00C875" }] }
      : {};
    const { error } = await db.from("project_board_columns").insert({ board_id: boardId, name: label, type, settings, position: cols.length });
    if (error) { toast(error.message, "error"); return; }
    qc.invalidateQueries({ queryKey: ["pb-cols", boardId] });
  };

  if (isLoading) return <p className="pj-sec-empty">불러오는 중…</p>;

  // ── 표가 하나도 없을 때 — 템플릿부터 고르게 한다(빈 표 앞에서 막히지 않게) ──
  if (boards.length === 0 || picking) {
    return (
      <div className="pb-pick">
        <div className="pb-pick-head">
          <b>{boards.length === 0 ? "어떤 표로 시작할까요?" : "표 추가"}</b>
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
            <b>빈 표</b>
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
      {/* 표 탭 — ＋ 로 같은 프로젝트에 표를 더 붙인다 */}
      <div className="pb-tabs">
        {boards.map((b) => (
          <button key={b.id} type="button" onClick={() => { setActiveId(b.id); setShowSummary(false); }}
            onDoubleClick={() => { if (b.id === boardId) setRenaming(true); }}
            title="더블클릭하면 이름을 바꿉니다"
            className={`pb-tab ${b.id === boardId && !showSummary ? "pb-tab-on" : ""}`}>{b.name}</button>
        ))}
        <button type="button" className="pb-tab pb-tab-add" onClick={() => setPicking(true)} title="표 추가">＋</button>
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
            </select>
          </span>
          <button type="button" className="pb-mini" onClick={addGroup}>＋ 그룹</button>
          <button type="button" className="pb-mini pb-mini-x" onClick={removeBoard} title="이 표 지우기">표 삭제</button>
        </div>
      </div>

      {renaming && board && (
        <input autoFocus defaultValue={board.name} className="pb-rename"
          onBlur={(e) => renameBoard(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); if (e.key === "Escape") setRenaming(false); }} />
      )}

      {showSummary ? (
        <BoardSummary cols={cols} items={items} groups={groups} users={users} />
      ) : (<>

      {groups.map((g) => {
        const rows = itemsByGroup[g.id] || [];
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
                        <input defaultValue={c.name} className="pb-col-name"
                          onBlur={(e) => renameColumn(c, e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }} />
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
                          <Cell col={c} item={it} users={users} onSave={(v) => saveValue(it, c.id, v)} />
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

// ── 정리 — 컬럼 타입만 보고 만든 요약. 값이 없는 항목은 그리지 않는다 ──
function BoardSummary({ cols, items, groups, users }: {
  cols: BoardColumn[]; items: BoardItem[]; groups: BoardGroup[]; users: { id: string; name: string }[];
}) {
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name || "";
  const cards: SummaryCard[] = buildBoardSummary(cols, items, groups, nameOf, todayKst());
  if (cards.length === 0) {
    return <p className="pj-sec-empty">표에 값을 채우면 여기에 합계·분포·마감이 자동으로 정리돼요.</p>;
  }
  return (
    <div className="pb-sum-grid">
      {cards.map((c, i) => {
        if (c.kind === "number") return (
          <div key={i} className="pb-sum-card"><span>{c.label} 합계</span>
            <b>{c.sum.toLocaleString("ko-KR")}{c.unit}</b>
            <em>{c.filled}건 입력 · 평균 {c.avg.toLocaleString("ko-KR")}{c.unit}</em></div>
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
function Cell({ col, item, users, onSave }: {
  col: BoardColumn; item: BoardItem; users: { id: string; name: string }[]; onSave: (v: any) => void;
}) {
  const v = item.values?.[col.id];
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
