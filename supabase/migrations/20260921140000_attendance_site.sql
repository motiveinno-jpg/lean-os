-- 근태에 현장(프로젝트) 기록 (2026-09-21, 랜딩 문구 대조 🟠 → 기능으로 참으로)
--
-- History
--   · attendance_records 는 사람·날짜·시각·분 계산만 있었다. "누가 어느 현장에 갔는지" 는 어디에도 남지 않았다.
--   · 업종 페이지(설비·전기, 2026-09-16)가 "출퇴근이 현장별로 남습니다 · 근태 기록이 급여 계산과 현장 인건비로 이어집니다" 라고 적었다.
--
-- 기준
--   · 현장 = 프로젝트(deals). 새 표를 만들지 않는다 — 건설·설비 회사는 이미 현장을 프로젝트로 두고(업종 페이지 START 1일차 "진행 중 현장 만들기") 계약·비용을 단다.
--   · 출근할 때 고르고, 근무 중에도 바꿀 수 있다(하루 한 행이므로 하루의 '주된 현장'). 하루에 두 현장을 오가는 분할은 지원하지 않는다 — 비고에 적는다.
--   · 프로젝트가 지워지면 근태 행은 남고 현장만 비운다(on delete set null). 근태는 급여의 근거라 프로젝트 삭제로 사라지면 안 된다.
--   · 인건비 추정은 화면 계산(시급 = 월급 ÷ 209, 연장 1.5배)이고 저장하지 않는다 — 급여 확정값이 아니라 '추정' 이라 적는다.

alter table public.attendance_records
  add column if not exists deal_id uuid references public.deals(id) on delete set null;
comment on column public.attendance_records.deal_id is
  '그날 출근한 현장(프로젝트). 출근 카드에서 고르고 근무 중 바꿀 수 있다. 프로젝트 삭제 시 null.';

create index if not exists attendance_records_deal_date_idx
  on public.attendance_records (company_id, deal_id, date) where deal_id is not null;
