-- 직원별·탭별 접근 권한(전용 테이블). 관리자/대표가 특정 직원에게 특정 라우트 접근을 부여.
--   기본은 미부여(직원은 탭은 보이되 접근 차단). 부여된 라우트만 접근 허용.
create table if not exists public.user_tab_access (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  route text not null,
  granted_by uuid,
  created_at timestamptz not null default now(),
  unique (user_id, route)
);

create index if not exists user_tab_access_user_idx on public.user_tab_access(user_id);
create index if not exists user_tab_access_company_idx on public.user_tab_access(company_id);

alter table public.user_tab_access enable row level security;

-- 현재 사용자가 관리자/대표인지 (RLS 재귀 회피: SECURITY DEFINER)
create or replace function public.is_company_admin()
returns boolean language sql security definer set search_path = public stable as $$
  select exists(
    select 1 from public.users u
    where u.id = public.current_app_user_id()
      and u.role in ('owner','admin')
  );
$$;

-- 읽기: 같은 회사 구성원 (직원이 본인 부여 목록을 읽어 접근 판단)
drop policy if exists uta_read on public.user_tab_access;
create policy uta_read on public.user_tab_access for select
  using (company_id = (select public.get_my_company_id()));

-- 쓰기(부여/회수): 같은 회사의 관리자/대표만
drop policy if exists uta_write on public.user_tab_access;
create policy uta_write on public.user_tab_access for all
  using (company_id = (select public.get_my_company_id()) and (select public.is_company_admin()))
  with check (company_id = (select public.get_my_company_id()) and (select public.is_company_admin()));
