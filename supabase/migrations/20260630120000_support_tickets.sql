-- Customer support center: user inquiries + operator answers (2026-06-30)
--   User submits a ticket; platform operator answers; user views the answer in /support.
--   RLS: company users see/insert their own company tickets; platform operators (is_platform_operator)
--        see + update (answer) all companies. Regression-safe: brand-new table only.
--   On answer, a trigger sets status='answered' and notifies the ticket owner.

begin;

create table if not exists public.support_tickets (
  id          uuid primary key default gen_random_uuid(),
  company_id  uuid not null references public.companies(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  category    text not null default 'general',     -- general | feature | billing | bug | etc
  subject     text not null,
  content     text not null,
  status      text not null default 'open',         -- open | answered | closed
  answer      text,
  answered_at timestamptz,
  answered_by uuid references public.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists idx_support_tickets_company on public.support_tickets (company_id, created_at desc);
create index if not exists idx_support_tickets_user    on public.support_tickets (user_id, created_at desc);
create index if not exists idx_support_tickets_status  on public.support_tickets (status);

alter table public.support_tickets enable row level security;

drop policy if exists support_tickets_select on public.support_tickets;
create policy support_tickets_select on public.support_tickets
  for select using (company_id = public.get_my_company_id() or public.is_platform_operator());

drop policy if exists support_tickets_insert on public.support_tickets;
create policy support_tickets_insert on public.support_tickets
  for insert with check (company_id = public.get_my_company_id());

drop policy if exists support_tickets_update on public.support_tickets;
create policy support_tickets_update on public.support_tickets
  for update using (company_id = public.get_my_company_id() or public.is_platform_operator())
              with check (company_id = public.get_my_company_id() or public.is_platform_operator());

drop policy if exists support_tickets_delete on public.support_tickets;
create policy support_tickets_delete on public.support_tickets
  for delete using (company_id = public.get_my_company_id() and status = 'open');

-- touch updated_at; when an answer is first added, auto-set status + notify the owner.
create or replace function public.support_tickets_touch() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if (new.answer is not null and btrim(new.answer) <> '' and coalesce(btrim(old.answer), '') = '') then
    new.status := 'answered';
    new.answered_at := coalesce(new.answered_at, now());
    insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read, created_at)
    values (new.company_id, new.user_id, 'system', '고객센터 답변이 도착했습니다', left(coalesce(new.subject, ''), 80), 'support_ticket', new.id, false, now());
  end if;
  return new;
end $$;

drop trigger if exists trg_support_tickets_touch on public.support_tickets;
create trigger trg_support_tickets_touch before update on public.support_tickets
  for each row execute function public.support_tickets_touch();

commit;
