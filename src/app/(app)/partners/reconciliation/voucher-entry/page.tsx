"use client";

// 전표입력 — 일반 회계 프로그램(더존·이카운트) 표준 일반전표 수동 입력 (2026-06-12 핸드오프).
//   일자 → 구분(출금/입금/대체) → 계정과목(코드/이름 자동완성) → 거래처 → 적요 → 차변/대변.
//   차대 균형: 프론트(저장 차단 + 차액 상시 표시) + DB(save_manual_voucher RPC 내 검증) 이중.
//   출금 = 대변 보통예금(101) 자동 / 입금 = 차변 보통예금 자동 / 대체 = 양쪽 직접.
//   저장 = journal_entries(source='manual', status='confirmed') — AI 전표와 같은 테이블 공유.
//   삭제 = voucher_reject(status='rejected', 이력 보존). 마감(locked) 월은 서버에서 차단.

import { useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { useToast } from "@/components/toast";

const db = supabase as any;
const won = (n: number) => `₩${Math.round(Number(n || 0)).toLocaleString()}`;
const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

type Account = { id: string; code: string; name: string; account_type: string };
type Partner = { id: string; name: string };
type Line = {
  key: number;
  account: Account | null;
  partner: Partner | null;
  memo: string;
  debit: string;  // 입력 문자열 (콤마 표시)
  credit: string;
};

const VTYPES = [
  { id: "transfer", label: "대체", desc: "통장·외상 등 일반 거래 (차/대 직접)" },
  { id: "cash_out", label: "출금", desc: "돈이 나감 — 대변 보통예금 자동" },
  { id: "cash_in", label: "입금", desc: "돈이 들어옴 — 차변 보통예금 자동" },
] as const;

const num = (s: string) => Number(String(s).replace(/[^0-9]/g, "")) || 0;
const comma = (s: string) => { const n = num(s); return n ? n.toLocaleString("ko-KR") : ""; };
const AR_AP_CODES = new Set(["108", "251"]); // 채권·채무 계정 → 거래처 권장

let lineKey = 1;
const newLine = (): Line => ({ key: lineKey++, account: null, partner: null, memo: "", debit: "", credit: "" });

export default function VoucherEntryPage() {
  const { user, role } = useUser();
  const companyId = user?.company_id ?? null;
  const qc = useQueryClient();
  const { toast } = useToast();

  const [entryDate, setEntryDate] = useState(todayKst());
  const [vtype, setVtype] = useState<"transfer" | "cash_out" | "cash_in">("transfer");
  const [desc, setDesc] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine(), newLine()]);
  const [acctPick, setAcctPick] = useState<{ key: number; q: string } | null>(null); // 계정 자동완성 대상 행
  const [partnerPick, setPartnerPick] = useState<{ key: number; q: string } | null>(null);
  const lastAmountRef = useRef<HTMLInputElement | null>(null);

  // 계정과목 마스터
  const { data: accounts = [], isFetched: acctFetched } = useQuery<Account[]>({
    queryKey: ["voucher-accounts", companyId],
    queryFn: async () => {
      const { data } = await db.from("chart_of_accounts")
        .select("id, code, name, account_type").eq("company_id", companyId).order("code");
      return (data || []) as Account[];
    },
    enabled: !!companyId,
    staleTime: 300_000,
  });
  const cashAcct = useMemo(() => accounts.find((a) => a.code === "101") || null, [accounts]);
  const dbReady = accounts.length > 0; // 마이그레이션 미적용/미시드면 false → 안내 배너

  const { data: partners = [] } = useQuery<Partner[]>({
    queryKey: ["voucher-partners", companyId],
    queryFn: async () => {
      const { data } = await db.from("partners").select("id, name").eq("company_id", companyId).order("name");
      return (data || []) as Partner[];
    },
    enabled: !!companyId,
    staleTime: 300_000,
  });

  // 해당 일자 전표 목록
  const { data: vouchers = [] } = useQuery<any[]>({
    queryKey: ["vouchers-of-day", companyId, entryDate],
    queryFn: async () => {
      const { data } = await db.from("journal_entries")
        .select("id, voucher_no, voucher_type, description, source, status, journal_lines(debit, credit, description, chart_of_accounts(code, name), partners(name))")
        .eq("company_id", companyId).eq("entry_date", entryDate).eq("status", "confirmed")
        .order("voucher_no", { ascending: true });
      return (data || []) as any[];
    },
    enabled: !!companyId && dbReady,
  });

  // ── 합계/검증 (출금·입금은 자동 상대계정 라인 포함해 계산) ──
  const userDebit = lines.reduce((s, l) => s + num(l.debit), 0);
  const userCredit = lines.reduce((s, l) => s + num(l.credit), 0);
  const autoLine = useMemo(() => {
    if (vtype === "cash_out") return { side: "credit" as const, amount: userDebit };  // 대변 보통예금
    if (vtype === "cash_in") return { side: "debit" as const, amount: userCredit };   // 차변 보통예금
    return null;
  }, [vtype, userDebit, userCredit]);
  const totalDebit = userDebit + (autoLine?.side === "debit" ? autoLine.amount : 0);
  const totalCredit = userCredit + (autoLine?.side === "credit" ? autoLine.amount : 0);
  const diff = totalDebit - totalCredit;
  const filled = lines.filter((l) => num(l.debit) > 0 || num(l.credit) > 0);
  const missingAccount = filled.some((l) => !l.account);
  const arApNoPartner = filled.some((l) => l.account && AR_AP_CODES.has(l.account.code) && !l.partner);
  const canSave = dbReady && filled.length > 0 && !missingAccount && totalDebit > 0 && diff === 0
    && (vtype !== "transfer" || filled.length >= 2)
    && (vtype === "transfer" || !!cashAcct);

  const setLine = (key: number, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addRow = () => setLines((ls) => [...ls, newLine()]);
  const removeRow = (key: number) => setLines((ls) => (ls.length <= 1 ? ls : ls.filter((l) => l.key !== key)));

  // 저장 — save_manual_voucher RPC (DB 가 차대균형·마감월·계정 소유 재검증)
  const saveMut = useMutation({
    mutationFn: async () => {
      const payload = filled.map((l) => ({
        account_id: l.account!.id,
        debit: num(l.debit),
        credit: num(l.credit),
        memo: l.memo || desc,
        partner_id: l.partner?.id ?? "",
      }));
      if (autoLine && autoLine.amount > 0 && cashAcct) {
        payload.push({
          account_id: cashAcct.id,
          debit: autoLine.side === "debit" ? autoLine.amount : 0,
          credit: autoLine.side === "credit" ? autoLine.amount : 0,
          memo: desc, partner_id: "",
        });
      }
      const { data, error } = await db.rpc("save_manual_voucher", {
        p_entry_date: entryDate, p_voucher_type: vtype, p_description: desc, p_lines: payload,
      });
      if (error) throw new Error(error.message);
      return data as string;
    },
    onSuccess: () => {
      toast("전표 저장 완료", "success");
      setLines([newLine(), newLine()]);
      setDesc("");
      qc.invalidateQueries({ queryKey: ["vouchers-of-day", companyId, entryDate] });
    },
    onError: (e: any) => {
      const m = String(e?.message || "");
      toast(m.includes("PERIOD_LOCKED") ? "마감(잠금)된 회계기간입니다 — 저장 불가" :
        m.includes("UNBALANCED") ? "차변·대변 합계가 일치하지 않습니다" :
        m.includes("does not exist") ? "전표 DB가 아직 적용되지 않았습니다" : m || "저장 실패", "error");
    },
  });

  const delMut = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("voucher_reject", { p_entry_id: id });
      if (error) throw new Error(error.message);
    },
    onSuccess: () => { toast("전표 삭제(보관) 완료", "info"); qc.invalidateQueries({ queryKey: ["vouchers-of-day", companyId, entryDate] }); },
    onError: (e: any) => toast(String(e?.message || "").includes("PERIOD_LOCKED") ? "마감된 회계기간 — 삭제 불가" : e?.message || "삭제 실패", "error"),
  });

  if (role === "employee" || role === "partner") {
    return <AccessDenied detail="전표입력은 대표·관리자 전용입니다." />;
  }
  if (!companyId) return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;

  const acctMatches = (q: string) => {
    const t = q.trim().toLowerCase();
    if (!t) return accounts.slice(0, 12);
    return accounts.filter((a) => a.code.includes(t) || a.name.toLowerCase().includes(t)).slice(0, 12);
  };
  const partnerMatches = (q: string) => {
    const t = q.trim().toLowerCase();
    if (!t) return partners.slice(0, 12);
    return partners.filter((p) => p.name.toLowerCase().includes(t)).slice(0, 12);
  };

  const cellInput = "w-full bg-transparent text-xs text-[var(--text)] focus:outline-none px-2 py-2";

  return (
    <div className="space-y-4">
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">전표입력</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">일반전표 수동 분개 — 차변·대변이 일치해야 저장됩니다 (장부 직접 기록)</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/partners/reconciliation" className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">← 거래 매칭</Link>
          <button onClick={() => { setLines([newLine(), newLine()]); setDesc(""); }}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">새 전표</button>
          <button onClick={() => canSave && !saveMut.isPending && saveMut.mutate()} disabled={!canSave || saveMut.isPending}
            className="px-5 py-2 text-xs font-bold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40">
            {saveMut.isPending ? "저장 중..." : "저장"}
          </button>
        </div>
      </div>

      {/* DB 미적용 안내 */}
      {acctFetched && !dbReady && (
        <div className="px-4 py-3 rounded-xl bg-amber-500/8 border border-amber-500/25 text-xs text-amber-600 font-semibold">
          ⚠️ 전표 시스템 DB(계정과목·전표 테이블)가 아직 적용되지 않았습니다 — 적용 후 바로 사용할 수 있습니다.
        </div>
      )}

      {/* ── 전표 헤더: 일자 · 구분 · 적요 ── */}
      <div className="glass-card px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-semibold text-[var(--text-muted)]">일자</span>
          <input type="date" value={entryDate} onChange={(e) => e.target.value && setEntryDate(e.target.value)}
            className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]" />
        </div>
        <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-0.5">
          {VTYPES.map((t) => (
            <button key={t.id} onClick={() => setVtype(t.id)} title={t.desc}
              className={`px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition ${vtype === t.id ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
              {t.label}
            </button>
          ))}
        </div>
        <input value={desc} onChange={(e) => setDesc(e.target.value)} placeholder="전표 적요 (행 적요 비우면 이 값 사용)"
          className="flex-1 min-w-[180px] px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]" />
        <span className="text-[10px] text-[var(--text-dim)]">전표번호: 저장 시 일자별 자동 부여</span>
      </div>

      {/* ── 분개 그리드 ── */}
      <div className="glass-card overflow-visible">
        <table className="w-full text-xs border-collapse" style={{ minWidth: 820 }}>
          <thead>
            <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
              <th className="px-2 py-2.5 w-8 text-center font-semibold">No</th>
              <th className="px-2 py-2.5 text-left font-semibold border-l border-[var(--border)]/50 min-w-[200px]">계정과목 (코드·이름 검색)</th>
              <th className="px-2 py-2.5 text-left font-semibold border-l border-[var(--border)]/50 min-w-[150px]">거래처</th>
              <th className="px-2 py-2.5 text-left font-semibold border-l border-[var(--border)]/50">적요</th>
              <th className="px-2 py-2.5 text-right font-semibold border-l border-[var(--border)]/50 w-[130px]">차변</th>
              <th className="px-2 py-2.5 text-right font-semibold border-l border-[var(--border)]/50 w-[130px]">대변</th>
              <th className="px-2 py-2.5 w-8" />
            </tr>
          </thead>
          <tbody>
            {lines.map((l, idx) => (
              <tr key={l.key} className="border-b border-[var(--border)]/40">
                <td className="px-2 py-1 text-center text-[var(--text-dim)] mono-number">{idx + 1}</td>
                {/* 계정과목 자동완성 */}
                <td className="border-l border-[var(--border)]/40 relative p-0">
                  <input
                    value={acctPick?.key === l.key ? acctPick.q : (l.account ? `${l.account.name} (${l.account.code})` : "")}
                    onChange={(e) => setAcctPick({ key: l.key, q: e.target.value })}
                    onFocus={() => setAcctPick({ key: l.key, q: "" })}
                    onBlur={() => setTimeout(() => setAcctPick((p) => (p?.key === l.key ? null : p)), 150)}
                    placeholder="103 / 보통예금..."
                    className={cellInput}
                  />
                  {acctPick?.key === l.key && (
                    <div className="absolute z-30 left-0 top-full mt-0.5 w-72 max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-xl p-1">
                      {acctMatches(acctPick.q).map((a) => (
                        <button key={a.id} onMouseDown={(e) => { e.preventDefault(); setLine(l.key, { account: a }); setAcctPick(null); }}
                          className="w-full flex items-center justify-between px-2 py-1.5 rounded text-[12px] text-left text-[var(--text)] hover:bg-[var(--bg-surface)]">
                          <span>{a.name}</span>
                          <span className="text-[var(--text-dim)] mono-number">{a.code}</span>
                        </button>
                      ))}
                      {acctMatches(acctPick.q).length === 0 && <div className="px-2 py-2 text-[11px] text-[var(--text-dim)]">{dbReady ? "검색 결과 없음" : "계정과목 마스터 미적용"}</div>}
                    </div>
                  )}
                </td>
                {/* 거래처 자동완성 */}
                <td className="border-l border-[var(--border)]/40 relative p-0">
                  <div className="flex items-center">
                    <input
                      value={partnerPick?.key === l.key ? partnerPick.q : (l.partner?.name || "")}
                      onChange={(e) => setPartnerPick({ key: l.key, q: e.target.value })}
                      onFocus={() => setPartnerPick({ key: l.key, q: "" })}
                      onBlur={() => setTimeout(() => setPartnerPick((p) => (p?.key === l.key ? null : p)), 150)}
                      placeholder="—"
                      className={cellInput}
                    />
                    {l.account && AR_AP_CODES.has(l.account.code) && !l.partner && (
                      <span className="pr-2 text-amber-500 text-[10px] font-bold shrink-0" title="외상매출금/외상매입금은 거래처 지정을 권장합니다">⚠</span>
                    )}
                  </div>
                  {partnerPick?.key === l.key && (
                    <div className="absolute z-30 left-0 top-full mt-0.5 w-64 max-h-56 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-xl p-1">
                      {partnerMatches(partnerPick.q).map((p) => (
                        <button key={p.id} onMouseDown={(e) => { e.preventDefault(); setLine(l.key, { partner: p }); setPartnerPick(null); }}
                          className="w-full px-2 py-1.5 rounded text-[12px] text-left text-[var(--text)] hover:bg-[var(--bg-surface)] truncate">
                          {p.name}
                        </button>
                      ))}
                      {l.partner && (
                        <button onMouseDown={(e) => { e.preventDefault(); setLine(l.key, { partner: null }); setPartnerPick(null); }}
                          className="w-full px-2 py-1 rounded text-[11px] text-[var(--text-dim)] text-left hover:bg-[var(--bg-surface)]">지우기</button>
                      )}
                    </div>
                  )}
                </td>
                <td className="border-l border-[var(--border)]/40 p-0">
                  <input value={l.memo} onChange={(e) => setLine(l.key, { memo: e.target.value })} placeholder={desc || "적요"} className={cellInput} />
                </td>
                {/* 차변 / 대변 — 한쪽만 */}
                <td className="border-l border-[var(--border)]/40 p-0">
                  <input inputMode="numeric" value={l.debit}
                    onChange={(e) => setLine(l.key, { debit: comma(e.target.value), credit: num(e.target.value) > 0 ? "" : l.credit })}
                    disabled={vtype === "cash_in"}
                    placeholder={vtype === "cash_in" ? "자동" : "0"}
                    className={`${cellInput} text-right mono-number disabled:opacity-40`} />
                </td>
                <td className="border-l border-[var(--border)]/40 p-0">
                  <input inputMode="numeric" value={l.credit}
                    ref={idx === lines.length - 1 ? lastAmountRef : undefined}
                    onChange={(e) => setLine(l.key, { credit: comma(e.target.value), debit: num(e.target.value) > 0 ? "" : l.debit })}
                    onKeyDown={(e) => { if (e.key === "Enter" && idx === lines.length - 1) addRow(); }}
                    disabled={vtype === "cash_out"}
                    placeholder={vtype === "cash_out" ? "자동" : "0"}
                    className={`${cellInput} text-right mono-number disabled:opacity-40`} />
                </td>
                <td className="text-center">
                  <button onClick={() => removeRow(l.key)} className="text-[var(--text-dim)] hover:text-[var(--danger)] text-xs" title="행 삭제">✕</button>
                </td>
              </tr>
            ))}
            {/* 자동 상대계정 라인 (출금/입금) */}
            {autoLine && (
              <tr className="border-b border-[var(--border)]/40 bg-[var(--bg-surface)]/60">
                <td className="px-2 py-2 text-center text-[var(--text-dim)]">자동</td>
                <td className="px-2 py-2 border-l border-[var(--border)]/40 text-[var(--text-muted)] font-semibold">
                  {cashAcct ? `${cashAcct.name} (${cashAcct.code})` : "보통예금 — 마스터 미적용"}
                </td>
                <td className="border-l border-[var(--border)]/40" />
                <td className="px-2 py-2 border-l border-[var(--border)]/40 text-[var(--text-dim)]">{vtype === "cash_out" ? "출금 상대계정 (자동)" : "입금 상대계정 (자동)"}</td>
                <td className="px-2 py-2 border-l border-[var(--border)]/40 text-right mono-number font-semibold">{autoLine.side === "debit" && autoLine.amount > 0 ? autoLine.amount.toLocaleString() : ""}</td>
                <td className="px-2 py-2 border-l border-[var(--border)]/40 text-right mono-number font-semibold">{autoLine.side === "credit" && autoLine.amount > 0 ? autoLine.amount.toLocaleString() : ""}</td>
                <td />
              </tr>
            )}
            {/* + 행 추가 */}
            <tr>
              <td colSpan={7} className="px-3 py-2">
                <button onClick={addRow} className="text-[12px] text-[var(--text-dim)] hover:text-[var(--primary)] font-semibold">+ 행 추가 <span className="text-[10px] opacity-60">(마지막 대변 칸에서 Enter)</span></button>
              </td>
            </tr>
          </tbody>
          {/* 합계 + 차대 검증 */}
          <tfoot>
            <tr className="border-t-2 border-[var(--border)] bg-[var(--bg-surface)] font-bold">
              <td colSpan={4} className="px-3 py-2.5 text-right text-[var(--text-muted)]">합계</td>
              <td className="px-2 py-2.5 text-right mono-number text-[var(--text)]">{totalDebit.toLocaleString()}</td>
              <td className="px-2 py-2.5 text-right mono-number text-[var(--text)]">{totalCredit.toLocaleString()}</td>
              <td />
            </tr>
          </tfoot>
        </table>
        <div className={`px-4 py-2.5 border-t border-[var(--border)] text-xs font-bold flex items-center gap-3 ${diff === 0 && totalDebit > 0 ? "text-emerald-500" : "text-red-500"}`}>
          {totalDebit === 0 ? <span className="text-[var(--text-dim)] font-semibold">금액을 입력하세요</span>
            : diff === 0 ? <>✅ 차대일치 — 저장 가능</>
            : <>⚠️ 차액 {won(Math.abs(diff))} ({diff > 0 ? "대변 부족" : "차변 부족"}) — 저장 불가</>}
          {missingAccount && <span className="text-amber-500">· 계정과목 미지정 행 있음</span>}
          {arApNoPartner && <span className="text-amber-500">· 채권/채무 계정에 거래처 미지정</span>}
        </div>
      </div>

      {/* ── 해당 일자 전표 목록 ── */}
      <div className="glass-card overflow-hidden">
        <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] flex items-center justify-between">
          <span className="text-xs font-bold text-[var(--text)]">{entryDate} 전표 목록</span>
          <span className="text-[10px] text-[var(--text-dim)]">{vouchers.length}건</span>
        </div>
        {vouchers.length === 0 ? (
          <div className="p-8 text-center text-xs text-[var(--text-muted)]">이 일자에 저장된 전표가 없습니다.</div>
        ) : (
          <div className="divide-y divide-[var(--border)]/50">
            {vouchers.map((v) => {
              const dsum = (v.journal_lines || []).reduce((s: number, ln: any) => s + Number(ln.debit || 0), 0);
              return (
                <div key={v.id} className="px-4 py-2.5">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-bold mono-number">#{v.voucher_no ?? "—"}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-muted)] font-semibold">
                      {v.voucher_type === "cash_out" ? "출금" : v.voucher_type === "cash_in" ? "입금" : "대체"}
                    </span>
                    {v.source !== "manual" && <span className="text-[10px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-500 font-semibold">AI/규칙</span>}
                    <span className="text-xs font-semibold text-[var(--text)] truncate">{v.description || "적요 없음"}</span>
                    <span className="ml-auto text-xs font-bold mono-number text-[var(--text)]">{won(dsum)}</span>
                    <button onClick={() => { if (confirm("이 전표를 삭제(보관)할까요? 이력은 남습니다.")) delMut.mutate(v.id); }}
                      disabled={delMut.isPending}
                      className="text-[var(--text-dim)] hover:text-[var(--danger)] text-xs shrink-0" title="삭제 (이력 보존)">✕</button>
                  </div>
                  <div className="mt-1 ml-1 space-y-0.5">
                    {(v.journal_lines || []).map((ln: any, i: number) => (
                      <div key={i} className="flex items-center gap-2 text-[10px] text-[var(--text-dim)]">
                        <span className="w-7 text-right">{Number(ln.debit) > 0 ? "(차)" : "(대)"}</span>
                        <span className="text-[var(--text-muted)]">{ln.chart_of_accounts?.name || "?"} ({ln.chart_of_accounts?.code || "—"})</span>
                        {ln.partners?.name && <span>· {ln.partners.name}</span>}
                        {ln.description && <span className="truncate">· {ln.description}</span>}
                        <span className="ml-auto mono-number text-[var(--text-muted)]">{(Number(ln.debit) > 0 ? Number(ln.debit) : Number(ln.credit)).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <p className="text-[11px] text-[var(--text-dim)]">
        ※ 전표입력은 장부 기록입니다 — 계산서↔입금 대사(미수금 차감)는 <Link href="/partners/reconciliation" className="text-[var(--primary)] hover:underline">거래 매칭</Link>에서 별도로 처리됩니다 · 마감(잠금)된 월의 전표는 저장/삭제가 차단됩니다
      </p>
    </div>
  );
}
