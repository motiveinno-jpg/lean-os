#!/usr/bin/env node
// 구독 해지 정합성 P0 STEP 9 — get_company_entitlement 상태 매트릭스 라이브 검증.
//   각 케이스: BEGIN; (모티브 회사에 최신 합성 subscription 1행 insert); SELECT rpc; ROLLBACK.
//   실데이터 무변경(전부 ROLLBACK). service_role PAT 경유(auth.uid NULL → IDOR 가드 우회 = 서버 경로).
//
// Usage: node scripts/entitlement-matrix.mjs [--json]
// CI 게이트로도 사용 가능(SUPABASE_ACCESS_TOKEN 주입).

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "njbvdkuvtdtkxyylwngn";
const CO = "c361afb9-8a52-4cac-add9-8992f0f7c09c"; // 모티브(합성행 insert 후 rollback 대상)
const PLAN_ULTRA = "a21d404a-dde2-4b30-af53-6eac8fa334c6";
const PLAN_BASIC = "e9209afc-a38d-4c15-ac69-82bba5f310d4";

function readPat() {
  if (process.env.SUPABASE_ACCESS_TOKEN) return process.env.SUPABASE_ACCESS_TOKEN.trim();
  try {
    const raw = readFileSync(resolve(REPO_ROOT, ".env.supabase.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const t = line.trim();
      if (!t || t.startsWith("#")) continue;
      const m = t.match(/^(?:SUPABASE_ACCESS_TOKEN\s*=\s*)?(.+)$/);
      if (m && m[1]) return m[1].trim().replace(/^["']|["']$/g, "");
    }
  } catch { /* fall through */ }
  return null;
}

async function runSql(pat, sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) return { ok: false, error: text };
  try { return { ok: true, data: JSON.parse(text) }; } catch { return { ok: true, data: [] }; }
}

// 합성 subscription 1행을 최신(created_at=now()+1s)으로 insert → RPC 조회 → ROLLBACK.
function caseSql(cols) {
  const {
    plan_id = PLAN_ULTRA, status = "active", cape = false,
    period = "now()+interval '20 days'", trial = "null",
  } = cols;
  return `begin;
insert into public.subscriptions(company_id, plan_id, status, seat_count, cancel_at_period_end, current_period_end, trial_ends_at, created_at)
values('${CO}','${plan_id}','${status}',1,${cape}, ${period}, ${trial}, now()+interval '1 second');
select effective_plan_slug as slug, entitled, cancel_at_period_end as cape, display_status as display
from get_company_entitlement('${CO}');
rollback;`;
}

// [이름, 입력, 기대] — 10개 상태 매트릭스.
const CASES = [
  ["active 정상",            { status: "active", cape: false },                                 { slug: "ultra", entitled: true,  cape: false, display: "active" }],
  ["해지 예약(cancel_at_period_end)", { status: "active", cape: true },                          { slug: "ultra", entitled: true,  cape: true,  display: "cancel_scheduled" }],
  ["해지 예약 복원(cape=false)", { status: "active", cape: false },                              { slug: "ultra", entitled: true,  cape: false, display: "active" }],
  ["기간 만료(유예 초과)",   { status: "active", period: "now()-interval '5 days'" },            { slug: "free",  entitled: false, cape: false, display: "expired" }],
  ["기간 만료 유예 내(1일 초과)", { status: "active", period: "now()-interval '1 day'" },        { slug: "ultra", entitled: true,  cape: false, display: "active" }],
  ["수동 유료(active) 기간 유효", { status: "active", plan_id: PLAN_BASIC },                     { slug: "basic", entitled: true,  cape: false, display: "active" }],
  ["체험 유효",              { status: "trialing", trial: "now()+interval '7 days'", period: "null" }, { slug: "ultra", entitled: true, cape: false, display: "trialing" }],
  ["체험 만료",              { status: "trialing", trial: "now()-interval '1 day'", period: "null" }, { slug: "free", entitled: false, cape: false, display: "trial_expired" }],
  ["past_due 기간 유효",     { status: "past_due" },                                             { slug: "ultra", entitled: true,  cape: false, display: "past_due" }],
  ["해지 완료(canceled)",    { status: "canceled" },                                             { slug: "free",  entitled: false, cape: false, display: "canceled" }],
  ["Ultra AI 유지(해지 예약중)", { status: "active", cape: true },                               { slug: "ultra", entitled: true,  cape: true,  display: "cancel_scheduled" }],
];

async function main() {
  const json = process.argv.includes("--json");
  const pat = readPat();
  if (!pat) { console.error("No PAT (SUPABASE_ACCESS_TOKEN or .env.supabase.local)."); process.exitCode = 2; return; }

  const results = [];
  for (const [name, input, expected] of CASES) {
    const r = await runSql(pat, caseSql(input));
    if (!r.ok) { results.push({ name, ok: false, error: r.error }); continue; }
    const got = r.data?.[0] || {};
    const ok = ["slug", "entitled", "cape", "display"].every((k) => got[k] === expected[k]);
    results.push({ name, ok, expected, got });
  }

  const allOk = results.every((r) => r.ok);
  if (json) {
    console.log(JSON.stringify({ ok: allOk, results }, null, 2));
  } else {
    console.log(allOk ? "✓ entitlement matrix PASS — 11/11 상태 정합" : "❌ entitlement matrix FAIL");
    for (const r of results) {
      const tag = r.ok ? "✓" : "❌";
      const detail = r.ok ? "" : ` expected=${JSON.stringify(r.expected)} got=${JSON.stringify(r.got || r.error)}`;
      console.log(`  ${tag} ${r.name}${detail}`);
    }
  }
  process.exitCode = allOk ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
