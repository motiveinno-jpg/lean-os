-- 폐지된 요금제 정리. 현재 요금제는 무료·오너뷰(standard)·울트라(자사 전용)뿐이다.
--   basic(프로 79,500)·enterprise(199,000)는 비활성 상태로 표에 남아 운영자 화면과 코드 분기에 계속 보였다.
--   구독이 하나도 없는 것만 지운다(참조 무결성 보호).
delete from public.subscription_plans p
 where p.slug in ('basic', 'enterprise', 'starter', 'pro', 'business')
   and not exists (select 1 from public.subscriptions s where s.plan_id = p.id);

-- 요금제 설명(features)을 공개 요금표(src/components/landing/content.ts PLANS)와 같게 맞춘다.
--   옛 문구("AI 대표 참모 월 5회/100회", "발행 합산 월 5건", "은행·카드 연동은 유료 플랜에서")가 남아 있었다.
update public.subscription_plans set features = '[
  "구성원 5명",
  "저장공간 500MB",
  "결재 허브·근태·급여·프로젝트·게시판·파일보관함 무제한",
  "세금계산서 발행 월 5건 · 현금영수증 발행 월 5건",
  "전자계약 월 5건",
  "AI 대표 참모 월 10만 토큰",
  "통장·카드 3개까지 연결 · 하루 2회 자동 동기화",
  "AI 브리핑은 기본형(요약 규칙)"
]'::jsonb where slug = 'free';

update public.subscription_plans set features = '[
  "기본 5명 포함 · 추가 1명당 ₩5,000/월",
  "저장공간 500MB + 추가 1명당 10GB · 저장공간 팩(+10GB) ₩5,000/월",
  "세금계산서 발행 월 100건 · 현금영수증 발행 월 100건",
  "전자계약(서명) 무제한",
  "통장·카드 무제한 연결 · 하루 2회 자동 + 필요할 때 즉시 동기화",
  "홈택스 자동 수집 · 부가세 자료 정리",
  "AI 대표 참모 월 50만 토큰",
  "AI 브리핑(매일 자동 분석)",
  "결재 허브·근태·급여·프로젝트 전 기능 무제한"
]'::jsonb where slug = 'standard';
