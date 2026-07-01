"use client";

// 회계마감시점 + 계정별/거래처별 기초잔액 설정 (2026-07-01, 차변/대변 + 그룹 접기)
//   마감일 이전 자료는 수집(세금계산서/통장/카드)에서 제외 → 오래된 자료로 프로그램이 무거워지는 것 방지.
//   기초잔액: 계정과목(chart_of_accounts)을 자산/부채/자본/수익/비용 그룹으로 접어서 표시.
//     · 계정명/계정번호 검색 · 각 계정에 차변/대변 금액 직접 입력(클릭·이동 최소화)
//     · 계정별 인라인 '거래처별' 확장 → 통장·카드·등록거래처로 세분화(차변/대변)
//   세무자동화(tax) 탭에서 렌더.

import { useEffect, useMemo, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { DateField } from "@/components/date-field";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { getBankAccounts } from "@/lib/queries";
import { getChartOfAccounts, type ChartOfAccount } from "@/lib/ledger";
import { getCorporateCards } from "@/lib/card-transactions";
import { getPartners } from "@/lib/partners";
import {
  getAccountingClosing, saveAccountingClosing, computeSyncFloor,
  lineDebit, lineCredit, openingDebit, openingCredit,
  PARTY_TYPE_LABEL, ACCOUNT_TYPE_LABEL, ACCOUNT_TYPE_ORDER,
  type OpeningLine, type OpeningParty, type PartyType, type AccountType,
} from "@/lib/accounting-closing";

const uid = () => crypto.randomUUID();
const newParty = (patch: Partial<OpeningParty> = {}): OpeningParty =>
  ({ id: uid(), party_type: "manual", party_id: null, name: "", debit: 0, credit: 0, ...patch });
const parseNum = (s: string) => Number(s.replace(/[^0-9-]/g, "").replace(/(?!^)-/g, "")) || 0;
const fmtNum = (n: number) => (n ? n.toLocaleString("ko-KR") : "");

export function AccountingClosingTab({ companyId }: { companyId: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const enabled = !!companyId;

  const { data: closing } = useQuery({ queryKey: ["accounting-closing", companyId], queryFn: () => getAccountingClosing(companyId!), enabled });
  const { data: coa = [] } = useQuery({ queryKey: ["coa", companyId], queryFn: () => getChartOfAccounts(companyId!), enabled });
  const { data: banks = [] } = useQuery({ queryKey: ["bank-accounts", companyId], queryFn: () => getBankAccounts(companyId!), enabled });
  const { data: cards = [] } = useQuery({ queryKey: ["corporate-cards", companyId], queryFn: () => getCorporateCards(companyId!), enabled });
  const { data: partners = [] } = useQuery({ queryKey: ["partners-min", companyId], queryFn: () => getPartners(companyId!), enabled });

  const [closingDate, setClosingDate] = useState("");
  const [note, setNote] = useState("");
  const [search, setSearch] = useState("");
  const [byKey, setByKey] = useState<Record<string, OpeningLine>>({});
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (closing) {
      setClosingDate(closing.closing_date ?? "");
      setNote(closing.note ?? "");
      const map: Record<string, OpeningLine> = {};
      const openInit: Record<string, boolean> = {};
      for (const l of closing.opening_lines ?? []) {
        map[l.account_id ?? l.id] = l;
        if (l.account_type) openInit[l.account_type] = true; // 값 있는 그룹은 펼쳐서
      }
      setByKey(map);
      setOpenGroups(openInit);
    }
  }, [closing]);

  const partyGroups = useMemo(() => ({
    bank: (banks as any[]).map((b) => ({ key: `bank:${b.id}`, party_type: "bank" as PartyType, party_id: b.id, name: (b.alias || b.bank_name || "통장").trim() })),
    card: (cards as any[]).map((c) => ({ key: `card:${c.id}`, party_type: "card" as PartyType, party_id: c.id, name: (c.card_name || c.card_company || "카드").trim() })),
    partner: (partners as any[]).map((p) => ({ key: `partner:${p.id}`, party_type: "partner" as PartyType, party_id: p.id, name: (p.name || "거래처").trim() })),
  }), [banks, cards, partners]);
  const findPartyOption = (k: string) => [...partyGroups.bank, ...partyGroups.card, ...partyGroups.partner].find((o) => o.key === k) ?? null;

  const coaFiltered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = coa as ChartOfAccount[];
    if (!q) return list;
    return list.filter((a) => a.code?.toLowerCase().includes(q) || a.name?.toLowerCase().includes(q));
  }, [coa, search]);

  const setLine = (key: string, updater: (l: OpeningLine) => OpeningLine) => setByKey((prev) => ({ ...prev, [key]: updater(prev[key]) }));
  const lineFrom = (prev: Record<string, OpeningLine>, acc: ChartOfAccount): OpeningLine =>
    prev[acc.id] ?? { id: uid(), account_id: acc.id, code: acc.code, name: acc.name, account_type: acc.account_type as AccountType, mode: "account", debit: 0, credit: 0, parties: [] };
  const setDC = (acc: ChartOfAccount, field: "debit" | "credit", val: number) =>
    setByKey((prev) => ({ ...prev, [acc.id]: { ...lineFrom(prev, acc), mode: "account", [field]: val } }));
  const toggleParty = (acc: ChartOfAccount) =>
    setByKey((prev) => { const l = lineFrom(prev, acc); const mode = l.mode === "party" ? "account" : "party"; return { ...prev, [acc.id]: { ...l, mode, parties: mode === "party" && l.parties.length === 0 ? [newParty()] : l.parties } }; });

  const patchParty = (key: string, pid: string, patch: Partial<OpeningParty>) => setLine(key, (l) => ({ ...l, parties: l.parties.map((p) => (p.id === pid ? { ...p, ...patch } : p)) }));
  const addParty = (key: string) => setLine(key, (l) => ({ ...l, parties: [...l.parties, newParty()] }));
  const removeParty = (key: string, pid: string) => setLine(key, (l) => ({ ...l, parties: l.parties.filter((p) => p.id !== pid) }));
  const pickParty = (key: string, pid: string, sel: string) => {
    if (sel === "manual") { patchParty(key, pid, { party_type: "manual", party_id: null, name: "" }); return; }
    const o = findPartyOption(sel); if (o) patchParty(key, pid, { party_type: o.party_type, party_id: o.party_id, name: o.name });
  };

  const addManual = () => { const l: OpeningLine = { id: uid(), account_id: null, code: "", name: "", account_type: null, mode: "account", debit: 0, credit: 0, parties: [] }; setByKey((p) => ({ ...p, [l.id]: l })); };
  const removeKey = (key: string) => setByKey((p) => { const n = { ...p }; delete n[key]; return n; });
  const manualLines = useMemo(() => Object.values(byKey).filter((l) => !l.account_id), [byKey]);

  const saveMut = useMutation({
    mutationFn: () => saveAccountingClosing(companyId!, null, { closing_date: closingDate || null, opening_lines: Object.values(byKey), note: note.trim() || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounting-closing", companyId] }); toast("회계마감 설정이 저장되었습니다. 다음 수집부터 마감일 이전 자료는 제외됩니다.", "success"); },
    onError: (e: any) => toast("저장 실패: " + friendlyError(e, "알 수 없는 오류"), "error"),
  });

  const floor = computeSyncFloor(closingDate || null);
  const allLines = Object.values(byKey);
  const totalDebit = openingDebit(allLines);
  const totalCredit = openingCredit(allLines);
  const balanced = Math.abs(totalDebit - totalCredit) < 0.001;
  const hasCoa = (coa as ChartOfAccount[]).length > 0;

  // 거래처별 하위행 (차변/대변)
  const renderParties = (key: string, l: OpeningLine) => (
    <div className="mt-2 pl-2 sm:pl-6 space-y-1.5 border-l-2 border-[var(--border)]/60">
      {l.parties.length === 0 && <div className="text-[11px] text-[var(--text-dim)]">거래처를 추가하세요 (통장·카드·등록거래처).</div>}
      {l.parties.map((pt) => (
        <div key={pt.id} className="flex flex-wrap sm:flex-nowrap items-center gap-1.5">
          <select value={pt.party_id ? `${pt.party_type}:${pt.party_id}` : "manual"} onChange={(e) => pickParty(key, pt.id, e.target.value)}
            className="w-36 h-8 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs">
            <optgroup label={PARTY_TYPE_LABEL.bank}>{partyGroups.bank.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</optgroup>
            <optgroup label={PARTY_TYPE_LABEL.card}>{partyGroups.card.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</optgroup>
            <optgroup label={PARTY_TYPE_LABEL.partner}>{partyGroups.partner.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</optgroup>
            <option value="manual">직접입력…</option>
          </select>
          {pt.party_type === "manual" && (
            <input value={pt.name} onChange={(e) => patchParty(key, pt.id, { name: e.target.value })} placeholder="거래처명" className="flex-1 min-w-[80px] h-8 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs" />
          )}
          <input type="text" inputMode="numeric" value={fmtNum(pt.debit)} onChange={(e) => patchParty(key, pt.id, { debit: parseNum(e.target.value) })} placeholder="차변"
            className="w-24 h-8 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-right ml-auto" />
          <input type="text" inputMode="numeric" value={fmtNum(pt.credit)} onChange={(e) => patchParty(key, pt.id, { credit: parseNum(e.target.value) })} placeholder="대변"
            className="w-24 h-8 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-right" />
          <button onClick={() => removeParty(key, pt.id)} className="w-5 h-8 flex items-center justify-center text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded text-xs" aria-label="거래처 삭제">×</button>
        </div>
      ))}
      <button onClick={() => addParty(key)} className="text-[11px] text-[var(--primary)] hover:text-[var(--text)] font-semibold">+ 거래처 추가</button>
    </div>
  );

  const accountRow = (acc: ChartOfAccount) => {
    const l = byKey[acc.id];
    const isParty = l?.mode === "party";
    const d = l ? lineDebit(l) : 0, c = l ? lineCredit(l) : 0;
    return (
      <div key={acc.id} className={`px-3 py-2 ${(d || c) ? "bg-[var(--primary)]/5" : ""}`}>
        <div className="flex items-center gap-2">
          <span className="w-12 shrink-0 text-[11px] text-[var(--text-dim)] mono-number">{acc.code}</span>
          <span className="flex-1 min-w-0 text-sm text-[var(--text)] truncate">{acc.name}</span>
          <button onClick={() => toggleParty(acc)} title="거래처별로 나눠 입력"
            className={`text-[10px] px-1.5 py-1 rounded whitespace-nowrap ${isParty ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:bg-[var(--bg-surface)] border border-[var(--border)]"}`}>거래처별</button>
          {isParty ? (
            <>
              <span className="w-24 h-8 flex items-center justify-end px-2 text-sm text-[var(--text-muted)] mono-number">{fmtNum(d) || "0"}</span>
              <span className="w-24 h-8 flex items-center justify-end px-2 text-sm text-[var(--text-muted)] mono-number">{fmtNum(c) || "0"}</span>
            </>
          ) : (
            <>
              <input type="text" inputMode="numeric" value={fmtNum(l?.debit ?? 0)} onChange={(e) => setDC(acc, "debit", parseNum(e.target.value))} placeholder="차변"
                className="w-24 h-8 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-right focus:outline-none focus:border-[var(--primary)]" />
              <input type="text" inputMode="numeric" value={fmtNum(l?.credit ?? 0)} onChange={(e) => setDC(acc, "credit", parseNum(e.target.value))} placeholder="대변"
                className="w-24 h-8 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-right focus:outline-none focus:border-[var(--primary)]" />
            </>
          )}
        </div>
        {isParty && l && renderParties(acc.id, l)}
      </div>
    );
  };

  return (
    <div className="glass-card p-6 space-y-4">
      <div>
        <h2 className="text-sm font-bold">회계 마감시점 · 계정별 기초잔액</h2>
        <p className="text-xs text-[var(--text-dim)] mt-0.5">
          결산을 끝낸 시점을 지정하면 그 이전의 세금계산서·통장·카드 자료를 다시 불러오지 않습니다. 오래된 자료 수집을 막아 화면이 가벼워집니다.
        </p>
      </div>

      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1.5">회계 마감일 (이 날짜까지 결산 완료)</label>
        <DateField value={closingDate} onChange={(e) => setClosingDate(e.target.value)}
          className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
        <p className="text-[10px] text-[var(--text-dim)] mt-1">비워두면 마감일 없음 — 이 경우 최대 <b>2년 전</b>까지만 수집합니다.</p>
      </div>

      {/* 계정별 기초잔액 — 유형별 그룹 접기 + 검색 + 차변/대변 */}
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-2">마감시점 기초잔액 (계정별 · 거래처별 · 차변/대변)</label>

        {hasCoa ? (
          <>
            <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="계정명 또는 계정번호로 검색 (예: 보통예금, 1039)"
              className="w-full h-9 px-3 mb-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm focus:outline-none focus:border-[var(--primary)]" />

            {/* 컬럼 헤더 */}
            <div className="flex items-center gap-2 px-3 pb-1 text-[10px] text-[var(--text-dim)]">
              <span className="w-12 shrink-0">코드</span>
              <span className="flex-1">계정명</span>
              <span className="w-24 text-right">차변</span>
              <span className="w-24 text-right">대변</span>
            </div>

            <div className="rounded-xl border border-[var(--border)] divide-y divide-[var(--border)]/50 max-h-[460px] overflow-y-auto">
              {ACCOUNT_TYPE_ORDER.map((type) => {
                const accts = coaFiltered.filter((a) => (a.account_type as AccountType) === type);
                if (accts.length === 0) return null;
                const isOpen = search.trim() ? true : (openGroups[type] ?? false);
                const gd = accts.reduce((s, a) => s + (byKey[a.id] ? lineDebit(byKey[a.id]) : 0), 0);
                const gc = accts.reduce((s, a) => s + (byKey[a.id] ? lineCredit(byKey[a.id]) : 0), 0);
                return (
                  <div key={type}>
                    <button onClick={() => setOpenGroups((o) => ({ ...o, [type]: !isOpen }))}
                      className="w-full flex items-center gap-2 px-3 py-2 bg-[var(--bg-surface)] hover:bg-[var(--bg-surface)]/70 text-left">
                      <span className={`text-[var(--text-dim)] text-xs transition-transform ${isOpen ? "rotate-90" : ""}`}>▶</span>
                      <span className="text-sm font-bold text-[var(--text)]">{ACCOUNT_TYPE_LABEL[type]}</span>
                      <span className="text-[10px] text-[var(--text-dim)]">{accts.length}개 계정</span>
                      <span className="ml-auto text-[11px] text-[var(--text-muted)] mono-number">차 {fmtNum(gd) || "0"} · 대 {fmtNum(gc) || "0"}</span>
                    </button>
                    {isOpen && <div className="divide-y divide-[var(--border)]/40">{accts.map(accountRow)}</div>}
                  </div>
                );
              })}
              {coaFiltered.length === 0 && <div className="px-3 py-6 text-center text-xs text-[var(--text-dim)]">검색 결과가 없습니다.</div>}
            </div>
          </>
        ) : (
          <div className="text-[11px] text-amber-500 mb-2">계정과목이 없어 계정명을 직접 입력합니다. (회계 원장에 계정과목을 등록하면 그룹·검색 목록으로 바뀝니다.)</div>
        )}

        {/* 직접 입력 계정 (비-COA) */}
        {manualLines.length > 0 && (
          <div className="mt-2 space-y-1.5">
            {manualLines.map((l) => (
              <div key={l.id} className="rounded-xl border border-dashed border-[var(--border)] p-2.5">
                <div className="flex items-center gap-2">
                  <input value={l.name} onChange={(e) => setLine(l.id, (x) => ({ ...x, name: e.target.value }))} placeholder="계정명 직접입력"
                    className="flex-1 min-w-[120px] h-8 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm" />
                  <button onClick={() => setLine(l.id, (x) => ({ ...x, mode: x.mode === "party" ? "account" : "party", parties: x.mode !== "party" && x.parties.length === 0 ? [newParty()] : x.parties }))}
                    className={`text-[10px] px-1.5 py-1 rounded ${l.mode === "party" ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] border border-[var(--border)]"}`}>거래처별</button>
                  {l.mode === "party" ? (
                    <>
                      <span className="w-24 h-8 flex items-center justify-end px-2 text-sm text-[var(--text-muted)] mono-number">{fmtNum(lineDebit(l)) || "0"}</span>
                      <span className="w-24 h-8 flex items-center justify-end px-2 text-sm text-[var(--text-muted)] mono-number">{fmtNum(lineCredit(l)) || "0"}</span>
                    </>
                  ) : (
                    <>
                      <input type="text" inputMode="numeric" value={fmtNum(l.debit)} onChange={(e) => setLine(l.id, (x) => ({ ...x, debit: parseNum(e.target.value) }))} placeholder="차변" className="w-24 h-8 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-right" />
                      <input type="text" inputMode="numeric" value={fmtNum(l.credit)} onChange={(e) => setLine(l.id, (x) => ({ ...x, credit: parseNum(e.target.value) }))} placeholder="대변" className="w-24 h-8 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-right" />
                    </>
                  )}
                  <button onClick={() => removeKey(l.id)} className="w-5 h-8 flex items-center justify-center text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded text-xs" aria-label="계정 삭제">×</button>
                </div>
                {l.mode === "party" && renderParties(l.id, l)}
              </div>
            ))}
          </div>
        )}
        <button onClick={addManual} className="mt-2 text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold">+ 목록에 없는 계정 직접 추가</button>

        {/* 차변/대변 합계 + 균형 */}
        <div className="mt-3 flex items-center justify-between p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
          <span className="text-xs text-[var(--text-muted)]">차변 합계 / 대변 합계</span>
          <span className="text-sm font-bold mono-number">
            <span className="text-[var(--text)]">{fmtNum(totalDebit) || "0"}</span>
            <span className="text-[var(--text-dim)]"> / </span>
            <span className="text-[var(--text)]">{fmtNum(totalCredit) || "0"}</span>
            <span className={`ml-2 text-[11px] ${balanced ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{balanced ? "✓ 일치" : `차이 ${fmtNum(Math.abs(totalDebit - totalCredit))}`}</span>
          </span>
        </div>
      </div>

      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-1.5">메모 (선택)</label>
        <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="예: 2025년 재무제표 기준 마감"
          className="w-full px-4 py-3 bg-[var(--bg)] border border-[var(--border)] rounded-xl text-sm focus:outline-none focus:border-[var(--primary)]" />
      </div>

      <div className="p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text-muted)]">
        현재 데이터 수집 하한: <b className="text-[var(--text)] mono-number">{floor}</b> — 이 날짜 이전 자료는 수집하지 않습니다.
      </div>

      <button onClick={() => companyId && saveMut.mutate()} disabled={!companyId || saveMut.isPending}
        className="w-full py-3 bg-[var(--primary)] hover:bg-[var(--primary-hover)] text-white rounded-xl text-sm font-semibold transition disabled:opacity-50">
        {saveMut.isPending ? "저장 중..." : "저장"}
      </button>
    </div>
  );
}
