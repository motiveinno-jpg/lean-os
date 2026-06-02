-- 문서 영구삭제 RPC — 서류탭에서 생성한 문서 삭제.
-- 정책(사용자 승인 2026-06-02): 서명 요청이 있는 문서는 보호(삭제 차단, 감사 이력 보존),
--   그 외 문서는 내부 부속데이터(편집이력/승인/견적추적/HR패키지항목)까지 함께 영구삭제.
-- FK: doc_revisions/doc_approvals/quote_tracking/hr_contract_package_items = NO ACTION → 선삭제 필요.
--     document_shares = CASCADE, document_notifications/document_files = SET NULL → 자동.
-- SECURITY DEFINER + get_my_company_id() 회사 격리 검증 (RLS 우회하므로 본문에서 명시 검증).
create or replace function public.delete_document(p_doc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_doc_company uuid;
  v_sig_count int;
begin
  v_company := public.get_my_company_id();
  if v_company is null then
    raise exception '권한이 없습니다.';
  end if;

  select company_id into v_doc_company from public.documents where id = p_doc_id;
  if v_doc_company is null then
    raise exception '문서를 찾을 수 없습니다.';
  end if;
  if v_doc_company <> v_company then
    raise exception '다른 회사의 문서는 삭제할 수 없습니다.';
  end if;

  -- 서명 요청이 있으면 보호 (법적/감사 이력 보존)
  select count(*) into v_sig_count from public.signature_requests where document_id = p_doc_id;
  if v_sig_count > 0 then
    raise exception '서명 요청이 있는 문서는 삭제할 수 없습니다. 서명 이력 보존을 위해 보호됩니다.';
  end if;

  -- 내부 부속데이터 정리 (NO ACTION FK)
  delete from public.doc_revisions where document_id = p_doc_id;
  delete from public.doc_approvals where document_id = p_doc_id;
  delete from public.quote_tracking where document_id = p_doc_id;
  delete from public.hr_contract_package_items where document_id = p_doc_id;

  delete from public.documents where id = p_doc_id;
end;
$$;

grant execute on function public.delete_document(uuid) to authenticated;
