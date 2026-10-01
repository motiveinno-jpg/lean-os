-- 결재 단계 삭제 — 결재를 올린 사람이, 아직 승인되지 않은 자기 결재의 단계만 (2026-10-01).
--   History: approval_steps 에 허용 DELETE 정책이 없어(제한 정책 advisor_ro_del 뿐) 화면의 단계 삭제가 오류 없이 0건이었다.
--   재상신(resubmitRequest)은 '옛 단계 삭제 → 새 단계 생성' 이라, 반려된 옛 단계가 남은 채 새 단계가 붙어
--   그 단계는 '모두 승인'이 될 수 없어 재상신 결재가 영원히 멈췄다(운영 재상신 기록 0건 — 피해 없음).
--   결재 요청 삭제는 FK ON DELETE CASCADE 라 원래 단계도 같이 지워졌다(영향 없음).
--   기존 데이터 무변경. 롤백 시험: 남의 단계 삭제 0 · 재상신 삭제 1 → 새 단계 1 · 승인된 결재 단계 삭제 0.
create or replace function public._approval_request_status(p_request uuid)
returns text language sql stable security definer set search_path = public as $$
  select status from public.approval_requests where id = p_request
$$;
revoke all on function public._approval_request_status(uuid) from public, anon;
grant execute on function public._approval_request_status(uuid) to authenticated;

drop policy if exists "Approval steps deletable by requester before approval" on public.approval_steps;
create policy "Approval steps deletable by requester before approval" on public.approval_steps
  for delete to authenticated
  using (public._approval_request_requester(request_id) = public.current_app_user_id()
         and public._approval_request_status(request_id) is distinct from 'approved');
