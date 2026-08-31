-- 프로젝트 상세 개편 1단계 — 항목(project_items) 단일 모델 (2026-08-31)
--   기획: docs/20260831_PLAN_project_hub_bidirectional.md (결정 0 · 0-3 · 0-4 · 7-1 · 7-2 · 8-1 · 8-2 · 마이그레이션 표)
--
--   왜 이 모양인가: 지금은 프로젝트 안에 '표(project_boards) × 템플릿 8종'이 있고 값은
--   project_board_items.values 에 "칼럼 UUID → 값" 으로만 들어 있다. 화면마다 칼럼을 다시 해석해야 하고
--   담당·기한·금액을 회사 차원에서 모을 수 없다. 결정 0 은 개념을 둘(프로젝트 · 항목)로 줄인다 —
--   구분(kind) 3종 + 돈 구분(money_kind) 2종이 표 7종·보기 14종을 대신한다.
--
--   유실 0 원칙: 원본 project_board_boards/items 는 손대지 않는다(그 자체가 아카이브, 역마이그레이션 가능).
--   원본 값 전체는 fields 에 '칼럼 이름 → 값' 으로 보존하고, 구조화(status/assignee/due/plan_amount)는
--   best-effort 로만 채운다 — 해석이 틀려도 원본이 옆에 남아 있다.
--
--   배포 게이트: 데이터를 만드는 백필이므로 CLAUDE.md 규칙대로 feature_rollout 게이트로
--   모티브 오너뷰(c361afb9…)에만 먼저 적용한다. company_id null(전체 배포)은 사장님 확인 뒤 별도 마이그레이션.

-- ─────────────────────────────────────────────────────────────
-- A. project_items — 프로젝트 안의 모든 입력이 여기 한 표로 모인다
-- ─────────────────────────────────────────────────────────────
create table if not exists public.project_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  kind text not null check (kind in ('todo', 'money', 'note')),
  money_kind text check (money_kind in ('spend', 'revenue')),
  name text not null default '',
  -- 상태는 자유 문자열 — 프로젝트별 단계 정의(deals.item_stages)를 따른다(결정 0-3).
  -- 정의가 없으면 기본 흐름 todo/doing/done/hold.
  status text not null default 'todo',
  assignee_id uuid references public.users(id) on delete set null,   -- project_tasks.assignee_id 와 같은 대상
  followers uuid[] not null default '{}',                            -- 결정 7-1 팔로워
  start_date date,                                                   -- 결정 0-4 하루 또는 기간
  due_date date,
  tags text[] not null default '{}',                                 -- 결정 8-1 태그
  priority text check (priority in ('high', 'mid', 'low')),          -- 결정 8-1 우선순위
  is_milestone boolean not null default false,                       -- 결정 7-5 마일스톤(깃발)
  hours numeric,                                                     -- 결정 8-7 작업표(시간 기록)
  plan_amount numeric,                                               -- 예정 금액(확정은 장부가 갖는다)
  partner_id uuid references public.partners(id) on delete set null,
  partner_name text,                                                 -- 거래처 미등록/삭제 대비 이름 사본
  parent_id uuid references public.project_items(id) on delete cascade, -- 결정 7-2 하위작업
  fields jsonb not null default '{}'::jsonb,                         -- 결정 8-2 속성필드 값 + 이관 원본 칸 보존
  body text,                                                         -- 회의·메모 본문
  draft_ref jsonb,                                                   -- 결정 2 장부 초안 연결(이번엔 칸만)
  position numeric not null default 0,
  source_item_id uuid,                                               -- project_board_items 이관 원본 id = 멱등 키
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  constraint project_items_money_kind_ck check (
    (kind = 'money' and money_kind is not null) or (kind <> 'money' and money_kind is null)
  )
);

comment on table public.project_items is
  '프로젝트 항목 — 할 일/돈(지출·매출)/회의·메모를 한 표로. 2026-08-31 결정 0. 원본 표(project_board_items)는 아카이브로 남는다.';

create index if not exists project_items_deal_idx on public.project_items(deal_id);
create index if not exists project_items_company_idx on public.project_items(company_id);
create index if not exists project_items_assignee_idx on public.project_items(assignee_id) where assignee_id is not null;
create index if not exists project_items_parent_idx on public.project_items(parent_id) where parent_id is not null;
create unique index if not exists project_items_source_item_uk on public.project_items(source_item_id) where source_item_id is not null;

drop trigger if exists project_items_set_updated_at on public.project_items;
create trigger project_items_set_updated_at
  before update on public.project_items
  for each row execute function public.set_updated_at();

