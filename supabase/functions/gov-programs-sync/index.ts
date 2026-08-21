// supabase/functions/gov-programs-sync/index.ts
//
// 지원사업 공고 수집 — K-Startup(창업진흥원) · 기업마당 (2026-08-21 사장님 지시)
//
// 기획: docs/20260821_PLAN_support_programs.md · docs/20260821_PLAN_settings_ia_and_api_keys.md
//
// ★ **회사가 등록한 자기 인증키로 받아온다.** (사장님 지시 — "플랫폼키는 회사별로 입력 안 하면
//   쓰지 못하게. 회사가 자기 키를 넣었을 때만 쓸 수 있게.")
//   왜 회사별인가 — 공공데이터포털·기업마당 키는 **발급받은 계정의 호출 한도**를 쓴다.
//   우리 키 하나로 모든 회사를 돌리면 회사가 늘수록 한도가 먼저 터지고 그 순간 전 회사가 멈춘다.
//   키는 company_api_keys 에 pgcrypto 로 암호화돼 있고, 여기서 service_role 로만 푼다.
//
// ★ 공고 자체는 회사마다 다르지 않으므로 **공용 카탈로그(gov_programs)** 한 벌에 모은다.
//   회사별 접근은 화면이 '키 등록 여부'로 가른다 — 키가 없으면 공고가 안 보이고 발급 안내가 뜬다.
//
// ★ AI 를 쓰지 않는다. 두 원천 모두 지역·업력·대상·분야가 이미 칸으로 갈려 있다.
//
// ★ 사라진 공고는 지우지 않고 status='closed' 로 내린다 — 담아둔 회사가 있다.
//   ⚠️ 한 건도 못 받아온 원천은 **아무것도 닫지 않는다.** 키가 막힌 날 목록이 통째로 사라지면 안 된다.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const KSTARTUP_URL = "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01";
const BIZINFO_URL = "https://www.bizinfo.go.kr/uss/rss/bizinfoApi.do";
const COOLDOWN_MIN = 30;
const MAX_COMPANIES = 20;   // 한 번에 도는 회사 수 상한 — 회사가 늘어도 실행이 무한정 길어지지 않게

type Row = Record<string, unknown>;
const str = (v: unknown) => String(v ?? "").trim();

/** 공공데이터포털은 같은 키를 Encoding/Decoding 두 꼴로 준다 — 이미 인코딩된 값을 또 인코딩하면 %252F 가 된다 */
function serviceKeyParam(raw: string): string {
  return /%[0-9A-Fa-f]{2}/.test(raw) ? raw.trim() : encodeURIComponent(raw.trim());
}

