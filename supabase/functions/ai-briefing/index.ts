import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// AI 경영 브리핑 (생존 레이더) — 규칙 문장 조립을 진짜 Claude 요약으로 승격 (2026-07-06).
//   비용 통제: 회사당 하루 1회만 생성하고 ai_briefings 에 캐시. 같은 날 재요청은 캐시 반환.
//   fail-open: 인증·Claude·DB 어느 단계든 실패하면 { content: null } → 클라이언트가 기존 규칙 브리핑으로 폴백.

const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");
const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const won = (n: number): string => {
  const abs = Math.abs(Math.round(n));
  const eok = Math.floor(abs / 1e8);
  const man = Math.floor((abs % 1e8) / 1e4);
  const sign = n < 0 ? "-" : "";
  if (eok > 0 && man > 0) return `${sign}${eok}억 ${man.toLocaleString()}만원`;
  if (eok > 0) return `${sign}${eok}억원`;
  if (man > 0) return `${sign}${man.toLocaleString()}만원`;
  return `${sign}${abs.toLocaleString()}원`;
};

type Nums = {
  balance: number; forecast30: number; forecast90: number; runwayMonths: number;
  monthlyBurn: number; arOver30: number; pendingApprovals: number; riskCount: number;
  monthRevenue: number; monthTarget: number;
};

async function generate(n: Nums, companyName: string): Promise<string> {
  const facts = [
    `현재 통장 잔고: ${won(n.balance)}`,
    `30일 후 예상 잔고: ${won(n.forecast30)} (증감 ${won(n.forecast30 - n.balance)})`,
    `90일 후 예상 잔고: ${won(n.forecast90)}`,
    `월 고정비(소진 속도): ${won(n.monthlyBurn)}`,
    `현재 자금으로 버틸 수 있는 기간: 약 ${n.runwayMonths.toFixed(1)}개월`,
    `30일 넘게 밀린 미수금: ${won(n.arOver30)}`,
    `승인 대기 건: ${n.pendingApprovals}건`,
    `주의가 필요한 프로젝트: ${n.riskCount}건`,
    n.monthTarget > 0 ? `이번 달 매출: ${won(n.monthRevenue)} (목표 ${won(n.monthTarget)}, 달성률 ${Math.round((n.monthRevenue / n.monthTarget) * 100)}%)` : `이번 달 매출: ${won(n.monthRevenue)}`,
  ].join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": anthropicKey!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 400,
      messages: [{
        role: "user",
        content: `너는 중소기업 대표를 돕는 재무 비서다. 아래 우리 회사(${companyName || "회사"})의 오늘 재무 상황을 보고, 50대 대표가 안경 없이도 읽기 편하게 한국어 존댓말로 3~4문장 브리핑을 써라.

규칙:
- 딱딱한 숫자 나열 대신 자연스러운 문장으로. 핵심 금액·기간은 그대로 언급.
- 위험(90일 내 현금 부족, 런웨이 3개월 미만, 30일+ 미수금)이 있으면 먼저 짚고 오늘 할 행동 1가지를 구체적으로 권한다.
- 위험이 없으면 안정적임을 알리고 담백하게 마무리.
- 과장·영업 멘트 금지. 이모지 금지. 마크다운 금지. 브리핑 본문만 출력.

오늘 재무 상황:
${facts}`,
      }],
    }),
  });
  if (!res.ok) throw new Error(`claude ${res.status}`);
  const data = await res.json();
  const text = (data?.content?.[0]?.text || "").trim();
  if (!text) throw new Error("empty");
  return text;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  const fail = () => new Response(JSON.stringify({ content: null }), { headers: { ...CORS, "content-type": "application/json" } });
  try {
    if (!anthropicKey) return fail();
    const authHeader = req.headers.get("Authorization") || "";
    if (!authHeader) return fail();

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    // 인증 + 회사 식별 (JWT 에서 — 클라이언트가 companyId 를 신뢰시키지 않음)
    const { data: { user } } = await createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    }).auth.getUser();
    if (!user) return fail();

    const admin = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: urow } = await admin.from("users").select("company_id").eq("auth_id", user.id).maybeSingle();
    const companyId = urow?.company_id;
    if (!companyId) return fail();

    const body = await req.json();
    const n = body?.nums as Nums;
    if (!n || typeof n.balance !== "number") return fail();

    // KST 오늘 날짜 (하루 1회 캐시 키)
    const briefDate = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);

    // 캐시 확인
    const { data: cached } = await admin.from("ai_briefings")
      .select("content").eq("company_id", companyId).eq("brief_date", briefDate).maybeSingle();
    if (cached?.content) {
      return new Response(JSON.stringify({ content: cached.content, cached: true }), { headers: { ...CORS, "content-type": "application/json" } });
    }

    // 생성 + 캐시 저장
    const content = await generate(n, String(body?.companyName || ""));
    await admin.from("ai_briefings").upsert(
      { company_id: companyId, brief_date: briefDate, content },
      { onConflict: "company_id,brief_date" },
    );
    return new Response(JSON.stringify({ content, cached: false }), { headers: { ...CORS, "content-type": "application/json" } });
  } catch (_e) {
    return fail(); // fail-open → 규칙 브리핑 폴백
  }
});
