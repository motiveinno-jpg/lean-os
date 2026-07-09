import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req) => {
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

    const today = date || new Date().toISOString().slice(0, 10);
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
      // work_start_time 은 지각판정 + 이른출근 clamp 공용으로 항상 조회.
      const csRes = await admin.from("company_settings")
        .select("work_start_time")
        .eq("company_id", companyId)
        .maybeSingle();
      let wst = "09:00";
      if (csRes.data && typeof csRes.data.work_start_time === "string" && /^\d{2}:\d{2}/.test(csRes.data.work_start_time)) {
        wst = csRes.data.work_start_time.slice(0, 5);
      }
      const wparts = wst.split(":");
      const workStartMin = (Number(wparts[0]) || 0) * 60 + (Number(wparts[1]) || 0);
      const kstDate = new Date(new Date(now).getTime() + 9 * 3600 * 1000);
      const ciKstMin = kstDate.getUTCHours() * 60 + kstDate.getUTCMinutes();

      const isLateFlag = status === "late";
      const lateMinutes = isLateFlag ? Math.max(0, ciKstMin - workStartMin) : 0;

      // 이른 출근(지정 출근시간 전) — check_in 을 지정 출근시각으로 고정(찍힘).
      //   실제 태그시각은 note 에 "실제 출근 HH:MM" 로 보존. 연장·근무시간은 지정시각부터 계산.
      //   (사장님 요청 2026-07-09: 일찍 와도 9:30 로 찍히고, 이른 시간은 연장 미반영.)
      let effectiveCheckIn = now;
      let earlyNote: string | null = null;
      if (ciKstMin < workStartMin) {
        effectiveCheckIn = new Date(`${today}T${wst}:00+09:00`).toISOString();
        const ah = String(Math.floor(ciKstMin / 60)).padStart(2, "0");
        const am = String(ciKstMin % 60).padStart(2, "0");
        earlyNote = `실제 출근 ${ah}:${am}`;
      }

      // overtime_request_id: 클라이언트가 check_can_clock_in_after_hours 게이트 통과 시 전달.
      //   NO_WORK_END / BEFORE_WORK_END 케이스에서는 null 로 전달돼 정상 처리.
      const otReqId = typeof overtimeRequestId === "string" && overtimeRequestId ? overtimeRequestId : null;

      const { data, error } = await admin.from("attendance_records")
        .insert({
          company_id: companyId,
          employee_id: employeeId,
          date: today,
          check_in: effectiveCheckIn,
          status: status || "present",
          is_late: isLateFlag,
          late_minutes: lateMinutes,
          note: earlyNote,
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

      const checkInTime = new Date(record.check_in).getTime();
      const checkOutTime = new Date(now).getTime();
      const diffHours = (checkOutTime - checkInTime) / (1000 * 60 * 60);
      const workHours = Math.round(Math.max(0, diffHours - 1) * 100) / 100;
      const overtimeHours = Math.round(Math.max(0, workHours - 8) * 100) / 100;

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
});
