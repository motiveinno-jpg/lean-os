-- 양측 서명 완료 = 확정 → 판매(매출)전표 자동 발행 (2026-08-31 프로젝트 개편 3단계 · 핑퐁 ③)
--   기획: docs/20260831_PLAN_project_hub_bidirectional.md 결정 6-4
--     "양측이 서명한 계약이 확정 근거이므로 확정을 두 번 요구하지 않는다. 전표는 서명된 계약서를
--      reference 로 연결(중복 차단). 단 **세금계산서는 예외의 예외** — 국세청 전송이라 자동 발행하지
--      않고 '발행 준비됨' 초안까지."
--
-- ── ① History — 지금 왜 이 모양인가 ───────────────────────────────────────────
--   · 계약 서명 골격은 이미 있다: submit_our_signature(20260521060000) 가 status='fully_signed' 로
--     바꾸고 deal.stage 를 전진시킨다. 여기에 전표만 없었다 — 사람이 매입매출전표 화면에서 다시 쳤다.
--   · 이미 같은 자리에 격리된 AFTER UPDATE 트리거 선례가 있다(auto_contract_on_approve,
--     20260701220000). 서명 RPC 본문을 고치지 않고 트리거로 얹는다 — 서명 흐름을 절대 막지 않기 위해서.
--   · 매출 전표의 정본은 save_sale_purchase_voucher 다. 재사용을 먼저 검토했으나 **못 쓴다**:
--       (1) get_my_company_id()·has_perm() 기반이라 서명자의 권한에 결과가 달라진다(트리거는 그러면 안 된다),
--       (2) p_reference_type CHECK 가 tax_invoice/card_transaction/cash_receipt/stock_doc 4종뿐이라
--           'quote_approval' 을 못 단다 → 중복 차단 키를 잃는다.
--     그래서 **관례만 그대로 베껴** 직접 쓴다(entry_kind='sale_purchase', source='manual',
--     status='confirmed', vat_type 11/13, 초안 세금계산서 동반, voucher_no 채번).
--
-- ── ② 자문자답 ────────────────────────────────────────────────────────────────
--   Q. 무엇을 기준으로 "발행해도 된다"고 판단하나?
--      A. ㉠ 모티브 게이트(feature_rollout 'projecthub_items_v3') ㉡ 회사가 **매출 계정을 정했는가**
--         (company_settings.settings.project_sales_account). 기본값 없음 — 정하지 않았으면 전표를
--         만들지 않고 알림만. 계정 추측은 회계를 틀리게 만든다.
--   Q. 금액은 어디서 오나?
--      A. contract 단계 payload 에는 template/variables/contract_period/special_terms 만 있다
--         (contract-stage-card.tsx buildPayload 실측). 금액은 variables.'계약금액' 한 칸뿐이고
--         그 값은 deals.contract_total 을 천단위 콤마로 찍은 것이다. 그래서
--         payload.items(있으면) → variables.계약금액 → deals.contract_total 순으로 읽는다.
--      ★ **계약금액 = 공급가액(VAT 별도)** 이다 — projecthub/page.tsx 가 'VAT포함'으로 입력하면
--        /1.1 해서 저장하고(공급가), 결정 81(contract_invoice_drafts)도 공급가에 10% 를 얹는다.
--        그래서 총액/1.1 로 나누지 않는다. 나눴다면 매출이 9% 작아진다.
--   Q. 반대 경우는? A. 금액 0·마감된 달·계정과목 없음·이미 발행됨 → 전표 없이 알림(또는 무시).
--   Q. 자동으로 못 푸는 것은? A. 국세청 발행. 초안까지만 만들고 발행은 사람이 세금·증빙에서.
--
-- ── ③ 결정 ───────────────────────────────────────────────────────────────────
--   결정 A. 발화 지점 = quote_approvals.status 가 'fully_signed' 로 **바뀌는** AFTER UPDATE,
--           stage='contract' 만. 같은 값 재저장은 무시. 실패는 raise warning 으로 삼켜 서명을 안 막는다.
--   결정 B. 분개(차/대) — 차) 외상매출금(108) 총액 / 대) 매출(회사설정 계정) 공급가
--           / 대) 부가세예수금(255) 세액. 거래처는 approval.partner_id → deals.partner_id.
--   결정 C. reference_type='quote_approval', reference_id=quote_approvals.id + 부분 UNIQUE 인덱스로
--           같은 서명 건 두 번 발행 불가(반려된 전표는 없는 것으로 친다 — unpost 규칙과 동일).
--   결정 D. journal_entries.deal_id = approval.deal_id (프로젝트 확정 수익 집계 연결).
--   결정 E. 세금계산서는 status='draft' + nts_issue_status='draft' 초안만, journal_entry_id 로 이 전표에
--           묶는다(=수집 목록에 '미처리 증빙'으로 다시 뜨지 않는다). 전송 경로는 사람이 누르는
--           hometax-issue 뿐이다(크론 없음 — cron.job 실측). **그 프로젝트에 이미 계산서가 하나라도
--           있으면 초안을 만들지 않는다** — 결정 81(계약 회차 초안)과 겹쳐 쌓이는 것을 막는다.
--   결정 F. 알림은 owner/admin 에게. type 은 기존 CHECK 안의 'deal_update', entity=deal.
--           설정이 없으면 "발행 준비됨 — 계정을 정하면 서명 즉시 자동 발행", 발행했으면 금액과 전표번호.
--   결정 G. 역분개 제안(계약 취소 시)은 이번에 만들지 않는다 — 알림 문구에도 넣지 않는다(후속).
--   적용 시점: 배포 즉시, 모티브(feature_rollout)만. 기존 데이터: 과거 fully_signed 행은 소급 발행하지
--           않는다(장부를 뒤로 건드리지 않는다).
--
-- ── ④ 누락 점검 ──────────────────────────────────────────────────────────────
--   권한 — 트리거는 서명자 권한과 무관(SECURITY DEFINER). RPC 는 새로 열지 않는다(EXECUTE 회수).
--   RLS — 새 테이블 없음. journal_entries·journal_lines·tax_invoices·notifications 기존 정책 그대로.
--   빈 상태·경계값 — 금액 0/음수면 발행하지 않는다. 면세는 세액 0(부가세 줄 자체를 안 만든다).
--   중복 실행 — 부분 UNIQUE 인덱스 + 사전 존재 검사 2중.
--   마감 — closing_checklists 가 잠근 달이면 발행하지 않고 알림.
--   외부 전송 — 없음(국세청 전송 안 함). 인쇄·엑셀·모바일 — 해당없음.
--   되돌리기 — 기존 unpost_evidence_voucher(전표 반려)로 되돌린다. 반려하면 다시 발행 가능.
--
-- ── ⑤ 파급 — 이 전표를 읽는 곳 (전부 실측) ────────────────────────────────────
--   · 부가세 신고서·매입매출 리포트: journal_entries(entry_kind='sale_purchase', status='confirmed')
--     만 읽는다 → **한 번만** 계상(tax_invoices 를 따로 더하지 않는다).
--   · 거래처 원장(partners/ledger): 계산서는 nts_confirm_no 가 있는 것만, 수동 전표는
--     source='manual' + reference_type<>'tax_invoice' + 라인에 그 거래처가 있는 것. → 우리 전표는
--     전표로 한 줄, 초안 계산서는 국세청 승인번호가 없어 빠진다 → 이중 계상 없음.
--     (그래서 source 를 'rule' 이 아니라 'manual' 로 둔다 — 'rule' 이면 원장에서 통째로 사라진다.)
--   · 수집(collect): 국세청에 실제로 있는 계산서만 본다(nts_confirm_no/issued) → 초안은 안 뜬다.
--   · 매입매출전표 화면: entry_kind·status 로만 거르므로 그대로 보이고, 저장분 수정은
--     update_sale_purchase_voucher(참조 미전달) 경로라 INVALID_REFERENCE 로 막히지 않는다.
--   ⚠ 남는 한 곳(기존 save_sale_purchase_voucher 와 **동일한** 성질의 한계): 초안 계산서를 나중에
--     사람이 국세청에 발행하면 그 계산서에도 승인번호가 생겨 원장에서 계산서 줄 + 전표 줄이 같이 잡힌다.
--     손으로 친 매출 전표(참조 없는 건)도 지금 똑같다 — 이 마이그레이션이 새로 만든 위험이 아니다.

