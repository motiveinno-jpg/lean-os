-- 휴가 다단계 승인(1차/2차) + 참조(cc) (2026-06-26)
--   기존 단일 승인 확장. 1차 = 기존 requested_approver_id + approved_by/approved_at + status.
--   2차는 선택: second_approver_id 지정 시 1차 승인 후 status='first_approved'(2차 대기) -> 2차 승인 시 'approved'.
--   참조(cc)는 알림만(권한 없음). 추가형 컬럼만 — 기존 데이터/정책 영향 없음.

alter table public.leave_requests add column if not exists second_approver_id uuid references public.users(id) on delete set null;
alter table public.leave_requests add column if not exists second_approved_by uuid references public.users(id) on delete set null;
alter table public.leave_requests add column if not exists second_approved_at timestamptz;
alter table public.leave_requests add column if not exists cc_user_ids uuid[] not null default '{}';

comment on column public.leave_requests.second_approver_id is '2차 승인자(선택). 지정 시 1차 승인 후 2차 승인 필요.';
comment on column public.leave_requests.cc_user_ids is '참조자(알림만, 승인 권한 없음).';
