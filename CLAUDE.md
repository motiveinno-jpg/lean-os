# OwnerView — 프로젝트 규칙

## MOTIVE Brain (필수)
- **세션 시작**: `cat ~/motive-brain/state/ownerview.md` 읽고 현재 상태 파악 후 작업 시작
- **작업 중 중요 결정**: `~/motive-brain/decisions.md`에 추가
- **실패/성공 교훈**: `~/motive-brain/lessons.md`에 추가
- **세션 종료 또는 컨텍스트 소진 전**: state/ 파일 중 변경된 프로젝트 업데이트
- **잊지 말 것**: 이 규칙은 수동이 아님. 세션이 끝나기 전에 반드시 brain 상태를 갱신할 것

## 기술 스택
- Next.js 16 + React 19 + TypeScript + TailwindCSS
- Supabase (48 테이블, RLS, Realtime, Edge Functions)
- Stripe Live (구독 결제)
- Vercel SSR (호스팅, 자동배포)
- Sentry (에러 모니터링)

## 배포
- `git push origin main` → Vercel 자동 빌드+배포
- www.owner-view.com (프로덕션)

## 절대 하지 말 것
- RLS 없이 테이블 생성 금지
- `console.log` 프로덕션에 남기지 않기
- 소스 코드에 API 키 하드코딩 금지
- curl/SQL만으로 "완료" 보고 금지
