# 세션3 (HR/운영) 작업 요약 — 2026-04-14

## 담당 영역
- `src/app/sign/page.tsx` (전자서명)
- `src/app/(app)/employees/page.tsx`
- `src/app/(app)/documents/page.tsx`
- `src/app/(app)/vault/page.tsx`
- `src/app/(app)/chat/page.tsx`

## 이번 세션에서 구현한 기능

### 1. 전자서명 패드 (모두사인 수준) — `src/app/sign/page.tsx`
- **DevicePixelRatio 기반 고해상도 캔버스** — 레티나에서 선명한 서명
- **속도 기반 가변 두께 + 이차 베지어 곡선 스무딩** — 손글씨 느낌의 부드러운 획
- **Undo (되돌리기)** 버튼 + 전체 지우기
- 베이스라인 가이드 선 + "여기에 서명하세요" placeholder
- 빈 서명 제출 차단 (`hasInk` state)
- **"기본 서명으로 저장"** 체크박스 — `employees.saved_signature`에 저장해 다음 문서에서 자동 재사용
- 모바일 touch-action:none + preventDefault로 스크롤 간섭 제거
- stroke 히스토리 배열 기반으로 resize 시 재렌더링

### 2. Vault 갱신 알림 시스템 — `src/app/(app)/vault/page.tsx`
- **30일 이내 구독 갱신 + 문서 만료 통합 배너**
  - D-7 이내: critical(빨강), D-14 이내: warning(노랑), D-30: info(파랑)
  - 과거 만료는 D+N 표시로 재확인 유도
- **"이동" 버튼** — 해당 row로 스크롤 + 2초 ring 하이라이트
- **중복 구독 감지** — 서비스명 정규화(Pro/Plus/Team 접미사 제거) + 그룹핑
  - 월 중복 지출 추정액 표시 (가장 비싼 하나만 유지했을 때 절감 가능액)
- 개별 알림 dismiss + 전체 접기/펼치기
- `vault-row-{id}` id 부여로 scrollIntoView 지원

### 3. 채팅 파일 갤러리 — `src/app/(app)/chat/page.tsx`
- 기존 단순 리스트 → **FilesGalleryView** 컴포넌트로 교체
- **필터 툴바**: 전체 / 이미지 / PDF / 기타 (각 개수 표시)
- **레이아웃 전환**: 그리드 / 리스트
- **이미지 썸네일** — aspect-square + object-cover + hover scale
- **PDF 인라인 뷰어** — 이모지 아이콘 + "미리보기" 뱃지
- **FilePreviewModal** (새 컴포넌트)
  - 이미지: object-contain 최대화
  - PDF: iframe `#toolbar=1&navpanes=0`
  - 비디오: `<video controls autoPlay>`
  - 오디오: 전용 UI + `<audio controls>`
  - 기타: 다운로드 / 새 탭 안내
  - **키보드 내비**: ← → 이전/다음, Esc 닫기
  - 하단 이미지 썸네일 스트립 (이미지 전용)
  - 다운로드 + 새 탭 링크 헤더

### 4. 문서 기본 템플릿 보강 — `src/app/(app)/documents/page.tsx`
- `DEFAULT_TEMPLATES` 5종 → **8종**으로 확장
- 추가된 3종:
  - **비밀유지계약서 (NDA)** — type: `nda`, 9개 조항 (비밀정보 정의/예외/유효기간/반환/손해배상/관할)
  - **표준근로계약서** — type: `employment`, 10개 조항 (근로기간/업무/근로시간/임금/휴일/4대보험/취업규칙)
  - **프리랜서 용역계약서** — type: `contract`, 9개 조항 (도급성격/3.3% 원천징수/지식재산권/비밀유지)
- 빈 상태 UI의 "기본 양식 5종 등록" → "기본 양식 8종 등록"으로 갱신

## 검증
- `npx next build` — 컴파일 ✓ 성공
- `npx tsc --noEmit` — 내 수정 파일(sign/vault/chat/documents/employees) TS 오류 **0건**
- 기존 TS 오류는 `src/app/(app)/settings/page.tsx`에만 존재 (수정 금지 구역, pre-existing)
- 커밋하지 않음 (지시에 따름)

## 수정한 파일
- `src/app/sign/page.tsx` — 서명 패드 전면 개선
- `src/app/(app)/vault/page.tsx` — 갱신/중복 알림 시스템
- `src/app/(app)/chat/page.tsx` — 파일 갤러리 + 미리보기 모달
- `src/app/(app)/documents/page.tsx` — 템플릿 3종 추가

