"use client";

// ── 재무 › 세무 신고 — 원천세 · 부가세 (2026-08-31 세무 모듈 1차, docs/20260831_PLAN_tax_module.md 결정 100·101·107) ──
//
//   History: 부가세만 분석 › 부가세 › '신고서 준비'가 있었고, 원천세는 급여에서 계산(간이세액표)만 하고
//   매월 10일 신고서(원천징수이행상황신고서)는 밖에서 손으로 만들었다. 신고는 '분석'이 아니라 매월 하는
//   업무라 재무 그룹에 자리를 새로 팠다(결정 107). 부가세 신고서 준비(VatReturn)는 여기로 옮겨 왔고,
//   분석 › 부가세에는 예상·집계만 남았다(옛 딥링크 ?tab=return 은 이쪽으로 넘어온다).
//
//   결정 100 — 오너뷰는 신고서 완성·세무사 엑셀·기한까지. **제출은 홈택스에서 사람이 한다**(국세청 제출 API 없음).
//   결정 101 — 원천세 신고서 기준 = **발송된 급여 명세(payroll_items 스냅샷)**. 초안·미리보기는 안 들어간다.
//     과세 지급총액 = 과세 기본급 + 과세 수당(extras allowance). 비과세(식대)는 총지급액에서 빠진다(서식 작성요령).
//     무실적 달도 '0원 신고 대상'으로 보여 준다 — 지급이 없어도 신고는 해야 한다.
//   자동으로 못 푸는 것: 사업소득(3.3%)·퇴직·기타소득 지급분 — 아직 오너뷰가 기록하지 않는다(2차 예정).
//     있으면 사람이 더해야 한다고 화면에 적는다. 뭉개면 축소 신고가 된다.

import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useQuery } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { getCurrentUser } from "@/lib/queries";
import { useMyPermissions } from "@/lib/permissions";
import { AccessDenied } from "@/components/access-denied";
import { useToast } from "@/components/toast";
import { todayKst } from "@/lib/kst";
import { comparePeople } from "@/lib/people-sort";
import { QueryScreen, QueryHead, QueryBody, QueryBar, ResultStrip, Stat } from "@/components/query-kit";
import { VatReturn } from "@/app/(app)/reports/vat/_components/VatReturn";

const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;
const num = (n: number) => Math.round(n || 0);

/** 지난달 YYYY-MM — 이번 달 10일에 신고할 대상은 지난달 지급분이다 */
function prevMonth(): string {
  const t = todayKst();
  const y = Number(t.slice(0, 4)), m = Number(t.slice(5, 7));
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
}
/** 신고·납부 기한 = 지급월 다음 달 10일 */
function dueOf(month: string): string {
  const y = Number(month.slice(0, 4)), m = Number(month.slice(5, 7));
  return m === 12 ? `${y + 1}-01-10` : `${y}-${String(m + 1).padStart(2, "0")}-10`;
}

type WhtRow = {
  employee_id: string; name: string; employee_number: string | null;
  taxable: number; nonTaxable: number; incomeTax: number; localIncomeTax: number; issuedAt: string | null;
};

