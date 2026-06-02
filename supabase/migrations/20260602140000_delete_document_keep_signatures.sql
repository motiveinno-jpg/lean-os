-- 문서 삭제 정책 변경(사용자 요청 2026-06-02): 서명받은 계약서는 보존, 문서만 삭제.
-- 기존: 서명 요청이 있으면 삭제 차단. 변경: signature_requests.document_id 만 NULL 로 해제하고
--   서명 기록(서명본 스냅샷 자체 보유)은 유지 → /signatures·/contracts/signed 에서 계속 조회 가능.
-- signature_requests.document_id 가 NOT NULL 이라 nullable 로 완화 필요.
alter table public.signature_requests alter column document_id drop not null;

create or replace function public.delete_document(p_doc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_doc_company uuid;
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

grant execute on function public.delete_document(uuid) to authenticated;
