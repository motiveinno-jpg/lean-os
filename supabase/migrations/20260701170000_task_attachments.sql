-- 실행형 태스크 첨부(이미지·파일) (2026-07-01)
--   project_tasks 에 attachments jsonb 추가 + 전용 스토리지 버킷(task-attachments).
--   attachments = [{ id, name, path, type, size }]. 파일은 {company_id}/{uuid}/{name} 경로.
--   컬럼/버킷만 추가(기존 불변 → 회귀 0). 회사스코프 RLS(경로 첫 세그먼트 = company_id).

alter table public.project_tasks
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- 스토리지 버킷 (private) + 회사 폴더 격리
insert into storage.buckets (id, name, public)
  values ('task-attachments', 'task-attachments', false)
  on conflict (id) do nothing;

drop policy if exists task_attachments_company on storage.objects;
create policy task_attachments_company on storage.objects
  for all
  using (bucket_id = 'task-attachments' and (storage.foldername(name))[1] = public.get_my_company_id()::text)
  with check (bucket_id = 'task-attachments' and (storage.foldername(name))[1] = public.get_my_company_id()::text);
