"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { AccessDenied } from "@/components/access-denied";
import ByPersonChart from "./by-person-chart";

/* ------------------------------------------------------------------ */
/*  회계 › 인원별 지출                                                  */
/*  직원(법인카드 소유자) 기준 카드 사용액 + 급여 합산.                  */
/*  새 테이블 신설 없이 기존 쿼리(card_transactions / corporate_cards / */
/*  card_aliases / employees / payslip_overrides)만 클라이언트 집계.    */
/*  단일 회사 데이터량 기준 — 서버 RPC/뷰 불필요.                       */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

interface PersonRow {
  key: string;          // 표시명 (직원명 또는 카드 별명)
  cardSpend: number;
  payroll: number;
  total: number;
  byMonth: Record<string, { card: number; pay: number }>; // 'YYYY-MM'
  hasEmployee: boolean; // 급여 매칭된 실제 직원인지
}

function fmtKrw(value: number): string {
  if (!value) return "-";
  const abs = Math.abs(Math.round(value));
  return (value < 0 ? "(" : "") + abs.toLocaleString("ko-KR") + (value < 0 ? ")" : "");
}

function monthLabel(m: string): string {
  return `${parseInt(m.split("-")[1], 10)}월`;
}

const YEAR_NOW = new Date().getFullYear();

function monthRange(year: number): string[] {
  return Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, "0")}`);
}

/* 카드명 → 사람 라벨 해석.
   1순위: corporate_cards.holder_name (사장님이 직접 입력한 소유자)
   2순위: card_aliases.alias (카드에 붙인 별명)
   3순위: 원본 card_name */
async function loadByPerson(companyId: string, year: number): Promise<PersonRow[]> {
  const months = monthRange(year);

  // 급여만 집계 — 카드 사용액 제외 (사용자 요청 2026-05-27).
  const [empRes, overrideRes] = await Promise.all([
    db.from("employees")
      .select("id, name, salary, status, hire_date, contract_end_date")
      .eq("company_id", companyId)
      .in("status", ["active", "joined", "invited"]),
    db.from("payslip_overrides")
      .select("employee_id, period_month, base_salary")
      .eq("company_id", companyId)
      .gte("period_month", months[0])
      .lte("period_month", months[11]),
  ]);

  // 직원: id → name, 그리고 name 기준 정규화 맵
  // R1: 재직 기간 밖(입사 전·계약종료 후) 월에 급여가 추정 합산되던 버그 →
  //   hireMonth/endMonth 를 함께 보관해 추정 루프에서 기간 필터.
  const empById = new Map<string, { name: string; salary: number; hireMonth: string | null; endMonth: string | null }>();
  const empNames = new Set<string>();
  for (const e of empRes.data || []) {
    const hireMonth = e.hire_date ? String(e.hire_date).slice(0, 7) : null;
    const endMonth = e.contract_end_date ? String(e.contract_end_date).slice(0, 7) : null;
    empById.set(e.id, { name: String(e.name || "").trim(), salary: Number(e.salary || 0), hireMonth, endMonth });
    if (e.name) empNames.add(String(e.name).trim());
  }

  const rows = new Map<string, PersonRow>();
  const ensure = (key: string): PersonRow => {
    let r = rows.get(key);
    if (!r) {
      r = { key, cardSpend: 0, payroll: 0, total: 0, byMonth: {}, hasEmployee: empNames.has(key) };
      rows.set(key, r);
    }
    return r;
  };
  const bucket = (r: PersonRow, m: string) => {
    if (!r.byMonth[m]) r.byMonth[m] = { card: 0, pay: 0 };
    return r.byMonth[m];
  };

  // ── 급여 ── (payslip_overrides 우선, 없으면 직원 기본 salary 를 해당월 추정치로)
  // override 가 있는 (직원,월) 조합 기록
  const overrideKey = new Set<string>();
  for (const o of overrideRes.data || []) {
    const m = String(o.period_month || "").slice(0, 7);
    if (!m) continue;
    const emp = empById.get(o.employee_id);
    if (!emp || !emp.name) continue;
    overrideKey.add(`${o.employee_id}|${m}`);
    const r = ensure(emp.name);
    r.hasEmployee = true;
    const amt = Number(o.base_salary || 0);
    r.payroll += amt;
    bucket(r, m).pay += amt;
  }
  // override 없는 월은 직원 기본 월급여로 추정 (지난 달까지만 — 미래월 추정 제외)
  const nowYM = `${YEAR_NOW}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  for (const [empId, emp] of empById) {
    if (!emp.name || emp.salary <= 0) continue;
    for (const m of months) {
      if (m > nowYM) continue;
      if (overrideKey.has(`${empId}|${m}`)) continue;
      // R1: 입사월 이전 / 계약종료월 이후는 재직 안 한 달 → 급여 산입 제외.
      //   (hire_date·contract_end_date 미설정 시 종전 동작 유지 — 회귀 방지)
      if (emp.hireMonth && m < emp.hireMonth) continue;
      if (emp.endMonth && m > emp.endMonth) continue;
      const r = ensure(emp.name);
      r.hasEmployee = true;
      r.payroll += emp.salary;
      bucket(r, m).pay += emp.salary;
    }
  }

  for (const r of rows.values()) r.total = r.cardSpend + r.payroll;
  return Array.from(rows.values()).sort((a, b) => b.total - a.total);
}

