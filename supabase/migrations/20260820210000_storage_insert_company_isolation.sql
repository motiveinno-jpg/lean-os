-- 파일 올리기(INSERT)에도 회사 격리 (2026-08-20 사장님: "둘 다 순차적으로 막아줘" — 1/2 INSERT)
--
-- AS_IS — 아래 정책들이 bucket_id 만 봐서, 로그인만 돼 있으면 **다른 회사 폴더에 파일을 심을 수
--   있었다.** 실증: qa-seed 계정으로 존재하지 않는 회사 id 폴더에 순수 INSERT 성공
--   (deal-files · employee-files · receipts). 심어두면 그 회사 화면·용량에 남의 파일이 섞인다.
--     deal-files      : deal_files_insert · deal_files_upload      (중복 2개)
--     document-files  : document_files_insert
--     documents       : documents_bucket_insert · documents_storage_insert (중복 2개)
--     employee-files  : employee_files_storage_insert
--     receipts        : receipts_bucket_insert · receipts_storage_insert   (중복 2개)
--   ⚠️ 중복 PERMISSIVE 는 OR — 하나만 고치면 안 막힌다. 버킷당 하나로 정리한다.
--   ⚠️ roles 가 {public} 이던 것들은 {authenticated} 로 맞춘다. get_my_company_id() 가
--      로그인 사용자 기준이라 익명은 어차피 통과 못 하지만, 의도를 정책에 드러내 둔다.
--
-- TO_BE — 이미 잘 돌고 있는 board_files_insert · company_assets_insert 와 **동일한 문법**:
--   경로의 회사 id 구간이 내 회사와 같을 때만 올릴 수 있다.
--
-- 경로 규칙 (업로드 호출 지점 전수 확인, 2026-08-20)
--   document-files  buildStoragePath() → {companyId}/{general|documents/..|deals/..|vault/..|folders/..}/...
--                   (신규 업로드 file-storage.ts:215, 버전 업로드 :335 둘 다 같은 빌더)
--   employee-files  {companyId}/{employeeId}/{category}/...        (file-storage.ts:674)
--   receipts        {companyId}/receipts/{txId}.{ext}              (transactions/page.tsx:495)
--   deal-files      코드 참조 0 · 객체 0 (미사용 — 규약만 맞춰 둠)
--   documents       {prefix}/{companyId}/... ← 회사 id 가 **2번째** 구간. 업로드 7곳 전부 동일:
--                     approvals/       approvals/page.tsx 1556·2969·3578·4572 (첨부·의견첨부)
--                     board-items/     BoardItemDrawer.tsx:146
--                     monthly-reports/ pdf-report.ts:191
--                     schedule/        schedule.ts:349
--                     company-docs/    CompanyInfoTab.tsx:1075 · onboarding/page.tsx:655
--
-- 안 깨지는 근거
--   · get_my_company_id() = users.company_id (없으면 활성 세무사의 선택 회사) — 실사용자면 항상 값이 있다.
--   · 업로드하는 companyId 는 화면이 내 회사에서 읽어온 값이라 항상 일치한다.
--   · 엣지 함수는 service_role 이라 RLS 우회 — 서버 생성 파일(월간 리포트 배치 등) 영향 없음.
--   · upsert 업로드(company-docs · receipts · monthly-reports)는 INSERT 와 UPDATE 를 함께 타는데,
--     UPDATE 는 20260820190000 에서 같은 조건으로 이미 격리해 뒀다 — 조건이 어긋나지 않는다.

-- ── deal-files ────────────────────────────────────────────
drop policy if exists deal_files_insert on storage.objects;
drop policy if exists deal_files_upload on storage.objects;
create policy deal_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'deal-files'
              and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);

-- ── document-files ────────────────────────────────────────
drop policy if exists document_files_insert on storage.objects;
create policy document_files_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'document-files'
              and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);

-- ── employee-files ────────────────────────────────────────
drop policy if exists employee_files_storage_insert on storage.objects;
create policy employee_files_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'employee-files'
              and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);

-- ── receipts ──────────────────────────────────────────────
drop policy if exists receipts_bucket_insert on storage.objects;
drop policy if exists receipts_storage_insert on storage.objects;
create policy receipts_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'receipts'
              and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);

-- ── documents (회사 id 가 2번째 구간) ──────────────────────
drop policy if exists documents_bucket_insert on storage.objects;
drop policy if exists documents_storage_insert on storage.objects;
create policy documents_storage_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'documents'
              and (storage.foldername(name))[2] = ((select public.get_my_company_id()))::text);
