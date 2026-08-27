"use client";

// ── 재고 › 현황 — 종합판 (2026-08-26 사장님 지시) ───────────────────────────────
//   "거래에서 입력하고 이력에서 확인하는 것까지는 되는데, 주문·판매·구매·생산 현황을 한 번에 보는 종합판이 필요하다.
//    집계와 그래프로 지표를 제공."
//
//   무엇을 기준으로 판단하는가
//   · 숫자는 전부 **살아 있는 전표의 줄(stock_moves)** 과 **주문서 줄** 에서 그 자리에서 센다 — 재고와 같은 눈(결정 3·25).
//     따로 집계 표를 두면 전표를 고쳤을 때 둘이 어긋난다.
//   · 반품은 판매·매입에서 **뺀다**(창고관리 › 집계와 같은 규칙). 취소 전표는 애초에 안 온다(listMoves 가 뺀다).
//   · 원가·마진은 이동평균(결정 27) — 없으면 품목 매입가. 원가가 하나도 없으면 마진을 '—' 로 둔다(0 이라고 거짓말하지 않는다).
//   · 주문 진행률 = 가져간 수량 ÷ 주문 수량(v_order_line_used). 납기 지남 = 납기일 < 오늘 이고 아직 남은 수량이 있는 열린 주문.
//   · 자재 부족 = 열린 주문의 남은 수량 × 자재구성 − 현재고. 자재구성이 없는 완제품은 셈에서 빠진다(화면에 적는다).
//   · 채널 비중 = 판매 전표가 채널 주문 기록(channel_order_imports)에 매여 있으면 그 채널, 아니면 '직접'.
//
//   화면 규칙: 조회 화면 표준 — 갈래는 상자 안 파란 밑줄, 조회 줄엔 기간만, 결과 요약 줄(Stat), 판(pnl-panel) 안에 그래프와 표.
//   그래프는 차트 키트(SVG) — 계열색은 순서대로, 축은 하나.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import { todayKst } from "@/lib/kst";
import { QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat } from "@/components/query-kit";
import { DateRangeField } from "@/components/date-range-field";
import { exportToExcel } from "@/lib/excel-export";
import { ColumnChart, LineChart, DonutChart, BarChart, Legend, vizColor } from "@/components/charts/kit";
import {
  listMoves, listStockDocs, listOnHand, listAvgCost, listProducts, listWarehouses,
  type MoveRow, type Product, DEFECT_WAREHOUSE_CODE,
} from "@/lib/inventory";
import { listOrders, listUsed, listOrderLinesAll, type Order } from "@/lib/inventory-orders";
import { listBoms, perUnit, lossReasonLabel } from "@/lib/inventory-production";
import { loadInventorySettings, INVENTORY_DEFAULTS } from "@/lib/inventory-settings";
import { listImports, channelLabel } from "@/lib/inventory-channels";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
const wonShort = (n: number) => {
  const a = Math.abs(n), s = n < 0 ? "-" : "";
  if (a >= 1e8) return `${s}${(a / 1e8).toFixed(1)}억`;
  if (a >= 1e4) return `${s}${Math.round(a / 1e4).toLocaleString("ko-KR")}만`;
  return `${s}${Math.round(a).toLocaleString("ko-KR")}`;
};
type Tab = "all" | "order" | "sale" | "buy" | "make";
const TABS: [Tab, string][] = [["all", "종합"], ["order", "주문현황"], ["sale", "판매현황"], ["buy", "구매현황"], ["make", "생산현황"]];

