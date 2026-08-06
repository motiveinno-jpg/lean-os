-- 광고 성과 연동 1차 — 네이버 검색광고 (2026-08-06 사장님 지시). prod 적용 완료(MCP apply_migration).
--   설계: 키는 '회사 금고'(ad_accounts)에 한 번만 넣고, 프로젝트는 연결만 한다(deal_ad_accounts).
--   ⚠️ 키는 ad_account_secrets 에 암호화해 넣고 화면에서는 읽을 수 없다 — RLS 를 켜고 정책을 두지
--      않아 service_role(엣지 함수)만 본다. decrypt_credential 이 authenticated 에게 열려 있어
--      암호문이 화면에 닿는 순간 풀 수 있기 때문이다.

create table if not exists public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  platform text not null check (platform in ('naver_sa','naver_gfa','google_ads','meta_ads')),
  label text not null,
  external_id text not null,                      -- 네이버 CUSTOMER_ID · act_… · customer id
  status text not null default 'pending' check (status in ('pending','connected','error','disabled')),
  last_synced_at timestamptz,
  sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists ad_accounts_uniq on public.ad_accounts(company_id, platform, external_id);
alter table public.ad_accounts enable row level security;
drop policy if exists ad_accounts_rw on public.ad_accounts;
create policy ad_accounts_rw on public.ad_accounts
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

create table if not exists public.ad_account_secrets (
  ad_account_id uuid primary key references public.ad_accounts(id) on delete cascade,
  api_key_enc text,
  api_secret_enc text,
  updated_at timestamptz not null default now()
);
alter table public.ad_account_secrets enable row level security;   -- 정책 없음 = service_role 만

create table if not exists public.deal_ad_accounts (
  deal_id uuid not null references public.deals(id) on delete cascade,
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (deal_id, ad_account_id)
);
alter table public.deal_ad_accounts enable row level security;
drop policy if exists deal_ad_accounts_rw on public.deal_ad_accounts;
create policy deal_ad_accounts_rw on public.deal_ad_accounts
  using (company_id = public.get_my_company_id())
  with check (company_id = public.get_my_company_id());

create table if not exists public.ad_metrics_daily (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ad_account_id uuid not null references public.ad_accounts(id) on delete cascade,
  platform text not null,
  campaign_id text not null,
  campaign_name text,
  stat_date date not null,
  impressions bigint not null default 0,
  clicks bigint not null default 0,
  cost numeric not null default 0,
  conversions numeric not null default 0,
  conv_value numeric not null default 0,
  raw jsonb,
  updated_at timestamptz not null default now()
);
create unique index if not exists ad_metrics_daily_uniq
  on public.ad_metrics_daily(ad_account_id, campaign_id, stat_date);
create index if not exists ad_metrics_daily_lookup
  on public.ad_metrics_daily(company_id, stat_date desc);
alter table public.ad_metrics_daily enable row level security;
drop policy if exists ad_metrics_daily_read on public.ad_metrics_daily;
create policy ad_metrics_daily_read on public.ad_metrics_daily
  for select using (company_id = public.get_my_company_id());

-- 키 저장 — 평문은 이 함수 안에서만 다루고 바로 암호화한다. 화면은 결과 id 만 받는다.
create or replace function public.ad_account_save(
  p_id uuid, p_platform text, p_label text, p_external_id text,
  p_api_key text, p_api_secret text
) returns uuid
language plpgsql security definer set search_path = public
as $$
declare v_company uuid; v_id uuid;
begin
  v_company := public.get_my_company_id();
  if v_company is null then raise exception '회사를 찾을 수 없습니다'; end if;

  if p_id is null then
    insert into public.ad_accounts (company_id, platform, label, external_id)
    values (v_company, p_platform, p_label, p_external_id)
    on conflict (company_id, platform, external_id)
      do update set label = excluded.label, updated_at = now()
    returning id into v_id;
  else
    update public.ad_accounts
       set label = p_label, external_id = p_external_id, updated_at = now()
     where id = p_id and company_id = v_company
    returning id into v_id;
    if v_id is null then raise exception '광고 계정을 찾을 수 없습니다'; end if;
  end if;

  if coalesce(p_api_key, '') <> '' or coalesce(p_api_secret, '') <> '' then
    insert into public.ad_account_secrets (ad_account_id, api_key_enc, api_secret_enc)
    values (v_id, public.encrypt_credential(p_api_key), public.encrypt_credential(p_api_secret))
    on conflict (ad_account_id) do update
      set api_key_enc = coalesce(nullif(public.encrypt_credential(p_api_key), ''), public.ad_account_secrets.api_key_enc),
          api_secret_enc = coalesce(nullif(public.encrypt_credential(p_api_secret), ''), public.ad_account_secrets.api_secret_enc),
          updated_at = now();
    update public.ad_accounts set status = 'pending', sync_error = null where id = v_id;
  end if;
  return v_id;
end;
$$;
revoke execute on function public.ad_account_save(uuid, text, text, text, text, text) from public;
grant execute on function public.ad_account_save(uuid, text, text, text, text, text) to authenticated;

-- 키가 들어 있는지 여부만 알려 준다(값은 절대 안 준다)
create or replace function public.ad_account_has_secret(p_id uuid)
returns boolean language sql security definer set search_path = public stable as $$
  select exists (
    select 1 from public.ad_account_secrets s join public.ad_accounts a on a.id = s.ad_account_id
    where s.ad_account_id = p_id and a.company_id = public.get_my_company_id()
      and coalesce(s.api_key_enc,'') <> '' and coalesce(s.api_secret_enc,'') <> ''
  );
$$;
revoke execute on function public.ad_account_has_secret(uuid) from public;
grant execute on function public.ad_account_has_secret(uuid) to authenticated;

-- 엣지 함수(service_role)만 키를 푼다
create or replace function public.ad_account_secrets_read(p_id uuid)
returns table (api_key text, api_secret text)
language sql security definer set search_path = public stable as $$
  select public.decrypt_credential(s.api_key_enc), public.decrypt_credential(s.api_secret_enc)
    from public.ad_account_secrets s
   where s.ad_account_id = p_id;
$$;
revoke execute on function public.ad_account_secrets_read(uuid) from public;
revoke execute on function public.ad_account_secrets_read(uuid) from authenticated;
grant execute on function public.ad_account_secrets_read(uuid) to service_role;
