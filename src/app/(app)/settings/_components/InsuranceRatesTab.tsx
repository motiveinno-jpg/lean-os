"use client";
//   회사설정 › 회계·세무 › 4대보험 요율 (2026-08-27 인사 2차 G3, 결정 96)
//   연도별 한 표. 행이 없으면 '법정 기본값'으로 보이고, 저장하면 회사 값이 된다. 급여 계산(previewPayroll)이 이 표를 읽는다.
import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { fetchInsuranceRates, saveInsuranceRates, resetInsuranceRates, legalInsuranceRates, type InsuranceRates } from "@/lib/insurance-rates";

const pct = (v: number) => (Math.round(v * 100000) / 1000).toString();   // 0.03545 → "3.545"
const fromPct = (s: string) => { const n = Number(String(s).replace(/[^0-9.]/g, "")); return Number.isFinite(n) ? n / 100 : 0; };
const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

export function InsuranceRatesTab({ companyId, userId }: { companyId: string; userId: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const thisYear = new Date().getFullYear();
  const [year, setYear] = useState(thisYear);
  const { data } = useQuery({ queryKey: ["insurance-rates", companyId, year], queryFn: () => fetchInsuranceRates(companyId, year) });
  const [v, setV] = useState<InsuranceRates | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (data) setV(data); }, [data]);
  if (!v) return <div className="collect-empty">요율을 읽는 중…</div>;
  const set = (k: keyof InsuranceRates, val: number) => setV((s) => (s ? { ...s, [k]: val } : s));
  const rows: { label: string; emp?: keyof InsuranceRates; er?: keyof InsuranceRates; hint: string }[] = [
    { label: "국민연금", emp: "np_emp", er: "np_er", hint: "기준소득월액 × 요율 — 상·하한 적용" },
    { label: "건강보험", emp: "hi_emp", er: "hi_er", hint: "보수월액 × 요율 — 상·하한 적용" },
    { label: "장기요양", hint: "건강보험료 × 아래 비율(직원·회사 같음)" },
    { label: "고용보험", emp: "ei_emp", er: "ei_er", hint: "회사 몫에 고용안정·직업능력(0.25%~)이 더해진다" },
    { label: "산재보험", er: "ia_rate", hint: "회사만 · 업종별 요율(근로복지공단 고지)" },
  ];
  const save = async () => {
    setBusy(true);
    try { await saveInsuranceRates(companyId, { ...v, year }, userId); await qc.invalidateQueries({ queryKey: ["insurance-rates", companyId] }); toast(`${year}년 요율을 저장했습니다 — 이 해의 급여 계산에 바로 적용`, "success"); }
    catch (e) { toast(friendlyError(e, "저장하지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };
  const reset = async () => {
    setBusy(true);
    try { await resetInsuranceRates(companyId, year); await qc.invalidateQueries({ queryKey: ["insurance-rates", companyId] }); setV(legalInsuranceRates(year)); toast("법정 기본값으로 되돌렸습니다", "success"); }
    catch (e) { toast(friendlyError(e, "되돌리지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };
  return (
    <div className="ins-rates">
      <div className="ins-rates-head">
        <label className="inv-field"><span>연도</span>
          <select className="field-input" value={year} onChange={(e) => setYear(Number(e.target.value))}>
            {[thisYear - 1, thisYear, thisYear + 1].map((y) => <option key={y} value={y}>{y}년</option>)}
          </select></label>
        <span className={v.isDefault ? "inv-pill inv-pill-ok" : "inv-pill inv-pill-warn"}>{v.isDefault ? "법정 기본값" : "회사 값"}</span>
        <span className="inv-hint">요율은 매년 1월(국민연금은 7월 상·하한) 바뀝니다 — 고지서와 다르면 여기서 고치세요. 출처: 요율표.</span>
      </div>
      <div className="stg-table-wrap">
        <table className="ev-table ev-lined table-ins-rates">
          <thead><tr><th>보험</th><th>직원 부담 %</th><th>회사 부담 %</th><th>설명</th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <td className="text-left"><b>{r.label}</b></td>
                <td className="tr">{r.emp ? <input className="field-input tr" inputMode="decimal" value={pct(Number(v[r.emp]))} onChange={(e) => set(r.emp!, fromPct(e.target.value))} /> : r.label === "장기요양" ? <input className="field-input tr" inputMode="decimal" value={pct(v.ltc_pct)} onChange={(e) => set("ltc_pct", fromPct(e.target.value))} title="건강보험료 대비 %" /> : <span className="ev-dim">—</span>}</td>
                <td className="tr">{r.er ? <input className="field-input tr" inputMode="decimal" value={pct(Number(v[r.er]))} onChange={(e) => set(r.er!, fromPct(e.target.value))} /> : r.label === "장기요양" ? <span className="ev-dim">직원과 같음</span> : <span className="ev-dim">—</span>}</td>
                <td className="text-left ev-dim">{r.hint}</td>
              </tr>
            ))}
            <tr><td className="text-left"><b>국민연금 상·하한</b></td>
              <td className="tr"><input className="field-input tr" inputMode="numeric" value={won(v.np_floor)} onChange={(e) => set("np_floor", Number(e.target.value.replace(/[^0-9]/g, "")))} title="하한(원)" /></td>
              <td className="tr"><input className="field-input tr" inputMode="numeric" value={won(v.np_ceiling)} onChange={(e) => set("np_ceiling", Number(e.target.value.replace(/[^0-9]/g, "")))} title="상한(원)" /></td>
              <td className="text-left ev-dim">기준소득월액 하한 · 상한 (왼쪽 하한, 오른쪽 상한)</td></tr>
            <tr><td className="text-left"><b>건강보험 상·하한</b></td>
              <td className="tr"><input className="field-input tr" inputMode="numeric" value={won(v.hi_floor)} onChange={(e) => set("hi_floor", Number(e.target.value.replace(/[^0-9]/g, "")))} title="하한(원)" /></td>
              <td className="tr"><input className="field-input tr" inputMode="numeric" value={won(v.hi_ceiling)} onChange={(e) => set("hi_ceiling", Number(e.target.value.replace(/[^0-9]/g, "")))} title="상한(원)" /></td>
              <td className="text-left ev-dim">보수월액 하한 · 상한</td></tr>
          </tbody>
        </table>
      </div>
      <label className="inv-field"><span>메모</span><input className="field-input" value={v.note || ""} onChange={(e) => setV((s) => (s ? { ...s, note: e.target.value } : s))} placeholder="예: 산재 0.8% — 도소매업 고지 기준" /></label>
      <div className="inv-modal-actions">
        <span className="doc-sums-sp" />
        {!v.isDefault && <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={reset}>법정 기본값으로</button>}
        <button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>{year}년 요율 저장</button>
      </div>
    </div>
  );
}
