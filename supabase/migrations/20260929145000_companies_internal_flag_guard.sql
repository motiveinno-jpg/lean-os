-- 내부 회사 표시(is_internal)도 브라우저에서 못 바꾸게
--   is_internal 은 방문 통계에서 우리 팀 방문을 가려내는 표시인데, 회사 대표는 companies UPDATE 가 허용돼 있어
--   자기 회사를 내부로 켜 방문 집계에서 빠지거나, 우리 회사 표시를 끌 수 있었다.
--   is_test 와 같은 트리거로 묶는다 — service_role·postgres(SQL·서버)만 바꾼다. 새 회사는 둘 다 꺼진 채로 들어간다.

create or replace function public.companies_is_test_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.is_test := false;
    new.is_internal := false;
    return new;
  end if;
  if new.is_test is distinct from old.is_test or new.is_internal is distinct from old.is_internal then
    raise exception '테스트·내부 회사 표시는 바꿀 수 없습니다 (server-managed)' using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists companies_is_test_guard_trg on public.companies;
create trigger companies_is_test_guard_trg
  before insert or update of is_test, is_internal on public.companies
  for each row execute function public.companies_is_test_guard();
