"use client";

// ── 재고 › 품목 (2026-08-25 재고 1단계) ─────────────────────────────────────────
//   무엇을 파는가 — SKU 사전. 모든 갈래의 뿌리라 1단계에 들어간다.
//   ★ 결정 6-④ — '수량을 관리하는 품목인가' 체크가 여기 있다. 끄면 재고에 안 잡힌다(서비스·용역).
//     이 체크 하나가 음수 재고의 절반을 없앤다(사장님 2026-08-24).

import { todayKst } from "@/lib/kst";
import { exportToExcel } from "@/lib/excel-export";
import { xNum, xBool, type ExcelColumn, type ExcelRow } from "@/lib/excel-io";
import { ExcelUploadDialog } from "../_components/excel-upload";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat,
  Pager, usePager, QuickSearch, quickSearchHit, ExcelMenu } from "@/components/query-kit";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { listProducts, listOnHand, upsertProduct, type Product } from "@/lib/inventory";
import { listBoms } from "@/lib/inventory-production";
import { BomEditorDialog } from "../_components/bom-editor";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

const PRODUCT_XCOLS: ExcelColumn[] = [
  { key: "sku", label: "SKU", required: true, hint: "품목 코드 — 같은 SKU 가 있으면 고칩니다", example: "TS-BK-M" },
  { key: "name", label: "품목명", required: true, example: "무지 티셔츠" },
  { key: "category", label: "분류", example: "의류" },
  { key: "spec", label: "규격", example: "블랙 / M" },
  { key: "unit", label: "단위", hint: "EA·SET·BOX·kg 등(비우면 EA)", example: "EA" },
  { key: "barcode", label: "바코드", hint: "스캐너로 찍는 값", example: "8801234567890" },
  { key: "sale", label: "판매가", kind: "number", example: 19000 },
  { key: "cost", label: "매입가", kind: "number", hint: "참고 매입가 · 기초 원가 기본값", example: 7200 },
  { key: "overhead", label: "단위당 노무·경비", kind: "number", hint: "완제품 1개당 생산 원가에 얹는 금액", example: 0 },
  { key: "safety", label: "안전재고", kind: "number", hint: "이 아래로 내려가면 '부족'", example: 20 },
  { key: "track", label: "수량관리", kind: "bool", hint: "예/아니오 — 아니오면 재고를 세지 않는다(서비스·비용)", example: "예" },
  { key: "active", label: "상태", hint: "판매중/단종(비우면 판매중)", example: "판매중" },
  { key: "memo", label: "메모", example: "" },
];

