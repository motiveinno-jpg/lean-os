# 세션3: HR/운영 — KAIROS 논쟁 모드

너는 오너뷰(~/lean-os)의 HR/운영 영역 전담이다.

## ★★★ 핵심 규칙: 페르소나 논쟁

코드를 한 줄이라도 짜기 전에, 반드시 4명의 실사용자가 **논쟁**하는 장면을 작성하라.
자문자답이 아니다. 서로 반박하고, 부족한 점을 지적하고, 대안을 제시하는 실제 논쟁이다.

### 페르소나 4명

**채희웅 (CEO)**: "직원 수와 총 인건비가 대시보드에서 바로 보여야 한다. 급여일 전에 총 지급액이 얼마인지 미리 알아야 한다."

**김회계 (회계담당자)**: "급여 명세서가 정확해야 한다. 4대보험 요율 틀리면 안 된다. 원천세 신고 자료로 바로 쓸 수 있어야 한다. 소수점 이하 절사인지 반올림인지도 중요하다."

**박영업 (사업본부장)**: "계약서를 거래처에 보낼 때 모두사인처럼 쉬워야 한다. 상대방이 링크 하나 클릭하면 서명 끝. 나한테는 누가 서명했고 안 했는지 한눈에 보여야 한다."

**이신입 (신입 직원)**: "내 급여 명세서는 어디서 봐요? 연차 몇 개 남았는지 어떻게 확인해요? 증명서 발급은? 채팅에서 파일 보내면 미리보기 안 되나요?"

### 논쟁 형식

```
═══ 기능: [기능명] 논쟁 시작 ═══

박영업: [주장 + 근거]
김회계: [반박 또는 추가 조건]
채희웅: [경영자 관점 판단]
이신입: [초심자 관점 문제 제기]
... (최소 2라운드 이상 핑퐁)
채희웅: [최종 결론 + 우선순위]

═══ 결론: [구현 스펙 + 순서] ═══
```

## 프로젝트 컨텍스트

오너뷰 = 중소기업 올인원 경영 OS. 현재 72%. 목표 95%+.
경쟁사: Flex(HR), 모두사인(전자서명), Slack(채팅), 1Password(Vault)

### 기술 스택
- Next.js 14 App Router, "use client"
- Supabase: `import { supabase } from "@/lib/supabase"`
- 현재 유저: `import { getCurrentUser } from "@/lib/current-user"` 또는 `"@/lib/queries"`
- TanStack Query, CSS 변수, useToast, QueryErrorBanner

### DB 스키마 (너의 담당 테이블)
- `employees`: id, company_id, name, email, position, department, hire_date, salary, bank_name, bank_account, status, employee_number, phone
- `attendance`: id, employee_id, company_id, date, check_in, check_out, status, note
- `leave_requests`: id, employee_id, company_id, leave_type, start_date, end_date, reason, status
- `documents`: id, company_id, title, content, doc_type, status, created_by, created_at
- `document_revisions`: id, document_id, version, content, created_by
- `document_signatures`: id, document_id, signer_email, signer_name, status, signed_at, signature_data
- `vault_items`: id, company_id, service_name, login_url, username, password_encrypted, renewal_date, monthly_cost, category
- `chat_messages`: id, company_id, channel_id, user_id, content, file_url, file_name, reactions, created_at
- `chat_channels`: id, company_id, name, description, is_private

## 담당 파일
- src/app/(app)/employees/page.tsx (4,169줄)
- src/app/(app)/documents/page.tsx (2,889줄)
- src/app/(app)/vault/page.tsx (806줄)
- src/app/(app)/chat/page.tsx (1,318줄)
- src/app/sign/page.tsx

## 절대 수정 금지
sidebar.tsx, dashboard, deals, partners, billing, payments, reports, transactions, loans, matching, tax-invoices, settings, onboarding, guide, auth, middleware, lib/ 파일들

## 작업 프로세스
1. `cat ~/lean-os/.sessions/shared-state.md` — 전체 상태 파악
2. 담당 파일 **전체** 읽기 (부분만 읽지 마라)
3. 기능별 **4인 논쟁** 작성
4. 논쟁 결론에 따라 코드 구현
5. `npx next build` 검증 (`rm -f ~/lean-os/.next/lock` 필요 시)
6. 세션 로그: `~/lean-os/.sessions/session-3-hr.md`
7. shared-state.md 업데이트
8. 커밋 금지

## 구체적 과제

### P1: 전자서명 캔버스 → 모두사인 수준
- HTML5 Canvas 서명 패드 (터치+마우스, 선 굵기 조절)
- 서명을 PNG로 저장 → document_signatures 테이블에 base64 저장
- 문서 미리보기에서 서명 위치 표시
- 서명 완료 시 타임스탬프 + IP 기록
- 외부 서명자용 /sign 페이지 UX 개선

### P2: 문서 템플릿 시스템
- 기본 템플릿 5종: 근로계약서, NDA, 견적서, 발주서, 업무위탁계약서
- 각 템플릿에 변수 자리표시자: {{회사명}}, {{날짜}}, {{대표자명}}, {{상대방명}}
- 변수 자동 치환 (회사 정보 + 작성자 정보에서)
- 사용자 커스텀 템플릿 저장/관리

### P3: Vault 갱신 알림 + 비용 분석
- 만료 예정 구독 배지 (D-30 노랑, D-7 빨강)
- 월별 구독 비용 추이 SVG 차트
- 중복 구독 자동 감지
- 미사용 구독 감지 (최근 로그인 없는 서비스)

### P4: 채팅 파일 미리보기 + 검색
- 이미지: 인라인 썸네일 (max-width: 300px, 클릭 시 전체 보기)
- PDF: 첫 페이지 미리보기 또는 아이콘+파일크기
- 메시지 검색 (키워드 입력 → 결과 하이라이트)
- @멘션 하이라이트

### P5: 직원 조직도
- 부서별 트리 구조 SVG 시각화
- 각 노드에 이름+직급+사진
- 클릭 시 직원 상세 패널

## 품질 체크리스트
- [ ] 빈 상태 안내 + CTA
- [ ] 로딩 스피너
- [ ] 에러 설명 + 재시도
- [ ] 모바일 768px 대응
- [ ] 한국어 UI (날짜/금액 포맷)
- [ ] 경쟁사 대비 최소 동등

지금 바로 시작하라. shared-state.md 읽고, 담당 파일 전체 읽어라.
