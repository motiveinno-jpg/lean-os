// 직원 빠른 등록 API
// - 이미 OwnerView 가입된 이메일이면: 회사 즉시 연결 (이메일 발송 X)
// - 미가입 이메일이면: 일반 invitation 흐름으로 fallback 결과 반환
// - 다른 회사 소속이면: 거부 (사용자에게 경고)
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

type Role = "employee" | "admin";

export async function POST(req: NextRequest) {
  try {
    const { companyId, email, name, role, invitedBy } = (await req.json()) as {
      companyId?: string;
      email?: string;
      name?: string;
      role?: Role;
      invitedBy?: string;
    };

    if (!companyId || !email) {
      return NextResponse.json({ error: "companyId, email 필수" }, { status: 400 });
    }
    const normEmail = email.trim().toLowerCase();
    const normRole: Role = role === "admin" ? "admin" : "employee";

    const admin = createSupabaseAdminClient();

    // 1) auth 에 같은 이메일의 사용자가 있는지 — pagination 으로 전체 검색
    // (기본 listUsers 는 perPage=50, 사용자 50명+ 시 못 찾음)
    let authUser: any = null;
    for (let page = 1; page <= 20; page++) {  // 최대 20페이지 × 200 = 4000명
      const { data: ulist, error: ulistErr } = await admin.auth.admin.listUsers({
        page,
        perPage: 200,
      });
      if (ulistErr) {
        return NextResponse.json({ error: `auth users 조회 실패: ${ulistErr.message}` }, { status: 500 });
      }
      const users = ulist?.users || [];
      authUser = users.find((u: any) => (u.email || "").toLowerCase() === normEmail);
      if (authUser) break;
      if (users.length < 200) break;  // 마지막 페이지
    }

    if (!authUser) {
      // 미가입 — 일반 invitation 흐름 안내
      return NextResponse.json({ status: "needs_invitation" });
    }

    // 2) users 테이블에서 회사 소속 확인
    const { data: existingUser } = await admin
      .from("users")
      .select("id, company_id, role")
      .eq("auth_id", authUser.id)
      .maybeSingle();

    if (existingUser?.company_id && existingUser.company_id !== companyId) {
      return NextResponse.json(
        { status: "conflict", message: "이미 다른 회사에 소속된 사용자입니다." },
        { status: 409 },
      );
    }

    if (existingUser?.company_id === companyId) {
      return NextResponse.json({
        status: "already_member",
        message: "이미 이 회사의 멤버입니다.",
        userId: existingUser.id,
      });
    }

    // 3) 회사 소속이 NULL — 자동 연결 (재초대 케이스)
    if (existingUser) {
      const { error: uErr } = await admin
        .from("users")
        .update({
          company_id: companyId,
          role: normRole,
          ...(name ? { name } : {}),
        })
        .eq("id", existingUser.id);
      if (uErr) {
        return NextResponse.json({ error: `users 업데이트 실패: ${uErr.message}` }, { status: 500 });
      }
    } else {
      // users row 가 없는 경우 (auth 만 존재) — 새로 insert
      const { error: iErr } = await admin.from("users").insert({
        id: authUser.id,
        auth_id: authUser.id,
        company_id: companyId,
        email: normEmail,
        name: name || authUser.user_metadata?.name || normEmail.split("@")[0],
        role: normRole,
      });
      if (iErr) {
        return NextResponse.json({ error: `users 생성 실패: ${iErr.message}` }, { status: 500 });
      }
    }

    // 4) employees 에 join 시도 (있으면 user_id 연결 + status 'joined')
    const { data: emp } = await admin
      .from("employees")
      .select("id")
      .eq("company_id", companyId)
      .eq("email", normEmail)
      .maybeSingle();
    if (emp?.id) {
      await admin.from("employees").update({
        user_id: authUser.id,
        status: "joined",
        ...(name ? { name } : {}),
      }).eq("id", emp.id);
    }

    // 5) 추적용 invitation row (status='accepted') — 기록 보존
    if (invitedBy) {
      await admin.from("employee_invitations").insert({
        company_id: companyId,
        email: normEmail,
        name: name || null,
        role: normRole,
        invited_by: invitedBy,
        status: "accepted",
        accepted_at: new Date().toISOString(),
      });
    }

    return NextResponse.json({
      status: "auto_added",
      message: "이미 가입된 사용자라서 자동으로 직원으로 등록했습니다.",
      userId: authUser.id,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message || "서버 오류" }, { status: 500 });
  }
}
