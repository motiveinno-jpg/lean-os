-- QA 발견 수정: operator_unclassified_companies RPC 반환타입 불일치 (2026-07-02)
--   companies.created_at = timestamp WITHOUT time zone 인데 함수는 WITH time zone 으로 선언 →
--   42804 "structure of query does not match function result type" → /platform/industry 400.
--   반환 컬럼을 timestamptz 로 캐스팅해 선언과 일치시킴(운영자 미분류 회사 위젯 복구).
create or replace function public.operator_unclassified_companies()
returns table(id uuid, name text, business_number text, created_at timestamp with time zone)
language plpgsql stable security definer set search_path to 'public'
as $function$
begin
  if not public.is_platform_operator() then
    raise exception 'platform operator only' using errcode = '42501';
  end if;
  return query
  select c.id, c.name, c.business_number, c.created_at::timestamptz
  from companies c
  where c.industry is null or c.industry = ''
  order by c.created_at desc;
end;
$function$;
