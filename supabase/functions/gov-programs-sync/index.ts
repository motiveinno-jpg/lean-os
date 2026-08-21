// supabase/functions/gov-programs-sync/index.ts
//
// 지원사업 공고 수집 — K-Startup(창업진흥원) 공공데이터포털 API (2026-08-21 사장님 인증키 제공)
//
// 기획: docs/20260821_PLAN_support_programs.md (Phase 1.5 — B계통 창업형)
//
// 왜 이 모양인가
//   · **진행 중 공고만 받는다** — `cond[rcrt_prgs_yn::EQ]=Y`. 전체는 29,844건(지난 공고 포함)인데
//     지금 신청할 수 있는 건 280건뿐이다. 나머지를 받아 봐야 목록만 무겁게 한다.
//   · perPage 는 500 까지 받아 준다 → 보통 한 번 호출로 끝난다(안전하게 페이지 루프는 남긴다).
//   · **AI 를 쓰지 않는다.** K-Startup 응답이 이미 구조화돼 있다 —
//     업력(biz_enyy) · 지원지역(supt_regin) · 신청대상(aply_trgt) · 분야(supt_biz_clsfc).
//     eligibility(jsonb)에 담아 두면 회사별 판정은 앱 쪽 규칙이 코드로 한다.
//     (공고 본문을 AI 로 읽는 건 Phase 2 — 지금은 필요 없다.)
//   · 사라진 공고는 지우지 않고 **status='closed'** 로 내린다. 담아둔 회사가 있을 수 있고,
//     지웠다가 다음날 되살아나면 담기가 끊긴다.
//
// ⚠️ 인증키는 **DATA_GO_KR_KSTARTUP_KEY** 다 — 기존 `DATA_GO_KR_API_KEY`(사업자등록 상태조회용)와
//   **다른 계정 키라 섞으면 안 된다.** 실제로 기존 키로 부르면 30 SERVICE_KEY_IS_NOT_REGISTERED_ERROR 다.
//   기존 키를 덮어쓰면 가입 시 사업자번호 확인이 깨진다. 없을 때만 기존 키로 넘어간다(둘을 한 계정으로
//   합치는 날을 위해).
//
// 누가 부를 수 있나
//   공개 카탈로그를 갱신하는 읽기성 작업이라 로그인 사용자면 부를 수 있게 두되,
//   **마지막 성공으로부터 30분 쿨타임**을 둬 연타를 막는다(x-cron-secret 가 맞으면 쿨타임 무시).
//
// ※ 다른 엣지 함수와 달리 withSentry 를 쓰지 않는다 — `../_shared/` 를 함께 올려야 해서
//   배포 단위가 커진다. 실패는 gov_sync_log 에 사유가 그대로 남으므로 원인 추적은 된다.

import { serve } from "https://deno.land/std@0.177.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const KSTARTUP_URL = "https://apis.data.go.kr/B552735/kisedKstartupService01/getAnnouncementInformation01";
const PER_PAGE = 500;
const MAX_PAGES = 6;             // 500 × 6 = 3,000건. 진행 중 공고가 이보다 많을 일은 없다.
const COOLDOWN_MIN = 30;

type KsRow = Record<string, string | null>;

/**
 * 인증키를 URL 에 넣을 꼴로 만든다.
 *   공공데이터포털은 같은 키를 **Encoding/Decoding 두 가지**로 준다. 사람이 어느 쪽을 붙여넣을지
 *   알 수 없어서 여기서 가른다 — 이미 인코딩된 값(%2F·%3D 포함)을 또 인코딩하면 %252F 가 되어
 *   "등록되지 않은 서비스키" 로 튕긴다. 이 한 줄이 없으면 원인을 엉뚱한 데서 찾게 된다.
 */
function serviceKeyParam(raw: string): string {
  return /%[0-9A-Fa-f]{2}/.test(raw) ? raw.trim() : encodeURIComponent(raw.trim());
}

