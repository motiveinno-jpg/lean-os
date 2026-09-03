// 프로젝트 v3 — 설문 발송 (2026-09-01 사장님 승인 기획)
//   외부인(로그인 없음)이 /survey/{token} 에서 GET(설문 내용)·POST(응답 제출)만 할 수 있다.
//   anon 은 project_surveys 를 직접 못 읽는다(RLS) — 이 함수(service role)가 토큰을 검증해
//   필요한 것만 내주고, 제출은 질문 화이트리스트·타입 검증을 거쳐 project_items 한 줄로 넣는다.
//   verify_jwt=false 로 배포(외부 공개). 이미지(project-files, private)는 24시간 서명 URL 로.

import { createClient } from "npm:@supabase/supabase-js@2";
import { withSentry } from "../_shared/sentry.ts";

const admin = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
};
// deno-lint-ignore no-explicit-any
const json = (o: any, s = 200) =>
  new Response(JSON.stringify(o), { status: s, headers: { ...cors, "Content-Type": "application/json" } });

//   외부인이 답할 수 있는 타입만 — 담당·거래처·수식·자동·첨부·연결은 설문에 나가지 않는다
const ANSWERABLE = ["text", "longtext", "number", "date", "select", "check", "rating", "url", "tel", "place"];

//   설문 2차(2026-09-01) — 받는 조건 3종. 응답자가 한국이라 마감일은 KST 날짜로 비교한다.
const kstToday = () => new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
// deno-lint-ignore no-explicit-any
const closedReason = (sv: any): string | null => {
  if (!sv || !sv.enabled) return "off";
  if (sv.closes_at && kstToday() > sv.closes_at) return "date";
  if (sv.max_responses != null && (sv.response_count || 0) >= sv.max_responses) return "full";
  return null;
};
//   1인 1회 — 같은 IP 의 재제출을 막는다(로그인이 없어 완벽 식별은 불가, 화면에 한계 명시).
//   원본 IP 는 저장하지 않는다 — token 과 섞은 해시만 응답 줄 fields.__from 에 남긴다.
const fromHash = async (token: string, req: Request): Promise<string> => {
  const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "0";
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${token}|${ip}`));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
};

Deno.serve(withSentry("project-survey", async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  try {
    const url = new URL(req.url);
    if (req.method === "GET") {
      const token = url.searchParams.get("token") || "";
      if (!token) return json({ error: "no_token" }, 400);
      const { data: sv } = await admin.from("project_surveys").select("*").eq("token", token).maybeSingle();
      const reason = closedReason(sv);
      if (reason) return json({ error: "closed", reason }, 404);
      const { data: colsRaw } = await admin.from("project_item_columns")
        .select("key, name, type, settings").eq("deal_id", sv.deal_id).is("archived_at", null);
      // deno-lint-ignore no-explicit-any
      const questions = ((sv.questions || []) as { key: string; required?: boolean }[]).map((q) => {
        const c = (colsRaw || []).find((x) => x.key === q.key);
        if (!c || !ANSWERABLE.includes(c.type)) return null;
        return { key: c.key, name: c.name, type: c.type, options: c.settings?.options || [], required: !!q.required };
      }).filter(Boolean);
      const sign = async (p: string | null) => {
        if (!p) return null;
        const { data } = await admin.storage.from("project-files").createSignedUrl(p, 86400);
        return data?.signedUrl || null;
      };
      const banner = await sign(sv.banner_path);
      const images: string[] = [];
      for (const p of (sv.image_paths || []) as string[]) {
        const u = await sign(p);
        if (u) images.push(u);
      }
      return json({
        title: sv.title, intro: sv.intro, name_label: sv.name_label || "성함", banner, images, questions,
        closes_at: sv.closes_at || null,
        remaining: sv.max_responses != null ? Math.max(0, sv.max_responses - (sv.response_count || 0)) : null,
        prevent_dup: !!sv.prevent_dup,
      });
    }
    if (req.method === "POST") {
      const body = await req.json();
      const token = String(body.token || "");
      const { data: sv } = await admin.from("project_surveys").select("*").eq("token", token).maybeSingle();
      const reason = closedReason(sv);
      if (reason) return json({ error: "closed", reason }, 404);
      //   1인 1회 — 같은 해시의 응답 줄이 이미 있으면 거절(보관된 줄도 응답한 것)
      let from: string | null = null;
      if (sv.prevent_dup) {
        from = await fromHash(token, req);
        const { data: dup } = await admin.from("project_items").select("id")
          .eq("deal_id", sv.deal_id).eq("fields->>__from", from).limit(1);
        if ((dup || []).length > 0) return json({ error: "dup" }, 409);
      }
      //   도배 방지(단순) — 이 프로젝트에 최근 60초 동안 30줄 넘게 들어오면 잠시 막는다
      const { count } = await admin.from("project_items").select("id", { count: "exact", head: true })
        .eq("deal_id", sv.deal_id).gte("created_at", new Date(Date.now() - 60_000).toISOString());
      if ((count || 0) > 30) return json({ error: "busy" }, 429);
      const name = String(body.name || "").trim().slice(0, 120);
      if (!name) return json({ error: "required", key: "__name" }, 400);
      const { data: colsRaw } = await admin.from("project_item_columns")
        .select("key, name, type, settings").eq("deal_id", sv.deal_id).is("archived_at", null);
      const fields: Record<string, unknown> = {};
      for (const q of (sv.questions || []) as { key: string; required?: boolean }[]) {
        const c = (colsRaw || []).find((x) => x.key === q.key);
        if (!c || !ANSWERABLE.includes(c.type)) continue;
        const raw = body.answers?.[q.key];
        const empty = raw == null || String(raw).trim() === "" || (c.type === "check" && raw !== true && raw !== "true");
        if (empty) {
          if (q.required) return json({ error: "required", key: q.key }, 400);
          continue;
        }
        if (c.type === "number") {
          const n = Number(raw);
          if (!Number.isFinite(n)) return json({ error: "invalid", key: q.key }, 400);
          fields[c.key] = n;
        } else if (c.type === "rating") {
          const n = Math.round(Number(raw));
          if (!(n >= 1 && n <= 5)) return json({ error: "invalid", key: q.key }, 400);
          fields[c.key] = n;
        } else if (c.type === "check") {
          fields[c.key] = true;
        } else if (c.type === "select") {
          // deno-lint-ignore no-explicit-any
          const ok = ((c.settings?.options || []) as any[]).some((o) => o.id === raw);
          if (!ok) return json({ error: "invalid", key: q.key }, 400);
          fields[c.key] = raw;
        } else if (c.type === "date") {
          if (!/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return json({ error: "invalid", key: q.key }, 400);
          fields[c.key] = raw;
        } else {
          fields[c.key] = String(raw).slice(0, 2000);
        }
      }
      const { data: last } = await admin.from("project_items").select("position")
        .eq("deal_id", sv.deal_id).eq("status", sv.target_stage)
        .order("position", { ascending: false }).limit(1);
      if (from) fields["__from"] = from; // 컬럼 정의가 없는 예약 키라 표에는 안 보인다(__quote 와 같은 문법)
      fields["__sv"] = true; // 설문으로 들어온 줄 표식 — '응답만 내려받기'가 이걸 본다(같은 예약 키 문법)
      const { error: ie } = await admin.from("project_items").insert({
        company_id: sv.company_id, deal_id: sv.deal_id, kind: "todo",
        name, status: sv.target_stage, fields, position: (last?.[0]?.position ?? 0) + 1,
      });
      if (ie) return json({ error: "save_failed" }, 500);
      await admin.from("project_surveys").update({
        response_count: (sv.response_count || 0) + 1, updated_at: new Date().toISOString(),
      }).eq("id", sv.id);
      if (sv.created_by) {
        const { data: deal } = await admin.from("deals").select("name").eq("id", sv.deal_id).maybeSingle();
        await admin.from("notifications").insert({
          company_id: sv.company_id, user_id: sv.created_by, type: "deal_update",
          title: "설문 새 응답", message: `${deal?.name || "프로젝트"} — '${name}' 응답이 표에 들어왔습니다`,
          entity_type: "deal", entity_id: sv.deal_id,
        });
      }
      return json({ ok: true });
    }
    return json({ error: "method" }, 405);
  } catch {
    return json({ error: "server" }, 500);
  }
}));
