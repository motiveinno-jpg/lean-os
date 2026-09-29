-- 회사 사업자등록번호는 브라우저가 직접 바꾸지 못한다 — 서버(/api/company/business-number)만 (2026-09-29)
--   전에는 회사 설정·온보딩이 companies 를 직접 고쳐, 휴·폐업·미등록 번호나 남의 번호를 가입보다 약한 검사로(온보딩은
--   검사 없이) 넣을 수 있었다. 서버 창구가 권한·형식·국세청 상태·중복을 한 번에 보므로 그 밖의 변경을 막는다.
--   · 막는 것: anon/authenticated 가 UPDATE 로 번호의 '숫자'를 바꾸는 것(하이픈 표기만 다른 건 통과)
--   · 그대로: 가입 때 회사 행 INSERT(가입 화면이 국세청·중복 확인을 거친다, 유니크 인덱스가 중복을 막는다),
--            service_role·postgres(서버 창구·운영자 도구·DB 함수) 경로 전부
create or replace function public.companies_business_number_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user not in ('anon', 'authenticated') then
    return new;
  end if;
  if regexp_replace(coalesce(new.business_number, ''), '[^0-9]', '', 'g')
     is distinct from regexp_replace(coalesce(old.business_number, ''), '[^0-9]', '', 'g') then
    raise exception '사업자등록번호는 회사 설정 › 회사정보에서 바꿔 주세요 (business_number changes must go through server)'
      using errcode = '42501';
  end if;
  return new;
end;
$function$;

drop trigger if exists companies_business_number_guard_trg on public.companies;
create trigger companies_business_number_guard_trg
  before update of business_number on public.companies
  for each row execute function public.companies_business_number_guard();
