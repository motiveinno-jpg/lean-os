-- 회사 설정 › 재고 기준 탭 권한 백필 (2026-09-22 재고 점검 G, docs/20260922_PLAN_inventory_audit_v2.md)
-- 새 부여 키 '/settings:inventory' 는 member_permissions 에 행이 없으면 마스터 외 아무에게도 안 보인다.
-- 백필 기준: 이익관리 원가 방법·재계산(/inventory/profit:write)을 하던 사람 — 이 탭이 그 값을 옮겨 받았다. (전례: 20260918100000)
begin;
insert into public.member_permissions (company_id, user_id, perm_key, granted_by, granted_at)
select mp.company_id, mp.user_id, '/settings:inventory', null, now()
from public.member_permissions mp
where mp.perm_key = '/inventory/profit:write'
  and not exists (
    select 1 from public.member_permissions x
    where x.user_id = mp.user_id and x.perm_key = '/settings:inventory'
  );
commit;
