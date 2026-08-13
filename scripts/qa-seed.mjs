#!/usr/bin/env node
/**
 * OwnerView — QA 시드 회사 생성/정리 (2026-08-11 개발 하네스 3단계)
 *
 * 매 QA 세션마다 손 SQL 로 시드를 만들고 FK 순서를 기억해가며 지우던 것을 스크립트로 승격.
 * 삭제 순서는 2026-08-11 실전 정리(모던웍스 시드)에서 검증된 순서 그대로다.
 *
 * 실행:
 *   npm run qa:seed        — QA 회사(qa-seed-*@mo-tive.com) 생성. 이미 있으면 정보만 출력.
 *   npm run qa:teardown    — QA 회사와 딸린 데이터 전부 삭제(잔여 0 검증까지).
 *   node scripts/qa-seed.mjs status — 현재 시드 존재 여부만 확인.
 *
 * ⚠️ prod DB 를 변경한다 — 두 PC 동시 DB 작업 금지 규칙 적용. 실행 전 다른 PC 확인.
 *
 * 인증:
 *   · SQL 은 Management API(database/query) — .env.supabase.local 의 SUPABASE_ACCESS_TOKEN.
 *   · auth 계정 생성만 service_role 키(Management API 로 조회) + auth.admin.createUser —
 *     SQL 로 auth.users 를 만들면 identities 가 빠져 로그인 플로우가 깨질 수 있다.
 *
 * 안전장치:
 *   · 시드 이메일(qa-seed-*@mo-tive.com)·시드 회사에만 손댄다.
 *   · teardown 은 그 회사 구성원이 전원 qa-seed 계정일 때만 진행 — 아니면 즉시 중단.
 *   · 두 번 실행해도 안전(idempotent): seed 는 있으면 건너뛰고, teardown 은 없으면 no-op.
 */
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PROJECT_REF = process.env.SUPABASE_PROJECT_REF || "njbvdkuvtdtkxyylwngn";
const SUPABASE_URL = `https://${PROJECT_REF}.supabase.co`;

const OWNER_EMAIL = "qa-seed-owner@mo-tive.com";
const MEMBER_EMAIL = "qa-seed-member@mo-tive.com";
const PASSWORD = "QaSeed!2026";
const COMPANY_NAME = "QA시드 주식회사";

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

const PAT = readPat();
if (!PAT) {
  console.error("❌ SUPABASE_ACCESS_TOKEN 이 없습니다 (.env.supabase.local 또는 env).");
  process.exit(1);
}

/** Management API 로 SQL 실행 — MCP execute_sql 과 같은 엔드포인트. */
async function sql(query) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${PAT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`SQL 실패 (${res.status}): ${JSON.stringify(body)}`);
  return Array.isArray(body) ? body : [];
}

