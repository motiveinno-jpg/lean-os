import { withSentry } from "../_shared/sentry.ts";
/**
 * OwnerView — AI 참모(owner-copilot)
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

const SYSTEM_PROMPT = `당신은 대한민국 중소기업 대표를 돕는 "AI 참모"입니다. OwnerView ERP의 실시간 회사 스냅샷을 근거로, 대표가 지금 해야 할 일을 구조화해 제시합니다.

원칙:
- 반드시 제공된 snapshot 수치만 근거로 삼습니다. snapshot 에 없는 값은 절대 만들지 마세요(추정 금지). 데이터가 없으면 해당 배열을 비웁니다.
- 한국어. 금액은 억/만원으로 읽기 쉽게.
- headline: 한 줄 결론(핵심 한 문장). summary: 2~3문장 요약.
- actions(지금 해야 할 일): priority(high|medium|low), title(간결), detail(실무 지침), href(처리 화면 경로 — 예: /bank /partners /approvals /payments /signatures /tax-invoices, 모르면 생략).
- risks(위험 신호): title, detail, severity(high|medium|low).
- opportunities(기회): title, detail.
- evidence(근거 데이터): snapshot 필드 기반 label/value/source. label 은 반드시 사람이 읽는 한국어 이름(예: "현금 잔액", "이번 달 매출")만 쓰고, 원시 필드명(cash_balance, total_revenue 등)은 절대 노출하지 마세요. value 는 억/만원 등 읽기 쉬운 표기.
- 모든 텍스트에 마크다운·별표(**)·백틱(\`)·변수 토큰({{ }}, { }, \${ })·영문 필드명을 절대 쓰지 마세요. 순수 한국어 문장으로만 씁니다.
- 실행(송금·발행·승인)은 직접 못 하며 화면 위치만 안내합니다. 과장·허위 금지.`;

// 구조화 응답 스키마 (claude.ts output_config json_schema). 실패 시 텍스트 fallback.
const ANSWER_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    headline: { type: "string" },
    summary: { type: "string" },
    actions: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: {
          priority: { type: "string", enum: ["high", "medium", "low"] },
          title: { type: "string" }, detail: { type: "string" }, href: { type: "string" },
        },
        required: ["priority", "title", "detail"],
      },
    },
    risks: {
      type: "array",
      items: {
        type: "object", additionalProperties: false,
        properties: { title: { type: "string" }, detail: { type: "string" }, severity: { type: "string", enum: ["high", "medium", "low"] } },
        required: ["title", "detail", "severity"],
      },
    },
    opportunities: {
      type: "array",
      items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, detail: { type: "string" } }, required: ["title", "detail"] },
    },
    evidence: {
      type: "array",
      items: { type: "object", additionalProperties: false, properties: { label: { type: "string" }, value: { type: "string" }, source: { type: "string" } }, required: ["label", "value"] },
    },
  },
  required: ["headline", "summary", "actions", "risks", "opportunities", "evidence"],
};

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
      return json({ error: "AI 참모는 유료 플랜(프로 이상)에서 이용할 수 있습니다.", code: "PLAN_REQUIRED" }, 403);
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

    type Answer = {
      headline: string; summary: string;
      actions: { priority: string; title: string; detail: string; href?: string }[];
      risks: { title: string; detail: string; severity: string }[];
      opportunities: { title: string; detail: string }[];
      evidence: { label: string; value: string; source?: string }[];
    };
    const result = await callClaude<Answer>({
      task: "analysis", // 기본 Sonnet (복잡 질의만 Opus)
      feature: "owner_copilot", // 로그 호환 위해 feature 명 유지
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userContent }],
      maxTokens: 1500,
      schema: ANSWER_SCHEMA,
      companyId,
      userId: profile.id,
      admin,
      promptVersion: "copilot-v2",
    });

    if (!result.ok) {
      return json({ error: result.error || "AI 응답에 실패했습니다.", code: result.errorCode }, 502);
    }

    // 구조화 파싱 성공 시 그대로, 실패 시 텍스트를 summary 로 감싸는 fallback.
    const answer: Answer = result.data ?? {
      headline: "", summary: result.text ?? "", actions: [], risks: [], opportunities: [], evidence: [],
    };
    const remaining = Math.max(0, tokenLimit - used - (result.usage ? result.usage.input + result.usage.output : 0));
    return json({
      answer,
      usage: result.usage ?? null,
      remaining_tokens: remaining,
      as_of: (snapshot as { as_of_kst?: string })?.as_of_kst ?? null,
      model: result.model,
      request_id: result.requestId,
    });
  } catch (_err) {
    // 상세(프롬프트/데이터) 비노출
    return json({ error: "요청 처리 중 오류가 발생했습니다." }, 500);
  }
}));
