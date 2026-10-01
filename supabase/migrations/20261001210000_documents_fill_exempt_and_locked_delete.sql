-- 문서 보안 W5·W6 (2026-10-01, 9/30 보안 검토 후속).
--
-- W5 History: 잠긴 문서(documents_content_edit_guard)·직인 문서(documents_sealed_content_guard)는 '기간 채우기' 예외로
--   비어 있던 contract_amount·partner_id 를 처음 채울 수 있고 version 도 바꿀 수 있다. 정상 경로는 saveRevision 의
--   contractColumnsOf(content_json) — 금액 = 본문 품목 공급가 합계, 거래처 = 본문 header.partnerId, version +1.
--   그런데 값 검사가 없어 아무 금액·거래처나 넣을 수 있었다(계약 대장·자금 전망에 반영).
-- W5 규칙(클라이언트, 잠긴·직인 문서): contract_amount 를 바꾸면 본문 품목 공급가 합계와 같아야 · partner_id 를 바꾸면 본문 header.partnerId 와
--   같아야 · version 은 그대로거나 +1 만. 기존 값 무변경(바뀔 때만 검사 — 실측 잠긴 12건 중 금액 불일치 1건은 그대로).
--
-- W6 History: delete_document 가 잠긴 문서(서명 완료·문서번호 발급·체결) 삭제를 막지 않았다 — 서명본 스냅샷은 남지만
--   문서번호·승인 이력·파이프라인 연결 근거가 사라진다. 잠긴 문서 = 보관 대상('되돌리기 금지'와 같은 원칙).
-- W6 규칙: 잠긴 문서는 삭제 불가(누구든). 화면(deleteDocument)도 첨부를 지우기 전에 같은 확인을 한다.
--   회사 데이터 초기화(reset_company_data) 같은 서버 정리는 delete_document 를 거치지 않아 영향 없음.

create or replace function public.documents_fill_exempt_guard()
returns trigger language plpgsql set search_path = public as $$
declare v_sum numeric; v_partner text;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if not (old.locked_at is not null or coalesce(old.status in ('locked', 'executed', 'issued'), false) or coalesce(old.seal_applied, false)) then
    return new;
  end if;
  if new.contract_amount is distinct from old.contract_amount then
    select coalesce(sum(nullif(regexp_replace(coalesce(i ->> 'supplyAmount', ''), '[^0-9.\-]', '', 'g'), '')::numeric), 0) into v_sum
      from jsonb_array_elements(case when jsonb_typeof(new.content_json -> 'items') = 'array' then new.content_json -> 'items' else '[]'::jsonb end) i;
    if new.contract_amount is null or new.contract_amount <> v_sum then
      raise exception '잠기거나 직인이 찍힌 문서의 계약 금액은 본문 품목 합계로만 채울 수 있습니다' using errcode = '42501';
    end if;
  end if;
  if new.partner_id is distinct from old.partner_id then
    v_partner := new.content_json -> 'header' ->> 'partnerId';
    if new.partner_id is null or v_partner is null or new.partner_id::text <> v_partner then
      raise exception '잠기거나 직인이 찍힌 문서의 거래처는 본문에 적힌 거래처로만 채울 수 있습니다' using errcode = '42501';
    end if;
  end if;
  if new.version is distinct from old.version and new.version is distinct from coalesce(old.version, 0) + 1 then
    raise exception '문서 버전은 하나씩만 올라갑니다' using errcode = '42501';
  end if;
  return new;
end $$;
drop trigger if exists trg_documents_fill_exempt_guard on public.documents;
create trigger trg_documents_fill_exempt_guard before update on public.documents
  for each row execute function public.documents_fill_exempt_guard();

create or replace function public.delete_document(p_doc_id uuid)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_company uuid;
  v_doc_company uuid;
  v_doc_created_by uuid;
  v_locked boolean;
  v_pkg_title text;
  v_pkg_status text;
begin
  v_company := public.get_my_company_id();
  if v_company is null then
    raise exception '권한이 없습니다.';
  end if;

  select company_id, created_by, (locked_at is not null or coalesce(status in ('locked', 'executed', 'issued'), false))
    into v_doc_company, v_doc_created_by, v_locked
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
    raise exception '이 문서를 삭제할 권한이 없습니다. 본인이 만든 문서만 지울 수 있고, 다른 사람 문서는 마스터나 「남의 파일·문서 수정·삭제」 권한이 있어야 합니다.';
  end if;

  -- 잠긴 문서(서명 완료·문서번호 발급·체결)는 보관 대상 — 지우지 않는다 (2026-10-01 W6)
  if v_locked then
    raise exception '잠긴 문서(서명 완료·문서번호 발급·체결)는 보관 대상이라 삭제할 수 없습니다.';
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
$function$;
