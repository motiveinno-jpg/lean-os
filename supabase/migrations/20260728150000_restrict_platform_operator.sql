-- 운영자 권한을 creative@mo-tive.com 단일 계정으로 제한 (2026-07-28 사장님 지시)
--
-- 기존: auth.jwt()->>'email' ~* '@mo-tive\.com$'  — 도메인 전체
--   → 2026-07-28 기준 11개 계정이 운영자였다. 그중 6명이 일반 직원(employee)이고
--     QA 테스트 계정(qa-ownerview-test@mo-tive.com)까지 포함.
--     같은 날 추가한 운영자 SELECT 정책과 맞물리면 이 계정들이 전 고객사의
--     회사·사용자·구독·매출 데이터를 조회할 수 있는 상태였다.
--
-- 변경: 정확히 creative@mo-tive.com 하나만 허용.
--   운영자를 늘려야 하면 아래 배열에 이메일을 추가하고 재배포한다
--   (권한 확대가 코드 리뷰·마이그레이션 기록에 남도록 의도적으로 하드코딩).
--   ⚠️ 클라이언트 게이트 2곳도 함께 바꿀 것:
--      src/app/platform/layout.tsx, src/app/(app)/announcements/page.tsx
--
-- 검증(2026-07-28): creative@ 및 대소문자 변형만 true(19개사 조회),
--   lkw@·ksc@·qa-ownerview-test@ 및 유사도메인(creative@mo-tive.com.evil.kr,
--   x@sub.mo-tive.com) 전부 false(0건). 정확 일치라 우회 불가.
--   ※ 이미 MCP 로 prod 적용됨 — 이 파일은 저장소 기록용.

create or replace function public.is_platform_operator()
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select lower(coalesce(auth.jwt() ->> 'email', '')) = any (array[
    'creative@mo-tive.com'
  ]);
$function$;

comment on function public.is_platform_operator() is
  '플랫폼 운영자 판정 — 허용 이메일 정확 일치. 2026-07-28 이전에는 @mo-tive.com 도메인 전체를 허용해 직원 11명이 전 고객사 데이터를 볼 수 있었다.';