## 완성도 추정
- 전자서명: 70% → 95% (모두사인 수준)
- Vault: 75% → 90% (갱신 알림 + 중복 감지)
- 채팅: 80% → 92% (파일 프리뷰 Slack 수준)
- 문서관리: 80% → 88% (템플릿 라이브러리 확충)

---

## 2026-04-14 후속 세션 (Session 3 — Round 2)

### 5. 인사 — 급여명세서 PDF + 트리 조직도 + 연말정산 (employees/page.tsx)
- **`src/lib/payslip-pdf.ts` 신설** — jsPDF + jspdf-autotable + NotoSansKR
  - 좌(파랑)지급/우(빨강)공제 2열 테이블, 녹색 실수령액 박스, 사업주부담분/근로기준법 푸터
  - `generatePayslipPDF()` / `downloadPayslipPDF()` exports
- **PayrollPreviewTab**: 행별 ⬇PDF 버튼 + "전체 PDF 일괄다운로드" — companyMeta/empMap 조인
- **OrgChartSVG** 컴포넌트 (기존 카드 그리드 교체) — CEO → 부서 헤더 → 멤버, 단일 SVG, 다운로드 버튼 (Blob+XMLSerializer)
- **YearEndTaxSection** (CertificateTab 상단) — localStorage `yet:{cid}:{year}` 진행률, 홈택스 링크, mailto 일괄안내, 직원별 상태 토글

### 6. 문서 — 일괄 서명 + 리마인더 + 감사로그 (documents/page.tsx + lib/signatures.ts)
- `lib/signatures.ts`: `createBulkSignatureRequests`, `sendSignatureReminder`, `bulkSendReminders`, `getDocumentSignatureAudit` 추가
  - reminder_count 컬럼 부재 graceful degrade(try/catch)
- **DocumentDetailView**: 단일 폼 → 다중 서명자 동적 행 (+추가/✕삭제), 진행률 바, 전체/개별 리마인더 버튼, 감사로그 토글 패널 (📝/✍️/🔔/🔄 아이콘)

### 7. Vault — 미사용 감지 + 좌석 추적 + 접근로그 (vault/page.tsx)
- localStorage `vault:usage:{cid}` — { lastOpenedAt, opens[], seats, usedSeats }
- 30일+ 미사용 경고 배너 + showUnusedOnly 필터
- 컬럼 변경: 결제수단/출처 제거 → "사용 좌석"(인라인 input + bar) + "마지막 사용"(N일 전)
- 행별 "↗ 방문" + "로그" 버튼, 접근 로그 모달

### 8. 채팅 — @멘션 하이라이트 + 핀 패널 (chat-bubble.tsx + chat/page.tsx)
- **chat-bubble.tsx**: `renderContent()` 헬퍼 — `/(@[\w가-힣.\-_]+)/` 정규식으로 @멘션을 파싱 + 강조 (isOwn에 따라 색상 분기), `whitespace-pre-wrap`
- **chat/page.tsx**: 핀 메시지 패널 펼치기/접기 — 펼치면 전체 핀 메시지 리스트 + 클릭 시 scrollIntoView + ring 하이라이트 + hover 시 ✕ 핀해제 버튼
  - 기존 인프라(togglePin, sendMessageWithMentions, reply_to_id 스레드, ChatBubble onPin/onReply/onReact/onEdit/onDelete) 모두 활용

### 9. 전자서명 — 통합 대시보드 (signatures/page.tsx 신설)
- 신규 라우트 `/signatures` (sidebar에 "전자서명" 메뉴 추가, edit-3 아이콘)
- **상태 카운트 카드 7개** (전체 + 6 status) + 클릭으로 필터링
- 검색 (제목·서명자), 체크박스 멀티선택 + 일괄 리마인더
- 테이블: 상태 배지·문서링크·서명자·요청/만료일(만료 빨강)·리마인더 횟수·🔔/🔗/✕ 액션
- **InviteModal**: 문서 선택 → 다중 서명자 행 → 즉시발송 토글 → `createBulkSignatureRequests` 호출
- 30초 자동 폴링

## 검증 (Round 2)
- `npx tsc --noEmit` — 0 errors ✓ (toast(message, variant) 시그니처 4건 수정)
- `npx next build` — 진행 중 (다른 세션이 lock 보유)

## Round 2에서 수정한 파일
- `src/lib/payslip-pdf.ts` (신규)
- `src/lib/signatures.ts` (4 함수 추가)
- `src/app/(app)/employees/page.tsx`
- `src/app/(app)/documents/page.tsx`
- `src/app/(app)/vault/page.tsx`
- `src/app/(app)/chat/page.tsx`
- `src/components/chat-bubble.tsx`
- `src/components/sidebar.tsx` (전자서명 메뉴 + edit-3 아이콘)
- `src/app/(app)/signatures/page.tsx` (신규)