export default function ProductsPage() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { setCompanyId(u?.company_id ?? null); setUserId(u?.id ?? null); }); }, []);

  const [q, setQ] = useState("");
  const [onlyActive, setOnlyActive] = useState(true);
  type SortKey = "sku" | "name" | "category" | "sale" | "cost" | "qty";
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "sku", dir: "asc" });
  const [editing, setEditing] = useState<Partial<Product> | null>(null);
  //   자재구성 팝업 — 품목 등록 체크박스에서 연다(2026-08-26 사장님: 생산이 아니라 품목에 있어야)
  const [bomFor, setBomFor] = useState<Product | null>(null);
  const { data: boms = [] } = useQuery({ queryKey: ["inv-boms", companyId], queryFn: () => listBoms(companyId!), enabled: !!companyId });
  const bomOf = useMemo(() => { const m = new Map<string, number>(); for (const b of boms) m.set(b.product_id, (m.get(b.product_id) || 0) + 1); return m; }, [boms]);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [xlsOpen, setXlsOpen] = useState(false);

  const { data: products = [] } = useQuery({
    queryKey: ["inv-products", companyId],
    queryFn: () => listProducts(companyId!),
    enabled: !!companyId,
  });
  const { data: onhand = [] } = useQuery({
    queryKey: ["inv-onhand", companyId],
    queryFn: () => listOnHand(companyId!),
    enabled: !!companyId,
  });

  //   현재고는 창고를 합쳐 품목 단위로 — 이 화면은 "무엇을 파는가"라 창고별은 재고 화면이 맡는다
  const qtyOf = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of onhand) m.set(r.product_id, (m.get(r.product_id) || 0) + r.qty);
    return m;
  }, [onhand]);

  const shown = useMemo(() => {
    const arr = products.filter((p) =>
      (!onlyActive || p.is_active) &&
      quickSearchHit(q, [p.sku, p.name, p.category, p.spec, p.barcode]));
    const val = (p: Product) => {
      switch (sort.key) {
        case "name": return p.name;
        case "category": return p.category || "";
        case "sale": return Number(p.sale_price || 0);
        case "cost": return Number(p.cost_price || 0);
        case "qty": return qtyOf.get(p.id) ?? 0;
        default: return p.sku;
      }
    };
    const d = sort.dir === "asc" ? 1 : -1;
    return [...arr].sort((a, b) => cmp(val(a), val(b)) * d);
  }, [products, q, onlyActive, sort, qtyOf]);

  const pager = usePager(shown, 50, `${q}|${onlyActive}|${sort.key}${sort.dir}`);
  const stockValue = useMemo(
    () => products.reduce((n, p) => n + (qtyOf.get(p.id) ?? 0) * Number(p.cost_price || 0), 0),
    [products, qtyOf]);
  const trackedCount = products.filter((p) => p.track_stock).length;

  const onSort = (k: string) => setSort((s) => nextSort(s, k as SortKey));

  if (!permLoading && !(isMaster || hasPerm("/inventory/products"))) {
    return <AccessDenied detail="품목 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;
  }

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print"><button type="button" className="collect-tab collect-tab-on">품목</button></div>
          <QueryBar right={<>
            {/*   ★ 엑셀 — 양식·올리기·붙여넣기·내려받기를 한 버튼 안에(2026-08-27 사장님) */}
            <ExcelMenu items={[
              { label: "양식 내려받기 · 올리기", hint: "양식을 받아 채운 뒤 올리면 읽어서 보여 주고, 등록을 눌러야 저장 · 같은 SKU 는 고침", onClick: () => setXlsOpen(true) },
              { label: "붙여넣기", hint: "엑셀에서 복사한 줄을 바로 붙여넣기", onClick: () => setPasteOpen(true) },
              { label: "조회 결과 내려받기", count: shown.length, disabled: !shown.length, onClick: () => exportToExcel(shown.map((p) => ({ "SKU": p.sku, "품목명": p.name, "분류": p.category || "", "규격": p.spec || "", "단위": p.unit || "", "바코드": p.barcode || "", "판매가": p.sale_price ?? "", "매입가": p.cost_price ?? "", "단위당 노무·경비": p.overhead_per_unit || 0, "안전재고": p.safety_stock ?? "", "수량관리": p.track_stock ? "예" : "아니오", "현재고": qtyOf.get(p.id) ?? 0, "상태": p.is_active ? "판매중" : "단종", "메모": p.memo || "" })), "품목", `품목_${todayKst()}`) },
            ]} />
            <button type="button" className="btn-primary btn-sm" onClick={() => setEditing({ track_stock: true, unit: "EA", is_active: true })}>+ 품목 등록</button>
          </>}>
            <QuickSearch value={q} onApply={setQ} placeholder="품목명 · SKU · 분류 · 규격 · 바코드 — 쉼표로 여러 개, Enter" />
            <button type="button" className={onlyActive ? "qk-chip qk-chip-on" : "qk-chip"} onClick={() => setOnlyActive(true)}>판매중</button>
            <button type="button" className={!onlyActive ? "qk-chip qk-chip-on" : "qk-chip"} onClick={() => setOnlyActive(false)}>전체</button>
          </QueryBar>
          <ResultStrip>
            <Stat label="품목" value={`${won(shown.length)}개`} />
            <Stat label="수량 관리" value={`${won(trackedCount)}개`} />
            <Stat label="재고금액 (매입가 기준)" value={`₩${won(stockValue)}`} />
          </ResultStrip>
        </QueryHead>
        <QueryBody>
          <div className="inv-scroll">
            {products.length === 0 ? (
              <div className="collect-empty">
                아직 등록한 품목이 없습니다 — <b>파는 것·쓰는 것</b>을 먼저 올리면 재고를 셀 수 있습니다.<br />
                설치비·배송비처럼 <b>셀 물건이 없는 것</b>은 등록할 때 &lsquo;수량 관리&rsquo;를 끄면 재고에 잡히지 않습니다.
              </div>
            ) : (
              <>
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-inv-products">
                    <thead>
                      <tr>
                        <SortableTh label="SKU" sortKey="sku" sort={sort} onSort={onSort} />
                        <SortableTh label="품목명" sortKey="name" sort={sort} onSort={onSort} />
                        <SortableTh label="분류" sortKey="category" sort={sort} onSort={onSort} />
                        <th>규격·옵션</th>
                        <th>수량관리</th>
                        <SortableTh label="판매가" sortKey="sale" sort={sort} onSort={onSort} />
                        <SortableTh label="매입가" sortKey="cost" sort={sort} onSort={onSort} />
                        <SortableTh label="현재고" sortKey="qty" sort={sort} onSort={onSort} />
                        <th>상태</th>
                      </tr>
                    </thead>
                    <tbody>
                      {pager.view.map((p) => {
                        const qty = qtyOf.get(p.id) ?? 0;
                        const low = p.track_stock && p.safety_stock != null && qty <= Number(p.safety_stock);
                        return (
                          <tr key={p.id} className="inv-row" onClick={() => setEditing(p)}>
                            <td className="mono-number text-left">{p.sku}</td>
                            <td className="text-left"><b>{p.name}</b></td>
                            <td className="tc">{p.category || "—"}</td>
                            <td className="tc ev-dim">{p.spec || "—"}</td>
                            <td className="tc">{p.track_stock ? "✅" : <span className="ev-dim">—</span>}</td>
                            <td className="tr mono-number">{p.sale_price != null ? won(p.sale_price) : "—"}</td>
                            <td className="tr mono-number">{p.cost_price != null ? won(p.cost_price) : "—"}</td>
                            <td className="tr mono-number">
                              {p.track_stock ? <b className={qty < 0 ? "text-[var(--danger)]" : undefined}>{won(qty)}</b> : <span className="ev-dim">해당없음</span>}
                            </td>
                            <td className="tc">
                              {!p.is_active ? <span className="inv-pill inv-pill-ghost">단종</span>
                                : !p.track_stock ? <span className="inv-pill inv-pill-ghost">수량 없음</span>
                                : qty < 0 ? <span className="inv-pill inv-pill-danger">맞춰야 함</span>
                                : qty === 0 ? <span className="inv-pill inv-pill-danger">품절</span>
                                : low ? <span className="inv-pill inv-pill-warn">부족</span>
                                : <span className="inv-pill inv-pill-ok">정상</span>}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                <p className="inv-foot">줄을 누르면 그 품목을 고칩니다. · 재고금액은 <b>매입가</b> 기준입니다(매입가가 없는 품목은 0).</p>
              </>
            )}
          </div>
        </QueryBody>
        <Pager page={pager.page} pages={pager.pages} total={shown.length} size={50}
          from={pager.from} to={pager.to} onPage={pager.setPage} />
      </QueryScreen>

      {xlsOpen && companyId && (
        <ExcelUploadDialog<Partial<Product> & { id?: string; _new: boolean }> title="품목" cols={PRODUCT_XCOLS} templateName="품목_양식" sheetName="품목"
          guide={["같은 SKU 가 이미 있으면 그 품목을 고칩니다(없는 칸은 그대로 둡니다).", "수량관리를 '아니오'로 하면 재고를 세지 않는 서비스·비용 항목이 됩니다."]}
          parse={(r) => {
            if (!r.sku?.trim() || !r.name?.trim()) return { error: "SKU 와 품목명이 있어야 합니다" };
            const cur = products.find((p) => p.sku.trim().toUpperCase() === r.sku.trim().toUpperCase());
            const v: Partial<Product> & { id?: string; _new: boolean } = { id: cur?.id, _new: !cur, sku: r.sku.trim(), name: r.name.trim(), track_stock: xBool(r.track, cur?.track_stock ?? true), is_active: r.active ? xBool(r.active, true) : (cur?.is_active ?? true) };
            const put = (k: keyof Product, val: unknown) => { if (val !== null && val !== "") (v as Record<string, unknown>)[k] = val; };
            put("category", r.category?.trim() || null); put("spec", r.spec?.trim() || null); put("unit", r.unit?.trim() || (cur ? null : "EA")); put("barcode", r.barcode?.trim() || null);
            put("sale_price", xNum(r.sale)); put("cost_price", xNum(r.cost)); put("overhead_per_unit", xNum(r.overhead)); put("safety_stock", xNum(r.safety)); put("memo", r.memo?.trim() || null);
            if (cur) { for (const k of ["category", "spec", "unit", "barcode", "sale_price", "cost_price", "overhead_per_unit", "safety_stock", "memo"] as const) if ((v as Record<string, unknown>)[k] === undefined) (v as Record<string, unknown>)[k] = cur[k]; }
            return { ok: v };
          }}
          previewHead={["SKU · 품목명", "규격", "단위", "판매가", "매입가", "안전재고", "수량관리", "새로/고침"]}
          previewRow={(v) => [`${v.sku} ${v.name}`, v.spec || "—", v.unit || "EA", v.sale_price ?? "—", v.cost_price ?? "—", v.safety_stock ?? "—", v.track_stock === false ? "아니오" : "예", v._new ? "새로" : "고침"]}
          commit={async (items) => { let n = 0, m = 0; for (const it of items) { const { _new, ...rest } = it; await upsertProduct(companyId!, rest, userId); if (_new) n++; else m++; } qc.invalidateQueries({ queryKey: ["inv-products", companyId] }); return `품목 ${n + m}건 — 새로 ${n} · 고침 ${m}`; }}
          onClose={() => setXlsOpen(false)} />
      )}
      {pasteOpen && companyId && (
        <ProductPasteDialog products={products} onClose={() => setPasteOpen(false)}
          onDone={(n) => { setPasteOpen(false); qc.invalidateQueries({ queryKey: ["inv-products", companyId] }); toast(`품목 ${n}개를 올렸습니다`, "success"); }}
          save={(v) => upsertProduct(companyId, v, userId)} />
      )}
      {editing && companyId && (
        <ProductDialog others={products}
          initial={editing}
          bomCount={editing.id ? (bomOf.get(editing.id) || 0) : 0}
          onOpenBom={(p) => setBomFor(p)}
          onClose={() => setEditing(null)}
          onSave={async (v, openBom) => {
            try {
              const id = await upsertProduct(companyId, v, userId);
              await qc.invalidateQueries({ queryKey: ["inv-products", companyId] });
              setEditing(null);
              toast(v.id ? "품목을 고쳤습니다" : "품목을 등록했습니다", "success");
              //   새 품목에 자재구성을 켜 두었으면 저장 직후 자재구성 팝업 — 저장 전엔 id 가 없어 줄을 못 붙인다
              if (openBom) setBomFor({ ...(v as Product), id });
            } catch (e) {
              toast(friendlyError(e, "저장하지 못했습니다"), "error");
            }
          }}
        />
      )}
      {bomFor && companyId && (
        <BomEditorDialog companyId={companyId} product={bomFor} products={products} onClose={() => setBomFor(null)} />
      )}
    </div>
  );
}

/** 품목 등록·수정 — 폼은 팝업(목록 줄이 밀리지 않게, 조회 화면 표준) */
function ProductDialog({ initial, others, bomCount, onOpenBom, onClose, onSave }: {
  initial: Partial<Product>;
  /** 바코드 중복 확인용 — 다른 품목들 */
  others: Product[];
  /** 이 품목에 등록된 자재구성 줄 수 */
  bomCount: number;
  onOpenBom: (p: Product) => void;
  onClose: () => void;
  onSave: (v: Partial<Product> & { id?: string }, openBom: boolean) => void;
}) {
  const [v, setV] = useState<Partial<Product>>({ unit: "EA", track_stock: true, is_active: true, ...initial });
  //   자재구성 체크 — 있는 품목이면 켜져 있고, 켜면(기존 품목) 바로 팝업, 새 품목이면 저장 뒤 팝업
  const [wantBom, setWantBom] = useState(bomCount > 0);
  const dupBarcode = v.barcode ? others.find((p) => p.id !== initial.id && p.barcode === v.barcode) : undefined;
  const set = (k: keyof Product, val: unknown) => setV((s) => ({ ...s, [k]: val }));
  const num = (x: unknown) => (x === "" || x == null ? null : Number(String(x).replace(/[^0-9.-]/g, "")));
  const ready = !!String(v.sku || "").trim() && !!String(v.name || "").trim();

  //   분류를 '서비스'로 고르면 수량 관리를 꺼진 채로 — 사람이 매번 판단하지 않아도 되게(기획 목업 그대로)
  const onCategory = (c: string) => {
    setV((s) => ({ ...s, category: c, ...(c.trim() === "서비스" && s.id == null ? { track_stock: false } : {}) }));
  };

  return (
    <div className="inv-modal" role="dialog" aria-modal="true" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="inv-modal-box">
        <div className="inv-modal-head">
          <b>{v.id ? "품목 고치기" : "품목 등록"}</b>
          <button type="button" className="inv-modal-x" onClick={onClose} aria-label="닫기">✕</button>
        </div>

        <div className="inv-form-grid">
          <label className="inv-field"><span>SKU *</span>
            <input className="field-input" value={v.sku || ""} onChange={(e) => set("sku", e.target.value)} placeholder="TS-BLK-M" /></label>
          <label className="inv-field"><span>품목명 *</span>
            <input className="field-input" value={v.name || ""} onChange={(e) => set("name", e.target.value)} placeholder="기본 티셔츠" /></label>
          <label className="inv-field"><span>분류</span>
            <input className="field-input" value={v.category || ""} onChange={(e) => onCategory(e.target.value)} placeholder="의류 · 부자재 · 서비스" /></label>
          <label className="inv-field"><span>규격·옵션</span>
            <input className="field-input" value={v.spec || ""} onChange={(e) => set("spec", e.target.value)} placeholder="블랙 / M" /></label>
          <label className="inv-field"><span>단위</span>
            <input className="field-input" value={v.unit || ""} onChange={(e) => set("unit", e.target.value)} placeholder="EA · BOX · kg" /></label>
          <label className="inv-field"><span>바코드{dupBarcode ? <em className="inv-field-warn"> — 이미 '{dupBarcode.name}'({dupBarcode.sku})에 쓰인 번호</em> : null}</span>
            {/*   ★ 스캐너로 찍는 칸 — 스캐너는 숫자 뒤에 Enter 를 보낸다. Enter 는 저장이 아니라 다음 칸으로(2026-08-26 사장님 확인). */}
            <input className={dupBarcode ? "field-input inv-input-warn" : "field-input"} inputMode="numeric" value={v.barcode || ""}
              placeholder="커서를 두고 바코드를 찍으면 번호가 들어갑니다"
              onChange={(e) => set("barcode", e.target.value.trim())}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                const inputs = [...(e.currentTarget.closest(".inv-modal-box")?.querySelectorAll<HTMLElement>("input, select, textarea") || [])];
                const i = inputs.indexOf(e.currentTarget);
                inputs[i + 1]?.focus();
              }} /></label>
        </div>

        {/*   ★ 결정 6-④ · 7 — 이 체크 하나가 음수 재고의 절반을 없앤다. 그래서 폼 한가운데 크게 둔다. */}
        <label className="inv-track">
          <input type="checkbox" checked={v.track_stock !== false} onChange={(e) => set("track_stock", e.target.checked)} />
          <span>
            <b>수량을 관리하는 품목입니다</b>
            <em>끄면 재고에 잡히지 않습니다 — 설치비·배송비·용역·구독처럼 <b>셀 물건이 없는 것</b>. 주문·계산서에는 그대로 오릅니다.</em>
          </span>
        </label>
        {/*   ★ 자재구성 — 생산 입력이 아니라 품목 등록에서(2026-08-26 사장님). 체크하면 팝업이 열린다. */}
        <label className="inv-track inv-track-bom">
          <input type="checkbox" checked={wantBom} onChange={(e) => {
            setWantBom(e.target.checked);
            if (e.target.checked && initial.id) onOpenBom({ ...(initial as Product), ...(v as Product) });
          }} />
          <span>
            <b>자재로 만드는 품목입니다 (세트·완제품){bomCount > 0 && <span className="inv-pill inv-pill-ok">자재 {bomCount}종</span>}</b>
            <em>체크하면 <b>자재구성</b>(1개당 소요 자재·소요량) 입력 창이 열립니다{!initial.id ? " — 새 품목은 저장 후 열립니다" : ""}. 생산 › 완성 기록 시 소요량만큼 자재가 출고됩니다.</em>
            {bomCount > 0 && initial.id && <button type="button" className="bz-link" onClick={(e) => { e.preventDefault(); onOpenBom({ ...(initial as Product), ...(v as Product) }); }}>자재구성 고치기</button>}
          </span>
        </label>

        <div className="inv-form-grid">
          <label className="inv-field"><span>판매가</span>
            <input className="field-input" inputMode="numeric" value={v.sale_price ?? ""} onChange={(e) => set("sale_price", num(e.target.value))} /></label>
          <label className="inv-field"><span>매입가</span>
            <input className="field-input" inputMode="numeric" value={v.cost_price ?? ""} onChange={(e) => set("cost_price", num(e.target.value))} /></label>
          {/*   ★ 결정 38 (2026-08-26 사장님) — 생산 원가에 얹는 1개당 노무·경비. 급여대장에서 끌어오지 않는다(권한 누수). 바꾸면 그 뒤 완성 기록부터 */}
          <label className="inv-field"><span>단위당 노무·경비 <em className="inv-hint">완제품 1개당 · 생산 원가에 얹음</em></span>
            <input className="field-input" inputMode="numeric" value={v.overhead_per_unit ?? ""} onChange={(e) => set("overhead_per_unit", num(e.target.value))} /></label>
          <label className="inv-field"><span>안전재고 <em className="inv-hint">이 아래로 내려가면 &lsquo;부족&rsquo;</em></span>
            <input className="field-input" inputMode="numeric" disabled={v.track_stock === false}
              value={v.safety_stock ?? ""} onChange={(e) => set("safety_stock", num(e.target.value))} /></label>
          <label className="inv-field"><span>상태</span>
            <select className="field-input" value={v.is_active === false ? "0" : "1"} onChange={(e) => set("is_active", e.target.value === "1")}>
              <option value="1">판매중</option><option value="0">단종</option>
            </select></label>
        </div>
        <label className="inv-field"><span>메모</span>
          <input className="field-input" value={v.memo || ""} onChange={(e) => set("memo", e.target.value)} /></label>

        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!ready} onClick={() => onSave(v, wantBom && !initial.id)}>저장</button>
        </div>
      </div>
    </div>
  );
}


