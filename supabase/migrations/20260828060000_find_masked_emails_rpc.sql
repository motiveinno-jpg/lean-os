-- 이메일 찾기 RPC (2026-08-28 운영자 누수 전수점검).
--   기존 /auth/find-email 은 브라우저에서 users 를 이름 ilike 로 직접 조회했다 —
--   익명은 RLS 로 항상 0건(기능이 사실상 죽어 있었음)이고, 로그인 사용자는 자기 회사 동명이,
--   운영자(creative@)는 users_select_operator 예외로 **전 고객사 명단**이 검색됐다.
--   서버측 RPC 로 이전: 이름 정확 일치(부분검색 금지 — 열거 방지) + 서버에서 마스킹 + 최대 5건.
--   원문 email 은 절대 반환하지 않는다. 익명 실행 허용(이메일 찾기의 본래 의도).
create or replace function public.find_masked_emails_by_name(p_name text)
returns text[]
language sql
stable
security definer
set search_path to 'public'
as $$
  select coalesce(array_agg(
    case when position('@' in u.email) > 1
      then left(split_part(u.email, '@', 1), 1) || '***@' || split_part(u.email, '@', 2)
      else '***' end), '{}')
  from (
    select email from public.users
    where trim(name) = trim(coalesce(p_name, '')) and coalesce(email, '') <> ''
    limit 5
  ) u;
$$;

grant execute on function public.find_masked_emails_by_name(text) to anon, authenticated;
