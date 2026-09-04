-- 자동 정산(20260904100000·20260904110000) 전면 철회.
--   트리거·크론·함수·게이트를 제거한다. 모티브에 만들어졌던 자동 정산 285건·조정 16건·정산 전표 482건은
--   같은 날 수동 SQL 로 지우고, 확정 과정에서 반려로 바뀐 기존 제안 103건은 제안으로 되돌렸다.
--   (기존 제안 19건 — 규칙 17·AI 2 — 은 복구 불가로 삭제됨. 규칙 제안은 매칭 엔진 실행으로 재생성된다.)
SET statement_timeout = '60000';
drop trigger if exists zzz_bank_tx_auto_settle on public.bank_transactions;
do $$ begin
  if exists (select 1 from cron.job where jobname = 'auto-settlement-sweep') then perform cron.unschedule('auto-settlement-sweep'); end if;
end $$;
drop function if exists public.trg_bank_tx_auto_settle();
drop function if exists public.run_auto_settlement();
drop function if exists public.auto_settle_company(uuid, date);
drop function if exists public.auto_settle_bank_tx(uuid);
drop function if exists public.resolve_bank_tx_partner(uuid, text);
drop function if exists public.party_name_variants(text);
delete from public.feature_rollout where feature = 'auto_settlement';
