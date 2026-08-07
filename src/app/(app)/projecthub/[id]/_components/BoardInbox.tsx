"use client";

// 접수함 — '요청 · 검수' 템플릿의 첫 화면 (2026-08-07 사장님 지시).
//
//   요청은 격자를 채우는 일이 아니라 **넣고 받는 일**이다. 칸반은 전체 흐름을 볼 때 좋지만,
//   담당자가 실제로 알고 싶은 건 "내게 온 것이 몇 건이고 무엇이 급한가" 하나다.
//   그래서 첫 화면은 '내게 온 요청 / 내가 낸 요청 / 끝난 요청' 세 갈래 + 요청 넣기 폼이다.
//
//   ⚠️ 칸반·표는 그대로 남는다 — 이 화면은 첫 화면일 뿐이다.
//   칸 이름은 회사가 바꿀 수 있으므로 **형식으로** 찾는다(사람 칸 둘 = 요청자·담당).

import { useMemo, useState } from "react";
import { flowColumnOf, terminalOptionId, START_DATE_RE, type BoardColumn, type BoardGroup, type BoardItem, type StatusOption } from "@/lib/project-boards";
import { todayKst } from "@/lib/kst";

type Tab = "in" | "out" | "done";

export function BoardInbox({ items, cols, groups, users, userId, onAdd, onOpen, onAdvance }: {
  items: BoardItem[]; cols: BoardColumn[]; groups: BoardGroup[];
  users: { id: string; name: string }[];
  userId: string | null | undefined;
  /** 요청 넣기 — 이름 + 값(요청자·담당·기한) */
  onAdd: (groupId: string, name: string, values: Record<string, any>) => void;
  onOpen: (itemId: string) => void;
  /** 다음 단계로 — 흐름 칸의 다음 라벨로 옮긴다 */
  onAdvance: (item: BoardItem, nextOptionId: string) => void;
}) {
  const flow = flowColumnOf(cols);
  const options = ((flow?.settings?.options || []) as StatusOption[]);
  const doneId = flow ? terminalOptionId(flow) : null;
  //   사람 칸 둘 — 앞이 요청자, 뒤가 담당(템플릿 차례 그대로). 하나뿐이면 그게 담당이다.
  const personCols = cols.filter((c) => c.type === "person");
  const askerCol = personCols.length >= 2 ? personCols[0] : null;
  const ownerCol = personCols.length >= 2 ? personCols[1] : personCols[0] || null;
  const dueCol = cols.find((c) => c.type === "date" && !START_DATE_RE.test(c.name)) || null;

  const me = users.find((u) => u.id === userId)?.id || null;
  const [tab, setTab] = useState<Tab>("in");
  const [draft, setDraft] = useState({ name: "", owner: "", due: "" });
  const today = todayKst();
  const nameOf = (id: any) => users.find((u) => u.id === String(id || ""))?.name || "";

  const isDone = (it: BoardItem) => !!flow && !!doneId && it.values?.[flow.id] === doneId;
  const lists = useMemo(() => {
    const open = items.filter((it) => !isDone(it));
    return {
      in: me && ownerCol ? open.filter((it) => String(it.values?.[ownerCol.id] || "") === me) : open,
      out: me && askerCol ? open.filter((it) => String(it.values?.[askerCol.id] || "") === me) : [],
      done: items.filter(isDone),
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, me, ownerCol, askerCol, flow, doneId]);

  const rows = lists[tab];

  //   급한 정도 — 기한이 오늘 이전이면 위험, 사흘 안이면 주의. 색만으로 말하지 않고 글자로 함께 적는다.
  const dueOf = (it: BoardItem) => {
    if (!dueCol) return null;
    const v = String(it.values?.[dueCol.id] || "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
    const days = Math.round((new Date(`${v}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
    return { v, days, text: days < 0 ? `${-days}일 지남` : days === 0 ? "오늘까지" : `D-${days}`,
      tone: days < 0 ? "bad" : days <= 3 ? "warn" : "" };
  };
  const nextOf = (it: BoardItem) => {
    if (!flow) return null;
    const i = options.findIndex((o) => o.id === it.values?.[flow.id]);
    return options[i + 1] || (i < 0 ? options[0] : null) || null;
  };

  const submit = () => {
    const nm = draft.name.trim();
    const gid = groups[0]?.id;
    if (!nm || !gid) return;
    const values: Record<string, any> = {};
    if (askerCol && me) values[askerCol.id] = me;
    if (ownerCol && draft.owner) values[ownerCol.id] = draft.owner;
    if (dueCol && draft.due) values[dueCol.id] = draft.due;
    if (flow && options[0]) values[flow.id] = options[0].id;
    onAdd(gid, nm, values);
    setDraft({ name: "", owner: "", due: "" });
  };

  const TABS: { key: Tab; label: string }[] = [
    { key: "in", label: `내게 온 요청 ${lists.in.length}` },
    { key: "out", label: `내가 낸 요청 ${lists.out.length}` },
    { key: "done", label: "끝난 요청" },
  ];

  return (
    <div className="pbi">
      <div className="pbi-tabs">
        {TABS.map((t) => (
          <button key={t.key} type="button" onClick={() => setTab(t.key)}
            className={`pbi-tab ${tab === t.key ? "pbi-tab-on" : ""}`}>{t.label}</button>
        ))}
        {!me && <span className="pbi-note">내 계정이 구성원 목록에 없어 전부 보여 드려요</span>}
      </div>

      {rows.length === 0 ? (
        <p className="pj-sec-empty">
          {tab === "in" ? "내게 온 요청이 없어요." : tab === "out" ? "내가 낸 요청이 없어요." : "끝난 요청이 아직 없어요."}
        </p>
      ) : rows.map((it) => {
        const d = dueOf(it);
        const cur = flow ? options.find((o) => o.id === it.values?.[flow.id]) : null;
        const next = nextOf(it);
        return (
          <div key={it.id} className="pbi-row">
            <i className={`pbi-dot ${d?.tone === "bad" ? "pbi-bad" : d?.tone === "warn" ? "pbi-warn" : ""}`} />
            <button type="button" className="pbi-t" onClick={() => onOpen(it.id)}>
              <b>{it.name || "(제목 없음)"}</b>
              <span>
                {askerCol && nameOf(it.values?.[askerCol.id]) ? `${nameOf(it.values?.[askerCol.id])} 요청` : "요청자 미지정"}
                {cur ? ` · ${cur.label}` : ""}
                {ownerCol && nameOf(it.values?.[ownerCol.id]) ? ` · 담당 ${nameOf(it.values?.[ownerCol.id])}` : ""}
              </span>
            </button>
            {d && <span className={`pbi-due ${d.tone === "bad" ? "pbi-bad" : d.tone === "warn" ? "pbi-warn" : ""}`}>{d.text}</span>}
            {next && tab !== "done" && (
              <button type="button" className="pbi-act" onClick={() => onAdvance(it, next.id)}
                title={`'${next.label}' 단계로 옮깁니다`}>{next.label}로</button>
            )}
          </div>
        );
      })}

      <div className="pbi-new">
        <b>＋ 요청 넣기</b>
        <div className="pbi-fields">
          <input className="pbi-in pbi-in-full" value={draft.name} placeholder="무엇을 요청하나요"
            onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
          <select className="pbi-in" value={draft.owner} onChange={(e) => setDraft((p) => ({ ...p, owner: e.target.value }))} aria-label="담당">
            <option value="">누구에게 — 담당 고르기</option>
            {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
          </select>
          <input className="pbi-in" type="date" value={draft.due} aria-label="기한"
            onChange={(e) => setDraft((p) => ({ ...p, due: e.target.value }))} />
          <button type="button" className="pbi-go" onClick={submit} disabled={!draft.name.trim()}>요청 넣기</button>
        </div>
      </div>
    </div>
  );
}
