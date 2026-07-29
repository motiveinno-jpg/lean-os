-- 통장거래 예금주명(counterparty) 백필 (2026-07-29)
--   증상: 거래내용은 나오는데 예금주명이 간간이 빈칸 (사장님 제보).
--   원인: 은행(주로 기업은행 인터넷뱅킹 출금·이자)이 desc1에 채널명("인터넷"·"이자")만 보내고
--         별도 예금주명을 안 준다. CODEF 응답 자체에 이름이 없으므로 동기화 로직 문제가 아님.
--   복구 근거 2가지로 채운다 (추측·조작 없음):
--     1) 같은 상대계좌번호(raw_data->>'counterAccount')로 예금주명이 잡힌 다른 거래가 있으면 그 이름
--     2) 거래내용이 그 회사 거래처(partners) 이름으로 시작하면 그 거래처명 (예: "에이티오광고비" → 에이티오)
--   호출: 통장 동기화 직후(클라이언트) + pg_cron 야간 배치(아래). security invoker — RLS 그대로 적용.

create or replace function public.backfill_bank_counterparty(p_company_id uuid)
returns integer
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_n1 integer := 0;
  v_n2 integer := 0;
begin
  -- 1) 상대계좌번호 매칭 — 같은 계좌로 이름이 확인된 거래에서 가져온다 (최다 빈도 이름)
  with named as (
    select ca, counterparty from (
      select raw_data->>'counterAccount' as ca, counterparty,
             row_number() over (partition by raw_data->>'counterAccount' order by count(*) desc) as rn
      from bank_transactions
      where company_id = p_company_id and source = 'codef_bank'
        and coalesce(counterparty, '') <> '' and coalesce(raw_data->>'counterAccount', '') <> ''
      group by 1, 2
    ) t where rn = 1
  )
  update bank_transactions b
     set counterparty = named.counterparty
    from named
   where b.company_id = p_company_id and b.source = 'codef_bank'
     and coalesce(b.counterparty, '') = ''
     and b.raw_data->>'counterAccount' = named.ca;
  get diagnostics v_n1 = row_count;

  -- 2) 거래처명 접두 매칭 — 거래내용이 거래처 이름(법인 접두 제거)으로 시작하면 그 거래처
  with cand as (
    select distinct on (b.id) b.id, p.name
    from bank_transactions b
    join partners p on p.company_id = b.company_id
     and length(regexp_replace(p.name, '^(주식회사|\(주\)|㈜)\s*', '')) >= 2
     and (b.description like regexp_replace(p.name, '^(주식회사|\(주\)|㈜)\s*', '') || '%'
          or b.description like p.name || '%')
    where b.company_id = p_company_id and b.source = 'codef_bank'
      and coalesce(b.counterparty, '') = '' and coalesce(b.description, '') <> ''
    order by b.id, length(regexp_replace(p.name, '^(주식회사|\(주\)|㈜)\s*', '')) desc
  )
  update bank_transactions b
     set counterparty = cand.name
    from cand
   where b.id = cand.id;
  get diagnostics v_n2 = row_count;

  return v_n1 + v_n2;
end;
$$;

comment on function public.backfill_bank_counterparty(uuid) is
  '통장거래 빈 예금주명 백필 — 상대계좌번호 매칭 + 거래처명 접두 매칭. 동기화 직후·야간 배치에서 호출';

-- 야간 배치 — CODEF 자동 동기화(cron)로 들어온 분도 다음날 채워지게
select cron.schedule(
  'bank-counterparty-backfill-nightly',
  '30 19 * * *',  -- UTC 19:30 = KST 04:30
  $cron$
    select public.backfill_bank_counterparty(id) from companies;
  $cron$
);
