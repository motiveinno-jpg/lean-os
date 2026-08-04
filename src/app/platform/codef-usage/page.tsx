"use client";

// CODEF API 사용량 — 운영자 페이지 정식 메뉴 (2026-08-04)
//   원래 /operator-users 의 탭이었으나 사장님 지시로 /platform 하위로 이동.
//   데이터: operator-user-admin EF mode=codef-usage (운영자 게이트 내장) —
//   codef_usage 원장은 RLS 가 자기 회사 한정이라 클라 직조회 불가.

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

// KST 기준 "YYYY-MM"
const kstMonthNow = () => new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1 + delta, 1)).toISOString().slice(0, 7);
};

type CodefProduct = {
  path: string;
  name: string;
  price: number | null;
  count: number;
  amount: number | null;
  limit: number;
  remaining: number | null;
  over: number | null;
};
type CodefUsage = {
  month: string;
  total: { units: number; calls: number; rows: number };
  byCategory: Record<string, { units: number; calls: number }>;
  companies: { companyId: string; name: string; units: number; calls: number; byCategory: Record<string, number> }[];
  products?: CodefProduct[];
  product_limit?: number;
};
const fmtWon = (n: number) => `₩${n.toLocaleString()}`;
const USAGE_CATEGORY_ORDER = ["통장", "카드", "현금영수증", "세금계산서", "이체", "관리(무과금)", "기타"];

async function fetchUsage(month: string): Promise<CodefUsage> {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("인증 세션이 없습니다");
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const res = await fetch(`${url}/functions/v1/operator-user-admin`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      apikey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    },
    body: JSON.stringify({ mode: "codef-usage", month }),
  });
  const j = await res.json().catch(() => ({}));
  if (!res.ok || j?.error) throw new Error(j?.error || `HTTP ${res.status}`);
  return j as CodefUsage;
}

