import { withSentry } from "../_shared/sentry.ts";
// Supabase Edge Function: parse-closing-pdf (2026-07-08)
//   회계 마감 자료 PDF(합계잔액시산표·재무상태표·계정별 잔액명세 등) 스캔 이미지에서
//   계정별 차변/대변 잔액을 Claude Vision 으로 추출 → 회계마감 탭 "PDF 자동 채우기"에 사용.
//   클라이언트가 pdfjs 로 각 페이지를 PNG(base64)로 래스터화해 보낸다(parse-form-template 패턴).
//   ※ 배포: supabase functions deploy parse-closing-pdf. ANTHROPIC_API_KEY 필요.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 무인증 → LLM 비용 소진 방지. 로그인 유저만 호출(parse-form-template 동일 정책).
async function requireUser(req: Request): Promise<boolean> {
  try {
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return false;
    const { data: { user } } = await createClient(
      Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    ).auth.getUser();
    return !!user;
  } catch { return false; }
}

// 문자열 금액 → 숫자(콤마·원·공백 제거, 괄호=음수).
function numify(v: unknown): number {
  if (typeof v === "number") return Math.round(v);
  const s = String(v ?? "").trim();
  if (!s) return 0;
  const neg = /^\(.*\)$/.test(s) || s.startsWith("-");
  const n = Number(s.replace(/[^0-9.]/g, ""));
  if (!isFinite(n)) return 0;
  return Math.round(neg ? -n : n);
}

interface ClosingLine { account_name: string; account_code: string; debit: number; credit: number; }

async function extract(pages: string[], accounts: { code?: string; name: string }[]): Promise<ClosingLine[]> {
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const acctHint = accounts.slice(0, 400).map((a) => `${a.code ? a.code + " " : ""}${a.name}`).join("\n");
  const prompt = `다음 이미지들은 한국 회계 결산·마감 자료입니다(합계잔액시산표 / 재무상태표 / 계정별 잔액명세 등).
각 "계정 행"에서 계정명, 계정코드(있으면), 차변 잔액(debit), 대변 잔액(credit)을 추출해 JSON 배열로만 출력하세요. 설명·코드블록 금지.
형식: [{"account_name":"보통예금","account_code":"1010","debit":12345678,"credit":0}]

규칙:
- 금액은 숫자만(콤마·원·공백 제거). 값이 없으면 0. 괄호로 감싼 금액은 음수로.
- 합계·소계·총계·차변합계·대변합계 같은 요약 행은 제외하고, 실제 개별 계정 행만 추출.
- 잔액이 한 열로만 표기된 표라면, 계정 성격상 차변잔액이면 debit, 대변잔액이면 credit 에 넣으세요.
- account_code 가 표에 없으면 빈 문자열.
${acctHint ? `- 아래는 이 회사의 계정과목 목록입니다. 추출한 계정명을 최대한 이 목록의 이름/코드에 맞춰 표기하세요(목록에 없으면 원문 그대로):\n${acctHint}` : ""}`;

  const content: unknown[] = pages.map((p) => ({ type: "image", source: { type: "base64", media_type: "image/png", data: p } }));
  content.push({ type: "text", text: prompt });

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", // 표·숫자 판독 정확도 우선. 마감당 1회 호출.
      max_tokens: 8000,
      messages: [{ role: "user", content }],
    }),
  });
  if (!res.ok) throw new Error(`Claude Vision API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text: string = data?.content?.[0]?.text || "[]";
  const jsonStart = text.indexOf("[");
  const jsonEnd = text.lastIndexOf("]");
  const arr = jsonStart >= 0 ? JSON.parse(text.slice(jsonStart, jsonEnd + 1)) : [];
  return (arr as any[])
    .map((r) => ({
      account_name: String(r?.account_name || "").trim(),
      account_code: String(r?.account_code || "").trim(),
      debit: numify(r?.debit),
      credit: numify(r?.credit),
    }))
    .filter((r) => r.account_name && (r.debit !== 0 || r.credit !== 0));
}

Deno.serve(withSentry("parse-closing-pdf", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (!(await requireUser(req))) return new Response(JSON.stringify({ error: "인증이 필요합니다." }), { status: 401, headers: { ...CORS, "content-type": "application/json" } });
  try {
    const body = await req.json();
    const pages: string[] = (body.pages || []).slice(0, 8); // 과금·토큰 상한 — 최대 8페이지
    const accounts: { code?: string; name: string }[] = Array.isArray(body.accounts) ? body.accounts : [];
    if (!pages.length) {
      return new Response(JSON.stringify({ error: "pages (PNG base64) required" }), { status: 400, headers: { ...CORS, "content-type": "application/json" } });
    }
    const lines = await extract(pages, accounts);
    return new Response(JSON.stringify({ lines }), { headers: { ...CORS, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers: { ...CORS, "content-type": "application/json" } });
  }
}));
