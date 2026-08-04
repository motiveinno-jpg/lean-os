-- 플랫폼 운영자가 고객 문의 첨부(스크린샷)를 열람 — 답변 작성에 필요 (2026-08-04)
-- support_tickets 자체는 이미 is_platform_operator() 로 전사 열람 허용 — 스토리지에도 동일 예외.
-- SELECT 만 허용(운영자가 고객 첨부를 수정·삭제할 일은 없다).
drop policy if exists support_attachments_operator on storage.objects;
create policy support_attachments_operator on storage.objects
  for select
  using (bucket_id = 'support-attachments' and is_platform_operator());
