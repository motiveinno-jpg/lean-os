-- 결재 댓글 → 요청자 알림.
--   결재 댓글(approval_comments)은 화면이 행만 넣고 아무에게도 알리지 않아, 결재자가 "이 영수증 다시 올려 주세요"라고
--   남겨도 요청자는 상세를 직접 열어 보기 전엔 몰랐다. 넣는 경로가 어디든 빠지지 않게 DB 가 넣는 순간 알린다.
--
--   · 받는 사람: 그 결재의 요청자(approval_requests.requester_id). 요청자가 자기 건에 단 댓글은 알리지 않는다.
--   · 대상 키: entity_type 'approval_comment' + 결재 id — 같은 건 댓글이 이어지면 읽지 않은 알림 하나로 모이고(repeat_count),
--     같은 건의 '결재 승인/반려' 알림(entity_type 'approval_request')을 밀어내지 않는다.
--   · 누르면 '내 요청' 탭에서 그 건 상세(댓글 스레드 포함)를 연다(link).
--   · 알림이 실패해도 댓글 저장은 막지 않는다.

create or replace function public.approval_comments_notify_requester()
returns trigger language plpgsql security definer set search_path = public as $$
declare r record; v_name text; v_body text;
begin
  begin
    select ar.id, ar.company_id, ar.requester_id, ar.title into r
      from public.approval_requests ar where ar.id = new.request_id;
    if not found or r.requester_id is null or r.requester_id = new.user_id then return null; end if;
    if r.company_id is distinct from new.company_id then return null; end if;
    select coalesce(nullif(trim(u.name), ''), '누군가') into v_name from public.users u where u.id = new.user_id;
    v_body := nullif(trim(coalesce(new.body, '')), '');
    insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, link)
    values (
      r.company_id, r.requester_id, 'approval',
      '결재 댓글: ' || coalesce(nullif(r.title, ''), '내 요청'),
      coalesce(v_name, '누군가') || ': ' ||
        coalesce(left(v_body, 120) || case when length(v_body) > 120 then '…' else '' end,
                 case when coalesce(array_length(new.attachments, 1), 0) > 0 then '(사진·파일 첨부)' else '' end),
      'approval_comment', r.id,
      '/approvals?tab=my-requests&request=' || r.id::text
    );
  exception when others then
    raise warning 'approval_comments_notify_requester: %', sqlerrm;
  end;
  return null;
end $$;
revoke all on function public.approval_comments_notify_requester() from public, anon, authenticated;

drop trigger if exists trg_approval_comments_notify_requester on public.approval_comments;
create trigger trg_approval_comments_notify_requester
  after insert on public.approval_comments
  for each row execute function public.approval_comments_notify_requester();
