"use client";
import { appConfirm } from "@/components/global-confirm";
import { logRead } from "@/lib/log-read";

// 계정과목 관리 — 회사 설정 (2026-07-01)
//   회사 회계 계정과목 마스터를 한 곳에서 조회·관리. 기본(시스템) 계정은 읽기전용,
//   회사 자체 계정(is_system=false)만 추가/삭제. 거래매칭 직접입력·전표에서 이 계정을 사용.

import { useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ConditionPanel, ConditionRow, ChipGroup, AppliedChips,
  QuickSearch, quickSearchHit, ResultStrip, Stat, RowsPerPage, Pager, usePager, type AppliedChip,
} from "@/components/query-kit";
import { SortableTh, nextSort, cmp, useColWidths, useColFilters, type SortState } from "@/components/sortable-th";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { STANDARD_ACCOUNTS } from "@/lib/standard-accounts";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

type Acct = { id: string; code: string; name: string; account_type: string; is_system: boolean };
type NewAcct = { code: string; name: string; type: string };

const TYPES: { v: string; l: string }[] = [
  { v: "asset", l: "자산" }, { v: "liability", l: "부채" }, { v: "equity", l: "자본" },
  { v: "revenue", l: "수익" }, { v: "expense", l: "비용" },
];

type CoaCond = { src: "" | "system" | "custom"; rows: number };
const COA_EMPTY: CoaCond = { src: "", rows: 100 };
type CoaSort = "code" | "name" | "type";

