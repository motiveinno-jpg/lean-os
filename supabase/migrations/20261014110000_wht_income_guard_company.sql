-- 원천세 소득 기록 가드 — 회사 확인을 맨 앞으로 (20261014100000_wht_income_records.sql 보안 검토 후속, Low)
--
-- 왜: daily_work_logs_guard 는 BEFORE 트리거라 RLS WITH CHECK 보다 먼저 돈다. 남의 회사 company_id + 그 회사 employee_id 로
--     INSERT 하면 '같은 회사 직원이 아닙니다' / '일용직 구성원만 기록합니다' 처럼 오류 문구가 갈려,
--     결국 거절되더라도 그 직원이 있는지·일용직인지를 떠볼 수 있었다.
--
-- 규칙: INSERT 맨 처음에 company_id = get_my_company_id() 를 본다(서비스 키 제외). 아니면 직원과 상관없이
--       언제나 같은 문구 '권한이 없습니다'(42501). income_payments_guard 도 같은 모양으로 맞춘다(직원 확인은 없지만 대칭).
--       나머지 본문은 20261014100000 그대로 — SECURITY DEFINER·search_path·권한 회수 유지.
--       UPDATE 는 회사를 old 로 고정하므로 이 확인이 필요 없다(RLS USING 이 남의 줄을 못 잡는다).
--
-- 기존 데이터: 두 표 모두 0건 — 영향 없음.
-- 버린 안: 직원 확인 오류 문구를 하나로 합치기 — 같은 회사 사용자에게는 '일용직이 아니다'가 쓸모 있는 안내다.
--          / 트리거를 AFTER 로 옮기기 — 이름 스냅샷·작성자 강제는 BEFORE 라야 행을 바꿀 수 있다.

create or replace function public.daily_work_logs_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_name text; v_type text;
begin
  if tg_op = 'INSERT' and new.company_id is distinct from public.get_my_company_id()
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception '권한이 없습니다' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
    if not (new.created_by is null and old.created_by is not null
            and not exists (select 1 from public.users u where u.id = old.created_by)) then
      new.created_by := old.created_by;
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
  else
    new.created_by := public.current_app_user_id();
    new.created_at := now();
    new.updated_at := now();
  end if;
  if new.employee_id is not null then
    select coalesce(e.name, ''), e.employment_type into v_name, v_type
      from public.employees e where e.id = new.employee_id and e.company_id = new.company_id;
    if not found then raise exception '같은 회사 직원이 아닙니다' using errcode = '42501'; end if;
    if (tg_op = 'INSERT' or new.employee_id is distinct from old.employee_id) and v_type is distinct from 'daily' then
      raise exception '일용직 구성원만 기록합니다' using errcode = '22023';
    end if;
    new.employee_name := v_name;
  elsif tg_op = 'UPDATE' then
    new.employee_name := old.employee_name;
  end if;
  return new;
end $$;

revoke all on function public.daily_work_logs_guard() from public, anon, authenticated;

create or replace function public.income_payments_guard()
returns trigger language plpgsql security definer set search_path to 'public' as $$
begin
  if tg_op = 'INSERT' and new.company_id is distinct from public.get_my_company_id()
     and coalesce(auth.role(), '') <> 'service_role' then
    raise exception '권한이 없습니다' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    new.company_id := old.company_id;
    if not (new.created_by is null and old.created_by is not null
            and not exists (select 1 from public.users u where u.id = old.created_by)) then
      new.created_by := old.created_by;
    end if;
    new.created_at := old.created_at;
    new.updated_at := now();
  else
    new.created_by := public.current_app_user_id();
    new.created_at := now();
    new.updated_at := now();
  end if;
  return new;
end $$;

revoke all on function public.income_payments_guard() from public, anon, authenticated;
