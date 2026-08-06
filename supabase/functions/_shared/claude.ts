// 공통 Claude(Anthropic Messages API) 클라이언트 — 2026-07-22 AI 중심화 STEP 2.
//   - task 별 모델 라우팅(extract/classify=Haiku, analysis=Sonnet, deep_analysis=Opus)
//   - tfetch 기반 timeout + 제한적 retry(429/5xx, 지수백오프 최대 2회)
//   - structured output(강제 tool use) 지원 — schema 주면 tool_use.input 으로 구조화 객체 반환
//   - request_id · latency · input/output token 반환 + ai_usage_log 기록(민감정보/원문 프롬프트 저장 금지)
//   - 오류 응답에 프롬프트/운영 데이터 노출 금지 (호출측엔 안전 메시지만)
import { tfetch } from "./http.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// task → 모델. 기본 분석은 Sonnet, 복잡 질의만 Opus (2026-07-22 사장님 결정).
export type ClaudeTask = "extract" | "classify" | "analysis" | "deep_analysis";
const MODEL_BY_TASK: Record<ClaudeTask, string> = {
  extract: "claude-haiku-4-5-20251001",
  classify: "claude-haiku-4-5-20251001",
  analysis: "claude-sonnet-4-6",
  deep_analysis: "claude-opus-4-8",
};

// 토큰당 대략 단가(USD, 추정치 — 비용 표시용. 정확 청구 아님). input/output 백만토큰당.
//   2026-07-30 opus-4-8 단가 교정: 15/75 → 5/25 (공식 단가) — 상한 계산이 이 추정치를 쓰므로 중요.
const PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-opus-4-8": { in: 5.0, out: 25.0 },
};

// 회사별 월 AI 비용 상한 — 기능 불문 합산.
//   2026-08-06 요금제 개편: $10 → $6. 25,000원 플랜의 AI 한도가 월 100회인데,
//   실측 호출당 원가가 57~82원(참모 Sonnet / 브리핑 Opus)이라 100회 = 5,700~8,200원 ≈ $4.1~5.9.
//   비용 상한이 이보다 낮으면 횟수를 다 쓰기 전에 막혀 한도 표기가 거짓이 된다.
//   실제 방어선은 아래 '월 호출 횟수' 상한이고, 이 값은 폭주 안전망이다.
//   env(AI_MONTHLY_COST_CAP_USD)로 조정 가능.
const MONTHLY_COST_CAP_USD = Number(Deno.env.get("AI_MONTHLY_COST_CAP_USD") || "6");

export interface ClaudeCallOpts {
  task: ClaudeTask;
  feature: string;              // 로깅용 기능명 (예: 'owner_copilot','classify_tx')
  messages: unknown[];          // Anthropic messages 배열 (호출측이 구성)
  system?: string;
  maxTokens?: number;
  schema?: unknown;             // 주면 structured output(json_schema) 강제
  tools?: unknown[];            // tool use 필요 시
  toolChoice?: unknown;
  temperature?: number;
  // 2026-07-30 ai-briefing 이관용 통로 — 값을 그대로 body 에 전달(내용 무가공).
  //   thinking: 깊은 사고(adaptive). ⚠️ 강제 tool use(schema 옵션)와 병용 불가 — API 가 거부한다.
  //   outputConfig: output_config(json_schema 등). schema 옵션과 택일.
  thinking?: unknown;
  outputConfig?: unknown;
  promptVersion?: string;
  // 로깅 컨텍스트 (서버가 결정한 값만 — 클라 신뢰 금지)
  companyId: string;
  userId?: string | null;
  admin: { from: (t: string) => any };  // service-role supabase client (로깅용)
  requestId?: string;
  maxRetries?: number;
  // 바깥 Edge/서버의 총 요청 제한보다 짧게 지정할 수 있는 개별 HTTP 상한.
  // 미지정 시 http.ts의 호스트별 기본값을 사용한다.
  timeoutMs?: number;
}

export interface ClaudeResult<T = unknown> {
  ok: boolean;
  data?: T;                     // schema 주면 파싱된 객체
  text?: string;                // 원 텍스트
  // 에이전트 루프용(2026-07-27) — 호출측이 stop_reason='tool_use' 를 보고 툴 실행 후
  //   content 를 assistant 턴으로 그대로 되먹여야 하므로 원본 블록을 노출한다.
  //   schema 방식(강제 tool use) 호출자는 안 봐도 되는 선택 필드 — 기존 호출부 영향 없음.
  content?: unknown[];
  stopReason?: string;
  usage?: { input: number; output: number };
  model: string;
  requestId: string;
  latencyMs: number;
  costUsdEstimate?: number;
  // 실패 시: 안전 메시지만 (프롬프트/데이터 비노출)
  error?: string;
  errorCode?: string;
}