export function ChartOfAccountsManager({ companyId }: { companyId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const [newAcct, setNewAcct] = useState<NewAcct | null>(null);
  const [busy, setBusy] = useState(false);
  //   표준이 474개로 늘어난 2026-08-12 부터는 검색 없이 못 찾는다 (그전엔 ~90개라 눈으로 훑었다)
  const [q, setQ] = useState("");

  const { data: accounts = [] } = useQuery<Acct[]>({
    queryKey: ["coa-manage", companyId],
    queryFn: async () => {
      const data = logRead('components/chart-of-accounts-manager:data', await db.from("chart_of_accounts").select("id, code, name, account_type, is_system").eq("company_id", companyId).order("code"));
      return (data || []) as Acct[];
    },
    enabled: !!companyId,
  });
  const refresh = () => qc.invalidateQueries({ queryKey: ["coa-manage", companyId] });

  const add = async () => {
    if (!newAcct || !newAcct.code.trim() || !newAcct.name.trim()) { toast("코드와 계정명을 입력하세요", "error"); return; }
    setBusy(true);
    try {
      const { error } = await db.from("chart_of_accounts").insert({ company_id: companyId, code: newAcct.code.trim(), name: newAcct.name.trim(), account_type: newAcct.type, is_system: false });
      if (error) throw error;
      toast("계정과목을 추가했습니다", "success"); setNewAcct(null); refresh();
    } catch (e: any) { toast("추가 실패: " + (e?.message || (e?.code === "23505" ? "이미 있는 코드입니다" : "")), "error"); }
    finally { setBusy(false); }
  };
  // 표준 계정과목 일괄 채우기 — 이미 있는 코드는 건너뛰고 없는 것만 추가 (unique(company_id, code))
  const fillStandard = async () => {
    setBusy(true);
    try {
      const existing = new Set((accounts as Acct[]).map((a) => a.code));
      const missing = STANDARD_ACCOUNTS.filter((s) => !existing.has(s.code));
      if (missing.length === 0) { toast("이미 모든 표준 계정이 등록되어 있습니다", "info"); return; }
      const { error } = await db.from("chart_of_accounts").upsert(
        missing.map((s) => ({ company_id: companyId, code: s.code, name: s.name, account_type: s.type, is_system: false })),
        { onConflict: "company_id,code", ignoreDuplicates: true },
      );
      if (error) throw error;
      toast(`표준 계정 ${missing.length}개를 추가했습니다`, "success"); refresh();
    } catch (e: any) { toast("채우기 실패: " + (e?.message || ""), "error"); }
    finally { setBusy(false); }
  };

  const remove = async (a: Acct) => {
    if (a.is_system) return;
    if (!(await appConfirm(`'${a.code} ${a.name}' 계정과목을 삭제할까요?`, { danger: true }))) return;
    try { const { error } = await db.from("chart_of_accounts").delete().eq("id", a.id); if (error) throw error; toast("삭제했습니다", "info"); refresh(); }
    catch (e: any) { toast("삭제 실패: " + (e?.message || ""), "error"); }
  };

  //   코드·계정명 아무 쪽으로나 찾는다 ("831" 도 "수수료" 도) — 빠른검색(쉼표=또는, Enter)
  //   2026-08-18 조회 표준: [검색조건(출처·줄 수) ▾] 빠른검색 · 구분 칩 ‖ 표준 채우기 · + 추가 → 결과 요약 → 표(정렬·≡·너비) → 쪽
  const [panelOpen, setPanelOpen] = useState(false);
  const [typeKey, setTypeKey] = useState<string>("all");
  const [draft, setDraft] = useState<CoaCond>(COA_EMPTY);
  const [live, setLive] = useState<CoaCond>(COA_EMPTY);
  const [sort, setSort] = useState<SortState<CoaSort>>({ key: "code", dir: "asc" });
  const onSort = (k: CoaSort) => setSort((c) => nextSort(c, k));
  const cf = useColFilters();
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths("coa-colw-v1", { code: 90, name: 320, type: 100, src: 90, action: 100 });
  const thResize = (k: string, colIndex: number) => ({ k, colIndex, widths: colW, onResize: setColW, tableRef });
  const typeLabel = (v: string) => TYPES.find((t) => t.v === v)?.l || v;
  const colVal = (a: Acct) => ({ type: typeLabel(a.account_type), src: a.is_system ? "기본" : "자체" });
  const base = useMemo(() => (accounts as Acct[]).filter((a) =>
    (typeKey === "all" || a.account_type === typeKey)
    && (live.src === "" || (live.src === "system" ? a.is_system : !a.is_system))
    && quickSearchHit(q, [a.code, a.name, typeLabel(a.account_type)])),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [accounts, typeKey, live, q]);
  const cfSpec = (k: keyof ReturnType<typeof colVal>) => cf.spec(k, base.map((a) => colVal(a)[k]));
  const shown = useMemo(() => {
    const dir = sort.dir === "asc" ? 1 : -1;
    const val = (a: Acct) => sort.key === "name" ? a.name : sort.key === "type" ? String(TYPES.findIndex((t) => t.v === a.account_type)) : a.code;
    return base.filter((a) => cf.hit(colVal(a))).sort((x, y) => cmp(val(x), val(y)) * dir || cmp(x.code, y.code));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, sort, cf.key]);
  const pager = usePager(shown, live.rows, `${typeKey}|${q}|${JSON.stringify(live)}|${cf.key}`);
  const typeCounts = TYPES.map((t) => ({ ...t, n: (accounts as Acct[]).filter((a) => a.account_type === t.v).length }));
  const chips: AppliedChip[] = [
    ...(q ? [{ group: "빠른검색", label: q, onRemove: () => setQ("") }] : []),
    ...(live.src ? [{ group: "출처", label: live.src === "system" ? "기본" : "자체", onRemove: () => { const n = { ...live, src: "" as const }; setLive(n); setDraft(n); } }] : []),
    ...cf.active.map((a) => ({ group: "칸 필터", label: `${a.k === "type" ? "구분" : "출처"} ${a.n}개`, onRemove: () => cf.clear(a.k) })),
  ];
  const clearAll = () => { setQ(""); setLive(COA_EMPTY); setDraft(COA_EMPTY); cf.clear(); setTypeKey("all"); };

  return (
    <div className="coa-screen">
    <QueryScreen>
      <QueryHead>
        <QueryBar right={<>
          <button onClick={fillStandard} disabled={busy} className="btn-secondary btn-sm whitespace-nowrap">{busy ? "추가 중…" : "표준 계정과목 채우기"}</button>
          <button onClick={() => setNewAcct({ code: "", name: "", type: "asset" })} className="btn-primary btn-sm whitespace-nowrap">+ 계정과목 추가</button>
        </>}>
          <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen} activeCount={live.src ? 1 : 0}
            foot={<>
              <button type="button" className="btn-secondary btn-sm" disabled={!draft.src} onClick={() => setDraft({ ...COA_EMPTY, rows: draft.rows })}>조건 지우기</button>
              <span className="ml-auto" />
              <RowsPerPage value={draft.rows} onChange={(n) => setDraft((c) => ({ ...c, rows: n }))} />
              <button type="button" className="btn-primary btn-sm" onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
            </>}>
            <ConditionRow label="출처" hint="기본 = 읽기전용 · 자체 = 회사가 추가">
              <ChipGroup value={draft.src} onChange={(v) => setDraft((c) => ({ ...c, src: v }))}
                options={[{ value: "", label: "전체" }, { value: "system", label: "기본" }, { value: "custom", label: "자체" }] as const} />
            </ConditionRow>
          </ConditionPanel>
          <QuickSearch value={q} onApply={setQ} placeholder="코드 · 계정명 · 구분 (예: 831, 지급수수료) — 쉼표로 여러 개, Enter" />
          <ChipGroup value={typeKey} onChange={setTypeKey}
            options={[{ value: "all", label: `전체 ${(accounts as Acct[]).length}` }, ...typeCounts.map((t) => ({ value: t.v, label: t.n > 0 ? `${t.l} ${t.n}` : t.l }))]} />
        </QueryBar>
        <AppliedChips chips={chips} onClearAll={clearAll} />
        <ResultStrip right={<span className="text-[11px] text-[var(--text-dim)]">표시 <b className="mono-number">{shown.length}</b>개</span>}>
          <Stat label="계정과목" value={`${(accounts as Acct[]).length}개`} />
          <Stat label="자체 추가" value={`${(accounts as Acct[]).filter((a) => !a.is_system).length}개`} />
          <span className="text-[11px] text-[var(--text-dim)]">기본 계정은 읽기전용 · 표준 {STANDARD_ACCOUNTS.length}개를 한 번에 채울 수 있습니다 (거래매칭 직접입력·전표 처리에서 사용)</span>
        </ResultStrip>
      </QueryHead>

      <QueryBody>
        <div className="ev-scroll">
          {newAcct && (
            <div className="coa-new-row">
              <input value={newAcct.code} onChange={(e) => setNewAcct({ ...newAcct, code: e.target.value })} placeholder="코드 (예: 176)" className="w-28 h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text)]" />
              <input value={newAcct.name} onChange={(e) => setNewAcct({ ...newAcct, name: e.target.value })} placeholder="계정명 (예: 임차보증금)" className="flex-1 min-w-[140px] h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text)]" />
              <select value={newAcct.type} onChange={(e) => setNewAcct({ ...newAcct, type: e.target.value })} className="h-8 px-2 rounded bg-[var(--bg)] border border-[var(--border)] text-xs text-[var(--text)]">
                {TYPES.map((t) => <option key={t.v} value={t.v}>{t.l}</option>)}
              </select>
              <button onClick={add} disabled={busy} className="px-3 h-8 text-xs font-semibold rounded bg-[var(--primary)] text-white disabled:opacity-50">추가</button>
              <button onClick={() => setNewAcct(null)} className="px-2 h-8 text-xs text-[var(--text-muted)]">취소</button>
            </div>
          )}
          {(accounts as Acct[]).length === 0 ? (
            <div className="collect-empty">계정과목이 없습니다. <b>“표준 계정과목 채우기”</b>로 기본 계정을 불러오거나 직접 추가해 보세요.</div>
          ) : shown.length === 0 ? (
            <div className="collect-empty">이 조건에 맞는 계정과목이 없습니다 — 검색조건을 풀어 보세요</div>
          ) : (
            <table ref={tableRef} className="ev-table ev-lined coa-table">
              <thead>
                <tr>
                  <SortableTh label="코드" sortKey="code" sort={sort} onSort={onSort} resize={thResize("code", 1)} />
                  <SortableTh label="계정명" sortKey="name" sort={sort} onSort={onSort} resize={thResize("name", 2)} />
                  <SortableTh label="구분" sortKey="type" sort={sort} onSort={onSort} filter={cfSpec("type")} resize={thResize("type", 3)} />
                  <SortableTh label="출처" filter={cfSpec("src")} resize={thResize("src", 4)} />
                  <SortableTh label="관리" resize={thResize("action", 5)} />
                </tr>
              </thead>
              <tbody>
                {pager.view.map((a) => (
                  <tr key={a.id}>
                    <td className="text-center mono-number text-[var(--text-muted)]">{a.code}</td>
                    <td className="text-left">{a.name}</td>
                    <td className="text-center">{typeLabel(a.account_type)}</td>
                    <td className="text-center">
                      {a.is_system
                        ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)]">기본</span>
                        : <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)]">자체</span>}
                    </td>
                    <td className="text-center">
                      {!a.is_system && <button onClick={() => remove(a)} className="text-xs px-2 py-0.5 rounded text-[var(--danger)] hover:bg-[var(--danger)]/10">삭제</button>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </QueryBody>
      <Pager page={pager.page} pages={pager.pages} total={shown.length} size={live.rows}
        from={pager.from} to={pager.to} onPage={pager.setPage} />
    </QueryScreen>
    </div>
  );
}
