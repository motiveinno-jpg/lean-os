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

serve(async (req) => {
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
    const signedAt = new Date().toISOString();
    await supabase
      .from("hr_contract_package_items")
      .update({ status: "signed", signed_at: signedAt, signature_data: signatureData })
      .eq("id", itemId);

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
});
