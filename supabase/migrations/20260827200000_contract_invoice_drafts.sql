-- 계약 회차 도래 → 발행 대기(초안) 자동 생성 (2026-08-27 ERP 3순위 ③)
--   결정 81 — 계약서(documents.content_json.paymentSchedule[i].dueDate) 예정일이 오늘 이하이고 아직 계산서가 없는 회차 → tax_invoices 초안(status draft).
--             금액은 회차 비율로 품목 공급가 합을 나누고(마지막 회차가 나머지), 세액은 계약 거래유형(taxable 10%, 그 외 0).
--   결정 82 — 만든 계산서 id 를 회차에 적는다(invoiceId) — 화면의 '만듦' 판정·중복 방지. 계약서 status 가 draft 여도 만든다(사장님 흐름: 계약 → 발행).
--   결정 83 — 발행은 사람(세금·증빙 › 미발행 › 발행). 대표·관리자에게 "회차 도래 — 발행 대기 N건" 알림. 매일 07:30 KST.
create or replace function public.make_contract_invoice_drafts_for(p_company uuid, p_today date)
returns int language plpgsql security definer set search_path = public as $$
declare d record; ps jsonb; i int; t jsonb; n int := 0; total numeric; alloc numeric; amt numeric; tax_kind text; vat numeric; v_id uuid; pname text; pid uuid; bizno text; item text; new_ps jsonb;
begin
  for d in select id, deal_id, name, content_json from documents where company_id = p_company and status <> 'void' and content_json ? 'paymentSchedule' loop
    ps := d.content_json->'paymentSchedule'; if jsonb_typeof(ps) <> 'array' then continue; end if;
    if not exists (select 1 from jsonb_array_elements(ps) e where (e->>'dueDate') ~ '^\d{4}-\d{2}-\d{2}$' and (e->>'dueDate')::date <= p_today and coalesce(e->>'invoiceId', '') = '') then continue; end if;
    total := coalesce((select sum((x->>'supplyAmount')::numeric) from jsonb_array_elements(coalesce(d.content_json->'items', '[]'::jsonb)) x where (x->>'supplyAmount') ~ '^-?[0-9.]+$'), 0);
    if total <= 0 then total := coalesce((select amount from documents where id = d.id), 0); end if;
    if total <= 0 then continue; end if;
    tax_kind := case coalesce(d.content_json->'header'->>'taxType', 'taxable') when 'exempt' then 'exempt' when 'zero_rated' then 'zero_rated' when 'zero' then 'zero_rated' else 'taxable' end;
    pname := coalesce(d.content_json->'header'->>'partnerName', (select counterparty from documents where id = d.id), '거래처');
    pid := nullif(d.content_json->'header'->>'partnerId', '')::uuid;
    select business_number into bizno from partners where id = pid;
    item := coalesce((select x->>'name' from jsonb_array_elements(coalesce(d.content_json->'items', '[]'::jsonb)) x limit 1), d.name);
    alloc := 0; new_ps := '[]'::jsonb;
    for i in 0 .. jsonb_array_length(ps) - 1 loop
      t := ps->i;
      amt := case when i = jsonb_array_length(ps) - 1 then total - alloc
                  when (t->>'ratio') ~ '^[0-9.]+$' then round(total * (t->>'ratio')::numeric / 100)
                  else coalesce((t->>'amount')::numeric, 0) end;
      alloc := alloc + amt;
      if (t->>'dueDate') ~ '^\d{4}-\d{2}-\d{2}$' and (t->>'dueDate')::date <= p_today and coalesce(t->>'invoiceId', '') = '' and amt > 0 then
        vat := case when tax_kind = 'taxable' then round(amt * 0.1) else 0 end;
        insert into tax_invoices (company_id, deal_id, partner_id, type, counterparty_name, counterparty_bizno, supply_amount, tax_amount, total_amount, issue_date, status, label, item_name, tax_kind, source, auto_issued)
        values (p_company, d.deal_id, pid, 'sales', pname, bizno, amt, vat, amt + vat, (t->>'dueDate')::date, 'draft', regexp_replace(d.name, '\s*계약서$', '') || ' ' || (t->>'label'), item, tax_kind, 'auto', true)
        returning id into v_id;
        t := t || jsonb_build_object('invoiceId', v_id);
        n := n + 1;
      end if;
      new_ps := new_ps || jsonb_build_array(t);
    end loop;
    update documents set content_json = jsonb_set(content_json, '{paymentSchedule}', new_ps), updated_at = now() where id = d.id;
  end loop;
  if n > 0 then
    insert into notifications (company_id, user_id, type, title, message, entity_type, is_read, created_at, link)
    select p_company, u.id, 'system', format('계약 회차 도래 — 발행 대기 %s건', n), '예정일이 된 회차의 세금계산서 초안을 만들어 두었습니다. 세금·증빙에서 확인하고 발행하세요.', 'contract_invoice', false, now(), '/tax-invoices'
      from users u where u.company_id = p_company and u.role in ('owner', 'admin');
  end if;
  return n;
end $$;
create or replace function public.make_contract_invoice_drafts()
returns int language plpgsql security definer set search_path = public as $$
declare c record; n int := 0; v_today date := (now() at time zone 'Asia/Seoul')::date;
begin
  for c in select distinct company_id from documents where content_json ? 'paymentSchedule' loop
    begin n := n + public.make_contract_invoice_drafts_for(c.company_id, v_today); exception when others then null; end;
  end loop;
  return n;
end $$;
create or replace function public.make_my_contract_invoice_drafts()
returns int language plpgsql security definer set search_path = public as $$
begin
  if public.get_my_company_id() is null then raise exception '회사가 없습니다'; end if;
  return public.make_contract_invoice_drafts_for(public.get_my_company_id(), (now() at time zone 'Asia/Seoul')::date);
end $$;
revoke all on function public.make_contract_invoice_drafts_for(uuid, date) from public, anon, authenticated;
revoke all on function public.make_contract_invoice_drafts() from public, anon, authenticated;
grant execute on function public.make_my_contract_invoice_drafts() to authenticated;
select cron.schedule('contract-invoice-drafts-morning', '30 22 * * *', $$select public.make_contract_invoice_drafts()$$);
