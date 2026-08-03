-- 프로젝트 참여자 — 대표담당자 한 명 대신 여럿(2026-08-03 사장님 지시).
--   "대체로 여러 인원이 프로젝트를 수행하는데 대표담당자가 있는 게 별로다.
--    담당자를 다중선택하게, 부서를 선택하면 부서에 속한 인원이 자동 태그되게."
--   deals.internal_manager_id 는 다른 화면(리포트·정산)이 쓰므로 컬럼은 그대로 두고,
--   프로젝트 화면에서는 이 표를 진실로 삼는다. 기존 담당자는 참여자로 백필한다.
--   부서는 인사 데이터(employees.department)를 그대로 쓴다 — 프로젝트용 부서를 따로 만들지 않는다.
create table if not exists project_members (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  deal_id uuid not null references deals(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  -- 어느 부서를 통째로 넣어서 들어왔는지 기록해 둔다(그 부서 인원이 바뀌면 다시 넣을 때 참고)
  added_via_department text,
  created_at timestamptz not null default now(),
  unique (deal_id, user_id)
);

create index if not exists project_members_deal_idx on project_members(deal_id);
create index if not exists project_members_user_idx on project_members(company_id, user_id);

alter table project_members enable row level security;

drop policy if exists project_members_rw on project_members;
create policy project_members_rw on project_members
  for all using (company_id = get_my_company_id()) with check (company_id = get_my_company_id());

-- 백필 — 기존 대표담당자를 참여자로 옮긴다('내 담당' 필터가 끊기지 않게)
insert into project_members (company_id, deal_id, user_id)
select d.company_id, d.id, d.internal_manager_id
from deals d
where d.internal_manager_id is not null
on conflict (deal_id, user_id) do nothing;
