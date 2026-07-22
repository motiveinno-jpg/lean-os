-- AI 중심화 STEP 2 — 사용량/비용/latency 추적 테이블 + 구독 티어별 월 토큰 상한.
--   ⚠️ 스키마 추가만(운영 데이터 변경 없음). 원문 프롬프트·응답·계좌·주민번호 등 민감정보 저장 금지 — 메타만.
--   미적용: 배포 승인 후 supabase functions/CLI 흐름과 별도로 apply.

-- 1) 티어별 월 AI 토큰 상한 (실사용 input+output 토큰 기준). NULL=허용 안 함(=대표 참모 비활성).
--    MVP: Ultra/Enterprise 만 허용. 값은 조정 가능(사장님 확정 전 잠정치).
alter table public.subscription_plans add column if not exists monthly_ai_token_limit bigint;
update public.subscription_plans set monthly_ai_token_limit = 2000000  where slug = 'ultra';
update public.subscription_plans set monthly_ai_token_limit = 10000000 where slug = 'enterprise';
update public.subscription_plans set monthly_ai_token_limit = null      where slug in ('free','basic','starter','pro','business');

-- 2) AI 사용 로그 (기능·모델·토큰·비용추정·latency·상태·prompt_version). 원문/민감정보 없음.
create table if not exists public.ai_usage_log (
  id                uuid primary key default gen_random_uuid(),
  company_id        uuid not null references public.companies(id) on delete cascade,
  user_id           uuid,
  feature           text not null,
  model             text not null,
  input_tokens      integer not null default 0,
  output_tokens     integer not null default 0,
  cost_usd_estimate numeric,
  latency_ms        integer,
  status            text not null default 'ok',
  error_code        text,
  prompt_version    text,
  request_id        text,
  created_at        timestamptz not null default now()
);
create index if not exists ai_usage_log_company_created_idx on public.ai_usage_log (company_id, created_at desc);

-- 3) RLS — 회사 구성원은 자기 회사 로그만 조회. INSERT 는 서버(service_role, RLS 우회)만 — 클라 직접 기록 금지.
alter table public.ai_usage_log enable row level security;
drop policy if exists ai_usage_log_select_own_company on public.ai_usage_log;
create policy ai_usage_log_select_own_company on public.ai_usage_log
  for select to authenticated
  using (company_id = (select company_id from public.users where auth_id = auth.uid()));
-- INSERT/UPDATE/DELETE 정책 없음 → authenticated/anon 쓰기 불가(service_role 만 RLS 우회로 기록).

-- 4) 당월 회사 토큰 사용량 합계 헬퍼 (KST 월 기준). 상한 체크용.
create or replace function public.ai_tokens_used_this_month(p_company_id uuid)
returns bigint
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select coalesce(sum(input_tokens + output_tokens), 0)::bigint
  from public.ai_usage_log
  where company_id = p_company_id
    and created_at >= date_trunc('month', (now() at time zone 'Asia/Seoul')) at time zone 'Asia/Seoul';
$$;
revoke execute on function public.ai_tokens_used_this_month(uuid) from anon;
