"use client";
//   상세 패널 › 이력 — 발령 표 + 등록 팝업 + 인사기록카드 PDF (2026-08-27 인사 3차 G2·H10, 결정 98)
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/components/toast";
import { friendlyError } from "@/lib/friendly-error";
import { todayKst } from "@/lib/kst";
import { DateField } from "@/components/date-field";
import { DepartmentField, PositionField } from "@/components/org-option-fields";
import { CurrencyInput } from "@/components/currency-input";
import { listAppointments, addAppointment, deleteAppointment, importLegacyAppointments, appointmentLines, APPOINTMENT_KINDS, kindLabel, type AppointmentKind } from "@/lib/hr-appointments";
import { generatePersonnelRecordCard } from "@/lib/certificates";
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";

const won = (n: number) => Math.round(n || 0).toLocaleString("ko-KR");

export function AppointmentsSection({ employeeId, companyId, emp, userId }: { employeeId: string; companyId: string; emp: any; userId: string | null }) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: list = [], isLoading } = useQuery({ queryKey: ["hr-appointments", companyId, employeeId], queryFn: () => listAppointments(companyId, employeeId) });
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState<{ kind: AppointmentKind; date: string; department: string; position: string; salary: number; reason: string }>({ kind: "transfer", date: todayKst(), department: "", position: "", salary: 0, reason: "" });
  const legacyCount = (Array.isArray(emp?.employment_history) ? emp.employment_history.length : 0);
  const refresh = () => { qc.invalidateQueries({ queryKey: ["hr-appointments", companyId, employeeId] }); qc.invalidateQueries({ queryKey: ["employee-detail", employeeId] }); };
  const save = async () => {
    const needsDeptOrPos = ["transfer", "promotion", "hire"].includes(form.kind);
    if (needsDeptOrPos && !form.department && !form.position) { toast("부서나 직책 중 하나는 적어야 합니다", "error"); return; }
    if (form.kind === "salary" && !(form.salary > 0)) { toast("바뀐 월급을 적으세요", "error"); return; }
    setBusy(true);
    try {
      await addAppointment(companyId, { employee_id: employeeId, kind: form.kind, effective_date: form.date, department: form.department || null, position: form.position || null, salary: form.kind === "salary" ? form.salary : null, reason: form.reason || null }, userId);
      const touches = !!(form.department || form.position || (form.kind === "salary" && form.salary > 0));
      toast(form.date <= todayKst() && touches ? "발령을 기록하고 현재 부서·직책에 반영했습니다" : form.date > todayKst() && touches ? "발령을 기록했습니다 — 발령일이 되면 현재값에 반영하세요" : "발령을 기록했습니다", "success");
      setOpen(false); setForm({ kind: "transfer", date: todayKst(), department: "", position: "", salary: 0, reason: "" }); refresh();
    } catch (e) { toast(friendlyError(e, "기록하지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };
  const remove = async (id: string) => {
    if (!window.confirm("이 발령 기록을 지울까요? 현재 부서·직책은 바뀌지 않습니다.")) return;
    try { await deleteAppointment(id); refresh(); } catch (e) { toast(friendlyError(e, "지우지 못했습니다"), "error"); }
  };
  const importLegacy = async () => {
    setBusy(true);
    try { const n = await importLegacyAppointments(companyId, employeeId, emp, userId); toast(n ? `옛 기록 ${n}건을 발령 이력으로 가져왔습니다` : "가져올 새 기록이 없습니다", n ? "success" : "info"); refresh(); }
    catch (e) { toast(friendlyError(e, "가져오지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };
  const recordCard = async () => {
    setBusy(true);
    try {
      const co = logRead("appointments:company", await (supabase as any).from("companies").select("name, representative, business_number, address, seal_url").eq("id", companyId).maybeSingle());
      const blob = await generatePersonnelRecordCard({
        employee: { name: emp?.name || "", department: emp?.department || undefined, position: emp?.position || undefined, hire_date: emp?.hire_date || todayKst(), employee_number: emp?.employee_number || undefined, birth_date: emp?.birth_date || undefined,
          employment_type: ({ full_time: "정규직", part_time: "파트타임", contract: "계약직", intern: "인턴", freelancer: "프리랜서", temporary: "임시직" } as Record<string, string>)[emp?.employment_type] || emp?.employment_type || undefined, email: emp?.email || undefined, phone: emp?.phone || undefined, end_date: emp?.resignation_date || undefined },
        company: { name: co?.name || "", representative: co?.representative || undefined, address: co?.address || undefined, business_number: co?.business_number || undefined, seal_url: co?.seal_url || undefined },
        history: appointmentLines(list),
      });
      const url = URL.createObjectURL(blob); const a = document.createElement("a"); a.href = url; a.download = `인사기록카드_${emp?.name || ""}_${todayKst()}.pdf`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 5000);
      toast("인사기록카드 PDF 를 내려받았습니다", "success");
    } catch (e) { toast(friendlyError(e, "만들지 못했습니다"), "error"); }
    finally { setBusy(false); }
  };
  const needsDept = ["transfer", "promotion", "hire", "other"].includes(form.kind);
  return (
    <div className="appt-section">
      <div className="appt-head">
        <span className="inv-hint">부서·직책·급여가 바뀐 기록. <b>현재 부서·직책은 최신 발령</b>에서 옵니다 — 정보 탭에서 고치면 여기엔 남지 않으니 발령으로 기록하세요. 경력증명서·인사기록카드가 이 표를 씁니다.</span>
        <span className="doc-sums-sp" />
        {legacyCount > 0 && <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={importLegacy} title="옛 발령 글자·급여 이력을 이 표로 옮깁니다(중복은 건너뜀)">옛 기록 {legacyCount}건 가져오기</button>}
        <button type="button" className="btn-secondary btn-sm" disabled={busy} onClick={recordCard}>인사기록카드 PDF</button>
        <button type="button" className="btn-primary btn-sm" onClick={() => setOpen(true)}>+ 발령 등록</button>
      </div>
      {isLoading ? <div className="collect-empty">읽는 중…</div> : list.length === 0 ? (
        <div className="collect-empty">발령 기록이 없습니다 — <b>+ 발령 등록</b>{legacyCount > 0 ? " 또는 옛 기록 가져오기" : ""}</div>
      ) : (
        <div className="stg-table-wrap">
          <table className="ev-table ev-lined table-appt">
            <thead><tr><th>발령일</th><th>종류</th><th>부서</th><th>직책</th><th>월급</th><th>사유</th><th>출처</th><th></th></tr></thead>
            <tbody>{list.map((a) => (
              <tr key={a.id}>
                <td className="mono-number">{a.effective_date}</td>
                <td><span className={`appt-kind appt-kind-${a.kind}`}>{kindLabel(a.kind)}</span></td>
                <td>{a.department || <span className="ev-dim">—</span>}</td>
                <td>{a.position || <span className="ev-dim">—</span>}</td>
                <td className="tr mono-number">{a.salary ? `₩${won(a.salary)}` : <span className="ev-dim">—</span>}</td>
                <td className="text-left">{a.reason || ""}</td>
                <td className="ev-dim">{a.source === "manual" ? "직접" : a.source === "legacy" ? "옛 기록" : a.source === "salary_history" ? "급여 이력" : a.source}</td>
                <td><button type="button" className="inv-modal-x" title="지우기" onClick={() => remove(a.id)}>✕</button></td>
              </tr>
            ))}</tbody>
          </table>
        </div>
      )}
      {open && (
        <div className="inv-modal" onClick={() => setOpen(false)}>
          <div className="inv-modal-box" onClick={(e) => e.stopPropagation()}>
            <h3 className="inv-modal-title">발령 등록 — {emp?.name}</h3>
            <p className="inv-modal-desc">발령일이 오늘 이하면 저장과 함께 현재 부서·직책(급여 변경이면 월급)에 반영됩니다. 급여 명세는 다음 계산부터 새 월급을 씁니다.</p>
            <div className="inv-form-grid">
              <label className="inv-field"><span>종류 *</span>
                <select className="field-input" value={form.kind} onChange={(e) => setForm((s) => ({ ...s, kind: e.target.value as AppointmentKind }))}>
                  {APPOINTMENT_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label} — {k.hint}</option>)}
                </select></label>
              <label className="inv-field"><span>발령일 *</span><DateField value={form.date} onChange={(e) => setForm((s) => ({ ...s, date: e.target.value }))} className="field-input" /></label>
              {needsDept && <DepartmentField companyId={companyId} label="부서" value={form.department} onChange={(v) => setForm((s) => ({ ...s, department: v }))} />}
              {needsDept && <PositionField companyId={companyId} label="직책" value={form.position} onChange={(v) => setForm((s) => ({ ...s, position: v }))} />}
              {form.kind === "salary" && <label className="inv-field"><span>바뀐 월급(원) *</span><CurrencyInput value={form.salary} onValueChange={(raw) => setForm((s) => ({ ...s, salary: Number(raw || 0) }))} className="field-input tr" /></label>}
              <label className="inv-field"><span>사유</span><input className="field-input" value={form.reason} onChange={(e) => setForm((s) => ({ ...s, reason: e.target.value }))} placeholder="예: 조직 개편 · 연봉 협상" /></label>
            </div>
            <div className="inv-modal-actions"><span className="doc-sums-sp" /><button type="button" className="btn-secondary btn-sm" onClick={() => setOpen(false)}>취소</button><button type="button" className="btn-primary btn-sm" disabled={busy} onClick={save}>기록</button></div>
          </div>
        </div>
      )}
    </div>
  );
}
