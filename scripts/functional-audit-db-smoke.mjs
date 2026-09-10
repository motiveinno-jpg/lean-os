// 운영 접속 불가: 이 세션의 포트 미공개 일회용 컨테이너만 사용한다.
// 실제 업무 데이터를 복제하지 않고 최소 스키마 fixture로 SQL 원자성·RLS를 검사한다.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const container = 'ownerview-functional-db-20260910';
const database = `functional_audit_${Date.now()}`;
execFileSync('docker', ['exec', container, 'createdb', '-U', 'postgres', database]);
const sql = (input) => execFileSync('docker', ['exec', '-i', container, 'psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', 'postgres', '-d', database], { input, encoding: 'utf8' });
sql(`
create schema auth;
create function auth.role() returns text language sql stable as $$select current_setting('request.jwt.claim.role', true)$$;
create table public.invoices(id uuid primary key default gen_random_uuid(), company_id uuid not null, subscription_id uuid, total_amount integer, status text, toss_order_id text unique, toss_payment_key text);
create table public.subscriptions(id uuid primary key, company_id uuid, status text, last_payment_error text, updated_at timestamptz);
create table public.billing_events(id uuid primary key default gen_random_uuid(), company_id uuid, event_type text, metadata jsonb);
create table public.users(id uuid primary key, company_id uuid, is_master boolean);
create table public.notifications(id uuid primary key default gen_random_uuid(), company_id uuid, user_id uuid, type text, title text, message text, link text);
create table public.company_api_keys(id uuid primary key default gen_random_uuid(), company_id uuid, key_encrypted text);
alter table public.company_api_keys enable row level security;
grant usage on schema public to authenticated, anon;
grant select, insert, update, delete on public.company_api_keys to authenticated;
create function public.get_my_company_id() returns uuid language sql stable as $$select nullif(current_setting('test.company_id',true),'')::uuid$$;
create function public.is_advisor_session() returns boolean language sql stable as $$select coalesce(current_setting('test.advisor',true),'false')='true'$$;
create function public.is_company_admin() returns boolean language sql stable as $$select coalesce(current_setting('test.master',true),'false')='true'$$;
create function public.has_perm(p_key text) returns boolean language sql stable as $$select coalesce(current_setting('test.perm',true),'')=p_key$$;
`);
for (const file of ['20260910110000_toss_void_atomic.sql', '20260910111000_api_keys_permission_alignment.sql']) {
  sql(readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8'));
}
process.stdout.write(sql(`
set request.jwt.claim.role='service_role';
insert into subscriptions values ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000010','active',null,now());
insert into invoices(company_id,subscription_id,total_amount,status,toss_order_id,toss_payment_key) values ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001',39000,'paid','test-order','test-key');
insert into users values ('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000010',true);
create function fail_subscription() returns trigger language plpgsql as $$begin raise exception 'fixture failure'; end$$;
create trigger fixture_failure before update on subscriptions for each row execute function fail_subscription();
do $$begin
  begin perform apply_toss_payment_void('test-order','test-key','CANCELED'); raise exception 'must fail';
  exception when others then if sqlerrm <> 'fixture failure' then raise; end if; end;
  if (select status from invoices where toss_order_id='test-order') <> 'paid' then raise exception 'partial invoice update'; end if;
  if exists(select 1 from billing_events) then raise exception 'partial event'; end if;
end$$;
drop trigger fixture_failure on subscriptions;
select apply_toss_payment_void('test-order','test-key','CANCELED');
select apply_toss_payment_void('test-order','test-key','CANCELED');
do $$begin
  if (select count(*) from billing_events) <> 1 or (select count(*) from notifications) <> 1 then raise exception 'duplicate effects'; end if;
  if (select status from subscriptions limit 1) <> 'past_due' then raise exception 'subscription missing'; end if;
  if has_function_privilege('anon','public.apply_toss_payment_void(text,text,text)','EXECUTE') then raise exception 'anon execute'; end if;
  if has_function_privilege('authenticated','public.apply_toss_payment_void(text,text,text)','EXECUTE') then raise exception 'authenticated execute'; end if;
  if not has_function_privilege('service_role','public.apply_toss_payment_void(text,text,text)','EXECUTE') then raise exception 'service denied'; end if;
  begin perform apply_toss_payment_void('test-order','wrong-key','CANCELED'); raise exception 'key accepted'; exception when sqlstate '22023' then null; end;
end$$;
set request.jwt.claim.role='authenticated';
do $$begin
  begin perform apply_toss_payment_void('test-order','test-key','CANCELED'); raise exception 'caller accepted'; exception when insufficient_privilege then null; end;
end$$;
set role authenticated;
set test.company_id='00000000-0000-0000-0000-000000000010';
set test.master='false'; set test.advisor='false'; set test.perm='/settings:api-keys';
insert into company_api_keys(company_id,key_encrypted) values ('00000000-0000-0000-0000-000000000010','test-only');
do $$begin
  if (select count(*) from company_api_keys) <> 1 then raise exception 'delegate denied'; end if;
  begin insert into company_api_keys(company_id) values ('00000000-0000-0000-0000-000000000020'); raise exception 'cross company accepted'; exception when insufficient_privilege then null; end;
end$$;
set test.perm='';
do $$begin
  if exists(select 1 from company_api_keys) then raise exception 'staff can read'; end if;
  begin insert into company_api_keys(company_id) values ('00000000-0000-0000-0000-000000000010'); raise exception 'staff can write'; exception when insufficient_privilege then null; end;
end$$;
set test.master='true';
do $$begin if (select count(*) from company_api_keys) <> 1 then raise exception 'master denied'; end if; end$$;
set test.advisor='true';
do $$begin
  if exists(select 1 from company_api_keys) then raise exception 'advisor can read keys'; end if;
  begin insert into company_api_keys(company_id) values ('00000000-0000-0000-0000-000000000010'); raise exception 'advisor can write'; exception when insufficient_privilege then null; end;
end$$;
reset role;
select 'PASS: atomic rollback, retry, deduplication, key/caller checks, EXECUTE grants, master/delegate/staff/advisor/tenant RLS' as result;
`));
