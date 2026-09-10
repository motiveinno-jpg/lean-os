-- 전표 반려(삭제)도 수정과 같이 감사 이력을 남긴다 — 행위 값에 'reject' 를 허용
begin;
alter table public.journal_entry_audits drop constraint if exists journal_entry_audits_action_check;
alter table public.journal_entry_audits add constraint journal_entry_audits_action_check check (action = any (array['update'::text, 'delete'::text, 'reject'::text]));
commit;
