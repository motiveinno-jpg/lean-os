"use client";
import { appConfirm } from "@/components/global-confirm";
import { Ico } from "@/components/ui-icon";
import { todayKst } from "@/lib/kst";
import { logRead } from "@/lib/log-read";

// 전표입력 — 2단 구조 (2026-06-12 핸드오프 v2 확정본 §3-3).
//   [상단] 입력 영역: 일자 + 구분(대체/출금/입금 — 헤더 단위) + 분개 행(No/구분/계정과목/거래처/적요/차변/대변)
//     출금 = 대변 보통예금(103) 자동행 / 입금 = 차변 자동 / 대체 = 양쪽 직접. 차대일치 상시 표시 + 저장 차단.
//   [하단] 전표목록 그리드(§3-3-A 사용자 지정 스펙, 순서 고정):
//     ☑ | No | 구분(1.출금/2.입금/3.차변/4.대변) | 계정코드 | 계정명 | 거래처코드 | 거래처명 | 차변 | 대변 | 적요코드 | 적요
//     셀 클릭 = 인라인 수정(전표 단위 버퍼, 차대 재검증) · 행 우클릭 = 삽입/복사/삭제 · 체크박스 = 선택 삭제
//     마지막에 빈 행 1개 — 클릭하면 상단 입력 영역으로 포커스.
//   [§3-3-B] 저장 → 새로고침 없이 하단 목록 즉시 반영(invalidateQueries) + 새 행 하이라이트·자동 스크롤 +
//     "전표 N번 저장됨" 토스트. 실패 시 입력값 유지. 일자는 입력·목록이 같은 일자를 공유해 불일치 없음.
//   차대일치는 DB(save/update_manual_voucher RPC)에서도 재검증(이중). 수정은 journal_entry_audits 이력 보존.
//   삭제 = voucher_reject(행 보존). 마감(잠금) 월은 서버가 저장·수정·삭제 차단.
//
//   ★ 2026-08-11 (사장님 지시, 매입매출전표와 같은 손놀림으로) — 한 칸이 겸하던 일을 둘로 갈랐다.
//     · 예전: 일자 한 칸이 ①입력할 전표의 날짜 ②아래 목록 필터를 **동시에** 맡았다(그래서 하루치만 보였다).
//     · 지금: 위 **일자 = 년·월·일 3칸**(칠 전표의 날짜) / 아래 목록은 **조회기간**(월 단위 달력).
//     ⚠️ 이렇게 가르면 목록에 **여러 날짜**가 섞인다 — 그래서 ①목록에 일자 칸을 넣고
//       ②인라인 수정 저장은 반드시 **그 전표 자기 날짜**를 넘긴다. 입력칸 날짜를 넘기면
//       다른 날 전표를 고칠 때 날짜가 오늘로 끌려온다(예전엔 하루치만 보여 그럴 일이 없었다).
//     ★ Enter = **누른 칸 하나만** 윗줄에서 내리고 다음 칸으로 (매입매출전표와 같은 규칙).

import { useEffect, useMemo, useRef, useState, Fragment } from "react";
import { DateRangeField } from "@/components/date-range-field";
import { PickList } from "@/components/pick-list";
import { downloadCsv } from "@/lib/csv-export";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import { useToast } from "@/components/toast";
import { CellDropdown, anchorOf, type Anchor } from "@/components/cell-dropdown";
import { SortableTh, nextSort, type SortState } from "@/components/sortable-th";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat, ExcelMenu, SavedTabs, ConditionSave,
  ConditionPanel, ConditionRow, TokenField, AppliedChips, QuickSearch, quickSearchHit, quickTerms,
  RowsPerPage, Pager, usePager, useSavedQueries, SelectionBar, defaultRangeMonth, periodQuicksMonth,
  type ExcelItem, type AppliedChip,
} from "@/components/query-kit";

const db = supabase;
const won = (n: number) => `₩${Math.round(Number(n || 0)).toLocaleString()}`;

// 음수 허용(맨 앞 '-'만) — 수정분개용. 저장 시 음수 차변→대변/음수 대변→차변 정규화(DB check debit·credit>=0).
const num = (s: string | number) => { const n = Number(String(s).replace(/[^0-9-]/g, "").replace(/(?!^)-/g, "")); return Number.isFinite(n) ? n : 0; };
const comma = (s: string) => {
  const neg = String(s).trim().startsWith("-");
  const n = Math.abs(num(s));
  if (!n) return neg ? "-" : ""; // '-'만 입력한 중간 상태 유지
  return (neg ? "-" : "") + n.toLocaleString("ko-KR");
};
// 정규화 — 음수 차변은 대변으로, 음수 대변은 차변으로 (합계·저장 공통)
const normDC = (l: { debit: string; credit: string }) => { let d = num(l.debit), c = num(l.credit); if (d < 0) { c += -d; d = 0; } if (c < 0) { d += -c; c = 0; } return { d, c }; };

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
//   entry_date 는 반드시 들고 다닌다 — 목록이 여러 날이라 수정 저장에 그 전표 자기 날짜가 필요하다
type SavedEntry = { id: string; entry_date: string; voucher_no: number | null; voucher_type: string | null; description: string; source: string; entry_kind: string | null; lines: SavedLine[] };

let K = 1;
const AR_AP_CODES = new Set(["108", "251"]);
const MEMO_KEY = "voucher-recent-memos";

//   Enter 가 훑는 입력칸 — 화면 왼→오 순서. 일자 3칸이 앞, 그 뒤가 분개 행의 칸들이다.
type VCell = "y" | "m" | "d" | "gubun" | "account" | "partner" | "memo" | "debit" | "credit";
//   전표목록 제목줄 정렬 기준 (매입매출전표와 같은 목록)
type VSortKey = "date" | "no" | "account" | "partner" | "debit" | "credit" | "memo";
/** 목록 검색조건 (조회 화면 표준, 2026-08-18 Wave 1 — B형: 입력부는 그대로, 목록부만) */
type Cond = { acct: string[]; pt: string[]; rows: number };
const EMPTY_COND: Cond = { acct: [], pt: [], rows: 50 };
const condCount = (c: Cond) => c.acct.length + c.pt.length;
/** 그 달의 다음 달 1일 — 조회 상한(`lt`)으로 쓴다 */
const monthAfter = (ym: string) => {
  const [y, m] = ym.split("-").map(Number);
  return `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01`;
};
const pad2 = (s: string) => String(Number(s) || 0).padStart(2, "0");

// 저장 라인의 §3-3-A 구분 표기 — 출금/입금 전표는 회계 프로그램처럼 1.출금/2.입금
const savedGubun = (vt: string | null, debit: number): Gubun =>
  vt === "cash_out" ? (debit > 0 ? "1" : "4") : vt === "cash_in" ? (debit > 0 ? "3" : "2") : debit > 0 ? "3" : "4";

