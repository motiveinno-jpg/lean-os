-- 결산자료입력 초안 3종 — 대손충당금·법인세비용·선급/미지급(발생주의) (2026-10-14)
--
-- 왜: 결산 정리분개 중 퇴직급여충당·감가상각·재고는 초안 RPC 가 있었지만, 대손충당금 설정·법인세비용 계상·
--     선급/미지급 같은 발생주의 조정은 사람이 일반전표로 처음부터 쳐야 했다. 같은 '초안 → 사람 확정' 길에 얹는다.
--
-- 규칙 (make_retirement_voucher_draft 와 같은 모양 — 20260928270000 의 최신 본문):
--   · kind 별·회사별 advisory xact lock, 우리 회사만('권한 없음'), 계정은 _acct_by(설정 키 → 이름) 로 찾는다.
--   · 같은 kind 의 확정 초안이 p_asof 이후까지 있으면 거절. 남은 draft 초안(+ ai_suggested 전표)은 지우고 새로 만든다.
--   · 전표는 general / rule / ai_suggested / transfer / 미승인, entry_date = p_asof. 확정은 전표 현황에서 사람이.
--   · 할 일이 없으면 null.
--   대손(baddebt)   채권/충당금 짝을 계정 코드로: 108→109, 110→111, 120→121 (둘 중 하나라도 없으면 그 짝은 건너뜀).
--                   잔액은 확정 전표·p_asof 이하. 목표 = round(채권(음수면 0) × 설정률%) , 차액 = 목표 − 장부 충당금.
--                   + 이면 대손상각비/충당금, − 이면 충당금/대손충당금환입(없으면 대손상각비 대변).
--   법인세(cit_expense) 차) 법인세비용(없으면 이름 '법인세등') p_amount / 대) 선납세금 min(잔액, p_amount) / 대) 미지급법인세 나머지.
--                   미지급법인세 계정이 없으면 이름 '미지급세금'(표준 계정과목 261)으로 찾는다.
--                   선납세금이 더 많으면 남는 금액(환급)은 분개하지 않는다 — 세무사 확인으로 안내만.
--   발생주의(accrual) 화면이 만든 줄(1~200줄)을 받아 검사만 하고 넣는다: 우리 회사 계정·차/대 중 한쪽만·합 일치·설명 200자·메모 500자.
--   production_voucher_drafts.kind 에 baddebt·accrual·cit_expense 추가(기존 6종 유지).
--
-- 기존 데이터: 바꾸지 않는다(제약은 값을 더하기만).
-- 버린 안: 대손을 거래처별 채권 연령으로 — 거래처별 잔액이 전표 줄에 다 붙어 있지 않다. 설정률 일괄이 결산자료입력 화면의 기본.
--          / 법인세 금액을 DB 에서 계산 — 세무조정·공제감면은 신고본(tax_returns kind='cit')이 원본이라 화면이 그 값을 넘긴다.
--          / 선급·미지급을 계정별 RPC 로 — 경우가 너무 많다(보험료·이자·임차료…). 줄을 받아 검사하는 범용 하나가 낫다.

-- ── 1. 초안 종류 ────────────────────────────────────────────────────────
alter table public.production_voucher_drafts drop constraint if exists production_voucher_drafts_kind_check;
alter table public.production_voucher_drafts add constraint production_voucher_drafts_kind_check check (
  kind = any (array['production', 'cogs', 'inventory', 'payroll', 'depreciation', 'retirement',
                    'baddebt', 'accrual', 'cit_expense']::text[])
);

-- ── 2. 대손충당금 ───────────────────────────────────────────────────────
create or replace function public.make_baddebt_voucher_draft(p_company uuid, p_asof date, p_rate numeric)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_cfg jsonb; a_exp uuid; a_rev uuid; r record; a_rec uuid; a_all uuid; v_rec numeric; v_all numeric; v_target numeric; v_diff numeric;
        t_rec numeric := 0; t_target numeric := 0; t_all numeric := 0; t_diff numeric := 0;
        v_lines jsonb := '[]'::jsonb; l jsonb; v_entry uuid; v_desc text; v_old record;