/** YYYYMMDD → YYYY-MM-DD (빈 값·형식 불일치는 null) */
function toDate(v: string | null | undefined): string | null {
  const s = String(v ?? "").replace(/[^0-9]/g, "");
  if (s.length !== 8) return null;
  const y = s.slice(0, 4), m = s.slice(4, 6), d = s.slice(6, 8);
  if (Number(m) < 1 || Number(m) > 12 || Number(d) < 1 || Number(d) > 31) return null;
  return `${y}-${m}-${d}`;
}

/** "1년미만,2년미만,7년미만" → 최대 업력 연수(7). 값이 없으면 null = 업력 제한 없음 */
function maxYears(bizEnyy: string | null | undefined): number | null {
  const nums = String(bizEnyy ?? "").match(/(\d+)년미만/g);
  if (!nums || nums.length === 0) return null;
  return Math.max(...nums.map((t) => Number(t.replace(/[^0-9]/g, ""))));
}

/** "전국" 이면 지역 제한 없음(빈 배열), 아니면 시도 목록 */
function regions(suptRegin: string | null | undefined): string[] {
  const raw = String(suptRegin ?? "").trim();
  if (!raw || raw.includes("전국")) return [];
  return raw.split(/[,·]/).map((s) => s.trim()).filter(Boolean);
}

function splitList(v: string | null | undefined): string[] {
  return String(v ?? "").split(/[,·]/).map((s) => s.trim()).filter(Boolean);
}

