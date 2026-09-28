-- 같은 것이 두 번 생기지 않게 — DB 가 '같은 사건'을 알고 거절한다.
--   원인: 알림·전표 초안·거래를 만드는 코드가 화면·엣지 함수·크론·트리거에 흩어져 있고 각자 그냥 넣었다.
--     · 알림 표엔 '같은 것' 개념이 아예 없어서, 결재 단계마다·할 일 저장마다(3초에 5번)·참조 생성/결과마다 쌓였다.
--     · 중복 방지가 있는 곳도 '있나 확인 → 넣기'라 거의 동시에 온 두 요청은 둘 다 '없다'를 보고 둘 다 넣을 수 있었다.
--   고침:
--     1) 알림 — 읽지 않은 알림은 사람·대상(subject_key)마다 하나. 새 소식이 오면 옛 알림을 지우고 새 것이 자리를 잇는다.
--        같은 내용이 30분 안에 또 오면(저장 연타·재시도) silent — 목록엔 하나, 푸시는 다시 안 보낸다.
--        부분 유일 인덱스로 어떤 경로로 넣어도 두 개가 공존할 수 없다. 사람·대상 단위 잠금으로 동시 입력도 줄 세운다.
--     2) '확인 → 넣기' 6곳(카드 거래·거래처 사업자번호·급여/감가상각/재고/퇴직 전표 초안·정산 전표)에 같은 키 잠금.
--     3) 정산 전표는 정산 1건에 살아 있는 전표 1개를 유일 인덱스로도 못 박는다.
begin;

-- ── 1) 알림 ─────────────────────────────────────────────────────────────
alter table public.notifications
  add column if not exists subject_key text generated always as
    (coalesce(entity_type, '') || ':' || coalesce(entity_id::text, type || ':' || title)) stored,
  add column if not exists repeat_count integer not null default 1,
  add column if not exists silent boolean not null default false;

comment on column public.notifications.subject_key is '같은 대상 판별 키 — 대상(entity)이 있으면 그 대상, 없으면 종류+제목. 읽지 않은 알림은 사람·키마다 하나';
comment on column public.notifications.repeat_count is '같은 대상 소식이 몇 번 이어졌는지(옛 알림을 대신한 횟수 누적)';
comment on column public.notifications.silent is '같은 내용이 곧바로 반복된 것 — 푸시를 다시 보내지 않는다';

-- 이미 쌓인 것: 사람·대상마다 가장 최근 읽지 않은 알림만 남긴다
with ranked as (
  select id, row_number() over (partition by user_id, subject_key order by created_at desc, id desc) rn
    from public.notifications where not is_read)
delete from public.notifications n using ranked r where n.id = r.id and r.rn > 1;

create or replace function public.notifications_collapse()
returns trigger language plpgsql security definer set search_path to 'public' as $$
declare v_key text; v_prev record; v_repeat int := 0; v_same boolean := false;
begin
  if new.is_read then return new; end if;
  v_key := coalesce(new.entity_type, '') || ':' || coalesce(new.entity_id::text, new.type || ':' || new.title);
  perform pg_advisory_xact_lock(hashtextextended('notif:' || new.user_id::text || ':' || v_key, 0));
  for v_prev in
    delete from public.notifications
     where user_id = new.user_id and subject_key = v_key and not is_read
    returning repeat_count, title, message, created_at
  loop
    v_repeat := greatest(v_repeat, v_prev.repeat_count);
    if v_prev.title = new.title and coalesce(v_prev.message, '') = coalesce(new.message, '')
       and v_prev.created_at > now() - interval '30 minutes' then v_same := true; end if;
  end loop;
  new.repeat_count := v_repeat + 1;
  new.silent := v_same;
  return new;
end $$;
revoke all on function public.notifications_collapse() from public, anon, authenticated;

drop trigger if exists aa_notifications_collapse on public.notifications;
create trigger aa_notifications_collapse before insert on public.notifications
  for each row execute function public.notifications_collapse();

create unique index if not exists uq_notifications_one_unread_per_subject
  on public.notifications (user_id, subject_key) where not is_read;

-- 같은 내용 반복(silent)은 푸시를 다시 보내지 않는다
drop trigger if exists notify_web_push on public.notifications;
create trigger notify_web_push after insert on public.notifications
  for each row when (not new.silent) execute function public.trg_notify_web_push();

