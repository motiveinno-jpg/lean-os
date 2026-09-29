-- 문서 내용 수정 권한 (2026-09-29, 사장님 결정 — "문서 수정도 삭제와 동일하게 권한으로").
--
-- 왜: 20260929130000 로 삭제는 "만든 본인 또는 마스터·권한자"로 좁혔지만, documents UPDATE 정책은
--   회사만 본다. 그래서 같은 회사 직원이면 누구든 남이 만든 문서의 이름·본문(content_json)·금액을
--   PostgREST 로 직접 고칠 수 있었다. 삭제만 막고 수정은 열려 있으면 "내용을 비워 버리기"로
--   사실상 지울 수 있다.
--
-- 무엇:
--   1) BEFORE UPDATE 트리거 documents_content_edit_guard — 사용자 세션에서 '내용 칸'이 바뀌면
--      권한을 확인하고, 없으면 거절한다.
--      · 진행 상태 칸(누구나 바꿀 수 있음 — 결재 승인·발행·직인·청구 흐름이 쓰는 칸):
--        status, locked_at, seal_applied, document_number, issued_at, billing_day, billing_amount,
--        source_document_id, updated_at. created_by 는 20260929140000 트리거가 따로 막으므로 비교에서 뺀다.
--      · 나머지 모든 칸이 내용 칸이다. to_jsonb(row) 에서 위 키를 빼고 비교하므로
--        칸이 새로 추가돼도 자동으로 내용 칸으로 잡힌다(빠뜨려서 열리는 일이 없다).
--      · 허용 — 하나라도 참이면 통과. 전부 OLD 기준이다(문서를 프로젝트로 옮기거나 계약으로
--        바꿔 권한을 얻는 우회를 막는다):
--        ① 본인이 만든 문서(old.created_by = current_app_user_id(), null 은 본인 문서 아님)
--        ② has_perm('/documents:delete') — 「남의 파일·문서 수정·삭제」. has_perm 은 마스터면 true
--        ③ 프로젝트 문서(old.deal_id 또는 old.sub_deal_id 있음) + has_perm('/projecthub') — 프로젝트 협업
--        ④ 계약 문서(coalesce(content_type, auto_classified_type) = 'contract') + has_perm('/contracts') — 계약 대장
--        ⑤ 전자계약 일괄 발송용 서식 공용 사본(content_json ? 'source_template_id',
--           materializeContractTemplate 가 created_by null 로 만든다) + has_perm('/signatures')
--   2) delete_document 의 권한 거절 문구 안 「남의 파일 삭제」 → 「남의 파일·문서 수정·삭제」
--      (권한 이름을 바꿨다). 문구 외의 본문은 20260929130000 과 같다.
--
-- 사용자 세션 판정 — 이 트리거는 current_user in ('authenticated','anon') 하나만 본다.
--   20260929140000(created_by 불변)은 auth.role() 도 함께 보지만 여기서는 일부러 뺐다.
--   이유: make_contract_invoice_drafts_for(SECURITY DEFINER)가 회차 세금계산서 초안을 만들면서
--   회사의 모든 계약 문서 content_json.paymentSchedule[].invoiceId 를 갱신한다. authenticated 가
--   부를 수 있는 make_my_contract_invoice_drafts() 가 이 함수를 부르므로, auth.role() 까지 보면
--   권한 없는 직원이 누를 때 남의 계약 문서에서 예외가 나 기능 전체가 깨진다.
--   원칙: 직접 PATCH·upsert(current_user = authenticated/anon)는 이 트리거가 막고,
--   SECURITY DEFINER 서버 함수 안(current_user = 소유자 postgres)은 그 함수가 자기 권한 규칙을 따른다.
--   service_role 키·마이그레이션·크론도 current_user 가 authenticated/anon 이 아니므로 통과.
--
-- 버린 안:
--   · 모든 내용 수정을 만든 본인만 — 결재 승인·발행·직인·계약 대장·프로젝트 협업·일괄 발송이 깨진다.
--   · RLS UPDATE with check 로 막기 — with check 는 NEW 만 보고 OLD 를 참조할 수 없어
--     "무엇이 바뀌었는가"·"원래 누구 문서인가"를 판정할 수 없다.
--   · (판정) 우회 표시(set_config 로 DEFINER 함수가 표시를 켬) — 복잡하고, 표시를 켤 수 있는
--     경로가 새로 생기는지 보안 검토 부담이 있다.
--   · (판정) make_my_contract_invoice_drafts 의 authenticated 실행 권한 revoke — 기능을 닫는다.
--   · (판정) paymentSchedule 의 invoiceId 추가만 허용하는 부분 비교 — 비교 식이 복잡해 빈틈이 생긴다.

begin;

create or replace function public.documents_content_edit_guard()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_progress text[] := array[
    'status', 'locked_at', 'seal_applied', 'document_number', 'issued_at',
    'billing_day', 'billing_amount', 'source_document_id', 'updated_at', 'created_by'
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

-- 트리거 함수라 직접 호출할 일이 없다. EXECUTE 권한은 트리거 생성 때만 확인하고 발동 시에는
--   보지 않으므로 revoke 해도 트리거는 그대로 돈다.
revoke execute on function public.documents_content_edit_guard() from public, anon, authenticated;

drop trigger if exists trg_documents_content_edit_guard on public.documents;
create trigger trg_documents_content_edit_guard
  before update on public.documents
  for each row execute function public.documents_content_edit_guard();

-- delete_document — 거절 문구만 바뀜(「남의 파일 삭제」 → 「남의 파일·문서 수정·삭제」).
-- CREATE OR REPLACE 는 기존 GRANT(proacl)를 유지한다.
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
    raise exception '이 문서를 삭제할 권한이 없습니다. 본인이 만든 문서만 지울 수 있고, 다른 사람 문서는 마스터나 「남의 파일·문서 수정·삭제」 권한이 있어야 합니다.';
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

commit;
