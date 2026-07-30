-- 로컬 전용 시드 — supabase CLI(supabase start / db reset)만 이 파일을 실행한다. 운영·스테이징 무관.
-- (2026-07-30 로컬 테스트 서버 구축)

-- 1) 권한 정정: CLI 부트스트랩은 마이그레이션을 supabase_admin 으로 적용해
--    postgres 롤의 default privileges 가 안 붙는다(운영은 대시보드/CLI push 가 postgres 로 적용돼 자동 부여).
--    → anon/authenticated/service_role 권한을 운영과 동일하게 일괄 부여.
grant usage on schema public to anon, authenticated, service_role;
grant all on all tables in schema public to anon, authenticated, service_role;
grant all on all sequences in schema public to anon, authenticated, service_role;
grant execute on all functions in schema public to anon, authenticated, service_role;
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on sequences to anon, authenticated, service_role;
alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;

-- 운영과 동일한 보안 상태 유지: 자격증명 암복호화 함수는 anon/PUBLIC 회수 (20260728050000 참조)
revoke execute on function public.encrypt_credential(text) from public, anon;
revoke execute on function public.decrypt_credential(text) from public, anon;
revoke execute on function public.encrypt_json_credentials(jsonb) from public, anon;
revoke execute on function public.decrypt_json_credentials(jsonb) from public, anon;

-- 2) 테스트 계정 — owner@local.test / local1234!
--    (auth.users 직접 삽입은 로컬 GoTrue 에서 지원되는 표준 시드 방식)
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at
) values (
  '00000000-0000-0000-0000-000000000000',
  'd3a22eb4-a91c-451b-8dd0-3325f85da3f4',
  'authenticated', 'authenticated', 'owner@local.test',
  crypt('local1234!', gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}', '{}', now(), now()
) on conflict (id) do nothing;

insert into auth.identities (
  id, user_id, provider_id, identity_data, provider, last_sign_in_at, created_at, updated_at
) values (
  gen_random_uuid(),
  'd3a22eb4-a91c-451b-8dd0-3325f85da3f4',
  'd3a22eb4-a91c-451b-8dd0-3325f85da3f4',
  '{"sub":"d3a22eb4-a91c-451b-8dd0-3325f85da3f4","email":"owner@local.test","email_verified":true}',
  'email', now(), now(), now()
) on conflict do nothing;

-- public 연결(회사/유저 행)은 앱의 로그인 safety-net(company-setup)이 만들거나,
-- 첫 로그인 후 화면에서 회사 개설로 생성된다 — 여기서 강제하지 않는다.
