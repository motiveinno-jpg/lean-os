"use client";
//   원천세 소득 기록 팝업 (2026-10-14 세무 2차 4단계, 결정 262) — 재무 › 세무 신고 › 원천세에서 연다.
//   ① 일용 근무 기록: 일용직 구성원 · 근무일(여러 날이면 시작~종료, 날마다 한 줄) · 일당 · 비과세 → 하루치 세액(lib/tax-forms/wht-income).
//   ② 기타·이자·배당 지급 기록: 받는 사람 · 종류 · 지급액 · 필요경비 · 세율 → 원천세. 주민번호는 받지 않는다(지급명세서 엑셀에서 세무사 기입).
//   확정은 사람 — 계산된 세액을 보고 저장한다. 고치기·지우기도 같은 팝업.
import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { useToast } from "@/components/toast";
import { appConfirm } from "@/components/global-confirm";
import { friendlyError } from "@/lib/friendly-error";
import { DateField } from "@/components/date-field";
import { CurrencyInput } from "@/components/currency-input";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { dailyWageTax, incomeTax, INCOME_KIND_LABEL, DEFAULT_RATE, OTHER_MIN, type DailyLog, type IncomePayment, type IncomeKind } from "@/lib/tax-forms/wht-income";
import { saveDailyLogs, updateDailyLog, deleteDailyLog, saveIncomePayment, deleteIncomePayment } from "@/lib/wht-income-records";

