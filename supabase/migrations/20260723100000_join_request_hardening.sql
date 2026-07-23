-- 회사 합류 요청 하드닝 (2026-07-23)
--   기존 자산(company_join_requests·companies_business_number_uniq·company_join_request 알림) 확장.
--   ⚠️ 스키마/함수/인덱스만. 운영 데이터 변경 없음. 사업자번호 운영 중복 0건 확인 후 인덱스 교체.

-- ── STEP 3) 사업자번호 정규화 강화 — 숫자 10자리 기준 유니크 ──
--   기존 인덱스는 하이픈만 제거(replace '-')라 공백·점 형식이 우회 가능.
--   표시값(companies.business_number)은 000-00-00000 유지, 유니크는 숫자정규화값으로.
--   교체 전 중복 재확인: regexp_replace(business_number,'[^0-9]','','g') 기준 count>1 = 0 이어야 함.
drop index if exists public.companies_business_number_uniq;
create unique index if not exists companies_business_number_uniq
  on public.companies ((regexp_replace(business_number, '[^0-9]', '', 'g')))
  where business_number is not null and business_number <> '';

-- ── STEP 4·5) 요청 처리·이메일 추적 컬럼 ──
alter table public.company_join_requests add column if not exists granted_role text;      -- 승인 시 부여된 역할(employee/admin)
alter table public.company_join_requests add column if not exists rejection_reason text;   -- 거절 사유(선택)
alter table public.company_join_requests add column if not exists delivery_status text;    -- 결과메일: null/pending/sent/failed
alter table public.company_join_requests add column if not exists delivery_error text;     -- 메일 실패 사유
alter table public.company_join_requests add column if not exists email_sent_at timestamptz;
alter table public.company_join_requests add column if not exists last_result_email_type text; -- approved/rejected

-- ── STEP 2) pending 중복·스팸 차단 — 파셜 유니크(레이스 방어) ──
--   같은 요청자·같은 회사에 pending 이 둘 이상 생기지 못하게. 앱 dedupe 를 DB 로 승격.
create unique index if not exists company_join_requests_pending_uniq
  on public.company_join_requests (company_id, requester_auth_id)
  where status = 'pending';

-- ── STEP 4) 승인/거절 원자적 처리 RPC ──
--   단일 트랜잭션에서: 권한 검증 → 상태/만료 확인 → 타회사 소속 재확인 → users 연결 → 요청 상태 →
--   승인자·시각 기록 → 요청자 인앱 알림. 중간 실패 시 함수 예외로 전체 롤백. 멱등 처리.
--   보안: 요청자를 절대 owner 로 승격하지 않음(admin/employee 만). 타회사 요청 처리 차단.
create or replace function public.resolve_company_join_request(
  p_request_id uuid,
  p_action text,            -- 'approve' | 'reject'
  p_role text,              -- 'admin' | (그 외 전부 employee)
  p_reason text,
  p_resolver_user_id uuid   -- 처리자 public.users.id (API 가 인증에서 파생)
)
returns jsonb
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  r_company uuid;
  r_role text;
  req record;
  v_role text;
  v_name text;
  v_target_company uuid;
begin
  if p_action not in ('approve', 'reject') then
    return jsonb_build_object('error', 'bad_action');
  end if;

  -- 처리자 = owner/admin
  select company_id, role into r_company, r_role
    from public.users where id = p_resolver_user_id;
  if r_company is null then
    return jsonb_build_object('error', 'resolver_no_company');
  end if;
  if r_role not in ('owner', 'admin') then
    return jsonb_build_object('error', 'forbidden_not_admin');
  end if;

  -- 요청 행 잠금(동시 승인 직렬화)
  select * into req from public.company_join_requests where id = p_request_id for update;
  if not found then
    return jsonb_build_object('error', 'not_found');
  end if;
  if req.company_id <> r_company then
    return jsonb_build_object('error', 'forbidden_other_company');
  end if;

  -- 멱등: 이미 원하는 상태면 그대로 성공 반환
  if p_action = 'approve' and req.status = 'approved' then
    return jsonb_build_object('ok', true, 'status', 'approved', 'already', true,
      'requester_auth_id', req.requester_auth_id, 'granted_role', req.granted_role);
  end if;
  if p_action = 'reject' and req.status = 'rejected' then
    return jsonb_build_object('ok', true, 'status', 'rejected', 'already', true);
  end if;

  -- 만료 지연 처리
  if req.status = 'pending' and req.expires_at is not null and req.expires_at < now() then
    update public.company_join_requests set status = 'expired' where id = req.id;
    return jsonb_build_object('error', 'expired');
  end if;

  if req.status <> 'pending' then
    return jsonb_build_object('error', 'already_resolved', 'status', req.status);
  end if;

  if p_action = 'reject' then
    update public.company_join_requests
      set status = 'rejected', resolved_by = p_resolver_user_id, resolved_at = now(),
          rejection_reason = nullif(btrim(coalesce(p_reason, '')), '')
      where id = req.id;
    -- 요청자 알림(무소속이라 회사 스코프 알림은 회사=대상회사로 기록)
    insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read)
      values (req.company_id, req.requester_auth_id, 'company_join_request',
              '회사 가입 요청 결과', '가입 요청이 거절되었습니다. 자세한 내용은 메일을 확인해주세요.',
              'company_join_request', req.id, false);
    return jsonb_build_object('ok', true, 'status', 'rejected', 'requester_auth_id', req.requester_auth_id);
  end if;

  -- approve — 요청자가 그 사이 다른 회사 소속이 됐으면 중단(강제 이동 금지)
  select company_id into v_target_company from public.users where auth_id = req.requester_auth_id;
  if v_target_company is not null and v_target_company <> r_company then
    return jsonb_build_object('error', 'requester_in_other_company');
  end if;

  v_role := case when p_role = 'admin' then 'admin' else 'employee' end;  -- owner 승격 절대 금지
  v_name := coalesce(req.requester_name, split_part(req.requester_email, '@', 1));

  insert into public.users (id, auth_id, email, name, company_id, role)
    values (req.requester_auth_id, req.requester_auth_id, req.requester_email, v_name, r_company, v_role)
    on conflict (id) do update set company_id = excluded.company_id, role = excluded.role, name = excluded.name;

  update public.company_join_requests
    set status = 'approved', resolved_by = p_resolver_user_id, resolved_at = now(), granted_role = v_role
    where id = req.id;

  insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read)
    values (r_company, req.requester_auth_id, 'company_join_request',
            '회사 가입이 승인되었습니다', '가입이 승인되었습니다. 이제 회사 페이지를 사용할 수 있습니다.',
            'company_join_request', req.id, false);

  return jsonb_build_object('ok', true, 'status', 'approved',
    'requester_auth_id', req.requester_auth_id, 'granted_role', v_role);
end;
$$;

revoke execute on function public.resolve_company_join_request(uuid, text, text, text, uuid) from anon, authenticated;
