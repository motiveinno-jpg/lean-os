"use client";

// ── 업무 › 계약 대장 (2026-09-18, docs/20260917_PLAN_menu_gap_audit.md 결정 2-2단계) ──
//   계약 문서(documents 의 content_type/auto_classified_type = contract)의 기간·금액을 한 표로.
//   갈래 탭: 진행 중 / 만료 임박(60일) / 종료 / 기간 미입력 — 경계값 기획대로
//   무기한(시작만 있고 종료 없음)은 진행 중에 두되 '무기한'으로 표시, 이미 만료는 종료로 분리.
//   기간 미입력 줄은 여기서 바로 채운다(결정 2: 소급 입력은 강제하지 않고 대장에서 채우게 한다).
//   저장은 문서함과 같은 saveRevision — 이력이 남고, 컬럼 동기화(contractColumnsOf)도 같은 길을 탄다.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getCurrentUser } from "@/lib/queries";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { addDaysStr, todayKst } from "@/lib/kst";
import { saveRevision } from "@/lib/documents";
import { DateField } from "@/components/date-field";
import { QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, QuickSearch, quickSearchHit, Pager, usePager } from "@/components/query-kit";
import { SortableTh, nextSort, cmp, type SortState } from "@/components/sortable-th";

const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;
//   만료 임박 기준 — 종료일까지 60일. 분기 계약(90일)도 놓치지 않게 한 달보다 길게 잡는다.
const SOON_DAYS = 60;

type Row = {
  id: string; name: string; deal_id: string | null; partner_id: string | null;
  contract_start_date: string | null; contract_end_date: string | null; contract_amount: number | null;
  amount: number | null; status: string | null; created_at: string; content_json: any;
  /** 정기 청구(2026-09-21) — 매월 며칠(31=말일)·월 청구액. 대시보드 다가오는 일정·자금 전망이 읽는다 */
  billing_day: number | null; billing_amount: number | null;
  partners: { name: string } | null; deals: { name: string } | null;
};
type Tab = "all" | "active" | "expiring" | "ended" | "none";
type SortKey = "name" | "partner" | "deal" | "amount" | "start" | "end" | "billing";

//   상태 분류 — 경계값: 종료일 과거(만료)와 종료일 없음(무기한·미입력)을 가른다
function bucketOf(r: Row, today: string): Exclude<Tab, "all"> {
  const s = r.contract_start_date, e = r.contract_end_date;
  if (!s && !e) return "none";
  if (e && e < today) return "ended";
  if (e && e <= addDaysStr(today, SOON_DAYS)) return "expiring";
  return "active"; // 종료일이 멀거나, 시작만 있는 무기한
}
const dDay = (end: string, today: string) => Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86400000);