export default function ByPersonPage() {
  const { role } = useUser();
  const blocked = role === "partner";

  const [companyId, setCompanyId] = useState<string | null>(null);
  const [year, setYear] = useState(YEAR_NOW);
  const [rows, setRows] = useState<PersonRow[] | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (blocked) return;
    getCurrentUser().then((u) => {
      if (u) setCompanyId(u.company_id);
      else setIsLoading(false);
    });
  }, [blocked]);

  useEffect(() => {
    if (blocked || !companyId) return;
    setIsLoading(true);
    setError(null);
    loadByPerson(companyId, year)
      .then(setRows)
      .catch((e) => setError(e?.message || "데이터를 불러오지 못했습니다"))
      .finally(() => setIsLoading(false));
  }, [companyId, year, blocked]);

  const months = useMemo(() => monthRange(year), [year]);
  const totals = useMemo(() => {
    if (!rows) return { card: 0, pay: 0, total: 0 };
    return {
      card: rows.reduce((s, r) => s + r.cardSpend, 0),
      pay: rows.reduce((s, r) => s + r.payroll, 0),
      total: rows.reduce((s, r) => s + r.total, 0),
    };
  }, [rows]);

  if (blocked) {
    return <AccessDenied detail="인별 리포트는 대표·관리자 전용입니다." />;
  }

  return (
    <div>
      {/* 툴바 — 연도 필터. 페이지 타이틀은 공통 헤더바가 표시 (2026-07-03 라운드6.5) */}
      <div className="by-person-toolbar page-sticky-header">
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          className="by-person-year-select"
          style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--bg-card)", color: "var(--text)", fontSize: 13 }}
        >
          {[YEAR_NOW, YEAR_NOW - 1, YEAR_NOW - 2].map((y) => (
            <option key={y} value={y}>{y}년</option>
          ))}
        </select>
      </div>

      {isLoading && (
        <div style={{ padding: "60px 0", textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>불러오는 중…</div>
      )}

      {error && !isLoading && (
        <div style={{ padding: "16px", borderRadius: 8, background: "var(--bg-surface)", border: "1px solid var(--border)", color: "var(--text-muted)", fontSize: 13 }}>
          {error}
        </div>
      )}

      {!isLoading && !error && rows && rows.length === 0 && (
        <div className="by-person-empty-state">
          <div className="text-4xl mb-3">👥</div>
          <div className="text-sm font-semibold text-[var(--text)]">{year}년 집계할 급여 데이터가 없습니다.</div>
          <div className="text-xs text-[var(--text-dim)] mt-1.5">직원 등록 후 급여(기본급여 또는 명세서)가 있으면 자동 집계됩니다.</div>
        </div>
      )}

      {!isLoading && !error && rows && rows.length > 0 && (
        <>
          {/* 스탯 3카드 — 대시보드 글래스카드 (2026-06-10) */}
          <div className="by-person-stat-cards" style={{ marginBottom: 24 }}>
            {[
              { label: `${year}년 급여 합계`, big: `₩${fmtKrw(totals.pay)}`, color: "var(--warning)", hint: "명세서/기본급여 추정" },
              { label: "인원 수", big: `${rows.length}명`, color: "var(--primary)", hint: "급여 집계 인원" },
              { label: "1인 평균", big: `₩${fmtKrw(Math.round(totals.pay / Math.max(rows.length, 1)))}`, color: "var(--success)", hint: "합계 ÷ 인원" },
            ].map((c) => (
              <div key={c.label} className="by-person-stat-tile stat-tile">
                <div className="stat-tile-label">{c.label}</div>
                <div className="stat-tile-value mono-number truncate" style={{ color: c.color }}>{c.big}</div>
                <div className="text-[10px] text-[var(--text-dim)] truncate">{c.hint}</div>
              </div>
            ))}
          </div>

          <ByPersonChart
            people={rows.map((r) => r.key)}
            payByPerson={Object.fromEntries(rows.map((r) => [r.key, r.payroll]))}
          />

          {/* 인원별 급여 — 아바타 랭크 바 리스트 (2026-06-10 리디자인) */}
          <div className="by-person-ranked-list glass-card" style={{ marginTop: 24 }}>
            <div className="by-person-ranked-list-header" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)", fontSize: 14, fontWeight: 700, color: "var(--text)" }}>인원별 급여 명단</div>
            {(() => {
              const ranked = [...rows].sort((a, b) => b.payroll - a.payroll);
              const maxPay = ranked.length ? ranked[0].payroll : 0;
              const AVA = ["from-indigo-500 to-violet-500", "from-emerald-500 to-teal-500", "from-orange-500 to-amber-500", "from-rose-500 to-pink-500", "from-sky-500 to-cyan-500", "from-fuchsia-500 to-purple-500"];
              return ranked.map((r, i) => {
                const share = totals.pay > 0 ? (r.payroll / totals.pay) * 100 : 0;
                const barPct = maxPay > 0 ? (r.payroll / maxPay) * 100 : 0;
                return (
                  <div key={r.key} className="by-person-row" style={{ padding: "12px 18px", borderTop: i === 0 ? "none" : "1px solid color-mix(in srgb, var(--border) 55%, transparent)" }}>
                    <span className="mono-number" style={{ fontSize: 11, color: "var(--text-dim)", width: 16, textAlign: "center", flexShrink: 0 }}>{i + 1}</span>
                    <span className={`by-person-avatar ${AVA[i % AVA.length]}`} style={{ width: 36, height: 36, borderRadius: 999, display: "flex", alignItems: "center", justifyContent: "center", color: "#fff", fontSize: 14, fontWeight: 700 }}>{(r.key || "?").slice(0, 1)}</span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div className="flex items-center justify-between" style={{ gap: 8, marginBottom: 6 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--text)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.key}</span>
                        <span className="mono-number shrink-0" style={{ fontSize: 14, fontWeight: 700, color: "var(--warning)" }}>₩{fmtKrw(r.payroll)}</span>
                      </div>
                      <div className="flex items-center" style={{ gap: 10 }}>
                        <div style={{ flex: 1, height: 6, borderRadius: 999, background: "var(--bg-surface)", overflow: "hidden" }}>
                          <div style={{ height: "100%", borderRadius: 999, width: `${Math.min(barPct, 100)}%`, background: "var(--warning)" }} />
                        </div>
                        <span className="mono-number shrink-0" style={{ fontSize: 10, color: "var(--text-dim)", width: 40, textAlign: "right" }}>{share.toFixed(1)}%</span>
                      </div>
                    </div>
                  </div>
                );
              });
            })()}
            <div className="by-person-ranked-list-footer" style={{ padding: "12px 18px", borderTop: "1px solid var(--border)", background: "color-mix(in srgb, var(--bg-surface) 50%, transparent)" }}>
              <span style={{ fontSize: 14, fontWeight: 700, color: "var(--text)" }}>합계 · {rows.length}명</span>
              <span className="mono-number" style={{ fontSize: 14, fontWeight: 800, color: "var(--warning)" }}>₩{fmtKrw(totals.pay)}</span>
            </div>
          </div>

          {/* 월추이 표 (인원 x 월, 카드+급여 합) — 섹션 제목을 카드 안 헤더로 흡수 (2026-07-03 라운드6.5) */}
          <div className="by-person-monthly-trend">
            <div className="by-person-monthly-trend-card glass-card">
              <div className="by-person-monthly-trend-header" style={{ padding: "14px 18px", borderBottom: "1px solid var(--border)" }}>
                <h3 className="m-0 text-sm font-bold text-[var(--text)]">월별 급여 추이</h3>
              </div>
              <div className="by-person-monthly-trend-scroll">
              <table className="by-person-monthly-table" style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 760 }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--border)" }}>
                    <th style={{ textAlign: "left", padding: "10px 14px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600, position: "sticky", left: 0, background: "var(--bg-card)" }}>인원</th>
                    {months.map((m) => (
                      <th key={m} style={{ textAlign: "right", padding: "10px 14px", color: "var(--text-dim)", fontSize: 12, fontWeight: 600, whiteSpace: "nowrap" }}>{monthLabel(m)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} className="hover:bg-[var(--bg-surface)]/60 transition" style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "9px 14px", color: "var(--text)", whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--bg-card)" }}>{r.key}</td>
                      {months.map((m) => {
                        const b = r.byMonth[m];
                        const v = b ? b.pay : 0;
                        return (
                          <td key={m} style={{ padding: "9px 14px", textAlign: "right", color: v ? "var(--text)" : "var(--text-dim)" }}>
                            {fmtKrw(v)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
              </div>
            </div>
          </div>

          <div
            className="by-person-note"
            style={{
              marginTop: 16,
              padding: "12px 16px",
              borderRadius: 8,
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              fontSize: 12,
              color: "var(--text-dim)",
              lineHeight: 1.6,
            }}
          >
            <strong style={{ color: "var(--text-muted)" }}>참고</strong>
            <br />
            - 급여는 월별 명세서 값이 있으면 그 값을, 없으면 직원 기본 월급여를 추정치로 사용합니다(미래 월 제외).
            <br />
            - 재직 기간(입사월~계약종료월) 밖의 달은 급여에 산입하지 않습니다.
          </div>
        </>
      )}
    </div>
  );
}
