-- 오늘 기능 전체 배포 (2026-08-27 사장님 승인: "오늘 것 전체 오너뷰 기능으로 배포, 고정자산 권한 백필도")
--   feature_rollout company_id null = 전체. 게이트 코드는 그대로(다음 기능도 같은 길: 모티브 먼저 → 승인 → 여기 한 줄).
insert into public.feature_rollout (feature, company_id, note) values
  ('closing_drafts', null, '전체 배포 2026-08-27 사장님 승인'),
  ('contract_invoice_drafts', null, '전체 배포 2026-08-27 사장님 승인'),
  ('biz_alerts', null, '전체 배포 2026-08-27 사장님 승인'),
  ('fixed_assets_menu', null, '전체 배포 2026-08-27 사장님 승인')
on conflict do nothing;
-- 재무 › 고정자산 권한 — 모든 회사의 대표·관리자 (전례 20260821110000)
insert into public.member_permissions (company_id, user_id, perm_key, granted_by, granted_at)
select u.company_id, u.id, '/finance/assets', null, now()
from public.users u
where u.company_id is not null and u.role in ('owner', 'admin')
  and not exists (select 1 from public.member_permissions x where x.user_id = u.id and x.perm_key = '/finance/assets');
