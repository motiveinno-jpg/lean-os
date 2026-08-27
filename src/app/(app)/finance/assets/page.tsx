"use client";

// ── 재무 › 고정자산 — 자산 등록 · 처분 · 월 감가상각 초안 (2026-08-27 ERP 공백 ⑤, 결정 65~69) ──
//   조회 화면 표준: 갈래 탭(사용 중/처분) · 조회 줄(빠른검색 ‖ 상각 초안 · + 등록) · 결과 요약 · 표 · 폼은 팝업.
//   상각 초안은 달마다 전표 하나(초안) → 확정은 재무 › 전표 현황 › 처리할 것. 누계는 확정된 것만.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useConfirm } from "@/components/confirm-dialog";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { todayKst } from "@/lib/kst";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, QuickSearch, quickSearchHit, Pager, usePager } from "@/components/query-kit";
import { SortableTh, nextSort, type SortState } from "@/components/sortable-th";
import { AccountPicker, type PickAcct } from "@/components/account-picker";
import { DateField } from "@/components/date-field";
import {
  listFixedAssets, upsertFixedAsset, disposeFixedAsset, undisposeFixedAsset, deleteFixedAsset, makeDepreciationDraftNow, listDepreciations,
  FA_CATEGORIES, faCategoryLabel, monthlyStraight, type FixedAsset, type FaCategory,
} from "@/lib/fixed-assets";

const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;
type SortKey = "name" | "category" | "acquired" | "cost" | "accum" | "book" | "monthly";
type Form = { id?: string; name: string; category: FaCategory; acquired_on: string; cost: string; salvage: string; useful_months: string; method: "straight" | "declining"; depr_start_month: string;
  asset_account_id: string | null; accum_account_id: string | null; expense_account_id: string | null; memo: string };
const emptyForm = (): Form => ({ name: "", category: "equipment", acquired_on: todayKst(), cost: "", salvage: "0", useful_months: "60", method: "straight", depr_start_month: todayKst().slice(0, 7), asset_account_id: null, accum_account_id: null, expense_account_id: null, memo: "" });