const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;
const days = (from: string, to: string) => {
  const out: string[] = []; if (!from || !to || from > to) return out;
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`) && out.length < 62; t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
};

export function DailyLogDialog({ companyId, defaultDate, edit, onClose, onSaved }: {
  companyId: string; defaultDate: string; edit?: DailyLog | null; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  useModalKeys(true, onClose);
  const { data: emps = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ["daily-emps", companyId],
    queryFn: async () => (logRead("wht-income:daily-emps", await (supabase as any).from("employees")
      .select("id, name").eq("company_id", companyId).eq("employment_type", "daily").order("name").limit(500)) || []) as { id: string; name: string }[],
  });
  const [employeeId, setEmployeeId] = useState(edit?.employee_id || "");
  const [from, setFrom] = useState(edit?.work_date || defaultDate);
  const [to, setTo] = useState(edit?.work_date || defaultDate);
  const [paidOn, setPaidOn] = useState(edit?.paid_on || defaultDate);
  const [wage, setWage] = useState(edit ? String(edit.daily_wage) : "");
  const [nonTax, setNonTax] = useState(edit ? String(edit.non_taxable) : "0");
  const [memo, setMemo] = useState(edit?.memo || "");
  const [busy, setBusy] = useState(false);
  const dates = edit ? [from] : days(from, to);
  const t = useMemo(() => dailyWageTax(Number(wage || 0), Number(nonTax || 0)), [wage, nonTax]);
  const ok = !!employeeId && Number(wage) > 0 && dates.length > 0 && !!paidOn;

  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      const base = { employee_id: employeeId, paid_on: paidOn, daily_wage: Number(wage), non_taxable: Number(nonTax || 0), income_tax: t.incomeTax, local_tax: t.localTax, memo: memo || null };
      if (edit) await updateDailyLog(edit.id, { ...base, work_date: from });
      else { const n = await saveDailyLogs(companyId, dates.map((d) => ({ ...base, work_date: d }))); toast(`${n}일 기록했습니다`, "success"); }
      onSaved(); onClose();
    } catch (e: any) { toast(friendlyError(e, "저장에 실패했습니다"), "error"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!edit || !(await appConfirm(`${edit.employee_name} ${edit.work_date} 근무 기록을 지웁니다.`, { danger: true }))) return;
    try { await deleteDailyLog(edit.id); onSaved(); onClose(); } catch (e: any) { toast(friendlyError(e, "지우지 못했습니다"), "error"); }
  };

  return (
    <div className="rtf-drill-overlay" onClick={onClose}>
      <div className="rtf-form" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="일용 근무 기록">
        <div className="rtf-drill-head"><b>{edit ? "일용 근무 기록 고치기" : "일용 근무 기록"}</b></div>
        {emps.length === 0 && <p className="rtf-legend">일용직 구성원이 없습니다. 인사 › 구성원에서 고용형태를 <b>일용직</b>으로 둔 사람만 고를 수 있습니다.</p>}
        <div className="rtf-form-grid">
          <label className="rtf-form-field"><span>일용직 구성원 *</span>
            <select className="field-input" value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
              <option value="">고르세요</option>{emps.map((e) => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select></label>
          <label className="rtf-form-field"><span>지급일 * <i>· 이 날이 속한 달 신고서에 들어갑니다</i></span><DateField className="field-input" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
          <label className="rtf-form-field"><span>근무일{edit ? "" : " (시작)"} *</span><DateField className="field-input" value={from} onChange={(e) => { setFrom(e.target.value); if (edit || e.target.value > to) setTo(e.target.value); }} /></label>
          {!edit && <label className="rtf-form-field"><span>근무일 (끝) <i>· 같은 일당으로 날마다 한 줄, 최대 62일</i></span><DateField className="field-input" value={to} onChange={(e) => setTo(e.target.value)} /></label>}
          <label className="rtf-form-field"><span>일당 *</span><CurrencyInput className="field-input text-right mono-number" value={wage} onValueChange={setWage} /></label>
          <label className="rtf-form-field"><span>비과세 (식대 등)</span><CurrencyInput className="field-input text-right mono-number" value={nonTax} onValueChange={setNonTax} /></label>
          <label className="rtf-form-field rtf-claim-reason"><span>메모</span><input className="field-input" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} /></label>
        </div>
        <p className="rtf-legend">
          하루 소득세 <b>{won(t.incomeTax)}</b> · 지방소득세 <b>{won(t.localTax)}</b>{!edit && dates.length > 1 ? <> × {dates.length}일 = 소득세 {won(t.incomeTax * dates.length)}</> : null}
          {" "}— (일당 − 비과세 − 15만원) × 6% × 45%, 1천원 미만은 소액부징수. 같은 사람·같은 날 기록이 있으면 덮어씁니다.
        </p>
        <div className="rtf-form-actions">
          {edit && <button type="button" className="btn-secondary btn-sm mr-auto" onClick={remove}>삭제</button>}
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={busy}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={!ok || busy} onClick={save}>{busy ? "저장 중…" : edit ? "저장" : `${dates.length}일 기록`}</button>
        </div>
      </div>
    </div>
  );
}

export function IncomePaymentDialog({ companyId, defaultDate, edit, onClose, onSaved }: {
  companyId: string; defaultDate: string; edit?: IncomePayment | null; onClose: () => void; onSaved: () => void;
}) {
  const { toast } = useToast();
  useModalKeys(true, onClose);
  const [kind, setKind] = useState<IncomeKind>(edit?.income_kind || "other");
  const [payee, setPayee] = useState(edit?.payee_name || "");
  const [payeeKind, setPayeeKind] = useState<"person" | "corp">(edit?.payee_kind || "person");
  const [sub, setSub] = useState(edit?.sub_kind || "");
  const [paidOn, setPaidOn] = useState(edit?.paid_on || defaultDate);
  const [amount, setAmount] = useState(edit ? String(edit.amount) : "");
  const [expense, setExpense] = useState(edit ? String(edit.necessary_expense) : "0");
  const [rate, setRate] = useState(String(edit?.tax_rate ?? DEFAULT_RATE[edit?.income_kind || "other"]));
  const [memo, setMemo] = useState(edit?.memo || "");
  const [busy, setBusy] = useState(false);
  const exp = kind === "other" ? Number(expense || 0) : 0;
  const t = useMemo(() => incomeTax(kind, Number(amount || 0), exp, Number(rate || 0)), [kind, amount, exp, rate]);
  const bad = exp > Number(amount || 0);
  const ok = !!payee.trim() && Number(amount) > 0 && !!paidOn && !bad;

  const save = async () => {
    if (!ok || busy) return;
    setBusy(true);
    try {
      await saveIncomePayment(companyId, { id: edit?.id, payee_name: payee.trim(), payee_kind: payeeKind, income_kind: kind, sub_kind: sub || null, paid_on: paidOn,
        amount: Number(amount), necessary_expense: exp, tax_rate: Number(rate || 0), income_tax: t.incomeTax, local_tax: t.localTax, memo: memo || null });
      onSaved(); onClose();
    } catch (e: any) { toast(friendlyError(e, "저장에 실패했습니다"), "error"); }
    finally { setBusy(false); }
  };
  const remove = async () => {
    if (!edit || !(await appConfirm(`${edit.payee_name} ${edit.paid_on} 지급 기록을 지웁니다.`, { danger: true }))) return;
    try { await deleteIncomePayment(edit.id); onSaved(); onClose(); } catch (e: any) { toast(friendlyError(e, "지우지 못했습니다"), "error"); }
  };

  return (
    <div className="rtf-drill-overlay" onClick={onClose}>
      <div className="rtf-form" onClick={(e) => e.stopPropagation()} role="dialog" aria-label="소득 지급 기록">
        <div className="rtf-drill-head"><b>{edit ? "지급 기록 고치기" : "기타·이자·배당 지급 기록"}</b></div>
        <div className="rtf-form-grid">
          <label className="rtf-form-field"><span>소득 종류 *</span>
            <select className="field-input" value={kind} onChange={(e) => { const k = e.target.value as IncomeKind; setKind(k); setRate(String(DEFAULT_RATE[k])); }}>
              {(Object.keys(INCOME_KIND_LABEL) as IncomeKind[]).map((k) => <option key={k} value={k}>{INCOME_KIND_LABEL[k]}</option>)}
            </select></label>
          <label className="rtf-form-field"><span>세부 <i>· 예: 강연료, 원고료, 대여금 이자</i></span><input className="field-input" value={sub} onChange={(e) => setSub(e.target.value)} maxLength={50} /></label>
          <label className="rtf-form-field"><span>받는 사람 *</span><input className="field-input" value={payee} onChange={(e) => setPayee(e.target.value)} maxLength={100} /></label>
          <label className="rtf-form-field"><span>받는 쪽</span>
            <select className="field-input" value={payeeKind} onChange={(e) => setPayeeKind(e.target.value as "person" | "corp")}>
              <option value="person">개인</option><option value="corp">법인</option>
            </select></label>
          <label className="rtf-form-field"><span>지급일 *</span><DateField className="field-input" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} /></label>
          <label className="rtf-form-field"><span>지급액 *</span><CurrencyInput className="field-input text-right mono-number" value={amount} onValueChange={setAmount} /></label>
          {kind === "other" && <label className="rtf-form-field"><span>필요경비 <i>· 강연료·원고료 등은 60%</i></span><CurrencyInput className="field-input text-right mono-number" value={expense} onValueChange={setExpense} /></label>}
          <label className="rtf-form-field"><span>세율(%) <i>· {kind === "other" ? "기본 20" : "기본 14, 비영업대금 이익 25"}</i></span><input className="field-input text-right" value={rate} onChange={(e) => setRate(e.target.value.replace(/[^0-9.]/g, ""))} /></label>
          <label className="rtf-form-field rtf-claim-reason"><span>메모</span><input className="field-input" value={memo} onChange={(e) => setMemo(e.target.value)} maxLength={500} /></label>
        </div>
        {bad && <p className="rtf-legend vr-warn">필요경비가 지급액보다 클 수 없습니다.</p>}
        <p className="rtf-legend">
          소득세 <b>{won(t.incomeTax)}</b> · 지방소득세 <b>{won(t.localTax)}</b>
          {t.exempt ? <> — 기타소득금액 {won(t.income)}이 건별 {won(OTHER_MIN)} 이하라 과세최저한(0원)</> : null}
          {payeeKind === "corp" ? <b className="vr-warn"> · 법인에게 준 이자·배당은 법인세 원천징수(A80)라 이 신고서 칸에 들어가지 않습니다 — 세무사 확인.</b> : null}
          {" "}주민번호는 받지 않습니다(지급명세서 엑셀에서 세무사가 채웁니다).
        </p>
        <div className="rtf-form-actions">
          {edit && <button type="button" className="btn-secondary btn-sm mr-auto" onClick={remove}>삭제</button>}
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={busy}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={!ok || busy} onClick={save}>{busy ? "저장 중…" : "저장"}</button>
        </div>
      </div>
    </div>
  );
}
