-- 문서 보안 W4·W7 (2026-10-01, 9/30 보안 검토 후속).
--   W4 History: documents_content_edit_guard 는 status·locked_at·issued_at 을 '진행 칸'으로 빼고 비교해, 같은 회사면 누구나
--      남의 초안을 잠그거나(잠금은 되돌릴 수 없어 영구) status='executed' 로 체결을 위조할 수 있었다.
--   W4 규칙: 잠금(locked_at 처음 채움)·status→locked/executed/issued·issued_at 변경은
--      그 문서 수정 권한자(document_content_editable) 이거나 그 문서의 서명 요청이 전부 '서명 완료'일 때만.
--      (서명 완료 후 자동 잠금 finalizeFullySignedDocuments 는 아무 회사 사용자 세션에서 돈다 — 그 길은 남긴다.)
--      클라이언트가 처음 잠글 때 locked_at 은 서버 시각으로 고정한다(과거·미래 시각 기입 방지).
--   W7 History: signature_requests 쓰기 RLS = 같은 회사면 누구나 → status='signed'·서명 데이터를 직접 넣어 서명을 위조할 수 있었다.
--   W7 규칙(클라이언트): 처음부터 서명 완료로 만들 수 없다. 서명 완료·서명 데이터 기록은 그 요청을 만든 사람
--      (자체 서명·종이 서명 수기 완료) 또는 문서 수정 권한자만. 외부 서명자는 /api/sign/submit(서비스 키)으로 그대로.
--   W2(직인 뒤 내용 수정 금지)는 넣지 않았다 — 견적→계약 자동 생성이 만들자마자 직인을 찍어, 보내기 전 수정까지 막힌다(사장님 결정 대기).
--   기존 데이터 무변경.

create or replace function public._document_fully_signed(p_doc uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select count(*) > 0 and count(*) filter (where status is distinct from 'signed') = 0
    from public.signature_requests where document_id = p_doc
$$;
revoke all on function public._document_fully_signed(uuid) from public, anon;
grant execute on function public._document_fully_signed(uuid) to authenticated;

create or replace function public._document_editable_by_id(p_doc uuid)
returns boolean language plpgsql stable security definer set search_path = public as $$
declare d public.documents%rowtype;
begin
  select * into d from public.documents where id = p_doc;
  if not found then return false; end if;
  return coalesce(public.document_content_editable(d), false);
end $$;
revoke all on function public._document_editable_by_id(uuid) from public, anon;
grant execute on function public._document_editable_by_id(uuid) to authenticated;

-- ── W4: 잠금·체결·발행 전이 가드 (기존 내용 가드 앞에서 따로 — 기존 함수는 건드리지 않는다) ──
create or replace function public.documents_lock_transition_guard()
returns trigger language plpgsql set search_path = public as $$
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if (new.status is distinct from old.status and new.status in ('locked', 'executed', 'issued'))
     or (old.locked_at is null and new.locked_at is not null)
     or (new.issued_at is distinct from old.issued_at) then
    if not (coalesce(public.document_content_editable(old), false) or public._document_fully_signed(old.id)) then
      raise exception '이 문서를 잠그거나 체결·발행 처리할 권한이 없습니다. 문서 수정 권한자이거나 서명이 모두 끝나야 합니다.' using errcode = '42501';
    end if;
    if old.locked_at is null and new.locked_at is not null then
      new.locked_at := now();
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_documents_lock_transition_guard on public.documents;
create trigger trg_documents_lock_transition_guard before update on public.documents
  for each row execute function public.documents_lock_transition_guard();

-- ── W7: 서명 기록 가드 ──
create or replace function public.signature_requests_guard_trg()
returns trigger language plpgsql set search_path = public as $$
declare v_me uuid;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.status = 'signed' or new.signed_at is not null or new.signature_data is not null
       or new.signature_data_url is not null or new.signed_contract_html is not null then
      raise exception '서명 요청은 서명 전 상태로만 만들 수 있습니다' using errcode = '42501';
    end if;
    return new;
  end if;
  if (new.status = 'signed' and old.status is distinct from 'signed')
     or new.signed_at is distinct from old.signed_at
     or new.signature_data is distinct from old.signature_data
     or new.signature_data_url is distinct from old.signature_data_url
     or new.signed_contract_html is distinct from old.signed_contract_html
     or new.signed_sha256 is distinct from old.signed_sha256
     or new.signer_inputs is distinct from old.signer_inputs then
    v_me := public.current_app_user_id();
    if not (old.created_by is not distinct from v_me
            or (old.document_id is not null and public._document_editable_by_id(old.document_id))) then
      raise exception '서명 완료는 서명 요청을 만든 사람이나 문서 수정 권한자만 기록할 수 있습니다' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_signature_requests_guard on public.signature_requests;
create trigger trg_signature_requests_guard before insert or update on public.signature_requests
  for each row execute function public.signature_requests_guard_trg();
