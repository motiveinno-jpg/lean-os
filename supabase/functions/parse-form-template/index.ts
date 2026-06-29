import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// 회사 양식 PDF 필드 자동 인식 (Claude Vision) — 2026-06-29.
//   입력: { doc_type: 'quote'|'contract', pages: [PNG base64 …] }  (클라가 pdfjs 로 래스터화해 전송)
//   출력: { doc_type, fields: [{ key, label, page, x, y, w, h(0~1, 좌상단), align, font_size, kind }] }
//   동적 항목(거래처·금액·날짜·서명 등)만 정규화 bbox 로 추출. 고정 문구 제외. 사람 보정 전제(초안).
//   비용: 페이지당 vision 1회(업로드 시 1회성). 모델=claude-sonnet-4-6(공간추론 우선).

const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

// 표준 데이터키 — doc_type 별. 인식은 이 키들로만 매핑(나머지는 사람이 보정).
const KEYS: Record<string, { key: string; label: string; kind: string }[]> = {
  quote: [
    { key: "partner_name", label: "거래처명", kind: "text" },
    { key: "partner_rep", label: "거래처 대표자", kind: "text" },
    { key: "doc_no", label: "견적번호", kind: "text" },
    { key: "issue_date", label: "작성일", kind: "date" },
    { key: "valid_until", label: "유효기간", kind: "date" },
    { key: "project_name", label: "프로젝트/건명", kind: "text" },
    { key: "supply_amount", label: "공급가액", kind: "amount" },
    { key: "vat", label: "부가세", kind: "amount" },
    { key: "total_amount", label: "합계금액", kind: "amount" },
    { key: "manager_name", label: "담당자", kind: "text" },
    { key: "company_name", label: "제안사명", kind: "text" },
    { key: "items_table", label: "품목 표 영역", kind: "items_table" },
  ],
  contract: [
    { key: "partner_name", label: "갑/거래처명", kind: "text" },
    { key: "partner_rep", label: "거래처 대표자", kind: "text" },
    { key: "company_name", label: "을/회사명", kind: "text" },
    { key: "company_rep", label: "회사 대표자", kind: "text" },
    { key: "doc_no", label: "계약번호", kind: "text" },
    { key: "contract_date", label: "계약일", kind: "date" },
    { key: "total_amount", label: "계약금액", kind: "amount" },
    { key: "project_name", label: "계약 건명", kind: "text" },
    { key: "sign_party_a", label: "서명_갑", kind: "signature" },
    { key: "sign_party_b", label: "서명_을", kind: "signature" },
  ],
};

interface Field { key: string; label: string; page: number; x: number; y: number; w: number; h: number; align: string; font_size: number; kind: string }

async function detectFields(docType: string, pageBase64: string, pageIndex: number): Promise<Field[]> {
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const keys = KEYS[docType] || KEYS.quote;
  const keyList = keys.map((k) => `- ${k.key} (${k.label}, kind=${k.kind})`).join("\n");

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6",
      max_tokens: 2048,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: pageBase64 } },
          {
            type: "text",
            text: `이 ${docType === "contract" ? "계약서" : "견적서"} 양식 이미지에서 '동적으로 채워질 값이 들어갈 빈 영역'의 위치만 찾으세요. 회사명·항목명 같은 고정 인쇄 문구는 제외하고, 아래 표준 키에 해당하는 입력 영역만 추출합니다.

표준 키:
${keyList}

각 영역을 정규화 좌표(이미지 좌상단 0,0 / 우하단 1,1)로 반환:
{ "fields": [ { "key": "<표준키>", "x": 0~1, "y": 0~1, "w": 0~1, "h": 0~1, "align": "left|right|center" } ] }

규칙:
- 확실한 것만(불확실하면 제외 — 사람이 보정함). 추측 금지.
- x,y = 영역 좌상단. w,h = 폭/높이(정규화).
- 금액은 보통 우측정렬(align=right). 서명칸은 kind=signature 영역.
- 표준 키에 없는 항목은 무시. JSON만 출력(설명 없이).`,
          },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`anthropic ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const data = await res.json();
  const text: string = data?.content?.[0]?.text || "";
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return [];
  let parsed: any;
  try { parsed = JSON.parse(m[0]); } catch { return []; }
  const km = new Map(keys.map((k) => [k.key, k]));
  return (parsed.fields || [])
    .filter((f: any) => km.has(f.key) && typeof f.x === "number")
    .map((f: any): Field => {
      const def = km.get(f.key)!;
      return {
        key: f.key, label: def.label, kind: def.kind, page: pageIndex + 1,
        x: Math.max(0, Math.min(1, Number(f.x))), y: Math.max(0, Math.min(1, Number(f.y))),
        w: Math.max(0.01, Math.min(1, Number(f.w || 0.2))), h: Math.max(0.01, Math.min(1, Number(f.h || 0.03))),
        align: ["left", "right", "center"].includes(f.align) ? f.align : (def.kind === "amount" ? "right" : "left"),
        font_size: 10,
      };
    });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  try {
    const { doc_type, pages } = await req.json() as { doc_type: string; pages: string[] };
    if (!doc_type || !Array.isArray(pages) || pages.length === 0) {
      return new Response(JSON.stringify({ error: "doc_type, pages[] required" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    const dt = doc_type === "contract" ? "contract" : "quote";
    const all: Field[] = [];
    for (let i = 0; i < pages.length; i++) {
      const stripped = String(pages[i]).replace(/^data:image\/\w+;base64,/, "");
      const fields = await detectFields(dt, stripped, i);
      all.push(...fields);
    }
    return new Response(JSON.stringify({ doc_type: dt, fields: all }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (err) {
    return new Response(JSON.stringify({ error: err instanceof Error ? err.message : "unknown" }), { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  }
});
