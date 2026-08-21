import { withSentry } from "../_shared/sentry.ts";
// Edge Function: complete-signing
// 이메일 링크로 진입한 익명 사용자가 서명을 완료할 수 있도록 service role 로 RLS 우회.
// - 직원 서명 저장 (hr_contract_package_items)
// - 모두 서명 완료 시 패키지 상태 업데이트 + 발송자(owner/admin) 알림
// 인증: sign_token 으로 패키지 검증 (잘못된 토큰이면 거부)

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface SignatureData {
  type: "draw" | "type";
  data: string;
}

interface Body {
  signToken: string;
  itemId: string;
  signatureData: SignatureData;
  saveAsDefault?: boolean;
}

serve(withSentry("complete-signing", async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) {
      return new Response(JSON.stringify({ error: "service env not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json()) as Body;
    const { signToken, itemId, signatureData, saveAsDefault } = body;
    if (!signToken || !itemId || !signatureData) {
      return new Response(JSON.stringify({ error: "signToken, itemId, signatureData required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    // 1) sign_token 으로 패키지 확인
    const { data: pkg, error: pkgErr } = await supabase
      .from("hr_contract_packages")
      .select("id, company_id, status, title, employee_id, created_by, expires_at, notes")
      .eq("sign_token", signToken)
      .maybeSingle();
    if (pkgErr || !pkg) {
      return new Response(JSON.stringify({ error: "invalid sign token" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (pkg.expires_at && new Date(pkg.expires_at) < new Date()) {
      return new Response(JSON.stringify({ error: "expired" }), {
        status: 410,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 2) 이 패키지에 속한 itemId 인지 확인
    const { data: item, error: itemErr } = await supabase
      .from("hr_contract_package_items")
      .select("id, package_id, status, document_id, title")
      .eq("id", itemId)
      .maybeSingle();
    if (itemErr || !item || item.package_id !== pkg.id) {
      return new Response(JSON.stringify({ error: "item not in this package" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    if (item.status === "signed") {
      return new Response(JSON.stringify({ error: "item already signed" }), {
        status: 409,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 3) 아이템 서명 저장
    //   ⚠️ error 를 봐야 한다 (2026-08-21 감사): 저장이 실패해도 아래로 그대로 진행해
    //   직원 화면엔 "서명이 완료되었습니다" 가 뜨는데 **서명 데이터는 저장되지 않은** 상태가 됐다.
    const signedAt = new Date().toISOString();
    const { error: signErr } = await supabase
      .from("hr_contract_package_items")
      .update({ status: "signed", signed_at: signedAt, signature_data: signatureData })
      .eq("id", itemId);
    if (signErr) {
      return new Response(JSON.stringify({ error: `서명 저장 실패: ${signErr.message}` }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // 4) 문서 lock
    if (item.document_id) {
      await supabase
        .from("documents")
        .update({ status: "locked", locked_at: signedAt })
        .eq("id", item.document_id);
    }

    // 5) 직원 saved_signature 저장 옵션
    if (saveAsDefault && pkg.employee_id) {
      await supabase
        .from("employees")
        .update({ saved_signature: signatureData })
        .eq("id", pkg.employee_id);
    }

    // 6) 전체 서명 여부 확인
    const { data: allItems } = await supabase
      .from("hr_contract_package_items")
      .select("id, status")
      .eq("package_id", pkg.id);
    const allSigned = (allItems || []).length > 0 && (allItems || []).every((i: { status: string }) => i.status === "signed");
    const someSigned = (allItems || []).some((i: { status: string }) => i.status === "signed");

    let packageStatus = pkg.status;
    if (allSigned) {
      packageStatus = "completed";
      await supabase
        .from("hr_contract_packages")
        .update({ status: "completed", completed_at: signedAt })
        .eq("id", pkg.id);

      // ★ 계약 완료 → 구성원 반영 (2026-08-21 감사)
      //   종전엔 이 처리가 hr-contracts.ts 의 onAllContractsSigned 에만 있었는데 그 호출부
      //   (signContractItem)가 저장소 어디에도 없는 **죽은 코드**였다. 실제 서명은 이 함수가
      //   처리하므로, 계약이 완료돼도 연봉·계약이력·재직상태가 하나도 안 바뀌었다:
      //   구성원 상세의 '근로 계약(이력)' 이 영원히 비어 있고 연차 자동부여도 안 돌았다.
      try {
        let annualSalary = 0;
        try {
          const meta = typeof pkg.notes === "string" ? JSON.parse(pkg.notes) : pkg.notes;
          if (meta?.salary) annualSalary = Number(meta.salary) || 0;
        } catch { /* notes 가 JSON 이 아니면 급여 반영은 생략 */ }

        if (annualSalary > 0 && pkg.employee_id) {
          const monthlySalary = Math.round(annualSalary / 12);
          const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);   // KST
          const nextYear = new Date(Date.now() + 9 * 3600 * 1000);
          nextYear.setFullYear(nextYear.getFullYear() + 1);

          const { error: salErr } = await supabase.from("employees")
            .update({ salary: monthlySalary }).eq("id", pkg.employee_id);
          if (salErr) throw salErr;

          await supabase.from("salary_history").insert({
            company_id: pkg.company_id,
            employee_id: pkg.employee_id,
            effective_date: today,
            salary: monthlySalary,
            change_reason: "연봉계약 체결",
          });

          // 같은 계약으로 두 번 만들지 않는다(재서명·재실행 대비)
          const { data: existingContract } = await supabase.from("employee_contracts")
            .select("id").eq("employee_id", pkg.employee_id).eq("start_date", today).maybeSingle();
          if (!existingContract) {
            await supabase.from("employee_contracts").insert({
              company_id: pkg.company_id,
              employee_id: pkg.employee_id,
              contract_type: "full_time",
              start_date: today,
              end_date: nextYear.toISOString().slice(0, 10),
              salary: monthlySalary,
              status: "active",
            });
          }
        }

        // 온보딩 완료 → 재직 상태로
        if (pkg.employee_id) {
          await supabase.from("employees").update({ status: "active" }).eq("id", pkg.employee_id);
        }
      } catch (e) {
        // 서명 자체는 막지 않되 조용히 사라지지 않게 남긴다
        console.error("contract completion side effects failed:", e);
        await supabase.from("error_logs").insert({
          company_id: pkg.company_id,
          source: "manual",
          error_type: "contract_completion",
          message: `[전자계약] 완료 후 구성원 반영 실패 — package=${pkg.id}: ${(e as Error)?.message || e}`,
          url: "supabase/functions/complete-signing",
        }).select().maybeSingle();
      }
    } else if (someSigned) {
      packageStatus = "partially_signed";
      await supabase
        .from("hr_contract_packages")
        .update({ status: "partially_signed" })
        .eq("id", pkg.id);
    }

    // 7) 감사 로그 (notes JSON 의 audit_trail 배열)
    try {
      let notesObj: Record<string, unknown> = {};
      if (pkg.notes) {
        try {
          const parsed = JSON.parse(pkg.notes);
          if (typeof parsed === "object" && parsed && !Array.isArray(parsed)) notesObj = parsed;
          else if (Array.isArray(parsed)) notesObj = { audit_trail: parsed };
        } catch { /* ignore */ }
      }
      const trail = Array.isArray(notesObj.audit_trail) ? (notesObj.audit_trail as Array<Record<string, unknown>>) : [];
      trail.push({
        action: signatureData.type === "draw" ? "signature_drawn" : "signature_typed",
        timestamp: signedAt,
        actor: "signer",
        details: `서명 방식: ${signatureData.type === "draw" ? "직접 그리기" : "텍스트 입력"} (${item.title || ""})`,
      });
      if (allSigned) {
        trail.push({
          action: "document_completed",
          timestamp: signedAt,
          actor: "signer",
          details: `전체 ${(allItems || []).length}건 서명 완료`,
        });
      }
      notesObj.audit_trail = trail;
      await supabase
        .from("hr_contract_packages")
        .update({ notes: JSON.stringify(notesObj) })
        .eq("id", pkg.id);
    } catch (e) {
      console.warn("audit trail update failed:", e);
    }

    // 8) 모두 서명 완료 → 발송자(created_by) + 회사 owner/admin 에게 인앱 알림
    let notificationsSent = 0;
    if (allSigned) {
      try {
        const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
        const recipientIds = new Set<string>();
        if (pkg.created_by && UUID_RE.test(pkg.created_by)) recipientIds.add(pkg.created_by);
        const { data: admins } = await supabase
          .from("users")
          .select("id")
          .eq("company_id", pkg.company_id)
          .in("role", ["owner", "admin"]);
        (admins || []).forEach((a: { id: string }) => recipientIds.add(a.id));

        // 직원 이름 (알림 message 용)
        const { data: emp } = await supabase
          .from("employees")
          .select("name")
          .eq("id", pkg.employee_id)
          .maybeSingle();
        const empName = (emp && (emp as { name?: string }).name) || "직원";

        const rows = Array.from(recipientIds).map((uid) => ({
          company_id: pkg.company_id,
          user_id: uid,
          type: "signature_request",
          title: `서명 완료 — ${pkg.title}`,
          message: `${empName} 이(가) 계약서에 서명을 완료했습니다.`,
          entity_type: "hr_contract_package",
          entity_id: pkg.id,
          is_read: false,
        }));
        if (rows.length > 0) {
          const { error: notifErr } = await supabase.from("notifications").insert(rows);
          if (notifErr) console.warn("notification insert failed:", notifErr);
          else notificationsSent = rows.length;
        }
      } catch (e) {
        console.warn("notification dispatch failed:", e);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        packageStatus,
        allSigned,
        signedAt,
        notificationsSent,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[complete-signing] unhandled error:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
