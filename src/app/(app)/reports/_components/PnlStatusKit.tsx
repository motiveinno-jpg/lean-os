"use client";

// 손익 현황 공용 부품 (2026-08-19 기획) — 요약·매출·비용 세 화면이 같은 기간·비교·머리·드릴다운을 쓴다.
//   기준 = 확정 전표(lib/pnl-status). 화면마다 셈이 달라지지 않게 여기서 한 번만.

import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import Link from "next/link";
import { getCurrentUser } from "@/lib/queries";
import { DateRangeField } from "@/components/date-range-field";
import { ChipGroup, Stat, ExcelMenu, type ExcelItem } from "@/components/query-kit";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { ReportHead } from "./ReportHead";
import {
  fetchPnlStatus, summarize, pctChange, rangeLabel, type MonthRange, type JournalLine, type PnlSummary, pnlAmount,
} from "@/lib/pnl-status";

export const won = (n: number) => `${n < 0 ? "-" : ""}₩${Math.abs(Math.round(n)).toLocaleString("ko-KR")}`;
export const num = (n: number) => (n < 0 ? `(${Math.abs(Math.round(n)).toLocaleString("ko-KR")})` : Math.round(n).toLocaleString("ko-KR"));

const ymNow = () => { const d = new Date(Date.now() + 9 * 3600 * 1000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; };

export function usePnlStatus() {
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u) => { if (u) setCompanyId(u.company_id); }); }, []);
  const [range, setRange] = useState<MonthRange>(() => { const m = ymNow(); return { fromYm: m, toYm: m }; });
  const [compare, setCompare] = useState<"prev" | "yoy">("prev");
  const q = useQuery({
    queryKey: ["pnl-status", companyId, range.fromYm, range.toYm, compare],
    queryFn: () => fetchPnlStatus(companyId!, range, compare),
    enabled: !!companyId, staleTime: 60_000,
  });
  const cur = useMemo(() => summarize(q.data?.curLines || []), [q.data]);
  const cmp = useMemo(() => summarize(q.data?.cmpLines || []), [q.data]);
  const cmpLabel = q.data ? (compare === "prev" ? (range.fromYm === range.toYm ? "전월" : "직전 기간") : "전년 동기") : "";
  return { companyId, range, setRange, compare, setCompare, data: q.data, loading: !companyId || q.isLoading, cur, cmp, cmpLabel, curLines: q.data?.curLines || [], cmpLines: q.data?.cmpLines || [] };
}
export type PnlStatusState = ReturnType<typeof usePnlStatus>;

/** 증감 표시 — 전기 0 이면 '—' (경계값 규칙) */
export function Delta({ cur, prev, invert = false, size = "sm" }: { cur: number; prev: number; invert?: boolean; size?: "sm" | "xs" }) {
  const p = pctChange(cur, prev);
  if (p === null) return <span className={`text-[var(--text-dim)] ${size === "xs" ? "text-[10px]" : "text-[11px]"}`}>—</span>;
  const good = invert ? p <= 0 : p >= 0;
  return <span className={`${size === "xs" ? "text-[10px]" : "text-[11px]"} font-semibold ${p === 0 ? "text-[var(--text-dim)]" : good ? "text-[var(--success)]" : "text-[var(--danger)]"}`}>{p > 0 ? "▲" : p < 0 ? "▼" : ""}{Math.abs(p)}%</span>;
}

/** 상자 머리 — 기간(월 단위) · 비교 칩 · 화면별 추가 조건 ‖ 엑셀 · 인쇄 / 지표 줄 */
export function PnlHead({ s, bar, stats, excel }: { s: PnlStatusState; bar?: ReactNode; stats: ReactNode; excel?: ExcelItem[] }) {
  return (
    <ReportHead
      bar={<>
        <DateRangeField unit="month" label="기간" from={s.range.fromYm} to={s.range.toYm}
          onChange={(f, t) => s.setRange({ fromYm: f, toYm: t })} />
        <ChipGroup value={s.compare} onChange={s.setCompare} options={[{ value: "prev", label: "전월 비교" }, { value: "yoy", label: "전년 동기" }] as const} />
        {bar}
      </>}
      right={<>
        {excel && excel.length > 0 && <ExcelMenu items={excel} />}
        <button type="button" onClick={() => window.print()} className="btn-secondary btn-sm">인쇄</button>
      </>}
      stats={stats}
    />
  );
}

