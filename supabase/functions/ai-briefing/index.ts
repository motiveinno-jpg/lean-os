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
type Actions = {
  taxDeadlines?: Array<{ title: string; daysLeft: number }>;
  todos?: Array<{ title: string; priority: number; dueDate: string | null; overdue: boolean }>;
};

const PRIO = ["보통", "높음", "긴급"];

async function generate(n: Nums, a: Actions, companyName: string): Promise<string> {
  const facts = [
    `현재 통장 잔고: ${won(n.balance)}`,
    `30일 후 예상 잔고: ${won(n.forecast30)} (증감 ${won(n.forecast30 - n.balance)})`,
    `90일 후 예상 잔고: ${won(n.forecast90)}`,
    `월 고정비(소진 속도): ${won(n.monthlyBurn)}`,
    `현재 자금으로 버틸 수 있는 기간: 약 ${n.runwayMonths.toFixed(1)}개월`,
    `30일 넘게 밀린 미수금: ${won(n.arOver30)}`,
    `승인 대기 결재: ${n.pendingApprovals}건`,
    `주의가 필요한 프로젝트: ${n.riskCount}건`,
    n.monthTarget > 0 ? `이번 달 매출: ${won(n.monthRevenue)} (목표 ${won(n.monthTarget)}, 달성률 ${Math.round((n.monthRevenue / n.monthTarget) * 100)}%)` : `이번 달 매출: ${won(n.monthRevenue)}`,
  ].join("\n");

  const taxLines = (a.taxDeadlines || []).slice(0, 4).map((t) => `- ${t.title}: ${t.daysLeft <= 0 ? "오늘 마감" : `D-${t.daysLeft}`}`);
  const todoLines = (a.todos || []).slice(0, 8).map((t) => `- [${PRIO[t.priority] || "보통"}] ${t.title}${t.overdue ? " (기한 지남)" : t.dueDate ? ` (마감 ${t.dueDate})` : ""}`);
  const actionBlock = [
    taxLines.length ? `세금 마감:\n${taxLines.join("\n")}` : "",
    todoLines.length ? `내 할 일:\n${todoLines.join("\n")}` : "",
  ].filter(Boolean).join("\n") || "처리 대기·할 일 없음";

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": anthropicKey!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      messages: [{
        role: "user",
        content: `너는 중소기업 대표를 돕는 비서다. 우리 회사(${companyName || "회사"})의 오늘 상황을 보고, 50대 대표가 안경 없이도 읽기 편하게 한국어 존댓말로 브리핑을 써라. 총 4~6문장.

구성:
1) 재무 한두 문장 — 잔고와 30/90일 전망, 위험(현금 부족·런웨이 3개월 미만·30일+ 미수금)이 있으면 먼저 짚는다.
2) 오늘 할 일 정리 — 세금 마감·승인 대기·할 일을 급한 순서(마감 임박 > 긴급/높음 우선순위 > 금액 큰 것)로 네가 알아서 우선순위를 매겨 "오늘은 …부터, 그다음 …" 형태로 1~3가지를 콕 집어 제안한다.

색상 강조 태그(반드시 사용):
- 위험/부정(현금 부족, 미수금 연체, D-3 이내 마감, 잔고 감소, 기한 지난 할 일): <neg>대상</neg>
- 긍정(잔고 증가, 목표 달성, 안정적 런웨이): <pos>대상</pos>
- 그 외 핵심 금액·날짜·건수·기한: <key>대상</key>
태그는 이 3종만. 금액·D-N·건수·마감일은 반드시 셋 중 하나로 감싼다.

금지: 마크다운, 이모지, 과장·영업 멘트, 목록 기호(-·*). 자연스러운 문장으로만. 브리핑 본문만 출력.

[오늘 재무]
${facts}

[처리 대기 / 할 일]
${actionBlock}`,
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
