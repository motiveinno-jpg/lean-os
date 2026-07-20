-- announcements 크로스테넌트 누출 차단 (company_id 도입 + RLS 재구성)
-- 기존: company_id 없음 → announcements_select_all(USING true) 로 전 회사 공지 노출.
-- 이 프로젝트 관용구: get_my_company_id() / is_company_admin()(role in owner,admin) 사용.

-- 1) company_id 컬럼 추가 (companies FK)
alter table public.announcements
  add column if not exists company_id uuid references public.companies(id);

-- 2) 백필: 기존 모든 행은 (주)모티브이노베이션 소유
update public.announcements
  set company_id = 'c361afb9-8a52-4cac-add9-8992f0f7c09c'
  where company_id is null;

-- 3) NOT NULL + 인덱스
alter table public.announcements
  alter column company_id set not null;

create index if not exists idx_announcements_company_id
  on public.announcements (company_id);

-- 4) RLS 정책 재구성 (기존 느슨한 정책 drop)
drop policy if exists announcements_select_all on public.announcements;
drop policy if exists announcements_write_operator on public.announcements;

-- SELECT: 같은 회사 구성원만
drop policy if exists announcements_select_company on public.announcements;
create policy announcements_select_company on public.announcements
  for select to authenticated
  using (company_id = (select public.get_my_company_id()));

-- INSERT: 같은 회사의 owner/admin 만
drop policy if exists announcements_insert_admin on public.announcements;
create policy announcements_insert_admin on public.announcements
  for insert to authenticated
  with check (
    company_id = (select public.get_my_company_id())
    and (select public.is_company_admin())
  );

-- UPDATE: 같은 회사의 owner/admin 만
drop policy if exists announcements_update_admin on public.announcements;
create policy announcements_update_admin on public.announcements
  for update to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and (select public.is_company_admin())
  )
  with check (
    company_id = (select public.get_my_company_id())
    and (select public.is_company_admin())
  );

-- DELETE: 같은 회사의 owner/admin 만
drop policy if exists announcements_delete_admin on public.announcements;
create policy announcements_delete_admin on public.announcements
  for delete to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and (select public.is_company_admin())
  );