/** 품목 엑셀 붙여넣기 — 처음 시작할 때 수백 개를 하나씩 못 친다 (2026-08-25 사장님 지시, 1순위 ④)
 *  칸 차례: SKU · 품목명 · 규격 · 단위 · 판매가 · 매입가 · 안전재고 · 수량관리(예/아니오)
 *  같은 SKU 가 이미 있으면 **고친다**(두 번 올려도 두 개가 되지 않는다). */
function ProductPasteDialog({ products, onClose, onDone, save }: {
  products: Product[]; onClose: () => void; onDone: (n: number) => void;
  save: (v: Partial<Product> & { id?: string }) => Promise<unknown>;
}) {
  const { toast } = useToast();
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const bySku = useMemo(() => new Map(products.map((p) => [p.sku.trim().toUpperCase(), p])), [products]);
  const num = (x: string | undefined) => { const n = Number(String(x ?? "").replace(/[^0-9.-]/g, "")); return x && !Number.isNaN(n) ? n : null; };
  const parsed = useMemo(() => {
    const ok: (Partial<Product> & { id?: string; _new: boolean })[] = [];
    const bad: string[] = [];
    for (const raw of text.split(/\r?\n/)) {
      const line = raw.trim();
      if (!line) continue;
      const p = line.split(/\t|\s{2,}/).map((x) => x.trim());
      if (/^sku$/i.test(p[0] || "") || p[0] === "품목코드") continue;   // 머리줄은 건너뛴다
      if (!p[0] || !p[1]) { bad.push(`${line.slice(0, 30)} → SKU 와 품목명이 있어야 합니다`); continue; }
      const cur = bySku.get(p[0].toUpperCase());
      const track = p[7] == null || p[7] === "" ? true : !/^(아니오|아니요|n|no|false|0|x)$/i.test(p[7]);
      ok.push({
        id: cur?.id, _new: !cur, sku: p[0], name: p[1], spec: p[2] || null, unit: p[3] || "EA",
        sale_price: num(p[4]), cost_price: num(p[5]), safety_stock: num(p[6]), track_stock: track,
      });
    }
    return { ok, bad };
  }, [text, bySku]);
  const newCount = parsed.ok.filter((x) => x._new).length;

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">품목 엑셀 붙여넣기</h3>
        <p className="inv-modal-desc">
          엑셀에서 <b>SKU · 품목명 · 규격 · 단위 · 판매가 · 매입가 · 안전재고 · 수량관리(예/아니오)</b> 차례로 복사해 붙이세요.
          앞 두 칸만 있어도 됩니다. <b>같은 SKU 가 이미 있으면 그 품목을 고칩니다.</b>
        </p>
        <textarea className="field-input inv-paste" rows={10} value={text} onChange={(e) => setText(e.target.value)}
          placeholder={"TS-BK-M\t무지 티셔츠\t블랙 / M\tEA\t19000\t7200\t20\t예\nDLV\t배송비\t\t건\t3000\t\t\t아니오"} />
        <div className="inv-paste-sum">
          <b>{parsed.ok.length}줄 읽었습니다</b>{parsed.ok.length > 0 && <span> · 새로 {newCount} · 고침 {parsed.ok.length - newCount}</span>}
          {parsed.bad.length > 0 && <span className="inv-paste-bad"> · 못 읽은 {parsed.bad.length}줄: {parsed.bad.slice(0, 2).join(" / ")}{parsed.bad.length > 2 ? " …" : ""}</span>}
        </div>
        <div className="inv-modal-actions">
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>취소</button>
          <button type="button" className="btn-primary btn-sm" disabled={!parsed.ok.length || busy}
            onClick={async () => {
              setBusy(true);
              let n = 0;
              try {
                for (const v of parsed.ok) { const { _new, ...row } = v; await save(row); n++; }
                onDone(n);
              } catch (e) { toast(friendlyError(e, `${n}개까지 올리고 멈췄습니다`), "error"); }
              finally { setBusy(false); }
            }}>올리기</button>
        </div>
      </div>
    </div>
  );
}
