-- 요금제 확정 (2026-08-06 사장님): 오너뷰 월 25,000원 · 기본 5명 · 추가 1명 5,000원
--   가격을 19,000 → 25,000 으로 올린 대신 한도를 넉넉히 푼다(AI 50→100회).
--   손익분기 91개사 → 60개사. 근거: 회사당 평균 원가 8,310원(계좌2·발행20·AI30·수수료 포함).
UPDATE public.subscription_plans SET
  base_price = 25000,
  per_seat_price = 5000,
  included_seats = 5,
  max_seats = NULL,
  max_employees = NULL,
  monthly_issue_limit = 100,
  monthly_contract_limit = NULL,
  monthly_ai_call_limit = 100,
  monthly_ai_token_limit = 1000000,
  bank_sync_enabled = true,
  daily_sync_count = 2,
  features = to_jsonb(ARRAY[
    '기본 5명 포함 · 추가 1명 ₩5,000/월',
    '세금계산서+현금영수증 발행 합산 월 100건',
    '전자계약(서명) 무제한',
    '은행·카드 계좌 수 제한 없이 하루 2회 자동 동기화',
    '홈택스 자동 수집 · 부가세 자료 정리',
    'AI 대표 참모 월 100회',
    '전자결재·근태·급여·프로젝트 전 기능 무제한'
  ])
WHERE slug = 'standard';

UPDATE public.subscription_plans SET
  monthly_ai_call_limit = 5,
  features = to_jsonb(ARRAY[
    '구성원 5명',
    '전자결재·근태·급여·프로젝트·게시판·문서함 무제한',
    '세금계산서+현금영수증 발행 합산 월 5건',
    '전자계약 월 5건',
    'AI 대표 참모 월 5회',
    '은행·카드 연동은 유료 플랜에서'
  ])
WHERE slug = 'free';
