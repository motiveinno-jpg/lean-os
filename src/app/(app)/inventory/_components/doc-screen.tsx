"use client";

// ── 재고 — 전표 화면 껍데기 (2026-08-25 사장님 지시) ───────────────────────────
//   주문서·판매·구매·생산이 이것 하나를 같이 쓴다. 다른 것은 **저장하면 무엇이 되는가**뿐이다.
//   ★ 들어가면 **입력이 먼저** 뜬다(사장님 지시) — 치려고 들어오는 일이 훨씬 많다. 커서도 첫 칸에 간다.
//   ★ 이력에서 줄을 누르면 **치던 그 화면이 그대로** 팝업으로 뜬다.
//     수정 전용 화면을 따로 만들지 않는다 — 만들면 칸·규칙이 둘로 갈라져 곧 어긋난다.

import { downloadTemplate, xNum, isDate, type ExcelColumn, type ExcelRow } from "@/lib/excel-io";
import { appConfirm } from "@/components/global-confirm";
import { ExcelUploadDialog } from "./excel-upload";
import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import { todayKst } from "@/lib/kst";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, Pager, usePager, QuickSearch, quickSearchHit, HelperMenu, type HelperItem, ExcelMenu, defaultRange } from "@/components/query-kit";
import { DateRangeField } from "@/components/date-range-field";
import { exportToExcel } from "@/lib/excel-export";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";
import { listProducts, listWarehouses, type Product, type Warehouse } from "@/lib/inventory";
import { FORM_LABEL, type FormKey } from "@/lib/inventory-orders";
import {
  useDocEditor, DocHead, DocGrid, DocSums, FormDialog, blankRow, docWon as won,
  type DocCtl, type Partner,
} from "./doc-editor";

export type SaveAction = { key: string; label: string; primary?: boolean; hint?: string };

/** 엑셀로 올린 문서 하나 — 같은 묶음(문서묶음 칸이 같거나, 일자·거래처·창고·납기가 같은 줄)이 한 문서 (2026-08-27) */
export type ImportDoc = {
  date: string; partnerId: string | null; partnerName: string | null; warehouseId: string; due: string | null; note: string | null;
  lines: { product_id: string; qty: number; defect: number; unit_price: number | null; note: string | null }[];
};
type ImportRow = { grp: string; date: string; partnerName: string; partnerId: string | null; warehouseId: string; warehouseName: string; due: string; sku: string; name: string; product_id: string; qty: number; defect: number; unit_price: number | null; lnote: string; note: string };
export function importColumns(formKey: FormKey): ExcelColumn[] {
  const make = formKey === "make", order = formKey === "order";
  return [
    { key: "grp", label: "문서묶음", hint: "같은 값끼리 한 문서로 묶습니다(비우면 일자·거래처·창고·납기가 같은 줄이 한 문서)", example: "A" },
    { key: "date", label: "일자", required: true, kind: "date", hint: "문서 일자", example: "2026-08-27" },
    ...(make ? [] : [{ key: "partner", label: "거래처", hint: "거래처 이름 — 등록된 이름과 같아야 연결됩니다. 없으면 이름만 남깁니다", example: "바톤" } as ExcelColumn]),
    { key: "wh", label: "창고", required: !order, hint: order ? "비우면 기본 창고" : "창고 이름(재고 › 창고관리)", example: "본사창고" },
    ...(order || formKey === "buy" ? [{ key: "due", label: order ? "납기일" : "입고예정일", kind: "date", example: "2026-09-05" } as ExcelColumn] : []),
    { key: "sku", label: "SKU", required: true, hint: "품목 SKU 또는 바코드", example: "DM-A100" },
    ...(make
      ? [{ key: "qty", label: "양품", required: true, kind: "number", example: 10 } as ExcelColumn, { key: "defect", label: "불량", kind: "number", hint: "불량 보류 창고로 들어갑니다", example: 0 } as ExcelColumn]
      : [{ key: "qty", label: "수량", required: true, kind: "number", example: 5 } as ExcelColumn]),
    { key: "price", label: "단가", kind: "number", hint: "비우면 품목 단가·거래처 단가를 씁니다", example: 25000 },
    { key: "lnote", label: "품목 비고", example: "" },
    { key: "note", label: "전표 비고", hint: "문서 전체 메모(묶음의 첫 줄 값)", example: "" },
  ];
}
type HistKey = "no" | "date" | "who" | "label" | "lines" | "total" | "state";

