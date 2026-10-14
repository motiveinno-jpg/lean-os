"use client";

// ── 연말정산 담당자 확인 (2026-10-14 연말정산 3단계, 베타 'year_end_settlement') — 인사 › 증명서 › 연말정산 자료 위 ──
//   직원이 제출한 공제 자료 + 그 해 발송된 급여 명세(총급여·4대보험·기납부)를 합쳐 계산한다. 확정하면 급여 자료·결과를 그대로 남긴다(나중에
//   급여가 바뀌어도 확정본은 그대로 — 바뀌었으면 '확정 풀기' 후 다시). 반려는 사유와 함께 직원에게 돌아간다.
//   확정본이 원천세 A04(연말정산 분)·연간 근로 지급명세서 결정세액의 원천이 된다(4단계).

import { useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import * as XLSX from "xlsx";
import { supabase } from "@/lib/supabase";
import { todayKst } from "@/lib/kst";
import { useToast } from "@/components/toast";
import { appConfirm } from "@/components/global-confirm";
import { friendlyError } from "@/lib/friendly-error";
import { YearEndFormDialog } from "@/components/year-end-form";
import { listSettlements, payrollSummaries, settle, confirmSettlement, returnSettlement, reopenSettlement, STATUS_LABEL, type Settlement } from "@/lib/year-end-settlements";

const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;

export function YearEndReview({ companyId, employees }: { companyId: string; employees: { id: string; name: string; employee_number?: string | null; employment_type?: string | null }[] }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const t = todayKst();
  const [year, setYear] = useState(() => (Number(t.slice(5, 7)) <= 6 ? Number(t.slice(0, 4)) - 1 : Number(t.slice(0, 4))));
  const [open, setOpen] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const { data: on = false } = useQuery({
    queryKey: ["feature-year-end", companyId],
    queryFn: async () => !!(await (supabase as any).rpc("feature_on", { p_feature: "year_end_settlement", p_company: companyId })).data,
  });
  const { data: list = [] } = useQuery<Settlement[]>({ queryKey: ["year-end-list", companyId, year], enabled: on, queryFn: () => listSettlements(companyId, year) });
  const { data: pays = new Map() } = useQuery({ queryKey: ["year-end-pays", companyId, year], enabled: on, queryFn: () => payrollSummaries(companyId, year) });
  //   근로자만(프리랜서·일용 제외) — 연말정산 대상
  const people = useMemo(() => employees.filter((e) => e.employment_type !== "freelance" && e.employment_type !== "daily"), [employees]);
  const rows = useMemo(() => people.map((e) => {
    const s = list.find((x) => x.employee_id === e.id) || null;
    const p = pays.get(e.id);
    const r = s?.status === "confirmed" ? (s.result as any) : settle(p, (s?.input || {}) as any);
    return { e, s, p, r };
  }), [people, list, pays]);
  if (!on) return null;
  const refresh = () => qc.invalidateQueries({ queryKey: ["year-end-list", companyId, year] });
  const cur = rows.find((x) => x.e.id === open) || null;

  const exportXlsx = () => {
    const ws = XLSX.utils.aoa_to_sheet([[`${year}년 귀속 근로소득 연말정산`, "오너뷰 계산 · 규칙 2025년 귀속 기준 · 세무사 확인"], [],
      ["이름", "사번", "상태", "총급여", "근로소득금액", "과세표준", "산출세액", "세액공제", "결정세액", "기납부", "차감(소득세)", "차감(지방소득세)"],
      ...rows.map(({ e, s, r }) => [e.name, e.employee_number || "", s ? STATUS_LABEL[s.status] : "미작성", r.pay, r.earned, r.taxBase, r.calc, r.credits.total, r.decided, r.paid, r.diff, r.diffLocal])]);
    const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, "연말정산"); XLSX.writeFile(wb, `연말정산_${year}.xlsx`);
  };
  const counts = { submitted: list.filter((x) => x.status === "submitted").length, confirmed: list.filter((x) => x.status === "confirmed").length };

  return (
    <section className="pnl-panel">
      <h3>연말정산 계산·확정 <small className="font-normal text-[var(--text-dim)]">(베타 · 규칙 2025년 귀속 기준)</small></h3>
      <div className="ye-mine-row">
        <select className="qk-input h-8 px-2.5 text-xs" value={year} aria-label="귀속연도" onChange={(e) => setYear(Number(e.target.value))}>
          {[Number(t.slice(0, 4)), Number(t.slice(0, 4)) - 1, Number(t.slice(0, 4)) - 2].map((y) => <option key={y} value={y}>{y}년 귀속</option>)}
        </select>
        <span className="ye-mine-result">대상 {people.length}명 · 제출 {counts.submitted} · 확정 {counts.confirmed}</span>
        <button type="button" className="btn-secondary btn-sm" onClick={exportXlsx}>엑셀</button>
      </div>
      <div className="stg-table-wrap vr-scroll">
        <table className="ev-table ev-lined table-inv-status-sm">
          <thead><tr><th>이름</th><th>상태</th><th>총급여</th><th>결정세액</th><th>기납부</th><th>환급(−)·추징(+)</th></tr></thead>
          <tbody>
            {rows.map(({ e, s, r }) => (
              <tr key={e.id} className="cursor-pointer" onClick={() => { setOpen(e.id); setReason(""); }} title="눌러서 확인·확정">
                <td className="text-left">{e.name}{e.employee_number ? <span className="ev-dim"> #{e.employee_number}</span> : null}</td>
                <td className="tc"><span className={`ol-sure ${s?.status === "confirmed" ? "ol-sure-ok" : s?.status === "submitted" ? "ol-sure-est" : ""}`}>{s ? STATUS_LABEL[s.status] : "미작성"}</span></td>
                <td className="tr mono-number">{won(r.pay)}</td><td className="tr mono-number">{won(r.decided)}</td><td className="tr mono-number">{won(r.paid)}</td>
                <td className={`tr mono-number ${r.diff > 0 ? "vr-warn" : ""}`}>{r.diff > 0 ? "+" : r.diff < 0 ? "−" : ""}{won(Math.abs(r.diff))}</td>
              </tr>
            ))}
            {!rows.length && <tr><td colSpan={6} className="tc ev-dim">연말정산 대상 근로자가 없습니다.</td></tr>}
          </tbody>
        </table>
      </div>
      <p className="rtf-legend">미작성·작성 중인 사람은 공제 없이(급여만) 계산한 숫자입니다. 확정하면 그때 급여 자료·결과가 고정됩니다 — 급여를 고쳤으면 '확정 풀기' 후 다시 확정하세요.</p>
      {cur && (
        <YearEndFormDialog title={`${cur.e.name} · ${year}년 귀속 연말정산`} year={year} initial={(cur.s?.input || {}) as any} payroll={cur.s?.status === "confirmed" ? (cur.s.payroll as any) : cur.p} readOnly
          onClose={() => setOpen(null)}
          footer={<>
            {cur.s?.status === "confirmed" ? (
              <button type="button" className="btn-secondary btn-sm mr-auto" onClick={async () => {
                if (!(await appConfirm("확정을 풀고 다시 검토 중으로 돌립니다.", { title: "확정 풀기" }))) return;
                try { await reopenSettlement(cur.s!.id); await refresh(); toast("확정을 풀었습니다", "success"); setOpen(null); } catch (e: any) { toast(friendlyError(e), "error"); }
              }}>확정 풀기</button>
            ) : cur.s ? (<>
              <input className="field-input ye-return-reason" placeholder="반려 사유 (직원에게 보입니다)" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
              <button type="button" className="btn-secondary btn-sm" disabled={!reason.trim()} onClick={async () => {
                try { await returnSettlement(cur.s!.id, reason.trim()); await refresh(); toast("반려했습니다", "success"); setOpen(null); } catch (e: any) { toast(friendlyError(e), "error"); }
              }}>반려</button>
              <button type="button" className="btn-primary btn-sm" disabled={cur.s.status === "draft"} title={cur.s.status === "draft" ? "직원이 제출한 뒤 확정할 수 있습니다" : undefined} onClick={async () => {
                if (!cur.p) { toast("이 해에 발송된 급여 명세가 없어 확정할 수 없습니다", "error"); return; }
                const r = settle(cur.p, (cur.s!.input || {}) as any);
                if (!(await appConfirm(`결정세액 ${won(r.decided)} · ${r.diff < 0 ? `환급 ${won(-r.diff)}` : `추가 납부 ${won(r.diff)}`}로 확정합니다.\n세무사 확인을 권합니다(베타).`, { title: "연말정산 확정", confirmLabel: "확정" }))) return;
                try { await confirmSettlement(cur.s!.id, cur.p, r); await refresh(); toast("확정했습니다", "success"); setOpen(null); } catch (e: any) { toast(friendlyError(e), "error"); }
              }}>확정</button>
            </>) : <span className="ye-mine-result mr-auto">직원이 아직 공제 자료를 넣지 않았습니다.</span>}
          </>} />
      )}
    </section>
  );
}
