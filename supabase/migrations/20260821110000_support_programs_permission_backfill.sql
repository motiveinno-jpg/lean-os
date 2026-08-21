-- 지원사업 메뉴 권한 백필 (2026-08-21)
--
-- AS_IS — 새 메뉴를 만들고 PERMISSION_CATALOG 에 넣기만 하면 **마스터 외에는 아무에게도 안 보인다.**
--   hasPerm 은 `always` 목록에 있거나 member_permissions 에 행이 있어야 통과하는데,
--   신규 라우트는 둘 다 없기 때문이다. 실제로 프로덕션에서 대표 계정이 /support-programs 로 들어가면
--   메뉴가 안 보이고 대시보드로 튕겼다.
--
-- TO_BE — 이미 대표·관리자 역할인 구성원에게 '/support-programs' 를 부여한다.
--   ★ always(전원 기본)로 열지 않는 이유 — 이 화면은 직원 생년월일·급여로 고용장려금 자격을 판정한다.
--     인사 정보를 읽는 화면이므로 전원 기본은 맞지 않고, 역할이 대표·관리자인 사람에게만 준다.
--   앞으로 들어오는 구성원은 회사 설정 > 권한에서 종전대로 부여한다(카탈로그에 이미 올라가 있다).
--
-- 전례: 20260811_voucher_split_general_sale_purchase.sql (전표 분리 때 같은 방식으로 백필했다).
-- 되돌리기: delete from member_permissions where perm_key = '/support-programs';

insert into public.member_permissions (company_id, user_id, perm_key, granted_by, granted_at)
select u.company_id, u.id, '/support-programs', null, now()
from public.users u
where u.company_id is not null
  and u.role in ('owner', 'admin')
  and not exists (
    select 1 from public.member_permissions x
    where x.user_id = u.id and x.perm_key = '/support-programs'
  );
