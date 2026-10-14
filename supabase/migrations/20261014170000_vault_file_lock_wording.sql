-- 파일보관함 잠금 안내 문구를 화면 용어('암호화')에 맞춘다 — 판정은 20261014160000 그대로
create or replace function public.document_files_lock_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if new.encryption is not distinct from old.encryption then return new; end if;
  if new.storage_path is not distinct from old.storage_path then
    raise exception '암호화 상태는 파일을 다시 올릴 때만 바뀝니다.' using errcode = 'P0001';
  end if;
  --   서버 쪽 작업(service_role·마이그레이션)은 auth.uid() 가 없다 — 사람 요청만 권한을 본다
  if (select auth.uid()) is not null
     and old.uploaded_by is distinct from (select public.current_app_user_id())
     and not (select public.has_perm('/documents:delete')) then
    raise exception '파일을 올린 사람이나 파일 삭제 권한이 있는 사람만 암호화하거나 해제할 수 있습니다.' using errcode = 'P0001';
  end if;
  return new;
end $$;
