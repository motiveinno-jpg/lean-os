-- 세금계산서 발행 요청 (tax_invoice_requests)
--
--   받는 쪽(요청 회사)이 받고 싶은 세금계산서 내용을 미리 채워 공급자(거래처)에게 링크를 보낸다.
--   공급자는 작성일만 넣고 **자기 명의로** 발행한다 — 세금계산서는 공급자가 발행하는 문서라
--   요청 회사가 대신 발행하는 길은 만들지 않는다(역발행 아님).
--
--   발행 경로 셋 (issued_via)
--     ownerview       공급자도 오너뷰 회사 — 세금·증빙 › 받은 발행 요청에서 자기 계산서로 발행(hometax-issue)
--                     → issue_request_mark_issued 로 요청에 묶는다. 사용량은 공급자 회사 몫(평소 발행과 같다).
--     popbill_public  비회원 공급자가 링크 화면에서 인증서 등록 후 바로 발행(엣지 issue-request-public).
--                     공급자가 오너뷰 고객이 아니므로 **요청 회사의 월 세금계산서 한도**로 센다
--                     (get_monthly_issue_usage 에 더한다 — 아래 6).
--     hometax_manual  공급자가 홈택스에서 직접 발행하고 승인번호를 적어 준다(issue_request_mark_manual).
--
--   매입 연결: 요청 회사의 매입 계산서가 홈택스 수집으로 들어오면 tax_invoices 트리거가
--   승인번호(없으면 공급자 사업자번호·합계·작성일 한 건 일치)로 purchase_invoice_id 를 채운다.
--
--   anon 은 표를 직접 못 읽는다. 링크 화면은 토큰 RPC(issue_request_by_token·issue_request_mark_manual)만 쓴다.

-- ── 1. 표 ────────────────────────────────────────────────────────────────
create table if not exists public.tax_invoice_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  partner_id uuid references public.partners(id) on delete set null,

  -- 공급자 — 요청 회사가 적은 값. 사업자번호는 숫자 10자리로 저장한다.
  supplier_business_number text not null check (supplier_business_number ~ '^[0-9]{10}$'),
  supplier_name text not null,
  supplier_representative text,
  supplier_email text not null,
  --   사업자번호가 같은 오너뷰 회사(정확히 한 곳일 때만). 트리거가 채운다.
  supplier_company_id uuid references public.companies(id) on delete set null,

  title text,
  po_number text,
  items jsonb not null default '[]'::jsonb check (jsonb_typeof(items) = 'array'),
  supply_amount numeric not null default 0,
  tax_amount numeric not null default 0,
  total_amount numeric not null default 0,
  tax_kind text not null default 'taxable' check (tax_kind in ('taxable', 'zero_rated', 'exempt')),
  purpose text not null default '청구' check (purpose in ('영수', '청구')),
  pay_bank_text text,
  pay_due_date date,
  memo text,

  -- 공급받는자(요청 회사) — 보내는 순간의 회사 정보. 트리거가 companies 에서 채운다(화면 값을 믿지 않는다).
  buyer_name text,
  buyer_business_number text,
  buyer_representative text,
  buyer_address text,
  buyer_business_type text,
  buyer_business_item text,
  buyer_email text,

  token text not null unique default encode(extensions.gen_random_bytes(24), 'hex'),
  status text not null default 'sent' check (status in ('sent', 'viewed', 'issued', 'canceled')),
  write_date date,
  issued_at timestamptz,
  issued_via text check (issued_via in ('ownerview', 'popbill_public', 'hometax_manual')),
  --   영숫자 24자리, 소문자로 저장(트리거가 정규화). 수집분은 하이픈형·대문자일 수 있어 비교할 때 맞춘다.
  nts_confirm_no text,
  supplier_invoice_id uuid references public.tax_invoices(id) on delete set null,
  purchase_invoice_id uuid references public.tax_invoices(id) on delete set null,

  -- 링크 화면에서 바로 발행(popbill_public) 할 때만 쓰는 칸
  supplier_profile jsonb,          -- 공급자가 입력한 자기 회사 정보(상호·대표자·주소·업태·종목·전화·이메일)
  public_issue_status text check (public_issue_status in ('pending', 'failed', 'issued')),
  public_response jsonb,           -- CODEF 응답 원본(실패 원인 대조·CF-05001 재발행 차단 판정)
  public_rate_window timestamptz,  -- 토큰당 호출 제한 창 시작
  public_rate_count int not null default 0,

  last_sent_at timestamptz,
  viewed_at timestamptz,
  created_by uuid references public.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '60 days')
);

