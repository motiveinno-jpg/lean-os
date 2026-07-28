-- Migration: cleanup_orphan_company_rpc (2026-07-28)
-- 배경: createCompanyWithOwner 는 companies 생성 → users 연결 실패 시 회사를 직접
--   delete 해 정리한다. 그런데 실패한 사용자는 아직 소속이 없어 companies DELETE
--   정책(회사 구성원만)에 걸리고, RLS 는 0행 매칭으로 "조용히" 지나간다 → 고아 회사가
--   남아 그 사업자번호가 영구 잠김 (오늘 "만들다" 574-11-00604 실사례, 수동 정리함).
--
-- 소속 사용자가 0명인 회사만 지우는 정리 전용 RPC. 정상 회사는 항상 구성원(대표)이
--   있어 조건에 절대 걸리지 않는다. 신선한 UUID 를 아는 호출자만 대상 지정 가능.

create or replace function public.cleanup_orphan_company(p_company_id uuid)
returns boolean
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  -- 소속 사용자가 하나라도 있으면 고아가 아님 — 아무것도 하지 않는다
  if exists (select 1 from public.users u where u.company_id = p_company_id) then
    return false;
  end if;
  -- 개설 초기 단계에 만들어질 수 있는 부속 행부터 정리 (실패 시점상 보통 없음)
  delete from public.cash_snapshot where company_id = p_company_id;
  delete from public.employees where company_id = p_company_id;
  delete from public.companies where id = p_company_id
    and not exists (select 1 from public.users u where u.company_id = p_company_id);
  return found;
end;
$$;

revoke execute on function public.cleanup_orphan_company(uuid) from public, anon;
grant execute on function public.cleanup_orphan_company(uuid) to authenticated, service_role;
