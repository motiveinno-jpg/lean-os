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

    const { action, companyId, employeeId, status, date } = await req.json();

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

    if (action === "checkin") {
      await admin.from("attendance_records")
        .delete()
        .eq("employee_id", employeeId)
        .eq("date", today);

      const { data, error } = await admin.from("attendance_records")
        .insert({
          company_id: companyId,
          employee_id: employeeId,
          date: today,
          check_in: now,
          status: status || "present",
          work_hours: 0,
          overtime_hours: 0,
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
