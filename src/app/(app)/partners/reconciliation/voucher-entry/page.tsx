"use client";

// 전표입력 — 2단 구조 (2026-06-12 핸드오프 v2 확정본 §3-3).
//   [상단] 입력 영역: 일자 + 구분(대체/출금/입금 — 헤더 단위) + 분개 행(No/구분/계정과목/거래처/적요/차변/대변)
//     출금 = 대변 보통예금(101) 자동행 / 입금 = 차변 자동 / 대체 = 양쪽 직접. 차대일치 상시 표시 + 저장 차단.
//   [하단] 전표목록 그리드(§3-3-A 사용자 지정 스펙, 순서 고정):
//     ☑ | No | 구분(1.출금/2.입금/3.차변/4.대변) | 계정코드 | 계정명 | 거래처코드 | 거래처명 | 차변 | 대변 | 적요코드 | 적요
//     셀 클릭 = 인라인 수정(전표 단위 버퍼, 차대 재검증) · 행 우클릭 = 삽입/복사/삭제 · 체크박스 = 선택 삭제
//     마지막에 빈 행 1개 — 클릭하면 상단 입력 영역으로 포커스.
//   [§3-3-B] 저장 → 새로고침 없이 하단 목록 즉시 반영(invalidateQueries) + 새 행 하이라이트·자동 스크롤 +
//     "전표 N번 저장됨" 토스트. 실패 시 입력값 유지. 일자는 입력·목록이 같은 일자를 공유해 불일치 없음.
//   차대일치는 DB(save/update_manual_voucher RPC)에서도 재검증(이중). 수정은 journal_entry_audits 이력 보존.
//   삭제 = voucher_reject(행 보존). 마감(잠금) 월은 서버가 저장·수정·삭제 차단.

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
const GUBUN_SHORT: Record<Gubun, string> = { "1": "차변", "2": "대변", "3": "차변", "4": "대변" }; // 상단 입력 영역 표기
type VType = "transfer" | "cash_out" | "cash_in";
const VTYPES: { id: VType; label: string; desc: string }[] = [
  { id: "transfer", label: "대체", desc: "통장·외상 등 일반 거래 — 차/대 직접 입력" },
  { id: "cash_out", label: "출금", desc: "돈이 나감 — 대변 보통예금 자동" },
  { id: "cash_in", label: "입금", desc: "돈이 들어옴 — 차변 보통예금 자동" },
];
type PLine = { key: number; gubun: Gubun; account: Acct | null; partner: Pt | null; memo: string; debit: string; credit: string };
type SavedLine = { account: Acct | null; partner: Pt | null; memo: string; debit: number; credit: number };
type SavedEntry = { id: string; voucher_no: number | null; voucher_type: string | null; description: string; source: string; lines: SavedLine[] };

let K = 1;
const AR_AP_CODES = new Set(["108", "251"]);
const MEMO_KEY = "voucher-recent-memos";

// 저장 라인의 §3-3-A 구분 표기 — 출금/입금 전표는 더존처럼 1.출금/2.입금
const savedGubun = (vt: string | null, debit: number): Gubun =>
  vt === "cash_out" ? (debit > 0 ? "1" : "4") : vt === "cash_in" ? (debit > 0 ? "3" : "2") : debit > 0 ? "3" : "4";

