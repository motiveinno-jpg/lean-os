-- 무료 회사도 통장·카드를 처음 연결한 직후 한 번은 지난 1년치를 가져오게 한다.
--   무료는 수동 수집이 막혀 있어(is_manual_sync_allowed) 연결해도 다음 자동 수집(하루 2회, 최근 14일)까지
--   화면이 비어 있고 지난 거래는 영영 안 들어왔다. 첫 가져오기를 시작한 뒤 60분 동안만 수동 수집을 열어 준다
--   (1년치를 3개월씩 4번 + 카드 승인내역으로 나눠 부르므로 한 번의 호출이 아니라 '창'이다).
--   그 뒤로는 다시 자동 수집만. 유료는 원래 수동 수집이 되므로 이 표를 쓰지 않는다.

create table if not exists public.codef_initial_imports (
  company_id uuid primary key references public.companies(id) on delete cascade,
  started_at timestamptz not null default now()
);
alter table public.codef_initial_imports enable row level security;   -- 정책 0 — 아래 함수(엣지 service_role)로만

-- 첫 가져오기 창이 열려 있으면 true. 처음 부르면 창을 연다.
create or replace function public.claim_initial_import(p_company uuid)
returns boolean
language plpgsql
security definer
set search_path to 'public'
as $$
declare v_started timestamptz;
begin
  insert into codef_initial_imports (company_id) values (p_company) on conflict (company_id) do nothing;
  select started_at into v_started from codef_initial_imports where company_id = p_company;
  return v_started > now() - interval '60 minutes';
end;
$$;

revoke all on function public.claim_initial_import(uuid) from public, anon, authenticated;
grant execute on function public.claim_initial_import(uuid) to service_role;