/** service_role 키 — auth 계정 생성/삭제에만 사용, 로그에 찍지 않는다. */
async function serviceKey() {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/api-keys?reveal=true`, {
    headers: { Authorization: `Bearer ${PAT}` },
  });
  if (!res.ok) throw new Error(`api-keys 조회 실패 (${res.status})`);
  const keys = await res.json();
  const svc = keys.find((k) => k.name === "service_role" || k.id === "service_role" || /service/.test(k.description || ""));
  if (!svc?.api_key) throw new Error("service_role 키를 찾지 못했습니다.");
  return svc.api_key;
}

async function status() {
  const rows = await sql(`
    select u.email, u.company_id, c.name as company
    from users u left join companies c on c.id = u.company_id
    where u.email in ('${OWNER_EMAIL}','${MEMBER_EMAIL}') order by u.email;`);
  return rows;
}

async function seed() {
  const existing = await status();
  if (existing.length > 0) {
    console.log("✅ QA 시드가 이미 있습니다 — 그대로 사용하세요:");
    for (const r of existing) console.log(`   ${r.email} → ${r.company} (${r.company_id})`);
    console.log(`   비밀번호: ${PASSWORD}`);
    return;
  }

  console.log("⚠️  prod DB 에 QA 시드를 생성합니다 — 다른 PC 에서 DB 작업 중이면 중단하세요.");
  // GoTrue admin REST 직접 호출 — supabase-js v2 는 Node 22+ 요구라 스크립트에선 안 쓴다.
  const svc = await serviceKey();
  const mk = async (email, name) => {
    const res = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, {
      method: "POST",
      headers: { apikey: svc, Authorization: `Bearer ${svc}`, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: PASSWORD, email_confirm: true, user_metadata: { name } }),
    });
    const body = await res.json().catch(() => null);
    if (!res.ok) throw new Error(`auth 생성 실패 (${email}): ${res.status} ${JSON.stringify(body)}`);
    return body.id;
  };
  const ownerId = await mk(OWNER_EMAIL, "김시드");
  const memberId = await mk(MEMBER_EMAIL, "이직원");

  // 회사·구성원·근태 설정·직원·거래처를 한 트랜잭션으로.
  //   users.id = auth id 로 통일 (prod 기존 행들과 동일 관례 — RLS 신원 매핑은 auth_id 기준).
  await sql(`
    do $$
    declare cid uuid;
    begin
      insert into companies (name) values ('${COMPANY_NAME}') returning id into cid;
      insert into users (id, auth_id, company_id, email, name, role, is_master) values
        ('${ownerId}', '${ownerId}', cid, '${OWNER_EMAIL}', '김시드', 'owner', true),
        ('${memberId}', '${memberId}', cid, '${MEMBER_EMAIL}', '이직원', 'employee', false);
      insert into company_settings (company_id, work_start_time, work_end_time, lunch_minutes, late_grace_minutes, workdays_mask)
        values (cid, '09:00', '18:00', 60, 5, 31);
      insert into employees (company_id, user_id, name, status, hire_date, position, department)
        values (cid, '${memberId}', '이직원', 'active', '2026-01-05', '사원', 'QA');
      insert into partners (company_id, name) values (cid, 'QA시드상사'), (cid, 'QA시드물산');
      -- 유료 기능(AI 참모 등) QA 를 위해 활성 구독(standard) 부여 — teardown 이 subscriptions 도 지운다.
      insert into subscriptions (company_id, plan_id, plan_slug, status, current_period_start, current_period_end)
        select cid, id, slug, 'active', now(), now() + interval '30 days'
        from subscription_plans where slug = 'standard';
    end $$;`);

  const made = await status();
  console.log("✅ QA 시드 생성 완료:");
  for (const r of made) console.log(`   ${r.email} → ${r.company} (${r.company_id})`);
  console.log(`   비밀번호: ${PASSWORD}`);
  console.log("   구성: 마스터 김시드 · 직원 이직원(부서 QA, 09:00~18:00 유예 5분) · 거래처 2 · standard 구독(활성)");
}

async function teardown() {
  const existing = await status();
  if (existing.length === 0) {
    console.log("✅ QA 시드 없음 — 지울 것이 없습니다.");
    return;
  }
  console.log("⚠️  prod DB 에서 QA 시드를 삭제합니다 — 다른 PC 에서 DB 작업 중이면 중단하세요.");

  // FK-안전 삭제 순서 — 2026-08-11 실전 정리에서 검증. 안전장치: 전원 qa-seed 계정일 때만.
  await sql(`
    do $$
    declare
      cid uuid;
      aids uuid[];
      stranger int;
      r record;
    begin
      select company_id into cid from users where email = '${OWNER_EMAIL}' limit 1;
      if cid is null then
        select company_id into cid from users where email = '${MEMBER_EMAIL}' limit 1;
      end if;
      if cid is null then return; end if;

      select count(*) into stranger from users
        where company_id = cid and email not like 'qa-seed-%@mo-tive.com';
      if stranger > 0 then
        raise exception 'SAFETY: 이 회사에 qa-seed 외 계정 %명 — 시드 회사가 아닙니다. 수동 확인 필요.', stranger;
      end if;

      select array_agg(auth_id) into aids from users where company_id = cid;

      delete from attendance_records where company_id = cid;
      delete from leave_requests where company_id = cid;
      delete from bank_transactions where company_id = cid;
      delete from card_transactions where company_id = cid;
      delete from tax_invoices where company_id = cid;
      delete from cash_receipts where company_id = cid;
      delete from bank_accounts where company_id = cid;
      delete from approval_steps where request_id in (select id from approval_requests where company_id = cid);
      delete from approval_requests where company_id = cid;
      delete from approval_policies where company_id = cid;
      delete from financial_items where deal_id in (select id from deals where company_id = cid);
      delete from deals where company_id = cid;
      delete from partners where company_id = cid;
      alter table allowance_types disable trigger user;
      delete from allowance_types where company_id = cid;
      alter table allowance_types enable trigger user;
      delete from employees where company_id = cid;
      delete from active_sessions where auth_id = any(aids);
      delete from user_consents where auth_id = any(aids);
      -- 결재 상신 E2E 가 남기는 감사 로그 — users FK 라 유저 삭제 전에 (2026-08-13 실패 사례)
      delete from audit_logs where user_id in (select id from users where company_id = cid);
      delete from ai_copilot_history where company_id = cid;
      delete from ai_usage_log where company_id = cid;
      delete from notifications where company_id = cid;
      delete from announcements where company_id = cid;
      delete from schedule_events where company_id = cid;
      delete from growth_targets where company_id = cid;
      delete from company_settings where company_id = cid;
      delete from subscriptions where company_id = cid;
      delete from users where company_id = cid;
      -- 위 나열에 없는 신규 테이블이 회사를 참조해도 안 깨지게 — 잔여 참조 일괄 삭제 (2026-08-13,
      --   doc_templates·closing_checklists 가 잇달아 teardown 을 막은 뒤 근본 보강)
      for r in
        select distinct tc.table_name as t, kcu.column_name as c
        from information_schema.table_constraints tc
        join information_schema.key_column_usage kcu on kcu.constraint_name = tc.constraint_name and kcu.table_schema = 'public'
        join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = 'public'
        where tc.constraint_type = 'FOREIGN KEY' and ccu.table_name = 'companies' and tc.table_schema = 'public'
          and tc.table_name <> 'users'
      loop
        execute format('delete from %I where %I = $1', r.t, r.c) using cid;
      end loop;
      delete from companies where id = cid;  -- advisor_company_links 는 FK cascade 로 함께 삭제
      delete from auth.users where id = any(aids);
      -- 세무사 포털 테스트 계정(qa-seed-advisor 등) — tax_advisors + auth 정리 (2026-08-11)
      delete from tax_advisors where email like 'qa-seed-%@mo-tive.com';
      delete from auth.users where email like 'qa-seed-%@mo-tive.com';
    end $$;`);

  const left = await sql(`
    select
      (select count(*) from users where email like 'qa-seed-%@mo-tive.com') as users_left,
      (select count(*) from auth.users where email like 'qa-seed-%@mo-tive.com') as auth_left,
      (select count(*) from companies where name = '${COMPANY_NAME}') as company_left;`);
  const l = left[0] || {};
  if (Number(l.users_left) || Number(l.auth_left) || Number(l.company_left)) {
    console.error(`❌ 잔여 데이터 있음: users=${l.users_left} auth=${l.auth_left} company=${l.company_left}`);
    process.exit(1);
  }
  console.log("✅ QA 시드 삭제 완료 — 잔여 0 확인.");
}

const cmd = process.argv[2];
try {
  if (cmd === "seed") await seed();
  else if (cmd === "teardown") await teardown();
  else if (cmd === "status") {
    const rows = await status();
    console.log(rows.length ? rows : "QA 시드 없음");
  } else {
    console.log("Usage: node scripts/qa-seed.mjs <seed|teardown|status>");
    process.exit(1);
  }
} catch (e) {
  console.error("❌", e.message || e);
  process.exit(1);
}
