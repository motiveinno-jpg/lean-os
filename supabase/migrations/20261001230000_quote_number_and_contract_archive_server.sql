-- 견적 번호·계약 보관본을 서버로 (2026-10-01, 9/30 새 문서 가드 후속 — 사장님 진행 지시).
--
-- History
--   · 견적 번호(YYYY/MM/DD-N)는 화면(nextQuoteNumber)이 그날 최대 번호를 읽어 +1 해서 넣었다 → 동시에 만들면 같은 번호,
--     그리고 새 문서 가드(documents_insert_guard ④)가 그 형식이면 아무 번호나 받아 임의 번호도 넣을 수 있었다.
--     실측: 견적 번호 22건 · 중복 0(아직 겹친 적은 없음) · 번호 없는 견적 1건(그대로 둔다).
--   · 계약 보관본(content_type='contract_pdf', status='issued')은 계약 승인 때 화면 코드(deal-pipeline)가 직접 넣어, 가드 ③이
--     그 조합만 예외로 열어 두었다 → 누구나 '발행된 계약 보관본'을 꾸며 넣을 수 있었다. 실측: 보관본 0건(만들어진 적 없음).
--
-- 무엇
--   1) documents_assign_quote_number (BEFORE INSERT, 가드보다 이름순 먼저): 견적(invoice·quote)은 서버가 번호를 매긴다.
--      클라이언트가 보낸 번호는 무시. 회사·날짜(KST)별 advisory lock 으로 동시 생성에도 안 겹친다. 서버 경로가 번호를 비워 보내도 매긴다.
--   2) documents_insert_guard: ③ 'issued+contract_pdf' 예외 제거(새 문서는 초안·검토만) · ④ 번호는 견적에만(값은 1이 다시 매김).
--   3) archive_contract_pdf(원본 계약, 이름, PDF HTML): 같은 회사의 승인된(또는 잠긴) 계약서에만, 원본당 한 번만 보관본을 만든다.
--      보관본은 발행·잠금 상태로. PDF HTML 은 승인한 사람 브라우저가 만든 값이라 내용 자체는 여전히 클라이언트 값(남은 한계 — 서버 렌더링은 후속).
--   기존 데이터 무변경.

create or replace function public.documents_assign_quote_number()
returns trigger language plpgsql set search_path = public as $$
declare v_day text; v_max int;
begin
  if coalesce(new.content_type, '') not in ('invoice', 'quote') then return new; end if;
  if current_user not in ('authenticated', 'anon') and new.document_number is not null then return new; end if;
  v_day := to_char(now() at time zone 'Asia/Seoul', 'YYYY/MM/DD');
  perform pg_advisory_xact_lock(hashtext('quote_number:' || new.company_id::text || ':' || v_day));
  select coalesce(max((substring(d.document_number from '-(\d{1,9})$'))::int), 0) into v_max
    from public.documents d
   where d.company_id = new.company_id and d.document_number like v_day || '-%';
  new.document_number := v_day || '-' || (v_max + 1);
  return new;
end $$;
drop trigger if exists trg_documents_assign_quote_number on public.documents;
create trigger trg_documents_assign_quote_number before insert on public.documents
  for each row execute function public.documents_assign_quote_number();

create or replace function public.documents_insert_guard()
returns trigger language plpgsql set search_path = public as $$
declare
  v_me uuid;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- 1) 직인
  if coalesce(new.seal_applied, false) then
    raise exception '직인은 문서를 만든 뒤 「직인 적용하기」로만 찍을 수 있습니다.';
  end if;

  -- 2) 잠금·발행 시각
  if new.locked_at is not null or new.issued_at is not null then
    raise exception '새 문서는 잠긴 상태로 만들 수 없습니다.';
  end if;

  -- 3) 상태 — 초안·검토만 (계약 보관본은 archive_contract_pdf 로만, 2026-10-01)
  if new.status is not null and new.status not in ('draft', 'review') then
    raise exception '새 문서는 초안으로만 만들 수 있습니다.';
  end if;

  -- 4) 문서번호 — 견적만(번호는 documents_assign_quote_number 가 매긴다). 그 밖은 「문서번호 발급」으로만.
  if new.document_number is not null and coalesce(new.content_type, '') not in ('invoice', 'quote') then
    raise exception '문서번호는 「문서번호 발급」으로만 받을 수 있습니다.';
  end if;

  -- 5) 만든 사람 — 남의 id 는 본인 id 로
  if new.created_by is not null then
    v_me := public.current_app_user_id();
    if new.created_by is distinct from v_me then
      new.created_by := v_me;
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.archive_contract_pdf(p_source_doc uuid, p_name text, p_pdf_html text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  v_company uuid := public.get_my_company_id();
  v_me uuid := public.current_app_user_id();
  v_src public.documents%rowtype;
  v_existing uuid;
  v_id uuid;
begin
  if v_company is null or v_me is null then raise exception '권한이 없습니다.'; end if;
  if public.is_advisor_session() then raise exception '세무대리인은 계약 보관본을 만들 수 없습니다.'; end if;
  select * into v_src from public.documents where id = p_source_doc;
  if not found or v_src.company_id <> v_company then raise exception '계약서를 찾을 수 없습니다.'; end if;
  if coalesce(v_src.content_type, v_src.content_json ->> 'type', '') <> 'contract' then
    raise exception '계약서만 보관본을 만들 수 있습니다.';
  end if;
  if coalesce(v_src.status, '') not in ('approved', 'locked', 'executed', 'issued') then
    raise exception '승인된 계약서만 보관본을 만들 수 있습니다.';
  end if;
  if coalesce(length(p_pdf_html), 0) = 0 or length(p_pdf_html) > 2000000 then
    raise exception '계약서 본문이 비었거나 너무 큽니다.';
  end if;

  perform pg_advisory_xact_lock(hashtext('contract_archive:' || p_source_doc::text));
  select id into v_existing from public.documents
   where company_id = v_company and content_type = 'contract_pdf' and content_json ->> 'sourceDocumentId' = p_source_doc::text
   limit 1;
  if v_existing is not null then return v_existing; end if;

  insert into public.documents (company_id, deal_id, name, status, content_type, content_json, version, created_by, issued_at, locked_at)
  values (v_company, v_src.deal_id, left(coalesce(nullif(btrim(p_name), ''), coalesce(v_src.name, '계약') || ' (PDF)'), 200), 'issued', 'contract_pdf',
          jsonb_build_object('type', 'contract_pdf', 'sourceDocumentId', p_source_doc::text, 'pdfHtml', p_pdf_html,
                             'generatedAt', now(), 'metadata', jsonb_build_object('autoGenerated', true, 'sourceDocType', 'contract')),
          1, v_me, now(), now())
  returning id into v_id;
  return v_id;
end $$;
revoke all on function public.archive_contract_pdf(uuid, text, text) from public, anon;
grant execute on function public.archive_contract_pdf(uuid, text, text) to authenticated;
