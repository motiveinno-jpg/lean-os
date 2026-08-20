-- document-files 버킷의 UPDATE(덮어쓰기)에도 회사 격리 (2026-08-20)
--
-- 앞선 20260820170000 에서 이 버킷의 DELETE 만 좁히고 UPDATE 를 빠뜨렸다.
--   document_files_update = USING(bucket_id = 'document-files') 뿐 → 다른 회사 사용자가
--   파일보관함 파일을 **덮어쓸** 수 있었다. 지우는 것과 사실상 같은 파괴 행위다.
--
-- (감사 시 주의: pg_policies.qual 을 LIKE '%document_files%' 로 훑으면 `_` 가 한 글자
--  와일드카드라 'document-files' 에도 걸려 "격리됨"으로 잘못 읽힌다. 이 정책이 그렇게 새어나갔다.)
--
-- 경로 규칙은 DELETE 와 동일: {companyId}/... (buildStoragePath, 운영 객체 전건 확인).
-- 소유자 조건까지 넣지 않는 이유: 덮어쓰기는 같은 회사 안에서 버전 갱신으로 쓰이는 정상 동작이고,
--   사장님 요청은 "다른 회사가 건드리는 것"을 막는 것이었다. 회사 격리까지만 맞춘다.

drop policy if exists document_files_update on storage.objects;

create policy document_files_update on storage.objects for update to authenticated
  using (bucket_id = 'document-files'
         and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text);
