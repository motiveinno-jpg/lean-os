-- 경영 알림 조건은 알림을 **받는 사람**(대표·관리자)만 정한다 (2026-09-11 사장님: "일반 멤버한테도 보여").
--   종전 정책은 회사만 맞으면 누구나 읽고 쓸 수 있었다. 그래서
--     ① 마이페이지 › 설정에 일반 구성원에게도 조건 판이 그대로 보였고,
--     ② 회사 자금 기준(현금 개월수·미수금 일수·큰 출금 금액)이 전 구성원에게 공개됐으며,
--     ③ 아무나 '지금 검사'로 run_my_biz_alerts 를 돌려 last_fired_on 을 오늘로 만들 수 있었다
--        (같은 조건은 하루 한 번이라, 정작 아침에 대표에게 갈 알림이 소진된다).
--   알림 수신자는 run_biz_alerts_for 가 users.role in ('owner','admin') 으로 고르므로 기준을 그것에 맞춘다.
begin;

--   대표·관리자(또는 마스터)인가. RLS 안에서 쓰이므로 (select ...) 로 감싸 행마다 다시 불리지 않게 한다.
create or replace function public.is_company_manager()
returns boolean language sql stable security definer set search_path = 'public' as $$
  select exists (
    select 1 from public.users u
    where u.id = public.current_app_user_id()
      and (coalesce(u.is_master, false) or u.role in ('owner', 'admin'))
  )
$$;
comment on function public.is_company_manager() is '현재 사용자가 회사의 대표·관리자(또는 마스터)인가 — 경영 알림 조건처럼 수신자만 만지는 설정의 기준';
grant execute on function public.is_company_manager() to authenticated;

drop policy if exists company_isolation on public.biz_alert_rules;
create policy biz_alert_rules_manager on public.biz_alert_rules
  for all to authenticated
  using (company_id = (select public.get_my_company_id()) and (select public.is_company_manager()))
  with check (company_id = (select public.get_my_company_id()) and (select public.is_company_manager()));

--   '지금 검사'도 같은 기준. 화면을 숨겨도 함수는 누구나 부를 수 있어 여기서 막는다.
create or replace function public.run_my_biz_alerts()
returns integer language plpgsql security definer set search_path = 'public' as $$
begin
  if public.get_my_company_id() is null then raise exception '회사가 없습니다'; end if;
  if not public.is_company_manager() then raise exception '경영 알림은 대표·관리자만 검사할 수 있습니다' using errcode = '42501'; end if;
  return public.run_biz_alerts_for(public.get_my_company_id(), (now() at time zone 'Asia/Seoul')::date);
end $$;

commit;
