import { NextRequest, NextResponse } from "next/server";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { testChannelKey } from "@/lib/channel-api";

// 외부 API 인증키 연결 확인 (2026-08-21 사장님 지시 — 회사별 키)
//
// 왜 서버를 거치나
//   ① 브라우저에서 apis.data.go.kr · bizinfo.go.kr 를 직접 부르면 **CORS 로 막힌다.**
//   ② 저장된 키로 다시 확인할 때 평문이 필요한데, **평문을 브라우저로 내려보내지 않는다.**
//
// 왜 service_role 을 안 쓰나
//   **사용자 세션 그대로 쓴다.** 그러면 company_api_keys RLS 가 "자기 회사 것만" 을 DB 에서 강제한다 —
//   service_role 로 열면 그 보호막이 사라지고, 회사 판별을 코드가 실수하는 순간 남의 키를 만지게 된다.
//   decrypt_credential 은 authenticated 에게 이미 부여돼 있다(설정 화면이 쓰는 것과 같은 경로).
//
// 왜 확인이 필요한가 — 2026-08-21 실증: 기존 data.go.kr 키가 K-Startup 에 등록돼 있지 않았는데
//   함수를 배포하고 호출해 보기 전까지 아무도 몰랐다. 기관이 준 답은 SERVICE_KEY_IS_NOT_REGISTERED_ERROR.
//   그 문구를 **그대로** 사람에게 보여 줘야 원인을 엉뚱한 데서 찾지 않는다.

export const runtime = "nodejs";

/** 공공데이터포털은 같은 키를 Encoding/Decoding 두 꼴로 준다 — 이미 인코딩된 값을 또 인코딩하면 %252F 가 된다 */
function serviceKeyParam(raw: string): string {
  return /%[0-9A-Fa-f]{2}/.test(raw) ? raw.trim() : encodeURIComponent(raw.trim());
}

type TestResult = { ok: boolean; message: string };

async function testKstartup(key: string): Promise<TestResult> {
  const url =
    "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01" +
    `?serviceKey=${serviceKeyParam(key)}&page=1&perPage=1&returnType=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const text = await res.text();

  //   인증키가 안 맞으면 JSON 이 아니라 XML 오류가 온다 — 기관 문구를 그대로 전한다
  try {
    const body = JSON.parse(text) as { totalCount?: number; data?: unknown[] };
    if (typeof body.totalCount === "number" || Array.isArray(body.data)) {
      return { ok: true, message: `연결됐습니다 — 공고 ${(body.totalCount ?? 0).toLocaleString("ko-KR")}건을 볼 수 있습니다.` };
    }
    return { ok: false, message: "응답 형식을 알아보지 못했습니다. 인증키를 다시 확인해 주세요." };
  } catch {
    const err = text.match(/<returnAuthMsg>([^<]+)<\/returnAuthMsg>/)?.[1]
      || text.match(/<errMsg>([^<]+)<\/errMsg>/)?.[1]
      || text.slice(0, 160);
    return { ok: false, message: `기관 응답: ${err}` };
  }
}

async function testBizinfo(key: string): Promise<TestResult> {
  const url = `https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do?crtfcKey=${encodeURIComponent(key.trim())}&dataType=json&searchCnt=1`;
  const res = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const text = await res.text();

  try {
    const body = JSON.parse(text) as { jsonArray?: unknown[] };
    if (Array.isArray(body.jsonArray) && body.jsonArray.length > 0) {
      return { ok: true, message: "연결됐습니다 — 지원사업 공고를 받아올 수 있습니다." };
    }
    return { ok: false, message: "공고가 오지 않았습니다. 인증키를 다시 확인해 주세요." };
  } catch {
    return { ok: false, message: `기관 응답: ${text.replace(/<[^>]+>/g, " ").trim().slice(0, 160)}` };
  }
}

const TESTERS: Record<string, (key: string) => Promise<TestResult>> = {
  kstartup: testKstartup,
  bizinfo: testBizinfo,
  //   채널 주문 API (2026-08-26) — 규격은 channel-api.ts, 실제로 한 번 부른다
  smartstore: (k) => testChannelKey("smartstore", k),
  coupang: (k) => testChannelKey("coupang", k),
};

export async function POST(req: NextRequest) {
  try {
    //   로그인한 대표·관리자만 — 남의 키를 우리 서버로 확인해 주는 통로가 되면 안 된다
    const sb = await createSupabaseServerClient();
    const { data: { user } } = await sb.auth.getUser();
    if (!user) return NextResponse.json({ ok: false, message: "로그인이 필요합니다." }, { status: 401 });

    const { data: me } = await sb.from("users")
      .select("id, company_id, role").eq("auth_id", user.id).maybeSingle();
    if (!me?.company_id || !["owner", "admin"].includes(String(me.role))) {
      return NextResponse.json({ ok: false, message: "대표·관리자만 확인할 수 있습니다." }, { status: 403 });
    }

    const { provider, key, useStored } = await req.json();
    const tester = TESTERS[String(provider)];
    if (!tester) return NextResponse.json({ ok: false, message: "알 수 없는 연동입니다." }, { status: 400 });

    let plain = String(key || "").trim();

    if (useStored) {
      //   저장된 키로 다시 확인 — 복호화는 서버에서만 하고, 평문은 응답에 담지 않는다
      //   RLS 가 자기 회사 것만 내준다 — company_id 조건은 방어적 이중 확인이다
      const { data: row } = await sb.from("company_api_keys")
        .select("key_encrypted").eq("company_id", me.company_id).eq("provider", provider).maybeSingle();
      if (!row?.key_encrypted) {
        return NextResponse.json({ ok: false, message: "등록된 인증키가 없습니다." }, { status: 404 });
      }
      const { data: dec, error: decErr } = await sb.rpc("decrypt_credential", { p_ciphertext: row.key_encrypted });
      if (decErr || !dec) {
        return NextResponse.json({ ok: false, message: "저장된 인증키를 읽지 못했습니다." }, { status: 500 });
      }
      plain = String(dec);
    }

    if (!plain) return NextResponse.json({ ok: false, message: "인증키를 넣어 주세요." }, { status: 400 });

    const result = await tester(plain);

    //   다시 확인한 경우엔 상태도 함께 갱신한다 (화면이 최신을 보여 주도록)
    if (useStored) {
      await sb.from("company_api_keys").update({
        status: result.ok ? "ok" : "error",
        last_tested_at: new Date().toISOString(),
        last_error: result.ok ? null : result.message,
      }).eq("company_id", me.company_id).eq("provider", provider);
    }

    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "확인하지 못했습니다.";
    return NextResponse.json({ ok: false, message }, { status: 500 });
  }
}
