-- SECURITY DEFINER 함수 EXECUTE 회수 (2026-09-17 보안 스윕 1차)
-- 배경: Supabase 어드바이저 실측 — anon 이 REST(/rest/v1/rpc/…)로 실행할 수 있는
--   SECURITY DEFINER 함수 95개(authenticated 268개). Supabase 는 새 함수에 EXECUTE 를
--   anon·authenticated 에 기본 부여하므로, 명시적으로 회수하지 않은 함수가 쌓여 있었다.
--   (9/10 감사가 apply_toss_payment_void 에 한 revoke 를 전 함수로 확장하는 작업.)
--
-- 회수 범위 — 세 갈래만, 나머지는 의도된 공개라 손대지 않는다:
--  ① 트리거 함수 전부(45개+): PostgREST 는 트리거 함수의 RPC 호출을 거부하고,
--     트리거 발화는 호출자의 EXECUTE 를 검사하지 않는다(생성 시점 검사) → 회수해도 런타임 영향 0.
--     이름을 나열하지 않고 카탈로그에서 골라 돈다 — 오타·누락 방지, 이후 생긴 트리거도 재실행 시 잡힘.
--  ② company_notify_users(uuid, text[]): DB 내부(definer 함수·트리거 본문)에서만 쓰는 헬퍼인데
--     가드가 없어 anon 이 임의 회사의 사용자 UUID 를 열거할 수 있었다. 내부 호출은 definer
--     소유자 권한으로 EXECUTE 를 검사하므로 앱 역할에서 전부 회수해도 동작 불변.
--  ③ anon 만 회수(로그인 화면이 authenticated 로 호출하거나 DB 내부용):
--     current_plan_slug · get_company_plan_slug · leave_accrual_enabled ·
--     operator_add/list/remove_email_optout(is_platform_operator 가드 있음 — 심층 방어).
--
-- 건드리지 않는 것(의도된 공개·필수):
--  · RLS 헬퍼(has_perm·is_company_admin·get_my_company_id 등 28개) — 정책 식이 조회 역할의
--    권한으로 함수를 실행하므로 회수하면 해당 테이블 조회가 전부 깨진다.
--  · 토큰 공개 RPC(get_*_by_token·submit_quote_decision·validate_invite_token·portal_leave_message·
--    mark_*_viewed·increment_share_view_count) — 외부 견적·서명·포털 링크가 anon 으로 호출.
--  · pgrst_session_gate — PostgREST db_pre_request. 회수하면 모든 REST 요청이 죽는다.
--  · find_masked_emails_by_name(아이디 찾기) · sales_code_bonus_days(가입 추천 코드) — 공개 흐름.
--
-- ⚠️ 이 회수 뒤에도 위 세 범주 밖 함수 8개가 anon 에 남아 있다 (보안 게이트 2026-09-17 실측):
--   can_read_invoices·can_read_ledger·can_write_ledger·has_any_finance_perm·has_any_settings_perm·
--   is_company_manager·is_user_assigned_to_deal(전부 auth.uid() 파생이라 anon 은 항상 false — 실위험 없음)
--   + company_storage_quota(가드가 storage_quota_params 안에만 있어 방어 1겹 — 후속 회수 대상).
--   원인: 20260909200000_security_secdef_execute.sql 이 정책 본문에 이름이 등장하면 정책의 TO 절
--   (polroles)을 보지 않고 anon 에 grant 를 자동 재부여한다. 이 8개를 회수하려면 그 로직부터
--   고쳐야 한다(안 고치면 다음 정책 스윕 때 조용히 되돌아간다 — is_user_assigned_to_deal 이
--   20260521080001 에서 회수됐다가 9/09 에 실제로 되살아난 전례).
begin;

-- ① 트리거 함수 일괄 회수 (service_role·postgres 부여는 그대로 둔다)
do $$
declare r record;
begin
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and p.prorettype = 'trigger'::regtype
      and (has_function_privilege('anon', p.oid, 'EXECUTE')
           or has_function_privilege('authenticated', p.oid, 'EXECUTE'))
  loop
    execute format('revoke execute on function %s from public, anon, authenticated', r.fn);
  end loop;
end $$;

-- ② 내부 전용 헬퍼 — 앱 역할 전부 회수
revoke execute on function public.company_notify_users(uuid, text[]) from public, anon, authenticated;

-- ③ anon 만 회수
revoke execute on function public.current_plan_slug(uuid) from anon;
revoke execute on function public.get_company_plan_slug() from anon;
revoke execute on function public.leave_accrual_enabled(uuid) from anon;
revoke execute on function public.operator_add_email_optout(text, text, text) from anon;
revoke execute on function public.operator_list_email_optouts(integer, text) from anon;
revoke execute on function public.operator_remove_email_optout(text) from anon;

commit;
