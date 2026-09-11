-- 설정 전수 점검 4차 — 화면에만 걸려 있던 권한을 DB 에도 건다 (2026-09-11).
--   지금까지는 "같은 회사면 누구나" 한 줄이라, 화면에서 탭이 안 보이는 일반 직원도 API 로는
--   회사 기초정보를 고치고, 외부인을 초대하고, 광고 키를 갈아 끼울 수 있었다(직원 계정으로 실측 확인).
--   기준: 대표·관리자(is_company_manager) 또는 그 일을 위임받은 설정 권한자.
begin;

--   회사 설정을 하나라도 위임받았는가. 설정 화면의 탭 노출 판정(/settings:*)과 같은 기준을 DB 로 옮긴 것.
create or replace function public.has_any_settings_perm()
returns boolean language sql stable security definer set search_path = 'public' as $$
  select exists (
    select 1 from public.member_permissions m
    join public.users u on u.id = m.user_id
    where u.auth_id = auth.uid() and m.perm_key like '/settings%')
$$;
comment on function public.has_any_settings_perm() is '회사 설정 권한(/settings:*)을 하나라도 받은 사람인가';
grant execute on function public.has_any_settings_perm() to authenticated;

-- ① 회사 기초정보 — 상호·사업자번호·대표자·주소·직인 주소·과세유형이 한 행에 있다.
--    과세유형은 세금계산서 발행 가능 여부를 가르는 값이라 잘못 바뀌면 발행 사고가 난다.
--    정책 이름만 "Owners can update company" 였고 조건에는 역할이 없었다.
alter policy "Owners can update company" on public.companies
  using (id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_any_settings_perm())))
  with check (id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_any_settings_perm())));

-- ② 초대 — 아무나 외부인을 회사에 넣거나 대기 중인 초대의 토큰을 읽을 수 있었다.
--    같은 화면의 합류 요청(company_join_requests)은 이미 '관리자 또는 /settings:team' 으로 잠겨 있다. 같은 기준으로 맞춘다.
alter policy "employee_invitations_company_access" on public.employee_invitations
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:team'))));
alter policy "partner_invitations_company" on public.partner_invitations
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:team'))));

-- ③ 광고 계정 — 바로 옆 company_api_keys 는 2026-09-10 에 권한이 걸렸는데 광고만 빠졌다.
alter policy "ad_accounts_rw" on public.ad_accounts
  using (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:api-keys'))
              or (select public.has_perm('/settings:ads'))))
  with check (company_id = (select public.get_my_company_id())
         and ((select public.is_company_manager()) or (select public.has_perm('/settings:api-keys'))
              or (select public.has_perm('/settings:ads'))));

--    키를 저장하는 함수도 같은 기준. 화면을 막아도 함수는 누구나 부를 수 있다.
create or replace function public.ad_account_save(p_id uuid, p_platform text, p_label text, p_external_id text, p_api_key text, p_api_secret text)
returns uuid language plpgsql security definer set search_path to 'public' as $$
declare v_company uuid; v_id uuid;
begin
  v_company := public.get_my_company_id();
  if v_company is null then raise exception '회사를 찾을 수 없습니다'; end if;
  --   2026-09-11 추가 — 화면만 막혀 있어 아무 구성원이나 광고 키를 갈아 끼울 수 있었다. 본문은 그대로.
  if not (public.is_company_manager() or public.has_perm('/settings:api-keys') or public.has_perm('/settings:ads')) then
    raise exception '광고 계정은 대표·관리자 또는 연동 권한자만 등록할 수 있습니다' using errcode = '42501';
  end if;

  if p_id is null then
    insert into public.ad_accounts (company_id, platform, label, external_id)
    values (v_company, p_platform, p_label, p_external_id)
    on conflict (company_id, platform, external_id)
      do update set label = excluded.label, updated_at = now()
    returning id into v_id;
  else
    update public.ad_accounts
       set label = p_label, external_id = p_external_id, updated_at = now()
     where id = p_id and company_id = v_company
    returning id into v_id;
    if v_id is null then raise exception '광고 계정을 찾을 수 없습니다'; end if;
  end if;

  --   키를 새로 준 경우에만 덮어쓴다(빈 값으로 지우지 않게)
  if coalesce(p_api_key, '') <> '' or coalesce(p_api_secret, '') <> '' then
    insert into public.ad_account_secrets (ad_account_id, api_key_enc, api_secret_enc)
    values (v_id, public.encrypt_credential(p_api_key), public.encrypt_credential(p_api_secret))
    on conflict (ad_account_id) do update
      set api_key_enc = coalesce(nullif(public.encrypt_credential(p_api_key), ''), public.ad_account_secrets.api_key_enc),
          api_secret_enc = coalesce(nullif(public.encrypt_credential(p_api_secret), ''), public.ad_account_secrets.api_secret_enc),
          updated_at = now();
    update public.ad_accounts set status = 'pending', sync_error = null where id = v_id;
  end if;
  return v_id;
end;
$$;

-- ④ 회사 법인 서류(documents 버킷의 company-docs/) — 법인인감증명서·통장사본이 들어간다.
--    같은 버킷의 다른 경로(결재 첨부 등)는 구성원이 써야 하므로, company-docs 앞칸만 따로 잠근다.
drop policy if exists documents_company_docs_gate on storage.objects;
create policy documents_company_docs_gate on storage.objects
  as restrictive for all to authenticated
  using (
    bucket_id <> 'documents'
    or coalesce((storage.foldername(name))[1], '') <> 'company-docs'
    or (select public.is_company_manager()) or (select public.has_perm('/settings:company-info')))
  with check (
    bucket_id <> 'documents'
    or coalesce((storage.foldername(name))[1], '') <> 'company-docs'
    or (select public.is_company_manager()) or (select public.has_perm('/settings:company-info')));

commit;
