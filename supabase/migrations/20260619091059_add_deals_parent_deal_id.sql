-- 세부 프로젝트(캠페인 속 캠페인): deals 자기참조 부모. 2단계 중첩.
-- 부모 삭제 시 자식은 최상위로 승격(set null) — 자식 데이터(견적/계약/손익) 보존.
--
-- 주: 이 변경은 다른 환경에서 MCP로 프로덕션(njbvdkuvtdtkxyylwngn)에 직접 적용되었으나
--     마이그레이션 파일이 커밋되지 않았다. 프로덕션 schema_migrations 에는
--     version 20260619091059 / name add_deals_parent_deal_id 로 이미 기록되어 있어
--     이 파일은 그 정의를 버전관리에 박제하는 용도다(멱등 — 재실행 안전).

alter table public.deals
  add column if not exists parent_deal_id uuid;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.deals'::regclass
      and contype = 'f'
      and conname = 'deals_parent_deal_id_fkey'
  ) then
    alter table public.deals
      add constraint deals_parent_deal_id_fkey
      foreign key (parent_deal_id) references public.deals(id) on delete set null;
  end if;
end $$;

create index if not exists idx_deals_parent_deal_id
  on public.deals(parent_deal_id) where parent_deal_id is not null;

comment on column public.deals.parent_deal_id is
  '세부 프로젝트(캠페인)용 자기참조 부모 deal. NULL이면 최상위 프로젝트. 2단계만 사용(부모는 다시 부모를 갖지 않음).';
