"use client";

// 세무사 포털 — 고객사 상세 (통장을 펼친 지면, 2026-08-11)
//   개요(계좌·매출입·부가세·인건비 요약) / 세금계산서 / 통장 거래 / 인건비 탭.
//   데이터는 전부 advisor_* SECURITY DEFINER RPC — 연결이 해제되면 즉시 차단된다.

import { use, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";

const won = (n: number | null | undefined) => `${Math.round(Number(n) || 0).toLocaleString("ko-KR")}원`;
const d10 = (s: string | null | undefined) => String(s || "").slice(0, 10);

// CSV 다운로드 (2026-08-11 사장님: 세무사가 세무 프로그램에 넣을 자료) — UTF-8 BOM 으로 엑셀 한글 안전.
function downloadCsv(filename: string, rows: Record<string, string | number | null | undefined>[]) {
  if (rows.length === 0) return;
  const headers = Object.keys(rows[0]);
  const esc = (v: unknown) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = "﻿" + [headers.join(","), ...rows.map((r) => headers.map((h) => esc(r[h])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

type Overview = {
  company: { id: string; name: string; industry: string | null; business_number: string | null;
    representative: string | null; business_type: string | null; business_category: string | null; address: string | null };
  bank: { total: number; accounts: { bank: string; number: string; balance: number }[] };
  month: { sales: number; purchase: number };
  prev_month: { sales: number; purchase: number };
  quarter_vat: { sales_tax: number; purchase_tax: number };
  receivable: number;
  employees: { count: number; last_payroll_month: string | null; last_payroll_total: number };
  card_month_total: number;
};

const TABS = [
  { key: "overview", label: "개요" },
  { key: "invoices", label: "세금계산서" },
  { key: "bank", label: "통장 거래" },
  { key: "payroll", label: "인건비" },
] as const;
type TabKey = (typeof TABS)[number]["key"];

export default function AdvisorCompanyPage({ params }: { params: Promise<{ companyId: string }> }) {
  const { companyId } = use(params);
  const router = useRouter();
  const [tab, setTab] = useState<TabKey>("overview");
  // 세무사 확인 후에만 RPC 발화 — 대시보드와 같은 게이트. 이 페이지는 확인 없이
  //   overview 를 바로 불러 비세무사 접속마다 not_advisor 로그가 쌓였다 (2026-08-12)
  const [advisorReady, setAdvisorReady] = useState(false);
  useEffect(() => {
    (async () => {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) { router.replace("/advisor"); return; }
      const { data } = await (supabase as any)
        .from("tax_advisors").select("status").eq("auth_id", session.user.id).maybeSingle();
      if (!data || data.status !== "active") { router.replace("/advisor"); return; }
      setAdvisorReady(true);
    })();
  }, [router]);

  const { data: ov, isLoading, error } = useQuery<Overview>({
    queryKey: ["advisor-overview", companyId],
    queryFn: async () => {
      const { data, error: err } = await (supabase as any).rpc("advisor_company_overview", { p_company_id: companyId });
      if (err) throw err;
      return data as Overview;
    },
    staleTime: 60_000,
    retry: false,
    enabled: advisorReady,
  });

  const logout = async () => {
    await supabase.auth.signOut({ scope: "local" });
    router.replace("/advisor");
  };

  if (error) {
    return (
      <div className="min-h-dvh">
        <PortalTopbar onLogout={logout} />
        <div className="adv-notice">
          <div className="adv-notice-stamp">열람 불가</div>
          <div className="adv-notice-title">이 회사를 볼 수 없습니다</div>
          <p className="adv-notice-desc">연결이 해제되었거나 권한이 없습니다. 대시보드에서 담당 고객사를 확인해 주세요.</p>
          <button className="adv-btn-primary" onClick={() => router.replace("/advisor/dashboard")}>대시보드로</button>
        </div>
      </div>
    );
  }

  const vatEst = (Number(ov?.quarter_vat.sales_tax) || 0) - (Number(ov?.quarter_vat.purchase_tax) || 0);

  return (
    <div className="min-h-dvh">
      <PortalTopbar onLogout={logout} />
      <main className="adv-shell">
        <button className="adv-back" onClick={() => router.push("/advisor/dashboard")}>← 담당 고객사</button>

        {isLoading || !ov ? (
          <div className="adv-loading">장부를 펼치는 중…</div>
        ) : (
          <>
            <div className="adv-company-head">
              <h1 className="adv-company-name">{ov.company.name}</h1>
              <span className="adv-company-meta">
                {ov.company.business_number || "사업자번호 미등록"}
                {ov.company.representative ? ` · 대표 ${ov.company.representative}` : ""}
                {ov.company.business_type ? ` · ${ov.company.business_type}` : ""}
                {ov.company.business_category ? `/${ov.company.business_category}` : ""}
              </span>
              {/* 오너뷰 본앱 진입 (2026-08-11 사장님) — 읽기 전용 세션으로 이 회사의 실제 오너뷰를 연다 */}
              <button
                className="adv-enter-app-btn adv-enter-app-btn-head"
                onClick={async () => {
                  const { error: err } = await (supabase as any).rpc("advisor_enter_company", { p_company_id: companyId });
                  if (!err) window.location.href = "/dashboard";
                }}
              >
                오너뷰로 열람 →
              </button>
            </div>

            <div className="adv-statband">
              <div>
                <div className="adv-stat-label">통장 잔고 합계</div>
                <div className="adv-stat-value">{won(ov.bank.total)}</div>
                <div className="adv-stat-sub">계좌 {ov.bank.accounts.length}개</div>
              </div>
              <div>
                <div className="adv-stat-label">이번 달 매출</div>
                <div className="adv-stat-value">{won(ov.month.sales)}</div>
                <div className="adv-stat-sub">지난달 {won(ov.prev_month.sales)}</div>
              </div>
              <div>
                <div className="adv-stat-label">이번 달 매입</div>
                <div className="adv-stat-value">{won(ov.month.purchase)}</div>
                <div className="adv-stat-sub">지난달 {won(ov.prev_month.purchase)}</div>
              </div>
              <div>
                <div className="adv-stat-label">분기 부가세 추정</div>
                <div className="adv-stat-value">{won(vatEst)}</div>
                <div className="adv-stat-sub">매출세액 − 매입세액</div>
              </div>
              <div>
                <div className="adv-stat-label">미수 채권</div>
                <div className="adv-stat-value">{won(ov.receivable)}</div>
                <div className="adv-stat-sub">발행 후 미정산 매출</div>
              </div>
            </div>

            <div className="adv-tabs">
              {TABS.map((t) => (
                <button key={t.key} className={`adv-tab ${tab === t.key ? "adv-tab-on" : ""}`} onClick={() => setTab(t.key)}>
                  {t.label}
                </button>
              ))}
            </div>
            <div className="adv-panel">
              {tab === "overview" && <OverviewTab ov={ov} />}
              {tab === "invoices" && <InvoicesTab companyId={companyId} />}
              {tab === "bank" && <BankTab companyId={companyId} />}
              {tab === "payroll" && <PayrollTab companyId={companyId} lastMonth={ov.employees.last_payroll_month} />}
            </div>
          </>
        )}
      </main>
    </div>
  );
}

function PortalTopbar({ onLogout }: { onLogout: () => void }) {
  return (
    <header className="adv-topbar">
      <div className="adv-topbar-inner">
        <div className="adv-brand">
          <span className="adv-brand-mark">오너뷰</span>
          <span className="adv-brand-sub">Partners</span>
        </div>
        <div className="adv-topbar-user">
          <button className="adv-topbar-btn" onClick={onLogout}>로그아웃</button>
        </div>
      </div>
    </header>
  );
}

function OverviewTab({ ov }: { ov: Overview }) {
  return (
    <div className="space-y-7">
      <section>
        <div className="adv-section-title">통장 계좌</div>
        {ov.bank.accounts.length === 0 ? (
          <div className="adv-row-empty">연결된 계좌가 없습니다.</div>
        ) : (
          <div className="adv-acct-list">
            {ov.bank.accounts.map((a, i) => (
              <div key={i} className="adv-acct">
                <span className="font-semibold">{a.bank} <span className="adv-cell-dim">{a.number}</span></span>
                <span className="font-bold">{won(a.balance)}</span>
              </div>
            ))}
          </div>
        )}
      </section>
      <section>
        <div className="adv-section-title">인건비</div>
        <div className="adv-acct-list">
          <div className="adv-acct"><span className="adv-cell-dim">재직 인원</span><span className="font-bold">{ov.employees.count}명</span></div>
          <div className="adv-acct">
            <span className="adv-cell-dim">최근 급여{ov.employees.last_payroll_month ? ` (${ov.employees.last_payroll_month})` : ""}</span>
            <span className="font-bold">{ov.employees.last_payroll_month ? won(ov.employees.last_payroll_total) : "기록 없음"}</span>
          </div>
        </div>
      </section>
      <section>
        <div className="adv-section-title">이번 달 카드 사용</div>
        <div className="adv-acct"><span className="adv-cell-dim">법인카드 합계</span><span className="font-bold">{won(ov.card_month_total)}</span></div>
      </section>
    </div>
  );
}

function InvoicesTab({ companyId }: { companyId: string }) {
  const [type, setType] = useState<string | null>(null);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["advisor-invoices", companyId, type],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("advisor_company_tax_invoices", {
        p_company_id: companyId, p_type: type,
      });
      if (error) throw error;
      return (data || []) as any[];
    },
    staleTime: 60_000,
  });
  return (
    <div>
      <div className="adv-filter-row">
        {[[null, "전체"], ["sales", "매출"], ["purchase", "매입"]].map(([v, label]) => (
          <button key={String(v)} className={`adv-chip ${type === v ? "adv-chip-on" : ""}`} onClick={() => setType(v as string | null)}>{label}</button>
        ))}
        <button className="adv-chip ml-auto" disabled={rows.length === 0}
          onClick={() => downloadCsv(`세금계산서_${d10(new Date().toISOString())}.csv`, rows.map((r) => ({
            발행일: d10(r.issue_date), 구분: r.inv_type === "sales" ? "매출" : "매입",
            거래처: r.counterparty_name || "", 품목: r.item_name || "",
            공급가액: Number(r.supply_amount) || 0, 세액: Number(r.tax_amount) || 0, 합계: Number(r.total_amount) || 0,
            상태: r.status || "",
          })))}>
          ⬇ 엑셀(CSV)
        </button>
      </div>
      {isLoading ? <div className="adv-loading">불러오는 중…</div> : rows.length === 0 ? (
        <div className="adv-row-empty">세금계산서가 없습니다.</div>
      ) : (
        <div className="adv-scroll">
          <table className="adv-table">
            <thead><tr>
              <th>발행일</th><th>구분</th><th>거래처</th><th>품목</th>
              <th className="adv-num">공급가액</th><th className="adv-num">세액</th><th className="adv-num">합계</th>
            </tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="adv-cell-dim">{d10(r.issue_date)}</td>
                  <td className={r.inv_type === "sales" ? "adv-amt-in" : "adv-amt-out"} style={{ textAlign: "left" }}>
                    {r.inv_type === "sales" ? "매출" : "매입"}
                  </td>
                  <td>{r.counterparty_name || "—"}</td>
                  <td className="adv-cell-dim">{r.item_name || "—"}</td>
                  <td className="adv-num">{won(r.supply_amount)}</td>
                  <td className="adv-num">{won(r.tax_amount)}</td>
                  <td className={r.inv_type === "sales" ? "adv-amt-in" : "adv-amt-out"}>{won(r.total_amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function BankTab({ companyId }: { companyId: string }) {
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["advisor-bank", companyId],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("advisor_company_bank_tx", { p_company_id: companyId });
      if (error) throw error;
      return (data || []) as any[];
    },
    staleTime: 60_000,
  });
  return isLoading ? <div className="adv-loading">불러오는 중…</div> : rows.length === 0 ? (
    <div className="adv-row-empty">통장 거래가 없습니다.</div>
  ) : (
    <>
    <div className="adv-filter-row">
      <button className="adv-chip ml-auto"
        onClick={() => downloadCsv(`통장거래_${d10(new Date().toISOString())}.csv`, rows.map((r) => ({
          거래일: d10(r.transaction_date), 은행: r.bank_name || "",
          구분: String(r.tx_type) === "income" ? "입금" : "출금",
          적요: r.counterparty || r.description || "",
          금액: Number(r.amount) || 0, 잔액: r.balance_after != null ? Number(r.balance_after) : "",
        })))}>
        ⬇ 엑셀(CSV)
      </button>
    </div>
    <div className="adv-scroll">
      <table className="adv-table">
        <thead><tr>
          <th>거래일</th><th>은행</th><th>적요</th><th className="adv-num">금액</th><th className="adv-num">잔액</th>
        </tr></thead>
        <tbody>
          {rows.map((r) => {
            // 방향은 type 이 단일 소스('income'/'expense') — 금액 부호로 추정하지 않는다(지출도 양수로 저장됨)
            const isIn = String(r.tx_type || "") === "income";
            return (
              <tr key={r.id}>
                <td className="adv-cell-dim">{d10(r.transaction_date)}</td>
                <td className="adv-cell-dim">{r.bank_name || "—"}</td>
                <td>{r.counterparty || r.description || "—"}</td>
                <td className={isIn ? "adv-amt-in" : "adv-amt-out"}>{isIn ? "+" : "−"}{won(Math.abs(Number(r.amount) || 0))}</td>
                <td className="adv-num adv-cell-dim">{r.balance_after != null ? won(r.balance_after) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
    </>
  );
}

function PayrollTab({ companyId, lastMonth }: { companyId: string; lastMonth: string | null }) {
  const [month, setMonth] = useState<string | null>(lastMonth);
  const { data: rows = [], isLoading } = useQuery({
    queryKey: ["advisor-payroll", companyId, month],
    queryFn: async () => {
      const { data, error } = await (supabase as any).rpc("advisor_company_payroll", {
        p_company_id: companyId, p_month: month,
      });
      if (error) throw error;
      return (data || []) as any[];
    },
    staleTime: 60_000,
  });
  const months = [...new Set(rows.map((r) => r.period_month))];
  return (
    <div>
      <div className="adv-filter-row">
        {month !== null && (
          <>
            <select className="adv-select" value={month || ""} onChange={(e) => setMonth(e.target.value || null)}>
              {lastMonth && !months.includes(lastMonth) && <option value={lastMonth}>{lastMonth}</option>}
              {months.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
            <button className="adv-chip" onClick={() => setMonth(null)}>전체 월 보기</button>
          </>
        )}
        <button className="adv-chip ml-auto" disabled={rows.length === 0}
          onClick={() => downloadCsv(`인건비_${month || "전체"}.csv`, rows.map((r) => ({
            귀속월: r.period_month, 직원: r.employee_name || "",
            기본급: Number(r.base_salary) || 0, 국민연금: Number(r.national_pension) || 0,
            건강보험: Number(r.health_insurance) || 0, 고용보험: Number(r.employment_insurance) || 0,
            소득세: Number(r.income_tax) || 0, 지방소득세: Number(r.local_income_tax) || 0,
            공제계: Number(r.deductions_total) || 0, 실지급: Number(r.net_pay) || 0,
          })))}>
          ⬇ 엑셀(CSV)
        </button>
      </div>
      {isLoading ? <div className="adv-loading">불러오는 중…</div> : rows.length === 0 ? (
        <div className="adv-row-empty">급여 기록이 없습니다.</div>
      ) : (
        <div className="adv-scroll">
          <table className="adv-table">
            <thead><tr>
              <th>귀속월</th><th>직원</th><th className="adv-num">기본급</th><th className="adv-num">국민연금</th>
              <th className="adv-num">건강보험</th><th className="adv-num">고용보험</th><th className="adv-num">소득세</th>
              <th className="adv-num">지방소득세</th><th className="adv-num">공제계</th><th className="adv-num">실지급</th>
            </tr></thead>
            <tbody>
              {rows.map((r, i) => (
                <tr key={i}>
                  <td className="adv-cell-dim">{r.period_month}</td>
                  <td className="font-semibold">{r.employee_name || "—"}</td>
                  <td className="adv-num">{won(r.base_salary)}</td>
                  <td className="adv-num">{won(r.national_pension)}</td>
                  <td className="adv-num">{won(r.health_insurance)}</td>
                  <td className="adv-num">{won(r.employment_insurance)}</td>
                  <td className="adv-num">{won(r.income_tax)}</td>
                  <td className="adv-num">{won(r.local_income_tax)}</td>
                  <td className="adv-num adv-cell-dim">{won(r.deductions_total)}</td>
                  <td className="adv-amt-in">{won(r.net_pay)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