export default function FixedAssetsPage() {
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { setCompanyId(u?.company_id ?? null); setUserId(u?.id ?? null); }); }, []);
  const { toast } = useToast();
  const { confirm, confirmElement } = useConfirm();
  const qc = useQueryClient();
  const [tab, setTab] = useState<"active" | "disposed">("active");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "acquired", dir: "desc" });
  const onSort = (k: SortKey) => setSort((c) => nextSort(c, k, k === "name" || k === "category" ? "asc" : "desc"));
  const [form, setForm] = useState<Form | null>(null);
  const [busy, setBusy] = useState(false);
  const [dispose, setDispose] = useState<FixedAsset | null>(null);
  const [dOn, setDOn] = useState(todayKst()); const [dAmt, setDAmt] = useState("");
  const [hist, setHist] = useState<FixedAsset | null>(null);
  const [deprMonth, setDeprMonth] = useState(() => { const d = new Date(); d.setMonth(d.getMonth() - 1); return d.toISOString().slice(0, 7); });
  useModalKeys(!!form, () => setForm(null));
  useModalKeys(!!dispose, () => setDispose(null));
  useModalKeys(!!hist, () => setHist(null));

  const { data: rows = [], isLoading, refetch } = useQuery({ queryKey: ["fixed-assets", companyId], queryFn: () => listFixedAssets(companyId!), enabled: !!companyId });
  const { data: accounts = [] } = useQuery<PickAcct[]>({
    queryKey: ["fa-accounts", companyId],
    queryFn: async () => (logRead("fa:accounts", await supabase.from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId ?? "").order("code")) || []) as PickAcct[],
    enabled: !!companyId, staleTime: 300_000,
  });
  const { data: histRows = [] } = useQuery({ queryKey: ["fa-depr", hist?.id], queryFn: () => listDepreciations(hist!.id), enabled: !!hist });

  const monthlyOf = (a: FixedAsset) => a.method === "straight" ? monthlyStraight(a.cost, a.salvage, a.useful_months) : Math.round(Math.min(a.cost - a.salvage - a.accum, (a.cost - a.accum) * 2 / a.useful_months));
  const shown = useMemo(() => {
    const list = rows.filter((a) => a.status === tab && quickSearchHit(q, [a.name, faCategoryLabel(a.category), a.memo || ""], [a.cost]));
    const v = (a: FixedAsset): number | string => sort.key === "name" ? a.name : sort.key === "category" ? faCategoryLabel(a.category) : sort.key === "acquired" ? a.acquired_on : sort.key === "cost" ? a.cost : sort.key === "accum" ? a.accum : sort.key === "book" ? a.book : monthlyOf(a);
    return list.sort((x, y) => { const a = v(x), b = v(y); const c = typeof a === "number" && typeof b === "number" ? a - b : String(a).localeCompare(String(b), "ko"); return sort.dir === "asc" ? c : -c; });
  }, [rows, tab, q, sort]);   // eslint-disable-line react-hooks/exhaustive-deps
  const pager = usePager(shown, 50, `${tab}|${q}|${sort.key}${sort.dir}`);
  const active = rows.filter((a) => a.status === "active");
  const sums = { cost: active.reduce((n, a) => n + a.cost, 0), accum: active.reduce((n, a) => n + a.accum, 0), book: active.reduce((n, a) => n + a.book, 0), monthly: active.filter((a) => a.book - a.salvage > 0).reduce((n, a) => n + monthlyOf(a), 0) };

  if (!permLoading && !(isMaster || hasPerm("/finance/assets"))) return <AccessDenied detail="고정자산 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;

  const openNew = () => setForm(emptyForm());
  const openEdit = (a: FixedAsset) => setForm({ id: a.id, name: a.name, category: a.category, acquired_on: a.acquired_on, cost: String(a.cost), salvage: String(a.salvage), useful_months: String(a.useful_months), method: a.method, depr_start_month: a.depr_start_month, asset_account_id: a.asset_account_id, accum_account_id: a.accum_account_id, expense_account_id: a.expense_account_id, memo: a.memo || "" });
  const save = async () => {
    if (!form || !companyId || busy) return;
    const cost = Number(String(form.cost).replace(/[^0-9.]/g, "")), salvage = Number(String(form.salvage).replace(/[^0-9.]/g, "") || 0), months = Number(form.useful_months);
    if (!form.name.trim()) { toast("자산 이름을 넣으세요", "error"); return; }
    if (!(cost > 0)) { toast("취득가를 넣으세요", "error"); return; }
    if (salvage >= cost) { toast("잔존가는 취득가보다 작아야 합니다", "error"); return; }
    if (!(months > 0)) { toast("내용월수를 넣으세요(예: 60)", "error"); return; }
    if (!/^\d{4}-\d{2}$/.test(form.depr_start_month)) { toast("상각 시작 월(YYYY-MM)을 넣으세요", "error"); return; }
    setBusy(true);
    try {
      await upsertFixedAsset(companyId, userId, { id: form.id, name: form.name, category: form.category, acquired_on: form.acquired_on, cost, salvage, useful_months: months, method: form.method, depr_start_month: form.depr_start_month, asset_account_id: form.asset_account_id, accum_account_id: form.accum_account_id, expense_account_id: form.expense_account_id, memo: form.memo.trim() || null });
      toast(form.id ? "고쳤습니다" : "등록했습니다 — 취득 전표(차 자산 / 대 미지급금·보통예금)는 일반전표로 따로 칩니다", "success");
      setForm(null); refetch();
    } catch (e) { toast(friendlyError(e, "저장 실패"), "error"); }
    finally { setBusy(false); }
  };
  const doDispose = async () => {
    if (!dispose || busy) return;
    setBusy(true);
    try { await disposeFixedAsset(dispose.id, dOn, dAmt.trim() ? Number(dAmt.replace(/[^0-9.]/g, "")) : null); toast("처분으로 표시 — 상각이 멈춥니다. 처분 손익 전표는 일반전표로 치세요", "success"); setDispose(null); refetch(); }
    catch (e) { toast(friendlyError(e, "실패"), "error"); } finally { setBusy(false); }
  };
  const del = async (a: FixedAsset) => {
    if (a.accum > 0) { toast("확정된 상각이 있는 자산은 지울 수 없습니다 — 처분으로 표시하세요", "error"); return; }
    if (!(await confirm({ title: "자산 삭제", desc: `${a.name} 을(를) 지웁니다. 초안 상각 줄도 같이 지워집니다.`, danger: true })).ok) return;
    try { await deleteFixedAsset(a.id); toast("지웠습니다", "success"); refetch(); } catch (e) { toast(friendlyError(e, "삭제 실패"), "error"); }
  };
  const makeDraft = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const id = await makeDepreciationDraftNow(deprMonth);
      toast(id ? `${deprMonth} 감가상각 초안을 만들었습니다 — 재무 › 전표 현황 › 처리할 것에서 확정하세요` : `${deprMonth}에 상각할 자산이 없습니다(시작 월 이전이거나 다 상각됨)`, id ? "success" : "info");
      refetch(); qc.invalidateQueries({ queryKey: ["fin-status-entries"] });
    } catch (e) { toast(friendlyError(e), "error"); }
    finally { setBusy(false); }
  };
  const acctPick = (id: string | null) => id || "";

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs">
            <button type="button" className={tab === "active" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("active")}>사용 중<span className="collect-tab-cnt">{active.length}</span></button>
            <button type="button" className={tab === "disposed" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("disposed")}>처분<span className="collect-tab-cnt">{rows.length - active.length}</span></button>
          </div>
          <QueryBar right={<>
            <span className="fa-depr-row" title="그 달의 감가상각을 전표 초안 하나로 — 확정은 재무 › 전표 현황 › 처리할 것. 월 1일 새벽엔 지난달이 자동으로 생깁니다">
              <input type="month" className="inv-input fin-close-month" value={deprMonth} onChange={(e) => setDeprMonth(e.target.value)} />
              <button type="button" className="btn-secondary btn-sm" disabled={busy || !active.length} onClick={makeDraft}>상각 초안</button>
            </span>
            <button type="button" className="btn-primary btn-sm" onClick={openNew}>+ 자산 등록</button>
          </>}>
            <QuickSearch value={q} onApply={setQ} placeholder="자산명 · 분류 · 메모 · 금액 — 쉼표로 여러 개, Enter" />
          </QueryBar>
          <ResultStrip>
            <Stat label="사용 중" value={`${active.length}건`} />
            <Stat label="취득가 합계" value={won(sums.cost)} />
            <Stat label="확정 상각 누계" value={won(sums.accum)} />
            <Stat label="장부가" value={won(sums.book)} />
            <Stat label="월 상각 예상" value={won(sums.monthly)} />
          </ResultStrip>
        </QueryHead>
        <QueryBody>
          <div className="ev-scroll fa-scroll">
            {isLoading ? <div className="collect-empty">불러오는 중…</div> : shown.length === 0 ? (
              <div className="collect-empty">{tab === "active" ? <>등록된 고정자산이 없습니다 — <b>+ 자산 등록</b>으로 장비·차량·소프트웨어를 올리면 달마다 감가상각 초안이 생깁니다.</> : "처분한 자산이 없습니다"}</div>
            ) : (
              <table className="ev-table ev-lined table-fa">
                <thead><tr>
                  <SortableTh label="자산" sortKey="name" sort={sort} onSort={onSort} />
                  <SortableTh label="분류" sortKey="category" sort={sort} onSort={onSort} />
                  <SortableTh label="취득일" sortKey="acquired" sort={sort} onSort={onSort} />
                  <SortableTh label="취득가" sortKey="cost" sort={sort} onSort={onSort} />
                  <th>잔존가</th><th>내용월수</th><th>방법</th><th>상각 시작</th>
                  <SortableTh label="확정 누계" sortKey="accum" sort={sort} onSort={onSort} />
                  <SortableTh label="장부가" sortKey="book" sort={sort} onSort={onSort} />
                  <SortableTh label="월 상각" sortKey="monthly" sort={sort} onSort={onSort} />
                  <th>마지막 상각</th>{tab === "disposed" && <th>처분</th>}<th></th>
                </tr></thead>
                <tbody>{pager.view.map((a) => (
                  <tr key={a.id}>
                    <td className="text-left"><b>{a.name}</b>{a.memo && <span className="ev-dim"> · {a.memo}</span>}</td>
                    <td className="tc">{faCategoryLabel(a.category)}</td>
                    <td className="tc mono-number">{a.acquired_on}</td>
                    <td className="tr mono-number">{won(a.cost)}</td>
                    <td className="tr mono-number">{won(a.salvage)}</td>
                    <td className="tr mono-number">{a.useful_months}</td>
                    <td className="tc">{a.method === "straight" ? "정액" : "정률"}</td>
                    <td className="tc mono-number">{a.depr_start_month}</td>
                    <td className="tr mono-number">{won(a.accum)}{a.accumDraft > 0 && <span className="ev-dim" title="확정 전 초안"> (+{won(a.accumDraft)} 초안)</span>}</td>
                    <td className="tr mono-number"><b>{won(a.book)}</b></td>
                    <td className="tr mono-number">{a.status === "active" && a.book - a.salvage > 0 ? won(monthlyOf(a)) : <span className="ev-dim">—</span>}</td>
                    <td className="tc mono-number">{a.lastMonth || <span className="ev-dim">없음</span>}</td>
                    {tab === "disposed" && <td className="tc mono-number">{a.disposed_on}{a.disposal_amount != null ? ` · ${won(a.disposal_amount)}` : ""}</td>}
                    <td className="tc"><span className="bl-row-acts">
                      <button type="button" className="btn-secondary btn-sm" onClick={() => setHist(a)}>이력</button>
                      {a.status === "active" ? <>
                        <button type="button" className="btn-secondary btn-sm" onClick={() => openEdit(a)}>수정</button>
                        <button type="button" className="btn-secondary btn-sm" onClick={() => { setDispose(a); setDOn(todayKst()); setDAmt(""); }}>처분</button>
                        {a.accum === 0 && <button type="button" className="btn-secondary btn-sm" onClick={() => del(a)}>삭제</button>}
                      </> : <button type="button" className="btn-secondary btn-sm" onClick={async () => { try { await undisposeFixedAsset(a.id); refetch(); } catch (e) { toast(friendlyError(e), "error"); } }}>처분 취소</button>}
                    </span></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
          <Pager page={pager.page} pages={pager.pages} total={shown.length} size={50} from={pager.from} to={pager.to} onPage={pager.setPage} />
        </QueryBody>
      </QueryScreen>

      {form && (
        <div className="inv-modal" onClick={() => setForm(null)}>
          <div className="inv-modal-box inv-modal-wide bl-box" onClick={(e) => e.stopPropagation()}>
            <div className="inv-modal-head"><h3>{form.id ? "자산 수정" : "자산 등록"}</h3><button type="button" className="inv-modal-x" onClick={() => setForm(null)}>✕</button></div>
            <p className="inv-modal-desc">등록하면 <b>상각 시작 월</b>부터 달마다 감가상각 전표 초안이 생깁니다(확정은 사람). 취득 자체의 전표(차) 자산 / 대) 미지급금·보통예금)는 통장 줄 처리나 일반전표로 따로 칩니다. 계정을 비우면 분류 기본 계정({FA_CATEGORIES.find((c) => c.value === form.category)?.codes})을 씁니다.</p>
            <div className="bl-form">
              <label>자산 이름 <input className="inv-input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="예: 맥북 프로 16 · 포터2 · 어도비 CC" autoFocus /></label>
              <label>분류
                <select className="inv-input" value={form.category} onChange={(e) => { const c = e.target.value as FaCategory; setForm({ ...form, category: c, useful_months: form.id ? form.useful_months : String(FA_CATEGORIES.find((x) => x.value === c)?.months || 60) }); }}>
                  {FA_CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label} — 기본 {c.months}개월</option>)}
                </select>
              </label>
              <label>취득일 <DateField value={form.acquired_on} onChange={(e: any) => setForm({ ...form, acquired_on: e.target.value })} className="inv-input" /></label>
              <label>상각 시작 월 <input type="month" className="inv-input" value={form.depr_start_month} onChange={(e) => setForm({ ...form, depr_start_month: e.target.value })} /></label>
              <label>취득가 <input className="inv-input mono-number tr" value={form.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} placeholder="부가세 제외" /></label>
              <label>잔존가 <input className="inv-input mono-number tr" value={form.salvage} onChange={(e) => setForm({ ...form, salvage: e.target.value })} /></label>
              <label>내용월수 <input className="inv-input mono-number tr" value={form.useful_months} onChange={(e) => setForm({ ...form, useful_months: e.target.value })} placeholder="60 = 5년" /></label>
              <label>상각 방법
                <select className="inv-input" value={form.method} onChange={(e) => setForm({ ...form, method: e.target.value as "straight" | "declining" })}>
                  <option value="straight">정액 — (취득가 − 잔존가) ÷ 내용월수</option>
                  <option value="declining">정률(이중체감) — 장부가 × 2 ÷ 내용월수</option>
                </select>
              </label>
              <label>자산 계정 (선택) <AccountPicker accounts={accounts.filter((a) => a.account_type === "asset")} value={acctPick(form.asset_account_id)} onChange={(id) => setForm({ ...form, asset_account_id: id || null })} placeholder="비우면 분류 기본" /></label>
              <label>누계액 계정 (선택) <AccountPicker accounts={accounts.filter((a) => a.account_type === "asset")} value={acctPick(form.accum_account_id)} onChange={(id) => setForm({ ...form, accum_account_id: id || null })} placeholder="비우면 분류 기본" /></label>
              <label>상각비 계정 (선택) <AccountPicker accounts={accounts.filter((a) => a.account_type === "expense")} value={acctPick(form.expense_account_id)} onChange={(id) => setForm({ ...form, expense_account_id: id || null })} placeholder="비우면 감가상각비" /></label>
              <label>메모 <input className="inv-input" value={form.memo} onChange={(e) => setForm({ ...form, memo: e.target.value })} /></label>
            </div>
            <p className="inv-hint">월 상각 미리보기: <b className="mono-number">{won(monthlyStraight(Number(String(form.cost).replace(/[^0-9.]/g, "")) || 0, Number(String(form.salvage).replace(/[^0-9.]/g, "")) || 0, Number(form.useful_months) || 0))}</b>{form.method === "declining" && " (정률은 첫 달 기준 그 2배 안팎, 점점 줄어듦)"}</p>
            <div className="inv-modal-actions"><span className="doc-sums-sp" /><button type="button" className="btn-secondary btn-sm" onClick={() => setForm(null)}>닫기</button><button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>{form.id ? "저장" : "등록"}</button></div>
          </div>
        </div>
      )}
      {dispose && (
        <div className="inv-modal" onClick={() => setDispose(null)}>
          <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="inv-modal-head"><h3>처분 — {dispose.name}</h3><button type="button" className="inv-modal-x" onClick={() => setDispose(null)}>✕</button></div>
            <p className="inv-modal-desc">장부가 {won(dispose.book)} · 확정 누계 {won(dispose.accum)}. 처분으로 표시하면 그 달부터 상각이 멈춥니다. 처분 손익 전표(매각가·누계액·처분손익)는 <Link href="/partners/reconciliation/voucher-entry" className="bz-link">일반전표</Link>로 직접 칩니다 — 매각가·부가세가 얽혀 자동으로 만들지 않습니다.</p>
            <div className="bl-form">
              <label>처분일 <DateField value={dOn} onChange={(e: any) => setDOn(e.target.value)} className="inv-input" /></label>
              <label>처분 금액 (선택) <input className="inv-input mono-number tr" value={dAmt} onChange={(e) => setDAmt(e.target.value)} placeholder="매각가 · 폐기면 비움" /></label>
            </div>
            <div className="inv-modal-actions"><span className="doc-sums-sp" /><button type="button" className="btn-secondary btn-sm" onClick={() => setDispose(null)}>닫기</button><button type="button" className="btn-primary btn-sm" disabled={busy} onClick={doDispose}>처분 표시</button></div>
          </div>
        </div>
      )}
      {hist && (
        <div className="inv-modal" onClick={() => setHist(null)}>
          <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="inv-modal-head"><h3>상각 이력 — {hist.name}</h3><button type="button" className="inv-modal-x" onClick={() => setHist(null)}>✕</button></div>
            <p className="inv-modal-desc">취득가 {won(hist.cost)} · 잔존가 {won(hist.salvage)} · {hist.useful_months}개월 {hist.method === "straight" ? "정액" : "정률"} · 확정 누계 {won(hist.accum)} · 장부가 {won(hist.book)}</p>
            <div className="stg-table-wrap cs-scroll">
              <table className="ev-table ev-lined table-inv-status-sm">
                <thead><tr><th>월</th><th>상각액</th><th>상태</th></tr></thead>
                <tbody>{histRows.map((r) => <tr key={`${r.month}-${r.entryId}`}><td className="tc mono-number">{r.month}</td><td className="tr mono-number">{won(r.amount)}</td><td className="tc">{r.status === "confirmed" ? <span className="inv-pill inv-pill-ok">확정</span> : r.status === "rejected" ? <span className="inv-pill inv-pill-danger">반려</span> : <span className="inv-pill inv-pill-warn">초안</span>}</td></tr>)}
                  {!histRows.length && <tr><td colSpan={3} className="tc ev-dim">아직 상각 초안이 없습니다 — 조회 줄의 '상각 초안'으로 만듭니다</td></tr>}</tbody>
              </table>
            </div>
            <div className="inv-modal-actions"><span className="doc-sums-sp" /><button type="button" className="btn-secondary btn-sm" onClick={() => setHist(null)}>닫기</button></div>
          </div>
        </div>
      )}
      {confirmElement}
    </div>
  );
}
