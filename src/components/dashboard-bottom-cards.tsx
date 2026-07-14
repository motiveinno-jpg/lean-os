"use client";

// 대시보드 하단 카드 — 2026-06-09 Stitch 시안 정렬 + 다크/라이트 적응.
//   라운드6.5 골격 정렬: 매출 추이는 DashboardRevenueTrendCard(본문 2/3 큰 차트 카드)로 분리,
//   DashboardBottomCards 는 카드/자산 2카드 하단 풀폭 행만 담당. 실데이터·쿼리 무변경.
//   표면(카드/행/텍스트/보더)은 테마 토큰 → 다크모드 자동 적응.

import { useState } from "react";
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;
const fmtW = (n: number) => `₩${Math.round(n).toLocaleString("ko-KR")}`;

// 강조 팔레트 — CSS 토큰(라이트/다크 자동 대응)
const A = { blue: "var(--info)", green: "var(--success)", red: "var(--danger)" };

// ── 정제 라인차트 (라운드7.1 공통 차트 스타일) — 인라인 SVG, 새 의존성 없음.
//   스펙: 선 1.5px 곡선 보간(Catmull-Rom→Bezier) · 12% 그라데이션 면 · 작은 끝점+헤일로 ·
//         극세 점선 그리드 + Y눈금 3개(0/½/max, 억·만 단위) + X 라벨. preserveAspectRatio 유지(텍스트 왜곡 방지).
const fmtAxis = (v: number): string => {
  if (v <= 0) return "0";
  if (v >= 1e8) return `${v % 1e8 === 0 ? v / 1e8 : (v / 1e8).toFixed(1)}억`;
  if (v >= 1e4) return `${Math.round(v / 1e4).toLocaleString()}만`;
  return String(Math.round(v));
};
// 축 최대값을 1/2/2.5/5×10^k 로 올림 — 눈금이 어중간한 수가 되지 않게
const niceMax = (v: number): number => {
  if (v <= 0) return 1;
  const exp = Math.pow(10, Math.floor(Math.log10(v)));
  const f = v / exp;
  const nice = f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10;
  return nice * exp;
};
// Catmull-Rom 스플라인 → cubic Bezier 변환 (부드러운 곡선, 오버슈트 낮춤 t=0.8)
const smoothPath = (pts: { x: number; y: number }[]): string => {
  if (pts.length < 2) return "";
  const d: string[] = [`M${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`];
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[Math.max(0, i - 1)], p1 = pts[i], p2 = pts[i + 1], p3 = pts[Math.min(pts.length - 1, i + 2)];
    const k = 0.8 / 6;
    const c1x = p1.x + (p2.x - p0.x) * k, c1y = p1.y + (p2.y - p0.y) * k;
    const c2x = p2.x - (p3.x - p1.x) * k, c2y = p2.y - (p3.y - p1.y) * k;
    d.push(`C${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`);
  }
  return d.join(" ");
};

function RefinedTrendChart({ series, labels, gradId }: { series: number[]; labels: string[]; gradId: string }) {
  const W = 560, H = 216, padL = 48, padR = 16, padT = 14, padB = 26;
  const max = niceMax(Math.max(...series, 1));
  const n = series.length;
  const x = (i: number) => padL + (n === 1 ? 0.5 : i / (n - 1)) * (W - padL - padR);
  const y = (v: number) => H - padB - (v / max) * (H - padT - padB);
  const pts = series.map((v, i) => ({ x: x(i), y: y(v) }));
  const line = smoothPath(pts);
  const area = `${line} L${x(n - 1).toFixed(1)} ${H - padB} L${x(0).toFixed(1)} ${H - padB} Z`;
  const last = pts[n - 1];
  const xStep = Math.max(1, Math.ceil(n / 7)); // 라벨 과밀 방지 — 최대 ~7개
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="추이 차트">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--primary)" stopOpacity="0.12" />
          <stop offset="100%" stopColor="var(--primary)" stopOpacity="0" />
        </linearGradient>
      </defs>
      {/* 그리드 — 0선은 실선 헤어라인, ½·max 는 극세 점선 */}
      <line x1={padL} y1={H - padB} x2={W - padR} y2={H - padB} stroke="var(--border)" strokeWidth="0.8" />
      {[0.5, 1].map((r) => (
        <line key={r} x1={padL} y1={y(max * r)} x2={W - padR} y2={y(max * r)} stroke="var(--border)" strokeWidth="0.6" strokeDasharray="1.5 4" />
      ))}
      {/* Y 눈금 (0 / ½ / max) */}
      {[0, 0.5, 1].map((r) => (
        <text key={r} x={padL - 8} y={y(max * r) + 3.5} textAnchor="end" fontSize="10" fill="var(--text-dim)">{fmtAxis(max * r)}</text>
      ))}
      {/* X 라벨 */}
      {labels.map((lb, i) => (i % xStep === 0 || i === n - 1) && (
        <text key={i} x={x(i)} y={H - padB + 15} textAnchor="middle" fontSize="10" fill="var(--text-dim)">{lb}</text>
      ))}
      <path d={area} fill={`url(#${gradId})`} />
      <path d={line} fill="none" stroke="var(--primary)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      {last && (<>
        <circle cx={last.x} cy={last.y} r="5.5" fill="var(--primary)" opacity="0.15" />
        <circle cx={last.x} cy={last.y} r="2.5" fill="var(--primary)" />
      </>)}
    </svg>
  );
}

