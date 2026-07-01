"use client";

// 회계마감시점 + 계정별/거래처별 기초잔액 설정 (2026-07-01)
//   마감일 이전 자료는 수집(세금계산서/통장/카드)에서 제외 → 오래된 자료로 프로그램이 무거워지는 것 방지.
//   기초잔액: 계정과목(chart_of_accounts) 선택 → 집계구분(계정별/거래처별) → 거래처별은 통장·카드·등록거래처로 세분화.
//   금액은 부호 있는 단일 값(자산 +, 부채 −). 세무자동화(tax) 탭에서 렌더.

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
  getAccountingClosing, saveAccountingClosing, computeSyncFloor, lineAmount, openingTotal,
  PARTY_TYPE_LABEL, type OpeningLine, type OpeningParty, type PartyType, type AccountType,
} from "@/lib/accounting-closing";

const uid = () => crypto.randomUUID();
const newParty = (patch: Partial<OpeningParty> = {}): OpeningParty =>
  ({ id: uid(), party_type: "manual", party_id: null, name: "", amount: 0, ...patch });
const newLine = (): OpeningLine =>
  ({ id: uid(), account_id: null, code: "", name: "", account_type: null, mode: "account", amount: 0, parties: [] });

// 부호 허용 숫자 입력 파서/표시
const parseNum = (s: string) => Number(s.replace(/[^0-9-]/g, "").replace(/(?!^)-/g, "")) || 0;
const fmtNum = (n: number) => (n ? n.toLocaleString("ko-KR") : "");

