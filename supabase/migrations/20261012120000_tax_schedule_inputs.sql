-- 부가세 부속서류 입력값(tax_schedule_inputs) — 2026-10-12 세무 2차 결정 261, 3단계 (docs/20261012_PLAN_tax_closing_v2.md)
--
-- 왜: 부동산임대공급가액명세서 줄·의제매입세액 고른 건·대손세액공제 줄·경정청구 사유와 환급계좌는 장부에서 계산되지 않고
--     사람이 적는다. 지금은 화면 상태뿐이라 새로고침하면 사라지고, 마감 전에 여러 번 나눠 적을 수가 없었다.
--     마감 전 '초안'을 회사·서류·기간마다 jsonb 한 덩어리로 남긴다.
--
-- 규칙:
--   doc        = lease(부동산임대) · deemed(의제매입) · baddebt(대손) · refund_claim(경정청구)
--   period_key = tax_returns 의 부가세 열쇠와 같은 모양 YYYY-(1p|1c|1h|2p|2c|2h).
--   (company_id, doc, period_key) 하나에 한 줄 — 화면은 upsert(on conflict) 로 덮어쓴다.
--   data 크기 < 512KB.
--   updated_at 은 트리거가 now() 로, 사용자 직접 쓰기면 updated_by 도 current_app_user_id() 로 강제한다(화면 값을 믿지 않는다).
--   읽기·쓰기·지우기 = 같은 회사 AND has_perm('/finance/tax-filing') (has_perm 은 마스터 포함).
--     지우기를 허용한다 — 초안이다. 낸 숫자는 마감 때 tax_returns.schedules 에 스냅샷으로 남는다.
--   세무대리인 쓰기 금지 — advisor_ro_* RESTRICTIVE 정본 패턴 그대로.
--
-- 기존 데이터: 새 표라 없음.
-- 버린 안: tax_returns 에 status='draft' 줄로 두기 — 그 표는 고치지 않는 신고본이라 불변 트리거·차수 규칙과 부딪친다.
--          / 서류마다 정규화된 표 4개 — 서류 양식이 국세청 개정마다 바뀌고 줄 단위 조회가 필요 없다. 마감 때 jsonb 로 스냅샷하므로 모양도 같게.

create table if not exists public.tax_schedule_inputs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  doc text not null check (doc in ('lease', 'deemed', 'baddebt', 'refund_claim')),
  period_key text not null check (period_key ~ '^\d{4}-(1p|1c|1h|2p|2c|2h)$'),
  data jsonb not null default '{}'::jsonb check (pg_column_size(data) < 524288),
  updated_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tax_schedule_inputs_company_doc_period_key unique (company_id, doc, period_key)
);

comment on table public.tax_schedule_inputs is
  '부가세 부속서류 입력 초안(임대·의제매입·대손·경정청구) — 회사·서류·기간당 jsonb 한 줄. 마감 시 tax_returns.schedules 로 스냅샷(결정 261).';

-- ── 권한(RLS) ────────────────────────────────────────────────────────────
alter table public.tax_schedule_inputs enable row level security;

revoke all on public.tax_schedule_inputs from anon;
revoke truncate, references, trigger on public.tax_schedule_inputs from authenticated;
grant select, insert, update, delete on public.tax_schedule_inputs to authenticated;

drop policy if exists tax_schedule_inputs_select on public.tax_schedule_inputs;
create policy tax_schedule_inputs_select on public.tax_schedule_inputs
  for select to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.has_perm('/finance/tax-filing')));

drop policy if exists tax_schedule_inputs_insert on public.tax_schedule_inputs;
create policy tax_schedule_inputs_insert on public.tax_schedule_inputs
  for insert to authenticated
  with check (company_id = (select public.get_my_company_id()) and (select public.has_perm('/finance/tax-filing')));

drop policy if exists tax_schedule_inputs_update on public.tax_schedule_inputs;
create policy tax_schedule_inputs_update on public.tax_schedule_inputs
  for update to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.has_perm('/finance/tax-filing')))
  with check (company_id = (select public.get_my_company_id()) and (select public.has_perm('/finance/tax-filing')));

drop policy if exists tax_schedule_inputs_delete on public.tax_schedule_inputs;
create policy tax_schedule_inputs_delete on public.tax_schedule_inputs
  for delete to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.has_perm('/finance/tax-filing')));

drop policy if exists advisor_ro_ins on public.tax_schedule_inputs;
create policy advisor_ro_ins on public.tax_schedule_inputs as restrictive for insert to authenticated
  with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.tax_schedule_inputs;
create policy advisor_ro_upd on public.tax_schedule_inputs as restrictive for update to authenticated
  using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.tax_schedule_inputs;
create policy advisor_ro_del on public.tax_schedule_inputs as restrictive for delete to authenticated
  using (not (select public.is_advisor_session()));

-- ── 트리거: 수정 시각·수정자 ───────────────────────────────────────────
create or replace function public.tax_schedule_inputs_touch()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    new.created_at := now();
  else
    new.created_at := old.created_at;
  end if;
  if current_user = 'authenticated' then
    new.updated_by := public.current_app_user_id();
  end if;
  return new;
end $$;

revoke execute on function public.tax_schedule_inputs_touch() from public, anon, authenticated;

drop trigger if exists tax_schedule_inputs_touch on public.tax_schedule_inputs;
create trigger tax_schedule_inputs_touch before insert or update on public.tax_schedule_inputs
  for each row execute function public.tax_schedule_inputs_touch();
