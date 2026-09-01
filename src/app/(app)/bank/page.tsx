"use client";
import { todayKst, kstDateStr } from "@/lib/kst";
import { downloadCsv, rangeSuffix } from "@/lib/csv-export";
import { Ico } from "@/components/ui-icon";
import { logRead } from "@/lib/log-read";
import { fetchPaged } from "@/lib/fetch-paged";

// /bank — 통장 자립 페이지(시안 그대로). 시안 portfolio 카드 + 시안 거래내역 표 직접 구현.
//   기존 BankAccountsOverview / TransactionsView 미사용 (그쪽은 /transactions 에서 그대로).
//   표시 전용 — 새 mutation·RPC 0. read-only 쿼리만.

import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { BarChart } from "@/components/charts/kit";
import { supabase } from "@/lib/supabase";
import { markConnectedOnce } from "@/lib/analytics";
import { useUser } from "@/components/user-context";
import { useMyPermissions } from "@/lib/permissions";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { useSyncCooldown } from "@/lib/sync-cooldown";
import { getSyncPausedUntil, setSyncPause, clearSyncPause } from "@/lib/data-sync";
import { getBankSyncAccess } from "@/lib/billing";
import { DateRangeField } from "@/components/date-range-field";
import { getBankAccountChanges, getDistinctBankAccountNos, updateBankAccountMeta, deleteBankAccountSafe } from "@/lib/queries";
import { setLedgerExcluded, excludeLabelOf } from "@/lib/dup-voucher";
import { useLedgerExcludePrompt } from "@/components/ledger-exclude-prompt";
import { UpcomingAutoTransfersCard } from "@/components/upcoming-auto-transfers";
import { EmptyState } from "@/components/empty-state";
import { useConfirm } from "@/components/confirm-dialog";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { AccountPicker } from "@/components/account-picker";
import { BankLineDialog, bankLineState, BANK_LINE_META, type BankLineTx } from "@/components/bank-line-dialog";
import { AutoTransferHistoryCard } from "@/components/auto-transfer-history";
import { TopExpensesThisMonth } from "@/components/top-expenses-month";
import { BankStatusPanels } from "@/components/finance-status-panels";
import { SortableTh, useColWidths, type ThFilterSpec } from "@/components/sortable-th";
import { BankLogo } from "@/components/bank-logo";
import {
  QueryScreen, QueryHead, QueryBody, QueryBar, ChipGroup, RowsPerPage, ResultStrip, Stat as QStat,
  SelectionBar, ExcelMenu, type ExcelItem, QuickSearch, quickSearchHit, quickTerms, Pager, usePager,
  ConditionPanel, ConditionRow, TokenField, AmountRange, amountHit, AppliedChips, type AppliedChip,
  defaultRange, periodQuicks, useSavedQueries, SavedTabs, ConditionSave,
} from "@/components/query-kit";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

const fmtW = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;
const ymd = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

type Tab = "overview" | "accounts" | "transactions";

//   상태 칩 — 2026-08-27: 분류(카테고리) 매핑을 없앴다. 줄의 상태는 증빙 연결·일반전표·장부 제외 셋으로만 본다
//   (bank-line-dialog 의 bankLineState). '연결 대기'는 정산 초안(invoice_settlements suggested)이 있는 줄.

/*  ── 조회 화면 표준 (2026-08-13 확정) — 수집·전표와 같은 검색조건/줄수/내 조건 구성 ──
    ★ 여기 있는 것은 **'조회'를 눌러야** 반영된다. 기간·빠른검색은 조회 줄에 있어 즉시다. */
const TX_IO_CHIPS = [
  { value: "all", label: "전체" }, { value: "in", label: "입금" }, { value: "out", label: "출금" },
] as const;
//   기본은 '미전표'(전표 안 된 것만) — 전표처리된 건은 목록에서 사라진다 (2026-08-19 사장님). 전체·전표됨은 골라 본다.
const TX_STATE_CHIPS = [
  { value: "unposted", label: "미처리" }, { value: "all", label: "전체" }, { value: "pending", label: "연결 대기" },
  { value: "linked", label: "증빙 연결" }, { value: "posted", label: "전표됨" }, { value: "excluded", label: "장부 제외" },
] as const;
type TxCond = {
  who: string[];    // 예금주명
  accts: string[];  // 계좌(accountNo — 통장 탭 카드 클릭이 여기로 들어온다)
  cls: string[];    // 분류(계정과목 이름)
  io: (typeof TX_IO_CHIPS)[number]["value"];
  state: (typeof TX_STATE_CHIPS)[number]["value"];
  min: string; max: string;
  size: number;     // 한 쪽에 몇 줄 — 조건의 하나라 '내 조건'에 같이 저장된다
};
const TX_EMPTY: TxCond = { who: [], accts: [], cls: [], io: "all", state: "unposted", min: "", max: "", size: 50 };
/** 배지에 셀 것 — 줄 수는 '좁히는 조건'이 아니라 보기 방식이라 안 센다 */
const txCondCount = (c: TxCond) =>
  c.who.length + c.accts.length + c.cls.length
  + (c.io !== "all" ? 1 : 0) + (c.state !== "all" ? 1 : 0) + ((c.min || c.max) ? 1 : 0);

