-- 정기 청구 금액·청구일을 '내용 칸'으로 (2026-09-29, 사장님 승인 — 보안 검토 권고 1).
--
-- 왜: 20260929150000 의 documents_content_edit_guard 는 billing_day·billing_amount 를 '진행 칸'
--   (누구나 바꿀 수 있는 칸)으로 두었다. 그런데 이 두 값은 돈에 관한 내용이고 자금 전망·다가오는
--   일정에 그대로 반영된다. 그 결과 회사 구성원 누구나 남의 계약 문서에서 청구 금액·청구일을
--   PostgREST 로 직접 바꿀 수 있었다.
--
-- 무엇: 진행 칸 배열에서 'billing_day', 'billing_amount' 두 개만 뺀다. 이제 두 칸이 바뀌면
--   다른 내용 칸과 같은 허용 조건(①본인 문서 ②/documents:delete ③프로젝트 문서+/projecthub
--   ④계약 문서+/contracts ⑤서식 공용 사본+/signatures)을 거친다. 그 밖의 본문은 한 글자도 같다.
--
-- 쓰는 곳: src/app/(app)/contracts/page.tsx 계약 대장 정기 청구 저장 한 곳 — 계약 문서이고
--   /contracts 권한자가 쓰는 화면이므로 조건 ④로 그대로 통과한다.
-- 이 두 칸을 update 하는 DB 함수(2026-09-29 pg_proc 조사): _sample_company_seed_body(SECURITY DEFINER,
--   authenticated 실행 불가) 뿐 — current_user 가 소유자라 이 트리거를 통과한다.
--
-- 권한: CREATE OR REPLACE 는 기존 proacl({postgres, service_role} EXECUTE)을 유지한다.
--   트리거(trg_documents_content_edit_guard)는 함수 oid 가 같으므로 다시 만들 필요 없다.

create or replace function public.documents_content_edit_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_progress text[] := array[
    'status', 'locked_at', 'seal_applied', 'document_number', 'issued_at',
    'source_document_id', 'updated_at', 'created_by'
  ];
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  if (to_jsonb(new) - v_progress) is not distinct from (to_jsonb(old) - v_progress) then
    return new;
  end if;

  if (old.created_by is not null and old.created_by = public.current_app_user_id())
     or public.has_perm('/documents:delete')
     or ((old.deal_id is not null or old.sub_deal_id is not null) and public.has_perm('/projecthub'))
     or (coalesce(old.content_type, old.auto_classified_type) = 'contract' and public.has_perm('/contracts'))
     or (coalesce(old.content_json ? 'source_template_id', false) and public.has_perm('/signatures')) then
    return new;
  end if;

  raise exception '이 문서를 수정할 권한이 없습니다. 본인이 만든 문서만 고칠 수 있고, 다른 사람 문서는 마스터나 「남의 파일·문서 수정·삭제」 권한이 있어야 합니다.';
end;
$$;
