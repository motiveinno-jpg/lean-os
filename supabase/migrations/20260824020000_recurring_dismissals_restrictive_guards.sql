-- recurring_dismissals: advisor 읽기전용 가드를 RESTRICTIVE 로 교정 (2026-08-24 보안)
--
-- 사고: 20260824010000_recurring_dismissals.sql 이 advisor_ro_ins/upd/del 3개를 만들 때
--   정본 패턴(20260811200000_advisor_app_access.sql)과 달리 `as restrictive` 를 빠뜨렸다.
--   PERMISSIVE 정책은 OR 로 결합되므로, 일반(비-advisor) 사용자에게는
--     · INSERT WITH CHECK = (company=내회사) OR (not advisor) = TRUE  → 임의 company_id 주입
--     · UPDATE/DELETE USING = (company=내회사) OR (not advisor) = TRUE → 모든 회사 행 수정/삭제
--   즉 company_id 격리가 무력화됐다. `DELETE FROM recurring_dismissals` 한 번에 전사 삭제 가능.
--   (SELECT 는 recurring_dismissals_company 만 적용돼 격리 유지 — 읽기는 안전했다.)
--
-- 교정: 세 가드를 RESTRICTIVE 로 재생성한다. RESTRICTIVE 는 AND 로 결합되므로
--   회사 격리(recurring_dismissals_company)와 함께 강제되고, advisor 세션의 쓰기도 원래 의도대로 막힌다.

drop policy if exists advisor_ro_ins on public.recurring_dismissals;
create policy advisor_ro_ins on public.recurring_dismissals
  as restrictive for insert to authenticated
  with check (not (select public.is_advisor_session()));

drop policy if exists advisor_ro_upd on public.recurring_dismissals;
create policy advisor_ro_upd on public.recurring_dismissals
  as restrictive for update to authenticated
  using (not (select public.is_advisor_session()));

drop policy if exists advisor_ro_del on public.recurring_dismissals;
create policy advisor_ro_del on public.recurring_dismissals
  as restrictive for delete to authenticated
  using (not (select public.is_advisor_session()));
