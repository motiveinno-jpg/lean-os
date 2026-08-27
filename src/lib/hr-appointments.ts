//   발령 이력 — hr_appointments (2026-08-27 인사 3차 G2, 결정 98). 부서·직책·급여의 유일한 출처. employees 칸은 캐시.
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";

export type AppointmentKind = "hire" | "probation_end" | "transfer" | "promotion" | "salary" | "leave_of_absence" | "return" | "resign" | "other";
export const APPOINTMENT_KINDS: { key: AppointmentKind; label: string; hint: string }[] = [
  { key: "hire", label: "입사", hint: "입사일 · 첫 부서·직책" },
  { key: "probation_end", label: "수습 종료", hint: "정규 전환" },
  { key: "transfer", label: "부서 이동", hint: "부서가 바뀜" },
  { key: "promotion", label: "승진·직책", hint: "직책·직위가 바뀜" },
  { key: "salary", label: "급여 변경", hint: "월급이 바뀜 — 급여 명세는 다음 달부터" },
  { key: "leave_of_absence", label: "휴직", hint: "육아·병가 등" },
  { key: "return", label: "복직", hint: "휴직 끝" },
  { key: "resign", label: "퇴사", hint: "퇴사 처리는 정보 탭에서 — 여기는 기록" },
  { key: "other", label: "기타", hint: "겸직·파견 등" },
];
export const kindLabel = (k: string) => APPOINTMENT_KINDS.find((x) => x.key === k)?.label || k;

export type Appointment = { id: string; employee_id: string; kind: AppointmentKind; effective_date: string; department: string | null; position: string | null; salary: number | null; reason: string | null; source: string; created_at: string };

export async function listAppointments(companyId: string, employeeId: string): Promise<Appointment[]> {
  const data = logRead("lib/hr-appointments:list", await (supabase as any).from("hr_appointments").select("id, employee_id, kind, effective_date, department, position, salary, reason, source, created_at")
    .eq("company_id", companyId).eq("employee_id", employeeId).order("effective_date", { ascending: false }).order("created_at", { ascending: false }));
  return ((data || []) as any[]).map((r) => ({ ...r, salary: r.salary == null ? null : Number(r.salary) }));
}

/** 발령 한 줄 추가. 발령일이 오늘 이하면 employees 캐시(부서·직책·급여)를 같이 맞춘다(결정 98). */
export async function addAppointment(companyId: string, a: { employee_id: string; kind: AppointmentKind; effective_date: string; department?: string | null; position?: string | null; salary?: number | null; reason?: string | null; source?: string }, userId: string | null) {
  const { error } = await (supabase as any).from("hr_appointments").insert({ company_id: companyId, employee_id: a.employee_id, kind: a.kind, effective_date: a.effective_date,
    department: a.department || null, position: a.position || null, salary: a.salary ?? null, reason: a.reason || null, source: a.source || "manual", created_by: userId });
  if (error) throw error;
  if (a.effective_date <= todayKst()) {
    const upd: Record<string, unknown> = {};
    if (a.department) upd.department = a.department;
    if (a.position) upd.position = a.position;
    if (a.kind === "salary" && a.salary != null && a.salary > 0) upd.salary = a.salary;
    if (Object.keys(upd).length) { const { error: e2 } = await (supabase as any).from("employees").update(upd).eq("id", a.employee_id); if (e2) throw e2; }
  }
}
export async function deleteAppointment(id: string) {
  const { error } = await (supabase as any).from("hr_appointments").delete().eq("id", id);
  if (error) throw error;
}

/** 옛 기록 가져오기 — employees.employment_history(자유 글자) + salary_history → 발령 행. 사람이 버튼을 눌러야 한다(결정 91·100). 같은 날·같은 내용은 건너뜀. */
export async function importLegacyAppointments(companyId: string, employeeId: string, emp: { hire_date?: string | null; employment_history?: unknown }, userId: string | null): Promise<number> {
  const existing = await listAppointments(companyId, employeeId);
  const key = (k: string, d: string, dep?: string | null, pos?: string | null, sal?: number | null) => `${k}|${d}|${dep || ""}|${pos || ""}|${sal ?? ""}`;
  const seen = new Set(existing.map((e) => key(e.kind, e.effective_date, e.department, e.position, e.salary)));
  const rows: any[] = [];
  const push = (r: any) => { const k = key(r.kind, r.effective_date, r.department, r.position, r.salary); if (!seen.has(k)) { seen.add(k); rows.push({ company_id: companyId, employee_id: employeeId, source: "legacy", created_by: userId, ...r }); } };
  if (emp.hire_date) push({ kind: "hire", effective_date: emp.hire_date, department: null, position: null, salary: null, reason: "입사(자동 이관)" });
  for (const h of (Array.isArray(emp.employment_history) ? emp.employment_history : []) as any[]) {
    if (!h) continue;
    push({ kind: h.position && !h.department ? "promotion" : "transfer", effective_date: String(h.date || "").slice(0, 10) || todayKst(), department: h.department || null, position: h.position || null, salary: null, reason: h.note || null });
  }
  const sh = logRead("lib/hr-appointments:legacy-salary", await (supabase as any).from("salary_history").select("effective_date, salary, change_reason").eq("employee_id", employeeId).order("effective_date"));
  for (const s of ((sh || []) as any[])) push({ kind: "salary", effective_date: String(s.effective_date).slice(0, 10), department: null, position: null, salary: Number(s.salary), reason: s.change_reason || null });
  if (!rows.length) return 0;
  const { error } = await (supabase as any).from("hr_appointments").insert(rows);
  if (error) throw error;
  return rows.length;
}

/** 경력증명서·인사기록카드용 한 줄 요약 — "2025-03-01 개발팀 팀장 (승진·직책)" */
export function appointmentLines(list: Appointment[]): { date: string; text: string }[] {
  return [...list].sort((a, b) => a.effective_date.localeCompare(b.effective_date)).map((a) => ({
    date: a.effective_date,
    text: [a.department, a.position].filter(Boolean).join(" ") + (a.kind === "salary" ? "" : ` (${kindLabel(a.kind)})`) + (a.kind === "salary" && a.salary ? ` 월 ${Math.round(a.salary).toLocaleString("ko-KR")}원 (급여 변경)` : ""),
  }));
}
