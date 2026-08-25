"use client";

// ── 재고 — 전표 화면 껍데기 (2026-08-25 사장님 지시) ───────────────────────────
//   주문서·판매·구매·생산이 이것 하나를 같이 쓴다. 다른 것은 **저장하면 무엇이 되는가**뿐이다.
//   ★ 들어가면 **입력이 먼저** 뜬다(사장님 지시) — 치려고 들어오는 일이 훨씬 많다. 커서도 첫 칸에 간다.
//   ★ 이력에서 줄을 누르면 **치던 그 화면이 그대로** 팝업으로 뜬다.
//     수정 전용 화면을 따로 만들지 않는다 — 만들면 칸·규칙이 둘로 갈라져 곧 어긋난다.

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
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, Pager, usePager, QuickSearch, quickSearchHit,
} from "@/components/query-kit";
import { DateRangeField } from "@/components/date-range-field";
import { listProducts, listWarehouses, type Product, type Warehouse } from "@/lib/inventory";
import { FORM_LABEL, type FormKey } from "@/lib/inventory-orders";
import {
  useDocEditor, DocHead, DocGrid, DocSums, FormDialog, blankRow, docWon as won,
  type DocCtl, type Partner,
} from "./doc-editor";

export type SaveAction = { key: string; label: string; primary?: boolean; hint?: string };

/** 이력 한 줄 — 무엇을 보여줄지는 화면마다 다르지만 모양은 같다. */
export type HistRow = {
  id: string; no: string; date: string; who: string; label: string;
  lines: number; total: number; state: string; stateTone?: "ok" | "warn" | "danger";
};

export function DocScreen({
  formKey, perm, saveActions, onSave, history, onOpen, onDelete, pull, headNote,
}: {
  formKey: FormKey;
  perm: string;
  saveActions: SaveAction[];
  /** 저장 — 어떤 갈래로 눌렀는지(actionKey)와 빚은 값을 받는다. 고치는 중이면 editingId 가 온다. */
  onSave: (a: { actionKey: string; built: ReturnType<DocCtl["build"]>; ctl: DocCtl; editingId: string | null }) => Promise<string>;
  history: (a: { companyId: string; from: string; to: string }) => Promise<HistRow[]>;
  onOpen: (a: { id: string; ctl: DocCtl }) => Promise<void>;
  onDelete?: (a: { id: string; ctl: DocCtl }) => Promise<void>;
  /** 주문서에서 줄을 불러오는 버튼을 둘지 */
  pull?: (ctl: DocCtl) => React.ReactNode;
  headNote?: React.ReactNode;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { setCompanyId(u?.company_id ?? null); setUserId(u?.id ?? null); }); }, []);

  const [tab, setTab] = useState<"edit" | "list">("edit");
  const [q, setQ] = useState("");
  const [from, setFrom] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 10); });
  const [to, setTo] = useState(todayKst);
  const [busy, setBusy] = useState(false);
  const [popup, setPopup] = useState(false);

  const canWrite = isMaster || hasPerm(perm);

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
  const pager = usePager(shown, 50, `${q}|${from}|${to}`);

  //   들어오면 첫 칸에 커서 — 손이 바로 키보드에 있게(사장님 지시)
  useEffect(() => {
    if (tab === "edit" && !popup) setTimeout(() => ctl.focusCell(0, ctl.cells[0]), 250);
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
      ctl.reset(); setPopup(false); invalidate();
      setTimeout(() => ctl.focusCell(0, ctl.cells[0]), 200);
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
      <DocGrid ctl={ctl} products={products} />
      <div className="doc-add">
        <button type="button" className="btn-secondary btn-sm"
          onClick={() => ctl.setRows((s) => [...s, blankRow()])}>+ 줄</button>
      </div>
    </>
  );

  //   실행 버튼 — 조회 줄 오른쪽에 모은다(조회 화면 표준). 파란 버튼은 화면에 하나뿐이다.
  const runButtons = canWrite ? (
    <>
      {pull?.(ctl)}
      <button type="button" className="btn-secondary btn-sm" onClick={ctl.openForm}>입력 항목</button>
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
              <QueryBar>
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
            {tab === "edit" ? editor : (
              shown.length === 0 ? (
                <div className="collect-empty">
                  이 기간에 저장된 전표가 없습니다 — <b>입력</b> 탭에서 저장하면 여기에 표시됩니다.
                </div>
              ) : (
                <div className="stg-table-wrap">
                  <table className="ev-table ev-lined table-doc-hist">
                    <thead><tr><th>번호</th><th>일자</th><th>거래처</th><th>품목</th><th>줄</th><th>합계</th><th>상태</th></tr></thead>
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
                <p className="inv-modal-desc">입력 화면과 같습니다 — 항목과 규칙이 동일합니다.</p>
              </div>
              <button type="button" className="btn-secondary btn-sm" onClick={ctl.openForm}>입력 항목</button>
            </div>
            <div className="doc-popup-body">{editor}</div>
            <DocSums ctl={ctl} right={
              canWrite ? saveActions.map((a) => (
                <button key={a.key} type="button" className={a.primary ? "btn-primary btn-sm" : "btn-secondary btn-sm"}
                  disabled={busy} onClick={() => doSave(a.key)}>{a.label}</button>
              )) : null
            } />
            <div className="inv-modal-actions">
              {onDelete && canWrite && (
                <button type="button" className="btn-secondary btn-sm doc-del" disabled={busy}
                  onClick={async () => {
                    if (!window.confirm("이 전표를 삭제할까요?")) return;
                    setBusy(true);
                    try { await onDelete({ id: ctl.editing!.id, ctl }); toast("삭제했습니다", "success"); closePopup(); invalidate(); }
                    catch (e) { toast(friendlyError(e), "error"); }
                    finally { setBusy(false); }
                  }}>삭제</button>
              )}
              <span className="doc-sums-sp" />
              <button type="button" className="btn-secondary btn-sm" onClick={closePopup}>닫기</button>
            </div>
          </div>
        </div>
      )}

      <FormDialog ctl={ctl} />
    </div>
  );
}