-- ── 1) 중복 차단 — 같은 서명 건으로 살아있는 전표는 하나 ─────────────────────
create unique index if not exists journal_entries_quote_approval_uniq
  on public.journal_entries (reference_id)
  where reference_type = 'quote_approval' and status <> 'rejected';

-- ── 2) 알림 한 곳 — owner/admin 에게. type 은 기존 CHECK 안의 값('deal_update')만 쓴다 ──
create or replace function public._notify_signed_voucher(
  p_company uuid, p_deal uuid, p_title text, p_message text, p_link text)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.notifications (company_id, user_id, type, title, message, entity_type, entity_id, is_read, created_at, link)
  select p_company, u.id, 'deal_update', p_title, p_message, 'deal', p_deal, false, now(), p_link
    from public.users u
   where u.company_id = p_company and u.role in ('owner', 'admin');
$$;

-- ── 3) 본체 — 서명된 계약 하나를 전표로 ──────────────────────────────────────
create or replace function public.auto_voucher_for_signed_quote(p_approval uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_row      public.quote_approvals%rowtype;
  v_settings jsonb;
  v_cfg      jsonb;
  v_acct     uuid;
  v_kind     text;          -- 'taxable' | 'exempt'
  v_vat_code text;          -- 매입매출전표 부가세 유형 코드 (11 과세매출 / 13 면세매출)
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

  --   모티브 게이트 — feature_on() 은 auth 컨텍스트(다른 회사 운영자·서비스 키)에 따라 false 를
  --   돌려주므로, 트리거 안에서는 같은 판정을 rollout 표에서 직접 한다.
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
  if v_acct is not null and not exists (
    select 1 from public.chart_of_accounts a where a.id = v_acct and a.company_id = v_row.company_id
  ) then
    v_acct := null;   -- 지워진 계정·남의 회사 계정이면 없는 것으로 친다
  end if;

  if v_acct is null then
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
end $$;

-- ── 4) 트리거 — 서명 흐름은 어떤 일이 있어도 막지 않는다 ─────────────────────
create or replace function public.trg_auto_voucher_on_signed()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_res jsonb;
begin
  if new.status = 'fully_signed'
     and old.status is distinct from 'fully_signed'
     and coalesce(new.stage, '') = 'contract' then
    begin
      v_res := public.auto_voucher_for_signed_quote(new.id);
    exception when others then
      --   전표가 안 서더라도 서명은 남는다. 원인은 로그로.
      raise warning 'auto_voucher_on_signed 실패 (approval=%): % / %', new.id, sqlstate, sqlerrm;
    end;
  end if;
  return new;
end $$;

drop trigger if exists auto_voucher_on_signed on public.quote_approvals;
create trigger auto_voucher_on_signed
  after update on public.quote_approvals
  for each row execute function public.trg_auto_voucher_on_signed();

-- ── 5) 권한 — 새 RPC 를 앱에 열지 않는다(트리거만 쓴다) ──────────────────────
revoke all on function public.auto_voucher_for_signed_quote(uuid) from public, anon, authenticated;
revoke all on function public._notify_signed_voucher(uuid, uuid, text, text, text) from public, anon, authenticated;
revoke all on function public.trg_auto_voucher_on_signed() from public, anon, authenticated;
grant execute on function public.auto_voucher_for_signed_quote(uuid) to service_role;

comment on function public.auto_voucher_for_signed_quote(uuid) is
  '양측 서명된 계약(quote_approvals fully_signed·contract) → 판매전표 자동 발행. 회사설정 project_sales_account 가 없으면 알림만. 세금계산서는 초안까지(국세청 전송 없음). 기획 결정 6-4.';

notify pgrst, 'reload schema';
