"use client";

// 인사 › 구성원 › 엑셀▾ › 「4대보험 취득 신고 파일」 · 「상실 신고 파일」 (2026-09-22 ERP 공백 2차 ⑤)
//   규칙·부호는 lib/insurance-edi.ts. 여기서는 후보를 고르고 칸을 고쳐 파일을 만든다.
//   후보: 취득 = 4대보험 대상 재직자 중 기간 안 입사자 / 상실 = 기간 안 퇴사자. 기간을 풀면 전원.
//   주민등록번호는 만드는 순간에만 RPC 로 받는다(열람 기록). 미등록은 파일에서 빼고 이름을 알린다.

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { DateField } from "@/components/date-field";
import { todayKst, addDaysStr } from "@/lib/kst";
import {
  AGENCY_PATTERNS, NP_ACQ_CODES, HI_ACQ_CODES, NP_LOSS_CODES, HI_LOSS_CODES, EI_LOSS_CODES, JOB_CODES,
  acqToCells, lossToCells, validateAcq, validateLoss, downloadInsuranceXlsx, fetchRrnsForInsurance, loadJobDefault, saveJobDefault, nextDay,
  type AcqRow, type LossRow, type ReportType,
} from "@/lib/insurance-edi";

type Props = { companyId: string; employees: any[]; mode: ReportType; onClose: () => void };

const sel = "qk-input ins-edi-sel";
const inp = "qk-input ins-edi-inp";
const num = "qk-input ins-edi-inp ins-edi-num";

