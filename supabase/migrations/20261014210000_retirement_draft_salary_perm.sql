-- 퇴직급여충당 초안 — 급여 권한자도 허용 (20261014180000_closing_adjustment_drafts_harden.sql 조정)
--
-- 왜: 직전 보강에서 make_retirement_voucher_draft 를 마스터·회계마감 권한자로 좁혔더니, 인사 › 퇴직금 창(retirement-dialog)에서
--     급여 권한(/employees:salary)만 가진 담당자가 '충당 전표 초안'을 못 만들게 됐다.
--
-- 규칙: 권한 = 마스터 OR /settings:closing OR /settings:tax OR /employees:salary — 아니면 42501.
--       이 RPC 는 금액을 받지 않고 DB(estimate_retirement·장부 잔액)에서 계산하므로, 호출자가 숫자를 바꿔 넣는 위험이 없다.
--       나머지 본문은 20261014180000 그대로. 대손·법인세·발생주의 초안 3종은 회계마감 권한 그대로 둔다.
--
-- 기존 데이터: 바꾸지 않는다.
-- 버린 안: 급여 권한자용 별도 RPC — 같은 초안(kind 'retirement')을 두 길로 만들면 지우고 다시 만드는 규칙이 갈린다.

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
  if not ((select public.is_company_admin()) or (select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax')) or (select public.has_perm('/employees:salary'))) then
    raise exception '퇴직급여충당 초안은 마스터·회계마감·급여 권한자만 만듭니다' using errcode = '42501';
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
