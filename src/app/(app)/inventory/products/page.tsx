"use client";

// ── 재고 › 품목 (2026-08-25 재고 1단계) ─────────────────────────────────────────
//   무엇을 파는가 — SKU 사전. 모든 갈래의 뿌리라 1단계에 들어간다.
//   ★ 결정 6-④ — '수량을 관리하는 품목인가' 체크가 여기 있다. 끄면 재고에 안 잡힌다(서비스·용역).
//     이 체크 하나가 음수 재고의 절반을 없앤다(사장님 2026-08-24).

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat,
  Pager, usePager, QuickSearch, quickSearchHit,
} from "@/components/query-kit";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { listProducts, listOnHand, upsertProduct, type Product } from "@/lib/inventory";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

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
          <QueryBar right={<button type="button" className="btn-primary btn-sm" onClick={() => setEditing({ track_stock: true, unit: "EA", is_active: true })}>+ 품목 등록</button>}>
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

      {editing && companyId && (
        <ProductDialog
          initial={editing}
          onClose={() => setEditing(null)}
          onSave={async (v) => {
            try {
              await upsertProduct(companyId, v, userId);
              qc.invalidateQueries({ queryKey: ["inv-products", companyId] });
              setEditing(null);
              toast(v.id ? "품목을 고쳤습니다" : "품목을 등록했습니다", "success");
            } catch (e) {
              toast(friendlyError(e, "저장하지 못했습니다"), "error");
            }
          }}
        />
      )}
    </div>
  );
}

/** 품목 등록·수정 — 폼은 팝업(목록 줄이 밀리지 않게, 조회 화면 표준) */
function ProductDialog({ initial, onClose, onSave }: {
  initial: Partial<Product>;
  onClose: () => void;
  onSave: (v: Partial<Product> & { id?: string }) => void;
}) {
  const [v, setV] = useState<Partial<Product>>({ unit: "EA", track_stock: true, is_active: true, ...initial });
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
          <label className="inv-field"><span>바코드</span>
            <input className="field-input" value={v.barcode || ""} onChange={(e) => set("barcode", e.target.value)} /></label>
        </div>

        {/*   ★ 결정 6-④ · 7 — 이 체크 하나가 음수 재고의 절반을 없앤다. 그래서 폼 한가운데 크게 둔다. */}
        <label className="inv-track">
          <input type="checkbox" checked={v.track_stock !== false} onChange={(e) => set("track_stock", e.target.checked)} />
          <span>
            <b>수량을 관리하는 품목입니다</b>
            <em>끄면 재고에 잡히지 않습니다 — 설치비·배송비·용역·구독처럼 <b>셀 물건이 없는 것</b>. 주문·계산서에는 그대로 오릅니다.</em>
          </span>
        </label>

        <div className="inv-form-grid">
          <label className="inv-field"><span>판매가</span>
            <input className="field-input" inputMode="numeric" value={v.sale_price ?? ""} onChange={(e) => set("sale_price", num(e.target.value))} /></label>
          <label className="inv-field"><span>매입가</span>
            <input className="field-input" inputMode="numeric" value={v.cost_price ?? ""} onChange={(e) => set("cost_price", num(e.target.value))} /></label>
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
          <button type="button" className="btn-primary btn-sm" disabled={!ready} onClick={() => onSave(v)}>저장</button>
        </div>
      </div>
    </div>
  );
}
