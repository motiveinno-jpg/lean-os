"use client";

// ── 재고 › 재고 › 실사 (2026-08-25 사장님 지시) ────────────────────────────────
//   ★ 결정 9 — 숫자를 덮어쓰지 않는다. 차이만 '실사 조정' 한 건으로 남긴다.
//   ★ 결정 10 — **안 센 줄은 건드리지 않는다.** 빈 칸과 0 은 다르다. 칸을 비워 두면 조정에서 빠진다.
//   ★ 결정 11 — 차이는 **반영하는 순간의 장부**와 견준다. 세는 동안 움직인 줄은 화면이 따로 표시한다.
//
//   조회 줄과 표를 한 컴포넌트에 담을 수 없어(QueryHead / QueryBody 는 형제다)
//   상태는 useStockCount 훅 하나에 모으고, 화면 조각 둘이 그것을 나눠 쓴다.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { todayKst } from "@/lib/kst";
import { QueryBar, ResultStrip, Stat, usePager, QuickSearch, quickSearchHit } from "@/components/query-kit";
import {
  listCounts, listCountLines, createCount, saveCountedQty, deleteCount, applyCount,
  type Product, type Warehouse, type OnHand, type CountLine,
} from "@/lib/inventory";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

export function useStockCount(companyId: string | null, userId: string | null, canMove: boolean, productById: Map<string, Product>) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [openId, setOpenId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [newOpen, setNewOpen] = useState(false);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  //   센 수량은 칸에서 바로 고치고, 칸을 떠날 때 조용히 저장한다 —
  //   실사는 한 번에 끝나지 않는다(창고를 돌며 몇 시간). 버튼을 눌러야 남는다면 반드시 잃어버린다.
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [savedAt, setSavedAt] = useState<string | null>(null);

  const counts = useQuery({ queryKey: ["inv-counts", companyId], queryFn: () => listCounts(companyId!), enabled: !!companyId });
  const lines = useQuery({ queryKey: ["inv-count-lines", openId], queryFn: () => listCountLines(openId!), enabled: !!openId });

  useEffect(() => { setDraft({}); setSavedAt(null); }, [openId]);

  const head = useMemo(() => (counts.data || []).find((c) => c.id === openId) || null, [counts.data, openId]);

  const saveOne = async (lineId: string, raw: string) => {
    const v = raw.trim() === "" ? null : Number(raw);
    if (v != null && Number.isNaN(v)) return;
    try {
      await saveCountedQty(openId!, [{ id: lineId, counted_qty: v }]);
      setSavedAt(new Date().toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" }));
      qc.invalidateQueries({ queryKey: ["inv-count-lines", openId] });
    } catch (e) { toast(friendlyError(e), "error"); }
  };

  //   쪽은 QueryBody 밖에서 그려야 한다(안에 두면 표를 덮는다) — 그래서 페이저도 여기서 만든다.
  const shown = useMemo(() => (lines.data || []).filter((l) => {
    const p = productById.get(l.product_id);
    return quickSearchHit(q, [p?.sku, p?.name, p?.spec]);
  }), [lines.data, q, productById]);
  const linePager = usePager(shown, 50, `${openId}|${q}`);
  const listPager = usePager(counts.data || [], 50, "counts");

  return {
    openId, setOpenId, q, setQ, newOpen, setNewOpen, pasteOpen, setPasteOpen,
    busy, setBusy, draft, setDraft, savedAt, setSavedAt, saveOne,
    counts, lines, head, canMove, companyId, userId, toast, qc,
    shown, linePager, listPager,
  };
}
export type CountCtl = ReturnType<typeof useStockCount>;

// ── 조회 줄 ────────────────────────────────────────────────────────────────────
export function CountBar({ ctl, warehouses, onhand }: {
  ctl: CountCtl; warehouses: Warehouse[]; onhand: OnHand[];
}) {
  const list = ctl.counts.data || [];
  const rows = ctl.lines.data || [];
  const wh = ctl.head ? warehouses.find((w) => w.id === ctl.head!.warehouse_id) : null;
  const whId = ctl.head?.warehouse_id;
  const nowOf = useMemo(() => new Map(onhand.filter((r) => r.warehouse_id === whId).map((r) => [r.product_id, r.qty])), [onhand, whId]);

  const counted = rows.filter((l) => l.counted_qty != null);
  const diffs = counted.map((l) => Number(l.counted_qty) - (nowOf.get(l.product_id) ?? 0)).filter((d) => d !== 0);
  const drift = counted.filter((l) => (nowOf.get(l.product_id) ?? 0) !== l.system_qty).length;
  const done = ctl.head?.status === "done";

  if (!ctl.openId) {
    return (
      <>
        <QueryBar right={ctl.canMove ? <button type="button" className="btn-primary btn-sm" onClick={() => ctl.setNewOpen(true)}>+ 실사 열기</button> : undefined}>
          <span className="inv-hint">창고를 돌며 센 수량을 적으면 <b>차이만</b> &lsquo;실사 조정&rsquo;으로 남습니다 — 장부 숫자를 덮어쓰지 않습니다.</span>
        </QueryBar>
        <ResultStrip>
          <Stat label="진행 중" value={`${won(list.filter((c) => c.status === "draft").length)}건`} />
          <Stat label="반영함" value={`${won(list.filter((c) => c.status === "done").length)}건`} />
        </ResultStrip>
      </>
    );
  }

  return (
    <>
      <QueryBar right={ctl.canMove && !done ? (
        <>
          <button type="button" className="btn-secondary btn-sm" onClick={() => ctl.setPasteOpen(true)}>센 수량 붙여넣기</button>
          <button type="button" className="btn-primary btn-sm" disabled={ctl.busy || counted.length === 0}
            onClick={async () => {
              const msg = diffs.length === 0
                ? `센 ${counted.length}줄이 장부와 모두 같습니다. 조정 없이 '맞음'으로 닫을까요?`
                : `센 ${counted.length}줄 중 ${diffs.length}줄이 다릅니다.\n차이만 '실사 조정' 문서 한 건으로 남기고 이 실사는 잠깁니다.\n\n반영할까요?`;
              if (!window.confirm(msg)) return;
              ctl.setBusy(true);
              try {
                const r = await applyCount(ctl.companyId!, ctl.openId!, ctl.userId);
                ctl.toast(r.docNo ? `${r.docNo} 로 ${r.changed}줄을 맞췄습니다` : "차이가 없어 그대로 닫았습니다", "success");
                ctl.qc.invalidateQueries({ queryKey: ["inv-onhand", ctl.companyId] });
                ctl.qc.invalidateQueries({ queryKey: ["inv-moves", ctl.companyId] });
                ctl.counts.refetch(); ctl.lines.refetch();
              } catch (e) { ctl.toast(friendlyError(e), "error"); }
              finally { ctl.setBusy(false); }
            }}>반영하기</button>
        </>
      ) : undefined}>
        <button type="button" className="btn-secondary btn-sm" onClick={() => ctl.setOpenId(null)}>← 목록</button>
        <span className="inv-count-title">
          <b>{ctl.head?.count_date}</b> · {wh?.name || "창고 없음"}
          {done ? <span className="inv-pill inv-pill-ok">반영함</span> : <span className="inv-pill inv-pill-warn">진행 중</span>}
        </span>
        <QuickSearch value={ctl.q} onApply={ctl.setQ} placeholder="품목명 · SKU · 규격 — 쉼표로 여러 개, Enter" />
        {ctl.savedAt && <span className="inv-saved">{ctl.savedAt} 저장됨</span>}
      </QueryBar>
      <ResultStrip>
        <Stat label="줄" value={`${won(rows.length)}개`} />
        <Stat label="센 것" value={`${won(counted.length)}개`} />
        <Stat label="다른 것" value={`${won(diffs.length)}개`} tone={diffs.length > 0 ? "minus" : undefined} />
        <Stat label="더 있음" value={`${won(diffs.filter((d) => d > 0).reduce((n, d) => n + d, 0))}개`} />
        <Stat label="모자람" value={`${won(Math.abs(diffs.filter((d) => d < 0).reduce((n, d) => n + d, 0)))}개`} tone="minus" />
        {drift > 0 && !done && <Stat label="세는 동안 움직임" value={`${won(drift)}줄`} tone="minus" />}
      </ResultStrip>
    </>
  );
}

// ── 본문 ──────────────────────────────────────────────────────────────────────
export function CountBody({ ctl, warehouses, onhand, productById }: {
  ctl: CountCtl; warehouses: Warehouse[]; onhand: OnHand[]; productById: Map<string, Product>;
}) {
  const list = ctl.counts.data || [];
  const rows = ctl.lines.data || [];
  const whId = ctl.head?.warehouse_id;
  const nowOf = useMemo(() => new Map(onhand.filter((r) => r.warehouse_id === whId).map((r) => [r.product_id, r.qty])), [onhand, whId]);
  const pager = ctl.linePager;
  const listPager = ctl.listPager;
  const done = ctl.head?.status === "done";

  if (!ctl.openId) {
    if (!list.length) {
      return (
        <div className="collect-empty">
          아직 연 실사가 없습니다 — <b>+ 실사 열기</b>로 창고를 고르면 지금 장부 수량이 줄로 깔립니다.<br />
          세면서 수량을 적고 마지막에 <b>반영하기</b>를 누르면 <b>차이만</b> &lsquo;실사 조정&rsquo;으로 남습니다.
        </div>
      );
    }
    return (
      <>
        <div className="stg-table-wrap">
          <table className="ev-table ev-lined table-inv-counts">
            <thead><tr><th>일자</th><th>창고</th><th>상태</th><th>조정 문서</th><th>메모</th><th></th></tr></thead>
            <tbody>
              {listPager.view.map((c) => (
                <tr key={c.id} className="inv-row-click" onClick={() => ctl.setOpenId(c.id)}>
                  <td className="mono-number">{c.count_date}</td>
                  <td className="tc">{warehouses.find((w) => w.id === c.warehouse_id)?.name || "—"}</td>
                  <td className="tc">{c.status === "done"
                    ? <span className="inv-pill inv-pill-ok">반영함</span>
                    : <span className="inv-pill inv-pill-warn">진행 중</span>}</td>
                  <td className="tc ev-dim">{c.adjust_doc_id ? "조정 남김" : c.status === "done" ? "차이 없었음" : "—"}</td>
                  <td className="text-left ev-dim">{c.note || "—"}</td>
                  <td className="tc">
                    {c.status === "draft" && ctl.canMove && (
                      <button type="button" className="inv-line-x" title="지우기"
                        onClick={async (e) => {
                          e.stopPropagation();
                          if (!window.confirm("이 실사를 지울까요? 센 수량도 함께 사라집니다.")) return;
                          try { await deleteCount(c.id); ctl.counts.refetch(); ctl.toast("지웠습니다", "success"); }
                          catch (err) { ctl.toast(friendlyError(err), "error"); }
                        }}>✕</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="stg-table-wrap">
        <table className="ev-table ev-lined table-inv-count-lines">
          <thead><tr><th>SKU</th><th>품목명</th><th>규격</th><th>장부</th><th>센 수량</th><th>차이</th><th>비고</th></tr></thead>
          <tbody>
            {pager.view.map((l) => {
              const p = productById.get(l.product_id);
              const now = nowOf.get(l.product_id) ?? 0;
              const raw = ctl.draft[l.id] ?? (l.counted_qty == null ? "" : String(l.counted_qty));
              const has = raw.trim() !== "" && !Number.isNaN(Number(raw));
              const diff = has ? Number(raw) - now : null;
              const drifted = now !== l.system_qty;
              return (
                <tr key={l.id} className={diff != null && diff !== 0 ? "inv-row-diff" : undefined}>
                  <td className="mono-number text-left">{p?.sku || "—"}</td>
                  <td className="text-left"><b>{p?.name || "—"}</b></td>
                  <td className="tc ev-dim">{p?.spec || "—"}</td>
                  <td className="tr mono-number">{won(now)}</td>
                  <td className="tc">
                    {done ? <span className="mono-number">{l.counted_qty == null ? "—" : won(Number(l.counted_qty))}</span> : (
                      <input className="field-input inv-count-input" inputMode="numeric" placeholder="—" value={raw}
                        onChange={(e) => ctl.setDraft((s) => ({ ...s, [l.id]: e.target.value }))}
                        onBlur={(e) => { if ((l.counted_qty == null ? "" : String(l.counted_qty)) !== e.target.value.trim()) ctl.saveOne(l.id, e.target.value); }} />
                    )}
                  </td>
                  <td className="tr mono-number">
                    {diff == null ? <span className="ev-dim">안 셈</span>
                      : diff === 0 ? <span className="inv-pill inv-pill-ok">맞음</span>
                      : <b className={diff > 0 ? "inv-diff-plus" : "inv-diff-minus"}>{diff > 0 ? `+${won(diff)}` : won(diff)}</b>}
                  </td>
                  <td className="tc ev-dim">
                    {/*   반영한 뒤에는 적지 않는다 — 그때의 차이는 **조정 때문**이지 남이 움직인 것이 아니다 */}
                    {drifted && !done ? <span className="inv-pill inv-pill-warn" title={`셀 때 ${won(l.system_qty)} → 지금 ${won(now)}`}>세는 동안 움직임</span> : "—"}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="inv-foot">
        <b>빈 칸은 건드리지 않습니다</b> — 아직 안 센 것으로 봅니다. 실제로 <b>하나도 없었다면 0</b> 을 적으세요.
        차이는 <b>반영하는 순간의 장부</b>와 견줍니다(세는 동안 판매가 일어나도 그 판매가 지워지지 않게).
      </p>
    </>
  );
}

// ── 실사 열기 ─────────────────────────────────────────────────────────────────
export function NewCountDialog({ ctl, warehouses }: { ctl: CountCtl; warehouses: Warehouse[] }) {
  const [warehouseId, setWarehouseId] = useState("");
  const [countDate, setCountDate] = useState(todayKst);
  const [note, setNote] = useState("");
  const [includeAll, setIncludeAll] = useState(false);
  const [busy, setBusy] = useState(false);

  //   창고 목록이 늦게 오므로 열릴 때 기본 창고를 잡아 준다
  useEffect(() => {
    if (ctl.newOpen && !warehouseId) setWarehouseId(warehouses.find((w) => w.is_default)?.id || warehouses[0]?.id || "");
  }, [ctl.newOpen, warehouses, warehouseId]);

  if (!ctl.newOpen) return null;
  return (
    <div className="inv-modal" onClick={() => ctl.setNewOpen(false)}>
      <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">실사 열기</h3>
        <p className="inv-modal-desc">고른 창고의 <b>지금 장부 수량</b>을 줄로 찍어 둡니다. 세면서 수량을 적고 마지막에 반영하세요.</p>
        <label className="inv-field"><span>창고 *</span>
          <select className="field-input" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
            {warehouses.length === 0 && <option value="">창고가 없습니다</option>}
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>
        <label className="inv-field"><span>일자 *</span>
          <input type="date" className="field-input" value={countDate} onChange={(e) => setCountDate(e.target.value)} /></label>
        <label className="inv-check">
          <input type="checkbox" checked={includeAll} onChange={(e) => setIncludeAll(e.target.checked)} />
          <span><b>재고 0인 품목까지</b> 깔기 <em>— 창고를 통째로 셀 때. 꺼 두면 지금 그 창고에 잡혀 있는 품목만 나옵니다.</em></span>
        </label>
        <label className="inv-field"><span>메모</span>
          <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="반기 실사 · 이전 준비 등" /></label>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={() => ctl.setNewOpen(false)}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!warehouseId || busy}
            onClick={async () => {
              setBusy(true);
              try {
                const r = await createCount(ctl.companyId!, { warehouseId, countDate, note, includeAll }, ctl.userId);
                ctl.toast(`${r.lines}줄로 실사를 열었습니다`, "success");
                ctl.setNewOpen(false);
                await ctl.counts.refetch();
                ctl.setOpenId(r.id);
              } catch (e) { ctl.toast(friendlyError(e), "error"); }
              finally { setBusy(false); }
            }}>열기</button>
        </div>
      </div>
    </div>
  );
}

// ── 센 수량 붙여넣기 ──────────────────────────────────────────────────────────
export function CountPasteDialog({ ctl, productById }: { ctl: CountCtl; productById: Map<string, Product> }) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const rows = ctl.lines.data || [];
  //   SKU 로 줄을 찾는다 — 창고에서 스캐너·엑셀로 센 것을 그대로 옮겨 붙일 수 있게.
  const parsed = useMemo(() => {
    const bySku = new Map<string, CountLine>();
    for (const l of rows) { const p = productById.get(l.product_id); if (p) bySku.set(p.sku.trim().toUpperCase(), l); }
    const ok: { id: string; counted_qty: number; sku: string }[] = [];
    const bad: string[] = [];
    for (const rawLine of text.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line) continue;
      const parts = line.split(/[\t,;]|\s{2,}/).map((s) => s.trim()).filter(Boolean);
      const sku = (parts[0] || "").toUpperCase();
      const qty = Number((parts[1] || "").replace(/,/g, ""));
      const hit = bySku.get(sku);
      if (!hit) { bad.push(`${line} → 이 실사에 없는 SKU`); continue; }
      if (!parts[1] || Number.isNaN(qty)) { bad.push(`${line} → 수량을 못 읽음`); continue; }
      ok.push({ id: hit.id, counted_qty: qty, sku });
    }
    return { ok, bad };
  }, [text, rows, productById]);

  if (!ctl.pasteOpen) return null;
  return (
    <div className="inv-modal" onClick={() => ctl.setPasteOpen(false)}>
      <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">센 수량 붙여넣기</h3>
        <p className="inv-modal-desc">엑셀에서 <b>SKU · 수량</b> 두 칸을 그대로 복사해 붙이세요. 이 실사에 있는 줄만 채웁니다.</p>
        <textarea className="field-input inv-paste" rows={9} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"TS-BK-M\t97\nTS-WH-L\t0"} />
        <div className="inv-paste-sum">
          <b>{parsed.ok.length}줄 읽었습니다</b>
          {parsed.bad.length > 0 && <span className="inv-paste-bad"> · 못 읽은 {parsed.bad.length}줄: {parsed.bad.slice(0, 3).join(" / ")}{parsed.bad.length > 3 ? " …" : ""}</span>}
        </div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={() => ctl.setPasteOpen(false)}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!parsed.ok.length || busy}
            onClick={async () => {
              setBusy(true);
              try {
                await saveCountedQty(ctl.openId!, parsed.ok.map((r) => ({ id: r.id, counted_qty: r.counted_qty })));
                ctl.toast(`${parsed.ok.length}줄을 채웠습니다`, "success");
                ctl.setDraft({});
                ctl.setPasteOpen(false);
                ctl.lines.refetch();
              } catch (e) { ctl.toast(friendlyError(e), "error"); }
              finally { setBusy(false); }
            }}>채우기</button>
        </div>
      </div>
    </div>
  );
}
