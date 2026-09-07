-- 통장 출처 구분: 은행 연동으로 만들어진 통장(codef)과 사용자가 직접 등록한 통장(manual).
-- 설정 › 자금·통장 카드가 두 종류를 한 목록에 섞어 보여 주던 문제를 풀기 위한 컬럼.
alter table public.bank_accounts
  add column if not exists source text not null default 'manual'
  check (source in ('manual', 'codef'));

comment on column public.bank_accounts.source is
  'manual: 사용자가 설정에서 직접 등록. codef: 은행 연동 수집기가 계좌 목록에서 만들거나 이어 붙임.';

-- 기존 행 채우기.
-- 1) 은행 수집 거래가 붙어 있는 통장은 연동 통장.
update public.bank_accounts a
   set source = 'codef'
 where exists (
   select 1 from public.bank_transactions t
    where t.bank_account_id = a.id and t.source like 'codef%'
 );

-- 2) 같은 회사에서 연동 통장과 같은 수집 회차(5분 안)에 만들어진 통장도 연동 통장.
--    거래내역 조회를 지원하지 않는 예금·적금 계좌가 여기에 해당한다.
update public.bank_accounts a
   set source = 'codef'
 where a.source = 'manual'
   and exists (
     select 1 from public.bank_accounts x
      where x.company_id = a.company_id
        and x.source = 'codef'
        and abs(extract(epoch from (a.created_at - x.created_at))) < 300
   );
