// 공통 Claude(Anthropic Messages API) 클라이언트 — 2026-07-22 AI 중심화 STEP 2.
//   - task 별 모델 라우팅(extract/classify=Haiku, analysis=Sonnet, deep_analysis=Opus)
//   - tfetch 기반 timeout + 제한적 retry(429/5xx, 지수백오프 최대 2회)
//   - structured output(강제 tool use) 지원 — schema 주면 tool_use.input 으로 구조화 객체 반환
//   - request_id · latency · input/output token 반환 + ai_usage_log 기록(민감정보/원문 프롬프트 저장 금지)
//   - 오류 응답에 프롬프트/운영 데이터 노출 금지 (호출측엔 안전 메시지만)
import { tfetch } from "./http.ts";
import { callGemini, geminiKey } from "./gemini.ts";

const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
const ANTHROPIC_VERSION = "2023-06-01";

// task → 모델. 2026-08-20 사장님: "AI 참모를 나(Claude Code)처럼 정확하게" — 분석 계열을
//   구세대 Sonnet 4.6/Opus 4.8 → 최신 Claude Opus 5 로 상향(가격은 Opus 4.8 과 동일 $5/$25).
//   extract/classify 는 속도가 관건인 기계적 작업이라 Haiku 유지.
//   ⚠️ Opus 5 는 thinking 이 기본 켜짐 + temperature/top_p 미지원 + 강제 tool_choice 와
//   thinking 병용 불가 → callClaude 가 스키마(강제 tool use) 호출에서 자동으로 thinking 을 끈다.
export type ClaudeTask = "extract" | "classify" | "analysis" | "deep_analysis";
const MODEL_BY_TASK: Record<ClaudeTask, string> = {
  extract: "claude-haiku-4-5-20251001",
  classify: "claude-haiku-4-5-20251001",
  analysis: "claude-opus-5",
  deep_analysis: "claude-opus-5",
};

// 토큰당 대략 단가(USD, 추정치 — 비용 표시용. 정확 청구 아님). input/output 백만토큰당.
//   2026-07-30 opus-4-8 단가 교정: 15/75 → 5/25 (공식 단가) — 상한 계산이 이 추정치를 쓰므로 중요.
const PRICE_PER_MTOK: Record<string, { in: number; out: number }> = {
  "claude-haiku-4-5-20251001": { in: 1.0, out: 5.0 },
  "claude-sonnet-4-6": { in: 3.0, out: 15.0 },
  "claude-opus-4-8": { in: 5.0, out: 25.0 },
  "claude-opus-5": { in: 5.0, out: 25.0 },
};

// 회사별 월 AI 비용 상한 — 기능 불문 합산.
//   2026-08-06 요금제 개편: $10 → $6. 25,000원 플랜의 AI 한도가 월 100회인데,
//   실측 호출당 원가가 57~82원(참모 Sonnet / 브리핑 Opus)이라 100회 = 5,700~8,200원 ≈ $4.1~5.9.
//   비용 상한이 이보다 낮으면 횟수를 다 쓰기 전에 막혀 한도 표기가 거짓이 된다.
//   실제 방어선은 아래 '월 호출 횟수' 상한이고, 이 값은 폭주 안전망이다.
//   env(AI_MONTHLY_COST_CAP_USD)로 조정 가능.
//   2026-08-20 참모 Opus 5 상향으로 호출당 원가 상승(약 1.7배) — 월 100회 한도가 비용 상한에
//   먼저 막히지 않게 기본값 6 → 12 로 조정. env(AI_MONTHLY_COST_CAP_USD)로 조정 가능.
const MONTHLY_COST_CAP_USD = Number(Deno.env.get("AI_MONTHLY_COST_CAP_USD") || "12");

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
  // 웹검색 허용 여부 — 켜면 Anthropic 서버 도구 web_search 를 붙인다(모델이 필요할 때만 사용).
  webSearch?: boolean;
  webSearchMaxUses?: number;
  outputConfig?: unknown;
  // 2026-09-03 프롬프트 캐시(top-level cache_control) — 시스템+툴 정의+스냅샷(≈2만 토큰)이 한 요청의
  //   여러 턴에서 반복 전송되므로 켜면 2턴째부터 입력 비용 약 90% 절감·지연 단축.
  cacheControl?: boolean;
  // 2026-09-03 월 호출 횟수 상한을 '질문 수' 기준으로: 참모의 후속 턴(툴 결과 되먹임)·자동 기억 추출처럼
  //   한 질문에 딸린 부수 호출은 false 로 넘겨 상한 검사와 집계에서 뺀다(비용·토큰 집계에는 그대로 포함).
  countsTowardCallCap?: boolean;
  // 2026-09-03 사장님: Gemini 대체는 사업자등록증 판독에만 — 호출측이 명시적으로 켠 기능만 넘어간다(참모 등은 Claude 전용).
  allowGeminiFallback?: boolean;
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