export function InsuranceReportDialog({ companyId, employees, mode, onClose }: Props) {
  const { toast } = useToast();
  const today = todayKst();
  const isAcq = mode === "acquisition";
  const [from, setFrom] = useState(addDaysStr(today, -60));
  const [to, setTo] = useState(today);
  const [allPeriod, setAllPeriod] = useState(false);
  const [checked, setChecked] = useState<Set<string>>(new Set());
  const [acq, setAcq] = useState<Record<string, AcqRow>>({});
  const [loss, setLoss] = useState<Record<string, LossRow>>({});
  const [busy, setBusy] = useState(false);
  const [jobDefault, setJobDefault] = useState("");

  //   회사 정보·설정·마스터·주민번호 등록 여부 — 기본값을 채우는 재료
  const { data: ctx } = useQuery({
    queryKey: ["ins-edi-ctx", companyId],
    queryFn: async () => {
      const [c, s, masters, reg, job] = await Promise.all([
        supabase.from("companies").select("name").eq("id", companyId).maybeSingle(),
        (supabase as any).from("company_settings").select("weekly_work_hours").eq("company_id", companyId).maybeSingle(),
        (supabase as any).from("users").select("id").eq("company_id", companyId).eq("is_master", true),
        (supabase as any).rpc("list_rrn_registered"),
        loadJobDefault(companyId),
      ]);
      return {
        companyName: c.data?.name || "",
        weeklyHours: Number(s.data?.weekly_work_hours || 40),
        masterUserIds: new Set<string>(((masters.data || []) as any[]).map((u) => u.id)),
        rrnRegistered: new Set<string>(((reg.data || []) as any[]).map((r) => (typeof r === "string" ? r : r.list_rrn_registered || r.employee_id))),
        jobDefault: job,
      };
    },
  });
  useEffect(() => { if (ctx) setJobDefault(ctx.jobDefault); }, [ctx]);

  //   후보 — 취득: 4대보험 대상 재직자(입사일 기간) / 상실: 퇴사일이 있는 사람(퇴사일 기간)
  const candidates = useMemo(() => {
    const inRange = (d: string | null) => allPeriod || (!!d && d >= from && d <= to);
    return (employees || []).filter((e: any) => {
      if (e.employment_type === "freelance") return false;
      if (isAcq) return e.is_4_insurance !== false && !e.resignation_date && ["active", "joined"].includes(e.status) && inRange(e.hire_date);
      return !!e.resignation_date && inRange(e.resignation_date);
    }).sort((a: any, b: any) => String(isAcq ? a.hire_date : a.resignation_date).localeCompare(String(isAcq ? b.hire_date : b.resignation_date)) || String(a.name).localeCompare(String(b.name), "ko"));
  }, [employees, isAcq, from, to, allPeriod]);

  //   상실 — 보수총액은 발송된 급여 명세의 과세액(결정 101 과 같은 식)
  const lossIds = useMemo(() => (isAcq ? [] : candidates.map((e: any) => e.id)), [candidates, isAcq]);
  const { data: payroll } = useQuery({
    queryKey: ["ins-edi-payroll", companyId, lossIds.join(",")],
    enabled: !isAcq && lossIds.length > 0,
    queryFn: async () => {
      const { data } = await (supabase as any).from("payroll_items").select("employee_id, period_month, base_salary, extras")
        .eq("company_id", companyId).in("employee_id", lossIds.slice(0, 500));
      const byEmp = new Map<string, Map<string, number>>();
      for (const r of (data || []) as any[]) {
        const allowance = (Array.isArray(r.extras) ? r.extras : []).filter((x: any) => x?.type === "allowance" && Number(x?.amount) > 0).reduce((s: number, x: any) => s + Math.round(Number(x.amount)), 0);
        const m = byEmp.get(r.employee_id) || new Map<string, number>();
        m.set(r.period_month, (m.get(r.period_month) || 0) + Number(r.base_salary || 0) + allowance);
        byEmp.set(r.employee_id, m);
      }
      return byEmp;
    },
  });

  //   후보가 바뀌면 줄 기본값을 채운다(이미 고친 줄은 그대로)
  useEffect(() => {
    if (!ctx) return;
    if (isAcq) {
      setAcq((prev) => {
        const next = { ...prev };
        for (const e of candidates) {
          if (next[e.id]) continue;
          const isContract = !!e.contract_end_date || /contract|계약/.test(String(e.contract_type || "")) ? "1" : "2";
          next[e.id] = {
            employeeId: e.id, name: e.name, agencies: "YYYY", isRep: e.user_id && ctx.masterUserIds.has(e.user_id) ? "1" : "2",
            acqDate: e.hire_date || "", monthlyPay: Number(e.salary || 0),
            npCode: "01", npPayFirstMonth: "2", npSpecial: "0", npPublic: "0",
            hiUnitCode: "000", hiUnitName: ctx.companyName, hiCode: "00", hiReduction: "", hiCardToWork: "2",
            jobCode: ctx.jobDefault || "", weeklyHours: ctx.weeklyHours, isContract, contractEnd: e.contract_end_date ? String(e.contract_end_date).slice(0, 7) : "",
            nationality: "", stayStatus: "",
          };
        }
        return next;
      });
    } else {
      setLoss((prev) => {
        const next = { ...prev };
        for (const e of candidates) {
          if (next[e.id]) continue;
          const lossDate = nextDay(String(e.resignation_date));
          const yr = lossDate.slice(0, 4), prevYr = String(Number(yr) - 1);
          const months = payroll?.get(e.id) || new Map<string, number>();
          const sum = (y: string) => [...months.entries()].filter(([m]) => m.startsWith(y) && m <= lossDate.slice(0, 7)).reduce((s, [, v]) => s + v, 0);
          const cnt = (y: string) => [...months.keys()].filter((m) => m.startsWith(y) && m <= lossDate.slice(0, 7)).length;
          const hiredPrev = !!e.hire_date && String(e.hire_date) < `${yr}-01-01`;
          const code = String(e.offboarding?.loss_reason || "").split("-")[0];
          next[e.id] = {
            employeeId: e.id, name: e.name, phone: e.phone || "", agencies: "YYYY", lossDate,
            npCode: "03", npFirstMonthPay: "2",
            hiCode: "01", curPay: sum(yr), curMonths: cnt(yr), prevSettle: hiredPrev ? "2" : "0", prevPay: hiredPrev ? sum(prevYr) : 0, prevMonths: hiredPrev ? cnt(prevYr) : 0,
            eiCode: EI_LOSS_CODES.some((c) => c.code === code) ? code : "", eiDetail: e.offboarding?.loss_reason_label || "",
          };
        }
        return next;
      });
    }
  }, [candidates, ctx, isAcq, payroll]);

  useEffect(() => { setChecked(new Set(candidates.map((e: any) => e.id))); }, [candidates]);

  const toggle = (id: string) => setChecked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const upA = (id: string, patch: Partial<AcqRow>) => setAcq((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const upL = (id: string, patch: Partial<LossRow>) => setLoss((s) => ({ ...s, [id]: { ...s[id], ...patch } }));
  const applyJobToAll = (code: string) => { setJobDefault(code); setAcq((s) => { const n = { ...s }; for (const k of Object.keys(n)) n[k] = { ...n[k], jobCode: code }; return n; }); };

  const selected = candidates.filter((e: any) => checked.has(e.id));
  const missingRrn = selected.filter((e: any) => ctx && !ctx.rrnRegistered.has(e.id));

  const generate = async () => {
    if (!ctx || busy) return;
    const targets = selected.filter((e: any) => ctx.rrnRegistered.has(e.id));
    if (!targets.length) { toast("주민등록번호가 등록된 대상이 없습니다. 구성원 상세 › 기본 정보에서 먼저 등록하세요", "error"); return; }
    const problems: string[] = [];
    for (const e of targets) {
      const miss = isAcq ? validateAcq({ ...acq[e.id], rrn: "0000000000000" }) : validateLoss({ ...loss[e.id], rrn: "0000000000000" });
      if (miss.length) problems.push(`${e.name}: ${miss.join("·")}`);
    }
    if (problems.length) { toast(`빈 칸이 있습니다 — ${problems.slice(0, 3).join(" / ")}${problems.length > 3 ? ` 외 ${problems.length - 3}명` : ""}`, "error"); return; }
    setBusy(true);
    try {
      const rrn = await fetchRrnsForInsurance(targets.map((e: any) => e.id));
      const rows: string[][] = [];
      for (const e of targets) {
        const r = rrn.get(e.id); if (!r) continue;
        rows.push(isAcq ? acqToCells({ ...acq[e.id], rrn: r }) : lossToCells({ ...loss[e.id], rrn: r }));
      }
      if (!rows.length) { toast("주민등록번호를 받지 못했습니다. 급여 또는 세무 신고 권한이 필요합니다", "error"); return; }
      downloadInsuranceXlsx(mode, rows, today.replace(/-/g, ""));
      if (isAcq) {
        const counts = new Map<string, number>();
        for (const e of targets) { const c = acq[e.id].jobCode; if (c) counts.set(c, (counts.get(c) || 0) + 1); }
        const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (top && top !== ctx.jobDefault) saveJobDefault(companyId, top).catch(() => {});
      }
      toast(`${rows.length}명 신고 파일을 내려받았습니다. 주민등록번호가 들어 있어 열람 기록이 남습니다${missingRrn.length ? ` · 미등록 ${missingRrn.length}명은 뺐습니다` : ""}`, "success");
    } catch (e) { toast(friendlyError(e, "파일을 만들지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };

  const opt = (list: { code: string; label: string }[]) => list.map((c) => <option key={c.code} value={c.code}>{c.code ? `${c.code} ${c.label}` : c.label}</option>);

  return (
    <div className="inv-modal" onClick={onClose}>
      <div className="inv-modal-box inv-modal-wide ins-edi-box" onClick={(e) => e.stopPropagation()}>
        <h3 className="inv-modal-title">4대보험 {isAcq ? "취득" : "상실"} 신고 파일 <span className="ev-dim">— 건강보험 EDI 「파일 신고」 규격</span></h3>
        <p className="inv-modal-desc">
          {isAcq
            ? "자격취득일은 입사일, 보수월액은 약정 월급으로 채웠습니다. 직종과 계약직 여부를 확인하세요. 외국인·감면·단위사업장이 있으면 내려받은 파일의 해당 칸을 채웁니다."
            : "자격상실일은 퇴직일 다음 날로 채웠습니다(4대보험 공통). 보수총액은 발송된 급여 명세의 과세액 합입니다. 고용 상실사유는 퇴사 처리 때 고른 코드입니다."}
          {" "}파일은 신고 줄만 담기며 EDI 파일송신함 「가져오기」에 그대로 올립니다. 한 파일 500명.
        </p>

        <div className="ins-edi-bar">
          <span className="ins-edi-bar-lbl">{isAcq ? "입사일" : "퇴사일"}</span>
          <DateField value={from} onChange={(e) => setFrom(e.target.value)} className="qk-input ins-edi-date" disabled={allPeriod} />
          <span className="ev-dim">~</span>
          <DateField value={to} onChange={(e) => setTo(e.target.value)} className="qk-input ins-edi-date" disabled={allPeriod} />
          <label className="ins-edi-check"><input type="checkbox" checked={allPeriod} onChange={(e) => setAllPeriod(e.target.checked)} /> 기간 없이 전원</label>
          {isAcq && (
            <span className="ins-edi-jobdef">
              <span className="ins-edi-bar-lbl">직종 일괄</span>
              <select className={sel} value={jobDefault} onChange={(e) => applyJobToAll(e.target.value)}><option value="">— 고르기 —</option>{opt(JOB_CODES)}</select>
            </span>
          )}
          <span className="doc-sums-sp" />
          <span className="ev-dim">후보 {candidates.length}명 · 고른 {selected.length}명{missingRrn.length ? ` · 주민번호 미등록 ${missingRrn.length}명` : ""}</span>
        </div>

        {!ctx ? <div className="collect-empty">준비 중…</div> : candidates.length === 0 ? (
          <div className="collect-empty">{isAcq ? "이 기간에 입사한 4대보험 대상자가 없습니다. 기간을 넓히거나 '기간 없이 전원'을 켜세요." : "이 기간에 퇴사한 사람이 없습니다. 퇴사 처리는 구성원 상세에서 합니다."}</div>
        ) : (
          <div className="stg-table-wrap ins-edi-scroll">
            <table className="ev-table ev-lined ins-edi-table">
              {isAcq ? (
                <>
                  <thead><tr><th><input type="checkbox" checked={selected.length === candidates.length} onChange={(e) => setChecked(e.target.checked ? new Set(candidates.map((x: any) => x.id)) : new Set())} aria-label="전체 선택" /></th><th className="text-left">이름</th><th>주민번호</th><th>공단구분</th><th>대표자</th><th>자격취득일</th><th>보수월액</th><th className="text-left">직종(고용·산재)</th><th>주소정<br />근로시간</th><th>계약직</th><th>계약 종료<br />년월</th><th>연금<br />취득부호</th><th>건강<br />취득부호</th></tr></thead>
                  <tbody>
                    {candidates.map((e: any) => { const r = acq[e.id]; if (!r) return null; const reg = ctx.rrnRegistered.has(e.id); return (
                      <tr key={e.id} className={checked.has(e.id) ? "" : "ins-edi-off"}>
                        <td className="tc"><input type="checkbox" checked={checked.has(e.id)} onChange={() => toggle(e.id)} /></td>
                        <td className="text-left"><b>{e.name}</b><div className="ev-dim">{e.department || ""}{e.position ? ` · ${e.position}` : ""}</div></td>
                        <td className="tc">{reg ? <span className="inv-pill inv-pill-ok">등록</span> : <span className="inv-pill inv-pill-warn" title="구성원 상세 › 기본 정보에서 입력">미등록</span>}</td>
                        <td className="tc"><select className={sel} value={r.agencies} onChange={(ev) => upA(e.id, { agencies: ev.target.value })}>{opt(AGENCY_PATTERNS)}</select></td>
                        <td className="tc"><select className={sel} value={r.isRep} onChange={(ev) => upA(e.id, { isRep: ev.target.value as "1" | "2" })}><option value="2">아니오</option><option value="1">예</option></select></td>
                        <td className="tc"><DateField value={r.acqDate} onChange={(ev) => upA(e.id, { acqDate: ev.target.value })} className="qk-input ins-edi-date" /></td>
                        <td className="tc"><input className={num} value={r.monthlyPay || ""} onChange={(ev) => upA(e.id, { monthlyPay: Number(ev.target.value.replace(/\D/g, "")) })} inputMode="numeric" /></td>
                        <td className="text-left"><select className={`${sel} ins-edi-sel-wide`} value={r.jobCode} onChange={(ev) => upA(e.id, { jobCode: ev.target.value })}><option value="">— 고르기 —</option>{opt(JOB_CODES)}</select></td>
                        <td className="tc"><input className={num} value={r.weeklyHours} onChange={(ev) => upA(e.id, { weeklyHours: Number(ev.target.value.replace(/\D/g, "")) })} inputMode="numeric" /></td>
                        <td className="tc"><select className={sel} value={r.isContract} onChange={(ev) => upA(e.id, { isContract: ev.target.value as "1" | "2" })}><option value="2">아니오</option><option value="1">예</option></select></td>
                        <td className="tc"><input className={inp} value={r.contractEnd} placeholder="YYYY-MM" disabled={r.isContract !== "1"} onChange={(ev) => upA(e.id, { contractEnd: ev.target.value })} /></td>
                        <td className="tc"><select className={sel} value={r.npCode} onChange={(ev) => upA(e.id, { npCode: ev.target.value })}>{opt(NP_ACQ_CODES)}</select></td>
                        <td className="tc"><select className={sel} value={r.hiCode} onChange={(ev) => upA(e.id, { hiCode: ev.target.value })}>{opt(HI_ACQ_CODES)}</select></td>
                      </tr>
                    ); })}
                  </tbody>
                </>
              ) : (
                <>
                  <thead><tr><th><input type="checkbox" checked={selected.length === candidates.length} onChange={(e) => setChecked(e.target.checked ? new Set(candidates.map((x: any) => x.id)) : new Set())} aria-label="전체 선택" /></th><th className="text-left">이름</th><th>주민번호</th><th>공단구분</th><th>자격상실일</th><th>연금<br />상실부호</th><th>건강<br />상실부호</th><th>당해연도<br />보수총액</th><th>산정<br />월수</th><th>전년<br />정산</th><th>전년도<br />보수총액</th><th>전년<br />월수</th><th className="text-left">고용 상실사유</th><th className="text-left">구체적 사유</th></tr></thead>
                  <tbody>
                    {candidates.map((e: any) => { const r = loss[e.id]; if (!r) return null; const reg = ctx.rrnRegistered.has(e.id); return (
                      <tr key={e.id} className={checked.has(e.id) ? "" : "ins-edi-off"}>
                        <td className="tc"><input type="checkbox" checked={checked.has(e.id)} onChange={() => toggle(e.id)} /></td>
                        <td className="text-left"><b>{e.name}</b><div className="ev-dim">퇴사 {e.resignation_date}</div></td>
                        <td className="tc">{reg ? <span className="inv-pill inv-pill-ok">등록</span> : <span className="inv-pill inv-pill-warn" title="구성원 상세 › 기본 정보에서 입력">미등록</span>}</td>
                        <td className="tc"><select className={sel} value={r.agencies} onChange={(ev) => upL(e.id, { agencies: ev.target.value })}>{opt(AGENCY_PATTERNS)}</select></td>
                        <td className="tc"><DateField value={r.lossDate} onChange={(ev) => upL(e.id, { lossDate: ev.target.value })} className="qk-input ins-edi-date" title="퇴직일 다음 날" /></td>
                        <td className="tc"><select className={sel} value={r.npCode} onChange={(ev) => upL(e.id, { npCode: ev.target.value })}>{opt(NP_LOSS_CODES)}</select></td>
                        <td className="tc"><select className={sel} value={r.hiCode} onChange={(ev) => upL(e.id, { hiCode: ev.target.value })}>{opt(HI_LOSS_CODES)}</select></td>
                        <td className="tc"><input className={num} value={r.curPay || ""} onChange={(ev) => upL(e.id, { curPay: Number(ev.target.value.replace(/\D/g, "")) })} inputMode="numeric" title="발송된 급여 명세 과세액 합 · 없으면 직접" /></td>
                        <td className="tc"><input className={num} value={r.curMonths} onChange={(ev) => upL(e.id, { curMonths: Number(ev.target.value.replace(/\D/g, "")) })} inputMode="numeric" /></td>
                        <td className="tc"><select className={sel} value={r.prevSettle} onChange={(ev) => upL(e.id, { prevSettle: ev.target.value as "0" | "2" })}><option value="0">없음</option><option value="2">있음</option></select></td>
                        <td className="tc"><input className={num} value={r.prevPay || ""} disabled={r.prevSettle !== "2"} onChange={(ev) => upL(e.id, { prevPay: Number(ev.target.value.replace(/\D/g, "")) })} inputMode="numeric" /></td>
                        <td className="tc"><input className={num} value={r.prevMonths} disabled={r.prevSettle !== "2"} onChange={(ev) => upL(e.id, { prevMonths: Number(ev.target.value.replace(/\D/g, "")) })} inputMode="numeric" /></td>
                        <td className="text-left"><select className={`${sel} ins-edi-sel-wide`} value={r.eiCode} onChange={(ev) => upL(e.id, { eiCode: ev.target.value })}><option value="">— 고르기 —</option>{opt(EI_LOSS_CODES)}</select></td>
                        <td className="text-left"><input className={`${inp} ins-edi-inp-wide`} value={r.eiDetail} onChange={(ev) => upL(e.id, { eiDetail: ev.target.value })} placeholder="예: 회사권고" /></td>
                      </tr>
                    ); })}
                  </tbody>
                </>
              )}
            </table>
          </div>
        )}

        <p className="ins-edi-foot">주민등록번호는 파일을 만드는 순간에만 받고 열람 기록이 남습니다(급여 또는 세무 신고 권한). 미등록 직원은 파일에서 빠집니다. 부호표는 docs/reference/nhis-edi 와 같습니다.</p>
        <div className="inv-modal-actions">
          <span className="doc-sums-sp" />
          <button type="button" className="btn-secondary btn-sm" onClick={onClose}>닫기</button>
          <button type="button" className="btn-primary btn-sm" disabled={busy || !ctx || selected.length === 0} onClick={() => void generate()}>{busy ? "만드는 중…" : `신고 파일 만들기 (${selected.length - missingRrn.length}명)`}</button>
        </div>
      </div>
    </div>
  );
}
