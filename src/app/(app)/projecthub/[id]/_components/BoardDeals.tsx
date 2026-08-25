"use client";

// 건별 진행 카드 — '매출 흐름' 템플릿의 첫 화면 (2026-08-07 사장님 지시).
//
//   여러 건을 나란히 채울 땐 표가 빠르다. 다만 **한 건을 끝까지 끌고 갈 때**는
//   서류와 입금이 흩어져 보인다. 건을 펼치면 검토→제안→계약→발행→입금과
//   입금·잔금, 그리고 서류 단추가 한 장에 모인다.
//
//   ⚠️ 표·칸반은 그대로 남는다 — 이 화면은 첫 화면일 뿐이다.

import { useMemo } from "react";
import type { ReactNode } from "react";
import { flowColumnOf, type BoardColumn, type BoardItem, type StatusOption } from "@/lib/project-boards";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

export function BoardDeals({ items, cols, partnerName, userName, onOpen, onStage, renderDocs }: {
  items: BoardItem[]; cols: BoardColumn[];
  partnerName: (item: BoardItem) => string;
  userName: (id: any) => string;
  onOpen: (itemId: string) => void;
  /** 단계 옮기기 — 스텝을 누르면 그 단계로 */
  onStage: (item: BoardItem, optionId: string) => void;
  /** 서류 단추(견적서·계약서·발행) — 표에서 쓰는 그 체인을 그대로 쓴다 */
  renderDocs: (item: BoardItem) => ReactNode;
}) {
  const flow = flowColumnOf(cols);
  const options = (flow?.settings?.options || []) as StatusOption[];
  const wonCols = cols.filter((c) => c.type === "number" && (c.settings?.unit || "") === "원");
  const amtCol = wonCols[0] || null;
  //   입금 칸 — 금액 다음의 원 단위 칸(이름에 '입금·수금'이 들어가면 그것을 먼저)
  const paidCol = wonCols.find((c) => c !== amtCol && /입금|수금|받은/.test(c.name)) || wonCols[1] || null;
  const personCol = cols.find((c) => c.type === "person") || null;
  const dateCol = cols.find((c) => c.type === "date") || null;

  //   챙길 것부터 — 잔금이 남은 건이 위, 그중에서도 예정일이 이른 순. 완납·입금 끝난 건은 뒤로.
  //   (2026-08-07 시연: 열세 장이 적은 차례 그대로 서 있어 무엇을 먼저 볼지 화면이 안 알려 줬다)
  const sorted = useMemo(() => {
    const left = (it: BoardItem) => {
      const amt = amtCol ? Number(it.values?.[amtCol.id]) || 0 : 0;
      const paid = paidCol ? Number(it.values?.[paidCol.id]) || 0 : 0;
      return amt - paid;
    };
    const due = (it: BoardItem) => {
      const v = dateCol ? String(it.values?.[dateCol.id] || "").slice(0, 10) : "";
      return /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : "9999-99-99";
    };
    return [...items].sort((a, b) => {
      const la = left(a) > 0 ? 0 : 1, lb = left(b) > 0 ? 0 : 1;
      if (la !== lb) return la - lb;
      return due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : 0;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, amtCol?.id, paidCol?.id, dateCol?.id]);

  if (items.length === 0) {
    return <p className="pj-sec-empty">아직 매출 건이 없습니다. ‘표’ 에서 한 줄 적으면 여기에 카드로 세워 드립니다.</p>;
  }

  return (
    <div className="pbd">
      {sorted.map((it) => {
        const amt = amtCol ? Number(it.values?.[amtCol.id]) || 0 : 0;
        const paid = paidCol ? Number(it.values?.[paidCol.id]) || 0 : 0;
        const left = amt - paid;
        const pct = amt > 0 ? Math.min(100, Math.round((paid / amt) * 100)) : 0;
        const curIdx = options.findIndex((o) => o.id === it.values?.[flow?.id || ""]);
        return (
          <article key={it.id} className="pbd-card">
            <header className="pbd-top">
              <button type="button" className="pbd-name" onClick={() => onOpen(it.id)}>{it.name || "(이름 없음)"}</button>
              <span className="pbd-who">
                {partnerName(it) || "거래처 미지정"}
                {personCol && userName(it.values?.[personCol.id]) ? ` · ${userName(it.values?.[personCol.id])}` : ""}
                {dateCol && String(it.values?.[dateCol.id] || "").slice(0, 10) ? ` · ${String(it.values[dateCol.id]).slice(0, 10)}` : ""}
              </span>
              {amtCol && <b className="pbd-amt">{won(amt)}원</b>}
            </header>

            {/*  단계 — 누르면 그 단계로 간다. 지금 어디까지 왔는지가 이 카드의 첫 질문이다 */}
            {flow && options.length > 0 && (
              <div className="pbd-steps">
                {options.map((o, i) => (
                  <button key={o.id} type="button" onClick={() => onStage(it, o.id)}
                    className={`pbd-step ${i < curIdx ? "pbd-done" : i === curIdx ? "pbd-now" : ""}`}
                    title={`'${o.label}' 단계로`}>
                    <i />
                    <span>{o.label}</span>
                  </button>
                ))}
              </div>
            )}

            {amtCol && paidCol && (
              <div className="pbd-pay">
                <span className="pbd-track"><i style={{ width: `${pct}%` }} /></span>
                <span className="pbd-paylab">
                  입금 <b>{won(paid)}</b> · {left > 0 ? <>잔금 <b>{won(left)}</b></> : left === 0 && amt > 0 ? <b>완납</b> : <>초과 <b>{won(-left)}</b></>}
                </span>
              </div>
            )}

            <div className="pbd-docs">{renderDocs(it)}</div>
          </article>
        );
      })}
    </div>
  );
}
