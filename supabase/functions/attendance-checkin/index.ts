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
): Promise<{ workStartMin: number; workEndMin: number; lunchMin: number }> {
  const csRes = await admin.from("company_settings")
    .select("work_start_time, work_end_time, lunch_minutes")
    .eq("company_id", companyId)
    .maybeSingle();
  const cs = (csRes.data || {}) as Record<string, unknown>;

  let workStartMin = parseHhmm(cs.work_start_time, 9 * 60);
  let workEndMin = parseHhmm(cs.work_end_time, 18 * 60);
  const lunchRaw = Number(cs.lunch_minutes);
  const lunchMin = Number.isFinite(lunchRaw) && lunchRaw >= 0 ? lunchRaw : 60;

  // 직원 개인 출퇴근시간 override — 있으면 회사 기본값 대신 사용.
  const empRes = await admin.from("employees")
    .select("work_start_time, work_end_time")
    .eq("id", employeeId)
    .maybeSingle();
  const emp = (empRes.data || {}) as Record<string, unknown>;
  workStartMin = parseHhmm(emp.work_start_time, workStartMin);
  workEndMin = parseHhmm(emp.work_end_time, workEndMin);

  return { workStartMin, workEndMin, lunchMin };
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
      const { workStartMin } = await loadWorkSettings(admin, companyId, employeeId);
      const kstDate = new Date(new Date(now).getTime() + 9 * 3600 * 1000);
      const ciKstMin = kstDate.getUTCHours() * 60 + kstDate.getUTCMinutes();

      const isLateFlag = status === "late";
      const lateMinutes = isLateFlag ? Math.max(0, ciKstMin - workStartMin) : 0;

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
          status: status || "present",
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
