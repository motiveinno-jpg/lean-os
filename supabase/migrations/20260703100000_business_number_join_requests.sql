-- 가입·회사개설·합류 P1+P2 (2026-07-03)
--   ① 1 사업자번호 = 1 회사 — companies.business_number 정규화 기준 부분 유니크
--   ② company_join_requests — 초대 없이 가입한 구성원의 합류 요청(관리자 승인제)

-- ⚠️ 유니크 인덱스 적용 전 기존 중복 확인 필수 (중복 존재 시 인덱스 생성 실패):
--   select replace(business_number,'-','') as bn, count(*), array_agg(name)
--   from public.companies where business_number is not null and business_number <> ''
--   group by 1 having count(*) > 1;
--   → 중복 회사들은 대표 확인 후 한쪽 business_number 를 null 처리하고 재적용.
create unique index if not exists companies_business_number_uniq
  on public.companies ((replace(business_number, '-', '')))
  where business_number is not null and business_number <> '';

-- 합류 요청 — 가입 시 사업자번호가 기등록 회사와 일치하면 회사 생성 대신 이 요청 생성.
--   승인(owner/admin) 시 users 가 그 회사로 연결됨. 사업자번호만으로 자동 합류는 금지(승인 필수).
create table if not exists public.company_join_requests (
  id                 uuid primary key default gen_random_uuid(),
  company_id         uuid not null references public.companies(id) on delete cascade,
  requester_auth_id  uuid not null,               -- auth.users id (아직 public.users 없음)
  requester_email    text not null,
  requester_name     text,
  message            text,
  status             text not null default 'pending' check (status in ('pending','approved','rejected','expired','cancelled')),
  resolved_by        uuid references public.users(id) on delete set null,
  resolved_at        timestamptz,
  created_at         timestamptz not null default now(),
  expires_at         timestamptz not null default now() + interval '14 days'
);

create index if not exists company_join_requests_company_idx on public.company_join_requests(company_id, status);
create index if not exists company_join_requests_requester_idx on public.company_join_requests(requester_auth_id);

alter table public.company_join_requests enable row level security;

-- 회사 대표/관리자 — 자기 회사 요청 조회·처리
--   (2026-07-03 executor 보정) 원 패치의 인라인 users 서브쿼리 2가지 문제로 교체:
--   ① RLS 재귀 게이트 규칙 위반(정책 본문 users 인라인 금지 — 2026-05-19 로그인 504 인시던트 룰)
--   ② u.id = auth.uid() 는 이 스키마에서 오매칭(users.id != auth id, auth_id 컬럼이 별도)
--   → SECURITY DEFINER 헬퍼 조합으로: is_company_admin(본인 owner/admin) + get_my_company_id(회사 스코프)
drop policy if exists cjr_admin_select on public.company_join_requests;
create policy cjr_admin_select on public.company_join_requests
  for select using (
    public.is_company_admin() and company_id = public.get_my_company_id()
  );
drop policy if exists cjr_admin_update on public.company_join_requests;
create policy cjr_admin_update on public.company_join_requests
  for update using (
    public.is_company_admin() and company_id = public.get_my_company_id()
  );

-- 요청자 본인 — 자기 요청 상태 조회 (아직 회사 미소속이라 get_my_company_id 불가 → auth.uid 직접)
drop policy if exists cjr_requester_select on public.company_join_requests;
create policy cjr_requester_select on public.company_join_requests
  for select using (requester_auth_id = auth.uid());

-- insert/승인의 users 연결은 service role API 전용 (/api/join-request, /api/join-request/resolve) — 클라 insert 정책 없음.

-- (2026-07-03 executor 보정) notifications_type_check 에 합류 요청 알림 타입 추가.
--   누락 시 관리자 인앱 알림 insert 가 CHECK 위반으로 조용히 실패(연장근무 알림 인시던트와 동일 패턴).
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (
  type = any (array[
    'deal_update','expense_request','contract_expiry','signature_request','payment_due',
    'system','document','approval','chat','overtime_auto_clockout','project_checkin_due',
    'overtime_request','overtime_approved','overtime_rejected','company_join_request'
  ])
);
