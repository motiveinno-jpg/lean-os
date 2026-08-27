"use client";
//   4대보험 고지서 대조 (2026-08-27 인사 2차 H2) — 공단 고지 합계(직원+회사)를 적으면 급여 계산 합계와의 차이를 보여 준다.
//   출처: 장부 대조. 차이가 나면 요율(회사설정)·적용 여부(구성원 4대보험 체크)·기준소득월액(공단은 전년 소득 기준)을 의심한다.
import { useEffect, useMemo, useState } from "react";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { fetchInsuranceNotice, saveInsuranceNotice } from "@/lib/insurance-rates";
import type { PayrollItem } from "@/lib/payment-batch";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");
const num = (s: string) => Number(String(s).replace(/[^0-9]/g, "")) || 0;

export function InsuranceNoticeDialog({ companyId, userId, month, items, onClose }: { companyId: string; userId: string | null; month: string; items: PayrollItem[]; onClose: () => void }) {
  const { toast } = useToast();
  const calc = useMemo(() => {
    const s = { np: 0, hi: 0, ei: 0, ia: 0 };
    for (const it of items) {
      const er = it.employerCosts || { nationalPension: 0, healthInsurance: 0, longTermCareInsurance: 0, employmentInsurance: 0, industrialAccident: 0, total: 0 };
      s.np += it.nationalPension + er.nationalPension;
      s.hi += it.healthInsurance + (it.longTermCareInsurance || 0) + er.healthInsurance + (er.longTermCareInsurance || 0);
      s.ei += it.employmentInsurance + er.employmentInsurance;
      s.ia += er.industrialAccident;
    }
    return s;
  }, [items]);
  const [v, setV] = useState({ np: "", hi: "", ei: "", ia: "", note: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => { fetchInsuranceNotice(companyId, month).then((n) => { if (n) setV({ np: won(n.np), hi: won(n.hi), ei: won(n.ei), ia: won(n.ia), note: n.note || "" }); }).catch(() => {}); }, [companyId, month]);
  const rows: { k: "np" | "hi" | "ei" | "ia"; label: string; hint: string }[] = [
    { k: "np", label: "국민연금", hint: "직원+회사 합계" }, { k: "hi", label: "건강보험(장기요양 포함)", hint: "직원+회사 합계" },
    { k: "ei", label: "고용보험", hint: "직원+회사 합계 (고용안정 포함)" }, { k: "ia", label: "산재보험", hint: "회사만" },
  ];
  const totalNotice = rows.reduce((s, r) => s + num(v[r.k]), 0), totalCalc = calc.np + calc.hi + calc.ei + calc.ia;
  const save = async () => {
    setBusy(true);
    try { await saveInsuranceNotice(companyId, { month, np: num(v.np), hi: num(v.hi), ei: num(v.ei), ia: num(v.ia), note: v.note || null }, userId); toast(`${month} 고지 금액을 저장했습니다`, "success"); onClose(); }
    catch (e) { toast(friendlyError(e, "저장하지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };
  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">4대보험 고지서 대조 — {month}</h3>
        <p className="inv-modal-desc">공단 고지서의 <b>보험별 합계(직원+회사)</b>를 적으면 급여 계산 합계와의 차이가 보입니다. 차이가 나면 요율(회사설정 › 4대보험 요율)·직원별 적용 여부·기준소득월액(공단은 전년 소득 기준)을 의심하세요. 출처: 장부 대조. 전표는 여기서 만들지 않습니다.</p>
        <div className="stg-table-wrap">
          <table className="ev-table ev-lined table-ins-notice">
            <thead><tr><th>보험</th><th>급여 계산</th><th>고지 금액</th><th>차이</th></tr></thead>
            <tbody>
              {rows.map((r) => { const c = calc[r.k], n = num(v[r.k]), d = n - c; return (
                <tr key={r.k}><td className="text-left"><b>{r.label}</b> <span className="ev-dim">{r.hint}</span></td>
                  <td className="tr mono-number">₩{won(c)}</td>
                  <td className="tr"><input className="field-input tr" inputMode="numeric" value={v[r.k]} onChange={(e) => setV((s) => ({ ...s, [r.k]: e.target.value ? won(num(e.target.value)) : "" }))} placeholder="고지서 금액" /></td>
                  <td className={`tr mono-number ${v[r.k] && Math.abs(d) >= 10 ? (d > 0 ? "inv-diff-plus" : "inv-diff-minus") : ""}`}>{v[r.k] ? (d === 0 ? "일치" : `${d > 0 ? "+" : "−"}₩${won(Math.abs(d))}`) : "—"}</td></tr>
              ); })}
            </tbody>
            <tfoot><tr className="vr-sum"><td className="text-left">합계</td><td className="tr mono-number">₩{won(totalCalc)}</td><td className="tr mono-number">₩{won(totalNotice)}</td><td className="tr mono-number"><b>{totalNotice ? `${totalNotice - totalCalc >= 0 ? "+" : "−"}₩${won(Math.abs(totalNotice - totalCalc))}` : "—"}</b></td></tr></tfoot>
          </table>
        </div>
        <label className="inv-field"><span>메모</span><input className="field-input" value={v.note} onChange={(e) => setV((s) => ({ ...s, note: e.target.value }))} placeholder="예: 김OO 7월 취득 — 고지엔 다음 달부터" /></label>
        <div className="inv-modal-actions"><span className="doc-sums-sp" /><button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button><button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>고지 금액 저장</button></div>
      </div>
    </div>
  );
}