-- ── 2) '확인 → 넣기' 잠금 ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.card_tx_prevent_dup()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
begin
  perform pg_advisory_xact_lock(hashtextextended('card_tx:' || new.company_id::text || ':' || new.transaction_date::text || ':' || new.amount::text, 0));   -- 확인→입력 사이 동시 실행을 한 줄로 세운다
  if exists (
    select 1 from public.card_transactions c
    where c.company_id = new.company_id
      and c.transaction_date = new.transaction_date
      and c.amount = new.amount
      and coalesce(c.card_id::text, c.card_name, '') = coalesce(new.card_id::text, new.card_name, '')
      and public.card_merchant_key(c.merchant_name) = public.card_merchant_key(new.merchant_name)
      and (coalesce(c.approval_number, '') = coalesce(new.approval_number, '')
           or coalesce(c.approval_number, '') = '' or coalesce(new.approval_number, '') = '')
  ) then
    return null;
  end if;
  return new;
end $function$;

CREATE OR REPLACE FUNCTION public.partners_block_duplicate_bizno()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_digits text; v_other text;
begin
  v_digits := regexp_replace(coalesce(new.business_number, ''), '[^0-9]', '', 'g');
  if length(v_digits) < 10 then return new; end if;   -- 안 적었거나 아직 덜 적은 번호는 통과
  --   번호가 그대로면 검사하지 않는다 — 기존 중복 행의 이름·연락처를 고치는 것까지 막으면 안 된다
  if tg_op = 'UPDATE' and regexp_replace(coalesce(old.business_number, ''), '[^0-9]', '', 'g') = v_digits then
    return new;
  end if;
  perform pg_advisory_xact_lock(hashtextextended('partner_bizno:' || new.company_id::text || ':' || v_digits, 0));   -- 동시 등록도 한 줄로
  select name into v_other from public.partners
   where company_id = new.company_id
     and id <> new.id
     and regexp_replace(coalesce(business_number, ''), '[^0-9]', '', 'g') = v_digits
   limit 1;
  if v_other is not null then
    raise exception '사업자번호 %(이)가 이미 거래처 "%" 에 등록돼 있습니다. 같은 번호를 두 번 등록하면 거래처 원장이 둘로 갈립니다.', new.business_number, v_other
      using errcode = 'P0001';
  end if;
  return new;
end;
$function$;

