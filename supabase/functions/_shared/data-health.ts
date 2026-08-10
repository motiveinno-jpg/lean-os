// 데이터 건강 점검 (2026-08-10 사장님 승인) — 규칙 기반, AI 호출 없음.
//   AI 참모의 get_data_health 툴과 대시보드 ai-briefing 이 같은 모듈을 쓴다.
//   이번 주 수동으로 발견했던 실제 결함류를 규칙으로 굳힌 것:
//   급여 0원/미입력, 연차 잔여 음수, 비정상 지각(720분), 미정산 매출 20억,
//   서명 방치 29건, 퇴근 미기록 등.
//   각 점검은 fail-soft — 하나가 실패해도 나머지는 계속한다.

// deno-lint-ignore no-explicit-any
type Admin = { from: (t: string) => any };

export type HealthFinding = {
  area: string;                       // 급여 | 연차 | 근태 | 결재 | 전자계약 | 세금계산서
  severity: "high" | "medium" | "low";
  title: string;
  detail: string;                     // 이름·수치 포함한 한국어 설명
  count: number;
};

export type HealthReport = {
  findings: HealthFinding[];
  checks_run: number;
  checks_failed: number;
  note: string;
};

const ACTIVE = ["active", "joined", "invited"];

function kstToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}
function daysAgo(n: number): string {
  const t = new Date(Date.parse(`${kstToday()}T00:00:00Z`) - n * 86400000);
  return t.toISOString().slice(0, 10);
}