export default function ContractLedgerPage() {
  const { isMaster, hasMenu, loading: permLoading } = useMyPermissions();
  const [companyId, setCompanyId] = useState<string | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { setCompanyId(u?.company_id ?? null); setUserId(u?.id ?? null); }); }, []);
  const { toast } = useToast();
  const qc = useQueryClient();
  const today = todayKst();

  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState<SortState<SortKey>>({ key: "end", dir: "asc" });
  //   기간 미입력 줄의 인라인 입력값 — 문서 id 별로 따로 든다
  const [draft, setDraft] = useState<Record<string, { start: string; end: string }>>({});
  const [savingId, setSavingId] = useState<string | null>(null);
  //   정기 청구 조건 팝업 — 줄이 밀리지 않게 팝업(조회 화면 표준). 31 = 말일
  const [billFor, setBillFor] = useState<Row | null>(null);
  const [billDraft, setBillDraft] = useState<{ day: string; amount: string }>({ day: "", amount: "" });
  const openBilling = (r: Row) => { setBillFor(r); setBillDraft({ day: r.billing_day ? String(r.billing_day) : "", amount: r.billing_amount ? String(r.billing_amount) : "" }); };
  const saveBilling = async () => {
    if (!billFor) return;
    const day = billDraft.day ? Number(billDraft.day) : null;
    const amount = billDraft.amount ? Number(String(billDraft.amount).replace(/[^0-9]/g, "")) : null;
    if ((day && !amount) || (!day && amount)) { toast("청구일과 금액을 함께 넣어 주세요. 둘 다 비우면 정기 청구를 지웁니다.", "error"); return; }
    setSavingId(billFor.id);
    try {
      const { error } = await supabase.from("documents").update({ billing_day: day, billing_amount: amount } as never).eq("id", billFor.id);
      if (error) throw error;
      toast(day ? `매월 ${day === 31 ? "말일" : `${day}일`} ${won(amount!)} 청구로 저장했습니다. 다가오는 일정과 자금 전망에 반영됩니다.` : "정기 청구를 지웠습니다.", "success");
      setBillFor(null);
      qc.invalidateQueries({ queryKey: ["contract-ledger", companyId] });
      qc.invalidateQueries({ queryKey: ["upcoming-schedule"] });
    } catch (e: any) {
      toast(friendlyError(e, "저장하지 못했습니다."), "error");
    } finally { setSavingId(null); }
  };

  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["contract-ledger", companyId],
    enabled: !!companyId,
    queryFn: async () => {
      const data = logRead("contracts:ledger", await supabase
        .from("documents")
        .select("id, name, deal_id, partner_id, contract_start_date, contract_end_date, contract_amount, amount, status, created_at, content_json, billing_day, billing_amount, partners(name), deals(name)")
        .eq("company_id", companyId!)
        .or("content_type.eq.contract,auto_classified_type.eq.contract")
        .order("created_at", { ascending: false })
        .limit(2000));
      return (data || []) as unknown as Row[];
    },
  });

  const counts = useMemo(() => {
    const c = { all: rows.length, active: 0, expiring: 0, ended: 0, none: 0 };
    rows.forEach((r) => { c[bucketOf(r, today)] += 1; });
    return c;
  }, [rows, today]);

  const partnerName = (r: Row) => r.partners?.name || r.content_json?.header?.partnerName || null;
  const amountOf = (r: Row) => r.contract_amount ?? r.amount ?? null;

  const filtered = useMemo(() => {
    let list = tab === "all" ? rows : rows.filter((r) => bucketOf(r, today) === tab);
    if (q) list = list.filter((r) => quickSearchHit(q, [r.name, partnerName(r), r.deals?.name], [amountOf(r) || 0]));
    const dir = sort.dir === "asc" ? 1 : -1;
    const key = (r: Row): unknown => sort.key === "name" ? r.name
      : sort.key === "partner" ? partnerName(r)
      : sort.key === "deal" ? r.deals?.name
      : sort.key === "amount" ? amountOf(r)
      : sort.key === "start" ? r.contract_start_date
      : sort.key === "billing" ? (r.billing_day ? r.billing_amount || 0 : -1)
      : r.contract_end_date;
    return [...list].sort((a, b) => cmp(key(a), key(b)) * dir);
  }, [rows, tab, q, sort, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const sums = useMemo(() => ({
    amount: filtered.reduce((s, r) => s + (amountOf(r) || 0), 0),
    //   정기 청구 월 합계 — 종료된 계약은 뺀다(대시보드·자금 전망과 같은 기준)
    billing: filtered.reduce((s, r) => s + (r.billing_day && bucketOf(r, today) !== "ended" ? (r.billing_amount || 0) : 0), 0),
    billingN: filtered.filter((r) => r.billing_day && bucketOf(r, today) !== "ended").length,
  }), [filtered, today]); // eslint-disable-line react-hooks/exhaustive-deps

  const pager = usePager(filtered, 50, `${tab}|${q}`);
  const onSort = (k: SortKey) => setSort((cur) => nextSort(cur, k));

  //   기간 채우기 — saveRevision 하나로 이력·컬럼 동기화까지 (다른 저장 경로를 만들지 않는다)
  const savePeriod = async (r: Row) => {
    const d = draft[r.id];
    if (!userId || !d || (!d.start && !d.end)) return;
    if (d.start && d.end && d.end < d.start) { toast("종료일이 시작일보다 빠릅니다.", "error"); return; }
    setSavingId(r.id);
    try {
      await saveRevision({
        documentId: r.id, authorId: userId,
        contentJson: { ...(r.content_json || {}), contractStart: d.start || "", contractEnd: d.end || "" },
        comment: "계약 대장에서 기간 입력",
      });
      toast("계약 기간을 저장했습니다.", "success");
      qc.invalidateQueries({ queryKey: ["contract-ledger", companyId] });
    } catch (e: any) {
      toast(friendlyError(e, "저장하지 못했습니다."), "error");
    } finally { setSavingId(null); }
  };

  if (permLoading) return null;
  if (!isMaster && !hasMenu("/contracts")) return <AccessDenied />;

  const TABS: { key: Tab; label: string }[] = [
    { key: "all", label: "전체" }, { key: "active", label: "진행 중" },
    { key: "expiring", label: "만료 임박" }, { key: "ended", label: "종료" }, { key: "none", label: "기간 미입력" },
  ];

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs" role="tablist" aria-label="계약 상태">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key}
                className={tab === t.key ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab(t.key)}>
                {t.label}<span className="collect-tab-cnt">{counts[t.key]}</span>
              </button>
            ))}
          </div>
          <QueryBar right={<span className="text-[11px] text-[var(--text-dim)]">{filtered.length}건</span>}>
            <QuickSearch value={q} onApply={setQ} placeholder="계약명 · 거래처 · 프로젝트 · 금액 · 쉼표로 여러 개, Enter" />
          </QueryBar>
          <ResultStrip>
            <Stat label="표시" value={`${filtered.length}건`} />
            <Stat label="계약금액 합계" value={won(sums.amount)} />
            <Stat label="만료 임박" value={`${counts.expiring}건`} />
            <Stat label="정기 청구" title="청구 조건이 있는 진행 중 계약 · 월 합계" value={sums.billingN ? `${sums.billingN}건 · 월 ${won(sums.billing)}` : "—"} />
            <Stat label="기간 미입력" value={`${counts.none}건`} />
          </ResultStrip>
        </QueryHead>
        <QueryBody>
          <div className="ev-scroll clg-scroll">
            {isLoading ? <div className="collect-empty">불러오는 중…</div> : pager.view.length === 0 ? (
              <div className="collect-empty">
                {tab === "none" ? "기간이 비어 있는 계약이 없습니다."
                  : rows.length === 0 ? <>아직 계약 문서가 없습니다. 프로젝트의 <b>견적 → 계약</b> 흐름이나 문서함에서 계약서를 만들면 여기에 모입니다.</>
                  : "이 상태의 계약이 없습니다."}
              </div>
            ) : (
              <table className="ev-table ev-lined table-clg">
                <thead><tr>
                  <SortableTh label="계약명" sortKey="name" sort={sort} onSort={onSort} />
                  <SortableTh label="거래처" sortKey="partner" sort={sort} onSort={onSort} />
                  <SortableTh label="프로젝트" sortKey="deal" sort={sort} onSort={onSort} />
                  <SortableTh label="계약금액" sortKey="amount" sort={sort} onSort={onSort} />
                  <SortableTh label="시작일" sortKey="start" sort={sort} onSort={onSort} />
                  <SortableTh label="종료일" sortKey="end" sort={sort} onSort={onSort} />
                  <SortableTh label="정기 청구" sortKey="billing" sort={sort} onSort={onSort} title="매월 청구일·금액 · 적어 두면 그날 대시보드 다가오는 일정에 오르고 자금 전망에 매출 입금으로 반영됩니다" />
                  <th>상태</th>
                </tr></thead>
                <tbody>{pager.view.map((r) => {
                  const bucket = bucketOf(r, today);
                  const d = draft[r.id] || { start: r.contract_start_date || "", end: r.contract_end_date || "" };
                  const editable = bucket === "none";
                  return (
                    <tr key={r.id}>
                      <td className="text-left"><b>{r.name}</b></td>
                      <td className="tc">{partnerName(r) || <span className="ev-dim">—</span>}</td>
                      <td className="tc">{r.deal_id ? <Link className="clg-deal-link" href={`/projecthub/${r.deal_id}`}>{r.deals?.name || "프로젝트"}</Link> : <span className="ev-dim">—</span>}</td>
                      <td className="tr mono-number">{amountOf(r) != null ? won(amountOf(r)!) : <span className="ev-dim">—</span>}</td>
                      {editable ? (
                        <>
                          <td className="tc"><DateField value={d.start} onChange={(e) => setDraft((p) => ({ ...p, [r.id]: { ...d, start: e.target.value } }))} /></td>
                          <td className="tc"><DateField value={d.end} onChange={(e) => setDraft((p) => ({ ...p, [r.id]: { ...d, end: e.target.value } }))} /></td>
                          <td className="tc"><span className="ev-dim">기간부터</span></td>
                          <td className="tc">
                            <button type="button" className="btn-secondary btn-sm" disabled={savingId === r.id || (!draft[r.id]?.start && !draft[r.id]?.end)} onClick={() => savePeriod(r)}>
                              {savingId === r.id ? "저장 중…" : "기간 저장"}
                            </button>
                          </td>
                        </>
                      ) : (
                        <>
                          <td className="tc mono-number">{r.contract_start_date || <span className="ev-dim">—</span>}</td>
                          <td className="tc mono-number">{r.contract_end_date || <span className="ev-dim">무기한</span>}</td>
                          <td className="tc">
                            {bucket === "ended" ? (r.billing_day ? <span className="ev-dim">매월 {r.billing_day === 31 ? "말일" : `${r.billing_day}일`} · 종료</span> : <span className="ev-dim">—</span>)
                              : <button type="button" className="clg-billing-btn" onClick={() => openBilling(r)} title="청구일·금액 정하기">
                                  {r.billing_day ? <>매월 {r.billing_day === 31 ? "말일" : `${r.billing_day}일`} · <span className="mono-number">{won(r.billing_amount || 0)}</span></> : <span className="ev-dim">＋ 청구 조건</span>}
                                </button>}
                          </td>
                          <td className="tc">
                            {bucket === "ended" && <span className="clg-chip clg-chip-end">종료</span>}
                            {bucket === "expiring" && <span className="clg-chip clg-chip-warn">D-{dDay(r.contract_end_date!, today)}</span>}
                            {bucket === "active" && (r.contract_end_date
                              ? <span className="clg-chip">진행 중</span>
                              : <span className="clg-chip clg-chip-open">무기한</span>)}
                          </td>
                        </>
                      )}
                    </tr>
                  );
                })}</tbody>
              </table>
            )}
          </div>
          <Pager page={pager.page} pages={pager.pages} total={filtered.length} from={pager.from} to={pager.to} size={50} onPage={pager.setPage} />
        </QueryBody>
        {/* 정기 청구 조건 팝업 */}
        {billFor && (
          <div className="clg-bill-modal" onClick={() => setBillFor(null)}>
            <div className="modal-backdrop" />
            <div className="clg-bill-panel modal-panel" onClick={(e) => e.stopPropagation()}>
              <div className="clg-bill-head">
                <div>
                  <h3 className="text-sm font-bold text-[var(--text)]">정기 청구 — {billFor.name}</h3>
                  <p className="text-[11px] text-[var(--text-dim)] mt-0.5">매월 같은 날 청구하는 계약이면 적어 두세요. 그날 대시보드 다가오는 일정에 오르고, 자금 전망에 매출 입금(확정)으로 잡힙니다. 세금계산서는 자동으로 발행하지 않습니다.</p>
                </div>
                <button type="button" className="btn-secondary btn-sm" onClick={() => setBillFor(null)}>닫기</button>
              </div>
              <div className="clg-bill-body">
                <label className="inv-field"><span>청구일 (매월)</span>
                  <select className="field-input" value={billDraft.day} onChange={(e) => setBillDraft((d) => ({ ...d, day: e.target.value }))}>
                    <option value="">없음</option>
                    {Array.from({ length: 30 }, (_, i) => i + 1).map((d) => <option key={d} value={String(d)}>{d}일</option>)}
                    <option value="31">말일</option>
                  </select></label>
                <label className="inv-field"><span>월 청구액 (원)</span>
                  <input className="field-input" inputMode="numeric" placeholder="예: 1200000" value={billDraft.amount} onChange={(e) => setBillDraft((d) => ({ ...d, amount: e.target.value.replace(/[^0-9]/g, "") }))} /></label>
              </div>
              <div className="clg-bill-foot">
                <span className="text-[11px] text-[var(--text-dim)]">계약 기간({billFor.contract_start_date || "시작 미입력"} ~ {billFor.contract_end_date || "무기한"}) 안에서만 돕니다.</span>
                <button type="button" className="btn-primary btn-sm" disabled={savingId === billFor.id} onClick={saveBilling}>{savingId === billFor.id ? "저장 중…" : "저장"}</button>
              </div>
            </div>
          </div>
        )}
      </QueryScreen>
    </div>
  );
}
