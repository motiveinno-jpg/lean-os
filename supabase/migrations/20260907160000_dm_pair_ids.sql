-- 1:1 대화 상대를 방에 고정 저장 (2026-09-07).
--   문제: DM 상대가 '대화방 나가기' 를 하면 chat_participants 에서 그 사람 행이 삭제돼, 방에 나만 남는다.
--   그러면 표시용 이름(dm_name)이 "나 아닌 참가자" 를 못 찾아 내 이름으로 떨어진다(사장님 제보).
--   해결: 방을 만들 때 두 사람 id 를 chat_channels.dm_user_ids 에 박아 둔다 — 나가도 상대가 누구였는지는 남는다.
alter table public.chat_channels add column if not exists dm_user_ids uuid[];

-- 기존 DM 백필 — 지금 참가자(또는 과거 멤버) 로 채운다. 이미 상대가 나간 방은 남은 흔적(members)까지 훑는다.
with pair as (
  select ch.id as channel_id,
         array(
           select distinct uid from (
             select user_id as uid from public.chat_participants where channel_id = ch.id
             union
             select user_id as uid from public.chat_members where channel_id = ch.id
           ) t where uid is not null
         ) as ids
  from public.chat_channels ch
  where ch.is_dm and ch.dm_user_ids is null
)
update public.chat_channels ch set dm_user_ids = pair.ids
from pair where pair.channel_id = ch.id and array_length(pair.ids, 1) is not null;