CREATE OR REPLACE FUNCTION public.make_payroll_voucher_draft(p_company uuid, p_month text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cfg jsonb; a_sal uuid; a_wh uuid; a_pay uuid;
  n int := 0; gross numeric := 0; wh numeric := 0; net numeric := 0; other numeric := 0;
  v_last date; v_entry uuid; v_desc text; v_old record;
begin
  perform pg_advisory_xact_lock(hashtextextended('voucher_draft:payroll:' || p_company::text, 0));   -- 확인→입력 사이 동시 실행을 한 줄로 세운다
  if p_company is null or p_month !~ '^\d{4}-\d{2}$' then raise exception '월(YYYY-MM)이 올바르지 않습니다'; end if;
  v_last := (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
  select coalesce(settings->'production_voucher', '{}'::jsonb) into v_cfg from company_settings where company_id = p_company; v_cfg := coalesce(v_cfg, '{}'::jsonb);
  a_sal := public._acct_by(p_company, v_cfg, 'acct_salary', '직원급여');
  a_wh  := public._acct_by(p_company, v_cfg, 'acct_withholding', '예수금');
  a_pay := public._acct_by(p_company, v_cfg, 'acct_salary_payable', '미지급금');
  if a_sal is null or a_wh is null or a_pay is null then
    raise exception '계정과목 매핑이 없습니다 — 직원급여·예수금·미지급금 계정을 정해 주세요';
  end if;
  select count(*), coalesce(sum(coalesce(net_pay, 0) + coalesce(deductions_total, 0)), 0),
         coalesce(sum(coalesce(national_pension, 0) + coalesce(health_insurance, 0) + coalesce(long_term_care_insurance, 0) + coalesce(employment_insurance, 0) + coalesce(income_tax, 0) + coalesce(local_income_tax, 0)), 0),
         coalesce(sum(coalesce(net_pay, 0)), 0)
    into n, gross, wh, net
    from payroll_items where company_id = p_company and period_month = p_month and status = 'issued';
  if n = 0 then return null; end if;
  other := gross - wh - net;
  if exists (select 1 from production_voucher_drafts where company_id = p_company and kind = 'payroll' and status = 'confirmed' and period_to = v_last) then
    raise exception '% 급여 전표가 이미 확정돼 있습니다 — 그 전표를 반려한 뒤 다시 만드세요', p_month;
  end if;
  for v_old in select * from production_voucher_drafts where company_id = p_company and status = 'draft' and kind = 'payroll' and period_to = v_last loop
    if v_old.journal_entry_id is not null then delete from journal_entries where id = v_old.journal_entry_id and status = 'ai_suggested'; end if;
    delete from production_voucher_drafts where id = v_old.id;
  end loop;
  gross := round(gross); wh := round(wh); net := round(net); other := round(other);
  v_desc := format('급여 초안 %s · %s명 · 총급여 ₩%s · 공제 ₩%s · 실지급 ₩%s (회사 부담 4대보험은 명세에 없어 빠짐 · 통장 지급 시 미지급금으로 처리)',
    p_month, n, to_char(gross, 'FM999,999,999,999'), to_char(wh + other, 'FM999,999,999,999'), to_char(net, 'FM999,999,999,999'));
  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type, is_approved, supply_amount, vat_amount)
  values (p_company, v_last, v_desc, 'general', 'rule', 'ai_suggested', 'transfer', false, 0, 0) returning id into v_entry;
  insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_sal, gross, 0, '급여 ' || p_month || ' (' || n || '명)');
  if wh + other > 0 then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_wh, 0, wh + other, '4대보험·소득세·기타 공제 예수'); end if;
  if net > 0 then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_pay, 0, net, '급여 미지급 — 통장 지급 시 미지급금으로'); end if;
  insert into production_voucher_drafts (company_id, kind, period_from, period_to, journal_entry_id, doc_ids, amount_cogs, amount_loss, skipped_lines, memo)
  values (p_company, 'payroll', date_trunc('month', v_last)::date, v_last, v_entry, '{}', gross, 0, 0, v_desc);
  return v_entry;
end $function$;

