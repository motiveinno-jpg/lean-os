import { withSentry } from "../_shared/sentry.ts";
/**
 * OwnerView — AI 대표 참모(owner-copilot)
 *   읽기전용 경영 참모. 서버가 회사 스코프 스냅샷(copilot_company_snapshot)을 만들어 Claude 에 전달,
 *   Claude 는 그 스냅샷 + 사용자 질문만으로 답한다. DB 쓰기·외부 발송·임의 쿼리 없음.
 *
 * 보안 불변식:
 *   - company_id 는 서버가 JWT→users 로 결정. 클라 입력 신뢰 안 함.
 *   - Ultra/Enterprise(monthly_ai_token_limit != null) 만 이용. 당월 토큰 상한 초과 시 차단.
 *   - 원문 프롬프트/민감정보 저장 안 함(claude.ts 가 메타만 ai_usage_log 기록).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { callClaude } from "../_shared/claude.ts";

const ALLOWED_ORIGINS = [
  "https://www.owner-view.com",
  "https://owner-view.com",
  "http://localhost:3000",
];

function getCorsHeaders(req: Request) {
  const origin = req.headers.get("Origin") || "";
  const allowedOrigin = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allowedOrigin,
    "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  };
}

const SYSTEM_PROMPT = `당신은 대한민국 중소기업 대표를 돕는 "대표 참모"입니다. 오너뷰(OwnerView) ERP의 실시간 회사 스냅샷을 근거로 답합니다.

원칙:
- 반드시 제공된 snapshot 수치만 근거로 삼습니다. snapshot 에 없는 값은 추정하지 말고 "데이터에 없음"이라고 말합니다.
- 한국어로, 대표가 바로 이해할 실무 관점으로 간결하게 답합니다. 금액은 원 단위(억/만원)로 읽기 쉽게.
- 질문이 없거나 "브리핑" 요청이면: 현금·이번달 수지·미수금·처리 대기(결재/지급/서명)·영업 파이프라인을 훑고 "오늘 챙길 것 3가지"를 우선순위로 제시합니다.
- 조언은 하되 실행(송금·발행·승인 등)은 직접 못 하며, 화면 어디에서 처리하는지 안내합니다.
- 숫자를 나열만 하지 말고 의미(위험/기회)를 해석합니다. 과장·허위 금지.
- 출력은 평문으로: 마크다운 표(|)·헤더(#) 금지. 짧은 문단과 "- " 불릿, "1." 번호목록만 사용. 이모지는 최소화.`;

serve(withSentry("owner-copilot", async (req) => {
  const corsHeaders = getCorsHeaders(req);
  const json = (body: Record<string, unknown>, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return json({ error: "Unauthorized" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceRole = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const admin = createClient(supabaseUrl, serviceRole);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userErr } = await admin.auth.getUser(token);
    if (!user || userErr) return json({ error: "Unauthorized" }, 401);

    // company_id 는 서버가 결정 (클라 입력 신뢰 안 함)
    const { data: profile } = await admin
      .from("users").select("id, company_id").eq("auth_id", user.id).maybeSingle();
    if (!profile?.company_id) return json({ error: "회사 정보를 찾을 수 없습니다" }, 403);
    const companyId: string = profile.company_id;

    const body = await req.json().catch(() => ({}));
    const question: string = (typeof body?.question === "string" ? body.question : "").slice(0, 2000);

    // 이용 자격: entitlement + 플랜 토큰 상한(Ultra/Enterprise 만 != null)
    const { data: entRows } = await admin.rpc("get_company_entitlement", { p_company_id: companyId });
    const ent = Array.isArray(entRows) ? entRows[0] : entRows;
    if (!ent?.entitled) return json({ error: "구독이 활성 상태가 아닙니다.", code: "NOT_ENTITLED" }, 403);

    const { data: planRow } = await admin
      .from("subscription_plans")
      .select("monthly_ai_token_limit")
      .eq("slug", ent.effective_plan_slug)
      .maybeSingle();
    const tokenLimit: number | null = planRow?.monthly_ai_token_limit ?? null;
    if (tokenLimit === null) {
      return json({ error: "대표 참모는 울트라·엔터프라이즈 플랜에서 이용할 수 있습니다.", code: "PLAN_REQUIRED" }, 403);
    }

    // 당월 토큰 사용량 상한 체크
    const { data: usedTok } = await admin.rpc("ai_tokens_used_this_month", { p_company_id: companyId });
    const used = Number(usedTok || 0);
    if (used >= tokenLimit) {
      return json({ error: "이번 달 AI 사용 한도를 모두 사용했습니다. 다음 달에 초기화됩니다.", code: "TOKEN_LIMIT" }, 429);
    }

    // 회사 스코프 읽기전용 스냅샷 (서버가 company_id 고정)
    const { data: snapshot, error: snapErr } = await admin.rpc("copilot_company_snapshot", { p_company_id: companyId });
    if (snapErr || !snapshot || (snapshot as { error?: string })?.error) {
      return json({ error: "회사 데이터를 불러오지 못했습니다." }, 500);
    }

    const userContent = [
      question ? `대표 질문: ${question}` : "요청: 오늘 챙겨야 할 것 중심으로 회사 상태를 브리핑해줘.",
      "",
      "현재 회사 스냅샷(JSON, 이 수치만 근거로 사용):",
      "```json",
      JSON.stringify(snapshot),
      "```",
    ].join("\n");

    const result = await callClaude<unknown>({
      task: "analysis", // 기본 Sonnet (사장님 결정: 복잡 질의만 Opus)
      feature: "owner_copilot",
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      maxTokens: 1200,
      companyId,
      userId: profile.id,
      admin,
      promptVersion: "copilot-v1",
    });

    if (!result.ok) {
      return json({ error: result.error || "AI 응답에 실패했습니다.", code: result.errorCode }, 502);
    }

    const remaining = Math.max(0, tokenLimit - used - (result.usage ? result.usage.input + result.usage.output : 0));
    return json({
      answer: result.text ?? "",
      usage: result.usage ?? null,
      remaining_tokens: remaining,
      as_of: (snapshot as { as_of_kst?: string })?.as_of_kst ?? null,
    });
  } catch (_err) {
    // 상세(프롬프트/데이터) 비노출
    return json({ error: "요청 처리 중 오류가 발생했습니다." }, 500);
  }
}));
