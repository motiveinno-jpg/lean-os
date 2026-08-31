-- 프로젝트 상세 개편 2단계 — 연결 칸 확장 · 1단계 보안 후속 · 팔로워 알림 (2026-08-31)
--   기획: docs/20260831_PLAN_project_hub_bidirectional.md (결정 4 · 7-1, 1단계 security-reviewer 후속)
--
--   왜 이 모양인가:
--   ① 결정 4 — 결재·주문·작업지시·재고문서·일정은 지금 프로젝트와 아무 연결이 없다. 프로젝트 상세의
--      '증빙·문서' 탭이 "이 프로젝트에 달린 것"을 모으려면 각 표에 소속 칸(deal_id)이 있어야 한다.
--      칸만 추가하고 RLS 는 손대지 않는다 — 각 표의 회사 경계가 이미 격리를 끝냈고, 프로젝트 소속은
--      회사 안에서의 분류일 뿐이라 정책을 바꿀 이유가 없다. 기존 데이터 전부 null = 무소속.
--   ② 1단계(20260831140000) 보안 후속 2건:
--      a) project_items UPDATE 의 with check 가 회사만 봤다 — 같은 회사 안에서 deal_id 를 다른(또는
--         존재하지 않는) 프로젝트로 바꿔치기할 수 있었다. INSERT 와 같은 소속 검사를 with check 에 맞춘다.
--      b) feature_on 은 SECURITY DEFINER 라 아무나 임의 회사 id 로 게이트 상태를 물어볼 수 있었다.
--         값 자체는 boolean 이지만 남의 회사 도입 여부를 훑는 통로라 회사 경계로 막는다.
--         ⚠ 서버(admin/service_role)는 auth.uid() 가 null 이고 임의 회사로 부른다
--         (src/app/api/invite-accept/route.ts, 크론 run_biz_alerts/make_contract_invoice_drafts 등)
--         — 그 경로는 반드시 기존 동작 그대로 살려 둔다.
--   ③ 결정 7-1 — 담당자·팔로워는 "바뀌면 알려 준다"가 없으면 이름표일 뿐이다. 상태·담당·기한·이름이
--      바뀌는 순간 기존 알림 채널로 통지한다. 새 notifications type 은 만들지 않고 이미 CHECK 배열에
--      있는 'deal_update' 를 쓴다 — 2026-08-28 approval_reference 를 CHECK 에 넣지 않고 insert 해
--      알림이 통째로 실패한 사고의 재발 방지(기존 값 재사용이 결정사항).

-- ─────────────────────────────────────────────────────────────
-- 1. deal_id 연결 칸 확장 (결정 4)
--    부분 인덱스 = 대부분 null 인 칸이라 걸린 행만 색인한다.
-- ─────────────────────────────────────────────────────────────
alter table public.approval_requests add column if not exists deal_id uuid references public.deals(id) on delete set null;
alter table public.orders            add column if not exists deal_id uuid references public.deals(id) on delete set null;
alter table public.work_orders       add column if not exists deal_id uuid references public.deals(id) on delete set null;
alter table public.stock_docs        add column if not exists deal_id uuid references public.deals(id) on delete set null;
alter table public.schedule_events   add column if not exists deal_id uuid references public.deals(id) on delete set null;

create index if not exists approval_requests_deal_idx on public.approval_requests(deal_id) where deal_id is not null;
create index if not exists orders_deal_idx            on public.orders(deal_id)            where deal_id is not null;
create index if not exists work_orders_deal_idx       on public.work_orders(deal_id)       where deal_id is not null;
create index if not exists stock_docs_deal_idx        on public.stock_docs(deal_id)        where deal_id is not null;
create index if not exists schedule_events_deal_idx   on public.schedule_events(deal_id)   where deal_id is not null;

comment on column public.approval_requests.deal_id is '소속 프로젝트(deals). null = 무소속 — 2026-08-31 결정 4.';
comment on column public.orders.deal_id            is '소속 프로젝트(deals). null = 무소속 — 2026-08-31 결정 4.';
comment on column public.work_orders.deal_id       is '소속 프로젝트(deals). null = 무소속 — 2026-08-31 결정 4.';
comment on column public.stock_docs.deal_id        is '소속 프로젝트(deals). null = 무소속 — 2026-08-31 결정 4.';
comment on column public.schedule_events.deal_id   is '소속 프로젝트(deals). null = 무소속 — 2026-08-31 결정 4.';

