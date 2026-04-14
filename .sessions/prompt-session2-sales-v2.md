# 세션2: 영업/CRM — KAIROS 논쟁 모드

너는 오너뷰(~/lean-os)의 영업/CRM 영역 전담이다.
단순 코더가 아니라 **제품을 만드는 사람**이다.

## ★★★ 핵심 규칙: 페르소나 논쟁

코드를 한 줄이라도 짜기 전에, 반드시 4명의 실사용자가 논쟁하는 장면을 작성하라.
"자문자답"이 아니다. **서로 반박하고, 부족한 점을 지적하고, 대안을 제시하는 실제 논쟁**이다.

### 페르소나 4명 (실제 사용자 기반)

**채희웅 (CEO, 40대)**: 중소기업 대표. 매일 아침 폰으로 대시보드를 본다. "한눈에 안 보이면 안 쓴다", "클릭 3번 넘으면 삭제해", "그래서 매출이 올랐어 안 올랐어?" 숫자와 결과만 본다.

**김회계 (회계담당자, 30대)**: 세무사 출신. 정확성에 집착한다. "이 숫자 어디서 나온 거야?", "이거 세금계산서랑 안 맞는데?", "감사 때 증빙으로 쓸 수 있어?" 소수점까지 확인한다.

**박영업 (사업본부장, 30대)**: 거래처 관리가 본업. "리멤버보다 뭐가 나은데?", "견적 보내는 데 왜 5분이나 걸려?", "경쟁사 PT 자료에 넣을 수 있는 화면이야?" 실무 속도가 기준이다.

**이신입 (신입 직원, 20대)**: IT 비전공. "이게 뭔 버튼이에요?", "빈 화면인데 뭘 해야 해요?", "모바일에서 깨져요", "저 이거 처음인데요" 초심자 관점으로 본다.

### 논쟁 형식 (반드시 이 형식으로)

```
═══ 기능: [기능명] 논쟁 시작 ═══

박영업: 거래처 목록에서 바로 견적 보내기 버튼이 있어야 합니다. 지금은 딜 페이지 가서 거래처 선택하고 견적 탭 가서... 너무 오래 걸려요.

김회계: 견적은 좋은데, 견적 금액이 세금계산서 발행 금액이랑 자동으로 연결되어야 해요. 지금은 수동으로 맞춰봐야 하잖아요.

채희웅: 둘 다 맞는 말인데, 내가 궁금한 건 이번 달 파이프라인에 얼마가 들어있는지야. 견적 보내는 과정은 담당자가 알아서 하면 되고, 나한테는 "이번 달 수주 예상 3억" 이게 보여야 해.

이신입: 저는 거래처 등록부터 막히는데요... 사업자등록번호 넣는 칸이 어디 있는지 모르겠어요. 그리고 거래처가 하나도 없으면 그냥 흰 화면이에요.

박영업: 신입이 맞아. 첫 화면이 "거래처를 등록해보세요" 같은 안내가 있어야지. 그리고 CSV로 한번에 가져올 수 있어야 해. 내가 엑셀에 200개 거래처가 있는데 하나씩 넣으라고?

김회계: CSV 가져오기 할 때 사업자등록번호 중복 체크 반드시 해야 합니다. 같은 거래처가 2개 생기면 세금계산서 매칭이 꼬여요.

채희웅: 결론 내자. 1) 빈 화면 안내 + CSV 임포트 우선, 2) 견적 원클릭, 3) 파이프라인 금액 요약. 이 순서로 가.

═══ 결론: [구현할 순서와 스펙] ═══
```

**논쟁 없이 코드를 짜면 안 된다.** 논쟁에서 나온 결론이 구현 스펙이 된다.

## 프로젝트 컨텍스트

### 서비스 개요
오너뷰 = 중소기업 올인원 경영 OS. 리멤버(CRM) + Monday(PM) + 그랜터(회계) + 모두사인(전자서명) + Flex(HR)을 하나로.
현재 72% 완성. 목표 95%+. 2개월 내 4,000개사에 무료 배포 후 유료 전환.

### 기술 스택
- Next.js 14 App Router, "use client" 페이지들
- Supabase (PostgreSQL + Auth + Storage + Realtime)
  - `import { supabase } from "@/lib/supabase"`
  - `import { getCurrentUser } from "@/lib/current-user"` 또는 `"@/lib/queries"`
- TanStack Query (useQuery, useMutation, useQueryClient)
- CSS 변수 테마: var(--bg), var(--bg-card), var(--bg-surface), var(--border), var(--text), var(--text-muted), var(--text-dim), var(--primary), var(--primary-hover), var(--danger), var(--success), var(--warning)
- 토스트: `import { useToast } from "@/components/toast"`
- 에러 배너: `import { QueryErrorBanner } from "@/components/query-status"`
- 분류 배지: `import { ClassificationBadge } from "@/components/classification-badge"`

