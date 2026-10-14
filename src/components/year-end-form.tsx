"use client";

// ── 연말정산 공제 자료 입력 팝업 (2026-10-14 연말정산 2단계) — 직원(작성·제출)과 담당자(읽기·확정)가 같은 팝업을 쓴다 ──
//   입력하는 대로 오른쪽에 예상 결정세액·환급/추징(lib/tax-forms/year-end — 2025년 귀속 규칙)을 보여 준다.
//   홈택스 간소화 자료 금액을 옮겨 적는 칸이다. 간소화 PDF 자동 읽기는 다음 단계.

import { useMemo, useState, type ReactNode } from "react";
import { CurrencyInput } from "@/components/currency-input";
import { useModalKeys } from "@/hooks/use-modal-keys";
import { RULE_YEAR } from "@/lib/tax-forms/year-end";
import { settle, type Deductions, type PayrollSummary } from "@/lib/year-end-settlements";

const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;
type Key = keyof Deductions;

export function YearEndFormDialog({ title, year, initial, payroll, readOnly, onClose, onSave, footer }: {
  title: string; year: number; initial: Deductions; payroll: PayrollSummary | undefined; readOnly?: boolean;
  onClose: () => void; onSave?: (d: Deductions, submit: boolean) => Promise<void>; footer?: ReactNode;
}) {
  useModalKeys(true, onClose);
  const [d, setD] = useState<Deductions>(initial || {});
  const [busy, setBusy] = useState(false);
  const r = useMemo(() => settle(payroll, d), [payroll, d]);
  const set = (k: Key, v: unknown) => setD((x) => ({ ...x, [k]: v }));
  const setCard = (k: string, v: number) => setD((x) => ({ ...x, card: { ...(x.card || {}), [k]: v } }));
  const money = (k: Key, label: string, hint?: string) => (
    <label className="rtf-form-field"><span>{label}{hint && <i> · {hint}</i>}</span>
      <CurrencyInput className="field-input text-right mono-number" disabled={readOnly} value={String((d[k] as number | undefined) ?? "")} placeholder="0" onValueChange={(v) => set(k, v === "" ? 0 : Number(v))} /></label>
  );
  const count = (k: Key, label: string) => (
    <label className="rtf-form-field"><span>{label}</span>
      <input className="field-input text-right" disabled={readOnly} inputMode="numeric" value={String((d[k] as number | undefined) ?? "")} placeholder="0" onChange={(e) => set(k, Number(e.target.value.replace(/[^0-9]/g, "") || 0))} /></label>
  );
  const check = (k: Key, label: string) => (
    <label className="rtf-form-check"><input type="checkbox" disabled={readOnly} checked={!!d[k]} onChange={(e) => set(k, e.target.checked)} /> {label}</label>
  );
  const cardMoney = (k: string, label: string, hint?: string) => (
    <label className="rtf-form-field"><span>{label}{hint && <i> · {hint}</i>}</span>
      <CurrencyInput className="field-input text-right mono-number" disabled={readOnly} value={String((d.card as Record<string, number> | undefined)?.[k] ?? "")} placeholder="0" onValueChange={(v) => setCard(k, v === "" ? 0 : Number(v))} /></label>
  );
  const save = async (submit: boolean) => { if (!onSave || busy) return; setBusy(true); try { await onSave(d, submit); } finally { setBusy(false); } };

  return (
    <div className="rtf-drill-overlay" onClick={onClose}>
      <div className="rtf-form ye-form" onClick={(e) => e.stopPropagation()} role="dialog" aria-label={title}>
        <div className="rtf-drill-head"><b>{title}</b><span>{year}년 귀속 · 규칙 {RULE_YEAR}년 귀속 기준 · 홈택스 간소화 자료 금액을 옮겨 적으세요</span></div>
        <div className="ye-body">
          <div className="ye-fields">
            <h4>부양가족 (본인 제외)</h4>
            <div className="rtf-form-grid">
              {check("spouse", "배우자 기본공제")}{count("dependents", "그 밖 기본공제 대상 인원")}
              {count("elderly70", "70세 이상 (경로우대)")}{count("disabled", "장애인")}
              {count("children8", "8세 이상 자녀 (자녀세액공제)")}
              <label className="rtf-form-field"><span>올해 출산·입양</span>
                <select className="field-input" disabled={readOnly} value={String(d.birthOrder || 0)} onChange={(e) => set("birthOrder", Number(e.target.value))}>
                  <option value="0">없음</option><option value="1">첫째</option><option value="2">둘째</option><option value="3">셋째 이상</option>
                </select></label>
              {check("womanHead", "부녀자")}{check("singleParent", "한부모")}
            </div>
            <h4>신용카드 등 (겹치지 않게)</h4>
            <div className="rtf-form-grid">
              {cardMoney("credit", "신용카드")}{cardMoney("debitCash", "체크카드·현금영수증")}
              {cardMoney("market", "전통시장")}{cardMoney("transit", "대중교통")}{cardMoney("culture", "도서·공연·박물관 등", "총급여 7천 이하")}
            </div>
            <h4>보험·의료·교육·기부</h4>
            <div className="rtf-form-grid">
              {money("insurance", "보장성 보험료")}{money("insuranceDisabled", "장애인전용 보험료")}
              {money("medicalSelf", "의료비 — 본인·65세 이상·장애인·6세 이하")}{money("medicalOthers", "의료비 — 그 밖 부양가족")}
              {money("medicalInfertility", "난임 시술비")}{money("medicalPremature", "미숙아·선천성이상아")}
              {money("eduSelf", "교육비 — 본인")}{money("eduK12", "교육비 — 취학 전·초중고")}{count("eduK12Count", "　└ 인원")}
              {money("eduUniv", "교육비 — 대학생")}{count("eduUnivCount", "　└ 인원")}{money("eduDisabled", "장애인 특수교육비")}
              {money("donPolitical", "정치자금 기부금")}{money("donSpecial", "특례기부금 (국가·재난 등)")}
              {money("donGeneral", "일반기부금 (종교 외)")}{money("donReligious", "종교단체 기부금")}
            </div>
            <h4>주택·연금</h4>
            <div className="rtf-form-grid">
              {money("monthlyRent", "월세 지급액", "무주택 세대주")}{money("rentLoanRepay", "주택임차 차입금 원리금 상환")}
              {money("housingSaving", "주택청약 납입액")}{check("housingSavingEligible", "청약 공제 요건 충족 (무주택 세대주·총급여 7천 이하)")}
              {money("mortgageInterest", "장기주택저당 차입금 이자")}
              <label className="rtf-form-field"><span>저당 이자 공제 한도</span>
                <select className="field-input" disabled={readOnly} value={String(d.mortgageLimit || 0)} onChange={(e) => set("mortgageLimit", Number(e.target.value))}>
                  {[0, 6_000_000, 8_000_000, 15_000_000, 18_000_000, 20_000_000].map((v) => <option key={v} value={v}>{v ? `${v / 10_000}만 원` : "해당 없음"}</option>)}
                </select></label>
              {money("pensionSaving", "연금저축 납입액")}{money("irp", "퇴직연금(IRP) 납입액")}
            </div>
            <h4>전 근무지 (올해 중간 입사)</h4>
            <div className="rtf-form-grid">
              {money("prevPay", "전 근무지 총급여")}{money("prevPaidIncomeTax", "전 근무지 기납부 소득세")}{money("prevPaidLocalTax", "전 근무지 기납부 지방소득세")}
            </div>
          </div>
          <aside className="ye-preview">
            <h4>예상 결과</h4>
            <table className="rtf-table">
              <tbody>
                <tr><td className="rtf-label">총급여</td><td className="rtf-num">{won(r.pay)}</td></tr>
                <tr><td className="rtf-label">근로소득금액</td><td className="rtf-num">{won(r.earned)}</td></tr>
                <tr><td className="rtf-label">소득공제 합계</td><td className="rtf-num">{won(r.deductions.total)}</td></tr>
                <tr className="rtf-sum"><td className="rtf-label">과세표준</td><td className="rtf-num">{won(r.taxBase)}</td></tr>
                <tr><td className="rtf-label">산출세액</td><td className="rtf-num">{won(r.calc)}</td></tr>
                <tr><td className="rtf-label">세액공제 합계{r.standard ? " (표준공제가 유리)" : ""}</td><td className="rtf-num">{won(r.credits.total)}</td></tr>
                <tr className="rtf-sum"><td className="rtf-label">결정세액</td><td className="rtf-num">{won(r.decided)}</td></tr>
                <tr><td className="rtf-label">기납부세액</td><td className="rtf-num">{won(r.paid)}</td></tr>
                <tr className="rtf-sum"><td className="rtf-label">{r.diff < 0 ? "환급 예상 (소득세)" : "추가 납부 (소득세)"}</td><td className="rtf-num"><b>{won(Math.abs(r.diff))}</b></td></tr>
                <tr><td className="rtf-label">{r.diffLocal < 0 ? "환급 (지방소득세)" : "추가 납부 (지방소득세)"}</td><td className="rtf-num">{won(Math.abs(r.diffLocal))}</td></tr>
              </tbody>
            </table>
            <p className="rtf-legend">{payroll ? `발송된 급여 명세 ${payroll.months}개월 기준.` : "급여 명세가 없어 공제만 보입니다."} 예상치입니다 — 확정은 담당자가 합니다. 부양가족 소득요건·중복공제는 본인이 확인하세요.</p>
          </aside>
        </div>
        <div className="rtf-form-actions">
          {footer}
          <button type="button" className="btn-secondary btn-sm" onClick={onClose} disabled={busy}>닫기</button>
          {!readOnly && onSave && <>
            <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={() => void save(false)}>임시 저장</button>
            <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={() => void save(true)}>{busy ? "저장 중…" : "제출"}</button>
          </>}
        </div>
      </div>
    </div>
  );
}
