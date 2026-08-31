-- 자동 판매전표 — 보안 리뷰 보완 2건 (W-2 계정 성격 검증 · W-4 금액 상한)
--   대상: 20260831190000_auto_voucher_on_signed.sql 의 auto_voucher_for_signed_quote().
--   본문은 프로덕션 현행 그대로 두고 **가드 두 개만** 얹는다(회계 로직·분개·초안 계산서 무변경).
--
-- ── ① History — 왜 지금 이 모양인가 ──────────────────────────────────────────
--   · 190000 은 회사설정 project_sales_account.account_id 가 "같은 회사에 존재하는 계정인가"만 봤다.
--     회사 격리는 되지만 **성격은 안 봤다** — company_settings 는 관리자가 REST 로 직접 쓸 수 있으므로
--     자산(108 외상매출금)·부채(255 부가세예수금) 계정을 매출 자리에 넣으면 그대로 대변에 꽂혔다.
--     차) 외상매출금 / 대) 외상매출금 같은 분개가 '확정' 상태로 남으면 손익이 통째로 틀어진다.
--   · 금액 상한도 없었다. payload.items[].supplyAmount 는 사용자가 넣는 값이고 numeric 이라
--     오타 한 번(0 몇 개 더)으로 조 단위 확정 전표 + 세금계산서 초안이 자동 생성된다.
--
-- ── ② 자문자답 ───────────────────────────────────────────────────────────────
--   Q. 무엇을 기준으로 "이 계정에 매출을 꽂아도 된다"고 판단하나?
--      A. chart_of_accounts.account_type = 'revenue'. 실측 분포는 expense/asset/equity/liability/revenue
--         5종뿐이라 열거값이 흔들리지 않는다. 코드(4xx)로 판단하지 않는다 — 회사가 코드 체계를 바꿔 쓴다.
--   Q. 성격이 틀렸을 때 무엇을 하나?
--      A. **추측해서 다른 계정으로 갈아타지 않는다.** 기존 '설정 무효' 경로(알림 + no-op)로 떨어뜨리되
--         사유를 문구에 적는다("매출 계정이 아닙니다") — 안 적으면 "설정했는데 왜 안 되냐"가 된다.
--   Q. 상한은 얼마가 맞나?
--      A. 공급가 1조(1,000,000,000,000) 초과. 중소기업 계약 한 건에 정상적으로 나올 수 없는 자릿수이고,
--         넘으면 자동 발행 대신 사람이 보게 만든다(막는 게 아니라 손으로 넘긴다).
--   Q. 반대 경우 — 진짜 1조 계약이면? A. 알림 링크로 매입매출전표에서 직접 입력. 자동만 멈춘다.
--
-- ── ③ 결정 ──────────────────────────────────────────────────────────────────
--   결정 W-2. 계정 검증에 account_type='revenue' 추가.
--             규칙: 없는 계정·남의 회사 계정 → code 'no_setting'(기존 그대로),
--                   있는데 매출이 아님 → code 'bad_account_type' + 사유 명시 알림.
--             AS_IS ▶ TO_BE: 자산/부채 계정 지정 시 전표 발행 ▶ 미발행 + 알림.
--             적용 시점: 배포 즉시(다음 서명부터). 기존 데이터: 소급 취소하지 않는다(감사 흔적 보존).
--   결정 W-4. 공급가 > 1e12 → code 'amount_too_large' + '금액 확인 필요' 알림, 전표·계산서 없음.
--             AS_IS ▶ TO_BE: 상한 없음 ▶ 상한 초과 시 사람에게 넘김.
--
-- ── ④ 누락 점검 ─────────────────────────────────────────────────────────────
--   권한/RLS: 함수 3종 모두 SECURITY DEFINER + proacl = {postgres,service_role} — anon/authenticated
--             EXECUTE 없음(이번 파일에서도 GRANT 하지 않는다). 새 테이블·새 정책 없음 → RLS 해당없음.
--   경계값: v_supply 정확히 1e12 = 통과(초과만 차단), 0 이하는 기존 no_amount 가 먼저 잡는다.
--   중복실행: reference_type/reference_id 중복 차단 그대로. 되돌리기: 알림만 남으므로 불필요.
--   빈상태·마감·기존데이터·파급화면·외부전송·인쇄엑셀·모바일폭: 해당없음(서버 로직만, 초안 계산서 경로 무변경).
--
-- ── ⑤ 버린 안 ───────────────────────────────────────────────────────────────
--   · 매출 계정을 자동 추측(코드 401 등)해 대체 → 회계를 조용히 틀리게 만든다. 버림.
--   · company_settings 에 CHECK 제약 → settings 는 자유 jsonb 라 전 회사 기존 값이 깨질 수 있다. 버림.
--   · 상한을 회사설정 값으로 → 설정 항목이 하나 더 늘고 아무도 안 정한다. 고정 상한 + 알림으로 충분.

