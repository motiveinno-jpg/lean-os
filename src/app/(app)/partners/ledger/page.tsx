"use client";

// 거래처 원장 — 매출처(받을 돈)/매입처(줄 돈) 잔액 조회 (2026-06-12 메뉴 분리 핸드오프).
//   대사 작업(확인 큐/수동 매칭/확정 내역)은 /partners/reconciliation (거래 대사)로 분리.
//   UX(§4): 세그먼트 탭(매출처=파랑 #2563EB / 매입처=주황 #EA580C, 빨강은 연체·마이너스 전용) +
//   요약 카드 + 좌 거래처 목록 / 우 위하고식 원장 시트. 탭 상태는 URL ?type= 에 반영.

import { useMemo, useState } from "react";
import Link from "next/link";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useUser } from "@/components/user-context";
import { useToast } from "@/components/toast";
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
  const db = supabase as any;

  const [ledgerType, setLedgerTypeRaw] = useState<ArApType>(initialType);
  const [ledgerYear, setLedgerYear] = useState(new Date().getFullYear()); // 회계기간(연도)
  const [ledgerSearch, setLedgerSearch] = useState("");
  const [sortBy, setSortBy] = useState<"outstanding" | "name">("outstanding"); // 기본: 잔액 큰 순 (관리 우선순위)
  const [selLedger, setSelLedger] = useState<string | null>(null); // 좌측 목록 선택 (partner_id, null 거래처는 "none")
  const [detail, setDetail] = useState<{ partnerId: string | null; type: string; focus: "all" | "prior" } | null>(null);

  const setLedgerType = (t: ArApType) => {
    setLedgerTypeRaw(t);
    setSelLedger(null);
    try { window.history.replaceState({}, "", `/partners/ledger?type=${t}`); } catch { /* noop */ }
  };

  const { data: rows = [], isLoading: lLoading } = useQuery<LedgerRow[]>({
    queryKey: ["partner-ledger", companyId, ledgerYear],
    queryFn: async () => {
      const { data } = await db.rpc("get_partner_ledger_by_year", { p_year: ledgerYear });
      return (data || []) as LedgerRow[];
    },
    enabled: !!companyId,
  });

  const { data: partnerMap = {} } = useQuery<Record<string, string>>({
    queryKey: ["partner-ledger-names", companyId],
    queryFn: async () => {
      const { data } = await db.from("partners").select("id, name").eq("company_id", companyId);
      const m: Record<string, string> = {};
      for (const p of (data || []) as any[]) m[p.id] = p.name;
      return m;
    },
    enabled: !!companyId,
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

  // 잔액 = 전기이월 + 당기 잔액
  const ledgerOut = (r: LedgerRow) => Number(r.prior_outstanding || 0) + Number(r.period_outstanding || 0);
  const { receivables, payables, totalAr, totalAp } = useMemo(() => {
    const has = (r: LedgerRow) => ledgerOut(r) > 0 || Number(r.period_billed || 0) > 0;
    const recv = rows.filter((r) => r.type === "sales" && has(r));
    const pay = rows.filter((r) => r.type === "purchase" && has(r));
    return { receivables: recv, payables: pay,
      totalAr: recv.reduce((s, r) => s + ledgerOut(r), 0),
      totalAp: pay.reduce((s, r) => s + ledgerOut(r), 0) };
  }, [rows]);

  const pal = palette(ledgerType);
  const data = ledgerType === "sales" ? receivables : payables;
  const total = ledgerType === "sales" ? totalAr : totalAp;
  const other = ledgerType === "sales" ? AR_AP.purchase : AR_AP.sales;
  const otherTotal = ledgerType === "sales" ? totalAp : totalAr;

  const sq = ledgerSearch.trim().toLowerCase();
  const shown = useMemo(() => {
    const filtered = sq ? data.filter((r) => nameOf(r.partner_id).toLowerCase().includes(sq)) : [...data];
    filtered.sort((a, b) => sortBy === "name"
      ? nameOf(a.partner_id).localeCompare(nameOf(b.partner_id), "ko")
      : ledgerOut(b) - ledgerOut(a));
    return filtered;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, sq, sortBy, partnerMap]);

  const selKey = selLedger ?? (shown[0] ? (shown[0].partner_id ?? "none") : null);
  const selRow = shown.find((r) => (r.partner_id ?? "none") === selKey) || null;

  return (
    <div className="space-y-4">
      <div className="page-sticky-header flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--text)]">거래처 원장</h1>
          <p className="text-xs text-[var(--text-dim)] mt-1">매출처·매입처 잔액을 거래처별로 관리합니다</p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          <Link href="/partners" className="px-3 py-2 text-xs rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)]">← 거래처</Link>
          <button onClick={() => !linkMut.isPending && linkMut.mutate()} disabled={linkMut.isPending}
            className="px-3 py-2 text-xs font-semibold rounded-lg bg-[var(--bg-card)] border border-[var(--border)] hover:border-[var(--primary)] hover:text-[var(--primary)] disabled:opacity-50"
            title="홈택스 세금계산서 거래처를 사업자번호로 자동 등록·연결">
            {linkMut.isPending ? "연결 중..." : "홈택스 거래처 연결"}</button>
          <Link href="/partners/reconciliation"
            className="px-4 py-2 text-xs font-semibold rounded-lg bg-[var(--primary)] text-white hover:opacity-90"
            title="입금·계산서 자동 매칭 (확인 큐 / 수동 매칭 / 확정 내역)">
            ⚙️ 매칭허브 →
          </Link>
        </div>
      </div>

      {/* ── 세그먼트 탭: 매출처(파랑) / 매입처(주황) — 색+라벨+방향 아이콘 3중 신호 ── */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="inline-flex rounded-xl border border-[var(--border)] bg-[var(--bg-surface)] p-1 gap-1">
          {(["sales", "purchase"] as const).map((t) => {
            const p = AR_AP[t];
            const active = ledgerType === t;
            return (
              <button key={t} onClick={() => setLedgerType(t)}
                className={`px-4 py-2 rounded-lg text-sm font-bold transition flex items-center gap-1.5 ${active ? "text-white shadow-sm" : "text-[var(--text-muted)] hover:text-[var(--text)]"}`}
                style={active ? { background: p.main } : undefined}>
                <span className="text-base leading-none">{p.arrow}</span>
                {p.label}
              </button>
            );
          })}
        </div>
        <div className="flex items-center gap-1.5 text-xs text-[var(--text-muted)]">
          <span className="font-semibold">회계기간</span>
          <select value={ledgerYear} onChange={(e) => { setLedgerYear(Number(e.target.value)); }}
            className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] cursor-pointer">
            {Array.from({ length: 5 }, (_, i) => new Date().getFullYear() - i).map((y) => (
              <option key={y} value={y}>{y}-01-01 ~ {y}-12-31</option>
            ))}
          </select>
        </div>
        <input value={ledgerSearch} onChange={(e) => setLedgerSearch(e.target.value)} placeholder="거래처명 검색"
          className="px-3 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] w-36" />
        <select value={sortBy} onChange={(e) => setSortBy(e.target.value as "outstanding" | "name")}
          className="px-2.5 py-1.5 rounded-lg bg-[var(--bg-surface)] border border-[var(--border)] text-xs text-[var(--text)] cursor-pointer">
          <option value="outstanding">잔액 큰 순</option>
          <option value="name">거래처명 순</option>
        </select>
      </div>

      {/* ── 요약 카드 (선택 탭 기준) ── */}
      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-3 items-stretch">
        <div className="glass-card px-5 py-4 flex flex-wrap items-center gap-x-8 gap-y-2" style={{ borderTop: `3px solid ${pal.main}` }}>
          <div>
            <div className="text-xs text-[var(--text-muted)]">{ledgerType === "sales" ? "총 미수금" : "총 미지급금"}</div>
            <div className="text-2xl font-bold mono-number mt-0.5" style={{ color: pal.main }}>{won(total)}</div>
          </div>
          <div>
            <div className="text-xs text-[var(--text-muted)]">{pal.label}</div>
            <div className="text-2xl font-bold mono-number mt-0.5 text-[var(--text)]">{shown.length}<span className="text-sm font-semibold text-[var(--text-dim)]"> 곳{sq && data.length !== shown.length ? ` / ${data.length}` : ""}</span></div>
          </div>
          <div className="text-[11px] text-[var(--text-dim)] leading-relaxed ml-auto hidden md:block">
            잔액 = 전기이월 + 당기 잔액<br />확정된 매칭(매칭허브)만 정산으로 반영
          </div>
        </div>
        {/* 반대편 미니 요약 — 클릭하면 탭 전환 */}
        <button onClick={() => setLedgerType(ledgerType === "sales" ? "purchase" : "sales")}
          className="glass-card px-4 py-3 text-left hover:bg-[var(--bg-surface)] transition min-w-[170px]"
          title="클릭하여 전환">
          <div className="text-[11px] text-[var(--text-dim)] flex items-center gap-1">{other.arrow} {other.label}</div>
          <div className={`text-base font-bold mono-number mt-0.5 ${other.tintText}`}>{won(otherTotal)}</div>
        </button>
      </div>

      {lLoading ? (
        <div className="p-12 text-center text-sm text-[var(--text-muted)]">불러오는 중...</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-[290px_1fr] gap-3 items-start">
          {/* ── 좌: 거래처 목록 ── */}
          <div className="glass-card overflow-hidden">
            <div className="px-3 py-2.5 border-b border-[var(--border)] flex items-center justify-between" style={{ background: `color-mix(in srgb, ${pal.main} 7%, var(--bg-surface))` }}>
              <span className="text-xs font-bold text-[var(--text)]">{pal.label} 목록</span>
              <span className="text-[10px] text-[var(--text-dim)]">{shown.length}곳</span>
            </div>
            <div className="overflow-y-auto max-h-[560px]">
              {shown.length === 0 ? (
                <div className="p-8 text-center text-xs text-[var(--text-muted)]">{sq ? "검색 결과가 없습니다." : `${ledgerYear}년 ${pal.label} 거래가 없습니다. 상단 “홈택스 거래처 연결”을 먼저 실행해 보세요.`}</div>
              ) : shown.map((r, idx) => {
                const key = r.partner_id ?? "none";
                const active = key === selKey;
                const out = ledgerOut(r);
                return (
                  <button key={`${key}-${r.type}`} onClick={() => setSelLedger(key)}
                    className={`w-full flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--border)]/40 text-left transition border-l-2 ${active ? "" : "hover:bg-[var(--bg-surface)] border-l-transparent"}`}
                    style={active ? { background: `color-mix(in srgb, ${pal.main} 8%, transparent)`, borderLeftColor: pal.main } : undefined}>
                    <span className="min-w-0">
                      <span className="block text-[10px] text-[var(--text-dim)] mono-number">{String(idx + 1).padStart(3, "0")}</span>
                      <span className={`block text-xs truncate ${active ? "font-bold" : "text-[var(--text)]"}`} style={active ? { color: pal.main } : undefined}>{nameOf(r.partner_id)}</span>
                    </span>
                    <span className={`shrink-0 text-xs mono-number ${out > 0 ? pal.tintText : out < 0 ? "text-red-500" : "text-[var(--text-dim)]"}`}>{Math.round(out).toLocaleString()}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* ── 우: 일자별 원장 (차변/대변/잔액) ── */}
          {selRow ? (
            <PartnerLedgerSheet
              key={`${selKey}-${selRow.type}-${ledgerYear}`}
              companyId={companyId!}
              partnerId={selRow.partner_id}
              type={selRow.type}
              year={ledgerYear}
              partnerName={nameOf(selRow.partner_id)}
              openingFromRpc={Number(selRow.prior_outstanding || 0)}
              onOpenDetail={() => setDetail({ partnerId: selRow.partner_id, type: selRow.type, focus: "all" })}
            />
          ) : (
            <div className="glass-card p-12 text-center text-sm text-[var(--text-muted)]">좌측에서 거래처를 선택하세요.</div>
          )}
        </div>
      )}

      {/* 거래처 상세 팝업 (차액 마감 포함) */}
      {detail && companyId && (
        <PartnerDetailModal
          companyId={companyId}
          partnerId={detail.partnerId}
          type={detail.type}
          year={ledgerYear}
          partnerName={nameOf(detail.partnerId)}
          focus={detail.focus}
          onClose={() => setDetail(null)}
        />
      )}

      <p className="text-[11px] text-[var(--text-dim)]">
        ※ 미확정 입금 매칭은 <Link href="/partners/reconciliation" className="text-[var(--primary)] hover:underline">매칭허브</Link>에서 확정해야 잔액에 반영됩니다 · <span className="text-red-500">빨간색</span>은 마이너스 잔액·장기 미정산에만 사용됩니다
      </p>
    </div>
  );
}
