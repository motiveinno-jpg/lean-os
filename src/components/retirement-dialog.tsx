"use client";
//   퇴직충당금 팝업 + 퇴사 정산 초안 (2026-08-27 인사 4차 G1·H3·H7, 결정 97). 출처: 규칙(평균임금×30×근속). 확정은 사람.
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { todayKst } from "@/lib/kst";
import { DateField } from "@/components/date-field";
import { fetchRetirementEstimates, makeRetirementVoucherDraft, buildSettlement, type Settlement } from "@/lib/retirement";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

export function RetirementDialog({ companyId, onClose }: { companyId: string; onClose: () => void }) {
  const { toast } = useToast();
  const [asof, setAsof] = useState(todayKst());
  const [busy, setBusy] = useState(false);
  const { data: rows = [], isLoading } = useQuery({ queryKey: ["retirement-est", companyId, asof], queryFn: () => fetchRetirementEstimates(companyId, asof) });
  const total = rows.reduce((s, r) => s + r.estimate, 0), manual = rows.reduce((s, r) => s + r.manual, 0);
  const draft = async () => {
    setBusy(true);
    try {
      const id = await makeRetirementVoucherDraft(companyId, asof);
      toast(id ? "충당부채 차액 전표 초안을 만들었습니다 — 재무 › 전표 현황 › 처리할 것에서 확정" : "장부 잔액과 추계가 같아 만들 전표가 없습니다", id ? "success" : "info");
    } catch (e) { toast(friendlyError(e, "초안을 만들지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">퇴직금 추계 — 재직자 {rows.length}명</h3>
        <p className="inv-modal-desc">평균임금(최근 3개월 발급 명세 총급여 ÷ 일수, 명세가 없으면 약정 월급) × 30일 × 근속년. <b>1년 미만은 0</b>(법정). 저장하지 않고 기준일마다 새로 계산합니다 — 출처: 규칙. 전표는 추계 합계와 장부(퇴직급여충당부채) 잔액의 <b>차액만</b>, 개인별 금액 없이 한 줄.</p>
        <div className="ins-rates-head">
          <label className="inv-field"><span>기준일</span><DateField value={asof} onChange={(e) => setAsof(e.target.value)} className="field-input" /></label>
          <span className="inv-hint">직접 입력한 충당금(정보 탭)은 참고로 나란히 보입니다.</span>
        </div>
        {isLoading ? <div className="collect-empty">계산 중…</div> : (
          <div className="stg-table-wrap">
            <table className="ev-table ev-lined table-retire">
              <thead><tr><th>직원</th><th>입사일</th><th>근속</th><th>평균임금(일)</th><th>추계액</th><th>직접 입력</th><th>근거</th></tr></thead>
              <tbody>{rows.map((r) => (
                <tr key={r.employee_id}>
                  <td className="text-left"><b>{r.name}</b></td>
                  <td className="mono-number">{r.hire_date}</td>
                  <td className="tr mono-number">{r.total_days >= 365 ? `${Math.floor(r.total_days / 365)}년 ${Math.floor((r.total_days % 365) / 30)}개월` : <span className="ev-dim">{r.total_days}일 (1년 미만)</span>}</td>
                  <td className="tr mono-number">₩{won(r.daily_wage)}</td>
                  <td className="tr mono-number"><b>₩{won(r.estimate)}</b></td>
                  <td className="tr mono-number ev-dim">{r.manual ? `₩${won(r.manual)}` : "—"}</td>
                  <td className="ev-dim">{r.source}</td>
                </tr>
              ))}</tbody>
              <tfoot><tr className="vr-sum"><td className="text-left" colSpan={4}>합계</td><td className="tr mono-number"><b>₩{won(total)}</b></td><td className="tr mono-number ev-dim">{manual ? `₩${won(manual)}` : "—"}</td><td></td></tr></tfoot>
            </table>
          </div>
        )}
        <div className="inv-modal-actions"><span className="doc-sums-sp" /><button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button><button type="button" className="btn-primary btn-sm" disabled={busy || isLoading || !rows.length} onClick={draft}>충당부채 전표 초안 만들기</button></div>
      </div>
    </div>
  );
}

/** 퇴사 처리 모달 안 — 정산 초안 (H7). 금액은 규칙으로 채우고 확정·지급은 사람. */
export function RetirementSettlementBox({ companyId, employeeId, monthlySalary, endDate }: { companyId: string; employeeId: string; monthlySalary: number; endDate: string }) {
  const [s, setS] = useState<Settlement | null>(null);
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { let alive = true; setS(null); setErr(null); buildSettlement(companyId, employeeId, monthlySalary, endDate).then((v) => { if (alive) setS(v); }).catch((e) => { if (alive) setErr(friendlyError(e, "계산 실패")); }); return () => { alive = false; }; }, [companyId, employeeId, monthlySalary, endDate]);
  return (
    <div className="ret-settle">
      <div className="text-xs font-semibold text-[var(--text-muted)] mb-2">정산 초안 <span className="hr-src-tag">규칙</span></div>
      {err ? <div className="collect-empty">{err}</div> : !s ? <div className="collect-empty">계산 중…</div> : (
        <table className="ev-table ev-lined table-ret-settle">
          <tbody>
            <tr><td className="text-left">퇴직금 <span className="ev-dim">{s.eligible ? `평균임금 ₩${won(s.dailyWage)}/일 × 30 × ${s.totalDays}/365 · ${s.source}` : `근속 ${s.totalDays}일 — 1년 미만이라 법정 퇴직금 없음`}</span></td><td className="tr mono-number">₩{won(s.retirement)}</td></tr>
            <tr><td className="text-left">미사용 연차 수당 <span className="ev-dim">{s.leaveRemain}일 × 통상임금 일급 ₩{won(s.ordinaryDaily)}(월급÷209h×8h)</span></td><td className="tr mono-number">₩{won(s.leavePay)}</td></tr>
            <tr><td className="text-left">마지막 달 급여 일할 <span className="ev-dim">{s.lastMonthDays}/{s.monthDays}일</span></td><td className="tr mono-number">₩{won(s.lastMonthPay)}</td></tr>
          </tbody>
          <tfoot><tr className="vr-sum"><td className="text-left">합계 (세전 · 소득세·4대보험 정산 전)</td><td className="tr mono-number"><b>₩{won(s.total)}</b></td></tr></tfoot>
        </table>
      )}
    </div>
  );
}