comment on table public.tax_invoice_requests is
  '세금계산서 발행 요청 — 받는 쪽이 내용을 채워 공급자에게 링크로 보내고, 공급자가 자기 명의로 발행한다.';

create index if not exists tir_company_created_idx on public.tax_invoice_requests (company_id, created_at desc);
create index if not exists tir_supplier_company_idx on public.tax_invoice_requests (supplier_company_id) where supplier_company_id is not null;
create unique index if not exists tir_supplier_invoice_uq on public.tax_invoice_requests (supplier_invoice_id) where supplier_invoice_id is not null;
create unique index if not exists tir_company_confirm_uq on public.tax_invoice_requests (company_id, nts_confirm_no) where nts_confirm_no is not null;
--   매입 수집분 보조 연결(승인번호 없이 발행된 건) — 발행됐는데 아직 매입과 안 묶인 줄만
create index if not exists tir_unlinked_issued_idx on public.tax_invoice_requests (company_id, supplier_business_number)
  where status = 'issued' and purchase_invoice_id is null;

-- 링크 화면에서 바로 발행할 때 팝빌 회원가입을 한 사업자번호 — 서비스 키 전용(정책 없음).
--   같은 사업자번호를 다른 메일 주소의 요청으로 쓰지 못하게 첫 등록 메일에 묶는다:
--   요청 회사가 공급자 메일을 자기 주소로 적어 보내 남의 이름으로 발행하는 길을 막는 장치다.
create table if not exists public.tax_invoice_public_issuers (
  corp_num text primary key check (corp_num ~ '^[0-9]{10}$'),
  bound_email text not null,
  first_request_id uuid references public.tax_invoice_requests(id) on delete set null,
  profile jsonb,
  join_result jsonb,
  cert_url_issued_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.tax_invoice_public_issuers is
  '발행 요청 링크 화면에서 팝빌 회원가입한 공급자 — 사업자번호를 첫 등록 메일에 묶는다(엣지 issue-request-public 전용).';

-- ── 2. 권한(RLS) ─────────────────────────────────────────────────────────
alter table public.tax_invoice_requests enable row level security;
alter table public.tax_invoice_public_issuers enable row level security;

revoke all on public.tax_invoice_requests from anon;
revoke all on public.tax_invoice_public_issuers from anon, authenticated;
revoke delete, truncate, references, trigger on public.tax_invoice_requests from authenticated;
grant select, insert, update on public.tax_invoice_requests to authenticated;

drop policy if exists tir_requester_select on public.tax_invoice_requests;
create policy tir_requester_select on public.tax_invoice_requests
  for select to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and ((select public.has_perm('/tax-invoices')) or (select public.can_write_ledger()))
  );

drop policy if exists tir_supplier_select on public.tax_invoice_requests;
create policy tir_supplier_select on public.tax_invoice_requests
  for select to authenticated
  using (
    supplier_company_id is not null
    and supplier_company_id = (select public.get_my_company_id())
    and ((select public.has_perm('/tax-invoices')) or (select public.can_write_ledger()))
  );

drop policy if exists tir_requester_insert on public.tax_invoice_requests;
create policy tir_requester_insert on public.tax_invoice_requests
  for insert to authenticated
  with check (
    company_id = (select public.get_my_company_id())
    and ((select public.has_perm('/tax-invoices')) or (select public.can_write_ledger()))
  );

--   고치기는 아직 발행 전(sent·viewed)인 우리 요청만. 상태는 취소로만 바꿀 수 있다 —
--   그 밖의 칸 보호는 아래 tir_a_guard 트리거가 맡는다(RLS 는 칸 단위를 못 본다).
drop policy if exists tir_requester_update on public.tax_invoice_requests;
create policy tir_requester_update on public.tax_invoice_requests
  for update to authenticated
  using (
    company_id = (select public.get_my_company_id())
    and status in ('sent', 'viewed')
    and ((select public.has_perm('/tax-invoices')) or (select public.can_write_ledger()))
  )
  with check (
    company_id = (select public.get_my_company_id())
    and status in ('sent', 'viewed', 'canceled')
  );

