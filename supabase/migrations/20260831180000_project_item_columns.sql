-- 프로젝트 v3 1단계 — 커스텀 컬럼 정의 (2026-08-31)
--   기획: docs/20260831_PLAN_projecthub_v3_impl.md 결정 131 · 134 · 136
--
--   왜 이 표가 필요한가: v2.6(20260831140000)이 옛 표(project_board_items)의 값을
--   project_items.fields 에 '칼럼 이름 → 값' 으로 보존했다. 값은 있는데 "이 키가 무슨 타입이고
--   선택지가 무엇인지"를 아는 곳이 없다 — v3 표 UI 가 셀을 그릴 수 없다. 그 정의를 여기 둔다.
--   내장 4컬럼(이름·담당·상태·마감)은 코드가 알고, 이 표에는 커스텀 컬럼만 산다(결정 131).
--   값은 여전히 project_items.fields[key] — 이 표는 정의만 갖는다(값 이동 없음).
--
--   배포 게이트: 데이터를 만드는 백필이므로 CLAUDE.md 규칙대로 모티브 오너뷰(c361afb9…)에만
--   먼저 넣는다. 다른 회사(항목 17건)는 전체 오픈 때 같은 백필로(결정 136).

-- ─────────────────────────────────────────────────────────────
-- A. project_item_columns — deal 별 커스텀 컬럼 정의
-- ─────────────────────────────────────────────────────────────
create table if not exists public.project_item_columns (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  deal_id uuid not null references public.deals(id) on delete cascade,
  key text not null,                 -- project_items.fields 의 키 (v2.6 이관이 '칼럼 이름'을 키로 썼다)
  name text not null,                -- 표시 이름 (보통 key 와 같음 — 이름만 바꿔도 값은 key 로 붙어 있다)
  type text not null check (type in ('text','number','date','select','person','partner')),  -- lib/project-items.ts FieldType
  settings jsonb not null default '{}'::jsonb,   -- select 옵션 [{id,label,color}] 등
  position numeric not null default 0,
  width int,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (deal_id, key)
);

comment on table public.project_item_columns is
  '프로젝트 항목 커스텀 컬럼 정의 — 값은 project_items.fields[key]. 내장 4컬럼(이름·담당·상태·마감)은 코드가 안다. 2026-08-31 결정 131.';

create index if not exists project_item_columns_deal_idx
  on public.project_item_columns(deal_id) where archived_at is null;

-- ─────────────────────────────────────────────────────────────
-- B. RLS — project_items(20260831140000) 와 같은 회사 경계. 4종 명시(빠지면 기본 deny).
--    세무대리인 세션은 읽기 전용(RESTRICTIVE 3종) — 같은 문법.
-- ─────────────────────────────────────────────────────────────
alter table public.project_item_columns enable row level security;

drop policy if exists project_item_columns_select on public.project_item_columns;
create policy project_item_columns_select on public.project_item_columns
  for select to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists project_item_columns_insert on public.project_item_columns;
create policy project_item_columns_insert on public.project_item_columns
  for insert to authenticated
  with check (
    company_id = (select public.get_my_company_id())
    and exists (
      select 1 from public.deals d
      where d.id = deal_id and d.company_id = (select public.get_my_company_id())
    )
  );

drop policy if exists project_item_columns_update on public.project_item_columns;
create policy project_item_columns_update on public.project_item_columns
  for update to authenticated
  using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists project_item_columns_delete on public.project_item_columns;
create policy project_item_columns_delete on public.project_item_columns
  for delete to authenticated
  using (company_id = (select public.get_my_company_id()));

drop policy if exists advisor_ro_ins on public.project_item_columns;
create policy advisor_ro_ins on public.project_item_columns as restrictive for insert to authenticated
  with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.project_item_columns;
create policy advisor_ro_upd on public.project_item_columns as restrictive for update to authenticated
  using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.project_item_columns;
create policy advisor_ro_del on public.project_item_columns as restrictive for delete to authenticated
  using (not (select public.is_advisor_session()));

-- ─────────────────────────────────────────────────────────────
-- C. 게이트 — 모티브 오너뷰만. company_id null(전체 배포) 금지(CLAUDE.md).
-- ─────────────────────────────────────────────────────────────
insert into public.feature_rollout (feature, company_id, note)
values ('projecthub_v3', 'c361afb9-8a52-4cac-add9-8992f0f7c09c', '프로젝트 v3 표 UI — 1단계(결정 134)')
on conflict (feature, company_id) do nothing;

