-- 직원 초대 role 제약을 역할 폐지(20260911) 이후 값에 맞춘다.
--
-- 앱은 초대를 만들 때 role='member' 를 넣고(lib/invitations.ts), 수락 API 도 초대의 role 값을
-- 읽지 않고 멤버로 합류시킨다. 그런데 employee_invitations.role 의 CHECK 는 아직
-- ('employee','admin') 이라 개별 초대·엑셀 일괄 초대의 첫 insert 가 전부
-- "violates check constraint employee_invitations_role_check" 로 거절됐다.
--
-- users.role 과 같은 어휘('member')로 맞추고, 남아 있던 옛 값도 member 로 정리한다.
begin;

alter table public.employee_invitations drop constraint if exists employee_invitations_role_check;

update public.employee_invitations set role = 'member' where role is distinct from 'member';

alter table public.employee_invitations alter column role set default 'member';

alter table public.employee_invitations
  add constraint employee_invitations_role_check check (role = 'member');

commit;