CREATE OR REPLACE FUNCTION public.make_depreciation_voucher_draft(p_company uuid, p_month text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_last date; v_old record; a record; v_entry uuid; v_desc text; n int := 0; total numeric := 0;
  acc numeric; remaining numeric; amt numeric; a_exp uuid; a_acc uuid; a_asset uuid; codes record;
begin
  perform pg_advisory_xact_lock(hashtextextended('voucher_draft:depreciation:' || p_company::text, 0));   -- 확인→입력 사이 동시 실행을 한 줄로 세운다
  if p_company is null or p_month !~ '^\d{4}-\d{2}$' then raise exception '월(YYYY-MM)이 올바르지 않습니다'; end if;
  v_last := (to_date(p_month || '-01', 'YYYY-MM-DD') + interval '1 month' - interval '1 day')::date;
  if exists (select 1 from production_voucher_drafts where company_id = p_company and kind = 'depreciation' and status = 'confirmed' and period_to = v_last) then
    raise exception '% 감가상각 전표가 이미 확정돼 있습니다 — 그 전표를 반려한 뒤 다시 만드세요', p_month;
  end if;
  --   이 달의 초안·반려분은 갈아 끼운다 (상각 줄도 같이)
  for v_old in select * from production_voucher_drafts where company_id = p_company and kind = 'depreciation' and status in ('draft', 'rejected') and period_to = v_last loop
    if v_old.journal_entry_id is not null then
      delete from fixed_asset_depreciations where journal_entry_id = v_old.journal_entry_id;
      delete from journal_entries where id = v_old.journal_entry_id and status in ('ai_suggested', 'rejected');
    end if;
    delete from production_voucher_drafts where id = v_old.id;
  end loop;

  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type, is_approved, supply_amount, vat_amount)
  values (p_company, v_last, '감가상각 ' || p_month, 'general', 'rule', 'ai_suggested', 'transfer', false, 0, 0) returning id into v_entry;

  -- 처분한 달까지 상각(월할) — disposed_on 이 이 달 안이면 포함
  for a in select * from fixed_assets f where f.company_id = p_company and f.status = 'active' and f.depr_start_month <= p_month
             and (f.disposed_on is null or f.disposed_on >= to_date(p_month || '-01', 'YYYY-MM-DD')) order by f.acquired_on, f.name loop
    acc := public._fa_accumulated(a.id, p_month);
    remaining := a.cost - a.salvage - acc;
    if remaining <= 0 then continue; end if;
    if a.method = 'declining' then amt := least(remaining, (a.cost - acc) * public._fa_declining_rate(a.useful_months) / 12.0);
    else amt := least(remaining, (a.cost - a.salvage) / a.useful_months); end if;
    amt := round(amt);
    if amt <= 0 then continue; end if;
    select * into codes from public._fa_default_codes(a.category);
    a_exp := a.expense_account_id;
    if a_exp is null and codes.expense_code is not null then select id into a_exp from chart_of_accounts where company_id = p_company and code = codes.expense_code limit 1; end if;
    if a_exp is null then select id into a_exp from chart_of_accounts where company_id = p_company and name = '감가상각비' order by code desc limit 1; end if;
    a_acc := a.accum_account_id;
    if a_acc is null and codes.accum_code is not null then select id into a_acc from chart_of_accounts where company_id = p_company and code = codes.accum_code limit 1; end if;
    if a_acc is null then
      --   무형(소프트웨어 등)은 누계액 없이 자산을 직접 줄인다
      a_asset := a.asset_account_id;
      if a_asset is null then select id into a_asset from chart_of_accounts where company_id = p_company and code = codes.asset_code limit 1; end if;
      a_acc := a_asset;
    end if;
    if a_exp is null or a_acc is null then raise exception '% — 감가상각비·누계액 계정을 찾지 못했습니다 (계정과목표에 감가상각비·감가상각누계액이 있는지 확인)', a.name; end if;
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values
      (p_company, v_entry, a_exp, amt, 0, a.name || ' 감가상각'), (p_company, v_entry, a_acc, 0, amt, a.name || ' 감가상각');
    insert into fixed_asset_depreciations (company_id, asset_id, month, amount, journal_entry_id) values (p_company, a.id, p_month, amt, v_entry);
    n := n + 1; total := total + amt;
  end loop;
  if n = 0 then delete from journal_entries where id = v_entry; return null; end if;
  v_desc := format('감가상각 초안 %s · 자산 %s건 · ₩%s', p_month, n, to_char(total, 'FM999,999,999,999'));
  update journal_entries set description = v_desc where id = v_entry;
  insert into production_voucher_drafts (company_id, kind, period_from, period_to, journal_entry_id, doc_ids, amount_cogs, amount_loss, skipped_lines, memo)
  values (p_company, 'depreciation', date_trunc('month', v_last)::date, v_last, v_entry, '{}', total, 0, 0, v_desc);
  return v_entry;
end $function$;

