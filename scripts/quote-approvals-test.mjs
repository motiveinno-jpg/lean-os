#!/usr/bin/env node
/**
 * STEP 1 단위테스트 (worktree-only, prod 변이 0).
 *
 * 전략: Supabase Management API `database/query` 로 마이그 SQL + 시나리오 SQL 을
 *       하나의 트랜잭션(BEGIN … ROLLBACK) 으로 묶어 1회 POST. 라이브 DB 에 적용은
 *       되지 않고(롤백), 단지 RPC 동작·RLS 정책·deals.stage 전환 로직만 검증.
 *
 * 6 케이스:
 *   1) 만료 — submit_quote_decision → {ok:false, code:'expired'}
 *   2) 중복결정 — 이미 approved 행에 submit → {ok:false, code:'already_decided'}
 *   3) 유효 approved — estimate → contract, deals.stage 전환 확인
 *   4) 유효 rejected — deals.stage 변경 없음, decision_note 저장
 *   5) RLS — anon SELECT 0행, employee 사칭 created_by INSERT 거부
 *   6) anon RPC — get_quote_approval_by_token 정상, FROM 직접 SELECT 차단
 */

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
  try { return { ok: true, data: JSON.parse(text) }; } catch { return { ok: true, data: text }; }
}

const MIGRATION_PATH = resolve(REPO_ROOT, "supabase/migrations/20260520160000_quote_approvals.sql");

function loadMigration() {
  return readFileSync(MIGRATION_PATH, "utf8");
}

async function pickFixtures(pat) {
  // 회사 1개 + 동일 회사 deal 1개 + 동일 회사 admin user 1개 + 다른 회사 employee 1개
  // SECURITY DEFINER 헬퍼는 auth.uid() 기준이라 jwt.claims 의 sub 가 곧 users.auth_id 가 되어야 함.
  const sql = `
    SELECT
      (SELECT json_build_object('user_id', u.id, 'auth_id', u.auth_id, 'company_id', u.company_id)
         FROM users u WHERE u.role IN ('owner','admin') AND u.auth_id IS NOT NULL
         AND EXISTS (SELECT 1 FROM deals d WHERE d.company_id = u.company_id)
         LIMIT 1) AS admin,
      (SELECT json_build_object('user_id', u.id, 'auth_id', u.auth_id, 'company_id', u.company_id)
         FROM users u WHERE u.role NOT IN ('owner','admin') AND u.auth_id IS NOT NULL
         LIMIT 1) AS other,
      (SELECT json_build_object('deal_id', d.id, 'stage', d.stage, 'company_id', d.company_id)
         FROM deals d
         JOIN users u ON u.company_id = d.company_id
         WHERE u.role IN ('owner','admin') AND u.auth_id IS NOT NULL
         LIMIT 1) AS deal
  `;
  const r = await runSql(pat, sql);
  if (!r.ok) throw new Error("fixture query failed: " + r.error);
  return r.data?.[0] ?? {};
}

function fmtCase(name, ok, expected, actual, extra) {
  return { name, ok, expected, actual, ...(extra || {}) };
}