/** 이력 한 줄 — 무엇을 보여줄지는 화면마다 다르지만 모양은 같다. */
export type HistRow = {
  id: string; no: string; date: string; who: string; label: string;
  lines: number; total: number; state: string; stateTone?: "ok" | "warn" | "danger";
};

export function DocScreen({
  formKey, perm, saveActions, onSave, history, onOpen, onDelete, onCancel, onReturn, popupExtra, pull, headNote, tools, onImport,
}: {
  formKey: FormKey;
  perm: string;
  saveActions: SaveAction[];
  /** 저장 — 어떤 갈래로 눌렀는지(actionKey)와 빚은 값을 받는다. 고치는 중이면 editingId 가 온다. */
  onSave: (a: { actionKey: string; built: ReturnType<DocCtl["build"]>; ctl: DocCtl; editingId: string | null }) => Promise<string>;
  history: (a: { companyId: string; from: string; to: string }) => Promise<HistRow[]>;
  onOpen: (a: { id: string; ctl: DocCtl }) => Promise<void>;
  onDelete?: (a: { id: string; ctl: DocCtl }) => Promise<void>;
  /** 취소 — 지우지 않고 사유와 함께 남긴다(재고 전표). 주문서는 onDelete 를 쓴다 */
  onCancel?: (a: { id: string; ctl: DocCtl; reason: string }) => Promise<void>;
  /** 반품 — 원본을 가리키는 반대 전표를 만든다. 판매·구매만 넘긴다 */
  onReturn?: (a: { id: string; ctl: DocCtl }) => Promise<string>;
  /** 팝업 바닥에 더 둘 동작(주문서 PDF 등) */
  popupExtra?: (a: { ctl: DocCtl; products: Product[] }) => React.ReactNode;
  /** 주문서에서 줄을 불러오는 버튼을 둘지 */
  pull?: (ctl: DocCtl) => React.ReactNode;
  headNote?: React.ReactNode;
  /** 보조 동작 묶음 — 주면 '도구 ▾' 하나로 접히고 '입력 항목'도 그 안으로 (2026-08-27 사장님: 조회 줄 버튼 정리) */
  tools?: (ctl: DocCtl) => HelperItem[];
  /** 엑셀 일괄 올리기 — 묶은 문서들을 저장하고 결과 글을 돌려준다. 주면 조회 줄 '엑셀 ▾'에 양식·올리기가 붙는다 */
  onImport?: (a: { docs: ImportDoc[]; ctl: DocCtl }) => Promise<string>;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { setCompanyId(u?.company_id ?? null); setUserId(u?.id ?? null); }); }, []);

  const [tab, setTab] = useState<"edit" | "list">("edit");
  const [xlsOpen, setXlsOpen] = useState(false);
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(() => defaultRange().from);   // 최근 1개월(KST) — 종료일이 미래(+1개월)로 잡히던 것 정리 (2026-09-03)
  //   ★ 앞으로 한 달까지 본다 — 주문서는 **미래 일자가 정상**이다(납기에 맞춰 앞당겨 적는다).
  //     '오늘까지'로 두면 내일 날짜로 저장한 전표가 목록에서 사라진 것처럼 보인다(실제로 겪었다).
  const [to, setTo] = useState(() => defaultRange().to);
  const [busy, setBusy] = useState(false);
  const [popup, setPopup] = useState(false);
  const [sort, setSort] = useState<SortState<HistKey>>({ key: "date", dir: "desc" });

  //   메뉴 권한 = 보기, `:write` = 입력·수정·취소 (2026-08-26 권한 세분화)
  const canWrite = isMaster || hasPerm(`${perm}:write`);

  const { data: products = [] } = useQuery({ queryKey: ["inv-products", companyId], queryFn: () => listProducts(companyId!), enabled: !!companyId });
  const { data: warehouses = [] } = useQuery({ queryKey: ["inv-warehouses", companyId], queryFn: () => listWarehouses(companyId!), enabled: !!companyId });
  const { data: partners = [] } = useQuery({
    queryKey: ["inv-partners", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("partners").select("id, name")
        .eq("company_id", companyId!).eq("is_active", true).order("name").limit(500);
      return ((data || []) as any[]).map((p) => ({ id: p.id, name: p.name })) as Partner[];
    },
    enabled: !!companyId,
  });
  //   담당자 고르개에 쓸 구성원 — 거래처와 같은 방식으로 고른다
  const { data: staff = [] } = useQuery({
    queryKey: ["inv-staff", companyId],
    queryFn: async () => {
      const { data } = await supabase.from("users").select("id, name")
        .eq("company_id", companyId!).order("name").limit(300);
      return ((data || []) as any[]).map((u) => ({ id: u.id, name: u.name || "" })).filter((u) => u.name) as Partner[];
    },
    enabled: !!companyId,
  });
  const { data: hist = [], refetch: refetchHist } = useQuery({
    queryKey: ["doc-hist", formKey, companyId, from, to],
    queryFn: () => history({ companyId: companyId!, from, to }),
    enabled: !!companyId,
  });

  const ctl = useDocEditor(companyId, userId, formKey, products);

  const shown = useMemo(() => hist.filter((h) => quickSearchHit(q, [h.no, h.who, h.label, h.state])), [hist, q]);
  const sorted = useMemo(() => {
    const d = sort.dir === "asc" ? 1 : -1;
    return [...shown].sort((a, b) => cmp(a[sort.key], b[sort.key]) * d);
  }, [shown, sort]);
  const onSort = (k: string) => setSort((s) => nextSort(s, k as HistKey));
  const pager = usePager(sorted, 50, `${q}|${from}|${to}|${sort.key}${sort.dir}`);

  //   들어오면 첫 칸에 커서 — 손이 바로 키보드에 있게(사장님 지시)
  useEffect(() => {
    if (tab === "edit" && !popup) setTimeout(() => ctl.focusDate(), 250);
  }, [tab, popup]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (!permLoading && !(isMaster || hasPerm(perm))) {
    return <AccessDenied detail={`${FORM_LABEL[formKey]} 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요.`} />;
  }

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ["inv-onhand", companyId] });
    qc.invalidateQueries({ queryKey: ["inv-moves", companyId] });
    qc.invalidateQueries({ queryKey: ["orders-list", companyId] });
    refetchHist();
  };

  const doSave = async (actionKey: string) => {
    const built = ctl.build();
    if (!built.ok) {
      toast(built.lines.length ? "일자와 품목·수량을 확인하세요" : "입력된 항목이 없습니다", "error");
      return;
    }
    setBusy(true);
    try {
      const msg = await onSave({ actionKey, built, ctl, editingId: ctl.editing?.id ?? null });
      toast(msg, "success");
      //   방금 저장한 전표가 조회 범위 밖이면 범위를 넓힌다 — 저장했는데 목록에 없으면 사라진 줄 안다
      if (built.date < from) setFrom(built.date);
      if (built.date > to) setTo(built.date);
      ctl.reset(); setPopup(false); invalidate();
      setTimeout(() => ctl.focusDate(), 200);
    } catch (e) { toast(friendlyError(e, "저장하지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };

  const openRow = async (id: string) => {
    setBusy(true);
    try { await onOpen({ id, ctl }); setPopup(true); }
    catch (e) { toast(friendlyError(e, "불러오지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };
  const closePopup = () => { setPopup(false); ctl.reset(); };

  //   입력 영역 — 갈래에서도 팝업에서도 **이것 하나**를 쓴다
  const editor = (
    <>
      <DocHead ctl={ctl} warehouses={warehouses} partners={partners} staff={staff} />
      {/*   A5 (2026-08-27) — 거래처를 고르면 지난번 거래 줄을 제안한다. 격자가 비어 있을 때만, 누르는 것은 사람 */}
      {ctl.lastLines && ctl.rowsBlank(ctl.rows) && (
        <div className="doc-suggest">
          <span>지난번({ctl.lastLines.doc_date}) 이 거래처와 <b>{ctl.lastLines.lines.length}줄</b> 거래했습니다 — 같은 품목·수량·단가로 채울까요? <em className="ev-dim">출처: 장부 대조</em></span>
          <button type="button" className="btn-secondary btn-sm" onClick={ctl.applyLastLines}>지난번 그대로 채우기</button>
          <button type="button" className="ht-note-act" onClick={ctl.dismissLastLines} aria-label="닫기">✕</button>
        </div>
      )}
      <DocGrid ctl={ctl} products={products} />
      <div className="doc-add">
        <button type="button" className="btn-secondary btn-sm"
          onClick={() => ctl.setRows((s) => [...s, blankRow()])}>+ 줄</button>
      </div>
    </>
  );

  //   ★ 엑셀 — 양식 내려받기·올리기·이력 내려받기를 한 버튼 안에(2026-08-27 사장님: 재고 입력은 전부 엑셀로)
  const xcols = importColumns(formKey);
  const label = FORM_LABEL[formKey];
  const excelMenu = (
    <ExcelMenu items={[
      //   2026-08-27 사장님: 양식·올리기가 같은 팝업이면 메뉴도 하나 — 팝업 안에서 양식을 내려받고 채운 파일을 올린다
      ...(onImport && canWrite ? [{ label: "양식 내려받기 · 올리기", hint: "양식을 받아 채운 뒤 올리면 읽어서 보여 주고, 등록을 눌러야 저장", onClick: () => setXlsOpen(true) }]
        : [{ label: "양식 내려받기", hint: `${label} 일괄 올리기 양식 — 머리줄·예시·안내 시트`, onClick: () => downloadTemplate(`${label}_양식`, label, xcols, formKey === "make" ? ["자재는 자재구성에 따라 저절로 나갑니다(양품+불량 기준). 실투입·로스는 올린 뒤 화면에서 고칩니다."] : []) }]),
      ...(tab === "list" ? [{ label: "이력 내려받기", count: shown.length, disabled: !shown.length, onClick: () => exportToExcel(sorted.map((h) => ({
        "번호": h.no, "일자": h.date, "거래처": h.who, "품목": h.label, "줄": h.lines, "합계": h.total, "상태": h.state,
      })), label, `${label}_이력_${from}_${to}`) }] : []),
    ]} />
  );
  const bySkuOrBarcode = (s: string) => { const q = s.trim().toUpperCase(); return products.find((p) => p.sku.toUpperCase() === q || (p.barcode && p.barcode === s.trim())) || null; };
  const parseImport = (row: ExcelRow, _i: number): { ok: ImportRow } | { error: string } => {
    if (!isDate(row.date)) return { error: `일자 '${row.date}' 는 YYYY-MM-DD 여야 합니다` };
    const p = bySkuOrBarcode(row.sku || "");
    if (!p) return { error: `SKU '${row.sku}' 품목이 없습니다` };
    const qty = xNum(row.qty) || 0, defect = xNum(row.defect) || 0;
    if (!(qty > 0) && !(formKey === "make" && defect > 0)) return { error: `${p.name}: 수량이 비었습니다` };
    let wh = warehouses.find((w) => w.name.trim() === (row.wh || "").trim()) || null;
    if (!wh && formKey === "order") wh = warehouses.find((w) => w.is_default) || warehouses[0] || null;
    if (!wh) return { error: `창고 '${row.wh}' 가 없습니다(재고 › 창고관리 이름과 같아야 합니다)` };
    const partnerName = (row.partner || "").trim();
    const partner = partnerName ? partners.find((x) => x.name.trim() === partnerName) || null : null;
    return { ok: { grp: (row.grp || "").trim(), date: row.date, partnerName, partnerId: partner?.id || null, warehouseId: wh.id, warehouseName: wh.name, due: row.due && isDate(row.due) ? row.due : "",
      sku: p.sku, name: p.name, product_id: p.id, qty, defect, unit_price: xNum(row.price), lnote: (row.lnote || "").trim(), note: (row.note || "").trim() } };
  };
  const groupImport = (rows: ImportRow[]): ImportDoc[] => {
    const docs = new Map<string, ImportDoc>();
    for (const r of rows) {
      const key = r.grp ? `g:${r.grp}` : `${r.date}|${r.partnerName}|${r.warehouseId}|${r.due}`;
      let d = docs.get(key);
      if (!d) { d = { date: r.date, partnerId: r.partnerId, partnerName: r.partnerName || null, warehouseId: r.warehouseId, due: r.due || null, note: r.note || null, lines: [] }; docs.set(key, d); }
      d.lines.push({ product_id: r.product_id, qty: r.qty, defect: r.defect, unit_price: r.unit_price, note: r.lnote || null });
    }
    return [...docs.values()];
  };

  //   실행 버튼 — 조회 줄 오른쪽에 모은다(조회 화면 표준). 파란 버튼은 화면에 하나뿐이다.
  const runButtons = canWrite ? (
    <>
      {pull?.(ctl)}
      {excelMenu}
      {tools
        ? <HelperMenu label="도구" items={[...tools(ctl), { label: "입력 항목", source: "양식", hint: "이 화면 격자에 어떤 칸을 둘지", onClick: ctl.openForm }]} />
        : <button type="button" className="btn-secondary btn-sm" onClick={ctl.openForm}>입력 항목</button>}
      {saveActions.map((a) => (
        <button key={a.key} type="button" title={a.hint}
          className={a.primary ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
          disabled={busy} onClick={() => doSave(a.key)}>{a.label}</button>
      ))}
    </>
  ) : undefined;

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs no-print">
            {([["edit", "입력"], ["list", "이력"]] as const).map(([k, l]) => (
              <button key={k} type="button" onClick={() => setTab(k)}
                className={tab === k ? "collect-tab collect-tab-on" : "collect-tab"}>
                {l}{k === "list" && hist.length > 0 && <span className="collect-tab-cnt">{hist.length}</span>}
              </button>
            ))}
          </div>

          {tab === "edit" && (
            <>
              <QueryBar right={runButtons}>{headNote}</QueryBar>
              <ResultStrip>
                <Stat label="줄" value={`${won(ctl.sums.lines)}개`} />
                <Stat label="공급가액" value={`₩${won(ctl.sums.supply)}`} />
                <Stat label="부가세" value={`₩${won(ctl.sums.vat)}`} />
                <Stat label="합계" value={`₩${won(ctl.sums.total)}`} />
                <span className="spv-toolbar-hint">
                  <b>Enter</b> 를 누르면 윗줄 값이 입력되고 다음 칸으로 이동합니다 · 마지막 칸에서 새 줄이 추가됩니다
                </span>
              </ResultStrip>
            </>
          )}

          {tab === "list" && (
            <>
              <QueryBar right={excelMenu}>
                <DateRangeField from={from} to={to} onChange={(f, t) => { setFrom(f); setTo(t); }} />
                <QuickSearch value={q} onApply={setQ} placeholder="번호 · 거래처 · 품목 — 쉼표로 여러 개, Enter" />
              </QueryBar>
              <ResultStrip>
                <Stat label="전표" value={`${won(shown.length)}건`} />
                <Stat label="합계" value={`₩${won(shown.reduce((n, h) => n + h.total, 0))}`} />
                <span className="spv-toolbar-hint">줄을 선택하면 <b>입력 화면</b>이 그대로 열려 수정할 수 있습니다</span>
              </ResultStrip>
            </>
          )}
        </QueryHead>

        <QueryBody>
          <div className="inv-scroll">
            {/*   ★ 입력 화면은 상자 끝까지 차지한다(2026-08-26 사장님: 5줄에서 칸이 끝나 가독성이 떨어짐). + 줄은 맨 아래 고정. */}
            {tab === "edit" ? <div className="doc-editor">{editor}</div> : (
              shown.length === 0 ? (
                <div className="collect-empty">
                  이 기간에 저장된 전표가 없습니다 — <b>입력</b> 탭에서 저장하면 여기에 표시됩니다.
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-doc-hist">
                    <thead><tr>
                      <SortableTh label="번호" sortKey="no" sort={sort} onSort={onSort} />
                      <SortableTh label="일자" sortKey="date" sort={sort} onSort={onSort} />
                      <SortableTh label="거래처" sortKey="who" sort={sort} onSort={onSort} />
                      <SortableTh label="품목" sortKey="label" sort={sort} onSort={onSort} />
                      <SortableTh label="줄" sortKey="lines" sort={sort} onSort={onSort} />
                      <SortableTh label="합계" sortKey="total" sort={sort} onSort={onSort} />
                      <SortableTh label="상태" sortKey="state" sort={sort} onSort={onSort} />
                    </tr></thead>
                    <tbody>
                      {pager.view.map((h) => (
                        <tr key={h.id} className="inv-row-click" onClick={() => openRow(h.id)}>
                          <td className="mono-number text-left"><b>{h.no}</b></td>
                          <td className="mono-number">{h.date}</td>
                          <td className="text-left">{h.who || "—"}</td>
                          <td className="text-left">{h.label}</td>
                          <td className="tr mono-number">{h.lines}</td>
                          <td className="tr mono-number">₩{won(h.total)}</td>
                          <td className="tc">
                            <span className={h.stateTone === "ok" ? "inv-pill inv-pill-ok"
                              : h.stateTone === "danger" ? "inv-pill inv-pill-danger" : "inv-pill inv-pill-warn"}>{h.state}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )
            )}
          </div>
        </QueryBody>

        {tab === "list" && shown.length > 0 && (
          <Pager page={pager.page} pages={pager.pages} total={shown.length} size={50}
            from={pager.from} to={pager.to} onPage={pager.setPage} />
        )}
      </QueryScreen>

      {/*   저장분 고치기 — 위와 **같은 입력 영역**을 담는다 */}
      {popup && (
        <div className="inv-modal" onClick={closePopup}>
          <div className="inv-modal-box doc-popup" onClick={(e) => e.stopPropagation()}>
            <div className="doc-popup-head">
              <div>
                <h3 className="inv-modal-title">{ctl.editing?.order_no || "전표"} 수정</h3>
                <p className="inv-modal-desc">{ctl.editing?.status === "cancelled" ? "취소된 전표입니다 — 보기만 할 수 있습니다." : "입력 화면과 같습니다 — 항목과 규칙이 동일합니다."}</p>
              </div>
              <button type="button" className="btn-secondary btn-sm" onClick={ctl.openForm}>입력 항목</button>
            </div>
            <div className="doc-popup-body">{editor}</div>
            <DocSums ctl={ctl} right={
              canWrite && ctl.editing?.status !== "cancelled" ? saveActions.map((a) => (
                <button key={a.key} type="button" className={a.primary ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                  disabled={busy} onClick={() => doSave(a.key)}>{a.label}</button>
              )) : null
            } />
            <div className="inv-modal-actions">
              {onDelete && canWrite && (
                <button type="button" className="btn-secondary btn-sm doc-del" disabled={busy}
                  onClick={async () => {
                    if (!(await appConfirm("이 전표를 삭제할까요?", { danger: true, confirmLabel: "삭제" }))) return;
                    setBusy(true);
                    try { await onDelete({ id: ctl.editing!.id, ctl }); toast("삭제했습니다", "success"); closePopup(); invalidate(); }
                    catch (e) { toast(friendlyError(e), "error"); }
                    finally { setBusy(false); }
                  }}>삭제</button>
              )}
              {onCancel && canWrite && ctl.editing?.status !== "cancelled" && (
                <button type="button" className="btn-secondary btn-sm doc-del" disabled={busy}
                  onClick={async () => {
                    //   지우지 않는다 — 누가 언제 왜 취소했는지가 남아야 한다(결정 25)
                    const reason = window.prompt("취소 사유를 적어 주세요 (전표는 지워지지 않고 취소로 남습니다)");
                    if (reason == null) return;
                    setBusy(true);
                    try { await onCancel({ id: ctl.editing!.id, ctl, reason }); toast("취소했습니다 — 재고가 되돌아갔습니다", "success"); closePopup(); invalidate(); }
                    catch (e) { toast(friendlyError(e), "error"); }
                    finally { setBusy(false); }
                  }}>취소</button>
              )}
              {onReturn && canWrite && ctl.editing?.status !== "cancelled" && (
                <button type="button" className="btn-secondary btn-sm" disabled={busy}
                  onClick={async () => {
                    if (!(await appConfirm("이 전표 전체를 반품 처리할까요? 반대 전표가 새로 만들어지고 재고가 되돌아갑니다.", { danger: true, confirmLabel: "반품" }))) return;
                    setBusy(true);
                    try { const m = await onReturn({ id: ctl.editing!.id, ctl }); toast(m, "success"); closePopup(); invalidate(); }
                    catch (e) { toast(friendlyError(e), "error"); }
                    finally { setBusy(false); }
                  }}>반품</button>
              )}
              {popupExtra?.({ ctl, products })}
              <span className="doc-sums-sp" />
              <button type="button" className="btn-secondary btn-sm" onClick={closePopup}>닫기</button>
            </div>
          </div>
        </div>
      )}

      <FormDialog ctl={ctl} />

      {xlsOpen && onImport && (

        <ExcelUploadDialog<ImportRow> title={label} cols={xcols} templateName={`${label}_양식`} sheetName={label}

          parse={parseImport} previewHead={["일자", "거래처", "창고", "SKU · 품목", formKey === "make" ? "양품" : "수량", ...(formKey === "make" ? ["불량"] : []), "단가", "묶음"]}

          previewRow={(r) => [r.date, r.partnerName || "—", r.warehouseName, `${r.sku} ${r.name}`, r.qty, ...(formKey === "make" ? [r.defect] : []), r.unit_price ?? "—", r.grp || "—"]}

          commit={async (rows) => { const docs = groupImport(rows); const msg = await onImport({ docs, ctl }); await refetchHist(); qc.invalidateQueries({ queryKey: ["inv-onhand", companyId] }); return msg; }}

          onClose={() => setXlsOpen(false)} />

      )}
    </div>
  );
}
