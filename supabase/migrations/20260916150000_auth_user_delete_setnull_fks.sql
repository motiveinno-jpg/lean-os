-- 퇴사 시 auth 계정 삭제(offboard_member)를 막던 FK 둘을 ON DELETE SET NULL 로 바꾼다.
--   deal_files.uploaded_by, sync_logs.synced_by 가 NO ACTION 이라 auth.users 삭제가 FK 위반으로 막혔다.
--   둘 다 '누가 올렸나/돌렸나' 귀속 컬럼(nullable)이고, auth.users 를 참조하는 다른 귀속 컬럼들은 이미 SET NULL/CASCADE 다.
--   계정이 지워지면 귀속만 비면 되므로 SET NULL 이 맞다(기록 자체는 남는다).

alter table public.deal_files drop constraint if exists deal_files_uploaded_by_fkey;
alter table public.deal_files
  add constraint deal_files_uploaded_by_fkey
  foreign key (uploaded_by) references auth.users(id) on delete set null;

alter table public.sync_logs drop constraint if exists sync_logs_synced_by_fkey;
alter table public.sync_logs
  add constraint sync_logs_synced_by_fkey
  foreign key (synced_by) references auth.users(id) on delete set null;
