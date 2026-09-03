-- get_company_directory 에 user_id 추가 (2026-09-03 전 화면 점검: 채팅 구성원에 같은 사람이 부서와 '미배정'에 두 번 보임 —
--   직원 기록과 앱 계정을 이메일로만 맞춰서 이메일이 비거나 다른 직원은 계정이 따로 '미배정'으로 남았다)
drop function if exists public.get_company_directory();
create or replace function public.get_company_directory()
returns table(id uuid, name text, department text, "position" text, email text, phone text, status text, hire_date date, user_id uuid)
language sql stable security definer
set search_path to 'public'
as $function$
  select e.id, e.name, e.department, e."position", e.email, e.phone, e.status, e.hire_date, e.user_id
  from employees e
  where e.company_id = get_my_company_id()
  order by e.department nulls last, e.name;
$function$;
grant execute on function public.get_company_directory() to authenticated;