CREATE OR REPLACE FUNCTION public.make_inventory_voucher_draft(p_company uuid, p_asof date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_cfg jsonb; a_prod uuid; a_goods uuid; a_mat uuid; a_cogs_p uuid; a_cogs_g uuid; a_matcost uuid;
  t_p numeric := 0; t_g numeric := 0; t_m numeric := 0; b_p numeric := 0; b_g numeric := 0; b_m numeric := 0;
  d_p numeric; d_g numeric; d_m numeric; v_entry uuid; v_desc text; v_old record;
begin
  perform pg_advisory_xact_lock(hashtextextended('voucher_draft:inventory:' || p_company::text, 0));   -- 확인→입력 사이 동시 실행을 한 줄로 세운다
  if p_company is null or p_asof is null then raise exception '기준일이 없습니다'; end if;
  select coalesce(settings->'production_voucher', '{}'::jsonb) into v_cfg from company_settings where company_id = p_company; v_cfg := coalesce(v_cfg, '{}'::jsonb);
  a_prod    := public._acct_by(p_company, v_cfg, 'acct_product', '제품');
  a_goods   := public._acct_by(p_company, v_cfg, 'acct_goods', '상품');
  a_mat     := public._acct_by(p_company, v_cfg, 'acct_material', '원재료');
  a_cogs_p  := public._acct_by(p_company, v_cfg, 'acct_cogs_product', '제품매출원가');
  a_cogs_g  := public._acct_by(p_company, v_cfg, 'acct_cogs_goods', '상품매출원가');
  a_matcost := public._acct_by(p_company, v_cfg, 'acct_material_cost', '원재료비');
  if a_prod is null or a_goods is null or a_mat is null or a_cogs_p is null or a_cogs_g is null or a_matcost is null then
    raise exception '계정과목 매핑이 없습니다 — 제품·상품·원재료·제품매출원가·상품매출원가·원재료비 계정을 정해 주세요';
  end if;
  if exists (select 1 from production_voucher_drafts where company_id = p_company and kind = 'inventory' and status = 'confirmed' and period_to >= p_asof) then
    raise exception '% 이후 재고자산 전표가 이미 확정돼 있습니다 — 그 전표를 반려한 뒤 다시 만드세요', p_asof;
  end if;
  for v_old in select * from production_voucher_drafts where company_id = p_company and status = 'draft' and kind = 'inventory' loop
    if v_old.journal_entry_id is not null then delete from journal_entries where id = v_old.journal_entry_id and status = 'ai_suggested'; end if;
    delete from production_voucher_drafts where id = v_old.id;
  end loop;

  with made as (select distinct product_id from stock_cost_layers where company_id = p_company and source = 'produce'),
       comp as (select distinct component_id as product_id from product_boms where company_id = p_company),
       v as (select * from public._stock_value_asof(p_company, p_asof))
  select coalesce(sum(case when v.product_id in (select product_id from made) then v.value end), 0),
         coalesce(sum(case when v.product_id not in (select product_id from made) and v.product_id in (select product_id from comp) then v.value end), 0),
         coalesce(sum(case when v.product_id not in (select product_id from made) and v.product_id not in (select product_id from comp) then v.value end), 0)
    into t_p, t_m, t_g from v;

  select coalesce(sum(l.debit - l.credit), 0) into b_p from journal_lines l join journal_entries e on e.id = l.entry_id
   where e.company_id = p_company and e.status = 'confirmed' and e.entry_date <= p_asof and l.account_id = a_prod;
  select coalesce(sum(l.debit - l.credit), 0) into b_g from journal_lines l join journal_entries e on e.id = l.entry_id
   where e.company_id = p_company and e.status = 'confirmed' and e.entry_date <= p_asof and l.account_id = a_goods;
  select coalesce(sum(l.debit - l.credit), 0) into b_m from journal_lines l join journal_entries e on e.id = l.entry_id
   where e.company_id = p_company and e.status = 'confirmed' and e.entry_date <= p_asof and l.account_id = a_mat;

  d_p := round(t_p - b_p); d_g := round(t_g - b_g); d_m := round(t_m - b_m);
  if abs(d_p) < 1 and abs(d_g) < 1 and abs(d_m) < 1 then return null; end if;

  v_desc := format('재고자산 맞추기 %s · 기말 제품 ₩%s / 상품 ₩%s / 원재료 ₩%s · 장부와 차액 ₩%s',
    p_asof, to_char(round(t_p), 'FM999,999,999,999'), to_char(round(t_g), 'FM999,999,999,999'), to_char(round(t_m), 'FM999,999,999,999'),
    to_char(d_p + d_g + d_m, 'FM999,999,999,999'));
  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type, is_approved, supply_amount, vat_amount)
  values (p_company, p_asof, v_desc, 'general', 'rule', 'ai_suggested', 'transfer', false, 0, 0) returning id into v_entry;
  if abs(d_p) >= 1 then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values
    (p_company, v_entry, a_prod, greatest(d_p, 0), greatest(-d_p, 0), '제품 기말 맞춤'), (p_company, v_entry, a_cogs_p, greatest(-d_p, 0), greatest(d_p, 0), '제품 기말 맞춤'); end if;
  if abs(d_g) >= 1 then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values
    (p_company, v_entry, a_goods, greatest(d_g, 0), greatest(-d_g, 0), '상품 기말 맞춤'), (p_company, v_entry, a_cogs_g, greatest(-d_g, 0), greatest(d_g, 0), '상품 기말 맞춤'); end if;
  if abs(d_m) >= 1 then insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values
    (p_company, v_entry, a_mat, greatest(d_m, 0), greatest(-d_m, 0), '원재료 기말 맞춤'), (p_company, v_entry, a_matcost, greatest(-d_m, 0), greatest(d_m, 0), '원재료 기말 맞춤'); end if;

  insert into production_voucher_drafts (company_id, kind, period_from, period_to, journal_entry_id, doc_ids, amount_cogs, amount_loss, skipped_lines, memo)
  values (p_company, 'inventory', date_trunc('month', p_asof)::date, p_asof, v_entry, '{}', d_p + d_g + d_m, 0, 0, v_desc);
  return v_entry;
