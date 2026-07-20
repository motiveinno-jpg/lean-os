-- chart_of_accounts 시드 경로 부재 봉합
--
-- 문제: chart_of_accounts 는 company_id별 계정과목 마스터인데 신규 회사 생성 시
-- 시드하는 경로가 없어, 계정과목 0건인 회사는 전표입력 화면이
-- "전표 시스템 DB(계정과목 마스터)가 아직 적용되지 않았습니다" 로 영구 먹통.
-- (QA Fable Isolated 등 5개 회사에서 실확인)
--
-- 해결: _seed_legal_allowances_on_company_insert 트리거 패턴을 그대로 따라
--   (A) _seed_chart_of_accounts_internal(company_id) 멱등 함수
--   (B) companies AFTER INSERT 트리거로 자동 시드
--   (C) 계정과목 0건인 기존 회사 백필
--
-- 표준 템플릿: (주)모티브이노베이션(c361afb9) 의 계정과목 95종을 표준 세트로 채택.
--   조사 결과 13개 회사가 모두 동일한 95종을 보유(자산36/부채14/자본6/수익9/비용30)하는
--   표준 한국 계정과목표로, 회사 특화 커스텀 계정이 없어 전량 그대로 임베드.
--   parent_id 는 전부 NULL(계층 없음), UNIQUE(company_id, code) 로 멱등 보장.
--   모티브를 포함한 기존 회사의 계정과목 행은 수정/삭제하지 않는다(백필은 0건 회사만).

