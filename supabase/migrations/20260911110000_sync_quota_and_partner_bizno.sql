-- ① 무료 요금제 수집 한도는 '실제로 수집되는 것'만 센다 (2026-09-11 사장님 제보).
--    종전엔 sync_enabled 만 보고 셌는데, 이 칸은 기본값이 true 라 **직접 등록한 통장**(은행에 연결한 적이
--    없어 영원히 수집될 수 없는 통장)도 자리를 먹었다. 실제로 유앤아이 1자리·QA시드 3자리가 그렇게 묶여
--    있었고, 이 상태에서 은행을 연결하면 진짜 계좌가 한도에 걸려 조용히 '수집 꺼짐'으로 들어온다.
--    → 통장은 source='codef'(연동으로 들어왔거나 연동에 붙은 것)인 것만 센다. 카드는 구분 칸이 없고
--      카드사 연결만 되면 끝 4자리로 붙으므로 종전대로 전부 센다.
--    또 하나: 직접 등록한 통장이 나중에 연동에 붙어 source 가 codef 로 바뀌는 경로(codef-sync 의
--    계좌번호 매칭)가 있는데, 종전 조건은 '이미 켜져 있던 행'이면 그냥 통과시켜 이 경로로 한도가 샜다.
--    이제 '수집 대상이 아니던 행 → 수집 대상' 으로 바뀌는 순간을 함께 본다.
begin;

create or replace function public.enforce_free_account_limit()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare
  v_slug text;
  v_cnt  integer;
  v_now  boolean;   -- 이 행이 지금 '수집 대상'인가
  v_was  boolean;   -- 바뀌기 전에도 '수집 대상'이었나
begin
  if tg_table_name = 'bank_accounts' then
    v_now := coalesce(new.sync_enabled, true) and new.source = 'codef';
    v_was := tg_op = 'UPDATE' and coalesce(old.sync_enabled, true) and old.source = 'codef';
  else
    v_now := coalesce(new.sync_enabled, true);
    v_was := tg_op = 'UPDATE' and coalesce(old.sync_enabled, true);
  end if;

  if not v_now then return new; end if;   -- 수집 대상이 아니면 한도와 무관
  if v_was then return new; end if;       -- 이미 수집 중이던 행의 다른 칸 수정

  select effective_plan_slug into v_slug from public.get_company_entitlement(new.company_id);
  if coalesce(v_slug, 'free') <> 'free' then return new; end if;

  select (select count(*) from public.bank_accounts ba
            where ba.company_id = new.company_id and ba.sync_enabled and ba.source = 'codef'
              and (tg_op = 'INSERT' or ba.id <> new.id))
       + (select count(*) from public.corporate_cards cc
            where cc.company_id = new.company_id and cc.sync_enabled
              and (tg_op = 'INSERT' or cc.id <> new.id))
    into v_cnt;

  if v_cnt >= 3 then
    raise exception '무료 요금제는 통장·카드를 합쳐 3개까지 수집할 수 있습니다. 통장·카드 화면에서 수집할 것을 고르거나, 오너뷰 요금제로 업그레이드하면 무제한으로 연결됩니다.'
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

--   화면에 보이는 '수집 n/3' 도 같은 기준이어야 한다. 세는 법이 다르면 한도는 남았는데 꽉 찼다고 나온다.
create or replace function public.free_sync_quota(p_company uuid)
returns jsonb language plpgsql stable security definer set search_path = 'public', 'pg_temp' as $$
declare v_slug text; v_used int;
begin
  if not exists (select 1 from public.users u where u.auth_id = auth.uid() and u.company_id = p_company) then
    return jsonb_build_object('free', false, 'limit', null, 'used', 0);
  end if;
  select effective_plan_slug into v_slug from public.get_company_entitlement(p_company);
  select (select count(*) from public.bank_accounts where company_id = p_company and sync_enabled and source = 'codef')
       + (select count(*) from public.corporate_cards where company_id = p_company and sync_enabled) into v_used;
  return jsonb_build_object('free', coalesce(v_slug, 'free') = 'free', 'limit', case when coalesce(v_slug, 'free') = 'free' then 3 else null end, 'used', v_used);
end
$$;

-- ② 거래처 사업자번호 중복 등록 막기.
--    같은 회사 장부에 같은 사업자번호가 두 번 들어가면 원장이 둘로 갈린다(모티브에 10쌍이 쌓였고
--    '육신문화/육식문화' 처럼 오타 쌍도 있었다). 유니크 인덱스는 이미 있는 중복 때문에 만들 수 없으므로,
--    **새로 생기는 것만** 막는 트리거로 둔다 — 기존 중복은 사람이 어느 쪽을 남길지 정해 합쳐야 한다.
--    비교는 숫자만 뽑아서 한다(하이픈 유무로 같은 번호가 다르게 보이지 않게).
create or replace function public.partners_block_duplicate_bizno()
returns trigger language plpgsql security definer set search_path = 'public' as $$
declare v_digits text; v_other text;
begin
  v_digits := regexp_replace(coalesce(new.business_number, ''), '[^0-9]', '', 'g');
  if length(v_digits) < 10 then return new; end if;   -- 안 적었거나 아직 덜 적은 번호는 통과
  --   번호가 그대로면 검사하지 않는다 — 기존 중복 행의 이름·연락처를 고치는 것까지 막으면 안 된다
  if tg_op = 'UPDATE' and regexp_replace(coalesce(old.business_number, ''), '[^0-9]', '', 'g') = v_digits then
    return new;
  end if;
  select name into v_other from public.partners
   where company_id = new.company_id
     and id <> new.id
     and regexp_replace(coalesce(business_number, ''), '[^0-9]', '', 'g') = v_digits
   limit 1;
  if v_other is not null then
    raise exception '사업자번호 %(이)가 이미 거래처 "%" 에 등록돼 있습니다. 같은 번호를 두 번 등록하면 거래처 원장이 둘로 갈립니다.', new.business_number, v_other
      using errcode = 'P0001';
  end if;
  return new;
end;
$$;

drop trigger if exists trg_partners_dup_bizno on public.partners;
create trigger trg_partners_dup_bizno
  before insert or update of business_number on public.partners
  for each row execute function public.partners_block_duplicate_bizno();

commit;
