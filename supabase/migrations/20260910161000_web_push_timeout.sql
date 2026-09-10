-- 알림 insert → 웹푸시 엣지 호출의 대기 시간을 5초(pg_net 기본)에서 20초로.
--   엣지 콜드스타트+푸시 발송이 5초를 넘기면 응답 큐에 timed_out 으로 남고, 인프라 오류 수집이 그걸
--   '[cron http 응답 없음]' 으로 운영자 페이지에 올렸다(2026-09-09 16:39 KST). 크론이 아니라 이 트리거의 호출이다.
begin;
create or replace function public.trg_notify_web_push()
returns trigger language plpgsql security definer set search_path = 'public', 'net' as $$
begin
  perform net.http_post(
    url := 'https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/send-web-push',
    headers := jsonb_build_object('Content-Type','application/json','x-push-secret','KmyadqaaGWkmf75Nk0zjtYYHbwbHNZOu'),
    body := jsonb_build_object('userId', NEW.user_id, 'title', NEW.title, 'body', coalesce(NEW.message,''), 'url', coalesce(NEW.link,'/'), 'tag', NEW.type),
    timeout_milliseconds := 20000
  );
  return NEW;
exception when others then
  return NEW;
end; $$;
commit;
