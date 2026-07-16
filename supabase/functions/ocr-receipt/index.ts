import { tfetch } from "../_shared/http.ts";
import { withSentry } from "../_shared/sentry.ts";
import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "jsr:@supabase/supabase-js@2";

const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

interface OcrResult {
  merchant: string | null;
  amount: number | null;
  date: string | null;
  items: string[];
  category: string | null;
  confidence: number;
}

async function analyzeReceipt(imageUrl: string): Promise<OcrResult> {
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");

  const imageRes = await tfetch(imageUrl);
  if (!imageRes.ok) throw new Error("Failed to fetch receipt image");
  const imageBuffer = await imageRes.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(imageBuffer)));

  const contentType = imageRes.headers.get("content-type") || "image/jpeg";
  const mediaType = contentType.startsWith("image/") ? contentType : "image/jpeg";

  const res = await tfetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": anthropicKey,
      "anthropic-version": "2023-06-01",
    },
    body: JSON.stringify({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 1024,
      messages: [{
        role: "user",
        content: [
          {
            type: "image",
            source: { type: "base64", media_type: mediaType, data: base64 },
          },
          {
            type: "text",
            text: `이 영수증/결제 이미지를 분석하세요. 다음 정보를 추출하여 JSON으로 반환하세요:

{
  "merchant": "가맹점명",
  "amount": 숫자(총결제금액, 원 단위),
  "date": "YYYY-MM-DD" 또는 null,
  "items": ["품목1", "품목2"],
  "category": "식대|교통|소모품|사무용품|접대|통신|기타" 중 하나,
  "confidence": 0~100 (인식 확신도)
}

JSON만 반환하세요. 이미지가 영수증이 아니거나 읽을 수 없으면 confidence를 0으로 설정하세요.`,
          },
        ],
      }],
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Claude Vision API error: ${res.status} ${err}`);
  }

  const data = await res.json();
  const text = data.content?.[0]?.text || "";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return { merchant: null, amount: null, date: null, items: [], category: null, confidence: 0 };

  const parsed = JSON.parse(jsonMatch[0]);
  return {
    merchant: parsed.merchant || null,
    amount: typeof parsed.amount === "number" ? parsed.amount : null,
    date: parsed.date || null,
    items: Array.isArray(parsed.items) ? parsed.items : [],
    category: parsed.category || null,
    confidence: typeof parsed.confidence === "number" ? Math.min(100, Math.max(0, parsed.confidence)) : 0,
  };
}

Deno.serve(withSentry("ocr-receipt", async (req: Request) => {
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

    const userClient = createClient(supabaseUrl, supabaseUrl.includes("localhost") ? serviceKey : authHeader.replace("Bearer ", ""), {
      auth: { persistSession: false },
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) {
      return new Response(JSON.stringify({ error: "Invalid auth token" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = await req.json();
    const imageUrl: string = body.image_url;
    if (!imageUrl) {
      return new Response(JSON.stringify({ error: "image_url required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const result = await analyzeReceipt(imageUrl);

    return new Response(JSON.stringify({ success: true, ...result }), {
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