begin
  perform pg_advisory_xact_lock(hashtextextended('voucher_draft:baddebt:' || p_company::text, 0));   -- 확인→입력 사이 동시 실행을 한 줄로 세운다
  if p_company is null or p_company <> (select public.get_my_company_id()) then raise exception '권한 없음'; end if;
  if p_rate is null or p_rate <= 0 or p_rate > 100 then raise exception '설정률은 0 보다 크고 100 이하여야 합니다'; end if;
  if p_asof is null then raise exception '기준일이 없습니다'; end if;
  select coalesce(settings->'production_voucher', '{}'::jsonb) into v_cfg from company_settings where company_id = p_company; v_cfg := coalesce(v_cfg, '{}'::jsonb);
  a_exp := public._acct_by(p_company, v_cfg, 'acct_baddebt_expense', '대손상각비');
  a_rev := public._acct_by(p_company, v_cfg, 'acct_baddebt_reversal', '대손충당금환입');
  if a_exp is null then raise exception '계정과목 매핑이 없습니다 — 대손상각비 계정을 정해 주세요'; end if;
  a_rev := coalesce(a_rev, a_exp);

  for r in select * from (values ('108', '109'), ('110', '111'), ('120', '121')) as p(rec_code, all_code) loop
    select id into a_rec from chart_of_accounts where company_id = p_company and code = r.rec_code limit 1;
    select id into a_all from chart_of_accounts where company_id = p_company and code = r.all_code limit 1;
    continue when a_rec is null or a_all is null;
    select coalesce(sum(l2.debit - l2.credit), 0) into v_rec from journal_lines l2 join journal_entries e on e.id = l2.entry_id
     where e.company_id = p_company and e.status = 'confirmed' and e.entry_date <= p_asof and l2.account_id = a_rec;
    select coalesce(sum(l2.credit - l2.debit), 0) into v_all from journal_lines l2 join journal_entries e on e.id = l2.entry_id
     where e.company_id = p_company and e.status = 'confirmed' and e.entry_date <= p_asof and l2.account_id = a_all;
    v_target := round(greatest(v_rec, 0) * p_rate / 100);
    v_diff := round(v_target - v_all);
    t_rec := t_rec + v_rec; t_target := t_target + v_target; t_all := t_all + v_all; t_diff := t_diff + v_diff;
    continue when v_diff = 0;
    select coalesce(name, r.rec_code) into v_desc from chart_of_accounts where id = a_rec;
    if v_diff > 0 then
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('a', a_exp, 'd', v_diff, 'c', 0, 't', '대손상각비 (' || v_desc || ' 충당금 설정)'),
        jsonb_build_object('a', a_all, 'd', 0, 'c', v_diff, 't', '대손충당금 (' || v_desc || ')'));
    else
      v_lines := v_lines || jsonb_build_array(
        jsonb_build_object('a', a_all, 'd', -v_diff, 'c', 0, 't', '대손충당금 (' || v_desc || ' 환입)'),
        jsonb_build_object('a', a_rev, 'd', 0, 'c', -v_diff, 't', '대손충당금환입 (' || v_desc || ')'));
    end if;
  end loop;

  if jsonb_array_length(v_lines) = 0 then return null; end if;
  if exists (select 1 from production_voucher_drafts where company_id = p_company and kind = 'baddebt' and status = 'confirmed' and period_to >= p_asof) then
    raise exception '% 이후 대손충당금 전표가 이미 확정돼 있습니다 — 그 전표를 반려한 뒤 다시 만드세요', p_asof;
  end if;
  for v_old in select * from production_voucher_drafts where company_id = p_company and status = 'draft' and kind = 'baddebt' loop
    if v_old.journal_entry_id is not null then delete from journal_entries where id = v_old.journal_entry_id and status = 'ai_suggested'; end if;
    delete from production_voucher_drafts where id = v_old.id;
  end loop;
  v_desc := format('대손충당금 초안 %s 기준 · 설정률 %s%% · 채권 ₩%s · 충당금 목표 ₩%s · 장부 ₩%s · 차액 ₩%s (확정은 사람)',
    p_asof, trim_scale(p_rate), to_char(round(t_rec), 'FM999,999,999,999,999'), to_char(t_target, 'FM999,999,999,999,999'),
    to_char(round(t_all), 'FM999,999,999,999,999'), to_char(t_diff, 'FM999,999,999,999,999'));
  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type, is_approved, supply_amount, vat_amount)
  values (p_company, p_asof, v_desc, 'general', 'rule', 'ai_suggested', 'transfer', false, 0, 0) returning id into v_entry;
  for l in select * from jsonb_array_elements(v_lines) loop
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description)
    values (p_company, v_entry, (l->>'a')::uuid, (l->>'d')::numeric, (l->>'c')::numeric, l->>'t');
  end loop;
  insert into production_voucher_drafts (company_id, kind, period_from, period_to, journal_entry_id, doc_ids, amount_cogs, amount_loss, skipped_lines, memo)
  values (p_company, 'baddebt', date_trunc('month', p_asof)::date, p_asof, v_entry, '{}', t_diff, 0, 0, v_desc);
  return v_entry;
end $function$;

