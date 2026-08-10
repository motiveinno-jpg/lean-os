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
//
//   2026-08-10 (사장님 지시) — "회의록 작성 시 입력이 불편하다. 이름을 누르면 오른쪽에 나오는데
//   메모 남기기가 작아서 글 쓰기가 힘들다."
//   → 안건마다 **그 자리에서 바로** 논의·결정을 적는다. 서랍을 열 일이 없어졌다.
//     · 기본은 펼친 상태다 — 회의록은 읽을 때도 쓸 때도 내용이 보여야 한다. 접기는 선택.
//     · 입력칸은 **쓰는 만큼 저절로 늘어난다**(최대 520px, 그 뒤로는 스크롤).
//     · 저장은 표와 **같은 경로**(saveValue)를 쓴다 — 화면마다 저장 방식이 갈리면 안 된다.
//     · 메모·파일·나머지 칸이 필요하면 '자세히' 로 서랍을 연다(예전 동작 그대로 남겨 둠).

import { useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import type { BoardColumn, BoardGroup, BoardItem } from "@/lib/project-boards";
import { flowColumnOf, START_DATE_RE } from "@/lib/project-boards";
import { growTextarea } from "@/lib/textarea";

export function BoardMinutes({
  items, cols, groups, users, activeGroupId, onPickGroup, onAddGroup,
  onAdd, onOpen, renderCell, onSaveCell, onSendToTodo, sending,
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
  /** 논의·결정 본문 저장 — 표가 쓰는 저장 함수를 그대로 받는다(위젯만 다르고 경로는 같다) */
  onSaveCell: (item: BoardItem, colId: string, value: any) => void | Promise<void>;
  /** 결정에 붙은 담당·기한을 그대로 '할 일' 표로 보낸다 */
  onSendToTodo: (item: BoardItem) => void;
  sending: string | null;
}) {
  const [draft, setDraft] = useState("");
  //   접어 둔 안건 — 기본은 펼침이라 '접은 것' 만 기억한다
  const [folded, setFolded] = useState<Set<string>>(() => new Set());
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

  const toggle = (id: string) => setFolded((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const foldAll = () => setFolded(rows.length === folded.size ? new Set() : new Set(rows.map((r) => r.id)));

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
          {rows.length > 1 && (
            <button type="button" className="pbm-foldall" onClick={foldAll}
              title="긴 회의는 접어 두고 제목만 훑어봅니다">
              {rows.length === folded.size ? "모두 펼치기" : "모두 접기"}
            </button>
          )}
        </header>

        <div className="pbm-agenda">
          {rows.map((it) => {
            const open = !folded.has(it.id);
            const written = String((textCol && it.values?.[textCol.id]) || "").trim();
            return (
              <article key={it.id} className={`pbm-item ${open ? "pbm-item-open" : ""}`}>
                <div className="pbm-item-t">
                  {flow && <span className="pbm-cell pbm-cell-status">{renderCell(flow, it)}</span>}
                  <button type="button" className="pbm-item-name" onClick={() => toggle(it.id)}
                    title={open ? "접기" : "펼쳐서 적기"}>
                    {it.name || "(안건 없음)"}
                  </button>
                  <button type="button" className="pbm-more" onClick={() => onOpen(it.id)}
                    title="메모 · 파일 · 모든 칸 보기">자세히</button>
                  <button type="button" className="pbm-caret" onClick={() => toggle(it.id)}
                    aria-expanded={open} title={open ? "접기" : "펼치기"}>{open ? "▾" : "▸"}</button>
                </div>

                {/*  논의 · 결정 — 그 자리에서 바로 적는다. 접으면 한 줄 요약만 보여 준다 */}
                {textCol && (open ? (
                  <AgendaText label={textCol.name} value={written}
                    onSave={(v) => onSaveCell(it, textCol.id, v)} />
                ) : (
                  <button type="button" className="pbm-peek" onClick={() => toggle(it.id)}>
                    {written ? written.replace(/\s*\n\s*/g, " ") : `${textCol.name}을 적으려면 누르세요`}
                  </button>
                ))}

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
            );
          })}

          <div className="pbm-add">
            <input value={draft} onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }}
              placeholder="＋ 안건을 적고 Enter — 논의·결정은 아래 칸에 바로 이어 씁니다" />
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

/** 논의 · 결정 본문 — 쓰는 만큼 늘어난다. 저장은 칸을 벗어날 때(표의 텍스트 칸과 같은 규칙). */
function AgendaText({ label, value, onSave }: {
  label: string; value: string; onSave: (v: string | null) => void;
}) {
  const ref = useRef<HTMLTextAreaElement | null>(null);
  //   열릴 때·바깥에서 값이 바뀔 때 높이를 맞춘다(내용이 잘려 보이지 않게)
  useEffect(() => { growTextarea(ref.current); }, [value]);
  return (
    <div className="pbm-write">
      <label>{label}</label>
      <textarea ref={ref} defaultValue={value} rows={3}
        placeholder="논의 내용과 결정을 적으세요. 줄을 나눠 적으면 나중에 읽기 좋아요. (Ctrl+Enter 로 저장)"
        onInput={(e) => growTextarea(e.currentTarget)}
        onBlur={(e) => { if (e.target.value !== value) onSave(e.target.value || null); }}
        onKeyDown={(e) => {
          if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) { e.preventDefault(); (e.target as HTMLTextAreaElement).blur(); }
        }} />
    </div>
  );
}