-- ─────────────────────────────────────────────────────────────
-- B. deals.item_stages — 프로젝트별 할 일 단계 정의 (결정 0-3)
--    null = 코드 기본 3단계. [{ "id": "todo", "label": "대기", "color": "#..." }, …]
-- ─────────────────────────────────────────────────────────────
alter table public.deals add column if not exists item_stages jsonb;
comment on column public.deals.item_stages is
  '프로젝트별 항목 단계 정의 [{id,label,color}]. null 이면 기본 3단계(대기·진행·완료) — 2026-08-31 결정 0-3.';

-- ─────────────────────────────────────────────────────────────
-- C. RLS — project_board_items 계승(회사 경계). 익명 접근 불가, 세무대리인 세션은 읽기 전용.
--    select/insert/update/delete 4종을 모두 명시한다(빠지면 기본 deny).
-- ─────────────────────────────────────────────────────────────
alter table public.project_items enable row level security;

drop policy if exists project_items_select on public.project_items;
create policy project_items_select on public.project_items
  for select to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists project_items_insert on public.project_items;
create policy project_items_insert on public.project_items
  for insert to authenticated
  with check (
    company_id = (select public.get_my_company_id())
    and exists (
      select 1 from public.deals d
      where d.id = deal_id and d.company_id = (select public.get_my_company_id())
    )
  );

drop policy if exists project_items_update on public.project_items;
create policy project_items_update on public.project_items
  for update to authenticated
  using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists project_items_delete on public.project_items;
create policy project_items_delete on public.project_items
  for delete to authenticated
  using (company_id = (select public.get_my_company_id()));

-- 세무대리인 세션 읽기 전용 (20260811200000_advisor_app_access.sql 과 같은 RESTRICTIVE 3종)
drop policy if exists advisor_ro_ins on public.project_items;
create policy advisor_ro_ins on public.project_items as restrictive for insert to authenticated
  with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.project_items;
create policy advisor_ro_upd on public.project_items as restrictive for update to authenticated
  using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.project_items;
create policy advisor_ro_del on public.project_items as restrictive for delete to authenticated
  using (not (select public.is_advisor_session()));

