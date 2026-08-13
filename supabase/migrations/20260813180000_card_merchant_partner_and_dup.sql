-- 카드 전표의 거래처 바로잡기 + 중복 유입 막기 (2026-08-13 사장님 제보)
--
--   ① 차변(비용) 줄의 거래처가 **비어 있었다.** 화면에는 대변(미지급금)의 BC카드가 대신 보여
--      "차변이 BC카드로 분개된다"로 읽혔다. 실제로 들어가야 할 것은 **가맹점**이다.
--      · 차) 복리후생비 [가온에프앤에스]  차) 부가세대급금 [가온에프앤에스]
--      · 대) 미지급금   [BC카드]          ← 카드대금은 카드사에 갚는다
--      가맹점을 거래처로 만들어 두어야 거래처원장에서 대조가 된다.
--      ★ 가맹점은 수백 곳이라 미리 다 만들지 않는다 — **전표를 만드는 순간에만** 등록한다.
--        실제로 장부에 쓴 곳만 남으므로 거래처 목록이 부풀지 않는다.
--
--   ② 같은 카드 사용이 **두 줄**로 들어오고 있었다(2026-06-01 하루에만 8쌍).
--      한 줄만 전표가 되고 나머지는 영영 '미처리'로 남아, 처리했는데도 목록에서 안 빠졌다.
--      원인: 중복 판정에 **승인번호가 같을 것**을 걸었는데, 청구내역(billing)에는 승인번호가 없고
--      승인내역(approval)에는 있어 서로 다른 건으로 통과했다.
--      → 한쪽이라도 승인번호가 비어 있으면 **같은 건으로 본다.**
--      (둘 다 승인번호가 있으면 예전대로 번호로 가른다 — 같은 가게 같은 금액 두 번 결제도 살아 있다)

-- 1) 카드 가맹점 거래처 — 전표를 만들 때만 찾거나 만든다
create or replace function public.resolve_merchant_partner(p_name text, p_bizno text default null)
returns uuid
language plpgsql
security definer
set search_path to 'public'
as $$
declare
  v_company uuid := public.get_my_company_id();
  v_name text := nullif(trim(coalesce(p_name, '')), '');
  v_biz  text := nullif(regexp_replace(coalesce(p_bizno, ''), '[^0-9]', '', 'g'), '');
  v_pid uuid;
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  if v_name is null then return null; end if;

  --   사업자번호가 있으면 그것이 가장 확실한 열쇠다 (상호는 지점명 때문에 조금씩 다르다)
  if v_biz is not null and length(v_biz) = 10 then
    select id into v_pid from partners
    where company_id = v_company
      and regexp_replace(coalesce(business_number, ''), '[^0-9]', '', 'g') = v_biz
    limit 1;
    if v_pid is not null then return v_pid; end if;
  end if;

  select id into v_pid from partners
  where company_id = v_company and trim(name) = v_name limit 1;
  if v_pid is not null then
    --   이름으로 찾았는데 사업자번호가 비어 있으면 이번에 알게 된 번호를 채워 둔다
    if v_biz is not null and length(v_biz) = 10 then
      update partners set business_number = coalesce(nullif(trim(business_number), ''), v_biz)
      where id = v_pid;
    end if;
    return v_pid;
  end if;

  insert into partners (company_id, name, type, business_number, notes)
  values (v_company, v_name, 'vendor',
          case when v_biz is not null and length(v_biz) = 10 then v_biz else null end,
          '카드 가맹점 — 전표 만들 때 자동 등록')
  returning id into v_pid;
  return v_pid;
end;
$$;

grant execute on function public.resolve_merchant_partner(text, text) to authenticated;

-- 2) 카드 중복 — 승인번호가 한쪽에만 있으면 같은 건으로 본다
create or replace function public.card_tx_prevent_dup()
returns trigger
language plpgsql
set search_path to 'public', 'pg_temp'
as $$
begin
  if exists (
    select 1 from public.card_transactions c
    where c.company_id = new.company_id
      and c.transaction_date = new.transaction_date
      and c.amount = new.amount
      and coalesce(c.merchant_name, '') = coalesce(new.merchant_name, '')
      and (
        coalesce(c.approval_number, '') = coalesce(new.approval_number, '')
        or coalesce(c.approval_number, '') = ''      -- 이미 있는 쪽이 청구내역
        or coalesce(new.approval_number, '') = ''    -- 새로 온 쪽이 청구내역
      )
  ) then
    return null;   -- 같은 건 — 조용히 건너뛴다(오류 아님)
  end if;
  return new;
end;
$$;

comment on function public.card_tx_prevent_dup() is
  '카드 중복 방지 — 청구내역엔 승인번호가 없어 같은 건이 두 번 들어오던 것을 막는다 (2026-08-13).';
