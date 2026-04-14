# 세션2 — 영업/CRM 강화 작업 요약 (2026-04-14)

## 담당 파일
- src/app/(app)/deals/page.tsx
- src/app/(app)/partners/page.tsx
- src/app/(app)/billing/page.tsx
- src/app/(app)/payments/page.tsx

## 1. Partners — 리멤버 수준 CRM 강화
- **CSV 임포트**: 한/영 헤더 자동매핑(`이름/name`, `구분/type`, `사업자번호/business_number` 등 13필드), RFC4180 호환 파서(따옴표 이스케이프, 줄바꿈 처리), 타입값 정규화(공급업체→vendor 등), 태그 구분자 다중지원(,;|).
- **임포트 미리보기 모달**: 50건까지 표 미리보기 + 전체 건수 표시 + 직렬 upsert + 진행 표시 + 에러 핸들링.
- **CSV 템플릿 다운로드** 버튼 (BOM 포함 UTF-8, Excel 호환).
- **관계점수 계산기** `calcRelationshipScore`: 0~100점, A/B/C/D 등급
  - 딜 수 30점 (5건↑ 만점)
  - 계약 총액 30점 (1억↑ 만점)
  - 최근 소통 25점 (7일내 만점, 90일↓ 0점)
  - 결제 이행률 15점 (received 비율)
- **디테일 헤더에 관계점수 뱃지** + tooltip(딜수/계약/소통/이행률 raw 데이터).
- **활동 타임라인 탭** (신규): deals(생성)+payments(due/received)+comms(comm_date) 시간 역순 머지, 좌측 컬러 도트 라인 + 종류별 아이콘/색상 + 상태별 도트 색.

## 2. Billing — Stripe 직접 DB조작 제거
- **Free 다운그레이드**: `hasStripeSubscription`이면 `db.from('subscriptions').update(...)` 대신 `handleOpenPortal()`로 라우팅 → portal에서 정식 cancel_at_period_end 처리, 결제기간 종료 후 free 자동전환.
- **유료↔유료 플랜 변경**: 기존엔 새 checkout 세션 생성으로 중복 구독 위험 → Stripe 구독자는 portal에서 plan 변경 (subscription_update) 라우팅.
- 비-Stripe 사용자의 직접 DB update는 fallback으로 유지 (Stripe 도입 전 데이터 호환).

## 3. Deals — 견적서 PDF 직접 다운로드
- **`handleDownload`** 함수 신규: 미리보기 모달 우회, contract면 HTML / quote면 PDF Blob 즉시 다운로드, `<a download>` 트리거 + URL.revokeObjectURL 정리.
- **⬇ 다운로드 버튼** 미리보기 옆에 추가 (emerald-600 색, 견적서/계약서 활성 시).
- 기존 미리보기 모달 + 다운로드 흐름은 유지 (체크 후 다운로드 워크플로 보존).

## 4. Payments — 결제 큐 다중선택 + 벌크 액션
- **선택 상태**: `selectedIds: Set<string>`, 행/전체 토글, 선택 가능 항목만(pending/approved) 자동 필터.
- **벌크 액션바**: 선택 시 sticky 표시, 선택 건수 + 합계금액(₩), 일괄 승인/거부/실행 + 선택 해제.
- **진행률 표시**: `bulkProgress {done, total, failed}` + 프로그레스바 + 실패 카운트 in-place 업데이트.
- **컨펌 다이얼로그**: 액션별 가능 항목만 추출 → 0건이면 toast 안내, 아니면 `{n}건 {액션} 확인`.
- **상태별 자동 비활성**: executed/rejected는 체크박스 disabled + tooltip.
- **선택 행 하이라이트**: `bg-[var(--primary)]/5`.

## 검증
- `npx next build` 컴파일 ✓ 성공 (Compiled successfully in 5.6s)
- 4개 담당 파일 TypeScript 타입 에러 0건
- 빌드 마지막 단계의 settings/page.tsx toast 시그니처 에러는 담당외/기존 이슈 (수정 금지 영역)

## 주요 신규 함수/컴포넌트
- `parseCSV(text)` — RFC4180 호환 파서
- `calcRelationshipScore(opts)` — 관계점수 계산
- `CSV_FIELD_MAP`, `TYPE_LABEL_TO_VALUE` — 임포트 정규화 매핑
- `handleCSVFile`, `confirmImport`, `downloadCSVTemplate` (partners)
- `handleDownload(documentId)` (deals)
- `runBulk('approve'|'reject'|'execute')`, `toggleOne`, `toggleAllSelectable` (payments)

