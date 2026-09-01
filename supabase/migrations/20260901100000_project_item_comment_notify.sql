-- 프로젝트 v3 서랍 — 댓글이 달리면 담당자·팔로워에게 알림 (2026-09-01)
--   기획: docs/20260831_PLAN_projecthub_v3_impl.md 결정 131 (서랍 = 대화)
--
--   History: 상태·담당·기한·이름 바뀜은 20260831160000_project_hub_stage2.sql 의
--   project_items_notify_followers() 가 이미 알린다. 서랍 대화는 project_item_events 에
--   따로 쌓이므로 그 트리거가 닿지 않는다 — 댓글을 써도 아무도 모르는 구멍이 남았다.
--
--   자문자답
--     ① 무엇을 기준으로 보내는가: kind='comment' 인 행이 새로 생겼을 때만.
--        kind='log' 은 상태 변경 기록이고 그건 위 기존 트리거가 이미 알린다(두 번 보내지 않는다).
--     ② 행위자 제외를 무엇으로 하는가: auth.uid() 대신 new.created_by.
--        댓글은 클라이언트가 created_by(users.id)를 넣으므로 이게 더 확실하다.
--        서버(service_role) 삽입이면 null → 아무도 빠지지 않는다(기존 트리거와 같은 성격).
--     ③ 반대 경우: 팔로워도 담당자도 없으면 select 가 0행 → insert 0건. 정상.
--     ④ 자동으로 못 푸는 것: 본문 멘션(@사람)은 아직 파싱하지 않는다. 후속.
--
--   알림 실패가 댓글 저장을 되돌리면 안 된다(부가 기능) → exception when others then return new.
--   시드·백필 없음(기존 댓글에는 소급 알림 없음). 회사 데이터를 만드는 자동화가 아니므로
--   feature_rollout 게이트를 새로 두지 않는다 — UI 는 이미 projecthub_v3 게이트 안.

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

  select i.followers, i.assignee_id, i.name, i.deal_id
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
      select distinct t.uid
        from unnest(
               coalesce(v_item.followers, '{}'::uuid[])
               || case when v_item.assignee_id is null then '{}'::uuid[] else array[v_item.assignee_id] end
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
  '서랍에 댓글(kind=comment)이 달리면 담당자·팔로워에게 알림(type=deal_update, entity=deal → /projects/{id} → projecthub). 쓴 사람(created_by)은 제외. 2026-09-01 결정 131.';

-- 트리거 함수는 표 주인 권한으로 돌기 때문에 클라이언트 역할에 EXECUTE 가 필요 없다.
-- 기본 grant 를 그대로 두면 security definer 함수가 /rest/v1/rpc 로 노출된 것으로 잡힌다
-- (advisors: anon/authenticated_security_definer_function_executable).
-- 형제 함수 project_items_notify_followers 와 같은 ACL 로 맞춘다.
revoke all on function public.project_item_comment_notify() from public, anon, authenticated;

drop trigger if exists project_item_comment_notify on public.project_item_events;
create trigger project_item_comment_notify
  after insert on public.project_item_events
  for each row execute function public.project_item_comment_notify();
