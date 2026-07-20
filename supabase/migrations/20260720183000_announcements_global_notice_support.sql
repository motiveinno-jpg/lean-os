-- announcements 정정: 전역 서비스 공지 + 회사 공지 하이브리드 모델
--
-- 배경: announcements 는 원래 프론트 글쓰기 권한이 isPlatformOperator(@mo-tive.com)로만
-- 열려 있는 "플랫폼 서비스 공지" 용도. 직전 마이그레이션(announcements_tenant_isolation)의
-- 전면 회사격리(company_id NOT NULL)는 서비스 공지 기능을 부순다.
--
-- 정정 모델:
--   company_id IS NULL  = 전역 서비스 공지 (모든 회사에 노출, 운영자만 작성)
--   company_id 값 있음   = 해당 회사 공지 (그 회사 구성원만 조회, owner/admin만 작성)
-- 기존 2행은 모티브 회사 스코프 유지(내부 테스트 글 → 다른 회사에 숨겨진 현 상태가 올바름).

-- 1) NOT NULL 해제 (NULL = 전역 공지 허용). 기존 2행 데이터는 변경하지 않음.
alter table public.announcements
  alter column company_id drop not null;

-- 2) RLS 정책 교체
--    운영자 판별은 위조 불가능한 프로젝트 관용구 is_platform_operator()
--    (auth.jwt() 검증 이메일의 @mo-tive.com 패턴) 사용.

-- SELECT: 전역 공지 OR 자기 회사 공지
drop policy if exists announcements_select_company on public.announcements;
create policy announcements_select_company on public.announcements
  for select to authenticated
  using (
    company_id is null
    or company_id = (select public.get_my_company_id())
  );

-- INSERT: 전역 공지는 운영자만 / 회사 공지는 그 회사 owner/admin만
drop policy if exists announcements_insert_admin on public.announcements;
create policy announcements_insert_admin on public.announcements
  for insert to authenticated
  with check (
    (company_id is null and (select public.is_platform_operator()))
    or (company_id = (select public.get_my_company_id()) and (select public.is_company_admin()))
  );

-- UPDATE: 동일 조건
drop policy if exists announcements_update_admin on public.announcements;
create policy announcements_update_admin on public.announcements
  for update to authenticated
  using (
    (company_id is null and (select public.is_platform_operator()))
    or (company_id = (select public.get_my_company_id()) and (select public.is_company_admin()))
  )
  with check (
    (company_id is null and (select public.is_platform_operator()))
    or (company_id = (select public.get_my_company_id()) and (select public.is_company_admin()))
  );

-- DELETE: 동일 조건
drop policy if exists announcements_delete_admin on public.announcements;
create policy announcements_delete_admin on public.announcements
  for delete to authenticated
  using (
    (company_id is null and (select public.is_platform_operator()))
    or (company_id = (select public.get_my_company_id()) and (select public.is_company_admin()))
  );
