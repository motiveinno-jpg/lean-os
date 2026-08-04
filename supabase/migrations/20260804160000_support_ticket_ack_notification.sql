-- 문의 접수 즉시 확인 알림 (2026-08-04 사장님: "문의하면 영업일 하루 이내 처리 후 답변주겠다는 알림이 가게")
-- 답변 알림 트리거(support_tickets_touch)와 동일 규약 — 서버(트리거)가 보장해 클라이언트 우회 불가.
create or replace function public.support_tickets_ack()
returns trigger
language plpgsql
security definer
set search_path to 'public'
as $$
begin
  insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read, created_at)
  values (
    new.company_id, new.user_id, 'system',
    '문의가 접수되었습니다',
    '영업일 1일 이내에 처리 후 답변드리겠습니다. 진행 상태(대기·처리중·완료)는 고객센터에서 확인할 수 있습니다.',
    'support_ticket', new.id, false, now()
  );
  return new;
end $$;

drop trigger if exists trg_support_tickets_ack on public.support_tickets;
create trigger trg_support_tickets_ack
  after insert on public.support_tickets
  for each row execute function public.support_tickets_ack();
