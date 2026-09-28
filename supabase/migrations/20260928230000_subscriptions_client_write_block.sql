-- 구독·청구서는 서버만 쓴다 — 회사 관리자가 자기 회사에 유료 요금제를 스스로 넣을 수 있던 구멍 (2026-09-28)
--
--   subscriptions_guard 는 브라우저 INSERT 중 '체험(trialing) + plan_slug free/starter' 만 허용했는데
--   plan_id 는 보지 않았다. get_company_entitlement 는 plan_id 의 요금제를 plan_slug 보다 먼저 읽으므로
--   {status: trialing, plan_slug: 'free', plan_id: <ultra/standard>, trial_ends_at: +30일} 한 줄이면
--   결제 없이 상위 요금제가 30일 열렸고, 매달 새 줄을 넣어 되풀이할 수 있었다(롤백 트랜잭션으로 재현 확인).
--   앱 코드에 브라우저가 구독 행을 만드는 경로는 없다(웹훅·toss-charge·운영자 API 모두 service_role).
--   → 브라우저(anon/authenticated)의 INSERT·UPDATE·DELETE 를 전부 막는다.
--
--   invoices 도 같은 성격이다 — 회사 관리자가 'paid' 청구서를 직접 넣거나 고칠 수 있었다(운영자 매출 집계에 섞임).
--   앱에서 브라우저가 청구서를 쓰는 곳은 없다. SELECT 정책은 그대로 둔다.

create or replace function public.subscriptions_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  -- service_role·postgres·pg_cron 등 서버 문맥은 통과. 브라우저는 PostgREST 가 anon/authenticated 로 SET ROLE.
  if current_user not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;
  raise exception 'subscription changes must go through server';
end;
$function$;

drop trigger if exists subscriptions_guard_trg on public.subscriptions;
create trigger subscriptions_guard_trg
  before insert or update or delete on public.subscriptions
  for each row execute function public.subscriptions_guard();

create or replace function public.invoices_client_write_guard()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $function$
begin
  if current_user not in ('anon', 'authenticated') then
    return coalesce(new, old);
  end if;
  raise exception 'invoice changes must go through server';
end;
$function$;

drop trigger if exists invoices_client_write_guard_trg on public.invoices;
create trigger invoices_client_write_guard_trg
  before insert or update or delete on public.invoices
  for each row execute function public.invoices_client_write_guard();