create or replace function public.auto_voucher_for_signed_quote(p_approval uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_row      public.quote_approvals%rowtype;
  v_settings jsonb;
  v_cfg      jsonb;
  v_acct     uuid;
  v_acct_type text;
  v_bad_type boolean := false;
  v_kind     text;
  v_vat_code text;
  v_items    jsonb;
  v_supply   numeric := 0;
  v_vat      numeric := 0;
  v_total    numeric := 0;
  v_raw      text;
  v_ar       uuid;
  v_vat_acct uuid;
  v_partner  uuid;
  v_pname    text;
  v_bizno    text;
  v_deal     record;
  v_date     date;
  v_no       int;
  v_entry    uuid;
  v_desc     text;
  v_inv      uuid;
  v_on       boolean;
begin
  select * into v_row from public.quote_approvals where id = p_approval;
  if not found then return jsonb_build_object('ok', false, 'code', 'not_found'); end if;
  if v_row.status <> 'fully_signed' or coalesce(v_row.stage, '') <> 'contract' then
    return jsonb_build_object('ok', false, 'code', 'not_applicable');
  end if;

  --   모티브 게이트 — feature_on() 은 auth 컨텍스트에 따라 false 를 돌려주므로 rollout 표를 직접 본다.
  select exists (
    select 1 from public.feature_rollout f
     where f.feature = 'projecthub_items_v3'
       and (f.company_id is null or f.company_id = v_row.company_id)
  ) into v_on;
  if not v_on then return jsonb_build_object('ok', false, 'code', 'feature_off'); end if;

  --   이미 만든 전표가 있으면 아무것도 하지 않는다(반려된 것은 없는 것으로 친다)
  if exists (
    select 1 from public.journal_entries je
     where je.company_id = v_row.company_id
       and je.reference_type = 'quote_approval' and je.reference_id = v_row.id
       and je.status <> 'rejected'
  ) then
    return jsonb_build_object('ok', false, 'code', 'already_posted');
  end if;

  select id, name, partner_id, contract_total into v_deal from public.deals where id = v_row.deal_id;
  v_partner := coalesce(v_row.partner_id, v_deal.partner_id);
  select p.name, p.business_number into v_pname, v_bizno from public.partners p
   where p.id = v_partner and p.company_id = v_row.company_id;

  -- ── 금액 — payload.items → variables.계약금액 → deals.contract_total (전부 공급가액 기준) ──
  v_items := v_row.payload->'items';
  if jsonb_typeof(v_items) = 'array' and jsonb_array_length(v_items) > 0 then
    select coalesce(sum(case when (x->>'supplyAmount') ~ '^-?[0-9.]+$' then (x->>'supplyAmount')::numeric else 0 end), 0),
           coalesce(sum(case when (x->>'taxAmount')    ~ '^-?[0-9.]+$' then (x->>'taxAmount')::numeric    else 0 end), 0)
      into v_supply, v_vat
      from jsonb_array_elements(v_items) x;
  end if;
  if coalesce(v_supply, 0) = 0 then
    v_raw := regexp_replace(coalesce(v_row.payload->'variables'->>'계약금액', ''), '[^0-9-]', '', 'g');
    if v_raw ~ '^-?[0-9]+$' then v_supply := v_raw::numeric; end if;
  end if;
  if coalesce(v_supply, 0) = 0 then v_supply := coalesce(v_deal.contract_total, 0); end if;
  v_supply := round(coalesce(v_supply, 0));

  -- ── 회사설정 — 없으면 여기까지(알림만) ──
  select cs.settings into v_settings from public.company_settings cs where cs.company_id = v_row.company_id;
  v_cfg  := coalesce(v_settings->'project_sales_account', '{}'::jsonb);
  v_acct := nullif(v_cfg->>'account_id', '')::uuid;
  v_kind := case when coalesce(v_cfg->>'vat_type', 'taxable') = 'exempt' then 'exempt' else 'taxable' end;
  --   W-2: 같은 회사 계정인지 + **매출 성격인지**. 자산·부채를 매출 자리에 꽂으면 손익이 통째로 틀어진다.
  if v_acct is not null then
    select a.account_type into v_acct_type
      from public.chart_of_accounts a
     where a.id = v_acct and a.company_id = v_row.company_id;
    if v_acct_type is null then
      v_acct := null;                       -- 없는 계정 · 남의 회사 계정 (기존 동작)
    elsif v_acct_type <> 'revenue' then
      v_acct := null; v_bad_type := true;   -- 있지만 매출 계정이 아니다 → 추측하지 않고 사람에게
    end if;
  end if;

  if v_acct is null then
    if v_bad_type then
      perform public._notify_signed_voucher(
        v_row.company_id, v_row.deal_id,
        '전표를 만들지 못했습니다 — 지정된 계정이 매출 계정이 아닙니다',
        format('%s 계약이 양측 서명 완료됐습니다%s. 회사설정에 지정된 프로젝트 매출 기본 계정이 매출(수익) 계정이 아니라(현재 성격: %s) 자동 발행을 멈췄습니다 — 회사설정 › 계정과목·분류에서 매출 계정으로 다시 지정해 주세요. 계정을 임의로 바꿔 발행하지 않습니다.',
               coalesce(nullif(v_deal.name, ''), '프로젝트'),
               case when v_supply > 0 then format(' (공급가 ₩%s)', to_char(v_supply, 'FM999,999,999,999')) else '' end,
               coalesce(v_acct_type, '알 수 없음')),
        '/settings/finance?tab=chart');
      return jsonb_build_object('ok', false, 'code', 'bad_account_type', 'account_type', v_acct_type);
    end if;
    perform public._notify_signed_voucher(
      v_row.company_id, v_row.deal_id,
      '전표 발행 준비됨 — 프로젝트 매출 계정을 정해 주세요',
      format('%s 계약이 양측 서명 완료됐습니다%s. 회사설정 › 계정과목·분류에서 프로젝트 매출 기본 계정을 정하면 서명 즉시 판매전표가 자동 발행됩니다. 세금계산서는 언제나 초안까지만 만들고 발행은 사람이 합니다.',
             coalesce(nullif(v_deal.name, ''), '프로젝트'),
             case when v_supply > 0 then format(' (공급가 ₩%s)', to_char(v_supply, 'FM999,999,999,999')) else '' end),
      '/settings/finance?tab=chart');
    return jsonb_build_object('ok', false, 'code', 'no_setting');
  end if;

  if v_supply <= 0 then
    perform public._notify_signed_voucher(
      v_row.company_id, v_row.deal_id,
      '서명 완료 — 계약 금액이 없어 전표를 만들지 못했습니다',
      format('%s 계약이 양측 서명 완료됐지만 계약 금액을 찾지 못했습니다. 프로젝트의 계약 금액을 입력한 뒤 매입매출전표에서 직접 입력해 주세요.',
             coalesce(nullif(v_deal.name, ''), '프로젝트')),
      '/projecthub/' || v_row.deal_id::text);
    return jsonb_build_object('ok', false, 'code', 'no_amount');
  end if;

  --   W-4: 공급가 상한 — 1조 초과는 오타(0 몇 개)일 확률이 압도적이다. 자동만 멈추고 사람에게 넘긴다.
  if v_supply > 1000000000000 then
    perform public._notify_signed_voucher(
      v_row.company_id, v_row.deal_id,
      '서명 완료 — 금액 확인이 필요해 전표를 만들지 않았습니다',
      format('%s 계약의 공급가가 ₩%s 로 읽혔습니다. 1조 원을 넘는 금액은 입력 오류일 수 있어 자동 발행을 멈췄습니다 — 계약 금액을 확인한 뒤 맞다면 매입매출전표에서 직접 입력해 주세요.',
             coalesce(nullif(v_deal.name, ''), '프로젝트'), to_char(v_supply, 'FM999,999,999,999,999')),
      '/projecthub/' || v_row.deal_id::text);
    return jsonb_build_object('ok', false, 'code', 'amount_too_large', 'supply', v_supply);
  end if;

  -- ── 세액 — 과세는 10%(품목에 세액이 적혀 있으면 그 값), 면세는 0 ──
  if v_kind = 'exempt' then
    v_vat := 0;
    v_vat_code := '13';
  else
    if coalesce(v_vat, 0) = 0 then v_vat := round(v_supply * 0.1); else v_vat := round(v_vat); end if;
    v_vat_code := '11';
  end if;
  v_total := v_supply + v_vat;

  v_date := (coalesce(v_row.our_signed_at, v_row.decided_at, now()) at time zone 'Asia/Seoul')::date;
  if exists (
    select 1 from public.closing_checklists cc
     where cc.company_id = v_row.company_id and cc.month = to_char(v_date, 'YYYY-MM') and cc.status = 'locked'
  ) then
    perform public._notify_signed_voucher(
      v_row.company_id, v_row.deal_id,
      '서명 완료 — 마감된 달이라 전표를 만들지 않았습니다',
      format('%s 계약이 양측 서명 완료됐습니다(₩%s). %s 은 회계마감으로 잠겨 있어 자동 발행하지 않았습니다 — 마감을 풀거나 다음 달 전표로 직접 입력해 주세요.',
             coalesce(nullif(v_deal.name, ''), '프로젝트'), to_char(v_total, 'FM999,999,999,999'), to_char(v_date, 'YYYY-MM')),
      '/projecthub/' || v_row.deal_id::text);
    return jsonb_build_object('ok', false, 'code', 'period_locked');
  end if;

  -- ── 상대 계정 — 표준 코드 우선, 없으면 이름으로(회사가 코드를 바꿔 쓸 수 있다) ──
  select id into v_ar from public.chart_of_accounts
   where company_id = v_row.company_id and code = '108' limit 1;
  if v_ar is null then
    select id into v_ar from public.chart_of_accounts
     where company_id = v_row.company_id and name = '외상매출금' order by code limit 1;
  end if;
  if v_vat > 0 then
    select id into v_vat_acct from public.chart_of_accounts
     where company_id = v_row.company_id and code = '255' limit 1;
    if v_vat_acct is null then
      select id into v_vat_acct from public.chart_of_accounts
       where company_id = v_row.company_id and name = '부가세예수금' order by code limit 1;
    end if;
  end if;
  if v_ar is null or (v_vat > 0 and v_vat_acct is null) then
    perform public._notify_signed_voucher(
      v_row.company_id, v_row.deal_id,
      '서명 완료 — 계정과목이 없어 전표를 만들지 못했습니다',
      '외상매출금(108)·부가세예수금(255) 계정을 계정과목표에 만든 뒤 매입매출전표에서 직접 입력해 주세요.',
      '/settings/finance?tab=chart');
    return jsonb_build_object('ok', false, 'code', 'no_account');
  end if;

  -- ── 전표 ──
  select coalesce(max(voucher_no), 0) + 1 into v_no
    from public.journal_entries where company_id = v_row.company_id and entry_date = v_date;

  v_desc := format('%s 계약 서명 완료 — 자동 매출%s',
                   coalesce(nullif(v_deal.name, ''), '프로젝트'),
                   case when coalesce(v_pname, '') <> '' then ' · ' || v_pname else '' end);

  insert into public.journal_entries (
    company_id, entry_date, description, source, status, is_approved,
    voucher_no, voucher_type, entry_kind, vat_type, supply_amount, vat_amount,
    reference_type, reference_id, is_electronic, deal_id, sub_deal_id,
    created_by, approved_by, reviewed_by, reviewed_at
  ) values (
    v_row.company_id, v_date, v_desc, 'manual', 'confirmed', true,
    v_no, 'transfer', 'sale_purchase', v_vat_code, v_supply, v_vat,
    'quote_approval', v_row.id, false, v_row.deal_id, v_row.sub_deal_id,
    v_row.our_signer_user_id, v_row.our_signer_user_id, v_row.our_signer_user_id, now()
  ) returning id into v_entry;

  insert into public.journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id)
  values (v_entry, v_row.company_id, v_ar, v_total, 0, '서명 계약 근거 매출채권', v_partner);
  insert into public.journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id)
  values (v_entry, v_row.company_id, v_acct, 0, v_supply, v_desc, v_partner);
  if v_vat > 0 then
    insert into public.journal_lines (entry_id, company_id, account_id, debit, credit, description, partner_id)
    values (v_entry, v_row.company_id, v_vat_acct, 0, v_vat, '부가세 예수', v_partner);
  end if;

  -- ── 세금계산서는 '발행 준비됨' 초안까지 (국세청 전송 금지) ──
  --   그 프로젝트에 이미 계산서가 있으면 만들지 않는다(결정 81 회차 초안과 겹쳐 쌓이는 것 방지).
  if not exists (
    select 1 from public.tax_invoices ti
     where ti.company_id = v_row.company_id and ti.deal_id = v_row.deal_id and ti.status <> 'void'
  ) then
    insert into public.tax_invoices (
      company_id, deal_id, partner_id, type, counterparty_name, counterparty_bizno,
      item_name, label, supply_amount, tax_amount, total_amount, issue_date,
      tax_kind, doc_kind, status, source, nts_issue_status, auto_issued, journal_entry_id
    ) values (
      v_row.company_id, v_row.deal_id, v_partner, 'sales', coalesce(v_pname, ''), v_bizno,
      coalesce(nullif(v_deal.name, ''), '계약'), '서명 계약 — 발행 준비됨',
      v_supply, v_vat, v_total, v_date,
      case when v_kind = 'exempt' then 'exempt' else 'taxable' end,
      case when v_kind = 'exempt' then 'exempt' else 'tax' end,
      'draft', 'auto', 'draft', false, v_entry
    ) returning id into v_inv;
  end if;

  perform public._notify_signed_voucher(
    v_row.company_id, v_row.deal_id,
    format('서명 완료 — 판매전표 자동 발행 (₩%s)', to_char(v_total, 'FM999,999,999,999')),
    format('%s · 공급가 ₩%s + 부가세 ₩%s = ₩%s · %s 전표 #%s (근거: 양측 서명된 계약서)%s',
           coalesce(nullif(v_deal.name, ''), '프로젝트'),
           to_char(v_supply, 'FM999,999,999,999'), to_char(v_vat, 'FM999,999,999,999'),
           to_char(v_total, 'FM999,999,999,999'), to_char(v_date, 'YYYY-MM-DD'), v_no,
           case when v_inv is not null then ' · 세금계산서는 초안까지만 만들었습니다 — 발행은 세금·증빙에서 사람이 합니다.' else '' end),
    '/partners/reconciliation/sale-purchase');

  return jsonb_build_object('ok', true, 'code', 'posted', 'entry_id', v_entry, 'voucher_no', v_no,
                            'supply', v_supply, 'vat', v_vat, 'total', v_total, 'tax_invoice_id', v_inv);
end $function$;

--   권한 — 190000 과 동일. 트리거·서버(service_role) 전용, 클라이언트에 열지 않는다.
revoke all on function public.auto_voucher_for_signed_quote(uuid) from public, anon, authenticated;
grant execute on function public.auto_voucher_for_signed_quote(uuid) to service_role;
