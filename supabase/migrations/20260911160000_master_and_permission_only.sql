-- 역할(대표·관리자·직원)로 가르던 것을 '마스터 + 권한'으로 되돌린다 (2026-09-11 사장님).
--   이 제품의 모델은 **마스터와 멤버** 둘뿐이고 나머지는 권한 부여다. users.role 의 owner/admin/employee 는
--   2026-08-03 에 화면 표기에서 이미 뺐는데, DB 판정에는 남아 있었다. 어제 내가 만든 is_company_manager()
--   도 그 잔재를 그대로 썼다 — 권한을 다 받은 사람이 역할이 '직원'이라는 이유로 막히거나, 반대로 권한을
--   하나도 안 받은 사람이 역할이 'admin' 이라는 이유로 통과하는 일이 생긴다.
--   운영 확인: owner 8명은 전원 is_master 다. admin 3명은 필요한 권한(재무 10·설정 16·인사 7)을 모두 갖고 있어
--   역할을 빼도 그대로 통한다.
begin;

create or replace function public.is_company_manager()
returns boolean language sql stable security definer set search_path = 'public' as $$
  select exists (
    select 1 from public.users u
    where u.id = public.current_app_user_id() and coalesce(u.is_master, false))
$$;
comment on function public.is_company_manager() is '마스터인가. 역할(owner/admin)은 보지 않는다 — 이 제품은 마스터 + 권한 부여 모델이다 (2026-09-11)';

--   경영 알림 조건만 권한 대안이 없었다(마스터 아니면 막힘). 돈을 보는 권한자도 정할 수 있게 한다.
alter policy biz_alert_rules_manager on public.biz_alert_rules
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_any_finance_perm())))
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_any_finance_perm())));

--   '지금 검사'도 같은 기준
create or replace function public.run_my_biz_alerts()
returns integer language plpgsql security definer set search_path = 'public' as $$
begin
  if public.get_my_company_id() is null then raise exception '회사가 없습니다'; end if;
  if not (public.is_company_manager() or public.has_any_finance_perm()) then
    raise exception '경영 알림은 마스터 또는 재무 권한자만 검사할 수 있습니다' using errcode = '42501';
  end if;
  return public.run_biz_alerts_for(public.get_my_company_id(), (now() at time zone 'Asia/Seoul')::date);
end $$;

commit;
