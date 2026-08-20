"use client";

// 지출 입력 — '예산 · 지출' 템플릿의 첫 화면 (2026-08-07 사장님 지시).
//
//   쓴 돈을 적는 일이다. 예산이 얼마나 남았는지를 화면 맨 위에 붙박아 두고,
//   입력은 한 줄에서 끝낸다(무엇에 · 거래처 · 구분 · 금액). 영수증은 줄을 열어 붙인다.
//
//   ⚠️ 표는 그대로 남는다 — 이 화면은 첫 화면일 뿐이다.

import { useMemo, useState } from "react";
import type { ReactNode } from "react";
import { type BoardColumn, type BoardGroup, type BoardItem, type StatusOption } from "@/lib/project-boards";
import { todayKst } from "@/lib/kst";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

export function BoardExpense({ items, cols, groups, onAdd, onOpen, renderPartner }: {
  items: BoardItem[]; cols: BoardColumn[]; groups: BoardGroup[];
  onAdd: (groupId: string, name: string, values: Record<string, any>) => void;
  onOpen: (itemId: string) => void;
  /** 거래처 고르개 — 표와 같은 것을 쓴다(값만 들고 있는 모드) */
  renderPartner: (value: string, onChange: (v: string) => void) => ReactNode;
}) {
  //   숫자 칸 둘 = 예산 / 집행. 이름이 아니라 차례로 읽는다(회사가 이름을 바꿔도 뜻이 안 흔들리게)
  const wonCols = cols.filter((c) => c.type === "number" && (c.settings?.unit || "") === "원");
  const planCol = wonCols[0] || null;
  const realCol = wonCols[1] || wonCols[0] || null;
  const kindCol = cols.find((c) => c.type === "status" && !c.settings?.flow) || cols.find((c) => c.type === "status") || null;
  const partnerCol = cols.find((c) => c.type === "partner") || null;
  const kindOptions = (kindCol?.settings?.options || []) as StatusOption[];
  //   결제일 칸 — 입력 줄에도, '최근' 정렬에도 이 칸을 쓴다
  const dateCol = cols.find((c) => c.type === "date") || null;

  //   결제일 기본값은 오늘 (2026-08-20 입력 점검: 날짜 없이 저장된 지출이 '최근' 정렬과
  //   주별 추이에서 빠졌다). 대부분 그대로 Enter — 지난 지출을 몰아 적을 때만 바꾼다.
  const [draft, setDraft] = useState({ name: "", partner: "", kind: "", amount: "", date: todayKst() });

  const sums = useMemo(() => {
    const plan = planCol ? items.reduce((s, it) => s + (Number(it.values?.[planCol.id]) || 0), 0) : 0;
    const real = realCol ? items.reduce((s, it) => s + (Number(it.values?.[realCol.id]) || 0), 0) : 0;
    return { plan, real, left: plan - real, pct: plan > 0 ? Math.round((real / plan) * 100) : null };
  }, [items, planCol, realCol]);

  //   '최근' 은 적은 차례가 아니라 **오늘에 가까운 결제일** 순이 실무에 맞다 — 곧 나갈 돈과
  //   방금 나간 돈이 먼저 보여야 한다. (2026-08-07 시연: 처음엔 표 맨 끝 여섯 줄을 뒤집어 보여
  //   줬고, 날짜순으로 고쳤더니 이번엔 **먼 미래**가 맨 위로 왔다.)
  const recent = useMemo(() => {
    const today = todayKst();
    const dist = (it: BoardItem) => {
      const v = dateCol ? String(it.values?.[dateCol.id] || "").slice(0, 10) : "";
      if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return Number.MAX_SAFE_INTEGER;      // 날짜 없는 건은 맨 뒤
      return Math.abs((new Date(`${v}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000);
    };
    return [...items].sort((a, b) => dist(a) - dist(b)).slice(0, 6);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, dateCol?.id]);
  const kindOf = (it: BoardItem) => kindOptions.find((o) => o.id === it.values?.[kindCol?.id || ""]) || null;

  const submit = () => {
    const nm = draft.name.trim();
    const gid = groups[0]?.id;
    if (!nm || !gid) return;
    const values: Record<string, any> = {};
    if (realCol && draft.amount) values[realCol.id] = Number(draft.amount.replace(/[^0-9.-]/g, "")) || 0;
    if (kindCol && draft.kind) values[kindCol.id] = draft.kind;
    if (partnerCol && draft.partner) values[partnerCol.id] = draft.partner;
    if (dateCol && draft.date) values[dateCol.id] = draft.date;
    onAdd(gid, nm, values);
    setDraft({ name: "", partner: "", kind: "", amount: "", date: todayKst() });
  };

  return (
    <div className="pbe">
      {/*  예산이 얼마나 남았나 — 적는 내내 눈에 있어야 하는 숫자다 */}
      {sums.plan > 0 && (
        <div className="pbe-gauge">
          <span className="pbe-lab">예산 <b>{won(sums.plan)}원</b> 중 <b>{won(sums.real)}원</b> 집행</span>
          <span className="pbe-track">
            <i className={sums.left < 0 ? "pbe-over" : ""} style={{ width: `${Math.min(100, sums.pct ?? 0)}%` }} />
          </span>
          <span className={`pbe-lab ${sums.left < 0 ? "pbe-bad" : ""}`}>
            {sums.left >= 0 ? <>남은 <b>{won(sums.left)}원</b></> : <>예산 초과 <b>{won(-sums.left)}원</b></>}
            {sums.pct != null ? ` · ${sums.pct}%` : ""}
          </span>
        </div>
      )}

      <div className="pbe-quick">
        <input className="pbe-in" value={draft.name} placeholder="무엇에 썼나요"
          onChange={(e) => setDraft((p) => ({ ...p, name: e.target.value }))}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        {partnerCol && (
          <span className="pbe-partner">{renderPartner(draft.partner, (v) => setDraft((p) => ({ ...p, partner: v })))}</span>
        )}
        {kindCol && (
          <select className="pbe-in" value={draft.kind} aria-label={kindCol.name}
            onChange={(e) => setDraft((p) => ({ ...p, kind: e.target.value }))}>
            <option value="">{kindCol.name}</option>
            {kindOptions.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </select>
        )}
        <input className="pbe-in pbe-num" value={draft.amount} inputMode="numeric" placeholder="금액"
          onChange={(e) => setDraft((p) => ({ ...p, amount: e.target.value.replace(/[^0-9]/g, "") }))}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.nativeEvent.isComposing) { e.preventDefault(); submit(); } }} />
        {dateCol && (
          <input type="date" className="pbe-in pbe-date" value={draft.date} aria-label={dateCol.name}
            title={`${dateCol.name} — 기본 오늘, 지난 지출을 몰아 적을 때만 바꿉니다`}
            onChange={(e) => setDraft((p) => ({ ...p, date: e.target.value }))} />
        )}
        <button type="button" className="pbe-go" onClick={submit} disabled={!draft.name.trim()}>적기</button>
      </div>
      <p className="pbe-hint">영수증·계산서는 줄을 눌러 열고 그 안에 붙입니다 — 예산 칸은 ‘표’ 에서 채웁니다.</p>

      {recent.length > 0 && (
        <ul className="pbe-list">
          {recent.map((it) => {
            const k = kindOf(it);
            return (
              <li key={it.id}>
                <button type="button" className="pbe-row" onClick={() => onOpen(it.id)}>
                  <b>{it.name || "(이름 없음)"}</b>
                  {k && <span className="pbe-kind" style={{ background: k.color }}>{k.label}</span>}
                  {dateCol && <span className="pbe-when">{String(it.values?.[dateCol.id] || "").slice(5, 10).replace("-", "/")}</span>}
                  {/*  아직 안 쓴 건은 0원이 아니라 '예정' 이다 — 0 으로 적으면 안 쓴 걸 쓴 걸로 읽는다 */}
                  <em>{realCol && Number(it.values?.[realCol.id]) > 0
                    ? `${won(Number(it.values?.[realCol.id]))}원`
                    : planCol && Number(it.values?.[planCol.id]) > 0
                      ? `예정 ${won(Number(it.values?.[planCol.id]))}원`
                      : "—"}</em>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