function estimateCost(model: string, inTok: number, outTok: number, cacheRead = 0, cacheWrite = 0): number | undefined {
  const p = PRICE_PER_MTOK[model];
  if (!p) return undefined;
  // 캐시 읽기는 입력 단가의 10%, 캐시 쓰기는 125% (Anthropic 표준 요율).
  const inputCost = (inTok / 1e6) * p.in + (cacheRead / 1e6) * p.in * 0.1 + (cacheWrite / 1e6) * p.in * 1.25;
  return Number((inputCost + (outTok / 1e6) * p.out).toFixed(4));
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
  if (opts.cacheControl) body.cache_control = { type: "ephemeral" };
  // 구조화 출력: Anthropic 표준인 "강제 tool use" 사용(모델이 input_schema 에 맞는 JSON 을 tool_use.input 으로 반환).
  //   과거 output_config(json_schema) 는 Messages API 가 무시 → 모델이 JSON 을 '텍스트'로 뱉고 truncation 시 파싱 실패했음(2026-07-23 수정).
  const useSchemaTool = !!opts.schema;
  if (useSchemaTool) {
    body.tools = [{ name: "respond", description: "요청에 대한 구조화된 응답을 지정된 스키마로 반환합니다.", input_schema: opts.schema }];
    body.tool_choice = { type: "tool", name: "respond" };
    // Opus 5 는 thinking 기본 켜짐 — 강제 tool_choice 와 병용 불가라 스키마 모드에선 명시적으로 끈다.
    //   (effort 기본 high 에선 disabled 허용. 호출측이 thinking 을 준 경우는 그대로 존중.)
    if (model.startsWith("claude-opus-5") && !opts.thinking) body.thinking = { type: "disabled" };
  } else {
    const tools = [...(opts.tools ?? [])];
    // 웹검색 — Anthropic 서버 도구. 모델이 필요하다고 판단할 때만 검색하고,
    //   실행·결과 수집을 Anthropic 이 직접 한다(우리가 되먹이지 않는다).
    //   회사 데이터로 답할 수 없는 질문(정부지원사업·정책·시세 등)에서 지어내는 대신 찾아보게 하는 장치.
    //   maxUses 로 한 번의 대화에서 검색 횟수를 묶어 비용 폭주를 막는다.
    if (opts.webSearch) {
      tools.push({
        type: "web_search_20250305",
        name: "web_search",
        max_uses: opts.webSearchMaxUses ?? 5,
      });
    }
    if (tools.length) body.tools = tools;
    if (opts.toolChoice) body.tool_choice = opts.toolChoice;
  }

  const base: ClaudeResult<T> = { ok: false, model, requestId, latencyMs: 0 };
  if (!apiKey) {
    if (opts.allowGeminiFallback && geminiKey()) return await viaGemini(opts, requestId, t0, "NO_KEY");
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

  // 요금제별 월 호출 횟수 상한 (2026-08-06 개편 — 무료 5회 / 오너뷰 100회, NULL=무제한).
  //   비용 상한과 별개로 "몇 회"가 사용자에게 보이는 단위라 횟수로도 막는다. 조회 실패 시 통과.
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const admin = opts.admin as any;
    const { data: entRow } = await admin.rpc("get_company_entitlement", { p_company_id: opts.companyId }).maybeSingle();
    const slug = entRow?.effective_plan_slug || "free";
    const { data: planRow } = await admin
      .from("subscription_plans").select("name, monthly_ai_call_limit").eq("slug", slug).maybeSingle();
    const callLimit = planRow?.monthly_ai_call_limit;
    if (typeof callLimit === "number" && opts.countsTowardCallCap !== false) {
      const kstYm = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 7);
      const monthStart = `${kstYm}-01T00:00:00+09:00`;
      const { count } = await admin
        .from("ai_usage_log")
        .select("id", { count: "exact", head: true })
        .eq("company_id", opts.companyId)
        .eq("status", "ok")
        // 질문에 딸린 부수 호출은 횟수에서 제외 — 종전에는 툴 턴마다 1회씩 깎여 '100회'가 실제론 35~40 질문이었다.
        .not("feature", "in", '("owner_copilot_turn","copilot_memory")')
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
        // Anthropic 계정 잔액 소진(2026-09-03 12:17 KST 실제 발생) — 전 고객 참모 중단 상황이라 원인이 보이게 한다.
        if (/credit balance is too low/i.test(String(json?.error?.message ?? ""))) {
          lastCode = "PROVIDER_BILLING";
          lastErr = "AI 서비스 이용 잔액이 부족해 잠시 답변할 수 없습니다. 운영팀이 확인 중이니 잠시 후 다시 시도해 주세요.";
        }
        // 서버 콘솔에만 오류 문구(앞 300자) — 프롬프트 원문은 담기지 않는다. 2026-09-03 turn 400 진단용.
        console.error(`[claude] ${opts.feature} ${model} HTTP ${res.status} ${lastCode}: ${String(json?.error?.message ?? "").slice(0, 300)}`);
        break;
      }
      // usage.input_tokens 는 캐시에 안 실린 입력만 센다 — 캐시 읽기/쓰기는 별도 필드.
      const cacheRead = json?.usage?.cache_read_input_tokens ?? 0;
      const cacheWrite = json?.usage?.cache_creation_input_tokens ?? 0;
      const inTok = (json?.usage?.input_tokens ?? 0) + cacheRead + cacheWrite;   // 한도 계산은 전체 입력 기준(기존과 동일)
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
      const cost = estimateCost(model, inTok - cacheRead - cacheWrite, outTok, cacheRead, cacheWrite);
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
  // Anthropic 잔액 소진 → Gemini 대체 경로 (2026-09-03 사장님). 다른 오류(요청 형식 등)는 그대로 돌려준다.
  if (lastCode === "PROVIDER_BILLING" && opts.allowGeminiFallback && geminiKey()) {
    await logUsage(opts, { model, requestId, inTok: 0, outTok: 0, latencyMs: Date.now() - t0, status: "fallback", errorCode: lastCode });
    return await viaGemini(opts, requestId, t0, lastCode);
  }
  const latencyMs = Date.now() - t0;
  await logUsage(opts, { model, requestId, inTok: 0, outTok: 0, latencyMs, status: "error", errorCode: lastCode });
  return { ...base, error: lastErr, errorCode: lastCode, latencyMs };
}

