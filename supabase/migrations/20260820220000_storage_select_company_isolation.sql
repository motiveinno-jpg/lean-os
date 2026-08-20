-- 파일 읽기(SELECT)에도 회사 격리 (2026-08-20 사장님: "둘 다 순차적으로 막아줘" — 2/2 SELECT)
--
-- AS_IS — 아래 두 정책이 bucket_id 만 봐서, 로그인만 돼 있으면 **다른 회사의 파일을 읽을 수 있었다.**
--     documents_select      USING(bucket_id = 'documents')       ← 결재 첨부·사업자등록증·월간리포트·일정첨부·보드첨부
--     document_files_select USING(bucket_id = 'document-files')  ← 파일보관함 파일
--   둘 다 private 버킷이라 서명 URL 발급에 SELECT 가 필요한데, 그 발급이 아무에게나 열려 있었다
--   = 남의 회사 파일의 서명 URL 을 스스로 만들어 내려받을 수 있었다. 삭제·심기보다 이쪽이 더 무겁다.
--   (deal-files · employee-files · receipts · board-files · company-assets 의 SELECT 는 이미 격리돼 있다.)
--
-- TO_BE — 다른 버킷과 같은 문법: 경로의 회사 id 구간이 내 회사와 같을 때만 읽을 수 있다.
--   document-files : {companyId}/...              → 1번째 구간
--   documents      : {prefix}/{companyId}/...     → 2번째 구간
--
-- 안 깨지는 근거 (읽기 경로 전수 확인, 2026-08-20)
--   · 서명 URL 발급은 전부 로그인 사용자가 **자기 회사** 파일에 대해 한다:
--       file-storage.ts getSignedUrl:129 · attachSignedUrls:191 · resolveSignedUrl:136
--       (파일보관함 목록·내려받기, 결재 첨부 열람 approvals/page.tsx:199·342, 일정 첨부 다이얼로그)
--       pdf-report.ts:194 monthly-reports/{companyId}
--       CompanyInfoTab.tsx:1056·1109 · onboarding/page.tsx:638·671 company-docs/{companyId}
--   · **이미 발급된 서명 URL 은 영향 없다** — 서명 토큰으로 검증되므로 RLS 를 다시 타지 않는다.
--     (/api/files/download 프록시는 서명 URL 을 중계만 한다 — 발급하지 않으므로 무관)
--   · 익명 경로(/sign · /share)는 이 버킷들의 스토리지를 전혀 쓰지 않는다(grep 0건).
--   · 운영자 화면(/platform/*)이 읽는 것은 support-attachments 뿐 — 이 두 버킷을 안 읽는다.
--     따라서 회사 격리가 운영자 업무를 막지 않는다.
--   · 세무사 세션은 get_my_company_id() 가 '선택한 연결 회사'를 돌려주므로 그 회사 파일은 그대로 보인다.
--   · 엣지 함수는 service_role 이라 RLS 우회.
--
-- 되돌리기: 이 파일의 create 를 지우고 USING(bucket_id = '<버킷>') 으로 되돌리면 종전 동작.

drop policy if exists document_files_select on storage.objects;
create policy document_files_select on storage.objects for select to authenticated
  using (bucket_id = 'document-files'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);

drop policy if exists documents_select on storage.objects;
create policy documents_select on storage.objects for select to authenticated
  using (bucket_id = 'documents'
         and (storage.foldername(name))[2] = ((select public.get_my_company_id()))::text);
