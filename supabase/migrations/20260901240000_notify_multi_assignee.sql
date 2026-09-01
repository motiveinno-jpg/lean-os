-- 프로젝트 알림 — 공동 담당(assignee_ids)도 받게 (2026-09-01)
--
-- History
--   ① public.project_items_notify_followers()
--      원본 20260831160000_project_hub_stage2.sql L96 (project_items AFTER UPDATE 트리거),
--      이후 20260831170000_quote_revision_and_hardening.sql L259 에서 W-6 강화
--      (직접 호출 회수 = revoke, 무음 실패 제거 = exception 에 raise warning 한 줄).
--      → 아래 재정의는 **강화본 기준**이다. raise warning 줄을 되돌리지 않는다.
--   ② public.project_item_comment_notify()
--      원본 20260901100000_project_item_comment_notify.sql (project_item_events AFTER INSERT).
--   ③ 20260901230000_project_items_multi_assignee.sql 에서 project_items 에
--      assignee_ids uuid[] 가 생겼다(assignee_id = 그 배열의 첫 명 = 대표 담당 규약).
--
-- 왜 (문제)
--   위 두 알림 함수는 아직 assignee_id(대표 담당) 한 명만 수신자로 넣는다.
--   그래서 한 항목에 여러 명을 걸어도 **대표 외 공동 담당은 상태·기한 변경도, 새 댓글도 알림을 못 받는다.**
--   담당으로 지정만 되고 소식은 안 오는 조용한 누락이라 사용자가 원인을 못 찾는다.
--
-- 무엇을 바꾸나 (AS_IS ▶ TO_BE)
--   ① 변경 감지: assignee_id 만 봄 ▶ assignee_id **또는** assignee_ids 가 바뀌면 '담당' 변경으로 본다.
--      (대표는 그대로인데 공동 담당만 늘고 준 경우도 알림이 나가야 한다)
--   ② 수신자: followers ∪ {assignee_id} ▶ followers ∪ {assignee_id} ∪ assignee_ids
--   중복 알림 방지: 수신자 목록의 `select distinct t.uid` 가 곧 그 보장이다.
--     팔로워이면서 담당이거나, 대표 담당이 assignee_ids 에도 들어 있어(대표 규약상 항상 그렇다)
--     같은 사람이 두세 번 나와도 distinct 가 한 줄로 접어 알림은 정확히 한 번만 간다.
--     그래서 배열을 그냥 이어 붙이면 되고, 따로 빼는 로직을 두지 않는다.
--   그 밖(액터/작성자 제외, users 회사 조인, exception 무해화, ACL)은 손대지 않는다.
--
-- 적용 시점: 즉시(함수 교체만으로 반영). 트리거는 이름으로 함수를 잡으므로 재생성 불필요.
-- 기존 데이터: 소급 알림 없음(지난 변경·댓글은 다시 보내지 않는다). 백필·시드 없음.
-- 회사 데이터를 만드는 자동화가 아니라 기존 알림의 수신자 교정이므로 feature_rollout 게이트 없음.

-- ─────────────────────────────────────────────────────────────
-- 1. 항목 변경 알림 (project_items AFTER UPDATE)
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
  if new.status is distinct from old.status then v_changes := v_changes || '상태'::text; end if;
  -- 대표 담당(assignee_id)뿐 아니라 공동 담당 목록(assignee_ids)이 바뀌어도 '담당' 변경이다.
  if new.assignee_id is distinct from old.assignee_id
     or new.assignee_ids is distinct from old.assignee_ids then v_changes := v_changes || '담당'::text; end if;
  if new.due_date is distinct from old.due_date then v_changes := v_changes || '기한'::text; end if;
  if new.name     is distinct from old.name     then v_changes := v_changes || '이름'::text; end if;
  if array_length(v_changes, 1) is null then
    return new;
  end if;

  select u.id into v_actor from public.users u where u.auth_id = auth.uid() limit 1;

  select d.name into v_deal from public.deals d where d.id = new.deal_id;

  v_message := coalesce(nullif(v_deal, ''), '프로젝트')
            || ' — ' || coalesce(nullif(new.name, ''), '(이름 없음)')
            || ' (' || array_to_string(v_changes, ', ') || ')';

  insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id)
  select new.company_id, r.uid, 'deal_update', '프로젝트 할 일 변경', v_message, 'deal', new.deal_id
    from (
      -- distinct = 중복 알림 한 번만. 팔로워·대표 담당·공동 담당이 겹쳐도 사람당 한 줄.
      select distinct t.uid
        from unnest(
               coalesce(new.followers, '{}'::uuid[])
               || case when new.assignee_id is null then '{}'::uuid[] else array[new.assignee_id] end
               || coalesce(new.assignee_ids, '{}'::uuid[])
             ) as t(uid)
       where t.uid is not null
    ) r
    join public.users u on u.id = r.uid and u.company_id = new.company_id
   where v_actor is null or r.uid <> v_actor;

  return new;
