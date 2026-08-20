"use client";

// 만기 카드 — '계약 · 갱신' 템플릿의 첫 화면 (2026-08-07 사장님 지시).
//
//   이 일의 위험은 하나, **만기를 놓치는 것**이다. 목록을 훑는 대신 임박한 순으로 세우고
//   지난 것은 맨 위에 빨갛게 올린다. 카드에서 바로 계약서를 만들어 전자서명까지 간다.
//
//   ⚠️ 표는 그대로 남는다 — 이 화면은 첫 화면일 뿐이다.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { flowColumnOf, START_DATE_RE, type BoardColumn, type BoardGroup, type BoardItem, type StatusOption } from "@/lib/project-boards";
import { todayKst } from "@/lib/kst";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

export function BoardExpiry({ items, cols, groups, partnerName, onOpen, onAdvance, onContract, contractOf, busyId, onAdd, onSetDate, renderPartner }: {
  items: BoardItem[]; cols: BoardColumn[]; groups: BoardGroup[];
  /** 거래처 이름 — 셀에는 id 만 들어 있어 화면이 풀어 준다 */
  partnerName: (item: BoardItem) => string;
  onOpen: (itemId: string) => void;
  onAdvance: (item: BoardItem, nextOptionId: string) => void;
  /** 카드에서 바로 계약서 만들기 · 열기 */
  onContract: (item: BoardItem) => void;
  /** 이 줄에 이미 붙은 계약서가 있나 */
  contractOf: (item: BoardItem) => boolean;
  busyId: string | null;
  /** 계약 적기 — 이 화면이 읽기 전용이면 한 줄 적으러 표로 가야 했다 (2026-08-20 입력 점검) */
  onAdd: (groupId: string, name: string, values: Record<string, any>) => void;
  /** 만기 미입력 카드에서 그 자리에 날짜를 채운다 — "표에서 채워 주세요" 로 떠넘기지 않는다 */
  onSetDate: (item: BoardItem, colId: string, value: string) => void;
  /** 거래처 고르개 — 표와 같은 것을 쓴다(값만 들고 있는 모드) */
  renderPartner: (value: string, onChange: (v: string) => void) => ReactNode;
}) {
  const flow = flowColumnOf(cols);
  const options = (flow?.settings?.options || []) as StatusOption[];
  const dateCols = cols.filter((c) => c.type === "date");
  //   만기 = 이름에 '만기·종료'가 들어간 날짜 칸, 없으면 시작이 아닌 날짜 칸
  const endCol = dateCols.find((c) => /만기|종료|만료/.test(c.name))
    || dateCols.find((c) => !START_DATE_RE.test(c.name)) || dateCols[0] || null;
  const partnerCol = cols.find((c) => c.type === "partner") || null;
  const moneyCol = cols.find((c) => c.type === "number" && (c.settings?.unit || "") === "원") || null;
  const textCol = cols.find((c) => c.type === "text") || null;
  const startCol = dateCols.find((c) => START_DATE_RE.test(c.name)) || null;
  const today = todayKst();

  //   계약 적기 한 줄 — 계약명 · 거래처 · 금액 · 시작(기본 오늘) · 만기. 적으면 만기 순으로 줄을 선다.
  const [draft, setDraft] = useState({ name: "", partner: "", amount: "", from: todayKst(), to: "" });
  const submit = () => {
    const nm = draft.name.trim();
    const gid = groups[0]?.id;
    if (!nm || !gid) return;
    const values: Record<string, any> = {};
    if (moneyCol && draft.amount) values[moneyCol.id] = Number(draft.amount.replace(/[^0-9.-]/g, "")) || 0;
    if (partnerCol && draft.partner) values[partnerCol.id] = draft.partner;
    if (startCol && draft.from) values[startCol.id] = draft.from;
    if (endCol && draft.to) values[endCol.id] = draft.to;
    //   새 계약은 첫 단계에서 출발 — 표의 빠른 줄과 같은 정책(빈 단계 줄을 만들지 않는다)
    if (flow && options[0]) values[flow.id] = options[0].id;
    onAdd(gid, nm, values);
    setDraft({ name: "", partner: "", amount: "", from: todayKst(), to: "" });
  };
  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); }
  };

  const rows = useMemo(() => {
    const days = (it: BoardItem) => {
      if (!endCol) return null;
      const v = String(it.values?.[endCol.id] || "").slice(0, 10);
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null;
      return Math.round((new Date(`${v}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
    };
    return items.map((it) => ({ it, d: days(it) }))
      //   만기가 가까운 순 — 날짜가 없는 건은 맨 뒤(챙길 게 없는 게 아니라 아직 안 적은 것이다)
      .sort((a, b) => (a.d == null ? 1 : b.d == null ? -1 : a.d - b.d));
  }, [items, endCol, today]);

  if (!endCol) {
    return <p className="pj-sec-empty">만기 날짜 칸이 있어야 이 화면을 그릴 수 있어요. 표에서 날짜 칸을 하나 만들어 주세요.</p>;
  }
  return (
    <div className="pbx">
      {/*  적기 · 챙기기가 이 화면 하나에서 끝난다 — 예산 · 지출의 입력 줄과 같은 문법 (2026-08-20) */}
      <div className="pbx-quick">
        <input className="pbe-in" value={draft.name} placeholder="＋ 계약 이름 적고 Enter"
          onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))} onKeyDown={onKey} />
        {partnerCol && (
          <span className="pbe-partner">{renderPartner(draft.partner, (v) => setDraft((p) => ({ ...p, partner: v })))}</span>
        )}
        {moneyCol && (
          <input className="pbe-in pbe-num" value={draft.amount} inputMode="numeric" placeholder="계약금액"
            onChange={(e) => setDraft((p) => ({ ...p, amount: e.target.value.replace(/[^0-9]/g, "") }))} onKeyDown={onKey} />
        )}
        {startCol && (
          <input type="date" className="pbe-in pbe-date" value={draft.from} aria-label={startCol.name}
            title={`${startCol.name} — 기본 오늘`} onChange={(e) => setDraft((p) => ({ ...p, from: e.target.value }))} />
        )}
        <input type="date" className="pbe-in pbe-date" value={draft.to} aria-label={endCol.name}
          title={endCol.name} onChange={(e) => setDraft((p) => ({ ...p, to: e.target.value }))} />
        <button type="button" className="pbe-go" onClick={submit} disabled={!draft.name.trim()}>적기</button>
      </div>

      {rows.length === 0 && (
        <p className="pj-sec-empty">아직 계약이 없어요. 위 줄에 한 줄 적으면 만기 순으로 세워 드려요.</p>
      )}
      {rows.map(({ it, d }) => {
        const cur = flow ? options.find((o) => o.id === it.values?.[flow.id]) : null;
        const i = flow ? options.findIndex((o) => o.id === it.values?.[flow.id]) : -1;
        const next = options[i + 1] || null;
        const tone = d == null ? "" : d < 0 ? "bad" : d <= 30 ? "warn" : "";
        const hasDoc = contractOf(it);
        return (
          <article key={it.id} className={`pbx-card ${tone === "bad" ? "pbx-card-bad" : ""}`}>
            <span className={`pbx-dday pbx-${tone || "ok"}`}>
              {d == null ? "만기 미입력" : d < 0 ? `만기 ${-d}일 지남` : d === 0 ? "오늘 만기" : `D-${d}`}
              {d != null && d >= 0 && d <= 30 ? " · 갱신 결정 필요" : ""}
            </span>
            <button type="button" className="pbx-name" onClick={() => onOpen(it.id)}>{it.name || "(계약 이름 없음)"}</button>
<span className="pbx-meta">
              {partnerCol && partnerName(it) ? `${partnerName(it)} · ` : ""}
              {/*  날짜가 없으면 그 자리에서 채운다 — "표에서 채워 주세요" 로 떠넘기지 않는다 (2026-08-20) */}
              {String(it.values?.[endCol.id] || "").slice(0, 10)
                ? `${String(it.values?.[endCol.id]).slice(0, 10)} 만기`
                : (
                  <label className="pbx-fill">만기일
                    <input type="date" aria-label={`${it.name || "계약"} ${endCol.name}`}
                      onChange={(e) => { if (e.target.value) onSetDate(it, endCol.id, e.target.value); }} />
                  </label>
                )}
              {cur ? ` · ${cur.label}` : ""}
            </span>
            {moneyCol && (Number(it.values?.[moneyCol.id]) > 0
              ? <b className="pbx-amt">{won(Number(it.values?.[moneyCol.id]))}원</b>
              : <b className="pbx-amt pbx-amt-none">금액 미정</b>)}
            {textCol && it.values?.[textCol.id] && <em className="pbx-note">{String(it.values[textCol.id])}</em>}
            <div className="pbx-acts">
              <button type="button" className="pbx-go" disabled={busyId === it.id} onClick={() => onContract(it)}>
                {busyId === it.id ? "여는 중…" : hasDoc ? "계약서 열기" : "계약서 만들기"}
              </button>
              {next && (
                <button type="button" className="pbx-next" onClick={() => onAdvance(it, next.id)}
                  title={`'${next.label}' 단계로 옮깁니다`}>{next.label}</button>
              )}
            </div>
          </article>
        );
      })}
    </div>
  );
}
