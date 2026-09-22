"use client";

// ── 재고 › 창고관리 (2026-08-25 재고 1단계) ─────────────────────────────────────────
//   "이거 지금 몇 개 있어?" 한 가지를 위한 화면. 그래서 첫 줄이 목록이 아니라 **신호**다.
//   ★ 결정 3 — 수량을 저장하지 않는다. v_stock_onhand(움직인 기록의 합)를 읽는다.
//   ★ 결정 5 — 주문·발주 없이도 입·출고가 선다. 여기서 바로 넣는 것이 그것이다.
//   ★ 결정 7 — 음수는 에러가 아니라 '아직 안 맞춘 것'. 막지 않고 '맞춰야 할 것'으로 세운다.
//   ★ 결정 8 — 지우지 않고 부호로 남긴다. 수량 칸에 음수를 넣을 수 있고, 화면이 뜻을 되읽어 준다.

import { SimpleCond, SimpleApplied, condHit, type CondLive } from "../_components/simple-cond";
import { exportToExcel } from "@/lib/excel-export";
import { xBool, type ExcelColumn } from "@/lib/excel-io";
import { ExcelUploadDialog } from "../_components/excel-upload";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { fetchPaged } from "@/lib/fetch-paged";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import { todayKst } from "@/lib/kst";
import { DateField } from "@/components/date-field";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, ChipGroup,
  Pager, usePager, QuickSearch, quickSearchHit, ExcelMenu, defaultRange } from "@/components/query-kit";
import { DateRangeField } from "@/components/date-range-field";
import { fetchOutflowStats, fetchLastOutAll } from "@/lib/inventory-suggest";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { useStockCount, CountBar, CountBody, NewCountDialog, CountPasteDialog } from "../_components/count";
import {
  listProducts, listOnHand, listWarehouses, listMoves, listAvgCost, createStockDoc, type OnHand,
  ensureDefaultWarehouse, upsertWarehouse, STOCK_REASONS, reasonOf, reasonLabel,
  type Product, type Warehouse, type StockReason,
} from "@/lib/inventory";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
type Tab = "onhand" | "moves" | "count" | "warehouse" | "summary";
type Signal = "all" | "low" | "zero" | "fix";
type StockKey = "sku" | "name" | "spec" | "wh" | "qty" | "avg" | "safety" | "state" | "expiry";
//   유통기한 D-n — 오늘(KST) 기준. 지난 것은 음수
const daysLeft = (d: string) => Math.floor((new Date(d + "T00:00:00").getTime() - new Date(todayKst() + "T00:00:00").getTime()) / 86400000);
//   수불부(2026-09-22 재고 점검 A) — 기간 기초·매입·판매·생산·투입·조정·이동·기말. '집계'(판매·매입 합계)가 있던 자리를 이어받는다.
type SumView = "ledger" | "partner" | "month";
//   현재고 보기 칩(2026-09-22 재고 점검 D) — 수량(창고별 줄) / 체류·회전(품목별: 마지막 출고·체류일·일평균 출고·회전일수·재고 금액)
type StockView = "qty" | "aging";
type AgingKey = "sku" | "name" | "qty" | "lastOut" | "stay" | "perDay" | "turn" | "value";
type AgingRow = { product_id: string; sku: string; name: string; qty: number; lastOut: string | null; stay: number | null; perDay: number; turn: number | null; value: number; locked: boolean };
type LedgerRow = {
  product_id: string; sku: string; name: string; unit: string;
  opening: number; buy: number; sale: number; produce: number; consume: number; adjust: number; move: number; closing: number;
  buyAmt: number; saleAmt: number;
};
//   움직임 한 줄이 수불부 어느 칸인가 — 부호는 저장된 그대로(판매 −, 매입 +, 반품은 반대)
const ledgerCol = (reason: string): keyof Pick<LedgerRow, "buy" | "sale" | "produce" | "consume" | "adjust" | "move"> => {
  if (reason === "purchase" || reason === "return_out") return "buy";
  if (reason === "sale" || reason === "return_in") return "sale";
  if (reason === "produce") return "produce";
  if (reason === "consume") return "consume";
  if (reason === "move") return "move";
  return "adjust";   // opening · count · fix · sample · gift · disposal
};
type MoveKey = "date" | "doc" | "reason" | "sku" | "name" | "wh" | "qty" | "price" | "amount";
//   상태 정렬은 처리할 것이 위 (CLAUDE.md: 대기→승인→반려→취소와 같은 원칙)
const STATE_RANK: Record<Signal, number> = { fix: 0, zero: 1, low: 2, all: 3 };

const WAREHOUSE_XCOLS: ExcelColumn[] = [
  { key: "name", label: "창고명", required: true, hint: "같은 이름이 있으면 그 창고를 고칩니다", example: "물류센터" },
  { key: "code", label: "코드", hint: "짧은 코드(선택). DEFECT 는 불량 보류 전용이라 쓸 수 없습니다", example: "LC" },
  { key: "is_default", label: "기본창고", kind: "bool", hint: "예로 하면 입력 화면의 기본 창고", example: "아니오" },
];

const STOCK_CONDS = (c: { low: number; zero: number; fix: number }) => [{
  key: "state", label: "상태", hint: "여러 개 고르면 그중 하나라도", options: [
    { value: "low", label: `부족 ${c.low}` }, { value: "zero", label: `품절 ${c.zero}` },
    { value: "fix", label: `맞춰야 할 것 ${c.fix}`, title: "장부가 실물을 못 따라간 줄(음수). 지우지 않고 맞춥니다" },
  ],
}];