export default function BankPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const bankCd = useSyncCooldown(companyId, "bank"); // 통장 연동 30분 쿨타임 (회사 공유 — 연속 클릭이 CODEF 오류·은행 이중로그인 유발)
  const userId = user?.id ?? null;
  //   ?tab=transactions — 재무 › 전표 현황 '통장 거래(미처리) › 처리' 가 거래내역으로 바로 온다 (2026-08-27)
  const [tab, setTab] = useState<Tab>(() => {
    const t = typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("tab") : null;
    return t === "transactions" || t === "overview" ? t : "accounts";
  });
  const { isMaster: bankTabMaster, hasPerm: bankTabPerm } = useMyPermissions();
  // 미허용 탭 진입 가드 — 첫 허용 탭으로
  useEffect(() => {
    const allowed = (k: Tab) => bankTabMaster || bankTabPerm(`/bank:${k}`);
    if (!allowed(tab)) {
      const first = (["overview", "accounts", "transactions"] as Tab[]).find(allowed);
      if (first) setTab(first);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, bankTabMaster, bankTabPerm]);
  const queryClient = useQueryClient();
  //   통장 줄 처리 팝업 (증빙 연결 · 일반전표 · 장부 제외) — 상태 칩을 누르면 연다
  const [lineTx, setLineTx] = useState<any | null>(null);
  const { toast } = useToast();
  const { confirm, confirmElement } = useConfirm();
  const [syncing, setSyncing] = useState(false);
  // 은행·카드 연동 허용 여부 (무료 플랜은 불가 — 서버도 402 로 막는다)
  const { data: bankSync } = useQuery({
    queryKey: ["bank-sync-access", companyId],
    queryFn: () => getBankSyncAccess(companyId!),
    enabled: !!companyId,
    staleTime: 5 * 60_000,
  });
  // 연동 일시정지(중복 로그인 방지) — company_settings.settings.sync_paused_until.
  const { data: syncPausedUntil } = useQuery({
    queryKey: ["bank-sync-paused", companyId],
    queryFn: () => getSyncPausedUntil(companyId!),
    enabled: !!companyId,
    refetchInterval: 30000,
  });
  const isSyncPaused = !!syncPausedUntil;
  const pauseMut = useMutation({
    mutationFn: async () => {
      if (isSyncPaused) { await clearSyncPause(companyId!); return false; }
      await setSyncPause(companyId!, 30); return true;
    },
    onSuccess: (paused) => {
      queryClient.invalidateQueries({ queryKey: ["bank-sync-paused", companyId] });
      toast(paused ? "연동을 30분간 정지했습니다 — 은행에 직접 로그인해도 강제 로그아웃되지 않습니다" : "연동 정지를 해제했습니다", "success");
    },
    onError: (e: any) => toast(friendlyError(e, "정지 처리 실패"), "error"),
  });
  // 통장 거래 기간 — 연동 시 CODEF sync 범위 + 거래내역 표 필터에 공통 적용 (카드 페이지와 동일 패턴)
  //   ★ 기본값은 최근 1개월 (조회 화면 표준) — 예전 '미설정=최근 50건' 방식을 버렸다.
  const [bankTxFrom, setBankTxFrom] = useState<string>(() => defaultRange().from);
  //   통장 탭 보기 — 표가 기본, 카드는 보기 옵션 (2026-08-19 조회 표준: 목록은 표)
  const [accountsView, setAccountsView] = useState<"list" | "card">("list");
  //   통장 동작 확장 (2026-08-19 사장님: 이름 변경만으론 단편적) — 수정(이름·메모)·숨김·삭제. 숨긴 통장은 목록에서만 빠진다(합계·연동 그대로)
  const [showHiddenAccts, setShowHiddenAccts] = useState(false);
  const [acctEdit, setAcctEdit] = useState<{ accountNo: string; alias: string; memo: string; bankName?: string; balance: number } | null>(null);
  const [acctSaving, setAcctSaving] = useState(false);
  const refreshAccts = () => { queryClient.invalidateQueries({ queryKey: ["bank-page-accounts-distinct"] }); queryClient.invalidateQueries({ queryKey: ["bank-accounts-distinct"] }); };
  const saveAcctEdit = async () => {
    if (!acctEdit || !companyId) return;
    setAcctSaving(true);
    try { await updateBankAccountMeta(companyId, acctEdit.accountNo, { alias: acctEdit.alias, memo: acctEdit.memo }, { bankName: acctEdit.bankName, balance: acctEdit.balance }); refreshAccts(); toast("통장 정보를 저장했습니다", "success"); setAcctEdit(null); }
    catch (e: any) { toast(friendlyError(e, "저장 실패"), "error"); } finally { setAcctSaving(false); }
  };
  const toggleAcctHidden = async (a: { accountNo: string; isHidden?: boolean; bankName?: string; balance: number }) => {
    if (!companyId) return;
    try { await updateBankAccountMeta(companyId, a.accountNo, { is_hidden: !a.isHidden }, { bankName: a.bankName, balance: a.balance }); refreshAccts(); toast(a.isHidden ? "다시 보입니다" : "목록에서 숨겼습니다 — '숨긴 통장 보기'로 되돌릴 수 있습니다", "success"); }
    catch (e: any) { toast(friendlyError(e, "변경 실패"), "error"); }
  };
  const removeAcct = async (a: { accountNo: string; alias?: string; bankName?: string }) => {
    if (!companyId) return;
    const { ok } = await confirm({ title: "통장 삭제", desc: `"${a.alias || a.bankName || a.accountNo}"을(를) 삭제할까요? 거래가 있는 통장은 삭제되지 않습니다(숨김을 쓰세요). 삭제는 되돌릴 수 없습니다.`, danger: true, confirmLabel: "삭제" });
    if (!ok) return;
    try { await deleteBankAccountSafe(companyId, a.accountNo); refreshAccts(); toast("삭제했습니다", "success"); }
    catch (e: any) { toast(friendlyError(e, "삭제 실패"), "error"); }
  };
  const [bankTxTo, setBankTxTo] = useState<string>(() => defaultRange().to);
  //   조회 줄 — 빠른검색(즉시) + 검색조건 패널(조회를 눌러야). 수집·전표와 같은 draft/live 구도.
  //   통장 탭 카드 클릭의 '이 통장만'은 검색조건의 계좌 칩으로 들어온다(배너 방식 폐기).
  const [txQ, setTxQ] = useState("");
  const [txPanelOpen, setTxPanelOpen] = useState(false);
  const [txDraft, setTxDraft] = useState<TxCond>(TX_EMPTY);
  const [txLive, setTxLive] = useState<TxCond>(TX_EMPTY);
  const setTxD = <K extends keyof TxCond>(k: K) => (v: TxCond[K]) => setTxDraft((c) => ({ ...c, [k]: v }));
  const seedAccountCond = (accNo: string) => {
    const c = { ...TX_EMPTY, accts: [accNo] };
    setTxDraft(c); setTxLive(c); setTxQ("");
  };
  // 거래내역 표 — 헤더 더블클릭 정렬 + 행 체크박스 다중선택 (UI 전용, DB 변경 없음)
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("desc");
  const [selectedTxIds, setSelectedTxIds] = useState<Set<string>>(new Set());
  // 직원 QA — 서브탭에서 뒤로가기 하면 통장 탭으로 한 번 돌아간 뒤 페이지를 떠남.
  //   2026-07-20 QA: 탭 전환마다 pushState 를 쌓아 뒤로가기가 탭 되감기에 갇히던 문제 —
  //   기본탭→서브탭 진입 때만 1회 push, 서브탭끼리는 replace 로 히스토리 오염을 1칸으로 제한.
  const goTab = (t: Tab) => {
    if (typeof window !== "undefined") {
      if (tab === "accounts" && t !== "accounts") window.history.pushState({ bankTab: t }, "");
      else window.history.replaceState({ bankTab: t }, "");
    }
    setTab(t);
  };
  useEffect(() => {
    const onPop = (e: PopStateEvent) => {
      const t = (e.state && (e.state as any).bankTab) as Tab | undefined;
      const next: Tab = t || "accounts";
      setTab(next);
      if (next !== "transactions") { setTxDraft((c) => ({ ...c, accts: [] })); setTxLive((c) => ({ ...c, accts: [] })); }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);
  // 같은 key 재더블클릭 시 방향 토글, 다른 key 면 key 설정 + 기본 방향(날짜·금액=desc, 그 외=asc).
  const onSortTx = (key: string) => {
    setSortKey((prev) => {
      if (prev === key) {
        setSortDir((d) => (d === "asc" ? "desc" : "asc"));
        return prev;
      }
      setSortDir(key === "transaction_date" || key === "amount" ? "desc" : "asc");
      return key;
    });
  };

  // 통장 이름 편집은 2026-08-19 '수정' 팝업(이름·메모)으로 — setAcctEdit


  // 통장 연동(CODEF 은행 sync + 잔액 재계산) — /transactions 의 동일 흐름 재사용.
  //   기간 필수 — 미설정이면 서버 기본(최근 3개월)에 의존해 원하는 기간이 누락될 수 있음 (카드 연동과 동일 정책).
  //   CODEF 는 YYYYMMDD 형식만 받으므로 대시 제거 후 전달.
  const handleSyncBank = async () => {
    if (!companyId) return;
    if (!bankTxFrom || !bankTxTo) { toast("통장 거래 기간(시작일·종료일)을 먼저 설정한 뒤 연동하세요", "error"); return; }
    setSyncing(true);
    try {
      const { syncCodefData, syncBankBalances } = await import("@/lib/data-sync");
      const result = await syncCodefData(companyId, "bank", bankTxFrom.replace(/-/g, ""), bankTxTo.replace(/-/g, ""));
      if (!result.success && result.status !== "partial") {
        toast(result.error || "통장 연동 실패", "error");
        return;
      }
      markConnectedOnce(companyId, "bank");
      const synced = result.bankSynced ?? 0;
      // 예금주명 백필 — 은행이 desc1에 채널명만 주고 이름을 안 준 거래를
      //   상대계좌번호·거래처명 매칭으로 채운다 (실패해도 동기화 결과엔 영향 없음)
      try { await db.rpc("backfill_bank_counterparty", { p_company_id: companyId }); } catch { /* best-effort */ }
      const balResult = await syncBankBalances(companyId);
      // 통장·거래·잔액 모두 새로 받아오기
      queryClient.invalidateQueries({ queryKey: ["bank-page-accounts-distinct"] });
      queryClient.invalidateQueries({ queryKey: ["bank-page-changes"] });
      queryClient.invalidateQueries({ queryKey: ["bank-page-flow-v2"] });
      queryClient.invalidateQueries({ queryKey: ["bank-page-recent-tx"] });
      queryClient.invalidateQueries({ queryKey: ["bank-accounts-distinct"] });
      queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
      try { window.dispatchEvent(new CustomEvent("ownerview:codef-synced")); } catch { /* ignore */ }
      const balMsg = balResult.status === "success" ? ` · ${balResult.message}` : "";
      // 오류는 화이트리스트가 아니라 전부 보여준다 (2026-08-19): 종전엔 4개 코드만 검사해
      //   CF-04015(연동 깨짐) 등이 "새 거래 없음"(초록)으로 가려졌다 — 3주 무음 실사고의 화면 쪽 원인.
      const firstError = (result.errors || [])[0] as any;
      const blockerNote = (result.notes || []).find((n: any) =>
        n.code === "NO_DEMAND_DEPOSIT" || n.code === "CF-00401" || n.code === "CF-00003" || n.code === "CF-13021",
      );
      if (firstError) {
        toast(`통장 동기화 오류 — ${firstError.message}${firstError.hint ? ` · ${firstError.hint}` : ""}`, "error");
      } else if (synced > 0) {
        toast(`통장 거래 ${synced}건 불러옴${balMsg}`, "success");
      } else if (blockerNote) {
        toast(`통장 연동 — ${blockerNote.message}${blockerNote.hint ? ` · ${blockerNote.hint}` : ""}`, "info");
      } else {
        toast(`통장 연동 완료 — 새 거래 없음${balMsg}`, "info");
      }

      // 동기화 후 자동분류(비차단) — 규칙·학습 기반. UI 를 막지 않고 백그라운드로 실행,
      //   완료 시 매칭된 건이 있을 때만 결과 토스트 + 목록 갱신. (매칭분만 auto_mapped → 반복 실행 시 수렴)
      import("@/lib/automation")
        .then(({ applyBankClassificationRules }) => applyBankClassificationRules(companyId))
        .then((r) => {
          const n = r?.matched || 0;
          if (n > 0) {
            toast(`미분류 거래 ${n}건 자동분류 완료`, "success");
            queryClient.invalidateQueries({ queryKey: ["bank-page-recent-tx"] });
            queryClient.invalidateQueries({ queryKey: ["bank-transactions"] });
            queryClient.invalidateQueries({ queryKey: ["bank-page-flow-v2"] });
            queryClient.invalidateQueries({ queryKey: ["bank-page-changes"] });
          }
        })
        .catch(() => { /* 자동분류 실패는 비차단 — 수동 분류로 진행 가능 */ });

      // 동기화 후 입금↔계산서 매칭 '제안' 자동 생성(비차단) — 새 입금에 대한 정산 제안을 미리 만들어 둠.
      //   확정/미수금 반영은 사람이 '거래 대사' 확인 큐에서(확정은 사람 원칙). RPC 는 on-conflict-do-nothing 이라 중복 제안 안 만듦.
      (async () => {
        try {
          const end = todayKst();
          const s = new Date(); s.setDate(s.getDate() - 120);
          const start = kstDateStr(s);
          const data = logRead('bank/page:data', await (supabase).rpc("generate_settlement_suggestions", { p_start: start, p_end: end }));
          const sug = Number((data as any)?.suggested || 0);
          if (sug > 0) toast(`입금 매칭 제안 ${sug}건 생성 — '거래 대사'에서 확인·확정하세요`, "info");
        } catch { /* 제안 생성 실패는 비차단 */ }
      })();
    } catch (e: any) {
      toast(friendlyError(e, "통장 연동 오류"), "error");
    } finally {
      setSyncing(false);
    }
  };

  // 기간 — 이번 달 KST · 전월 동일(증감 계산용).
  //   QA 2026-06-12: +9h 후 로컬 getFullYear/getMonth 를 읽으면 KST 브라우저에선 이중 가산
  //   (월말 저녁에 다음 달로 넘어감) → UTC 게터로 교정.
  const ranges = useMemo(() => {
    const kst = new Date(Date.now() + 9 * 3600 * 1000);
    const y = kst.getUTCFullYear(), m = kst.getUTCMonth();
    const cur = { from: new Date(y, m, 1), to: new Date(y, m + 1, 0) };
    const prev = { from: new Date(y, m - 1, 1), to: new Date(y, m, 0) };
    return { curFrom: ymd(cur.from), curTo: ymd(cur.to), prevFrom: ymd(prev.from), prevTo: ymd(prev.to) };
  }, []);

  // 통장 목록 — BankAccountsOverview 와 동일 소스(`getDistinctBankAccountNos`).
  //   bank_accounts 테이블 직접 read 는 빈 회사가 많아 거래에서 derive 한 distinct 가 정합.
  //   반환 shape: { accountNo, count, balance, alias?, bankName? }
  const { data: accounts = [] } = useQuery({
    queryKey: ["bank-page-accounts-distinct", companyId],
    queryFn: () => getDistinctBankAccountNos(companyId!),
    enabled: !!companyId,
  });

  // 통장별 이번 달 증감 (income−expense). 기존 lib 재사용 — 가짜 metric 금지.
  const { data: changes } = useQuery({
    queryKey: ["bank-page-changes", companyId, ranges.curFrom, ranges.curTo],
    queryFn: () => getBankAccountChanges(companyId!, ranges.curFrom, ranges.curTo),
    enabled: !!companyId,
  });
  const changeByAcct = changes?.byAccount || {};

  // 이번 달 + 전월 합계 (stat 4 — 가짜 % 금지).
  const { data: flow } = useQuery({
    queryKey: ["bank-page-flow-v2", companyId, ranges.curFrom, ranges.curTo],
    queryFn: async () => {
      const [cur, prev] = await Promise.all([
        fetchPaged<any>("bank/page:flow-cur", () => db.from("bank_transactions").select("amount, type, mapping_status").eq("company_id", companyId ?? "").gte("transaction_date", ranges.curFrom).lte("transaction_date", ranges.curTo).order("id"), 50000),
        fetchPaged<any>("bank/page:flow-prev", () => db.from("bank_transactions").select("amount, type").eq("company_id", companyId ?? "").gte("transaction_date", ranges.prevFrom).lte("transaction_date", ranges.prevTo).order("id"), 50000),
      ]);
      const sum = (rows: any[], t: string) => (rows || []).filter((r) => r.type === t).reduce((s: number, r: any) => s + Math.abs(Number(r.amount || 0)), 0);
      const mapped = cur.filter((r: any) => r.mapping_status && r.mapping_status !== "unmapped").length;
      const total = cur.length;
      return {
        income: sum(cur, "income"),
        expense: sum(cur, "expense"),
        prevIncome: sum(prev, "income"),
        prevExpense: sum(prev, "expense"),
        mapped, total,
      };
    },
    enabled: !!companyId,
  });

  // 시안 거래내역 표 — 기간(기본 최근 1개월) 전체, 상한 2000 read-only.
  //   계좌 필터는 client-side (raw_data->>accountNo PostgREST eq 불안정 — transactions 페이지와 동일 패턴).
  const { data: recentTx = [] } = useQuery({
    queryKey: ["bank-page-recent-tx", companyId, bankTxFrom, bankTxTo],
    queryFn: async () => {
      const data = await fetchPaged<any>("bank/page:tx", () => {
        let q = db.from("bank_transactions")
          .select("id, transaction_date, type, amount, counterparty, description, classification, category, mapping_status, balance_after, raw_data, journal_entry_id, ledger_excluded_reason, is_fixed_cost, memo, tags, used_by_employee_id, partner_id, settlement_status, settled_amount, tax_invoice_id")
          .eq("company_id", companyId ?? "")
          .order("transaction_date", { ascending: false })
          .order("id");
        if (bankTxFrom) q = q.gte("transaction_date", bankTxFrom);
        if (bankTxTo) q = q.lte("transaction_date", bankTxTo);
        return q;
      }, 50000);
      const rows = (data || []) as any[];
      // 직원 QA #통장거래내역2 — 같은 날짜 거래는 시간(raw_data.trTime, HHMMSS)까지 반영해 최신순 정렬.
      //   날짜만으로 정렬하면 같은 날 거래 순서가 뒤섞여 잔액·마지막 거래가 안 맞던 문제.
      return [...rows].sort((a, b) => {
        const ka = `${a.transaction_date || ""} ${String(a.raw_data?.trTime || "").padStart(6, "0")}`;
        const kb = `${b.transaction_date || ""} ${String(b.raw_data?.trTime || "").padStart(6, "0")}`;
        return kb.localeCompare(ka); // 최신(날짜+시간) 먼저
      });
    },
    enabled: !!companyId && tab === "transactions",
  });

  // 전표처리용 계정과목 (일괄 전표 모달)
  const { data: coaAccounts = [] } = useQuery({
    queryKey: ["bank-page-coa-accounts", companyId],
    queryFn: async () => {
      const data = logRead('bank/page:data', await db.from("chart_of_accounts").select("id, code, name, account_type").eq("company_id", companyId ?? "").order("code"));
      return (data || []) as any[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });

  //   연결 대기 — 사람이 고른 정산 초안(match_source manual · suggested)이 걸린 통장 줄. 엔진·AI 제안은 팝업 안에서만 보인다(결정 46). 확정은 팝업·재무 › 전표 현황 › 처리할 것에서
  const { data: pendingSettles = [] } = useQuery({
    queryKey: ["bank-page-pending-settles", companyId],
    queryFn: async () => {
      const data = await fetchPaged<any>("bank/page:pending-settles", () => (db as any).from("invoice_settlements").select("bank_transaction_id").eq("company_id", companyId ?? "").eq("match_source", "manual").in("status", ["suggested", "needs_review"]).not("bank_transaction_id", "is", null).order("id"), 50000);
      return ((data || []) as { bank_transaction_id: string }[]).map((r) => r.bank_transaction_id);
    },
    enabled: !!companyId, staleTime: 30_000,
  });
  const pendingIds = useMemo(() => new Set(pendingSettles as string[]), [pendingSettles]);
  const lineStateOf = (tx: any) => bankLineState(tx as BankLineTx, pendingIds);
  const afterLine = () => {
    queryClient.invalidateQueries({ queryKey: ["bank-page-recent-tx"] });
    queryClient.invalidateQueries({ queryKey: ["bank-page-pending-settles"] });
    queryClient.invalidateQueries({ queryKey: ["bank-page-flow-v2"] });
    queryClient.invalidateQueries({ queryKey: ["bank-page-changes"] });
  };
  // 직원 QA 통장(그랜터) — 사용직원 선택용 재직 직원 목록
  const { data: bankEmployees = [] } = useQuery({
    queryKey: ["bank-page-employees", companyId],
    queryFn: async () => {
      const data = logRead('bank/page:data', await db.from("employees").select("id, name").eq("company_id", companyId ?? "").eq("status", "active").order("name"));
      return (data || []) as any[];
    },
    enabled: !!companyId, staleTime: 300_000,
  });
  const bankEmpById: Record<string, string> = {};
  for (const e of bankEmployees as any[]) bankEmpById[e.id] = e.name;
  // 직원 QA — 거래내용은 '거래내용'만: 예금주명(=counterparty)·거래구분 토큰을 제외하고 표시.
  //   raw_data.descs(원본 4칸)가 있으면 그걸로 계산(기존 재동기화분도 즉시 반영), 없으면 description 폴백.
  const TR_TYPES = ["타행이체", "당행이체", "인터넷", "자동이체", "대체", "펌뱅킹", "펌뱅크", "CD", "ATM", "체크카드", "급여", "이자", "스마트뱅킹", "폰뱅킹", "창구", "지로", "전자금융", "모바일뱅킹", "모바일", "송금", "이체", "출금", "입금", "카드", "공과금"];
  const displayMemo = (tx: any): string => {
    const descs = tx?.raw_data?.descs;
    if (Array.isArray(descs) && descs.length) {
      // descs 가 있으면 예금주명·거래구분·중복을 제외한 '거래내용'만. 남는 게 없으면 빈값(→ "—").
      //   ※ 폴백으로 tx.description(합쳐진 원본)을 쓰면 "A · 타행이체 · A" 처럼 다시 섞여 나오므로 폴백 금지.
      const cp = String(tx.counterparty || "").trim();
      const seen = new Set<string>();
      return descs.map((d: any) => String(d).trim()).filter((d: string) => {
        if (!d || d === cp || TR_TYPES.includes(d) || seen.has(d)) return false;
        seen.add(d); return true;
      }).join(" ");
    }
    return tx.description || "";
  };

  // 일괄 전표처리 — 선택된 미처리 통장거래를 계정 1개로 순차 post_bank_voucher(방향 자동 분기).
  const [showBulkPost, setShowBulkPost] = useState(false);
  const [bulkAccountId, setBulkAccountId] = useState<string>("");
  const [bulkFixed, setBulkFixed] = useState(false); // 고정비로 표시 — 전표처리와 함께 is_fixed_cost 저장
  const [bulkPosting, setBulkPosting] = useState(false);
  //   장부 제외 (2026-08-19) — 선택한 미전표 거래를 사유와 함께 전표 없이 끝낸다 / 제외 해제
  const { askExclude, excludePromptElement } = useLedgerExcludePrompt();
  const excludeSelected = async () => {
    const ids = Array.from(selectedTxIds).filter((id) => { const t = (recentTx as any[]).find((x) => x.id === id); return t && !t.journal_entry_id && !t.ledger_excluded_reason; });
    if (ids.length === 0) { toast("장부 제외할 미전표 거래를 고르세요", "info"); return; }
    const first = (recentTx as any[]).find((x) => x.id === ids[0]);
    const reason = await askExclude(`통장 ${first?.transaction_date} ${first?.counterparty || ""} ${fmtW(Math.abs(Number(first?.amount || 0)))}`, ids.length);
    if (!reason) return;
    try { const n = await setLedgerExcluded("bank", ids, reason); toast(`${n}건 장부 제외 — 목록에서 사라졌습니다 (검색조건 상태 '장부 제외'로 다시 봅니다)`, "success"); setSelectedTxIds(new Set()); queryClient.invalidateQueries({ queryKey: ["bank-page-recent-tx"] }); }
    catch (e) { toast(friendlyError(e, "장부 제외 실패"), "error"); }
  };
  const unexclude = async (id: string) => {
    try { await setLedgerExcluded("bank", [id], null); toast("제외를 해제했습니다 — 미전표로 돌아옵니다", "success"); queryClient.invalidateQueries({ queryKey: ["bank-page-recent-tx"] }); }
    catch (e) { toast(friendlyError(e, "해제 실패"), "error"); }
  };
  const doBulkPostBank = async () => {
    if (!bulkAccountId || bulkPosting) { if (!bulkAccountId) toast("계정과목을 선택하세요", "error"); return; }
    setBulkPosting(true);
    let ok = 0, fail = 0, skip = 0;
    const okIds: string[] = [];
    try {
      const ids = Array.from(selectedTxIds);
      for (const id of ids) {
        const tx = (recentTx as any[]).find((t) => t.id === id);
        if (!tx || tx.journal_entry_id) { skip++; continue; } // 이미 처리된 건 skip
        const { error } = await db.rpc("post_bank_voucher", { p_bank_tx_id: id, p_account_id: bulkAccountId, p_remember: false });
        if (error) fail++; else { ok++; okIds.push(id); }
      }
      // 고정비 체크 시 처리된 거래를 일괄 마킹 → 경영흐름·고정비 리포트에 고정비로 집계 (실패해도 전표는 유지)
      if (bulkFixed && okIds.length > 0) {
        try { await db.from("bank_transactions").update({ is_fixed_cost: true }).in("id", okIds); } catch { /* best-effort */ }
      }
      toast(`${ok}건 전표처리 완료${bulkFixed && ok > 0 ? " · 고정비 표시" : ""}${fail > 0 ? ` · ${fail}건 실패` : ""}${skip > 0 ? ` · ${skip}건 건너뜀` : ""}`, fail > 0 ? "info" : "success");
      setShowBulkPost(false); setBulkAccountId(""); setBulkFixed(false); setSelectedTxIds(new Set());
      queryClient.invalidateQueries({ queryKey: ["bank-page-recent-tx"] });
    } finally { setBulkPosting(false); }
  };

  // 일괄 전표처리 모달 — ESC 닫기 · Enter 확인(계정과목 미선택/처리중이면 비활성)
  useModalKeys(showBulkPost, () => setShowBulkPost(false), bulkPosting || !bulkAccountId ? undefined : doBulkPostBank);

  //   엑셀 — 지금 화면에 걸린 조건·정렬 그대로 뽑는다(보이는 것과 파일이 달라지면 안 된다).
  const exportBankCsv = (list: any[], tag = "") => {
    downloadCsv(
      `통장거래내역_${rangeSuffix(bankTxFrom, bankTxTo)}${tag}`,
      //   ⚠️ 칸 이름은 DB 를 보고 맞췄다 — 잔액은 balance_after 이고, 계좌번호 칸은 아예 없다
      //     (bank_account_id 만 있다). 처음에 짐작으로 balance·account_number 를 넣었더니
      //     엑셀에 빈 칸 두 개가 그대로 나갔다. 없는 것은 내보내지 않는다.
      ["거래일", "구분", "적요", "거래처", "금액", "거래후잔액", "비목", "전표"],
      list.map((tx) => [
        String(tx.transaction_date || "").slice(0, 10),
        tx.type === "income" ? "입금" : "출금",
        tx.description || "",
        tx.counterparty || "",
        Number(tx.amount || 0),
        tx.balance_after != null ? Number(tx.balance_after) : "",
        tx.category || tx.classification || "",
        tx.journal_entry_id ? "처리됨" : "",
      ]),
    );
  };
  const sortedTx = useMemo(() => {
    if (!sortKey) return recentTx;
    const dir = sortDir === "asc" ? 1 : -1;
    const get = (tx: any) => {
      switch (sortKey) {
        case "transaction_date": return tx.transaction_date || "";
        case "amount": return Math.abs(Number(tx.amount || 0));
        case "counterparty": return tx.counterparty || tx.description || "";
        case "description": return tx.description || tx.counterparty || "";
        case "classification": return tx.classification || tx.category || "";
        case "type": return tx.mapping_status || "";
        default: return "";
      }
    };
    const isEmpty = (v: any) => v === "" || v === null || v === undefined;
    return [...recentTx].sort((a, b) => {
      const va = get(a), vb = get(b);
      // 빈값은 방향과 무관하게 뒤로
      if (isEmpty(va) && isEmpty(vb)) return 0;
      if (isEmpty(va)) return 1;
      if (isEmpty(vb)) return -1;
      if (typeof va === "number" && typeof vb === "number") return (va - vb) * dir;
      return String(va).localeCompare(String(vb), "ko") * dir;
    });
  }, [recentTx, sortKey, sortDir]);

  /*  ── 엑셀식 머리단 필터 + 열 너비 — 수집·전표 표와 같은 방식 (sortable-th 공용 부품) ── */
  const [colF, setColF] = useState<Record<string, Set<string> | null>>({});
  const tableRef = useRef<HTMLTableElement | null>(null);
  const [colW, setColW] = useColWidths("bank-tx-colw", {
    counterparty: 200, description: 220, classification: 110, amount: 120, balance: 120, date: 100, state: 140,
  });
  const colVal = (tx: any, k: string): string => {
    switch (k) {
      case "counterparty": return tx.counterparty || "";
      case "description": return displayMemo(tx);
      case "classification": return tx.classification || tx.category || "";
      case "amount": return `${tx.type === "income" ? "+" : "-"}${Math.abs(Number(tx.amount || 0)).toLocaleString("ko-KR")}`;
      case "date": return String(tx.transaction_date || "");
      case "state": return BANK_LINE_META[lineStateOf(tx)].label;
      default: return "";
    }
  };
  const colHit = (tx: any): boolean =>
    Object.entries(colF).every(([k, set]) => !set || set.has(colVal(tx, k)));
  //   값 목록은 **다른 칸 필터를 거친 뒤** 기준 — 엑셀의 좁혀 들어가기와 동일
  const thFilter = (k: string): ThFilterSpec => ({
    values: (sortedTx as any[])
      .filter((tx) => Object.entries(colF).every(([kk, set]) => kk === k || !set || set.has(colVal(tx, kk))))
      .map((tx) => colVal(tx, k)),
    selected: colF[k] ?? null,
    onApply: (sel) => setColF((f) => ({ ...f, [k]: sel })),
  });
  const thResize = (k: string, colIndex: number) =>
    ({ k, colIndex, widths: colW, onResize: setColW, tableRef });

  /*  ── 검색조건·빠른검색 맞춤 — 빈 칸은 안 건 것과 같다. 여러 개 고른 것은 하나라도 맞으면 통과. ── */
  const txCondHit = (tx: any, c: TxCond, qq: string): boolean => {
    const isIn = tx.type === "income";
    if (!quickSearchHit(qq, [tx.counterparty, displayMemo(tx), tx.classification || tx.category, tx.memo], [tx.amount])) return false;
    if (c.io !== "all" && isIn !== (c.io === "in")) return false;
    if (c.who.length && !c.who.includes(tx.counterparty || "")) return false;
    if (c.accts.length && !c.accts.includes(tx.raw_data?.accountNo || "")) return false;
    if (c.cls.length && !c.cls.includes(tx.classification || tx.category || "")) return false;
    //   '미처리' = 아직 장부에 없는 것(연결 대기 포함) — 기본 화면은 할 일만 보인다
    if (c.state === "unposted") { const st = lineStateOf(tx); if (st !== "unposted" && st !== "pending") return false; }
    else if (c.state !== "all" && lineStateOf(tx) !== c.state) return false;
    if (!amountHit(Number(tx.amount || 0), c.min, c.max)) return false;
    return true;
  };
  //   화면·엑셀·전체선택·쪽 넘김이 모두 이 목록을 본다 — 보이는 것과 파일·선택이 달라지면 안 된다
  const shownTx = (sortedTx as any[]).filter((tx) => txCondHit(tx, txLive, txQ) && colHit(tx));
  //   '조회'를 누르기 전에 몇 건 나올지만 미리 알려 준다 (표는 안 흔든다)
  const previewCount = (sortedTx as any[]).filter((tx) => txCondHit(tx, txDraft, txQ)).length;
  //   쪽 넘김 — 기본 50줄. 조건·머리단 필터가 바뀌면 1쪽으로 (거른 목록 밖 쪽 번호가 남지 않게)
  const pager = usePager(shownTx, txLive.size,
    `${bankTxFrom}|${bankTxTo}|${txQ}|${JSON.stringify(txLive)}|${JSON.stringify(Object.fromEntries(Object.entries(colF).map(([k, v]) => [k, v ? [...v] : null])))}`);

  //   내 조건 — ★ 하나가 이 화면의 기본값이 된다 (DB 라 PC 를 바꿔도 따라온다)
  const savedTx = useSavedQueries("bank-tx", companyId);
  const txParamsNow = { from: bankTxFrom, to: bankTxTo, q: txQ, cond: txLive };
  const txParamsBasic = { ...defaultRange(), q: "", cond: TX_EMPTY };
  const applySavedTx = (p: Record<string, unknown>) => {
    if (typeof p.from === "string" && typeof p.to === "string") { setBankTxFrom(p.from); setBankTxTo(p.to); }
    if (typeof p.q === "string") setTxQ(p.q);
    const c = { ...TX_EMPTY, ...(p.cond as Partial<TxCond> | undefined) };
    setTxDraft(c); setTxLive(c);
  };
  const [txDefDone, setTxDefDone] = useState(false);
  useEffect(() => {
    if (txDefDone || !savedTx.isFetched) return;
    setTxDefDone(true);
    if (savedTx.def) applySavedTx(savedTx.def.params || {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedTx.isFetched, savedTx.def, txDefDone]);

  // 탭·조건·기간 변경 시 선택 초기화 (다른 목록의 선택이 남지 않게)
  useEffect(() => { setSelectedTxIds(new Set()); }, [tab, bankTxFrom, bankTxTo, txQ, txLive]);

  const toggleTx = (id: string) => {
    setSelectedTxIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };
  // 전체선택/일괄은 미처리(journal_entry_id 없음) 건만 대상.
  const selectableTx = shownTx.filter((tx) => !tx.journal_entry_id && !tx.ledger_excluded_reason);
  const allTxSelected = selectableTx.length > 0 && selectableTx.every((tx) => selectedTxIds.has(tx.id));
  const someTxSelected = selectableTx.some((tx) => selectedTxIds.has(tx.id)) && !allTxSelected;
  const toggleAllTx = () => {
    setSelectedTxIds((prev) => {
      if (selectableTx.every((tx) => prev.has(tx.id))) return new Set();
      return new Set(selectableTx.map((tx) => tx.id));
    });
  };

  if (!companyId) {
    return <div className="p-8 text-center text-sm text-[var(--text-muted)]">로딩 중...</div>;
  }

  const totalBalance = accounts.reduce((s, a) => s + Number(a.balance || 0), 0);
  //   그래프에 올릴 계좌 — 잔액이 있는 것만 많은 순으로. 마이너스 통장은 길이로 비교가 안 돼 뺀다(뺀 개수는 적는다)
  const accountLabelOf = (a: { alias?: string; bankName?: string; accountNo?: string }) => {
    const no = a.accountNo || "";
    return a.alias || (a.bankName ? `${a.bankName}${no.slice(-4) ? " " + no.slice(-4) : ""}` : no) || "계좌";
  };
  const positiveAccounts = accounts
    .map((a) => ({ label: accountLabelOf(a), balance: Number(a.balance || 0) }))
    .filter((a) => a.balance > 0)
    .sort((a, b) => b.balance - a.balance)
    .slice(0, 8);
  const hiddenAccounts = accounts.length - positiveAccounts.length;
  const income = flow?.income ?? 0;
  const expense = flow?.expense ?? 0;
  const incomeDelta = (flow?.prevIncome ?? 0) > 0 ? ((income - (flow!.prevIncome)) / flow!.prevIncome) * 100 : null;
  const expenseDelta = (flow?.prevExpense ?? 0) > 0 ? ((expense - (flow!.prevExpense)) / flow!.prevExpense) * 100 : null;
  const mappingRate = flow && flow.total > 0 ? Math.round((flow.mapped / flow.total) * 100) : null;

  const Stat = ({ tone, icon, label, value, delta, sub, invertDeltaColor }: {
    tone: string; // kpi-icon 변형: "" | "success" | "warning" | "danger" | "info"
    icon: React.ReactNode;
    label: string;
    value: string;
    delta?: number | null;
    sub?: string;
    invertDeltaColor?: boolean;
  }) => (
    <div className="stat-tile">
      <div className="flex items-center justify-between">
        <span className="stat-tile-label">{label}</span>
        <span className={`kpi-icon ${tone}`}>{icon}</span>
      </div>
      {/* 2026-07-16 QA: truncate 가 1440px 에서도 금액을 "₩3,300,0…" 로 잘라먹음 — 금액은 절대 말줄임 금지.
          칩은 공간 부족 시 아랫줄로 내려가고(flex-wrap), 극단적으로 좁으면 금액 내부 줄바꿈 허용. */}
      <div className="flex items-end gap-2 min-w-0 flex-wrap">
        <span className="stat-tile-value mono-number min-w-0 [overflow-wrap:anywhere]">{value}</span>
        {delta != null ? (
          <span className={`delta-chip shrink-0 ${(invertDeltaColor ? delta < 0 : delta >= 0) ? "delta-up" : "delta-down"} mb-1`}>
            {delta >= 0 ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%
          </span>
        ) : sub ? (
          <span className="text-[11px] text-[var(--text-dim)] mb-1.5 shrink-0">{sub}</span>
        ) : null}
      </div>
    </div>
  );

  /*  ── 조회 화면 표준 — 조회 줄에 쓰는 값들 (2026-08-14) ── */
  const acctLabelByNo: Record<string, string> = {};
  for (const a of accounts) if (a.accountNo) acctLabelByNo[a.accountNo] = accountLabelOf(a);
  //   고를 수 있는 값들 — 예금주명·분류는 이 기간에 실제로 나온 것만, 계좌는 회사 전체 목록
  //   (거래에 안 걸린 계좌가 목록에서 사라지면 안 된다 — collect BankTab 과 같은 이유)
  const whoOpts = [...new Set((recentTx as any[]).map((t) => t.counterparty).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), "ko")).map((w) => ({ value: String(w), label: String(w) }));
  const bankAcctOpts = accounts.filter((a) => a.accountNo)
    .map((a) => ({ value: String(a.accountNo), label: accountLabelOf(a), sub: String(a.accountNo).slice(-4) }));
  const clsOpts = [...new Set((recentTx as any[]).map((t) => t.classification || t.category).filter(Boolean))]
    .sort((a, b) => String(a).localeCompare(String(b), "ko")).map((c) => ({ value: String(c), label: String(c) }));
  //   걸린 조건 칩 — 패널을 열지 않고도 알고, ✕ 로 하나씩 뺀다
  const dropTx = (patch: Partial<TxCond>) => { const c = { ...txLive, ...patch }; setTxLive(c); setTxDraft(c); };
  const txChips: AppliedChip[] = [
    ...quickTerms(txQ).map((t, i) => ({
      group: "빠른검색", label: t,
      onRemove: () => setTxQ(quickTerms(txQ).filter((_, j) => j !== i).join(", ")),
    })),
    ...txLive.who.map((v) => ({ group: "예금주명", label: v, onRemove: () => dropTx({ who: txLive.who.filter((x) => x !== v) }) })),
    ...txLive.accts.map((v) => ({ group: "계좌", label: acctLabelByNo[v] ?? v, onRemove: () => dropTx({ accts: txLive.accts.filter((x) => x !== v) }) })),
    ...txLive.cls.map((v) => ({ group: "분류", label: v, onRemove: () => dropTx({ cls: txLive.cls.filter((x) => x !== v) }) })),
    ...(txLive.io !== "all" ? [{ group: "입/출", label: txLive.io === "in" ? "입금" : "출금", onRemove: () => dropTx({ io: "all" as const }) }] : []),
    ...(txLive.state !== "unposted" ? [{
      group: "상태", label: TX_STATE_CHIPS.find((s) => s.value === txLive.state)?.label ?? txLive.state,
      onRemove: () => dropTx({ state: "unposted" as const }),
    }] : []),
    ...((txLive.min || txLive.max) ? [{
      group: "금액",
      label: `${Number(txLive.min || 0).toLocaleString("ko-KR")} ~ ${txLive.max ? Number(txLive.max).toLocaleString("ko-KR") : "제한없음"}`,
      onRemove: () => dropTx({ min: "", max: "" }),
    }] : []),
  ];
  const sumInTx = shownTx.filter((t) => t.type === "income").reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);
  const sumOutTx = shownTx.filter((t) => t.type !== "income").reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);
  const selSumTx = shownTx.filter((t) => selectedTxIds.has(t.id)).reduce((s, t) => s + Math.abs(Number(t.amount || 0)), 0);
  /** 고른 조건으로 이름을 지어 준다 ('내 조건' 저장) */
  const suggestTxName = () => {
    const p: string[] = [];
    if (txDraft.accts.length) p.push(acctLabelByNo[txDraft.accts[0]] ?? "계좌");
    if (txDraft.who.length) p.push(txDraft.who[0] + (txDraft.who.length > 1 ? ` 외 ${txDraft.who.length - 1}` : ""));
    if (txDraft.cls.length) p.push(txDraft.cls[0]);
    if (txDraft.io !== "all") p.push(txDraft.io === "in" ? "입금" : "출금");
    if (txDraft.state !== "all") p.push(TX_STATE_CHIPS.find((s) => s.value === txDraft.state)?.label ?? "");
    if (txDraft.min || txDraft.max) p.push("금액");
    return p.filter(Boolean).slice(0, 3).join(" · ") || "내 조건";
  };
  const txExcelItems: ExcelItem[] = [
    { label: "조회 결과 전부 내려받기", count: shownTx.length,
      hint: "지금 걸린 조건 그대로 · 표에 보이는 칸 그대로", onClick: () => exportBankCsv(shownTx) },
    { label: "지금 쪽만 내려받기", count: pager.view.length,
      hint: `${pager.from}–${pager.to}번째 줄만`, onClick: () => exportBankCsv(pager.view, `_${pager.page}쪽`) },
  ];

  // (2026-07-30 개편 P3) 세부탭 권한 게이트 — 마스터=전체, 멤버=부여(/bank:탭키)만
  const tabs: { key: Tab; label: string }[] = ([
    { key: "overview", label: "개요" },
    { key: "accounts", label: "통장" },
    { key: "transactions", label: "거래내역" },
  ] as { key: Tab; label: string }[]).filter((t) => bankTabMaster || bankTabPerm(`/bank:${t.key}`));

  //   갈래 탭은 상자 안 파란 밑줄 · 실행 버튼은 조회 줄 오른쪽 (2026-08-18 조회 표준 확산)
  const tabsEl = (
    <div className="collect-tabs no-print">
      {tabs.map((t) => (
        <button key={t.key} type="button" onClick={() => goTab(t.key)} className={tab === t.key ? "collect-tab collect-tab-on" : "collect-tab"}>{t.label}</button>
      ))}
    </div>
  );
  const actionsEl = (
    <>
        
        {/* 우측 — [연동 기간] + [통장 연동] 한 묶음. 이 기간이 곧 CODEF 연동 대상 범위라 버튼 옆에 배치. */}
        <div className="flex flex-wrap items-center gap-2">
          {/*   거래기간 — 다른 화면과 같은 달력 위젯 (2026-08-11). 목록 필터이자 CODEF 연동 기간이라
                '기간 해제'(전체 기간)를 그대로 남긴다. */}
          {/* 거래기간은 조회 줄 왼쪽으로 옮겼다 (2026-08-19 조회 표준: 기간·보기는 왼쪽, 실행은 오른쪽 btn-sm) */}
          {/* 연동 일시정지 — 은행에 직접 로그인할 때 우리 앱 동기화가 겹쳐 강제 로그아웃(W98010) 되는 것 방지 */}
          <button
            type="button"
            onClick={() => pauseMut.mutate()}
            disabled={!companyId || pauseMut.isPending}
            className={`btn-secondary btn-sm no-print ${isSyncPaused ? "border-amber-500/40 text-amber-600" : ""}`}
            title="데이터 연동 잠시 멈추기 (30분간 중복 로그인 방지) — 은행 사이트에 직접 로그인할 때 우리 앱의 자동 동기화가 겹쳐 강제 로그아웃되는 것을 막습니다"
          >
            {isSyncPaused
              ? <>정지 해제 ({new Date(syncPausedUntil!).toLocaleTimeString("ko-KR", { hour: "2-digit", minute: "2-digit" })}까지)</>
              : <>연동 정지</>}
          </button>
          <button
            type="button"
            onClick={() => {
              // 즉시 동기화는 유료 전용 — 누를 때마다 CODEF 비용이 나간다.
              //   무료도 자동 동기화(하루 2회)는 받으므로 '연동 불가'가 아니라 '즉시만 불가'로 안내한다.
              if (bankSync && !bankSync.manualAllowed) {
                toast("무료 요금제는 즉시 동기화를 쓸 수 없습니다. 통장·카드는 하루 2회(오전 9시·오후 6시) 자동으로 동기화되고, 원할 때 바로 불러오려면 요금제를 시작해 주세요.", "info");
                return;
              }
              // 직원 QA — 기간 미선택 등 동기화가 실제로 시작 안 되면 쿨타임을 걸지 않음
              //   (run 은 fn 실행 전에 쿨타임을 기록하므로, 사전 검증을 run 밖에서 먼저 한다)
              if (isSyncPaused) { toast("연동이 일시정지 중입니다. 정지 해제 후 연동하세요.", "info"); return; }
              if (!bankTxFrom || !bankTxTo) { toast("통장 거래 기간(시작일·종료일)을 먼저 설정한 뒤 연동하세요", "error"); return; }
              bankCd.run(handleSyncBank);
            }}
            // 무료는 disabled 로 막지 않는다 — 눌렀을 때 왜 안 되는지 알려줘야 하는데
            //   disabled 면 클릭 이벤트 자체가 안 온다. 흐릿하게만 표시하고 안내는 onClick 에서.
            disabled={syncing || !companyId || bankCd.disabled || isSyncPaused}
            className={`btn-primary btn-sm ${bankCd.disabled || isSyncPaused || (bankSync && !bankSync.manualAllowed) ? "!opacity-40 cursor-not-allowed" : ""}`}
            title={bankSync && !bankSync.manualAllowed ? "무료 요금제는 즉시 동기화를 쓸 수 없습니다 — 하루 2회 자동 동기화는 그대로 됩니다" : isSyncPaused ? "연동 일시정지 중 — 정지 해제 후 연동" : bankCd.hint ? bankCd.hint : "왼쪽 거래기간을 설정한 뒤 CODEF 은행 연동으로 그 기간의 거래·잔액을 불러옵니다"}
          >
            {syncing ? "연동 중…" : bankCd.disabled ? bankCd.label : "통장 연동"}
          </button>
        </div>
    </>
  );

  return (
    /*  거래내역(조회 화면) 탭은 qk-shell 세로 기둥 — qk-body 가 남는 높이를 받아 표가 그 안에서
        스크롤된다 (세금·증빙과 같은 방식). 다른 탭은 예전처럼 문서 흐름 그대로. */
    <div className="qk-shell">
      {/* 컴팩트 툴바 — 탭(좌) + 통장 연동(우). 타이틀은 상단 고정 헤더바가 담당 */}
{/* 갈래 탭·실행 버튼은 각 탭 상자 머리에 (tabsEl / actionsEl) */}

      {tab !== "transactions" && (
        <QueryScreen>
          <QueryHead>
            {tabsEl}
            <QueryBar right={actionsEl}>
              {tab === "accounts" && (
                <DateRangeField label="거래기간" from={bankTxFrom} to={bankTxTo}
                  onChange={(f, t) => { setBankTxFrom(f); setBankTxTo(t); }}
                  onClear={() => { setBankTxFrom(""); setBankTxTo(""); }} />
              )}
              {tab === "accounts" && <ChipGroup value={accountsView} onChange={setAccountsView} options={[{ value: "list", label: "리스트" }, { value: "card", label: "카드" }] as const} />}
              {tab === "accounts" && accounts.some((a) => a.isHidden) && (
                <button type="button" onClick={() => setShowHiddenAccts((v) => !v)} className={showHiddenAccts ? "qk-quick qk-quick-on" : "qk-quick"}>숨긴 통장 {accounts.filter((a) => a.isHidden).length}개 {showHiddenAccts ? "감추기" : "보기"}</button>
              )}
              <span className="text-[11px] text-[var(--text-dim)]">{tab === "accounts" ? "거래기간은 연동 범위이자 표의 '이번 달 변화' 기준 · 거래를 조건으로 찾으려면 거래내역 탭" : "통장 잔액·이번 달 흐름 — 거래를 조건으로 찾으려면 거래내역 탭"}</span>
            </QueryBar>
            {/* 결과 요약 — 예전 stat 4 그라데이션 카드(총 자산·이번 달 수익·지출·분류 완료율)를 Stat 줄로 (2026-08-19 자금 메뉴 점검) */}
            <ResultStrip>
              <QStat label="총 자산" value={<>{fmtW(totalBalance)} <small className="font-normal text-[var(--text-dim)]">{accounts.length}개 계좌</small></>} />
              <QStat label="이번 달 수익" value={<>+{fmtW(income)} {incomeDelta != null && income > 0 && <small className={`font-bold ${incomeDelta >= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{incomeDelta >= 0 ? "▲" : "▼"}{Math.abs(incomeDelta).toFixed(1)}%</small>}</>} tone="plus" />
              <QStat label="이번 달 지출" value={<>−{fmtW(expense)} {expenseDelta != null && expense > 0 && <small className={`font-bold ${expenseDelta <= 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{expenseDelta >= 0 ? "▲" : "▼"}{Math.abs(expenseDelta).toFixed(1)}%</small>}</>} tone="minus" />
              <QStat label="분류 완료율" value={<>{mappingRate != null ? `${mappingRate}%` : "—"} <small className="font-normal text-[var(--text-dim)]">{flow && flow.total > 0 ? `${flow.mapped}/${flow.total}건` : "거래 없음"}</small></>} />
            </ResultStrip>
          </QueryHead>
          <QueryBody>
            <div className="bank-scroll">
      {/* 연동 기간 선택기는 상단 툴바(통장 연동 버튼 왼쪽)로 이동 — 이 기간이 곧 CODEF 연동 대상 범위라 버튼과 한 묶음이 자연스러움. */}

      {/* 개요 — 계좌별 잔액·자동이체 예정·자동이체 내역·이번달 큰 지출 */}
      {tab === "overview" && (<>
        {/* 이번 달 입출금 추이·출금 상위 거래처·계좌별 표 — 재무 › 현황에서 옮겨 옴 (2026-08-26 사장님: "통장 부분은 통장 쪽으로") */}
        <BankStatusPanels companyId={companyId} from={todayKst().slice(0, 7) + "-01"} to={todayKst()} />
        <div className="bank-overview-panel">
          {/*  돈이 어느 통장에 몰려 있나 — 총자산 카드는 합계만 말한다.
               통장 이름이 길어(은행명 + 별칭) 세로 막대에선 잘리므로 가로 막대로 읽는다.
               비중이 아니라 '어디에 얼마'가 궁금한 자리라 도넛이 아니다. (2026-08-07) */}
          {positiveAccounts.length >= 2 && (
            <section className="bank-balance-chart pnl-panel">
              <h3>계좌별 잔액</h3>
              <p>많은 순 · 합계 {fmtW(totalBalance)}{hiddenAccounts > 0 ? ` · 0원 이하 ${hiddenAccounts}개는 제외했습니다` : ""}</p>
              <BarChart unit="원" data={positiveAccounts.map((a) => ({ label: a.label, value: a.balance, color: "var(--viz-1)" }))} />
            </section>
          )}
          <UpcomingAutoTransfersCard companyId={companyId} />
          <AutoTransferHistoryCard companyId={companyId} />
          <TopExpensesThisMonth companyId={companyId} />
        </div>
      </>)}

      {/* 통장 — portfolio 카드(이름·잔액·이번달 증감). 2026-05-29 카드 크기 축소(p-4·3열). */}
      {tab === "accounts" && accountsView === "list" && accounts.length > 0 && (
        <table className="ev-table ev-lined bank-accounts-table">
          <thead><tr><th className="text-left">통장</th><th>계좌</th><th className="text-left">메모</th><th>잔액</th><th>이번 달 변화</th><th>동작</th></tr></thead>
          <tbody>
            {accounts.filter((a) => showHiddenAccts || !a.isHidden).map((a) => {
              const accNo = a.accountNo || "";
              const change = changeByAcct[accNo] || 0;
              const name = a.alias || (a.bankName ? `${a.bankName}${accNo.slice(-4) ? " " + accNo.slice(-4) : ""}` : accNo) || "계좌";
              const bal = Number(a.balance || 0);
              return (
                <tr key={a.accountNo} className={`pnl-row-acct ${a.isHidden ? "opacity-60" : ""}`} onClick={() => { seedAccountCond(accNo); goTab("transactions"); }} title="누르면 이 통장 거래내역">
                  <td className="text-left"><span className="inline-flex items-center gap-2"><BankLogo name={a.bankName || name} size={20} /><b>{name}</b>{a.alias && a.bankName && <small className="text-[var(--text-dim)]">{a.bankName}</small>}{a.isHidden && <span className="ol-sure">숨김</span>}</span></td>
                  {/* 계좌번호는 전체를 보인다 (2026-08-19 사장님: "통장에서 계좌번호를 다 보이게") */}
                  <td className="text-center mono-number text-[var(--text-muted)]">{accNo || "—"}</td>
                  <td className="text-left text-[var(--text-muted)]">{a.memo ? <span className="truncate inline-block max-w-[220px]" title={a.memo}>{a.memo}</span> : <span className="text-[var(--text-dim)]">—</span>}</td>
                  <td className="text-right mono-number font-bold">{fmtW(bal)}</td>
                  <td className={`text-right mono-number ${Math.round(change) === 0 ? "text-[var(--text-dim)]" : change > 0 ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{Math.round(change) === 0 ? "변화 없음" : `${change > 0 ? "+" : "−"}${fmtW(Math.abs(change))}`}</td>
                  <td className="text-center" onClick={(e) => e.stopPropagation()}>
                    <span className="inline-flex gap-1.5">
                      <button type="button" onClick={() => setAcctEdit({ accountNo: accNo, alias: a.alias || "", memo: a.memo || "", bankName: a.bankName, balance: bal })} className="btn-secondary btn-sm">수정</button>
                      <button type="button" onClick={() => toggleAcctHidden({ accountNo: accNo, isHidden: a.isHidden, bankName: a.bankName, balance: bal })} className="btn-secondary btn-sm">{a.isHidden ? "보이기" : "숨김"}</button>
                      <button type="button" onClick={() => removeAcct({ accountNo: accNo, alias: a.alias, bankName: a.bankName })} className="btn-secondary btn-sm text-[var(--danger)]">삭제</button>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {tab === "accounts" && (accountsView === "card" || accounts.length === 0) && (
        <div className="bank-accounts-grid">
          {accounts.length === 0 ? (
            <div className="sm:col-span-2 lg:col-span-3">
              <EmptyState
                card
                icon="🏦"
                title="통장이 아직 연동되지 않았습니다"
                desc="CODEF 은행 연동으로 통장과 거래내역을 자동으로 불러옵니다"
                action={
                  <button type="button" onClick={handleSyncBank} disabled={syncing} className="btn-primary">
                    {syncing ? "연동 중..." : "통장 연동하기"}
                  </button>
                }
              />
            </div>
          ) : accounts.filter((a) => showHiddenAccts || !a.isHidden).map((a) => {
            const accNo = a.accountNo || "";
            const change = changeByAcct[accNo] || 0;
            const name = a.alias || (a.bankName ? `${a.bankName}${accNo.slice(-4) ? " " + accNo.slice(-4) : ""}` : accNo) || "계좌";
            const bal = Number(a.balance || 0);
            return (
              <div
                key={a.accountNo}
                role="button"
                tabIndex={0}
                onClick={() => { seedAccountCond(accNo); goTab("transactions"); }}
                onKeyDown={(e) => { if (e.key === "Enter") { seedAccountCond(accNo); goTab("transactions"); } }}
                className="bank-account-card glass-card card-hover group"
              >
                <div className="flex items-start justify-between mb-2 gap-2">
                  <div className="flex items-center gap-2 flex-1 min-w-0">
                    {/* 은행 브랜드 로고 (2026-08-13 사장님: 실제 은행 로고) */}
                    <BankLogo name={a.bankName || name} size={26} />
                    <h3 className="text-sm font-semibold text-[var(--text)] truncate min-w-0">{name}</h3>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {/* 통장 이름 편집(연필) — 카드 클릭과 분리(stopPropagation) */}
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setAcctEdit({ accountNo: accNo, alias: a.alias || "", memo: a.memo || "", bankName: a.bankName, balance: bal }); }}
                      className="opacity-0 group-hover:opacity-100 transition p-1 rounded-md bg-[var(--bg-surface)] hover:bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--primary)] border border-[var(--border)]"
                      title="이름 변경"
                      aria-label="이름 변경"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.1 2.1 0 013 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                    </button>
                    {Math.round(change) !== 0 && (
                      change >= 0 ? (
                        <svg className="w-4 h-4 text-[var(--success)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 17l9-9m0 0H9m7 0v7" /></svg>
                      ) : (
                        <svg className="w-4 h-4 text-[var(--danger)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 7l-9 9m0 0h7m-7 0V9" /></svg>
                      )
                    )}
                  </div>
                </div>
                {accNo && <p className="mb-1 text-[11px] mono-number text-[var(--text-dim)]">{accNo}</p>}
                <p className="text-lg font-bold text-[var(--text)] mb-1.5 mono-number truncate">{fmtW(bal)}</p>
                {Math.round(change) !== 0 ? (
                  <div className={`delta-chip ${change >= 0 ? "delta-up" : "delta-down"}`}>
                    {change >= 0 ? "+" : "-"}{fmtW(Math.abs(change))}
                  </div>
                ) : (
                  <div className="delta-chip delta-flat">
                    변화 없음
                  </div>
                )}
                <p className="text-[10px] text-[var(--text-dim)] mt-2">클릭 → 이 통장 거래내역</p>
              </div>
            );
          })}
        </div>
      )}

      {/* 거래내역 — 조회 화면 표준 (2026-08-14 사장님: "수집·전표탭의 디자인처럼").
          탭 줄 아래에 조회 줄·걸린 조건·결과 요약·표·쪽 넘김을 **한 상자**에.
          예전의 기간 줄+계좌 배너+정렬 툴바+선택 액션바 낱장 구성을 버렸다 —
          계좌 필터는 검색조건의 '계좌' 칩으로, 정렬은 머리단으로, 선택은 바닥 SelectionBar 로. */}

            </div>
          </QueryBody>
        </QueryScreen>
      )}

      {tab === "transactions" && (
        <QueryScreen>
        <QueryHead>
        {tabsEl}
        {/* ── 1줄 · 조회 조건 — 기간·빠른검색은 즉시, 검색조건은 '조회'를 눌러 ── */}
        <QueryBar right={<><ExcelMenu items={txExcelItems} />{actionsEl}</>}>
          {/*   ★ 기간을 치는 칸은 화면에 하나뿐이다. 달력은 검색조건 안에 있다. */}
          <DateRangeField from={bankTxFrom} to={bankTxTo} label={null} parts="segments"
            onChange={(f, t) => { setBankTxFrom(f); setBankTxTo(t); }}
            trailing={
              <ConditionPanel open={txPanelOpen} onOpenChange={setTxPanelOpen} activeCount={txCondCount(txLive)} anchorSel=".drf"
                tabs={<SavedTabs list={savedTx.list} current={txParamsNow} basic={txParamsBasic}
                  onApply={(s) => { applySavedTx(s.params || {}); setTxPanelOpen(false); }}
                  onBasic={() => { const r = defaultRange(); setBankTxFrom(r.from); setBankTxTo(r.to); setTxQ(""); setTxDraft(TX_EMPTY); setTxLive(TX_EMPTY); }}
                  onRemove={savedTx.remove} onSetDefault={savedTx.setDefault} />}
                foot={<>
                  <button type="button" className="btn-secondary btn-sm" disabled={txCondCount(txDraft) === 0}
                    onClick={() => setTxDraft({ ...TX_EMPTY, size: txDraft.size })}>조건 지우기</button>
                  <ConditionSave suggest={suggestTxName}
                    onSave={(name, asDefault) => {
                      savedTx.save(name, { from: bankTxFrom, to: bankTxTo, q: txQ, cond: txDraft }, asDefault);
                      setTxLive(txDraft); setTxPanelOpen(false);
                    }} />
                  <span className="ml-auto text-[11px] text-[var(--text-dim)]">{previewCount.toLocaleString("ko-KR")}건</span>
                  <RowsPerPage value={txDraft.size} onChange={setTxD("size")} />
                  <button type="button" className="btn-primary btn-sm"
                    onClick={() => { setTxLive(txDraft); setTxPanelOpen(false); }}>조회</button>
                </>}>
                <ConditionRow label="조회기간" hint="기본 1개월">
                  <span className="qk-range-txt">{bankTxFrom} ~ {bankTxTo}</span>
                  <DateRangeField from={bankTxFrom} to={bankTxTo} label={null} parts="calendar" confirm
                    onChange={(f, t) => { setBankTxFrom(f); setBankTxTo(t); }} />
                  <span className="qk-quicks">
                    {periodQuicks().map((p) => (
                      <button key={p.key} type="button" onClick={() => { setBankTxFrom(p.from); setBankTxTo(p.to); }}
                        className={bankTxFrom === p.from && bankTxTo === p.to ? "qk-quick qk-quick-on" : "qk-quick"}>{p.label}</button>
                    ))}
                  </span>
                </ConditionRow>
                <ConditionRow label="입/출">
                  <ChipGroup value={txDraft.io} onChange={setTxD("io")} options={TX_IO_CHIPS} />
                </ConditionRow>
                <ConditionRow label="예금주명" hint="여러 곳">
                  <TokenField items={whoOpts} value={txDraft.who} onChange={setTxD("who")}
                    placeholder="예금주명 일부 (예: 모티)" />
                </ConditionRow>
                <ConditionRow label="계좌" hint="여러 개">
                  <TokenField items={bankAcctOpts} value={txDraft.accts} onChange={setTxD("accts")}
                    placeholder="통장 별명 또는 번호 (예: 4017)" />
                </ConditionRow>
                <ConditionRow label="분류" hint="여러 개">
                  <TokenField items={clsOpts} value={txDraft.cls} onChange={setTxD("cls")}
                    placeholder="분류(계정과목) 이름 일부" />
                </ConditionRow>
                <ConditionRow label="상태">
                  <ChipGroup value={txDraft.state} onChange={setTxD("state")} options={TX_STATE_CHIPS} />
                </ConditionRow>
                <ConditionRow label="금액" hint="입·출금 부호는 보지 않습니다">
                  <AmountRange min={txDraft.min} max={txDraft.max} onMin={setTxD("min")} onMax={setTxD("max")} />
                </ConditionRow>
              </ConditionPanel>
            } />
          <QuickSearch value={txQ} onApply={setTxQ}
            placeholder="예금주명 · 거래내용 · 분류 · 금액 — 쉼표로 여러 개, Enter" />
        </QueryBar>

        <AppliedChips chips={txChips} onClearAll={() => { setTxQ(""); setTxLive(TX_EMPTY); setTxDraft(TX_EMPTY); }} />

        {/* ── 2줄 · 결과 요약 — 목록을 바꾸지 않는 것만 ── */}
        <ResultStrip>
          <QStat label="건수" value={`${shownTx.length.toLocaleString("ko-KR")}건`} />
          <QStat label="입금" value={fmtW(sumInTx)} tone="plus" />
          <QStat label="출금" value={fmtW(sumOutTx)} tone="minus" />
          {recentTx.length >= 2000 && <b className="ev-cut">너무 많아 앞 2,000건만 받아왔습니다 — 기간을 좁혀 주세요</b>}
        </ResultStrip>
        </QueryHead>

        {/* 목록 — 선택 바가 이 위로 떠오른다 (표 크기는 안 줄어들게) */}
        <QueryBody>
        <div className="ev-scroll">
            {/* 공용 표준 — 메뉴마다 다르던 표 밀도를 하나로 (2026-08-12).
                깔때기·너비 손잡이·머리단 세로선(.ev-lined)은 수집·전표 표와 같은 부품 (2026-08-14 사장님) */}
            <table ref={tableRef} className="data-table w-full ev-lined">
              <thead className="sticky-bar">
                <tr className="table-head-row">
                  <th className="w-10">
                    <input
                      type="checkbox"
                      checked={allTxSelected}
                      ref={(el) => { if (el) el.indeterminate = someTxSelected; }}
                      onChange={toggleAllTx}
                      aria-label="전체 선택"
                      className="h-4 w-4 cursor-pointer accent-[var(--primary)]"
                    />
                  </th>
                  <SortableTh label="예금주명" sortKey="counterparty" sort={{ key: sortKey ?? "", dir: sortDir }} onSort={onSortTx} filter={thFilter("counterparty")} resize={thResize("counterparty", 1)} />
                  <SortableTh label="거래내용" sortKey="description" sort={{ key: sortKey ?? "", dir: sortDir }} onSort={onSortTx} filter={thFilter("description")} resize={thResize("description", 2)} />
                  <SortableTh label="분류" sortKey="classification" sort={{ key: sortKey ?? "", dir: sortDir }} onSort={onSortTx} filter={thFilter("classification")} resize={thResize("classification", 3)} />
                  <SortableTh label="금액" sortKey="amount" sort={{ key: sortKey ?? "", dir: sortDir }} onSort={onSortTx} filter={thFilter("amount")} resize={thResize("amount", 4)} />
                  {/* 잔액은 줄마다 다 달라 깔때기가 의미 없다 — 너비 손잡이만 */}
                  <SortableTh label="잔액" resize={thResize("balance", 5)} />
                  <SortableTh label="날짜" sortKey="transaction_date" sort={{ key: sortKey ?? "", dir: sortDir }} onSort={onSortTx} filter={thFilter("date")} resize={thResize("date", 6)} />
                  <SortableTh label="상태" sortKey="type" sort={{ key: sortKey ?? "", dir: sortDir }} onSort={onSortTx} filter={thFilter("state")} resize={thResize("state", 7)} />
                </tr>
              </thead>
              <tbody>
                {shownTx.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="px-3 py-2.5">
                      <EmptyState
                        icon="📄"
                        title={txChips.length > 0 ? "걸린 조건에 맞는 거래가 없습니다" : "이 기간에 거래내역이 없습니다"}
                        desc="상단에서 기간을 설정하고 ‘통장 연동’을 누르면 그 기간의 거래를 불러옵니다"
                      />
                    </td>
                  </tr>
                ) : pager.view.map((tx) => {
                  const isIncome = tx.type === "income";
                  const m = BANK_LINE_META[lineStateOf(tx)];
                  const posted = !!tx.journal_entry_id;
                  const checked = selectedTxIds.has(tx.id);
                  return (
                    <tr key={tx.id} className={`transaction-row ${checked ? "bg-[var(--primary)]/5" : ""}`}>
                      <td className="w-10">
                        <input
                          type="checkbox"
                          checked={checked}
                          disabled={posted}
                          onChange={() => toggleTx(tx.id)}
                          onClick={(e) => e.stopPropagation()}
                          aria-label="거래 선택"
                          title={posted ? "전표처리됨" : undefined}
                          className="h-4 w-4 cursor-pointer accent-[var(--primary)] disabled:opacity-40 disabled:cursor-not-allowed"
                        />
                      </td>
                      <td className="px-3 py-2.5">
                        <div className="flex items-center gap-3">
                          <div className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${isIncome ? "bg-[var(--success-dim)]" : "bg-[var(--danger-dim)]"}`}>
                            <svg className={`w-5 h-5 ${isIncome ? "text-[var(--success)]" : "text-[var(--danger)]"}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d={isIncome ? "M7 17l9-9m0 0H9m7 0v7" : "M17 7l-9 9m0 0h7m-7 0V9"} />
                            </svg>
                          </div>
                          <div className="min-w-0">
                            <span className="block font-medium text-[var(--text)] truncate">{tx.counterparty || "—"}</span>
                            {(tx.memo || (tx.tags && tx.tags.length) || tx.used_by_employee_id) && (
                              <div className="flex items-center gap-1 flex-wrap mt-0.5">
                                {tx.used_by_employee_id && bankEmpById[tx.used_by_employee_id] && <span className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--primary)]/10 text-[var(--primary)] font-medium"><Ico e="👤" /> {bankEmpById[tx.used_by_employee_id]}</span>}
                                {(tx.tags || []).map((t: string) => <span key={t} className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--bg-surface)] text-[var(--text-dim)]">#{t}</span>)}
                                {tx.memo && <span className="text-[10px] text-[var(--text-dim)] truncate max-w-[160px]" title={tx.memo}><Ico e="📝" /> {tx.memo}</span>}
                              </div>
                            )}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-[12.5px] text-[var(--text-muted)] max-w-[240px]"><span className="block truncate" title={displayMemo(tx) || undefined}>{displayMemo(tx) || "—"}</span></td>
                      <td className="px-3 py-2.5 text-[12.5px] text-[var(--text-muted)]">{tx.classification || tx.category || "—"}</td>
                      <td className={`px-3 py-2.5 font-semibold mono-number text-right ${isIncome ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>
                        {isIncome ? "+" : "-"}{fmtW(Math.abs(Number(tx.amount || 0)))}
                      </td>
                      <td className="px-3 py-2.5 text-[12.5px] text-[var(--text-muted)] mono-number text-right whitespace-nowrap">{tx.balance_after != null ? fmtW(Number(tx.balance_after)) : "—"}</td>
                      <td className="px-3 py-2.5 text-[12.5px] text-[var(--text-muted)] mono-number">{tx.transaction_date}</td>
                      <td className="px-3 py-2.5 relative">
                        <button
                          type="button"
                          onClick={() => setLineTx(tx)}
                          className={`bl-state ${m.cls} cursor-pointer hover:ring-1 hover:ring-current`}
                          title={m.hint}
                        >{m.label}</button>
                        {!posted && tx.ledger_excluded_reason && <span className="ml-1.5 inline-flex items-center gap-1"><span className="ol-sure" title={excludeLabelOf(tx.ledger_excluded_reason)}>{excludeLabelOf(tx.ledger_excluded_reason).split(" · ")[0]}</span><button type="button" onClick={() => unexclude(tx.id)} className="btn-secondary btn-sm">해제</button></span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
        </div>

        {lineTx && companyId && (
          <BankLineDialog tx={lineTx as BankLineTx} companyId={companyId} onClose={() => setLineTx(null)} onDone={afterLine} />
        )}
        {/* ── 3줄 · 고른 줄로 하는 일 — 파란(확정) 버튼은 여기 하나 ── */}
        <SelectionBar count={selectedTxIds.size} onClear={() => setSelectedTxIds(new Set())}
          summary={<>합계 <b className="mono-number">{fmtW(selSumTx)}</b> · 이미 처리된 건은 건너뜁니다</>}>
          <button type="button" onClick={excludeSelected} className="btn-secondary btn-sm" title="전표 없이 끝낸 것으로 — 중복·이체·개인 지출">장부 제외</button>
          <button type="button" onClick={() => { setBulkAccountId(""); setBulkFixed(false); setShowBulkPost(true); }}
            className="btn-primary btn-sm">전표처리({selectedTxIds.size})</button>
        </SelectionBar>
        {excludePromptElement}
        </QueryBody>

        {/* ── 쪽 넘김 — 기본 50줄, 더 보려면 검색조건의 '조회 줄 수'를 올린다 ── */}
        <Pager page={pager.page} pages={pager.pages} total={shownTx.length} size={txLive.size}
          from={pager.from} to={pager.to} onPage={pager.setPage} />
        </QueryScreen>
      )}

      {/* 일괄 전표처리 모달 — 선택된 미처리 통장거래를 계정 1개로 일괄 생성(입출금 방향 자동) */}
      {showBulkPost && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowBulkPost(false)}>
          <div className="bank-bulk-post-modal" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-[var(--border)]">
              <div className="text-sm font-bold text-[var(--text)]">일괄 전표처리</div>
              <div className="text-[11px] text-[var(--text-dim)] mt-0.5">선택 {selectedTxIds.size}건을 한 계정으로 전표 생성합니다. 이미 처리된 건은 건너뜁니다.</div>
            </div>
            <div className="p-5 space-y-3">
              <div>
                <label className="block text-xs text-[var(--text-muted)] mb-1">계정과목 *</label>
                <AccountPicker accounts={coaAccounts as any[]} value={bulkAccountId} onChange={(id) => setBulkAccountId(id)} />
              </div>
              <label className="flex items-center gap-2 text-xs text-[var(--text)] cursor-pointer">
                <input type="checkbox" checked={bulkFixed} onChange={(e) => setBulkFixed(e.target.checked)} className="accent-[var(--warning)]" />
                고정비로 표시 <span className="text-[var(--text-dim)]">— 매월 반복 지출이면 체크 (경영흐름·고정비 리포트에 고정비로 집계)</span>
              </label>
              <p className="text-[10px] text-[var(--text-dim)] leading-relaxed">출금은 차) 선택 계정 / 대) 보통예금, 입금은 차) 보통예금 / 대) 선택 계정으로 방향이 자동 결정됩니다. 통장 내역은 그대로 남고 “전표처리됨”으로 표시됩니다.</p>
            </div>
            <div className="px-5 py-3 border-t border-[var(--border)] flex justify-end gap-2">
              <button onClick={() => setShowBulkPost(false)} className="px-3 py-1.5 text-xs text-[var(--text-muted)]">취소</button>
              <button onClick={doBulkPostBank} disabled={bulkPosting || !bulkAccountId}
                className="btn-primary btn-sm">
                {bulkPosting ? "처리 중..." : `${selectedTxIds.size}건 전표 생성`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 통장 수정 팝업 — 이름·메모 (2026-08-19) */}
      {acctEdit && (
        <div className="approval-detail-modal" onClick={() => setAcctEdit(null)}>
          <div className="pnl-drill bank-edit-modal" onClick={(e) => e.stopPropagation()}>
            <div className="pnl-drill-head"><h3 className="text-sm font-bold">통장 수정 <small className="ml-2 font-normal text-[var(--text-dim)] mono-number">{acctEdit.bankName || ""} {acctEdit.accountNo}</small></h3><button type="button" className="btn-secondary btn-sm" onClick={() => setAcctEdit(null)}>닫기</button></div>
            <div className="pay-form-body space-y-3">
              <label className="block"><span className="field-label">이름(별칭)</span><input className="qk-input h-9 w-full px-2.5 text-sm" value={acctEdit.alias} onChange={(e) => setAcctEdit({ ...acctEdit, alias: e.target.value })} placeholder="비워두면 은행명 + 끝번호로 표시" /></label>
              <label className="block"><span className="field-label">메모</span><textarea className="qk-input w-full px-2.5 py-2 text-sm" rows={3} value={acctEdit.memo} onChange={(e) => setAcctEdit({ ...acctEdit, memo: e.target.value })} placeholder="예: 보조금 전용 · 인건비 이체 계좌 · 12월 만기" /></label>
              <div className="flex justify-end gap-2"><button type="button" className="btn-secondary btn-sm" onClick={() => setAcctEdit(null)}>취소</button><button type="button" className="btn-primary btn-sm" disabled={acctSaving} onClick={saveAcctEdit}>{acctSaving ? "저장 중…" : "저장"}</button></div>
            </div>
          </div>
        </div>
      )}
      {confirmElement}
    </div>
  );
}
