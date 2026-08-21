import { withSentry } from "../_shared/sentry.ts";
import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// 광고 성과 수집 — 1차: 네이버 검색광고 (2026-08-06 사장님 지시)
//
//   · 키는 ad_account_secrets 에 암호화돼 있고 **여기(서비스 역할)에서만** 푼다.
//   · 광고비는 당일치가 나중에 바뀐다 — 그래서 **최근 3일을 매번 다시 덮어쓴다**(사장님 확정).
//   · 캠페인×날짜 한 줄이 단위. 같은 줄은 unique 로 묶여 있어 여러 번 돌려도 쌓이지 않는다.
//
//   네이버 검색광고 API 인증(공식 문서 기준):
//     X-Timestamp : epoch ms
//     X-API-KEY   : 액세스 라이선스
//     X-Customer  : CUSTOMER_ID
//     X-Signature : base64( HMAC-SHA256( `${timestamp}.${method}.${path}`, 비밀키 ) )

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const NAVER_SA_BASE = "https://api.searchad.naver.com";
/** 몇 일치를 다시 받을지 — 광고비 확정이 늦어 최근 것은 늘 다시 받는다 */
const REFETCH_DAYS = 3;

type AdAccount = { id: string; company_id: string; platform: string; label: string; external_id: string };
type Secret = { api_key: string; api_secret: string };

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

/** 한국 날짜(YYYY-MM-DD) — 광고 통계는 KST 기준이다 */
function kstDate(offsetDays = 0): string {
  const now = new Date(Date.now() + 9 * 3600_000 + offsetDays * 86_400_000);
  return now.toISOString().slice(0, 10);
}

