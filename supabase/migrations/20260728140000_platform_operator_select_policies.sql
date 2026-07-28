-- 운영자 전용 SELECT 정책 (2026-07-28)
--   증상: 운영자 페이지 "총 가입사"가 실제 18개사인데 1로 표시. 신규 가입사가 안 보임.
--   원인: companies/users/subscriptions 등의 SELECT 정책이 전부 "내 회사만"
--         (id = get_my_company_id()) 뿐이고 운영자 예외가 없었다.
--         → 운영자도 자기 회사 1건만 조회돼 플랫폼 지표가 통째로 자기 데이터였음.
--   조치: is_platform_operator() 인 경우에만 전체 조회를 허용하는 정책을 별도 추가.
--         기존 정책은 건드리지 않는다(일반 사용자 동작 무변경). 복수 permissive
--         정책은 OR 로 합쳐지므로 일반 사용자는 여전히 자기 회사만 본다.
--   ⚠️ SELECT 전용. 운영자에게 쓰기 권한을 주지 않는다.
--   검증(2026-07-28): 운영자 JWT → 19개사/31명/9구독, 외부 gmail → 0/0/0,
--                     일반 직원 → 자기 회사 1건만. 격리 유지 확인.
--   ※ 이미 MCP 로 prod 적용됨 — 이 파일은 저장소 기록용.

do $$
declare
  t text;
begin
  foreach t in array array[
    'companies','users','subscriptions','subscription_plans','invoices','feedback','error_logs'
  ] loop
    execute format('drop policy if exists %I on public.%I', t || '_select_operator', t);
    execute format(
      'create policy %I on public.%I for select to authenticated using (public.is_platform_operator())',
      t || '_select_operator', t);
  end loop;
end $$;

comment on table public.companies is
  '운영자(is_platform_operator)는 companies_select_operator 정책으로 전체 조회 가능 — 플랫폼 대시보드용. 일반 사용자는 자기 회사만.';
