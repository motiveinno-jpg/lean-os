// 임시 PostgreSQL(PGlite)에 실제 마이그레이션을 적용해 RLS·FK·원자 저장·중복 방지를 검증한다.
// 운영 환경·환경변수·네트워크를 사용하지 않는다.
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
const { PGlite } = await import(process.argv[2] || "@electric-sql/pglite");
const db = new PGlite();
const companyA = "00000000-0000-4000-8000-000000000001",
  companyB = "00000000-0000-4000-8000-000000000002",
  userA = "00000000-0000-4000-8000-000000000003";
let checks = 0;
const ok = (condition, message) => {
  assert(condition, message);
  checks++;
};
async function reject(fn, label) {
  await assert.rejects(fn, undefined, label);
  checks++;
}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
    create schema auth;grant usage on schema auth to anon,authenticated,service_role;
    create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role',true)$$;
    create function public.get_my_company_id() returns uuid language sql stable security definer as $$select nullif(current_setting('app.company_id',true),'')::uuid$$;
    create function public.is_company_admin() returns boolean language sql stable security definer as $$select coalesce(current_setting('app.is_master',true)='true',false)$$;
    create function public.is_advisor_session() returns boolean language sql stable security definer as $$select coalesce(current_setting('app.is_advisor',true)='true',false)$$;
    create table public.companies(id uuid primary key,name text);
    create table public.users(id uuid primary key);
    insert into companies values('${companyA}','QA-A'),('${companyB}','QA-B');insert into users values('${userA}');
    set request.jwt.claim.role='service_role';set app.company_id='${companyA}';set app.is_master='true';set app.is_advisor='false';`);
  const sql = await readFile(
    fileURLToPath(
      new URL(
        "../supabase/migrations/20260930170000_procurement_foundation.sql",
        import.meta.url,
      ),
    ),
    "utf8",
  );
  await db.exec(sql);
  await db.exec(await readFile(new URL("../supabase/migrations/20261001110000_procurement_ai_jobs.sql", import.meta.url), "utf8"));
  ok(
    (
      await db.query(
        "select count(*)::int as n from pg_class where relname like 'procurement_%' and relkind='r' and relrowsecurity",
      )
    ).rows[0].n === 10,
    "10개 테이블 모두 RLS 활성화",
  );
  await db.exec(
    `insert into procurement_settings values('${companyA}','{}',now()),('${companyB}','{}',now());set role authenticated;`,
  );
  ok(
    (await db.query("select company_id from procurement_settings")).rows
      .length === 1,
    "회사 A 마스터는 자기 회사만 조회",
  );
  await db.exec("set app.is_master='false'");
  ok(
    (await db.query("select * from procurement_settings")).rows.length === 0,
    "일반 구성원 비노출",
  );
  await db.exec("set app.is_master='true';set app.is_advisor='true'");
  ok(
    (await db.query("select * from procurement_settings")).rows.length === 0,
    "제휴 세무사 비노출",
  );
  await db.exec("set app.is_advisor='false'");
  await reject(
    () =>
      db.query(
        "insert into procurement_evidence(company_id,payload) values($1,'{}')",
        [companyA],
      ),
    "인증 클라이언트의 증빙 확인 위조 차단",
  );
  await reject(
    () => db.query("select procurement_ingest_notice($1,'{}','x')", [companyA]),
    "인증 클라이언트의 직접 RPC 실행 차단",
  );
  await db.exec("reset role");
  const makeNotice = (revision, title = "QA 홍보 용역") => ({
    id: "client-id",
    noticeNo: "QA-001",
    revision,
    title,
    agency: "QA기관",
    deadline: "2028-12-31T09:00:00Z",
    status: "open",
    documents: [],
    attachments: [],
  });
  const ingest = async (revision, hash, title) =>
    (
      await db.query(
        "select procurement_ingest_notice($1,$2::jsonb,$3) as id",
        [companyA, JSON.stringify(makeNotice(revision, title)), hash],
      )
    ).rows[0].id;
  const first = await ingest("000", "hash-000");
  ok((await ingest("000", "hash-000")) === first, "동일 공고 재수집 중복 방지");
  const next = await ingest("001", "hash-001");
  ok(next !== first, "정정 공고는 새 이력");
  ok(
    (
      await db.query(
        "select count(*)::int as n from procurement_notices where is_current",
      )
    ).rows[0].n === 1,
    "최신 공고 하나만 활성화",
  );
  ok(
    (await ingest("000", "old-hash")) === next,
    "과거 차수 응답이 최신 차수를 덮지 않음",
  );
  const newer = await ingest("001", "hash-001-changed", "내용 변경 QA 용역");
  ok(newer !== next, "같은 차수 내용 변경도 이력 보존");
  const assessment = {
    eligibility: "eligible",
    recommendation: "recommend",
    total: 90,
    blockers: [],
    warnings: [],
  };
  const r = (
    await db.query(
      "insert into procurement_reviews(company_id,notice_id,content_hash,evidence_hash,review,assessment,created_by) values($1,$2,$3,'basis','{}',$4::jsonb,$5) returning id",
      [companyA, newer, "hash-001-changed", JSON.stringify(assessment), userA],
    )
  ).rows[0].id;
  await reject(
    () =>
      db.query(
        "insert into procurement_reviews(company_id,notice_id,content_hash,evidence_hash,review,assessment) values($1,$2,'x','x','{}','{}')",
        [companyB, newer],
      ),
    "다른 회사 공고를 평가하는 FK 차단",
  );
  const snapshot = {
    company: { id: companyA, name: "QA-A" },
    evidence: [],
    minimumScore: 75,
  };
  const decide = async (noticeId, reviewId, basis = "basis", s = snapshot) =>
    (
      await db.query(
        "select procurement_decide($1,$2,$3,$4,'proceed','검토 후 진행',$5,'검토용 초안',$6::jsonb) as id",
        [companyA, noticeId, reviewId, basis, userA, JSON.stringify(s)],
      )
    ).rows[0].id;
  const caseId = await decide(newer, r);
  ok((await decide(newer, r)) === caseId, "동시·재시도 결정은 같은 기록 사용");
  ok(
    (await db.query("select count(*)::int as n from procurement_drafts"))
      .rows[0].n === 1,
    "진행 결정과 준비 초안 원자 저장·중복 방지",
  );
  await reject(
    () => decide(newer, r, "changed"),
    "회사 증빙 변경 시 진행 차단",
  );
  await reject(
    () =>
      decide(newer, r, "basis", {
        ...snapshot,
        company: { ...snapshot.company, name: "옛 회사명" },
      }),
    "회사정보 저장 경합 시 진행 차단",
  );
  await ingest("002", "hash-002");
  await reject(() => decide(newer, r), "정정 전 공고로 진행 차단");
  await db.query(
    "insert into procurement_runs(company_id,kind,status) values($1,'collect','running')",
    [companyA],
  );
  await reject(
    () =>
      db.query(
        "insert into procurement_runs(company_id,kind,status) values($1,'collect','running')",
        [companyA],
      ),
    "공고 수집 중복 실행 차단",
  );
  await db.query(
    "insert into procurement_deliveries(company_id,delivery_key,status,recipients,from_email,subject,html) values($1,'daily-key','pending','[]','qa@example.com','QA','QA')",
    [companyA],
  );
  await reject(
    () =>
      db.query(
        "insert into procurement_deliveries(company_id,delivery_key,status,recipients,from_email,subject,html) values($1,'daily-key','pending','[]','qa@example.com','QA','QA')",
        [companyA],
      ),
    "일일 발송 키 중복 차단",
  );
  await reject(
    () =>
      db.query("select procurement_ingest_batch($1,$2::jsonb)", [
        companyA,
        JSON.stringify([
          {
            notice: { ...makeNotice("000"), noticeNo: "BATCH-1" },
            hash: "batch-1",
          },
          { notice: { revision: "000" }, hash: "invalid" },
        ]),
      ]),
    "수집 배치 중간 실패 시 트랜잭션 롤백",
  );
  ok(
    (
      await db.query(
        "select count(*)::int as n from procurement_notices where notice_no='BATCH-1'",
      )
    ).rows[0].n === 0,
    "실패한 배치의 일부 공고가 완료 목록에 남지 않음",
  );
  const imported = {
    id: "00000000-0000-4000-8000-000000000050",
    verified: false,
    title: "QA import",
  };
  const batch = [{ payload: imported, import_key: "qa-import-key" }];
  ok(
    (
      await db.query(
        "select procurement_import_evidence($1,$2,$3::jsonb) as n",
        [companyA, userA, JSON.stringify(batch)],
      )
    ).rows[0].n === 1,
    "자료 묶음 가져오기",
  );
  ok(
    (
      await db.query(
        "select procurement_import_evidence($1,$2,$3::jsonb) as n",
        [companyA, userA, JSON.stringify(batch)],
      )
    ).rows[0].n === 0,
    "동일 자료 중복 가져오기 방지",
  );
  await reject(
    () =>
      db.query("select procurement_import_evidence($1,$2,$3::jsonb)", [
        companyA,
        userA,
        JSON.stringify([
          {
            payload: {
              ...imported,
              id: "00000000-0000-4000-8000-000000000051",
            },
            import_key: "rollback-key",
          },
          {
            payload: { ...imported, id: "broken-id" },
            import_key: "invalid-key",
          },
        ]),
      ]),
    "자료 중간 오류는 전체 롤백",
  );
  ok(
    (
      await db.query(
        "select count(*)::int as n from procurement_evidence where import_key='rollback-key'",
      )
    ).rows[0].n === 0,
    "실패한 가져오기는 일부 자료를 남기지 않음",
  );
  await db.exec("set role authenticated");
  await reject(
    () =>
      db.query("select procurement_import_evidence($1,$2,$3::jsonb)", [
        companyA,
        userA,
        JSON.stringify(batch),
      ]),
    "클라이언트의 직접 실적 가져오기 RPC 차단",
  );
  await db.exec("reset role");
  process.stdout.write(
    `PASS: 실제 PostgreSQL 마이그레이션·RLS·회사 경계·정정 이력·진행 결정·초안·중복 방지 ${checks}개 검증\n`,
  );
} catch (e) {
  process.stderr.write(`FAIL: ${e.message}\n${e.where || ""}\n`);
  process.exitCode = 1;
} finally {
  await db.close();
}
