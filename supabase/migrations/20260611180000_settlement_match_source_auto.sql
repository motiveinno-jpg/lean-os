-- 핫픽스: settlement_autoclose 트리거가 자동 조정행에 match_source='auto' 를 쓰는데
--   기존 CHECK(invoice_settlements_match_source_check)가 rule/ai/manual 만 허용 →
--   확인 큐에서 "확정" 클릭 시(자동 단수차/원천세 마감 발화) CHECK 위반으로 확정 실패.
--   (2026-06-11 사장님 스크린샷: new row violates check constraint ..._match_source_check)
-- 조치: 'auto' 를 허용 목록에 추가. idempotent.

do $$
declare
  v_def text;
begin
  select pg_get_constraintdef(oid) into v_def
  from pg_constraint
  where conrelid = 'public.invoice_settlements'::regclass
    and conname = 'invoice_settlements_match_source_check';

  if v_def is not null and v_def not like '%''auto''%' then
    alter table public.invoice_settlements
      drop constraint invoice_settlements_match_source_check;
    alter table public.invoice_settlements
      add constraint invoice_settlements_match_source_check
      check (match_source = any (array['rule'::text, 'ai'::text, 'manual'::text, 'auto'::text]));
  end if;
end $$;
