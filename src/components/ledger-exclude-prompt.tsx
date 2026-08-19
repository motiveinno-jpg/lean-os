"use client";

// '장부 제외' 사유 팝업 (2026-08-19) — 중복/이체/개인/기타 + 한 줄 메모. Promise 로 답을 돌려준다(취소면 null).
import { useCallback, useState } from "react";
import { EXCLUDE_REASONS } from "@/lib/dup-voucher";

type Ask = { title: string; count: number; resolve: (reason: string | null) => void };
export function useLedgerExcludePrompt() {
  const [ask, setAsk] = useState<Ask | null>(null);
  const [code, setCode] = useState("dup");
  const [memo, setMemo] = useState("");
  const askExclude = useCallback((title: string, count = 1) => new Promise<string | null>((resolve) => { setCode("dup"); setMemo(""); setAsk({ title, count, resolve }); }), []);
  const done = (r: string | null) => { ask?.resolve(r); setAsk(null); };
  const element = ask ? (
    <div className="approval-detail-modal" onClick={() => done(null)}>
      <div className="pnl-drill exclude-prompt" onClick={(e) => e.stopPropagation()}>
        <div className="pnl-drill-head"><h3 className="text-sm font-bold">장부 제외 <small className="ml-2 font-normal text-[var(--text-dim)]">전표 없이 끝낸 것으로 — 장부(재무제표)는 그대로, 목록에서는 사라집니다</small></h3><button type="button" className="btn-secondary btn-sm" onClick={() => done(null)}>닫기</button></div>
        <div className="pay-form-body space-y-3">
          <div className="text-[12.5px]"><b>{ask.title}</b>{ask.count > 1 && <span className="ml-2 text-[var(--text-muted)]">외 {ask.count - 1}건</span>}</div>
          <div className="qk-quicks">{EXCLUDE_REASONS.map(([k, l]) => <button key={k} type="button" onClick={() => setCode(k)} className={code === k ? "qk-quick qk-quick-on" : "qk-quick"}>{l}</button>)}</div>
          <input className="qk-input h-8 w-full px-2.5 text-xs" placeholder="메모(선택) — 예: 7/31 수기 전표 #12에 이미 반영" value={memo} onChange={(e) => setMemo(e.target.value)} />
          <p className="text-[11px] text-[var(--text-dim)]">되돌리려면 검색조건 상태 '장부 제외'로 찾아 '해제'(수집·전표에서는 '되돌리기'). 전표가 이미 걸린 건은 제외할 수 없습니다(전표 취소가 맞습니다).</p>
          <div className="flex justify-end gap-2"><button type="button" className="btn-secondary btn-sm" onClick={() => done(null)}>취소</button><button type="button" className="btn-primary btn-sm" onClick={() => done(memo.trim() ? `${code}:${memo.trim()}` : code)}>장부 제외</button></div>
        </div>
      </div>
    </div>
  ) : null;
  return { askExclude, excludePromptElement: element };
}
