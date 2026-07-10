-- 사업자등록번호 000-00-00000 표준 표기 통일 (2026-07-10 사장님 QA)
--   "매입세금계산서 불러올 때 등록된 거래처들은 하이픈 없이 등록" — 원인:
--   link_invoice_partners RPC 가 counterparty_bizno 를 숫자만으로 저장.
--   모든 매칭 코드는 숫자 정규화 비교(regexp_replace)라 하이픈 저장으로 변경해도 안전.
--   (1) 기존 데이터 일괄 포맷 (10자리 숫자 → 000-00-00000)
--   (2) RPC 신규 등록도 하이픈 포맷으로 저장

update public.partners
set business_number = regexp_replace(
  regexp_replace(business_number, '[^0-9]', '', 'g'),
  '^(\d{3})(\d{2})(\d{5})$', '\1-\2-\3')
where length(regexp_replace(coalesce(business_number, ''), '[^0-9]', '', 'g')) = 10
  and business_number !~ '^\d{3}-\d{2}-\d{5}$';

create or replace function public.link_invoice_partners()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_created int := 0;
  v_linked int := 0;
begin
  v_company := public.get_my_company_id();
  if v_company is null then
    raise exception '권한이 없습니다.';
  end if;

  -- 1) 미등록 거래처 자동 등록 — 사업자번호는 000-00-00000 표준 표기로 저장(매칭은 숫자 비교라 무관).
  insert into partners (company_id, name, business_number, is_active, notes)
  select distinct on (regexp_replace(ti.counterparty_bizno, '[^0-9]', '', 'g'))
    v_company,
    coalesce(
      nullif(btrim(replace(coalesce(ti.counterparty_name, ''), '+', ' ')), ''),
      '거래처 ' || regexp_replace(ti.counterparty_bizno, '[^0-9]', '', 'g')
    ),
    regexp_replace(
      regexp_replace(ti.counterparty_bizno, '[^0-9]', '', 'g'),
      '^(\d{3})(\d{2})(\d{5})$', '\1-\2-\3'),
    true,
    '홈택스 송장 자동등록'
  from tax_invoices ti
  where ti.company_id = v_company
    and ti.counterparty_bizno is not null
    and regexp_replace(ti.counterparty_bizno, '[^0-9]', '', 'g') <> ''
    and not exists (
      select 1 from partners p
      where p.company_id = v_company
        and regexp_replace(coalesce(p.business_number, ''), '[^0-9]', '', 'g')
            = regexp_replace(ti.counterparty_bizno, '[^0-9]', '', 'g')
    )
  order by regexp_replace(ti.counterparty_bizno, '[^0-9]', '', 'g'), ti.issue_date desc nulls last;
  get diagnostics v_created = row_count;

  -- 2) 송장 → 거래처 연결 (사업자번호 일치, 미연결만)
  update tax_invoices ti
  set partner_id = p.id
  from partners p
  where ti.company_id = v_company
    and p.company_id = v_company
    and ti.partner_id is null
    and ti.counterparty_bizno is not null
    and regexp_replace(coalesce(p.business_number, ''), '[^0-9]', '', 'g')
        = regexp_replace(ti.counterparty_bizno, '[^0-9]', '', 'g');
  get diagnostics v_linked = row_count;

  return jsonb_build_object('created', v_created, 'linked', v_linked);
end;
$$;
