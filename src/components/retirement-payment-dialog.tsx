"use client";
//   퇴직금 지급 기록 팝업 (2026-10-07 ERP 3차 A) — 재무 › 세무 신고 › 원천세에서 연다.
//   퇴직금은 퇴사 정산 초안과 같은 규칙(estimate_retirement)으로 채우고, 퇴직소득세는 lib/retirement-tax.ts 로 계산한다.
//   확정은 사람: 금액·근속 기간을 고칠 수 있고, 저장한 숫자가 그 지급월 신고서 A22·A20 에 그대로 들어간다.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { useConfirm } from "@/components/confirm-dialog";
import { friendlyError } from "@/lib/friendly-error";
import { DateField } from "@/components/date-field";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { calcRetirementTax } from "@/lib/retirement-tax";
import { fetchRetirementEstimates, saveRetirementPayment, deleteRetirementPayment, type RetirementPayment } from "@/lib/retirement";

const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;
type Emp = { id: string; name: string; hire_date: string | null; resignation_date: string | null; status: string | null };

export function RetirementPaymentDialog({ companyId, defaultPaidOn, edit, onClose, onSaved }: {
  companyId: string; defaultPaidOn: string; edit?: RetirementPayment | null; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  const { confirm, confirmElement } = useConfirm();
  const [employeeId, setEmployeeId] = useState(edit?.employee_id || "");
  const [paidOn, setPaidOn] = useState(edit?.paid_on || defaultPaidOn);
  const [start, setStart] = useState(edit?.service_start || "");
  const [end, setEnd] = useState(edit?.service_end || "");
  const [pay, setPay] = useState(edit ? String(edit.retirement_pay) : "");
  const [irp, setIrp] = useState(edit?.irp_deferred || false);
  const [note, setNote] = useState(edit?.note || "");
  const [busy, setBusy] = useState(false);
  const [estimated, setEstimated] = useState<string | null>(null);

  //   퇴사자(퇴사일 최근 순)를 위로 — 퇴직금을 받는 사람은 대부분 막 퇴사한 사람이다
  const { data: emps = [] } = useQuery<Emp[]>({
    queryKey: ["retire-pay-emps", companyId],
    queryFn: async () => {
      const data = logRead("retirement-payment:emps", await (supabase as any).from("employees")
        .select("id, name, hire_date, resignation_date, status").eq("company_id", companyId));
      return ((data || []) as Emp[]).sort((a, b) =>
        (b.resignation_date || "").localeCompare(a.resignation_date || "") || a.name.localeCompare(b.name, "ko"));
    },
  });

  //   직원을 고르면 근속 기간·퇴직금을 채운다(새 기록일 때만 — 고치는 중엔 저장된 값을 지키지 않으면 사람이 고친 게 사라진다)
  const pickEmployee = async (id: string) => {
    setEmployeeId(id);
    const e = emps.find((x) => x.id === id);
    if (!e || edit) return;
    const s = e.hire_date || "", t = e.resignation_date || paidOn;
    setStart(s); setEnd(t);
    if (!s) { setPay(""); setEstimated(null); return; }
    try {
      const [est] = await fetchRetirementEstimates(companyId, t, id);
      setPay(est ? String(Math.round(est.estimate)) : "");
      setEstimated(est ? `퇴직금 추계(${est.source})로 채웠습니다` : null);
    } catch { setEstimated(null); }
  };

  const payNum = Math.max(0, Math.round(Number(pay.replace(/[^0-9]/g, "")) || 0));
  const t = useMemo(() => (start && end ? calcRetirementTax(payNum, start, end, irp) : null), [payNum, start, end, irp]);
  const problem = !employeeId ? "직원을 고르세요"
    : !start || !end ? "근속 시작일·퇴사일을 넣으세요"
    : end < start ? "퇴사일이 근속 시작일보다 앞입니다"
    : !paidOn ? "지급일을 넣으세요"
    : payNum <= 0 ? "퇴직금을 넣으세요" : null;

  const save = async () => {
    if (problem || !t || busy) return;
    setBusy(true);
    try {
      await saveRetirementPayment(companyId, {
        employee_id: employeeId, paid_on: paidOn, service_start: start, service_end: end, service_years: t.years,
        retirement_pay: payNum, income_tax: t.incomeTax, local_tax: t.localTax, irp_deferred: irp, note,
      }, edit?.id);
      toast(`${paidOn.slice(0, 7)} 원천세 신고서에 퇴직소득으로 들어갑니다`, "success");
      onSaved(); onClose();
    } catch (e) { toast(friendlyError(e, "저장하지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!edit || busy) return;
    const { ok } = await confirm({ title: "지급 기록 지우기", desc: `${edit.employee_name} · ${edit.paid_on} 퇴직금 기록을 지웁니다. 그 달 원천세 신고서의 퇴직소득 줄에서도 빠집니다.`, danger: true, confirmLabel: "지우기" });
    if (!ok) return;
    setBusy(true);
    try { await deleteRetirementPayment(companyId, edit.id); toast("지웠습니다", "success"); onSaved(); onClose(); }
    catch (e) { toast(friendlyError(e, "지우지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };
  useModalKeys(true, onClose);

  //   확인창은 팝업 바깥에 — 안에 두면 확인창 배경 클릭이 이 팝업의 onClick 까지 올라가 같이 닫힌다
  return (<>
    {confirmElement}
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">{edit ? "퇴직금 지급 기록 고치기" : "퇴직금 지급 기록"}</h3>
        <p className="inv-modal-desc" title="미사용 연차 수당·마지막 달 급여는 근로소득이라 급여 명세로 정산합니다">
          회사가 직접 지급한 퇴직금만 적습니다. 저장하면 <b>지급월 원천세 신고서의 A22·A20</b>에 들어갑니다.
        </p>
        <div className="inv-form-grid">
          <label className="inv-field"><span>직원</span>
            <select className="field-input" value={employeeId} onChange={(e) => pickEmployee(e.target.value)} disabled={!!edit}>
              <option value="">{edit ? edit.employee_name : "고르세요"}</option>
              {emps.map((e) => <option key={e.id} value={e.id}>{e.name}{e.resignation_date ? ` · 퇴사 ${e.resignation_date}` : ""}</option>)}
            </select>
          </label>
          <label className="inv-field"><span>지급일</span><DateField value={paidOn} onChange={(e) => setPaidOn(e.target.value)} className="field-input" /></label>
          <label className="inv-field"><span>근속 시작일 (입사일)</span><DateField value={start} onChange={(e) => setStart(e.target.value)} className="field-input" /></label>
          <label className="inv-field"><span>퇴사일</span><DateField value={end} onChange={(e) => setEnd(e.target.value)} className="field-input" /></label>
          <label className="inv-field"><span>퇴직금 (과세 퇴직급여)</span>
            <input className="field-input mono-number" inputMode="numeric" value={payNum ? payNum.toLocaleString("ko-KR") : pay}
              onChange={(e) => { setPay(e.target.value); setEstimated(null); }} placeholder="0" />
          </label>
          <label className="inv-field"><span>메모</span><input className="field-input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="퇴사한 본인도 보는 칸입니다" /></label>
        </div>
        {estimated && <p className="inv-hint">{estimated}. 실제 지급액과 다르면 고치세요.</p>}
        <label className="inv-check">
          <input type="checkbox" checked={irp} onChange={(e) => setIrp(e.target.checked)} />
          <span><b>IRP 계좌로 이전 (과세이연)</b><em>원천징수 없이 넘긴 경우입니다. 신고서 자동 반영에서 빠지니 홈택스에서 직접 신고하세요.</em></span>
        </label>
        {t && payNum > 0 && (
          <div className="ret-calc-box">
            <div className="ret-calc-title">퇴직소득세 계산 <span className="hr-src-tag">규칙 · 2023 개정 공제표</span></div>
            <div className="ret-calc-grid">
              <div><span className="ret-calc-k">근속연수</span><span className="ret-calc-v mono-number">{t.years}년</span></div>
              <div><span className="ret-calc-k">근속연수공제</span><span className="ret-calc-v mono-number">{won(t.serviceDeduction)}</span></div>
              <div><span className="ret-calc-k">환산급여</span><span className="ret-calc-v mono-number">{won(t.converted)}</span></div>
              <div><span className="ret-calc-k">환산급여공제</span><span className="ret-calc-v mono-number">{won(t.convertedDeduction)}</span></div>
              <div><span className="ret-calc-k">과세표준</span><span className="ret-calc-v mono-number">{won(t.base)}</span></div>
              <div><span className="ret-calc-k">환산산출세액</span><span className="ret-calc-v mono-number">{won(t.convertedTax)}</span></div>
              <div><span className="ret-calc-k">퇴직소득세</span><span className="ret-calc-v mono-number"><b>{won(t.incomeTax)}</b>{irp && " (이연)"}</span></div>
              <div><span className="ret-calc-k">지방소득세</span><span className="ret-calc-v mono-number">{won(t.localTax)}</span></div>
              <div><span className="ret-calc-k">실지급액</span><span className="ret-calc-v mono-number"><b>{won(t.net)}</b></span></div>
            </div>
          </div>
        )}
        <p className="inv-hint">임원 퇴직금 한도 초과분 · DC형 퇴직연금 · 중간정산 합산은 계산하지 않습니다. 해당하면 세무사와 확인하세요.</p>
        <div className="inv-modal-actions">
          {edit && <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={remove}>지우기</button>}
          <span className="doc-sums-sp" />
          {problem && <span className="inv-hint">{problem}</span>}
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={!!problem || busy} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </div>
    </div>
  </>);
}
