-- 고객센터 문의 사진 첨부 (2026-08-04 사장님: 전화 CS 폐지·문의함 일원화, 스크린샷 첨부 → 추후 AI 자동 분석)
-- 형식: attachments = [{ path, name, size }] (path = support-attachments 버킷 내 경로)
alter table public.support_tickets add column if not exists attachments jsonb;

-- 전용 프라이빗 버킷 — 스크린샷에 민감정보(금액·거래처)가 찍힐 수 있어 public 금지, 서명 URL로만 열람.
insert into storage.buckets (id, name, public)
values ('support-attachments', 'support-attachments', false)
on conflict (id) do nothing;

-- 회사 폴더 스코프 정책 — task-attachments 와 동일 패턴 (첫 폴더 = 본인 회사 id)
drop policy if exists support_attachments_company on storage.objects;
create policy support_attachments_company on storage.objects
  for all
  using (bucket_id = 'support-attachments' and (storage.foldername(name))[1] = (get_my_company_id())::text)
  with check (bucket_id = 'support-attachments' and (storage.foldername(name))[1] = (get_my_company_id())::text);
