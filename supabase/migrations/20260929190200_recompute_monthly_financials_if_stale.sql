-- 대시보드는 열 때마다 recompute_monthly_financials(회사 전체 통장·카드·계산서를 지우고 다시 집계)를 불렀다.
--   브라우저별 30분 제한(localStorage)만 있어 기기·사람·새 창마다 매번 전체 재집계가 돌았다. 서버 크론은 없다.
--   → 마지막 재집계 시각을 회사별로 남기고, 그 뒤에 원천이 바뀌었을 때만 다시 집계한다.
--     · 새 통장·카드 거래, 새로 들어오거나 고쳐진 세금계산서, 새 프로젝트, 새로 생기거나 입금된 수금 일정 → 즉시
--     · 위에서 못 잡는 변경(기존 거래 수정·삭제, 프로젝트 금액·단계 수정 등)을 위해 30분이 지나면 다시 집계
--       (종전 브라우저별 제한과 같은 간격 — 데이터가 늦어지는 경우는 종전보다 늘지 않는다)
--     · KST 달이 바뀌면 이번 달 미지급·미수 항목(financial_items.month)이 바뀌므로 다시 집계
--   집계 자체(recompute_monthly_financials)는 그대로 부른다.

create table if not exists public.monthly_financials_recompute_state (
  company_id uuid primary key references public.companies(id) on delete cascade,
  computed_at timestamptz not null default now()
);

-- 아래 SECURITY DEFINER 함수만 읽고 쓴다 — 정책 없음(브라우저 직접 접근 차단)
alter table public.monthly_financials_recompute_state enable row level security;
revoke all on table public.monthly_financials_recompute_state from public, anon, authenticated;

create or replace function public.recompute_monthly_financials_if_stale(p_company_id uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_last timestamptz;
  v_result jsonb;
begin
  -- 권한 판정은 recompute_monthly_financials 와 같다(자기 회사 또는 운영자, 또는 service_role)
  if auth.uid() is null and auth.role() is distinct from 'service_role' then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if auth.uid() is not null then
    if p_company_id <> coalesce(public.get_my_company_id(), '00000000-0000-0000-0000-000000000000'::uuid)
       and not public.is_platform_operator() then
      raise exception 'forbidden' using errcode = '42501';
    end if;
  end if;

  select s.computed_at into v_last
  from monthly_financials_recompute_state s
  where s.company_id = p_company_id;

  if v_last is not null
     and v_last > now() - interval '30 minutes'
     and to_char(v_last at time zone 'Asia/Seoul', 'YYYY-MM') = to_char(now() at time zone 'Asia/Seoul', 'YYYY-MM')
     and not exists (select 1 from bank_transactions t where t.company_id = p_company_id and t.created_at > v_last)
     and not exists (select 1 from card_transactions t where t.company_id = p_company_id and t.created_at > v_last)
     and not exists (select 1 from tax_invoices t where t.company_id = p_company_id and coalesce(t.updated_at, t.created_at) > v_last)
     and not exists (select 1 from deals d where d.company_id = p_company_id and d.created_at > v_last)
     and not exists (
       select 1 from deal_revenue_schedule r join deals d on d.id = r.deal_id
       where d.company_id = p_company_id and (r.created_at > v_last or r.received_at > v_last))
  then
    return jsonb_build_object('ok', true, 'skipped', true, 'company_id', p_company_id, 'computed_at', v_last);
  end if;

  v_result := public.recompute_monthly_financials(p_company_id);

  insert into monthly_financials_recompute_state (company_id, computed_at)
  values (p_company_id, now())
  on conflict (company_id) do update set computed_at = excluded.computed_at;

  return coalesce(v_result, '{}'::jsonb) || jsonb_build_object('skipped', false);
end;
$function$;

revoke execute on function public.recompute_monthly_financials_if_stale(uuid) from public, anon;
grant execute on function public.recompute_monthly_financials_if_stale(uuid) to authenticated, service_role;