end $function$;

CREATE OR REPLACE FUNCTION public.make_retirement_voucher_draft(p_company uuid, p_asof date)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_cfg jsonb; a_exp uuid; a_liab uuid; v_est numeric := 0; v_bal numeric := 0; v_diff numeric; n int := 0; v_entry uuid; v_desc text; v_old record;
begin
  perform pg_advisory_xact_lock(hashtextextended('voucher_draft:retirement:' || p_company::text, 0));   -- 확인→입력 사이 동시 실행을 한 줄로 세운다
  if p_company is null or p_company <> (select public.get_my_company_id()) then raise exception '권한 없음'; end if;
  select coalesce(settings->'production_voucher', '{}'::jsonb) into v_cfg from company_settings where company_id = p_company; v_cfg := coalesce(v_cfg, '{}'::jsonb);
  a_exp  := public._acct_by(p_company, v_cfg, 'acct_retirement_expense', '퇴직급여');
  a_liab := public._acct_by(p_company, v_cfg, 'acct_retirement_liability', '퇴직급여충당부채');
  if a_exp is null or a_liab is null then raise exception '계정과목 매핑이 없습니다 — 퇴직급여·퇴직급여충당부채 계정을 정해 주세요'; end if;
  select coalesce(sum(r.estimate), 0), count(*) into v_est, n from public.estimate_retirement(p_company, p_asof) r;
  select coalesce(sum(l.credit - l.debit), 0) into v_bal from journal_lines l join journal_entries e on e.id = l.entry_id
   where e.company_id = p_company and e.status = 'confirmed' and e.entry_date <= p_asof and l.account_id = a_liab;
  v_diff := round(v_est - v_bal);
  if v_diff = 0 then return null; end if;
  if exists (select 1 from production_voucher_drafts where company_id = p_company and kind = 'retirement' and status = 'confirmed' and period_to >= p_asof) then
    raise exception '% 이후 퇴직급여충당 전표가 이미 확정돼 있습니다 — 그 전표를 반려한 뒤 다시 만드세요', p_asof;
  end if;
  for v_old in select * from production_voucher_drafts where company_id = p_company and status = 'draft' and kind = 'retirement' loop
    if v_old.journal_entry_id is not null then delete from journal_entries where id = v_old.journal_entry_id and status = 'ai_suggested'; end if;
    delete from production_voucher_drafts where id = v_old.id;
  end loop;
  v_desc := format('퇴직급여충당부채 초안 %s 기준 · %s명 추계 ₩%s · 장부 ₩%s · 차액 ₩%s (개인별 금액 없음 · 확정은 사람)',
    p_asof, n, to_char(round(v_est), 'FM999,999,999,999'), to_char(round(v_bal), 'FM999,999,999,999'), to_char(v_diff, 'FM999,999,999,999'));
  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type, is_approved, supply_amount, vat_amount)
  values (p_company, p_asof, v_desc, 'general', 'rule', 'ai_suggested', 'transfer', false, 0, 0) returning id into v_entry;
  if v_diff > 0 then
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_exp, v_diff, 0, '퇴직급여 (충당부채 전입)');
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_liab, 0, v_diff, '퇴직급여충당부채');
  else
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_liab, -v_diff, 0, '퇴직급여충당부채 환입');
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_exp, 0, -v_diff, '퇴직급여 (충당부채 환입)');
  end if;
  insert into production_voucher_drafts (company_id, kind, period_from, period_to, journal_entry_id, doc_ids, amount_cogs, amount_loss, skipped_lines, memo)
  values (p_company, 'retirement', date_trunc('month', p_asof)::date, p_asof, v_entry, '{}', v_diff, 0, 0, v_desc);
  return v_entry;
