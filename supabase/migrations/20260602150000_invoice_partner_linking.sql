-- 거래처 채권·채무 대사 Phase 1 — 송장↔거래처 연결.
-- tax_invoices.partner_id 가 비어 v_partner_ar_ap(거래처 원장)이 비는 문제 해결.
-- (1) RPC link_invoice_partners(): 미등록 거래처(홈택스 송장 counterparty)를 사업자번호 기준 자동등록
--     + 모든 송장을 사업자번호 일치 거래처에 연결. 카운트 반환. 사용자가 UI 버튼으로 트리거.
-- (2) 트리거: 신규 송장(홈택스 sync) INSERT 시 기존 거래처로 자동 연결(연결만, 자동생성은 안 함).
-- 모두 회사 격리(get_my_company_id) + 결정적 매칭(돈 계산 없음, 안전).

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

  -- 1) 미등록 거래처 자동 등록 — 사업자번호(숫자만) 기준, 이름은 '+'(공백 치환 흔적) 복원.
  insert into partners (company_id, name, business_number, is_active, notes)
  select distinct on (regexp_replace(ti.counterparty_bizno, '[^0-9]', '', 'g'))
    v_company,
    coalesce(
      nullif(btrim(replace(coalesce(ti.counterparty_name, ''), '+', ' ')), ''),
      '거래처 ' || regexp_replace(ti.counterparty_bizno, '[^0-9]', '', 'g')
    ),
    regexp_replace(ti.counterparty_bizno, '[^0-9]', '', 'g'),
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

grant execute on function public.link_invoice_partners() to authenticated;

-- 신규 송장 INSERT 시 기존 거래처 자동 연결 (연결만 — 자동생성은 RPC 가 담당).
create or replace function public.trg_link_invoice_partner()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.partner_id is null
     and new.counterparty_bizno is not null
     and regexp_replace(new.counterparty_bizno, '[^0-9]', '', 'g') <> '' then
    select id into new.partner_id from partners
    where company_id = new.company_id
      and regexp_replace(coalesce(business_number, ''), '[^0-9]', '', 'g')
          = regexp_replace(new.counterparty_bizno, '[^0-9]', '', 'g')
    limit 1;
  end if;
  return new;
end;
$$;

drop trigger if exists tax_invoice_autolink_partner on public.tax_invoices;
create trigger tax_invoice_autolink_partner
  before insert on public.tax_invoices
  for each row execute function public.trg_link_invoice_partner();
