"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import ByPersonChart from "./by-person-chart";

/* ------------------------------------------------------------------ */
/*  회계 › 인원별 지출                                                  */
/*  직원(법인카드 소유자) 기준 카드 사용액 + 급여 합산.                  */
/*  새 테이블 신설 없이 기존 쿼리(card_transactions / corporate_cards / */
/*  card_aliases / employees / payslip_overrides)만 클라이언트 집계.    */
/*  단일 회사 데이터량 기준 — 서버 RPC/뷰 불필요.                       */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

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
  const start = `${year}-01-01`;
  const end = `${year}-12-31`;

  const [cardTxRes, cardsRes, aliasRes, empRes, overrideRes] = await Promise.all([
    db.from("card_transactions")
      .select("card_name, amount, transaction_date")
      .eq("company_id", companyId)
      .gte("transaction_date", start)
      .lte("transaction_date", end)
      .limit(50000),
    db.from("corporate_cards")
      .select("card_name, holder_name")
      .eq("company_id", companyId),
    db.from("card_aliases")
      .select("source_card_name, alias")
      .eq("company_id", companyId),
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

  // card_name → 표시 라벨
  const holderByCard = new Map<string, string>();
  for (const c of cardsRes.data || []) {
    if (c.card_name && c.holder_name) holderByCard.set(c.card_name, String(c.holder_name).trim());
  }
  const aliasByCard = new Map<string, string>();
  for (const a of aliasRes.data || []) {
    if (a.source_card_name && a.alias) aliasByCard.set(a.source_card_name, String(a.alias).trim());
  }
  const labelForCard = (cardName: string | null): string => {
    if (!cardName) return "미지정 카드";
    return holderByCard.get(cardName) || aliasByCard.get(cardName) || cardName;
  };

  // 직원: id → name, 그리고 name 기준 정규화 맵 (카드 소유자명과 매칭)
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

  // ── 카드 사용액 ── (취소/환불은 음수 → 절댓값 합산 X, 순지출 = 부호 그대로 합)
  for (const tx of cardTxRes.data || []) {
    const m = String(tx.transaction_date || "").slice(0, 7);
    if (!m || !m.startsWith(String(year))) continue;
    const label = labelForCard(tx.card_name);
    const r = ensure(label);
    const amt = Number(tx.amount || 0);
    r.cardSpend += amt;
    bucket(r, m).card += amt;
  }

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
  const blocked = role === "employee" || role === "partner";

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
    return (
      <div className="flex items-center justify-center min-h-[60vh] text-[var(--text-muted)]">
        <div className="text-center">
          <p className="text-lg font-medium">접근 권한이 없습니다</p>
          <p className="text-sm mt-1">관리자에게 문의하세요</p>
        </div>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px 28px", maxWidth: 1100 }}>
      <Link href="/reports" className="no-print" style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "var(--text-muted)", textDecoration: "none", marginBottom: 14 }}>
        ← 분석 허브
      </Link>
      {/* V3: 스크롤해도 제목 상단 고정 (sticky) */}
      <div style={{ position: "sticky", top: 0, zIndex: 10, background: "var(--bg)", display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 20, paddingTop: 8, paddingBottom: 12, borderBottom: "1px solid var(--border)", flexWrap: "wrap" }}>
        <div>
          <h1 style={{ fontSize: 22, fontWeight: 700, color: "var(--text)", margin: 0, lineHeight: 1.3 }}>
            인원별 지출
          </h1>
          <p style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 6 }}>
            직원(법인카드 소유자)별로 카드 사용액과 급여를 합산해 인당 비용을 봅니다.
          </p>
        </div>
        <select
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
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
        <div style={{ padding: "60px 0", textAlign: "center", color: "var(--text-dim)", fontSize: 13 }}>
          {year}년 집계할 카드 사용액·급여 데이터가 없습니다.
        </div>
      )}

      {!isLoading && !error && rows && rows.length > 0 && (
        <>
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: 14, marginBottom: 22 }}>
            {[
              { label: `${year}년 카드 사용액`, value: totals.card, color: "#8b5cf6", hint: "법인카드 소유자별 사용액 합계" },
              { label: `${year}년 급여 합계`, value: totals.pay, color: "#f97316", hint: "명세서 기준(없으면 기본급여 추정)" },
              { label: `${year}년 인건 관련 총비용`, value: totals.total, color: "var(--primary)", hint: "카드 + 급여" },
            ].map((c) => (
              <div key={c.label} style={{ padding: "16px 18px", borderRadius: 12, border: "1px solid var(--border)", background: "var(--bg-card)" }}>
                <div style={{ fontSize: 12, color: "var(--text-dim)" }}>{c.label}</div>
                <div style={{ fontSize: 22, fontWeight: 700, color: c.color, marginTop: 6 }}>
                  {fmtKrw(c.value)}<span style={{ fontSize: 13, fontWeight: 500, color: "var(--text-dim)", marginLeft: 3 }}>원</span>
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 5, lineHeight: 1.5 }}>{c.hint}</div>
              </div>
            ))}
          </div>

          <ByPersonChart
            people={rows.map((r) => r.key)}
            cardByPerson={Object.fromEntries(rows.map((r) => [r.key, r.cardSpend]))}
            payByPerson={Object.fromEntries(rows.map((r) => [r.key, r.payroll]))}
          />

          {/* 인원별 합계 표 */}
          <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid var(--border)", marginTop: 20 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13, minWidth: 560 }}>
              <thead>
                <tr style={{ background: "var(--bg-surface)" }}>
                  <th style={{ textAlign: "left", padding: "12px 16px", color: "var(--text-muted)", fontWeight: 600 }}>인원</th>
                  <th style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-muted)", fontWeight: 600 }}>카드 사용액</th>
                  <th style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-muted)", fontWeight: 600 }}>급여</th>
                  <th style={{ textAlign: "right", padding: "12px 16px", color: "var(--text-muted)", fontWeight: 600 }}>합계</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} style={{ borderTop: "1px solid var(--border)" }}>
                    <td style={{ padding: "11px 16px", color: "var(--text)" }}>
                      {r.key}
                      {!r.hasEmployee && (
                        <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 6, background: "var(--bg-surface)", color: "var(--text-dim)", border: "1px solid var(--border)" }}>
                          카드만
                        </span>
                      )}
                    </td>
                    <td style={{ padding: "11px 16px", textAlign: "right", color: "#8b5cf6", fontWeight: 600 }}>{fmtKrw(r.cardSpend)}</td>
                    <td style={{ padding: "11px 16px", textAlign: "right", color: "#f97316", fontWeight: 600 }}>{fmtKrw(r.payroll)}</td>
                    <td style={{ padding: "11px 16px", textAlign: "right", color: "var(--text)", fontWeight: 700 }}>{fmtKrw(r.total)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: "2px solid var(--border)", background: "var(--bg-surface)" }}>
                  <td style={{ padding: "12px 16px", fontWeight: 700, color: "var(--text)" }}>합계</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#8b5cf6" }}>{fmtKrw(totals.card)}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "#f97316" }}>{fmtKrw(totals.pay)}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right", fontWeight: 700, color: "var(--text)" }}>{fmtKrw(totals.total)}</td>
                </tr>
              </tfoot>
            </table>
          </div>

          {/* 월추이 표 (인원 x 월, 카드+급여 합) */}
          <div style={{ marginTop: 24 }}>
            <h3 style={{ fontSize: 14, fontWeight: 700, color: "var(--text)", marginBottom: 10 }}>월별 추이 (인원별 카드+급여 합)</h3>
            <div style={{ overflowX: "auto", borderRadius: 12, border: "1px solid var(--border)" }}>
              <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12.5, minWidth: 760 }}>
                <thead>
                  <tr style={{ background: "var(--bg-surface)" }}>
                    <th style={{ textAlign: "left", padding: "10px 14px", color: "var(--text-muted)", fontWeight: 600, position: "sticky", left: 0, background: "var(--bg-surface)" }}>인원</th>
                    {months.map((m) => (
                      <th key={m} style={{ textAlign: "right", padding: "10px 14px", color: "var(--text-muted)", fontWeight: 600, whiteSpace: "nowrap" }}>{monthLabel(m)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key} style={{ borderTop: "1px solid var(--border)" }}>
                      <td style={{ padding: "9px 14px", color: "var(--text)", whiteSpace: "nowrap", position: "sticky", left: 0, background: "var(--bg-card)" }}>{r.key}</td>
                      {months.map((m) => {
                        const b = r.byMonth[m];
                        const v = b ? b.card + b.pay : 0;
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

          <div
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
            - 카드 사용액은 법인카드의 소유자명(카드 설정의 소유자 또는 별명)을 기준으로 합산합니다.
            <br />
            - 급여는 월별 명세서 값이 있으면 그 값을, 없으면 직원 기본 월급여를 추정치로 사용합니다(미래 월 제외).
            <br />
            - &lsquo;카드만&rsquo; 표시는 직원으로 매칭되지 않은 카드(예: 대표·공용카드)입니다. 카드 소유자명을 직원 이름과 동일하게 맞추면 자동 합산됩니다.
          </div>
        </>
      )}
    </div>
  );
}