export async function collectDataHealth(admin: Admin, companyId: string): Promise<HealthReport> {
  const findings: HealthFinding[] = [];
  let failed = 0;
  const today = kstToday();
  const thisYear = Number(today.slice(0, 4));

  // ① 재직자 급여 미입력·0원 — 인건비 합계와 급여명세서가 전부 틀어진다.
  try {
    const { data } = await admin.from("employees")
      .select("name, salary, status").eq("company_id", companyId).in("status", ACTIVE);
    const rows = (data ?? []) as { name: string; salary: number | null }[];
    const missing = rows.filter((r) => r.salary === null).map((r) => r.name);
    const zero = rows.filter((r) => r.salary !== null && Number(r.salary) === 0).map((r) => r.name);
    if (missing.length) {
      findings.push({
        area: "급여", severity: "high", count: missing.length,
        title: `급여 미입력 재직자 ${missing.length}명`,
        detail: `${missing.join(", ")} — 급여가 입력되지 않아 인건비 합계·급여명세서에서 빠집니다. 구성원 화면에서 입력하세요.`,
      });
    }
    if (zero.length) {
      findings.push({
        area: "급여", severity: "medium", count: zero.length,
        title: `급여 0원 재직자 ${zero.length}명`,
        detail: `${zero.join(", ")} — 실제 무급이 아니라면 입력 누락일 가능성이 큽니다.`,
      });
    }
  } catch { failed++; }

  // ② 연차 잔여 음수 — 부여분보다 더 쓴 상태.
  try {
    const { data } = await admin.from("leave_balances")
      .select("employee_id, remaining_days, total_days, used_days")
      .eq("company_id", companyId).eq("year", thisYear).lt("remaining_days", 0);
    const rows = (data ?? []) as { employee_id: string; remaining_days: number; total_days: number; used_days: number }[];
    if (rows.length) {
      const { data: emps } = await admin.from("employees").select("id, name").eq("company_id", companyId);
      const nameOf = new Map(((emps ?? []) as { id: string; name: string }[]).map((e) => [e.id, e.name]));
      findings.push({
        area: "연차", severity: "high", count: rows.length,
        title: `연차 초과 사용 ${rows.length}명`,
        detail: rows.map((r) =>
          `${nameOf.get(r.employee_id) ?? "(미상)"} 잔여 ${Number(r.remaining_days)}일(부여 ${Number(r.total_days)}·사용 ${Number(r.used_days)})`,
        ).join(", ") + " — 연차 부여를 조정하거나 초과분 처리 방침을 정해야 합니다.",
      });
    }
  } catch { failed++; }

  // ③ 비정상 지각 — 4시간 이상 지각으로 기록된 출근. 대부분 출근 시각 입력 오류다.
  try {
    const { data } = await admin.from("attendance_records")
      .select("employee_id, date, late_minutes")
      .eq("company_id", companyId).gte("date", daysAgo(60)).gte("late_minutes", 240)
      .order("late_minutes", { ascending: false }).limit(20);
    const rows = (data ?? []) as { employee_id: string; date: string; late_minutes: number }[];
    if (rows.length) {
      const { data: emps } = await admin.from("employees").select("id, name").eq("company_id", companyId);
      const nameOf = new Map(((emps ?? []) as { id: string; name: string }[]).map((e) => [e.id, e.name]));
      findings.push({
        area: "근태", severity: "medium", count: rows.length,
        title: `지각 4시간 이상 기록 ${rows.length}건 (최근 60일)`,
        detail: rows.slice(0, 5).map((r) =>
          `${nameOf.get(r.employee_id) ?? "(미상)"} ${r.date} ${Math.round(Number(r.late_minutes) / 60)}시간`,
        ).join(", ") + " — 실제 지각인지 출근 시각 입력 오류인지 확인이 필요합니다.",
      });
    }
  } catch { failed++; }

  // ④ 퇴근 미기록 — 어제까지의 근무일인데 출근만 찍힘(자동퇴근도 안 잡힌 것).
  try {
    const { data } = await admin.from("attendance_records")
      .select("employee_id, date")
      .eq("company_id", companyId)
      .gte("date", daysAgo(14)).lt("date", today)
      .not("check_in", "is", null).is("check_out", null);
    const rows = (data ?? []) as { employee_id: string }[];
    if (rows.length) {
      findings.push({
        area: "근태", severity: "low", count: rows.length,
        title: `퇴근 미기록 ${rows.length}건 (최근 14일)`,
        detail: "출근만 찍히고 퇴근이 없어 근무시간이 0으로 잡힙니다. 근태 수정으로 채워야 급여·수당 계산이 맞습니다.",
      });
    }
  } catch { failed++; }

  // ⑤ 서명 방치 — 보낸 지 14일 넘도록 서명이 안 된 요청.
  try {
    const { data } = await admin.from("signature_requests")
      .select("title, signer_name, sent_at")
      .eq("company_id", companyId).in("status", ["sent", "viewed"])
      .lt("sent_at", `${daysAgo(14)}T00:00:00+09:00`)
      .order("sent_at", { ascending: true }).limit(100);
    const rows = (data ?? []) as { title: string; signer_name: string | null; sent_at: string }[];
    if (rows.length) {
      findings.push({
        area: "전자계약", severity: rows.length >= 10 ? "medium" : "low", count: rows.length,
        title: `2주 넘게 서명 안 된 계약 ${rows.length}건`,
        detail: `가장 오래된 것: ${rows[0].title}(${rows[0].signer_name ?? "서명자 미상"}, ${String(rows[0].sent_at).slice(0, 10)} 발송). 재알림을 보내거나 만료 처리하세요.`,
      });
    }
  } catch { failed++; }

  // ⑥ 결재 대기 장기화 — 7일 넘게 pending.
  try {
    const { data } = await admin.from("approval_requests")
      .select("title, created_at")
      .eq("company_id", companyId).eq("status", "pending")
      .lt("created_at", `${daysAgo(7)}T00:00:00+09:00`)
      .order("created_at", { ascending: true }).limit(50);
    const rows = (data ?? []) as { title: string; created_at: string }[];
    if (rows.length) {
      findings.push({
        area: "결재", severity: "medium", count: rows.length,
        title: `일주일 넘게 대기 중인 결재 ${rows.length}건`,
        detail: `가장 오래된 것: ${rows[0].title}(${String(rows[0].created_at).slice(0, 10)} 상신). 승인 또는 반려로 정리하세요.`,
      });
    }
  } catch { failed++; }

  // ⑦ 오래된 미정산 매출 — 발행 90일이 지났는데 정산 입력이 없는 세금계산서.
  //    실제 미수일 수도, 받았는데 정산 입력을 안 한 것일 수도 있다 — 단정하지 않고 확인을 요청한다.
  try {
    const { data } = await admin.from("tax_invoices")
      .select("total_amount, settled_amount")
      .eq("company_id", companyId).eq("type", "sales")
      .neq("status", "cancelled").is("original_invoice_id", null)
      .lt("issue_date", daysAgo(90)).limit(3000);
    const rows = (data ?? []) as { total_amount: number | null; settled_amount: number | null }[];
    let sum = 0, cnt = 0;
    for (const r of rows) {
      const un = Number(r.total_amount ?? 0) - Number(r.settled_amount ?? 0);
      if (un > 0) { sum += un; cnt++; }
    }
    if (cnt > 0) {
      const eok = Math.floor(sum / 1e8); const man = Math.round((sum % 1e8) / 1e4);
      findings.push({
        area: "세금계산서", severity: sum >= 1e8 ? "high" : "medium", count: cnt,
        title: `발행 90일 지난 미정산 매출 ${cnt}건`,
        detail: `합계 약 ${eok > 0 ? `${eok}억 ` : ""}${man.toLocaleString()}만원 — 실제 미수금이면 회수를, 이미 받은 돈이면 정산 입력을 해야 합니다. 이 값이 비정상적으로 크면 정산 입력이 안 되고 있는 것입니다.`,
      });
    }
  } catch { failed++; }

  // ⑧ 지난달 급여명세서 미발급 — 재직자가 있는데 지난달 명세서가 한 건도 없음.
  try {
    const prev = new Date(Date.parse(`${today.slice(0, 7)}-01T00:00:00Z`) - 86400000);
    const prevMonth = `${prev.toISOString().slice(0, 7)}-01`;
    const [{ count: itemCnt }, { count: empCnt }] = await Promise.all([
      admin.from("payroll_items").select("id", { count: "exact", head: true })
        .eq("company_id", companyId).eq("period_month", prevMonth),
      admin.from("employees").select("id", { count: "exact", head: true })
        .eq("company_id", companyId).in("status", ACTIVE),
    ]);
    if ((empCnt ?? 0) > 0 && (itemCnt ?? 0) === 0) {
      findings.push({
        area: "급여", severity: "low", count: 1,
        title: `지난달(${prevMonth.slice(0, 7)}) 급여명세서 미발급`,
        detail: "재직자가 있는데 지난달 명세서가 한 건도 발급되지 않았습니다. 발급해야 급여 기록이 남습니다.",
      });
    }
  } catch { failed++; }

  const order = { high: 0, medium: 1, low: 2 } as const;
  findings.sort((a, b) => order[a.severity] - order[b.severity]);
  return {
    findings,
    checks_run: 8,
    checks_failed: failed,
    note: "규칙 기반 자동 점검입니다. severity high 부터 처리하세요. 문제가 0건인 영역은 목록에 나오지 않습니다.",
  };
}
