-- 거래처 고정 코드(partners.code) — 매입/매출/원장/관리 전 화면에서 통일된 거래처 번호.
-- 기존: 거래처원장이 화면 행 순번(idx+1)을 번호로 써서 매입/매출 탭마다 달랐음.

alter table partners add column if not exists code integer;

-- 기존 거래처 백필: 회사별 created_at(동률 id) 순서로 1,2,3...
with ranked as (
  select id, row_number() over (partition by company_id order by created_at, id) as rn
  from partners
)
update partners p
set code = r.rn
from ranked r
where p.id = r.id and p.code is null;

-- 신규 거래처 INSERT 시 회사별 다음 코드 자동 부여 (함수 본문 ASCII only)
create or replace function partners_assign_code()
returns trigger
language plpgsql
as $$
begin
  if new.code is null then
    select coalesce(max(code), 0) + 1 into new.code
    from partners where company_id = new.company_id;
  end if;
  return new;
end;
$$;

drop trigger if exists trg_partners_assign_code on partners;
create trigger trg_partners_assign_code
  before insert on partners
  for each row execute function partners_assign_code();
