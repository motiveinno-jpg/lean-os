// Supabase Edge Function: parse-form-template (2026-06-29)
//   회사 양식 PDF 페이지 이미지(PNG base64)를 Claude Vision 으로 분석 →
//   동적으로 채워야 할 필드 영역을 정규화 좌표(0~1, 좌상단 원점)로 추출.
//   ※ 배포: supabase/functions/parse-form-template/index.ts 로 복사 후 deploy. ANTHROPIC_API_KEY 필요.
//   ※ ocr-receipt 패턴 확장. 클라이언트가 pdfjs 로 각 페이지를 PNG 로 래스터화해 보낸다.

const anthropicKey = Deno.env.get("ANTHROPIC_API_KEY");

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// 인식 대상 표준 필드 키 (문서종류별). 모델이 영역을 이 키 중 하나로 매핑.
const KEYS: Record<string, string[]> = {
  quote: ["회사명", "대표자명", "거래처명", "거래처대표", "프로젝트명", "견적번호", "작성일", "유효기간", "공급가액", "부가세", "합계금액", "품목표", "비고", "서명_공급자"],
  contract: ["회사명", "대표자명", "거래처명", "거래처대표", "프로젝트명", "계약번호", "작성일", "계약시작일", "계약종료일", "계약금액", "부가세", "합계금액", "서명_갑", "서명_을", "비고"],
};

type Field = { page: number; key: string; label: string; x: number; y: number; w: number; h: number; kind: string };

async function analyzePage(pngBase64: string, page: number, docType: string): Promise<Field[]> {
  if (!anthropicKey) throw new Error("ANTHROPIC_API_KEY not configured");
  const allowed = (KEYS[docType] || KEYS.quote).join(", ");
  const prompt = `이것은 회사의 ${docType === "contract" ? "전자계약서" : "견적서"} 양식 PDF 의 ${page}페이지 이미지입니다.
이 양식에서 "매번 값이 바뀌어 채워 넣어야 하는 동적 항목"의 위치를 찾아주세요.
고정 문구(조항 제목, 안내문 등)는 제외하고, 빈칸·표의 데이터 칸·금액칸·날짜칸·서명칸만 대상으로 합니다.

각 항목에 대해 다음 JSON 배열만 출력하세요(설명 금지):
[{"key":"<아래 목록 중 하나>","label":"<화면 표시용 한글>","x":0~1,"y":0~1,"w":0~1,"h":0~1,"kind":"text|amount|date|signature|items_table"}]
- 좌표는 이미지 기준 정규화 값(좌상단 원점, x=가로비율, y=세로비율, w/h=폭/높이 비율).
- key 는 반드시 이 목록 중에서만: ${allowed}. 해당 없으면 그 항목은 제외.
- 금액칸=amount, 날짜칸=date, 서명/도장칸=signature, 견적 품목 표 전체 영역=items_table, 그 외=text.
- 확실하지 않으면 포함하지 마세요(정밀도 우선).`;

  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": anthropicKey, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({
      model: "claude-sonnet-4-6", // 공간 추론 정확도 우선(haiku 대비). 비용↑ — 페이지당 1회.
      max_tokens: 2000,
      messages: [{
        role: "user",
        content: [
          { type: "image", source: { type: "base64", media_type: "image/png", data: pngBase64 } },
          { type: "text", text: prompt },
        ],
      }],
    }),
  });
  if (!res.ok) throw new Error(`Claude Vision API error: ${res.status} ${await res.text()}`);
  const data = await res.json();
  const text: string = data?.content?.[0]?.text || "[]";
  const jsonStart = text.indexOf("[");
  const jsonEnd = text.lastIndexOf("]");
  const arr = jsonStart >= 0 ? JSON.parse(text.slice(jsonStart, jsonEnd + 1)) : [];
  const allowedSet = new Set(KEYS[docType] || KEYS.quote);
  return (arr as any[])
    .filter((f) => f && allowedSet.has(f.key))
    .map((f) => ({
      page,
      key: String(f.key),
      label: String(f.label || f.key),
      x: clamp01(f.x), y: clamp01(f.y), w: clamp01(f.w), h: clamp01(f.h),
      kind: ["text", "amount", "date", "signature", "items_table"].includes(f.kind) ? f.kind : "text",
    }));
}

const clamp01 = (n: any) => Math.max(0, Math.min(1, Number(n) || 0));

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const body = await req.json();
    const docType: string = body.doc_type === "contract" ? "contract" : "quote";
    const pages: string[] = body.pages || []; // PNG base64 (data 부분만), 페이지 순서대로
    if (!pages.length) {
      return new Response(JSON.stringify({ error: "pages (PNG base64) required" }), { status: 400, headers: { ...CORS, "content-type": "application/json" } });
    }
    const all: Field[] = [];
    for (let i = 0; i < pages.length; i++) {
      const fields = await analyzePage(pages[i], i + 1, docType);
      all.push(...fields);
    }
    return new Response(JSON.stringify({ doc_type: docType, fields: all }), { headers: { ...CORS, "content-type": "application/json" } });
  } catch (e) {
    return new Response(JSON.stringify({ error: String((e as Error)?.message || e) }), { status: 500, headers: { ...CORS, "content-type": "application/json" } });
  }
});