// ── 공용 합계 행 (매출 추이 카드 등에서 사용) ──
const TotalRow = ({ label, amount, color }: { label: string; amount: number; color?: string }) => (
  <div className="flex justify-between items-center mt-4 pt-4 border-t border-[var(--border)]">
    <span className="text-[13px] font-medium text-[var(--text-muted)]">{label}</span>
    <span className="text-[16px] font-bold tabular-nums text-[var(--text)]" style={color ? { color } : undefined}>{fmtW(amount)}</span>
  </div>
);
const cardCls = "glass-card p-4 flex flex-col";

// ── 매출 추이 — 본문 2/3 컬럼의 큰 차트 카드 (라운드7.1: 기간 토글 월/분기/연 + 축·눈금) ──
type TrendMode = "month" | "quarter" | "year";

export function DashboardRevenueTrendCard({ companyId }: { companyId: string }) {
  const [mode, setMode] = useState<TrendMode>("month");
  // 매출 — 최근 3개년(type='sales', 공급가액, void 제외) 한 번에 조회 → 월/분기/연 시리즈를 클라이언트에서 파생.
  //   기간 전환 시 재조회 없음. 손익계산서·히어로와 동일 소스 기준.
  const year = new Date().getFullYear();
  const { data: rev } = useQuery({
    queryKey: ["dash-revenue-3y", companyId, year],
    queryFn: async () => {
      const { data } = await db.from("tax_invoices").select("supply_amount, issue_date")
        .eq("company_id", companyId).eq("type", "sales").neq("status", "void")
        .gte("issue_date", `${year - 2}-01-01`).lt("issue_date", `${year + 1}-01-01`);
      // 연도별 월 매트릭스
      const byYear: Record<number, number[]> = { [year - 2]: new Array(12).fill(0), [year - 1]: new Array(12).fill(0), [year]: new Array(12).fill(0) };
      (data || []).forEach((t: any) => {
        const d = new Date(t.issue_date);
        const y = d.getFullYear(), m = d.getMonth();
        if (byYear[y] && m >= 0 && m < 12) byYear[y][m] += Number(t.supply_amount || 0);
      });
      return { byYear };
    },
    enabled: !!companyId, staleTime: 60_000,
  });

  const byYear = rev?.byYear;
  const uptoM = new Date().getMonth() + 1;                 // 올해 경과 월수
  const uptoQ = Math.ceil(uptoM / 3);                      // 올해 경과 분기수
  const thisYearTotal = (byYear?.[year] || []).reduce((s, v) => s + v, 0);

  let series: number[] = [], labels: string[] = [], totalLabel = "", totalAmount = 0;
  if (byYear) {
    if (mode === "month") {
      series = byYear[year].slice(0, Math.max(uptoM, 1));
      labels = series.map((_, i) => `${i + 1}월`);
      totalLabel = `${year} 누적 (공급가액)`; totalAmount = thisYearTotal;
    } else if (mode === "quarter") {
      series = Array.from({ length: Math.max(uptoQ, 1) }, (_, q) => byYear[year].slice(q * 3, q * 3 + 3).reduce((s, v) => s + v, 0));
      labels = series.map((_, q) => `${q + 1}분기`);
      totalLabel = `${year} 누적 (공급가액)`; totalAmount = thisYearTotal;
    } else {
      series = [year - 2, year - 1, year].map((y) => (byYear[y] || []).reduce((s, v) => s + v, 0));
      labels = [`${year - 2}`, `${year - 1}`, `${year}`];
      totalLabel = "최근 3개년 합계 (공급가액)"; totalAmount = series.reduce((s, v) => s + v, 0);
    }
  }
  const hasChart = series.length > 1 && series.some((v) => v > 0);

  return (
    <div className={cardCls}>
      <div className="flex items-center justify-between gap-2 flex-wrap mb-4">
        <div className="flex items-baseline gap-2.5">
          <h3 className="text-sm font-bold text-[var(--text)]">매출 추이</h3>
          <Link href="/reports/pnl" className="text-[12px] font-semibold text-[var(--primary)]">손익 상세 →</Link>
        </div>
        <div className="seg-bar">
          {([["month", "월"], ["quarter", "분기"], ["year", "연"]] as [TrendMode, string][]).map(([k, lb]) => (
            <button key={k} type="button" onClick={() => setMode(k)}
              className={`seg-item !px-2.5 !py-1 !text-[11px] ${mode === k ? "seg-item-active" : ""}`}>{lb}</button>
          ))}
        </div>
      </div>
      <div className="flex-1 flex flex-col justify-center">
        {hasChart ? (
          <RefinedTrendChart series={series} labels={labels} gradId={`rev-grad-${mode}`} />
        ) : (
          <div className="flex justify-between items-center p-3 rounded-xl bg-[var(--bg-surface)]">
            <span className="text-[13px] text-[var(--text-muted)]">{mode === "year" ? "연도별" : `${year}년`} 매출 데이터가 아직 부족합니다</span>
            <span className="text-[13px] font-semibold tabular-nums shrink-0 text-[var(--text)]">{fmtW(totalAmount)}</span>
          </div>
        )}
      </div>
      <TotalRow label={totalLabel || `${year} 누적 (공급가액)`} amount={totalAmount} />
    </div>
  );
}

