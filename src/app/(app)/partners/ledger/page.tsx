"use client";
import { logRead } from "@/lib/log-read";

// 거래처 원장 — 매출처(받을 돈)/매입처(줄 돈) 잔액 조회 (2026-06-12 메뉴 분리 핸드오프).
//   대사 작업(확인 큐/수동 매칭/확정 내역)은 /partners/reconciliation (거래 대사)로 분리.
//   UX(§4): 세그먼트 탭(매출처=파랑 var(--info) / 매입처=주황 var(--warning), 빨강은 연체·마이너스 전용) +
//   요약 카드 + 좌 거래처 목록 / 우 위하고식 원장 시트. 탭 상태는 URL ?type= 에 반영.

import { useEffect, useMemo, useState } from "react";
import { DateField } from "@/components/date-field";
import { EmptyState } from "@/components/empty-state";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
import { exportPartnerLedgersXlsx } from "./export";
import {
  type LedgerRow, won, AR_AP, palette,
  PartnerLedgerSheet, PartnerDetailModal,
} from "./shared";

type ArApType = "sales" | "purchase";

// 초기 탭 — URL ?type= (새로고침/공유 유지). useSearchParams 의 Suspense 요구를 피해 window 직접 읽기.
function initialType(): ArApType {
  if (typeof window === "undefined") return "sales";
  const t = new URLSearchParams(window.location.search).get("type");
  return t === "purchase" ? "purchase" : "sales";
}

