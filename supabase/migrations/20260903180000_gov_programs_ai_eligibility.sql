-- 지원사업 자격 정밀 판정 (2026-09-03 사장님: "터무니없는 것도 가능성 높음으로 나온다 — 제대로 구별")
--   공고 원문(기업마당 상세 본문)을 저장하고, AI(Gemini 무료 등급)가 자격 조건표(eligibility_ai)를 만든다.
--   화면 판정(lib/support-programs.ts judge)은 조건표가 있으면 그것으로 엄격하게 대조한다.
alter table public.gov_programs
  add column if not exists detail_text text,
  add column if not exists detail_fetched_at timestamptz,
  add column if not exists eligibility_ai jsonb,
  add column if not exists eligibility_ai_at timestamptz,
  add column if not exists eligibility_ai_model text;
create index if not exists gov_programs_enrich_pending_idx on public.gov_programs (status, apply_end) where eligibility_ai is null;

-- 크론 → 엣지 함수 인증용 비밀값 (금고에 보관, 엣지 비밀값 GOV_ENRICH_SECRET 과 같은 값)
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'gov_enrich_secret') then
    perform vault.create_secret('5aa7e233272618ba379eca7bd0b6bde3a9ff9fab7af6738b', 'gov_enrich_secret', 'gov-programs-enrich 크론 호출 인증 (2026-09-03)');
  end if;
end $$;

-- 5분마다 조금씩 처리(무료 등급 분당 한도 안에서). 할 일이 없으면 바로 끝난다.
do $$ begin
  if exists (select 1 from cron.job where jobname = 'gov-programs-enrich') then perform cron.unschedule('gov-programs-enrich'); end if;
end $$;
select cron.schedule(
  'gov-programs-enrich',
  '*/5 * * * *',
  $$
  select net.http_post(
    url := 'https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/gov-programs-enrich',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'gov_enrich_secret')),
    body := '{}'::jsonb
  );
  $$
);