export default function VoucherEntryPage() {
  const { user, role } = useUser();
  const companyId = user?.company_id ?? null;
  const qc = useQueryClient();
  const { toast } = useToast();

  //   ① 칠 전표의 날짜 — 매입매출전표와 같은 년·월·일 3칸
  const [entryY, setEntryY] = useState(todayKst().slice(0, 4));
  const [entryM, setEntryM] = useState(String(Number(todayKst().slice(5, 7))));
  const [entryD, setEntryD] = useState(String(Number(todayKst().slice(8, 10))));
  const entryDate = `${entryY}-${pad2(entryM)}-${pad2(entryD)}`;
  const entryDateOk = entryY.length === 4 && Number(entryM) >= 1 && Number(entryM) <= 12 && Number(entryD) >= 1 && Number(entryD) <= 31;
  //   제목줄 정렬 — 공용 부품(SortableTh). 기본은 일자·전표번호 순(자료 순서 그대로).
  const [sort, setSort] = useState<SortState<VSortKey>>({ key: "date", dir: "asc" });
  const onSort = (k: VSortKey) => setSort((c) => nextSort(c, k));

  //   ② 아래 목록이 보여 줄 기간 — 월 단위. 기본 **지난달~이번 달**(조회 화면 표준). ★ 조회값은 기억하지 않는다.
  const [fromM, setFromM] = useState(() => defaultRangeMonth().from);
  const [toM, setToM] = useState(() => defaultRangeMonth().to);
  //   ── 조회 화면 표준 (목록부) — 빠른검색·검색조건·내 조건 ──
  const [q, setQ] = useState("");
  const [panelOpen, setPanelOpen] = useState(false);
  const [draft, setDraft] = useState<Cond>(EMPTY_COND);
  const [live, setLive] = useState<Cond>(EMPTY_COND);
  const setD = <K extends keyof Cond>(k: K) => (v: Cond[K]) => setDraft((c) => ({ ...c, [k]: v }));
  const [vtype, setVtype] = useState<VType>("transfer");
  const [pend, setPend] = useState<PLine[]>([]);               // 상단 입력 영역 행
  const [edits, setEdits] = useState<Record<string, { desc: string; lines: PLine[] }>>({}); // 하단 인라인 편집 버퍼
  const [selected, setSelected] = useState<Set<string>>(new Set()); // "s:entryId"
  const [picker, setPicker] = useState<{ kind: "acct" | "pt" | "memo"; rowId: string; q: string; anchor: Anchor; idx?: number } | null>(null);
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
      const data = logRead('voucher-entry/page:data', await db.from("chart_of_accounts").select("id, code, name").eq("company_id", companyId ?? "").order("code"));
      return (data || []) as Acct[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });
  //   보통예금은 표준 계정과목표에서 **103** 이다 (101 은 현금). 2026-08-12 표준 채택.
  const cashAcct = useMemo(() => accounts.find((a) => a.code === "103") || null, [accounts]);
  const dbReady = accounts.length > 0;

  const { data: partners = [] } = useQuery<Pt[]>({
    queryKey: ["voucher-partners", companyId],
    queryFn: async () => {
      const data = logRead('voucher-entry/page:data', await db.from("partners").select("id, name, business_number").eq("company_id", companyId ?? "").order("name"));
      return (data || []) as Pt[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });

  // ── 하단 목록: 조회기간 안의 확정 전표 ──
  //   ⚠️ queryKey 앞머리는 "vouchers-of-day" 그대로 둔다 — 거래처원장(ledger/shared.tsx)이 이 이름으로
  //     세 군데에서 무효화한다. 이름을 바꾸면 그쪽이 조용히 안 먹는다(화면은 멀쩡해 보인다).
  const { data: entries = [] } = useQuery<SavedEntry[]>({
    queryKey: ["vouchers-of-day", companyId, fromM, toM],
    queryFn: async () => {
      const data = logRead('voucher-entry/page:data', await db.from("journal_entries")
        .select("id, entry_date, voucher_no, voucher_type, description, source, entry_kind, journal_lines(debit, credit, description, chart_of_accounts(id, code, name), partners(id, name, business_number))")
        .eq("company_id", companyId ?? "").eq("status", "confirmed")
        //   ★ 매입매출전표는 뺀다 (2026-08-11 사장님 지적) — 여기서 못 고치는 전표라(유형·공급가액이
        //     날아가서) 눌러 봐야 "저쪽 메뉴에서 고치세요"만 뜨는 **막다른 골목**이었다.
        //     ⚠️ neq 만 쓰면 entry_kind 가 NULL 인 옛 전표까지 빠진다 — is.null 을 함께 건다.
        .or("entry_kind.is.null,entry_kind.neq.sale_purchase")
        .gte("entry_date", `${fromM}-01`).lt("entry_date", monthAfter(toM))
        .order("entry_date", { ascending: true }).order("voucher_no", { ascending: true }));
      return ((data || []) as any[]).map((e) => ({
        id: e.id, entry_date: String(e.entry_date), voucher_no: e.voucher_no, voucher_type: e.voucher_type, description: e.description || "", source: e.source, entry_kind: e.entry_kind || null,
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

  //   목록에서 뺀 매입매출전표가 몇 건인지 — 안 보이면 "내 전표 어디 갔지?" 가 되므로 화면이 말해 준다.
  //   건수는 count 로 센다(행을 받아 세면 1,000행에서 잘린다).
  const { data: spCount = 0 } = useQuery<number>({
    queryKey: ["vouchers-of-day-sp", companyId, fromM, toM],
    queryFn: async () => {
      const { count } = await db.from("journal_entries").select("id", { count: "exact", head: true })
        .eq("company_id", companyId ?? "").eq("status", "confirmed").eq("entry_kind", "sale_purchase")
        .gte("entry_date", `${fromM}-01`).lt("entry_date", monthAfter(toM));
      return Number(count || 0);
    },
    enabled: !!companyId && dbReady,
  });

  //   제목줄 정렬 — 안 고르면 예전 그대로(일자·전표번호 순). 전표는 **줄이 아니라 장 단위**로 옮긴다
  //   (한 전표의 분개 줄들이 흩어지면 차·대가 안 읽힌다 — 매입매출전표와 다른 점이다).
  const entryHit = (e: SavedEntry, c: Cond) => {
    if (c.acct.length && !e.lines.some((l) => l.account && c.acct.includes(l.account.name))) return false;
    if (c.pt.length && !e.lines.some((l) => l.partner && c.pt.includes(l.partner.name))) return false;
    return true;
  };
  //   빠른검색 — 계정·거래처·적요·전표번호·금액을 한꺼번에 (쉼표 = 또는, Enter 로 반영). 전표는 장 단위로 걸린다.
  const entryQuick = (e: SavedEntry) => quickSearchHit(q,
    [String(e.voucher_no ?? ""), e.description, ...e.lines.flatMap((l) => [l.account?.name, l.account?.code, l.partner?.name, l.memo])],
    e.lines.flatMap((l) => [l.debit, l.credit]).filter((n) => n > 0));
  const filteredEntries = useMemo(() => entries.filter((e) => entryHit(e, live) && entryQuick(e)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [entries, live, q]);
  const previewCount = entries.filter((e) => entryHit(e, draft)).length;
  const acctOpts = useMemo(() => [...new Set(entries.flatMap((e) => e.lines.map((l) => l.account?.name).filter(Boolean)))].sort((a, b) => String(a).localeCompare(String(b), "ko")).map((v) => ({ value: v as string, label: v as string })), [entries]);
  const ptOpts = useMemo(() => [...new Set(entries.flatMap((e) => e.lines.map((l) => l.partner?.name).filter(Boolean)))].sort((a, b) => String(a).localeCompare(String(b), "ko")).map((v) => ({ value: v as string, label: v as string })), [entries]);
  const sortedEntries = useMemo(() => {
    const val = (e: SavedEntry): string | number => {
      const first = e.lines[0];
      switch (sort.key) {
        case "date": return e.entry_date;
        case "no": return e.voucher_no ?? 0;
        case "account": return first?.account?.name ?? "";
        case "partner": return first?.partner?.name ?? "";
        case "debit": return e.lines.reduce((n, l) => n + Number(l.debit || 0), 0);
        case "credit": return e.lines.reduce((n, l) => n + Number(l.credit || 0), 0);
        default: return e.description ?? "";
      }
    };
    return [...filteredEntries].sort((a, b) => {
      const x = val(a), y = val(b);
      const c = typeof x === "number" ? x - (y as number) : String(x).localeCompare(String(y), "ko");
      return sort.dir === "asc" ? c : -c;
    });
  }, [filteredEntries, sort]);
  const pager = usePager(sortedEntries, live.rows, `${fromM}|${toM}|${q}|${JSON.stringify(live)}`);
  //   내 조건 — ★ 하나가 이 화면(목록부)의 기본값
  const saved = useSavedQueries("voucher-entry", companyId);
  const paramsNow = { from: fromM, to: toM, q, cond: live };
  const paramsBasic = { ...defaultRangeMonth(), q: "", cond: EMPTY_COND };
  const applySaved = (p: Record<string, unknown>) => {
    if (typeof p.from === "string" && typeof p.to === "string") { setFromM(p.from); setToM(p.to); }
    if (typeof p.q === "string") setQ(p.q);
    const c = { ...EMPTY_COND, ...(p.cond as Partial<Cond> | undefined) };
    setDraft(c); setLive(c);
  };
  const [defDone, setDefDone] = useState(false);
  useEffect(() => {
    if (defDone || !saved.isFetched) return;
    setDefDone(true);
    if (saved.def) applySaved(saved.def.params || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved.isFetched, saved.def, defDone]);
  const suggestName = () => [draft.acct[0], draft.pt[0]].filter(Boolean).slice(0, 2).join(" · ") || "내 조건";
  const drop = (patch: Partial<Cond>) => { const c = { ...live, ...patch }; setLive(c); setDraft(c); };
  const chips: AppliedChip[] = [
    ...quickTerms(q).map((t, i) => ({ group: "빠른검색", label: t, onRemove: () => setQ(quickTerms(q).filter((_, j) => j !== i).join(", ")) })),
    ...live.acct.map((v) => ({ group: "계정과목", label: v, onRemove: () => drop({ acct: live.acct.filter((x) => x !== v) }) })),
    ...live.pt.map((v) => ({ group: "거래처", label: v, onRemove: () => drop({ pt: live.pt.filter((x) => x !== v) }) })),
  ];
  const clearAll = () => { setQ(""); setLive(EMPTY_COND); setDraft(EMPTY_COND); };
  const sumD = filteredEntries.reduce((s0, e) => s0 + e.lines.reduce((x, l) => x + l.debit, 0), 0);
  const sumC = filteredEntries.reduce((s0, e) => s0 + e.lines.reduce((x, l) => x + l.credit, 0), 0);


  //   엑셀 — 통장·카드·매입매출전표와 같은 공통 함수를 쓴다(한글 깨짐·칸 밀림을 한 곳에서만 막는다)
  const exportCsv = () => {
    const rows: (string | number)[][] = [];
    for (const e of sortedEntries) {
      for (const l of e.lines) {
        rows.push([
          e.entry_date, e.voucher_no ?? "",
          GUBUN_LABEL[savedGubun(e.voucher_type, l.debit)],
          l.account?.code ?? "", l.account?.name ?? "",
          l.partner?.business_number ?? "", l.partner?.name ?? "",
          Number(l.debit || 0), Number(l.credit || 0),
          l.memo || e.description || "",
        ]);
      }
    }
    downloadCsv(
      `일반전표_${fromM === toM ? fromM : `${fromM}~${toM}`}`,
      ["일자", "전표번호", "구분", "계정코드", "계정명", "거래처번호", "거래처명", "차변", "대변", "적요"],
      rows,
    );
  };

  // ── 상단 입력 파생값 (출금/입금은 자동 현금 라인 포함해 균형 계산) ──
  const pendFilled = pend.filter((l) => num(l.debit) !== 0 || num(l.credit) !== 0);
  const pendDebit = pendFilled.reduce((s, l) => s + normDC(l).d, 0);
  const pendCredit = pendFilled.reduce((s, l) => s + normDC(l).c, 0);
  const autoAmt = vtype === "cash_out" ? pendDebit : vtype === "cash_in" ? pendCredit : 0;
  const pendTotalD = pendDebit + (vtype === "cash_in" ? autoAmt : 0);
  const pendTotalC = pendCredit + (vtype === "cash_out" ? autoAmt : 0);
  const pendDiff = pendTotalD - pendTotalC;
  const pendBalanced = pendTotalD > 0 && pendDiff === 0;
  const pendMissing = pendFilled.some((l) => !l.account);
  const pendOk = pendFilled.length > 0 && pendBalanced && !pendMissing && (vtype !== "transfer" || pendFilled.length >= 2) && (vtype === "transfer" || !!cashAcct);

  // 하단 편집 버퍼 파생값
  const editStat = (b: { lines: PLine[] }) => {
    const fl = b.lines.filter((l) => num(l.debit) !== 0 || num(l.credit) !== 0);
    const d = fl.reduce((s, l) => s + normDC(l).d, 0), c = fl.reduce((s, l) => s + normDC(l).c, 0);
    return { d, c, ok: fl.length >= 2 && d > 0 && d === c && !fl.some((l) => !l.account) };
  };
  const editIds = Object.keys(edits);
  const editsOk = editIds.every((id) => editStat(edits[id]).ok);
  //   일자를 3칸으로 나누면서 '월을 지운 중간 상태'가 생긴다 — 그대로 저장하면 2026-00-00 이 날아간다.
  //   새 전표를 칠 때만 막는다(수정만 저장하는 경우는 그 전표 자기 날짜를 쓴다)
  const canSave = dbReady && !busy && ((pendFilled.length > 0 && pendOk && entryDateOk) || editIds.length > 0) && editsOk && (pendFilled.length === 0 || (pendOk && entryDateOk));

  // ── 행 조작 ──
  const rowGubun = (): Gubun => (vtype === "cash_out" ? "1" : vtype === "cash_in" ? "2" : "3");
  const newLine = (g?: Gubun): PLine => ({ key: K++, gubun: g ?? rowGubun(), account: null, partner: null, memo: "", debit: "", credit: "" });
  const setPendLine = (key: number, patch: Partial<PLine>) => setPend((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const setEditLine = (entryId: string, key: number, patch: Partial<PLine>) =>
    setEdits((es) => ({ ...es, [entryId]: { ...es[entryId], lines: es[entryId].lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) } }));
  const enterEdit = (e: SavedEntry) => {
    if (edits[e.id]) return;
    //   매입매출전표는 유형·공급가액·부가세를 함께 들고 있다 — 일반전표 편집으로 저장하면 그게 지워진다
    //   목록에서 이미 걸러지므로 여기까진 오지 않는다 — 나중에 목록 조건이 바뀌어도
    //   유형·공급가액이 조용히 날아가지 않게 남겨 두는 그물이다
    if (e.entry_kind === "sale_purchase") {
      toast("매입매출전표는 '매입매출전표 입력' 메뉴에서 고쳐 주세요.", "info");
      return;
    }
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
    if (num(v) !== 0) {
      (p as any)[side === "debit" ? "credit" : "debit"] = "";
      if (l.gubun === "3" || l.gubun === "4") p.gubun = side === "debit" ? "3" : "4";
    }
    return p;
  };

  /** ★ Enter — **누른 칸 하나만** 윗줄에서 내린다 (2026-08-11, 매입매출전표와 같은 규칙).
   *  첫 행의 '위'는 아래 목록의 **마지막 전표**다(그 전표 날짜 · 첫 분개 줄) — 방금 친 것을 이어 치는 흐름.
   *  '빈 칸일 때만' 으로 하지 않는다: 구분처럼 늘 값이 있는 칸은 영영 못 내려 고장난 것처럼 보인다. */
  const pullCell = (cell: VCell, rowIdx: number) => {
    const last = entries.length > 0 ? entries[entries.length - 1] : null;
    if (cell === "y" || cell === "m" || cell === "d") {
      if (!last) return;
      const [yy, mm, dd] = last.entry_date.split("-");
      if (cell === "y") setEntryY(yy);
      if (cell === "m") setEntryM(String(Number(mm)));
      if (cell === "d") setEntryD(String(Number(dd)));
      return;
    }
    const cur = pend[rowIdx];
    if (!cur) return;
    const up = rowIdx > 0 ? pend[rowIdx - 1] : null;
    //   윗 행이 없으면 마지막 저장 전표의 첫 줄에서 내린다 (금액은 그 줄의 숫자를 글자로)
    const src: Partial<PLine> | null = up
      ? up
      : last?.lines[0]
        ? {
          gubun: savedGubun(last.voucher_type, last.lines[0].debit),
          account: last.lines[0].account, partner: last.lines[0].partner, memo: last.lines[0].memo,
          debit: last.lines[0].debit ? last.lines[0].debit.toLocaleString() : "",
          credit: last.lines[0].credit ? last.lines[0].credit.toLocaleString() : "",
        }
        : null;
    if (!src) return;
    switch (cell) {
      //   구분은 대체 전표에서만 사람이 고른다 — 출금·입금은 전표 종류가 정하므로 내리지 않는다
      case "gubun": if (vtype === "transfer" && src.gubun) setPendLine(cur.key, { gubun: src.gubun }); break;
      case "account": setPendLine(cur.key, { account: src.account ?? null }); break;
      case "partner": setPendLine(cur.key, { partner: src.partner ?? null }); break;
      case "memo": setPendLine(cur.key, { memo: src.memo ?? "" }); break;
      //   금액은 한 행 한쪽만 — amountPatch 가 반대쪽을 비우고 구분까지 맞춰 준다
      case "debit": if (vtype !== "cash_in") setPendLine(cur.key, amountPatch(cur, "debit", src.debit ?? "")); break;
      case "credit": if (vtype !== "cash_out") setPendLine(cur.key, amountPatch(cur, "credit", src.credit ?? "")); break;
    }
  };

  // 키보드(상단): Enter = 그 칸에 윗값을 내리고 다음 칸, 마지막 칸이면 새 행 (마우스 없이 연속 입력)
  const onTopKey = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    const t = e.target as HTMLElement;
    if (!/^(INPUT|SELECT)$/.test(t.tagName)) return;
    e.preventDefault();
    //   data-vcell="필드-행번호" 가 붙은 칸만 내린다 (계정·거래처 자동완성 목록에서 고르는 중이면 그쪽이 먼저 먹는다)
    const mark = t.getAttribute("data-vcell");
    if (mark) {
      const at = mark.lastIndexOf("-");
      pullCell(mark.slice(0, at) as VCell, Number(mark.slice(at + 1)));
    }
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

  const linePayload = (ls: PLine[]) => ls.filter((l) => num(l.debit) !== 0 || num(l.credit) !== 0)
    .map((l) => { const { d, c } = normDC(l); return { account_id: l.account!.id, debit: d, credit: c, memo: l.memo, partner_id: l.partner?.id ?? "" }; });
  const errMsg = (m: string) =>
    m.includes("PERIOD_LOCKED") ? "마감(잠금)된 회계기간입니다 — 저장/수정/삭제 불가"
      : m.includes("UNBALANCED") ? "차변·대변 합계가 일치하지 않습니다"
      : m.includes("does not exist") ? "전표 수정 기능이 아직 준비되지 않았습니다" : m;

  // ── 저장: 하단 편집 전표 커밋 + 상단 새 전표 저장 → §3-3-B 즉시 반영(리페치+하이라이트+스크롤+N번 토스트) ──
  //   실패 시 입력값 유지(성공해야만 초기화).
  const save = async () => {
    if (!canSave) return;
    setBusy(true);
    try {
      for (const id of editIds) {
        const b = edits[id];
        // p_entry_date 는 기본값 없는 필수 인자 — 누락 시 PGRST202(함수 못찾음)로 수정 저장이 항상 실패했음.
        //   ★ 반드시 **그 전표 자기 날짜**를 넘긴다. 목록이 기간이 되면서 여러 날이 섞이므로,
        //     예전처럼 입력칸 날짜(entryDate)를 넘기면 다른 날 전표를 고칠 때 날짜가 끌려온다.
        const own = entries.find((x) => x.id === id)?.entry_date;
        if (!own) throw new Error("수정할 전표를 목록에서 찾지 못했습니다 — 새로고침 후 다시 시도해 주세요");
        const { error } = await db.rpc("update_manual_voucher", { p_entry_id: id, p_entry_date: own, p_description: b.desc, p_lines: linePayload(b.lines) });
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
        const saved = logRead('voucher-entry/page:saved', await db.from("journal_entries").select("voucher_no").eq("id", newId).maybeSingle());
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
    if (!(await appConfirm(`저장된 전표 ${entryIds.length}건을 삭제할까요?\n(분개 균형 유지를 위해 전표 단위로 삭제되며, 이력은 보존됩니다)`, { danger: true }))) return;
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

  if (role === "partner") return <AccessDenied detail="전표입력은 회사 구성원 전용입니다 (외부 파트너 제외)." />;
  if (!companyId) return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;

  const acctMatches = (q: string) => {
    const t = q.trim().toLowerCase();
    //   ⚠️ 자르지 않는다 — 12개로 잘라 두면 **그 12개 안에서만** 검색된다(매입매출전표에서 같은 버그를
    //     잡았다: '여비교통비'가 안 나왔다). 목록은 스크롤되므로 다 넘겨도 된다 (2026-08-12).
    return t ? accounts.filter((a) => a.code.includes(t) || a.name.toLowerCase().includes(t)) : accounts;
  };
  const ptMatches = (q: string) => {
    const raw = q.trim().toLowerCase();
    if (!raw) return partners; // 빈 검색 = 회사 거래처 전체 노출(세로 스크롤로 탐색)
    const tn = raw.replace(/[-\s]/g, "");          // 공백·하이픈 제거(사업자번호/연속매칭용)
    const tokens = raw.split(/\s+/).filter(Boolean); // 토큰별(공백 구분) 매칭
    // 매칭을 넓게 — 공백 무시 부분일치 OR 모든 토큰 포함 OR 사업자번호 포함
    return partners.filter((p) => {
      const name = (p.name || "").toLowerCase();
      const nameNS = name.replace(/\s/g, "");
      const bn = (p.business_number || "").replace(/-/g, "");
      return nameNS.includes(tn) || tokens.every((tk) => name.includes(tk)) || (bn && bn.includes(tn));
    });   //   거래처도 자르지 않는다 — 200개 뒤의 거래처가 검색에서 빠졌다 (2026-08-12)
  };

  const TD = "px-2 py-1 whitespace-nowrap";
  const IN = "w-full bg-transparent text-xs text-[var(--text)] focus:outline-none focus:bg-[var(--primary)]/5 px-1 py-1";

  //   vrow = 상단 입력 영역의 행 번호. 있으면 Enter 가 '윗값 내리기'(onTopKey)로 넘어갈 수 있다.
  //   하단 편집 버퍼는 vrow 를 주지 않아 예전 그대로 동작한다.
  // 계정과목 자동완성 셀 (상단·하단 편집 공용)
  const acctCell = (l: PLine, rowId: string, update: (p: Partial<PLine>) => void, withName: boolean, vrow?: number) => (
    <td className={`${TD} p-0 ${withName ? "w-[72px]" : ""}`}>
      <div className="relative">
      <input value={picker?.kind === "acct" && picker.rowId === rowId ? picker.q : (withName ? (l.account?.code || "") : (l.account ? `${l.account.name} (${l.account.code})` : ""))}
        onChange={(e) => setPicker({ kind: "acct", rowId, q: e.target.value, anchor: anchorOf(e.currentTarget) })}
        onFocus={(e) => setPicker({ kind: "acct", rowId, q: "", anchor: anchorOf(e.currentTarget) })}
        onBlur={() => setTimeout(() => setPicker((p) => (p?.rowId === rowId && p.kind === "acct" ? null : p)), 150)}
        onKeyDown={(e) => {
          // 거래처 셀과 동일한 키보드 탐색 — ArrowUp/Down 이동 + Enter 선택 (직원 QA #1)
          if (!(picker?.kind === "acct" && picker.rowId === rowId)) return;
          const list = acctMatches(picker.q);
          if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setPicker((p) => p ? { ...p, idx: Math.min((p.idx ?? 0) + 1, Math.max(list.length - 1, 0)) } : p); }
          else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setPicker((p) => p ? { ...p, idx: Math.max((p.idx ?? 0) - 1, 0) } : p); }
          //   아무것도 안 친 상태의 Enter 는 목록 첫 줄을 고르는 게 아니라 **윗값 내리기**로 보낸다
          //   (뭘 골랐는지 모르는 채 엉뚱한 계정이 박히는 것보다 낫다)
          else if (e.key === "Enter") {
            if (vrow != null && !picker.q.trim()) return;
            const sel = list[picker.idx ?? 0]; if (sel) { e.preventDefault(); e.stopPropagation(); update({ account: sel }); setPicker(null); }
          }
          else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPicker(null); }
        }}
        data-vcell={vrow != null ? `account-${vrow}` : undefined}
        placeholder={withName ? "코드" : "103 / 보통예금..."} className={`${IN} ${withName ? "mono-number" : ""}`} />
      {picker?.kind === "acct" && picker.rowId === rowId && (
        <CellDropdown anchor={picker.anchor} width={240} maxHeight={196}>
          {acctMatches(picker.q).map((a, i) => {
            const active = i === (picker.idx ?? 0);
            return (
            <button key={a.id} onMouseDown={(e) => { e.preventDefault(); update({ account: a }); setPicker(null); }}
              className={`w-full flex justify-between px-2 py-1 rounded text-[11px] text-[var(--text)] ${active ? "bg-[var(--primary)]/10" : "hover:bg-[var(--bg-surface)]"}`}>
              <span>{a.name}{active && <span className="ml-1 text-[9px] text-[var(--primary)]">↵</span>}</span><span className="text-[var(--text-dim)] mono-number">{a.code}</span>
            </button>
            );
          })}
          {acctMatches(picker.q).length === 0 && <div className="px-2 py-2 text-[11px] text-[var(--text-dim)]">{dbReady ? "검색 결과 없음" : "계정과목 마스터 미적용"}</div>}
        </CellDropdown>
      )}
      </div>
    </td>
  );

  // 거래처 자동완성 셀
  const ptCell = (l: PLine, rowId: string, update: (p: Partial<PLine>) => void, vrow?: number) => {
    const arApWarn = l.account && AR_AP_CODES.has(l.account.code) && !l.partner;
    // relative 는 td 가 아닌 내부 div 에 — border-collapse 표에서 td position:relative 가
    // 무시되어 드롭다운이 뷰포트 기준 top:100% 로 떨어지는 버그 회피
    return (
      <td className={`${TD} p-0`}>
        <div className="relative">
        <div className="flex items-center">
          <input value={picker?.kind === "pt" && picker.rowId === rowId ? picker.q : (l.partner?.name || "")}
            onChange={(e) => setPicker({ kind: "pt", rowId, q: e.target.value, anchor: anchorOf(e.currentTarget) })}
            onFocus={(e) => setPicker({ kind: "pt", rowId, q: "", anchor: anchorOf(e.currentTarget) })}
            onBlur={() => setTimeout(() => setPicker((p) => (p?.rowId === rowId && p.kind === "pt" ? null : p)), 150)}
            onKeyDown={(e) => {
              if (!(picker?.kind === "pt" && picker.rowId === rowId)) return;
              const list = ptMatches(picker.q);
              if (e.key === "ArrowDown") { e.preventDefault(); e.stopPropagation(); setPicker((p) => p ? { ...p, idx: Math.min((p.idx ?? 0) + 1, Math.max(list.length - 1, 0)) } : p); }
              else if (e.key === "ArrowUp") { e.preventDefault(); e.stopPropagation(); setPicker((p) => p ? { ...p, idx: Math.max((p.idx ?? 0) - 1, 0) } : p); }
              else if (e.key === "Enter") {
                if (vrow != null && !picker.q.trim()) return;   // 계정과목 칸과 같은 규칙
                const sel = list[picker.idx ?? 0]; if (sel) { e.preventDefault(); e.stopPropagation(); update({ partner: sel }); setPicker(null); }
              }
              else if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); setPicker(null); }
            }}
            data-vcell={vrow != null ? `partner-${vrow}` : undefined}
            placeholder="—" className={IN} />
          {arApWarn && <span className="pr-1 text-amber-500 text-[10px] font-bold shrink-0" title="채권/채무 계정은 거래처 지정을 권장합니다"><Ico e="⚠" /></span>}
        </div>
        {picker?.kind === "pt" && picker.rowId === rowId && (
          <CellDropdown anchor={picker.anchor} width={240} maxHeight={196}>
            {ptMatches(picker.q).map((p, i) => {
              const active = i === (picker!.idx ?? 0);
              return (
              <button key={p.id}
                ref={active ? (el) => { el?.scrollIntoView({ block: "nearest" }); } : undefined}
                onMouseEnter={() => setPicker((pp) => (pp ? { ...pp, idx: i } : pp))}
                onMouseDown={(e) => { e.preventDefault(); update({ partner: p }); setPicker(null); }}
                className={`w-full px-2 py-1 rounded text-[11px] text-left text-[var(--text)] truncate ${active ? "bg-[var(--primary)]/10" : "hover:bg-[var(--bg-surface)]"}`}>
                {p.name}{p.business_number ? <span className="text-[var(--text-dim)] mono-number"> · {p.business_number}</span> : null}{active && <span className="ml-1 text-[9px] text-[var(--primary)]">↵</span>}
              </button>
              );
            })}
            {ptMatches(picker.q).length === 0 && (
              <div className="px-2 py-2 text-[11px] text-[var(--text-dim)]">{partners.length === 0 ? "등록된 거래처가 없습니다" : "검색 결과 없음"}</div>
            )}
            {l.partner && <button onMouseDown={(e) => { e.preventDefault(); update({ partner: null }); setPicker(null); }} className="w-full px-2 py-1 rounded text-[11px] text-[var(--text-dim)] text-left hover:bg-[var(--bg-surface)]">지우기</button>}
          </CellDropdown>
        )}
        </div>
      </td>
    );
  };

  // 적요 셀(+자주 쓰는 적요)
  const memoCell = (l: PLine, rowId: string, update: (p: Partial<PLine>) => void, vrow?: number) => (
    <td className={`${TD} p-0`}>
      <div className="relative">
      <div className="flex items-center">
        <input value={l.memo} onChange={(e) => update({ memo: e.target.value })} placeholder="적요"
          data-vcell={vrow != null ? `memo-${vrow}` : undefined} className={IN} />
        {recentMemos.length > 0 && (
          <button onClick={(e) => setPicker({ kind: "memo", rowId, q: "", anchor: anchorOf(e.currentTarget) })} tabIndex={-1}
            className="pr-1 text-[10px] text-[var(--text-dim)] hover:text-[var(--primary)] shrink-0" title="자주 쓰는 적요">▾</button>
        )}
      </div>
      {picker?.kind === "memo" && picker.rowId === rowId && (
        <CellDropdown anchor={picker.anchor} width={208} maxHeight={180} align="right">
          {recentMemos.map((m, i) => (
            <button key={i} onMouseDown={(e) => { e.preventDefault(); update({ memo: m }); setPicker(null); }}
              className="w-full px-2 py-1 rounded text-[11px] text-left text-[var(--text)] hover:bg-[var(--bg-surface)] truncate">
              <span className="text-[var(--text-dim)] mono-number">{i + 1}.</span> {m}
            </button>
          ))}
        </CellDropdown>
      )}
      </div>
    </td>
  );

  // 차/대 금액 셀
  const amtCells = (l: PLine, update: (p: Partial<PLine>) => void, vrow?: number) => {
    const debitOff = l.gubun === "4" || l.gubun === "2";
    const creditOff = l.gubun === "3" || l.gubun === "1";
    return (
      <>
        <td className={`${TD} p-0 w-[110px]`}>
          <input inputMode="numeric" value={l.debit} readOnly={debitOff} data-vcell={vrow != null ? `debit-${vrow}` : undefined}
            onChange={(e) => update(amountPatch(l, "debit", e.target.value))}
            placeholder={debitOff ? "" : "0"} className={`${IN} text-right mono-number ${debitOff ? "opacity-30 cursor-default" : ""}`} />
        </td>
        <td className={`${TD} p-0 w-[110px]`}>
          <input inputMode="numeric" value={l.credit} readOnly={creditOff} data-vcell={vrow != null ? `credit-${vrow}` : undefined}
            onChange={(e) => update(amountPatch(l, "credit", e.target.value))}
            placeholder={creditOff ? "" : "0"} className={`${IN} text-right mono-number ${creditOff ? "opacity-30 cursor-default" : ""}`} />
        </td>
      </>
    );
  };

  let listNo = 0;
  const sourceBadge = (s: string) => (s !== "manual" ? <span className="ml-1 text-[9px] px-1 py-0.5 rounded bg-purple-500/10 text-purple-500 font-semibold align-middle">AI</span> : null);

  //   엑셀 그릇 — 지금 조회 결과(걸린 조건 그대로, 분개 줄 단위)
  const excelItems: ExcelItem[] = [
    { label: "지금 조회 결과 내려받기", count: sortedEntries.length, hint: "걸린 조건 그대로 · 분개 줄 단위", disabled: sortedEntries.length === 0, onClick: () => exportCsv() },
  ];

  return (
    <div className="qk-shell">
      {acctFetched && !dbReady && (
        <div className="px-4 py-3 rounded-xl bg-amber-500/8 border border-amber-500/25 text-xs text-amber-600 font-semibold shadow-sm">
          <Ico e="⚠" /> 전표 시스템 DB(계정과목 마스터)가 아직 적용되지 않았습니다 — 적용 후 사용할 수 있습니다.
        </div>
      )}

      {/* ══ 상단: 입력 영역 (§3-3) ══ */}
      {/* ── 한 상자: [구분 탭] → 분개 입력 → (선) → 전표목록 조회 줄·표·쪽 넘김·안내 (2026-08-18 사장님: 상자 하나, 섹션은 선으로) ── */}
      <QueryScreen>
      <div ref={topRef} onKeyDown={onTopKey} className="qk-head ve-input-section overflow-visible">
        {/* 구분 탭 — 수집·전표처럼 상자 **안** 맨 위, 파란 밑줄 (2026-08-18 사장님). 오른쪽은 새 전표·저장 */}
        <div className="collect-tabs ve-kind-tabs no-print">
          {VTYPES.map((t) => (
            <button key={t.id} type="button" onClick={() => changeVtype(t.id)} title={t.desc}
              className={vtype === t.id ? "collect-tab collect-tab-on" : "collect-tab"}>
              {t.label}
            </button>
          ))}
          <span className="ve-kind-actions">
            <button onClick={() => { setPend(freshRows(vtype)); setEdits({}); }} disabled={busy}
              className="btn-secondary btn-sm">새 전표</button>
            <button onClick={save} disabled={!canSave}
              className="btn-primary btn-sm disabled:opacity-40">
              {busy ? "저장 중..." : "저장"}</button>
          </span>
        </div>
        <div className="px-5 py-3 border-b border-[var(--border)]/70 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 text-sm font-bold text-[var(--text)]">
            <span aria-hidden className="inline-block w-1.5 h-4 rounded-full bg-[var(--primary)]" />분개 입력
          </span>
          {/* 칠 전표의 날짜 — 년·월·일 3칸(매입매출전표와 같은 형식). **입력 카드 안**에 둔다:
              ① 이 날짜로 이 분개를 저장한다는 뜻이 눈에 보이고 ② Enter(onTopKey)가 날짜 칸까지 훑는다.
              아래 목록의 조회기간과는 별개다 (2026-08-11) */}
          <div className="ve-date-chip">
            <span className="ve-date-label">일자</span>
            <input value={entryY} onChange={(e) => setEntryY(e.target.value.replace(/\D/g, "").slice(0, 4))}
              data-vcell="y-0" inputMode="numeric" maxLength={4} aria-label="년" className="ve-date-y" />
            <span className="ve-date-sep">-</span>
            <input value={entryM} onChange={(e) => setEntryM(e.target.value.replace(/\D/g, "").slice(0, 2))}
              data-vcell="m-0" inputMode="numeric" placeholder="월" aria-label="월" className="ve-date-md" />
            <span className="ve-date-sep">-</span>
            <input value={entryD} onChange={(e) => setEntryD(e.target.value.replace(/\D/g, "").slice(0, 2))}
              data-vcell="d-0" inputMode="numeric" placeholder="일" aria-label="일" className="ve-date-md" />
          </div>
          {!entryDateOk && <span className="ve-date-warn">일자를 확인해 주세요</span>}
          <span className="hidden sm:inline text-[11px] text-[var(--text-dim)]">{VTYPES.find((t) => t.id === vtype)?.desc}</span>
          <span className="ml-auto text-[10px] font-semibold px-2.5 py-1 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-dim)]">전표번호: 자동(일자별 순번)</span>
        </div>
        {/* 데스크톱: 가로 스크롤 없이 폭에 맞춤(overflow-x-auto 면 거래처 자동완성 드롭다운이 잘림).
            모바일: min-width + 가로 스크롤 — 없으면 유연 컬럼이 짓눌려 글자당 줄바꿈(사장님 QA 2026-07-10 IMG_0577). */}
        <div className="overflow-x-auto sm:overflow-visible">
          <table className="w-full min-w-[620px] sm:min-w-0 text-xs border-collapse table-fixed">
            <thead>
              <tr className="border-b border-[var(--border)]">
                <th className="px-2 py-2.5 w-9 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">No</th>
                <th className="px-2 py-2.5 w-[68px] text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">구분</th>
                <th className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">계정과목</th>
                <th className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">거래처</th>
                <th className="px-2 py-2.5 text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">적요</th>
                <th className="px-2 py-2.5 w-[110px] text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">차변</th>
                <th className="px-2 py-2.5 w-[110px] text-center text-[11px] font-semibold uppercase tracking-wide text-[var(--text-dim)]">대변</th>
                <th className="px-2 py-2.5 w-8" />
              </tr>
            </thead>
            <tbody>
              {pend.map((l, i) => (
                <tr key={l.key} className="border-b border-[var(--border)]/40 transition-colors focus-within:bg-[var(--primary)]/[0.04]"
                  onContextMenu={(e) => { e.preventDefault(); setCtx({ x: e.clientX, y: e.clientY, rowId: `p:${l.key}` }); }}>
                  <td className="px-2 py-1 text-center text-[var(--text-dim)] mono-number">{i + 1}</td>
                  <td className={`${TD} w-[68px]`}>
                    {vtype === "transfer" ? (
                      <div className="relative">
                        <select value={l.gubun} onChange={(e) => setPendLine(l.key, { gubun: e.target.value as Gubun })} data-vcell={`gubun-${i}`} className={`${IN} cursor-pointer appearance-none pl-1.5 pr-4 py-1`}>
                          <option value="3">차변</option><option value="4">대변</option>
                        </select>
                        <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[8px] text-[var(--text-dim)]">▾</span>
                      </div>
                    ) : (
                      <span className="text-[11px] font-semibold text-[var(--text-muted)]">{GUBUN_SHORT[l.gubun]}</span>
                    )}
                  </td>
                  {acctCell(l, `p:${l.key}`, (p) => setPendLine(l.key, p), false, i)}
                  {ptCell(l, `p:${l.key}`, (p) => setPendLine(l.key, p), i)}
                  {memoCell(l, `p:${l.key}`, (p) => setPendLine(l.key, p), i)}
                  {amtCells(l, (p) => setPendLine(l.key, p), i)}
                  <td className="text-center px-1">
                    <button onClick={() => setPend((ls) => (ls.length <= 1 ? [newLine(vtype === "transfer" ? "3" : (vtype === "cash_out" ? "1" : "2"))] : ls.filter((x) => x.key !== l.key)))}
                      className="w-6 h-6 rounded-md flex items-center justify-center text-red-400 hover:text-white hover:bg-red-500 transition text-xs mx-auto" title="이 행 삭제" tabIndex={-1}>✕</button>
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
          </table>
        </div>
        {/* 스티키 풋터 바 — 합계(차변합/대변합) + 차대일치 상태 pill */}
        <div className="voucher-entry-summary-bar sticky bottom-0 z-10 px-5 py-3 border-t-2 border-[var(--border)] rounded-b-[18px] bg-[var(--bg-card)] flex flex-wrap items-center gap-x-6 gap-y-2">
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-dim)]">차변합</span>
            <span className="text-lg sm:text-2xl font-black mono-number tracking-tight text-[var(--text)]">{pendTotalD.toLocaleString()}</span>
          </div>
          <span aria-hidden className="hidden sm:block w-px h-6 bg-[var(--border)]" />
          <div className="flex items-baseline gap-2">
            <span className="text-[10px] font-bold uppercase tracking-wide text-[var(--text-dim)]">대변합</span>
            <span className="text-lg sm:text-2xl font-black mono-number tracking-tight text-[var(--text)]">{pendTotalC.toLocaleString()}</span>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {pendMissing && <span className="px-2.5 py-1 rounded-full bg-amber-500/10 text-amber-500 text-[11px] font-bold">· 계정과목 미지정 행 있음</span>}
            {pendTotalD + pendTotalC === 0 ? (
              <span className="px-3 py-1.5 rounded-full bg-[var(--bg-surface)] border border-[var(--border)] text-[11px] font-semibold text-[var(--text-dim)]">금액을 입력하세요</span>
            ) : pendBalanced ? (
              <span className="px-3 py-1.5 rounded-full bg-emerald-500/10 text-emerald-500 text-[11px] font-bold">차대일치 — 저장 가능</span>
            ) : (
              <span className="px-3 py-1.5 rounded-full bg-red-500/10 text-red-500 text-[11px] font-bold"><Ico e="⚠" tone="mono" /> 차액 {won(Math.abs(pendDiff))} ({pendDiff > 0 ? "대변 부족" : "차변 부족"}) — 저장 불가</span>
            )}
          </div>
        </div>
      </div>

      {/* ══ 하단: 전표목록 — 조회 화면 표준(B형: 목록부만) (2026-08-18 Wave 1). 셀 클릭 = 인라인 수정 · 행 우클릭 = 삽입/복사/삭제 ══ */}
        <QueryHead>
          <QueryBar right={<ExcelMenu items={excelItems} />}>
            <DateRangeField unit="month" label={null} parts="segments" from={fromM} to={toM}
              onChange={(f, t) => { setFromM(f); setToM(t); setEdits({}); setSelected(new Set()); }}
              trailing={
                <ConditionPanel open={panelOpen} onOpenChange={setPanelOpen} activeCount={condCount(live)} anchorSel=".drf"
                  tabs={<SavedTabs list={saved.list} current={paramsNow} basic={paramsBasic}
                    onApply={(sv) => { applySaved(sv.params || {}); setPanelOpen(false); }}
                    onBasic={() => { const b = defaultRangeMonth(); setFromM(b.from); setToM(b.to); clearAll(); }}
                    onRemove={saved.remove} onSetDefault={saved.setDefault} />}
                  foot={<>
                    <button type="button" className="btn-secondary btn-sm" disabled={condCount(draft) === 0} onClick={() => setDraft({ ...EMPTY_COND, rows: draft.rows })}>조건 지우기</button>
                    <ConditionSave suggest={suggestName}
                      onSave={(name, asDefault) => { saved.save(name, { from: fromM, to: toM, q, cond: draft }, asDefault); setLive(draft); setPanelOpen(false); }} />
                    <span className="ml-auto text-[11px] text-[var(--text-dim)]">{previewCount.toLocaleString("ko")}장</span>
                    <RowsPerPage value={draft.rows} onChange={setD("rows")} />
                    <button type="button" className="btn-primary btn-sm" onClick={() => { setLive(draft); setPanelOpen(false); }}>조회</button>
                  </>}>
                  <ConditionRow label="조회기간" hint="월 단위 · 위 입력 일자와는 별개">
                    <span className="qk-range-txt">{fromM} ~ {toM}</span>
                    <DateRangeField unit="month" label={null} parts="calendar" confirm from={fromM} to={toM}
                      onChange={(f, t) => { setFromM(f); setToM(t); setEdits({}); setSelected(new Set()); }} />
                    <span className="qk-quicks">
                      {periodQuicksMonth().map((pq) => (
                        <button key={pq.key} type="button" onClick={() => { setFromM(pq.from); setToM(pq.to); }}
                          className={fromM === pq.from && toM === pq.to ? "qk-quick qk-quick-on" : "qk-quick"}>{pq.label}</button>
                      ))}
                    </span>
                  </ConditionRow>
                  <ConditionRow label="계정과목" hint="여러 개 · 그 계정이 든 전표">
                    <TokenField items={acctOpts} value={draft.acct} onChange={setD("acct")} placeholder="계정 이름 일부 (예: 소모품)" />
                  </ConditionRow>
                  <ConditionRow label="거래처" hint="여러 곳">
                    <TokenField items={ptOpts} value={draft.pt} onChange={setD("pt")} placeholder="거래처 이름 일부" />
                  </ConditionRow>
                </ConditionPanel>
              } />
            <QuickSearch value={q} onApply={setQ} placeholder="계정 · 거래처 · 적요 · 전표번호 · 금액 — 쉼표로 여러 개, Enter" />
          </QueryBar>

          <AppliedChips chips={chips} onClearAll={clearAll} />

          <ResultStrip right={spCount > 0 ? (
            <Link href="/partners/reconciliation/sale-purchase" className="ve-sp-note">매입매출전표 {spCount}건은 <b>매입매출전표</b> 메뉴에 →</Link>
          ) : undefined}>
            <Stat label="전표" value={`${filteredEntries.length.toLocaleString("ko")}장`} />
            <Stat label="차변 합계" value={won(sumD)} />
            <Stat label="대변 합계" value={won(sumC)} />
            {filteredEntries.length > 0 && <span className={sumD === sumC ? "text-[10.5px] font-bold text-emerald-500" : "text-[10.5px] font-bold text-amber-500"}>{sumD === sumC ? "차대일치" : `차액 ${won(Math.abs(sumD - sumC))}`}</span>}
            <span className="hidden md:inline text-[10.5px] text-[var(--text-dim)]">셀 클릭 = 인라인 수정 · 행 우클릭 = 삽입/복사/삭제</span>
          </ResultStrip>
        </QueryHead>

        <QueryBody>
        <div className="ev-scroll">
          <table className="ev-table ev-lined ve-list-table">
            <thead>
              <tr>
                <th className="w-8">
                  <button type="button" aria-label="이 쪽 전체 선택"
                    onClick={() => setSelected(pager.view.length > 0 && pager.view.every((x) => selected.has(`s:${x.id}`)) ? new Set() : new Set(pager.view.map((x) => `s:${x.id}`)))}
                    className={pager.view.length > 0 && pager.view.every((x) => selected.has(`s:${x.id}`)) ? "collect-chk collect-chk-on" : "collect-chk"}>
                    {pager.view.length > 0 && pager.view.every((x) => selected.has(`s:${x.id}`)) ? "✓" : ""}
                  </button>
                </th>
                {/* 제목줄 정렬 — ⚠️ 전표는 **장 단위**로 옮긴다: 한 전표의 분개 줄이 흩어지면 차·대를 못 읽는다 */}
                <SortableTh label="No" sortKey="no" sort={sort} onSort={onSort} style={{ width: 44 }} />
                <SortableTh label="일자" sortKey="date" sort={sort} onSort={onSort} style={{ width: 92 }} />
                <SortableTh label="구분" style={{ width: 76 }} />
                <SortableTh label="계정코드" style={{ width: 76 }} />
                <SortableTh label="계정명" sortKey="account" sort={sort} onSort={onSort} />
                <SortableTh label="거래처코드" style={{ width: 104 }} />
                <SortableTh label="거래처명" sortKey="partner" sort={sort} onSort={onSort} />
                <SortableTh label="차변" sortKey="debit" sort={sort} onSort={onSort} style={{ width: 116 }} />
                <SortableTh label="대변" sortKey="credit" sort={sort} onSort={onSort} style={{ width: 116 }} />
                <SortableTh label="적요코드" style={{ width: 68 }} />
                <SortableTh label="적요" sortKey="memo" sort={sort} onSort={onSort} />
              </tr>
            </thead>
            <tbody>
              {pager.view.map((e) => {
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
                            <td className={`${TD} mono-number text-[var(--text-dim)]`}>{i === 0 ? e.entry_date : ""}</td>
                            <td className={`${TD} w-[64px]`}>
                              {l.gubun === "1" || l.gubun === "2" ? (
                                <span className="text-[11px] font-semibold text-[var(--text-muted)]">{GUBUN_LABEL[l.gubun]}</span>
                              ) : (
                                <div className="relative">
                                  <select value={l.gubun} onChange={(ev) => setEditLine(e.id, l.key, { gubun: ev.target.value as Gubun })} className={`${IN} cursor-pointer appearance-none pl-1.5 pr-4 py-1`}>
                                    <option value="3">3.차변</option><option value="4">4.대변</option>
                                  </select>
                                  <span className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-[8px] text-[var(--text-dim)]">▾</span>
                                </div>
                              )}
                            </td>
                            {acctCell(l, rowId, (p) => setEditLine(e.id, l.key, p), true)}
                            <td className={`${TD} text-[var(--text)] cursor-pointer`} onClick={(e) => setPicker({ kind: "acct", rowId, q: "", anchor: anchorOf(e.currentTarget) })}>
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
                        <td colSpan={12} className="px-3 py-1 text-[10px] font-semibold">
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
                      className={`border-b border-[var(--border)]/40 hover:bg-[var(--bg-surface)]/60 transition-colors duration-700 ${isFlash ? "bg-emerald-500/15" : ""} ${i === 0 ? "border-t-2 border-t-[var(--border)]" : ""}`}
                      onContextMenu={(ev) => { ev.preventDefault(); setCtx({ x: ev.clientX, y: ev.clientY, rowId }); }}
                      title={`전표 #${e.voucher_no ?? "—"}${e.description ? ` · ${e.description}` : ""} — 셀 클릭으로 인라인 수정`}>
                      <td className="px-2 py-1 text-center">
                        <input type="checkbox" checked={selected.has(`s:${e.id}`)}
                          onChange={(ev) => setSelected((s) => { const n = new Set(s); if (ev.target.checked) n.add(`s:${e.id}`); else n.delete(`s:${e.id}`); return n; })}
                          title="전표 단위 선택 (분개 균형 유지를 위해 전표째 삭제)" />
                      </td>
                      <td className="px-2 py-1 text-center text-[var(--text-dim)] mono-number">{listNo}</td>
                      <td className={`${TD} mono-number text-[var(--text-dim)] cursor-text`} onClick={() => enterEdit(e)}>{i === 0 ? e.entry_date : ""}</td>
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
                <td colSpan={10} className={`${TD} text-[var(--text-dim)] text-[11px]`}>
                  {entries.length === 0 ? "이 기간에 저장된 전표가 없습니다 — " : ""}빈 행 — 클릭하면 위 입력 영역에서 이어서 입력
                </td>
              </tr>
            </tbody>
            {filteredEntries.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-[var(--border)] bg-[var(--bg-surface)]/70 font-bold">
                  <td colSpan={7} className="px-3 py-2.5 text-right text-[10px] uppercase tracking-wide text-[var(--text-dim)]">합계</td>
                  <td className="px-2 py-2.5 text-right mono-number text-sm text-[var(--text)]">{sumD.toLocaleString()}</td>
                  <td className="px-2 py-2.5 text-right mono-number text-sm text-[var(--text)]">{sumC.toLocaleString()}</td>
                  <td colSpan={2} className="px-2 py-2.5">
                    <span className="inline-flex px-2.5 py-1 rounded-full bg-emerald-500/10 text-emerald-500 text-[11px] font-bold">차대일치</span>
                  </td>
                </tr>
              </tfoot>
            )}
          </table>
        </div>
          {/* ── 3줄 · 고른 전표로 하는 일 — 삭제는 되돌릴 수 없어 확인창을 거친다 ── */}
          <SelectionBar count={selected.size} onClear={() => setSelected(new Set())}>
            <button type="button" className="btn-secondary btn-sm text-[var(--danger)]" disabled={busy} onClick={deleteSelected}>
              선택 삭제 ({selected.size})
            </button>
          </SelectionBar>
        </QueryBody>
        <Pager page={pager.page} pages={pager.pages} total={sortedEntries.length} size={live.rows}
          from={pager.from} to={pager.to} onPage={pager.setPage} />
        {/*   안내는 상자 **안** 마지막 줄에 — 밖에 두면 상자 끝선이 사이드바 끝선과 어긋난다 (2026-08-18 사장님) */}
        <p className="collect-note">
          ※ 전표입력은 장부 기록입니다 — 계산서↔입금 대사(미수금 차감)는 <Link href="/partners/reconciliation" className="text-[var(--primary)] hover:underline">거래 대사</Link>에서 별도 처리 · 수정하면 변경 전 값이 이력으로 남고, 마감(잠금)된 월은 저장·수정·삭제가 차단됩니다
        </p>
      </QueryScreen>

      {/* 우클릭 메뉴 (§3-3-A: 행 삽입/복사/삭제) */}
      {ctx && (
        <div className="voucher-entry-context-menu fixed z-[80] rounded-xl border border-[var(--border)] bg-[var(--bg-card)] shadow-2xl p-1.5 text-xs"
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


    </div>
  );
}
