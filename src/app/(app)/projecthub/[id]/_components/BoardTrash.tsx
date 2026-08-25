"use client";

// 지운 항목 (휴지통) — 템플릿 · 그룹 · 컬럼 · 행 (2026-08-04 기획 2차).
//
//   원칙: 지우는 동작에는 항상 되돌리기가 붙는다.
//     ① 지운 직후 — 화면 아래 '되돌리기' 한 번 (UndoBar)
//     ② 놓쳤을 때 — 여기서 30일 안에 복구
//   30일이 지난 건 회색으로 표시하고 '완전 삭제' 만 남긴다(자동 정리 대상).

import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";

const db = supabase as any;
const KEEP_DAYS = 30;

type Kind = "board" | "group" | "column" | "item";
const KIND_LABEL: Record<Kind, string> = { board: "템플릿", group: "그룹", column: "컬럼", item: "행" };
const TABLE: Record<Kind, string> = {
  board: "project_boards", group: "project_board_groups",
  column: "project_board_columns", item: "project_board_items",
};

type TrashRow = { kind: Kind; id: string; name: string; archived_at: string; boardName?: string };

export function BoardTrash({ dealId, boardIds, boardNames, onClose }: {
  dealId: string;
  /** 이 프로젝트의 살아 있는 템플릿 id — 그룹·컬럼·행을 여기에 묶어 찾는다 */
  boardIds: string[];
  boardNames: Record<string, string>;
  onClose: () => void;
}) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["pb-trash", dealId, boardIds.length],
    queryFn: async () => {
      const out: TrashRow[] = [];
      const boards = logRead("BoardTrash:boards", await db.from("project_boards")
        .select("id, name, archived_at").eq("deal_id", dealId).not("archived_at", "is", null));
      for (const b of boards || []) out.push({ kind: "board", id: b.id, name: b.name, archived_at: b.archived_at });

      // 지워진 템플릿 안의 것까지 뒤지면 목록이 지저분해진다 — 살아 있는 템플릿의 것만 보여준다
      if (boardIds.length > 0) {
        const [gs, cs, its] = await Promise.all([
          db.from("project_board_groups").select("id, name, board_id, archived_at").in("board_id", boardIds).not("archived_at", "is", null),
          db.from("project_board_columns").select("id, name, board_id, archived_at").in("board_id", boardIds).not("archived_at", "is", null),
          db.from("project_board_items").select("id, name, board_id, archived_at").in("board_id", boardIds).not("archived_at", "is", null),
        ]);
        for (const g of gs.data || []) out.push({ kind: "group", id: g.id, name: g.name, archived_at: g.archived_at, boardName: boardNames[g.board_id] });
        for (const c of cs.data || []) out.push({ kind: "column", id: c.id, name: c.name, archived_at: c.archived_at, boardName: boardNames[c.board_id] });
        for (const i of its.data || []) out.push({ kind: "item", id: i.id, name: i.name || "(이름 없음)", archived_at: i.archived_at, boardName: boardNames[i.board_id] });
      }
      return out.sort((a, b) => (a.archived_at < b.archived_at ? 1 : -1));
    },
    enabled: !!dealId,
  });

  const refresh = () => {
    qc.invalidateQueries({ queryKey: ["pb-trash"] });
    qc.invalidateQueries({ queryKey: ["pb-boards", dealId] });
    qc.invalidateQueries({ queryKey: ["pb-cols"] });
    qc.invalidateQueries({ queryKey: ["pb-groups"] });
    qc.invalidateQueries({ queryKey: ["pb-items"] });
  };

  const daysAgo = (iso: string) => Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);

  const restore = async (r: TrashRow) => {
    await db.from(TABLE[r.kind]).update({ archived_at: null }).eq("id", r.id);
    refresh();
    toast(`${KIND_LABEL[r.kind]} '${r.name}' 을 되살렸습니다.`, "success");
  };

  const purge = async (r: TrashRow) => {
    if (!window.confirm(`${KIND_LABEL[r.kind]} '${r.name}' 을 완전히 지울까요? 되돌릴 수 없습니다.`)) return;
    await db.from(TABLE[r.kind]).delete().eq("id", r.id);
    refresh();
    toast("완전히 지웠습니다.", "success");
  };

  return (
    <div className="pb-doc-modal" onClick={onClose}>
      <div className="pb-doc-box" onClick={(e) => e.stopPropagation()}>
        <header className="pb-doc-head">
          <div>
            <b>지운 항목</b>
            <span>{KEEP_DAYS}일 안에는 되살릴 수 있습니다</span>
          </div>
          <button type="button" onClick={onClose} title="닫기">✕</button>
        </header>
        <div className="pb-trash-body">
          {isLoading ? <p className="pb-doc-hint">불러오는 중…</p>
            : rows.length === 0 ? <p className="pb-doc-hint">지운 것이 없습니다.</p>
            : rows.map((r) => {
              const d = daysAgo(r.archived_at);
              const over = d >= KEEP_DAYS;
              return (
                <div key={`${r.kind}-${r.id}`} className={`pb-trash-row ${over ? "pb-trash-old" : ""}`}>
                  <span className="pb-trash-kind">{KIND_LABEL[r.kind]}</span>
                  <span className="pb-trash-name">{r.name}{r.boardName && <em>{r.boardName}</em>}</span>
                  <span className="pb-trash-when">{d === 0 ? "오늘" : `${d}일 전`}</span>
                  {!over && <button type="button" className="pb-trash-back" onClick={() => restore(r)}>되돌리기</button>}
                  <button type="button" className="pb-trash-purge" onClick={() => purge(r)} title="완전 삭제">✕</button>
                </div>
              );
            })}
        </div>
      </div>
    </div>
  );
}