// ── 하단 풀폭 행 — 카드 / 자산 ──
export function DashboardBottomCards({ companyId }: { companyId: string }) {
  // 카드 — 이번 달 카드별 사용액
  const { data: cards } = useQuery({
    queryKey: ["dash-cards", companyId],
    queryFn: async () => {
      const _now = new Date();
      const monthStart = `${_now.getFullYear()}-${String(_now.getMonth() + 1).padStart(2, "0")}-01`;
      const _nm = new Date(_now.getFullYear(), _now.getMonth() + 1, 1);
      const nextStart = `${_nm.getFullYear()}-${String(_nm.getMonth() + 1).padStart(2, "0")}-01`;
      const { data } = await db.from("card_transactions").select("card_name, amount")
        .eq("company_id", companyId).gte("transaction_date", monthStart).lt("transaction_date", nextStart);
      const byCard: Record<string, number> = {};
      (data || []).forEach((t: any) => { const k = t.card_name || "기타"; byCard[k] = (byCard[k] || 0) + Number(t.amount || 0); });
      const list = Object.entries(byCard).map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount);
      return { list, total: list.reduce((s, c) => s + c.amount, 0), count: list.length };
    },
    enabled: !!companyId, staleTime: 60_000,
  });

  // 자산 — 계좌별 잔액
  const { data: assets } = useQuery({
    queryKey: ["dash-assets", companyId],
    queryFn: async () => {
      const { data } = await db.from("bank_accounts").select("alias, bank_name, balance")
        .eq("company_id", companyId).order("balance", { ascending: false });
      const list: { name: string; amount: number }[] = (data || []).map((a: any) => ({ name: a.alias || a.bank_name || "계좌", amount: Number(a.balance || 0) }));
      return { list, total: list.reduce((s, a) => s + a.amount, 0), count: list.length };
    },
    enabled: !!companyId, staleTime: 60_000,
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      <CompactAssetCard title="카드" color={A.red} total={cards?.total ?? 0} totalLabel="이번 달 사용"
        rows={(cards?.list || []).slice(0, 3)} count={cards?.count ?? 0} href="/cards" empty="이번 달 카드 사용 없음" />
      <CompactAssetCard title="자산" color={A.green} total={assets?.total ?? 0} totalLabel="총 자산"
        rows={(assets?.list || []).slice(0, 3)} count={assets?.count ?? 0} href="/bank" empty="등록된 계좌 없음" />
    </div>
  );
}

// 자산/카드 요약 — 작고 세련된 직사각형(총액 강조 + 얇은 내역 라인 + 카드 전체 클릭 이동)
function CompactAssetCard({ title, color, total, totalLabel, rows, count, href, empty }: {
  title: string; color: string; total: number; totalLabel: string;
  rows: { name: string; amount: number }[]; count: number; href: string; empty: string;
}) {
  return (
    <Link href={href} className="glass-card px-4 py-3 flex flex-col no-underline hover:border-[var(--primary)] transition">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: color }} />
          <span className="text-[12px] font-semibold text-[var(--text-muted)]">{title}</span>
          <span className="text-[10px] text-[var(--text-dim)] truncate">· {totalLabel}</span>
        </div>
        <span className="text-[17px] leading-none font-extrabold tabular-nums shrink-0" style={{ color }}>{fmtW(total)}</span>
      </div>
      {rows.length === 0 ? (
        <div className="text-[11px] text-[var(--text-dim)] mt-2">{empty}</div>
      ) : (
        <div className="flex flex-col gap-0.5 mt-2">
          {rows.map((r) => (
            <div key={r.name} className="flex justify-between items-center text-[11px]">
              <span className="truncate text-[var(--text-dim)] mr-2">{r.name}</span>
              <span className="tabular-nums text-[var(--text-muted)] shrink-0">{fmtW(r.amount)}</span>
            </div>
          ))}
        </div>
      )}
      <div className="mt-2 text-[11px] font-semibold text-[var(--primary)]">{count}개 전체보기 →</div>
    </Link>
  );
}
