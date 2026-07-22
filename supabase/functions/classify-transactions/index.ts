import { tfetch } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const ACCOUNT_CATEGORIES = [
  { code: "revenue", label: "매출", type: "income" },
  { code: "other_revenue", label: "기타수익 (이자, 보조금 등)", type: "income" },
  { code: "outsourcing", label: "외주비", type: "expense" },
  { code: "infrastructure", label: "인프라/서버/호스팅", type: "expense" },
  { code: "salary", label: "급여/인건비", type: "expense" },
  { code: "rent", label: "임대료/관리비", type: "expense" },
  { code: "software", label: "소프트웨어/SaaS 구독", type: "expense" },
  { code: "professional", label: "전문서비스 (세무/법무/컨설팅)", type: "expense" },
  { code: "welfare", label: "복리후생 (식대/경조사)", type: "expense" },
  { code: "insurance", label: "4대보험", type: "expense" },
  { code: "marketing", label: "마케팅/광고", type: "expense" },
  { code: "supplies", label: "소모품/사무용품", type: "expense" },
  { code: "travel", label: "출장/교통비", type: "expense" },
  { code: "communication", label: "통신비", type: "expense" },
  { code: "tax", label: "세금/공과금", type: "expense" },
  { code: "depreciation", label: "감가상각비", type: "expense" },
  { code: "interest", label: "이자비용", type: "expense" },
  { code: "other_expense", label: "기타 운영비", type: "expense" },
];

const BATCH_SIZE = 20;

interface TxRow {
  id: string;
  type: string;
  amount: number;
  counterparty: string | null;
  description: string | null;
  memo: string | null;
  transaction_date: string;
}

async function classifyWithClaude(transactions: TxRow[]): Promise<Record<string, { category: string; confidence: number }>> {
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const txList = transactions.map((tx, i) =>
    `${i + 1}. [${tx.id}] ${tx.type === "income" ? "입금" : "출금"} ${tx.amount.toLocaleString()}원 | 거래처: ${tx.counterparty || "없음"} | 적요: ${tx.description || "없음"} | 메모: ${tx.memo || "없음"} | 날짜: ${tx.transaction_date}`
  ).join("\n");

  const categoryList = ACCOUNT_CATEGORIES.map(c => `- ${c.code}: ${c.label}`).join("\n");

  const res = await tfetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: `한국 기업의 은행 거래내역을 계정과목으로 분류하세요.

계정과목 목록:
${categoryList}

거래 목록:
${txList}

각 거래의 ID와 가장 적합한 category code, 확신도(0~100)를 JSON 배열로 반환하세요.
형식: [{"id":"uuid","category":"code","confidence":85}]
JSON만 반환하세요.`,
      }],
    }),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Claude API error: ${res.status} ${errText}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || "";

  const jsonMatch = text.match(/\[[\s\S]*\]/);
  if (!jsonMatch) throw new Error("Failed to parse AI response");

  const results: { id: string; category: string; confidence: number }[] = JSON.parse(jsonMatch[0]);
  const map: Record<string, { category: string; confidence: number }> = {};
  for (const r of results) {
    if (r.id && r.category && ACCOUNT_CATEGORIES.some(c => c.code === r.category)) {
      map[r.id] = { category: r.category, confidence: Math.min(100, Math.max(0, r.confidence)) };
    }
  }
  return map;
}

Deno.serve(withSentry("classify-transactions", async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "Authorization required" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(supabaseUrl, serviceKey);

    // 사용자 인증 — anon 키를 apikey 로, 사용자 JWT 는 Authorization 헤더로 검증(정상 함수들과 동일 패턴).
    //   (이전엔 사용자 JWT 를 apikey 자리에 넣어 GoTrue 가 거부 → getUser=null → 401 버그. 2026-07-22 수정)
    const { data: { user } } = await createClient(supabaseUrl, anonKey, {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    }).auth.getUser();

    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid auth token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userData } = await supabase
      .from("users")
      .select("company_id, role")
      .eq("id", user.id)
      .single();

    if (!userData?.company_id) {
      return new Response(JSON.stringify({ error: "No company found" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json().catch(() => ({}));
    const txIds: string[] | undefined = body.transaction_ids;
    // 제안 모드(suggest:true) — DB에 적용하지 않고 추천만 반환. 확정은 사람이 UI에서(확정은 사람 원칙).
    const suggestOnly = body.suggest === true;

    let query = supabase
      .from("bank_transactions")
      .select("id, type, amount, counterparty, description, memo, transaction_date")
      .eq("company_id", userData.company_id)
      .eq("mapping_status", "unmapped")
      .order("transaction_date", { ascending: false })
      .limit(BATCH_SIZE);

    if (txIds && txIds.length > 0) {
      query = supabase
        .from("bank_transactions")
        .select("id, type, amount, counterparty, description, memo, transaction_date")
        .eq("company_id", userData.company_id)
        .in("id", txIds.slice(0, BATCH_SIZE));
    }

    const { data: transactions, error: fetchErr } = await query;
    if (fetchErr) throw new Error(fetchErr.message);
    if (!transactions || transactions.length === 0) {
      return new Response(JSON.stringify({ success: true, classified: 0, message: "분류할 거래가 없습니다" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const classifications = await classifyWithClaude(transactions as TxRow[]);

    let classified = 0;
    if (!suggestOnly) {
      for (const [txId, result] of Object.entries(classifications)) {
        const { error: updateErr } = await supabase
          .from("bank_transactions")
          .update({
            category: result.category,
            classification: `ai_classified (${result.confidence}%)`,
            mapping_status: result.confidence >= 70 ? "auto_mapped" : "unmapped",
          })
          .eq("id", txId)
          .eq("company_id", userData.company_id);

        if (!updateErr) classified++;
      }
    }

    return new Response(JSON.stringify({
      success: true,
      total: transactions.length,
      classified,
      results: Object.entries(classifications).map(([id, r]) => ({
        id, category: r.category, confidence: r.confidence,
      })),
    }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