function toDate(v: unknown): string | null {
  const s = str(v).replace(/[^0-9]/g, "");
  if (s.length !== 8) return null;
  const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8);
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${m}-${d}`;
}

/** "2026-08-20 ~ 2026-09-02" → [시작, 끝]. 기업마당은 이 꼴 하나로 온다 */
function parseRange(v: unknown): [string | null, string | null] {
  const m = str(v).match(/(\d{4}-\d{2}-\d{2})\s*~\s*(\d{4}-\d{2}-\d{2})/);
  return m ? [m[1], m[2]] : [null, null];
}

function maxYears(v: unknown): number | null {
  const nums = str(v).match(/(\d+)년미만/g);
  if (!nums || nums.length === 0) return null;
  return Math.max(...nums.map((t) => Number(t.replace(/[^0-9]/g, ""))));
}

const SIDO = ["서울", "부산", "대구", "인천", "광주", "대전", "울산", "세종",
  "경기", "강원", "충북", "충남", "전북", "전남", "경북", "경남", "제주"];

/** 해시태그·지원지역 글자에서 시도를 뽑는다. 하나도 없으면 전국(빈 배열) */
function regionsFrom(text: unknown): string[] {
  const raw = str(text);
  if (!raw || raw.includes("전국")) return [];
  return SIDO.filter((s) => raw.includes(s));
}

function splitList(v: unknown): string[] {
  return str(v).split(/[,·]/).map((s) => s.trim()).filter(Boolean);
}

function stripHtml(v: unknown): string {
  return str(v).replace(/<[^>]+>/g, " ").replace(/&[a-z]+;/gi, " ").replace(/\s+/g, " ").trim();
}

function short(v: string, n: number): string | null {
  if (!v) return null;
  return v.length <= n ? v : `${v.slice(0, n)}…`;
}

// ── 원천별 받아오기 · 옮기기 ───────────────────────────────────────────────

async function fetchKstartup(key: string, stamp: string): Promise<Row[]> {
  const out: Row[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= 6; page += 1) {
    const url = `${KSTARTUP_URL}?serviceKey=${serviceKeyParam(key)}` +
      `&page=${page}&perPage=500&returnType=json` +
      `&${encodeURIComponent("cond[rcrt_prgs_yn::EQ]")}=Y`;
    const res = await fetch(url);
    const text = await res.text();
    if (!res.ok) throw new Error(`K-Startup ${res.status}: ${text.slice(0, 200)}`);
    let body: { data?: Row[] };
    try { body = JSON.parse(text); } catch {
      throw new Error(`응답을 읽지 못했습니다: ${text.replace(/<[^>]+>/g, " ").trim().slice(0, 200)}`);
    }
    const batch = body.data ?? [];
    for (const r of batch) {
      const id = str(r.pbanc_sn), title = str(r.biz_pbanc_nm);
      if (!id || !title || seen.has(id)) continue;
      seen.add(id);
      out.push({
        source: "kstartup", external_id: id, title,
        org: str(r.pbanc_ntrp_nm) || str(r.sprv_inst) || null,
        field: str(r.supt_biz_clsfc) || null,
        support_type: "창업지원",
        summary: short(stripHtml(r.pbanc_ctnt), 160),
        requirement: short(stripHtml(r.aply_trgt_ctnt || r.aply_trgt), 400),
        amount_text: null, amount_max: null,
        detail_url: str(r.detl_pg_url) || str(r.biz_gdnc_url) || null,
        apply_start: toDate(r.pbanc_rcpt_bgng_dt),
        apply_end: toDate(r.pbanc_rcpt_end_dt),
        eligibility: {
          regions: regionsFrom(r.supt_regin),
          max_years: maxYears(r.biz_enyy),
          targets: splitList(r.aply_trgt),
          exclude: short(stripHtml(r.aply_excl_trgt_ctnt), 300),
          dept: str(r.biz_prch_dprt_nm) || null,
          online: !!str(r.aply_mthd_onli_rcpt_istc),
        },
        rule_key: "kstartup", status: "open", sort_order: 500, updated_at: stamp,
      });
    }
    if (batch.length < 500) break;
  }
  return out;
}

async function fetchBizinfo(key: string, stamp: string): Promise<Row[]> {
  //   searchCnt=0 이면 전체를 한 번에 준다(2026-08-21 실측 1,558건). 페이지를 돌 필요가 없다.
  const url = `${BIZINFO_URL}?crtfcKey=${encodeURIComponent(key.trim())}&dataType=json&searchCnt=0`;
  const res = await fetch(url);
  const text = await res.text();
  if (!res.ok) throw new Error(`기업마당 ${res.status}: ${text.slice(0, 200)}`);
  let body: { jsonArray?: Row[] };
  try { body = JSON.parse(text); } catch {
    throw new Error(`응답을 읽지 못했습니다: ${text.replace(/<[^>]+>/g, " ").trim().slice(0, 200)}`);
  }

  const out: Row[] = [];
  const seen = new Set<string>();
  for (const r of body.jsonArray ?? []) {
    const id = str(r.pblancId), title = str(r.pblancNm);
    if (!id || !title || seen.has(id)) continue;
    seen.add(id);
    const [start, end] = parseRange(r.reqstBeginEndDe);
    const rawUrl = str(r.pblancUrl);
    out.push({
      source: "bizinfo", external_id: id, title,
      org: str(r.jrsdInsttNm) || str(r.excInsttNm) || null,
      field: str(r.pldirSportRealmLclasCodeNm) || null,
      support_type: str(r.pldirSportRealmMlsfcCodeNm) || null,
      summary: short(stripHtml(r.bsnsSumryCn), 160),
      requirement: short(`${str(r.trgetNm)}${r.reqstMthPapersCn ? ` · 신청방법: ${stripHtml(r.reqstMthPapersCn)}` : ""}`, 400),
      amount_text: null, amount_max: null,
      detail_url: rawUrl ? (rawUrl.startsWith("http") ? rawUrl : `https://www.bizinfo.go.kr${rawUrl}`) : null,
      apply_start: start, apply_end: end,
      eligibility: {
        //   기업마당은 지역 칸이 따로 없다 — 해시태그에 시도명이 섞여 온다
        regions: regionsFrom(r.hashtags),
        max_years: null,
        targets: splitList(r.trgetNm),
        exclude: null,
        dept: str(r.excInsttNm) || null,
        online: /온라인|누리집|홈페이지|http/i.test(str(r.reqstMthPapersCn)),
      },
      rule_key: "bizinfo", status: "open", sort_order: 600, updated_at: stamp,
    });
  }
  return out;
}

