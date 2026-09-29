-- 문서 작성자(created_by) 변경 금지 (2026-09-29, 사장님 승인 기획 "문서 삭제 = 만든 본인 또는
--   마스터/「남의 파일 삭제」 권한자" 의 보완 — 보안 검토 차단 1).
--
-- 왜: 20260929130000 의 delete_document 는 created_by = current_app_user_id() 이면 본인 문서로 보고
--   삭제를 허락한다. 그런데 documents UPDATE 정책의 with check 는 company_id 만 보고,
--   authenticated 는 created_by 칸에 UPDATE 권한이 있다(has_column_privilege = true).
--   그래서 직원이 남의 문서(또는 created_by null 문서)의 created_by 를 자기 users.id 로 바꾼 뒤
--   RPC 를 부르면 지울 수 있었다. 앱(src, supabase/functions)과 DB 함수 어디에도
--   documents.created_by 를 update 하는 코드는 없다(2026-09-29 grep·pg_proc 확인).
--
-- 무엇: BEFORE UPDATE OF created_by 트리거. 값이 실제로 바뀌고(is distinct from) 요청이
--   사용자 세션이면 거절한다. 같은 값으로 다시 쓰는 update(폼이 전 칸을 보내는 경우)는 통과.
--
-- 사용자 세션 판정 — 둘 중 하나라도 authenticated/anon 이면 사용자로 본다:
--   · current_user : PostgREST 는 JWT 의 role 로 SET ROLE 한다. 사용자가 바꿀 수 없는 값이라
--     직접 PATCH 경로를 확실히 잡는다. (SECURITY DEFINER 함수 안에서는 소유자(postgres)가 된다.)
--   · auth.role()  : request.jwt.claim(s) 의 role. DEFINER RPC 안에서도 호출자의 JWT 가 남아 있어
--     "사용자가 부른 서버 함수" 경로까지 막는다. 현재 created_by 를 바꾸는 DEFINER 함수는 없다.
--   통과: service_role 키(current_user = service_role, claim role = service_role),
--         마이그레이션·SQL 편집기(current_user = postgres, claim 없음 → auth.role() null).
--   current_user 를 함께 보는 이유: claim 만 보면 claim 을 흉내 낸 세션을 믿게 된다.
--
-- 버린 안:
--   · created_by 컬럼 UPDATE 권한 revoke — authenticated 에 표 단위 UPDATE GRANT 가 있으면
--     컬럼 revoke 는 효과가 없다(표 권한이 우선). 표 GRANT 를 컬럼 목록으로 바꾸는 건 파급이 크다.
--   · RLS with check 로 막기 — with check 는 NEW 만 보고 OLD 를 참조할 수 없어
--     "바뀌었는가"를 판정할 수 없다.

begin;

create or replace function public.documents_created_by_immutable()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.created_by is distinct from old.created_by
     and (current_user in ('authenticated', 'anon')
          or coalesce(auth.role(), '') in ('authenticated', 'anon')) then
    raise exception '문서를 만든 사람은 바꿀 수 없습니다.';
  end if;
  return new;
end;
$$;

-- 트리거 함수라 직접 호출할 일이 없다. EXECUTE 권한은 트리거를 만들 때만 확인하고
--   발동 시에는 보지 않으므로 revoke 해도 트리거는 그대로 돈다.
revoke execute on function public.documents_created_by_immutable() from public, anon, authenticated;

drop trigger if exists trg_documents_created_by_immutable on public.documents;
create trigger trg_documents_created_by_immutable
  before update of created_by on public.documents
  for each row execute function public.documents_created_by_immutable();

commit;
