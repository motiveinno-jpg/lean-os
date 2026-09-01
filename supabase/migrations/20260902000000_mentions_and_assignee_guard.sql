-- 서랍 댓글 @멘션 + 대표 담당 규약 DB 방어 — 2026-09-01
--
-- History
--   ① 멘션: 20260901100000_project_item_comment_notify.sql 의 자문자답 ④ 가
--      "본문 멘션(@사람)은 아직 파싱하지 않는다. 후속." 이라고 남긴 그 후속이다.
--      알림 수신자는 그 뒤 20260901240000_notify_multi_assignee.sql 에서
--      followers ∪ 대표 담당(assignee_id) ∪ 공동 담당(assignee_ids) 까지 넓어졌다
--      → 이 파일은 그 합집합에 **멘션된 사람**을 한 갈래 더 붙인다(그 강화본이 기준. 되돌리지 않는다).
--   ② 방어: 20260901230000_project_items_multi_assignee.sql 이 세운 규약
--      "assignee_ids = 전체 담당, assignee_id = 그 배열의 첫 명(대표 담당)" 은
--      지금까지 **화면(TableV3 toggleAssignee) 한 곳의 약속**일 뿐이었다.
--      엑셀 올리기·API·배치처럼 화면을 안 거치는 경로는 이 약속을 모른다.
--
-- 자문자답
--   ① 멘션을 무엇을 기준으로 보내는가: 본문 파싱이 아니라 **클라이언트가 풀어 넣은 users.id 배열**.
--      DB 가 '@이름' 을 사람으로 되짚으면 동명이인·퇴사자·오타에서 틀린 사람에게 간다.
--      이름→id 해석은 그 사람 목록을 이미 들고 있는 화면이 가장 정확하다. 본문(body)은 '@이름' 그대로 남긴다.
--   ② 사용자는 왜 멘션하는가: 팔로워도 담당도 아닌 사람을 **이 줄로 끌어오려고**.
--      그러니 멘션은 팔로워·담당 자격과 무관하게 받아야 한다(그게 멘션의 존재 이유다).
--   ③ 반대 경우(예외): 타사 사람·탈퇴자 id 가 섞여 들어오면? 기존 `join public.users u
--      on u.id = r.uid and u.company_id = new.company_id` 가 이미 거른다 — 따로 막지 않는다.
--      멘션이 팔로워·담당과 겹치면? `select distinct` 가 접어 알림은 정확히 한 번.
--      본인을 멘션하면? 기존 작성자 제외(created_by) 조건이 그대로 걸러낸다.
--   ④ 규약을 왜 트리거로 강제하는가: 어긋난 행은 에러를 내지 않고 조용히 "내 작업에서 사라짐"
--      으로만 드러난다. 조용한 사고는 사람이 원인을 못 찾으므로 DB 가 값을 맞춰준다.
--   ⑤ 어느 쪽이 진실인가(충돌 예외 순서): **배열을 바꾼 경로가 진실.**
--      배열이 바뀌었으면 대표를 배열[1] 로 맞추고, 단일 칸만 바뀌었으면(옛 경로) 배열을 그 한 명으로 간다.
--      둘이 동시에 바뀌면 배열 쪽이 이긴다(첫 분기).
--   ⑥ 자동으로 못 푸는 것: 배열 안 **순서(누가 대표인가)** 는 사람이 정한다. DB 는 첫 명을 대표로 볼 뿐이다.
--
-- 적용 시점: 즉시. 멘션 칸은 기본값 '{}' 이라 기존 삽입 경로가 그대로 돈다(칸을 안 채우면 지금과 동일 동작).
-- 기존 데이터: 지난 댓글에 소급 멘션·소급 알림 없음. 규약 불일치 행만 정합(아래 3번 끝).
-- feature_rollout 게이트 없음 — 회사 데이터를 새로 만드는 자동화가 아니라
--   기존 알림의 수신자 확장과 기존 칸의 정합 유지다.
-- RLS: 새 표 없음. project_item_events·project_items 의 기존 정책·제약 그대로 승계.

-- ─────────────────────────────────────────────────────────────
-- 1. 댓글 멘션 칸
-- ─────────────────────────────────────────────────────────────
alter table public.project_item_events
  add column if not exists mentions uuid[] not null default '{}'::uuid[];

comment on column public.project_item_events.mentions is
  '@멘션된 users.id — 클라이언트가 이름을 id 로 풀어 넣는다. 알림 수신자 합류용, 본문 자체는 body 에 @이름 그대로';

