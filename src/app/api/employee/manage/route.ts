import { logRead } from "@/lib/log-read";
// 회사 멤버 관리 — 역할 변경 / 인사파일 등록·해제 / 회사 제외
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Role = "owner" | "admin" | "employee" | "partner";
type Action = "update-role" | "register-hr" | "unregister-hr" | "remove-from-company";

export async function POST(req: NextRequest) {
  try {
    // 1) 호출자 인증 + 권한 (대표/관리자만). service_role 로 RLS 우회하므로 앱 레벨 인가 필수.
    //    (2026-07-06 보안감사 P0: 인증·인가 전무 → 비인증 크로스테넌트 파괴적 쓰기 가능했음)
    const ss = await createSupabaseServerClient();
    const { data: { user: caller } } = await ss.auth.getUser();
    if (!caller) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const admin = createSupabaseAdminClient();
    const callerRow = logRead('manage/route:callerRow', await admin.from("users").select("id, company_id, role").eq("auth_id", caller.id).maybeSingle());
    if (!callerRow?.company_id) return NextResponse.json({ error: "회사 정보를 찾을 수 없습니다." }, { status: 403 });
    if (!["owner", "admin"].includes(callerRow.role || "")) {
      return NextResponse.json({ error: "멤버 관리는 대표/관리자만 가능합니다." }, { status: 403 });
    }
    // 회사 스코프는 body 가 아니라 호출자 소속에서 결정 — 남의 회사 지정 불가
    const companyId = callerRow.company_id;

    const { action, userId, role } = (await req.json()) as {
      action?: Action;
      userId?: string;
      role?: Role;
    };

    if (!action || !userId) {
      return NextResponse.json({ error: "action, userId 필수" }, { status: 400 });
    }

    // 본인 보호 — owner 본인이 자기 role 을 employee 로 바꾸면 회사 관리 불가
    const targetUser = logRead('manage/route:targetUser', await admin
      .from("users")
      .select("id, email, name, role, company_id")
      .eq("id", userId)
      .maybeSingle());
    if (!targetUser || targetUser.company_id !== companyId) {
      return NextResponse.json({ error: "회사 소속 멤버가 아닙니다." }, { status: 404 });
    }

    if (action === "update-role") {
      if (!role || !["owner", "admin", "employee", "partner"].includes(role)) {
        return NextResponse.json({ error: "유효하지 않은 role" }, { status: 400 });
      }
      // owner 가 1명뿐이면 owner role 변경 차단
      if (targetUser.role === "owner" && role !== "owner") {
        const { count } = await admin.from("users")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("role", "owner");
        if ((count || 0) <= 1) {
          return NextResponse.json({ error: "마지막 대표(owner) 의 역할은 변경할 수 없습니다." }, { status: 400 });
        }
      }
      const { error } = await admin.from("users").update({ role }).eq("id", userId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, message: `역할이 ${role} 로 변경되었습니다.` });
    }

    if (action === "register-hr") {
      // 이미 있는지 확인
      const existing = logRead('manage/route:existing', await admin.from("employees")
        .select("id").eq("company_id", companyId).eq("user_id", userId).maybeSingle());
      if (existing?.id) {
        return NextResponse.json({ ok: true, message: "이미 인사파일에 등록되어 있습니다.", employeeId: existing.id });
      }
      const { data: newEmp, error } = await admin.from("employees").insert({
        company_id: companyId,
        user_id: userId,
        email: targetUser.email,
        name: targetUser.name || targetUser.email,
        status: "joined",
      }).select("id").single();
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, message: "인사파일이 생성되었습니다.", employeeId: newEmp.id });
    }

    if (action === "unregister-hr") {
      const { error } = await admin.from("employees")
        .delete().eq("company_id", companyId).eq("user_id", userId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, message: "인사파일에서 제거되었습니다." });
    }

    if (action === "remove-from-company") {
      if (targetUser.role === "owner") {
        const { count } = await admin.from("users")
          .select("id", { count: "exact", head: true })
          .eq("company_id", companyId)
          .eq("role", "owner");
        if ((count || 0) <= 1) {
          return NextResponse.json({ error: "마지막 대표(owner) 는 제외할 수 없습니다." }, { status: 400 });
        }
      }
      // employees 도 같이 제거 (있으면)
      await admin.from("employees").delete().eq("company_id", companyId).eq("user_id", userId);
      // user 의 회사 소속만 NULL (chat 등 FK 보존)
      const { error } = await admin.from("users").update({ company_id: null }).eq("id", userId);
      if (error) return NextResponse.json({ error: error.message }, { status: 500 });
      return NextResponse.json({ ok: true, message: "회사에서 제외되었습니다." });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "서버 오류" }, { status: 500 });
  }
}