drop policy if exists advisor_ro_ins on public.tax_invoice_requests;
create policy advisor_ro_ins on public.tax_invoice_requests as restrictive for insert to authenticated
  with check (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_upd on public.tax_invoice_requests;
create policy advisor_ro_upd on public.tax_invoice_requests as restrictive for update to authenticated
  using (not (select public.is_advisor_session()));
drop policy if exists advisor_ro_del on public.tax_invoice_requests;
create policy advisor_ro_del on public.tax_invoice_requests as restrictive for delete to authenticated
  using (not (select public.is_advisor_session()));

-- ── 3. 트리거 ────────────────────────────────────────────────────────────

-- 3-1. 칸 보호 (사용자 직접 쓰기만) — SECURITY INVOKER 라야 current_user 로 '사용자 직접'을 가른다.
--   PostgREST 로 들어온 사용자 쓰기는 current_user = 'authenticated'. 정의자 RPC·서비스 키·다른 트리거
--   안에서는 current_user 가 함수 주인/service_role 이라 통과한다.
create or replace function public.tir_a_guard()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  new.supplier_business_number := regexp_replace(coalesce(new.supplier_business_number, ''), '\D', '', 'g');
  if current_user <> 'authenticated' then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- 토큰·상태·발행 결과는 화면이 정하지 않는다
    new.token := encode(extensions.gen_random_bytes(24), 'hex');
    new.status := 'sent';
    new.write_date := null; new.issued_at := null; new.issued_via := null; new.nts_confirm_no := null;
    new.supplier_invoice_id := null; new.purchase_invoice_id := null; new.viewed_at := null;
    new.supplier_profile := null; new.public_issue_status := null; new.public_response := null;
    new.public_rate_window := null; new.public_rate_count := 0; new.last_sent_at := null;
    new.created_by := public.current_app_user_id();
    new.created_at := now();
    new.expires_at := now() + interval '60 days';
    return new;
  end if;

  -- UPDATE: 발행 전 요청의 내용 칸과 '취소'만
  if old.status not in ('sent', 'viewed') then
    raise exception '이미 발행됐거나 취소된 요청은 고칠 수 없습니다.' using errcode = 'P0001';
  end if;
  if new.status is distinct from old.status and new.status <> 'canceled' then
    raise exception '요청 상태는 취소로만 바꿀 수 있습니다.' using errcode = 'P0001';
  end if;
  if row(new.token, new.company_id, new.created_by, new.created_at, new.expires_at,
         new.write_date, new.issued_at, new.issued_via, new.nts_confirm_no,
         new.supplier_invoice_id, new.purchase_invoice_id, new.viewed_at,
         new.supplier_profile, new.public_issue_status, new.public_response,
         new.public_rate_window, new.public_rate_count, new.last_sent_at,
         new.buyer_name, new.buyer_business_number, new.buyer_representative, new.buyer_address,
         new.buyer_business_type, new.buyer_business_item, new.buyer_email)
     is distinct from
     row(old.token, old.company_id, old.created_by, old.created_at, old.expires_at,
         old.write_date, old.issued_at, old.issued_via, old.nts_confirm_no,
         old.supplier_invoice_id, old.purchase_invoice_id, old.viewed_at,
         old.supplier_profile, old.public_issue_status, old.public_response,
         old.public_rate_window, old.public_rate_count, old.last_sent_at,
         old.buyer_name, old.buyer_business_number, old.buyer_representative, old.buyer_address,
         old.buyer_business_type, old.buyer_business_item, old.buyer_email)
  then
    raise exception '바꿀 수 없는 칸이 들어 있습니다.' using errcode = 'P0001';
  end if;
  return new;
end $$;

revoke execute on function public.tir_a_guard() from public, anon, authenticated;

-- 3-2. 채우기 — 받는 쪽 정보·공급자 회사 찾기·매입 연결·수정 시각. 다른 회사 정보를 읽어야 해서 정의자.
--   이름순으로 tir_a_guard 다음에 돈다.
create or replace function public.tir_b_fill()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_comp record;
  v_email text;
  v_buyer_no text;
  v_ids uuid[];
  v text;
begin
  if tg_op = 'INSERT' then
    select name, business_number, representative, address, business_type, business_category, automation_settings
      into v_comp
      from public.companies where id = new.company_id;
    v_buyer_no := regexp_replace(coalesce(v_comp.business_number, ''), '\D', '', 'g');
    if v_buyer_no = '' then
      raise exception '우리 회사 사업자등록번호가 없어 요청을 보낼 수 없습니다 — 설정 › 회사 정보에서 입력해 주세요.' using errcode = 'P0001';
    end if;
    if v_buyer_no = new.supplier_business_number then
      raise exception '공급자 사업자번호가 우리 회사 사업자번호와 같습니다.' using errcode = 'P0001';
    end if;
    v_email := nullif(trim(coalesce(v_comp.automation_settings ->> 'invoicer_email', '')), '');
    if v_email is null and new.created_by is not null then
      select nullif(trim(email), '') into v_email from public.users where id = new.created_by;
    end if;
    new.buyer_name := v_comp.name;
    new.buyer_business_number := v_buyer_no;
    new.buyer_representative := v_comp.representative;
    new.buyer_address := v_comp.address;
    new.buyer_business_type := v_comp.business_type;
    new.buyer_business_item := v_comp.business_category;
    new.buyer_email := v_email;
  else
    new.updated_at := now();
  end if;

  -- 공급자가 오너뷰 회사인가 — 사업자번호가 정확히 한 회사와 맞을 때만
  if tg_op = 'INSERT' or new.supplier_business_number is distinct from old.supplier_business_number then
    select array_agg(id) into v_ids
      from public.companies
     where regexp_replace(coalesce(business_number, ''), '\D', '', 'g') = new.supplier_business_number
       and id <> new.company_id;
    new.supplier_company_id := case when coalesce(array_length(v_ids, 1), 0) = 1 then v_ids[1] else null end;
  end if;

  -- 승인번호 정규화 + 이미 들어와 있는 매입 계산서와 연결
  if new.nts_confirm_no is not null
     and (tg_op = 'INSERT' or new.nts_confirm_no is distinct from old.nts_confirm_no) then
    v := lower(regexp_replace(new.nts_confirm_no, '[^0-9A-Za-z]', '', 'g'));
    new.nts_confirm_no := nullif(v, '');
    if new.purchase_invoice_id is null and length(v) = 24 then
      --   수집분은 하이픈형(8-8-8)·대문자일 수 있다 — 네 모양으로 찾아 (company_id, nts_confirm_no) 유일 인덱스를 탄다
      select id into new.purchase_invoice_id
        from public.tax_invoices
       where company_id = new.company_id
         and type = 'purchase'
         and nts_confirm_no = any (array[
               v, upper(v),
               substr(v, 1, 8) || '-' || substr(v, 9, 8) || '-' || substr(v, 17, 8),
               upper(substr(v, 1, 8) || '-' || substr(v, 9, 8) || '-' || substr(v, 17, 8))])
       limit 1;
    end if;
  end if;
  return new;
end $$;

revoke execute on function public.tir_b_fill() from public, anon, authenticated;

drop trigger if exists tir_a_guard on public.tax_invoice_requests;
create trigger tir_a_guard before insert or update on public.tax_invoice_requests
  for each row execute function public.tir_a_guard();
drop trigger if exists tir_b_fill on public.tax_invoice_requests;
create trigger tir_b_fill before insert or update on public.tax_invoice_requests
  for each row execute function public.tir_b_fill();

-- 3-3. 알림 — 공급자가 오너뷰 회사면 그 회사 마스터에게, 발행되면 요청한 사람에게.
--   알림이 실패해도 요청 저장·발행 기록은 살린다.
create or replace function public.tir_c_notify()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_title text;
begin
  begin
    if new.supplier_company_id is not null
       and new.status in ('sent', 'viewed')
       and (tg_op = 'INSERT' or new.supplier_company_id is distinct from old.supplier_company_id) then
      v_title := coalesce(nullif(new.buyer_name, ''), '거래처') || '에서 세금계산서 발행을 요청했습니다';
      insert into public.notifications (company_id, user_id, type, title, message, link, entity_type, entity_id)
      select new.supplier_company_id, u.id, 'tax_invoice_request', v_title,
             coalesce(nullif(new.title, ''), '발행 요청') || ' · 합계 ' || to_char(new.total_amount, 'FM999,999,999,999') || '원',
             '/tax-invoices?tab=received&request=' || new.id::text,
             'tax_invoice_request', new.id
        from public.users u
       where u.company_id = new.supplier_company_id and u.is_master;
    end if;

    if tg_op = 'UPDATE' and new.status = 'issued' and old.status is distinct from 'issued' then
      v_title := coalesce(nullif(new.supplier_name, ''), '공급자') || '에서 세금계산서를 발행했습니다';
      insert into public.notifications (company_id, user_id, type, title, message, link, entity_type, entity_id)
      select new.company_id, u.id, 'tax_invoice_request', v_title,
             coalesce(nullif(new.title, ''), '발행 요청') || ' · 작성일 ' || coalesce(new.write_date::text, '-'),
             '/tax-invoices?tab=requests&request=' || new.id::text,
             'tax_invoice_request', new.id
        from public.users u
       where u.company_id = new.company_id
         and (u.id = new.created_by or (new.created_by is null and u.is_master));
    end if;
  exception when others then
    raise warning 'tir_c_notify: %', sqlerrm;
  end;
  return null;
end $$;

revoke execute on function public.tir_c_notify() from public, anon, authenticated;

drop trigger if exists tir_c_notify on public.tax_invoice_requests;
create trigger tir_c_notify after insert or update on public.tax_invoice_requests
  for each row execute function public.tir_c_notify();

-- 3-4. 계산서 쪽 연결 — 승인번호가 붙는 순간(수집·발행 후 갱신).
--   공급자 매출 계산서에 승인번호가 붙으면 요청에 옮기고(→ 3-2 가 매입을 찾는다),
--   요청 회사의 매입 계산서가 들어오면 요청에 묶는다. ⚠️ 홈택스 수집 경로라 절대 실패를 올리지 않는다.
create or replace function public.tax_invoices_link_issue_request()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v text;
  v_ids uuid[];
begin
  begin
    v := lower(regexp_replace(coalesce(new.nts_confirm_no, ''), '[^0-9A-Za-z]', '', 'g'));
    if length(v) = 24 then
      if new.type = 'sales' then
        update public.tax_invoice_requests
           set nts_confirm_no = v
         where supplier_invoice_id = new.id
           and nts_confirm_no is distinct from v;
      elsif new.type = 'purchase' then
        update public.tax_invoice_requests
           set purchase_invoice_id = new.id
         where company_id = new.company_id
           and nts_confirm_no = v
           and purchase_invoice_id is null;
        if not found then
          --   승인번호 없이 발행된 요청(링크 화면 발행은 다음 영업일에 번호가 붙는다) —
          --   공급자 사업자번호·합계·작성일이 **딱 한 건** 맞을 때만 묶는다. 둘 이상이면 사람이 본다.
          select array_agg(id) into v_ids
            from public.tax_invoice_requests
           where company_id = new.company_id
             and status = 'issued'
             and purchase_invoice_id is null
             and nts_confirm_no is null
             and supplier_business_number = regexp_replace(coalesce(new.counterparty_bizno, ''), '\D', '', 'g')
             and total_amount = new.total_amount
             and write_date = new.issue_date;
          if coalesce(array_length(v_ids, 1), 0) = 1 then
            update public.tax_invoice_requests
               set purchase_invoice_id = new.id, nts_confirm_no = v
             where id = v_ids[1];
          end if;
        end if;
      end if;
    end if;
  exception when others then
    raise warning 'tax_invoices_link_issue_request: %', sqlerrm;
  end;
  return null;
end $$;

revoke execute on function public.tax_invoices_link_issue_request() from public, anon, authenticated;

drop trigger if exists tax_invoices_link_issue_request on public.tax_invoices;
create trigger tax_invoices_link_issue_request
  after insert or update of nts_confirm_no on public.tax_invoices
  for each row when (new.nts_confirm_no is not null)
  execute function public.tax_invoices_link_issue_request();

-- ── 4. 알림 종류 추가 ────────────────────────────────────────────────────
alter table public.notifications drop constraint if exists notifications_type_check;
alter table public.notifications add constraint notifications_type_check check (type = any (array[
  'deal_update', 'expense_request', 'contract_expiry', 'signature_request', 'payment_due', 'system',
  'document', 'approval', 'chat', 'overtime_auto_clockout', 'project_checkin_due', 'overtime_request',
  'overtime_approved', 'overtime_rejected', 'company_join_request', 'approval_request', 'approval_approved',
  'approval_rejected', 'approval_reference', 'billing', 'board_post', 'contract_renewal',
  'hr_contract_package', 'leave_request', 'inventory', 'dormant_deal', 'dormant_partner', 'tax_due',
  'tax_invoice_request'
]::text[]));

-- ── 5. RPC ───────────────────────────────────────────────────────────────

-- 5-1. 링크로 열기 (anon·로그인 모두) — 화면에 필요한 값만 돌려준다.
--   없는 토큰은 null. 취소·만료는 상태와 요청 회사 이름만(내용은 안 보여 준다).
--   처음 열면 '열람'으로 바꾼다 — 단 요청 회사 사람이 자기 링크를 확인하는 건 열람이 아니다.
create or replace function public.issue_request_by_token(p_token text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  r public.tax_invoice_requests;
  v_me uuid;
  v_state text;
  v_member boolean;
begin
  if p_token is null or length(p_token) < 32 then
    return null;
  end if;
  select * into r from public.tax_invoice_requests where token = p_token;
  if not found then
    return null;
  end if;

  v_me := public.get_my_company_id();  -- 비로그인이면 null
  v_member := r.supplier_company_id is not null and v_me is not null and v_me = r.supplier_company_id;
  v_state := case
    when r.status = 'canceled' then 'canceled'
    when r.status = 'issued' then 'issued'
    when r.expires_at < now() then 'expired'
    else 'open' end;

  if v_state in ('canceled', 'expired') then
    return jsonb_build_object('state', v_state, 'buyer_name', r.buyer_name,
                              'request_id', null, 'is_supplier_member', false);
  end if;

  if v_state = 'open' and r.viewed_at is null and (v_me is null or v_me <> r.company_id) then
    update public.tax_invoice_requests
       set viewed_at = now(),
           status = case when status = 'sent' then 'viewed' else status end
     where id = r.id;
  end if;

  return jsonb_build_object(
    'state', v_state,
    'request_id', case when v_member then r.id else null end,
    'is_supplier_member', v_member,
    'buyer_name', r.buyer_name,
    'buyer_business_number', r.buyer_business_number,
    'buyer_representative', r.buyer_representative,
    'buyer_address', r.buyer_address,
    'buyer_business_type', r.buyer_business_type,
    'buyer_business_item', r.buyer_business_item,
    'buyer_email', r.buyer_email,
    'supplier_business_number', r.supplier_business_number,
    'supplier_name', r.supplier_name,
    'supplier_representative', r.supplier_representative,
    'supplier_email', r.supplier_email,
    'title', r.title,
    'po_number', r.po_number,
    'items', r.items,
    'supply_amount', r.supply_amount,
    'tax_amount', r.tax_amount,
    'total_amount', r.total_amount,
    'tax_kind', r.tax_kind,
    'purpose', r.purpose,
    'pay_bank_text', r.pay_bank_text,
    'pay_due_date', r.pay_due_date,
    'memo', r.memo,
    'write_date', r.write_date,
    'issued_at', r.issued_at,
    'issued_via', r.issued_via,
    'nts_confirm_no', r.nts_confirm_no,
    'expires_at', r.expires_at,
    'supplier_profile', r.supplier_profile,
    'public_issue_status', r.public_issue_status
  );
end $$;

revoke execute on function public.issue_request_by_token(text) from public, anon, authenticated;
grant execute on function public.issue_request_by_token(text) to anon, authenticated;

-- 5-2. 홈택스에서 직접 발행했다고 알리기 (anon·로그인 모두, 토큰)
--   승인번호는 하이픈을 빼고 24자리 영숫자, 앞 8자리 = 작성일자(운영 3,063건 전부 그랬다).
create or replace function public.issue_request_mark_manual(p_token text, p_write_date date, p_nts_confirm_no text)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  r public.tax_invoice_requests;
  v text;
begin
  if p_token is null or length(p_token) < 32 then
    raise exception '유효하지 않은 링크입니다.' using errcode = 'P0001';
  end if;
  if p_write_date is null then
    raise exception '작성일자를 입력해 주세요.' using errcode = 'P0001';
  end if;
  if p_write_date > (now() at time zone 'Asia/Seoul')::date then
    raise exception '작성일자는 오늘보다 늦을 수 없습니다.' using errcode = 'P0001';
  end if;
  v := lower(regexp_replace(coalesce(p_nts_confirm_no, ''), '[^0-9A-Za-z]', '', 'g'));
  if length(v) <> 24 then
    raise exception '승인번호는 하이픈을 빼고 24자리입니다 (지금 %자리).', length(v) using errcode = 'P0001';
  end if;
  if left(v, 8) <> to_char(p_write_date, 'YYYYMMDD') then
    raise exception '승인번호 앞 8자리는 작성일자와 같아야 합니다. 작성일자나 승인번호를 다시 확인해 주세요.' using errcode = 'P0001';
  end if;

  select * into r from public.tax_invoice_requests where token = p_token for update;
  if not found then
    raise exception '유효하지 않은 링크입니다.' using errcode = 'P0001';
  end if;
  if r.status = 'issued' then
    raise exception '이미 발행 완료로 기록된 요청입니다.' using errcode = 'P0001';
  end if;
  if r.status = 'canceled' then
    raise exception '요청 회사가 취소한 요청입니다.' using errcode = 'P0001';
  end if;
  if r.expires_at < now() then
    raise exception '기한이 지난 요청입니다. 요청 회사에 다시 보내 달라고 해 주세요.' using errcode = 'P0001';
  end if;
  --   링크 화면 발행이 막 진행 중이면 기다린다. 10분이 지나도 pending 이면(응답을 못 받고 끊긴 경우)
  --   홈택스에서 확인한 승인번호로 마무리할 수 있게 연다 — 그게 결과를 확정하는 유일한 길이다.
  if r.public_issue_status = 'pending' and r.updated_at > now() - interval '10 minutes' then
    raise exception '이 화면에서 발행이 진행 중입니다. 잠시 뒤 결과를 확인해 주세요.' using errcode = 'P0001';
  end if;

  begin
    update public.tax_invoice_requests
       set status = 'issued', issued_via = 'hometax_manual', write_date = p_write_date,
           issued_at = now(), nts_confirm_no = v
     where id = r.id;
  exception when unique_violation then
    raise exception '이 승인번호는 이미 다른 발행 요청에 기록돼 있습니다.' using errcode = 'P0001';
  end;
  return jsonb_build_object('ok', true, 'nts_confirm_no', v);
end $$;

revoke execute on function public.issue_request_mark_manual(text, date, text) from public, anon, authenticated;
grant execute on function public.issue_request_mark_manual(text, date, text) to anon, authenticated;

-- 5-3. 오너뷰 안에서 발행을 끝낸 공급자가 요청에 그 계산서를 묶기 (로그인)
create or replace function public.issue_request_mark_issued(p_request_id uuid, p_supplier_invoice_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_me uuid := public.get_my_company_id();
  r public.tax_invoice_requests;
  inv record;
begin
  if v_me is null then
    raise exception '로그인이 필요합니다.' using errcode = 'P0001';
  end if;
  if not (public.has_perm('/tax-invoices') or public.can_write_ledger()) then
    raise exception '세금계산서 권한이 없습니다.' using errcode = 'P0001';
  end if;

  select * into r from public.tax_invoice_requests where id = p_request_id for update;
  if not found or r.supplier_company_id is distinct from v_me then
    raise exception '요청을 찾을 수 없거나 권한이 없습니다.' using errcode = 'P0001';
  end if;
  if r.status = 'issued' then
    if r.supplier_invoice_id = p_supplier_invoice_id then
      return jsonb_build_object('ok', true, 'already', true);
    end if;
    raise exception '이미 발행 완료로 기록된 요청입니다.' using errcode = 'P0001';
  end if;
  if r.status = 'canceled' then
    raise exception '요청 회사가 취소한 요청입니다.' using errcode = 'P0001';
  end if;

  select id, company_id, type, nts_issue_status, issue_date, nts_confirm_no
    into inv
    from public.tax_invoices where id = p_supplier_invoice_id;
  if not found or inv.company_id <> v_me or inv.type <> 'sales' then
    raise exception '우리 회사 매출 계산서가 아닙니다.' using errcode = 'P0001';
  end if;
  if inv.nts_issue_status is distinct from 'issued' then
    raise exception '아직 홈택스로 전송되지 않은 계산서입니다.' using errcode = 'P0001';
  end if;

  update public.tax_invoice_requests
     set status = 'issued', issued_via = 'ownerview', write_date = inv.issue_date, issued_at = now(),
         supplier_invoice_id = inv.id,
         nts_confirm_no = nullif(lower(regexp_replace(coalesce(inv.nts_confirm_no, ''), '[^0-9A-Za-z]', '', 'g')), '')
   where id = r.id;
  return jsonb_build_object('ok', true);
end $$;

revoke execute on function public.issue_request_mark_issued(uuid, uuid) from public, anon, authenticated;
grant execute on function public.issue_request_mark_issued(uuid, uuid) to authenticated;

-- 5-4. 링크 화면 바로 발행 호출 제한 (서비스 키 전용 — 엣지 issue-request-public)
--   창 안에서 p_max 번까지 true. 창이 지나면 1부터 다시 센다. 한 문장 update 라 동시 호출에도 정확하다.
create or replace function public.issue_request_rate_hit(p_request_id uuid, p_max int, p_window_seconds int)
returns boolean
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_count int;
begin
  update public.tax_invoice_requests
     set public_rate_count = case
           when public_rate_window is null or public_rate_window < now() - make_interval(secs => p_window_seconds) then 1
           else public_rate_count + 1 end,
         public_rate_window = case
           when public_rate_window is null or public_rate_window < now() - make_interval(secs => p_window_seconds) then now()
           else public_rate_window end
   where id = p_request_id
  returning public_rate_count into v_count;
  return coalesce(v_count, p_max + 1) <= p_max;
end $$;

revoke execute on function public.issue_request_rate_hit(uuid, int, int) from public, anon, authenticated;
grant execute on function public.issue_request_rate_hit(uuid, int, int) to service_role;

-- ── 6. 월 발행 사용량 — 링크 화면 발행(popbill_public)을 요청 회사 몫으로 더한다 ──────
--   공급자가 오너뷰 고객이 아니라 그 사람 몫으로 셀 곳이 없다. 발행 비용(CODEF)은 우리가 내므로
--   요청 회사의 세금계산서 한도에서 1건 빠진다. 한도 판정(issue_allowance)·충전 차감(consume_issue_credit)이
--   모두 이 함수를 읽으므로 여기 한 곳만 고친다. 앞부분은 운영 정의 그대로다.
create or replace function public.get_monthly_issue_usage(p_company_id uuid)
returns table(tax_count integer, cash_count integer, total_count integer)
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $function$
  WITH m AS (
    SELECT (to_char((now() AT TIME ZONE 'Asia/Seoul'), 'YYYY-MM') || '-01')::date AS month_start
  ),
  t AS (
    SELECT count(*)::int AS c FROM public.tax_invoices ti, m
     WHERE ti.company_id = p_company_id
       AND (public.is_service_request() OR p_company_id = public.get_my_company_id())
       AND ti.nts_issue_status = 'issued'
       AND ti.nts_issued_at >= (m.month_start::text || 'T00:00:00+09:00')::timestamptz
  ),
  p AS (
    SELECT count(*)::int AS c FROM public.tax_invoice_requests tr, m
     WHERE tr.company_id = p_company_id
       AND (public.is_service_request() OR p_company_id = public.get_my_company_id())
       AND tr.issued_via = 'popbill_public'
       AND tr.status = 'issued'
       AND tr.issued_at >= (m.month_start::text || 'T00:00:00+09:00')::timestamptz
  ),
  c AS (
    SELECT count(*)::int AS c FROM public.cash_receipts cr, m
     WHERE cr.company_id = p_company_id
       AND (public.is_service_request() OR p_company_id = public.get_my_company_id())
       AND cr.source = 'codef'
       AND cr.status <> 'void'
       AND cr.issue_date >= m.month_start
  )
  SELECT (t.c + p.c), c.c, (t.c + p.c + c.c) FROM t, p, c;
$function$;
