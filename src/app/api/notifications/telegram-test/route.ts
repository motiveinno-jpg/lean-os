import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";

// 텔레그램 알림 테스트 — 설정 > 알림 탭의 "테스트 발송" 버튼.
//   (2026-07-06 QA: 이 라우트가 없어 항상 404 → "발송 실패" 오답 안내였음)
//   로그인 유저만. 제공된 chatId 로 봇이 테스트 메시지 1건 발송.
export async function POST(req: NextRequest) {
  try {
    const ss = await createSupabaseServerClient();
    const { data: { user } } = await ss.auth.getUser();
    if (!user) return NextResponse.json({ error: "인증이 필요합니다." }, { status: 401 });

    const { chatId } = (await req.json()) as { chatId?: string };
    const cid = String(chatId || "").trim();
    if (!cid) return NextResponse.json({ error: "chatId가 필요합니다." }, { status: 400 });

    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) return NextResponse.json({ error: "텔레그램 봇이 서버에 설정되지 않았습니다." }, { status: 503 });

    const res = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        chat_id: cid,
        text: "✅ OwnerView 텔레그램 알림 테스트입니다. 이 메시지가 보이면 정상 연결되었습니다.",
        disable_web_page_preview: true,
      }),
    });
    if (!res.ok) {
      // 텔레그램 API 에러(잘못된 chatId·봇 차단 등)를 그대로 전달
      const body = await res.json().catch(() => ({}));
      return NextResponse.json({ error: body?.description || "텔레그램 발송 실패 — Chat ID를 확인하세요." }, { status: 400 });
    }
    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json({ error: err?.message || "서버 오류" }, { status: 500 });
  }
}
