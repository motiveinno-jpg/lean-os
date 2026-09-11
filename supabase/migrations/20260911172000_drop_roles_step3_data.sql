-- 역할을 완전히 없앤다 — 3단계: 값 자체를 정리한다 (2026-09-11 사장님).
--   users.role 에 남아 있던 owner/admin/employee 를 'member' 하나로 합친다.
--   구분은 is_master 뿐이고, 무엇을 할 수 있는지는 member_permissions 가 정한다.
--   partner 는 남긴다 — 역할이 아니라 **계정 종류**다(외부 협력사 계정). 세무사는 users 행 자체가 없다.
--   앞선 1·2단계에서 role 을 보던 함수 11개와 정책 19개를 모두 마스터+권한으로 바꿔 둔 뒤라
--   이 정리로 잃는 권한은 없다. 실측: owner 8명은 전원 마스터, admin 3명은 필요한 권한을 모두 보유.
begin;

--   제약을 먼저 내린다 — 옛 제약이 'member' 를 막는다.
alter table public.users drop constraint if exists users_role_check;

--   기본값이 'staff' 였는데 제약에 없는 값이라 role 을 빼고 넣으면 실패했다. 같이 바로잡는다.
alter table public.users alter column role set default 'member';

update public.users set role = 'member' where role is null or role not in ('partner');

alter table public.users add constraint users_role_check
  check (role = any (array['member'::text, 'partner'::text]));

comment on column public.users.role is
  '계정 종류 — member(우리 회사 사람) 또는 partner(외부 협력사). 대표·관리자·직원 구분은 2026-09-11 에 없앴다. 권한은 member_permissions 로, 마스터 여부는 is_master 로 정한다.';

commit;
