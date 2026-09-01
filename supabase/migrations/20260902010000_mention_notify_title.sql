-- 서랍 댓글 알림 제목 분기 — 멘션이면 '나를 언급' — 2026-09-01
--
-- History
--   20260901100000_project_item_comment_notify.sql 이 알림을 만들 때 수신자는 팔로워 하나였고,
--   제목도 그 하나뿐인 이유를 그대로 적은 '프로젝트 새 댓글' 이었다.
--   그 뒤 20260901240000(대표·공동 담당) → 20260902000000(멘션) 로 수신자가 네 갈래로 넓어졌는데
--   제목은 그때 같이 손대지 않아, 지금은 **네 가지 이유가 한 문장으로 뭉쳐 있다.**
--
-- 자문자답
--   ① 무엇을 기준으로 제목이 달라지는가: **내가 이 알림을 받은 이유.**
--      화면·본문이 아니라 수신자별 자격(멘션이냐 아니냐)이 기준이므로, 알림 한 줄마다 값이 다르다
--      → 상수 제목이 아니라 insert ... select 의 그 자리에서 행마다 갈라야 한다.
--   ② 사용자는 왜 이걸 원하는가: 알림 목록에서 제목만 훑는다. 왜 받았는지 모르면
--      "내가 팔로우한 줄에 남이 떠든 것" 과 "나를 콕 집어 부른 것" 이 같은 무게로 쌓여
--      정작 답해야 할 호출을 놓친다. 멘션은 응답 의무가 있어 급이 다르다(2026-09-01 사장님 승인).
--   ③ 반대 경우(예외): 멘션이면서 팔로워·담당이기도 하면? distinct 로 알림은 한 줄이고,
--      그 한 줄은 **멘션 제목**을 받는다(더 강한 이유가 이긴다 — any(mentions) 가 먼저 참이므로 case 첫 분기).
--      멘션이 아닌 사람에게는 지금과 글자 하나 다르지 않다.
--   ④ 자동으로 못 푸는 것: 누가 나를 불렀는지(행위자 이름)는 제목에 넣지 않는다.
--      message 가 이미 프로젝트–항목–본문 앞 60자를 담고 있어 제목까지 길어지면 목록에서 잘린다.
--
-- 결정
--   규칙: 수신자가 new.mentions 에 포함되면 title='프로젝트에서 나를 언급', 그 외 '프로젝트 새 댓글'.
--   AS_IS  모든 수신자 → '프로젝트 새 댓글'
--   TO_BE  멘션된 수신자 → '프로젝트에서 나를 언급' / 팔로워·대표 담당·공동 담당 → '프로젝트 새 댓글'(그대로)
--   적용 시점: 즉시. 이 뒤에 달리는 댓글부터.
--   기존 데이터: 이미 쌓인 notifications 의 제목은 소급 변경하지 않는다
--     (그 알림이 멘션 때문이었는지는 지금 되짚을 수 없다 — 근거 없이 제목을 바꾸면 기록이 거짓이 된다).
--
-- 누락 점검: 권한·RLS 해당없음(새 표·새 칸 없음, notifications 기존 정책 승계).
--   수신자 집합·발송 건수 불변이라 파급 화면은 알림 목록의 글자뿐. 되돌리기 = 이전 정의 재적용.
--   feature_rollout 게이트 없음 — 회사 데이터를 새로 만드는 자동화가 아니라 기존 알림의 문구 분기다.
--
-- 나머지(수신자 합집합·distinct·행위자 제외·exception 무해화·ACL)는 20260902000000 그대로. 되돌리지 않는다.

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
  select new.company_id,
         r.uid,
         'deal_update',
         -- 제목은 **수신 이유**를 적는다 — 행마다 다르므로 상수가 아니라 case.
         -- 멘션이 팔로워·담당과 겹치면 이 첫 분기가 이긴다(강한 이유가 제목을 가진다).
         case when r.uid = any(coalesce(new.mentions, '{}'::uuid[]))
              then '프로젝트에서 나를 언급'
              else '프로젝트 새 댓글'
         end,
         v_message,
         'deal',
         v_item.deal_id
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
  '서랍에 댓글(kind=comment)이 달리면 팔로워 ∪ 대표 담당(assignee_id) ∪ 공동 담당(assignee_ids) ∪ 멘션(project_item_events.mentions)에게 알림(type=deal_update, entity=deal → /projects/{id} → projecthub). 제목은 수신 이유별 — 멘션된 사람은 ''프로젝트에서 나를 언급'', 그 외는 ''프로젝트 새 댓글''(겹치면 멘션이 이긴다). 멘션은 팔로워·담당이 아니어도 받고, 같은 회사 users 조인이 타사·탈퇴를 거른다. 쓴 사람(created_by) 제외, 겹치는 사람은 distinct 로 한 번만. 2026-09-01 결정 131 / 다중 담당 / 멘션 / 제목 분기.';

-- 형제 함수와 같은 ACL 로 맞춘다(security definer 함수가 /rest/v1/rpc 로 노출되지 않게).
revoke all on function public.project_item_comment_notify() from public, anon, authenticated;

-- 트리거는 이름으로 함수를 참조하므로 재생성하지 않는다
--   project_item_comment_notify on public.project_item_events (after insert)
