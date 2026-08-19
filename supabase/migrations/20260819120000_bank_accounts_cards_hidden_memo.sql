-- 2026-08-19 통장·카드 동작 확장(사장님): 수정(이름·메모)·숨김·삭제
--   통장: is_hidden(목록에서 숨김, 합계·연동은 그대로) + memo. 카드: memo (숨김은 기존 is_active).
alter table public.bank_accounts add column if not exists is_hidden boolean not null default false;
alter table public.bank_accounts add column if not exists memo text;
alter table public.corporate_cards add column if not exists memo text;
comment on column public.bank_accounts.is_hidden is '통장 목록에서 숨김 (사용자 선택) — 잔액 합계·연동은 그대로';
comment on column public.bank_accounts.memo is '사용자 메모';
comment on column public.corporate_cards.memo is '사용자 메모';