export default function PartnerLedgerPage() {
  const { user } = useUser();
  const companyId = user?.company_id ?? null;
  const qc = useQueryClient();
  const { toast } = useToast();
  const db = supabase;

  const [ledgerType, setLedgerTypeRaw] = useState<ArApType>(initialType);
  const [ledgerYear, setLedgerYear] = useState(new Date().getFullYear()); // 회계기간(연도)
  const [yearInput, setYearInput] = useState(String(new Date().getFullYear())); // 연도 직접 입력 버퍼(드롭다운과 동기화)
  useEffect(() => { setYearInput(String(ledgerYear)); }, [ledgerYear]);
  // 회계기간 직접 선택 — 연도 대신 임의 기간(부터~까지)으로 원장 조회
  const [periodMode, setPeriodMode] = useState<"year" | "custom">("year");
  const [customFrom, setCustomFrom] = useState(`${new Date().getFullYear()}-01-01`);
  const [customTo, setCustomTo] = useState(`${new Date().getFullYear()}-12-31`);
  const periodStart = periodMode === "custom" ? customFrom : `${ledgerYear}-01-01`;
  const periodEnd = periodMode === "custom" ? customTo : `${ledgerYear}-12-31`;
  const rpcYear = periodMode === "custom" ? (Number(customFrom.slice(0, 4)) || ledgerYear) : ledgerYear; // 좌측 목록 RPC는 연도 기준 → 시작일의 연도 사용
  const periodLabel = periodMode === "custom" ? `${customFrom} ~ ${customTo}` : `${ledgerYear}년`;
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [sortBy, setSortBy] = useState<"outstanding" | "name" | "code">("outstanding"); // 기본: 잔액 큰 순 (관리 우선순위)
  const [selLedger, setSelLedger] = useState<string | null>(null); // 좌측 목록 선택 (partner_id, null 거래처는 "none")
  const [detail, setDetail] = useState<{ partnerId: string | null; type: string; focus: "all" | "prior" } | null>(null);
  // 일괄 엑셀 내보내기 — 목록 체크 선택(키=partner_id ?? "none"), 거래처마다 시트 분리
  const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
  const [exporting, setExporting] = useState(false);
  useEffect(() => { setCheckedIds(new Set()); }, [ledgerType, periodStart, periodEnd]);
  const toggleChecked = (key: string) => setCheckedIds((prev) => { const n = new Set(prev); if (n.has(key)) n.delete(key); else n.add(key); return n; });

  const setLedgerType = (t: ArApType) => {
    setLedgerTypeRaw(t);
    setSelLedger(null);
    try { window.history.replaceState({}, "", `/partners/ledger?type=${t}`); } catch { /* noop */ }
  };

  const { data: rows = [], isLoading: lLoading } = useQuery<LedgerRow[]>({
    queryKey: ["partner-ledger", companyId, rpcYear],
    queryFn: async () => {
      const data = logRead('ledger/page:data', await db.rpc("get_partner_ledger_by_year", { p_year: rpcYear }));
      return (data || []) as LedgerRow[];
    },
    enabled: !!companyId,
  });

  const { data: partnerInfo = { names: {}, codes: {} } } = useQuery<{ names: Record<string, string>; codes: Record<string, number> }>({
    queryKey: ["partner-ledger-names", companyId],
    queryFn: async () => {
      const data = logRead('ledger/page:data', await db.from("partners").select("id, name, code").eq("company_id", companyId ?? ""));
      const names: Record<string, string> = {};
      const codes: Record<string, number> = {};
      for (const p of (data || []) as any[]) { names[p.id] = p.name; if (p.code != null) codes[p.id] = p.code; }
      return { names, codes };
    },
    enabled: !!companyId,
  });
  const partnerMap = partnerInfo.names;
  const partnerCodeMap = partnerInfo.codes;

  // 수동 전표만 있는 거래처(세금계산서 없음)도 해당 탭에 노출하기 위한 분류
  //   외상매출금(108) 라인 → 매출처, 외상매입금(251) 라인 → 매입처. (매입처에서 전표 도달 불가하던 버그 해소)
  //   + 수동 전표의 AR/AP 라인이 잔액에 미치는 영향(단수차 등)도 합산 — 좌측 목록 잔액이 우측 시트와 일치.
  const { data: voucherPartnerTypes = {} } = useQuery<Record<string, { sales?: boolean; purchase?: boolean; salesAdj?: number; purchaseAdj?: number }>>({
    queryKey: ["ledger-voucher-partners", companyId, periodStart, periodEnd],
    queryFn: async () => {
      const data = logRead('ledger/page:data', await db.from("journal_entries")
        .select("journal_lines(partner_id, debit, credit, chart_of_accounts(code))")
        .eq("company_id", companyId ?? "").eq("source", "manual").eq("status", "confirmed")
        .gte("entry_date", periodStart).lte("entry_date", periodEnd));
      const m: Record<string, { sales?: boolean; purchase?: boolean; salesAdj?: number; purchaseAdj?: number }> = {};
      for (const e of (data || []) as any[]) {
        for (const l of (e.journal_lines || [])) {
          if (!l.partner_id) continue;
          const code = l.chart_of_accounts?.code;
          const d = Number(l.debit || 0), c = Number(l.credit || 0);
          if (code === "108") { (m[l.partner_id] ||= {}).sales = true; m[l.partner_id].salesAdj = (m[l.partner_id].salesAdj || 0) + (d - c); }   // 매출(AR): 차변 증가
          if (code === "251") { (m[l.partner_id] ||= {}).purchase = true; m[l.partner_id].purchaseAdj = (m[l.partner_id].purchaseAdj || 0) + (c - d); } // 매입(AP): 대변 증가
        }
      }
      return m;
    },
    enabled: !!companyId,
  });

  // 미수 경과(에이징) — 세금계산서 발행분 기준 잔액을 발행일 경과일로 버킷팅(매출처 뷰 전용, 표시만).
  //   ⚠️ 원장 '총 미수금'(RPC)은 전표·이월 포함이라 이 에이징 합계와 다를 수 있음 → 라벨로 구분.
  const { data: aging } = useQuery<{ buckets: { label: string; amount: number; count: number }[]; total: number } | null>({
    queryKey: ["ledger-ar-aging", companyId],
    enabled: !!companyId && ledgerType === "sales",
    staleTime: 60_000,
    queryFn: async () => {
      const since = new Date(); since.setDate(since.getDate() - 730);
      const inv = logRead('ledger/page:inv', await db.from("tax_invoices")
        .select("total_amount, supply_amount, settled_amount, issue_date, status")
        .eq("company_id", companyId ?? "").eq("type", "sales").neq("status", "void")
        .gte("issue_date", since.toISOString().slice(0, 10)).limit(5000));
      const buckets = [
        { label: "0–30일", min: 0, max: 30, amount: 0, count: 0 },
        { label: "31–60일", min: 31, max: 60, amount: 0, count: 0 },
        { label: "61–90일", min: 61, max: 90, amount: 0, count: 0 },
        { label: "90일+", min: 91, max: Infinity, amount: 0, count: 0 },
      ];
      const now = new Date();
      const todayMs = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
      for (const r of (inv || []) as any[]) {
        if (r.status === "draft") continue;
        const bal = Number(r.total_amount || r.supply_amount || 0) - Number(r.settled_amount || 0);
        if (bal <= 1) continue;
        const days = r.issue_date ? Math.floor((todayMs - new Date(String(r.issue_date).slice(0, 10)).getTime()) / 86400000) : 0;
        const b = buckets.find((x) => days >= x.min && days <= x.max) || buckets[3];
        b.amount += bal; b.count += 1;
      }
      return { buckets: buckets.map(({ label, amount, count }) => ({ label, amount, count })), total: buckets.reduce((s, b) => s + b.amount, 0) };
    },
  });

  // 홈택스 거래처 연결 — 세금계산서↔거래처 사업자번호 자동 연결 (원장의 전제 데이터)
  const linkMut = useMutation({
    mutationFn: async () => {
      const { data, error } = await db.rpc("link_invoice_partners");
      if (error) throw new Error(error.message); return data as { created: number; linked: number };
    },
    onSuccess: (r) => { qc.invalidateQueries({ queryKey: ["partner-ledger"] }); qc.invalidateQueries({ queryKey: ["partner-ledger-names"] }); qc.invalidateQueries({ queryKey: ["partners"] }); toast(`거래처 ${r?.created ?? 0}곳 등록 · 세금계산서 ${r?.linked ?? 0}건 연결`, "success"); },
    onError: (e: any) => toast(e?.message || "연결 실패", "error"),
  });

  const nameOf = (pid: string | null) => (pid && partnerMap[pid]) || "미지정 거래처";

  // 잔액 = 전기이월 + 당기 잔액 + 수동 전표 AR/AP 보정(단수차 등 — 우측 시트와 일치)
  const voucherAdj = (r: LedgerRow) => {
    const v = r.partner_id ? voucherPartnerTypes[r.partner_id] : undefined;
    if (!v) return 0;
    return r.type === "sales" ? (v.salesAdj || 0) : (v.purchaseAdj || 0);
  };
  const ledgerOut = (r: LedgerRow) => Number(r.prior_outstanding || 0) + Number(r.period_outstanding || 0) + voucherAdj(r);
  const { receivables, payables, totalAr, totalAp } = useMemo(() => {
    const has = (r: LedgerRow) => ledgerOut(r) > 0 || Number(r.period_billed || 0) > 0;
    const recv = rows.filter((r) => r.type === "sales" && has(r));
    const pay = rows.filter((r) => r.type === "purchase" && has(r));
    // 세금계산서 없이 수동 전표만 있는 거래처도 해당 탭에 추가 노출(잔액 0) — 양쪽 탭에서 전표 수정 가능
    const synth = (pid: string, t: ArApType): LedgerRow => ({ partner_id: pid, type: t, invoice_count: 0, prior_outstanding: 0, period_billed: 0, period_settled: 0, period_outstanding: 0 });
    const recvIds = new Set(recv.map((r) => r.partner_id));
    const payIds = new Set(pay.map((r) => r.partner_id));
    for (const [pid, t] of Object.entries(voucherPartnerTypes)) {
      if (t.sales && !recvIds.has(pid)) recv.push(synth(pid, "sales"));
      if (t.purchase && !payIds.has(pid)) pay.push(synth(pid, "purchase"));
    }
    return { receivables: recv, payables: pay,
      totalAr: recv.reduce((s, r) => s + ledgerOut(r), 0),
      totalAp: pay.reduce((s, r) => s + ledgerOut(r), 0) };
  }, [rows, voucherPartnerTypes]);

  const pal = palette(ledgerType);
  const data = ledgerType === "sales" ? receivables : payables;
  const total = ledgerType === "sales" ? totalAr : totalAp;
  const other = ledgerType === "sales" ? AR_AP.purchase : AR_AP.sales;
  const otherTotal = ledgerType === "sales" ? totalAp : totalAr;

  const sq = ledgerSearch.trim().toLowerCase();
  const shown = useMemo(() => {
    const filtered = sq ? data.filter((r) => nameOf(r.partner_id).toLowerCase().includes(sq)) : [...data];
    filtered.sort((a, b) => {
      if (sortBy === "name") return nameOf(a.partner_id).localeCompare(nameOf(b.partner_id), "ko");
      if (sortBy === "code") {
        const ca = (a.partner_id && partnerCodeMap[a.partner_id]) || Number.MAX_SAFE_INTEGER;
        const cb = (b.partner_id && partnerCodeMap[b.partner_id]) || Number.MAX_SAFE_INTEGER;
        return ca - cb;
      }
      return ledgerOut(b) - ledgerOut(a);
    });
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sq, sortBy, partnerMap, partnerCodeMap]);

  const selKey = selLedger ?? (shown[0] ? (shown[0].partner_id ?? "none") : null);
  const selRow = shown.find((r) => (r.partner_id ?? "none") === selKey) || null;

  return (
    <div className="space-y-6">
      {/* ── 툴바: 세그먼트 탭·회계기간·검색·정렬 (좌) + 액션 (우) — 타이틀은 공통 헤더바가 담당 ── */}
      <div className="ledger-toolbar">
        <div className="ledger-period-picker">
          <div className="seg-bar w-fit">
            {(["sales", "purchase"] as const).map((t) => {
              const p = AR_AP[t];
              return (
                <button key={t} onClick={() => setLedgerType(t)}
                  className={`seg-item ${ledgerType === t ? "seg-item-active" : ""}`}>
                  <span className="text-base leading-none">{p.arrow}</span> {p.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
            <span className="font-semibold">회계기간</span>
            <select value={periodMode === "custom" ? "custom" : String(ledgerYear)}
              onChange={(e) => {
                if (e.target.value === "custom") setPeriodMode("custom");
                else { setPeriodMode("year"); setLedgerYear(Number(e.target.value)); }
              }}
              className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] cursor-pointer">
              {[...new Set([...Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i), ledgerYear])]
                .sort((a, b) => b - a)
                .map((y) => (
                  <option key={y} value={String(y)}>{y}-01-01 ~ {y}-12-31</option>
                ))}
              <option value="custom">기간 직접 선택</option>
            </select>
            {periodMode === "year" ? (
              <>
                {/* 연도 직접 입력 — 드롭다운 밖 연도도 타이핑(Enter/포커스 아웃 적용) */}
                <input
                  type="number" inputMode="numeric" min={2000} max={2100}
                  value={yearInput}
                  onChange={(e) => setYearInput(e.target.value)}
                  onBlur={() => { const y = Number(yearInput); if (y >= 2000 && y <= 2100) setLedgerYear(y); else setYearInput(String(ledgerYear)); }}
                  onKeyDown={(e) => { if (e.key === "Enter") (e.target as HTMLInputElement).blur(); }}
                  title="연도 직접 입력 (Enter)"
                  className="w-[68px] px-2 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] mono-number"
                />
                <span className="text-[var(--text-dim)]">년</span>
              </>
            ) : (
              <span className="inline-flex items-center gap-1">
                {/* 기간 직접 선택 — 부터~까지 임의 지정 */}
                <DateField value={customFrom} max={customTo}
                  onChange={(e) => e.target.value && setCustomFrom(e.target.value)}
                  title="시작일"
                  className="px-2 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] mono-number" />
                <span className="text-[var(--text-dim)]">~</span>
                <DateField value={customTo} min={customFrom}
                  onChange={(e) => e.target.value && setCustomTo(e.target.value)}
                  title="종료일"
                  className="px-2 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] mono-number" />
              </span>
            )}
          </div>
          <input value={ledgerSearch} onChange={(e) => setLedgerSearch(e.target.value)} placeholder="거래처명 검색"
            className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] w-36 focus:border-[var(--primary)]/60 focus:outline-none transition" />
          <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "outstanding" | "name" | "code")}
            className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] cursor-pointer">
            <option value="outstanding">잔액 큰 순</option>
            <option value="code">코드순</option>
            <option value="name">거래처명 순</option>
          </select>
        </div>
        <div className="ledger-toolbar-actions">
          <Link href="/partners" className="btn-secondary text-xs">← 거래처</Link>
          <button onClick={() => !linkMut.isPending && linkMut.mutate()} disabled={linkMut.isPending}
            className="btn-secondary text-xs"
            title="홈택스 세금계산서 거래처를 사업자번호로 자동 등록·연결">
            {linkMut.isPending ? "연결 중..." : "홈택스 거래처 연결"}</button>
          <Link href="/partners/reconciliation"
            className="btn-primary text-xs"
            title="입금·계산서 자동 매칭 (확인 큐 / 수동 매칭 / 확정 내역)">
            ⚙️ 거래 매칭 →
          </Link>
        </div>
      </div>

      {/* KPI 행: 총 미수금/미지급 + 거래처 수 + 반대편 미니 카드(클릭 전환) */}
      <div className="ledger-kpi-row">
        <div className="ledger-kpi-total glass-card">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">{ledgerType === "sales" ? "총 미수금" : "총 미지급금"}</span>
          <span className="text-[17px] sm:text-[26px] leading-7 sm:leading-8 font-extrabold mono-number whitespace-nowrap tracking-tight" style={{ color: pal.main }}>{won(total)}</span>
        </div>
        <div className="ledger-kpi-count glass-card">
          <span className="text-[13px] font-semibold text-[var(--text-muted)]">{pal.label}</span>
          <span className="text-[17px] sm:text-[26px] leading-7 sm:leading-8 font-extrabold mono-number whitespace-nowrap tracking-tight text-[var(--text)]">{shown.length}<span className="text-sm font-semibold text-[var(--text-dim)]"> 곳{sq && data.length !== shown.length ? ` / ${data.length}` : ""}</span></span>
        </div>
        {/* 반대편 미니 요약 — 클릭하면 탭 전환 */}
        <button onClick={() => setLedgerType(ledgerType === "sales" ? "purchase" : "sales")}
          className="ledger-kpi-other glass-card"
          title="클릭하여 전환">
          <span className="text-[13px] font-semibold text-[var(--text-muted)] flex items-center gap-1">{other.arrow} {other.label}</span>
          <span className={`text-[17px] sm:text-[26px] leading-7 sm:leading-8 font-extrabold mono-number whitespace-nowrap tracking-tight ${other.tintText}`}>{won(otherTotal)}</span>
        </button>
      </div>
      <p className="text-[11px] text-[var(--text-dim)]">잔액 = 전기이월 + 당기 잔액 · 확정된 매칭(거래 매칭)만 정산으로 반영</p>

      {/* 미수 경과(에이징) — 세금계산서 발행 기준. 회수 우선순위 판단용(오래 밀린 미수 강조). 매출처 뷰 전용. */}
      {ledgerType === "sales" && aging && aging.total > 0 && (
        <div className="ledger-ar-aging glass-card">
          <div className="flex items-center justify-between gap-2 mb-2.5 flex-wrap">
            <span className="text-[12px] font-bold text-[var(--text)]">미수 경과 · 세금계산서 발행 기준</span>
            <span className="text-[10px] text-[var(--text-dim)]">합계 {won(aging.total)} · 원장 총 미수금은 전표·이월 포함(차이 정상)</span>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            {aging.buckets.map((b, i) => {
              const cls = ["bg-[var(--bg-surface)] text-[var(--text)]",
                "bg-[var(--warning)]/10 text-[var(--warning)]",
                "bg-[var(--warning)]/18 text-[var(--warning)]",
                "bg-[var(--danger)]/12 text-[var(--danger)]"][i];
              return (
                <div key={b.label} className={`ar-aging-bucket ${cls}`}>
                  <div className="text-[10px] font-semibold uppercase tracking-wider opacity-80">{b.label}</div>
                  <div className="text-[15px] font-black mono-number leading-tight mt-0.5">{won(b.amount)}</div>
                  <div className="text-[9px] opacity-70 mt-0.5">{b.count}건</div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {lLoading ? (
        <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-4 items-start">
          {/* ── 좌: 거래처 목록 ── */}
          <div className="ledger-partner-list glass-card">
            <div className="ledger-partner-list-header" style={{ background: `color-mix(in srgb, ${pal.main} 7%, var(--bg-surface))` }}>
              <label className="flex items-center gap-1.5 cursor-pointer select-none" title="전체 선택/해제 — 선택한 거래처를 엑셀 한 파일(거래처별 시트)로 내보냅니다">
                <input type="checkbox"
                  checked={shown.length > 0 && shown.every((r) => checkedIds.has(r.partner_id ?? "none"))}
                  onChange={(e) => setCheckedIds(e.target.checked ? new Set(shown.map((r) => r.partner_id ?? "none")) : new Set())} />
                <span className="text-xs font-bold text-[var(--text)]">{pal.label} 목록</span>
              </label>
              <span className="caption">{shown.length}곳</span>
            </div>
            {checkedIds.size > 0 && (
              <div className="ledger-partner-list-export-bar">
                <span className="text-[11px] text-[var(--text-muted)]">{checkedIds.size}곳 선택</span>
                <button
                  disabled={exporting}
                  onClick={async () => {
                    if (exporting || !companyId) return;
                    setExporting(true);
                    try {
                      const targets = shown.filter((r) => checkedIds.has(r.partner_id ?? "none"))
                        .map((r) => ({ partnerId: r.partner_id, type: r.type, name: nameOf(r.partner_id) }));
                      await exportPartnerLedgersXlsx(companyId, targets, periodStart, periodEnd, pal.label);
                      toast(`${targets.length}곳 원장을 엑셀로 내보냈습니다 (거래처별 시트)`, "success");
                    } catch (e: any) {
                      toast(e?.message || "엑셀 내보내기 실패", "error");
                    } finally {
                      setExporting(false);
                    }
                  }}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-semibold text-white hover:opacity-90 disabled:opacity-50"
                  style={{ background: pal.main }}>
                  {exporting ? "내보내는 중…" : "📊 엑셀 내보내기"}
                </button>
              </div>
            )}
            <div className="overflow-y-auto max-h-[560px] p-1.5 space-y-0.5">
              {shown.length === 0 ? (
                <EmptyState
                  icon={sq ? "🔍" : "📒"}
                  title={sq ? "검색 결과가 없습니다." : `${periodLabel} ${pal.label} 거래가 없습니다.`}
                  desc={sq ? undefined : "상단 “홈택스 거래처 연결”을 먼저 실행해 보세요."}
                />
              ) : shown.map((r, idx) => {
                const key = r.partner_id ?? "none";
                const active = key === selKey;
                const out = ledgerOut(r);
                return (
                  <div key={`${key}-${r.type}`}
                    className={`ledger-partner-row ${active ? "" : "hover:bg-[var(--bg-surface)]/70"}`}
                    style={active ? { background: `color-mix(in srgb, ${pal.main} 9%, transparent)` } : undefined}>
                    {active && <span aria-hidden className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full" style={{ background: pal.main }} />}
                    <label className="flex items-center pl-3 pr-1 cursor-pointer" title="일괄 엑셀 내보내기 선택">
                      <input type="checkbox" checked={checkedIds.has(key)} onChange={() => toggleChecked(key)} />
                    </label>
                    <button onClick={() => setSelLedger(key)}
                      className="flex-1 min-w-0 flex items-center justify-between gap-2 pl-1 pr-3 py-2.5 text-left">
                      <span className="min-w-0">
                        <span className="block text-[10px] text-[var(--text-dim)] mono-number">{r.partner_id && partnerCodeMap[r.partner_id] ? String(partnerCodeMap[r.partner_id]).padStart(4, "0") : "—"}</span>
                        <span className={`block text-xs truncate ${active ? "font-bold" : "font-medium text-[var(--text)]"}`} style={active ? { color: pal.main } : undefined}>{nameOf(r.partner_id)}</span>
                      </span>
                      <span className={`shrink-0 text-xs font-semibold mono-number ${out > 0 ? pal.tintText : out < 0 ? "text-[var(--danger)]" : "text-[var(--text-dim)]"}`}>{Math.round(out).toLocaleString()}</span>
                    </button>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── 우: 일자별 원장 (차변/대변/잔액) ── */}
          {selRow ? (
            <PartnerLedgerSheet
              key={`${selKey}-${selRow.type}-${periodStart}-${periodEnd}`}
              companyId={companyId!}
              partnerId={selRow.partner_id}
              type={selRow.type}
              year={rpcYear}
              periodStart={periodStart}
              periodEnd={periodEnd}
              partnerName={nameOf(selRow.partner_id)}
              openingFromRpc={Number(selRow.prior_outstanding || 0)}
              onOpenDetail={() => setDetail({ partnerId: selRow.partner_id, type: selRow.type, focus: "all" })}
            />
          ) : (
            <EmptyState
              card
              icon="📒"
              title="좌측에서 거래처를 선택하세요."
              desc="선택한 거래처의 일자별 원장(차변·대변·잔액)이 표시됩니다"
            />
          )}
        </div>
      )}

      {/* 거래처 상세 팝업 (차액 마감 포함) */}
      {detail && companyId && (
        <PartnerDetailModal
          companyId={companyId}
          partnerId={detail.partnerId}
          type={detail.type}
          year={rpcYear}
          partnerName={nameOf(detail.partnerId)}
          focus={detail.focus}
          onClose={() => setDetail(null)}
        />
      )}

      <p className="text-[11px] text-[var(--text-dim)]">
        ※ 미확정 입금 매칭은 <Link href="/partners/reconciliation" className="text-[var(--primary)] hover:underline">거래 매칭</Link>에서 확정해야 잔액에 반영됩니다 · <span className="text-[var(--danger)]">빨간색</span>은 마이너스 잔액·장기 미정산에만 사용됩니다
      </p>
    </div>
  );
}