export default function TaxFilingPage() {
  const { isMaster, hasPerm, loading: permLoading } = useMyPermissions();
  const searchParams = useSearchParams();
  const [companyId, setCompanyId] = useState<string | null>(null);
  useEffect(() => { getCurrentUser().then((u: any) => { if (u?.company_id) setCompanyId(u.company_id); }); }, []);

  const [tab, setTab] = useState<"wht" | "vat">(() => (searchParams?.get("tab") === "vat" ? "vat" : "wht"));
  const [month, setMonth] = useState(prevMonth);
  //   부가세는 해 단위 신고 — 연도 하나만 고른다(분석 › 부가세와 같은 규칙)
  const [year, setYear] = useState(() => Number(todayKst().slice(0, 4)));
  const years = useMemo(() => { const y = Number(todayKst().slice(0, 4)); return [y, y - 1, y - 2]; }, []);

  const { data: rows = [], isLoading } = useQuery<WhtRow[]>({
    queryKey: ["wht-items", companyId, month],
    enabled: !!companyId && tab === "wht",
    queryFn: async () => {
      const data = logRead("tax-filing:wht", await (supabase as any).from("payroll_items")
        .select("employee_id, base_salary, non_taxable_amount, income_tax, local_income_tax, extras, issued_at, employees(name, employee_number)")
        .eq("company_id", companyId!).eq("period_month", month));
      return ((data || []) as any[]).map((r) => {
        //   결정 101 — 과세 지급총액 = 과세 기본급 + 과세 수당(extras 의 allowance 는 전부 과세, 비과세 수당은 non_taxable 로 따로 든다)
        const allowance = (Array.isArray(r.extras) ? r.extras : [])
          .filter((e: any) => e?.type === "allowance" && Number(e?.amount) > 0)
          .reduce((s: number, e: any) => s + Math.round(Number(e.amount)), 0);
        return {
          employee_id: r.employee_id,
          name: r.employees?.name || "(이름 없음)",
          employee_number: r.employees?.employee_number || null,
          taxable: Number(r.base_salary || 0) + allowance,
          nonTaxable: Number(r.non_taxable_amount || 0),
          incomeTax: Number(r.income_tax || 0),
          localIncomeTax: Number(r.local_income_tax || 0),
          issuedAt: r.issued_at || null,
        };
      }).sort((a: WhtRow, b: WhtRow) => comparePeople(a, b));
    },
  });

  const T = useMemo(() => ({
    n: rows.length,
    taxable: rows.reduce((s, r) => s + r.taxable, 0),
    incomeTax: rows.reduce((s, r) => s + r.incomeTax, 0),
    localTax: rows.reduce((s, r) => s + r.localIncomeTax, 0),
    lastIssued: rows.reduce<string | null>((m, r) => (r.issuedAt && (!m || r.issuedAt > m) ? r.issuedAt : m), null),
  }), [rows]);

  const { toast } = useToast();
  const exportWht = () => {
    if (!rows.length) { toast("이 달 급여 발송 기록이 없습니다", "info"); return; }
    const wb = XLSX.utils.book_new();
    const ws1 = XLSX.utils.aoa_to_sheet([
      ["원천징수이행상황신고서 준비", `${month} 지급분 (귀속·지급 같은 달 기준)`, `신고·납부 기한 ${dueOf(month)}`, "발송된 급여 명세 기준 (오너뷰)"], [],
      ["구분", "코드", "인원", "총지급액(과세)", "징수 소득세"],
      ["근로소득 간이세액", "A01", T.n, num(T.taxable), num(T.incomeTax)],
      ["가감계", "A10", T.n, num(T.taxable), num(T.incomeTax)],
      ["총합계", "A99", T.n, num(T.taxable), num(T.incomeTax)], [],
      ["납부 세액(홈택스 · 소득세)", "", "", "", num(T.incomeTax)],
      ["지방소득세 특별징수분(위택스 · 별도 신고)", "", "", "", num(T.localTax)], [],
      ["※ 근로소득(급여) 간이세액만 담았습니다 — 사업소득(3.3%)·퇴직·기타소득 지급분이 있으면 직접 더해야 합니다."],
    ]);
    ws1["!cols"] = [{ wch: 40 }, { wch: 6 }, { wch: 6 }, { wch: 16 }, { wch: 14 }];
    XLSX.utils.book_append_sheet(wb, ws1, "신고서");
    const ws2 = XLSX.utils.aoa_to_sheet([
      ["이름", "사번", "총지급액(과세)", "비과세", "소득세", "지방소득세"],
      ...rows.map((r) => [r.name, r.employee_number || "", num(r.taxable), num(r.nonTaxable), num(r.incomeTax), num(r.localIncomeTax)]),
      ["합계", "", num(T.taxable), num(rows.reduce((s, r) => s + r.nonTaxable, 0)), num(T.incomeTax), num(T.localTax)],
    ]);
    ws2["!cols"] = [{ wch: 12 }, { wch: 8 }, { wch: 14 }, { wch: 12 }, { wch: 12 }, { wch: 12 }];
    XLSX.utils.book_append_sheet(wb, ws2, "인별 명세");
    XLSX.writeFile(wb, `원천세신고준비_${month}.xlsx`);
  };

  if (!permLoading && !(isMaster || hasPerm("/finance/tax-filing")))
    return <AccessDenied detail="세무 신고 화면에 대한 권한이 없습니다. 회사 마스터에게 요청하세요." />;

  return (
    <div className="qk-shell">
      <QueryScreen>
        <QueryHead>
          <div className="collect-tabs">
            <button type="button" className={tab === "wht" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("wht")}>원천세</button>
            <button type="button" className={tab === "vat" ? "collect-tab collect-tab-on" : "collect-tab"} onClick={() => setTab("vat")}>부가세</button>
          </div>
          {tab === "wht" ? (<>
            <QueryBar right={<button type="button" className="btn-secondary btn-sm" onClick={exportWht} title="신고서 요약 + 인별 명세 — 2개 시트">세무사 전달 엑셀</button>}>
              <label className="text-xs font-semibold text-[var(--text-dim)]">지급월</label>
              <input type="month" className="inv-input fin-close-month" value={month} onChange={(e) => e.target.value && setMonth(e.target.value)} aria-label="지급월" />
              <span className="text-[11px] text-[var(--text-dim)]">신고·납부 기한 <b className="mono-number">{dueOf(month)}</b> — 홈택스 › 신고/납부 › 원천세</span>
            </QueryBar>
            <ResultStrip>
              <Stat label="인원" value={`${T.n}명`} />
              <Stat label="총지급액 (과세)" value={won(T.taxable)} />
              <Stat label="소득세 (홈택스 납부)" value={won(T.incomeTax)} tone={T.incomeTax ? "minus" : undefined} />
              <Stat label="지방소득세 (위택스 납부)" value={won(T.localTax)} tone={T.localTax ? "minus" : undefined} />
            </ResultStrip>
          </>) : (
            <QueryBar>
              <label className="text-xs font-semibold text-[var(--text-dim)]">연도</label>
              <select value={year} onChange={(e) => setYear(Number(e.target.value))} className="qk-input h-8 px-2.5 text-xs" aria-label="연도">
                {years.map((y) => <option key={y} value={y}>{y}년</option>)}
              </select>
            </QueryBar>
          )}
        </QueryHead>
        <QueryBody>
          <div className="ev-scroll fa-scroll">
            {tab === "vat" ? (
              <VatReturn companyId={companyId} year={year} />
            ) : isLoading ? (
              <div className="collect-empty">불러오는 중…</div>
            ) : rows.length === 0 ? (
              <div className="collect-empty">
                {month} 지급분 <b>급여 발송 기록이 없습니다.</b><br />
                인사 › 구성원 › 급여에서 명세서를 발송하면 그 금액이 그대로 신고서가 됩니다.<br />
                <span className="ev-dim">급여 지급이 없었어도 원천세는 <b>무실적(0원) 신고</b> 대상입니다 — 홈택스에서 인원·세액 0으로 신고하세요.</span>
              </div>
            ) : (
              <div className="vr-wrap">
                <p className="inv-hint">
                  {month} 지급분 · 발송된 급여 명세({T.n}명) 기준 — 귀속·지급 같은 달로 봅니다. 신고는 홈택스에서 사람이 합니다.
                  {T.lastIssued && <> 명세 마지막 발송 <b className="mono-number">{T.lastIssued.slice(0, 10)}</b> — 이후 급여를 고쳤다면 명세서를 다시 발송해야 신고서에 반영됩니다.</>}
                  <b className="vr-warn"> · 근로소득(급여) 간이세액만 담았습니다 — 사업소득(3.3%)·퇴직·기타소득 지급분이 있으면 직접 더해 신고하세요.</b>
                </p>
                <div className="pnl-grid2">
                  <div className="pnl-panel">
                    <h3>원천징수이행상황신고서</h3><p>홈택스 신고서 A01 칸에 옮겨 적는 숫자</p>
                    <table className="ev-table ev-lined table-inv-status-sm">
                      <thead><tr><th>구분</th><th>코드</th><th>인원</th><th>총지급액 (과세)</th><th>징수 소득세</th></tr></thead>
                      <tbody>
                        <tr><td className="text-left">근로소득 간이세액</td><td className="tc mono-number">A01</td><td className="tr mono-number">{T.n}</td><td className="tr mono-number">{won(T.taxable)}</td><td className="tr mono-number">{won(T.incomeTax)}</td></tr>
                        <tr className="vr-sum"><td className="text-left">가감계</td><td className="tc mono-number">A10</td><td className="tr mono-number">{T.n}</td><td className="tr mono-number">{won(T.taxable)}</td><td className="tr mono-number">{won(T.incomeTax)}</td></tr>
                        <tr className="vr-sum"><td className="text-left">총합계</td><td className="tc mono-number">A99</td><td className="tr mono-number">{T.n}</td><td className="tr mono-number">{won(T.taxable)}</td><td className="tr mono-number">{won(T.incomeTax)}</td></tr>
                        <tr className="vr-total"><td className="text-left" colSpan={4}><b>납부 세액 (홈택스 · 소득세)</b></td><td className="tr mono-number"><b>{won(T.incomeTax)}</b></td></tr>
                      </tbody>
                    </table>
                  </div>
                  <div className="pnl-panel">
                    <h3>지방소득세 (특별징수)</h3><p>소득세의 10% — 홈택스가 아니라 <b>위택스</b>에 별도 신고·납부</p>
                    <table className="ev-table ev-lined table-inv-status-sm">
                      <thead><tr><th>구분</th><th>인원</th><th>징수 세액</th></tr></thead>
                      <tbody>
                        <tr><td className="text-left">근로소득분 지방소득세</td><td className="tr mono-number">{T.n}</td><td className="tr mono-number">{won(T.localTax)}</td></tr>
                        <tr className="vr-total"><td className="text-left" colSpan={2}><b>납부 세액 (위택스)</b></td><td className="tr mono-number"><b>{won(T.localTax)}</b></td></tr>
                      </tbody>
                    </table>
                  </div>
                </div>
                <div className="pnl-panel">
                  <h3>인별 명세</h3><p>발송된 급여 명세 그대로 · 사번 순</p>
                  <div className="stg-table-wrap vr-scroll">
                    <table className="ev-table ev-lined table-inv-status-sm">
                      <thead><tr><th>이름</th><th>총지급액 (과세)</th><th>비과세</th><th>소득세</th><th>지방소득세</th></tr></thead>
                      <tbody>
                        {rows.map((r) => (
                          <tr key={r.employee_id}>
                            <td className="text-left">{r.name}{r.employee_number && <span className="ev-dim"> #{r.employee_number}</span>}</td>
                            <td className="tr mono-number">{won(r.taxable)}</td>
                            <td className="tr mono-number">{won(r.nonTaxable)}</td>
                            <td className="tr mono-number">{won(r.incomeTax)}</td>
                            <td className="tr mono-number">{won(r.localIncomeTax)}</td>
                          </tr>
                        ))}
                      </tbody>
                      <tfoot><tr className="vr-sum"><td className="text-left">합계 ({T.n}명)</td><td className="tr mono-number">{won(T.taxable)}</td><td className="tr mono-number">{won(rows.reduce((s, r) => s + r.nonTaxable, 0))}</td><td className="tr mono-number">{won(T.incomeTax)}</td><td className="tr mono-number">{won(T.localTax)}</td></tr></tfoot>
                    </table>
                  </div>
                </div>
              </div>
            )}
          </div>
        </QueryBody>
      </QueryScreen>
    </div>
  );
}
