"use client";

// 회사 설정 › 회계·세무 › 재고 기준 (2026-09-22 재고 점검 G, docs/20260922_PLAN_inventory_audit_v2.md)
//   흩어져 있던 재고 회사값을 한 탭에 — 원가 방법(이익관리 원가 이력) · 수율 임계값(생산 도구 팝업) · 채널 수수료·배송비(이익관리 팝업) · 기본 창고(창고관리).
//   저장 함수는 각 화면이 쓰던 것을 그대로 쓴다(값이 한 곳: company_settings.settings / warehouses.is_default). 옛 진입로는 남겨 둔다 — 같은 값을 읽고 쓴다.

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { appConfirm } from "@/components/global-confirm";
import { COSTING_METHODS, loadCostingMethod, saveCostingMethod, rebuildMyCosts, getCostState, type CostingMethod } from "@/lib/inventory-cost";
import { INVENTORY_DEFAULTS, loadInventorySettings, saveInventorySettings, loadChannelFees, saveChannelFees, type ChannelFees } from "@/lib/inventory-settings";
import { listWarehouses, upsertWarehouse } from "@/lib/inventory";
import { CHANNELS } from "@/lib/inventory-channels";

export function InventorySettingsTab({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [busy, setBusy] = useState<string | null>(null);

  // ── 원가 방법 ──
  const { data: method = "fifo" as CostingMethod } = useQuery({ queryKey: ["inv-cost-method", companyId], queryFn: () => loadCostingMethod(companyId) });
  const { data: state } = useQuery({ queryKey: ["inv-cost-state", companyId], queryFn: () => getCostState(companyId) });
  const changeMethod = async (m: CostingMethod) => {
    if (m === method) return;
    if (!(await appConfirm(`원가 방법을 '${COSTING_METHODS.find((x) => x.value === m)?.label}'로 바꾸고 전체를 다시 계산할까요? 이익관리·재고자산 명세·결산 초안 숫자가 바뀝니다.`, { title: "원가 방법 변경", confirmLabel: "바꾸고 다시 계산" }))) return;
    setBusy("method");
    try { await saveCostingMethod(companyId, m); const r = await rebuildMyCosts(); toast(`원가 방법을 바꿨습니다 · 층 ${r.layers} · 출고 원가 ${r.costs}`, "success"); qc.invalidateQueries({ queryKey: ["inv-cost-method", companyId] }); qc.invalidateQueries({ queryKey: ["inv-cost-state", companyId] }); }
    catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(null); }
  };
  const rebuild = async () => {
    setBusy("rebuild");
    try { const r = await rebuildMyCosts(); toast(`다시 계산했습니다 · 층 ${r.layers} · 출고 원가 ${r.costs}`, "success"); qc.invalidateQueries({ queryKey: ["inv-cost-state", companyId] }); }
    catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(null); }
  };

  // ── 수율 임계값 ──
  const [y, setY] = useState(String(INVENTORY_DEFAULTS.yield_warn * 100));
  const [l, setL] = useState(String(INVENTORY_DEFAULTS.loss_warn * 100));
  useEffect(() => { loadInventorySettings(companyId).then((s) => { setY(String(Math.round(s.yield_warn * 1000) / 10)); setL(String(Math.round(s.loss_warn * 1000) / 10)); }); }, [companyId]);
  const saveYield = async () => {
    const yv = Number(y) / 100, lv = Number(l) / 100;
    if (!(yv > 0 && yv <= 1) || !(lv >= 0 && lv < 1)) { toast("양품률은 0 초과 100 이하, 로스율은 0 이상 100 미만으로 넣으세요", "error"); return; }
    setBusy("yield");
    try { await saveInventorySettings(companyId, { yield_warn: yv, loss_warn: lv }); toast("수율 임계값을 저장했습니다. 생산현황과 AI 브리핑에 바로 적용됩니다", "success"); qc.invalidateQueries({ queryKey: ["inv-settings", companyId] }); }
    catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(null); }
  };

  // ── 채널 수수료·배송비 ──
  const { data: fees = {} as ChannelFees } = useQuery({ queryKey: ["inv-channel-fees", companyId], queryFn: () => loadChannelFees(companyId) });
  const [feeDraft, setFeeDraft] = useState<Record<string, { rate: string; ship: string }>>({});
  useEffect(() => {
    const d: Record<string, { rate: string; ship: string }> = {};
    for (const [k, v] of Object.entries(fees)) d[k] = { rate: v.fee_rate ? String(Math.round(v.fee_rate * 10000) / 100) : "", ship: v.ship_per_order ? String(v.ship_per_order) : "" };
    setFeeDraft(d);
  }, [fees]);
  const saveFees = async () => {
    const next: ChannelFees = {};
    for (const [k, v] of Object.entries(feeDraft)) { const rate = Number(v.rate || 0) / 100, ship = Number(v.ship || 0); if (rate > 0 || ship > 0) next[k] = { fee_rate: rate >= 0 && rate < 1 ? rate : 0, ship_per_order: ship >= 0 ? ship : 0 }; }
    setBusy("fees");
    try { await saveChannelFees(companyId, next); toast("채널 수수료·배송비를 저장했습니다. 이익관리 거래처·채널별에 반영됩니다", "success"); qc.invalidateQueries({ queryKey: ["inv-channel-fees", companyId] }); }
    catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(null); }
  };

  // ── 기본 창고 ──
  const { data: warehouses = [] } = useQuery({ queryKey: ["inv-warehouses", companyId], queryFn: () => listWarehouses(companyId) });
  const setDefaultWh = async (id: string) => {
    const w = warehouses.find((x) => x.id === id); if (!w || w.is_default) return;
    setBusy("wh");
    try { await upsertWarehouse(companyId, { id: w.id, name: w.name, code: w.code || undefined, is_default: true }); toast(`기본 창고를 '${w.name}'로 정했습니다. 새 입·출고의 창고 기본값이 됩니다`, "success"); qc.invalidateQueries({ queryKey: ["inv-warehouses", companyId] }); }
    catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(null); }
  };

  const channels = [...CHANNELS.map((c) => ({ value: c.value as string, label: c.label as string })), { value: "direct", label: "직접 (채널 기록 없는 판매)" }];

  return (
    <div className="space-y-5">
      <div className="stg-sec">
        <div className="stg-sec-head"><div>
          <h2 className="stg-sec-title">재고<span className="ui-sub">원가 방법</span></h2>
          <p className="stg-sec-desc">출고 원가를 어떻게 정할지. 바꾸면 전체를 다시 계산합니다(이익관리 › 원가 이력과 같은 값). 마지막 계산 {state ? state.computed_at.slice(0, 16).replace("T", " ") : "—"}{state ? ` · 층 ${state.layers} · 미확정 출고 ${state.uncosted_moves}` : ""}</p>
        </div></div>
        <div className="stg-frow stg-frow-wide">
          <div className="stg-frow-label"><b>원가 방법</b><small>{COSTING_METHODS.find((m) => m.value === method)?.desc}</small></div>
          <div className="stg-frow-body inv-set-row">
            <select className="qk-input h-8 px-2 text-xs" value={method} disabled={!!busy} onChange={(e) => void changeMethod(e.target.value as CostingMethod)}>
              {COSTING_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
            <button type="button" className="btn-secondary btn-sm" disabled={!!busy} onClick={() => void rebuild()}>{busy === "rebuild" ? "계산 중…" : "다시 계산"}</button>
          </div>
        </div>
      </div>

      <div className="stg-sec">
        <div className="stg-sec-head"><div>
          <h2 className="stg-sec-title">재고<span className="ui-sub">수율 임계값</span></h2>
          <p className="stg-sec-desc">생산현황에서 이 기준을 벗어나면 붉게 표시합니다. 양품률은 미만, 로스율은 초과일 때. 기본 95% · 5%.</p>
        </div></div>
        <div className="stg-frow stg-frow-wide">
          <div className="stg-frow-label"><b>양품률 경고</b><small>미만, %</small></div>
          <div className="stg-frow-body"><input className="qk-input h-8 w-24 px-2 text-right text-xs" inputMode="decimal" value={y} onChange={(e) => setY(e.target.value)} /></div>
        </div>
        <div className="stg-frow stg-frow-wide">
          <div className="stg-frow-label"><b>자재 로스율 경고</b><small>초과, %</small></div>
          <div className="stg-frow-body"><input className="qk-input h-8 w-24 px-2 text-right text-xs" inputMode="decimal" value={l} onChange={(e) => setL(e.target.value)} /></div>
        </div>
        <div className="stg-sec-actions"><button type="button" className="btn-primary btn-sm" disabled={!!busy} onClick={() => void saveYield()}>{busy === "yield" ? "저장 중…" : "수율 저장"}</button></div>
      </div>

      <div className="stg-sec">
        <div className="stg-sec-head"><div>
          <h2 className="stg-sec-title">재고<span className="ui-sub">채널 수수료·배송비</span></h2>
          <p className="stg-sec-desc">매출 × 수수료율, 주문 건수 × 주문당 배송비를 이익관리에서 뺍니다. 채널 정산 내역이 아니라 회사가 정한 값입니다. 비워 두면 0.</p>
        </div></div>
        <div className="stg-table-wrap">
          <table className="ev-table ev-lined table-inv-status-sm">
            <thead><tr><th className="text-left">채널</th><th>수수료율 (%)</th><th>주문당 배송비 (원)</th></tr></thead>
            <tbody>
              {channels.map((c) => (
                <tr key={c.value}>
                  <td className="text-left"><b>{c.label}</b></td>
                  <td className="tc"><input className="qk-input h-8 w-24 px-2 text-right text-xs" inputMode="decimal" placeholder="예: 5.8" value={feeDraft[c.value]?.rate ?? ""} onChange={(e) => setFeeDraft((d) => ({ ...d, [c.value]: { rate: e.target.value, ship: d[c.value]?.ship ?? "" } }))} /></td>
                  <td className="tc"><input className="qk-input h-8 w-28 px-2 text-right text-xs" inputMode="numeric" placeholder="예: 3000" value={feeDraft[c.value]?.ship ?? ""} onChange={(e) => setFeeDraft((d) => ({ ...d, [c.value]: { rate: d[c.value]?.rate ?? "", ship: e.target.value.replace(/\D/g, "") } }))} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="stg-sec-actions"><button type="button" className="btn-primary btn-sm" disabled={!!busy} onClick={() => void saveFees()}>{busy === "fees" ? "저장 중…" : "수수료 저장"}</button></div>
      </div>

      <div className="stg-sec">
        <div className="stg-sec-head"><div>
          <h2 className="stg-sec-title">재고<span className="ui-sub">기본 창고</span></h2>
          <p className="stg-sec-desc">새 입·출고·판매·구매의 창고 기본값. 창고 추가·이름은 창고관리 › 창고에서.</p>
        </div></div>
        <div className="stg-frow stg-frow-wide">
          <div className="stg-frow-label"><b>기본 창고</b><small>{warehouses.length ? `${warehouses.length}개 중` : "창고가 없습니다 — 첫 입·출고 때 자동으로 만들어집니다"}</small></div>
          <div className="stg-frow-body">
            <select className="qk-input h-8 px-2 text-xs" value={warehouses.find((w) => w.is_default)?.id || ""} disabled={!!busy || !warehouses.length} onChange={(e) => void setDefaultWh(e.target.value)}>
              {!warehouses.some((w) => w.is_default) && <option value="">— 고르기 —</option>}
              {warehouses.filter((w) => w.is_active).map((w) => <option key={w.id} value={w.id}>{w.name}{w.code ? ` (${w.code})` : ""}</option>)}
            </select>
          </div>
        </div>
      </div>
    </div>
  );
}
