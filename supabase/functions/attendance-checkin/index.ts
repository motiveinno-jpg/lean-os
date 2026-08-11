import { withSentry } from "../_shared/sentry.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const KST_OFFSET_MS = 9 * 3600 * 1000;

function parseHhmm(v: unknown, fallback: number): number {
  if (typeof v !== "string" || !/^\d{2}:\d{2}/.test(v)) return fallback;
  const [h, m] = v.slice(0, 5).split(":");
  return (Number(h) || 0) * 60 + (Number(m) || 0);
}

/**
 * 근무시간 정책 로드 — 회사 기본값 + 직원 개인 override.
 * 지각 판정(checkin)과 근무·연장 산정(checkout)이 같은 값을 쓰도록 한 곳에 모았다.
 */
// deno-lint-ignore no-explicit-any
async function loadWorkSettings(
  admin: any,
  companyId: string,
  employeeId: string,
): Promise<{ workStartMin: number; workEndMin: number; lunchMin: number; graceMin: number; workdaysMask: number }> {
  const csRes = await admin.from("company_settings")
    .select("work_start_time, work_end_time, lunch_minutes, late_grace_minutes, workdays_mask")
    .eq("company_id", companyId)
    .maybeSingle();
  const cs = (csRes.data || {}) as Record<string, unknown>;

  let workStartMin = parseHhmm(cs.work_start_time, 9 * 60);
  let workEndMin = parseHhmm(cs.work_end_time, 18 * 60);
  const lunchRaw = Number(cs.lunch_minutes);
  const lunchMin = Number.isFinite(lunchRaw) && lunchRaw >= 0 ? lunchRaw : 60;
  // 지각 유예 — 미설정이면 lib/hr.ts 의 기존 기본값(30분)과 동일하게 둔다.
  const graceRaw = Number(cs.late_grace_minutes);
  const graceMin = Number.isFinite(graceRaw) ? Math.max(0, Math.min(240, Math.trunc(graceRaw))) : 30;
  const maskRaw = Number(cs.workdays_mask);
  const workdaysMask = Number.isFinite(maskRaw) && maskRaw > 0 ? Math.trunc(maskRaw) : 31;  // 기본 월~금

  // 직원 개인 출퇴근시간 override — 있으면 회사 기본값 대신 사용.
  const empRes = await admin.from("employees")
    .select("work_start_time, work_end_time")
    .eq("id", employeeId)
    .maybeSingle();
  const emp = (empRes.data || {}) as Record<string, unknown>;
  workStartMin = parseHhmm(emp.work_start_time, workStartMin);
  workEndMin = parseHhmm(emp.work_end_time, workEndMin);

  return { workStartMin, workEndMin, lunchMin, graceMin, workdaysMask };
}

/** KST 기준 요일 비트 (월=1,화=2,수=4,목=8,금=16,토=32,일=64) — attendance-calc.ts 와 동일 규칙 */
function workdayBit(dateStr: string): number {
  // 날짜 문자열은 이미 KST 기준일이다. UTC 자정으로 만들어 getUTCDay() 하면 KST 요일과 같다
  //   (attendance-calc.ts dayOfWeekKst 와 동일 — KST 자정 인스턴트를 쓰면 요일이 하루 밀린다).
  const [y, m, d] = dateStr.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();   // 0=일
  return [64, 1, 2, 4, 8, 16, 32][dow];
}

/** 그 날(check_in 이 속한 KST 날짜)의 지정 출근시각을 epoch ms 로 */
function scheduledStartMs(checkInIso: string, workStartMin: number): number {
  const kst = new Date(new Date(checkInIso).getTime() + KST_OFFSET_MS);
  const kstMidnightMs = Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()) - KST_OFFSET_MS;
  return kstMidnightMs + workStartMin * 60_000;
}

