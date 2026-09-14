//   전국 공휴일 자동 수집 — 공공데이터포털 특일정보(한국천문연구원, getRestDeInfo).
//
//   달력이 공휴일을 손입력 표에만 의존해 매년·신규 공휴일이 빠지던 것을 없앤다.
//   이 함수가 올해-1 ~ 올해+2 년의 공휴일을 받아 national_holidays 캐시에 채운다.
//   회사마다 다르지 않은 전국 공휴일이므로 전 회사 공용이다.
//
//   키: 환경변수 HOLIDAY_API_KEY (공공데이터포털 '특일정보' 활용신청 인증키).
//   호출: 크론(연 1회 1/2) 또는 X-Cron-Secret 헤더로 수동. 키가 없으면 아무것도 안 하고 알린다.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { withSentry } from "../_shared/sentry.ts";
import { tfetch } from "../_shared/http.ts";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret" };
const API = "https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo";

//   키에 이미 %XX 인코딩이 있으면 그대로, 아니면 인코딩(공공데이터 인증키 두 형태 대응)
function keyParam(raw: string): string {
  return /%[0-9A-Fa-f]{2}/.test(raw) ? raw.trim() : encodeURIComponent(raw.trim());
}

//   한 해의 공휴일 — 특일정보는 월별 조회라 1~12월을 돈다. isHoliday=Y 만 담는다.
async function fetchYear(key: string, year: number): Promise<{ date: string; name: string }[]> {
  const out: { date: string; name: string }[] = [];
  for (let m = 1; m <= 12; m++) {
    const url = `${API}?ServiceKey=${keyParam(key)}&solYear=${year}&solMonth=${String(m).padStart(2, "0")}&_type=json&numOfRows=50`;
    const res = await tfetch(url, {}, 20000);
    const text = await res.text();
    let json: any;
    try { json = JSON.parse(text); } catch { throw new Error(`특일정보 응답이 JSON 이 아님 (${year}-${m}): ${text.slice(0, 120)}`); }
    const code = json?.response?.header?.resultCode;
    if (code && code !== "00") throw new Error(`특일정보 오류 ${code}: ${json?.response?.header?.resultMsg}`);
    let items = json?.response?.body?.items?.item ?? [];
    if (!Array.isArray(items)) items = items ? [items] : [];
    for (const it of items) {
      if (String(it?.isHoliday) !== "Y") continue;
      const ymd = String(it?.locdate ?? "");
      if (ymd.length !== 8) continue;
      out.push({ date: `${ymd.slice(0, 4)}-${ymd.slice(4, 6)}-${ymd.slice(6, 8)}`, name: String(it?.dateName || "공휴일").trim() });
    }
  }
  return out;
}

Deno.serve(withSentry("holidays-sync", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: cors });

  //   호출 권한 — 크론 시크릿이 있으면 그것만 확인(스케줄러용). 없으면 service_role Authorization.
  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const hdrSecret = req.headers.get("x-cron-secret") ?? "";
  const auth = req.headers.get("authorization") ?? "";
  const isCron = cronSecret && hdrSecret === cronSecret;
  const isService = auth.includes(Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "\0");
  if (!isCron && !isService) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: { ...cors, "Content-Type": "application/json" } });

  const key = Deno.env.get("HOLIDAY_API_KEY") ?? "";
  if (!key) {
    return new Response(JSON.stringify({ ok: false, skipped: "no_key", message: "HOLIDAY_API_KEY 시크릿이 없습니다. 공공데이터포털 '특일정보' 활용신청 인증키를 넣어 주세요." }),
      { status: 200, headers: { ...cors, "Content-Type": "application/json" } });
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL") ?? "", Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "");
  const thisYear = new Date(Date.now() + 9 * 3600 * 1000).getFullYear();
  const years = [thisYear - 1, thisYear, thisYear + 1, thisYear + 2];

  const rows: { date: string; name: string; is_holiday: boolean; source: string }[] = [];
  const perYear: Record<number, number> = {};
  for (const y of years) {
    const got = await fetchYear(key, y);
    perYear[y] = got.length;
    for (const g of got) rows.push({ date: g.date, name: g.name, is_holiday: true, source: "api" });
  }

  if (rows.length > 0) {
    const { error } = await admin.from("national_holidays").upsert(rows, { onConflict: "date" });
    if (error) throw error;
  }

  return new Response(JSON.stringify({ ok: true, upserted: rows.length, perYear }), { headers: { ...cors, "Content-Type": "application/json" } });
}));