-- ── 3. 법인세비용 ───────────────────────────────────────────────────────
create or replace function public.make_cit_expense_voucher_draft(p_company uuid, p_asof date, p_amount numeric)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare v_cfg jsonb; a_exp uuid; a_pre uuid; a_pay uuid; v_amt numeric; v_pre numeric := 0; v_use numeric; v_pay numeric; v_entry uuid; v_desc text; v_old record;
begin
  perform pg_advisory_xact_lock(hashtextextended('voucher_draft:cit_expense:' || p_company::text, 0));   -- 확인→입력 사이 동시 실행을 한 줄로 세운다
  if p_company is null or p_company <> (select public.get_my_company_id()) then raise exception '권한 없음'; end if;
  if p_amount is null or p_amount <= 0 then raise exception '법인세 금액은 0 보다 커야 합니다'; end if;
  if p_asof is null then raise exception '기준일이 없습니다'; end if;
  v_amt := round(p_amount);
  select coalesce(settings->'production_voucher', '{}'::jsonb) into v_cfg from company_settings where company_id = p_company; v_cfg := coalesce(v_cfg, '{}'::jsonb);
  a_exp := coalesce(public._acct_by(p_company, v_cfg, 'acct_cit_expense', '법인세비용'), public._acct_by(p_company, '{}'::jsonb, 'acct_cit_expense', '법인세등'));
  a_pre := public._acct_by(p_company, v_cfg, 'acct_prepaid_tax', '선납세금');
  a_pay := coalesce(public._acct_by(p_company, v_cfg, 'acct_cit_payable', '미지급법인세'), public._acct_by(p_company, '{}'::jsonb, 'acct_cit_payable', '미지급세금'));
  if a_exp is null then raise exception '계정과목 매핑이 없습니다 — 법인세비용 계정을 정해 주세요'; end if;
  if a_pre is not null then
    select coalesce(sum(l.debit - l.credit), 0) into v_pre from journal_lines l join journal_entries e on e.id = l.entry_id
     where e.company_id = p_company and e.status = 'confirmed' and e.entry_date <= p_asof and l.account_id = a_pre;
  end if;
  v_use := greatest(least(round(v_pre), v_amt), 0);
  v_pay := v_amt - v_use;
  if v_pay > 0 and a_pay is null then raise exception '계정과목 매핑이 없습니다 — 미지급법인세 계정을 정해 주세요'; end if;
  if exists (select 1 from production_voucher_drafts where company_id = p_company and kind = 'cit_expense' and status = 'confirmed' and period_to >= p_asof) then
    raise exception '% 이후 법인세비용 전표가 이미 확정돼 있습니다 — 그 전표를 반려한 뒤 다시 만드세요', p_asof;
  end if;
  for v_old in select * from production_voucher_drafts where company_id = p_company and status = 'draft' and kind = 'cit_expense' loop
    if v_old.journal_entry_id is not null then delete from journal_entries where id = v_old.journal_entry_id and status = 'ai_suggested'; end if;
    delete from production_voucher_drafts where id = v_old.id;
  end loop;
  v_desc := format('법인세비용 초안 %s 기준 · 법인세 등 ₩%s · 선납세금 잔액 ₩%s 중 ₩%s 정리 · 미지급 ₩%s (선납세금이 더 많으면 남는 금액은 환급 — 세무사 확인 · 확정은 사람)',
    p_asof, to_char(v_amt, 'FM999,999,999,999,999'), to_char(round(v_pre), 'FM999,999,999,999,999'),
    to_char(v_use, 'FM999,999,999,999,999'), to_char(v_pay, 'FM999,999,999,999,999'));
  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type, is_approved, supply_amount, vat_amount)
  values (p_company, p_asof, v_desc, 'general', 'rule', 'ai_suggested', 'transfer', false, 0, 0) returning id into v_entry;
  insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_exp, v_amt, 0, '법인세비용 (법인세·지방소득세)');
  if v_use > 0 then
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_pre, 0, v_use, '선납세금 정리');
  end if;
  if v_pay > 0 then
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description) values (p_company, v_entry, a_pay, 0, v_pay, '미지급법인세');
  end if;
  insert into production_voucher_drafts (company_id, kind, period_from, period_to, journal_entry_id, doc_ids, amount_cogs, amount_loss, skipped_lines, memo)
  values (p_company, 'cit_expense', date_trunc('month', p_asof)::date, p_asof, v_entry, '{}', v_amt, 0, 0, v_desc);
  return v_entry;
end $function$;

