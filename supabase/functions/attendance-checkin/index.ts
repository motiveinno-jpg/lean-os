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
 * 근무·연장 산정(checkout)에 쓴다. 지각 판정은 DB 트리거(attendance_judge)가 한다 (2026-09-07).
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

    // 소속 검증 (2026-08-19 감사): 종전엔 body 의 companyId/employeeId 를 그대로 믿어
    //   로그인한 아무 사용자가 타사 직원의 근태를 삭제·조작할 수 있었다(IDOR).
    //   호출자 회사 = body.companyId = 직원 소속 회사 삼자가 일치해야 한다.
    const { data: callerRow } = await admin.from("users")
      .select("id, company_id").eq("auth_id", user.id).maybeSingle();
    if (!callerRow || callerRow.company_id !== companyId) {
      return new Response(JSON.stringify({ error: "권한이 없습니다." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: empCheck } = await admin.from("employees").select("id, company_id").eq("id", employeeId).maybeSingle();
    if (!empCheck) {
      return new Response(JSON.stringify({ error: "직원 정보를 찾을 수 없습니다. 관리자에게 문의하세요." }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (empCheck.company_id !== companyId) {
      return new Response(JSON.stringify({ error: "권한이 없습니다." }), {
        status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "checkin") {
      // delete-then-insert 제거 (2026-08-19 감사): 종전엔 그날 행을 무조건 지우고 다시
      //   만들었다 — 퇴근까지 찍은 날 출근을 또 누르면 check_out·work_hours·overtime_request_id
      //   가 통째로 사라지고, insert 가 실패하면 그날 근태 행 자체가 소멸했다(급여 누락).
      //   codef 재등록 폴백(2026-08-05, 삭제 후 재추가 실패로 9일 수집 중단)과 같은 형태.
      //   → 퇴근 기록이 있으면 거부, 미퇴근 행은 UPDATE 로 출근시각만 갱신, 없을 때만 INSERT.
      const { data: existing } = await admin.from("attendance_records")
        .select("id, check_out, overtime_request_id")
        .eq("employee_id", employeeId)
        .eq("date", today)
        .maybeSingle();
      if (existing?.check_out) {
        return new Response(JSON.stringify({ error: "오늘은 이미 퇴근까지 기록되어 있습니다. 기록 수정이 필요하면 관리자에게 요청하세요." }), {
          status: 409, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      //   지각·휴일·상태 판정은 DB 트리거(attendance_records_judge → attendance_judge)가 한다 (2026-09-07).
      //   여기서는 실제 출근 시각과 본인이 고른 근무 형태만 넘긴다. 예전엔 엣지·브라우저·관리자 저장이
      //   각자 계산해 서로 덮어썼고, 그 결과 status='late' 인데 is_late=false 인 행이 남았다.
      //   본인이 고른 근무 형태(재택·반차·결근)는 그대로 보존 — 지각 여부와 별개다.
      const chosen = typeof status === "string" && status && !["auto", "present", "late"].includes(status)
        ? status
        : null;
      const rowStatus = chosen ?? "present";   // present/late 는 트리거가 시각으로 다시 정한다

      // QA 2026-07-14 (사장님): check_in 은 실제로 찍은 시각 그대로 저장·표시한다.
      //   이른 출근이 연장근무로 잡히지 않게 하는 clamp 는 근무시간 산정(checkout·attendance-calc)에서만 한다.
      // overtime_request_id: 클라이언트가 check_can_clock_in_after_hours 게이트 통과 시 전달.
      const otReqId = typeof overtimeRequestId === "string" && overtimeRequestId ? overtimeRequestId : null;

      const rowValues = {
        company_id: companyId,
        employee_id: employeeId,
        date: today,
        check_in: now,
        status: rowStatus,
        work_hours: 0,
        overtime_hours: 0,
        // 재출근 시 기존 연장근무 승인 연결은 보존 — 새 값이 있을 때만 교체.
        overtime_request_id: otReqId ?? existing?.overtime_request_id ?? null,
      };
      const { data, error } = existing
        ? await admin.from("attendance_records").update(rowValues).eq("id", existing.id).select().single()
        : await admin.from("attendance_records").insert(rowValues).select().single();

      if (error) throw error;
      return new Response(JSON.stringify({ success: true, data }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (action === "checkout") {
      let { data: record } = await admin.from("attendance_records")
        .select("*")
        .eq("employee_id", employeeId)
        .eq("date", today)
        .maybeSingle();

      // 자정 넘긴 퇴근 (2026-08-19 감사): 22시 출근 → 새벽 2시 퇴근이면 today 가 이미
      //   다음날이라 출근 행을 못 찾아 400 이 났다 — 어제 날짜의 미퇴근 행이 있으면 그걸 닫는다.
      //   (attendance-calc 는 자정 넘김·야간가산을 이미 정식 지원)
      if (!record || !record.check_in) {
        const yesterday = new Date(new Date(`${today}T00:00:00Z`).getTime() - 86400000).toISOString().slice(0, 10);
        const { data: prevOpen } = await admin.from("attendance_records")
          .select("*")
          .eq("employee_id", employeeId)
          .eq("date", yesterday)
          .maybeSingle();
        if (prevOpen?.check_in && !prevOpen.check_out) record = prevOpen;
      }

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