interface PartyOption { key: string; party_type: PartyType; party_id: string; name: string }

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
  const [lines, setLines] = useState<OpeningLine[]>([]);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (closing) {
      setClosingDate(closing.closing_date ?? "");
      setLines(closing.opening_lines ?? []);
      setNote(closing.note ?? "");
    }
  }, [closing]);

  // 거래처 선택 옵션 (통장/카드/거래처 그룹)
  const partyGroups = useMemo(() => ({
    bank: (banks as any[]).map((b) => ({ key: `bank:${b.id}`, party_type: "bank" as PartyType, party_id: b.id, name: (b.alias || b.bank_name || "통장").trim() })),
    card: (cards as any[]).map((c) => ({ key: `card:${c.id}`, party_type: "card" as PartyType, party_id: c.id, name: (c.card_name || c.card_company || "카드").trim() })),
    partner: (partners as any[]).map((p) => ({ key: `partner:${p.id}`, party_type: "partner" as PartyType, party_id: p.id, name: (p.name || "거래처").trim() })),
  }), [banks, cards, partners]);
  const findPartyOption = (key: string): PartyOption | null =>
    [...partyGroups.bank, ...partyGroups.card, ...partyGroups.partner].find((o) => o.key === key) ?? null;

  // ── 라인 조작 ──
  const patchLine = (id: string, patch: Partial<OpeningLine>) => setLines((p) => p.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  const addLine = () => setLines((p) => [...p, newLine()]);
  const removeLine = (id: string) => setLines((p) => p.filter((l) => l.id !== id));

  const pickAccount = (id: string, accountId: string) => {
    const a = (coa as ChartOfAccount[]).find((x) => x.id === accountId);
    if (a) patchLine(id, { account_id: a.id, code: a.code, name: a.name, account_type: a.account_type as AccountType });
    else patchLine(id, { account_id: null, code: "", name: "", account_type: null });
  };

  // ── 거래처 하위행 조작 ──
  const patchParty = (lineId: string, partyId: string, patch: Partial<OpeningParty>) =>
    setLines((p) => p.map((l) => (l.id === lineId ? { ...l, parties: l.parties.map((pt) => (pt.id === partyId ? { ...pt, ...patch } : pt)) } : l)));
  const addParty = (lineId: string) => setLines((p) => p.map((l) => (l.id === lineId ? { ...l, parties: [...l.parties, newParty()] } : l)));
  const removeParty = (lineId: string, partyId: string) =>
    setLines((p) => p.map((l) => (l.id === lineId ? { ...l, parties: l.parties.filter((pt) => pt.id !== partyId) } : l)));
  const pickParty = (lineId: string, partyId: string, key: string) => {
    if (key === "manual") { patchParty(lineId, partyId, { party_type: "manual", party_id: null, name: "" }); return; }
    const o = findPartyOption(key);
    if (o) patchParty(lineId, partyId, { party_type: o.party_type, party_id: o.party_id, name: o.name });
  };

  const saveMut = useMutation({
    mutationFn: () => saveAccountingClosing(companyId!, null, { closing_date: closingDate || null, opening_lines: lines, note: note.trim() || null }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["accounting-closing", companyId] }); toast("회계마감 설정이 저장되었습니다. 다음 수집부터 마감일 이전 자료는 제외됩니다.", "success"); },
    onError: (e: any) => toast("저장 실패: " + friendlyError(e, "알 수 없는 오류"), "error"),
  });

  const floor = computeSyncFloor(closingDate || null);
  const total = openingTotal(lines);
  const hasCoa = (coa as ChartOfAccount[]).length > 0;

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

      {/* 계정별/거래처별 기초잔액 */}
      <div>
        <label className="block text-xs text-[var(--text-muted)] mb-2">마감시점 기초잔액 (계정별 · 거래처별)</label>
        {!hasCoa && (
          <div className="mb-2 text-[11px] text-amber-500">계정과목이 없어 계정명을 직접 입력합니다. (회계 원장에 계정과목을 등록하면 선택 목록으로 바뀝니다.)</div>
        )}

        {lines.length === 0 ? (
          <div className="text-xs text-[var(--text-dim)] px-1 py-3 rounded-xl bg-[var(--bg-surface)] border border-dashed border-[var(--border)] text-center">
            계정을 추가해 마감시점 잔액을 입력하세요. 금액은 자산은 +, 부채는 − 로 입력합니다.
          </div>
        ) : (
          <div className="space-y-2">
            {lines.map((l) => (
              <div key={l.id} className="rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-2.5">
                {/* 계정 행 */}
                <div className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                  {hasCoa ? (
                    <select value={l.account_id ?? ""} onChange={(e) => pickAccount(l.id, e.target.value)}
                      className="flex-1 min-w-[160px] h-9 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm">
                      <option value="">계정과목 선택</option>
                      {(coa as ChartOfAccount[]).map((a) => <option key={a.id} value={a.id}>{a.code} {a.name}</option>)}
                    </select>
                  ) : (
                    <input value={l.name} onChange={(e) => patchLine(l.id, { name: e.target.value })} placeholder="계정명 (예: 보통예금)"
                      className="flex-1 min-w-[160px] h-9 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm" />
                  )}
                  {/* 집계구분 */}
                  <select value={l.mode} onChange={(e) => patchLine(l.id, { mode: e.target.value as OpeningLine["mode"] })}
                    className="w-24 h-9 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm">
                    <option value="account">계정별</option>
                    <option value="party">거래처별</option>
                  </select>
                  {l.mode === "account" ? (
                    <input type="text" inputMode="numeric" value={fmtNum(l.amount)} onChange={(e) => patchLine(l.id, { amount: parseNum(e.target.value) })} placeholder="0"
                      className="w-36 h-9 px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-right focus:outline-none focus:border-[var(--primary)]" />
                  ) : (
                    <span className="w-36 h-9 flex items-center justify-end px-3 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-sm text-[var(--text-muted)] mono-number">{fmtNum(lineAmount(l)) || "0"}</span>
                  )}
                  <button onClick={() => removeLine(l.id)} className="w-6 h-9 flex items-center justify-center text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded-lg text-sm" aria-label="계정 삭제">×</button>
                </div>

                {/* 거래처별 하위행 */}
                {l.mode === "party" && (
                  <div className="mt-2 pl-2 sm:pl-6 space-y-1.5 border-l-2 border-[var(--border)]/60">
                    {l.parties.length === 0 && <div className="text-[11px] text-[var(--text-dim)]">거래처를 추가하세요 (통장·카드·등록거래처).</div>}
                    {l.parties.map((pt) => (
                      <div key={pt.id} className="flex flex-wrap sm:flex-nowrap items-center gap-2">
                        <select value={pt.party_id ? `${pt.party_type}:${pt.party_id}` : "manual"} onChange={(e) => pickParty(l.id, pt.id, e.target.value)}
                          className="w-40 h-8 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs">
                          <optgroup label={PARTY_TYPE_LABEL.bank}>{partyGroups.bank.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</optgroup>
                          <optgroup label={PARTY_TYPE_LABEL.card}>{partyGroups.card.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</optgroup>
                          <optgroup label={PARTY_TYPE_LABEL.partner}>{partyGroups.partner.map((o) => <option key={o.key} value={o.key}>{o.name}</option>)}</optgroup>
                          <option value="manual">직접입력…</option>
                        </select>
                        {pt.party_type === "manual" && (
                          <input value={pt.name} onChange={(e) => patchParty(l.id, pt.id, { name: e.target.value })} placeholder="거래처명"
                            className="flex-1 min-w-[100px] h-8 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs" />
                        )}
                        <input type="text" inputMode="numeric" value={fmtNum(pt.amount)} onChange={(e) => patchParty(l.id, pt.id, { amount: parseNum(e.target.value) })} placeholder="0"
                          className="w-32 h-8 px-2 rounded-lg bg-[var(--bg)] border border-[var(--border)] text-xs text-right ml-auto" />
                        <button onClick={() => removeParty(l.id, pt.id)} className="w-5 h-8 flex items-center justify-center text-[var(--danger)] hover:bg-[var(--danger)]/10 rounded text-xs" aria-label="거래처 삭제">×</button>
                      </div>
                    ))}
                    <button onClick={() => addParty(l.id)} className="text-[11px] text-[var(--primary)] hover:text-[var(--text)] font-semibold">+ 거래처 추가</button>
                  </div>
                )}
              </div>
            ))}
          </div>
        )}

        <button onClick={addLine} className="mt-2 text-xs text-[var(--primary)] hover:text-[var(--text)] font-semibold">+ 계정 추가</button>

        {lines.length > 0 && (
          <div className="mt-3 flex items-center justify-between p-3 rounded-xl bg-[var(--bg-surface)] border border-[var(--border)]">
            <span className="text-xs text-[var(--text-muted)]">기초잔액 합계 (부호 반영)</span>
            <span className="text-sm font-bold mono-number text-[var(--primary)]">₩{total.toLocaleString()}</span>
          </div>
        )}
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
