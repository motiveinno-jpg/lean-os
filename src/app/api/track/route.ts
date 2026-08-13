// 마케팅 이벤트 수집 (2026-08-13) — GA4와 병행해 자체 DB(marketing_events)에도 기록.
//   운영자 페이지(/platform/marketing)가 실시간 시각화에 쓴다 (GA4 리포트는 최대 하루 지연).
//   익명 방문자(공개 계산기)도 보내므로 무인증 — 대신 이벤트 화이트리스트·필드 절단·IP 레이트리밋.
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";

const ALLOWED = new Set(["page_view", "tool_calculate", "sign_up", "bank_connect", "checkout_start"]);

// 인스턴스별 in-memory 레이트리밋 (미들웨어 auth 패턴과 동일한 한계 — 완벽 보장은 아님)
const WINDOW_MS = 60_000;
const MAX_PER_MIN = 60;
const hits = new Map<string, { count: number; resetAt: number }>();
function limited(ip: string): boolean {
  const now = Date.now();
  if (hits.size > 500) for (const [k, v] of hits) { if (now > v.resetAt) hits.delete(k); }
  const e = hits.get(ip);
  if (!e || now > e.resetAt) { hits.set(ip, { count: 1, resetAt: now + WINDOW_MS }); return false; }
  return ++e.count > MAX_PER_MIN;
}

const cut = (v: unknown, n: number) => (typeof v === "string" ? v.slice(0, n) : null);

export async function POST(req: NextRequest) {
  try {
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
    if (limited(ip)) return new NextResponse(null, { status: 204 }); // 조용히 버린다

    const body = await req.json().catch(() => null);
    const event = String(body?.event || "");
    if (!ALLOWED.has(event)) return new NextResponse(null, { status: 204 });

    // params 는 소형 스칼라만 통과 (PII·대형 페이로드 차단)
    const params: Record<string, string | number | boolean> = {};
    if (body?.params && typeof body.params === "object") {
      for (const [k, v] of Object.entries(body.params).slice(0, 8)) {
        if (["string", "number", "boolean"].includes(typeof v)) {
          params[k.slice(0, 40)] = typeof v === "string" ? v.slice(0, 120) : (v as number | boolean);
        }
      }
    }

    const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!.trim(), process.env.SUPABASE_SERVICE_ROLE_KEY!);
    const { error } = await db.from("marketing_events").insert({
      event,
      params,
      path: cut(body?.path, 300),
      referrer: cut(body?.ref, 300),
    });
    if (error) console.error("[track] insert 실패:", error.message); // Vercel 함수 로그로만 — 클라이언트엔 항상 204
  } catch { /* 계측은 절대 실서비스를 방해하지 않는다 */ }
  return new NextResponse(null, { status: 204 });
}
