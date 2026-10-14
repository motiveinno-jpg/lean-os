-- 국세청 기록 정기 확인 — 우리 회사와 거래처의 사업자 상태가 바뀐 것을 사람보다 먼저 안다.
--
--   사업자번호는 가입·등록할 때 한 번 확인하고 끝이었다. 그 뒤 거래처가 폐업하면 세금계산서를 받아도
--   매입세액을 못 받는데(폐업일 이후 발행분), 화면은 그대로라 신고 때나 알게 된다. 회사 기초정보의
--   대표자·개업일도 한 번 틀리게 들어가면(지원사업 회사 카드 2017-01-01, 2026-10) 아무도 다시 안 본다.
--
--   매주 월요일 아침 nts-status-check 엣지가 국세청 공개 API 로 확인하고 결과를 record_nts_findings 로 넘긴다.
--   ① company_business_status  — 우리 회사 번호가 휴업·폐업·미등록
--   ② company_profile_mismatch — 회사 기초정보의 번호+대표자+개업일이 국세청 진위확인과 다름(어느 칸인지는 국세청이 안 알려 준다)
--   ③ partner_business_status  — 거래처 번호가 휴업·폐업·미등록
--   국세청 호출이 실패한 종류는 넘기지 않는다 — 실패를 '문제 없음'으로 읽어 열린 건을 해결로 돌리지 않게.
--   결과는 매일 숫자 대조와 같은 표(reconciliation_findings). 새로 생긴 건만 대표(마스터)에게 알린다.
--   회사 데이터를 만드는 자동화라 feature_rollout('nts_status_check') 으로 모티브부터.

alter table public.reconciliation_findings drop constraint if exists reconciliation_findings_kind_check;
alter table public.reconciliation_findings add constraint reconciliation_findings_kind_check check (kind in (
  'bank_balance_mismatch', 'bank_balance_gap', 'bank_duplicate', 'card_duplicate',
  'company_business_status', 'company_profile_mismatch', 'partner_business_status'));

-- 확인할 회사·번호 목록
create or replace function public.nts_check_targets()
returns jsonb language sql stable security definer set search_path = public as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'company_id', co.id,
           'business_number', regexp_replace(coalesce(co.business_number, ''), '\D', '', 'g'),
           'representative', nullif(trim(coalesce(co.representative, '')), ''),
           'open_date', (select px.open_date from public.company_profile_ext px where px.company_id = co.id),
           'partners', coalesce((
             select jsonb_agg(jsonb_build_object('id', p.id, 'name', p.name, 'business_number', regexp_replace(p.business_number, '\D', '', 'g')))
               from public.partners p
              where p.company_id = co.id and coalesce(p.is_active, true)
                and length(regexp_replace(coalesce(p.business_number, ''), '\D', '', 'g')) = 10), '[]'::jsonb)
         )), '[]'::jsonb)
    from public.companies co
   where public.feature_on('nts_status_check', co.id);
$$;

-- 결과 기록 + 새 건 알림. p_kinds = 이번에 확인을 마친 종류(이 종류에서 이번에 안 나온 열린 건은 해결로)
create or replace function public.record_nts_findings(p_company uuid, p_kinds text[], p_findings jsonb)
returns int language plpgsql security definer set search_path = public as $$
#variable_conflict use_column
declare v_run timestamptz := now(); v_new int; v_lines text; v_partner_only boolean;
begin
  if p_kinds is null or cardinality(p_kinds) = 0 then return 0; end if;
  --   같은 회사 기록이 겹쳐 돌면(수동 실행 + 크론) 같은 건을 두 번 알린다 — 회사 단위로 한 줄로 세운다
  perform pg_advisory_xact_lock(hashtextextended('nts_findings:' || p_company::text, 0));
  if exists (select 1 from unnest(p_kinds) k where k not in ('company_business_status', 'company_profile_mismatch', 'partner_business_status')) then
    raise exception 'record_nts_findings: unknown kind in %', p_kinds;
  end if;

  insert into public.reconciliation_findings as f (company_id, kind, subject_key, title, detail, last_seen_at, first_seen_at)
  select p_company, x->>'kind', x->>'subject_key', x->>'title', coalesce(x->'detail', '{}'::jsonb), v_run, v_run
    from jsonb_array_elements(coalesce(p_findings, '[]'::jsonb)) x
   where x->>'kind' = any (p_kinds)
  on conflict (company_id, kind, subject_key) do update
    set title = excluded.title, detail = excluded.detail, last_seen_at = v_run,
        seen_count = case when f.resolved_at is null then f.seen_count + 1 else 1 end,
        first_seen_at = case when f.resolved_at is null then f.first_seen_at else v_run end,
        notified_at = case when f.resolved_at is null then f.notified_at else null end,
        resolved_at = null;

  update public.reconciliation_findings f set resolved_at = v_run
   where f.company_id = p_company and f.kind = any (p_kinds) and f.resolved_at is null and f.last_seen_at < v_run;

  select count(*), string_agg('· ' || x.title, E'\n' order by x.kind, x.first_seen_at) filter (where x.rn <= 5),
         bool_and(x.kind = 'partner_business_status')
    into v_new, v_lines, v_partner_only
    from (select f.*, row_number() over (order by f.kind, f.first_seen_at) rn
            from public.reconciliation_findings f
           where f.company_id = p_company and f.kind = any (p_kinds) and f.resolved_at is null and f.notified_at is null) x;

  if v_new > 0 then
    insert into public.notifications (company_id, user_id, type, title, message, link)
    select p_company, u.id, 'system', '국세청 기록 확인에서 확인할 곳이 있습니다',
           '새로 ' || v_new || '건' || E'\n' || v_lines || case when v_new > 5 then E'\n… 외 ' || (v_new - 5) || '건' else '' end,
           case when v_partner_only then '/partners' else '/settings/company' end
      from public.users u
     where u.company_id = p_company and u.is_master;
    update public.reconciliation_findings f set notified_at = v_run
     where f.company_id = p_company and f.kind = any (p_kinds) and f.resolved_at is null and f.notified_at is null;
  end if;
  return v_new;
end $$;

revoke all on function public.nts_check_targets() from public, anon, authenticated;
revoke all on function public.record_nts_findings(uuid, text[], jsonb) from public, anon, authenticated;
grant execute on function public.nts_check_targets() to service_role;
grant execute on function public.record_nts_findings(uuid, text[], jsonb) to service_role;

-- 크론 호출 인증 — 값은 금고에서 만들고 엣지 환경변수 NTS_CHECK_SECRET 에 같은 값을 넣는다(저장소에 안 남긴다)
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'nts_check_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(24), 'hex'), 'nts_check_secret', 'nts-status-check 크론 호출 인증');
  end if;
end $$;

do $$ begin
  perform cron.unschedule(jobid) from cron.job where jobname = 'nts-status-check-weekly';
  perform cron.schedule('nts-status-check-weekly', '10 23 * * 0', $cron$
    select net.http_post(
      url := 'https://njbvdkuvtdtkxyylwngn.supabase.co/functions/v1/nts-status-check',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'nts_check_secret')),
      body := '{}'::jsonb,
      timeout_milliseconds := 120000
    );
  $cron$);   -- 월요일 08:10 KST
end $$;

insert into public.feature_rollout (feature, company_id, note)
select 'nts_status_check', 'c361afb9-8a52-4cac-add9-8992f0f7c09c', '국세청 기록 정기 확인 — 모티브 먼저'
where not exists (select 1 from public.feature_rollout where feature = 'nts_status_check');
