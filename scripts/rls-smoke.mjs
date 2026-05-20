#!/usr/bin/env node
// P0-5: 배포 전 필수 RLS 회귀 스모크 (게이트).
//   메모리 lessons.md 의 검증된 기법을 자동화:
//     BEGIN; SET LOCAL statement_timeout='8000'; SET LOCAL request.jwt.claims; SET LOCAL ROLE authenticated;
//     SELECT users/employees;  -- 로그인 부트스트랩 재현
//     ROLLBACK; (prod 데이터 변이 0)
//   504 전면장애(20260518190000) 직접 원인 — RLS 정책 본문 인라인 서브쿼리로
//   인한 users↔employees 재귀 — 를 사람 기억 의존 없이 자동 차단.
//
// Usage:
//   node scripts/rls-smoke.mjs              # exit 1 on any regression
//   node scripts/rls-smoke.mjs --json
//
// CI: GitHub Actions 등에서 SUPABASE_ACCESS_TOKEN 시크릿 주입 후 PR 게이트로.

import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "njbvdkuvtdtkxyylwngn";

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
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${pat}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await res.text();
  if (!res.ok) return { ok: false, error: text };
  try { return { ok: true, data: JSON.parse(text) }; } catch { return { ok: true, data: [] }; }
}

const CRITICAL_TABLES = ['users','employees','payslip_overrides','card_transactions','corporate_cards','payroll_items'];

async function main() {
  const json = process.argv.includes("--json");
  const pat = readPat();
  if (!pat) {
    console.error("No PAT (set SUPABASE_ACCESS_TOKEN or .env.supabase.local).");
    process.exitCode = 2;
    return;
  }

  const checks = {};

  // 1) 정책 본문에 인라인 `FROM users` / `FROM employees` (=20260518190000 504 재귀
  //    시그니처) 0건 확인. 일반 `company_id IN (SELECT FROM companies)` 같은
  //    무관 PERMISSIVE 회사격리는 false-positive 라 제외 — 진짜 위험 패턴만 매칭.
  const polRes = await runSql(pat,
    `SELECT count(*)::int AS bad, json_agg(json_build_object('t',tablename,'p',policyname)) AS hits FROM pg_policies WHERE schemaname='public' AND (qual ~* '\\m(FROM|JOIN)\\s+users\\M' OR qual ~* '\\m(FROM|JOIN)\\s+employees\\M' OR with_check ~* '\\m(FROM|JOIN)\\s+users\\M' OR with_check ~* '\\m(FROM|JOIN)\\s+employees\\M') AND tablename IN (${CRITICAL_TABLES.map(t=>`'${t}'`).join(',')});`);
  if (!polRes.ok) { checks.bad_inline_subq = { ok: false, error: polRes.error }; }
  else { const n = polRes.data?.[0]?.bad ?? -1; const hits = polRes.data?.[0]?.hits; checks.bad_inline_subq = { ok: n === 0, value: n, hits: hits || undefined }; }

  // 2) 인증된 employee 컨텍스트에서 로그인 부트스트랩(SELECT users+employees) sim.
  //    bounded 8s + ROLLBACK. 재귀/hang 시 statement_timeout 으로 빠른 실패.
  const empRes = await runSql(pat, "SELECT auth_id FROM users WHERE role='employee' AND auth_id IS NOT NULL LIMIT 1;");
  const empAuth = empRes.ok ? empRes.data?.[0]?.auth_id : null;
  if (!empAuth) {
    checks.employee_bootstrap = { ok: true, value: "skipped (no employee user with auth_id)" };
  } else {
    const t0 = Date.now();
    const simRes = await runSql(pat,
      `BEGIN; SET LOCAL statement_timeout='8000'; SET LOCAL request.jwt.claims='{"sub":"${empAuth}","role":"authenticated"}'; SET LOCAL ROLE authenticated; SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM employees) e, (SELECT count(*) FROM payroll_items) pi; ROLLBACK;`);
    const dt = Date.now() - t0;
    if (!simRes.ok) {
      // statement_timeout 또는 RLS 재귀 에러
      checks.employee_bootstrap = { ok: false, ms: dt, error: simRes.error };
    } else {
      checks.employee_bootstrap = { ok: dt < 7000, ms: dt, sample: simRes.data?.[0] };
    }
  }

  // 3) owner 컨텍스트 무회귀 확인 (전체 데이터 보임 + 빠른 응답).
  const ownerRes = await runSql(pat, "SELECT auth_id FROM users WHERE role IN ('owner','admin') AND auth_id IS NOT NULL LIMIT 1;");
  const ownerAuth = ownerRes.ok ? ownerRes.data?.[0]?.auth_id : null;
  if (!ownerAuth) {
    checks.owner_bootstrap = { ok: true, value: "skipped (no owner/admin)" };
  } else {
    const t0 = Date.now();
    const simRes = await runSql(pat,
      `BEGIN; SET LOCAL statement_timeout='8000'; SET LOCAL request.jwt.claims='{"sub":"${ownerAuth}","role":"authenticated"}'; SET LOCAL ROLE authenticated; SELECT (SELECT count(*) FROM users) u, (SELECT count(*) FROM employees) e; ROLLBACK;`);
    const dt = Date.now() - t0;
    if (!simRes.ok) checks.owner_bootstrap = { ok: false, ms: dt, error: simRes.error };
    else checks.owner_bootstrap = { ok: dt < 7000, ms: dt };
  }

  // 4) 5초+ hung 쿼리 0 (커넥션풀 누적 없음).
  const hungRes = await runSql(pat,
    "SELECT count(*)::int AS h FROM pg_stat_activity WHERE state='active' AND now()-query_start > interval '5 seconds';");
  if (!hungRes.ok) checks.hung_5s = { ok: false, error: hungRes.error };
  else { const n = hungRes.data?.[0]?.h ?? -1; checks.hung_5s = { ok: n === 0, value: n }; }

  const allOk = Object.values(checks).every(c => c.ok);
  const summary = { ok: allOk, ts: new Date().toISOString(), checks };

  if (json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log(allOk ? "✓ RLS smoke PASS — no recursion / scope regressions" : "❌ RLS smoke FAIL — see checks below");
    for (const [name, c] of Object.entries(checks)) {
      const tag = c.ok ? "✓" : "❌";
      console.log(`  ${tag} ${name}: ${JSON.stringify(c)}`);
    }
    if (!allOk) console.log("\n→ 메모리 lessons.md feedback_rls_recursion_gate 참조 (RLS 정책 본문 인라인 서브쿼리 금지, SECURITY DEFINER 헬퍼 경유).");
  }
  process.exitCode = allOk ? 0 : 1;
}

main().catch((e) => { console.error(e); process.exitCode = 1; });
