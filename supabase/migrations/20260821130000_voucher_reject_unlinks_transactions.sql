-- 전표 반려가 원거래 연결을 풀지 않아 '어디에서도 안 잡히는 거래' 가 되던 것 (2026-08-21 감사)
--
-- 증상: 전표를 반려(선택 삭제)하면 journal_entries.status 만 'rejected' 가 되고
--   card_transactions.journal_entry_id / bank_transactions.journal_entry_id 는 그대로 남았다.
--   · 카드·통장 화면은 그 거래를 영원히 "전표처리됨" 으로 표시하고 버튼도 감춘다.
--   · 재생성은 post_card_voucher 가 ALREADY_POSTED 로 막아 **복구 경로가 없다.**
--   · 정산에서 만든 전표는 settlement_status='settled' 까지 같이 세팅하는데, 반려해도
--     'open' 으로 안 돌아와 미정산 큐(open/partial)에도 안 나타난다.
-- 지금 프로덕션에 실제 유령 건은 0건 — 터지기 전에 막는다.
--
-- 나머지 로직(권한·마감 잠금·상태 검사)은 기존과 동일. 연결 해제만 추가한다.

CREATE OR REPLACE FUNCTION public.voucher_reject(p_entry_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_company uuid := public.get_my_company_id();
  v_uid uuid;
  v_e record;
begin
  if not (public.is_company_admin() OR public.has_perm('/partners/reconciliation/voucher-entry')) then
    raise exception 'FORBIDDEN';
  end if;
  select u.id into v_uid from users u where u.auth_id = auth.uid() limit 1;
  select * into v_e from journal_entries where id = p_entry_id and company_id = v_company;
  if v_e.id is null or v_e.status not in ('ai_suggested','confirmed') then
    raise exception 'NOT_FOUND_OR_INVALID';
  end if;
  -- confirmed (already booked) cannot be voided inside a locked period
  if v_e.status = 'confirmed' and exists (
    select 1 from closing_checklists cc
    where cc.company_id = v_company
      and cc.month = to_char(v_e.entry_date, 'YYYY-MM')
      and cc.status = 'locked'
  ) then
    raise exception 'PERIOD_LOCKED';
  end if;

  update journal_entries
  set status = 'rejected', is_approved = false,
      reviewed_by = v_uid, reviewed_at = now(), updated_at = now()
  where id = p_entry_id;

  -- ★ 원거래 연결 해제 (2026-08-21) — 안 풀면 화면이 계속 '전표처리됨' 으로 막고 재생성도 안 된다.
  update card_transactions
     set journal_entry_id = null
   where journal_entry_id = p_entry_id and company_id = v_company;

  update bank_transactions
     set journal_entry_id = null,
         -- 정산 경로가 걸어 둔 'settled' 는 미정산 큐로 돌려놔야 다시 처리할 수 있다.
         settlement_status = case when settlement_status = 'settled' then 'open' else settlement_status end
   where journal_entry_id = p_entry_id and company_id = v_company;
end;
$function$;
