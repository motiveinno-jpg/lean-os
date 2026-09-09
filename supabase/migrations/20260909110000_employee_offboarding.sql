-- 퇴사 처리 기록 (2026-09-09) — 상실사유·오프보딩 체크리스트를 실제로 저장한다.
--   종전엔 퇴사 모달의 상실사유 드롭다운·체크리스트가 화면에서 고르기만 하고 저장되지 않아
--   무엇을 누가 언제 했는지 남지 않았다(되는 척하던 UI).
--   구조: { loss_reason, loss_reason_label, checklist: {equipment,systemAccess,handover,insurance},
--          completed_by, completed_at }
alter table public.employees
  add column if not exists offboarding jsonb;
