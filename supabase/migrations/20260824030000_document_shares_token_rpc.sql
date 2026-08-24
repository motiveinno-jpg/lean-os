-- document_shares: 토큰 기반 SECURITY DEFINER RPC 로 전환 + 블랭킷 anon SELECT 정책 제거 (2026-08-24 보안)
--
-- 사고: add_document_shares(20260307080458) 의
--     anon_read_active_shares FOR SELECT USING (is_active = true)
--   는 TO 절·회사 스코프가 없어 anon 포함 누구나
--     select share_token, document_id, company_id from public.document_shares where is_active
--   로 **전 회사의 활성 공유 토큰을 통째로 수집**할 수 있었다. share_token 은 공개 열람의 capability 라
--   토큰 목록 유출 = 전사 공유문서 열람 붕괴. 2026-07-06 감사(20260706170000)가 이 전환을
--   "Phase 2 get_share_by_token RPC" 로 미뤘으나 RPC 는 만들어지지 않았고 정책도 안 지워졌다.
--
-- 교정: /sign 페이지의 get_signature_request_by_token 과 동일 패턴 —
--   토큰을 넘겨야만 그 한 건을 돌려주는 SECURITY DEFINER RPC 를 만들고, 열거를 허용하던 정책을 지운다.
--   토큰은 24바이트 무작위 secret 이므로 anon 실행을 허용해도 열거가 불가능하다.
--   (문서 본문·회사 letterhead 는 RPC 안에서만 조인해 내려보낸다 — documents 는 여전히 anon RLS 로 차단됨.)

create or replace function public.get_share_by_token(p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path to 'public'
as $$
declare
  v jsonb;
begin
  if p_token is null or length(p_token) < 8 then
    return null;
  end if;

  select to_jsonb(ds.*) || jsonb_build_object(
    'documents',
    case when d.id is not null then to_jsonb(d.*) || jsonb_build_object(
      'companies',
      case when c.id is not null then jsonb_build_object(
        'name', c.name,
        'representative', c.representative,
        'address', c.address,
        'phone', c.phone,
        'business_number', c.business_number,
        'seal_url', c.seal_url
      ) else null end
    ) else null end
  )
  into v
  from public.document_shares ds
  left join public.documents d on d.id = ds.document_id
  left join public.companies c on c.id = d.company_id
  where ds.share_token = p_token
    and ds.is_active = true
    and (ds.expires_at is null or ds.expires_at > now())
  limit 1;

  return v;  -- 없으면 NULL
end;
$$;

revoke all on function public.get_share_by_token(text) from public;
grant execute on function public.get_share_by_token(text) to anon, authenticated;

comment on function public.get_share_by_token(text) is
  '외부 공유 페이지용(/share, 비로그인 anon) — share_token 으로 document_shares + documents + companies 반환 (anon 허용, token secret). 2026-08-24 anon_read_active_shares 열거 취약점 대체.';

-- 열거를 허용하던 블랭킷 정책 제거. 로그인 사용자의 자기 회사 공유 관리·조회는
--   company_members_manage_shares(authenticated, 회사 스코프) 가 그대로 담당한다.
drop policy if exists "anon_read_active_shares" on public.document_shares;

notify pgrst, 'reload schema';