-- ─────────────────────────────────────────────────────────────
-- D. 백필 — 모티브에서 실제로 쓰인 fields 키 → 컬럼 정의 (값은 건드리지 않는다)
--    타입 추정: 옛 칼럼 표(project_board_columns)를 '이름'으로 조인. 못 찾으면 text.
--      (실측: 모티브에서 한 프로젝트 안 같은 이름의 칼럼이 타입이 갈리는 경우는 0건)
--    옵션(select): 한 프로젝트에 표가 여러 개(A커머스 23개)라 같은 '상태' 이름이 표마다 다른 선택지를
--      갖는다. 실제 값도 todo/doing/done · req/check · review/signed/running/renew/closed 가 뒤섞여
--      한 표의 옵션만 베끼면 나머지 값이 이름 없는 칩이 된다 → id 기준 합집합(먼저 나온 라벨·색 우선).
--    제외: '__' 로 시작하는 내부 키(__origin · __quote · __contract · __todo_item)는 사용자 칼럼이 아니다.
--    ※ '상태'·'담당'·'마감' 처럼 v2.6 이 구조화 칸(status/assignee_id/due_date)으로도 옮긴 키는
--      정의가 같이 만들어진다(원본 보존 키라 값이 fields 에 남아 있다). 내장 컬럼과 겹쳐 보이지 않게
--      하는 것은 화면 몫 — 정의를 지우면 원본 해석이 사라지므로 여기서는 남긴다.
--    멱등: unique (deal_id, key) + on conflict do nothing. 두 번 돌려도 사람이 고친 정의를 덮지 않는다.
-- ─────────────────────────────────────────────────────────────
with used as (
  select pi.company_id, pi.deal_id, f.key
    from public.project_items pi
    cross join lateral jsonb_object_keys(pi.fields) as f(key)
   where pi.company_id = 'c361afb9-8a52-4cac-add9-8992f0f7c09c'
     and left(f.key, 2) <> '__'
   group by 1, 2, 3
), col as (
  select pb.deal_id, pbc.name, pbc.type, pbc.settings, pbc.position, pbc.created_at, pbc.archived_at
    from public.project_board_columns pbc
    join public.project_boards pb on pb.id = pbc.board_id
   where pb.company_id = 'c361afb9-8a52-4cac-add9-8992f0f7c09c'
), pick as (
  select u.company_id, u.deal_id, u.key,
         coalesce((
           select case c.type
                    when 'number'  then 'number'
                    when 'date'    then 'date'
                    when 'status'  then 'select'
                    when 'person'  then 'person'
                    when 'partner' then 'partner'
                    else 'text'
                  end
             from col c
            where c.deal_id = u.deal_id and c.name = u.key
            order by (c.archived_at is not null), c.position, c.created_at
            limit 1), 'text') as type,
         (select min(c.position) from col c where c.deal_id = u.deal_id and c.name = u.key) as old_pos,
         (select coalesce(jsonb_agg(o.opt order by o.ord), '[]'::jsonb)
            from (
              select distinct on (z.opt ->> 'id') z.opt, z.ord
                from (
                  select e.opt,
                         row_number() over (order by (c.archived_at is not null), c.position, c.created_at, e.i) as ord
                    from col c
                    cross join lateral jsonb_array_elements(
                           case when jsonb_typeof(c.settings -> 'options') = 'array'
                                then c.settings -> 'options' else '[]'::jsonb end) with ordinality as e(opt, i)
                   where c.deal_id = u.deal_id and c.name = u.key
                ) z
               order by z.opt ->> 'id', z.ord
            ) o) as options
    from used u
)
insert into public.project_item_columns (company_id, deal_id, key, name, type, settings, position)
select p.company_id, p.deal_id, p.key, p.key, p.type,
       case when p.type = 'select' then jsonb_build_object('options', p.options) else '{}'::jsonb end,
       10 * row_number() over (partition by p.deal_id order by coalesce(p.old_pos, 9999), p.key)
  from pick p
on conflict (deal_id, key) do nothing;
