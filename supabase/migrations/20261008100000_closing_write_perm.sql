-- 월 마감(체크리스트·잠금·확정본) 쓰기 = 마스터 | 회계마감 권한자 — 2026-10-08 결산 진입로 점검 (docs/20261007_PLAN_erp_gap_audit3.md ⑨)
--
-- 왜: closing_checklists·items·snapshots 의 정책은 company_isolation(같은 회사면 ALL) 하나뿐이었다.
--     화면(월 마감 위젯)이 마스터 화면에만 있어 가려져 있었을 뿐, 직원도 API 로 달을 잠그거나 풀 수 있었다.
--     이번에 마감 판을 재무 › 전표 현황 › 처리할 것으로 옮기면서(보는 사람이 늘어난다) 쓰기 권한을 DB 에서 고정한다.
--
-- 규칙 (사장님 2026-10-08 "마스터와 회계마감 권한자"):
--   읽기 = 그대로(같은 회사) — 전표 입력 화면들이 잠긴 달인지 읽어야 한다(bank-line-dialog·voucher-entry·ledger·settlements).
--   쓰기(INSERT·UPDATE·DELETE) = has_perm('/settings:closing') OR has_perm('/settings:tax')
--     · has_perm 은 마스터를 이미 포함한다.
--     · '/settings:tax' 는 회계마감 탭의 옛 키 — 설정 화면이 OR 로 받아 주는 것과 같게(lib/settings-nav.ts perms ["closing","tax"]).
--   RESTRICTIVE 로 건다 — 기존 company_isolation(회사 경계)은 그대로 두고 그 위에 권한을 AND 로 더한다.
--
-- 기존 데이터: 바꾸지 않는다(체크리스트 12건 전부 open, 확정본 0건).
-- 파급: 화면에서 체크리스트를 '보기만 해도 만들던' 곳(경영흐름 ⑥·마스터 위젯)은 같은 커밋에서 읽기 전용으로 바꿨다 —
--       권한 없는 사람이 열면 INSERT 가 거절돼 화면이 깨지지 않게.
-- 버린 안: 상태 전이만 막는 트리거(open→completed→locked) — 항목 체크·자동 검증도 마감 작업이라 권한자 몫이고,
--          정책 하나가 트리거보다 읽기 쉽다.

create policy closing_write_perm_ins on public.closing_checklists as restrictive for insert to authenticated
  with check ((select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax')));
create policy closing_write_perm_upd on public.closing_checklists as restrictive for update to authenticated
  using ((select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax')))
  with check ((select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax')));
create policy closing_write_perm_del on public.closing_checklists as restrictive for delete to authenticated
  using ((select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax')));

create policy closing_write_perm_ins on public.closing_checklist_items as restrictive for insert to authenticated
  with check ((select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax')));
create policy closing_write_perm_upd on public.closing_checklist_items as restrictive for update to authenticated
  using ((select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax')))
  with check ((select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax')));
create policy closing_write_perm_del on public.closing_checklist_items as restrictive for delete to authenticated
  using ((select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax')));

create policy closing_write_perm_ins on public.closing_snapshots as restrictive for insert to authenticated
  with check ((select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax')));
create policy closing_write_perm_upd on public.closing_snapshots as restrictive for update to authenticated
  using ((select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax')))
  with check ((select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax')));
create policy closing_write_perm_del on public.closing_snapshots as restrictive for delete to authenticated
  using ((select public.has_perm('/settings:closing')) or (select public.has_perm('/settings:tax')));