serve(withSentry("attendance-checkin", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const anonClient = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_ANON_KEY") ?? "",
      { global: { headers: { Authorization: authHeader } } }
    );
    const { data: { user } } = await anonClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { action, companyId, employeeId, status, date, overtimeRequestId } = await req.json();

    if (!companyId || !employeeId) {
      return new Response(JSON.stringify({ error: "companyId, employeeId required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(
      Deno.env.get("SUPABASE_URL") ?? "",
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    );

    // ⚠️ toISOString().slice(0,10) 은 UTC 날짜라 KST 00:00~08:59 출근이 "어제" 로 기록됐다.
    //    근태는 전부 KST 기준이므로 날짜도 KST 로 뽑는다(2026-07-27).
    const today = date || new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
    const now = new Date().toISOString();

    const { data: empCheck } = await admin.from("employees").select("id").eq("id", employeeId).maybeSingle();
    if (!empCheck) {
      return new Response(JSON.stringify({ error: "직원 정보를 찾을 수 없습니다. 관리자에게 문의하세요." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "checkin") {
      await admin.from("attendance_records")
        .delete()
        .eq("employee_id", employeeId)
        .eq("date", today);

      // 회귀픽스 (2026-05-21): INSERT 시 is_late / late_minutes 컬럼을 함께 채워
      //   "출근 누를 때마다 행 재생성 → late 컬럼 0" 회귀 차단. KST 분 단위 비교.
      //   클라이언트 hr.ts mark_attendance_late RPC 도 유지 (이중 안전망).
      const { workStartMin, graceMin, workdaysMask } = await loadWorkSettings(admin, companyId, employeeId);
      const kstDate = new Date(new Date(now).getTime() + 9 * 3600 * 1000);
      const ciKstMin = kstDate.getUTCHours() * 60 + kstDate.getUTCMinutes();

      // 지각 판정 수정 (2026-08-07 사장님 제보): 종전에는 클라이언트가 보낸 status 를 그대로
      //   믿어 is_late 를 만들고, late_minutes 도 유예를 빼지 않고 넣었다. 그런데 클라이언트의
      //   getAttendancePolicy() 는 설정을 못 읽으면 기본값(09:00 + 유예 30분)으로 떨어져서,
      //   09:30 출근 + 유예 5분인 회사에서 09:32 출근이 'late' 로 올라왔다. 반면 체크인 직후
      //   도는 mark_attendance_late RPC 는 실제 설정으로 계산해 is_late=false 를 넣어,
      //   같은 행의 status 와 is_late 가 서로 어긋난 채 남았다.
      //   → 이제 엣지가 실제 설정(company_settings + 직원 override)으로 직접 판정하고,
      //     status·is_late·late_minutes 를 한 번에 같은 계산 결과로 채운다.
      const { data: holidayRow } = await admin.from("holidays")
        .select("date").eq("company_id", companyId).eq("date", today).maybeSingle();
      const isHoliday = !!holidayRow || (workdaysMask & workdayBit(today)) === 0;
      //   단, 본인이 고른 근무 형태(재택·반차·결근)는 그대로 보존한다 — 지각 여부와 별개다.
      const chosen = typeof status === "string" && status && !["auto", "present", "late"].includes(status)
        ? status
        : null;

      // 승인된 휴가 반영 (2026-08-11 사장님: 오전 반차 결재 후 출근이 지각으로 기록됨).
      //   src/lib/attendance-calc.ts classifyLeaveForLate 와 동일 규칙 — 엣지는 Deno 라 인라인 복제.
      //   · 종일 휴가(unit=full_day, 또는 시각 없는 부분 휴가 구 데이터) → 지각 없음
      //   · 부분 휴가(반차·시간차) 시작 < 13:00 (오전 커버) → 지각 기준시각 = 휴가 종료시각
      //   · 오후 반차·오후 시간차 → 아침 출근 의무 그대로
      const { data: leaveRows } = await admin.from("leave_requests")
        .select("leave_unit, start_time, end_time, days")
        .eq("employee_id", employeeId)
        .eq("status", "approved")
        .lte("start_date", today)
        .gte("end_date", today);
      let leaveFull = false;
      let hasHalfDay = false;
      let exemptUntilMin = 0;
      for (const l of (leaveRows || []) as Record<string, unknown>[]) {
        const unit = String(l.leave_unit || "");
        const st = String(l.start_time || "").slice(0, 5);
        const en = String(l.end_time || "").slice(0, 5);
        const isPartial = unit === "half_day" || unit === "two_hours" || Number(l.days) === 0.5;
        if (!isPartial || !st || !en) { leaveFull = true; continue; }
        if (unit === "half_day" || Number(l.days) === 0.5) hasHalfDay = true;
        if (st < "13:00") exemptUntilMin = Math.max(exemptUntilMin, parseHhmm(en, 0));
      }
      const lateBase = Math.max(workStartMin, exemptUntilMin);
      const isLateFlag = !isHoliday && !leaveFull && chosen !== "absent" && ciKstMin > lateBase + graceMin;
      const lateMinutes = isLateFlag ? Math.max(0, ciKstMin - lateBase) : 0;
      // 반차 승인일의 자동 status 는 'half_day' — 데이터탭이 status 라벨을 보므로 '반차'로 표시 (2026-08-11)
      const rowStatus = chosen ?? (hasHalfDay ? "half_day" : isLateFlag ? "late" : "present");

      // QA 2026-07-14 (사장님): check_in 은 실제로 찍은 시각 그대로 저장·표시한다(더 이상
      //   지정 출근시간으로 고정하지 않음). "이른 출근이 연장근무로 잡히면 안 된다"는 요구는
      //   attendance-calc.ts의 calcDailyAttendance()가 이미 정규/연장 근무시간 계산 시에만
      //   effCiMin = max(실제 출근, 지정 출근시각) 으로 별도 clamp하고 있어 그대로 유지됨 —
      //   표시용 check_in 원본만 보존하도록 여기서의 강제 고정(clamp)을 제거.
      // overtime_request_id: 클라이언트가 check_can_clock_in_after_hours 게이트 통과 시 전달.
      //   NO_WORK_END / BEFORE_WORK_END 케이스에서는 null 로 전달돼 정상 처리.
      const otReqId = typeof overtimeRequestId === "string" && overtimeRequestId ? overtimeRequestId : null;

      const { data, error } = await admin.from("attendance_records")
        .insert({
          company_id: companyId,
          employee_id: employeeId,
          date: today,
          check_in: now,
          status: rowStatus,
          is_late: isLateFlag,
          late_minutes: lateMinutes,
          work_hours: 0,
          overtime_hours: 0,
          overtime_request_id: otReqId,
        })
        .select()
        .single();

      if (error) throw error;
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "checkout") {
      const { data: record } = await admin.from("attendance_records")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("date", today)
        .maybeSingle();

      if (!record || !record.check_in) {
        return new Response(JSON.stringify({ error: "출근 기록이 없습니다" }), {
          status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      // 근무·연장 산정 (2026-07-27 사장님 제보 수정).
      //   기존: (퇴근-출근) - 1h 고정, 8h 초과분을 연장 → 09:30 출근 회사에서 09:15 에 찍으면
      //         15분이 연장으로 잡혔다. 점심 1h·정시 8h 하드코딩이라 회사 설정도 무시했다.
      //   변경: attendance-calc.ts 의 calcDailyAttendance 와 동일 규칙 —
      //         ① 지정 출근시각보다 이른 출근은 산정 시각을 지정 출근시각으로 clamp
      //            (표시용 check_in 원본은 실제 시각 그대로 유지)
      //         ② 점심·정시는 회사/직원 설정에서 읽는다
      const { workStartMin, workEndMin, lunchMin } = await loadWorkSettings(admin, companyId, employeeId);
      const checkInTime = new Date(record.check_in).getTime();
      const checkOutTime = new Date(now).getTime();
      const effCheckInTime = Math.max(checkInTime, scheduledStartMs(record.check_in, workStartMin));

      const grossMin = Math.max(0, (checkOutTime - effCheckInTime) / 60_000);
      const workMin = grossMin > lunchMin ? grossMin - lunchMin : grossMin;
      // 설정이 비정상이면(정시 <= 0) 법정 8h 로 안전 fallback.
      const nominalRaw = (workEndMin - workStartMin) - lunchMin;
      const nominalMin = nominalRaw > 0 ? nominalRaw : 8 * 60;

      const workHours = Math.round((workMin / 60) * 100) / 100;
      const overtimeHours = Math.round((Math.max(0, workMin - nominalMin) / 60) * 100) / 100;

      const { data, error } = await admin.from("attendance_records")
        .update({ check_out: now, work_hours: workHours, overtime_hours: overtimeHours })
        .eq("id", record.id)
        .select()
        .single();

      if (error) throw error;
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "cancel_checkout") {
      const { error } = await admin.from("attendance_records")
        .update({ check_out: null, work_hours: 0, overtime_hours: 0 })
        .eq("employee_id", employeeId)
        .eq("date", today);

      if (error) throw error;
      return new Response(JSON.stringify({ success: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ error: "Invalid action" }), {
      status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: (err as Error).message }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