/** 너무 긴 본문은 목록에서 못 읽는다 — 요약은 앞부분만 */
function short(v: string | null | undefined, n: number): string | null {
  const s = String(v ?? "").replace(/\s+/g, " ").trim();
  if (!s) return null;
  return s.length <= n ? s : `${s.slice(0, n)}…`;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  const db = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
  );

  const apiKey = Deno.env.get("DATA_GO_KR_KSTARTUP_KEY") || Deno.env.get("DATA_GO_KR_API_KEY") || "";
  if (!apiKey) {
    return json(500, { ok: false, message: "DATA_GO_KR_KSTARTUP_KEY 환경변수가 설정되지 않았습니다." });
  }

  const cronSecret = Deno.env.get("CRON_SECRET") ?? "";
  const isCron = !!cronSecret && req.headers.get("x-cron-secret") === cronSecret;

  // ── 쿨타임 — 마지막 성공이 30분 안이면 그냥 돌려보낸다 ──
  if (!isCron) {
    const since = new Date(Date.now() - COOLDOWN_MIN * 60_000).toISOString();
    const { data: recent } = await db
      .from("gov_sync_log")
      .select("started_at")
      .eq("source", "kstartup").eq("ok", true)
      .gte("started_at", since)
      .limit(1);
    if (recent && recent.length > 0) {
      return json(200, { ok: true, skipped: true, message: `최근 ${COOLDOWN_MIN}분 안에 이미 받았습니다.` });
    }
  }

  const { data: logRow } = await db
    .from("gov_sync_log").insert({ source: "kstartup" }).select("id").single();
  const logId = logRow?.id as string | undefined;

  const finish = async (ok: boolean, extra: Record<string, unknown>) => {
    if (logId) {
      await db.from("gov_sync_log")
        .update({ finished_at: new Date().toISOString(), ok, ...extra })
        .eq("id", logId);
    }
  };

  //   이번 수집을 가리키는 시각 — upsert 로 갱신된 행은 이 값을 갖고, 안 온 행은 이보다 옛날이다
  const stamp = new Date().toISOString();

  try {
    // ── 1. 진행 중 공고 받기 ──
    const rows: KsRow[] = [];
    for (let page = 1; page <= MAX_PAGES; page += 1) {
      const url =
        `${KSTARTUP_URL}?serviceKey=${serviceKeyParam(apiKey)}` +
        `&page=${page}&perPage=${PER_PAGE}&returnType=json` +
        `&${encodeURIComponent("cond[rcrt_prgs_yn::EQ]")}=Y`;

      const res = await fetch(url);
      const text = await res.text();
      if (!res.ok) throw new Error(`K-Startup ${res.status}: ${text.slice(0, 300)}`);

      let body: { data?: KsRow[] };
      try {
        body = JSON.parse(text);
      } catch {
        //   인증키가 안 맞으면 XML 오류가 온다 — 그대로 보여 줘야 원인을 안다
        throw new Error(`응답을 읽지 못했습니다: ${text.slice(0, 300)}`);
      }
      const batch = body.data ?? [];
      rows.push(...batch);
      if (batch.length < PER_PAGE) break;
    }

    // ── 2. 우리 표 모양으로 옮기기 ──
    const seen = new Set<string>();
    const mapped = rows
      .map((r) => {
        const id = String(r.pbanc_sn ?? "").trim();
        const title = String(r.biz_pbanc_nm ?? "").trim();
        if (!id || !title) return null;
        if (seen.has(id)) return null;      // 같은 공고가 두 번 오는 경우 방지
        seen.add(id);

        return {
          source: "kstartup",
          external_id: id,
          title,
          org: String(r.pbanc_ntrp_nm ?? r.sprv_inst ?? "").trim() || null,
          field: String(r.supt_biz_clsfc ?? "").trim() || null,
          support_type: "창업지원",
          summary: short(r.pbanc_ctnt, 160),
          requirement: short(r.aply_trgt_ctnt ?? r.aply_trgt, 400),
          amount_text: null,          // K-Startup 응답에는 지원 금액 칸이 없다 — 공고문에만 있다
          amount_max: null,
          detail_url: String(r.detl_pg_url ?? r.biz_gdnc_url ?? "").trim() || null,
          apply_start: toDate(r.pbanc_rcpt_bgng_dt),
          apply_end: toDate(r.pbanc_rcpt_end_dt),
          eligibility: {
            regions: regions(r.supt_regin),
            max_years: maxYears(r.biz_enyy),
            targets: splitList(r.aply_trgt),
            exclude: short(r.aply_excl_trgt_ctnt, 300),
            dept: String(r.biz_prch_dprt_nm ?? "").trim() || null,
            //   온라인 접수 가능 여부 — 방문·우편만 되는 사업은 준비 부담이 달라 적합도에 반영한다
            online: !!String(r.aply_mthd_onli_rcpt_istc ?? "").trim(),
          },
          rule_key: "kstartup",
          status: "open",
          sort_order: 500,            // 상시 제도(10~100) 아래. 실제 순서는 화면에서 마감·판정으로 정한다
          updated_at: stamp,
        };
      })
      .filter(Boolean) as Record<string, unknown>[];

    if (mapped.length === 0) throw new Error("받은 공고가 없습니다 — 인증키나 필터를 확인하세요.");

    // ── 3. 넣기 (있으면 갱신) ──
    let upserted = 0;
    for (let i = 0; i < mapped.length; i += 200) {
      const chunk = mapped.slice(i, i + 200);
      const { error } = await db.from("gov_programs")
        .upsert(chunk, { onConflict: "source,external_id" });
      if (error) throw new Error(`저장 실패: ${error.message}`);
      upserted += chunk.length;
    }

    // ── 4. 이번에 안 온 건 마감 처리 (지우지 않는다 — 담아둔 회사가 있다) ──
    //   ★ id 목록을 not-in 으로 넘기지 않는다 — 280개면 URL 이 3KB 가 되어 언제 잘릴지 모른다.
    //     대신 이번 수집 시각(stamp)을 표식으로 쓴다: 방금 갱신되지 않은 = 이번에 안 온 공고.
    const { data: closedRows, error: closeErr } = await db
      .from("gov_programs")
      .update({ status: "closed" })
      .eq("source", "kstartup").eq("status", "open")
      .lt("updated_at", stamp)
      .select("id");
    if (closeErr) throw new Error(`마감 처리 실패: ${closeErr.message}`);

    const result = { fetched: rows.length, upserted, closed: closedRows?.length ?? 0 };
    await finish(true, { ...result, message: null });
    return json(200, { ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await finish(false, { message });
    return json(500, { ok: false, message });
  }
});
