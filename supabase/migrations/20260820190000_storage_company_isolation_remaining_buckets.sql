-- 남은 버킷 4개의 파일 실물 삭제·덮어쓰기에 회사 격리 (2026-08-20 사장님: "나머지 버킷 4개도 막아줘")
--   앞선 20260820170000 에서 document-files 를 막으면서 보고한 잔여 항목의 후속.
--
-- AS_IS — 아래 정책들이 bucket_id 만 보고 있어, **다른 회사 사용자도** 파일 실물을
--   지우거나(DELETE) 덮어쓸(UPDATE) 수 있었다. 로그인만 돼 있으면 됐다.
--     deal-files      : deal_files_delete / deal_files_update
--     documents       : documents_bucket_delete · documents_storage_delete / documents_bucket_update · documents_storage_update
--     employee-files  : employee_files_storage_delete / employee_files_storage_update
--     receipts        : receipts_bucket_delete · documents 와 마찬가지로 2중 / receipts_bucket_update
--   ⚠️ 같은 명령에 PERMISSIVE 정책이 둘이면 OR 로 묶인다 — 하나만 고치면 느슨한 쪽으로 계속 뚫린다.
--      그래서 중복 정책을 지우고 버킷·명령당 하나로 정리한다.
--
-- TO_BE — 경로 첫 구간(또는 documents 는 두 번째 구간)의 회사 id 가 내 회사와 같을 때만 허용.
--   이미 같은 방식으로 격리돼 있던 board-files·company-assets·document-files 와 동일한 문법.
--
-- 경로 규칙 (코드 전수 + 운영 실데이터로 확인, 2026-08-20)
--   deal-files      {companyId}/...                         ← 코드 참조 0·객체 0 (미사용 버킷, 규약만 맞춰 둠)
--   employee-files  {companyId}/{employeeId}/{category}/...  (file-storage.ts uploadEmployeeFile)
--   receipts        {companyId}/receipts/{txId}.{ext}        (transactions/page.tsx)
--   documents       {prefix}/{companyId}/...  ← 회사 id 가 **2번째** 구간. prefix 5종:
--                     approvals(결재 첨부·의견 첨부) · board-items(프로젝트 보드) ·
--                     monthly-reports(월간 리포트) · schedule(일정 첨부) · company-docs(사업자등록증 등)
--                   운영 객체 115건이 전부 이 모양이고, 업로드 코드 7곳도 전부 동일.
--
-- 안전 확인
--   · 외부(비로그인) 서명·공유 흐름(/sign · /share · complete-signing)은 이 버킷들의 **스토리지를
--     쓰지 않는다** — documents 는 같은 이름의 *테이블* 을 쓸 뿐이다. 익명 접근이 끊길 일 없음.
--   · 엣지 함수는 service_role 이라 RLS 를 우회한다 — 서버 배치·정리 작업에 영향 없음.
--   · upsert 업로드(company-docs·receipts)는 UPDATE 를 타지만 같은 회사 경로라 그대로 통과한다.
--
-- 범위 밖 (미조치, 별도 판단 필요)
--   documents 버킷의 SELECT 정책(documents_select)이 아직 USING(bucket_id='documents') 뿐이라
--   **다른 회사의 결재 첨부·사업자등록증을 읽을 수 있다.** 읽기는 서명 URL 발급 경로가 얽혀 있어
--   실동작 확인 후 별도 처리한다. 이 마이그레이션은 파괴적 명령(DELETE·UPDATE)만 막는다.

-- ── deal-files ────────────────────────────────────────────
drop policy if exists deal_files_delete on storage.objects;
drop policy if exists deal_files_update on storage.objects;

create policy deal_files_delete on storage.objects for delete to authenticated
  using (bucket_id = 'deal-files'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);

create policy deal_files_update on storage.objects for update to authenticated
  using (bucket_id = 'deal-files'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);

-- ── employee-files ────────────────────────────────────────
drop policy if exists employee_files_storage_delete on storage.objects;
drop policy if exists employee_files_storage_update on storage.objects;

create policy employee_files_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'employee-files'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);

create policy employee_files_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'employee-files'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);

-- ── receipts ──────────────────────────────────────────────
drop policy if exists receipts_bucket_delete on storage.objects;
drop policy if exists receipts_storage_delete on storage.objects;
drop policy if exists receipts_bucket_update on storage.objects;
drop policy if exists receipts_storage_update on storage.objects;

create policy receipts_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'receipts'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);

create policy receipts_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'receipts'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);

-- ── documents (회사 id 가 2번째 구간) ──────────────────────
drop policy if exists documents_bucket_delete on storage.objects;
drop policy if exists documents_storage_delete on storage.objects;
drop policy if exists documents_bucket_update on storage.objects;
drop policy if exists documents_storage_update on storage.objects;

create policy documents_storage_delete on storage.objects for delete to authenticated
  using (bucket_id = 'documents'
         and (storage.foldername(name))[2] = ((select public.get_my_company_id()))::text);

create policy documents_storage_update on storage.objects for update to authenticated
  using (bucket_id = 'documents'
         and (storage.foldername(name))[2] = ((select public.get_my_company_id()))::text);
