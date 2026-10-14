-- 결산자료입력 초안 RPC 보강 — 2026-10-14 보안 검토 후속 (20261014170000_closing_adjustment_drafts.sql)
--
-- 왜: ① 세 RPC 는 '우리 회사' 만 확인해 회사 사람이면 누구나 결산 정리분개 초안을 만들고(=같은 kind 의 남의 초안을 지우고) 있었다.
--        월 마감 쓰기 권한(20261008100000_closing_write_perm.sql)과 기준이 달랐다.
--     ② 금액에 NaN·Infinity·터무니없는 값이 들어갈 수 있었고, 발생주의 줄은 0/0 줄도 받았다.
--     ③ 잠긴(마감) 달에도 초안이 만들어져, 확정하려 할 때에야 PERIOD_LOCKED 로 막혔다.
--
-- 규칙:
--   ① 회사 확인 바로 다음: 마스터(is_company_admin) OR /settings:closing OR /settings:tax — 아니면 42501.
--      make_retirement_voucher_draft 에도 같은 확인을 단다 — 크론·시스템 경로에서 부르지 않는다(확인: run_production_voucher_cycles·
--      다른 함수 본문·pg_cron 어디에도 없음. 화면 두 곳 retirement-dialog·전표 현황 마감 판에서만 부른다).
--   ② 법인세 금액: NaN 이 아니고 0 < x < 1e15. 발생주의 줄: 차·대 모두 NaN 아님·0 ≤ x < 1e15, 정확히 한쪽만 > 0.
--   ③ 기준일이 속한 달이 closing_checklists 'locked' 면 거절 — 전표 RPC 의 PERIOD_LOCKED 와 같은 조건·같은 머리말
--      (화면들이 message.includes('PERIOD_LOCKED') 로 가른다). 퇴직급여충당은 이번에 손대지 않는다(권한만).
--   나머지 본문은 20261014170000 / 20260928270000 그대로.
--
-- 기존 데이터: 바꾸지 않는다.
-- 버린 안: 권한을 has_perm('/finance/tax-filing') 으로 — 결산 정리분개는 세무 신고가 아니라 회계마감 몫이다(월 마감과 같은 기준).
--          / 퇴직급여충당 초안을 급여 권한(/employees:salary)에도 열어 두기 — 전표 초안을 지우고 다시 만드는 일이라 회계마감 권한으로 통일.

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
  if not ((select public.is_company_admin()) or (select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax'))) then
    raise exception '결산 초안은 마스터·회계마감 권한자만 만듭니다' using errcode = '42501';
  end if;
  if p_asof is null then raise exception '기준일이 없습니다'; end if;
  if exists (select 1 from closing_checklists cc
             where cc.company_id = p_company and cc.month = to_char(p_asof, 'YYYY-MM') and cc.status = 'locked') then
    raise exception 'PERIOD_LOCKED — 그 달은 마감(잠금)돼 있습니다 — 마감을 풀고 다시 만드세요';
  end if;
  if p_rate is null or p_rate <= 0 or p_rate > 100 then raise exception '설정률은 0 보다 크고 100 이하여야 합니다'; end if;
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
  if not ((select public.is_company_admin()) or (select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax'))) then
    raise exception '결산 초안은 마스터·회계마감 권한자만 만듭니다' using errcode = '42501';
  end if;
  if p_asof is null then raise exception '기준일이 없습니다'; end if;
  if exists (select 1 from closing_checklists cc
             where cc.company_id = p_company and cc.month = to_char(p_asof, 'YYYY-MM') and cc.status = 'locked') then
    raise exception 'PERIOD_LOCKED — 그 달은 마감(잠금)돼 있습니다 — 마감을 풀고 다시 만드세요';
  end if;
  if p_amount is null or p_amount = 'NaN'::numeric or not (p_amount > 0 and p_amount < 1e15) then raise exception '법인세 금액은 0 보다 크고 1,000조 미만이어야 합니다'; end if;
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
  if not ((select public.is_company_admin()) or (select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax'))) then
    raise exception '결산 초안은 마스터·회계마감 권한자만 만듭니다' using errcode = '42501';
  end if;
  if p_asof is null then raise exception '기준일이 없습니다'; end if;
  if exists (select 1 from closing_checklists cc
             where cc.company_id = p_company and cc.month = to_char(p_asof, 'YYYY-MM') and cc.status = 'locked') then
    raise exception 'PERIOD_LOCKED — 그 달은 마감(잠금)돼 있습니다 — 마감을 풀고 다시 만드세요';
  end if;
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
    if v_d = 'NaN'::numeric or v_c = 'NaN'::numeric or not (v_d >= 0 and v_d < 1e15 and v_c >= 0 and v_c < 1e15) then
      raise exception '금액은 0 이상 1,000조 미만이어야 합니다';
    end if;
    if (v_d > 0) = (v_c > 0) then raise exception '한 줄에는 차변 또는 대변 한쪽에만 금액을 적습니다'; end if;
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
  if not ((select public.is_company_admin()) or (select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax'))) then
    raise exception '결산 초안은 마스터·회계마감 권한자만 만듭니다' using errcode = '42501';
  end if;
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