## 커밋
- 미실행 (사용자 지시: "커밋은 하지 말고 작업만 해줘")

---

## 2026-04-14 2차 강화 (98%+ 달성)

### 5. Deals — 활동 로그 섹션 신규
- **DealActivityLog 컴포넌트** 신규 (ProjectFilesSection 위, DealDetailView 내 배치)
- audit_logs 조회 (entity_type=deal, entity_id=dealId, 최근 100건)
- **필터 칩**: 전체/변경/승인/메모/파일
- **메모 입력창**: Enter로 즉시 저장 → audit_logs.metadata.kind='note'로 기록
- **diff 렌더링**: changes 객체 언패킹, 필드별 old→new (5건까지+나머지 카운트)
- **메타 표시**: 유저명+액션라벨+엔티티명+타임스탬프, 아바타 아이콘 컬러
- ACTION_META: 10종 액션 (create/update/delete/approve/reject/sign/send/lock/unlock/export) 한글 라벨+아이콘+컬러

### 6. Partners — 고급 필터 + 이메일/전화 단축
- **고급 필터 바** 신규 (태그 칩 아래)
  - 산업 드롭다운 (classification 자동수집)
  - 지역 드롭다운 (parseRegion: address 첫 토큰 → 17개 시도 정규화)
  - 거래규모 드롭다운 (partnerTotals 쿼리: deals 집계 map) — VIP(1억+)/중규모/소규모/거래없음
  - 필터 초기화 버튼
- 카운트 표시: `5건/100건` (필터링분/원본)
- **Detail 헤더 액션 버튼**:
  - ✉️ 이메일: mailto:link, contact_email 있을 때만
  - 📞 전화: tel:link, contact_phone 있을 때만

### 7. Billing — 사용량 카드 + 인보이스 PDF + 재시도
- **usage 쿼리** 신규: employees, deals, signatures(월), ai_usage_logs(월), partners 카운트 병렬
- **사용량 카드** (plan 탭 상단): 4지표 × 진행률바 (80%+ 빨강+경고, 60%+ 노랑) + 플랜별 한도 (free/starter/business/enterprise)
- **인보이스 행 개선**:
  - PDF 버튼: window.open 팝업 + 인라인 HTML 템플릿 + window.print() — 회사명/VAT/발행일/총액
  - 재시도 버튼: failed + hasStripeSubscription인 경우 → handleOpenPortal 라우팅
  - 상태 라벨 색상: paid/failed/refunded/pending 차등

### 8. Payments — 영수증 + 환불 플로우
- **receiptItem/refundItem 상태** + refundReason + refundStep (1=사유입력, 2=최종확인)
- **영수증 모달**: 결제일/설명/통장/상태/환불사유 + PDF 버튼 (window.print 팝업) + 환불건은 total 취소선
- **환불 모달 2단계**:
  - 1단계: 사유 textarea (필수) → "다음"
  - 2단계: 확정 경고 + 사유 재표시 → "이전"/"환불 확정"
- **submitRefund**: payment_queue.status=refunded, refund_reason/refunded_at/refunded_by 기록 + audit_logs 병기
- **액션 컬럼**:
  - executed → 영수증 + 환불 버튼
  - refunded → 영수증만 (읽기전용)
- **필터**: refunded 칩 추가, statusConfig에 refunded 색상

## 검증 (2차)
- `npx next build` 컴파일 ✓ 5.6s 성공
- 세션2 4개 파일 TypeScript 에러 0건
- Lines: deals 1052→1203, partners 1119→1224, billing 728→841, payments 1406→1545

## 주요 신규 함수/컴포넌트 (2차)
- `DealActivityLog` 컴포넌트 (deals)
- `ACTION_META` 상수 (deals)
- `parseRegion(address)` — 시도 정규화 (partners)
- `partnerTotals` 쿼리 — 파트너별 계약금 합계 맵 (partners)
- `classOptions`, `regionOptions` — 드롭다운 옵션 자동수집 (partners)
- `usage` 쿼리 + 사용량 한도 매핑 (billing)
- `submitRefund` + receipt/refund 모달 (payments)
