-- 회사별 API 인증키 (2026-08-21 사장님 지시)
--
-- > "플랫폼키는 회사별로 입력 안 하면 쓰지 못하게. 현재 오너뷰에 내가 등록한 건은
-- >  모티브이노베이션 전용 플랫폼키야. 회사가 자기 키를 넣었을 때만 쓸 수 있게.
-- >  넣지 않았을 때는 발급받을 수 있는 사이트로 바로가기 기능 제공"
--
-- 왜 회사별인가
--   · 공공데이터포털·기업마당 인증키는 **발급받은 계정의 호출 한도**를 쓴다.
--     우리 키 하나로 모든 회사를 돌리면 회사가 늘수록 한도가 먼저 터지고, 그 순간 전 회사가 멈춘다.
--   · 키를 넣은 회사만 공고를 본다. 안 넣은 회사는 상시 제도(고용장려금·세액공제)까지는 그대로 쓰고,
--     공고 자리에는 **발급 사이트 바로가기**가 뜬다.
--
-- 왜 automation_credentials 를 안 쓰나
--   그 표는 `service + credentials(jsonb)` 라 자유 형식이고, 연결 상태·오류 사유·마지막 확인 시각을
--   담을 자리가 없다. 이 화면의 주인공은 값이 아니라 **연결 상태**다(ad_accounts 와 같은 모양으로 간다).
--
-- 값은 절대 평문으로 두지 않는다 — encrypt_credential() pgcrypto RPC 로 암호화한다.
--   암호화 키는 vault.decrypted_secrets 의 credential_encryption_key 이고 DB 밖으로 나가지 않는다.
--   화면에는 **다시 내려보내지 않는다** — 마스킹(`5530…Ds`)만 보여주고 바꾸려면 새로 넣는다.

create table if not exists public.company_api_keys (
  id             uuid primary key default gen_random_uuid(),
  company_id     uuid not null references public.companies(id) on delete cascade,
  -- lib/api-keys.ts 의 API_PROVIDERS 키 — kstartup · bizinfo · …
  provider       text not null,
  -- encrypt_credential() 결과. 평문은 어디에도 남지 않는다
  key_encrypted  text not null,
  -- 마스킹 표시용 앞/뒤 몇 글자 (평문 복원 불가 — 눈으로 어떤 키인지 알아보는 용도)
  key_hint       text,
  status         text not null default 'pending' check (status in ('pending', 'ok', 'error')),
  last_tested_at timestamptz,
  last_error     text,
  last_used_at   timestamptz,
  created_by     uuid,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (company_id, provider)
);

create index if not exists company_api_keys_provider_idx on public.company_api_keys (provider, status);

comment on table public.company_api_keys is
  '회사가 직접 발급받아 등록한 외부 API 인증키 (2026-08-21). 값은 pgcrypto 암호화 — 화면으로 다시 내려보내지 않는다.';

alter table public.company_api_keys enable row level security;

--   회사 사람만, 그중에서도 대표·관리자만. 직원·세무사에게는 존재 자체가 안 보인다.
drop policy if exists company_api_keys_read on public.company_api_keys;
create policy company_api_keys_read on public.company_api_keys
  for select to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and exists (select 1 from public.users u where u.auth_id = auth.uid() and u.role in ('owner', 'admin'))
  );

drop policy if exists company_api_keys_write on public.company_api_keys;
create policy company_api_keys_write on public.company_api_keys
  for all to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and exists (select 1 from public.users u where u.auth_id = auth.uid() and u.role in ('owner', 'admin'))
  )
  with check (
    company_id = (select public.get_my_company_id())
    and exists (select 1 from public.users u where u.auth_id = auth.uid() and u.role in ('owner', 'admin'))
  );
