-- 세무대리인 쓰기 가드(advisor_ro_ins/upd/del)를 RESTRICTIVE 로 교정 — 23개 표 (2026-10-06 보안, 사장님 "진행해줘")
--
-- 사고: 정본 패턴(20260811200000_advisor_app_access.sql)은 `as restrictive` 인데, 2026-08-25 재고 1단계부터
--   새 표를 만들 때 그 구절이 빠진 채 복사됐다(08-24 recurring_dismissals 에서 한 번 고친 것과 같은 실수 — 20260824020000).
--   PERMISSIVE 정책은 OR 로 묶이므로 일반 사용자에게 INSERT WITH CHECK = (내 회사) OR (세무대리인 아님) = TRUE.
--   운영 실측(롤백 시험): QA 시드 직원이 모티브 회사 앞으로 창고 행 INSERT 성공. 남의 회사 행 UPDATE·DELETE 는
--   WHERE 가 있으면 SELECT 정책(회사)에 걸려 0행이었다. 세무대리인 쓰기 금지도 같은 이유로 무력했다.
--   피해 흔적: 작성자 칸이 있는 15개 표에서 다른 회사 사람이 쓴 행 0건.
--
-- 교정: 23개 표의 세 가드를 지우고 RESTRICTIVE 로 다시 만든다(식은 정본과 같다). 23개 표 모두 회사 격리 PERMISSIVE
--   정책(ALL)이 따로 있어 정상 저장은 그대로다. 데이터 변경 없음.
-- 재발 방지: scripts/check-rls-advisor-restrictive.mjs (advisor_ro_* 를 만드는 마이그레이션에 as restrictive 가 없으면 실패).

do $$
declare t text;
begin
  foreach t in array array[
    'account_budgets','biz_alert_rules','channel_order_imports','closing_snapshots','company_insurance_rates',
    'fixed_assets','form_layouts','hr_appointments','insurance_notices','order_lines','orders','partner_prices',
    'product_boms','product_channel_codes','products','shipping_sheet_layouts','stock_count_lines','stock_counts',
    'stock_docs','stock_moves','warehouses','work_orders','year_end_tax_status'
  ] loop
    execute format('drop policy if exists advisor_ro_ins on public.%I', t);
    execute format('drop policy if exists advisor_ro_upd on public.%I', t);
    execute format('drop policy if exists advisor_ro_del on public.%I', t);
    execute format('create policy advisor_ro_ins on public.%I as restrictive for insert to authenticated with check (not (select public.is_advisor_session()))', t);
    execute format('create policy advisor_ro_upd on public.%I as restrictive for update to authenticated using (not (select public.is_advisor_session()))', t);
    execute format('create policy advisor_ro_del on public.%I as restrictive for delete to authenticated using (not (select public.is_advisor_session()))', t);
  end loop;
end $$;
