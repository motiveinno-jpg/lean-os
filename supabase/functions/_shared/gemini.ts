// Gemini 대체 경로 (2026-09-03 사장님: "클로드 토큰 없으면 제미나이 무료라도 사용해")
//   Anthropic 잔액 소진(PROVIDER_BILLING)·키 없음일 때 callClaude 가 여기로 넘긴다.
//   Anthropic Messages 형식(시스템·메시지·툴·스키마)을 Gemini generateContent 형식으로 바꾸고,
//   응답은 다시 Anthropic 블록 모양(text / tool_use)으로 돌려줘 호출부(참모 루프 등)가 그대로 돌게 한다.
//   · 환경변수 GEMINI_API_KEY (Google AI Studio 무료 키), GEMINI_MODEL (기본 gemini-2.5-flash)
//   · 웹검색(server tool)·프롬프트 캐시·thinking 옵션은 무시된다. 비용 추정은 0 (무료 등급).
import { tfetch } from "./http.ts";

const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export function geminiKey(): string | undefined { return Deno.env.get("GEMINI_API_KEY") || undefined; }
export function geminiModel(): string { return Deno.env.get("GEMINI_MODEL") || "gemini-2.5-flash"; }

type Part = Record<string, unknown>;

/** Anthropic JSON Schema → Gemini responseSchema (지원 안 되는 키 제거) */
export function toGeminiSchema(schema: unknown): unknown {
  if (!schema || typeof schema !== "object") return schema;
  if (Array.isArray(schema)) return schema.map(toGeminiSchema);
  const s = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) {
    if (k === "additionalProperties" || k === "$schema" || k === "default" || k === "minimum" || k === "maximum" || k === "minLength" || k === "maxLength" || k === "pattern") continue;
    if (k === "properties" && v && typeof v === "object") {
      const props: Record<string, unknown> = {};
      for (const [pk, pv] of Object.entries(v as Record<string, unknown>)) props[pk] = toGeminiSchema(pv);
      out.properties = props;
    } else if (k === "items" || k === "anyOf" || k === "oneOf") {
      out[k] = toGeminiSchema(v);
    } else if (k === "type" && Array.isArray(v)) {
      // ["string","null"] 같은 표기 → 첫 타입 + nullable
      out.type = (v as string[]).find((t) => t !== "null") || "string";
      if ((v as string[]).includes("null")) out.nullable = true;
    } else {
      out[k] = v;
    }
  }
  return out;
}

function textPart(t: string): Part { return { text: t }; }

/** Anthropic 메시지 배열 → Gemini contents. tool_result 는 앞선 tool_use 의 이름을 찾아 functionResponse 로. */
function toContents(messages: unknown[]): Part[] {
  const toolNameById = new Map<string, string>();
  const contents: Part[] = [];
  for (const m of messages as { role: string; content: unknown }[]) {
    const role = m.role === "assistant" ? "model" : "user";
    const parts: Part[] = [];
    if (typeof m.content === "string") {
      if (m.content.trim()) parts.push(textPart(m.content));
    } else if (Array.isArray(m.content)) {
      for (const b of m.content as Record<string, any>[]) {
        const t = b?.type;
        if (t === "text" && b.text) parts.push(textPart(String(b.text)));
        else if (t === "tool_use") { toolNameById.set(String(b.id), String(b.name)); parts.push({ functionCall: { name: String(b.name), args: (b.input && typeof b.input === "object") ? b.input : {} } }); }
        else if (t === "tool_result") {
          const name = toolNameById.get(String(b.tool_use_id)) || "tool";
          let payload: unknown = b.content;
          if (Array.isArray(b.content)) payload = b.content.map((c: any) => c?.type === "text" ? c.text : JSON.stringify(c)).join("\n");
          if (typeof payload === "string") { try { payload = JSON.parse(payload); } catch { payload = { text: payload }; } }
          parts.push({ functionResponse: { name, response: (payload && typeof payload === "object") ? payload : { result: payload } } });
        }
        else if (t === "image" && b.source?.type === "base64") parts.push({ inlineData: { mimeType: b.source.media_type, data: b.source.data } });
        else if (t === "document" && b.source?.type === "base64") parts.push({ inlineData: { mimeType: b.source.media_type || "application/pdf", data: b.source.data } });
        else if (t === "thinking" || t === "redacted_thinking" || t === "server_tool_use" || t === "web_search_tool_result") continue;
      }
    }
    if (!parts.length) continue;
    // Gemini 는 같은 역할 연속 메시지를 싫어한다 — 합친다.
    const last = contents[contents.length - 1];
    if (last && last.role === role) (last.parts as Part[]).push(...parts);
    else contents.push({ role, parts });
  }
  return contents;
}

export interface GeminiCallInput {
  system?: string;
  messages: unknown[];
  maxTokens?: number;
  temperature?: number;
  schema?: unknown;            // 구조화 응답 — responseSchema
  tools?: unknown[];           // Anthropic tool 정의(input_schema) — functionDeclarations
  toolChoice?: unknown;        // {type:"any"|"auto"|"tool", name}
  timeoutMs?: number;
}

