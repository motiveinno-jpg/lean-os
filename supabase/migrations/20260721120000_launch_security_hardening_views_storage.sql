-- 1) SECURITY DEFINER 뷰 → security_invoker (테넌트 격리 복원)
alter view public.v_deal_goal_actual set (security_invoker = on);
alter view public.v_deal_revenue_actual set (security_invoker = on);

-- 2) chat-files: 전면 개방 정책 4개 교체 — 채널 참여자만
drop policy if exists chat_files_select on storage.objects;
drop policy if exists chat_files_insert on storage.objects;
drop policy if exists chat_files_update on storage.objects;
drop policy if exists chat_files_delete on storage.objects;

create policy chat_files_select on storage.objects for select to authenticated
using (
  bucket_id = 'chat-files'
  and (storage.foldername(name))[1] in (
    select cp.channel_id::text from public.chat_participants cp
    join public.users u on u.id = cp.user_id
    where u.auth_id = auth.uid()
  )
);

create policy chat_files_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-files'
  and (storage.foldername(name))[1] in (
    select cp.channel_id::text from public.chat_participants cp
    join public.users u on u.id = cp.user_id
    where u.auth_id = auth.uid()
  )
);
-- UPDATE/DELETE 정책은 재생성하지 않음(앱이 채팅 파일 수정·삭제 기능 없음 → default deny)

-- 3) company-assets: SELECT 를 회사 폴더 스코프로 (signed URL 발급 경로 유지)
drop policy if exists company_assets_select on storage.objects;
create policy company_assets_select on storage.objects for select to authenticated
using (
  bucket_id = 'company-assets'
  and (storage.foldername(name))[1] = (get_my_company_id())::text
);
