import { logRead } from "@/lib/log-read";
// 플랫폼 운영자 액션 API — 관리자 페이지(/platform)에서 실제 운영 조치를 수행.
//   계정 지원: 임시 비밀번호 발급, 재설정 링크 생성, 이메일 변경, 계정 잠금/해제, 역할 변경
//   구독 관리: 플랜 변경, 체험 연장, 구독 상태 변경, 좌석 조정
// 보안 패턴 (employee/manage 와 동일):
//   1) 호출자 세션 인증 → 2) is_platform_operator() RPC 인가 → 3) service_role 로 실행
//   4) 모든 액션 operator_log_action 감사 기록 (임시 비번·링크 등 민감값은 기록 제외)
// 결제 가드: Stripe/Toss 결제가 연결된 구독은 플랜·상태·좌석 변경 차단 (결제사-DB 불일치 사고 방지)
import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { createSupabaseAdminClient } from "@/lib/supabase-admin";

const RESET_REDIRECT = `https://www.owner-view.com/api/auth/callback?next=${encodeURIComponent("/auth/reset?step=new")}`;

type UserAction = "reset-password" | "reset-link" | "change-email" | "set-role" | "ban" | "unban";
type CompanyAction = "extend-trial" | "change-plan" | "set-subscription-status" | "set-seats";
type Action = UserAction | CompanyAction;

const USER_ACTIONS: UserAction[] = ["reset-password", "reset-link", "change-email", "set-role", "ban", "unban"];
const COMPANY_ACTIONS: CompanyAction[] = ["extend-trial", "change-plan", "set-subscription-status", "set-seats"];
const VALID_ROLES = ["owner", "admin", "employee", "partner"] as const;
const VALID_SUB_STATUS = ["active", "trialing", "paused", "canceled"] as const;

// 임시 비밀번호 — 혼동 문자(0/O, 1/l/I) 제외 8자 + 구분자. 예: Ov-K7mRXw4e
function generateTempPassword(): string {
  const chars = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const buf = new Uint32Array(8);
  crypto.getRandomValues(buf);
  let s = "";
  for (const n of buf) s += chars[n % chars.length];
  return `Ov-${s}`;
}