export default function PlatformCodefUsagePage() {
  const [month, setMonth] = useState(kstMonthNow);
  const [usage, setUsage] = useState<CodefUsage | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError(null);
    fetchUsage(month)
      .then((r) => { if (alive) setUsage(r); })
      .catch((e: any) => { if (alive) { setUsage(null); setError(e?.message || "조회 실패"); } })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [month]);

  return (
    <div className="max-w-[1100px] space-y-4">
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <h1 className="text-xl font-extrabold text-[var(--text)]">CODEF API 사용량</h1>
      </div>

      <div className="codef-usage-panel">
        <div className="codef-usage-month-bar glass-card">
          <button onClick={() => setMonth((m) => shiftMonth(m, -1))} className="codef-usage-month-btn">◀</button>
          <span className="codef-usage-month-label">{month}</span>
          <button
            onClick={() => setMonth((m) => shiftMonth(m, 1))}
            disabled={month >= kstMonthNow()}
            className="codef-usage-month-btn disabled:opacity-30"
          >▶</button>
          <span className="codef-usage-month-hint">
            과금 추정 = 상품 API(/v1/kr/*) 성공 호출 건수 · 계정관리 API는 무과금 · KST 월 기준 · 수집은 2026-07-03부터
          </span>
        </div>

        {loading ? (
          <div className="glass-card p-8 text-center text-sm text-[var(--text-muted)]">사용량 집계 중...</div>
        ) : error ? (
          <div className="glass-card p-8 text-center text-sm text-[var(--danger)]">조회 실패: {error}</div>
        ) : !usage ? (
          <div className="glass-card p-8 text-center text-sm text-[var(--text-muted)]">데이터가 없습니다.</div>
        ) : (
          <>
            {/* 전체 요약 */}
            <div className="codef-usage-summary-grid">
              <div className="codef-usage-stat-card glass-card">
                <div className="codef-usage-stat-label">과금 추정 (units)</div>
                <div className="codef-usage-stat-value text-[var(--primary)]">{usage.total.units.toLocaleString()}</div>
              </div>
              <div className="codef-usage-stat-card glass-card">
                <div className="codef-usage-stat-label">전체 호출</div>
                <div className="codef-usage-stat-value">{usage.total.calls.toLocaleString()}</div>
              </div>
              <div className="codef-usage-stat-card glass-card">
                <div className="codef-usage-stat-label">사용 회사</div>
                <div className="codef-usage-stat-value">{usage.companies.length.toLocaleString()}</div>
              </div>
              <div className="codef-usage-stat-card glass-card">
                <div className="codef-usage-stat-label">원장 기록</div>
                <div className="codef-usage-stat-value">{usage.total.rows.toLocaleString()}</div>
              </div>
            </div>

            {/* API 상품별 한도 현황 — 상품당 월 10만원 포함, 초과분 건당 과금 */}
            <div className="codef-usage-section glass-card">
              <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
                <h3 className="text-sm font-bold">API별 한도 사용 현황</h3>
                <span className="text-[11px] text-[var(--text-dim)]">API(상품)당 월 {fmtWon(usage.product_limit ?? 100000)} 포함 · 초과분은 건당 요금 과금</span>
              </div>
              {(usage.products?.length ?? 0) === 0 ? (
                <div className="text-sm text-[var(--text-muted)] text-center py-4">이 달에는 과금 대상 호출이 없습니다.</div>
              ) : (
                <table className="codef-usage-table">
                  <thead>
                    <tr>
                      <th className="codef-usage-th text-left">API</th>
                      <th className="codef-usage-th text-right">단가</th>
                      <th className="codef-usage-th text-right">성공 건수</th>
                      <th className="codef-usage-th text-right">사용 금액</th>
                      <th className="codef-usage-th text-left codef-quota-col">잔여 한도</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.products!.map((p) => {
                      const pct = p.amount === null ? 0 : Math.min(100, (p.amount / p.limit) * 100);
                      const isOver = (p.over ?? 0) > 0;
                      return (
                        <tr key={p.path}>
                          <td className="codef-usage-td" title={p.path}>{p.name}</td>
                          <td className="codef-usage-td text-right mono-number text-[var(--text-muted)]">{p.price === null ? "미상" : fmtWon(p.price)}</td>
                          <td className="codef-usage-td text-right mono-number">{p.count.toLocaleString()}</td>
                          <td className="codef-usage-td text-right mono-number font-semibold">{p.amount === null ? "—" : fmtWon(p.amount)}</td>
                          <td className="codef-usage-td codef-quota-col">
                            {p.amount === null ? (
                              <span className="text-[11px] text-[var(--text-dim)]">단가 미확인 — 건수만 집계</span>
                            ) : (
                              <div className="codef-quota-cell">
                                <div className="codef-quota-bar">
                                  <div className={`codef-quota-fill ${isOver ? "codef-quota-fill-over" : ""}`} style={{ width: `${pct}%` }} />
                                </div>
                                <span className={`codef-quota-text mono-number ${isOver ? "text-[var(--danger)] font-bold" : ""}`}>
                                  {isOver ? `초과 ${fmtWon(p.over!)}` : `${fmtWon(p.remaining!)} 남음`}
                                </span>
                              </div>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>

            {/* 사용별 (카테고리) */}
            <div className="codef-usage-section glass-card">
              <h3 className="text-sm font-bold mb-3">사용별 API 사용량</h3>
              {Object.keys(usage.byCategory).length === 0 ? (
                <div className="text-sm text-[var(--text-muted)] text-center py-4">이 달에는 CODEF 호출이 없습니다.</div>
              ) : (
                <table className="codef-usage-table">
                  <thead>
                    <tr>
                      <th className="codef-usage-th text-left">구분</th>
                      <th className="codef-usage-th text-right">과금 추정</th>
                      <th className="codef-usage-th text-right">전체 호출</th>
                    </tr>
                  </thead>
                  <tbody>
                    {USAGE_CATEGORY_ORDER.filter((c) => usage.byCategory[c]).map((c) => (
                      <tr key={c}>
                        <td className="codef-usage-td">{c}</td>
                        <td className="codef-usage-td text-right font-semibold mono-number">{usage.byCategory[c].units.toLocaleString()}</td>
                        <td className="codef-usage-td text-right text-[var(--text-muted)] mono-number">{usage.byCategory[c].calls.toLocaleString()}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>

            {/* 회사별 */}
            <div className="codef-usage-section glass-card">
              <h3 className="text-sm font-bold mb-3">회사별 API 사용량</h3>
              {usage.companies.length === 0 ? (
                <div className="text-sm text-[var(--text-muted)] text-center py-4">이 달에는 사용한 회사가 없습니다.</div>
              ) : (
                <table className="codef-usage-table">
                  <thead>
                    <tr>
                      <th className="codef-usage-th text-left">회사</th>
                      <th className="codef-usage-th text-right">과금 추정</th>
                      <th className="codef-usage-th text-right">전체 호출</th>
                      <th className="codef-usage-th text-left">과금 내역</th>
                    </tr>
                  </thead>
                  <tbody>
                    {usage.companies.map((c) => (
                      <tr key={c.companyId}>
                        <td className="codef-usage-td font-medium">{c.name}</td>
                        <td className="codef-usage-td text-right font-semibold mono-number">{c.units.toLocaleString()}</td>
                        <td className="codef-usage-td text-right text-[var(--text-muted)] mono-number">{c.calls.toLocaleString()}</td>
                        <td className="codef-usage-td">
                          <div className="codef-usage-cat-tags">
                            {USAGE_CATEGORY_ORDER.filter((k) => c.byCategory[k]).map((k) => (
                              <span key={k} className="codef-usage-cat-tag">
                                {k} <b>{c.byCategory[k].toLocaleString()}</b>
                              </span>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