async function main() {
  const pat = readPat();
  if (!pat) {
    console.error("No PAT. Set SUPABASE_ACCESS_TOKEN or .env.supabase.local");
    process.exit(2);
  }

  // 1) 신규 마이그가 prod 에 안 들어가 있어야 함 — 사전 확인 (테이블 미존재 == 정상)
  const preExists = await runSql(pat,
    "SELECT to_regclass('public.quote_approvals') AS tbl");
  if (!preExists.ok) { console.error("preflight failed:", preExists.error); process.exit(1); }
  const preTbl = preExists.data?.[0]?.tbl;
  console.log(`[preflight] quote_approvals in prod (pre): ${preTbl === null ? "absent (OK)" : preTbl}`);

  // 2) 적용된 마이그 ledger 미등록 확인
  const ledger = await runSql(pat,
    "SELECT count(*)::int AS c FROM applied_migrations WHERE name LIKE '%quote_approvals%'");
  const ledgerN = ledger.ok ? ledger.data?.[0]?.c : "n/a";
  console.log(`[preflight] applied_migrations ledger rows: ${ledgerN}`);

  // 3) 픽스처
  const fix = await pickFixtures(pat);
  if (!fix.admin || !fix.deal) {
    console.error("no admin user / deal fixture available for tests:", fix);
    process.exit(1);
  }
  console.log(`[fixtures] admin=${fix.admin.user_id} deal=${fix.deal.deal_id} stage=${fix.deal.stage} company=${fix.admin.company_id}`);

  // ── 단일 트랜잭션으로 마이그 + 6 케이스 + ROLLBACK ──
  // (admin auth_id 로 SET LOCAL request.jwt.claims; SECURITY DEFINER 헬퍼가 users 조회)
  const migrationSql = loadMigration();

  // 임의 토큰 — 테스트 내에서 직접 INSERT 하므로 generate_approval_token 없이 사용 가능
  const tokens = {
    expired: 'T_EXPIRED_'  + 'A'.repeat(40),
    already: 'T_DECIDED_'  + 'B'.repeat(40),
    approve: 'T_APPROVE_'  + 'C'.repeat(40),
    reject:  'T_REJECT_'   + 'D'.repeat(40),
    rls:     'T_RLS_'      + 'E'.repeat(40),
  };

  const adminAuth = fix.admin.auth_id;
  const adminUid  = fix.admin.user_id;
  const dealId    = fix.deal.deal_id;
  const companyId = fix.admin.company_id;
  const otherUid  = fix.other?.user_id;  // 다른 사용자 id (사칭 시도)

  // dealId & adminUid 모두 동일 company 라는 fixture 보장.

  const txSql = `
BEGIN;
SET LOCAL statement_timeout='30000';

-- 결과 수집 TEMP 테이블 (마지막에 한 번 SELECT 로 회수)
CREATE TEMP TABLE _results(case_name text, result jsonb);
GRANT INSERT, SELECT ON _results TO authenticated, anon;

-- 1. 마이그 적용 (트랜잭션 내, 외부에서 보이지 않음)
${migrationSql}

-- ── 시나리오 시드 (admin 컨텍스트로 INSERT — RESTRICTIVE created_by=adminUid OK) ──

-- deal stage 초기 상태 캡처 (롤백 후에도 비교용)
CREATE TEMP TABLE _stage_pre AS SELECT id, stage FROM deals WHERE id='${dealId}';

-- 만료된 estimate 행
INSERT INTO quote_approvals(company_id, deal_id, stage, approval_token, status, expires_at, created_by)
VALUES ('${companyId}', '${dealId}', 'estimate', '${tokens.expired}', 'sent', now() - interval '1 day', '${adminUid}');

-- 이미 approved 인 행
INSERT INTO quote_approvals(company_id, deal_id, stage, approval_token, status, decided_at, created_by)
VALUES ('${companyId}', '${dealId}', 'estimate', '${tokens.already}', 'approved', now(), '${adminUid}');

-- 유효 estimate 행 (approve 대상)
INSERT INTO quote_approvals(company_id, deal_id, stage, approval_token, status, created_by)
VALUES ('${companyId}', '${dealId}', 'estimate', '${tokens.approve}', 'sent', '${adminUid}');

-- 유효 estimate 행 (reject 대상)
INSERT INTO quote_approvals(company_id, deal_id, stage, approval_token, status, created_by)
VALUES ('${companyId}', '${dealId}', 'estimate', '${tokens.reject}', 'sent', '${adminUid}');

-- RLS 테스트용 행
INSERT INTO quote_approvals(company_id, deal_id, stage, approval_token, status, created_by)
VALUES ('${companyId}', '${dealId}', 'estimate', '${tokens.rls}', 'sent', '${adminUid}');

-- ── 케이스 1: 만료 ──
INSERT INTO _results SELECT 'case1_expired', submit_quote_decision('${tokens.expired}', 'approved', null);

-- ── 케이스 2: 이미 결정됨 ──
INSERT INTO _results SELECT 'case2_already', submit_quote_decision('${tokens.already}', 'approved', null);

-- ── 케이스 3: 유효 approved → deals.stage='contract' ──
INSERT INTO _results SELECT 'case3_approve', submit_quote_decision('${tokens.approve}', 'approved', '승인합니다');
INSERT INTO _results SELECT 'case3_deal_after', jsonb_build_object('stage', stage) FROM deals WHERE id='${dealId}';

-- 케이스 3 검증 후 deal stage 를 되돌려 (case 4 가 동일 deal 사용)
UPDATE deals SET stage = (SELECT stage FROM _stage_pre WHERE id='${dealId}') WHERE id='${dealId}';

-- ── 케이스 4: 유효 rejected — deals.stage 변경 없음, decision_note 저장 ──
INSERT INTO _results SELECT 'case4_reject', submit_quote_decision('${tokens.reject}', 'rejected', '거절합니다');
INSERT INTO _results SELECT 'case4_deal_stage',
       jsonb_build_object(
         'stage', d.stage,
         'unchanged', (d.stage = (SELECT stage FROM _stage_pre WHERE id='${dealId}'))
       )
  FROM deals d WHERE d.id='${dealId}';
INSERT INTO _results SELECT 'case4_note',
       jsonb_build_object('status', status, 'note', decision_note)
  FROM quote_approvals WHERE approval_token='${tokens.reject}';

-- ── 케이스 5: RLS — admin/owner 컨텍스트 검증 ──
SET LOCAL request.jwt.claims = '{"sub":"${adminAuth}","role":"authenticated"}';
SET LOCAL ROLE authenticated;
INSERT INTO _results SELECT 'case5a_admin_select',
       jsonb_build_object('row_count', count(*))
  FROM quote_approvals;

-- 5b) admin 으로 본인 created_by INSERT — RESTRICTIVE OK
INSERT INTO quote_approvals(company_id, deal_id, stage, approval_token, status, created_by)
VALUES ('${companyId}', '${dealId}', 'estimate', 'T_ADMIN_SELF_' || repeat('X', 30), 'draft', '${adminUid}');
INSERT INTO _results VALUES ('case5b_admin_self_insert', jsonb_build_object('ok', true));

-- 5c) admin 으로 타인 사칭 INSERT — RESTRICTIVE 차단
-- admin 은 is_company_admin()=true 라 RESTRICTIVE INSERT 정책 통과한다 (admin OR self).
-- 그래서 진짜 RESTRICTIVE 차단을 보려면 비-admin 컨텍스트가 필요.
RESET ROLE;
RESET request.jwt.claims;

${otherUid ? `
SET LOCAL request.jwt.claims = '{"sub":"${fix.other.auth_id}","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $do_5c$
DECLARE v_outcome text;
BEGIN
  BEGIN
    INSERT INTO quote_approvals(company_id, deal_id, stage, approval_token, status, created_by)
    VALUES ('${fix.other.company_id}', (SELECT id FROM deals WHERE company_id='${fix.other.company_id}' LIMIT 1),
            'estimate', 'T_IMPERSONATE_' || repeat('X', 30), 'draft', '${adminUid}');
    v_outcome := 'UNEXPECTED_INSERT_SUCCESS';
  EXCEPTION
    WHEN insufficient_privilege THEN v_outcome := 'BLOCKED_rls';
    WHEN check_violation THEN v_outcome := 'BLOCKED_rls';
    WHEN OTHERS THEN v_outcome := 'BLOCKED_other: ' || SQLERRM;
  END;
  INSERT INTO _results VALUES ('case5c_impersonation', jsonb_build_object('outcome', v_outcome));
END $do_5c$;
RESET ROLE;
RESET request.jwt.claims;
` : `
INSERT INTO _results VALUES ('case5c_skipped', jsonb_build_object('reason','no_other_user'));
`}

-- 5d) UPDATE 직접 — 비admin 컨텍스트에서 차단되어야 함
${otherUid ? `
SET LOCAL request.jwt.claims = '{"sub":"${fix.other.auth_id}","role":"authenticated"}';
SET LOCAL ROLE authenticated;
DO $do_5d$
DECLARE v_count int;
BEGIN
  UPDATE quote_approvals SET decision_note='hacked' WHERE approval_token='${tokens.rls}';
  GET DIAGNOSTICS v_count = ROW_COUNT;
  INSERT INTO _results VALUES ('case5d_other_update_attempt', jsonb_build_object('affected', v_count));
END $do_5d$;
RESET ROLE;
RESET request.jwt.claims;
` : `
INSERT INTO _results VALUES ('case5d_skipped', jsonb_build_object('reason','no_other_user'));
`}

-- ── 케이스 6: anon 컨텍스트 ──
-- 6a) anon 직접 SELECT — 0행 (RLS 차단)
SET LOCAL request.jwt.claims = '{"role":"anon"}';
SET LOCAL ROLE anon;
INSERT INTO _results SELECT 'case6a_anon_direct_select',
       jsonb_build_object('row_count', count(*))
  FROM quote_approvals;

-- 6b) anon RPC — get_quote_approval_by_token 정상
INSERT INTO _results SELECT 'case6b_anon_rpc',
       jsonb_build_object(
         'row_count', count(*),
         'first_status', (SELECT status FROM get_quote_approval_by_token('${tokens.rls}') LIMIT 1)
       )
  FROM get_quote_approval_by_token('${tokens.rls}');

-- 6c) anon submit_quote_decision — ok=true (rls 토큰)
INSERT INTO _results SELECT 'case6c_anon_submit',
       submit_quote_decision('${tokens.rls}', 'approved', 'external anon');

RESET ROLE;
RESET request.jwt.claims;

-- ── RLS 비재귀 정적 검증 (인라인 users/employees 서브쿼리 0건) ──
INSERT INTO _results SELECT 'case7_rls_static',
       jsonb_build_object(
         'inline_users_employees',
         (SELECT count(*) FROM pg_policies
           WHERE tablename='quote_approvals'
             AND (qual ~* '\\m(FROM|JOIN)\\s+(users|employees)\\M'
               OR with_check ~* '\\m(FROM|JOIN)\\s+(users|employees)\\M'))
       );

-- ── 정책 개수 확인 ──
INSERT INTO _results SELECT 'case7_policy_count',
       jsonb_build_object('count', count(*))
  FROM pg_policies WHERE tablename='quote_approvals';

-- ── 최종: 모든 결과 회수 ──
SELECT case_name, result FROM _results ORDER BY case_name;

ROLLBACK;
`;

  console.log(`[exec] running migration + 6 scenarios in single tx with ROLLBACK …`);
  const t0 = Date.now();
  const r = await runSql(pat, txSql);
  const dt = Date.now() - t0;
  console.log(`[exec] done in ${dt}ms; ok=${r.ok}`);

  if (!r.ok) {
    console.error("SQL error:", r.error);
    process.exit(1);
  }

  // r.data 는 마지막 SELECT 한 개만 돌려주는 경우가 많음. 다중-statement 결과 합치기:
  // Supabase database/query 는 다중 statement 결과를 배열 of arrays 로 반환할 수 있음.
  console.log("\n[results]");
  if (Array.isArray(r.data)) {
    if (r.data.length && r.data[0] && Array.isArray(r.data[0])) {
      // multi-statement
      r.data.forEach((rs, i) => console.log(`  stmt#${i}:`, JSON.stringify(rs)));
    } else {
      console.log(JSON.stringify(r.data, null, 2));
    }
  } else {
    console.log(r.data);
  }

  // 4) 사후 검증 — prod 에 quote_approvals 가 들어가지 않았는지 (ROLLBACK 동작 증명)
  const postExists = await runSql(pat,
    "SELECT to_regclass('public.quote_approvals') AS tbl");
  const postTbl = postExists.ok ? postExists.data?.[0]?.tbl : "err";
  console.log(`\n[post] quote_approvals in prod (post-rollback): ${postTbl === null ? "absent (OK — rolled back)" : postTbl}`);

  if (postTbl !== null) {
    console.error("ROLLBACK FAILED — quote_approvals exists in prod!");
    process.exit(1);
  }

  console.log("\n[done] All scenarios executed within ROLLBACK envelope. prod 변이 0 확인.");
}

main().catch(e => { console.error("FATAL:", e); process.exit(1); });
