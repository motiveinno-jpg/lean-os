"use client";
import { koFallback } from "@/lib/ko-label";

// ── 재고 › 이익관리 (결정 40, 2026-08-26 사장님 지시) ─────────────────────────────────────
//   구매·생산·판매를 통해 남는 돈을 **원가가 반영된** 숫자로. 원가는 DB 가 확정한 출고 원가(stock_move_costs, FIFO/이동평균)만 읽는다.
//   · 판매 이익 = 매출(반품 차감) − 매출원가(출고 원가). 손실 = 폐기·감모·샘플·증정 출고 원가. 순이익 = 판매 이익 − 손실.
//   · 층이 없어 원가를 못 정한 출고는 '원가 미확정'으로 센다 — 0 으로 잡지 않는다.
//   · 갈래: 종합 / 품목별 / 거래처·채널별 / 구매·생산 / 원가 이력(층·출고 원가·다시 계산·원가 방법).
//   규칙: 조회 화면 표준 — 상자 안 파란 밑줄 갈래, 조회 줄엔 기간, 결과 요약 줄(Stat), 위 그래프 → 아래 표.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import { todayKst } from "@/lib/kst";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat } from "@/components/query-kit";
import { DateRangeField } from "@/components/date-range-field";
import { exportToExcel } from "@/lib/excel-export";
import { LineChart, BarChart, DonutChart, Legend, vizColor } from "@/components/charts/kit";
import { listMoves, listProducts, listAvgCost, type MoveRow, type Product } from "@/lib/inventory";
import { listImports, channelLabel } from "@/lib/inventory-channels";
import { listMoveCosts, listLayers, getCostState, rebuildMyCosts, loadCostingMethod, saveCostingMethod, COSTING_METHODS, listRevaluations, addRevaluation, cancelRevaluation, REVAL_REASONS, revalReasonLabel, type CostingMethod, type MoveCost, type CostLayer } from "@/lib/inventory-cost";
import { SalesBoard } from "../../reports/_components/SalesBoard";
import { DateField } from "@/components/date-field";
import { dayKeys, dayLabel } from "@/components/finance-status-panels";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
const wonShort = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e8) return `${s}${(a / 1e8).toFixed(1)}억`;
  if (a >= 1e4) return `${s}${Math.round(a / 1e4).toLocaleString("ko-KR")}만`;
  return `${s}${Math.round(a).toLocaleString("ko-KR")}`;
};
const pct = (n: number | null) => (n == null ? "—" : `${(n * 100).toFixed(1)}%`);
type Tab = "all" | "product" | "partner" | "buymake" | "history";
const TABS: [Tab, string][] = [["all", "종합"], ["product", "품목별"], ["partner", "거래처·채널별"], ["buymake", "구매·생산"], ["history", "원가 이력"]];
const monthStart = () => todayKst().slice(0, 7) + "-01";
const LOSS_REASONS = new Set(["disposal", "sample", "gift", "count", "fix"]);
const SOURCE_LABEL: Record<string, string> = { purchase: "매입", opening: "기초", produce: "생산", return_in: "반품 입고", count: "실사 조정", fix: "정정", sale: "판매 취소", return_out: "매입 반품 취소", consume: "자재 되돌림", disposal: "폐기 취소" };

