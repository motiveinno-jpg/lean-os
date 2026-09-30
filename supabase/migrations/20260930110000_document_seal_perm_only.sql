-- 직인은 '수정 권한이 있는 사람'만 — 만든 본인이라는 이유만으로는 못 찍는다 (2026-09-30).
--
-- 왜: 사장님 결정(2026-09-30) "직인은 문서를 수정할 수 있는 사람(마스터, 권한이 있는 사람)".
--   직전 20260930100000 의 apply_document_seal 은 권한을 document_content_editable(문서) 로 봤다.
--   그 헬퍼의 첫 조건이 '만든 본인'이라, 아무 권한 없는 직원도 자기가 문서를 하나 만들면
--   그 문서에 법인 직인을 찍을 수 있었다. 직인은 회사가 그 문서를 인정한다는 표시라
--   '내 문서를 고칠 수 있다'와 무게가 다르다.
--
-- 무엇: apply_document_seal 만 CREATE OR REPLACE. 권한 판정을 헬퍼 5조건 중 ①(본인)을 뺀 ②~⑤로 바꾼다.
--   ② has_perm('/documents:delete')  — 「남의 파일·문서 수정·삭제」, 마스터는 has_perm 이 늘 true
--   ③ 프로젝트 문서(deal_id/sub_deal_id) + has_perm('/projecthub')
--   ④ 계약 문서(content_type 또는 auto_classified_type = 'contract') + has_perm('/contracts')
--   ⑤ 서식 공용 사본(content_json ? 'source_template_id') + has_perm('/signatures')
--   나머지(회사 확인·세무대리인 거절·잠금 거절·seal_url 확인·중복 방지·signature_requests 기록)는 그대로.
--   직인 기록은 계속 월 전자계약 한도(enforce_contract_monthly_limit)에 센다 — 현행 유지(사장님 결정).
--   document_content_editable 헬퍼와 documents_content_edit_guard 는 건드리지 않는다 —
--   내용 수정은 여전히 만든 본인도 된다(잠기지 않은 문서).
--   기존 데이터: 이미 seal_applied=true 인 문서는 그대로 둔다(누가 찍었는지 되짚어 지우지 않는다).
--
-- 버린 안:
--   · 본인 포함 유지 — 직원이 자기 문서를 만들어 법인 직인을 찍을 수 있다. 결정의 이유 그 자체.
--   · 별도 /documents:seal 권한 신설 — 사장님이 '수정 권한자'로 정했다. 권한 항목이 늘면
--     권한 설정 화면·백필이 따라붙는데 얻는 것이 없다.
--   · 헬퍼에 인자(include_owner)를 더해 공유 — 가드 쪽 호출·시그니처가 바뀐다. 조건 4줄을 여기 적는 편이 파급이 없다.

begin;

create or replace function public.apply_document_seal(p_doc_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_doc_company uuid;
  v_doc public.documents%rowtype;
  v_seal_url text;
  v_company_name text;
  v_chars constant text := 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  v_bytes bytea;
  v_token text := '';
  i int;
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
    raise exception '다른 회사의 문서에는 직인을 찍을 수 없습니다.';
  end if;
  if public.is_advisor_session() then
    raise exception '세무대리인은 직인을 적용할 수 없습니다.';
  end if;

  select * into v_doc from public.documents where id = p_doc_id for update;

  if v_doc.locked_at is not null or coalesce(v_doc.status in ('locked', 'executed', 'issued'), false) then
    raise exception '잠긴 문서에는 직인을 새로 찍을 수 없습니다.';
  end if;

  -- 수정 권한자만 — 만든 본인이라는 이유만으로는 안 된다(document_content_editable 의 ① 제외)
  if not coalesce(
       public.has_perm('/documents:delete')
    or ((v_doc.deal_id is not null or v_doc.sub_deal_id is not null) and public.has_perm('/projecthub'))
    or (coalesce(v_doc.content_type, v_doc.auto_classified_type) = 'contract' and public.has_perm('/contracts'))
    or (coalesce(v_doc.content_json ? 'source_template_id', false) and public.has_perm('/signatures')),
    false) then
    raise exception '직인은 마스터나 이 문서를 수정할 권한이 있는 사람만 찍을 수 있습니다.';
  end if;

  select seal_url, name into v_seal_url, v_company_name from public.companies where id = v_company;
  if coalesce(v_seal_url, '') = '' then
    raise exception '직인 이미지가 등록되지 않았습니다. 설정에서 직인을 먼저 업로드하세요.';
  end if;

  if coalesce(v_doc.seal_applied, false) then
    return v_seal_url;  -- 이미 찍힘 — 기록을 또 남기지 않는다
  end if;

  update public.documents set seal_applied = true where id = p_doc_id;

  -- 서명 토큰 48자 영숫자 — 클라이언트 generateSignToken 과 같은 모양
  v_bytes := extensions.gen_random_bytes(48);
  for i in 0..47 loop
    v_token := v_token || substr(v_chars, (get_byte(v_bytes, i) % 62) + 1, 1);
  end loop;

  insert into public.signature_requests (
    company_id, document_id, title, status, signer_name, signer_email,
    sign_token, expires_at, signed_at, signature_data, created_by
  ) values (
    v_company, p_doc_id, '회사 직인 적용', 'signed', coalesce(nullif(v_company_name, ''), '회사 직인'), 'seal@company',
    v_token, now() + interval '365 days', now(),
    jsonb_build_object('type', 'seal', 'data', v_seal_url), public.current_app_user_id()
  );

  return v_seal_url;
end;
$$;

revoke execute on function public.apply_document_seal(uuid) from public, anon;
grant execute on function public.apply_document_seal(uuid) to authenticated;

commit;
