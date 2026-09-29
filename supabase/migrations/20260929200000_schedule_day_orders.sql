-- 달력 하루 칸 안 일정 순서 — 사람마다 따로 (업무 › 일정/할 일, 드래그로 순서 변경).
--   일정 자체에 순서를 적지 않는 이유: ① 회사 공용 일정은 여러 사람 달력에 같이 보여 한 사람이 바꾸면 남의 달력도
--   바뀐다 ② 남이 만든 일정은 수정 권한이 없다 ③ 여러 날 일정은 날마다 자리가 다를 수 있다.
--   그래서 (본인, 날짜) 한 줄에 그 칸의 일정 키 순서를 통째로 둔다. 키는 일정 id, 반복 회차는 '원본id@YYYYMMDD'.
--   목록에 없는 일정(새로 생긴 것)은 화면이 원래 순서대로 뒤에 붙인다. 지워진 일정 키는 그냥 무시된다.
begin;

create table if not exists public.schedule_day_orders (
  user_id uuid not null default auth.uid(),
  company_id uuid not null,
  day date not null,
  event_keys text[] not null default '{}',
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);
comment on table public.schedule_day_orders is '달력 하루 칸 안 일정 순서(본인 전용). event_keys = 일정 id 또는 반복 회차 원본id@YYYYMMDD';

alter table public.schedule_day_orders enable row level security;
create policy schedule_day_orders_own on public.schedule_day_orders
  for all to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()) and company_id = (select public.get_my_company_id()));

grant select, insert, update, delete on public.schedule_day_orders to authenticated;

commit;
