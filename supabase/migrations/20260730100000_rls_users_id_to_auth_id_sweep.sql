-- RLS 정책의 잘못된 신원 매핑 일괄 교정 (2026-07-30, 이미 MCP 로 prod 적용 — 기록용)
--   증상: ekwjd5926(admin) 연차 부여 403 (운영자 오류 로그).
--   원인: 27개 정책(10개 테이블: cash_receipts·leave_grants·permission_group*·
--         tax_invoice_queue·partner_communications·deal_files·deal_cost_schedule·
--         hometax_sync_log·loan_payments)이 `users.id = auth.uid()` 로 신원 대조.
--         표준 매핑은 get_my_company_id() 와 동일한 `users.auth_id = auth.uid()`.
--         대부분은 id == auth_id 라 우연히 통과했지만 레거시 불일치 계정은 전부 차단.
--   수정: 기존 정책 식을 읽어 해당 구절만 치환 후 ALTER POLICY (타 조건 무변경).
--         적용 후 잘못된 패턴 잔여 0 확인.
do $$
declare r record; q text; w text; sqlcmd text;
begin
  for r in
    select schemaname, tablename, policyname, qual, with_check from pg_policies
    where (coalesce(qual,'') like '%users.id = ( SELECT auth.uid() AS uid)%'
        or coalesce(with_check,'') like '%users.id = ( SELECT auth.uid() AS uid)%'
        or coalesce(qual,'') like '%users.id = auth.uid()%'
        or coalesce(with_check,'') like '%users.id = auth.uid()%')
  loop
    q := replace(replace(r.qual,
           'users.id = ( SELECT auth.uid() AS uid)', 'users.auth_id = ( SELECT auth.uid() AS uid)'),
           'users.id = auth.uid()', 'users.auth_id = auth.uid()');
    w := replace(replace(r.with_check,
           'users.id = ( SELECT auth.uid() AS uid)', 'users.auth_id = ( SELECT auth.uid() AS uid)'),
           'users.id = auth.uid()', 'users.auth_id = auth.uid()');
    sqlcmd := format('alter policy %I on %I.%I', r.policyname, r.schemaname, r.tablename);
    if q is not null then sqlcmd := sqlcmd || format(' using (%s)', q); end if;
    if w is not null then sqlcmd := sqlcmd || format(' with check (%s)', w); end if;
    execute sqlcmd;
  end loop;
end $$;
