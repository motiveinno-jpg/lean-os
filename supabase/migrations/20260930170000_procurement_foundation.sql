-- 나라장터 입찰 검토 기반. 자동수집·메일 기본 OFF. 운영 적용은 별도 배포 단계.
-- 인증 클라이언트는 마스터의 소속 회사 SELECT만. 변경은 인가된 서버/service_role만.
begin;

create table public.procurement_settings (
  company_id uuid primary key references public.companies(id) on delete cascade,
  settings jsonb not null, updated_at timestamptz not null default now()
);
create table public.procurement_evidence (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  payload jsonb not null, created_by uuid references public.users(id), created_at timestamptz not null default now()
);
create table public.procurement_notices (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  notice_no text not null, revision text not null, content_hash text not null, payload jsonb not null,
  is_current boolean not null default true, created_at timestamptz not null default now(),
  unique(company_id, notice_no, revision, content_hash), unique(company_id, id)
);
create unique index procurement_notices_current on public.procurement_notices(company_id, notice_no) where is_current;
create table public.procurement_reviews (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  notice_id uuid not null, content_hash text not null, evidence_hash text not null,
  review jsonb not null, assessment jsonb not null, basis_snapshot jsonb not null default '{}', created_by uuid references public.users(id), created_at timestamptz not null default now(),
  foreign key(company_id, notice_id) references public.procurement_notices(company_id, id), unique(company_id, id),
  unique(company_id, notice_id, id)
);
create table public.procurement_cases (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  notice_id uuid not null, review_id uuid not null,
  decision text not null check(decision in ('proceed','hold','decline')), note text not null default '',
  created_by uuid references public.users(id), created_at timestamptz not null default now(),
  foreign key(company_id, notice_id, review_id) references public.procurement_reviews(company_id, notice_id, id),
  unique(company_id, id), unique(company_id, review_id, decision)
);
create table public.procurement_drafts (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  case_id uuid not null, content text not null, created_at timestamptz not null default now(),
  foreign key(company_id, case_id) references public.procurement_cases(company_id, id), unique(case_id)
);
create table public.procurement_runs (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  kind text not null check(kind in ('collect','digest')),
  status text not null check(status in ('running','completed','failed')), summary text not null default '',
  created_at timestamptz not null default now(), finished_at timestamptz
);
create table public.procurement_deliveries (
  id uuid primary key default gen_random_uuid(), company_id uuid not null references public.companies(id) on delete cascade,
  delivery_key text not null unique, status text not null check(status in ('pending','sent','failed')),
  recipients jsonb not null, from_email text not null, subject text not null, html text not null,
  provider_id text, error text, created_at timestamptz not null default now(), sent_at timestamptz
);
create unique index procurement_runs_running on public.procurement_runs(company_id,kind) where status='running';

do $policy$
declare t text;
begin
  foreach t in array array['procurement_settings','procurement_evidence','procurement_notices','procurement_reviews','procurement_cases','procurement_drafts','procurement_runs','procurement_deliveries'] loop
    execute format('alter table public.%I enable row level security',t);
    execute format('create policy procurement_company_master_read on public.%I for select to authenticated using (company_id = (select public.get_my_company_id()) and (select public.is_company_admin()) and not (select public.is_advisor_session()))',t);
    execute format('revoke all on public.%I from anon, authenticated',t);
    execute format('grant select on public.%I to authenticated',t);
    execute format('grant all on public.%I to service_role',t);
    if t <> 'procurement_settings' then
      execute format('create index %I on public.%I(company_id, created_at desc, id)',t || '_company_created',t);
    end if;
  end loop;
end;
$policy$;

-- 같은 회사의 공고 갱신을 직렬화. 동일 차수의 내용 변경도 새 이력으로 보존.
create function public.procurement_ingest_notice(p_company uuid, p_notice jsonb, p_hash text)
returns uuid language plpgsql security definer set search_path = public as $fn$
declare existing uuid; new_id uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('procurement:' || p_company::text,0));
  select id into existing from procurement_notices where company_id=p_company and notice_no=p_notice->>'noticeNo' and is_current and content_hash=p_hash;
  if existing is not null then return existing; end if;
  -- 최신 API 응답에서 같은 공고가 여러 차수로 오면 과거 차수가 최신을 덮지 않게 차수 비교.
  if exists(select 1 from procurement_notices where company_id=p_company and notice_no=p_notice->>'noticeNo' and is_current and revision ~ '^\d+$' and p_notice->>'revision' ~ '^\d+$' and revision::numeric > (p_notice->>'revision')::numeric) then
    select id into existing from procurement_notices where company_id=p_company and notice_no=p_notice->>'noticeNo' and is_current;
    return existing;
  end if;
  update procurement_notices set is_current=false where company_id=p_company and notice_no=p_notice->>'noticeNo' and is_current;
  new_id := gen_random_uuid();
  insert into procurement_notices(id,company_id,notice_no,revision,content_hash,payload)
    values(new_id,p_company,p_notice->>'noticeNo',p_notice->>'revision',p_hash,jsonb_set(p_notice,'{id}',to_jsonb(new_id)))
    on conflict(company_id,notice_no,revision,content_hash) do update set is_current=true returning id into new_id;
  return new_id;
end;
$fn$;
revoke all on function public.procurement_ingest_notice(uuid,jsonb,text) from public,anon,authenticated;
grant execute on function public.procurement_ingest_notice(uuid,jsonb,text) to service_role;