-- ─────────────────────────────────────────────────────────────
-- 2. 댓글 알림 수신자에 멘션 합류 (project_item_events AFTER INSERT)
--    20260901240000 정의 그대로 + unnest 합집합에 mentions 한 갈래만 추가.
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
      -- distinct = 중복 알림 한 번만. 팔로워·대표 담당·공동 담당·멘션이 겹쳐도 사람당 한 줄.
      select distinct t.uid
        from unnest(
               coalesce(v_item.followers, '{}'::uuid[])
               || case when v_item.assignee_id is null then '{}'::uuid[] else array[v_item.assignee_id] end
               || coalesce(v_item.assignee_ids, '{}'::uuid[])
               -- 멘션된 사람은 팔로워·담당이 아니어도 받는다(그게 멘션의 목적).
               -- 아래 users 조인이 같은 회사만 남기므로 타사·탈퇴 id 는 여기서 저절로 빠진다.
               || coalesce(new.mentions, '{}'::uuid[])
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
  '서랍에 댓글(kind=comment)이 달리면 팔로워 ∪ 대표 담당(assignee_id) ∪ 공동 담당(assignee_ids) ∪ 멘션(project_item_events.mentions)에게 알림(type=deal_update, entity=deal → /projects/{id} → projecthub). 멘션은 팔로워·담당이 아니어도 받고, 같은 회사 users 조인이 타사·탈퇴를 거른다. 쓴 사람(created_by) 제외, 겹치는 사람은 distinct 로 한 번만. 2026-09-01 결정 131 / 다중 담당 / 멘션 반영.';

-- 형제 함수와 같은 ACL 로 맞춘다(security definer 함수가 /rest/v1/rpc 로 노출되지 않게).
revoke all on function public.project_item_comment_notify() from public, anon, authenticated;

-- 트리거는 이름으로 함수를 참조하므로 재생성하지 않는다
--   project_item_comment_notify on public.project_item_events (after insert)

-- ─────────────────────────────────────────────────────────────
-- 3. 대표 담당 규약 DB 방어 (project_items BEFORE INSERT OR UPDATE)
-- ─────────────────────────────────────────────────────────────
create or replace function public.project_items_sync_assignee()
returns trigger
language plpgsql
security definer
set search_path = public
as $function$
begin
  if tg_op = 'UPDATE' then
    if new.assignee_ids is distinct from old.assignee_ids then
      -- 배열을 바꾼 경로가 진실 — 대표를 따라 맞춘다
      new.assignee_id := case when coalesce(array_length(new.assignee_ids, 1), 0) > 0 then new.assignee_ids[1] else null end;
    elsif new.assignee_id is distinct from old.assignee_id then
      -- 단일 칸만 아는 옛 경로(엑셀 올리기 등) — 배열을 단일로 갈아 맞춘다
      new.assignee_ids := case when new.assignee_id is null then '{}'::uuid[] else array[new.assignee_id] end;
    end if;
  else
    if coalesce(array_length(new.assignee_ids, 1), 0) > 0 then new.assignee_id := new.assignee_ids[1];
    elsif new.assignee_id is not null then new.assignee_ids := array[new.assignee_id];
    end if;
  end if;
  return new;
end $function$;

comment on function public.project_items_sync_assignee() is
  'assignee_id=대표=assignee_ids[1] 규약을 DB 가 강제 — 화면(TableV3)만 지키던 것을 모든 경로(엑셀·API·배치)로 확장. 2026-09-01 결정';

-- 트리거 함수라 클라이언트 역할에 EXECUTE 가 필요 없다(표 주인 권한으로 돈다).
revoke all on function public.project_items_sync_assignee() from public, anon, authenticated;

-- ⚠ BEFORE 인 것이 핵심: 이 트리거가 AFTER 알림 트리거(project_items_notify_followers)보다
--   먼저 돌아 값을 정합시켜 놓으므로, 알림은 이미 맞춰진 대표·공동 담당으로 나간다.
--   (AFTER 로 두면 알림이 어긋난 값을 읽고, 정합은 그 뒤에 일어나 수신자가 틀린다.)
drop trigger if exists project_items_sync_assignee on public.project_items;
create trigger project_items_sync_assignee
  before insert or update on public.project_items
  for each row execute function public.project_items_sync_assignee();

-- 기존 데이터 정합 — **배열 기준**(배열을 진실로 본다. 위 UPDATE 분기와 같은 순서)
--   ① 배열이 있으면 대표를 배열[1] 로
--   ② 배열이 비었는데 단일만 있으면 배열을 그 한 명으로
--   재실행 안전(어긋난 행만 건드리므로 두 번 돌려도 0건).
--   prod(njbvdkuvtdtkxyylwngn) 작성 시점 실측: 불일치 0건 / 전체 191행 → 여기서는 무동작.
--   다른 환경·이후 유입분을 위해 문장은 남긴다.
update public.project_items
   set assignee_id = assignee_ids[1]
 where coalesce(array_length(assignee_ids, 1), 0) > 0
   and assignee_id is distinct from assignee_ids[1];

update public.project_items
   set assignee_ids = array[assignee_id]
 where coalesce(array_length(assignee_ids, 1), 0) = 0
   and assignee_id is not null;
