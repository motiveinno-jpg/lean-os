-- RLS 정책 안의 get_my_company_id()·has_perm('…')·auth.uid() 를 (select …) 로 감싼다.
--   맨몸으로 쓰면 행마다 함수를 다시 부른다(security definer 라 인라인이 안 됨). 거래처 원장처럼
--   journal_lines·chart_of_accounts 를 수천 줄 훑는 조회가 0.9초, PostgREST 임베드 조회는 평균 2.2초·최대 7.9초까지 걸려
--   8초 statement timeout 에 걸렸다(2026-09-09 원장 화면 500). (select …) 로 감싸면 한 번만 계산해 InitPlan 으로 쓴다.
--   의미는 그대로다 — 같은 값을 한 번 계산하느냐 행마다 계산하느냐의 차이.
begin;
create function pg_temp._rls_wrap(e text) returns text language sql immutable as $$
  select case when e is null then null else
    regexp_replace(regexp_replace(regexp_replace(regexp_replace(
      regexp_replace(regexp_replace(regexp_replace(e,
        '\( SELECT get_my_company_id\(\) AS get_my_company_id\)', 'get_my_company_id()', 'g'),
        '\( SELECT auth\.uid\(\) AS uid\)', 'auth.uid()', 'g'),
        '\( SELECT has_perm\((''[^'']*''::text)\) AS has_perm\)', 'has_perm(\1)', 'g'),
      'get_my_company_id\(\)', '(select get_my_company_id())', 'g'),
      'auth\.uid\(\)', '(select auth.uid())', 'g'),
      'has_perm\((''[^'']*''::text)\)', '(select has_perm(\1))', 'g'),
      '\( SELECT is_advisor_session\(\) AS is_advisor_session\)', '(select is_advisor_session())', 'g')
  end
$$;

do $$
declare
  r record; q text; w text; stmt text; n int := 0;
  bare constant text := '(^|[^T] )(get_my_company_id|auth\.uid|has_perm)\(';
begin
  for r in
    select p.polname, c.relname, p.polcmd,
           pg_get_expr(p.polqual, p.polrelid) as q, pg_get_expr(p.polwithcheck, p.polrelid) as w
      from pg_policy p join pg_class c on c.oid = p.polrelid join pg_namespace ns on ns.oid = c.relnamespace
     where ns.nspname = 'public'
       and (coalesce(pg_get_expr(p.polqual, p.polrelid), '') ~ bare or coalesce(pg_get_expr(p.polwithcheck, p.polrelid), '') ~ bare)
  loop
    q := pg_temp._rls_wrap(r.q); w := pg_temp._rls_wrap(r.w);
    stmt := format('alter policy %I on public.%I', r.polname, r.relname);
    if r.polcmd <> 'a' and q is not null then stmt := stmt || ' using (' || q || ')'; end if;
    if r.polcmd in ('a', 'w', '*') and w is not null then stmt := stmt || ' with check (' || w || ')'; end if;
    execute stmt; n := n + 1;
  end loop;
  raise notice 'rls policies rewrapped: %', n;
end $$;
commit;
