import { withSentry } from "../_shared/sentry.ts";
// Edge Function: operator-user-admin
// 운영자(@mo-tive.com) 전용 — 유저 계정 조회 및 수정.
// 조회(lookup)는 운영자 인증만으로 가능, 수정(update)은 OPERATOR_ADMIN_KEY 추가 검증 필요.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 운영자가 수정 가능한 필드 화이트리스트
const USER_EDITABLE = ["name", "email", "role"] as const;
const ALLOWED_ROLES = ["owner", "admin", "employee", "partner"];

serve(withSentry("operator-user-admin", async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_ROLE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const ANON = Deno.env.get("SUPABASE_ANON_KEY");
    const OPERATOR_ADMIN_KEY = Deno.env.get("OPERATOR_ADMIN_KEY");
    if (!SUPABASE_URL || !SERVICE_ROLE) return json({ error: "service env 미설정" }, 500);

    // 1) 호출자 인증 — JWT 에서 운영자(@mo-tive.com) 확인
    const authHeader = req.headers.get("Authorization") || "";
    const token = authHeader.replace(/^Bearer\s+/i, "");
    if (!token) return json({ error: "인증 토큰 없음" }, 401);

    const authClient = createClient(SUPABASE_URL, ANON || SERVICE_ROLE, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { autoRefreshToken: false, persistSession: false },
    });
    const { data: userData, error: userErr } = await authClient.auth.getUser();
    if (userErr || !userData.user) return json({ error: "유효하지 않은 세션" }, 401);
    const callerEmail = userData.user.email || "";
    if (!/@mo-tive\.com$/i.test(callerEmail)) {
      return json({ error: "운영자 전용 기능입니다 (@mo-tive.com)" }, 403);
    }

    const svc = createClient(SUPABASE_URL, SERVICE_ROLE, {
      auth: { autoRefreshToken: false, persistSession: false },
    });

    const body = await req.json();
    const mode = body?.mode as "lookup" | "update";

    // ── 조회 ──
    if (mode === "lookup") {
      const q = String(body?.query || "").trim();
      if (!q) return json({ error: "검색어(이메일 또는 ID)를 입력하세요" }, 400);

      let userRow: any = null;
      const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(q);
      if (isUuid) {
        const { data } = await svc.from("users").select("*").or(`id.eq.${q},auth_id.eq.${q}`).maybeSingle();
        userRow = data;
      }
      if (!userRow) {
        const { data } = await svc.from("users").select("*").ilike("email", q).maybeSingle();
        userRow = data;
      }
      if (!userRow) {
        // 부분 일치 후보 목록
        const { data: candidates } = await svc
          .from("users")
          .select("id, email, name, role, company_id")
          .ilike("email", `%${q}%`)
          .limit(10);
        return json({ found: false, candidates: candidates || [] });
      }

      let company: any = null;
      if (userRow.company_id) {
        const { data: c } = await svc
          .from("companies")
          .select("id, name, business_number, representative, address, phone")
          .eq("id", userRow.company_id)
          .maybeSingle();
        company = c;
      }
      // auth.users 부가정보 (마지막 로그인 등)
      let authInfo: any = null;
      if (userRow.auth_id) {
        const { data: au } = await svc.auth.admin.getUserById(userRow.auth_id);
        if (au?.user) {
          authInfo = {
            last_sign_in_at: au.user.last_sign_in_at,
            created_at: au.user.created_at,
            email_confirmed_at: au.user.email_confirmed_at,
            banned_until: (au.user as any).banned_until || null,
          };
        }
      }
      return json({ found: true, user: userRow, company, auth: authInfo });
    }

    // ── 회원 에러 로그 조회 ──
    if (mode === "errors") {
      const email = String(body?.email || "").trim().toLowerCase();
      if (!email) return json({ error: "email 필요" }, 400);

      const { data: logs, error: logErr } = await svc
        .from("error_logs")
        .select("id, source, error_type, message, url, context, resolved, created_at, company_id")
        .ilike("user_email", email)
        .order("created_at", { ascending: false })
        .limit(50);
      if (logErr) return json({ error: `에러로그 조회 실패: ${logErr.message}` }, 500);

      // 통계: 유형별 카운트, 해결/미해결, 최근 7일/30일
      const now = Date.now();
      const D7 = 7 * 86400_000;
      const D30 = 30 * 86400_000;
      const stats = {
        total: logs?.length || 0,
        unresolved: 0,
        last_7d: 0,
        last_30d: 0,
        by_type: {} as Record<string, number>,
        by_source: {} as Record<string, number>,
      };
      for (const l of logs || []) {
        if (!l.resolved) stats.unresolved++;
        const t = new Date(l.created_at).getTime();
        if (now - t <= D7) stats.last_7d++;
        if (now - t <= D30) stats.last_30d++;
        const et = l.error_type || "unknown";
        stats.by_type[et] = (stats.by_type[et] || 0) + 1;
        const sc = l.source || "unknown";
        stats.by_source[sc] = (stats.by_source[sc] || 0) + 1;
      }
      return json({ logs: logs || [], stats });
    }

    // ── 수정 (관리자 키 필요) ──
    if (mode === "update") {
      if (!OPERATOR_ADMIN_KEY) return json({ error: "서버에 OPERATOR_ADMIN_KEY 미설정" }, 500);
      if (String(body?.adminKey || "") !== OPERATOR_ADMIN_KEY) {
        return json({ error: "관리자 키가 올바르지 않습니다" }, 403);
      }
      const userId = String(body?.userId || "");
      if (!userId) return json({ error: "userId 필요" }, 400);
      const updates = (body?.updates || {}) as Record<string, unknown>;

      const patch: Record<string, unknown> = {};
      for (const k of USER_EDITABLE) {
        if (k in updates && updates[k] !== undefined) {
          if (k === "role" && !ALLOWED_ROLES.includes(String(updates[k]))) {
            return json({ error: `role 은 ${ALLOWED_ROLES.join("/")} 만 가능` }, 400);
          }
          patch[k] = updates[k];
        }
      }
      if (Object.keys(patch).length === 0) return json({ error: "변경할 항목 없음" }, 400);

      const { data: before } = await svc.from("users").select("*").eq("id", userId).maybeSingle();
      if (!before) return json({ error: "해당 유저를 찾을 수 없음" }, 404);

      const { data: updated, error: upErr } = await svc
        .from("users")
        .update(patch)
        .eq("id", userId)
        .select()
        .maybeSingle();
      if (upErr) return json({ error: `수정 실패: ${upErr.message}` }, 500);

      // 이메일 변경 시 auth.users 도 동기화
      if (patch.email && before.auth_id) {
        try {
          await svc.auth.admin.updateUserById(before.auth_id, { email: String(patch.email) });
        } catch (e) {
          console.warn("auth email sync 실패:", e);
        }
      }

      // 감사 로그 (error_logs 가 아닌 audit_logs 가 있으면 거기로)
      try {
        await svc.from("audit_logs").insert({
          company_id: before.company_id,
          user_id: null,
          entity_type: "user",
          entity_id: userId,
          action: "update",
          metadata: { by: callerEmail, patch, actor: "operator" },
        });
      } catch { /* audit 실패 무시 */ }

      return json({ success: true, before, after: updated });
    }

    return json({ error: "mode 는 lookup / update / errors" }, 400);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[operator-user-admin]", msg);
    return json({ error: msg }, 500);
  }
}));
