begin;
create table public.procurement_jobs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  notice_id uuid not null, kind text not null check(kind in ('analysis','proposal')),
  job_key text not null, status text not null default 'queued' check(status in ('queued','running','completed','failed')),
  input jsonb not null default '{}', attempts integer not null default 0,
  created_by uuid references public.users(id), error text, started_at timestamptz, finished_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key(company_id,notice_id) references public.procurement_notices(company_id,id), unique(company_id,job_key),unique(company_id,id)
);
create index procurement_jobs_queue on public.procurement_jobs(company_id,status,created_at);
create table public.procurement_artifacts (
  id uuid primary key default gen_random_uuid(),company_id uuid not null references public.companies(id) on delete cascade,
  notice_id uuid not null, job_id uuid not null,kind text not null check(kind in ('analysis','proposal')),
  content_hash text not null,evidence_hash text not null,workforce_hash text not null,
  body jsonb not null,provider_model text not null,provider_usage jsonb not null default '{}',
  created_by uuid references public.users(id),created_at timestamptz not null default now(),
  foreign key(company_id,notice_id) references public.procurement_notices(company_id,id),
  foreign key(company_id,job_id) references public.procurement_jobs(company_id,id),unique(job_id)
);
alter table public.procurement_jobs enable row level security;
alter table public.procurement_artifacts enable row level security;
create policy procurement_jobs_read on public.procurement_jobs for select to authenticated using(company_id=(select public.get_my_company_id()) and (select public.is_company_admin()) and not (select public.is_advisor_session()));
create policy procurement_artifacts_read on public.procurement_artifacts for select to authenticated using(company_id=(select public.get_my_company_id()) and (select public.is_company_admin()) and not (select public.is_advisor_session()));
grant select on public.procurement_jobs,public.procurement_artifacts to authenticated;
grant all on public.procurement_jobs,public.procurement_artifacts to service_role;
create function public.procurement_claim_job(p_company uuid,p_job uuid default null)
returns jsonb language plpgsql security definer set search_path=public as $fn$
declare picked public.procurement_jobs;
begin
 if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
 update public.procurement_jobs set status='queued',error='직전 실행 중단: 안전 재시도',started_at=null where company_id=p_company and status='running' and started_at<now()-interval '5 minutes' and attempts<3;
 update public.procurement_jobs set status='failed',error='재시도 한도 초과',finished_at=now() where company_id=p_company and status='running' and started_at<now()-interval '5 minutes' and attempts>=3;
 select * into picked from public.procurement_jobs where company_id=p_company and status='queued' and (p_job is null or id=p_job) order by created_at for update skip locked limit 1;
 if picked.id is null then return null; end if;
 update public.procurement_jobs set status='running',started_at=now(),attempts=attempts+1,error=null where id=picked.id returning * into picked;
 return to_jsonb(picked);
end;
$fn$;
revoke all on function public.procurement_claim_job(uuid,uuid) from public,anon,authenticated;
grant execute on function public.procurement_claim_job(uuid,uuid) to service_role;
commit;