exception when others then
  raise warning 'project_items_notify_followers 실패(item %): % / %', new.id, sqlstate, sqlerrm;
  return new;
end;
$function$;

comment on function public.project_items_notify_followers() is
  '항목의 상태·담당(대표 assignee_id 또는 공동 assignee_ids)·기한·이름이 바뀌면 팔로워 ∪ 대표 담당 ∪ 공동 담당에게 알림(type=deal_update, entity=deal → /projects/{id} → projecthub). 바꾼 본인 제외, 겹치는 사람은 distinct 로 한 번만 — 2026-08-31 결정 7-1 / 2026-09-01 다중 담당 반영.';

-- 트리거 함수라 클라이언트 역할에 EXECUTE 가 필요 없다(표 주인 권한으로 돈다).
-- create or replace 는 기존 grant 를 유지하지만, 원본과 같은 ACL 임을 관례대로 명시한다.
revoke all on function public.project_items_notify_followers() from public, anon, authenticated;

-- ─────────────────────────────────────────────────────────────
-- 2. 서랍 댓글 알림 (project_item_events AFTER INSERT)
-- ─────────────────────────────────────────────────────────────
create or replace function public.project_item_comment_notify()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
declare
  v_item     record;
  v_deal     text;
  v_message  text;
begin
  if new.kind is distinct from 'comment' then
    return new;
  end if;

  select i.followers, i.assignee_id, i.assignee_ids, i.name, i.deal_id
    into v_item
    from public.project_items i
   where i.id = new.item_id;

  if not found then
    return new;
  end if;

  select d.name into v_deal from public.deals d where d.id = v_item.deal_id;

  v_message := coalesce(nullif(v_deal, ''), '프로젝트')
            || ' — ' || coalesce(nullif(v_item.name, ''), '(이름 없음)')
            || ': ' || left(coalesce(new.body, ''), 60);

  insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id)
  select new.company_id, r.uid, 'deal_update', '프로젝트 새 댓글', v_message, 'deal', v_item.deal_id
    from (
      -- distinct = 중복 알림 한 번만. 팔로워·대표 담당·공동 담당이 겹쳐도 사람당 한 줄.
      select distinct t.uid
        from unnest(
               coalesce(v_item.followers, '{}'::uuid[])
               || case when v_item.assignee_id is null then '{}'::uuid[] else array[v_item.assignee_id] end
               || coalesce(v_item.assignee_ids, '{}'::uuid[])
             ) as t(uid)
       where t.uid is not null
    ) r
    join public.users u on u.id = r.uid and u.company_id = new.company_id
   where new.created_by is null or r.uid <> new.created_by;

  return new;
exception when others then
  -- 알림 실패가 댓글 저장을 되돌리면 안 된다(부가 기능).
  return new;
end;
$function$;

comment on function public.project_item_comment_notify() is
  '서랍에 댓글(kind=comment)이 달리면 팔로워 ∪ 대표 담당(assignee_id) ∪ 공동 담당(assignee_ids)에게 알림(type=deal_update, entity=deal → /projects/{id} → projecthub). 쓴 사람(created_by) 제외, 겹치는 사람은 distinct 로 한 번만. 2026-09-01 결정 131 / 다중 담당 반영.';

-- 형제 함수와 같은 ACL 로 맞춘다(security definer 함수가 /rest/v1/rpc 로 노출되지 않게).
revoke all on function public.project_item_comment_notify() from public, anon, authenticated;

-- 트리거는 이름으로 함수를 참조하므로 재생성하지 않는다
--   project_items_notify_followers  on public.project_items       (after update)
--   project_item_comment_notify     on public.project_item_events (after insert)
