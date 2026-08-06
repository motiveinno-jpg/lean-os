-- 급여명세서 발급 기록을 payroll_items 에 남기기 위한 정비 (2026-08-06)
--   기존 payroll_items 는 payment_batches(급여 일괄 지급) 종속이었는데, 그 기능은 이체 실행 경로가
--   없어 삭제했다(3fbccda). 그런데 payroll_items 에 쓰는 코드는 애초에 어디서도 호출되지 않아
--   운영 0행 — 직원 마이페이지 '내 급여명세서'가 전 직원 항상 빈 화면이었다.
--   이제 관리자가 '명세 발송'에 성공한 시점의 금액을 월 단위 스냅샷으로 박제한다.

alter table public.payroll_items
  alter column batch_id drop not null;

alter table public.payroll_items
  add column if not exists company_id uuid references public.companies(id) on delete cascade,
  add column if not exists period_month text,
  add column if not exists non_taxable_amount numeric not null default 0,
  add column if not exists issued_at timestamptz;

update public.payroll_items pi
   set company_id = e.company_id
  from public.employees e
 where e.id = pi.employee_id and pi.company_id is null;

-- 같은 직원·같은 달은 1행 — 재발송 시 덮어쓰기(upsert).
--   부분 인덱스(where period_month is not null)로 만들면 ON CONFLICT 추론에 쓸 수 없어
--   upsert 가 42P10 으로 실패한다(로컬 검증에서 확인). NULL 끼리는 서로 구별되므로 일반 인덱스로 둔다.
create unique index if not exists payroll_items_employee_month_uniq
  on public.payroll_items (employee_id, period_month);

create index if not exists payroll_items_company_month_idx
  on public.payroll_items (company_id, period_month desc);

-- ── RLS ──
-- 구 정책은 batch_id 로 회사를 판정해, batch_id 가 없는 행은 INSERT 자체가 막힌다.
drop policy if exists payroll_items_company_policy on public.payroll_items;

-- 쓰기: 같은 회사 + (관리자 또는 급여 권한)
drop policy if exists payroll_items_admin_write on public.payroll_items;
create policy payroll_items_admin_write on public.payroll_items
  for all
  using (
    company_id = (select public.get_my_company_id())
    and (public.is_company_admin() or public.has_perm('/employees:salary'))
  )
  with check (
    company_id = (select public.get_my_company_id())
    and (public.is_company_admin() or public.has_perm('/employees:salary'))
  );

-- 읽기: 관리자/급여권한은 자기 회사만, 직원은 본인 행만.
--   구 정책은 is_company_admin() 에 회사 조건이 없어 타사 급여가 노출될 수 있었다 — 함께 교정.
drop policy if exists payroll_items_select_role_or_self on public.payroll_items;
create policy payroll_items_select_role_or_self on public.payroll_items
  for select
  using (
    employee_id = (select public.current_employee_id())
    or (
      company_id = (select public.get_my_company_id())
      and (public.is_company_admin() or public.has_perm('/employees:salary'))
    )
  );