export async function POST(req: NextRequest) {
  try {
    // 1) 인증
    const ss = await createSupabaseServerClient();
    const { data: { user: caller } } = await ss.auth.getUser();
    if (!caller) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    // 2) 인가 — 플랫폼 운영자만 (DB 함수가 @mo-tive.com / 모티브이노베이션 owner 검증)
    const { data: isOperator, error: gateErr } = await ss.rpc("is_platform_operator");
    if (gateErr || !isOperator) {
      return NextResponse.json({ error: "플랫폼 운영자만 사용할 수 있습니다." }, { status: 403 });
    }

    const body = (await req.json()) as {
      action?: Action;
      userId?: string;
      companyId?: string;
      newEmail?: string;
      role?: string;
      days?: number;
      planSlug?: string;
      status?: string;
      seats?: number;
    };
    const { action } = body;
    if (!action) return NextResponse.json({ error: "action 필수" }, { status: 400 });

    const admin = createSupabaseAdminClient();

    // 감사 기록 헬퍼 — 운영자 세션(ss)으로 호출해야 auth.uid() 가 기록됨
    const audit = async (targetType: string, targetId: string, context: Record<string, unknown> | null) => {
      await ss.rpc("operator_log_action", {
        p_action: `admin_${action.replace(/-/g, "_")}`,
        p_target_type: targetType,
        p_target_id: targetId,
        p_context: (context ?? undefined) as never,
      });
    };

    // ── 사용자 대상 액션 ─────────────────────────────────────────
    if ((USER_ACTIONS as string[]).includes(action)) {
      const { userId } = body;
      if (!userId) return NextResponse.json({ error: "userId 필수" }, { status: 400 });

      const target = logRead("platform/admin-action:target", await admin
        .from("users")
        .select("id, auth_id, email, name, role, company_id")
        .eq("id", userId)
        .maybeSingle());
      if (!target) return NextResponse.json({ error: "사용자를 찾을 수 없습니다." }, { status: 404 });
      // 레거시 행은 auth_id 없이 id == auth.uid — auth_id 우선, 없으면 id 로 시도
      const authId = target.auth_id || target.id;

      if (action === "reset-password") {
        const tempPassword = generateTempPassword();
        const { error } = await admin.auth.admin.updateUserById(authId, { password: tempPassword });
        if (error) return NextResponse.json({ error: `비밀번호 변경 실패: ${error.message}` }, { status: 500 });
        await audit("user", userId, { email: target.email });
        return NextResponse.json({ ok: true, tempPassword });
      }

      if (action === "reset-link") {
        const { data, error } = await admin.auth.admin.generateLink({
          type: "recovery",
          email: target.email,
          options: { redirectTo: RESET_REDIRECT },
        });
        if (error || !data?.properties?.action_link) {
          return NextResponse.json({ error: `링크 생성 실패: ${error?.message || "알 수 없음"}` }, { status: 500 });
        }
        await audit("user", userId, { email: target.email });
        return NextResponse.json({ ok: true, link: data.properties.action_link });
      }

      if (action === "change-email") {
        const newEmail = body.newEmail?.trim().toLowerCase();
        if (!newEmail || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
          return NextResponse.json({ error: "유효한 새 이메일이 필요합니다." }, { status: 400 });
        }
        const { error } = await admin.auth.admin.updateUserById(authId, { email: newEmail, email_confirm: true });
        if (error) return NextResponse.json({ error: `이메일 변경 실패: ${error.message}` }, { status: 500 });
        const { error: rowErr } = await admin.from("users").update({ email: newEmail }).eq("id", userId);
        if (rowErr) return NextResponse.json({ error: `프로필 이메일 반영 실패: ${rowErr.message}` }, { status: 500 });
        await audit("user", userId, { from: target.email, to: newEmail });
        return NextResponse.json({ ok: true });
      }

      if (action === "set-role") {
        const role = body.role;
        if (!role || !(VALID_ROLES as readonly string[]).includes(role)) {
          return NextResponse.json({ error: "유효하지 않은 role" }, { status: 400 });
        }
        // 마지막 owner 보호 — 회사 관리 불능 방지
        if (target.role === "owner" && role !== "owner" && target.company_id) {
          const { count } = await admin.from("users")
            .select("id", { count: "exact", head: true })
            .eq("company_id", target.company_id)
            .eq("role", "owner");
          if ((count || 0) <= 1) {
            return NextResponse.json({ error: "회사의 마지막 대표(owner) 역할은 변경할 수 없습니다." }, { status: 400 });
          }
        }
        const { error } = await admin.from("users").update({ role }).eq("id", userId);
        if (error) return NextResponse.json({ error: `역할 변경 실패: ${error.message}` }, { status: 500 });
        await audit("user", userId, { from: target.role, to: role });
        return NextResponse.json({ ok: true });
      }

      if (action === "ban" || action === "unban") {
        // ban_duration: '87600h'(10년) = 사실상 영구 잠금, 'none' = 해제
        const banDuration = action === "ban" ? "87600h" : "none";
        const { error } = await admin.auth.admin.updateUserById(authId, { ban_duration: banDuration } as never);
        if (error) return NextResponse.json({ error: `${action === "ban" ? "잠금" : "해제"} 실패: ${error.message}` }, { status: 500 });
        await audit("user", userId, { email: target.email });
        return NextResponse.json({ ok: true });
      }
    }

    // ── 회사 대상 액션 ─────────────────────────────────────────
    if ((COMPANY_ACTIONS as string[]).includes(action)) {
      const { companyId } = body;
      if (!companyId) return NextResponse.json({ error: "companyId 필수" }, { status: 400 });

      const company = logRead("platform/admin-action:company", await admin
        .from("companies")
        .select("id, name, trial_ends_at")
        .eq("id", companyId)
        .maybeSingle());
      if (!company) return NextResponse.json({ error: "회사를 찾을 수 없습니다." }, { status: 404 });

      const sub = logRead("platform/admin-action:sub", await admin
        .from("subscriptions")
        .select("id, status, plan_id, plan_slug, seat_count, trial_ends_at, stripe_subscription_id, toss_billing_key")
        .eq("company_id", companyId)
        .maybeSingle());

      // 결제 가드 — 결제사가 진실원천인 구독은 DB 단독 변경 금지
      const hasBilling = !!(sub?.stripe_subscription_id || sub?.toss_billing_key);
      if (hasBilling && action !== "extend-trial") {
        return NextResponse.json(
          { error: "Stripe/Toss 결제가 연결된 구독입니다. 결제사 대시보드에서 변경해야 DB와 어긋나지 않습니다." },
          { status: 409 },
        );
      }

      if (action === "extend-trial") {
        if (hasBilling) {
          return NextResponse.json(
            { error: "결제 연동 구독의 체험 기간은 Stripe 대시보드에서 변경하세요." },
            { status: 409 },
          );
        }
        const days = Number(body.days);
        if (!Number.isFinite(days) || days < 1 || days > 365) {
          return NextResponse.json({ error: "days 는 1~365 사이여야 합니다." }, { status: 400 });
        }
        // 기준: 현재 만료일이 미래면 거기서 +days, 지났으면 오늘부터 +days
        const base = company.trial_ends_at && new Date(company.trial_ends_at) > new Date()
          ? new Date(company.trial_ends_at)
          : new Date();
        const newEnd = new Date(base.getTime() + days * 86400_000).toISOString();
        const { error } = await admin.from("companies").update({ trial_ends_at: newEnd }).eq("id", companyId);
        if (error) return NextResponse.json({ error: `체험 연장 실패: ${error.message}` }, { status: 500 });
        if (sub) {
          const { error: subErr } = await admin.from("subscriptions")
            .update({ trial_ends_at: newEnd, updated_at: new Date().toISOString() })
            .eq("id", sub.id);
          if (subErr) return NextResponse.json({ error: `구독 체험일 반영 실패: ${subErr.message}` }, { status: 500 });
        }
        await audit("company", companyId, { days, newEnd });
        return NextResponse.json({ ok: true, trialEndsAt: newEnd });
      }

      if (action === "change-plan") {
        const planSlug = body.planSlug;
        if (!planSlug) return NextResponse.json({ error: "planSlug 필수" }, { status: 400 });
        const plan = logRead("platform/admin-action:plan", await admin
          .from("subscription_plans")
          .select("id, slug, name")
          .eq("slug", planSlug)
          .maybeSingle());
        if (!plan) return NextResponse.json({ error: `요금제를 찾을 수 없습니다: ${planSlug}` }, { status: 404 });

        if (sub) {
          const { error } = await admin.from("subscriptions")
            .update({ plan_id: plan.id, plan_slug: plan.slug, updated_at: new Date().toISOString() })
            .eq("id", sub.id);
          if (error) return NextResponse.json({ error: `플랜 변경 실패: ${error.message}` }, { status: 500 });
        } else {
          const { error } = await admin.from("subscriptions").insert({
            company_id: companyId,
            plan_id: plan.id,
            plan_slug: plan.slug,
            status: "active",
            seat_count: 1,
            billing_cycle: "monthly",
          });
          if (error) return NextResponse.json({ error: `구독 생성 실패: ${error.message}` }, { status: 500 });
        }
        const { error: compErr } = await admin.from("companies").update({ current_plan: plan.slug }).eq("id", companyId);
        if (compErr) return NextResponse.json({ error: `회사 플랜 반영 실패: ${compErr.message}` }, { status: 500 });
        await audit("company", companyId, { from: sub?.plan_slug || null, to: plan.slug });
        return NextResponse.json({ ok: true });
      }

      if (action === "set-subscription-status") {
        const status = body.status;
        if (!status || !(VALID_SUB_STATUS as readonly string[]).includes(status)) {
          return NextResponse.json({ error: "유효하지 않은 status" }, { status: 400 });
        }
        if (!sub) return NextResponse.json({ error: "구독이 없는 회사입니다. 먼저 플랜을 지정하세요." }, { status: 400 });
        const patch: Record<string, unknown> = { status, updated_at: new Date().toISOString() };
        if (status === "canceled") patch.canceled_at = new Date().toISOString();
        const { error } = await admin.from("subscriptions").update(patch as never).eq("id", sub.id);
        if (error) return NextResponse.json({ error: `상태 변경 실패: ${error.message}` }, { status: 500 });
        await audit("company", companyId, { from: sub.status, to: status });
        return NextResponse.json({ ok: true });
      }

      if (action === "set-seats") {
        const seats = Number(body.seats);
        if (!Number.isInteger(seats) || seats < 1 || seats > 500) {
          return NextResponse.json({ error: "seats 는 1~500 사이 정수여야 합니다." }, { status: 400 });
        }
        if (!sub) return NextResponse.json({ error: "구독이 없는 회사입니다. 먼저 플랜을 지정하세요." }, { status: 400 });
        const { error } = await admin.from("subscriptions")
          .update({ seat_count: seats, updated_at: new Date().toISOString() })
          .eq("id", sub.id);
        if (error) return NextResponse.json({ error: `좌석 변경 실패: ${error.message}` }, { status: 500 });
        await audit("company", companyId, { from: sub.seat_count, to: seats });
        return NextResponse.json({ ok: true });
      }
    }

    return NextResponse.json({ error: `알 수 없는 action: ${action}` }, { status: 400 });
  } catch (err) {
    const message = err instanceof Error ? err.message : "서버 오류";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