-- (A) 내부 시드 함수 — 멱등(이미 계정과목 있으면 skip)
CREATE OR REPLACE FUNCTION public._seed_chart_of_accounts_internal(p_company_id uuid)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_count int := 0;
BEGIN
  IF p_company_id IS NULL THEN
    RETURN 0;
  END IF;

  -- 이미 계정과목이 있으면 건드리지 않는다(기존 회사 커스텀 보존).
  IF EXISTS (SELECT 1 FROM public.chart_of_accounts WHERE company_id = p_company_id) THEN
    RETURN 0;
  END IF;

  INSERT INTO public.chart_of_accounts (company_id, code, name, account_type, is_system)
  VALUES
    (p_company_id, '100', '현금', 'asset', false),
    (p_company_id, '101', '보통예금', 'asset', true),
    (p_company_id, '102', '당좌예금', 'asset', false),
    (p_company_id, '104', '정기예금', 'asset', false),
    (p_company_id, '105', '정기적금', 'asset', false),
    (p_company_id, '106', '단기매매증권', 'asset', false),
    (p_company_id, '108', '외상매출금', 'asset', true),
    (p_company_id, '109', '대손충당금', 'asset', false),
    (p_company_id, '110', '받을어음', 'asset', false),
    (p_company_id, '114', '단기대여금', 'asset', false),
    (p_company_id, '116', '미수금', 'asset', false),
    (p_company_id, '120', '미수수익', 'asset', false),
    (p_company_id, '122', '선급금', 'asset', false),
    (p_company_id, '124', '선급비용', 'asset', false),
    (p_company_id, '135', '부가세대급금', 'asset', true),
    (p_company_id, '136', '선납세금', 'asset', true),
    (p_company_id, '138', '가지급금', 'asset', false),
    (p_company_id, '141', '현금과부족', 'asset', false),
    (p_company_id, '146', '상품', 'asset', false),
    (p_company_id, '147', '제품', 'asset', false),
    (p_company_id, '150', '원재료', 'asset', false),
    (p_company_id, '153', '재공품', 'asset', false),
    (p_company_id, '179', '장기대여금', 'asset', false),
    (p_company_id, '201', '토지', 'asset', false),
    (p_company_id, '202', '건물', 'asset', false),
    (p_company_id, '203', '건물감가상각누계액', 'asset', false),
    (p_company_id, '206', '기계장치', 'asset', false),
    (p_company_id, '207', '기계장치감가상각누계액', 'asset', false),
    (p_company_id, '208', '차량운반구', 'asset', false),
    (p_company_id, '209', '차량운반구감가상각누계액', 'asset', false),
    (p_company_id, '212', '비품', 'asset', false),
    (p_company_id, '213', '비품감가상각누계액', 'asset', false),
    (p_company_id, '226', '개발비', 'asset', false),
    (p_company_id, '227', '소프트웨어', 'asset', false),
    (p_company_id, '232', '특허권', 'asset', false),
    (p_company_id, '240', '임차보증금', 'asset', false),
    (p_company_id, '331', '자본금', 'equity', false),
    (p_company_id, '335', '자본잉여금', 'equity', false),
    (p_company_id, '341', '주식발행초과금', 'equity', false),
    (p_company_id, '351', '이익준비금', 'equity', false),
    (p_company_id, '375', '이월이익잉여금', 'equity', false),
    (p_company_id, '377', '미처분이익잉여금', 'equity', false),
    (p_company_id, '451', '매출원가', 'expense', false),
    (p_company_id, '501', '매입', 'expense', true),
    (p_company_id, '801', '급여', 'expense', false),
    (p_company_id, '802', '상여금', 'expense', false),
    (p_company_id, '806', '퇴직급여', 'expense', false),
    (p_company_id, '811', '복리후생비', 'expense', false),
    (p_company_id, '812', '여비교통비', 'expense', false),
    (p_company_id, '813', '접대비', 'expense', false),
    (p_company_id, '814', '통신비', 'expense', false),
    (p_company_id, '815', '수도광열비', 'expense', false),
    (p_company_id, '817', '세금과공과', 'expense', false),
    (p_company_id, '818', '감가상각비', 'expense', false),
    (p_company_id, '819', '임차료', 'expense', false),
    (p_company_id, '820', '수선비', 'expense', false),
    (p_company_id, '821', '보험료', 'expense', false),
    (p_company_id, '822', '차량유지비', 'expense', false),
    (p_company_id, '824', '운반비', 'expense', false),
    (p_company_id, '825', '교육훈련비', 'expense', false),
    (p_company_id, '826', '도서인쇄비', 'expense', false),
    (p_company_id, '830', '소모품비', 'expense', false),
    (p_company_id, '831', '지급수수료', 'expense', true),
    (p_company_id, '833', '광고선전비', 'expense', false),
    (p_company_id, '835', '대손상각비', 'expense', false),
    (p_company_id, '848', '잡비', 'expense', false),
    (p_company_id, '931', '이자비용', 'expense', false),
    (p_company_id, '932', '외환차손', 'expense', false),
    (p_company_id, '933', '기부금', 'expense', false),
    (p_company_id, '951', '유형자산처분손실', 'expense', false),
    (p_company_id, '980', '잡손실', 'expense', true),
    (p_company_id, '998', '법인세비용', 'expense', false),
    (p_company_id, '251', '외상매입금', 'liability', true),
    (p_company_id, '252', '지급어음', 'liability', false),
    (p_company_id, '253', '미지급금', 'liability', false),
    (p_company_id, '254', '예수금', 'liability', false),
    (p_company_id, '255', '부가세예수금', 'liability', true),
    (p_company_id, '257', '가수금', 'liability', false),
    (p_company_id, '259', '선수금', 'liability', false),
    (p_company_id, '260', '단기차입금', 'liability', false),
    (p_company_id, '261', '미지급비용', 'liability', false),
    (p_company_id, '263', '선수수익', 'liability', false),
    (p_company_id, '265', '미지급세금', 'liability', false),
    (p_company_id, '293', '장기차입금', 'liability', false),
    (p_company_id, '294', '임대보증금', 'liability', false),
    (p_company_id, '295', '퇴직급여충당부채', 'liability', false),
    (p_company_id, '401', '매출', 'revenue', true),
    (p_company_id, '404', '제품매출', 'revenue', false),
    (p_company_id, '901', '잡이익', 'revenue', true),
    (p_company_id, '902', '이자수익', 'revenue', false),
    (p_company_id, '903', '배당금수익', 'revenue', false),
    (p_company_id, '904', '임대료수익', 'revenue', false),
    (p_company_id, '905', '수수료수익', 'revenue', false),
    (p_company_id, '906', '외환차익', 'revenue', false),
    (p_company_id, '910', '유형자산처분이익', 'revenue', false)
  ON CONFLICT (company_id, code) DO NOTHING;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$function$;

-- (B) companies AFTER INSERT 트리거 — 신규 회사 자동 시드
CREATE OR REPLACE FUNCTION public._seed_chart_of_accounts_on_company_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  PERFORM public._seed_chart_of_accounts_internal(NEW.id);
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS seed_chart_of_accounts_on_company_insert ON public.companies;
CREATE TRIGGER seed_chart_of_accounts_on_company_insert
  AFTER INSERT ON public.companies
  FOR EACH ROW
  EXECUTE FUNCTION public._seed_chart_of_accounts_on_company_insert();

-- (C) 백필 — 계정과목 0건인 기존 회사에만 시드 (기존 행 있는 회사는 함수 내부 guard 로 skip)
DO $backfill$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT c.id FROM public.companies c
    WHERE NOT EXISTS (SELECT 1 FROM public.chart_of_accounts a WHERE a.company_id = c.id)
  LOOP
    PERFORM public._seed_chart_of_accounts_internal(r.id);
  END LOOP;
END;
$backfill$;