const FETCHERS: Record<string, (key: string, stamp: string) => Promise<Row[]>> = {
  kstartup: fetchKstartup,
  bizinfo: fetchBizinfo,
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

  let wantCompany: string | null = null;
  let wantProvider: string | null = null;
  try {
    const b = await req.json();
    wantCompany = b?.companyId ? String(b.companyId) : null;
    wantProvider = b?.provider ? String(b.provider) : null;
  } catch { /* 본문 없이 불러도 된다 */ }

  // ── 쿨타임 — 사람이 연타해도 원천을 두 번 때리지 않는다 ──
  if (!isCron) {
    const since = new Date(Date.now() - COOLDOWN_MIN * 60_000).toISOString();
    const { data: recent } = await db.from("gov_sync_log")
      .select("started_at").eq("ok", true).gte("started_at", since).limit(1);
    if (recent && recent.length > 0) {
      return json(200, { ok: true, skipped: true, message: `최근 ${COOLDOWN_MIN}분 안에 이미 받았습니다.` });
    }
  }

  const stamp = new Date().toISOString();
  const summary: Record<string, unknown>[] = [];

  for (const provider of Object.keys(FETCHERS)) {
    if (wantProvider && provider !== wantProvider) continue;

    let q = db.from("company_api_keys")
      .select("id, company_id, key_encrypted")
      .eq("provider", provider).eq("status", "ok").limit(MAX_COMPANIES);
    if (wantCompany) q = q.eq("company_id", wantCompany);
    const { data: keys } = await q;

    if (!keys || keys.length === 0) {
      summary.push({ provider, skipped: "등록된 인증키가 없습니다" });
      continue;
    }

    const { data: logRow } = await db.from("gov_sync_log").insert({ source: provider }).select("id").single();
    const logId = logRow?.id as string | undefined;

    let fetched = 0, upserted = 0, okCompanies = 0;
    const errors: string[] = [];

    for (const k of keys) {
      try {
        const { data: plain, error: decErr } = await db.rpc("decrypt_credential", { p_ciphertext: k.key_encrypted });
        if (decErr || !plain) throw new Error("저장된 인증키를 읽지 못했습니다");

        const rows = await FETCHERS[provider](String(plain), stamp);
        if (rows.length === 0) throw new Error("받은 공고가 없습니다");
        fetched += rows.length;

        for (let i = 0; i < rows.length; i += 200) {
          const chunk = rows.slice(i, i + 200);
          const { error } = await db.from("gov_programs").upsert(chunk, { onConflict: "source,external_id" });
          if (error) throw new Error(`저장 실패: ${error.message}`);
          upserted += chunk.length;
        }
        okCompanies += 1;
        await db.from("company_api_keys")
          .update({ last_used_at: new Date().toISOString(), status: "ok", last_error: null })
          .eq("id", k.id);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        errors.push(msg);
        //   이 회사 키가 막혔다는 사실을 화면이 알 수 있게 남긴다
        await db.from("company_api_keys")
          .update({ status: "error", last_error: msg, last_tested_at: new Date().toISOString() })
          .eq("id", k.id);
      }
    }

    // ── 이번에 안 온 공고는 마감 처리. 한 곳도 성공 못 했으면 손대지 않는다 ──
    let closed = 0;
    if (okCompanies > 0) {
      const { data: closedRows } = await db.from("gov_programs")
        .update({ status: "closed" })
        .eq("source", provider).eq("status", "open").lt("updated_at", stamp)
        .select("id");
      closed = closedRows?.length ?? 0;
    }

    if (logId) {
      await db.from("gov_sync_log").update({
        finished_at: new Date().toISOString(),
        ok: okCompanies > 0,
        fetched, upserted, closed,
        message: errors.length ? errors.slice(0, 3).join(" / ") : null,
      }).eq("id", logId);
    }
    summary.push({ provider, companies: keys.length, ok: okCompanies, fetched, upserted, closed, errors: errors.slice(0, 3) });
  }

  return json(200, { ok: summary.some((s) => Number(s.ok ?? 0) > 0), summary });
});
