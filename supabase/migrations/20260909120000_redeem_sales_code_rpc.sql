-- 국내카드(토스) 결제에서도 영업코드를 실제로 기록 (2026-09-09).
--   종전엔 영업코드가 Stripe 경로(웹훅 메타데이터)에서만 기록되고, 기본 결제수단인 토스에선
--   조용히 버려졌다 — 화면은 "결제에 함께 기록됩니다"라고 표시. 두 경로 모두 기록되도록,
--   결제 성공 뒤 호출하는 멱등 RPC 를 둔다(회사당 1회, 이미 있으면 무시).
create or replace function public.redeem_sales_code(p_code text)
returns boolean
language plpgsql security definer set search_path = public as $$
declare v_company uuid := public.get_my_company_id();
        v_code_id uuid;
begin
  if v_company is null or p_code is null or btrim(p_code) = '' then return false; end if;
  select id into v_code_id from public.sales_codes
    where upper(code) = upper(btrim(p_code)) and is_active
    limit 1;
  if v_code_id is null then return false; end if;   -- 무효 코드는 조용히 무시(결제는 이미 됐고 추적용일 뿐)
  insert into public.sales_code_redemptions (sales_code_id, company_id, applied_trial_days, redeemed_at)
    values (v_code_id, v_company, 0, now())        -- 무료체험 폐지 → 부여 체험일 0
  on conflict (company_id) do nothing;              -- 회사당 1회(Stripe 웹훅이 이미 넣었으면 그대로 둠)
  return true;
end $$;
revoke all on function public.redeem_sales_code(text) from public, anon;
grant execute on function public.redeem_sales_code(text) to authenticated;