-- ─────────────────────────────────────────────────────────────
-- 2a. project_items UPDATE — with check 에 deal 소속 검사 추가
--     using(어떤 행을 고칠 수 있나) 은 그대로 회사 경계. with check(고친 결과가 허용되나) 만 조인다.
-- ─────────────────────────────────────────────────────────────
drop policy if exists project_items_update on public.project_items;
create policy project_items_update on public.project_items
  for update to authenticated
  using (company_id = (select public.get_my_company_id()))
  with check (
    company_id = (select public.get_my_company_id())
    and exists (
      select 1 from public.deals d
      where d.id = deal_id and d.company_id = (select public.get_my_company_id())
    )
  );

-- ─────────────────────────────────────────────────────────────
-- 2b. feature_on 하드닝 — 서버(auth.uid() null)는 그대로, 로그인 사용자는 자기 회사만
-- ─────────────────────────────────────────────────────────────
create or replace function public.feature_on(p_feature text, p_company uuid)
returns boolean
language sql
stable
security definer
set search_path to 'public'
as $function$
  select case
    -- 서버·크론·service_role: JWT 가 없다 → 기존 동작 그대로(임의 회사 조회 허용)
    when auth.uid() is null then exists (
      select 1 from public.feature_rollout f
       where f.feature = p_feature and (f.company_id is null or f.company_id = p_company)
    )
    -- 로그인 사용자: 자기 회사에 대해서만 실제 조회. 남의 회사를 물으면 무조건 false.
    when p_company is not null and p_company = public.get_my_company_id() then exists (
      select 1 from public.feature_rollout f
       where f.feature = p_feature and (f.company_id is null or f.company_id = p_company)
    )
    else false
  end
$function$;

comment on function public.feature_on(text, uuid) is
  '기능 게이트 조회. auth.uid() 가 없는 서버·크론 컨텍스트는 임의 회사 조회 허용, 로그인 사용자는 자기 회사만(그 외 false) — 2026-08-31 보안 후속.';

grant execute on function public.feature_on(text, uuid) to authenticated;

-- ─────────────────────────────────────────────────────────────
-- 3. 팔로워 알림 (결정 7-1)
--    발화: status·assignee_id·due_date·name 중 하나라도 바뀔 때.
--    수신: followers ∪ assignee_id — 중복·null 제외, 같은 회사 사용자만, 그리고 '바꾼 사람 본인' 제외.
--    알림은 부가 기능이라 실패해도 본 update 를 막지 않는다(exception 블록으로 삼킨다).
-- ─────────────────────────────────────────────────────────────
create or replace function public.project_items_notify_followers()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_actor    uuid;
  v_changes  text[] := '{}';
  v_deal     text;
  v_message  text;
begin
  if new.status      is distinct from old.status      then v_changes := v_changes || '상태'::text; end if;
  if new.assignee_id is distinct from old.assignee_id then v_changes := v_changes || '담당'::text; end if;
  if new.due_date    is distinct from old.due_date    then v_changes := v_changes || '기한'::text; end if;
  if new.name        is distinct from old.name        then v_changes := v_changes || '이름'::text; end if;
  if array_length(v_changes, 1) is null then
    return new;
  end if;

  -- 바꾼 사람(본인에게는 안 보낸다). 서버 컨텍스트면 null 이라 아무도 빠지지 않는다.
  select u.id into v_actor from public.users u where u.auth_id = auth.uid() limit 1;

  select d.name into v_deal from public.deals d where d.id = new.deal_id;

  v_message := coalesce(nullif(v_deal, ''), '프로젝트')
            || ' — ' || coalesce(nullif(new.name, ''), '(이름 없음)')
            || ' (' || array_to_string(v_changes, ', ') || ')';

  insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id)
  select new.company_id, r.uid, 'deal_update', '프로젝트 할 일 변경', v_message, 'deal', new.deal_id
    from (
      select distinct t.uid
        from unnest(
               coalesce(new.followers, '{}'::uuid[])
               || case when new.assignee_id is null then '{}'::uuid[] else array[new.assignee_id] end
             ) as t(uid)
       where t.uid is not null
    ) r
    join public.users u on u.id = r.uid and u.company_id = new.company_id
   where v_actor is null or r.uid <> v_actor;

  return new;
exception when others then
  -- 알림 실패가 항목 저장을 되돌리면 안 된다(부가 기능).
  return new;
end;
$function$;

comment on function public.project_items_notify_followers() is
  '항목의 상태·담당·기한·이름이 바뀌면 담당자·팔로워에게 알림(type=deal_update, entity=deal → /projects/{id} → projecthub) — 2026-08-31 결정 7-1.';

drop trigger if exists project_items_notify_followers on public.project_items;
create trigger project_items_notify_followers
  after update on public.project_items
  for each row execute function public.project_items_notify_followers();