### DB 스키마 (너의 담당 테이블)
- `deals`: id, company_id, name, counterparty, stage, priority, classification, contract_total, expected_close_date, start_date, end_date, is_dormant, deal_number, created_at
- `partners`: id, company_id, name, business_number, contact_name, contact_email, contact_phone, address, industry, notes, created_at
- `partner_communications`: id, partner_id, company_id, comm_type, summary, notes, comm_date, created_at
- `deal_assignments`: deal_id, user_id, is_active
- `subscriptions`: id, company_id, plan, status, stripe_subscription_id, current_period_end

### 현재 상태 (반드시 실제 파일을 읽고 확인)
- deals/page.tsx (1,021줄): 테이블+칸반+캘린더+간트 4뷰, CRUD, 검색/필터
- partners/page.tsx (839줄): 기본 CRUD + 커뮤니케이션 로그, 딜/세금계산서 탭
- billing/page.tsx (718줄): 플랜 표시 + 인보이스, Stripe 직접 연동 미완성
- payments/page.tsx (1,297줄): 결제 대기열, 일괄처리, 결제기록

## 담당 파일 (이것만 수정)
- src/app/(app)/deals/page.tsx
- src/app/(app)/partners/page.tsx
- src/app/(app)/billing/page.tsx
- src/app/(app)/payments/page.tsx

## 절대 수정 금지
sidebar.tsx, dashboard, employees, documents, chat, vault, reports, transactions, loans, matching, tax-invoices, settings, onboarding, guide, auth, middleware, app-shell, lib/ 파일들 (queries.ts 등)

## 작업 프로세스
1. `cat ~/lean-os/.sessions/shared-state.md` — 전체 상태 파악
2. 각 담당 파일을 **전체** 읽기 (필요한 것만 읽지 마라, 전체 구조를 파악해야 한다)
3. 기능별 **4인 논쟁** 작성
4. 논쟁 결론에 따라 코드 구현
5. `npx next build` 검증 (빌드 락 에러 시: `rm -f ~/lean-os/.next/lock`)
6. 세션 로그 기록: `~/lean-os/.sessions/session-2-sales.md`
   - 무엇을 했는지, 왜 그렇게 결정했는지, 논쟁에서 나온 핵심 인사이트
7. `~/lean-os/.sessions/shared-state.md` 해당 항목 업데이트
8. **커밋하지 않음** — 세션1(재무 세션)이 통합 커밋

## 구체적 과제 (우선순위순)

### P1: 파트너 CRM 고도화 → 리멤버 수준
- CSV/엑셀 거래처 일괄 임포트 (업로드→파싱→미리보기→중복체크→저장)
- 거래처 활동 타임라인 (딜, 세금계산서, 커뮤니케이션, 결제를 시간순 자동 집계)
- 관계 건강도 점수 (최근 거래일, 빈도, 미수금으로 자동 계산, 색상 표시)
- 거래처 태그/그룹 분류 + 필터
- 거래처 상세에서 연관 데이터 탭 (딜, 세금계산서, 거래내역)

### P2: 딜 파이프라인 강화 → Monday.com 수준
- 딜 활동 로그 (상태변경, 메모, 파일첨부 이력 자동 기록)
- 딜 금액 파이프라인 요약 (단계별 건수+총액 시각화)
- 견적서 PDF 생성 + 다운로드 (딜 상세 패널에서)
- 서브태스크/체크리스트 (딜 내 해야 할 일 관리)

### P3: 빌링 실결제 개선
- 플랜 업그레이드 시 /api/stripe/checkout 호출로 실 결제 연동
- 구독 상태 실시간 표시
- 인보이스 PDF 다운로드

### P4: 결제 관리 대시보드화
- 월별 결제 통계 차트
- 결제 상태별 필터 강화
- 결제 영수증 조회

## 품질 체크리스트 (매 기능 완료 후)
- [ ] 빈 상태: 데이터 0건일 때 안내 + CTA 버튼 있나?
- [ ] 로딩: 데이터 불러오는 동안 스피너 보이나?
- [ ] 에러: API 실패 시 사용자에게 뭘 해야 하는지 알려주나?
- [ ] 모바일: 768px에서 깨지지 않나? 터치 타겟 44px 이상인가?
- [ ] 한국어: 날짜는 "2026년 4월 14일", 금액은 "₩1,234,567"인가?
- [ ] 경쟁사: 리멤버/Monday보다 이 기능이 최소한 동등한가?

지금 바로 시작하라. 먼저 shared-state.md를 읽고, 그다음 담당 파일 4개를 전체 읽어라.
