-- 파일보관함 파일 삭제를 '올린 본인 + 권한 위임자'로 제한 (2026-08-20 사장님:
--   "파일보관함에 올린 파일들이 모든 사람이 삭제가 가능해 — 본인이 올린거랑 권한이 있는 사람만")
--
-- AS_IS
--   · public.document_files 정책이 document_files_company / document_files_company_isolation
--     둘 다 FOR ALL · USING(company_id = get_my_company_id()) 뿐 → 같은 회사면 누구나 남의 파일 DELETE.
--   · storage.objects 의 document_files_delete 는 USING(bucket_id='document-files') 뿐 →
--     회사 격리조차 없어 다른 회사 사용자도 파일 실물을 지울 수 있었다.
--   · lib/file-storage.ts deleteFile() 에도 권한 검사가 없었다(같은 커밋에서 함께 수정).
--
-- TO_BE
--   · DELETE 만 RESTRICTIVE 로 좁힌다: uploaded_by = 나 OR has_perm('/documents:delete').
--     RESTRICTIVE 라 기존 PERMISSIVE 회사격리 정책과 AND 로 결합된다 — 회사 격리는 그대로 유지되고
--     SELECT/INSERT/UPDATE 는 전혀 건드리지 않는다(열람·업로드·이름변경 동작 불변).
--   · has_perm() 은 내부에서 is_master 를 먼저 보므로 마스터는 자동 포함 — 별도 분기 불필요.
--   · storage 정책도 같은 조건으로 맞춰 DB 행만 막고 실물이 지워지는 반쪽 방어를 없앤다.
--
-- 적용 시점 / 기존 데이터
--   · 즉시. 소급 이관 없음 — document_files 51건 전부 uploaded_by 가 채워져 있어(NULL 0건)
--     "본인이 올린 것" 판정이 과거 파일에도 그대로 성립한다.
--   · uploaded_by 는 users.id (auth.uid() 아님) — 운영 51/51 이 users.id 와 조인됨을 확인하고 정한 기준.
--
-- 파급
--   · 삭제 UI 진입점은 파일보관함(/documents) 한 곳뿐(deleteFile 호출처 1곳).
--   · 연쇄 정리 경로(deleteFilesForDocument · pruneUnreferencedDocumentFiles)는 호출부가 이미
--     .catch(()=>{}) 로 실패를 허용한다 — 남의 파일이 안 지워져도 사용자 흐름은 안 깨진다.
--
-- 버린 안
--   · 트리거(enforce_board_pin_permission 식): DELETE 는 RLS 로 표현하는 게 정확하고,
--     이미 advisor_ro_del 이 RESTRICTIVE DELETE 선례라 일관된다.
--   · 정책에 uploaded_by IS NULL 예외 두기: 운영에 NULL 이 0건이라 불필요한 뒷문만 된다.

-- 1) 현재 앱 사용자 id (users.id) — auth.uid() 와 다르다.
--    STABLE SECURITY DEFINER: RLS 안에서 users 를 읽어야 하므로 정의자 권한 필요.
create or replace function public.current_app_user_id()
returns uuid
language sql
stable
security definer
set search_path to 'public'
as $$
  select id from public.users where auth_id = (select auth.uid()) limit 1;
$$;

comment on function public.current_app_user_id() is
  '현재 로그인 사용자의 public.users.id (auth.uid() 아님). document_files.uploaded_by 등 users.id 를 담는 칸과 비교할 때 쓴다. (2026-08-20)';

-- 2) DB 행 — 남의 파일 DELETE 차단
drop policy if exists document_files_delete_owner_or_perm on public.document_files;
create policy document_files_delete_owner_or_perm
  on public.document_files
  as restrictive
  for delete
  to authenticated
  using (
    uploaded_by = (select public.current_app_user_id())
    or (select public.has_perm('/documents:delete'))
  );

-- 3) 파일 실물 — 회사 격리 + 같은 소유/권한 조건.
--    행이 이미 없는 경우(연쇄 정리로 행을 먼저 지운 뒤·고아 blob)는 허용해야 실물이 남지 않는다.
--    막는 것은 "남이 올린 행이 살아 있는데 나에겐 권한이 없는" 경우뿐.
drop policy if exists document_files_delete on storage.objects;
create policy document_files_delete
  on storage.objects
  for delete
  to authenticated
  using (
    bucket_id = 'document-files'
    and (storage.foldername(name))[1] = ((select public.get_my_company_id()))::text
    and not exists (
      select 1
      from public.document_files f
      where f.bucket = 'document-files'
        and f.storage_path = storage.objects.name
        and f.uploaded_by is distinct from (select public.current_app_user_id())
        and not (select public.has_perm('/documents:delete'))
    )
  );
