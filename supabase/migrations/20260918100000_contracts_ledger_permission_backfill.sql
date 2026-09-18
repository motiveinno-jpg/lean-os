-- 계약 대장 메뉴 권한 백필 (2026-09-18, docs/20260917_PLAN_menu_gap_audit.md 결정 2-2단계)
-- 새 권한 키 '/contracts' 는 member_permissions 에 행이 없으면 마스터 외 아무에게도 안 보인다.
-- 백필 기준: 전자계약(/signatures) 권한 보유자 — 계약 문서를 다루던 사람이 대장도 본다.
--   (2026-09-11 역할 폐지 후 role 기준 백필은 못 쓴다. 전례: 20260821110000, 20260827140000)
begin;
insert into public.member_permissions (company_id, user_id, perm_key, granted_by, granted_at)
select mp.company_id, mp.user_id, '/contracts', null, now()
from public.member_permissions mp
where mp.perm_key = '/signatures'
  and not exists (
    select 1 from public.member_permissions x
    where x.user_id = mp.user_id and x.perm_key = '/contracts'
  );
commit;
