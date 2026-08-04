import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function GET(req: Request) {
  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Vercel env 의 CODEF 키가 깨져 직접 발급이 502 (2026-08-04 실증, trim 으로도 미해결) —
  //   codef-sync cron 이 매일 검증하는 엣지 시크릿으로 발급하는 codef-cert-token 엣지 함수에 위임.
  const res = await fetch(
    `${process.env.NEXT_PUBLIC_SUPABASE_URL}/functions/v1/codef-cert-token`,
    { headers: { Authorization: authHeader } },
  );
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.token) {
    console.warn(`[codef/cert-token] 엣지 위임 실패: HTTP ${res.status}`);
    return NextResponse.json(
      { error: body?.error || "CODEF token request failed" },
      { status: res.status === 401 ? 401 : 502 },
    );
  }

  return NextResponse.json({ token: body.token });
}
