# 세션 4 — 대시보드/인프라 (2026-04-14, 미커밋)

## 담당 범위
- src/app/(app)/dashboard/page.tsx
- src/app/(app)/settings/page.tsx
- src/app/(app)/onboarding/page.tsx
- src/app/(app)/guide/page.tsx
- src/components/sidebar.tsx
- src/app/(app)/import-hub/page.tsx
- src/app/auth/page.tsx
- src/middleware.ts

## 완료 작업

### 1. 모바일 레이아웃 (sidebar.tsx, dashboard/page.tsx)
- 사이드바 모바일 드로어: `100dvh` + `paddingBottom: env(safe-area-inset-bottom)` 적용 (노치/제스처바 회피)
- 대시보드 컨테이너: `pb-20 md:pb-0` — 하단 네비 겹침 방지
- 대시보드 좌우 스와이프 제스처: 80px 이상 + 600ms 이하 + 수직 50px 이내 → 프리셋 뷰 prev/next 전환
- 편집 모드 중에는 스와이프 무시

### 2. 차트 (line-chart.tsx 신규, dashboard/page.tsx)
- `LineChart` 컴포넌트 신규 (~190줄, src/components/line-chart.tsx)
  - 다중 시리즈, 영역 채우기(linearGradient), 호버 툴팁(좌/우 자동 정렬), 제로 베이스라인, 음수값 처리, 자동 Y축 패딩
- 대시보드 재무 섹션에 2개 차트 추가 (sliced.length > 1 조건):
  - **월별 매출 추이**: 매출(primary) + 순이익(warning) 라인
  - **현금흐름 누적**: 매출-비용 누적값 영역차트(success)
- 기존 BarChart 그대로 유지, 그 아래 grid lg:grid-cols-2

### 3. 알림 설정 탭 (settings/page.tsx)
- `MainTab` 타입에 `notifications` 추가, mainTabs 배열에 "알림" 항목 추가 (8번째)
- `NotificationsTab` 컴포넌트 신규 (~340줄)
- 3채널 × 7이벤트 매트릭스:
  - 채널: 이메일 / 브라우저 푸시 / 텔레그램
  - 이벤트: approval_pending, deal_status, payment_due, tax_invoice, chat_mention, weekly_report, system_alert
- 기능:
  - 채널별 토글, 이벤트별 토글, 모두 켜기/끄기
  - 이메일 주소 입력 (현재 유저 이메일 자동 채움)
  - 푸시: `Notification.requestPermission()` 호출, denied 안내
  - 텔레그램: chatId 입력 + `/api/notifications/telegram-test` POST 테스트 발송
  - 방해금지 시간대 (시작/종료)
  - localStorage(`leanos-notification-prefs`) + supabase `notification_prefs` 테이블 best-effort upsert (테이블 없어도 무시)
  - 기본값 복원, sticky 저장 바
- 헬퍼 컴포넌트: `ChannelSection`, `EventGrid`, `Toggle`

### 4. 시작 체크리스트 (dashboard/page.tsx)
- 기존 GETTING STARTED GUIDE 섹션 → `GettingStartedChecklist` 컴포넌트로 교체
- 6항목 실데이터 카운트 useQuery (60초 refetch):
  - 회사정보(business_number) / 통장 / 거래처 / 딜 / 직원 / 거래내역
- 진행률 바 + "X/6 완료" 카운터
- 항목별 CTA 링크 (완료 시 체크 + 취소선)
- 전체 완료 시 축하 카드로 변환
- localStorage(`leanos-getting-started-dismissed`) dismiss

## 수정 파일
- src/app/(app)/dashboard/page.tsx (+220줄)
- src/app/(app)/settings/page.tsx (+~370줄)
- src/components/sidebar.tsx (mobile drawer 2줄 변경)
- src/components/line-chart.tsx (신규)

## 검증
- `npx next build` ✓ Compiled successfully
- 48/48 페이지 generate 성공
- TypeScript 통과, lint 경고 없음

## 미커밋 사항
- 위 모든 변경은 미커밋 상태
- 의존성 추가 없음 (기존 React/Tailwind/Supabase만 사용)

## 미충족/추후 과제
- `/api/notifications/telegram-test` 엔드포인트는 미생성 (UI에서 호출만 함)
- supabase `notification_prefs` 테이블 마이그레이션 필요 시 별도 작성
- 대시보드 스와이프는 view 전환만, 위젯 reorder는 미구현
