-- 급여명세서 열람 기록 (2026-09-21, 랜딩 문구 대조 → "담당자가 발송하면 구성원에게 전달되고 열람 여부가 남습니다" 를 참으로)
--
-- History
--   · 2026-08-06 payroll_items = 발송 스냅샷(issued_at). 직원 마이페이지 '내 급여명세서'의 유일한 소스.
--   · 열람은 어디에도 없었다 — 메일 PDF 는 앱 밖에서 열려 알 수 없고, 마이페이지에서 펼쳐 봐도 기록이 없었다.
--
-- 기준(결정)
--   · 열람 = 직원이 **마이페이지에서 그 달 명세서를 펼쳐 본 첫 시각**(viewed_at). 메일 PDF 열람은 셀 수 없으니 세지 않는다 —
--     급여 탭엔 '앱에서 확인' 기준이라고 적는다.
--   · 재발송(같은 달 upsert)하면 viewed_at 을 비운다 — 새 발급본은 아직 안 본 것이다(코드 payment-batch.ts).
--   · 기록은 본인만, 자기 행만, 비어 있을 때만(첫 열람) — RPC 로 좁힌다. payroll_items UPDATE 정책은 급여 권한자용이라
--     직원에게 UPDATE 를 열지 않는다.

alter table public.payroll_items
  add column if not exists viewed_at timestamptz;
comment on column public.payroll_items.viewed_at is
  '직원이 마이페이지에서 이 명세서를 처음 펼쳐 본 시각. 재발송 시 null 로 초기화. mark_payslip_viewed() 만 쓴다.';

create or replace function public.mark_payslip_viewed(p_item uuid)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare v timestamptz;
begin
  update public.payroll_items
     set viewed_at = coalesce(viewed_at, now())
   where id = p_item
     and employee_id = public.current_employee_id()
  returning viewed_at into v;
  return v;   -- 내 행이 아니면 null (조용히 무시)
end $$;
revoke all on function public.mark_payslip_viewed(uuid) from public, anon;
grant execute on function public.mark_payslip_viewed(uuid) to authenticated;