export default function VoucherEntryPage() {
  const { user, role } = useUser();
  const companyId = user?.company_id ?? null;
  const qc = useQueryClient();
  const { toast } = useToast();

  const [entryDate, setEntryDate] = useState(todayKst());
  const [vtype, setVtype] = useState<VType>("transfer");
  const [pend, setPend] = useState<PLine[]>([]);               // 상단 입력 영역 행
  const [edits, setEdits] = useState<Record<string, { desc: string; lines: PLine[] }>>({}); // 하단 인라인 편집 버퍼
  const [selected, setSelected] = useState<Set<string>>(new Set()); // "s:entryId"
  const [picker, setPicker] = useState<{ kind: "acct" | "pt" | "memo"; rowId: string; q: string } | null>(null);
  const [ctx, setCtx] = useState<{ x: number; y: number; rowId: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [flashId, setFlashId] = useState<string | null>(null); // §3-3-B 방금 저장한 전표 하이라이트
  const [recentMemos, setRecentMemos] = useState<string[]>([]);
  const topRef = useRef<HTMLDivElement | null>(null);
  const flashScrolled = useRef(false);
  useEffect(() => { try { setRecentMemos(JSON.parse(localStorage.getItem(MEMO_KEY) || "[]")); } catch { /* noop */ } }, []);
  useEffect(() => { const close = () => setCtx(null); window.addEventListener("click", close); return () => window.removeEventListener("click", close); }, []);
  useEffect(() => {
    if (!flashId) return;
    const t = setTimeout(() => setFlashId(null), 2500);
    return () => clearTimeout(t);
  }, [flashId]);

  // 상단 행 초기화 — 구분에 맞는 기본 2행(대체: 차변+대변 / 출금: 차변 / 입금: 대변)
  const freshRows = (t: VType): PLine[] => {
    const mk = (g: Gubun): PLine => ({ key: K++, gubun: g, account: null, partner: null, memo: "", debit: "", credit: "" });
    return t === "cash_out" ? [mk("1"), mk("1")] : t === "cash_in" ? [mk("2"), mk("2")] : [mk("3"), mk("4")];
  };
  useEffect(() => { setPend(freshRows("transfer")); }, []); // eslint-disable-line react-hooks/exhaustive-deps

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

  // ── 하단 목록: 해당 일자 확정 전표 ──
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

  // ── 상단 입력 파생값 (출금/입금은 자동 현금 라인 포함해 균형 계산) ──
  const pendFilled = pend.filter((l) => num(l.debit) > 0 || num(l.credit) > 0);
  const pendDebit = pendFilled.reduce((s, l) => s + num(l.debit), 0);
  const pendCredit = pendFilled.reduce((s, l) => s + num(l.credit), 0);
  const autoAmt = vtype === "cash_out" ? pendDebit : vtype === "cash_in" ? pendCredit : 0;
  const pendTotalD = pendDebit + (vtype === "cash_in" ? autoAmt : 0);
  const pendTotalC = pendCredit + (vtype === "cash_out" ? autoAmt : 0);
  const pendDiff = pendTotalD - pendTotalC;
  const pendBalanced = pendTotalD > 0 && pendDiff === 0;
  const pendMissing = pendFilled.some((l) => !l.account);
  const pendOk = pendFilled.length > 0 && pendBalanced && !pendMissing && (vtype !== "transfer" || pendFilled.length >= 2) && (vtype === "transfer" || !!cashAcct);

  // 하단 편집 버퍼 파생값
  const editStat = (b: { lines: PLine[] }) => {
    const fl = b.lines.filter((l) => num(l.debit) > 0 || num(l.credit) > 0);
    const d = fl.reduce((s, l) => s + num(l.debit), 0), c = fl.reduce((s, l) => s + num(l.credit), 0);
    return { d, c, ok: fl.length >= 2 && d > 0 && d === c && !fl.some((l) => !l.account) };
  };
  const editIds = Object.keys(edits);
  const editsOk = editIds.every((id) => editStat(edits[id]).ok);
  const canSave = dbReady && !busy && ((pendFilled.length > 0 && pendOk) || editIds.length > 0) && editsOk && (pendFilled.length === 0 || pendOk);

  // ── 행 조작 ──
  const rowGubun = (): Gubun => (vtype === "cash_out" ? "1" : vtype === "cash_in" ? "2" : "3");
  const newLine = (g?: Gubun): PLine => ({ key: K++, gubun: g ?? rowGubun(), account: null, partner: null, memo: "", debit: "", credit: "" });
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
  const changeVtype = (t: VType) => {
    setVtype(t);
    setPend((ls) => {
      const g: Gubun = t === "cash_out" ? "1" : t === "cash_in" ? "2" : "3";
      return ls.length === 0 ? freshRows(t) : ls.map((l) => ({
        ...l,
        gubun: t === "transfer" ? (num(l.credit) > 0 ? "4" : "3") : g,
        debit: t === "cash_in" ? "" : l.debit,    // 입금 = 차변 잠금(자동)
        credit: t === "cash_out" ? "" : l.credit, // 출금 = 대변 잠금(자동)
      }));
    });
  };
  const focusTop = () => {
    const el = topRef.current?.querySelector<HTMLElement>("input:not([readonly])");
    el?.focus();
    topRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  // 금액 입력 — 한 행 한쪽만. 대체 행은 입력하는 쪽으로 구분 자동 전환.
  const amountPatch = (l: PLine, side: "debit" | "credit", v: string): Partial<PLine> => {
    const p: Partial<PLine> = { [side]: comma(v) } as Partial<PLine>;
    if (num(v) > 0) {
      (p as any)[side === "debit" ? "credit" : "debit"] = "";
      if (l.gubun === "3" || l.gubun === "4") p.gubun = side === "debit" ? "3" : "4";
    }
    return p;
  };

  // 키보드(상단): Enter = 다음 칸, 마지막 칸이면 새 행 (마우스 없이 연속 입력)
  const onTopKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const t = e.target as HTMLElement;
    if (!/^(INPUT|SELECT)$/.test(t.tagName)) return;
    e.preventDefault();
    const els = Array.from(topRef.current?.querySelectorAll<HTMLElement>("input:not([readonly]), select") || []);
    const i = els.indexOf(t);
    if (i >= 0 && i < els.length - 1) els[i + 1].focus();
    else setPend((ls) => [...ls, newLine()]);
  };

  const rememberMemos = (memos: string[]) => {
    const next = [...new Set([...memos.filter(Boolean), ...recentMemos])].slice(0, 9);
    setRecentMemos(next);
    try { localStorage.setItem(MEMO_KEY, JSON.stringify(next)); } catch { /* noop */ }
  };

  const linePayload = (ls: PLine[]) => ls.filter((l) => num(l.debit) > 0 || num(l.credit) > 0)
    .map((l) => ({ account_id: l.account!.id, debit: num(l.debit), credit: num(l.credit), memo: l.memo, partner_id: l.partner?.id ?? "" }));
  const errMsg = (m: string) =>
    m.includes("PERIOD_LOCKED") ? "마감(잠금)된 회계기간입니다 — 저장/수정/삭제 불가"
      : m.includes("UNBALANCED") ? "차변·대변 합계가 일치하지 않습니다"
      : m.includes("does not exist") ? "전표 수정 DB(update_manual_voucher)가 아직 적용되지 않았습니다" : m;

  // ── 저장: 하단 편집 전표 커밋 + 상단 새 전표 저장 → §3-3-B 즉시 반영(리페치+하이라이트+스크롤+N번 토스트) ──
  //   실패 시 입력값 유지(성공해야만 초기화).
  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      for (const id of editIds) {
        const b = edits[id];
        const { error } = await db.rpc("update_manual_voucher", { p_entry_id: id, p_description: b.desc, p_lines: linePayload(b.lines) });
        if (error) throw new Error(errMsg(String(error.message)));
      }
      let newId: string | null = null;
      if (pendFilled.length > 0) {
        const payload = linePayload(pend);
        if (vtype !== "transfer" && cashAcct && autoAmt > 0) {
          payload.push({ account_id: cashAcct.id, debit: vtype === "cash_in" ? autoAmt : 0, credit: vtype === "cash_out" ? autoAmt : 0, memo: pendFilled[0]?.memo || "", partner_id: "" });
        }
        const { data, error } = await db.rpc("save_manual_voucher", {
          p_entry_date: entryDate, p_voucher_type: vtype, p_description: pendFilled[0]?.memo || "", p_lines: payload,
        });
        if (error) throw new Error(errMsg(String(error.message)));
        newId = data as string;
      }
      rememberMemos([...pendFilled.map((l) => l.memo), ...editIds.flatMap((id) => edits[id].lines.map((l) => l.memo))]);
      setEdits({});
      if (newId) {
        setPend(freshRows(vtype)); // 상단 = "새 전표" 상태로 초기화
        flashScrolled.current = false;
        setFlashId(newId);
        const { data: saved } = await db.from("journal_entries").select("voucher_no").eq("id", newId).maybeSingle();
        toast(`전표 ${saved?.voucher_no ?? ""}번 저장됨 — 하단 목록에 추가`, "success");
      } else {
        toast("전표 수정 저장 완료", "success");
      }
      await qc.invalidateQueries({ queryKey: ["vouchers-of-day"] });
    } catch (e: any) {
      toast(e?.message || "저장 실패", "error"); // 입력값은 그대로 유지
    } finally { setBusy(false); }
  };

  // ── 선택 삭제(하단): 전표 단위 voucher_reject(행 보존 이력) ──
  const deleteSelected = async () => {
    const entryIds = [...new Set([...selected].map((s) => s.slice(2)))];
    if (entryIds.length === 0) { toast("삭제할 전표를 선택하세요", "info"); return; }
    if (!confirm(`저장된 전표 ${entryIds.length}건을 삭제할까요?\n(분개 균형 유지를 위해 전표 단위로 삭제되며, 이력은 보존됩니다)`)) return;
    setBusy(true);
    try {
      for (const id of entryIds) {
        const { error } = await db.rpc("voucher_reject", { p_entry_id: id });
        if (error) throw new Error(errMsg(String(error.message)));
        setEdits((es) => { const n = { ...es }; delete n[id]; return n; });
      }
      setSelected(new Set());
      qc.invalidateQueries({ queryKey: ["vouchers-of-day"] });
      toast(`전표 ${entryIds.length}건 삭제(이력 보존)`, "info");
    } catch (e: any) {
      toast(e?.message || "삭제 실패", "error");
    } finally { setBusy(false); }
  };

  // 우클릭 메뉴 — 상단(p:)·하단 편집 버퍼(e:)·하단 저장 행(s:) 행 삽입/복사/삭제 (§3-3-A)
  const ctxAction = (action: "insert" | "copy" | "delete") => {
    if (!ctx) return;
    const id = ctx.rowId;
    if (id.startsWith("p:")) {
      const key = Number(id.slice(2));
      const idx = pend.findIndex((l) => l.key === key);
      const l = pend[idx];
      if (action === "insert" && l) setPend((ls) => [...ls.slice(0, idx), newLine(l.gubun), ...ls.slice(idx)]);
      if (action === "copy" && l) setPend((ls) => [...ls, { ...l, key: K++ }]);
      if (action === "delete") setPend((ls) => (ls.length <= 1 ? ls : ls.filter((x) => x.key !== key)));
    } else if (id.startsWith("e:")) {
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
        setPend((ls) => [...ls, { key: K++, gubun: vtype === "transfer" ? (l.debit > 0 ? "3" : "4") : rowGubun(), account: l.account, partner: l.partner, memo: l.memo, debit: vtype === "cash_in" ? "" : (l.debit ? l.debit.toLocaleString() : ""), credit: vtype === "cash_out" ? "" : (l.credit ? l.credit.toLocaleString() : "") }]);
        focusTop();
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

  // 계정과목 자동완성 셀 (상단·하단 편집 공용)
  const acctCell = (l: PLine, rowId: string, update: (p: Partial<PLine>) => void, withName: boolean) => (
    <td className={`${TD} p-0 relative ${withName ? "w-[72px]" : "min-w-[160px]"}`}>
      <input value={picker?.kind === "acct" && picker.rowId === rowId ? picker.q : (withName ? (l.account?.code || "") : (l.account ? `${l.account.name} (${l.account.code})` : ""))}
        onChange={(e) => setPicker({ kind: "acct", rowId, q: e.target.value })}
        onFocus={() => setPicker({ kind: "acct", rowId, q: "" })}
        onBlur={() => setTimeout(() => setPicker((p) => (p?.rowId === rowId && p.kind === "acct" ? null : p)), 150)}
        placeholder={withName ? "코드" : "103 / 보통예금..."} className={`${IN} ${withName ? "mono-number" : ""}`} />
      {picker?.kind === "acct" && picker.rowId === rowId && (
        <div className="absolute z-30 left-0 top-full mt-0.5 w-64 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-xl p-1">
          {acctMatches(picker.q).map((a) => (
            <button key={a.id} onMouseDown={(e) => { e.preventDefault(); update({ account: a }); setPicker(null); }}
              className="w-full flex justify-between px-2 py-1.5 rounded text-[12px] text-[var(--text)] hover:bg-[var(--bg-surface)]">
              <span>{a.name}</span><span className="text-[var(--text-dim)] mono-number">{a.code}</span>
            </button>
          ))}
          {acctMatches(picker.q).length === 0 && <div className="px-2 py-2 text-[11px] text-[var(--text-dim)]">{dbReady ? "검색 결과 없음" : "계정과목 마스터 미적용"}</div>}
        </div>
      )}
    </td>
  );

  // 거래처 자동완성 셀
  const ptCell = (l: PLine, rowId: string, update: (p: Partial<PLine>) => void) => {
    const arApWarn = l.account && AR_AP_CODES.has(l.account.code) && !l.partner;
    return (
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
              <button key={p.id} onMouseDown={(e) => { e.preventDefault(); update({ partner: p }); setPicker(null); }}
                className="w-full px-2 py-1.5 rounded text-[12px] text-left text-[var(--text)] hover:bg-[var(--bg-surface)] truncate">
                {p.name}{p.business_number ? <span className="text-[var(--text-dim)] mono-number"> · {p.business_number}</span> : null}
              </button>
            ))}
            {l.partner && <button onMouseDown={(e) => { e.preventDefault(); update({ partner: null }); setPicker(null); }} className="w-full px-2 py-1 rounded text-[11px] text-[var(--text-dim)] text-left hover:bg-[var(--bg-surface)]">지우기</button>}
          </div>
        )}
      </td>
    );
  };

  // 적요 셀(+자주 쓰는 적요)
  const memoCell = (l: PLine, rowId: string, update: (p: Partial<PLine>) => void) => (
    <td className={`${TD} p-0 min-w-[140px] relative`}>
      <div className="flex items-center">
        <input value={l.memo} onChange={(e) => update({ memo: e.target.value })} placeholder="적요" className={IN} />
        {recentMemos.length > 0 && (
          <button onClick={() => setPicker({ kind: "memo", rowId, q: "" })} tabIndex={-1}
            className="pr-1 text-[10px] text-[var(--text-dim)] hover:text-[var(--primary)] shrink-0" title="자주 쓰는 적요">▾</button>
        )}
      </div>
      {picker?.kind === "memo" && picker.rowId === rowId && (
        <div className="absolute z-30 right-0 top-full mt-0.5 w-56 max-h-52 overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-xl p-1">
          {recentMemos.map((m, i) => (
            <button key={i} onMouseDown={(e) => { e.preventDefault(); update({ memo: m }); setPicker(null); }}
              className="w-full px-2 py-1.5 rounded text-[12px] text-left text-[var(--text)] hover:bg-[var(--bg-surface)] truncate">
              <span className="text-[var(--text-dim)] mono-number">{i + 1}.</span> {m}
            </button>
          ))}
        </div>
      )}
    </td>
  );

  // 차/대 금액 셀
  const amtCells = (l: PLine, update: (p: Partial<PLine>) => void) => {
    const debitOff = l.gubun === "4" || l.gubun === "2";
    const creditOff = l.gubun === "3" || l.gubun === "1";
    return (
      <>
        <td className={`${TD} p-0 w-[110px]`}>
          <input inputMode="numeric" value={l.debit} readOnly={debitOff}
            onChange={(e) => update(amountPatch(l, "debit", e.target.value))}
            placeholder={debitOff ? "" : "0"} className={`${IN} text-right mono-number ${debitOff ? "opacity-30 cursor-default" : ""}`} />
        </td>
        <td className={`${TD} p-0 w-[110px]`}>
          <input inputMode="numeric" value={l.credit} readOnly={creditOff}
            onChange={(e) => update(amountPatch(l, "credit", e.target.value))}
            placeholder={creditOff ? "" : "0"} className={`${IN} text-right mono-number ${creditOff ? "opacity-30 cursor-default" : ""}`} />
        </td>
      </>
    );
  };

  let listNo = 0;
  const sourceBadge = (s: string) => (s !== "manual" ? <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-500 font-semibold align-middle">AI</span> : null);

  return (
    <div className="space-y-4">
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-extrabold text-[var(--text)]">전표입력</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">상단에서 분개 입력 → 저장하면 하단 전표목록에 바로 쌓입니다 · 차변·대변이 일치해야 저장됩니다</p>
        </div>
        <div className="flex items-center gap-2">
          <Link href="/partners/reconciliation" className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">← 거래 매칭</Link>
          <button onClick={() => { setPend(freshRows(vtype)); setEdits({}); }} disabled={busy}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] disabled:opacity-40">새 전표</button>
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

      {/* ══ 상단: 입력 영역 (§3-3) ══ */}
      <div ref={topRef} onKeyDown={onTopKey} className="glass-card" style={{ overflow: "visible" }}>
        <div className="px-4 py-3 border-b border-[var(--border)] flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-1.5 text-xs">
            <span className="font-semibold text-[var(--text-muted)]">일자</span>
            <input type="date" value={entryDate}
              onChange={(e) => { if (!e.target.value) return; setEntryDate(e.target.value); setEdits({}); setSelected(new Set()); }}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)]" />
          </div>
          <span className="text-[11px] text-[var(--text-dim)]">전표번호: 자동(일자별 순번)</span>
          <div className="flex items-center gap-1.5 text-xs ml-auto">
            <span className="font-semibold text-[var(--text-muted)]">구분</span>
            <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-0.5">
              {VTYPES.map((t) => (
                <button key={t.id} onClick={() => changeVtype(t.id)} title={t.desc}
                  className={`px-3.5 py-1.5 rounded-lg text-[11px] font-bold transition ${vtype === t.id ? "bg-[var(--primary)] text-white" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}>
                  {t.label}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="overflow-x-auto" style={{ overflowY: "visible" }}>
          <table className="w-full text-xs border-collapse" style={{ minWidth: 860 }}>
            <thead>
              <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="px-2 py-2 w-9 text-center font-semibold">No</th>
                <th className="px-2 py-2 w-[56px] text-left font-semibold border-l border-[var(--border)]/50">구분</th>
                <th className="px-2 py-2 text-left font-semibold border-l border-[var(--border)]/50 min-w-[160px]">계정과목</th>
                <th className="px-2 py-2 text-left font-semibold border-l border-[var(--border)]/50 min-w-[110px]">거래처</th>
                <th className="px-2 py-2 text-left font-semibold border-l border-[var(--border)]/50 min-w-[140px]">적요</th>
                <th className="px-2 py-2 w-[110px] text-right font-semibold border-l border-[var(--border)]/50">차변</th>
                <th className="px-2 py-2 w-[110px] text-right font-semibold border-l border-[var(--border)]/50">대변</th>
                <th className="px-2 py-2 w-8" />
              </tr>
            </thead>
            <tbody>
              {pend.map((l, i) => (
                <tr key={l.key} className="border-b border-[var(--border)]/40"
                  onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, rowId: `p:${l.key}` }); }}>
                  <td className="px-2 py-1 text-center text-[var(--text-dim)] mono-number">{i + 1}</td>
                  <td className={`${TD} w-[56px]`}>
                    {vtype === "transfer" ? (
                      <select value={l.gubun} onChange={(e) => setPendLine(l.key, { gubun: e.target.value as Gubun })} className={`${IN} cursor-pointer p-0`}>
                        <option value="3">차변</option><option value="4">대변</option>
                      </select>
                    ) : (
                      <span className="text-[11px] font-semibold text-[var(--text-muted)]">{GUBUN_SHORT[l.gubun]}</span>
                    )}
                  </td>
                  {acctCell(l, `p:${l.key}`, (p) => setPendLine(l.key, p), false)}
                  {ptCell(l, `p:${l.key}`, (p) => setPendLine(l.key, p))}
                  {memoCell(l, `p:${l.key}`, (p) => setPendLine(l.key, p))}
                  {amtCells(l, (p) => setPendLine(l.key, p))}
                  <td className="text-center">
                    <button onClick={() => setPend((ls) => (ls.length <= 1 ? ls : ls.filter((x) => x.key !== l.key)))}
                      className="text-[var(--text-dim)] hover:text-[var(--danger)] text-xs" title="행 삭제" tabIndex={-1}>✕</button>
                  </td>
                </tr>
              ))}
              {/* 출금/입금 자동 현금 라인 */}
              {vtype !== "transfer" && (
                <tr className="border-b border-[var(--border)]/40 bg-[var(--bg-surface)]/60">
                  <td className="px-2 py-1.5 text-center text-[10px] text-[var(--text-dim)]">자동</td>
                  <td className={`${TD} text-[11px] font-semibold text-[var(--text-muted)]`}>{vtype === "cash_out" ? "대변" : "차변"}</td>
                  <td className={`${TD} text-[var(--text-muted)] font-semibold`}>{cashAcct ? `${cashAcct.name} (${cashAcct.code})` : "보통예금 — 마스터 미적용"}</td>
                  <td className={TD} />
                  <td className={`${TD} text-[var(--text-dim)] text-[10px]`}>{vtype === "cash_out" ? "출금 상대계정 (자동)" : "입금 상대계정 (자동)"}</td>
                  <td className={`${TD} text-right mono-number font-semibold`}>{vtype === "cash_in" && autoAmt ? autoAmt.toLocaleString() : ""}</td>
                  <td className={`${TD} text-right mono-number font-semibold`}>{vtype === "cash_out" && autoAmt ? autoAmt.toLocaleString() : ""}</td>
                  <td />
                </tr>
              )}
              <tr>
                <td colSpan={8} className="px-3 py-1.5">
                  <button onClick={() => setPend((ls) => [...ls, newLine()])}
                    className="text-[12px] text-[var(--text-dim)] hover:text-[var(--primary)] font-semibold">+ 행 추가 <span className="text-[10px] opacity-60">(마지막 칸 Enter)</span></button>
                </td>
              </tr>
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-[var(--border)] bg-[var(--bg-surface)] font-bold">
                <td colSpan={5} className="px-3 py-2 text-right text-[var(--text-muted)]">합계</td>
                <td className="px-2 py-2 text-right mono-number text-[var(--text)]">{pendTotalD.toLocaleString()}</td>
                <td className="px-2 py-2 text-right mono-number text-[var(--text)]">{pendTotalC.toLocaleString()}</td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
        <div className={`px-4 py-2 border-t border-[var(--border)] text-xs font-bold flex items-center gap-3 ${pendBalanced ? "text-emerald-500" : pendTotalD + pendTotalC === 0 ? "text-[var(--text-dim)]" : "text-red-500"}`}>
          {pendTotalD + pendTotalC === 0 ? <span className="font-semibold">금액을 입력하세요</span>
            : pendBalanced ? <>✅ 차대일치 — 저장 가능</>
            : <>⚠️ 차액 {won(Math.abs(pendDiff))} ({pendDiff > 0 ? "대변 부족" : "차변 부족"}) — 저장 불가</>}
          {pendMissing && <span className="text-amber-500 font-semibold">· 계정과목 미지정 행 있음</span>}
        </div>
      </div>

      {/* ══ 하단: 전표목록 그리드 (§3-3-A 사용자 지정 스펙) ══ */}
      <div className="glass-card" style={{ overflow: "visible" }}>
        <div className="px-4 py-2.5 border-b border-[var(--border)] bg-[var(--bg-surface)] flex items-center justify-between">
          <span className="text-xs font-bold text-[var(--text)]">{entryDate} 전표목록 <span className="text-[var(--text-dim)] font-normal">— 셀 클릭 = 인라인 수정 · 행 우클릭 = 삽입/복사/삭제</span></span>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-[var(--text-dim)]">{entries.length}건</span>
            <button onClick={deleteSelected} disabled={busy || selected.size === 0}
              className="px-2.5 py-1 text-[11px] font-semibold rounded-lg bg-[var(--bg-card)] border border-[var(--border)] text-[var(--text-muted)] hover:text-red-400 hover:border-red-400/40 disabled:opacity-40">
              선택 삭제{selected.size ? ` (${selected.size})` : ""}</button>
          </div>
        </div>
        <div className="overflow-x-auto" style={{ overflowY: "visible" }}>
          <table className="w-full text-xs border-collapse" style={{ minWidth: 1080 }}>
            <thead>
              <tr className="bg-[var(--bg-surface)] text-[var(--text-muted)] border-b border-[var(--border)]">
                <th className="px-2 py-2.5 w-8 text-center font-semibold">
                  <input type="checkbox"
                    checked={entries.length > 0 && selected.size >= entries.length}
                    onChange={(e) => setSelected(e.target.checked ? new Set(entries.map((x) => `s:${x.id}`)) : new Set())} />
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
              {entries.map((e) => {
                const buf = edits[e.id];
                if (buf) {
                  const st = editStat(buf);
                  return (
                    <Fragment key={e.id}>
                      {buf.lines.map((l, i) => {
                        listNo += 1;
                        const rowId = `e:${e.id}:${l.key}`;
                        return (
                          <tr key={rowId} className={`border-b border-[var(--border)]/40 bg-[var(--primary)]/[0.03] ${i === 0 ? "border-t-2 border-t-[var(--primary)]/30" : ""}`}
                            onContextMenu={(ev) => { ev.preventDefault(); setCtx({ x: ev.clientX, y: ev.clientY, rowId }); }}>
                            <td className="px-2 py-1" />
                            <td className="px-2 py-1 text-center text-[var(--text-dim)] mono-number">{listNo}</td>
                            <td className={`${TD} w-[64px]`}>
                              {l.gubun === "1" || l.gubun === "2" ? (
                                <span className="text-[11px] font-semibold text-[var(--text-muted)]">{GUBUN_LABEL[l.gubun]}</span>
                              ) : (
                                <select value={l.gubun} onChange={(ev) => setEditLine(e.id, l.key, { gubun: ev.target.value as Gubun })} className={`${IN} cursor-pointer p-0`}>
                                  <option value="3">3.차변</option><option value="4">4.대변</option>
                                </select>
                              )}
                            </td>
                            {acctCell(l, rowId, (p) => setEditLine(e.id, l.key, p), true)}
                            <td className={`${TD} text-[var(--text)] cursor-pointer min-w-[110px]`} onClick={() => setPicker({ kind: "acct", rowId, q: "" })}>
                              {l.account?.name || <span className="text-[var(--text-dim)]">계정 선택</span>}
                            </td>
                            <td className={`${TD} mono-number text-[var(--text-dim)] w-[100px]`}>{l.partner?.business_number || "—"}</td>
                            {ptCell(l, rowId, (p) => setEditLine(e.id, l.key, p))}
                            {amtCells(l, (p) => setEditLine(e.id, l.key, p))}
                            <td className={`${TD} text-center text-[var(--text-dim)]`}>—</td>
                            {memoCell(l, rowId, (p) => setEditLine(e.id, l.key, p))}
                          </tr>
                        );
                      })}
                      <tr className="bg-amber-500/5">
                        <td colSpan={11} className="px-3 py-1 text-[10px] font-semibold">
                          <span className={st.ok ? "text-emerald-500" : "text-amber-500"}>
                            {st.ok ? `✅ 전표 #${e.voucher_no ?? "—"} 수정 중 — 차대일치, 상단 [저장]으로 반영` : `⚠️ 전표 #${e.voucher_no ?? "—"} 수정 중 — ${st.d !== st.c ? `차액 ${won(Math.abs(st.d - st.c))}` : "계정 미지정"} (차대일치해야 저장)`}
                          </span>
                          <button onClick={() => setEdits((es) => { const n = { ...es }; delete n[e.id]; return n; })} className="ml-2 underline text-[var(--text-dim)] hover:text-[var(--text)]">수정 취소</button>
                        </td>
                      </tr>
                    </Fragment>
                  );
                }
                const isFlash = e.id === flashId; // §3-3-B 방금 저장 하이라이트
                return e.lines.map((l, i) => {
                  listNo += 1;
                  const rowId = `s:${e.id}#${i}`;
                  return (
                    <tr key={rowId}
                      ref={isFlash && i === 0 ? (el) => { if (el && !flashScrolled.current) { flashScrolled.current = true; el.scrollIntoView({ behavior: "smooth", block: "center" }); } } : undefined}
                      className={`border-b border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/40 transition-colors duration-700 ${isFlash ? "bg-emerald-500/15" : ""} ${i === 0 ? "border-t-2 border-t-[var(--border)]" : ""}`}
                      onContextMenu={(ev) => { ev.preventDefault(); setCtx({ x: ev.clientX, y: ev.clientY, rowId }); }}
                      title={`전표 #${e.voucher_no ?? "—"}${e.description ? ` · ${e.description}` : ""} — 셀 클릭으로 인라인 수정`}>
                      <td className="px-2 py-1 text-center">
                        <input type="checkbox" checked={selected.has(`s:${e.id}`)}
                          onChange={(ev) => setSelected((s) => { const n = new Set(s); if (ev.target.checked) n.add(`s:${e.id}`); else n.delete(`s:${e.id}`); return n; })}
                          title="전표 단위 선택 (분개 균형 유지를 위해 전표째 삭제)" />
                      </td>
                      <td className="px-2 py-1 text-center text-[var(--text-dim)] mono-number">{listNo}</td>
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
              {/* 빈 행 — 클릭하면 상단 입력 영역으로 (§3-3-A 마지막 빈 행) */}
              <tr className="bg-[var(--bg-surface)]/30 cursor-pointer hover:bg-[var(--bg-surface)]/60" onClick={focusTop} title="클릭하면 상단 입력 영역에서 새 전표를 입력합니다">
                <td className="px-2 py-2" />
                <td className="px-2 py-2 text-center text-[var(--text-dim)] mono-number">{listNo + 1}</td>
                <td colSpan={9} className={`${TD} text-[var(--text-dim)] text-[11px]`}>
                  {entries.length === 0 ? "이 일자에 저장된 전표가 없습니다 — " : ""}빈 행 — 클릭하면 위 입력 영역에서 이어서 입력
                </td>
              </tr>
            </tbody>
            {entries.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[var(--border)] bg-[var(--bg-surface)] font-bold">
                  <td colSpan={7} className="px-3 py-2 text-right text-[var(--text-muted)]">합계</td>
                  <td className="px-2 py-2 text-right mono-number text-[var(--text)]">{entries.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.debit, 0), 0).toLocaleString()}</td>
                  <td className="px-2 py-2 text-right mono-number text-[var(--text)]">{entries.reduce((s, e) => s + e.lines.reduce((x, l) => x + l.credit, 0), 0).toLocaleString()}</td>
                  <td colSpan={2} className="px-2 py-2 text-[11px] font-bold text-emerald-500">✅ 차대일치</td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
      </div>

      {/* 우클릭 메뉴 (§3-3-A: 행 삽입/복사/삭제) */}
      {ctx && (
        <div className="fixed z-[80] rounded-lg border border-[var(--border)] bg-[var(--bg-card)] shadow-xl p-1 text-xs"
          style={{ left: ctx.x, top: ctx.y }} onClick={(e) => e.stopPropagation()}>
          {ctx.rowId.startsWith("s:") ? (
            <>
              <button onClick={() => ctxAction("insert")} className="block w-full px-3 py-1.5 text-left rounded hover:bg-[var(--bg-surface)] text-[var(--text)]">전표 수정 (인라인)</button>
              <button onClick={() => ctxAction("copy")} className="block w-full px-3 py-1.5 text-left rounded hover:bg-[var(--bg-surface)] text-[var(--text)]">행 복사 (상단 입력으로)</button>
              <button onClick={() => ctxAction("delete")} className="block w-full px-3 py-1.5 text-left rounded hover:bg-[var(--bg-surface)] text-red-400">전표 삭제</button>
            </>
          ) : (
            <>
              <button onClick={() => ctxAction("insert")} className="block w-full px-3 py-1.5 text-left rounded hover:bg-[var(--bg-surface)] text-[var(--text)]">행 삽입</button>
              <button onClick={() => ctxAction("copy")} className="block w-full px-3 py-1.5 text-left rounded hover:bg-[var(--bg-surface)] text-[var(--text)]">행 복사</button>
              <button onClick={() => ctxAction("delete")} className="block w-full px-3 py-1.5 text-left rounded hover:bg-[var(--bg-surface)] text-red-400">행 삭제</button>
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
