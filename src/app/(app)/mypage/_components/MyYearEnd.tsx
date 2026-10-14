"use client";

// ── 마이페이지 › 급여·계약·증명 › 연말정산 (2026-10-14 연말정산 2단계, 베타 feature_rollout 'year_end_settlement') ──
//   직원이 공제 자료를 넣고 제출 → 급여 담당자가 확인·확정. 반려되면 사유가 보이고 다시 고쳐 제출한다. 확정되면 결과(환급/추징)만 본다.

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/lib/supabase";
import { todayKst } from "@/lib/kst";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { YearEndFormDialog } from "@/components/year-end-form";
import { getMySettlement, payrollSummaries, saveMyInput, STATUS_LABEL, type Settlement } from "@/lib/year-end-settlements";

const won = (n: number) => `₩${Math.round(n || 0).toLocaleString("ko-KR")}`;

export function MyYearEnd({ companyId, employeeId }: { companyId: string; employeeId: string }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const t = todayKst();
  //   1~6월엔 지난해 귀속(1~2월 정산), 7월부터는 올해 예상
  const [year, setYear] = useState(() => (Number(t.slice(5, 7)) <= 6 ? Number(t.slice(0, 4)) - 1 : Number(t.slice(0, 4))));
  const [open, setOpen] = useState(false);
  const { data: on = false } = useQuery({
    queryKey: ["feature-year-end", companyId],
    queryFn: async () => !!(await (supabase as any).rpc("feature_on", { p_feature: "year_end_settlement", p_company: companyId })).data,
  });
  const { data: mine, isLoading } = useQuery<Settlement | null>({
    queryKey: ["my-year-end", employeeId, year], enabled: on,
    queryFn: () => getMySettlement(employeeId, year),
  });
  const { data: payroll } = useQuery({
    queryKey: ["my-year-end-pay", companyId, employeeId, year], enabled: on,
    queryFn: async () => (await payrollSummaries(companyId, year, [employeeId])).get(employeeId),
  });
  if (!on) return null;

  const st = mine?.status;
  const locked = st === "confirmed";
  const res = locked ? (mine!.result as any) : null;
  return (
    <section className="pnl-panel">
      <h3>연말정산 <small className="font-normal text-[var(--text-dim)]">공제 자료를 넣고 제출하면 담당자가 확인합니다. (베타)</small></h3>
      <div className="ye-mine-row">
        <select className="qk-input h-8 px-2.5 text-xs" value={year} aria-label="귀속연도" onChange={(e) => setYear(Number(e.target.value))}>
          {[Number(t.slice(0, 4)), Number(t.slice(0, 4)) - 1, Number(t.slice(0, 4)) - 2].map((y) => <option key={y} value={y}>{y}년 귀속</option>)}
        </select>
        <span className={`ol-sure ${st === "confirmed" ? "ol-sure-ok" : st === "submitted" ? "ol-sure-est" : ""}`}>{isLoading ? "확인 중…" : st ? STATUS_LABEL[st] : "아직 안 씀"}</span>
        {res && <span className="ye-mine-result">결정세액 {won(res.decided)} · {res.diff < 0 ? `환급 ${won(-res.diff)}` : res.diff > 0 ? `추가 납부 ${won(res.diff)}` : "차액 없음"} (지방소득세 별도)</span>}
        <button type="button" className={st === "submitted" || locked ? "btn-secondary btn-sm" : "btn-primary btn-sm"} onClick={() => setOpen(true)}>
          {locked ? "확정 내용 보기" : st === "submitted" ? "제출 내용 보기·고치기" : "공제 자료 입력"}
        </button>
      </div>
      {st === "returned" && mine?.return_reason && <p className="rtf-legend vr-warn">반려 사유: {mine.return_reason} — 고쳐서 다시 제출하세요.</p>}
      {open && (
        <YearEndFormDialog title={`${year}년 귀속 연말정산 공제 자료`} year={year} initial={(mine?.input || {}) as any} payroll={payroll} readOnly={locked}
          onClose={() => setOpen(false)}
          onSave={locked ? undefined : async (d, submit) => {
            try {
              await saveMyInput(companyId, employeeId, year, d, submit);
              await qc.invalidateQueries({ queryKey: ["my-year-end", employeeId, year] });
              toast(submit ? "제출했습니다. 담당자가 확인합니다" : "임시 저장했습니다", "success");
              if (submit) setOpen(false);
            } catch (e: any) { toast(friendlyError(e, "저장하지 못했습니다"), "error"); }
          }} />
      )}
    </section>
  );
}
