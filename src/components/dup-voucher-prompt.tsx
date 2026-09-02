"use client";
import { koFallback } from "@/lib/ko-label";

// 중복 의심 팝업 — 세 갈래 (2026-08-19 사장님): 새 전표 만들기 / 이미 있는 전표에 연결(장부 불변) / 취소.
//   Promise 로 답을 돌려주는 훅 — 전표 만드는 자리에서 `const a = await askDup(...)` 로 끼운다.

import { useCallback, useState } from "react";
import { type DupEntry, SOURCE_LABEL } from "@/lib/dup-voucher";

export type DupAnswer = { action: "new" } | { action: "link"; entryId: string } | { action: "cancel" };
type Ask = { title: string; sub: string; entries: DupEntry[]; allowLink: boolean; resolve: (a: DupAnswer) => void };

export function useDupVoucherPrompt() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [pick, setPick] = useState<string>("");
  /** opts.allowLink=false — 걸어 둘 거래가 없는 수기 입력(매입매출전표 직접 치기)에서는 '연결' 갈래를 감춘다: 새 전표 / 취소만 */
  const askDup = useCallback((title: string, sub: string, entries: DupEntry[], opts?: { allowLink?: boolean }) => new Promise<DupAnswer>((resolve) => { setPick(entries[0]?.id || ""); setAsk({ title, sub, entries, allowLink: opts?.allowLink !== false, resolve }); }), []);
  const done = (a: DupAnswer) => { ask?.resolve(a); setAsk(null); };
  const element = ask ? (
    <div className="approval-detail-modal" onClick={() => done({ action: "cancel" })}>
      <div className="pnl-drill dup-prompt" onClick={(e) => e.stopPropagation()}>
        <div className="pnl-drill-head"><h3 className="text-sm font-bold">중복 의심 — 같은 날 같은 금액의 전표가 이미 있습니다</h3><button type="button" className="btn-secondary btn-sm" onClick={() => done({ action: "cancel" })}>취소</button></div>
        <div className="pay-form-body space-y-3">
          <div className="text-[12.5px]"><b>{ask.title}</b><span className="ml-2 text-[var(--text-muted)]">{ask.sub}</span></div>
          <table className="ev-table ev-lined dup-table">
            <thead><tr><th></th><th>전표</th><th className="text-left">적요</th><th>출처</th><th>금액</th><th>걸린 거래</th></tr></thead>
            <tbody>{ask.entries.map((e) => (
              <tr key={e.id} className="pnl-row-acct" onClick={() => setPick(e.id)}>
                <td className="text-center"><input type="radio" name="dup-pick" checked={pick === e.id} onChange={() => setPick(e.id)} /></td>
                <td className="text-center mono-number">#{e.voucher_no ?? "—"}</td>
                <td className="text-left">{e.description || <span className="text-[var(--text-dim)]">(적요 없음)</span>}</td>
                <td className="text-center text-[var(--text-muted)]">{SOURCE_LABEL[e.source] || koFallback(e.source)}</td>
                <td className="text-right mono-number font-bold">{e.total.toLocaleString()}</td>
                <td className="text-center text-[var(--text-muted)]">{e.linkedCount > 0 ? `${e.linkedCount}건` : "—"}</td>
              </tr>
            ))}</tbody>
          </table>
          <p className="text-[11.5px] text-[var(--text-muted)]">
            {ask.allowLink && <><b>이미 있는 전표에 연결</b>: 새 전표를 만들지 않고 이 거래를 위 전표에 걸어 둡니다 — 장부(재무제표)는 그대로, 목록에서는 '전표됨'으로 사라지고 다시 전표를 칠 수 없습니다. 같은 돈을 두 번 올리지 않을 때 씁니다.<br /></>}
            <b>새 전표 만들기</b>: 우연히 같은 금액인 다른 거래일 때.{!ask.allowLink && " 같은 건이면 취소하고 위 전표를 고치거나 그대로 둡니다."}
          </p>
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary btn-sm" onClick={() => done({ action: "cancel" })}>취소</button>
            <button type="button" className={ask.allowLink ? "btn-secondary btn-sm" : "btn-primary btn-sm"} onClick={() => done({ action: "new" })}>새 전표 만들기</button>
            {ask.allowLink && <button type="button" className="btn-primary btn-sm" disabled={!pick} onClick={() => done({ action: "link", entryId: pick })}>이미 있는 전표에 연결</button>}
          </div>
        </div>
      </div>
    </div>
  ) : null;
  return { askDup, dupPromptElement: element };
}
