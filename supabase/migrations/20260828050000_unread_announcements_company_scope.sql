-- 안읽음 공지 배지를 전역(null)+내 회사 공지로 한정 (2026-08-28 사장님 제보).
--   security invoker 라 RLS 를 타는데, 운영자 계정(creative@)은 RLS 예외로 전 회사(QA 시드 포함)
--   공지가 전부 잡혀 배지·목록이 남의 회사 공지로 부풀었다. 일반 사용자는 RLS 가 이미 같은 범위라 무영향.
create or replace function public.unread_announcement_count()
returns integer
language sql
stable
security invoker
set search_path to 'public'
as $$
  select count(*)::int
  from public.announcements a
  where (a.company_id is null or a.company_id = public.get_my_company_id())
    and not exists (
      select 1 from public.announcement_reads r
      where r.announcement_id = a.id
        and r.user_id = (select current_app_user_id())
    );
$$;
