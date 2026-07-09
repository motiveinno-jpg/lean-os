-- 알림(notifications) 생성 시 웹 푸시 발송 트리거 (2026-07-09)
--   AFTER INSERT → pg_net 로 send-web-push 엣지 호출 → 그 사용자의 push_subscriptions 로 발송.
--   ⚠️ x-push-secret 은 실제 값이 prod 에 이미 적용돼 있음(Management API). 이 파일엔 노출 금지라
--      플레이스홀더로 둔다. 재적용 시 <PUSH_HOOK_SECRET> 를 실제 엣지 시크릿과 동일 값으로 치환.
create extension if not exists pg_net;

create or replace function public.trg_notify_web_push()
returns trigger
language plpgsql
security definer
set search_path = public, net
as $FN$
begin
  perform net.http_post(
    url := 'https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/send-web-push',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-secret', '<PUSH_HOOK_SECRET>'),
    body := jsonb_build_object(
      'userId', NEW.user_id,
      'title', NEW.title,
      'body', coalesce(NEW.message, ''),
      'url', coalesce(NEW.link, '/'),
      'tag', NEW.type
    )
  );
  return NEW;
exception when others then
  return NEW; -- 푸시 실패해도 알림 insert 는 성공
end;
$FN$;

drop trigger if exists notify_web_push on public.notifications;
create trigger notify_web_push
  after insert on public.notifications
  for each row execute function public.trg_notify_web_push();
