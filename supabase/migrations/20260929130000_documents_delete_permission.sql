-- 문서 삭제 권한 (2026-09-29, 사장님 운영 DB 변경 승인 — "진행").
--
-- 왜: delete_document RPC(SECURITY DEFINER)는 회사만 확인하고 역할·권한은 보지 않았다.
--   그래서 같은 회사 직원이면 누구든 남이 만든 문서를 지울 수 있었다. 또 documents 의
--   "Company members can manage documents"(ALL) 정책 때문에 PostgREST 로 직접 delete 해도
--   같은 회사 문서가 지워졌다(RPC 의 가드를 우회하는 길).
--
-- 무엇:
--   1) delete_document — 회사 확인 바로 뒤, 패키지 가드 앞에 권한 확인을 넣는다.
--      · 세무대리인 세션(is_advisor_session())은 항상 거절.
--      · 삭제 가능 = 문서 created_by = current_app_user_id()  또는  has_perm('/documents:delete')
--        (has_perm 은 마스터면 true). created_by 가 null 인 문서는 has_perm 인 사람만.
--      · 파일보관함과 같은 규칙이다. 패키지 가드와 나머지 본문은 20260929120000 그대로.
--   2) RLS — ALL 정책을 지우고 같은 조건의 INSERT·UPDATE 정책 둘로 나눈다. 조회는 기존
--      "Company members can view documents" 가 맡는다. DELETE 정책은 만들지 않는다 →
--      authenticated 가 PostgREST 로 직접 지울 수 없고, 삭제는 delete_document RPC 하나로만.
--      roles 는 원래 정책과 같이 public. advisor_ro_* RESTRICTIVE 정책은 그대로 둔다.
--   참고: 다른 표의 FK ON DELETE CASCADE 로 documents 행이 지워지는 경로(예: 회사 삭제)는
--      RLS 의 영향을 받지 않는다 — 참조 무결성 동작은 정책 검사를 거치지 않는다.
--
-- 버린 안: "마스터만 삭제" — 직원이 자기가 만든 초안도 못 지우게 되고, 파일보관함
--   (본인 파일은 본인이, 남의 파일은 마스터·「남의 파일 삭제」 권한) 규칙과 어긋난다.
--
-- CREATE OR REPLACE 는 기존 GRANT(proacl)를 유지한다 — 권한 문은 다시 적지 않는다.

begin;

create or replace function public.delete_document(p_doc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_doc_company uuid;
  v_doc_created_by uuid;
  v_pkg_title text;
  v_pkg_status text;
begin
  v_company := public.get_my_company_id();
  if v_company is null then
    raise exception '권한이 없습니다.';
  end if;

  select company_id, created_by into v_doc_company, v_doc_created_by
    from public.documents where id = p_doc_id;
  if v_doc_company is null then
    raise exception '문서를 찾을 수 없습니다.';
  end if;
  if v_doc_company <> v_company then
    raise exception '다른 회사의 문서는 삭제할 수 없습니다.';
  end if;

  -- 삭제 권한 — 세무대리인은 불가. 본인이 만든 문서이거나 마스터·「남의 파일 삭제」 권한.
  --   created_by 가 null 이면 본인 문서로 보지 않는다(권한 있는 사람만).
  if public.is_advisor_session() then
    raise exception '세무대리인은 문서를 삭제할 수 없습니다.';
  end if;
  if not (
       (v_doc_created_by is not null and v_doc_created_by = public.current_app_user_id())
       or public.has_perm('/documents:delete')
     ) then
    raise exception '이 문서를 삭제할 권한이 없습니다. 본인이 만든 문서만 지울 수 있고, 다른 사람 문서는 마스터나 「남의 파일 삭제」 권한이 있어야 합니다.';
  end if;

  -- 근로계약 패키지 보호 — 발송·서명 중·서명 완료 패키지에 묶인 문서는 지우지 않는다.
  --   completed 가 있으면 그 메시지를 우선한다.
  select p.title, p.status into v_pkg_title, v_pkg_status
    from public.hr_contract_package_items i
    join public.hr_contract_packages p on p.id = i.package_id
   where i.document_id = p_doc_id
     and p.status in ('sent', 'partially_signed', 'completed')
   order by (p.status = 'completed') desc
   limit 1;
  if v_pkg_status = 'completed' then
    raise exception '서명이 끝난 근로계약 패키지(%)의 문서라 삭제할 수 없습니다. 서명본은 보관 대상입니다.', v_pkg_title;
  elsif v_pkg_status is not null then
    raise exception '발송된 근로계약 패키지(%)에 묶인 문서입니다. 근로계약·서식 › 계약 발송·현황에서 패키지를 취소(정리)한 뒤 지우세요.', v_pkg_title;
  end if;

  -- 서명받은 계약서 보존 — 문서 연결만 해제. 서명본은 signature_requests 의 자체 스냅샷
  --   (signed_contract_html/template_snapshot_html 등)으로 계속 조회됨.
  update public.signature_requests set document_id = null where document_id = p_doc_id;

  -- 내부 부속데이터는 정리 (NO ACTION FK — 문서가 사라지므로 의미 없음)
  delete from public.doc_revisions where document_id = p_doc_id;
  delete from public.doc_approvals where document_id = p_doc_id;
  delete from public.quote_tracking where document_id = p_doc_id;
  delete from public.hr_contract_package_items where document_id = p_doc_id;

  delete from public.documents where id = p_doc_id;
end;
$$;

-- RLS: ALL → INSERT + UPDATE (DELETE 정책 없음 = 직접 삭제 차단)
drop policy if exists "Company members can manage documents" on public.documents;

drop policy if exists "Company members can insert documents" on public.documents;
create policy "Company members can insert documents" on public.documents
  as permissive for insert to public
  with check (company_id = (select public.get_my_company_id()));

drop policy if exists "Company members can update documents" on public.documents;
create policy "Company members can update documents" on public.documents
  as permissive for update to public
  using (company_id = (select public.get_my_company_id()))
  with check (company_id = (select public.get_my_company_id()));

commit;