/** 기간 안의 날짜를 전부 깔아 둔다 — 없는 날은 0 (그래프가 건너뛰지 않게) */
function dayKeys(from: string, to: string): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00`), end = new Date(`${to}T00:00:00`);
  //   toISOString 은 UTC 라 한국에선 하루 앞으로 밀린다 — 로컬 날짜로 만든다
  const p = (n: number) => String(n).padStart(2, "0");
  for (let i = 0; d <= end && i < 400; i++, d.setDate(d.getDate() + 1)) out.push(`${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`);
  return out;
}
const dayLabel = (k: string) => `${parseInt(k.slice(5, 7), 10)}/${parseInt(k.slice(8, 10), 10)}`;
const monthStart = () => todayKst().slice(0, 7) + "-01";

/** 판매·매입 줄의 '순 금액' — 반품은 뺀다. 판매는 음수로 쌓여 있다. */
function netOf(m: MoveRow, reason: "sale" | "purchase") {
  const qty = Math.abs(m.qty) * (reason === "sale" ? (m.qty < 0 ? 1 : -1) : (m.qty > 0 ? 1 : -1));
  const amt = Math.abs(Number(m.amount || 0)) * (qty < 0 ? -1 : 1);
  return { qty, amt };
}

export default function InventoryStatusPage() {
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => setCompanyId(u?.company_id ?? null)); }, []);

  const [tab, setTab] = useState<Tab>("all");
  const [from, setFrom] = useState(monthStart);
  const [to, setTo] = useState(todayKst);
  const [saleView, setSaleView] = useState<"product" | "partner" | "channel">("product");
  //   ★ 숫자는 눌러서 내역이 보여야 한다(2026-08-27 사장님) — 요약 줄·처리할 것의 건수마다 팝업 목록 + 그 화면으로 가는 링크
  const [detail, setDetail] = useState<{ title: string; desc?: string; head: string[]; rows: React.ReactNode[][]; go?: { href: string; label: string } } | null>(null);
  const [buyView, setBuyView] = useState<"product" | "partner">("partner");
  const today = todayKst();

  const q = <T,>(key: string, fn: () => Promise<T>, extra: unknown[] = []) =>
    useQuery<T>({ queryKey: [key, companyId, ...extra], queryFn: fn, enabled: !!companyId });   // eslint-disable-line react-hooks/rules-of-hooks
  const { data: products = [] } = q("inv-products", () => listProducts(companyId!));
  const { data: warehouses = [] } = q("inv-warehouses", () => listWarehouses(companyId!));
  const { data: onhand = [] } = q("inv-onhand", () => listOnHand(companyId!));
  const { data: avgCost = new Map<string, number>() } = q("inv-avgcost", () => listAvgCost(companyId!));
  const { data: moves = [], isLoading: movesLoading } = q("inv-moves", () => listMoves(companyId!, from, to), [from, to]);
  const { data: docs = [] } = q("inv-status-docs", () => listStockDocs(companyId!, ["sale", "purchase", "produce", "consume"], from, to), [from, to]);
  const { data: orders = [] } = q("inv-status-orders", () => listOrders(companyId!, from, to), [from, to]);
  //   열린 주문은 기간과 상관없이 — 납기 지남·자재 부족은 '지금' 의 일이다
  const { data: openOrders = [] } = q("inv-status-open-orders", async () => (await listOrders(companyId!, "1900-01-01", "2999-12-31")).filter((o) => o.status === "open"));
  const orderIds = useMemo(() => [...new Set([...orders, ...openOrders].map((o) => o.id))], [orders, openOrders]);
  const { data: used = [] } = q("inv-status-used", () => listUsed(companyId!, orderIds), [orderIds.join(",")]);
  const { data: orderLines = [] } = q("inv-status-order-lines", () => listOrderLinesAll(companyId!, orderIds), [orderIds.join(",")]);
  const { data: boms = [] } = q("inv-boms", () => listBoms(companyId!));
  const { data: imports = [] } = q("ch-imports", () => listImports(companyId!, 2000));
  //   수율·로스 경고 임계 — 회사가 정한 값(생산 › 도구 › 수율 임계값). AI 브리핑도 같은 값을 읽는다.
  const { data: invCfg = INVENTORY_DEFAULTS } = q("inv-settings", () => loadInventorySettings(companyId!));
  const YIELD_WARN = invCfg.yield_warn, LOSS_WARN = invCfg.loss_warn;
  const { data: partners = [] } = q("inv-partners", async () => {
    const { data } = await supabase.from("partners").select("id, name").eq("company_id", companyId!).limit(1000);
    return ((data || []) as { id: string; name: string }[]);
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const partnerName = useMemo(() => new Map(partners.map((p) => [p.id, p.name])), [partners]);
  const whName = useMemo(() => new Map(warehouses.map((w) => [w.id, w.name])), [warehouses]);
  const costOf = (pid: string) => avgCost.get(pid) ?? productById.get(pid)?.cost_price ?? null;
  const days = useMemo(() => dayKeys(from, to), [from, to]);

  // ── 종합 ──
  const stock = useMemo(() => {
    let amount = 0, short = 0, out = 0, priced = 0;
    const byProduct = new Map<string, number>();
    const shortList: { p: Product; qty: number }[] = [], outList: { p: Product; qty: number }[] = [];
    for (const o of onhand) byProduct.set(o.product_id, (byProduct.get(o.product_id) || 0) + Number(o.qty));
    for (const p of products) {
      if (!p.track_stock || !p.is_active) continue;
      const qty = byProduct.get(p.id) || 0;
      const c = costOf(p.id);
      if (c != null && qty > 0) { amount += qty * c; priced++; }
      if (qty <= 0) { out++; outList.push({ p, qty }); }
      else if (p.safety_stock != null && qty < p.safety_stock) { short++; shortList.push({ p, qty }); }
    }
    return { amount, short, out, priced, byProduct, shortList, outList };
  }, [onhand, products, avgCost]);   // eslint-disable-line react-hooks/exhaustive-deps

  const sale = useMemo(() => {
    let amt = 0, qty = 0, ret = 0, cost = 0, costed = 0;
    const perDay = new Map<string, number>(), perProduct = new Map<string, { qty: number; amt: number }>(),
      perPartner = new Map<string, number>(), perChannel = new Map<string, number>();
    const docChannel = new Map<string, string>();
    for (const i of imports) if (i.doc_id) docChannel.set(i.doc_id, i.channel);
    const docIds = new Set<string>();
    for (const m of moves) {
      if (m.doc?.reason !== "sale") continue;
      const n = netOf(m, "sale");
      amt += n.amt; qty += n.qty;
      if (n.qty < 0) ret += Math.abs(n.amt);
      const c = costOf(m.product_id);
      if (c != null) { cost += n.qty * c; costed++; }
      perDay.set(m.moved_at, (perDay.get(m.moved_at) || 0) + n.amt);
      const pp = perProduct.get(m.product_id) || { qty: 0, amt: 0 }; pp.qty += n.qty; pp.amt += n.amt; perProduct.set(m.product_id, pp);
      const pk = m.doc?.partner_id || "-"; perPartner.set(pk, (perPartner.get(pk) || 0) + n.amt);
      const ch = (m.doc && docChannel.get(m.doc.id)) || "direct"; perChannel.set(ch, (perChannel.get(ch) || 0) + n.amt);
      if (m.doc) docIds.add(m.doc.id);
    }
    const saleDocs = docs.filter((d) => d.reason === "sale" && d.status === "active");
    return {
      amt, qty, ret, cost, margin: costed ? amt - cost : null, docs: saleDocs.length,
      noVoucher: saleDocs.filter((d) => !d.journal_entry_id).length, noVoucherDocs: saleDocs.filter((d) => !d.journal_entry_id),
      products: perProduct.size, perDay, perProduct, perPartner, perChannel,
    };
  }, [moves, docs, imports, avgCost]);   // eslint-disable-line react-hooks/exhaustive-deps

  const buy = useMemo(() => {
    let amt = 0, qty = 0, ret = 0;
    const perDay = new Map<string, number>(), perProduct = new Map<string, { qty: number; amt: number }>(), perPartner = new Map<string, number>();
    for (const m of moves) {
      if (m.doc?.reason !== "purchase") continue;
      const n = netOf(m, "purchase");
      amt += n.amt; qty += n.qty; if (n.qty < 0) ret += Math.abs(n.amt);
      perDay.set(m.moved_at, (perDay.get(m.moved_at) || 0) + n.amt);
      const pp = perProduct.get(m.product_id) || { qty: 0, amt: 0 }; pp.qty += n.qty; pp.amt += n.amt; perProduct.set(m.product_id, pp);
      const pk = m.doc?.partner_id || "-"; perPartner.set(pk, (perPartner.get(pk) || 0) + n.amt);
    }
    return { amt, qty, ret, docs: docs.filter((d) => d.reason === "purchase" && d.status === "active").length, perDay, perProduct, perPartner };
  }, [moves, docs]);

  //   ★ 결정 32 (2026-08-26) — 양품률 = 양품 ÷ (양품+불량), 자재 로스율 = Σ(실투입−표준) ÷ Σ표준. 불량 = 불량 보류 창고 줄.
  //     불량·std_qty 기록이 없는 기간은 100%/0% 가 아니라 "기록 없음"으로 적는다(거짓 100% 방지).
  const defectWh = useMemo(() => warehouses.find((w) => w.code === DEFECT_WAREHOUSE_CODE)?.id || null, [warehouses]);
  const make = useMemo(() => {
    let doneQty = 0, doneAmt = 0, matAmt = 0, defectQty = 0, stdSum = 0, actSum = 0, lossRecords = 0, scrapLoss = 0;
    const perDay = new Map<string, number>(), perProduct = new Map<string, { qty: number; amt: number; defect: number }>(), matPer = new Map<string, { qty: number; amt: number; std: number; loss: number }>();
    const lossReasonSum = new Map<string, number>();
    for (const m of moves) {
      if (m.doc?.reason === "produce") {
        const isDefect = !!defectWh && m.warehouse_id === defectWh;
        doneAmt += Math.abs(Number(m.amount || 0));
        const pp = perProduct.get(m.product_id) || { qty: 0, amt: 0, defect: 0 };
        if (isDefect) { defectQty += m.qty; pp.defect += m.qty; } else { doneQty += m.qty; pp.qty += m.qty; perDay.set(m.moved_at, (perDay.get(m.moved_at) || 0) + m.qty); }
        pp.amt += Math.abs(Number(m.amount || 0)); perProduct.set(m.product_id, pp);
      } else if (m.doc?.reason === "consume") {
        const c = costOf(m.product_id) ?? 0;
        const a = Math.abs(Number(m.amount || 0)) || Math.abs(m.qty) * c;
        matAmt += a;
        const pp = matPer.get(m.product_id) || { qty: 0, amt: 0, std: 0, loss: 0 };
        const act = Math.abs(m.qty), std = m.std_qty == null ? act : Math.abs(Number(m.std_qty));
        pp.qty += act; pp.amt += a; pp.std += std; pp.loss += act - std; matPer.set(m.product_id, pp);
        if (m.std_qty != null) { lossRecords++; stdSum += std; actSum += act; if (act !== std) lossReasonSum.set(m.loss_reason || "other", (lossReasonSum.get(m.loss_reason || "other") || 0) + (act - std) * c); }
      } else if (m.doc?.reason === "disposal" && defectWh && m.warehouse_id === defectWh) {
        //   불량 폐기 = 손실(결정 31). 금액이 없으면 이동평균으로.
        scrapLoss += Math.abs(Number(m.amount || 0)) || Math.abs(m.qty) * (costOf(m.product_id) ?? 0);
      }
    }
    //   불량 보류 창고의 지금 재고(수량·이동평균 금액)
    let defectOnhand = 0, defectOnhandAmt = 0;
    if (defectWh) for (const o of onhand) if (o.warehouse_id === defectWh && Number(o.qty) > 0) { defectOnhand += Number(o.qty); defectOnhandAmt += Number(o.qty) * (costOf(o.product_id) ?? 0); }
    const yieldRate = doneQty + defectQty > 0 ? doneQty / (doneQty + defectQty) : null;
    const lossRate = stdSum > 0 ? (actSum - stdSum) / stdSum : null;
    //   자재 부족 — 열린 주문의 남은 수량 × 자재구성 − 현재고
    const usedByLine = new Map(used.map((u) => [u.order_line_id, u]));
    const need = new Map<string, number>();
    let noBom = 0; const noBomNames = new Set<string>();
    const openIds = new Set(openOrders.map((o) => o.id));
    for (const l of orderLines) {
      if (!openIds.has(l.order_id)) continue;
      const u = usedByLine.get(l.id);
      const remain = Math.max(0, l.qty - (u?.used_qty || 0));
      if (remain <= 0) continue;
      const bl = boms.filter((b) => b.product_id === l.product_id);
      if (!bl.length) { noBom++; noBomNames.add(productById.get(l.product_id)?.name || l.product_id); continue; }
      for (const b of bl) need.set(b.component_id, (need.get(b.component_id) || 0) + perUnit(b) * remain);
    }
    const shortage = [...need.entries()].map(([pid, n]) => ({ product_id: pid, need: n, have: stock.byProduct.get(pid) || 0 }))
      .filter((x) => x.have < x.need).sort((a, b) => (b.need - b.have) - (a.need - a.have));
    return { doneQty, doneAmt, matAmt, docs: docs.filter((d) => d.reason === "produce" && d.status === "active").length, perDay, perProduct, matPer, shortage, noBom, noBomNames: [...noBomNames],
      defectQty, yieldRate, lossRate, lossRecords, lossReasonSum, scrapLoss, defectOnhand, defectOnhandAmt };
  }, [moves, docs, used, orderLines, boms, openOrders, stock.byProduct, avgCost, defectWh, onhand]);   // eslint-disable-line react-hooks/exhaustive-deps

  const order = useMemo(() => {
    const usedByLine = new Map(used.map((u) => [u.order_line_id, u]));
    const linesByOrder = new Map<string, typeof orderLines>();
    for (const l of orderLines) linesByOrder.set(l.order_id, [...(linesByOrder.get(l.order_id) || []), l]);
    const rowOf = (o: Order) => {
      const ls = linesByOrder.get(o.id) || [];
      const ordered = ls.reduce((n, l) => n + l.qty, 0);
      const usedQ = ls.reduce((n, l) => n + Math.min(l.qty, usedByLine.get(l.id)?.used_qty || 0), 0);
      const amt = ls.reduce((n, l) => n + l.supply_amount, 0);
      const remain = ordered - usedQ;
      const dday = o.due_date ? Math.round((new Date(o.due_date).getTime() - new Date(today).getTime()) / 86400000) : null;
      return { o, ordered, used: usedQ, remain, amt, pct: ordered ? Math.round(usedQ / ordered * 100) : 0, dday,
        late: o.status === "open" && remain > 0 && dday != null && dday < 0 };
    };
    const inPeriod = orders.map(rowOf);
    const open = openOrders.map(rowOf).filter((r) => r.remain > 0);
    const perDay = new Map<string, number>();
    for (const r of inPeriod) perDay.set(r.o.order_date, (perDay.get(r.o.order_date) || 0) + r.amt);
    const ordered = inPeriod.reduce((n, r) => n + r.ordered, 0), usedQ = inPeriod.reduce((n, r) => n + r.used, 0);
    return {
      count: inPeriod.length, amt: inPeriod.reduce((n, r) => n + r.amt, 0), pct: ordered ? Math.round(usedQ / ordered * 100) : null,
      late: open.filter((r) => r.late), open, remainAmt: open.reduce((n, r) => n + (r.ordered ? r.amt * r.remain / r.ordered : 0), 0),
      rows: [...inPeriod].sort((a, b) => (b.late ? 1 : 0) - (a.late ? 1 : 0) || (a.dday ?? 9e9) - (b.dday ?? 9e9)), perDay,
    };
  }, [orders, openOrders, orderLines, used, today]);

  if (!permLoading && !(isMaster || hasPerm("/inventory/status"))) {
    return <AccessDenied detail="현황 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }

  const series = (m: Map<string, number>) => days.map((k) => ({ label: dayLabel(k), value: m.get(k) || 0 }));
  const topN = (m: Map<string, { qty: number; amt: number }>, n = 10) =>
    [...m.entries()].sort((a, b) => b[1].amt - a[1].amt).slice(0, n)
      .map(([pid, v], i) => ({ label: productById.get(pid)?.name || "?", value: v.amt, color: vizColor(i) }));
  const perPartnerRows = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])
    .map(([pid, amt]) => ({ key: pid, label: pid === "-" ? "거래처 없음" : (partnerName.get(pid) || "?"), amt }));
  const perProductRows = (m: Map<string, { qty: number; amt: number }>) => [...m.entries()].sort((a, b) => b[1].amt - a[1].amt)
    .map(([pid, v]) => ({ key: pid, p: productById.get(pid), ...v }));
  const empty = !movesLoading && moves.length === 0 && orders.length === 0;

  const nm = (id: string) => productById.get(id)?.name || "?";
  const openShort = () => setDetail({ title: `재고 부족 ${stock.short}개`, desc: "안전재고 아래로 내려간 품목 — 창고 합계 기준", head: ["품목", "현재고", "안전재고", "모자람"],
    rows: stock.shortList.sort((a, b) => (a.qty - (a.p.safety_stock || 0)) - (b.qty - (b.p.safety_stock || 0))).map(({ p, qty }) => [<b key="n">{p.name}</b>, won(qty), won(p.safety_stock || 0), won((p.safety_stock || 0) - qty)]),
    go: { href: "/inventory/purchase?fill=1", label: "구매 입력에서 부족분 채우기 →" } });
  const openOut = () => setDetail({ title: `품절 ${stock.out}개`, desc: "현재고가 0 이하인 품목", head: ["품목", "현재고", "안전재고"],
    rows: stock.outList.map(({ p, qty }) => [<b key="n">{p.name}</b>, won(qty), p.safety_stock != null ? won(p.safety_stock) : "—"]), go: { href: "/inventory/purchase?fill=1", label: "구매 입력에서 부족분 채우기 →" } });
  const openNoVoucher = () => setDetail({ title: `전표 없는 판매 ${sale.noVoucher}건`, desc: "재고는 나갔지만 회계 전표가 아직 없는 판매 문서", head: ["일자", "문서", "거래처", "합계"],
    rows: sale.noVoucherDocs.map((d) => [d.doc_date, <b key="n">{d.doc_no}</b>, d.partner_id ? partnerName.get(d.partner_id) || "—" : "—", `₩${won(d.supply + d.vat)}`]), go: { href: "/partners/reconciliation/sale-purchase", label: "매입매출전표 › 증빙에서 불러오기 →" } });
  const openLate = () => setDetail({ title: `납기 지난 주문 ${order.late.length}건`, desc: "납기가 지났는데 잔량이 남은 주문", head: ["번호", "거래처", "납기", "지난 날", "잔량"],
    rows: order.late.map((r) => [<b key="n">{r.o.order_no}</b>, r.o.partner_name || partnerName.get(r.o.partner_id || "") || "—", r.o.due_date || "—", r.dday == null ? "—" : `D+${-r.dday}`, won(r.remain)]), go: { href: "/inventory/orders", label: "주문으로 →" } });
  const openOpen = () => setDetail({ title: `열린 주문 잔량 ${order.open.length}건`, desc: "아직 다 채우지 못한 주문", head: ["번호", "거래처", "납기", "주문", "가져간", "잔량"],
    rows: order.open.map((r) => [<b key="n">{r.o.order_no}</b>, r.o.partner_name || partnerName.get(r.o.partner_id || "") || "—", r.o.due_date || "—", won(r.ordered), won(r.used), won(r.remain)]), go: { href: "/inventory/orders", label: "주문으로 →" } });
  const openMatShort = () => setDetail({ title: `자재 부족 ${make.shortage.length}품목`, desc: "열린 주문 잔량 × 자재구성 − 현재고", head: ["자재", "필요", "현재고", "부족"],
    rows: make.shortage.map((x) => [<b key="n">{nm(x.product_id)}</b>, won(x.need), won(x.have), won(x.need - x.have)]), go: { href: "/inventory/purchase?fill=1", label: "구매 입력에서 부족분 채우기 →" } });
  const openDefect = () => setDetail({ title: `불량 보류 ${won(make.defectOnhand)}개`, desc: "불량 보류 창고의 재고 — 처분은 생산 › 도구 › 불량 처분", head: ["품목", "수량", "금액(이동평균)"],
    rows: defectWh ? onhand.filter((o) => o.warehouse_id === defectWh && Number(o.qty) > 0).map((o) => [<b key="n">{nm(o.product_id)}</b>, won(Number(o.qty)), `₩${won(Number(o.qty) * (costOf(o.product_id) ?? 0))}`]) : [], go: { href: "/inventory/production", label: "생산 › 불량 처분 →" } });
  const stats: Record<Tab, React.ReactNode> = {
    all: (<>
      <Stat label="재고 금액" value={`₩${won(stock.amount)}`} />
      <Stat label="부족" value={<button type="button" className="inv-stat-btn" onClick={openShort}>{stock.short}개</button>} tone={stock.short ? "minus" : undefined} />
      <Stat label="품절" value={<button type="button" className="inv-stat-btn" onClick={openOut}>{stock.out}개</button>} tone={stock.out ? "minus" : undefined} />
      <Stat label="기간 매출" value={`₩${won(sale.amt)}`} />
      <Stat label="기간 매입" value={`₩${won(buy.amt)}`} />
      <Stat label="마진(매출−원가)" value={sale.margin == null ? "—" : `₩${won(sale.margin)}`} tone={sale.margin != null && sale.margin < 0 ? "minus" : undefined} />
      <Stat label="전표 없는 판매" value={<button type="button" className="inv-stat-btn" onClick={openNoVoucher}>{sale.noVoucher}건</button>} tone={sale.noVoucher ? "minus" : undefined} />
      <Stat label="납기 지난 주문" value={<button type="button" className="inv-stat-btn" onClick={openLate}>{order.late.length}건</button>} tone={order.late.length ? "minus" : undefined} />
    </>),
    order: (<>
      <Stat label="주문" value={`${order.count}건`} />
      <Stat label="주문 금액" value={`₩${won(order.amt)}`} />
      <Stat label="진행률" value={order.pct == null ? "—" : `${order.pct}%`} />
      <Stat label="열린 주문 잔량" value={<button type="button" className="inv-stat-btn" onClick={openOpen}>{order.open.length}건 · ₩{won(order.remainAmt)}</button>} />
      <Stat label="납기 지남" value={<button type="button" className="inv-stat-btn" onClick={openLate}>{order.late.length}건</button>} tone={order.late.length ? "minus" : undefined} />
    </>),
    sale: (<>
      <Stat label="판매" value={`₩${won(sale.amt)}`} />
      <Stat label="전표" value={`${sale.docs}건`} />
      <Stat label="수량" value={won(sale.qty)} />
      <Stat label="품목" value={`${sale.products}종`} />
      <Stat label="반품" value={`₩${won(sale.ret)}`} tone={sale.ret ? "minus" : undefined} />
      <Stat label="마진" value={sale.margin == null ? "—" : `₩${won(sale.margin)}`} />
      <Stat label="전표 없음" value={<button type="button" className="inv-stat-btn" onClick={openNoVoucher}>{sale.noVoucher}건</button>} tone={sale.noVoucher ? "minus" : undefined} />
    </>),
    buy: (<>
      <Stat label="매입" value={`₩${won(buy.amt)}`} />
      <Stat label="전표" value={`${buy.docs}건`} />
      <Stat label="수량" value={won(buy.qty)} />
      <Stat label="반품" value={`₩${won(buy.ret)}`} tone={buy.ret ? "minus" : undefined} />
      <Stat label="거래처" value={`${buy.perPartner.size}곳`} />
    </>),
    make: (<>
      <Stat label="양품" value={won(make.doneQty)} />
      <Stat label="불량" value={won(make.defectQty)} tone={make.defectQty ? "minus" : undefined} />
      <Stat label="양품률" value={make.yieldRate == null ? "기록 없음" : `${(make.yieldRate * 100).toFixed(1)}%`} tone={make.yieldRate != null && make.yieldRate < YIELD_WARN ? "minus" : undefined} />
      <Stat label="자재 로스율" value={make.lossRate == null ? "기록 없음" : `${(make.lossRate * 100).toFixed(1)}%`} tone={make.lossRate != null && make.lossRate > LOSS_WARN ? "minus" : undefined} />
      <Stat label="불량 보류" value={<button type="button" className="inv-stat-btn" onClick={openDefect}>{won(make.defectOnhand)}개 · ₩{won(make.defectOnhandAmt)}</button>} tone={make.defectOnhand ? "minus" : undefined} />
      <Stat label="폐기 손실" value={`₩${won(make.scrapLoss)}`} tone={make.scrapLoss ? "minus" : undefined} />
      <Stat label="자재 투입" value={`₩${won(make.matAmt)}`} />
      <Stat label="자재 부족" value={<button type="button" className="inv-stat-btn" onClick={openMatShort}>{make.shortage.length}품목</button>} tone={make.shortage.length ? "minus" : undefined} />
    </>),
  };

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {TABS.map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)} className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>{l}</button>
            ))}
          </div>
          <QueryBar right={
            <button type="button" className="btn-secondary btn-sm" disabled={empty} onClick={() => {
              const name = TABS.find(([k]) => k === tab)?.[1] || "현황";
              const rows: Record<string, unknown>[] =
                tab === "order" ? order.rows.map((r) => ({ "번호": r.o.order_no, "주문일": r.o.order_date, "거래처": r.o.partner_name || partnerName.get(r.o.partner_id || "") || "", "납기": r.o.due_date || "", "주문 수량": r.ordered, "가져간 수량": r.used, "잔량": r.remain, "진행률": r.pct, "금액": r.amt, "상태": r.o.status === "cancelled" ? "취소" : r.remain <= 0 ? "완료" : r.late ? "납기 지남" : "진행 중" }))
                : tab === "sale" ? perProductRows(sale.perProduct).map((r) => { const c = costOf(r.key); return { "SKU": r.p?.sku || "", "품목": r.p?.name || "", "수량": r.qty, "매출": r.amt, "원가": c == null ? "" : c * r.qty, "마진": c == null ? "" : r.amt - c * r.qty }; })
                : tab === "buy" ? perProductRows(buy.perProduct).map((r) => ({ "SKU": r.p?.sku || "", "품목": r.p?.name || "", "수량": r.qty, "매입": r.amt, "평균 단가": r.qty ? r.amt / r.qty : "", "현재고": stock.byProduct.get(r.key) || 0 }))
                : tab === "make" ? [...make.perProduct.entries()].map(([id, r]) => ({ "완제품": productById.get(id)?.name || "", "양품": r.qty, "불량": r.defect, "양품률": r.qty + r.defect ? `${(r.qty / (r.qty + r.defect) * 100).toFixed(1)}%` : "", "완성 금액": r.amt }))
                : [{ "재고 금액": stock.amount, "부족": stock.short, "품절": stock.out, "기간 매출": sale.amt, "기간 매입": buy.amt, "마진": sale.margin ?? "", "전표 없는 판매": sale.noVoucher, "납기 지난 주문": order.late.length }];
              exportToExcel(rows, name, `재고현황_${name}_${from}_${to}`);
            }}>엑셀</button>
          }>
            <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
            <span className="inv-hint">취소 전표는 빠지고 반품은 뺀 순 금액 · 원가는 이동평균(없으면 매입가)</span>
          </QueryBar>
          <ResultStrip>{stats[tab]}</ResultStrip>
        </QueryHead>

        <QueryBody>
          <div className="inv-scroll inv-status">
            {movesLoading ? <div className="collect-empty">불러오는 중…</div> : empty ? (
              <div className="collect-empty">이 기간에 전표·주문이 없습니다 — 판매·구매·생산·주문에서 저장하면 여기에 집계됩니다.</div>
            ) : (
              <>
                {tab === "all" && (<>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>일별 매출 · 매입</h3><p>판매 전표(반품 뺀 순액)와 매입 전표</p>
                      <LineChart height={200} unit="원" yFmt={wonShort} series={[
                        { name: "매출", points: series(sale.perDay) }, { name: "매입", points: series(buy.perDay) },
                      ]} />
                      <Legend items={[{ name: "매출", color: vizColor(0) }, { name: "매입", color: vizColor(1) }]} />
                    </div>
                    <div className="pnl-panel">
                      <h3>많이 팔린 품목</h3><p>기간 판매 금액 상위 10</p>
                      {sale.perProduct.size ? <BarChart data={topN(sale.perProduct)} unit="원" /> : <div className="inv-status-empty">판매가 없습니다</div>}
                    </div>
                  </div>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>바로 처리할 것</h3><p>숫자를 누르면 어떤 건인지 목록이 뜨고, 목록에서 그 화면으로 갑니다</p>
                      <ul className="inv-status-todo inv-status-todo-btn">
                        <li><button type="button" onClick={openShort}>재고 부족 <b>{stock.short}</b></button> · <button type="button" onClick={openOut}>품절 <b>{stock.out}</b></button> <span className="ev-dim">— 구매 입력에 부족분 채우기</span></li>
                        <li><button type="button" onClick={openNoVoucher}>전표 없는 판매 <b>{sale.noVoucher}건</b></button> <span className="ev-dim">— 매입매출전표 › 증빙에서 불러오기</span></li>
                        <li><button type="button" onClick={openLate}>납기 지난 주문 <b>{order.late.length}건</b></button> · <button type="button" onClick={openOpen}>열린 주문 잔량 <b>{order.open.length}건</b></button></li>
                        <li><button type="button" onClick={openMatShort}>자재 부족 <b>{make.shortage.length}품목</b></button>{make.noBom ? <span className="ev-dim"> · 자재구성 없는 주문 줄 {make.noBom}({make.noBomNames.slice(0, 3).join(", ")}{make.noBomNames.length > 3 ? " …" : ""})</span> : null}</li>
                      </ul>
                    </div>
                    <div className="pnl-panel">
                      <h3>채널 비중</h3><p>판매 금액 — 채널 주문 기록에 매인 전표는 그 채널, 나머지는 직접</p>
                      {sale.perChannel.size ? (
                        <DonutChart unit="원" total={`₩${wonShort(sale.amt)}`}
                          data={[...sale.perChannel.entries()].sort((a, b) => b[1] - a[1]).map(([ch, v], i) => ({ label: ch === "direct" ? "직접" : channelLabel(ch), value: Math.max(0, v), color: vizColor(i) }))} />
                      ) : <div className="inv-status-empty">판매가 없습니다</div>}
                    </div>
                  </div>
                </>)}

                {tab === "order" && (<>
                  <div className="pnl-panel">
                    <h3>일별 주문 금액</h3><p>주문서 공급가액 합</p>
                    <ColumnChart height={180} unit="원" data={series(order.perDay)} />
                  </div>
                  <div className="pnl-panel">
                    <h3>주문별 진행</h3><p>납기 지난 것이 위 · 잔량 = 주문 − 판매·구매·생산이 가져간 수량</p>
                    <div className="stg-table-wrap">
                      <table className="ev-table ev-lined table-inv-status">
                        <thead><tr><th>번호</th><th>주문일</th><th>거래처</th><th>납기</th><th>D-day</th><th>주문 수량</th><th>가져간 수량</th><th>잔량</th><th>진행률</th><th>금액</th><th>상태</th></tr></thead>
                        <tbody>
                          {order.rows.map((r) => (
                            <tr key={r.o.id} className={r.late ? "inv-row-fix" : undefined}>
                              <td className="mono-number text-left"><b>{r.o.order_no}</b></td>
                              <td className="mono-number">{r.o.order_date}</td>
                              <td className="text-left">{r.o.partner_name || partnerName.get(r.o.partner_id || "") || "—"}</td>
                              <td className="mono-number">{r.o.due_date || "—"}</td>
                              <td className="mono-number tc">{r.dday == null ? "—" : r.dday < 0 ? `D+${-r.dday}` : `D-${r.dday}`}</td>
                              <td className="tr mono-number">{won(r.ordered)}</td>
                              <td className="tr mono-number">{won(r.used)}</td>
                              <td className="tr mono-number">{won(r.remain)}</td>
                              <td className="tc"><span className="inv-status-bar"><i style={{ width: `${r.pct}%` }} /></span> {r.pct}%</td>
                              <td className="tr mono-number">₩{won(r.amt)}</td>
                              <td className="tc"><span className={r.o.status === "cancelled" ? "inv-pill inv-pill-danger" : r.remain <= 0 ? "inv-pill inv-pill-ok" : r.late ? "inv-pill inv-pill-danger" : "inv-pill inv-pill-warn"}>
                                {r.o.status === "cancelled" ? "취소" : r.remain <= 0 ? "완료" : r.late ? "납기 지남" : "진행 중"}</span></td>
                            </tr>
                          ))}
                          {order.rows.length === 0 && <tr><td colSpan={11} className="tc ev-dim">이 기간에 주문서가 없습니다</td></tr>}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </>)}

                {tab === "sale" && (<>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>일별 매출</h3><p>반품을 뺀 순액</p>
                      <LineChart height={180} unit="원" yFmt={wonShort} series={[{ name: "매출", points: series(sale.perDay) }]} />
                    </div>
                    <div className="pnl-panel">
                      <h3>채널 비중</h3><p>직접 = 채널 주문 기록이 없는 판매</p>
                      {sale.perChannel.size ? (
                        <DonutChart unit="원" total={`₩${wonShort(sale.amt)}`}
                          data={[...sale.perChannel.entries()].sort((a, b) => b[1] - a[1]).map(([ch, v], i) => ({ label: ch === "direct" ? "직접" : channelLabel(ch), value: Math.max(0, v), color: vizColor(i) }))} />
                      ) : <div className="inv-status-empty">판매가 없습니다</div>}
                    </div>
                  </div>
                  <div className="pnl-panel">
                    <h3>집계</h3>
                    <div className="collect-tabs inv-status-sub">
                      {([["product", "품목별"], ["partner", "거래처별"], ["channel", "채널별"]] as const).map(([k, l]) => (
                        <button key={k} type="button" onClick={() => setSaleView(k)} className={saleView === k ? "collect-tab collect-tab-on" : "collect-tab"}>{l}</button>
                      ))}
                    </div>
                    <div className="stg-table-wrap">
                      <table className="ev-table ev-lined table-inv-status">
                        {saleView === "product" ? (<>
                          <thead><tr><th>SKU</th><th>품목</th><th>수량</th><th>매출</th><th>원가</th><th>마진</th><th>마진율</th></tr></thead>
                          <tbody>{perProductRows(sale.perProduct).map((r) => {
                            const c = costOf(r.key); const cost = c == null ? null : c * r.qty; const mg = cost == null ? null : r.amt - cost;
                            return (<tr key={r.key}>
                              <td className="mono-number text-left">{r.p?.sku || "—"}</td><td className="text-left"><b>{r.p?.name || "?"}</b></td>
                              <td className="tr mono-number">{won(r.qty)}</td><td className="tr mono-number">₩{won(r.amt)}</td>
                              <td className="tr mono-number ev-dim">{cost == null ? "—" : `₩${won(cost)}`}</td>
                              <td className="tr mono-number">{mg == null ? "—" : `₩${won(mg)}`}</td>
                              <td className="tr mono-number">{mg == null || !r.amt ? "—" : `${Math.round(mg / r.amt * 100)}%`}</td>
                            </tr>);
                          })}</tbody>
                        </>) : saleView === "partner" ? (<>
                          <thead><tr><th>거래처</th><th>매출</th><th>비중</th></tr></thead>
                          <tbody>{perPartnerRows(sale.perPartner).map((r) => (
                            <tr key={r.key}><td className="text-left"><b>{r.label}</b></td><td className="tr mono-number">₩{won(r.amt)}</td>
                              <td className="tr mono-number">{sale.amt ? `${Math.round(r.amt / sale.amt * 100)}%` : "—"}</td></tr>
                          ))}</tbody>
                        </>) : (<>
                          <thead><tr><th>채널</th><th>매출</th><th>비중</th></tr></thead>
                          <tbody>{[...sale.perChannel.entries()].sort((a, b) => b[1] - a[1]).map(([ch, v]) => (
                            <tr key={ch}><td className="text-left"><b>{ch === "direct" ? "직접" : channelLabel(ch)}</b></td><td className="tr mono-number">₩{won(v)}</td>
                              <td className="tr mono-number">{sale.amt ? `${Math.round(v / sale.amt * 100)}%` : "—"}</td></tr>
                          ))}</tbody>
                        </>)}
                      </table>
                    </div>
                  </div>
                </>)}

                {tab === "buy" && (<>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>일별 매입</h3><p>반품을 뺀 순액</p>
                      <LineChart height={180} unit="원" yFmt={wonShort} colors={[vizColor(1)]} series={[{ name: "매입", points: series(buy.perDay) }]} />
                    </div>
                    <div className="pnl-panel">
                      <h3>거래처 비중</h3><p>기간 매입 금액</p>
                      {buy.perPartner.size ? (
                        <DonutChart unit="원" total={`₩${wonShort(buy.amt)}`}
                          data={perPartnerRows(buy.perPartner).slice(0, 8).map((r, i) => ({ label: r.label, value: Math.max(0, r.amt), color: vizColor(i) }))} />
                      ) : <div className="inv-status-empty">매입이 없습니다</div>}
                    </div>
                  </div>
                  <div className="pnl-panel">
                    <h3>집계</h3>
                    <div className="collect-tabs inv-status-sub">
                      {([["partner", "거래처별"], ["product", "품목별"]] as const).map(([k, l]) => (
                        <button key={k} type="button" onClick={() => setBuyView(k)} className={buyView === k ? "collect-tab collect-tab-on" : "collect-tab"}>{l}</button>
                      ))}
                    </div>
                    <div className="stg-table-wrap">
                      <table className="ev-table ev-lined table-inv-status">
                        {buyView === "partner" ? (<>
                          <thead><tr><th>거래처</th><th>매입</th><th>비중</th></tr></thead>
                          <tbody>{perPartnerRows(buy.perPartner).map((r) => (
                            <tr key={r.key}><td className="text-left"><b>{r.label}</b></td><td className="tr mono-number">₩{won(r.amt)}</td>
                              <td className="tr mono-number">{buy.amt ? `${Math.round(r.amt / buy.amt * 100)}%` : "—"}</td></tr>
                          ))}</tbody>
                        </>) : (<>
                          <thead><tr><th>SKU</th><th>품목</th><th>수량</th><th>매입</th><th>평균 단가</th><th>현재고</th></tr></thead>
                          <tbody>{perProductRows(buy.perProduct).map((r) => (
                            <tr key={r.key}>
                              <td className="mono-number text-left">{r.p?.sku || "—"}</td><td className="text-left"><b>{r.p?.name || "?"}</b></td>
                              <td className="tr mono-number">{won(r.qty)}</td><td className="tr mono-number">₩{won(r.amt)}</td>
                              <td className="tr mono-number ev-dim">{r.qty ? `₩${won(r.amt / r.qty)}` : "—"}</td>
                              <td className="tr mono-number">{won(stock.byProduct.get(r.key) || 0)}</td>
                            </tr>
                          ))}</tbody>
                        </>)}
                      </table>
                    </div>
                  </div>
                </>)}

                {tab === "make" && (<>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>일별 완성 수량</h3><p>완제품 입고 수량</p>
                      <ColumnChart height={180} unit="개" data={series(make.perDay)} />
                    </div>
                    <div className="pnl-panel">
                      <h3>자재 부족</h3><p>열린 주문 잔량 × 자재구성 − 현재고{make.noBom ? <> · <span title={`자재구성 없음: ${make.noBomNames.join(", ")}`}>자재구성 없는 주문 줄 {make.noBom}개는 셈에서 빠짐</span> — {make.noBomNames.slice(0, 5).join(", ")}{make.noBomNames.length > 5 ? ` 외 ${make.noBomNames.length - 5}` : ""} (<Link href="/inventory/products" className="bz-link">품목에서 자재구성</Link>)</> : null}</p>
                      {make.shortage.length ? (
                        <table className="ev-table ev-lined table-inv-status-sm">
                          <thead><tr><th>자재</th><th>필요</th><th>현재고</th><th>부족</th></tr></thead>
                          <tbody>{make.shortage.map((x) => (
                            <tr key={x.product_id} className="inv-row-fix"><td className="text-left"><b>{productById.get(x.product_id)?.name || "?"}</b></td>
                              <td className="tr mono-number">{won(x.need)}</td><td className="tr mono-number">{won(x.have)}</td><td className="tr mono-number">{won(x.need - x.have)}</td></tr>
                          ))}</tbody>
                        </table>
                      ) : <div className="inv-status-empty">부족한 자재가 없습니다</div>}
                    </div>
                  </div>
                  <div className="pnl-grid2">
                    <div className="pnl-panel">
                      <h3>완제품별 수율</h3><p>양품률 = 양품 ÷ (양품+불량) · {Math.round(YIELD_WARN * 1000) / 10}% 미만은 붉게(생산 › 도구 › 수율 임계값){make.defectQty === 0 && make.doneQty > 0 ? " · 이 기간엔 불량 기록이 없습니다" : ""}</p>
                      <table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>완제품</th><th>양품</th><th>불량</th><th>양품률</th><th>완성 금액</th></tr></thead>
                        <tbody>{[...make.perProduct.entries()].sort((a, b) => (b[1].qty + b[1].defect) - (a[1].qty + a[1].defect)).map(([id, r]) => {
                          const y = r.qty + r.defect > 0 ? r.qty / (r.qty + r.defect) : null;
                          return (
                            <tr key={id} className={y != null && y < YIELD_WARN ? "inv-row-fix" : undefined}><td className="text-left"><b>{productById.get(id)?.name || "?"}</b></td>
                              <td className="tr mono-number">{won(r.qty)}</td><td className="tr mono-number">{won(r.defect)}</td><td className="tr mono-number">{y == null ? "—" : `${(y * 100).toFixed(1)}%`}</td><td className="tr mono-number">₩{won(r.amt)}</td></tr>
                          );
                        })}{make.perProduct.size === 0 && <tr><td colSpan={5} className="tc ev-dim">완성 기록이 없습니다</td></tr>}</tbody>
                      </table>
                    </div>
                    <div className="pnl-panel">
                      <h3>자재 투입 · 로스</h3><p>로스 = 실투입 − 표준(자재구성) · 금액은 이동평균{make.lossRecords === 0 && make.matPer.size > 0 ? " · 이 기간엔 로스 기록이 없습니다(표준=실투입으로 봄)" : ""}{make.lossReasonSum.size ? ` · 원인별 로스비 ${[...make.lossReasonSum.entries()].map(([k, v]) => `${lossReasonLabel(k) || "기타"} ₩${won(v)}`).join(", ")}` : ""}</p>
                      <table className="ev-table ev-lined table-inv-status-sm">
                        <thead><tr><th>자재</th><th>표준</th><th>실투입</th><th>로스</th><th>로스율</th><th>금액</th></tr></thead>
                        <tbody>{[...make.matPer.entries()].sort((a, b) => b[1].loss - a[1].loss).map(([id, r]) => {
                          const rate = r.std > 0 ? r.loss / r.std : null;
                          return (
                            <tr key={id} className={rate != null && rate > LOSS_WARN ? "inv-row-fix" : undefined}><td className="text-left"><b>{productById.get(id)?.name || "?"}</b></td>
                              <td className="tr mono-number">{won(r.std)}</td><td className="tr mono-number">{won(r.qty)}</td>
                              <td className={`tr mono-number${r.loss > 0 ? " inv-diff-minus" : r.loss < 0 ? " inv-diff-plus" : ""}`}>{r.loss === 0 ? "—" : `${r.loss > 0 ? "+" : ""}${won(r.loss)}`}</td>
                              <td className="tr mono-number">{rate == null ? "—" : `${(rate * 100).toFixed(1)}%`}</td><td className="tr mono-number">₩{won(r.amt)}</td></tr>
                          );
                        })}{make.matPer.size === 0 && <tr><td colSpan={6} className="tc ev-dim">투입 기록이 없습니다</td></tr>}</tbody>
                      </table>
                    </div>
                  </div>
                </>)}
                <p className="inv-foot">창고 {warehouses.length}곳 · {whName.size ? [...whName.values()].join(" · ") : "—"} · 품목 {products.length}종 · 원가 있는 품목 {stock.priced}종</p>
              </>
            )}
          </div>
        </QueryBody>
      </QueryScreen>
      {detail && (
        <div className="inv-modal" onClick={() => setDetail(null)}>
          <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3 className="inv-modal-title">{detail.title}</h3>
            {detail.desc && <p className="inv-modal-desc">{detail.desc}</p>}
            <div className="stg-table-wrap ch-ship-list">
              <table className="ev-table ev-lined table-inv-status-sm">
                <thead><tr>{detail.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
                <tbody>{detail.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j === 0 ? "text-left" : typeof c === "string" && /[0-9]/.test(c) ? "tr mono-number" : "tc"}>{c}</td>)}</tr>)}
                  {detail.rows.length === 0 && <tr><td colSpan={detail.head.length} className="tc ev-dim">없습니다</td></tr>}</tbody>
              </table>
            </div>
            <div className="inv-modal-actions">
              {detail.go && <Link href={detail.go.href} className="bz-link">{detail.go.label}</Link>}
              <span className="doc-sums-sp" />
              <button type="button" className="btn-secondary btn-sm" onClick={() => setDetail(null)}>닫기</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
