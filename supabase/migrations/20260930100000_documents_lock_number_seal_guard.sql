-- 잠긴 문서 되돌리기·문서번호·직인을 서버에서만 (2026-09-30, 사장님 승인 "진행").
--
-- 왜: 20260929150000/160000 의 documents_content_edit_guard 는 '내용 칸'의 수정 권한만 본다.
--   진행 칸(status, locked_at, seal_applied, document_number, issued_at …)은 같은 회사 구성원이면
--   누구나 PostgREST 로 직접 PATCH 할 수 있었다. 그래서
--   1) 잠긴 문서(서명 끝난 계약 등)를 status='draft', locked_at=null 로 되돌린 뒤 내용을 고칠 수 있었다.
--      만든 본인·권한자는 되돌리기 없이도 잠긴 문서의 내용을 바로 고칠 수 있었다(가드가 잠금을 안 봄).
--   2) seal_applied=true 를 아무나 켤 수 있었다(회사 직인 위조 표시).
--   3) document_number 를 아무나 임의 값으로 덮어쓸 수 있었다. 앱의 「문서번호 발급」은 클라이언트에서
--      max+1 로 채번해(동시에 누르면 겹침) 이미 번호가 있는 문서도 다시 누르면 번호가 바뀌었다.
--
-- 무엇:
--   A) documents_content_edit_guard 에 R1~R3 을 합친다(트리거는 하나 — 아래 '판정' 참고).
--      사용자 세션(current_user in authenticated/anon) 에서만 본다. SECURITY DEFINER 함수·service_role·
--      크론·마이그레이션은 통과(기존 가드와 같은 원칙 — 20260929150000 머리 주석).
--      '잠긴 상태' = old.locked_at is not null or old.status in ('locked','executed','issued').
--      R3 문서번호·직인: document_number 또는 seal_applied 가 바뀌면(null→값 포함) 거절.
--         → 「문서번호 발급」(issue_document)·「직인 적용하기」(apply_document_seal) RPC 로만.
--         INSERT 는 범위 밖(견적 채번 nextQuoteNumber 가 insert 때 번호를 넣는다).
--      R1 잠금 되돌리기 금지(잠긴 상태의 OLD):
--         · status 는 그대로이거나 'locked' 만(executed/issued → locked 전진은 허용).
--         · old.locked_at 이 있는데 new.locked_at 이 null 이면 거절.
--           다른 값이면 조용히 old 값으로 되돌린다 — 서명자가 여럿이면 앱(sign/page.tsx)이 서명마다
--           locked_at=now 로 다시 잠근다. 처음 잠긴 시각을 지킨다.
--      R2 잠긴 문서 내용 수정 금지(마스터·만든 본인 포함 전원). 예외 둘:
--         ⓐ billing_day·billing_amount — 계약 대장의 정기 청구. 권한은 아래 기존 판정이 그대로 본다.
--         ⓑ 계약 대장 「기간 채우기」 — saveRevision 이 content_json.contractStart/End 와
--            contractColumnsOf(contract_start_date, contract_end_date, contract_amount, partner_id) + version 을
--            같이 쓴다. 이 칸들과 content_json 의 두 키를 빼고 비교해 같고, 바뀐 칸은 전부 OLD 가 비어 있을
--            때만(null, content_json 키는 없거나 '') 허용 — 빈칸 채우기만, 덮어쓰기 금지.
--            version 은 saveRevision 이 늘 올리므로 null 규칙에서 뺀다.
--         source_document_id·updated_at 은 진행 칸이라 원래 허용.
--      이후 기존 판정(내용 칸이 바뀌면 권한 5조건)은 로직 그대로.
--   B) 권한 5조건을 헬퍼 document_content_editable(p_old documents) 로 뽑는다(로직 변경 없음).
--      가드와 apply_document_seal 이 같이 쓴다.
--      · SECURITY INVOKER — 안에서 부르는 has_perm/current_app_user_id 가 이미 DEFINER 라 올릴 필요 없다.
--      · EXECUTE 는 authenticated 만. 가드는 DEFINER 가 아니라 호출자(authenticated) 권한으로 돌고,
--        plpgsql 이 함수를 부를 때 EXECUTE 를 확인하므로 authenticated 에 필요하다.
--        노출돼도 '넘긴 행에 대해 내가 수정 권한이 있나'만 답한다(자기 권한 조회 — 새 정보 없음).
--        anon 은 documents 를 한 행도 UPDATE 할 수 없어(RLS: get_my_company_id() null) 트리거가 돌 일이 없다.
--   C) RPC issue_document(p_doc_id) → 문서번호. 같은 회사 구성원 누구나(2026-09-29 결정: 진행 칸은 누구나).
--      번호가 이미 있으면 아무것도 안 바꾸고 그 번호를 돌려준다(재발급으로 번호가 바뀌던 버그 제거).
--      없으면 DOC-YYYYMM-NNNN(Asia/Seoul 기준 달, 같은 회사·같은 접두의 끝 숫자 최댓값+1, 4자리 0채움 —
--      클라이언트 generateDocumentNumber 와 같은 결과). 경합은 회사별 advisory xact lock 으로 줄 세운다.
--      발행: issued_at=now, locked_at=coalesce(locked_at,now), status 는 locked/executed 면 그대로, 아니면 issued.
--   D) RPC apply_document_seal(p_doc_id) → 회사 seal_url. 잠긴 문서 거절, 권한은 내용 수정과 같다
--      (직인은 문서가 말하는 바를 바꾼다). 이미 찍혀 있으면 아무것도 안 하고 seal_url(중복 기록 방지).
--      아니면 seal_applied=true + signature_requests 기록 1행(지금 applyCompanySeal 이 넣는 칸 그대로).
--      주의: signature_requests BEFORE INSERT 트리거 enforce_contract_monthly_limit 가 이 기록도 세므로,
--        월 전자계약 한도가 찬 회사는 직인이 거절된다(종전 클라이언트는 문서만 켜지고 기록 insert 가
--        조용히 실패했다). 한 트랜잭션이라 '문서엔 직인, 기록은 없음' 상태가 더는 생기지 않는다.
--
-- 판정 — 트리거를 따로 두지 않고 기존 가드에 합친 이유:
--   BEFORE 트리거는 이름 알파벳순(trg_documents_content_edit_guard → created_by_immutable → touch_updated_at).
--   잠금 검사를 별도 트리거로 두면 이름으로 순서를 맞춰야 하고, 권한 없는 직원이 잠긴 문서를 고칠 때
--   '권한 없음'이 먼저 떠 원인이 흐려진다. 한 함수 안에서 R3 → R1 → R2 → 권한 순으로 본다.
--   locked_at 조용한 보정은 진행 칸이라 내용 비교에 영향이 없다.
--
-- 버린 안:
--   · 진행 칸 전체를 서버 RPC 로만 — 결재 승인·검토 요청·서명 잠금·서명 취소가 전부 직접 UPDATE 라 파급이 크다.
--     되돌리기·번호·직인만 막으면 '서명본 사후 수정'·'직인 위조'·'번호 덮어쓰기' 세 구멍이 닫힌다.
--   · 잠긴 문서도 권한자는 내용 수정 허용 — 서명된 계약 본문이 서명 후 바뀌는 것 자체가 문제다. 개정본으로.
--   · 계약 대장 기간 칸 덮어쓰기 허용 — 서명된 계약의 기간·금액을 사후에 바꾸는 길이 된다. 빈칸 채우기만.
--   · 문서번호 UNIQUE(company_id, document_number) 제약 — 기존 데이터(견적 번호 등)에 중복이 있는지
--     확인 전이라 이번엔 넣지 않는다. 채번은 advisory lock 으로 겹치지 않고, 직접 PATCH 는 R3 이 막는다.
--   · 헬퍼를 SECURITY DEFINER 로 — 필요 없는 권한 상승이다.

