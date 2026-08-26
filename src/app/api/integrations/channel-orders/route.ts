import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { CHANNEL_FETCHERS } from "@/lib/channel-api";

// 채널 주문 가져오기 (2026-08-26 사장님 지시 — "채널별로 API 연결해서 끌고 오면 자동으로 채워지게")
//
//   test-key 와 같은 원칙 — 사용자 세션 그대로(RLS 가 자기 회사 키만 내준다), 평문 키는 응답에 담지 않는다.
//   주문을 **재고에 넣지 않는다.** 격자에 채워만 주고 출고 등록은 사람이 누른다(제안은 자동, 확정은 사람).

export const runtime = "nodejs";

export async function POST(req: NextRequest) {
  try {
    const sb = await createSupabaseServerClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });
    const { data: me } = await sb.from("users").select("id, company_id").eq("auth_id", user.id).maybeSingle();
    if (!me?.company_id) return NextResponse.json({ ok: false, message: "회사 정보가 없습니다." }, { status: 403 });

    const { channel, from, to } = await req.json();
    const fetcher = CHANNEL_FETCHERS[String(channel)];
    if (!fetcher) return NextResponse.json({ ok: false, message: "이 채널은 API 자동 수집을 지원하지 않습니다 — 엑셀 붙여넣기를 이용하세요.", noApi: true }, { status: 400 });
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(from)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(to))) {
      return NextResponse.json({ ok: false, message: "조회 기간을 확인하세요." }, { status: 400 });
    }

    const { data: row } = await sb.from("company_api_keys")
      .select("key_encrypted").eq("company_id", me.company_id).eq("provider", channel).maybeSingle();
    if (!row?.key_encrypted) {
      return NextResponse.json({ ok: false, noKey: true, message: "이 채널의 API 키가 등록되지 않았습니다 — 회사 설정 › 연동·API 키에서 등록하세요." }, { status: 404 });
    }
    const { data: dec, error: decErr } = await sb.rpc("decrypt_credential", { p_ciphertext: row.key_encrypted });
    if (decErr || !dec) return NextResponse.json({ ok: false, message: "저장된 인증키를 읽지 못했습니다." }, { status: 500 });

    const rows = await fetcher(String(dec), String(from), String(to));
    await sb.from("company_api_keys").update({ last_used_at: new Date().toISOString() })
      .eq("company_id", me.company_id).eq("provider", channel);
    return NextResponse.json({ ok: true, rows });
  } catch (err) {
    const message = err instanceof Error ? err.message : "가져오지 못했습니다.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