-- 진행 결정과 준비 초안을 한 트랜잭션으로 저장. 재시도 시 같은 결정·초안 재사용.
create function public.procurement_decide(p_company uuid,p_notice uuid,p_review uuid,p_evidence_hash text,p_decision text,p_note text,p_user uuid,p_content text,p_snapshot jsonb)
returns uuid language plpgsql security definer set search_path=public as $fn$
declare r procurement_reviews; n procurement_notices; c uuid;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  perform pg_advisory_xact_lock(hashtextextended('procurement:' || p_company::text,0));
  select * into n from procurement_notices where company_id=p_company and id=p_notice and is_current;
  select * into r from procurement_reviews where company_id=p_company and id=p_review and notice_id=p_notice;
  if n.id is null or r.id is null or n.content_hash <> r.content_hash or r.evidence_hash <> p_evidence_hash then raise exception '공고 또는 회사 자료가 변경되었습니다. 다시 평가하세요.'; end if;
  if r.id <> (select id from procurement_reviews where company_id=p_company and notice_id=p_notice order by created_at desc,id limit 1) then raise exception '최신 평가를 기준으로 결정하세요.'; end if;
  if p_snapshot is null or not exists(select 1 from companies company_row where company_row.id=p_company and to_jsonb(company_row) @> (p_snapshot->'company'))
    or coalesce((select jsonb_agg(payload order by id::text) from procurement_evidence where company_id=p_company),'[]'::jsonb) is distinct from p_snapshot->'evidence'
    or coalesce((select (settings->>'minimumScore')::int from procurement_settings where company_id=p_company),75) is distinct from (p_snapshot->>'minimumScore')::int then
    raise exception '회사 자료가 결정 저장 중 변경되었습니다. 다시 평가하세요.';
  end if;
  if p_decision='proceed' and (r.assessment->>'eligibility'<>'eligible' or r.assessment->>'recommendation' not in ('recommend','consider') or r.assessment->'total'='null'::jsonb or jsonb_array_length(r.assessment->'blockers')>0 or n.payload->>'status'='cancelled' or (n.payload->>'deadline')::timestamptz <= now()) then
    raise exception '진행 결정 전에 자격·평가·원문 검토를 완료하세요.';
  end if;
  insert into procurement_cases(company_id,notice_id,review_id,decision,note,created_by)
    values(p_company,p_notice,p_review,p_decision,p_note,p_user)
    on conflict(company_id,review_id,decision) do update set note=excluded.note returning id into c;
  if p_decision='proceed' then
    insert into procurement_drafts(company_id,case_id,content) values(p_company,c,p_content) on conflict(case_id) do nothing;
  end if;
  return c;
end;
$fn$;
revoke all on function public.procurement_decide(uuid,uuid,uuid,text,text,text,uuid,text,jsonb) from public,anon,authenticated;
grant execute on function public.procurement_decide(uuid,uuid,uuid,text,text,text,uuid,text,jsonb) to service_role;

-- 수집 배치는 한 번에 저장한다. 중간 실패 시 부분 완료 목록을 남기지 않는다.
create function public.procurement_ingest_batch(p_company uuid,p_items jsonb)
returns integer language plpgsql security definer set search_path=public as $fn$
declare item jsonb; count_saved integer:=0;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)>2000 then raise exception 'invalid batch'; end if;
  perform pg_advisory_xact_lock(hashtextextended('procurement:' || p_company::text,0));
  for item in select value from jsonb_array_elements(p_items) loop
    perform public.procurement_ingest_notice(p_company,item->'notice',item->>'hash');
    count_saved:=count_saved+1;
  end loop;
  return count_saved;
end;
$fn$;
revoke all on function public.procurement_ingest_batch(uuid,jsonb) from public,anon,authenticated;
grant execute on function public.procurement_ingest_batch(uuid,jsonb) to service_role;
-- 개인별 자료를 코드에 넣지 않고, 해당 회사에 한 번에 가져온다.
alter table public.procurement_evidence add column import_key text;
alter table public.procurement_evidence add constraint procurement_evidence_import_uniq unique(company_id,import_key);
create function public.procurement_import_evidence(p_company uuid,p_user uuid,p_items jsonb)
returns integer language plpgsql security definer set search_path=public as $fn$
declare item jsonb; added integer:=0; affected integer;
begin
  if auth.role() is distinct from 'service_role' then raise exception 'forbidden' using errcode='42501'; end if;
  if jsonb_typeof(p_items)<>'array' or jsonb_array_length(p_items)<1 or jsonb_array_length(p_items)>100 then raise exception 'invalid evidence batch'; end if;
  perform pg_advisory_xact_lock(hashtextextended('procurement:' || p_company::text,0));
  for item in select value from jsonb_array_elements(p_items) loop
    if item->>'import_key' is null or (item->'payload'->>'verified')::boolean is distinct from false then raise exception 'unverified import required'; end if;
    insert into public.procurement_evidence(id,company_id,payload,created_by,import_key)
    values((item->'payload'->>'id')::uuid,p_company,item->'payload',p_user,item->>'import_key')
    on conflict(company_id,import_key) do nothing;
    get diagnostics affected=row_count; added:=added+affected;
  end loop;
  return added;
end;
$fn$;
revoke all on function public.procurement_import_evidence(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.procurement_import_evidence(uuid,uuid,jsonb) to service_role;
commit;