begin;

-- ── B) 권한 5조건 헬퍼 ──────────────────────────────────────────
create or replace function public.document_content_editable(p_old public.documents)
returns boolean
language sql
stable
set search_path = public
as $$
  select coalesce(
       (p_old.created_by is not null and p_old.created_by = public.current_app_user_id())
    or public.has_perm('/documents:delete')
    or ((p_old.deal_id is not null or p_old.sub_deal_id is not null) and public.has_perm('/projecthub'))
    or (coalesce(p_old.content_type, p_old.auto_classified_type) = 'contract' and public.has_perm('/contracts'))
    or (coalesce(p_old.content_json ? 'source_template_id', false) and public.has_perm('/signatures')),
    false);
$$;

revoke execute on function public.document_content_editable(public.documents) from public, anon;
grant execute on function public.document_content_editable(public.documents) to authenticated;

-- ── A) 가드 — R3 → R1 → R2 → 기존 권한 판정 ──────────────────────
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
  -- 잠긴 문서에서 예외로 비교에서 빼는 칸(아래 R2 ⓐⓑ)
  v_locked_exempt text[] := array[
    'billing_day', 'billing_amount',
    'contract_start_date', 'contract_end_date', 'contract_amount', 'partner_id', 'version'
  ];
  v_locked boolean;
  v_new jsonb;
  v_old jsonb;
