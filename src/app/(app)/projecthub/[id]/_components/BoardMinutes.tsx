"use client";

// 회의록 — '회의 · 결정' 템플릿의 첫 화면 (2026-08-07 사장님 지시).
//
//   "템플릿이 다 똑같은 표라 실제 업무를 보는 데 의미가 있는지 모르겠다."
//   회의록은 격자가 아니라 **문서**다. 회의 머리(회차·날짜·담당) 아래로 안건을 이어 적고,
//   결정에 담당·기한을 붙이면 그대로 '할 일' 표로 넘어간다. 지난 회의는 옆에서 펼쳐 본다.
//
//   ⚠️ 표를 없애지 않는다 — 이 화면은 첫 화면일 뿐이고 '표'로 언제든 돌아간다.
//   칸 구성은 회사가 바꿀 수 있으므로 **이름이 아니라 형식으로** 칸을 찾는다
//   (상태=흐름 칸 / 결정=첫 글자 칸 / 담당=사람 칸 / 회의일·기한=날짜 칸 둘).

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import type { BoardColumn, BoardGroup, BoardItem } from "@/lib/project-boards";
import { flowColumnOf, START_DATE_RE } from "@/lib/project-boards";

export function BoardMinutes({
  items, cols, groups, users, activeGroupId, onPickGroup, onAddGroup,
  onAdd, onOpen, renderCell, onSendToTodo, sending,
}: {
  items: BoardItem[]; cols: BoardColumn[]; groups: BoardGroup[];
  users: { id: string; name: string }[];
  /** 지금 펼쳐 놓은 회의(그룹) */
  activeGroupId: string | null;
  onPickGroup: (id: string) => void;
  onAddGroup: () => void;
  onAdd: (groupId: string, name: string) => void;
  onOpen: (itemId: string) => void;
  /** 칸 하나를 그린다 — 표와 같은 입력기를 그대로 쓴다(두 곳에서 저장 방식이 갈리면 안 된다) */
  renderCell: (col: BoardColumn, item: BoardItem) => ReactNode;
  /** 결정에 붙은 담당·기한을 그대로 '할 일' 표로 보낸다 */
  onSendToTodo: (item: BoardItem) => void;
  sending: string | null;
}) {
  const [draft, setDraft] = useState("");
  const flow = flowColumnOf(cols);
  const textCol = cols.find((c) => c.type === "text") || null;
  const personCol = cols.find((c) => c.type === "person") || null;
  const dateCols = cols.filter((c) => c.type === "date");
  //   회의일 = 이름에 '회의'가 들어간 날짜 칸, 없으면 첫 날짜 칸. 기한 = 그 나머지.
  const meetCol = dateCols.find((c) => /회의|일자/.test(c.name)) || dateCols[0] || null;
  const dueCol = dateCols.find((c) => c !== meetCol && !START_DATE_RE.test(c.name)) || null;

  const gid = activeGroupId || groups[0]?.id || "";
  const rows = useMemo(() => items.filter((it) => it.group_id === gid), [items, gid]);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name || "";

  //   회의 머리에 적을 날짜 — 그 회의 안건들이 적어 둔 회의일 중 가장 이른 것
  const meetDate = useMemo(() => {
    if (!meetCol) return "";
    const ds = rows.map((r) => String(r.values?.[meetCol.id] || "").slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
    return ds.sort()[0] || "";
  }, [rows, meetCol]);

  //   담당으로 적힌 사람들 — '참석자' 라고 부르지 않는다(적힌 것은 담당이다)
  const owners = useMemo(() => {
    if (!personCol) return [] as string[];
    const set = new Set<string>();
    for (const r of rows) { const v = r.values?.[personCol.id]; if (v) set.add(String(v)); }
    return [...set];
  }, [rows, personCol]);

  const submit = () => {
    const v = draft.trim();
    if (!v || !gid) return;
    onAdd(gid, v);
    setDraft("");
  };

  return (
    <div className="pbm">
      <div className="pbm-main">
        <header className="pbm-head">
          <b>{groups.find((g) => g.id === gid)?.name || "회의"}</b>
          {meetDate && <time>{meetDate}</time>}
          <em>안건 {rows.length}건</em>
          {owners.length > 0 && (
            <span className="pbm-who" title={`담당 ${owners.map(nameOf).filter(Boolean).join(" · ")}`}>
              {owners.slice(0, 4).map((id) => <i key={id}>{(nameOf(id) || "?").slice(0, 1)}</i>)}
              {owners.length > 4 && <i>+{owners.length - 4}</i>}
            </span>
          )}
        </header>

        <div className="pbm-agenda">
          {rows.map((it) => (
            <article key={it.id} className="pbm-item">
              <div className="pbm-item-t">
                {flow && <span className="pbm-cell pbm-cell-status">{renderCell(flow, it)}</span>}
                <button type="button" className="pbm-item-name" onClick={() => onOpen(it.id)} title="자세히 열기">
                  {it.name || "(안건 없음)"}
                </button>
              </div>
              {textCol && <div className="pbm-decide">{renderCell(textCol, it)}</div>}
              <div className="pbm-foot">
                {personCol && <span className="pbm-cell">{renderCell(personCol, it)}</span>}
                {dueCol && <span className="pbm-cell">{renderCell(dueCol, it)}</span>}
                {/*  결정에는 다음 손이 붙어야 한다 — 담당·기한을 그대로 할 일로 넘긴다 */}
                <button type="button" className="pbm-send" disabled={sending === it.id}
                  onClick={() => onSendToTodo(it)}
                  title="담당·기한을 그대로 '할 일 · 진행' 표에 만듭니다">
                  {sending === it.id ? "보내는 중…" : "할 일로 보내기"}
                </button>
              </div>
            </article>
          ))}

          <div className="pbm-add">
            <input value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
              placeholder="＋ 안건을 적고 Enter — 결정·담당·기한은 그 자리에서 붙입니다" />
            <button type="button" onClick={submit} disabled={!draft.trim()}>추가</button>
          </div>
        </div>
      </div>

      <aside className="pbm-side">
        <b>회의</b>
        {/*  최신 회의가 위 — 새 회의를 만들면 맨 뒤에 붙어 아래로 밀렸다(2026-08-07 시연) */}
        {[...groups].reverse().map((g) => {
          const n = items.filter((it) => it.group_id === g.id).length;
          return (
            <button key={g.id} type="button" onClick={() => onPickGroup(g.id)}
              className={`pbm-past ${g.id === gid ? "pbm-past-on" : ""}`}>
              <span>{g.name}</span><em>안건 {n}</em>
            </button>
          );
        })}
        <button type="button" className="pbm-newmeet" onClick={onAddGroup}>＋ 새 회의</button>
      </aside>
    </div>
  );
}