-- ── 4. 선급·미지급(발생주의) ────────────────────────────────────────────
create or replace function public.make_accrual_voucher_draft(p_company uuid, p_asof date, p_lines jsonb, p_memo text)
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare l jsonb; n int; v_d numeric; v_c numeric; t_d numeric := 0; t_c numeric := 0; v_acc uuid; v_entry uuid; v_desc text; v_old record;
begin
  perform pg_advisory_xact_lock(hashtextextended('voucher_draft:accrual:' || p_company::text, 0));   -- 확인→입력 사이 동시 실행을 한 줄로 세운다
  if p_company is null or p_company <> (select public.get_my_company_id()) then raise exception '권한 없음'; end if;
  if p_asof is null then raise exception '기준일이 없습니다'; end if;
  if p_lines is null or jsonb_typeof(p_lines) <> 'array' then raise exception '분개 줄이 없습니다'; end if;
  n := jsonb_array_length(p_lines);
  if n < 1 or n > 200 then raise exception '분개 줄은 1~200줄입니다'; end if;
  if length(coalesce(p_memo, '')) > 500 then raise exception '메모는 500자까지입니다'; end if;
  for l in select * from jsonb_array_elements(p_lines) loop
    if jsonb_typeof(l) <> 'object' then raise exception '분개 줄 모양이 잘못됐습니다'; end if;
    v_acc := nullif(l->>'account_id', '')::uuid;
    if v_acc is null or not exists (select 1 from chart_of_accounts where id = v_acc and company_id = p_company) then
      raise exception '우리 회사 계정과목이 아닙니다';
    end if;
    v_d := coalesce((l->>'debit')::numeric, 0); v_c := coalesce((l->>'credit')::numeric, 0);
    if v_d < 0 or v_c < 0 then raise exception '금액은 0 이상이어야 합니다'; end if;
    if v_d > 0 and v_c > 0 then raise exception '한 줄에 차변과 대변을 같이 적을 수 없습니다'; end if;
    if length(coalesce(l->>'description', '')) > 200 then raise exception '줄 설명은 200자까지입니다'; end if;
    t_d := t_d + v_d; t_c := t_c + v_c;
  end loop;
  if t_d <> t_c or t_d <= 0 then raise exception '차변·대변 합이 맞지 않습니다'; end if;
  if exists (select 1 from production_voucher_drafts where company_id = p_company and kind = 'accrual' and status = 'confirmed' and period_to >= p_asof) then
    raise exception '% 이후 선급·미지급 정리 전표가 이미 확정돼 있습니다 — 그 전표를 반려한 뒤 다시 만드세요', p_asof;
  end if;
  for v_old in select * from production_voucher_drafts where company_id = p_company and status = 'draft' and kind = 'accrual' loop
    if v_old.journal_entry_id is not null then delete from journal_entries where id = v_old.journal_entry_id and status = 'ai_suggested'; end if;
    delete from production_voucher_drafts where id = v_old.id;
  end loop;
  v_desc := format('선급·미지급 정리 초안 %s 기준 · %s줄 · 합계 ₩%s%s (확정은 사람)',
    p_asof, n, to_char(t_d, 'FM999,999,999,999,999'), coalesce(' · ' || nullif(trim(p_memo), ''), ''));
  insert into journal_entries (company_id, entry_date, description, entry_kind, source, status, voucher_type, is_approved, supply_amount, vat_amount)
  values (p_company, p_asof, v_desc, 'general', 'rule', 'ai_suggested', 'transfer', false, 0, 0) returning id into v_entry;
  for l in select * from jsonb_array_elements(p_lines) loop
    insert into journal_lines (company_id, entry_id, account_id, debit, credit, description)
    values (p_company, v_entry, (l->>'account_id')::uuid, coalesce((l->>'debit')::numeric, 0), coalesce((l->>'credit')::numeric, 0), coalesce(nullif(trim(l->>'description'), ''), '선급·미지급 정리'));
  end loop;
  insert into production_voucher_drafts (company_id, kind, period_from, period_to, journal_entry_id, doc_ids, amount_cogs, amount_loss, skipped_lines, memo)
  values (p_company, 'accrual', date_trunc('month', p_asof)::date, p_asof, v_entry, '{}', t_d, 0, 0, v_desc);
  return v_entry;
end $function$;

revoke all on function public.make_baddebt_voucher_draft(uuid, date, numeric) from public, anon;
revoke all on function public.make_cit_expense_voucher_draft(uuid, date, numeric) from public, anon;
revoke all on function public.make_accrual_voucher_draft(uuid, date, jsonb, text) from public, anon;
grant execute on function public.make_baddebt_voucher_draft(uuid, date, numeric) to authenticated;
grant execute on function public.make_cit_expense_voucher_draft(uuid, date, numeric) to authenticated;
grant execute on function public.make_accrual_voucher_draft(uuid, date, jsonb, text) to authenticated;