end $function$;

CREATE OR REPLACE FUNCTION public.post_settlement_voucher()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid := new.company_id;
  v_uid uuid;
  v_invtype text; v_cpname text; v_pid uuid;
  v_txdate date; v_edate date; v_bank_amt numeric;
  v_acct_cash uuid; v_acct_ar uuid; v_acct_ap uuid;
  v_acct_prepaid_tax uuid; v_acct_fee uuid; v_acct_misc_loss uuid; v_acct_misc_gain uuid;
  v_debit_acct uuid; v_credit_acct uuid; v_entry_id uuid;
  v_diff numeric := 0; v_use_diff boolean := false; v_n_real int;
begin
  perform pg_advisory_xact_lock(hashtextextended('settlement_voucher:' || new.id::text, 0));   -- 확인→입력 사이 동시 실행을 한 줄로 세운다
  if new.amount is null or new.amount <= 0 then return null; end if;
  if exists (select 1 from journal_entries je where je.linked_settlement_id = new.id and je.status <> 'rejected') then return null; end if;

  --   ★ 같은 계산서·같은 입출금 줄에 살아 있는 전표가 이미 있으면 또 만들지 않는다 (2026-08-12)
  if new.match_type <> 'adjustment' and new.bank_transaction_id is not null and exists (
       select 1 from journal_entries je
       where je.company_id = v_company
         and je.reference_type = 'settlement'
         and je.linked_invoice_id = new.tax_invoice_id
         and je.linked_bank_tx_id = new.bank_transaction_id
         and je.status <> 'rejected'
         and coalesce(je.reason, '') not like '%/adjustment %'
     ) then return null; end if;

  select i.type, i.counterparty_name, i.partner_id into v_invtype, v_cpname, v_pid from tax_invoices i where i.id = new.tax_invoice_id;
  if v_invtype is null then return null; end if;

  select b.transaction_date, b.amount into v_txdate, v_bank_amt from bank_transactions b where b.id = new.bank_transaction_id;
  -- 조정행(잔돈·원천징수 마감)은 통장 줄이 없어 종전엔 '만든 날'로 찍혔다 → 같은 계산서의 실제 정산(입출금) 날짜를 쓴다.
  if v_txdate is null and new.match_type = 'adjustment' then
    select b.transaction_date into v_txdate
    from invoice_settlements s join bank_transactions b on b.id = s.bank_transaction_id
    where s.tax_invoice_id = new.tax_invoice_id and s.status = 'confirmed' and s.match_type <> 'adjustment' and s.id <> new.id
    order by b.transaction_date desc limit 1;
  end if;
  v_edate := coalesce(v_txdate, new.created_at::date);
  if exists (select 1 from closing_checklists cc where cc.company_id = v_company and cc.month = to_char(v_edate, 'YYYY-MM') and cc.status = 'locked') then return null; end if;

  select id into v_acct_cash from chart_of_accounts where company_id = v_company and code = '103';
  select id into v_acct_ar from chart_of_accounts where company_id = v_company and code = '108';
  select id into v_acct_ap from chart_of_accounts where company_id = v_company and code = '251';
  select id into v_acct_prepaid_tax from chart_of_accounts where company_id = v_company and code = '136';
  select id into v_acct_fee from chart_of_accounts where company_id = v_company and code = '831';
  select id into v_acct_misc_loss from chart_of_accounts where company_id = v_company and code = '960';
  select id into v_acct_misc_gain from chart_of_accounts where company_id = v_company and code = '930';
  if v_acct_cash is null or v_acct_ar is null or v_acct_ap is null then return null; end if;

  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;

  if new.match_type <> 'adjustment' and new.bank_transaction_id is not null and v_bank_amt is not null and v_bank_amt > 0 then
    v_diff := v_bank_amt - new.amount;
    select count(*) into v_n_real from invoice_settlements s2
      where s2.bank_transaction_id = new.bank_transaction_id and s2.status = 'confirmed' and s2.match_type <> 'adjustment';
    if v_diff <> 0 and abs(v_diff) <= 200000 and v_n_real = 1 and v_acct_misc_loss is not null and v_acct_misc_gain is not null then
      v_use_diff := true;
    end if;
  end if;

  insert into journal_entries (
    company_id, entry_date, description, source, status, is_approved, confidence, reason,
    linked_invoice_id, linked_bank_tx_id, linked_settlement_id, reference_type, reference_id,
    created_by, approved_by, reviewed_by, reviewed_at
  ) values (
    v_company, v_edate, coalesce(v_cpname, ''), 'rule', 'confirmed', true, coalesce(new.confidence, 1),
    format('settlement=%s | %s/%s | settled=%s | bank=%s', new.id, v_invtype, new.match_type, new.amount, coalesce(v_bank_amt::text, '-')),
    new.tax_invoice_id, new.bank_transaction_id, new.id, 'settlement', new.id,
    v_uid, v_uid, v_uid, now()
  ) returning id into v_entry_id;

  if new.match_type = 'adjustment' then
    if v_invtype = 'sales' then
      v_debit_acct := case new.adjustment_reason
        when 'withholding_tax' then coalesce(v_acct_prepaid_tax, v_acct_misc_loss)
        when 'fee' then coalesce(v_acct_fee, v_acct_misc_loss)
        else v_acct_misc_loss end;
      v_credit_acct := v_acct_ar;
    else
      v_debit_acct := v_acct_ap; v_credit_acct := coalesce(v_acct_misc_gain, v_acct_misc_loss);
    end if;
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, partner_id)
      values (v_entry_id, v_company, v_debit_acct, new.amount, 0, v_pid),
             (v_entry_id, v_company, v_credit_acct, 0, new.amount, v_pid);

  elsif v_use_diff and v_invtype <> 'sales' then
    -- 매입(출금): (차)외상매입금[계산서] + 차액(잡손실/잡이익) / (대)보통예금[실제출금]
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, partner_id)
      values (v_entry_id, v_company, v_acct_ap, new.amount, 0, v_pid);
    if v_diff > 0 then
      insert into journal_lines (entry_id, company_id, account_id, debit, credit) values (v_entry_id, v_company, v_acct_misc_loss, v_diff, 0);
    else
      insert into journal_lines (entry_id, company_id, account_id, debit, credit) values (v_entry_id, v_company, v_acct_misc_gain, 0, -v_diff);
    end if;
    insert into journal_lines (entry_id, company_id, account_id, debit, credit) values (v_entry_id, v_company, v_acct_cash, 0, v_bank_amt);

  elsif v_use_diff and v_invtype = 'sales' then
    -- 매출(입금): (차)보통예금[실제입금] + 차액 / (대)외상매출금[계산서]
    insert into journal_lines (entry_id, company_id, account_id, debit, credit) values (v_entry_id, v_company, v_acct_cash, v_bank_amt, 0);
    if v_diff > 0 then
      insert into journal_lines (entry_id, company_id, account_id, debit, credit) values (v_entry_id, v_company, v_acct_misc_gain, 0, v_diff);
    else
      insert into journal_lines (entry_id, company_id, account_id, debit, credit) values (v_entry_id, v_company, v_acct_misc_loss, -v_diff, 0);
    end if;
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, partner_id) values (v_entry_id, v_company, v_acct_ar, 0, new.amount, v_pid);

  else
    if v_invtype = 'sales' then v_debit_acct := v_acct_cash; v_credit_acct := v_acct_ar;
    else v_debit_acct := v_acct_ap; v_credit_acct := v_acct_cash; end if;
    insert into journal_lines (entry_id, company_id, account_id, debit, credit, partner_id)
      values (v_entry_id, v_company, v_debit_acct, new.amount, 0, v_pid),
             (v_entry_id, v_company, v_credit_acct, 0, new.amount, v_pid);
  end if;

  if v_use_diff then
    update bank_transactions set settled_amount = v_bank_amt, settlement_status = 'settled' where id = new.bank_transaction_id;
  end if;

  return null;
end;
$function$;

-- ── 3) 정산 1건 = 살아 있는 전표 1개 ────────────────────────────────────
create unique index if not exists uq_journal_entries_one_live_per_settlement
  on public.journal_entries (linked_settlement_id)
  where linked_settlement_id is not null and status not in ('rejected', 'void');

commit;
