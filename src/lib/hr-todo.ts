//   인사 '처리할 것' — 기한·근태 이상·연차촉진을 규칙으로 모은다 (2026-08-27 인사 5차 G4·H4·H5·H6, 결정 99)
//   토큰 0. 화면 안 요약 줄 + 팝업만 — 자동 메일·자동 통보 없음. 출처: 규칙 / 근태 집계.
import { supabase } from "@/lib/supabase";
import { logRead } from "@/lib/log-read";
import { todayKst } from "@/lib/kst";
import { getLeavePromotionCandidates } from "@/lib/hr";

export type HrTodoItem = { employee_id?: string; name: string; text: string; date?: string };
export type HrTodoGroup = { key: string; label: string; source: "규칙" | "근태 집계"; hint: string; go?: string; items: HrTodoItem[] };

const addDays = (d: string, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().slice(0, 10); };
const dday = (d: string, today: string) => Math.round((new Date(d).getTime() - new Date(today).getTime()) / 86400000);

export async function fetchHrTodos(companyId: string, employees: { id: string; name: string; hire_date?: string | null; status?: string | null }[]): Promise<HrTodoGroup[]> {
  const today = todayKst();
  const active = employees.filter((e) => ["active", "joined"].includes(String(e.status || "")));
  const nameOf = new Map(active.map((e) => [e.id, e.name]));
  const groups: HrTodoGroup[] = [];

  // ── G4 기한 ──
  const [contracts, pkgs, holidays] = await Promise.all([
    logRead("hr-todo:contracts", await (supabase as any).from("employee_contracts").select("employee_id, end_date, probation_end_date, status").eq("company_id", companyId).eq("status", "active")),
    logRead("hr-todo:pkgs", await (supabase as any).from("hr_contract_packages").select("employee_id, status, sent_at").eq("company_id", companyId).eq("status", "sent")),
    logRead("hr-todo:holidays", await (supabase as any).from("holidays").select("date").eq("company_id", companyId).eq("type", "legal")),
  ]);
  const exp: HrTodoItem[] = [], prob: HrTodoItem[] = [];
  for (const c of ((contracts || []) as any[])) {
    if (!nameOf.has(c.employee_id)) continue;
    if (c.end_date) { const n = dday(c.end_date, today); if (n >= -30 && n <= 30) exp.push({ employee_id: c.employee_id, name: nameOf.get(c.employee_id)!, text: n < 0 ? `계약 만료 ${-n}일 지남` : n === 0 ? "오늘 계약 만료" : `계약 만료 D-${n}`, date: c.end_date }); }
    if (c.probation_end_date) { const n = dday(c.probation_end_date, today); if (n >= -7 && n <= 7) prob.push({ employee_id: c.employee_id, name: nameOf.get(c.employee_id)!, text: n < 0 ? `수습 종료 ${-n}일 지남 — 정규 전환 발령` : `수습 종료 D-${n}`, date: c.probation_end_date }); }
  }
  if (exp.length) groups.push({ key: "contract_end", label: "근로계약 만료", source: "규칙", hint: "만료 30일 전부터 · 갱신 계약서를 보내거나 퇴사 처리", go: "contracts", items: exp });
  if (prob.length) groups.push({ key: "probation", label: "수습 종료", source: "규칙", hint: "7일 전부터 · 정규 전환은 이력 탭 발령으로", go: "history", items: prob });
  const anniv: HrTodoItem[] = [];
  for (const e of active) {
    if (!e.hire_date) continue;
    const h = new Date(e.hire_date); const y1 = new Date(h); y1.setFullYear(h.getFullYear() + 1); const d1 = y1.toISOString().slice(0, 10);
    const n = dday(d1, today); if (n >= 0 && n <= 30) anniv.push({ employee_id: e.id, name: e.name, text: `입사 1주년 D-${n} — 월 1일 연차에서 법정 연차(15일)로 바뀝니다`, date: d1 });
  }
  if (anniv.length) groups.push({ key: "anniv", label: "입사 1주년(연차 전환)", source: "규칙", hint: "자동 발생 cron 이 처리하지만, 수동 부여 회사는 휴가 탭에서 확인", go: "leave", items: anniv });
  const unsigned: HrTodoItem[] = [];
  for (const p of ((pkgs || []) as any[])) { if (!p.sent_at || !nameOf.has(p.employee_id)) continue; const n = -dday(String(p.sent_at).slice(0, 10), today); if (n >= 7) unsigned.push({ employee_id: p.employee_id, name: nameOf.get(p.employee_id)!, text: `계약서 미서명 ${n}일 — 재발송·독촉`, date: String(p.sent_at).slice(0, 10) }); }
  if (unsigned.length) groups.push({ key: "unsigned", label: "계약서 미서명 7일+", source: "규칙", hint: "근로계약·서식 › 계약 발송·현황에서 재발송", go: "contracts", items: unsigned });
  const years = new Set(((holidays || []) as any[]).map((h) => String(h.date).slice(0, 4)));
  const thisY = today.slice(0, 4), nextY = String(Number(thisY) + 1);
  const hol: HrTodoItem[] = [];
  if (!years.has(thisY)) hol.push({ name: "회사", text: `${thisY}년 법정 공휴일이 없습니다 — 근태 › 근무 기준에서 채우기` });
  if (today.slice(5) >= "11-01" && !years.has(nextY)) hol.push({ name: "회사", text: `${nextY}년 법정 공휴일이 없습니다 — 근태 › 근무 기준에서 채우기` });
  if (hol.length) groups.push({ key: "holidays", label: "공휴일 미등록", source: "규칙", hint: "결근 자동 판정이 공휴일을 모르면 틀린다", items: hol });

  // ── H5 연차촉진 대상 ──
  try {
    const cands = await getLeavePromotionCandidates(companyId, Number(thisY));
    const promo = (cands as any[]).filter((c) => c.remainingDays >= 5 && nameOf.has(c.employeeId)).map((c) => ({ employee_id: c.employeeId, name: c.employeeName, text: `미사용 연차 ${c.remainingDays}일` }));
    if (promo.length && today.slice(5) >= "07-01") groups.push({ key: "promotion", label: "연차촉진 대상", source: "규칙", hint: "잔여 5일 이상 · 7월부터 · 1차 통보(6개월 전)·2차(2개월 전)는 휴가 탭 촉진에서", go: "leave", items: promo });
  } catch { /* 권한 없으면 건너뜀 */ }

  // ── H4 근태 이상 ──
  const monthStart = today.slice(0, 8) + "01";
  const dow = new Date(today).getDay(); const weekStart = addDays(today, -((dow + 6) % 7));   // 월요일
  const att = logRead("hr-todo:att", await (supabase as any).from("attendance_records").select("employee_id, date, is_late, auto_clocked_out, regular_minutes, overtime_minutes, holiday_minutes")
    .eq("company_id", companyId).gte("date", addDays(monthStart, -14)).lte("date", today).order("date", { ascending: false }).limit(5000));
  const byEmp = new Map<string, any[]>();
  for (const r of ((att || []) as any[])) { if (!nameOf.has(r.employee_id)) continue; byEmp.set(r.employee_id, [...(byEmp.get(r.employee_id) || []), r]); }
  const over: HrTodoItem[] = [], late: HrTodoItem[] = [], auto: HrTodoItem[] = [];
  for (const [id, rows] of byEmp) {
    const name = nameOf.get(id)!;
    const week = rows.filter((r) => r.date >= weekStart);
    const worked = week.length; const mins = week.reduce((s, r) => s + Number(r.regular_minutes || 0) + Number(r.overtime_minutes || 0) + Number(r.holiday_minutes || 0), 0);
    if (worked >= 2 && worked < 5) { const proj = (mins / worked) * 5; if (proj >= 52 * 60) over.push({ employee_id: id, name, text: `이번 주 ${worked}일 ${Math.round(mins / 60)}h — 이대로면 주 ${Math.round(proj / 60)}h (52h 초과 예상)` }); }
    else if (worked >= 5 && mins >= 52 * 60) over.push({ employee_id: id, name, text: `이번 주 ${Math.round(mins / 60)}h — 52h 초과` });
    const last3 = rows.slice(0, 3); if (last3.length === 3 && last3.every((r) => r.is_late)) late.push({ employee_id: id, name, text: `최근 3일 연속 지각 (${last3[2].date}~${last3[0].date})` });
    const ac = rows.filter((r) => r.date >= monthStart && r.auto_clocked_out).length; if (ac >= 5) auto.push({ employee_id: id, name, text: `이번 달 퇴근 누락(자동 마감) ${ac}회 — 기록 확인` });
  }
  if (over.length) groups.push({ key: "over52", label: "주 52시간 초과·예상", source: "근태 집계", hint: "월~오늘 근무시간을 5일로 늘려 본 예측", go: "attendance", items: over });
  if (late.length) groups.push({ key: "late3", label: "연속 지각 3회", source: "근태 집계", hint: "면담·기록 정정", go: "attendance", items: late });
  if (auto.length) groups.push({ key: "autoout", label: "퇴근 누락 잦음", source: "근태 집계", hint: "자동 마감된 날의 실제 퇴근 시각을 정정", go: "attendance", items: auto });
  return groups;
}