export default function StockPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { setCompanyId(u?.company_id ?? null); setUserId(u?.id ?? null); }); }, []);

  const [tab, setTab] = useState<Tab>("onhand");
  const [q, setQ] = useState("");
  //   값 필터는 검색조건 패널에서(조회 화면 표준). 조회 줄엔 칩을 늘어놓지 않는다
  const [cond, setCond] = useState<CondLive>({});
  const [sort, setSort] = useState<SortState<StockKey>>({ key: "state", dir: "asc" });
  const [stockView, setStockView] = useState<StockView>("qty");
  const [agingSort, setAgingSort] = useState<SortState<AgingKey>>({ key: "stay", dir: "desc" });
  const [mSort, setMSort] = useState<SortState<MoveKey>>({ key: "date", dir: "desc" });
  const [sumView, setSumView] = useState<SumView>("ledger");
  const [ledgerWh, setLedgerWh] = useState("");            // 수불부 창고(빈 값 = 전체)
  const [ledgerOpen, setLedgerOpen] = useState<LedgerRow | null>(null);   // 줄 클릭 → 그 품목의 기간 움직임
  const [from, setFrom] = useState(() => defaultRange().from);   // 최근 1개월(KST 기준) — 공용 기본값 (2026-09-03)
  const [to, setTo] = useState(todayKst);
  const [docOpen, setDocOpen] = useState(false);
  const [whOpen, setWhOpen] = useState<Warehouse | null>(null);
  const [openingOpen, setOpeningOpen] = useState(false);
  const [whXls, setWhXls] = useState(false);

  //   재고를 '움직일' 권한 — 없으면 보기만 (창고 담당이 아닌 사람이 수량을 바꾸면 안 된다)
  const canMove = isMaster || hasPerm("/inventory/stock:adjust");

  const { data: products = [] } = useQuery({ queryKey: ["inv-products", companyId], queryFn: () => listProducts(companyId!), enabled: !!companyId });
  const { data: warehouses = [] } = useQuery({ queryKey: ["inv-warehouses", companyId], queryFn: () => listWarehouses(companyId!), enabled: !!companyId });
  const { data: onhand = [] } = useQuery({ queryKey: ["inv-onhand", companyId], queryFn: () => listOnHand(companyId!), enabled: !!companyId });
  //   체류·회전 재료 — 90일 출고 통계(일평균)와 전 기간 마지막 출고일. 보기 칩을 켤 때만 읽는다
  const { data: outflow } = useQuery({ queryKey: ["inv-outflow", companyId], queryFn: () => fetchOutflowStats(companyId!), enabled: !!companyId && tab === "onhand" && stockView === "aging", staleTime: 60_000 });
  const { data: lastOutAll, isLoading: agingLoading } = useQuery({ queryKey: ["inv-lastout", companyId], queryFn: () => fetchLastOutAll(companyId!), enabled: !!companyId && tab === "onhand" && stockView === "aging", staleTime: 60_000 });
  //   유통기한(2026-09-21) — 남아 있는 입고분(층, qty_left>0) 중 가장 이른 날. 층이 입고 줄(stock_moves.expiry_date)을 가리킨다.
  //   적은 회사가 없으면 열 자체가 없다(유통기한 없는 업종은 화면 그대로).
  const { data: expiryByProduct = new Map<string, { date: string; lot: string | null }>() } = useQuery({
    queryKey: ["inv-expiry", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const { data } = await (supabase as any).from("stock_cost_layers").select("product_id, qty_left, stock_moves!inner(lot_no, expiry_date)")
        .eq("company_id", companyId).gt("qty_left", 0).not("stock_moves.expiry_date", "is", null);
      const m = new Map<string, { date: string; lot: string | null }>();
      for (const r of (data || []) as any[]) {
        const d = String(r.stock_moves?.expiry_date || ""); if (!d) continue;
        const cur = m.get(r.product_id);
        if (!cur || d < cur.date) m.set(r.product_id, { date: d, lot: r.stock_moves?.lot_no || null });
      }
      return m;
    },
  });
  const hasExpiry = expiryByProduct.size > 0;
  const { data: moves = [] } = useQuery({
    queryKey: ["inv-moves", companyId, from, to],
    queryFn: () => listMoves(companyId!, from, to),
    enabled: !!companyId && (tab === "moves" || tab === "summary"),
  });
  //   수불부 — 기초가 필요해 기간 시작 전 것까지 읽는다(취소 전표 제외는 listMoves 가 한다)
  const { data: ledgerMoves = [], isLoading: ledgerLoading } = useQuery({
    queryKey: ["inv-ledger-moves", companyId, to],
    queryFn: () => listMoves(companyId!, "2000-01-01", to),
    enabled: !!companyId && tab === "summary" && sumView === "ledger",
  });
  //   이동평균 원가(결정 27). 재고금액은 이것으로, 없으면 품목 매입가로
  const  { data: avgCost = new Map<string, number>() } = useQuery({ queryKey: ["inv-avgcost", companyId], queryFn: () => listAvgCost(companyId!), enabled: !!companyId });
  const { data: partners = [] } = useQuery({
    queryKey: ["inv-partners", companyId],
    queryFn: async () => {
      const data = await fetchPaged<any>("inv-partners", () => supabase.from("partners").select("id, name").eq("company_id", companyId!).order("name"), 50000);
      return ((data || []) as any[]).map((p) => ({ id: p.id as string, name: p.name as string }));
    },
    enabled: !!companyId && tab === "summary",
  });

  const productById = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const whById = useMemo(() => new Map(warehouses.map((w) => [w.id, w])), [warehouses]);

  //   실사 — 상태가 여러 곳(조회 줄·표·팝업)에 걸려 훅 하나로 모은다. 훅은 조기 return 앞이어야 한다.
  const count = useStockCount(companyId, userId, canMove, productById);

  //   현재고 줄 — 품목 × 창고. 수량을 세지 않는 품목은 애초에 나오지 않는다(결정 6-④).
  const rows = useMemo(() => {
    const out = onhand
      .map((r) => ({ ...r, product: productById.get(r.product_id), wh: whById.get(r.warehouse_id) }))
      .filter((r) => r.product && r.product.track_stock);
    return out.map((r) => {
      const safety = r.product!.safety_stock;
      const state: Signal = r.qty < 0 ? "fix" : r.qty === 0 ? "zero"
        : (safety != null && r.qty <= Number(safety)) ? "low" : "all";
      return { ...r, state, expiry: expiryByProduct.get(r.product_id) || null };
    });
  }, [onhand, productById, whById, expiryByProduct]);

  const shown = useMemo(() => rows.filter((r) =>
    condHit(cond, "state", r.state) &&
    quickSearchHit(q, [r.product?.sku, r.product?.name, r.product?.spec, r.wh?.name])
  ), [rows, cond, q]);

  const sorted = useMemo(() => {
    const d = sort.dir === "asc" ? 1 : -1;
    const val = (r: (typeof shown)[number]) => {
      switch (sort.key) {
        case "sku": return r.product?.sku || "";
        case "name": return r.product?.name || "";
        case "spec": return r.product?.spec || "";
        case "wh": return r.wh?.name || "";
        case "qty": return r.qty;
        case "avg": return avgCost.get(r.product_id) ?? Number(r.product?.cost_price || 0);
        case "safety": return r.product?.safety_stock == null ? -Infinity : Number(r.product.safety_stock);
        case "expiry": return r.expiry?.date || "9999-12-31";
        default: return STATE_RANK[r.state];
      }
    };
    return [...shown].sort((a, b) => cmp(val(a), val(b)) * d);
  }, [shown, sort, avgCost]);
  const onSort = (k: string) => setSort((s) => nextSort(s, k as StockKey));
  const pager = usePager(sorted, 50, `${q}|${JSON.stringify(cond)}|${sort.key}${sort.dir}`);
  //   체류·회전 줄 — 품목 하나에 한 줄(창고 합). 체류일 = 오늘 − 마지막 출고일(출고가 한 번도 없으면 null → '출고 없음'),
  //   회전일수 = 현재고 ÷ 최근 30일 일평균 출고(0 이면 null). 잠김 = 재고가 있는데 90일 넘게 안 나감(현황 '90일 무출고'와 같은 기준).
  const agingRows = useMemo((): AgingRow[] => {
    const today = todayKst();
    const byProduct = new Map<string, number>();
    for (const r of rows) byProduct.set(r.product_id, (byProduct.get(r.product_id) || 0) + r.qty);
    const out: AgingRow[] = [];
    for (const [pid, qty] of byProduct) {
      const p = productById.get(pid); if (!p) continue;
      if (!quickSearchHit(q, [p.sku, p.name, p.spec])) continue;
      const lastOut = lastOutAll?.get(pid) ?? null;
      const stay = lastOut ? Math.max(0, Math.floor((new Date(today + "T00:00:00").getTime() - new Date(lastOut + "T00:00:00").getTime()) / 86400000)) : null;
      const perDay = outflow?.get(pid)?.perDay ?? 0;
      const cost = avgCost.get(pid) ?? Number(p.cost_price || 0);
      out.push({ product_id: pid, sku: p.sku, name: p.name, qty, lastOut, stay, perDay, turn: perDay > 0 ? qty / perDay : null, value: qty > 0 ? qty * cost : 0, locked: qty > 0 && (stay == null || stay >= 90) });
    }
    const d = agingSort.dir === "asc" ? 1 : -1;
    const val = (r: AgingRow) => {
      switch (agingSort.key) {
        case "sku": return r.sku; case "name": return r.name; case "qty": return r.qty;
        case "lastOut": return r.lastOut || "0000-00-00"; case "stay": return r.stay == null ? 99999 : r.stay;
        case "perDay": return r.perDay; case "turn": return r.turn == null ? 99999 : r.turn; default: return r.value;
      }
    };
    return out.sort((a, b) => cmp(val(a), val(b)) * d);
  }, [rows, productById, q, lastOutAll, outflow, avgCost, agingSort]);
  const agingPager = usePager(agingRows, 50, `${q}|${agingSort.key}${agingSort.dir}`);
  const agingTotals = useMemo(() => ({ locked: agingRows.filter((r) => r.locked).length, lockedValue: agingRows.filter((r) => r.locked).reduce((s, r) => s + r.value, 0), value: agingRows.reduce((s, r) => s + r.value, 0) }), [agingRows]);
  const onAgingSort = (k: string) => setAgingSort((s) => nextSort(s, k as AgingKey));

  const counts = useMemo(() => ({
    low: rows.filter((r) => r.state === "low").length,
    zero: rows.filter((r) => r.state === "zero").length,
    fix: rows.filter((r) => r.state === "fix").length,
    expiring: rows.filter((r) => r.expiry && daysLeft(r.expiry.date) <= 30).length,
    value: rows.reduce((n, r) => n + r.qty * (avgCost.get(r.product_id) ?? Number(r.product?.cost_price || 0)), 0),
  }), [rows, avgCost]);

  const sortedMoves = useMemo(() => {
    const d = mSort.dir === "asc" ? 1 : -1;
    const val = (m: (typeof moves)[number]) => {
      const p = productById.get(m.product_id);
      switch (mSort.key) {
        case "doc": return m.doc?.doc_no || "";
        case "reason": return reasonLabel(m.doc?.reason || "");
        case "sku": return p?.sku || "";
        case "name": return p?.name || "";
        case "wh": return whById.get(m.warehouse_id)?.name || "";
        case "qty": return m.qty;
        case "price": return m.unit_price ?? -Infinity;
        case "amount": return m.amount ?? -Infinity;
        default: return m.moved_at;
      }
    };
    return [...moves].sort((a, b) => cmp(val(a), val(b)) * d);
  }, [moves, mSort, productById, whById]);
  const onMSort = (k: string) => setMSort((s) => nextSort(s, k as MoveKey));
  const movePager = usePager(sortedMoves, 50, `${from}|${to}|${mSort.key}${mSort.dir}`);
  //   수불부 줄 — 품목마다 기초(기간 전 누계) + 기간 안 칸별 합 = 기말. 창고를 고르면 그 창고 줄만(이동은 창고별로 ±가 남고, 전체면 0).
  const ledger = useMemo(() => {
    const acc = new Map<string, LedgerRow>();
    const rowOf = (pid: string) => {
      let r = acc.get(pid);
      if (!r) { const p = productById.get(pid); r = { product_id: pid, sku: p?.sku || "", name: p?.name || "?", unit: p?.unit || "", opening: 0, buy: 0, sale: 0, produce: 0, consume: 0, adjust: 0, move: 0, closing: 0, buyAmt: 0, saleAmt: 0 }; acc.set(pid, r); }
      return r;
    };
    for (const m of ledgerMoves) {
      if (ledgerWh && m.warehouse_id !== ledgerWh) continue;
      const r = rowOf(m.product_id);
      const q = Number(m.qty || 0);
      if (m.moved_at.slice(0, 10) < from) { r.opening += q; continue; }
      const col = ledgerCol(m.doc?.reason || "");
      r[col] += q;
      if (col === "buy") r.buyAmt += Math.abs(Number(m.amount || 0)) * (q >= 0 ? 1 : -1);
      if (col === "sale") r.saleAmt += Math.abs(Number(m.amount || 0)) * (q <= 0 ? 1 : -1);
    }
    const rows = [...acc.values()].map((r) => ({ ...r, closing: r.opening + r.buy + r.sale + r.produce + r.consume + r.adjust + r.move }))
      .filter((r) => r.opening || r.buy || r.sale || r.produce || r.consume || r.adjust || r.move)
      .sort((a, b) => a.sku.localeCompare(b.sku, "ko") || a.name.localeCompare(b.name, "ko"));
    const sum = (k: keyof LedgerRow) => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
    return { rows, saleAmt: sum("saleAmt"), buyAmt: sum("buyAmt"), opening: sum("opening"), closing: sum("closing") };
  }, [ledgerMoves, ledgerWh, from, productById]);
  const ledgerDetail = useMemo(() => {
    if (!ledgerOpen) return [];
    let bal = ledgerOpen.opening;
    return ledgerMoves.filter((m) => m.product_id === ledgerOpen.product_id && (!ledgerWh || m.warehouse_id === ledgerWh) && m.moved_at.slice(0, 10) >= from)
      .sort((a, b) => a.moved_at.localeCompare(b.moved_at) || a.id.localeCompare(b.id))
      .map((m) => { bal += Number(m.qty || 0); return { ...m, bal }; });
  }, [ledgerOpen, ledgerMoves, ledgerWh, from]);
  const exportLedger = () => exportToExcel(ledger.rows.map((r) => ({
    "SKU": r.sku, "품목": r.name, "단위": r.unit, "기초": r.opening, "매입": r.buy, "판매": -r.sale, "생산 완성": r.produce, "자재 투입": -r.consume, "조정·기타": r.adjust, "창고 이동": r.move, "기말": r.closing, "매입 금액": Math.round(r.buyAmt), "판매 금액": Math.round(r.saleAmt),
  })), "수불부", `수불부_${ledgerWh ? (whById.get(ledgerWh)?.name || "창고") + "_" : ""}${from}_${to}`);

  //   집계 — 판매·매입 전표만. 판매는 음수로 쌓여 있어 절대값으로 센다.
  const summary = useMemo(() => {
    const partnerName = new Map(partners.map((p) => [p.id, p.name]));
    const acc = new Map<string, { key: string; label: string; sub?: string; saleQty: number; saleAmt: number; buyQty: number; buyAmt: number }>();
    let saleTotal = 0, buyTotal = 0;
    for (const m of moves) {
      if (sumView === "ledger") break;
      const reason = m.doc?.reason;
      if (reason !== "sale" && reason !== "purchase") continue;
      const key = sumView === "partner" ? (m.doc?.partner_id || "-") : m.moved_at.slice(0, 7);
      const label = sumView === "partner" ? (partnerName.get(m.doc?.partner_id || "") || "거래처 없음") : m.moved_at.slice(0, 7);
      const sub: string | undefined = undefined;
      const cur = acc.get(key) || { key, label, sub, saleQty: 0, saleAmt: 0, buyQty: 0, buyAmt: 0 };
      const qty = Math.abs(m.qty) * (reason === "sale" ? (m.qty < 0 ? 1 : -1) : (m.qty > 0 ? 1 : -1));   // 반품은 빼기
      const amt = Math.abs(Number(m.amount || 0)) * (qty < 0 ? -1 : 1);
      if (reason === "sale") { cur.saleQty += qty; cur.saleAmt += amt; saleTotal += amt; }
      else { cur.buyQty += qty; cur.buyAmt += amt; buyTotal += amt; }
      acc.set(key, cur);
    }
    const rows = [...acc.values()].sort((a, b) => sumView === "month" ? a.key.localeCompare(b.key) : (b.saleAmt + b.buyAmt) - (a.saleAmt + a.buyAmt));
    return { rows, saleTotal, buyTotal };
  }, [moves, sumView, productById, partners]);

  if (!permLoading && !(isMaster || hasPerm("/inventory/stock"))) {
    return <AccessDenied detail="재고 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["inv-onhand", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-moves", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-warehouses", companyId] });
  };

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {([["onhand", "현재고"], ["moves", "움직인 이력"], ["summary", "수불부"], ["count", "실사"], ["warehouse", "창고"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k as Tab)}
                className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>
                {l}
                {k === "onhand" && counts.fix > 0 && <span className="collect-tab-cnt inv-tab-warn">맞춰야 할 것 {counts.fix}</span>}
              </button>
            ))}
          </div>

          {tab === "onhand" && (
            <>
              <QueryBar right={canMove ? (
                <>
                  {/*   2026-08-27 기획 §4 — 기초 재고 올리기는 양식·올리기와 같은 성격이라 엑셀▾ 안으로. 조회 줄은 파란 1 + 엑셀 1. */}
                  <ExcelMenu items={[
                    { label: "기초 재고 올리기", hint: "지금 있는 수량을 기초 재고로 넣습니다.", onClick: () => setOpeningOpen(true) },
                    { label: "현재고 내려받기", count: shown.length, disabled: !shown.length, onClick: () => exportToExcel(sorted.map((r) => ({ "SKU": r.product!.sku, "품목명": r.product!.name, "규격": r.product!.spec || "", "창고": r.wh?.name || "", "수량": Number(r.qty), "안전재고": r.product!.safety_stock ?? "", "유통기한": r.expiry?.date || "", "로트": r.expiry?.lot || "", "상태": r.state === "fix" ? "맞춰야 함" : r.state === "zero" ? "품절" : r.state === "low" ? "부족" : "" })), "현재고", `현재고_${todayKst()}`) },
                  ]} />
                  <button type="button" className="btn-primary btn-sm" onClick={() => setDocOpen(true)}>+ 입·출고</button>
                </>
              ) : undefined}>
                {stockView === "qty" && <SimpleCond groups={STOCK_CONDS(counts)} live={cond} onApply={setCond} />}
                <QuickSearch value={q} onApply={setQ} placeholder="품목명 · SKU · 규격 · 창고 · 쉼표로 여러 개, Enter" />
                <ChipGroup value={stockView} onChange={setStockView} options={[{ value: "qty", label: "수량" }, { value: "aging", label: "체류·회전" }]} />
                {stockView === "aging" && <ExcelMenu items={[{ label: "체류·회전 내려받기", count: agingRows.length, disabled: !agingRows.length, onClick: () => exportToExcel(agingRows.map((r) => ({ "SKU": r.sku, "품목": r.name, "현재고": r.qty, "마지막 출고일": r.lastOut || "", "체류일": r.stay ?? "", "일평균 출고(30일)": Number(r.perDay.toFixed(2)), "회전일수": r.turn == null ? "" : Math.round(r.turn), "재고 금액": Math.round(r.value), "90일+ 무출고": r.locked ? "예" : "" })), "체류·회전", `재고_체류회전_${todayKst()}`) }]} />}
              </QueryBar>
              {stockView === "qty" && <SimpleApplied groups={STOCK_CONDS(counts)} live={cond} onApply={setCond} />}
              {stockView === "aging" ? (
                <ResultStrip>
                  <Stat label="품목" value={`${won(agingRows.length)}종`} />
                  <Stat label="재고 금액" value={`₩${won(agingTotals.value)}`} />
                  <Stat label="90일+ 무출고" value={`${won(agingTotals.locked)}종 · ₩${won(agingTotals.lockedValue)}`} tone={agingTotals.locked ? "minus" : undefined} title="재고가 있는데 90일 넘게 판매·투입·폐기가 없는 품목 — 잠긴 돈" />
                </ResultStrip>
              ) : (
              <ResultStrip>
                <Stat label="줄" value={`${won(shown.length)}개`} />
                <Stat label="부족" value={`${won(counts.low)}개`} tone={counts.low > 0 ? "minus" : undefined} />
                <Stat label="품절" value={`${won(counts.zero)}개`} tone={counts.zero > 0 ? "minus" : undefined} />
                <Stat label="재고금액" value={`₩${won(counts.value)}`} />
                {hasExpiry && <Stat label="기한 임박" title="유통기한이 30일 안이거나 지난 줄 · 남아 있는 입고분 기준" value={`${won(counts.expiring)}개`} tone={counts.expiring > 0 ? "minus" : undefined} />}
              </ResultStrip>
              )}
            </>
          )}

          {tab === "moves" && (
            <>
              <QueryBar>
                <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
                <span className="text-[11px] text-[var(--text-dim)]" title="기록은 지우지 않고 반대 기록으로 되돌립니다">입고와 출고 기록이 쌓이고 현재고는 그 합입니다.</span>
              </QueryBar>
              <ResultStrip>
                <Stat label="움직임" value={`${won(moves.length)}줄`} />
                <Stat label="들어옴" value={`${won(moves.filter((m) => m.qty > 0).reduce((n, m) => n + m.qty, 0))}개`} />
                <Stat label="나감" value={`${won(Math.abs(moves.filter((m) => m.qty < 0).reduce((n, m) => n + m.qty, 0)))}개`} />
              </ResultStrip>
            </>
          )}

          {tab === "summary" && (
            <>
              <QueryBar>
                <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
                <ChipGroup value={sumView} onChange={setSumView} options={[
                  { value: "ledger", label: "품목별 수불부" }, { value: "partner", label: "거래처별" }, { value: "month", label: "월별" },
                ]} />
                {sumView === "ledger" ? (
                  <>
                    <select value={ledgerWh} onChange={(e) => setLedgerWh(e.target.value)} className="qk-input h-8 px-2 text-xs" aria-label="창고" title="창고를 고르면 그 창고의 수불만 · 전체면 창고 이동은 0">
                      <option value="">전체 창고</option>
                      {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
                    </select>
                    <span className="inv-hint" title="기초 = 기간 시작 전 누계 · 기말 = 기초 + 매입 − 판매 + 생산 − 투입 ± 조정 ± 이동 · 취소 전표 제외">기초부터 기말까지, 품목마다 한 줄. 줄을 누르면 그 기간 움직임이 열립니다.</span>
                    <span className="doc-sums-sp" />
                    <ExcelMenu items={[{ label: "수불부 내려받기", count: ledger.rows.length, disabled: !ledger.rows.length, onClick: exportLedger }]} />
                  </>
                ) : (
                  <span className="inv-hint" title="취소 전표는 빠집니다">판매·매입 전표를 모아 봅니다.</span>
                )}
              </QueryBar>
              <ResultStrip>
                {sumView === "ledger" ? (<>
                  <Stat label="품목" value={`${ledger.rows.length}개`} />
                  <Stat label="기초 수량" value={won(ledger.opening)} />
                  <Stat label="기말 수량" value={won(ledger.closing)} />
                  <Stat label="판매 금액" value={`₩${won(ledger.saleAmt)}`} />
                  <Stat label="매입 금액" value={`₩${won(ledger.buyAmt)}`} />
                </>) : (<>
                  <Stat label="판매" value={`₩${won(summary.saleTotal)}`} />
                  <Stat label="매입" value={`₩${won(summary.buyTotal)}`} />
                  <Stat label="차익" value={`₩${won(summary.saleTotal - summary.buyTotal)}`} tone={summary.saleTotal - summary.buyTotal < 0 ? "minus" : "plus"} />
                </>)}
              </ResultStrip>
            </>
          )}
          {tab === "count" && <CountBar ctl={count} warehouses={warehouses} onhand={onhand} avgCost={avgCost} productById={productById} />}

          {tab === "warehouse" && (
            <>
              <QueryBar right={canMove ? <>
                <ExcelMenu items={[
                  { label: "양식 내려받기 · 올리기", hint: "양식을 받아 채운 파일을 올립니다.", onClick: () => setWhXls(true) },
                  { label: "창고 목록 내려받기", count: warehouses.length, onClick: () => exportToExcel(warehouses.map((w) => ({ "창고명": w.name, "코드": w.code || "", "기본창고": w.is_default ? "예" : "아니오", "현재고 수량": onhand.filter((o) => o.warehouse_id === w.id).reduce((n, o) => n + Number(o.qty), 0) })), "창고", `창고_${todayKst()}`) },
                ]} />
                <WarehouseAdd companyId={companyId} onDone={invalidate} />
              </> : undefined}>
                <span className="inv-hint" title="창고가 없으면 첫 입·출고에서 본사창고가 자동으로 만들어집니다">재고는 창고마다 따로 셉니다.</span>
              </QueryBar>
              <ResultStrip>
                <Stat label="창고" value={`${won(warehouses.length)}개`} />
                <Stat label="재고 있는 품목" value={`${won(new Set(onhand.filter((r) => r.qty !== 0).map((r) => r.product_id)).size)}개`} />
                <Stat label="재고 수량" value={`${won(onhand.reduce((n, r) => n + r.qty, 0))}개`} />
              </ResultStrip>
            </>
          )}
        </QueryHead>

        <QueryBody>
          <div className="inv-scroll">
            {tab === "onhand" && stockView === "aging" && (
              agingLoading ? <div className="collect-empty">출고 이력을 세는 중…</div>
              : agingRows.length === 0 ? <div className="collect-empty">재고가 있는 품목이 없습니다.</div>
              : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-aging">
                    <thead><tr>
                      <SortableTh label="SKU" sortKey="sku" sort={agingSort} onSort={onAgingSort} />
                      <SortableTh label="품목명" sortKey="name" sort={agingSort} onSort={onAgingSort} />
                      <SortableTh label="현재고" sortKey="qty" sort={agingSort} onSort={onAgingSort} />
                      <SortableTh label="마지막 출고일" sortKey="lastOut" sort={agingSort} onSort={onAgingSort} title="판매·자재 투입·샘플·증정·폐기 중 가장 늦은 날(전 기간)" />
                      <SortableTh label="체류일" sortKey="stay" sort={agingSort} onSort={onAgingSort} title="오늘 − 마지막 출고일" />
                      <SortableTh label="일평균 출고" sortKey="perDay" sort={agingSort} onSort={onAgingSort} title="최근 30일 판매·투입 수량 ÷ 30" />
                      <SortableTh label="회전일수" sortKey="turn" sort={agingSort} onSort={onAgingSort} title="현재고 ÷ 일평균 출고 — 지금 속도면 며칠 치인가" />
                      <SortableTh label="재고 금액" sortKey="value" sort={agingSort} onSort={onAgingSort} title="현재고 × 평균단가(없으면 품목 매입가)" />
                      <th>신호</th>
                    </tr></thead>
                    <tbody>
                      {agingPager.view.map((r) => (
                        <tr key={r.product_id}>
                          <td className="mono-number text-left">{r.sku}</td>
                          <td className="text-left"><b>{r.name}</b></td>
                          <td className="tr mono-number"><b className={r.qty < 0 ? "text-[var(--danger)]" : undefined}>{won(r.qty)}</b></td>
                          <td className="tc mono-number">{r.lastOut || <span className="ev-dim">출고 없음</span>}</td>
                          <td className="tr mono-number">{r.stay == null ? <span className="ev-dim">—</span> : `${won(r.stay)}일`}</td>
                          <td className="tr mono-number">{r.perDay ? r.perDay.toFixed(1) : <span className="ev-dim">0</span>}</td>
                          <td className="tr mono-number">{r.turn == null ? <span className="ev-dim">—</span> : `${won(Math.round(r.turn))}일`}</td>
                          <td className="tr mono-number">₩{won(r.value)}</td>
                          <td className="tc">{r.locked ? <span className="inv-pill inv-pill-warn" title="재고가 있는데 90일 넘게 안 나갔습니다">90일+ 무출고</span> : r.turn != null && r.turn > 180 ? <span className="inv-pill inv-pill-ghost" title="지금 속도로 반년 넘게 팔 양">과다</span> : <span className="inv-pill inv-pill-ok">정상</span>}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
            {tab === "onhand" && stockView === "qty" && (
              rows.length === 0 ? (
                <div className="collect-empty">
                  아직 움직인 기록이 없습니다. <b>기초 재고 올리기</b>로 지금 있는 수량을 넣으세요.
                </div>
              ) : (
                <>
                  <div className="stg-table-wrap">
                    <table className="ev-table ev-lined table-inv-stock">
                      <thead><tr>
                        <SortableTh label="SKU" sortKey="sku" sort={sort} onSort={onSort} />
                        <SortableTh label="품목명" sortKey="name" sort={sort} onSort={onSort} />
                        <SortableTh label="규격" sortKey="spec" sort={sort} onSort={onSort} />
                        <SortableTh label="창고" sortKey="wh" sort={sort} onSort={onSort} />
                        <SortableTh label="현재고" sortKey="qty" sort={sort} onSort={onSort} />
                        <SortableTh label="평균단가" sortKey="avg" sort={sort} onSort={onSort} title="이동평균 · 매입·기초 입고의 (수량×단가)합 ÷ 수량합. 없으면 품목 매입가" />
                        <SortableTh label="안전재고" sortKey="safety" sort={sort} onSort={onSort} />
                        {hasExpiry && <SortableTh label="유통기한" sortKey="expiry" sort={sort} onSort={onSort} title="남아 있는 입고분 중 가장 이른 유통기한 · 구매 양식에서 로트·유통기한 칸을 켜면 적힙니다" />}
                        <SortableTh label="상태" sortKey="state" sort={sort} onSort={onSort} />
                      </tr></thead>
                      <tbody>
                        {pager.view.map((r) => (
                          <tr key={`${r.product_id}-${r.warehouse_id}`} className={r.state === "fix" ? "inv-row-fix" : undefined}>
                            <td className="mono-number text-left">{r.product?.sku}</td>
                            <td className="text-left"><b>{r.product?.name}</b></td>
                            <td className="tc ev-dim">{r.product?.spec || "—"}</td>
                            <td className="tc">{r.wh?.name || "—"}</td>
                            <td className="tr mono-number"><b className={r.qty < 0 ? "text-[var(--danger)]" : undefined}>{won(r.qty)}</b></td>
                            <td className="tr mono-number ev-dim">{avgCost.has(r.product_id) ? won(avgCost.get(r.product_id)!) : r.product?.cost_price != null ? <span title="아직 매입 기록이 없어 품목 매입가">{won(Number(r.product.cost_price))}</span> : "—"}</td>
                            <td className="tr mono-number ev-dim">{r.product?.safety_stock != null ? won(Number(r.product.safety_stock)) : "—"}</td>
                            {hasExpiry && <td className="tc">{r.expiry ? (() => { const n = daysLeft(r.expiry!.date); return (
                              <span title={r.expiry!.lot ? `로트 ${r.expiry!.lot}` : undefined}>
                                <span className="mono-number">{r.expiry!.date}</span>
                                <span className={`inv-pill ${n < 0 ? "inv-pill-danger" : n <= 30 ? "inv-pill-warn" : "inv-pill-ghost"} ml-1`}>{n < 0 ? "기한 지남" : n === 0 ? "오늘" : `D-${n}`}</span>
                              </span>); })() : <span className="ev-dim">—</span>}</td>}
                            <td className="tc">
                              {r.state === "fix" ? <span className="inv-pill inv-pill-danger">맞춰야 함</span>
                                : r.state === "zero" ? <span className="inv-pill inv-pill-danger">품절</span>
                                : r.state === "low" ? <span className="inv-pill inv-pill-warn">부족</span>
                                : <span className="inv-pill inv-pill-ok">정상</span>}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {counts.fix > 0 && (
                    <p className="inv-foot inv-foot-warn" title="장부가 실물을 따라가지 못한 줄입니다. 대개 입고를 적지 않은 것이며 맞출 때까지 위에 남습니다">
                      <b>음수가 {counts.fix}줄 있습니다.</b> <b>+ 입·출고</b>에서 입고를 채우거나 실사 조정하세요.
                    </p>
                  )}
                </>
              )
            )}

            {tab === "moves" && (
              moves.length === 0 ? (
                <div className="collect-empty">이 기간에 움직인 기록이 없습니다.</div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-moves">
                    <thead><tr>
                      <SortableTh label="일자" sortKey="date" sort={mSort} onSort={onMSort} />
                      <SortableTh label="문서번호" sortKey="doc" sort={mSort} onSort={onMSort} />
                      <SortableTh label="사유" sortKey="reason" sort={mSort} onSort={onMSort} />
                      <SortableTh label="SKU" sortKey="sku" sort={mSort} onSort={onMSort} />
                      <SortableTh label="품목명" sortKey="name" sort={mSort} onSort={onMSort} />
                      <SortableTh label="창고" sortKey="wh" sort={mSort} onSort={onMSort} />
                      <SortableTh label="수량" sortKey="qty" sort={mSort} onSort={onMSort} />
                      <SortableTh label="단가" sortKey="price" sort={mSort} onSort={onMSort} />
                      <SortableTh label="금액" sortKey="amount" sort={mSort} onSort={onMSort} />
                      <th>메모</th>
                    </tr></thead>
                    <tbody>
                      {movePager.view.map((m) => {
                        const p = productById.get(m.product_id);
                        return (
                          <tr key={m.id}>
                            <td className="mono-number">{m.moved_at.slice(5)}</td>
                            <td className="mono-number text-left">{m.doc?.doc_no || "—"}</td>
                            {/*   부호가 사유와 반대면 취소된 줄이다 — 적지 않으면 '판매 출고 +50' 이 무슨 뜻인지 알 수 없다 */}
                            <td className="tc">
                              <span className={m.qty > 0 ? "inv-pill inv-pill-in" : "inv-pill inv-pill-out"}>{reasonLabel(m.doc?.reason || "")}</span>
                              {(() => {
                                //   입·출고에서만 따진다 — 조정(기초·실사·정정)은 음수가 원래 정상이고,
                                //     창고 이동은 한 문서에 +− 두 줄이라 받는 쪽이 항상 반대 부호다.
                                const rd = reasonOf(m.doc?.reason || "");
                                if (!rd || rd.kind === "adjust" || rd.kind === "move") return null;
                                return rd.sign === (m.qty > 0 ? -1 : 1) ? <b className="inv-line-undo">취소</b> : null;
                              })()}
                            </td>
                            <td className="mono-number text-left">{p?.sku || "—"}</td>
                            <td className="text-left">{p?.name || "—"}</td>
                            <td className="tc">{whById.get(m.warehouse_id)?.name || "—"}</td>
                            <td className="tr mono-number"><b className={m.qty < 0 ? "text-[var(--flow-out,inherit)]" : undefined}>{m.qty > 0 ? `+${won(m.qty)}` : won(m.qty)}</b></td>
                            <td className="tr mono-number ev-dim">{m.unit_price != null ? won(m.unit_price) : "—"}</td>
                            <td className="tr mono-number">{m.amount != null ? won(m.amount) : "—"}</td>
                            <td className="text-left ev-dim">{[m.note || m.doc?.note, m.lot_no ? `로트 ${m.lot_no}` : "", m.expiry_date ? `기한 ${m.expiry_date}` : ""].filter(Boolean).join(" · ") || "—"}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}

            {tab === "summary" && sumView === "ledger" && (
              ledgerLoading ? (
                <div className="collect-empty">수불부를 세는 중…</div>
              ) : ledger.rows.length === 0 ? (
                <div className="collect-empty">{to < from ? "기간이 거꾸로입니다." : "이 기간(과 그 전)에 움직인 품목이 없습니다."}</div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-ledger">
                    <thead><tr>
                      <th className="text-left">품목</th><th>단위</th><th>기초</th><th>매입</th><th>판매</th><th>생산 완성</th><th>자재 투입</th><th>조정·기타</th><th>창고 이동</th><th>기말</th><th>매입 금액</th><th>판매 금액</th>
                    </tr></thead>
                    <tbody>
                      {ledger.rows.map((r) => (
                        <tr key={r.product_id} className="inv-row-click" onClick={() => setLedgerOpen(r)} title="누르면 이 품목의 기간 움직임이 열립니다">
                          <td className="text-left"><b>{r.name}</b>{r.sku ? <span className="ev-dim"> {r.sku}</span> : null}</td>
                          <td className="tc ev-dim">{r.unit}</td>
                          <td className="tr mono-number">{won(r.opening)}</td>
                          <td className="tr mono-number">{r.buy ? won(r.buy) : ""}</td>
                          <td className="tr mono-number">{r.sale ? won(-r.sale) : ""}</td>
                          <td className="tr mono-number">{r.produce ? won(r.produce) : ""}</td>
                          <td className="tr mono-number">{r.consume ? won(-r.consume) : ""}</td>
                          <td className="tr mono-number">{r.adjust ? won(r.adjust) : ""}</td>
                          <td className="tr mono-number">{r.move ? won(r.move) : ""}</td>
                          <td className="tr mono-number"><b className={r.closing < 0 ? "inv-diff-minus" : undefined}>{won(r.closing)}</b></td>
                          <td className="tr mono-number">{r.buyAmt ? `₩${won(r.buyAmt)}` : ""}</td>
                          <td className="tr mono-number">{r.saleAmt ? `₩${won(r.saleAmt)}` : ""}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot><tr className="inv-ledger-total">
                      <td className="text-left" colSpan={2}>합계</td>
                      <td className="tr mono-number">{won(ledger.opening)}</td>
                      <td className="tr mono-number">{won(ledger.rows.reduce((s, r) => s + r.buy, 0))}</td>
                      <td className="tr mono-number">{won(-ledger.rows.reduce((s, r) => s + r.sale, 0))}</td>
                      <td className="tr mono-number">{won(ledger.rows.reduce((s, r) => s + r.produce, 0))}</td>
                      <td className="tr mono-number">{won(-ledger.rows.reduce((s, r) => s + r.consume, 0))}</td>
                      <td className="tr mono-number">{won(ledger.rows.reduce((s, r) => s + r.adjust, 0))}</td>
                      <td className="tr mono-number">{won(ledger.rows.reduce((s, r) => s + r.move, 0))}</td>
                      <td className="tr mono-number">{won(ledger.closing)}</td>
                      <td className="tr mono-number">₩{won(ledger.buyAmt)}</td>
                      <td className="tr mono-number">₩{won(ledger.saleAmt)}</td>
                    </tr></tfoot>
                  </table>
                </div>
              )
            )}
            {tab === "summary" && sumView !== "ledger" && (
              summary.rows.length === 0 ? (
                <div className="collect-empty">이 기간에 판매·매입 전표가 없습니다.</div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-summary">
                    <thead><tr>
                      <th>{sumView === "partner" ? "거래처" : "월"}</th>
                      <th>판매 수량</th><th>판매 금액</th><th>매입 수량</th><th>매입 금액</th><th>차익</th>
                    </tr></thead>
                    <tbody>
                      {summary.rows.map((r) => (
                        <tr key={r.key}>
                          <td className="text-left"><b>{r.label}</b>{r.sub ? <span className="ev-dim"> {r.sub}</span> : null}</td>
                          <td className="tr mono-number">{won(r.saleQty)}</td>
                          <td className="tr mono-number">₩{won(r.saleAmt)}</td>
                          <td className="tr mono-number">{won(r.buyQty)}</td>
                          <td className="tr mono-number">₩{won(r.buyAmt)}</td>
                          <td className="tr mono-number"><b className={r.saleAmt - r.buyAmt < 0 ? "inv-diff-minus" : undefined}>₩{won(r.saleAmt - r.buyAmt)}</b></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
            {tab === "count" && <CountBody ctl={count} warehouses={warehouses} onhand={onhand} productById={productById} />}

            {tab === "warehouse" && (
              warehouses.length === 0 ? (
                <div className="collect-empty">아직 창고가 없습니다. 첫 입·출고 때 본사창고가 자동으로 만들어집니다.</div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-wh">
                    <thead><tr><th>창고</th><th>코드</th><th>기본</th><th>품목 수</th><th>재고 수량</th></tr></thead>
                    <tbody>
                      {warehouses.map((w) => {
                        const mine = onhand.filter((r) => r.warehouse_id === w.id);
                        return (
                          //   ★ 창고를 누르면 그 안에 무엇이 몇 개 있는지 팝업으로 ("창고에 어떤 상품이 몇 개인지 한눈에")
                          <tr key={w.id} className="inv-row-click" onClick={() => setWhOpen(w)} title="누르면 이 창고의 품목·수량 목록이 열립니다">
                            <td className="text-left"><b className="inv-wh-link">{w.name}</b></td>
                            <td className="tc ev-dim">{w.code || "—"}</td>
                            <td className="tc">{w.is_default ? "✅" : "—"}</td>
                            <td className="tr mono-number">{won(mine.filter((r) => r.qty !== 0).length)}</td>
                            <td className="tr mono-number">{won(mine.reduce((n, r) => n + r.qty, 0))}</td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </QueryBody>

        {tab === "onhand" && stockView === "qty" && <Pager page={pager.page} pages={pager.pages} total={shown.length} size={50} from={pager.from} to={pager.to} onPage={pager.setPage} />}
        {tab === "onhand" && stockView === "aging" && <Pager page={agingPager.page} pages={agingPager.pages} total={agingRows.length} size={50} from={agingPager.from} to={agingPager.to} onPage={agingPager.setPage} />}
        {tab === "count" && !count.openId && count.counts.data && count.counts.data.length > 0 && (
          <Pager page={count.listPager.page} pages={count.listPager.pages} total={count.counts.data.length} size={50}
            from={count.listPager.from} to={count.listPager.to} onPage={count.listPager.setPage} />
        )}
        {tab === "count" && count.openId && (
          <Pager page={count.linePager.page} pages={count.linePager.pages} total={count.shown.length} size={50}
            from={count.linePager.from} to={count.linePager.to} onPage={count.linePager.setPage} />
        )}
        {tab === "moves" && <Pager page={movePager.page} pages={movePager.pages} total={moves.length} size={50} from={movePager.from} to={movePager.to} onPage={movePager.setPage} />}
      </QueryScreen>

      {ledgerOpen && (
        <div className="inv-modal" onClick={() => setLedgerOpen(null)}>
          <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
            <h3 className="inv-modal-title">{ledgerOpen.name}{ledgerOpen.sku ? <span className="ev-dim"> · {ledgerOpen.sku}</span> : null}</h3>
            <p className="inv-modal-desc">{from} ~ {to}{ledgerWh ? ` · ${whById.get(ledgerWh)?.name || ""}` : " · 전체 창고"} · 기초 {won(ledgerOpen.opening)} → 기말 {won(ledgerOpen.closing)}. 취소 전표는 빠집니다.</p>
            <div className="stg-table-wrap inv-ledger-detail">
              <table className="ev-table ev-lined table-inv-ledger-detail">
                <thead><tr><th>일자</th><th>사유</th><th>문서</th><th className="text-left">창고</th><th className="text-left">비고</th><th>수량</th><th>단가</th><th>금액</th><th>잔량</th></tr></thead>
                <tbody>
                  <tr className="inv-ledger-carry"><td className="tc mono-number">{from}</td><td className="tc">기초</td><td /><td /><td /><td /><td /><td /><td className="tr mono-number">{won(ledgerOpen.opening)}</td></tr>
                  {ledgerDetail.map((m) => (
                    <tr key={m.id}>
                      <td className="tc mono-number">{m.moved_at.slice(0, 10)}</td>
                      <td className="tc">{reasonLabel(m.doc?.reason || "")}</td>
                      <td className="tc mono-number">{m.doc?.doc_no || ""}</td>
                      <td className="text-left ev-dim">{whById.get(m.warehouse_id)?.name || ""}</td>
                      <td className="text-left ev-dim ev-ell" title={m.note || m.doc?.note || ""}>{m.note || m.doc?.note || ""}</td>
                      <td className="tr mono-number">{Number(m.qty) > 0 ? "+" : ""}{won(Number(m.qty))}</td>
                      <td className="tr mono-number">{m.unit_price != null ? won(Number(m.unit_price)) : ""}</td>
                      <td className="tr mono-number">{m.amount != null ? won(Math.abs(Number(m.amount))) : ""}</td>
                      <td className="tr mono-number"><b className={m.bal < 0 ? "inv-diff-minus" : undefined}>{won(m.bal)}</b></td>
                    </tr>
                  ))}
                  {ledgerDetail.length === 0 && <tr><td colSpan={9} className="collect-empty">이 기간에 움직임이 없습니다.</td></tr>}
                </tbody>
              </table>
            </div>
            <div className="inv-modal-actions"><span className="doc-sums-sp" /><button type="button" className="btn-secondary btn-sm" onClick={() => setLedgerOpen(null)}>닫기</button></div>
          </div>
        </div>
      )}
      {whOpen && (
        <WarehouseDialog wh={whOpen} onhand={onhand.filter((r) => r.warehouse_id === whOpen.id)} products={products} avgCost={avgCost}
          onClose={() => setWhOpen(null)} />
      )}
      {docOpen && companyId && (
        <StockDocDialog companyId={companyId} userId={userId} products={products} warehouses={warehouses}
          onClose={() => setDocOpen(false)}
          onSaved={(msg) => { setDocOpen(false); invalidate(); toast(msg, "success"); }}
          onError={(e) => toast(friendlyError(e, "저장하지 못했습니다"), "error")} />
      )}
      <NewCountDialog ctl={count} warehouses={warehouses} />
      <CountPasteDialog ctl={count} productById={productById} />
      {whXls && companyId && (
        <ExcelUploadDialog<{ id?: string; name: string; code: string; is_default: boolean; _new: boolean }> title="창고" cols={WAREHOUSE_XCOLS} templateName="창고_양식" sheetName="창고"
          parse={(r) => { const name = (r.name || "").trim(); if (!name) return { error: "창고명이 비었습니다" }; const code = (r.code || "").trim(); if (code.toUpperCase() === "DEFECT") return { error: "DEFECT 코드는 불량 보류 창고 전용입니다" }; const cur = warehouses.find((w) => w.name.trim() === name); return { ok: { id: cur?.id, name, code: code || cur?.code || "", is_default: r.is_default ? xBool(r.is_default, false) : (cur?.is_default ?? false), _new: !cur } }; }}
          previewHead={["창고명", "코드", "기본창고", "새로/고침"]} previewRow={(w) => [w.name, w.code || "—", w.is_default ? "예" : "아니오", w._new ? "새로" : "고침"]}
          commit={async (items) => { let n = 0, mm = 0; for (const w of items) { await upsertWarehouse(companyId, { id: w.id, name: w.name, code: w.code || undefined, is_default: w.is_default }); if (w._new) n++; else mm++; } invalidate(); return `창고 ${n + mm}곳 · 새로 ${n} · 고침 ${mm}`; }}
          onClose={() => setWhXls(false)} />
      )}
      {openingOpen && companyId && (
        <OpeningDialog companyId={companyId} userId={userId} products={products} warehouses={warehouses}
          onClose={() => setOpeningOpen(false)}
          onSaved={(msg) => { setOpeningOpen(false); invalidate(); toast(msg, "success"); }}
          onError={(e) => toast(friendlyError(e, "저장하지 못했습니다"), "error")} />
      )}
    </div>
  );
}



/** 창고 추가 · 한 줄 폼 */
function WarehouseAdd({ companyId, onDone }: { companyId: string | null; onDone: () => void }) {
  const { toast } = useToast();
  const [name, setName] = useState("");
  return (
    <span className="inv-wh-add">
      <input className="field-input" placeholder="창고 이름" value={name} onChange={(e) => setName(e.target.value)} />
      <button type="button" className="btn-primary btn-sm" disabled={!name.trim()}
        onClick={async () => {
          if (!companyId) return;
          try { await upsertWarehouse(companyId, { name }); setName(""); onDone(); toast("창고를 만들었습니다", "success"); }
          catch (e) { toast(friendlyError(e, "만들지 못했습니다"), "error"); }
        }}>+ 창고</button>
    </span>
  );
}



/** 창고 하나의 품목·수량 · 창고 갈래에서 창고를 누르면 뜬다 */
function WarehouseDialog({ wh, onhand, products, avgCost, onClose }: {
  wh: Warehouse; onhand: OnHand[]; products: Product[]; avgCost: Map<string, number>; onClose: () => void;
}) {
  const [q, setQ] = useState("");
  const byId = useMemo(() => new Map(products.map((p) => [p.id, p])), [products]);
  const rows = useMemo(() => onhand
    .filter((r) => r.qty !== 0)
    .map((r) => {
      const p = byId.get(r.product_id);
      const cost = avgCost.get(r.product_id) ?? Number(p?.cost_price || 0);
      return { r, p, cost, amount: r.qty * cost, short: p?.safety_stock != null && r.qty < p.safety_stock };
    })
    .filter((x) => !q.trim() || `${x.p?.sku || ""} ${x.p?.name || ""} ${x.p?.spec || ""}`.toLowerCase().includes(q.trim().toLowerCase()))
    .sort((a, b) => b.r.qty - a.r.qty), [onhand, byId, avgCost, q]);
  const totalQty = rows.reduce((n, x) => n + x.r.qty, 0);
  const totalAmt = rows.reduce((n, x) => n + x.amount, 0);
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">{wh.name}{wh.code ? <span className="ev-dim"> · {wh.code}</span> : null}</h3>
        <p className="inv-modal-desc" title="재고 금액은 이동평균 원가 기준입니다. 부족은 안전재고보다 적은 품목">품목 <b>{rows.length}종</b> · 수량 <b>{won(totalQty)}</b> · 재고 금액 <b>₩{won(totalAmt)}</b>입니다.</p>
        <input className="field-input inv-wh-search" placeholder="품목명 · SKU · 규격으로 좁히기" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
        {rows.length === 0 ? (
          <div className="inv-status-empty">{q ? "맞는 품목이 없습니다." : "아직 이 창고에는 재고가 없습니다."}</div>
        ) : (
          <div className="stg-table-wrap ch-ship-list">
            <table className="ev-table ev-lined table-inv-status-sm">
              <thead><tr><th>SKU</th><th>품목</th><th>규격</th><th>수량</th><th>안전재고</th><th>상태</th><th>평균단가</th><th>금액</th></tr></thead>
              <tbody>{rows.map((x) => (
                <tr key={x.r.product_id} className={x.short ? "inv-row-fix" : undefined}>
                  <td className="mono-number text-left">{x.p?.sku || "—"}</td>
                  <td className="text-left"><b>{x.p?.name || "삭제된 품목"}</b></td>
                  <td className="text-left ev-dim">{x.p?.spec || "—"}</td>
                  <td className="tr mono-number"><b>{won(x.r.qty)}</b></td>
                  <td className="tr mono-number ev-dim">{x.p?.safety_stock != null ? won(x.p.safety_stock) : "—"}</td>
                  <td className="tc">{x.r.qty <= 0 ? <span className="inv-pill inv-pill-danger">품절</span> : x.short ? <span className="inv-pill inv-pill-danger">부족</span> : <span className="inv-pill inv-pill-ok">정상</span>}</td>
                  <td className="tr mono-number ev-dim">{x.cost ? `₩${won(x.cost)}` : "—"}</td>
                  <td className="tr mono-number">₩{won(x.amount)}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="inv-modal-actions">
          <span className="fl-note">수량은 살아 있는 전표 줄의 합(취소 전표 제외)</span>
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
        </div>
      </div>
    </div>
  );
}



/** 입·출고·조정·이동 · 주문·발주 없이도 선다(결정 5) */
function StockDocDialog({ companyId, userId, products, warehouses, onClose, onSaved, onError }: {
  companyId: string; userId: string | null; products: Product[]; warehouses: Warehouse[];
  onClose: () => void; onSaved: (msg: string) => void; onError: (e: unknown) => void;
}) {
  const tracked = useMemo(() => products.filter((p) => p.track_stock && p.is_active), [products]);
  const [reason, setReason] = useState<StockReason>("purchase");
  const [docDate, setDocDate] = useState(todayKst);
  const [whId, setWhId] = useState(warehouses.find((w) => w.is_default)?.id || warehouses[0]?.id || "");
  const [toWhId, setToWhId] = useState("");
  const [note, setNote] = useState("");
  const [lines, setLines] = useState<{ product_id: string; qty: string; unit_price: string }[]>([{ product_id: "", qty: "", unit_price: "" }]);
  const [busy, setBusy] = useState(false);

  const def = reasonOf(reason);
  const isMove = def?.kind === "move";
  const ready = !!whId && (!isMove || (!!toWhId && toWhId !== whId)) &&
    lines.some((l) => l.product_id && Number(l.qty) !== 0);

  const setLine = (i: number, k: "product_id" | "qty" | "unit_price", v: string) =>
    setLines((s) => s.map((l, j) => (j === i ? { ...l, [k]: v } : l)));

  return (
    <div className="inv-modal" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inv-modal-box inv-modal-wide">
        <div className="inv-modal-head">
          <b>재고 움직이기</b>
          <button type="button" className="inv-modal-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <div className="inv-form-grid">
          <label className="inv-field"><span>사유 *</span>
            <select className="field-input" value={reason} onChange={(e) => setReason(e.target.value as StockReason)}>
              {STOCK_REASONS.filter((r) => r.value !== "opening" && r.value !== "count").map((r) => (
                <option key={r.value} value={r.value}>{r.label}</option>
              ))}
            </select></label>
          <label className="inv-field"><span>일자</span>
            <DateField className="field-input" value={docDate} onChange={(e) => setDocDate(e.target.value)} /></label>
          <label className="inv-field"><span>{isMove ? "보내는 창고 *" : "창고 *"}</span>
            <select className="field-input" value={whId} onChange={(e) => setWhId(e.target.value)}>
              {warehouses.length === 0 && <option value="">(첫 저장 때 본사창고가 만들어집니다)</option>}
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select></label>
          {isMove && (
            <label className="inv-field"><span>받는 창고 *</span>
              <select className="field-input" value={toWhId} onChange={(e) => setToWhId(e.target.value)}>
                <option value="">고르세요</option>
                {warehouses.filter((w) => w.id !== whId).map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select></label>
          )}
        </div>

        <div className="inv-lines">
          {lines.map((l, i) => {
            const raw = Number(l.qty);
            const signed = !l.qty || Number.isNaN(raw) ? 0 : raw * (def?.sign ?? 1);
            return (
              <div key={i} className="inv-line">
                <select className="field-input" value={l.product_id} onChange={(e) => setLine(i, "product_id", e.target.value)}>
                  <option value="">품목 고르기</option>
                  {tracked.map((p) => <option key={p.id} value={p.id}>{p.sku} · {p.name}{p.spec ? ` (${p.spec})` : ""}</option>)}
                </select>
                <input className="field-input" inputMode="numeric" placeholder="수량" value={l.qty} onChange={(e) => setLine(i, "qty", e.target.value)} />
                <input className="field-input" inputMode="numeric" placeholder="단가(선택)" value={l.unit_price} onChange={(e) => setLine(i, "unit_price", e.target.value)} />
                {/*   ★ 결정 8 — 음수는 '취소·되돌림'이다. 지우는 대신 반대로 한 줄 쌓는 것이니,
                        **재고가 어느 쪽으로 움직이는지**를 되읽어 준다 */}
                <span className={signed < 0 ? "inv-line-eff inv-line-eff-out" : "inv-line-eff inv-line-eff-in"}>
                  {signed === 0 ? "—" : signed > 0 ? `재고 +${won(signed)}` : `재고 ${won(signed)}`}
                  {raw < 0 ? <b className="inv-line-undo">취소</b> : null}
                </span>
                <button type="button" className="inv-line-x" onClick={() => setLines((s) => s.filter((_, j) => j !== i))} aria-label="줄 지우기">✕</button>
              </div>
            );
          })}
          <button type="button" className="btn-secondary btn-sm" onClick={() => setLines((s) => [...s, { product_id: "", qty: "", unit_price: "" }])}>+ 줄 추가</button>
        </div>

        {/*   음수를 막지 않는다 — 다만 재고가 어느 쪽으로 가는지를 적어 되묻는다(제안은 자동, 확정은 사람) */}
        {def && lines.some((l) => Number(l.qty) < 0) && (
          <p className="inv-warn" title="되돌리는 것이 아니라 새로 샀거나 되돌려받은 것이라면 반품 입고·반품 출고를 고르세요">
            수량이 음수인 줄은 <b>{def.label} 취소</b>로 읽습니다. 재고가 {def.sign < 0 ? <b>다시 늘어납니다</b> : <b>다시 줄어듭니다</b>}.
          </p>
        )}

        <label className="inv-field"><span>메모</span>
          <input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="왜 움직였는지 한 줄" /></label>

        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!ready || busy}
            onClick={async () => {
              setBusy(true);
              try {
                let wid = whId;
                if (!wid) { const w = await ensureDefaultWarehouse(companyId); wid = w?.id || ""; }
                const res = await createStockDoc(companyId, {
                  reason, docDate, warehouseId: wid, toWarehouseId: isMove ? toWhId : null, note,
                  lines: lines.filter((l) => l.product_id && Number(l.qty) !== 0).map((l) => ({
                    product_id: l.product_id, qty: Number(l.qty),
                    unit_price: l.unit_price === "" ? null : Number(l.unit_price),
                  })),
                }, userId);
                onSaved(`${res.docNo} 로 기록했습니다${res.skipped ? ` (수량을 세지 않는 품목 ${res.skipped}줄은 뺐습니다)` : ""}`);
              } catch (e) { onError(e); } finally { setBusy(false); }
            }}>{busy ? "저장 중…" : "기록하기"}</button>
        </div>
      </div>
    </div>
  );
}



/** 기초 재고 올리기 · 엑셀에서 복사해 붙여넣는다(SKU · 수량). 판매를 먼저 켜므로 이게 필수 조건이다. */
function OpeningDialog({ companyId, userId, products, warehouses, onClose, onSaved, onError }: {
  companyId: string; userId: string | null; products: Product[]; warehouses: Warehouse[];
  onClose: () => void; onSaved: (msg: string) => void; onError: (e: unknown) => void;
}) {
  const [text, setText] = useState("");
  const [whId, setWhId] = useState(warehouses.find((w) => w.is_default)?.id || warehouses[0]?.id || "");
  const [busy, setBusy] = useState(false);
  const bySku = useMemo(() => new Map(products.map((p) => [p.sku.trim().toLowerCase(), p])), [products]);

  const parsed = useMemo(() => {
    const ok: { product: Product; qty: number }[] = [];
    const bad: string[] = [];
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const cells = t.split(/\t|,|\s{2,}/).map((c) => c.trim()).filter(Boolean);
      if (cells.length < 2) { bad.push(t); continue; }
      const p = bySku.get(cells[0].toLowerCase());
      const qty = Number(cells[cells.length - 1].replace(/[^0-9.-]/g, ""));
      if (!p) { bad.push(`${t}  → SKU 없음`); continue; }
      if (!p.track_stock) { bad.push(`${t}  → 수량을 세지 않는 품목`); continue; }
      if (!qty) { bad.push(`${t}  → 수량 없음`); continue; }
      ok.push({ product: p, qty });
    }
    return { ok, bad };
  }, [text, bySku]);

  return (
    <div className="inv-modal" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inv-modal-box inv-modal-wide">
        <div className="inv-modal-head">
          <b>기초 재고 올리기</b>
          <button type="button" className="inv-modal-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>
        <p className="inv-modal-desc" title="수량을 고치는 것이 아니라 움직인 기록으로 남아 나중에 되짚을 수 있습니다">
          엑셀에서 <b>SKU 와 수량</b> 두 칸을 복사해 붙여넣으세요. 지금 있는 수량이 <b>기초 등록</b> 기록으로 남습니다.
        </p>
        <label className="inv-field"><span>창고 *</span>
          <select className="field-input" value={whId} onChange={(e) => setWhId(e.target.value)}>
            {warehouses.length === 0 && <option value="">(첫 저장 때 본사창고가 만들어집니다)</option>}
            {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
          </select></label>
        <textarea className="field-input inv-paste" rows={8} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"TS-BLK-M\t124\nTS-BLK-L\t8\nMG-CER-01\t30"} />
        <div className="inv-paste-sum">
          <b>{parsed.ok.length}줄</b> 읽었습니다
          {parsed.bad.length > 0 && <span className="inv-paste-bad"> · 못 읽은 {parsed.bad.length}줄: {parsed.bad.slice(0, 3).join(" / ")}{parsed.bad.length > 3 ? " …" : ""}</span>}
        </div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!parsed.ok.length || busy}
            onClick={async () => {
              setBusy(true);
              try {
                let wid = whId;
                if (!wid) { const w = await ensureDefaultWarehouse(companyId); wid = w?.id || ""; }
                const res = await createStockDoc(companyId, {
                  reason: "opening", warehouseId: wid, note: "기초 재고 등록",
                  lines: parsed.ok.map((r) => ({ product_id: r.product.id, qty: r.qty })),
                }, userId);
                onSaved(`${res.docNo} 로 기초 재고 ${parsed.ok.length}줄을 넣었습니다`);
              } catch (e) { onError(e); } finally { setBusy(false); }
            }}>{busy ? "넣는 중…" : `${parsed.ok.length}줄 넣기`}</button>
        </div>
      </div>
    </div>
  );
}
