-- 가맹점 '구분'에서 법인을 가려내고, 카드 미지급금 거래처를 안전하게 연결한다 (2026-08-12 사장님 제보)
--
--   ① 구분이 틀렸다 — 조회한 198곳 중 **82곳이 법인인데 전부 '일반'** 으로 저장돼 있었다.
--      원인: 국세청 상태조회의 tax_type 은 "부가가치세 일반과세자/간이과세자/면세사업자" 만 주고
--      **법인·개인을 구분해 주지 않는다**. 법인 여부는 **사업자등록번호 가운데 두 자리**로 안다.
--      81~85 법인격(비영리·국가지자체·외국법인 포함) · 86~88 영리법인.
--      (89 는 법인격 없는 종교단체, 90~99 는 개인 면세사업자라 법인이 아니다)
--      간이·면세는 개인만 가능하므로 그 둘이 먼저다 — 덮어쓰지 않는다.
--      화면 쪽 같은 규칙: src/lib/merchant-tax-type.ts 의 merchantKindOf().
--
--   ② 카드 미지급금에 카드사 거래처를 걸어야 한다("같은 카드끼리 카드대금 빠져나가는지
--      거래처원장에서 확인해야 함"). post_card_voucher 는 이미 find_or_create_card_partner 로
--      걸고 있었는데, **수집·전표 화면은 그 길을 안 쓰고** 직접 분개를 만들어 보내며
--      모든 줄의 거래처를 가맹점(카드는 null)으로 넣고 있었다. 화면이 쓸 안전한 입구를 연다.

-- ── 1) 법인 재판정 백필 ────────────────────────────────────────────────────
UPDATE public.merchant_tax_types
SET kind = '법인'
WHERE substr(bizno, 4, 2) IN ('81','82','83','84','85','86','87','88')
  AND coalesce(tax_type, '') NOT LIKE '%간이%'
  AND coalesce(tax_type, '') NOT LIKE '%면세%'
  AND kind IS DISTINCT FROM '법인';

-- ── 2) 화면이 부를 안전한 카드 거래처 입구 ──────────────────────────────────
--   회사를 **인자로 받지 않는다** — 부른 사람의 회사로만 만든다.
CREATE OR REPLACE FUNCTION public.resolve_card_partner(p_card_name text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare v_company uuid := public.get_my_company_id();
begin
  if v_company is null then raise exception 'NO_COMPANY'; end if;
  return public.find_or_create_card_partner(v_company, p_card_name);
end;
$function$;

GRANT EXECUTE ON FUNCTION public.resolve_card_partner(text) TO authenticated;

COMMENT ON FUNCTION public.resolve_card_partner(text) IS
  '카드 이름으로 미지급금 거래처를 찾거나 만든다. 회사는 호출자 것으로 강제 — 화면에서 쓰는 입구.';

--   ⚠️ 기존 find_or_create_card_partner(회사를 인자로 받는 쪽)은 SECURITY DEFINER 인데
--     anon·authenticated 에게 열려 있었다 — **아무나 남의 회사에 거래처를 만들 수 있었다**.
--     화면에서 쓴 적이 없고(전수 grep) post_card_voucher 가 DEFINER 안에서 부르므로 닫아도 안전하다.
REVOKE EXECUTE ON FUNCTION public.find_or_create_card_partner(uuid, text) FROM anon, authenticated;
