-- 접속 IP 제한만 따로 지킨다 (2026-09-11).
--   company_settings 한 줄에 회사의 온갖 설정이 같이 들어 있다 — 직책 목록·견적 품목·재고 원가·
--   수집 일시정지·계약 양식… 여덟 군데가 쓴다. 줄 전체를 잠그면 그 기능들이 같이 막힌다.
--   그런데 이 줄에는 **접속 허용 IP** 도 들어 있어, 지금은 권한 없는 직원이 켜서 회사 전체를
--   로그인 못 하게 만들거나, 켜진 제한을 꺼 버릴 수 있다(전수 점검 접속 보안 H2).
--   → 줄은 그대로 두고 ip_restriction 칸이 바뀔 때만 막는다.
begin;

create or replace function public.enforce_ip_restriction_change()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if coalesce(new.settings -> 'ip_restriction', 'null'::jsonb)
     is not distinct from coalesce(old.settings -> 'ip_restriction', 'null'::jsonb) then
    return new;   --   IP 제한 칸은 그대로 — 다른 설정 변경은 막지 않는다
  end if;
  if public.is_company_manager()
     or public.has_perm('/settings:security') or public.has_perm('/settings:company-info') then
    return new;
  end if;
  raise exception '접속 IP 제한은 마스터 또는 보안 권한자만 바꿀 수 있습니다' using errcode = '42501';
end $$;

drop trigger if exists company_settings_ip_guard on public.company_settings;
create trigger company_settings_ip_guard
  before update on public.company_settings
  for each row execute function public.enforce_ip_restriction_change();

--   처음 만들 때도 IP 제한을 담아 넣지 못하게
create or replace function public.enforce_ip_restriction_insert()
returns trigger language plpgsql security definer set search_path = 'public' as $$
begin
  if (new.settings -> 'ip_restriction') is null then return new; end if;
  if public.is_company_manager()
     or public.has_perm('/settings:security') or public.has_perm('/settings:company-info') then
    return new;
  end if;
  raise exception '접속 IP 제한은 마스터 또는 보안 권한자만 정할 수 있습니다' using errcode = '42501';
end $$;
drop trigger if exists company_settings_ip_guard_ins on public.company_settings;
create trigger company_settings_ip_guard_ins
  before insert on public.company_settings
  for each row execute function public.enforce_ip_restriction_insert();

commit;
