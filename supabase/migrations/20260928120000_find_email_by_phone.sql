begin;
--   이메일 찾기 화면의 '전화번호 (선택)' 칸이 서버로 가지 않아 "더 정확한 결과"라는 안내가 거짓이었다.
--   전화번호를 주면 구성원 정보(employees.phone)의 숫자가 같은 사람만 돌려준다. 안 주면 종전대로 이름만.
--   동명이인이 많을 때 남의 계정 도메인까지 보이던 것도 전화번호로 좁혀진다.
drop function if exists public.find_masked_emails_by_name(text);
create or replace function public.find_masked_emails_by_name(p_name text, p_phone text default null)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $function$
  select coalesce(array_agg(
    case when position('@' in u.email) > 1
      then left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2)
      else '***' end), '{}')
  from (
    select distinct us.email from public.users us
    where trim(us.name) = trim(coalesce(p_name, '')) and coalesce(us.email, '') <> ''
      and (
        length(regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g')) < 9
        or exists (
          select 1 from public.employees e
           where e.user_id = us.id
             and regexp_replace(coalesce(e.phone, ''), '[^0-9]', '', 'g') = regexp_replace(p_phone, '[^0-9]', '', 'g'))
      )
    limit 5
  ) u;
$function$;
revoke all on function public.find_masked_emails_by_name(text, text) from public;
grant execute on function public.find_masked_emails_by_name(text, text) to anon, authenticated, service_role;
commit;