/** Gemini 대체 호출 — 결과를 ClaudeResult 모양으로 맞춘다(호출부 무수정). */
async function viaGemini<T>(opts: ClaudeCallOpts, requestId: string, t0: number, reason: string): Promise<ClaudeResult<T>> {
  const g = await callGemini({
    system: opts.system, messages: opts.messages, maxTokens: opts.maxTokens, temperature: opts.temperature,
    schema: opts.schema, tools: opts.tools, toolChoice: opts.toolChoice, timeoutMs: opts.timeoutMs,
  });
  const latencyMs = Date.now() - t0;
  if (!g.ok) {
    await logUsage(opts, { model: g.model, requestId, inTok: 0, outTok: 0, latencyMs, status: "error", errorCode: g.errorCode });
    return { ok: false, model: g.model, requestId, latencyMs, error: g.error, errorCode: g.errorCode };
  }
  console.log(`[gemini] fallback(${reason}) ${opts.feature} ${g.model} in=${g.usage.input} out=${g.usage.output}`);
  await logUsage(opts, { model: g.model, requestId, inTok: g.usage.input, outTok: g.usage.output, latencyMs, status: "ok", cost: 0 });
  return {
    ok: true, data: g.data as T | undefined, text: g.text, content: g.content, stopReason: g.stopReason,
    usage: g.usage, model: g.model, requestId, latencyMs, costUsdEstimate: 0,
  };
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

  // 충전 차감 (2026-08-07) — 월 제공량을 넘어선 만큼만 잔액에서 뺀다.
  //   모든 AI 기능이 이 한 곳을 지나므로 여기서 한 번만 부르면 된다.
  //   성공 호출만 과금한다(실패·차단은 제외). 실패해도 응답에는 영향을 주지 않는다.
  if (r.status === "ok" && opts.companyId) {
    try {
      await (opts.admin as any).rpc("consume_ai_tokens", {
        p_company_id: opts.companyId,
        p_tokens: (r.inTok || 0) + (r.outTok || 0),
      });
    } catch { /* 차감 실패는 비치명 — 사용량 로그가 이미 남아 정산 가능 */ }
  }
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