export default function InventoryProfitPage() {
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => setCompanyId(u?.company_id ?? null)); }, []);
  //   매출 KPI 현황판(결정 144) — 2026-09-02 사장님 지시로 매출 리포트에서 이사(쓰는 회사가
  //   판매·이커머스 쪽). 열릴 때만 마운트해 닫혀 있으면 전표를 안 불러온다.
  const [kpiOpen, setKpiOpen] = useState(false);
  const { toast } = useToast();
  const qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("all");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayKst);
  const [histProduct, setHistProduct] = useState<string>("");
  const [busy, setBusy] = useState(false);
  const [uncOpen, setUncOpen] = useState(false);   // 미확정 출고 — 숫자를 누르면 어떤 줄인지(2026-08-27)
  //   결정 39 — 재평가 폼(품목·일자·단가·사유·비고). 기초 원가 입력도 같은 폼.
  const [rv, setRv] = useState<{ date: string; unit: string; reason: string; note: string }>({ date: todayKst(), unit: "", reason: "reval_adjust", note: "" });

  const q = <T,>(key: string, fn: () => Promise<T>, extra: unknown[] = []) =>
    useQuery<T>({ queryKey: [key, companyId, ...extra], queryFn: fn, enabled: !!companyId });   // eslint-disable-line react-hooks/rules-of-hooks
  const { data: products = [] } = q("inv-products", () => listProducts(companyId!));
  const { data: moves = [], isLoading } = q("inv-moves", () => listMoves(companyId!, from, to), [from, to]);
  const { data: costs = [] } = q("inv-move-costs", () => listMoveCosts(companyId!, from, to), [from, to]);
  const { data: layers = [] } = q("inv-cost-layers", () => listLayers(companyId!));
  const { data: avgCost = new Map<string, number>() } = q("inv-avgcost", () => listAvgCost(companyId!));
  const { data: state } = q("inv-cost-state", () => getCostState(companyId!));
  const { data: method = "fifo" as CostingMethod } = q("inv-cost-method", () => loadCostingMethod(companyId!));
  const { data: imports = [] } = q("ch-imports", () => listImports(companyId!, 2000));
  const { data: revals = [] } = q("inv-cost-revals", () => listRevaluations(companyId!));
  const { data: partners = [] } = q("inv-partners", async () => {
    const data = await fetchPaged<any>("inv-partners", () => supabase.from("partners").select("id, name").eq("company_id", companyId!).order("name"), 50000);
    return ((data || []) as { id: string; name: string }[]);
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const partnerName = useMemo(() => new Map(partners.map((p) => [p.id, p.name])), [partners]);
  const costByMove = useMemo(() => new Map(costs.map((c) => [c.move_id, c])), [costs]);
  const layerByMove = useMemo(() => new Map(layers.map((l) => [l.move_id, l])), [layers]);
  const docChannel = useMemo(() => { const m = new Map<string, string>(); for (const i of imports) if (i.doc_id) m.set(i.doc_id, i.channel); return m; }, [imports]);
  const days = useMemo(() => dayKeys(from, to), [from, to]);

  //   ── 이익 집계 — 출고 원가만 믿는다 ──
  const S = useMemo(() => {
    let revenue = 0, cogs = 0, loss = 0, uncosted = 0, soldQty = 0;
    const perDay = new Map<string, { rev: number; cost: number }>();
    const perProduct = new Map<string, { qty: number; rev: number; cost: number; unc: number }>();
    const perPartner = new Map<string, { rev: number; cost: number }>();
    const perChannel = new Map<string, { rev: number; cost: number }>();
    const lossBy = new Map<string, number>();
    const saleRows: { m: MoveRow; rev: number; cost: number; unc: number }[] = [];
    const costOfMove = (m: MoveRow): { cost: number; unc: number } => {
      if (m.qty < 0) { const c = costByMove.get(m.id); return c ? { cost: c.cost_amount, unc: c.qty_uncosted } : { cost: 0, unc: -m.qty }; }
      //   되돌아온 것(반품·취소)은 그때 층 단가로 원가가 줄어든다
      const l = layerByMove.get(m.id); return l && l.unit_cost != null ? { cost: -m.qty * l.unit_cost, unc: 0 } : { cost: 0, unc: m.qty };
    };
    for (const m of moves) {
      const reason = m.doc?.reason; if (!reason) continue;
      if (reason === "sale" || reason === "return_in") {
        //   판매: 출고(qty<0)가 매출, 취소·반품(qty>0)은 매출 차감
        const rev = Math.abs(Number(m.amount || 0)) * (m.qty < 0 ? 1 : -1);
        const { cost, unc } = costOfMove(m);
        revenue += rev; cogs += cost; uncosted += unc; soldQty += -m.qty;
        const d = perDay.get(m.moved_at) || { rev: 0, cost: 0 }; d.rev += rev; d.cost += cost; perDay.set(m.moved_at, d);
        const pp = perProduct.get(m.product_id) || { qty: 0, rev: 0, cost: 0, unc: 0 }; pp.qty += -m.qty; pp.rev += rev; pp.cost += cost; pp.unc += unc; perProduct.set(m.product_id, pp);
        const pk = m.doc?.partner_id || "-"; const pa = perPartner.get(pk) || { rev: 0, cost: 0 }; pa.rev += rev; pa.cost += cost; perPartner.set(pk, pa);
        const ch = (m.doc && docChannel.get(m.doc.id)) || "direct"; const pc = perChannel.get(ch) || { rev: 0, cost: 0 }; pc.rev += rev; pc.cost += cost; perChannel.set(ch, pc);
        saleRows.push({ m, rev, cost, unc });
      } else if (LOSS_REASONS.has(reason) && m.qty < 0) {
        const { cost, unc } = costOfMove(m);
        loss += cost; uncosted += unc; lossBy.set(reason, (lossBy.get(reason) || 0) + cost);
      }
    }
    //   재평가 손익(결정 39) — 기간 안 재평가의 차액. 손실은 손실에 더하고, 이익은 손실에서 뺀다(순이익에만 반영)
    let revalLoss = 0, revalGain = 0;
    for (const r of revals) if (r.status === "active" && r.reval_date >= from && r.reval_date <= to) { if (r.effect_amount < 0) revalLoss += -r.effect_amount; else revalGain += r.effect_amount; }
    if (revalLoss) lossBy.set("reval", revalLoss);
    loss += revalLoss;
    const gp = revenue - cogs;
    return { revenue, cogs, gp, rate: revenue > 0 ? gp / revenue : null, loss, revalGain, net: gp - loss + revalGain, uncosted, soldQty, perDay, perProduct, perPartner, perChannel, lossBy, saleRows };
  }, [moves, costByMove, layerByMove, docChannel, revals, from, to]);

  //   ── 구매·생산: 품목별 매입 단가·층 구성 ──
  const BM = useMemo(() => {
    const buy = new Map<string, { qty: number; amt: number; min: number; max: number }>();
    for (const m of moves) {
      if (m.doc?.reason !== "purchase" || m.qty <= 0 || m.unit_price == null) continue;
      const b = buy.get(m.product_id) || { qty: 0, amt: 0, min: Infinity, max: 0 };
      b.qty += m.qty; b.amt += m.qty * Number(m.unit_price); b.min = Math.min(b.min, Number(m.unit_price)); b.max = Math.max(b.max, Number(m.unit_price)); buy.set(m.product_id, b);
    }
    const make = new Map<string, { qty: number; amt: number; overhead: number }>();
    for (const l of layers) {
      if (l.source !== "produce" || l.layer_date < from || l.layer_date > to || l.unit_cost == null) continue;
      const mv = moves.find((m) => m.id === l.move_id);
      const oh = Number(mv?.overhead_unit || 0);
      const k = make.get(l.product_id) || { qty: 0, amt: 0, overhead: 0 }; k.qty += l.qty_in; k.amt += l.qty_in * l.unit_cost; k.overhead += l.qty_in * oh; make.set(l.product_id, k);
    }
    return { buy, make };
  }, [moves, layers, from, to]);

  const onhandCost = (pid: string) => layers.filter((l) => l.product_id === pid && l.qty_left > 0 && l.unit_cost != null).reduce((n, l) => n + l.qty_left * l.unit_cost!, 0);
  const lastLayerCost = (pid: string) => { const ls = layers.filter((l) => l.product_id === pid && l.qty_left > 0 && l.unit_cost != null); return ls.length ? ls[ls.length - 1].unit_cost : (avgCost.get(pid) ?? null); };
  const histLayers = useMemo(() => layers.filter((l) => !histProduct || l.product_id === histProduct), [layers, histProduct]);
  const histCosts = useMemo(() => costs.filter((c) => !histProduct || c.product_id === histProduct).sort((a, b) => (a.moved_at < b.moved_at ? 1 : -1)), [costs, histProduct]);

  if (!permLoading && !(isMaster || hasPerm("/inventory/profit"))) {
    return <AccessDenied detail="이익관리 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }

  const rebuild = async () => {
    setBusy(true);
    try { const r = await rebuildMyCosts(); toast(`다시 계산했습니다 — 층 ${r.layers} · 출고 원가 ${r.costs} (${r.method === "avg" ? "이동평균" : "선입선출"})`, "success");
      qc.invalidateQueries({ queryKey: ["inv-move-costs"] }); qc.invalidateQueries({ queryKey: ["inv-cost-layers"] }); qc.invalidateQueries({ queryKey: ["inv-cost-state"] }); qc.invalidateQueries({ queryKey: ["inv-avgcost"] }); }
    catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(false); }
  };
  const changeMethod = async (m: CostingMethod) => {
    if (!companyId || m === method) return;
    if (!window.confirm(`원가 방법을 ${m === "avg" ? "이동평균" : "선입선출"}으로 바꾸고 전체를 다시 계산합니다. 과거 기간의 이익 숫자가 바뀔 수 있습니다. 계속할까요?`)) return;
    setBusy(true);
    try { await saveCostingMethod(companyId, m); qc.invalidateQueries({ queryKey: ["inv-cost-method"] }); await rebuild(); }
    catch (e) { toast(friendlyError(e), "error"); setBusy(false); }
  };

  const productRows = [...S.perProduct.entries()].map(([id, r]) => ({ id, p: productById.get(id), ...r, gp: r.rev - r.cost, rate: r.rev > 0 ? (r.rev - r.cost) / r.rev : null })).sort((a, b) => b.gp - a.gp);
  const partnerRows = [...S.perPartner.entries()].map(([id, r]) => ({ id, name: id === "-" ? "(거래처 없음)" : partnerName.get(id) || "(미상)", ...r, gp: r.rev - r.cost, rate: r.rev > 0 ? (r.rev - r.cost) / r.rev : null })).sort((a, b) => b.gp - a.gp);
  const channelRows = [...S.perChannel.entries()].map(([id, r]) => ({ id, name: id === "direct" ? "직접" : channelLabel(id), ...r, gp: r.rev - r.cost, rate: r.rev > 0 ? (r.rev - r.cost) / r.rev : null })).sort((a, b) => b.gp - a.gp);
  const lossLabel: Record<string, string> = { disposal: "폐기", sample: "샘플", gift: "증정", count: "실사 감모", fix: "정정", reval: "재고 평가손실" };
  const submitReval = async () => {
    if (!histProduct) { toast("품목을 먼저 고르세요", "error"); return; }
    const unit = Number(String(rv.unit).replace(/[,\s]/g, ""));
    if (!(unit >= 0) || rv.unit === "") { toast("단가를 넣으세요", "error"); return; }
    const p = productById.get(histProduct);
    const left = layers.filter((l) => l.product_id === histProduct && l.qty_left > 0);
    const leftQty = left.reduce((n, l) => n + l.qty_left, 0);
    const diff = left.reduce((n, l) => n + l.qty_left * (unit - (l.unit_cost ?? unit)), 0);
    if (!window.confirm(`${rv.date}부터 ${p?.name || "이 품목"} 남은 재고 ${won(leftQty)}개의 원가를 ₩${won(unit)}로 봅니다.${diff ? ` 차액 ₩${won(Math.abs(diff))}은 ${diff < 0 ? "평가손실" : "평가이익"}로 잡힙니다.` : ""} 이 날 이후 출고부터 새 단가가 나가고, 이전 출고는 바뀌지 않습니다. 계속할까요?`)) return;
    setBusy(true);
    try { await addRevaluation({ product_id: histProduct, reval_date: rv.date, unit_cost: unit, reason: rv.reason, note: rv.note || null }); toast("재평가를 기록하고 다시 계산했습니다", "success"); setRv((s) => ({ ...s, unit: "", note: "" }));
      for (const k of ["inv-cost-revals", "inv-move-costs", "inv-cost-layers", "inv-cost-state", "inv-avgcost"]) qc.invalidateQueries({ queryKey: [k] }); }
    catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(false); }
  };
  const undoReval = async (id: string) => {
    if (!window.confirm("이 재평가를 취소하고 다시 계산합니다. 계속할까요?")) return;
    setBusy(true);
    try { await cancelRevaluation(id); toast("재평가를 취소했습니다", "success"); for (const k of ["inv-cost-revals", "inv-move-costs", "inv-cost-layers", "inv-cost-state", "inv-avgcost"]) qc.invalidateQueries({ queryKey: [k] }); }
    catch (e) { toast(friendlyError(e), "error"); } finally { setBusy(false); }
  };
  const stats: Record<Tab, React.ReactNode> = {
    all: (<>
      <Stat label="매출" value={`₩${won(S.revenue)}`} />
      <Stat label="매출원가" value={`₩${won(S.cogs)}`} />
      <Stat label="매출총이익" value={`₩${won(S.gp)}`} tone={S.gp < 0 ? "minus" : "plus"} />
      <Stat label="이익률" value={pct(S.rate)} />
      <Stat label="손실(폐기·감모·샘플·증정·평가)" value={`₩${won(S.loss)}`} tone={S.loss ? "minus" : undefined} />
      {S.revalGain > 0 && <Stat label="재평가 이익" value={`₩${won(S.revalGain)}`} tone="plus" />}
      <Stat label="순이익" value={`₩${won(S.net)}`} tone={S.net < 0 ? "minus" : "plus"} />
      <Stat label="원가 미확정 출고" value={<button type="button" className="inv-stat-btn" onClick={() => setUncOpen(true)}>{won(S.uncosted)}개</button>} tone={S.uncosted ? "minus" : undefined} />
    </>),
    product: (<><Stat label="품목" value={`${S.perProduct.size}종`} /><Stat label="판매 수량" value={won(S.soldQty)} /><Stat label="매출총이익" value={`₩${won(S.gp)}`} /><Stat label="이익률" value={pct(S.rate)} /></>),
    partner: (<><Stat label="거래처" value={`${S.perPartner.size}곳`} /><Stat label="채널" value={`${S.perChannel.size}개`} /><Stat label="매출총이익" value={`₩${won(S.gp)}`} /></>),
    buymake: (<><Stat label="매입 품목" value={`${BM.buy.size}종`} /><Stat label="기간 매입" value={`₩${won([...BM.buy.values()].reduce((n, b) => n + b.amt, 0))}`} /><Stat label="생산 품목" value={`${BM.make.size}종`} /><Stat label="생산 원가" value={`₩${won([...BM.make.values()].reduce((n, b) => n + b.amt, 0))}`} /><Stat label="손실" value={`₩${won(S.loss)}`} tone={S.loss ? "minus" : undefined} /></>),
    history: (<><Stat label="원가 방법" value={method === "avg" ? "이동평균" : "선입선출"} /><Stat label="마지막 계산" value={state ? state.computed_at.slice(0, 16).replace("T", " ") : "—"} /><Stat label="층" value={`${state?.layers ?? 0}`} /><Stat label="미확정 출고" value={`${state?.uncosted_moves ?? 0}건`} tone={state?.uncosted_moves ? "minus" : undefined} /></>),
  };

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {TABS.map(([k, l]) => <button key={k} type="button" onClick={() => setTab(k)} className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>{l}</button>)}
          </div>
          <QueryBar right={<>
            <button type="button" className="btn-secondary btn-sm" title="매출·목표·채널을 위젯 한 판으로 — 내 판으로 고칠 수 있습니다"
              onClick={() => setKpiOpen(true)}>KPI 현황판</button>
            <button type="button" className="btn-secondary btn-sm" onClick={() => {
              const name = TABS.find(([k]) => k === tab)?.[1] || "이익";
              const rows: Record<string, unknown>[] =
                tab === "product" ? productRows.map((r) => ({ "SKU": r.p?.sku || "", "품목": r.p?.name || "", "판매 수량": r.qty, "매출": r.rev, "매출원가": r.cost, "이익": r.gp, "이익률": pct(r.rate), "미확정": r.unc, "현재 층 단가": lastLayerCost(r.id) ?? "", "현재고 원가": onhandCost(r.id) }))
                : tab === "partner" ? [...partnerRows.map((r) => ({ "구분": "거래처", "이름": r.name, "매출": r.rev, "원가": r.cost, "이익": r.gp, "이익률": pct(r.rate) })), ...channelRows.map((r) => ({ "구분": "채널", "이름": r.name, "매출": r.rev, "원가": r.cost, "이익": r.gp, "이익률": pct(r.rate) }))]
                : tab === "buymake" ? [...[...BM.buy.entries()].map(([id, b]) => ({ "구분": "매입", "품목": productById.get(id)?.name || "", "수량": b.qty, "평균 단가": b.qty ? b.amt / b.qty : "", "최저": b.min, "최고": b.max, "판매가": productById.get(id)?.sale_price ?? "" })), ...[...BM.make.entries()].map(([id, k]) => ({ "구분": "생산", "품목": productById.get(id)?.name || "", "수량": k.qty, "평균 단가": k.qty ? k.amt / k.qty : "", "노무·경비": k.overhead, "판매가": productById.get(id)?.sale_price ?? "" }))]
                : tab === "history" ? histLayers.map((l) => ({ "품목": productById.get(l.product_id)?.name || "", "일자": l.layer_date, "원천": SOURCE_LABEL[l.source] || koFallback(l.source), "입고": l.qty_in, "남음": l.qty_left, "단가": l.unit_cost ?? "" }))
                : [{ "매출": S.revenue, "매출원가": S.cogs, "매출총이익": S.gp, "이익률": pct(S.rate), "손실": S.loss, "순이익": S.net, "원가 미확정": S.uncosted }];
              exportToExcel(rows, name, `이익관리_${name}_${from}_${to}`);
            }}>엑셀</button>
          </>}>
            <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
            <span className="inv-hint">원가는 <b>{method === "avg" ? "이동평균" : "선입선출(FIFO)"}</b>으로 확정된 출고 원가 · 반품은 매출·원가에서 뺀다{S.uncosted ? <> · <b className="inv-diff-minus">원가 미확정 {won(S.uncosted)}개</b>(층 없음 — 기초 원가·매입 단가를 넣고 다시 계산)</> : null}</span>
          </QueryBar>
          <ResultStrip>{stats[tab]}</ResultStrip>
        </QueryHead>

        <QueryBody>
          <div className="inv-scroll inv-status">
            {isLoading ? <div className="collect-empty">불러오는 중…</div> : (
              <>
                {tab === "all" && (<>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>일별 매출 · 원가 · 이익</h3><p>판매 출고 기준 · 반품 차감</p>
                      <LineChart height={200} unit="원" yFmt={wonShort} series={[
                        { name: "매출", points: days.map((k) => ({ label: dayLabel(k), value: S.perDay.get(k)?.rev || 0 })) },
                        { name: "원가", points: days.map((k) => ({ label: dayLabel(k), value: S.perDay.get(k)?.cost || 0 })) },
                        { name: "이익", points: days.map((k) => ({ label: dayLabel(k), value: (S.perDay.get(k)?.rev || 0) - (S.perDay.get(k)?.cost || 0) })) },
                      ]} />
                      <Legend items={[{ name: "매출", color: vizColor(0) }, { name: "원가", color: vizColor(1) }, { name: "이익", color: vizColor(2) }]} />
                    </div>
                    <div className="pnl-panel">
                      <h3>품목별 이익</h3><p>매출총이익 큰 순 상위 10 · 음수는 팔수록 손해</p>
                      {productRows.length ? <BarChart unit="원" data={productRows.slice(0, 10).map((r, i) => ({ label: r.p?.name || "?", value: r.gp, color: r.gp < 0 ? "var(--danger)" : vizColor(i) }))} /> : <div className="inv-status-empty">이 기간에 판매가 없습니다</div>}
                    </div>
                  </div>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>손실</h3><p>판매가 아닌 출고의 원가 — 폐기·실사 감모·샘플·증정 · 합계 ₩{won(S.loss)}</p>
                      {S.lossBy.size ? <><DonutChart unit="원" total={`₩${won(S.loss)}`} data={[...S.lossBy.entries()].map(([k, v], i) => ({ label: lossLabel[k] || k, value: v, color: vizColor(i) }))} /><Legend items={[...S.lossBy.entries()].map(([k], i) => ({ name: lossLabel[k] || k, color: vizColor(i) }))} /></> : <div className="inv-status-empty">손실이 없습니다</div>}
                    </div>
                    <div className="pnl-panel">
                      <h3>이익 구조</h3><p>매출 100 기준</p>
                      {S.revenue > 0 ? <BarChart unit="원" data={[{ label: "매출", value: S.revenue, color: vizColor(0) }, { label: "매출원가", value: S.cogs, color: vizColor(1) }, { label: "매출총이익", value: Math.max(0, S.gp), color: vizColor(2) }, { label: "손실", value: S.loss, color: vizColor(3) }, { label: "순이익", value: Math.max(0, S.net), color: vizColor(4) }]} /> : <div className="inv-status-empty">이 기간에 매출이 없습니다</div>}
                    </div>
                  </div>
                  <div className="pnl-panel">
                    <h3>판매 문서별 이익</h3><p>출고 줄마다 확정 원가 · 최신순 · {S.saleRows.length}줄</p>
                    <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status">
                      <thead><tr><th>일자</th><th>문서</th><th>품목</th><th>거래처</th><th>수량</th><th>매출</th><th>원가</th><th>이익</th><th>이익률</th></tr></thead>
                      <tbody>{[...S.saleRows].sort((a, b) => (a.m.moved_at < b.m.moved_at ? 1 : -1)).slice(0, 300).map(({ m, rev, cost, unc }) => (
                        <tr key={m.id} className={unc ? "inv-row-fix" : undefined}><td className="mono-number tc">{m.moved_at}</td><td className="mono-number tc">{m.doc?.doc_no}</td>
                          <td className="text-left"><b>{productById.get(m.product_id)?.name || "?"}</b></td><td className="text-left">{m.doc?.partner_id ? partnerName.get(m.doc.partner_id) || "—" : <span className="ev-dim">—</span>}</td>
                          <td className="tr mono-number">{won(-m.qty)}</td><td className="tr mono-number">₩{won(rev)}</td><td className="tr mono-number">{unc ? <span className="inv-diff-minus">미확정 {won(unc)}</span> : `₩${won(cost)}`}</td>
                          <td className={`tr mono-number${rev - cost < 0 ? " inv-diff-minus" : ""}`}>₩{won(rev - cost)}</td><td className="tr mono-number">{pct(rev > 0 ? (rev - cost) / rev : null)}</td></tr>
                      ))}{S.saleRows.length === 0 && <tr><td colSpan={9} className="tc ev-dim">이 기간에 판매가 없습니다</td></tr>}</tbody>
                    </table></div>
                  </div>
                </>)}

                {tab === "product" && (<>
                  <div className="pnl-grid2">
                    <div className="pnl-panel"><h3>이익 상위</h3><p>매출총이익 큰 순</p>{productRows.length ? <BarChart unit="원" data={productRows.slice(0, 8).map((r, i) => ({ label: r.p?.name || "?", value: r.gp, color: vizColor(i) }))} /> : <div className="inv-status-empty">판매가 없습니다</div>}</div>
                    <div className="pnl-panel"><h3>이익률 하위</h3><p>이익률 낮은 순 — 팔수록 남지 않는 품목</p>{productRows.length ? <BarChart unit="%" data={[...productRows].filter((r) => r.rate != null).sort((a, b) => (a.rate! - b.rate!)).slice(0, 8).map((r, i) => ({ label: r.p?.name || "?", value: Math.round(r.rate! * 1000) / 10, color: r.rate! < 0 ? "var(--danger)" : vizColor(i) }))} /> : <div className="inv-status-empty">판매가 없습니다</div>}</div>
                  </div>
                  <div className="pnl-panel">
                    <h3>품목별</h3><p>매출·원가·이익은 조회 기간 · 층 단가·현재고 원가는 지금 · 품목을 누르면 원가 이력</p>
                    <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status">
                      <thead><tr><th>SKU</th><th>품목</th><th>판매 수량</th><th>매출</th><th>매출원가</th><th>이익</th><th>이익률</th><th>판매가</th><th>현재 층 단가</th><th>현재고 원가</th></tr></thead>
                      <tbody>{productRows.map((r) => (
                        <tr key={r.id} className={r.unc ? "inv-row-fix" : undefined}><td className="mono-number text-left">{r.p?.sku}</td><td className="text-left"><button type="button" className="bz-link" onClick={() => { setHistProduct(r.id); setTab("history"); }}><b>{r.p?.name || "?"}</b></button>{r.unc ? <span className="ev-dim"> · 미확정 {won(r.unc)}</span> : null}</td>
                          <td className="tr mono-number">{won(r.qty)}</td><td className="tr mono-number">₩{won(r.rev)}</td><td className="tr mono-number">₩{won(r.cost)}</td><td className={`tr mono-number${r.gp < 0 ? " inv-diff-minus" : ""}`}>₩{won(r.gp)}</td><td className="tr mono-number">{pct(r.rate)}</td>
                          <td className="tr mono-number">{r.p?.sale_price != null ? `₩${won(r.p.sale_price)}` : "—"}</td><td className="tr mono-number">{lastLayerCost(r.id) != null ? `₩${won(lastLayerCost(r.id)!)}` : "—"}</td><td className="tr mono-number">₩{won(onhandCost(r.id))}</td></tr>
                      ))}{productRows.length === 0 && <tr><td colSpan={10} className="tc ev-dim">이 기간에 판매가 없습니다</td></tr>}</tbody>
                    </table></div>
                  </div>
                </>)}

                {tab === "partner" && (
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>거래처별</h3><p>누구에게 팔아서 남았나 · 이익 큰 순</p>
                      <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>거래처</th><th>매출</th><th>원가</th><th>이익</th><th>이익률</th></tr></thead>
                        <tbody>{partnerRows.map((r) => <tr key={r.id}><td className="text-left"><b>{r.name}</b></td><td className="tr mono-number">₩{won(r.rev)}</td><td className="tr mono-number">₩{won(r.cost)}</td><td className={`tr mono-number${r.gp < 0 ? " inv-diff-minus" : ""}`}>₩{won(r.gp)}</td><td className="tr mono-number">{pct(r.rate)}</td></tr>)}
                          {partnerRows.length === 0 && <tr><td colSpan={5} className="tc ev-dim">판매가 없습니다</td></tr>}</tbody>
                      </table></div>
                    </div>
                    <div className="pnl-panel">
                      <h3>채널별</h3><p>채널 주문 기록이 매인 문서는 그 채널, 나머지는 직접</p>
                      {channelRows.length ? <><DonutChart unit="원" total={`₩${won(S.gp)}`} data={channelRows.filter((r) => r.gp > 0).map((r, i) => ({ label: r.name, value: r.gp, color: vizColor(i) }))} /><Legend items={channelRows.map((r, i) => ({ name: `${r.name} ₩${wonShort(r.gp)} (${pct(r.rate)})`, color: vizColor(i) }))} /></> : <div className="inv-status-empty">판매가 없습니다</div>}
                    </div>
                  </div>
                )}

                {tab === "buymake" && (
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>구매 — 매입 단가와 판매가</h3><p>기간 매입 단가(최저·평균·최고) vs 판매가 · 마진폭 = 판매가 − 평균 매입가</p>
                      <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>품목</th><th>수량</th><th>최저</th><th>평균</th><th>최고</th><th>판매가</th><th>마진폭</th></tr></thead>
                        <tbody>{[...BM.buy.entries()].sort((a, b) => b[1].amt - a[1].amt).map(([id, b]) => { const p = productById.get(id); const avg = b.qty ? b.amt / b.qty : 0; const sp = p?.sale_price ?? null; return (
                          <tr key={id}><td className="text-left"><b>{p?.name || "?"}</b></td><td className="tr mono-number">{won(b.qty)}</td><td className="tr mono-number">₩{won(b.min)}</td><td className="tr mono-number">₩{won(avg)}</td><td className="tr mono-number">₩{won(b.max)}</td><td className="tr mono-number">{sp != null ? `₩${won(sp)}` : "—"}</td><td className={`tr mono-number${sp != null && sp - avg < 0 ? " inv-diff-minus" : ""}`}>{sp != null ? `₩${won(sp - avg)} (${pct(sp > 0 ? (sp - avg) / sp : null)})` : "—"}</td></tr>
                        ); })}{BM.buy.size === 0 && <tr><td colSpan={7} className="tc ev-dim">이 기간에 매입이 없습니다</td></tr>}</tbody>
                      </table></div>
                    </div>
                    <div className="pnl-panel">
                      <h3>생산 — 제품 원가 구성과 판매가</h3><p>층 단가 = 자재 실투입(로스 포함) ÷ (양품+불량) + 단위당 노무·경비 · 마진폭 = 판매가 − 원가</p>
                      <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>완제품</th><th>수량</th><th>자재</th><th>노무·경비</th><th>단위 원가</th><th>판매가</th><th>마진폭</th></tr></thead>
                        <tbody>{[...BM.make.entries()].sort((a, b) => b[1].amt - a[1].amt).map(([id, k]) => { const p = productById.get(id); const unit = k.qty ? k.amt / k.qty : 0; const oh = k.qty ? k.overhead / k.qty : 0; const sp = p?.sale_price ?? null; return (
                          <tr key={id}><td className="text-left"><b>{p?.name || "?"}</b></td><td className="tr mono-number">{won(k.qty)}</td><td className="tr mono-number">₩{won(unit - oh)}</td><td className="tr mono-number">₩{won(oh)}</td><td className="tr mono-number">₩{won(unit)}</td><td className="tr mono-number">{sp != null ? `₩${won(sp)}` : "—"}</td><td className={`tr mono-number${sp != null && sp - unit < 0 ? " inv-diff-minus" : ""}`}>{sp != null ? `₩${won(sp - unit)} (${pct(sp > 0 ? (sp - unit) / sp : null)})` : "—"}</td></tr>
                        ); })}{BM.make.size === 0 && <tr><td colSpan={7} className="tc ev-dim">이 기간에 생산이 없습니다</td></tr>}</tbody>
                      </table></div>
                      {S.lossBy.size > 0 && <p className="inv-foot">손실: {[...S.lossBy.entries()].map(([k, v]) => `${lossLabel[k] || k} ₩${won(v)}`).join(" · ")}</p>}
                    </div>
                  </div>
                )}

                {tab === "history" && (<>
                  <div className="pnl-panel">
                    <h3>원가 방법 · 다시 계산</h3><p>계산은 문서를 저장할 때마다 자동으로 되고, 매일 새벽에도 한 번 맞춥니다. 방법을 바꾸면 전체를 다시 계산합니다(과거 이익이 바뀔 수 있어 확인을 받습니다).</p>
                    <div className="inv-bom-base">
                      <span className="field-label">원가 방법</span>
                      <select className="field-input inv-loss-reason" style={{ width: 160 }} value={method} disabled={busy} onChange={(e) => changeMethod(e.target.value as CostingMethod)}>
                        {COSTING_METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                      </select>
                      <em className="inv-hint">{COSTING_METHODS.find((m) => m.value === method)?.desc}</em>
                      <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={rebuild}>다시 계산</button>
                      <span className="ev-dim">마지막 계산 {state ? state.computed_at.slice(0, 16).replace("T", " ") : "—"}</span>
                    </div>
                    <div className="inv-bom-base">
                      <span className="field-label">품목</span>
                      <select className="field-input" style={{ width: 280 }} value={histProduct} onChange={(e) => setHistProduct(e.target.value)}>
                        <option value="">전체</option>{products.filter((p) => p.track_stock).map((p) => <option key={p.id} value={p.id}>{p.sku} {p.name}</option>)}
                      </select>
                      <em className="inv-hint">품목을 고르면 아래 층·출고 원가가 그 품목만 보이고, 재평가를 넣을 수 있습니다.</em>
                    </div>
                    {/*   ★ 결정 39 — 특정 시점부터 원가 변경 = 재평가. 남은 층을 새 단가로, 차액은 평가손익. 기초 원가 입력도 같은 폼. 확정은 사람(confirm). */}
                    <div className="inv-bom-base">
                      <span className="field-label">원가 재평가 · 기초 원가</span>
                      <DateField value={rv.date} onChange={(e) => { const v = typeof e === "string" ? e : (e as { target: { value: string } }).target.value; setRv((s) => ({ ...s, date: v })); }} />
                      <input className="field-input inv-count-input" style={{ width: 120 }} inputMode="numeric" placeholder="새 단가" value={rv.unit} onChange={(e) => setRv((s) => ({ ...s, unit: e.target.value }))} />
                      <select className="field-input inv-loss-reason" style={{ width: 180 }} value={rv.reason} onChange={(e) => setRv((s) => ({ ...s, reason: e.target.value }))}>
                        {REVAL_REASONS.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
                      </select>
                      <input className="field-input" style={{ width: 220 }} placeholder="비고" value={rv.note} onChange={(e) => setRv((s) => ({ ...s, note: e.target.value }))} />
                      <button type="button" className="btn-secondary btn-sm" disabled={busy || !histProduct} onClick={submitReval}>이 날부터 적용</button>
                      <em className="inv-hint">{REVAL_REASONS.find((r) => r.value === rv.reason)?.desc} · 이 날 이후 출고부터 새 단가, 이전 출고는 그대로</em>
                    </div>
                    {revals.filter((r) => !histProduct || r.product_id === histProduct).length > 0 && (
                      <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>적용일</th><th>품목</th><th>사유</th><th>새 단가</th><th>적용 수량</th><th>평가손익</th><th>비고</th><th>상태</th><th></th></tr></thead>
                        <tbody>{revals.filter((r) => !histProduct || r.product_id === histProduct).map((r) => (
                          <tr key={r.id} className={r.status === "cancelled" ? "ev-dim" : undefined}><td className="mono-number tc">{r.reval_date}</td><td className="text-left"><b>{productById.get(r.product_id)?.name || "?"}</b></td><td className="tc">{revalReasonLabel(r.reason)}</td>
                            <td className="tr mono-number">₩{won(r.unit_cost)}</td><td className="tr mono-number">{won(r.effect_qty)}</td><td className={`tr mono-number${r.effect_amount < 0 ? " inv-diff-minus" : r.effect_amount > 0 ? " inv-diff-plus" : ""}`}>{r.effect_amount === 0 ? "—" : `${r.effect_amount > 0 ? "+" : ""}₩${won(r.effect_amount)}`}</td>
                            <td className="text-left">{r.note || <span className="ev-dim">—</span>}</td><td className="tc">{r.status === "active" ? <span className="inv-pill inv-pill-ok">적용</span> : <span className="inv-pill inv-pill-danger">취소</span>}</td>
                            <td className="tc">{r.status === "active" ? <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => undoReval(r.id)}>취소</button> : null}</td></tr>
                        ))}</tbody>
                      </table></div>
                    )}
                  </div>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>입고 층</h3><p>들어온 순서 · 남은 수량이 0이면 다 나간 층 · {histLayers.length}층</p>
                      <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>일자</th><th>품목</th><th>원천</th><th>입고</th><th>남음</th><th>단가</th></tr></thead>
                        <tbody>{histLayers.slice(-300).reverse().map((l) => (
                          <tr key={l.id} className={l.unit_cost == null ? "inv-row-fix" : l.qty_left === 0 ? "ev-dim" : undefined}><td className="mono-number tc">{l.layer_date}</td><td className="text-left"><b>{productById.get(l.product_id)?.name || "?"}</b></td><td className="tc">{SOURCE_LABEL[l.source] || koFallback(l.source)}</td>
                            <td className="tr mono-number">{won(l.qty_in)}</td><td className="tr mono-number">{won(l.qty_left)}</td><td className="tr mono-number">{l.unit_cost == null ? <span className="inv-diff-minus">단가 없음</span> : `₩${won(l.unit_cost)}`}</td></tr>
                        ))}{histLayers.length === 0 && <tr><td colSpan={6} className="tc ev-dim">입고 층이 없습니다</td></tr>}</tbody>
                      </table></div>
                    </div>
                    <div className="pnl-panel">
                      <h3>출고 원가</h3><p>조회 기간 출고 · 어느 층에서 얼마 나갔나 · {histCosts.length}줄</p>
                      <div className="stg-table-wrap"><table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>일자</th><th>품목</th><th>사유</th><th>수량</th><th>원가</th><th>단가</th><th>층</th></tr></thead>
                        <tbody>{histCosts.slice(0, 300).map((c: MoveCost) => (
                          <tr key={c.move_id} className={c.qty_uncosted ? "inv-row-fix" : undefined}><td className="mono-number tc">{c.moved_at}</td><td className="text-left"><b>{productById.get(c.product_id)?.name || "?"}</b></td><td className="tc">{c.reason}</td>
                            <td className="tr mono-number">{won(-c.qty)}</td><td className="tr mono-number">₩{won(c.cost_amount)}{c.qty_uncosted ? <span className="inv-diff-minus"> · 미확정 {won(c.qty_uncosted)}</span> : null}</td><td className="tr mono-number">{c.unit_cost != null ? `₩${won(c.unit_cost)}` : "—"}</td>
                            <td className="text-left ev-dim">{(c.layers || []).map((x) => `${x.date} ${SOURCE_LABEL[x.source] || koFallback(x.source)} ${won(x.qty)}@${won(x.unit_cost)}`).join(", ") || "—"}</td></tr>
                        ))}{histCosts.length === 0 && <tr><td colSpan={7} className="tc ev-dim">이 기간에 출고가 없습니다</td></tr>}</tbody>
                      </table></div>
                    </div>
                  </div>
                </>)}
              </>
            )}
          </div>
        </QueryBody>
      </QueryScreen>
      {uncOpen && (
        <div className="inv-modal" onClick={() => setUncOpen(false)}>
          <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3 className="inv-modal-title">원가 미확정 출고 {won(S.uncosted)}개</h3>
            <p className="inv-modal-desc">층이 없어 원가를 정하지 못한 출고 — 기초 원가(원가 이력 › 재평가·기초 원가 입력)나 매입 단가를 넣고 다시 계산하면 채워집니다. 0으로 잡지 않았습니다.</p>
            <div className="stg-table-wrap ch-ship-list"><table className="ev-table ev-lined table-inv-status-sm">
              <thead><tr><th>일자</th><th>문서</th><th>품목</th><th>사유</th><th>미확정 수량</th></tr></thead>
              <tbody>{costs.filter((c) => c.qty_uncosted > 0).map((c) => <tr key={c.move_id}><td className="mono-number tc">{c.moved_at}</td><td className="tc">{moves.find((m) => m.id === c.move_id)?.doc?.doc_no || "—"}</td><td className="text-left"><b>{productById.get(c.product_id)?.name || "?"}</b></td><td className="tc">{c.reason}</td><td className="tr mono-number">{won(c.qty_uncosted)}</td></tr>)}
                {!costs.some((c) => c.qty_uncosted > 0) && <tr><td colSpan={5} className="tc ev-dim">없습니다</td></tr>}</tbody>
            </table></div>
            <div className="inv-modal-actions"><button type="button" className="bz-link" onClick={() => { setUncOpen(false); setTab("history"); }}>원가 이력에서 기초 원가 입력 →</button><span className="doc-sums-sp" /><button type="button" className="btn-secondary btn-sm" onClick={() => setUncOpen(false)}>닫기</button></div>
          </div>
        </div>
      )}
      {/* 매출 KPI 현황판 — 열릴 때만 마운트(전표 조회는 그때) */}
      {kpiOpen && <SalesBoard open onClose={() => setKpiOpen(false)} companyId={companyId} />}
    </div>
  );
}