/** 기준 안내 한 줄 — 손익계산서와 같은 숫자 · 전표 안 된 자료 N건 */
export function BasisNote({ s }: { s: PnlStatusState }) {
  const u = s.data?.unposted;
  return (
    <div className="pnl-basis-note">
      <b>확정 전표 기준</b> — 손익계산서와 같은 숫자입니다.
      {u && u.total > 0 && (<> 전표로 만들지 않은 자료 <b className="text-[var(--warning)]">{u.total.toLocaleString()}건</b>
        {" ("}{[u.taxInvoice > 0 ? `세금계산서 ${u.taxInvoice.toLocaleString()}` : null, u.card > 0 ? `카드 ${u.card.toLocaleString()}` : null, u.bank > 0 ? `통장 ${u.bank.toLocaleString()}` : null].filter(Boolean).join(" · ")}{")"}
        은 빠져 있습니다 · <Link href="/collect" className="font-semibold text-[var(--primary)]">수집·전표 →</Link></>)}
      {u && u.total === 0 && <> 이 기간 자료는 모두 전표로 반영됐습니다.</>}
    </div>
  );
}

/** 요약 지표 줄 — 요약 탭 기본 5개 */
export function CoreStats({ cur, cmp }: { cur: PnlSummary; cmp: PnlSummary }) {
  const rate = cur.revenue > 0 ? Math.round((cur.operating / cur.revenue) * 1000) / 10 : null; // 매출 0 이하면 이익률은 뜻이 없다 → '—'
  return (<>
    <Stat label="매출" value={<>{won(cur.revenue)} <Delta cur={cur.revenue} prev={cmp.revenue} /></>} />
    <Stat label="매출원가" value={<>{won(cur.cogs)} <Delta cur={cur.cogs} prev={cmp.cogs} invert /></>} />
    <Stat label="판관비" value={<>{won(cur.opex)} <Delta cur={cur.opex} prev={cmp.opex} invert /></>} />
    <Stat label="영업이익" tone={cur.operating >= 0 ? "plus" : "minus"} value={<>{won(cur.operating)} <Delta cur={cur.operating} prev={cmp.operating} /></>} />
    <Stat label="영업이익률" value={rate === null ? "—" : `${rate}%`} />
  </>);
}

// ── 원천 드릴다운 — 그 계정/거래처의 전표 줄 ─────────────────────────────
export type Drill = { title: string; sub?: string; lines: JournalLine[] };
export function DrillModal({ drill, onClose }: { drill: Drill | null; onClose: () => void }) {
  useModalKeys(!!drill, onClose);
  if (!drill) return null;
  const rows = [...drill.lines].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
  const total = rows.reduce((s, l) => s + pnlAmount(l), 0);
  return (
    <div className="approval-detail-modal" onClick={onClose}>
      <div className="pnl-drill" onClick={(e) => e.stopPropagation()}>
        <div className="pnl-drill-head">
          <div>
            <b>{drill.title}</b>
            {drill.sub && <span className="ml-2 text-[11px] text-[var(--text-dim)]">{drill.sub}</span>}
            <div className="text-[11px] text-[var(--text-muted)]">전표 줄 {rows.length.toLocaleString()}개 · 합계 <b className="mono-number">{won(total)}</b> — 줄을 누르면 전표로</div>
          </div>
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
        </div>
        <div className="pnl-drill-body">
          <table className="ev-table ev-lined pnl-drill-table">
            <thead><tr><th>날짜</th><th>전표</th><th>계정</th><th>거래처</th><th>적요</th><th>차변</th><th>대변</th></tr></thead>
            <tbody>
              {rows.slice(0, 500).map((l, i) => (
                <tr key={`${l.entryId}-${i}`}>
                  <td className="text-center mono-number">{l.date}</td>
                  <td className="text-center"><Link href={`/partners/reconciliation/voucher-entry?from=${l.month}&to=${l.month}&q=${l.voucherNo ?? ""}`} className="text-[var(--primary)] font-semibold no-underline hover:underline">{l.voucherNo ? `#${l.voucherNo}` : "열기"}</Link></td>
                  <td className="text-left">{l.name}</td>
                  <td className="text-left">{l.partnerName || <span className="text-[var(--text-dim)]">—</span>}</td>
                  <td className="text-left truncate" title={l.memo}>{l.memo || <span className="text-[var(--text-dim)]">—</span>}</td>
                  <td className="text-right mono-number">{l.debit ? l.debit.toLocaleString("ko-KR") : ""}</td>
                  <td className="text-right mono-number">{l.credit ? l.credit.toLocaleString("ko-KR") : ""}</td>
                </tr>
              ))}
              {rows.length > 500 && <tr><td colSpan={7} className="text-center text-[11px] text-[var(--text-dim)]">500줄까지만 보입니다 — 기간을 좁혀 보세요</td></tr>}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

export const cmpRangeLabel = (s: PnlStatusState) => (s.data ? rangeLabel(s.data.cmpRange) : "");