function newRequestId(): string {
  // crypto.randomUUID 는 edge runtime 에서 사용 가능
  try { return crypto.randomUUID(); } catch { return `req_${Date.now()}`; }
}

function estimateCost(model: string, inTok: number, outTok: number): number | undefined {
  const p = PRICE_PER_MTOK[model];
  if (!p) return undefined;
  return Number(((inTok / 1e6) * p.in + (outTok / 1e6) * p.out).toFixed(4));
}

/** 공통 Claude 호출. 실패해도 throw 하지 않고 ClaudeResult.ok=false 로 반환(호출측이 graceful degrade). */
export async function callClaude<T = unknown>(opts: ClaudeCallOpts): Promise<ClaudeResult<T>> {
  const model = MODEL_BY_TASK[opts.task];
  const requestId = opts.requestId || newRequestId();
  const maxRetries = Math.min(opts.maxRetries ?? 2, 3);
  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  const t0 = Date.now();

  const body: Record<string, unknown> = {
    model,
    max_tokens: opts.maxTokens ?? 2000,
    messages: opts.messages,
  };
  if (opts.system) body.system = opts.system;
  if (typeof opts.temperature === "number") body.temperature = opts.temperature;
  if (opts.thinking) body.thinking = opts.thinking;
  if (opts.outputConfig) body.output_config = opts.outputConfig;
  // 구조화 출력: Anthropic 표준인 "강제 tool use" 사용(모델이 input_schema 에 맞는 JSON 을 tool_use.input 으로 반환).
  //   과거 output_config(json_schema) 는 Messages API 가 무시 → 모델이 JSON 을 '텍스트'로 뱉고 truncation 시 파싱 실패했음(2026-07-23 수정).
  const useSchemaTool = !!opts.schema;
  if (useSchemaTool) {
    body.tools = [{ name: "respond", description: "요청에 대한 구조화된 응답을 지정된 스키마로 반환합니다.", input_schema: opts.schema }];
    body.tool_choice = { type: "tool", name: "respond" };
  } else {
    if (opts.tools) body.tools = opts.tools;
    if (opts.toolChoice) body.tool_choice = opts.toolChoice;
  }

  const base: ClaudeResult<T> = { ok: false, model, requestId, latencyMs: 0 };
  if (!apiKey) {
    return { ...base, error: "AI 설정 오류(관리자 문의)", errorCode: "NO_KEY", latencyMs: Date.now() - t0 };
  }

  // 회사별 월 비용 상한 — 호출 전에 당월 누적 비용을 확인, 초과 시 API 를 부르지 않는다.
  //   조회 실패 시엔 차단하지 않음(가용성 우선 — 상한은 안전망이지 게이트웨이가 아님).
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data: spent } = await (opts.admin as any).rpc("ai_cost_used_this_month", { p_company_id: opts.companyId });
    if (Number(spent || 0) >= MONTHLY_COST_CAP_USD) {
      return { ...base, error: "이번 달 AI 사용 한도를 모두 사용했습니다. 다음 달에 초기화됩니다.", errorCode: "COST_CAP", latencyMs: Date.now() - t0 };
    }
  } catch { /* 조회 실패 — 차단 안 함 */ }

  // 요금제별 월 호출 횟수 상한 (2026-08-06 개편 — 무료 10회 / 오너뷰 50회, NULL=무제한).
  //   비용 상한과 별개로 "몇 회"가 사용자에게 보이는 단위라 횟수로도 막는다. 조회 실패 시 통과.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = opts.admin as any;
    const { data: entRow } = await admin.rpc("get_company_entitlement", { p_company_id: opts.companyId }).maybeSingle();
    const slug = entRow?.effective_plan_slug || "free";
    const { data: planRow } = await admin
      .from("subscription_plans").select("name, monthly_ai_call_limit").eq("slug", slug).maybeSingle();
    const callLimit = planRow?.monthly_ai_call_limit;
    if (typeof callLimit === "number") {
      const kstYm = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
      const monthStart = `${kstYm}-01T00:00:00+09:00`;
      const { count } = await admin
        .from("ai_usage_log")
        .select("id", { count: "exact", head: true })
        .eq("company_id", opts.companyId)
        .eq("status", "ok")
        .gte("created_at", monthStart);
      if ((count || 0) >= callLimit) {
        return {
          ...base,
          error: `이번 달 AI 사용 횟수(${callLimit}회)를 모두 사용했습니다. 다음 달에 초기화됩니다.`,
          errorCode: "CALL_CAP",
          latencyMs: Date.now() - t0,
        };
      }
    }
  } catch { /* 조회 실패 — 차단 안 함 */ }

  let lastErr = "AI 응답 실패";
  let lastCode = "UNKNOWN";
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const res = await tfetch(ANTHROPIC_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": ANTHROPIC_VERSION,
        },
        body: JSON.stringify(body),
      }, opts.timeoutMs);
      if (res.status === 429 || res.status >= 500) {
        lastErr = "AI 일시 지연"; lastCode = `HTTP_${res.status}`;
        if (attempt < maxRetries) { await sleep(400 * (attempt + 1)); continue; }
        break;
      }
      const json = await res.json();
      if (!res.ok || json?.error) {
        // 오류 상세(프롬프트/데이터)는 로그·응답에 싣지 않음. 코드만.
        lastCode = json?.error?.type || `HTTP_${res.status}`;
        lastErr = "AI 응답 오류";
        break;
      }
      const inTok = json?.usage?.input_tokens ?? 0;
      const outTok = json?.usage?.output_tokens ?? 0;
      const content: any[] = Array.isArray(json?.content) ? json.content : [];
      const textPart = content.filter((c) => c.type === "text").map((c) => c.text).join("");
      let data: T | undefined;
      if (useSchemaTool) {
        // 강제 tool use → tool_use.input 이 스키마에 맞는 구조화 객체.
        const toolBlock = content.find((c) => c.type === "tool_use" && c.name === "respond");
        if (toolBlock?.input && typeof toolBlock.input === "object") data = toolBlock.input as T;
        // 방어: (있을 리 없지만) tool_use 없이 텍스트로 왔으면 코드펜스 제거 후 JSON 파싱 시도.
        if (data === undefined && textPart) {
          try { data = JSON.parse(stripJsonFence(textPart)) as T; } catch { /* 구조화 실패 — text 반환 */ }
        }
      }
      const latencyMs = Date.now() - t0;
      const cost = estimateCost(model, inTok, outTok);
      await logUsage(opts, { model, requestId, inTok, outTok, latencyMs, status: "ok", cost });
      return {
        ok: true, data, text: textPart,
        content, stopReason: json?.stop_reason ?? undefined,
        usage: { input: inTok, output: outTok }, model, requestId, latencyMs, costUsdEstimate: cost,
      };
    } catch (_e) {
      // 네트워크/timeout(AbortSignal) — 상세 비노출
      lastErr = "AI 응답 지연/실패"; lastCode = "NETWORK";
      if (attempt < maxRetries) { await sleep(400 * (attempt + 1)); continue; }
    }
  }
  const latencyMs = Date.now() - t0;
  await logUsage(opts, { model, requestId, inTok: 0, outTok: 0, latencyMs, status: "error", errorCode: lastCode });
  return { ...base, error: lastErr, errorCode: lastCode, latencyMs };
}

async function logUsage(opts: ClaudeCallOpts, r: {
  model: string; requestId: string; inTok: number; outTok: number; latencyMs: number;
  status: string; cost?: number; errorCode?: string;
}) {
  // 원문 프롬프트·응답·민감정보 저장 금지 — 메타만.
  try {
    await opts.admin.from("ai_usage_log").insert({
      company_id: opts.companyId,
      user_id: opts.userId ?? null,
      feature: opts.feature,
      model: r.model,
      input_tokens: r.inTok,
      output_tokens: r.outTok,
      cost_usd_estimate: r.cost ?? null,
      latency_ms: r.latencyMs,
      status: r.status,
      error_code: r.errorCode ?? null,
      prompt_version: opts.promptVersion ?? null,
      request_id: r.requestId,
    });
  } catch { /* 로깅 실패는 비치명 — 호출 결과에 영향 없음 */ }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

// 모델이 JSON 을 ```json … ``` 펜스나 앞뒤 산문과 함께 뱉는 경우 대비 — 최외곽 { … } 만 추출.
function stripJsonFence(s: string): string {
  const t = s.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const first = t.indexOf("{"), last = t.lastIndexOf("}");
  return first >= 0 && last > first ? t.slice(first, last + 1) : t;
}
