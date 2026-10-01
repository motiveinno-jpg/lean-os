-- 서명 기록 가드 v2 — 종이 서명 등록·서명자 본인 서명 (2026-10-01 사장님: 수기 완료는 추천 (나)).
--   v1(20261001180000): 서명 완료는 '요청을 만든 사람 또는 문서 수정 권한자' → 만든 사람이 상대방 이름만 쳐서 완료할 수 있었다(전자서명과 구별 안 됨).
--   v2 규칙 (클라이언트 = authenticated/anon. 외부 서명 /api/sign/submit·직인 RPC 는 서버 권한이라 그대로):
--     · 서명 완료·서명 데이터 기록은 둘 중 하나만
--       ① 종이 서명 — signature_method='paper' · signature_data.type='paper' · 스캔본 경로(file) 필수 · 그 문서 수정 권한자
--       ② 서명자 본인 — 요청의 서명자 이메일 = 내 계정 이메일 (자체 서명 'self-sign@company.internal' 은 만든 본인)
--     · 서명자 이름·이메일·문서·회사·만든 사람은 만든 뒤 못 바꾼다(서명자를 나로 바꿔 서명하는 우회 차단).
--     · 처음부터 서명 완료로 만들 수 없다(v1 그대로).
--   기존 데이터 무변경.
create or replace function public.signature_requests_guard_trg()
returns trigger language plpgsql set search_path = public as $$
declare v_me uuid; v_my_email text;
begin
  if current_user not in ('authenticated', 'anon') then return new; end if;
  if tg_op = 'INSERT' then
    if new.status = 'signed' or new.signed_at is not null or new.signature_data is not null
       or new.signature_data_url is not null or new.signed_contract_html is not null then
      raise exception '서명 요청은 서명 전 상태로만 만들 수 있습니다' using errcode = '42501';
    end if;
    return new;
  end if;
  if new.signer_name is distinct from old.signer_name or new.signer_email is distinct from old.signer_email
     or new.document_id is distinct from old.document_id or new.company_id is distinct from old.company_id
     or new.created_by is distinct from old.created_by then
    raise exception '서명자·문서 정보는 바꿀 수 없습니다. 새 서명 요청을 만드세요.' using errcode = '42501';
  end if;
  if (new.status = 'signed' and old.status is distinct from 'signed')
     or new.signed_at is distinct from old.signed_at
     or new.signature_data is distinct from old.signature_data
     or new.signature_data_url is distinct from old.signature_data_url
     or new.signed_contract_html is distinct from old.signed_contract_html
     or new.signed_sha256 is distinct from old.signed_sha256
     or new.signer_inputs is distinct from old.signer_inputs
     or new.signature_method is distinct from old.signature_method then
    v_me := public.current_app_user_id();
    if new.signature_method = 'paper' then
      if coalesce(new.signature_data ->> 'type', '') <> 'paper' or coalesce(new.signature_data ->> 'file', '') = '' then
        raise exception '종이 서명은 서명된 스캔본을 올려야 등록할 수 있습니다' using errcode = '42501';
      end if;
      if old.document_id is null or not public._document_editable_by_id(old.document_id) then
        raise exception '종이 서명은 그 계약서를 수정할 수 있는 사람만 등록할 수 있습니다' using errcode = '42501';
      end if;
      return new;
    end if;
    select lower(email) into v_my_email from public.users where id = v_me;
    if not (
         (v_my_email is not null and lower(coalesce(old.signer_email, '')) = v_my_email)
      or (old.signer_email = 'self-sign@company.internal' and old.created_by is not distinct from v_me)
    ) then
      raise exception '서명은 서명자 본인만 할 수 있습니다. 거래처가 종이에 서명했다면 「종이 서명 등록」으로 스캔본을 올려 주세요.' using errcode = '42501';
    end if;
  end if;
  return new;
end $$;
