#!/usr/bin/env node
// 회사 전체를 훑는 목록 조회가 페이징 없이 쓰였는지 검사한다.
//   PostgREST 는 1,000행에서 조용히 자르므로(에러 없음) 넓은 기간·회사 전체 조회는 fetchPaged 류로 감싸야 한다.
//   2026-08-28 에 50곳을 고쳤는데 2026-09-04 마스터 로더에서 2곳이 또 나와 CI 에서 잡기로 했다.
//
//   판정(휴리스틱): 한 문장(supabase.from(...) 로 시작해 `;` 로 끝나는 체인) 안에
//     · `.select(` 가 있고
//     · 회사 범위 필터 `.eq('company_id'` 가 있으며
//     · 아래 중 아무것도 없으면 위반: .single( .maybeSingle( head: true .limit( .range( .insert( .update( .delete( .upsert(
//       또는 문장이 fetchPaged / fetchPagedRes / fetchAllPages / fetchAllPaginated / chunkedIn 안에 있음
//   기준선(scripts/unpaged-baseline.json): 파일별 기존 위반 수. 늘어나면 실패, 줄면 기준선을 내려 달라고 안내.
//
// Usage: node scripts/check-unpaged-queries.mjs            # 검사 (CI)
//        node scripts/check-unpaged-queries.mjs --update   # 기준선 갱신
//        node scripts/check-unpaged-queries.mjs --list     # 위반 위치 전부 출력
import { readdirSync, readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve, dirname, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = resolve(ROOT, "src");
const BASELINE = resolve(ROOT, "scripts/unpaged-baseline.json");
const update = process.argv.includes("--update");
const list = process.argv.includes("--list");

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = resolve(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) { if (name !== "node_modules" && name !== "__tests__") walk(p, out); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const PAGED = /fetchPaged|fetchPagedRes|fetchAllPages|fetchAllPaginated|chunkedIn/;
// 회사당 행이 수십~수백에 그치는 기준 정보 테이블 — 1,000행 절단 대상이 아니라 검사에서 뺀다
const SMALL_TABLES = new Set([
  "users", "employees", "departments", "chart_of_accounts", "bank_accounts", "corporate_cards", "holidays",
  "card_account_mappings", "billing_seat_coupons", "approval_policies", "approval_forms", "permission_templates",
  "growth_targets", "recurring_payments", "feature_rollout", "companies", "company_settings", "member_permissions",
  "warehouses", "tax_advisors", "subscriptions", "subscription_plans", "notification_prefs", "user_preferences",
  "chat_channels", "chat_participants", "chat_members", "closing_checklists", "leave_balances", "leave_policies",
  "work_schedules", "cost_centers", "project_stages", "deal_stages", "kpi_targets", "saved_filters",
]);
//   .in(id목록)·id.in.(…) 은 넘긴 id 개수만큼만 돌아오므로 회사 전체 조회가 아니다 (200개 넘는 id 는 chunkedIn 규칙)
const SAFE = /\.single\(|\.maybeSingle\(|head:\s*true|\.limit\(|\.range\(|\.insert\(|\.update\(|\.delete\(|\.upsert\(|\.in\(|\bid\.in\.\(/;

function scan(file) {
  const src = readFileSync(file, "utf8");
  const hits = [];
  const re = /\.from\(\s*['"`]([a-z_0-9]+)['"`]\s*\)/g;
  let m;
  while ((m = re.exec(src))) {
    // 문장 범위: 앞으로 줄 시작(또는 `await`/`=`)까지, 뒤로 첫 `;` 또는 빈 줄까지 — 체인이 여러 줄이어도 잡힌다
    const start = Math.max(src.lastIndexOf("\n", m.index) - 400, 0);
    let end = src.indexOf(";", m.index);
    if (end === -1) end = src.length;
    const blank = src.indexOf("\n\n", m.index);
    if (blank !== -1 && blank < end) end = blank;
    const stmt = src.slice(m.index, end);
    const before = src.slice(start, m.index);
    if (SMALL_TABLES.has(m[1])) continue;
    if (!/\.select\(/.test(stmt)) continue;
    if (!/\.eq\(\s*['"]company_id['"]/.test(stmt)) continue;
    if (SAFE.test(stmt)) continue;
    if (PAGED.test(before.slice(-400)) || PAGED.test(stmt)) continue;
    const line = src.slice(0, m.index).split("\n").length;
    hits.push({ line, table: m[1] });
  }
  return hits;
}

const counts = {};
const detail = {};
for (const f of walk(SRC)) {
  const hits = scan(f);
  if (hits.length) { const rel = relative(ROOT, f); counts[rel] = hits.length; detail[rel] = hits; }
}
const total = Object.values(counts).reduce((s, n) => s + n, 0);

if (list) {
  for (const [f, hs] of Object.entries(detail)) for (const h of hs) console.log(`${f}:${h.line}  ${h.table}`);
}
if (update) {
  writeFileSync(BASELINE, JSON.stringify(counts, null, 2) + "\n");
  console.log(`기준선 갱신: ${Object.keys(counts).length}개 파일 · ${total}곳`);
  process.exit(0);
}

let baseline = {};
try { baseline = JSON.parse(readFileSync(BASELINE, "utf8")); } catch { /* 기준선 없음 = 전부 신규 */ }
let bad = 0;
for (const [f, n] of Object.entries(counts)) {
  const b = baseline[f] || 0;
  if (n > b) {
    bad++;
    console.error(`❌ ${f}: 페이징 없는 회사 전체 조회 ${n}곳 (기준 ${b})`);
    for (const h of detail[f]) console.error(`     :${h.line}  from('${h.table}')`);
  }
}
let lowered = 0;
for (const [f, b] of Object.entries(baseline)) if ((counts[f] || 0) < b) lowered++;
if (bad) {
  console.error(`\n회사 전체를 훑는 select 는 fetchPaged/fetchPagedRes 로 감싸고 .order() 를 붙이세요 (src/lib/fetch-paged.ts).`);
  console.error(`의도한 소량 조회면 .limit(n) 을 명시하세요. 검토 후 그대로 두려면: node scripts/check-unpaged-queries.mjs --update`);
  process.exit(1);
}
console.log(`✓ 페이징 없는 회사 전체 조회: 신규 0곳 (기존 ${total}곳 기준선 유지${lowered ? ` · ${lowered}개 파일은 줄었으니 --update 로 기준선을 내리세요` : ""})`);