begin
  if current_user not in ('authenticated', 'anon') then
    return new;
  end if;

  -- R3 문서번호·직인은 서버 RPC 로만
  if new.document_number is distinct from old.document_number
     or new.seal_applied is distinct from old.seal_applied then
    raise exception '문서번호·직인은 「문서번호 발급」「직인 적용하기」 버튼으로만 바꿀 수 있습니다.';
  end if;

  v_locked := old.locked_at is not null or coalesce(old.status in ('locked', 'executed', 'issued'), false);

  if v_locked then
    -- R1 잠금 되돌리기 금지
    if new.status is distinct from old.status and new.status is distinct from 'locked' then
      raise exception '잠긴 문서는 상태를 되돌릴 수 없습니다. 고쳐야 하면 새 문서(개정본)를 만드세요.';
    end if;
    if old.locked_at is not null then
      if new.locked_at is null then
        raise exception '잠긴 문서는 상태를 되돌릴 수 없습니다. 고쳐야 하면 새 문서(개정본)를 만드세요.';
      elsif new.locked_at <> old.locked_at then
        new.locked_at := old.locked_at;  -- 처음 잠긴 시각을 지킨다
      end if;
    end if;

    -- R2 잠긴 문서 내용 수정 금지(예외: 정기 청구, 빈 기간 채우기)
    v_new := to_jsonb(new) - v_progress;
    v_old := to_jsonb(old) - v_progress;
    if v_new is distinct from v_old then
      if ((v_new - v_locked_exempt)
            || jsonb_build_object('content_json', new.content_json - array['contractStart', 'contractEnd']))
         is distinct from
         ((v_old - v_locked_exempt)
            || jsonb_build_object('content_json', old.content_json - array['contractStart', 'contractEnd']))
         or (new.contract_start_date is distinct from old.contract_start_date and old.contract_start_date is not null)
         or (new.contract_end_date   is distinct from old.contract_end_date   and old.contract_end_date   is not null)
         or (new.contract_amount     is distinct from old.contract_amount     and old.contract_amount     is not null)
         or (new.partner_id          is distinct from old.partner_id          and old.partner_id          is not null)
         or ((new.content_json -> 'contractStart') is distinct from (old.content_json -> 'contractStart')
             and coalesce(old.content_json ->> 'contractStart', '') <> '')
         or ((new.content_json -> 'contractEnd') is distinct from (old.content_json -> 'contractEnd')
             and coalesce(old.content_json ->> 'contractEnd', '') <> '') then
        raise exception '잠긴 문서는 내용을 고칠 수 없습니다. 고쳐야 하면 새 문서(개정본)를 만드세요.';
      end if;
    end if;
  end if;

  -- 기존 판정 — 내용 칸이 바뀌면 권한 5조건(로직 변경 없음, 헬퍼로 이동)
  if (to_jsonb(new) - v_progress) is not distinct from (to_jsonb(old) - v_progress) then
    return new;
  end if;

  if public.document_content_editable(old) then
    return new;
  end if;

  raise exception '이 문서를 수정할 권한이 없습니다. 본인이 만든 문서만 고칠 수 있고, 다른 사람 문서는 마스터나 「남의 파일·문서 수정·삭제」 권한이 있어야 합니다.';
end;
$$;

revoke execute on function public.documents_content_edit_guard() from public, anon, authenticated;

drop trigger if exists trg_documents_content_edit_guard on public.documents;
create trigger trg_documents_content_edit_guard
  before update on public.documents
  for each row execute function public.documents_content_edit_guard();

-- ── C) 문서번호 발급 ─────────────────────────────────────────────
create or replace function public.issue_document(p_doc_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_company uuid;
  v_doc_company uuid;
  v_doc public.documents%rowtype;
  v_prefix text;
  v_seq bigint;
  v_no text;
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
    raise exception '다른 회사의 문서에는 문서번호를 발급할 수 없습니다.';
  end if;
  if public.is_advisor_session() then
    raise exception '세무대리인은 문서번호를 발급할 수 없습니다.';
  end if;

  select * into v_doc from public.documents where id = p_doc_id for update;

  -- 이미 번호가 있으면 그대로 — 재발급으로 번호가 바뀌지 않는다
  if coalesce(v_doc.document_number, '') <> '' then
    return v_doc.document_number;
  end if;

  perform pg_advisory_xact_lock(hashtext('doc_number:' || v_company::text));

  v_prefix := 'DOC-' || to_char(now() at time zone 'Asia/Seoul', 'YYYYMM') || '-';
  select max((substring(d.document_number from '-(\d{1,18})$'))::bigint)
    into v_seq
    from public.documents d
   where d.company_id = v_company
     and d.document_number like v_prefix || '%';
  v_seq := coalesce(v_seq, 0) + 1;
  v_no := v_prefix || lpad(v_seq::text, greatest(4, length(v_seq::text)), '0');

  update public.documents
     set document_number = v_no,
         issued_at = now(),
         locked_at = coalesce(locked_at, now()),
         status = case when status in ('locked', 'executed') then status else 'issued' end
   where id = p_doc_id;

  return v_no;
end;
$$;

revoke execute on function public.issue_document(uuid) from public, anon;
grant execute on function public.issue_document(uuid) to authenticated;

-- ── D) 직인 적용 ────────────────────────────────────────────────
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

  if not public.document_content_editable(v_doc) then
    raise exception '이 문서에 직인을 찍을 권한이 없습니다. 본인이 만든 문서만 찍을 수 있고, 다른 사람 문서는 마스터나 「남의 파일·문서 수정·삭제」 권한이 있어야 합니다.';
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
