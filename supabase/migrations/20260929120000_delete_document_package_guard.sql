-- 근로계약 패키지 보호 가드 (2026-09-29, 사장님 운영 DB 변경 승인).
-- 배경: 2026-09-28 문서함 삭제로 발송된 근로계약 패키지의 문서가 같이 지워져
--   패키지가 '문서 0건'으로 남았다. 화면 가드(src/lib/queries.ts deleteDocument)는 있으나
--   RPC 를 직접 부르면 우회되므로 DB 에도 같은 기준을 둔다.
-- 기준: 패키지 status 가 sent·partially_signed·completed 이면 삭제 차단.
--   초안(draft)·취소 패키지의 문서는 지금처럼 지울 수 있다(package_items 정리 후 삭제).
-- 그 밖의 동작은 20260602140000_delete_document_keep_signatures.sql 과 동일.
-- CREATE OR REPLACE 는 기존 GRANT(proacl)를 유지한다 — 권한 문은 다시 적지 않는다.

create or replace function public.delete_document(p_doc_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_doc_company uuid;
  v_pkg_title text;
  v_pkg_status text;
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
