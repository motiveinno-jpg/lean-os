"use client";

// 전표입력 — 더존식 일반전표 단일 그리드 (2026-06-12 핸드오프 §3-3/§3-3-A 필수 스펙).
//   입력 = 목록: 별도 폼 없이 하나의 분개 그리드. 저장된 라인이 그대로 쌓이고, 마지막 빈 행에서 이어서 입력.
//   컬럼(순서 고정): ☑ | No | 구분 | 계정코드 | 계정명 | 거래처코드 | 거래처명 | 차변 | 대변 | 적요코드 | 적요
//   구분: 1.출금(대변 보통예금 자동) / 2.입금(차변 자동) / 3.차변 / 4.대변 (더존 표기).
//   차대일치: 프론트 상시 표시+저장 차단 + DB RPC(save/update_manual_voucher) 재검증 이중.
//   인라인 수정: 저장된 셀 클릭 → 그 자리에서 수정(전표 단위 편집 버퍼) → 저장 시 update_manual_voucher
//     (변경 전 값 journal_entry_audits 이력 보존, 마감월 차단). 삭제 = voucher_reject(행 보존).
//   적요코드: 자주 쓰는 적요(최근 9개, localStorage) 번호 선택. 거래처코드 = 사업자번호.

import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { useToast } from "@/components/toast";

const db = supabase as any;
const won = (n: number) => `₩${Math.round(Number(n || 0)).toLocaleString()}`;
const todayKst = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
const num = (s: string | number) => Number(String(s).replace(/[^0-9]/g, "")) || 0;
const comma = (s: string) => { const n = num(s); return n ? n.toLocaleString("ko-KR") : ""; };

type Acct = { id: string; code: string; name: string };
type Pt = { id: string; name: string; business_number: string | null };
type Gubun = "1" | "2" | "3" | "4";
const GUBUN_LABEL: Record<Gubun, string> = { "1": "1.출금", "2": "2.입금", "3": "3.차변", "4": "4.대변" };
// 행 단위 분개 라인 (신규 입력/편집 버퍼 공용)
type PLine = { key: number; gubun: Gubun; account: Acct | null; partner: Pt | null; memo: string; debit: string; credit: string };
type SavedLine = { account: Acct | null; partner: Pt | null; memo: string; debit: number; credit: number };
type SavedEntry = { id: string; voucher_no: number | null; voucher_type: string | null; description: string; source: string; lines: SavedLine[] };

let K = 1;
const AR_AP_CODES = new Set(["108", "251"]);
const MEMO_KEY = "voucher-recent-memos";

// 저장 라인의 구분 표기 — 출금/입금 전표는 더존처럼 1.출금/2.입금으로 표기
const savedGubun = (vt: string | null, debit: number): Gubun =>
  vt === "cash_out" ? (debit > 0 ? "1" : "4") : vt === "cash_in" ? (debit > 0 ? "3" : "2") : debit > 0 ? "3" : "4";