async function naverSign(secret: string, timestamp: string, method: string, path: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${timestamp}.${method}.${path}`));
  return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function naverGet(sec: Secret, customerId: string, path: string, query: Record<string, string | string[]>) {
  const ts = String(Date.now());
  const url = new URL(NAVER_SA_BASE + path);
  for (const [k, v] of Object.entries(query)) {
    if (Array.isArray(v)) v.forEach((x) => url.searchParams.append(k, x));
    else url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString(), {
    headers: {
      "X-Timestamp": ts,
      "X-API-KEY": sec.api_key,
      "X-Customer": customerId,
      "X-Signature": await naverSign(sec.api_secret, ts, "GET", path),
      "Content-Type": "application/json; charset=UTF-8",
    },
  });
  const text = await res.text();
  if (!res.ok) {
    //   원문 JSON 을 그대로 흘리면 화면에서 읽을 수가 없다 — 무엇을 고쳐야 하는지로 바꿔 준다
    const err = new Error(`네이버 ${path} ${res.status}: ${text.slice(0, 300)}`) as Error & { status?: number; authFailed?: boolean };
    err.status = res.status;
    err.authFailed = res.status === 401 || res.status === 403 || text.includes("auth-failed");
    throw err;
  }
  return text ? JSON.parse(text) : null;
}

/** 캠페인 목록 — id → 이름 */
async function naverCampaigns(sec: Secret, customerId: string): Promise<Record<string, string>> {
  const rows = await naverGet(sec, customerId, "/ncc/campaigns", {});
  const map: Record<string, string> = {};
  for (const c of (rows || []) as any[]) map[String(c.nccCampaignId)] = String(c.name || "");
  return map;
}

/** 캠페인×날짜 성과 — /stats 를 하루씩 부른다(id 를 한 번에 여러 개 넣을 수 있다) */
//   대시보드에서 무엇을 볼지는 사장님이 고른다 — 그래서 **매체가 주는 만큼 넓게 받아** raw 에 담아 둔다
//   (2026-08-06: "네이버 API 에서 제공하는 모든 데이터를 대시보드에 추가할 수 있어야").
//   넓은 목록이 거절당하면(계정 유형에 따라 없는 필드가 있다) 기본 목록으로 한 번 더 시도한다.
//   무엇을 주는지는 **문서가 아니라 계정이 답한다** — 하나라도 없는 이름이 끼면 요청 전체가
//   거절당하므로, 기본 목록에 후보를 하나씩만 얹어 떠보고 통과한 것만 모은다
//   (2026-08-06: 묶어서 보냈다가 통째로 거절돼 기본 5개로 후퇴했다).
const BASE_FIELDS = ["impCnt", "clkCnt", "salesAmt", "ccnt", "convAmt"];
const CANDIDATE_FIELDS = ["ctr", "cpc", "avgRnk", "crto", "ror", "cpConv", "viewCnt",
  "drtCrto", "indrCrto", "drtSales", "indrSales", "mblImpCnt", "pcImpCnt"];

async function naverStats(sec: Secret, customerId: string, ids: string[], day: string, fields: string[]) {
  const out: any[] = [];
  //   한 번에 너무 많이 넣으면 URL 이 길어져 거절당한다 — 나눠 부른다
  for (let i = 0; i < ids.length; i += 20) {
    const part = ids.slice(i, i + 20);
    const data = await naverGet(sec, customerId, "/stats", {
      ids: part,
      fields: JSON.stringify(fields),
      timeRange: JSON.stringify({ since: day, until: day }),
    });
    for (const r of (data?.data || []) as any[]) out.push({ ...r, day });
  }
  return out;
}

async function syncNaverSA(acc: AdAccount, sec: Secret, days?: string[]) {
  const campaigns = await naverCampaigns(sec, acc.external_id);
  const ids = Object.keys(campaigns);
  if (ids.length === 0) return { rows: 0, campaigns: 0 };

  const rows: any[] = [];
  //   이 계정이 받아 주는 지표를 하루 한 번 가려낸다(하루치 수집 앞의 짧은 확인)
  const fields = [...BASE_FIELDS];
  const probeDay = kstDate(-1);
  const probeIds = ids.slice(0, 1);
  for (const f of CANDIDATE_FIELDS) {
    try {
      await naverStats(sec, acc.external_id, probeIds, probeDay, [...BASE_FIELDS, f]);
      fields.push(f);
    } catch { /* 이 계정엔 없는 지표 — 건너뛴다 */ }
  }
  //   날짜를 받으면 그 날들만(달력으로 고른 기간 채우기), 없으면 최근 3일(자동 수집)
  const targetDays = days && days.length > 0 ? days : Array.from({ length: REFETCH_DAYS }, (_, i) => kstDate(-i));
  for (const day of targetDays) {
    const stats = await naverStats(sec, acc.external_id, ids, day, fields);
    for (const s of stats) {
      const cid = String(s.id || "");
      if (!cid) continue;
      rows.push({
        company_id: acc.company_id,
        ad_account_id: acc.id,
        platform: acc.platform,
        campaign_id: cid,
        campaign_name: campaigns[cid] || null,
        // 2026-08-06 마이그(20260806170000)로 지표 테이블이 캠페인 전용에서 계층(캠페인>광고그룹>소재)
        //   구조로 바뀌면서 level·entity_id 가 생겼는데 이 함수는 안 따라갔다.
        //   entity_id 는 NOT NULL 이고 유니크 키의 일부다 — 안 채우면 저장이 통째로 실패한다.
        level: "campaign",
        entity_id: cid,
        stat_date: day,
        impressions: Number(s.impCnt) || 0,
        clicks: Number(s.clkCnt) || 0,
        cost: Number(s.salesAmt) || 0,
        conversions: Number(s.ccnt) || 0,
        conv_value: Number(s.convAmt) || 0,
        raw: s,
        updated_at: new Date().toISOString(),
      });
    }
  }
  if (rows.length > 0) {
    const { error } = await admin.from("ad_metrics_daily")
      //   실제 유니크 인덱스와 정확히 같아야 한다: ad_metrics_daily_uniq2(ad_account_id, level, entity_id, stat_date).
      //   종전 값(ad_account_id,campaign_id,stat_date)은 8/06 에 지워진 옛 인덱스를 가리켜
      //   "there is no unique or exclusion constraint matching the ON CONFLICT specification"(42P10) 로
      //   **모든 수집이 실패**하고 있었다.
      .upsert(rows, { onConflict: "ad_account_id,level,entity_id,stat_date" });
    if (error) throw new Error(error.message);
  }
  return { rows: rows.length, campaigns: ids.length };
}

async function secretsOf(adAccountId: string): Promise<Secret | null> {
  const { data, error } = await admin.rpc("ad_account_secrets_read", { p_id: adAccountId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  if (!row?.api_key || !row?.api_secret) return null;
  return { api_key: row.api_key, api_secret: row.api_secret };
}

serve(withSentry("ads-sync", async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  try {
    const body = req.method === "POST" ? await req.json().catch(() => ({})) : {};
    //   accountId 를 주면 그 계정만(화면의 '지금 가져오기'), 안 주면 연결된 계정 전부(매일 자동)
    const only: string | undefined = body?.accountId;
    //   달력에서 고른 기간을 채울 때는 날짜를 받는다(최대 92일 — 한 번에 너무 오래 돌지 않게)
    const days: string[] | undefined = Array.isArray(body?.days)
      ? body.days.filter((d: unknown) => typeof d === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 92)
      : undefined;

    let q = admin.from("ad_accounts").select("id, company_id, platform, label, external_id")
      .neq("status", "disabled");
    if (only) q = q.eq("id", only);
    const { data: accounts, error } = await q;
    if (error) throw new Error(error.message);

    const results: any[] = [];
    for (const acc of (accounts || []) as AdAccount[]) {
      try {
        const sec = await secretsOf(acc.id);
        if (!sec) {
          await admin.from("ad_accounts").update({ status: "error", sync_error: "API 키가 없습니다" }).eq("id", acc.id);
          results.push({ id: acc.id, label: acc.label, ok: false, error: "키 없음" });
          continue;
        }
        if (acc.platform !== "naver_sa") {
          results.push({ id: acc.id, label: acc.label, ok: false, error: "아직 네이버 검색광고만 가져옵니다" });
          continue;
        }
        let r;
        try {
          r = await syncNaverSA(acc, sec, days);
        } catch (e) {
          //   인증이 막히면 **키와 비밀키를 바꿔** 한 번 더 해 본다 — 둘 다 0100000000… 로 시작해
          //   서로 바꿔 넣는 일이 잦다(2026-08-06 사장님 첫 등록에서 발생). 되면 무엇이 문제인지 알려 준다.
          const auth = (e as { authFailed?: boolean })?.authFailed;
          if (!auth) throw e;
          let swapWorks = false;
          try {
            await naverCampaigns({ api_key: sec.api_secret, api_secret: sec.api_key }, acc.external_id);
            swapWorks = true;
          } catch { /* 바꿔도 안 되면 아래 안내로 */ }
          throw new Error(swapWorks
            ? "API 키와 비밀키가 서로 바뀌어 있습니다. 설정에서 두 값을 맞바꿔 다시 저장해 주세요."
            : `네이버가 인증을 거부했습니다(Auth Failed). 확인할 것 — ①API 키·비밀키를 한 글자도 빠짐없이 복사했는지 ②CUSTOMER ID(${acc.external_id})가 그 키를 발급한 광고주 계정이 맞는지 ③검색광고 > 도구 > API 사용 관리에서 키가 '사용' 상태인지.`);
        }
        await admin.from("ad_accounts")
          .update({ status: "connected", sync_error: null, last_synced_at: new Date().toISOString() })
          .eq("id", acc.id);
        results.push({ id: acc.id, label: acc.label, ok: true, ...r });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        await admin.from("ad_accounts").update({ status: "error", sync_error: msg.slice(0, 500) }).eq("id", acc.id);
        results.push({ id: acc.id, label: acc.label, ok: false, error: msg.slice(0, 300) });
        // 무음 실패 방지 (2026-08-19 감사): 실패가 ad_accounts.sync_error 컬럼에만 남아
        //   광고 성과가 몇 주간 0으로 보여도 아무도 몰랐다 — 은행·카드 감시와 동일하게
        //   마스터 인앱 알림(24시간 dedup).
        try {
          const title = `광고 수집 실패: ${acc.label || acc.platform}`;
          const { data: dup } = await admin.from("notifications")
            .select("id").eq("company_id", acc.company_id).eq("title", title)
            .gte("created_at", new Date(Date.now() - 24 * 3600000).toISOString()).limit(1);
          if (!dup || dup.length === 0) {
            const { data: masters } = await admin.from("users")
              .select("id").eq("company_id", acc.company_id).eq("is_master", true);
            const rows = (masters || []).map((m: { id: string }) => ({
              company_id: acc.company_id, user_id: m.id, type: "system", title,
              message: `광고 계정 동기화가 실패하고 있습니다: ${msg.slice(0, 150)}`, link: "/settings",
            }));
            if (rows.length) await admin.from("notifications").insert(rows);
          }
        } catch { /* 감시 실패가 수집을 막지 않게 */ }
      }
    }
    return new Response(JSON.stringify({ ok: true, results }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ ok: false, error: msg }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
}));