export interface GeminiCallOutput {
  ok: boolean;
  content: unknown[];          // Anthropic 블록 모양: text / tool_use
  text: string;
  data?: unknown;              // schema 모드 파싱 결과
  stopReason: string;
  usage: { input: number; output: number };
  model: string;
  error?: string;
  errorCode?: string;
}

export async function callGemini(input: GeminiCallInput): Promise<GeminiCallOutput> {
  const key = geminiKey(); const model = geminiModel();
  if (!key) return { ok: false, content: [], text: "", stopReason: "error", usage: { input: 0, output: 0 }, model, error: "AI 대체 경로 키가 없습니다.", errorCode: "NO_GEMINI_KEY" };

  const body: Record<string, unknown> = {
    contents: toContents(input.messages),
    generationConfig: {
      // Gemini 2.5 는 '생각' 토큰도 maxOutputTokens 에 포함된다 — Anthropic 기준으로 잡은 작은 값(800)이면 JSON 이 잘려
      //   "문서를 읽지 못했습니다"가 났다(2026-09-03 사장님 제보). 넉넉히 잡고, 구조화 추출은 생각을 끈다(flash 만 지원).
      maxOutputTokens: Math.max(4096, Math.min((input.maxTokens ?? 2000) * 4, 65536)),
      ...(input.schema && model.includes("flash") ? { thinkingConfig: { thinkingBudget: 0 } } : {}),
      ...(typeof input.temperature === "number" ? { temperature: input.temperature } : {}),
      ...(input.schema ? { responseMimeType: "application/json", responseSchema: toGeminiSchema(input.schema) } : {}),
    },
  };
  if (input.system) body.systemInstruction = { parts: [textPart(input.system)] };
  if (!input.schema && input.tools?.length) {
    const decls = (input.tools as Record<string, any>[])
      .filter((t) => t && t.name && t.input_schema && !t.type)   // server tool(web_search 등)은 제외
      .map((t) => ({ name: t.name, description: String(t.description || "").slice(0, 1024), parameters: toGeminiSchema(t.input_schema) }));
    if (decls.length) {
      body.tools = [{ functionDeclarations: decls }];
      const tc = input.toolChoice as { type?: string; name?: string } | undefined;
      if (tc?.type === "any") body.toolConfig = { functionCallingConfig: { mode: "ANY" } };
      else if (tc?.type === "tool" && tc.name) body.toolConfig = { functionCallingConfig: { mode: "ANY", allowedFunctionNames: [tc.name] } };
      else body.toolConfig = { functionCallingConfig: { mode: "AUTO" } };
    }
  }

  try {
    const res = await tfetch(`${GEMINI_BASE}/${model}:generateContent?key=${encodeURIComponent(key)}`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    }, input.timeoutMs);
    const json = await res.json().catch(() => null);
    if (!res.ok || !json || json.error) {
      const msg = String(json?.error?.message ?? `HTTP ${res.status}`);
      console.error(`[gemini] ${model} HTTP ${res.status}: ${msg.slice(0, 300)}`);
      const code = res.status === 429 ? "GEMINI_RATE_LIMIT" : res.status === 400 || res.status === 403 ? "GEMINI_KEY_OR_REQUEST" : `GEMINI_HTTP_${res.status}`;
      return { ok: false, content: [], text: "", stopReason: "error", usage: { input: 0, output: 0 }, model,
        error: res.status === 429 ? "AI 대체 경로(무료 등급)의 분당 요청 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요." : "AI 대체 경로 응답 오류", errorCode: code };
    }
    const cand = json.candidates?.[0];
    const parts: Record<string, any>[] = cand?.content?.parts || [];
    const content: unknown[] = [];
    let text = "";
    let n = 0;
    for (const p of parts) {
      if (typeof p.text === "string") { text += p.text; content.push({ type: "text", text: p.text }); }
      else if (p.functionCall) { n++; content.push({ type: "tool_use", id: `gem_${Date.now().toString(36)}_${n}`, name: p.functionCall.name, input: p.functionCall.args || {} }); }
    }
    let data: unknown;
    if (input.schema && text) { try { data = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch { console.error(`[gemini] schema parse fail finish=${cand?.finishReason} len=${text.length}`); } }
    if (input.schema && data === undefined) console.error(`[gemini] no structured data finish=${cand?.finishReason} parts=${parts.length} text=${text.length}`);
    const usage = { input: Number(json.usageMetadata?.promptTokenCount || 0), output: Number(json.usageMetadata?.candidatesTokenCount || 0) + Number(json.usageMetadata?.thoughtsTokenCount || 0) };
    const stopReason = n > 0 ? "tool_use" : cand?.finishReason === "MAX_TOKENS" ? "max_tokens" : "end_turn";
    return { ok: true, content, text, data, stopReason, usage, model };
  } catch (_e) {
    return { ok: false, content: [], text: "", stopReason: "error", usage: { input: 0, output: 0 }, model, error: "AI 대체 경로 지연/실패", errorCode: "GEMINI_NETWORK" };
  }
}