export default function VoucherEntryPage() {
  const { user, role } = useUser();
  const companyId = user?.company_id ?? null;
  const qc = useQueryClient();
  const { toast } = useToast();

  const [entryDate, setEntryDate] = useState(todayKst());
  const [pend, setPend] = useState<PLine[]>([]);               // 작성 중 새 전표(저장 전)
  const [edits, setEdits] = useState<Record<string, { desc: string; lines: PLine[] }>>({}); // 인라인 편집 버퍼
  const [selected, setSelected] = useState<Set<string>>(new Set()); // "s:entryId" | "p:key"
  const [picker, setPicker] = useState<{ kind: "acct" | "pt" | "memo"; rowId: string; q: string } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; rowId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [recentMemos, setRecentMemos] = useState<string[]>([]);
  const tableRef = useRef<HTMLTableElement | null>(null);
  useEffect(() => { try { setRecentMemos(JSON.parse(localStorage.getItem(MEMO_KEY) || "[]")); } catch { /* noop */ } }, []);
  useEffect(() => { const close = () => setCtx(null); window.addEventListener("click", close); return () => window.removeEventListener("click", close); }, []);

  // ── 참조 데이터 ──
  const { data: accounts = [], isFetched: acctFetched } = useQuery<Acct[]>({
    queryKey: ["voucher-accounts", companyId],
    queryFn: async () => {
      const { data } = await db.from("chart_of_accounts").select("id, code, name").eq("company_id", companyId).order("code");
      return (data || []) as Acct[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });
  const cashAcct = useMemo(() => accounts.find((a) => a.code === "101") || null, [accounts]);
  const dbReady = accounts.length > 0;

  const { data: partners = [] } = useQuery<Pt[]>({
    queryKey: ["voucher-partners", companyId],
    queryFn: async () => {
      const { data } = await db.from("partners").select("id, name, business_number").eq("company_id", companyId).order("name");
      return (data || []) as Pt[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });

  // ── 해당 일자 저장 전표 (확정만 — 그리드에 그대로 쌓이는 행) ──
  const { data: entries = [] } = useQuery<SavedEntry[]>({
    queryKey: ["vouchers-of-day", companyId, entryDate],
    queryFn: async () => {
      const { data } = await db.from("journal_entries")
        .select("id, voucher_no, voucher_type, description, source, journal_lines(debit, credit, description, chart_of_accounts(id, code, name), partners(id, name, business_number))")
        .eq("company_id", companyId).eq("entry_date", entryDate).eq("status", "confirmed")
        .order("voucher_no", { ascending: true });
      return ((data || []) as any[]).map((e) => ({
        id: e.id, voucher_no: e.voucher_no, voucher_type: e.voucher_type, description: e.description || "", source: e.source,
        lines: (e.journal_lines || [])
          .sort((a: any, b: any) => Number(b.debit || 0) - Number(a.debit || 0))
          .map((l: any) => ({
            account: l.chart_of_accounts ? { id: l.chart_of_accounts.id, code: l.chart_of_accounts.code, name: l.chart_of_accounts.name } : null,
            partner: l.partners ? { id: l.partners.id, name: l.partners.name, business_number: l.partners.business_number } : null,
            memo: l.description || "", debit: Number(l.debit || 0), credit: Number(l.credit || 0),
          })),
      }));
    },
    enabled: !!companyId && dbReady,
  });

  // ── 새 전표(pend) 파생값 — 출금/입금이면 자동 현금 라인 포함해 균형 계산 ──
  const pendType = pend.length === 0 ? null : pend[0].gubun === "1" ? "cash_out" : pend[0].gubun === "2" ? "cash_in" : "transfer";
  const pendFilled = pend.filter((l) => num(l.debit) > 0 || num(l.credit) > 0);
  const pendDebit = pendFilled.reduce((s, l) => s + num(l.debit), 0);
  const pendCredit = pendFilled.reduce((s, l) => s + num(l.credit), 0);
  const autoAmt = pendType === "cash_out" ? pendDebit : pendType === "cash_in" ? pendCredit : 0;
  const pendTotalD = pendDebit + (pendType === "cash_in" ? autoAmt : 0);
  const pendTotalC = pendCredit + (pendType === "cash_out" ? autoAmt : 0);
  const pendBalanced = pendTotalD > 0 && pendTotalD === pendTotalC;
  const pendMissing = pendFilled.some((l) => !l.account);
  const pendOk = pendFilled.length > 0 && pendBalanced && !pendMissing && (pendType !== "transfer" || pendFilled.length >= 2) && (pendType === "transfer" || !!cashAcct);

  // 편집 버퍼 파생값
  const editStat = (b: { lines: PLine[] }) => {
    const fl = b.lines.filter((l) => num(l.debit) > 0 || num(l.credit) > 0);
    const d = fl.reduce((s, l) => s + num(l.debit), 0), c = fl.reduce((s, l) => s + num(l.credit), 0);
    return { d, c, ok: fl.length >= 2 && d > 0 && d === c && !fl.some((l) => !l.account) };
  };
  const editIds = Object.keys(edits);
  const editsOk = editIds.every((id) => editStat(edits[id]).ok);

  // 전체 합계 (저장행 + 편집버퍼 + 새 전표 + 자동라인)
  const savedD = entries.filter((e) => !edits[e.id]).reduce((s, e) => s + e.lines.reduce((x, l) => x + l.debit, 0), 0);
  const savedC = entries.filter((e) => !edits[e.id]).reduce((s, e) => s + e.lines.reduce((x, l) => x + l.credit, 0), 0);
  const editD = editIds.reduce((s, id) => s + editStat(edits[id]).d, 0);
  const editC = editIds.reduce((s, id) => s + editStat(edits[id]).c, 0);
  const totalD = savedD + editD + pendTotalD;
  const totalC = savedC + editC + pendTotalC;
  const diff = totalD - totalC;
  const dirty = pendFilled.length > 0 || editIds.length > 0;
  const canSave = dbReady && dirty && (pendFilled.length === 0 || pendOk) && editsOk && !busy;

  // ── 행 조작 ──
  const newLine = (gubun: Gubun): PLine => ({ key: K++, gubun, account: null, partner: null, memo: "", debit: "", credit: "" });
  const setPendLine = (key: number, patch: Partial<PLine>) => setPend((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const setEditLine = (entryId: string, key: number, patch: Partial<PLine>) =>
    setEdits((es) => ({ ...es, [entryId]: { ...es[entryId], lines: es[entryId].lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) } }));
  const enterEdit = (e: SavedEntry) => {
    if (edits[e.id]) return;
    setEdits((es) => ({
      ...es,
      [e.id]: {
        desc: e.description,
        lines: e.lines.map((l) => ({ key: K++, gubun: savedGubun(e.voucher_type, l.debit), account: l.account, partner: l.partner, memo: l.memo, debit: l.debit ? l.debit.toLocaleString() : "", credit: l.credit ? l.credit.toLocaleString() : "" })),
      },
    }));
  };
  const startPend = (gubun: Gubun) => setPend((ls) => [...ls, newLine(gubun)]);

  // 금액 입력 — 한 행은 한쪽만. 대체(3/4) 행은 입력하는 쪽으로 구분 자동 전환.
  const amountPatch = (l: PLine, side: "debit" | "credit", v: string): Partial<PLine> => {
    const p: Partial<PLine> = { [side]: comma(v) } as Partial<PLine>;
    if (num(v) > 0) {
      (p as any)[side === "debit" ? "credit" : "debit"] = "";
      if (l.gubun === "3" || l.gubun === "4") p.gubun = side === "debit" ? "3" : "4";
    }
    return p;
  };

  // 키보드: Enter = 다음 칸 이동, 마지막 칸이면 새 행 생성 (마우스 없이 연속 입력)
  const onGridKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const t = e.target as HTMLElement;
    if (!/^(INPUT|SELECT)$/.test(t.tagName)) return;
    e.preventDefault();
    const els = Array.from(tableRef.current?.querySelectorAll<HTMLElement>("input:not([disabled]):not([readonly]), select:not([disabled])") || []);
    const i = els.indexOf(t);
    if (i >= 0 && i < els.length - 1) els[i + 1].focus();
    else if (pend.length > 0) startPend(pendType === "cash_out" ? "1" : pendType === "cash_in" ? "2" : "3");
  };

  const rememberMemos = (memos: string[]) => {
    const next = [...new Set([...memos.filter(Boolean), ...recentMemos])].slice(0, 9);
    setRecentMemos(next);
    try { localStorage.setItem(MEMO_KEY, JSON.stringify(next)); } catch { /* noop */ }
  };

  // ── 저장: 편집 전표(update_manual_voucher, 변경 전 값 이력 보존) + 새 전표(save_manual_voucher) ──
  const linePayload = (ls: PLine[]) => ls.filter((l) => num(l.debit) > 0 || num(l.credit) > 0)
    .map((l) => ({ account_id: l.account!.id, debit: num(l.debit), credit: num(l.credit), memo: l.memo, partner_id: l.partner?.id ?? "" }));
  const errMsg = (m: string) =>
    m.includes("PERIOD_LOCKED") ? "마감(잠금)된 회계기간입니다 — 저장/수정/삭제 불가"
      : m.includes("UNBALANCED") ? "차변·대변 합계가 일치하지 않습니다"
      : m.includes("does not exist") ? "전표 수정 DB(update_manual_voucher)가 아직 적용되지 않았습니다" : m;

  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      for (const id of editIds) {
        const b = edits[id];
        const { error } = await db.rpc("update_manual_voucher", { p_entry_id: id, p_description: b.desc, p_lines: linePayload(b.lines) });
        if (error) throw new Error(errMsg(String(error.message)));
      }
      if (pendFilled.length > 0) {
        const payload = linePayload(pend);
        if (pendType !== "transfer" && cashAcct && autoAmt > 0) {
          payload.push({ account_id: cashAcct.id, debit: pendType === "cash_in" ? autoAmt : 0, credit: pendType === "cash_out" ? autoAmt : 0, memo: pendFilled[0]?.memo || "", partner_id: "" });
        }
        const { error } = await db.rpc("save_manual_voucher", {
          p_entry_date: entryDate, p_voucher_type: pendType || "transfer", p_description: pendFilled[0]?.memo || "", p_lines: payload,
        });
        if (error) throw new Error(errMsg(String(error.message)));
      }
      rememberMemos([...pendFilled.map((l) => l.memo), ...editIds.flatMap((id) => edits[id].lines.map((l) => l.memo))]);
      setPend([]); setEdits({}); setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["vouchers-of-day"] });
      toast("전표 저장 완료", "success");
    } catch (e: any) {
      toast(e?.message || "저장 실패", "error");
    } finally { setBusy(false); }
  };

  // ── 선택 삭제: 새 행은 즉시 제거, 저장 전표는 voucher_reject(전표째, 행 보존 이력) ──
  const deleteSelected = async () => {
    const pendKeys = [...selected].filter((s) => s.startsWith("p:")).map((s) => Number(s.slice(2)));
    const entryIds = [...new Set([...selected].filter((s) => s.startsWith("s:")).map((s) => s.slice(2)))];
    if (pendKeys.length === 0 && entryIds.length === 0) { toast("삭제할 행을 선택하세요", "info"); return; }
    if (entryIds.length > 0 && !confirm(`저장된 전표 ${entryIds.length}건을 삭제할까요?\n(분개 균형 유지를 위해 전표 단위로 삭제되며, 이력은 보존됩니다)`)) return;
    setBusy(true);
    try {
      if (pendKeys.length) setPend((ls) => ls.filter((l) => !pendKeys.includes(l.key)));
      for (const id of entryIds) {
        const { error } = await db.rpc("voucher_reject", { p_entry_id: id });
        if (error) throw new Error(errMsg(String(error.message)));
        setEdits((es) => { const n = { ...es }; delete n[id]; return n; });
      }
      setSelected(new Set());
      if (entryIds.length) { qc.invalidateQueries({ queryKey: ["vouchers-of-day"] }); toast(`전표 ${entryIds.length}건 삭제(이력 보존)`, "info"); }
    } catch (e: any) {
      toast(e?.message || "삭제 실패", "error");
    } finally { setBusy(false); }
  };

  // 우클릭 메뉴: 행 삽입/복사/삭제 (§3-3-A)
  const ctxAction = (action: "insert" | "copy" | "delete") => {
    if (!ctx) return;
    const id = ctx.rowId;
    if (id.startsWith("p:")) {
      const key = Number(id.slice(2));
      const idx = pend.findIndex((l) => l.key === key);
      const l = pend[idx];
      if (action === "insert" && l) setPend((ls) => [...ls.slice(0, idx), newLine(l.gubun), ...ls.slice(idx)]);
      if (action === "copy" && l) setPend((ls) => [...ls, { ...l, key: K++ }]);
      if (action === "delete") setPend((ls) => ls.filter((x) => x.key !== key));
    } else if (id.startsWith("e:")) {
      // 인라인 편집 버퍼 행 — 버퍼 안에서 삽입/복사/삭제 (저장 시 차대 재검증)
      const [entryId, keyStr] = id.slice(2).split(":");
      const key = Number(keyStr);
      const buf = edits[entryId];
      if (!buf) { setCtx(null); return; }
      const idx = buf.lines.findIndex((l) => l.key === key);
      const l = buf.lines[idx];
      const setLines = (fn: (ls: PLine[]) => PLine[]) => setEdits((es) => ({ ...es, [entryId]: { ...es[entryId], lines: fn(es[entryId].lines) } }));
      if (action === "insert" && l) setLines((ls) => [...ls.slice(0, idx), newLine(l.gubun === "1" || l.gubun === "2" ? l.gubun : "3"), ...ls.slice(idx)]);
      if (action === "copy" && l) setLines((ls) => [...ls, { ...l, key: K++ }]);
      if (action === "delete") setLines((ls) => (ls.length <= 2 ? ls : ls.filter((x) => x.key !== key)));
    } else {
      const [entryId, lineIdx] = id.slice(2).split("#");
      const e = entries.find((x) => x.id === entryId);
      const l = e?.lines[Number(lineIdx)];
      if (action === "copy" && l) {
        const g: Gubun = pendType === "cash_out" ? "1" : pendType === "cash_in" ? "2" : l.debit > 0 ? "3" : "4";
        setPend((ls) => [...ls, { key: K++, gubun: g, account: l.account, partner: l.partner, memo: l.memo, debit: l.debit ? l.debit.toLocaleString() : "", credit: l.credit ? l.credit.toLocaleString() : "" }]);
      }
      if (action === "delete" && e) {
        setSelected(new Set([`s:${e.id}`]));
        setTimeout(() => { void deleteSelected(); }, 0);
      }
      if (action === "insert" && e) enterEdit(e);
    }
    setCtx(null);
  };

  if (role === "employee" || role === "partner") return <AccessDenied detail="전표입력은 대표·관리자 전용입니다." />;
  if (!companyId) return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;

  const acctMatches = (q: string) => {
    const t = q.trim().toLowerCase();
    return (t ? accounts.filter((a) => a.code.includes(t) || a.name.toLowerCase().includes(t)) : accounts).slice(0, 12);
  };
  const ptMatches = (q: string) => {
    const t = q.trim().toLowerCase();
    return (t ? partners.filter((p) => p.name.toLowerCase().includes(t) || (p.business_number || "").includes(t)) : partners).slice(0, 12);
  };

  const TD = "px-2 py-1 border-l border-[var(--border)]/40 whitespace-nowrap";
  const IN = "w-full bg-transparent text-xs text-[var(--text)] focus:outline-none focus:bg-[var(--primary)]/5 px-1 py-1";

  // ── 편집 가능 행 (새 전표 행 + 인라인 편집 버퍼 행 공용) ──
  const editableRow = (l: PLine, rowId: string, no: number, opts: { gubunFixed?: boolean; first?: boolean; update: (patch: Partial<PLine>) => void }) => {
    const arApWarn = l.account && AR_AP_CODES.has(l.account.code) && !l.partner;
    const debitOff = l.gubun === "4" || l.gubun === "2"; // 대변/입금 행은 차변 잠금
    const creditOff = l.gubun === "3" || l.gubun === "1"; // 차변/출금 행은 대변 잠금
    return (
      <tr key={rowId} className={`border-b border-[var(--border)]/40 bg-[var(--primary)]/[0.03] ${opts.first ? "border-t-2 border-t-[var(--primary)]/30" : ""}`}
        onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, rowId }); }}>
        <td className="px-2 py-1 text-center">
          {rowId.startsWith("p:") && (
            <input type="checkbox" checked={selected.has(rowId)} onChange={(e) => setSelected((s) => { const n = new Set(s); if (e.target.checked) n.add(rowId); else n.delete(rowId); return n; })} />
          )}
        </td>
        <td className="px-2 py-1 text-center text-[var(--text-dim)] mono-number">{no}</td>
        <td className={`${TD} p-0 w-[64px]`}>
          {opts.gubunFixed ? (
            <span className="px-1 text-[11px] font-semibold text-[var(--text-muted)]">{GUBUN_LABEL[l.gubun]}</span>
          ) : (
            <select value={l.gubun === "1" || l.gubun === "2" ? l.gubun : l.gubun} onChange={(e) => opts.update({ gubun: e.target.value as Gubun })} className={`${IN} cursor-pointer`}>
              {(l.gubun === "1" || l.gubun === "2" ? [l.gubun] : ["3", "4"]).map((g) => <option key={g} value={g}>{GUBUN_LABEL[g as Gubun]}</option>)}
            </select>
          )}
        </td>
        {/* 계정코드 / 계정명 */}
        <td className={`${TD} p-0 relative w-[72px]`}>
          <input value={picker?.kind === "acct" && picker.rowId === rowId ? picker.q : (l.account?.code || "")}
            onChange={(e) => setPicker({ kind: "acct", rowId, q: e.target.value })}
            onFocus={() => setPicker({ kind: "acct", rowId, q: "" })}
            onBlur={() => setTimeout(() => setPicker((p) => (p?.rowId === rowId && p.kind === "acct" ? null : p)), 150)}
            placeholder="코드" className={`${IN} mono-number`} />
          {picker?.kind === "acct" && picker.rowId === rowId && (
            <div className="absolute z-30 left-0 top-full mt-0.5 w-64 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-xl p-1">
              {acctMatches(picker.q).map((a) => (
                <button key={a.id} onMouseDown={(e) => { e.preventDefault(); opts.update({ account: a }); setPicker(null); }}
                  className="w-full flex justify-between px-2 py-1.5 rounded text-[12px] text-[var(--text)] hover:bg-[var(--bg-surface)]">
                  <span>{a.name}</span><span className="text-[var(--text-dim)] mono-number">{a.code}</span>
                </button>
              ))}
              {acctMatches(picker.q).length === 0 && <div className="px-2 py-2 text-[11px] text-[var(--text-dim)]">검색 결과 없음</div>}
            </div>
          )}
        </td>
        <td className={`${TD} text-[var(--text)] cursor-pointer min-w-[110px]`} onClick={() => setPicker({ kind: "acct", rowId, q: "" })}>
          {l.account?.name || <span className="text-[var(--text-dim)]">계정 선택</span>}
        </td>
        {/* 거래처코드(사업자번호) / 거래처명 */}
        <td className={`${TD} mono-number text-[var(--text-dim)] w-[100px]`}>{l.partner?.business_number || "—"}</td>
        <td className={`${TD} p-0 relative min-w-[110px]`}>
          <div className="flex items-center">
            <input value={picker?.kind === "pt" && picker.rowId === rowId ? picker.q : (l.partner?.name || "")}
              onChange={(e) => setPicker({ kind: "pt", rowId, q: e.target.value })}
              onFocus={() => setPicker({ kind: "pt", rowId, q: "" })}
              onBlur={() => setTimeout(() => setPicker((p) => (p?.rowId === rowId && p.kind === "pt" ? null : p)), 150)}
              placeholder="—" className={IN} />
            {arApWarn && <span className="pr-1 text-amber-500 text-[10px] font-bold shrink-0" title="채권/채무 계정은 거래처 지정을 권장합니다">⚠</span>}
          </div>
          {picker?.kind === "pt" && picker.rowId === rowId && (
            <div className="absolute z-30 left-0 top-full mt-0.5 w-60 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-xl p-1">
              {ptMatches(picker.q).map((p) => (
                <button key={p.id} onMouseDown={(e) => { e.preventDefault(); opts.update({ partner: p }); setPicker(null); }}
                  className="w-full px-2 py-1.5 rounded text-[12px] text-left text-[var(--text)] hover:bg-[var(--bg-surface)] truncate">
                  {p.name}{p.business_number ? <span className="text-[var(--text-dim)] mono-number"> · {p.business_number}</span> : null}
                </button>
              ))}
              {l.partner && <button onMouseDown={(e) => { e.preventDefault(); opts.update({ partner: null }); setPicker(null); }} className="w-full px-2 py-1 rounded text-[11px] text-[var(--text-dim)] text-left hover:bg-[var(--bg-surface)]">지우기</button>}
            </div>
          )}
        </td>
        {/* 차변 / 대변 — 한 행 한쪽만 */}
        <td className={`${TD} p-0 w-[110px]`}>
          <input inputMode="numeric" value={l.debit} readOnly={debitOff}
            onChange={(e) => opts.update(amountPatch(l, "debit", e.target.value))}
            placeholder={debitOff ? "" : "0"}
            className={`${IN} text-right mono-number ${debitOff ? "opacity-30 cursor-default" : ""}`} />
        </td>
        <td className={`${TD} p-0 w-[110px]`}>
          <input inputMode="numeric" value={l.credit} readOnly={creditOff}
            onChange={(e) => opts.update(amountPatch(l, "credit", e.target.value))}
            placeholder={creditOff ? "" : "0"}
            className={`${IN} text-right mono-number ${creditOff ? "opacity-30 cursor-default" : ""}`} />
        </td>
        {/* 적요코드(자주 쓰는 적요 번호 선택) / 적요 */}
        <td className={`${TD} p-0 relative w-[64px]`}>
          <button onClick={() => setPicker({ kind: "memo", rowId, q: "" })} className="w-full px-1 py-1 text-[11px] text-[var(--text-dim)] hover:text-[var(--primary)]" title="자주 쓰는 적요 선택" tabIndex={-1}>
            {recentMemos.length ? "▾" : "—"}
          </button>
          {picker?.kind === "memo" && picker.rowId === rowId && (
            <div className="absolute z-30 right-0 top-full mt-0.5 w-56 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-xl p-1">
              {recentMemos.map((m, i) => (
                <button key={i} onMouseDown={(e) => { e.preventDefault(); opts.update({ memo: m }); setPicker(null); }}
                  className="w-full px-2 py-1.5 rounded text-[12px] text-left text-[var(--text)] hover:bg-[var(--bg-surface)] truncate">
                  <span className="text-[var(--text-dim)] mono-number">{i + 1}.</span> {m}
                </button>
              ))}
              {recentMemos.length === 0 && <div className="px-2 py-2 text-[11px] text-[var(--text-dim)]">저장한 적요가 아직 없습니다</div>}
            </div>
          )}
        </td>
        <td className={`${TD} p-0 min-w-[120px]`}>
          <input value={l.memo} onChange={(e) => opts.update({ memo: e.target.value })} placeholder="적요" className={IN} />
        </td>
      </tr>
    );
  };

  let rowNo = 0;
  const sourceBadge = (s: string) => (s !== "manual" ? <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-500 font-semibold align-middle">AI</span> : null);
  const emptyRowGubuns: Gubun[] = pendType === "cash_out" ? ["1"] : pendType === "cash_in" ? ["2"] : pendType === "transfer" ? ["3", "4"] : ["1", "2", "3", "4"];

  return (
    <div className="space-y-4" onKeyDown={onGridKey}>
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">전표입력</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">일반전표 분개 그리드 — 빈 행에서 바로 입력, 셀 클릭으로 인라인 수정. 차변·대변이 일치해야 저장됩니다</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/partners/reconciliation" className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">← 거래 매칭</Link>
          <button onClick={deleteSelected} disabled={busy || selected.size === 0}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-red-400 hover:border-red-400/40 disabled:opacity-40">
            삭제{selected.size ? ` (${selected.size})` : ""}</button>
          <button onClick={save} disabled={!canSave}
            className="px-5 py-2 text-xs font-bold rounded-lg bg-[var(--primary)] text-white hover:opacity-90 disabled:opacity-40">
            {busy ? "저장 중..." : "저장"}</button>
        </div>
      </div>

      {acctFetched && !dbReady && (
        <div className="px-4 py-3 rounded-xl bg-amber-500/8 border border-amber-500/25 text-xs text-amber-600 font-semibold">
          ⚠️ 전표 시스템 DB(계정과목 마스터)가 아직 적용되지 않았습니다 — 적용 후 사용할 수 있습니다.
        </div>
      )}

      {/* 일자 + 안내 */}
      <div className="glass-card px-4 py-3 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs">
          <span className="font-semibold text-[var(--text-muted)]">일자</span>
          <input type="date" value={entryDate}
            onChange={(e) => { if (!e.target.value) return; if (dirty && !confirm("저장하지 않은 행이 있습니다. 일자를 바꾸면 사라집니다. 계속할까요?")) return; setEntryDate(e.target.value); setPend([]); setEdits({}); setSelected(new Set()); }}
            className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]" />
        </div>
        <span className="text-[11px] text-[var(--text-dim)]">전표번호: 일자별 자동 순번 · 구분 1.출금=대변 보통예금 자동 / 2.입금=차변 자동 / 3.차변·4.대변=대체 · 행 우클릭=삽입/복사/삭제</span>
      </div>

      {/* ── 단일 분개 그리드 (§3-3-A: ☑|No|구분|계정코드|계정명|거래처코드|거래처명|차변|대변|적요코드|적요) ── */}
      <div className="glass-card" style={{ overflow: "visible" }}>
        <div className="overflow-x-auto" style={{ overflowY: "visible" }}>
          <table ref={tableRef} className="w-full text-xs border-collapse" style={{ minWidth: 1080 }}>
            <thead>
              <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="px-2 py-2.5 w-8 text-center font-semibold">
                  <input type="checkbox"
                    checked={entries.length + pend.length > 0 && selected.size >= entries.length + pend.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set([...entries.map((x) => `s:${x.id}`), ...pend.map((p) => `p:${p.key}`)]) : new Set())} />
                </th>
                <th className="px-2 py-2.5 w-9 text-center font-semibold">No</th>
                <th className="px-2 py-2.5 w-[64px] text-left font-semibold border-l border-[var(--border)]/50">구분</th>
                <th className="px-2 py-2.5 w-[72px] text-left font-semibold border-l border-[var(--border)]/50">계정코드</th>
                <th className="px-2 py-2.5 text-left font-semibold border-l border-[var(--border)]/50 min-w-[110px]">계정명</th>
                <th className="px-2 py-2.5 w-[100px] text-left font-semibold border-l border-[var(--border)]/50">거래처코드</th>
                <th className="px-2 py-2.5 text-left font-semibold border-l border-[var(--border)]/50 min-w-[110px]">거래처명</th>
                <th className="px-2 py-2.5 w-[110px] text-right font-semibold border-l border-[var(--border)]/50">차변</th>
                <th className="px-2 py-2.5 w-[110px] text-right font-semibold border-l border-[var(--border)]/50">대변</th>
                <th className="px-2 py-2.5 w-[64px] text-center font-semibold border-l border-[var(--border)]/50">적요코드</th>
                <th className="px-2 py-2.5 text-left font-semibold border-l border-[var(--border)]/50 min-w-[120px]">적요</th>
              </tr>
            </thead>
            <tbody>
              {/* 저장된 전표 — 셀 클릭 시 인라인 편집 버퍼로 전환 */}
              {entries.map((e) => {
                const buf = edits[e.id];
                if (buf) {
                  const st = editStat(buf);
                  return (
                    <Fragment key={e.id}>
                      {buf.lines.map((l, i) => { rowNo += 1; return editableRow(l, `e:${e.id}:${l.key}`, rowNo, { gubunFixed: l.gubun === "1" || l.gubun === "2", first: i === 0, update: (p) => setEditLine(e.id, l.key, p) }); })}
                      <tr className="bg-amber-500/5">
                        <td colSpan={11} className="px-3 py-1 text-[10px] font-semibold">
                          <span className={st.ok ? "text-emerald-500" : "text-amber-500"}>
                            {st.ok ? `✅ 전표 #${e.voucher_no ?? "—"} 수정 중 — 차대일치, [저장]으로 반영` : `⚠️ 전표 #${e.voucher_no ?? "—"} 수정 중 — ${st.d !== st.c ? `차액 ${won(Math.abs(st.d - st.c))}` : "계정 미지정"} (차대일치해야 저장)`}
                          </span>
                          <button onClick={() => setEdits((es) => { const n = { ...es }; delete n[e.id]; return n; })} className="ml-2 underline text-[var(--text-dim)] hover:text-[var(--text)]">수정 취소</button>
                        </td>
                      </tr>
                    </Fragment>
                  );
                }
                return e.lines.map((l, i) => {
                  rowNo += 1;
                  const rowId = `s:${e.id}#${i}`;
                  return (
                    <tr key={rowId} className={`border-b border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/40 ${i === 0 ? "border-t-2 border-t-[var(--border)]" : ""}`}
                      onContextMenu={(ev) => { ev.preventDefault(); setCtx({ x: ev.clientX, y: ev.clientY, rowId }); }}
                      title={`전표 #${e.voucher_no ?? "—"}${e.description ? ` · ${e.description}` : ""} — 셀 클릭으로 인라인 수정`}>
                      <td className="px-2 py-1 text-center">
                        <input type="checkbox" checked={selected.has(`s:${e.id}`)}
                          onChange={(ev) => setSelected((s) => { const n = new Set(s); if (ev.target.checked) n.add(`s:${e.id}`); else n.delete(`s:${e.id}`); return n; })}
                          title="전표 단위 선택 (분개 균형 유지를 위해 전표째 삭제)" />
                      </td>
                      <td className="px-2 py-1 text-center text-[var(--text-dim)] mono-number">{rowNo}</td>
                      <td className={`${TD} text-[11px] font-semibold text-[var(--text-muted)] cursor-text`} onClick={() => enterEdit(e)}>{GUBUN_LABEL[savedGubun(e.voucher_type, l.debit)]}{i === 0 && sourceBadge(e.source)}</td>
                      <td className={`${TD} mono-number text-[var(--text-muted)] cursor-text`} onClick={() => enterEdit(e)}>{l.account?.code || "—"}</td>
                      <td className={`${TD} text-[var(--text)] cursor-text`} onClick={() => enterEdit(e)}>{l.account?.name || "?"}</td>
                      <td className={`${TD} mono-number text-[var(--text-dim)] cursor-text`} onClick={() => enterEdit(e)}>{l.partner?.business_number || "—"}</td>
                      <td className={`${TD} text-[var(--text)] cursor-text`} onClick={() => enterEdit(e)}>{l.partner?.name || ""}</td>
                      <td className={`${TD} text-right mono-number cursor-text ${l.debit ? "text-[var(--text)]" : ""}`} onClick={() => enterEdit(e)}>{l.debit ? l.debit.toLocaleString() : ""}</td>
                      <td className={`${TD} text-right mono-number cursor-text ${l.credit ? "text-[var(--text)]" : ""}`} onClick={() => enterEdit(e)}>{l.credit ? l.credit.toLocaleString() : ""}</td>
                      <td className={`${TD} text-center text-[var(--text-dim)]`}>—</td>
                      <td className={`${TD} text-[var(--text-muted)] cursor-text max-w-[180px] overflow-hidden text-ellipsis`} onClick={() => enterEdit(e)}>{l.memo || e.description}</td>
                    </tr>
                  );
                });
              })}

              {/* 새 전표 작성 행 */}
              {pend.map((l, i) => { rowNo += 1; return editableRow(l, `p:${l.key}`, rowNo, { gubunFixed: l.gubun === "1" || l.gubun === "2", first: i === 0, update: (p) => setPendLine(l.key, p) }); })}

              {/* 출금/입금 자동 현금 라인 */}
              {pendType && pendType !== "transfer" && (() => { rowNo += 1; return (
                <tr className="border-b border-[var(--border)]/40 bg-[var(--bg-surface)]/60">
                  <td className="px-2 py-1 text-center text-[10px] text-[var(--text-dim)]">자동</td>
                  <td className="px-2 py-1 text-center text-[var(--text-dim)] mono-number">{rowNo}</td>
                  <td className={`${TD} text-[11px] font-semibold text-[var(--text-muted)]`}>{pendType === "cash_out" ? "4.대변" : "3.차변"}</td>
                  <td className={`${TD} mono-number text-[var(--text-muted)]`}>{cashAcct?.code || "101"}</td>
                  <td className={`${TD} text-[var(--text-muted)] font-semibold`}>{cashAcct?.name || "보통예금"} (자동)</td>
                  <td className={`${TD} text-[var(--text-dim)]`}>—</td><td className={TD} />
                  <td className={`${TD} text-right mono-number font-semibold`}>{pendType === "cash_in" && autoAmt ? autoAmt.toLocaleString() : ""}</td>
                  <td className={`${TD} text-right mono-number font-semibold`}>{pendType === "cash_out" && autoAmt ? autoAmt.toLocaleString() : ""}</td>
                  <td className={`${TD} text-center text-[var(--text-dim)]`}>—</td>
                  <td className={`${TD} text-[var(--text-dim)] text-[10px]`}>{pendType === "cash_out" ? "출금 상대계정 (자동)" : "입금 상대계정 (자동)"}</td>
                </tr>
              ); })()}

              {/* 빈 행 — 구분 선택으로 바로 입력 시작 (§3-3-A: 항상 마지막에 빈 행 1개) */}
              <tr className="bg-[var(--bg-surface)]/30">
                <td className="px-2 py-1.5" />
                <td className="px-2 py-1.5 text-center text-[var(--text-dim)] mono-number">{rowNo + 1}</td>
                <td className={`${TD} p-0 w-[64px]`}>
                  <select value="" onChange={(e) => e.target.value && startPend(e.target.value as Gubun)} disabled={!dbReady}
                    className={`${IN} cursor-pointer text-[var(--text-dim)]`} title="구분을 선택하면 입력이 시작됩니다 (1.출금 2.입금 3.차변 4.대변)">
                    <option value="">구분▾</option>
                    {emptyRowGubuns.map((g) => <option key={g} value={g}>{GUBUN_LABEL[g]}</option>)}
                  </select>
                </td>
                <td colSpan={8} className={`${TD} text-[var(--text-dim)] text-[11px]`}>{pend.length === 0 && editIds.length === 0 ? "빈 행 — 구분을 선택하고 바로 이어서 입력하세요" : "행 끝 적요에서 Enter = 새 행"}</td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--border)] bg-[var(--bg-surface)] font-bold">
                <td colSpan={7} className="px-3 py-2.5 text-right text-[var(--text-muted)]">합계</td>
                <td className="px-2 py-2.5 text-right mono-number text-[var(--text)]">{totalD.toLocaleString()}</td>
                <td className="px-2 py-2.5 text-right mono-number text-[var(--text)]">{totalC.toLocaleString()}</td>
                <td colSpan={2} className={`px-2 py-2.5 text-[11px] font-bold ${diff === 0 && totalD > 0 ? "text-emerald-500" : diff === 0 ? "text-[var(--text-dim)]" : "text-red-500"}`}>
                  {totalD === 0 ? "" : diff === 0 ? "✅ 차대일치" : `⚠️ 차액 ${won(Math.abs(diff))} — 저장 불가`}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
        {(pendMissing || (pendFilled.length > 0 && !pendBalanced)) && (
          <div className="px-4 py-2 border-t border-[var(--border)] text-[11px] font-semibold text-amber-500">
            {!pendBalanced && pendFilled.length > 0 && <span>새 전표 차액 {won(Math.abs(pendTotalD - pendTotalC))} · </span>}
            {pendMissing && <span>계정과목 미지정 행 있음 · </span>}
            저장하려면 차대일치 + 계정 지정이 필요합니다
          </div>
        )}
      </div>

      {/* 우클릭 메뉴 (§3-3-A: 행 삽입/복사/삭제) */}
      {ctx && (
        <div className="fixed z-[80] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-xl p-1 text-xs"
          style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
          {ctx.rowId.startsWith("p:") ? (
            <>
              <button onClick={() => ctxAction("insert")} className="block w-full px-3 py-1.5 text-left rounded hover:bg-[var(--bg-surface)] text-[var(--text)]">행 삽입</button>
              <button onClick={() => ctxAction("copy")} className="block w-full px-3 py-1.5 text-left rounded hover:bg-[var(--bg-surface)] text-[var(--text)]">행 복사</button>
              <button onClick={() => ctxAction("delete")} className="block w-full px-3 py-1.5 text-left rounded hover:bg-[var(--bg-surface)] text-red-400">행 삭제</button>
            </>
          ) : (
            <>
              <button onClick={() => ctxAction("insert")} className="block w-full px-3 py-1.5 text-left rounded hover:bg-[var(--bg-surface)] text-[var(--text)]">전표 수정 (인라인)</button>
              <button onClick={() => ctxAction("copy")} className="block w-full px-3 py-1.5 text-left rounded hover:bg-[var(--bg-surface)] text-[var(--text)]">행 복사 (새 전표로)</button>
              <button onClick={() => ctxAction("delete")} className="block w-full px-3 py-1.5 text-left rounded hover:bg-[var(--bg-surface)] text-red-400">전표 삭제</button>
            </>
          )}
        </div>
      )}

      <p className="text-[11px] text-[var(--text-dim)]">
        ※ 전표입력은 장부 기록입니다 — 계산서↔입금 대사(미수금 차감)는 <Link href="/partners/reconciliation" className="text-[var(--primary)] hover:underline">거래 매칭</Link>에서 별도 처리 · 수정은 변경 전 값이 이력(journal_entry_audits)으로 보존되고, 마감(잠금)된 월은 저장·수정·삭제가 차단됩니다
      </p>
    </div>
  );
}