-- ─────────────────────────────────────────────────────────────
-- D. feature_on 을 클라이언트에서도 부를 수 있게 (읽기 전용 boolean)
-- ─────────────────────────────────────────────────────────────
grant execute on function public.feature_on(text, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- E. 게이트 — 모티브 오너뷰만. company_id null(전체 배포) 금지(CLAUDE.md).
-- ─────────────────────────────────────────────────────────────
insert into public.feature_rollout (feature, company_id, note)
values ('projecthub_items_v3', 'c361afb9-8a52-4cac-add9-8992f0f7c09c', '프로젝트 상세 개편 1단계 — 항목 모델(결정 0)')
on conflict (feature, company_id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- F. 백필 — project_boards/items → project_items (게이트가 켜진 회사만)
--    멱등: source_item_id 유니크 + on conflict do nothing. 원본은 읽기만 한다.
--    구조화 규칙(best-effort, 틀려도 fields 에 원본 보존):
--      status  : 상태/단계 이름의 status 칼럼 우선(없으면 첫 status 칼럼) → done/doing/hold/그 외 todo
--                ※ spend 보드의 첫 status 칼럼은 '구분'(비용 분류)이라 위치만 보면 상태가 아니다
--      assignee: '담당…' person 칼럼 우선(없으면 첫 person) — review 보드는 '요청자'가 앞에 온다
--      기간    : '시작/시작일' → start_date, 마감·기한·만기·종료·예정일 → due_date (결정 0-4)
--      금액    : money 구분만 예산·금액·계약금액 number → plan_amount (예정. 확정은 장부)
--      본문    : note 구분만 결정 내용·내용·본문·메모 text → body
--    ads · custom 템플릿은 이관 제외(실측 0행).
-- ─────────────────────────────────────────────────────────────
with src as (
  select i.id, i.board_id, i.group_id, i.parent_item_id, i.name, i.values, i.position,
         i.created_at, i.updated_at, i.archived_at,
         b.company_id, b.deal_id, b.template_key, b.name as board_name
    from public.project_board_items i
    join public.project_boards b on b.id = i.board_id
   where b.template_key in ('todo', 'review', 'schedule', 'contract', 'spend', 'revenue', 'meeting')
     and public.feature_on('projecthub_items_v3', b.company_id)
), pick as (
  select s.id as item_id,
         (select c.id from public.project_board_columns c
           where c.board_id = s.board_id and c.type = 'status'
           order by (case when c.name in ('상태', '단계') then 0 else 1 end), c.position limit 1) as status_col,
         (select c.id from public.project_board_columns c
           where c.board_id = s.board_id and c.type = 'person'
           order by (case when c.name like '담당%' then 0 else 1 end), c.position limit 1) as person_col,
         (select c.id from public.project_board_columns c
           where c.board_id = s.board_id and c.type = 'date' and c.name in ('시작', '시작일')
           order by c.position limit 1) as start_col,
         (select c.id from public.project_board_columns c
           where c.board_id = s.board_id and c.type = 'date' and c.name not in ('시작', '시작일')
           order by (case when c.name in ('마감', '기한', '만기', '종료', '예정일') then 0 else 1 end), c.position limit 1) as due_col,
         (select c.id from public.project_board_columns c
           where c.board_id = s.board_id and c.type = 'number'
           order by (case when c.name in ('예산', '금액', '계약금액') then 0 else 1 end), c.position limit 1) as amount_col,
         (select c.id from public.project_board_columns c
           where c.board_id = s.board_id and c.type = 'partner'
           order by c.position limit 1) as partner_col,
         (select c.id from public.project_board_columns c
           where c.board_id = s.board_id and c.type = 'text'
           order by (case when c.name in ('결정 내용', '내용', '본문', '메모') then 0 else 1 end), c.position limit 1) as body_col
    from src s
), mapped as (
  select s.*,
         case when s.template_key in ('spend', 'revenue') then 'money'
              when s.template_key = 'meeting' then 'note'
              else 'todo' end as kind,
         case when s.template_key = 'spend' then 'spend'
              when s.template_key = 'revenue' then 'revenue' end as money_kind,
         nullif(trim(s.values ->> (p.status_col::text)), '') as raw_status,
         nullif(trim(s.values ->> (p.person_col::text)), '') as raw_person,
         nullif(trim(s.values ->> (p.start_col::text)), '') as raw_start,
         nullif(trim(s.values ->> (p.due_col::text)), '') as raw_due,
         nullif(trim(s.values ->> (p.amount_col::text)), '') as raw_amount,
         nullif(trim(s.values ->> (p.partner_col::text)), '') as raw_partner,
         nullif(trim(s.values ->> (p.body_col::text)), '') as raw_body,
         -- 유실 0: values 전체를 '칼럼 이름 → 값' 으로 보존(칼럼을 못 찾은 __ 키는 키 그대로) + 원본 좌표
         (select coalesce(jsonb_object_agg(coalesce(c.name, e.key), e.value), '{}'::jsonb)
            from jsonb_each(s.values) e
            left join public.project_board_columns c
                   on c.board_id = s.board_id and c.id::text = e.key) as base_fields
    from src s
    join pick p on p.item_id = s.id
)
insert into public.project_items (
  company_id, deal_id, kind, money_kind, name, status, assignee_id,
  start_date, due_date, plan_amount, partner_id, partner_name,
  fields, body, position, source_item_id, created_at, updated_at, archived_at
)
select m.company_id,
       m.deal_id,
       m.kind,
       m.money_kind,
       coalesce(m.name, ''),
       case
         when m.raw_status is null then 'todo'
         when m.raw_status ilike '%done%' then 'done'
         when m.raw_status ilike '%doing%' or m.raw_status ilike '%prog%' then 'doing'
         when m.raw_status ilike '%hold%' then 'hold'
         else 'todo'
       end,
       (select u.id from public.users u where u.id::text = m.raw_person and u.company_id = m.company_id),
       case when m.raw_start ~ '^\d{4}-\d{2}-\d{2}' then substring(m.raw_start from 1 for 10)::date end,
       case when m.raw_due ~ '^\d{4}-\d{2}-\d{2}' then substring(m.raw_due from 1 for 10)::date end,
       case when m.kind = 'money' and m.raw_amount ~ '^-?\d+(\.\d+)?$' then m.raw_amount::numeric end,
       (select pt.id from public.partners pt where pt.id::text = m.raw_partner and pt.company_id = m.company_id),
       (select pt.name from public.partners pt where pt.id::text = m.raw_partner and pt.company_id = m.company_id),
       m.base_fields || jsonb_build_object('__origin', jsonb_build_object(
         'board_id', m.board_id, 'board_name', m.board_name, 'template_key', m.template_key,
         'group_id', m.group_id, 'parent_item_id', m.parent_item_id)),
       case when m.kind = 'note' then m.raw_body end,
       m.position,
       m.id,
       m.created_at,
       m.updated_at,
       m.archived_at
  from mapped m
on conflict (source_item_id) where source_item_id is not null do nothing;

-- 하위작업 부모 연결 (원본 순서 무관 — 이관이 끝난 뒤 self-join 으로 2-pass)
update public.project_items child
   set parent_id = parent.id
  from public.project_board_items o
  join public.project_items parent on parent.source_item_id = o.parent_item_id
 where child.source_item_id = o.id
   and o.parent_item_id is not null
   and child.parent_id is distinct from parent.id;
