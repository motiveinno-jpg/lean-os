-- 오너뷰 MCP 커넥터 — Claude 등 외부 AI 에 먼데이 커넥터처럼 "주소 넣고 오너뷰 로그인"으로 연결.
--   표준 MCP 인증(OAuth 2.1 + PKCE + 동적 클라이언트 등록)을 오너뷰가 직접 발급한다.
--   · oauth_clients      — Claude 같은 연결 앱이 스스로 등록(동적 등록). 비밀 없음(공개 클라이언트, PKCE 필수)
--   · oauth_auth_codes   — 로그인·허용 뒤 5분짜리 일회용 코드(해시만 저장)
--   · oauth_tokens       — 접속 토큰 1시간 + 갱신 토큰 90일(해시만 저장, 갱신마다 교체). 본인은 목록·끊기 가능
--   · mcp_access_log     — 누가 어떤 AI 로 어떤 도구를 불렀는지(값은 남기지 않는다)
--   권한은 로그인한 사람의 오너뷰 권한 그대로(도구 실행은 AI 참모와 같은 함수·같은 규칙).
--   1차는 모티브만(feature_rollout 'mcp_connector').
begin;

create table if not exists public.oauth_clients (
  client_id text primary key,
  client_name text not null default '',
  redirect_uris text[] not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz
);

create table if not exists public.oauth_auth_codes (
  code_hash text primary key,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  user_id uuid not null,            -- auth.users.id
  company_id uuid not null,
  redirect_uri text not null,
  code_challenge text not null,
  scope text not null default 'ownerview.read',
  resource text,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists public.oauth_tokens (
  id uuid primary key default gen_random_uuid(),
  token_hash text not null unique,
  refresh_hash text not null unique,
  client_id text not null references public.oauth_clients(client_id) on delete cascade,
  client_name text not null default '',
  user_id uuid not null,            -- auth.users.id
  company_id uuid not null,
  scope text not null default 'ownerview.read',
  expires_at timestamptz not null,
  refresh_expires_at timestamptz not null,
  revoked_at timestamptz,
  last_used_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists oauth_tokens_user_idx on public.oauth_tokens (user_id) where revoked_at is null;

create table if not exists public.mcp_access_log (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  user_id uuid not null,
  client_id text,
  tool text not null,
  ok boolean not null,
  error text,
  created_at timestamptz not null default now()
);
create index if not exists mcp_access_log_company_idx on public.mcp_access_log (company_id, created_at desc);

-- 서버(service_role)만 쓴다. 본인은 자기 연결 목록을 보고 끊을 수만 있다.
alter table public.oauth_clients enable row level security;
alter table public.oauth_auth_codes enable row level security;
alter table public.oauth_tokens enable row level security;
alter table public.mcp_access_log enable row level security;

create policy oauth_tokens_own_select on public.oauth_tokens for select to authenticated
  using (user_id = (select auth.uid()));
create policy oauth_tokens_own_revoke on public.oauth_tokens for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
revoke all on public.oauth_tokens from anon, authenticated;
grant select (id, client_id, client_name, scope, created_at, last_used_at, revoked_at, expires_at, refresh_expires_at) on public.oauth_tokens to authenticated;
grant update (revoked_at) on public.oauth_tokens to authenticated;

create policy mcp_access_log_own_select on public.mcp_access_log for select to authenticated
  using (user_id = (select auth.uid()));
revoke all on public.mcp_access_log from anon, authenticated;
grant select on public.mcp_access_log to authenticated;

revoke all on public.oauth_clients, public.oauth_auth_codes from anon, authenticated;

insert into public.feature_rollout (feature, company_id)
select 'mcp_connector', 'c361afb9-8a52-4cac-add9-8992f0f7c09c'
 where not exists (select 1 from public.feature_rollout where feature = 'mcp_connector' and company_id = 'c361afb9-8a52-4cac-add9-8992f0f7c09c');

commit;
