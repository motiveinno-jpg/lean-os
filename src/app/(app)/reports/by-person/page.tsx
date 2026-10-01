"use client";

import { useEffect, useState, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { getCurrentUser } from "@/lib/queries";
import { useUser } from "@/components/user-context";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied }  from "@/components/access-denied";
import ByPersonChart from "./by-person-chart";
import { ReportHead, ReportYearSelect } from "../_components/ReportHead";
import { Stat } from "@/components/query-kit";
import { exportToExcel } from "@/lib/excel-export";

/* ------------------------------------------------------------------ */
/*  회계 › 인원별 지출                                                  */
/*  직원(법인카드 소유자) 기준 카드 사용액 + 급여 합산.                  */
/*  새 테이블 신설 없이 기존 쿼리(card_transactions / corporate_cards / */
/*  card_aliases / employees / payslip_overrides)만 클라이언트 집계.    */
/*  단일 회사 데이터량 기준 · 서버 RPC/뷰 불필요.                       */
/* ------------------------------------------------------------------ */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase;

interface PersonRow  {
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
   1순위: corporate_cards.holder_name (대표 직접 입력한 소유자)
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
  
  // override 없는 월은 직원 기본 월급여로 추정 (지난 달까지만 · 미래월 추정 제외)
  const nowYM = `${YEAR_NOW}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  for (const [empId, emp] of empById) {
    if (!emp.name || emp.salary <= 0) continue;
    for (const m of months) {
      if (m > nowYM) continue;
      if (overrideKey.has(`${empId}|${m}`)) continue;
      // R1: 입사월 이전 / 계약종료월 이후는 재직 안 한 달 → 급여 산입 제외.
      //   (hire_date·contract_end_date 미설정 시 종전 동작 유지 · 회귀 방지)
      if (emp.hireMonth && m  < emp.hireMonth) continue;
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
  const { role }  = useUser();
  // 급여 명단·개인별 월급 매트릭스가 있는 화면 · 급여 권한자만.
  //   종전 게이트(role==='partner')는 employee/advisor 를 못 막아 /reports 권한만으로
  //   전 직원 급여 랭킹이 노출됐다.
  const  { hasPerm, isMaster } = useMyPermissions();
  const blocked = role === "partner" || role === "advisor" || !(isMaster || hasPerm("/employees:salary"));

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

  //   엑셀 — 아래 '월별 급여 추이' 표 그대로(인원 × 월) + 연 합계
  const exportXlsx = () => {
    if (!rows) return;
    exportToExcel(rows.map((r) => ({
      "인원": r.key,
      ...Object.fromEntries(months.map((m) => [monthLabel(m), Math.round(r.byMonth[m]?.pay || 0)])),
      "합계": Math.round(r.payroll),
    })), "인원별 급여", `인원별급여_${year}`);
  };

  if (blocked) {
    return <AccessDenied detail="인별 리포트는 회사 구성원 전용입니다 (외부 파트너 제외)." />;
  }

  return (
    <div>
      {/* 조회 줄(연도 ‖ 엑셀·인쇄)과 핵심 지표는 다른 회계 자료 탭과 같이 상자 머리에 — 예전엔 본문 첫 줄에 자체 셀렉트·지표 카드가 있어 탭마다 자리가 달랐다 */}
      <ReportHead
        bar={<ReportYearSelect value={year} onChange={setYear} years={[YEAR_NOW, YEAR_NOW - 1, YEAR_NOW - 2]} />}
        excel={rows && rows.length > 0 ? [{ label: `${year}년 인원별 월 급여`, count: rows.length, onClick: exportXlsx }] : []}
        print
        stats={!isLoading && !error && rows && rows.length > 0 ? <>
          <Stat label={`${year}년 급여 합계`} value={`₩${fmtKrw(totals.pay)}`} title="명세서 값, 없으면 기본 월급여 추정" />
          <Stat label="인원 수" value={`${rows.length}명`} title="급여 집계 인원" />
          <Stat label="1인 평균" value={`₩${fmtKrw(Math.round(totals.pay / Math.max(rows.length, 1)))}`} title="합계 ÷ 인원" />
        </> : undefined}
      />

      {/*   2026-10-01 UI 점검 9순위: glass-card 랭크 바 목록 → 표, 판 → 분석 판(pnl-panel), 인라인 style → 클래스, 이모지 빈 상태 → 글 */}
      {isLoading && <div className="collect-empty">불러오는 중…</div>}

      {error && !isLoading && <div className="collect-empty">{error}</div>}

      {!isLoading && !error && rows && rows.length === 0 && (
        <div className="collect-empty">{year}년 집계할 급여 데이터가 없습니다. 급여를 등록한 직원부터 집계됩니다.</div>
      )}

      {!isLoading && !error && rows && rows.length > 0 && (
        <>
          <ByPersonChart
            people={rows.map((r) => r.key)}
            payByPerson={Object.fromEntries(rows.map((r) => [r.key, r.payroll]))}
          />

          {/* 인원별 급여 명단 — 많이 받는 순 표 (막대는 비중 칸 안에만) */}
          <div className="by-person-ranked-list pnl-panel">
            <h3>인원별 급여 명단</h3>
            <table className="ev-table ev-lined by-person-rank-table">
              <thead>
                <tr>
                  <th>순위</th>
                  <th>인원</th>
                  <th>{year}년 급여</th>
                  <th>비중</th>
                </tr>
              </thead>
              <tbody>
                {(() => {
                  const ranked = [...rows].sort((a, b) => b.payroll - a.payroll);
                  const maxPay = ranked.length ? ranked[0].payroll : 0;
                  return ranked.map((r, i) => {
                    const share = totals.pay > 0 ? (r.payroll / totals.pay) * 100 : 0;
                    const barPct = maxPay > 0 ? (r.payroll / maxPay) * 100 : 0;
                    return (
                      <tr key={r.key}>
                        <td className="by-person-rank mono-number">{i + 1}</td>
                        <td className="by-person-name">{r.key}</td>
                        <td className="by-person-num mono-number">₩{fmtKrw(r.payroll)}</td>
                        <td>
                          <div className="by-person-share">
                            <div className="by-person-share-track">
                              <div className="by-person-share-fill" style={{ width: `${Math.min(barPct, 100)}%` }} />
                            </div>
                            <span className="by-person-share-pct mono-number">{share.toFixed(1)}%</span>
                          </div>
                        </td>
                      </tr>
                    );
                  });
                })()}
              </tbody>
              <tfoot>
                <tr className="by-person-total-row">
                  <td />
                  <td className="by-person-name">합계 · {rows.length}명</td>
                  <td className="by-person-num mono-number">₩{fmtKrw(totals.pay)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
          </div>

          {/* 월추이 표 (인원 x 월) — 분석 판 안 공용 표 */}
          <div className="by-person-monthly-trend pnl-panel">
            <h3>월별 급여 추이</h3>
            <div className="by-person-monthly-trend-scroll">
              <table className="ev-table ev-lined by-person-monthly-table">
                <thead>
                  <tr>
                    <th className="by-person-sticky-col">인원</th>
                    {months.map((m) => (
                      <th key={m}>{monthLabel(m)}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.key}>
                      <td className="by-person-name by-person-sticky-col">{r.key}</td>
                      {months.map((m) => {
                        const b = r.byMonth[m];
                        const v = b ? b.pay : 0;
                        return (
                          <td key={m} className={v ? "by-person-num" : "by-person-num by-person-zero"}>
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

          <div className="by-person-note">
            <strong>참고</strong>
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
